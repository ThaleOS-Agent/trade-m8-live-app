// lib/market-data-feed.js
import { EventEmitter } from 'events'
import { WebSocket } from 'ws'

class MarketDataFeed extends EventEmitter {
  constructor(config = {}) {
    super()
    this.config = {
      exchanges: ['binance', 'uniswap', 'coinbase'],
      symbols: ['BTC/USDT', 'ETH/USDT', 'BNB/USDT'],
      updateInterval: 1000,
      reconnectDelay: 5000,
      maxReconnectAttempts: 10,
      ...config
    }
    
    this.connections = new Map()
    this.subscriptions = new Map()
    this.reconnectAttempts = new Map()
    this.isRunning = false
    this.lastPrices = new Map()
    this.priceHistory = new Map()
  }

  // Start the market data feed
  async start() {
    if (this.isRunning) return
    
    this.isRunning = true
    console.log('🚀 Starting market data feed...')
    
    // Initialize connections for each exchange
    for (const exchange of this.config.exchanges) {
      await this.connectToExchange(exchange)
    }
    
    // Start price aggregation and broadcasting
    this.startPriceAggregation()
    
    this.emit('started')
  }

  // Stop the market data feed
  async stop() {
    if (!this.isRunning) return
    
    this.isRunning = false
    console.log('🛑 Stopping market data feed...')
    
    // Close all connections
    for (const [exchange, connection] of this.connections) {
      if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.close()
      }
    }
    
    this.connections.clear()
    this.subscriptions.clear()
    
    this.emit('stopped')
  }

  // Connect to specific exchange
  async connectToExchange(exchange) {
    try {
      const connectionConfig = this.getExchangeConfig(exchange)
      const ws = new WebSocket(connectionConfig.wsUrl)
      
      const connection = {
        ws,
        exchange,
        lastHeartbeat: Date.now(),
        subscribed: false
      }
      
      ws.on('open', () => {
        console.log(`✅ Connected to ${exchange}`)
        this.onConnectionOpen(exchange, connection)
      })
      
      ws.on('message', (data) => {
        this.onMessage(exchange, data)
      })
      
      ws.on('close', () => {
        console.log(`❌ Disconnected from ${exchange}`)
        this.onConnectionClose(exchange)
      })
      
      ws.on('error', (error) => {
        console.error(`💥 ${exchange} connection error:`, error)
        this.onConnectionError(exchange, error)
      })
      
      this.connections.set(exchange, connection)
      
    } catch (error) {
      console.error(`Failed to connect to ${exchange}:`, error)
      this.scheduleReconnect(exchange)
    }
  }

  // Handle connection open
  onConnectionOpen(exchange, connection) {
    this.reconnectAttempts.set(exchange, 0)
    this.subscribeToSymbols(exchange, connection)
  }

  // Subscribe to symbols on exchange
  subscribeToSymbols(exchange, connection) {
    const config = this.getExchangeConfig(exchange)
    const symbols = this.config.symbols.filter(symbol => 
      config.supportedSymbols.includes(symbol)
    )
    
    const subscriptionMessage = config.createSubscription(symbols)
    
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(JSON.stringify(subscriptionMessage))
      connection.subscribed = true
      
      console.log(`📊 Subscribed to ${symbols.length} symbols on ${exchange}`)
    }
  }

  // Handle incoming messages
  onMessage(exchange, data) {
    try {
      const message = JSON.parse(data.toString())
      const config = this.getExchangeConfig(exchange)
      
      // Update heartbeat
      const connection = this.connections.get(exchange)
      if (connection) {
        connection.lastHeartbeat = Date.now()
      }
      
      // Parse price data
      const priceData = config.parseMessage(message)
      if (priceData) {
        this.updatePrice(exchange, priceData)
      }
      
    } catch (error) {
      console.error(`Error parsing message from ${exchange}:`, error)
    }
  }

  // Update price data
  updatePrice(exchange, priceData) {
    const { symbol, price, volume, timestamp } = priceData
    const key = `${exchange}:${symbol}`
    
    // Store current price
    this.lastPrices.set(key, {
      exchange,
      symbol,
      price: parseFloat(price),
      volume: parseFloat(volume || 0),
      timestamp: timestamp || Date.now(),
      change24h: this.calculate24hChange(key, price)
    })
    
    // Update price history
    this.updatePriceHistory(key, price, timestamp)
    
    // Emit price update
    this.emit('priceUpdate', {
      exchange,
      symbol,
      price: parseFloat(price),
      volume: parseFloat(volume || 0),
      timestamp: timestamp || Date.now()
    })
  }

  // Calculate 24h change
  calculate24hChange(key, currentPrice) {
    const history = this.priceHistory.get(key) || []
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    
    // Find price from 24h ago
    const oldPrice = history.find(h => h.timestamp <= dayAgo)
    if (!oldPrice) return 0
    
    return ((currentPrice - oldPrice.price) / oldPrice.price) * 100
  }

  // Update price history
  updatePriceHistory(key, price, timestamp) {
    if (!this.priceHistory.has(key)) {
      this.priceHistory.set(key, [])
    }
    
    const history = this.priceHistory.get(key)
    history.push({ price: parseFloat(price), timestamp: timestamp || Date.now() })
    
    // Keep only last 24 hours of data
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    this.priceHistory.set(key, history.filter(h => h.timestamp > dayAgo))
  }

  // Handle connection close
  onConnectionClose(exchange) {
    this.connections.delete(exchange)
    if (this.isRunning) {
      this.scheduleReconnect(exchange)
    }
  }

  // Handle connection error
  onConnectionError(exchange, error) {
    console.error(`${exchange} error:`, error)
    if (this.isRunning) {
      this.scheduleReconnect(exchange)
    }
  }

  // Schedule reconnection
  scheduleReconnect(exchange) {
    const attempts = this.reconnectAttempts.get(exchange) || 0
    
    if (attempts >= this.config.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts reached for ${exchange}`)
      this.emit('maxReconnectAttemptsReached', exchange)
      return
    }
    
    this.reconnectAttempts.set(exchange, attempts + 1)
    
    const delay = this.config.reconnectDelay * Math.pow(2, attempts) // Exponential backoff
    console.log(`🔄 Reconnecting to ${exchange} in ${delay}ms (attempt ${attempts + 1})`)
    
    setTimeout(() => {
      if (this.isRunning) {
        this.connectToExchange(exchange)
      }
    }, delay)
  }

  // Start price aggregation
  startPriceAggregation() {
    this.aggregationInterval = setInterval(() => {
      this.aggregateAndBroadcast()
    }, this.config.updateInterval)
  }

  // Aggregate prices from all exchanges
  aggregateAndBroadcast() {
    const aggregatedPrices = new Map()
    
    // Group prices by symbol
    for (const [key, priceData] of this.lastPrices) {
      const { symbol, price, volume, timestamp } = priceData
      
      if (!aggregatedPrices.has(symbol)) {
        aggregatedPrices.set(symbol, {
          symbol,
          prices: [],
          totalVolume: 0,
          lastUpdate: 0
        })
      }
      
      const aggregated = aggregatedPrices.get(symbol)
      aggregated.prices.push({ price, volume, exchange: priceData.exchange })
      aggregated.totalVolume += volume
      aggregated.lastUpdate = Math.max(aggregated.lastUpdate, timestamp)
    }
    
    // Calculate weighted average prices
    const finalPrices = {}
    for (const [symbol, data] of aggregatedPrices) {
      if (data.prices.length === 0) continue
      
      // Volume-weighted average price
      const totalVolumePrice = data.prices.reduce((sum, p) => sum + (p.price * p.volume), 0)
      const vwap = data.totalVolume > 0 ? totalVolumePrice / data.totalVolume : 
                   data.prices.reduce((sum, p) => sum + p.price, 0) / data.prices.length
      
      finalPrices[symbol] = {
        symbol,
        price: vwap,
        volume: data.totalVolume,
        exchanges: data.prices.length,
        timestamp: data.lastUpdate,
        spread: this.calculateSpread(data.prices),
        individual: data.prices
      }
    }
    
    // Broadcast aggregated prices
    this.emit('aggregatedPrices', finalPrices)
  }

  // Calculate price spread across exchanges
  calculateSpread(prices) {
    if (prices.length < 2) return 0
    
    const sortedPrices = prices.map(p => p.price).sort((a, b) => a - b)
    const min = sortedPrices[0]
    const max = sortedPrices[sortedPrices.length - 1]
    
    return ((max - min) / min) * 100
  }

  // Get exchange configuration
  getExchangeConfig(exchange) {
    const configs = {
      binance: {
        wsUrl: 'wss://stream.binance.com:9443/ws/!ticker@arr',
        supportedSymbols: ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'ADA/USDT'],
        createSubscription: (symbols) => ({
          method: 'SUBSCRIBE',
          params: symbols.map(s => s.replace('/', '').toLowerCase() + '@ticker'),
          id: Date.now()
        }),
        parseMessage: (msg) => {
          if (Array.isArray(msg)) {
            return msg.map(ticker => ({
              symbol: (ticker.s || '').replace(/(.+)USDT/, '$1/USDT'),
              price: ticker.c,
              volume: ticker.v,
              timestamp: Date.now()
            }))
          } else if (msg.s && msg.c) {
            return {
              symbol: msg.s.replace(/(.+)USDT/, '$1/USDT'),
              price: msg.c,
              volume: msg.v,
              timestamp: Date.now()
            }
          }
          return null
        }
      },
      
      coinbase: {
        wsUrl: 'wss://ws-feed.exchange.coinbase.com',
        supportedSymbols: ['BTC/USD', 'ETH/USD', 'BTC/USDT', 'ETH/USDT'],
        createSubscription: (symbols) => ({
          type: 'subscribe',
          channels: [{
            name: 'ticker',
            product_ids: symbols.map(s => s.replace('/', '-'))
          }]
        }),
        parseMessage: (msg) => {
          if (msg.type === 'ticker' && msg.product_id && msg.price) {
            return {
              symbol: msg.product_id.replace('-', '/'),
              price: msg.price,
              volume: msg.volume_24h,
              timestamp: new Date(msg.time).getTime()
            }
          }
          return null
        }
      },
      
      uniswap: {
        wsUrl: 'wss://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3',
        supportedSymbols: ['ETH/USDC', 'WBTC/USDC', 'UNI/USDC'],
        createSubscription: (symbols) => ({
          type: 'start',
          payload: {
            query: `
              subscription {
                pools(where: {id_in: ["0x..."]}) {
                  id
                  token0Price
                  token1Price
                  volumeUSD
                  liquidity
                }
              }
            `
          }
        }),
        parseMessage: (msg) => {
          // GraphQL subscription parsing would go here
          return null
        }
      }
    }
    
    return configs[exchange]
  }

  // Get current prices
  getCurrentPrices() {
    const prices = {}
    for (const [key, priceData] of this.lastPrices) {
      prices[key] = priceData
    }
    return prices
  }

  // Get price for specific symbol
  getPrice(symbol, exchange = null) {
    if (exchange) {
      return this.lastPrices.get(`${exchange}:${symbol}`)
    }
    
    // Return best price across all exchanges
    const symbolPrices = []
    for (const [key, priceData] of this.lastPrices) {
      if (priceData.symbol === symbol) {
        symbolPrices.push(priceData)
      }
    }
    
    if (symbolPrices.length === 0) return null
    
    // Return most recent price
    return symbolPrices.reduce((latest, current) => 
      current.timestamp > latest.timestamp ? current : latest
    )
  }

  // Add symbol to feed
  addSymbol(symbol, exchanges = null) {
    if (!this.config.symbols.includes(symbol)) {
      this.config.symbols.push(symbol)
      
      // Resubscribe to affected exchanges
      const targetExchanges = exchanges || this.config.exchanges
      for (const exchange of targetExchanges) {
        const connection = this.connections.get(exchange)
        if (connection && connection.subscribed) {
          this.subscribeToSymbols(exchange, connection)
        }
      }
    }
  }

  // Remove symbol from feed
  removeSymbol(symbol) {
    const index = this.config.symbols.indexOf(symbol)
    if (index > -1) {
      this.config.symbols.splice(index, 1)
      
      // Remove from price cache
      for (const [key] of this.lastPrices) {
        if (key.includes(symbol)) {
          this.lastPrices.delete(key)
          this.priceHistory.delete(key)
        }
      }
    }
  }

  // Get connection status
  getConnectionStatus() {
    const status = {}
    for (const [exchange, connection] of this.connections) {
      status[exchange] = {
        connected: connection.ws.readyState === WebSocket.OPEN,
        subscribed: connection.subscribed,
        lastHeartbeat: connection.lastHeartbeat,
        reconnectAttempts: this.reconnectAttempts.get(exchange) || 0
      }
    }
    return status
  }
}

// Export singleton instance
export const marketDataFeed = new MarketDataFeed()

