/**
 * Backtesting Engine — Cloudflare Pages Function
 *
 * Routes:
 *   POST /api/backtest/run           — Run a backtest (fetch CoinGecko OHLCV or synthetic)
 *   GET  /api/backtest/results       — List this user's backtest results
 *   GET  /api/backtest/results/:id   — Get full result JSON
 *   DELETE /api/backtest/results/:id — Delete a result
 *
 * All routes require JWT auth.
 * Backtest results are stored in D1 `backtest_results` table.
 */

import {
  createBacktestingEngine,
  generateSampleHistoricalData,
  BacktestConfig,
  HistoricalDataPoint,
} from '../lib/backtesting-engine';

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
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.userId as string;
  } catch {
    return null;
  }
}

// ============================================================================
// TICKER → COINGECKO ID MAP
// ============================================================================
const tickerToId: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana',
  XRP: 'ripple', ADA: 'cardano', AVAX: 'avalanche-2', DOT: 'polkadot',
  MATIC: 'matic-network', LINK: 'chainlink', LTC: 'litecoin',
  UNI: 'uniswap', ATOM: 'cosmos', XLM: 'stellar',
};

function resolveId(symbol: string): string {
  // Accept "BTC/USDT", "BTC-USDT", "BTC", or "bitcoin"
  const base = symbol.split(/[\/\-]/)[0].toUpperCase();
  return tickerToId[base] ?? base.toLowerCase();
}

// ============================================================================
// FETCH OHLCV FROM COINGECKO
// ============================================================================
async function fetchCoinGeckoOHLCV(
  symbol: string,
  days: number,
  apiKey: string
): Promise<HistoricalDataPoint[] | null> {
  const coinId = resolveId(symbol);
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'Trade-M8-Backtest/1.0 (https://trade-m8.app; contact@trade-m8.app)',
    };
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

    const resp = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timeout);

    if (!resp.ok) return null;

    // CoinGecko OHLC: [[timestamp_ms, open, high, low, close], ...]
    const raw: number[][] = await resp.json() as number[][];

    return raw.map(([ts, o, h, l, c]) => ({
      timestamp: new Date(ts).toISOString(),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: 0, // OHLC endpoint doesn't return volume; backtest engine still works
    }));
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ============================================================================
// ENSURE backtest_results TABLE EXISTS
// ============================================================================
async function ensureBacktestTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS backtest_results (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      strategy TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      initial_capital REAL NOT NULL,
      final_capital REAL,
      total_return_pct REAL,
      win_rate REAL,
      sharpe_ratio REAL,
      max_drawdown REAL,
      total_trades INTEGER,
      data_source TEXT DEFAULT 'coingecko',
      result_json TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `).run();
}

// ============================================================================
// ROUTE HANDLER
// ============================================================================
async function handleRequest(
  request: Request,
  env: Env,
  _ctx: ExecutionContext
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

  // Ensure table on every request (cheap: CREATE TABLE IF NOT EXISTS)
  await ensureBacktestTable(env.DB);

  const path = url.pathname.replace(/^\/api\/backtest\/?/, '');

  // -----------------------------------------------------------------------
  // POST /api/backtest/run
  // -----------------------------------------------------------------------
  if (method === 'POST' && (path === 'run' || path === '')) {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return err('Invalid JSON body');
    }

    const {
      symbol = 'BTC/USDT',
      startDate,
      endDate,
      initialCapital = 10000,
      strategy = 'technical_master',
      enableAI = false,
      enableRiskManagement = true,
      useSampleData = false,
      days = 90,
      maxBars = 500,
    } = body as {
      symbol?: string;
      startDate?: string;
      endDate?: string;
      initialCapital?: number;
      strategy?: BacktestConfig['strategy'];
      enableAI?: boolean;
      enableRiskManagement?: boolean;
      useSampleData?: boolean;
      days?: number;
      maxBars?: number;
    };

    // Validate strategy
    const validStrategies: BacktestConfig['strategy'][] = [
      'ai_momentum', 'news_driven', 'technical_master', 'ensemble',
    ];
    if (!validStrategies.includes(strategy)) {
      return err(`Invalid strategy. Must be one of: ${validStrategies.join(', ')}`);
    }

    // Validate capital
    if (typeof initialCapital !== 'number' || initialCapital < 100) {
      return err('initialCapital must be a number >= 100');
    }

    // Date range for config
    const now = new Date();
    const resolvedEndDate = endDate ?? now.toISOString().slice(0, 10);
    const resolvedStartDate = startDate ?? new Date(now.getTime() - days * 86_400_000)
      .toISOString().slice(0, 10);

    // Fetch or generate historical data
    let historicalData: HistoricalDataPoint[];
    let dataSource = 'coingecko';

    if (useSampleData) {
      // Synthetic data — always works, no rate limits
      dataSource = 'synthetic';
      const startPriceDefaults: Record<string, number> = {
        BTC: 45000, ETH: 2500, BNB: 300, SOL: 150, XRP: 0.6,
        ADA: 0.5, AVAX: 35, DOT: 8, MATIC: 0.9, LINK: 15,
      };
      const base = symbol.split(/[\/\-]/)[0].toUpperCase();
      const startPrice = startPriceDefaults[base] ?? 100;
      historicalData = generateSampleHistoricalData(symbol, Math.min(days, 365), startPrice);
    } else {
      // Try CoinGecko (max 90 days on free tier for hourly OHLC)
      const cgDays = Math.min(days, 365);
      const fetched = await fetchCoinGeckoOHLCV(symbol, cgDays, env.COINGECKO_API_KEY ?? '');

      if (!fetched || fetched.length < 51) {
        // Fallback to synthetic data
        dataSource = 'synthetic_fallback';
        const startPriceDefaults: Record<string, number> = {
          BTC: 45000, ETH: 2500, BNB: 300, SOL: 150, XRP: 0.6,
        };
        const base = symbol.split(/[\/\-]/)[0].toUpperCase();
        historicalData = generateSampleHistoricalData(symbol, Math.min(days, 365), startPriceDefaults[base] ?? 100);
      } else {
        historicalData = fetched;
      }
    }

    // Cap bars to prevent CPU timeout
    if (historicalData.length > maxBars) {
      historicalData = historicalData.slice(-maxBars);
    }

    // Require at least 51 bars (50 warm-up + 1 processed)
    if (historicalData.length < 51) {
      return err(`Not enough historical data. Got ${historicalData.length} bars, need at least 51. Try increasing 'days' or use 'useSampleData: true'.`);
    }

    const config: BacktestConfig = {
      symbol,
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
      initialCapital,
      strategy,
      enableAI,
      enableRiskManagement,
    };

    // Run backtest
    const engine = createBacktestingEngine();
    const result = await engine.runBacktest(config, historicalData);

    // Persist result to D1
    const resultId = crypto.randomUUID();
    const resultJson = JSON.stringify(result);

    await env.DB.prepare(`
      INSERT INTO backtest_results
        (id, user_id, symbol, strategy, start_date, end_date, initial_capital,
         final_capital, total_return_pct, win_rate, sharpe_ratio, max_drawdown,
         total_trades, data_source, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      resultId,
      userId,
      symbol,
      strategy,
      resolvedStartDate,
      resolvedEndDate,
      initialCapital,
      result.summary.finalCapital,
      result.summary.totalReturnPercent,
      result.summary.winRate,
      result.summary.sharpeRatio,
      result.summary.maxDrawdown,
      result.summary.totalTrades,
      dataSource,
      resultJson,
    ).run();

    return json({
      success: true,
      resultId,
      dataSource,
      barsProcessed: historicalData.length,
      result,
    });
  }

  // -----------------------------------------------------------------------
  // GET /api/backtest/results
  // -----------------------------------------------------------------------
  if (method === 'GET' && (path === 'results' || path === 'results/')) {
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const rows = await env.DB.prepare(`
      SELECT id, symbol, strategy, start_date, end_date, initial_capital,
             final_capital, total_return_pct, win_rate, sharpe_ratio,
             max_drawdown, total_trades, data_source, created_at
      FROM backtest_results
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();

    const total = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM backtest_results WHERE user_id = ?'
    ).bind(userId).first<{ count: number }>();

    return json({
      success: true,
      results: rows.results,
      total: total?.count ?? 0,
      limit,
      offset,
    });
  }

  // -----------------------------------------------------------------------
  // GET /api/backtest/results/:id
  // -----------------------------------------------------------------------
  if (method === 'GET' && path.startsWith('results/')) {
    const id = path.slice('results/'.length);
    if (!id) return err('Missing result ID', 400);

    const row = await env.DB.prepare(
      'SELECT * FROM backtest_results WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first<{ result_json?: string } & Record<string, unknown>>();

    if (!row) return err('Result not found', 404);

    // Parse stored JSON back to object
    let result: unknown;
    try {
      result = row.result_json ? JSON.parse(row.result_json as string) : null;
    } catch {
      result = null;
    }

    // Return metadata + full result (omit raw result_json to avoid duplication)
    const { result_json: _omit, ...meta } = row;
    return json({ success: true, ...meta, result });
  }

  // -----------------------------------------------------------------------
  // DELETE /api/backtest/results/:id
  // -----------------------------------------------------------------------
  if (method === 'DELETE' && path.startsWith('results/')) {
    const id = path.slice('results/'.length);
    if (!id) return err('Missing result ID', 400);

    const existing = await env.DB.prepare(
      'SELECT id FROM backtest_results WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first();

    if (!existing) return err('Result not found', 404);

    await env.DB.prepare('DELETE FROM backtest_results WHERE id = ? AND user_id = ?')
      .bind(id, userId).run();

    return json({ success: true, deleted: id });
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
    console.error('Backtest function error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error', detail: msg }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
}
