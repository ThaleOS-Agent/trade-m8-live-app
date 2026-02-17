#!/usr/bin/env python3
import urllib.request, urllib.error, json, ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BASE = "https://trade-m8-live-app.pages.dev"

def req(method, path, data=None, token=None):
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; TradeM8Test/1.0)",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data else None
    r = urllib.request.Request(f"{BASE}{path}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            try:
                return json.loads(raw), resp.status
            except:
                return {"raw": raw[:200]}, resp.status
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode()), e.code
        except:
            return {"error": str(e)}, e.code

print("=" * 60)
print("TRADE M8 LIVE ENDPOINT TEST")
print("=" * 60)

# 1. Health
d, code = req("GET", "/api/health")
print(f"\n[{code}] GET /api/health")
print(f"  status: {d.get('status')} | version: {d.get('version')}")

# 2. Register
d, code = req("POST", "/api/auth/register", {"email": "testuser@trade-m8.app", "password": "TestPass123!", "fullName": "Test User"})
print(f"\n[{code}] POST /api/auth/register")
print(f"  success: {d.get('success')} | has_token: {bool(d.get('token'))} | error: {d.get('error', 'none')}")

# 3. Login
d, code = req("POST", "/api/auth/login", {"email": "testuser@trade-m8.app", "password": "TestPass123!"})
print(f"\n[{code}] POST /api/auth/login")
print(f"  success: {d.get('success')} | user: {d.get('user', {}).get('email')} | error: {d.get('error', 'none')}")
token = d.get("token", "")

# 4. Get Bots
d, code = req("GET", "/api/bots", token=token)
print(f"\n[{code}] GET /api/bots")
print(f"  bots: {len(d.get('bots', []))} | error: {d.get('error', 'none')}")

# 5. Create Bot
d, code = req("POST", "/api/bots", {"name": "Test BTC Bot", "strategy": "momentum", "symbol": "BTC/USDT", "exchange": "binance"}, token=token)
print(f"\n[{code}] POST /api/bots")
print(f"  success: {d.get('success')} | botId: {d.get('botId', 'none')[:8] + '...' if d.get('botId') else 'none'} | error: {d.get('error', 'none')}")
bot_id = d.get("botId", "")

# 6. Start Bot
if bot_id:
    d, code = req("POST", f"/api/bots/{bot_id}/start", token=token)
    print(f"\n[{code}] POST /api/bots/:id/start")
    print(f"  success: {d.get('success')} | status: {d.get('status')} | error: {d.get('error', 'none')}")

# 7. Portfolio
d, code = req("GET", "/api/portfolio", token=token)
print(f"\n[{code}] GET /api/portfolio")
print(f"  ok: {'error' not in d} | error: {d.get('error', 'none')}")

# 8. Trades
d, code = req("GET", "/api/trades", token=token)
print(f"\n[{code}] GET /api/trades")
print(f"  trades: {len(d.get('trades', []))} | error: {d.get('error', 'none')}")

# 9. Analytics
d, code = req("GET", "/api/analytics", token=token)
print(f"\n[{code}] GET /api/analytics")
print(f"  ok: {'error' not in d} | error: {d.get('error', 'none')}")

# 10. Market Data (public)
d, code = req("GET", "/api/market?symbols=bitcoin,ethereum")
print(f"\n[{code}] GET /api/market")
print(f"  ok: {'error' not in d} | error: {d.get('error', 'none')}")

# 11. Algo Trading Status
d, code = req("GET", "/api/algo-trading/status", token=token)
print(f"\n[{code}] GET /api/algo-trading/status")
print(f"  exchanges: {d.get('connectedExchanges', [])} | error: {d.get('error', 'none')}")

# 12. Algo Trading Balances
d, code = req("GET", "/api/algo-trading/balances", token=token)
print(f"\n[{code}] GET /api/algo-trading/balances")
print(f"  ok: {'error' not in d} | exchanges_returned: {list(d.get('balances', {}).keys())}")

# 13. Unauthenticated check
d, code = req("GET", "/api/bots")
print(f"\n[{code}] GET /api/bots (no token)")
print(f"  correctly rejected: {code == 401}")

print("\n" + "=" * 60)
print("TEST COMPLETE")
print("=" * 60)
