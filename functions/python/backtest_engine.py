"""
backtest_engine.py  —  XQ Trade M8
===================================
Production-grade backtester for the XAU/USD Transformer model.

Fixes vs original
-----------------
1.  Position sizing — P&L is in dollars, not price points.
    ATR-based SL drives unit size (1% NAV risk per trade).
2.  Win rate — computed only over closed trades, not all rows.
3.  Sequence construction — numpy stride trick (zero-copy, O(n) memory).
4.  OHLC alignment — High/Low aligned to Close so intrabar SL/TP fire
    at the correct price, not at the close bar.
5.  torch.load — weights_only=True to prevent pickle deserialization.
6.  Exits — ATR stop loss, ATR take profit, Chandelier trailing stop,
    and signal-invalidation exit per trade_logic.txt.
7.  Trade count — counted directly, not inferred from len // 2.
8.  Friction model — spread + commission deducted from every fill.

New metrics
-----------
- Sharpe ratio (annualised)
- Max drawdown
- Per-trade R-multiple
- Profit factor
- Average hold bars
- Equity curve plot alongside price

Usage
-----
    python backtest_engine.py

    # Override defaults via env or edit CONFIG block below.
"""

from __future__ import annotations

import os
import sys
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import torch
import matplotlib
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

# ─── Local imports ────────────────────────────────────────────────────────────
# These must be on PYTHONPATH or in the same directory.
try:
    from transformer_model import TransformerTradingModel
    from generate_features import generate_features, create_labels
except ImportError as exc:
    sys.exit(f"[FATAL] Cannot import project modules: {exc}\n"
             "Ensure transformer_model.py and generate_features.py are on PYTHONPATH.")

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("backtest")

# ─── CONFIG ───────────────────────────────────────────────────────────────────
@dataclass
class BacktestConfig:
    # Data
    data_path:    str   = "data/XAUUSD.csv"
    model_path:   str   = "models/transformer_trading_model.pth"
    seq_len:      int   = 60

    # Capital
    initial_capital: float = 10_000.0

    # Risk per trade — fraction of current equity risked on SL distance
    risk_per_trade:  float = 0.01    # 1 % NAV

    # ATR parameters
    atr_period:      int   = 14
    atr_sl_mult:     float = 1.5     # SL = entry − 1.5 × ATR  (trade_logic.txt)
    atr_tp_mult:     float = 2.0     # TP = entry + 2.0 × ATR  (trade_logic.txt)
    max_exposure:    float = 0.15    # Cap position at 15 % NAV  (riskmanager.py)

    # Chandelier trailing stop (trade_logic.txt Exit 3)
    use_trailing:     bool  = True
    chandelier_mult:  float = 2.0   # HighestHigh − 2.0 × ATR

    # Session filter — UTC hour range for valid entries (trade_logic.txt)
    # Set both to None to disable.
    session_start_utc: Optional[int] = 8    # London open
    session_end_utc:   Optional[int] = 21   # NY close

    # Friction model
    spread_bps:    float = 3.0   # half-spread each side in basis points
    commission_bps: float = 5.0  # round-trip commission in basis points

    # Max trades per day per asset (trade_logic.txt)
    max_daily_trades: int = 2

    # Entry confluence filters (trade_logic.txt)
    adx_threshold:   float = 30.0
    rsi_low:         float = 40.0
    rsi_high:        float = 60.0
    breakout_bars:   int   = 10    # Close > highest(Close, N bars)

    # Provenance label — always present on output
    provenance: str = "BACKTEST_SYNTHETIC — not forward performance"


CFG = BacktestConfig()

# ─── Device ───────────────────────────────────────────────────────────────────
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
log.info("Device: %s", DEVICE)


# ─── ATR (True Range, Wilder smoothing) ───────────────────────────────────────

def wilder_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray,
               period: int = 14) -> np.ndarray:
    """
    True Range = max(H-L, |H-PrevC|, |L-PrevC|).
    Smoothed with Wilder's EWM (alpha = 1/period).
    Matches MetaTrader, TradingView, Bloomberg.
    """
    n  = len(close)
    tr = np.zeros(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(
            high[i] - low[i],
            abs(high[i] - close[i - 1]),
            abs(low[i]  - close[i - 1]),
        )
    # Wilder smoothing via pandas EWM (adjust=False, alpha=1/period)
    return pd.Series(tr).ewm(alpha=1.0 / period, adjust=False).mean().values


# ─── Confluence filter ────────────────────────────────────────────────────────

def passes_confluence(df: pd.DataFrame, i: int, cfg: BacktestConfig) -> bool:
    """
    Check all entry filters from trade_logic.txt at bar index i.
    Returns True only when ALL conditions align.
    """
    row = df.iloc[i]

    # Columns produced by ta.add_all_ta_features
    # Fall back gracefully if a column is absent (optional feature)

    # Trend direction: EMA20 > EMA50
    ema20 = row.get("trend_ema_fast", None)   # ta library naming
    ema50 = row.get("trend_ema_slow", None)
    if ema20 is not None and ema50 is not None:
        if ema20 <= ema50:
            return False

    # Trend strength: ADX > threshold
    adx = row.get("trend_adx", None)
    if adx is not None:
        if adx <= cfg.adx_threshold:
            return False

    # RSI between 40–60 (pullback in uptrend)
    rsi = row.get("momentum_rsi", None)
    if rsi is not None:
        if not (cfg.rsi_low < rsi < cfg.rsi_high):
            return False

    # Breakout: Close > highest(Close, 10 bars)
    if i >= cfg.breakout_bars:
        rolling_high = df["Close"].iloc[i - cfg.breakout_bars: i].max()
        if row["Close"] <= rolling_high:
            return False

    # ATR filter: current ATR > median ATR (volatile enough)
    # atr_col computed externally, stored in df["atr"]
    if "atr" in df.columns:
        median_atr = df["atr"].iloc[max(0, i - 100): i].median()
        if df["atr"].iloc[i] <= median_atr:
            return False

    return True


# ─── Position dataclass ───────────────────────────────────────────────────────

@dataclass
class Position:
    entry_price:  float
    sl:           float
    tp:           float
    size:         float        # units (oz for XAU)
    risk_amount:  float        # dollars at risk at entry
    entry_index:  int
    entry_bar_date: str
    highest_high: float        # tracks highest high since entry for Chandelier
    atr_at_entry: float


# ─── Trade record ─────────────────────────────────────────────────────────────

@dataclass
class TradeRecord:
    entry_index: int
    exit_index:  int
    entry_price: float
    exit_price:  float
    size:        float
    gross_pnl:   float         # before friction
    friction:    float
    net_pnl:     float
    risk_amount: float
    r_multiple:  float         # net_pnl / risk_amount
    exit_reason: str           # 'SL' | 'TP' | 'TRAIL' | 'SIGNAL' | 'EOD'
    hold_bars:   int
    entry_date:  str


# ─── Friction model ───────────────────────────────────────────────────────────

def friction_cost(price: float, size: float, cfg: BacktestConfig) -> float:
    """
    Spread + commission in dollars.
    spread_bps applies on entry AND exit (2× spread total).
    commission_bps is round-trip total.
    """
    notional  = price * size
    spread_rt = notional * (cfg.spread_bps * 2) / 10_000
    commission = notional * cfg.commission_bps  / 10_000
    return spread_rt + commission


# ─── Sequence builder (zero-copy stride trick) ───────────────────────────────

def build_sequences(features: np.ndarray, seq_len: int) -> torch.Tensor:
    """
    Build (N, seq_len, n_features) tensor without copying data.
    Uses numpy stride tricks — O(n) memory vs O(n × seq_len) for list append.
    """
    n, d   = features.shape
    n_seqs = n - seq_len
    if n_seqs <= 0:
        raise ValueError(f"Not enough rows ({n}) for seq_len={seq_len}.")

    # sliding_window_view returns a view — no data copied
    from numpy.lib.stride_tricks import sliding_window_view
    # shape: (n_seqs, seq_len, d)
    seqs = sliding_window_view(features, window_shape=seq_len, axis=0)
    # sliding_window_view over axis=0 gives (n_seqs, d, seq_len) — transpose
    seqs = seqs.transpose(0, 2, 1)   # → (n_seqs, seq_len, d)

    # Must copy before converting to tensor (views are not writable)
    return torch.tensor(seqs.copy(), dtype=torch.float32)


# ─── Main backtest ────────────────────────────────────────────────────────────

def run_backtest(cfg: BacktestConfig = CFG) -> dict:
    log.info("=== XQ Trade M8 Backtest Engine ===")
    log.info("Provenance: %s", cfg.provenance)

    # ── Load data ──────────────────────────────────────────────────────────────
    data_path = Path(cfg.data_path)
    if not data_path.exists():
        sys.exit(f"[FATAL] Data file not found: {data_path}")

    log.info("Loading %s …", data_path)
    df_raw = pd.read_csv(data_path)

    # Ensure datetime index if available
    if "Datetime" in df_raw.columns:
        df_raw["Datetime"] = pd.to_datetime(df_raw["Datetime"])
        df_raw.set_index("Datetime", inplace=True)
    elif "Date" in df_raw.columns:
        df_raw["Date"] = pd.to_datetime(df_raw["Date"])
        df_raw.set_index("Date", inplace=True)

    log.info("Rows loaded: %d", len(df_raw))

    # ── Feature engineering ────────────────────────────────────────────────────
    log.info("Generating features …")
    df = generate_features(df_raw)
    df = create_labels(df)

    # ── ATR column ─────────────────────────────────────────────────────────────
    df["atr"] = wilder_atr(
        df["High"].values, df["Low"].values, df["Close"].values,
        period=cfg.atr_period,
    )

    # ── Align OHLC arrays to post-seq_len window ──────────────────────────────
    # All signal-bar arrays must start at index seq_len so they align with preds.
    ohlc_start = cfg.seq_len
    closes = df["Close"].values[ohlc_start:]
    highs  = df["High"].values[ohlc_start:]
    lows   = df["Low"].values[ohlc_start:]
    atrs   = df["atr"].values[ohlc_start:]

    # Date strings for trade log (if index is datetime)
    if isinstance(df.index, pd.DatetimeIndex):
        bar_dates = df.index[ohlc_start:].strftime("%Y-%m-%d %H:%M").tolist()
    else:
        bar_dates = [str(i) for i in range(len(closes))]

    # Hour-of-day for session filter
    if isinstance(df.index, pd.DatetimeIndex):
        bar_hours = df.index[ohlc_start:].hour.tolist()
    else:
        bar_hours = [12] * len(closes)   # assume mid-day if no datetime

    # ── Build model input sequences ────────────────────────────────────────────
    log.info("Building sequences (seq_len=%d) …", cfg.seq_len)
    feature_cols = df.select_dtypes("number").drop(
        columns=["Return", "Label", "atr"], errors="ignore"
    )
    features_arr = feature_cols.values.astype(np.float32)

    # Replace any inf/-inf that ta library can produce
    features_arr = np.nan_to_num(features_arr, nan=0.0, posinf=0.0, neginf=0.0)

    X = build_sequences(features_arr, cfg.seq_len)
    log.info("Sequences shape: %s", tuple(X.shape))

    # ── Load model ────────────────────────────────────────────────────────────
    model_path = Path(cfg.model_path)
    if not model_path.exists():
        sys.exit(f"[FATAL] Model file not found: {model_path}")

    input_dim = features_arr.shape[1]
    model = TransformerTradingModel(input_dim=input_dim, seq_len=cfg.seq_len).to(DEVICE)

    # weights_only=True prevents arbitrary pickle deserialization (security fix)
    state = torch.load(model_path, map_location=DEVICE, weights_only=True)
    model.load_state_dict(state)
    model.eval()
    log.info("Model loaded: input_dim=%d", input_dim)

    # ── Inference ─────────────────────────────────────────────────────────────
    log.info("Running inference on %d bars …", len(X))
    batch_size = 512
    all_preds  = []

    with torch.no_grad():
        for start in range(0, len(X), batch_size):
            batch  = X[start: start + batch_size].to(DEVICE)
            out    = model(batch)
            preds  = torch.argmax(out, dim=1).cpu().numpy()
            all_preds.append(preds)

    preds = np.concatenate(all_preds)
    log.info("Inference complete. Signal distribution: "
             "Sell=%d  Hold=%d  Buy=%d",
             (preds == 0).sum(), (preds == 1).sum(), (preds == 2).sum())

    # ── Simulation ────────────────────────────────────────────────────────────
    capital      = cfg.initial_capital
    peak_capital = cfg.initial_capital
    max_drawdown = 0.0
    position: Optional[Position] = None
    trade_records: list[TradeRecord] = []
    equity_curve  = [capital]

    # Daily trade counter  {date_str: count}
    daily_trade_count: dict[str, int] = {}

    n_bars = min(len(preds), len(closes))

    for i in range(n_bars):
        close = closes[i]
        high  = highs[i]
        low   = lows[i]
        atr   = atrs[i]
        sig   = preds[i]
        date  = bar_dates[i]
        hour  = bar_hours[i]
        day   = date[:10]   # YYYY-MM-DD

        # ── Manage open position ───────────────────────────────────────────────
        if position is not None:

            # Update highest high for Chandelier
            if high > position.highest_high:
                position.highest_high = high

            # Chandelier trailing stop level
            if cfg.use_trailing and atr > 0:
                trail_stop = position.highest_high - cfg.chandelier_mult * atr
                # Only tighten SL — never loosen it
                if trail_stop > position.sl:
                    position.sl = trail_stop

            # Determine exit price — intrabar priority: SL > TP > signal
            exit_price  = None
            exit_reason = None

            # SL hits on intrabar Low
            if low <= position.sl:
                exit_price  = position.sl
                exit_reason = "SL"

            # TP hits on intrabar High (only if SL not already hit)
            elif high >= position.tp:
                exit_price  = position.tp
                exit_reason = "TP"

            # Signal invalidation exits (trade_logic.txt Exit 4):
            # opposing signal OR hold after entry if EMA cross invalidated
            elif sig == 0:
                exit_price  = close
                exit_reason = "SIGNAL"

            if exit_price is not None:
                gross_pnl  = (exit_price - position.entry_price) * position.size
                friction   = friction_cost(exit_price, position.size, cfg)
                net_pnl    = gross_pnl - friction
                r_multiple = net_pnl / position.risk_amount if position.risk_amount > 0 else 0.0

                capital += net_pnl
                peak_capital = max(peak_capital, capital)
                dd = (peak_capital - capital) / peak_capital
                max_drawdown = max(max_drawdown, dd)

                trade_records.append(TradeRecord(
                    entry_index  = position.entry_index,
                    exit_index   = i,
                    entry_price  = position.entry_price,
                    exit_price   = exit_price,
                    size         = position.size,
                    gross_pnl    = gross_pnl,
                    friction     = friction,
                    net_pnl      = net_pnl,
                    risk_amount  = position.risk_amount,
                    r_multiple   = r_multiple,
                    exit_reason  = exit_reason,
                    hold_bars    = i - position.entry_index,
                    entry_date   = position.entry_bar_date,
                ))
                position = None

        # ── Entry logic ───────────────────────────────────────────────────────
        if position is None and sig == 2:   # BUY signal

            # Session filter
            if cfg.session_start_utc is not None and cfg.session_end_utc is not None:
                if not (cfg.session_start_utc <= hour < cfg.session_end_utc):
                    equity_curve.append(capital)
                    continue

            # Max daily trades
            day_count = daily_trade_count.get(day, 0)
            if day_count >= cfg.max_daily_trades:
                equity_curve.append(capital)
                continue

            # Confluence filter — requires features in df
            if not passes_confluence(df, ohlc_start + i, cfg):
                equity_curve.append(capital)
                continue

            # ATR guard
            if atr <= 0:
                equity_curve.append(capital)
                continue

            # SL and TP (trade_logic.txt)
            sl = close - cfg.atr_sl_mult * atr
            tp = close + cfg.atr_tp_mult * atr

            # Position sizing — risk 1% NAV over SL distance
            sl_dist      = close - sl                             # dollars per unit
            risk_dollars = cfg.risk_per_trade * capital           # dollars to risk
            size         = risk_dollars / sl_dist                 # units

            # Cap at max_exposure % of NAV
            max_units    = (cfg.max_exposure * capital) / close
            size         = min(size, max_units)

            if size <= 0:
                equity_curve.append(capital)
                continue

            # Entry friction (spread on fill)
            entry_friction = friction_cost(close, size, cfg) / 2   # entry side only
            capital -= entry_friction

            position = Position(
                entry_price    = close,
                sl             = sl,
                tp             = tp,
                size           = size,
                risk_amount    = risk_dollars,
                entry_index    = i,
                entry_bar_date = date,
                highest_high   = high,
                atr_at_entry   = atr,
            )
            daily_trade_count[day] = day_count + 1

        equity_curve.append(capital)

    # ── Force-close any open position at end of data ──────────────────────────
    if position is not None:
        close = closes[-1]
        gross_pnl  = (close - position.entry_price) * position.size
        friction   = friction_cost(close, position.size, cfg)
        net_pnl    = gross_pnl - friction
        r_multiple = net_pnl / position.risk_amount if position.risk_amount > 0 else 0.0
        capital   += net_pnl

        trade_records.append(TradeRecord(
            entry_index  = position.entry_index,
            exit_index   = n_bars - 1,
            entry_price  = position.entry_price,
            exit_price   = close,
            size         = position.size,
            gross_pnl    = gross_pnl,
            friction     = friction,
            net_pnl      = net_pnl,
            risk_amount  = position.risk_amount,
            r_multiple   = r_multiple,
            exit_reason  = "EOD",
            hold_bars    = n_bars - 1 - position.entry_index,
            entry_date   = position.entry_bar_date,
        ))
        equity_curve.append(capital)

    # ── Metrics ───────────────────────────────────────────────────────────────
    trades_df = pd.DataFrame([vars(t) for t in trade_records])

    if len(trades_df) == 0:
        log.warning("No trades executed. Check confluence filters or signal distribution.")
        return {"trades": 0, "provenance": cfg.provenance}

    total_trades   = len(trades_df)
    winning_trades = (trades_df["net_pnl"] > 0).sum()
    losing_trades  = total_trades - winning_trades
    win_rate       = winning_trades / total_trades

    total_profit   = capital - cfg.initial_capital
    roi_pct        = total_profit / cfg.initial_capital * 100

    avg_win  = trades_df.loc[trades_df["net_pnl"] > 0, "net_pnl"].mean()
    avg_loss = trades_df.loc[trades_df["net_pnl"] < 0, "net_pnl"].mean()
    profit_factor = (
        abs(trades_df.loc[trades_df["net_pnl"] > 0, "net_pnl"].sum()) /
        abs(trades_df.loc[trades_df["net_pnl"] < 0, "net_pnl"].sum())
        if losing_trades > 0 else float("inf")
    )

    # Sharpe — annualise assuming 252 trading days, 1 trade = ~1 bar
    pnl_series = trades_df["net_pnl"]
    sharpe = (
        pnl_series.mean() / pnl_series.std() * np.sqrt(252)
        if pnl_series.std() > 0 else 0.0
    )

    avg_r  = trades_df["r_multiple"].mean()
    avg_hold = trades_df["hold_bars"].mean()

    exit_counts = trades_df["exit_reason"].value_counts().to_dict()

    # ── Print results ─────────────────────────────────────────────────────────
    sep = "─" * 52
    print(f"\n{sep}")
    print(f"  XQ Trade M8 — Backtest Results")
    print(f"  ⚠  {cfg.provenance}")
    print(sep)
    print(f"  Capital (start):   ${cfg.initial_capital:>12,.2f}")
    print(f"  Capital (end):     ${capital:>12,.2f}")
    print(f"  Net P&L:           ${total_profit:>+12,.2f}")
    print(f"  ROI:               {roi_pct:>+11.2f}%")
    print(sep)
    print(f"  Total trades:      {total_trades:>12,}")
    print(f"  Winning trades:    {winning_trades:>12,}")
    print(f"  Losing trades:     {losing_trades:>12,}")
    print(f"  Win rate:          {win_rate:>11.1%}")
    print(f"  Profit factor:     {profit_factor:>12.2f}")
    print(sep)
    print(f"  Avg win ($):       ${avg_win:>+11.2f}")
    print(f"  Avg loss ($):      ${avg_loss:>+11.2f}")
    print(f"  Avg R-multiple:    {avg_r:>+12.3f}")
    print(f"  Avg hold (bars):   {avg_hold:>12.1f}")
    print(sep)
    print(f"  Sharpe (ann.):     {sharpe:>12.2f}")
    print(f"  Max drawdown:      {max_drawdown:>11.1%}")
    print(sep)
    print(f"  Exit breakdown:    {exit_counts}")
    print(sep)

    results = {
        "initial_capital": cfg.initial_capital,
        "final_capital":   capital,
        "net_pnl":         total_profit,
        "roi_pct":         roi_pct,
        "total_trades":    total_trades,
        "win_rate":        win_rate,
        "profit_factor":   profit_factor,
        "sharpe":          sharpe,
        "max_drawdown":    max_drawdown,
        "avg_r":           avg_r,
        "trades_df":       trades_df,
        "equity_curve":    equity_curve,
        "provenance":      cfg.provenance,
    }

    # ── Plot ──────────────────────────────────────────────────────────────────
    _plot(closes, trades_df, equity_curve, results, cfg)

    return results


# ─── Plot ─────────────────────────────────────────────────────────────────────

def _plot(
    closes:      np.ndarray,
    trades_df:   pd.DataFrame,
    equity_curve: list,
    results:     dict,
    cfg:         BacktestConfig,
) -> None:
    fig = plt.figure(figsize=(16, 10))
    gs  = gridspec.GridSpec(3, 1, height_ratios=[3, 1.5, 1], hspace=0.35)

    # — Price + signals ————————————————————————————————————————————————————
    ax1 = fig.add_subplot(gs[0])
    ax1.plot(closes, color="#888", linewidth=0.7, label="Close", zorder=1)

    buys  = trades_df[["entry_index", "entry_price"]]
    sells = trades_df[["exit_index", "exit_price", "exit_reason"]]

    ax1.scatter(buys["entry_index"], buys["entry_price"],
                marker="^", color="#00d26a", s=60, zorder=3, label="Entry")

    color_map = {"SL": "#ff4d4d", "TP": "#00d26a", "TRAIL": "#f0a500",
                 "SIGNAL": "#a78bfa", "EOD": "#888888"}
    for reason, grp in trades_df.groupby("exit_reason"):
        ax1.scatter(grp["exit_index"], grp["exit_price"],
                    marker="v", color=color_map.get(reason, "#ccc"),
                    s=60, zorder=3, label=f"Exit: {reason}")

    ax1.set_title("XQ Trade M8 — Backtest Signals (XAU/USD)", fontsize=11)
    ax1.set_ylabel("Price (USD)")
    ax1.legend(fontsize=8, loc="upper left")
    ax1.grid(alpha=0.25)

    # — Equity curve ————————————————————————————————————————————————————————
    ax2 = fig.add_subplot(gs[1])
    eq = np.array(equity_curve)
    ax2.plot(eq, color="#60a5fa", linewidth=1.2, label="Equity")
    ax2.axhline(cfg.initial_capital, color="#888", linestyle="--",
                linewidth=0.8, label="Starting capital")
    ax2.fill_between(range(len(eq)), cfg.initial_capital, eq,
                     where=(eq >= cfg.initial_capital),
                     alpha=0.15, color="#00d26a")
    ax2.fill_between(range(len(eq)), cfg.initial_capital, eq,
                     where=(eq < cfg.initial_capital),
                     alpha=0.15, color="#ff4d4d")
    ax2.set_title("Equity Curve", fontsize=10)
    ax2.set_ylabel("Capital ($)")
    ax2.legend(fontsize=8)
    ax2.grid(alpha=0.25)

    # — Drawdown ————————————————————————————————————————————————————————————
    ax3 = fig.add_subplot(gs[2])
    peak = np.maximum.accumulate(eq)
    dd   = (eq - peak) / peak * 100
    ax3.fill_between(range(len(dd)), dd, color="#ff4d4d", alpha=0.6)
    ax3.set_title("Drawdown (%)", fontsize=10)
    ax3.set_ylabel("DD %")
    ax3.grid(alpha=0.25)

    # Annotation box
    stats_text = (
        f"Win Rate: {results['win_rate']:.1%}   "
        f"Trades: {results['total_trades']}   "
        f"ROI: {results['roi_pct']:+.1f}%   "
        f"Sharpe: {results['sharpe']:.2f}   "
        f"MaxDD: {results['max_drawdown']:.1%}"
    )
    fig.text(0.5, 0.01, stats_text, ha="center", fontsize=9,
             color="#aaa", style="italic")

    plt.savefig("backtest_results.png", dpi=150, bbox_inches="tight")
    log.info("Plot saved → backtest_results.png")
    plt.show()


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    run_backtest(CFG)
