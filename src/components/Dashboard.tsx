import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { TrendingUp, Activity, DollarSign, AlertCircle, Play, Square, Settings, RefreshCw, Globe, Zap } from 'lucide-react';

const XQTradeM8Dashboard = () => {
  const [portfolioData, setPortfolioData] = useState({
    totalValue: 247850,
    dailyChange: 8450,
    dailyChangePercent: 3.41,
    winRate: 91.3,
    totalTrades: 342
  });

  const [activeBots, setActiveBots] = useState([
    { id: 1, name: 'Neural Network Bot', strategy: 'Ensemble', status: 'running', pnl: 3892, trades: 23, winRate: 100 },
    { id: 2, name: 'Fibonacci Bot', strategy: 'Fibonacci', status: 'running', pnl: 1872, trades: 14, winRate: 85.7 },
    { id: 3, name: 'Volatility Bot', strategy: 'Volatility', status: 'paused', pnl: 1445, trades: 8, winRate: 87.5 }
  ]);

  const [recentTrades, setRecentTrades] = useState([
    { id: 1, symbol: 'BTC/USD', side: 'LONG', entry: 43200, exit: 44650, pnl: 892, time: '14:23' },
    { id: 2, symbol: 'EUR/USD', side: 'LONG', entry: 1.0965, exit: 1.1053, pnl: 145, time: '14:15' },
    { id: 3, symbol: 'ETH/USD', side: 'SHORT', entry: 2890, exit: 2810, pnl: 245, time: '13:47' },
    { id: 4, symbol: 'XAU/USD', side: 'LONG', entry: 2045.20, exit: 2078.50, pnl: 567, time: '12:58' }
  ]);

  const [performanceData, setPerformanceData] = useState([
    { date: 'Jan 23', value: 234200 },
    { date: 'Jan 24', value: 236500 },
    { date: 'Jan 25', value: 239800 },
    { date: 'Jan 26', value: 242100 },
    { date: 'Jan 27', value: 245300 },
    { date: 'Jan 28', value: 243900 },
    { date: 'Jan 29', value: 247850 }
  ]);

  const [marketData, setMarketData] = useState([
    { symbol: 'BTC/USD', price: 43584.50, change: 2.3, volume: '2.4B' },
    { symbol: 'ETH/USD', price: 2847.32, change: 1.8, volume: '890M' },
    { symbol: 'EUR/USD', price: 1.0978, change: 0.4, volume: '5.2B' },
    { symbol: 'XAU/USD', price: 2067.80, change: 0.7, volume: '1.1B' }
  ]);

  // Real-time updates simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setMarketData(prev => prev.map(item => ({
        ...item,
        price: item.price * (1 + (Math.random() - 0.5) * 0.001),
        change: item.change + (Math.random() - 0.5) * 0.1
      })));
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const toggleBot = (botId) => {
    setActiveBots(prev => prev.map(bot =>
      bot.id === botId
        ? { ...bot, status: bot.status === 'running' ? 'paused' : 'running' }
        : bot
    ));
  };

  const statCards = [
    {
      label: 'Portfolio Value',
      value: `$${portfolioData.totalValue.toLocaleString()}`,
      sub: `${portfolioData.dailyChangePercent >= 0 ? '+' : ''}${portfolioData.dailyChange.toFixed(0)} (${portfolioData.dailyChangePercent}%)`,
      subColor: portfolioData.dailyChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400',
      icon: <DollarSign className="w-5 h-5" />,
      iconBg: 'bg-blue-500/20 text-blue-400',
    },
    {
      label: 'Active Bots',
      value: activeBots.filter(b => b.status === 'running').length,
      sub: 'All systems active',
      subColor: 'text-emerald-400',
      icon: <Activity className="w-5 h-5" />,
      iconBg: 'bg-emerald-500/20 text-emerald-400',
    },
    {
      label: 'Win Rate',
      value: `${portfolioData.winRate}%`,
      sub: 'Above target',
      subColor: 'text-emerald-400',
      icon: <TrendingUp className="w-5 h-5" />,
      iconBg: 'bg-violet-500/20 text-violet-400',
    },
    {
      label: 'Total Trades',
      value: portfolioData.totalTrades,
      sub: '+23 today',
      subColor: 'text-blue-400',
      icon: <Globe className="w-5 h-5" />,
      iconBg: 'bg-amber-500/20 text-amber-400',
    },
  ];

  const systemStatuses = [
    { label: 'API Status', value: 'Operational' },
    { label: 'Database', value: 'Connected' },
    { label: 'Exchanges', value: '16 Active' },
    { label: 'AI Models', value: '14 Running' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Ambient background glow */}
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
              <p className="text-xs text-slate-400 tracking-wide uppercase">AI-Powered Trading Platform</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-3.5 py-1.5 rounded-lg">
              <div className="status-dot bg-emerald-400"></div>
              <span className="text-xs font-semibold tracking-wider">LIVE</span>
            </div>
            <button className="p-2.5 hover:bg-white/5 rounded-xl transition-colors duration-200 text-slate-400 hover:text-white">
              <Settings className="w-4.5 h-4.5" />
            </button>
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

        {/* Performance Chart & Market Data */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 glass-card p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold">Portfolio Performance</h3>
                <p className="text-xs text-slate-500 mt-0.5">7-day overview</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <div className="status-dot bg-emerald-400"></div>
                <span>Live</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={performanceData}>
                <defs>
                  <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(71,85,105,0.3)" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke="#64748b"
                  tick={{ fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(71,85,105,0.3)' }}
                  tickLine={false}
                />
                <YAxis
                  stroke="#64748b"
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(71, 85, 105, 0.4)',
                    borderRadius: '10px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
                    padding: '10px 14px',
                  }}
                  labelStyle={{ color: '#e2e8f0', fontSize: 12, marginBottom: 4 }}
                  itemStyle={{ color: '#60a5fa', fontSize: 13, fontWeight: 600 }}
                  formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Portfolio']}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ fill: '#3b82f6', r: 5, stroke: '#1e3a8a', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold mb-1">Live Market Data</h3>
            <p className="text-xs text-slate-500 mb-5">Real-time prices</p>
            <div className="space-y-3">
              {marketData.map((item, idx) => (
                <div key={idx} className="glass-inner p-3.5 transition-colors duration-200 hover:bg-slate-700/40">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-slate-200">{item.symbol}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      item.change >= 0
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-red-500/15 text-red-400'
                    }`}>
                      {item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-base font-bold">${item.price.toFixed(2)}</span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Vol {item.volume}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Trading Bots & Recent Trades */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-semibold">Active Trading Bots</h3>
                <p className="text-xs text-slate-500 mt-0.5">{activeBots.filter(b => b.status === 'running').length} of {activeBots.length} running</p>
              </div>
            </div>
            <div className="space-y-3">
              {activeBots.map(bot => (
                <div key={bot.id} className="glass-inner p-4 transition-colors duration-200 hover:bg-slate-700/40">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-100">{bot.name}</h4>
                      <p className="text-xs text-slate-500 mt-0.5">{bot.strategy} Strategy</p>
                    </div>
                    <button
                      onClick={() => toggleBot(bot.id)}
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
                      <p className={`text-sm font-bold mt-0.5 ${bot.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        ${bot.pnl.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider">Trades</p>
                      <p className="text-sm font-bold mt-0.5">{bot.trades}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider">Win Rate</p>
                      <p className="text-sm font-bold mt-0.5">{bot.winRate}%</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-semibold">Recent Trades</h3>
                <p className="text-xs text-slate-500 mt-0.5">{recentTrades.length} trades today</p>
              </div>
            </div>
            <div className="space-y-3">
              {recentTrades.map(trade => (
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
                        <p className="text-[10px] text-slate-500 mt-0.5">{trade.time}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {trade.pnl >= 0 ? '+' : ''}${trade.pnl}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5 tabular-nums">{trade.entry} → {trade.exit}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* System Status */}
        <section className="glass-card p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-lg font-semibold">System Status</h3>
              <p className="text-xs text-slate-500 mt-0.5">All systems operational</p>
            </div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Last checked: just now</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {systemStatuses.map((status, idx) => (
              <div key={idx} className="glass-inner p-4 flex items-center gap-3">
                <div className="status-dot bg-emerald-400"></div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{status.label}</p>
                  <p className="text-sm font-semibold mt-0.5">{status.value}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

      </main>
    </div>
  );
};

export default XQTradeM8Dashboard;
