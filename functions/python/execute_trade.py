"""
execute_trade.py  —  XQ Trade M8
===================================
Exchange order routing — Binance (crypto) and OANDA (forex/gold).

Replaces the original 3-line stub with a production router that:
  - Selects order type by trade size (MARKET < threshold, TWAP above it)
  - Loads credentials from environment variables only — no hardcoded values
  - Returns a normalised TradeResult regardless of exchange
  - Handles exchange errors with retry and structured logging
  - Validates position size against risk limits before sending
  - Supports paper mode — simulates fills without sending live orders
  - Exposes a single execute_trade() entry point for backward compatibility

Environment variables required
-------------------------------
BINANCE_API_KEY     — Binance HMAC key
BINANCE_SECRET      — Binance HMAC secret
OANDA_API_KEY       — OANDA bearer token
OANDA_ACCOUNT       — OANDA account ID
OANDA_ENV           — "practice" | "live"  (default: practice)
PAPER_MODE          — "true" | "false"     (default: true — SAFE)

Order type routing (Binance Algo API)
--------------------------------------
< TWAP_THRESHOLD_USD  →  MARKET order   (immediate fill, small size)
≥ TWAP_THRESHOLD_USD  →  TWAP order     (sliced over duration, large size)

TWAP is available at:  POST /sapi/v1/algo/spot/newOrderTwap
VP   is available at:  POST /sapi/v1/algo/futures/newOrderVp
Both are in Binance_Algo_API.json
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger("execute_trade")

# ─── Config ───────────────────────────────────────────────────────────────────

PAPER_MODE          = os.getenv("PAPER_MODE", "true").lower() == "true"
TWAP_THRESHOLD_USD  = float(os.getenv("TWAP_THRESHOLD_USD", "5000"))   # above this → TWAP
TWAP_DURATION_S     = int(os.getenv("TWAP_DURATION_S",     "300"))     # 5 min default
MAX_RETRIES         = int(os.getenv("EXEC_MAX_RETRIES",    "3"))
MAX_POSITION_USD    = float(os.getenv("MAX_POSITION_USD",  "50000"))   # hard cap

# ─── Binance credentials ──────────────────────────────────────────────────────
_BINANCE_KEY    = os.getenv("BINANCE_API_KEY", "")
_BINANCE_SECRET = os.getenv("BINANCE_SECRET",  "")
_BINANCE_BASE   = "https://api.binance.com"

# ─── OANDA credentials ────────────────────────────────────────────────────────
_OANDA_ENV    = os.getenv("OANDA_ENV", "practice")
_OANDA_TOKEN  = os.getenv("OANDA_API_KEY", "")
_OANDA_ACCT   = os.getenv("OANDA_ACCOUNT", "")
_OANDA_BASE   = (
    "https://api-fxtrade.oanda.com"
    if _OANDA_ENV == "live"
    else "https://api-fxpractice.oanda.com"
)

# ─── Result dataclass ─────────────────────────────────────────────────────────

@dataclass
class TradeResult:
    success:      bool
    symbol:       str
    side:         str               # 'BUY' | 'SELL'
    requested_qty: float
    filled_qty:   float = 0.0
    fill_price:   float = 0.0
    order_id:     str   = ""
    order_type:   str   = ""        # 'MARKET' | 'TWAP' | 'OANDA_MARKET' | 'PAPER'
    fee:          float = 0.0
    fee_currency: str   = ""
    exchange:     str   = ""
    timestamp:    int   = field(default_factory=lambda: int(time.time() * 1000))
    error:        str   = ""
    paper_mode:   bool  = False


# ─── HTTP session with retry ──────────────────────────────────────────────────

def _session() -> requests.Session:
    s     = requests.Session()
    retry = Retry(
        total=MAX_RETRIES,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["POST", "GET"],
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s


_sess = _session()


# ─── Binance HMAC signature ────────────────────────────────────────────────────

def _binance_sign(params: dict) -> dict:
    params["timestamp"] = int(time.time() * 1000)
    query = urllib.parse.urlencode(params)
    sig   = hmac.new(
        _BINANCE_SECRET.encode(), query.encode(), hashlib.sha256
    ).hexdigest()
    params["signature"] = sig
    return params


def _binance_headers() -> dict:
    return {"X-MBX-APIKEY": _BINANCE_KEY, "Content-Type": "application/json"}


# ─── Validation ───────────────────────────────────────────────────────────────

def _validate(symbol: str, side: str, quantity: float, price: float) -> Optional[str]:
    """Return an error string if validation fails, else None."""
    if side not in ("BUY", "SELL"):
        return f"Invalid side '{side}'. Must be BUY or SELL."
    if quantity <= 0:
        return f"Quantity must be positive, got {quantity}."
    if price <= 0:
        return f"Price must be positive, got {price}."
    notional = quantity * price
    if notional > MAX_POSITION_USD:
        return (
            f"Notional ${notional:,.0f} exceeds MAX_POSITION_USD ${MAX_POSITION_USD:,.0f}. "
            "Reduce position size or raise the limit."
        )
    return None


# ─── Paper mode ───────────────────────────────────────────────────────────────

def _paper_fill(
    symbol: str, side: str, quantity: float, price: float, exchange: str
) -> TradeResult:
    """Simulate a fill at current price — no order sent."""
    log.info(
        "[PAPER] %s %s qty=%.4f price=%.5f exchange=%s",
        side, symbol, quantity, price, exchange,
    )
    return TradeResult(
        success=True, symbol=symbol, side=side,
        requested_qty=quantity, filled_qty=quantity,
        fill_price=price, order_id=f"PAPER-{int(time.time()*1000)}",
        order_type="PAPER", exchange=exchange, paper_mode=True,
    )


# ─── Binance MARKET order ────────────────────────────────────────────────────

def _binance_market(symbol: str, side: str, quantity: float) -> TradeResult:
    """
    POST /api/v3/order  type=MARKET
    Fills immediately at best available price.
    Used for orders below TWAP_THRESHOLD_USD.
    """
    # Binance symbol format: no slash (BTCUSDT not BTC/USDT)
    binance_symbol = symbol.replace("/", "").upper()
    params = _binance_sign({
        "symbol":   binance_symbol,
        "side":     side,
        "type":     "MARKET",
        "quantity": f"{quantity:.8f}",
    })

    try:
        r = _sess.post(
            f"{_BINANCE_BASE}/api/v3/order",
            params=params,
            headers=_binance_headers(),
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        fills = data.get("fills", [])
        fill_price = (
            sum(float(f["price"]) * float(f["qty"]) for f in fills)
            / sum(float(f["qty"]) for f in fills)
            if fills else float(data.get("price", 0))
        )
        fee_fill = fills[0] if fills else {}
        return TradeResult(
            success=True, symbol=symbol, side=side,
            requested_qty=quantity,
            filled_qty=float(data.get("executedQty", 0)),
            fill_price=fill_price,
            order_id=str(data.get("orderId", "")),
            order_type="MARKET",
            fee=float(fee_fill.get("commission", 0)),
            fee_currency=fee_fill.get("commissionAsset", ""),
            exchange="BINANCE",
        )
    except requests.HTTPError as e:
        log.error("Binance MARKET order failed: %s — %s", e, e.response.text)
        return TradeResult(
            success=False, symbol=symbol, side=side,
            requested_qty=quantity, exchange="BINANCE",
            error=str(e.response.text),
        )


# ─── Binance TWAP order (Algo API) ────────────────────────────────────────────

def _binance_twap(
    symbol: str, side: str, quantity: float, duration_s: int
) -> TradeResult:
    """
    POST /sapi/v1/algo/spot/newOrderTwap
    Slices large orders over duration_s seconds to minimise market impact.
    Used for orders above TWAP_THRESHOLD_USD.
    From Binance_Algo_API.json.
    """
    binance_symbol = symbol.replace("/", "").upper()
    params = _binance_sign({
        "symbol":   binance_symbol,
        "side":     side,
        "quantity": f"{quantity:.8f}",
        "duration": duration_s,
    })

    try:
        r = _sess.post(
            f"{_BINANCE_BASE}/sapi/v1/algo/spot/newOrderTwap",
            params=params,
            headers=_binance_headers(),
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        return TradeResult(
            success=True, symbol=symbol, side=side,
            requested_qty=quantity, filled_qty=0.0,   # fills over time
            order_id=str(data.get("algoId", "")),
            order_type="TWAP",
            exchange="BINANCE",
        )
    except requests.HTTPError as e:
        log.error("Binance TWAP order failed: %s — %s", e, e.response.text)
        # Fallback to MARKET on TWAP failure
        log.warning("Falling back to MARKET order for %s", symbol)
        return _binance_market(symbol, side, quantity)


# ─── OANDA market order ───────────────────────────────────────────────────────

def _oanda_market(symbol: str, side: str, units: float) -> TradeResult:
    """
    POST /v3/accounts/{id}/orders  type=MARKET
    symbol: OANDA format, e.g. "EUR_USD" or "XAU_USD"
    units: positive = long (buy), negative = short (sell)
    """
    oanda_symbol = symbol.replace("/", "_").upper()
    signed_units = units if side == "BUY" else -units

    body = {
        "order": {
            "type": "MARKET",
            "instrument": oanda_symbol,
            "units": str(int(signed_units)),
            "timeInForce": "FOK",
            "positionFill": "DEFAULT",
        }
    }

    headers = {
        "Authorization": f"Bearer {_OANDA_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        r = _sess.post(
            f"{_OANDA_BASE}/v3/accounts/{_OANDA_ACCT}/orders",
            json=body,
            headers=headers,
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        fc   = data.get("orderFillTransaction", {})
        return TradeResult(
            success=True, symbol=symbol, side=side,
            requested_qty=units,
            filled_qty=abs(float(fc.get("units", 0))),
            fill_price=float(fc.get("price", 0)),
            order_id=str(fc.get("orderID", "")),
            order_type="OANDA_MARKET",
            fee=abs(float(fc.get("halfSpreadCost", 0))),
            fee_currency="USD",
            exchange="OANDA",
        )
    except requests.HTTPError as e:
        log.error("OANDA order failed: %s — %s", e, e.response.text)
        return TradeResult(
            success=False, symbol=symbol, side=side,
            requested_qty=units, exchange="OANDA",
            error=str(e.response.text),
        )


# ─── Exchange router ──────────────────────────────────────────────────────────

_BINANCE_ASSETS = {"BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "DOT"}
_OANDA_ASSETS   = {"EUR", "GBP", "JPY", "AUD", "CHF", "XAU", "XAG"}


def _route(symbol: str) -> str:
    """Determine exchange from symbol. Returns 'BINANCE' or 'OANDA'."""
    base = symbol.split("/")[0].upper()
    if base in _BINANCE_ASSETS:
        return "BINANCE"
    if base in _OANDA_ASSETS:
        return "OANDA"
    # Default to OANDA for forex pairs
    return "OANDA"


# ─── Public entry point ───────────────────────────────────────────────────────

def execute_trade(
    symbol:   str,
    action:   str,          # 'BUY' | 'SELL'  (or 'buy' | 'sell' — normalised)
    amount:   float,        # units (crypto) or units/1000 (forex)
    price:    float = 0.0,  # current market price — used for validation only
    exchange: str   = "",   # force a specific exchange; auto-detected if ""
    twap:     bool  = False,# force TWAP regardless of size
) -> TradeResult:
    """
    Execute a trade on the appropriate exchange.

    This is the single entry point — replaces the original stub.

    Parameters
    ----------
    symbol  : str    e.g. "BTC/USDT", "EUR/USD", "XAU/USD"
    action  : str    "BUY" or "SELL"
    amount  : float  Number of units to trade
    price   : float  Current mid price (for validation and paper fills)
    exchange: str    Override exchange: "BINANCE" | "OANDA" | ""
    twap    : bool   Force TWAP order type (large orders)

    Returns
    -------
    TradeResult  — always returned.  Check result.success before proceeding.
    """
    side = action.upper()
    if side not in ("BUY", "SELL"):
        log.error("Invalid action '%s' — must be BUY or SELL", action)
        return TradeResult(
            success=False, symbol=symbol, side=action,
            requested_qty=amount, error=f"Invalid action: {action}"
        )

    # Validate
    err = _validate(symbol, side, amount, price or 1.0)
    if err:
        log.error("Validation failed: %s", err)
        return TradeResult(
            success=False, symbol=symbol, side=side,
            requested_qty=amount, error=err
        )

    # Paper mode
    if PAPER_MODE:
        exch = exchange or _route(symbol)
        return _paper_fill(symbol, side, amount, price, exch)

    # Credential guard
    exch = exchange or _route(symbol)
    if exch == "BINANCE" and not (_BINANCE_KEY and _BINANCE_SECRET):
        return TradeResult(
            success=False, symbol=symbol, side=side,
            requested_qty=amount, exchange=exch,
            error="BINANCE_API_KEY and BINANCE_SECRET not set in environment."
        )
    if exch == "OANDA" and not (_OANDA_TOKEN and _OANDA_ACCT):
        return TradeResult(
            success=False, symbol=symbol, side=side,
            requested_qty=amount, exchange=exch,
            error="OANDA_API_KEY and OANDA_ACCOUNT not set in environment."
        )

    # Route
    notional = amount * (price or 1.0)
    log.info(
        "Routing %s %s qty=%.4f notional=$%.0f exchange=%s",
        side, symbol, amount, notional, exch,
    )

    if exch == "BINANCE":
        if twap or notional >= TWAP_THRESHOLD_USD:
            return _binance_twap(symbol, side, amount, TWAP_DURATION_S)
        return _binance_market(symbol, side, amount)

    if exch == "OANDA":
        return _oanda_market(symbol, side, amount)

    return TradeResult(
        success=False, symbol=symbol, side=side,
        requested_qty=amount, error=f"Unknown exchange: {exch}"
    )
