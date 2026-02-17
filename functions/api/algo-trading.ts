/**
 * Algo Trading API Endpoint — Cloudflare Pages Function
 * Routes:
 *   POST /api/algo-trading/signal       — compute signal without executing
 *   POST /api/algo-trading/run          — compute signal + execute if threshold met
 *   POST /api/algo-trading/order        — place a manual order via SDK
 *   GET  /api/algo-trading/balances     — fetch balances from all exchanges
 *   GET  /api/algo-trading/positions    — fetch open positions
 *   GET  /api/algo-trading/status       — engine + exchange connection status
 *   DELETE /api/algo-trading/order/:id  — cancel an order
 */

import { createExchangeManager } from '../lib/sdk-exchange-connector';
import { createAlgoEngine, AlgoConfig } from '../lib/algo-trading-engine';

interface Env {
  DB: D1Database;
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
  JWT_SECRET: string;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

function getManager(env: Env) {
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
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { headers: cors });

  // Auth check
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return err('Unauthorized', 401);
  }

  try {
    // ── GET /api/algo-trading/status ────────────────────────────────────────
    if (method === 'GET' && path.includes('/status')) {
      const manager = getManager(env);
      const exchanges = manager.getConnectedExchanges();
      return json({
        success: true,
        connectedExchanges: exchanges,
        exchangeCount: exchanges.length,
        strategies: ['momentum', 'rsi_reversion', 'macd_crossover', 'breakout', 'dual_ma', 'scalping'],
        sdks: { ccxt: '4.5.38', alpaca: '3.1.x' },
        timestamp: new Date().toISOString(),
      });
    }

    // ── GET /api/algo-trading/balances ───────────────────────────────────────
    if (method === 'GET' && path.includes('/balances')) {
      const manager = getManager(env);
      const balances = await manager.getAllBalances();
      return json({ success: true, balances });
    }

    // ── GET /api/algo-trading/positions ──────────────────────────────────────
    if (method === 'GET' && path.includes('/positions')) {
      const manager = getManager(env);
      const positions = await manager.getAllPositions();
      return json({ success: true, positions, count: positions.length });
    }

    // ── POST /api/algo-trading/signal ────────────────────────────────────────
    if (method === 'POST' && path.includes('/signal')) {
      const body = await request.json() as Partial<AlgoConfig>;

      if (!body.exchange || !body.symbol || !body.strategy) {
        return err('Required: exchange, symbol, strategy');
      }

      const config: AlgoConfig = {
        exchange: body.exchange,
        symbol: body.symbol,
        strategy: body.strategy as AlgoConfig['strategy'],
        timeframe: body.timeframe ?? '1h',
        capitalUSDT: body.capitalUSDT ?? 100,
        maxOpenTrades: body.maxOpenTrades ?? 3,
        stopLossPct: body.stopLossPct ?? 0.02,
        takeProfitPct: body.takeProfitPct ?? 0.04,
        paperMode: true, // signal-only always paper
        params: body.params,
      };

      const manager = getManager(env);
      const engine = createAlgoEngine(manager, config);
      const signal = await engine.computeSignal(config);

      return json({ success: true, config, signal });
    }

    // ── POST /api/algo-trading/run ───────────────────────────────────────────
    if (method === 'POST' && path.includes('/run')) {
      const body = await request.json() as Partial<AlgoConfig>;

      if (!body.exchange || !body.symbol || !body.strategy) {
        return err('Required: exchange, symbol, strategy');
      }

      const config: AlgoConfig = {
        exchange: body.exchange,
        symbol: body.symbol,
        strategy: body.strategy as AlgoConfig['strategy'],
        timeframe: body.timeframe ?? '1h',
        capitalUSDT: body.capitalUSDT ?? 100,
        maxOpenTrades: body.maxOpenTrades ?? 3,
        stopLossPct: body.stopLossPct ?? 0.02,
        takeProfitPct: body.takeProfitPct ?? 0.04,
        paperMode: body.paperMode !== false, // default paper=true
        params: body.params,
      };

      const manager = getManager(env);
      const engine = createAlgoEngine(manager, config);
      const result = await engine.runCycle(config);

      // Log trade to D1 if executed
      if (result.orderResult?.success && env.DB) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO trades
           (id, user_id, symbol, side, type, quantity, entry_price, exchange, strategy,
            status, enhanced_by_ai, ai_confidence, opened_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).bind(
          result.orderResult.orderId,
          'system',
          config.symbol,
          result.signal,
          'market',
          result.orderResult.amount,
          result.orderResult.averagePrice,
          config.exchange,
          config.strategy,
          result.paperTrade ? 'paper' : result.orderResult.status,
          result.confidence,
          result.timestamp
        ).run().catch(console.warn);
      }

      return json({ success: true, config, result });
    }

    // ── POST /api/algo-trading/order ─────────────────────────────────────────
    if (method === 'POST' && path.includes('/order') && !path.includes('/cancel')) {
      const body = await request.json() as any;

      if (!body.exchange || !body.symbol || !body.side || !body.type || !body.amount) {
        return err('Required: exchange, symbol, side, type, amount');
      }

      const manager = getManager(env);
      const result = await manager.placeOrder({
        exchange: body.exchange,
        symbol: body.symbol,
        side: body.side,
        type: body.type,
        amount: parseFloat(body.amount),
        price: body.price ? parseFloat(body.price) : undefined,
        stopPrice: body.stopPrice ? parseFloat(body.stopPrice) : undefined,
        stopLossPrice: body.stopLossPrice ? parseFloat(body.stopLossPrice) : undefined,
        takeProfitPrice: body.takeProfitPrice ? parseFloat(body.takeProfitPrice) : undefined,
        timeInForce: body.timeInForce,
        clientOrderId: body.clientOrderId,
      });

      return json({ success: result.success, order: result });
    }

    // ── DELETE /api/algo-trading/order ───────────────────────────────────────
    if (method === 'DELETE' && path.includes('/order')) {
      const body = await request.json() as any;
      if (!body.exchange || !body.orderId || !body.symbol) {
        return err('Required: exchange, orderId, symbol');
      }

      const manager = getManager(env);
      const cancelled = await manager.cancelOrder(body.exchange, body.orderId, body.symbol);
      return json({ success: cancelled, orderId: body.orderId });
    }

    // ── GET /api/algo-trading/ticker ─────────────────────────────────────────
    if (method === 'GET' && path.includes('/ticker')) {
      const exchange = url.searchParams.get('exchange') ?? 'binance';
      const symbol = url.searchParams.get('symbol') ?? 'BTC/USDT';

      const manager = getManager(env);
      const ticker = await manager.getTicker(exchange, symbol);
      return json({ success: true, ticker });
    }

    // ── GET /api/algo-trading/ohlcv ──────────────────────────────────────────
    if (method === 'GET' && path.includes('/ohlcv')) {
      const exchange = url.searchParams.get('exchange') ?? 'binance';
      const symbol = url.searchParams.get('symbol') ?? 'BTC/USDT';
      const timeframe = url.searchParams.get('timeframe') ?? '1h';
      const limit = parseInt(url.searchParams.get('limit') ?? '100');

      const manager = getManager(env);
      const candles = await manager.getOHLCV(exchange, symbol, timeframe, limit);
      return json({ success: true, candles, count: candles.length });
    }

    return err('Endpoint not found', 404);

  } catch (e: any) {
    console.error('Algo trading error:', e);
    return err(e.message ?? 'Internal server error', 500);
  }
};
