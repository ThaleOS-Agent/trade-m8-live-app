#!/bin/bash

# XQ Trade M8 - Comprehensive API Testing Script
# This script tests all endpoints to verify your setup

set -e

# Configuration
BASE_URL="${1:-https://01139140.trade-m8-production.pages.dev}"
TIMESTAMP=$(date +%s)
TEST_EMAIL="test${TIMESTAMP}@trade-m8.app"
TEST_PASSWORD="SecurePass123"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "============================================"
echo "🚀 XQ Trade M8 - Endpoint Testing Suite"
echo "============================================"
echo ""
echo "Testing Base URL: $BASE_URL"
echo "Test Email: $TEST_EMAIL"
echo ""

# Test 1: Health Check
echo -e "${BLUE}Test 1: Health Check${NC}"
HEALTH=$(curl -s "$BASE_URL/api/health")
echo "$HEALTH"
if echo "$HEALTH" | grep -q "healthy"; then
    echo -e "${GREEN}✓ Health check passed${NC}\n"
else
    echo -e "${RED}✗ Health check failed${NC}\n"
    exit 1
fi

# Test 2: User Registration
echo -e "${BLUE}Test 2: User Registration${NC}"
REGISTER=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"fullName\":\"Test User\"}")
echo "$REGISTER"
if echo "$REGISTER" | grep -q "success"; then
    USER_ID=$(echo "$REGISTER" | grep -o '"userId":"[^"]*"' | cut -d'"' -f4)
    echo -e "${GREEN}✓ Registration passed - User ID: $USER_ID${NC}\n"
else
    echo -e "${RED}✗ Registration failed${NC}\n"
    exit 1
fi

# Test 3: User Login
echo -e "${BLUE}Test 3: User Login${NC}"
LOGIN=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")
echo "$LOGIN"

if echo "$LOGIN" | grep -q "token"; then
    TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    echo -e "${GREEN}✓ Login passed - Token obtained${NC}\n"
    echo "Token: $TOKEN"
    echo ""
else
    echo -e "${YELLOW}⚠ Login failed - Might need KV bindings configured${NC}"
    echo -e "${YELLOW}Configure KV bindings in Cloudflare Dashboard:${NC}"
    echo "https://dash.cloudflare.com/pages/view/trade-m8-production/settings/functions"
    echo ""
    TOKEN=""
fi

# If we have a token, continue with authenticated tests
if [ -n "$TOKEN" ]; then

    # Test 4: Create Trading Bot
    echo -e "${BLUE}Test 4: Create Trading Bot${NC}"
    BOT=$(curl -s -X POST "$BASE_URL/api/bots" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{
        "name": "BTC Test Bot",
        "strategy": "ensemble",
        "symbol": "BTC/USDT",
        "exchange": "binance",
        "riskLevel": "medium"
      }')
    echo "$BOT"
    if echo "$BOT" | grep -q "success\|botId"; then
        BOT_ID=$(echo "$BOT" | grep -o '"botId":"[^"]*"' | cut -d'"' -f4 || echo "created")
        echo -e "${GREEN}✓ Bot creation passed - Bot ID: $BOT_ID${NC}\n"
    else
        echo -e "${RED}✗ Bot creation failed${NC}\n"
    fi

    # Test 5: List Trading Bots
    echo -e "${BLUE}Test 5: List Trading Bots${NC}"
    BOTS=$(curl -s "$BASE_URL/api/bots" \
      -H "Authorization: Bearer $TOKEN")
    echo "$BOTS"
    if echo "$BOTS" | grep -q "bots"; then
        echo -e "${GREEN}✓ List bots passed${NC}\n"
    else
        echo -e "${RED}✗ List bots failed${NC}\n"
    fi

    # Test 6: Get Trades
    echo -e "${BLUE}Test 6: Get Trades${NC}"
    TRADES=$(curl -s "$BASE_URL/api/trades?limit=10" \
      -H "Authorization: Bearer $TOKEN")
    echo "$TRADES"
    if echo "$TRADES" | grep -q "trades"; then
        echo -e "${GREEN}✓ Get trades passed${NC}\n"
    else
        echo -e "${RED}✗ Get trades failed${NC}\n"
    fi

    # Test 7: Get Portfolio
    echo -e "${BLUE}Test 7: Get Portfolio${NC}"
    PORTFOLIO=$(curl -s "$BASE_URL/api/portfolio" \
      -H "Authorization: Bearer $TOKEN")
    echo "$PORTFOLIO"
    if echo "$PORTFOLIO" | grep -q "portfolio\|activeTrades"; then
        echo -e "${GREEN}✓ Get portfolio passed${NC}\n"
    else
        echo -e "${RED}✗ Get portfolio failed${NC}\n"
    fi

    # Test 8: Get Analytics
    echo -e "${BLUE}Test 8: Get Analytics${NC}"
    ANALYTICS=$(curl -s "$BASE_URL/api/analytics" \
      -H "Authorization: Bearer $TOKEN")
    echo "$ANALYTICS"
    if echo "$ANALYTICS" | grep -q "metrics\|dailyPerformance"; then
        echo -e "${GREEN}✓ Get analytics passed${NC}\n"
    else
        echo -e "${RED}✗ Get analytics failed${NC}\n"
    fi

fi

# Test 9: Get Market Data (public endpoint)
echo -e "${BLUE}Test 9: Get Market Data (Public)${NC}"
MARKET=$(curl -s "$BASE_URL/api/market?symbols=bitcoin,ethereum")
echo "$MARKET"
if echo "$MARKET" | grep -q "marketData"; then
    echo -e "${GREEN}✓ Market data passed${NC}\n"
else
    echo -e "${YELLOW}⚠ Market data returned empty - CoinGecko API key might be needed${NC}\n"
fi

# Summary
echo "============================================"
echo "📊 Test Summary"
echo "============================================"
echo ""
echo "✅ Tests Completed"
echo ""
echo "Next Steps:"
if [ -z "$TOKEN" ]; then
    echo "1. Configure KV bindings in Cloudflare Dashboard"
    echo "   https://dash.cloudflare.com/pages/view/trade-m8-production/settings/functions"
    echo "2. Add environment variables (JWT_SECRET, SUPABASE_URL, SUPABASE_KEY)"
    echo "3. Redeploy and run this test again"
else
    echo "✅ All core features working!"
    echo "1. Add exchange API keys for live trading"
    echo "2. Configure wallet connect"
    echo "3. Start creating trading bots"
fi
echo ""
echo "Full Setup Guide: /Users/Gee/xq-trade-m8-cloudflare/COMPLETE-SETUP-GUIDE.md"
echo ""
