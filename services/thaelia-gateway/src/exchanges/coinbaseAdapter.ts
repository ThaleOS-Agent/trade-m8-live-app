// ============================================================
// THAELIA Exchange Gateway v1.0 — Coinbase Advanced Trade Adapter
// XQ Trade M8 Pro | ThaleOS/FernXQ
//
// Market: wss://advanced-trade-ws.coinbase.com
// User:   wss://advanced-trade-ws-user.coinbase.com
// Auth:   JWT — keys from env only, never frontend
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

const WS_MARKET = 'wss://advanced-trade-ws.coinbase.com';
const WS_USER   = 'wss://advanced-trade-ws-user.coinbase.com';

export interface CoinbaseConfig {
  symbols: string[];       // e.g. ["BTC-USD", "ETH-USD"]
  channels?: string[];
}

export class CoinbaseAdapter extends EventEmitter {
  readonly exchange = 'coinbase';

  private wsMarket: WebSocket | null = null;
  private wsUser: WebSocket | null = null;
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
  private readonly config: CoinbaseConfig;

  constructor(config: CoinbaseConfig) {
    super();
    this.config = { channels: ['ticker'], ...config };

    this.heartbeat = new HeartbeatManager('coinbase', () => this.sendPing());
    this.reconnect  = new ReconnectEngine('coinbase');

    this.heartbeat.on('stateChange', (s: ConnectionState, r: string) => this.setState(s, r));
    this.heartbeat.on('pongTimeout', () => { this.missedPings++; this.closeAndReconnect('pong timeout'); });
    this.heartbeat.on('latencyUpdate', (ms: number) => { this.latencyMs = ms; });
    this.heartbeat.on('missedPing', (n: number) => { this.missedPings = n; });
    this.reconnect.on('attempting', () => { this.reconnectCount++; this.lastReconnectTime = Date.now(); });
  }

  async connect(): Promise<void> {
    if (this.state === 'CONNECTED') return;
    this.setState('RECONNECTING', 'initiating connect');

    await this.openMarket();
    if (this.hasCredentials()) {
      await this.openUser().catch(e =>
        console.warn(`[Coinbase] User socket failed (non-fatal): ${(e as Error).message}`)
      );
    }

    this.heartbeat.start();
    this.setState('CONNECTED', 'market socket opened');
    this.subscribeAll();
  }

  private openMarket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wsMarket = new WebSocket(WS_MARKET, { handshakeTimeout: 10_000 });

      this.wsMarket.once('open', () => resolve());
      this.wsMarket.on('message', (data) => this.onMessage(data));
      this.wsMarket.on('pong', () => this.heartbeat.onPong());
      this.wsMarket.on('close', (code, reason) => {
        const msg = `market close code=${code} ${reason.toString()}`;
        this.lastDisconnectReason = msg;
        this.heartbeat.stop();
        this.setState('DISCONNECTED', msg);
        this.reconnect.scheduleReconnect(msg, () => this.connect());
      });
      this.wsMarket.on('error', (err) => { this.emit('error', err); reject(err); });
      this.wsMarket.once('error', reject);
    });
  }

  private openUser(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wsUser = new WebSocket(WS_USER, { handshakeTimeout: 10_000 });
      this.wsUser.once('open', () => resolve());
      this.wsUser.on('message', (data) => this.onMessage(data));
      this.wsUser.on('close', () => { this.wsUser = null; });
      this.wsUser.on('error', (err) => reject(err));
      this.wsUser.once('error', reject);
    });
  }

  private onMessage(data: WebSocket.Data): void {
    const receivedAt = Date.now();
    this.messageCount++;
    this.heartbeat.onMessage();
    try {
      const raw = JSON.parse(data.toString());
      if ((raw as Record<string, unknown>).channel === 'heartbeats') return;
      const tick = this.normalizeMessage(raw, receivedAt);
      if (!tick) return;
      sequenceValidator.validate(tick.exchange, tick.symbol, tick.sequence);
      marketDataQueue.push(tick.exchange, 'tick', tick, tick.sequence);
    } catch { /* isolate */ }
  }

  async disconnect(): Promise<void> {
    this.reconnect.stop();
    this.heartbeat.stop();
    [this.wsMarket, this.wsUser].forEach(ws => {
      if (ws) { ws.removeAllListeners(); ws.close(1000, 'graceful shutdown'); }
    });
    this.wsMarket = null;
    this.wsUser = null;
    this.setState('DISCONNECTED', 'graceful shutdown');
  }

  private subscribeAll(): void {
    if (!this.wsMarket || this.wsMarket.readyState !== WebSocket.OPEN) return;

    const productIds = this.config.symbols.map(s => s.includes('/') ? s.replace('/', '-') : s);
    const channels   = this.config.channels ?? ['ticker'];

    for (const ch of channels.filter(c => c !== 'user')) {
      this.wsMarket.send(JSON.stringify({
        type: 'subscribe',
        product_ids: productIds,
        channel: this.mapChannel(ch),
      }));
    }

    // Heartbeat subscription keeps connection alive
    this.wsMarket.send(JSON.stringify({ type: 'subscribe', channel: 'heartbeats', product_ids: [] }));

    if (channels.includes('user') && this.wsUser?.readyState === WebSocket.OPEN) {
      this.wsUser.send(JSON.stringify({ type: 'subscribe', channel: 'user', product_ids: productIds }));
    }
  }

  private sendPing(): void {
    if (this.wsMarket?.readyState === WebSocket.OPEN) this.wsMarket.ping();
  }

  normalizeMessage(raw: unknown, receivedAt: number): NormalizedTick | null {
    if (!raw || typeof raw !== 'object') return null;
    const msg = raw as Record<string, unknown>;

    if (msg.channel === 'ticker' && Array.isArray(msg.events)) {
      for (const event of msg.events as Record<string, unknown>[]) {
        if (!Array.isArray(event.tickers)) continue;
        const tick = (event.tickers as Record<string, unknown>[])[0];
        if (!tick) continue;
        const bid = parseFloat(String(tick.best_bid  ?? 0));
        const ask = parseFloat(String(tick.best_ask  ?? 0));
        return {
          exchange: 'coinbase',
          symbol: String(tick.product_id ?? '').replace('-', '/'),
          assetClass: 'crypto',
          channel: 'ticker',
          bid,
          ask,
          last: parseFloat(String(tick.price ?? 0)),
          spread: ask - bid,
          volume: parseFloat(String(tick.volume_24_h ?? 0)),
          timestamp: Date.now(),
          receivedAt,
          sequence: 0,
          latencyMs: this.latencyMs,
          healthScore: 100,
        };
      }
    }

    if (msg.channel === 'market_trades' && Array.isArray(msg.events)) {
      for (const event of msg.events as Record<string, unknown>[]) {
        if (!Array.isArray(event.trades)) continue;
        const trade = (event.trades as Record<string, unknown>[])[0];
        if (!trade) continue;
        const price = parseFloat(String(trade.price ?? 0));
        return {
          exchange: 'coinbase',
          symbol: String(trade.product_id ?? '').replace('-', '/'),
          assetClass: 'crypto',
          channel: 'trades',
          bid: price, ask: price, last: price, spread: 0,
          volume: parseFloat(String(trade.size ?? 0)),
          timestamp: Date.now(),
          receivedAt,
          sequence: 0,
          latencyMs: this.latencyMs,
          healthScore: 100,
        };
      }
    }

    return null;
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const live = process.env.ENABLE_LIVE_TRADING === 'true';
    if (!live) {
      return {
        clientOrderId: order.clientOrderId,
        orderId: `PAPER-${generateId()}`,
        exchange: 'coinbase',
        symbol: order.symbol,
        side: order.side,
        status: 'simulated',
        timestamp: Date.now(),
      };
    }
    // Live orders route to FastAPI executor with JWT signing
    throw new Error('[Coinbase] Live orders must route through FastAPI executor (JWT signing required)');
  }

  async cancelOrder(_orderId: string): Promise<{ success: boolean }> {
    return { success: false }; // route to executor
  }

  getHealth(): ConnectionHealth {
    const elapsed = Math.max(1, (Date.now() - this.messageWindowStart) / 1000);
    const mps = this.messageCount / elapsed;
    const hs  = computeHealthScore({
      latencyMs: this.latencyMs,
      reconnectCount: this.reconnectCount,
      missedPings: this.missedPings,
      messagesPerSecond: mps,
      sequenceGaps: sequenceValidator.getGapCount('coinbase'),
    });
    return {
      exchange: 'coinbase',
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
      sequenceGaps: sequenceValidator.getGapCount('coinbase'),
      subscribedSymbols: this.config.symbols,
      updatedAt: Date.now(),
    };
  }

  private mapChannel(ch: string): string {
    const m: Record<string, string> = {
      ticker: 'ticker', trades: 'market_trades', orderbook: 'level2', candles: 'candles',
    };
    return m[ch] ?? ch;
  }

  private closeAndReconnect(reason: string): void {
    this.lastDisconnectReason = reason;
    this.heartbeat.stop();
    if (this.wsMarket) { this.wsMarket.removeAllListeners(); this.wsMarket.terminate(); this.wsMarket = null; }
    this.setState('RECONNECTING', reason);
    this.reconnect.scheduleReconnect(reason, () => this.connect());
  }

  private hasCredentials(): boolean {
    return !!(process.env.COINBASE_API_KEY && process.env.COINBASE_SECRET);
  }

  private setState(s: ConnectionState, reason: string): void {
    if (this.state === s) return;
    this.state = s;
    this.emit('stateChange', { exchange: 'coinbase', state: s, reason });
  }
}
