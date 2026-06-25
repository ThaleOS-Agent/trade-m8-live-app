/**
 * Algorithmic Trading Engine for Trade M8
 *
 * Priority fixes applied:
 *  #2  Confidence threshold raised to 0.72
 *  #4  ATR-based dynamic stop-loss / take-profit
 *  #5  Wilder's smoothed RSI
 *  #6  EMA-50 trend filter on RSI reversion
 *  #7  Volume confirmation on breakout
 *  #8  Incremental O(n) MACD
 *  #10 OHLCV KV caching (injected KVNamespace)
 *  #11 Limit orders for mean-reversion strategies
 *  #12 Fee-adjusted minimum take-profit
 *  #13 MACD histogram confidence normalised by price
 *  #14 Kelly-fraction position sizing
 */

import { ExchangeManager, OrderParams, OrderResult, OHLCV } from './sdk-exchange-connector';

// ============================================================================
// TYPES
// ============================================================================

export type StrategyName =
  | 'momentum'
  | 'rsi_reversion'
  | 'macd_crossover'
  | 'breakout'
  | 'scalping'
  | 'dual_ma'
  | 'buy_the_dip'      // Bull-market: RSI pullback inside an EMA-200 uptrend
  | 'trend_following'; // Bull-market: multi-EMA alignment + price-near-EMA21 entry

export type AlgoSignal = 'buy' | 'sell' | 'hold';

export interface AlgoConfig {
  exchange: string;
  symbol: string;
  strategy: StrategyName;
  timeframe: string;        // '1m', '5m', '15m', '1h', '4h', '1d'
  capitalUSDT: number;
  maxOpenTrades: number;
  stopLossPct: number;      // minimum stop-loss; ATR may override upward
  takeProfitPct: number;    // minimum take-profit; fee & R/R may override upward
  paperMode: boolean;
  takerFeeRate?: number;    // default 0.001 (0.1%)
  makerFeeRate?: number;    // default 0.0002 (0.02%)
  params?: {
    rsiPeriod?: number;
    rsiOversold?: number;
    rsiOverbought?: number;
    fastMA?: number;
    slowMA?: number;
    macdFast?: number;
    macdSlow?: number;
    macdSignal?: number;
    breakoutPeriod?: number;
    momentumPeriod?: number;
  };
}

export interface SignalResult {
  signal: AlgoSignal;
  confidence: number;        // 0–1
  reason: string;
  indicatorValues: Record<string, number>;
  suggestedEntry?: number;
}

export interface AlgoTradeResult {
  success: boolean;
  signal: AlgoSignal;
  confidence: number;
  reason: string;
  orderResult?: OrderResult;
  stopLossOrder?: OrderResult;
  takeProfitOrder?: OrderResult;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  paperTrade?: boolean;
  timestamp: string;
  indicators: Record<string, number>;
}

export interface EngineStatus {
  running: boolean;
  exchange: string;
  symbol: string;
  strategy: StrategyName;
  timeframe: string;
  paperMode: boolean;
  lastSignal?: AlgoSignal;
  lastRunAt?: string;
  totalTrades: number;
  profitableTrades: number;
  totalPnl: number;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Strategies that benefit from limit orders (maker pricing). */
const MEAN_REVERSION_STRATEGIES: StrategyName[] = ['rsi_reversion', 'macd_crossover', 'dual_ma'];

/** Convert timeframe string to seconds for KV TTL. */
function timeframeToSeconds(tf: string): number {
  const map: Record<string, number> = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900,
    '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400,
  };
  return map[tf] ?? 900;
}

// ============================================================================
// TECHNICAL INDICATORS
// ============================================================================

/** Returns [prevEma, curEma] in a single O(n) pass — avoids a second full recurrence for crossover detection. */
function emaWithPrev(values: number[], period: number): [number, number] {
  if (values.length < period) {
    const s = sma(values, period);
    return [s, s];
  }
  const k = 2 / (period + 1);
  let val = sma(values.slice(0, period), period);
  let prev = val;
  for (let i = period; i < values.length; i++) {
    prev = val;
    val = values[i] * k + val * (1 - k);
  }
  return [prev, val];
}

// Exported so callers (e.g. backtest regime detector) stay in sync with the engine
export function sma(values: number[], period: number): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(values: number[], period: number): number {
  if (values.length < period) return sma(values, period);
  const k = 2 / (period + 1);
  let val = sma(values.slice(0, period), period);
  for (let i = period; i < values.length; i++) {
    val = values[i] * k + val * (1 - k);
  }
  return val;
}

/**
 * Fix #5 — Wilder's smoothed RSI.
 * Seeds with SMA of first `period` changes then applies recursive smoothing
 * (alpha = 1/period), which is the standard Wilder / TradingView definition.
 */
export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(1).map((v, i) => v - closes[i]);

  // Seed averages with SMA of first `period` up/down moves
  let avgGain = changes.slice(0, period).reduce((s, c) => s + Math.max(c, 0), 0) / period;
  let avgLoss = changes.slice(0, period).reduce((s, c) => s + Math.max(-c, 0), 0) / period;

  // Wilder smoothing for remaining periods
  for (const c of changes.slice(period)) {
    avgGain = (avgGain * (period - 1) + Math.max(c, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-c, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * Fix #8 — Incremental O(n) MACD.
 * Builds the MACD line and signal line in two single passes; also returns
 * the previous histogram value so crossover detection needs no second call.
 */
function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: number; signal: number; histogram: number; prevHistogram: number } {
  if (closes.length < slow + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0, prevHistogram: 0 };
  }

  const fastK = 2 / (fast + 1);
  const slowK = 2 / (slow + 1);

  // Pass 1: build MACD line incrementally
  const macdLine: number[] = [];
  let fastEma = closes[0];
  let slowEma = closes[0];
  for (let i = 1; i < closes.length; i++) {
    fastEma = closes[i] * fastK + fastEma * (1 - fastK);
    slowEma = closes[i] * slowK + slowEma * (1 - slowK);
    if (i >= slow - 1) macdLine.push(fastEma - slowEma);
  }

  // Need at least 2 MACD values to detect a crossover
  if (macdLine.length < 2) {
    return { macd: macdLine[0] ?? 0, signal: macdLine[0] ?? 0, histogram: 0, prevHistogram: 0 };
  }

  // Pass 2: build signal line incrementally, tracking t-1 as well
  const sigK = 2 / (signalPeriod + 1);
  let sigEma = macdLine[0];
  let prevSigEma = sigEma;
  for (let i = 1; i < macdLine.length; i++) {
    prevSigEma = sigEma;
    sigEma = macdLine[i] * sigK + sigEma * (1 - sigK);
  }

  const curMacd = macdLine[macdLine.length - 1];
  const prevMacd = macdLine.length >= 2 ? macdLine[macdLine.length - 2] : curMacd;

  return {
    macd: curMacd,
    signal: sigEma,
    histogram: curMacd - sigEma,
    prevHistogram: prevMacd - prevSigEma,
  };
}

function atr(candles: OHLCV[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs = candles.slice(-period - 1).map((c, i, arr) => {
    if (i === 0) return c.high - c.low;
    const prev = arr[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  return trs.slice(1).reduce((a, b) => a + b, 0) / period;
}

function donchianChannel(candles: OHLCV[], period = 20): { upper: number; lower: number; mid: number } {
  const slice = candles.slice(-period);
  const upper = Math.max(...slice.map(c => c.high));
  const lower = Math.min(...slice.map(c => c.low));
  return { upper, lower, mid: (upper + lower) / 2 };
}

// ============================================================================
// STRATEGY SIGNAL GENERATORS
// ============================================================================

function momentumSignal(candles: OHLCV[], params: AlgoConfig['params'] = {}): SignalResult {
  const period = params.momentumPeriod ?? 10;
  const closes = candles.map(c => c.close);
  const rsiVal = rsi(closes);
  const currentClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - period - 1] ?? closes[0];
  const momentumPct = (currentClose - prevClose) / prevClose * 100;
  const vol20 = sma(candles.map(c => c.volume), 20);
  const currentVol = candles[candles.length - 1].volume;
  const volRatio = currentVol / (vol20 || 1);

  let signal: AlgoSignal = 'hold';
  let confidence = 0;
  let reason = '';

  if (momentumPct > 2 && rsiVal < 70 && volRatio > 1.2) {
    signal = 'buy';
    confidence = Math.min(0.9, 0.5 + momentumPct / 20 + (volRatio - 1) / 10);
    reason = `Strong upward momentum ${momentumPct.toFixed(2)}% with volume surge ${volRatio.toFixed(2)}x`;
  } else if (momentumPct < -2 && rsiVal > 30 && volRatio > 1.2) {
    signal = 'sell';
    confidence = Math.min(0.9, 0.5 + Math.abs(momentumPct) / 20 + (volRatio - 1) / 10);
    reason = `Strong downward momentum ${momentumPct.toFixed(2)}% with volume surge ${volRatio.toFixed(2)}x`;
  } else {
    reason = `Insufficient momentum (${momentumPct.toFixed(2)}%) or volume (${volRatio.toFixed(2)}x)`;
  }

  return { signal, confidence, reason, indicatorValues: { momentum: momentumPct, rsi: rsiVal, volumeRatio: volRatio }, suggestedEntry: currentClose };
}

/**
 * Fix #6 — RSI reversion now requires the trade to be trend-aligned.
 * Buy signals only fire when price > EMA-50 (uptrend); sell signals only
 * when price < EMA-50 (downtrend). This prevents buying into strong downtrends.
 */
function rsiReversionSignal(candles: OHLCV[], params: AlgoConfig['params'] = {}): SignalResult {
  const period = params.rsiPeriod ?? 14;
  const oversold = params.rsiOversold ?? 30;
  const overbought = params.rsiOverbought ?? 70;
  const closes = candles.map(c => c.close);
  const rsiVal = rsi(closes, period);
  const prevRsi = rsi(closes.slice(0, -1), period);
  const currentClose = closes[closes.length - 1];

  // Trend filter: only take trend-aligned reversals
  const ema50 = ema(closes, 50);
  const inUptrend = currentClose > ema50;
  const inDowntrend = currentClose < ema50;

  let signal: AlgoSignal = 'hold';
  let confidence = 0;
  let reason = '';

  if (rsiVal < oversold && prevRsi <= rsiVal && inUptrend) {
    signal = 'buy';
    confidence = Math.min(0.9, (oversold - rsiVal) / oversold + 0.4);
    reason = `RSI oversold reversal: ${rsiVal.toFixed(1)} turning up in uptrend (EMA50=${ema50.toFixed(4)})`;
  } else if (rsiVal > overbought && prevRsi >= rsiVal && inDowntrend) {
    signal = 'sell';
    confidence = Math.min(0.9, (rsiVal - overbought) / (100 - overbought) + 0.4);
    reason = `RSI overbought reversal: ${rsiVal.toFixed(1)} turning down in downtrend (EMA50=${ema50.toFixed(4)})`;
  } else if (rsiVal < oversold && !inUptrend) {
    reason = `RSI oversold (${rsiVal.toFixed(1)}) but trend is bearish — skipping`;
  } else if (rsiVal > overbought && !inDowntrend) {
    reason = `RSI overbought (${rsiVal.toFixed(1)}) but trend is bullish — skipping`;
  } else {
    reason = `RSI neutral at ${rsiVal.toFixed(1)}`;
  }

  return { signal, confidence, reason, indicatorValues: { rsi: rsiVal, prevRsi, ema50 }, suggestedEntry: currentClose };
}

/**
 * Fix #8 (crossover uses prevHistogram) + Fix #13 (confidence normalised by price).
 */
function macdCrossoverSignal(candles: OHLCV[], params: AlgoConfig['params'] = {}): SignalResult {
  const closes = candles.map(c => c.close);
  const fast = params.macdFast ?? 12;
  const slow = params.macdSlow ?? 26;
  const signalPeriod = params.macdSignal ?? 9;
  const price = closes[closes.length - 1];

  // Single call returns both current and previous histogram (O(n) total)
  const current = macd(closes, fast, slow, signalPeriod);

  // Crossover detected by sign change of histogram (equivalent to MACD crossing signal)
  const bullishCross = current.prevHistogram <= 0 && current.histogram > 0;
  const bearishCross = current.prevHistogram >= 0 && current.histogram < 0;

  // Fix #13: normalise histogram by price so confidence is comparable across symbols
  const strengthNorm = Math.abs(current.histogram) / (price || 1);
  const confidence = Math.min(0.85, 0.5 + strengthNorm * 50);

  let signal: AlgoSignal = 'hold';
  let reason = '';

  if (bullishCross) {
    signal = 'buy';
    reason = `MACD bullish crossover — hist: ${current.histogram.toFixed(6)} (${(strengthNorm * 100).toFixed(4)}% of price)`;
  } else if (bearishCross) {
    signal = 'sell';
    reason = `MACD bearish crossover — hist: ${current.histogram.toFixed(6)} (${(strengthNorm * 100).toFixed(4)}% of price)`;
  } else {
    reason = `No MACD crossover (hist: ${current.histogram.toFixed(6)})`;
  }

  return {
    signal: signal === 'hold' ? 'hold' : signal,
    confidence: signal === 'hold' ? 0 : confidence,
    reason,
    indicatorValues: { macd: current.macd, signal: current.signal, histogram: current.histogram, prevHistogram: current.prevHistogram },
    suggestedEntry: price,
  };
}

/**
 * Fix #7 — Breakout now requires ≥1.5× average volume to avoid false breakouts.
 * Volume bonus is added to confidence when volume confirms strongly.
 */
function breakoutSignal(candles: OHLCV[], params: AlgoConfig['params'] = {}): SignalResult {
  const period = params.breakoutPeriod ?? 20;
  const channel = donchianChannel(candles.slice(0, -1), period);
  const current = candles[candles.length - 1];
  const atrVal = atr(candles);
  const atrPct = (atrVal / current.close) * 100;

  // Volume confirmation
  const avgVol = sma(candles.slice(0, -1).map(c => c.volume), period);
  const volRatio = current.volume / (avgVol || 1);
  const volumeConfirmed = volRatio >= 1.5;

  let signal: AlgoSignal = 'hold';
  let confidence = 0;
  let reason = '';

  if (current.close > channel.upper && volumeConfirmed) {
    signal = 'buy';
    const volBonus = Math.min((volRatio - 1.5) * 0.05, 0.10);
    confidence = Math.min(0.90, 0.55 + (current.close - channel.upper) / (atrVal || 1) * 0.1 + volBonus);
    reason = `Breakout above ${period}-bar high ${channel.upper.toFixed(4)} with ${volRatio.toFixed(1)}x volume (ATR: ${atrPct.toFixed(2)}%)`;
  } else if (current.close > channel.upper) {
    reason = `Price broke ${period}-bar high but volume only ${volRatio.toFixed(1)}x avg — skipping false breakout`;
  } else if (current.close < channel.lower && volumeConfirmed) {
    signal = 'sell';
    const volBonus = Math.min((volRatio - 1.5) * 0.05, 0.10);
    confidence = Math.min(0.90, 0.55 + (channel.lower - current.close) / (atrVal || 1) * 0.1 + volBonus);
    reason = `Breakdown below ${period}-bar low ${channel.lower.toFixed(4)} with ${volRatio.toFixed(1)}x volume (ATR: ${atrPct.toFixed(2)}%)`;
  } else if (current.close < channel.lower) {
    reason = `Price broke ${period}-bar low but volume only ${volRatio.toFixed(1)}x avg — skipping false breakdown`;
  } else {
    reason = `Price ${current.close.toFixed(4)} within channel [${channel.lower.toFixed(4)}–${channel.upper.toFixed(4)}]`;
  }

  return {
    signal, confidence, reason,
    indicatorValues: { channelUpper: channel.upper, channelLower: channel.lower, channelMid: channel.mid, atr: atrVal, volumeRatio: volRatio },
    suggestedEntry: current.close,
  };
}

function dualMASignal(candles: OHLCV[], params: AlgoConfig['params'] = {}): SignalResult {
  const fast = params.fastMA ?? 9;
  const slow = params.slowMA ?? 21;
  const closes = candles.map(c => c.close);

  const fastNow = ema(closes, fast);
  const slowNow = ema(closes, slow);
  const fastPrev = ema(closes.slice(0, -1), fast);
  const slowPrev = ema(closes.slice(0, -1), slow);

  const bullishCross = fastPrev <= slowPrev && fastNow > slowNow;
  const bearishCross = fastPrev >= slowPrev && fastNow < slowNow;
  const separation = Math.abs(fastNow - slowNow) / slowNow * 100;

  let signal: AlgoSignal = 'hold';
  let confidence = 0;
  let reason = '';

  if (bullishCross) {
    signal = 'buy';
    confidence = Math.min(0.82, 0.5 + separation / 5);
    reason = `EMA${fast} crossed above EMA${slow} (sep: ${separation.toFixed(3)}%)`;
  } else if (bearishCross) {
    signal = 'sell';
    confidence = Math.min(0.82, 0.5 + separation / 5);
    reason = `EMA${fast} crossed below EMA${slow} (sep: ${separation.toFixed(3)}%)`;
  } else {
    const trend = fastNow > slowNow ? 'uptrend' : 'downtrend';
    reason = `No crossover — ${trend} (EMA${fast}=${fastNow.toFixed(4)}, EMA${slow}=${slowNow.toFixed(4)})`;
  }

  return { signal, confidence, reason, indicatorValues: { fastEMA: fastNow, slowEMA: slowNow, separation }, suggestedEntry: closes[closes.length - 1] };
}

function scalpingSignal(candles: OHLCV[], params: AlgoConfig['params'] = {}): SignalResult {
  const closes = candles.map(c => c.close);
  const rsiVal = rsi(closes, 7);
  const fastEMAVal = ema(closes, 5);
  const slowEMAVal = ema(closes, 13);
  const atrVal = atr(candles, 7);
  const current = closes[closes.length - 1];
  const spread = (atrVal / current) * 100;

  let signal: AlgoSignal = 'hold';
  let confidence = 0;
  let reason = '';

  if (rsiVal < 35 && fastEMAVal > slowEMAVal && spread < 0.5) {
    signal = 'buy';
    // Dynamic confidence: deeper RSI + tighter spread = higher confidence
    const rsiStrength = (35 - rsiVal) / 35;
    const spreadBonus = Math.max(0, 1 - spread / 0.3);
    confidence = Math.min(0.80, 0.55 + rsiStrength * 0.15 + spreadBonus * 0.10);
    reason = `Scalp buy: RSI(7)=${rsiVal.toFixed(1)}, EMA5>EMA13, spread ${spread.toFixed(3)}%`;
  } else if (rsiVal > 65 && fastEMAVal < slowEMAVal && spread < 0.5) {
    signal = 'sell';
    const rsiStrength = (rsiVal - 65) / 35;
    const spreadBonus = Math.max(0, 1 - spread / 0.3);
    confidence = Math.min(0.80, 0.55 + rsiStrength * 0.15 + spreadBonus * 0.10);
    reason = `Scalp sell: RSI(7)=${rsiVal.toFixed(1)}, EMA5<EMA13, spread ${spread.toFixed(3)}%`;
  } else {
    reason = `Scalp conditions not met (RSI: ${rsiVal.toFixed(1)}, spread: ${spread.toFixed(3)}%)`;
  }

  return { signal, confidence, reason, indicatorValues: { rsi7: rsiVal, ema5: fastEMAVal, ema13: slowEMAVal, atr: atrVal, spread }, suggestedEntry: current };
}

/**
 * buy_the_dip — Bull-market RSI-pullback strategy.
 *
 * Requires a confirmed secular uptrend (price > EMA-200 AND EMA-50 > EMA-200).
 * Enters on shallow RSI dips (35–52) — healthy corrections within the trend.
 * Exits when RSI exceeds 78 (overbought) or price drops back below EMA-50.
 *
 * Rationale: In a bull market RSI rarely reaches 30. Trading the 35–52 dip
 * zone captures pullback entries without requiring the extreme oversold
 * readings that never arrive in trending conditions.
 */
function buyTheDipSignal(candles: OHLCV[], _params: AlgoConfig['params'] = {}): SignalResult {
  const closes = candles.map(c => c.close);
  const price  = closes[closes.length - 1];

  // Need at least 200 bars for EMA-200
  if (closes.length < 200) {
    return { signal: 'hold', confidence: 0, reason: 'Need ≥200 bars for EMA-200', indicatorValues: {} };
  }

  const ema200 = ema(closes, 200);
  const ema50  = ema(closes, 50);
  const ema21  = ema(closes, 21);
  const rsiVal = rsi(closes);

  // Regime gate: both EMAs must confirm uptrend
  const bullMarket = price > ema200 && ema50 > ema200;
  if (!bullMarket) {
    return {
      signal: 'hold', confidence: 0,
      reason: `Bearish regime (price ${price > ema200 ? '>' : '<'} EMA200, EMA50 ${ema50 > ema200 ? '>' : '<'} EMA200)`,
      indicatorValues: { rsi: rsiVal, ema200, ema50, ema21 },
    };
  }

  const trendStrength = (price - ema200) / ema200 * 100; // % above EMA-200

  // Dip entry: RSI pulled back into the 35–52 zone — a healthy correction
  if (rsiVal >= 35 && rsiVal <= 52) {
    const dipDepth  = 52 - rsiVal;                              // 0–17
    const trendBonus = Math.min(trendStrength, 30) / 30 * 0.15; // up to +0.15 for strong trend
    const confidence = Math.min(0.90, 0.55 + dipDepth * 0.013 + trendBonus);
    return {
      signal: 'buy', confidence,
      reason: `Bull dip: RSI ${rsiVal.toFixed(1)} pullback, ${trendStrength.toFixed(1)}% above EMA200 ($${ema200.toFixed(2)})`,
      indicatorValues: { rsi: rsiVal, ema200, ema50, ema21, trendStrength },
      suggestedEntry: price,
    };
  }

  // Exit signal: RSI overbought (>78) in bull market — take profits
  if (rsiVal > 78) {
    const excess = rsiVal - 78;
    const confidence = Math.min(0.85, 0.55 + excess * 0.015);
    return {
      signal: 'sell', confidence,
      reason: `Bull market overbought: RSI ${rsiVal.toFixed(1)} > 78, consider taking profits`,
      indicatorValues: { rsi: rsiVal, ema200, ema50, trendStrength },
    };
  }

  return {
    signal: 'hold', confidence: 0,
    reason: `RSI ${rsiVal.toFixed(1)} not in dip zone (35–52) | trend ${trendStrength.toFixed(1)}% above EMA200`,
    indicatorValues: { rsi: rsiVal, ema200, ema50, ema21, trendStrength },
  };
}

/**
 * trend_following — Multi-EMA alignment + near-EMA21 pullback entry.
 *
 * Fires buy signals whenever EMA-9 > EMA-21 > EMA-50 (all aligned up) AND
 * price has pulled back within 1.5% of EMA-21. This generates repeat entries
 * during a sustained bull trend rather than a single crossover event.
 *
 * Fires sell signals when EMA-9 crosses below EMA-21 (trend break).
 *
 * Rationale: dual_ma only fires once per trend phase. This strategy re-enters
 * on every qualified pullback so it stays active throughout a bull market.
 */
function trendFollowingSignal(candles: OHLCV[], params: AlgoConfig['params'] = {}): SignalResult {
  const fast = params.fastMA ?? 9;
  const slow = params.slowMA ?? 21;
  const closes = candles.map(c => c.close);
  const price  = closes[closes.length - 1];

  // emaWithPrev tracks the penultimate value in one pass, halving EMA compute vs slice+re-run
  const [prevEma9,  ema9 ] = emaWithPrev(closes, fast);
  const [prevEma21, ema21] = emaWithPrev(closes, slow);
  const ema50 = ema(closes, 50);

  // Full alignment: all three EMAs stacked bullishly
  const aligned      = ema9 > ema21 && ema21 > ema50;
  const wasAligned   = prevEma9 > prevEma21 && prevEma21 > ema50;

  // EMA-9 cross below EMA-21 → trend break → exit
  const bearishCross = prevEma9 >= prevEma21 && ema9 < ema21;
  if (bearishCross) {
    const separation = Math.abs(ema9 - ema21) / ema21 * 100;
    return {
      signal: 'sell',
      confidence: Math.min(0.82, 0.58 + separation / 5),
      reason: `Trend break: EMA${fast} crossed below EMA${slow}`,
      indicatorValues: { ema9, ema21, ema50 },
    };
  }

  if (!aligned) {
    return {
      signal: 'hold', confidence: 0,
      reason: `EMAs not aligned (EMA${fast}=${ema9.toFixed(2)}, EMA${slow}=${ema21.toFixed(2)}, EMA50=${ema50.toFixed(2)})`,
      indicatorValues: { ema9, ema21, ema50 },
    };
  }

  // Pullback entry: price within 1.5% of EMA-21 while all EMAs aligned
  const distFromEma21 = (price - ema21) / ema21 * 100;
  if (distFromEma21 >= -0.5 && distFromEma21 <= 1.5) {
    const separation = (ema21 - ema50) / ema50 * 100; // trend momentum
    const proximity  = 1.5 - Math.abs(distFromEma21);  // 0-1.5, closer = higher
    const confidence = Math.min(0.88, 0.58 + proximity * 0.08 + Math.min(separation, 5) / 5 * 0.10);
    const freshCross = !wasAligned && aligned;
    return {
      signal: 'buy', confidence,
      reason: `${freshCross ? 'Fresh' : 'Trend'} EMA alignment: price ${distFromEma21 >= 0 ? '+' : ''}${distFromEma21.toFixed(2)}% vs EMA${slow}, sep ${separation.toFixed(2)}%`,
      indicatorValues: { ema9, ema21, ema50, distFromEma21, separation },
      suggestedEntry: price,
    };
  }

  const sep = (ema9 - ema21) / ema21 * 100;
  return {
    signal: 'hold', confidence: 0,
    reason: `EMAs aligned but price ${distFromEma21 >= 0 ? '+' : ''}${distFromEma21.toFixed(2)}% from EMA${slow} (need −0.5% to +1.5%)`,
    indicatorValues: { ema9, ema21, ema50, distFromEma21, separation: sep },
  };
}

// ============================================================================
// ALGO TRADING ENGINE
// ============================================================================

export class AlgoTradingEngine {
  private manager: ExchangeManager;
  private status: EngineStatus;
  private kvCache?: KVNamespace;

  constructor(manager: ExchangeManager, config: AlgoConfig, kvCache?: KVNamespace) {
    this.manager = manager;
    this.kvCache = kvCache;
    this.status = {
      running: false,
      exchange: config.exchange,
      symbol: config.symbol,
      strategy: config.strategy,
      timeframe: config.timeframe,
      paperMode: config.paperMode,
      totalTrades: 0,
      profitableTrades: 0,
      totalPnl: 0,
    };
  }

  // ── Fix #10: OHLCV fetch with KV caching ──────────────────────────────────

  private async fetchCandles(config: AlgoConfig): Promise<OHLCV[]> {
    const cacheKey = `ohlcv:${config.exchange}:${config.symbol}:${config.timeframe}`;

    if (this.kvCache) {
      const cached = await this.kvCache.get(cacheKey);
      if (cached) return JSON.parse(cached) as OHLCV[];
    }

    const candles = await this.manager.getOHLCV(
      config.exchange, config.symbol, config.timeframe, 200
    );

    if (this.kvCache && candles.length > 0) {
      const kv  = this.kvCache;
      const ttl = timeframeToSeconds(config.timeframe);
      // Defer serialisation off the hot return path — JSON.stringify is sync
      // and would otherwise block the event loop on every cache miss
      queueMicrotask(() => {
        kv.put(cacheKey, JSON.stringify(candles), { expirationTtl: ttl }).catch(() => {});
      });
    }

    return candles;
  }

  // ── Signal computation ────────────────────────────────────────────────────

  private computeSignalFromCandles(candles: OHLCV[], config: AlgoConfig): SignalResult {
    if (candles.length < 50) {
      return { signal: 'hold', confidence: 0, reason: 'Insufficient candle data', indicatorValues: {} };
    }

    const p = config.params ?? {};

    switch (config.strategy) {
      case 'momentum':       return momentumSignal(candles, p);
      case 'rsi_reversion':  return rsiReversionSignal(candles, p);
      case 'macd_crossover': return macdCrossoverSignal(candles, p);
      case 'breakout':       return breakoutSignal(candles, p);
      case 'dual_ma':          return dualMASignal(candles, p);
      case 'scalping':         return scalpingSignal(candles, p);
      case 'buy_the_dip':      return buyTheDipSignal(candles, p);
      case 'trend_following':  return trendFollowingSignal(candles, p);
      default:                 return { signal: 'hold', confidence: 0, reason: 'Unknown strategy', indicatorValues: {} };
    }
  }

  /**
   * Public API: compute a signal without executing any order.
   * Callers that only need signals (e.g. the dashboard) use this.
   */
  async computeSignal(config: AlgoConfig): Promise<SignalResult> {
    const candles = await this.fetchCandles(config);
    return this.computeSignalFromCandles(candles, config);
  }

  // ── Full cycle: signal → size → execute ───────────────────────────────────

  async runCycle(config: AlgoConfig): Promise<AlgoTradeResult> {
    const timestamp = new Date().toISOString();

    // 1. Fetch candles (KV-cached) — shared with ATR computation below
    const candles = await this.fetchCandles(config);

    // 2. Compute signal
    const signalResult = this.computeSignalFromCandles(candles, config);
    this.status.lastSignal = signalResult.signal;
    this.status.lastRunAt = timestamp;

    // Fix #2: confidence threshold raised from 0.55 → 0.72
    if (signalResult.signal === 'hold' || signalResult.confidence < 0.72) {
      return {
        success: true,
        signal: signalResult.signal,
        confidence: signalResult.confidence,
        reason: signalResult.reason,
        paperTrade: config.paperMode,
        timestamp,
        indicators: signalResult.indicatorValues,
      };
    }

    // 3. Get best-available entry price
    const ticker = await this.manager.getTicker(config.exchange, config.symbol);
    const entryPrice = (signalResult.signal === 'buy' ? ticker.ask : ticker.bid) ?? ticker.last ?? 0;
    if (entryPrice === 0) {
      return {
        success: false,
        signal: 'hold',
        confidence: 0,
        reason: 'Could not fetch ticker price',
        timestamp,
        indicators: signalResult.indicatorValues,
      };
    }

    // Fix #4: ATR-based dynamic stop-loss / take-profit ─────────────────────
    const atrValue = atr(candles, 14);
    const atrPct = atrValue / entryPrice;
    // SL = max(configured minimum, 1.5× ATR)
    const dynamicSL = Math.max(config.stopLossPct, atrPct * 1.5);

    // Fix #12: minimum TP must cover round-trip fees + meaningful edge ───────
    const takerFeeRate = config.takerFeeRate ?? 0.001;
    const makerFeeRate = config.makerFeeRate ?? 0.0002;
    const isLimitOrder = !config.paperMode && MEAN_REVERSION_STRATEGIES.includes(config.strategy);
    const entryFee = isLimitOrder ? makerFeeRate : takerFeeRate;
    const exitFee = takerFeeRate; // exits are usually market
    const roundTripFee = entryFee + exitFee;
    // TP must be at least 2:1 R/R on dynamic SL AND cover fees + 0.2% edge
    const minProfitTP = roundTripFee + 0.002;
    const dynamicTP = Math.max(config.takeProfitPct, dynamicSL * 2.0, minProfitTP * 2);

    const stopLossPrice = signalResult.signal === 'buy'
      ? entryPrice * (1 - dynamicSL)
      : entryPrice * (1 + dynamicSL);

    const takeProfitPrice = signalResult.signal === 'buy'
      ? entryPrice * (1 + dynamicTP)
      : entryPrice * (1 - dynamicTP);

    // Fix #14: Kelly-fraction position sizing ────────────────────────────────
    // kellyFraction maps confidence [0.5, 1.0] → [0, 1]; capped at 25% of capital
    const kellyFraction = Math.max(0, (signalResult.confidence - 0.5) * 2);
    const positionUSDT = config.capitalUSDT * Math.min(kellyFraction, 0.25);
    const qty = positionUSDT > 0 ? parseFloat((positionUSDT / entryPrice).toFixed(6)) : 0;

    if (qty === 0) {
      return {
        success: false,
        signal: 'hold',
        confidence: signalResult.confidence,
        reason: 'Kelly sizing produced zero quantity',
        timestamp,
        indicators: signalResult.indicatorValues,
      };
    }

    // 4. Paper mode — simulate without real orders ───────────────────────────
    if (config.paperMode) {
      this.status.totalTrades++;
      return {
        success: true,
        signal: signalResult.signal,
        confidence: signalResult.confidence,
        reason: signalResult.reason,
        paperTrade: true,
        stopLossPrice,
        takeProfitPrice,
        orderResult: {
          success: true,
          orderId: `PAPER-${Date.now()}`,
          exchange: config.exchange,
          symbol: config.symbol,
          side: signalResult.signal as 'buy' | 'sell',
          type: 'market',
          status: 'filled',
          amount: qty,
          filled: qty,
          remaining: 0,
          price: entryPrice,
          averagePrice: entryPrice,
          cost: qty * entryPrice,
          fees: qty * entryPrice * takerFeeRate,
          feeCurrency: 'USDT',
          timestamp,
        },
        timestamp,
        indicators: signalResult.indicatorValues,
      };
    }

    // 5. Live execution ───────────────────────────────────────────────────────
    // Fix #11: mean-reversion strategies use limit orders (maker fees)
    const orderType = isLimitOrder ? 'limit' : 'market';
    const limitPrice = isLimitOrder
      ? (signalResult.signal === 'buy' ? ticker.bid : ticker.ask)
      : undefined;

    const orderParams: OrderParams = {
      exchange: config.exchange,
      symbol: config.symbol,
      side: signalResult.signal as 'buy' | 'sell',
      type: orderType as 'market' | 'limit',
      amount: qty,
      price: limitPrice,
      stopLossPrice,
      takeProfitPrice,
      timeInForce: isLimitOrder ? 'GTC' : undefined,
      clientOrderId: `TM8-${Date.now()}`,
    };

    const orderResult = await this.manager.placeOrder(orderParams);
    this.status.totalTrades++;

    return {
      success: orderResult.success,
      signal: signalResult.signal,
      confidence: signalResult.confidence,
      reason: signalResult.reason,
      orderResult,
      paperTrade: false,
      stopLossPrice,
      takeProfitPrice,
      timestamp,
      indicators: signalResult.indicatorValues,
    };
  }

  getStatus(): EngineStatus {
    return { ...this.status };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createAlgoEngine(
  manager: ExchangeManager,
  config: AlgoConfig,
  kvCache?: KVNamespace,
): AlgoTradingEngine {
  return new AlgoTradingEngine(manager, config, kvCache);
}
