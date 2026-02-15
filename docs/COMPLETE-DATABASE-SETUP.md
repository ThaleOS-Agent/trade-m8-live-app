# 🗄️ Complete D1 Database Setup Guide

## Current Status

✅ **Backend configured** - All API endpoints ready for D1
✅ **Frontend configured** - All API calls properly structured
✅ **Schema prepared** - Complete database schema available
⚠️ **API Token Issue** - Current token lacks D1 permissions

---

## 🚀 Two Options to Proceed

### Option A: Fix API Token (Recommended for CLI)

1. **Visit Cloudflare API Tokens Page:**
   https://dash.cloudflare.com/profile/api-tokens

2. **Create New API Token** with these permissions:
   - **Account** → **D1** → **Edit**
   - **Account** → **Workers Scripts** → **Edit**
   - **Account** → **Pages** → **Edit**
   - **Account Resources** → Include: `Admin@teakanetwork.com's Account`

3. **Save the new token** and update `.env.local`:
   ```bash
   CLOUDFLARE_API_TOKEN=your_new_token_with_d1_permissions
   ```

4. **Run setup:**
   ```bash
   cd /Users/Gee/xq-trade-m8-cloudflare
   ./database-setup.sh
   ```

---

### Option B: Use Cloudflare Dashboard (Easiest)

#### Step 1: Create D1 Database

1. Go to: https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/workers/d1
2. Click **"Create database"**
3. Database name: `trade-m8-db`
4. Click **"Create"**
5. **Copy the Database ID** (you'll need this)

#### Step 2: Initialize Database Schema

1. Click on `trade-m8-db` database
2. Go to **"Console"** tab
3. Copy the entire contents of `/Users/Gee/xq-trade-m8-cloudflare/COPY-THIS-TO-D1.sql`
4. Paste into the console
5. Click **"Execute"**

#### Step 3: Update wrangler.toml

Edit `/Users/Gee/xq-trade-m8-cloudflare/wrangler.toml` and replace the D1 section:

```toml
# D1 Database binding
[[d1_databases]]
binding = "DB"
database_name = "trade-m8-db"
database_id = "YOUR_DATABASE_ID_FROM_STEP_1"
```

#### Step 4: Create KV Namespaces (Optional but Recommended)

1. Go to: https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/workers/kv/namespaces
2. Create three KV namespaces:
   - Name: `trade-m8-cache` → Copy the ID
   - Name: `trade-m8-sessions` → Copy the ID
   - Name: `trade-m8-trades` → Copy the ID

3. Update `wrangler.toml` with KV IDs:
```toml
kv_namespaces = [
  { binding = "CACHE", id = "your-cache-kv-id" },
  { binding = "SESSIONS", id = "your-sessions-kv-id" },
  { binding = "TRADES", id = "your-trades-kv-id" }
]
```

#### Step 5: Verify R2 Bucket

Your R2 bucket is already configured in wrangler.toml:
```toml
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "trade-m8-assets"
```

Make sure the bucket exists:
1. Go to: https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/r2/default/buckets
2. Create bucket named `trade-m8-assets` if it doesn't exist

#### Step 6: Set Secrets

In Cloudflare Dashboard → Workers & Pages → trade-m8-production → Settings → Variables:

Add these secrets:
- `JWT_SECRET`: `83fb2608-846e-41d0-a66a-7d94503f1b3f`
- `SUPABASE_URL`: `https://eeotzybkdjvorpxqgezz.supabase.co`
- `SUPABASE_KEY`: (from .env.local)
- `COINGECKO_API_KEY`: (if you have one)

#### Step 7: Deploy

```bash
cd /Users/Gee/xq-trade-m8-cloudflare
npm run build
wrangler pages deploy dist --project-name=trade-m8-production
```

---

## 📊 Database Schema Overview

Your D1 database will have these tables:

### Core Tables:
- **users** - User accounts, authentication, roles
- **trading_bots** - Bot configurations, strategies, status
- **trades** - Trade execution history, P&L tracking
- **portfolio_snapshots** - Portfolio value over time
- **market_data** - Cached market prices and indicators
- **performance_metrics** - Detailed performance analytics
- **daily_performance** - Daily P&L summaries

### Sample Test Data:
```sql
-- Create test user
INSERT INTO users (id, email, password_hash, full_name, role, status, created_at)
VALUES (
  'test-user-001',
  'demo@trade-m8.app',
  '$2a$10$DEMO.HASH.FOR.TESTING.PURPOSES.ONLY',
  'Demo User',
  'user',
  'active',
  strftime('%s', 'now')
);
```

---

## 🔗 Backend-Frontend Integration

### Backend Endpoints (_middleware.ts):
- `POST /api/auth/login` → Authenticates user
- `POST /api/auth/register` → Creates new user
- `GET /api/bots` → Lists user's trading bots
- `POST /api/bots` → Creates new bot
- `GET /api/trades` → Gets trade history
- `GET /api/portfolio` → Gets portfolio data
- `GET /api/market` → Gets market data
- `GET /api/analytics` → Gets performance metrics

### Frontend API (api.ts):
- ✅ All endpoints properly configured
- ✅ JWT authentication integrated
- ✅ Auto token refresh on 401
- ✅ CORS headers configured

**Everything is synchronized and ready!** Just need to create the database.

---

## 🧪 Testing After Setup

### 1. Health Check
```bash
curl https://your-app.pages.dev/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2026-02-14T..."
}
```

### 2. Register Test User
```bash
curl -X POST https://your-app.pages.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "fullName": "Test User"
  }'
```

### 3. Login
```bash
curl -X POST https://your-app.pages.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### 4. Create Trading Bot
```bash
curl -X POST https://your-app.pages.dev/api/bots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Test Bot",
    "strategy": "ensemble",
    "symbol": "BTC/USDT",
    "exchange": "binance"
  }'
```

---

## 🔍 Troubleshooting

### "Authentication error [code: 10000]"
**Solution:** API token needs D1 permissions (see Option A above)

### "Database not found"
**Solution:** Create database in dashboard (Option B, Step 1)

### "Table does not exist"
**Solution:** Run schema in console (Option B, Step 2)

### "Binding 'DB' not found"
**Solution:** Update wrangler.toml with database ID (Option B, Step 3)

---

## 📋 Quick Checklist

- [ ] D1 database created
- [ ] Database schema executed
- [ ] wrangler.toml updated with database ID
- [ ] KV namespaces created (optional)
- [ ] R2 bucket exists
- [ ] Secrets configured
- [ ] Application deployed
- [ ] Health check passes
- [ ] Test user created and can login

---

## 🎯 Next Steps After Database Setup

1. ✅ Visit your deployed app
2. ✅ Register a new account
3. ✅ Create your first trading bot
4. ✅ Connect exchange API keys (optional)
5. ✅ Start paper trading
6. ✅ Monitor performance

---

**Need help?** All the configuration files are ready. Choose Option B (Dashboard) for the easiest setup!
