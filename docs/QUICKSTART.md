# ⚡ QUICK START - Deploy in 5 Minutes

## 🎯 The Fastest Way to Deploy XQ Trade M8

### Prerequisites (2 minutes)
- Node.js 18+ installed
- Cloudflare account (free)
- API keys ready (see below)

---

## 🚀 3-STEP DEPLOYMENT

### Step 1: Extract & Install (1 minute)
```bash
# Extract the ZIP file
unzip xq-trade-m8-cloudflare.zip
cd xq-trade-m8-cloudflare

# Install dependencies
npm install
```

### Step 2: Configure (2 minutes)
```bash
# Copy environment template
cp .env.example .env.local

# Edit with your API keys
nano .env.local  # or use any text editor
```

**Required API Keys:**
- Cloudflare Account ID (free): https://dash.cloudflare.com
- Supabase (free): https://supabase.com
- CoinGecko (free): https://www.coingecko.com/en/api

### Step 3: Deploy (2 minutes)
```bash
# Run automated deployment
./scripts/deploy-cloudflare.sh
```

**DONE! Your platform is live! 🎉**

---

## 📱 USING CLAUDE CODE (EVEN EASIER!)

### One-Command Deployment
```bash
# Start Claude Code
claude code

# Then just say:
"Deploy XQ Trade M8 to Cloudflare"
```

Claude Code will:
- ✅ Guide you through API keys
- ✅ Configure everything
- ✅ Deploy automatically
- ✅ Run health checks
- ✅ Provide your live URL

**Time: 3-5 minutes total!**

---

## 🔑 Getting API Keys

### 1. Cloudflare (Required - FREE)
1. Go to https://dash.cloudflare.com
2. Sign up/login
3. Click on your profile → Account ID
4. Copy your Account ID

### 2. Supabase (Required - FREE)
1. Go to https://supabase.com
2. Create account → New Project
3. Project Settings → API
4. Copy URL and anon key

### 3. CoinGecko (Required - FREE)
1. Go to https://www.coingecko.com/en/api
2. Sign up for free account
3. Dashboard → API Keys
4. Copy your key

### 4. Trading APIs (Optional - for live trading)
- Binance: https://www.binance.com/en/binance-api
- OANDA: https://www.oanda.com/demo-account/

**Start with DEMO mode - no trading APIs needed!**

---

## ✅ Post-Deployment

### 1. Access Your Platform
```
Your URL will be shown after deployment:
https://xq-trade-m8-xxx.pages.dev
```

### 2. Login
```
Default credentials:
Email: demo@xqtradem8.com
Password: demo123

(Create your own account after logging in!)
```

### 3. Test Demo Trading
- Dashboard → Create Bot
- Select "Ensemble Master" strategy
- Mode: "Paper Trading"
- Click "Start Bot"

### 4. Monitor Performance
- View real-time trades
- Check win rate (target: >70%)
- Review P&L
- Adjust risk settings

---

## 🆘 Troubleshooting

### "npm not found"
```bash
# Install Node.js from nodejs.org
# Then run: npm install -g npm
```

### "wrangler not found"
```bash
# Install globally
npm install -g wrangler
```

### "Database connection failed"
```bash
# Verify Supabase credentials in .env.local
# Make sure you copied BOTH URL and key
```

### "Deployment failed"
```bash
# Check you're logged into Cloudflare
wrangler login

# Then run deployment again
./scripts/deploy-cloudflare.sh
```

---

## 📊 Expected Results

After deployment, you should see:

```
✅ Workers deployed
✅ Pages deployed  
✅ Database created
✅ Health check passed

Application URL: https://xq-trade-m8-xxx.pages.dev
Status: Active
Version: 1.0.0
```

---

## 🎓 Next Steps

1. **Week 1**: Test demo trading
   - Let bots run for 7 days
   - Monitor performance
   - Verify >70% win rate

2. **Week 2**: Small live test (optional)
   - Connect real exchange API
   - Start with $100-500
   - Use testnet/demo accounts

3. **Week 3+**: Scale gradually
   - Increase capital slowly
   - Monitor closely
   - Adjust risk parameters

---

## 💡 Quick Commands

### View Logs
```bash
wrangler tail
```

### Check Status
```bash
wrangler deployments list
```

### Update Deployment
```bash
npm run build
npm run deploy
```

### Rollback
```bash
wrangler rollback
```

---

## ⚖️ Important

- ⚠️ **Start with DEMO mode only**
- ⚠️ **Never commit .env.local to Git**
- ⚠️ **Use strong passwords**
- ⚠️ **Enable 2FA on all accounts**
- ⚠️ **Start small with real money**

---

## 📞 Get Help

- 📖 Full docs: See README.md
- 💬 Ask Claude Code: Just describe your issue
- 🐛 Report bugs: GitHub issues
- 📧 Email: support@xqtradem8.com

---

**Total Time: 5 minutes from ZIP to Live Platform! 🚀**
