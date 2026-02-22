/**
 * Real-time Prices — REST API
 *
 * Routes:
 *   GET /api/prices?symbols=BTC,ETH,BNB           — Get current prices
 *   GET /api/prices/latest?symbols=BTC,ETH        — Alias for /api/prices
 *   GET /api/prices/history?symbol=BTC&days=7     — Price history (OHLCV)
 *
 * No authentication required (public data).
 * Results cached in KV for 30 seconds.
 */

// ============================================================================
// ENV INTERFACE
// ============================================================================
interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  COINGECKO_API_KEY: string;
}

// ============================================================================
// CORS + HELPERS
// ============================================================================
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
// TICKER → COINGECKO ID MAP
// ============================================================================
const tickerToId: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana',
  XRP: 'ripple', ADA: 'cardano', AVAX: 'avalanche-2', DOT: 'polkadot',
  MATIC: 'matic-network', LINK: 'chainlink', LTC: 'litecoin',
  UNI: 'uniswap', ATOM: 'cosmos', XLM: 'stellar', DOGE: 'dogecoin',
  TRX: 'tron', SHIB: 'shiba-inu', NEAR: 'near', APT: 'aptos',
  FTM: 'fantom', ALGO: 'algorand', VET: 'vechain', ICP: 'internet-computer',
};

function resolveIds(symbols: string[]): string[] {
  return symbols.map(sym => {
    const upper = sym.toUpperCase();
    return tickerToId[upper] ?? sym.toLowerCase();
  });
}

// ============================================================================
// FETCH PRICES FROM COINGECKO
// ============================================================================
async function fetchCoinGeckoPrices(
  coinIds: string[],
  apiKey: string,
  cache: KVNamespace
): Promise<Record<string, {
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  high24h?: number;
  low24h?: number;
}>> {
  // Check cache first
  const cacheKey = `prices:${coinIds.sort().join(',')}`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  const ids = coinIds.join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true&include_24hr_high_low=true`;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'Trade-M8-Prices/1.0 (https://trade-m8.app)',
  };
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.error(`CoinGecko error: ${resp.status}`);
      return {};
    }

    const data = await resp.json() as Record<string, {
      usd: number;
      usd_24h_change?: number;
      usd_24h_vol?: number;
      usd_market_cap?: number;
      usd_24h_high?: number;
      usd_24h_low?: number;
    }>;

    const result: Record<string, any> = {};

    for (const [id, values] of Object.entries(data)) {
      result[id] = {
        price: values.usd,
        change24h: values.usd_24h_change ?? 0,
        volume24h: values.usd_24h_vol ?? 0,
        marketCap: values.usd_market_cap ?? 0,
        high24h: values.usd_24h_high,
        low24h: values.usd_24h_low,
      };
    }

    // Cache for 30 seconds
    await cache.put(cacheKey, JSON.stringify(result), { expirationTtl: 30 });

    return result;
  } catch (e) {
    console.error('CoinGecko fetch error:', e);
    return {};
  }
}

// ============================================================================
// FETCH OHLCV HISTORY FROM COINGECKO
// ============================================================================
async function fetchCoinGeckoHistory(
  coinId: string,
  days: number,
  apiKey: string,
  cache: KVNamespace
): Promise<Array<{ timestamp: string; open: number; high: number; low: number; close: number }> | null> {
  // Check cache
  const cacheKey = `history:${coinId}:${days}`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'Trade-M8-Prices/1.0 (https://trade-m8.app)',
  };
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timeout);

    if (!resp.ok) return null;

    const raw: number[][] = await resp.json();

    const result = raw.map(([ts, o, h, l, c]) => ({
      timestamp: new Date(ts).toISOString(),
      open: o,
      high: h,
      low: l,
      close: c,
    }));

    // Cache for 5 minutes
    await cache.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 });

    return result;
  } catch {
    return null;
  }
}

// ============================================================================
// ROUTE HANDLER
// ============================================================================
async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const { method } = request;

  // OPTIONS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (method !== 'GET') {
    return err('Method not allowed', 405);
  }

  const path = url.pathname.replace(/^\/api\/prices\/?/, '');

  // -----------------------------------------------------------------------
  // GET /api/prices or /api/prices/latest (current prices)
  // -----------------------------------------------------------------------
  if (path === '' || path === '/' || path === 'latest') {
    const symbolsParam = url.searchParams.get('symbols') ?? 'BTC,ETH';
    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);

    if (symbols.length === 0) {
      return err('Missing symbols parameter');
    }

    if (symbols.length > 50) {
      return err('Too many symbols (max 50)');
    }

    const coinIds = resolveIds(symbols);
    const prices = await fetchCoinGeckoPrices(coinIds, env.COINGECKO_API_KEY ?? '', env.CACHE);

    // Map back to original symbols
    const payload: Record<string, any> = {};
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i];
      const coinId = coinIds[i];
      const data = prices[coinId];
      if (data) {
        payload[sym.toUpperCase()] = {
          ...data,
          timestamp: new Date().toISOString(),
        };
      }
    }

    return json({
      success: true,
      prices: payload,
      count: Object.keys(payload).length,
    });
  }

  // -----------------------------------------------------------------------
  // GET /api/prices/history (OHLCV history)
  // -----------------------------------------------------------------------
  if (path === 'history') {
    const symbolParam = url.searchParams.get('symbol');
    if (!symbolParam) {
      return err('Missing symbol parameter');
    }

    const days = Math.min(parseInt(url.searchParams.get('days') ?? '7', 10), 365);
    const coinId = resolveIds([symbolParam])[0];

    const history = await fetchCoinGeckoHistory(coinId, days, env.COINGECKO_API_KEY ?? '', env.CACHE);

    if (!history) {
      return err('Failed to fetch price history', 503);
    }

    return json({
      success: true,
      symbol: symbolParam.toUpperCase(),
      days,
      data: history,
      count: history.length,
    });
  }

  return err('Not found', 404);
}

// ============================================================================
// PAGES FUNCTION EXPORT
// ============================================================================
export async function onRequest(context: {
  request: Request;
  env: Env;
  waitUntil: (p: Promise<unknown>) => void;
  next: () => Promise<Response>;
}): Promise<Response> {
  try {
    return await handleRequest(
      context.request,
      context.env,
      { waitUntil: context.waitUntil } as ExecutionContext
    );
  } catch (e: unknown) {
    console.error('Prices function error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error', detail: msg }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
}
