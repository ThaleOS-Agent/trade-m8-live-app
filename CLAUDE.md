# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server on port 3000 (proxies /api → localhost:8787)
npm run build        # Production build → dist/
npm run lint         # ESLint on src/
npm run format       # Prettier on src/
npm run test         # Vitest
npm run deploy       # Deploy Pages (dist/) to Cloudflare — build first
npm run deploy:worker  # Deploy scheduled Worker separately (wrangler.worker.toml)
npm run deploy:all   # build + deploy Pages + deploy Worker in one step
npx wrangler pages dev dist  # Run Pages Functions locally (requires wrangler login)
npx tsx scripts/run-backtest.ts  # Run backtests against historical data
```

Secrets are set per-resource:
```bash
wrangler pages secret put JWT_SECRET          # Pages project secrets
wrangler secret put JWT_SECRET --config wrangler.worker.toml  # Worker secrets (same set needed)
```

## Architecture

### Two separate Cloudflare deployments

**Pages project** (`wrangler.toml`, project: `trade-m8-live-app`):
- Serves the React SPA from `dist/`
- `functions/_middleware.ts` is the central request handler — it intercepts every request, runs DB migrations, handles CORS, does auth, and routes `/api/*` calls. Specialized routes (`/api/algo-trading`, `/api/live-trading`, `/api/prices`, etc.) call `next()` to fall through to their dedicated Pages Functions files in `functions/api/`.
- Direct `/api/*` endpoints handled in `_middleware.ts`: auth, bots, trades, portfolio, market, analytics, market-analysis, trading-signals, opportunities.

**Scheduled Worker** (`wrangler.worker.toml`, name: `trade-m8-worker`, entry: `functions/workers/index.ts`):
- **Not deployed by CI** — must be deployed manually with `npm run deploy:worker`.
- Cron `*/5 * * * *`: fetches CoinGecko prices, writes to D1 + KV cache.
- Cron `* * * * *`: queries all `status='running'` bots and runs their algo cycles via `functions/lib/algo-trading-engine.ts`.
- Houses two **Durable Objects**: `TradingEngine` (per-user stateful session) and `MarketDataStore` (live price cache with SQLite).

**r2-worker** (`r2-worker/`): standalone Worker for R2 bucket operations, deployed independently with its own `wrangler.jsonc`.

### Cloudflare bindings shared by Pages + Worker

| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 | Primary database (`xq-trade-m8-db`) |
| `CACHE` | KV | Market data & analysis cache (5–10 min TTL) |
| `SESSIONS` | KV | JWT session tokens (24h TTL) |
| `TRADES` | KV | Fast trade lookups |
| `STORAGE` | R2 | `trade-m8-assets` bucket |
| `TRADING_ENGINE` | DO | Per-user trading state |
| `MARKET_DATA` | DO | Live price SQLite cache |

### Database

Schema is in `database/enhanced-schema.sql`. Migrations also run **inline on every request** in `_middleware.ts` via `runMigrations()` — idempotent `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` statements. New columns are added via `ALTER TABLE … ADD COLUMN` with errors suppressed, so they're safe to re-run.

Key tables: `users`, `trading_bots`, `trades`, `portfolio_snapshots`, `market_data`, `daily_performance`, `performance_metrics`, `risk_assessments`.

Auth uses PBKDF2 (100k iterations, SHA-256) for passwords and HS256 JWT tokens (24h expiry), stored in `SESSIONS` KV. The frontend persists `auth_token` and `user` in `localStorage`.

### Frontend

React 18 + TypeScript, built with Vite. Path aliases: `@` → `src/`, `@components`, `@lib`, `@pages`, `@styles`, `@types`.

Context providers wrap the entire app (defined in `src/App.tsx`):
- `AuthProvider` (`src/lib/AuthContext.tsx`) — JWT auth state, persisted to `localStorage`
- `TradingModeProvider` (`src/lib/TradingModeContext.tsx`) — `paper` | `live` toggle, persisted to `localStorage`

`DashboardConnected` is the main authenticated view; it polls the API every 30 seconds. `src/lib/api.ts` is the single Axios client — it auto-attaches `Authorization: Bearer <token>` and redirects to `/login` on 401.

In production the frontend and API share the same origin (Cloudflare Pages), so `src/lib/api.ts` uses relative URLs (`VITE_API_URL` can override for local dev pointing at `localhost:8787`).

### Trading engine

`functions/lib/algo-trading-engine.ts` — implements 6 strategies: `momentum`, `rsi_reversion`, `macd_crossover`, `breakout`, `scalping`, `dual_ma`. Each returns a `SignalResult` with `signal` (buy/sell/hold), `confidence` (0–1), and indicator values.

`functions/lib/sdk-exchange-connector.ts` — wraps the `ccxt` library to provide a unified `ExchangeManager` across Binance, Kraken, Bybit, KuCoin, Alpaca, Coinbase, OKX, Gate.io, MEXC, Bitget, Bitfinex, Gemini. Trades default to paper mode unless `paperMode: false` is set in bot config.

`functions/lib/coingecko-service.ts` — CoinGecko Pro API wrapper with cache-first reads from KV.

### CI/CD

GitHub Actions (`.github/workflows/deploy.yml`) triggers on push to `main`: installs, builds, then deploys the Pages project via `cloudflare/pages-action`. The scheduled Worker is **not** deployed by CI.

Required GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

Production URL: `https://trade-m8.app` — health check: `GET /api/health`.
