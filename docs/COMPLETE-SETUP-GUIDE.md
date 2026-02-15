# 🚀 Complete XQ Trade M8 Setup & Testing Guide

## Current Status

✅ **Health endpoint:** Working
✅ **D1 Database:** Connected (registration works!)
⚠️ **KV Namespaces:** Need to be configured (login fails)
⏳ **Wallet Connect:** Ready to configure
⏳ **Exchange APIs:** Ready to configure
⏳ **Trading Bots:** Ready to configure

---

## PRIORITY 1: Configure Remaining Bindings (5 minutes)

### The D1 database works, but you still need to add KV and environment variables!

**Open this link:**
```
https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/settings/functions
```

### Add KV Namespace Bindings:

1. Scroll to **"KV namespace bindings"**
2. Click **"Add binding"** three times:

**Binding 1:**
- Variable: `CACHE`
- KV namespace: `9e4bace90bfa4c08931fb548114e3eb8`

**Binding 2:**
- Variable: `SESSIONS`
- KV namespace: `645380f3d22648409b9adac6c3c854bb`

**Binding 3:**
- Variable: `TRADES`
- KV namespace: `94f18f6e58d34fc38a4023f370142773`

3. Click **"Save"**

### Add Environment Variables:

**Go to:** https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/settings/environment-variables

Add these for **Production**:

```
JWT_SECRET = 83fb2608-846e-41d0-a66a-7d94503f1b3f (Encrypt ✓)
SUPABASE_URL = https://eeotzybkdjvorpxqgezz.supabase.co (Encrypt ✓)
SUPABASE_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlb3R6eWJrZGp2b3JweHFnZXp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NjQ1MDksImV4cCI6MjA4NjE0MDUwOX0.5VEHBoHPCsBPQn0FwPglgj3GzAPbsiDzIuKVSClUB3U (Encrypt ✓)
```

Click **"Save"** and wait 1-2 minutes for redeploy.

---

## Part 1: Test All API Endpoints

After configuring bindings above, run these tests:

### Test 1: Health Check ✅
```bash
curl https://01139140.trade-m8-production.pages.dev/api/health
```
**Expected:** `{"status":"healthy","version":"1.0.0"}`
**Result:** ✅ Working!

---

### Test 2: User Registration ✅
```bash
curl -X POST https://01139140.trade-m8-production.pages.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"trader@trade-m8.app","password":"secure123","fullName":"Pro Trader"}'
```
**Expected:** `{"success":true,"userId":"..."}`
**Result:** ✅ Working!

---

### Test 3: User Login (after KV configured)
```bash
curl -X POST https://01139140.trade-m8-production.pages.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"trader@trade-m8.app","password":"secure123"}'
```
**Expected:** `{"success":true,"token":"xxx.yyy.zzz","user":{...}}`

**Save the token for next tests!**

---

### Test 4: Create Trading Bot
```bash
# Replace YOUR_TOKEN with token from login
curl -X POST https://01139140.trade-m8-production.pages.dev/api/bots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "BTC Scalper",
    "strategy": "ensemble",
    "symbol": "BTC/USDT",
    "exchange": "binance",
    "riskLevel": "medium",
    "maxPositionSize": 0.02
  }'
```
**Expected:** `{"success":true,"botId":"..."}`

---

### Test 5: List Trading Bots
```bash
curl https://01139140.trade-m8-production.pages.dev/api/bots \
  -H "Authorization: Bearer YOUR_TOKEN"
```
**Expected:** `{"bots":[{...}]}`

---

### Test 6: Get Portfolio
```bash
curl https://01139140.trade-m8-production.pages.dev/api/portfolio \
  -H "Authorization: Bearer YOUR_TOKEN"
```
**Expected:** Portfolio data

---

### Test 7: Get Market Data
```bash
curl 'https://01139140.trade-m8-production.pages.dev/api/market?symbols=bitcoin,ethereum'
```
**Expected:** Market prices for BTC and ETH

---

## Part 2: Configure Wallet Connect (MetaMask Integration)

Your frontend already has Web3 integration! Here's how to enable it:

### Frontend Files Check:
```bash
# Your app already has these configured:
# - src/lib/web3.ts (Web3 utilities)
# - MetaMask connection in Login/Register pages
# - Wallet authentication flows
```

### Enable Wallet Connect:

1. **Visit your app:**
   ```
   https://01139140.trade-m8-production.pages.dev
   ```

2. **Click "Connect Wallet" button**

3. **MetaMask will pop up** (install if you don't have it)

4. **Approve the connection**

5. **You'll be logged in with your wallet address!**

### Test Wallet Connect:
```bash
# After connecting wallet, check if user was created
curl https://01139140.trade-m8-production.pages.dev/api/auth/wallet/0xYOUR_WALLET_ADDRESS
```

---

## Part 3: Configure Exchange API Connections

### Supported Exchanges:
- ✅ Binance (Crypto - Testnet available)
- ✅ OANDA (Forex - Practice account available)
- ✅ Kraken (Crypto)
- ✅ Coinbase (Crypto)

### Step 1: Get API Keys

#### Binance Testnet (FREE - For Testing):
1. Go to: https://testnet.binance.vision/
2. Register free account
3. Get free test USDT
4. Create API key
5. Copy API Key + Secret

#### OANDA Practice (FREE - For Testing):
1. Go to: https://www.oanda.com/demo-account/
2. Register practice account
3. Get $100,000 practice funds
4. Generate Personal Access Token
5. Copy Token + Account ID

---

### Step 2: Add Exchange API Keys to Pages

**Go to environment variables:**
```
https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/settings/environment-variables
```

**Add these variables (Production):**

```
# Binance Testnet
BINANCE_API_KEY = your_binance_testnet_api_key
BINANCE_SECRET = your_binance_testnet_secret
BINANCE_TESTNET = true

# OANDA Practice
OANDA_API_KEY = your_oanda_practice_token
OANDA_ACCOUNT_ID = your_oanda_account_id
OANDA_ENVIRONMENT = practice

# Trading Settings
ENABLE_LIVE_TRADING = false
ENABLE_PAPER_TRADING = true
```

✅ Check "Encrypt" for each!

Click **"Save"**

---

### Step 3: Test Exchange Connectivity

After adding API keys and redeploying:

**Test Binance Connection:**
```bash
curl -X POST https://01139140.trade-m8-production.pages.dev/api/live-trading/market-data \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "exchange": "binance",
    "symbol": "BTCUSDT"
  }'
```

**Test OANDA Connection:**
```bash
curl -X POST https://01139140.trade-m8-production.pages.dev/api/live-trading/market-data \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "exchange": "oanda",
    "symbol": "EUR_USD"
  }'
```

---

## Part 4: Configure & Test Trading Bots

### Bot Configuration Options:

```json
{
  "name": "Bot Name",
  "strategy": "ensemble|momentum|meanReversion|arbitrage",
  "symbol": "BTC/USDT",
  "exchange": "binance|oanda|kraken|coinbase",
  "riskLevel": "low|medium|high",
  "maxPositionSize": 0.02,
  "config": {
    "timeframe": "15m",
    "indicators": ["RSI", "MACD", "Bollinger"],
    "stopLoss": 0.02,
    "takeProfit": 0.04
  }
}
```

### Create Different Bot Types:

**1. Scalping Bot (Quick trades):**
```bash
curl -X POST https://01139140.trade-m8-production.pages.dev/api/bots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "BTC Scalper",
    "strategy": "momentum",
    "symbol": "BTC/USDT",
    "exchange": "binance",
    "riskLevel": "medium"
  }'
```

**2. Swing Trading Bot (Longer holds):**
```bash
curl -X POST https://01139140.trade-m8-production.pages.dev/api/bots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "ETH Swing Trader",
    "strategy": "meanReversion",
    "symbol": "ETH/USDT",
    "exchange": "binance",
    "riskLevel": "low"
  }'
```

**3. Forex Bot:**
```bash
curl -X POST https://01139140.trade-m8-production.pages.dev/api/bots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "EUR/USD Trader",
    "strategy": "ensemble",
    "symbol": "EUR_USD",
    "exchange": "oanda",
    "riskLevel": "medium"
  }'
```

---

## Part 5: Complete Testing Checklist

### ✅ API Endpoints
- [ ] Health check
- [ ] User registration
- [ ] User login
- [ ] Create trading bot
- [ ] List bots
- [ ] Get portfolio
- [ ] Get market data
- [ ] Get analytics

### ✅ Wallet Connect
- [ ] MetaMask connection
- [ ] Wallet authentication
- [ ] Transaction signing

### ✅ Exchange Connectivity
- [ ] Binance testnet connection
- [ ] OANDA practice connection
- [ ] Market data retrieval
- [ ] Order placement (paper trading)

### ✅ Trading Bots
- [ ] Create bot
- [ ] Start bot
- [ ] Stop bot
- [ ] View bot performance
- [ ] Backtest strategy

---

## Quick Test Script

Save this as `test-all.sh`:

```bash
#!/bin/bash

BASE_URL="https://01139140.trade-m8-production.pages.dev"

echo "1. Testing health..."
curl -s $BASE_URL/api/health

echo -e "\n\n2. Registering user..."
REGISTER=$(curl -s -X POST $BASE_URL/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test'$(date +%s)'@trade-m8.app","password":"test123","fullName":"Test User"}')
echo $REGISTER

echo -e "\n\n3. Logging in..."
LOGIN=$(curl -s -X POST $BASE_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser@trade-m8.app","password":"test123"}')
echo $LOGIN

TOKEN=$(echo $LOGIN | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
  echo -e "\n\n4. Creating bot..."
  curl -s -X POST $BASE_URL/api/bots \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"name":"Test Bot","strategy":"ensemble","symbol":"BTC/USDT","exchange":"binance"}'

  echo -e "\n\n5. Listing bots..."
  curl -s $BASE_URL/api/bots \
    -H "Authorization: Bearer $TOKEN"
fi
```

Run it:
```bash
chmod +x test-all.sh
./test-all.sh
```

---

## Security Reminders

### ✅ DO:
- Use testnet/practice accounts for testing
- Start with paper trading mode
- Enable 2FA on exchange accounts
- Restrict API keys (no withdrawals!)
- Monitor all trades
- Set stop-loss limits

### ❌ DON'T:
- Enable withdrawal permissions
- Use live funds for testing
- Share API keys
- Disable safety limits
- Trade more than you can afford to lose

---

## Next Steps

1. ✅ Configure KV bindings and environment variables
2. ✅ Test all API endpoints
3. ✅ Connect MetaMask wallet
4. ✅ Add exchange API keys (testnet/practice)
5. ✅ Create trading bots
6. ✅ Run paper trading for 1-2 weeks
7. ✅ Monitor performance (aim for 70%+ win rate)
8. ✅ Gradually move to small live trades

---

**Your platform is ready! Just complete the bindings configuration above and start testing!** 🚀
