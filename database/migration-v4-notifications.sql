-- Migration V4: Notification System
-- Adds support for email and webhook notifications for signals, trades, and risk alerts

-- ============================================================================
-- NOTIFICATION TABLES
-- ============================================================================

-- User notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Email notifications
  email_enabled BOOLEAN DEFAULT 1,
  email_address TEXT,

  -- Webhook notifications
  webhook_enabled BOOLEAN DEFAULT 0,

  -- Notification types
  notify_on_signal_received BOOLEAN DEFAULT 1,
  notify_on_trade_executed BOOLEAN DEFAULT 1,
  notify_on_trade_closed BOOLEAN DEFAULT 1,
  notify_on_risk_alert BOOLEAN DEFAULT 1,
  notify_on_position_update BOOLEAN DEFAULT 0,
  notify_on_daily_summary BOOLEAN DEFAULT 0,

  -- Risk alert level filters
  notify_risk_level_low BOOLEAN DEFAULT 0,
  notify_risk_level_medium BOOLEAN DEFAULT 1,
  notify_risk_level_high BOOLEAN DEFAULT 1,
  notify_risk_level_critical BOOLEAN DEFAULT 1,
  notify_risk_level_emergency BOOLEAN DEFAULT 1,

  -- Quiet hours (UTC)
  quiet_hours_enabled BOOLEAN DEFAULT 0,
  quiet_hours_start TIME, -- e.g., '22:00:00'
  quiet_hours_end TIME,   -- e.g., '08:00:00'

  -- Rate limiting
  max_notifications_per_hour INTEGER DEFAULT 50,
  max_notifications_per_day INTEGER DEFAULT 500,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Webhook endpoints
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,

  -- Authentication
  auth_type TEXT DEFAULT 'none', -- 'none', 'bearer', 'basic', 'custom_header'
  auth_token TEXT,
  auth_username TEXT,
  auth_password TEXT,
  custom_headers TEXT, -- JSON object

  -- Webhook configuration
  enabled BOOLEAN DEFAULT 1,
  retry_on_failure BOOLEAN DEFAULT 1,
  max_retries INTEGER DEFAULT 3,
  timeout_ms INTEGER DEFAULT 5000,

  -- Event filters
  events TEXT NOT NULL, -- JSON array: ["signal_received", "trade_executed", "risk_alert"]

  -- Status tracking
  last_triggered_at DATETIME,
  last_success_at DATETIME,
  last_failure_at DATETIME,
  failure_count INTEGER DEFAULT 0,
  total_calls INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0.0,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Notification logs
CREATE TABLE IF NOT EXISTS notification_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Notification details
  notification_type TEXT NOT NULL, -- 'signal_received', 'trade_executed', 'trade_closed', 'risk_alert', 'position_update'
  channel TEXT NOT NULL, -- 'email', 'webhook'

  -- Target information
  email_address TEXT,
  webhook_endpoint_id TEXT,
  webhook_url TEXT,

  -- Content
  subject TEXT,
  message TEXT NOT NULL,
  data TEXT, -- JSON object with notification data

  -- Status
  status TEXT NOT NULL, -- 'pending', 'sent', 'failed', 'skipped'
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Metadata
  signal_id TEXT,
  trade_id TEXT,
  risk_alert_id TEXT,
  position_id TEXT,

  -- Timing
  sent_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (webhook_endpoint_id) REFERENCES webhook_endpoints(id),
  FOREIGN KEY (trade_id) REFERENCES trades(id),
  FOREIGN KEY (risk_alert_id) REFERENCES risk_alerts(id),
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

-- ============================================================================
-- INDICES FOR NOTIFICATION TABLES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON notification_preferences(user_id);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_user_id ON webhook_endpoints(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_enabled ON webhook_endpoints(enabled);

CREATE INDEX IF NOT EXISTS idx_notification_logs_user_id ON notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON notification_logs(status);
CREATE INDEX IF NOT EXISTS idx_notification_logs_type ON notification_logs(notification_type);
CREATE INDEX IF NOT EXISTS idx_notification_logs_channel ON notification_logs(channel);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_trade_id ON notification_logs(trade_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_signal_id ON notification_logs(signal_id);

-- ============================================================================
-- DEFAULT NOTIFICATION PREFERENCES FOR EXISTING USERS
-- ============================================================================

-- Insert default preferences for users who don't have them
INSERT OR IGNORE INTO notification_preferences (id, user_id, email_address)
SELECT
  'pref-' || hex(randomblob(16)) as id,
  u.id as user_id,
  u.email as email_address
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM notification_preferences np WHERE np.user_id = u.id
);
