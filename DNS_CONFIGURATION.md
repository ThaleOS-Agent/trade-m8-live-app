# DNS Configuration Guide - trade-m8.app

## ✅ Current Status

Your domain `trade-m8.app` is **correctly configured** and working!

**Verification**:
- ✅ Domain resolves: `trade-m8.app` → Cloudflare IPs
- ✅ HTTPS enabled: SSL/TLS active
- ✅ Site accessible: https://trade-m8.app (200 OK)
- ✅ Custom domain connected to Cloudflare Pages

---

## 🌐 Current DNS Configuration

### Primary Domain (trade-m8.app)

```
Type: A Records (Cloudflare Proxied)
Name: @
Values:
  - 172.67.214.239
  - 104.21.91.99

Status: ✅ Active
Proxy: ✅ Enabled (Orange Cloud)
SSL: ✅ Full (strict)
```

**How it works**:
1. User visits `trade-m8.app`
2. DNS resolves to Cloudflare's edge IPs
3. Cloudflare proxies request to `trade-m8-live-app.pages.dev`
4. Pages Function responds with your app
5. Response is cached at Cloudflare edge

---

## 📋 DNS Configuration Methods

You have **two options** for configuring custom domains with Cloudflare Pages:

### **Option 1: A Records (Current Setup) ✅**

**Recommended for root domains** (`trade-m8.app`)

```
Type: A
Name: @
Value: 172.67.214.239
Proxy: ✅ Proxied (Orange cloud)

Type: A
Name: @
Value: 104.21.91.99
Proxy: ✅ Proxied (Orange cloud)
```

**Benefits**:
- ✅ Works for root/apex domains
- ✅ Cloudflare's DDoS protection
- ✅ Automatic SSL/TLS
- ✅ CDN caching
- ✅ Analytics & logs

### **Option 2: CNAME Record**

**Recommended for subdomains** (`www.trade-m8.app`, `api.trade-m8.app`)

```
Type: CNAME
Name: www
Value: trade-m8-live-app.pages.dev
Proxy: ✅ Proxied (Orange cloud)
```

**Benefits**:
- ✅ Points directly to Pages deployment
- ✅ Easier to manage
- ✅ Auto-updates if Pages changes IPs
- ⚠️ **Cannot be used for root domain** (DNS limitation)

---

## 🔧 How to Configure DNS (Cloudflare Dashboard)

### For Root Domain (trade-m8.app) - Already Done ✅

1. **Log in to Cloudflare Dashboard**
   - Go to https://dash.cloudflare.com
   - Select `trade-m8.app` domain

2. **Navigate to DNS**
   - Click "DNS" in left sidebar
   - Click "Records"

3. **Add A Records** (if not already present)
   ```
   Type: A
   Name: @
   IPv4 address: 172.67.214.239
   Proxy status: Proxied (🟠 orange cloud)
   TTL: Auto
   ```

   Click "Add Record", then add second A record:
   ```
   Type: A
   Name: @
   IPv4 address: 104.21.91.99
   Proxy status: Proxied (🟠 orange cloud)
   TTL: Auto
   ```

4. **Verify in Pages**
   - Go to Pages → trade-m8-live-app
   - Custom domains → Should show `trade-m8.app` as "Active"

### For WWW Subdomain (Optional)

1. **Add CNAME Record**
   ```
   Type: CNAME
   Name: www
   Target: trade-m8-live-app.pages.dev
   Proxy status: Proxied (🟠 orange cloud)
   TTL: Auto
   ```

2. **Add to Pages Custom Domains**
   - Pages → trade-m8-live-app → Custom domains
   - Click "Set up a custom domain"
   - Enter: `www.trade-m8.app`
   - Click "Continue" → "Activate domain"

---

## 🔐 SSL/TLS Configuration

### Current SSL Mode

**Recommended**: Full (strict) ✅

1. Go to SSL/TLS in Cloudflare Dashboard
2. Overview → SSL/TLS encryption mode
3. Select **"Full (strict)"**

**Why this is important**:
- Cloudflare → Your Origin: Encrypted
- User → Cloudflare: Encrypted (always HTTPS)
- Validates origin SSL certificate
- Best security

### SSL Certificate Status

Your domain should have:
- ✅ Universal SSL Certificate (Free)
- ✅ Auto-renewal enabled
- ✅ Edge certificates active
- ✅ HTTPS Rewrites enabled

To verify:
1. SSL/TLS → Edge Certificates
2. Check certificate is "Active"
3. Expiry should be in the future

---

## 🚀 Additional DNS Records (Optional)

### API Subdomain

If you want `api.trade-m8.app`:

```
Type: CNAME
Name: api
Target: trade-m8-live-app.pages.dev
Proxy: Proxied
```

### Email (MX Records)

If using custom email with Resend:

1. **Verify domain in Resend**
   - Go to https://resend.com/domains
   - Add `trade-m8.app`
   - Get verification records

2. **Add DNS Records**
   ```
   Type: TXT
   Name: @
   Value: [Resend verification string]

   Type: MX
   Name: @
   Priority: 10
   Value: feedback-smtp.us-east-1.amazonses.com
   ```

3. **SPF Record** (Prevent spoofing)
   ```
   Type: TXT
   Name: @
   Value: v=spf1 include:amazonses.com ~all
   ```

4. **DKIM Record** (Email authentication)
   ```
   Type: TXT
   Name: resend._domainkey
   Value: [Resend provides this]
   ```

---

## 🔍 DNS Verification Commands

### Check A Records
```bash
dig trade-m8.app +short
# Should return:
# 172.67.214.239
# 104.21.91.99
```

### Check CNAME (www)
```bash
dig www.trade-m8.app CNAME +short
# Should return:
# trade-m8-live-app.pages.dev
```

### Check SSL Certificate
```bash
curl -vI https://trade-m8.app 2>&1 | grep -i "SSL\|TLS\|certificate"
```

### Test Full Request
```bash
curl -I https://trade-m8.app
# Should return: HTTP/2 200
```

### Check DNS Propagation
```bash
# Check from multiple locations
dig @8.8.8.8 trade-m8.app +short  # Google DNS
dig @1.1.1.1 trade-m8.app +short  # Cloudflare DNS
```

---

## 🌍 DNS Propagation

DNS changes can take time to propagate:

- **Cloudflare Edge**: ~1 minute
- **Global DNS**: 5-30 minutes
- **ISP Cache**: Up to 48 hours (rare)

**Check propagation globally**: https://www.whatsmydns.net/#A/trade-m8.app

---

## 🛠️ Troubleshooting

### Domain not resolving

1. **Check DNS records in Cloudflare**
   - Verify A or CNAME records exist
   - Check proxy status is "Proxied" (orange cloud)

2. **Flush DNS cache**
   ```bash
   # macOS
   sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

   # Windows
   ipconfig /flushdns

   # Linux
   sudo systemd-resolve --flush-caches
   ```

3. **Check Pages custom domain status**
   - Cloudflare Dashboard → Pages → trade-m8-live-app
   - Custom domains → Should show "Active"

### SSL/TLS Errors

1. **Check SSL mode**
   - Should be "Full" or "Full (strict)"
   - NOT "Flexible" (causes redirect loops)

2. **Wait for certificate issuance**
   - Universal SSL can take up to 24 hours
   - Check SSL/TLS → Edge Certificates

3. **Clear browser cache**
   - Force refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

### 522 Error (Connection timed out)

1. **Check origin is responding**
   ```bash
   curl -I https://trade-m8-live-app.pages.dev
   ```

2. **Verify Pages deployment is active**
   - Should see green "Active" status

3. **Check Cloudflare status**
   - https://www.cloudflarestatus.com

---

## 📊 Current Setup Summary

```
┌─────────────────────┐
│   User's Browser    │
└──────────┬──────────┘
           │ https://trade-m8.app
           ↓
┌─────────────────────┐
│  Cloudflare Edge    │ ← 172.67.214.239 / 104.21.91.99
│  (DNS + CDN + WAF)  │
└──────────┬──────────┘
           │ Proxied request
           ↓
┌─────────────────────┐
│  Cloudflare Pages   │ ← trade-m8-live-app.pages.dev
│  (Origin Server)    │
└──────────┬──────────┘
           │ Response
           ↓
┌─────────────────────┐
│   User receives     │
│  https://trade-m8.app│
└─────────────────────┘
```

**Benefits of this setup**:
- ✅ Global CDN (faster load times)
- ✅ DDoS protection
- ✅ Free SSL/TLS
- ✅ Auto-scaling
- ✅ 99.99% uptime
- ✅ Analytics & insights

---

## 🎯 Recommended DNS Records

### Minimal Setup (Current) ✅
```
Type: A     | Name: @   | Value: 172.67.214.239 | Proxy: ✅
Type: A     | Name: @   | Value: 104.21.91.99   | Proxy: ✅
```

### Complete Setup (Recommended)
```
Type: A     | Name: @   | Value: 172.67.214.239     | Proxy: ✅
Type: A     | Name: @   | Value: 104.21.91.99       | Proxy: ✅
Type: CNAME | Name: www | Value: trade-m8-live-app.pages.dev | Proxy: ✅
Type: TXT   | Name: @   | Value: v=spf1 include:amazonses.com ~all
```

---

## 📞 Support Resources

- **Cloudflare DNS Docs**: https://developers.cloudflare.com/dns/
- **Pages Custom Domains**: https://developers.cloudflare.com/pages/configuration/custom-domains/
- **DNS Checker**: https://dnschecker.org
- **SSL Labs Test**: https://www.ssllabs.com/ssltest/analyze.html?d=trade-m8.app

---

## ✅ Your Current Status

| Component | Status | Details |
|-----------|--------|---------|
| Domain | ✅ Active | trade-m8.app resolving correctly |
| DNS Records | ✅ Configured | A records pointing to Cloudflare |
| SSL/TLS | ✅ Active | HTTPS enabled with valid cert |
| Pages Deployment | ✅ Live | Latest deployment active |
| Custom Domain | ✅ Connected | Pages recognizes domain |
| Proxy | ✅ Enabled | Orange cloud active |

**Everything is working perfectly!** 🎉

---

## 🔄 Future Changes

If you need to update DNS:

1. **Change hosting provider**
   - Update A records to new IPs
   - Or change CNAME target

2. **Add subdomains**
   - Create new CNAME records
   - Add to Pages custom domains

3. **Move to different Pages project**
   - Update CNAME to new project
   - Or update A records

---

**Your DNS is optimally configured for Cloudflare Pages!** ✅

No action needed unless you want to add www subdomain or configure email sending.
