# 🔧 Step-by-Step: Configure Cloudflare Pages Bindings

## 📍 Start Here

**Open this link in your browser NOW:**
```
https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/settings/functions
```

You should see the Settings page for `trade-m8-production`.

---

## Step 1: Configure D1 Database Binding (1 minute)

### What you'll see:
Scroll down until you see a section titled **"D1 database bindings"**

### What to do:

1. **Click the blue "Add binding" button**

2. You'll see two fields appear:

   **Field 1 - Variable name:**
   ```
   DB
   ```
   *(Type exactly: DB - all caps)*

   **Field 2 - D1 database:**
   - Click the dropdown menu
   - Select: **`xq-trade-m8-db`**
   - (It should be the first or only option)

3. **Click the "Save" button** at the bottom

✅ You should see: "D1 database binding saved successfully"

---

## Step 2: Configure KV Namespace Bindings (2 minutes)

### What you'll see:
Scroll down to the section titled **"KV namespace bindings"**

### Binding 1 of 3: CACHE

1. **Click the blue "Add binding" button**

2. Fill in the two fields:

   **Variable name:**
   ```
   CACHE
   ```
   *(Type exactly: CACHE - all caps)*

   **KV namespace:**
   - Click the dropdown
   - Look for a namespace ending in **`...3eb8`**
   - The full ID is: `9e4bace90bfa4c08931fb548114e3eb8`
   - Select it

3. **Click "Add binding"** (don't click Save yet)

---

### Binding 2 of 3: SESSIONS

4. **Click "Add binding" button again**

5. Fill in:

   **Variable name:**
   ```
   SESSIONS
   ```

   **KV namespace:**
   - Click the dropdown
   - Look for a namespace ending in **`...54bb`**
   - The full ID is: `645380f3d22648409b9adac6c3c854bb`
   - Select it

6. **Click "Add binding"** (don't click Save yet)

---

### Binding 3 of 3: TRADES

7. **Click "Add binding" button again**

8. Fill in:

   **Variable name:**
   ```
   TRADES
   ```

   **KV namespace:**
   - Click the dropdown
   - Look for a namespace ending in **`...2773`**
   - The full ID is: `94f18f6e58d34fc38a4023f370142773`
   - Select it

9. **Now click the "Save" button** at the bottom

✅ You should see: "KV namespace bindings saved successfully"

---

## Step 3: Configure R2 Bucket Binding (30 seconds)

### What you'll see:
Scroll down to the section titled **"R2 bucket bindings"**

### What to do:

1. **Click the blue "Add binding" button**

2. Fill in the two fields:

   **Variable name:**
   ```
   STORAGE
   ```
   *(Type exactly: STORAGE - all caps)*

   **R2 bucket:**
   - Click the dropdown
   - Select: **`trade-m8-assets`**

3. **Click the "Save" button**

✅ You should see: "R2 bucket binding saved successfully"

---

## Step 4: Add Environment Variables (2 minutes)

### Navigate to Environment Variables:

**Option A: Click this link:**
```
https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/settings/environment-variables
```

**Option B: From current page:**
- Click **"Environment variables"** in the left sidebar

---

### What you'll see:
A page with tabs: **Production** and **Preview**

### What to do:

1. Make sure you're on the **"Production"** tab

2. **Click the "Add variables" button** (or "+ Add")

---

### Variable 1: JWT_SECRET

**Variable name:**
```
JWT_SECRET
```

**Value:**
```
83fb2608-846e-41d0-a66a-7d94503f1b3f
```

✅ **Check the "Encrypt" checkbox** (very important!)

---

### Variable 2: SUPABASE_URL

3. **Click the "+" icon** or **"Add variable"** to add another

**Variable name:**
```
SUPABASE_URL
```

**Value:**
```
https://eeotzybkdjvorpxqgezz.supabase.co
```

✅ **Check the "Encrypt" checkbox**

---

### Variable 3: SUPABASE_KEY

4. **Click the "+" icon** or **"Add variable"** again

**Variable name:**
```
SUPABASE_KEY
```

**Value:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlb3R6eWJrZGp2b3JweHFnZXp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NjQ1MDksImV4cCI6MjA4NjE0MDUwOX0.5VEHBoHPCsBPQn0FwPglgj3GzAPbsiDzIuKVSClUB3U
```

✅ **Check the "Encrypt" checkbox**

---

### Variable 4: COINGECKO_API_KEY (Optional)

5. **Click "Add variable"** again (if you have CoinGecko API key)

**Variable name:**
```
COINGECKO_API_KEY
```

**Value:**
```
your_coingecko_api_key_if_you_have_one
```
*(Leave blank or skip if you don't have one yet)*

---

6. **Click "Save" button** at the bottom

✅ You should see: "Environment variables saved"

---

## Step 5: Verify All Bindings

### Check D1 Binding:
Go back to: https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/settings/functions

**You should see:**
- ✅ D1 database bindings: `DB` → `xq-trade-m8-db`

### Check KV Bindings:
**You should see 3 bindings:**
- ✅ `CACHE` → KV namespace (ending in ...3eb8)
- ✅ `SESSIONS` → KV namespace (ending in ...54bb)
- ✅ `TRADES` → KV namespace (ending in ...2773)

### Check R2 Binding:
- ✅ `STORAGE` → `trade-m8-assets`

### Check Environment Variables:
Go to: https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/settings/environment-variables

**You should see (Production tab):**
- ✅ JWT_SECRET (Encrypted)
- ✅ SUPABASE_URL (Encrypted)
- ✅ SUPABASE_KEY (Encrypted)

---

## Step 6: Trigger Redeploy

### Option A: Automatic Redeploy
The app should automatically redeploy when you save bindings. Wait 1-2 minutes.

### Option B: Manual Redeploy (if needed)

**Click this link:**
```
https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/deployments
```

1. Find the latest deployment (at the top)
2. Click the **"..."** (three dots) menu on the right
3. Click **"Retry deployment"**
4. Wait for deployment to complete (1-2 minutes)

---

## Step 7: Test Everything Works

### After deployment completes, run these tests:

**Test 1: Health Check**
```bash
curl https://01139140.trade-m8-production.pages.dev/api/health
```
**Expected:** `{"status":"healthy","version":"1.0.0",...}`

**Test 2: Login**
```bash
curl -X POST https://01139140.trade-m8-production.pages.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@xqtradem8.com","password":"demo123"}'
```
**Expected:** JWT token in response

**Test 3: Visit in Browser**
```
https://01139140.trade-m8-production.pages.dev
```
**Expected:** Your trading platform loads!

---

## ✅ Complete Checklist

- [ ] D1 binding: `DB` → `xq-trade-m8-db` ✅
- [ ] KV binding: `CACHE` → `9e4bace90bfa4c08931fb548114e3eb8` ✅
- [ ] KV binding: `SESSIONS` → `645380f3d22648409b9adac6c3c854bb` ✅
- [ ] KV binding: `TRADES` → `94f18f6e58d34fc38a4023f370142773` ✅
- [ ] R2 binding: `STORAGE` → `trade-m8-assets` ✅
- [ ] Environment variable: `JWT_SECRET` (encrypted) ✅
- [ ] Environment variable: `SUPABASE_URL` (encrypted) ✅
- [ ] Environment variable: `SUPABASE_KEY` (encrypted) ✅
- [ ] Redeployed application ✅
- [ ] Tested health endpoint ✅
- [ ] Tested login endpoint ✅
- [ ] Visited app in browser ✅

---

## 🆘 Troubleshooting

### Can't find KV namespace in dropdown?
- Make sure you created the KV namespaces
- Refresh the page
- Check you're in the right account

### "Save" button is greyed out?
- Make sure all required fields are filled
- Check variable names are exact (case-sensitive)
- Try refreshing the page

### Bindings not taking effect?
- Wait 2-3 minutes after saving
- Manually trigger a redeploy (Step 6, Option B)
- Check deployment logs for errors

---

## 🎉 Once Complete

Your XQ Trade M8 platform will be fully functional with:
- ✅ Database connected
- ✅ Sessions working
- ✅ Caching enabled
- ✅ File storage ready
- ✅ Authentication working
- ✅ Trading bots ready

---

**Start with the first link and work through each step!** 🚀
