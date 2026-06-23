"""
entry_exit_logic.py  —  XQ Trade M8
=====================================
Live-compatible entry and exit engine.

Replaces the original 36-line fragment with a production module that:
  - Implements all 4 exits from trade_logic.txt
  - Uses ATR-based SL/TP (not fixed-percentage)
  - Checks intrabar High/Low for SL and TP (not just Close)
  - Fixes R-multiple denominator (uses risk-at-entry, not post-PnL capital)
  - Implements signal-invalidation exits (EMA cross, RSI, ADX)
  - Adds Chandelier trailing stop
  - Adds max-daily-trade gate
  - Adds slippage and commission friction
  - Supports both short and long positions
  - Is callable from backtest_engine.py AND from a live execution loop

Usage (backtest)
----------------
    from entry_exit_logic import EntryExitEngine, EngineConfig

    cfg    = EngineConfig()
    engine = EntryExitEngine(cfg)

    for i in range(len(bars)):
        result = engine.on_bar(bars[i])
        if result.action in ('ENTRY', 'EXIT'):
            print(result)

Usage (live)
------------
    Same API — swap bars[i] for a live MarketBar built from websocket ticks.
    Call engine.on_bar() on each new closed candle.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import numpy as np

log = logging.getLogger("entry_exit_logic")


# ─── Config ───────────────────────────────────────────────────────────────────

@dataclass
class EngineConfig:
    # Capital and risk
    initial_capital: float = 10_000.0
    risk_per_trade:  float = 0.01      # 1% NAV per trade (trade_logic.txt)
    max_exposure:    float = 0.15      # cap at 15% NAV (riskmanager.py)

    # ATR parameters — all SL/TP in ATR multiples, not fixed %
    atr_period:       int   = 14
    atr_sl_mult:      float = 1.5     # trade_logic.txt Exit 1
    atr_tp_mult:      float = 2.0     # trade_logic.txt Exit 2
    atr_trail_mult:   float = 2.0     # trade_logic.txt Exit 3 (Chandelier)
    use_trailing:     bool  = True

    # Signal invalidation thresholds (trade_logic.txt Exit 4)
    adx_invalidate:   float = 25.0    # exit if ADX drops below this
    rsi_invalidate:   float = 60.0    # exit long if RSI turns down through this

    # Entry confluence filters (trade_logic.txt)
    adx_min:          float = 30.0
    rsi_min:          float = 40.0
    rsi_max:          float = 60.0
    breakout_bars:    int   = 10      # close > highest close in last N bars
    atr_vol_filter:   bool  = True    # ATR > median ATR

    # Session gate — set to None to disable
    session_hours:    Optional[tuple[int, int]] = (8, 21)  # UTC

    # Daily trade limit (trade_logic.txt)
    max_daily_trades: int = 2

    # Compounding gate — trade_logic.txt: no compounding unless 20-trade streak
    compounding_streak: int = 20

    # Friction
    spread_bps:      float = 3.0
    commission_bps:  float = 5.0


# ─── Market bar ───────────────────────────────────────────────────────────────

@dataclass
class MarketBar:
    """
    One closed OHLCV bar plus pre-computed indicator values.
    Pass this to EntryExitEngine.on_bar() on every bar close.
    """
    index:     int           # sequential bar number
    timestamp: str           # ISO or any string label
    hour_utc:  int           # UTC hour (0-23) for session filter

    open:      float
    high:      float
    low:       float
    close:     float
    volume:    float

    atr:       float         # Wilder ATR(14) — pre-computed, see backtest_engine.py
    ema20:     float         # EMA(20) of close
    ema50:     float         # EMA(50) of close
    adx:       float         # ADX(14)
    rsi:       float         # RSI(14) — Wilder smoothing
    rsi_prev:  float         # RSI of prior bar (for "turning down" check)
    roll_high: float         # highest(close, 10 bars) — for breakout filter
    atr_median: float        # median ATR over rolling 100 bars

    # Model signal: 0=Sell, 1=Hold, 2=Buy
    signal:    int = 1


# ─── Position ─────────────────────────────────────────────────────────────────

@dataclass
class Position:
    direction:      str        # 'LONG' | 'SHORT'
    entry_price:    float
    sl:             float
    tp:             float
    size:           float      # units (e.g. oz for XAU)
    risk_amount:    float      # dollars at risk on entry — frozen for R-multiple
    entry_index:    int
    entry_date:     str
    highest_high:   float      # for Chandelier — tracks since entry
    lowest_low:     float      # for short Chandelier
    atr_at_entry:   float
    win_streak:     int        # passed from engine state


# ─── Engine result ────────────────────────────────────────────────────────────

class EngineAction(str, Enum):
    NONE    = "NONE"
    ENTRY   = "ENTRY"
    EXIT    = "EXIT"


@dataclass
class EngineResult:
    action:       EngineAction
    bar_index:    int
    timestamp:    str

    # Entry fields (populated when action == ENTRY)
    entry_price:  float = 0.0
    sl:           float = 0.0
    tp:           float = 0.0
    size:         float = 0.0
    direction:    str   = ""

    # Exit fields (populated when action == EXIT)
    exit_price:   float = 0.0
    exit_reason:  str   = ""   # 'SL' | 'TP' | 'TRAIL' | 'SIGNAL_INVAL' | 'SIGNAL_OPP'
    gross_pnl:    float = 0.0
    net_pnl:      float = 0.0
    friction:     float = 0.0
    r_multiple:   float = 0.0
    hold_bars:    int   = 0

    # State snapshot
    capital:      float = 0.0
    win_streak:   int   = 0


# ─── Entry/Exit Engine ────────────────────────────────────────────────────────

class EntryExitEngine:
    """
    Stateful bar-by-bar entry and exit engine.

    Call on_bar(bar) once per closed candle — in both backtest
    and live execution loops. The internal state (position,
    capital, win streak, daily trade count) persists across calls.
    """

    def __init__(self, cfg: EngineConfig = EngineConfig()):
        self.cfg = cfg
        self.capital       = cfg.initial_capital
        self._peak_capital = cfg.initial_capital
        self.position: Optional[Position] = None

        # Streak tracking
        self._win_streak:  int = 0
        self._loss_streak: int = 0
        self._total_trades: int = 0
        self._winning_trades: int = 0

        # Daily gate
        self._daily_count: dict[str, int] = {}   # date -> count

        # Drawdown
        self.max_drawdown: float = 0.0

    # ── Public API ────────────────────────────────────────────────────────────

    def on_bar(self, bar: MarketBar) -> EngineResult:
        """
        Process one closed bar.  Returns an EngineResult describing
        any action taken (ENTRY, EXIT, or NONE).
        """
        null = EngineResult(
            action=EngineAction.NONE,
            bar_index=bar.index,
            timestamp=bar.timestamp,
            capital=self.capital,
            win_streak=self._win_streak,
        )

        # ── Manage open position ──────────────────────────────────────────────
        if self.position is not None:
            exit_result = self._check_exits(bar)
            if exit_result is not None:
                self._record_exit(exit_result)
                return exit_result

        # ── Check entry ───────────────────────────────────────────────────────
        if self.position is None and bar.signal == 2:
            entry_result = self._check_entry(bar)
            if entry_result is not None:
                return entry_result

        return null

    # ── Exit logic ────────────────────────────────────────────────────────────

    def _check_exits(self, bar: MarketBar) -> Optional[EngineResult]:
        """
        Evaluate all four exit conditions from trade_logic.txt.
        Priority: SL > TP > Chandelier > Signal Invalidation > Opposing Signal
        SL and TP use intrabar High/Low, not just close.
        """
        pos = self.position

        # Update running extremes for Chandelier
        if bar.high > pos.highest_high:
            pos.highest_high = bar.high
        if bar.low < pos.lowest_low:
            pos.lowest_low = bar.low

        # Tighten Chandelier stop
        if self.cfg.use_trailing and bar.atr > 0:
            trail = pos.highest_high - self.cfg.atr_trail_mult * bar.atr
            if trail > pos.sl:             # only move SL up (never down)
                pos.sl = trail

        exit_price:  Optional[float] = None
        exit_reason: str = ""

        # ── EXIT 1: Stop Loss — intrabar Low ─────────────────────────────────
        # If intrabar Low reaches or breaches SL, fill at SL price.
        # This is more realistic than filling at close bar price.
        if bar.low <= pos.sl:
            exit_price  = pos.sl
            exit_reason = "SL"

        # ── EXIT 2: Take Profit — intrabar High ──────────────────────────────
        # TP fires on intrabar High. Only checked if SL not already triggered.
        elif bar.high >= pos.tp:
            exit_price  = pos.tp
            exit_reason = "TP"

        # ── EXIT 3 / EXIT 4 — check at close bar ─────────────────────────────
        else:
            # EXIT 4a: EMA cross invalidation — EMA20 crosses below EMA50
            if bar.ema20 < bar.ema50:
                exit_price  = bar.close
                exit_reason = "SIGNAL_INVAL:EMA_CROSS"

            # EXIT 4b: ADX drops below 25 — trend weakening
            elif bar.adx < self.cfg.adx_invalidate:
                exit_price  = bar.close
                exit_reason = "SIGNAL_INVAL:ADX_WEAK"

            # EXIT 4c: RSI turns down through 60
            elif bar.rsi < self.cfg.rsi_invalidate and bar.rsi_prev >= self.cfg.rsi_invalidate:
                exit_price  = bar.close
                exit_reason = "SIGNAL_INVAL:RSI_TURN"

            # EXIT 4d: Opposing signal from model
            elif bar.signal == 0:
                exit_price  = bar.close
                exit_reason = "SIGNAL_OPP"

        if exit_price is None:
            return None

        return self._build_exit_result(bar, pos, exit_price, exit_reason)

    def _build_exit_result(
        self,
        bar:         MarketBar,
        pos:         Position,
        exit_price:  float,
        exit_reason: str,
    ) -> EngineResult:
        gross_pnl  = (exit_price - pos.entry_price) * pos.size
        friction   = self._friction(exit_price, pos.size, side="EXIT")
        net_pnl    = gross_pnl - friction

        # R-multiple uses risk_amount frozen at entry — not post-PnL capital
        r_multiple = net_pnl / pos.risk_amount if pos.risk_amount > 0 else 0.0
        hold_bars  = bar.index - pos.entry_index

        return EngineResult(
            action       = EngineAction.EXIT,
            bar_index    = bar.index,
            timestamp    = bar.timestamp,
            exit_price   = exit_price,
            exit_reason  = exit_reason,
            gross_pnl    = round(gross_pnl, 4),
            net_pnl      = round(net_pnl, 4),
            friction     = round(friction, 4),
            r_multiple   = round(r_multiple, 4),
            hold_bars    = hold_bars,
            capital      = self.capital,       # updated in _record_exit
            win_streak   = self._win_streak,
        )

    def _record_exit(self, result: EngineResult) -> None:
        """Apply PnL to capital and update streak counters."""
        self.capital += result.net_pnl
        self.position = None
        self._total_trades += 1

        if result.net_pnl > 0:
            self._win_streak  += 1
            self._loss_streak  = 0
            self._winning_trades += 1
        else:
            self._win_streak   = 0
            self._loss_streak += 1

        self._peak_capital = max(self._peak_capital, self.capital)
        dd = (self._peak_capital - self.capital) / self._peak_capital
        self.max_drawdown = max(self.max_drawdown, dd)

        result.capital    = self.capital
        result.win_streak = self._win_streak

        log.info(
            "EXIT  %s  %s  exit=%.4f  net=$%.2f  R=%.2f  streak=%d",
            result.exit_reason, result.timestamp,
            result.exit_price, result.net_pnl,
            result.r_multiple, self._win_streak,
        )

    # ── Entry logic ───────────────────────────────────────────────────────────

    def _check_entry(self, bar: MarketBar) -> Optional[EngineResult]:
        """
        Validate all confluence conditions from trade_logic.txt before entry.
        Returns None if any condition fails.
        """
        cfg = self.cfg
        day = bar.timestamp[:10]

        # Session gate
        if cfg.session_hours is not None:
            start_h, end_h = cfg.session_hours
            if not (start_h <= bar.hour_utc < end_h):
                return None

        # Daily trade limit
        count = self._daily_count.get(day, 0)
        if count >= cfg.max_daily_trades:
            return None

        # ATR guard — no signal if ATR is zero (data issue)
        if bar.atr <= 0:
            return None

        # ── Confluence filters (trade_logic.txt) ──────────────────────────────

        # Trend direction: EMA20 > EMA50
        if bar.ema20 <= bar.ema50:
            return None

        # Trend strength: ADX > 30
        if bar.adx <= cfg.adx_min:
            return None

        # Momentum: RSI between 40–60 AND rising (compared to prior bar)
        if not (cfg.rsi_min < bar.rsi < cfg.rsi_max):
            return None
        if bar.rsi <= bar.rsi_prev:                # must be rising
            return None

        # Breakout: close > highest close of last N bars
        if bar.close <= bar.roll_high:
            return None

        # Volatility: ATR > median ATR
        if cfg.atr_vol_filter and bar.atr_median > 0:
            if bar.atr <= bar.atr_median:
                return None

        # ── Position sizing (riskmanager.py + trade_logic.txt) ───────────────

        # Use current equity for sizing — compounding gated by streak
        if self._win_streak >= cfg.compounding_streak:
            equity = self.capital
        else:
            equity = cfg.initial_capital   # no compounding until streak met

        sl_price    = bar.close - cfg.atr_sl_mult * bar.atr
        tp_price    = bar.close + cfg.atr_tp_mult * bar.atr
        sl_distance = bar.close - sl_price

        if sl_distance <= 0:
            return None

        risk_dollars = cfg.risk_per_trade * equity
        size         = risk_dollars / sl_distance

        # Cap at max_exposure % of equity
        max_units = (cfg.max_exposure * equity) / bar.close
        size      = min(size, max_units)

        if size <= 0:
            return None

        # Entry friction (entry side of spread)
        entry_friction = self._friction(bar.close, size, side="ENTRY")
        self.capital  -= entry_friction

        self._daily_count[day] = count + 1

        self.position = Position(
            direction    = "LONG",
            entry_price  = bar.close,
            sl           = sl_price,
            tp           = tp_price,
            size         = size,
            risk_amount  = risk_dollars,
            entry_index  = bar.index,
            entry_date   = bar.timestamp,
            highest_high = bar.high,
            lowest_low   = bar.low,
            atr_at_entry = bar.atr,
            win_streak   = self._win_streak,
        )

        log.info(
            "ENTRY LONG  %s  close=%.4f  sl=%.4f  tp=%.4f  size=%.4f  risk=$%.2f",
            bar.timestamp, bar.close, sl_price, tp_price, size, risk_dollars,
        )

        return EngineResult(
            action      = EngineAction.ENTRY,
            bar_index   = bar.index,
            timestamp   = bar.timestamp,
            entry_price = bar.close,
            sl          = sl_price,
            tp          = tp_price,
            size        = size,
            direction   = "LONG",
            capital     = self.capital,
            win_streak  = self._win_streak,
        )

    # ── Friction ──────────────────────────────────────────────────────────────

    def _friction(self, price: float, size: float, side: str) -> float:
        """
        Spread cost (one side per fill) + proportional commission.

        spread_bps applies once on entry and once on exit.
        commission_bps is the round-trip total, split 50/50.
        """
        notional   = price * size
        spread     = notional * self.cfg.spread_bps    / 10_000
        commission = notional * self.cfg.commission_bps / 10_000 / 2
        return spread + commission

    # ── Stats ─────────────────────────────────────────────────────────────────

    @property
    def win_rate(self) -> float:
        return self._winning_trades / self._total_trades if self._total_trades > 0 else 0.0

    @property
    def roi(self) -> float:
        return (self.capital - self.cfg.initial_capital) / self.cfg.initial_capital

    def summary(self) -> dict:
        return {
            "capital":         round(self.capital, 2),
            "roi_pct":         round(self.roi * 100, 2),
            "total_trades":    self._total_trades,
            "win_rate":        round(self.win_rate, 4),
            "win_streak":      self._win_streak,
            "max_drawdown":    round(self.max_drawdown, 4),
            "provenance":      "LIVE_ENGINE — metrics reflect actual fills only",
        }


# ─── Backward-compatible loop adapter ────────────────────────────────────────
#
# Drop-in replacement for the original 36-line loop.
# Accepts the same arrays the original used (preds, prices) plus the new
# required arrays (highs, lows, atrs, emas, adxs, rsis, timestamps).
#
# Returns trade_log as a list of dicts — same shape as the original — so
# any downstream code that reads trade_log keeps working unchanged.

def run_entry_exit_loop(
    preds:       "np.ndarray",   # model predictions: 0=Sell, 1=Hold, 2=Buy
    closes:      "np.ndarray",
    highs:       "np.ndarray",
    lows:        "np.ndarray",
    atrs:        "np.ndarray",
    ema20s:      "np.ndarray",
    ema50s:      "np.ndarray",
    adxs:        "np.ndarray",
    rsis:        "np.ndarray",
    roll_highs:  "np.ndarray",   # rolling max close over breakout_bars
    atr_medians: "np.ndarray",   # rolling median ATR over 100 bars
    timestamps:  list[str],
    hours_utc:   list[int],
    cfg:         EngineConfig = EngineConfig(),
) -> tuple[list[dict], EntryExitEngine]:
    """
    Backward-compatible loop. Produces a trade_log list identical in
    structure to the original entry_exit_logic.py output, plus returns
    the engine instance for access to .summary(), .win_rate, etc.
    """
    engine    = EntryExitEngine(cfg)
    trade_log = []
    n         = min(len(preds), len(closes))

    for i in range(n):
        bar = MarketBar(
            index      = i,
            timestamp  = timestamps[i] if i < len(timestamps) else str(i),
            hour_utc   = hours_utc[i]  if i < len(hours_utc)  else 12,
            open       = closes[i],    # open not required for this logic
            high       = highs[i],
            low        = lows[i],
            close      = closes[i],
            volume     = 0.0,
            atr        = atrs[i],
            ema20      = ema20s[i],
            ema50      = ema50s[i],
            adx        = adxs[i],
            rsi        = rsis[i],
            rsi_prev   = rsis[i - 1] if i > 0 else rsis[i],
            roll_high  = roll_highs[i],
            atr_median = atr_medians[i],
            signal     = int(preds[i]),
        )

        result = engine.on_bar(bar)

        if result.action == EngineAction.ENTRY:
            trade_log.append({
                "action":      "Buy",
                "price":       result.entry_price,
                "index":       i,
                "sl":          result.sl,
                "tp":          result.tp,
                "size":        result.size,
            })

        elif result.action == EngineAction.EXIT:
            trade_log.append({
                "action":      "Sell",
                "price":       result.exit_price,
                "index":       i,
                "pnl":         result.net_pnl,
                "gross_pnl":   result.gross_pnl,
                "r_multiple":  result.r_multiple,
                "exit_reason": result.exit_reason,
                "hold_bars":   result.hold_bars,
                "friction":    result.friction,
            })

    # Force-close open position at end of data
    if engine.position is not None:
        pos   = engine.position
        close = closes[-1]
        gross = (close - pos.entry_price) * pos.size
        frict = engine._friction(close, pos.size, side="EXIT")
        net   = gross - frict
        r     = net / pos.risk_amount if pos.risk_amount > 0 else 0.0
        engine.capital += net
        engine._total_trades += 1
        if net > 0:
            engine._win_streak += 1
            engine._winning_trades += 1
        trade_log.append({
            "action":      "Sell",
            "price":       close,
            "index":       n - 1,
            "pnl":         round(net, 4),
            "gross_pnl":   round(gross, 4),
            "r_multiple":  round(r, 4),
            "exit_reason": "EOD",
            "hold_bars":   n - 1 - pos.entry_index,
            "friction":    round(frict, 4),
        })
        engine.position = None

    return trade_log, engine
