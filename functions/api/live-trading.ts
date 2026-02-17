/**
 * Live Trading API Endpoint for Cloudflare Workers
 * Handles real-time trading execution with risk management
 */
import { TradingSystem } from '../lib/trading-system';
import { createExchangeManager } from '../lib/sdk-exchange-connector';
import { createForexManager } from '../lib/forex-connector';

const FOREX_EXCHANGES = new Set(['oanda', 'exness']);

// Store active trading systems per user
const tradingSystems = new Map<string, TradingSystem>();

function getTradingSystem(userId: string, initialCapital?: number): TradingSystem {
  if (!tradingSystems.has(userId)) {
    tradingSystems.set(userId, new TradingSystem(userId, initialCapital));
  }
  return tradingSystems.get(userId)!;
}

// Add new endpoint handler
async function handleAIEnhancedTrading(
  request: Request,
  env: Env,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const data = await request.json() as any;
    const { symbol, signal, confidence, amount, marketData } = data;

    const system = getTradingSystem(userId, 10000);

    const result = await system.executeTrade({
      symbol,
      baseSignal: signal,
      baseConfidence: confidence,
      amount,
      marketData
    });

    return jsonResponse({ success: true, ...result }, corsHeaders);
  } catch (error: any) {
    return jsonResponse({
      success: false,
      error: error.message
    }, corsHeaders, 500);
  }
}

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  COINGECKO_API_KEY: string;
  // Binance
  BINANCE_API_KEY: string;
  BINANCE_SECRET_KEY: string;
  // Kraken
  KRAKEN_API_KEY: string;
  KRAKEN_PRIVATE_KEY: string;
  // Bybit
  BYBIT_API_KEY: string;
  BYBIT_API_SECRET: string;
  // KuCoin
  KUCOIN_KEY: string;
  KUCOIN_SECRET: string;
  KUCOIN_PASSPHRASE: string;
  // Alpaca
  ALPACA_API_KEY: string;
  ALPACA_SECRET_KEY: string;
  ALPACA_PAPER: string;
  // Coinbase Advanced Trade
  COINBASE_API_KEY: string;
  COINBASE_SECRET_KEY: string;
  // OKX
  OKX_API_KEY: string;
  OKX_SECRET_KEY: string;
  OKX_PASSPHRASE: string;
  // Gate.io
  GATEIO_API_KEY: string;
  GATEIO_SECRET_KEY: string;
  // MEXC
  MEXC_API_KEY: string;
  MEXC_SECRET_KEY: string;
  // Bitget
  BITGET_API_KEY: string;
  BITGET_SECRET_KEY: string;
  BITGET_PASSPHRASE: string;
  // Bitfinex
  BITFINEX_API_KEY: string;
  BITFINEX_SECRET_KEY: string;
  // Gemini
  GEMINI_API_KEY: string;
  GEMINI_SECRET_KEY: string;
  // Forex brokers
  OANDA_API_KEY: string;
  OANDA_ACCOUNT_ID: string;
  OANDA_PRACTICE: string;
  EXNESS_API_KEY: string;
  EXNESS_ACCOUNT_LOGIN: string;
  // Market data
  ALPHA_VANTAGE_API_KEY: string;
  FINNHUB_API_KEY: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate request
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, corsHeaders, 401);
    }

    const token = authHeader.substring(7);
    // Verify JWT (simplified - use proper library in production)
    const [, payload] = token.split('.');
    const userData = JSON.parse(atob(payload));

    // Route to appropriate handler
    if (path.includes('/api/live-trading/execute')) {
      return await handleTradeExecution(request, env, userData.userId, corsHeaders);
    }

    if (path.includes('/api/live-trading/market-data')) {
      return await handleMarketData(request, env, corsHeaders);
    }

    if (path.includes('/api/live-trading/strategy-signal')) {
      return await handleStrategySignal(request, env, userData.userId, corsHeaders);
    }

    if (path.includes('/api/live-trading/bot-status')) {
      return await handleBotStatus(request, env, userData.userId, corsHeaders);
    }

    if (path.includes('/api/live-trading/ai-execute')) {
      return await handleAIEnhancedTrading(request, env, userData.userId, corsHeaders);
    }

    return jsonResponse({ error: 'Endpoint not found' }, corsHeaders, 404);

  } catch (error: any) {
    console.error('Live trading error:', error);
    return jsonResponse({
      error: 'Internal server error',
      message: error.message
    }, corsHeaders, 500);
  }
};

/**
 * Execute live trade
 */
async function handleTradeExecution(
  request: Request,
  env: Env,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const tradeData = await request.json() as any;
    const { botId, symbol, side, amount, orderType } = tradeData;

    // Validate trade data
    if (!symbol || !side || !amount) {
      return jsonResponse({ error: 'Missing required trade parameters' }, corsHeaders, 400);
    }

    // Check risk limits
    const riskCheck = await checkRiskLimits(env, userId, amount);
    if (!riskCheck.passed) {
      return jsonResponse({
        error: 'Risk limit exceeded',
        reason: riskCheck.reason
      }, corsHeaders, 403);
    }

    // Get bot configuration
    const bot = await env.DB.prepare(
      'SELECT * FROM trading_bots WHERE id = ? AND user_id = ?'
    ).bind(botId, userId).first();

    if (!bot) {
      return jsonResponse({ error: 'Bot not found' }, corsHeaders, 404);
    }

    // Execute trade — route to ForexManager for forex brokers
    const botExchange = String(bot.exchange).toLowerCase();
    let executionResult: any;

    if (FOREX_EXCHANGES.has(botExchange)) {
      const fxManager = buildForexManagerFromEnv(env);
      const fxResult = await fxManager.placeOrder(botExchange, {
        symbol,
        side: side as 'buy' | 'sell',
        type: (orderType ?? 'market') as 'market' | 'limit',
        units: parseFloat(String(amount)),
      });
      executionResult = {
        success: fxResult.success,
        orderId: fxResult.orderId,
        price: fxResult.price ?? 0,
        error: fxResult.error,
      };
    } else {
      const manager = buildExchangeManager(env);
      executionResult = await manager.placeOrder({
        exchange: botExchange,
        symbol,
        side: side as 'buy' | 'sell',
        type: (orderType ?? 'market') as 'market' | 'limit',
        amount: parseFloat(String(amount)),
      });
    }

    if (!executionResult.success) {
      return jsonResponse({
        error: 'Trade execution failed',
        details: executionResult.error
      }, corsHeaders, 500);
    }

    // Record trade in database
    const tradeId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO trades (
        id, user_id, bot_id, symbol, side, entry_price,
        quantity, status, opened_at, exchange_order_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).bind(
      tradeId,
      userId,
      botId,
      symbol,
      side,
      executionResult.price,
      amount,
      'open',
      executionResult.orderId
    ).run();

    return jsonResponse({
      success: true,
      tradeId,
      executionDetails: executionResult
    }, corsHeaders);

  } catch (error: any) {
    console.error('Trade execution error:', error);
    return jsonResponse({
      error: 'Trade execution failed',
      message: error.message
    }, corsHeaders, 500);
  }
}

/**
 * Get real-time market data
 */
async function handleMarketData(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const symbols = url.searchParams.get('symbols')?.split(',') || [];

    if (symbols.length === 0) {
      return jsonResponse({ error: 'No symbols provided' }, corsHeaders, 400);
    }

    // Fetch from CoinGecko
    const marketData = await fetchCoinGeckoData(env, symbols);

    return jsonResponse({
      success: true,
      data: marketData,
      timestamp: new Date().toISOString()
    }, corsHeaders);

  } catch (error: any) {
    console.error('Market data error:', error);
    return jsonResponse({
      error: 'Failed to fetch market data',
      message: error.message
    }, corsHeaders, 500);
  }
}

/**
 * Get trading strategy signal
 */
async function handleStrategySignal(
  request: Request,
  env: Env,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const { symbol, strategy, timeframe } = await request.json() as any;

    // Get market data
    const marketData = await fetchMarketDataForAnalysis(env, symbol, timeframe);

    // Generate signal based on strategy
    const signal = await generateStrategySignal(strategy, marketData);

    return jsonResponse({
      success: true,
      symbol,
      strategy,
      signal: {
        action: signal.action, // 'buy', 'sell', 'hold'
        confidence: signal.confidence,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        reasoning: signal.reasoning
      },
      timestamp: new Date().toISOString()
    }, corsHeaders);

  } catch (error: any) {
    console.error('Strategy signal error:', error);
    return jsonResponse({
      error: 'Failed to generate signal',
      message: error.message
    }, corsHeaders, 500);
  }
}

/**
 * Get bot status and performance
 */
async function handleBotStatus(
  request: Request,
  env: Env,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');

    if (!botId) {
      // Get all bots
      const bots = await env.DB.prepare(`
        SELECT b.*,
          COUNT(t.id) as trade_count,
          SUM(CASE WHEN t.pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
          SUM(t.pnl) as total_pnl
        FROM trading_bots b
        LEFT JOIN trades t ON b.id = t.bot_id
        WHERE b.user_id = ?
        GROUP BY b.id
      `).bind(userId).all();

      return jsonResponse({
        success: true,
        bots: bots.results
      }, corsHeaders);
    }

    // Get specific bot with detailed stats
    const bot = await env.DB.prepare(`
      SELECT * FROM trading_bots WHERE id = ? AND user_id = ?
    `).bind(botId, userId).first();

    if (!bot) {
      return jsonResponse({ error: 'Bot not found' }, corsHeaders, 404);
    }

    const trades = await env.DB.prepare(`
      SELECT * FROM trades WHERE bot_id = ? ORDER BY opened_at DESC LIMIT 100
    `).bind(botId).all();

    const stats = calculateBotStats(trades.results);

    return jsonResponse({
      success: true,
      bot,
      stats,
      recentTrades: trades.results.slice(0, 10)
    }, corsHeaders);

  } catch (error: any) {
    console.error('Bot status error:', error);
    return jsonResponse({
      error: 'Failed to get bot status',
      message: error.message
    }, corsHeaders, 500);
  }
}

// Helper functions

function buildExchangeManager(env: Env) {
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

function buildForexManagerFromEnv(env: Env) {
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

async function checkRiskLimits(env: Env, userId: string, amount: number) {
  const MAX_POSITION_SIZE = 10000; // $10k max per trade
  if (amount > MAX_POSITION_SIZE) {
    return {
      passed: false,
      reason: `Position size exceeds maximum of $${MAX_POSITION_SIZE}`
    };
  }
  return { passed: true };
}

async function fetchCoinGeckoData(env: Env, symbols: string[]) {
  const coinIds = symbols.map(s => s.toLowerCase().replace('/usd', ''));
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(',')}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;

  const response = await fetch(url, {
    headers: env.COINGECKO_API_KEY ? {
      'X-Cg-Pro-Api-Key': env.COINGECKO_API_KEY
    } : {}
  });

  return await response.json();
}

async function fetchMarketDataForAnalysis(env: Env, symbol: string, timeframe: string) {
  // Try to get real market data based on symbol type
  const symUpper = symbol.toUpperCase();

  // Forex / commodity / index symbols — use ForexManager
  const forexSymbols = ['EUR', 'GBP', 'USD', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD',
                        'XAU', 'XAG', 'XPT', 'WTICO', 'BCO', 'NATGAS',
                        'US30', 'SPX500', 'NAS100', 'UK100', 'DE30', 'JP225'];
  const isForex = forexSymbols.some(fx => symUpper.startsWith(fx));

  if (isForex) {
    try {
      const fxManager = buildForexManagerFromEnv(env);
      const quote = await fxManager.getQuote(symbol).catch(() => null);
      const price = quote?.mid ?? 2000;
      const candles = await fxManager.getCandles(symbol, 'H1', 50).catch(() => []);

      // Simple RSI/momentum from candles if available
      let rsi = 50, momentum = 0;
      if (candles.length >= 14) {
        const closes = candles.map((c: any) => c.close);
        let gains = 0, losses = 0;
        for (let i = closes.length - 14; i < closes.length; i++) {
          const diff = closes[i] - closes[i - 1];
          if (diff > 0) gains += diff; else losses -= diff;
        }
        const avgGain = gains / 14, avgLoss = losses / 14;
        rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        momentum = closes.length > 10 ? (closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10] : 0;
      }

      return { price, volume: 50000, volatility: 0.008, rsi, macd: { value: 0, signal: 0, histogram: 0 }, momentum };
    } catch {
      return { price: 2000, volume: 50000, volatility: 0.008, rsi: 50, macd: { value: 0, signal: 0, histogram: 0 }, momentum: 0 };
    }
  }

  // Crypto — try CoinGecko
  try {
    const coinId = symUpper.split('/')[0].toLowerCase()
      .replace('btc', 'bitcoin').replace('eth', 'ethereum')
      .replace('sol', 'solana').replace('bnb', 'binancecoin');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
    const resp = await fetch(url, {
      headers: env.COINGECKO_API_KEY ? { 'X-Cg-Pro-Api-Key': env.COINGECKO_API_KEY } : {}
    });
    const data: any = await resp.json();
    const coinData = data[coinId];
    const price = coinData?.usd ?? 50000;
    const momentum = (coinData?.usd_24h_change ?? 0) / 100;
    return { price, volume: 1000000, volatility: 0.02, rsi: 55, macd: { value: 100, signal: 95, histogram: 5 }, momentum };
  } catch {
    return { price: 50000, volume: 1000000, volatility: 0.02, rsi: 55, macd: { value: 100, signal: 95, histogram: 5 }, momentum: 0.015 };
  }
}

async function generateStrategySignal(strategy: string, marketData: any) {
  // Generate trading signal based on strategy
  // This is a simplified version
  const { price, rsi, momentum } = marketData;

  if (strategy === 'ensemble') {
    // Ensemble strategy logic
    if (rsi < 30 && momentum > 0.01) {
      return {
        action: 'buy',
        confidence: 0.75,
        entryPrice: price,
        stopLoss: price * 0.98,
        takeProfit: price * 1.05,
        reasoning: 'RSI oversold with positive momentum'
      };
    }
  }

  return {
    action: 'hold',
    confidence: 0.5,
    entryPrice: price,
    stopLoss: null,
    takeProfit: null,
    reasoning: 'No strong signal detected'
  };
}

function calculateBotStats(trades: any[]) {
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => (t.pnl || 0) > 0).length;
  const losingTrades = totalTrades - winningTrades;
  const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    totalPnL,
    winRate: winRate.toFixed(2),
    averagePnL: totalTrades > 0 ? totalPnL / totalTrades : 0
  };
}

function jsonResponse(data: any, headers: Record<string, string> = {}, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}
