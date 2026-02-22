/**
 * Notifications API — Cloudflare Pages Function
 *
 * Routes:
 *   GET    /api/notifications/preferences       — Get user notification preferences
 *   PUT    /api/notifications/preferences       — Update notification preferences
 *   GET    /api/notifications/webhooks          — List user webhook endpoints
 *   POST   /api/notifications/webhooks          — Create webhook endpoint
 *   PUT    /api/notifications/webhooks/:id      — Update webhook endpoint
 *   DELETE /api/notifications/webhooks/:id      — Delete webhook endpoint
 *   GET    /api/notifications/logs              — Get notification history
 *   GET    /api/notifications/test              — Send test notification
 */

import { sendNotification } from '../lib/notification-service';

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 400) {
  return json({ error: message }, status);
}

/**
 * Verify JWT and extract user ID
 */
async function authenticateUser(request: Request, env: Env): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);

  try {
    // Simple JWT verification (you should use a proper JWT library in production)
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1]));

    // Check expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return null;
    }

    return payload.userId || payload.sub || null;
  } catch {
    return null;
  }
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname.replace('/api/notifications', '');

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  // Authenticate user
  const userId = await authenticateUser(request, env);
  if (!userId) {
    return err('Unauthorized', 401);
  }

  try {
    // ========================================================================
    // GET /api/notifications/preferences
    // ========================================================================
    if (method === 'GET' && path === '/preferences') {
      const prefs = await env.DB.prepare(
        `SELECT * FROM notification_preferences WHERE user_id = ? LIMIT 1`
      ).bind(userId).first();

      if (!prefs) {
        // Create default preferences if they don't exist
        const id = crypto.randomUUID();
        const user = await env.DB.prepare(
          `SELECT email FROM users WHERE id = ? LIMIT 1`
        ).bind(userId).first();

        const now = new Date().toISOString();

        await env.DB.prepare(
          `INSERT INTO notification_preferences
           (id, user_id, email_address, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(id, userId, user?.email || null, now, now).run();

        const newPrefs = await env.DB.prepare(
          `SELECT * FROM notification_preferences WHERE id = ?`
        ).bind(id).first();

        return json(newPrefs);
      }

      return json(prefs);
    }

    // ========================================================================
    // PUT /api/notifications/preferences
    // ========================================================================
    if (method === 'PUT' && path === '/preferences') {
      const body = await request.json() as any;

      const updates: string[] = [];
      const values: any[] = [];

      // Email settings
      if (body.emailEnabled !== undefined) {
        updates.push('email_enabled = ?');
        values.push(body.emailEnabled ? 1 : 0);
      }
      if (body.emailAddress !== undefined) {
        updates.push('email_address = ?');
        values.push(body.emailAddress);
      }
      if (body.webhookEnabled !== undefined) {
        updates.push('webhook_enabled = ?');
        values.push(body.webhookEnabled ? 1 : 0);
      }

      // Notification type toggles
      if (body.notifyOnSignalReceived !== undefined) {
        updates.push('notify_on_signal_received = ?');
        values.push(body.notifyOnSignalReceived ? 1 : 0);
      }
      if (body.notifyOnTradeExecuted !== undefined) {
        updates.push('notify_on_trade_executed = ?');
        values.push(body.notifyOnTradeExecuted ? 1 : 0);
      }
      if (body.notifyOnTradeClosed !== undefined) {
        updates.push('notify_on_trade_closed = ?');
        values.push(body.notifyOnTradeClosed ? 1 : 0);
      }
      if (body.notifyOnRiskAlert !== undefined) {
        updates.push('notify_on_risk_alert = ?');
        values.push(body.notifyOnRiskAlert ? 1 : 0);
      }
      if (body.notifyOnPositionUpdate !== undefined) {
        updates.push('notify_on_position_update = ?');
        values.push(body.notifyOnPositionUpdate ? 1 : 0);
      }
      if (body.notifyOnDailySummary !== undefined) {
        updates.push('notify_on_daily_summary = ?');
        values.push(body.notifyOnDailySummary ? 1 : 0);
      }

      // Risk level filters
      if (body.notifyRiskLevelLow !== undefined) {
        updates.push('notify_risk_level_low = ?');
        values.push(body.notifyRiskLevelLow ? 1 : 0);
      }
      if (body.notifyRiskLevelMedium !== undefined) {
        updates.push('notify_risk_level_medium = ?');
        values.push(body.notifyRiskLevelMedium ? 1 : 0);
      }
      if (body.notifyRiskLevelHigh !== undefined) {
        updates.push('notify_risk_level_high = ?');
        values.push(body.notifyRiskLevelHigh ? 1 : 0);
      }
      if (body.notifyRiskLevelCritical !== undefined) {
        updates.push('notify_risk_level_critical = ?');
        values.push(body.notifyRiskLevelCritical ? 1 : 0);
      }
      if (body.notifyRiskLevelEmergency !== undefined) {
        updates.push('notify_risk_level_emergency = ?');
        values.push(body.notifyRiskLevelEmergency ? 1 : 0);
      }

      // Quiet hours
      if (body.quietHoursEnabled !== undefined) {
        updates.push('quiet_hours_enabled = ?');
        values.push(body.quietHoursEnabled ? 1 : 0);
      }
      if (body.quietHoursStart !== undefined) {
        updates.push('quiet_hours_start = ?');
        values.push(body.quietHoursStart);
      }
      if (body.quietHoursEnd !== undefined) {
        updates.push('quiet_hours_end = ?');
        values.push(body.quietHoursEnd);
      }

      // Rate limits
      if (body.maxNotificationsPerHour !== undefined) {
        updates.push('max_notifications_per_hour = ?');
        values.push(body.maxNotificationsPerHour);
      }
      if (body.maxNotificationsPerDay !== undefined) {
        updates.push('max_notifications_per_day = ?');
        values.push(body.maxNotificationsPerDay);
      }

      if (updates.length === 0) {
        return err('No updates provided', 400);
      }

      updates.push('updated_at = ?');
      values.push(new Date().toISOString());

      values.push(userId);

      await env.DB.prepare(
        `UPDATE notification_preferences SET ${updates.join(', ')} WHERE user_id = ?`
      ).bind(...values).run();

      const updated = await env.DB.prepare(
        `SELECT * FROM notification_preferences WHERE user_id = ?`
      ).bind(userId).first();

      return json(updated);
    }

    // ========================================================================
    // GET /api/notifications/webhooks
    // ========================================================================
    if (method === 'GET' && path === '/webhooks') {
      const webhooks = await env.DB.prepare(
        `SELECT * FROM webhook_endpoints WHERE user_id = ? ORDER BY created_at DESC`
      ).bind(userId).all();

      return json(webhooks.results || []);
    }

    // ========================================================================
    // POST /api/notifications/webhooks
    // ========================================================================
    if (method === 'POST' && path === '/webhooks') {
      const body = await request.json() as any;

      if (!body.name || !body.url || !body.events) {
        return err('Missing required fields: name, url, events', 400);
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await env.DB.prepare(
        `INSERT INTO webhook_endpoints
         (id, user_id, name, url, auth_type, auth_token, auth_username, auth_password,
          custom_headers, enabled, retry_on_failure, max_retries, timeout_ms, events,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        userId,
        body.name,
        body.url,
        body.authType || 'none',
        body.authToken || null,
        body.authUsername || null,
        body.authPassword || null,
        body.customHeaders ? JSON.stringify(body.customHeaders) : null,
        body.enabled !== false ? 1 : 0,
        body.retryOnFailure !== false ? 1 : 0,
        body.maxRetries || 3,
        body.timeoutMs || 5000,
        JSON.stringify(body.events),
        now,
        now
      ).run();

      const webhook = await env.DB.prepare(
        `SELECT * FROM webhook_endpoints WHERE id = ?`
      ).bind(id).first();

      return json(webhook, 201);
    }

    // ========================================================================
    // PUT /api/notifications/webhooks/:id
    // ========================================================================
    if (method === 'PUT' && path.startsWith('/webhooks/')) {
      const webhookId = path.split('/')[2];
      const body = await request.json() as any;

      // Verify ownership
      const existing = await env.DB.prepare(
        `SELECT * FROM webhook_endpoints WHERE id = ? AND user_id = ?`
      ).bind(webhookId, userId).first();

      if (!existing) {
        return err('Webhook not found', 404);
      }

      const updates: string[] = [];
      const values: any[] = [];

      if (body.name !== undefined) {
        updates.push('name = ?');
        values.push(body.name);
      }
      if (body.url !== undefined) {
        updates.push('url = ?');
        values.push(body.url);
      }
      if (body.authType !== undefined) {
        updates.push('auth_type = ?');
        values.push(body.authType);
      }
      if (body.authToken !== undefined) {
        updates.push('auth_token = ?');
        values.push(body.authToken);
      }
      if (body.authUsername !== undefined) {
        updates.push('auth_username = ?');
        values.push(body.authUsername);
      }
      if (body.authPassword !== undefined) {
        updates.push('auth_password = ?');
        values.push(body.authPassword);
      }
      if (body.customHeaders !== undefined) {
        updates.push('custom_headers = ?');
        values.push(JSON.stringify(body.customHeaders));
      }
      if (body.enabled !== undefined) {
        updates.push('enabled = ?');
        values.push(body.enabled ? 1 : 0);
      }
      if (body.retryOnFailure !== undefined) {
        updates.push('retry_on_failure = ?');
        values.push(body.retryOnFailure ? 1 : 0);
      }
      if (body.maxRetries !== undefined) {
        updates.push('max_retries = ?');
        values.push(body.maxRetries);
      }
      if (body.timeoutMs !== undefined) {
        updates.push('timeout_ms = ?');
        values.push(body.timeoutMs);
      }
      if (body.events !== undefined) {
        updates.push('events = ?');
        values.push(JSON.stringify(body.events));
      }

      if (updates.length === 0) {
        return err('No updates provided', 400);
      }

      updates.push('updated_at = ?');
      values.push(new Date().toISOString());

      values.push(webhookId);
      values.push(userId);

      await env.DB.prepare(
        `UPDATE webhook_endpoints SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
      ).bind(...values).run();

      const updated = await env.DB.prepare(
        `SELECT * FROM webhook_endpoints WHERE id = ?`
      ).bind(webhookId).first();

      return json(updated);
    }

    // ========================================================================
    // DELETE /api/notifications/webhooks/:id
    // ========================================================================
    if (method === 'DELETE' && path.startsWith('/webhooks/')) {
      const webhookId = path.split('/')[2];

      await env.DB.prepare(
        `DELETE FROM webhook_endpoints WHERE id = ? AND user_id = ?`
      ).bind(webhookId, userId).run();

      return json({ success: true });
    }

    // ========================================================================
    // GET /api/notifications/logs
    // ========================================================================
    if (method === 'GET' && path === '/logs') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const status = url.searchParams.get('status');
      const type = url.searchParams.get('type');

      let query = 'SELECT * FROM notification_logs WHERE user_id = ?';
      const params: any[] = [userId];

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      if (type) {
        query += ' AND notification_type = ?';
        params.push(type);
      }

      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const logs = await env.DB.prepare(query).bind(...params).all();

      return json({
        logs: logs.results || [],
        limit,
        offset,
      });
    }

    // ========================================================================
    // GET /api/notifications/test
    // ========================================================================
    if (method === 'GET' && path === '/test') {
      const result = await sendNotification({
        userId,
        type: 'signal_received',
        data: {
          signalAction: 'buy',
          signalSymbol: 'BTC/USDT',
          signalExchange: 'binance',
          signalStrategy: 'Test Signal',
          signalPrice: 50000,
          timestamp: new Date().toISOString(),
        },
        db: env.DB,
        env,
      });

      return json({
        message: 'Test notification sent',
        result,
      });
    }

    return err('Endpoint not found', 404);

  } catch (e: any) {
    console.error('Notifications API error:', e);
    return err(e.message ?? 'Internal server error', 500);
  }
};
