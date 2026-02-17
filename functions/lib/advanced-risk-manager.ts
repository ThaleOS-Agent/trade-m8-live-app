/**
 * Advanced Risk Management System for Trade M8
 * Comprehensive risk assessment with VaR, correlation, and real-time monitoring
 */

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum RiskType {
  POSITION_SIZE = 'position_size',
  CORRELATION = 'correlation',
  CONCENTRATION = 'concentration',
  DRAWDOWN = 'drawdown',
  VOLATILITY = 'volatility',
  LIQUIDITY = 'liquidity',
  LEVERAGE = 'leverage'
}

export interface RiskMetric {
  riskType: RiskType;
  currentValue: number;
  limit: number;
  level: RiskLevel;
  description: string;
  timestamp: string;
}

export interface PositionRisk {
  symbol: string;
  positionSize: number;
  positionValue: number;
  riskScore: number;
  var1d: number;  // Value at Risk 1 day
  var5d: number;  // Value at Risk 5 days
  expectedShortfall: number;
  correlationRisk: number;
  liquidityRisk: number;
  volatilityScore: number;
  riskMetrics: RiskMetric[];
}

export interface PortfolioRisk {
  totalExposure: number;
  maxDrawdown: number;
  currentDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  varPortfolio: number;
  correlationMatrix: Record<string, Record<string, number>>;
  concentrationRisk: Record<string, number>;
  sectorExposure: Record<string, number>;
}

export interface RiskConfig {
  // Position limits
  maxPositionSize: number;        // 10% default
  maxPortfolioExposure: number;   // 95% default
  maxCorrelation: number;          // 0.7 default
  maxSectorConcentration: number;  // 0.3 default

  // Risk limits
  maxDailyVar: number;            // 2% default
  maxPortfolioVar: number;        // 5% default
  maxDrawdown: number;            // 10% default
  minSharpeRatio: number;         // 1.0 default

  // Volatility limits
  maxPositionVolatility: number;  // 0.5 default
  maxPortfolioVolatility: number; // 0.3 default

  // Emergency controls
  emergencyStopLoss: number;      // 15% default
  riskOffThreshold: number;       // 8% default
  autoHedgeThreshold: number;     // 6% default
}

export interface PreTradeRiskCheck {
  approved: boolean;
  riskLevel: RiskLevel;
  warnings: string[];
  blockers: string[];
  riskScore: number;
  recommendations?: string[];
}

export class AdvancedRiskManager {
  private config: RiskConfig;
  private portfolioHistory: Array<{
    timestamp: string;
    portfolioValue: number;
    drawdown: number;
    var: number;
    sharpe: number;
  }> = [];
  private positionHistory: Record<string, any[]> = {};
  private alertCallbacks: Array<(alert: any) => void> = [];

  constructor(config?: Partial<RiskConfig>) {
    this.config = {
      maxPositionSize: 0.10,
      maxPortfolioExposure: 0.95,
      maxCorrelation: 0.7,
      maxSectorConcentration: 0.3,
      maxDailyVar: 0.02,
      maxPortfolioVar: 0.05,
      maxDrawdown: 0.10,
      minSharpeRatio: 1.0,
      maxPositionVolatility: 0.5,
      maxPortfolioVolatility: 0.3,
      emergencyStopLoss: 0.15,
      riskOffThreshold: 0.08,
      autoHedgeThreshold: 0.06,
      ...config
    };
  }

  /**
   * Comprehensive position risk assessment
   */
  async assessPositionRisk(
    symbol: string,
    positionSize: number,
    currentPrice: number,
    portfolioValue: number,
    historicalPrices?: number[]
  ): Promise<PositionRisk> {
    const positionValue = positionSize * currentPrice;
    const positionWeight = positionValue / portfolioValue;

    // Calculate VaR using historical method
    const { var1d, var5d } = this.calculateVaR(positionValue, historicalPrices);

    // Calculate expected shortfall (CVaR)
    const expectedShortfall = this.calculateExpectedShortfall(positionValue, historicalPrices);

    // Calculate correlation risk
    const correlationRisk = await this.calculateCorrelationRisk(symbol);

    // Calculate liquidity risk
    const liquidityRisk = this.calculateLiquidityRisk(symbol, positionSize);

    // Calculate volatility
    const volatilityScore = this.calculateVolatility(historicalPrices);

    // Generate risk metrics
    const riskMetrics: RiskMetric[] = [];

    // Position size risk
    const positionSizeLevel = this.getRiskLevel(
      positionWeight,
      this.config.maxPositionSize * 0.8,
      this.config.maxPositionSize
    );

    riskMetrics.push({
      riskType: RiskType.POSITION_SIZE,
      currentValue: positionWeight,
      limit: this.config.maxPositionSize,
      level: positionSizeLevel,
      description: `Position weight: ${(positionWeight * 100).toFixed(2)}% vs limit ${(this.config.maxPositionSize * 100).toFixed(2)}%`,
      timestamp: new Date().toISOString()
    });

    // Volatility risk
    const volatilityLevel = this.getRiskLevel(
      volatilityScore,
      this.config.maxPositionVolatility * 0.8,
      this.config.maxPositionVolatility
    );

    riskMetrics.push({
      riskType: RiskType.VOLATILITY,
      currentValue: volatilityScore,
      limit: this.config.maxPositionVolatility,
      level: volatilityLevel,
      description: `Position volatility: ${(volatilityScore * 100).toFixed(2)}%`,
      timestamp: new Date().toISOString()
    });

    // Calculate overall risk score (0-100)
    const riskScore = this.calculatePositionRiskScore(
      positionWeight,
      var1d,
      correlationRisk,
      liquidityRisk,
      volatilityScore
    );

    return {
      symbol,
      positionSize,
      positionValue,
      riskScore,
      var1d,
      var5d,
      expectedShortfall,
      correlationRisk,
      liquidityRisk,
      volatilityScore,
      riskMetrics
    };
  }

  /**
   * Comprehensive portfolio risk assessment
   */
  async assessPortfolioRisk(
    positions: Record<string, { size: number; value: number; price: number }>,
    portfolioValue: number,
    priceHistory?: Record<string, number[]>
  ): Promise<PortfolioRisk> {
    // Calculate total exposure
    const totalExposure = Object.values(positions).reduce((sum, pos) => sum + pos.value, 0) / portfolioValue;

    // Calculate portfolio correlations
    const correlationMatrix = await this.calculatePortfolioCorrelations(positions, priceHistory);

    // Calculate portfolio VaR
    const varPortfolio = this.calculatePortfolioVaR(positions, correlationMatrix);

    // Calculate drawdown metrics
    const { maxDrawdown, currentDrawdown } = this.calculateDrawdownMetrics();

    // Calculate risk-adjusted returns
    const sharpeRatio = this.calculateSharpeRatio();
    const sortinoRatio = this.calculateSortinoRatio();

    // Calculate concentration risk
    const concentrationRisk = this.calculateConcentrationRisk(positions, portfolioValue);

    // Calculate sector exposure
    const sectorExposure = this.calculateSectorExposure(positions, portfolioValue);

    return {
      totalExposure,
      maxDrawdown,
      currentDrawdown,
      sharpeRatio,
      sortinoRatio,
      varPortfolio,
      correlationMatrix,
      concentrationRisk,
      sectorExposure
    };
  }

  /**
   * Pre-trade risk check - approve or reject trade
   */
  async checkPreTradeRisk(
    symbol: string,
    tradeSize: number,
    currentPortfolio: Record<string, any>,
    portfolioValue: number
  ): Promise<PreTradeRiskCheck> {
    const result: PreTradeRiskCheck = {
      approved: true,
      riskLevel: RiskLevel.LOW,
      warnings: [],
      blockers: [],
      riskScore: 0,
      recommendations: []
    };

    // Check position size limit
    const positionWeight = tradeSize / portfolioValue;
    if (positionWeight > this.config.maxPositionSize) {
      result.approved = false;
      result.riskLevel = RiskLevel.CRITICAL;
      result.blockers.push(
        `Position size ${(positionWeight * 100).toFixed(2)}% exceeds limit ${(this.config.maxPositionSize * 100).toFixed(2)}%`
      );
    } else if (positionWeight > this.config.maxPositionSize * 0.8) {
      result.warnings.push(`Position size approaching limit: ${(positionWeight * 100).toFixed(2)}%`);
      result.riskLevel = RiskLevel.MEDIUM;
    }

    // Check portfolio exposure limit
    const currentExposure = Object.values(currentPortfolio).reduce((sum: number, pos: any) => sum + (pos.value || 0), 0) / portfolioValue;
    const newExposure = currentExposure + positionWeight;

    if (newExposure > this.config.maxPortfolioExposure) {
      result.approved = false;
      result.riskLevel = RiskLevel.CRITICAL;
      result.blockers.push(
        `Portfolio exposure ${(newExposure * 100).toFixed(2)}% exceeds limit ${(this.config.maxPortfolioExposure * 100).toFixed(2)}%`
      );
    }

    // Check current drawdown
    const { currentDrawdown } = this.calculateDrawdownMetrics();
    if (currentDrawdown > this.config.riskOffThreshold) {
      result.approved = false;
      result.riskLevel = RiskLevel.CRITICAL;
      result.blockers.push(
        `Current drawdown ${(currentDrawdown * 100).toFixed(2)}% exceeds risk-off threshold`
      );
      result.recommendations?.push('Consider reducing position sizes or pausing trading');
    } else if (currentDrawdown > this.config.autoHedgeThreshold) {
      result.warnings.push(`Drawdown ${(currentDrawdown * 100).toFixed(2)}% approaching risk-off threshold`);
      result.recommendations?.push('Consider hedging positions');
    }

    // Check correlation risk
    const correlationRisk = await this.calculateCorrelationRisk(symbol);
    if (correlationRisk > this.config.maxCorrelation) {
      result.warnings.push(`High correlation risk ${(correlationRisk * 100).toFixed(2)}% for ${symbol}`);
      if (result.riskLevel === RiskLevel.LOW) result.riskLevel = RiskLevel.MEDIUM;
    }

    // Calculate overall risk score
    result.riskScore = Math.min(100,
      (positionWeight / this.config.maxPositionSize) * 40 +
      correlationRisk * 30 +
      (currentDrawdown / this.config.maxDrawdown) * 30
    );

    // Add recommendations based on risk score
    if (result.riskScore > 70) {
      result.recommendations?.push('High risk score - consider reducing trade size');
    } else if (result.riskScore > 50) {
      result.recommendations?.push('Moderate risk - ensure stop losses are in place');
    }

    return result;
  }

  /**
   * Monitor portfolio risk in real-time
   */
  async monitorPortfolioRisk(
    positions: Record<string, any>,
    portfolioValue: number
  ): Promise<void> {
    const portfolioRisk = await this.assessPortfolioRisk(positions, portfolioValue);

    const alerts: any[] = [];

    // Check drawdown alerts
    if (portfolioRisk.currentDrawdown > this.config.emergencyStopLoss) {
      alerts.push({
        level: RiskLevel.CRITICAL,
        type: 'emergency_stop',
        message: `Emergency stop triggered - drawdown ${(portfolioRisk.currentDrawdown * 100).toFixed(2)}%`,
        timestamp: new Date().toISOString()
      });
    } else if (portfolioRisk.currentDrawdown > this.config.riskOffThreshold) {
      alerts.push({
        level: RiskLevel.HIGH,
        type: 'risk_off',
        message: `Risk-off mode triggered - drawdown ${(portfolioRisk.currentDrawdown * 100).toFixed(2)}%`,
        timestamp: new Date().toISOString()
      });
    }

    // Check VaR alerts
    if (portfolioRisk.varPortfolio > this.config.maxPortfolioVar * portfolioValue) {
      alerts.push({
        level: RiskLevel.HIGH,
        type: 'var_breach',
        message: `Portfolio VaR exceeded: $${portfolioRisk.varPortfolio.toFixed(2)}`,
        timestamp: new Date().toISOString()
      });
    }

    // Process alerts
    for (const alert of alerts) {
      await this.processRiskAlert(alert);
    }

    // Update portfolio history
    this.portfolioHistory.push({
      timestamp: new Date().toISOString(),
      portfolioValue,
      drawdown: portfolioRisk.currentDrawdown,
      var: portfolioRisk.varPortfolio,
      sharpe: portfolioRisk.sharpeRatio
    });

    // Keep only last 252 entries (1 year of trading days)
    if (this.portfolioHistory.length > 252) {
      this.portfolioHistory = this.portfolioHistory.slice(-252);
    }
  }

  /**
   * Calculate Value at Risk using historical method
   */
  private calculateVaR(
    positionValue: number,
    historicalPrices?: number[],
    confidenceLevel: number = 0.05
  ): { var1d: number; var5d: number } {
    if (!historicalPrices || historicalPrices.length < 30) {
      // Fallback to estimated VaR
      const dailyVol = 0.04; // 4% daily volatility
      const var1d = positionValue * dailyVol * 1.645; // 95% confidence
      const var5d = var1d * Math.sqrt(5);
      return { var1d, var5d };
    }

    // Calculate returns
    const returns = [];
    for (let i = 1; i < historicalPrices.length; i++) {
      returns.push((historicalPrices[i] - historicalPrices[i - 1]) / historicalPrices[i - 1]);
    }

    // Calculate VaR at confidence level
    returns.sort((a, b) => a - b);
    const index = Math.floor(returns.length * confidenceLevel);
    const var1dPct = Math.abs(returns[index] || -0.05);
    const var5dPct = var1dPct * Math.sqrt(5);

    return {
      var1d: positionValue * var1dPct,
      var5d: positionValue * var5dPct
    };
  }

  /**
   * Calculate Expected Shortfall (Conditional VaR)
   */
  private calculateExpectedShortfall(
    positionValue: number,
    historicalPrices?: number[],
    confidenceLevel: number = 0.05
  ): number {
    if (!historicalPrices || historicalPrices.length < 30) {
      return positionValue * 0.08; // Fallback estimate
    }

    const returns = [];
    for (let i = 1; i < historicalPrices.length; i++) {
      returns.push((historicalPrices[i] - historicalPrices[i - 1]) / historicalPrices[i - 1]);
    }

    returns.sort((a, b) => a - b);
    const index = Math.floor(returns.length * confidenceLevel);
    const tailReturns = returns.slice(0, index);

    if (tailReturns.length === 0) return positionValue * 0.08;

    const meanTailReturn = tailReturns.reduce((sum, r) => sum + r, 0) / tailReturns.length;
    return positionValue * Math.abs(meanTailReturn);
  }

  /**
   * Calculate correlation risk with existing positions
   */
  private async calculateCorrelationRisk(symbol: string): Promise<number> {
    // Mock implementation - in production, calculate actual correlations
    const cryptoAssets = ['BTC', 'ETH', 'ADA', 'SOL', 'AVAX'];
    const isCrypto = cryptoAssets.some(asset => symbol.includes(asset));

    return isCrypto ? 0.6 : 0.3; // Higher correlation for crypto assets
  }

  /**
   * Calculate liquidity risk
   */
  private calculateLiquidityRisk(symbol: string, positionSize: number): number {
    // Major assets have lower liquidity risk
    if (symbol.includes('BTC') || symbol.includes('ETH')) {
      return Math.min(0.1, positionSize / 1000000);
    }
    return Math.min(0.5, positionSize / 100000);
  }

  /**
   * Calculate volatility from historical prices
   */
  private calculateVolatility(historicalPrices?: number[]): number {
    if (!historicalPrices || historicalPrices.length < 20) {
      return 0.06; // Default 6% volatility
    }

    const returns = [];
    for (let i = 1; i < historicalPrices.length; i++) {
      returns.push((historicalPrices[i] - historicalPrices[i - 1]) / historicalPrices[i - 1]);
    }

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate position risk score (0-100)
   */
  private calculatePositionRiskScore(
    positionWeight: number,
    var1d: number,
    correlationRisk: number,
    liquidityRisk: number,
    volatility: number
  ): number {
    const weights = {
      positionWeight: 0.25,
      var: 0.30,
      correlation: 0.20,
      liquidity: 0.15,
      volatility: 0.10
    };

    const positionScore = Math.min(100, (positionWeight / this.config.maxPositionSize) * 100);
    const varScore = Math.min(100, (var1d / (this.config.maxDailyVar * 10000)) * 100);
    const correlationScore = correlationRisk * 100;
    const liquidityScore = liquidityRisk * 100;
    const volatilityScore = Math.min(100, (volatility / this.config.maxPortfolioVolatility) * 100);

    return Math.min(100,
      weights.positionWeight * positionScore +
      weights.var * varScore +
      weights.correlation * correlationScore +
      weights.liquidity * liquidityScore +
      weights.volatility * volatilityScore
    );
  }

  /**
   * Calculate portfolio correlations
   */
  private async calculatePortfolioCorrelations(
    positions: Record<string, any>,
    priceHistory?: Record<string, number[]>
  ): Promise<Record<string, Record<string, number>>> {
    const correlationMatrix: Record<string, Record<string, number>> = {};
    const symbols = Object.keys(positions);

    for (const symbol1 of symbols) {
      correlationMatrix[symbol1] = {};
      for (const symbol2 of symbols) {
        if (symbol1 === symbol2) {
          correlationMatrix[symbol1][symbol2] = 1.0;
        } else {
          // Mock correlations - in production, calculate from actual price data
          if ((symbol1.includes('BTC') && symbol2.includes('BTC')) ||
              (symbol1.includes('ETH') && symbol2.includes('ETH'))) {
            correlationMatrix[symbol1][symbol2] = 0.8;
          } else if ((symbol1.includes('BTC') || symbol2.includes('BTC')) &&
                     (symbol1.includes('ETH') || symbol2.includes('ETH'))) {
            correlationMatrix[symbol1][symbol2] = 0.6;
          } else {
            correlationMatrix[symbol1][symbol2] = 0.3;
          }
        }
      }
    }

    return correlationMatrix;
  }

  /**
   * Calculate portfolio-wide VaR
   */
  private calculatePortfolioVaR(
    positions: Record<string, any>,
    correlationMatrix: Record<string, Record<string, number>>
  ): number {
    let totalVar = 0;
    const symbols = Object.keys(positions);

    for (const symbol of symbols) {
      const positionValue = positions[symbol].value || 0;
      const individualVar = positionValue * 0.05; // Assume 5% VaR
      totalVar += individualVar;

      // Add correlation effects
      for (const otherSymbol of symbols) {
        if (symbol !== otherSymbol) {
          const correlation = correlationMatrix[symbol]?.[otherSymbol] || 0.3;
          const otherValue = positions[otherSymbol].value || 0;
          const otherVar = otherValue * 0.05;
          totalVar += correlation * individualVar * otherVar * 0.0001;
        }
      }
    }

    return totalVar;
  }

  /**
   * Calculate drawdown metrics
   */
  private calculateDrawdownMetrics(): { maxDrawdown: number; currentDrawdown: number } {
    if (this.portfolioHistory.length === 0) {
      return { maxDrawdown: 0, currentDrawdown: 0 };
    }

    const values = this.portfolioHistory.map(entry => entry.portfolioValue);
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
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(): number {
    if (this.portfolioHistory.length < 30) return 0;

    const values = this.portfolioHistory.map(entry => entry.portfolioValue);
    const returns = [];
    for (let i = 1; i < values.length; i++) {
      returns.push((values[i] - values[i - 1]) / values[i - 1]);
    }

    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
    );

    if (stdDev === 0) return 0;

    const riskFreeRate = 0.02 / 252; // 2% annual, daily
    return ((meanReturn - riskFreeRate) / stdDev) * Math.sqrt(252); // Annualized
  }

  /**
   * Calculate Sortino ratio (downside deviation)
   */
  private calculateSortinoRatio(): number {
    if (this.portfolioHistory.length < 30) return 0;

    const values = this.portfolioHistory.map(entry => entry.portfolioValue);
    const returns = [];
    for (let i = 1; i < values.length; i++) {
      returns.push((values[i] - values[i - 1]) / values[i - 1]);
    }

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
   * Calculate concentration risk
   */
  private calculateConcentrationRisk(
    positions: Record<string, any>,
    portfolioValue: number
  ): Record<string, number> {
    const concentrationRisk: Record<string, number> = {};
    const totalValue = Object.values(positions).reduce((sum: number, pos: any) => sum + (pos.value || 0), 0);

    for (const [symbol, position] of Object.entries(positions)) {
      const weight = (position.value || 0) / totalValue;
      concentrationRisk[symbol] = weight;
    }

    return concentrationRisk;
  }

  /**
   * Calculate sector exposure
   */
  private calculateSectorExposure(
    positions: Record<string, any>,
    portfolioValue: number
  ): Record<string, number> {
    const sectorMap: Record<string, string> = {
      BTC: 'Store of Value',
      ETH: 'Smart Contracts',
      ADA: 'Smart Contracts',
      SOL: 'Smart Contracts',
      DOT: 'Interoperability',
      LINK: 'Oracles',
      UNI: 'DeFi',
      AAVE: 'DeFi',
      AVAX: 'Smart Contracts'
    };

    const sectorExposure: Record<string, number> = {};
    const totalValue = Object.values(positions).reduce((sum: number, pos: any) => sum + (pos.value || 0), 0);

    for (const [symbol, position] of Object.entries(positions)) {
      const baseSymbol = symbol.split('/')[0] || symbol.replace('USDT', '').replace('USD', '');
      const sector = sectorMap[baseSymbol] || 'Other';
      const weight = (position.value || 0) / totalValue;
      sectorExposure[sector] = (sectorExposure[sector] || 0) + weight;
    }

    return sectorExposure;
  }

  /**
   * Get risk level based on thresholds
   */
  private getRiskLevel(value: number, warningThreshold: number, criticalThreshold: number): RiskLevel {
    if (value >= criticalThreshold) return RiskLevel.CRITICAL;
    if (value >= warningThreshold) return RiskLevel.HIGH;
    if (value >= warningThreshold * 0.7) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  /**
   * Process risk alert
   */
  private async processRiskAlert(alert: any): Promise<void> {
    console.warn(`RISK ALERT [${alert.level.toUpperCase()}]: ${alert.message}`);

    // Notify all registered callbacks
    for (const callback of this.alertCallbacks) {
      try {
        callback(alert);
      } catch (error) {
        console.error('Error in alert callback:', error);
      }
    }
  }

  /**
   * Register alert callback
   */
  onAlert(callback: (alert: any) => void): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Get risk summary
   */
  getRiskSummary(): any {
    return {
      configuration: this.config,
      portfolioHistory: {
        entries: this.portfolioHistory.length,
        lastUpdate: this.portfolioHistory[this.portfolioHistory.length - 1]?.timestamp || null
      },
      monitoring: {
        positionsTracked: Object.keys(this.positionHistory).length,
        alertCallbacks: this.alertCallbacks.length
      }
    };
  }

  /**
   * Update portfolio history entry
   */
  updatePortfolioHistory(entry: {
    portfolioValue: number;
    drawdown?: number;
    var?: number;
    sharpe?: number;
  }): void {
    this.portfolioHistory.push({
      timestamp: new Date().toISOString(),
      portfolioValue: entry.portfolioValue,
      drawdown: entry.drawdown || 0,
      var: entry.var || 0,
      sharpe: entry.sharpe || 0
    });

    // Keep only last 252 entries
    if (this.portfolioHistory.length > 252) {
      this.portfolioHistory = this.portfolioHistory.slice(-252);
    }
  }
}

// Factory function
export function createAdvancedRiskManager(config?: Partial<RiskConfig>): AdvancedRiskManager {
  return new AdvancedRiskManager(config);
}
