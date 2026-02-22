# Trade M8 Notification System - Setup Guide

## Overview

The notification system provides real-time alerts for TradingView signals, bot trades, and risk alerts via email and webhooks. You'll be instantly aware of all live trades and critical events.

## Features

✅ **Email Notifications** - Beautiful HTML emails via Resend API
✅ **Webhook Notifications** - HTTP POST to your custom endpoints
✅ **Live Trade Tracking** - Real-time API for active positions and trading activity
✅ **Notification Types**:
- TradingView signal received
- Trade executed (from signals or bots)
- Trade closed with P&L
- Risk alerts (multiple severity levels)
- Position updates

✅ **Smart Filtering**:
- Quiet hours (UTC timezone)
- Rate limiting (hourly/daily)
- Risk level filters
- Event type toggles

---

## Setup Instructions

### 1. Configure Email Notifications (Resend API)

#### Get a Resend API Key

1. Go to https://resend.com and sign up
2. Verify your sending domain or use the free `onboarding@resend.dev` domain
3. Create an API key from the dashboard

#### Add to Cloudflare Pages Secrets

```bash
# Set your Resend API key
wrangler pages secret put RESEND_API_KEY --project-name=trade-m8-live-app
# Paste your key when prompted

# Set the "From" email address
wrangler pages secret put EMAIL_FROM --project-name=trade-m8-live-app
# Enter: Trade M8 <notifications@your-domain.com>
```

Or use the Cloudflare Dashboard:
1. Go to Cloudflare Dashboard → Pages → trade-m8-live-app
2. Settings → Environment Variables → Production
3. Add:
   - `RESEND_API_KEY` = your_resend_api_key
   - `EMAIL_FROM` = `Trade M8 <notifications@trade-m8.app>`

### 2. Deploy the Updated Code

```bash
cd /Users/Gee/trade-m8-live-app
npm run build
wrangler pages deploy dist
```

### 3. Configure Notification Preferences

#### API Endpoints

**Base URL**: `https://trade-m8.app/api/notifications`

All endpoints require authentication via JWT token in the `Authorization: Bearer <token>` header.

#### Get Current Preferences

```bash
GET /api/notifications/preferences
```

Response:
```json
{
  "id": "pref-abc123",
  "userId": "user-xyz789",
  "emailEnabled": true,
  "emailAddress": "you@example.com",
  "webhookEnabled": false,
  "notifyOnSignalReceived": true,
  "notifyOnTradeExecuted": true,
  "notifyOnTradeClosed": true,
  "notifyOnRiskAlert": true,
  "notifyOnPositionUpdate": false,
  "notifyRiskLevelLow": false,
  "notifyRiskLevelMedium": true,
  "notifyRiskLevelHigh": true,
  "notifyRiskLevelCritical": true,
  "notifyRiskLevelEmergency": true,
  "quietHoursEnabled": false,
  "quietHoursStart": null,
  "quietHoursEnd": null,
  "maxNotificationsPerHour": 50,
  "maxNotificationsPerDay": 500
}
```

#### Update Preferences

```bash
PUT /api/notifications/preferences
Content-Type: application/json

{
  "emailEnabled": true,
  "emailAddress": "your-email@example.com",
  "notifyOnSignalReceived": true,
  "notifyOnTradeExecuted": true,
  "notifyOnRiskAlert": true,
  "quietHoursEnabled": true,
  "quietHoursStart": "22:00:00",
  "quietHoursEnd": "08:00:00"
}
```

### 4. Add Webhook Endpoints (Optional)

#### Create Webhook

```bash
POST /api/notifications/webhooks
Content-Type: application/json

{
  "name": "Discord Webhook",
  "url": "https://discord.com/api/webhooks/your-webhook-url",
  "events": [
    "signal_received",
    "trade_executed",
    "risk_alert"
  ],
  "authType": "none",
  "enabled": true,
  "retryOnFailure": true,
  "maxRetries": 3,
  "timeoutMs": 5000
}
```

#### Webhook Authentication Types

- **`none`** - No authentication
- **`bearer`** - Bearer token in `Authorization` header
  ```json
  {
    "authType": "bearer",
    "authToken": "your-secret-token"
  }
  ```
- **`basic`** - Basic HTTP authentication
  ```json
  {
    "authType": "basic",
    "authUsername": "username",
    "authPassword": "password"
  }
  ```
- **`custom_header`** - Custom headers
  ```json
  {
    "authType": "custom_header",
    "customHeaders": {
      "X-API-Key": "your-api-key",
      "X-Custom-Header": "value"
    }
  }
  ```

#### Webhook Payload Format

Your webhook endpoint will receive:

```json
{
  "event": "trade_executed",
  "timestamp": "2026-02-22T02:30:00.000Z",
  "data": {
    "tradeId": "order-123",
    "tradeSide": "buy",
    "tradeSymbol": "BTC/USDT",
    "tradeQuantity": 0.1,
    "tradeEntryPrice": 50000,
    "tradeExchange": "binance",
    "tradeStatus": "filled"
  }
}
```

---

## Live Trade Tracking API

### Active Positions

```bash
GET /api/live-trades/positions
```

Returns all active positions with real-time P&L.

### Recent Trades

```bash
GET /api/live-trades/recent?hours=24&limit=50
```

Returns trades from the last N hours.

### Trading Activity Feed

```bash
GET /api/live-trades/activity?limit=20
```

Returns a combined feed of recent trades, signals, and risk alerts.

### Dashboard Summary

```bash
GET /api/live-trades/summary
```

Returns comprehensive trading metrics:
- Active positions count and value
- Today's trading performance
- Pending signals
- Unacknowledged risk alerts
- 7-day performance stats

### Recent Signals

```bash
GET /api/live-trades/signals?limit=50&status=received
```

Returns TradingView signals with optional status filter.

---

## Email Notification Examples

### Signal Received
- **Subject**: 🎯 TradingView Signal: BUY BTC/USDT
- **Content**: Action, symbol, exchange, strategy, price
- **Color**: Purple gradient header

### Trade Executed
- **Subject**: 📈 Trade Executed: BUY BTC/USDT
- **Content**: Side, symbol, quantity, entry price, total value
- **Color**: Green gradient header

### Trade Closed
- **Subject**: 🎉 Trade Closed: +$125.50 (+2.51%)
- **Content**: Symbol, entry/exit prices, P&L
- **Color**: Green (profit) or Orange (loss)

### Risk Alert
- **Subject**: ⚠️ Risk Alert: HIGH - Portfolio drawdown exceeds 8%
- **Content**: Alert level, type, message
- **Color**: Red/orange based on severity

---

## Testing the System

### Send Test Notification

```bash
GET /api/notifications/test
Authorization: Bearer <your-jwt-token>
```

This will send a test signal notification to verify your setup.

### Check Notification Logs

```bash
GET /api/notifications/logs?limit=50&status=sent
```

Query parameters:
- `limit` - Number of logs to return (default: 50)
- `offset` - Pagination offset
- `status` - Filter by status: `sent`, `failed`, `pending`
- `type` - Filter by type: `signal_received`, `trade_executed`, etc.

---

## Integration Points

### TradingView Signals

Notifications are automatically sent when:
1. A TradingView webhook is received (`/api/tradingview/webhook`)
2. The signal is logged to the database
3. A trade is executed based on the signal

Location: `functions/api/tradingview.ts:484-499`

### Bot Trading

Notifications are automatically sent when:
1. A bot executes a trade via `TradingSystem.executeTrade()`
2. A risk alert is triggered by the risk manager

Location: `functions/lib/trading-system.ts:166-184`

### Risk Alerts

Risk alerts are triggered by:
- Drawdown exceeding thresholds
- VaR breaches
- Position size violations
- Correlation risk warnings
- Emergency stop signals

Location: `functions/lib/trading-system.ts:37-59`

---

## Troubleshooting

### No emails received

1. **Check Resend API key**: Verify `RESEND_API_KEY` is set correctly
2. **Verify email address**: Check your preferences via API
3. **Check spam folder**: Email might be filtered
4. **Check notification logs**: Use `/api/notifications/logs` to see errors
5. **Verify domain**: If using custom domain, ensure it's verified in Resend

### Webhooks not firing

1. **Check webhook is enabled**: `enabled: true`
2. **Verify events subscribed**: Ensure event type is in the `events` array
3. **Check webhook logs**: Use `/api/notifications/logs?channel=webhook`
4. **Test webhook URL**: Use a service like webhook.site to test
5. **Check authentication**: Verify auth credentials are correct

### Rate limiting

If hitting rate limits:
- Increase `maxNotificationsPerHour` or `maxNotificationsPerDay`
- Default: 50/hour, 500/day
- Update via `/api/notifications/preferences`

### Quiet hours not working

- Ensure `quietHoursEnabled: true`
- Times are in UTC format: `"HH:MM:SS"`
- For overnight quiet hours (e.g., 22:00 - 08:00), the system handles wraparound automatically

---

## Database Schema

### notification_preferences

Stores user notification settings.

### webhook_endpoints

Stores user webhook configurations with authentication and retry settings.

### notification_logs

Audit trail of all notifications sent, with status and error tracking.

---

## API Reference Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notifications/preferences` | GET | Get preferences |
| `/api/notifications/preferences` | PUT | Update preferences |
| `/api/notifications/webhooks` | GET | List webhooks |
| `/api/notifications/webhooks` | POST | Create webhook |
| `/api/notifications/webhooks/:id` | PUT | Update webhook |
| `/api/notifications/webhooks/:id` | DELETE | Delete webhook |
| `/api/notifications/logs` | GET | Get notification history |
| `/api/notifications/test` | GET | Send test notification |
| `/api/live-trades/positions` | GET | Active positions |
| `/api/live-trades/recent` | GET | Recent trades |
| `/api/live-trades/activity` | GET | Activity feed |
| `/api/live-trades/summary` | GET | Dashboard summary |
| `/api/live-trades/signals` | GET | Recent signals |

---

## Next Steps

1. ✅ Set up Resend API key
2. ✅ Deploy the updated code
3. ✅ Configure your notification preferences
4. ✅ Add webhook endpoints (optional)
5. ✅ Test with `/api/notifications/test`
6. ✅ Monitor via `/api/live-trades/summary`

---

## Support

For issues or questions:
- Check notification logs: `/api/notifications/logs`
- Review Cloudflare Pages logs
- Verify environment variables are set
- Test with the `/api/notifications/test` endpoint

---

**Built with:**
- Resend API for email delivery
- Cloudflare D1 for data storage
- Cloudflare Pages Functions for serverless execution
- Beautiful responsive HTML email templates
