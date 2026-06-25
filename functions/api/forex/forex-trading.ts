/**
 * FOREX & Commodity Trading API — Cloudflare Pages Function
 * Routes:
 *   GET  /api/forex/instruments         — list all tradeable instruments
 *   GET  /api/forex/quote               — live bid/ask (?symbol=EUR_USD&broker=oanda)
 *   GET  /api/forex/candles             — OHLCV data (?symbol=EUR_USD&timeframe=H1&broker=oanda)
 *   GET  /api/forex/rates               — multi-symbol rate snapshot
 *   GET  /api/forex/positions           — open positions (?broker=oanda)
 *   GET  /api/forex/account             — account summary (?broker=oanda)
 *   POST /api/forex/order               — place order
 *   POST /api/forex/positions/:id/close — close position
 *   GET  /api/forex/status              — broker connection status
 */

import {
  createForexManager,
  ForexCredentials,
  getStaticInstruments,
} from '../lib/forex-connector';

// ─── Env interface ────────────────────────────────────────────────────────────

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  // FOREX brokers
  OANDA_API_KEY: string;
  OANDA_ACCOUNT_ID: string;
  OANDA_PRACTICE: string;
  EXNESS_API_KEY: string;
  EXNESS_ACCOUNT_LOGIN: string;
  // Market data
  ALPHA_VANTAGE_API_KEY: string;
  FINNHUB_API_KEY: string;
}

// ─── JWT verification (same pattern as _middleware.ts) ────────────────────────

async function verifyJWT(token: string, secret: string): Promise<any> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const [header, payload, sig] = parts;
  const signingInput = `${header}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  // Decode base64url sig
  const sigBytes = Uint8Array.from(
    atob(sig.replace(/-/g, '+').replace(/_/g, '/').padEnd(sig.length + (4 - sig.length % 4) % 4, '=')),
    c => c.charCodeAt(0)
  );
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(signingInput));
  if (!valid) throw new Error('Invalid JWT signature');
  const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  if (data.exp && data.exp < Math.floor(Date.now() / 1000)) throw new Error('JWT expired');
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data: any, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors, ...extra },
  });
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function buildForexManager(env: Env) {
  const creds: ForexCredentials = {
    OANDA_API_KEY: env.OANDA_API_KEY,
    OANDA_ACCOUNT_ID: env.OANDA_ACCOUNT_ID,
    OANDA_PRACTICE: env.OANDA_PRACTICE,
    EXNESS_API_KEY: env.EXNESS_API_KEY,
    EXNESS_ACCOUNT_LOGIN: env.EXNESS_ACCOUNT_LOGIN,
    ALPHA_VANTAGE_API_KEY: env.ALPHA_VANTAGE_API_KEY,
    FINNHUB_API_KEY: env.FINNHUB_API_KEY,
  };
  return createForexManager(creds);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  // ── Public routes (no auth) ─────────────────────────────────────────────────

  // GET /api/forex/status
  if (request.method === 'GET' && path.endsWith('/api/forex/status')) {
    const manager = buildForexManager(env);
    return json({
      success: true,
      connectedBrokers: manager.getConnectedBrokers(),
      instruments: getStaticInstruments().length,
      timestamp: new Date().toISOString(),
    });
  }

  // GET /api/forex/instruments
  if (request.method === 'GET' && path.endsWith('/api/forex/instruments')) {
    const manager = buildForexManager(env);
    const broker = url.searchParams.get('broker') || undefined;
    try {
      const instruments = await manager.getInstruments(broker);
      return json({ success: true, instruments, count: instruments.length });
    } catch (err: any) {
      // Fall back to static list
      const instruments = getStaticInstruments();
      return json({ success: true, instruments, count: instruments.length, source: 'static' });
    }
  }

  // GET /api/forex/quote
  if (request.method === 'GET' && path.endsWith('/api/forex/quote')) {
    const symbol = url.searchParams.get('symbol');
    const broker = url.searchParams.get('broker') || undefined;
    if (!symbol) return json({ error: 'symbol parameter required' }, 400);
    const manager = buildForexManager(env);
    try {
      const quote = await manager.getQuote(symbol, broker);
      return json({ success: true, quote });
    } catch (err: any) {
      return json({ error: err.message }, 502);
    }
  }

  // GET /api/forex/candles
  if (request.method === 'GET' && path.endsWith('/api/forex/candles')) {
    const symbol = url.searchParams.get('symbol');
    const timeframe = url.searchParams.get('timeframe') || 'H1';
    const count = parseInt(url.searchParams.get('count') || '200');
    const broker = url.searchParams.get('broker') || undefined;
    if (!symbol) return json({ error: 'symbol parameter required' }, 400);
    const manager = buildForexManager(env);
    try {
      const candles = await manager.getCandles(symbol, timeframe, count, broker);
      return json({ success: true, symbol, timeframe, candles, count: candles.length });
    } catch (err: any) {
      return json({ error: err.message }, 502);
    }
  }

  // GET /api/forex/rates — multi-symbol snapshot
  if (request.method === 'GET' && path.endsWith('/api/forex/rates')) {
    const symbolsParam = url.searchParams.get('symbols') || 'EUR/USD,GBP/USD,USD/JPY,XAU/USD';
    const symbols = symbolsParam.split(',').map(s => s.trim());
    const broker = url.searchParams.get('broker') || undefined;
    const manager = buildForexManager(env);
    const rates: Record<string, any> = {};
    await Promise.allSettled(
      symbols.map(async (sym) => {
        try {
          rates[sym] = await manager.getQuote(sym, broker);
        } catch (err: any) {
          rates[sym] = { error: err.message };
        }
      })
    );
    return json({ success: true, rates, timestamp: new Date().toISOString() });
  }

  // ── Authenticated routes ────────────────────────────────────────────────────

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let userData: any;
  try {
    userData = await verifyJWT(authHeader.substring(7), env.JWT_SECRET);
  } catch (err: any) {
    return json({ error: 'Invalid token', message: err.message }, 401);
  }

  const userId = userData.userId;
  const manager = buildForexManager(env);

  // GET /api/forex/positions
  if (request.method === 'GET' && path.endsWith('/api/forex/positions')) {
    const broker = url.searchParams.get('broker') || undefined;
    try {
      const positions = await manager.getPositions(broker);
      return json({ success: true, positions, count: positions.length });
    } catch (err: any) {
      return json({ error: err.message }, 502);
    }
  }

  // GET /api/forex/account
  if (request.method === 'GET' && path.endsWith('/api/forex/account')) {
    const broker = url.searchParams.get('broker') || 'oanda';
    try {
      const account = await manager.getAccountInfo(broker);
      return json({ success: true, broker, account });
    } catch (err: any) {
      return json({ error: err.message }, 502);
    }
  }

  // POST /api/forex/order
  if (request.method === 'POST' && path.endsWith('/api/forex/order')) {
    let body: any;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

    const { broker, symbol, side, type, units, price, stopLoss, takeProfit, trailingStop } = body;

    if (!broker) return json({ error: 'broker is required (oanda | exness)' }, 400);
    if (!symbol) return json({ error: 'symbol is required' }, 400);
    if (!side || !['buy', 'sell'].includes(side)) return json({ error: 'side must be buy or sell' }, 400);
    if (!units || units <= 0) return json({ error: 'units must be a positive number' }, 400);

    // Risk check: max units guard
    const MAX_UNITS = 1_000_000;
    if (units > MAX_UNITS) return json({ error: `units exceeds maximum of ${MAX_UNITS}` }, 403);

    try {
      const result = await manager.placeOrder(broker, {
        symbol, side, type: type || 'market', units, price, stopLoss, takeProfit, trailingStop,
      });

      // Record in DB if trade was filled
      if (result.success && result.tradeId) {
        const tradeId = crypto.randomUUID();
        await env.DB.prepare(`
          INSERT INTO trades (id, user_id, bot_id, symbol, side, entry_price, quantity, status, opened_at, exchange_order_id)
          VALUES (?, ?, NULL, ?, ?, ?, ?, 'open', datetime('now'), ?)
        `).bind(tradeId, userId, symbol, side, result.price || 0, units, result.tradeId).run().catch(() => {});
      }

      return json({ success: result.success, result });
    } catch (err: any) {
      return json({ error: err.message }, 500);
    }
  }

  // POST /api/forex/positions/close
  if (request.method === 'POST' && path.includes('/api/forex/positions/close')) {
    let body: any;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

    const { broker, symbol, side } = body;
    if (!broker || !symbol) return json({ error: 'broker and symbol are required' }, 400);

    try {
      const result = await manager.closePosition(broker, symbol, side);
      return json({ success: true, result });
    } catch (err: any) {
      return json({ error: err.message }, 500);
    }
  }

  return json({ error: 'Not found' }, 404);
};
