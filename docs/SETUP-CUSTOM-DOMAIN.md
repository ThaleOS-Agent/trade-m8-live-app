# 🌐 Connect trade-m8.app to Your Cloudflare Pages Deployment

## Step 1: Add Custom Domain in Cloudflare Pages

### 1.1 Go to Your Pages Project

Visit: https://dash.cloudflare.com/e0b57c607cc62ffd3f409df4f0f7c0f9/pages/view/trade-m8

### 1.2 Navigate to Custom Domains

1. Click the **Custom domains** tab at the top
2. Click **Set up a custom domain** button

### 1.3 Add Your Domain

1. Enter: **trade-m8.app**
2. Click **Continue**

Cloudflare will now check if the domain is in your account.

---

## Step 2: Configure DNS

You'll see one of two scenarios:

### Scenario A: Domain is Already on Cloudflare ✅

**If trade-m8.app is already in your Cloudflare account:**

1. Cloudflare will show: "Domain found in your account"
2. It will offer to automatically add DNS records
3. Click **Activate domain**
4. Cloudflare automatically creates:
   - `CNAME` record: `trade-m8.app` → `trade-m8.pages.dev`
   - Or `A` and `AAAA` records pointing to Cloudflare IPs

**✅ Done! Skip to Step 3.**

---

### Scenario B: Domain is NOT on Cloudflare

**If trade-m8.app is registered elsewhere (GoDaddy, Namecheap, etc.):**

You have two options:

#### Option 1: Transfer DNS to Cloudflare (Recommended)

1. Go to: https://dash.cloudflare.com
2. Click **Add a site**
3. Enter: **trade-m8.app**
4. Choose **Free** plan
5. Click **Continue**
6. Cloudflare will scan your existing DNS records
7. Review and click **Continue**
8. Cloudflare will provide nameservers like:
   ```
   ana.ns.cloudflare.com
   reza.ns.cloudflare.com
   ```
9. **Go to your domain registrar** (where you bought trade-m8.app)
10. **Update nameservers** to the ones Cloudflare provided
11. Wait 24-48 hours for nameserver propagation
12. Once active, return to Pages → Custom domains
13. Add **trade-m8.app**

#### Option 2: Keep DNS with Current Registrar

1. Cloudflare will show DNS records you need to add
2. Copy the DNS records shown
3. Go to your domain registrar's DNS settings
4. Add the records:

**For Root Domain (trade-m8.app):**
```
Type: CNAME
Name: @ (or leave blank)
Target: trade-m8.pages.dev
```

**If CNAME for root is not supported:**
```
Type: A
Name: @ (or leave blank)
Value: 192.0.2.1 (Cloudflare will provide actual IP)

Type: AAAA
Name: @ (or leave blank)
Value: 100:: (Cloudflare will provide actual IPv6)
```

**For www Subdomain (optional):**
```
Type: CNAME
Name: www
Target: trade-m8.pages.dev
```

5. Save DNS records
6. Wait 5-10 minutes for DNS propagation

---

## Step 3: Add www Subdomain (Optional)

To make **www.trade-m8.app** also work:

1. In Custom domains, click **Set up a custom domain** again
2. Enter: **www.trade-m8.app**
3. Click **Continue**
4. Follow the same DNS setup process

This ensures both URLs work:
- https://trade-m8.app
- https://www.trade-m8.app

---

## Step 4: Wait for SSL Certificate Provisioning

After DNS is configured:

1. Cloudflare automatically provisions an SSL certificate
2. This takes **5-15 minutes** (sometimes up to 24 hours)
3. You'll see status in Custom domains:
   - 🟡 **Pending** - DNS propagating
   - 🟡 **Initializing** - SSL provisioning
   - 🟢 **Active** - Ready to use!

**Current Status Check:**
- Go to: Pages → Custom domains
- Look for green checkmark next to **trade-m8.app**

---

## Step 5: Verify Domain is Working

Once status is **Active**:

### Test in Browser:
1. Visit: **https://trade-m8.app**
2. Should see your Trade M8 application
3. Check SSL: Lock icon in address bar
4. Login with: demo@xqtradem8.com / demo123

### Test with cURL:
```bash
# Test domain resolves
curl -I https://trade-m8.app

# Test API
curl https://trade-m8.app/api/health
```

Should return:
```json
{"status":"healthy","version":"1.0.0","timestamp":"..."}
```

---

## Step 6: Set Primary Domain (Optional)

To make trade-m8.app your primary domain and redirect from pages.dev:

1. Go to: Pages → trade-m8 → Settings → Domains
2. Click **⋮** next to **trade-m8.app**
3. Select **Set as production domain**

Now:
- **trade-m8.app** = Primary domain
- **xq-s-trade-m8.pages.dev** = Redirects to trade-m8.app

---

## Quick Command Method (If Domain Already on Cloudflare)

If `trade-m8.app` is already in your Cloudflare account, you can add it via CLI:

```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
export CLOUDFLARE_API_TOKEN="kae7k3KJvSdETK77zsSJ3oRaJSEVrqoPQcVQZ3B8"

# Add custom domain
wrangler pages domain add trade-m8 trade-m8.app

# Add www subdomain
wrangler pages domain add trade-m8 www.trade-m8.app
```

---

## Troubleshooting

### DNS Not Propagating?

**Check DNS:**
```bash
# Check if DNS is configured
dig trade-m8.app

# Check CNAME
dig trade-m8.app CNAME
```

**Online Tools:**
- https://dnschecker.org - Check DNS propagation globally
- Enter: `trade-m8.app`
- Should show: `CNAME trade-m8.pages.dev` or Cloudflare IPs

### SSL Certificate Stuck?

**Common Issues:**
1. DNS not fully propagated (wait longer)
2. CAA records blocking certificate (remove CAA records)
3. DNSSEC issues (temporarily disable DNSSEC)

**Force Retry:**
1. Pages → Custom domains
2. Remove the domain
3. Wait 5 minutes
4. Add it again

### Domain Shows Error Page?

**Check:**
1. ✅ DNS records are correct
2. ✅ SSL status is "Active"
3. ✅ Domain is not proxied twice (orange cloud in DNS)
4. ✅ No conflicting page rules

---

## Expected DNS Configuration

### If Domain is on Cloudflare:

**DNS Records:**
```
Type: CNAME
Name: trade-m8.app
Target: trade-m8.pages.dev
Proxy: Yes (orange cloud)

Type: CNAME
Name: www
Target: trade-m8.pages.dev
Proxy: Yes (orange cloud)
```

### If Domain is External:

**At Your Registrar:**
```
Type: CNAME
Name: @ (or blank for root)
Target: trade-m8.pages.dev

Type: CNAME
Name: www
Target: trade-m8.pages.dev
```

---

## After Domain is Active

### Update Your App Configuration (Optional)

If your app references the domain:

1. Update `.env.local`:
   ```
   APP_URL=https://trade-m8.app
   CUSTOM_DOMAIN=trade-m8.app
   ```

2. Redeploy if needed:
   ```bash
   export NODE_TLS_REJECT_UNAUTHORIZED=0
   export CLOUDFLARE_API_TOKEN="kae7k3KJvSdETK77zsSJ3oRaJSEVrqoPQcVQZ3B8"
   wrangler pages deploy dist --project-name=trade-m8
   ```

---

## Security & Performance

Once domain is active, you automatically get:

✅ **SSL/TLS Encryption** - Automatic HTTPS
✅ **HTTP/2 & HTTP/3** - Modern protocols
✅ **DDoS Protection** - Cloudflare network
✅ **WAF** - Web Application Firewall
✅ **Global CDN** - Edge caching worldwide
✅ **Auto Minification** - Faster loading
✅ **Brotli Compression** - Smaller files

---

## Cost

**Custom domains on Cloudflare Pages: FREE** ✅

Includes:
- Unlimited custom domains
- Free SSL certificates
- Automatic renewals
- Global CDN
- DDoS protection

---

## Summary

### Quick Steps:
1. ✅ Go to Pages → Custom domains
2. ✅ Add **trade-m8.app**
3. ✅ Configure DNS (automatic if domain on Cloudflare)
4. ✅ Wait for SSL (5-15 minutes)
5. ✅ Verify domain works
6. ✅ Optionally add **www.trade-m8.app**

### Your URLs After Setup:
- **Primary**: https://trade-m8.app
- **WWW**: https://www.trade-m8.app
- **Original**: https://xq-s-trade-m8.pages.dev (still works)

---

**Time Required:**
- If domain on Cloudflare: **5 minutes**
- If domain external: **10-60 minutes** (depends on DNS propagation)

---

**Ready to add your domain? Let me know if you need help with any step!** 🚀
