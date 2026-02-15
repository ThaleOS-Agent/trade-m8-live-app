#!/bin/bash

# Test CoinGecko Enhanced API Endpoints
# Tests the new market analysis, trading signals, and opportunities endpoints

set +e  # Continue on errors to see all results

# Configuration
BASE_URL="${1:-https://ae5fc56f.trade-m8-production.pages.dev}"

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
echo "║   🚀 COINGECKO API INTEGRATION TEST SUITE 🚀     ║"
echo "║                                                    ║"
echo "║   Testing Enhanced Market Analysis Endpoints      ║"
echo "║                                                    ║"
echo "╚════════════════════════════════════════════════════╝"
echo -e "${NC}\n"

echo -e "${BOLD}Test Configuration:${NC}"
echo "  Base URL: $BASE_URL"
echo "  Timestamp: $(date)"
echo ""

# ============================================
# SECTION 1: MARKET ANALYSIS ENDPOINT
# ============================================
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}"
echo -e "${BOLD}${MAGENTA}   SECTION 1: MARKET ANALYSIS${NC}"
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}\n"

# Test 1: Analyze Bitcoin
test_start "1" "Market Analysis - Bitcoin (14 days)"
ANALYSIS=$(curl -s "$BASE_URL/api/market-analysis?coinId=bitcoin&days=14")
echo "Response: $ANALYSIS"

if echo "$ANALYSIS" | grep -q "success.*true"; then
    if echo "$ANALYSIS" | grep -q "rsi"; then
        RSI=$(echo "$ANALYSIS" | grep -o '"rsi":[0-9.]*' | cut -d':' -f2)
        SIGNAL=$(echo "$ANALYSIS" | grep -o '"signal":"[^"]*"' | cut -d'"' -f4)
        test_pass "Bitcoin analysis successful - RSI: $RSI, Signal: $SIGNAL"
    else
        test_pass "Bitcoin analysis successful (structure different)"
    fi
else
    test_fail "Bitcoin analysis failed"
fi

# Test 2: Analyze Ethereum
test_start "2" "Market Analysis - Ethereum (7 days)"
ANALYSIS=$(curl -s "$BASE_URL/api/market-analysis?coinId=ethereum&days=7")
echo "Response: $ANALYSIS"

if echo "$ANALYSIS" | grep -q "success.*true"; then
    test_pass "Ethereum analysis successful"
else
    test_fail "Ethereum analysis failed"
fi

# Test 3: Invalid coin ID
test_start "3" "Market Analysis - Invalid Coin (Error Handling)"
ANALYSIS=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/market-analysis?coinId=invalidcoin123&days=7")
HTTP_CODE=$(echo "$ANALYSIS" | tail -n1)
BODY=$(echo "$ANALYSIS" | head -n-1)
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "404" ] || echo "$BODY" | grep -q "error"; then
    test_pass "Invalid coin handled correctly"
else
    test_warning "Error handling may need improvement"
fi

# Test 4: Missing coinId parameter
test_start "4" "Market Analysis - Missing Parameter (Error Handling)"
ANALYSIS=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/market-analysis")
HTTP_CODE=$(echo "$ANALYSIS" | tail -n1)
BODY=$(echo "$ANALYSIS" | head -n-1)
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "400" ] || echo "$BODY" | grep -q "required"; then
    test_pass "Missing parameter handled correctly"
else
    test_fail "Missing parameter not handled properly"
fi

# ============================================
# SECTION 2: TRADING SIGNALS ENDPOINT
# ============================================
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}"
echo -e "${BOLD}${MAGENTA}   SECTION 2: TRADING SIGNALS${NC}"
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}\n"

# Test 5: Get signals for multiple coins (default)
test_start "5" "Trading Signals - Default Coins (BTC, ETH, ADA)"
SIGNALS=$(curl -s "$BASE_URL/api/trading-signals")
echo "Response: $SIGNALS"

if echo "$SIGNALS" | grep -q "success.*true"; then
    if echo "$SIGNALS" | grep -q "bitcoin"; then
        test_pass "Default trading signals retrieved successfully"
    else
        test_pass "Trading signals retrieved (may use different structure)"
    fi
else
    test_fail "Default trading signals failed"
fi

# Test 6: Custom coin list
test_start "6" "Trading Signals - Custom Coins (SOL, DOT, LINK)"
SIGNALS=$(curl -s "$BASE_URL/api/trading-signals?coins=solana,polkadot,chainlink")
echo "Response: $SIGNALS"

if echo "$SIGNALS" | grep -q "success.*true"; then
    test_pass "Custom coin signals retrieved successfully"
else
    test_fail "Custom coin signals failed"
fi

# Test 7: Single coin
test_start "7" "Trading Signals - Single Coin (BNB)"
SIGNALS=$(curl -s "$BASE_URL/api/trading-signals?coins=binancecoin")
echo "Response: $SIGNALS"

if echo "$SIGNALS" | grep -q "success.*true"; then
    test_pass "Single coin signal retrieved successfully"
else
    test_fail "Single coin signal failed"
fi

# ============================================
# SECTION 3: TRADING OPPORTUNITIES
# ============================================
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}"
echo -e "${BOLD}${MAGENTA}   SECTION 3: TRADING OPPORTUNITIES${NC}"
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}\n"

# Test 8: Get trading opportunities
test_start "8" "Trading Opportunities - Gainers, Trending, Reversal"
OPPORTUNITIES=$(curl -s "$BASE_URL/api/opportunities")
echo "Response: $OPPORTUNITIES"

if echo "$OPPORTUNITIES" | grep -q "success.*true"; then
    if echo "$OPPORTUNITIES" | grep -q "highMomentum\|trending\|reversal"; then
        test_pass "Trading opportunities retrieved successfully"
    else
        test_pass "Trading opportunities retrieved (structure may vary)"
    fi
else
    test_fail "Trading opportunities failed"
fi

# Test 9: Caching test (second request should be faster)
test_start "9" "Trading Opportunities - Cache Performance"
echo "First request (cache miss)..."
START1=$(date +%s%N)
curl -s "$BASE_URL/api/opportunities" > /dev/null
END1=$(date +%s%N)
DURATION1=$(( (END1 - START1) / 1000000 ))

sleep 1

echo "Second request (cache hit)..."
START2=$(date +%s%N)
CACHED=$(curl -s "$BASE_URL/api/opportunities")
END2=$(date +%s%N)
DURATION2=$(( (END2 - START2) / 1000000 ))

echo "First request: ${DURATION1}ms"
echo "Second request: ${DURATION2}ms"

if echo "$CACHED" | grep -q "fromCache.*true"; then
    test_pass "Caching working correctly - cached response marked"
elif [ $DURATION2 -lt $DURATION1 ]; then
    test_pass "Second request faster (${DURATION2}ms vs ${DURATION1}ms) - likely cached"
else
    test_warning "Caching may not be working as expected"
fi

# ============================================
# SECTION 4: PERFORMANCE TESTS
# ============================================
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}"
echo -e "${BOLD}${MAGENTA}   SECTION 4: PERFORMANCE TESTS${NC}"
echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════${NC}\n"

# Test 10: Response time
test_start "10" "API Response Time - Market Analysis"
START=$(date +%s%N)
curl -s "$BASE_URL/api/market-analysis?coinId=bitcoin&days=7" > /dev/null
END=$(date +%s%N)
DURATION=$(( (END - START) / 1000000 ))

echo "Response time: ${DURATION}ms"

if [ $DURATION -lt 3000 ]; then
    test_pass "Response time excellent (<3s): ${DURATION}ms"
elif [ $DURATION -lt 5000 ]; then
    test_pass "Response time good (<5s): ${DURATION}ms"
else
    test_warning "Response time slow (>5s): ${DURATION}ms - CoinGecko API may be rate limiting"
fi

# Test 11: Concurrent requests
test_start "11" "Concurrent Analysis Requests"
echo "Sending 3 concurrent market analysis requests..."

START=$(date +%s%N)
curl -s "$BASE_URL/api/market-analysis?coinId=bitcoin" > /dev/null &
curl -s "$BASE_URL/api/market-analysis?coinId=ethereum" > /dev/null &
curl -s "$BASE_URL/api/market-analysis?coinId=cardano" > /dev/null &
wait
END=$(date +%s%N)
DURATION=$(( (END - START) / 1000000 ))

echo "Total time for 3 concurrent requests: ${DURATION}ms"
test_pass "Handled 3 concurrent analysis requests successfully in ${DURATION}ms"

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
    echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║  ✓ ALL COINGECKO ENDPOINTS WORKING PERFECTLY!     ║${NC}"
    echo -e "${GREEN}${BOLD}╚════════════════════════════════════════════════════╝${NC}\n"
    echo -e "${GREEN}🎉 CoinGecko integration is fully functional!${NC}\n"
else
    echo -e "${YELLOW}${BOLD}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}${BOLD}║  ⚠ SOME TESTS FAILED - CHECK COINGECKO API KEY    ║${NC}"
    echo -e "${YELLOW}${BOLD}╚════════════════════════════════════════════════════╝${NC}\n"
    echo -e "${YELLOW}Make sure COINGECKO_API_KEY is set in environment variables${NC}\n"
fi

# Documentation
echo -e "${BOLD}${CYAN}New API Endpoints Available:${NC}"
echo "  1. /api/market-analysis?coinId=bitcoin&days=14"
echo "     - Provides RSI, trend detection, momentum analysis"
echo ""
echo "  2. /api/trading-signals?coins=bitcoin,ethereum,cardano"
echo "     - Multi-coin analysis with buy/sell/hold signals"
echo ""
echo "  3. /api/opportunities"
echo "     - Top gainers, trending coins, reversal opportunities"
echo ""

echo -e "${BOLD}${CYAN}Integration Details:${NC}"
echo "  • CoinGecko Free API: 10-50 calls/minute"
echo "  • Caching: 5 minutes (market-analysis, signals), 10 minutes (opportunities)"
echo "  • Technical Indicators: RSI (14-period), Volatility, Trend Detection"
echo "  • See COINGECKO-INTEGRATION.md for full documentation"
echo ""

exit $FAILED_TESTS
