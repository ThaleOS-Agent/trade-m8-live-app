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

// ─── Coinbase Advanced Trade ─────────────────────────────────────────────────

class CoinbaseConnector {
  private apiKey: string;
  private secret: string;
  private base = 'https://api.coinbase.com';

  constructor(apiKey: string, secret: string) {
    this.apiKey = apiKey;
    this.secret = secret;
  }

  private async signedRequest(method: string, path: string, body?: string): Promise<any> {
    const ts = String(Math.floor(Date.now() / 1000));
    const message = ts + method.toUpperCase() + path + (body ?? '');
    const sig = await hmacSHA256(this.secret, message);

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'CB-ACCESS-KEY': this.apiKey,
        'CB-ACCESS-SIGN': sig,
        'CB-ACCESS-TIMESTAMP': ts,
        'Content-Type': 'application/json',
      },
      body,
    });
    return res.json();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    // symbol e.g. BTC/USDT -> BTC-USDT
    const productId = symbol.replace('/', '-');
    const data: any = await fetch(`${this.base}/api/v3/brokerage/best_bid_ask?product_ids=${productId}`).then(r => r.json());
    const t = data.pricebooks?.[0];
    if (!t) throw new Error(`Coinbase: no ticker for ${symbol}`);
    return {
      symbol,
      last: parseFloat(t.asks?.[0]?.price ?? '0'),
      bid: parseFloat(t.bids?.[0]?.price ?? '0'),
      ask: parseFloat(t.asks?.[0]?.price ?? '0'),
      timestamp: Date.now(),
    };
  }

  async getOHLCV(symbol: string, granularity = 'ONE_HOUR', limit = 100): Promise<OHLCV[]> {
    const productId = symbol.replace('/', '-');
    const end = Math.floor(Date.now() / 1000);
    const granSeconds: Record<string, number> = {
      ONE_MINUTE: 60, FIVE_MINUTE: 300, FIFTEEN_MINUTE: 900,
      THIRTY_MINUTE: 1800, ONE_HOUR: 3600, TWO_HOUR: 7200,
      SIX_HOUR: 21600, ONE_DAY: 86400,
    };
    const secs = granSeconds[granularity] ?? 3600;
    const start = end - limit * secs;
    const data: any = await this.signedRequest(
      'GET',
      `/api/v3/brokerage/products/${productId}/candles?start=${start}&end=${end}&granularity=${granularity}`
    );
    const candles: any[] = data.candles ?? [];
    return candles.reverse().map(c => ({
      timestamp: parseInt(c.start) * 1000,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume),
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const data: any = await this.signedRequest('GET', '/api/v3/brokerage/accounts');
    if (!data.accounts) throw new Error(`Coinbase: ${data.error ?? 'Unknown error'}`);
    return (data.accounts as any[])
      .map(a => ({
        asset: a.currency,
        free: parseFloat(a.available_balance?.value ?? '0'),
        locked: 0,
        total: parseFloat(a.hold?.value ?? '0') + parseFloat(a.available_balance?.value ?? '0'),
      }))
      .filter(b => b.total > 0);
  }

  async placeOrder(p: OrderParams): Promise<OrderResult> {
    const productId = p.symbol.replace('/', '-');
    const orderConfig: any = {};
    if (p.type === 'market') {
      if (p.side === 'buy') {
        orderConfig.market_market_ioc = { quote_size: String(p.amount) };
      } else {
        orderConfig.market_market_ioc = { base_size: String(p.amount) };
      }
    } else {
      orderConfig.limit_limit_gtc = {
        base_size: String(p.amount),
        limit_price: String(p.price),
        post_only: false,
      };
    }

    const body = JSON.stringify({
      client_order_id: p.clientOrderId ?? crypto.randomUUID(),
      product_id: productId,
      side: p.side === 'buy' ? 'BUY' : 'SELL',
      order_configuration: orderConfig,
    });

    const data: any = await this.signedRequest('POST', '/api/v3/brokerage/orders', body);
    if (!data.success) {
      return { success: false, error: data.error_response?.message ?? data.error };
    }
    const o = data.order_configuration;
    return {
      success: true,
      orderId: data.order_id,
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: p.amount,
      status: 'open',
      timestamp: new Date().toISOString(),
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const body = JSON.stringify({ order_ids: [orderId] });
    const data: any = await this.signedRequest('POST', '/api/v3/brokerage/orders/batch_cancel', body);
    return data.results?.[0]?.success === true;
  }
}

// ─── OKX ─────────────────────────────────────────────────────────────────────

class OKXConnector {
  private apiKey: string;
  private secret: string;
  private passphrase: string;
  private base = 'https://www.okx.com';

  constructor(apiKey: string, secret: string, passphrase: string) {
    this.apiKey = apiKey;
    this.secret = secret;
    this.passphrase = passphrase;
  }

  private async signedRequest(method: string, path: string, body?: string): Promise<any> {
    const ts = new Date().toISOString();
    const preSign = ts + method.toUpperCase() + path + (body ?? '');
    const sig = await hmacSHA256Base64(this.secret, preSign);

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'OK-ACCESS-KEY': this.apiKey,
        'OK-ACCESS-SIGN': sig,
        'OK-ACCESS-TIMESTAMP': ts,
        'OK-ACCESS-PASSPHRASE': this.passphrase,
        'Content-Type': 'application/json',
        'x-simulated-trading': '0',
      },
      body,
    });
    return res.json();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const instId = symbol.replace('/', '-') + '-SPOT';
    const data: any = await fetch(`${this.base}/api/v5/market/ticker?instId=${instId}`).then(r => r.json());
    const t = data.data?.[0];
    if (!t) throw new Error(`OKX: no ticker for ${symbol}`);
    return {
      symbol,
      last: parseFloat(t.last),
      bid: parseFloat(t.bidPx),
      ask: parseFloat(t.askPx),
      high24h: parseFloat(t.high24h),
      low24h: parseFloat(t.low24h),
      volume24h: parseFloat(t.vol24h),
      timestamp: parseInt(t.ts),
    };
  }

  async getOHLCV(symbol: string, bar = '1H', limit = 100): Promise<OHLCV[]> {
    const instId = symbol.replace('/', '-') + '-SPOT';
    const data: any = await fetch(
      `${this.base}/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`
    ).then(r => r.json());
    const list: any[] = data.data ?? [];
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
    const data: any = await this.signedRequest('GET', '/api/v5/account/balance');
    if (data.code !== '0') throw new Error(`OKX: ${data.msg}`);
    const details: any[] = data.data?.[0]?.details ?? [];
    return details.map(d => ({
      asset: d.ccy,
      free: parseFloat(d.availBal),
      locked: parseFloat(d.frozenBal),
      total: parseFloat(d.bal),
    })).filter(b => b.total > 0);
  }

  async placeOrder(p: OrderParams): Promise<OrderResult> {
    const instId = p.symbol.replace('/', '-') + '-SPOT';
    const body = JSON.stringify({
      instId,
      tdMode: 'cash',
      side: p.side === 'buy' ? 'buy' : 'sell',
      ordType: p.type === 'market' ? 'market' : 'limit',
      sz: String(p.amount),
      ...(p.price ? { px: String(p.price) } : {}),
      ...(p.clientOrderId ? { clOrdId: p.clientOrderId } : {}),
    });
    const data: any = await this.signedRequest('POST', '/api/v5/trade/order', body);
    if (data.code !== '0') return { success: false, error: data.msg };
    const o = data.data?.[0];
    if (o?.sCode !== '0') return { success: false, error: o?.sMsg };
    return {
      success: true,
      orderId: o.ordId,
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: p.amount,
      status: 'open',
      timestamp: new Date().toISOString(),
    };
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const instId = symbol.replace('/', '-') + '-SPOT';
    const body = JSON.stringify({ instId, ordId: orderId });
    const data: any = await this.signedRequest('POST', '/api/v5/trade/cancel-order', body);
    return data.code === '0';
  }
}

// ─── Gate.io ──────────────────────────────────────────────────────────────────

class GateioConnector {
  private apiKey: string;
  private secret: string;
  private base = 'https://api.gateio.ws/api/v4';

  constructor(apiKey: string, secret: string) {
    this.apiKey = apiKey;
    this.secret = secret;
  }

  private async signedRequest(method: string, path: string, queryString = '', body = ''): Promise<any> {
    const ts = String(Math.floor(Date.now() / 1000));
    const enc = new TextEncoder();
    const bodyHash = await crypto.subtle.digest('SHA-512', enc.encode(body));
    const bodyHashHex = Array.from(new Uint8Array(bodyHash)).map(b => b.toString(16).padStart(2, '0')).join('');
    const preSign = `${method.toUpperCase()}\n${path}\n${queryString}\n${bodyHashHex}\n${ts}`;
    const sig = await hmacSHA256(this.secret, preSign);

    const url = queryString ? `${this.base}${path}?${queryString}` : `${this.base}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'KEY': this.apiKey,
        'SIGN': sig,
        'Timestamp': ts,
        'Content-Type': 'application/json',
      },
      body: body || undefined,
    });
    return res.json();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const currencyPair = symbol.replace('/', '_');
    const data: any = await fetch(`${this.base}/spot/tickers?currency_pair=${currencyPair}`).then(r => r.json());
    const t = Array.isArray(data) ? data[0] : null;
    if (!t) throw new Error(`Gate.io: no ticker for ${symbol}`);
    return {
      symbol,
      last: parseFloat(t.last),
      bid: parseFloat(t.highest_bid),
      ask: parseFloat(t.lowest_ask),
      high24h: parseFloat(t.high_24h),
      low24h: parseFloat(t.low_24h),
      volume24h: parseFloat(t.quote_volume),
      timestamp: Date.now(),
    };
  }

  async getOHLCV(symbol: string, interval = '1h', limit = 100): Promise<OHLCV[]> {
    const currencyPair = symbol.replace('/', '_');
    const data: any = await fetch(
      `${this.base}/spot/candlesticks?currency_pair=${currencyPair}&interval=${interval}&limit=${limit}`
    ).then(r => r.json());
    const list: any[] = Array.isArray(data) ? data : [];
    return list.map(c => ({
      timestamp: parseInt(c[0]) * 1000,
      volume: parseFloat(c[1]),
      close: parseFloat(c[2]),
      high: parseFloat(c[3]),
      low: parseFloat(c[4]),
      open: parseFloat(c[5]),
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const data: any = await this.signedRequest('GET', '/spot/accounts');
    if (!Array.isArray(data)) throw new Error(`Gate.io: failed to get balances`);
    return data.map((a: any) => ({
      asset: a.currency,
      free: parseFloat(a.available),
      locked: parseFloat(a.locked),
      total: parseFloat(a.available) + parseFloat(a.locked),
    })).filter(b => b.total > 0);
  }

  async placeOrder(p: OrderParams): Promise<OrderResult> {
    const body = JSON.stringify({
      currency_pair: p.symbol.replace('/', '_'),
      type: p.type === 'market' ? 'market' : 'limit',
      side: p.side,
      amount: String(p.amount),
      ...(p.price ? { price: String(p.price) } : {}),
      ...(p.timeInForce ? { time_in_force: p.timeInForce } : {}),
      ...(p.clientOrderId ? { text: `t-${p.clientOrderId}` } : {}),
    });
    const data: any = await this.signedRequest('POST', '/spot/orders', '', body);
    if (data.label) return { success: false, error: data.message };
    return {
      success: true,
      orderId: String(data.id),
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: parseFloat(data.amount),
      price: data.price ? parseFloat(data.price) : undefined,
      status: data.status,
      timestamp: new Date().toISOString(),
    };
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const currencyPair = symbol.replace('/', '_');
    const data: any = await this.signedRequest('DELETE', `/spot/orders/${orderId}`, `currency_pair=${currencyPair}`);
    return data.status === 'cancelled';
  }
}

// ─── MEXC ─────────────────────────────────────────────────────────────────────

class MEXCConnector {
  private apiKey: string;
  private secret: string;
  private base = 'https://api.mexc.com';

  constructor(apiKey: string, secret: string) {
    this.apiKey = apiKey;
    this.secret = secret;
  }

  private async signedRequest(method: string, path: string, params: Record<string, any> = {}, body?: string): Promise<any> {
    const ts = String(Date.now());
    const allParams = { ...params, timestamp: ts };
    const qs = toQueryString(allParams);
    const sig = await hmacSHA256(this.secret, qs);
    const url = `${this.base}${path}?${qs}&signature=${sig}`;

    const res = await fetch(url, {
      method,
      headers: {
        'X-MEXC-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body,
    });
    return res.json();
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
      timestamp: parseInt(data.closeTime),
    };
  }

  async getOHLCV(symbol: string, interval = '1h', limit = 100): Promise<OHLCV[]> {
    const sym = symbol.replace('/', '');
    const data: any[] = await fetch(
      `${this.base}/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`
    ).then(r => r.json());
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
    const data: any = await this.signedRequest('GET', '/api/v3/account');
    if (data.code) throw new Error(`MEXC: ${data.msg}`);
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
      type: p.type.toUpperCase(),
      quantity: p.amount,
    };
    if (p.price) params.price = p.price;
    if (p.timeInForce) params.timeInForce = p.timeInForce;
    if (p.type === 'limit' && !p.timeInForce) params.timeInForce = 'GTC';
    if (p.clientOrderId) params.newClientOrderId = p.clientOrderId;

    const data: any = await this.signedRequest('POST', '/api/v3/order', params);
    if (data.code) return { success: false, error: data.msg };
    return {
      success: true,
      orderId: String(data.orderId),
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: parseFloat(data.origQty),
      price: data.price ? parseFloat(data.price) : undefined,
      status: data.status?.toLowerCase(),
      timestamp: new Date().toISOString(),
    };
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const sym = symbol.replace('/', '');
    const data: any = await this.signedRequest('DELETE', '/api/v3/order', { symbol: sym, orderId });
    return !data.code;
  }
}

// ─── Bitget ───────────────────────────────────────────────────────────────────

class BitgetConnector {
  private apiKey: string;
  private secret: string;
  private passphrase: string;
  private base = 'https://api.bitget.com';

  constructor(apiKey: string, secret: string, passphrase: string) {
    this.apiKey = apiKey;
    this.secret = secret;
    this.passphrase = passphrase;
  }

  private async signedRequest(method: string, path: string, body?: string): Promise<any> {
    const ts = String(Date.now());
    const preSign = ts + method.toUpperCase() + path + (body ?? '');
    const sig = await hmacSHA256Base64(this.secret, preSign);
    const passSig = await hmacSHA256Base64(this.secret, this.passphrase);

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'ACCESS-KEY': this.apiKey,
        'ACCESS-SIGN': sig,
        'ACCESS-TIMESTAMP': ts,
        'ACCESS-PASSPHRASE': passSig,
        'Content-Type': 'application/json',
        'locale': 'en-US',
      },
      body,
    });
    return res.json();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const sym = symbol.replace('/', '') + 'SPBL';
    const data: any = await fetch(`${this.base}/api/spot/v1/market/ticker?symbol=${sym}`).then(r => r.json());
    const t = data.data;
    if (!t) throw new Error(`Bitget: no ticker for ${symbol}`);
    return {
      symbol,
      last: parseFloat(t.close),
      bid: parseFloat(t.buyOne),
      ask: parseFloat(t.sellOne),
      high24h: parseFloat(t.high24h),
      low24h: parseFloat(t.low24h),
      volume24h: parseFloat(t.baseVol),
      timestamp: parseInt(t.ts),
    };
  }

  async getOHLCV(symbol: string, period = '1H', limit = 100): Promise<OHLCV[]> {
    const sym = symbol.replace('/', '') + 'SPBL';
    const data: any = await fetch(
      `${this.base}/api/spot/v1/market/candles?symbol=${sym}&period=${period}&limit=${limit}`
    ).then(r => r.json());
    const list: any[] = data.data ?? [];
    return list.map(c => ({
      timestamp: parseInt(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const data: any = await this.signedRequest('GET', '/api/spot/v1/account/assets');
    if (data.code !== '00000') throw new Error(`Bitget: ${data.msg}`);
    return (data.data ?? [])
      .map((a: any) => ({
        asset: a.coinName,
        free: parseFloat(a.available),
        locked: parseFloat(a.frozen),
        total: parseFloat(a.available) + parseFloat(a.frozen),
      }))
      .filter((b: Balance) => b.total > 0);
  }

  async placeOrder(p: OrderParams): Promise<OrderResult> {
    const sym = p.symbol.replace('/', '') + 'SPBL';
    const body = JSON.stringify({
      symbol: sym,
      side: p.side === 'buy' ? 'buy' : 'sell',
      orderType: p.type === 'market' ? 'market' : 'limit',
      quantity: String(p.amount),
      ...(p.price ? { price: String(p.price) } : {}),
      ...(p.clientOrderId ? { clientOrderId: p.clientOrderId } : {}),
      force: p.timeInForce ?? 'normal',
    });
    const data: any = await this.signedRequest('POST', '/api/spot/v1/trade/orders', body);
    if (data.code !== '00000') return { success: false, error: data.msg };
    return {
      success: true,
      orderId: data.data?.orderId,
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: p.amount,
      status: 'open',
      timestamp: new Date().toISOString(),
    };
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const sym = symbol.replace('/', '') + 'SPBL';
    const body = JSON.stringify({ symbol: sym, orderId });
    const data: any = await this.signedRequest('POST', '/api/spot/v1/trade/cancel-order', body);
    return data.code === '00000';
  }
}

// ─── Bitfinex ─────────────────────────────────────────────────────────────────

class BitfinexConnector {
  private apiKey: string;
  private secret: string;
  private base = 'https://api.bitfinex.com';

  constructor(apiKey: string, secret: string) {
    this.apiKey = apiKey;
    this.secret = secret;
  }

  private async signedRequest(path: string, body: Record<string, any> = {}): Promise<any> {
    const nonce = String(Date.now() * 1000);
    const bodyStr = JSON.stringify(body);
    const signature = `/api${path}${nonce}${bodyStr}`;
    const sig = await hmacSHA256(this.secret, signature);

    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        'bfx-nonce': nonce,
        'bfx-apikey': this.apiKey,
        'bfx-signature': sig,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    });
    return res.json();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    // BTC/USD -> tBTCUSD
    const sym = 't' + symbol.replace('/', '');
    const data: any = await fetch(`${this.base}/v2/ticker/${sym}`).then(r => r.json());
    if (!Array.isArray(data) || data.length < 10) throw new Error(`Bitfinex: no ticker for ${symbol}`);
    return {
      symbol,
      last: data[6],
      bid: data[0],
      ask: data[2],
      high24h: data[8],
      low24h: data[9],
      volume24h: data[7],
      timestamp: Date.now(),
    };
  }

  async getOHLCV(symbol: string, timeframe = '1h', limit = 100): Promise<OHLCV[]> {
    const sym = 't' + symbol.replace('/', '');
    const tfMap: Record<string, string> = {
      '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
      '1h': '1h', '4h': '4h', '1d': '1D',
    };
    const tf = tfMap[timeframe] ?? '1h';
    const data: any[] = await fetch(
      `${this.base}/v2/candles/trade:${tf}:${sym}/hist?limit=${limit}&sort=-1`
    ).then(r => r.json());
    return (Array.isArray(data) ? data : []).reverse().map(c => ({
      timestamp: c[0],
      open: c[1],
      close: c[2],
      high: c[3],
      low: c[4],
      volume: c[5],
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const data: any = await this.signedRequest('/v2/auth/r/wallets');
    if (!Array.isArray(data)) throw new Error(`Bitfinex: failed to fetch wallets`);
    return data
      .filter((w: any) => w[1] === 'exchange')
      .map((w: any) => ({
        asset: w[1] === 'exchange' ? w[0] : w[1],
        free: w[4] ?? w[2],
        locked: w[2] - (w[4] ?? w[2]),
        total: w[2],
      }))
      .filter(b => b.total > 0);
  }

  async placeOrder(p: OrderParams): Promise<OrderResult> {
    const sym = 't' + p.symbol.replace('/', '');
    const data: any = await this.signedRequest('/v2/auth/w/order/submit', {
      type: p.type === 'market' ? 'EXCHANGE MARKET' : 'EXCHANGE LIMIT',
      symbol: sym,
      amount: p.side === 'buy' ? String(p.amount) : String(-p.amount),
      ...(p.price ? { price: String(p.price) } : {}),
      ...(p.clientOrderId ? { cid: parseInt(p.clientOrderId) || Date.now() } : {}),
    });
    if (data[6] === 'ERROR') return { success: false, error: data[7] };
    const o = data[4]?.[0];
    return {
      success: true,
      orderId: String(o?.[0]),
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: Math.abs(parseFloat(o?.[6] ?? '0')),
      price: o?.[16] ? parseFloat(o[16]) : undefined,
      status: 'open',
      timestamp: new Date().toISOString(),
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const data: any = await this.signedRequest('/v2/auth/w/order/cancel', { id: parseInt(orderId) });
    return data[6] !== 'ERROR';
  }
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

class GeminiConnector {
  private apiKey: string;
  private secret: string;
  private base = 'https://api.gemini.com';

  constructor(apiKey: string, secret: string) {
    this.apiKey = apiKey;
    this.secret = secret;
  }

  private async signedRequest(path: string, payload: Record<string, any> = {}): Promise<any> {
    const nonce = String(Date.now());
    const body = { request: path, nonce, ...payload };
    const bodyB64 = btoa(JSON.stringify(body));
    const sig = await hmacSHA256(this.secret, bodyB64);

    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        'X-GEMINI-APIKEY': this.apiKey,
        'X-GEMINI-PAYLOAD': bodyB64,
        'X-GEMINI-SIGNATURE': sig,
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
      },
    });
    return res.json();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    // BTC/USD -> btcusd
    const sym = symbol.replace('/', '').toLowerCase();
    const data: any = await fetch(`${this.base}/v1/pubticker/${sym}`).then(r => r.json());
    if (data.result === 'error') throw new Error(`Gemini: ${data.reason}`);
    return {
      symbol,
      last: parseFloat(data.last),
      bid: parseFloat(data.bid),
      ask: parseFloat(data.ask),
      volume24h: parseFloat(data.volume?.[symbol.split('/')[0]] ?? '0'),
      timestamp: Math.floor(data.volume?.timestamp ?? Date.now()),
    };
  }

  async getOHLCV(symbol: string, resolution = 3600, limit = 100): Promise<OHLCV[]> {
    const sym = symbol.replace('/', '').toLowerCase();
    const data: any[] = await fetch(
      `${this.base}/v2/candles/${sym}/${resolution}`
    ).then(r => r.json());
    return (Array.isArray(data) ? data : []).slice(0, limit).map(c => ({
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const data: any = await this.signedRequest('/v1/balances');
    if (data.result === 'error') throw new Error(`Gemini: ${data.reason}`);
    return (Array.isArray(data) ? data : [])
      .map((b: any) => ({
        asset: b.currency,
        free: parseFloat(b.available),
        locked: parseFloat(b.amount) - parseFloat(b.available),
        total: parseFloat(b.amount),
      }))
      .filter(b => b.total > 0);
  }

  async placeOrder(p: OrderParams): Promise<OrderResult> {
    const sym = p.symbol.replace('/', '').toLowerCase();
    const data: any = await this.signedRequest('/v1/order/new', {
      symbol: sym,
      amount: String(p.amount),
      price: p.type === 'market' ? '0' : String(p.price ?? 0),
      side: p.side,
      type: p.type === 'market' ? 'exchange market' : 'exchange limit',
      ...(p.clientOrderId ? { client_order_id: p.clientOrderId } : {}),
    });
    if (data.result === 'error') return { success: false, error: data.reason };
    return {
      success: true,
      orderId: String(data.order_id),
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      amount: parseFloat(data.original_amount),
      price: data.price ? parseFloat(data.price) : undefined,
      status: data.is_live ? 'open' : 'filled',
      timestamp: new Date(data.timestampms).toISOString(),
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const data: any = await this.signedRequest('/v1/order/cancel', { order_id: parseInt(orderId) });
    return data.is_cancelled === true;
  }
}

// ─── Exchange Manager ─────────────────────────────────────────────────────────

interface ExchangeCredentials {
  // Existing
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
  // New
  COINBASE_API_KEY?: string;
  COINBASE_SECRET_KEY?: string;
  OKX_API_KEY?: string;
  OKX_SECRET_KEY?: string;
  OKX_PASSPHRASE?: string;
  GATEIO_API_KEY?: string;
  GATEIO_SECRET_KEY?: string;
  MEXC_API_KEY?: string;
  MEXC_SECRET_KEY?: string;
  BITGET_API_KEY?: string;
  BITGET_SECRET_KEY?: string;
  BITGET_PASSPHRASE?: string;
  BITFINEX_API_KEY?: string;
  BITFINEX_SECRET_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_SECRET_KEY?: string;
}

export class ExchangeManager {
  // Original exchanges
  private binance?: BinanceConnector;
  private kraken?: KrakenConnector;
  private bybit?: BybitConnector;
  private kucoin?: KuCoinConnector;
  private alpacaConn?: AlpacaConnector;
  // New exchanges
  private coinbase?: CoinbaseConnector;
  private okx?: OKXConnector;
  private gateio?: GateioConnector;
  private mexc?: MEXCConnector;
  private bitget?: BitgetConnector;
  private bitfinex?: BitfinexConnector;
  private gemini?: GeminiConnector;

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
    if (creds.COINBASE_API_KEY && creds.COINBASE_SECRET_KEY) {
      this.coinbase = new CoinbaseConnector(creds.COINBASE_API_KEY, creds.COINBASE_SECRET_KEY);
    }
    if (creds.OKX_API_KEY && creds.OKX_SECRET_KEY && creds.OKX_PASSPHRASE) {
      this.okx = new OKXConnector(creds.OKX_API_KEY, creds.OKX_SECRET_KEY, creds.OKX_PASSPHRASE);
    }
    if (creds.GATEIO_API_KEY && creds.GATEIO_SECRET_KEY) {
      this.gateio = new GateioConnector(creds.GATEIO_API_KEY, creds.GATEIO_SECRET_KEY);
    }
    if (creds.MEXC_API_KEY && creds.MEXC_SECRET_KEY) {
      this.mexc = new MEXCConnector(creds.MEXC_API_KEY, creds.MEXC_SECRET_KEY);
    }
    if (creds.BITGET_API_KEY && creds.BITGET_SECRET_KEY && creds.BITGET_PASSPHRASE) {
      this.bitget = new BitgetConnector(creds.BITGET_API_KEY, creds.BITGET_SECRET_KEY, creds.BITGET_PASSPHRASE);
    }
    if (creds.BITFINEX_API_KEY && creds.BITFINEX_SECRET_KEY) {
      this.bitfinex = new BitfinexConnector(creds.BITFINEX_API_KEY, creds.BITFINEX_SECRET_KEY);
    }
    if (creds.GEMINI_API_KEY && creds.GEMINI_SECRET_KEY) {
      this.gemini = new GeminiConnector(creds.GEMINI_API_KEY, creds.GEMINI_SECRET_KEY);
    }
  }

  getConnectedExchanges(): string[] {
    const list: string[] = [];
    if (this.binance)   list.push('binance');
    if (this.kraken)    list.push('kraken');
    if (this.bybit)     list.push('bybit');
    if (this.kucoin)    list.push('kucoin');
    if (this.alpacaConn) list.push('alpaca');
    if (this.coinbase)  list.push('coinbase');
    if (this.okx)       list.push('okx');
    if (this.gateio)    list.push('gateio');
    if (this.mexc)      list.push('mexc');
    if (this.bitget)    list.push('bitget');
    if (this.bitfinex)  list.push('bitfinex');
    if (this.gemini)    list.push('gemini');
    return list;
  }

  private getExchange(name: string): any {
    switch (name.toLowerCase()) {
      case 'binance':  if (this.binance)   return this.binance;   break;
      case 'kraken':   if (this.kraken)    return this.kraken;    break;
      case 'bybit':    if (this.bybit)     return this.bybit;     break;
      case 'kucoin':   if (this.kucoin)    return this.kucoin;    break;
      case 'alpaca':   if (this.alpacaConn) return this.alpacaConn; break;
      case 'coinbase': if (this.coinbase)  return this.coinbase;  break;
      case 'okx':      if (this.okx)       return this.okx;       break;
      case 'gateio':   if (this.gateio)    return this.gateio;    break;
      case 'mexc':     if (this.mexc)      return this.mexc;      break;
      case 'bitget':   if (this.bitget)    return this.bitget;    break;
      case 'bitfinex': if (this.bitfinex)  return this.bitfinex;  break;
      case 'gemini':   if (this.gemini)    return this.gemini;    break;
    }
    throw new Error(`Exchange "${name}" not configured`);
  }

  async getTicker(exchange: string, symbol: string): Promise<Ticker> {
    return this.getExchange(exchange).getTicker(symbol);
  }

  async getOHLCV(exchange: string, symbol: string, timeframe = '1h', limit = 100): Promise<OHLCV[]> {
    // Normalise timeframe per exchange
    let tf: string | number = timeframe;
    switch (exchange.toLowerCase()) {
      case 'kraken': {
        const map: Record<string, string> = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': '1440' };
        tf = map[timeframe] ?? '60';
        break;
      }
      case 'bybit': {
        const map: Record<string, string> = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D' };
        tf = map[timeframe] ?? '60';
        break;
      }
      case 'kucoin': {
        const map: Record<string, string> = { '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1hour', '4h': '4hour', '1d': '1day' };
        tf = map[timeframe] ?? '1hour';
        break;
      }
      case 'okx': {
        const map: Record<string, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
        tf = map[timeframe] ?? '1H';
        break;
      }
      case 'bitget': {
        const map: Record<string, string> = { '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1H', '4h': '4H', '1d': '1day' };
        tf = map[timeframe] ?? '1H';
        break;
      }
      case 'coinbase': {
        const map: Record<string, string> = { '1m': 'ONE_MINUTE', '5m': 'FIVE_MINUTE', '15m': 'FIFTEEN_MINUTE', '30m': 'THIRTY_MINUTE', '1h': 'ONE_HOUR', '4h': 'TWO_HOUR', '1d': 'ONE_DAY' };
        tf = map[timeframe] ?? 'ONE_HOUR';
        break;
      }
      case 'gemini': {
        const map: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
        tf = map[timeframe] ?? 3600;
        break;
      }
      // binance, mexc, gateio, bitfinex all use standard timeframe strings (1m, 5m, 1h, etc.)
    }
    return this.getExchange(exchange).getOHLCV(symbol, tf as any, limit);
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
    // Exchanges that need both orderId + symbol
    if (['binance', 'bybit', 'mexc', 'gateio', 'okx'].includes(exchange.toLowerCase())) {
      return ex.cancelOrder(orderId, symbol);
    }
    // Exchanges that need only orderId
    return ex.cancelOrder(orderId);
  }
}

export function createExchangeManager(creds: ExchangeCredentials): ExchangeManager {
  return new ExchangeManager(creds);
}
