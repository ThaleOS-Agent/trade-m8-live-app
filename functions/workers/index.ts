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
// PYTHON EXECUTOR CLIENT
// Calls the FastAPI executor on AWS Tokyo for order placement and risk checks.
// Falls back gracefully to the TS algo engine if EXECUTOR_URL is not set.
// ============================================================================

interface ExecutorRiskResponse {
  approved:      boolean;
  units:         number;
  sl:            number;
  tp:            number;
  atr:           number;
  risk_amount:   number;
  reject_reason: string | null;
  paper_mode:    boolean;
}

interface ExecutorOrderResponse {
  success:    boolean;
  order_id:   string;
  symbol:     string;
  side:       string;
  filled_qty: number;
  fill_price: number;
  fee:        number;
  order_type: string;
  exchange:   string;
  paper_mode: boolean;
  error:      string;
  timestamp:  string;
}

interface ExecutorCloseResponse {
  success:    boolean;
  net_pnl:    number;
  order_id:   string;
  paper_mode: boolean;
  error:      string;
}

async function executorFetch<T>(
  env:      Env,
  path:     string,
  method:   string = 'GET',
  body?:    unknown,
): Promise<T | null> {
  if (!env.EXECUTOR_URL || !env.EXECUTOR_SECRET) {
    console.warn('[executor] EXECUTOR_URL or EXECUTOR_SECRET not set — skipping Python executor call');
    return null;
  }

  const url = `${env.EXECUTOR_URL.replace(/\/$/, '')}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.EXECUTOR_SECRET}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8000),   // 8s timeout — executor must be fast
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[executor] ${method} ${path} → ${res.status}: ${text.substring(0, 200)}`);
      return null;
    }

    return (await res.json()) as T;
  } catch (err: any) {
    console.error(`[executor] ${method} ${path} failed: ${err?.message ?? err}`);
    return null;
  }
}

/** Check if the Python executor is reachable and healthy. */
async function executorHealthy(env: Env): Promise<boolean> {
  const result = await executorFetch<{ status: string }>(env, '/health');
  return result?.status === 'ok';
}

/** Evaluate risk and get position size from the Python executor. */
async function executorRiskEvaluate(
  env:         Env,
  entryPrice:  number,
  highArr:     number[],
  lowArr:      number[],
  closeArr:    number[],
  side:        'LONG' | 'SHORT' = 'LONG',
  confidence:  number = 1.0,
): Promise<ExecutorRiskResponse | null> {
  return executorFetch<ExecutorRiskResponse>(env, '/risk/evaluate', 'POST', {
    entry_price: entryPrice,
    high_arr:    highArr,
    low_arr:     lowArr,
    close_arr:   closeArr,
    side,
    confidence,
  });
}

/** Place an order via the Python executor. */
async function executorExecute(
  env:        Env,
  symbol:     string,
  action:     'BUY' | 'SELL',
  units:      number,
  entryPrice: number,
  exchange:   string = '',
): Promise<ExecutorOrderResponse | null> {
  return executorFetch<ExecutorOrderResponse>(env, '/execute', 'POST', {
    symbol,
    action,
    units,
    entry_price: entryPrice,
    exchange,
  });
}

/** Close an open position via the Python executor and update P&L. */
async function executorClose(
  env:        Env,
  symbol:     string,
  side:       string,
  units:      number,
  entryPrice: number,
  exitPrice:  number,
  exchange:   string = '',
): Promise<ExecutorCloseResponse | null> {
  return executorFetch<ExecutorCloseResponse>(env, '/execute/close', 'POST', {
    symbol,
    side,
    units,
    entry_price: entryPrice,
    exit_price:  exitPrice,
    exchange,
  });
}

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
  // ── Python Executor (AWS Tokyo) ─────────────────────────────────────────────
  // Set via: wrangler pages secret put EXECUTOR_URL
  //          wrangler pages secret put EXECUTOR_SECRET
  // EXECUTOR_URL example: https://executor.trade-m8.internal:8000
  // PAPER_MODE:  "true" (default) | "false" — mirrors executor env
  EXECUTOR_URL:    string;  // base URL of the FastAPI executor on AWS Tokyo
  EXECUTOR_SECRET: string;  // shared secret — must match executor EXECUTOR_SECRET env
  PAPER_MODE:      string;  // "true" | "false"
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

    // Executor health probe — confirms Python service is reachable from this Worker
    if (url.pathname === '/executor/health') {
      const healthy = await executorHealthy(_env);
      return json({
        executor_reachable: healthy,
        executor_url:       _env.EXECUTOR_URL ? 'configured' : 'not-configured',
        paper_mode:         _env.PAPER_MODE !== 'false',
        timestamp:          new Date().toISOString(),
      }, cors);
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
    // Ensure new bot columns exist — guarded by KV flag so DDL only runs once
    if (!await env.CACHE.get('worker:columns-migrated')) {
      await ensureBotColumns(env);
      await env.CACHE.put('worker:columns-migrated', '1', { expirationTtl: 86400 * 30 });
    }

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
// Routing priority:
//   1. Python executor on AWS Tokyo (if EXECUTOR_URL is set and healthy)
//   2. TypeScript algo engine fallback (if executor is unavailable)
//
// The Python executor provides:
//   - True Range ATR (not just H-L)
//   - Correct Wilder RSI smoothing
//   - Daily loss gate and trade count gate
//   - PAPER_MODE gate (no live orders until PAPER_MODE=false on executor)
//   - Binance TWAP for large orders, OANDA for forex/gold
// ============================================================================
async function runBotCycle(bot: BotRow, manager: ReturnType<typeof createExchangeManager>, env: Env): Promise<void> {
  const tag = `[bot-cron:${bot.name}]`;

  try {
    const storedConfig = bot.config ? JSON.parse(bot.config) : {};

    const algoConfig: AlgoConfig = {
      exchange:      bot.exchange,
      symbol:        bot.symbol || 'BTC/USDT',
      strategy:      (bot.strategy as AlgoConfig['strategy']) || 'momentum',
      timeframe:     storedConfig.timeframe     || '15m',
      capitalUSDT:   storedConfig.capitalUSDT   || Math.max(bot.position_size * 10000, 50),
      maxOpenTrades: storedConfig.maxOpenTrades || 1,
      stopLossPct:   storedConfig.stopLossPct   || 0.02,
      takeProfitPct: storedConfig.takeProfitPct || 0.04,
      paperMode:     storedConfig.paperMode !== false,  // default: paper
      params:        storedConfig.params,
    };

    const VALID_STRATEGIES = new Set([
      'momentum','rsi_reversion','macd_crossover','breakout',
      'scalping','dual_ma','buy_the_dip','trend_following',
    ]);
    if (!VALID_STRATEGIES.has(bot.strategy)) {
      const msg = `Unknown strategy '${bot.strategy}' — update the bot config`;
      console.error(`${tag} ${msg}`);
      await env.DB.prepare(
        `UPDATE trading_bots SET last_error = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(msg, bot.id).run().catch(() => {});
      return;
    }

    // Skip if an open trade already exists for this bot+symbol
    const existingTrade = await env.DB.prepare(
      `SELECT id FROM trades WHERE bot_id = ? AND symbol = ? AND status IN ('open','paper') LIMIT 1`
    ).bind(bot.id, bot.symbol).first();

    if (existingTrade) {
      console.log(`${tag} Skipping — open trade already exists for ${bot.symbol}`);
      return;
    }

    // ── Run signal generation (TypeScript algo engine) ──────────────────────
    // Signal generation always runs in TS — it's fast and needs no Python.
    // Only risk sizing and order placement route to the Python executor.
    const engine = createAlgoEngine(manager, algoConfig, env.CACHE);
    const result: AlgoTradeResult = await engine.runCycle(algoConfig);

    // Update last_run_at and last_signal regardless of outcome
    await env.DB.prepare(
      `UPDATE trading_bots
       SET last_run_at = datetime('now'), last_signal = ?, last_error = NULL, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(result.signal, bot.id).run();

    if (result.signal === 'hold') {
      console.log(`${tag} HOLD — ${result.reason} (conf=${result.confidence.toFixed(2)})`);
      return;
    }

    // ── Risk evaluation ──────────────────────────────────────────────────────
    // Prefer Python executor (True Range ATR, Wilder RSI, daily gates).
    // Fall back to TS engine's own SL/TP if executor unreachable.
    const action = result.signal === 'buy' ? 'BUY' : 'SELL';
    const entryPrice = result.orderResult?.price ?? result.indicators?.lastPrice ?? 0;

    let units   = result.orderResult?.amount ?? (algoConfig.capitalUSDT / Math.max(entryPrice, 1));
    let sl      = result.stopLossPrice  ?? entryPrice * (1 - algoConfig.stopLossPct);
    let tp      = result.takeProfitPrice ?? entryPrice * (1 + algoConfig.takeProfitPct);
    let useExecutor = false;

    if (env.EXECUTOR_URL && env.EXECUTOR_SECRET) {
      // Fetch recent OHLCV from KV cache (populated by the market-data cron)
      const cached = await env.CACHE.get(`ohlcv:${bot.symbol}:${algoConfig.timeframe}`);
      if (cached) {
        try {
          const candles: { high: number; low: number; close: number }[] = JSON.parse(cached);
          const highArr  = candles.map(c => c.high);
          const lowArr   = candles.map(c => c.low);
          const closeArr = candles.map(c => c.close);

          const riskResp = await executorRiskEvaluate(
            env, entryPrice, highArr, lowArr, closeArr,
            action === 'BUY' ? 'LONG' : 'SHORT',
            result.confidence,
          );

          if (riskResp) {
            if (!riskResp.approved) {
              console.log(`${tag} Executor rejected: ${riskResp.reject_reason}`);
              await env.DB.prepare(
                `UPDATE trading_bots SET last_error = ?, updated_at = datetime('now') WHERE id = ?`
              ).bind(`Risk rejected: ${riskResp.reject_reason}`, bot.id).run().catch(() => {});
              return;
            }
            units = riskResp.units;
            sl    = riskResp.sl;
            tp    = riskResp.tp;
            useExecutor = true;
            console.log(`${tag} Executor risk approved: units=${units.toFixed(4)} sl=${sl.toFixed(4)} tp=${tp.toFixed(4)} ATR=${riskResp.atr.toFixed(4)}`);
          }
        } catch (parseErr) {
          console.warn(`${tag} Could not parse OHLCV cache — using TS risk sizing`);
        }
      } else {
        console.warn(`${tag} No OHLCV cache for ${bot.symbol}:${algoConfig.timeframe} — using TS risk sizing`);
      }
    }

    // ── Order placement ──────────────────────────────────────────────────────
    // Prefer Python executor (handles PAPER_MODE gate, TWAP routing, OANDA).
    // Fall back to TS engine result if executor unreachable.
    let orderId    = result.orderResult?.orderId    ?? crypto.randomUUID();
    let fillPrice  = result.orderResult?.price      ?? entryPrice;
    let tradeType  = result.orderResult?.type       ?? (algoConfig.paperMode ? 'paper' : 'market');
    let tradeStatus = algoConfig.paperMode ? 'paper' : 'open';
    let executorUsed = false;

    if (useExecutor && env.EXECUTOR_URL && env.EXECUTOR_SECRET) {
      const orderResp = await executorExecute(
        env, bot.symbol, action, units, entryPrice, bot.exchange,
      );
      if (orderResp) {
        if (!orderResp.success) {
          const errMsg = `Order failed: ${orderResp.error}`;
          console.error(`${tag} ${errMsg}`);
          await env.DB.prepare(
            `UPDATE trading_bots SET last_error = ?, updated_at = datetime('now') WHERE id = ?`
          ).bind(errMsg, bot.id).run().catch(() => {});
          return;
        }
        orderId      = orderResp.order_id;
        fillPrice    = orderResp.fill_price || entryPrice;
        tradeType    = orderResp.order_type || tradeType;
        tradeStatus  = orderResp.paper_mode ? 'paper' : 'open';
        executorUsed = true;
      }
    }

    // ── Persist trade to D1 ──────────────────────────────────────────────────
    const tradeId = crypto.randomUUID();
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
      result.signal,            // 'buy' | 'sell'
      tradeType,
      units,
      fillPrice,
      sl,
      tp,
      bot.strategy,
      result.confidence,
      result.reason,
      tradeStatus,
    ).run();

    const modeLabel     = tradeStatus === 'paper' ? '[PAPER]' : '[LIVE]';
    const executorLabel = executorUsed ? '[PY-EXEC]' : '[TS-EXEC]';
    console.log(
      `${tag} ${modeLabel} ${executorLabel} ${action} ${bot.symbol} ` +
      `qty=${units.toFixed(6)} @ ${fillPrice} ` +
      `SL=${sl.toFixed(4)} TP=${tp.toFixed(4)} ` +
      `conf=${result.confidence.toFixed(2)}`
    );

  } catch (cycleErr: any) {
    const errMsg = (cycleErr?.message || String(cycleErr)).substring(0, 500);
    console.error(`${tag} Cycle failed: ${errMsg}`);
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
