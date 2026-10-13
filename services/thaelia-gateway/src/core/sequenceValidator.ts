// ============================================================
// THAELIA Exchange Gateway v1.0 — Sequence Validator
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// Tracks per-symbol sequence numbers.
// Detects gaps → emits SEQUENCE_RECOVERY event.
// ============================================================

import { EventEmitter } from 'events';
import type { SequenceState } from '../core/types';

export class SequenceValidator extends EventEmitter {
  // "exchange:symbol" → state
  private state = new Map<string, SequenceState>();
  private totalGaps = 0;

  validate(exchange: string, symbol: string, seq: number): boolean {
    if (seq === 0) return true; // exchange doesn't provide sequence numbers

    const key = `${exchange}:${symbol}`;
    const existing = this.state.get(key);

    if (!existing) {
      this.state.set(key, {
        exchange, symbol, lastSeq: seq, gaps: [], recovering: false,
      });
      return true;
    }

    const expected = existing.lastSeq + 1;

    if (seq === expected) {
      // Normal path — no gap
      existing.lastSeq = seq;
      if (existing.recovering) {
        existing.recovering = false;
        this.emit('recovered', { exchange, symbol, seq });
      }
      return true;
    }

    if (seq < expected) {
      // Duplicate or replay — ignore silently
      return false;
    }

    // GAP DETECTED
    const missingFrom = expected;
    const missingTo = seq - 1;
    this.totalGaps += (seq - expected);

    existing.gaps.push(...Array.from(
      { length: seq - expected },
      (_, i) => missingFrom + i
    ));
    existing.lastSeq = seq;
    existing.recovering = true;

    this.emit('gap', {
      exchange,
      symbol,
      missingFrom,
      missingTo,
      received: seq,
    });

    this.emit('SEQUENCE_RECOVERY', { exchange, symbol, missingFrom, missingTo });
    return false; // caller should trigger order book recovery
  }

  reset(exchange: string, symbol: string): void {
    const key = `${exchange}:${symbol}`;
    this.state.delete(key);
    this.emit('reset', { exchange, symbol });
  }

  resetExchange(exchange: string): void {
    for (const key of this.state.keys()) {
      if (key.startsWith(`${exchange}:`)) this.state.delete(key);
    }
  }

  getGapCount(exchange?: string): number {
    if (!exchange) return this.totalGaps;
    let count = 0;
    for (const [key, s] of this.state) {
      if (key.startsWith(`${exchange}:`)) count += s.gaps.length;
    }
    return count;
  }

  getState(): SequenceState[] {
    return [...this.state.values()];
  }
}

export const sequenceValidator = new SequenceValidator();
