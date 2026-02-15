#!/bin/bash

# GitHub Upload Script (No Git Required)
# Uses GitHub API to create repository and upload files

set -e

echo "🚀 XQ Trade M8 - GitHub Upload via API"
echo "======================================="
echo ""

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) not found."
    echo "Install it: brew install gh"
    exit 1
fi

echo "✓ GitHub CLI available"
echo ""

# Check authentication
if ! gh auth status &> /dev/null; then
    echo "🔐 Please authenticate with GitHub..."
    gh auth login
fi

echo "✓ Authenticated with GitHub"
echo ""

# Get username
USERNAME=$(gh api user -q .login)
echo "👤 GitHub user: $USERNAME"
echo ""

# Repository details
REPO_NAME="xq-trade-m8-cloudflare"
REPO_DESC="XQ Trade M8 - AI-Powered Trading Platform with CoinGecko Integration (Cloudflare Pages + D1)"

# Check if repository exists
if gh repo view "$USERNAME/$REPO_NAME" &> /dev/null; then
    echo "⚠️  Repository $REPO_NAME already exists!"
    read -p "Delete and recreate? (y/n): " confirm
    if [[ $confirm == "y" || $confirm == "Y" ]]; then
        gh repo delete "$USERNAME/$REPO_NAME" --yes
        echo "✓ Deleted existing repository"
    else
        echo "❌ Aborted"
        exit 1
    fi
fi

echo "📦 Creating repository..."

# Create repository via API
gh repo create "$REPO_NAME" \
    --private \
    --description "$REPO_DESC" \
    --confirm

echo "✓ Repository created: https://github.com/$USERNAME/$REPO_NAME"
echo ""

echo "📝 Creating README.md on GitHub..."
gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "/repos/$USERNAME/$REPO_NAME/contents/README.md" \
    -f message="Add README" \
    -f content="$(base64 < README.md)" \
    > /dev/null

echo "✓ README.md uploaded"

echo ""
echo "📋 Next steps:"
echo "   1. Upload remaining files via GitHub web interface"
echo "   2. Or use GitHub Desktop to sync the folder"
echo "   3. Or install git via: brew install git"
echo ""
echo "Repository URL: https://github.com/$USERNAME/$REPO_NAME"
echo ""

# Open repository in browser
echo "🌐 Opening repository in browser..."
gh repo view --web

echo ""
echo "✅ Repository created successfully!"
echo ""
echo "To upload all files, you can:"
echo "  1. Use GitHub Desktop (recommended)"
echo "  2. Drag & drop files to: https://github.com/$USERNAME/$REPO_NAME/upload/main"
echo "  3. Install git and run: ./git-setup.sh"
