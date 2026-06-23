"""
base_strategy.py  —  XQ Trade M8
==================================
Abstract base class for all trading strategies.

Changes vs original
--------------------
1.  RSI — Wilder's EWM smoothing (alpha=1/period), not SMA.
    Matches TradingView, MetaTrader, Bloomberg.
2.  RSI zero-division guard — avg_loss==0 → RSI=100, not inf/NaN.
3.  get_latest_signal() — NaN guard, returns 0 if last signal is NaN.
4.  Indicator cache — indicators computed once, stored in self.indicators.
    run_strategy() is idempotent after first call.
5.  ATR (True Range, Wilder smoothing) — required by entry_exit_logic.py
    and riskmanager.py for SL/TP/position sizing.
6.  ADX (Average Directional Index) — required by trade_logic.txt entry
    filter (ADX > 30) and invalidation exit (ADX < 25).
7.  Chandelier Exit — trade_logic.txt Exit 3: HighestHigh - mult × ATR.
8.  Rolling N-bar high — trade_logic.txt breakout trigger.
9.  Net Pressure (from NautilusTrader volume.pyx) — buy/sell pressure
    normalised by ATR and relative volume. Critical for gold signals.
10. Volume-Weighted Average Price (intraday VWAP).
11. Keltner Channels — ATR-based alternative to Bollinger for volatile assets.
12. Stochastic Oscillator — momentum complement to RSI.

All indicators store their output in self.indicators[key] for
downstream access without recalculation.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
import logging
from typing import Optional

import numpy as np
import pandas as pd

log = logging.getLogger("base_strategy")

# ─────────────────────────────────────────────────────────────────────────────
# Required columns
# ─────────────────────────────────────────────────────────────────────────────
_REQUIRED = ["Open", "High", "Low", "Close", "Volume"]


class BaseStrategy(ABC):
    """
    Abstract base for all XQ Trade M8 strategies.

    Subclass contract
    -----------------
    Override calculate_indicators() to call whichever base indicator
    methods you need, then store results in self.indicators.

    Override generate_signals() to write +1 (buy), -1 (sell), or 0
    (hold) into self.signals using self.set_signal(index, value).

    Example subclass skeleton
    -------------------------
        class MyStrategy(BaseStrategy):
            def calculate_indicators(self):
                self.indicators["ema20"]  = self.calculate_ema(period=20)
                self.indicators["ema50"]  = self.calculate_ema(period=50)
                self.indicators["atr"]    = self.calculate_atr()
                self.indicators["adx"]    = self.calculate_adx()
                self.indicators["rsi"]    = self.calculate_rsi()

            def generate_signals(self):
                ema20 = self.indicators["ema20"]
                ema50 = self.indicators["ema50"]
                adx   = self.indicators["adx"]
                rsi   = self.indicators["rsi"]
                for ts in self.data.index[50:]:
                    if (ema20[ts] > ema50[ts]
                            and adx[ts] > 30
                            and 40 < rsi[ts] < 60):
                        self.set_signal(ts, 1.0)
    """

    def __init__(self, data: pd.DataFrame, parameters: Optional[dict] = None):
        """
        Parameters
        ----------
        data : pd.DataFrame
            OHLCV DataFrame.  Index must be sortable (datetime or int).
        parameters : dict, optional
            Strategy-specific overrides.  Stored as self.parameters.
        """
        self.data       = data.sort_index()   # ensure chronological order
        self.parameters = parameters or {}
        self.signals    = pd.Series(index=self.data.index, dtype=float, name="signal")
        self.indicators: dict[str, pd.Series] = {}
        self._indicators_computed = False
        self.validate_data()

    # ─── Abstract interface ───────────────────────────────────────────────────

    @abstractmethod
    def calculate_indicators(self) -> None:
        """Calculate and store all indicators required by this strategy."""

    @abstractmethod
    def generate_signals(self) -> None:
        """Write +1/−1/0 into self.signals for each bar."""

    # ─── Run / cache ──────────────────────────────────────────────────────────

    def run_strategy(self) -> pd.Series:
        """
        Execute the strategy and return the signal series.

        Idempotent — indicator calculation runs only once.
        Safe to call repeatedly in a live loop after first run.
        """
        if not self._indicators_computed:
            self.calculate_indicators()
            self._indicators_computed = True
        self.generate_signals()
        return self.signals

    def reset(self) -> None:
        """Clear cached indicators and signals.  Call before re-running on new data."""
        self.signals = pd.Series(index=self.data.index, dtype=float, name="signal")
        self.indicators.clear()
        self._indicators_computed = False

    # ─── Validation ───────────────────────────────────────────────────────────

    def validate_data(self) -> None:
        """Raise ValueError if any required OHLCV column is missing."""
        missing = [c for c in _REQUIRED if c not in self.data.columns]
        if missing:
            raise ValueError(
                f"Data missing required columns: {missing}. "
                f"Available: {list(self.data.columns)}"
            )
        if len(self.data) == 0:
            raise ValueError("Data is empty.")

    # ─── Signal helpers ───────────────────────────────────────────────────────

    def set_signal(self, index, value: float) -> None:
        """
        Set signal at index.  Value: +1.0 buy, -1.0 sell, 0.0 neutral.
        Silently ignores indices not present in self.signals.
        """
        if index in self.signals.index:
            self.signals.loc[index] = float(value)

    def get_latest_signal(self) -> float:
        """
        Return the most recent non-NaN signal.
        Returns 0.0 if signals are empty or all NaN.
        """
        if len(self.signals) == 0:
            return 0.0
        last = self.signals.dropna()
        return float(last.iloc[-1]) if len(last) > 0 else 0.0

    # ─── Moving averages ──────────────────────────────────────────────────────

    def calculate_sma(self, column: str = "Close", period: int = 20) -> pd.Series:
        """Simple Moving Average (arithmetic mean over a rolling window)."""
        return self.data[column].rolling(window=period, min_periods=period).mean()

    def calculate_ema(self, column: str = "Close", period: int = 20) -> pd.Series:
        """
        Exponential Moving Average.
        Uses adjust=False (recursive formula) — matches TradingView/MetaTrader.
        """
        return self.data[column].ewm(span=period, adjust=False).mean()

    def calculate_wma(self, column: str = "Close", period: int = 20) -> pd.Series:
        """
        Weighted Moving Average — linearly weights recent bars more heavily.
        Useful for HMA (Hull MA) calculation.
        """
        weights = np.arange(1, period + 1, dtype=float)
        return (
            self.data[column]
            .rolling(window=period)
            .apply(lambda x: np.dot(x, weights) / weights.sum(), raw=True)
        )

    def calculate_hma(self, column: str = "Close", period: int = 20) -> pd.Series:
        """
        Hull Moving Average — reduces lag significantly vs EMA/SMA.
        HMA = WMA(2*WMA(n/2) − WMA(n), sqrt(n))
        Useful for fast-trend detection on volatile assets like XAU.
        """
        half    = max(int(period / 2), 1)
        sq_root = max(int(np.sqrt(period)), 1)
        wma_half  = self.calculate_wma(column, half)
        wma_full  = self.calculate_wma(column, period)
        raw       = 2 * wma_half - wma_full
        # WMA of raw series
        weights   = np.arange(1, sq_root + 1, dtype=float)
        return raw.rolling(window=sq_root).apply(
            lambda x: np.dot(x, weights) / weights.sum(), raw=True
        )

    # ─── RSI (Wilder's smoothing) ─────────────────────────────────────────────

    def calculate_rsi(self, column: str = "Close", period: int = 14) -> pd.Series:
        """
        Relative Strength Index — Wilder's EWM smoothing (alpha=1/period).

        This is the industry-standard calculation used by TradingView,
        MetaTrader, Bloomberg and the NautilusTrader library.

        The original code used rolling().mean() (SMA smoothing) which
        produces different values and will shift the 40–60 confluence
        thresholds from trade_logic.txt by several RSI points.

        Zero-division guard: when avg_loss == 0 (all gains), RSI = 100.
        """
        delta = self.data[column].diff()
        gain  = delta.clip(lower=0)
        loss  = (-delta).clip(lower=0)

        # Wilder's smoothing: alpha = 1/period
        avg_gain = gain.ewm(alpha=1.0 / period, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1.0 / period, adjust=False).mean()

        # Zero-division: avg_loss == 0 → RS = inf → RSI = 100
        rs  = avg_gain / avg_loss.replace(0, np.nan)
        rsi = 100 - (100 / (1 + rs))
        rsi = rsi.fillna(100)   # fills where avg_loss was 0

        # First (period-1) values are unreliable — set to NaN
        rsi.iloc[:period] = np.nan
        return rsi

    # ─── ATR (True Range, Wilder smoothing) ───────────────────────────────────

    def calculate_atr(self, period: int = 14) -> pd.Series:
        """
        Average True Range — Wilder's EWM smoothing.

        True Range = max(H-L, |H-PrevC|, |L-PrevC|).
        Accounts for overnight gaps, which plain H-L does not.

        Required by:
          - entry_exit_logic.py  (SL = entry − 1.5×ATR, TP = entry + 2×ATR)
          - riskmanager.py       (position sizing)
          - trade_logic.txt      (volatility filter: ATR > median ATR)
          - chandelier_exit()    (trail = HighestHigh − 2×ATR)
        """
        high  = self.data["High"]
        low   = self.data["Low"]
        close = self.data["Close"]
        prev_close = close.shift(1)

        tr = pd.concat(
            [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
            axis=1,
        ).max(axis=1)

        atr = tr.ewm(alpha=1.0 / period, adjust=False).mean()
        atr.iloc[:period] = np.nan
        return atr

    # ─── ADX ─────────────────────────────────────────────────────────────────

    def calculate_adx(self, period: int = 14) -> pd.Series:
        """
        Average Directional Index (J. Welles Wilder, 1978).

        Returns ADX only (trend strength scalar 0-100).
        For DI+ and DI- access, use calculate_directional_index().

        Required by trade_logic.txt:
          - Entry gate:       ADX(14) > 30
          - Invalidation exit: ADX < 25 → trend weakening
        """
        high  = self.data["High"]
        low   = self.data["Low"]
        close = self.data["Close"]

        # Directional Movement
        up_move   = high.diff()
        down_move = -low.diff()

        dm_plus  = np.where((up_move > down_move) & (up_move > 0), up_move,  0.0)
        dm_minus = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

        dm_plus  = pd.Series(dm_plus,  index=self.data.index)
        dm_minus = pd.Series(dm_minus, index=self.data.index)

        # ATR for normalisation (raw TR series, not smoothed)
        prev_close = close.shift(1)
        tr = pd.concat(
            [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
            axis=1,
        ).max(axis=1)

        # Wilder smoothing on TR and DM series
        atr_w      = tr.ewm(alpha=1.0 / period, adjust=False).mean()
        dm_plus_s  = dm_plus.ewm(alpha=1.0 / period, adjust=False).mean()
        dm_minus_s = dm_minus.ewm(alpha=1.0 / period, adjust=False).mean()

        # Directional Indicators
        di_plus  = 100 * dm_plus_s  / atr_w.replace(0, np.nan)
        di_minus = 100 * dm_minus_s / atr_w.replace(0, np.nan)

        # DX and ADX
        dx  = 100 * (di_plus - di_minus).abs() / (di_plus + di_minus).replace(0, np.nan)
        adx = dx.ewm(alpha=1.0 / period, adjust=False).mean()
        adx.iloc[: period * 2] = np.nan   # warmup
        return adx

    def calculate_directional_index(
        self, period: int = 14
    ) -> tuple[pd.Series, pd.Series, pd.Series]:
        """
        Returns (DI+, DI-, ADX) — full Wilder directional index suite.
        Use when you need DI cross signals (DI+ crossing above DI- = bullish).
        """
        high  = self.data["High"]
        low   = self.data["Low"]
        close = self.data["Close"]

        up_move   = high.diff()
        down_move = -low.diff()

        dm_plus  = pd.Series(
            np.where((up_move > down_move) & (up_move > 0), up_move, 0.0),
            index=self.data.index,
        )
        dm_minus = pd.Series(
            np.where((down_move > up_move) & (down_move > 0), down_move, 0.0),
            index=self.data.index,
        )

        prev_close = close.shift(1)
        tr = pd.concat(
            [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
            axis=1,
        ).max(axis=1)

        atr_w      = tr.ewm(alpha=1.0 / period, adjust=False).mean()
        dm_plus_s  = dm_plus.ewm(alpha=1.0 / period, adjust=False).mean()
        dm_minus_s = dm_minus.ewm(alpha=1.0 / period, adjust=False).mean()

        di_plus  = 100 * dm_plus_s  / atr_w.replace(0, np.nan)
        di_minus = 100 * dm_minus_s / atr_w.replace(0, np.nan)
        dx       = 100 * (di_plus - di_minus).abs() / (di_plus + di_minus).replace(0, np.nan)
        adx      = dx.ewm(alpha=1.0 / period, adjust=False).mean()

        return di_plus, di_minus, adx

    # ─── Bollinger Bands ──────────────────────────────────────────────────────

    def bollinger_bands(
        self, column: str = "Close", period: int = 20, stdev: float = 2.0
    ) -> tuple[pd.Series, pd.Series, pd.Series]:
        """
        Bollinger Bands.
        Returns (upper, middle, lower).
        Unchanged from original — rolling std is correct for Bollinger.
        Added: min_periods=period to avoid partial-window bands.
        """
        mid   = self.data[column].rolling(window=period, min_periods=period).mean()
        std   = self.data[column].rolling(window=period, min_periods=period).std()
        upper = mid + stdev * std
        lower = mid - stdev * std
        return upper, mid, lower

    def bollinger_bandwidth(self, column: str = "Close", period: int = 20, stdev: float = 2.0) -> pd.Series:
        """
        Bollinger Band Width = (Upper - Lower) / Middle.
        Squeeze signal: low BW → volatility contraction → breakout pending.
        """
        upper, mid, lower = self.bollinger_bands(column, period, stdev)
        return (upper - lower) / mid.replace(0, np.nan)

    def bollinger_percent_b(self, column: str = "Close", period: int = 20, stdev: float = 2.0) -> pd.Series:
        """
        %B = (Close - Lower) / (Upper - Lower).
        >1 = above upper band, <0 = below lower band.
        """
        upper, mid, lower = self.bollinger_bands(column, period, stdev)
        bw = (upper - lower).replace(0, np.nan)
        return (self.data[column] - lower) / bw

    # ─── Keltner Channels ────────────────────────────────────────────────────

    def keltner_channels(
        self, period: int = 20, atr_period: int = 14, mult: float = 2.0
    ) -> tuple[pd.Series, pd.Series, pd.Series]:
        """
        Keltner Channels — ATR-based channel around EMA.
        Returns (upper, mid_ema, lower).

        Preferred over Bollinger for XAU/USD because ATR-width adapts
        to volatility without the squared-distance sensitivity of std.
        Bollinger squeeze + Keltner squeeze together = high-confidence breakout.
        """
        mid   = self.calculate_ema("Close", period)
        atr   = self.calculate_atr(atr_period)
        upper = mid + mult * atr
        lower = mid - mult * atr
        return upper, mid, lower

    # ─── MACD ─────────────────────────────────────────────────────────────────

    def calculate_macd(
        self,
        column: str = "Close",
        fast_period: int = 12,
        slow_period: int = 26,
        signal_period: int = 9,
    ) -> tuple[pd.Series, pd.Series, pd.Series]:
        """
        MACD line, signal line, histogram.
        Returns (macd_line, signal_line, histogram).
        Unchanged from original — EWM on both components is correct.
        """
        fast_ema    = self.calculate_ema(column, fast_period)
        slow_ema    = self.calculate_ema(column, slow_period)
        macd_line   = fast_ema - slow_ema
        signal_line = macd_line.ewm(span=signal_period, adjust=False).mean()
        histogram   = macd_line - signal_line
        return macd_line, signal_line, histogram

    # ─── Stochastic Oscillator ────────────────────────────────────────────────

    def calculate_stochastic(
        self, k_period: int = 14, d_period: int = 3
    ) -> tuple[pd.Series, pd.Series]:
        """
        Stochastic Oscillator — %K and %D.
        Returns (%K, %D).

        %K = (Close - LowestLow(k)) / (HighestHigh(k) - LowestLow(k)) × 100
        %D = SMA(%K, d_period)

        Complement to RSI: both oversold (<20) = stronger mean-reversion signal.
        """
        low_k  = self.data["Low"].rolling(k_period).min()
        high_k = self.data["High"].rolling(k_period).max()
        rng    = (high_k - low_k).replace(0, np.nan)
        k      = 100 * (self.data["Close"] - low_k) / rng
        d      = k.rolling(d_period).mean()
        return k, d

    # ─── Chandelier Exit (trailing stop) ─────────────────────────────────────

    def chandelier_exit(
        self, atr_period: int = 22, mult: float = 3.0, column: str = "High"
    ) -> pd.Series:
        """
        Chandelier Exit — trailing stop based on HighestHigh since entry.

        StopTrail = HighestHigh(period) - mult × ATR(period)

        trade_logic.txt Exit 3 uses mult=2.0 and rolling window.
        The standard (Chuck LeBeau) uses period=22, mult=3.0.
        Set mult=2.0 to match trade_logic.txt exactly.

        This is a stop-loss level series — not a signal by itself.
        Use it in generate_signals() to trigger an exit when Close < chandelier.
        """
        highest_high = self.data[column].rolling(window=atr_period).max()
        atr          = self.calculate_atr(atr_period)
        return highest_high - mult * atr

    # ─── Rolling N-bar high/low ───────────────────────────────────────────────

    def rolling_high(self, column: str = "Close", period: int = 10) -> pd.Series:
        """
        Highest value over the last N bars (exclusive of current bar).
        Used for breakout filter: Close > rolling_high(10) → new high breakout.
        trade_logic.txt: Close > highest(Close, 10 bars)
        """
        return self.data[column].shift(1).rolling(window=period).max()

    def rolling_low(self, column: str = "Close", period: int = 10) -> pd.Series:
        """Lowest value over the last N bars (exclusive of current bar)."""
        return self.data[column].shift(1).rolling(window=period).min()

    # ─── Volume indicators ────────────────────────────────────────────────────

    def calculate_vwap(self) -> pd.Series:
        """
        Volume-Weighted Average Price (intraday, resets on day boundary).

        Typical price = (H + L + C) / 3
        VWAP = cumsum(TP × Volume) / cumsum(Volume)

        Note: for XAU/USD spot, volume is synthetic dealer tick-count.
        Net Pressure (calculate_net_pressure) is more reliable for gold.
        """
        typical    = (self.data["High"] + self.data["Low"] + self.data["Close"]) / 3
        tp_vol     = typical * self.data["Volume"]

        # If index is DatetimeIndex, group by date
        if isinstance(self.data.index, pd.DatetimeIndex):
            date_group  = self.data.index.date
            vwap_series = pd.Series(index=self.data.index, dtype=float)
            for date in np.unique(date_group):
                mask         = np.array(date_group) == date
                cum_tp_vol   = tp_vol[mask].cumsum()
                cum_vol      = self.data["Volume"][mask].replace(0, np.nan).cumsum()
                vwap_series[mask] = cum_tp_vol / cum_vol
            return vwap_series

        # No datetime index — cumulative VWAP over full series
        return tp_vol.cumsum() / self.data["Volume"].replace(0, np.nan).cumsum()

    def calculate_obv(self) -> pd.Series:
        """
        On-Balance Volume — cumulative directional volume.
        Rising OBV with rising price = confirmed trend.
        Divergence (price up, OBV flat/down) = potential reversal.
        """
        close    = self.data["Close"]
        volume   = self.data["Volume"]
        direction = np.where(close > close.shift(1), 1, np.where(close < close.shift(1), -1, 0))
        obv      = pd.Series(direction * volume.values, index=self.data.index).cumsum()
        return obv

    def calculate_net_pressure(self, period: int = 14) -> pd.Series:
        """
        Net Pressure — ported from NautilusTrader volume.pyx (Pressure indicator).

        buy_pressure  = ((Close - Low)  / ATR) × relative_volume
        sell_pressure = ((High  - Close) / ATR) × relative_volume
        net_pressure  = buy_pressure - sell_pressure

        Positive = buyers dominated the bar relative to average volume.
        Negative = sellers dominated.

        More reliable than raw OBV for XAU/USD and other assets where
        exchange volume is unavailable or synthetic.

        Reference:
            nautilus_trader/indicators/volume.pyx — Pressure class
            ThaleOS-Agent/nautilus_trader (develop branch)
        """
        atr     = self.calculate_atr(period)
        avg_vol = self.data["Volume"].ewm(alpha=1.0 / period, adjust=False).mean()
        rel_vol = self.data["Volume"] / avg_vol.replace(0, np.nan)

        atr_safe = atr.replace(0, np.nan)
        buy_p    = ((self.data["Close"] - self.data["Low"])  / atr_safe) * rel_vol
        sell_p   = ((self.data["High"]  - self.data["Close"]) / atr_safe) * rel_vol
        return buy_p - sell_p

    def calculate_klinger_volume_oscillator(
        self,
        fast_period: int = 34,
        slow_period: int = 55,
        signal_period: int = 13,
    ) -> tuple[pd.Series, pd.Series]:
        """
        Klinger Volume Oscillator — ported from NautilusTrader volume.pyx.

        Adds signed volume based on HLC3 direction vs prior bar,
        then computes fast - slow EMA difference.
        Returns (kvo, signal_line).

        Best used as a divergence detector for volume-driven reversals.
        Particularly useful for XAU/USD institutional flow detection.
        """
        hlc3     = (self.data["High"] + self.data["Low"] + self.data["Close"]) / 3
        prev_hlc3 = hlc3.shift(1)
        direction = np.where(hlc3 > prev_hlc3, 1, np.where(hlc3 < prev_hlc3, -1, 0))
        signed_vol = self.data["Volume"] * direction

        sv = pd.Series(signed_vol, index=self.data.index, dtype=float)
        fast_ma  = sv.ewm(span=fast_period,  adjust=False).mean()
        slow_ma  = sv.ewm(span=slow_period,  adjust=False).mean()
        kvo      = fast_ma - slow_ma
        signal   = kvo.ewm(span=signal_period, adjust=False).mean()
        return kvo, signal

    # ─── Volatility indicators ────────────────────────────────────────────────

    def historical_volatility(self, period: int = 20, annualise: bool = True) -> pd.Series:
        """
        Annualised close-to-close historical volatility.
        HV = std(log_returns, period) × sqrt(252)
        """
        log_ret = np.log(self.data["Close"] / self.data["Close"].shift(1))
        hv      = log_ret.rolling(window=period).std()
        return hv * np.sqrt(252) if annualise else hv

    def atr_percent(self, period: int = 14) -> pd.Series:
        """ATR as percentage of Close — useful for cross-asset comparisons."""
        atr = self.calculate_atr(period)
        return atr / self.data["Close"].replace(0, np.nan) * 100

    # ─── Candlestick patterns ─────────────────────────────────────────────────

    def bullish_engulfing(self) -> pd.Series:
        """
        Bullish Engulfing pattern.
        Prior bar must be bearish; current bar body must fully engulf prior body.
        Returns boolean Series.

        Fixes original: prior bearish condition was missing, allowing
        any two-bar combination where close > prior open.
        """
        prev_bearish  = self.data["Close"].shift(1) < self.data["Open"].shift(1)
        body_engulfs  = (
            (self.data["Open"]  < self.data["Close"].shift(1)) &
            (self.data["Close"] > self.data["Open"].shift(1))
        )
        return prev_bearish & body_engulfs

    def doji(self, threshold: float = 0.1) -> pd.Series:
        """
        Doji: body < threshold × range.
        Indicates indecision. threshold=0.1 is standard (10% of range).
        """
        body  = (self.data["Close"] - self.data["Open"]).abs()
        rng   = self.data["High"] - self.data["Low"]
        return body < threshold * rng.replace(0, np.nan)

    def hammer(self) -> pd.Series:
        """
        Hammer/Hanging Man: lower shadow > 2× body, small upper shadow.
        Use directional context to distinguish bullish hammer from bearish hanging man.
        """
        body        = (self.data["Close"] - self.data["Open"]).abs()
        upper_wick  = self.data["High"]  - self.data[["Close", "Open"]].max(axis=1)
        lower_wick  = self.data[["Close", "Open"]].min(axis=1) - self.data["Low"]
        return (lower_wick > 2 * body) & (upper_wick <= body)

    # ─── Market regime ────────────────────────────────────────────────────────

    def detect_regime(
        self,
        ema_fast: int = 20,
        ema_slow: int = 50,
        adx_period: int = 14,
        adx_strong: float = 25.0,
        vol_period: int = 20,
    ) -> pd.Series:
        """
        Simple rule-based regime labels per bar.

        Returns pd.Series of strings:
          'trending_bull'  — EMA fast > slow, ADX strong
          'trending_bear'  — EMA fast < slow, ADX strong
          'ranging'        — ADX weak, low volatility
          'volatile'       — high ATR%, low ADX (choppy)

        Required by optimizedEnsembleStrategy.js regime-weight routing.
        """
        ema_f  = self.calculate_ema("Close", ema_fast)
        ema_s  = self.calculate_ema("Close", ema_slow)
        adx    = self.calculate_adx(adx_period)
        atr_p  = self.atr_percent(adx_period)
        hv     = self.historical_volatility(vol_period, annualise=False)

        conditions = [
            (ema_f > ema_s) & (adx > adx_strong),
            (ema_f < ema_s) & (adx > adx_strong),
            (adx <= adx_strong) & (hv <= hv.rolling(vol_period).median()),
        ]
        choices = ["trending_bull", "trending_bear", "ranging"]
        regime  = np.select(conditions, choices, default="volatile")
        return pd.Series(regime, index=self.data.index)

    # ─── Confluence gate ─────────────────────────────────────────────────────

    def passes_entry_confluence(
        self,
        index,
        adx_min:     float = 30.0,
        rsi_min:     float = 40.0,
        rsi_max:     float = 60.0,
        breakout_n:  int   = 10,
        atr_vol:     bool  = True,
    ) -> bool:
        """
        Check all entry conditions from trade_logic.txt at a given bar index.

        Returns True only if ALL of the following are satisfied:
          1. EMA20 > EMA50       (trend direction)
          2. ADX > adx_min       (trend strength)
          3. rsi_min < RSI < rsi_max and rising (momentum)
          4. Close > rolling high(N bars)  (breakout trigger)
          5. ATR > median ATR    (volatility filter)  — if atr_vol=True

        Requires self.indicators to contain:
          'ema20', 'ema50', 'adx', 'rsi', 'roll_high', 'atr', 'atr_median'

        Call calculate_indicators() first to populate self.indicators.
        """
        ind = self.indicators
        required = ["ema20", "ema50", "adx", "rsi"]
        for key in required:
            if key not in ind or pd.isna(ind[key].get(index, np.nan)):
                return False

        if ind["ema20"][index] <= ind["ema50"][index]:
            return False
        if ind["adx"][index] <= adx_min:
            return False

        rsi = ind["rsi"][index]
        if not (rsi_min < rsi < rsi_max):
            return False

        # RSI must be rising — compare to previous bar
        loc = self.data.index.get_loc(index)
        if loc > 0:
            prev_idx = self.data.index[loc - 1]
            if rsi <= ind["rsi"].get(prev_idx, rsi):
                return False

        if "roll_high" in ind and not pd.isna(ind["roll_high"].get(index, np.nan)):
            if self.data.loc[index, "Close"] <= ind["roll_high"][index]:
                return False

        if atr_vol and "atr" in ind and "atr_median" in ind:
            if not pd.isna(ind["atr"].get(index, np.nan)):
                if ind["atr"][index] <= ind["atr_median"].get(index, 0):
                    return False

        return True
