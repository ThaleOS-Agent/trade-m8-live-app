// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { timingSafeEqual, liveTradingAllowed, redactPayload, verifyUser } from '../lib/security';

// ── Helpers ──────────────────────────────────────────────────────────────────
const JWT_SECRET = 'test-jwt-secret';

function b64url(bytes: Uint8Array | string): string {
  const bin = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeJWT(payload: Record<string, unknown>, secret = JWT_SECRET): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

function kv(entries: Record<string, string>) {
  return { get: async (k: string) => entries[k] ?? null } as unknown as KVNamespace;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;

// ── security.ts ──────────────────────────────────────────────────────────────
describe('timingSafeEqual', () => {
  it('matches equal strings and rejects different / different-length strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abc123')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });
});

describe('liveTradingAllowed', () => {
  it('is false unless all three gates are explicitly set', () => {
    expect(liveTradingAllowed({})).toBe(false);
    expect(liveTradingAllowed({ ENABLE_LIVE_TRADING: 'true' })).toBe(false);
    expect(liveTradingAllowed({ ENABLE_LIVE_TRADING: 'true', PAPER_MODE: 'false' })).toBe(false);
    expect(liveTradingAllowed({ ENABLE_LIVE_TRADING: 'TRUE', PAPER_MODE: 'false', DEMO_MODE: 'false' })).toBe(false);
    expect(liveTradingAllowed({ ENABLE_LIVE_TRADING: 'true', PAPER_MODE: 'false', DEMO_MODE: 'false' })).toBe(true);
  });
});

describe('redactPayload', () => {
  it('removes secret-bearing fields and keeps the rest', () => {
    const out = redactPayload({ action: 'buy', secret: 's', Token: 't', key: 'k', symbol: 'BTCUSDT' });
    expect(out).toEqual({ action: 'buy', secret: '[REDACTED]', Token: '[REDACTED]', key: '[REDACTED]', symbol: 'BTCUSDT' });
  });
});

describe('verifyUser', () => {
  const env = { JWT_SECRET, SESSIONS: kv({ 'session:u1': '1' }) };
  const req = (token?: string) =>
    new Request('https://x/api', { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  it('accepts a valid token with a live session', async () => {
    const t = await makeJWT({ userId: 'u1', exp: future() });
    expect(await verifyUser(req(t), env)).toEqual({ valid: true, userId: 'u1' });
  });
  it('rejects a missing header or arbitrary bearer string (old /signals behaviour)', async () => {
    expect((await verifyUser(req(), env)).valid).toBe(false);
    expect((await verifyUser(req('anything'), env)).valid).toBe(false);
  });
  it('rejects a wrong signature, an expired token and a logged-out session', async () => {
    expect((await verifyUser(req(await makeJWT({ userId: 'u1', exp: future() }, 'other')), env)).valid).toBe(false);
    expect((await verifyUser(req(await makeJWT({ userId: 'u1', exp: 1 })), env)).valid).toBe(false);
    expect((await verifyUser(req(await makeJWT({ userId: 'u2', exp: future() })), env)).valid).toBe(false);
  });
});

// ── TradingView webhook ──────────────────────────────────────────────────────
vi.mock('../lib/notification-service', () => ({ sendNotification: vi.fn(async () => undefined) }));

const placeOrder = vi.fn(async () => ({ success: true, orderId: 'REAL-1', averagePrice: 100 }));
vi.mock('../lib/sdk-exchange-connector', () => ({
  createExchangeManager: () => ({ placeOrder, getConnectedExchanges: () => ['binance'] }),
}));
vi.mock('../lib/forex-connector', () => ({
  createForexManager: () => ({ placeOrder }),
}));

function fakeDB() {
  const writes: { sql: string; args: unknown[] }[] = [];
  const db = {
    writes,
    prepare(sql: string) {
      const stmt = {
        args: [] as unknown[],
        bind(...a: unknown[]) { stmt.args = a; return stmt; },
        async run() { writes.push({ sql, args: stmt.args }); return { success: true }; },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
  };
  return db;
}

async function callWebhook(env: Record<string, unknown>, body: Record<string, unknown>) {
  const { onRequest } = await import('../api/tradingview/tradingview');
  const request = new Request('https://trade-m8.app/api/tradingview/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await (onRequest as any)({ request, env });
  return { status: res.status, json: await res.json() };
}

describe('POST /api/tradingview/webhook', () => {
  beforeEach(() => placeOrder.mockClear());
  const alert = { action: 'buy', symbol: 'BTCUSDT', exchange: 'BINANCE', price: 65000, quantity: 0.001 };

  it('fails closed when no secret is configured', async () => {
    const r = await callWebhook({ DB: fakeDB() }, { ...alert, secret: 'x' });
    expect(r.status).toBe(503);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret and never stores the submitted secret', async () => {
    const DB = fakeDB();
    const r = await callWebhook({ DB, TRADINGVIEW_WEBHOOK_SECRET: 'right' }, { ...alert, secret: 'wrong-value' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(DB.writes)).not.toContain('wrong-value');
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('accepts the right secret with surrounding whitespace in the configured value', async () => {
    const r = await callWebhook({ DB: fakeDB(), TRADINGVIEW_WEBHOOK_SECRET: ' right\n' }, { ...alert, secret: 'right' });
    expect(r.status).toBe(200);
  });

  it('PAPER GATE: valid alert with default env never calls an exchange', async () => {
    const DB = fakeDB();
    const r = await callWebhook({ DB, TRADINGVIEW_WEBHOOK_SECRET: 'right' }, { ...alert, secret: 'right' });
    expect(r.status).toBe(200);
    expect(r.json.tradingMode).toBe('paper');
    expect(r.json.status).toBe('paper_executed');
    expect(placeOrder).not.toHaveBeenCalled();
    expect(JSON.stringify(DB.writes)).not.toContain('"right"');
  });

  it('PAPER GATE: forex/XAU alert also stays on paper', async () => {
    const r = await callWebhook(
      { DB: fakeDB(), TRADINGVIEW_WEBHOOK_SECRET: 'right' },
      { action: 'buy', symbol: 'XAUUSD', exchange: 'OANDA', price: 2400, quantity: 1, secret: 'right' },
    );
    expect(r.json.tradingMode).toBe('paper');
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('paper fill without a price fails instead of inventing one', async () => {
    const { price, ...noPrice } = alert;
    const r = await callWebhook({ DB: fakeDB(), TRADINGVIEW_WEBHOOK_SECRET: 'right' }, { ...noPrice, secret: 'right' });
    expect(r.json.status).toBe('failed');
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('only calls the exchange when all three live gates are explicitly set', async () => {
    const r = await callWebhook(
      { DB: fakeDB(), TRADINGVIEW_WEBHOOK_SECRET: 'right', ENABLE_LIVE_TRADING: 'true', PAPER_MODE: 'false', DEMO_MODE: 'false' },
      { ...alert, secret: 'right' },
    );
    expect(r.json.tradingMode).toBe('live');
    expect(placeOrder).toHaveBeenCalledTimes(1);
  });
});

// ── Executor proxy ───────────────────────────────────────────────────────────
describe('/api/executor proxy auth', () => {
  async function callExecutor(path: string, method: string, env: Record<string, unknown>, token?: string) {
    const { onRequest } = await import('../api/executor');
    const request = new Request(`https://trade-m8.app${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: method === 'POST' ? JSON.stringify({ symbol: 'BTCUSDT', action: 'BUY', units: 1, entry_price: 1 }) : undefined,
    });
    const res = await (onRequest as any)({ request, env });
    return { status: res.status, json: await res.json() };
  }
  const base = { EXECUTOR_URL: 'https://exec.example', EXECUTOR_SECRET: 'exec', JWT_SECRET, SESSIONS: kv({ 'session:u1': '1' }) };

  it('blocks unauthenticated /execute before contacting the executor', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await callExecutor('/api/executor/execute', 'POST', base);
    expect(r.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('forwards an authenticated /execute with the executor secret', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"success":true}', { status: 200 }));
    const t = await makeJWT({ userId: 'u1', exp: future() });
    const r = await callExecutor('/api/executor/execute', 'POST', base, t);
    expect(r.status).toBe(200);
    const [, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer exec' });
    fetchSpy.mockRestore();
  });

  it('reports a localhost EXECUTOR_URL explicitly', async () => {
    const r = await callExecutor('/api/executor/health', 'GET', { ...base, EXECUTOR_URL: 'http://localhost:8000' });
    expect(r.json.executor_url).toBe('misconfigured-localhost');
  });

  it('turns an executor 401 into an actionable secret-mismatch error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"detail":"Invalid executor token"}', { status: 401 }));
    const t = await makeJWT({ userId: 'u1', exp: future() });
    const r = await callExecutor('/api/executor/status', 'GET', base, t);
    expect(r.status).toBe(502);
    expect(r.json.error).toBe('Executor rejected EXECUTOR_SECRET');
    fetchSpy.mockRestore();
  });
});
