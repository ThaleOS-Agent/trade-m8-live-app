export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  walletAddress?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface TradingBot {
  id: string;
  user_id: string;
  name: string;
  strategy: string;
  symbol: string;
  exchange: string;
  status: 'running' | 'paused' | 'stopped' | 'error';
  risk_level?: string;
  max_position_size?: number;
  pnl?: number;
  trades?: number;
  win_rate?: number;
  created_at: string;
  updated_at?: string;
}

export interface Trade {
  id: string;
  user_id: string;
  bot_id?: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price?: number;
  quantity: number;
  pnl?: number;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at?: string;
}

export interface Portfolio {
  total_value: number;
  daily_change: number;
  daily_change_percent: number;
  unrealized_pnl: number;
  realized_pnl: number;
}

export interface MarketData {
  symbol: string;
  exchange: string;
  price: number;
  change_24h: number;
  volume?: string;
  updated_at: string;
}

export interface PerformanceMetric {
  date: string;
  value: number;
}

export interface BotConfig {
  name: string;
  strategy: string;
  symbol: string;
  exchange: string;
  riskLevel: string;
  maxPositionSize: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop: boolean;
}
