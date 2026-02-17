-- Trade M8 - Migration v2
-- Adds new columns to existing tables and creates new tables
-- Safe to run on existing databases (uses IF NOT EXISTS / ADD COLUMN)

-- ============================================================================
-- STEP 1: ALTER EXISTING TABLES - Add new columns
-- ============================================================================

-- users: add new columns
ALTER TABLE users ADD COLUMN initial_capital REAL DEFAULT 10000.0;
ALTER TABLE users ADD COLUMN current_capital REAL DEFAULT 10000.0;
ALTER TABLE users ADD COLUMN risk_profile TEXT DEFAULT 'medium';
ALTER TABLE users ADD COLUMN ai_enabled BOOLEAN DEFAULT 1;
ALTER TABLE users ADD COLUMN preferred_exchanges TEXT;
ALTER TABLE users ADD COLUMN settings TEXT;

-- trading_bots: add new columns
ALTER TABLE trading_bots ADD COLUMN ai_enhanced BOOLEAN DEFAULT 1;
ALTER TABLE trading_bots ADD COLUMN initial_capital REAL DEFAULT 1000.0;
ALTER TABLE trading_bots ADD COLUMN current_capital REAL DEFAULT 1000.0;
ALTER TABLE trading_bots ADD COLUMN max_position_size REAL DEFAULT 0.10;
ALTER TABLE trading_bots ADD COLUMN max_drawdown REAL DEFAULT 0.10;
ALTER TABLE trading_bots ADD COLUMN target_win_rate REAL DEFAULT 90.0;
ALTER TABLE trading_bots ADD COLUMN target_daily_roi REAL DEFAULT 15.0;

-- trades: add new AI and execution columns
ALTER TABLE trades ADD COLUMN enhanced_by_ai BOOLEAN DEFAULT 0;
ALTER TABLE trades ADD COLUMN ai_confidence REAL;
ALTER TABLE trades ADD COLUMN risk_score REAL;
ALTER TABLE trades ADD COLUMN execution_time_ms INTEGER;
ALTER TABLE trades ADD COLUMN slippage REAL;
ALTER TABLE trades ADD COLUMN tx_hash TEXT;
ALTER TABLE trades ADD COLUMN block_number INTEGER;
ALTER TABLE trades ADD COLUMN gas_used INTEGER;

-- portfolio_snapshots: add new columns if needed
ALTER TABLE portfolio_snapshots ADD COLUMN sharpe_ratio REAL;
ALTER TABLE portfolio_snapshots ADD COLUMN sortino_ratio REAL;
ALTER TABLE portfolio_snapshots ADD COLUMN max_drawdown REAL;
ALTER TABLE portfolio_snapshots ADD COLUMN win_rate REAL;

-- ============================================================================
-- STEP 2: CREATE NEW TABLES (only if they don't exist)
-- ============================================================================

-- Risk assessments table
CREATE TABLE IF NOT EXISTS risk_assessments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  assessment_type TEXT NOT NULL,
  symbol TEXT,
  risk_score REAL NOT NULL,
  risk_level TEXT NOT NULL,
  approved BOOLEAN NOT NULL,
  var_1d REAL,
  var_5d REAL,
  expected_shortfall REAL,
  correlation_risk REAL,
  liquidity_risk REAL,
  volatility REAL,
  warnings TEXT,
  blockers TEXT,
  recommendations TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Risk metrics history
CREATE TABLE IF NOT EXISTS risk_metrics_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  metric_type TEXT NOT NULL,
  current_value REAL NOT NULL,
  limit_value REAL NOT NULL,
  level TEXT NOT NULL,
  description TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Risk alerts
CREATE TABLE IF NOT EXISTS risk_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  alert_type TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  acknowledged BOOLEAN DEFAULT 0,
  acknowledged_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- AI predictions
CREATE TABLE IF NOT EXISTS ai_predictions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  prediction TEXT NOT NULL,
  confidence REAL NOT NULL,
  price_target REAL,
  technical_score REAL,
  fundamental_score REAL,
  sentiment_score REAL,
  momentum_score REAL,
  features TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Fusion predictions
CREATE TABLE IF NOT EXISTS fusion_predictions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  confidence REAL NOT NULL,
  expected_return REAL,
  time_horizon TEXT,
  technical_weight REAL DEFAULT 0.35,
  fundamental_weight REAL DEFAULT 0.25,
  sentiment_weight REAL DEFAULT 0.25,
  momentum_weight REAL DEFAULT 0.15,
  component_scores TEXT,
  market_regime TEXT,
  risk_adjusted_score REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Sentiment data
CREATE TABLE IF NOT EXISTS sentiment_data (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,
  score REAL NOT NULL,
  volume INTEGER,
  positive_count INTEGER,
  negative_count INTEGER,
  neutral_count INTEGER,
  raw_data TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Enhanced signals
CREATE TABLE IF NOT EXISTS enhanced_signals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  base_signal TEXT NOT NULL,
  enhanced_signal TEXT NOT NULL,
  base_confidence REAL NOT NULL,
  enhanced_confidence REAL NOT NULL,
  ai_boost REAL,
  sentiment_score REAL,
  news_score REAL,
  should_trade BOOLEAN NOT NULL,
  reasoning TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
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
  execution_result TEXT,
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

-- Positions table (create if not exists; existing DB may not have it)
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
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
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============================================================================
-- STEP 3: CREATE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_risk_assessments_user ON risk_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_symbol ON risk_assessments(symbol);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_created ON risk_assessments(created_at);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_user ON risk_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_acknowledged ON risk_alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_symbol ON ai_predictions(symbol);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_created ON ai_predictions(created_at);
CREATE INDEX IF NOT EXISTS idx_fusion_predictions_symbol ON fusion_predictions(symbol);
CREATE INDEX IF NOT EXISTS idx_sentiment_data_symbol ON sentiment_data(symbol);
CREATE INDEX IF NOT EXISTS idx_sentiment_data_timestamp ON sentiment_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_enhanced_signals_symbol ON enhanced_signals(symbol);
CREATE INDEX IF NOT EXISTS idx_execution_results_trade ON execution_results(trade_id);
CREATE INDEX IF NOT EXISTS idx_arbitrage_symbol ON arbitrage_opportunities(symbol);
CREATE INDEX IF NOT EXISTS idx_price_quotes_symbol ON price_quotes(symbol);
CREATE INDEX IF NOT EXISTS idx_price_quotes_exchange ON price_quotes(exchange);
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_enhanced_ai ON trades(enhanced_by_ai);

-- ============================================================================
-- STEP 4: CREATE/REPLACE VIEWS
-- ============================================================================

DROP VIEW IF EXISTS v_active_positions;
DROP VIEW IF EXISTS v_portfolio_summary;
DROP VIEW IF EXISTS v_recent_trades;
DROP VIEW IF EXISTS v_unacknowledged_alerts;

CREATE VIEW v_active_positions AS
SELECT
  p.*,
  t.strategy,
  t.enhanced_by_ai,
  t.ai_confidence
FROM positions p
LEFT JOIN trades t ON p.symbol = t.symbol AND t.status = 'open'
WHERE p.updated_at > datetime('now', '-1 day');

CREATE VIEW v_portfolio_summary AS
SELECT
  u.id as user_id,
  u.email as name,
  u.current_capital,
  COUNT(DISTINCT p.id) as active_positions,
  SUM(p.value) as total_position_value,
  SUM(p.pnl) as unrealized_pnl,
  (SELECT COUNT(*) FROM trades WHERE user_id = u.id AND status = 'closed') as total_trades
FROM users u
LEFT JOIN positions p ON u.id = p.user_id
GROUP BY u.id;

CREATE VIEW v_recent_trades AS
SELECT
  t.*,
  ROUND((julianday(t.closed_at) - julianday(t.opened_at)) * 24 * 60, 2) as holding_minutes,
  CASE WHEN t.pnl > 0 THEN 'WIN' ELSE 'LOSS' END as outcome
FROM trades t
WHERE t.status = 'closed'
ORDER BY t.closed_at DESC;

CREATE VIEW v_unacknowledged_alerts AS
SELECT
  r.user_id,
  r.level,
  COUNT(*) as alert_count,
  MAX(r.created_at) as latest_alert
FROM risk_alerts r
WHERE r.acknowledged = 0
GROUP BY r.user_id, r.level;
