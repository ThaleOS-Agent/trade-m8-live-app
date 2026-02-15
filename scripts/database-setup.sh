#!/bin/bash

# XQ Trade M8 - Automated Database Setup Script
# This script sets up D1 database, KV namespaces, and R2 buckets

set -e  # Exit on error

echo "🚀 XQ Trade M8 - Database Setup"
echo "================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "wrangler.toml" ]; then
    echo -e "${RED}Error: wrangler.toml not found. Please run from project root.${NC}"
    exit 1
fi

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}Wrangler not found. Installing...${NC}"
    npm install -g wrangler
fi

# Source environment variables safely
if [ -f ".env.local" ]; then
    # Extract only CLOUDFLARE variables safely
    export CLOUDFLARE_API_TOKEN=$(grep "^CLOUDFLARE_API_TOKEN=" .env.local | cut -d '=' -f2)
    export CLOUDFLARE_ACCOUNT_ID=$(grep "^CLOUDFLARE_ACCOUNT_ID=" .env.local | cut -d '=' -f2)
fi

# Set environment variables for SSL bypass
export NODE_TLS_REJECT_UNAUTHORIZED=0

echo -e "${YELLOW}Step 1: Creating D1 Database${NC}"
echo "Creating trade-m8-db..."

# Try to create D1 database
if wrangler d1 create trade-m8-db 2>/dev/null; then
    echo -e "${GREEN}✓ D1 database created successfully${NC}"
    echo ""
    echo -e "${YELLOW}IMPORTANT: Copy the database_id from above and paste it into wrangler.toml${NC}"
    echo ""
else
    echo -e "${YELLOW}⚠ Database might already exist or API token lacks permissions${NC}"
    echo ""
    echo "If you see an authentication error, please:"
    echo "1. Go to https://dash.cloudflare.com/profile/api-tokens"
    echo "2. Create a token with D1 Edit permissions"
    echo "3. Update CLOUDFLARE_API_TOKEN in .env.local"
    echo ""
    echo -e "${YELLOW}Alternatively, create the database manually in the Cloudflare Dashboard:${NC}"
    echo "https://dash.cloudflare.com/${CLOUDFLARE_ACCOUNT_ID}/workers/d1"
    echo ""
fi

echo -e "${YELLOW}Step 2: Listing existing D1 databases${NC}"
wrangler d1 list 2>/dev/null || echo -e "${YELLOW}Could not list databases (permission issue)${NC}"
echo ""

echo -e "${YELLOW}Step 3: KV Namespace Setup${NC}"
echo "Note: KV namespaces are optional but recommended for caching"
echo ""

create_kv() {
    local name=$1
    echo "Creating KV namespace: $name"
    if wrangler kv:namespace create "$name" 2>/dev/null; then
        echo -e "${GREEN}✓ KV namespace $name created${NC}"
    else
        echo -e "${YELLOW}⚠ Could not create $name (might already exist or permission issue)${NC}"
    fi
}

create_kv "CACHE"
create_kv "SESSIONS"
create_kv "TRADES"
echo ""

echo -e "${YELLOW}Step 4: R2 Bucket Setup${NC}"
echo "Creating R2 bucket: trade-m8-assets"
if wrangler r2 bucket create trade-m8-assets 2>/dev/null; then
    echo -e "${GREEN}✓ R2 bucket created${NC}"
else
    echo -e "${YELLOW}⚠ Bucket might already exist${NC}"
fi
echo ""

echo -e "${YELLOW}Step 5: Database Schema${NC}"
echo "To initialize the database schema, you have two options:"
echo ""
echo "Option A - Via Wrangler (if database exists and token works):"
echo "  wrangler d1 execute trade-m8-db --file=COPY-THIS-TO-D1.sql"
echo ""
echo "Option B - Via Cloudflare Dashboard (recommended):"
echo "  1. Go to your D1 database in dashboard"
echo "  2. Click 'Console' tab"
echo "  3. Copy/paste contents of COPY-THIS-TO-D1.sql"
echo "  4. Click 'Execute'"
echo ""

read -p "Do you want to try executing the schema now via Wrangler? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if wrangler d1 execute trade-m8-db --file=COPY-THIS-TO-D1.sql 2>/dev/null; then
        echo -e "${GREEN}✓ Database schema initialized${NC}"
    else
        echo -e "${RED}✗ Failed to execute schema. Use dashboard method instead.${NC}"
    fi
fi
echo ""

echo -e "${YELLOW}Step 6: Create Test User${NC}"
read -p "Create a test user in the database? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    wrangler d1 execute trade-m8-db --command="
    INSERT INTO users (id, email, password_hash, full_name, role, status, created_at)
    VALUES (
        'test-user-001',
        'demo@trade-m8.app',
        '\$2a\$10\$DEMO.HASH.FOR.TESTING.PURPOSES.ONLY',
        'Demo User',
        'user',
        'active',
        strftime('%s', 'now')
    );" 2>/dev/null && echo -e "${GREEN}✓ Test user created${NC}" || echo -e "${YELLOW}⚠ Could not create test user${NC}"
fi
echo ""

echo "================================"
echo -e "${GREEN}Setup Complete!${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Update wrangler.toml with your database_id and namespace IDs"
echo "2. Review COMPLETE-DATABASE-SETUP.md for detailed instructions"
echo "3. Build and deploy: npm run build && wrangler pages deploy dist"
echo "4. Test your API: curl https://your-app.pages.dev/api/health"
echo ""
echo -e "${YELLOW}Important Configuration Files:${NC}"
echo "  - wrangler.toml (update database_id and KV IDs)"
echo "  - .env.local (ensure all secrets are set)"
echo "  - COMPLETE-DATABASE-SETUP.md (full documentation)"
echo ""
echo "Happy Trading! 🚀"
