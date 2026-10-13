// ============================================================
// THAELIA Exchange Gateway v1.0 — Paper Exchange Adapter
// XQ Trade M8 Pro | ThaleOS/FernXQ
//
// Generates realistic simulated market data.
// Always available — used when credentials missing or DEMO_MODE=true.
// Random-walk price model with typical spreads.
// Default state for all trading — live requires explicit opt-in.
// ============================================================

import { EventEmitter } from 'events';
import type {
  NormalizedTick, ConnectionHealth, OrderRequest,
  OrderResult, ConnectionState
} from '../core/types';
import { marketDataQueue } from '../queue/asyncQueue';
import { generateId } from '../utils/ids';

const TICK_INTERVAL_MS = 1_000;
const VOLATILITY       = 0.0003; // 0.03% per tick

const SEED_PRICES: Record<string, { price: number; assetClass: 'crypto' | 'forex' | 'commodity' }> = {
  BTCUSDT:  { price: 67_000,  assetClass: 'crypto' },
  ETHUSDT:  { price: 3_400,   assetClass: 'crypto' },
  SOLUSDT:  { price: 165,     assetClass: 'crypto' },
  BNBUSDT:  { price: 590,     assetClass: 'crypto' },
  'EUR/USD': { price: 1.0870, assetClass: 'forex'  },
  'GBP/USD': { price: 1.2680, assetClass: 'forex'  },
  'NZD/USD': { price: 0.6120, assetClass: 'forex'  },
  'USD/JPY': { price: 157.30, assetClass: 'forex'  },
  'XAU/USD': { price: 2_350,  assetClass: 'commodity' },
};

function spread(price: number): number {
  if (price > 10_000) return price * 0.00020;
  if (price > 100)   return price * 0.00025;
  return price * 0.00040;
}

export class PaperAdapter extends EventEmitter {
  readonly exchange = 'paper';

  private state: ConnectionState = 'DISCONNECTED';
  private tickTimer: NodeJS.Timeout | null = null;
  private prices: Record<string, number> = {};
  private assetClasses: Record<string, 'crypto' | 'forex' | 'commodity'> = {};
  private subscribedSymbols: string[] = [];
  private paperOrders: Map<string, OrderResult> = new Map();
  private messageCount = 0;
  private messageWindowStart = Date.now();
  private lastTickAt = 0;
  private reconnectCount = 0;
  private readonly defaultSymbols: string[];

  constructor(symbols?: string[]) {
    super();
    this.defaultSymbols = symbols ?? Object.keys(SEED_PRICES);

    // Pre-seed all known prices
    for (const [sym, meta] of Object.entries(SEED_PRICES)) {
      this.prices[sym] = meta.price;
      this.assetClasses[sym] = meta.assetClass;
    }
  }

  async connect(): Promise<void> {
    this.setState('CONNECTED', 'paper exchange online');
    this.subscribe(this.defaultSymbols);
    this.startTicks();
    console.log('[Paper] Simulated exchange connected — demo mode');
  }

  async disconnect(): Promise<void> {
    this.stopTicks();
    this.setState('DISCONNECTED', 'graceful shutdown');
  }

  subscribe(symbols: string[]): void {
    this.subscribedSymbols = [...new Set([...this.subscribedSymbols, ...symbols])];
    for (const sym of symbols) {
      if (!this.prices[sym]) {
        // Unknown symbol — seed with a random mid price
        this.prices[sym] = 100 + Math.random() * 900;
        this.assetClasses[sym] = 'crypto';
      }
    }
  }

  unsubscribe(symbols: string[]): void {
    this.subscribedSymbols = this.subscribedSymbols.filter(s => !symbols.includes(s));
  }

  normalizeMessage(raw: unknown): NormalizedTick | null {
    return raw as NormalizedTick | null;
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const currentPrice = this.prices[order.symbol] ?? 100;
    const slippage = currentPrice * 0.0002 * (order.side === 'buy' ? 1 : -1);
    const fillPrice = order.type === 'market'
      ? currentPrice + slippage
      : (order.price ?? currentPrice);

    const result: OrderResult = {
      clientOrderId: order.clientOrderId,
      orderId: `PAPER-${generateId()}`,
      exchange: 'paper',
      symbol: order.symbol,
      side: order.side,
      status: 'simulated',
      fillPrice,
      timestamp: Date.now(),
    };

    this.paperOrders.set(result.orderId, result);
    console.log(`[Paper] Fill: ${order.side.toUpperCase()} ${order.quantity} ${order.symbol} @ ${fillPrice.toFixed(5)}`);
    return result;
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean }> {
    const existed = this.paperOrders.has(orderId);
    this.paperOrders.delete(orderId);
    return { success: existed };
  }

  getPaperOrders(): OrderResult[] {
    return [...this.paperOrders.values()];
  }

  getHealth(): ConnectionHealth {
    const elapsed = Math.max(1, (Date.now() - this.messageWindowStart) / 1000);
    return {
      exchange: 'paper',
      state: this.state,
      healthScore: 100,
      latencyMs: 1,
      lastPingSentAt: Date.now(),
      lastPongReceivedAt: Date.now(),
      missedPings: 0,
      reconnectCount: this.reconnectCount,
      lastDisconnectReason: 'none',
      lastReconnectTime: 0,
      messageRate: Math.round((this.messageCount / elapsed) * 10) / 10,
      sequenceGaps: 0,
      subscribedSymbols: this.subscribedSymbols,
      updatedAt: Date.now(),
    };
  }

  // ---- Private ----

  private startTicks(): void {
    this.tickTimer = setInterval(() => this.emitTicks(), TICK_INTERVAL_MS);
  }

  private stopTicks(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private emitTicks(): void {
    const receivedAt = Date.now();
    for (const sym of this.subscribedSymbols) {
      const base = this.prices[sym] ?? 100;
      const drift = base * VOLATILITY * (Math.random() - 0.5) * 2;
      const mid = Math.max(0.0001, base + drift);
      this.prices[sym] = mid;

      const s = spread(mid);
      const assetClass = this.assetClasses[sym] ?? 'crypto';
      const tick: NormalizedTick = {
        exchange: 'paper',
        symbol: sym,
        assetClass,
        channel: 'ticker',
        bid: mid - s / 2,
        ask: mid + s / 2,
        last: mid,
        spread: s,
        volume: Math.random() * 500 + 10,
        timestamp: receivedAt,
        receivedAt,
        sequence: 0,
        latencyMs: 1,
        healthScore: 100,
      };

      this.messageCount++;
      this.lastTickAt = receivedAt;
      marketDataQueue.push('paper', 'tick', tick);
    }
  }

  private setState(s: ConnectionState, reason: string): void {
    if (this.state === s) return;
    this.state = s;
    this.emit('stateChange', { exchange: 'paper', state: s, reason });
  }
}
