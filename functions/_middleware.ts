/**
 * XQ Trade M8 - Main Cloudflare Worker
 * Handles all API requests and trading logic
 */

import { CoinGeckoService, symbolToCoinId } from './lib/coingecko-service';

// Environment interface
interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  TRADES: KVNamespace;
  STORAGE: R2Bucket;
  TRADING_ENGINE: DurableObjectNamespace;
  MARKET_DATA: DurableObjectNamespace;
  
  // Secrets
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  JWT_SECRET: string;
  COINGECKO_API_KEY: string;
}

// Pages Functions middleware export
export async function onRequest(context: any): Promise<Response> {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Health check (check before other API routes)
    if (path === '/health' || path === '/api/health') {
      return jsonResponse({
        status: 'healthy',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      }, corsHeaders);
    }

    // Route API requests
    if (path.startsWith('/api/')) {
      const response = await handleApiRequest(request, env, path);
      return addCorsHeaders(response, corsHeaders);
    }

    // Pass through to static assets
    return next();

  } catch (error: any) {
    console.error('Worker error:', error);
    return jsonResponse({
      error: 'Internal server error',
      message: error.message
    }, corsHeaders, 500);
  }
}

/**
 * Handle API requests
 */
async function handleApiRequest(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method;
  const segments = path.split('/').filter(Boolean);
  const endpoint = segments[1]; // After '/api/'

  // Authentication middleware
  const auth = await authenticate(request, env);
  
  // Public endpoints
  const publicEndpoints = ['auth', 'health', 'market', 'market-analysis', 'trading-signals', 'opportunities'];
  const requiresAuth = !publicEndpoints.includes(endpoint);
  
  if (requiresAuth && !auth.valid) {
    return jsonResponse({ error: 'Unauthorized' }, {}, 401);
  }

  // Route to appropriate handler
  switch (endpoint) {
    case 'auth':
      return handleAuth(request, env);
    
    case 'bots':
      return handleBots(request, env, auth.userId);
    
    case 'trades':
      return handleTrades(request, env, auth.userId);
    
    case 'portfolio':
      return handlePortfolio(request, env, auth.userId);
    
    case 'market':
      return handleMarketData(request, env);
    
    case 'analytics':
      return handleAnalytics(request, env, auth.userId);

    case 'market-analysis':
      return handleMarketAnalysis(request, env);

    case 'trading-signals':
      return handleTradingSignals(request, env);

    case 'opportunities':
      return handleTradingOpportunities(request, env);

    default:
      return jsonResponse({ error: 'Endpoint not found' }, {}, 404);
  }
}

/**
 * Authentication handler
 */
async function handleAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.split('/').pop();

  if (action === 'login' && request.method === 'POST') {
    const { email, password } = await request.json();
    
    // Verify credentials
    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE email = ? AND status = ?'
    ).bind(email, 'active').first();

    if (!user) {
      return jsonResponse({ error: 'Invalid credentials' }, {}, 401);
    }

    // In production, verify password hash properly
    // For demo, we'll accept any password
    
    // Generate JWT token
    const token = await generateJWT({ userId: user.id, email: user.email }, env.JWT_SECRET);
    
    // Store session
    await env.SESSIONS.put(`session:${user.id}`, token, { expirationTtl: 86400 });

    return jsonResponse({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.role
      }
    });
  }

  if (action === 'register' && request.method === 'POST') {
    const { email, password, fullName } = await request.json();
    
    // Create user
    const userId = crypto.randomUUID();
    
    await env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)'
    ).bind(userId, email, 'hashed_password', fullName).run();

    return jsonResponse({ success: true, userId });
  }

  return jsonResponse({ error: 'Invalid auth action' }, {}, 400);
}

/**
 * Trading bots handler
 */
async function handleBots(request: Request, env: Env, userId: string): Promise<Response> {
  if (request.method === 'GET') {
    // List user's bots
    const bots = await env.DB.prepare(
      'SELECT * FROM trading_bots WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(userId).all();

    return jsonResponse({ bots: bots.results });
  }

  if (request.method === 'POST') {
    // Create new bot
    const { name, strategy, symbol, exchange } = await request.json();
    const botId = crypto.randomUUID();
    
    await env.DB.prepare(
      'INSERT INTO trading_bots (id, user_id, name, strategy, symbol, exchange) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(botId, userId, name, strategy, symbol, exchange).run();

    return jsonResponse({ success: true, botId });
  }

  return jsonResponse({ error: 'Method not allowed' }, {}, 405);
}

/**
 * Trades handler
 */
async function handleTrades(request: Request, env: Env, userId: string): Promise<Response> {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '100');
    
    const trades = await env.DB.prepare(
      'SELECT * FROM trades WHERE user_id = ? ORDER BY opened_at DESC LIMIT ?'
    ).bind(userId, limit).all();

    return jsonResponse({ trades: trades.results });
  }

  return jsonResponse({ error: 'Method not allowed' }, {}, 405);
}

/**
 * Portfolio handler
 */
async function handlePortfolio(request: Request, env: Env, userId: string): Promise<Response> {
  // Get latest portfolio snapshot
  const portfolio = await env.DB.prepare(
    'SELECT * FROM portfolio_snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(userId).first();

  // Get active trades
  const activeTrades = await env.DB.prepare(
    'SELECT COUNT(*) as count, SUM(pnl) as total_pnl FROM trades WHERE user_id = ? AND status = ?'
  ).bind(userId, 'open').first();

  return jsonResponse({
    portfolio,
    activeTrades: activeTrades.count,
    unrealizedPnL: activeTrades.total_pnl || 0
  });
}

/**
 * Market data handler
 */
async function handleMarketData(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const symbols = url.searchParams.get('symbols')?.split(',') || [];
  
  // Get cached market data
  const marketData = await env.DB.prepare(
    `SELECT * FROM market_data WHERE symbol IN (${symbols.map(() => '?').join(',')}) 
     AND updated_at > strftime('%s', 'now', '-5 minutes')`
  ).bind(...symbols).all();

  return jsonResponse({ marketData: marketData.results });
}

/**
 * Analytics handler
 */
async function handleAnalytics(request: Request, env: Env, userId: string): Promise<Response> {
  // Get performance metrics
  const metrics = await env.DB.prepare(
    'SELECT * FROM performance_metrics WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(userId).all();

  // Get daily performance
  const dailyPerf = await env.DB.prepare(
    'SELECT * FROM daily_performance WHERE user_id = ? ORDER BY trade_date DESC LIMIT 30'
  ).bind(userId).all();

  return jsonResponse({
    metrics: metrics.results,
    dailyPerformance: dailyPerf.results
  });
}

/**
 * Market analysis handler (CoinGecko enhanced)
 */
async function handleMarketAnalysis(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const coinId = url.searchParams.get('coinId');
  const days = parseInt(url.searchParams.get('days') || '14');

  if (!coinId) {
    return jsonResponse({ error: 'coinId parameter required' }, {}, 400);
  }

  try {
    const service = new CoinGeckoService(env.COINGECKO_API_KEY);
    const analysis = await service.analyzeMarket(coinId, days);

    if (!analysis) {
      return jsonResponse({ error: 'Analysis failed - coin not found' }, {}, 404);
    }

    // Cache the result
    await env.CACHE.put(
      `market-analysis:${coinId}`,
      JSON.stringify(analysis),
      { expirationTtl: 300 } // 5 minutes
    );

    return jsonResponse({
      success: true,
      analysis,
      timestamp: Date.now()
    });
  } catch (error: any) {
    console.error('Market analysis error:', error);
    return jsonResponse({
      error: 'Failed to analyze market',
      message: error.message
    }, {}, 500);
  }
}

/**
 * Trading signals handler - Multi-coin analysis
 */
async function handleTradingSignals(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const coinsParam = url.searchParams.get('coins') || 'bitcoin,ethereum,cardano';
  const coinIds = coinsParam.split(',').map(id => id.trim());

  try {
    const service = new CoinGeckoService(env.COINGECKO_API_KEY);
    const signals = await service.getMultiCoinAnalysis(coinIds);

    // Convert Map to object for JSON response
    const signalsObject: Record<string, any> = {};
    signals.forEach((signal, coinId) => {
      signalsObject[coinId] = signal;
    });

    // Cache the result
    await env.CACHE.put(
      `trading-signals:${coinsParam}`,
      JSON.stringify(signalsObject),
      { expirationTtl: 300 } // 5 minutes
    );

    return jsonResponse({
      success: true,
      signals: signalsObject,
      timestamp: Date.now()
    });
  } catch (error: any) {
    console.error('Trading signals error:', error);
    return jsonResponse({
      error: 'Failed to generate trading signals',
      message: error.message
    }, {}, 500);
  }
}

/**
 * Trading opportunities handler - Find best opportunities
 */
async function handleTradingOpportunities(request: Request, env: Env): Promise<Response> {
  try {
    // Check cache first
    const cached = await env.CACHE.get('trading-opportunities');
    if (cached) {
      return jsonResponse({
        success: true,
        ...JSON.parse(cached),
        fromCache: true
      });
    }

    const service = new CoinGeckoService(env.COINGECKO_API_KEY);
    const opportunities = await service.findTradingOpportunities();

    // Cache for 10 minutes
    await env.CACHE.put(
      'trading-opportunities',
      JSON.stringify(opportunities),
      { expirationTtl: 600 }
    );

    return jsonResponse({
      success: true,
      ...opportunities,
      timestamp: Date.now()
    });
  } catch (error: any) {
    console.error('Trading opportunities error:', error);
    return jsonResponse({
      error: 'Failed to find trading opportunities',
      message: error.message
    }, {}, 500);
  }
}

/**
 * Authenticate request
 */
async function authenticate(request: Request, env: Env): Promise<{ valid: boolean; userId?: string }> {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false };
  }

  const token = authHeader.substring(7);

  try {
    const payload = await verifyJWT(token, env.JWT_SECRET);
    return { valid: true, userId: payload.userId };
  } catch {
    return { valid: false };
  }
}

/**
 * Update market data (scheduled task)
 */
async function updateMarketData(env: Env): Promise<void> {
  console.log('Updating market data...');
  
  // Fetch from CoinGecko
  const symbols = ['bitcoin', 'ethereum', 'cardano'];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${symbols.join(',')}&vs_currencies=usd&include_24hr_change=true`;
  
  const response = await fetch(url, {
    headers: { 'X-Cg-Pro-Api-Key': env.COINGECKO_API_KEY }
  });
  
  const data = await response.json();
  
  // Update database
  for (const [symbol, info] of Object.entries(data)) {
    await env.DB.prepare(
      'INSERT OR REPLACE INTO market_data (id, symbol, exchange, price, change_24h, updated_at) VALUES (?, ?, ?, ?, ?, strftime(\'%s\', \'now\'))'
    ).bind(
      `${symbol}-coingecko`,
      symbol.toUpperCase(),
      'coingecko',
      info.usd,
      info.usd_24h_change
    ).run();
  }
  
  console.log('Market data updated');
}

/**
 * Check trading bots (scheduled task)
 */
async function checkTradingBots(env: Env): Promise<void> {
  console.log('Checking trading bots...');
  
  const bots = await env.DB.prepare(
    'SELECT * FROM trading_bots WHERE status = ?'
  ).bind('running').all();
  
  console.log(`Found ${bots.results.length} running bots`);
  
  // Process each bot (would execute trading logic here)
  // For now, just log
}

/**
 * Helper functions
 */
function jsonResponse(data: any, headers: Record<string, string> = {}, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

function addCorsHeaders(response: Response, corsHeaders: Record<string, string>): Response {
  const newResponse = new Response(response.body, response);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    newResponse.headers.set(key, value);
  });
  return newResponse;
}

async function generateJWT(payload: any, secret: string): Promise<string> {
  // Simple JWT generation (use proper library in production)
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 86400000 }));
  return `${header}.${body}.signature`;
}

async function verifyJWT(token: string, secret: string): Promise<any> {
  // Simple JWT verification (use proper library in production)
  const [, body] = token.split('.');
  return JSON.parse(atob(body));
}
