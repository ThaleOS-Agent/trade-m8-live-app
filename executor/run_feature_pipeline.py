"""
executor/run_feature_pipeline.py  —  XQ Trade M8
==================================================
One-shot script: run analyze_features.py → gate generate_features.py.

Run once to produce the optimal feature set, then the executor's
/features/optimal endpoint serves it to the live training pipeline.

Usage
-----
    cd trade-m8-live-app
    python3 executor/run_feature_pipeline.py

    # Override symbols / dates via env vars:
    SYMBOLS=BTC-USD,ETH-USD START=2021-01-01 END=2024-01-01 \\
        python3 executor/run_feature_pipeline.py

Output
------
    feature_analysis_results/run_<timestamp>/SPY/data/optimal_feature_set.csv
    feature_analysis_results/run_<timestamp>/SPY/plots/*.png

After this runs:
  1. Copy optimal_feature_set.csv path into training pipeline
  2. Or POST /features/run on the running executor to trigger it there
  3. Then call generate_features(df, keep_features=load_optimal_features(path))
"""

from __future__ import annotations

import os
import sys
import logging
from pathlib import Path

# Add Python engine to path
sys.path.insert(0, str(Path(__file__).parent.parent / "functions" / "python"))

from analyze_features import run_feature_analysis, load_optimal_features
from generate_features import generate_features, create_labels

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
log = logging.getLogger("feature_pipeline")


def main():
    # Config from env or defaults
    symbols_env = os.getenv("SYMBOLS", "SPY,AAPL,MSFT,QQQ")
    symbols     = [s.strip() for s in symbols_env.split(",")]
    start_date  = os.getenv("START", "2020-01-01")
    end_date    = os.getenv("END",   "2024-01-01")
    source      = os.getenv("SOURCE", "yfinance")
    top_n       = int(os.getenv("TOP_N", "30"))

    log.info("═══════════════════════════════════════════════════")
    log.info("XQ Trade M8 — Feature Pipeline")
    log.info("Symbols:    %s", symbols)
    log.info("Period:     %s → %s", start_date, end_date)
    log.info("Source:     %s", source)
    log.info("Top N:      %d", top_n)
    log.info("═══════════════════════════════════════════════════")

    # ── Step 1: Run full feature analysis ─────────────────────────────────────
    log.info("Step 1/3: Running feature analysis (RF importance + stability)...")
    optimal_csv = run_feature_analysis(
        symbols    = symbols,
        start_date = start_date,
        end_date   = end_date,
        source     = source,
        top_n      = top_n,
    )

    if optimal_csv is None:
        log.error("Feature analysis produced no output — check data source and date range")
        sys.exit(1)

    log.info("Optimal feature set written → %s", optimal_csv)

    # ── Step 2: Load optimal features ─────────────────────────────────────────
    log.info("Step 2/3: Loading optimal feature list...")
    top_features = load_optimal_features(optimal_csv, top_n=top_n)
    log.info("Optimal features (%d):", len(top_features))
    for i, f in enumerate(top_features, 1):
        log.info("  %2d. %s", i, f)

    # ── Step 3: Validate the gated pipeline on a small sample ─────────────────
    log.info("Step 3/3: Validating gated feature pipeline on sample data...")
    try:
        import yfinance as yf
        sample_sym = symbols[0]
        log.info("Fetching 200 bars of %s for validation...", sample_sym)
        df_raw = yf.Ticker(sample_sym).history(period="1y")
        df_raw.columns = [c.capitalize() for c in df_raw.columns]

        df_features = generate_features(df_raw, keep_features=top_features)
        df_labeled  = create_labels(df_features)

        log.info("Gated pipeline output: %d rows × %d features", df_labeled.shape[0], df_labeled.shape[1])
        log.info("Label distribution: Buy=%d  Hold=%d  Sell=%d",
            (df_labeled["Label"] == 2).sum(),
            (df_labeled["Label"] == 1).sum(),
            (df_labeled["Label"] == 0).sum(),
        )
        log.info("Columns: %s ... (+%d more)", list(df_labeled.columns[:8]), max(0, len(df_labeled.columns) - 8))

    except ImportError:
        log.warning("yfinance not available in this environment — skipping validation step")
    except Exception as e:
        log.warning("Validation step failed (%s) — optimal_feature_set.csv is still valid", e)

    # ── Summary ───────────────────────────────────────────────────────────────
    log.info("═══════════════════════════════════════════════════")
    log.info("Feature pipeline complete.")
    log.info("")
    log.info("To use in training:")
    log.info("  from analyze_features import load_optimal_features")
    log.info("  from generate_features import generate_features")
    log.info("")
    log.info("  features = load_optimal_features('%s')", optimal_csv)
    log.info("  df       = generate_features(df_raw, keep_features=features)")
    log.info("")
    log.info("To reload on the running executor:")
    log.info("  POST /features/run  (or the executor reloads on restart)")
    log.info("")
    log.info("Optimal CSV: %s", optimal_csv)
    log.info("═══════════════════════════════════════════════════")

    return optimal_csv


if __name__ == "__main__":
    main()
