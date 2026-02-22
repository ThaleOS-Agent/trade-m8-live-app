#!/bin/bash
# Test script for /api/prices/stream SSE endpoint
# Usage: ./test-prices-stream.sh [duration_seconds]

DURATION="${1:-30}"
BASE_URL="${BASE_URL:-https://trade-m8.app}"

echo "📡 Testing Real-time Price Streaming (SSE)"
echo "=========================================="
echo "URL: $BASE_URL/api/prices/stream"
echo "Symbols: BTC, ETH, BNB"
echo "Duration: ${DURATION}s"
echo ""
echo "Press Ctrl+C to stop early"
echo ""

# Stream prices for specified duration
timeout "${DURATION}s" curl -s -N "$BASE_URL/api/prices/stream?symbols=BTC,ETH,BNB&interval=5000" | while IFS= read -r line; do
  # Skip empty lines and comments
  if [[ -z "$line" ]] || [[ "$line" == :* ]]; then
    continue
  fi

  # Extract data after "data: " prefix
  if [[ "$line" == data:* ]]; then
    data="${line#data: }"
    echo "$(date '+%H:%M:%S') | $data" | python3 -m json.tool 2>/dev/null || echo "$(date '+%H:%M:%S') | $data"
    echo ""
  fi
done

echo ""
echo "✅ Stream test complete!"
echo ""
echo "💡 Tips:"
echo "  • The stream sends updates every 5 seconds (configurable via 'interval' param)"
echo "  • Max symbols: 20"
echo "  • Interval range: 3-60 seconds"
echo "  • Auto-timeout: 10 minutes"
echo ""
echo "Examples:"
echo "  ./test-prices-stream.sh 60            # Run for 60 seconds"
echo "  curl -N '$BASE_URL/api/prices/stream?symbols=BTC&interval=3000'  # 3s updates"
