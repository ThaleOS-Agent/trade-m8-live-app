/**
 * Market Analyzer - Multi-Asset Analysis Service
 * Analyzes multiple assets to find the best trading opportunities
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

class MarketAnalyzer {
  private readonly POPULAR_CRYPTO = [
    'BTC/USD', 'ETH/USD', 'BNB/USD', 'XRP/USD', 'ADA/USD',
    'SOL/USD', 'DOT/USD', 'DOGE/USD', 'AVAX/USD', 'MATIC/USD'
  ];

  private readonly POPULAR_FOREX = [
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD',
    'USD/CHF', 'NZD/USD'
  ];

  private readonly POPULAR_COMMODITIES = [
    'XAU/USD', 'XAG/USD', 'OIL/USD', 'GAS/USD'
  ];

  /**
   * Calculate RSI (Relative Strength Index)
   */
  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  private calculateMACD(prices: number[]): number {
    if (prices.length < 26) return 0;

    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);

    return ema12 - ema26;
  }

  /**
   * Calculate EMA (Exponential Moving Average)
   */
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;

    const multiplier = 2 / (period + 1);
    let ema = prices[0];

    for (let i = 1; i < Math.min(prices.length, period * 2); i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculate volatility (standard deviation of returns)
   */
  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;

    return Math.sqrt(variance) * 100;
  }

  /**
   * Detect trend from price data
   */
  private detectTrend(prices: number[]): 'bullish' | 'bearish' | 'neutral' {
    if (prices.length < 20) return 'neutral';

    const recentPrices = prices.slice(-20);
    const firstHalf = recentPrices.slice(0, 10);
    const secondHalf = recentPrices.slice(10);

    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const change = ((avgSecond - avgFirst) / avgFirst) * 100;

    if (change > 2) return 'bullish';
    if (change < -2) return 'bearish';
    return 'neutral';
  }

  /**
   * Calculate momentum
   */
  private calculateMomentum(prices: number[], period: number = 10): number {
    if (prices.length < period) return 0;

    const current = prices[prices.length - 1];
    const past = prices[prices.length - period];

    return ((current - past) / past) * 100;
  }

  /**
   * Generate mock historical prices for simulation
   */
  private generateMockPrices(basePrice: number, days: number = 30): number[] {
    const prices = [basePrice];
    let currentPrice = basePrice;

    for (let i = 1; i < days; i++) {
      const change = (Math.random() - 0.5) * (basePrice * 0.02);
      currentPrice = Math.max(currentPrice + change, basePrice * 0.5);
      prices.push(currentPrice);
    }

    return prices;
  }

  /**
   * Analyze a single asset
   */
  async analyzeAsset(symbol: string): Promise<MarketMetrics> {
    // In production, this would fetch real market data
    // For now, we'll simulate with realistic data

    const basePrice = Math.random() * 50000 + 1000;
    const historicalPrices = this.generateMockPrices(basePrice, 30);
    const currentPrice = historicalPrices[historicalPrices.length - 1];

    const rsi = this.calculateRSI(historicalPrices);
    const macd = this.calculateMACD(historicalPrices);
    const volatility = this.calculateVolatility(historicalPrices);
    const trend = this.detectTrend(historicalPrices);
    const momentum = this.calculateMomentum(historicalPrices);

    // Calculate overall strength score
    let strength = 50;

    // RSI contribution (oversold = good buy opportunity)
    if (rsi < 30) strength += 15;
    else if (rsi > 70) strength -= 15;

    // Trend contribution
    if (trend === 'bullish') strength += 15;
    else if (trend === 'bearish') strength -= 15;

    // MACD contribution
    if (macd > 0) strength += 10;
    else strength -= 10;

    // Momentum contribution
    strength += Math.min(Math.max(momentum, -10), 10);

    strength = Math.min(Math.max(strength, 0), 100);

    return {
      symbol,
      price: currentPrice,
      volume: Math.random() * 10000000,
      volatility,
      trend,
      rsi,
      macd,
      momentum,
      strength
    };
  }

  /**
   * Scan multiple assets and rank opportunities
   */
  async scanMarkets(assetType: 'crypto' | 'forex' | 'commodities' | 'all' = 'all'): Promise<AssetOpportunity[]> {
    let assetsToScan: string[] = [];

    if (assetType === 'all') {
      assetsToScan = [...this.POPULAR_CRYPTO, ...this.POPULAR_FOREX, ...this.POPULAR_COMMODITIES];
    } else if (assetType === 'crypto') {
      assetsToScan = this.POPULAR_CRYPTO;
    } else if (assetType === 'forex') {
      assetsToScan = this.POPULAR_FOREX;
    } else if (assetType === 'commodities') {
      assetsToScan = this.POPULAR_COMMODITIES;
    }

    const opportunities: AssetOpportunity[] = [];

    for (const symbol of assetsToScan) {
      const metrics = await this.analyzeAsset(symbol);
      const opportunity = this.evaluateOpportunity(metrics);
      opportunities.push(opportunity);
    }

    // Sort by score (best opportunities first)
    return opportunities.sort((a, b) => b.score - a.score);
  }

  /**
   * Evaluate trading opportunity based on metrics
   */
  private evaluateOpportunity(metrics: MarketMetrics): AssetOpportunity {
    const reasons: string[] = [];
    let score = metrics.strength;
    let signal: AssetOpportunity['signal'] = 'neutral';

    // RSI Analysis
    if (metrics.rsi < 30) {
      reasons.push(`Oversold (RSI: ${metrics.rsi.toFixed(1)})`);
      score += 10;
    } else if (metrics.rsi > 70) {
      reasons.push(`Overbought (RSI: ${metrics.rsi.toFixed(1)})`);
      score -= 10;
    }

    // Trend Analysis
    if (metrics.trend === 'bullish') {
      reasons.push('Strong bullish trend');
      score += 10;
    } else if (metrics.trend === 'bearish') {
      reasons.push('Bearish trend detected');
      score -= 10;
    }

    // MACD Analysis
    if (metrics.macd > 0) {
      reasons.push('Positive MACD signal');
      score += 5;
    } else {
      reasons.push('Negative MACD signal');
      score -= 5;
    }

    // Momentum Analysis
    if (metrics.momentum > 5) {
      reasons.push(`Strong upward momentum (+${metrics.momentum.toFixed(1)}%)`);
      score += 8;
    } else if (metrics.momentum < -5) {
      reasons.push(`Downward momentum (${metrics.momentum.toFixed(1)}%)`);
      score -= 8;
    }

    // Volatility Analysis
    if (metrics.volatility > 5) {
      reasons.push('High volatility - higher risk/reward');
    } else if (metrics.volatility < 1) {
      reasons.push('Low volatility - stable asset');
    }

    // Determine signal
    score = Math.min(Math.max(score, 0), 100);

    if (score >= 75) signal = 'strong_buy';
    else if (score >= 60) signal = 'buy';
    else if (score >= 40) signal = 'neutral';
    else if (score >= 25) signal = 'sell';
    else signal = 'strong_sell';

    // Calculate confidence
    const confidence = Math.abs(score - 50) * 2;

    return {
      symbol: metrics.symbol,
      score,
      signal,
      confidence,
      metrics,
      reasons
    };
  }

  /**
   * Find the best asset to trade right now
   */
  async findBestAsset(
    assetType: 'crypto' | 'forex' | 'commodities' | 'all' = 'all',
    minScore: number = 60
  ): Promise<AssetOpportunity | null> {
    const opportunities = await this.scanMarkets(assetType);
    const best = opportunities[0];

    if (best && best.score >= minScore) {
      return best;
    }

    return null;
  }

  /**
   * Get top N trading opportunities
   */
  async getTopOpportunities(
    count: number = 5,
    assetType: 'crypto' | 'forex' | 'commodities' | 'all' = 'all'
  ): Promise<AssetOpportunity[]> {
    const opportunities = await this.scanMarkets(assetType);
    return opportunities.slice(0, count);
  }
}

export const marketAnalyzer = new MarketAnalyzer();
export default marketAnalyzer;
