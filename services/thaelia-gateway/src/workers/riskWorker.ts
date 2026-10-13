// ============================================================
// THAELIA Exchange Gateway v1.0 — Risk Worker
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// Runs ALL pre-trade checks before any order reaches execution.
// Any single failure → BLOCK TRADE → audit record.
// ENABLE_LIVE_TRADING must be explicitly true to pass.
// ============================================================

import { EventEmitter } from 'events';
import type { OrderRequest, RiskCheckResult, ConnectionHealth } from '../core/types';
import { auditQueue } from '../queue/asyncQueue';
import { generateId } from '../utils/ids';

interface RiskConfig {
  maxRiskPerTrade: number;    // fraction of portfolio, e.g. 0.02
  maxDailyLoss: number;       // fraction, e.g. 0.05
  maxWeeklyLoss: number;
  maxMonthlyLoss: number;
  maxPositionSize: number;    // fraction, e.g. 0.10
  maxOpenPositions: number;
  enableLiveTrading: boolean;
}

interface PositionState {
  openPositions: number;
  dailyLoss: number;
  weeklyLoss: number;
  monthlyLoss: number;
  totalExposure: number;
  portfolioValue: number;
  emergencyStop: boolean;
}

export class RiskWorker extends EventEmitter {
  private config: RiskConfig;
  private state: PositionState;
  private tradingResumeApproved = false;

  constructor(config?: Partial<RiskConfig>) {
    super();
    this.config = {
      maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE ?? '0.02'),
      maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS ?? '0.05'),
      maxWeeklyLoss: 0.10,
      maxMonthlyLoss: 0.20,
      maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE ?? '0.10'),
      maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS ?? '10', 10),
      enableLiveTrading: process.env.ENABLE_LIVE_TRADING === 'true',
      ...config,
    };

    this.state = {
      openPositions: 0,
      dailyLoss: 0,
      weeklyLoss: 0,
      monthlyLoss: 0,
      totalExposure: 0,
      portfolioValue: 100_000, // initial demo value
      emergencyStop: false,
    };
  }

  async check(
    order: OrderRequest,
    exchangeHealth: ConnectionHealth | null
  ): Promise<RiskCheckResult> {
    const checks = [
      // 1. Live trading gate
      {
        name: 'live_trading_enabled',
        passed: this.config.enableLiveTrading,
        detail: this.config.enableLiveTrading ? 'OK' : 'ENABLE_LIVE_TRADING=false — paper mode',
      },
      // 2. Emergency stop
      {
        name: 'emergency_stop',
        passed: !this.state.emergencyStop,
        detail: this.state.emergencyStop ? 'Emergency stop is ACTIVE' : 'OK',
      },
      // 3. Resume approval (if stopped and restarted)
      {
        name: 'resume_approved',
        passed: !this.state.emergencyStop || this.tradingResumeApproved,
        detail: 'Resume requires operator approval',
      },
      // 4. Daily drawdown
      {
        name: 'daily_drawdown',
        passed: this.state.dailyLoss < this.config.maxDailyLoss * this.state.portfolioValue,
        detail: `Daily loss: ${this.state.dailyLoss.toFixed(2)} / limit: ${(this.config.maxDailyLoss * this.state.portfolioValue).toFixed(2)}`,
      },
      // 5. Weekly drawdown
      {
        name: 'weekly_drawdown',
        passed: this.state.weeklyLoss < this.config.maxWeeklyLoss * this.state.portfolioValue,
        detail: `Weekly loss: ${this.state.weeklyLoss.toFixed(2)}`,
      },
      // 6. Monthly drawdown
      {
        name: 'monthly_drawdown',
        passed: this.state.monthlyLoss < this.config.maxMonthlyLoss * this.state.portfolioValue,
        detail: `Monthly loss: ${this.state.monthlyLoss.toFixed(2)}`,
      },
      // 7. Position size
      {
        name: 'position_size',
        passed: order.quantity * (order.price ?? 1) <=
          this.config.maxPositionSize * this.state.portfolioValue,
        detail: `Max position: ${(this.config.maxPositionSize * this.state.portfolioValue).toFixed(2)}`,
      },
      // 8. Open position count
      {
        name: 'max_open_positions',
        passed: this.state.openPositions < this.config.maxOpenPositions,
        detail: `Open: ${this.state.openPositions} / max: ${this.config.maxOpenPositions}`,
      },
      // 9. Exchange health
      {
        name: 'exchange_health',
        passed: exchangeHealth ? exchangeHealth.healthScore >= 50 : false,
        detail: exchangeHealth
          ? `Health score: ${exchangeHealth.healthScore}/100`
          : 'Exchange health unknown',
      },
      // 10. WebSocket connected
      {
        name: 'websocket_connected',
        passed: exchangeHealth?.state === 'CONNECTED' || exchangeHealth?.state === 'DEGRADED',
        detail: `WS state: ${exchangeHealth?.state ?? 'UNKNOWN'}`,
      },
    ];

    const failed = checks.find(c => !c.passed);
    const approved = !failed;

    // Audit every check
    auditQueue.push(order.exchange, 'risk_event', {
      eventType: approved ? 'RISK_APPROVED' : 'RISK_BLOCKED',
      clientOrderId: order.clientOrderId,
      exchange: order.exchange,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      blockedBy: failed?.name,
      checks: checks.map(c => ({ name: c.name, passed: c.passed })),
      timestamp: Date.now(),
    });

    if (!approved) {
      this.emit('blocked', { order, reason: failed!.name, detail: failed!.detail });

      // Auto-disable if drawdown breached
      if (['daily_drawdown', 'weekly_drawdown', 'monthly_drawdown'].includes(failed!.name)) {
        this.triggerCircuitBreaker(failed!.name);
      }
    }

    return {
      approved,
      checks,
      blockedBy: failed?.name,
    };
  }

  triggerEmergencyStop(): void {
    this.state.emergencyStop = true;
    this.tradingResumeApproved = false;
    this.emit('emergencyStop');
    auditQueue.push('system', 'risk_event', {
      eventType: 'EMERGENCY_STOP_ACTIVATED',
      timestamp: Date.now(),
    });
  }

  approveResume(): void {
    this.tradingResumeApproved = true;
    this.state.emergencyStop = false;
    this.emit('tradingResumed');
    auditQueue.push('system', 'risk_event', {
      eventType: 'TRADING_RESUMED',
      timestamp: Date.now(),
    });
  }

  recordLoss(amount: number): void {
    this.state.dailyLoss += amount;
    this.state.weeklyLoss += amount;
    this.state.monthlyLoss += amount;
  }

  resetDaily(): void { this.state.dailyLoss = 0; }
  resetWeekly(): void { this.state.weeklyLoss = 0; }
  resetMonthly(): void { this.state.monthlyLoss = 0; }

  updateOpenPositions(count: number): void { this.state.openPositions = count; }
  updatePortfolioValue(value: number): void { this.state.portfolioValue = value; }

  getState() {
    return { ...this.state, config: { ...this.config } };
  }

  private triggerCircuitBreaker(reason: string): void {
    this.state.emergencyStop = true;
    this.tradingResumeApproved = false;
    this.emit('circuitBreaker', { reason });
    console.warn(`[RiskWorker] Circuit breaker triggered: ${reason}`);
    auditQueue.push('system', 'risk_event', {
      eventType: 'CIRCUIT_BREAKER_TRIGGERED',
      reason,
      timestamp: Date.now(),
    });
  }
}

export const riskWorker = new RiskWorker();
