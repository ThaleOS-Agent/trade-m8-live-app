# 🔑 Create New API Token with D1 Permissions

## Step-by-Step Guide

### Step 1: Go to API Tokens Page

**Click this link:**
```
https://dash.cloudflare.com/profile/api-tokens
```

Or navigate manually:
1. Click your profile icon (top right)
2. Select "API Tokens"

---

### Step 2: Create Custom Token

1. Click **"Create Token"** button (blue button on the right)

2. Click **"Get started"** next to **"Create Custom Token"**

---

### Step 3: Configure Token Permissions

#### Token Name:
```
XQ Trade M8 Full Access
```

#### Permissions - Add these:

| Resource | Permission | Value |
|----------|------------|-------|
| Account | D1 | Edit |
| Account | Workers Scripts | Edit |
| Account | Pages | Edit |
| Account | Workers KV Storage | Edit |
| Account | Workers R2 Storage | Edit |

**To add each permission:**
1. Click **"+ Add more"**
2. Select **"Account"** from first dropdown
3. Select the resource (e.g., "D1") from second dropdown
4. Select **"Edit"** from third dropdown

Repeat for all 5 permissions above.

---

### Step 4: Set Account Resources

Under **"Account Resources"**:

1. Select: **"Include"**
2. Select: **"Specific account"**
3. Choose: **"Admin@teakanetwork.com's Account"**

---

### Step 5: Client IP Address Filtering (Optional)

**Leave this blank** unless you want to restrict to specific IPs.

---

### Step 6: TTL (Time to Live)

**Recommended:** Select **"1 year"** or **"No expiration"**

(You can always revoke it manually if needed)

---

### Step 7: Review and Create

1. Click **"Continue to summary"**

2. Review your permissions:
   - ✅ D1 - Edit
   - ✅ Workers Scripts - Edit
   - ✅ Pages - Edit
   - ✅ Workers KV Storage - Edit
   - ✅ Workers R2 Storage - Edit

3. Click **"Create Token"**

---

### Step 8: COPY THE TOKEN IMMEDIATELY! ⚠️

**IMPORTANT:** You'll only see this token ONCE!

The token will look like:
```
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Copy it now** and save it temporarily.

---

## ✅ After You Get Your Token

**Paste your new token here and I'll help you:**
1. Update your `.env.local` file
2. Test the token
3. Execute the database schema
4. Deploy your application

---

## 🎯 Expected Permissions Summary

Your new token should have:

```
✅ Account → D1 → Edit
✅ Account → Workers Scripts → Edit
✅ Account → Pages → Edit
✅ Account → Workers KV Storage → Edit
✅ Account → Workers R2 Storage → Edit

📍 Account: Admin@teakanetwork.com's Account (e0b57c607cc62ffd3f409df4f0f7c0f9)
```

---

## 📸 Visual Guide

If you need help finding the right options, here's what to look for:

**Permission Row Example:**
```
[Account ▼] [D1 ▼] [Edit ▼] [×]
```

You'll create 5 rows like this, one for each resource.

---

## 🆘 Troubleshooting

### "I don't see D1 in the dropdown"
- Make sure you selected **"Account"** in the first dropdown (not "Zone")
- Scroll down in the second dropdown - D1 should be there

### "I don't see my account"
- Make sure you're logged into admin@teakanetwork.com
- Refresh the page and try again

### "I accidentally closed the token page"
- No worries! Just create a new token following these steps again

---

**Ready?** Click the link above and follow the steps. Once you have your token, paste it here and I'll help you finish the setup! 🚀
