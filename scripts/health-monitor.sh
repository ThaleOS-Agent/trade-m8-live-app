#!/bin/bash

# Health Monitoring Script for Trade M8
# Monitors deployment health and sends notifications

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
PRODUCTION_URL="${1:-https://trade-m8.app}"
CHECK_INTERVAL="${2:-300}"  # Default: 5 minutes
LOG_FILE="logs/health-monitor.log"

# Create logs directory if it doesn't exist
mkdir -p logs

print_status() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${BLUE}[$timestamp]${NC} $1"
    echo "[$timestamp] $1" >> "$LOG_FILE"
}

print_success() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${GREEN}[$timestamp] ✓${NC} $1"
    echo "[$timestamp] SUCCESS: $1" >> "$LOG_FILE"
}

print_error() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${RED}[$timestamp] ✗${NC} $1"
    echo "[$timestamp] ERROR: $1" >> "$LOG_FILE"
}

check_health() {
    print_status "Checking health endpoint: $PRODUCTION_URL/api/health"

    # Make request and capture response
    RESPONSE=$(curl -s -w "\n%{http_code}" "$PRODUCTION_URL/api/health" 2>&1)
    HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
        print_success "Health check passed (HTTP $HTTP_CODE)"

        # Parse JSON response
        STATUS=$(echo "$BODY" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        VERSION=$(echo "$BODY" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)

        if [ "$STATUS" = "healthy" ]; then
            print_success "Service status: $STATUS (v$VERSION)"
            return 0
        else
            print_error "Service unhealthy: $STATUS"
            return 1
        fi
    else
        print_error "Health check failed (HTTP $HTTP_CODE)"
        echo "$BODY" >> "$LOG_FILE"
        return 1
    fi
}

check_api_endpoints() {
    print_status "Testing API endpoints..."

    # Test market analysis endpoint
    if curl -s -f "$PRODUCTION_URL/api/market-analysis?coinId=bitcoin&days=7" > /dev/null 2>&1; then
        print_success "Market analysis endpoint working"
    else
        print_error "Market analysis endpoint failed"
    fi

    # Test trading signals endpoint
    if curl -s -f "$PRODUCTION_URL/api/trading-signals?coins=bitcoin,ethereum" > /dev/null 2>&1; then
        print_success "Trading signals endpoint working"
    else
        print_error "Trading signals endpoint failed"
    fi

    # Test opportunities endpoint
    if curl -s -f "$PRODUCTION_URL/api/opportunities" > /dev/null 2>&1; then
        print_success "Opportunities endpoint working"
    else
        print_error "Opportunities endpoint failed"
    fi
}

measure_response_time() {
    print_status "Measuring response time..."

    START_TIME=$(date +%s%N)
    curl -s "$PRODUCTION_URL/api/health" > /dev/null 2>&1
    END_TIME=$(date +%s%N)

    RESPONSE_TIME=$(( (END_TIME - START_TIME) / 1000000 ))

    if [ $RESPONSE_TIME -lt 1000 ]; then
        print_success "Response time: ${RESPONSE_TIME}ms (Excellent)"
    elif [ $RESPONSE_TIME -lt 3000 ]; then
        echo -e "${YELLOW}⚠ Response time: ${RESPONSE_TIME}ms (Good)${NC}"
    else
        print_error "Response time: ${RESPONSE_TIME}ms (Slow)"
    fi
}

# Main monitoring loop
echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Trade M8 Health Monitor                    ║${NC}"
echo -e "${BLUE}║  Monitoring: $PRODUCTION_URL"
echo -e "${BLUE}║  Interval: ${CHECK_INTERVAL}s                          ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}\n"

if [ "$CHECK_INTERVAL" = "once" ]; then
    # Run once and exit
    check_health
    check_api_endpoints
    measure_response_time
    exit $?
fi

# Continuous monitoring
while true; do
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    check_health

    if [ $? -eq 0 ]; then
        check_api_endpoints
        measure_response_time
    else
        print_error "Skipping additional checks due to health check failure"
    fi

    print_status "Next check in ${CHECK_INTERVAL} seconds..."
    sleep "$CHECK_INTERVAL"
done
