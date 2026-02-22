#!/bin/bash
# Test script for /api/backtest endpoints
# Usage: ./test-backtest-api.sh <jwt_token>

if [ -z "$1" ]; then
  echo "Usage: $0 <jwt_token>"
  echo ""
  echo "Example:"
  echo "  $0 'eyJhbGci...'"
  exit 1
fi

TOKEN="$1"
BASE_URL="${BASE_URL:-https://trade-m8.app}"

echo "🧪 Testing Backtest API Endpoints"
echo "=================================="
echo ""

# Test 1: Run backtest with synthetic data
echo "1️⃣  POST /api/backtest/run (synthetic data, technical_master strategy)"
curl -s -X POST "$BASE_URL/api/backtest/run" \
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
  }' | python3 -m json.tool 2>&1 | head -80

echo ""
echo ""

# Test 2: Run backtest with AI
echo "2️⃣  POST /api/backtest/run (synthetic data, ensemble strategy + AI)"
curl -s -X POST "$BASE_URL/api/backtest/run" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "symbol": "ETH/USDT",
    "days": 60,
    "initialCapital": 5000,
    "strategy": "ensemble",
    "enableAI": true,
    "enableRiskManagement": true,
    "useSampleData": true,
    "maxBars": 200
  }' | python3 -m json.tool 2>&1 | head -80

echo ""
echo ""

# Test 3: List results
echo "3️⃣  GET /api/backtest/results (list all backtest results)"
curl -s -X GET "$BASE_URL/api/backtest/results?limit=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo ""

# Test 4: Get specific result (extract ID from list)
RESULT_ID=$(curl -s -X GET "$BASE_URL/api/backtest/results?limit=1" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['results'][0]['id'] if d.get('results') else '')" 2>/dev/null)

if [ -n "$RESULT_ID" ]; then
  echo "4️⃣  GET /api/backtest/results/$RESULT_ID (get specific result)"
  curl -s -X GET "$BASE_URL/api/backtest/results/$RESULT_ID" \
    -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -100

  echo ""
  echo ""

  echo "5️⃣  DELETE /api/backtest/results/$RESULT_ID (delete result)"
  curl -s -X DELETE "$BASE_URL/api/backtest/results/$RESULT_ID" \
    -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
else
  echo "4️⃣  Skipping GET/DELETE tests (no results found)"
fi

echo ""
echo "✅ Tests complete!"
