# Update API Token Permissions

## Current Status

✅ Your token authenticates successfully!
❌ But it lacks permissions for:
- Cloudflare Pages
- D1 Databases
- KV Storage

## Quick Fix - Add Missing Permissions

### Option A: Edit Existing Token (Recommended)

1. **Go to API Tokens**
   - https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/api-tokens

2. **Find and Edit Your Token**
   - Look for the token you just fixed (starts with `AORTqhg7...`)
   - Click **Edit**

3. **Add Required Permissions**

   Scroll to **Permissions** section and add these:

   **Account Permissions:**
   - ✅ **Cloudflare Pages** → **Edit**
   - ✅ **D1** → **Edit**
   - ✅ **Workers KV Storage** → **Edit**
   - ✅ **Workers Scripts** → **Edit**
   - ✅ **Workers Routes** → **Edit**
   - ✅ **Account Settings** → **Read**

   **Zone Permissions** (if asked):
   - ✅ **Workers Routes** → **Edit**

4. **Verify Account Resources**
   - Under **Account Resources**
   - Make sure it says: **All accounts** OR your specific account

5. **Confirm IP Filtering is Still Empty**
   - Scroll to **Client IP Address Filtering**
   - Should be empty (no IPs listed)

6. **Save Changes**
   - Click **Continue to summary**
   - Click **Update Token**
   - ✅ Done! Token stays the same

---

### Option B: Create New Token with All Permissions

If editing doesn't work, create a fresh token:

1. **Go to**: https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/api-tokens

2. **Create Token** → **Create Custom Token**

3. **Give it a name**: `Trade M8 Deployment`

4. **Set Permissions**:

   **Account Permissions:**
   ```
   Account > Cloudflare Pages > Edit
   Account > D1 > Edit
   Account > Workers KV Storage > Edit
   Account > Workers Scripts > Edit
   Account > Workers Routes > Edit
   Account > Account Settings > Read
   ```

5. **Account Resources**
   - Include: **All accounts** (or specific account)

6. **Zone Resources** (optional)
   - Can leave as default or select specific zones

7. **Client IP Address Filtering**
   - ⚠️ Leave **EMPTY** (no IP restrictions)

8. **TTL**: Leave blank or set to 1 year

9. **Create Token**
   - Click **Continue to summary**
   - Review and click **Create Token**
   - **COPY THE TOKEN IMMEDIATELY**

10. **Update .env.local**
    ```bash
    CLOUDFLARE_API_TOKEN=your_new_token_here
    ```

---

## After Updating Permissions

### Test It:
```bash
./test-token.sh
```

### Or Let Me Know:
Just reply: **"Permissions updated"** and I'll run the deployment!

---

## What Permissions Are For

- **Cloudflare Pages**: Deploy your frontend
- **D1**: Create and manage databases
- **Workers KV Storage**: Create caching namespaces
- **Workers Scripts**: Deploy backend functions
- **Workers Routes**: Configure routing
- **Account Settings**: Read account info

---

## Estimated Time

- Updating permissions: **~2 minutes**
- Then automatic deployment: **~3-5 minutes**

---

**Ready to update? Let me know when done!** 🚀
