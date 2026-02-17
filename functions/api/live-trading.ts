/**
 * Live Trading API Endpoint for Cloudflare Workers
 * Handles real-time trading execution with risk management
 */
import { TradingSystem } from '../lib/trading-system';

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
  BINANCE_API_KEY: string;
  BINANCE_SECRET_KEY: string;
  COINGECKO_API_KEY: string;
  JWT_SECRET: string;
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

    // Execute trade based on exchange
    let executionResult;
    switch (bot.exchange) {
      case 'binance':
        executionResult = await executeBinanceTrade(env, {
          symbol,
          side,
          amount,
          orderType
        });
        break;
      case 'coinbase':
        executionResult = await executeCoinbaseTrade(env, {
          symbol,
          side,
          amount,
          orderType
        });
        break;
      default:
        return jsonResponse({
          error: 'Unsupported exchange',
          exchange: bot.exchange
        }, corsHeaders, 400);
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
async function checkRiskLimits(env: Env, userId: string, amount: number) {
  // Simplified risk check - implement full logic
  const MAX_POSITION_SIZE = 10000; // $10k max per trade

  if (amount > MAX_POSITION_SIZE) {
    return {
      passed: false,
      reason: `Position size exceeds maximum of $${MAX_POSITION_SIZE}`
    };
  }

  return { passed: true };
}

async function executeBinanceTrade(env: Env, params: any) {
  // Implement Binance API integration
  // This is a placeholder - add actual Binance API calls
  return {
    success: true,
    orderId: `binance_${Date.now()}`,
    price: 50000,
    quantity: params.amount
  };
}

async function executeCoinbaseTrade(env: Env, params: any) {
  // Implement Coinbase API integration
  return {
    success: true,
    orderId: `coinbase_${Date.now()}`,
    price: 50000,
    quantity: params.amount
  };
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
  // Fetch historical data for analysis
  // This is a placeholder
  return {
    price: 50000,
    volume: 1000000,
    volatility: 0.02,
    rsi: 55,
    macd: { value: 100, signal: 95, histogram: 5 },
    momentum: 0.015
  };
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
