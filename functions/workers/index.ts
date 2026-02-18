/**
 * XQ Trade M8 — Scheduled Worker
 *
 * Responsibilities:
 *   - Cron "* /5 * * * *"  (every 5 min) → update market data from CoinGecko
 *   - Cron "* * * * *"        (every min) → run algo cycles for all 'running' bots
 *   - Durable Objects: TradingEngine (per-user stateful trading sessions)
 *   - Durable Objects: MarketDataStore (live price cache with SQLite)
 *
 * Deployed separately from Pages via wrangler.worker.toml
 * Shares the same D1, KV, and R2 bindings as the Pages project.
 */

import { createExchangeManager } from '../lib/sdk-exchange-connector';
import { createAlgoEngine, AlgoConfig, AlgoTradeResult } from '../lib/algo-trading-engine';

// ============================================================================
// ENVIRONMENT INTERFACE
// ============================================================================
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
  // Exchange API keys (same secrets as Pages project)
  BINANCE_API_KEY: string;
  BINANCE_SECRET_KEY: string;
  KRAKEN_API_KEY: string;
  KRAKEN_PRIVATE_KEY: string;
  BYBIT_API_KEY: string;
  BYBIT_API_SECRET: string;
  KUCOIN_KEY: string;
  KUCOIN_SECRET: string;
  KUCOIN_PASSPHRASE: string;
  ALPACA_API_KEY: string;
  ALPACA_SECRET_KEY: string;
  ALPACA_PAPER: string;
  COINBASE_API_KEY: string;
  COINBASE_SECRET_KEY: string;
  OKX_API_KEY: string;
  OKX_SECRET_KEY: string;
  OKX_PASSPHRASE: string;
  GATEIO_API_KEY: string;
  GATEIO_SECRET_KEY: string;
  MEXC_API_KEY: string;
  MEXC_SECRET_KEY: string;
  BITGET_API_KEY: string;
  BITGET_SECRET_KEY: string;
  BITGET_PASSPHRASE: string;
  BITFINEX_API_KEY: string;
  BITFINEX_SECRET_KEY: string;
  GEMINI_API_KEY: string;
  GEMINI_SECRET_KEY: string;
  OANDA_API_KEY: string;
  OANDA_ACCOUNT_ID: string;
  OANDA_PRACTICE: string;
  EXNESS_API_KEY: string;
  EXNESS_ACCOUNT_LOGIN: string;
  ALPHA_VANTAGE_API_KEY: string;
  FINNHUB_API_KEY: string;
}

// ============================================================================
// BOT ROW TYPE (from D1)
// ============================================================================
interface BotRow {
  id: string;
  user_id: string;
  name: string;
  strategy: string;
  symbol: string;
  exchange: string;
  position_size: number;
  risk_level: string;
  config: string | null;
  last_run_at: string | null;
  run_interval_minutes: number;
}

// ============================================================================
// MAIN WORKER EXPORT
// ============================================================================
export default {
  /**
   * HTTP handler — optional direct fetch (health check only)
   */
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
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

  /**
   * Cron handler — triggered by wrangler.worker.toml schedule
   *   every-5-min cron  → update market data
   *   every-min cron    → run algo cycles for running bots
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;
    console.log(`[trade-m8-worker] Cron fired: ${cron} at ${new Date().toISOString()}`);

    if (cron === '*/5 * * * *') {
      ctx.waitUntil(updateMarketData(env));
    }

    if (cron === '* * * * *') {
      ctx.waitUntil(runScheduledBots(env));
    }
  },
};

// ============================================================================
// DURABLE OBJECT: TradingEngine
// Manages stateful trading session per user (isolated, persistent)
// ============================================================================
export class TradingEngine {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
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

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
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

    if (url.pathname === '/prices' && request.method === 'GET') {
      const rows = this.state.storage.sql.exec('SELECT * FROM prices ORDER BY updated_at DESC').toArray();
      return json({ prices: rows, timestamp: new Date().toISOString() }, cors);
    }

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
      } as RequestInit
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

    // Cache latest prices in KV for fast reads (5-minute TTL)
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
// SCHEDULED TASK: Run algo cycles for all 'running' bots
// ============================================================================
async function runScheduledBots(env: Env): Promise<void> {
  try {
    // Ensure new bot columns exist (idempotent ALTER TABLE, errors suppressed)
    await ensureBotColumns(env);

    // Fetch all bots with status = 'running'
    const result = await env.DB.prepare(
      `SELECT id, user_id, name, strategy, symbol, exchange,
              position_size, risk_level, config,
              last_run_at, run_interval_minutes
       FROM trading_bots
       WHERE status = 'running'`
    ).all();

    const bots = result.results as unknown as BotRow[];

    if (bots.length === 0) {
      console.log('[bot-cron] No running bots');
      return;
    }

    console.log(`[bot-cron] ${bots.length} running bot(s) found`);

    // Filter to only bots that are due based on their run_interval_minutes
    const nowMs = Date.now();
    const dueBots = bots.filter(bot => {
      const intervalMs = (bot.run_interval_minutes || 5) * 60 * 1000;
      if (!bot.last_run_at) return true; // never run yet
      const lastRunMs = new Date(bot.last_run_at).getTime();
      return nowMs - lastRunMs >= intervalMs;
    });

    if (dueBots.length === 0) {
      console.log('[bot-cron] No bots due for execution');
      return;
    }

    console.log(`[bot-cron] ${dueBots.length} bot(s) due for execution`);

    // Build a single shared exchange manager (all bots share one instance)
    const manager = createExchangeManager({
      BINANCE_API_KEY: env.BINANCE_API_KEY,
      BINANCE_SECRET_KEY: env.BINANCE_SECRET_KEY,
      KRAKEN_API_KEY: env.KRAKEN_API_KEY,
      KRAKEN_PRIVATE_KEY: env.KRAKEN_PRIVATE_KEY,
      BYBIT_API_KEY: env.BYBIT_API_KEY,
      BYBIT_API_SECRET: env.BYBIT_API_SECRET,
      KUCOIN_KEY: env.KUCOIN_KEY,
      KUCOIN_SECRET: env.KUCOIN_SECRET,
      KUCOIN_PASSPHRASE: env.KUCOIN_PASSPHRASE,
      ALPACA_API_KEY: env.ALPACA_API_KEY,
      ALPACA_SECRET_KEY: env.ALPACA_SECRET_KEY,
      ALPACA_PAPER: env.ALPACA_PAPER,
      COINBASE_API_KEY: env.COINBASE_API_KEY,
      COINBASE_SECRET_KEY: env.COINBASE_SECRET_KEY,
      OKX_API_KEY: env.OKX_API_KEY,
      OKX_SECRET_KEY: env.OKX_SECRET_KEY,
      OKX_PASSPHRASE: env.OKX_PASSPHRASE,
      GATEIO_API_KEY: env.GATEIO_API_KEY,
      GATEIO_SECRET_KEY: env.GATEIO_SECRET_KEY,
      MEXC_API_KEY: env.MEXC_API_KEY,
      MEXC_SECRET_KEY: env.MEXC_SECRET_KEY,
      BITGET_API_KEY: env.BITGET_API_KEY,
      BITGET_SECRET_KEY: env.BITGET_SECRET_KEY,
      BITGET_PASSPHRASE: env.BITGET_PASSPHRASE,
      BITFINEX_API_KEY: env.BITFINEX_API_KEY,
      BITFINEX_SECRET_KEY: env.BITFINEX_SECRET_KEY,
      GEMINI_API_KEY: env.GEMINI_API_KEY,
      GEMINI_SECRET_KEY: env.GEMINI_SECRET_KEY,
    });

    // Run all due bots in parallel; individual failures don't stop others
    await Promise.allSettled(
      dueBots.map(bot => runBotCycle(bot, manager, env))
    );

  } catch (err) {
    console.error('[bot-cron] Fatal error in runScheduledBots:', err);
  }
}

// ============================================================================
// SINGLE BOT CYCLE
// ============================================================================
async function runBotCycle(bot: BotRow, manager: ReturnType<typeof createExchangeManager>, env: Env): Promise<void> {
  const tag = `[bot-cron:${bot.name}]`;

  try {
    // Parse stored config JSON (set when bot is created/updated)
    const storedConfig = bot.config ? JSON.parse(bot.config) : {};

    // Build AlgoConfig — stored config overrides defaults
    const algoConfig: AlgoConfig = {
      exchange: bot.exchange,
      symbol: bot.symbol || 'BTC/USDT',
      strategy: (bot.strategy as AlgoConfig['strategy']) || 'momentum',
      timeframe: storedConfig.timeframe || '15m',
      capitalUSDT: storedConfig.capitalUSDT || Math.max(bot.position_size * 10000, 50),
      maxOpenTrades: storedConfig.maxOpenTrades || 1,
      stopLossPct: storedConfig.stopLossPct || 0.02,
      takeProfitPct: storedConfig.takeProfitPct || 0.04,
      // Default to paper mode unless explicitly set to false in stored config
      paperMode: storedConfig.paperMode !== false,
      params: storedConfig.params,
    };

    console.log(`${tag} Running ${algoConfig.strategy} on ${algoConfig.symbol} [${algoConfig.timeframe}] paper=${algoConfig.paperMode}`);

    const engine = createAlgoEngine(manager, algoConfig);
    const result: AlgoTradeResult = await engine.runCycle(algoConfig);

    // Always update last_run_at and last_signal
    await env.DB.prepare(
      `UPDATE trading_bots
       SET last_run_at = datetime('now'), last_signal = ?, last_error = NULL, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(result.signal, bot.id).run();

    if (result.signal === 'hold' || result.confidence < 0.55) {
      console.log(`${tag} HOLD — ${result.reason} (conf=${result.confidence.toFixed(2)})`);
      return;
    }

    // Signal is buy or sell — record the trade
    const tradeId = crypto.randomUUID();
    const entryPrice = result.orderResult?.price ?? 0;
    const quantity = result.orderResult?.amount ?? (algoConfig.capitalUSDT / Math.max(entryPrice, 1));

    const stopLossPrice = entryPrice > 0
      ? (result.signal === 'buy'
        ? entryPrice * (1 - algoConfig.stopLossPct)
        : entryPrice * (1 + algoConfig.stopLossPct))
      : null;

    const takeProfitPrice = entryPrice > 0
      ? (result.signal === 'buy'
        ? entryPrice * (1 + algoConfig.takeProfitPct)
        : entryPrice * (1 - algoConfig.takeProfitPct))
      : null;

    const tradeType = algoConfig.paperMode ? 'paper' : 'market';
    const tradeStatus = algoConfig.paperMode ? 'paper' : 'open';

    await env.DB.prepare(
      `INSERT INTO trades
         (id, user_id, bot_id, exchange, symbol, side, type,
          quantity, entry_price, stop_loss, take_profit,
          strategy, confidence, reasoning, status, opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      tradeId,
      bot.user_id,
      bot.id,
      bot.exchange,
      bot.symbol,
      result.signal,
      tradeType,
      quantity,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      bot.strategy,
      result.confidence,
      result.reason,
      tradeStatus,
    ).run();

    const modeLabel = algoConfig.paperMode ? '[PAPER]' : '[LIVE]';
    console.log(
      `${tag} ${modeLabel} ${result.signal.toUpperCase()} ${bot.symbol} ` +
      `qty=${quantity.toFixed(6)} @ ${entryPrice} ` +
      `SL=${stopLossPrice?.toFixed(4)} TP=${takeProfitPrice?.toFixed(4)} ` +
      `conf=${result.confidence.toFixed(2)}`
    );

  } catch (cycleErr: any) {
    const errMsg = (cycleErr?.message || String(cycleErr)).substring(0, 500);
    console.error(`${tag} Cycle failed: ${errMsg}`);
    // Persist error without crashing the other bots
    await env.DB.prepare(
      `UPDATE trading_bots
       SET last_run_at = datetime('now'), last_error = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(errMsg, bot.id).run().catch(() => {});
  }
}

// ============================================================================
// MIGRATION HELPER — add new bot columns (idempotent)
// ============================================================================
async function ensureBotColumns(env: Env): Promise<void> {
  const alters = [
    `ALTER TABLE trading_bots ADD COLUMN last_run_at DATETIME`,
    `ALTER TABLE trading_bots ADD COLUMN last_signal TEXT DEFAULT 'hold'`,
    `ALTER TABLE trading_bots ADD COLUMN last_error TEXT`,
    `ALTER TABLE trading_bots ADD COLUMN run_interval_minutes INTEGER DEFAULT 5`,
    `ALTER TABLE trading_bots ADD COLUMN last_checked INTEGER`,
  ];
  for (const sql of alters) {
    await env.DB.prepare(sql).run().catch(() => {}); // ignore "duplicate column" errors
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
