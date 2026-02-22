# 📊 Trade M8 Backtesting Guide

## Overview

The Trade M8 platform includes a powerful backtesting engine that allows you to test trading strategies against historical data before risking real capital.

---

## 🎯 Available Strategies

### 1. **Technical Master** (`technical_master`)
Advanced technical analysis combining multiple indicators:
- RSI (Relative Strength Index)
- MACD (Moving Average Convergence Divergence)
- Bollinger Bands
- Volume analysis
- Support/Resistance levels

**Best For**: Short to medium-term trades
**Win Rate**: ~60-70%
**Risk/Reward**: Moderate

---

### 2. **AI Momentum** (`ai_momentum`)
Machine learning-powered momentum trading:
- Price action patterns
- Volume momentum
- Trend strength analysis
- AI-enhanced entry/exit signals

**Best For**: Trending markets
**Win Rate**: ~65-75%
**Risk/Reward**: High

---

### 3. **News Driven** (`news_driven`)
Sentiment-based trading using:
- Market sentiment analysis
- News impact scoring
- Social media trends
- Event-driven signals

**Best For**: Volatile markets, major events
**Win Rate**: ~55-65%
**Risk/Reward**: Variable

---

### 4. **Ensemble** (`ensemble`)
Combines all strategies with weighted signals:
- Multi-strategy consensus
- AI-optimized weighting
- Dynamic strategy selection
- Maximum diversification

**Best For**: All market conditions
**Win Rate**: ~70-80%
**Risk/Reward**: Balanced

---

## 🚀 How to Run a Backtest

### Step 1: Get Your JWT Token

Log in to Trade M8 and grab your authentication token:

```bash
# Example login
curl -X POST https://trade-m8.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your@email.com",
    "password": "your-password"
  }'

# Save the token
export TOKEN="eyJhbGci..."
```

---

### Step 2: Run a Backtest

#### Basic Backtest (30 days, Technical Master)

```bash
curl -X POST https://trade-m8.app/api/backtest/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "symbol": "BTC/USDT",
    "days": 30,
    "initialCapital": 10000,
    "strategy": "technical_master",
    "enableAI": false,
    "enableRiskManagement": true,
    "useSampleData": true
  }'
```

#### Advanced Backtest (60 days, Ensemble + AI)

```bash
curl -X POST https://trade-m8.app/api/backtest/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "symbol": "ETH/USDT",
    "days": 60,
    "initialCapital": 5000,
    "strategy": "ensemble",
    "enableAI": true,
    "enableRiskManagement": true,
    "useSampleData": false,
    "maxBars": 500
  }'
```

#### Real CoinGecko Data Backtest

```bash
curl -X POST https://trade-m8.app/api/backtest/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "symbol": "bitcoin",
    "days": 90,
    "initialCapital": 20000,
    "strategy": "ensemble",
    "enableAI": true,
    "enableRiskManagement": true,
    "useSampleData": false
  }'
```

---

## 📋 Backtest Configuration Options

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `symbol` | string | Trading pair (BTC/USDT) or CoinGecko ID (bitcoin) |
| `days` | number | Number of days to backtest (7-365) |
| `initialCapital` | number | Starting capital in USD |
| `strategy` | string | Strategy to test (see above) |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enableAI` | boolean | false | Enable AI enhancement |
| `enableRiskManagement` | boolean | true | Apply risk management rules |
| `useSampleData` | boolean | true | Use synthetic data (faster) |
| `maxBars` | number | 1000 | Maximum data points to process |

---

## 📊 Understanding Backtest Results

### Sample Result Structure

```json
{
  "success": true,
  "result": {
    "id": "bt-abc123",
    "summary": {
      "totalTrades": 45,
      "winningTrades": 32,
      "losingTrades": 13,
      "winRate": 71.11,
      "totalReturn": 2450.50,
      "totalReturnPercent": 24.51,
      "sharpeRatio": 2.34,
      "sortinoRatio": 3.12,
      "maxDrawdown": -8.5,
      "profitFactor": 2.8,
      "avgWin": 180.25,
      "avgLoss": -65.30,
      "largestWin": 450.00,
      "largestLoss": -120.00,
      "avgHoldingPeriod": 3.2,
      "finalCapital": 12450.50,
      "totalFees": 125.30
    },
    "trades": [...],
    "equityCurve": [...],
    "monthlyReturns": [...]
  }
}
```

---

## 📈 Key Metrics Explained

### Win Rate
```
winRate = (winningTrades / totalTrades) × 100
```
**Good**: >60%
**Excellent**: >70%

### Sharpe Ratio
Measures risk-adjusted returns:
- **< 1.0**: Poor
- **1.0 - 2.0**: Good
- **> 2.0**: Excellent

### Sortino Ratio
Like Sharpe but only considers downside risk:
- **< 1.0**: Poor
- **1.0 - 2.0**: Good
- **> 2.0**: Excellent

### Max Drawdown
Largest peak-to-trough decline:
- **< 10%**: Excellent
- **10-20%**: Good
- **> 20%**: High risk

### Profit Factor
```
profitFactor = totalWins / totalLosses
```
- **< 1.0**: Losing strategy
- **1.0 - 2.0**: Profitable
- **> 2.0**: Highly profitable

### Average Holding Period
Average time in days per trade:
- **< 1**: Day trading
- **1-7**: Swing trading
- **> 7**: Position trading

---

## 🎯 Sample Backtest Scenarios

### Conservative Strategy (Low Risk)
```json
{
  "symbol": "BTC/USDT",
  "days": 90,
  "initialCapital": 10000,
  "strategy": "technical_master",
  "enableAI": false,
  "enableRiskManagement": true,
  "useSampleData": false
}
```

**Expected Results**:
- Win Rate: 60-65%
- Sharpe Ratio: 1.5-2.0
- Max Drawdown: 5-10%
- Return: 10-15%

---

### Aggressive Strategy (High Risk/Reward)
```json
{
  "symbol": "ETH/USDT",
  "days": 60,
  "initialCapital": 5000,
  "strategy": "ai_momentum",
  "enableAI": true,
  "enableRiskManagement": true,
  "useSampleData": false
}
```

**Expected Results**:
- Win Rate: 65-75%
- Sharpe Ratio: 2.0-3.0
- Max Drawdown: 10-15%
- Return: 20-30%

---

### Balanced Strategy (Best Risk/Reward)
```json
{
  "symbol": "BTC/USDT",
  "days": 120,
  "initialCapital": 20000,
  "strategy": "ensemble",
  "enableAI": true,
  "enableRiskManagement": true,
  "useSampleData": false
}
```

**Expected Results**:
- Win Rate: 70-80%
- Sharpe Ratio: 2.5-3.5
- Max Drawdown: 6-12%
- Return: 18-25%

---

## 📊 Interpreting Equity Curve

The equity curve shows your capital over time:

```
Good Equity Curve:
  ↗️  Steady upward trend
  📈  Smooth growth
  ✅  Small drawdowns

Bad Equity Curve:
  ⚠️  Erratic movement
  📉  Large drawdowns
  ❌  Sideways or downward trend
```

---

## 🔍 Analyzing Monthly Returns

```json
"monthlyReturns": [
  {"month": "2025-01", "return": 8.5, "trades": 12},
  {"month": "2025-02", "return": 12.3, "trades": 15},
  {"month": "2025-03", "return": -2.1, "trades": 8}
]
```

**What to Look For**:
- ✅ Consistent positive returns
- ✅ Low volatility month-to-month
- ⚠️ No months with >20% loss
- ✅ Steady trade count

---

## 🎛️ Risk Management Settings

When `enableRiskManagement: true`, the system applies:

### Position Sizing
- Max 10% of capital per trade
- Dynamic sizing based on volatility
- Reduced size in high-risk conditions

### Stop Losses
- Automatic stop loss at -5% per trade
- Trailing stops for profitable trades
- Emergency stop at -15% portfolio drawdown

### Take Profits
- Automatic profit taking at +10%
- Partial exits to lock profits
- Dynamic targets based on volatility

### Portfolio Limits
- Max portfolio exposure: 95%
- Minimum cash reserve: 5%
- Max correlation between positions: 0.7

---

## 🤖 AI Enhancement

When `enableAI: true`, the system adds:

### Signal Enhancement
- Boosts high-probability setups
- Filters low-quality signals
- Optimizes entry/exit timing

### Win Rate Prediction
- Predicts probability of success
- Only takes trades >85% confidence
- Adapts to market conditions

### Dynamic Weighting
- Adjusts strategy weights in real-time
- Learns from recent performance
- Optimizes for current market regime

---

## 📋 Best Practices

### 1. Start with Sample Data
```json
"useSampleData": true
```
Faster backtests for strategy testing.

### 2. Use Realistic Capital
Match your actual trading capital for accurate results.

### 3. Test Multiple Strategies
Compare all 4 strategies on the same data:
- technical_master
- ai_momentum
- news_driven
- ensemble

### 4. Enable Risk Management
Always backtest with RM enabled to see realistic results.

### 5. Test Different Timeframes
```
- Short-term: 7-30 days
- Medium-term: 30-90 days
- Long-term: 90-365 days
```

### 6. Analyze Worst-Case Scenarios
Focus on:
- Largest loss
- Max drawdown
- Losing streaks

---

## 🔧 API Endpoints

### Run Backtest
```
POST /api/backtest/run
Authorization: Bearer <JWT>
Content-Type: application/json

Body: {BacktestConfig}
```

### List Results
```
GET /api/backtest/results?limit=10
Authorization: Bearer <JWT>
```

### Get Specific Result
```
GET /api/backtest/results/:id
Authorization: Bearer <JWT>
```

### Delete Result
```
DELETE /api/backtest/results/:id
Authorization: Bearer <JWT>
```

---

## 📊 Sample Backtest Report

### BTC/USDT - Technical Master Strategy
**Period**: Last 30 days
**Capital**: $10,000

```
📈 Performance Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Trades:        45
Winning Trades:      32 (71.1%)
Losing Trades:       13 (28.9%)

Total Return:        $2,450.50 (+24.51%)
Final Capital:       $12,450.50
Total Fees:          $125.30

Sharpe Ratio:        2.34 ⭐⭐
Sortino Ratio:       3.12 ⭐⭐⭐
Max Drawdown:        -8.5% ✅
Profit Factor:       2.8 ✅

Average Win:         $180.25
Average Loss:        -$65.30
Largest Win:         $450.00
Largest Loss:        -$120.00

Avg Hold Time:       3.2 days
```

---

## 💡 Tips for Better Results

### 1. Optimize Strategy Selection
- **Bull Market**: Use ai_momentum
- **Bear Market**: Use technical_master with tight stops
- **Sideways**: Use news_driven
- **Uncertain**: Use ensemble

### 2. Tune Parameters
Start conservative, then optimize:
```
Initial Capital: Match your real capital
Days: Start with 30, extend to 90+
AI: Start disabled, enable after baseline
Risk Management: Always enabled
```

### 3. Compare Multiple Assets
Test the same strategy on:
- BTC/USDT
- ETH/USDT
- SOL/USDT
- AVAX/USDT

### 4. Watch for Overfitting
If results are TOO good (>90% win rate), the strategy may be overfitted to historical data.

### 5. Account for Slippage
Real trading has:
- Exchange fees (~0.1%)
- Slippage (~0.1-0.3%)
- Network fees

Backtest returns should exceed 20% to account for this.

---

## ⚠️ Limitations

### What Backtesting CAN'T Account For:

1. **Market Impact**
   - Large orders move prices
   - Backtests assume perfect fills

2. **Liquidity**
   - Real markets have bid/ask spreads
   - Not all orders fill instantly

3. **Future Events**
   - Black swan events
   - Regulatory changes
   - Exchange outages

4. **Psychological Factors**
   - Fear and greed
   - FOMO and panic selling
   - Emotional decision-making

5. **Changing Market Conditions**
   - Past performance ≠ future results
   - Market regimes change

---

## 🎯 Next Steps

1. **Run Your First Backtest**
   ```bash
   curl -X POST https://trade-m8.app/api/backtest/run \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d @backtest-config.json
   ```

2. **Compare Strategies**
   Run the same config with all 4 strategies

3. **Analyze Results**
   Focus on Sharpe ratio, drawdown, and profit factor

4. **Paper Trade**
   Test winning strategies with paper trading first

5. **Go Live**
   Start small with proven strategies

---

## 📞 Support

For issues or questions:
- **API Docs**: See full backtest API documentation
- **Strategy Help**: Review strategy descriptions above
- **Bugs**: Check Cloudflare Pages logs

---

**Happy Backtesting!** 📊📈

*Remember: Past performance does not guarantee future results. Always test thoroughly and start small.*
