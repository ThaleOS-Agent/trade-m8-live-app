/**
 * FOREX & Commodity Connector for Cloudflare Workers
 * Uses fetch + WebCrypto (no Node.js dependencies)
 * Supports: OANDA v20, Exness Open API, Alpha Vantage, Finnhub
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ForexCredentials {
  // OANDA
  OANDA_API_KEY?: string;
  OANDA_ACCOUNT_ID?: string;
  OANDA_PRACTICE?: string; // 'true' = practice, default = live

  // Exness
  EXNESS_API_KEY?: string;
  EXNESS_ACCOUNT_LOGIN?: string;

  // Market data
  ALPHA_VANTAGE_API_KEY?: string;
  FINNHUB_API_KEY?: string;
}

export interface ForexQuote {
  symbol: string;       // e.g. EUR_USD
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  timestamp: string;
  source: string;
}

export interface ForexOHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ForexOrder {
  symbol: string;            // e.g. EUR_USD
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop';
  units: number;             // positive = buy, negative = sell (OANDA convention internally)
  price?: number;            // for limit/stop orders
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
}

export interface ForexOrderResult {
  success: boolean;
  orderId?: string;
  tradeId?: string;
  symbol?: string;
  side?: string;
  units?: number;
  price?: number;
  status?: string;
  error?: string;
}

export interface ForexPosition {
  symbol: string;
  units: number;             // positive = long, negative = short
  side: 'long' | 'short';
  averagePrice: number;
  unrealisedPnl: number;
  marginUsed?: number;
  exchange: string;
}

export interface ForexInstrument {
  symbol: string;            // API symbol, e.g. EUR_USD
  displayName: string;       // Human-readable, e.g. EUR/USD
  type: 'forex' | 'commodity' | 'index' | 'crypto';
  pipSize: number;
  marginRate?: number;
  exchange: string;
}

// ─── OANDA v20 REST Connector ─────────────────────────────────────────────────

const OANDA_LIVE_URL = 'https://api-fxtrade.oanda.com';
const OANDA_PRACTICE_URL = 'https://api-fxpractice.oanda.com';

export class OANDAConnector {
  private baseUrl: string;
  private apiKey: string;
  private accountId: string;

  constructor(apiKey: string, accountId: string, practice = false) {
    this.apiKey = apiKey;
    this.accountId = accountId;
    this.baseUrl = practice ? OANDA_PRACTICE_URL : OANDA_LIVE_URL;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Accept-Datetime-Format': 'RFC3339',
    };
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OANDA GET ${path} failed [${res.status}]: ${text}`);
    }
    return res.json();
  }

  private async post(path: string, body: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OANDA POST ${path} failed [${res.status}]: ${text}`);
    }
    return res.json();
  }

  private async del(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ timeInForce: 'FOK', units: '0' }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OANDA DEL ${path} failed [${res.status}]: ${text}`);
    }
    return res.json();
  }

  async getInstruments(): Promise<ForexInstrument[]> {
    const data = await this.get(`/v3/accounts/${this.accountId}/instruments`);
    return (data.instruments || []).map((inst: any) => ({
      symbol: inst.name,
      displayName: inst.displayName,
      type: inst.type === 'CURRENCY' ? 'forex' : inst.type === 'METAL' ? 'commodity' : inst.type === 'CFD' ? 'index' : 'forex',
      pipSize: parseFloat(inst.pipLocation ? Math.pow(10, inst.pipLocation).toString() : '0.0001'),
      marginRate: parseFloat(inst.marginRate || '0.02'),
      exchange: 'oanda',
    }));
  }

  async getQuote(symbol: string): Promise<ForexQuote> {
    const data = await this.get(`/v3/accounts/${this.accountId}/pricing?instruments=${symbol}`);
    const price = data.prices?.[0];
    if (!price) throw new Error(`No quote for ${symbol}`);
    const bid = parseFloat(price.bids?.[0]?.price || '0');
    const ask = parseFloat(price.asks?.[0]?.price || '0');
    return {
      symbol,
      bid,
      ask,
      mid: (bid + ask) / 2,
      spread: ask - bid,
      timestamp: price.time || new Date().toISOString(),
      source: 'oanda',
    };
  }

  async getCandles(symbol: string, granularity = 'H1', count = 200): Promise<ForexOHLCV[]> {
    const data = await this.get(
      `/v3/instruments/${symbol}/candles?granularity=${granularity}&count=${count}&price=M`
    );
    return (data.candles || []).map((c: any) => ({
      timestamp: new Date(c.time).getTime(),
      open: parseFloat(c.mid?.o || '0'),
      high: parseFloat(c.mid?.h || '0'),
      low: parseFloat(c.mid?.l || '0'),
      close: parseFloat(c.mid?.c || '0'),
      volume: c.volume || 0,
    }));
  }

  async placeOrder(order: ForexOrder): Promise<ForexOrderResult> {
    const units = order.side === 'buy' ? order.units : -order.units;

    const orderBody: any = {
      order: {
        type: order.type.toUpperCase(),
        instrument: order.symbol,
        units: String(units),
        timeInForce: order.type === 'market' ? 'FOK' : 'GTC',
      }
    };

    if (order.type === 'limit' || order.type === 'stop') {
      orderBody.order.price = String(order.price);
    }

    if (order.stopLoss) {
      orderBody.order.stopLossOnFill = { price: String(order.stopLoss) };
    }
    if (order.takeProfit) {
      orderBody.order.takeProfitOnFill = { price: String(order.takeProfit) };
    }
    if (order.trailingStop) {
      orderBody.order.trailingStopLossOnFill = { distance: String(order.trailingStop) };
    }

    const data = await this.post(`/v3/accounts/${this.accountId}/orders`, orderBody);

    const filled = data.orderFillTransaction;
    const created = data.orderCreateTransaction;
    const rejected = data.orderRejectTransaction;

    if (rejected) {
      return { success: false, error: rejected.rejectReason || 'Order rejected' };
    }

    if (filled) {
      return {
        success: true,
        orderId: filled.orderID,
        tradeId: filled.tradeOpened?.tradeID,
        symbol: order.symbol,
        side: order.side,
        units: Math.abs(units),
        price: parseFloat(filled.price || '0'),
        status: 'filled',
      };
    }

    if (created) {
      return {
        success: true,
        orderId: created.id,
        symbol: order.symbol,
        side: order.side,
        units: Math.abs(units),
        status: 'pending',
      };
    }

    return { success: false, error: 'Unknown order response' };
  }

  async getPositions(): Promise<ForexPosition[]> {
    const data = await this.get(`/v3/accounts/${this.accountId}/openPositions`);
    const positions: ForexPosition[] = [];
    for (const p of data.positions || []) {
      const longUnits = parseFloat(p.long?.units || '0');
      const shortUnits = parseFloat(p.short?.units || '0');
      if (longUnits !== 0) {
        positions.push({
          symbol: p.instrument,
          units: longUnits,
          side: 'long',
          averagePrice: parseFloat(p.long?.averagePrice || '0'),
          unrealisedPnl: parseFloat(p.long?.unrealizedPL || '0'),
          exchange: 'oanda',
        });
      }
      if (shortUnits !== 0) {
        positions.push({
          symbol: p.instrument,
          units: Math.abs(shortUnits),
          side: 'short',
          averagePrice: parseFloat(p.short?.averagePrice || '0'),
          unrealisedPnl: parseFloat(p.short?.unrealizedPL || '0'),
          exchange: 'oanda',
        });
      }
    }
    return positions;
  }

  async closePosition(symbol: string, side?: 'long' | 'short'): Promise<any> {
    const body = side === 'long'
      ? { longUnits: 'ALL' }
      : side === 'short'
      ? { shortUnits: 'ALL' }
      : { longUnits: 'ALL', shortUnits: 'ALL' };

    const data = await this.post(`/v3/accounts/${this.accountId}/positions/${symbol}/close`, body);
    return data;
  }

  async getAccountSummary(): Promise<any> {
    const data = await this.get(`/v3/accounts/${this.accountId}/summary`);
    return data.account;
  }
}

// ─── Exness REST API Connector ────────────────────────────────────────────────
// Exness Open API: https://open-api.exness.com/

export class ExnessConnector {
  private apiKey: string;
  private accountLogin: string;
  private baseUrl = 'https://open-api.exness.com';

  constructor(apiKey: string, accountLogin: string) {
    this.apiKey = apiKey;
    this.accountLogin = accountLogin;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Exness GET ${path} failed [${res.status}]: ${text}`);
    }
    return res.json();
  }

  private async post(path: string, body: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Exness POST ${path} failed [${res.status}]: ${text}`);
    }
    return res.json();
  }

  async getAccountInfo(): Promise<any> {
    return this.get(`/v1/mt/accounts/${this.accountLogin}`);
  }

  async getPositions(): Promise<ForexPosition[]> {
    const data = await this.get(`/v1/mt/accounts/${this.accountLogin}/positions`);
    return (data.positions || []).map((p: any) => ({
      symbol: p.symbol,
      units: Math.abs(parseFloat(p.volume || '0')),
      side: p.type === 'POSITION_TYPE_BUY' ? 'long' : 'short',
      averagePrice: parseFloat(p.priceOpen || '0'),
      unrealisedPnl: parseFloat(p.profit || '0'),
      exchange: 'exness',
    }));
  }

  async placeOrder(order: ForexOrder): Promise<ForexOrderResult> {
    const body = {
      account_id: this.accountLogin,
      symbol: order.symbol.replace('/', ''),  // EUR/USD → EURUSD
      action: order.side === 'buy' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
      volume: order.units,
      type: order.type === 'market' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_BUY_LIMIT',
      price: order.price,
      sl: order.stopLoss,
      tp: order.takeProfit,
    };

    const data = await this.post('/v1/mt/orders', body);
    return {
      success: data.order_id != null,
      orderId: String(data.order_id || ''),
      symbol: order.symbol,
      side: order.side,
      units: order.units,
      status: 'placed',
    };
  }

  async closePosition(positionId: string): Promise<any> {
    return this.post(`/v1/mt/positions/${positionId}/close`, {});
  }

  async getBalance(): Promise<{ balance: number; equity: number; margin: number; freeMargin: number }> {
    const info = await this.getAccountInfo();
    return {
      balance: parseFloat(info.balance || '0'),
      equity: parseFloat(info.equity || '0'),
      margin: parseFloat(info.margin || '0'),
      freeMargin: parseFloat(info.freeMargin || info.free_margin || '0'),
    };
  }
}

// ─── Alpha Vantage Forex Data ─────────────────────────────────────────────────

export class AlphaVantageForex {
  private apiKey: string;
  private baseUrl = 'https://www.alphavantage.co/query';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getExchangeRate(fromCurrency: string, toCurrency: string): Promise<ForexQuote | null> {
    const url = `${this.baseUrl}?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromCurrency}&to_currency=${toCurrency}&apikey=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    const rate = data['Realtime Currency Exchange Rate'];
    if (!rate) return null;
    const mid = parseFloat(rate['5. Exchange Rate']);
    return {
      symbol: `${fromCurrency}_${toCurrency}`,
      bid: mid * 0.9999,
      ask: mid * 1.0001,
      mid,
      spread: mid * 0.0002,
      timestamp: rate['6. Last Refreshed'],
      source: 'alpha_vantage',
    };
  }

  async getForexIntraday(fromSymbol: string, toSymbol: string, interval = '60min'): Promise<ForexOHLCV[]> {
    const url = `${this.baseUrl}?function=FX_INTRADAY&from_symbol=${fromSymbol}&to_symbol=${toSymbol}&interval=${interval}&outputsize=compact&apikey=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: any = await res.json();
    const seriesKey = `Time Series FX (${interval})`;
    const series = data[seriesKey];
    if (!series) return [];

    return Object.entries(series).map(([time, candle]: [string, any]) => ({
      timestamp: new Date(time).getTime(),
      open: parseFloat(candle['1. open']),
      high: parseFloat(candle['2. high']),
      low: parseFloat(candle['3. low']),
      close: parseFloat(candle['4. close']),
      volume: 0,
    })).sort((a, b) => a.timestamp - b.timestamp);
  }

  async getForexDaily(fromSymbol: string, toSymbol: string): Promise<ForexOHLCV[]> {
    const url = `${this.baseUrl}?function=FX_DAILY&from_symbol=${fromSymbol}&to_symbol=${toSymbol}&outputsize=compact&apikey=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: any = await res.json();
    const series = data['Time Series FX (Daily)'];
    if (!series) return [];

    return Object.entries(series).map(([time, candle]: [string, any]) => ({
      timestamp: new Date(time).getTime(),
      open: parseFloat(candle['1. open']),
      high: parseFloat(candle['2. high']),
      low: parseFloat(candle['3. low']),
      close: parseFloat(candle['4. close']),
      volume: 0,
    })).sort((a, b) => a.timestamp - b.timestamp);
  }
}

// ─── Finnhub Forex Data ───────────────────────────────────────────────────────

export class FinnhubForex {
  private apiKey: string;
  private baseUrl = 'https://finnhub.io/api/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getQuote(symbol: string): Promise<ForexQuote | null> {
    // Finnhub forex symbol format: OANDA:EUR_USD
    const finnhubSymbol = symbol.includes(':') ? symbol : `OANDA:${symbol.replace('/', '_')}`;
    const url = `${this.baseUrl}/quote?symbol=${finnhubSymbol}&token=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    if (!data.c) return null;
    return {
      symbol,
      bid: data.c * 0.9999,
      ask: data.c * 1.0001,
      mid: data.c,
      spread: data.c * 0.0002,
      timestamp: new Date(data.t * 1000).toISOString(),
      source: 'finnhub',
    };
  }

  async getForexSymbols(exchange = 'oanda'): Promise<ForexInstrument[]> {
    const url = `${this.baseUrl}/forex/symbol?exchange=${exchange}&token=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data || []).map((sym: any) => ({
      symbol: sym.symbol,
      displayName: sym.description || sym.symbol,
      type: 'forex' as const,
      pipSize: 0.0001,
      exchange: 'finnhub',
    }));
  }

  async getCandles(symbol: string, resolution = '60', from?: number, to?: number): Promise<ForexOHLCV[]> {
    const now = Math.floor(Date.now() / 1000);
    const finnhubSymbol = symbol.includes(':') ? symbol : `OANDA:${symbol.replace('/', '_')}`;
    const f = from || now - 86400 * 7;
    const t = to || now;
    const url = `${this.baseUrl}/forex/candle?symbol=${finnhubSymbol}&resolution=${resolution}&from=${f}&to=${t}&token=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: any = await res.json();
    if (data.s !== 'ok' || !data.t) return [];

    return data.t.map((ts: number, i: number) => ({
      timestamp: ts * 1000,
      open: data.o[i],
      high: data.h[i],
      low: data.l[i],
      close: data.c[i],
      volume: data.v?.[i] || 0,
    }));
  }
}

// ─── Forex Manager (unified interface) ───────────────────────────────────────

export class ForexManager {
  private oanda?: OANDAConnector;
  private exness?: ExnessConnector;
  private alphaVantage?: AlphaVantageForex;
  private finnhub?: FinnhubForex;

  constructor(creds: ForexCredentials) {
    if (creds.OANDA_API_KEY && creds.OANDA_ACCOUNT_ID) {
      const practice = creds.OANDA_PRACTICE === 'true';
      this.oanda = new OANDAConnector(creds.OANDA_API_KEY, creds.OANDA_ACCOUNT_ID, practice);
    }
    if (creds.EXNESS_API_KEY && creds.EXNESS_ACCOUNT_LOGIN) {
      this.exness = new ExnessConnector(creds.EXNESS_API_KEY, creds.EXNESS_ACCOUNT_LOGIN);
    }
    if (creds.ALPHA_VANTAGE_API_KEY) {
      this.alphaVantage = new AlphaVantageForex(creds.ALPHA_VANTAGE_API_KEY);
    }
    if (creds.FINNHUB_API_KEY) {
      this.finnhub = new FinnhubForex(creds.FINNHUB_API_KEY);
    }
  }

  getConnectedBrokers(): string[] {
    const brokers: string[] = [];
    if (this.oanda) brokers.push('oanda');
    if (this.exness) brokers.push('exness');
    if (this.alphaVantage) brokers.push('alpha_vantage');
    if (this.finnhub) brokers.push('finnhub');
    return brokers;
  }

  async getQuote(symbol: string, broker?: string): Promise<ForexQuote> {
    // Normalise: EUR/USD → EUR_USD for OANDA/Finnhub
    const oandaSymbol = symbol.replace('/', '_');
    const [from, to] = symbol.split('/');

    // If specific broker requested, try only that one (with fallback on failure)
    // If no broker specified, cascade through all available providers
    const tryOanda = !broker || broker === 'oanda';
    const tryFinnhub = !broker || broker === 'finnhub';
    const tryAlpha = !broker || broker === 'alpha_vantage';

    if (tryOanda && this.oanda) {
      try { return await this.oanda.getQuote(oandaSymbol); } catch {}
    }
    if (tryFinnhub && this.finnhub) {
      try {
        const q = await this.finnhub.getQuote(symbol);
        if (q) return q;
      } catch {}
    }
    if (tryAlpha && this.alphaVantage && from && to) {
      try {
        const q = await this.alphaVantage.getExchangeRate(from, to);
        if (q) return q;
      } catch {}
    }
    throw new Error(`No quote available for ${symbol} — all configured brokers failed`);
  }

  async getCandles(symbol: string, timeframe = 'H1', count = 200, broker?: string): Promise<ForexOHLCV[]> {
    const oandaSymbol = symbol.replace('/', '_');
    const [from, to] = symbol.split('/');

    const tryOanda = !broker || broker === 'oanda';
    const tryFinnhub = !broker || broker === 'finnhub';
    const tryAlpha = !broker || broker === 'alpha_vantage';

    if (tryOanda && this.oanda) {
      try { return await this.oanda.getCandles(oandaSymbol, timeframe, count); } catch {}
    }
    if (tryFinnhub && this.finnhub) {
      try {
        const resMap: Record<string, string> = { M1: '1', M5: '5', M15: '15', M30: '30', H1: '60', H4: '240', D: 'D', W: 'W' };
        const candles = await this.finnhub.getCandles(symbol, resMap[timeframe] || '60');
        if (candles.length > 0) return candles;
      } catch {}
    }
    if (tryAlpha && this.alphaVantage && from && to) {
      try {
        if (timeframe === 'D') return this.alphaVantage.getForexDaily(from, to);
        const avInterval: Record<string, string> = { M1: '1min', M5: '5min', M15: '15min', M30: '30min', H1: '60min' };
        const candles = await this.alphaVantage.getForexIntraday(from, to, avInterval[timeframe] || '60min');
        if (candles.length > 0) return candles;
      } catch {}
    }
    return [];
  }

  async placeOrder(broker: string, order: ForexOrder): Promise<ForexOrderResult> {
    if (broker === 'oanda') {
      if (!this.oanda) throw new Error('OANDA not configured');
      const oandaOrder = { ...order, symbol: order.symbol.replace('/', '_') };
      return this.oanda.placeOrder(oandaOrder);
    }
    if (broker === 'exness') {
      if (!this.exness) throw new Error('Exness not configured');
      return this.exness.placeOrder(order);
    }
    throw new Error(`Unknown forex broker: ${broker}`);
  }

  async getPositions(broker?: string): Promise<ForexPosition[]> {
    const all: ForexPosition[] = [];
    if (!broker || broker === 'oanda') {
      if (this.oanda) {
        try { all.push(...await this.oanda.getPositions()); } catch {}
      }
    }
    if (!broker || broker === 'exness') {
      if (this.exness) {
        try { all.push(...await this.exness.getPositions()); } catch {}
      }
    }
    return all;
  }

  async closePosition(broker: string, symbol: string, side?: 'long' | 'short'): Promise<any> {
    if (broker === 'oanda') {
      if (!this.oanda) throw new Error('OANDA not configured');
      return this.oanda.closePosition(symbol.replace('/', '_'), side);
    }
    if (broker === 'exness') {
      if (!this.exness) throw new Error('Exness not configured');
      return this.exness.closePosition(symbol);
    }
    throw new Error(`Unknown forex broker: ${broker}`);
  }

  async getInstruments(broker?: string): Promise<ForexInstrument[]> {
    if (broker === 'oanda' || (!broker && this.oanda)) {
      if (this.oanda) {
        try { return this.oanda.getInstruments(); } catch {}
      }
    }
    if (broker === 'finnhub' || (!broker && this.finnhub)) {
      if (this.finnhub) {
        try { return this.finnhub.getForexSymbols(); } catch {}
      }
    }
    // Fallback: return static instrument list
    return getStaticInstruments();
  }

  async getAccountInfo(broker: string): Promise<any> {
    if (broker === 'oanda') {
      if (!this.oanda) throw new Error('OANDA not configured');
      return this.oanda.getAccountSummary();
    }
    if (broker === 'exness') {
      if (!this.exness) throw new Error('Exness not configured');
      return this.exness.getBalance();
    }
    throw new Error(`Unknown forex broker: ${broker}`);
  }
}

// ─── Static instrument list (fallback) ────────────────────────────────────────

export function getStaticInstruments(): ForexInstrument[] {
  return [
    // Forex Majors
    { symbol: 'EUR_USD', displayName: 'EUR/USD', type: 'forex', pipSize: 0.0001, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'GBP_USD', displayName: 'GBP/USD', type: 'forex', pipSize: 0.0001, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'USD_JPY', displayName: 'USD/JPY', type: 'forex', pipSize: 0.01, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'USD_CHF', displayName: 'USD/CHF', type: 'forex', pipSize: 0.0001, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'AUD_USD', displayName: 'AUD/USD', type: 'forex', pipSize: 0.0001, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'USD_CAD', displayName: 'USD/CAD', type: 'forex', pipSize: 0.0001, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'NZD_USD', displayName: 'NZD/USD', type: 'forex', pipSize: 0.0001, marginRate: 0.02, exchange: 'forex' },
    // Forex Minors
    { symbol: 'EUR_GBP', displayName: 'EUR/GBP', type: 'forex', pipSize: 0.0001, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'EUR_JPY', displayName: 'EUR/JPY', type: 'forex', pipSize: 0.01, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'GBP_JPY', displayName: 'GBP/JPY', type: 'forex', pipSize: 0.01, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'EUR_AUD', displayName: 'EUR/AUD', type: 'forex', pipSize: 0.0001, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'AUD_JPY', displayName: 'AUD/JPY', type: 'forex', pipSize: 0.01, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'EUR_CAD', displayName: 'EUR/CAD', type: 'forex', pipSize: 0.0001, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'EUR_NZD', displayName: 'EUR/NZD', type: 'forex', pipSize: 0.0001, marginRate: 0.02, exchange: 'forex' },
    { symbol: 'GBP_AUD', displayName: 'GBP/AUD', type: 'forex', pipSize: 0.0001, marginRate: 0.02, exchange: 'forex' },
    // Exotic pairs
    { symbol: 'USD_SGD', displayName: 'USD/SGD', type: 'forex', pipSize: 0.0001, marginRate: 0.03, exchange: 'forex' },
    { symbol: 'USD_HKD', displayName: 'USD/HKD', type: 'forex', pipSize: 0.0001, marginRate: 0.03, exchange: 'forex' },
    { symbol: 'USD_MXN', displayName: 'USD/MXN', type: 'forex', pipSize: 0.0001, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'USD_ZAR', displayName: 'USD/ZAR', type: 'forex', pipSize: 0.0001, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'USD_TRY', displayName: 'USD/TRY', type: 'forex', pipSize: 0.0001, marginRate: 0.05, exchange: 'forex' },
    // Precious Metals
    { symbol: 'XAU_USD', displayName: 'Gold (XAU/USD)', type: 'commodity', pipSize: 0.01, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'XAG_USD', displayName: 'Silver (XAG/USD)', type: 'commodity', pipSize: 0.001, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'XPT_USD', displayName: 'Platinum (XPT/USD)', type: 'commodity', pipSize: 0.01, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'XPD_USD', displayName: 'Palladium (XPD/USD)', type: 'commodity', pipSize: 0.01, marginRate: 0.05, exchange: 'forex' },
    // Energy CFDs (via OANDA)
    { symbol: 'WTICO_USD', displayName: 'WTI Crude Oil', type: 'commodity', pipSize: 0.01, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'BCO_USD', displayName: 'Brent Crude Oil', type: 'commodity', pipSize: 0.01, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'NATGAS_USD', displayName: 'Natural Gas', type: 'commodity', pipSize: 0.001, marginRate: 0.05, exchange: 'forex' },
    // Index CFDs (via OANDA)
    { symbol: 'US30_USD', displayName: 'US30 (Dow Jones)', type: 'index', pipSize: 1, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'SPX500_USD', displayName: 'S&P 500 (SPX500)', type: 'index', pipSize: 0.1, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'NAS100_USD', displayName: 'NASDAQ 100 (NAS100)', type: 'index', pipSize: 0.1, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'UK100_GBP', displayName: 'FTSE 100 (UK100)', type: 'index', pipSize: 0.1, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'DE30_EUR', displayName: 'DAX 40 (GER40)', type: 'index', pipSize: 0.1, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'JP225_USD', displayName: 'Nikkei 225 (JP225)', type: 'index', pipSize: 1, marginRate: 0.05, exchange: 'forex' },
    { symbol: 'AU200_AUD', displayName: 'ASX 200 (AU200)', type: 'index', pipSize: 0.1, marginRate: 0.05, exchange: 'forex' },
  ];
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createForexManager(creds: ForexCredentials): ForexManager {
  return new ForexManager(creds);
}
