// ============================================================
// THAELIA Exchange Gateway v1.0 — Core Types
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
// ============================================================

// ---- Connection States ----
export type ConnectionState =
  | 'CONNECTED'
  | 'DEGRADED'
  | 'DISCONNECTED'
  | 'RECONNECTING';

export type AssetClass = 'crypto' | 'forex' | 'commodity' | 'equity' | 'index';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop-loss' | 'take-profit' | 'trailing-stop';

// ---- Normalized Market Data — unified schema for all exchanges ----
export interface NormalizedTick {
  exchange: string;
  symbol: string;
  assetClass: AssetClass;
  channel: 'ticker' | 'trades' | 'candles' | 'orderbook';
  bid: number;
  ask: number;
  last: number;
  spread: number;
  volume: number;
  timestamp: number;       // exchange timestamp (ms)
  receivedAt: number;      // gateway receipt timestamp (ms)
  sequence: number;        // exchange sequence number (0 if unavailable)
  latencyMs: number;       // receivedAt - timestamp
  healthScore: number;     // 0–100
  raw?: unknown;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface NormalizedOrderBook {
  exchange: string;
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  sequence: number;
  timestamp: number;
  receivedAt: number;
}

// ---- Connection Health ----
export interface ConnectionHealth {
  exchange: string;
  state: ConnectionState;
  healthScore: number;          // 0–100
  latencyMs: number;
  lastPingSentAt: number;
  lastPongReceivedAt: number;
  missedPings: number;
  reconnectCount: number;
  lastDisconnectReason: string;
  lastReconnectTime: number;
  messageRate: number;          // msgs/sec
  sequenceGaps: number;
  subscribedSymbols: string[];
  updatedAt: number;
}

// ---- Queue Messages ----
export interface QueueMessage<T = unknown> {
  id: string;
  exchange: string;
  type: 'tick' | 'orderbook' | 'trade' | 'candle' | 'signal' | 'execution' | 'risk_event';
  payload: T;
  receivedAt: number;
  sequence?: number;
}

// ---- Signals ----
export interface MarketSignal {
  exchange: string;
  symbol: string;
  direction: 'long' | 'short' | 'flat';
  strength: number;          // 0–1
  rsi: number;
  macd: number;
  macdSignal: number;
  atr: number;
  trendState: 'uptrend' | 'downtrend' | 'ranging';
  volatilityRegime: 'low' | 'medium' | 'high';
  generatedAt: number;
}

// ---- Orders ----
export interface OrderRequest {
  clientOrderId: string;
  exchange: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  signalId?: string;
}

export interface OrderResult {
  clientOrderId: string;
  orderId: string;
  exchange: string;
  symbol: string;
  side: OrderSide;
  status: 'submitted' | 'rejected' | 'simulated' | 'blocked';
  blockReason?: string;
  fillPrice?: number;
  timestamp: number;
}

// ---- Risk ----
export interface RiskCheckResult {
  approved: boolean;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  blockedBy?: string;
}

// ---- Route ----
export interface RouteScore {
  exchange: string;
  healthScore: number;
  fee: number;
  spread: number;
  slippageEstimate: number;
  latencyMs: number;
  compositeScore: number;
  recommended: boolean;
  confidence: number;        // 0–1
  reason: string;
}

// ---- Audit ----
export interface AuditRecord {
  id: string;
  eventType: string;
  exchange?: string;
  symbol?: string;
  detail: Record<string, unknown>;
  timestamp: number;
}

// ---- Sequence tracking ----
export interface SequenceState {
  exchange: string;
  symbol: string;
  lastSeq: number;
  gaps: number[];
  recovering: boolean;
}
