/**
 * SDK-Based Exchange Connector for Trade M8
 * Uses CCXT for CEX trading (Binance, Kraken, Bybit, KuCoin)
 * Uses Alpaca SDK for stocks/crypto brokerage
 * Unified interface for order placement, balance queries, and position management
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ExchangeCredentials {
  binance?: { apiKey: string; secret: string };
  kraken?: { apiKey: string; secret: string };
  bybit?: { apiKey: string; secret: string };
  kucoin?: { apiKey: string; secret: string; passphrase: string };
  alpaca?: { apiKey: string; secretKey: string; paper?: boolean };
}

export interface Balance {
  currency: string;
  free: number;
  used: number;
  total: number;
}

export interface OrderParams {
  exchange: string;
  symbol: string;          // e.g. 'BTC/USDT'
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  amount: number;          // base currency quantity
  price?: number;          // required for limit/stop_limit
  stopPrice?: number;      // for stop orders
  takeProfitPrice?: number;
  stopLossPrice?: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'PO';
  clientOrderId?: string;
}

export interface OrderResult {
  success: boolean;
  orderId: string;
  exchange: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  status: string;
  amount: number;
  filled: number;
  remaining: number;
  price: number;
  averagePrice: number;
  cost: number;
  fees: number;
  feeCurrency: string;
  timestamp: string;
  error?: string;
  raw?: any;
}

export interface Position {
  exchange: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  leverage: number;
  liquidationPrice?: number;
  marginType?: string;
}

export interface Ticker {
  exchange: string;
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  high: number;
  low: number;
  volume: number;
  change: number;
  changePercent: number;
  timestamp: string;
}

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================================================
// CCXT EXCHANGE CONNECTOR
// ============================================================================

export class CCXTConnector {
  private instances: Map<string, any> = new Map();
  private ccxt: any;

  constructor() {
    // CCXT loaded dynamically — compatible with Cloudflare Workers via nodejs_compat
    this.ccxt = require('ccxt');
  }

  /**
   * Initialise a CCXT exchange instance with credentials
   */
  init(credentials: ExchangeCredentials): void {
    if (credentials.binance) {
      this.instances.set('binance', new this.ccxt.binance({
        apiKey: credentials.binance.apiKey,
        secret: credentials.binance.secret,
        enableRateLimit: true,
        options: { defaultType: 'spot' },
      }));
    }

    if (credentials.kraken) {
      this.instances.set('kraken', new this.ccxt.kraken({
        apiKey: credentials.kraken.apiKey,
        secret: credentials.kraken.secret,
        enableRateLimit: true,
      }));
    }

    if (credentials.bybit) {
      this.instances.set('bybit', new this.ccxt.bybit({
        apiKey: credentials.bybit.apiKey,
        secret: credentials.bybit.secret,
        enableRateLimit: true,
        options: { defaultType: 'spot' },
      }));
    }

    if (credentials.kucoin) {
      this.instances.set('kucoin', new this.ccxt.kucoin({
        apiKey: credentials.kucoin.apiKey,
        secret: credentials.kucoin.secret,
        password: credentials.kucoin.passphrase,
        enableRateLimit: true,
      }));
    }
  }

  getExchange(name: string): any {
    const ex = this.instances.get(name);
    if (!ex) throw new Error(`Exchange '${name}' not initialised. Call init() first.`);
    return ex;
  }

  getAvailableExchanges(): string[] {
    return Array.from(this.instances.keys());
  }

  // ---- Market Data ----

  async getTicker(exchange: string, symbol: string): Promise<Ticker> {
    const ex = this.getExchange(exchange);
    const t = await ex.fetchTicker(symbol);
    return {
      exchange,
      symbol,
      bid: t.bid ?? 0,
      ask: t.ask ?? 0,
      last: t.last ?? 0,
      high: t.high ?? 0,
      low: t.low ?? 0,
      volume: t.baseVolume ?? 0,
      change: t.change ?? 0,
      changePercent: t.percentage ?? 0,
      timestamp: new Date(t.timestamp).toISOString(),
    };
  }

  async getOHLCV(exchange: string, symbol: string, timeframe = '1h', limit = 100): Promise<OHLCV[]> {
    const ex = this.getExchange(exchange);
    const raw = await ex.fetchOHLCV(symbol, timeframe, undefined, limit);
    return raw.map((c: number[]) => ({
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }));
  }

  async getOrderBook(exchange: string, symbol: string, limit = 20): Promise<{ bids: number[][]; asks: number[][] }> {
    const ex = this.getExchange(exchange);
    const ob = await ex.fetchOrderBook(symbol, limit);
    return { bids: ob.bids, asks: ob.asks };
  }

  // ---- Account ----

  async getBalances(exchange: string): Promise<Balance[]> {
    const ex = this.getExchange(exchange);
    const raw = await ex.fetchBalance();
    return Object.entries(raw.total as Record<string, number>)
      .filter(([, total]) => total > 0)
      .map(([currency, total]) => ({
        currency,
        free: (raw.free as Record<string, number>)[currency] ?? 0,
        used: (raw.used as Record<string, number>)[currency] ?? 0,
        total,
      }));
  }

  async getPositions(exchange: string): Promise<Position[]> {
    const ex = this.getExchange(exchange);
    try {
      const raw = await ex.fetchPositions();
      return raw
        .filter((p: any) => Math.abs(p.contracts ?? 0) > 0)
        .map((p: any) => ({
          exchange,
          symbol: p.symbol,
          side: p.side,
          size: Math.abs(p.contracts ?? 0),
          entryPrice: p.entryPrice ?? 0,
          markPrice: p.markPrice ?? 0,
          unrealizedPnl: p.unrealizedPnl ?? 0,
          unrealizedPnlPercent: p.percentage ?? 0,
          leverage: p.leverage ?? 1,
          liquidationPrice: p.liquidationPrice,
          marginType: p.marginType,
        }));
    } catch {
      return []; // Exchange may not support positions (spot-only)
    }
  }

  // ---- Order Management ----

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const ex = this.getExchange(params.exchange);

    const orderParams: Record<string, any> = {};
    if (params.timeInForce) orderParams.timeInForce = params.timeInForce;
    if (params.clientOrderId) orderParams.clientOrderId = params.clientOrderId;
    if (params.stopPrice) orderParams.stopPrice = params.stopPrice;

    try {
      const order = await ex.createOrder(
        params.symbol,
        params.type,
        params.side,
        params.amount,
        params.price,
        orderParams
      );

      return {
        success: true,
        orderId: order.id,
        exchange: params.exchange,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        status: order.status,
        amount: order.amount,
        filled: order.filled ?? 0,
        remaining: order.remaining ?? order.amount,
        price: order.price ?? 0,
        averagePrice: order.average ?? order.price ?? 0,
        cost: order.cost ?? 0,
        fees: order.fee?.cost ?? 0,
        feeCurrency: order.fee?.currency ?? '',
        timestamp: new Date(order.timestamp ?? Date.now()).toISOString(),
        raw: order,
      };
    } catch (err: any) {
      return {
        success: false,
        orderId: '',
        exchange: params.exchange,
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        status: 'failed',
        amount: params.amount,
        filled: 0,
        remaining: params.amount,
        price: params.price ?? 0,
        averagePrice: 0,
        cost: 0,
        fees: 0,
        feeCurrency: '',
        timestamp: new Date().toISOString(),
        error: err.message,
      };
    }
  }

  async cancelOrder(exchange: string, orderId: string, symbol: string): Promise<boolean> {
    const ex = this.getExchange(exchange);
    try {
      await ex.cancelOrder(orderId, symbol);
      return true;
    } catch {
      return false;
    }
  }

  async getOpenOrders(exchange: string, symbol?: string): Promise<any[]> {
    const ex = this.getExchange(exchange);
    return ex.fetchOpenOrders(symbol);
  }

  async getOrderHistory(exchange: string, symbol?: string, limit = 50): Promise<any[]> {
    const ex = this.getExchange(exchange);
    return ex.fetchClosedOrders(symbol, undefined, limit);
  }

  // ---- OCO / Bracket Orders (stop-loss + take-profit) ----

  async placeBracketOrder(params: OrderParams): Promise<{ entry: OrderResult; stopLoss?: OrderResult; takeProfit?: OrderResult }> {
    // Place entry order first
    const entry = await this.placeOrder(params);
    if (!entry.success) return { entry };

    const results: { entry: OrderResult; stopLoss?: OrderResult; takeProfit?: OrderResult } = { entry };

    // Place stop-loss
    if (params.stopLossPrice && entry.success) {
      results.stopLoss = await this.placeOrder({
        ...params,
        type: 'stop',
        side: params.side === 'buy' ? 'sell' : 'buy',
        price: params.stopLossPrice,
        stopPrice: params.stopLossPrice,
        amount: params.amount,
        takeProfitPrice: undefined,
        stopLossPrice: undefined,
      });
    }

    // Place take-profit
    if (params.takeProfitPrice && entry.success) {
      results.takeProfit = await this.placeOrder({
        ...params,
        type: 'limit',
        side: params.side === 'buy' ? 'sell' : 'buy',
        price: params.takeProfitPrice,
        amount: params.amount,
        takeProfitPrice: undefined,
        stopLossPrice: undefined,
      });
    }

    return results;
  }
}

// ============================================================================
// ALPACA SDK CONNECTOR (Stocks + Crypto Brokerage)
// ============================================================================

export class AlpacaConnector {
  private client: any;
  private paper: boolean;

  constructor(apiKey: string, secretKey: string, paper = true) {
    const Alpaca = require('@alpacahq/alpaca-trade-api');
    this.paper = paper;
    this.client = new Alpaca({
      keyId: apiKey,
      secretKey: secretKey,
      paper: paper,
      feed: 'iex',  // 'sip' for paid, 'iex' for free
    });
  }

  async getAccount(): Promise<any> {
    return this.client.getAccount();
  }

  async getBalances(): Promise<Balance[]> {
    const acct = await this.client.getAccount();
    return [
      { currency: 'USD', free: parseFloat(acct.buying_power), used: 0, total: parseFloat(acct.equity) },
    ];
  }

  async getTicker(symbol: string): Promise<Ticker> {
    // Alpaca uses simple symbol format (BTCUSD, AAPL)
    const bars = await this.client.getBarsV2(symbol, {
      timeframe: '1Min',
      limit: 1,
      adjustment: 'raw',
    });
    let last = 0;
    for await (const bar of bars) {
      last = bar.ClosePrice ?? bar.c ?? 0;
      break;
    }
    return {
      exchange: 'alpaca',
      symbol,
      bid: last,
      ask: last,
      last,
      high: 0,
      low: 0,
      volume: 0,
      change: 0,
      changePercent: 0,
      timestamp: new Date().toISOString(),
    };
  }

  async getPositions(): Promise<Position[]> {
    const raw = await this.client.getPositions();
    return raw.map((p: any) => ({
      exchange: 'alpaca',
      symbol: p.symbol,
      side: p.side === 'long' ? 'long' : 'short',
      size: Math.abs(parseFloat(p.qty)),
      entryPrice: parseFloat(p.avg_entry_price),
      markPrice: parseFloat(p.current_price),
      unrealizedPnl: parseFloat(p.unrealized_pl),
      unrealizedPnlPercent: parseFloat(p.unrealized_plpc) * 100,
      leverage: 1,
    }));
  }

  async placeOrder(params: Omit<OrderParams, 'exchange'>): Promise<OrderResult> {
    try {
      // Alpaca uses simple symbol (BTCUSD not BTC/USD)
      const symbol = params.symbol.replace('/', '');
      const order = await this.client.createOrder({
        symbol,
        qty: params.amount,
        side: params.side,
        type: params.type === 'stop_limit' ? 'stop_limit' : params.type,
        time_in_force: params.timeInForce?.toLowerCase() ?? 'gtc',
        limit_price: params.price?.toFixed(2),
        stop_price: params.stopPrice?.toFixed(2),
        take_profit: params.takeProfitPrice ? { limit_price: params.takeProfitPrice.toFixed(2) } : undefined,
        stop_loss: params.stopLossPrice ? { stop_price: params.stopLossPrice.toFixed(2) } : undefined,
        client_order_id: params.clientOrderId,
      });

      return {
        success: true,
        orderId: order.id,
        exchange: 'alpaca',
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        status: order.status,
        amount: parseFloat(order.qty),
        filled: parseFloat(order.filled_qty ?? '0'),
        remaining: parseFloat(order.qty) - parseFloat(order.filled_qty ?? '0'),
        price: parseFloat(order.limit_price ?? '0'),
        averagePrice: parseFloat(order.filled_avg_price ?? '0'),
        cost: 0,
        fees: 0,
        feeCurrency: 'USD',
        timestamp: order.created_at,
        raw: order,
      };
    } catch (err: any) {
      return {
        success: false,
        orderId: '',
        exchange: 'alpaca',
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        status: 'failed',
        amount: params.amount,
        filled: 0,
        remaining: params.amount,
        price: params.price ?? 0,
        averagePrice: 0,
        cost: 0,
        fees: 0,
        feeCurrency: 'USD',
        timestamp: new Date().toISOString(),
        error: err.message,
      };
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.client.cancelOrder(orderId);
      return true;
    } catch {
      return false;
    }
  }

  async getOpenOrders(): Promise<any[]> {
    return this.client.getOrders({ status: 'open', limit: 100 });
  }

  isPaper(): boolean {
    return this.paper;
  }
}

// ============================================================================
// UNIFIED EXCHANGE MANAGER
// ============================================================================

export class ExchangeManager {
  public ccxt: CCXTConnector;
  public alpaca?: AlpacaConnector;
  private initialised = false;

  constructor() {
    this.ccxt = new CCXTConnector();
  }

  /**
   * Initialise all configured exchanges from environment / secrets
   */
  init(credentials: ExchangeCredentials & { alpaca?: { apiKey: string; secretKey: string; paper?: boolean } }): void {
    this.ccxt.init(credentials);

    if (credentials.alpaca) {
      this.alpaca = new AlpacaConnector(
        credentials.alpaca.apiKey,
        credentials.alpaca.secretKey,
        credentials.alpaca.paper ?? true
      );
    }

    this.initialised = true;
    console.log(`ExchangeManager initialised. CCXT exchanges: [${this.ccxt.getAvailableExchanges().join(', ')}]${this.alpaca ? ' + Alpaca' : ''}`);
  }

  isReady(): boolean {
    return this.initialised;
  }

  /**
   * Get all connected exchange names
   */
  getConnectedExchanges(): string[] {
    const list = this.ccxt.getAvailableExchanges();
    if (this.alpaca) list.push('alpaca');
    return list;
  }

  /**
   * Place an order on any connected exchange
   */
  async placeOrder(params: OrderParams): Promise<OrderResult> {
    if (params.exchange === 'alpaca') {
      if (!this.alpaca) throw new Error('Alpaca not configured');
      return this.alpaca.placeOrder(params);
    }
    return this.ccxt.placeOrder(params);
  }

  /**
   * Get balances across all connected exchanges
   */
  async getAllBalances(): Promise<Record<string, Balance[]>> {
    const results: Record<string, Balance[]> = {};

    for (const ex of this.ccxt.getAvailableExchanges()) {
      try {
        results[ex] = await this.ccxt.getBalances(ex);
      } catch (e: any) {
        results[ex] = [];
        console.warn(`Balance fetch failed for ${ex}: ${e.message}`);
      }
    }

    if (this.alpaca) {
      try {
        results['alpaca'] = await this.alpaca.getBalances();
      } catch (e: any) {
        results['alpaca'] = [];
      }
    }

    return results;
  }

  /**
   * Get all open positions across connected exchanges
   */
  async getAllPositions(): Promise<Position[]> {
    const positions: Position[] = [];

    for (const ex of this.ccxt.getAvailableExchanges()) {
      try {
        const pos = await this.ccxt.getPositions(ex);
        positions.push(...pos);
      } catch {}
    }

    if (this.alpaca) {
      try {
        const pos = await this.alpaca.getPositions();
        positions.push(...pos);
      } catch {}
    }

    return positions;
  }

  /**
   * Get ticker from the best available exchange for a symbol
   */
  async getTicker(symbol: string, preferredExchange?: string): Promise<Ticker> {
    const exchanges = preferredExchange
      ? [preferredExchange, ...this.ccxt.getAvailableExchanges().filter(e => e !== preferredExchange)]
      : this.ccxt.getAvailableExchanges();

    for (const ex of exchanges) {
      try {
        return await this.ccxt.getTicker(ex, symbol);
      } catch {}
    }
    throw new Error(`Could not fetch ticker for ${symbol} from any exchange`);
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createExchangeManager(env?: {
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
}): ExchangeManager {
  const manager = new ExchangeManager();

  const credentials: ExchangeCredentials & { alpaca?: any } = {};

  if (env?.BINANCE_API_KEY && env?.BINANCE_SECRET_KEY) {
    credentials.binance = { apiKey: env.BINANCE_API_KEY, secret: env.BINANCE_SECRET_KEY };
  }
  if (env?.KRAKEN_API_KEY && env?.KRAKEN_PRIVATE_KEY) {
    credentials.kraken = { apiKey: env.KRAKEN_API_KEY, secret: env.KRAKEN_PRIVATE_KEY };
  }
  if (env?.BYBIT_API_KEY && env?.BYBIT_API_SECRET) {
    credentials.bybit = { apiKey: env.BYBIT_API_KEY, secret: env.BYBIT_API_SECRET };
  }
  if (env?.KUCOIN_KEY && env?.KUCOIN_SECRET && env?.KUCOIN_PASSPHRASE) {
    credentials.kucoin = { apiKey: env.KUCOIN_KEY, secret: env.KUCOIN_SECRET, passphrase: env.KUCOIN_PASSPHRASE };
  }
  if (env?.ALPACA_API_KEY && env?.ALPACA_SECRET_KEY) {
    credentials.alpaca = {
      apiKey: env.ALPACA_API_KEY,
      secretKey: env.ALPACA_SECRET_KEY,
      paper: env?.ALPACA_PAPER !== 'false',
    };
  }

  manager.init(credentials);
  return manager;
}
