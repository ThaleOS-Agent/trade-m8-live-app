/**
 * XQ Trade M8 - Main Cloudflare Worker
 * Handles all API requests and trading logic
 */

import { CoinGeckoService } from './lib/coingecko-service';

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

  // CORS and Security headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // Security Headers
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Run DB migrations (idempotent — safe to call on every request, cheap after first run)
    await runMigrations(env).catch(console.error);

    // Health check (check before other API routes)
    if (path === '/health' || path === '/api/health') {
      return jsonResponse({
        status: 'healthy',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      }, corsHeaders);
    }

    // Route API requests — pass specialized handlers to their dedicated Pages Functions
    if (
      path.startsWith('/api/algo-trading') ||
      path.startsWith('/api/live-trading') ||
      path.startsWith('/api/forex') ||
      path.startsWith('/api/tradingview') ||
      path.startsWith('/api/ai') ||
      path.startsWith('/api/backtest') ||
      path.startsWith('/api/portfolio') ||
      path.startsWith('/api/prices')
    ) {
      return next();
    }

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
      return handleBots(request, env, auth.userId!);

    case 'trades':
      return handleTrades(request, env, auth.userId!);

    case 'portfolio':
      return handlePortfolio(request, env, auth.userId!);

    case 'market':
      return handleMarketData(request, env);

    case 'analytics':
      return handleAnalytics(request, env, auth.userId!);

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
    const { email, password } = await request.json() as any;

    if (!email || !password) {
      return jsonResponse({ error: 'Email and password required' }, {}, 400);
    }

    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE email = ?'
    ).bind(email).first() as any;

    if (!user) {
      return jsonResponse({ error: 'Invalid credentials' }, {}, 401);
    }

    // Verify password with PBKDF2
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return jsonResponse({ error: 'Invalid credentials' }, {}, 401);
    }

    // Update last login
    await env.DB.prepare(
      'UPDATE users SET last_login = datetime(\'now\') WHERE id = ?'
    ).bind(user.id).run().catch(() => {});

    const token = await generateJWT({ userId: user.id, email: user.email }, env.JWT_SECRET);
    await env.SESSIONS.put(`session:${user.id}`, token, { expirationTtl: 86400 });

    return jsonResponse({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name || user.name,
        role: user.role || 'user'
      }
    });
  }

  if (action === 'register' && request.method === 'POST') {
    const { email, password, fullName } = await request.json() as any;

    if (!email || !password || !fullName) {
      return jsonResponse({ error: 'Email, password and name required' }, {}, 400);
    }

    // Check if user already exists
    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email).first();

    if (existing) {
      return jsonResponse({ error: 'Email already registered' }, {}, 409);
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    await env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
    ).bind(userId, email, passwordHash, fullName).run();

    // Return token immediately so user is logged in after registration
    const token = await generateJWT({ userId, email }, env.JWT_SECRET);
    await env.SESSIONS.put(`session:${userId}`, token, { expirationTtl: 86400 });

    return jsonResponse({
      success: true,
      token,
      user: { id: userId, email, name: fullName, role: 'user' }
    });
  }

  if (action === 'logout' && request.method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.valid && auth.userId) {
      await env.SESSIONS.delete(`session:${auth.userId}`).catch(() => {});
    }
    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: 'Invalid auth action' }, {}, 400);
}

/**
 * Trading bots handler
 */
async function handleBots(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean); // ['api','bots',<id>?,<action>?]
  const botId = segments[2];
  const action = segments[3]; // 'start' | 'stop' | undefined

  // ── POST /api/bots/:id/start ──────────────────────────────────────────────
  if (request.method === 'POST' && botId && action === 'start') {
    await env.DB.prepare(
      'UPDATE trading_bots SET status = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?'
    ).bind('running', botId, userId).run();
    return jsonResponse({ success: true, botId, status: 'running' });
  }

  // ── POST /api/bots/:id/stop ───────────────────────────────────────────────
  if (request.method === 'POST' && botId && action === 'stop') {
    await env.DB.prepare(
      'UPDATE trading_bots SET status = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?'
    ).bind('stopped', botId, userId).run();
    return jsonResponse({ success: true, botId, status: 'stopped' });
  }

  // ── GET /api/bots ─────────────────────────────────────────────────────────
  if (request.method === 'GET' && !botId) {
    const bots = await env.DB.prepare(
      'SELECT * FROM trading_bots WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(userId).all();
    return jsonResponse({ bots: bots.results });
  }

  // ── GET /api/bots/:id ─────────────────────────────────────────────────────
  if (request.method === 'GET' && botId) {
    const bot = await env.DB.prepare(
      'SELECT * FROM trading_bots WHERE id = ? AND user_id = ?'
    ).bind(botId, userId).first();
    if (!bot) return jsonResponse({ error: 'Bot not found' }, {}, 404);
    const trades = await env.DB.prepare(
      'SELECT * FROM trades WHERE bot_id = ? ORDER BY opened_at DESC LIMIT 20'
    ).bind(botId).all();
    return jsonResponse({ bot, recentTrades: trades.results });
  }

  // ── POST /api/bots ────────────────────────────────────────────────────────
  if (request.method === 'POST' && !botId) {
    const body = await request.json() as any;
    const { name, strategy, symbol, exchange, riskLevel, maxPositionSize } = body;
    if (!name || !strategy || !symbol || !exchange) {
      return jsonResponse({ error: 'name, strategy, symbol, exchange required' }, {}, 400);
    }
    const newBotId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO trading_bots (id, user_id, name, strategy, symbol, exchange, risk_level, position_size, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stopped', datetime('now'), datetime('now'))`
    ).bind(newBotId, userId, name, strategy, symbol, exchange, riskLevel || 'medium', maxPositionSize || 0.10).run();
    return jsonResponse({ success: true, botId: newBotId });
  }

  // ── PUT /api/bots/:id ─────────────────────────────────────────────────────
  if (request.method === 'PUT' && botId) {
    const body = await request.json() as any;
    const fields: string[] = [];
    const values: any[] = [];
    // Support both camelCase (from frontend) and snake_case; map to actual DB columns
    const fieldMap: Record<string, string> = {
      name: 'name',
      strategy: 'strategy',
      symbol: 'symbol',
      exchange: 'exchange',
      status: 'status',
      config: 'config',
      risk_level: 'risk_level',
      riskLevel: 'risk_level',
      max_position_size: 'position_size',
      maxPositionSize: 'position_size',
      position_size: 'position_size',
      run_interval_minutes: 'run_interval_minutes',
      runIntervalMinutes: 'run_interval_minutes',
    };
    for (const [inputKey, dbCol] of Object.entries(fieldMap)) {
      if (body[inputKey] !== undefined) {
        // Only add each DB column once
        if (!fields.includes(`${dbCol} = ?`)) {
          fields.push(`${dbCol} = ?`);
          values.push(body[inputKey]);
        }
      }
    }
    if (fields.length === 0) return jsonResponse({ error: 'No valid fields to update' }, {}, 400);
    values.push(botId, userId);
    await env.DB.prepare(
      `UPDATE trading_bots SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
    ).bind(...values).run();
    return jsonResponse({ success: true });
  }

  // ── DELETE /api/bots/:id ──────────────────────────────────────────────────
  if (request.method === 'DELETE' && botId) {
    await env.DB.prepare(
      'DELETE FROM trading_bots WHERE id = ? AND user_id = ?'
    ).bind(botId, userId).run();
    return jsonResponse({ success: true });
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
async function handlePortfolio(_request: Request, env: Env, userId: string): Promise<Response> {
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
    activeTrades: (activeTrades as any)?.count ?? 0,
    unrealizedPnL: (activeTrades as any)?.total_pnl ?? 0
  });
}

/**
 * Market data handler
 */
async function handleMarketData(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);

  if (symbols.length === 0) {
    return jsonResponse({ marketData: [] });
  }

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
async function handleAnalytics(_request: Request, env: Env, userId: string): Promise<Response> {
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
 * Optimized with cache-first strategy for faster responses
 */
async function handleMarketAnalysis(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const coinId = url.searchParams.get('coinId');
  const days = parseInt(url.searchParams.get('days') || '14');

  if (!coinId) {
    return jsonResponse({ error: 'coinId parameter required' }, {}, 400);
  }

  try {
    // Cache-first strategy: Check cache before API call
    const cacheKey = `market-analysis:${coinId}:${days}`;
    const cached = await env.CACHE.get(cacheKey);

    if (cached) {
      const analysis = JSON.parse(cached);
      return jsonResponse({
        success: true,
        analysis,
        timestamp: Date.now(),
        cached: true
      });
    }

    // Cache miss - fetch from API
    const service = new CoinGeckoService(env.COINGECKO_API_KEY);
    const analysis = await service.analyzeMarket(coinId, days);

    if (!analysis) {
      return jsonResponse({ error: 'Analysis failed - coin not found' }, {}, 404);
    }

    // Cache the result for 5 minutes
    await env.CACHE.put(
      cacheKey,
      JSON.stringify(analysis),
      { expirationTtl: 300 } // 5 minutes
    );

    return jsonResponse({
      success: true,
      analysis,
      timestamp: Date.now(),
      cached: false
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
 * Optimized with cache-first strategy for faster responses
 */
async function handleTradingSignals(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const coinsParam = url.searchParams.get('coins') || 'bitcoin,ethereum,cardano';
  const coinIds = coinsParam.split(',').map(id => id.trim());

  try {
    // Cache-first strategy: Check cache before API call
    const cacheKey = `trading-signals:${coinsParam}`;
    const cached = await env.CACHE.get(cacheKey);

    if (cached) {
      const signalsObject = JSON.parse(cached);
      return jsonResponse({
        success: true,
        signals: signalsObject,
        timestamp: Date.now(),
        cached: true
      });
    }

    // Cache miss - fetch from API
    const service = new CoinGeckoService(env.COINGECKO_API_KEY);
    const signals = await service.getMultiCoinAnalysis(coinIds);

    // Convert Map to object for JSON response
    const signalsObject: Record<string, any> = {};
    signals.forEach((signal, coinId) => {
      signalsObject[coinId] = signal;
    });

    // Cache the result for 5 minutes
    await env.CACHE.put(
      cacheKey,
      JSON.stringify(signalsObject),
      { expirationTtl: 300 } // 5 minutes
    );

    return jsonResponse({
      success: true,
      signals: signalsObject,
      timestamp: Date.now(),
      cached: false
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
async function handleTradingOpportunities(_request: Request, env: Env): Promise<Response> {
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
    // Confirm session still exists in KV (catches post-logout token reuse)
    const stored = await env.SESSIONS.get(`session:${payload.userId}`);
    if (!stored) return { valid: false };
    return { valid: true, userId: payload.userId };
  } catch {
    return { valid: false };
  }
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

// ── DB Migrations (idempotent) ────────────────────────────────────────────────

async function runMigrations(env: Env): Promise<void> {
  if (!env.DB) return;
  const migrations = [
    `CREATE TABLE IF NOT EXISTS daily_performance (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL,
      bot_id TEXT,
      trade_date TEXT NOT NULL,
      trades_count INTEGER DEFAULT 0,
      winning_trades INTEGER DEFAULT 0,
      losing_trades INTEGER DEFAULT 0,
      gross_pnl REAL DEFAULT 0,
      net_pnl REAL DEFAULT 0,
      win_rate REAL DEFAULT 0,
      roi_percent REAL DEFAULT 0,
      max_drawdown REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS risk_assessments (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL,
      bot_id TEXT,
      assessment_type TEXT NOT NULL,
      symbol TEXT,
      risk_score REAL NOT NULL,
      risk_level TEXT NOT NULL,
      approved INTEGER NOT NULL,
      var_1d REAL,
      var_5d REAL,
      expected_shortfall REAL,
      warnings TEXT,
      blockers TEXT,
      recommendations TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS performance_metrics (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL,
      bot_id TEXT,
      metric_name TEXT NOT NULL,
      metric_value REAL NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      full_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME,
      email_verified INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      role TEXT DEFAULT 'user'
    )`,
    `CREATE TABLE IF NOT EXISTS trading_bots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      strategy TEXT NOT NULL,
      symbol TEXT,
      exchange TEXT NOT NULL,
      status TEXT DEFAULT 'stopped',
      risk_level TEXT DEFAULT 'medium',
      position_size REAL DEFAULT 0.10,
      max_daily_loss REAL DEFAULT 0,
      config TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      stopped_at DATETIME,
      last_run_at DATETIME,
      last_signal TEXT DEFAULT 'hold',
      last_error TEXT,
      run_interval_minutes INTEGER DEFAULT 5,
      last_checked INTEGER
    )`,
    // Backfill new columns for existing installs (errors suppressed if already exists)
    `ALTER TABLE trading_bots ADD COLUMN last_run_at DATETIME`,
    `ALTER TABLE trading_bots ADD COLUMN last_signal TEXT DEFAULT 'hold'`,
    `ALTER TABLE trading_bots ADD COLUMN last_error TEXT`,
    `ALTER TABLE trading_bots ADD COLUMN run_interval_minutes INTEGER DEFAULT 5`,
    `ALTER TABLE trading_bots ADD COLUMN last_checked INTEGER`,
    `CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bot_id TEXT,
      exchange TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      type TEXT DEFAULT 'market',
      quantity REAL,
      entry_price REAL,
      exit_price REAL,
      stop_loss REAL,
      take_profit REAL,
      pnl REAL,
      pnl_percentage REAL,
      fees REAL,
      status TEXT DEFAULT 'open',
      strategy TEXT,
      confidence REAL,
      reasoning TEXT,
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL,
      total_value REAL DEFAULT 0,
      daily_change REAL DEFAULT 0,
      daily_change_percent REAL DEFAULT 0,
      unrealized_pnl REAL DEFAULT 0,
      realized_pnl REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS market_data (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      exchange TEXT DEFAULT 'coingecko',
      price REAL,
      change_24h REAL,
      volume_24h REAL,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_daily_perf_user ON daily_performance(user_id, trade_date)`,
    `CREATE INDEX IF NOT EXISTS idx_perf_metrics_user ON performance_metrics(user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_bots_user ON trading_bots(user_id, status)`,
  ];
  for (const sql of migrations) {
    await env.DB.prepare(sql).run().catch(() => {}); // ignore if already exists
  }
}

// ── Password hashing (PBKDF2 — available in CF Workers) ──────────────────────

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (!stored.startsWith('pbkdf2:')) return false; // reject unknown/legacy hash formats
  const [, saltHex, hashHex] = stored.split(':');
  const enc = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const derived = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return derived === hashHex;
}

function b64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function generateJWT(payload: any, secret: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 }));
  const signingInput = `${header}.${body}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  const sigB64 = b64url(String.fromCharCode(...new Uint8Array(sig)));
  return `${signingInput}.${sigB64}`;
}

async function verifyJWT(token: string, secret: string): Promise<any> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [header, body, sig] = parts;
  const signingInput = `${header}.${body}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(signingInput));
  if (!valid) throw new Error('Invalid token signature');
  const payload = JSON.parse(b64urlDecode(body));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}
