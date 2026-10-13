// ============================================================
// THAELIA Exchange Gateway v1.0 — Reconnect Engine
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// Exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s → 60s max
// Jitter: ±20% — prevents reconnect storms across instances
// ============================================================

import { EventEmitter } from 'events';

const BACKOFF_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000];
const JITTER_FACTOR = 0.20; // ±20%
const RESET_AFTER_SUCCESS_MS = 60_000; // reset backoff after 60s clean connection

export interface ReconnectState {
  reconnectCount: number;
  lastDisconnectReason: string;
  lastReconnectTime: number;
  nextRetryInMs: number;
  attempt: number;
}

export class ReconnectEngine extends EventEmitter {
  private readonly exchange: string;
  private attempt = 0;
  private reconnectCount = 0;
  private lastDisconnectReason = 'unknown';
  private lastReconnectTime = 0;
  private timer: NodeJS.Timeout | null = null;
  private successTimer: NodeJS.Timeout | null = null;
  private active = true;

  constructor(exchange: string) {
    super();
    this.exchange = exchange;
  }

  // Call when a disconnect occurs — schedules reconnect
  scheduleReconnect(reason: string, connectFn: () => Promise<void>): void {
    if (!this.active) return;

    this.lastDisconnectReason = reason;
    this.clearTimers();

    const delayMs = this.computeDelay();
    console.log(
      `[ReconnectEngine:${this.exchange}] Attempt ${this.attempt + 1} in ${delayMs}ms — reason: ${reason}`
    );

    this.emit('scheduled', { exchange: this.exchange, delayMs, attempt: this.attempt + 1 });

    this.timer = setTimeout(async () => {
      this.attempt++;
      this.reconnectCount++;
      this.lastReconnectTime = Date.now();

      this.emit('attempting', { exchange: this.exchange, attempt: this.reconnectCount });

      try {
        await connectFn();
        this.onReconnectSuccess();
      } catch (err) {
        const msg = (err as Error).message ?? 'unknown';
        this.emit('failed', { exchange: this.exchange, reason: msg });
        this.scheduleReconnect(msg, connectFn);
      }
    }, delayMs);
  }

  // Call when connection is established successfully
  onReconnectSuccess(): void {
    this.emit('success', { exchange: this.exchange, attempt: this.reconnectCount });

    // Reset backoff after sustained clean connection
    this.successTimer = setTimeout(() => {
      this.attempt = 0;
      this.emit('backoffReset', { exchange: this.exchange });
    }, RESET_AFTER_SUCCESS_MS);
  }

  stop(): void {
    this.active = false;
    this.clearTimers();
  }

  resume(): void {
    this.active = true;
  }

  getState(): ReconnectState {
    return {
      reconnectCount: this.reconnectCount,
      lastDisconnectReason: this.lastDisconnectReason,
      lastReconnectTime: this.lastReconnectTime,
      nextRetryInMs: this.computeDelay(),
      attempt: this.attempt,
    };
  }

  // ---- Private ----

  private computeDelay(): number {
    const base = BACKOFF_STEPS_MS[Math.min(this.attempt, BACKOFF_STEPS_MS.length - 1)];
    const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1); // ±20%
    return Math.round(Math.max(500, base + jitter));
  }

  private clearTimers(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.successTimer) { clearTimeout(this.successTimer); this.successTimer = null; }
  }
}
