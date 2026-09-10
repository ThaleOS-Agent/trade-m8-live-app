# 🔧 Configure Cloudflare Pages Bindings

## Issue
The app is deployed but KV namespaces and D1 database need to be bound in Pages settings.

## Quick Fix (2 minutes)

### Step 1: Go to Pages Settings

**Click this link:**
```
https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/settings/functions
```

Or navigate:
1. Go to Cloudflare Dashboard
2. Click **Workers & Pages**
3. Click **trade-m8-production**
4. Click **Settings** tab
5. Click **Functions** in sidebar

---

### Step 2: Add D1 Database Binding

Scroll to **"D1 database bindings"** section:

1. Click **"Add binding"**
2. Variable name: `DB`
3. D1 database: Select `xq-trade-m8-db`
4. Click **"Save"**

---

### Step 3: Add KV Namespace Bindings

Scroll to **"KV namespace bindings"** section:

Add 3 bindings:

#### Binding 1:
- Variable name: `CACHE`
- KV namespace: Select the namespace with ID `9e4bace90bfa4c08931fb548114e3eb8`
- Click **"Add binding"**

#### Binding 2:
- Variable name: `SESSIONS`
- KV namespace: Select the namespace with ID `645380f3d22648409b9adac6c3c854bb`
- Click **"Add binding"**

#### Binding 3:
- Variable name: `TRADES`
- KV namespace: Select the namespace with ID `94f18f6e58d34fc38a4023f370142773`
- Click **"Save"**

---

### Step 4: Add R2 Bucket Binding

Scroll to **"R2 bucket bindings"** section:

1. Click **"Add binding"**
2. Variable name: `STORAGE`
3. R2 bucket: `trade-m8-assets`
4. Click **"Save"**

---

### Step 5: Add Environment Variables (Secrets)

Scroll to **"Environment variables"** section:

Click **"Add variables"** for Production:

```
JWT_SECRET = YOUR_RANDOM_32_PLUS_CHAR_SECRET
SUPABASE_URL = https://eeotzybkdjvorpxqgezz.supabase.co
SUPABASE_KEY = YOUR_SUPABASE_ANON_KEY
```

Make sure to select **"Encrypt"** for each variable!

---

### Step 6: Redeploy

After saving all bindings, you need to trigger a new deployment.

**Option A:** Make a small change and redeploy:
```bash
npm run build
wrangler pages deploy dist --project-name=trade-m8-production
```

**Option B:** In the dashboard:
1. Go to **Deployments** tab
2. Find the latest deployment
3. Click **"..."** menu
4. Click **"Retry deployment"**

---

## ✅ Verify Setup

After redeploying, test:

```bash
# Health check
curl https://0bef2c74.trade-m8-production.pages.dev/api/health

# Login with demo user
curl -X POST https://0bef2c74.trade-m8-production.pages.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@xqtradem8.com","password":"demo123"}'
```

You should see a JWT token returned!

---

## 📋 Complete Bindings Checklist

- [ ] D1 Database: `DB` → `xq-trade-m8-db`
- [ ] KV Namespace: `CACHE` → `9e4bace90bfa4c08931fb548114e3eb8`
- [ ] KV Namespace: `SESSIONS` → `645380f3d22648409b9adac6c3c854bb`
- [ ] KV Namespace: `TRADES` → `94f18f6e58d34fc38a4023f370142773`
- [ ] R2 Bucket: `STORAGE` → `trade-m8-assets`
- [ ] Environment Variable: `JWT_SECRET`
- [ ] Environment Variable: `SUPABASE_URL`
- [ ] Environment Variable: `SUPABASE_KEY`
- [ ] Redeployed application

---

## 🎯 Expected Result

Once configured, you'll be able to:
- ✅ Login with demo user
- ✅ Create trading bots
- ✅ View portfolio
- ✅ Access all API endpoints
- ✅ Store sessions in KV
- ✅ Cache data efficiently

---

**Questions?** Follow the steps above in order. Each binding is required for the app to work properly!
