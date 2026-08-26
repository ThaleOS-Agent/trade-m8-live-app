# Cloudflare Tunnel Executor Deployment

This is the production path for the Python executor when Railway is unavailable.

## Why this path

- Keeps the executor off the public internet except through Cloudflare.
- Avoids Railway billing.
- Preserves the existing `EXECUTOR_URL` and `EXECUTOR_SECRET` runtime model.
- Keeps paper trading as the enforced default.

Do not use Cloudflare Quick Tunnels for production. Cloudflare documents Quick Tunnels as development-only and notes they do not provide production SLA. Use a managed Cloudflare Tunnel instead.

## Target shape

```text
Cloudflare Pages / Worker
        |
        | HTTPS
        v
executor.trade-m8.app
        |
        | managed Cloudflare Tunnel
        v
cloudflared on executor host
        |
        | localhost only
        v
FastAPI executor on 127.0.0.1:8000
```

## Prerequisites

- Cloudflare account
- Domain managed in Cloudflare DNS
- A machine you control for the executor
- `cloudflared` installed on that machine
- `EXECUTOR_SECRET` generated locally

## 1. Start the executor locally on the host

Keep the executor bound to loopback:

```bash
source .venv/bin/activate
source .env
uvicorn executor.main:app --host 127.0.0.1 --port 8000
```

Verify:

```bash
curl http://127.0.0.1:8000/health
```

## 2. Create a managed Cloudflare Tunnel

In Cloudflare dashboard:

1. Go to `Networking > Tunnels`
2. Create a tunnel
3. Name it for the executor
4. Add a published application route:
   - Hostname: `executor.trade-m8.app`
   - Service URL: `http://127.0.0.1:8000`

Cloudflare’s production tunnel flow requires a Cloudflare account, a domain on Cloudflare, and a machine where `cloudflared` runs.

## 3. Install the tunnel on the executor host

After Cloudflare issues the tunnel token:

```bash
sudo cloudflared service install <TUNNEL_TOKEN>
```

The repo includes a reusable example config at:

- [executor/cloudflare/cloudflared-config.example.yml](/Users/gee/Documents/03_Dev_Projects/trade-m8-live/executor/cloudflare/cloudflared-config.example.yml)

You can also generate a host-specific config with:

```bash
bash scripts/setup-cloudflare-tunnel.sh \
  --hostname executor.trade-m8.app \
  --write-config
```

## 4. Push Cloudflare runtime secrets

Once `executor.trade-m8.app` resolves and the tunnel is healthy:

```bash
export EXECUTOR_SECRET="$(openssl rand -hex 32)"

bash scripts/setup-cloudflare-tunnel.sh \
  --hostname executor.trade-m8.app \
  --set-cloudflare-secrets
```

That script sets:

- `EXECUTOR_URL=https://executor.trade-m8.app`
- `EXECUTOR_SECRET=<same value on Pages and Worker>`
- `PAPER_MODE=true`
- `ENABLE_PAPER_TRADING=true`
- `ENABLE_LIVE_TRADING=false`
- `DEMO_MODE=true`

## 5. Verify the full chain

From the executor host:

```bash
curl http://127.0.0.1:8000/health
```

Through the tunnel:

```bash
curl https://executor.trade-m8.app/health
```

From the deployed Pages app:

```bash
curl https://trade-m8.app/api/executor/health
curl https://trade-m8.app/api/runtime-config
```

Expected state while paper-first is enforced:

- `executor_reachable: true`
- `executor_url: "configured"`
- `paper_mode: true`
- `enable_live_trading: false`
- `demo_mode: true`

## 6. Safety rules

- Bind the executor to `127.0.0.1`, not `0.0.0.0`
- Use only a managed tunnel for production
- Keep live trading disabled until paper mode has consistent fills and PnL
- Never put exchange credentials in frontend storage
- Rotate `EXECUTOR_SECRET` by updating Pages and Worker secrets together

## References

- Cloudflare Tunnel setup: https://developers.cloudflare.com/tunnel/setup/
- Cloudflare Quick Tunnels limitations: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
