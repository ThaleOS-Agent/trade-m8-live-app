# XQ Trade M8 — Python Executor Deployment Guide

## What this is

The executor is a FastAPI service running on **AWS Tokyo (ap-northeast-1)**
that provides Python execution capabilities to the Cloudflare Worker.

```
Cloudflare Worker (cron every minute)
    ↓  POST /risk/evaluate
    ↓  POST /execute
Python Executor (AWS Tokyo)
    ↓  execute_trade.py  →  Binance ap-northeast-1 (~12ms)
    ↓  riskmanager.py   →  True Range ATR, daily gates
    ↓  entry_exit_logic.py
```

---

## Prerequisites

- AWS account with EC2 or Lightsail access in `ap-northeast-1`
- Python 3.12+
- `EXECUTOR_SECRET` — generate a random 32-char string

---

## Step 1 — Provision the server

### Option A: AWS Lightsail (recommended — $3.50/month, 512MB RAM)
```bash
# In AWS Console → Lightsail → Create instance
# Region: ap-northeast-1 (Tokyo)
# Blueprint: OS Only → Ubuntu 24.04
# Plan: $3.50/month (512MB RAM, 20GB SSD)
# Instance name: xq-trade-m8-executor
```

### Option B: EC2 t3.micro (free tier eligible)
```bash
aws ec2 run-instances \
  --image-id ami-0d52744d6551d851e \
  --instance-type t3.micro \
  --region ap-northeast-1 \
  --key-name your-key-pair \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=xq-executor}]'
```

---

## Step 2 — Install dependencies

```bash
ssh ubuntu@<your-executor-ip>

# Install Python 3.12
sudo apt update && sudo apt install -y python3.12 python3.12-venv python3-pip git

# Clone the repo
git clone https://github.com/ThaleOS-Agent/trade-m8-live-app.git
cd trade-m8-live-app

# Create venv
python3.12 -m venv .venv
source .venv/bin/activate

# Install executor deps
pip install -r executor/requirements.txt
```

---

## Step 3 — Configure environment

```bash
cat > .env << 'EOF'
# ── Security ──────────────────────────────────────────────────────────────────
EXECUTOR_SECRET=<generate: openssl rand -hex 32>

# ── Trading mode ──────────────────────────────────────────────────────────────
# START WITH PAPER MODE. Change to false only after confirming connections.
PAPER_MODE=true

# ── Capital ───────────────────────────────────────────────────────────────────
INITIAL_EQUITY=10000

# ── Exchange credentials ───────────────────────────────────────────────────────
BINANCE_API_KEY=
BINANCE_SECRET=
OANDA_API_KEY=
OANDA_ACCOUNT=
OANDA_ENV=practice       # practice | live

# ── Risk parameters ───────────────────────────────────────────────────────────
RISK_PER_TRADE=0.01      # 1% NAV per trade
MAX_DAILY_LOSS_PCT=0.03  # 3% daily loss gate
MAX_DAILY_TRADES=2
ATR_SL_MULT=1.5
ATR_TP_MULT=2.0
TWAP_THRESHOLD_USD=5000

# ── ATR ───────────────────────────────────────────────────────────────────────
ATR_PERIOD=14
EOF

chmod 600 .env
```

---

## Step 4 — Run the feature pipeline (once)

```bash
source .venv/bin/activate
source .env

# Runs analyze_features → generates optimal_feature_set.csv
# Takes ~5 minutes on first run
python3 executor/run_feature_pipeline.py
```

---

## Step 5 — Start the executor

```bash
# Test start
source .venv/bin/activate
source .env
uvicorn executor.main:app --host 0.0.0.0 --port 8000

# Confirm health
curl http://localhost:8000/health
```

### Production: systemd service

```bash
sudo tee /etc/systemd/system/xq-executor.service << 'EOF'
[Unit]
Description=XQ Trade M8 Python Executor
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/trade-m8-live-app
EnvironmentFile=/home/ubuntu/trade-m8-live-app/.env
ExecStart=/home/ubuntu/trade-m8-live-app/.venv/bin/uvicorn executor.main:app --host 0.0.0.0 --port 8000 --workers 2
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable xq-executor
sudo systemctl start xq-executor
sudo systemctl status xq-executor
```

---

## Step 6 — Set secrets in Cloudflare

```bash
# Run these from your local machine (not the server)
# These connect the Cloudflare Worker to the executor

npx wrangler pages secret put EXECUTOR_URL
# → Enter: http://<your-executor-ip>:8000
# → Or use a domain if you have one configured

npx wrangler pages secret put EXECUTOR_SECRET
# → Enter: same value as EXECUTOR_SECRET in .env

npx wrangler pages secret put PAPER_MODE
# → Enter: true
```

### Also set the Worker secrets:
```bash
npx wrangler secret put EXECUTOR_URL     --config wrangler.worker.toml
npx wrangler secret put EXECUTOR_SECRET  --config wrangler.worker.toml
npx wrangler secret put PAPER_MODE       --config wrangler.worker.toml
```

---

## Step 7 — Verify the connection

```bash
# From your local machine — calls Worker → Executor chain
curl https://trade-m8.app/api/executor/health

# Expected response:
# {
#   "executor_reachable": true,
#   "executor_url": "configured",
#   "paper_mode": true,
#   "timestamp": "..."
# }
```

---

## Step 8 — Enable live trading

Only after paper mode confirms correct fills for at least 1 week:

```bash
# On the executor server
sed -i 's/PAPER_MODE=true/PAPER_MODE=false/' .env
sudo systemctl restart xq-executor

# In Cloudflare
npx wrangler pages secret put PAPER_MODE
# → Enter: false
npx wrangler secret put PAPER_MODE --config wrangler.worker.toml
# → Enter: false

# Verify gate is open
curl https://trade-m8.app/api/executor/health
# "paper_mode": false  ← confirms live mode active
```

---

## Security notes

- The executor must NOT be publicly accessible — use a firewall rule allowing
  only Cloudflare Worker egress IPs or a private VPC tunnel
- Cloudflare publishes its egress IP list at: https://www.cloudflare.com/ips/
- Add those CIDRs to the AWS Security Group inbound rules for port 8000
- The `EXECUTOR_SECRET` rotates via `npx wrangler secret put` (no downtime)
- API credentials are read at request time from environment — not cached

---

## Monitoring

```bash
# Executor logs
sudo journalctl -u xq-executor -f

# Resource usage
htop

# Executor status
curl -H "Authorization: Bearer $EXECUTOR_SECRET" \
  http://localhost:8000/status
```
