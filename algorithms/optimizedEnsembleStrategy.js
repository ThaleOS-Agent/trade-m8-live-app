/**
 * optimizedEnsembleStrategy.js  —  XQ Trade M8
 * ================================================
 * Ensemble signal aggregation with regime-adaptive weighting.
 *
 * Changes vs original
 * --------------------
 * 1.  Regime weights applied DIRECTLY as weight vector, not as multiplicative
 *     boost.  Original boost-then-normalise was a mathematical no-op —
 *     0.03 * 1.4 = 0.042, after normalise ≈ 0.03.  Now regime selects the
 *     weight set outright.
 * 2.  projectedWinRate removed from deployOptimizedStrategy().  Confidence
 *     is not win rate.  No forward-performance claim is made.
 * 3.  calculateVolatilityRank() — historical vol array is seeded from a
 *     deterministic rolling buffer, not Math.random() on every call.
 * 4.  estimatedWinRate — removed hardcoded 0.848.  Kelly uses realWinRate
 *     passed in from the trade log, or 0.5 as a conservative default.
 * 5.  Fibonacci time levels removed — clock-based signal boost had no
 *     market-data justification.
 * 6.  Kelly cap reduced from 0.35 to 0.15 (15% max position per trade).
 * 7.  rlBoost constant removed.  applyAdvancedOptimizations now returns
 *     the signal unchanged unless a genuine market condition qualifies.
 * 8.  calculateTimeOptimization now uses UTC hours to align with exchange
 *     session times, not local system clock.
 *
 * PROVENANCE NOTE:
 *   All win-rate and profit-factor figures in comments are BACKTEST_SYNTHETIC.
 *   The only authoritative win-rate figure is 37.2% from 19,883 live trades.
 */

'use strict';

class OptimizedEnsembleStrategy {
  /**
   * @param {object} opts
   * @param {number} [opts.realWinRate=0.5]     Actual win rate from trade log.
   *                                             Defaults to 0.5 (conservative).
   * @param {number} [opts.realAvgWin=1.5]      Actual avg win R-multiple.
   * @param {number} [opts.realAvgLoss=1.0]     Actual avg loss R-multiple.
   * @param {number} [opts.volBufferSize=50]     Rolling vol window for rank.
   */
  constructor({
    realWinRate  = 0.5,
    realAvgWin   = 1.5,
    realAvgLoss  = 1.0,
    volBufferSize = 50,
  } = {}) {
    // ── Strategy base weights (regime-agnostic fallback) ────────────────────
    // Values reflect relative strategy quality — used only when no regime
    // weight set matches.
    this.baseWeights = {
      enhancedNeural:     0.30,
      advancedFibonacci:  0.20,
      volatilityMomentum: 0.15,
      optimizedKelly:     0.10,
      multiTimeframeTrend: 0.10,
      dynamicMeanReversion: 0.08,
      volumeBreakout:     0.07,
    };

    // ── Regime weight sets (applied DIRECTLY — not as boost) ────────────────
    // Each set must sum to 1.0.  Each key matches a strategy name above.
    this.regimeWeights = {
      trending: {
        multiTimeframeTrend: 0.35,
        enhancedNeural:      0.30,
        advancedFibonacci:   0.20,
        volumeBreakout:      0.10,
        volatilityMomentum:  0.05,
        dynamicMeanReversion: 0.00,
        optimizedKelly:      0.00,
      },
      ranging: {
        dynamicMeanReversion: 0.35,
        advancedFibonacci:    0.30,
        volatilityMomentum:   0.20,
        enhancedNeural:       0.10,
        optimizedKelly:       0.05,
        multiTimeframeTrend:  0.00,
        volumeBreakout:       0.00,
      },
      volatile: {
        volatilityMomentum:  0.40,
        optimizedKelly:      0.25,
        enhancedNeural:      0.20,
        volumeBreakout:      0.10,
        advancedFibonacci:   0.05,
        multiTimeframeTrend: 0.00,
        dynamicMeanReversion: 0.00,
      },
      calm: {
        enhancedNeural:      0.40,
        advancedFibonacci:   0.25,
        multiTimeframeTrend: 0.20,
        dynamicMeanReversion: 0.10,
        volatilityMomentum:  0.05,
        optimizedKelly:      0.00,
        volumeBreakout:      0.00,
      },
    };

    this.confidenceThresholds = { high: 0.80, medium: 0.65, low: 0.45 };

    // Real performance figures passed from trade log
    this.realWinRate  = realWinRate;
    this.realAvgWin   = realAvgWin;
    this.realAvgLoss  = realAvgLoss;

    // Rolling volatility buffer for deterministic rank calculation
    this._volBuffer     = [];
    this._volBufferSize = volBufferSize;
  }

  // ── Main entry point ────────────────────────────────────────────────────────

  async generateOptimizedSignal(symbol, marketData) {
    const marketRegime    = this.detectMarketRegime(marketData);
    const weights         = this.getRegimeWeights(marketRegime);
    const signals         = await this.generateEnhancedSignals(symbol, marketData);
    const filtered        = this.applyConfidenceFiltering(signals);
    const consensus       = this.calculateConsensus(filtered, weights);
    const optimized       = this.applyOptimizations(consensus, marketData);
    return optimized;
  }

  // ── Regime detection ────────────────────────────────────────────────────────

  detectMarketRegime(marketData) {
    const volatility = marketData.volatility ?? 0.02;
    const momentum   = Math.abs(marketData.momentum ?? 0);
    const rsi        = marketData.rsi ?? 50;
    const volume     = marketData.volume     ?? 1_000_000;
    const avgVolume  = marketData.avgVolume  ?? volume;

    if (volatility > 0.04 && volume > avgVolume * 2.0)  return 'volatile';
    if (momentum > 0.7 && (rsi > 60 || rsi < 40))       return 'trending';
    if (volatility < 0.015 && momentum < 0.3)            return 'calm';
    return 'ranging';
  }

  // ── Regime weights (FIX: applied directly, not as boost) ──────────────────

  getRegimeWeights(regime) {
    // Return the full weight set for this regime.
    // Falls back to baseWeights if regime is unrecognised.
    return this.regimeWeights[regime] ?? this.baseWeights;
  }

  // ── Signal generation ────────────────────────────────────────────────────────

  async generateEnhancedSignals(symbol, marketData) {
    const generators = [
      this.generateEnhancedNeuralSignal.bind(this),
      this.generateAdvancedFibonacciSignal.bind(this),
      this.generateVolatilityMomentumSignal.bind(this),
      this.generateKellySignal.bind(this),
      this.generateMultiTimeframeTrendSignal.bind(this),
      this.generateDynamicMeanReversionSignal.bind(this),
      this.generateVolumeBreakoutSignal.bind(this),
    ];

    const results = await Promise.allSettled(
      generators.map(fn => fn(symbol, marketData))
    );

    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
  }

  // ── Neural signal ────────────────────────────────────────────────────────────

  async generateEnhancedNeuralSignal(symbol, marketData) {
    const price      = marketData.price      ?? 100;
    const volume     = marketData.volume     ?? 1_000_000;
    const volatility = marketData.volatility ?? 0.02;
    const rsi        = marketData.rsi        ?? 50;
    const macd       = marketData.macd       ?? 0;

    const features = [
      (price - 100) / 100,
      Math.log(Math.max(volume, 1)) / 15,
      volatility * 50,
      (rsi - 50) / 50,
      Math.tanh(macd / 10),
    ];

    // Static weights — represent a trained 5→5→3→1 network
    const h1 = this._activateLayer(features, [
      [ 0.45,  0.32,  0.23, -0.18,  0.27],
      [ 0.38, -0.25,  0.41,  0.33, -0.29],
      [ 0.52,  0.18, -0.35,  0.47,  0.22],
      [-0.31,  0.44,  0.28, -0.39,  0.51],
      [ 0.29, -0.42,  0.36,  0.25, -0.48],
    ]);

    const h2 = this._activateLayer(h1, [
      [ 0.67, -0.48,  0.35],
      [-0.52,  0.71,  0.43],
      [ 0.38,  0.29, -0.64],
    ]);

    const prediction  = this._activateLayer(h2, [[0.78, -0.65, 0.52]])[0];
    const confidence  = Math.min(0.90, Math.abs(prediction) + 0.10);
    const action      = prediction > 0.25 ? 'buy' : prediction < -0.25 ? 'sell' : 'hold';

    return { strategy: 'enhancedNeural', symbol, action, confidence,
             reasoning: `Neural output: ${prediction.toFixed(3)}` };
  }

  _activateLayer(inputs, weights) {
    return weights.map(w => Math.tanh(
      w.reduce((sum, wi, i) => sum + wi * (inputs[i] ?? 0), 0)
    ));
  }

  // ── Fibonacci signal (clock-based levels removed) ────────────────────────────

  async generateAdvancedFibonacciSignal(symbol, marketData) {
    const price  = marketData.price ?? 100;
    const high   = marketData.high  ?? price * 1.03;
    const low    = marketData.low   ?? price * 0.97;
    const volume = marketData.volume    ?? 1_000_000;
    const avgVol = marketData.avgVolume ?? volume;

    const retracementLevels = this._fibLevels(high, low);
    const extensionLevels   = this._fibExtensions(high, low, price);

    const retSig = this._evalFibLevel(price, retracementLevels);
    const extSig = this._evalFibLevel(price, extensionLevels);

    const volBoost = volume > avgVol * 1.2 ? 1.1 : 0.9;   // volume confirmation
    const combined = ((retSig.confidence + extSig.confidence) / 2) * volBoost;

    const action =
      combined > 0.75 && retSig.action === extSig.action
        ? retSig.action
        : 'hold';

    return {
      strategy: 'advancedFibonacci', symbol, action,
      confidence: Math.min(0.88, combined),
      reasoning: `Fib confluence: ${retSig.level ?? 'none'} / ${extSig.level ?? 'none'}`,
    };
  }

  _fibLevels(high, low) {
    const r = high - low;
    return {
      '0':     low,
      '0.236': low + r * 0.236,
      '0.382': low + r * 0.382,
      '0.500': low + r * 0.500,
      '0.618': low + r * 0.618,
      '1':     high,
    };
  }

  _fibExtensions(high, low, current) {
    const r = high - low;
    const above = current > (high + low) / 2;
    return Object.fromEntries(
      [1.618, 2.618, 4.236].map(ext => [
        String(ext),
        above ? high + r * (ext - 1) : low - r * (ext - 1),
      ])
    );
  }

  _evalFibLevel(price, levels) {
    let closestLevel = null, closestDist = Infinity, confidence = 0;
    for (const [label, value] of Object.entries(levels)) {
      const relDist = Math.abs(price - value) / price;
      if (relDist < 0.01) {
        confidence = Math.max(confidence, 0.9 - relDist * 10);
        if (relDist < closestDist) { closestDist = relDist; closestLevel = label; }
      }
    }
    const action = closestLevel && parseFloat(closestLevel) < 1
      ? (price < levels[closestLevel] ? 'buy' : 'sell')
      : 'hold';
    return { level: closestLevel, confidence, action };
  }

  // ── Volatility momentum (FIX: deterministic vol rank) ────────────────────────

  async generateVolatilityMomentumSignal(symbol, marketData) {
    const volatility  = marketData.volatility ?? 0.02;
    const momentum    = marketData.momentum   ?? 0;
    const volume      = marketData.volume     ?? 1_000_000;
    const avgVolume   = marketData.avgVolume  ?? volume;

    // Update rolling buffer and compute rank deterministically
    this._volBuffer.push(volatility);
    if (this._volBuffer.length > this._volBufferSize)
      this._volBuffer.shift();

    const sorted   = [...this._volBuffer].sort((a, b) => a - b);
    const idx      = sorted.indexOf(volatility);
    const volRank  = idx >= 0 ? idx / sorted.length : 0.5;

    const momentumStrength = Math.abs(momentum);
    const volumeRatio      = volume / avgVolume;

    let confidence = 0, action = 'hold';
    if (volRank > 0.8 && momentumStrength > 0.6 && volumeRatio > 1.5) {
      confidence = 0.85; action = momentum > 0 ? 'buy' : 'sell';
    } else if (volRank > 0.5 && momentumStrength > 0.4 && volumeRatio > 1.2) {
      confidence = 0.68; action = momentum > 0 ? 'buy' : 'sell';
    } else if (volRank < 0.3) {
      confidence = 0.80; action = 'hold';
    }

    return {
      strategy: 'volatilityMomentum', symbol, action, confidence,
      reasoning: `Vol rank: ${(volRank * 100).toFixed(1)}%, momentum: ${momentum.toFixed(3)}`,
    };
  }

  // ── Kelly signal (FIX: uses real win rate, not hardcoded 0.848) ──────────────

  async generateKellySignal(symbol, marketData) {
    // Uses this.realWinRate — set from actual trade log on construction
    const winRate = this.realWinRate;
    const b       = this.realAvgWin / this.realAvgLoss;
    const q       = 1 - winRate;
    const kelly   = (b * winRate - q) / b;
    // Cap at 15% — conservative; original had 35% which risks ruin
    const kellyPct = Math.max(0, Math.min(0.15, kelly));

    let action = 'hold', confidence = 0;
    if (kellyPct > 0.10) { action = 'buy'; confidence = Math.min(0.80, kellyPct * 5); }
    else if (kellyPct > 0.05) { action = 'buy'; confidence = Math.min(0.65, kellyPct * 5); }

    return {
      strategy: 'optimizedKelly', symbol, action, confidence,
      reasoning: `Kelly: ${(kellyPct * 100).toFixed(1)}% (WR: ${(winRate * 100).toFixed(1)}%)`,
    };
  }

  // ── Multi-timeframe trend ─────────────────────────────────────────────────────

  async generateMultiTimeframeTrendSignal(symbol, marketData) {
    const price  = marketData.price  ?? 100;
    const ema20  = marketData.ema20  ?? price;
    const ema50  = marketData.ema50  ?? price * 0.99;
    const ema200 = marketData.ema200 ?? price * 0.98;

    const shortTrend  = ema20 > ema50  ? 1 : -1;
    const mediumTrend = ema50 > ema200 ? 1 : -1;
    const longTrend   = price > ema200 ? 1 : -1;
    const alignment   = shortTrend + mediumTrend + longTrend;
    const strength    = Math.abs(alignment) / 3;

    let action = 'hold', confidence = 0.5;
    if      (alignment >= 2) { action = 'buy';  confidence = 0.70 + strength * 0.15; }
    else if (alignment <= -2){ action = 'sell'; confidence = 0.70 + strength * 0.15; }

    return {
      strategy: 'multiTimeframeTrend', symbol, action,
      confidence: Math.min(0.88, confidence),
      reasoning: `Trend alignment: ${alignment}/3`,
    };
  }

  // ── Mean reversion ────────────────────────────────────────────────────────────

  async generateDynamicMeanReversionSignal(symbol, marketData) {
    const rsi        = marketData.rsi        ?? 50;
    const price      = marketData.price      ?? 100;
    const sma20      = marketData.sma20      ?? price;
    const volatility = marketData.volatility ?? 0.02;

    const oversold    = volatility > 0.03 ? 25 : 30;
    const overbought  = volatility > 0.03 ? 75 : 70;
    const deviation   = (price - sma20) / sma20;
    const devThresh   = volatility * 2;

    let action = 'hold', confidence = 0.5;
    if      (rsi < oversold  && deviation < -devThresh) { action = 'buy';  confidence = 0.78 + (oversold - rsi) / 100; }
    else if (rsi > overbought && deviation >  devThresh) { action = 'sell'; confidence = 0.78 + (rsi - overbought) / 100; }

    return {
      strategy: 'dynamicMeanReversion', symbol, action,
      confidence: Math.min(0.88, confidence),
      reasoning: `RSI: ${rsi.toFixed(1)}, Dev: ${(deviation * 100).toFixed(1)}%`,
    };
  }

  // ── Volume breakout ───────────────────────────────────────────────────────────

  async generateVolumeBreakoutSignal(symbol, marketData) {
    const price      = marketData.price      ?? 100;
    const volume     = marketData.volume     ?? 1_000_000;
    const avgVolume  = marketData.avgVolume  ?? volume;
    const resistance = marketData.resistance ?? price * 1.02;
    const support    = marketData.support    ?? price * 0.98;
    const volatility = marketData.volatility ?? 0.02;

    const volumeRatio  = volume / avgVolume;
    const volThreshold = volatility > 0.03 ? 2.0 : 1.5;

    let action = 'hold', confidence = 0.5;
    if      (price > resistance && volumeRatio > volThreshold) { action = 'buy';  confidence = 0.70 + Math.min(0.15, (volumeRatio - volThreshold) * 0.1); }
    else if (price < support    && volumeRatio > volThreshold) { action = 'sell'; confidence = 0.70 + Math.min(0.15, (volumeRatio - volThreshold) * 0.1); }

    return {
      strategy: 'volumeBreakout', symbol, action,
      confidence: Math.min(0.85, confidence),
      reasoning: `Vol ratio: ${volumeRatio.toFixed(1)}x`,
    };
  }

  // ── Confidence filter ─────────────────────────────────────────────────────────

  applyConfidenceFiltering(signals) {
    return signals.filter(s => s.confidence >= this.confidenceThresholds.low);
  }

  // ── Consensus (FIX: uses regime weights properly) ────────────────────────────

  calculateConsensus(signals, weights) {
    if (!signals.length) {
      return { strategy: 'optimizedEnsemble', symbol: 'UNKNOWN',
               action: 'hold', confidence: 0, reasoning: 'No signals passed threshold' };
    }

    let buyScore = 0, sellScore = 0, totalWeight = 0;
    const reasonings = [];

    for (const sig of signals) {
      const w            = weights[sig.strategy] ?? 0.05;
      const contribution = sig.confidence * w;

      if      (sig.action === 'buy')  buyScore  += contribution;
      else if (sig.action === 'sell') sellScore += contribution;

      totalWeight += w;
      reasonings.push(`${sig.strategy}: ${sig.action} (${(sig.confidence * 100).toFixed(0)}%)`);
    }

    if (totalWeight === 0) return { strategy: 'optimizedEnsemble',
      symbol: signals[0]?.symbol ?? 'UNKNOWN', action: 'hold',
      confidence: 0, reasoning: 'Zero total weight' };

    const normBuy  = buyScore  / totalWeight;
    const normSell = sellScore / totalWeight;

    let finalAction = 'hold', finalConfidence = 0;

    if (normBuy > 0.55 && normBuy > normSell * 1.3) {
      finalAction     = 'buy';
      finalConfidence = Math.min(0.92, normBuy);
    } else if (normSell > 0.55 && normSell > normBuy * 1.3) {
      finalAction     = 'sell';
      finalConfidence = Math.min(0.92, normSell);
    }

    return {
      strategy: 'optimizedEnsemble',
      symbol:   signals[0]?.symbol ?? 'UNKNOWN',
      action:   finalAction,
      confidence: finalConfidence,
      reasoning: reasonings.join('; '),
    };
  }

  // ── Post-processing (FIX: no hardcoded rlBoost) ──────────────────────────────

  applyOptimizations(signal, marketData) {
    if (signal.action === 'hold') return signal;

    // Session quality boost — genuine market condition, UTC hours
    const sessionBoost = this._sessionBoost();

    // Volatility sweet spot — meaningful market condition
    const vol      = marketData.volatility ?? 0.02;
    const volBoost = (vol > 0.02 && vol < 0.04) ? 0.01 : 0;

    const totalBoost       = sessionBoost + volBoost;
    const enhancedConfidence = Math.min(0.92, signal.confidence * (1 + totalBoost));

    return {
      ...signal,
      confidence: enhancedConfidence,
      reasoning: totalBoost > 0
        ? `${signal.reasoning}; session+vol boost: +${(totalBoost * 100).toFixed(1)}%`
        : signal.reasoning,
    };
  }

  _sessionBoost() {
    // UTC hour — aligns with London (8-17) and NY (13-22) sessions
    const utcHour = new Date().getUTCHours();
    if (utcHour >= 8 && utcHour < 17) return 0.01;   // London
    if (utcHour >= 13 && utcHour < 22) return 0.01;  // NY
    return 0;
  }

  // ── Diagnostics (no forward-performance claims) ───────────────────────────────

  async runDiagnostics(testSymbols = ['BTC/USD', 'ETH/USD', 'XAU/USD', 'EUR/USD']) {
    const results = [];
    for (const symbol of testSymbols) {
      const md     = this._testMarketData(symbol);
      const signal = await this.generateOptimizedSignal(symbol, md);
      results.push({ symbol, action: signal.action,
                     confidence: signal.confidence, reasoning: signal.reasoning });
    }

    console.log('\n── Ensemble Diagnostics ────────────────────────────────');
    console.log('⚠  PROVENANCE: BACKTEST_SYNTHETIC — not forward performance');
    results.forEach(r =>
      console.log(`  ${r.symbol}: ${r.action.toUpperCase()} conf=${(r.confidence * 100).toFixed(1)}%`)
    );
    console.log('────────────────────────────────────────────────────────\n');

    return results;
  }

  _testMarketData(symbol) {
    const base = symbol.includes('BTC') ? 67000
               : symbol.includes('ETH') ? 3480
               : symbol.includes('XAU') ? 2324
               : 1.085;
    return {
      price: base, high: base * 1.01, low: base * 0.99,
      volume: 800_000, avgVolume: 900_000,
      volatility: 0.02, momentum: 0.2,
      rsi: 52, macd: 0.3,
      ema20: base * 1.001, ema50: base * 0.998, ema200: base * 0.99,
      sma20: base * 1.001,
      resistance: base * 1.02, support: base * 0.98,
    };
  }
}

module.exports = { OptimizedEnsembleStrategy };
