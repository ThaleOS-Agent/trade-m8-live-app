// ============================================================
// THAELIA Exchange Gateway v1.0 — Smart Router
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// Execution ranking:
//   1. Health Score  (35%)
//   2. Lowest Fee    (25%)
//   3. Lowest Spread (20%)
//   4. Slippage est. (10%)
//   5. Latency       (10%)
//
// Returns route confidence score 0–1.
// ============================================================

import type { NormalizedTick, RouteScore, ConnectionHealth, OrderSide } from '../core/types';

// Taker fees (decimal)
const FEES: Record<string, number> = {
  binance:  0.0010,   // 0.10%
  kraken:   0.0026,   // 0.26%
  coinbase: 0.0060,   // 0.60%
  oanda:    0.00010,  // spread-based — near-zero commission
  paper:    0.0000,
};

const WEIGHTS = {
  healthScore:  0.35,
  fee:          0.25,
  spread:       0.20,
  slippage:     0.10,
  latency:      0.10,
};

export class SmartRouter {
  // "exchange:symbol" → latest tick
  private ticks = new Map<string, NormalizedTick>();
  // "exchange" → health
  private health = new Map<string, ConnectionHealth>();

  ingestTick(tick: NormalizedTick): void {
    this.ticks.set(`${tick.exchange}:${tick.symbol}`, tick);
  }

  updateHealth(health: ConnectionHealth): void {
    this.health.set(health.exchange, health);
  }

  getBestRoute(symbol: string, side: OrderSide, quantity: number = 1): RouteScore | null {
    const candidates = this.getCandidates(symbol);
    if (candidates.length === 0) return null;

    const scores = candidates.map(tick => this.scoreRoute(tick, side, quantity));
    scores.sort((a, b) => b.compositeScore - a.compositeScore);

    const best = scores[0];
    best.recommended = true;
    return best;
  }

  getAllRoutes(symbol: string, side: OrderSide, quantity: number = 1): RouteScore[] {
    const candidates = this.getCandidates(symbol);
    const scores = candidates.map(tick => this.scoreRoute(tick, side, quantity));
    scores.sort((a, b) => b.compositeScore - a.compositeScore);
    if (scores.length > 0) scores[0].recommended = true;
    return scores;
  }

  // ---- Private ----

  private getCandidates(symbol: string): NormalizedTick[] {
    const results: NormalizedTick[] = [];
    const cutoff = Date.now() - 10_000; // only quotes < 10s old

    for (const [key, tick] of this.ticks) {
      if (key.endsWith(`:${symbol}`) && tick.receivedAt >= cutoff
          && tick.bid > 0 && tick.ask > 0) {
        results.push(tick);
      }
    }
    return results;
  }

  private scoreRoute(tick: NormalizedTick, side: OrderSide, quantity: number): RouteScore {
    const h = this.health.get(tick.exchange);
    const healthScore = h?.healthScore ?? 0;
    const fee = FEES[tick.exchange] ?? 0.001;
    const executionPrice = side === 'buy' ? tick.ask : tick.bid;
    const feeAdjustedPrice = side === 'buy'
      ? executionPrice * (1 + fee)
      : executionPrice * (1 - fee);
    const slippage = tick.spread / (executionPrice || 1);
    const latencyMs = tick.latencyMs;

    // Normalize each component to 0–1 (higher = better)
    const healthNorm = healthScore / 100;
    const feeNorm = 1 - Math.min(1, fee / 0.01); // 0 fee = 1.0, 1% fee = 0
    const spreadNorm = 1 - Math.min(1, tick.spread / (executionPrice * 0.005 || 1));
    const slippageNorm = 1 - Math.min(1, slippage / 0.005);
    const latencyNorm = 1 - Math.min(1, latencyMs / 500);

    const composite =
      healthNorm  * WEIGHTS.healthScore +
      feeNorm     * WEIGHTS.fee +
      spreadNorm  * WEIGHTS.spread +
      slippageNorm * WEIGHTS.slippage +
      latencyNorm * WEIGHTS.latency;

    // Confidence: penalize if health < 80 or stale data
    const stalePenalty = tick.receivedAt < Date.now() - 5_000 ? 0.5 : 1.0;
    const confidence = Math.round(composite * stalePenalty * 100) / 100;

    const reasons: string[] = [];
    if (healthScore >= 90) reasons.push('Healthy connection');
    if (fee === Math.min(...Object.values(FEES))) reasons.push('Lowest fee');
    if (tick.spread < 1) reasons.push('Tight spread');
    if (latencyMs < 50) reasons.push('Low latency');

    return {
      exchange: tick.exchange,
      healthScore,
      fee,
      spread: tick.spread,
      slippageEstimate: slippage,
      latencyMs,
      compositeScore: Math.round(composite * 1000) / 1000,
      recommended: false,
      confidence,
      reason: reasons.join(', ') || 'Standard route',
    };
  }
}

export const smartRouter = new SmartRouter();
