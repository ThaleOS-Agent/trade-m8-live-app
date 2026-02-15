// lib/order-management-system.js
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

class OrderManagementSystem extends EventEmitter {
  constructor() {
    super()
    this.orders = new Map() // orderId -> order
    this.positions = new Map() // symbol -> position
    this.orderBook = new Map() // symbol -> { bids: [], asks: [] }
    this.executionEngine = null
    this.riskManager = null
    this.isRunning = false
  }

  // Initialize the OMS
  async initialize(config = {}) {
    this.config = {
      maxOrdersPerSymbol: 100,
      maxPositionSize: 0.1, // 10% of portfolio
      defaultSlippage: 0.005, // 0.5%
      orderTimeout: 300000, // 5 minutes
      riskChecks: true,
      ...config
    }

    // Load existing orders and positions from database
    await this.loadFromDatabase()
    
    // Start monitoring systems
    this.startOrderMonitoring()
    this.startPositionTracking()
    
    this.isRunning = true
    this.emit('initialized')
  }

  // Create new order
  async createOrder(orderRequest) {
    try {
      // Validate order request
      const validation = await this.validateOrder(orderRequest)
      if (!validation.valid) {
        throw new Error(validation.error)
      }

      // Create order object
      const order = {
        id: uuidv4(),
        clientOrderId: orderRequest.clientOrderId || uuidv4(),
        userId: orderRequest.userId,
        strategyId: orderRequest.strategyId,
        exchange: orderRequest.exchange,
        symbol: orderRequest.symbol,
        side: orderRequest.side, // 'buy' or 'sell'
        type: orderRequest.type, // 'market', 'limit', 'stop', 'stop_limit'
        quantity: parseFloat(orderRequest.quantity),
        price: orderRequest.price ? parseFloat(orderRequest.price) : null,
        stopPrice: orderRequest.stopPrice ? parseFloat(orderRequest.stopPrice) : null,
        timeInForce: orderRequest.timeInForce || 'GTC', // GTC, IOC, FOK
        status: 'pending',
        filled: 0,
        remaining: parseFloat(orderRequest.quantity),
        avgFillPrice: 0,
        commission: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: orderRequest.expiresAt || new Date(Date.now() + this.config.orderTimeout).toISOString(),
        metadata: orderRequest.metadata || {}
      }

      // Risk checks
      if (this.config.riskChecks) {
        const riskCheck = await this.performRiskChecks(order)
        if (!riskCheck.passed) {
          throw new Error(`Risk check failed: ${riskCheck.reason}`)
        }
      }

      // Store order
      this.orders.set(order.id, order)
      await this.saveOrderToDatabase(order)

      // Submit to exchange
      await this.submitOrderToExchange(order)

      this.emit('orderCreated', order)
      return order

    } catch (error) {
      console.error('Error creating order:', error)
      throw error
    }
  }

  // Cancel order
  async cancelOrder(orderId, reason = 'User requested') {
    try {
      const order = this.orders.get(orderId)
      if (!order) {
        throw new Error('Order not found')
      }

      if (!['pending', 'partially_filled'].includes(order.status)) {
        throw new Error('Order cannot be cancelled')
      }

      // Cancel on exchange
      await this.cancelOrderOnExchange(order)

      // Update order status
      order.status = 'cancelled'
      order.cancelReason = reason
      order.updatedAt = new Date().toISOString()

      await this.updateOrderInDatabase(order)

      this.emit('orderCancelled', order)
      return order

    } catch (error) {
      console.error('Error cancelling order:', error)
      throw error
    }
  }

  // Cancel all orders for a symbol
  async cancelAllOrders(symbol = null, userId = null) {
    const ordersToCancel = []

    for (const order of this.orders.values()) {
      if (symbol && order.symbol !== symbol) continue
      if (userId && order.userId !== userId) continue
      if (!['pending', 'partially_filled'].includes(order.status)) continue

      ordersToCancel.push(order)
    }

    const results = await Promise.allSettled(
      ordersToCancel.map(order => this.cancelOrder(order.id, 'Bulk cancellation'))
    )

    const cancelled = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    this.emit('bulkCancellation', { cancelled, failed, total: ordersToCancel.length })

    return { cancelled, failed, total: ordersToCancel.length }
  }

  // Process order execution update
  async processExecution(execution) {
    try {
      const order = this.orders.get(execution.orderId)
      if (!order) {
        console.warn('Received execution for unknown order:', execution.orderId)
        return
      }

      const prevFilled = order.filled
      const fillQuantity = parseFloat(execution.quantity)
      const fillPrice = parseFloat(execution.price)
      const commission = parseFloat(execution.commission || 0)

      // Update order
      order.filled += fillQuantity
      order.remaining = Math.max(0, order.quantity - order.filled)
      order.avgFillPrice = ((order.avgFillPrice * prevFilled) + (fillPrice * fillQuantity)) / order.filled
      order.commission += commission
      order.updatedAt = new Date().toISOString()

      // Update status
      if (order.remaining === 0) {
        order.status = 'filled'
      } else if (order.filled > 0) {
        order.status = 'partially_filled'
      }

      // Update position
      await this.updatePosition(order.symbol, order.side, fillQuantity, fillPrice, order.userId)

      // Save to database
      await this.updateOrderInDatabase(order)
      await this.saveExecutionToDatabase(execution, order)

      this.emit('orderExecuted', { order, execution })

      // Check if position should be closed
      await this.checkPositionLimits(order.symbol, order.userId)

    } catch (error) {
      console.error('Error processing execution:', error)
    }
  }

  // Update position
  async updatePosition(symbol, side, quantity, price, userId) {
    const positionKey = `${userId}:${symbol}`
    let position = this.positions.get(positionKey)

    if (!position) {
      position = {
        userId,
        symbol,
        quantity: 0,
        averagePrice: 0,
        unrealizedPnL: 0,
        realizedPnL: 0,
        commission: 0,
        openTime: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }

    const isOpening = (side === 'buy' && position.quantity >= 0) || (side === 'sell' && position.quantity <= 0)
    const multiplier = side === 'buy' ? 1 : -1

    if (isOpening) {
      // Opening or increasing position
      const newQuantity = position.quantity + (quantity * multiplier)
      position.averagePrice = ((position.averagePrice * Math.abs(position.quantity)) + (price * quantity)) / Math.abs(newQuantity)
      position.quantity = newQuantity
    } else {
      // Closing or reducing position
      const closingQuantity = Math.min(quantity, Math.abs(position.quantity))
      const realizedPnL = (price - position.averagePrice) * closingQuantity * (position.quantity > 0 ? 1 : -1)
      
      position.realizedPnL += realizedPnL
      position.quantity += quantity * multiplier

      // If position is fully closed, reset average price
      if (position.quantity === 0) {
        position.averagePrice = 0
      }
    }

    position.updatedAt = new Date().toISOString()
    this.positions.set(positionKey, position)

    await this.savePositionToDatabase(position)
    this.emit('positionUpdated', position)

    return position
  }

  // Get current positions
  getCurrentPositions(userId = null) {
    const positions = []
    for (const position of this.positions.values()) {
      if (userId && position.userId !== userId) continue
      if (Math.abs(position.quantity) > 0.00001) { // Filter out dust positions
        positions.push(position)
      }
    }
    return positions
  }

  // Get orders by status
  getOrdersByStatus(status, userId = null) {
    const orders = []
    for (const order of this.orders.values()) {
      if (userId && order.userId !== userId) continue
      if (status === 'all' || order.status === status) {
        orders.push(order)
      }
    }
    return orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }

  // Validate order
  async validateOrder(orderRequest) {
    // Required fields
    const required = ['userId', 'exchange', 'symbol', 'side', 'type', 'quantity']
    for (const field of required) {
      if (!orderRequest[field]) {
        return { valid: false, error: `Missing required field: ${field}` }
      }
    }

    // Validate side
    if (!['buy', 'sell'].includes(orderRequest.side)) {
      return { valid: false, error: 'Invalid side. Must be buy or sell' }
    }

    // Validate type
    if (!['market', 'limit', 'stop', 'stop_limit'].includes(orderRequest.type)) {
      return { valid: false, error: 'Invalid order type' }
    }

    // Validate quantity
    if (parseFloat(orderRequest.quantity) <= 0) {
      return { valid: false, error: 'Quantity must be positive' }
    }

    // Validate price for limit orders
    if (['limit', 'stop_limit'].includes(orderRequest.type) && !orderRequest.price) {
      return { valid: false, error: 'Price required for limit orders' }
    }

    // Validate stop price for stop orders
    if (['stop', 'stop_limit'].includes(orderRequest.type) && !orderRequest.stopPrice) {
      return { valid: false, error: 'Stop price required for stop orders' }
    }

    // Check order count limit
    const userOrders = this.getOrdersByStatus('all', orderRequest.userId)
    const symbolOrders = userOrders.filter(o => o.symbol === orderRequest.symbol)
    if (symbolOrders.length >= this.config.maxOrdersPerSymbol) {
      return { valid: false, error: 'Maximum orders per symbol exceeded' }
    }

    return { valid: true }
  }

  // Perform risk checks
  async performRiskChecks(order) {
    try {
      // Position size check
      const position = this.positions.get(`${order.userId}:${order.symbol}`)
      const currentQuantity = position ? Math.abs(position.quantity) : 0
      const newQuantity = currentQuantity + order.quantity
      
      // Get user's portfolio value for position sizing
      const portfolioValue = await this.getUserPortfolioValue(order.userId)
      const orderValue = order.quantity * (order.price || await this.getMarketPrice(order.symbol))
      const positionSizeRatio = orderValue / portfolioValue

      if (positionSizeRatio > this.config.maxPositionSize) {
        return {
          passed: false,
          reason: `Position size ${(positionSizeRatio * 100).toFixed(1)}% exceeds limit ${(this.config.maxPositionSize * 100).toFixed(1)}%`
        }
      }

      // Daily loss limit check
      const dailyPnL = await this.getDailyPnL(order.userId)
      const maxDailyLoss = portfolioValue * -0.02 // 2% max daily loss
      if (dailyPnL < maxDailyLoss) {
        return {
          passed: false,
          reason: 'Daily loss limit exceeded'
        }
      }

      // Margin/balance check
      const hasInsufficientBalance = await this.checkBalance(order)
      if (hasInsufficientBalance) {
        return {
          passed: false,
          reason: 'Insufficient balance for order'
        }
      }

      return { passed: true }

    } catch (error) {
      console.error('Risk check error:', error)
      return { passed: false, reason: 'Risk check system error' }
    }
  }

  // Submit order to exchange
  async submitOrderToExchange(order) {
    try {
      // This would integrate with actual exchange APIs
      // For now, simulate order submission
      
      const exchangeConfig = this.getExchangeConfig(order.exchange)
      const orderData = this.formatOrderForExchange(order, exchangeConfig)

      // Simulate API call
      if (order.type === 'market') {
        // Market orders execute immediately
        setTimeout(() => {
          this.simulateExecution(order)
        }, 1000 + Math.random() * 2000)
      } else {
        // Limit orders wait for price
        order.status = 'pending'
        this.startOrderMonitoring(order)
      }

      order.exchangeOrderId = `${order.exchange}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      order.status = order.type === 'market' ? 'submitted' : 'pending'

    } catch (error) {
      order.status = 'rejected'
      order.rejectReason = error.message
      throw error
    }
  }

  // Cancel order on exchange
  async cancelOrderOnExchange(order) {
    // Simulate exchange cancellation
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ cancelled: true })
      }, 500 + Math.random() * 1000)
    })
  }

  // Simulate order execution (for demo purposes)
  simulateExecution(order) {
    const execution = {
      orderId: order.id,
      exchangeOrderId: order.exchangeOrderId,
      executionId: uuidv4(),
      quantity: order.quantity,
      price: order.price || (40000 + Math.random() * 10000), // Simulate market price
      commission: order.quantity * 0.001, // 0.1% commission
      timestamp: new Date().toISOString()
    }

    this.processExecution(execution)
  }

  // Start order monitoring
  startOrderMonitoring() {
    this.orderMonitorInterval = setInterval(() => {
      this.checkOrderTimeouts()
      this.checkStopOrders()
    }, 5000)
  }

  // Check for order timeouts
  checkOrderTimeouts() {
    const now = new Date()
    for (const order of this.orders.values()) {
      if (order.status === 'pending' && new Date(order.expiresAt) < now) {
        this.cancelOrder(order.id, 'Order timeout')
      }
    }
  }

  // Check stop orders
  async checkStopOrders() {
    for (const order of this.orders.values()) {
      if (order.status === 'pending' && ['stop', 'stop_limit'].includes(order.type)) {
        const currentPrice = await this.getMarketPrice(order.symbol)
        
        const shouldTrigger = (order.side === 'buy' && currentPrice >= order.stopPrice) ||
                             (order.side === 'sell' && currentPrice <= order.stopPrice)

        if (shouldTrigger) {
          if (order.type === 'stop') {
            // Convert to market order
            order.type = 'market'
            order.price = null
            await this.submitOrderToExchange(order)
          } else {
            // Convert to limit order
            order.type = 'limit'
            await this.submitOrderToExchange(order)
          }
        }
      }
    }
  }

  // Start position tracking
  startPositionTracking() {
    this.positionTrackInterval = setInterval(() => {
      this.updateUnrealizedPnL()
    }, 10000)
  }

  // Update unrealized P&L for all positions
  async updateUnrealizedPnL() {
    for (const position of this.positions.values()) {
      if (Math.abs(position.quantity) > 0.00001) {
        const currentPrice = await this.getMarketPrice(position.symbol)
        const unrealizedPnL = (currentPrice - position.averagePrice) * position.quantity
        
        if (Math.abs(unrealizedPnL - position.unrealizedPnL) > 0.01) {
          position.unrealizedPnL = unrealizedPnL
          position.updatedAt = new Date().toISOString()
          
          this.emit('positionPnLUpdated', position)
        }
      }
    }
  }

  // Database operations
  async loadFromDatabase() {
    try {
      // Load orders
      const { data: orders } = await supabase
        .from('live_trades')
        .select('*')
        .in('status', ['pending', 'partially_filled'])

      if (orders) {
        orders.forEach(order => {
          this.orders.set(order.id, order)
        })
      }

      // Load positions
      const { data: positions } = await supabase
        .from('positions')
        .select('*')
        .neq('quantity', 0)

      if (positions) {
        positions.forEach(position => {
          this.positions.set(`${position.user_id}:${position.symbol}`, position)
        })
      }

    } catch (error) {
      console.error('Error loading from database:', error)
    }
  }

  async saveOrderToDatabase(order) {
    const { error } = await supabase
      .from('live_trades')
      .insert([{
        id: order.id,
        user_id: order.userId,
        strategy_id: order.strategyId,
        exchange: order.exchange,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        price: order.price,
        stop_price: order.stopPrice,
        status: order.status,
        filled: order.filled,
        avg_fill_price: order.avgFillPrice,
        commission: order.commission,
        created_at: order.createdAt,
        metadata: order.metadata
      }])

    if (error) {
      console.error('Error saving order to database:', error)
    }
  }

  async updateOrderInDatabase(order) {
    const { error } = await supabase
      .from('live_trades')
      .update({
        status: order.status,
        filled: order.filled,
        remaining: order.remaining,
        avg_fill_price: order.avgFillPrice,
        commission: order.commission,
        updated_at: order.updatedAt,
        cancel_reason: order.cancelReason
      })
      .eq('id', order.id)

    if (error) {
      console.error('Error updating order in database:', error)
    }
  }

  async savePositionToDatabase(position) {
    const { error } = await supabase
      .from('positions')
      .upsert([{
        user_id: position.userId,
        symbol: position.symbol,
        quantity: position.quantity,
        average_price: position.averagePrice,
        unrealized_pnl: position.unrealizedPnL,
        realized_pnl: position.realizedPnL,
        commission: position.commission,
        updated_at: position.updatedAt
      }])

    if (error) {
      console.error('Error saving position to database:', error)
    }
  }

  async saveExecutionToDatabase(execution, order) {
    const { error } = await supabase
      .from('executions')
      .insert([{
        id: execution.executionId,
        order_id: execution.orderId,
        user_id: order.userId,
        symbol: order.symbol,
        side: order.side,
        quantity: execution.quantity,
        price: execution.price,
        commission: execution.commission,
        timestamp: execution.timestamp
      }])

    if (error) {
      console.error('Error saving execution to database:', error)
    }
  }

  // Utility methods
  async getMarketPrice(symbol) {
    // This would integrate with market data feed
    // For simulation, return a random price
    return 40000 + Math.random() * 10000
  }

  async getUserPortfolioValue(userId) {
    // Calculate total portfolio value
    // This would integrate with portfolio service
    return 100000 // Simulated value
  }

  async getDailyPnL(userId) {
    // Calculate today's P&L
    return 0 // Simulated value
  }

  async checkBalance(order) {
    // Check if user has sufficient balance
    return false // Simulated - assume sufficient balance
  }

  getExchangeConfig(exchange) {
    // Return exchange-specific configuration
    return {
      name: exchange,
      baseUrl: `https://api.${exchange}.com`,
      orderEndpoint: '/orders',
      cancelEndpoint: '/orders/cancel'
    }
  }

  formatOrderForExchange(order, config) {
    // Format order for specific exchange API
    return {
      symbol: order.symbol.replace('/', ''),
      side: order.side.toUpperCase(),
      type: order.type.toUpperCase(),
      quantity: order.quantity.toString(),
      price: order.price?.toString(),
      timeInForce: order.timeInForce
    }
  }

  async checkPositionLimits(symbol, userId) {
    // Check if position exceeds limits and needs to be closed
    const position = this.positions.get(`${userId}:${symbol}`)
    if (!position) return

    const portfolioValue = await this.getUserPortfolioValue(userId)
    const positionValue = Math.abs(position.quantity * position.averagePrice)
    const positionRatio = positionValue / portfolioValue

    if (positionRatio > this.config.maxPositionSize * 1.1) { // 10% buffer
      // Auto-close position
      const closeOrder = {
        userId,
        exchange: 'binance', // Default exchange
        symbol,
        side: position.quantity > 0 ? 'sell' : 'buy',
        type: 'market',
        quantity: Math.abs(position.quantity),
        metadata: { autoClose: true, reason: 'Position limit exceeded' }
      }

      await this.createOrder(closeOrder)
    }
  }

  // Cleanup
  async stop() {
    this.isRunning = false
    
    if (this.orderMonitorInterval) {
      clearInterval(this.orderMonitorInterval)
    }
    
    if (this.positionTrackInterval) {
      clearInterval(this.positionTrackInterval)
    }

    this.emit('stopped')
  }
}

// Export singleton instance
export const orderManagementSystem = new OrderManagementSystem()

// Export the class for testing
export { OrderManagementSystem }