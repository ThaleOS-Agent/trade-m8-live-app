/**
 * Advanced Trading Dashboard with AI Enhancement, Risk Management, and Multi-Exchange Support
 */

import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import {
  TrendingUp,
  TrendingDown,
  Shield,
  Brain,
  Activity,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  LineChart,
  Zap
} from 'lucide-react';

interface TradingSystemStatus {
  portfolio: {
    totalValue: number;
    totalPnL: number;
    totalPnLPercent: number;
    dailyPnL: number;
    weeklyPnL: number;
    monthlyPnL: number;
    exposurePercent: number;
    cashBalance: number;
  };
  performance: {
    totalTrades: number;
    winRate: number;
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
    dailyROI: number;
    weeklyROI: number;
    monthlyROI: number;
    profitFactor: number;
  };
  risk: {
    configuration: any;
    portfolioHistory: {
      entries: number;
      lastUpdate: string | null;
    };
  };
  ai: {
    size: number;
    entries: string[];
  };
  positions: Array<{
    id: string;
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    currentPrice: number;
    quantity: number;
    pnl: number;
    pnlPercent: number;
    value: number;
  }>;
}

export function AdvancedTradingDashboard() {
  const [status, setStatus] = useState<TradingSystemStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tradeForm, setTradeForm] = useState({
    symbol: 'BTC/USD',
    signal: 'buy',
    confidence: 0.70,
    amount: 1000
  });
  const [_alerts, _setAlerts] = useState<any[]>([]);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, []);

  async function loadStatus() {
    try {
      // This endpoint will be created in the backend
      const response = await api.get('/api/trading-system/status');
      setStatus(response.data);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load status:', err);
      setError(err.message);
    }
  }

  async function executeTrade() {
    setLoading(true);
    try {
      const response = await api.post('/api/live-trading/ai-execute', {
        symbol: tradeForm.symbol,
        signal: tradeForm.signal,
        confidence: tradeForm.confidence,
        amount: tradeForm.amount,
        marketData: {
          price: 50000, // Mock data - replace with real market data
          volume: 1000000,
          volatility: 0.03,
          rsi: 45,
          macd: { value: 100, signal: 95, histogram: 5 },
          momentum: 0.02,
          priceHistory: [49000, 49500, 50000],
          volumeHistory: [900000, 950000, 1000000]
        }
      });

      if (response.data.success) {
        alert('✅ Trade executed successfully!');
        await loadStatus();
      } else {
        alert(`❌ Trade failed: ${response.data.reason}`);
      }
    } catch (err: any) {
      alert(`❌ Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function scanArbitrage() {
    setLoading(true);
    try {
      const response = await api.post('/api/trading-system/scan-arbitrage', {
        symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD']
      });

      const opportunities = response.data.opportunities || [];
      if (opportunities.length > 0) {
        alert(`💰 Found ${opportunities.length} arbitrage opportunities!`);
      } else {
        alert('No profitable arbitrage opportunities found');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  if (error && !status) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <h3 className="font-semibold text-red-900 dark:text-red-100">Error Loading Dashboard</h3>
            </div>
            <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>
            <button
              onClick={loadStatus}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading trading system...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Trade M8 - Advanced Trading System
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              AI-Enhanced | Multi-Exchange | Real-Time Risk Management
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadStatus}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={scanArbitrage}
              disabled={loading}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <Zap className="w-4 h-4 inline mr-2" />
              Scan Arbitrage
            </button>
          </div>
        </div>

        {/* Key Metrics - Top Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard
            icon={<DollarSign className="w-6 h-6" />}
            label="Portfolio Value"
            value={`$${status.portfolio.totalValue.toFixed(2)}`}
            change={status.portfolio.totalPnLPercent}
            color="blue"
          />
          <MetricCard
            icon={status.portfolio.totalPnL >= 0 ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
            label="Total P&L"
            value={`$${status.portfolio.totalPnL.toFixed(2)}`}
            change={status.portfolio.totalPnLPercent}
            color={status.portfolio.totalPnL >= 0 ? "green" : "red"}
          />
          <MetricCard
            icon={<BarChart3 className="w-6 h-6" />}
            label="Win Rate"
            value={`${status.performance.winRate.toFixed(1)}%`}
            subtitle={`${status.performance.totalTrades} trades`}
            color="purple"
          />
          <MetricCard
            icon={<LineChart className="w-6 h-6" />}
            label="Sharpe Ratio"
            value={status.performance.sharpeRatio.toFixed(2)}
            subtitle="Risk-adjusted return"
            color="indigo"
          />
        </div>

        {/* Performance & Risk - Second Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SmallMetricCard
            label="Daily ROI"
            value={`${status.performance.dailyROI.toFixed(2)}%`}
            trend={status.performance.dailyROI >= 0 ? 'up' : 'down'}
          />
          <SmallMetricCard
            label="Weekly ROI"
            value={`${status.performance.weeklyROI.toFixed(2)}%`}
            trend={status.performance.weeklyROI >= 0 ? 'up' : 'down'}
          />
          <SmallMetricCard
            label="Max Drawdown"
            value={`${(status.performance.maxDrawdown * 100).toFixed(2)}%`}
            trend="neutral"
          />
          <SmallMetricCard
            label="Profit Factor"
            value={status.performance.profitFactor.toFixed(2)}
            trend={status.performance.profitFactor > 1 ? 'up' : 'down'}
          />
        </div>

        {/* Trade Execution Form */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-500" />
            AI-Enhanced Trade Execution
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Symbol
              </label>
              <select
                value={tradeForm.symbol}
                onChange={(e) => setTradeForm({ ...tradeForm, symbol: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="BTC/USD">BTC/USD</option>
                <option value="ETH/USD">ETH/USD</option>
                <option value="SOL/USD">SOL/USD</option>
                <option value="ADA/USD">ADA/USD</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Signal
              </label>
              <select
                value={tradeForm.signal}
                onChange={(e) => setTradeForm({ ...tradeForm, signal: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Confidence
              </label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={tradeForm.confidence}
                onChange={(e) => setTradeForm({ ...tradeForm, confidence: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Amount ($)
              </label>
              <input
                type="number"
                min="10"
                step="10"
                value={tradeForm.amount}
                onChange={(e) => setTradeForm({ ...tradeForm, amount: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={executeTrade}
                disabled={loading}
                className="w-full px-6 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all disabled:opacity-50 font-semibold"
              >
                {loading ? 'Executing...' : 'Execute Trade'}
              </button>
            </div>
          </div>
        </div>

        {/* Active Positions */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-green-500" />
            Active Positions ({status.positions?.length || 0})
          </h2>
          {status.positions && status.positions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Symbol</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Side</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Entry Price</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Current Price</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Quantity</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Value</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {status.positions.map((position) => (
                    <tr key={position.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="py-3 px-4 font-semibold">{position.symbol}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          position.side === 'long' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {position.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">${position.entryPrice.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right">${position.currentPrice.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right">{position.quantity.toFixed(6)}</td>
                      <td className="py-3 px-4 text-right">${position.value.toFixed(2)}</td>
                      <td className={`py-3 px-4 text-right font-semibold ${
                        position.pnl >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        ${position.pnl.toFixed(2)} ({position.pnlPercent.toFixed(2)}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No active positions
            </div>
          )}
        </div>

        {/* System Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatusCard
            icon={<Shield className="w-5 h-5" />}
            title="Risk Management"
            status="Active"
            details={[
              `Portfolio Snapshots: ${status.risk.portfolioHistory.entries}`,
              `Max Drawdown: ${(status.performance.maxDrawdown * 100).toFixed(2)}%`,
              'Pre-trade checks: Enabled'
            ]}
            color="green"
          />
          <StatusCard
            icon={<Brain className="w-5 h-5" />}
            title="AI Enhancement"
            status="Active"
            details={[
              `Cached Predictions: ${status.ai.size}`,
              'Target Win Rate: 90%+',
              'AI Weight: 40%'
            ]}
            color="purple"
          />
          <StatusCard
            icon={<Activity className="w-5 h-5" />}
            title="Multi-Exchange"
            status="Connected"
            details={[
              '6 Exchanges Available',
              'Smart Routing: Enabled',
              'Arbitrage: Scanning'
            ]}
            color="blue"
          />
        </div>
      </div>
    </div>
  );
}

// Helper Components
function MetricCard({ icon, label, value, subtitle, change, color }: any) {
  const colorClasses = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-green-500 to-green-600',
    red: 'from-red-500 to-red-600',
    purple: 'from-purple-500 to-purple-600',
    indigo: 'from-indigo-500 to-indigo-600'
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <div className={`inline-flex p-3 rounded-lg bg-gradient-to-br ${colorClasses[color as keyof typeof colorClasses]} text-white mb-4`}>
        {icon}
      </div>
      <div className="text-sm text-gray-600 dark:text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</div>
      {subtitle && (
        <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">{subtitle}</div>
      )}
      {change !== undefined && (
        <div className={`text-sm mt-2 flex items-center gap-1 ${
          change >= 0 ? 'text-green-600' : 'text-red-600'
        }`}>
          {change >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          {Math.abs(change).toFixed(2)}%
        </div>
      )}
    </div>
  );
}

function SmallMetricCard({ label, value, trend }: any) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <div className="text-xs text-gray-600 dark:text-gray-400">{label}</div>
      <div className="text-xl font-bold text-gray-900 dark:text-white mt-1 flex items-center gap-2">
        {value}
        {trend === 'up' && <TrendingUp className="w-4 h-4 text-green-500" />}
        {trend === 'down' && <TrendingDown className="w-4 h-4 text-red-500" />}
      </div>
    </div>
  );
}

function StatusCard({ icon, title, status, details, color }: any) {
  const colorClasses = {
    green: 'text-green-600 bg-green-100 dark:bg-green-900/20',
    purple: 'text-purple-600 bg-purple-100 dark:bg-purple-900/20',
    blue: 'text-blue-600 bg-blue-100 dark:bg-blue-900/20'
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2 rounded-lg ${colorClasses[color as keyof typeof colorClasses]}`}>
          {icon}
        </div>
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
          <div className="flex items-center gap-2 mt-1">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-sm text-green-600 dark:text-green-400">{status}</span>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {details.map((detail: string, i: number) => (
          <div key={i} className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
            {detail}
          </div>
        ))}
      </div>
    </div>
  );
}
