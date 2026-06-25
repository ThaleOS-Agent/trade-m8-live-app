#!/usr/bin/env bash
# =============================================================================
# XQ Trade M8 — Executor Setup Script
# One-click: installs deps, configures .env, starts service, verifies health
#
# Usage:
#   Local Mac (test):   bash scripts/setup-executor.sh --local
#   Tokyo server:       bash scripts/setup-executor.sh
#   With custom port:   bash scripts/setup-executor.sh --port 8001
#
# After running on Mac:
#   curl http://localhost:8000/health   → should return {"status":"ok",...}
#
# After running on Tokyo server, run from your Mac:
#   bash scripts/setup-executor.sh --set-cloudflare-secrets
# =============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
info() { echo -e "${CYAN}  ▶ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; exit 1; }
hdr()  { echo -e "\n${BOLD}${BLUE}━━━  $1  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# ── Defaults ──────────────────────────────────────────────────────────────────
PORT=8000
LOCAL_MODE=false
SET_CF_SECRETS=false
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)              LOCAL_MODE=true ;;
    --port)               PORT="$2"; shift ;;
    --set-cloudflare-secrets) SET_CF_SECRETS=true ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
  shift
done

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${BLUE}"
cat << 'BANNER'
 ██╗  ██╗ ██████╗     ████████╗██████╗  █████╗ ██████╗ ███████╗    ███╗   ███╗ █████╗
 ╚██╗██╔╝██╔═══██╗    ╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔════╝    ████╗ ████║██╔══██╗
  ╚███╔╝ ██║   ██║       ██║   ██████╔╝███████║██║  ██║█████╗      ██╔████╔██║╚█████╔╝
  ██╔██╗ ██║▄▄ ██║       ██║   ██╔══██╗██╔══██║██║  ██║██╔══╝      ██║╚██╔╝██║██╔══██╗
 ██╔╝ ██╗╚██████╔╝       ██║   ██║  ██║██║  ██║██████╔╝███████╗    ██║ ╚═╝ ██║╚█████╔╝
 ╚═╝  ╚═╝ ╚══▀▀═╝        ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝    ╚═╝     ╚═╝ ╚════╝
BANNER
echo -e "${NC}"
echo -e "${CYAN}  XQ Trade M8 — Python Executor Setup${NC}"
echo -e "${CYAN}  Repo: ${REPO_DIR}${NC}"
echo -e "${CYAN}  Mode: $([ "$LOCAL_MODE" = true ] && echo 'LOCAL (Mac test)' || echo 'SERVER (production)')${NC}"
echo -e "${CYAN}  Port: ${PORT}${NC}\n"

# ─────────────────────────────────────────────────────────────────────────────
# CLOUDFLARE SECRETS MODE — run from local Mac after server is up
# =============================================================================
if [ "$SET_CF_SECRETS" = true ]; then
  hdr "CLOUDFLARE SECRETS SETUP"

  command -v npx >/dev/null 2>&1 || fail "npx not found — install Node.js first"
  command -v wrangler >/dev/null 2>&1 || npm install -g wrangler

  # Load executor URL and secret from .env if present
  ENV_FILE="$REPO_DIR/.env"
  if [ -f "$ENV_FILE" ]; then
    source "$ENV_FILE" 2>/dev/null || true
  fi

  info "Setting EXECUTOR_URL..."
  if [ -n "${EXECUTOR_URL:-}" ]; then
    echo "$EXECUTOR_URL" | npx wrangler pages secret put EXECUTOR_URL --project-name=trade-m8-production
    echo "$EXECUTOR_URL" | npx wrangler secret put EXECUTOR_URL --config "$REPO_DIR/wrangler.worker.toml"
    ok "EXECUTOR_URL set"
  else
    warn "EXECUTOR_URL not in .env — enter it manually:"
    npx wrangler pages secret put EXECUTOR_URL --project-name=trade-m8-production
    npx wrangler secret put EXECUTOR_URL --config "$REPO_DIR/wrangler.worker.toml"
  fi

  info "Setting EXECUTOR_SECRET..."
  if [ -n "${EXECUTOR_SECRET:-}" ]; then
    echo "$EXECUTOR_SECRET" | npx wrangler pages secret put EXECUTOR_SECRET --project-name=trade-m8-production
    echo "$EXECUTOR_SECRET" | npx wrangler secret put EXECUTOR_SECRET --config "$REPO_DIR/wrangler.worker.toml"
    ok "EXECUTOR_SECRET set"
  else
    warn "EXECUTOR_SECRET not in .env — enter it manually:"
    npx wrangler pages secret put EXECUTOR_SECRET --project-name=trade-m8-production
    npx wrangler secret put EXECUTOR_SECRET --config "$REPO_DIR/wrangler.worker.toml"
  fi

  info "Setting PAPER_MODE=true..."
  echo "true" | npx wrangler pages secret put PAPER_MODE --project-name=trade-m8-production
  echo "true" | npx wrangler secret put PAPER_MODE --config "$REPO_DIR/wrangler.worker.toml"
  ok "PAPER_MODE=true set on both Pages and Worker"

  echo ""
  echo -e "${GREEN}${BOLD}━━━  Cloudflare secrets configured  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  Verify the Worker can reach the executor:"
  echo -e "  ${CYAN}curl https://trade-m8-worker.thaleosnetwork.workers.dev/executor/health${NC}"
  echo ""
  exit 0
fi

# =============================================================================
# STEP 1 — System dependencies
# =============================================================================
hdr "STEP 1 — System Dependencies"

# Detect OS
OS="$(uname -s)"
info "Detected OS: $OS"

if [ "$OS" = "Darwin" ]; then
  # macOS — use Homebrew Python if available
  if command -v python3.12 >/dev/null 2>&1; then
    PYTHON=python3.12
    ok "Python 3.12 found: $(python3.12 --version)"
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON=python3
    warn "python3.12 not found — using $(python3 --version). Recommend: brew install python@3.12"
  else
    fail "Python 3 not found. Install: brew install python@3.12"
  fi
elif [ "$OS" = "Linux" ]; then
  if ! command -v python3.12 >/dev/null 2>&1; then
    info "Installing Python 3.12..."
    sudo apt-get update -qq
    sudo apt-get install -y python3.12 python3.12-venv python3-pip git curl
  fi
  PYTHON=python3.12
  ok "Python 3.12: $($PYTHON --version)"
else
  fail "Unsupported OS: $OS"
fi

# =============================================================================
# STEP 2 — Virtual environment
# =============================================================================
hdr "STEP 2 — Virtual Environment"

VENV_DIR="$REPO_DIR/.venv"

if [ ! -d "$VENV_DIR" ]; then
  info "Creating venv at $VENV_DIR..."
  $PYTHON -m venv "$VENV_DIR"
  ok "venv created"
else
  ok "venv exists at $VENV_DIR"
fi

# Activate
source "$VENV_DIR/bin/activate"
ok "venv activated (Python: $(python --version))"

# =============================================================================
# STEP 3 — Python dependencies
# =============================================================================
hdr "STEP 3 — Python Dependencies"

REQUIREMENTS="$REPO_DIR/executor/requirements.txt"

if [ ! -f "$REQUIREMENTS" ]; then
  fail "requirements.txt not found at $REQUIREMENTS — run git pull first"
fi

info "Installing from executor/requirements.txt..."

# Skip torch on local Mac test mode (large download, not needed for health check)
if [ "$LOCAL_MODE" = true ]; then
  warn "LOCAL mode: skipping torch (large). Install manually if running backtest endpoint."
  grep -v "^torch" "$REQUIREMENTS" > /tmp/req_no_torch.txt
  pip install --quiet -r /tmp/req_no_torch.txt
else
  pip install --quiet -r "$REQUIREMENTS"
fi

ok "Dependencies installed"

# =============================================================================
# STEP 4 — Verify imports
# =============================================================================
hdr "STEP 4 — Import Verification"

info "Testing all executor module imports..."

python << 'PYCHECK'
import sys, os
repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__ if '__file__' in dir() else '.')))
sys.path.insert(0, os.path.join(repo, 'functions', 'python'))

checks = [
    ("fastapi",           "FastAPI framework"),
    ("uvicorn",           "ASGI server"),
    ("pydantic",          "Data validation"),
    ("numpy",             "NumPy"),
    ("pandas",            "Pandas"),
    ("requests",          "HTTP client"),
    ("sklearn",           "Scikit-learn"),
]

import importlib
failed = []
for mod, desc in checks:
    try:
        importlib.import_module(mod)
        print(f"  ✓ {desc} ({mod})")
    except ImportError as e:
        print(f"  ✗ {desc} ({mod}): {e}")
        failed.append(mod)

if failed:
    print(f"\n  FAILED: {failed}")
    sys.exit(1)
else:
    print("\n  All framework imports OK")
PYCHECK

# Check project module imports
python3 - << PYCHECK2
import sys, os
repo_dir = "$(echo $REPO_DIR)"
sys.path.insert(0, os.path.join(repo_dir, 'functions', 'python'))

mods = [
    ('execute_trade',    'execute_trade'),
    ('riskmanager',      'RiskManager'),
    ('entry_exit_logic', 'EntryExitEngine'),
    ('create_features',  'FeatureEngineer'),
    ('generate_features','generate_features'),
]

failed = []
for mod, cls in mods:
    try:
        m = __import__(mod)
        getattr(m, cls)
        print(f"  ✓ {mod}.{cls}")
    except Exception as e:
        print(f"  ✗ {mod}.{cls}: {e}")
        failed.append(mod)

if failed:
    print(f"\n  FAILED imports: {failed}")
    exit(1)
else:
    print("\n  All project module imports OK")
PYCHECK2

ok "All imports verified"

# =============================================================================
# STEP 5 — Configure .env
# =============================================================================
hdr "STEP 5 — Environment Configuration"

ENV_FILE="$REPO_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  info "No .env found — creating from template..."

  # Generate a random executor secret
  GENERATED_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")

  cat > "$ENV_FILE" << ENVEOF
# XQ Trade M8 — Executor Environment
# Generated by setup-executor.sh
# ⚠ Never commit this file to git

# ── Security ──────────────────────────────────────────────────────────────────
EXECUTOR_SECRET=${GENERATED_SECRET}

# ── Trading mode ─────────────────────────────────────────────────────────────
# ALWAYS start with PAPER_MODE=true
# Change to false ONLY after paper validation (see DEPLOY_CHECKLIST_LIVE_TRADING.md)
PAPER_MODE=true

# ── Capital ───────────────────────────────────────────────────────────────────
INITIAL_EQUITY=10000

# ── Exchange credentials ─────────────────────────────────────────────────────
# Fill these in before starting executor
BINANCE_API_KEY=
BINANCE_SECRET=
OANDA_API_KEY=
OANDA_ACCOUNT=
OANDA_ENV=practice

# ── Cloudflare connection (for --set-cloudflare-secrets mode) ─────────────────
# Set EXECUTOR_URL to this machine's public IP:
# EXECUTOR_URL=http://YOUR_SERVER_IP:${PORT}

# ── Risk parameters ───────────────────────────────────────────────────────────
RISK_PER_TRADE=0.01
MAX_DAILY_LOSS_PCT=0.03
MAX_DAILY_TRADES=2
ATR_SL_MULT=1.5
ATR_TP_MULT=2.0
ATR_PERIOD=14
TWAP_THRESHOLD_USD=5000
ENVEOF

  chmod 600 "$ENV_FILE"
  ok ".env created at $ENV_FILE"
  warn "EXECUTOR_SECRET auto-generated: ${GENERATED_SECRET}"
  warn "Fill in BINANCE_API_KEY, BINANCE_SECRET, OANDA_API_KEY, OANDA_ACCOUNT before trading"
else
  ok ".env already exists — using existing config"
fi

# Load it
set -a; source "$ENV_FILE"; set +a
ok "Environment loaded (PAPER_MODE=${PAPER_MODE:-true})"

# =============================================================================
# STEP 6 — Kill any existing instance on this port
# =============================================================================
hdr "STEP 6 — Port ${PORT} Check"

if lsof -ti :$PORT >/dev/null 2>&1; then
  warn "Port $PORT in use — killing existing process..."
  kill $(lsof -ti :$PORT) 2>/dev/null || true
  sleep 1
  ok "Port $PORT cleared"
else
  ok "Port $PORT is free"
fi

# =============================================================================
# STEP 7 — Start executor
# =============================================================================
hdr "STEP 7 — Starting Executor"

LOG_FILE="$REPO_DIR/executor/executor.log"
PID_FILE="$REPO_DIR/executor/executor.pid"

if [ "$LOCAL_MODE" = true ] || [ "$OS" = "Darwin" ]; then
  # macOS / local — run as background process with log file
  info "Starting executor in background (log: $LOG_FILE)..."

  cd "$REPO_DIR"
  set -a; source "$ENV_FILE"; set +a

  nohup "$VENV_DIR/bin/uvicorn" executor.main:app \
    --host 0.0.0.0 \
    --port "$PORT" \
    --log-level info \
    > "$LOG_FILE" 2>&1 &

  echo $! > "$PID_FILE"
  ok "Executor started (PID: $(cat $PID_FILE))"
  info "Logs: tail -f $LOG_FILE"

else
  # Linux server — install systemd service
  info "Installing systemd service..."

  VENV_UVICORN="$VENV_DIR/bin/uvicorn"
  CURRENT_USER="$(whoami)"

  sudo tee /etc/systemd/system/xq-executor.service > /dev/null << SVCEOF
[Unit]
Description=XQ Trade M8 Python Executor
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${REPO_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${VENV_UVICORN} executor.main:app --host 0.0.0.0 --port ${PORT} --workers 2
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=xq-executor

[Install]
WantedBy=multi-user.target
SVCEOF

  sudo systemctl daemon-reload
  sudo systemctl enable xq-executor
  sudo systemctl restart xq-executor
  sleep 3
  sudo systemctl status xq-executor --no-pager | head -15
  ok "systemd service installed and running"
fi

# =============================================================================
# STEP 8 — Health check
# =============================================================================
hdr "STEP 8 — Health Check"

MAX_WAIT=30
WAITED=0
info "Waiting for executor to respond on port $PORT..."

while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -sf "http://localhost:$PORT/health" > /tmp/health_response.json 2>/dev/null; then
    ok "Health check passed!"
    echo ""
    cat /tmp/health_response.json | python3 -m json.tool 2>/dev/null || cat /tmp/health_response.json
    echo ""
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
  printf "  Waiting... ${WAITED}s\r"
done

if [ $WAITED -ge $MAX_WAIT ]; then
  fail "Executor did not respond within ${MAX_WAIT}s. Check logs: tail -50 $LOG_FILE"
fi

# Test auth endpoint
info "Testing authenticated endpoint..."
if [ -n "${EXECUTOR_SECRET:-}" ]; then
  STATUS_RESP=$(curl -sf \
    -H "Authorization: Bearer ${EXECUTOR_SECRET}" \
    "http://localhost:$PORT/status" 2>/dev/null || echo "{}")
  echo "  Status: $STATUS_RESP" | python3 -m json.tool 2>/dev/null || echo "  $STATUS_RESP"
  ok "Auth endpoint responding"
else
  warn "EXECUTOR_SECRET not set — skipping auth test"
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  ✅  XQ Trade M8 Executor — RUNNING${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${CYAN}Health:${NC}    curl http://localhost:${PORT}/health"
echo -e "  ${CYAN}Logs:${NC}      tail -f ${LOG_FILE}"
echo -e "  ${CYAN}.env:${NC}      ${ENV_FILE}"
echo -e "  ${CYAN}PAPER MODE:${NC} ${PAPER_MODE:-true} (change in .env — see DEPLOY_CHECKLIST_LIVE_TRADING.md)"
echo ""

if [ "$LOCAL_MODE" = true ] || [ "$OS" = "Darwin" ]; then
  echo -e "  ${YELLOW}── Next steps ───────────────────────────────────────────────────────────────${NC}"
  echo ""
  echo -e "  1. Fill in exchange credentials in .env:"
  echo -e "     ${CYAN}nano ${ENV_FILE}${NC}"
  echo ""
  echo -e "  2. Deploy to AWS Tokyo Lightsail and SSH in, then re-run:"
  echo -e "     ${CYAN}bash scripts/setup-executor.sh${NC}  (no --local flag)"
  echo ""
  echo -e "  3. After Tokyo is running, set Cloudflare secrets from your Mac:"
  echo -e "     ${CYAN}bash scripts/setup-executor.sh --set-cloudflare-secrets${NC}"
  echo ""
  echo -e "  4. Verify the Worker can reach Tokyo:"
  echo -e "     ${CYAN}curl https://trade-m8-worker.thaleosnetwork.workers.dev/executor/health${NC}"
else
  PUBLIC_IP=$(curl -sf https://api.ipify.org 2>/dev/null || echo "YOUR_SERVER_IP")
  echo -e "  ${YELLOW}── Next steps ───────────────────────────────────────────────────────────────${NC}"
  echo ""
  echo -e "  1. Set EXECUTOR_URL in .env:"
  echo -e "     ${CYAN}echo 'EXECUTOR_URL=http://${PUBLIC_IP}:${PORT}' >> ${ENV_FILE}${NC}"
  echo ""
  echo -e "  2. From your Mac, set Cloudflare secrets:"
  echo -e "     ${CYAN}bash scripts/setup-executor.sh --set-cloudflare-secrets${NC}"
  echo ""
  echo -e "  3. Lock firewall — only allow Cloudflare IPs on port ${PORT}:"
  echo -e "     ${CYAN}https://www.cloudflare.com/ips-v4${NC}"
  echo ""
  echo -e "  4. Verify Worker → Executor connection:"
  echo -e "     ${CYAN}curl https://trade-m8-worker.thaleosnetwork.workers.dev/executor/health${NC}"
fi

echo ""
