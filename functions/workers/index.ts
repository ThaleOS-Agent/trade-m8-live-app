/**
 * XQ Trade M8 — Scheduled Worker
 *
 * Responsibilities:
 *   - Cron: update market data every 5 minutes
 *   - Cron: check running bot statuses every minute
 *   - Durable Objects: TradingEngine (per-user stateful trading sessions)
 *   - Durable Objects: MarketDataStore (live price cache with SQLite)
 *
 * Deployed separately from Pages via wrangler.worker.toml
 * Shares the same D1, KV, and R2 bindings as the Pages project.
 */

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  TRADES: KVNamespace;
  STORAGE: R2Bucket;
  TRADING_ENGINE: DurableObjectNamespace;
  MARKET_DATA: DurableObjectNamespace;
  JWT_SECRET: string;
  COINGECKO_API_KEY: string;
}

// ============================================================================
// MAIN WORKER EXPORT
// ============================================================================
export default {
  /**
   * HTTP handler — proxied requests to this worker (optional, for direct use)
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (url.pathname === '/health') {
      return json({ status: 'healthy', worker: 'trade-m8-worker', timestamp: new Date().toISOString() }, cors);
    }

    return json({ error: 'Not found' }, cors, 404);
  },

  // Cron handler — triggered by wrangler.worker.toml cron schedule
  // "every-5-min" → update market data
  // "every-min"   → check bot statuses
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;
    console.log(`[trade-m8-worker] Cron fired: ${cron} at ${new Date().toISOString()}`);

    if (cron === '*/5 * * * *') {
      ctx.waitUntil(updateMarketData(env));
    }

    if (cron === '* * * * *') {
      ctx.waitUntil(checkTradingBots(env));
    }
  },
};

// ============================================================================
// DURABLE OBJECT: TradingEngine
// Manages stateful trading session per user (isolated, persistent)
// ============================================================================
export class TradingEngine {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/status') {
      const status = (await this.state.storage.get('status')) || 'idle';
      const lastTrade = (await this.state.storage.get('lastTrade')) || null;
      const activeBots = (await this.state.storage.get('activeBots')) || 0;
      return json({ status, lastTrade, activeBots }, cors);
    }

    if (url.pathname === '/start' && request.method === 'POST') {
      await this.state.storage.put('status', 'running');
      await this.state.storage.put('startedAt', new Date().toISOString());
      return json({ success: true, status: 'running' }, cors);
    }

    if (url.pathname === '/stop' && request.method === 'POST') {
      await this.state.storage.put('status', 'stopped');
      await this.state.storage.put('stoppedAt', new Date().toISOString());
      return json({ success: true, status: 'stopped' }, cors);
    }

    if (url.pathname === '/record-trade' && request.method === 'POST') {
      const trade = await request.json() as Record<string, unknown>;
      await this.state.storage.put('lastTrade', JSON.stringify(trade));
      const count = ((await this.state.storage.get<number>('tradeCount')) || 0) + 1;
      await this.state.storage.put('tradeCount', count);
      return json({ success: true, tradeCount: count }, cors);
    }

    return json({ error: 'Not found' }, cors, 404);
  }
}

// ============================================================================
// DURABLE OBJECT: MarketDataStore
// Live price cache backed by Durable Object SQLite storage
// ============================================================================
export class MarketDataStore {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS prices (
          symbol TEXT PRIMARY KEY,
          price REAL NOT NULL,
          change_24h REAL,
          updated_at TEXT NOT NULL
        )
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // GET /prices — return all cached prices
    if (url.pathname === '/prices' && request.method === 'GET') {
      const rows = this.state.storage.sql.exec('SELECT * FROM prices ORDER BY updated_at DESC').toArray();
      return json({ prices: rows, timestamp: new Date().toISOString() }, cors);
    }

    // POST /update — upsert price data
    if (url.pathname === '/update' && request.method === 'POST') {
      const { symbol, price, change_24h } = await request.json() as {
        symbol: string;
        price: number;
        change_24h: number;
      };
      const now = new Date().toISOString();
      this.state.storage.sql.exec(
        `INSERT INTO prices (symbol, price, change_24h, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET
           price = excluded.price,
           change_24h = excluded.change_24h,
           updated_at = excluded.updated_at`,
        symbol, price, change_24h, now
      );
      return json({ success: true }, cors);
    }

    return json({ error: 'Not found' }, cors, 404);
  }
}

// ============================================================================
// SCHEDULED TASK: Update market data from CoinGecko
// ============================================================================
async function updateMarketData(env: Env): Promise<void> {
  const coins = ['bitcoin', 'ethereum', 'cardano', 'solana', 'binancecoin'];
  const ids = coins.join(',');

  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      {
        headers: env.COINGECKO_API_KEY
          ? { 'x-cg-pro-api-key': env.COINGECKO_API_KEY }
          : {},
        cf: { cacheTtl: 60, cacheEverything: true },
      }
    );

    if (!resp.ok) {
      console.error(`[market-update] CoinGecko error: ${resp.status}`);
      return;
    }

    const data = await resp.json() as Record<string, { usd: number; usd_24h_change: number }>;
    const now = Math.floor(Date.now() / 1000);

    const inserts = Object.entries(data).map(([coinId, info]) =>
      env.DB.prepare(
        `INSERT OR REPLACE INTO market_data
           (id, symbol, exchange, price, change_24h, updated_at)
         VALUES (?, ?, 'coingecko', ?, ?, ?)`
      ).bind(`${coinId}-coingecko`, coinId.toUpperCase(), info.usd, info.usd_24h_change, now)
    );

    await env.DB.batch(inserts);

    // Also cache in KV for fast reads (5-minute TTL)
    await env.CACHE.put(
      'market:latest',
      JSON.stringify({ data, updatedAt: new Date().toISOString() }),
      { expirationTtl: 300 }
    );

    console.log(`[market-update] Updated ${Object.keys(data).length} coins`);
  } catch (err) {
    console.error('[market-update] Failed:', err);
  }
}

// ============================================================================
// SCHEDULED TASK: Check running bot statuses
// ============================================================================
async function checkTradingBots(env: Env): Promise<void> {
  try {
    const result = await env.DB.prepare(
      `SELECT id, user_id, name, strategy, symbol, exchange
       FROM trading_bots
       WHERE status = 'active'`
    ).all();

    const bots = result.results as Array<{
      id: string;
      user_id: string;
      name: string;
      strategy: string;
      symbol: string;
      exchange: string;
    }>;

    if (bots.length === 0) return;

    console.log(`[bot-check] ${bots.length} running bot(s)`);

    // Update last_checked timestamp for all running bots
    const updates = bots.map(bot =>
      env.DB.prepare(
        `UPDATE trading_bots SET last_checked = strftime('%s','now') WHERE id = ?`
      ).bind(bot.id)
    );

    if (updates.length > 0) {
      await env.DB.batch(updates);
    }
  } catch (err) {
    console.error('[bot-check] Failed:', err);
  }
}

// ============================================================================
// HELPER
// ============================================================================
function json(data: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
