/**
 * Shared security primitives for Pages Functions that bypass _middleware auth.
 *
 * Every route that _middleware.ts passes through with next() must enforce its
 * own auth. Use these helpers so all routes apply identical rules.
 */

export interface SecurityEnv {
  JWT_SECRET?: string;
  SESSIONS?: KVNamespace;
  ENABLE_LIVE_TRADING?: string;
  ENABLE_PAPER_TRADING?: string;
  PAPER_MODE?: string;
  DEMO_MODE?: string;
}

/** Constant-time string comparison (avoids timing side channels on secrets). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare against the longer length so length mismatch costs the same time.
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Uint8Array.from(atob(b64 + pad), c => c.charCodeAt(0));
}

/**
 * Verify the user's HS256 JWT and confirm the session still exists in KV.
 * Mirrors authenticate() in _middleware.ts.
 */
export async function verifyUser(
  request: Request,
  env: SecurityEnv,
): Promise<{ valid: boolean; userId?: string }> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ') || !env.JWT_SECRET) return { valid: false };

  const parts = header.slice(7).split('.');
  if (parts.length !== 3) return { valid: false };
  const [h, body, sig] = parts;

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), enc.encode(`${h}.${body}`));
    if (!ok) return { valid: false };

    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return { valid: false };
    if (!payload.userId) return { valid: false };

    if (env.SESSIONS) {
      const stored = await env.SESSIONS.get(`session:${payload.userId}`);
      if (!stored) return { valid: false };
    }
    return { valid: true, userId: String(payload.userId) };
  } catch {
    return { valid: false };
  }
}

/**
 * Live order placement is allowed only when ALL of these are explicitly set:
 *   ENABLE_LIVE_TRADING=true, PAPER_MODE=false, DEMO_MODE=false
 * Anything missing or mistyped resolves to paper. Mirrors
 * effective_paper_mode() in executor/main.py.
 */
export function liveTradingAllowed(env: SecurityEnv): boolean {
  return (
    env.ENABLE_LIVE_TRADING === 'true' &&
    env.PAPER_MODE === 'false' &&
    env.DEMO_MODE === 'false'
  );
}

const SECRET_FIELDS = new Set(['secret', 'key', 'token', 'passphrase', 'password', 'apikey', 'api_key']);

/** Strip secret-bearing fields before a payload is persisted or logged. */
export function redactPayload(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = SECRET_FIELDS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}
