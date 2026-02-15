/**
 * CoinGecko API Service for Enhanced Trading Bot Performance
 * Provides market data, technical indicators, and trading signals
 */

interface CoinGeckoConfig {
  apiUrl: string;
  apiKey?: string;
  cacheTTL: number;
}

interface OHLCCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TechnicalIndicators {
  rsi: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  momentum: number;
  volatility: number;
}

interface TradingSignal {
  coinId: string;
  symbol: string;
  signal: 'buy' | 'sell' | 'hold';
  strength: number; // 0-100
  indicators: TechnicalIndicators;
  currentPrice: number;
  priceChange24h: number;
}

interface TradingOpportunity {
  coinId: string;
  symbol: string;
  name: string;
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  reason: string;
  confidence: number;
}

export class CoinGeckoService {
  private config: CoinGeckoConfig;

  constructor(apiKey?: string) {
    this.config = {
      apiUrl: 'https://api.coingecko.com/api/v3',
      apiKey: apiKey,
      cacheTTL: 300 // 5 minutes
    };
  }

  /**
   * Get headers for API requests
   */
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };

    if (this.config.apiKey) {
      headers['x-cg-demo-api-key'] = this.config.apiKey;
    }

    return headers;
  }

  /**
   * Get OHLC (candlestick) data for technical analysis
   * @param coinId - CoinGecko coin ID (e.g., 'bitcoin', 'ethereum')
   * @param days - Number of days (1, 7, 14, 30, 90, 180, 365, max)
   */
  async getOHLC(coinId: string, days: number = 7): Promise<OHLCCandle[]> {
    try {
      const url = `${this.config.apiUrl}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
      const response = await fetch(url, { headers: this.getHeaders() });

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();

      return data.map((candle: number[]) => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4]
      }));
    } catch (error) {
      console.error('Error fetching OHLC data:', error);
      throw error;
    }
  }

  /**
   * Get top gainers and losers for momentum trading
   */
  async getTopGainersLosers() {
    try {
      const url = `${this.config.apiUrl}/coins/top_gainers_losers?vs_currency=usd`;
      const response = await fetch(url, { headers: this.getHeaders() });

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching gainers/losers:', error);
      throw error;
    }
  }

  /**
   * Get trending coins
   */
  async getTrendingCoins() {
    try {
      const url = `${this.config.apiUrl}/search/trending`;
      const response = await fetch(url, { headers: this.getHeaders() });

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching trending coins:', error);
      throw error;
    }
  }

  /**
   * Get historical market data for backtesting
   * @param coinId - CoinGecko coin ID
   * @param days - Number of days (1-365 or 'max')
   */
  async getMarketChart(coinId: string, days: number | 'max' = 30) {
    try {
      const url = `${this.config.apiUrl}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
      const response = await fetch(url, { headers: this.getHeaders() });

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching market chart:', error);
      throw error;
    }
  }

  /**
   * Calculate RSI (Relative Strength Index)
   * @param prices - Array of closing prices
   * @param period - RSI period (default: 14)
   */
  calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) {
      return 50; // Neutral if not enough data
    }

    let gains = 0;
    let losses = 0;

    // Calculate initial average gain/loss
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate subsequent values using smoothed averages
    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];

      if (change > 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }

  /**
   * Calculate volatility (standard deviation of returns)
   */
  calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;

    return Math.sqrt(variance) * 100; // As percentage
  }

  /**
   * Detect trend from price data
   */
  detectTrend(prices: number[]): 'bullish' | 'bearish' | 'neutral' {
    if (prices.length < 5) return 'neutral';

    const recent = prices.slice(-5);
    const older = prices.slice(-10, -5);

    if (older.length === 0) return 'neutral';

    const recentAvg = recent.reduce((sum, p) => sum + p, 0) / recent.length;
    const olderAvg = older.reduce((sum, p) => sum + p, 0) / older.length;

    const change = ((recentAvg - olderAvg) / olderAvg) * 100;

    if (change > 2) return 'bullish';
    if (change < -2) return 'bearish';
    return 'neutral';
  }

  /**
   * Calculate momentum score
   */
  calculateMomentum(prices: number[]): number {
    if (prices.length < 2) return 0;

    const current = prices[prices.length - 1];
    const previous = prices[0];

    return ((current - previous) / previous) * 100;
  }

  /**
   * Analyze market and generate trading signals
   * @param coinId - CoinGecko coin ID
   * @param days - Historical data period
   */
  async analyzeMarket(coinId: string, days: number = 14): Promise<TradingSignal | null> {
    try {
      // Get OHLC data
      const ohlc = await this.getOHLC(coinId, days);
      if (ohlc.length === 0) return null;

      const closePrices = ohlc.map(c => c.close);
      const currentPrice = closePrices[closePrices.length - 1];
      const previousPrice = closePrices[0];

      // Calculate indicators
      const rsi = this.calculateRSI(closePrices);
      const trend = this.detectTrend(closePrices);
      const momentum = this.calculateMomentum(closePrices);
      const volatility = this.calculateVolatility(closePrices);

      // Generate signal
      let signal: 'buy' | 'sell' | 'hold' = 'hold';
      let strength = 50;

      // RSI-based signals
      if (rsi < 30) {
        signal = 'buy';
        strength = 70 + (30 - rsi); // Stronger as RSI gets lower
      } else if (rsi > 70) {
        signal = 'sell';
        strength = 70 + (rsi - 70); // Stronger as RSI gets higher
      }

      // Trend confirmation
      if (trend === 'bullish' && signal === 'buy') {
        strength = Math.min(100, strength + 10);
      } else if (trend === 'bearish' && signal === 'sell') {
        strength = Math.min(100, strength + 10);
      }

      // Momentum confirmation
      if (momentum > 5 && signal === 'buy') {
        strength = Math.min(100, strength + 5);
      } else if (momentum < -5 && signal === 'sell') {
        strength = Math.min(100, strength + 5);
      }

      const priceChange24h = ((currentPrice - previousPrice) / previousPrice) * 100;

      return {
        coinId,
        symbol: coinId.toUpperCase(),
        signal,
        strength,
        indicators: {
          rsi,
          trend,
          momentum,
          volatility
        },
        currentPrice,
        priceChange24h
      };
    } catch (error) {
      console.error(`Error analyzing market for ${coinId}:`, error);
      return null;
    }
  }

  /**
   * Find trading opportunities across multiple coins
   */
  async findTradingOpportunities(): Promise<{
    highMomentum: TradingOpportunity[];
    trending: TradingOpportunity[];
    reversal: TradingOpportunity[];
  }> {
    try {
      // Get gainers/losers and trending coins
      const [gainersLosers, trending] = await Promise.all([
        this.getTopGainersLosers(),
        this.getTrendingCoins()
      ]);

      // Map top gainers (high momentum opportunities)
      const highMomentum: TradingOpportunity[] = (gainersLosers.top_gainers || [])
        .slice(0, 5)
        .map((coin: any) => ({
          coinId: coin.id,
          symbol: coin.symbol,
          name: coin.name,
          currentPrice: coin.usd,
          priceChange24h: coin.usd_24h_change,
          volume24h: coin.usd_24h_vol || 0,
          marketCap: coin.usd_market_cap || 0,
          reason: 'Strong upward momentum - 24h gainer',
          confidence: Math.min(95, 70 + (coin.usd_24h_change / 10))
        }));

      // Map trending coins
      const trendingOpportunities: TradingOpportunity[] = (trending.coins || [])
        .slice(0, 5)
        .map((item: any) => {
          const coin = item.item;
          return {
            coinId: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            currentPrice: coin.data?.price || 0,
            priceChange24h: coin.data?.price_change_percentage_24h?.usd || 0,
            volume24h: coin.data?.total_volume || 0,
            marketCap: coin.data?.market_cap || 0,
            reason: 'Trending on CoinGecko - High interest',
            confidence: 75
          };
        });

      // Map top losers (potential reversal opportunities)
      const reversal: TradingOpportunity[] = (gainersLosers.top_losers || [])
        .slice(0, 3)
        .map((coin: any) => ({
          coinId: coin.id,
          symbol: coin.symbol,
          name: coin.name,
          currentPrice: coin.usd,
          priceChange24h: coin.usd_24h_change,
          volume24h: coin.usd_24h_vol || 0,
          marketCap: coin.usd_market_cap || 0,
          reason: 'Potential reversal - Oversold condition',
          confidence: 60
        }));

      return {
        highMomentum,
        trending: trendingOpportunities,
        reversal
      };
    } catch (error) {
      console.error('Error finding trading opportunities:', error);
      return {
        highMomentum: [],
        trending: [],
        reversal: []
      };
    }
  }

  /**
   * Get detailed market analysis for a specific coin
   */
  async getDetailedAnalysis(coinId: string) {
    try {
      const [ohlc, marketChart, signal] = await Promise.all([
        this.getOHLC(coinId, 30),
        this.getMarketChart(coinId, 30),
        this.analyzeMarket(coinId, 14)
      ]);

      return {
        coinId,
        ohlc,
        marketChart,
        signal,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`Error getting detailed analysis for ${coinId}:`, error);
      throw error;
    }
  }

  /**
   * Get multiple coin analyses in parallel (for portfolio tracking)
   */
  async getMultiCoinAnalysis(coinIds: string[]): Promise<Map<string, TradingSignal | null>> {
    const results = new Map<string, TradingSignal | null>();

    const analyses = await Promise.allSettled(
      coinIds.map(id => this.analyzeMarket(id, 14))
    );

    analyses.forEach((result, index) => {
      const coinId = coinIds[index];
      if (result.status === 'fulfilled') {
        results.set(coinId, result.value);
      } else {
        results.set(coinId, null);
      }
    });

    return results;
  }
}

// Utility function to convert common symbols to CoinGecko IDs
export function symbolToCoinId(symbol: string): string {
  const mapping: Record<string, string> = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'USDT': 'tether',
    'BNB': 'binancecoin',
    'SOL': 'solana',
    'XRP': 'ripple',
    'ADA': 'cardano',
    'DOGE': 'dogecoin',
    'AVAX': 'avalanche-2',
    'DOT': 'polkadot',
    'MATIC': 'matic-network',
    'LINK': 'chainlink',
    'UNI': 'uniswap',
    'ATOM': 'cosmos',
    'LTC': 'litecoin'
  };

  return mapping[symbol.toUpperCase()] || symbol.toLowerCase();
}
