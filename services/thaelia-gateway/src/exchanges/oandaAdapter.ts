// ============================================================
// THAELIA Exchange Gateway v1.0 — OANDA Streaming Pricing Adapter
// XQ Trade M8 Pro | ThaleOS/FernXQ
//
// OANDA uses chunked HTTP streaming, not WebSocket.
// Practice: https://stream-fxpractice.oanda.com
// Live:     https://stream-fxtrade.oanda.com
// Heartbeat every 5 seconds from server.
// Supports: EUR_USD, GBP_USD, NZD_USD, USD_JPY, XAU_USD, etc.
// ============================================================

import { EventEmitter } from 'events';
import type {
  NormalizedTick, ConnectionHealth, OrderRequest,
  OrderResult, ConnectionState
} from '../core/types';
import { ReconnectEngine } from '../core/reconnectEngine';
import { computeHealthScore } from '../core/healthScorer';
import { marketDataQueue } from '../queue/asyncQueue';
import { generateId } from '../utils/ids';

const BASE_PRACTICE = 'https://stream-fxpractice.oanda.com';
const BASE_LIVE     = 'https://stream-fxtrade.oanda.com';
const HEARTBEAT_WATCHDOG_MS = 10_000; // OANDA sends heartbeat every 5s — 10s = missed

function streamBase(): string {
  return process.env.OANDA_ENVIRONMENT === 'live' ? BASE_LIVE : BASE_PRACTICE;
}

export interface OandaConfig {
  symbols: string[];   // e.g. ["EUR_USD","GBP_USD","NZD_USD","XAU_USD"]
  accountId?: string;
  apiKey?: string;
}

export class OandaAdapter extends EventEmitter {
  readonly exchange = 'oanda';

  private state: ConnectionState = 'DISCONNECTED';
  private abortController: AbortController | null = null;
  private heartbeatWatchdog: NodeJS.Timeout | null = null;
  private reconnect: ReconnectEngine;

  private latencyMs = 0;
  private reconnectCount = 0;
  private lastDisconnectReason = 'none';
  private lastReconnectTime = 0;
  private messageCount = 0;
  private messageWindowStart = Date.now();
  private lastTickAt = 0;
  private readonly config: OandaConfig;

  constructor(config: OandaConfig) {
    super();
    this.config = config;
    this.reconnect = new ReconnectEngine('oanda');
    this.reconnect.on('attempting', () => { this.reconnectCount++; this.lastReconnectTime = Date.now(); });
  }

  async connect(): Promise<void> {
    if (this.state === 'CONNECTED') return;
    this.setState('RECONNECTING', 'initiating connect');

    const apiKey   = this.config.apiKey   ?? process.env.OANDA_API_KEY ?? '';
    const accountId = this.config.accountId ?? process.env.OANDA_ACCOUNT_ID ?? '';

    if (!apiKey || !accountId) {
      console.log('[OANDA] No credentials — demo mode, no stream started');
      this.setState('CONNECTED', 'demo mode');
      return;
    }

    if (this.config.symbols.length === 0) {
      console.warn('[OANDA] No symbols configured');
      this.setState('CONNECTED', 'no symbols');
      return;
    }

    await this.startStream(apiKey, accountId);
  }

  private async startStream(apiKey: string, accountId: string): Promise<void> {
    const instruments = this.config.symbols.join('%2C');
    const url = `${streamBase()}/v3/accounts/${accountId}/pricing/stream?instruments=${instruments}`;
    this.abortController = new AbortController();

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/octet-stream',
        },
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} — ${await res.text()}`);
      }

      this.setState('CONNECTED', 'stream opened');
      this.resetWatchdog();

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (t) this.processLine(t);
        }
      }

    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return;
      const msg = (err as Error).message;
      this.lastDisconnectReason = msg;
      this.clearWatchdog();
      this.setState('DISCONNECTED', msg);
      this.emit('error', new Error(`[OANDA] Stream error: ${msg}`));
      this.reconnect.scheduleReconnect(msg, () => this.startStream(apiKey, accountId));
    }
  }

  private processLine(line: string): void {
    const receivedAt = Date.now();
    try {
      const data = JSON.parse(line) as Record<string, unknown>;
      this.messageCount++;
      this.lastTickAt = receivedAt;
      this.resetWatchdog();

      if (data.type === 'HEARTBEAT') return;

      if (data.type === 'PRICE') {
        const tick = this.normalizeMessage(data, receivedAt);
        if (tick) marketDataQueue.push(tick.exchange, 'tick', tick);
      }
    } catch { /* skip malformed lines */ }
  }

  async disconnect(): Promise<void> {
    this.clearWatchdog();
    this.abortController?.abort();
    this.abortController = null;
    this.setState('DISCONNECTED', 'graceful shutdown');
  }

  normalizeMessage(raw: unknown, receivedAt: number): NormalizedTick | null {
    if (!raw || typeof raw !== 'object') return null;
    const msg = raw as Record<string, unknown>;
    if (msg.type !== 'PRICE') return null;

    const bids = (msg.bids as { price: string }[] | undefined) ?? [];
    const asks = (msg.asks as { price: string }[] | undefined) ?? [];
    const bid  = bids.length > 0 ? parseFloat(bids[0].price) : 0;
    const ask  = asks.length > 0 ? parseFloat(asks[0].price) : 0;
    const last = (bid + ask) / 2;
    const ts   = receivedAt;

    return {
      exchange: 'oanda',
      symbol: String(msg.instrument ?? '').replace('_', '/'),
      assetClass: String(msg.instrument ?? '').includes('XAU') ? 'commodity' : 'forex',
      channel: 'ticker',
      bid,
      ask,
      last,
      spread: ask - bid,
      volume: 0, // OANDA doesn't stream volume
      timestamp: ts,
      receivedAt,
      sequence: 0,
      latencyMs: this.latencyMs,
      healthScore: 100,
    };
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const live = process.env.ENABLE_LIVE_TRADING === 'true';
    if (!live) {
      return {
        clientOrderId: order.clientOrderId,
        orderId: `PAPER-${generateId()}`,
        exchange: 'oanda',
        symbol: order.symbol,
        side: order.side,
        status: 'simulated',
        timestamp: Date.now(),
      };
    }
    // Live orders route to Python executor (oanda_gateway.py via FastAPI)
    throw new Error('[OANDA] Live orders route through FastAPI executor (oanda_gateway.py)');
  }

  async cancelOrder(_orderId: string): Promise<{ success: boolean }> {
    return { success: false };
  }

  getHealth(): ConnectionHealth {
    const elapsed = Math.max(1, (Date.now() - this.messageWindowStart) / 1000);
    const mps = this.messageCount / elapsed;
    const hs  = computeHealthScore({
      latencyMs: this.latencyMs,
      reconnectCount: this.reconnectCount,
      missedPings: 0, // OANDA heartbeat managed via watchdog
      messagesPerSecond: mps,
      sequenceGaps: 0,
    });
    return {
      exchange: 'oanda',
      state: this.state,
      healthScore: hs.score,
      latencyMs: this.latencyMs,
      lastPingSentAt: this.lastTickAt,
      lastPongReceivedAt: this.lastTickAt,
      missedPings: 0,
      reconnectCount: this.reconnectCount,
      lastDisconnectReason: this.lastDisconnectReason,
      lastReconnectTime: this.lastReconnectTime,
      messageRate: Math.round(mps * 10) / 10,
      sequenceGaps: 0,
      subscribedSymbols: this.config.symbols,
      updatedAt: Date.now(),
    };
  }

  private resetWatchdog(): void {
    this.clearWatchdog();
    this.heartbeatWatchdog = setTimeout(() => {
      console.warn('[OANDA] Heartbeat watchdog triggered — stream may be dead');
      void this.disconnect().then(() => this.connect());
    }, HEARTBEAT_WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.heartbeatWatchdog) clearTimeout(this.heartbeatWatchdog);
    this.heartbeatWatchdog = null;
  }

  private setState(s: ConnectionState, reason: string): void {
    if (this.state === s) return;
    this.state = s;
    this.emit('stateChange', { exchange: 'oanda', state: s, reason });
  }
}
