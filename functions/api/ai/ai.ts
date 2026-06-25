/**
 * AI Enhancement Engine — Cloudflare Pages Function
 *
 * Routes:
 *   POST /api/ai/signal     — Full AI analysis: fetch OHLCV, compute indicators, run all AI methods
 *   POST /api/ai/enhance    — Enhance an existing algo signal with AI overlay
 *   GET  /api/ai/sentiment  — Sentiment data for a symbol
 *   GET  /api/ai/status     — Engine health + cache stats
 *
 * All routes require JWT auth except /api/ai/status.
 * Results are cached in KV for 3 minutes (symbol-keyed).
 */

import {
  createAIEnhancementEngine,
  AIMarketAnalysis,
  FusionPrediction,
  EnhancedSignal,
} from '../lib/ai-enhancement-engine';

// ============================================================================
// ENV INTERFACE
// ============================================================================
interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  JWT_SECRET: string;
  COINGECKO_API_KEY: string;
}

// ============================================================================
// CORS + HELPERS
// ============================================================================
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 400): Response {
  return json({ success: false, error: message }, status);
}

// ============================================================================
// JWT AUTH (mirrors _middleware.ts implementation)
// ============================================================================
async function authenticate(request: Request, env: Env): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const signingInput = `${header}.${body}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(
      atob(sig.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(signingInput));
    if (!valid) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.userId as string;
  } catch {
    return null;
  }
}

// ============================================================================
// TECHNICAL INDICATORS (self-contained, no imports from algo-trading-engine)
// ============================================================================
function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const recent = closes.slice(-(period + 1));
  const changes = recent.slice(1).map((v, i) => v - recent[i]);
  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? -c : 0));
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function computeMACD(closes: number[]): { value: number; signal: number; histogram: number } {
  if (closes.length < 26) return { value: 0, signal: 0, histogram: 0 };
  // O(n) streaming EMA — avoids the O(n²) slice-per-step approach
  const k12 = 2 / 13;
  const k26 = 2 / 27;
  const k9  = 2 / 10;

  // Seed with SMA of first N periods
  let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;

  // Advance ema12 from period 12 → 26
  for (let i = 12; i < 26; i++) e12 = closes[i] * k12 + e12 * (1 - k12);

  // Collect MACD values starting at index 26
  const macdVals: number[] = [];
  for (let i = 26; i < closes.length; i++) {
    e12 = closes[i] * k12 + e12 * (1 - k12);
    e26 = closes[i] * k26 + e26 * (1 - k26);
    macdVals.push(e12 - e26);
  }

  const macdLine = macdVals[macdVals.length - 1] ?? 0;

  // Signal: EMA(9) over the MACD series
  let signalLine = 0;
  if (macdVals.length >= 9) {
    signalLine = macdVals.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
    for (let i = 9; i < macdVals.length; i++) {
      signalLine = macdVals[i] * k9 + signalLine * (1 - k9);
    }
  } else if (macdVals.length > 0) {
    signalLine = macdVals.reduce((a, b) => a + b, 0) / macdVals.length;
  }

  return { value: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

function computeVolatility(closes: number[], period = 14): number {
  if (closes.length < 2) return 0;
  const recent = closes.slice(-period);
  const returns = recent.slice(1).map((v, i) => (v - recent[i]) / recent[i]);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance);
}

function computeMomentum(closes: number[], period = 10): number {
  if (closes.length < period + 1) return 0;
  const current = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - period];
  if (!prev) return 0;
  return (current - prev) / prev;
}

// ============================================================================
// COINGECKO OHLCV FETCH
// Maps common tickers to CoinGecko IDs for convenience
// ============================================================================
const TICKER_TO_COINGECKO: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', ADA: 'cardano', SOL: 'solana',
  BNB: 'binancecoin', XRP: 'ripple', DOGE: 'dogecoin', MATIC: 'matic-network',
  DOT: 'polkadot', LINK: 'chainlink', AVAX: 'avalanche-2', ATOM: 'cosmos',
  LTC: 'litecoin', BCH: 'bitcoin-cash', UNI: 'uniswap', AAVE: 'aave',
};

function normalizeCoinId(symbol: string): string {
  const upper = symbol.toUpperCase();
  return TICKER_TO_COINGECKO[upper] ?? symbol.toLowerCase();
}

interface OHLCVPoint {
  timestamp: number;
  close: number;
  volume: number;
}

async function fetchCoinGeckoOHLCV(coinId: string, days: number, apiKey: string): Promise<OHLCVPoint[]> {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'Trade-M8-AI/1.0 (https://trade-m8.app; contact@trade-m8.app)',
  };
  if (apiKey) headers['x-cg-pro-api-key'] = apiKey;

  // 15-second timeout to prevent Pages Function execution timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let resp: Response;
  try {
    resp = await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`CoinGecko ${resp.status}: ${await resp.text().then(t => t.slice(0, 100))}`);
  }

  const data = await resp.json() as {
    prices: [number, number][];
    total_volumes: [number, number][];
  };

  const prices = data.prices ?? [];
  const volumes = data.total_volumes ?? [];

  return prices.map(([ts, close], i) => ({
    timestamp: ts,
    close,
    volume: volumes[i]?.[1] ?? 0,
  }));
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    return await handleRequest(context);
  } catch (e: any) {
    console.error('[ai] Unhandled error:', e);
    return json({ success: false, error: 'Internal server error', detail: e?.message }, 500);
  }
};

async function handleRequest(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { headers: cors });

  // /api/ai/status is public
  if (method === 'GET' && path.endsWith('/status')) {
    const engine = createAIEnhancementEngine();
    return json({
      success: true,
      status: 'operational',
      cacheStats: engine.getCacheStats(),
      timestamp: new Date().toISOString(),
    });
  }

  // All other routes require auth
  const userId = await authenticate(request, env);
  if (!userId) return err('Unauthorized', 401);

  // ── GET /api/ai/sentiment?symbol=bitcoin ─────────────────────────────────
  if (method === 'GET' && path.endsWith('/sentiment')) {
    const symbol = url.searchParams.get('symbol');
    if (!symbol) return err('symbol query param required');

    const coinId = normalizeCoinId(symbol);
    const cacheKey = `ai:sentiment:${coinId}`;
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      return json({ success: true, sentiment: JSON.parse(cached), cached: true });
    }

    // Generate sentiment via the AI engine (internally uses getSentimentData)
    const engine = createAIEnhancementEngine();
    // Minimal marketData to trigger sentiment path
    const dummyMarketData = { price: 1, volume: 1e6, volatility: 0.02, rsi: 50, macd: { value: 0, signal: 0, histogram: 0 }, momentum: 0 };
    const analysis = await engine.analyzeMarket(coinId, dummyMarketData);

    // We want just the sentiment — extract it from the signal breakdown
    const sentimentScore = analysis.signals.sentiment;
    const result = {
      symbol: coinId,
      sentimentScore,
      direction: analysis.predictedDirection,
      confidence: analysis.confidence,
      timestamp: analysis.timestamp,
    };

    await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 180 });
    return json({ success: true, sentiment: result, cached: false });
  }

  // ── POST /api/ai/signal ───────────────────────────────────────────────────
  // Body: { symbol, days?, includeIndicators? }
  if (method === 'POST' && path.endsWith('/signal')) {
    let body: {
      symbol?: string;
      days?: number;
      includeIndicators?: boolean;
    };

    try {
      body = await request.json() as typeof body;
    } catch {
      return err('Invalid JSON body');
    }

    const { symbol, days = 30, includeIndicators = false } = body;
    if (!symbol) return err('symbol is required');

    const coinId = normalizeCoinId(symbol);

    // Check KV cache (3-minute TTL)
    const cacheKey = `ai:signal:${coinId}:${days}`;
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      return json({ success: true, ...JSON.parse(cached), cached: true });
    }

    // Fetch OHLCV from CoinGecko
    let ohlcv: OHLCVPoint[];
    try {
      ohlcv = await fetchCoinGeckoOHLCV(coinId, days, env.COINGECKO_API_KEY);
    } catch (e: any) {
      return err(`Failed to fetch market data: ${e.message}`, 503);
    }

    if (ohlcv.length < 10) {
      return err(`Insufficient OHLCV data for ${coinId} (got ${ohlcv.length} points, need 10+)`, 422);
    }

    // Cap at last 100 points — CoinGecko returns hourly for <90 days
    // which can mean 2000+ candles; we only need ~60 for indicators
    const MAX_CANDLES = 100;
    const allCloses = ohlcv.map(p => p.close);
    const allVolumes = ohlcv.map(p => p.volume);
    const closes = allCloses.slice(-MAX_CANDLES);
    const volumes = allVolumes.slice(-MAX_CANDLES);

    // Compute indicators
    const currentPrice = closes[closes.length - 1];
    const currentVolume = volumes[volumes.length - 1];
    const rsiVal = computeRSI(closes);
    const macdVal = computeMACD(closes);
    const volatility = computeVolatility(closes);
    const momentum = computeMomentum(closes);

    const marketData = {
      price: currentPrice,
      volume: currentVolume,
      volatility,
      rsi: rsiVal,
      macd: macdVal,
      momentum,
      priceHistory: closes,
      volumeHistory: volumes,
    };

    // Run AI engine
    const engine = createAIEnhancementEngine();

    let analysis: AIMarketAnalysis;
    let fusion: FusionPrediction;

    try {
      [analysis, fusion] = await Promise.all([
        engine.analyzeMarket(coinId, marketData),
        engine.generateFusionPrediction(coinId, {
          priceData: closes,
          volumeData: volumes,
        }),
      ]);
    } catch (e: any) {
      return err(`AI analysis failed: ${e.message}`, 500);
    }

    // Determine combined action (majority vote between analysis and fusion)
    const analysisAction = analysis.predictedDirection === 'bullish' ? 'buy'
      : analysis.predictedDirection === 'bearish' ? 'sell' : 'hold';
    const combinedAction = analysisAction === fusion.action ? analysisAction : 'hold';
    const avgConfidence = (analysis.confidence + fusion.confidence) / 2;

    const result: Record<string, unknown> = {
      symbol: coinId,
      action: combinedAction,
      confidence: avgConfidence,
      analysis,
      fusion,
      summary: {
        action: combinedAction,
        confidence: avgConfidence,
        direction: analysis.predictedDirection,
        winRatePrediction: analysis.winRatePrediction,
        expectedReturn: analysis.expectedReturn,
        timeHorizon: analysis.timeHorizon,
        reasoning: analysis.reasoning,
      },
      timestamp: new Date().toISOString(),
    };

    if (includeIndicators) {
      result.indicators = {
        price: currentPrice,
        rsi: rsiVal,
        macd: macdVal,
        volatility,
        momentum,
        volume: currentVolume,
      };
    }

    await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 180 });
    return json({ success: true, ...result, cached: false });
  }

  // ── POST /api/ai/enhance ──────────────────────────────────────────────────
  // Body: { symbol, baseSignal, baseConfidence, price?, rsi?, macd?, momentum?, volatility?, volume?, priceHistory?, volumeHistory? }
  if (method === 'POST' && path.endsWith('/enhance')) {
    let body: {
      symbol?: string;
      baseSignal?: 'buy' | 'sell' | 'hold';
      baseConfidence?: number;
      price?: number;
      rsi?: number;
      macd?: { value: number; signal: number; histogram: number };
      momentum?: number;
      volatility?: number;
      volume?: number;
      priceHistory?: number[];
      volumeHistory?: number[];
      days?: number;
    };

    try {
      body = await request.json() as typeof body;
    } catch {
      return err('Invalid JSON body');
    }

    const { symbol, baseSignal, baseConfidence } = body;
    if (!symbol) return err('symbol is required');
    if (!baseSignal || !['buy', 'sell', 'hold'].includes(baseSignal)) {
      return err('baseSignal must be "buy", "sell", or "hold"');
    }
    if (baseConfidence === undefined || baseConfidence < 0 || baseConfidence > 1) {
      return err('baseConfidence must be a number 0–1');
    }

    const coinId = normalizeCoinId(symbol);

    // Check cache
    const cacheKey = `ai:enhance:${coinId}:${baseSignal}:${baseConfidence.toFixed(2)}`;
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      return json({ success: true, enhanced: JSON.parse(cached), cached: true });
    }

    // Build marketData — use provided values or fetch from CoinGecko
    let marketData: {
      price: number; volume: number; volatility: number;
      rsi: number; macd: { value: number; signal: number; histogram: number };
      momentum: number; priceHistory?: number[]; volumeHistory?: number[];
    };

    if (body.price !== undefined && body.rsi !== undefined && body.macd !== undefined) {
      // Caller provided all indicators — use them directly
      marketData = {
        price: body.price,
        volume: body.volume ?? 1e6,
        volatility: body.volatility ?? 0.02,
        rsi: body.rsi,
        macd: body.macd,
        momentum: body.momentum ?? 0,
        priceHistory: body.priceHistory,
        volumeHistory: body.volumeHistory,
      };
    } else {
      // Fetch from CoinGecko and compute
      let ohlcv: OHLCVPoint[];
      try {
        ohlcv = await fetchCoinGeckoOHLCV(coinId, body.days ?? 30, env.COINGECKO_API_KEY);
      } catch (e: any) {
        return err(`Failed to fetch market data: ${e.message}`, 503);
      }

      if (ohlcv.length < 10) {
        return err(`Insufficient data for ${coinId}`, 422);
      }

      const allCloses2 = ohlcv.map(p => p.close);
      const allVolumes2 = ohlcv.map(p => p.volume);
      const closes = allCloses2.slice(-100);
      const volumes = allVolumes2.slice(-100);

      marketData = {
        price: closes[closes.length - 1],
        volume: volumes[volumes.length - 1],
        volatility: computeVolatility(closes),
        rsi: computeRSI(closes),
        macd: computeMACD(closes),
        momentum: computeMomentum(closes),
        priceHistory: closes,
        volumeHistory: volumes,
      };
    }

    const engine = createAIEnhancementEngine();
    let enhanced: EnhancedSignal;
    try {
      enhanced = await engine.enhanceSignal(coinId, baseSignal, baseConfidence, marketData);
    } catch (e: any) {
      return err(`Signal enhancement failed: ${e.message}`, 500);
    }

    await env.CACHE.put(cacheKey, JSON.stringify(enhanced), { expirationTtl: 180 });
    return json({ success: true, enhanced, cached: false });
  }

  return err('Not found', 404);
}
