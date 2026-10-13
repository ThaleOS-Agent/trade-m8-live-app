// ============================================================
// THAELIA Exchange Gateway v1.0 — Binance Adapter
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// wss://stream.binance.com:9443
// Combined streams, 24h reconnect, ping/pong, 5 msg/sec limit
// ============================================================

import { BaseExchangeAdapter } from './baseAdapter';
import type { NormalizedTick } from '../core/types';

const WS_BASE = process.env.BINANCE_TESTNET === 'true'
  ? 'wss://testnet.binance.vision'
  : 'wss://stream.binance.com:9443';

// Binance requires 24h reconnect — 23.5h to be safe
const CYCLE_RECONNECT_MS = 23.5 * 60 * 60 * 1000;

export class BinanceAdapter extends BaseExchangeAdapter {
  private cycleTimer: NodeJS.Timeout | null = null;

  constructor(symbols: string[], channels: string[] = ['ticker']) {
    const streams = symbols.flatMap(s => {
      const lower = s.toLowerCase().replace('/', '');
      return channels.map(ch => {
        if (ch === 'ticker') return `${lower}@ticker`;
        if (ch === 'trades') return `${lower}@trade`;
        if (ch === 'orderbook') return `${lower}@depth20@1000ms`;
        return `${lower}@ticker`;
      });
    });

    super({
      name: 'binance',
      wsUrl: `${WS_BASE}/stream?streams=${streams.join('/')}`,
      symbols,
      channels,
    });
  }

  protected onOpen(): void {
    // Schedule 24h cycle reconnect
    if (this.cycleTimer) clearTimeout(this.cycleTimer);
    this.cycleTimer = setTimeout(async () => {
      console.log('[Binance] 24h cycle reconnect');
      await this.disconnect();
      await this.connect();
    }, CYCLE_RECONNECT_MS);
  }

  protected subscribeAll(): void {
    // Streams are embedded in the URL for combined stream endpoint
    // No additional subscription needed
  }

  protected sendPing(): void {
    // Binance accepts JSON ping frames
    this.send({ method: 'ping', id: Date.now() });
  }

  protected normalizeMessage(raw: unknown, receivedAt: number): NormalizedTick | null {
    if (!raw || typeof raw !== 'object') return null;
    const msg = raw as Record<string, unknown>;

    // Combined stream wrapper: { stream: "btcusdt@ticker", data: {...} }
    const data = (msg.data ?? msg) as Record<string, unknown>;

    if (data.e === '24hrTicker') {
      const bid = parseFloat(String(data.b ?? 0));
      const ask = parseFloat(String(data.a ?? 0));
      const ts = Number(data.T ?? receivedAt);

      return {
        exchange: 'binance',
        symbol: String(data.s ?? ''),
        assetClass: 'crypto',
        channel: 'ticker',
        bid,
        ask,
        last: parseFloat(String(data.c ?? 0)),
        spread: ask - bid,
        volume: parseFloat(String(data.v ?? 0)),
        timestamp: ts,
        receivedAt,
        sequence: Number(data.u ?? 0),  // last update ID
        latencyMs: receivedAt - ts,
        healthScore: 100, // set by health scorer on read
      };
    }

    if (data.e === 'trade') {
      const price = parseFloat(String(data.p ?? 0));
      const ts = Number(data.T ?? receivedAt);
      return {
        exchange: 'binance',
        symbol: String(data.s ?? ''),
        assetClass: 'crypto',
        channel: 'trades',
        bid: price,
        ask: price,
        last: price,
        spread: 0,
        volume: parseFloat(String(data.q ?? 0)),
        timestamp: ts,
        receivedAt,
        sequence: Number(data.t ?? 0),
        latencyMs: receivedAt - ts,
        healthScore: 100,
      };
    }

    return null;
  }

  async disconnect(): Promise<void> {
    if (this.cycleTimer) { clearTimeout(this.cycleTimer); this.cycleTimer = null; }
    await super.disconnect();
  }
}
