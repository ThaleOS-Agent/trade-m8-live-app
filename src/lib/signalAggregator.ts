/**
 * Signal Aggregator
 * Combines technical analysis, market data, and news sentiment
 * to generate comprehensive trading signals
 */

import { marketAnalyzer, AssetOpportunity } from './marketAnalyzer';
import { newsSentiment, SentimentAnalysis } from './newsSentiment';

export interface TradingSignal {
  symbol: string;
  action: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  confidence: number; // 0-100
  score: number; // 0-100
  technicalScore: number;
  sentimentScore: number;
  combinedScore: number;
  reasons: string[];
  metrics: {
    price: number;
    rsi: number;
    trend: string;
    volatility: number;
    momentum: number;
    newsScore: number;
    newsSentiment: string;
  };
  timestamp: Date;
}

export interface AutoTradingRecommendation {
  bestAsset: TradingSignal | null;
  topOpportunities: TradingSignal[];
  marketCondition: 'bullish' | 'bearish' | 'neutral' | 'volatile';
  riskLevel: 'low' | 'medium' | 'high';
  shouldTrade: boolean;
  warnings: string[];
}

class SignalAggregator {
  /**
   * Combine technical and sentiment analysis
   */
  async generateSignal(symbol: string): Promise<TradingSignal> {
    // Get technical analysis
    const marketMetrics = await marketAnalyzer.analyzeAsset(symbol);
    const technicalOpp = await marketAnalyzer.scanMarkets('all');
    const technical = technicalOpp.find(o => o.symbol === symbol);

    // Get sentiment analysis
    const sentiment = await newsSentiment.analyzeSymbol(symbol);

    // Calculate scores
    const technicalScore = technical?.score || 50;
    const sentimentScore = ((sentiment.sentimentScore + 100) / 2); // Convert -100/100 to 0/100

    // Weighted combination (60% technical, 40% sentiment)
    const combinedScore = (technicalScore * 0.6) + (sentimentScore * 0.4);

    // Determine action
    let action: TradingSignal['action'];
    if (combinedScore >= 75) action = 'strong_buy';
    else if (combinedScore >= 60) action = 'buy';
    else if (combinedScore >= 40) action = 'hold';
    else if (combinedScore >= 25) action = 'sell';
    else action = 'strong_sell';

    // Calculate confidence
    const confidence = Math.abs(combinedScore - 50) * 2;

    // Compile reasons
    const reasons: string[] = [];

    if (technical) {
      reasons.push(...technical.reasons);
    }

    if (sentiment.sentimentScore > 30) {
      reasons.push(`Positive news sentiment (+${sentiment.sentimentScore.toFixed(0)})`);
    } else if (sentiment.sentimentScore < -30) {
      reasons.push(`Negative news sentiment (${sentiment.sentimentScore.toFixed(0)})`);
    }

    if (sentiment.topHeadlines.length > 0) {
      reasons.push(`${sentiment.newsCount} recent news articles analyzed`);
    }

    return {
      symbol,
      action,
      confidence,
      score: combinedScore,
      technicalScore,
      sentimentScore,
      combinedScore,
      reasons,
      metrics: {
        price: marketMetrics.price,
        rsi: marketMetrics.rsi,
        trend: marketMetrics.trend,
        volatility: marketMetrics.volatility,
        momentum: marketMetrics.momentum,
        newsScore: sentiment.sentimentScore,
        newsSentiment: sentiment.overallSentiment
      },
      timestamp: new Date()
    };
  }

  /**
   * Scan market and generate signals for multiple assets
   */
  async scanAndGenerate(
    assetType: 'crypto' | 'forex' | 'commodities' | 'all' = 'all',
    minScore: number = 60
  ): Promise<TradingSignal[]> {
    // Get top opportunities from market analyzer
    const opportunities = await marketAnalyzer.scanMarkets(assetType);

    // Generate signals for top assets
    const signals: TradingSignal[] = [];

    for (const opp of opportunities.slice(0, 10)) {
      const signal = await this.generateSignal(opp.symbol);
      if (signal.score >= minScore) {
        signals.push(signal);
      }
    }

    return signals.sort((a, b) => b.score - a.score);
  }

  /**
   * Get auto-trading recommendation
   */
  async getAutoTradingRecommendation(
    assetType: 'crypto' | 'forex' | 'commodities' | 'all' = 'all',
    minConfidence: number = 70
  ): Promise<AutoTradingRecommendation> {
    const signals = await this.scanAndGenerate(assetType, 50);
    const warnings: string[] = [];

    // Analyze market condition
    const avgScore = signals.reduce((sum, s) => sum + s.score, 0) / signals.length;
    const avgVolatility = signals.reduce((sum, s) => sum + s.metrics.volatility, 0) / signals.length;

    let marketCondition: AutoTradingRecommendation['marketCondition'];
    if (avgScore > 60) marketCondition = 'bullish';
    else if (avgScore < 40) marketCondition = 'bearish';
    else if (avgVolatility > 5) marketCondition = 'volatile';
    else marketCondition = 'neutral';

    // Determine risk level
    let riskLevel: AutoTradingRecommendation['riskLevel'];
    if (avgVolatility > 7) {
      riskLevel = 'high';
      warnings.push('High market volatility detected - increased risk');
    } else if (avgVolatility > 4) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    // Find best asset
    const bestAsset = signals.find(s => s.confidence >= minConfidence && s.action !== 'hold') || null;

    // Get top opportunities
    const topOpportunities = signals
      .filter(s => s.action === 'buy' || s.action === 'strong_buy')
      .slice(0, 5);

    // Determine if should trade
    let shouldTrade = false;
    if (bestAsset && bestAsset.confidence >= minConfidence) {
      shouldTrade = true;
    } else {
      warnings.push('No high-confidence trading opportunities found');
    }

    if (marketCondition === 'volatile' && riskLevel === 'high') {
      warnings.push('Extreme volatility - consider waiting for market stabilization');
      shouldTrade = false;
    }

    if (topOpportunities.length === 0) {
      warnings.push('No buy signals detected in current market');
    }

    return {
      bestAsset,
      topOpportunities,
      marketCondition,
      riskLevel,
      shouldTrade,
      warnings
    };
  }

  /**
   * Generate signals for specific symbols
   */
  async getSignalsFor(symbols: string[]): Promise<Map<string, TradingSignal>> {
    const signalMap = new Map<string, TradingSignal>();

    for (const symbol of symbols) {
      const signal = await this.generateSignal(symbol);
      signalMap.set(symbol, signal);
    }

    return signalMap;
  }

  /**
   * Find best trading opportunity right now
   */
  async findBestOpportunity(
    assetType: 'crypto' | 'forex' | 'commodities' | 'all' = 'all'
  ): Promise<TradingSignal | null> {
    const recommendation = await this.getAutoTradingRecommendation(assetType, 70);
    return recommendation.bestAsset;
  }
}

export const signalAggregator = new SignalAggregator();
export default signalAggregator;
