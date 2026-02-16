# 🔧 Cloudflare Dashboard Configuration Guide

**Complete setup for Trade M8 Production deployment**

---

## 📋 STEP 1: Configure KV Bindings

**URL:** https://dash.cloudflare.com/pages/view/trade-m8-production/settings/functions

### What are KV Bindings?
KV (Key-Value) bindings connect your Cloudflare Pages Functions to KV namespaces for caching, sessions, and data storage.

### Instructions:

1. **Open the Functions Settings Page:**
   - Click the link above or navigate to:
     - Cloudflare Dashboard → Pages → trade-m8-production → Settings → Functions

2. **Scroll to "KV namespace bindings" section**

3. **Add the following 3 KV bindings:**

#### Binding 1: CACHE
```
Variable name: CACHE
KV namespace: Select or create namespace with ID: 9e4bace90bfa4c08931fb548114e3eb8
```
**Purpose:** Stores market analysis results, API responses, and computed data

#### Binding 2: SESSIONS
```
Variable name: SESSIONS
KV namespace: Select or create namespace with ID: 645380f3d22648409b9adac6c3c854bb
```
**Purpose:** Stores user JWT tokens and session data

#### Binding 3: TRADES
```
Variable name: TRADES
KV namespace: Select or create namespace with ID: 94f18f6e58d34fc38a4023f370142773
```
**Purpose:** Stores trade execution data and real-time updates

4. **Click "Save" after adding each binding**

---

## 🔐 STEP 2: Configure D1 Database Binding

**Still on the same Functions Settings page**

### Instructions:

1. **Scroll to "D1 database bindings" section**

2. **Add D1 database binding:**

```
Variable name: DB
D1 database: Select "xq-trade-m8-db" (ID: 263ca9ce-3d2d-4514-be1a-902c74d20803)
```

**Purpose:** Main production database for users, bots, trades, and portfolio data

3. **Click "Save"**

---

## 📦 STEP 3: Configure R2 Bucket Binding

**Still on the same Functions Settings page**

### Instructions:

1. **Scroll to "R2 bucket bindings" section**

2. **Add R2 bucket binding:**

```
Variable name: STORAGE
R2 bucket: Select "trade-m8-assets"
```

**Purpose:** File storage for charts, reports, and trading data exports

3. **Click "Save"**

---

## 🔑 STEP 4: Configure Environment Variables (Secrets)

**URL:** https://dash.cloudflare.com/pages/view/trade-m8-production/settings/environment-variables

### What are Environment Variables?
Sensitive configuration like API keys, secrets, and credentials that your application needs to function.

### Instructions:

1. **Open the Environment Variables Page:**
   - Click the link above or navigate to:
     - Cloudflare Dashboard → Pages → trade-m8-production → Settings → Environment Variables

2. **Select "Production" environment** (important!)

3. **Add the following variables:**

---

### ✅ REQUIRED Variables (Add these first)

#### Variable 1: JWT_SECRET
```
Variable name: JWT_SECRET
Value: 83fb2608-846e-41d0-a66a-7d94503f1b3f
Type: Encrypted (click "Encrypt" checkbox)
Environment: Production
```
**Purpose:** Signs and verifies user authentication tokens

---

#### Variable 2: COINGECKO_API_KEY
```
Variable name: COINGECKO_API_KEY
Value: CG-NFEggBc1sJ8ggZuf4UgRndqN
Type: Encrypted
Environment: Production
```
**Purpose:** Fetches real-time cryptocurrency market data and analysis

---

#### Variable 3: SUPABASE_URL
```
Variable name: SUPABASE_URL
Value: https://eeotzybkdjvorpxqgezz.supabase.co
Type: Plain text (not sensitive)
Environment: Production
```
**Purpose:** Database connection URL (legacy, can be added for compatibility)

---

#### Variable 4: SUPABASE_KEY
```
Variable name: SUPABASE_KEY
Value: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlb3R6eWJrZGp2b3JweHFnZXp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2NDUwOSwiZXhwIjoyMDg2MTQwNTA5fQ.HIP1k0O_IurVhxBu_EYneHxpAh5MLqty8iCRTe2_F3w
Type: Encrypted
Environment: Production
```
**Purpose:** Service role key for database operations (legacy compatibility)

---

### 🔄 OPTIONAL Variables (For Live Trading - Add later)

#### Variable 5: BINANCE_API_KEY (Optional)
```
Variable name: BINANCE_API_KEY
Value: BLkD3r6prLMIojYxAAw0CsErUcMnhj7McuJ5XMiNjEOCIvowpo3LKYkHiCEBj9Kp
Type: Encrypted
Environment: Production
```
**Purpose:** Binance exchange API for live trading (testnet key provided)

---

#### Variable 6: BINANCE_SECRET_KEY (Optional)
```
Variable name: BINANCE_SECRET_KEY
Value: DHPAcQoRqp568J76RbcMsyKjcHoSvFqAZywYRwDtBSdmzmQdx6OV4pD0wH4dlEQK
Type: Encrypted
Environment: Production
```
**Purpose:** Binance exchange secret for trade signing

---

### 📝 Additional Optional Variables

You can add these later as needed:

```
ALPHA_VANTAGE_API_KEY=OSY3Y5UDWG0BI0VR
ENABLE_LIVE_TRADING=false
ENABLE_PAPER_TRADING=true
MAX_RISK_PER_TRADE=0.02
MAX_DAILY_LOSS=0.05
```

---

## 🎯 STEP 5: Verify Configuration

After adding all bindings and variables:

1. **Wait 1-2 minutes** for propagation

2. **Test the deployment:**

```bash
# Test health endpoint
curl https://trade-m8.app/api/health

# Expected response:
# {"status":"healthy","version":"1.0.0","timestamp":"..."}

# Test market analysis (requires COINGECKO_API_KEY)
curl "https://trade-m8.app/api/market-analysis?coinId=bitcoin&days=14"

# Expected: Real-time Bitcoin analysis with RSI, trends, signals
```

3. **Run the test suite:**

```bash
cd /Users/Gee/trade-m8-live-app
bash scripts/test-production.sh
```

**Expected:** All 13 tests passing ✅

---

## 📊 Configuration Summary

### Bindings to Add (Functions Settings Page):

| Type | Variable Name | ID/Name | Status |
|------|---------------|---------|--------|
| KV | `CACHE` | `9e4bace90bfa4c08931fb548114e3eb8` | ⬜ |
| KV | `SESSIONS` | `645380f3d22648409b9adac6c3c854bb` | ⬜ |
| KV | `TRADES` | `94f18f6e58d34fc38a4023f370142773` | ⬜ |
| D1 | `DB` | `xq-trade-m8-db` | ⬜ |
| R2 | `STORAGE` | `trade-m8-assets` | ⬜ |

### Environment Variables to Add (Environment Variables Page):

| Variable | Required | Encrypted | Status |
|----------|----------|-----------|--------|
| `JWT_SECRET` | ✅ Yes | ✅ Yes | ⬜ |
| `COINGECKO_API_KEY` | ✅ Yes | ✅ Yes | ⬜ |
| `SUPABASE_URL` | ✅ Yes | ❌ No | ⬜ |
| `SUPABASE_KEY` | ✅ Yes | ✅ Yes | ⬜ |
| `BINANCE_API_KEY` | ❌ Optional | ✅ Yes | ⬜ |
| `BINANCE_SECRET_KEY` | ❌ Optional | ✅ Yes | ⬜ |

---

## ⚠️ Important Notes

### Security Best Practices:

1. **Always encrypt sensitive variables:**
   - API keys
   - Secrets
   - Tokens
   - Passwords

2. **Use Production environment only:**
   - These settings are for the live deployment
   - Preview/Development environments can have different values

3. **Test after each change:**
   - Verify the health endpoint responds
   - Check that market analysis works
   - Run authentication tests

### Troubleshooting:

#### Issue: "Binding 'CACHE' not found"
**Solution:** Ensure the KV namespace ID is correct and binding name is exactly `CACHE` (case-sensitive)

#### Issue: "Cannot read properties of undefined (reading 'put')"
**Solution:** KV binding not configured. Add the missing binding in Functions settings.

#### Issue: Market analysis returns errors
**Solution:** Check that `COINGECKO_API_KEY` is set and valid in Environment Variables

#### Issue: Login fails with "Internal server error"
**Solution:** Ensure `JWT_SECRET` and `SESSIONS` KV binding are configured

---

## 🚀 After Configuration is Complete

Your production deployment will have:

✅ **Full KV caching** for market data and sessions
✅ **D1 database** for persistent data storage
✅ **R2 storage** for file uploads and exports
✅ **Secure authentication** with JWT tokens
✅ **Real-time market analysis** with CoinGecko
✅ **Trading bot management** and execution
✅ **Portfolio tracking** and performance analytics

---

## 📚 Additional Resources

- **Cloudflare KV Documentation:** https://developers.cloudflare.com/kv/
- **Cloudflare D1 Documentation:** https://developers.cloudflare.com/d1/
- **Cloudflare R2 Documentation:** https://developers.cloudflare.com/r2/
- **Environment Variables Guide:** https://developers.cloudflare.com/pages/configuration/env-variables/

---

## ✅ Quick Checklist

Before marking this as complete, ensure:

- [ ] All 3 KV bindings added (CACHE, SESSIONS, TRADES)
- [ ] D1 database binding added (DB)
- [ ] R2 bucket binding added (STORAGE)
- [ ] JWT_SECRET environment variable added (encrypted)
- [ ] COINGECKO_API_KEY environment variable added (encrypted)
- [ ] SUPABASE_URL environment variable added
- [ ] SUPABASE_KEY environment variable added (encrypted)
- [ ] Waited 1-2 minutes for propagation
- [ ] Tested health endpoint (returns 200 OK)
- [ ] Tested market analysis (returns real data)
- [ ] Ran test suite (all tests passing)

---

**Once complete, your Trade M8 platform will be fully operational! 🎉**
