// ============================================================
// THAELIA Exchange Gateway v1.0 — Audit Logger
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// Drains auditQueue.
// Writes structured records to rotating log files.
// Exposes query API for dashboard.
// ============================================================

import { createWriteStream, mkdirSync } from 'fs';
import { join } from 'path';
import type { AuditRecord } from '../core/types';
import { auditQueue } from '../queue/asyncQueue';
import { generateId } from '../utils/ids';

const LOG_DIR = process.env.AUDIT_LOG_DIR ?? './logs/audit';
const MAX_MEMORY_RECORDS = 500;

export class AuditLogger {
  private running = false;
  private records: AuditRecord[] = [];
  private stream: ReturnType<typeof createWriteStream> | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.openLogFile();
    void this.drain();
    console.log('[AuditLogger] Started — writing to', LOG_DIR);
  }

  stop(): void {
    this.running = false;
    this.stream?.end();
  }

  getRecent(limit = 50, eventType?: string): AuditRecord[] {
    const filtered = eventType
      ? this.records.filter(r => r.eventType === eventType)
      : this.records;
    return filtered.slice(-limit).reverse();
  }

  // ---- Private ----

  private async drain(): Promise<void> {
    while (this.running) {
      const msg = await auditQueue.pop();
      const record: AuditRecord = {
        id: generateId(),
        eventType: String(msg.type),
        exchange: msg.exchange,
        detail: msg.payload as Record<string, unknown>,
        timestamp: msg.receivedAt,
      };

      this.records.push(record);
      if (this.records.length > MAX_MEMORY_RECORDS) this.records.shift();

      // Write to file
      try {
        this.stream?.write(JSON.stringify(record) + '\n');
      } catch { /* never block on write error */ }
    }
  }

  private openLogFile(): void {
    try {
      mkdirSync(LOG_DIR, { recursive: true });
      const date = new Date().toISOString().split('T')[0];
      const path = join(LOG_DIR, `audit-${date}.ndjson`);
      this.stream = createWriteStream(path, { flags: 'a' });
    } catch (err) {
      console.warn('[AuditLogger] Could not open log file:', (err as Error).message);
    }
  }
}

export const auditLogger = new AuditLogger();
