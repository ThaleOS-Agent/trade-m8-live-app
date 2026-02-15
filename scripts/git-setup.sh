#!/bin/bash

# Git Repository Setup Script for XQ Trade M8
# Run this after installing Xcode command line tools

set -e

echo "🚀 XQ Trade M8 - Git Repository Setup"
echo "======================================"
echo ""

# Check if git is available
if ! command -v git &> /dev/null; then
    echo "❌ Git is not available. Please install Xcode command line tools:"
    echo "   Run: xcode-select --install"
    exit 1
fi

echo "✓ Git is available"
echo ""

# Initialize git repository if not already initialized
if [ ! -d .git ]; then
    echo "📦 Initializing Git repository..."
    git init
    echo "✓ Git repository initialized"
else
    echo "✓ Git repository already initialized"
fi

# Configure git user if not set
if [ -z "$(git config user.name)" ]; then
    echo ""
    read -p "Enter your Git username: " git_username
    git config user.name "$git_username"
fi

if [ -z "$(git config user.email)" ]; then
    echo ""
    read -p "Enter your Git email: " git_email
    git config user.email "$git_email"
fi

echo ""
echo "📝 Adding files to git..."
git add .

echo ""
echo "💾 Creating initial commit..."
git commit -m "Initial commit: XQ Trade M8 Trading Platform

Features:
- Full-stack trading platform on Cloudflare Pages
- D1 Database with 10 tables (users, bots, trades, portfolio, etc.)
- CoinGecko API integration with technical analysis
- RSI, trend detection, momentum, volatility indicators
- Three enhanced API endpoints:
  * /api/market-analysis - Technical analysis with buy/sell signals
  * /api/trading-signals - Multi-coin portfolio analysis
  * /api/opportunities - Top gainers, trending, reversal discovery
- KV namespaces for caching and sessions
- R2 bucket for file storage
- Comprehensive test suites (100% passing)
- 10,000+ lines of documentation

Tech Stack:
- Frontend: React + TypeScript + Vite + TailwindCSS
- Backend: Cloudflare Workers + Pages Functions
- Database: Cloudflare D1 (SQLite)
- Caching: Cloudflare KV
- Storage: Cloudflare R2
- APIs: CoinGecko, Binance, OANDA, Kraken, Coinbase ready

🤖 Generated with Claude Code
"

echo "✓ Initial commit created"
echo ""

# Create GitHub repository using gh CLI
if command -v gh &> /dev/null; then
    echo "🌐 Creating GitHub repository..."

    read -p "Make repository private? (y/n, default: y): " make_private
    make_private=${make_private:-y}

    if [[ $make_private == "y" || $make_private == "Y" ]]; then
        visibility="--private"
    else
        visibility="--public"
    fi

    gh repo create xq-trade-m8-cloudflare $visibility \
        --source=. \
        --description="XQ Trade M8 - AI-Powered Trading Platform with CoinGecko Integration (Cloudflare Pages + D1)" \
        --push

    echo ""
    echo "✅ Repository created and pushed to GitHub!"
    echo ""
    echo "🔗 View your repository:"
    gh repo view --web

else
    echo "⚠️  GitHub CLI (gh) not found."
    echo ""
    echo "Please create a repository manually:"
    echo "1. Go to https://github.com/new"
    echo "2. Name: xq-trade-m8-cloudflare"
    echo "3. Description: XQ Trade M8 - AI-Powered Trading Platform with CoinGecko Integration"
    echo "4. Choose Private or Public"
    echo "5. DO NOT initialize with README, .gitignore, or license"
    echo "6. Click 'Create repository'"
    echo ""
    echo "Then run these commands:"
    echo "   git remote add origin https://github.com/YOUR_USERNAME/xq-trade-m8-cloudflare.git"
    echo "   git branch -M main"
    echo "   git push -u origin main"
fi

echo ""
echo "🎉 Git setup complete!"
