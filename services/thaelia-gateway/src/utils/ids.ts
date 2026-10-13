// ============================================================
// THAELIA Exchange Gateway v1.0 — ID Generator
// ============================================================

import { randomBytes } from 'crypto';

export function generateId(): string {
  return randomBytes(8).toString('hex');
}
