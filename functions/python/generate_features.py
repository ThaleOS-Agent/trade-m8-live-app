"""
generate_features.py  —  XQ Trade M8
======================================
Feature engineering pipeline for the Transformer / LSTM training stack.

Changes vs original
--------------------
1.  BullishEngulfing — adds required prior-bar bearish condition.
    Original accepted any two-bar combo regardless of prior direction.
2.  fillna(0) removed — NaN rows are dropped cleanly after indicator
    warmup.  Filling with 0 injects fabricated signal values into training.
3.  create_labels — operates on a copy to prevent silent in-place
    mutation of the caller's DataFrame.
4.  Feature selection gate — optional KEEP_FEATURES list prunes output
    to the optimal set identified by analyze_features.py.  Pass None to
    keep all features (default, backward-compatible).
5.  Hammer — split into bullish_hammer() and hanging_man() with trend
    context filter so the model receives directional signal.
6.  Net Pressure indicator added (from NautilusTrader volume.pyx).
    More reliable than raw OBV for XAU/USD synthetic volume.
7.  Warmup-aware NaN handling — all NaN rows dropped by one final
    dropna() call after all indicators are computed.  No partial rows.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd

try:
    import ta
    _TA_AVAILABLE = True
except ImportError:
    _TA_AVAILABLE = False
    logging.warning("ta library not installed — basic indicators only. pip install ta")

log = logging.getLogger("generate_features")


# ─── Optional feature selection gate ─────────────────────────────────────────
# Set this to the list returned by analyze_features.py to prune collinear
# features before training.  None = keep all (backward-compatible).
KEEP_FEATURES: Optional[list[str]] = None


# ─── Core pipeline ────────────────────────────────────────────────────────────

def generate_features(
    df: pd.DataFrame,
    keep_features: Optional[list[str]] = None,
) -> pd.DataFrame:
    """
    Add technical indicators and candlestick pattern features.

    Parameters
    ----------
    df : pd.DataFrame
        Raw OHLCV DataFrame.  Required columns: Open, High, Low, Close, Volume.
    keep_features : list[str] | None
        If provided, the returned DataFrame is pruned to OHLCV + Label +
        Return + these features only.  Ignored if None.
        Typical source: analyze_features.py optimal_feature_set.csv top-30.

    Returns
    -------
    pd.DataFrame
        Feature-enriched DataFrame. NaN rows from indicator warmup are
        dropped.  No fillna(0) — all values are genuine.
    """
    _validate(df)
    df = df.copy()

    # ── ta library indicators ─────────────────────────────────────────────────
    if _TA_AVAILABLE:
        df = ta.add_all_ta_features(
            df,
            open="Open", high="High", low="Low",
            close="Close", volume="Volume",
            fillna=False,     # keep NaN — do NOT fill
        )
    else:
        # Minimal fallback if ta is absent
        df = _add_minimal_indicators(df)

    # ── Net Pressure (NautilusTrader volume.pyx — Pressure indicator) ─────────
    df = _add_net_pressure(df)

    # ── Candlestick patterns ──────────────────────────────────────────────────
    df["BullishEngulfing"] = _bullish_engulfing(df).astype(int)
    df["BearishEngulfing"] = _bearish_engulfing(df).astype(int)
    df["Doji"]             = _doji(df).astype(int)
    df["BullishHammer"]    = _bullish_hammer(df).astype(int)
    df["HangingMan"]       = _hanging_man(df).astype(int)
    df["MorningStar"]      = _morning_star(df).astype(int)

    # ── Drop all warmup NaN rows in one pass ──────────────────────────────────
    # Do NOT fillna(0). NaN rows are incomplete and must be excluded.
    before = len(df)
    df = df.dropna()
    dropped = before - len(df)
    if dropped:
        log.info("Dropped %d warmup/NaN rows (%.1f%% of data)", dropped, dropped / before * 100)

    # ── Feature selection gate ────────────────────────────────────────────────
    gate = keep_features or KEEP_FEATURES
    if gate:
        base_cols  = ["Open", "High", "Low", "Close", "Volume"]
        label_cols = [c for c in ["Return", "Label"] if c in df.columns]
        keep_cols  = base_cols + label_cols + [f for f in gate if f in df.columns]
        missing    = [f for f in gate if f not in df.columns]
        if missing:
            log.warning("KEEP_FEATURES requested but not found: %s", missing)
        df = df[[c for c in keep_cols if c in df.columns]]
        log.info("Feature selection applied: %d → %d columns", len(gate), df.shape[1])

    log.info("generate_features: %d rows × %d cols", df.shape[0], df.shape[1])
    return df


def create_labels(
    df: pd.DataFrame,
    threshold: float = 0.002,
) -> pd.DataFrame:
    """
    Create ternary classification labels from next-bar returns.

    Label encoding
    --------------
    2 = Buy  (next-bar return > +threshold)
    1 = Hold (|return| <= threshold)
    0 = Sell (next-bar return < -threshold)

    Parameters
    ----------
    df : pd.DataFrame
        OHLCV DataFrame (or feature-enriched DataFrame).
    threshold : float
        Minimum return magnitude to classify as Buy/Sell.
        0.002 = 0.2% — appropriate for M5 XAU/USD bars.

    Returns
    -------
    pd.DataFrame
        Copy of df with 'Return' and 'Label' columns added.
        Last row is dropped (no future return available).
    """
    df = df.copy()      # never mutate caller's DataFrame
    df["Return"] = df["Close"].pct_change(1).shift(-1)
    df["Label"]  = 1
    df.loc[df["Return"] >  threshold, "Label"] = 2
    df.loc[df["Return"] < -threshold, "Label"] = 0
    df = df.dropna(subset=["Return"])   # last row has no future return
    log.info(
        "Labels: Buy=%d  Hold=%d  Sell=%d  (threshold=%.3f%%)",
        (df["Label"] == 2).sum(),
        (df["Label"] == 1).sum(),
        (df["Label"] == 0).sum(),
        threshold * 100,
    )
    return df


# ─── Net Pressure (NautilusTrader volume.pyx port) ────────────────────────────

def _add_net_pressure(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """
    buy_pressure  = ((Close - Low)  / ATR) × relative_volume
    sell_pressure = ((High  - Close) / ATR) × relative_volume
    net_pressure  = buy_pressure - sell_pressure

    Normalised by ATR and average volume — more reliable than raw OBV
    for assets with synthetic volume (XAU/USD spot).
    """
    prev_close = df["Close"].shift(1)
    tr = pd.concat([
        df["High"] - df["Low"],
        (df["High"] - prev_close).abs(),
        (df["Low"]  - prev_close).abs(),
    ], axis=1).max(axis=1)

    atr     = tr.ewm(alpha=1.0 / period, adjust=False).mean()
    avg_vol = df["Volume"].ewm(alpha=1.0 / period, adjust=False).mean()
    rel_vol = df["Volume"] / avg_vol.replace(0, np.nan)

    atr_safe = atr.replace(0, np.nan)
    df["BuyPressure"]  = ((df["Close"] - df["Low"])  / atr_safe) * rel_vol
    df["SellPressure"] = ((df["High"]  - df["Close"]) / atr_safe) * rel_vol
    df["NetPressure"]  = df["BuyPressure"] - df["SellPressure"]
    return df


# ─── Candlestick patterns ─────────────────────────────────────────────────────

def _bullish_engulfing(df: pd.DataFrame) -> pd.Series:
    """
    Prior bar must be bearish AND current body must fully engulf prior body.
    Original omitted the prior-bar bearish condition — any two-bar combo passed.
    """
    prev_bearish = df["Close"].shift(1) < df["Open"].shift(1)
    body_engulfs = (
        (df["Open"]  < df["Close"].shift(1)) &
        (df["Close"] > df["Open"].shift(1))
    )
    return prev_bearish & body_engulfs


def _bearish_engulfing(df: pd.DataFrame) -> pd.Series:
    """Prior bar bullish AND current bar body engulfs prior body."""
    prev_bullish = df["Close"].shift(1) > df["Open"].shift(1)
    body_engulfs = (
        (df["Open"]  > df["Close"].shift(1)) &
        (df["Close"] < df["Open"].shift(1))
    )
    return prev_bullish & body_engulfs


def _doji(df: pd.DataFrame, threshold: float = 0.1) -> pd.Series:
    """Body < threshold × range (standard 10%)."""
    body = (df["Close"] - df["Open"]).abs()
    rng  = (df["High"] - df["Low"]).replace(0, np.nan)
    return body < threshold * rng


def _bullish_hammer(df: pd.DataFrame) -> pd.Series:
    """
    Hammer shape (long lower wick, small body, small upper wick)
    appearing in a downtrend (Close < SMA20).
    """
    body       = (df["Close"] - df["Open"]).abs()
    upper_wick = df["High"]  - df[["Close", "Open"]].max(axis=1)
    lower_wick = df[["Close", "Open"]].min(axis=1) - df["Low"]
    rng        = (df["High"] - df["Low"]).replace(0, np.nan)

    hammer_shape = (lower_wick > 2 * body) & (upper_wick <= 0.3 * rng)
    downtrend    = df["Close"] < df["Close"].rolling(20).mean()
    return hammer_shape & downtrend


def _hanging_man(df: pd.DataFrame) -> pd.Series:
    """
    Same shape as hammer but in an uptrend — bearish reversal signal.
    """
    body       = (df["Close"] - df["Open"]).abs()
    upper_wick = df["High"]  - df[["Close", "Open"]].max(axis=1)
    lower_wick = df[["Close", "Open"]].min(axis=1) - df["Low"]
    rng        = (df["High"] - df["Low"]).replace(0, np.nan)

    hammer_shape = (lower_wick > 2 * body) & (upper_wick <= 0.3 * rng)
    uptrend      = df["Close"] > df["Close"].rolling(20).mean()
    return hammer_shape & uptrend


def _morning_star(df: pd.DataFrame) -> pd.Series:
    """
    3-bar bullish reversal: large bearish bar, small body (gap), large bullish bar.
    """
    bar1_bearish = df["Close"].shift(2) < df["Open"].shift(2)
    bar1_large   = (df["Open"].shift(2) - df["Close"].shift(2)) > \
                   df["Close"].shift(2).pct_change().abs() * 0.01
    bar2_small   = (df["Close"].shift(1) - df["Open"].shift(1)).abs() < \
                   (df["Open"].shift(2) - df["Close"].shift(2)) * 0.3
    bar3_bullish = df["Close"] > df["Open"]
    bar3_closes_above = df["Close"] > (df["Open"].shift(2) + df["Close"].shift(2)) / 2
    return bar1_bearish & bar1_large & bar2_small & bar3_bullish & bar3_closes_above


# ─── Minimal fallback (no ta library) ────────────────────────────────────────

def _add_minimal_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Bare-minimum indicators when ta is not installed."""
    # EMA
    for p in [20, 50, 200]:
        df[f"EMA_{p}"] = df["Close"].ewm(span=p, adjust=False).mean()

    # RSI (Wilder)
    delta    = df["Close"].diff()
    gain     = delta.clip(lower=0)
    loss     = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1.0 / 14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / 14, adjust=False).mean()
    rs       = avg_gain / avg_loss.replace(0, np.nan)
    df["RSI_14"] = (100 - 100 / (1 + rs)).fillna(100)

    # ATR (True Range, Wilder)
    prev_c = df["Close"].shift(1)
    tr     = pd.concat([
        df["High"] - df["Low"],
        (df["High"] - prev_c).abs(),
        (df["Low"]  - prev_c).abs(),
    ], axis=1).max(axis=1)
    df["ATR_14"] = tr.ewm(alpha=1.0 / 14, adjust=False).mean()

    # MACD
    ema12        = df["Close"].ewm(span=12, adjust=False).mean()
    ema26        = df["Close"].ewm(span=26, adjust=False).mean()
    df["MACD"]   = ema12 - ema26
    df["MACD_Signal"] = df["MACD"].ewm(span=9, adjust=False).mean()

    return df


# ─── Validation ───────────────────────────────────────────────────────────────

def _validate(df: pd.DataFrame) -> None:
    required = ["Open", "High", "Low", "Close", "Volume"]
    missing  = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    if len(df) < 200:
        log.warning("Only %d rows — many indicators need 200+ bars for reliable warmup.", len(df))
