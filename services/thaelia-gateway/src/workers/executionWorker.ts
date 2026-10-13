// ============================================================
// THAELIA Exchange Gateway v1.0 — Execution Worker
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// Receives approved orders from riskQueue.
// Routes to exchange adapters.
// ALL orders route to paper unless ENABLE_LIVE_TRADING=true.
// Creates audit record for every execution.
// ============================================================

import { EventEmitter } from 'events';
import type { OrderRequest, OrderResult, ConnectionHealth } from '../core/types';
import { executionQueue, auditQueue } from '../queue/asyncQueue';
import { riskWorker } from './riskWorker';
import { generateId } from '../utils/ids';

type ExecuteFn = (order: OrderRequest) => Promise<OrderResult>;

export class ExecutionWorker extends EventEmitter {
  private running = false;
  private executors = new Map<string, ExecuteFn>(); // exchange → executor
  private readonly liveEnabled = process.env.ENABLE_LIVE_TRADING === 'true';
  private processedCount = 0;
  private blockedCount = 0;

  constructor() {
    super();
    // Always register paper executor
    this.registerExecutor('paper', this.paperExecute.bind(this));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.run();
    console.log('[ExecutionWorker] Started — live trading:', this.liveEnabled);
  }

  stop(): void { this.running = false; }

  registerExecutor(exchange: string, fn: ExecuteFn): void {
    this.executors.set(exchange, fn);
  }

  async submitOrder(
    order: OrderRequest,
    exchangeHealth: ConnectionHealth | null
  ): Promise<OrderResult> {
    // Pre-trade risk check — runs synchronously before any queue push
    const riskResult = await riskWorker.check(order, exchangeHealth);

    if (!riskResult.approved) {
      this.blockedCount++;
      const result: OrderResult = {
        clientOrderId: order.clientOrderId,
        orderId: `BLOCKED-${generateId()}`,
        exchange: order.exchange,
        symbol: order.symbol,
        side: order.side,
        status: 'blocked',
        blockReason: riskResult.blockedBy,
        timestamp: Date.now(),
      };
      this.emit('blocked', result);
      return result;
    }

    executionQueue.push(order.exchange, 'execution', order);
    this.processedCount++;

    return this.executeOrder(order);
  }

  // ---- Private ----

  private async run(): Promise<void> {
    // Worker loop — drains executionQueue
    while (this.running) {
      const msg = await executionQueue.pop();
      const order = msg.payload as OrderRequest;
      await this.executeOrder(order);
    }
  }

  private async executeOrder(order: OrderRequest): Promise<OrderResult> {
    // Route selection: live if enabled + executor exists, else paper
    const exchangeKey = this.liveEnabled && this.executors.has(order.exchange)
      ? order.exchange
      : 'paper';

    const executor = this.executors.get(exchangeKey) ?? this.executors.get('paper')!;

    let result: OrderResult;
    try {
      result = await executor(order);
    } catch (err) {
      result = {
        clientOrderId: order.clientOrderId,
        orderId: `ERR-${generateId()}`,
        exchange: order.exchange,
        symbol: order.symbol,
        side: order.side,
        status: 'rejected',
        blockReason: (err as Error).message,
        timestamp: Date.now(),
      };
    }

    // Audit every execution
    auditQueue.push(order.exchange, 'execution', {
      eventType: 'ORDER_EXECUTED',
      result,
      liveEnabled: this.liveEnabled,
      routedTo: exchangeKey,
      timestamp: Date.now(),
    });

    this.emit('executed', result);
    return result;
  }

  private async paperExecute(order: OrderRequest): Promise<OrderResult> {
    // Simulated fill — paper exchange
    const simulatedPrice = order.price ?? 0;
    const slip = simulatedPrice * 0.0002 * (order.side === 'buy' ? 1 : -1);
    const fillPrice = simulatedPrice > 0 ? simulatedPrice + slip : undefined;

    return {
      clientOrderId: order.clientOrderId,
      orderId: `PAPER-${generateId()}`,
      exchange: 'paper',
      symbol: order.symbol,
      side: order.side,
      status: 'simulated',
      fillPrice,
      timestamp: Date.now(),
    };
  }

  getStats() {
    return {
      processed: this.processedCount,
      blocked: this.blockedCount,
      liveEnabled: this.liveEnabled,
      registeredExchanges: [...this.executors.keys()],
    };
  }
}

export const executionWorker = new ExecutionWorker();
