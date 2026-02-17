#!/bin/bash

# Post-Deployment Verification Script
# Comprehensive testing after deployment

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
PRODUCTION_URL="${1:-https://trade-m8.app}"
PASSED=0
FAILED=0

print_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

test_endpoint() {
    local name=$1
    local url=$2
    local expected_status=${3:-200}

    printf "Testing %-40s " "$name..."

    RESPONSE=$(curl -s -w "\n%{http_code}" "$url" 2>&1)
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    if [ "$HTTP_CODE" = "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $HTTP_CODE)"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $HTTP_CODE)"
        ((FAILED++))
        return 1
    fi
}

measure_performance() {
    local url=$1
    local name=$2

    START=$(date +%s%N)
    curl -s "$url" > /dev/null 2>&1
    END=$(date +%s%N)

    RESPONSE_TIME=$(( (END - START) / 1000000 ))

    printf "%-40s " "$name:"

    if [ $RESPONSE_TIME -lt 500 ]; then
        echo -e "${GREEN}${RESPONSE_TIME}ms (Excellent)${NC}"
    elif [ $RESPONSE_TIME -lt 1000 ]; then
        echo -e "${GREEN}${RESPONSE_TIME}ms (Good)${NC}"
    elif [ $RESPONSE_TIME -lt 2000 ]; then
        echo -e "${YELLOW}${RESPONSE_TIME}ms (Average)${NC}"
    else
        echo -e "${RED}${RESPONSE_TIME}ms (Slow)${NC}"
    fi
}

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Trade M8 Post-Deployment Verification              ║${NC}"
echo -e "${BLUE}║  Target: $PRODUCTION_URL${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"

# Wait for deployment to propagate
print_header "Waiting for deployment to propagate (30s)..."
sleep 30

# Core API Tests
print_header "Core API Tests"
test_endpoint "Health Endpoint" "$PRODUCTION_URL/api/health"
test_endpoint "Market Analysis (Bitcoin)" "$PRODUCTION_URL/api/market-analysis?coinId=bitcoin&days=7"
test_endpoint "Trading Signals (Multi-coin)" "$PRODUCTION_URL/api/trading-signals?coins=bitcoin,ethereum,solana"
test_endpoint "Opportunities" "$PRODUCTION_URL/api/opportunities"

# Frontend Tests
print_header "Frontend Tests"
test_endpoint "Homepage" "$PRODUCTION_URL/"
test_endpoint "Static Assets" "$PRODUCTION_URL/vite.svg"

# Authentication Tests (expect redirect or login required)
print_header "Authentication Tests"
test_endpoint "Bots Endpoint (requires auth)" "$PRODUCTION_URL/api/bots" "401"
test_endpoint "Portfolio Endpoint (requires auth)" "$PRODUCTION_URL/api/portfolio" "401"

# Performance Tests
print_header "Performance Tests"
measure_performance "$PRODUCTION_URL/api/health" "Health Endpoint Response Time"
measure_performance "$PRODUCTION_URL/api/market-analysis?coinId=bitcoin&days=7" "Market Analysis Response Time"
measure_performance "$PRODUCTION_URL/" "Homepage Response Time"

# SSL/TLS Test
print_header "Security Tests"
printf "Testing SSL/TLS certificate... "
if curl -s --head "$PRODUCTION_URL" | grep -q "HTTP.*200\|HTTP.*301\|HTTP.*302"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Check response headers
print_header "Security Headers"
HEADERS=$(curl -s -I "$PRODUCTION_URL")

check_header() {
    local header=$1
    local name=$2

    printf "Checking %-40s " "$name..."
    if echo "$HEADERS" | grep -qi "$header"; then
        echo -e "${GREEN}✓ Present${NC}"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠ Missing${NC}"
    fi
}

check_header "strict-transport-security" "HSTS"
check_header "x-content-type-options" "X-Content-Type-Options"
check_header "x-frame-options" "X-Frame-Options"

# Final Summary
print_header "Test Summary"
TOTAL=$((PASSED + FAILED))
PERCENTAGE=$((PASSED * 100 / TOTAL))

echo -e "Total Tests:    ${BLUE}$TOTAL${NC}"
echo -e "Passed:         ${GREEN}$PASSED${NC}"
echo -e "Failed:         ${RED}$FAILED${NC}"
echo -e "Success Rate:   ${BLUE}${PERCENTAGE}%${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}╔═══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✓ All tests passed! Deployment successful!  ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "\n${YELLOW}╔═══════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  ⚠ Some tests failed. Review logs above.    ║${NC}"
    echo -e "${YELLOW}╚═══════════════════════════════════════════════╝${NC}"
    exit 1
fi
