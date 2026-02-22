/**
 * Notification Service
 * Handles email and webhook notifications for TradingView signals, trades, and risk alerts
 */

import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// TYPES
// ============================================================================

export type NotificationType =
  | 'signal_received'
  | 'trade_executed'
  | 'trade_closed'
  | 'risk_alert'
  | 'position_update'
  | 'daily_summary';

export type NotificationChannel = 'email' | 'webhook';

export interface NotificationData {
  // Signal data
  signalId?: string;
  signalAction?: string;
  signalSymbol?: string;
  signalExchange?: string;
  signalStrategy?: string;
  signalPrice?: number;

  // Trade data
  tradeId?: string;
  tradeSide?: string;
  tradeSymbol?: string;
  tradeQuantity?: number;
  tradeEntryPrice?: number;
  tradeExitPrice?: number;
  tradePnl?: number;
  tradePnlPercent?: number;
  tradeExchange?: string;
  tradeStatus?: string;

  // Risk alert data
  riskAlertId?: string;
  riskAlertType?: string;
  riskAlertLevel?: string;
  riskAlertMessage?: string;

  // Position data
  positionId?: string;
  positionSymbol?: string;
  positionSide?: string;
  positionPnl?: number;
  positionPnlPercent?: number;

  // Additional context
  timestamp?: string;
  [key: string]: any;
}

export interface SendNotificationParams {
  userId: string;
  type: NotificationType;
  data: NotificationData;
  db: D1Database;
  env: any; // Cloudflare env with RESEND_API_KEY
}

export interface NotificationPreferences {
  id: string;
  userId: string;
  emailEnabled: boolean;
  emailAddress: string | null;
  webhookEnabled: boolean;
  notifyOnSignalReceived: boolean;
  notifyOnTradeExecuted: boolean;
  notifyOnTradeClosed: boolean;
  notifyOnRiskAlert: boolean;
  notifyOnPositionUpdate: boolean;
  notifyOnDailySummary: boolean;
  notifyRiskLevelLow: boolean;
  notifyRiskLevelMedium: boolean;
  notifyRiskLevelHigh: boolean;
  notifyRiskLevelCritical: boolean;
  notifyRiskLevelEmergency: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  maxNotificationsPerHour: number;
  maxNotificationsPerDay: number;
}

export interface WebhookEndpoint {
  id: string;
  userId: string;
  name: string;
  url: string;
  authType: 'none' | 'bearer' | 'basic' | 'custom_header';
  authToken: string | null;
  authUsername: string | null;
  authPassword: string | null;
  customHeaders: string | null;
  enabled: boolean;
  retryOnFailure: boolean;
  maxRetries: number;
  timeoutMs: number;
  events: string; // JSON array
}

// ============================================================================
// NOTIFICATION SERVICE CLASS
// ============================================================================

export class NotificationService {
  private db: D1Database;
  private env: any;

  constructor(db: D1Database, env: any) {
    this.db = db;
    this.env = env;
  }

  /**
   * Send notification to user via all enabled channels
   */
  async sendNotification(params: SendNotificationParams): Promise<{
    success: boolean;
    emailSent: boolean;
    webhooksSent: number;
    errors: string[];
  }> {
    const { userId, type, data } = params;

    const result = {
      success: false,
      emailSent: false,
      webhooksSent: 0,
      errors: [] as string[],
    };

    try {
      // 1. Get user preferences
      const prefs = await this.getUserPreferences(userId);
      if (!prefs) {
        result.errors.push('User preferences not found');
        return result;
      }

      // 2. Check if this notification type is enabled
      if (!this.isNotificationTypeEnabled(type, data, prefs)) {
        result.errors.push(`Notification type ${type} is disabled for user`);
        return result;
      }

      // 3. Check quiet hours
      if (this.isQuietHours(prefs)) {
        result.errors.push('Currently in quiet hours');
        return result;
      }

      // 4. Check rate limits
      const rateLimitOk = await this.checkRateLimit(userId, prefs);
      if (!rateLimitOk) {
        result.errors.push('Rate limit exceeded');
        return result;
      }

      // 5. Send email notification
      if (prefs.emailEnabled && prefs.emailAddress) {
        try {
          await this.sendEmailNotification(userId, type, data, prefs.emailAddress);
          result.emailSent = true;
        } catch (error: any) {
          result.errors.push(`Email error: ${error.message}`);
        }
      }

      // 6. Send webhook notifications
      if (prefs.webhookEnabled) {
        const webhookCount = await this.sendWebhookNotifications(userId, type, data);
        result.webhooksSent = webhookCount;
      }

      result.success = result.emailSent || result.webhooksSent > 0;
      return result;

    } catch (error: any) {
      result.errors.push(`Notification service error: ${error.message}`);
      return result;
    }
  }

  /**
   * Get user notification preferences
   */
  private async getUserPreferences(userId: string): Promise<NotificationPreferences | null> {
    const result = await this.db.prepare(
      `SELECT * FROM notification_preferences WHERE user_id = ? LIMIT 1`
    ).bind(userId).first();

    if (!result) return null;

    return {
      id: result.id as string,
      userId: result.user_id as string,
      emailEnabled: Boolean(result.email_enabled),
      emailAddress: result.email_address as string | null,
      webhookEnabled: Boolean(result.webhook_enabled),
      notifyOnSignalReceived: Boolean(result.notify_on_signal_received),
      notifyOnTradeExecuted: Boolean(result.notify_on_trade_executed),
      notifyOnTradeClosed: Boolean(result.notify_on_trade_closed),
      notifyOnRiskAlert: Boolean(result.notify_on_risk_alert),
      notifyOnPositionUpdate: Boolean(result.notify_on_position_update),
      notifyOnDailySummary: Boolean(result.notify_on_daily_summary),
      notifyRiskLevelLow: Boolean(result.notify_risk_level_low),
      notifyRiskLevelMedium: Boolean(result.notify_risk_level_medium),
      notifyRiskLevelHigh: Boolean(result.notify_risk_level_high),
      notifyRiskLevelCritical: Boolean(result.notify_risk_level_critical),
      notifyRiskLevelEmergency: Boolean(result.notify_risk_level_emergency),
      quietHoursEnabled: Boolean(result.quiet_hours_enabled),
      quietHoursStart: result.quiet_hours_start as string | null,
      quietHoursEnd: result.quiet_hours_end as string | null,
      maxNotificationsPerHour: result.max_notifications_per_hour as number,
      maxNotificationsPerDay: result.max_notifications_per_day as number,
    };
  }

  /**
   * Check if notification type is enabled for user
   */
  private isNotificationTypeEnabled(
    type: NotificationType,
    data: NotificationData,
    prefs: NotificationPreferences
  ): boolean {
    switch (type) {
      case 'signal_received':
        return prefs.notifyOnSignalReceived;
      case 'trade_executed':
        return prefs.notifyOnTradeExecuted;
      case 'trade_closed':
        return prefs.notifyOnTradeClosed;
      case 'risk_alert':
        // Check risk alert level filters
        const level = data.riskAlertLevel?.toLowerCase();
        if (level === 'low') return prefs.notifyRiskLevelLow;
        if (level === 'medium') return prefs.notifyRiskLevelMedium;
        if (level === 'high') return prefs.notifyRiskLevelHigh;
        if (level === 'critical') return prefs.notifyRiskLevelCritical;
        if (level?.includes('emergency')) return prefs.notifyRiskLevelEmergency;
        return prefs.notifyOnRiskAlert;
      case 'position_update':
        return prefs.notifyOnPositionUpdate;
      case 'daily_summary':
        return prefs.notifyOnDailySummary;
      default:
        return false;
    }
  }

  /**
   * Check if currently in quiet hours
   */
  private isQuietHours(prefs: NotificationPreferences): boolean {
    if (!prefs.quietHoursEnabled || !prefs.quietHoursStart || !prefs.quietHoursEnd) {
      return false;
    }

    const now = new Date();
    const currentTime = now.getUTCHours() * 60 + now.getUTCMinutes();

    const [startHour, startMin] = prefs.quietHoursStart.split(':').map(Number);
    const [endHour, endMin] = prefs.quietHoursEnd.split(':').map(Number);

    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    }

    return currentTime >= startTime && currentTime < endTime;
  }

  /**
   * Check rate limits
   */
  private async checkRateLimit(userId: string, prefs: NotificationPreferences): Promise<boolean> {
    const now = new Date().toISOString();

    // Check hourly limit
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const hourlyCount = await this.db.prepare(
      `SELECT COUNT(*) as count FROM notification_logs
       WHERE user_id = ? AND created_at > ? AND status = 'sent'`
    ).bind(userId, oneHourAgo).first();

    if (hourlyCount && (hourlyCount.count as number) >= prefs.maxNotificationsPerHour) {
      return false;
    }

    // Check daily limit
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const dailyCount = await this.db.prepare(
      `SELECT COUNT(*) as count FROM notification_logs
       WHERE user_id = ? AND created_at > ? AND status = 'sent'`
    ).bind(userId, oneDayAgo).first();

    if (dailyCount && (dailyCount.count as number) >= prefs.maxNotificationsPerDay) {
      return false;
    }

    return true;
  }

  /**
   * Send email notification using Resend API
   */
  private async sendEmailNotification(
    userId: string,
    type: NotificationType,
    data: NotificationData,
    emailAddress: string
  ): Promise<void> {
    const notificationId = uuidv4();
    const now = new Date().toISOString();

    // Build email content
    const { subject, html, text } = this.buildEmailContent(type, data);

    // Log notification as pending
    await this.db.prepare(
      `INSERT INTO notification_logs
       (id, user_id, notification_type, channel, email_address, subject, message, data, status, created_at)
       VALUES (?, ?, ?, 'email', ?, ?, ?, ?, 'pending', ?)`
    ).bind(
      notificationId,
      userId,
      type,
      emailAddress,
      subject,
      text,
      JSON.stringify(data),
      now
    ).run();

    try {
      // Send email via Resend API
      if (!this.env.RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY not configured');
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: this.env.EMAIL_FROM || 'Trade M8 <notifications@trade-m8.app>',
          to: [emailAddress],
          subject: subject,
          html: html,
          text: text,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Resend API error: ${response.status} ${errorData}`);
      }

      // Update log as sent
      await this.db.prepare(
        `UPDATE notification_logs SET status = 'sent', sent_at = ? WHERE id = ?`
      ).bind(now, notificationId).run();

    } catch (error: any) {
      // Update log as failed
      await this.db.prepare(
        `UPDATE notification_logs SET status = 'failed', error_message = ? WHERE id = ?`
      ).bind(error.message, notificationId).run();
      throw error;
    }
  }

  /**
   * Send webhook notifications
   */
  private async sendWebhookNotifications(
    userId: string,
    type: NotificationType,
    data: NotificationData
  ): Promise<number> {
    // Get all enabled webhooks for this user that match this event type
    const webhooks = await this.db.prepare(
      `SELECT * FROM webhook_endpoints WHERE user_id = ? AND enabled = 1`
    ).bind(userId).all();

    if (!webhooks.results || webhooks.results.length === 0) {
      return 0;
    }

    let sentCount = 0;

    for (const webhook of webhooks.results) {
      // Check if this webhook is subscribed to this event
      const events = JSON.parse(webhook.events as string);
      if (!events.includes(type)) {
        continue;
      }

      try {
        await this.sendWebhook(webhook as any, type, data);
        sentCount++;
      } catch (error) {
        console.error(`Webhook ${webhook.id} failed:`, error);
      }
    }

    return sentCount;
  }

  /**
   * Send individual webhook
   */
  private async sendWebhook(
    webhook: WebhookEndpoint,
    type: NotificationType,
    data: NotificationData
  ): Promise<void> {
    const notificationId = uuidv4();
    const now = new Date().toISOString();

    const payload = {
      event: type,
      timestamp: data.timestamp || now,
      data: data,
    };

    // Log notification as pending
    await this.db.prepare(
      `INSERT INTO notification_logs
       (id, user_id, notification_type, channel, webhook_endpoint_id, webhook_url, message, data, status, created_at)
       VALUES (?, ?, ?, 'webhook', ?, ?, ?, ?, 'pending', ?)`
    ).bind(
      notificationId,
      webhook.userId,
      type,
      webhook.id,
      webhook.url,
      JSON.stringify(payload),
      JSON.stringify(data),
      now
    ).run();

    try {
      // Build request headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Trade-M8-Webhook/1.0',
      };

      // Add authentication
      if (webhook.authType === 'bearer' && webhook.authToken) {
        headers['Authorization'] = `Bearer ${webhook.authToken}`;
      } else if (webhook.authType === 'basic' && webhook.authUsername && webhook.authPassword) {
        const basicAuth = btoa(`${webhook.authUsername}:${webhook.authPassword}`);
        headers['Authorization'] = `Basic ${basicAuth}`;
      } else if (webhook.authType === 'custom_header' && webhook.customHeaders) {
        const customHeaders = JSON.parse(webhook.customHeaders);
        Object.assign(headers, customHeaders);
      }

      // Send webhook
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), webhook.timeoutMs);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Update webhook stats
      await this.db.prepare(
        `UPDATE webhook_endpoints
         SET last_triggered_at = ?, last_success_at = ?, total_calls = total_calls + 1,
             success_rate = (total_calls * success_rate + 1.0) / (total_calls + 1),
             failure_count = 0
         WHERE id = ?`
      ).bind(now, now, webhook.id).run();

      // Update log as sent
      await this.db.prepare(
        `UPDATE notification_logs SET status = 'sent', sent_at = ? WHERE id = ?`
      ).bind(now, notificationId).run();

    } catch (error: any) {
      // Update webhook stats
      await this.db.prepare(
        `UPDATE webhook_endpoints
         SET last_triggered_at = ?, last_failure_at = ?, total_calls = total_calls + 1,
             success_rate = (total_calls * success_rate) / (total_calls + 1),
             failure_count = failure_count + 1
         WHERE id = ?`
      ).bind(now, now, webhook.id).run();

      // Update log as failed
      await this.db.prepare(
        `UPDATE notification_logs SET status = 'failed', error_message = ? WHERE id = ?`
      ).bind(error.message, notificationId).run();

      throw error;
    }
  }

  /**
   * Build email content based on notification type
   */
  private buildEmailContent(type: NotificationType, data: NotificationData): {
    subject: string;
    html: string;
    text: string;
  } {
    switch (type) {
      case 'signal_received':
        return this.buildSignalEmail(data);
      case 'trade_executed':
        return this.buildTradeExecutedEmail(data);
      case 'trade_closed':
        return this.buildTradeClosedEmail(data);
      case 'risk_alert':
        return this.buildRiskAlertEmail(data);
      case 'position_update':
        return this.buildPositionUpdateEmail(data);
      default:
        return {
          subject: `Trade M8 Notification: ${type}`,
          html: `<p>${JSON.stringify(data)}</p>`,
          text: JSON.stringify(data),
        };
    }
  }

  private buildSignalEmail(data: NotificationData) {
    const subject = `🎯 TradingView Signal: ${data.signalAction?.toUpperCase()} ${data.signalSymbol}`;

    const text = `
TradingView Signal Received

Action: ${data.signalAction?.toUpperCase()}
Symbol: ${data.signalSymbol}
Exchange: ${data.signalExchange}
${data.signalStrategy ? `Strategy: ${data.signalStrategy}` : ''}
${data.signalPrice ? `Price: $${data.signalPrice}` : ''}

Received at: ${data.timestamp || new Date().toISOString()}

---
Trade M8 | Your AI Trading Assistant
`.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
    .content { background: #f7f7f7; padding: 30px; }
    .signal-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
    .action { font-size: 24px; font-weight: bold; color: ${data.signalAction === 'buy' ? '#10b981' : '#ef4444'}; }
    .footer { background: #333; color: #999; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">🎯 TradingView Signal Received</h1>
    </div>
    <div class="content">
      <div class="signal-box">
        <p class="action">${data.signalAction?.toUpperCase()}</p>
        <p><strong>Symbol:</strong> ${data.signalSymbol}</p>
        <p><strong>Exchange:</strong> ${data.signalExchange}</p>
        ${data.signalStrategy ? `<p><strong>Strategy:</strong> ${data.signalStrategy}</p>` : ''}
        ${data.signalPrice ? `<p><strong>Price:</strong> $${data.signalPrice}</p>` : ''}
        <p style="color: #666; font-size: 14px; margin-top: 20px;">
          <strong>Received:</strong> ${data.timestamp || new Date().toISOString()}
        </p>
      </div>
    </div>
    <div class="footer">
      <p>Trade M8 | Your AI Trading Assistant</p>
      <p><a href="https://trade-m8.app" style="color: #667eea;">Visit Dashboard</a></p>
    </div>
  </div>
</body>
</html>
`.trim();

    return { subject, text, html };
  }

  private buildTradeExecutedEmail(data: NotificationData) {
    const subject = `📈 Trade Executed: ${data.tradeSide?.toUpperCase()} ${data.tradeSymbol}`;

    const text = `
Trade Executed

Side: ${data.tradeSide?.toUpperCase()}
Symbol: ${data.tradeSymbol}
Quantity: ${data.tradeQuantity}
Entry Price: $${data.tradeEntryPrice}
Exchange: ${data.tradeExchange}
Total Value: $${(data.tradeQuantity || 0) * (data.tradeEntryPrice || 0)}

Executed at: ${data.timestamp || new Date().toISOString()}

---
Trade M8 | Your AI Trading Assistant
`.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
    .content { background: #f7f7f7; padding: 30px; }
    .trade-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981; }
    .footer { background: #333; color: #999; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">📈 Trade Executed</h1>
    </div>
    <div class="content">
      <div class="trade-box">
        <p><strong>Side:</strong> <span style="color: ${data.tradeSide === 'buy' ? '#10b981' : '#ef4444'}; font-weight: bold;">${data.tradeSide?.toUpperCase()}</span></p>
        <p><strong>Symbol:</strong> ${data.tradeSymbol}</p>
        <p><strong>Quantity:</strong> ${data.tradeQuantity}</p>
        <p><strong>Entry Price:</strong> $${data.tradeEntryPrice}</p>
        <p><strong>Exchange:</strong> ${data.tradeExchange}</p>
        <p><strong>Total Value:</strong> $${((data.tradeQuantity || 0) * (data.tradeEntryPrice || 0)).toFixed(2)}</p>
        <p style="color: #666; font-size: 14px; margin-top: 20px;">
          <strong>Executed:</strong> ${data.timestamp || new Date().toISOString()}
        </p>
      </div>
    </div>
    <div class="footer">
      <p>Trade M8 | Your AI Trading Assistant</p>
      <p><a href="https://trade-m8.app" style="color: #10b981;">View Trade Details</a></p>
    </div>
  </div>
</body>
</html>
`.trim();

    return { subject, text, html };
  }

  private buildTradeClosedEmail(data: NotificationData) {
    const pnlPositive = (data.tradePnl || 0) > 0;
    const emoji = pnlPositive ? '🎉' : '📊';
    const subject = `${emoji} Trade Closed: ${pnlPositive ? '+' : ''}$${data.tradePnl?.toFixed(2)} (${pnlPositive ? '+' : ''}${data.tradePnlPercent?.toFixed(2)}%)`;

    const text = `
Trade Closed

Symbol: ${data.tradeSymbol}
Side: ${data.tradeSide?.toUpperCase()}
Entry Price: $${data.tradeEntryPrice}
Exit Price: $${data.tradeExitPrice}
P&L: ${pnlPositive ? '+' : ''}$${data.tradePnl?.toFixed(2)} (${pnlPositive ? '+' : ''}${data.tradePnlPercent?.toFixed(2)}%)

Closed at: ${data.timestamp || new Date().toISOString()}

---
Trade M8 | Your AI Trading Assistant
`.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, ${pnlPositive ? '#10b981 0%, #059669' : '#f59e0b 0%, #d97706'} 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
    .content { background: #f7f7f7; padding: 30px; }
    .trade-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${pnlPositive ? '#10b981' : '#f59e0b'}; }
    .pnl { font-size: 28px; font-weight: bold; color: ${pnlPositive ? '#10b981' : '#ef4444'}; }
    .footer { background: #333; color: #999; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">${emoji} Trade Closed</h1>
    </div>
    <div class="content">
      <div class="trade-box">
        <p class="pnl">${pnlPositive ? '+' : ''}$${data.tradePnl?.toFixed(2)} (${pnlPositive ? '+' : ''}${data.tradePnlPercent?.toFixed(2)}%)</p>
        <p><strong>Symbol:</strong> ${data.tradeSymbol}</p>
        <p><strong>Side:</strong> ${data.tradeSide?.toUpperCase()}</p>
        <p><strong>Entry Price:</strong> $${data.tradeEntryPrice}</p>
        <p><strong>Exit Price:</strong> $${data.tradeExitPrice}</p>
        <p style="color: #666; font-size: 14px; margin-top: 20px;">
          <strong>Closed:</strong> ${data.timestamp || new Date().toISOString()}
        </p>
      </div>
    </div>
    <div class="footer">
      <p>Trade M8 | Your AI Trading Assistant</p>
      <p><a href="https://trade-m8.app" style="color: ${pnlPositive ? '#10b981' : '#f59e0b'};">View Trade History</a></p>
    </div>
  </div>
</body>
</html>
`.trim();

    return { subject, text, html };
  }

  private buildRiskAlertEmail(data: NotificationData) {
    const subject = `⚠️ Risk Alert: ${data.riskAlertLevel?.toUpperCase()} - ${data.riskAlertMessage}`;

    const text = `
RISK ALERT

Level: ${data.riskAlertLevel?.toUpperCase()}
Type: ${data.riskAlertType}

${data.riskAlertMessage}

Please review your positions and risk exposure immediately.

Triggered at: ${data.timestamp || new Date().toISOString()}

---
Trade M8 | Your AI Trading Assistant
`.trim();

    const levelColor = {
      low: '#3b82f6',
      medium: '#f59e0b',
      high: '#ef4444',
      critical: '#dc2626',
      emergency_stop: '#991b1b',
    }[data.riskAlertLevel?.toLowerCase() || 'medium'] || '#f59e0b';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${levelColor}; color: white; padding: 30px; border-radius: 10px 10px 0 0; }
    .content { background: #f7f7f7; padding: 30px; }
    .alert-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${levelColor}; }
    .level { font-size: 24px; font-weight: bold; color: ${levelColor}; }
    .footer { background: #333; color: #999; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">⚠️ Risk Alert</h1>
    </div>
    <div class="content">
      <div class="alert-box">
        <p class="level">${data.riskAlertLevel?.toUpperCase()}</p>
        <p><strong>Type:</strong> ${data.riskAlertType}</p>
        <p style="margin: 20px 0; padding: 15px; background: #fef2f2; border-left: 3px solid ${levelColor};">
          ${data.riskAlertMessage}
        </p>
        <p style="color: #666;">Please review your positions and risk exposure immediately.</p>
        <p style="color: #666; font-size: 14px; margin-top: 20px;">
          <strong>Triggered:</strong> ${data.timestamp || new Date().toISOString()}
        </p>
      </div>
    </div>
    <div class="footer">
      <p>Trade M8 | Your AI Trading Assistant</p>
      <p><a href="https://trade-m8.app" style="color: ${levelColor};">Review Risk Dashboard</a></p>
    </div>
  </div>
</body>
</html>
`.trim();

    return { subject, text, html };
  }

  private buildPositionUpdateEmail(data: NotificationData) {
    const subject = `📊 Position Update: ${data.positionSymbol}`;

    const text = `
Position Update

Symbol: ${data.positionSymbol}
Side: ${data.positionSide?.toUpperCase()}
P&L: ${(data.positionPnl || 0) > 0 ? '+' : ''}$${data.positionPnl?.toFixed(2)} (${(data.positionPnlPercent || 0) > 0 ? '+' : ''}${data.positionPnlPercent?.toFixed(2)}%)

Updated at: ${data.timestamp || new Date().toISOString()}

---
Trade M8 | Your AI Trading Assistant
`.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
    .content { background: #f7f7f7; padding: 30px; }
    .position-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6; }
    .footer { background: #333; color: #999; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">📊 Position Update</h1>
    </div>
    <div class="content">
      <div class="position-box">
        <p><strong>Symbol:</strong> ${data.positionSymbol}</p>
        <p><strong>Side:</strong> ${data.positionSide?.toUpperCase()}</p>
        <p><strong>P&L:</strong> <span style="color: ${(data.positionPnl || 0) > 0 ? '#10b981' : '#ef4444'}; font-weight: bold;">${(data.positionPnl || 0) > 0 ? '+' : ''}$${data.positionPnl?.toFixed(2)} (${(data.positionPnlPercent || 0) > 0 ? '+' : ''}${data.positionPnlPercent?.toFixed(2)}%)</span></p>
        <p style="color: #666; font-size: 14px; margin-top: 20px;">
          <strong>Updated:</strong> ${data.timestamp || new Date().toISOString()}
        </p>
      </div>
    </div>
    <div class="footer">
      <p>Trade M8 | Your AI Trading Assistant</p>
      <p><a href="https://trade-m8.app" style="color: #3b82f6;">View Position Details</a></p>
    </div>
  </div>
</body>
</html>
`.trim();

    return { subject, text, html };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Quick helper to send a notification (creates service instance internally)
 */
export async function sendNotification(params: SendNotificationParams) {
  const service = new NotificationService(params.db, params.env);
  return service.sendNotification(params);
}
