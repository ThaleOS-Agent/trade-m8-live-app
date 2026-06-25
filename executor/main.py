"""
executor/main.py  —  XQ Trade M8 Python Execution Node
========================================================
FastAPI service deployed on AWS Tokyo (ap-northeast-1).
Called by the Cloudflare Worker via HTTPS for order placement,
risk evaluation, and backtest runs.

The Cloudflare Worker cannot run Python. This service bridges
the gap — it holds the Python engine (execute_trade.py,
riskmanager.py, entry_exit_logic.py, backtest_engine.py) and
exposes them over a secure REST API.

Endpoints
---------
GET  /health               — liveness probe (called by Worker every 5 min)
POST /risk/evaluate        — size a position, check all daily gates
POST /execute              — place an order (paper or live)
POST /execute/close        — close an open position
POST /backtest             — run a full backtest cycle and return metrics
POST /features/run         — run analyze_features + generate_features pipeline
GET  /features/optimal     — return current optimal feature list
GET  /status               — executor state, paper mode flag, session stats

Security
--------
Every request must include:
  Authorization: Bearer <EXECUTOR_SECRET>

EXECUTOR_SECRET is set in both:
  - This service's environment (AWS SSM or .env)
  - Cloudflare Worker secrets (wrangler pages secret put EXECUTOR_SECRET)

Start
-----
  uvicorn executor.main:app --host 0.0.0.0 --port 8000 --workers 2
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd
import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

# ── Local engine imports (from functions/python/) ─────────────────────────────
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'functions', 'python'))

from execute_trade import execute_trade as _execute_trade, TradeResult
from riskmanager   import RiskManager, size_position, SizingResult
from entry_exit_logic import EntryExitEngine, EngineConfig, MarketBar, EngineAction
from analyze_features import run_feature_analysis, load_optimal_features
from generate_features import generate_features, create_labels

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
log = logging.getLogger("executor")

# ── Config ────────────────────────────────────────────────────────────────────
EXECUTOR_SECRET = os.getenv("EXECUTOR_SECRET", "")
PAPER_MODE      = os.getenv("PAPER_MODE", "true").lower() == "true"

if not EXECUTOR_SECRET:
    log.warning("EXECUTOR_SECRET not set — all requests will be rejected")

# ── Global risk manager (stateful session) ────────────────────────────────────
_risk_manager: Optional[RiskManager] = None
_optimal_features: Optional[list[str]] = None
_startup_time = time.time()

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _risk_manager
    initial_equity = float(os.getenv("INITIAL_EQUITY", "10000"))
    _risk_manager = RiskManager(initial_equity=initial_equity)
    log.info("RiskManager initialised: equity=$%.2f  paper=%s", initial_equity, PAPER_MODE)
    yield
    log.info("Executor shutting down. Session summary: %s", _risk_manager.summary() if _risk_manager else "n/a")

app = FastAPI(
    title="XQ Trade M8 — Python Executor",
    description="Order execution and risk management service for the Cloudflare Worker",
    version="1.0.0",
    lifespan=lifespan,
)

# ── Auth ──────────────────────────────────────────────────────────────────────
bearer = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Security(bearer)):
    if not EXECUTOR_SECRET:
        raise HTTPException(status_code=500, detail="EXECUTOR_SECRET not configured on server")
    if credentials.credentials != EXECUTOR_SECRET:
        raise HTTPException(status_code=401, detail="Invalid executor token")
    return True

# ── Request / Response models ─────────────────────────────────────────────────

class RiskEvaluateRequest(BaseModel):
    entry_price: float
    high_arr:    list[float] = Field(..., min_length=15)
    low_arr:     list[float] = Field(..., min_length=15)
    close_arr:   list[float] = Field(..., min_length=15)
    side:        str = "LONG"
    confidence:  float = 1.0
    equity_override: Optional[float] = None  # for stateless sizing

class RiskEvaluateResponse(BaseModel):
    approved:      bool
    units:         float
    sl:            float
    tp:            float
    atr:           float
    risk_amount:   float
    reject_reason: Optional[str] = None
    paper_mode:    bool

class ExecuteRequest(BaseModel):
    symbol:      str
    action:      str           # 'BUY' | 'SELL'
    units:       float
    entry_price: float
    exchange:    str = ""
    force_twap:  bool = False

class ExecuteResponse(BaseModel):
    success:       bool
    order_id:      str
    symbol:        str
    side:          str
    filled_qty:    float
    fill_price:    float
    fee:           float
    order_type:    str
    exchange:      str
    paper_mode:    bool
    error:         str = ""
    timestamp:     str

class CloseRequest(BaseModel):
    symbol:     str
    side:       str     # side of the OPEN position ('BUY'=long, 'SELL'=short)
    units:      float
    entry_price: float
    exit_price: float
    exchange:   str = ""

class CloseResponse(BaseModel):
    success:    bool
    net_pnl:    float
    order_id:   str
    paper_mode: bool
    error:      str = ""

class BacktestRequest(BaseModel):
    csv_data:    Optional[str] = None    # inline CSV text (small datasets)
    csv_path:    Optional[str] = None    # path on executor filesystem (large)
    model_path:  str = "models/transformer_trading_model.pth"
    seq_len:     int = 60
    initial_capital: float = 10_000.0

class BacktestResponse(BaseModel):
    roi_pct:        float
    win_rate:       float
    sharpe:         float
    max_drawdown:   float
    total_trades:   int
    profit_factor:  float
    avg_r:          float
    net_pnl:        float
    provenance:     str

class FeaturesRunRequest(BaseModel):
    symbols:    list[str] = ["SPY", "AAPL"]
    start_date: str = "2020-01-01"
    end_date:   str = "2024-01-01"
    source:     str = "yfinance"
    top_n:      int = 30

class StatusResponse(BaseModel):
    status:          str
    paper_mode:      bool
    uptime_seconds:  float
    equity:          float
    total_trades:    int
    win_rate:        float
    daily_pnl:       float
    optimal_features_loaded: bool
    version:         str = "1.0.0"

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Liveness probe — no auth required."""
    return {
        "status": "ok",
        "paper_mode": PAPER_MODE,
        "uptime_s": round(time.time() - _startup_time, 1),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/status", response_model=StatusResponse)
def status_endpoint(_: bool = Depends(verify_token)):
    rm = _risk_manager
    if not rm:
        raise HTTPException(503, "RiskManager not initialised")
    s = rm.summary()
    return StatusResponse(
        status="running",
        paper_mode=PAPER_MODE,
        uptime_seconds=round(time.time() - _startup_time, 1),
        equity=s["equity"],
        total_trades=s["total_trades"],
        win_rate=s["win_rate"],
        daily_pnl=s["daily_pnl"],
        optimal_features_loaded=_optimal_features is not None,
    )


@app.post("/risk/evaluate", response_model=RiskEvaluateResponse)
def risk_evaluate(req: RiskEvaluateRequest, _: bool = Depends(verify_token)):
    """
    Evaluate a potential entry using the stateful RiskManager.
    Returns approved=True with units, SL, TP if all gates pass.
    Returns approved=False with reject_reason if any gate fails.
    """
    rm = _risk_manager
    if not rm:
        raise HTTPException(503, "RiskManager not initialised")

    high  = np.array(req.high_arr,  dtype=float)
    low   = np.array(req.low_arr,   dtype=float)
    close = np.array(req.close_arr, dtype=float)

    result: SizingResult = rm.evaluate(
        entry_price=req.entry_price,
        high_arr=high,
        low_arr=low,
        close_arr=close,
        side=req.side.upper(),
        confidence=req.confidence,
    )

    return RiskEvaluateResponse(
        approved      = result.approved,
        units         = result.units,
        sl            = result.sl,
        tp            = result.tp,
        atr           = result.atr,
        risk_amount   = result.risk_amount,
        reject_reason = result.reject_reason,
        paper_mode    = PAPER_MODE,
    )


@app.post("/execute", response_model=ExecuteResponse)
def execute(req: ExecuteRequest, _: bool = Depends(verify_token)):
    """
    Place an order via execute_trade.py.

    If PAPER_MODE=true (default), simulates the fill at entry_price.
    If PAPER_MODE=false, routes to Binance or OANDA via the real API.

    On success, updates the RiskManager open_trade count.
    """
    rm = _risk_manager
    if not rm:
        raise HTTPException(503, "RiskManager not initialised")

    result: TradeResult = _execute_trade(
        symbol   = req.symbol,
        action   = req.action,
        amount   = req.units,
        price    = req.entry_price,
        exchange = req.exchange,
        twap     = req.force_twap,
    )

    if result.success:
        # Track open position in risk manager
        from riskmanager import SizingResult as SR
        # Minimal SizingResult — the risk eval happened before this call
        rm._open_count += 1
        rm._today().trade_count += 1

    log.info(
        "EXECUTE %s %s %s qty=%.4f fill=%.5f ok=%s paper=%s",
        req.action, req.symbol, req.exchange,
        req.units, result.fill_price, result.success, PAPER_MODE,
    )

    return ExecuteResponse(
        success    = result.success,
        order_id   = result.order_id,
        symbol     = result.symbol,
        side       = result.side,
        filled_qty = result.filled_qty,
        fill_price = result.fill_price,
        fee        = result.fee,
        order_type = result.order_type,
        exchange   = result.exchange,
        paper_mode = PAPER_MODE,
        error      = result.error,
        timestamp  = datetime.now(timezone.utc).isoformat(),
    )


@app.post("/execute/close", response_model=CloseResponse)
def execute_close(req: CloseRequest, _: bool = Depends(verify_token)):
    """
    Close an open position and update the RiskManager with realised P&L.
    """
    rm = _risk_manager
    if not rm:
        raise HTTPException(503, "RiskManager not initialised")

    close_side = "SELL" if req.side.upper() == "BUY" else "BUY"
    result: TradeResult = _execute_trade(
        symbol   = req.symbol,
        action   = close_side,
        amount   = req.units,
        price    = req.exit_price,
        exchange = req.exchange,
    )

    if result.success:
        gross = (req.exit_price - req.entry_price) * req.units
        if req.side.upper() == "SELL":
            gross = -gross  # short position
        net_pnl = gross - result.fee
        rm.close_trade(pnl=net_pnl)
        log.info("CLOSED %s %s pnl=$%.2f", req.symbol, req.side, net_pnl)
    else:
        net_pnl = 0.0

    return CloseResponse(
        success    = result.success,
        net_pnl    = round(net_pnl, 4),
        order_id   = result.order_id,
        paper_mode = PAPER_MODE,
        error      = result.error,
    )


@app.post("/backtest", response_model=BacktestResponse)
def backtest(req: BacktestRequest, _: bool = Depends(verify_token)):
    """
    Run a full backtest using backtest_engine.py.
    Accepts inline CSV text (small datasets < 5MB) or a server-side path.
    Returns metrics with BACKTEST_SYNTHETIC provenance label.
    """
    from backtest_engine import run_backtest, BacktestConfig
    import io, tempfile

    if req.csv_data:
        # Write inline CSV to temp file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            f.write(req.csv_data)
            data_path = f.name
    elif req.csv_path:
        data_path = req.csv_path
    else:
        raise HTTPException(400, "Provide csv_data (inline) or csv_path (server path)")

    try:
        cfg = BacktestConfig(
            data_path       = data_path,
            model_path      = req.model_path,
            seq_len         = req.seq_len,
            initial_capital = req.initial_capital,
        )
        results = run_backtest(cfg)
    except SystemExit as e:
        raise HTTPException(422, str(e))

    return BacktestResponse(
        roi_pct       = round(results.get("roi_pct", 0), 4),
        win_rate      = round(results.get("win_rate", 0), 4),
        sharpe        = round(results.get("sharpe", 0), 4),
        max_drawdown  = round(results.get("max_drawdown", 0), 4),
        total_trades  = results.get("total_trades", 0),
        profit_factor = round(results.get("profit_factor", 0), 4),
        avg_r         = round(results.get("avg_r", 0), 4),
        net_pnl       = round(results.get("net_pnl", 0), 4),
        provenance    = results.get("provenance", "BACKTEST_SYNTHETIC"),
    )


@app.post("/features/run")
def features_run(req: FeaturesRunRequest, _: bool = Depends(verify_token)):
    """
    Run the full feature analysis pipeline (analyze_features.py).
    Writes optimal_feature_set.csv to disk and caches the feature list
    in memory for subsequent /features/optimal calls.
    Returns the top-N optimal features.
    """
    global _optimal_features

    log.info("Starting feature analysis: symbols=%s", req.symbols)
    try:
        csv_path = run_feature_analysis(
            symbols    = req.symbols,
            start_date = req.start_date,
            end_date   = req.end_date,
            source     = req.source,
            top_n      = req.top_n,
        )
    except Exception as e:
        raise HTTPException(500, f"Feature analysis failed: {e}")

    if csv_path is None:
        raise HTTPException(422, "No data returned — check symbols and date range")

    features = load_optimal_features(csv_path, top_n=req.top_n)
    _optimal_features = features

    log.info("Optimal features loaded: %d features", len(features))
    return {
        "status": "complete",
        "features": features,
        "count": len(features),
        "csv_path": str(csv_path),
    }


@app.get("/features/optimal")
def features_optimal(_: bool = Depends(verify_token)):
    """Return the cached optimal feature list from the last /features/run call."""
    if _optimal_features is None:
        raise HTTPException(404, "No optimal features loaded. POST /features/run first.")
    return {"features": _optimal_features, "count": len(_optimal_features)}


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, workers=2, reload=False)
