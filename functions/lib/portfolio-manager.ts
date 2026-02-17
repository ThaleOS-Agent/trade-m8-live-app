/**
 * Advanced Portfolio Management System for Trade M8
 * Real-time P&L tracking, performance analytics, and position management
 */

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  value: number;
  pnl: number;
  pnlPercent: number;
  stopLoss?: number;
  takeProfit?: number;
  entryTime: string;
  exchange: string;
  strategy?: string;
}

export interface PortfolioMetrics {
  totalValue: number;
  totalPnL: number;
  totalPnLPercent: number;
  dailyPnL: number;
  weeklyPnL: number;
  monthlyPnL: number;
  realizedPnL: number;
  unrealizedPnL: number;
  cashBalance: number;
  investedCapital: number;
  availableCapital: number;
  exposure: number;
  exposurePercent: number;
}

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
  avgHoldingPeriod: number;
  returnOnInvestment: number;
  dailyROI: number;
  weeklyROI: number;
  monthlyROI: number;
}

export interface Trade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  fees: number;
  exchange: string;
  strategy?: string;
  entryTime: string;
  exitTime?: string;
  status: 'open' | 'closed';
  stopLoss?: number;
  takeProfit?: number;
}

export interface PortfolioSnapshot {
  timestamp: string;
  totalValue: number;
  cashBalance: number;
  positions: number;
  pnl: number;
  drawdown: number;
  sharpe: number;
}

export class PortfolioManager {
  private positions: Map<string, Position> = new Map();
  private tradeHistory: Trade[] = [];
  private snapshots: PortfolioSnapshot[] = [];
  private initialCapital: number;
  private currentCapital: number;
  private cashBalance: number;

  constructor(initialCapital: number = 10000) {
    this.initialCapital = initialCapital;
    this.currentCapital = initialCapital;
    this.cashBalance = initialCapital;
  }

  /**
   * Add a new position to the portfolio
   */
  addPosition(trade: Omit<Trade, 'id' | 'status' | 'entryTime'>): Position {
    const positionId = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Create trade record
    const newTrade: Trade = {
      ...trade,
      id: tradeId,
      status: 'open',
      entryTime: new Date().toISOString()
    };

    this.tradeHistory.push(newTrade);

    // Calculate position value
    const value = trade.quantity * trade.entryPrice;

    // Update cash balance
    if (trade.side === 'buy') {
      this.cashBalance -= (value + trade.fees);
    }

    // Create position
    const position: Position = {
      id: positionId,
      symbol: trade.symbol,
      side: trade.side === 'buy' ? 'long' : 'short',
      entryPrice: trade.entryPrice,
      currentPrice: trade.entryPrice,
      quantity: trade.quantity,
      value,
      pnl: 0,
      pnlPercent: 0,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      entryTime: newTrade.entryTime,
      exchange: trade.exchange,
      strategy: trade.strategy
    };

    this.positions.set(positionId, position);

    console.log(`Added position: ${positionId} - ${trade.symbol} ${trade.side} ${trade.quantity} @ ${trade.entryPrice}`);

    return position;
  }

  /**
   * Close a position
   */
  closePosition(
    positionId: string,
    exitPrice: number,
    fees: number = 0
  ): { trade: Trade; pnl: number } | null {
    const position = this.positions.get(positionId);
    if (!position) {
      console.error(`Position ${positionId} not found`);
      return null;
    }

    // Calculate P&L
    const pnl = position.side === 'long'
      ? (exitPrice - position.entryPrice) * position.quantity - fees
      : (position.entryPrice - exitPrice) * position.quantity - fees;

    const pnlPercent = (pnl / (position.entryPrice * position.quantity)) * 100;

    // Update cash balance
    const exitValue = position.quantity * exitPrice;
    this.cashBalance += exitValue - fees;

    // Update trade record
    const trade = this.tradeHistory.find(t =>
      t.symbol === position.symbol &&
      t.entryPrice === position.entryPrice &&
      t.status === 'open'
    );

    if (trade) {
      trade.exitPrice = exitPrice;
      trade.exitTime = new Date().toISOString();
      trade.pnl = pnl;
      trade.pnlPercent = pnlPercent;
      trade.status = 'closed';
      trade.fees += fees;
    }

    // Update current capital
    this.currentCapital += pnl;

    // Remove position
    this.positions.delete(positionId);

    console.log(`Closed position: ${positionId} - P&L: ${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);

    return { trade: trade!, pnl };
  }

  /**
   * Update position prices and calculate unrealized P&L
   */
  updatePositionPrices(prices: Record<string, number>): void {
    for (const [positionId, position] of this.positions) {
      const currentPrice = prices[position.symbol];
      if (currentPrice !== undefined) {
        position.currentPrice = currentPrice;
        position.value = position.quantity * currentPrice;

        // Calculate unrealized P&L
        if (position.side === 'long') {
          position.pnl = (currentPrice - position.entryPrice) * position.quantity;
        } else {
          position.pnl = (position.entryPrice - currentPrice) * position.quantity;
        }

        position.pnlPercent = (position.pnl / (position.entryPrice * position.quantity)) * 100;

        // Check stop loss and take profit
        this.checkStopLossAndTakeProfit(positionId, position);
      }
    }
  }

  /**
   * Check stop loss and take profit levels
   */
  private checkStopLossAndTakeProfit(positionId: string, position: Position): void {
    if (position.side === 'long') {
      // Long position
      if (position.stopLoss && position.currentPrice <= position.stopLoss) {
        console.log(`Stop loss triggered for ${positionId} at ${position.currentPrice}`);
        this.closePosition(positionId, position.stopLoss, 0);
      } else if (position.takeProfit && position.currentPrice >= position.takeProfit) {
        console.log(`Take profit triggered for ${positionId} at ${position.currentPrice}`);
        this.closePosition(positionId, position.takeProfit, 0);
      }
    } else {
      // Short position
      if (position.stopLoss && position.currentPrice >= position.stopLoss) {
        console.log(`Stop loss triggered for ${positionId} at ${position.currentPrice}`);
        this.closePosition(positionId, position.stopLoss, 0);
      } else if (position.takeProfit && position.currentPrice <= position.takeProfit) {
        console.log(`Take profit triggered for ${positionId} at ${position.currentPrice}`);
        this.closePosition(positionId, position.takeProfit, 0);
      }
    }
  }

  /**
   * Get portfolio metrics
   */
  getPortfolioMetrics(): PortfolioMetrics {
    const unrealizedPnL = Array.from(this.positions.values()).reduce((sum, pos) => sum + pos.pnl, 0);
    const investedCapital = Array.from(this.positions.values()).reduce(
      (sum, pos) => sum + (pos.entryPrice * pos.quantity),
      0
    );
    const realizedPnL = this.currentCapital - this.initialCapital - unrealizedPnL;
    const totalValue = this.cashBalance + investedCapital + unrealizedPnL;
    const totalPnL = totalValue - this.initialCapital;
    const totalPnLPercent = (totalPnL / this.initialCapital) * 100;

    // Calculate time-based P&L
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const dailyPnL = this.calculatePnLSince(dayAgo);
    const weeklyPnL = this.calculatePnLSince(weekAgo);
    const monthlyPnL = this.calculatePnLSince(monthAgo);

    return {
      totalValue,
      totalPnL,
      totalPnLPercent,
      dailyPnL,
      weeklyPnL,
      monthlyPnL,
      realizedPnL,
      unrealizedPnL,
      cashBalance: this.cashBalance,
      investedCapital,
      availableCapital: this.cashBalance,
      exposure: investedCapital,
      exposurePercent: (investedCapital / totalValue) * 100
    };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    const closedTrades = this.tradeHistory.filter(t => t.status === 'closed');
    const totalTrades = closedTrades.length;

    if (totalTrades === 0) {
      return this.getEmptyPerformanceMetrics();
    }

    const winningTrades = closedTrades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = closedTrades.filter(t => (t.pnl || 0) <= 0);

    const winRate = (winningTrades.length / totalTrades) * 100;

    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / winningTrades.length
      : 0;

    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades.length)
      : 0;

    const largestWin = winningTrades.length > 0
      ? Math.max(...winningTrades.map(t => t.pnl || 0))
      : 0;

    const largestLoss = losingTrades.length > 0
      ? Math.min(...losingTrades.map(t => t.pnl || 0))
      : 0;

    const totalWins = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

    // Calculate holding periods
    const holdingPeriods = closedTrades
      .filter(t => t.exitTime)
      .map(t => {
        const entry = new Date(t.entryTime).getTime();
        const exit = new Date(t.exitTime!).getTime();
        return exit - entry;
      });

    const avgHoldingPeriod = holdingPeriods.length > 0
      ? holdingPeriods.reduce((sum, p) => sum + p, 0) / holdingPeriods.length / 1000 / 60 // minutes
      : 0;

    // Risk-adjusted returns
    const sharpeRatio = this.calculateSharpeRatio();
    const sortinoRatio = this.calculateSortinoRatio();
    const { maxDrawdown, currentDrawdown } = this.calculateDrawdownMetrics();

    // ROI calculations
    const returnOnInvestment = ((this.currentCapital - this.initialCapital) / this.initialCapital) * 100;

    // Time-based ROI
    const firstTrade = closedTrades[0];
    const tradingDays = firstTrade
      ? Math.max(1, (new Date().getTime() - new Date(firstTrade.entryTime).getTime()) / (1000 * 60 * 60 * 24))
      : 1;

    const dailyROI = returnOnInvestment / tradingDays;
    const weeklyROI = dailyROI * 7;
    const monthlyROI = dailyROI * 30;

    return {
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      profitFactor,
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      currentDrawdown,
      avgHoldingPeriod,
      returnOnInvestment,
      dailyROI,
      weeklyROI,
      monthlyROI
    };
  }

  /**
   * Calculate P&L since a specific date
   */
  private calculatePnLSince(date: Date): number {
    return this.tradeHistory
      .filter(t => t.status === 'closed' && t.exitTime && new Date(t.exitTime) >= date)
      .reduce((sum, t) => sum + (t.pnl || 0), 0);
  }

  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(): number {
    const closedTrades = this.tradeHistory.filter(t => t.status === 'closed');
    if (closedTrades.length < 2) return 0;

    const returns = closedTrades.map(t => (t.pnl || 0) / (t.entryPrice * t.quantity));
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
    );

    if (stdDev === 0) return 0;

    const riskFreeRate = 0.02 / 252; // 2% annual, daily
    return ((meanReturn - riskFreeRate) / stdDev) * Math.sqrt(252); // Annualized
  }

  /**
   * Calculate Sortino ratio
   */
  private calculateSortinoRatio(): number {
    const closedTrades = this.tradeHistory.filter(t => t.status === 'closed');
    if (closedTrades.length < 2) return 0;

    const returns = closedTrades.map(t => (t.pnl || 0) / (t.entryPrice * t.quantity));
    const riskFreeRate = 0.02 / 252;
    const excessReturns = returns.map(r => r - riskFreeRate);
    const meanExcessReturn = excessReturns.reduce((sum, r) => sum + r, 0) / excessReturns.length;

    const negativeReturns = excessReturns.filter(r => r < 0);
    if (negativeReturns.length === 0) return Infinity;

    const downsideDeviation = Math.sqrt(
      negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
    );

    if (downsideDeviation === 0) return Infinity;
    return (meanExcessReturn / downsideDeviation) * Math.sqrt(252);
  }

  /**
   * Calculate drawdown metrics
   */
  private calculateDrawdownMetrics(): { maxDrawdown: number; currentDrawdown: number } {
    if (this.snapshots.length === 0) {
      return { maxDrawdown: 0, currentDrawdown: 0 };
    }

    const values = this.snapshots.map(s => s.totalValue);
    const runningMax: number[] = [values[0]];

    for (let i = 1; i < values.length; i++) {
      runningMax.push(Math.max(runningMax[i - 1], values[i]));
    }

    const drawdowns = values.map((value, i) => (value - runningMax[i]) / runningMax[i]);
    const maxDrawdown = Math.abs(Math.min(...drawdowns, 0));
    const currentDrawdown = Math.abs(drawdowns[drawdowns.length - 1] || 0);

    return { maxDrawdown, currentDrawdown };
  }

  /**
   * Get empty performance metrics
   */
  private getEmptyPerformanceMetrics(): PerformanceMetrics {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      currentDrawdown: 0,
      avgHoldingPeriod: 0,
      returnOnInvestment: 0,
      dailyROI: 0,
      weeklyROI: 0,
      monthlyROI: 0
    };
  }

  /**
   * Take portfolio snapshot
   */
  takeSnapshot(): void {
    const metrics = this.getPortfolioMetrics();
    const performance = this.getPerformanceMetrics();

    const snapshot: PortfolioSnapshot = {
      timestamp: new Date().toISOString(),
      totalValue: metrics.totalValue,
      cashBalance: metrics.cashBalance,
      positions: this.positions.size,
      pnl: metrics.totalPnL,
      drawdown: performance.currentDrawdown,
      sharpe: performance.sharpeRatio
    };

    this.snapshots.push(snapshot);

    // Keep only last 1000 snapshots
    if (this.snapshots.length > 1000) {
      this.snapshots = this.snapshots.slice(-1000);
    }
  }

  /**
   * Get all positions
   */
  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position by ID
   */
  getPosition(positionId: string): Position | undefined {
    return this.positions.get(positionId);
  }

  /**
   * Get trade history
   */
  getTradeHistory(limit?: number): Trade[] {
    const history = [...this.tradeHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Get portfolio snapshots
   */
  getSnapshots(limit?: number): PortfolioSnapshot[] {
    return limit ? this.snapshots.slice(-limit) : this.snapshots;
  }

  /**
   * Get summary
   */
  getSummary(): {
    portfolio: PortfolioMetrics;
    performance: PerformanceMetrics;
    positions: Position[];
    recentTrades: Trade[];
  } {
    return {
      portfolio: this.getPortfolioMetrics(),
      performance: this.getPerformanceMetrics(),
      positions: this.getAllPositions(),
      recentTrades: this.getTradeHistory(10)
    };
  }

  /**
   * Reset portfolio
   */
  reset(newInitialCapital?: number): void {
    this.positions.clear();
    this.tradeHistory = [];
    this.snapshots = [];

    if (newInitialCapital !== undefined) {
      this.initialCapital = newInitialCapital;
      this.currentCapital = newInitialCapital;
      this.cashBalance = newInitialCapital;
    } else {
      this.currentCapital = this.initialCapital;
      this.cashBalance = this.initialCapital;
    }

    console.log(`Portfolio reset with ${this.initialCapital} initial capital`);
  }

  /**
   * Export portfolio data
   */
  exportData(): {
    initialCapital: number;
    currentCapital: number;
    positions: Position[];
    trades: Trade[];
    snapshots: PortfolioSnapshot[];
    metrics: PortfolioMetrics;
    performance: PerformanceMetrics;
  } {
    return {
      initialCapital: this.initialCapital,
      currentCapital: this.currentCapital,
      positions: this.getAllPositions(),
      trades: this.tradeHistory,
      snapshots: this.snapshots,
      metrics: this.getPortfolioMetrics(),
      performance: this.getPerformanceMetrics()
    };
  }
}

// Factory function
export function createPortfolioManager(initialCapital?: number): PortfolioManager {
  return new PortfolioManager(initialCapital);
}
