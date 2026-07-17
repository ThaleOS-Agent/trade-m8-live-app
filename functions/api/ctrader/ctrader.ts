/**
 * cTrader Open API — one-time OAuth2 setup — Cloudflare Pages Function
 *
 * Routes:
 *   GET /api/ctrader/connect  — redirect to cTrader's OAuth consent screen
 *   GET /api/ctrader/callback — exchange the returned code for tokens, look
 *                               up the trading account(s) tied to it, store
 *                               the result in KV, show a success page
 *   GET /api/ctrader/status   — whether a cTrader account is currently connected
 *
 * This is a one-time setup flow for a single app-wide cTrader connection
 * (matching how every other broker in this codebase is wired — one account,
 * app-level secrets — not a per-user OAuth marketplace). Once connected, the
 * automated cron bot pipeline (functions/workers/index.ts, CTraderSession
 * Durable Object) picks up the stored token from KV automatically.
 *
 * Requires CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET as Pages secrets
 * (register a developer app at https://openapi.ctrader.com/apps first) —
 * these are a SEPARATE secret store from the standalone cron Worker, so the
 * same two values need to be set in both places via:
 *   wrangler pages secret put CTRADER_CLIENT_ID
 *   wrangler secret put CTRADER_CLIENT_ID --config wrangler.worker.toml
 * (and likewise for CTRADER_CLIENT_SECRET).
 *
 * Wire format verified against github.com/spotware/openapi-proto-messages —
 * see functions/workers/index.ts's CTraderSession for the full protocol
 * notes (envelope shape, payloadType IDs, price/volume scaling).
 */

interface Env {
  CACHE: KVNamespace;
  CTRADER_CLIENT_ID: string;
  CTRADER_CLIENT_SECRET: string;
  CTRADER_DEMO: string;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } });
}

function redirectUri(request: Request): string {
  return `${new URL(request.url).origin}/api/ctrader/callback`;
}

// ── Minimal one-shot WS client: open, send a few correlated requests, close.
// Only used here for the setup flow's account lookup — the persistent
// trading connection lives in the CTraderSession Durable Object instead. ──

async function ctraderOneShot(
  env: Env,
  clientId: string,
  clientSecret: string,
  accessToken: string,
): Promise<{ accounts: Array<{ ctidTraderAccountId: number; isLive?: boolean }> }> {
  const host = env.CTRADER_DEMO === 'true' ? 'demo.ctraderapi.com' : 'live1.p.ctrader.com';
  const socket = new WebSocket(`wss://${host}:5036`);

  const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
  socket.addEventListener('message', (evt: MessageEvent) => {
    try {
      const msg = JSON.parse(evt.data as string);
      const p = pending.get(msg.clientMsgId);
      if (!p) return;
      pending.delete(msg.clientMsgId);
      if (msg.payloadType === 2142) p.reject(new Error(msg.payload?.description ?? 'cTrader error'));
      else p.resolve(msg.payload);
    } catch { /* ignore malformed frame */ }
  });

  const send = (payloadType: number, payload: Record<string, unknown>) => {
    const clientMsgId = crypto.randomUUID();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(clientMsgId); reject(new Error('cTrader request timed out')); }, 10_000);
      pending.set(clientMsgId, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      socket.send(JSON.stringify({ clientMsgId, payloadType, payload }));
    });
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cTrader connect timed out')), 10_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cTrader connect failed')); }, { once: true });
    });

    await send(2100, { clientId, clientSecret }); // ApplicationAuthReq
    const accountsRes = await send(2149, { accessToken }); // GetAccountsByAccessTokenReq
    return { accounts: accountsRes?.ctidTraderAccount ?? [] };
  } finally {
    socket.close();
  }
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/ctrader/, '');

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  if (!env.CTRADER_CLIENT_ID || !env.CTRADER_CLIENT_SECRET) {
    return json({ error: 'CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET not configured as Pages secrets' }, 503);
  }

  // ── GET /api/ctrader/status ────────────────────────────────────────────
  if (path === '/status' && request.method === 'GET') {
    const [accessToken, accountId] = await Promise.all([
      env.CACHE.get('ctrader:accessToken'),
      env.CACHE.get('ctrader:accountId'),
    ]);
    return json({ connected: Boolean(accessToken && accountId), accountId: accountId ?? null });
  }

  // ── GET /api/ctrader/connect ───────────────────────────────────────────
  if (path === '/connect' && request.method === 'GET') {
    const authUrl = new URL('https://id.ctrader.com/my/settings/openapi/grantingaccess/');
    authUrl.searchParams.set('client_id', env.CTRADER_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri(request));
    authUrl.searchParams.set('scope', 'trading');
    authUrl.searchParams.set('product', 'web');
    return Response.redirect(authUrl.toString(), 302);
  }

  // ── GET /api/ctrader/callback ──────────────────────────────────────────
  if (path === '/callback' && request.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code) return html(`<h1>cTrader connection failed</h1><p>No authorization code returned.</p>`, 400);

    try {
      const tokenUrl = new URL('https://openapi.ctrader.com/apps/token');
      tokenUrl.searchParams.set('grant_type', 'authorization_code');
      tokenUrl.searchParams.set('code', code);
      tokenUrl.searchParams.set('redirect_uri', redirectUri(request));
      tokenUrl.searchParams.set('client_id', env.CTRADER_CLIENT_ID);
      tokenUrl.searchParams.set('client_secret', env.CTRADER_CLIENT_SECRET);

      const tokenRes = await fetch(tokenUrl.toString());
      const tokenData: any = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.accessToken) {
        throw new Error(tokenData.error ?? tokenData.errorDescription ?? `Token exchange failed [${tokenRes.status}]`);
      }

      const { accounts } = await ctraderOneShot(env, env.CTRADER_CLIENT_ID, env.CTRADER_CLIENT_SECRET, tokenData.accessToken);
      const requestedAccountId = url.searchParams.get('accountId');
      const chosen = requestedAccountId
        ? accounts.find(a => String(a.ctidTraderAccountId) === requestedAccountId)
        : accounts[0];

      if (!chosen) {
        return html(`<h1>cTrader connected, but no trading account found</h1><p>Token exchange succeeded but no ctidTraderAccountId was returned for this token.</p>`, 502);
      }

      await Promise.all([
        env.CACHE.put('ctrader:accessToken', tokenData.accessToken),
        env.CACHE.put('ctrader:refreshToken', tokenData.refreshToken ?? ''),
        env.CACHE.put('ctrader:accountId', String(chosen.ctidTraderAccountId)),
      ]);

      const otherAccounts = accounts.filter(a => a.ctidTraderAccountId !== chosen.ctidTraderAccountId);
      return html(`
        <h1>cTrader connected</h1>
        <p>Account <strong>${chosen.ctidTraderAccountId}</strong> (${chosen.isLive ? 'live' : 'demo'}) is now connected.
        The automated bot pipeline will pick this up automatically.</p>
        ${otherAccounts.length ? `<p>Other accounts on this token: ${otherAccounts.map(a => a.ctidTraderAccountId).join(', ')} —
        re-run this flow with <code>?accountId=&lt;id&gt;</code> to use a different one.</p>` : ''}
      `);
    } catch (err: any) {
      return html(`<h1>cTrader connection failed</h1><p>${err?.message ?? 'Unknown error'}</p>`, 502);
    }
  }

  return json({ error: 'Not found' }, 404);
};
