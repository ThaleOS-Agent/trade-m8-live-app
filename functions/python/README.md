# XQ Trade M8 — Python Trading Engine

Production-grade Python modules for backtesting, feature engineering,
signal generation, risk management, and order execution.

## Module Map

| File | Role | Key fixes |
|------|------|-----------|
| `backtest_engine.py` | Transformer model backtest loop | Position sizing, intrabar SL/TP, Sharpe, slippage |
| `entry_exit_logic.py` | Live/backtest entry+exit engine | ATR exits, 4× trade_logic.txt exits, correct R-multiple |
| `base_strategy.py` | Abstract base — all indicators | Wilder RSI, ATR (True Range), ADX, Chandelier, NetPressure |
| `generate_features.py` | Feature engineering pipeline | Correct candlestick patterns, no fillna(0), Net Pressure |
| `execute_trade.py` | Exchange order router | Binance MARKET/TWAP + OANDA, env credentials, paper mode |
| `analyze_features.py` | Feature importance + selection | Thread-safe, pipeline wired to generate_features |
| `riskmanager.py` | Position sizing + daily gates | True Range ATR, float sizing, ATR-based TP, loss gate |

## Environment Variables

```bash
# Exchange credentials
BINANCE_API_KEY=...
BINANCE_SECRET=...
OANDA_API_KEY=...
OANDA_ACCOUNT=...
OANDA_ENV=practice          # or live

# Risk controls
PAPER_MODE=true             # ALWAYS start here
RISK_PER_TRADE=0.01         # 1% NAV
MAX_DAILY_LOSS_PCT=0.03     # 3% daily gate
MAX_DAILY_TRADES=2
ATR_SL_MULT=1.5
ATR_TP_MULT=2.0
TWAP_THRESHOLD_USD=5000     # orders above this use TWAP
```

## Usage

```python
# Backtest
from backtest_engine import run_backtest, BacktestConfig
results = run_backtest(BacktestConfig(data_path='data/XAUUSD.csv'))

# Live execution
from riskmanager import RiskManager
from execute_trade import execute_trade

rm = RiskManager(initial_equity=10_000)
result = rm.evaluate(entry_price, high, low, close)
if result.approved:
    rm.open_trade(result)
    fill = execute_trade('XAU/USD', 'BUY', result.units, entry_price)
```

## Provenance

Win-rate figures in comments are labelled BACKTEST_SYNTHETIC.
The only authoritative win-rate from live execution is 37.2% (19,883 trades).
No forward performance is implied or guaranteed.
