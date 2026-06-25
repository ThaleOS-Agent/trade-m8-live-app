/**
 * Market Analyzer - Multi-Asset Analysis Service
 * Fetches real OHLCV data from CoinGecko via the Trade M8 backend API.
 * Forex and commodity symbols are not supported by CoinGecko and are excluded
 * from live analysis (they receive neutral/skipped metrics).
 */

export interface MarketMetrics {
  symbol: string;
  price: number;
  volume: number;
  volatility: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  rsi: number;
  macd: number;
  momentum: number;
  strength: number; // Overall strength score 0-100
}

export interface AssetOpportunity {
  symbol: string;
  score: number; // 0-100 ranking score
  signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  confidence: number; // 0-100
  metrics: MarketMetrics;
  reasons: string[];
}

// ─── CoinGecko ID mapping ─────────────────────────────────────────────────────
// Maps trading pair symbols to CoinGecko coin IDs.
// Symbols not in this map (forex, commodities) are skipped in live analysis.

const SYMBOL_TO_COIN_ID: Record<string, string> = {
  'BTC/USD': 'bitcoin',
  'ETH/USD': 'ethereum',
  'BNB/USD': 'binancecoin',
  'XRP/USD': 'ripple',
  'ADA/USD': 'cardano',
  'SOL/USD': 'solana',
  'DOT/USD': 'polkadot',
  'DOGE/USD': 'dogecoin',
  'AVAX/USD': 'avalanche-2',
  'MATIC/USD': 'matic-network',
  'LINK/USD': 'chainlink',
  'UNI/USD': 'uniswap',
  'ATOM/USD': 'cosmos',
  'LTC/USD': 'litecoin',
  'NEAR/USD': 'near',
  'APT/USD': 'aptos',
  'ARB/USD': 'arbitrum',
  'OP/USD': 'optimism',
};

// ─── Short-term in-memory cache ───────────────────────────────────────────────
// Prevents redundant API calls within the same scan cycle.

interface CacheEntry {
  data: MarketMetrics;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches backend KV TTL
const metricsCache = new Map<string, CacheEntry>();

function getCached(symbol: string): MarketMetrics | null {
  const entry = metricsCache.get(symbol);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  metricsCache.delete(symbol);
  return null;
}

function setCached(symbol: string, data: MarketMetrics): void {
  metricsCache.set(symbol, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── API response shapes ──────────────────────────────────────────────────────

interface BackendSignal {
  coinId: string;
  symbol: string;
  signal: 'buy' | 'sell' | 'hold';
  strength: number; // 0-100
  indicators: {
    rsi: number;
    trend: 'bullish' | 'bearish' | 'neutral';
    momentum: number;
    volatility: number;
  };
  currentPrice: number;
  priceChange24h: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps a backend TradingSignal to the MarketMetrics shape expected by the rest
 * of the frontend strategy layer.
 */
function signalToMetrics(symbol: string, sig: BackendSignal): MarketMetrics {
  // Derive a single MACD proxy from trend so evaluateOpportunity() can use it.
  const macdProxy = sig.indicators.trend === 'bullish' ? 1
    : sig.indicators.trend === 'bearish' ? -1
    : 0;

  return {
    symbol,
    price: sig.currentPrice,
    volume: 0, // Volume not returned by /api/trading-signals; not used in scoring
    volatility: sig.indicators.volatility,
    trend: sig.indicators.trend,
    rsi: sig.indicators.rsi,
    macd: macdProxy,
    momentum: sig.indicators.momentum,
    strength: sig.strength,
  };
}

/**
 * Neutral placeholder returned when a symbol cannot be analysed (forex,
 * commodities, API error). Score of 50 keeps it ranked at the bottom when
 * real crypto data is present.
 */
function neutralMetrics(symbol: string): MarketMetrics {
  return {
    symbol,
    price: 0,
    volume: 0,
    volatility: 0,
    trend: 'neutral',
    rsi: 50,
    macd: 0,
    momentum: 0,
    strength: 50,
  };
}

// ─── MarketAnalyzer ───────────────────────────────────────────────────────────

class MarketAnalyzer {
  private readonly CRYPTO_SYMBOLS = Object.keys(SYMBOL_TO_COIN_ID);

  private readonly FOREX_SYMBOLS = [
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD',
    'USD/CHF', 'NZD/USD',
  ];

  private readonly COMMODITY_SYMBOLS = [
    'XAU/USD', 'XAG/USD', 'OIL/USD', 'GAS/USD',
  ];

  /**
   * Analyse a single asset.
   * Returns cached metrics if available; otherwise fetches from the backend.
   */
  async analyzeAsset(symbol: string): Promise<MarketMetrics> {
    const cached = getCached(symbol);
    if (cached) return cached;

    const coinId = SYMBOL_TO_COIN_ID[symbol];
    if (!coinId) {
      // Forex / commodity — not supported by CoinGecko endpoint
      return neutralMetrics(symbol);
    }

    try {
      const res = await fetch(`/api/market-analysis?coinId=${coinId}&days=14`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json() as any;
      if (!json.success || !json.analysis) return neutralMetrics(symbol);

      const metrics = signalToMetrics(symbol, json.analysis as BackendSignal);
      setCached(symbol, metrics);
      return metrics;
    } catch (err) {
      console.error(`[marketAnalyzer] analyzeAsset ${symbol}:`, err);
      return neutralMetrics(symbol);
    }
  }

  /**
   * Scan multiple assets in parallel and rank by opportunity score.
   * Crypto-only symbols are fetched in a single bulk request; forex and
   * commodities receive neutral metrics without making API calls.
   */
  async scanMarkets(
    assetType: 'crypto' | 'forex' | 'commodities' | 'all' = 'all'
  ): Promise<AssetOpportunity[]> {
    const symbolsToScan = this.getSymbolsForType(assetType);

    // Split into crypto (live data) and non-crypto (neutral placeholders)
    const cryptoSymbols = symbolsToScan.filter(s => SYMBOL_TO_COIN_ID[s]);
    const otherSymbols = symbolsToScan.filter(s => !SYMBOL_TO_COIN_ID[s]);

    // Fetch all crypto in one request, with per-symbol cache fallback
    const cryptoMetrics = await this.fetchBulkCryptoMetrics(cryptoSymbols);

    // Non-crypto gets neutral metrics without any API call
    const otherMetrics: MarketMetrics[] = otherSymbols.map(neutralMetrics);

    const allMetrics = [...cryptoMetrics, ...otherMetrics];
    const opportunities = allMetrics.map(m => this.evaluateOpportunity(m));

    return opportunities.sort((a, b) => b.score - a.score);
  }

  /**
   * Fetch metrics for a list of crypto symbols using the bulk
   * /api/trading-signals endpoint, falling back to per-symbol calls for
   * symbols already in the cache.
   */
  private async fetchBulkCryptoMetrics(symbols: string[]): Promise<MarketMetrics[]> {
    if (symbols.length === 0) return [];

    // Use cached results where available; collect remaining coin IDs to fetch
    const results = new Map<string, MarketMetrics>();
    const toFetch: string[] = [];

    for (const sym of symbols) {
      const cached = getCached(sym);
      if (cached) {
        results.set(sym, cached);
      } else {
        toFetch.push(sym);
      }
    }

    if (toFetch.length > 0) {
      const coinIds = toFetch
        .map(s => SYMBOL_TO_COIN_ID[s])
        .filter(Boolean)
        .join(',');

      try {
        const res = await fetch(`/api/trading-signals?coins=${coinIds}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json() as any;
        if (json.success && json.signals) {
          for (const sym of toFetch) {
            const coinId = SYMBOL_TO_COIN_ID[sym];
            const sig: BackendSignal | undefined = json.signals[coinId];
            if (sig) {
              const metrics = signalToMetrics(sym, sig);
              setCached(sym, metrics);
              results.set(sym, metrics);
            } else {
              results.set(sym, neutralMetrics(sym));
            }
          }
        }
      } catch (err) {
        console.error('[marketAnalyzer] fetchBulkCryptoMetrics:', err);
        // Fall back to neutral metrics for anything we couldn't fetch
        for (const sym of toFetch) {
          if (!results.has(sym)) results.set(sym, neutralMetrics(sym));
        }
      }
    }

    // Preserve original symbol order
    return symbols.map(s => results.get(s) ?? neutralMetrics(s));
  }

  /**
   * Evaluate trading opportunity based on metrics (unchanged scoring logic).
   */
  evaluateOpportunity(metrics: MarketMetrics): AssetOpportunity {
    const reasons: string[] = [];
    let score = metrics.strength;
    let signal: AssetOpportunity['signal'] = 'neutral';

    if (metrics.rsi < 30) {
      reasons.push(`Oversold (RSI: ${metrics.rsi.toFixed(1)})`);
      score += 10;
    } else if (metrics.rsi > 70) {
      reasons.push(`Overbought (RSI: ${metrics.rsi.toFixed(1)})`);
      score -= 10;
    }

    if (metrics.trend === 'bullish') {
      reasons.push('Strong bullish trend');
      score += 10;
    } else if (metrics.trend === 'bearish') {
      reasons.push('Bearish trend detected');
      score -= 10;
    }

    if (metrics.macd > 0) {
      reasons.push('Positive MACD signal');
      score += 5;
    } else if (metrics.macd < 0) {
      reasons.push('Negative MACD signal');
      score -= 5;
    }

    if (metrics.momentum > 5) {
      reasons.push(`Strong upward momentum (+${metrics.momentum.toFixed(1)}%)`);
      score += 8;
    } else if (metrics.momentum < -5) {
      reasons.push(`Downward momentum (${metrics.momentum.toFixed(1)}%)`);
      score -= 8;
    }

    if (metrics.volatility > 5) {
      reasons.push('High volatility — higher risk/reward');
    } else if (metrics.volatility > 0 && metrics.volatility < 1) {
      reasons.push('Low volatility — stable asset');
    }

    score = Math.min(Math.max(score, 0), 100);

    if (score >= 75) signal = 'strong_buy';
    else if (score >= 60) signal = 'buy';
    else if (score >= 40) signal = 'neutral';
    else if (score >= 25) signal = 'sell';
    else signal = 'strong_sell';

    const confidence = Math.abs(score - 50) * 2;

    return { symbol: metrics.symbol, score, signal, confidence, metrics, reasons };
  }

  /**
   * Find the single best asset to trade right now.
   */
  async findBestAsset(
    assetType: 'crypto' | 'forex' | 'commodities' | 'all' = 'all',
    minScore = 60
  ): Promise<AssetOpportunity | null> {
    const opportunities = await this.scanMarkets(assetType);
    const best = opportunities[0];
    return best && best.score >= minScore ? best : null;
  }

  /**
   * Get top N trading opportunities.
   */
  async getTopOpportunities(
    count = 5,
    assetType: 'crypto' | 'forex' | 'commodities' | 'all' = 'all'
  ): Promise<AssetOpportunity[]> {
    const opportunities = await this.scanMarkets(assetType);
    return opportunities.slice(0, count);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private getSymbolsForType(
    assetType: 'crypto' | 'forex' | 'commodities' | 'all'
  ): string[] {
    switch (assetType) {
      case 'crypto':      return this.CRYPTO_SYMBOLS;
      case 'forex':       return this.FOREX_SYMBOLS;
      case 'commodities': return this.COMMODITY_SYMBOLS;
      case 'all':         return [...this.CRYPTO_SYMBOLS, ...this.FOREX_SYMBOLS, ...this.COMMODITY_SYMBOLS];
    }
  }
}

export const marketAnalyzer = new MarketAnalyzer();
export default marketAnalyzer;
