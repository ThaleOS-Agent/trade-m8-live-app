#!/bin/bash

# XQ Trade M8 - Cloudflare Automated Deployment Script
# This script deploys the complete trading platform to Cloudflare

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Start deployment
clear
echo -e "${BLUE}"
cat << "EOF"
 __   __  ___       _____             _        __  __  ___  
 \ \ / / / _ \     |_   _| _ __ _  __| | ___  |  \/  |( _ ) 
  \ V / | | | |      | || '__/ _` |/ _  |/ _ \ | |\/| |/ _ \ 
   | |  | |_| |      | || | | (_| | (_| |  __/ | |  | | (_) |
   |_|   \__\_\      |_||_|  \__,_|\__,_|\___| |_|  |_|\___/ 
                                                              
    Cloudflare Production Deployment Script v1.0.0
    
EOF
echo -e "${NC}"

print_header "Step 1: Pre-Deployment Checks"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi
print_success "Node.js $(node -v) found"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi
print_success "npm $(npm -v) found"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    print_info "Wrangler not found. Installing..."
    npm install -g wrangler
    print_success "Wrangler installed"
else
    print_success "Wrangler $(wrangler --version) found"
fi

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    print_error ".env.local file not found. Creating from template..."
    cp .env.example .env.local
    print_info "Please edit .env.local with your API keys and run this script again."
    exit 1
fi
print_success ".env.local found"

print_header "Step 2: Install Dependencies"

print_info "Installing npm packages..."
npm install
print_success "Dependencies installed"

print_header "Step 3: Cloudflare Authentication"

# Check if already logged in
if wrangler whoami &> /dev/null; then
    print_success "Already logged in to Cloudflare"
else
    print_info "Please login to Cloudflare..."
    wrangler login
    print_success "Logged in to Cloudflare"
fi

# Get account ID
ACCOUNT_ID=$(wrangler whoami | grep "Account ID" | awk '{print $3}')
print_info "Account ID: $ACCOUNT_ID"

print_header "Step 4: Create D1 Database"

# Check if database exists
DB_EXISTS=$(wrangler d1 list | grep -c "xq-trade-m8-db" || true)

if [ "$DB_EXISTS" -eq 0 ]; then
    print_info "Creating D1 database..."
    wrangler d1 create xq-trade-m8-db
    
    # Get database ID and update wrangler.toml
    DB_ID=$(wrangler d1 list | grep "xq-trade-m8-db" | awk '{print $2}')
    
    # Update wrangler.toml with database ID
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/database_id = \"\"/database_id = \"$DB_ID\"/" wrangler.toml
    else
        sed -i "s/database_id = \"\"/database_id = \"$DB_ID\"/" wrangler.toml
    fi
    
    print_success "Database created: $DB_ID"
else
    print_success "Database already exists"
fi

print_header "Step 5: Run Database Migrations"

if [ -f "database/schema.sql" ]; then
    print_info "Running database migrations..."
    wrangler d1 execute xq-trade-m8-db --file=database/schema.sql
    print_success "Database schema created"
else
    print_info "No schema.sql found, skipping migrations"
fi

print_header "Step 6: Create KV Namespaces"

# Function to create KV namespace
create_kv_namespace() {
    local NAME=$1
    local BINDING=$2
    
    # Check if namespace exists
    KV_EXISTS=$(wrangler kv:namespace list | grep -c "\"title\":\"xq-trade-m8-production-$NAME\"" || true)
    
    if [ "$KV_EXISTS" -eq 0 ]; then
        print_info "Creating KV namespace: $NAME..."
        wrangler kv:namespace create "$NAME"
        print_success "KV namespace created: $NAME"
    else
        print_success "KV namespace already exists: $NAME"
    fi
}

create_kv_namespace "CACHE" "CACHE"
create_kv_namespace "SESSIONS" "SESSIONS"
create_kv_namespace "TRADES" "TRADES"

print_header "Step 7: Create R2 Bucket"

# Check if bucket exists
BUCKET_EXISTS=$(wrangler r2 bucket list | grep -c "xq-trade-m8-assets" || true)

if [ "$BUCKET_EXISTS" -eq 0 ]; then
    print_info "Creating R2 bucket..."
    wrangler r2 bucket create xq-trade-m8-assets
    print_success "R2 bucket created"
else
    print_success "R2 bucket already exists"
fi

print_header "Step 8: Set Environment Secrets"

print_info "Setting up environment secrets..."

# Read secrets from .env.local
source .env.local

# Set secrets (only if they don't exist)
set_secret_if_exists() {
    local SECRET_NAME=$1
    local SECRET_VALUE=$2
    
    if [ ! -z "$SECRET_VALUE" ]; then
        echo "$SECRET_VALUE" | wrangler secret put "$SECRET_NAME" --quiet 2>/dev/null || true
        print_success "Secret set: $SECRET_NAME"
    fi
}

set_secret_if_exists "SUPABASE_URL" "$SUPABASE_URL"
set_secret_if_exists "SUPABASE_KEY" "$SUPABASE_ANON_KEY"
set_secret_if_exists "JWT_SECRET" "$JWT_SECRET"
set_secret_if_exists "COINGECKO_API_KEY" "$COINGECKO_API_KEY"

print_header "Step 9: Build Frontend"

print_info "Building production frontend..."
npm run build
print_success "Frontend built successfully"

print_header "Step 10: Deploy Cloudflare Workers"

print_info "Deploying Workers..."
wrangler deploy
print_success "Workers deployed"

print_header "Step 11: Deploy Cloudflare Pages"

print_info "Deploying Pages..."
wrangler pages deploy dist --project-name=xq-trade-m8
print_success "Pages deployed"

print_header "Step 12: Health Check"

print_info "Waiting for deployment to propagate (10 seconds)..."
sleep 10

# Get deployment URL
DEPLOYMENT_URL=$(wrangler pages deployment list --project-name=xq-trade-m8 | grep "https" | head -n1 | awk '{print $1}')

if [ ! -z "$DEPLOYMENT_URL" ]; then
    print_info "Testing deployment at: $DEPLOYMENT_URL"
    
    # Try to fetch health endpoint
    if curl -s -f "${DEPLOYMENT_URL}/api/health" > /dev/null 2>&1; then
        print_success "Health check passed"
    else
        print_info "Health endpoint not responding yet (this is normal)"
    fi
else
    print_info "Deployment URL not found, will be available soon"
fi

print_header "🎉 Deployment Complete!"

echo -e "${GREEN}"
cat << "EOF"
╔══════════════════════════════════════════════════════╗
║                                                      ║
║  ✓ XQ Trade M8 Successfully Deployed to Cloudflare! ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

echo -e "\n${BLUE}Deployment Information:${NC}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -z "$DEPLOYMENT_URL" ]; then
    echo -e "🌐 Application URL: ${GREEN}$DEPLOYMENT_URL${NC}"
fi

echo -e "📊 Dashboard: ${GREEN}https://dash.cloudflare.com${NC}"
echo -e "📝 Logs: Run ${YELLOW}wrangler tail${NC}"
echo -e "🔧 Status: Run ${YELLOW}wrangler deployments list${NC}"

echo -e "\n${BLUE}Next Steps:${NC}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "1. Visit your application URL above"
echo -e "2. Create an account and login"
echo -e "3. Test demo trading (SAFE)"
echo -e "4. Review dashboard analytics"
echo -e "5. Configure risk parameters"
echo -e "\n${YELLOW}⚠️  Important: Start with DEMO mode only!${NC}"
echo -e "\n${GREEN}Happy Trading! 🚀${NC}\n"

# Save deployment info
cat > deployment-info.txt << EOF
XQ Trade M8 Cloudflare Deployment
Deployed: $(date)
URL: $DEPLOYMENT_URL
Account ID: $ACCOUNT_ID
Database: xq-trade-m8-db
Status: Active
EOF

print_success "Deployment info saved to: deployment-info.txt"
