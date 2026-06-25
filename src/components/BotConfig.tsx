import React, { useState, useEffect } from 'react';
import { X, Plus, Settings2, TrendingUp, Shield, DollarSign, Sparkles, Zap } from 'lucide-react';
import api from '../lib/api';
import { STRATEGIES } from '../lib/tradingStrategies';
import { signalAggregator } from '../lib/signalAggregator';
import { TradingBot } from '../types';

interface BotConfigProps {
  bot?: TradingBot | null;
  onClose: () => void;
  onBotCreated?: () => void;
}

const BotConfig: React.FC<BotConfigProps> = ({ bot, onClose, onBotCreated }) => {
  const isEditMode = !!bot;

  const [formData, setFormData] = useState({
    name: bot?.name || '',
    strategy: bot?.strategy || 'ai_momentum',
    symbol: bot?.symbol || 'AUTO',
    exchange: bot?.exchange || 'binance',
    riskLevel: (bot as any)?.risk_level || 'medium',
    maxPositionSize: (bot as any)?.max_position_size || 1000,
    stopLoss: (bot as any)?.stop_loss || 2,
    takeProfit: (bot as any)?.take_profit || 5,
    trailingStop: (bot as any)?.trailing_stop || false,
    autoSelectAsset: bot?.symbol === 'AUTO',
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
    // AI
    { value: 'AUTO',       label: '🤖 AI Auto-Select (Recommended)', category: 'AI' },
    // Crypto
    { value: 'BTC/USD',    label: 'Bitcoin (BTC/USD)',          category: 'Crypto' },
    { value: 'ETH/USD',    label: 'Ethereum (ETH/USD)',         category: 'Crypto' },
    { value: 'BNB/USD',    label: 'Binance Coin (BNB/USD)',     category: 'Crypto' },
    { value: 'SOL/USD',    label: 'Solana (SOL/USD)',           category: 'Crypto' },
    { value: 'XRP/USD',    label: 'XRP (XRP/USD)',              category: 'Crypto' },
    { value: 'ADA/USD',    label: 'Cardano (ADA/USD)',          category: 'Crypto' },
    { value: 'DOGE/USD',   label: 'Dogecoin (DOGE/USD)',        category: 'Crypto' },
    // Forex Majors
    { value: 'EUR/USD',    label: 'Euro (EUR/USD)',             category: 'Forex' },
    { value: 'GBP/USD',    label: 'British Pound (GBP/USD)',    category: 'Forex' },
    { value: 'USD/JPY',    label: 'Japanese Yen (USD/JPY)',     category: 'Forex' },
    { value: 'USD/CHF',    label: 'Swiss Franc (USD/CHF)',      category: 'Forex' },
    { value: 'AUD/USD',    label: 'Australian Dollar (AUD/USD)', category: 'Forex' },
    { value: 'USD/CAD',    label: 'Canadian Dollar (USD/CAD)',  category: 'Forex' },
    { value: 'NZD/USD',    label: 'New Zealand Dollar (NZD/USD)', category: 'Forex' },
    // Forex Minors
    { value: 'EUR/GBP',    label: 'EUR/GBP',                   category: 'Forex' },
    { value: 'EUR/JPY',    label: 'EUR/JPY',                   category: 'Forex' },
    { value: 'GBP/JPY',    label: 'GBP/JPY',                   category: 'Forex' },
    { value: 'EUR/AUD',    label: 'EUR/AUD',                   category: 'Forex' },
    { value: 'AUD/JPY',    label: 'AUD/JPY',                   category: 'Forex' },
    { value: 'EUR/CAD',    label: 'EUR/CAD',                   category: 'Forex' },
    { value: 'GBP/AUD',    label: 'GBP/AUD',                   category: 'Forex' },
    // Precious Metals
    { value: 'XAU/USD',    label: 'Gold (XAU/USD)',             category: 'Commodities' },
    { value: 'XAG/USD',    label: 'Silver (XAG/USD)',           category: 'Commodities' },
    { value: 'XPT/USD',    label: 'Platinum (XPT/USD)',         category: 'Commodities' },
    { value: 'XPD/USD',    label: 'Palladium (XPD/USD)',        category: 'Commodities' },
    // Energy
    { value: 'WTICO/USD',  label: 'WTI Crude Oil',             category: 'Commodities' },
    { value: 'BCO/USD',    label: 'Brent Crude Oil',           category: 'Commodities' },
    { value: 'NATGAS/USD', label: 'Natural Gas',               category: 'Commodities' },
    // Indices
    { value: 'US30/USD',   label: 'Dow Jones (US30)',          category: 'Indices' },
    { value: 'SPX500/USD', label: 'S&P 500 (SPX500)',          category: 'Indices' },
    { value: 'NAS100/USD', label: 'NASDAQ 100 (NAS100)',       category: 'Indices' },
    { value: 'UK100/GBP',  label: 'FTSE 100 (UK100)',          category: 'Indices' },
    { value: 'DE30/EUR',   label: 'DAX 40 (GER40)',            category: 'Indices' },
    { value: 'JP225/USD',  label: 'Nikkei 225 (JP225)',        category: 'Indices' },
  ];

  const exchanges = [
    // Crypto exchanges
    { value: 'binance',  label: 'Binance' },
    { value: 'bybit',    label: 'Bybit' },
    { value: 'kraken',   label: 'Kraken' },
    { value: 'kucoin',   label: 'KuCoin' },
    { value: 'coinbase', label: 'Coinbase Advanced' },
    { value: 'okx',      label: 'OKX' },
    { value: 'gateio',   label: 'Gate.io' },
    { value: 'mexc',     label: 'MEXC' },
    { value: 'bitget',   label: 'Bitget' },
    { value: 'bitfinex', label: 'Bitfinex' },
    { value: 'gemini',   label: 'Gemini' },
    // Stocks / ETFs
    { value: 'alpaca',   label: 'Alpaca (Stocks/ETFs)' },
    // Forex brokers
    { value: 'oanda',    label: 'OANDA (Forex/CFDs)' },
    { value: 'exness',   label: 'Exness (Forex/MT5)' },
  ];

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

  // Auto-analyze when strategy changes (declared after analyzeBestAsset to avoid hoisting issue)
  useEffect(() => {
    if (formData.symbol === 'AUTO') {
      analyzeBestAsset();
    }
  }, [formData.strategy]);

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
      if (isEditMode && bot) {
        await api.updateBot(bot.id, {
          name: formData.name,
          strategy: formData.strategy,
          symbol: formData.symbol,
          exchange: formData.exchange,
          riskLevel: formData.riskLevel,
          maxPositionSize: formData.maxPositionSize,
        });
      } else {
        await api.createBot({
          name: formData.name,
          strategy: formData.strategy,
          symbol: formData.symbol,
          exchange: formData.exchange,
          riskLevel: formData.riskLevel,
          maxPositionSize: formData.maxPositionSize,
        });
      }

      if (onBotCreated) {
        onBotCreated();
      }
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to ${isEditMode ? 'update' : 'create'} bot`);
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
              {isEditMode ? (
                <Settings2 className="w-5 h-5 text-blue-400" />
              ) : (
                <Plus className="w-5 h-5 text-blue-400" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold">{isEditMode ? 'Edit Trading Bot' : 'Create Trading Bot'}</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isEditMode ? 'Update your bot configuration' : 'Configure your automated trading strategy'}
              </p>
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
              {['AI', 'Crypto', 'Forex', 'Commodities', 'Indices'].map(cat => {
                const group = symbols.filter(s => s.category === cat);
                if (!group.length) return null;
                return (
                  <optgroup key={cat} label={cat}>
                    {group.map(sym => (
                      <option key={sym.value} value={sym.value}>{sym.label}</option>
                    ))}
                  </optgroup>
                );
              })}
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
          <div>
            <label className="block text-sm font-medium mb-2">Exchange / Broker</label>
            <select
              name="exchange"
              value={formData.exchange}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <optgroup label="Crypto Exchanges">
                {exchanges.filter(e => !['alpaca','oanda','exness'].includes(e.value)).map(exchange => (
                  <option key={exchange.value} value={exchange.value}>{exchange.label}</option>
                ))}
              </optgroup>
              <optgroup label="Stocks / ETFs">
                <option value="alpaca">Alpaca (Stocks/ETFs)</option>
              </optgroup>
              <optgroup label="Forex Brokers">
                <option value="oanda">OANDA (Forex/CFDs)</option>
                <option value="exness">Exness (Forex/MT5)</option>
              </optgroup>
            </select>
            {(formData.exchange === 'oanda' || formData.exchange === 'exness') && (
              <p className="text-xs text-blue-400 mt-2">
                Forex broker selected — choose a Forex, Commodity, or Index symbol above.
              </p>
            )}
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
              {loading
                ? (isEditMode ? 'Updating...' : 'Creating...')
                : (isEditMode ? 'Update Bot' : 'Create Bot')
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BotConfig;
