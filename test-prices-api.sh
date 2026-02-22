#!/bin/bash
# Test script for /api/prices endpoints
# Usage: ./test-prices-api.sh

BASE_URL="${BASE_URL:-https://trade-m8.app}"

echo "💰 Testing Real-time Prices API"
echo "================================"
echo ""

# Test 1: Current Prices (REST)
echo "1️⃣  GET /api/prices?symbols=BTC,ETH,BNB (current prices)"
curl -s "$BASE_URL/api/prices?symbols=BTC,ETH,BNB" | python3 -m json.tool

echo ""
echo ""

# Test 2: Single Symbol
echo "2️⃣  GET /api/prices?symbols=BTC (single symbol)"
curl -s "$BASE_URL/api/prices?symbols=BTC" | python3 -m json.tool

echo ""
echo ""

# Test 3: Many Symbols
echo "3️⃣  GET /api/prices?symbols=BTC,ETH,BNB,SOL,XRP,ADA (multiple symbols)"
curl -s "$BASE_URL/api/prices?symbols=BTC,ETH,BNB,SOL,XRP,ADA" | python3 -m json.tool

echo ""
echo ""

# Test 4: Price History
echo "4️⃣  GET /api/prices/history?symbol=BTC&days=7 (7-day OHLCV history)"
curl -s "$BASE_URL/api/prices/history?symbol=BTC&days=7" | python3 -m json.tool | head -60

echo ""
echo ""

# Test 5: Short History
echo "5️⃣  GET /api/prices/history?symbol=ETH&days=1 (1-day history)"
curl -s "$BASE_URL/api/prices/history?symbol=ETH&days=1" | python3 -m json.tool | head -40

echo ""
echo "✅ REST API tests complete!"
echo ""
echo "📡 To test the SSE streaming endpoint, run:"
echo "   ./test-prices-stream.sh"
