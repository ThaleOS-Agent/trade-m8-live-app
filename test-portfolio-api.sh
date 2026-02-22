#!/bin/bash
# Test script for /api/portfolio endpoints
# Usage: ./test-portfolio-api.sh <jwt_token>

if [ -z "$1" ]; then
  echo "Usage: $0 <jwt_token>"
  echo ""
  echo "Example:"
  echo "  $0 'eyJhbGci...'"
  exit 1
fi

TOKEN="$1"
BASE_URL="${BASE_URL:-https://trade-m8.app}"

echo "💼 Testing Portfolio P&L Tracker API"
echo "====================================="
echo ""

# Test 1: Portfolio Overview
echo "1️⃣  GET /api/portfolio (overview)"
curl -s -X GET "$BASE_URL/api/portfolio" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo ""

# Test 2: Open Positions
echo "2️⃣  GET /api/portfolio/positions (open positions with unrealized P&L)"
curl -s -X GET "$BASE_URL/api/portfolio/positions" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo ""

# Test 3: Trade History
echo "3️⃣  GET /api/portfolio/trades (trade history)"
curl -s -X GET "$BASE_URL/api/portfolio/trades?limit=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo ""

# Test 4: Closed Trades Only
echo "4️⃣  GET /api/portfolio/trades?status=closed (closed trades with realized P&L)"
curl -s -X GET "$BASE_URL/api/portfolio/trades?status=closed&limit=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo ""

# Test 5: Performance Metrics
echo "5️⃣  GET /api/portfolio/metrics (performance metrics)"
curl -s -X GET "$BASE_URL/api/portfolio/metrics" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo ""

# Test 6: Portfolio Snapshots
echo "6️⃣  GET /api/portfolio/snapshots (historical snapshots)"
curl -s -X GET "$BASE_URL/api/portfolio/snapshots?limit=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo ""

# Test 7: Comprehensive Summary
echo "7️⃣  GET /api/portfolio/summary (comprehensive summary)"
curl -s -X GET "$BASE_URL/api/portfolio/summary" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -150

echo ""
echo "✅ Tests complete!"
