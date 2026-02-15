#!/bin/bash

# Test if Cloudflare API token is working

echo "🔑 Testing Cloudflare API Token..."
echo ""

# Clean environment
unset CLOUDFLARE_API_TOKEN
unset CLOUDFLARE_ACCOUNT_ID

# Set SSL bypass
export NODE_TLS_REJECT_UNAUTHORIZED=0

# Load from .env.local
if [ -f ".env.local" ]; then
    export $(grep CLOUDFLARE_API_TOKEN .env.local | xargs)
    export $(grep CLOUDFLARE_ACCOUNT_ID .env.local | xargs)
fi

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo "❌ No CLOUDFLARE_API_TOKEN found in .env.local"
    echo ""
    echo "Please add it to .env.local:"
    echo "CLOUDFLARE_API_TOKEN=your_token_here"
    exit 1
fi

echo "Testing authentication..."
echo ""

# Test whoami
if NODE_TLS_REJECT_UNAUTHORIZED=0 wrangler whoami 2>&1 | grep -q "Account ID"; then
    echo "✅ SUCCESS! API Token is working!"
    echo ""
    NODE_TLS_REJECT_UNAUTHORIZED=0 wrangler whoami
    echo ""
    echo "🚀 Ready to deploy! Run: ./deploy-simple.sh"
else
    echo "❌ FAILED! API Token still has issues."
    echo ""
    echo "Error output:"
    NODE_TLS_REJECT_UNAUTHORIZED=0 wrangler whoami
    echo ""
    echo "Please check:"
    echo "1. Token is correct in .env.local"
    echo "2. IP restrictions are removed"
    echo "3. Token has required permissions"
    echo ""
    echo "See FIX-API-TOKEN.md for detailed instructions."
fi
