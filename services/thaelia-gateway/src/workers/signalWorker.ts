// ============================================================
// THAELIA Exchange Gateway v1.0 — Signal Worker
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// Consumes normalized ticks from Market Data Worker.
// Calculates: RSI, MACD, ATR, TrendState, VolatilityRegime.
// Pushes signals to signalQueue.
// NEVER places orders — only signal production.
// ============================================================

import { EventEmitter } from 'events';
import type { NormalizedTick, MarketSignal } from '../core/types';
import { signalQueue } from '../queue/asyncQueue';

const RSI_PERIOD = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const ATR_PERIOD = 14;
const MIN_CANDLES = 30; // minimum data points before emitting signals

interface PriceHistory {
  closes: number[];
  highs: number[];
  lows: number[];
  lastProcessed: number;
}

export class SignalWorker extends EventEmitter {
  private history = new Map<string, PriceHistory>(); // "exchange:symbol"

  ingestTick(tick: NormalizedTick): void {
    const key = `${tick.exchange}:${tick.symbol}`;
    const h = this.history.get(key) ?? { closes: [], highs: [], lows: [], lastProcessed: 0 };

    // Throttle: one signal per second per symbol
    const now = Date.now();
    if (now - h.lastProcessed < 1_000) return;
    h.lastProcessed = now;

    const mid = (tick.bid + tick.ask) / 2;
    h.closes.push(mid);
    h.highs.push(tick.ask);
    h.lows.push(tick.bid);

    // Rolling window — keep only what we need
    const maxLen = Math.max(RSI_PERIOD, MACD_SLOW, ATR_PERIOD) * 3;
    if (h.closes.length > maxLen) {
      h.closes.shift();
      h.highs.shift();
      h.lows.shift();
    }

    this.history.set(key, h);

    if (h.closes.length < MIN_CANDLES) return;

    const signal = this.computeSignal(tick, h);
    if (!signal) return;

    signalQueue.push(tick.exchange, 'signal', signal);
    this.emit('signal', signal);
  }

  private computeSignal(tick: NormalizedTick, h: PriceHistory): MarketSignal | null {
    try {
      const rsi = this.rsi(h.closes, RSI_PERIOD);
      const { macd, signal: macdSig } = this.macd(h.closes, MACD_FAST, MACD_SLOW, MACD_SIGNAL);
      const atr = this.atr(h.highs, h.lows, h.closes, ATR_PERIOD);
      const trendState = this.trendState(h.closes);
      const volatilityRegime = this.volatilityRegime(atr, h.closes[h.closes.length - 1]);

      const direction = this.direction(rsi, macd, macdSig, trendState);
      const strength = this.signalStrength(rsi, macd, macdSig);

      return {
        exchange: tick.exchange,
        symbol: tick.symbol,
        direction,
        strength,
        rsi,
        macd,
        macdSignal: macdSig,
        atr,
        trendState,
        volatilityRegime,
        generatedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  // ---- Indicators ----

  private rsi(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i <= period; i++) {
      const delta = closes[closes.length - period - 1 + i] - closes[closes.length - period - 2 + i];
      gains.push(Math.max(0, delta));
      losses.push(Math.max(0, -delta));
    }
    const avgGain = gains.reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private ema(values: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const result: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      result.push(values[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  }

  private macd(closes: number[], fast: number, slow: number, signal: number): { macd: number; signal: number } {
    if (closes.length < slow + signal) return { macd: 0, signal: 0 };
    const emaFast = this.ema(closes, fast);
    const emaSlow = this.ema(closes, slow);
    const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
    const signalLine = this.ema(macdLine.slice(-signal * 2), signal);
    return {
      macd: macdLine[macdLine.length - 1],
      signal: signalLine[signalLine.length - 1],
    };
  }

  private atr(highs: number[], lows: number[], closes: number[], period: number): number {
    if (closes.length < period + 1) return 0;
    const trs: number[] = [];
    const start = closes.length - period - 1;
    for (let i = start + 1; i < closes.length; i++) {
      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - closes[i - 1]);
      const lc = Math.abs(lows[i] - closes[i - 1]);
      trs.push(Math.max(hl, hc, lc));
    }
    return trs.reduce((a, b) => a + b, 0) / trs.length;
  }

  private trendState(closes: number[]): MarketSignal['trendState'] {
    const n = closes.length;
    if (n < 20) return 'ranging';
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const sma50 = closes.length >= 50
      ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50
      : sma20;
    const last = closes[n - 1];
    if (last > sma20 && sma20 > sma50) return 'uptrend';
    if (last < sma20 && sma20 < sma50) return 'downtrend';
    return 'ranging';
  }

  private volatilityRegime(atr: number, price: number): MarketSignal['volatilityRegime'] {
    if (price === 0) return 'medium';
    const atrPct = atr / price;
    if (atrPct < 0.005) return 'low';
    if (atrPct > 0.02) return 'high';
    return 'medium';
  }

  private direction(
    rsi: number,
    macd: number,
    macdSig: number,
    trend: MarketSignal['trendState']
  ): MarketSignal['direction'] {
    const rsiLong = rsi > 55;
    const rsiShort = rsi < 45;
    const macdLong = macd > macdSig;
    const macdShort = macd < macdSig;
    const trendLong = trend === 'uptrend';
    const trendShort = trend === 'downtrend';

    const longScore = (rsiLong ? 1 : 0) + (macdLong ? 1 : 0) + (trendLong ? 1 : 0);
    const shortScore = (rsiShort ? 1 : 0) + (macdShort ? 1 : 0) + (trendShort ? 1 : 0);

    if (longScore >= 2) return 'long';
    if (shortScore >= 2) return 'short';
    return 'flat';
  }

  private signalStrength(rsi: number, macd: number, macdSig: number): number {
    const rsiDist = Math.abs(rsi - 50) / 50;
    const macdDiff = Math.abs(macd - macdSig);
    const macdNorm = Math.min(1, macdDiff / 10);
    return Math.round(((rsiDist + macdNorm) / 2) * 100) / 100;
  }
}

export const signalWorker = new SignalWorker();
