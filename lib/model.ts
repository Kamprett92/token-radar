// The token radar's model, version radar-2: one snapshot of the protocol universe in, one ranked
// board out. It improves on the starter (radar-1) in three stated ways:
//
//   1. Coverage: the board ranks EVERY rankable pre-token protocol (198 here), not the watchlist
//      plus 160 by TVL. Rankable applies the house watchlist's own exclusion rule to the whole
//      board, so wrapped, staked and bridged products of tokens that already trade (WBTC,
//      Binance staked ETH, Coinbase Bridge, USDT0, Base Bridge) are never ranked: they will never
//      have a launch of their own, and ranking one first would be a TVL table, not a radar.
//   2. Value: implied value is a category-comparable FDV, not a flat 0.25x of TVL. Each category
//      takes the median market-cap-to-TVL ratio of the live-token protocols in that same category
//      (at least 3 comparables), falling back to the median of the comparable live protocols when
//      a category has too few. A comparable is a live-token protocol that is itself a protocol:
//      bridges, wrapped or staked products, versioned pools and exchanges are not comparables.
//      The multiples are computed from the snapshot at run time, never hardcoded and never
//      by protocol name: the same function scores every row.
//   3. Farm plans: seven steps per protocol, each derived from the protocol's own record
//      (category, first chain, TVL, age), with a concrete cost and time on every step.
//
//   implied = round(tvl_usd x categoryMultiple x growthMult x ageMult)
//     categoryMultiple = median live mcap/TVL of the category (n >= 3), else global live median,
//                        clamped to [0.05, 1.50]
//     growthMult       = 1 + clamp(change_7d, -50, 100) / 100 x 0.5        -> [0.75, 1.50]
//     ageMult          = 0.80 + 0.20 x min(age_days, 730) / 730            -> [0.80, 1.00]
//                        (unknown age: 0.85)
//
// A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id, no
// symbol). Live-token protocols are kept apart and shown at the market's own values, never mixed
// into the ranked board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  min_comps: number;
  category_floor: number;
  category_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_multiplier: number;
}

export const MODEL: ModelConstants = {
  min_comps: 3,
  category_floor: 0.05,
  category_cap: 1.5,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.8,
  maturity_range: 0.2,
  maturity_days: 730,
  unknown_age_multiplier: 0.85,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's comparable multiple, as computed from the snapshot's live protocols. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  comps: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The house watchlist's exclusion rule: a wrapped, staked or bridged product of a token that
 *  already trades, a versioned pool, or an exchange's own product is not a protocol still waiting
 *  on a launch of its own. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export function isExcludedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_NAME.test(p.name)) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token and not an excluded product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isExcludedProduct(p);
}

/** The category multiples the snapshot's own live-token protocols imply: the median
 *  market-cap-to-TVL ratio per category (at least `min_comps` comparables), the median of the
 *  comparable live protocols as the fallback, both clamped to the model's band. */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, CategoryMultiple> } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    // A comparable is a live-token protocol that is itself a protocol, not an excluded product:
    // a bridge, a wrapped or staked product, a versioned pool or an exchange's own token trades
    // on a different basis, and its ratio would say nothing about a pre-token protocol's launch.
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0 || isExcludedProduct(p)) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? '(no category)';
    const list = byCat.get(key) ?? [];
    list.push(ratio);
    byCat.set(key, list);
  }
  const clamp = (v: number): number => Math.min(model.category_cap, Math.max(model.category_floor, v));
  const global = all.length > 0 ? clamp(median(all)) : 0.2;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of byCat) {
    if (ratios.length >= model.min_comps) {
      byCategory.set(category, { category, multiple: clamp(median(ratios)), comps: ratios.length });
    }
  }
  return { global, byCategory };
}

/** The multiple one protocol's category implies, with its comparable count (0 when the global
 *  fallback applies). */
export function multipleFor(p: SnapshotProtocol, multiples: { global: number; byCategory: Map<string, CategoryMultiple> }): { multiple: number; comps: number } {
  const entry = p.category === null ? undefined : multiples.byCategory.get(p.category);
  if (entry !== undefined) return { multiple: entry.multiple, comps: entry.comps };
  return { multiple: multiples.global, comps: 0 };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: { global: number; byCategory: Map<string, CategoryMultiple> },
  model: ModelConstants,
): { implied: number; catMultiple: number; catComps: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, comps } = multipleFor(protocol, multiples);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  // The multipliers are rounded first, then the implied value is computed from the rounded
  // ones: the dashboard stores those same rounded numbers and recomputes the row in the page,
  // so its arithmetic must land on the same integer board.json carries.
  const catMultiple = round4(multiple);
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const maturityMult =
    age === null
      ? model.unknown_age_multiplier
      : round4(model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * catMultiple * growthMult * maturityMult));
  return { implied, catMultiple, catComps: comps, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = categoryMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked, even one the snapshot no longer
  // carries (it cannot, but the board's coverage is the gate's row and is never gambled).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any size. The watchlist's floor
  // is never the whole board, and a protocol below the floor is no worse a subject.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.catMultiple),
      category_comps: s.catComps,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in the words a farmer budgets with. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return '$4 to $10 of gas per transaction';
  if (c === 'solana') return 'about $0.01 of gas per transaction';
  if (c === 'base' || c === 'arbitrum' || c === 'optimism' || c === 'polygon' || c === 'bnb chain' || c === 'bsc') return '$0.10 to $0.50 of gas per transaction';
  if (c === 'avalanche') return '$0.30 to $1 of gas per transaction';
  return 'about $1 of gas per transaction';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's primary on-chain action, in the words a farmer can follow. */
function primaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the loan-to-value below 50%.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('leveraged farm')) return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and let it compound.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} of USDC into ${name} on ${chain} and stake the receipt token it issues.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the shares for the full term.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in its most liquid market.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote in its next proposal.`;
  if (c.includes('payment') || c.includes('card')) return `Load $${capital} onto ${name} on ${chain} and spend it through the protocol's own app.`;
  if (c.includes('otc')) return `Take a $${capital} offer on ${name}'s OTC desk on ${chain} and settle it in full.`;
  if (c.includes('chain') || c.includes('btc')) return `Bridge $${capital} of USDC to the chain ${name} runs on and use its flagship app there.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second, different on-chain interaction. */
function secondaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${Math.max(20, Math.floor(capital / 5))} against the supply on ${name} and repay it within the week.`;
  if (c.includes('dex')) return `Swap $${Math.max(20, Math.floor(capital / 5))} through ${name} on ${chain} in the same pool you provide to.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Claim and restake the rewards ${name} pays on ${chain} instead of letting them sit idle.`;
  if (c.includes('rwa')) return `Check ${name}'s backing report on ${chain} and add $${Math.max(20, Math.floor(capital / 5))} more to the same position.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading')) return `Close the hedge on ${name} and open a fresh one at the current funding rate.`;
  if (c.includes('prediction')) return `Settle the position on ${name} and take a second one in a market closing this week.`;
  if (c.includes('stable')) return `Swap half the stable position through ${name} on ${chain} and hold the other half.`;
  if (c.includes('insurance')) return `Read ${name}'s cover terms on ${chain} and file a test claim to learn the process.`;
  if (c.includes('bridge')) return `Bridge a second, smaller amount back through ${name} to prove the round trip works.`;
  if (c.includes('staking') || c.includes('restak')) return `Unstake a small part through ${name} and restake it to register a second staking event.`;
  if (c.includes('index')) return `Rebalance the ${name} index position on ${chain} to its target weights.`;
  if (c.includes('governance')) return `Delegate the voting power ${name} gives you to an active delegate.`;
  if (c.includes('payment') || c.includes('card')) return `Make a second purchase with ${name} and keep the receipt for the farm log.`;
  if (c.includes('otc')) return `Settle a second, smaller OTC offer on ${name} to show repeat activity.`;
  return `Use a second feature of ${name} on ${chain}, such as its swap, vault or rewards page.`;
}

/** The category's weekly qualifying action. */
function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Adjust the supply or borrow on ${name} once a week so the position moves.`;
  if (c.includes('dex')) return `Swap a small amount through ${name} once a week and top up the pool if the range drifts.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Harvest and restake the ${name} rewards once a week.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading')) return `Roll the hedge on ${name} once a week at the new funding rate.`;
  if (c.includes('prediction')) return `Take one new market position on ${name} each week.`;
  if (c.includes('governance')) return `Vote in every new ${name} proposal while the position is open.`;
  return `Do one qualifying action on ${name} each week, such as a deposit, a swap, a vote or a claim.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it on ${chain} first.`,
      cost: gas,
      time: '10 minutes',
    },
    {
      text: primaryAction(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '20 minutes to set up',
    },
    {
      text: secondaryAction(p, capital, chain),
      cost: `about $${Math.max(20, Math.floor(capital / 5))} of capital and ${gas}`,
      time: '15 minutes',
    },
    {
      text: weeklyAction(p),
      cost: gas,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, then plan the exit: unwind in two moves, never all at once.`,
      cost: gas,
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  // The table the dashboard shows is the multiples the board actually uses: a category with no
  // ranked row (a bridge, a CEX, a privacy pool that is itself versioned) has no multiple to show.
  const boardCategories = new Set(board.map((r) => r.category));
  const multiplesTable: CategoryMultiple[] = [...multiples.byCategory.values()]
    .filter((x) => boardCategories.has(x.category))
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(multiples.global),
    multiples: multiplesTable,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
