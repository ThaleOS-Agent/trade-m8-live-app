import { createAdvancedRiskManager, RiskLevel } from './advanced-risk-manager';
import { createAIEnhancementEngine } from './ai-enhancement-engine';
import { createMultiExchangeExecutor, OrderSide, OrderType } from './multi-exchange-executor';
import { createPortfolioManager } from './portfolio-manager';
import { sendNotification } from './notification-service';

export class TradingSystem {
  private riskManager;
  private aiEngine;
  private executor;
  private portfolio;
  private userId: string;
  private db?: D1Database;
  private env?: any;

  constructor(userId: string, initialCapital: number = 10000, db?: D1Database, env?: any) {
    this.userId = userId;
    this.db = db;
    this.env = env;

    // Initialize all systems
    this.riskManager = createAdvancedRiskManager({
      maxPositionSize: 0.10,       // 10% max per position
      maxDrawdown: 0.10,           // 10% max drawdown
      emergencyStopLoss: 0.15      // 15% emergency stop
    });

    this.aiEngine = createAIEnhancementEngine({
      aiWeight: 0.4,               // 40% AI contribution
      minConfidence: 0.85          // 85% minimum confidence
    });

    this.executor = createMultiExchangeExecutor();
    this.portfolio = createPortfolioManager(initialCapital);

    // Register risk alert callback
    this.riskManager.onAlert(async (alert) => {
      console.log(`⚠️  RISK ALERT [${alert.level}]: ${alert.message}`);

      // Send notification to user
      if (this.db && this.env) {
        try {
          await sendNotification({
            userId: this.userId,
            type: 'risk_alert',
            data: {
              riskAlertType: alert.type,
              riskAlertLevel: alert.level,
              riskAlertMessage: alert.message,
              timestamp: new Date().toISOString(),
            },
            db: this.db,
            env: this.env,
          });
        } catch (err) {
          console.warn('Risk alert notification failed:', err);
        }
      }
    });
  }

  /**
   * Execute a complete trade with all safety checks
   */
  async executeTrade(params: {
    symbol: string;
    baseSignal: 'buy' | 'sell' | 'hold';
    baseConfidence: number;
    amount: number;
    marketData: any;
  }) {
    const { symbol, baseSignal, baseConfidence, amount, marketData } = params;

    // 1. AI Enhancement
    console.log('🧠 Enhancing signal with AI...');
    const enhanced = await this.aiEngine.enhanceSignal(
      symbol,
      baseSignal,
      baseConfidence,
      marketData
    );

    console.log(`   Base: ${baseSignal} (${(baseConfidence * 100).toFixed(1)}%)`);
    console.log(`   Enhanced: ${enhanced.enhancedSignal} (${(enhanced.enhancedConfidence * 100).toFixed(1)}%)`);
    console.log(`   AI Contribution: +${(enhanced.aiContribution * 100).toFixed(1)}%`);
    console.log(`   Win Rate Prediction: ${enhanced.aiEnhancement.winRatePrediction.toFixed(1)}%`);

    // Skip if confidence too low
    if (enhanced.enhancedConfidence < 0.85) {
      console.log('❌ Confidence too low, skipping trade');
      return { success: false, reason: 'Low confidence' };
    }

    // Skip if signal is hold
    if (enhanced.enhancedSignal === 'hold') {
      console.log('⏸️  Signal is HOLD, skipping trade');
      return { success: false, reason: 'Hold signal' };
    }

    // 2. Risk Assessment
    console.log('🛡️  Checking risk limits...');
    const portfolioMetrics = this.portfolio.getPortfolioMetrics();
    const currentPositions = this.portfolio.getAllPositions();

    const riskCheck = await this.riskManager.checkPreTradeRisk(
      symbol,
      amount,
      currentPositions.reduce((acc, pos) => {
        acc[pos.symbol] = { value: pos.value };
        return acc;
      }, {} as any),
      portfolioMetrics.totalValue
    );

    console.log(`   Risk Score: ${riskCheck.riskScore.toFixed(1)}/100`);
    console.log(`   Risk Level: ${riskCheck.riskLevel}`);

    if (!riskCheck.approved) {
      console.log('❌ Risk check failed:');
      riskCheck.blockers.forEach(b => console.log(`   - ${b}`));
      return { success: false, reason: 'Risk check failed', details: riskCheck };
    }

    if (riskCheck.warnings.length > 0) {
      console.log('⚠️  Warnings:');
      riskCheck.warnings.forEach(w => console.log(`   - ${w}`));
    }

    // 3. Execute on Best Exchange
    console.log('🔄 Executing on best exchange...');
    const side = enhanced.enhancedSignal.includes('buy') ? OrderSide.BUY : OrderSide.SELL;

    const result = await this.executor.executeOrder({
      symbol,
      side,
      type: OrderType.MARKET,
      amount,
      slippage: 0.01 // 1% slippage tolerance
    });

    if (!result.success) {
      console.log(`❌ Execution failed: ${result.error}`);
      return { success: false, reason: 'Execution failed', details: result };
    }

    console.log(`✅ Executed on ${result.exchange}`);
    console.log(`   Amount: ${result.executedAmount.toFixed(6)}`);
    console.log(`   Price: $${result.executedPrice.toFixed(2)}`);
    console.log(`   Fees: $${result.fees.toFixed(2)}`);

    // 4. Update Portfolio
    console.log('📊 Updating portfolio...');
    const position = this.portfolio.addPosition({
      symbol: result.symbol,
      side: result.side,
      type: result.type,
      quantity: result.executedAmount,
      entryPrice: result.executedPrice,
      fees: result.fees,
      exchange: result.exchange,
      strategy: `AI_Enhanced_${enhanced.aiEnhancement.aiPrediction}`,
      stopLoss: result.executedPrice * (side === OrderSide.BUY ? 0.95 : 1.05),
      takeProfit: result.executedPrice * (side === OrderSide.BUY ? 1.10 : 0.90)
    });

    // Send trade executed notification
    if (this.db && this.env) {
      sendNotification({
        userId: this.userId,
        type: 'trade_executed',
        data: {
          tradeId: position.id,
          tradeSide: side === OrderSide.BUY ? 'buy' : 'sell',
          tradeSymbol: result.symbol,
          tradeQuantity: result.executedAmount,
          tradeEntryPrice: result.executedPrice,
          tradeExchange: result.exchange,
          tradeStatus: 'filled',
          timestamp: new Date().toISOString(),
        },
        db: this.db,
        env: this.env,
      }).catch(err => console.warn('Trade notification failed:', err));
    }

    // 5. Monitor Risk
    await this.riskManager.monitorPortfolioRisk(
      currentPositions.reduce((acc, pos) => {
        acc[pos.symbol] = { value: pos.value, size: pos.quantity, price: pos.currentPrice };
        return acc;
      }, {} as any),
      portfolioMetrics.totalValue
    );

    // 6. Take Snapshot
    this.portfolio.takeSnapshot();

    const metrics = this.portfolio.getPortfolioMetrics();
    console.log('\n📈 Portfolio Update:');
    console.log(`   Total Value: $${metrics.totalValue.toFixed(2)}`);
    console.log(`   Total P&L: $${metrics.totalPnL.toFixed(2)} (${metrics.totalPnLPercent.toFixed(2)}%)`);
    console.log(`   Exposure: ${metrics.exposurePercent.toFixed(1)}%`);

    return {
      success: true,
      position,
      result,
      enhanced,
      riskCheck,
      portfolio: metrics
    };
  }

  /**
   * Update all position prices and check stop loss/take profit
   */
  async updatePrices(prices: Record<string, number>) {
    this.portfolio.updatePositionPrices(prices);

    // Monitor risk after price update
    const metrics = this.portfolio.getPortfolioMetrics();
    const positions = this.portfolio.getAllPositions();

    await this.riskManager.monitorPortfolioRisk(
      positions.reduce((acc, pos) => {
        acc[pos.symbol] = { value: pos.value, size: pos.quantity, price: pos.currentPrice };
        return acc;
      }, {} as any),
      metrics.totalValue
    );
  }

  /**
   * Get complete system status
   */
  getStatus() {
    const portfolio = this.portfolio.getPortfolioMetrics();
    const performance = this.portfolio.getPerformanceMetrics();
    const riskSummary = this.riskManager.getRiskSummary();
    const aiStats = this.aiEngine.getCacheStats();

    return {
      portfolio,
      performance,
      risk: riskSummary,
      ai: aiStats,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Scan for arbitrage opportunities
   */
  async scanArbitrage(symbols: string[]) {
    const allOpportunities = [];

    for (const symbol of symbols) {
      const opportunities = await this.executor.detectArbitrageOpportunities(symbol);
      const feasible = opportunities.filter(o => o.feasible && o.profitPotential > 1.0);

      if (feasible.length > 0) {
        console.log(`\n💰 Arbitrage found for ${symbol}:`);
        feasible.forEach(opp => {
          console.log(`   ${opp.profitPotential.toFixed(2)}% profit`);
          console.log(`   Buy: ${opp.buyExchange} @ $${opp.buyPrice.toFixed(2)}`);
          console.log(`   Sell: ${opp.sellExchange} @ $${opp.sellPrice.toFixed(2)}`);
        });

        allOpportunities.push(...feasible);
      }
    }

    return allOpportunities;
  }

  /**
   * Execute arbitrage if profitable
   */
  async executeArbitrage(opportunity: any, amount: number) {
    console.log(`🔄 Executing arbitrage for ${opportunity.symbol}...`);

    const result = await this.executor.executeArbitrage(opportunity, amount);

    console.log(`✅ Arbitrage executed:`);
    console.log(`   Buy: ${result.buyResult.exchange} @ $${result.buyResult.executedPrice.toFixed(2)}`);
    console.log(`   Sell: ${result.sellResult.exchange} @ $${result.sellResult.executedPrice.toFixed(2)}`);
    console.log(`   Profit: $${result.profit.toFixed(2)}`);

    return result;
  }

  /**
   * Get AI market analysis
   */
  async analyzeMarket(symbol: string, marketData: any) {
    return await this.aiEngine.analyzeMarket(symbol, marketData);
  }

  /**
   * Get portfolio summary
   */
  getPortfolioSummary() {
    return this.portfolio.getSummary();
  }
}
