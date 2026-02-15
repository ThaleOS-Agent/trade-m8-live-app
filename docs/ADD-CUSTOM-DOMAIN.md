# 🌐 Add Custom Domain: trade-m8.app

## Prerequisites
- Domain `trade-m8.app` must be added to your Cloudflare account
- If not added yet, you'll need to transfer nameservers to Cloudflare

---

## Option 1: Domain Already in Cloudflare Account

### Step 1: Add Custom Domain to Pages

**Click this link:**
```
https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/domains
```

Or navigate:
1. Go to **Workers & Pages**
2. Click **trade-m8-production**
3. Click **Custom domains** tab

---

### Step 2: Set up domain

1. Click **"Set up a custom domain"** button

2. Enter your domain: `trade-m8.app`

3. Click **"Continue"**

4. Cloudflare will automatically:
   - Verify domain ownership
   - Create DNS records
   - Provision SSL certificate

5. Wait 1-2 minutes for SSL provisioning

---

### Step 3: Add www subdomain (optional)

1. Click **"Set up a custom domain"** again

2. Enter: `www.trade-m8.app`

3. Click **"Continue"**

4. This will redirect `www` to the apex domain

---

## Option 2: Domain NOT Yet in Cloudflare

### Step 1: Add Domain to Cloudflare

**Click this link:**
```
https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/add-site
```

1. Enter domain: `trade-m8.app`
2. Click **"Add site"**
3. Select **Free** plan
4. Click **"Continue"**

---

### Step 2: Change Nameservers

Cloudflare will provide you with nameservers like:
```
aisha.ns.cloudflare.com
bob.ns.cloudflare.com
```

**Update these at your domain registrar:**
1. Log into your domain registrar (GoDaddy, Namecheap, etc.)
2. Find DNS/Nameserver settings
3. Replace existing nameservers with Cloudflare's
4. Save changes

⏰ **Wait 1-24 hours** for nameserver propagation

---

### Step 3: Add to Pages

Once domain is active in Cloudflare, follow **Option 1** steps above.

---

## Option 3: Use Cloudflare as DNS Only (Keep existing registrar)

### Step 1: Add CNAME record at your registrar

If you want to keep your current nameservers:

1. Log into your domain registrar
2. Go to DNS settings
3. Add CNAME record:
   ```
   Type: CNAME
   Name: @ (or leave blank for apex)
   Value: 0bef2c74.trade-m8-production.pages.dev
   TTL: Auto or 3600
   ```

4. Add another CNAME for www:
   ```
   Type: CNAME
   Name: www
   Value: 0bef2c74.trade-m8-production.pages.dev
   TTL: Auto or 3600
   ```

⚠️ **Note:** Some registrars don't support CNAME at apex. If that's the case, you must use Option 2 (Cloudflare nameservers).

---

## ✅ Verify Domain Setup

### Check DNS propagation:
```bash
# Check if domain resolves
dig trade-m8.app

# Check if it points to Cloudflare
nslookup trade-m8.app
```

### Test the domain:
```bash
# Health check
curl https://trade-m8.app/api/health

# Should return:
# {"status":"healthy","version":"1.0.0","timestamp":"..."}
```

### Visit in browser:
```
https://trade-m8.app
```

---

## 🔒 SSL Certificate

Cloudflare automatically provisions a free SSL certificate when you add a custom domain.

**SSL will be active when:**
- ✅ Domain points to Cloudflare
- ✅ DNS records are correct
- ✅ Certificate is issued (1-2 minutes)

You'll see a **green lock icon** 🔒 in your browser.

---

## 🎯 Final Setup

Once domain is working, update your `.env.local`:

```bash
APP_URL=https://trade-m8.app
CUSTOM_DOMAIN=trade-m8.app
```

And update any hardcoded URLs in your code to use the custom domain.

---

## 📋 Domain Setup Checklist

**If domain is already in Cloudflare:**
- [ ] Go to Pages → Custom domains
- [ ] Add `trade-m8.app`
- [ ] Wait for SSL provisioning (1-2 min)
- [ ] Add `www.trade-m8.app` (optional)
- [ ] Test: `curl https://trade-m8.app/api/health`

**If domain is NOT in Cloudflare:**
- [ ] Add site to Cloudflare
- [ ] Note the nameservers provided
- [ ] Update nameservers at registrar
- [ ] Wait for propagation (1-24 hours)
- [ ] Follow steps for "already in Cloudflare"

---

## 🆘 Troubleshooting

### "Domain not found"
- Make sure domain is added to your Cloudflare account
- Check that you're using the correct account

### "SSL provisioning failed"
- Wait a few more minutes
- Try removing and re-adding the domain
- Check DNS records are correct

### "Too many redirects"
- Check SSL/TLS mode is set to **Full** or **Full (strict)**
- Go to SSL/TLS → Overview → Set to Full

### "Domain already in use"
- Domain might be in another Cloudflare account
- Or already attached to another Pages project
- Remove it first, then add to this project

---

## 🚀 Quick Start (Fastest Method)

**If trade-m8.app is already in your Cloudflare account:**

1. Click: https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8-production/domains
2. Click "Set up a custom domain"
3. Enter: `trade-m8.app`
4. Click "Continue"
5. Wait 2 minutes
6. Visit: https://trade-m8.app

**Done!** 🎉

---

**Need help?** Let me know if the domain is already in Cloudflare or if you need to add it first!
