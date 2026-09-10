These 4 files were extracted from the now-archived `xq-trade-m8-deploy` folder during a home-folder consolidation pass — they had no equivalent anywhere else in the TradeM8 codebase:

- `xau_trading_algorithm.ts` — gold/XAU-specific trading model
- `production_leverage_trading_algorithm.ts` — high-leverage trading model
- `multiExchange.js` — exchange routing logic
- `optimizedEnsembleStrategy.js` — ensemble ML strategy

They are copied here as-is and are **not yet wired into this app's build** (no import references added, no path updates made). Check these against the app's existing `functions/lib/` structure and integrate properly before relying on them — update any relative import paths since they were written to live in `xq-trade-m8-deploy`'s original layout, not here.
