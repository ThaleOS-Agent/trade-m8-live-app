import React, { useState, useEffect } from 'react';
import { X, Plus, Settings2, TrendingUp, Shield, DollarSign, Sparkles, Zap } from 'lucide-react';
import api from '../lib/api';
import { STRATEGIES } from '../lib/tradingStrategies';
import { signalAggregator } from '../lib/signalAggregator';

interface BotConfigProps {
  onClose: () => void;
  onBotCreated?: () => void;
}

const BotConfig: React.FC<BotConfigProps> = ({ onClose, onBotCreated }) => {
  const [formData, setFormData] = useState({
    name: '',
    strategy: 'ai_momentum',
    symbol: 'AUTO',
    exchange: 'binance',
    riskLevel: 'medium',
    maxPositionSize: 1000,
    stopLoss: 2,
    takeProfit: 5,
    trailingStop: false,
    autoSelectAsset: true,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [recommendedAsset, setRecommendedAsset] = useState<string | null>(null);

  // Convert STRATEGIES object to array for dropdown
  const strategies = Object.entries(STRATEGIES).map(([key, config]) => ({
    value: key,
    label: config.name,
    description: config.description,
    riskLevel: config.riskLevel,
    autoSelect: config.autoSelectAsset
  }));

  const symbols = [
    { value: 'AUTO', label: '🤖 AI Auto-Select (Recommended)', category: 'AI' },
    { value: 'BTC/USD', label: 'Bitcoin (BTC/USD)', category: 'Crypto' },
    { value: 'ETH/USD', label: 'Ethereum (ETH/USD)', category: 'Crypto' },
    { value: 'BNB/USD', label: 'Binance Coin (BNB/USD)', category: 'Crypto' },
    { value: 'SOL/USD', label: 'Solana (SOL/USD)', category: 'Crypto' },
    { value: 'EUR/USD', label: 'Euro (EUR/USD)', category: 'Forex' },
    { value: 'GBP/USD', label: 'British Pound (GBP/USD)', category: 'Forex' },
    { value: 'USD/JPY', label: 'Japanese Yen (USD/JPY)', category: 'Forex' },
    { value: 'XAU/USD', label: 'Gold (XAU/USD)', category: 'Commodities' },
    { value: 'XAG/USD', label: 'Silver (XAG/USD)', category: 'Commodities' },
  ];

  const exchanges = [
    { value: 'binance', label: 'Binance' },
    { value: 'coinbase', label: 'Coinbase' },
    { value: 'kraken', label: 'Kraken' },
    { value: 'bybit', label: 'Bybit' },
  ];

  // Auto-analyze when strategy changes
  useEffect(() => {
    if (formData.symbol === 'AUTO') {
      analyzeBestAsset();
    }
  }, [formData.strategy]);

  const analyzeBestAsset = async () => {
    setAnalyzing(true);
    try {
      const best = await signalAggregator.findBestOpportunity('all');
      if (best) {
        setRecommendedAsset(best.symbol);
      }
    } catch (error) {
      console.error('Failed to analyze assets:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const newValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;

    setFormData(prev => ({
      ...prev,
      [name]: newValue
    }));

    // If symbol changed to AUTO, trigger analysis
    if (name === 'symbol' && value === 'AUTO') {
      analyzeBestAsset();
    }
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

          {/* Symbol Selection with AI Recommendation */}
          <div>
            <label className="block text-sm font-medium mb-2">
              <Sparkles className="w-4 h-4 inline mr-2" />
              Asset Selection
            </label>
            <select
              name="symbol"
              value={formData.symbol}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              {symbols.map((symbol) => (
                <option key={symbol.value} value={symbol.value}>
                  {symbol.label}
                </option>
              ))}
            </select>

            {/* AI Recommendation Indicator */}
            {formData.symbol === 'AUTO' && (
              <div className="mt-3 p-3 glass-inner rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-semibold text-blue-300">AI Auto-Selection Enabled</span>
                </div>
                {analyzing ? (
                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400"></div>
                    Analyzing market conditions...
                  </div>
                ) : recommendedAsset ? (
                  <div className="text-xs text-emerald-400">
                    ✓ Recommended: {recommendedAsset}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">
                    Bot will automatically select the best asset based on current market conditions
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Exchange */}
          <div className="grid grid-cols-2 gap-4">
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
