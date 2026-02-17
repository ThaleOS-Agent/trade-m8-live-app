/**
 * Exchange Connector for Cloudflare Workers
 * Uses fetch + WebCrypto (no Node.js dependencies)
 * Supports: Binance, Kraken, Bybit, KuCoin, Alpaca
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface Ticker {
  symbol: string;
  last: number;
  bid?: number;
  ask?: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  timestamp: number;
}

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  unrealisedPnl?: number;
  exchange: string;
}

export interface OrderParams {
  exchange: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop_market' | 'stop_limit';
  amount: number;
  price?: number;
  stopPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  timeInForce?: string;
  clientOrderId?: string;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  symbol?: string;
  side?: string;
  type?: string;
  amount?: number;
  price?: number;
  averagePrice?: number;
  status?: string;
  timestamp?: string;
  error?: string;
}

// ─── HMAC Helpers (WebCrypto — available in CF Workers) ──────────────────────

async function hmacSHA256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSHA256Base64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function toQueryString(params: Record<string, any>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// ─── Binance ─────────────────────────────────────────────────────────────────

class BinanceConnector {
  private apiKey: string;
  private secret: string;
  private base = 'https://api.binance.com';

  constructor(apiKey: string, secret: string) {
    this.apiKey = apiKey;
    this.secret = secret;
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const sym = symbol.replace('/', '');
    const data: any = await fetch(`${this.base}/api/v3/ticker/24hr?symbol=${sym}`).then(r => r.json());
    return {
      symbol,
      last: parseFloat(data.lastPrice),
      bid: parseFloat(data.bidPrice),
      ask: parseFloat(data.askPrice),
      high24h: parseFloat(data.highPrice),
      low24h: parseFloat(data.lowPrice),
      volume24h: parseFloat(data.volume),
      timestamp: Date.now(),
    };
  }

  async getOHLCV(symbol: string, interval = '1h', limit = 100): Promise<OHLCV[]> {
    const sym = symbol.replace('/', '');
    const data: any[] = await fetch(`${this.base}/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`).then(r => r.json());
    return data.map(c => ({
      timestamp: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const ts = Date.now();
    const qs = `timestamp=${ts}`;
    const sig = await hmacSHA256(this.secret, qs);
    const res = await fetch(`${this.base}/api/v3/account?${qs}&signature=${sig}`, {
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });
    const data: any = await res.json();
    if (data.code) throw new Error(`Binance: ${data.msg}`);
    return (data.balances ?? [])
      .map((b: any) => ({
        asset: b.asset,
        free: parseFloat(b.free),
        locked: parseFloat(b.locked),
        total: parseFloat(b.free) + parseFloat(b.locked),
      }))
      .filter((b: Balance) => b.total > 0);
  }

  async placeOrder(p: OrderParams): Promise<OrderResult> {
    const sym = p.symbol.replace('/', '');
    const params: Record<string, any> = {
      symbol: sym,
      side: p.side.toUpperCase(),
      type: p.type.toUpperCase().replace('-', '_'),
      quantity: p.amount,
      timestamp: Date.now(),
    };
    if (p.price) params.price = p.price;
    if (p.stopPrice) params.stopPrice = p.stopPrice;
    if (p.timeInForce) params.timeInForce = p.timeInForce;
    if (p.type === 'limit' && !p.timeInForce) params.timeInForce = 'GTC';
    if (p.clientOrderId) params.newClientOrderId = p.clientOrderId;

    const qs = toQueryString(params);
    const sig = await hmacSHA256(this.secret, qs);
    const res = await fetch(`${this.base}/api/v3/order?${qs}&signature=${sig}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });
    const data: any = await res.json();
    if (data.code) return { success: false, error: data.msg };
    return {
      success: true,
      orderId: String(data.orderId),
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: parseFloat(data.origQty),
      price: data.price ? parseFloat(data.price) : undefined,
      averagePrice: data.cummulativeQuoteQty && data.origQty
        ? parseFloat(data.cummulativeQuoteQty) / parseFloat(data.origQty)
        : undefined,
      status: data.status?.toLowerCase(),
      timestamp: new Date().toISOString(),
    };
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const sym = symbol.replace('/', '');
    const qs = toQueryString({ symbol: sym, orderId, timestamp: Date.now() });
    const sig = await hmacSHA256(this.secret, qs);
    const res = await fetch(`${this.base}/api/v3/order?${qs}&signature=${sig}`, {
      method: 'DELETE',
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });
    const data: any = await res.json();
    return !data.code;
  }
}

// ─── Kraken ──────────────────────────────────────────────────────────────────

class KrakenConnector {
  private apiKey: string;
  private privateKey: string;
  private base = 'https://api.kraken.com';

  constructor(apiKey: string, privateKey: string) {
    this.apiKey = apiKey;
    this.privateKey = privateKey;
  }

  private async privateRequest(path: string, params: Record<string, any> = {}): Promise<any> {
    const nonce = Date.now() * 1000;
    const body = new URLSearchParams({ ...params, nonce: String(nonce) }).toString();

    // Kraken: sha256(nonce + body), then hmac-sha512(path + hash, base64-decoded private key)
    const enc = new TextEncoder();
    const sha256Hash = await crypto.subtle.digest('SHA-256', enc.encode(String(nonce) + body));
    const pathBytes = enc.encode(path);
    const message = new Uint8Array(pathBytes.length + sha256Hash.byteLength);
    message.set(pathBytes, 0);
    message.set(new Uint8Array(sha256Hash), pathBytes.length);

    const keyBytes = Uint8Array.from(atob(this.privateKey), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, message);
    const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        'API-Key': this.apiKey,
        'API-Sign': sigBase64,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    return res.json();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const pair = symbol.replace('/', '').replace('BTC', 'XBT');
    const data: any = await fetch(`${this.base}/0/public/Ticker?pair=${pair}`).then(r => r.json());
    if (data.error?.length) throw new Error(`Kraken: ${data.error[0]}`);
    const t = Object.values(data.result as Record<string, any>)[0] as any;
    return {
      symbol,
      last: parseFloat(t.c[0]),
      bid: parseFloat(t.b[0]),
      ask: parseFloat(t.a[0]),
      high24h: parseFloat(t.h[1]),
      low24h: parseFloat(t.l[1]),
      volume24h: parseFloat(t.v[1]),
      timestamp: Date.now(),
    };
  }

  async getOHLCV(symbol: string, interval = '60', limit = 100): Promise<OHLCV[]> {
    const pair = symbol.replace('/', '').replace('BTC', 'XBT');
    const since = Math.floor((Date.now() - limit * parseInt(interval) * 60000) / 1000);
    const data: any = await fetch(`${this.base}/0/public/OHLC?pair=${pair}&interval=${interval}&since=${since}`).then(r => r.json());
    if (data.error?.length) return [];
    const candles: any[] = Object.values(data.result as Record<string, any>).find(v => Array.isArray(v)) ?? [];
    return candles.slice(-limit).map(c => ({
      timestamp: c[0] * 1000,
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[6]),
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const data = await this.privateRequest('/0/private/Balance');
    if (data.error?.length) throw new Error(`Kraken: ${data.error[0]}`);
    return Object.entries(data.result ?? {}).map(([asset, amount]: [string, any]) => ({
      asset: asset.replace(/^X(?=[A-Z]{3}$)/, '').replace(/^ZUSD$/, 'USD').replace(/^ZEUR$/, 'EUR'),
      free: parseFloat(amount),
      locked: 0,
      total: parseFloat(amount),
    })).filter(b => b.total > 0);
  }

  async placeOrder(p: OrderParams): Promise<OrderResult> {
    const pair = p.symbol.replace('/', '').replace('BTC', 'XBT');
    const params: Record<string, any> = {
      pair,
      type: p.side,
      ordertype: p.type === 'market' ? 'market' : 'limit',
      volume: p.amount,
    };
    if (p.price) params.price = p.price;

    const data = await this.privateRequest('/0/private/AddOrder', params);
    if (data.error?.length) return { success: false, error: data.error[0] };
    return {
      success: true,
      orderId: data.result.txid?.[0],
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: p.amount,
      status: 'open',
      timestamp: new Date().toISOString(),
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const data = await this.privateRequest('/0/private/CancelOrder', { txid: orderId });
    return !data.error?.length;
  }
}

// ─── Bybit ───────────────────────────────────────────────────────────────────

class BybitConnector {
  private apiKey: string;
  private secret: string;
  private base = 'https://api.bybit.com';

  constructor(apiKey: string, secret: string) {
    this.apiKey = apiKey;
    this.secret = secret;
  }

  private async signedRequest(path: string, params: Record<string, any> = {}, method = 'GET'): Promise<any> {
    const ts = String(Date.now());
    const recv = '5000';
    const qs = toQueryString(params);
    const preSign = ts + this.apiKey + recv + (method === 'GET' ? qs : JSON.stringify(params));
    const sig = await hmacSHA256(this.secret, preSign);

    const headers: Record<string, string> = {
      'X-BAPI-API-KEY': this.apiKey,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-RECV-WINDOW': recv,
      'X-BAPI-SIGN': sig,
      'Content-Type': 'application/json',
    };

    const url = method === 'GET' ? `${this.base}${path}?${qs}` : `${this.base}${path}`;
    const res = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? JSON.stringify(params) : undefined,
    });
    return res.json();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const sym = symbol.replace('/', '');
    const data: any = await fetch(`${this.base}/v5/market/tickers?category=spot&symbol=${sym}`).then(r => r.json());
    const t = data.result?.list?.[0];
    if (!t) throw new Error(`Bybit: no ticker for ${symbol}`);
    return {
      symbol,
      last: parseFloat(t.lastPrice),
      bid: parseFloat(t.bid1Price),
      ask: parseFloat(t.ask1Price),
      high24h: parseFloat(t.highPrice24h),
      low24h: parseFloat(t.lowPrice24h),
      volume24h: parseFloat(t.volume24h),
      timestamp: Date.now(),
    };
  }

  async getOHLCV(symbol: string, interval = '60', limit = 100): Promise<OHLCV[]> {
    const sym = symbol.replace('/', '');
    const data: any = await fetch(
      `${this.base}/v5/market/kline?category=spot&symbol=${sym}&interval=${interval}&limit=${limit}`
    ).then(r => r.json());
    const list: any[] = data.result?.list ?? [];
    return list.reverse().map(c => ({
      timestamp: parseInt(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const data: any = await this.signedRequest('/v5/account/wallet-balance', { accountType: 'UNIFIED' });
    const coins: any[] = data.result?.list?.[0]?.coin ?? [];
    return coins.map(c => ({
      asset: c.coin,
      free: parseFloat(c.availableToWithdraw ?? c.walletBalance),
      locked: parseFloat(c.locked ?? '0'),
      total: parseFloat(c.walletBalance),
    })).filter(b => b.total > 0);
  }

  async placeOrder(p: OrderParams): Promise<OrderResult> {
    const params: Record<string, any> = {
      category: 'spot',
      symbol: p.symbol.replace('/', ''),
      side: p.side === 'buy' ? 'Buy' : 'Sell',
      orderType: p.type === 'market' ? 'Market' : 'Limit',
      qty: String(p.amount),
    };
    if (p.price) params.price = String(p.price);
    if (p.timeInForce) params.timeInForce = p.timeInForce;
    else if (p.type === 'limit') params.timeInForce = 'GTC';
    if (p.clientOrderId) params.orderLinkId = p.clientOrderId;

    const data: any = await this.signedRequest('/v5/order/create', params, 'POST');
    if (data.retCode !== 0) return { success: false, error: data.retMsg };
    return {
      success: true,
      orderId: data.result.orderId,
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: p.amount,
      status: 'open',
      timestamp: new Date().toISOString(),
    };
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const data: any = await this.signedRequest('/v5/order/cancel', {
      category: 'spot',
      symbol: symbol.replace('/', ''),
      orderId,
    }, 'POST');
    return data.retCode === 0;
  }
}

// ─── KuCoin ──────────────────────────────────────────────────────────────────

class KuCoinConnector {
  private apiKey: string;
  private secret: string;
  private passphrase: string;
  private base = 'https://api.kucoin.com';

  constructor(apiKey: string, secret: string, passphrase: string) {
    this.apiKey = apiKey;
    this.secret = secret;
    this.passphrase = passphrase;
  }

  private async signedRequest(path: string, method = 'GET', body?: string): Promise<any> {
    const ts = String(Date.now());
    const what = ts + method.toUpperCase() + path + (body ?? '');
    const sig = await hmacSHA256Base64(this.secret, what);
    const passphraseSig = await hmacSHA256Base64(this.secret, this.passphrase);

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'KC-API-KEY': this.apiKey,
        'KC-API-SIGN': sig,
        'KC-API-TIMESTAMP': ts,
        'KC-API-PASSPHRASE': passphraseSig,
        'KC-API-KEY-VERSION': '2',
        'Content-Type': 'application/json',
      },
      body,
    });
    return res.json();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const sym = symbol.replace('/', '-');
    const data: any = await fetch(`${this.base}/api/v1/market/orderbook/level1?symbol=${sym}`).then(r => r.json());
    return {
      symbol,
      last: parseFloat(data.data?.price ?? '0'),
      bid: parseFloat(data.data?.bestBid ?? '0'),
      ask: parseFloat(data.data?.bestAsk ?? '0'),
      timestamp: Date.now(),
    };
  }

  async getOHLCV(symbol: string, type = '1hour', limit = 100): Promise<OHLCV[]> {
    const sym = symbol.replace('/', '-');
    const startAt = Math.floor((Date.now() - limit * 3600000) / 1000);
    const data: any = await fetch(
      `${this.base}/api/v1/market/candles?symbol=${sym}&type=${type}&startAt=${startAt}`
    ).then(r => r.json());
    const list: any[] = data.data ?? [];
    return list.slice(0, limit).reverse().map(c => ({
      timestamp: parseInt(c[0]) * 1000,
      open: parseFloat(c[1]),
      close: parseFloat(c[2]),
      high: parseFloat(c[3]),
      low: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const data: any = await this.signedRequest('/api/v1/accounts');
    if (data.code !== '200000') throw new Error(`KuCoin: ${data.msg}`);
    const seen = new Set<string>();
    const result: Balance[] = [];
    for (const a of data.data ?? []) {
      if (seen.has(a.currency)) continue;
      seen.add(a.currency);
      const total = parseFloat(a.balance);
      if (total <= 0) continue;
      result.push({ asset: a.currency, free: parseFloat(a.available), locked: parseFloat(a.holds), total });
    }
    return result;
  }

  async placeOrder(p: OrderParams): Promise<OrderResult> {
    const body = JSON.stringify({
      clientOid: p.clientOrderId ?? crypto.randomUUID(),
      symbol: p.symbol.replace('/', '-'),
      side: p.side,
      type: p.type === 'market' ? 'market' : 'limit',
      size: String(p.amount),
      ...(p.price ? { price: String(p.price) } : {}),
    });
    const data: any = await this.signedRequest('/api/v1/orders', 'POST', body);
    if (data.code !== '200000') return { success: false, error: data.msg };
    return {
      success: true,
      orderId: data.data.orderId,
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: p.amount,
      status: 'open',
      timestamp: new Date().toISOString(),
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const data: any = await this.signedRequest(`/api/v1/orders/${orderId}`, 'DELETE');
    return data.code === '200000';
  }
}

// ─── Alpaca ──────────────────────────────────────────────────────────────────

class AlpacaConnector {
  private apiKey: string;
  private secretKey: string;
  private base: string;

  constructor(apiKey: string, secretKey: string, paper = true) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.base = paper
      ? 'https://paper-api.alpaca.markets/v2'
      : 'https://api.alpaca.markets/v2';
  }

  private get headers(): Record<string, string> {
    return {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.secretKey,
      'Content-Type': 'application/json',
    };
  }

  async getBalances(): Promise<Balance[]> {
    const res = await fetch(`${this.base}/account`, { headers: this.headers });
    const data: any = await res.json();
    if (!res.ok) throw new Error(`Alpaca: ${data.message}`);
    return [
      {
        asset: 'USD',
        free: parseFloat(data.buying_power),
        locked: 0,
        total: parseFloat(data.portfolio_value),
      },
    ];
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const sym = symbol.replace('/', '');
    const res = await fetch(
      `https://data.alpaca.markets/v2/stocks/${sym}/quotes/latest`,
      { headers: this.headers }
    );
    const data: any = await res.json();
    return {
      symbol,
      last: data.quote?.ap ?? 0,
      bid: data.quote?.bp,
      ask: data.quote?.ap,
      timestamp: Date.now(),
    };
  }

  async getPositions(): Promise<Position[]> {
    const res = await fetch(`${this.base}/positions`, { headers: this.headers });
    const data: any[] = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(p => ({
      symbol: p.symbol,
      side: p.side === 'long' ? 'long' : 'short',
      size: parseFloat(p.qty),
      entryPrice: parseFloat(p.avg_entry_price),
      unrealisedPnl: parseFloat(p.unrealized_pl),
      exchange: 'alpaca',
    }));
  }

  async placeOrder(p: OrderParams): Promise<OrderResult> {
    const body = JSON.stringify({
      symbol: p.symbol.replace('/', ''),
      qty: p.amount,
      side: p.side,
      type: p.type === 'stop_market' ? 'stop' : p.type,
      time_in_force: p.timeInForce ?? 'gtc',
      ...(p.price ? { limit_price: p.price } : {}),
      ...(p.stopPrice ? { stop_price: p.stopPrice } : {}),
      ...(p.clientOrderId ? { client_order_id: p.clientOrderId } : {}),
    });
    const res = await fetch(`${this.base}/orders`, { method: 'POST', headers: this.headers, body });
    const data: any = await res.json();
    if (!res.ok) return { success: false, error: data.message };
    return {
      success: true,
      orderId: data.id,
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: parseFloat(data.qty),
      status: data.status,
      timestamp: data.created_at,
    };
  }
}

// ─── Exchange Manager ─────────────────────────────────────────────────────────

interface ExchangeCredentials {
  BINANCE_API_KEY?: string;
  BINANCE_SECRET_KEY?: string;
  KRAKEN_API_KEY?: string;
  KRAKEN_PRIVATE_KEY?: string;
  BYBIT_API_KEY?: string;
  BYBIT_API_SECRET?: string;
  KUCOIN_KEY?: string;
  KUCOIN_SECRET?: string;
  KUCOIN_PASSPHRASE?: string;
  ALPACA_API_KEY?: string;
  ALPACA_SECRET_KEY?: string;
  ALPACA_PAPER?: string;
}

export class ExchangeManager {
  private binance?: BinanceConnector;
  private kraken?: KrakenConnector;
  private bybit?: BybitConnector;
  private kucoin?: KuCoinConnector;
  private alpacaConn?: AlpacaConnector;

  constructor(creds: ExchangeCredentials) {
    if (creds.BINANCE_API_KEY && creds.BINANCE_SECRET_KEY) {
      this.binance = new BinanceConnector(creds.BINANCE_API_KEY, creds.BINANCE_SECRET_KEY);
    }
    if (creds.KRAKEN_API_KEY && creds.KRAKEN_PRIVATE_KEY) {
      this.kraken = new KrakenConnector(creds.KRAKEN_API_KEY, creds.KRAKEN_PRIVATE_KEY);
    }
    if (creds.BYBIT_API_KEY && creds.BYBIT_API_SECRET) {
      this.bybit = new BybitConnector(creds.BYBIT_API_KEY, creds.BYBIT_API_SECRET);
    }
    if (creds.KUCOIN_KEY && creds.KUCOIN_SECRET && creds.KUCOIN_PASSPHRASE) {
      this.kucoin = new KuCoinConnector(creds.KUCOIN_KEY, creds.KUCOIN_SECRET, creds.KUCOIN_PASSPHRASE);
    }
    if (creds.ALPACA_API_KEY && creds.ALPACA_SECRET_KEY) {
      this.alpacaConn = new AlpacaConnector(
        creds.ALPACA_API_KEY,
        creds.ALPACA_SECRET_KEY,
        creds.ALPACA_PAPER !== 'false'
      );
    }
  }

  getConnectedExchanges(): string[] {
    const list: string[] = [];
    if (this.binance) list.push('binance');
    if (this.kraken) list.push('kraken');
    if (this.bybit) list.push('bybit');
    if (this.kucoin) list.push('kucoin');
    if (this.alpacaConn) list.push('alpaca');
    return list;
  }

  private getExchange(name: string): any {
    switch (name.toLowerCase()) {
      case 'binance': if (this.binance) return this.binance; break;
      case 'kraken':  if (this.kraken)  return this.kraken;  break;
      case 'bybit':   if (this.bybit)   return this.bybit;   break;
      case 'kucoin':  if (this.kucoin)  return this.kucoin;  break;
      case 'alpaca':  if (this.alpacaConn) return this.alpacaConn; break;
    }
    throw new Error(`Exchange "${name}" not configured`);
  }

  async getTicker(exchange: string, symbol: string): Promise<Ticker> {
    return this.getExchange(exchange).getTicker(symbol);
  }

  async getOHLCV(exchange: string, symbol: string, timeframe = '1h', limit = 100): Promise<OHLCV[]> {
    // Normalise timeframe per exchange
    let tf = timeframe;
    if (exchange === 'kraken') {
      const map: Record<string, string> = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': '1440' };
      tf = map[timeframe] ?? '60';
    } else if (exchange === 'bybit') {
      const map: Record<string, string> = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D' };
      tf = map[timeframe] ?? '60';
    } else if (exchange === 'kucoin') {
      const map: Record<string, string> = { '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1hour', '4h': '4hour', '1d': '1day' };
      tf = map[timeframe] ?? '1hour';
    }
    return this.getExchange(exchange).getOHLCV(symbol, tf, limit);
  }

  async getBalances(exchange: string): Promise<Balance[]> {
    return this.getExchange(exchange).getBalances();
  }

  async getAllBalances(): Promise<Record<string, Balance[]>> {
    const results: Record<string, Balance[]> = {};
    await Promise.allSettled(
      this.getConnectedExchanges().map(async ex => {
        try {
          results[ex] = await this.getBalances(ex);
        } catch (e: any) {
          results[ex] = [];
        }
      })
    );
    return results;
  }

  async getAllPositions(): Promise<Position[]> {
    const positions: Position[] = [];
    if (this.alpacaConn) {
      try {
        const p = await this.alpacaConn.getPositions();
        positions.push(...p);
      } catch { /* ignore */ }
    }
    return positions;
  }

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    return this.getExchange(params.exchange).placeOrder(params);
  }

  async cancelOrder(exchange: string, orderId: string, symbol: string): Promise<boolean> {
    const ex = this.getExchange(exchange);
    if (exchange === 'binance') return ex.cancelOrder(orderId, symbol);
    if (exchange === 'bybit')   return ex.cancelOrder(orderId, symbol);
    return ex.cancelOrder(orderId);
  }
}

export function createExchangeManager(creds: ExchangeCredentials): ExchangeManager {
  return new ExchangeManager(creds);
}
