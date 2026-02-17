-- Enhanced Database Schema for Trade M8
-- Supports advanced risk management, AI enhancement, multi-exchange, and portfolio management

-- ============================================================================
-- CORE TABLES (Enhanced)
-- ============================================================================

-- Users table (existing, add new columns)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME,
  -- New columns
  initial_capital REAL DEFAULT 10000.0,
  current_capital REAL DEFAULT 10000.0,
  risk_profile TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'aggressive'
  ai_enabled BOOLEAN DEFAULT 1,
  preferred_exchanges TEXT, -- JSON array of exchange IDs
  settings TEXT -- JSON object for user preferences
);

-- Trading bots table (enhanced)
CREATE TABLE IF NOT EXISTS trading_bots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  strategy TEXT NOT NULL,
  exchange TEXT NOT NULL,
  status TEXT DEFAULT 'inactive', -- 'active', 'inactive', 'paused', 'error'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- New columns
  ai_enhanced BOOLEAN DEFAULT 1,
  risk_level TEXT DEFAULT 'medium',
  initial_capital REAL DEFAULT 1000.0,
  current_capital REAL DEFAULT 1000.0,
  max_position_size REAL DEFAULT 0.10,
  max_drawdown REAL DEFAULT 0.10,
  target_win_rate REAL DEFAULT 90.0,
  target_daily_roi REAL DEFAULT 15.0,
  config TEXT, -- JSON configuration
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============================================================================
-- RISK MANAGEMENT TABLES
-- ============================================================================

-- Risk assessments table
CREATE TABLE IF NOT EXISTS risk_assessments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  assessment_type TEXT NOT NULL, -- 'pre_trade', 'position', 'portfolio'
  symbol TEXT,
  risk_score REAL NOT NULL,
  risk_level TEXT NOT NULL, -- 'low', 'medium', 'high', 'critical'
  approved BOOLEAN NOT NULL,
  var_1d REAL,
  var_5d REAL,
  expected_shortfall REAL,
  correlation_risk REAL,
  liquidity_risk REAL,
  volatility REAL,
  warnings TEXT, -- JSON array
  blockers TEXT, -- JSON array
  recommendations TEXT, -- JSON array
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
);

-- Risk metrics history
CREATE TABLE IF NOT EXISTS risk_metrics_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  metric_type TEXT NOT NULL, -- 'position_size', 'correlation', 'drawdown', etc.
  current_value REAL NOT NULL,
  limit_value REAL NOT NULL,
  level TEXT NOT NULL,
  description TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
);

-- Risk alerts
CREATE TABLE IF NOT EXISTS risk_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  alert_type TEXT NOT NULL, -- 'emergency_stop', 'risk_off', 'var_breach', etc.
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  acknowledged BOOLEAN DEFAULT 0,
  acknowledged_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
);

-- ============================================================================
-- AI ENHANCEMENT TABLES
-- ============================================================================

-- AI predictions
CREATE TABLE IF NOT EXISTS ai_predictions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  symbol TEXT NOT NULL,
  predicted_direction TEXT NOT NULL, -- 'bullish', 'bearish', 'neutral'
  confidence REAL NOT NULL,
  win_rate_prediction REAL NOT NULL,
  expected_return REAL NOT NULL,
  time_horizon TEXT NOT NULL,
  technical_score REAL,
  fundamental_score REAL,
  sentiment_score REAL,
  momentum_score REAL,
  reasoning TEXT, -- JSON array
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
);

-- Fusion predictions
CREATE TABLE IF NOT EXISTS fusion_predictions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL, -- 'buy', 'sell', 'hold'
  confidence REAL NOT NULL,
  fusion_score REAL NOT NULL,
  price_action_score REAL,
  volume_profile_score REAL,
  market_structure_score REAL,
  sentiment_score REAL,
  news_score REAL,
  prediction_direction TEXT, -- 'up', 'down', 'sideways'
  prediction_magnitude REAL,
  prediction_probability REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
);

-- Sentiment data
CREATE TABLE IF NOT EXISTS sentiment_data (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  overall_sentiment REAL NOT NULL, -- -1 to 1
  sentiment_score REAL NOT NULL, -- 0 to 100
  news_sentiment REAL,
  social_sentiment REAL,
  market_sentiment REAL,
  bullish_percent REAL,
  bearish_percent REAL,
  neutral_percent REAL,
  top_headlines TEXT, -- JSON array
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Enhanced signals
CREATE TABLE IF NOT EXISTS enhanced_signals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  symbol TEXT NOT NULL,
  base_signal TEXT NOT NULL,
  enhanced_signal TEXT NOT NULL,
  base_confidence REAL NOT NULL,
  enhanced_confidence REAL NOT NULL,
  ai_contribution REAL NOT NULL,
  fusion_score REAL,
  sentiment_score REAL,
  reasoning TEXT, -- JSON array
  ai_prediction TEXT,
  ai_confidence REAL,
  win_rate_prediction REAL,
  expected_return REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
);

-- ============================================================================
-- EXECUTION TABLES
-- ============================================================================

-- Trades table (enhanced)
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL, -- 'buy', 'sell'
  type TEXT NOT NULL, -- 'market', 'limit', 'stop_loss', 'take_profit'
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  pnl REAL,
  pnl_percent REAL,
  fees REAL NOT NULL DEFAULT 0,
  exchange TEXT NOT NULL,
  exchange_order_id TEXT,
  strategy TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- 'open', 'closed', 'cancelled'
  stop_loss REAL,
  take_profit REAL,
  opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME,
  -- New columns
  enhanced_by_ai BOOLEAN DEFAULT 0,
  ai_confidence REAL,
  risk_score REAL,
  execution_time_ms INTEGER,
  slippage REAL,
  tx_hash TEXT,
  block_number INTEGER,
  gas_used INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
);

-- Execution results
CREATE TABLE IF NOT EXISTS execution_results (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL,
  exchange TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  executed_amount REAL,
  executed_price REAL,
  total_cost REAL,
  fees REAL,
  tx_hash TEXT,
  block_number INTEGER,
  gas_used INTEGER,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trade_id) REFERENCES trades(id)
);

-- Arbitrage opportunities
CREATE TABLE IF NOT EXISTS arbitrage_opportunities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  buy_exchange TEXT NOT NULL,
  sell_exchange TEXT NOT NULL,
  buy_price REAL NOT NULL,
  sell_price REAL NOT NULL,
  spread REAL NOT NULL,
  spread_percent REAL NOT NULL,
  profit_potential REAL NOT NULL,
  feasible BOOLEAN NOT NULL,
  reason TEXT,
  executed BOOLEAN DEFAULT 0,
  execution_result TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Price quotes
CREATE TABLE IF NOT EXISTS price_quotes (
  id TEXT PRIMARY KEY,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  bid_price REAL NOT NULL,
  ask_price REAL NOT NULL,
  mid_price REAL NOT NULL,
  volume_24h REAL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- PORTFOLIO TABLES
-- ============================================================================

-- Positions table (enhanced)
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL, -- 'long', 'short'
  entry_price REAL NOT NULL,
  current_price REAL NOT NULL,
  quantity REAL NOT NULL,
  value REAL NOT NULL,
  pnl REAL NOT NULL,
  pnl_percent REAL NOT NULL,
  stop_loss REAL,
  take_profit REAL,
  entry_time DATETIME NOT NULL,
  exchange TEXT NOT NULL,
  strategy TEXT,
  opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
);

-- Portfolio snapshots
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  total_value REAL NOT NULL,
  cash_balance REAL NOT NULL,
  invested_capital REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  realized_pnl REAL NOT NULL,
  total_pnl REAL NOT NULL,
  positions_count INTEGER NOT NULL,
  exposure_percent REAL NOT NULL,
  drawdown REAL NOT NULL,
  sharpe_ratio REAL,
  sortino_ratio REAL,
  win_rate REAL,
  profit_factor REAL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
);

-- Performance metrics
CREATE TABLE IF NOT EXISTS performance_metrics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  total_trades INTEGER NOT NULL,
  winning_trades INTEGER NOT NULL,
  losing_trades INTEGER NOT NULL,
  win_rate REAL NOT NULL,
  avg_win REAL NOT NULL,
  avg_loss REAL NOT NULL,
  largest_win REAL NOT NULL,
  largest_loss REAL NOT NULL,
  profit_factor REAL NOT NULL,
  sharpe_ratio REAL NOT NULL,
  sortino_ratio REAL NOT NULL,
  max_drawdown REAL NOT NULL,
  current_drawdown REAL NOT NULL,
  avg_holding_period REAL NOT NULL,
  return_on_investment REAL NOT NULL,
  daily_roi REAL NOT NULL,
  weekly_roi REAL NOT NULL,
  monthly_roi REAL NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
);

-- ============================================================================
-- INDICES FOR PERFORMANCE
-- ============================================================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Trading Bots
CREATE INDEX IF NOT EXISTS idx_bots_user_id ON trading_bots(user_id);
CREATE INDEX IF NOT EXISTS idx_bots_status ON trading_bots(status);
CREATE INDEX IF NOT EXISTS idx_bots_strategy ON trading_bots(strategy);

-- Risk Assessments
CREATE INDEX IF NOT EXISTS idx_risk_assessments_user_id ON risk_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_bot_id ON risk_assessments(bot_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_symbol ON risk_assessments(symbol);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_created_at ON risk_assessments(created_at);

-- Risk Alerts
CREATE INDEX IF NOT EXISTS idx_risk_alerts_user_id ON risk_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_acknowledged ON risk_alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_created_at ON risk_alerts(created_at);

-- AI Predictions
CREATE INDEX IF NOT EXISTS idx_ai_predictions_user_id ON ai_predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_symbol ON ai_predictions(symbol);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_created_at ON ai_predictions(created_at);

-- Trades
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_bot_id ON trades(bot_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades(opened_at);
CREATE INDEX IF NOT EXISTS idx_trades_closed_at ON trades(closed_at);

-- Positions
CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_bot_id ON positions(bot_id);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
CREATE INDEX IF NOT EXISTS idx_positions_side ON positions(side);

-- Portfolio Snapshots
CREATE INDEX IF NOT EXISTS idx_snapshots_user_id ON portfolio_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_bot_id ON portfolio_snapshots(bot_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON portfolio_snapshots(timestamp);

-- Price Quotes
CREATE INDEX IF NOT EXISTS idx_price_quotes_symbol ON price_quotes(symbol);
CREATE INDEX IF NOT EXISTS idx_price_quotes_exchange ON price_quotes(exchange);
CREATE INDEX IF NOT EXISTS idx_price_quotes_timestamp ON price_quotes(timestamp);

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Active positions with current P&L
CREATE VIEW IF NOT EXISTS v_active_positions AS
SELECT
  p.*,
  t.strategy,
  t.enhanced_by_ai,
  t.ai_confidence
FROM positions p
LEFT JOIN trades t ON p.symbol = t.symbol AND t.status = 'open'
WHERE p.updated_at > datetime('now', '-1 day');

-- Portfolio summary by user
CREATE VIEW IF NOT EXISTS v_portfolio_summary AS
SELECT
  u.id as user_id,
  u.name,
  u.current_capital,
  COUNT(DISTINCT p.id) as active_positions,
  SUM(p.value) as total_position_value,
  SUM(p.pnl) as unrealized_pnl,
  (SELECT COUNT(*) FROM trades WHERE user_id = u.id AND status = 'closed') as total_trades,
  (SELECT AVG(win_rate) FROM performance_metrics WHERE user_id = u.id) as avg_win_rate
FROM users u
LEFT JOIN positions p ON u.id = p.user_id
GROUP BY u.id;

-- Recent trade performance
CREATE VIEW IF NOT EXISTS v_recent_trades AS
SELECT
  t.*,
  ROUND((julianday(t.closed_at) - julianday(t.opened_at)) * 24 * 60, 2) as holding_minutes,
  CASE WHEN t.pnl > 0 THEN 'WIN' ELSE 'LOSS' END as outcome
FROM trades t
WHERE t.status = 'closed'
ORDER BY t.closed_at DESC;

-- Risk alerts summary
CREATE VIEW IF NOT EXISTS v_unacknowledged_alerts AS
SELECT
  r.user_id,
  r.level,
  COUNT(*) as alert_count,
  MAX(r.created_at) as latest_alert
FROM risk_alerts r
WHERE r.acknowledged = 0
GROUP BY r.user_id, r.level;
