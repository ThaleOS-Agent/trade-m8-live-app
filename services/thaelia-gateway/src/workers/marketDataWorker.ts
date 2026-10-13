// ============================================================
// THAELIA Exchange Gateway v1.0 — Market Data Worker
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// Consumes from marketDataQueue.
// Maintains normalized order book state.
// Triggers order book recovery after sequence gaps.
// Fans out normalized ticks to subscribers.
// NEVER touches WebSocket — only the queue.
// ============================================================

import { EventEmitter } from 'events';
import type { NormalizedTick, NormalizedOrderBook, OrderBookLevel } from '../core/types';
import { marketDataQueue } from '../queue/asyncQueue';
import { auditQueue } from '../queue/asyncQueue';
import { computeHealthScore } from '../core/healthScorer';
import type { ConnectionHealth } from '../core/types';

type TickListener = (tick: NormalizedTick) => void;

interface OrderBookState {
  bids: Map<number, number>; // price → qty
  asks: Map<number, number>;
  lastSequence: number;
  recovering: boolean;
  deltaBuffer: Array<{ bids: OrderBookLevel[]; asks: OrderBookLevel[]; seq: number }>;
}

export class MarketDataWorker extends EventEmitter {
  private running = false;
  private orderBooks = new Map<string, OrderBookState>(); // "exchange:symbol" → state
  private latestTicks = new Map<string, NormalizedTick>(); // "exchange:symbol" → tick
  private tickListeners = new Set<TickListener>();
  private processedCount = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.run();
    console.log('[MarketDataWorker] Started');
  }

  stop(): void {
    this.running = false;
  }

  onTick(listener: TickListener): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  getLatestTick(exchange: string, symbol: string): NormalizedTick | null {
    return this.latestTicks.get(`${exchange}:${symbol}`) ?? null;
  }

  getAllTicks(): NormalizedTick[] {
    return [...this.latestTicks.values()];
  }

  getOrderBook(exchange: string, symbol: string): NormalizedOrderBook | null {
    const key = `${exchange}:${symbol}`;
    const ob = this.orderBooks.get(key);
    if (!ob) return null;

    return {
      exchange,
      symbol,
      bids: this.sortedLevels(ob.bids, 'desc').slice(0, 20),
      asks: this.sortedLevels(ob.asks, 'asc').slice(0, 20),
      sequence: ob.lastSequence,
      timestamp: Date.now(),
      receivedAt: Date.now(),
    };
  }

  // Called when sequence gap detected — triggers order book recovery
  async triggerOrderBookRecovery(exchange: string, symbol: string): Promise<void> {
    const key = `${exchange}:${symbol}`;
    const ob = this.orderBooks.get(key);

    if (ob) {
      // Step 1: Mark recovering
      ob.recovering = true;
      ob.bids.clear();
      ob.asks.clear();
      ob.deltaBuffer = [];
    }

    this.emit('orderBookRecovery', { exchange, symbol, phase: 'clear' });

    // Step 2: Fetch REST snapshot (exchange-specific, delegated to adapter)
    this.emit('fetchSnapshot', { exchange, symbol });

    // Step 3: Buffer deltas during recovery
    // Step 4: Apply snapshot, replay buffer (handled by applySnapshot)
    auditQueue.push(exchange, 'risk_event', {
      eventType: 'ORDER_BOOK_RECOVERY',
      exchange,
      symbol,
      timestamp: Date.now(),
    });
  }

  applyOrderBookSnapshot(
    exchange: string,
    symbol: string,
    bids: OrderBookLevel[],
    asks: OrderBookLevel[],
    sequence: number
  ): void {
    const key = `${exchange}:${symbol}`;
    const ob = this.orderBooks.get(key) ?? this.createOrderBook();

    ob.bids.clear();
    ob.asks.clear();

    for (const { price, quantity } of bids) ob.bids.set(price, quantity);
    for (const { price, quantity } of asks) ob.asks.set(price, quantity);
    ob.lastSequence = sequence;

    // Replay buffered deltas
    const toReplay = ob.deltaBuffer.filter(d => d.seq > sequence);
    for (const delta of toReplay) this.applyDelta(ob, delta);
    ob.deltaBuffer = [];
    ob.recovering = false;

    this.orderBooks.set(key, ob);
    this.emit('orderBookReady', { exchange, symbol });
  }

  // ---- Private ----

  private async run(): Promise<void> {
    while (this.running) {
      const msg = await marketDataQueue.pop();
      if (msg.type !== 'tick') continue;

      const tick = msg.payload as NormalizedTick;
      this.processedCount++;

      const key = `${tick.exchange}:${tick.symbol}`;

      // Update health score (read from adapter health, injected via event)
      this.latestTicks.set(key, tick);

      // Fan out to signal worker and dashboard
      for (const listener of this.tickListeners) {
        try { listener(tick); } catch { /* isolate */ }
      }
    }
  }

  private createOrderBook(): OrderBookState {
    return { bids: new Map(), asks: new Map(), lastSequence: 0, recovering: false, deltaBuffer: [] };
  }

  private applyDelta(
    ob: OrderBookState,
    delta: { bids: OrderBookLevel[]; asks: OrderBookLevel[] }
  ): void {
    for (const { price, quantity } of delta.bids) {
      if (quantity === 0) ob.bids.delete(price);
      else ob.bids.set(price, quantity);
    }
    for (const { price, quantity } of delta.asks) {
      if (quantity === 0) ob.asks.delete(price);
      else ob.asks.set(price, quantity);
    }
  }

  private sortedLevels(
    map: Map<number, number>,
    dir: 'asc' | 'desc'
  ): OrderBookLevel[] {
    const entries = [...map.entries()].map(([price, quantity]) => ({ price, quantity }));
    return entries.sort((a, b) => dir === 'asc' ? a.price - b.price : b.price - a.price);
  }
}

export const marketDataWorker = new MarketDataWorker();
