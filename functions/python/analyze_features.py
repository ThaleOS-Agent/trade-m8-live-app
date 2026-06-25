"""
analyze_features.py  —  XQ Trade M8
======================================
Feature importance, correlation, and regime-stability analysis.
Writes optimal_feature_set.csv — consumed by generate_features.py.

Changes vs original
--------------------
1.  plot_dir / data_dir global mutation removed.  Functions accept explicit
    output directories so concurrent symbol runs are safe.
2.  analyze_feature_stability() — guarded file load; falls back to first
    available horizon file if feature_importance_1d.csv is absent.
3.  optimal_feature_set.csv path returned from run_feature_analysis() so
    caller can pass it directly to generate_features.generate_features().
4.  analyze_feature_correlations() — raises FileNotFoundError explicitly
    instead of silently building an empty matrix.
5.  load_optimal_features() helper added — single call to read the
    optimal feature list from any previous run.

Usage
-----
    python analyze_features.py

    # Or import and connect to training pipeline:
    from analyze_features import run_feature_analysis, load_optimal_features
    from generate_features import generate_features

    optimal_csv = run_feature_analysis(['BTCUSDT'], '2022-01-01', '2024-01-01',
                                        source='binance')
    top_features = load_optimal_features(optimal_csv)
    df_features  = generate_features(df_raw, keep_features=top_features)
"""

from __future__ import annotations

import logging
import warnings
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestRegressor
from sklearn.feature_selection import SelectKBest, f_regression
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
import matplotlib.pyplot as plt
import seaborn as sns

from create_features import FeatureEngineer

warnings.filterwarnings("ignore")
log = logging.getLogger("analyze_features")

# ─── Output root ─────────────────────────────────────────────────────────────
OUTPUT_ROOT = Path("feature_analysis_results")


# ─── Data fetching ────────────────────────────────────────────────────────────

def fetch_historical_data(
    symbols:    list[str],
    start_date: str,
    end_date:   str,
    source:     str = "yfinance",
) -> dict[str, pd.DataFrame]:
    """
    Fetch OHLCV data for one or more symbols.

    Parameters
    ----------
    symbols    : list of ticker symbols
    start_date : 'YYYY-MM-DD'
    end_date   : 'YYYY-MM-DD'
    source     : 'yfinance' | 'binance'
    """
    data: dict[str, pd.DataFrame] = {}

    if source == "yfinance":
        for sym in symbols:
            log.info("Fetching %s from yfinance …", sym)
            try:
                ticker = yf.Ticker(sym)
                df     = ticker.history(start=start_date, end=end_date)
                df.columns = [c.capitalize() for c in df.columns]
                req    = ["Open", "High", "Low", "Close", "Volume"]
                if all(c in df.columns for c in req):
                    data[sym] = df
                else:
                    log.warning("%s: missing OHLCV columns.", sym)
            except Exception as e:
                log.error("yfinance error for %s: %s", sym, e)

    elif source == "binance":
        for sym in symbols:
            log.info("Fetching %s from Binance …", sym)
            try:
                url = (
                    f"https://api.binance.com/api/v3/klines"
                    f"?symbol={sym}&interval=1d"
                    f"&startTime={int(pd.Timestamp(start_date).timestamp() * 1000)}"
                    f"&endTime={int(pd.Timestamp(end_date).timestamp() * 1000)}"
                )
                resp = requests.get(url, timeout=15)
                resp.raise_for_status()
                raw  = resp.json()
                df   = pd.DataFrame(raw, columns=[
                    "Open time","Open","High","Low","Close","Volume",
                    "Close time","Quote asset volume","Number of trades",
                    "Taker buy base","Taker buy quote","Ignore",
                ])
                for col in ["Open","High","Low","Close","Volume"]:
                    df[col] = df[col].astype(float)
                df["Timestamp"] = pd.to_datetime(df["Open time"], unit="ms")
                df.set_index("Timestamp", inplace=True)
                data[sym] = df[["Open","High","Low","Close","Volume"]]
            except Exception as e:
                log.error("Binance error for %s: %s", sym, e)
    else:
        raise ValueError(f"Unsupported source: {source}")

    return data


# ─── Regime detection ─────────────────────────────────────────────────────────

def identify_market_regimes(
    price_data: pd.DataFrame,
    n_regimes:  int = 3,
    window:     int = 20,
) -> pd.DataFrame:
    """Cluster bars into volatility/trend regimes using K-Means."""
    df = price_data.copy()
    df["Returns"]   = df["Close"].pct_change()
    df["Volatility"]= df["Returns"].rolling(window).std() * np.sqrt(252)
    df["SMA20"]     = df["Close"].rolling(20).mean()
    df["SMA50"]     = df["Close"].rolling(50).mean()
    df["Trend"]     = df["SMA20"] / df["SMA50"].replace(0, np.nan) - 1
    df["HL_Range"]  = (df["High"] - df["Low"]) / df["Close"].replace(0, np.nan)

    regime_features = df[["Volatility","Trend","HL_Range"]].dropna()
    scaler          = StandardScaler()
    scaled          = scaler.fit_transform(regime_features)

    km     = KMeans(n_clusters=n_regimes, random_state=42, n_init=10)
    labels = km.fit_predict(scaled)

    chars = pd.DataFrame(km.cluster_centers_, columns=["Volatility","Trend","HL_Range"])
    sorted_by_vol = chars.sort_values("Volatility").index
    remap = {old: new for new, old in enumerate(sorted_by_vol)}

    df["Market_Regime"] = np.nan
    df.loc[regime_features.index, "Market_Regime"] = [remap[l] for l in labels]
    df["Market_Regime"] = df["Market_Regime"].ffill()

    def _desc(i):
        v = chars.loc[sorted_by_vol[i], "Volatility"]
        t = chars.loc[sorted_by_vol[i], "Trend"]
        vol_d  = "High Vol"  if v > 0.5 else "Low Vol"
        tend_d = "Bullish" if t > 0.01 else ("Bearish" if t < -0.01 else "Ranging")
        return f"{tend_d} {vol_d}"

    df["Regime_Description"] = df["Market_Regime"].apply(
        lambda x: _desc(int(x)) if pd.notna(x) else np.nan
    )
    return df


# ─── Feature importance ────────────────────────────────────────────────────────

def analyze_features(
    price_data:       pd.DataFrame,
    target_horizons:  list[int] = [1, 5, 10, 20],
    plot:             bool = True,
    output_plot_dir:  Path = OUTPUT_ROOT / "plots",
    output_data_dir:  Path = OUTPUT_ROOT / "data",
) -> tuple[dict, pd.DataFrame]:
    """
    Compute RF + F-regression feature importance for each forecast horizon.

    Parameters
    ----------
    price_data        : raw OHLCV DataFrame
    target_horizons   : list of bar-ahead horizons
    plot              : write PNG files if True
    output_plot_dir   : where to save plots (explicit — no global mutation)
    output_data_dir   : where to save CSVs

    Returns
    -------
    (importance_results, enhanced_data)
    """
    output_plot_dir.mkdir(parents=True, exist_ok=True)
    output_data_dir.mkdir(parents=True, exist_ok=True)

    df_targets = price_data.copy()
    for h in target_horizons:
        df_targets[f"Future_Return_{h}d"] = (
            df_targets["Close"].pct_change(h).shift(-h)
        )

    eng = FeatureEngineer(df_targets)
    eng.add_basic_features()
    eng.add_macd()
    eng.add_bollinger_bands()
    eng.add_rsi()
    eng.add_atr()
    if "Volume" in price_data.columns:
        eng.add_obv()
        eng.add_vwap()
    eng.add_volatility_metrics()
    eng.add_trend_indicators()
    eng.add_momentum_indicators()

    enhanced = eng.get_data()
    enhanced.to_csv(output_data_dir / "enhanced_data.csv")

    importance_results: dict[int, pd.DataFrame] = {}

    for h in target_horizons:
        target_col = f"Future_Return_{h}d"
        log.info("Analysing importance for %d-bar horizon …", h)

        df_h = enhanced.dropna().copy()
        drop = [f"Future_Return_{x}d" for x in target_horizons]
        X    = df_h.drop(columns=drop, errors="ignore").select_dtypes(include=["float64","int64"])
        y    = df_h[target_col]

        if len(X) < 50:
            log.warning("Too few rows (%d) for horizon %d — skipping.", len(X), h)
            continue

        # Random Forest importance
        rf  = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
        rf.fit(X, y)
        rf_imp = pd.DataFrame({"Feature": X.columns, "Importance": rf.feature_importances_})

        # F-regression importance
        sel  = SelectKBest(score_func=f_regression, k="all")
        sel.fit(X, y)
        f_imp = pd.DataFrame({"Feature": X.columns, "Importance": sel.scores_})

        rf_imp["RF_Norm"] = rf_imp["Importance"] / rf_imp["Importance"].max()
        f_imp["F_Norm"]   = f_imp["Importance"]  / f_imp["Importance"].max()

        merged = pd.merge(
            rf_imp[["Feature","RF_Norm"]],
            f_imp[["Feature","F_Norm"]],
            on="Feature",
        )
        merged["Combined_Score"] = (merged["RF_Norm"] + merged["F_Norm"]) / 2
        merged = merged.sort_values("Combined_Score", ascending=False).reset_index(drop=True)

        importance_results[h] = merged
        merged.to_csv(output_data_dir / f"feature_importance_{h}d.csv", index=False)

        if plot:
            fig, ax = plt.subplots(figsize=(12, 10))
            sns.barplot(x="Combined_Score", y="Feature", data=merged.head(20), ax=ax)
            ax.set_title(f"Top 20 Features — {h}-bar forward return")
            fig.tight_layout()
            fig.savefig(output_plot_dir / f"top_features_{h}d.png", dpi=150)
            plt.close(fig)

    return importance_results, enhanced


# ─── Correlation analysis ─────────────────────────────────────────────────────

def analyze_feature_correlations(
    enhanced_data:   pd.DataFrame,
    top_n:           int = 30,
    output_plot_dir: Path = OUTPUT_ROOT / "plots",
    output_data_dir: Path = OUTPUT_ROOT / "data",
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Correlation matrix of top features across all horizons."""
    output_plot_dir.mkdir(parents=True, exist_ok=True)
    output_data_dir.mkdir(parents=True, exist_ok=True)

    csv_files = list(output_data_dir.glob("feature_importance_*d.csv"))
    if not csv_files:
        raise FileNotFoundError(
            f"No feature_importance_*d.csv files found in {output_data_dir}. "
            "Run analyze_features() first."
        )

    top_features: list[str] = []
    for f in sorted(csv_files):
        df_imp = pd.read_csv(f)
        top_features.extend(df_imp["Feature"].head(top_n).tolist())

    # Deduplicate preserving order
    seen: set[str] = set()
    unique_features = [
        f for f in top_features if f not in seen and not seen.add(f)  # type: ignore[func-returns-value]
    ][:top_n]

    # Only keep features that exist in enhanced_data
    available = [f for f in unique_features if f in enhanced_data.columns]
    if not available:
        log.warning("None of the top features found in enhanced_data — returning empty.")
        return pd.DataFrame(), pd.DataFrame()

    corr = enhanced_data[available].corr()
    corr.to_csv(output_data_dir / "feature_correlations.csv")

    fig, ax = plt.subplots(figsize=(16, 14))
    mask = np.triu(np.ones_like(corr, dtype=bool))
    sns.heatmap(corr, mask=mask, cmap="RdBu_r", vmax=1, vmin=-1, center=0,
                square=True, linewidths=0.3, ax=ax)
    ax.set_title("Feature Correlation Matrix")
    fig.tight_layout()
    fig.savefig(output_plot_dir / "feature_correlations.png", dpi=150)
    plt.close(fig)

    high_corr = []
    for i in range(len(corr.columns)):
        for j in range(i + 1, len(corr.columns)):
            val = corr.iloc[i, j]
            if abs(val) > 0.8:
                high_corr.append({"Feature1": corr.columns[i],
                                   "Feature2": corr.columns[j],
                                   "Correlation": val})

    high_corr_df = pd.DataFrame(high_corr).sort_values("Correlation", ascending=False)
    high_corr_df.to_csv(output_data_dir / "highly_correlated_features.csv", index=False)
    log.info("High-correlation pairs (|r| > 0.8): %d", len(high_corr_df))
    return corr, high_corr_df


# ─── Feature stability ────────────────────────────────────────────────────────

def analyze_feature_stability(
    enhanced_with_regimes: pd.DataFrame,
    top_features:          Optional[list[str]] = None,
    n_features:            int  = 20,
    output_plot_dir:       Path = OUTPUT_ROOT / "plots",
    output_data_dir:       Path = OUTPUT_ROOT / "data",
) -> tuple[dict, pd.DataFrame]:
    """Feature importance consistency across market regimes."""
    output_plot_dir.mkdir(parents=True, exist_ok=True)
    output_data_dir.mkdir(parents=True, exist_ok=True)

    if top_features is None:
        # FIX: try each horizon file, not just 1d
        candidate_files = sorted(output_data_dir.glob("feature_importance_*d.csv"))
        if not candidate_files:
            raise FileNotFoundError(
                f"No feature_importance_*d.csv found in {output_data_dir}. "
                "Run analyze_features() first."
            )
        imp_df      = pd.read_csv(candidate_files[0])
        top_features = imp_df["Feature"].head(n_features).tolist()
        log.info("Using features from %s", candidate_files[0].name)

    # Filter to features that exist in the dataframe
    top_features = [f for f in top_features if f in enhanced_with_regimes.columns]

    regimes          = enhanced_with_regimes["Market_Regime"].dropna().unique()
    regime_importance: dict[int, pd.DataFrame] = {}

    for regime in regimes:
        regime_data = enhanced_with_regimes[enhanced_with_regimes["Market_Regime"] == regime]
        if len(regime_data) < 100:
            log.info("Regime %s has only %d rows — skipping.", regime, len(regime_data))
            continue

        target = "Future_Return_1d"
        if target not in regime_data.columns:
            log.warning("'%s' column missing for regime %s — skipping.", target, regime)
            continue

        df_r = regime_data.dropna(subset=[target])
        X    = df_r[top_features].fillna(0)
        y    = df_r[target]

        rf = RandomForestRegressor(n_estimators=50, random_state=42, n_jobs=-1)
        rf.fit(X, y)

        imp_df = pd.DataFrame({"Feature": top_features,
                               "Importance": rf.feature_importances_})
        regime_importance[int(regime)] = imp_df

    if not regime_importance:
        log.warning("No regimes had enough data for stability analysis.")
        return {}, pd.DataFrame()

    # Stability = coefficient of variation across regimes
    stability_scores: dict[str, float] = {}
    for feat in top_features:
        vals = [
            imp_df.loc[imp_df["Feature"] == feat, "Importance"].iloc[0]
            for imp_df in regime_importance.values()
            if feat in imp_df["Feature"].values
        ]
        if len(vals) > 1 and np.mean(vals) > 0:
            stability_scores[feat] = np.std(vals) / np.mean(vals)

    stability_df = (
        pd.DataFrame([{"Feature": k, "Stability_Score": v}
                      for k, v in stability_scores.items()])
        .sort_values("Stability_Score")
        .reset_index(drop=True)
    )
    stability_df.to_csv(output_data_dir / "feature_stability.csv", index=False)

    fig, ax = plt.subplots(figsize=(12, 10))
    sns.barplot(x="Stability_Score", y="Feature", data=stability_df, ax=ax)
    ax.set_title("Feature Stability Across Regimes (lower = more stable)")
    fig.tight_layout()
    fig.savefig(output_plot_dir / "feature_stability.png", dpi=150)
    plt.close(fig)

    return regime_importance, stability_df


# ─── Optimal feature set builder ─────────────────────────────────────────────

def build_optimal_feature_set(
    output_data_dir: Path = OUTPUT_ROOT / "data",
    importance_weight: float = 0.7,
    stability_weight:  float = 0.3,
    top_n:             int   = 30,
) -> Path:
    """
    Merge importance + stability scores into a single ranked list.
    Writes optimal_feature_set.csv.
    Returns the path — pass to generate_features.generate_features().
    """
    imp_file = output_data_dir / "feature_importance_1d.csv"
    if not imp_file.exists():
        # Use first available horizon
        candidates = sorted(output_data_dir.glob("feature_importance_*d.csv"))
        if not candidates:
            raise FileNotFoundError("No feature importance CSVs found.")
        imp_file = candidates[0]

    stab_file = output_data_dir / "feature_stability.csv"
    if not stab_file.exists():
        raise FileNotFoundError(
            f"feature_stability.csv not found in {output_data_dir}. "
            "Run analyze_feature_stability() first."
        )

    imp  = pd.read_csv(imp_file).rename(columns={"Combined_Score": "Importance"})
    stab = pd.read_csv(stab_file)

    merged = pd.merge(imp[["Feature","Importance"]], stab, on="Feature", how="inner")
    merged["Norm_Importance"] = merged["Importance"]       / merged["Importance"].max()
    merged["Norm_Stability"]  = 1 - (merged["Stability_Score"] / merged["Stability_Score"].max())
    merged["Overall_Score"]   = (importance_weight * merged["Norm_Importance"] +
                                  stability_weight  * merged["Norm_Stability"])
    merged = merged.sort_values("Overall_Score", ascending=False).reset_index(drop=True)

    out = output_data_dir / "optimal_feature_set.csv"
    merged.to_csv(out, index=False)
    log.info("Optimal feature set written: %s (%d features)", out, len(merged))
    return out


def load_optimal_features(
    csv_path: Path,
    top_n: int = 30,
) -> list[str]:
    """
    Read the optimal_feature_set.csv produced by build_optimal_feature_set()
    and return the top-N feature names.

    Pass the result directly to generate_features.generate_features():
        df = generate_features(df_raw, keep_features=load_optimal_features(path))
    """
    df = pd.read_csv(csv_path)
    return df["Feature"].head(top_n).tolist()


# ─── Full pipeline ────────────────────────────────────────────────────────────

def run_feature_analysis(
    symbols:    list[str] = ["SPY","AAPL","MSFT","QQQ","AMZN"],
    start_date: str = "2018-01-01",
    end_date:   str = "2023-01-01",
    source:     str = "yfinance",
    top_n:      int = 30,
) -> Optional[Path]:
    """
    Run the complete feature analysis pipeline for all symbols.

    Returns
    -------
    Path to optimal_feature_set.csv, or None if insufficient data.
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir   = OUTPUT_ROOT / f"run_{timestamp}"
    run_dir.mkdir(parents=True, exist_ok=True)

    log.info("Feature analysis — symbols=%s  period=%s to %s", symbols, start_date, end_date)

    data_dict = fetch_historical_data(symbols, start_date, end_date, source)

    optimal_path = None
    for symbol, price_data in data_dict.items():
        log.info("Processing %s …", symbol)
        sym_dir      = run_dir / symbol
        sym_plot_dir = sym_dir / "plots"
        sym_data_dir = sym_dir / "data"
        sym_dir.mkdir(exist_ok=True)
        sym_plot_dir.mkdir(exist_ok=True)
        sym_data_dir.mkdir(exist_ok=True)

        try:
            imp_results, enhanced = analyze_features(
                price_data,
                output_plot_dir=sym_plot_dir,
                output_data_dir=sym_data_dir,
            )
            enhanced_with_regimes = identify_market_regimes(enhanced)
            enhanced_with_regimes.to_csv(sym_data_dir / "data_with_regimes.csv")

            analyze_feature_correlations(
                enhanced,
                top_n=top_n,
                output_plot_dir=sym_plot_dir,
                output_data_dir=sym_data_dir,
            )
            analyze_feature_stability(
                enhanced_with_regimes,
                n_features=top_n,
                output_plot_dir=sym_plot_dir,
                output_data_dir=sym_data_dir,
            )
            optimal_path = build_optimal_feature_set(
                output_data_dir=sym_data_dir,
                top_n=top_n,
            )
            log.info("%s complete. Optimal features → %s", symbol, optimal_path)

        except Exception as e:
            log.error("Error processing %s: %s", symbol, e, exc_info=True)

    return optimal_path


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    path = run_feature_analysis(
        symbols    = ["SPY","AAPL","MSFT","QQQ","AMZN"],
        start_date = "2018-01-01",
        end_date   = "2023-01-01",
    )
    if path:
        features = load_optimal_features(path)
        print(f"\nTop features for training pipeline ({len(features)}):")
        for i, f in enumerate(features, 1):
            print(f"  {i:2d}. {f}")
        print(f"\nPass to generate_features:")
        print(f"  df = generate_features(df_raw, keep_features={features[:5]}...)")
