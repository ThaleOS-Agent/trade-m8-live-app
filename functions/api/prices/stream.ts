/**
 * Real-time Price Streaming — SSE Endpoint
 *
 * Route:
 *   GET /api/prices/stream?symbols=BTC,ETH,BNB
 *
 * Streams live price updates via Server-Sent Events (SSE).
 * Updates every 5 seconds with fresh prices from CoinGecko.
 * No authentication required (public data).
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
// TICKER → COINGECKO ID MAP
// ============================================================================
const tickerToId: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana',
  XRP: 'ripple', ADA: 'cardano', AVAX: 'avalanche-2', DOT: 'polkadot',
  MATIC: 'matic-network', LINK: 'chainlink', LTC: 'litecoin',
  UNI: 'uniswap', ATOM: 'cosmos', XLM: 'stellar', DOGE: 'dogecoin',
  TRX: 'tron', SHIB: 'shiba-inu', NEAR: 'near', APT: 'aptos',
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
  apiKey: string
): Promise<Record<string, { price: number; change24h: number; volume24h: number; marketCap: number }>> {
  const ids = coinIds.join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'Trade-M8-Stream/1.0 (https://trade-m8.app)',
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
    }>;

    const result: Record<string, { price: number; change24h: number; volume24h: number; marketCap: number }> = {};

    for (const [id, values] of Object.entries(data)) {
      result[id] = {
        price: values.usd,
        change24h: values.usd_24h_change ?? 0,
        volume24h: values.usd_24h_vol ?? 0,
        marketCap: values.usd_market_cap ?? 0,
      };
    }

    return result;
  } catch (e) {
    console.error('CoinGecko fetch error:', e);
    return {};
  }
}

// ============================================================================
// SSE STREAM HANDLER
// ============================================================================
async function handleStream(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const symbolsParam = url.searchParams.get('symbols') ?? 'BTC,ETH,BNB';
  const intervalParam = parseInt(url.searchParams.get('interval') ?? '5000', 10);

  // Clamp interval: 3-60 seconds
  const interval = Math.max(3000, Math.min(intervalParam, 60000));

  // Parse symbols
  const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
  if (symbols.length === 0) {
    return new Response('Missing symbols parameter', { status: 400 });
  }

  if (symbols.length > 20) {
    return new Response('Too many symbols (max 20)', { status: 400 });
  }

  const coinIds = resolveIds(symbols);

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection message
      const welcome = `data: ${JSON.stringify({ type: 'connected', symbols, interval })}\n\n`;
      controller.enqueue(encoder.encode(welcome));

      // Keep-alive ping every 30 seconds
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(keepAliveInterval);
        }
      }, 30_000);

      // Price update loop
      const updateInterval = setInterval(async () => {
        try {
          // Fetch prices from CoinGecko
          const prices = await fetchCoinGeckoPrices(coinIds, env.COINGECKO_API_KEY ?? '');

          // Map back to original symbols
          const payload: Record<string, any> = {};
          for (let i = 0; i < symbols.length; i++) {
            const sym = symbols[i];
            const coinId = coinIds[i];
            const data = prices[coinId];
            if (data) {
              payload[sym.toUpperCase()] = {
                price: data.price,
                change24h: data.change24h,
                volume24h: data.volume24h,
                marketCap: data.marketCap,
                timestamp: new Date().toISOString(),
              };
            }
          }

          // Send SSE event
          const event = `data: ${JSON.stringify({ type: 'update', prices: payload })}\n\n`;
          controller.enqueue(encoder.encode(event));

          // Also update D1 market_data table (fire and forget)
          for (const [sym, data] of Object.entries(payload)) {
            env.DB.prepare(`
              INSERT OR REPLACE INTO market_data (id, symbol, exchange, price, change_24h, volume_24h, updated_at)
              VALUES (?, ?, 'coingecko', ?, ?, ?, strftime('%s', 'now'))
            `).bind(
              `coingecko_${sym.toLowerCase()}`,
              sym,
              data.price,
              data.change24h,
              data.volume24h
            ).run().catch(() => {});
          }
        } catch (err) {
          console.error('Stream update error:', err);
          // Send error event
          const errorEvent = `data: ${JSON.stringify({ type: 'error', message: 'Price fetch failed' })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
        }
      }, interval);

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clearInterval(updateInterval);
        clearInterval(keepAliveInterval);
        try {
          controller.close();
        } catch {}
      });

      // Auto-timeout after 10 minutes (Cloudflare limit workaround)
      setTimeout(() => {
        clearInterval(updateInterval);
        clearInterval(keepAliveInterval);
        try {
          const goodbye = `data: ${JSON.stringify({ type: 'timeout', message: 'Stream closed after 10 minutes' })}\n\n`;
          controller.enqueue(encoder.encode(goodbye));
          controller.close();
        } catch {}
      }, 10 * 60 * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
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
  const { method } = context.request;

  // OPTIONS preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    return await handleStream(context.request, context.env);
  } catch (e: unknown) {
    console.error('Stream error:', e);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }
    );
  }
}
