/**
 * TradingView Chart Widget Component
 *
 * Embeds TradingView's Advanced Chart widget for real-time price visualization.
 * Supports all symbols available on TradingView (crypto, forex, stocks, commodities).
 *
 * Usage:
 *   <TradingViewChart symbol="BINANCE:BTCUSDT" />
 *   <TradingViewChart symbol="OANDA:XAUUSD" theme="dark" interval="60" />
 */

import { useEffect, useRef, memo } from 'react';

export interface TradingViewChartProps {
  /** TradingView symbol, e.g. "BINANCE:BTCUSDT", "OANDA:XAUUSD", "FX:EURUSD" */
  symbol?: string;
  /** Chart interval in minutes, or "D", "W", "M" */
  interval?: string;
  /** Widget theme */
  theme?: 'light' | 'dark';
  /** Height in pixels */
  height?: number;
  /** Show toolbar with drawing tools */
  toolbar?: boolean;
  /** Show symbol search bar */
  showSymbolSearch?: boolean;
  /** Additional className */
  className?: string;
}

// Map our internal symbols to TradingView format
function toTVSymbol(symbol: string): string {
  // Already has exchange prefix (e.g. "BINANCE:BTCUSDT")
  if (symbol.includes(':')) return symbol;

  const s = symbol.toUpperCase();

  // Forex / metals
  const forexMap: Record<string, string> = {
    'EUR/USD': 'FX:EURUSD', 'GBP/USD': 'FX:GBPUSD', 'USD/JPY': 'FX:USDJPY',
    'USD/CHF': 'FX:USDCHF', 'AUD/USD': 'FX:AUDUSD', 'USD/CAD': 'FX:USDCAD',
    'NZD/USD': 'FX:NZDUSD', 'EUR/GBP': 'FX:EURGBP', 'EUR/JPY': 'FX:EURJPY',
    'GBP/JPY': 'FX:GBPJPY', 'XAU/USD': 'OANDA:XAUUSD', 'XAG/USD': 'OANDA:XAGUSD',
    'XPT/USD': 'OANDA:XPTUSD', 'WTICO/USD': 'OANDA:WTICOUSD', 'BCO/USD': 'OANDA:BCOUSD',
    'US30/USD': 'DJ:DJI', 'SPX500/USD': 'SP:SPX', 'NAS100/USD': 'NASDAQ:NDX',
    'UK100/GBP': 'SPREADEX:UK100', 'DE30/EUR': 'SPREADEX:DE30', 'JP225/USD': 'SPREADEX:JP225',
  };
  if (forexMap[s]) return forexMap[s];

  // Crypto — default to Binance
  if (s.includes('/')) {
    const [base, quote] = s.split('/');
    return `BINANCE:${base}${quote}`;
  }

  // Raw crypto symbol without slash
  return `BINANCE:${s}USDT`;
}

const TradingViewChart = memo(({
  symbol = 'BINANCE:BTCUSDT',
  interval = '60',
  theme = 'dark',
  height = 500,
  toolbar = true,
  showSymbolSearch = true,
  className = '',
}: TradingViewChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);

  const tvSymbol = toTVSymbol(symbol);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous widget
    if (widgetRef.current) {
      containerRef.current.innerHTML = '';
      widgetRef.current = null;
    }

    const containerId = `tv_chart_${Math.random().toString(36).slice(2)}`;
    containerRef.current.id = containerId;

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      if (!(window as any).TradingView || !containerRef.current) return;

      widgetRef.current = new (window as any).TradingView.widget({
        autosize: true,
        symbol: tvSymbol,
        interval,
        timezone: 'Etc/UTC',
        theme,
        style: '1',
        locale: 'en',
        toolbar_bg: theme === 'dark' ? '#1a1a2e' : '#f0f3fa',
        enable_publishing: false,
        allow_symbol_change: showSymbolSearch,
        hide_top_toolbar: !toolbar,
        hide_legend: false,
        withdateranges: true,
        save_image: false,
        container_id: containerId,
        studies: [
          { id: 'MASimple@tv-basicstudies', inputs: { length: 20 } },
          { id: 'RSI@tv-basicstudies', inputs: { length: 14 } },
          { id: 'MACD@tv-basicstudies' },
        ],
        overrides: {
          'mainSeriesProperties.candleStyle.upColor': '#26a69a',
          'mainSeriesProperties.candleStyle.downColor': '#ef5350',
          'mainSeriesProperties.candleStyle.borderUpColor': '#26a69a',
          'mainSeriesProperties.candleStyle.borderDownColor': '#ef5350',
          'mainSeriesProperties.candleStyle.wickUpColor': '#26a69a',
          'mainSeriesProperties.candleStyle.wickDownColor': '#ef5350',
        },
      });
    };

    document.head.appendChild(script);

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = '';
      widgetRef.current = null;
      // Clean up script tag if it's still in the document
      const scripts = document.querySelectorAll('script[src="https://s3.tradingview.com/tv.js"]');
      scripts.forEach(s => s.remove());
    };
  }, [tvSymbol, interval, theme, toolbar, showSymbolSearch]);

  return (
    <div className={`tradingview-chart-wrapper ${className}`} style={{ height }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
});

TradingViewChart.displayName = 'TradingViewChart';

export default TradingViewChart;
