# Token Radar — design notes (radar-2)

## What the starter does (radar-1, the 2-plain anchor)
- Model: implied = TVL x 0.25 x growthMult x maturityMult; growth = clamp(change_7d, -60, 120), weight 0.5; maturity 0.6 + min(age,1095)/1095 x 0.4 (unknown age = 365).
- Board: 40 watchlist + 160 early below-floor by TVL = 200 rows.
- Farm plans: 6 steps, mostly generic, one category-flavoured action.
- Live view: 24 live-token protocols by market cap.
- Dashboard: plain light page, board + detail + filter, ~29 KB source.

## radar-2: what changes and why (judge criteria in order)
1. **Coverage (criterion 1).** Board = ALL 198 rankable pre-token protocols (watchlist 40 + every other protocol that passes the house's own exclusion rule), not 200 capped by TVL. Rankable = records no token AND not CEX, not versioned, not a wrapped/staked/bridged product (category not in Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking / Restaked BTC / CEX; name has no whole word wrapped/staked/staking; name does not start with an exchange name; no version marker). This is the house watchlist rule applied to the whole board. It keeps WBTC ($7.91B), Binance staked ETH ($7.45B), Coinbase Bridge ($7.23B), USDT0 ($3.57B) and Base Bridge ($2.74B) OUT — they are wrapped/bridged products of tokens that already trade, so ranking them #1 would be wrong. The starter dodges them only by taking early rows below the floor; radar-2 excludes them by rule and says so.
2. **Value model (criterion 2).** Category-comparable FDV instead of a flat 0.25x:
   `implied = round(TVL x catMultiple x growthMult x ageMult)`
   - `catMultiple` = median live-token mcap/TVL in the protocol's own category when that category has >= 3 live-token comparables, else the global comparable median 0.236 (n=92); clamped to [0.05, 1.50]. Measured from the snapshot itself (comparables = live-token protocols that are themselves protocols — bridges, wrapped/staked products, versioned pools and exchanges excluded; zero ratios excluded): Dexs 0.342 (n=11), Lending 0.132 (n=14), Yield 0.191 (n=9), RWA 0.275 (n=9), CDP 0.169 (n=3), Yield Aggregator 0.252 (n=4), Basis Trading 0.654 (n=7), Indexes 0.148 (n=3), Cross Chain Bridge 2.205 (n=4) -> clamped 1.50. Categories with <3 comps (Risk Curators 34 rows — 1 live comp, Api3 at 2.97x; Onchain Capital Allocator 18 rows — 2 live comps, Concrete 0.019x and Grove 0.006x; Derivatives 13 rows — 2; Chain 4 rows — 0) fall back to the global median — their thin ratios are not comps, and are NOT used. Note the house rule's exclusion set is Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX — "Cross Chain Bridge" is a bridge protocol in its own right (Across, Hyperlane, Synapse all have their own tokens), so Circle Gateway is rankable and its category multiple is a real comparable set.
   - `growthMult` = 1 + clamp(change_7d, -50, 100)/100 x 0.5 -> [0.75, 1.50]; null change -> 1.0. The 7d max in the snapshot is +4448%, so the clamp is load-bearing.
   - `ageMult` = 0.80 + 0.20 x min(age_days, 730)/730 -> [0.80, 1.00]; unknown age -> 0.85. Milder than the starter's 0.6-1.0: age is a weak signal, category and growth do the work.
   - No protocol name is special-cased; the same function scores every row. Live-token protocols are kept apart in their own view at market values, never mixed into the ranked board.
3. **Farm plans (criterion 3).** 7 steps per protocol, all derived from the protocol's own record (category, first chain, TVL, age):
   1. Fresh wallet + gas on the protocol's chain (chain-specific gas cost: Ethereum $4-10, L2s $0.10-0.50, Solana ~$0.01, BSC $0.10-0.30, other ~$1).
   2. Primary on-chain action for the category, with exact capital (TVL tiers $250/$150/$100/$50).
   3. A second, different on-chain interaction for the category (e.g. DEX: swap + LP; lending: supply + borrow; perps: open + close; vaults: deposit + rebalance check).
   4. Weekly qualifying action, cadence stated.
   5. Hold window in days (from age: <180d -> 60, <365d -> 45, else 30) so activity spans snapshots.
   6. Points/rewards check + claim only from the protocol's own published link, never pay to claim.
   7. Farm log + exit plan.
   Each step is one string "action. Cost: .... Time: ....", 20-600 chars (same guard as the starter).
4. **Dashboard (criteria 4-5).** Dark radar theme (deep navy #0b1220, amber #f5c542 accent, slate text), designed for 1440x900 screenshots:
   - Header: title, snapshot as-of date, stats (198 ranked rows, 40/40 watchlist covered, 24 live shown), model version radar-2.
   - "How the value is calculated" section: the formula in plain text + the category-multiple table rendered from data.js + the exclusion rule + the "records no token, never has none" disclaimer.
   - Controls: text search, category select, chain select, watchlist-only toggle, sort (rank / implied value / TVL / 7d growth / age), result count.
   - Board table: rank, protocol, category, chains, TVL, 7d, age, implied value. Click a row -> detail panel with every field, the model breakdown (TVL x multiple x growth x age = implied, each factor shown), and the farm plan with cost/time per step. Deep links via location.hash (#detail:<slug>, #filter:<category>).
   - Live-token section below the board, clearly labelled "already trades — shown at market value, not ranked".
   - Footer: methodology + data source (DefiLlama snapshot as of 2026-11-14) + disclaimer (implied values are this entry's own claim).
   - Source budget: index.html + app.css + app.js must total <= 65,536 bytes so the judge reads the whole dashboard source. data.js lives at /output root (like the starter) and is NOT in the dossier text.
   - No network anywhere: no http(s) in any attribute, style body, import or specifier. The snapshot source URL is rendered as plain visible text only (or omitted).

## Outputs (main.ts pipeline, same shape as the starter)
- /output/board.json: { rows: 198 } (100-4000, <= 8 MiB).
- /output/data.js: window.RADAR = { as_of, source, floor_usd, model, model_version, categoryMultiples, watchlist_size, board_size, early_size, live_size, rows, live }.
- /output/dashboard/ (index.html, app.css, app.js), /output/screenshots/ (3 PNGs, 1440x900, target 300-350 KB each, cap 512 KiB).
- /output/dossier.json via vendor/makefun-board.ts buildDossier (kit file, byte for byte), text cap 65536.
- Deterministic: two runs must write identical bytes (stable sorts with slug tie-breaks, no timestamps in outputs).

## Verification (local, before any submit)
- Run main.ts twice into two dirs, diff -r (must be identical).
- Gate checker script mirroring the seven rows: dashboard files, board file, sorted_by_value, coverage, farm_steps, screenshots, dossier_matches (rebuild dossier and compare bytes).
- Screenshot sizes + dimensions; dossier <= 1.5 MiB; dashboard source <= 65,536 bytes.
- Node 22 compat: standard library only, no Node 24-only APIs. (Local node is v24; the grader runs Node 22.)
