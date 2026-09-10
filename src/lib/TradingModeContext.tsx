import React, { createContext, useContext, useEffect, useState } from 'react';
import api from './api';

export type TradingMode = 'paper' | 'live';

interface TradingRuntimeConfig {
  paperEnabled: boolean;
  liveEnabled: boolean;
  demoMode: boolean;
  executorPaperMode: boolean;
  effectiveTradingMode: TradingMode;
  canActivateLiveTrading: boolean;
}

interface TradingRuntimeServices {
  executorConfigured: boolean;
  executorReachable: boolean;
  executorStatus: 'ready' | 'not_configured' | 'unreachable';
  executorMessage: string | null;
}

interface TradingModeContextType {
  mode: TradingMode;
  setMode: (mode: TradingMode) => void;
  isPaperTrading: boolean;
  isLiveTrading: boolean;
  runtimeConfig: TradingRuntimeConfig;
  runtimeServices: TradingRuntimeServices;
  isRuntimeConfigLoading: boolean;
  liveActivationBlockedReason: string | null;
}

const TradingModeContext = createContext<TradingModeContextType | undefined>(undefined);

const DEFAULT_RUNTIME_CONFIG: TradingRuntimeConfig = {
  paperEnabled: true,
  liveEnabled: false,
  demoMode: true,
  executorPaperMode: true,
  effectiveTradingMode: 'paper',
  canActivateLiveTrading: false,
};

const DEFAULT_RUNTIME_SERVICES: TradingRuntimeServices = {
  executorConfigured: false,
  executorReachable: false,
  executorStatus: 'not_configured',
  executorMessage: 'Executor is not configured for this deployment.',
};

export const TradingModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<TradingMode>(() => {
    // Load from localStorage or default to paper
    const saved = localStorage.getItem('tradingMode');
    return (saved === 'live' ? 'live' : 'paper') as TradingMode;
  });
  const [runtimeConfig, setRuntimeConfig] = useState<TradingRuntimeConfig>(DEFAULT_RUNTIME_CONFIG);
  const [runtimeServices, setRuntimeServices] = useState<TradingRuntimeServices>(DEFAULT_RUNTIME_SERVICES);
  const [isRuntimeConfigLoading, setIsRuntimeConfigLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadRuntimeConfig = async () => {
      try {
        const [configData, executorHealth] = await Promise.all([
          api.getRuntimeConfig(),
          api.getExecutorHealth().catch(() => null),
        ]);
        if (!active) return;
        setRuntimeConfig(configData.trading ?? DEFAULT_RUNTIME_CONFIG);

        const executorConfigured = Boolean(configData.services?.executorConfigured);
        const executorReachable = Boolean(executorHealth?.executor_reachable);
        const executorStatus = !executorConfigured
          ? 'not_configured'
          : executorReachable
            ? 'ready'
            : 'unreachable';
        const executorMessage =
          executorHealth?.message ??
          executorHealth?.error ??
          executorHealth?.hint ??
          (executorConfigured
            ? 'Executor is configured but not reachable from the deployed app.'
            : 'Executor is not configured for this deployment.');

        setRuntimeServices({
          executorConfigured,
          executorReachable,
          executorStatus,
          executorMessage,
        });
      } catch (error) {
        console.error('Failed to load runtime trading config:', error);
        if (!active) return;
        setRuntimeConfig(DEFAULT_RUNTIME_CONFIG);
        setRuntimeServices(DEFAULT_RUNTIME_SERVICES);
      } finally {
        if (active) {
          setIsRuntimeConfigLoading(false);
        }
      }
    };

    void loadRuntimeConfig();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!runtimeConfig.canActivateLiveTrading && mode === 'live') {
      setModeState('paper');
      localStorage.setItem('tradingMode', 'paper');
    }
  }, [mode, runtimeConfig.canActivateLiveTrading]);

  const getLiveActivationBlockedReason = (): string | null => {
    if (runtimeConfig.canActivateLiveTrading) return null;
    if (!runtimeConfig.liveEnabled) return 'Live trading is disabled in deployment config.';
    if (runtimeConfig.demoMode) return 'Demo mode is enabled. Disable demo mode before live activation.';
    if (!runtimeServices.executorConfigured) return 'Executor is not configured for this deployment.';
    if (!runtimeServices.executorReachable) return 'Executor is configured but not reachable.';
    if (runtimeConfig.executorPaperMode) return 'Executor is still locked in paper mode.';
    return 'Live trading is not available.';
  };

  const setMode = (newMode: TradingMode) => {
    if (newMode === 'live' && !runtimeConfig.canActivateLiveTrading) {
      console.warn('Live trading request blocked by runtime config');
      setModeState('paper');
      localStorage.setItem('tradingMode', 'paper');
      return;
    }

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
    runtimeConfig,
    runtimeServices,
    isRuntimeConfigLoading,
    liveActivationBlockedReason: getLiveActivationBlockedReason(),
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
