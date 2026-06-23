/**
 * Executor Health & Proxy — Pages Function
 *
 * Routes:
 *   GET  /api/executor/health   — proxy to Python executor /health (no auth)
 *   GET  /api/executor/status   — proxy to Python executor /status (auth required)
 *   POST /api/executor/risk     — proxy to Python executor /risk/evaluate
 *   POST /api/executor/execute  — proxy to Python executor /execute
 *
 * The Python executor runs on AWS Tokyo (ap-northeast-1).
 * EXECUTOR_URL and EXECUTOR_SECRET are set via Cloudflare Pages secrets.
 *
 * Set secrets:
 *   npx wrangler pages secret put EXECUTOR_URL      --project-name=<your-project>
 *   npx wrangler pages secret put EXECUTOR_SECRET   --project-name=<your-project>
 *   npx wrangler pages secret put PAPER_MODE        --project-name=<your-project>
 */

interface Env {
  EXECUTOR_URL:    string;
  EXECUTOR_SECRET: string;
  PAPER_MODE:      string;
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

async function proxyToExecutor(
  env:      Env,
  path:     string,
  method:   string = 'GET',
  body?:    unknown,
  authRequired: boolean = false,
): Promise<Response> {
  if (!env.EXECUTOR_URL) {
    return json({
      error:          'Executor not configured',
      executor_url:   'not-configured',
      paper_mode:     true,
      fix:            'Set EXECUTOR_URL via: npx wrangler pages secret put EXECUTOR_URL',
    }, 503);
  }

  const url = `${env.EXECUTOR_URL.replace(/\/$/, '')}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authRequired && env.EXECUTOR_SECRET) {
    headers['Authorization'] = `Bearer ${env.EXECUTOR_SECRET}`;
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body:   body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json();
    return json(data, res.status);

  } catch (err: any) {
    const timedOut = err?.name === 'TimeoutError';
    return json({
      executor_reachable: false,
      executor_url:       env.EXECUTOR_URL ? 'configured' : 'not-configured',
      paper_mode:         env.PAPER_MODE !== 'false',
      error:              timedOut ? 'Executor timeout (8s)' : String(err?.message ?? err),
      hint:               timedOut
        ? 'Executor is not running or firewall is blocking the connection'
        : 'Check EXECUTOR_URL is correct and the executor service is running',
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

  // ── GET /api/executor/health ─────────────────────────────────────────────
  // No auth — safe to call from monitoring, dashboard, CI
  if (url.pathname === '/api/executor/health' && method === 'GET') {
    if (!env.EXECUTOR_URL) {
      // Executor not yet configured — return structured response, not 503
      return json({
        executor_reachable: false,
        executor_url:       'not-configured',
        paper_mode:         true,
        message:            'Executor not yet deployed. See executor/DEPLOYMENT.md',
        next_step:          'npx wrangler pages secret put EXECUTOR_URL --project-name=<project>',
      });
    }
    return proxyToExecutor(env, '/health', 'GET');
  }

  // ── GET /api/executor/status ─────────────────────────────────────────────
  // Returns session stats — requires executor auth
  if (url.pathname === '/api/executor/status' && method === 'GET') {
    return proxyToExecutor(env, '/status', 'GET', undefined, true);
  }

  // ── POST /api/executor/risk ──────────────────────────────────────────────
  // Risk evaluation — called by dashboard and Worker
  if (url.pathname === '/api/executor/risk' && method === 'POST') {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
    return proxyToExecutor(env, '/risk/evaluate', 'POST', body, true);
  }

  // ── POST /api/executor/execute ───────────────────────────────────────────
  // Order placement — requires auth + PAPER_MODE gate enforced on executor
  if (url.pathname === '/api/executor/execute' && method === 'POST') {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
    return proxyToExecutor(env, '/execute', 'POST', body, true);
  }

  return json({ error: 'Not found' }, 404);
};
