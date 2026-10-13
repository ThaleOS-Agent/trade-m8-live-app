// ============================================================
// THAELIA Exchange Gateway v1.0 — THAELIA Monitor
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// Connection Monitor with AI-driven warnings, recommendations,
// and recovery actions.
// Exposes dashboard-ready snapshot every 5 seconds.
// ============================================================

import { EventEmitter } from 'events';
import type { ConnectionHealth } from '../core/types';
import type { HealthBand } from '../core/healthScorer';

export interface MonitorWarning {
  severity: 'info' | 'warning' | 'critical';
  exchange: string;
  message: string;
  recommendation: string;
  recoveryAction: string;
  timestamp: number;
}

export interface MonitorSnapshot {
  timestamp: number;
  gatewayHealth: HealthBand;
  overallScore: number;
  connectedCount: number;
  totalCount: number;
  exchanges: ConnectionHealth[];
  warnings: MonitorWarning[];
  queueDepths: Record<string, number>;
  uptime: number;
}

export class THAELIAMonitor extends EventEmitter {
  private exchanges = new Map<string, ConnectionHealth>();
  private warnings: MonitorWarning[] = [];
  private queueDepths: Record<string, number> = {};
  private startedAt = Date.now();
  private snapshotTimer: NodeJS.Timeout | null = null;

  start(): void {
    this.snapshotTimer = setInterval(() => this.publishSnapshot(), 5_000);
    console.log('[THAELIA] Monitor active');
  }

  stop(): void {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
  }

  updateHealth(health: ConnectionHealth): void {
    this.exchanges.set(health.exchange, health);
    this.analyzeAndWarn(health);
    this.emit('healthUpdate', health);
  }

  updateQueueDepths(depths: Record<string, number>): void {
    this.queueDepths = depths;
  }

  getSnapshot(): MonitorSnapshot {
    const all = [...this.exchanges.values()];
    const connected = all.filter(h => h.state === 'CONNECTED').length;
    const avgScore = all.length > 0
      ? Math.round(all.reduce((s, h) => s + h.healthScore, 0) / all.length)
      : 0;

    return {
      timestamp: Date.now(),
      gatewayHealth: avgScore >= 80 ? 'GREEN' : avgScore >= 50 ? 'AMBER' : 'RED',
      overallScore: avgScore,
      connectedCount: connected,
      totalCount: all.length,
      exchanges: all,
      warnings: this.warnings.slice(-20), // last 20 warnings
      queueDepths: this.queueDepths,
      uptime: Date.now() - this.startedAt,
    };
  }

  clearWarnings(exchange?: string): void {
    if (exchange) {
      this.warnings = this.warnings.filter(w => w.exchange !== exchange);
    } else {
      this.warnings = [];
    }
  }

  // ---- THAELIA AI Analysis ----

  private analyzeAndWarn(health: ConnectionHealth): void {
    const warnings: MonitorWarning[] = [];

    // Disconnected
    if (health.state === 'DISCONNECTED') {
      warnings.push({
        severity: 'critical',
        exchange: health.exchange,
        message: `${health.exchange} is DISCONNECTED`,
        recommendation: 'Check network and exchange status. Verify API keys are valid.',
        recoveryAction: 'Triggering automatic reconnect with exponential backoff.',
        timestamp: Date.now(),
      });
    }

    // Degraded
    if (health.state === 'DEGRADED') {
      warnings.push({
        severity: 'warning',
        exchange: health.exchange,
        message: `${health.exchange} connection is DEGRADED — missed ping detected`,
        recommendation: 'Monitor closely. Connection may recover automatically.',
        recoveryAction: 'Heartbeat timeout watchdog active. Reconnect will trigger if pong not received.',
        timestamp: Date.now(),
      });
    }

    // High latency
    if (health.latencyMs > 200) {
      warnings.push({
        severity: health.latencyMs > 500 ? 'critical' : 'warning',
        exchange: health.exchange,
        message: `${health.exchange} latency is ${health.latencyMs}ms — above acceptable threshold`,
        recommendation: `Consider switching execution to a lower-latency exchange. Current route confidence reduced.`,
        recoveryAction: 'Smart Router will deprioritize this exchange automatically.',
        timestamp: Date.now(),
      });
    }

    // Frequent reconnects
    if (health.reconnectCount > 3) {
      warnings.push({
        severity: 'warning',
        exchange: health.exchange,
        message: `${health.exchange} has reconnected ${health.reconnectCount} times`,
        recommendation: 'Possible network instability or exchange-side rate limiting.',
        recoveryAction: 'Reconnect engine applies exponential backoff with ±20% jitter.',
        timestamp: Date.now(),
      });
    }

    // Sequence gaps
    if (health.sequenceGaps > 0) {
      warnings.push({
        severity: 'warning',
        exchange: health.exchange,
        message: `${health.exchange} has ${health.sequenceGaps} sequence gap(s)`,
        recommendation: 'Order book data may be stale. Trading on this feed is risky.',
        recoveryAction: 'Triggered ORDER_BOOK_RECOVERY — clearing and re-fetching snapshot.',
        timestamp: Date.now(),
      });
    }

    // Low health score
    if (health.healthScore < 50) {
      warnings.push({
        severity: 'critical',
        exchange: health.exchange,
        message: `${health.exchange} health score is ${health.healthScore}/100 — RED`,
        recommendation: 'Do not execute trades on this exchange. Switch to alternative or paper.',
        recoveryAction: 'Risk Worker will block all orders to this exchange until score recovers.',
        timestamp: Date.now(),
      });
    }

    // Missed pings
    if (health.missedPings >= 2) {
      warnings.push({
        severity: 'critical',
        exchange: health.exchange,
        message: `${health.exchange} has missed ${health.missedPings} heartbeats`,
        recommendation: 'Connection is likely dead. Force reconnect.',
        recoveryAction: 'Heartbeat Manager closing socket and triggering reconnect sequence.',
        timestamp: Date.now(),
      });
    }

    // Emit new warnings
    for (const w of warnings) {
      this.warnings.push(w);
      this.emit('warning', w);

      if (w.severity === 'critical') {
        console.warn(`[THAELIA:CRITICAL] ${w.exchange}: ${w.message}`);
      }
    }

    // Cap warnings buffer at 100
    if (this.warnings.length > 100) {
      this.warnings = this.warnings.slice(-100);
    }
  }

  private publishSnapshot(): void {
    const snapshot = this.getSnapshot();
    this.emit('snapshot', snapshot);
  }
}

export const thaeliaMonitor = new THAELIAMonitor();
