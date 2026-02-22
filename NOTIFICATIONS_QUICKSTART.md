# 🔔 Notification System - Quick Start

## ✅ Status: LIVE & DEPLOYED

**Deployment**: https://trade-m8.app
**Deployed**: Just now (Feb 22, 2026)
**Status**: ✅ All systems operational

---

## 🎯 What You Have Now

Your Trade M8 platform now has **full notification support**:

✅ Email notifications via Resend API
✅ Webhook notifications (Discord, Slack, custom)
✅ Real-time trade tracking
✅ Live position monitoring
✅ Risk alert notifications
✅ TradingView signal alerts

---

## 📧 Email Setup (COMPLETED)

Your Resend API key is configured and ready:
- ✅ `RESEND_API_KEY` = `re_J6qFNdmC_AsEUiTDmPKpVMUP1NzQYJtaT`
- ✅ `EMAIL_FROM` = `Trade M8 <notifications@trade-m8.app>`

**Emails will be sent from**: `notifications@trade-m8.app`

---

## 🚀 How to Use

### 1. Get Your Auth Token

First, log in to your Trade M8 app and get your JWT token:

```bash
# Example login to get token
curl -X POST https://trade-m8.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "password": "your-password"
  }'
```

Save the JWT token from the response.

### 2. Configure Your Email Address

```bash
# Set your token as a variable
export TOKEN="your-jwt-token-here"

# Update notification preferences
curl -X PUT https://trade-m8.app/api/notifications/preferences \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "emailEnabled": true,
    "emailAddress": "your-email@example.com",
    "notifyOnSignalReceived": true,
    "notifyOnTradeExecuted": true,
    "notifyOnTradeClosed": true,
    "notifyOnRiskAlert": true
  }'
```

### 3. Send a Test Notification

```bash
curl -X GET https://trade-m8.app/api/notifications/test \
  -H "Authorization: Bearer $TOKEN"
```

Check your email! You should receive a test TradingView signal notification.

---

## 📊 Live Trade Tracking

### View Active Positions

```bash
curl https://trade-m8.app/api/live-trades/positions \
  -H "Authorization: Bearer $TOKEN"
```

### Get Trading Summary

```bash
curl https://trade-m8.app/api/live-trades/summary \
  -H "Authorization: Bearer $TOKEN"
```

Returns:
- Active positions count & P&L
- Today's trading stats
- 7-day performance
- Pending signals
- Unacknowledged risk alerts

### View Recent Trades

```bash
curl https://trade-m8.app/api/live-trades/recent?hours=24 \
  -H "Authorization: Bearer $TOKEN"
```

### Activity Feed

```bash
curl https://trade-m8.app/api/live-trades/activity?limit=20 \
  -H "Authorization: Bearer $TOKEN"
```

Combined feed of trades, signals, and alerts.

---

## 🔗 Add a Webhook (Discord Example)

### 1. Get Discord Webhook URL

1. Go to your Discord server
2. Server Settings → Integrations → Webhooks
3. Create webhook, copy URL

### 2. Add to Trade M8

```bash
curl -X POST https://trade-m8.app/api/notifications/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Discord Trading Alerts",
    "url": "https://discord.com/api/webhooks/YOUR_WEBHOOK_URL",
    "events": [
      "signal_received",
      "trade_executed",
      "trade_closed",
      "risk_alert"
    ],
    "enabled": true
  }'
```

Now all trading events will be posted to Discord!

---

## 🎨 Notification Types

### 1. Signal Received
**Trigger**: TradingView webhook received
**Email Subject**: 🎯 TradingView Signal: BUY BTC/USDT
**Contains**: Action, symbol, exchange, strategy, price

### 2. Trade Executed
**Trigger**: Bot or signal executes a trade
**Email Subject**: 📈 Trade Executed: BUY BTC/USDT
**Contains**: Side, symbol, quantity, entry price, exchange

### 3. Trade Closed
**Trigger**: Position is closed
**Email Subject**: 🎉 Trade Closed: +$125.50 (+2.51%)
**Contains**: Entry/exit prices, P&L, percentage gain

### 4. Risk Alert
**Trigger**: Risk threshold breached
**Email Subject**: ⚠️ Risk Alert: HIGH - Drawdown exceeds 8%
**Contains**: Alert level, type, message

---

## ⚙️ Advanced Configuration

### Quiet Hours (Don't Disturb)

```bash
curl -X PUT https://trade-m8.app/api/notifications/preferences \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "quietHoursEnabled": true,
    "quietHoursStart": "22:00:00",
    "quietHoursEnd": "08:00:00"
  }'
```

No notifications between 10 PM - 8 AM UTC.

### Risk Level Filters

```bash
curl -X PUT https://trade-m8.app/api/notifications/preferences \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notifyRiskLevelLow": false,
    "notifyRiskLevelMedium": true,
    "notifyRiskLevelHigh": true,
    "notifyRiskLevelCritical": true,
    "notifyRiskLevelEmergency": true
  }'
```

Only get notified for medium+ risk alerts.

### Rate Limiting

```bash
curl -X PUT https://trade-m8.app/api/notifications/preferences \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "maxNotificationsPerHour": 100,
    "maxNotificationsPerDay": 1000
  }'
```

Prevent notification spam.

---

## 📝 View Notification Logs

```bash
# All notifications
curl https://trade-m8.app/api/notifications/logs \
  -H "Authorization: Bearer $TOKEN"

# Only sent emails
curl https://trade-m8.app/api/notifications/logs?status=sent&type=trade_executed \
  -H "Authorization: Bearer $TOKEN"

# Failed notifications
curl https://trade-m8.app/api/notifications/logs?status=failed \
  -H "Authorization: Bearer $TOKEN"
```

---

## 🔄 Webhook Payload Format

Your webhook endpoint will receive POST requests like this:

```json
{
  "event": "trade_executed",
  "timestamp": "2026-02-22T03:30:00.000Z",
  "data": {
    "tradeId": "order-abc123",
    "tradeSide": "buy",
    "tradeSymbol": "BTC/USDT",
    "tradeQuantity": 0.1,
    "tradeEntryPrice": 50000,
    "tradeExchange": "binance",
    "tradeStatus": "filled"
  }
}
```

### Webhook Authentication Options

**Bearer Token**:
```json
{
  "authType": "bearer",
  "authToken": "your-secret-token"
}
```

**Basic Auth**:
```json
{
  "authType": "basic",
  "authUsername": "username",
  "authPassword": "password"
}
```

**Custom Headers**:
```json
{
  "authType": "custom_header",
  "customHeaders": {
    "X-API-Key": "your-api-key"
  }
}
```

---

## 🔍 Troubleshooting

### Not receiving emails?

1. Check your email address in preferences:
   ```bash
   curl https://trade-m8.app/api/notifications/preferences \
     -H "Authorization: Bearer $TOKEN"
   ```

2. Check spam folder

3. View logs to see if emails were sent:
   ```bash
   curl https://trade-m8.app/api/notifications/logs?status=failed \
     -H "Authorization: Bearer $TOKEN"
   ```

4. Send test notification:
   ```bash
   curl https://trade-m8.app/api/notifications/test \
     -H "Authorization: Bearer $TOKEN"
   ```

### Webhook not firing?

1. Check webhook is enabled
2. Verify URL is correct
3. Check events array includes the event type
4. View webhook logs

---

## 📚 Full API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notifications/preferences` | GET | Get settings |
| `/api/notifications/preferences` | PUT | Update settings |
| `/api/notifications/webhooks` | GET | List webhooks |
| `/api/notifications/webhooks` | POST | Add webhook |
| `/api/notifications/webhooks/:id` | PUT | Update webhook |
| `/api/notifications/webhooks/:id` | DELETE | Remove webhook |
| `/api/notifications/logs` | GET | View history |
| `/api/notifications/test` | GET | Send test |
| `/api/live-trades/positions` | GET | Active positions |
| `/api/live-trades/recent` | GET | Recent trades |
| `/api/live-trades/activity` | GET | Activity feed |
| `/api/live-trades/summary` | GET | Dashboard |
| `/api/live-trades/signals` | GET | Recent signals |

---

## 🎯 Next Steps

1. **Get your auth token** from the app
2. **Set your email address** via preferences API
3. **Send test notification** to verify
4. **Add Discord webhook** (optional)
5. **Configure quiet hours** (optional)
6. **Start trading** and get notified!

---

## 🆘 Support

- **Full Guide**: See `NOTIFICATIONS_GUIDE.md`
- **Check Logs**: `/api/notifications/logs`
- **Test System**: `/api/notifications/test`

---

**You're all set!** 🎉

Every TradingView signal and bot trade will now trigger instant notifications to your email and/or webhooks.

**Happy Trading!** 📈
