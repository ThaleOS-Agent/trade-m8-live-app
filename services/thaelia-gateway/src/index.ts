// ============================================================
// THAELIA Exchange Gateway v1.0 — Main Entry Point
// XQ Trade M8 Pro | ThaleOS/FernXQ
// ============================================================

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

import { BinanceAdapter }  from './exchanges/binanceAdapter';
import { KrakenAdapter }   from './exchanges/krakenAdapter';
import { CoinbaseAdapter } from './exchanges/coinbaseAdapter';
import { OandaAdapter }    from './exchanges/oandaAdapter';
import { PaperAdapter }    from './exchanges/paperAdapter';

import { marketDataWorker } from './workers/marketDataWorker';
import { signalWorker }     from './workers/signalWorker';
import { executionWorker }  from './workers/executionWorker';
import { riskWorker }       from './workers/riskWorker';
import { thaeliaMonitor }   from './monitoring/thaeliaMonitor';
import { auditLogger }      from './audit/auditLogger';
import { smartRouter }      from './router/smartRouter';
import { sequenceValidator } from './core/sequenceValidator';
import { marketDataQueue, signalQueue, executionQueue, auditQueue } from './queue/asyncQueue';
import type { MonitorSnapshot } from './monitoring/thaeliaMonitor';
import type { NormalizedTick } from './core/types';

const PORT            = parseInt(process.env.GATEWAY_PORT ?? '8080', 10);
const DEMO_MODE       = process.env.DEMO_MODE !== 'false';
const ENABLE_LIVE     = process.env.ENABLE_LIVE_TRADING === 'true';
const DEFAULT_SYMBOLS = (process.env.DEFAULT_SYMBOLS ?? 'BTCUSDT,ETHUSDT,SOLUSDT').split(',');
const DEFAULT_FX      = (process.env.DEFAULT_FX ?? 'EUR_USD,GBP_USD,NZD_USD,XAU_USD').split(',');

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log(  '║  THAELIA Exchange Gateway v1.0                       ║');
console.log(  '║  XQ Trade M8 Pro · ThaleOS/FernXQ                    ║');
console.log(`║  Demo: ${DEMO_MODE ? 'ON ' : 'OFF'}  Live: ${ENABLE_LIVE ? 'ON ⚠ ' : 'OFF  '} Port: ${PORT}                ║`);
console.log(  '╚══════════════════════════════════════════════════════╝\n');

// ---- HTTP + WS Server ----
const httpServer = createServer((req, res) => {
  const url = req.url ?? '/';
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (url === '/health' || url === '/') { res.writeHead(200, cors); res.end(JSON.stringify(thaeliaMonitor.getSnapshot())); return; }
  if (url === '/queues') { res.writeHead(200, cors); res.end(JSON.stringify({ marketData: marketDataQueue.stats(), signal: signalQueue.stats(), execution: executionQueue.stats(), audit: auditQueue.stats() })); return; }
  if (url === '/audit')  { res.writeHead(200, cors); res.end(JSON.stringify(auditLogger.getRecent(50))); return; }
  if (url === '/risk')   { res.writeHead(200, cors); res.end(JSON.stringify(riskWorker.getState())); return; }
  if (url === '/ticks')  { res.writeHead(200, cors); res.end(JSON.stringify(marketDataWorker.getAllTicks())); return; }
  res.writeHead(404, cors); res.end('{}');
});

const wss = new WebSocketServer({ server: httpServer });
const dashboardClients = new Set<WebSocket>();

wss.on('connection', (ws, req) => {
  console.log(`[Gateway] Client connected — ${req.socket.remoteAddress}`);
  dashboardClients.add(ws);
  ws.send(JSON.stringify({ type: 'snapshot', data: thaeliaMonitor.getSnapshot() }));
  ws.on('close', () => dashboardClients.delete(ws));
  ws.on('error', () => dashboardClients.delete(ws));
});

function broadcast(type: string, data: unknown): void {
  const payload = JSON.stringify({ type, data, ts: Date.now() });
  for (const c of dashboardClients) { if (c.readyState === WebSocket.OPEN) c.send(payload); }
}

// ---- Adapters ----
const paper    = new PaperAdapter([...DEFAULT_SYMBOLS, ...DEFAULT_FX.map(s => s.replace('_', '/'))]);
const binance  = new BinanceAdapter(DEFAULT_SYMBOLS, ['ticker', 'trades']);
const kraken   = new KrakenAdapter({ symbols: DEFAULT_SYMBOLS.map(s => s.replace('USDT', '/USD')) });
const coinbase = new CoinbaseAdapter({ symbols: DEFAULT_SYMBOLS.map(s => `${s.replace('USDT', '')}-USD`) });
const oanda    = new OandaAdapter({ symbols: DEFAULT_FX });

const adapters = DEMO_MODE
  ? [paper]
  : [paper, binance, kraken, coinbase, oanda];

// ---- Wire events ----
for (const adapter of adapters) {
  (adapter as NodeJS.EventEmitter).on('stateChange', ({ exchange, state }: { exchange: string; state: string }) => {
    console.log(`[Gateway] ${exchange} → ${state}`);
    broadcast('status', { exchange, state });
  });
  (adapter as NodeJS.EventEmitter).on('sequenceGap', ({ exchange, symbol }: { exchange: string; symbol: string }) => {
    void marketDataWorker.triggerOrderBookRecovery(exchange, symbol);
  });
  (adapter as NodeJS.EventEmitter).on('error', (err: Error) => { console.error(`[Gateway] ${err.message}`); });
}

// ---- Pipeline ----
marketDataWorker.onTick((tick: NormalizedTick) => {
  signalWorker.ingestTick(tick);
  smartRouter.ingestTick(tick);
  broadcast('tick', tick);
});

sequenceValidator.on('SEQUENCE_RECOVERY', ({ exchange, symbol }: { exchange: string; symbol: string }) => {
  void marketDataWorker.triggerOrderBookRecovery(exchange, symbol);
});

thaeliaMonitor.on('snapshot', (snap: MonitorSnapshot) => {
  thaeliaMonitor.updateQueueDepths({ marketData: marketDataQueue.depth, signal: signalQueue.depth, execution: executionQueue.depth, audit: auditQueue.depth });
  broadcast('snapshot', snap);
});
thaeliaMonitor.on('warning', (w: unknown) => broadcast('warning', w));
riskWorker.on('circuitBreaker', ({ reason }: { reason: string }) => { console.error(`[Gateway] CIRCUIT BREAKER: ${reason}`); broadcast('circuitBreaker', { reason }); });

// ---- Boot ----
async function boot(): Promise<void> {
  auditLogger.start();
  marketDataWorker.start();
  executionWorker.start();
  thaeliaMonitor.start();
  setInterval(() => { for (const a of adapters) { const h = (a as { getHealth?(): unknown }).getHealth?.(); if (h) { thaeliaMonitor.updateHealth(h as Parameters<typeof thaeliaMonitor.updateHealth>[0]); smartRouter.updateHealth(h as Parameters<typeof smartRouter.updateHealth>[0]); } } }, 2_000);

  await Promise.allSettled(adapters.map(async (a) => {
    try {
      await (a as { connect(): Promise<void> }).connect();
      console.log(`[Gateway] ${(a as { exchange: string }).exchange} connected`);
    } catch (e) { console.error(`[Gateway] connect failed: ${(e as Error).message}`); }
  }));

  httpServer.listen(PORT, () => {
    console.log(`[Gateway] Ready → http://localhost:${PORT}/health`);
  });
}

async function shutdown(): Promise<void> {
  console.log('\n[Gateway] Shutting down...');
  marketDataWorker.stop(); executionWorker.stop(); thaeliaMonitor.stop(); auditLogger.stop();
  await Promise.allSettled(adapters.map(a => (a as { disconnect(): Promise<void> }).disconnect()));
  httpServer.close(() => process.exit(0));
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT',  () => void shutdown());
process.on('uncaughtException', (e) => console.error('[Gateway] Uncaught:', e.message));

void boot();
