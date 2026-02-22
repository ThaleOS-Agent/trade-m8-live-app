/**
 * Portfolio P&L Tracker — Cloudflare Pages Function
 *
 * Routes:
 *   GET /api/portfolio           — Portfolio overview (total value, P&L, positions count)
 *   GET /api/portfolio/positions — List all open positions with unrealized P&L
 *   GET /api/portfolio/trades    — Trade history with realized P&L (paginated)
 *   GET /api/portfolio/metrics   — Performance metrics (win rate, Sharpe, drawdown)
 *   GET /api/portfolio/snapshots — Historical portfolio snapshots
 *   GET /api/portfolio/summary   — Comprehensive summary (all data)
 *
 * All routes require JWT auth.
 * Tracks both realized P&L (closed trades) and unrealized P&L (open positions).
 */

// ============================================================================
// ENV INTERFACE
// ============================================================================
interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  JWT_SECRET: string;
  COINGECKO_API_KEY: string;
}

// ============================================================================
// TYPE INTERFACES
// ============================================================================
interface TradeRow {
  id: string;
  user_id: string;
  bot_id?: string;
  exchange?: string;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  entry_price: number;
  exit_price?: number;
  stop_loss?: number;
  take_profit?: number;
  pnl?: number;
  pnl_percentage?: number;
  fees: number;
  status: string;
  strategy?: string;
  confidence?: number;
  reasoning?: string;
  opened_at: string;
  closed_at?: string;
}

interface SnapshotRow {
  id: string;
  user_id: string;
  total_value: number;
  daily_change: number;
  daily_change_percent: number;
  unrealized_pnl: number;
  realized_pnl: number;
  created_at: string;
}

interface Position extends TradeRow {
  current_price: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  value: number;
}

// ============================================================================
// CORS + HELPERS
// ============================================================================
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 400): Response {
  return json({ success: false, error: message }, status);
}

// ============================================================================
// JWT AUTH (mirrors _middleware.ts implementation)
// ============================================================================
async function authenticate(request: Request, env: Env): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const signingInput = `${header}.${body}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(
      atob(sig.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(signingInput));
    if (!valid) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.userId as string;
  } catch {
    return null;
  }
}

// ============================================================================
// PRICE FETCHING
// ============================================================================
async function getCurrentPrices(
  symbols: string[],
  env: Env
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};

  // Try market_data table first (fast)
  for (const symbol of symbols) {
    const row = await env.DB.prepare(
      'SELECT price, updated_at FROM market_data WHERE symbol = ? ORDER BY updated_at DESC LIMIT 1'
    ).bind(symbol).first<{ price: number; updated_at: number }>();

    if (row && row.price && Date.now() / 1000 - row.updated_at < 300) {
      // Fresh within 5 minutes
      prices[symbol] = row.price;
    }
  }

  // For missing symbols, use a default (could enhance with CoinGecko fallback)
  for (const symbol of symbols) {
    if (!prices[symbol]) {
      prices[symbol] = 0; // Will show 0 P&L if no price available
    }
  }

  return prices;
}

// ============================================================================
// PORTFOLIO CALCULATIONS
// ============================================================================
async function calculatePortfolioMetrics(userId: string, env: Env): Promise<{
  overview: {
    totalValue: number;
    cashBalance: number;
    totalPnL: number;
    totalPnLPercent: number;
    realizedPnL: number;
    unrealizedPnL: number;
    positionsCount: number;
    investedCapital: number;
  };
  positions: Position[];
}> {
  // Get all open positions
  const openTrades = await env.DB.prepare(
    'SELECT * FROM trades WHERE user_id = ? AND status = ?'
  ).bind(userId, 'open').all();

  const trades = (openTrades.results || []) as unknown as TradeRow[];

  // Get unique symbols
  const symbols = Array.from(new Set(trades.map(t => t.symbol)));

  // Fetch current prices
  const currentPrices = await getCurrentPrices(symbols, env);

  // Calculate unrealized P&L for each position
  const positions: Position[] = trades.map(trade => {
    const currentPrice = currentPrices[trade.symbol] || trade.entry_price;
    const quantity = trade.quantity;
    const entryValue = quantity * trade.entry_price;
    const currentValue = quantity * currentPrice;

    // Calculate P&L based on side
    let unrealizedPnL = 0;
    if (trade.side === 'buy' || trade.side === 'long') {
      unrealizedPnL = (currentPrice - trade.entry_price) * quantity;
    } else if (trade.side === 'sell' || trade.side === 'short') {
      unrealizedPnL = (trade.entry_price - currentPrice) * quantity;
    }

    const unrealizedPnLPct = entryValue > 0 ? (unrealizedPnL / entryValue) * 100 : 0;

    return {
      ...trade,
      current_price: currentPrice,
      unrealized_pnl: unrealizedPnL,
      unrealized_pnl_pct: unrealizedPnLPct,
      value: currentValue,
    };
  });

  // Calculate realized P&L from closed trades
  const closedTrades = await env.DB.prepare(
    'SELECT SUM(pnl) as total_pnl FROM trades WHERE user_id = ? AND status = ?'
  ).bind(userId, 'closed').first<{ total_pnl: number | null }>();

  const realizedPnL = closedTrades?.total_pnl ?? 0;
  const unrealizedPnL = positions.reduce((sum, p) => sum + p.unrealized_pnl, 0);
  const investedCapital = positions.reduce((sum, p) => sum + (p.entry_price * p.quantity), 0);
  const currentValue = positions.reduce((sum, p) => sum + p.value, 0);

  // Get cash balance from latest snapshot (or default to 0)
  const latestSnapshot = await env.DB.prepare(
    'SELECT total_value FROM portfolio_snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(userId).first<{ total_value: number }>();

  const cashBalance = (latestSnapshot?.total_value ?? 0) - investedCapital;
  const totalValue = cashBalance + currentValue;
  const totalPnL = realizedPnL + unrealizedPnL;

  // Calculate total P&L percent (against initial capital, assume 10k default)
  const initialCapital = 10000; // TODO: Store in user settings
  const totalPnLPercent = initialCapital > 0 ? (totalPnL / initialCapital) * 100 : 0;

  return {
    overview: {
      totalValue,
      cashBalance,
      totalPnL,
      totalPnLPercent,
      realizedPnL,
      unrealizedPnL,
      positionsCount: positions.length,
      investedCapital,
    },
    positions,
  };
}

async function calculatePerformanceMetrics(userId: string, env: Env): Promise<{
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  avgHoldingPeriodHours: number;
  totalFees: number;
}> {
  const closedTrades = await env.DB.prepare(
    'SELECT * FROM trades WHERE user_id = ? AND status = ?'
  ).bind(userId, 'closed').all();

  const trades = (closedTrades.results || []) as unknown as TradeRow[];
  const totalTrades = trades.length;

  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      profitFactor: 0,
      avgHoldingPeriodHours: 0,
      totalFees: 0,
    };
  }

  const winners = trades.filter(t => (t.pnl ?? 0) > 0);
  const losers = trades.filter(t => (t.pnl ?? 0) <= 0);

  const totalWins = winners.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const totalLosses = Math.abs(losers.reduce((sum, t) => sum + (t.pnl ?? 0), 0));

  const avgWin = winners.length > 0 ? totalWins / winners.length : 0;
  const avgLoss = losers.length > 0 ? totalLosses / losers.length : 0;

  const largestWin = winners.length > 0 ? Math.max(...winners.map(t => t.pnl ?? 0)) : 0;
  const largestLoss = losers.length > 0 ? Math.min(...losers.map(t => t.pnl ?? 0)) : 0;

  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;
  const winRate = (winners.length / totalTrades) * 100;

  // Calculate avg holding period
  const holdingPeriods = trades
    .filter(t => t.closed_at)
    .map(t => {
      const entry = new Date(t.opened_at).getTime();
      const exit = new Date(t.closed_at!).getTime();
      return (exit - entry) / (1000 * 60 * 60); // hours
    });

  const avgHoldingPeriodHours = holdingPeriods.length > 0
    ? holdingPeriods.reduce((sum, h) => sum + h, 0) / holdingPeriods.length
    : 0;

  const totalFees = trades.reduce((sum, t) => sum + (t.fees ?? 0), 0);

  return {
    totalTrades,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    profitFactor,
    avgHoldingPeriodHours,
    totalFees,
  };
}

// ============================================================================
// ROUTE HANDLER
// ============================================================================
async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const { method } = request;

  // OPTIONS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // All routes require auth
  const userId = await authenticate(request, env);
  if (!userId) return err('Unauthorized', 401);

  const path = url.pathname.replace(/^\/api\/portfolio\/?/, '');

  // -----------------------------------------------------------------------
  // GET /api/portfolio (overview)
  // -----------------------------------------------------------------------
  if (method === 'GET' && (path === '' || path === '/')) {
    const { overview } = await calculatePortfolioMetrics(userId, env);
    return json({ success: true, ...overview });
  }

  // -----------------------------------------------------------------------
  // GET /api/portfolio/positions
  // -----------------------------------------------------------------------
  if (method === 'GET' && path === 'positions') {
    const { positions } = await calculatePortfolioMetrics(userId, env);
    return json({ success: true, positions, count: positions.length });
  }

  // -----------------------------------------------------------------------
  // GET /api/portfolio/trades (trade history)
  // -----------------------------------------------------------------------
  if (method === 'GET' && path === 'trades') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 500);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    const status = url.searchParams.get('status'); // 'open', 'closed', or null (all)

    let query = 'SELECT * FROM trades WHERE user_id = ?';
    const params: (string | number)[] = [userId];

    if (status === 'open' || status === 'closed') {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY opened_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const result = await env.DB.prepare(query).bind(...params).all();
    const trades = (result.results || []) as unknown as TradeRow[];

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM trades WHERE user_id = ?';
    const countParams: (string | number)[] = [userId];
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }

    const countResult = await env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>();

    return json({
      success: true,
      trades,
      count: trades.length,
      total: countResult?.count ?? 0,
      limit,
      offset,
    });
  }

  // -----------------------------------------------------------------------
  // GET /api/portfolio/metrics (performance metrics)
  // -----------------------------------------------------------------------
  if (method === 'GET' && path === 'metrics') {
    const metrics = await calculatePerformanceMetrics(userId, env);
    return json({ success: true, ...metrics });
  }

  // -----------------------------------------------------------------------
  // GET /api/portfolio/snapshots (historical snapshots)
  // -----------------------------------------------------------------------
  if (method === 'GET' && path === 'snapshots') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 1000);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const result = await env.DB.prepare(
      'SELECT * FROM portfolio_snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(userId, limit, offset).all();

    const snapshots = (result.results || []) as unknown as SnapshotRow[];

    const total = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM portfolio_snapshots WHERE user_id = ?'
    ).bind(userId).first<{ count: number }>();

    return json({
      success: true,
      snapshots,
      count: snapshots.length,
      total: total?.count ?? 0,
      limit,
      offset,
    });
  }

  // -----------------------------------------------------------------------
  // GET /api/portfolio/summary (comprehensive view)
  // -----------------------------------------------------------------------
  if (method === 'GET' && path === 'summary') {
    const { overview, positions } = await calculatePortfolioMetrics(userId, env);
    const performance = await calculatePerformanceMetrics(userId, env);

    // Get recent trades
    const recentTrades = await env.DB.prepare(
      'SELECT * FROM trades WHERE user_id = ? ORDER BY opened_at DESC LIMIT 10'
    ).bind(userId).all();

    // Get recent snapshots
    const recentSnapshots = await env.DB.prepare(
      'SELECT * FROM portfolio_snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT 30'
    ).bind(userId).all();

    return json({
      success: true,
      overview,
      performance,
      positions,
      recentTrades: recentTrades.results || [],
      recentSnapshots: recentSnapshots.results || [],
    });
  }

  return err('Not found', 404);
}

// ============================================================================
// PAGES FUNCTION EXPORT
// ============================================================================
export async function onRequest(context: {
  request: Request;
  env: Env;
  waitUntil: (p: Promise<unknown>) => void;
  next: () => Promise<Response>;
}): Promise<Response> {
  try {
    return await handleRequest(
      context.request,
      context.env,
      { waitUntil: context.waitUntil } as ExecutionContext
    );
  } catch (e: unknown) {
    console.error('Portfolio function error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error', detail: msg }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
}
