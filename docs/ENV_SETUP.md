# Production Environment Variables Setup

## Required Environment Variables for Cloudflare Pages

You need to set these in the Cloudflare Dashboard under your Pages project settings:

### 1. Authentication & Security
```bash
JWT_SECRET=your_ultra_secure_jwt_secret_minimum_32_characters_random
ENCRYPTION_KEY=your_32_byte_base64_encoded_encryption_key
```

### 2. Database (D1)
Already configured in wrangler.toml - no additional vars needed

### 3. Market Data Providers
```bash
COINGECKO_API_KEY=your_coingecko_pro_api_key
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key
COINMARKETCAP_API_KEY=your_coinmarketcap_api_key
```

### 4. Exchange APIs (For Live Trading)

**Binance:**
```bash
BINANCE_API_KEY=your_binance_api_key
BINANCE_SECRET_KEY=your_binance_secret_key
BINANCE_TESTNET=false
```

**Coinbase Pro:**
```bash
COINBASE_API_KEY=your_coinbase_api_key
COINBASE_API_SECRET=your_coinbase_api_secret
COINBASE_PASSPHRASE=your_coinbase_passphrase
```

**Kraken:**
```bash
KRAKEN_API_KEY=your_kraken_api_key
KRAKEN_PRIVATE_KEY=your_kraken_private_key
```

### 5. Web3 & Blockchain (Optional - for DEX trading)
```bash
INFURA_PROJECT_ID=your_infura_project_id_here
ALCHEMY_API_KEY=your_alchemy_api_key_here
```

### 6. Notifications (Optional but Recommended)

**SendGrid (Email alerts):**
```bash
SENDGRID_API_KEY=your_sendgrid_api_key
SENDGRID_FROM_EMAIL=alerts@your-domain.com
```

**Twilio (SMS alerts):**
```bash
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```

### 7. Monitoring (Optional)
```bash
SENTRY_DSN=your_sentry_dsn_for_error_tracking
```

## How to Set Environment Variables in Cloudflare

### Method 1: Via Cloudflare Dashboard
1. Go to https://dash.cloudflare.com/
2. Select your account
3. Go to **Workers & Pages**
4. Select your **trade-m8** project
5. Go to **Settings** > **Environment variables**
6. Add each variable for **Production** environment
7. Click **Save**

### Method 2: Via Wrangler CLI
```bash
# Set individual variables
wrangler pages secret put JWT_SECRET --project-name=trade-m8
wrangler pages secret put BINANCE_API_KEY --project-name=trade-m8
wrangler pages secret put COINBASE_API_KEY --project-name=trade-m8

# You'll be prompted to enter the value for each
```

## Testing Environment Variables

To test in development:
1. Copy `.env.example` to `.env.local`
2. Fill in your test credentials
3. Run `npm run dev`

## Security Best Practices

⚠️ **NEVER commit these values to Git**
⚠️ **Use test/sandbox modes first before live trading**
⚠️ **Enable IP whitelisting on exchange APIs**
⚠️ **Set withdrawal limits on exchange accounts**
⚠️ **Use API keys with trading permissions only (no withdrawal)**

## Production Checklist

Before going live:
- [ ] All environment variables set in Cloudflare
- [ ] JWT_SECRET is strong (32+ random characters)
- [ ] Exchange API keys are for production (not testnet)
- [ ] Exchange API permissions are correct (trade only, no withdraw)
- [ ] IP whitelisting enabled on exchange APIs
- [ ] Email/SMS notifications configured
- [ ] Error monitoring (Sentry) configured
- [ ] Database initialized with schema
- [ ] Test trades executed successfully
- [ ] Risk limits configured appropriately
- [ ] Stop-loss mechanisms tested

## Risk Management Settings

These are set in the environment (optional - defaults are in code):
```bash
MAX_DAILY_LOSS_PERCENT=2
MAX_POSITION_SIZE_PERCENT=5
MAX_PORTFOLIO_EXPOSURE_PERCENT=80
STOP_LOSS_DEFAULT_PERCENT=2
TAKE_PROFIT_DEFAULT_PERCENT=4
MAX_TRADES_PER_MINUTE=10
MAX_ORDER_SIZE_USD=50000
MIN_ORDER_SIZE_USD=10
```

## Feature Flags

Control which features are enabled:
```bash
ENABLE_LIVE_TRADING=false  # Set to true when ready
ENABLE_AUTO_TRADING=false   # Set to true for automated bots
ENABLE_ARBITRAGE=true
ENABLE_ADVANCED_ANALYTICS=true
```

## Getting API Keys

### CoinGecko Pro
1. Visit https://www.coingecko.com/en/api/pricing
2. Sign up for Pro plan
3. Get API key from dashboard

### Binance
1. Visit https://www.binance.com/en/my/settings/api-management
2. Create new API key
3. Enable "Enable Spot & Margin Trading"
4. Save API key and secret
5. Enable IP access restriction (whitelist your server)

### Coinbase Pro
1. Visit https://pro.coinbase.com/profile/api
2. Create new API key
3. Select permissions: View, Trade
4. Save API key, secret, and passphrase

### Infura (for Web3/DEX)
1. Visit https://infura.io/
2. Sign up for free
3. Create new project
4. Get project ID from dashboard

## Support

For issues with environment setup:
- Check Cloudflare Pages logs
- Verify variable names match exactly
- Ensure no trailing spaces in values
- Test with development environment first
