import React, { useState } from 'react';
import { X, Save, Key, Bell, Shield, User, Zap } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useTradingMode } from '../lib/TradingModeContext';

interface SettingsProps {
  onClose: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const { user } = useAuth();
  const { mode, setMode, isPaperTrading, isLiveTrading } = useTradingMode();
  const [activeTab, setActiveTab] = useState<'trading' | 'profile' | 'api' | 'notifications' | 'security'>('trading');

  const [profile, setProfile] = useState({
    name: user?.name || '',
    email: user?.email || '',
  });

  const [apiKeys, setApiKeys] = useState({
    binanceKey: '',
    binanceSecret: '',
    oandaKey: '',
    krakenKey: '',
  });

  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    tradeNotifications: true,
    profitAlerts: true,
    lossAlerts: true,
  });

  const [security, setSecurity] = useState({
    twoFactorEnabled: false,
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Simulate save
      await new Promise(resolve => setTimeout(resolve, 1000));
      alert('Settings saved successfully!');
      onClose();
    } catch (error) {
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'trading', label: 'Trading Mode', icon: <Zap className="w-4 h-4" /> },
    { id: 'profile', label: 'Profile', icon: <User className="w-4 h-4" /> },
    { id: 'api', label: 'API Keys', icon: <Key className="w-4 h-4" /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
    { id: 'security', label: 'Security', icon: <Shield className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-card max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
          <h2 className="text-2xl font-bold">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 border-r border-slate-700/50 p-4 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:bg-slate-700/40 hover:text-white'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeTab === 'trading' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Trading Mode</h3>
                  <p className="text-sm text-slate-400 mb-6">
                    Switch between paper trading (simulated) and live trading (real money)
                  </p>

                  <div className="space-y-4">
                    {/* Paper Trading Option */}
                    <div
                      onClick={() => setMode('paper')}
                      className={`glass-inner p-5 cursor-pointer transition-all duration-200 ${
                        isPaperTrading
                          ? 'bg-blue-600/20 border-2 border-blue-500/50 ring-2 ring-blue-500/20'
                          : 'border border-slate-700/50 hover:bg-slate-700/30'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="bg-blue-500/20 text-blue-400 p-2 rounded-lg">
                              <Zap className="w-5 h-5" />
                            </div>
                            <h4 className="text-lg font-semibold">Paper Trading</h4>
                            {isPaperTrading && (
                              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs font-semibold rounded-full">
                                ACTIVE
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-300 mb-3">
                            Practice trading with virtual money. Perfect for testing strategies without risk.
                          </p>
                          <ul className="text-xs text-slate-400 space-y-1">
                            <li>• No real money involved</li>
                            <li>• Test strategies safely</li>
                            <li>• Unlimited virtual funds</li>
                            <li>• Real market data</li>
                          </ul>
                        </div>
                        <div className="ml-4">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            isPaperTrading ? 'border-blue-500 bg-blue-500' : 'border-slate-600'
                          }`}>
                            {isPaperTrading && (
                              <div className="w-2.5 h-2.5 rounded-full bg-white"></div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Live Trading Option */}
                    <div
                      onClick={() => {
                        if (confirm('⚠️ IMPORTANT: Switching to LIVE TRADING mode will use REAL MONEY.\n\nMake sure you:\n✓ Have configured your exchange API keys\n✓ Understand the risks involved\n✓ Have tested your strategies in paper mode\n\nDo you want to continue?')) {
                          setMode('live');
                        }
                      }}
                      className={`glass-inner p-5 cursor-pointer transition-all duration-200 ${
                        isLiveTrading
                          ? 'bg-red-600/20 border-2 border-red-500/50 ring-2 ring-red-500/20'
                          : 'border border-slate-700/50 hover:bg-slate-700/30'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="bg-red-500/20 text-red-400 p-2 rounded-lg">
                              <Zap className="w-5 h-5" />
                            </div>
                            <h4 className="text-lg font-semibold">Live Trading</h4>
                            {isLiveTrading && (
                              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs font-semibold rounded-full animate-pulse">
                                LIVE
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-300 mb-3">
                            Trade with real money on connected exchanges. Use with caution.
                          </p>
                          <ul className="text-xs text-slate-400 space-y-1">
                            <li>• Real money trading</li>
                            <li>• Actual profit and loss</li>
                            <li>• Requires exchange API keys</li>
                            <li>• Risk management essential</li>
                          </ul>
                        </div>
                        <div className="ml-4">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            isLiveTrading ? 'border-red-500 bg-red-500' : 'border-slate-600'
                          }`}>
                            {isLiveTrading && (
                              <div className="w-2.5 h-2.5 rounded-full bg-white"></div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Warning Banner */}
                    {isLiveTrading && (
                      <div className="glass-inner p-4 bg-red-500/10 border border-red-500/30">
                        <div className="flex items-start gap-3">
                          <div className="text-red-400 mt-0.5">
                            <Shield className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-red-300 mb-1">Live Trading Active</h4>
                            <p className="text-sm text-red-200">
                              You are currently in LIVE mode. All trades will use real money. Please ensure you have:
                            </p>
                            <ul className="text-xs text-red-200 mt-2 space-y-1">
                              <li>✓ Configured risk management settings</li>
                              <li>✓ Set appropriate stop-loss limits</li>
                              <li>✓ Tested strategies in paper mode</li>
                              <li>✓ Only trading with money you can afford to lose</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'profile' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-semibold mb-4">Profile Information</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={profile.name}
                        onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                        className="w-full px-4 py-2.5 bg-slate-700/50 border border-slate-700/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                        placeholder="Enter your name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={profile.email}
                        onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                        className="w-full px-4 py-2.5 bg-slate-700/50 border border-slate-700/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                        placeholder="your@email.com"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Exchange API Keys</h3>
                  <p className="text-sm text-slate-400 mb-4">
                    Connect your exchange accounts for live trading
                  </p>
                  <div className="space-y-4">
                    <div className="glass-inner p-4">
                      <h4 className="font-semibold mb-3">Binance</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm text-slate-400 mb-1">API Key</label>
                          <input
                            type="password"
                            value={apiKeys.binanceKey}
                            onChange={(e) => setApiKeys({ ...apiKeys, binanceKey: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            placeholder="Enter API key"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-slate-400 mb-1">Secret Key</label>
                          <input
                            type="password"
                            value={apiKeys.binanceSecret}
                            onChange={(e) => setApiKeys({ ...apiKeys, binanceSecret: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            placeholder="Enter secret key"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="glass-inner p-4">
                      <h4 className="font-semibold mb-3">OANDA (Forex)</h4>
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">API Key</label>
                        <input
                          type="password"
                          value={apiKeys.oandaKey}
                          onChange={(e) => setApiKeys({ ...apiKeys, oandaKey: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                          placeholder="Enter API key"
                        />
                      </div>
                    </div>

                    <div className="glass-inner p-4">
                      <h4 className="font-semibold mb-3">Kraken</h4>
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">API Key</label>
                        <input
                          type="password"
                          value={apiKeys.krakenKey}
                          onChange={(e) => setApiKeys({ ...apiKeys, krakenKey: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                          placeholder="Enter API key"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Notification Preferences</h3>
                  <p className="text-sm text-slate-400 mb-4">
                    Choose how you want to be notified
                  </p>
                  <div className="space-y-3">
                    {[
                      { key: 'emailAlerts', label: 'Email Alerts', desc: 'Receive email notifications' },
                      { key: 'tradeNotifications', label: 'Trade Notifications', desc: 'Get notified when trades execute' },
                      { key: 'profitAlerts', label: 'Profit Alerts', desc: 'Alert when profits exceed threshold' },
                      { key: 'lossAlerts', label: 'Loss Alerts', desc: 'Alert when losses exceed threshold' },
                    ].map((item) => (
                      <div key={item.key} className="glass-inner p-4 flex items-center justify-between">
                        <div>
                          <p className="font-medium">{item.label}</p>
                          <p className="text-sm text-slate-400">{item.desc}</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={notifications[item.key as keyof typeof notifications]}
                            onChange={(e) => setNotifications({ ...notifications, [item.key]: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Security Settings</h3>
                  <p className="text-sm text-slate-400 mb-4">
                    Manage your account security
                  </p>

                  <div className="space-y-4">
                    <div className="glass-inner p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">Two-Factor Authentication</p>
                          <p className="text-sm text-slate-400">Add extra security to your account</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={security.twoFactorEnabled}
                            onChange={(e) => setSecurity({ ...security, twoFactorEnabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                      </div>
                    </div>

                    <div className="glass-inner p-4 space-y-3">
                      <h4 className="font-semibold mb-3">Change Password</h4>
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">Current Password</label>
                        <input
                          type="password"
                          value={security.currentPassword}
                          onChange={(e) => setSecurity({ ...security, currentPassword: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                          placeholder="Enter current password"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">New Password</label>
                        <input
                          type="password"
                          value={security.newPassword}
                          onChange={(e) => setSecurity({ ...security, newPassword: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                          placeholder="Enter new password"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">Confirm New Password</label>
                        <input
                          type="password"
                          value={security.confirmPassword}
                          onChange={(e) => setSecurity({ ...security, confirmPassword: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                          placeholder="Confirm new password"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-700/50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700/50 hover:bg-slate-700/70 rounded-lg text-sm font-medium transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
