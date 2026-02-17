/**
 * Backtest Runner Script
 * Run comprehensive backtests with different strategies and configurations
 */

import { createBacktestingEngine, generateSampleHistoricalData, type BacktestConfig } from '../functions/lib/backtesting-engine';
import * as fs from 'fs';
import * as path from 'path';

async function runBacktests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 Trade M8 - Comprehensive Backtesting Suite');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const engine = createBacktestingEngine();
  const results: any[] = [];

  // Test configurations
  const testConfigs: BacktestConfig[] = [
    {
      symbol: 'BTC/USD',
      startDate: '2023-01-01',
      endDate: '2024-01-01',
      initialCapital: 10000,
      strategy: 'technical_master',
      enableAI: false,
      enableRiskManagement: true
    },
    {
      symbol: 'BTC/USD',
      startDate: '2023-01-01',
      endDate: '2024-01-01',
      initialCapital: 10000,
      strategy: 'technical_master',
      enableAI: true,
      enableRiskManagement: true,
      aiConfig: {
        aiWeight: 0.4,
        minConfidence: 0.85
      }
    },
    {
      symbol: 'ETH/USD',
      startDate: '2023-01-01',
      endDate: '2024-01-01',
      initialCapital: 10000,
      strategy: 'ensemble',
      enableAI: true,
      enableRiskManagement: true,
      aiConfig: {
        aiWeight: 0.5,
        minConfidence: 0.90
      }
    }
  ];

  // Run each backtest
  for (const config of testConfigs) {
    console.log('\n───────────────────────────────────────────────────────────────');
    console.log(`📊 Running Backtest: ${config.symbol} - ${config.strategy}`);
    console.log(`   AI: ${config.enableAI ? 'Enabled' : 'Disabled'}`);
    console.log('───────────────────────────────────────────────────────────────\n');

    // Generate sample data (in production, fetch real historical data)
    const historicalData = generateSampleHistoricalData(config.symbol, 365, 50000);

    // Run backtest
    const result = await engine.runBacktest(config, historicalData);
    results.push(result);

    // Display results
    displayResults(result);
  }

  // Compare results
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 Backtest Comparison');
  console.log('═══════════════════════════════════════════════════════════════\n');

  compareResults(results);

  // Save results to file
  saveResults(results);

  console.log('\n✅ All backtests completed!');
  console.log(`📁 Results saved to: ./backtest-results/`);
}

function displayResults(result: any) {
  const { config, summary } = result;

  console.log('📈 Performance Summary:');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`   Total Trades:       ${summary.totalTrades}`);
  console.log(`   Winning Trades:     ${summary.winningTrades} (${summary.winRate.toFixed(2)}%)`);
  console.log(`   Losing Trades:      ${summary.losingTrades}`);
  console.log('');
  console.log(`   Total Return:       $${summary.totalReturn.toFixed(2)} (${summary.totalReturnPercent.toFixed(2)}%)`);
  console.log(`   Final Capital:      $${summary.finalCapital.toFixed(2)}`);
  console.log(`   Total Fees:         $${summary.totalFees.toFixed(2)}`);
  console.log('');
  console.log(`   Sharpe Ratio:       ${summary.sharpeRatio.toFixed(3)}`);
  console.log(`   Sortino Ratio:      ${summary.sortinoRatio.toFixed(3)}`);
  console.log(`   Max Drawdown:       ${(summary.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`   Profit Factor:      ${summary.profitFactor.toFixed(2)}`);
  console.log('');
  console.log(`   Average Win:        $${summary.avgWin.toFixed(2)}`);
  console.log(`   Average Loss:       $${summary.avgLoss.toFixed(2)}`);
  console.log(`   Largest Win:        $${summary.largestWin.toFixed(2)}`);
  console.log(`   Largest Loss:       $${summary.largestLoss.toFixed(2)}`);
  console.log('');
  console.log(`   Avg Holding:        ${summary.avgHoldingPeriod.toFixed(0)} minutes`);

  // Rating
  const rating = calculateRating(summary);
  console.log('');
  console.log(`   Overall Rating:     ${rating.stars} ${rating.grade}`);
  console.log('─────────────────────────────────────────────────────────────');
}

function compareResults(results: any[]) {
  console.log('Strategy                    | Win Rate | Return   | Sharpe | Drawdown | Grade');
  console.log('────────────────────────────|──────────|──────────|────────|──────────|──────');

  results.forEach(result => {
    const { config, summary } = result;
    const label = `${config.strategy}${config.enableAI ? ' + AI' : ''}`.padEnd(27);
    const winRate = `${summary.winRate.toFixed(1)}%`.padEnd(8);
    const returnPct = `${summary.totalReturnPercent.toFixed(1)}%`.padEnd(8);
    const sharpe = summary.sharpeRatio.toFixed(2).padEnd(6);
    const drawdown = `${(summary.maxDrawdown * 100).toFixed(1)}%`.padEnd(8);
    const rating = calculateRating(summary);

    console.log(`${label} | ${winRate} | ${returnPct} | ${sharpe} | ${drawdown} | ${rating.grade}`);
  });

  // Find best performer
  const best = results.reduce((best, current) =>
    current.summary.totalReturnPercent > best.summary.totalReturnPercent ? current : best
  );

  console.log('────────────────────────────|──────────|──────────|────────|──────────|──────');
  console.log(`\n🏆 Best Performer: ${best.config.strategy}${best.config.enableAI ? ' + AI' : ''}`);
  console.log(`   Return: ${best.summary.totalReturnPercent.toFixed(2)}% | Win Rate: ${best.summary.winRate.toFixed(1)}%`);
}

function calculateRating(summary: any): { stars: string; grade: string } {
  let score = 0;

  // Win rate (0-30 points)
  score += Math.min(30, summary.winRate / 3);

  // Return (0-30 points)
  score += Math.min(30, summary.totalReturnPercent / 3);

  // Sharpe ratio (0-20 points)
  score += Math.min(20, summary.sharpeRatio * 10);

  // Low drawdown (0-20 points)
  score += Math.max(0, 20 - (summary.maxDrawdown * 200));

  // Determine grade
  let grade: string;
  let stars: string;

  if (score >= 90) {
    grade = 'S+ (Excellent)';
    stars = '⭐⭐⭐⭐⭐';
  } else if (score >= 80) {
    grade = 'S  (Great)';
    stars = '⭐⭐⭐⭐';
  } else if (score >= 70) {
    grade = 'A  (Good)';
    stars = '⭐⭐⭐';
  } else if (score >= 60) {
    grade = 'B  (Fair)';
    stars = '⭐⭐';
  } else {
    grade = 'C  (Poor)';
    stars = '⭐';
  }

  return { stars, grade };
}

function saveResults(results: any[]) {
  const resultsDir = path.join(process.cwd(), 'backtest-results');

  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backtest-${timestamp}.json`;
  const filepath = path.join(resultsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(results, null, 2));

  // Also save summary
  const summary = results.map(r => ({
    strategy: r.config.strategy,
    ai: r.config.enableAI,
    winRate: r.summary.winRate,
    return: r.summary.totalReturnPercent,
    sharpe: r.summary.sharpeRatio,
    maxDrawdown: r.summary.maxDrawdown,
    trades: r.summary.totalTrades
  }));

  const summaryFile = path.join(resultsDir, 'latest-summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

  // Generate CSV for easy analysis
  const csvLines = [
    'Strategy,AI Enabled,Win Rate,Return %,Sharpe,Max Drawdown,Total Trades,Final Capital'
  ];

  results.forEach(r => {
    csvLines.push([
      r.config.strategy,
      r.config.enableAI,
      r.summary.winRate.toFixed(2),
      r.summary.totalReturnPercent.toFixed(2),
      r.summary.sharpeRatio.toFixed(3),
      (r.summary.maxDrawdown * 100).toFixed(2),
      r.summary.totalTrades,
      r.summary.finalCapital.toFixed(2)
    ].join(','));
  });

  const csvFile = path.join(resultsDir, 'latest-results.csv');
  fs.writeFileSync(csvFile, csvLines.join('\n'));
}

// Run if executed directly
if (require.main === module) {
  runBacktests().catch(console.error);
}

export { runBacktests };
