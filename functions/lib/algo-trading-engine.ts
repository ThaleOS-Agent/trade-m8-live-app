/**
 * Algorithmic Trading Engine for Trade M8
 * Executes trading strategies via SDK-connected exchanges
 * Supports: Momentum, RSI Mean Reversion, MACD Crossover, Breakout, Scalping
 */

import { ExchangeManager, OrderParams, OrderResult, OHLCV, Ticker, createExchangeManager } from './sdk-exchange-connector';

// ============================================================================
// TYPES
// ============================================================================

export type StrategyName =
  | 'momentum'
  | 'rsi_reversion'
  | 'macd_crossover'
  | 'breakout'
  | 'scalping'
  | 'dual_ma';

export type AlgoSignal = 'buy' | 'sell' | 'hold';

export interface AlgoConfig {
  exchange: string;
  symbol: string;
  strategy: StrategyName;
  timeframe: string;        // '1m', '5m', '15m', '1h', '4h', '1d'
  capitalUSDT: number;      // USDT/USD to allocate per trade
  maxOpenTrades: number;
  stopLossPct: number;      // e.g. 0.02 = 2%
  takeProfitPct: number;    // e.g. 0.04 = 4%
  paperMode: boolean;
  // Strategy-specific params
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
  suggestedStopLoss?: number;
  suggestedTakeProfit?: number;
}

export interface AlgoTradeResult {
  success: boolean;
  signal: AlgoSignal;
  confidence: number;
  reason: string;
  orderResult?: OrderResult;
  stopLossOrder?: OrderResult;
  takeProfitOrder?: OrderResult;
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
// TECHNICAL INDICATORS
// ============================================================================

function sma(values: number[], period: number): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number {
  if (values.length < period) return sma(values, period);
  const k = 2 / (period + 1);
  let emaVal = sma(values.slice(0, period), period);
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(-period - 1).map((v, i, arr) => (i === 0 ? 0 : v - arr[i - 1])).slice(1);
  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? -c : 0));
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes: number[], fast = 12, slow = 26, signal = 9): { macd: number; signal: number; histogram: number } {
  const fastEMA = ema(closes, fast);
  const slowEMA = ema(closes, slow);
  const macdLine = fastEMA - slowEMA;

  // For signal we need a series of MACD values
  const macdSeries: number[] = [];
  for (let i = slow; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    macdSeries.push(ema(slice, fast) - ema(slice, slow));
  }
  const signalLine = ema(macdSeries, signal);
  return {
    macd: macdLine,
    signal: signalLine,
    histogram: macdLine - signalLine,
  };
}

function atr(candles: OHLCV[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs = candles.slice(-period - 1).map((c, i, arr) => {
    if (i === 0) return c.high - c.low;
    const prevClose = arr[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
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

  return {
    signal, confidence, reason,
    indicatorValues: { momentum: momentumPct, rsi: rsiVal, volumeRatio: volRatio },
    suggestedEntry: currentClose,
  };
}

function rsiReversionSignal(candles: OHLCV[], params: AlgoConfig['params'] = {}): SignalResult {
  const period = params.rsiPeriod ?? 14;
  const oversold = params.rsiOversold ?? 30;
  const overbought = params.rsiOverbought ?? 70;
  const closes = candles.map(c => c.close);
  const rsiVal = rsi(closes, period);
  const prevRsi = rsi(closes.slice(0, -1), period);
  const currentClose = closes[closes.length - 1];

  let signal: AlgoSignal = 'hold';
  let confidence = 0;
  let reason = '';

  if (rsiVal < oversold && prevRsi <= rsiVal) {
    // RSI was oversold and is now turning up
    signal = 'buy';
    confidence = Math.min(0.9, (oversold - rsiVal) / oversold + 0.4);
    reason = `RSI oversold reversal: ${rsiVal.toFixed(1)} crossing up from below ${oversold}`;
  } else if (rsiVal > overbought && prevRsi >= rsiVal) {
    signal = 'sell';
    confidence = Math.min(0.9, (rsiVal - overbought) / (100 - overbought) + 0.4);
    reason = `RSI overbought reversal: ${rsiVal.toFixed(1)} crossing down from above ${overbought}`;
  } else {
    reason = `RSI neutral at ${rsiVal.toFixed(1)} (oversold<${oversold}, overbought>${overbought})`;
  }

  return {
    signal, confidence, reason,
    indicatorValues: { rsi: rsiVal, prevRsi },
    suggestedEntry: currentClose,
  };
}

function macdCrossoverSignal(candles: OHLCV[], params: AlgoConfig['params'] = {}): SignalResult {
  const closes = candles.map(c => c.close);
  const fast = params.macdFast ?? 12;
  const slow = params.macdSlow ?? 26;
  const signalPeriod = params.macdSignal ?? 9;

  const current = macd(closes, fast, slow, signalPeriod);
  const prev = macd(closes.slice(0, -1), fast, slow, signalPeriod);

  let signal: AlgoSignal = 'hold';
  let confidence = 0;
  let reason = '';

  const bullishCross = prev.macd <= prev.signal && current.macd > current.signal;
  const bearishCross = prev.macd >= prev.signal && current.macd < current.signal;
  const strength = Math.abs(current.histogram);

  if (bullishCross) {
    signal = 'buy';
    confidence = Math.min(0.85, 0.5 + strength * 0.5);
    reason = `MACD bullish crossover — histogram: ${current.histogram.toFixed(4)}`;
  } else if (bearishCross) {
    signal = 'sell';
    confidence = Math.min(0.85, 0.5 + strength * 0.5);
    reason = `MACD bearish crossover — histogram: ${current.histogram.toFixed(4)}`;
  } else {
    reason = `No MACD crossover (hist: ${current.histogram.toFixed(4)})`;
  }

  return {
    signal, confidence, reason,
    indicatorValues: { macd: current.macd, signal: current.signal, histogram: current.histogram },
    suggestedEntry: closes[closes.length - 1],
  };
}

function breakoutSignal(candles: OHLCV[], params: AlgoConfig['params'] = {}): SignalResult {
  const period = params.breakoutPeriod ?? 20;
  const channel = donchianChannel(candles.slice(0, -1), period); // exclude current candle
  const current = candles[candles.length - 1];
  const atrVal = atr(candles);
  const atrPct = (atrVal / current.close) * 100;

  let signal: AlgoSignal = 'hold';
  let confidence = 0;
  let reason = '';

  if (current.close > channel.upper) {
    signal = 'buy';
    confidence = Math.min(0.88, 0.55 + (current.close - channel.upper) / (atrVal || 1) * 0.1);
    reason = `Breakout above ${period}-period high: ${channel.upper.toFixed(4)} → ${current.close.toFixed(4)} (ATR: ${atrPct.toFixed(2)}%)`;
  } else if (current.close < channel.lower) {
    signal = 'sell';
    confidence = Math.min(0.88, 0.55 + (channel.lower - current.close) / (atrVal || 1) * 0.1);
    reason = `Breakdown below ${period}-period low: ${channel.lower.toFixed(4)} → ${current.close.toFixed(4)} (ATR: ${atrPct.toFixed(2)}%)`;
  } else {
    reason = `Price ${current.close.toFixed(4)} within channel [${channel.lower.toFixed(4)} – ${channel.upper.toFixed(4)}]`;
  }

  return {
    signal, confidence, reason,
    indicatorValues: { channelUpper: channel.upper, channelLower: channel.lower, channelMid: channel.mid, atr: atrVal },
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

  let signal: AlgoSignal = 'hold';
  let confidence = 0;
  let reason = '';

  const separation = Math.abs(fastNow - slowNow) / slowNow * 100;

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

  return {
    signal, confidence, reason,
    indicatorValues: { fastEMA: fastNow, slowEMA: slowNow, separation },
    suggestedEntry: closes[closes.length - 1],
  };
}

function scalpingSignal(candles: OHLCV[], params: AlgoConfig['params'] = {}): SignalResult {
  const closes = candles.map(c => c.close);
  const rsiVal = rsi(closes, 7); // short-period RSI for scalping
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
    confidence = 0.65;
    reason = `Scalp buy: RSI(7)=${rsiVal.toFixed(1)}, EMA5>EMA13, spread ${spread.toFixed(3)}%`;
  } else if (rsiVal > 65 && fastEMAVal < slowEMAVal && spread < 0.5) {
    signal = 'sell';
    confidence = 0.65;
    reason = `Scalp sell: RSI(7)=${rsiVal.toFixed(1)}, EMA5<EMA13, spread ${spread.toFixed(3)}%`;
  } else {
    reason = `Scalp conditions not met (RSI: ${rsiVal.toFixed(1)}, spread: ${spread.toFixed(3)}%)`;
  }

  return {
    signal, confidence, reason,
    indicatorValues: { rsi7: rsiVal, ema5: fastEMAVal, ema13: slowEMAVal, atr: atrVal, spread },
    suggestedEntry: current,
  };
}

// ============================================================================
// ALGO TRADING ENGINE
// ============================================================================

export class AlgoTradingEngine {
  private manager: ExchangeManager;
  private status: EngineStatus;

  constructor(manager: ExchangeManager, config: AlgoConfig) {
    this.manager = manager;
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

  /**
   * Compute signal for a given strategy without placing any orders
   */
  async computeSignal(config: AlgoConfig): Promise<SignalResult> {
    const candles = await this.manager.ccxt.getOHLCV(
      config.exchange,
      config.symbol,
      config.timeframe,
      200
    );

    if (candles.length < 50) {
      return { signal: 'hold', confidence: 0, reason: 'Insufficient candle data', indicatorValues: {} };
    }

    const p = config.params ?? {};

    switch (config.strategy) {
      case 'momentum':      return momentumSignal(candles, p);
      case 'rsi_reversion': return rsiReversionSignal(candles, p);
      case 'macd_crossover':return macdCrossoverSignal(candles, p);
      case 'breakout':      return breakoutSignal(candles, p);
      case 'dual_ma':       return dualMASignal(candles, p);
      case 'scalping':      return scalpingSignal(candles, p);
      default:              return { signal: 'hold', confidence: 0, reason: 'Unknown strategy', indicatorValues: {} };
    }
  }

  /**
   * Run one full algo cycle: compute signal → validate → execute
   */
  async runCycle(config: AlgoConfig): Promise<AlgoTradeResult> {
    const timestamp = new Date().toISOString();

    // 1. Get signal
    const signalResult = await this.computeSignal(config);
    this.status.lastSignal = signalResult.signal;
    this.status.lastRunAt = timestamp;

    if (signalResult.signal === 'hold' || signalResult.confidence < 0.55) {
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

    // 2. Get current ticker for price reference
    const ticker = await this.manager.ccxt.getTicker(config.exchange, config.symbol);
    const entryPrice = signalResult.signal === 'buy' ? ticker.ask : ticker.bid;
    const qty = parseFloat((config.capitalUSDT / entryPrice).toFixed(6));

    const stopLossPrice = signalResult.signal === 'buy'
      ? entryPrice * (1 - config.stopLossPct)
      : entryPrice * (1 + config.stopLossPct);

    const takeProfitPrice = signalResult.signal === 'buy'
      ? entryPrice * (1 + config.takeProfitPct)
      : entryPrice * (1 - config.takeProfitPct);

    // 3. Paper mode — simulate without placing real orders
    if (config.paperMode) {
      this.status.totalTrades++;
      return {
        success: true,
        signal: signalResult.signal,
        confidence: signalResult.confidence,
        reason: signalResult.reason,
        paperTrade: true,
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
          fees: qty * entryPrice * 0.001,
          feeCurrency: 'USDT',
          timestamp,
        },
        timestamp,
        indicators: signalResult.indicatorValues,
      };
    }

    // 4. Live execution with bracket order
    const orderParams: OrderParams = {
      exchange: config.exchange,
      symbol: config.symbol,
      side: signalResult.signal as 'buy' | 'sell',
      type: 'market',
      amount: qty,
      stopLossPrice,
      takeProfitPrice,
      clientOrderId: `TM8-${Date.now()}`,
    };

    const bracketResult = await this.manager.ccxt.placeBracketOrder(orderParams);
    this.status.totalTrades++;

    return {
      success: bracketResult.entry.success,
      signal: signalResult.signal,
      confidence: signalResult.confidence,
      reason: signalResult.reason,
      orderResult: bracketResult.entry,
      stopLossOrder: bracketResult.stopLoss,
      takeProfitOrder: bracketResult.takeProfit,
      paperTrade: false,
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

export function createAlgoEngine(manager: ExchangeManager, config: AlgoConfig): AlgoTradingEngine {
  return new AlgoTradingEngine(manager, config);
}
