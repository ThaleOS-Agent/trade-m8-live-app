// ============================================================
// THAELIA Exchange Gateway v1.0 — Async Message Queue
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// RULE: WebSocket handlers ONLY push here.
//       Workers ONLY consume from here.
//       No strategy logic touches the WebSocket thread.
// ============================================================

import { EventEmitter } from 'events';
import type { QueueMessage } from '../core/types';
import { generateId } from '../utils/ids';

export type QueueName = 'marketData' | 'signal' | 'execution' | 'risk' | 'audit';

interface QueueOptions {
  maxSize?: number;        // drop oldest when full — backpressure protection
  drainWarningAt?: number; // emit 'backpressure' warning when queue exceeds this
}

export class AsyncQueue<T = unknown> extends EventEmitter {
  private readonly name: QueueName;
  private readonly maxSize: number;
  private readonly drainWarningAt: number;
  private queue: QueueMessage<T>[] = [];
  private draining = false;
  private droppedCount = 0;
  private processedCount = 0;

  constructor(name: QueueName, opts: QueueOptions = {}) {
    super();
    this.name = name;
    this.maxSize = opts.maxSize ?? 100_000;
    this.drainWarningAt = opts.drainWarningAt ?? Math.floor((opts.maxSize ?? 100_000) * 0.8);
  }

  // Called by WebSocket thread — ONLY operation allowed from WS context
  push(exchange: string, type: QueueMessage['type'], payload: T, sequence?: number): void {
    if (this.queue.length >= this.maxSize) {
      // Drop oldest — never block the WebSocket thread
      this.queue.shift();
      this.droppedCount++;
      this.emit('dropped', { queue: this.name, droppedCount: this.droppedCount });
    }

    const msg: QueueMessage<T> = {
      id: generateId(),
      exchange,
      type,
      payload,
      receivedAt: Date.now(),
      sequence,
    };

    this.queue.push(msg);

    if (this.queue.length >= this.drainWarningAt) {
      this.emit('backpressure', { queue: this.name, depth: this.queue.length });
    }

    // Signal consumers
    if (!this.draining) this.emit('data');
  }

  // Called by workers — blocking async pop
  async pop(): Promise<QueueMessage<T>> {
    if (this.queue.length > 0) {
      this.processedCount++;
      return this.queue.shift()!;
    }

    return new Promise((resolve) => {
      const handler = () => {
        if (this.queue.length > 0) {
          this.processedCount++;
          resolve(this.queue.shift()!);
        } else {
          this.once('data', handler); // re-queue
        }
      };
      this.once('data', handler);
    });
  }

  // Batch pop for high-throughput processing
  popBatch(maxItems: number = 100): QueueMessage<T>[] {
    const batch = this.queue.splice(0, maxItems);
    this.processedCount += batch.length;
    return batch;
  }

  get depth(): number { return this.queue.length; }
  get dropped(): number { return this.droppedCount; }
  get processed(): number { return this.processedCount; }
  get queueName(): string { return this.name; }

  stats() {
    return {
      name: this.name,
      depth: this.queue.length,
      dropped: this.droppedCount,
      processed: this.processedCount,
      utilizationPct: Math.round((this.queue.length / this.maxSize) * 100),
    };
  }
}

// ---- Singleton queues ----
export const marketDataQueue = new AsyncQueue('marketData', { maxSize: 50_000, drainWarningAt: 40_000 });
export const signalQueue     = new AsyncQueue('signal', { maxSize: 10_000 });
export const executionQueue  = new AsyncQueue('execution', { maxSize: 5_000 });
export const riskQueue       = new AsyncQueue('risk', { maxSize: 5_000 });
export const auditQueue      = new AsyncQueue('audit', { maxSize: 20_000 });
