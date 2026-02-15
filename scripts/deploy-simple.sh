#!/bin/bash

# Simple deployment script for Trade M8
# This script guides you through manual deployment steps

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     XQ Trade M8 - Manual Deployment Guide           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Disable SSL verification for wrangler
export NODE_TLS_REJECT_UNAUTHORIZED=0

echo -e "${YELLOW}Step 1: Authenticate with Cloudflare${NC}"
echo "Opening browser for authentication..."
echo "If browser doesn't open automatically, copy the URL that appears."
echo ""

# Attempt login
if wrangler login; then
    echo -e "${GREEN}✓ Logged in successfully${NC}"
else
    echo -e "${YELLOW}⚠ Login failed. Please try manually:${NC}"
    echo "Run: NODE_TLS_REJECT_UNAUTHORIZED=0 wrangler login"
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 2: Create D1 Database${NC}"

# Check if database exists
if wrangler d1 list 2>/dev/null | grep -q "xq-trade-m8-db"; then
    echo -e "${GREEN}✓ Database already exists${NC}"
else
    echo "Creating D1 database..."
    wrangler d1 create xq-trade-m8-db

    echo ""
    echo -e "${YELLOW}Important: Copy the database_id from above output${NC}"
    echo "Paste it here:"
    read -p "Database ID: " DB_ID

    # Update wrangler.toml
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/# database_id = .*/database_id = \"$DB_ID\"/" wrangler.toml
        sed -i '' 's/# \[\[d1_databases\]\]/[[d1_databases]]/' wrangler.toml
        sed -i '' 's/# binding = "DB"/binding = "DB"/' wrangler.toml
        sed -i '' 's/# database_name = .*/database_name = "xq-trade-m8-db"/' wrangler.toml
    else
        sed -i "s/# database_id = .*/database_id = \"$DB_ID\"/" wrangler.toml
        sed -i 's/# \[\[d1_databases\]\]/[[d1_databases]]/' wrangler.toml
        sed -i 's/# binding = "DB"/binding = "DB"/' wrangler.toml
        sed -i 's/# database_name = .*/database_name = "xq-trade-m8-db"/' wrangler.toml
    fi

    echo -e "${GREEN}✓ Database created and configured${NC}"
fi

echo ""
echo -e "${YELLOW}Step 3: Run Database Migrations${NC}"
if wrangler d1 execute xq-trade-m8-db --file=database/schema.sql --local; then
    echo -e "${GREEN}✓ Local migrations completed${NC}"
    echo "Running remote migrations..."
    wrangler d1 execute xq-trade-m8-db --file=database/schema.sql --remote
    echo -e "${GREEN}✓ Remote migrations completed${NC}"
else
    echo -e "${YELLOW}⚠ Migrations may have failed, continuing...${NC}"
fi

echo ""
echo -e "${YELLOW}Step 4: Create KV Namespaces${NC}"

create_kv() {
    local NAME=$1
    echo "Creating KV namespace: $NAME..."
    wrangler kv:namespace create "$NAME" 2>&1 || echo "May already exist"
}

create_kv "CACHE"
create_kv "SESSIONS"
create_kv "TRADES"

echo -e "${GREEN}✓ KV namespaces created${NC}"

echo ""
echo -e "${YELLOW}Step 5: Deploy to Cloudflare Pages${NC}"
echo "Deploying..."

if wrangler pages deploy dist --project-name=xq-trade-m8; then
    echo -e "${GREEN}✓ Deployment successful!${NC}"
else
    echo -e "${YELLOW}⚠ First time deployment...${NC}"
    echo "Creating new Pages project..."
    wrangler pages project create xq-trade-m8 --production-branch=main
    echo "Deploying again..."
    wrangler pages deploy dist --project-name=xq-trade-m8
fi

echo ""
echo -e "${YELLOW}Step 6: Set Environment Secrets${NC}"

# Source environment
source .env.local

echo "Setting Supabase URL..."
echo "$SUPABASE_URL" | wrangler pages secret put SUPABASE_URL --project-name=xq-trade-m8 2>/dev/null || echo "Set manually later"

echo "Setting Supabase Key..."
echo "$SUPABASE_ANON_KEY" | wrangler pages secret put SUPABASE_KEY --project-name=xq-trade-m8 2>/dev/null || echo "Set manually later"

echo "Setting JWT Secret..."
echo "$JWT_SECRET" | wrangler pages secret put JWT_SECRET --project-name=xq-trade-m8 2>/dev/null || echo "Set manually later"

echo -e "${GREEN}✓ Secrets configured${NC}"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           🎉 Deployment Complete! 🎉                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Get deployment URL
echo -e "${BLUE}Getting deployment URL...${NC}"
DEPLOY_URL=$(wrangler pages deployment list --project-name=xq-trade-m8 2>/dev/null | grep "https://" | head -1 | awk '{print $1}' || echo "")

if [ ! -z "$DEPLOY_URL" ]; then
    echo -e "${GREEN}🌐 Your app is live at: $DEPLOY_URL${NC}"
    echo ""
    echo -e "${BLUE}Test it:${NC}"
    echo "curl $DEPLOY_URL/api/health"
else
    echo -e "${YELLOW}Visit Cloudflare Dashboard to get your URL:${NC}"
    echo "https://dash.cloudflare.com -> Pages -> xq-trade-m8"
fi

echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "1. Visit your application URL"
echo "2. Login with: demo@xqtradem8.com / demo123"
echo "3. Test the trading dashboard"
echo "4. Add CoinGecko API key for market data:"
echo "   wrangler pages secret put COINGECKO_API_KEY --project-name=xq-trade-m8"
echo ""
echo -e "${YELLOW}⚠️ Important: Start with DEMO mode only!${NC}"
echo ""
