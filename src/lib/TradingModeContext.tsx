import React, { createContext, useContext, useState } from 'react';

export type TradingMode = 'paper' | 'live';

interface TradingModeContextType {
  mode: TradingMode;
  setMode: (mode: TradingMode) => void;
  isPaperTrading: boolean;
  isLiveTrading: boolean;
}

const TradingModeContext = createContext<TradingModeContextType | undefined>(undefined);

export const TradingModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<TradingMode>(() => {
    // Load from localStorage or default to paper
    const saved = localStorage.getItem('tradingMode');
    return (saved === 'live' ? 'live' : 'paper') as TradingMode;
  });

  const setMode = (newMode: TradingMode) => {
    setModeState(newMode);
    localStorage.setItem('tradingMode', newMode);

    // Show confirmation
    const modeLabel = newMode === 'live' ? 'LIVE TRADING' : 'PAPER TRADING';
    console.log(`Trading mode switched to: ${modeLabel}`);
  };

  const value = {
    mode,
    setMode,
    isPaperTrading: mode === 'paper',
    isLiveTrading: mode === 'live',
  };

  return (
    <TradingModeContext.Provider value={value}>
      {children}
    </TradingModeContext.Provider>
  );
};

export const useTradingMode = () => {
  const context = useContext(TradingModeContext);
  if (!context) {
    throw new Error('useTradingMode must be used within TradingModeProvider');
  }
  return context;
};
