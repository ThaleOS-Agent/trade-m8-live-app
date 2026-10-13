// ============================================================
// THAELIA Exchange Gateway v1.0 — Heartbeat Manager
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// Ping every 15s. Pong timeout = 3s.
// Miss → mark DEGRADED → close → trigger reconnect.
// ============================================================

import { EventEmitter } from 'events';
import type { ConnectionState } from '../core/types';

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS  = 3_000;

export interface HeartbeatEvents {
  stateChange: (state: ConnectionState, reason: string) => void;
  missedPing: (count: number) => void;
  pongTimeout: () => void;
  latencyUpdate: (ms: number) => void;
}

export class HeartbeatManager extends EventEmitter {
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private lastPingSentAt = 0;
  private lastPongReceivedAt = 0;
  private missedPings = 0;
  private state: ConnectionState = 'DISCONNECTED';
  private readonly exchange: string;
  private readonly sendPing: () => void;

  constructor(exchange: string, sendPingFn: () => void) {
    super();
    this.exchange = exchange;
    this.sendPing = sendPingFn;
  }

  start(): void {
    this.stop(); // clear any existing timers
    this.setState('CONNECTED', 'heartbeat started');
    this.schedulePing();
  }

  stop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  // Called when a pong frame is received from the exchange
  onPong(): void {
    const now = Date.now();
    const latency = now - this.lastPingSentAt;

    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }

    this.lastPongReceivedAt = now;
    this.missedPings = 0;

    if (this.state !== 'CONNECTED') {
      this.setState('CONNECTED', 'pong received — connection restored');
    }

    this.emit('latencyUpdate', latency);
  }

  // Called when any data message arrives (treat as implicit pong for some exchanges)
  onMessage(): void {
    this.lastPongReceivedAt = Date.now();
    if (this.state === 'DEGRADED') {
      this.setState('CONNECTED', 'data received — recovering');
      this.missedPings = Math.max(0, this.missedPings - 1);
    }
  }

  getSnapshot() {
    return {
      exchange: this.exchange,
      state: this.state,
      lastPingSentAt: this.lastPingSentAt,
      lastPongReceivedAt: this.lastPongReceivedAt,
      missedPings: this.missedPings,
    };
  }

  get currentState(): ConnectionState { return this.state; }
  get missedPingCount(): number { return this.missedPings; }
  get lastPong(): number { return this.lastPongReceivedAt; }
  get lastPing(): number { return this.lastPingSentAt; }

  // ---- Private ----

  private schedulePing(): void {
    this.pingTimer = setInterval(() => this.executePing(), PING_INTERVAL_MS);
  }

  private executePing(): void {
    this.lastPingSentAt = Date.now();

    try {
      this.sendPing();
    } catch {
      this.handlePongTimeout();
      return;
    }

    // Set pong timeout
    this.pongTimer = setTimeout(() => {
      this.handlePongTimeout();
    }, PONG_TIMEOUT_MS);
  }

  private handlePongTimeout(): void {
    this.missedPings++;
    this.emit('missedPing', this.missedPings);

    if (this.missedPings >= 1) {
      this.setState('DEGRADED', `pong timeout after ${PONG_TIMEOUT_MS}ms`);
    }

    // After first missed pong: close and trigger reconnect
    this.stop();
    this.emit('pongTimeout');
    this.setState('DISCONNECTED', 'pong timeout — triggering reconnect');
  }

  private setState(state: ConnectionState, reason: string): void {
    if (this.state === state) return;
    this.state = state;
    this.emit('stateChange', state, reason);
  }
}
