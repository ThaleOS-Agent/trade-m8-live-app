# Deploy Checklist — XQ Trade M8
# PAPER_MODE=false (Live Trading Activation)
# Date: _____________  Operator: ThaleOS-Agent
# ─────────────────────────────────────────────────────────────────────────────
#
# This checklist is the formal gate between paper trading and live order
# execution with real capital. Every item must be ticked before PAPER_MODE
# is changed. Items marked [BLOCKER] will cause silent failures or real
# financial loss if skipped.
#
# Status key:
#   [ ] = not done
#   [x] = complete
#   [N/A] = not applicable to this deployment
# ─────────────────────────────────────────────────────────────────────────────


## PHASE 0 — P0 FIXES (These block everything. Must be done first.)

### 0.1  Webhook Secret  [BLOCKER]
# REAL_SYSTEM_STATUS.md: 6/9 signals rejected — "Invalid webhook secret"
# Without this, zero trades will ever execute.

- [ ] Retrieve the current TRADINGVIEW_WEBHOOK_SECRET from Cloudflare
      wrangler pages secret list --project-name=trade-m8-production

- [ ] Update ALL TradingView alerts to use the correct secret:
      URL:     https://trade-m8.app/api/tradingview/webhook
      Format:  { "action": "buy", "symbol": "BTCUSDT", "exchange": "BINANCE",
                 "price": {{close}}, "quantity": 0.001,
                 "secret": "<EXACT SECRET FROM CLOUDFLARE>" }

- [ ] Send a test signal and confirm HTTP 200 + success:true in DB
      curl -X POST https://trade-m8.app/api/tradingview/webhook \
        -H "Content-Type: application/json" \
        -d '{"action":"buy","symbol":"BTCUSDT","exchange":"BINANCE",
             "price":67420,"quantity":0.001,"secret":"<YOUR_SECRET>"}'

- [ ] Confirm signal appears in D1 with status='received' (not 'rejected'):
      wrangler d1 execute xq-trade-m8-db --remote \
        --command="SELECT action,symbol,status,received_at
                   FROM tradingview_signals ORDER BY received_at DESC LIMIT 3"

### 0.2  OANDA Account ID  [BLOCKER]
# REAL_SYSTEM_STATUS.md: 1 signal failed — "Invalid value for accountID"
# XAU/USD (gold) will never execute without this.

- [ ] Set OANDA_ACCOUNT_ID in Cloudflare Pages:
      wrangler pages secret put OANDA_ACCOUNT_ID
      # Enter: your OANDA account ID (format: 001-001-XXXXXXX-001)

- [ ] Verify OANDA connection (practice):
      curl -H "Authorization: Bearer $OANDA_API_KEY" \
        "https://api-fxpractice.oanda.com/v3/accounts/$OANDA_ACCOUNT_ID/summary" \
        | python3 -c "import sys,json; d=json.load(sys.stdin)
                      print('balance:', d['account']['balance'])"

- [ ] Repeat for wrangler.worker.toml Worker binding:
      wrangler secret put OANDA_ACCOUNT_ID --config wrangler.worker.toml


## PHASE 1 — EXECUTOR DEPLOYMENT (Python engine on AWS Tokyo)

### 1.1  Server provisioned

- [ ] AWS Lightsail instance running in ap-northeast-1 (Tokyo)
      Region check: curl http://169.254.169.254/latest/meta-data/placement/region
      Expected: ap-northeast-1

- [ ] Python 3.12 installed:
      python3.12 --version

- [ ] Repo cloned to /home/ubuntu/trade-m8-live-app:
      ls /home/ubuntu/trade-m8-live-app/executor/main.py

- [ ] Dependencies installed:
      source .venv/bin/activate && pip list | grep fastapi

### 1.2  Executor .env configured

- [ ] EXECUTOR_SECRET set to a random 32-char hex string:
      openssl rand -hex 32
      # Record it — you will need it for Cloudflare secrets

- [ ] PAPER_MODE=true in .env (confirmed — do not touch until Phase 4):
      grep PAPER_MODE /home/ubuntu/trade-m8-live-app/.env
      # Must output: PAPER_MODE=true

- [ ] BINANCE_API_KEY and BINANCE_SECRET set (practice keys first):
      grep BINANCE_API_KEY .env | wc -c
      # Must be > 20 chars

- [ ] OANDA_API_KEY and OANDA_ACCOUNT set:
      grep OANDA_API_KEY .env | wc -c

- [ ] INITIAL_EQUITY set to actual starting capital in USD:
      grep INITIAL_EQUITY .env

- [ ] .env permissions restricted (not world-readable):
      ls -la .env
      # Must show: -rw------- (600)

### 1.3  Executor running and healthy

- [ ] systemd service enabled and running:
      sudo systemctl status xq-executor | grep Active
      # Expected: Active: active (running)

- [ ] Local health check passes:
      curl http://localhost:8000/health
      # Expected: {"status":"ok","paper_mode":true,...}

- [ ] Status endpoint returns correct equity:
      curl -H "Authorization: Bearer $EXECUTOR_SECRET" \
        http://localhost:8000/status
      # Verify equity matches INITIAL_EQUITY

### 1.4  Cloudflare Worker connected to executor  [BLOCKER]

- [ ] EXECUTOR_URL secret set in Cloudflare Pages:
      wrangler pages secret put EXECUTOR_URL
      # Enter: http://<tokyo-ip>:8000

- [ ] EXECUTOR_SECRET secret set:
      wrangler pages secret put EXECUTOR_SECRET
      # Enter: same value as on executor server

- [ ] PAPER_MODE=true set:
      wrangler pages secret put PAPER_MODE
      # Enter: true

- [ ] Same three secrets set on Worker:
      wrangler secret put EXECUTOR_URL     --config wrangler.worker.toml
      wrangler secret put EXECUTOR_SECRET  --config wrangler.worker.toml
      wrangler secret put PAPER_MODE       --config wrangler.worker.toml

- [ ] Worker can reach executor (confirms network path):
      curl https://trade-m8-worker.thaleosnetwork.workers.dev/executor/health
      # Expected: {"executor_reachable":true,"paper_mode":true,...}

- [ ] Firewall allows only Cloudflare egress IPs on port 8000:
      # AWS Security Group inbound rule:
      # Source: Cloudflare IP ranges from https://www.cloudflare.com/ips/
      # Port:   8000
      # Protocol: TCP
      # Verify no 0.0.0.0/0 rule on port 8000


## PHASE 2 — CI/CD VERIFIED

### 2.1  GitHub Actions

- [ ] Latest commit triggered a successful deploy (not PR-triggered):
      https://github.com/ThaleOS-Agent/trade-m8-live-app/actions
      # Last run: green, triggered by push to main

- [ ] Worker deploy step ran in the same workflow run:
      In the Actions log, confirm "Deploy Scheduled Worker" step is green

- [ ] Health check step passed HTTP 200:
      In the Actions log, confirm "Health check — Pages API" shows 200

- [ ] No PRs have deployed to production accidentally:
      Check actions runs — trigger column must all show "push" not "pull_request"

### 2.2  Rollback tested

- [ ] Rollback command documented and tested against staging:
      git revert HEAD && git push origin main
      # Confirm this deploys cleanly

- [ ] Previous known-good commit SHA recorded:
      git log --oneline -5 > /home/ubuntu/trade-m8-live-app/ROLLBACK_COMMITS.txt
      cat ROLLBACK_COMMITS.txt


## PHASE 3 — PAPER TRADING VALIDATION (Minimum 7 days)

### 3.1  Paper trade execution confirmed

- [ ] At least one paper BUY trade appears in D1 with status='paper':
      wrangler d1 execute xq-trade-m8-db --remote \
        --command="SELECT id,symbol,side,quantity,entry_price,status,opened_at
                   FROM trades WHERE status='paper' ORDER BY opened_at DESC LIMIT 5"

- [ ] Worker log confirms [PY-EXEC] routing (not [TS-EXEC] fallback):
      wrangler tail trade-m8-worker --format=pretty | grep "PY-EXEC"
      # If only [TS-EXEC] appears, executor routing is not working — stop here

- [ ] Paper trades are closing correctly with P&L recorded:
      wrangler d1 execute xq-trade-m8-db --remote \
        --command="SELECT symbol,side,entry_price,exit_price,
                   (exit_price-entry_price)*quantity as pnl, status
                   FROM trades WHERE status='closed' ORDER BY closed_at DESC LIMIT 10"

### 3.2  Risk gates confirmed active

- [ ] Daily loss gate fires correctly:
      Inject a trade that would breach the 3% NAV gate and confirm rejection
      in executor logs: grep "Daily loss gate" /var/log/xq-executor.log

- [ ] Daily trade count gate fires after 2nd trade:
      Confirm 3rd trade attempt in same day is rejected:
      grep "Daily trade limit" /var/log/xq-executor.log

- [ ] Confidence floor rejects low-confidence signals:
      grep "Confidence" /var/log/xq-executor.log | grep "below floor"

### 3.3  Performance baseline established

- [ ] Minimum 50 paper trades completed (not just signalled):
      wrangler d1 execute xq-trade-m8-db --remote \
        --command="SELECT COUNT(*) FROM trades WHERE status IN ('paper','closed')"
      # Must be >= 50

- [ ] Win rate is above 45% on paper trades:
      wrangler d1 execute xq-trade-m8-db --remote \
        --command="SELECT
                     COUNT(*) total,
                     SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) wins,
                     ROUND(SUM(CASE WHEN pnl > 0 THEN 1.0 ELSE 0 END)/COUNT(*)*100,1) win_rate
                   FROM trades
                   WHERE status='closed' AND pnl IS NOT NULL"
      # Win rate below 45% = do not proceed to live trading

- [ ] Max drawdown on paper equity curve does not exceed 8%:
      Review equity curve in dashboard or calculate from trade log

- [ ] No runaway trades (single position open for > 24h unexpectedly):
      wrangler d1 execute xq-trade-m8-db --remote \
        --command="SELECT symbol,side,entry_price,opened_at,
                   ROUND((julianday('now')-julianday(opened_at))*24,1) as hours_open
                   FROM trades WHERE status IN ('paper','open')
                   ORDER BY hours_open DESC LIMIT 5"

### 3.4  Exchange connectivity verified

- [ ] Binance connection confirmed (paper fills with real market price):
      Check fill_price in D1 trades matches Binance current price ±0.5%

- [ ] OANDA connection confirmed (XAU/USD paper fills executing):
      wrangler d1 execute xq-trade-m8-db --remote \
        --command="SELECT * FROM trades WHERE symbol LIKE '%XAU%' LIMIT 3"

- [ ] OANDA practice account balance matches expected after paper trades:
      curl -H "Authorization: Bearer $OANDA_API_KEY" \
        "https://api-fxpractice.oanda.com/v3/accounts/$OANDA_ACCOUNT_ID/summary" \
        | python3 -c "import sys,json; d=json.load(sys.stdin)
                      print('NAV:', d['account']['NAV'])"


## PHASE 4 — LIVE TRADING ACTIVATION (After all above complete)

### 4.1  Final pre-live checks

- [ ] All Phase 0–3 items ticked
- [ ] Current capital in Binance account confirmed:
      Check Binance wallet — record exact balance here: $_________

- [ ] Current capital in OANDA live account confirmed:
      Check OANDA account — record exact balance here: $_________

- [ ] Risk parameters set correctly for live account size:
      RISK_PER_TRADE=0.01    (1% NAV — do NOT increase for first 30 days)
      MAX_DAILY_LOSS_PCT=0.03 (3% NAV hard stop)
      MAX_DAILY_TRADES=2      (maximum 2 trades per day per bot)

- [ ] Rollback plan confirmed: git revert to last paper-mode commit SHA:
      SHA: _________________________

- [ ] Notification channel confirmed (email / Discord / Slack):
      Test notification received: [ ]

- [ ] Exchange API keys rotated to production (not testnet):
      Binance: [ ] API key starts with a real key (not testnet format)
      OANDA:   [ ] ENV set to "live" (not "practice")

### 4.2  Enable live trading on executor

- [ ] Edit executor .env:
      sed -i 's/PAPER_MODE=true/PAPER_MODE=false/' \
        /home/ubuntu/trade-m8-live-app/.env

- [ ] Restart executor:
      sudo systemctl restart xq-executor
      sudo systemctl status xq-executor | grep Active

- [ ] Confirm executor confirms paper_mode=false:
      curl http://localhost:8000/health
      # Expected: {"paper_mode":false,...}

### 4.3  Enable live trading in Cloudflare

- [ ] Update Pages secret:
      echo "false" | wrangler pages secret put PAPER_MODE

- [ ] Update Worker secret:
      echo "false" | wrangler secret put PAPER_MODE \
        --config wrangler.worker.toml

- [ ] Confirm live gate open via public endpoint:
      curl https://trade-m8.app/api/executor/health
      # MUST SHOW: "paper_mode": false
      # If "paper_mode": true appears — STOP. Do not proceed.

### 4.4  First live trade

- [ ] Send a low-value test signal (minimum position):
      curl -X POST https://trade-m8.app/api/tradingview/webhook \
        -H "Content-Type: application/json" \
        -d '{"action":"buy","symbol":"BTCUSDT","exchange":"BINANCE",
             "price":0,"quantity":0.001,"secret":"<YOUR_SECRET>"}'

- [ ] Confirm trade appears in Binance order history (not just D1)

- [ ] Confirm D1 trade status='open' (not 'paper'):
      wrangler d1 execute xq-trade-m8-db --remote \
        --command="SELECT id,symbol,status,entry_price,opened_at
                   FROM trades ORDER BY opened_at DESC LIMIT 1"
      # status must be 'open', NOT 'paper'

- [ ] Confirm Worker log shows [LIVE] not [PAPER]:
      wrangler tail trade-m8-worker --format=pretty | grep -E "LIVE|PAPER"
      # Must show [LIVE] — if [PAPER] appears, the gate is not open

- [ ] First trade notification received (email/Discord):
      Check configured notification channel


## PHASE 5 — POST-LIVE MONITORING (First 7 days)

### 5.1  Daily checks (first 7 days)

- [ ] Day 1: Verify 0 runaway positions, all SL/TP set correctly
- [ ] Day 2: Confirm daily loss gate has not fired unexpectedly
- [ ] Day 3: Review fill prices vs expected (slippage < 0.1%)
- [ ] Day 5: Win rate on first 10 live trades ≥ 40%
- [ ] Day 7: Full review — continue, pause, or roll back

### 5.2  Rollback triggers (act immediately if any are true)

- [ ] TRIGGER: Single-day loss exceeds 3% NAV
      Action: sudo systemctl stop xq-executor
              wrangler pages secret put PAPER_MODE  # enter: true

- [ ] TRIGGER: Executor unreachable for > 5 minutes with positions open
      Action: Manually close positions on exchange
              Check executor with: sudo systemctl status xq-executor

- [ ] TRIGGER: Duplicate orders detected (same symbol, same second)
      Action: Stop executor immediately, audit orders in D1

- [ ] TRIGGER: OANDA or Binance API key returns 401
      Action: Rotate API keys immediately, restart executor

- [ ] TRIGGER: Unexpected position size (> 2× expected units)
      Action: Stop executor, audit riskmanager.py ATR calculation


## SIGN-OFF

Pre-live review completed by: ___________________________
Date: ___________________________
Starting capital (Binance): $___________________________
Starting capital (OANDA):   $___________________________
Git commit at go-live:       ___________________________

⚠  NZ Financial Markets Conduct Act 2013 reminder:
   Performance claims in any user-facing surface must carry provenance
   labels. Live win-rate figures replace all BACKTEST_SYNTHETIC labels
   after 30 days of verified live trades.
