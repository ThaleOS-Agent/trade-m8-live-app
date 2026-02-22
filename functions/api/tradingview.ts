/**
 * TradingView Integration API — Cloudflare Pages Function
 *
 * Routes:
 *   POST /api/tradingview/webhook   — receive TradingView alert webhooks
 *   GET  /api/tradingview/signals   — list recent signals received
 *   GET  /api/tradingview/status    — webhook receiver status
 *   POST /api/tradingview/test      — send a test signal (authenticated)
 *
 * TradingView Alert Message Format (JSON):
 *   {
 *     "action":    "buy" | "sell" | "close_long" | "close_short",
 *     "symbol":    "BTCUSDT" | "EURUSD" | "XAUUSD" | ...,
 *     "exchange":  "BINANCE" | "OANDA" | "binance" | ...,
 *     "strategy":  "momentum" | "rsi_reversion" | ... (optional),
 *     "price":     123.45,                             (optional)
 *     "quantity":  0.01,                               (optional)
 *     "tp":        125.00,                             (optional)
 *     "sl":        121.00,                             (optional)
 *     "message":   "Strategy fired: RSI < 30",         (optional)
 *     "secret":    "your-webhook-secret"               (optional but recommended)
 *   }
 *
 * Set TRADINGVIEW_WEBHOOK_SECRET as a Cloudflare Pages secret to enable
 * signature verification. Leave empty to accept all requests (dev only).
 */

import { createExchangeManager } from '../lib/sdk-exchange-connector';
import { createForexManager } from '../lib/forex-connector';
import { sendNotification } from '../lib/notification-service';

const FOREX_SYMBOLS = new Set([
  'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD',
  'XAU', 'XAG', 'XPT', 'XPD', 'WTICO', 'BCO', 'NATGAS',
  'US30', 'SPX500', 'NAS100', 'UK100', 'DE30', 'JP225',
]);

const FOREX_EXCHANGES = new Set(['oanda', 'exness', 'forex']);

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
  TRADINGVIEW_WEBHOOK_SECRET: string;
  // Exchange secrets
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
  // Forex
  OANDA_API_KEY: string;
  OANDA_ACCOUNT_ID: string;
  OANDA_PRACTICE: string;
  EXNESS_API_KEY: string;
  EXNESS_ACCOUNT_LOGIN: string;
  ALPHA_VANTAGE_API_KEY: string;
  FINNHUB_API_KEY: string;
  // Notifications
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-TradingView-Secret',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 400) {
  return json({ success: false, error: message }, status);
}

/**
 * Normalise TradingView symbol to exchange-compatible format
 * TV uses: BTCUSDT, EURUSD, XAUUSD
 * We use:  BTC/USDT, EUR/USD, XAU/USD
 */
function normaliseTVSymbol(raw: string): { symbol: string; isForex: boolean } {
  const s = raw.toUpperCase().replace(/[^A-Z0-9/_.]/g, '');

  // Already has slash separator
  if (s.includes('/')) {
    const base = s.split('/')[0];
    return { symbol: s, isForex: FOREX_SYMBOLS.has(base) };
  }

  // Known forex pairs (6-char no-slash): EURUSD → EUR/USD
  const forexPairs = [
    'EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NZDUSD',
    'EURGBP','EURJPY','GBPJPY','EURCHF','AUDNZD','EURAUD','GBPAUD',
    'XAUUSD','XAGUSD','XPTUSD','XPDUSD',
  ];
  if (forexPairs.includes(s)) {
    return { symbol: `${s.slice(0, 3)}/${s.slice(3)}`, isForex: true };
  }

  // Crypto: BTCUSDT → BTC/USDT
  const cryptoQuotes = ['USDT','USD','BTC','ETH','BNB','BUSD','USDC'];
  for (const q of cryptoQuotes) {
    if (s.endsWith(q) && s.length > q.length) {
      const base = s.slice(0, s.length - q.length);
      return { symbol: `${base}/${q}`, isForex: false };
    }
  }

  // Fallback
  return { symbol: s, isForex: false };
}

/**
 * Normalise exchange name
 */
function normaliseExchange(raw: string): string {
  const map: Record<string, string> = {
    'BINANCE': 'binance', 'KRAKEN': 'kraken', 'BYBIT': 'bybit',
    'KUCOIN': 'kucoin', 'ALPACA': 'alpaca', 'COINBASE': 'coinbase',
    'OKX': 'okx', 'GATEIO': 'gateio', 'MEXC': 'mexc',
    'BITGET': 'bitget', 'BITFINEX': 'bitfinex', 'GEMINI': 'gemini',
    'OANDA': 'oanda', 'EXNESS': 'exness',
    // TradingView source exchange suffixes
    'BINANCEUS': 'binance', 'BITBAY': 'kraken',
  };
  const upper = raw.toUpperCase();
  return map[upper] ?? raw.toLowerCase();
}

function getExchangeManager(env: Env) {
  return createExchangeManager({
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
}

function getForexManager(env: Env) {
  return createForexManager({
    OANDA_API_KEY: env.OANDA_API_KEY,
    OANDA_ACCOUNT_ID: env.OANDA_ACCOUNT_ID,
    OANDA_PRACTICE: env.OANDA_PRACTICE,
    EXNESS_API_KEY: env.EXNESS_API_KEY,
    EXNESS_ACCOUNT_LOGIN: env.EXNESS_ACCOUNT_LOGIN,
    ALPHA_VANTAGE_API_KEY: env.ALPHA_VANTAGE_API_KEY,
    FINNHUB_API_KEY: env.FINNHUB_API_KEY,
  });
}

/**
 * Parse alert body — TradingView can send JSON or plain text
 */
async function parseAlertBody(request: Request): Promise<Record<string, any>> {
  const contentType = request.headers.get('Content-Type') ?? '';
  const text = await request.text();

  // Try JSON first
  try {
    return JSON.parse(text);
  } catch {
    // Plain text alert message — try to extract key=value pairs
    const result: Record<string, any> = { message: text };

    // Pattern: "action=buy symbol=BTCUSDT exchange=BINANCE price=45000"
    const pairs = text.match(/(\w+)=([^\s]+)/g) ?? [];
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      result[key] = isNaN(Number(value)) ? value : Number(value);
    }

    // Single-word action: "buy", "sell", "close"
    if (pairs.length === 0) {
      const action = text.trim().toLowerCase();
      if (['buy', 'sell', 'close', 'close_long', 'close_short'].includes(action)) {
        result.action = action;
      }
    }

    return result;
  }
}

/**
 * Verify webhook secret (if configured)
 */
function verifySecret(request: Request, body: Record<string, any>, configuredSecret: string): boolean {
  if (!configuredSecret) return true; // No secret configured — allow all

  // Check header
  const headerSecret = request.headers.get('X-TradingView-Secret');
  if (headerSecret === configuredSecret) return true;

  // Check body field
  if (body.secret === configuredSecret) return true;
  if (body.key === configuredSecret) return true;
  if (body.token === configuredSecret) return true;

  return false;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    // ── GET /api/tradingview/status ──────────────────────────────────────────
    if (method === 'GET' && path.includes('/status')) {
      const secretConfigured = !!env.TRADINGVIEW_WEBHOOK_SECRET;
      const manager = getExchangeManager(env);
      return json({
        success: true,
        webhookUrl: `${url.origin}/api/tradingview/webhook`,
        secretConfigured,
        connectedExchanges: manager.getConnectedExchanges(),
        supportedAlertFields: ['action', 'symbol', 'exchange', 'strategy', 'price', 'quantity', 'tp', 'sl', 'secret'],
        supportedActions: ['buy', 'sell', 'close_long', 'close_short', 'hold'],
        alertFormatExample: {
          action: 'buy',
          symbol: 'BTCUSDT',
          exchange: 'BINANCE',
          strategy: 'momentum',
          quantity: 0.001,
          tp: 50000,
          sl: 45000,
          secret: '{{strategy.order.comment}}'
        },
        timestamp: new Date().toISOString(),
      });
    }

    // ── GET /api/tradingview/signals ─────────────────────────────────────────
    if (method === 'GET' && path.includes('/signals')) {
      // Auth required
      const authHeader = request.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) return err('Unauthorized', 401);

      const limit = parseInt(url.searchParams.get('limit') ?? '50');
      const rows = await env.DB.prepare(
        `SELECT * FROM tradingview_signals ORDER BY received_at DESC LIMIT ?`
      ).bind(limit).all().catch(() => ({ results: [] }));

      return json({ success: true, signals: rows.results, count: rows.results.length });
    }

    // ── POST /api/tradingview/test ───────────────────────────────────────────
    if (method === 'POST' && path.includes('/test')) {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) return err('Unauthorized', 401);

      return json({
        success: true,
        message: 'TradingView webhook endpoint is reachable',
        webhookUrl: `${url.origin}/api/tradingview/webhook`,
        timestamp: new Date().toISOString(),
      });
    }

    // ── POST /api/tradingview/webhook ────────────────────────────────────────
    if (method === 'POST' && path.includes('/webhook')) {
      const body = await parseAlertBody(request);

      // Verify secret
      if (!verifySecret(request, body, env.TRADINGVIEW_WEBHOOK_SECRET ?? '')) {
        // Log failed attempt
        await env.DB.prepare(
          `INSERT OR IGNORE INTO tradingview_signals
           (id, action, symbol, exchange, status, raw_payload, received_at)
           VALUES (?, ?, ?, ?, 'rejected', ?, datetime('now'))`
        ).bind(
          crypto.randomUUID(),
          body.action ?? 'unknown',
          body.symbol ?? 'unknown',
          body.exchange ?? 'unknown',
          JSON.stringify(body).slice(0, 500),
        ).run().catch(() => {});

        return err('Invalid webhook secret', 403);
      }

      // Extract and validate fields
      const action = String(body.action ?? '').toLowerCase();
      const rawSymbol = String(body.symbol ?? '');
      const rawExchange = String(body.exchange ?? body.broker ?? 'binance');
      const strategy = String(body.strategy ?? 'tradingview_alert');
      const alertPrice = body.price ? parseFloat(String(body.price)) : undefined;
      const quantity = body.quantity ?? body.qty ?? body.amount ?? 0.001;
      const takeProfit = body.tp ?? body.take_profit ?? body.takeProfit;
      const stopLoss = body.sl ?? body.stop_loss ?? body.stopLoss;
      const message = body.message ?? body.comment ?? '';

      if (!action || !rawSymbol) {
        return err('Required fields: action, symbol');
      }

      if (!['buy', 'sell', 'close_long', 'close_short', 'hold'].includes(action)) {
        return err(`Invalid action: "${action}". Use: buy, sell, close_long, close_short, hold`);
      }

      const { symbol, isForex } = normaliseTVSymbol(rawSymbol);
      const exchange = normaliseExchange(rawExchange);
      const signalId = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      // Log signal to DB
      await ensureSignalsTable(env);
      await env.DB.prepare(
        `INSERT OR IGNORE INTO tradingview_signals
         (id, action, symbol, exchange, strategy, alert_price, quantity, take_profit, stop_loss,
          message, raw_payload, status, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', datetime('now'))`
      ).bind(
        signalId, action, symbol, exchange, strategy,
        alertPrice ?? null,
        parseFloat(String(quantity)),
        takeProfit ?? null,
        stopLoss ?? null,
        String(message).slice(0, 500),
        JSON.stringify(body).slice(0, 1000),
      ).run().catch(console.warn);

      // If action is 'hold' — just log, don't trade
      if (action === 'hold') {
        return json({
          success: true,
          signalId,
          action: 'hold',
          symbol,
          exchange,
          message: 'Signal logged — no trade executed for hold',
          timestamp,
        });
      }

      // Map TV action to order side
      const orderSide: 'buy' | 'sell' = action.includes('sell') || action === 'close_long' ? 'sell' : 'buy';

      // Execute order
      let orderResult: any = null;
      let executionError: string | null = null;
      const useForex = isForex || FOREX_EXCHANGES.has(exchange);

      try {
        if (useForex) {
          // Forex / commodity execution via ForexManager
          const fxManager = getForexManager(env);
          const oandaSymbol = symbol.replace('/', '_');
          orderResult = await fxManager.placeOrder(exchange === 'exness' ? 'exness' : 'oanda', {
            symbol: oandaSymbol,
            side: orderSide,
            type: 'market',
            units: parseFloat(String(quantity)),
            stopLoss: stopLoss ? parseFloat(String(stopLoss)) : undefined,
            takeProfit: takeProfit ? parseFloat(String(takeProfit)) : undefined,
          });
        } else {
          // Crypto / stock execution via ExchangeManager
          const manager = getExchangeManager(env);
          orderResult = await manager.placeOrder({
            exchange,
            symbol,
            side: orderSide,
            type: 'market',
            amount: parseFloat(String(quantity)),
            price: alertPrice,
            stopLossPrice: stopLoss ? parseFloat(String(stopLoss)) : undefined,
            takeProfitPrice: takeProfit ? parseFloat(String(takeProfit)) : undefined,
          });
        }
      } catch (e: any) {
        executionError = e.message ?? 'Order execution failed';
      }

      const status = orderResult?.success ? 'executed' : (executionError ? 'failed' : 'rejected');

      // Update signal status in DB
      await env.DB.prepare(
        `UPDATE tradingview_signals SET status = ?, order_id = ?, execution_price = ?, error = ?
         WHERE id = ?`
      ).bind(
        status,
        orderResult?.orderId ?? null,
        orderResult?.averagePrice ?? alertPrice ?? null,
        executionError,
        signalId,
      ).run().catch(console.warn);

      // Log to trades table if executed
      if (orderResult?.success) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO trades
           (id, user_id, symbol, side, type, quantity, entry_price, exchange, strategy, status, confidence, opened_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(
          orderResult.orderId ?? signalId,
          'tradingview',
          symbol,
          orderSide,
          'market',
          parseFloat(String(quantity)),
          orderResult.averagePrice ?? alertPrice ?? null,
          exchange,
          strategy,
          orderResult.status ?? 'filled',
          0.8,  // TradingView strategy signals are high-confidence
        ).run().catch(console.warn);

        // Send trade executed notification
        sendNotification({
          userId: 'tradingview',
          type: 'trade_executed',
          data: {
            signalId,
            tradeId: orderResult.orderId ?? signalId,
            tradeSide: orderSide,
            tradeSymbol: symbol,
            tradeQuantity: parseFloat(String(quantity)),
            tradeEntryPrice: orderResult.averagePrice ?? alertPrice ?? 0,
            tradeExchange: exchange,
            tradeStatus: orderResult.status ?? 'filled',
            timestamp: new Date().toISOString(),
          },
          db: env.DB,
          env,
        }).catch(err => console.warn('Notification failed:', err));
      }

      // Send signal received notification (always, even if trade failed)
      sendNotification({
        userId: 'tradingview',
        type: 'signal_received',
        data: {
          signalId,
          signalAction: action,
          signalSymbol: symbol,
          signalExchange: exchange,
          signalStrategy: strategy,
          signalPrice: alertPrice,
          timestamp: timestamp,
        },
        db: env.DB,
        env,
      }).catch(err => console.warn('Notification failed:', err));

      return json({
        success: true,
        signalId,
        action,
        symbol,
        exchange,
        orderSide,
        orderResult,
        executionError,
        status,
        timestamp,
      });
    }

    return err('Endpoint not found', 404);

  } catch (e: any) {
    console.error('TradingView webhook error:', e);
    return err(e.message ?? 'Internal server error', 500);
  }
};

/**
 * Ensure tradingview_signals table exists (idempotent)
 */
async function ensureSignalsTable(env: Env): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS tradingview_signals (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      strategy TEXT,
      alert_price REAL,
      quantity REAL,
      take_profit REAL,
      stop_loss REAL,
      message TEXT,
      raw_payload TEXT,
      status TEXT DEFAULT 'received',
      order_id TEXT,
      execution_price REAL,
      error TEXT,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  ).run().catch(() => {});
}
