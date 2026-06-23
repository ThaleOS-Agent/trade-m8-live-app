/**
 * Trade M8 — Backtest Suite: Bull Market + Metals/Oil
 *
 * Data sources:
 *   CoinGecko market_chart  → BTC, ETH  (crypto close prices + volume)
 *   Yahoo Finance v8 API    → GC=F (Gold), SI=F (Silver), CL=F (Oil WTI)
 *                              Real OHLCV with actual high/low → ATR works
 *
 * Strategies tested:
 *   Bear-resistant:  rsi_reversion, macd_crossover, dual_ma, breakout (with trend filters)
 *   Bull-market:     buy_the_dip (EMA-200 regime gate), trend_following (multi-EMA alignment)
 *   Universal:       momentum, scalping
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ema as engineEMA,
  rsi as engineRSI,
} from '../functions/lib/algo-trading-engine';
import {
  ExchangeManager,
  type OHLCV,
  type Ticker,
  type OrderParams,
  type OrderResult,
} from '../functions/lib/sdk-exchange-connector';
import {
  createAlgoEngine,
  type AlgoConfig,
  type AlgoTradeResult,
  type StrategyName,
} from '../functions/lib/algo-trading-engine';

// ─── Data fetchers ────────────────────────────────────────────────────────────

const CG_KEY  = process.env.COINGECKO_API_KEY || 'CG-NFEggBc1sJ8ggZuf4UgRndqN';
const CG_BASE = 'https://api.coingecko.com/api/v3';

interface Bar {
  timestamp: number;
  open: number; high: number; low: number; close: number; volume: number;
}

async function fetchCoinGecko(coinId: string, days = 365): Promise<Bar[]> {
  const headers = { 'x-cg-demo-api-key': CG_KEY };
  process.stdout.write(`   ↓  CoinGecko ${coinId} (${days}d)… `);
  const res = await fetch(
    `${CG_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
    { headers }
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json() as { prices: number[][]; total_volumes: number[][] };
  const volMap = new Map(data.total_volumes.map(([ts,v]) => [Math.floor(ts/86400000), v]));
  const bars = data.prices.map(([ts, p]) => ({
    timestamp: ts, open: p, high: p, low: p, close: p,
    volume: volMap.get(Math.floor(ts/86400000)) ?? 0,
  }));
  console.log(`✓ ${bars.length} bars`);
  await sleep(700);
  return bars;
}

async function fetchYahoo(ticker: string, label: string, days = 365): Promise<Bar[]> {
  // Yahoo Finance v8 — no API key required; real OHLCV with high/low
  const range = days <= 30 ? '1mo' : days <= 90 ? '3mo' : days <= 180 ? '6mo' : '1y';
  const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d&includePrePost=false`;
  process.stdout.write(`   ↓  Yahoo ${label} (${ticker}, ${range})… `);

  let res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    // Try query2 as fallback
    res = await fetch(url.replace('query1', 'query2'), { headers: { 'User-Agent': 'Mozilla/5.0' } });
  }
  if (!res.ok) throw new Error(`Yahoo Finance ${res.status} for ${ticker}`);

  const data  = await res.json() as any;
  const result = data?.chart?.result?.[0];
  if (!result) {
    const err = data?.chart?.error?.description ?? 'no data';
    throw new Error(`Yahoo Finance: ${err}`);
  }

  const timestamps: number[] = result.timestamp;
  const q = result.indicators.quote[0];
  const bars: Bar[] = timestamps
    .map((ts, i): Bar => ({
      timestamp: ts * 1000,
      open:   q.open[i]   ?? q.close[i],
      high:   q.high[i]   ?? q.close[i],
      low:    q.low[i]    ?? q.close[i],
      close:  q.close[i]  ?? 0,
      volume: q.volume[i] ?? 0,
    }))
    .filter(b => b.close > 0 && b.high > 0);

  const price = result.meta?.regularMarketPrice;
  const hi52  = result.meta?.fiftyTwoWeekHigh;
  const lo52  = result.meta?.fiftyTwoWeekLow;
  console.log(`✓ ${bars.length} bars  price=$${price?.toLocaleString('en-US',{maximumFractionDigits:2})}  52w [$${lo52?.toLocaleString()}–$${hi52?.toLocaleString()}]`);
  await sleep(300);
  return bars;
}

// ─── BacktestManager (same as before) ────────────────────────────────────────

class BacktestManager extends ExchangeManager {
  private bars: OHLCV[];
  private cursor = 0;
  private readonly loadedSymbol: string;
  constructor(bars: Bar[], symbol: string) {
    super({});
    this.bars = bars.map(b=>({...b}));
    this.loadedSymbol = symbol;
  }
  setCursor(i: number) { this.cursor = i; }
  override async getOHLCV(_e:string, requestedSymbol:string, _t:string, limit:number): Promise<OHLCV[]> {
    if (requestedSymbol !== this.loadedSymbol) {
      console.warn(`[BacktestManager] symbol mismatch: requested ${requestedSymbol} but loaded ${this.loadedSymbol}`);
    }
    return this.bars.slice(Math.max(0,this.cursor-limit),this.cursor);
  }
  override async getTicker(_e:string,symbol:string): Promise<Ticker> {
    const b = this.bars[this.cursor-1] ?? this.bars[this.bars.length-1];
    return { symbol, last:b.close, bid:b.close*0.9999, ask:b.close*1.0001,
      high24h:b.high, low24h:b.low, volume24h:b.volume, timestamp:b.timestamp };
  }
  override async placeOrder(_p:OrderParams): Promise<OrderResult> {
    return { success:true, orderId:`PAPER-${Date.now()}`, status:'filled' };
  }
}

// ─── Regime detector ─────────────────────────────────────────────────────────

interface Regime { label: string; bull: boolean; ema50: number; ema200: number; rsi14: number; price: number }

function detectRegime(bars: Bar[]): Regime {
  if (bars.length < 50) return { label:'INSUFFICIENT DATA', bull:false, ema50:0, ema200:0, rsi14:50, price:0 };
  const closes = bars.map(b=>b.close);
  const price  = closes[closes.length-1];
  const e50    = calcEMA(closes, 50);
  const e200   = closes.length >= 200 ? calcEMA(closes, 200) : null;
  const r14    = calcWilderRSI(closes, 14);

  let label: string;
  const bull = price > e50 && (e200 === null || e50 > e200);
  if (e200 !== null) {
    if (price > e200 && e50 > e200)      label = 'STRONG BULL ▲▲';
    else if (price > e200)               label = 'BULL ▲';
    else if (price < e200 && e50 < e200) label = 'BEAR ▼▼';
    else                                 label = 'BEAR ▼';
  } else {
    label = price > e50 ? 'BULL ▲ (no EMA200)' : 'BEAR ▼ (no EMA200)';
  }

  return { label, bull, ema50: e50, ema200: e200 ?? 0, rsi14: r14, price };
}

// Use the engine's own exported functions — keeps regime detection in sync
// with the indicator values the engine actually uses when gating trades
const calcEMA = engineEMA;
const calcWilderRSI = engineRSI;

// ─── Core backtest (same loop as before, with ATR-based SL from engine) ───────

interface ClosedTrade {
  entryDate:string; exitDate:string; entryPrice:number; exitPrice:number;
  quantity:number; pnl:number; pnlPct:number;
  exitReason:'signal'|'stop_loss'|'take_profit'|'end_of_test'; holdDays:number;
}

interface RunResult {
  label:string; symbol:string; strategy:StrategyName; asset:string;
  totalTrades:number; wins:number; losses:number; winRate:number;
  totalReturn:number; totalReturnPct:number; finalCapital:number;
  sharpe:number; maxDrawdown:number; profitFactor:number;
  avgWin:number; avgLoss:number; avgHoldDays:number;
  trades:ClosedTrade[];
  roi:ROISummary;
}

interface DailyStat { date:string; roi:number; equity:number }
interface ROISummary {
  avgDaily:number; medianDaily:number; stdDev:number;
  profitableDays:number; totalDays:number; profitablePct:number;
  annualised:number; best:DailyStat; worst:DailyStat;
  winStreak:number; lossStreak:number;
  monthly:Array<{month:string;roi:number}>;
}

async function runBacktest(
  bars: Bar[], symbol: string, asset: string,
  strategy: StrategyName, label: string,
  initialCapital: number, warmup: number
): Promise<RunResult> {
  const mgr = new BacktestManager(bars, symbol);
  const FEE  = 0.001;

  const cfg: AlgoConfig = {
    exchange:'backtest', symbol, strategy, timeframe:'1d',
    capitalUSDT: initialCapital * 0.5,
    maxOpenTrades: 1, stopLossPct: 0.05, takeProfitPct: 0.10,
    paperMode: true, takerFeeRate: FEE, makerFeeRate: 0.0002,
    // Bull-market friendly params
    params: strategy === 'rsi_reversion'
      ? { rsiOversold: 40, rsiOverbought: 60 }          // looser thresholds for bull regime
      : strategy === 'breakout'
      ? { breakoutPeriod: 20 }
      : strategy === 'momentum'
      ? { momentumPeriod: 10 }
      : {},
  };

  const engine = createAlgoEngine(mgr, cfg);
  let capital = initialCapital;
  interface Pos { entryPrice:number; entryDate:string; entryBar:number; qty:number; sl:number; tp:number; cost:number }
  let pos: Pos | null = null;
  const trades: ClosedTrade[] = [];
  const curve: Array<{date:string;equity:number}> = [];
  let peak = capital, maxDD = 0;

  for (let i = warmup; i < bars.length; i++) {
    const bar  = bars[i];
    const date = new Date(bar.timestamp).toISOString().slice(0,10);

    if (pos) {
      if (bar.close <= pos.sl) {
        const pnl = (pos.sl - pos.entryPrice)*pos.qty - pos.sl*pos.qty*FEE;
        capital += pos.cost + pnl;
        trades.push({ entryDate:pos.entryDate, exitDate:date, entryPrice:pos.entryPrice,
          exitPrice:pos.sl, quantity:pos.qty, pnl, pnlPct:pnl/pos.cost*100,
          exitReason:'stop_loss', holdDays:i-pos.entryBar });
        pos = null;
      } else if (bar.close >= pos.tp) {
        const pnl = (pos.tp - pos.entryPrice)*pos.qty - pos.tp*pos.qty*FEE;
        capital += pos.cost + pnl;
        trades.push({ entryDate:pos.entryDate, exitDate:date, entryPrice:pos.entryPrice,
          exitPrice:pos.tp, quantity:pos.qty, pnl, pnlPct:pnl/pos.cost*100,
          exitReason:'take_profit', holdDays:i-pos.entryBar });
        pos = null;
      }
    }

    mgr.setCursor(i+1);
    let result: AlgoTradeResult;
    try { result = await engine.runCycle(cfg); }
    catch { continue; }

    if (result.signal === 'buy' && !pos) {
      const entry = result.orderResult?.price ?? bar.close;
      const qty   = result.orderResult?.amount ?? 0;
      if (qty <= 0 || entry <= 0) continue;
      const cost = qty * entry;
      if (cost + cost*FEE > capital) continue;
      capital -= (cost + cost*FEE);
      pos = {
        entryPrice: entry, entryDate: date, entryBar: i, qty, cost,
        sl: result.stopLossPrice  ?? entry * 0.95,
        tp: result.takeProfitPrice ?? entry * 1.10,
      };
    } else if (result.signal === 'sell' && pos) {
      const exit = bar.close;
      const pnl  = (exit - pos.entryPrice)*pos.qty - exit*pos.qty*FEE;
      capital += pos.cost + pnl;
      trades.push({ entryDate:pos.entryDate, exitDate:date, entryPrice:pos.entryPrice,
        exitPrice:exit, quantity:pos.qty, pnl, pnlPct:pnl/pos.cost*100,
        exitReason:'signal', holdDays:i-pos.entryBar });
      pos = null;
    }

    const unr = pos ? (bar.close - pos.entryPrice)*pos.qty : 0;
    const eq  = capital + (pos ? pos.cost : 0) + unr;
    curve.push({ date, equity: eq });
    peak   = Math.max(peak, eq);
    maxDD  = Math.max(maxDD, (peak - eq)/peak);
  }

  if (pos) {
    const last = bars[bars.length-1];
    const ld   = new Date(last.timestamp).toISOString().slice(0,10);
    const pnl  = (last.close - pos.entryPrice)*pos.qty - last.close*pos.qty*FEE;
    capital += pos.cost + pnl;
    trades.push({ entryDate:pos.entryDate, exitDate:ld, entryPrice:pos.entryPrice,
      exitPrice:last.close, quantity:pos.qty, pnl, pnlPct:pnl/pos.cost*100,
      exitReason:'end_of_test', holdDays:bars.length-1-pos.entryBar });
  }

  const wins  = trades.filter(t=>t.pnl>0);
  const losses= trades.filter(t=>t.pnl<=0);
  const gw    = wins.reduce((s,t)=>s+t.pnl,0);
  const gl    = losses.reduce((s,t)=>s+Math.abs(t.pnl),0);
  const daily = buildDailyROI(curve);
  const roi   = calcROI(daily, curve);

  return {
    label, symbol, asset, strategy,
    totalTrades: trades.length, wins:wins.length, losses:losses.length,
    winRate: trades.length ? wins.length/trades.length*100 : 0,
    totalReturn: capital-initialCapital,
    totalReturnPct: (capital-initialCapital)/initialCapital*100,
    finalCapital: capital,
    sharpe: calcSharpe(daily),
    maxDrawdown: maxDD,
    profitFactor: gl>0 ? gw/gl : gw>0 ? Infinity : 0,
    avgWin: wins.length ? gw/wins.length : 0,
    avgLoss: losses.length ? gl/losses.length : 0,
    avgHoldDays: trades.length ? trades.reduce((s,t)=>s+t.holdDays,0)/trades.length : 0,
    trades, roi,
  };
}

// ─── ROI helpers ──────────────────────────────────────────────────────────────

function buildDailyROI(curve: Array<{date:string;equity:number}>): DailyStat[] {
  return curve.slice(1).map((pt,i)=>({
    date: pt.date,
    roi:  curve[i].equity>0 ? (pt.equity-curve[i].equity)/curve[i].equity*100 : 0,
    equity: pt.equity,
  }));
}

function calcROI(daily: DailyStat[], curve: Array<{date:string;equity:number}>): ROISummary {
  const z: DailyStat = {date:'',roi:0,equity:0};
  if (!daily.length) return { avgDaily:0,medianDaily:0,stdDev:0,profitableDays:0,totalDays:0,profitablePct:0,annualised:0,best:z,worst:z,winStreak:0,lossStreak:0,monthly:[] };
  const rois   = daily.map(d=>d.roi);
  const avg    = rois.reduce((s,r)=>s+r,0)/rois.length;
  const sorted = [...rois].sort((a,b)=>a-b);
  const med    = sorted[Math.floor(sorted.length/2)];
  const std    = Math.sqrt(rois.reduce((s,r)=>s+(r-avg)**2,0)/rois.length);
  const prof   = daily.filter(d=>d.roi>0);
  const best   = daily.reduce((b,d)=>d.roi>b.roi?d:b);
  const worst  = daily.reduce((w,d)=>d.roi<w.roi?d:w);
  let ws=0,mw=0,ls=0,ml=0;
  for (const d of daily) {
    if(d.roi>0){ws++;ls=0;mw=Math.max(mw,ws);}
    else if(d.roi<0){ls++;ws=0;ml=Math.max(ml,ls);}
    else{ws=0;ls=0;}
  }
  const first=curve[0].equity, last=curve[curve.length-1].equity;
  const years=daily.length/365;
  const ann=years>0?((last/first)**(1/years)-1)*100:0;
  const mm=new Map<string,{s:number;e:number}>();
  for(const pt of curve){const m=pt.date.slice(0,7);if(!mm.has(m))mm.set(m,{s:pt.equity,e:pt.equity});mm.get(m)!.e=pt.equity;}
  const monthly=[...mm.entries()].map(([month,{s,e}])=>({month,roi:s>0?(e-s)/s*100:0}));
  return {avgDaily:avg,medianDaily:med,stdDev:std,profitableDays:prof.length,totalDays:daily.length,profitablePct:prof.length/daily.length*100,annualised:ann,best,worst,winStreak:mw,lossStreak:ml,monthly};
}

function calcSharpe(daily: DailyStat[]): number {
  if(daily.length<2)return 0;
  const r=daily.map(d=>d.roi),avg=r.reduce((s,v)=>s+v,0)/r.length;
  const std=Math.sqrt(r.reduce((s,v)=>s+(v-avg)**2,0)/r.length);
  return std===0?0:(avg/std)*Math.sqrt(252);
}

// ─── Display ──────────────────────────────────────────────────────────────────

function displayResult(r: RunResult, showTrades = true) {
  const s = (n: number) => n>=0?'+':'';
  const col= (n: number, str: string) => n>=0?`\x1b[32m${str}\x1b[0m`:`\x1b[31m${str}\x1b[0m`;
  console.log(`\n📊 ${r.label}  [${r.asset}]`);
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`   Trades: ${r.totalTrades}  Wins: ${r.wins} (${r.winRate.toFixed(1)}%)  Losses: ${r.losses}  Avg Hold: ${r.avgHoldDays.toFixed(0)}d`);
  console.log(`   Total Return:    ${col(r.totalReturn,`${s(r.totalReturnPct)}${r.totalReturnPct.toFixed(2)}%  ($${s(r.totalReturn)}${r.totalReturn.toFixed(2)}`)}`);
  console.log(`   Final Capital:   $${r.finalCapital.toFixed(2)}`);
  console.log(`   Sharpe:          ${r.sharpe.toFixed(3)}   Max DD: ${(r.maxDrawdown*100).toFixed(2)}%   Profit Factor: ${isFinite(r.profitFactor)?r.profitFactor.toFixed(2):'∞'}`);
  console.log(`   Avg Win/Loss:    $${r.avgWin.toFixed(2)} / $${r.avgLoss.toFixed(2)}`);
  console.log('');
  console.log(`   Avg Daily ROI:   ${col(r.roi.avgDaily,`${s(r.roi.avgDaily)}${r.roi.avgDaily.toFixed(4)}%`)}`);
  console.log(`   Annualised ROI:  ${col(r.roi.annualised,`${s(r.roi.annualised)}${r.roi.annualised.toFixed(2)}%`)}`);
  console.log(`   Profitable Days: ${r.roi.profitableDays}/${r.roi.totalDays} (${r.roi.profitablePct.toFixed(1)}%)`);
  console.log(`   Best/Worst Day:  ${s(r.roi.best.roi)}${r.roi.best.roi.toFixed(3)}% (${r.roi.best.date}) / ${r.roi.worst.roi.toFixed(3)}% (${r.roi.worst.date})`);
  console.log(`   W/L Streak:      ${r.roi.winStreak}d / ${r.roi.lossStreak}d`);
  console.log('\n   Monthly P&L:');
  for (const m of r.roi.monthly) {
    const bar = '█'.repeat(Math.min(Math.round(Math.abs(m.roi)*1.5),25));
    const c   = m.roi>=0?'\x1b[32m':'\x1b[31m';
    console.log(`   ${m.month}   ${s(m.roi)}${m.roi.toFixed(2).padStart(7)}%  ${c}${bar}\x1b[0m`);
  }
  if (showTrades && r.trades.length > 0) {
    console.log(`\n   Last ${Math.min(r.trades.length,6)} trades:`);
    for (const t of r.trades.slice(-6)) {
      const ic = t.pnl>0?'\x1b[32m▲\x1b[0m':'\x1b[31m▼\x1b[0m';
      console.log(`   ${ic}  ${t.entryDate}→${t.exitDate}  ${t.holdDays}d  $${t.entryPrice.toFixed(2)}→$${t.exitPrice.toFixed(2)}  P&L ${t.pnl>=0?'+':''}$${t.pnl.toFixed(2)} (${t.pnlPct>=0?'+':''}${t.pnlPct.toFixed(2)}%)  [${t.exitReason}]`);
    }
  }
  console.log('─────────────────────────────────────────────────────────────');
}

function displayComparison(results: RunResult[]) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 Full Comparison — All Strategies × All Assets');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('Asset    Strategy            | Win%  | Return%  | Sharpe | MaxDD  | AvgDay%  | Ann.%  | Trades');
  console.log('─────────────────────────────|───────|──────────|────────|───────|──────────|--------|-──────');
  const sorted=[...results].sort((a,b)=>b.totalReturnPct-a.totalReturnPct);
  for(const r of sorted){
    const s=(n:number)=>n>=0?'+':'';
    const a=r.asset.slice(0,8).padEnd(8);
    const st=r.strategy.padEnd(19);
    const wr=`${r.winRate.toFixed(1)}%`.padEnd(5);
    const ret=`${s(r.totalReturnPct)}${r.totalReturnPct.toFixed(2)}%`.padEnd(8);
    const sh=r.sharpe.toFixed(2).padEnd(6);
    const dd=`${(r.maxDrawdown*100).toFixed(2)}%`.padEnd(5);
    const ad=`${s(r.roi.avgDaily)}${r.roi.avgDaily.toFixed(4)}%`.padEnd(8);
    const an=`${s(r.roi.annualised)}${r.roi.annualised.toFixed(2)}%`.padEnd(6);
    const col=r.totalReturnPct>0?'\x1b[32m':r.totalReturnPct<0?'\x1b[31m':'';
    console.log(`${a} ${st} | ${wr} | ${col}${ret}\x1b[0m | ${sh} | ${dd} | ${ad} | ${an} | ${r.totalTrades}`);
  }
  console.log('─────────────────────────────|───────|──────────|────────|───────|──────────|--------|-──────');
  const best=sorted[0];
  console.log(`\n🏆 Best: [${best.asset}] ${best.strategy}  ${best.totalReturnPct>=0?'+':''}${best.totalReturnPct.toFixed(2)}%  |  avg daily ROI ${best.roi.avgDaily>=0?'+':''}${best.roi.avgDaily.toFixed(4)}%`);
}

async function displayLiveSignals(assetBars: Record<string, { bars: Bar[]; label: string }>) {
  const strategies: StrategyName[] = ['buy_the_dip','trend_following','momentum','rsi_reversion','macd_crossover','breakout','dual_ma','scalping'];

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📡 Live Paper Trading Signals — Current Market');
  console.log('═══════════════════════════════════════════════════════════════');

  for (const [sym, {bars, label}] of Object.entries(assetBars)) {
    const regime = detectRegime(bars);
    const price  = bars[bars.length-1].close;
    const regCol = regime.label.includes('BULL') ? '\x1b[32m' : '\x1b[31m';
    console.log(`\n  ${label} (${sym})  $${price.toLocaleString('en-US',{maximumFractionDigits:2})}  regime: ${regCol}${regime.label}\x1b[0m  RSI14=${regime.rsi14.toFixed(1)}  EMA50=$${regime.ema50.toFixed(2)}`);

    const mgr = new BacktestManager(bars, sym);
    mgr.setCursor(bars.length);

    for (const strategy of strategies) {
      const cfg: AlgoConfig = {
        exchange:'backtest', symbol:sym, strategy, timeframe:'1d',
        capitalUSDT:5000, maxOpenTrades:1, stopLossPct:0.05, takeProfitPct:0.10,
        paperMode:true, takerFeeRate:0.001,
        params: strategy==='rsi_reversion' ? {rsiOversold:40,rsiOverbought:60} : {},
      };
      const engine = createAlgoEngine(mgr, cfg);
      const sig = await engine.computeSignal(cfg);
      const arrow = sig.signal==='buy' ? '\x1b[32m▲ BUY \x1b[0m'
                  : sig.signal==='sell'? '\x1b[31m▼ SELL\x1b[0m'
                  : '\x1b[33m─ HOLD\x1b[0m';
      const conf = sig.confidence>0 ? ` conf=${(sig.confidence*100).toFixed(1)}%` : '';
      const fires = sig.confidence>=0.72 ? '\x1b[32m ✅ FIRES\x1b[0m'
                  : sig.confidence>0     ? '\x1b[33m ⚠ below 0.72\x1b[0m' : '';
      console.log(`    ${strategy.padEnd(18)} ${arrow}${conf}${fires}  ${sig.reason.slice(0,80)}`);
    }
  }
}

function saveResults(results: RunResult[]) {
  const dir = path.join(process.cwd(),'backtest-results');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(dir,`backtest-${ts}.json`), JSON.stringify(results.map(r=>({...r})),null,2));
  const csv=['Label,Asset,Strategy,Trades,Win%,Return%,Sharpe,MaxDD%,AvgDailyROI%,AnnROI%,ProfDays%,FinalCapital'];
  for(const r of results) csv.push([r.label,r.asset,r.strategy,r.totalTrades,r.winRate.toFixed(2),r.totalReturnPct.toFixed(2),r.sharpe.toFixed(3),(r.maxDrawdown*100).toFixed(2),r.roi.avgDaily.toFixed(4),r.roi.annualised.toFixed(2),r.roi.profitablePct.toFixed(1),r.finalCapital.toFixed(2)].join(','));
  fs.writeFileSync(path.join(dir,'latest-results.csv'),csv.join('\n'));
  fs.writeFileSync(path.join(dir,'latest-summary.json'),JSON.stringify(results.map(r=>({label:r.label,asset:r.asset,strategy:r.strategy,winRate:r.winRate,return:r.totalReturnPct,sharpe:r.sharpe,maxDD:r.maxDrawdown,trades:r.totalTrades,avgDailyROI:r.roi.avgDaily,annROI:r.roi.annualised})),null,2));
  for(const r of results){
    const slug=`${r.asset.replace(/[^a-z0-9]/gi,'_')}_${r.strategy}`.toLowerCase();
    fs.writeFileSync(path.join(dir,`daily-roi-${slug}.csv`),['Date,ROI%,Equity',...r.roi.monthly.map(m=>`${m.month},${m.roi.toFixed(4)},0`)].join('\n'));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runBacktests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 Trade M8 — Bull Market + Metals/Oil Backtest Suite');
  console.log('   New strategies: buy_the_dip · trend_following');
  console.log('   Real OHLCV via Yahoo Finance: Gold · Silver · WTI Oil');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('── Fetching market data ──────────────────────────────────────');
  const [goldBars, silverBars, oilBars, btcBars, ethBars] = await Promise.all([
    fetchYahoo('GC=F',  'Gold (GC=F)',        365),
    fetchYahoo('SI=F',  'Silver (SI=F)',       365),
    fetchYahoo('CL=F',  'WTI Oil (CL=F)',      365),
    fetchCoinGecko('bitcoin',  365),
    fetchCoinGecko('ethereum', 365),
  ]);

  // ── Regime overview ──────────────────────────────────────────────────────────
  console.log('\n── Market Regime Detection ──────────────────────────────────');
  const assets: Array<{ sym: string; label: string; bars: Bar[] }> = [
    { sym:'XAU/USD', label:'Gold',    bars: goldBars   },
    { sym:'XAG/USD', label:'Silver',  bars: silverBars },
    { sym:'WTI/USD', label:'WTI Oil', bars: oilBars    },
    { sym:'BTC/USD', label:'Bitcoin', bars: btcBars    },
    { sym:'ETH/USD', label:'Ethereum',bars: ethBars    },
  ];
  for (const {sym, label, bars} of assets) {
    const r = detectRegime(bars);
    const c = r.label.includes('BULL')?'\x1b[32m':'\x1b[31m';
    console.log(`   ${label.padEnd(9)} ${sym.padEnd(9)} price=$${r.price.toLocaleString('en-US',{maximumFractionDigits:2}).padStart(10)}  ${c}${r.label.padEnd(18)}\x1b[0m  RSI=${r.rsi14.toFixed(1).padStart(5)}  EMA50=$${r.ema50.toFixed(2)}`);
  }

  // ── Build test matrix ────────────────────────────────────────────────────────
  type TestCase = { sym:string; label:string; bars:Bar[]; strategy:StrategyName; warmup:number };
  const BULL_STRATEGIES: StrategyName[] = ['buy_the_dip','trend_following','momentum'];
  const ALL_STRATEGIES:  StrategyName[] = ['buy_the_dip','trend_following','momentum','rsi_reversion','breakout','dual_ma'];

  const tests: TestCase[] = [
    // Gold — the boom asset, test all strategies
    ...ALL_STRATEGIES.map(s => ({ sym:'XAU/USD', label:`Gold ${s}`, bars:goldBars, strategy:s, warmup: s==='buy_the_dip'?200:60 })),
    // Silver
    ...BULL_STRATEGIES.map(s => ({ sym:'XAG/USD', label:`Silver ${s}`, bars:silverBars, strategy:s, warmup: s==='buy_the_dip'?200:60 })),
    // WTI Oil
    ...BULL_STRATEGIES.map(s => ({ sym:'WTI/USD', label:`Oil ${s}`, bars:oilBars, strategy:s, warmup: s==='buy_the_dip'?200:60 })),
    // BTC + ETH — check if bull strategies improve on the -5% bear-market results
    ...BULL_STRATEGIES.map(s => ({ sym:'BTC/USD', label:`BTC ${s}`, bars:btcBars, strategy:s, warmup: s==='buy_the_dip'?200:60 })),
    ...BULL_STRATEGIES.map(s => ({ sym:'ETH/USD', label:`ETH ${s}`, bars:ethBars, strategy:s, warmup: s==='buy_the_dip'?200:60 })),
  ];

  // ── Run all backtests ────────────────────────────────────────────────────────
  console.log(`\n── Running ${tests.length} strategy × asset combinations ──────────────`);
  const results: RunResult[] = [];

  for (const t of tests) {
    process.stdout.write(`   ${t.label.padEnd(28)} … `);
    const r = await runBacktest(t.bars, t.sym, t.label.split(' ')[0], t.strategy, t.label, 10_000, t.warmup);
    const s = (n: number) => n>=0?'+':'';
    const c = r.totalReturnPct>0?'\x1b[32m':r.totalReturnPct<0?'\x1b[31m':'';
    console.log(`${c}${s(r.totalReturnPct)}${r.totalReturnPct.toFixed(2)}%\x1b[0m  (${r.totalTrades} trades, win ${r.winRate.toFixed(0)}%)`);
    results.push(r);
  }

  // ── Detailed display for Gold ─────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🥇 Gold (XAU/USD) — Detailed Strategy Results');
  console.log('═══════════════════════════════════════════════════════════════');
  const goldResults = results.filter(r=>r.asset==='Gold');
  for (const r of goldResults.sort((a,b)=>b.totalReturnPct-a.totalReturnPct)) {
    displayResult(r, true);
  }

  // ── Comparison across all assets ──────────────────────────────────────────
  displayComparison(results);

  // ── Live signals ──────────────────────────────────────────────────────────
  await displayLiveSignals({
    'XAU/USD': { bars: goldBars,   label: 'Gold'    },
    'XAG/USD': { bars: silverBars, label: 'Silver'  },
    'CL/USD':  { bars: oilBars,    label: 'WTI Oil' },
    'BTC/USD': { bars: btcBars,    label: 'Bitcoin' },
    'ETH/USD': { bars: ethBars,    label: 'Ethereum'},
  });

  saveResults(results);
  console.log('\n\n✅ Done — results saved to ./backtest-results/');
}

function sleep(ms: number) { return new Promise(r=>setTimeout(r,ms)); }

if (require.main === module) {
  runBacktests().catch(err=>{ console.error('Fatal:',err); process.exit(1); });
}
export { runBacktests };
