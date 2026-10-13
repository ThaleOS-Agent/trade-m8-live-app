// ============================================================
// THAELIA Exchange Gateway v1.0 — Kraken WebSocket v2 Adapter
// XQ Trade M8 Pro | ThaleOS/FernXQ
//
// Public:  wss://ws.kraken.com/v2
// Auth:    wss://ws-auth.kraken.com/v2
// Supports: market, limit, stop-loss, take-profit, trailing-stop
// ============================================================

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type {
  NormalizedTick, ConnectionHealth, OrderRequest,
  OrderResult, ConnectionState
} from '../core/types';
import { HeartbeatManager } from '../core/heartbeatManager';
import { ReconnectEngine } from '../core/reconnectEngine';
import { sequenceValidator } from '../core/sequenceValidator';
import { computeHealthScore } from '../core/healthScorer';
import { marketDataQueue } from '../queue/asyncQueue';
import { generateId } from '../utils/ids';

const WS_PUBLIC = 'wss://ws.kraken.com/v2';
const WS_AUTH   = 'wss://ws-auth.kraken.com/v2';

export interface KrakenConfig {
  symbols: string[];
  channels?: string[];
  apiKey?: string;
  secret?: string;
}

export class KrakenAdapter extends EventEmitter {
  readonly exchange = 'kraken';

  private wsPub: WebSocket | null = null;
  private wsAuth: WebSocket | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private heartbeat: HeartbeatManager;
  private reconnect: ReconnectEngine;

  private latencyMs = 0;
  private missedPings = 0;
  private reconnectCount = 0;
  private lastDisconnectReason = 'none';
  private lastReconnectTime = 0;
  private messageCount = 0;
  private messageWindowStart = Date.now();
  private readonly config: KrakenConfig;

  constructor(config: KrakenConfig) {
    super();
    this.config = {
      channels: ['ticker'],
      ...config,
    };

    this.heartbeat = new HeartbeatManager('kraken', () => this.sendPing());
    this.reconnect  = new ReconnectEngine('kraken');

    this.heartbeat.on('stateChange', (s: ConnectionState, reason: string) => this.setState(s, reason));
    this.heartbeat.on('pongTimeout', () => { this.missedPings++; this.closeAndReconnect('pong timeout'); });
    this.heartbeat.on('latencyUpdate', (ms: number) => { this.latencyMs = ms; });
    this.heartbeat.on('missedPing', (n: number) => { this.missedPings = n; });
    this.reconnect.on('attempting', () => { this.reconnectCount++; this.lastReconnectTime = Date.now(); });
  }

  async connect(): Promise<void> {
    if (this.state === 'CONNECTED') return;
    this.setState('RECONNECTING', 'initiating connect');

    await this.openPublic();

    // Auth socket only if credentials present
    if (this.hasCredentials()) {
      await this.openAuth().catch(err =>
        console.warn(`[Kraken] Auth socket failed (non-fatal): ${(err as Error).message}`)
      );
    }

    this.heartbeat.start();
    this.setState('CONNECTED', 'sockets opened');
    this.subscribeAll();
  }

  private openPublic(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wsPub = new WebSocket(WS_PUBLIC, { handshakeTimeout: 10_000 });

      this.wsPub.once('open', () => resolve());
      this.wsPub.on('message', (data) => this.onMessage(data));
      this.wsPub.on('pong', () => this.heartbeat.onPong());
      this.wsPub.on('close', (code, reason) => {
        const msg = `pub close code=${code} ${reason.toString()}`;
        this.lastDisconnectReason = msg;
        this.heartbeat.stop();
        this.setState('DISCONNECTED', msg);
        this.reconnect.scheduleReconnect(msg, () => this.connect());
      });
      this.wsPub.on('error', (err) => { this.emit('error', err); reject(err); });
      this.wsPub.once('error', reject);
    });
  }

  private openAuth(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wsAuth = new WebSocket(WS_AUTH, { handshakeTimeout: 10_000 });
      this.wsAuth.once('open', () => resolve());
      this.wsAuth.on('message', (data) => this.onMessage(data));
      this.wsAuth.on('close', () => { this.wsAuth = null; });
      this.wsAuth.on('error', (err) => reject(err));
      this.wsAuth.once('error', reject);
    });
  }

  private onMessage(data: WebSocket.Data): void {
    const receivedAt = Date.now();
    this.messageCount++;
    this.heartbeat.onMessage();
    try {
      const raw = JSON.parse(data.toString());
      // Kraken heartbeat
      if ((raw as Record<string, unknown>).channel === 'heartbeat') return;

      const tick = this.normalizeMessage(raw, receivedAt);
      if (!tick) return;

      const seqOk = sequenceValidator.validate(tick.exchange, tick.symbol, tick.sequence);
      if (!seqOk && tick.sequence > 0) this.emit('sequenceGap', tick);
      marketDataQueue.push(tick.exchange, 'tick', tick, tick.sequence);
    } catch { /* never throw on message handler */ }
  }

  async disconnect(): Promise<void> {
    this.reconnect.stop();
    this.heartbeat.stop();
    [this.wsPub, this.wsAuth].forEach(ws => {
      if (ws) { ws.removeAllListeners(); ws.close(1000, 'graceful shutdown'); }
    });
    this.wsPub = null;
    this.wsAuth = null;
    this.setState('DISCONNECTED', 'graceful shutdown');
  }

  private subscribeAll(): void {
    if (!this.wsPub || this.wsPub.readyState !== WebSocket.OPEN) return;

    const channels = this.config.channels ?? ['ticker'];
    for (const ch of channels) {
      if (ch === 'user') continue;
      this.wsPub.send(JSON.stringify({
        method: 'subscribe',
        params: {
          channel: this.mapChannel(ch),
          symbol: this.config.symbols,
        },
      }));
    }

    // User/order updates on auth socket
    if (channels.includes('user') && this.wsAuth?.readyState === WebSocket.OPEN) {
      this.wsAuth.send(JSON.stringify({ method: 'subscribe', params: { channel: 'executions' } }));
    }
  }

  private sendPing(): void {
    if (this.wsPub?.readyState === WebSocket.OPEN) {
      this.wsPub.ping();
    }
  }

  normalizeMessage(raw: unknown, receivedAt: number): NormalizedTick | null {
    if (!raw || typeof raw !== 'object') return null;
    const msg = raw as Record<string, unknown>;

    // Kraken v2: { channel: "ticker", data: [...] }
    if (msg.channel === 'ticker' && Array.isArray(msg.data)) {
      const tick = (msg.data as Record<string, unknown>[])[0];
      if (!tick) return null;
      const bid = parseFloat(String(tick.bid ?? 0));
      const ask = parseFloat(String(tick.ask ?? 0));
      const ts  = Date.now();
      return {
        exchange: 'kraken',
        symbol: String(tick.symbol ?? ''),
        assetClass: 'crypto',
        channel: 'ticker',
        bid,
        ask,
        last: parseFloat(String(tick.last ?? 0)),
        spread: ask - bid,
        volume: parseFloat(String(tick.volume ?? 0)),
        timestamp: ts,
        receivedAt,
        sequence: 0, // Kraken v2 ticker doesn't expose sequence on ticker channel
        latencyMs: this.latencyMs,
        healthScore: 100,
      };
    }

    // Trade channel
    if (msg.channel === 'trade' && Array.isArray(msg.data)) {
      const trade = (msg.data as Record<string, unknown>[])[0];
      if (!trade) return null;
      const price = parseFloat(String(trade.price ?? 0));
      return {
        exchange: 'kraken',
        symbol: String(trade.symbol ?? ''),
        assetClass: 'crypto',
        channel: 'trades',
        bid: price,
        ask: price,
        last: price,
        spread: 0,
        volume: parseFloat(String(trade.qty ?? 0)),
        timestamp: Date.now(),
        receivedAt,
        sequence: 0,
        latencyMs: this.latencyMs,
        healthScore: 100,
      };
    }

    return null;
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const live = process.env.ENABLE_LIVE_TRADING === 'true';
    if (!live || !this.wsAuth || this.wsAuth.readyState !== WebSocket.OPEN) {
      return {
        clientOrderId: order.clientOrderId,
        orderId: `PAPER-${generateId()}`,
        exchange: 'kraken',
        symbol: order.symbol,
        side: order.side,
        status: 'simulated',
        timestamp: Date.now(),
      };
    }

    this.wsAuth.send(JSON.stringify({
      method: 'add_order',
      params: {
        symbol: order.symbol,
        side: order.side,
        order_type: order.type,
        order_qty: order.quantity,
        ...(order.price    ? { limit_price: order.price }    : {}),
        ...(order.stopPrice ? { stop_price: order.stopPrice } : {}),
        cl_ord_id: order.clientOrderId,
      },
    }));

    return {
      clientOrderId: order.clientOrderId,
      orderId: `KRAKEN-${generateId()}`,
      exchange: 'kraken',
      symbol: order.symbol,
      side: order.side,
      status: 'submitted',
      timestamp: Date.now(),
    };
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean }> {
    if (!this.wsAuth || this.wsAuth.readyState !== WebSocket.OPEN) return { success: false };
    this.wsAuth.send(JSON.stringify({ method: 'cancel_order', params: { order_id: [orderId] } }));
    return { success: true };
  }

  getHealth(): ConnectionHealth {
    const elapsed = Math.max(1, (Date.now() - this.messageWindowStart) / 1000);
    const mps = this.messageCount / elapsed;
    const hs  = computeHealthScore({
      latencyMs: this.latencyMs,
      reconnectCount: this.reconnectCount,
      missedPings: this.missedPings,
      messagesPerSecond: mps,
      sequenceGaps: sequenceValidator.getGapCount('kraken'),
    });
    return {
      exchange: 'kraken',
      state: this.state,
      healthScore: hs.score,
      latencyMs: this.latencyMs,
      lastPingSentAt: this.heartbeat.lastPing,
      lastPongReceivedAt: this.heartbeat.lastPong,
      missedPings: this.missedPings,
      reconnectCount: this.reconnectCount,
      lastDisconnectReason: this.lastDisconnectReason,
      lastReconnectTime: this.lastReconnectTime,
      messageRate: Math.round(mps * 10) / 10,
      sequenceGaps: sequenceValidator.getGapCount('kraken'),
      subscribedSymbols: this.config.symbols,
      updatedAt: Date.now(),
    };
  }

  // ---- Helpers ----
  private mapChannel(ch: string): string {
    const m: Record<string, string> = { ticker: 'ticker', trades: 'trade', orderbook: 'book', candles: 'ohlc' };
    return m[ch] ?? ch;
  }

  private closeAndReconnect(reason: string): void {
    this.lastDisconnectReason = reason;
    this.heartbeat.stop();
    if (this.wsPub) { this.wsPub.removeAllListeners(); this.wsPub.terminate(); this.wsPub = null; }
    this.setState('RECONNECTING', reason);
    this.reconnect.scheduleReconnect(reason, () => this.connect());
  }

  private hasCredentials(): boolean {
    return !!(process.env.KRAKEN_API_KEY && process.env.KRAKEN_SECRET);
  }

  private setState(s: ConnectionState, reason: string): void {
    if (this.state === s) return;
    this.state = s;
    this.emit('stateChange', { exchange: 'kraken', state: s, reason });
  }
}
