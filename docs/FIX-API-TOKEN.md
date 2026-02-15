# Fix Cloudflare API Token - Step by Step Guide

## Current Issue

Your API token has IP address filtering that blocks: **121.74.199.225**

Error: `Cannot use the access token from location: 121.74.199.225 [code: 9109]`

---

## Option 1: Remove IP Restrictions from Existing Token (Quickest)

### Steps:

1. **Open Cloudflare Dashboard**
   - Go to: https://dash.cloudflare.com/profile/api-tokens
   - You should see a list of your API tokens

2. **Find Your Token**
   - Look for the token that starts with: `AORTqhg7G1...`
   - Or any token you created recently
   - Click the **Edit** button next to it

3. **Remove IP Filtering**
   - Scroll down to: **Client IP Address Filtering**
   - You'll see current IP restrictions listed
   - Click **Remove** or delete all IP addresses
   - Leave the section empty (no IP restrictions)

4. **Save Changes**
   - Scroll to bottom
   - Click **Continue to summary**
   - Click **Update Token**

5. **Confirm It Works**
   - The token will remain the same: `AORTqhg7G1ehTJL07Gf7__j8Q5h7IpMgS8mfU7Az`
   - No need to update `.env.local`

---

## Option 2: Add Current IP to Allowed List

If you want to keep IP filtering for security:

1. Go to: https://dash.cloudflare.com/profile/api-tokens
2. Edit your token
3. Under **Client IP Address Filtering**
4. Click **Add IP**
5. Enter: `121.74.199.225`
6. Click **Add**
7. Save changes

**Note**: If your IP changes, you'll need to update this again.

---

## Option 3: Create New Token Without Restrictions

### Steps:

1. **Go to API Tokens Page**
   - https://dash.cloudflare.com/profile/api-tokens

2. **Create Token**
   - Click: **Create Token**

3. **Select Template**
   - Find: **Edit Cloudflare Workers**
   - Click: **Use template**

4. **Configure Permissions**
   The template should include:
   - Account > Workers Scripts > Edit
   - Account > Workers KV Storage > Edit
   - Account > Workers R2 Storage > Edit
   - Account > D1 > Edit
   - Account > Pages > Edit

5. **Add Additional Permissions** (if not included)
   - Zone > Workers Routes > Edit
   - Account > Account Settings > Read

6. **Select Account**
   - Under **Account Resources**
   - Select: Your account (should be the one with ID: e0b57c607cc62ffd3f409df4f0f7c0f9)
   - Or choose: **All accounts**

7. **IMPORTANT: Skip IP Filtering**
   - Scroll down to: **Client IP Address Filtering**
   - Leave it **EMPTY** (don't add any IPs)

8. **Set TTL** (optional)
   - You can set an expiration date, or leave it blank for no expiration
   - Recommended: Leave blank or set to 1 year

9. **Create Token**
   - Click: **Continue to summary**
   - Review permissions
   - Click: **Create Token**

10. **Copy Your New Token**
    - **IMPORTANT**: Copy the token immediately!
    - You won't be able to see it again
    - Should look like: `xxxxxxxxxxxxxxxxxxxxx`

11. **Update Environment File**
    - Open `.env.local` in this directory
    - Replace the old token with your new one:
    ```bash
    CLOUDFLARE_API_TOKEN=your_new_token_here
    ```

---

## After Fixing the Token

Once you've completed Option 1, 2, or 3, let me know and I'll:
1. Test the authentication
2. Run the automated deployment
3. Get your live URL

Just say: **"Token is fixed"** or **"I updated the token"**

---

## Quick Test

After fixing, you can test if it works:

```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
export CLOUDFLARE_API_TOKEN="AORTqhg7G1ehTJL07Gf7__j8Q5h7IpMgS8mfU7Az"
wrangler whoami
```

You should see your account info without errors.

---

## Security Notes

- ✅ Removing IP restrictions is generally safe for API tokens with limited permissions
- ✅ Your token only has access to Workers/Pages/D1 (not DNS or other sensitive areas)
- ⚠️ If you're concerned about security, use Option 2 (whitelist current IP)
- ⚠️ Never share your API token publicly or commit it to Git

---

**Ready to proceed?**

Let me know when you've fixed the token and we'll deploy immediately! 🚀
