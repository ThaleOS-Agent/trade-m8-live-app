/**
 * Live Trades API — Cloudflare Pages Function
 *
 * Provides real-time awareness of live trades, positions, and trading activity
 *
 * Routes:
 *   GET /api/live-trades/positions        — Get active positions
 *   GET /api/live-trades/recent           — Get recent trades (last 24h)
 *   GET /api/live-trades/activity         — Get live trading activity feed
 *   GET /api/live-trades/summary          — Get trading summary/dashboard data
 *   GET /api/live-trades/signals          — Get recent TradingView signals
 */

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  const path = url.pathname.replace('/api/live-trades', '');

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  // Authenticate user (optional for some endpoints)
  let userId = await authenticateUser(request, env);

  // Allow TradingView signals without auth for the /signals endpoint
  if (!userId && path !== '/signals') {
    return err('Unauthorized', 401);
  }

  try {
    // ========================================================================
    // GET /api/live-trades/positions
    // ========================================================================
    if (method === 'GET' && path === '/positions') {
      const positions = await env.DB.prepare(
        `SELECT
          p.*,
          t.strategy,
          t.enhanced_by_ai,
          t.ai_confidence,
          ROUND((JULIANDAY('now') - JULIANDAY(p.entry_time)) * 24 * 60, 2) as holding_minutes
         FROM positions p
         LEFT JOIN trades t ON p.symbol = t.symbol AND t.status = 'open' AND t.user_id = p.user_id
         WHERE p.user_id = ?
         ORDER BY p.opened_at DESC`
      ).bind(userId).all();

      return json({
        positions: positions.results || [],
        count: positions.results?.length || 0,
      });
    }

    // ========================================================================
    // GET /api/live-trades/recent
    // ========================================================================
    if (method === 'GET' && path === '/recent') {
      const hours = parseInt(url.searchParams.get('hours') || '24');
      const limit = parseInt(url.searchParams.get('limit') || '50');

      const trades = await env.DB.prepare(
        `SELECT
          t.*,
          ROUND((JULIANDAY(COALESCE(t.closed_at, 'now')) - JULIANDAY(t.opened_at)) * 24 * 60, 2) as holding_minutes,
          CASE WHEN t.pnl > 0 THEN 'WIN' WHEN t.pnl < 0 THEN 'LOSS' ELSE 'PENDING' END as outcome
         FROM trades t
         WHERE t.user_id = ?
         AND t.opened_at > datetime('now', '-${hours} hours')
         ORDER BY t.opened_at DESC
         LIMIT ?`
      ).bind(userId, limit).all();

      return json({
        trades: trades.results || [],
        count: trades.results?.length || 0,
        hours,
      });
    }

    // ========================================================================
    // GET /api/live-trades/activity
    // ========================================================================
    if (method === 'GET' && path === '/activity') {
      const limit = parseInt(url.searchParams.get('limit') || '20');

      // Get recent trades
      const trades = await env.DB.prepare(
        `SELECT
          'trade' as type,
          id,
          symbol,
          side,
          quantity,
          entry_price as price,
          exchange,
          status,
          opened_at as timestamp,
          pnl,
          pnl_percent
         FROM trades
         WHERE user_id = ?
         ORDER BY opened_at DESC
         LIMIT ?`
      ).bind(userId, Math.floor(limit / 2)).all();

      // Get recent signals
      const signals = await env.DB.prepare(
        `SELECT
          'signal' as type,
          id,
          action as side,
          symbol,
          exchange,
          strategy,
          alert_price as price,
          status,
          received_at as timestamp
         FROM tradingview_signals
         ORDER BY received_at DESC
         LIMIT ?`
      ).bind(Math.floor(limit / 2)).all();

      // Get risk alerts
      const alerts = await env.DB.prepare(
        `SELECT
          'risk_alert' as type,
          id,
          alert_type,
          level,
          message,
          acknowledged,
          created_at as timestamp
         FROM risk_alerts
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      ).bind(userId, Math.floor(limit / 4)).all();

      // Merge and sort by timestamp
      const activity = [
        ...(trades.results || []),
        ...(signals.results || []),
        ...(alerts.results || []),
      ].sort((a: any, b: any) => {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        return bTime - aTime;
      }).slice(0, limit);

      return json({
        activity,
        count: activity.length,
      });
    }

    // ========================================================================
    // GET /api/live-trades/summary
    // ========================================================================
    if (method === 'GET' && path === '/summary') {
      // Get active positions count and value
      const positionsData = await env.DB.prepare(
        `SELECT
          COUNT(*) as count,
          SUM(value) as total_value,
          SUM(pnl) as total_pnl
         FROM positions
         WHERE user_id = ?`
      ).bind(userId).first();

      // Get today's trades
      const todayTrades = await env.DB.prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
          SUM(pnl) as total_pnl
         FROM trades
         WHERE user_id = ?
         AND status = 'closed'
         AND opened_at > datetime('now', 'start of day')`
      ).bind(userId).first();

      // Get pending signals
      const pendingSignals = await env.DB.prepare(
        `SELECT COUNT(*) as count
         FROM tradingview_signals
         WHERE status = 'received'
         AND received_at > datetime('now', '-1 hour')`
      ).all();

      // Get unacknowledged risk alerts
      const riskAlerts = await env.DB.prepare(
        `SELECT COUNT(*) as count, level
         FROM risk_alerts
         WHERE user_id = ?
         AND acknowledged = 0
         GROUP BY level`
      ).bind(userId).all();

      // Get recent performance (last 7 days)
      const weekPerformance = await env.DB.prepare(
        `SELECT
          COUNT(*) as total_trades,
          SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
          SUM(pnl) as total_pnl,
          AVG(CASE WHEN pnl > 0 THEN pnl END) as avg_win,
          AVG(CASE WHEN pnl < 0 THEN pnl END) as avg_loss
         FROM trades
         WHERE user_id = ?
         AND status = 'closed'
         AND opened_at > datetime('now', '-7 days')`
      ).bind(userId).first();

      return json({
        positions: {
          count: positionsData?.count || 0,
          totalValue: positionsData?.total_value || 0,
          totalPnl: positionsData?.total_pnl || 0,
        },
        today: {
          trades: todayTrades?.total || 0,
          wins: todayTrades?.wins || 0,
          losses: todayTrades?.losses || 0,
          pnl: todayTrades?.total_pnl || 0,
          winRate: todayTrades?.total
            ? ((todayTrades.wins / todayTrades.total) * 100).toFixed(1)
            : '0.0',
        },
        signals: {
          pending: pendingSignals.results?.[0]?.count || 0,
        },
        riskAlerts: {
          unacknowledged: riskAlerts.results?.reduce((sum: number, r: any) => sum + r.count, 0) || 0,
          byLevel: riskAlerts.results || [],
        },
        weekPerformance: {
          trades: weekPerformance?.total_trades || 0,
          wins: weekPerformance?.wins || 0,
          losses: weekPerformance?.losses || 0,
          pnl: weekPerformance?.total_pnl || 0,
          winRate: weekPerformance?.total_trades
            ? ((weekPerformance.wins / weekPerformance.total_trades) * 100).toFixed(1)
            : '0.0',
          avgWin: weekPerformance?.avg_win || 0,
          avgLoss: weekPerformance?.avg_loss || 0,
          profitFactor: weekPerformance?.avg_loss
            ? Math.abs((weekPerformance.avg_win || 0) / weekPerformance.avg_loss)
            : 0,
        },
      });
    }

    // ========================================================================
    // GET /api/live-trades/signals
    // ========================================================================
    if (method === 'GET' && path === '/signals') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const status = url.searchParams.get('status');

      let query = 'SELECT * FROM tradingview_signals WHERE 1=1';
      const params: any[] = [];

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      query += ' ORDER BY received_at DESC LIMIT ?';
      params.push(limit);

      const signals = await env.DB.prepare(query).bind(...params).all();

      return json({
        signals: signals.results || [],
        count: signals.results?.length || 0,
      });
    }

    return err('Endpoint not found', 404);

  } catch (e: any) {
    console.error('Live Trades API error:', e);
    return err(e.message ?? 'Internal server error', 500);
  }
};
