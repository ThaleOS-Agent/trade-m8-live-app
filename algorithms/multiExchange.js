import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../../utils/logger.js';

/**
 * Multi-Exchange Connector
 * Supports Binance, Coinbase Pro, Kraken, KuCoin, Bybit
 */
export class MultiExchangeConnector {
  constructor(exchange, isTestnet = true) {
    this.exchange = exchange;
    this.isTestnet = isTestnet;
    this.apiKey = null;
    this.apiSecret = null;
    this.passphrase = null; // For Coinbase/Kraken
    
    this.baseUrls = {
      binance: {
        spot: isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com',
        futures: isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com'
      },
      coinbase: {
        spot: isTestnet ? 'https://api-public.sandbox.exchange.coinbase.com' : 'https://api.exchange.coinbase.com'
      },
      kraken: {
        spot: 'https://api.kraken.com'
      },
      kucoin: {
        spot: isTestnet ? 'https://openapi-sandbox.kucoin.com' : 'https://api.kucoin.com'
      },
      bybit: {
        spot: isTestnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com'
      },
      ftx: {
        spot: isTestnet ? 'https://ftx.us/api' : 'https://ftx.com/api'
      },
      gemini: {
        spot: isTestnet ? 'https://api.sandbox.gemini.com' : 'https://api.gemini.com'
      },
      bitfinex: {
        spot: 'https://api.bitfinex.com'
      },
      interactive_brokers: {
        spot: isTestnet ? 'https://localhost:5000/v1/api' : 'https://api.interactivebrokers.com/v1/api'
      },
      oanda: {
        spot: isTestnet ? 'https://api-fxpractice.oanda.com/v3' : 'https://api-fxtrade.oanda.com/v3'
      }
    };
    
    this.baseURL = this.baseUrls[exchange]?.spot || this.baseUrls.binance.spot;
  }

  setCredentials(apiKey, apiSecret, passphrase = null) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
  }

  // Generate signature based on exchange
  generateSignature(method, endpoint, params = {}, timestamp = null, body = '') {
    switch (this.exchange) {
      case 'binance':
        return this.generateBinanceSignature(params);
      case 'coinbase':
        return this.generateCoinbaseSignature(method, endpoint, params, timestamp);
      case 'kraken':
        return this.generateKrakenSignature(endpoint, params, timestamp);
      case 'kucoin':
        return this.generateKucoinSignature(endpoint, params, timestamp);
      case 'bybit':
        return this.generateBybitSignature(params, timestamp);
      case 'ftx':
        return this.generateFTXSignature(timestamp, method, endpoint, body);
      case 'gemini':
        return this.generateGeminiSignature(endpoint, params, timestamp);
      case 'bitfinex':
        return this.generateBitfinexSignature(endpoint, params, body);
      case 'interactive_brokers':
        return ''; // IB uses OAuth
      case 'oanda':
        return this.generateOandaSignature(timestamp);
      default:
        throw new Error(`Unsupported exchange: ${this.exchange}`);
    }
  }

  generateFTXSignature(timestamp, method, endpoint, body) {
    const payload = timestamp + method.toUpperCase() + '/api' + endpoint + (body ? JSON.stringify(body) : '');
    return crypto.createHmac('sha256', this.apiSecret).update(payload).digest('hex');
  }

  generateGeminiSignature(endpoint, params, timestamp) {
    const payload = { request: endpoint, nonce: timestamp, ...params };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
    return crypto.createHmac('sha384', this.apiSecret).update(encodedPayload).digest('hex');
  }

  generateBitfinexSignature(endpoint, params, body) {
    const payload = '/api/v2' + endpoint + (body ? JSON.stringify(body) : '');
    return crypto.createHmac('sha384', this.apiSecret).update(payload).digest('hex');
  }

  generateOandaSignature(timestamp) {
    return crypto.createHmac('sha256', this.apiSecret).update(timestamp).digest('hex');
  }

  generateBinanceSignature(queryString) {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  generateCoinbaseSignature(method, endpoint, body, timestamp) {
    const message = timestamp + method.toUpperCase() + endpoint + JSON.stringify(body);
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('base64');
  }

  generateKrakenSignature(endpoint, params, nonce) {
    const message = params + nonce;
    const secret = Buffer.from(this.apiSecret, 'base64');
    const hash = crypto.createHash('sha256').update(nonce + params).digest();
    return crypto.createHmac('sha512', secret).update(endpoint + hash).digest('base64');
  }

  generateKucoinSignature(endpoint, params, timestamp) {
    const strForSign = timestamp + 'GET' + endpoint + (params ? '?' + params : '');
    return crypto.createHmac('sha256', this.apiSecret).update(strForSign).digest('base64');
  }

    generateBybitSignature({ method = "GET", path = "/", query = "", body = "" }, timestamp) {
    const queryString = typeof query === "string" ? query : new URLSearchParams(query).toString();
    const prehash = [
      timestamp,
      method.toUpperCase(),
      path,
      queryString ? "?" + queryString : "",
      body || ""
    ].join("");

    // CodeQL: This is an API request signature per Bybit v5 spec, not a password hash.
    // See https://bybit-exchange.github.io/docs/v5/authentication/rest-api-sig
    return crypto.createHmac("sha256", this.apiSecret).update(prehash).digest("hex");
  }

  // Make authenticated request
  async makeRequest(method, endpoint, params = {}, isPrivate = false) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = this.buildHeaders(method, endpoint, params, isPrivate);

    try {
      const response = await axios({
        method,
        url,
        params: method === 'GET' ? params : undefined,
        data: method !== 'GET' ? params : undefined,
        headers,
        timeout: 30000
      });
      
      return response.data;
    } catch (error) {
      logger.error(`${this.exchange} API error:`, error.response?.data || error.message);
      throw error;
    }
  }

  buildHeaders(method, endpoint, params, isPrivate) {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (!isPrivate) return headers;

    const timestamp = Date.now().toString();
    
    switch (this.exchange) {
      case 'binance':
        params.timestamp = timestamp;
        const queryString = Object.keys(params).map(key => `${key}=${encodeURIComponent(params[key])}`).join('&');
        params.signature = this.generateBinanceSignature(queryString);
        headers['X-MBX-APIKEY'] = this.apiKey;
        break;
        
      case 'coinbase':
        headers['CB-ACCESS-KEY'] = this.apiKey;
        headers['CB-ACCESS-SIGN'] = this.generateCoinbaseSignature(method, endpoint, params, timestamp);
        headers['CB-ACCESS-TIMESTAMP'] = timestamp;
        headers['CB-ACCESS-PASSPHRASE'] = this.passphrase;
        break;
        
      case 'kraken':
        const nonce = Date.now() * 1000;
        const paramStr = Object.keys(params).map(key => `${key}=${params[key]}`).join('&');
        headers['API-Key'] = this.apiKey;
        headers['API-Sign'] = this.generateKrakenSignature(endpoint, paramStr, nonce);
        break;
        
      case 'kucoin':
        const queryStr = Object.keys(params).map(key => `${key}=${params[key]}`).join('&');
        headers['KC-API-KEY'] = this.apiKey;
        headers['KC-API-SIGN'] = this.generateKucoinSignature(endpoint, queryStr, timestamp);
        headers['KC-API-TIMESTAMP'] = timestamp;
        headers['KC-API-PASSPHRASE'] = this.passphrase;
        break;
        
      case 'bybit':
        params.api_key = this.apiKey;
        params.timestamp = timestamp;
        params.sign = this.generateBybitSignature(params, timestamp);
        break;
        
      case 'ftx':
        headers['FTX-KEY'] = this.apiKey;
        headers['FTX-SIGN'] = this.generateFTXSignature(timestamp, method, endpoint, params);
        headers['FTX-TS'] = timestamp;
        if (this.passphrase) headers['FTX-SUBACCOUNT'] = this.passphrase;
        break;
        
      case 'gemini':
        headers['X-GEMINI-APIKEY'] = this.apiKey;
        headers['X-GEMINI-PAYLOAD'] = Buffer.from(JSON.stringify({ request: endpoint, nonce: timestamp })).toString('base64');
        headers['X-GEMINI-SIGNATURE'] = this.generateGeminiSignature(endpoint, params, timestamp);
        break;
        
      case 'bitfinex':
        headers['bfx-nonce'] = timestamp;
        headers['bfx-apikey'] = this.apiKey;
        headers['bfx-signature'] = this.generateBitfinexSignature(endpoint, params, '');
        break;
        
      case 'interactive_brokers':
        headers['Authorization'] = `Bearer ${this.apiKey}`;
        break;
        
      case 'oanda':
        headers['Authorization'] = `Bearer ${this.apiKey}`;
        headers['Accept-Datetime-Format'] = 'RFC3339';
        break;
    }

    return headers;
  }

  // Get all trading pairs
  async getTradingPairs() {
    switch (this.exchange) {
      case 'binance':
        const binanceData = await this.makeRequest('GET', '/api/v3/exchangeInfo');
        return binanceData.symbols
          .filter(s => s.status === 'TRADING')
          .map(s => ({
            symbol: s.symbol,
            base: s.baseAsset,
            quote: s.quoteAsset,
            type: 'spot'
          }));
          
      case 'coinbase':
        const coinbaseData = await this.makeRequest('GET', '/products');
        return coinbaseData.map(p => ({
          symbol: p.id,
          base: p.base_currency,
          quote: p.quote_currency,
          type: 'spot'
        }));
        
      case 'kraken':
        const krakenData = await this.makeRequest('GET', '/0/public/AssetPairs');
        return Object.entries(krakenData.result).map(([key, value]) => ({
          symbol: key,
          base: value.base,
          quote: value.quote,
          type: 'spot'
        }));
        
      case 'kucoin':
        const kucoinData = await this.makeRequest('GET', '/api/v1/symbols');
        return kucoinData.data.map(s => ({
          symbol: s.symbol,
          base: s.baseCurrency,
          quote: s.quoteCurrency,
          type: 'spot'
        }));
        
      case 'bybit':
        const bybitData = await this.makeRequest('GET', '/v5/market/instruments-info', { category: 'spot' });
        return bybitData.result.list.map(s => ({
          symbol: s.symbol,
          base: s.baseCoin,
          quote: s.quoteCoin,
          type: 'spot'
        }));
        
      case 'ftx':
        const ftxData = await this.makeRequest('GET', '/markets');
        return ftxData.result
          .filter(m => m.type === 'spot' && m.enabled)
          .map(m => ({
            symbol: m.name,
            base: m.baseCurrency,
            quote: m.quoteCurrency,
            type: 'spot'
          }));
          
      case 'gemini':
        const geminiData = await this.makeRequest('GET', '/v1/symbols');
        return geminiData.map(s => ({
          symbol: s.toUpperCase(),
          base: s.split('usd')[0].toUpperCase(),
          quote: 'USD',
          type: 'spot'
        }));
        
      case 'bitfinex':
        const bitfinexData = await this.makeRequest('GET', '/v1/symbols');
        return bitfinexData.map(s => ({
          symbol: s.toUpperCase(),
          base: s.slice(0, 3).toUpperCase(),
          quote: s.slice(3).toUpperCase(),
          type: 'spot'
        }));
        
      case 'interactive_brokers':
        // IB requires specific asset definitions
        return [
          { symbol: 'EUR.USD', base: 'EUR', quote: 'USD', type: 'forex' },
          { symbol: 'GBP.USD', base: 'GBP', quote: 'USD', type: 'forex' },
          { symbol: 'USD.JPY', base: 'USD', quote: 'JPY', type: 'forex' },
          { symbol: 'XAUUSD', base: 'XAU', quote: 'USD', type: 'commodity' },
          { symbol: 'XAGUSD', base: 'XAG', quote: 'USD', type: 'commodity' },
          { symbol: 'USOIL', base: 'USOIL', quote: 'USD', type: 'commodity' }
        ];
        
      case 'oanda':
        const oandaData = await this.makeRequest('GET', '/instruments');
        return oandaData.instruments.map(i => ({
          symbol: i.name,
          base: i.name.split('_')[0],
          quote: i.name.split('_')[1],
          type: i.type.toLowerCase()
        }));
        
      default:
        return [];
    }
  }

  // Get ticker
  async getTicker(symbol) {
    switch (this.exchange) {
      case 'binance':
        return this.makeRequest('GET', '/api/v3/ticker/24hr', { symbol });
      case 'coinbase':
        return this.makeRequest('GET', `/products/${symbol}/ticker`);
      case 'kraken':
        const krakenTicker = await this.makeRequest('GET', '/0/public/Ticker', { pair: symbol });
        return krakenTicker.result[symbol];
      case 'kucoin':
        const kucoinTicker = await this.makeRequest('GET', '/api/v1/market/orderbook/level1', { symbol });
        return kucoinTicker.data;
      case 'bybit':
        const bybitTicker = await this.makeRequest('GET', '/v5/market/tickers', { category: 'spot', symbol });
        return bybitTicker.result.list[0];
        
      case 'ftx':
        return this.makeRequest('GET', `/markets/${symbol}`);
        
      case 'gemini':
        return this.makeRequest('GET', `/v1/pubticker/${symbol.toLowerCase()}`);
        
      case 'bitfinex':
        const bitfinexTicker = await this.makeRequest('GET', `/v2/ticker/t${symbol}`);
        return {
          bid: bitfinexTicker[0],
          bidSize: bitfinexTicker[1],
          ask: bitfinexTicker[2],
          askSize: bitfinexTicker[3],
          dailyChange: bitfinexTicker[4],
          dailyChangePerc: bitfinexTicker[5],
          lastPrice: bitfinexTicker[6],
          volume: bitfinexTicker[7],
          high: bitfinexTicker[8],
          low: bitfinexTicker[9]
        };
        
      case 'interactive_brokers':
        return this.makeRequest('GET', `/iserver/marketdata/snapshot?conids=${symbol}`);
        
      case 'oanda':
        const oandaTicker = await this.makeRequest('GET', `/accounts/${this.passphrase}/pricing?instruments=${symbol}`);
        return oandaTicker.prices[0];
        
      default:
        throw new Error(`Ticker not implemented for ${this.exchange}`);
    }
  }

  // Get klines/candlestick data
  async getKlines(symbol, interval = '1h', limit = 100) {
    const intervalMap = {
      '1m': '1', '5m': '5', '15m': '15', '30m': '30',
      '1h': '60', '4h': '240', '1d': 'D', '1w': 'W'
    };

    switch (this.exchange) {
      case 'binance':
        return this.makeRequest('GET', '/api/v3/klines', { symbol, interval, limit });
        
      case 'coinbase':
        const granularity = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[interval] || 3600;
        const coinbaseCandles = await this.makeRequest('GET', `/products/${symbol}/candles`, { granularity });
        return coinbaseCandles.map(c => ({
          timestamp: c[0] * 1000,
          low: c[1],
          high: c[2],
          open: c[3],
          close: c[4],
          volume: c[5]
        }));
        
      case 'kraken':
        const krakenInterval = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 }[interval] || 60;
        const krakenCandles = await this.makeRequest('GET', '/0/public/OHLC', { pair: symbol, interval: krakenInterval });
        return krakenCandles.result[symbol].map(c => ({
          timestamp: c[0] * 1000,
          open: c[1],
          high: c[2],
          low: c[3],
          close: c[4],
          volume: c[6]
        }));
        
      case 'kucoin':
        const kucoinCandles = await this.makeRequest('GET', '/api/v1/market/candles', { 
          symbol, 
          type: intervalMap[interval] || '1hour',
          limit 
        });
        return kucoinCandles.data.map(c => ({
          timestamp: c[0],
          open: c[1],
          close: c[2],
          high: c[3],
          low: c[4],
          volume: c[5]
        }));
        
      case 'bybit':
        const bybitCandles = await this.makeRequest('GET', '/v5/market/kline', {
          category: 'spot',
          symbol,
          interval,
          limit
        });
        return bybitCandles.result.list.map(c => ({
          timestamp: parseInt(c[0]),
          open: c[1],
          high: c[2],
          low: c[3],
          close: c[4],
          volume: c[5]
        }));
        
      case 'ftx':
        const ftxResolution = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[interval] || 3600;
        const ftxCandles = await this.makeRequest('GET', `/markets/${symbol}/candles`, { resolution: ftxResolution, limit });
        return ftxCandles.result.map(c => ({
          timestamp: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        }));
        
      case 'gemini':
        const geminiCandles = await this.makeRequest('GET', `/v2/candles/${symbol.toLowerCase()}/${intervalMap[interval] || '1hr'}`);
        return geminiCandles.map(c => ({
          timestamp: c[0],
          open: c[1],
          high: c[2],
          low: c[3],
          close: c[4],
          volume: c[5]
        }));
        
      case 'bitfinex':
        const bitfinexInterval = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1D' }[interval] || '1h';
        const bitfinexCandles = await this.makeRequest('GET', `/v2/candles/trade:${bitfinexInterval}:t${symbol}/hist`, { limit });
        return bitfinexCandles.map(c => ({
          timestamp: c[0],
          open: c[1],
          close: c[2],
          high: c[3],
          low: c[4],
          volume: c[5]
        }));
        
      case 'interactive_brokers':
        // IB historical data requires specific contract IDs
        return this.makeRequest('GET', `/iserver/marketdata/history?conid=${symbol}&period=${interval}&bar=${interval}`);
        
      case 'oanda':
        const oandaGranularity = { '1m': 'M1', '5m': 'M5', '15m': 'M15', '1h': 'H1', '4h': 'H4', '1d': 'D' }[interval] || 'H1';
        const oandaCandles = await this.makeRequest('GET', `/instruments/${symbol}/candles`, { granularity: oandaGranularity, count: limit });
        return oandaCandles.candles.map(c => ({
          timestamp: new Date(c.time).getTime(),
          open: parseFloat(c.mid.o),
          high: parseFloat(c.mid.h),
          low: parseFloat(c.mid.l),
          close: parseFloat(c.mid.c),
          volume: c.volume
        }));
        
      default:
        throw new Error(`Klines not implemented for ${this.exchange}`);
    }
  }

  // Get order book
  async getOrderBook(symbol, limit = 100) {
    switch (this.exchange) {
      case 'binance':
        return this.makeRequest('GET', '/api/v3/depth', { symbol, limit });
      case 'coinbase':
        return this.makeRequest('GET', `/products/${symbol}/book`, { level: 2 });
      case 'kraken':
        return this.makeRequest('GET', '/0/public/Depth', { pair: symbol, count: limit });
      case 'kucoin':
        return this.makeRequest('GET', '/api/v1/market/orderbook/level2', { symbol, limit });
      case 'bybit':
        return this.makeRequest('GET', '/v5/market/orderbook', { category: 'spot', symbol, limit });
        
      case 'ftx':
        return this.makeRequest('GET', `/markets/${symbol}/orderbook`, { depth: limit });
        
      case 'gemini':
        return this.makeRequest('GET', `/v1/book/${symbol.toLowerCase()}`, { limit_bids: limit, limit_asks: limit });
        
      case 'bitfinex':
        return this.makeRequest('GET', `/v2/book/t${symbol}/P0`, { len: limit });
        
      case 'interactive_brokers':
        return this.makeRequest('GET', `/iserver/marketdata/snapshot?conids=${symbol}`);
        
      case 'oanda':
        return this.makeRequest('GET', `/instruments/${symbol}/orderBook`);
        
      default:
        throw new Error(`Order book not implemented for ${this.exchange}`);
    }
  }

  // Create order
  async createOrder(params) {
    const orderParams = {
      symbol: params.symbol,
      side: params.side.toUpperCase(),
      type: params.type.toUpperCase(),
      quantity: params.quantity,
      ...params
    };

    logger.info(`Creating ${this.exchange} order:`, orderParams);

    switch (this.exchange) {
      case 'binance':
        return this.makeRequest('POST', '/api/v3/order', orderParams, true);
      case 'coinbase':
        return this.makeRequest('POST', '/orders', {
          product_id: params.symbol,
          side: params.side,
          order_type: params.type,
          size: params.quantity,
          price: params.price
        }, true);
      case 'kraken':
        return this.makeRequest('POST', '/0/private/AddOrder', {
          pair: params.symbol,
          type: params.side,
          ordertype: params.type,
          volume: params.quantity,
          price: params.price
        }, true);
      case 'kucoin':
        return this.makeRequest('POST', '/api/v1/orders', {
          symbol: params.symbol,
          side: params.side,
          type: params.type,
          size: params.quantity,
          price: params.price
        }, true);
      case 'bybit':
        return this.makeRequest('POST', '/v5/order/create', {
          category: 'spot',
          symbol: params.symbol,
          side: params.side,
          orderType: params.type,
          qty: params.quantity,
          price: params.price
        }, true);
        
      case 'ftx':
        return this.makeRequest('POST', '/orders', {
          market: params.symbol,
          side: params.side.toLowerCase(),
          type: params.type.toLowerCase(),
          size: params.quantity,
          price: params.price
        }, true);
        
      case 'gemini':
        return this.makeRequest('POST', '/v1/order/new', {
          symbol: params.symbol.toLowerCase(),
          side: params.side.toLowerCase(),
          type: params.type.toLowerCase(),
          amount: params.quantity,
          price: params.price
        }, true);
        
      case 'bitfinex':
        return this.makeRequest('POST', '/v2/auth/w/order/submit', {
          symbol: `t${params.symbol}`,
          amount: params.side.toUpperCase() === 'BUY' ? params.quantity : -params.quantity,
          price: params.price,
          type: params.type.toUpperCase() === 'MARKET' ? 'MARKET' : 'LIMIT'
        }, true);
        
      case 'interactive_brokers':
        return this.makeRequest('POST', '/iserver/account/order', {
          conid: params.symbol,
          side: params.side.toUpperCase(),
          quantity: params.quantity,
          orderType: params.type.toUpperCase(),
          price: params.price
        }, true);
        
      case 'oanda':
        const oandaOrder = {
          order: {
            instrument: params.symbol,
            units: params.side.toUpperCase() === 'BUY' ? params.quantity : -params.quantity,
            type: params.type.toUpperCase(),
            price: params.price
          }
        };
        return this.makeRequest('POST', `/accounts/${this.passphrase}/orders`, oandaOrder, true);
        
      default:
        throw new Error(`Create order not implemented for ${this.exchange}`);
    }
  }

  // Get account balance
  async getAccount() {
    switch (this.exchange) {
      case 'binance':
        return this.makeRequest('GET', '/api/v3/account', {}, true);
      case 'coinbase':
        return this.makeRequest('GET', '/accounts', {}, true);
      case 'kraken':
        return this.makeRequest('POST', '/0/private/Balance', {}, true);
      case 'kucoin':
        return this.makeRequest('GET', '/api/v1/accounts', {}, true);
      case 'bybit':
        return this.makeRequest('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }, true);
        
      case 'ftx':
        return this.makeRequest('GET', '/wallet/balances', {}, true);
        
      case 'gemini':
        return this.makeRequest('POST', '/v1/balances', {}, true);
        
      case 'bitfinex':
        return this.makeRequest('POST', '/v2/auth/r/wallets', {}, true);
        
      case 'interactive_brokers':
        return this.makeRequest('GET', '/portfolio/accounts', {}, true);
        
      case 'oanda':
        return this.makeRequest('GET', `/accounts/${this.passphrase}`, {}, true);
        
      default:
        throw new Error(`Get account not implemented for ${this.exchange}`);
    }
  }

  // Cancel order
  async cancelOrder(symbol, orderId) {
    switch (this.exchange) {
      case 'binance':
        return this.makeRequest('DELETE', '/api/v3/order', { symbol, orderId }, true);
      case 'coinbase':
        return this.makeRequest('DELETE', `/orders/${orderId}`, {}, true);
      case 'kraken':
        return this.makeRequest('POST', '/0/private/CancelOrder', { txid: orderId }, true);
      case 'kucoin':
        return this.makeRequest('DELETE', `/api/v1/orders/${orderId}`, {}, true);
      case 'bybit':
        return this.makeRequest('POST', '/v5/order/cancel', { category: 'spot', symbol, orderId }, true);
        
      case 'ftx':
        return this.makeRequest('DELETE', `/orders/${orderId}`, {}, true);
        
      case 'gemini':
        return this.makeRequest('POST', '/v1/order/cancel', { order_id: orderId }, true);
        
      case 'bitfinex':
        return this.makeRequest('POST', '/v2/auth/w/order/cancel', { id: orderId }, true);
        
      case 'interactive_brokers':
        return this.makeRequest('DELETE', `/iserver/account/order/${orderId}`, {}, true);
        
      case 'oanda':
        return this.makeRequest('PUT', `/accounts/${this.passphrase}/orders/${orderId}/cancel`, {}, true);
        
      default:
        throw new Error(`Cancel order not implemented for ${this.exchange}`);
    }
  }

  // Get open orders
  async getOpenOrders(symbol) {
    const params = symbol ? { symbol } : {};
    
    switch (this.exchange) {
      case 'binance':
        return this.makeRequest('GET', '/api/v3/openOrders', params, true);
      case 'coinbase':
        return this.makeRequest('GET', '/orders', { status: 'open' }, true);
      case 'kraken':
        return this.makeRequest('POST', '/0/private/OpenOrders', {}, true);
      case 'kucoin':
        return this.makeRequest('GET', '/api/v1/orders', { status: 'active', ...params }, true);
      case 'bybit':
        return this.makeRequest('GET', '/v5/order/realtime', { category: 'spot', ...params }, true);
        
      case 'ftx':
        return this.makeRequest('GET', '/orders', { market: symbol }, true);
        
      case 'gemini':
        return this.makeRequest('POST', '/v1/orders', {}, true);
        
      case 'bitfinex':
        return this.makeRequest('POST', '/v2/auth/r/orders', {}, true);
        
      case 'interactive_brokers':
        return this.makeRequest('GET', '/iserver/account/orders', {}, true);
        
      case 'oanda':
        return this.makeRequest('GET', `/accounts/${this.passphrase}/orders`, { instrument: symbol }, true);
        
      default:
        throw new Error(`Get open orders not implemented for ${this.exchange}`);
    }
  }
}

// Factory function
export function createExchangeConnector(exchange, isTestnet = true) {
  return new MultiExchangeConnector(exchange, isTestnet);
}
