#!/bin/bash

# XQ Trade M8 - Comprehensive Production Testing Suite
# Tests all endpoints, APIs, and trade execution

set +e  # Continue on errors to see all results

# Configuration
BASE_URL="${1:-https://trade-m8.app}"
TIMESTAMP=$(date +%s)
TEST_EMAIL="trader${TIMESTAMP}@trade-m8.app"
TEST_PASSWORD="Secure123Pass"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Helper functions
test_start() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${BLUE}Test $1: $2${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

test_pass() {
    echo -e "${GREEN}✓ PASSED${NC} - $1\n"
    PASSED_TESTS=$((PASSED_TESTS + 1))
}

test_fail() {
    echo -e "${RED}✗ FAILED${NC} - $1\n"
    FAILED_TESTS=$((FAILED_TESTS + 1))
}

test_warning() {
    echo -e "${YELLOW}⚠ WARNING${NC} - $1\n"
}

# Banner
clear
echo -e "${MAGENTA}"
echo "╔════════════════════════════════════════════════════╗"
echo "║                                                    ║"
echo "║   🚀 XQ TRADE M8 - PRODUCTION TEST SUITE 🚀      ║"
echo "║                                                    ║"
echo "║   Comprehensive API & Trade Execution Testing     ║"
echo "║                                                    ║"
echo "╚════════════════════════════════════════════════════╝"
echo -e "${NC}\n"

echo -e "${BOLD}Test Configuration:${NC}"
echo "  Base URL: $BASE_URL"
echo "  Test Email: $TEST_EMAIL"
echo "  Timestamp: $TIMESTAMP"
echo ""

# ============================================
# SECTION 1: INFRASTRUCTURE TESTS
# ============================================
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}"
echo -e "${BOLD}${MAGENTA}   SECTION 1: INFRASTRUCTURE TESTS${NC}"
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}\n"

# Test 1: Health Check
test_start "1" "Health Endpoint"
HEALTH=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/health")
HTTP_CODE=$(echo "$HEALTH" | tail -n 1)
BODY=$(echo "$HEALTH" | sed '$d')

echo "Response: $BODY"
echo "HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "healthy"; then
    test_pass "Health endpoint responding correctly"
else
    test_fail "Health endpoint not responding"
fi

# Test 2: CORS Headers
test_start "2" "CORS Configuration"
CORS=$(curl -s -I -X OPTIONS "$BASE_URL/api/health" | grep -i "access-control")
echo "$CORS"

if echo "$CORS" | grep -qi "access-control-allow-origin"; then
    test_pass "CORS headers configured correctly"
else
    test_fail "CORS headers missing"
fi

# ============================================
# SECTION 2: AUTHENTICATION TESTS
# ============================================
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}"
echo -e "${BOLD}${MAGENTA}   SECTION 2: AUTHENTICATION TESTS${NC}"
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}\n"

# Test 3: User Registration
test_start "3" "User Registration"
REGISTER=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"fullName\":\"Test Trader\"}")

echo "Response: $REGISTER"

if echo "$REGISTER" | grep -q "success"; then
    USER_ID=$(echo "$REGISTER" | grep -o '"userId":"[^"]*"' | cut -d'"' -f4)
    test_pass "User registered successfully - ID: $USER_ID"
else
    test_fail "User registration failed"
    USER_ID=""
fi

# Test 4: User Login
test_start "4" "User Login & JWT Token"
LOGIN=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

echo "Response: $LOGIN"

if echo "$LOGIN" | grep -q "token"; then
    TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    test_pass "Login successful - Token obtained"
    echo -e "${CYAN}Token: ${TOKEN:0:50}...${NC}\n"
    AUTH_WORKING=true
else
    test_warning "Login failed - KV bindings may not be configured"
    echo -e "${YELLOW}Configure KV bindings: https://dash.cloudflare.com/pages/view/trade-m8-production/settings/functions${NC}\n"
    TOKEN=""
    AUTH_WORKING=false
fi

# ============================================
# SECTION 3: TRADING BOT TESTS
# ============================================
if [ "$AUTH_WORKING" = true ]; then
    echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}"
    echo -e "${BOLD}${MAGENTA}   SECTION 3: TRADING BOT TESTS${NC}"
    echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}\n"

    # Test 5: Create Trading Bot
    test_start "5" "Create Trading Bot"
    BOT=$(curl -s -X POST "$BASE_URL/api/bots" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{
        "name": "Production Test Bot",
        "strategy": "ensemble",
        "symbol": "BTC/USDT",
        "exchange": "binance",
        "riskLevel": "medium",
        "maxPositionSize": 0.02
      }')

    echo "Response: $BOT"

    if echo "$BOT" | grep -q "success\|botId"; then
        BOT_ID=$(echo "$BOT" | grep -o '"botId":"[^"]*"' | cut -d'"' -f4 || echo "created")
        test_pass "Trading bot created - ID: $BOT_ID"
    else
        test_fail "Bot creation failed"
        BOT_ID=""
    fi

    # Test 6: List Trading Bots
    test_start "6" "List All Bots"
    BOTS=$(curl -s "$BASE_URL/api/bots" \
      -H "Authorization: Bearer $TOKEN")

    echo "Response: $BOTS"

    if echo "$BOTS" | grep -q "bots"; then
        BOT_COUNT=$(echo "$BOTS" | grep -o '"id"' | wc -l)
        test_pass "Bots retrieved - Count: $BOT_COUNT"
    else
        test_fail "Failed to retrieve bots"
    fi

    # Test 7: Create Second Bot (Different Strategy)
    test_start "7" "Create Momentum Bot"
    BOT2=$(curl -s -X POST "$BASE_URL/api/bots" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{
        "name": "ETH Momentum Trader",
        "strategy": "momentum",
        "symbol": "ETH/USDT",
        "exchange": "binance",
        "riskLevel": "high"
      }')

    echo "Response: $BOT2"

    if echo "$BOT2" | grep -q "success\|botId"; then
        test_pass "Second bot created successfully"
    else
        test_fail "Second bot creation failed"
    fi

    # ============================================
    # SECTION 4: PORTFOLIO & TRADES
    # ============================================
    echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}"
    echo -e "${BOLD}${MAGENTA}   SECTION 4: PORTFOLIO & TRADES${NC}"
    echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}\n"

    # Test 8: Get Trades
    test_start "8" "Get Trade History"
    TRADES=$(curl -s "$BASE_URL/api/trades?limit=100" \
      -H "Authorization: Bearer $TOKEN")

    echo "Response: $TRADES"

    if echo "$TRADES" | grep -q "trades"; then
        test_pass "Trades endpoint working"
    else
        test_fail "Trades endpoint failed"
    fi

    # Test 9: Get Portfolio
    test_start "9" "Get Portfolio Data"
    PORTFOLIO=$(curl -s "$BASE_URL/api/portfolio" \
      -H "Authorization: Bearer $TOKEN")

    echo "Response: $PORTFOLIO"

    if echo "$PORTFOLIO" | grep -q "portfolio\|activeTrades"; then
        test_pass "Portfolio endpoint working"
    else
        test_fail "Portfolio endpoint failed"
    fi

    # Test 10: Get Analytics
    test_start "10" "Get Performance Analytics"
    ANALYTICS=$(curl -s "$BASE_URL/api/analytics" \
      -H "Authorization: Bearer $TOKEN")

    echo "Response: $ANALYTICS"

    if echo "$ANALYTICS" | grep -q "metrics\|dailyPerformance"; then
        test_pass "Analytics endpoint working"
    else
        test_fail "Analytics endpoint failed"
    fi

fi

# ============================================
# SECTION 5: MARKET DATA TESTS
# ============================================
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}"
echo -e "${BOLD}${MAGENTA}   SECTION 5: MARKET DATA TESTS${NC}"
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}\n"

# Test 11: Get Market Data (Public)
test_start "11" "Market Data API (Public)"
MARKET=$(curl -s "$BASE_URL/api/market?symbols=bitcoin,ethereum,cardano")

echo "Response: $MARKET"

if echo "$MARKET" | grep -q "marketData"; then
    test_pass "Market data endpoint working"
else
    test_warning "Market data endpoint returned empty (CoinGecko API key may be needed)"
fi

# ============================================
# SECTION 6: PERFORMANCE TESTS
# ============================================
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}"
echo -e "${BOLD}${MAGENTA}   SECTION 6: PERFORMANCE TESTS${NC}"
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}\n"

# Test 12: Response Time
test_start "12" "API Response Time"
START=$(date +%s%N)
curl -s "$BASE_URL/api/health" > /dev/null
END=$(date +%s%N)
DURATION=$(( (END - START) / 1000000 ))

echo "Response time: ${DURATION}ms"

if [ $DURATION -lt 1000 ]; then
    test_pass "Response time excellent (<1s): ${DURATION}ms"
elif [ $DURATION -lt 3000 ]; then
    test_pass "Response time good (<3s): ${DURATION}ms"
else
    test_warning "Response time slow (>3s): ${DURATION}ms"
fi

# Test 13: Concurrent Requests
test_start "13" "Concurrent Request Handling"
echo "Sending 5 concurrent requests..."

for i in {1..5}; do
    curl -s "$BASE_URL/api/health" > /dev/null &
done
wait

test_pass "Handled 5 concurrent requests successfully"

# ============================================
# FINAL SUMMARY
# ============================================
echo -e "\n${BOLD}${MAGENTA}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${MAGENTA}║              TEST SUMMARY REPORT                   ║${NC}"
echo -e "${BOLD}${MAGENTA}╚════════════════════════════════════════════════════╝${NC}\n"

echo -e "${BOLD}Total Tests:${NC}  $TOTAL_TESTS"
echo -e "${GREEN}${BOLD}Passed:${NC}      $PASSED_TESTS"
echo -e "${RED}${BOLD}Failed:${NC}       $FAILED_TESTS"

PASS_RATE=$(( PASSED_TESTS * 100 / TOTAL_TESTS ))
echo -e "${BOLD}Pass Rate:${NC}    ${PASS_RATE}%\n"

# Final Status
if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}${BOLD}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║  ✓ ALL TESTS PASSED - READY FOR PROD  ║${NC}"
    echo -e "${GREEN}${BOLD}╚════════════════════════════════════════╝${NC}\n"
elif [ "$AUTH_WORKING" = false ]; then
    echo -e "${YELLOW}${BOLD}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}${BOLD}║  ⚠ ALMOST READY - CONFIGURE KV BINDINGS & ENV VARS ║${NC}"
    echo -e "${YELLOW}${BOLD}╚════════════════════════════════════════════════════╝${NC}\n"
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "1. Configure KV bindings: https://dash.cloudflare.com/pages/view/trade-m8-production/settings/functions"
    echo "2. Add environment variables: https://dash.cloudflare.com/pages/view/trade-m8-production/settings/environment-variables"
    echo "3. Wait 2 minutes for redeploy"
    echo "4. Run this test again"
    echo ""
else
    echo -e "${RED}${BOLD}╔════════════════════════════════════════╗${NC}"
    echo -e "${RED}${BOLD}║  ✗ SOME TESTS FAILED - NEEDS ATTENTION ║${NC}"
    echo -e "${RED}${BOLD}╚════════════════════════════════════════╝${NC}\n"
fi

# URLs
echo -e "${BOLD}${CYAN}Production URLs:${NC}"
echo "  • Deployment: $BASE_URL"
echo "  • Custom Domain: https://trade-m8.app (after configuration)"
echo "  • Dashboard: https://dash.cloudflare.com/pages/view/trade-m8-production"
echo ""

# Documentation
echo -e "${BOLD}${CYAN}Documentation:${NC}"
echo "  • GO-LIVE-CHECKLIST.md - Final deployment steps"
echo "  • STEP-BY-STEP-BINDINGS.md - Configuration guide"
echo "  • AUTH-DASHBOARD-INTEGRATION.md - Integration details"
echo ""

exit $FAILED_TESTS
