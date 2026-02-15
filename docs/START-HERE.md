# 🚀 START HERE - 3 Minute Setup

## The API token doesn't have D1 permissions. Here's the fastest solution:

---

## 📋 3-Step Dashboard Method (3 minutes)

### ⏱️ Step 1: Create Database (1 min)

**Click this link:**
```
https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/workers-and-pages/d1
```

1. Click **"Create database"**
2. Name it: `trade-m8-db`
3. Click **"Create"**
4. **COPY THE DATABASE ID** (looks like: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

---

### ⏱️ Step 2: Run Schema (1 min)

1. Click on your `trade-m8-db` database
2. Click **"Console"** tab
3. Copy ALL contents from this file:
   ```
   /Users/Gee/xq-trade-m8-cloudflare/COPY-THIS-TO-D1.sql
   ```
4. Paste into console
5. Click **"Execute"**
6. Wait for "Query executed successfully"

---

### ⏱️ Step 3: Update Config (1 min)

**Edit this file:**
```
/Users/Gee/xq-trade-m8-cloudflare/wrangler.toml
```

**Find lines 23-26 and uncomment + update:**

```toml
[[d1_databases]]
binding = "DB"
database_name = "trade-m8-db"
database_id = "PASTE-YOUR-DATABASE-ID-HERE"
```

**Save the file!**

---

### ✅ Done! Now Deploy:

```bash
cd /Users/Gee/xq-trade-m8-cloudflare
npm run build
wrangler pages deploy dist --project-name=trade-m8-production
```

---

## 🎉 That's It!

Your trading platform is now live with a fully functional database!

Test it:
```bash
curl https://your-app.pages.dev/api/health
```

---

## 📚 More Info

- **Detailed guide**: `FIX-TOKEN-OR-USE-DASHBOARD.md`
- **Full setup**: `COMPLETE-DATABASE-SETUP.md`
- **Integration status**: `INTEGRATION-STATUS.md`

---

**Questions?** Everything is documented in the files above! 🚀
