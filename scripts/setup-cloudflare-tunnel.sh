#!/usr/bin/env bash
# =============================================================================
# XQ Trade M8 — Cloudflare Tunnel Setup Helper
#
# Prepares a managed Cloudflare Tunnel config for a self-hosted executor and,
# optionally, pushes EXECUTOR_URL / EXECUTOR_SECRET / paper-first flags to the
# Pages project and scheduled Worker.
#
# This script does not create the tunnel itself. Create a managed tunnel in the
# Cloudflare dashboard first, then run this helper with the final hostname.
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
info() { echo -e "${CYAN}  ▶ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; exit 1; }
hdr()  { echo -e "\n${BOLD}${BLUE}━━━  $1  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAGES_PROJECT_NAME="${PAGES_PROJECT_NAME:-trade-m8-live-app}"
WORKER_CONFIG="${WORKER_CONFIG:-$REPO_DIR/wrangler.worker.toml}"
HOSTNAME="${HOSTNAME:-}"
TUNNEL_ID="${TUNNEL_ID:-}"
TUNNEL_TOKEN="${TUNNEL_TOKEN:-}"
EXECUTOR_SECRET_VALUE="${EXECUTOR_SECRET:-}"
PORT="${PORT:-8000}"
WRITE_CONFIG=false
SET_CF_SECRETS=false

usage() {
  cat <<'EOF'
Usage:
  bash scripts/setup-cloudflare-tunnel.sh --hostname executor.trade-m8.app --write-config
  bash scripts/setup-cloudflare-tunnel.sh --hostname executor.trade-m8.app --set-cloudflare-secrets

Options:
  --hostname <host>               Public Cloudflare hostname for the executor
  --port <port>                   Local executor port behind cloudflared (default: 8000)
  --tunnel-id <uuid>              Optional. Used to fill the config template.
  --tunnel-token <token>          Optional. Used to print the install command.
  --write-config                  Write executor/cloudflare/cloudflared-config.yml
  --set-cloudflare-secrets        Push EXECUTOR_URL / EXECUTOR_SECRET / paper flags
  --pages-project <name>          Override Pages project name
  --worker-config <path>          Override worker wrangler config path

Environment:
  HOSTNAME, PORT, TUNNEL_ID, TUNNEL_TOKEN, EXECUTOR_SECRET, PAGES_PROJECT_NAME
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hostname) HOSTNAME="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --tunnel-id) TUNNEL_ID="$2"; shift ;;
    --tunnel-token) TUNNEL_TOKEN="$2"; shift ;;
    --write-config) WRITE_CONFIG=true ;;
    --set-cloudflare-secrets) SET_CF_SECRETS=true ;;
    --pages-project) PAGES_PROJECT_NAME="$2"; shift ;;
    --worker-config) WORKER_CONFIG="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown arg: $1" ;;
  esac
  shift
done

[[ -n "$HOSTNAME" ]] || fail "Hostname is required. Example: --hostname executor.trade-m8.app"

EXECUTOR_URL="https://${HOSTNAME}"
CONFIG_DIR="$REPO_DIR/executor/cloudflare"
CONFIG_PATH="$CONFIG_DIR/cloudflared-config.yml"

echo ""
echo -e "${BOLD}${BLUE}Cloudflare Tunnel Helper${NC}"
echo -e "${CYAN}  Repo: ${REPO_DIR}${NC}"
echo -e "${CYAN}  Hostname: ${HOSTNAME}${NC}"
echo -e "${CYAN}  Local service: http://127.0.0.1:${PORT}${NC}"
echo ""

if [ "$WRITE_CONFIG" = true ]; then
  hdr "WRITE CONFIG"
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_PATH" <<EOF
tunnel: ${TUNNEL_ID:-REPLACE_WITH_TUNNEL_ID}
credentials-file: /etc/cloudflared/${TUNNEL_ID:-REPLACE_WITH_TUNNEL_ID}.json

ingress:
  - hostname: ${HOSTNAME}
    service: http://127.0.0.1:${PORT}
    originRequest:
      noTLSVerify: true
  - service: http_status:404
EOF
  ok "Wrote ${CONFIG_PATH}"
fi

if [ "$SET_CF_SECRETS" = true ]; then
  hdr "SET CLOUDFLARE SECRETS"

  command -v npx >/dev/null 2>&1 || fail "npx not found"
  command -v wrangler >/dev/null 2>&1 || npm install -g wrangler >/dev/null 2>&1

  if [ -z "$EXECUTOR_SECRET_VALUE" ] && [ -f "$REPO_DIR/.env" ]; then
    # shellcheck disable=SC1091
    source "$REPO_DIR/.env" 2>/dev/null || true
    EXECUTOR_SECRET_VALUE="${EXECUTOR_SECRET:-}"
  fi

  [ -n "$EXECUTOR_SECRET_VALUE" ] || fail "EXECUTOR_SECRET is required to push Cloudflare secrets"

  info "Setting EXECUTOR_URL=${EXECUTOR_URL}"
  echo "$EXECUTOR_URL" | npx wrangler pages secret put EXECUTOR_URL --project-name="$PAGES_PROJECT_NAME"
  echo "$EXECUTOR_URL" | npx wrangler secret put EXECUTOR_URL --config "$WORKER_CONFIG"
  ok "EXECUTOR_URL set on Pages and Worker"

  info "Setting EXECUTOR_SECRET"
  echo "$EXECUTOR_SECRET_VALUE" | npx wrangler pages secret put EXECUTOR_SECRET --project-name="$PAGES_PROJECT_NAME"
  echo "$EXECUTOR_SECRET_VALUE" | npx wrangler secret put EXECUTOR_SECRET --config "$WORKER_CONFIG"
  ok "EXECUTOR_SECRET set on Pages and Worker"

  info "Reasserting paper-first flags"
  echo "true" | npx wrangler pages secret put PAPER_MODE --project-name="$PAGES_PROJECT_NAME"
  echo "true" | npx wrangler pages secret put ENABLE_PAPER_TRADING --project-name="$PAGES_PROJECT_NAME"
  echo "false" | npx wrangler pages secret put ENABLE_LIVE_TRADING --project-name="$PAGES_PROJECT_NAME"
  echo "true" | npx wrangler pages secret put DEMO_MODE --project-name="$PAGES_PROJECT_NAME"
  echo "true" | npx wrangler secret put PAPER_MODE --config "$WORKER_CONFIG"
  echo "true" | npx wrangler secret put ENABLE_PAPER_TRADING --config "$WORKER_CONFIG"
  echo "false" | npx wrangler secret put ENABLE_LIVE_TRADING --config "$WORKER_CONFIG"
  echo "true" | npx wrangler secret put DEMO_MODE --config "$WORKER_CONFIG"
  ok "Paper-first flags set on Pages and Worker"
fi

hdr "NEXT STEPS"
cat <<EOF
1. In Cloudflare dashboard, create a managed tunnel for ${HOSTNAME}.
2. On the executor host, install cloudflared and run:
   sudo cloudflared service install <TUNNEL_TOKEN>
3. Keep the FastAPI executor bound to localhost only:
   uvicorn executor.main:app --host 127.0.0.1 --port ${PORT}
4. Verify locally on the host:
   curl http://127.0.0.1:${PORT}/health
5. Verify through Cloudflare after DNS is live:
   curl ${EXECUTOR_URL}/health
6. Verify from Pages side:
   curl https://trade-m8.app/api/executor/health
EOF

if [ -n "$TUNNEL_TOKEN" ]; then
  echo ""
  info "Managed tunnel install command:"
  echo "  sudo cloudflared service install ${TUNNEL_TOKEN}"
fi
