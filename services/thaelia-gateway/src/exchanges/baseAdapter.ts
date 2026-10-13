// ============================================================
// THAELIA Exchange Gateway v1.0 — Base Exchange Adapter
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// All exchange adapters extend this class.
// The WS handler does ONLY: receive → timestamp → push to queue.
// All processing happens in workers.
// ============================================================

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { ConnectionHealth, NormalizedTick, ConnectionState } from '../core/types';
import { HeartbeatManager } from '../core/heartbeatManager';
import { ReconnectEngine } from '../core/reconnectEngine';
import { sequenceValidator } from '../core/sequenceValidator';
import { computeHealthScore } from '../core/healthScorer';
import { marketDataQueue } from '../queue/asyncQueue';

export interface ExchangeConfig {
  name: string;
  wsUrl: string;
  symbols: string[];
  channels: string[];
}

export abstract class BaseExchangeAdapter extends EventEmitter {
  protected ws: WebSocket | null = null;
  protected readonly config: ExchangeConfig;
  protected heartbeat: HeartbeatManager;
  protected reconnect: ReconnectEngine;
  protected state: ConnectionState = 'DISCONNECTED';

  // Metrics
  private messageCount = 0;
  private messageWindowStart = Date.now();
  private latencyMs = 0;
  private reconnectCount = 0;
  private lastDisconnectReason = 'none';
  private lastReconnectTime = 0;
  private missedPings = 0;

  constructor(config: ExchangeConfig) {
    super();
    this.config = config;

    this.heartbeat = new HeartbeatManager(config.name, () => this.sendPing());
    this.reconnect = new ReconnectEngine(config.name);

    // Heartbeat events → state machine
    this.heartbeat.on('stateChange', (state: ConnectionState, reason: string) => {
      this.setState(state, reason);
    });

    this.heartbeat.on('pongTimeout', () => {
      this.missedPings++;
      this.closeAndReconnect('pong timeout');
    });

    this.heartbeat.on('latencyUpdate', (ms: number) => {
      this.latencyMs = ms;
    });

    this.heartbeat.on('missedPing', (count: number) => {
      this.missedPings = count;
    });

    // Reconnect events
    this.reconnect.on('attempting', () => {
      this.reconnectCount++;
      this.lastReconnectTime = Date.now();
    });
  }

  async connect(): Promise<void> {
    if (this.state === 'CONNECTED') return;
    this.setState('RECONNECTING', 'initiating connect');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.wsUrl, {
        handshakeTimeout: 10_000,
        perMessageDeflate: false, // avoid decompression overhead on hot path
      });

      this.ws.once('open', () => {
        this.setState('CONNECTED', 'socket opened');
        this.heartbeat.start();
        this.onOpen();
        this.subscribeAll();
        resolve();
      });

      // ---- HOT PATH: receive → timestamp → push ----
      this.ws.on('message', (data: WebSocket.Data) => {
        const receivedAt = Date.now();
        this.trackMessageRate();

        // Treat any data as implicit heartbeat signal
        this.heartbeat.onMessage();

        try {
          const raw = JSON.parse(data.toString());
          const tick = this.normalizeMessage(raw, receivedAt);
          if (!tick) return;

          // Sequence validation — gap triggers recovery event
          const seqOk = sequenceValidator.validate(tick.exchange, tick.symbol, tick.sequence);
          if (!seqOk && tick.sequence > 0) {
            this.emit('sequenceGap', tick);
          }

          // ONLY operation on WS thread: push to queue
          marketDataQueue.push(tick.exchange, 'tick', tick, tick.sequence);

        } catch { /* never throw on WS thread */ }
      });

      this.ws.on('pong', () => {
        this.heartbeat.onPong();
      });

      this.ws.on('close', (code, reason) => {
        const msg = `code=${code} reason=${reason.toString() || 'none'}`;
        this.lastDisconnectReason = msg;
        this.heartbeat.stop();
        this.setState('DISCONNECTED', msg);
        this.reconnect.scheduleReconnect(msg, () => this.connect());
      });

      this.ws.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.ws.once('error', reject);
    });
  }

  async disconnect(): Promise<void> {
    this.reconnect.stop();
    this.heartbeat.stop();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close(1000, 'graceful shutdown');
      this.ws = null;
    }
    this.setState('DISCONNECTED', 'graceful shutdown');
  }

  getHealth(): ConnectionHealth {
    const elapsed = Math.max(1, (Date.now() - this.messageWindowStart) / 1000);
    const mps = this.messageCount / elapsed;
    const seqGaps = sequenceValidator.getGapCount(this.config.name);

    const hs = computeHealthScore({
      latencyMs: this.latencyMs,
      reconnectCount: this.reconnectCount,
      missedPings: this.missedPings,
      messagesPerSecond: mps,
      sequenceGaps: seqGaps,
    });

    return {
      exchange: this.config.name,
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
      sequenceGaps: seqGaps,
      subscribedSymbols: this.config.symbols,
      updatedAt: Date.now(),
    };
  }

  // ---- Subclass hooks ----

  protected abstract onOpen(): void;
  protected abstract subscribeAll(): void;
  protected abstract sendPing(): void;
  protected abstract normalizeMessage(raw: unknown, receivedAt: number): NormalizedTick | null;

  // ---- Protected helpers ----

  protected send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  protected closeAndReconnect(reason: string): void {
    this.lastDisconnectReason = reason;
    this.heartbeat.stop();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
    this.setState('RECONNECTING', reason);
    this.reconnect.scheduleReconnect(reason, () => this.connect());
  }

  // ---- Private ----

  private trackMessageRate(): void {
    this.messageCount++;
    if (Date.now() - this.messageWindowStart > 60_000) {
      this.messageCount = 0;
      this.messageWindowStart = Date.now();
    }
  }

  private setState(state: ConnectionState, reason: string): void {
    if (this.state === state) return;
    this.state = state;
    this.emit('stateChange', { exchange: this.config.name, state, reason });
  }
}
