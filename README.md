# Token Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![token-radar-01 rank](https://make.fun/badge/token-radar-01/Kamprett92/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![token-radar-01 reward](https://make.fun/badge/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

A token-launch radar for the make.fun `token-radar-01` bounty: it reads a sealed snapshot of
758 DeFi protocols (DefiLlama protocol index, 2026-11-14), ranks every pre-token protocol by a
stated implied value, gives each one a concrete farm plan, and renders the board as a static
dashboard page. No network, no framework, Node 22 standard library only.

## The model (radar-2)

`implied = round( tvl_usd × categoryMultiple × growthMult × ageMult )`

- **categoryMultiple** — the median market-cap-to-TVL ratio of the live-token protocols in the
  same category (at least 3 comparables), clamped to [0.05, 1.50]. A category with fewer
  comparables falls back to the median of the comparable live protocols (0.236). A comparable
  is a live-token protocol that is itself a protocol: bridges, wrapped or staked products,
  versioned pools and exchanges are not comparables. The multiples are computed from the
  snapshot at run time, never hardcoded and never by protocol name.
- **growthMult** — `1 + clamp(change_7d, −50, 100) / 100 × 0.5`, so a week of growth moves the
  value by at most half its size, and a crash costs at most a quarter.
- **ageMult** — `0.80 + 0.20 × min(age_days, 730) / 730`: a protocol that has run longer with no
  token is worth more; an unknown listing date uses 0.85.

The board ranks **198 rows**: the 40-protocol watchlist (every protocol at or above the $50M
floor with no token on record) plus 158 early pre-token protocols below the floor, by the same
model. Wrapped, staked and bridged products of tokens that already trade are never ranked —
they will never launch a token of their own. The 24 live-token protocols are set aside with
their market caps shown, never mixed into the ranking.

## Farm plans

Every row carries a 7-step farm plan derived from the protocol's own record — category, first
chain, TVL and age — with a concrete cost and time on each step: a fresh wallet, the primary
on-chain action (supply, provide liquidity, deposit into a vault, mint a yield asset, open a
hedge, ...), a second different interaction, a weekly qualifying action, a hold of 30–60 days,
a claim check, and an exit in two moves. No protocol name is special-cased.

## The dashboard

A static page (`dashboard/index.html`, `app.css`, `app.js`) that reads `data.js` beside it:
search, category and chain filters, a watchlist-only toggle, sortable columns, a detail view
per protocol with the model breakdown and its farm plan, and the category-multiple table the
model computed. Dark radar theme. The page recomputes each row's implied value from the same
rounded multipliers `board.json` carries, and says so in the detail view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`
(via the vendored `vendor/makefun-board.ts`) into the output directory. Two runs into two
directories are byte-identical.

## Gate check (local run, 2026-11-17)

- board: 198 rows (100–4,000), watchlist 40/40, ranks 1..198, implied value non-increasing,
  farm steps 7 per row, all 20–600 characters
- dashboard: 3 files, 38,896 bytes (≤ 4 MiB, source ≤ 65,536)
- screenshots: 3 PNGs at 1440×900, 143–222 KiB each (≤ 512 KiB)
- dossier: 735,912 bytes (≤ 1.5 MiB), text 39,160 bytes (≤ 65,536), rebuilds byte for byte

`node ../token-radar-gate-check.mjs out` re-runs every check above (local tool, kept beside the repo, not part of the entry).

## Files

- `main.ts` — the entrypoint: reads the snapshot, scores the board, writes the outputs
- `lib/model.ts` — the radar-2 model, the farm plans, the snapshot parser, the board check
- `dashboard/` — `index.html`, `app.css`, `app.js` (the static page)
- `screenshots/` — board, protocol detail, filtered view (1440×900)
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte
- `DESIGN.md` — the design notes behind the model
- `LICENSE` — MIT
