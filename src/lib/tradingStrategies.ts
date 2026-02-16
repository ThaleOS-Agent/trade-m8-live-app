/**
 * AI-Powered Trading Strategies
 * Advanced algorithmic trading strategies with auto-asset selection
 */

import { signalAggregator, TradingSignal } from './signalAggregator';
import { marketAnalyzer } from './marketAnalyzer';
import { newsSentiment } from './newsSentiment';

export interface StrategyConfig {
  name: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  minConfidence: number;
  assetTypes: ('crypto' | 'forex' | 'commodities' | 'all')[];
  useNewsAnalysis: boolean;
  useTechnicalAnalysis: boolean;
  autoSelectAsset: boolean;
}

export interface TradeDecision {
  shouldTrade: boolean;
  symbol: string | null;
  action: 'buy' | 'sell' | 'hold';
  quantity: number;
  confidence: number;
  reason: string;
  stopLoss?: number;
  takeProfit?: number;
  signal?: TradingSignal;
}

export const STRATEGIES: Record<string, StrategyConfig> = {
  ai_momentum: {
    name: 'AI Momentum Hunter',
    description: 'Identifies assets with strong momentum using AI-powered technical and sentiment analysis. Auto-selects best opportunities.',
    riskLevel: 'medium',
    minConfidence: 70,
    assetTypes: ['all'],
    useNewsAnalysis: true,
    useTechnicalAnalysis: true,
    autoSelectAsset: true
  },

  news_driven: {
    name: 'News Sentiment Trader',
    description: 'Trades based on real-time news sentiment analysis. Reacts to market-moving events and headlines.',
    riskLevel: 'high',
    minConfidence: 75,
    assetTypes: ['crypto', 'forex'],
    useNewsAnalysis: true,
    useTechnicalAnalysis: false,
    autoSelectAsset: true
  },

  technical_master: {
    name: 'Technical Analysis Master',
    description: 'Pure technical analysis using RSI, MACD, trend detection, and volatility. No news sentiment.',
    riskLevel: 'medium',
    minConfidence: 65,
    assetTypes: ['all'],
    useNewsAnalysis: false,
    useTechnicalAnalysis: true,
    autoSelectAsset: true
  },

  conservative_auto: {
    name: 'Conservative Auto-Trader',
    description: 'Low-risk strategy focusing on stable assets with strong fundamentals and positive sentiment.',
    riskLevel: 'low',
    minConfidence: 80,
    assetTypes: ['forex', 'commodities'],
    useNewsAnalysis: true,
    useTechnicalAnalysis: true,
    autoSelectAsset: true
  },

  aggressive_growth: {
    name: 'Aggressive Growth',
    description: 'High-risk, high-reward strategy targeting volatile assets with strong growth potential.',
    riskLevel: 'high',
    minConfidence: 60,
    assetTypes: ['crypto'],
    useNewsAnalysis: true,
    useTechnicalAnalysis: true,
    autoSelectAsset: true
  },

  scalping_bot: {
    name: 'AI Scalping Bot',
    description: 'Short-term trades exploiting small price movements. Requires low volatility and clear signals.',
    riskLevel: 'medium',
    minConfidence: 75,
    assetTypes: ['crypto', 'forex'],
    useNewsAnalysis: false,
    useTechnicalAnalysis: true,
    autoSelectAsset: true
  },

  swing_trader: {
    name: 'Swing Trading AI',
    description: 'Medium-term trades capturing larger price swings. Combines trend analysis with sentiment.',
    riskLevel: 'medium',
    minConfidence: 70,
    assetTypes: ['all'],
    useNewsAnalysis: true,
    useTechnicalAnalysis: true,
    autoSelectAsset: true
  },

  breakout_hunter: {
    name: 'Breakout Hunter',
    description: 'Detects and trades breakouts from consolidation patterns. High success rate with proper risk management.',
    riskLevel: 'medium',
    minConfidence: 72,
    assetTypes: ['crypto', 'forex'],
    useNewsAnalysis: true,
    useTechnicalAnalysis: true,
    autoSelectAsset: true
  },

  trend_follower: {
    name: 'Trend Following Pro',
    description: 'Follows established trends with trailing stops. "The trend is your friend" strategy.',
    riskLevel: 'low',
    minConfidence: 75,
    assetTypes: ['all'],
    useNewsAnalysis: false,
    useTechnicalAnalysis: true,
    autoSelectAsset: true
  },

  multi_asset_diversified: {
    name: 'Multi-Asset Diversified',
    description: 'Trades across multiple asset classes for diversification. Balances risk across crypto, forex, and commodities.',
    riskLevel: 'low',
    minConfidence: 75,
    assetTypes: ['all'],
    useNewsAnalysis: true,
    useTechnicalAnalysis: true,
    autoSelectAsset: true
  }
};

class TradingStrategy {
  /**
   * Execute AI Momentum Hunter strategy
   */
  async aiMomentumHunter(portfolio: number = 10000): Promise<TradeDecision> {
    const recommendation = await signalAggregator.getAutoTradingRecommendation('all', 70);

    if (!recommendation.bestAsset || !recommendation.shouldTrade) {
      return {
        shouldTrade: false,
        symbol: null,
        action: 'hold',
        quantity: 0,
        confidence: 0,
        reason: recommendation.warnings.join(', ') || 'No strong signals detected'
      };
    }

    const signal = recommendation.bestAsset;
    const quantity = this.calculatePosition(portfolio, signal.metrics.price, signal.confidence, 'medium');

    return {
      shouldTrade: true,
      symbol: signal.symbol,
      action: signal.action === 'strong_buy' || signal.action === 'buy' ? 'buy' : 'sell',
      quantity,
      confidence: signal.confidence,
      reason: `Strong ${signal.action} signal: ${signal.reasons.join(', ')}`,
      stopLoss: signal.metrics.price * 0.95, // 5% stop loss
      takeProfit: signal.metrics.price * 1.10, // 10% take profit
      signal
    };
  }

  /**
   * Execute News Sentiment strategy
   */
  async newsSentimentTrader(portfolio: number = 10000): Promise<TradeDecision> {
    const symbols = ['BTC/USD', 'ETH/USD', 'EUR/USD', 'GBP/USD', 'XAU/USD'];
    const bestNews = await newsSentiment.findBullishNews(symbols, 40);

    if (bestNews.length === 0) {
      return {
        shouldTrade: false,
        symbol: null,
        action: 'hold',
        quantity: 0,
        confidence: 0,
        reason: 'No positive news sentiment found'
      };
    }

    const top = bestNews[0];
    const signal = await signalAggregator.generateSignal(top.symbol);

    if (signal.confidence < 75) {
      return {
        shouldTrade: false,
        symbol: null,
        action: 'hold',
        quantity: 0,
        confidence: signal.confidence,
        reason: 'News positive but technical signals weak'
      };
    }

    const quantity = this.calculatePosition(portfolio, signal.metrics.price, signal.confidence, 'high');

    return {
      shouldTrade: true,
      symbol: signal.symbol,
      action: top.recommendation === 'buy' ? 'buy' : 'sell',
      quantity,
      confidence: signal.confidence,
      reason: `Strong news sentiment: ${top.topHeadlines[0]?.title || 'Positive news'}`,
      stopLoss: signal.metrics.price * 0.93, // 7% stop loss (higher risk)
      takeProfit: signal.metrics.price * 1.15, // 15% take profit
      signal
    };
  }

  /**
   * Execute Technical Analysis Master strategy
   */
  async technicalMaster(portfolio: number = 10000): Promise<TradeDecision> {
    const opportunities = await marketAnalyzer.scanMarkets('all');
    const best = opportunities.find(o => o.score >= 65 && o.confidence >= 65);

    if (!best) {
      return {
        shouldTrade: false,
        symbol: null,
        action: 'hold',
        quantity: 0,
        confidence: 0,
        reason: 'No strong technical signals'
      };
    }

    const quantity = this.calculatePosition(portfolio, best.metrics.price, best.confidence, 'medium');

    return {
      shouldTrade: true,
      symbol: best.symbol,
      action: best.signal === 'strong_buy' || best.signal === 'buy' ? 'buy' : 'sell',
      quantity,
      confidence: best.confidence,
      reason: best.reasons.join(', '),
      stopLoss: best.metrics.price * 0.96, // 4% stop loss
      takeProfit: best.metrics.price * 1.08 // 8% take profit
    };
  }

  /**
   * Calculate position size based on risk level
   */
  private calculatePosition(
    portfolio: number,
    price: number,
    confidence: number,
    riskLevel: 'low' | 'medium' | 'high'
  ): number {
    let riskPercent: number;

    switch (riskLevel) {
      case 'low':
        riskPercent = 0.02; // 2% of portfolio
        break;
      case 'medium':
        riskPercent = 0.05; // 5% of portfolio
        break;
      case 'high':
        riskPercent = 0.10; // 10% of portfolio
        break;
    }

    // Adjust based on confidence
    const confidenceMultiplier = confidence / 100;
    const adjustedRisk = riskPercent * confidenceMultiplier;

    const positionValue = portfolio * adjustedRisk;
    const quantity = positionValue / price;

    return Math.max(quantity, 0.001); // Minimum position
  }

  /**
   * Execute strategy by name
   */
  async executeStrategy(
    strategyName: string,
    portfolio: number = 10000,
    customSymbol?: string
  ): Promise<TradeDecision> {
    const config = STRATEGIES[strategyName];
    if (!config) {
      throw new Error(`Unknown strategy: ${strategyName}`);
    }

    // If custom symbol provided and auto-select is disabled
    if (customSymbol && !config.autoSelectAsset) {
      const signal = await signalAggregator.generateSignal(customSymbol);

      if (signal.confidence < config.minConfidence) {
        return {
          shouldTrade: false,
          symbol: customSymbol,
          action: 'hold',
          quantity: 0,
          confidence: signal.confidence,
          reason: `Confidence ${signal.confidence}% below minimum ${config.minConfidence}%`
        };
      }

      const quantity = this.calculatePosition(portfolio, signal.metrics.price, signal.confidence, config.riskLevel);

      return {
        shouldTrade: true,
        symbol: customSymbol,
        action: signal.action === 'strong_buy' || signal.action === 'buy' ? 'buy' : 'sell',
        quantity,
        confidence: signal.confidence,
        reason: signal.reasons.join(', '),
        signal
      };
    }

    // Auto-select best asset based on strategy
    switch (strategyName) {
      case 'ai_momentum':
        return this.aiMomentumHunter(portfolio);
      case 'news_driven':
        return this.newsSentimentTrader(portfolio);
      case 'technical_master':
        return this.technicalMaster(portfolio);
      default:
        // Use general auto-selection
        return this.aiMomentumHunter(portfolio);
    }
  }

  /**
   * Get all available strategies
   */
  getStrategies(): StrategyConfig[] {
    return Object.values(STRATEGIES);
  }

  /**
   * Get strategy by name
   */
  getStrategy(name: string): StrategyConfig | undefined {
    return STRATEGIES[name];
  }
}

export const tradingStrategy = new TradingStrategy();
export default tradingStrategy;
