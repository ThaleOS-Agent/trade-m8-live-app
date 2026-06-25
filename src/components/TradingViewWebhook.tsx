/**
 * TradingView Webhook Manager Component
 *
 * Shows:
 * - Webhook URL to paste into TradingView alert
 * - Alert message format / Pine Script template
 * - Recent signals received from TradingView
 * - Connection test button
 */

import { useState, useEffect, useCallback } from 'react';

const BASE_URL = 'https://trade-m8-live-app.pages.dev';
const WEBHOOK_URL = `${BASE_URL}/api/tradingview/webhook`;

interface Signal {
  id: string;
  action: string;
  symbol: string;
  exchange: string;
  strategy: string;
  status: string;
  alert_price: number | null;
  quantity: number | null;
  message: string | null;
  order_id: string | null;
  error: string | null;
  received_at: string;
}

interface TradingViewWebhookProps {
  token?: string;
}

export default function TradingViewWebhook({ token }: TradingViewWebhookProps) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${BASE_URL}/api/tradingview/status`, {
        headers: { 'User-Agent': 'TradeM8/1.0' }
      });
      const d = await r.json() as any;
      setStatus(d);
    } catch { /* ignore */ }
  }, []);

  const fetchSignals = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/api/tradingview/signals?limit=20`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'TradeM8/1.0' }
      });
      const d = await r.json() as any;
      setSignals(d.signals ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchStatus();
    fetchSignals();
  }, [fetchStatus, fetchSignals]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const testWebhook = async () => {
    if (!token) return;
    setTestResult('Testing...');
    try {
      const r = await fetch(`${BASE_URL}/api/tradingview/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'TradeM8/1.0' },
        body: JSON.stringify({ test: true }),
      });
      const d = await r.json() as any;
      setTestResult(d.success ? '✓ Webhook endpoint reachable' : `✗ ${d.error}`);
    } catch (e: any) {
      setTestResult(`✗ ${e.message}`);
    }
  };

  const jsonTemplate = `{
  "action": "buy",
  "symbol": "BTCUSDT",
  "exchange": "BINANCE",
  "price": {{close}},
  "quantity": 0.001,
  "tp": {{strategy.position_avg_price}} * 1.02,
  "sl": {{strategy.position_avg_price}} * 0.98
}`;

  const statusColor = (s: string) => {
    switch (s) {
      case 'executed': return '#26a69a';
      case 'received': return '#f59e0b';
      case 'failed':   return '#ef5350';
      case 'rejected': return '#9ca3af';
      default:         return '#6b7280';
    }
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', maxWidth: '900px' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px' }}>
        TradingView Integration
      </h2>
      <p style={{ color: '#6b7280', marginBottom: '24px' }}>
        Connect TradingView strategy alerts to automatically execute trades on Trade M8.
      </p>

      {/* Status banner */}
      {status && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '12px 16px', marginBottom: '24px' }}>
          <span style={{ color: '#166534', fontWeight: 600 }}>
            ✓ Webhook Active
          </span>
          <span style={{ color: '#4b5563', marginLeft: '12px', fontSize: '0.875rem' }}>
            {status.connectedExchanges?.length ?? 0} exchanges connected
            {status.secretConfigured ? ' · Secret configured' : ' · No secret (dev mode)'}
          </span>
        </div>
      )}

      {/* Webhook URL */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>1. Webhook URL</h3>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '8px' }}>
          Paste this URL in TradingView → Alerts → Notifications → Webhook URL
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <code style={{
            flex: 1, background: '#1e1e2e', color: '#a9b1d6', padding: '10px 14px',
            borderRadius: '6px', fontSize: '0.875rem', wordBreak: 'break-all'
          }}>
            {WEBHOOK_URL}
          </code>
          <button
            onClick={() => copyToClipboard(WEBHOOK_URL, 'url')}
            style={{
              padding: '10px 14px', background: '#3b82f6', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap'
            }}
          >
            {copied === 'url' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Alert Message Format */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>2. Alert Message (Pine Script)</h3>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '8px' }}>
          Paste this JSON in the TradingView alert "Message" field. TradingView fills in <code>{"{{placeholders}}"}</code> automatically.
        </p>
        <div style={{ position: 'relative' }}>
          <pre style={{
            background: '#1e1e2e', color: '#a9b1d6', padding: '16px', borderRadius: '8px',
            fontSize: '0.8rem', overflowX: 'auto', margin: 0
          }}>
            {jsonTemplate}
          </pre>
          <button
            onClick={() => copyToClipboard(jsonTemplate, 'json')}
            style={{
              position: 'absolute', top: '8px', right: '8px',
              padding: '4px 10px', background: '#3b82f6', color: 'white',
              border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem'
            }}
          >
            {copied === 'json' ? '✓' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Supported Actions */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>3. Supported Fields</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.875rem' }}>
          {[
            { field: 'action', desc: 'buy | sell | close_long | close_short | hold', required: true },
            { field: 'symbol', desc: 'BTCUSDT, EURUSD, XAUUSD, ...', required: true },
            { field: 'exchange', desc: 'BINANCE, OANDA, BYBIT, ...', required: false },
            { field: 'price', desc: 'Entry price (use {{close}})', required: false },
            { field: 'quantity', desc: 'Order size (units/lots)', required: false },
            { field: 'tp', desc: 'Take profit price', required: false },
            { field: 'sl', desc: 'Stop loss price', required: false },
            { field: 'strategy', desc: 'Strategy name for logging', required: false },
          ].map(({ field, desc, required }) => (
            <div key={field} style={{ background: '#f9fafb', padding: '8px 12px', borderRadius: '6px' }}>
              <code style={{ color: '#1d4ed8', fontWeight: 600 }}>{field}</code>
              {required && <span style={{ color: '#dc2626', fontSize: '0.7rem', marginLeft: '4px' }}>required</span>}
              <p style={{ margin: '2px 0 0', color: '#6b7280', fontSize: '0.8rem' }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pine Script Template */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>4. Pine Script Example</h3>
        <pre style={{
          background: '#1e1e2e', color: '#a9b1d6', padding: '16px', borderRadius: '8px',
          fontSize: '0.8rem', overflowX: 'auto'
        }}>
          {`//@version=5
strategy("Trade M8 Strategy", overlay=true)

// Your strategy logic here
fastMA = ta.ema(close, 9)
slowMA = ta.ema(close, 21)

longCondition = ta.crossover(fastMA, slowMA)
shortCondition = ta.crossunder(fastMA, slowMA)

if longCondition
    strategy.entry("Long", strategy.long,
        alert_message='{"action":"buy","symbol":"{{ticker}}","exchange":"{{exchange}}","price":{{close}},"quantity":0.001,"strategy":"ema_cross"}')

if shortCondition
    strategy.entry("Short", strategy.short,
        alert_message='{"action":"sell","symbol":"{{ticker}}","exchange":"{{exchange}}","price":{{close}},"quantity":0.001,"strategy":"ema_cross"}')
`}
        </pre>
      </div>

      {/* Test + Refresh */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', alignItems: 'center' }}>
        <button
          onClick={testWebhook}
          disabled={!token}
          style={{
            padding: '8px 16px', background: token ? '#059669' : '#9ca3af',
            color: 'white', border: 'none', borderRadius: '6px', cursor: token ? 'pointer' : 'not-allowed'
          }}
        >
          Test Connection
        </button>
        <button
          onClick={fetchSignals}
          disabled={!token}
          style={{
            padding: '8px 16px', background: token ? '#3b82f6' : '#9ca3af',
            color: 'white', border: 'none', borderRadius: '6px', cursor: token ? 'pointer' : 'not-allowed'
          }}
        >
          Refresh Signals
        </button>
        {testResult && (
          <span style={{ color: testResult.startsWith('✓') ? '#059669' : '#dc2626', fontSize: '0.875rem' }}>
            {testResult}
          </span>
        )}
      </div>

      {/* Recent Signals */}
      <div>
        <h3 style={{ fontWeight: 600, marginBottom: '12px' }}>Recent TradingView Signals</h3>
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading...</p>
        ) : signals.length === 0 ? (
          <div style={{ background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#6b7280' }}>
            No signals received yet. Set up your TradingView alert with the webhook URL above.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {['Time', 'Action', 'Symbol', 'Exchange', 'Price', 'Status', 'Order ID'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {signals.map(sig => (
                  <tr key={sig.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: '0.8rem' }}>
                      {new Date(sig.received_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600,
                        background: sig.action === 'buy' ? '#dcfce7' : sig.action === 'sell' ? '#fee2e2' : '#f3f4f6',
                        color: sig.action === 'buy' ? '#166534' : sig.action === 'sell' ? '#991b1b' : '#374151',
                      }}>
                        {sig.action.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: 500 }}>{sig.symbol}</td>
                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>{sig.exchange}</td>
                    <td style={{ padding: '8px 12px' }}>{sig.alert_price ? `$${sig.alert_price.toLocaleString()}` : '—'}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600,
                        background: `${statusColor(sig.status)}22`,
                        color: statusColor(sig.status),
                      }}>
                        {sig.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#6b7280', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {sig.order_id ? sig.order_id.slice(0, 16) + '...' : sig.error ? `Error: ${sig.error.slice(0, 30)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
