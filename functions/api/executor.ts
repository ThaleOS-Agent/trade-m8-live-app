/**
 * Executor Health & Proxy — Pages Function
 *
 * Routes:
 *   GET  /api/executor/health   — proxy to Python executor /health (public, read-only)
 *   GET  /api/executor/status   — proxy to /status          (user JWT required)
 *   POST /api/executor/risk     — proxy to /risk/evaluate   (user JWT required)
 *   POST /api/executor/execute  — proxy to /execute         (user JWT required)
 *
 * _middleware.ts passes /api/executor/* through with next(), so this file MUST
 * enforce user auth itself. The executor secret is attached server-side; without
 * the JWT check, anyone could place orders through this proxy.
 *
 * The Python executor runs on AWS Tokyo (ap-northeast-1).
 *   npx wrangler pages secret put EXECUTOR_URL    --project-name=trade-m8-live-app
 *   npx wrangler pages secret put EXECUTOR_SECRET --project-name=trade-m8-live-app
 */

import { verifyUser } from '../lib/security';

interface Env {
  EXECUTOR_URL:    string;
  EXECUTOR_SECRET: string;
  PAPER_MODE:      string;
  ENABLE_PAPER_TRADING?: string;
  ENABLE_LIVE_TRADING?: string;
  DEMO_MODE?: string;
  JWT_SECRET?: string;
  SESSIONS?: KVNamespace;
}

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function modeFlags(env: Env) {
  return {
    paper_mode:           env.PAPER_MODE !== 'false',
    enable_paper_trading: env.ENABLE_PAPER_TRADING !== 'false',
    enable_live_trading:  env.ENABLE_LIVE_TRADING === 'true',
    demo_mode:            env.DEMO_MODE !== 'false',
  };
}

async function proxyToExecutor(
  env:      Env,
  path:     string,
  method:   string = 'GET',
  body?:    unknown,
  authRequired: boolean = false,
): Promise<Response> {
  if (!env.EXECUTOR_URL) {
    return json({
      error:        'Executor not configured',
      executor_url: 'not-configured',
      ...modeFlags(env),
      fix:          'Set EXECUTOR_URL via: npx wrangler pages secret put EXECUTOR_URL',
    }, 503);
  }
  if (authRequired && !env.EXECUTOR_SECRET) {
    return json({ error: 'EXECUTOR_SECRET not configured on Pages project' }, 503);
  }

  const url = `${env.EXECUTOR_URL.replace(/\/$/, '')}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authRequired) headers['Authorization'] = `Bearer ${env.EXECUTOR_SECRET.trim()}`;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body:   body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });

    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { error: 'Non-JSON response from executor', body: text.slice(0, 200) }; }

    // Make auth failures between Pages and the executor unambiguous.
    if (res.status === 401 || res.status === 403) {
      return json({
        error: 'Executor rejected EXECUTOR_SECRET',
        executor_status: res.status,
        fix: 'Set the identical EXECUTOR_SECRET on the Pages project and the executor host, then restart the executor',
      }, 502);
    }
    return json(data, res.status);

  } catch (err: any) {
    const timedOut = err?.name === 'TimeoutError';
    return json({
      executor_reachable: false,
      executor_url:       'configured',
      ...modeFlags(env),
      error:              timedOut ? 'Executor timeout (8s)' : String(err?.message ?? err),
      hint:               timedOut
        ? 'Executor is not running or the tunnel/firewall is blocking the connection'
        : 'Check EXECUTOR_URL is a public https URL (not localhost) and the executor is running',
    }, 503);
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url    = new URL(request.url);
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  // ── GET /api/executor/health — public, read-only ─────────────────────────
  if (url.pathname === '/api/executor/health' && method === 'GET') {
    if (!env.EXECUTOR_URL) {
      return json({
        executor_reachable: false,
        executor_url:       'not-configured',
        ...modeFlags(env),
        message:            'Executor not yet deployed. See executor/DEPLOYMENT.md',
        next_step:          'npx wrangler pages secret put EXECUTOR_URL --project-name=trade-m8-live-app',
      });
    }
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(env.EXECUTOR_URL)) {
      return json({
        executor_reachable: false,
        executor_url:       'misconfigured-localhost',
        ...modeFlags(env),
        error:              'EXECUTOR_URL points at localhost, which Cloudflare cannot reach',
      }, 503);
    }
    return proxyToExecutor(env, '/health', 'GET');
  }

  // Everything below can move money or reveal account state — require a logged-in user.
  const auth = await verifyUser(request, env);
  if (!auth.valid) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (url.pathname === '/api/executor/status' && method === 'GET') {
    return proxyToExecutor(env, '/status', 'GET', undefined, true);
  }

  if (url.pathname === '/api/executor/risk' && method === 'POST') {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
    return proxyToExecutor(env, '/risk/evaluate', 'POST', body, true);
  }

  if (url.pathname === '/api/executor/execute' && method === 'POST') {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
    return proxyToExecutor(env, '/execute', 'POST', body, true);
  }

  return json({ error: 'Not found' }, 404);
};
