/**
 * Backtesting Engine for Trade M8
 * Tests trading strategies against historical data
 */

import { createAdvancedRiskManager } from './advanced-risk-manager';
import { createAIEnhancementEngine } from './ai-enhancement-engine';
import { createPortfolioManager } from './portfolio-manager';

export interface HistoricalDataPoint {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestConfig {
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  strategy: 'ai_momentum' | 'news_driven' | 'technical_master' | 'ensemble';
  enableAI: boolean;
  enableRiskManagement: boolean;
  riskConfig?: any;
  aiConfig?: any;
}

export interface BacktestTrade {
  timestamp: string;
  symbol: string;
  action: 'buy' | 'sell';
  price: number;
  quantity: number;
  value: number;
  fees: number;
  reason: string;
  aiConfidence?: number;
  riskScore?: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  summary: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalReturn: number;
    totalReturnPercent: number;
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
    largestWin: number;
    largestLoss: number;
    avgHoldingPeriod: number;
    finalCapital: number;
    totalFees: number;
  };
  trades: BacktestTrade[];
  equityCurve: Array<{
    timestamp: string;
    equity: number;
    drawdown: number;
  }>;
  monthlyReturns: Array<{
    month: string;
    return: number;
    trades: number;
  }>;
  performance: {
    daily: number[];
    weekly: number[];
    monthly: number[];
  };
}

export class BacktestingEngine {
  private riskManager: any;
  private aiEngine: any;
  private portfolio: any;

  async runBacktest(
    config: BacktestConfig,
    historicalData: HistoricalDataPoint[]
  ): Promise<BacktestResult> {
    console.log('🧪 Starting Backtest...');
    console.log(`   Symbol: ${config.symbol}`);
    console.log(`   Period: ${config.startDate} to ${config.endDate}`);
    console.log(`   Initial Capital: $${config.initialCapital}`);
    console.log(`   Strategy: ${config.strategy}`);
    console.log(`   AI Enhancement: ${config.enableAI ? 'Enabled' : 'Disabled'}`);

    // Initialize systems
    this.portfolio = createPortfolioManager(config.initialCapital);

    if (config.enableRiskManagement) {
      this.riskManager = createAdvancedRiskManager(config.riskConfig);
    }

    if (config.enableAI) {
      this.aiEngine = createAIEnhancementEngine(config.aiConfig);
    }

    const trades: BacktestTrade[] = [];
    const equityCurve: Array<{ timestamp: string; equity: number; drawdown: number }> = [];

    // Process each data point
    for (let i = 50; i < historicalData.length; i++) {
      const currentBar = historicalData[i];
      const recentBars = historicalData.slice(i - 50, i);

      // Update position prices
      const currentPositions = this.portfolio.getAllPositions();
      if (currentPositions.length > 0) {
        const prices: Record<string, number> = {};
        prices[config.symbol] = currentBar.close;
        this.portfolio.updatePositionPrices(prices);
      }

      // Generate trading signal
      const signal = await this.generateSignal(
        config.symbol,
        recentBars,
        currentBar,
        config.strategy
      );

      if (signal.action !== 'hold') {
        // Check if we can take this trade
        const canTrade = await this.canExecuteTrade(signal, currentBar, config);

        if (canTrade.approved) {
          // Execute trade
          const trade = await this.executeTrade(signal, currentBar, config);
          if (trade) {
            trades.push(trade);
          }
        }
      }

      // Record equity curve
      const metrics = this.portfolio.getPortfolioMetrics();
      const performance = this.portfolio.getPerformanceMetrics();

      equityCurve.push({
        timestamp: currentBar.timestamp,
        equity: metrics.totalValue,
        drawdown: performance.currentDrawdown
      });

      // Take snapshot every 24 bars (daily if hourly data)
      if (i % 24 === 0) {
        this.portfolio.takeSnapshot();
      }
    }

    // Close any open positions at end
    const finalPositions = this.portfolio.getAllPositions();
    const lastBar = historicalData[historicalData.length - 1];

    for (const position of finalPositions) {
      this.portfolio.closePosition(position.id, lastBar.close, 0);

      trades.push({
        timestamp: lastBar.timestamp,
        symbol: config.symbol,
        action: 'sell',
        price: lastBar.close,
        quantity: position.quantity,
        value: position.quantity * lastBar.close,
        fees: 0,
        reason: 'End of backtest - closing position'
      });
    }

    // Calculate final results
    const finalMetrics = this.portfolio.getPortfolioMetrics();
    const finalPerformance = this.portfolio.getPerformanceMetrics();

    const summary = {
      totalTrades: finalPerformance.totalTrades,
      winningTrades: finalPerformance.winningTrades,
      losingTrades: finalPerformance.losingTrades,
      winRate: finalPerformance.winRate,
      totalReturn: finalMetrics.totalPnL,
      totalReturnPercent: finalMetrics.totalPnLPercent,
      sharpeRatio: finalPerformance.sharpeRatio,
      sortinoRatio: finalPerformance.sortinoRatio,
      maxDrawdown: finalPerformance.maxDrawdown,
      profitFactor: finalPerformance.profitFactor,
      avgWin: finalPerformance.avgWin,
      avgLoss: finalPerformance.avgLoss,
      largestWin: finalPerformance.largestWin,
      largestLoss: finalPerformance.largestLoss,
      avgHoldingPeriod: finalPerformance.avgHoldingPeriod,
      finalCapital: finalMetrics.totalValue,
      totalFees: trades.reduce((sum, t) => sum + t.fees, 0)
    };

    // Calculate monthly returns
    const monthlyReturns = this.calculateMonthlyReturns(equityCurve);

    console.log('\n✅ Backtest Complete!');
    console.log(`   Total Trades: ${summary.totalTrades}`);
    console.log(`   Win Rate: ${summary.winRate.toFixed(2)}%`);
    console.log(`   Total Return: $${summary.totalReturn.toFixed(2)} (${summary.totalReturnPercent.toFixed(2)}%)`);
    console.log(`   Sharpe Ratio: ${summary.sharpeRatio.toFixed(2)}`);
    console.log(`   Max Drawdown: ${(summary.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`   Final Capital: $${summary.finalCapital.toFixed(2)}`);

    return {
      config,
      summary,
      trades,
      equityCurve,
      monthlyReturns,
      performance: {
        daily: [],
        weekly: [],
        monthly: []
      }
    };
  }

  private async generateSignal(
    symbol: string,
    recentBars: HistoricalDataPoint[],
    currentBar: HistoricalDataPoint,
    strategy: string
  ): Promise<{ action: 'buy' | 'sell' | 'hold'; confidence: number; reason: string }> {
    // Calculate technical indicators
    const closes = recentBars.map(b => b.close);
    const volumes = recentBars.map(b => b.volume);

    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = this.calculateSMA(closes, 50);
    const rsi = this.calculateRSI(closes, 14);
    const macd = this.calculateMACD(closes);
    const momentum = (currentBar.close - recentBars[recentBars.length - 10].close) / recentBars[recentBars.length - 10].close;

    // Strategy-specific logic
    let baseSignal: 'buy' | 'sell' | 'hold' = 'hold';
    let baseConfidence = 0.5;
    let reason = '';

    if (strategy === 'technical_master' || strategy === 'ensemble') {
      // Moving average crossover
      if (sma20 > sma50 && closes[closes.length - 2] <= recentBars[recentBars.length - 2].close) {
        baseSignal = 'buy';
        baseConfidence = 0.7;
        reason = 'SMA crossover bullish';
      } else if (sma20 < sma50 && closes[closes.length - 2] >= recentBars[recentBars.length - 2].close) {
        baseSignal = 'sell';
        baseConfidence = 0.7;
        reason = 'SMA crossover bearish';
      }

      // RSI oversold/overbought
      if (rsi < 30) {
        baseSignal = 'buy';
        baseConfidence = Math.max(baseConfidence, 0.65);
        reason += ' + RSI oversold';
      } else if (rsi > 70) {
        baseSignal = 'sell';
        baseConfidence = Math.max(baseConfidence, 0.65);
        reason += ' + RSI overbought';
      }

      // MACD confirmation
      if (macd.histogram > 0 && baseSignal === 'buy') {
        baseConfidence += 0.1;
        reason += ' + MACD bullish';
      } else if (macd.histogram < 0 && baseSignal === 'sell') {
        baseConfidence += 0.1;
        reason += ' + MACD bearish';
      }
    }

    // AI enhancement
    if (this.aiEngine && baseSignal !== 'hold') {
      const enhanced = await this.aiEngine.enhanceSignal(
        symbol,
        baseSignal,
        baseConfidence,
        {
          price: currentBar.close,
          volume: currentBar.volume,
          volatility: this.calculateVolatility(closes),
          rsi,
          macd,
          momentum,
          priceHistory: closes,
          volumeHistory: volumes
        }
      );

      return {
        action: enhanced.enhancedSignal.includes('buy') ? 'buy' : enhanced.enhancedSignal.includes('sell') ? 'sell' : 'hold',
        confidence: enhanced.enhancedConfidence,
        reason: enhanced.reasoning.join(', ')
      };
    }

    return { action: baseSignal, confidence: baseConfidence, reason };
  }

  private async canExecuteTrade(
    signal: any,
    currentBar: HistoricalDataPoint,
    config: BacktestConfig
  ): Promise<{ approved: boolean; reason?: string }> {
    const metrics = this.portfolio.getPortfolioMetrics();
    const positions = this.portfolio.getAllPositions();

    // Check if we have enough capital
    const tradeSize = metrics.totalValue * 0.10; // 10% position size

    if (signal.action === 'buy' && metrics.cashBalance < tradeSize) {
      return { approved: false, reason: 'Insufficient capital' };
    }

    // Check if we already have a position
    if (positions.length > 0 && signal.action === 'buy') {
      return { approved: false, reason: 'Position already open' };
    }

    if (positions.length === 0 && signal.action === 'sell') {
      return { approved: false, reason: 'No position to sell' };
    }

    // Risk management check
    if (this.riskManager && config.enableRiskManagement) {
      const riskCheck = await this.riskManager.checkPreTradeRisk(
        config.symbol,
        tradeSize,
        positions.reduce((acc: any, pos: any) => {
          acc[pos.symbol] = { value: pos.value };
          return acc;
        }, {}),
        metrics.totalValue
      );

      if (!riskCheck.approved) {
        return { approved: false, reason: riskCheck.blockers.join(', ') };
      }
    }

    return { approved: true };
  }

  private async executeTrade(
    signal: any,
    currentBar: HistoricalDataPoint,
    config: BacktestConfig
  ): Promise<BacktestTrade | null> {
    const metrics = this.portfolio.getPortfolioMetrics();
    const positions = this.portfolio.getAllPositions();

    if (signal.action === 'buy') {
      const tradeSize = metrics.totalValue * 0.10; // 10% position size
      const quantity = tradeSize / currentBar.close;
      const fees = tradeSize * 0.001; // 0.1% fees

      this.portfolio.addPosition({
        symbol: config.symbol,
        side: 'buy',
        type: 'market',
        quantity,
        entryPrice: currentBar.close,
        fees,
        exchange: 'backtest',
        strategy: config.strategy
      });

      return {
        timestamp: currentBar.timestamp,
        symbol: config.symbol,
        action: 'buy',
        price: currentBar.close,
        quantity,
        value: tradeSize,
        fees,
        reason: signal.reason,
        aiConfidence: signal.confidence
      };
    } else if (signal.action === 'sell' && positions.length > 0) {
      const position = positions[0];
      const fees = position.value * 0.001;

      this.portfolio.closePosition(position.id, currentBar.close, fees);

      return {
        timestamp: currentBar.timestamp,
        symbol: config.symbol,
        action: 'sell',
        price: currentBar.close,
        quantity: position.quantity,
        value: position.value,
        fees,
        reason: signal.reason,
        aiConfidence: signal.confidence
      };
    }

    return null;
  }

  private calculateSMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1];
    const slice = data.slice(-period);
    return slice.reduce((sum, val) => sum + val, 0) / period;
  }

  private calculateRSI(data: number[], period: number = 14): number {
    if (data.length < period + 1) return 50;
    const changes = data.slice(1).map((v, i) => v - data[i]);
    // Wilder's smoothing (Fix #5)
    let avgGain = changes.slice(0, period).reduce((s, c) => s + Math.max(c, 0), 0) / period;
    let avgLoss = changes.slice(0, period).reduce((s, c) => s + Math.max(-c, 0), 0) / period;
    for (const c of changes.slice(period)) {
      avgGain = (avgGain * (period - 1) + Math.max(c, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-c, 0)) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
  }

  private calculateMACD(data: number[]): { value: number; signal: number; histogram: number } {
    if (data.length < 35) return { value: 0, signal: 0, histogram: 0 };
    // Build MACD line with single incremental pass (Fix #8)
    const fastK = 2 / 13, slowK = 2 / 27, sigK = 2 / 10;
    const macdLine: number[] = [];
    let fastEma = data[0], slowEma = data[0];
    for (let i = 1; i < data.length; i++) {
      fastEma = data[i] * fastK + fastEma * (1 - fastK);
      slowEma = data[i] * slowK + slowEma * (1 - slowK);
      if (i >= 25) macdLine.push(fastEma - slowEma);
    }
    // Signal line as EMA of MACD line
    let sigEma = macdLine[0];
    for (let i = 1; i < macdLine.length; i++) {
      sigEma = macdLine[i] * sigK + sigEma * (1 - sigK);
    }
    const value = macdLine[macdLine.length - 1];
    return { value, signal: sigEma, histogram: value - sigEma };
  }

  private calculateEMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1];
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private calculateVolatility(data: number[]): number {
    if (data.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < data.length; i++) {
      returns.push((data[i] - data[i - 1]) / data[i - 1]);
    }

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }

  private calculateMonthlyReturns(equityCurve: Array<{ timestamp: string; equity: number }>): Array<{ month: string; return: number; trades: number }> {
    const monthlyData: Record<string, { startEquity: number; endEquity: number; trades: number }> = {};

    equityCurve.forEach(point => {
      const month = point.timestamp.substring(0, 7); // YYYY-MM

      if (!monthlyData[month]) {
        monthlyData[month] = {
          startEquity: point.equity,
          endEquity: point.equity,
          trades: 0
        };
      }

      monthlyData[month].endEquity = point.equity;
    });

    return Object.entries(monthlyData).map(([month, data]) => ({
      month,
      return: ((data.endEquity - data.startEquity) / data.startEquity) * 100,
      trades: data.trades
    }));
  }
}

// Factory function
export function createBacktestingEngine(): BacktestingEngine {
  return new BacktestingEngine();
}

// Generate sample historical data for testing
export function generateSampleHistoricalData(
  symbol: string,
  days: number = 365,
  startPrice: number = 50000
): HistoricalDataPoint[] {
  const data: HistoricalDataPoint[] = [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  let price = startPrice;

  for (let i = 0; i < days * 24; i++) { // Hourly data
    const timestamp = new Date(startDate.getTime() + i * 60 * 60 * 1000);

    // Random walk with trend
    const change = (Math.random() - 0.48) * 0.02; // Slight upward bias
    price = price * (1 + change);

    const high = price * (1 + Math.random() * 0.01);
    const low = price * (1 - Math.random() * 0.01);
    const volume = Math.random() * 10000000 + 1000000;

    data.push({
      timestamp: timestamp.toISOString(),
      open: price,
      high,
      low,
      close: price,
      volume
    });
  }

  return data;
}
