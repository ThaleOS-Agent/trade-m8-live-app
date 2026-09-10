interface Env {
  ENABLE_PAPER_TRADING?: string;
  ENABLE_LIVE_TRADING?: string;
  DEMO_MODE?: string;
  PAPER_MODE?: string;
  EXECUTOR_URL?: string;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function isTrue(value?: string): boolean {
  return value === 'true';
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const paperEnabled = env.ENABLE_PAPER_TRADING !== 'false';
  const liveEnabled = isTrue(env.ENABLE_LIVE_TRADING);
  const demoMode = env.DEMO_MODE !== 'false';
  const executorPaperMode = env.PAPER_MODE !== 'false';
  const effectiveTradingMode = liveEnabled && !demoMode && !executorPaperMode ? 'live' : 'paper';

  return new Response(JSON.stringify({
    trading: {
      paperEnabled,
      liveEnabled,
      demoMode,
      executorPaperMode,
      effectiveTradingMode,
      canActivateLiveTrading: liveEnabled && !demoMode && !executorPaperMode,
    },
    services: {
      executorConfigured: Boolean(env.EXECUTOR_URL),
    },
    timestamp: new Date().toISOString(),
  }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
};
