# ✅ Quick Setup Checklist

## Current Status:
- ✅ Application deployed: https://01139140.trade-m8-production.pages.dev
- ✅ Health endpoint working
- ⚠️ Database bindings need to be configured in dashboard

---

## Complete These Steps in Cloudflare Dashboard:

### 1. Configure Bindings (CRITICAL)

**Open this link:**
https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/settings/functions

**Add these bindings:**

#### D1 Database Binding:
- [ ] Variable: `DB` → Database: `xq-trade-m8-db`

#### KV Namespace Bindings:
- [ ] Variable: `CACHE` → KV ending in `...3eb8`
- [ ] Variable: `SESSIONS` → KV ending in `...54bb`
- [ ] Variable: `TRADES` → KV ending in `...2773`

#### R2 Bucket Binding:
- [ ] Variable: `STORAGE` → Bucket: `trade-m8-assets`

#### Environment Variables (Production):
- [ ] `JWT_SECRET` = `83fb2608-846e-41d0-a66a-7d94503f1b3f` (Encrypt ✓)
- [ ] `SUPABASE_URL` = `https://eeotzybkdjvorpxqgezz.supabase.co` (Encrypt ✓)
- [ ] `SUPABASE_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (Encrypt ✓)

**Click SAVE after each section!**

---

### 2. Add Custom Domain

**Open this link:**
https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/domains

**Steps:**
- [ ] Click "Set up a custom domain"
- [ ] Enter: `trade-m8.app`
- [ ] Click "Continue"
- [ ] Wait for SSL (1-2 min)
- [ ] Verify status shows "Active"

---

### 3. Trigger Redeploy

After saving all bindings, the app needs to redeploy to pick them up.

**Option A - Automatic (if you made changes):**
The app will auto-redeploy when you save bindings.

**Option B - Manual trigger:**
Go to: https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/deployments
- Find latest deployment
- Click "..." menu → "Retry deployment"

---

## After Setup - Test These:

### Test 1: Health Check
```bash
curl https://trade-m8.app/api/health
```
**Expected:** `{"status":"healthy",...}`

### Test 2: Login (after bindings configured)
```bash
curl -X POST https://trade-m8.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@xqtradem8.com","password":"demo123"}'
```
**Expected:** JWT token response

### Test 3: Register New User
```bash
curl -X POST https://trade-m8.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","fullName":"Test User"}'
```
**Expected:** `{"success":true,"userId":"..."}`

### Test 4: Visit in Browser
```
https://trade-m8.app
```
**Expected:** Trading platform homepage loads

---

## 🎯 Priority Order:

1. **First:** Configure bindings (most critical!)
2. **Second:** Add custom domain
3. **Third:** Wait for redeploy to complete
4. **Fourth:** Test the endpoints above

---

## Current Deployment URL:
- Latest: https://01139140.trade-m8-production.pages.dev
- Custom domain: https://trade-m8.app (after you add it)

---

## 📊 What Each Binding Does:

- **DB (D1):** Stores users, bots, trades, portfolio data
- **CACHE (KV):** Caches market data for fast access
- **SESSIONS (KV):** Stores user login sessions
- **TRADES (KV):** Caches active trade data
- **STORAGE (R2):** File storage for uploads/assets
- **JWT_SECRET:** Signs authentication tokens
- **SUPABASE_URL/KEY:** Backup database connection

---

**Complete the checklist above and your app will be fully functional!** 🚀
