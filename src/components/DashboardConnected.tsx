import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Activity, DollarSign, Globe, Zap, Play, Square, Settings, LogOut, Plus, ChevronDown, Wallet, BarChart2 } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useTradingMode } from '../lib/TradingModeContext';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import web3Service, { WalletInfo } from '../lib/web3';
import BotConfig from './BotConfig';
import SettingsModal from './Settings';
import TradingViewChart from './TradingViewChart';
import TradingViewWebhook from './TradingViewWebhook';
import { TradingBot, Trade, Portfolio } from '../types';

const DashboardConnected = () => {
  const { user, logout, token } = useAuth() as any;
  const { mode, setMode, isPaperTrading, isLiveTrading } = useTradingMode();
  const navigate = useNavigate();

  const [portfolio, setPortfolio] = useState<Portfolio>({
    total_value: 0,
    daily_change: 0,
    daily_change_percent: 0,
    unrealized_pnl: 0,
    realized_pnl: 0,
  });

  const [activeBots, setActiveBots] = useState<TradingBot[]>([]);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [showBotConfig, setShowBotConfig] = useState(false);
  const [selectedBot, setSelectedBot] = useState<TradingBot | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showTradingView, setShowTradingView] = useState(false);
  const [tvChartSymbol, setTvChartSymbol] = useState('BINANCE:BTCUSDT');
  const [showTVWebhook, setShowTVWebhook] = useState(false);
  const [loading, setLoading] = useState(true);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadDashboardData = async () => {
    try {
      const [portfolioData, botsData, tradesData] = await Promise.all([
        api.getPortfolio().catch(() => null),
        api.getBots().catch(() => []),
        api.getTrades(10).catch(() => []),
      ]);

      if (portfolioData) {
        setPortfolio({
          total_value: portfolioData.portfolio?.total_value || 0,
          daily_change: portfolioData.portfolio?.daily_change || 0,
          daily_change_percent: portfolioData.portfolio?.daily_change_percent || 0,
          unrealized_pnl: portfolioData.unrealizedPnL || 0,
          realized_pnl: portfolioData.portfolio?.realized_pnl || 0,
        });
      }

      setActiveBots(botsData);
      setRecentTrades(tradesData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleWalletConnect = async () => {
    try {
      const info = await web3Service.connect();
      setWalletInfo(info);
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleWalletDisconnect = () => {
    web3Service.disconnect();
    setWalletInfo(null);
  };

  const toggleBot = async (botId: string) => {
    const bot = activeBots.find(b => b.id === botId);
    if (!bot) return;

    try {
      if (bot.status === 'running') {
        await api.stopBot(botId);
      } else {
        await api.startBot(botId);
      }
      await loadDashboardData();
    } catch (error) {
      console.error('Failed to toggle bot:', error);
    }
  };

  const handleBotClick = (bot: TradingBot) => {
    setSelectedBot(bot);
    setShowBotConfig(true);
  };

  const handleNewBot = () => {
    setSelectedBot(null);
    setShowBotConfig(true);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const statCards = [
    {
      label: 'Portfolio Value',
      value: `$${portfolio.total_value.toLocaleString()}`,
      sub: `${portfolio.daily_change_percent >= 0 ? '+' : ''}${portfolio.daily_change.toFixed(0)} (${portfolio.daily_change_percent.toFixed(2)}%)`,
      subColor: portfolio.daily_change_percent >= 0 ? 'text-emerald-400' : 'text-red-400',
      icon: <DollarSign className="w-5 h-5" />,
      iconBg: 'bg-blue-500/20 text-blue-400',
    },
    {
      label: 'Active Bots',
      value: activeBots.filter(b => b.status === 'running').length,
      sub: `${activeBots.length} total`,
      subColor: 'text-emerald-400',
      icon: <Activity className="w-5 h-5" />,
      iconBg: 'bg-emerald-500/20 text-emerald-400',
    },
    {
      label: 'Unrealized P&L',
      value: `$${portfolio.unrealized_pnl.toLocaleString()}`,
      sub: 'Open positions',
      subColor: portfolio.unrealized_pnl >= 0 ? 'text-emerald-400' : 'text-red-400',
      icon: <TrendingUp className="w-5 h-5" />,
      iconBg: 'bg-violet-500/20 text-violet-400',
    },
    {
      label: 'Total Trades',
      value: recentTrades.length,
      sub: 'Last 24 hours',
      subColor: 'text-blue-400',
      icon: <Globe className="w-5 h-5" />,
      iconBg: 'bg-amber-500/20 text-amber-400',
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-600/6 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="glass-header sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-blue-500 to-blue-700 p-2.5 rounded-xl shadow-lg shadow-blue-500/20">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight glow-text">XQ Trade M8</h1>
              <p className="text-xs text-slate-400">Welcome back, {user?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Paper / Live trading toggle */}
            <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/50 rounded-lg p-1">
              <button
                onClick={() => setMode('paper')}
                className={`text-[11px] font-semibold px-3 py-1 rounded-md transition-all ${
                  isPaperTrading
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                PAPER
              </button>
              <button
                onClick={() => {
                  if (confirm('⚠️ Switch to LIVE TRADING? This uses real money.\n\nEnsure you have configured exchange API keys and tested your strategies in paper mode.')) {
                    setMode('live');
                  }
                }}
                className={`text-[11px] font-semibold px-3 py-1 rounded-md transition-all ${
                  isLiveTrading
                    ? 'bg-red-600 text-white shadow-sm animate-pulse'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                LIVE
              </button>
            </div>

            {/* Connect Wallet */}
            {walletInfo ? (
              <button
                onClick={handleWalletDisconnect}
                className="flex items-center gap-2 px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 border border-violet-500/30 rounded-lg text-xs font-semibold transition-all"
              >
                <Wallet className="w-3.5 h-3.5" />
                {walletInfo.address.slice(0, 6)}...{walletInfo.address.slice(-4)}
              </button>
            ) : (
              <button
                onClick={handleWalletConnect}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700/70 rounded-lg text-xs font-semibold transition-all"
              >
                <Wallet className="w-3.5 h-3.5" />
                Connect Wallet
              </button>
            )}

            <button
              onClick={() => setShowTradingView(prev => !prev)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                showTradingView
                  ? 'bg-orange-500 text-white'
                  : 'bg-slate-700/50 hover:bg-slate-700/70 text-slate-300'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              Charts
            </button>

            <button
              onClick={handleNewBot}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-semibold transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              New Bot
            </button>

            {/* Settings dropdown */}
            <div className="relative" ref={settingsMenuRef}>
              <button
                onClick={() => setShowSettingsMenu(prev => !prev)}
                className="flex items-center gap-1.5 p-2.5 hover:bg-white/5 rounded-xl transition-colors text-slate-400 hover:text-white"
              >
                <Settings className="w-4 h-4" />
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showSettingsMenu ? 'rotate-180' : ''}`} />
              </button>

              {showSettingsMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 glass-card border border-slate-700/60 rounded-xl shadow-xl z-50 overflow-hidden">
                  <button
                    onClick={() => { setShowSettings(true); setShowSettingsMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </button>
                  <div className="border-t border-slate-700/50" />
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Log Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats Overview */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {statCards.map((card, idx) => (
            <div key={idx} className="glass-card glass-card-hover p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{card.label}</p>
                  <p className="text-2xl font-bold tracking-tight">{card.value}</p>
                  <p className={`text-xs font-medium ${card.subColor}`}>{card.sub}</p>
                </div>
                <div className={`stat-icon ${card.iconBg}`}>
                  {card.icon}
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* Trading Bots & Recent Trades */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-semibold">Trading Bots</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {activeBots.filter(b => b.status === 'running').length} of {activeBots.length} active
                </p>
              </div>
            </div>
            {activeBots.length === 0 ? (
              <div className="glass-inner p-8 text-center">
                <p className="text-slate-400 mb-4">No trading bots configured yet</p>
                <button
                  onClick={handleNewBot}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-semibold transition-all"
                >
                  Create Your First Bot
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {activeBots.map(bot => (
                  <div
                    key={bot.id}
                    onClick={() => handleBotClick(bot)}
                    className="glass-inner p-4 transition-colors duration-200 hover:bg-slate-700/40 cursor-pointer group relative"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-100 group-hover:text-blue-400 transition-colors">{bot.name}</h4>
                        <p className="text-xs text-slate-500 mt-0.5">{bot.strategy} • {bot.symbol}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleBot(bot.id);
                        }}
                        className={`p-2 rounded-lg transition-all duration-200 ${
                          bot.status === 'running'
                            ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                            : 'bg-slate-600/40 text-slate-400 hover:bg-slate-600/60'
                        }`}
                      >
                        {bot.status === 'running'
                        ? <Square className="w-3.5 h-3.5 fill-current" />
                        : <Play className="w-3.5 h-3.5 fill-current" />
                      }
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">P&L</p>
                        <p className={`text-sm font-bold mt-0.5 ${(bot.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          ${(bot.pnl || 0).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">Trades</p>
                        <p className="text-sm font-bold mt-0.5">{bot.trades || 0}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">Win Rate</p>
                        <p className="text-sm font-bold mt-0.5">{(bot.win_rate || 0).toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-semibold">Recent Trades</h3>
                <p className="text-xs text-slate-500 mt-0.5">{recentTrades.length} trades</p>
              </div>
            </div>
            {recentTrades.length === 0 ? (
              <div className="glass-inner p-8 text-center">
                <p className="text-slate-400">No trades yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentTrades.slice(0, 5).map(trade => (
                  <div key={trade.id} className="glass-inner p-4 transition-colors duration-200 hover:bg-slate-700/40">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold tracking-wider ${
                          trade.side === 'LONG'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}>
                          {trade.side === 'LONG' ? 'L' : 'S'}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-100">{trade.symbol}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{trade.status}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${(trade.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {(trade.pnl || 0) >= 0 ? '+' : ''}${(trade.pnl || 0).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">@{trade.entry_price}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* TradingView Chart Section */}
        {showTradingView && (
          <section className="mt-6 space-y-4">
            {/* Symbol selector + Webhook toggle */}
            <div className="flex flex-wrap items-center gap-3 px-1">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-orange-400" />
                TradingView Charts
              </h2>
              <select
                value={tvChartSymbol}
                onChange={e => setTvChartSymbol(e.target.value)}
                className="text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-orange-500"
              >
                <optgroup label="Crypto">
                  <option value="BINANCE:BTCUSDT">BTC/USDT</option>
                  <option value="BINANCE:ETHUSDT">ETH/USDT</option>
                  <option value="BINANCE:SOLUSDT">SOL/USDT</option>
                  <option value="BINANCE:BNBUSDT">BNB/USDT</option>
                  <option value="BINANCE:XRPUSDT">XRP/USDT</option>
                </optgroup>
                <optgroup label="Forex">
                  <option value="FX:EURUSD">EUR/USD</option>
                  <option value="FX:GBPUSD">GBP/USD</option>
                  <option value="FX:USDJPY">USD/JPY</option>
                  <option value="FX:USDCHF">USD/CHF</option>
                  <option value="FX:AUDUSD">AUD/USD</option>
                </optgroup>
                <optgroup label="Commodities">
                  <option value="OANDA:XAUUSD">Gold (XAU/USD)</option>
                  <option value="OANDA:XAGUSD">Silver (XAG/USD)</option>
                  <option value="OANDA:WTICOUSD">Crude Oil (WTI)</option>
                </optgroup>
                <optgroup label="Indices">
                  <option value="SP:SPX">S&P 500</option>
                  <option value="DJ:DJI">Dow Jones</option>
                  <option value="NASDAQ:NDX">NASDAQ 100</option>
                </optgroup>
              </select>
              <button
                onClick={() => setShowTVWebhook(prev => !prev)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all border ${
                  showTVWebhook
                    ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                    : 'bg-slate-700/50 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {showTVWebhook ? 'Hide' : 'Webhook Setup'}
              </button>
            </div>

            {/* Chart */}
            <div className="glass-card rounded-2xl overflow-hidden border border-slate-700/40">
              <TradingViewChart
                symbol={tvChartSymbol}
                interval="60"
                theme="dark"
                height={520}
              />
            </div>

            {/* Webhook Panel */}
            {showTVWebhook && (
              <div className="glass-card rounded-2xl border border-slate-700/40 overflow-hidden">
                <TradingViewWebhook token={token} />
              </div>
            )}
          </section>
        )}
      </main>

      {/* Bot Config Modal */}
      {showBotConfig && (
        <BotConfig
          bot={selectedBot}
          onClose={() => {
            setShowBotConfig(false);
            setSelectedBot(null);
          }}
          onBotCreated={loadDashboardData}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
};

export default DashboardConnected;
