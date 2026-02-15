# 🗄️ Database Setup Guide

## Quick Summary

Your API token needs D1 database permissions. Here are two options:

---

## ✅ Option 1: Create Database via Cloudflare Dashboard (Recommended)

### Step 1: Create D1 Database
1. Go to **Cloudflare Dashboard**: https://dash.cloudflare.com
2. Select your account: **Admin@teakanetwork.com's Account**
3. Go to **Workers & Pages** > **D1**
4. Click **Create database**
5. Name it: `trade-m8-db`
6. Click **Create**
7. **Copy the Database ID** shown on the page

### Step 2: Update wrangler.toml
Edit `/Users/Gee/xq-trade-m8-cloudflare/wrangler.toml`:

Uncomment and update these lines:
```toml
[[d1_databases]]
binding = "DB"
database_name = "trade-m8-db"
database_id = "YOUR_DATABASE_ID_HERE"  # Paste the ID from step 1
```

### Step 3: Initialize Database Schema
```bash
cd /Users/Gee/xq-trade-m8-cloudflare

# Run the schema file
wrangler d1 execute trade-m8-db --file=schema-to-copy.sql
```

### Step 4: Create Test User
```bash
wrangler d1 execute trade-m8-db --command="
INSERT INTO users (id, email, password_hash, full_name, role, status, created_at)
VALUES (
  'test-user-001',
  'demo@trade-m8.app',
  '\$2a\$10\$DEMO.HASH.FOR.TESTING.PURPOSES.ONLY',
  'Demo User',
  'user',
  'active',
  datetime('now')
);
"
```

### Step 5: Redeploy
```bash
npm run build
wrangler pages deploy dist --project-name=trade-m8
```

---

## ✅ Option 2: Update API Token Permissions

### Step 1: Go to API Tokens
1. Visit: https://dash.cloudflare.com/profile/api-tokens
2. Find your current token or create a new one

### Step 2: Add D1 Permissions
Edit token and add:
- **D1** → **Edit**
- **Workers Scripts** → **Edit**
- **Pages** → **Edit**

### Step 3: Use Updated Token
```bash
export CLOUDFLARE_API_TOKEN="your_new_token"
wrangler d1 create trade-m8-db
```

---

## 📋 Database Schema

The schema includes these tables:

### Core Tables
- **users** - User accounts and authentication
- **trading_bots** - Bot configurations and settings
- **trades** - Trade history and execution records
- **portfolio_snapshots** - Portfolio value over time
- **market_data** - Cached market prices
- **performance_metrics** - Bot performance tracking
- **daily_performance** - Daily P&L summaries

### Sample Schema
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'user',
  status TEXT DEFAULT 'active',
  wallet_address TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE trading_bots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  strategy TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  status TEXT DEFAULT 'stopped',
  risk_level TEXT DEFAULT 'medium',
  max_position_size REAL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  quantity REAL NOT NULL,
  pnl REAL,
  status TEXT DEFAULT 'open',
  opened_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  exchange_order_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
);
```

---

## 🧪 Testing Without Database

For immediate testing (no database setup):

### Test Login Credentials (In-Memory)
Since the database isn't set up, use these temporary credentials:

**Email**: `test@example.com`
**Password**: Any password (authentication will use in-memory storage)

### Or Use Wallet Connect
Click "Connect Wallet" on the login page and authenticate with MetaMask.

---

## 🔍 Verify Database Setup

### Check if database exists:
```bash
wrangler d1 list
```

### Check tables:
```bash
wrangler d1 execute trade-m8-db --command="SELECT name FROM sqlite_master WHERE type='table'"
```

### Check users:
```bash
wrangler d1 execute trade-m8-db --command="SELECT * FROM users"
```

---

## 🚨 Troubleshooting

### Error: "Authentication error"
**Solution**: API token needs D1 permissions (see Option 2 above)

### Error: "Database not found"
**Solution**: Database not created yet (see Option 1 Step 1)

### Error: "Table does not exist"
**Solution**: Schema not initialized (see Option 1 Step 3)

### Error: "Invalid credentials" when logging in
**Solution**: User not created yet (see Option 1 Step 4) or use wallet connect

---

## 📊 Expected Result

Once database is set up, you'll have:

✅ Persistent user accounts
✅ Saved trading bots
✅ Trade history storage
✅ Portfolio tracking
✅ Performance analytics
✅ Real-time data caching

---

## 🎯 Quick Start (Manual Setup)

If wrangler isn't working, use Cloudflare Dashboard:

1. **Dashboard** → **Workers & Pages** → **D1**
2. **Create** `trade-m8-db` database
3. **Console** tab → Paste and run SQL from `schema-to-copy.sql`
4. **Update** `wrangler.toml` with database ID
5. **Redeploy** your application

---

## 💡 Next Steps After Database Setup

1. ✅ Database created and configured
2. ✅ Schema initialized
3. ✅ Test user created
4. ✅ Application redeployed
5. ➡️ Login with test credentials
6. ➡️ Create trading bots
7. ➡️ Set up exchange API keys (for live trading)

---

**For now, test the app without database using wallet connect or registration!**
The UI and functionality work perfectly even without persistent storage.
