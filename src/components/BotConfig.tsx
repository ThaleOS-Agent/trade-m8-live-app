import React, { useState } from 'react';
import { X, Plus, Settings2, TrendingUp, Shield, DollarSign } from 'lucide-react';
import api from '../lib/api';

interface BotConfigProps {
  onClose: () => void;
  onBotCreated?: () => void;
}

const BotConfig: React.FC<BotConfigProps> = ({ onClose, onBotCreated }) => {
  const [formData, setFormData] = useState({
    name: '',
    strategy: 'ensemble',
    symbol: 'BTC/USD',
    exchange: 'binance',
    riskLevel: 'medium',
    maxPositionSize: 1000,
    stopLoss: 2,
    takeProfit: 5,
    trailingStop: false,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const strategies = [
    { value: 'ensemble', label: 'Neural Network Ensemble', description: 'AI-powered multi-model strategy' },
    { value: 'fibonacci', label: 'Fibonacci Retracement', description: 'Classical technical analysis' },
    { value: 'volatility', label: 'Volatility Breakout', description: 'High-frequency scalping' },
    { value: 'momentum', label: 'Momentum Trading', description: 'Trend following strategy' },
    { value: 'mean_reversion', label: 'Mean Reversion', description: 'Range-bound trading' },
  ];

  const symbols = [
    'BTC/USD', 'ETH/USD', 'BNB/USD', 'SOL/USD', 'ADA/USD',
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD', 'XAG/USD'
  ];

  const exchanges = [
    { value: 'binance', label: 'Binance' },
    { value: 'coinbase', label: 'Coinbase' },
    { value: 'kraken', label: 'Kraken' },
    { value: 'bybit', label: 'Bybit' },
  ];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.createBot({
        name: formData.name,
        strategy: formData.strategy,
        symbol: formData.symbol,
        exchange: formData.exchange,
        riskLevel: formData.riskLevel,
        maxPositionSize: formData.maxPositionSize,
      });

      if (onBotCreated) {
        onBotCreated();
      }
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create bot');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="glass-card w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-sm p-6 border-b border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Plus className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Create Trading Bot</h2>
              <p className="text-xs text-slate-400 mt-0.5">Configure your automated trading strategy</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Bot Name */}
          <div>
            <label className="block text-sm font-medium mb-2">Bot Name</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="My Trading Bot"
              required
            />
          </div>

          {/* Strategy Selection */}
          <div>
            <label className="block text-sm font-medium mb-3">
              <TrendingUp className="w-4 h-4 inline mr-2" />
              Trading Strategy
            </label>
            <div className="grid grid-cols-1 gap-3">
              {strategies.map((strategy) => (
                <label
                  key={strategy.value}
                  className={`p-4 glass-inner rounded-lg cursor-pointer transition-all ${
                    formData.strategy === strategy.value
                      ? 'ring-2 ring-blue-500/50 bg-blue-500/10'
                      : 'hover:bg-slate-700/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="strategy"
                    value={strategy.value}
                    checked={formData.strategy === strategy.value}
                    onChange={handleChange}
                    className="sr-only"
                  />
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold">{strategy.label}</div>
                      <div className="text-xs text-slate-400 mt-1">{strategy.description}</div>
                    </div>
                    {formData.strategy === strategy.value && (
                      <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full" />
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Symbol and Exchange */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Trading Pair</label>
              <select
                name="symbol"
                value={formData.symbol}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              >
                {symbols.map(symbol => (
                  <option key={symbol} value={symbol}>{symbol}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Exchange</label>
              <select
                name="exchange"
                value={formData.exchange}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              >
                {exchanges.map(exchange => (
                  <option key={exchange.value} value={exchange.value}>{exchange.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Risk Management */}
          <div>
            <label className="block text-sm font-medium mb-3">
              <Shield className="w-4 h-4 inline mr-2" />
              Risk Level
            </label>
            <div className="grid grid-cols-3 gap-3">
              {['low', 'medium', 'high'].map((level) => (
                <label
                  key={level}
                  className={`p-4 glass-inner rounded-lg cursor-pointer text-center transition-all ${
                    formData.riskLevel === level
                      ? 'ring-2 ring-blue-500/50 bg-blue-500/10'
                      : 'hover:bg-slate-700/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="riskLevel"
                    value={level}
                    checked={formData.riskLevel === level}
                    onChange={handleChange}
                    className="sr-only"
                  />
                  <div className="font-semibold capitalize">{level}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {level === 'low' && '1-2% per trade'}
                    {level === 'medium' && '2-5% per trade'}
                    {level === 'high' && '5-10% per trade'}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Position Size */}
          <div>
            <label className="block text-sm font-medium mb-2">
              <DollarSign className="w-4 h-4 inline mr-2" />
              Max Position Size (USD)
            </label>
            <input
              type="number"
              name="maxPositionSize"
              value={formData.maxPositionSize}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              min="100"
              step="100"
              required
            />
            <p className="text-xs text-slate-500 mt-2">
              Maximum amount to allocate per trade
            </p>
          </div>

          {/* Advanced Settings */}
          <div className="glass-inner p-4 rounded-lg">
            <div className="flex items-center gap-2 mb-4">
              <Settings2 className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-medium">Advanced Settings</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-2">Stop Loss (%)</label>
                <input
                  type="number"
                  name="stopLoss"
                  value={formData.stopLoss}
                  onChange={handleChange}
                  className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  min="0.1"
                  step="0.1"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-2">Take Profit (%)</label>
                <input
                  type="number"
                  name="takeProfit"
                  value={formData.takeProfit}
                  onChange={handleChange}
                  className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  min="0.1"
                  step="0.1"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 mt-4 cursor-pointer">
              <input
                type="checkbox"
                name="trailingStop"
                checked={formData.trailingStop}
                onChange={handleChange}
                className="w-4 h-4 rounded bg-slate-800/50 border-slate-700/50"
              />
              <span className="text-sm">Enable Trailing Stop</span>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-slate-700/50 hover:bg-slate-700/70 rounded-lg font-semibold transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
            >
              {loading ? 'Creating...' : 'Create Bot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BotConfig;
