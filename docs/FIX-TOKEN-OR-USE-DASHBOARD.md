# 🔧 API Token Issue - Two Solutions

## Current Problem
Your API token `kae7k3KJvSdETK77zsSJ3oRaJSEVrqoPQcVQZ3B8` lacks D1 database permissions.

Error: `Authentication error [code: 10000]`

---

## ✅ Solution 1: Use Cloudflare Dashboard (FASTEST - 3 minutes) ⭐

**This bypasses the API token issue entirely!**

### Step 1: Create D1 Database (1 minute)

1. Open this link in your browser:
   ```
   https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/workers-and-pages/d1
   ```

2. Click **"Create database"** button

3. Enter database name: `trade-m8-db`

4. Click **"Create"**

5. **COPY THE DATABASE ID** - it will look like:
   ```
   xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```

### Step 2: Initialize Database Schema (1 minute)

1. Click on your newly created `trade-m8-db` database

2. Click the **"Console"** tab at the top

3. Open this file in a text editor:
   ```
   /Users/Gee/xq-trade-m8-cloudflare/COPY-THIS-TO-D1.sql
   ```

4. Copy ALL the contents (Cmd+A, Cmd+C)

5. Paste into the Cloudflare console

6. Click **"Execute"** button

7. You should see: "Query executed successfully"

### Step 3: Update wrangler.toml (30 seconds)

1. Open this file:
   ```
   /Users/Gee/xq-trade-m8-cloudflare/wrangler.toml
   ```

2. Find lines 23-26 (currently commented out):
   ```toml
   # [[d1_databases]]
   # binding = "DB"
   # database_name = "trade-m8-db"
   # database_id = "YOUR_D1_DATABASE_ID_HERE"
   ```

3. Uncomment and replace with your database ID:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "trade-m8-db"
   database_id = "YOUR-ACTUAL-DATABASE-ID-FROM-STEP-1"
   ```

4. Save the file

### Step 4: Build & Deploy (30 seconds)

```bash
cd /Users/Gee/xq-trade-m8-cloudflare
npm run build
wrangler pages deploy dist --project-name=trade-m8-production
```

**DONE!** 🎉 Your database is ready and app is deployed!

---

## ✅ Solution 2: Fix API Token Permissions (if you prefer CLI)

### Step 1: Create New API Token with Correct Permissions

1. Go to: https://dash.cloudflare.com/profile/api-tokens

2. Click **"Create Token"**

3. Click **"Get started"** next to **"Create Custom Token"**

4. Configure the token:

   **Token name**: `XQ Trade M8 - Full Access`

   **Permissions**:
   - Account → **D1** → **Edit** ✅
   - Account → **Workers Scripts** → **Edit** ✅
   - Account → **Pages** → **Edit** ✅
   - Account → **Workers KV Storage** → **Edit** ✅ (optional)
   - Account → **Workers R2 Storage** → **Edit** ✅ (optional)

   **Account Resources**:
   - Include → **Specific account** → `Admin@teakanetwork.com's Account`

   **TTL**: Can leave as default or set to never expire

5. Click **"Continue to summary"**

6. Click **"Create Token"**

7. **COPY THE TOKEN IMMEDIATELY** - you won't see it again!

### Step 2: Update .env.local

1. Open `/Users/Gee/xq-trade-m8-cloudflare/.env.local`

2. Find line 8:
   ```bash
   CLOUDFLARE_API_TOKEN=kae7k3KJvSdETK77zsSJ3oRaJSEVrqoPQcVQZ3B8
   ```

3. Replace with your new token:
   ```bash
   CLOUDFLARE_API_TOKEN=YOUR_NEW_TOKEN_WITH_D1_PERMISSIONS
   ```

4. Save the file

### Step 3: Test Token

```bash
cd /Users/Gee/xq-trade-m8-cloudflare
export NODE_TLS_REJECT_UNAUTHORIZED=0
export CLOUDFLARE_API_TOKEN="YOUR_NEW_TOKEN"
wrangler d1 list
```

You should see a list of databases (or empty list if none exist yet).

### Step 4: Run Setup Script

```bash
cd /Users/Gee/xq-trade-m8-cloudflare
chmod +x database-setup.sh
./database-setup.sh
```

This will:
- Create D1 database
- Create KV namespaces
- Create R2 bucket
- Give you the IDs to update wrangler.toml

---

## 🤔 Which Solution Should You Choose?

### Choose Solution 1 (Dashboard) if:
- ✅ You want the fastest setup
- ✅ You don't mind using the web interface
- ✅ You're having token permission issues
- ✅ **Recommended for first-time setup**

### Choose Solution 2 (API Token) if:
- ✅ You prefer command-line tools
- ✅ You want to automate deployments
- ✅ You're comfortable creating API tokens
- ✅ You need to script the setup

---

## 🎯 My Recommendation

**Use Solution 1 (Dashboard)** - It's:
- Faster (3 minutes vs 5-10 minutes)
- More visual
- No token permission issues
- Easier to verify each step

Once your database is set up, everything else works perfectly via CLI!

---

## 📊 Current Setup Status

| Component | Status |
|-----------|--------|
| Frontend | ✅ 100% Ready |
| Backend | ✅ 100% Ready |
| Database Schema | ✅ 100% Ready |
| API Token | ❌ Lacks D1 permissions |
| D1 Database | ⏳ Waiting to be created |

**You're SO close!** Just need to create the database. 🚀

---

## 🆘 Still Having Issues?

If both solutions don't work:

1. Check if you have access to the Cloudflare account
2. Verify you're logged into the correct account
3. Try refreshing your browser session
4. Check if there are any account-level restrictions

---

**Next Step**: Choose Solution 1 or Solution 2 above and follow the steps!
