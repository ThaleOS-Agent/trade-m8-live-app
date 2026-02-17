-- Trade M8 — Migration v3
-- Adds last_checked column to trading_bots for cron worker tracking

ALTER TABLE trading_bots ADD COLUMN last_checked INTEGER;
