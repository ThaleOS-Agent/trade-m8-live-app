"""
riskmanager.py  —  XQ Trade M8
=================================
Position sizing, SL/TP calculation, and daily risk gates.

Replaces the MATLAB stub (riskmanager.py) with a production Python module.

Changes vs MATLAB original
---------------------------
1.  ATR — uses True Range (max of 3 components), not H-L range only.
    Overnight gaps on XAU/USD and forex make H-PrevClose > H-L regularly.
    Understated ATR from H-L → SL too tight → stop-outs on normal noise.
2.  Position size — float, not floor(). floor() truncates 0.9 oz to 0 oz
    on XAU/USD at $2,324/oz.  Minimum size floor is 0.01 units.
3.  TP — matches trade_logic.txt exactly: entry + 2.0 × ATR.
    Original MATLAB used rrRatio × SL_distance (= 3.0 ATR when SL=1.5 ATR).
4.  Daily loss gate — tracks realised P&L per day.  Blocks new entries
    when daily loss exceeds MAX_DAILY_LOSS_PCT.
5.  Max trades/day gate — blocks new entries when daily count is reached.
6.  Stateless sizing function — pure function for use in backtest loops.
7.  Stateful RiskManager class — for live execution where session state
    must persist across bar events.

Usage (stateless — backtest)
-----------------------------
    from riskmanager import size_position, SizingResult

    result = size_position(
        entry_price = 2324.50,
        high_arr    = df['High'].values,
        low_arr     = df['Low'].values,
        close_arr   = df['Close'].values,
        equity      = 10_000,
    )
    if result.approved:
        sl, tp, units = result.sl, result.tp, result.units

Usage (stateful — live)
------------------------
    from riskmanager import RiskManager

    rm = RiskManager(initial_equity=10_000)
    result = rm.evaluate(entry_price, df)
    if result.approved:
        rm.open_trade(result)
    # After close:
    rm.close_trade(pnl=+42.30)
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

import numpy as np

log = logging.getLogger("riskmanager")

# ─── Config (env-overridable) ─────────────────────────────────────────────────

ATR_PERIOD         = int(float(os.getenv("ATR_PERIOD",       "14")))
ATR_SL_MULT        = float(os.getenv("ATR_SL_MULT",          "1.5"))   # trade_logic.txt Exit 1
ATR_TP_MULT        = float(os.getenv("ATR_TP_MULT",          "2.0"))   # trade_logic.txt Exit 2
RISK_PER_TRADE     = float(os.getenv("RISK_PER_TRADE",       "0.01"))  # 1% NAV
MAX_EXPOSURE       = float(os.getenv("MAX_EXPOSURE",         "0.15"))  # 15% NAV cap
MAX_DAILY_LOSS_PCT = float(os.getenv("MAX_DAILY_LOSS_PCT",   "0.03"))  # 3% daily gate
MAX_DAILY_TRADES   = int(float(os.getenv("MAX_DAILY_TRADES", "2")))    # trade_logic.txt
CONF_FLOOR         = float(os.getenv("CONF_FLOOR",           "0.65"))  # minimum signal confidence


# ─── ATR (True Range, Wilder EWM) ─────────────────────────────────────────────

def _wilder_atr(
    high:  np.ndarray,
    low:   np.ndarray,
    close: np.ndarray,
    period: int = 14,
) -> float:
    """
    Compute the most recent ATR value using Wilder's smoothing.

    Uses True Range = max(H-L, |H-PrevC|, |L-PrevC|).
    The MATLAB original used H-L only — which understates ATR by
    ignoring overnight gaps.

    Returns the last (current) ATR value.
    """
    if len(high) < period + 1:
        # Fallback: plain average of H-L range if insufficient history
        return float(np.mean(high[-period:] - low[-period:]))

    tr = np.maximum.reduce([
        high[1:] - low[1:],
        np.abs(high[1:] - close[:-1]),
        np.abs(low[1:]  - close[:-1]),
    ])

    # Wilder smoothing: EWM with alpha = 1/period
    alpha = 1.0 / period
    atr   = tr[0]
    for val in tr[1:]:
        atr = alpha * val + (1 - alpha) * atr
    return float(atr)


# ─── Result dataclass ─────────────────────────────────────────────────────────

@dataclass
class SizingResult:
    approved:      bool
    units:         float         # position size (oz, lots, contracts…)
    sl:            float         # stop-loss price
    tp:            float         # take-profit price
    atr:           float         # ATR used for sizing
    risk_amount:   float         # dollars at risk on this trade
    reject_reason: Optional[str] = None

    def __str__(self) -> str:
        if not self.approved:
            return f"SizingResult: REJECTED — {self.reject_reason}"
        return (
            f"SizingResult: APPROVED  units={self.units:.4f}  "
            f"sl={self.sl:.4f}  tp={self.tp:.4f}  "
            f"ATR={self.atr:.4f}  risk=${self.risk_amount:.2f}"
        )


# ─── Stateless sizing function ────────────────────────────────────────────────

def size_position(
    entry_price:  float,
    high_arr:     np.ndarray,
    low_arr:      np.ndarray,
    close_arr:    np.ndarray,
    equity:       float,
    side:         str = "LONG",
    confidence:   float = 1.0,
    atr_period:   int   = ATR_PERIOD,
    sl_mult:      float = ATR_SL_MULT,
    tp_mult:      float = ATR_TP_MULT,
    risk_pct:     float = RISK_PER_TRADE,
    max_exposure: float = MAX_EXPOSURE,
    conf_floor:   float = CONF_FLOOR,
) -> SizingResult:
    """
    Pure function — compute position size, SL, and TP.

    Parameters
    ----------
    entry_price  : current bar close / intended fill price
    high_arr     : numpy array of High prices (at least atr_period+1 elements)
    low_arr      : numpy array of Low prices
    close_arr    : numpy array of Close prices
    equity       : current account equity in USD
    side         : "LONG" | "SHORT"
    confidence   : signal confidence (0–1); rejected if below conf_floor
    atr_period   : ATR lookback period
    sl_mult      : SL = entry ± sl_mult × ATR
    tp_mult      : TP = entry ± tp_mult × ATR  (trade_logic.txt: 2.0)
    risk_pct     : fraction of equity to risk per trade
    max_exposure : maximum fraction of equity in a single position
    conf_floor   : minimum confidence to approve trade

    Returns
    -------
    SizingResult
    """
    # Gate: confidence
    if confidence < conf_floor:
        return SizingResult(
            False, 0, 0, 0, 0, 0,
            f"Confidence {confidence:.2%} < floor {conf_floor:.2%}",
        )

    # Gate: ATR guard
    atr = _wilder_atr(high_arr, low_arr, close_arr, atr_period)
    if atr <= 0:
        return SizingResult(False, 0, 0, 0, 0, 0, "ATR is zero — insufficient price data")

    # SL and TP — matches trade_logic.txt exactly
    if side == "LONG":
        sl = entry_price - sl_mult * atr
        tp = entry_price + tp_mult * atr
    else:
        sl = entry_price + sl_mult * atr
        tp = entry_price - tp_mult * atr

    sl_distance = abs(entry_price - sl)
    if sl_distance <= 0:
        return SizingResult(False, 0, sl, tp, atr, 0, "SL distance is zero")

    # Position sizing
    risk_dollars = risk_pct * equity
    raw_units    = risk_dollars / sl_distance

    # Cap at max_exposure × equity / entry_price
    max_units    = (max_exposure * equity) / entry_price
    units        = min(raw_units, max_units)
    units        = max(units, 0.0)

    if units < 0.001:
        return SizingResult(
            False, 0, sl, tp, atr, risk_dollars,
            f"Units {units:.6f} below minimum 0.001 — position too small for risk params",
        )

    log.info(
        "SIZE APPROVED: side=%s  units=%.4f  sl=%.4f  tp=%.4f  ATR=%.4f  risk=$%.2f",
        side, units, sl, tp, atr, risk_dollars,
    )
    return SizingResult(True, round(units, 6), round(sl, 5), round(tp, 5),
                        round(atr, 5), round(risk_dollars, 2))


# ─── Stateful RiskManager class ───────────────────────────────────────────────

@dataclass
class _DayStats:
    date_str:     str
    realised_pnl: float = 0.0
    trade_count:  int   = 0


class RiskManager:
    """
    Stateful risk manager for live execution.

    Maintains daily P&L and trade count across bar events.
    Call open_trade() when an entry is approved, close_trade() on exit.

    Thread-safety: not thread-safe — use one instance per symbol/bot.
    """

    def __init__(
        self,
        initial_equity:    float = 10_000.0,
        risk_pct:          float = RISK_PER_TRADE,
        max_exposure:      float = MAX_EXPOSURE,
        max_daily_loss_pct: float = MAX_DAILY_LOSS_PCT,
        max_daily_trades:  int   = MAX_DAILY_TRADES,
        conf_floor:        float = CONF_FLOOR,
        atr_period:        int   = ATR_PERIOD,
        sl_mult:           float = ATR_SL_MULT,
        tp_mult:           float = ATR_TP_MULT,
    ):
        self.equity              = initial_equity
        self.initial_equity      = initial_equity
        self.risk_pct            = risk_pct
        self.max_exposure        = max_exposure
        self.max_daily_loss_pct  = max_daily_loss_pct
        self.max_daily_trades    = max_daily_trades
        self.conf_floor          = conf_floor
        self.atr_period          = atr_period
        self.sl_mult             = sl_mult
        self.tp_mult             = tp_mult

        self._open_count: int = 0
        self._day: Optional[_DayStats] = None
        self._total_trades:  int = 0
        self._winning_trades: int = 0

    # ── Day state ──────────────────────────────────────────────────────────────

    def _today(self) -> _DayStats:
        today_str = date.today().isoformat()
        if self._day is None or self._day.date_str != today_str:
            self._day = _DayStats(date_str=today_str)
        return self._day

    # ── Core evaluation ────────────────────────────────────────────────────────

    def evaluate(
        self,
        entry_price: float,
        high_arr:    np.ndarray,
        low_arr:     np.ndarray,
        close_arr:   np.ndarray,
        side:        str   = "LONG",
        confidence:  float = 1.0,
    ) -> SizingResult:
        """
        Evaluate a potential trade entry.  Returns SizingResult.
        Checks daily gates before delegating to size_position().
        """
        today = self._today()

        # Daily loss gate
        threshold = -self.max_daily_loss_pct * self.equity
        if today.realised_pnl <= threshold:
            return SizingResult(
                False, 0, 0, 0, 0, 0,
                f"Daily loss gate: {today.realised_pnl:.2f} ≤ {threshold:.2f}",
            )

        # Daily trade count gate
        if today.trade_count >= self.max_daily_trades:
            return SizingResult(
                False, 0, 0, 0, 0, 0,
                f"Daily trade limit reached: {today.trade_count}/{self.max_daily_trades}",
            )

        return size_position(
            entry_price  = entry_price,
            high_arr     = high_arr,
            low_arr      = low_arr,
            close_arr    = close_arr,
            equity       = self.equity,
            side         = side,
            confidence   = confidence,
            atr_period   = self.atr_period,
            sl_mult      = self.sl_mult,
            tp_mult      = self.tp_mult,
            risk_pct     = self.risk_pct,
            max_exposure = self.max_exposure,
            conf_floor   = self.conf_floor,
        )

    # ── Trade lifecycle ────────────────────────────────────────────────────────

    def open_trade(self, result: SizingResult) -> None:
        """Record that an approved trade has been sent to the exchange."""
        if not result.approved:
            raise ValueError("Cannot open_trade on a rejected SizingResult.")
        self._open_count += 1
        self._today().trade_count += 1
        log.info("Trade opened. Open count: %d  Daily: %d/%d",
                 self._open_count, self._today().trade_count, self.max_daily_trades)

    def close_trade(self, pnl: float) -> None:
        """
        Record that an open trade has closed.

        Parameters
        ----------
        pnl : float  Net P&L in USD (positive = win, negative = loss)
        """
        self._open_count  = max(0, self._open_count - 1)
        self.equity      += pnl
        self._today().realised_pnl += pnl
        self._total_trades += 1
        if pnl > 0:
            self._winning_trades += 1
        log.info("Trade closed. PnL=$%.2f  Equity=$%.2f  Daily PnL=$%.2f",
                 pnl, self.equity, self._today().realised_pnl)

    # ── Summary ────────────────────────────────────────────────────────────────

    @property
    def win_rate(self) -> float:
        return self._winning_trades / self._total_trades if self._total_trades else 0.0

    def summary(self) -> dict:
        today = self._today()
        return {
            "equity":           round(self.equity, 2),
            "initial_equity":   self.initial_equity,
            "roi_pct":          round((self.equity / self.initial_equity - 1) * 100, 2),
            "open_trades":      self._open_count,
            "total_trades":     self._total_trades,
            "win_rate":         round(self.win_rate, 4),
            "daily_pnl":        round(today.realised_pnl, 2),
            "daily_trades":     today.trade_count,
            "daily_loss_gate":  round(-self.max_daily_loss_pct * self.equity, 2),
            "provenance":       "LIVE_ENGINE — metrics from actual trade outcomes only",
        }
