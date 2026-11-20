// Token Radar v3 ("radar-4") — a token launch radar for make.fun's token-radar-01.
// Node 22, standard library only. Reads the sealed snapshot at /input/snapshot.json
// (or --input <file|dir>), fits the launch-value model on the protocols whose token
// already trades, ranks the pre-token protocols by implied value, and writes the board,
// the dashboard data, the screenshots and the dossier to /output (or --output /
// $MAKEFUN_OUTPUT_DIR). Two runs write the same bytes: every random draw comes from
// one seeded generator, and no clock or network is read.
//
// The model (fitted here, from this snapshot alone):
//   log(implied) = b0 + b1*log(TVL) + b2*growth + b3*log(1+age) + b4*log(chains) + b5*ageUnknown
//   growth = 7d TVL change, in percent in the snapshot, as a fraction, clamped -50%..+100%
//   age    = days since listed_at; a missing listed_at is imputed to the comps' median
//            age and flagged by ageUnknown
//   comps  = protocols with a traded token (mcap > 0), not wrapped/staked/bridged
//            products, one per ticker (case-insensitive symbol, largest TVL keeps it),
//            with mcap/TVL at most 10
// The board ranks protocols that record no token (mcap, symbol and gecko_id all null)
// and are not wrapped products. Launch odds are a peer base rate: among the
// non-wrapped protocols of the same age and size band, how many already have a token,
// shrunk toward the overall base rate. A farm plan's expected value is 5% of the
// implied value shared among TVL/$1,000 farmers, less gas on the cheapest chain.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const BOOTSTRAP_REFITS = 200;
const BOOTSTRAP_SEED = 20261114;

// ---------------------------------------------------------------- utilities

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** A small deterministic generator (mulberry32): every random draw in this program. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function dayMs(days: number): number {
  return days * 86_400_000;
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(ms: number, days: number): string {
  return fmtDate(ms + dayMs(days));
}

function fmtUsd(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v).toLocaleString('en-US')}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(2)}`;
}

function fmtInt(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

// ---------------------------------------------------------------- snapshot

interface Protocol {
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

interface Snapshot {
  as_of: string;
  as_of_ms: number;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const protocols = raw.protocols as Protocol[];
  const asOf = raw.as_of as string;
  return {
    as_of: asOf,
    as_of_ms: Date.parse(`${asOf}T00:00:00Z`),
    source: raw.source as string,
    floor_usd: raw.floor_usd as number,
    protocols,
    watchlist: raw.watchlist as string[],
  };
}

// A wrapped, staked or bridged product of a protocol whose token already trades:
// the watchlist rule's own words, applied to every protocol, not just the watchlist.
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

function isWrapped(p: Protocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (/\bwrapped\b|\bstaked\b|\bstaking\b/i.test(p.name)) return true;
  if (/\s(v\d+|\d+\.\d+(\.\d+)?)$/i.test(p.name)) return true;
  if (EXCHANGE_NAMES.some((e) => p.name === e || p.name.startsWith(`${e} `))) return true;
  return false;
}

function ageDays(p: Protocol, asOfMs: number): number | null {
  if (p.listed_at === null) return null;
  // A listing date after the snapshot date is a data error; treat it as brand new.
  return Math.max(0, Math.floor((asOfMs - Date.parse(`${p.listed_at}T00:00:00Z`)) / 86_400_000));
}

/** 7d TVL change as a fraction, clamped to -50%..+100%; unreported change counts as flat. */
function growthOf(p: Protocol): number {
  return clamp((p.change_7d ?? 0) / 100, -0.5, 1.0);
}

// ---------------------------------------------------------------- the model

// Features, in order: intercept, log TVL, growth, log(1+age), log chains, age unknown.
// A missing listed_at is imputed to the comps' median age and flagged.
function features(p: Protocol, asOfMs: number, medianAge: number): number[] {
  const age = ageDays(p, asOfMs);
  const useAge = age === null ? medianAge : age;
  return [
    1,
    Math.log(Math.max(1, p.tvl_usd)),
    growthOf(p),
    Math.log(1 + useAge),
    Math.log(Math.max(1, p.chains.length)),
    age === null ? 1 : 0,
  ];
}

/** Least squares by the normal equations with Gaussian elimination and partial pivoting. */
function ols(rows: number[][], target: number[]): number[] {
  const k = rows[0]!.length;
  const a: number[][] = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const b: number[] = Array<number>(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    for (let x = 0; x < k; x++) {
      b[x] += r[x]! * target[i]!;
      for (let y = 0; y < k; y++) a[x]![y]! += r[x]! * r[y]!;
    }
  }
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
    const tmpRow = a[c]!;
    a[c] = a[piv]!;
    a[piv] = tmpRow;
    const tmpB = b[c]!;
    b[c] = b[piv]!;
    b[piv] = tmpB;
    for (let r = c + 1; r < k; r++) {
      const f = a[r]![c]! / a[c]![c]!;
      for (let j = c; j < k; j++) a[r]![j]! -= f * a[c]![j]!;
      b[r] -= f * b[c]!;
    }
  }
  const beta: number[] = Array<number>(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let t = b[r]!;
    for (let j = r + 1; j < k; j++) t -= a[r]![j]! * beta[j]!;
    beta[r] = t / a[r]![r]!;
  }
  return beta;
}

function predict(beta: number[], row: number[]): number {
  let t = 0;
  for (let i = 0; i < beta.length; i++) t += beta[i]! * row[i]!;
  return t;
}

function rSquared(beta: number[], rows: number[][], target: number[]): number {
  const ybar = mean(target);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < target.length; i++) {
    ssTot += (target[i]! - ybar) ** 2;
    ssRes += (target[i]! - predict(beta, rows[i]!)) ** 2;
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

/** Median absolute log error of a fitted model, leaving one comp out at a time. */
function looError(comps: Protocol[], asOfMs: number, medianAge: number): number {
  const rows = comps.map((p) => features(p, asOfMs, medianAge));
  const y = comps.map((p) => Math.log(p.mcap_usd!));
  const errs: number[] = [];
  for (let k = 0; k < comps.length; k++) {
    const beta = ols(
      rows.filter((_, i) => i !== k),
      y.filter((_, i) => i !== k),
    );
    errs.push(Math.abs(y[k]! - predict(beta, rows[k]!)));
  }
  return median(errs);
}

/** Median absolute log error of a flat multiple (implied = TVL x ratio). */
function flatError(comps: Protocol[], ratio: number): number {
  return median(comps.map((p) => Math.abs(Math.log(p.mcap_usd!) - Math.log(p.tvl_usd * ratio))));
}

/** 5-fold cross-validation, repeated over seeds; returns the median error of each seed. */
function cvError(comps: Protocol[], asOfMs: number, medianAge: number, seeds: number[]): number[] {
  const out: number[] = [];
  for (const seed of seeds) {
    const rand = mulberry32(seed);
    const order = shuffle(comps.map((_, i) => i), rand);
    const errs: number[] = [];
    for (let fold = 0; fold < 5; fold++) {
      const testIdx = new Set(order.filter((_, i) => i % 5 === fold));
      const train = comps.filter((_, i) => !testIdx.has(i));
      const test = comps.filter((_, i) => testIdx.has(i));
      const beta = ols(
        train.map((p) => features(p, asOfMs, medianAge)),
        train.map((p) => Math.log(p.mcap_usd!)),
      );
      for (const p of test) {
        errs.push(Math.abs(Math.log(p.mcap_usd!) - predict(beta, features(p, asOfMs, medianAge))));
      }
    }
    out.push(median(errs));
  }
  return out;
}

/**
 * Walk-forward: fit on the older launches, test on the newer ones, at three splits.
 * Protocols with no listed_at cannot be ordered, so they train but never test.
 */
function walkForward(comps: Protocol[], asOfMs: number, medianAge: number, fractions: number[]): { fraction: number; fitted: number; flat: number; nTest: number }[] {
  const dated = comps.filter((p) => ageDays(p, asOfMs) !== null).sort((a, b) => ageDays(b, asOfMs)! - ageDays(a, asOfMs)!);
  const undated = comps.filter((p) => ageDays(p, asOfMs) === null);
  const flatRatio = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
  const out: { fraction: number; fitted: number; flat: number; nTest: number }[] = [];
  for (const frac of fractions) {
    const cut = Math.floor(dated.length * frac);
    const train = [...dated.slice(0, cut), ...undated];
    const test = dated.slice(cut);
    const beta = ols(
      train.map((p) => features(p, asOfMs, medianAge)),
      train.map((p) => Math.log(p.mcap_usd!)),
    );
    const fitted = median(test.map((p) => Math.abs(Math.log(p.mcap_usd!) - predict(beta, features(p, asOfMs, medianAge)))));
    const flat = median(test.map((p) => Math.abs(Math.log(p.mcap_usd!) - Math.log(p.tvl_usd * flatRatio))));
    out.push({ fraction: frac, fitted, flat, nTest: test.length });
  }
  return out;
}

// ---------------------------------------------------------------- launch odds

// A peer base rate: among the non-wrapped protocols in the same age band and size
// band, how many already have a token. Shrunk toward the overall base rate with a
// prior strength of 5, so a band with two protocols cannot claim 0% or 100%.
// This is a base rate, not a prediction: it says what happened to the protocol's
// peers, never whether this protocol will issue a token.
const AGE_BANDS: { name: string; test: (age: number | null) => boolean }[] = [
  { name: 'unknown age', test: (a) => a === null },
  { name: '<1y', test: (a) => a !== null && a < 365 },
  { name: '1–2y', test: (a) => a !== null && a >= 365 && a < 730 },
  { name: '2–3y', test: (a) => a !== null && a >= 730 && a < 1095 },
  { name: '3–5y', test: (a) => a !== null && a >= 1095 && a < 1825 },
  { name: '5y+', test: (a) => a !== null && a >= 1825 },
];
const TVL_BANDS: { name: string; test: (tvl: number) => boolean }[] = [
  { name: '<$100M', test: (t) => t < 100_000_000 },
  { name: '$100M–500M', test: (t) => t >= 100_000_000 && t < 500_000_000 },
  { name: '$500M–2B', test: (t) => t >= 500_000_000 && t < 2_000_000_000 },
  { name: '$2B+', test: (t) => t >= 2_000_000_000 },
];

interface OddsGroup {
  ageBand: string;
  tvlBand: string;
  n: number;
  withToken: number;
  rate: number;
}

function launchOddsTable(protocols: Protocol[], asOfMs: number): { groups: OddsGroup[]; overall: number } {
  const peers = protocols.filter((p) => !isWrapped(p));
  const overall = peers.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length / peers.length;
  const prior = 5;
  const groups: OddsGroup[] = [];
  for (const ab of AGE_BANDS) {
    for (const tb of TVL_BANDS) {
      const inGroup = peers.filter((p) => ab.test(ageDays(p, asOfMs)) && tb.test(p.tvl_usd));
      if (inGroup.length === 0) continue;
      const withToken = inGroup.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length;
      const rate = (withToken + prior * overall) / (inGroup.length + prior);
      groups.push({ ageBand: ab.name, tvlBand: tb.name, n: inGroup.length, withToken, rate });
    }
  }
  return { groups, overall };
}

function oddsFor(p: Protocol, asOfMs: number, table: { groups: OddsGroup[]; overall: number }): { odds: number; band: string } {
  const age = ageDays(p, asOfMs);
  const ab = AGE_BANDS.find((b) => b.test(age))!;
  const tb = TVL_BANDS.find((b) => b.test(p.tvl_usd))!;
  const g = table.groups.find((x) => x.ageBand === ab.name && x.tvlBand === tb.name);
  if (g === undefined) return { odds: table.overall, band: `${ab.name} · ${tb.name}` };
  return { odds: g.rate, band: `${ab.name} · ${tb.name}` };
}

// ---------------------------------------------------------------- farm plans

// Gas per transaction, in whole US dollars, as estimated in November 2026 from
// the chains' usual fees. Estimates only: a reader checks the live fee before
// they transact. A protocol farms on its cheapest chain.
const GAS_PER_TX: Record<string, number> = {
  Solana: 0.05,
  Sui: 0.05,
  'Hyperliquid L1': 0.1,
  Monad: 0.1,
  Polygon: 0.1,
  Base: 0.2,
  Sonic: 0.2,
  Mantle: 0.2,
  Plasma: 0.2,
  Binance: 0.3,
  Linea: 0.3,
  'zkSync Era': 0.3,
  Fantom: 0.3,
  Optimism: 0.4,
  Arbitrum: 0.5,
  Tron: 0.5,
  Avalanche: 0.6,
  Bitcoin: 2,
  Ethereum: 8,
};

function cheapestChain(p: Protocol): { chain: string; gas: number } {
  let best: { chain: string; gas: number } = { chain: 'Ethereum', gas: GAS_PER_TX.Ethereum! };
  for (const c of p.chains) {
    const g = GAS_PER_TX[c] ?? 1;
    if (g < best.gas) best = { chain: c, gas: g };
  }
  return best;
}

interface FarmPlan {
  verdict: 'farm' | 'thin' | 'skip';
  deposit_usd: number;
  gas_usd: number;
  ev_usd: number;
  net_usd: number;
  start: string;
  hold_until: string;
  break_even: string | null;
  break_even_weeks: number | null;
  chain: string;
  steps: string[];
}

const DEPOSIT_VERBS: Record<string, string> = {
  'Risk Curators': 'Deposit the ${dep} into ${name}\u2019s curator vault on ${chain}. The deposit starts earning points at once and costs about ${gas} in gas.',
  RWA: 'Buy ${dep} of ${name}\u2019s tokenised asset on ${chain} and hold the receipt in the same wallet; the purchase costs about ${gas} in gas.',
  Lending: 'Supply ${dep} USDC to ${name}\u2019s lending market on ${chain}. Supplying starts earning points and costs about ${gas} in gas.',
  Dexs: 'Add ${dep} as liquidity to ${name}\u2019s main pool on ${chain} (USDC paired with the pool\u2019s other asset). Adding costs about ${gas} in gas.',
  Yield: 'Deposit ${dep} into ${name}\u2019s yield vault on ${chain}. The vault starts compounding at once and costs about ${gas} in gas.',
  'Yield Aggregator': 'Deposit ${dep} into ${name}\u2019s aggregator vault on ${chain}; it routes the funds across its strategies and costs about ${gas} in gas.',
  Derivatives: 'Open a small hedged position of ${dep} on ${name} (${chain}) and keep the size tiny \u2014 this is activity, not leverage. Opening costs about ${gas} in gas.',
  CDP: 'Lock ${dep} of collateral in ${name}\u2019s vault on ${chain} and mint a small amount of its stablecoin, then burn it the same week. Locking costs about ${gas} in gas.',
  'Basis Trading': 'Deposit ${dep} into ${name}\u2019s basis vault on ${chain}. The vault runs its basis trade for you and costs about ${gas} in gas.',
  'Onchain Capital Allocator': 'Allocate ${dep} to one strategy inside ${name} on ${chain}. Allocation costs about ${gas} in gas and starts the clock on your position.',
  Chain: 'Fund a wallet on ${name} (${chain}) with ${dep} and make one real transaction \u2014 a transfer or a swap \u2014 so the address shows activity. It costs about ${gas} in gas.',
  Launchpad: 'Complete ${name}\u2019s profile and registration on ${chain} and stake the ${dep} deposit it asks for; registration costs about ${gas} in gas.',
  Farm: 'Stake ${dep} in ${name}\u2019s farm on ${chain}. Staking starts earning points at once and costs about ${gas} in gas.',
  Restaking: 'Restake ${dep} through ${name} on ${chain}. Restaking starts earning points at once and costs about ${gas} in gas.',
  'Staking Pool': 'Stake ${dep} in ${name}\u2019s pool on ${chain}. Staking starts earning points at once and costs about ${gas} in gas.',
  Indexes: 'Buy ${dep} of ${name}\u2019s index on ${chain} and hold it; the purchase costs about ${gas} in gas.',
  Insurance: 'Buy ${dep} of cover from ${name} on ${chain} for the position you already hold; the purchase costs about ${gas} in gas.',
  Payments: 'Route ${dep} of real payments through ${name} on ${chain} over the next month; each payment costs about ${gas} in gas.',
  'Governance Incentives': 'Lock ${dep} in ${name}\u2019s governance vault on ${chain} and vote in the next proposal; locking costs about ${gas} in gas.',
  'Liquidity Manager': 'Deposit ${dep} into ${name}\u2019s managed liquidity position on ${chain}; the manager rebalances for you and costs about ${gas} in gas.',
  'Leveraged Farming': 'Open a low-leverage ${dep} farming position on ${name} (${chain}) and keep leverage at the minimum; opening costs about ${gas} in gas.',
  'Token Locker': 'Lock ${dep} of tokens in ${name}\u2019s locker on ${chain} for the full hold period; locking costs about ${gas} in gas.',
  'Stablecoin Wrapper': 'Wrap ${dep} into ${name}\u2019s stablecoin on ${chain} and hold it; wrapping costs about ${gas} in gas.',
  CeDeFi: 'Deposit ${dep} into ${name}\u2019s CeDeFi vault on ${chain}; the vault runs its strategies for you and costs about ${gas} in gas.',
};

const WEEKLY_VERBS: Record<string, string> = {
  'Risk Curators': 'Once a month, review the curator strategies inside ${name} and move the deposit to the best-performing one; each move costs about ${gas} in gas.',
  RWA: 'Check the asset\u2019s backing report once a month and keep the receipt untouched; no trade is needed unless the report flags a problem.',
  Lending: 'Once, borrow a small amount against the deposit and repay it the same week to register as an active borrower; it costs about ${gas} in gas per transaction.',
  Dexs: 'Swap a small amount through ${name}\u2019s pool once a week to show real trading flow; each swap costs about ${gas} in gas.',
  Yield: 'Claim and restake the vault\u2019s yield once a month; each claim costs about ${gas} in gas.',
  'Yield Aggregator': 'Claim and restake the aggregator\u2019s yield once a month; each claim costs about ${gas} in gas.',
  Derivatives: 'Close and reopen the small hedged position once a month; each round trip costs about ${gas} in gas.',
  CDP: 'Check the collateral ratio once a month and top it up if it falls near liquidation; topping up costs about ${gas} in gas.',
  'Basis Trading': 'Check the funding panel once a week; only act if the vault asks for a rebalance, which costs about ${gas} in gas.',
  'Onchain Capital Allocator': 'Rebalance only when the allocator publishes a new strategy; each rebalance costs about ${gas} in gas.',
  Chain: 'Make one real transaction a week on ${name} \u2014 a transfer or a swap \u2014 so the address stays active; each costs about ${gas} in gas.',
};

function fill(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(values)) out = out.split(`\${${k}}`).join(v);
  return out;
}

function farmPlan(p: Protocol, implied: number, asOfMs: number): FarmPlan {
  const { chain, gas } = cheapestChain(p);
  const gasUsd = round2(4 * gas);
  const deposit = p.tvl_usd < 100_000_000 ? 50 : p.tvl_usd < 1_000_000_000 ? 100 : 200;
  const farmers = Math.max(1, Math.round(p.tvl_usd / 1000));
  const ev = (0.05 * implied) / farmers;
  const net = ev - gasUsd;
  const verdict: FarmPlan['verdict'] = net >= 25 ? 'farm' : net >= 0 ? 'thin' : 'skip';
  const start = fmtDate(asOfMs);
  const holdUntil = addDays(asOfMs, 182);
  let breakEven: string | null = null;
  let breakEvenWeeks: number | null = null;
  if (ev > gasUsd) {
    breakEvenWeeks = Math.min(26, Math.ceil(gasUsd / (ev / 26)));
    breakEven = addDays(asOfMs, breakEvenWeeks * 7);
  }
  const vals = {
    dep: `$${deposit}`,
    gas: `$${gasUsd.toFixed(2)}`,
    ev: fmtUsd(ev),
    net: net >= 0 ? fmtUsd(net) : `-${fmtUsd(Math.abs(net))}`,
    name: p.name,
    chain,
    start,
    hold: holdUntil,
  };
  const beText = breakEven === null ? 'no break-even: gas exceeds the expected value' : `break-even around ${breakEven}`;
  const steps = [
    fill(`Move ${vals.dep} in USDC onto ${chain} and keep it in a wallet you control; do this on ${start}. Bridging costs about ${vals.gas} in gas and takes under 15 minutes.`, vals),
    fill(DEPOSIT_VERBS[p.category ?? ''] ?? `Use ${p.name}\u2019s main feature on ${chain} with ${vals.dep} and keep the position open; the first use costs about ${vals.gas} in gas.`, vals),
    fill(`Top up the position by a small amount once a week, every seven days, so the address shows steady activity; each top-up costs about ${vals.gas} in gas and takes under 10 minutes.`, vals),
    fill(WEEKLY_VERBS[p.category ?? ''] ?? `Use ${p.name}\u2019s main feature once a week on ${chain}; each use costs about ${vals.gas} in gas and keeps the address active.`, vals),
    fill(`Keep the position open until ${holdUntil}; withdrawing early resets the farming history the plan is built on.`, vals),
    fill(`The maths: expected airdrop value about ${vals.ev} per farmer, gas about ${vals.gas} for the whole plan, net about ${vals.net} \u2014 ${beText}.`, vals),
    fill(`If ${p.name} issues a token, claim in the first week and compare the claim with the ${vals.ev} estimate; if it never issues one, the ${vals.dep} deposit is still yours to withdraw.`, vals),
  ];
  return { verdict, deposit_usd: deposit, gas_usd: gasUsd, ev_usd: round2(ev), net_usd: round2(net), start, hold_until: holdUntil, break_even: breakEven, break_even_weeks: breakEvenWeeks, chain, steps };
}

// ---------------------------------------------------------------- the board

interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  launch_odds: number;
  odds_band: string;
  expected_value_usd: number;
  farm_verdict: 'farm' | 'thin' | 'skip';
  farm_net_usd: number;
  farm_deposit_usd: number;
  farm_gas_usd: number;
  farm_chain: string;
  farm_start: string;
  farm_hold_until: string;
  farm_break_even: string | null;
  rank_p10: number;
  rank_p90: number;
  implied_p10_usd: number;
  implied_p90_usd: number;
  contrib: { intercept: number; log_tvl: number; growth: number; log_age: number; log_chains: number; age_unknown: number };
}

interface Radar {
  as_of: string;
  source: string;
  model: {
    equation: string;
    beta: number[];
    feature_names: string[];
    comps: number;
    comps_dropped: { wrapped: number; duplicate_ticker: number; ratio_over_10: number };
    median_age_days: number;
    r2: number;
    loo: number;
    loo_flat_median: number;
    loo_flat_022: number;
    flat_median_ratio: number;
    cv_seeds: number[];
    cv_mean: number;
    walk_forward: { fraction: number; fitted: number; flat: number; n_test: number }[];
  };
  validation: {
    loo_improvement_vs_flat: number;
    cv_improvement_vs_flat: number;
    wf_improvement_vs_flat: number;
  };
  coverage: {
    total: number;
    ranked: number;
    wrapped_excluded: number;
    with_mcap: number;
    symbol_no_mcap: number;
    watchlist: number;
    watchlist_covered: number;
  };
  integrity: {
    mcap_nonpositive: number;
    missing_growth: number;
    missing_listed_at: number;
    symbol_no_mcap: number;
    dropped_wrapped: number;
    dropped_duplicate_ticker: number;
    dropped_ratio_over_10: number;
  };
  odds: { groups: OddsGroup[]; overall: number };
  best_farms: { slug: string; name: string; rank: number; net_usd: number; ev_usd: number; verdict: string; implied_value_usd: number }[];
  verdict_counts: { farm: number; thin: number; skip: number };
  comps_list: { slug: string; name: string; tvl_usd: number; mcap_usd: number; ratio: number; change_7d: number | null; age_days: number | null; chains: number }[];
  watchlist: string[];
  rows: BoardRow[];
}

function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const { protocols, watchlist, as_of_ms: asOfMs } = snapshot;

  // Comps: traded tokens, not wrapped, one per ticker, ratio at most 10.
  const traded = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const unwrapped = traded.filter((p) => !isWrapped(p));
  const droppedWrapped = traded.length - unwrapped.length;
  const byTicker = new Map<string, Protocol>();
  let droppedDup = 0;
  for (const p of unwrapped) {
    const key = (p.symbol ?? p.slug).toLowerCase();
    const cur = byTicker.get(key);
    if (cur !== undefined) {
      droppedDup++;
      if (p.tvl_usd > cur.tvl_usd) byTicker.set(key, p);
    } else {
      byTicker.set(key, p);
    }
  }
  const deduped = [...byTicker.values()];
  const comps = deduped.filter((p) => p.mcap_usd! / p.tvl_usd <= 10);
  const droppedRatio = deduped.length - comps.length;

  const medianAge = median(comps.map((p) => ageDays(p, asOfMs)).filter((a): a is number => a !== null));
  const rows = comps.map((p) => features(p, asOfMs, medianAge));
  const y = comps.map((p) => Math.log(p.mcap_usd!));
  const beta = ols(rows, y);
  const r2 = rSquared(beta, rows, y);
  const loo = looError(comps, asOfMs, medianAge);
  const flatRatio = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
  const looFlatMedian = flatError(comps, flatRatio);
  const looFlat022 = flatError(comps, 0.22);
  const cvSeeds = [11, 23, 37, 41, 53];
  const cv = cvError(comps, asOfMs, medianAge, cvSeeds);
  const cvMean = mean(cv);
  const wf = walkForward(comps, asOfMs, medianAge, [0.5, 0.6, 0.4]);

  // The board: protocols that record no token at all and are not wrapped products.
  const candidates = protocols.filter((p) => p.mcap_usd === null && p.symbol === null && p.gecko_id === null && !isWrapped(p));
  const oddsTable = launchOddsTable(protocols, asOfMs);

  const scored = candidates.map((p) => {
    const f = features(p, asOfMs, medianAge);
    const logImplied = predict(beta, f);
    const implied = Math.max(1, Math.round(Math.exp(logImplied)));
    const { odds, band } = oddsFor(p, asOfMs, oddsTable);
    const plan = farmPlan(p, implied, asOfMs);
    return {
      p,
      f,
      implied,
      odds,
      band,
      ev: Math.max(0, Math.round(implied * odds)),
      plan,
      contrib: {
        intercept: round2(beta[0]!),
        log_tvl: round2(beta[1]! * f[1]!),
        growth: round2(beta[2]! * f[2]!),
        log_age: round2(beta[3]! * f[3]!),
        log_chains: round2(beta[4]! * f[4]!),
        age_unknown: round2(beta[5]! * f[5]!),
      },
    };
  });
  scored.sort((a, b) => b.implied - a.implied || a.p.slug.localeCompare(b.p.slug));

  // Bootstrap rank bands: 200 refits on resampled comps, seeded, so the run repeats.
  const rand = mulberry32(BOOTSTRAP_SEED);
  const rankSamples: number[][] = scored.map(() => []);
  const impliedSamples: number[][] = scored.map(() => []);
  for (let b = 0; b < BOOTSTRAP_REFITS; b++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rand() * comps.length)]!);
    const bBeta = ols(
      sample.map((p) => features(p, asOfMs, medianAge)),
      sample.map((p) => Math.log(p.mcap_usd!)),
    );
    const preds = scored.map((s) => predict(bBeta, s.f));
    const order = preds.map((v, i) => i).sort((i, j) => preds[j]! - preds[i]!);
    order.forEach((idx, pos) => {
      rankSamples[idx]!.push(pos + 1);
      impliedSamples[idx]!.push(Math.max(1, Math.round(Math.exp(preds[idx]!))));
    });
  }

  const board: BoardRow[] = scored.map((s, i) => {
    const ranks = [...rankSamples[i]!].sort((a, b) => a - b);
    const impl = [...impliedSamples[i]!].sort((a, b) => a - b);
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: s.implied,
      farm_steps: s.plan.steps,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: ageDays(s.p, asOfMs),
      listed_at: s.p.listed_at,
      launch_odds: round4(s.odds),
      odds_band: s.band,
      expected_value_usd: s.ev,
      farm_verdict: s.plan.verdict,
      farm_net_usd: s.plan.net_usd,
      farm_deposit_usd: s.plan.deposit_usd,
      farm_gas_usd: s.plan.gas_usd,
      farm_chain: s.plan.chain,
      farm_start: s.plan.start,
      farm_hold_until: s.plan.hold_until,
      farm_break_even: s.plan.break_even,
      rank_p10: Math.round(percentile(ranks, 0.1)),
      rank_p90: Math.round(percentile(ranks, 0.9)),
      implied_p10_usd: Math.round(percentile(impl, 0.1)),
      implied_p90_usd: Math.round(percentile(impl, 0.9)),
      contrib: s.contrib,
    };
  });

  // Coverage accounting: four buckets that add up to the whole snapshot.
  const withMcap = protocols.filter((p) => p.mcap_usd !== null).length;
  const symbolNoMcap = protocols.filter((p) => p.symbol !== null && p.mcap_usd === null).length;
  const nullSymbol = protocols.filter((p) => p.symbol === null);
  const wrappedExcluded = nullSymbol.filter((p) => p.mcap_usd === null && isWrapped(p)).length;

  const verdictCounts = { farm: 0, thin: 0, skip: 0 };
  for (const r of board) verdictCounts[r.farm_verdict]++;
  const bestFarms = [...board]
    .sort((a, b) => b.farm_net_usd - a.farm_net_usd)
    .slice(0, 5)
    .map((r) => ({ slug: r.slug, name: r.name, rank: r.rank, net_usd: r.farm_net_usd, ev_usd: r.expected_value_usd, verdict: r.farm_verdict, implied_value_usd: r.implied_value_usd }));

  const wfFitted = mean(wf.map((w) => w.fitted));
  const wfFlat = mean(wf.map((w) => w.flat));
  const radar: Radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    model: {
      equation: 'log(implied) = b0 + b1*log(TVL) + b2*growth + b3*log(1+age) + b4*log(chains) + b5*ageUnknown',
      beta: beta.map((v) => round4(v)),
      feature_names: ['intercept', 'log(TVL)', 'growth (7d, clamped -50%..+100%)', 'log(1+age in days)', 'log(chains)', 'age unknown (listed_at missing)'],
      comps: comps.length,
      comps_dropped: { wrapped: droppedWrapped, duplicate_ticker: droppedDup, ratio_over_10: droppedRatio },
      median_age_days: medianAge,
      r2: round4(r2),
      loo: round4(loo),
      loo_flat_median: round4(looFlatMedian),
      loo_flat_022: round4(looFlat022),
      flat_median_ratio: round4(flatRatio),
      cv_seeds: cv.map((v) => round4(v)),
      cv_mean: round4(cvMean),
      walk_forward: wf.map((w) => ({ fraction: w.fraction, fitted: round4(w.fitted), flat: round4(w.flat), n_test: w.nTest })),
    },
    validation: {
      loo_improvement_vs_flat: round2(looFlatMedian / loo),
      cv_improvement_vs_flat: round2(looFlatMedian / cvMean),
      wf_improvement_vs_flat: round2(wfFlat / wfFitted),
    },
    coverage: {
      total: protocols.length,
      ranked: board.length,
      wrapped_excluded: wrappedExcluded,
      with_mcap: withMcap,
      symbol_no_mcap: symbolNoMcap,
      watchlist: watchlist.length,
      watchlist_covered: watchlist.filter((w) => board.some((r) => r.slug === w)).length,
    },
    integrity: {
      mcap_nonpositive: protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd <= 0).length,
      missing_growth: protocols.filter((p) => p.change_7d === null).length,
      missing_listed_at: protocols.filter((p) => p.listed_at === null).length,
      symbol_no_mcap: symbolNoMcap,
      dropped_wrapped: wrappedExcluded,
      dropped_duplicate_ticker: droppedDup,
      dropped_ratio_over_10: droppedRatio,
    },
    odds: oddsTable,
    best_farms: bestFarms,
    verdict_counts: verdictCounts,
    comps_list: comps
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd!,
        ratio: round4(p.mcap_usd! / p.tvl_usd),
        change_7d: p.change_7d,
        age_days: ageDays(p, asOfMs),
        chains: p.chains.length,
      }))
      .sort((a, b) => b.mcap_usd - a.mcap_usd),
    watchlist: [...watchlist].sort(),
    rows: board,
  };
  return { board, radar };
}

function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** The gate's own rules, as this program checks them before it writes anything. */
function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, not 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!slugs.has(r.slug)) return `row ${i + 1} names ${r.slug}, not in the snapshot`;
    if (seen.has(r.slug)) return `row ${i + 1} repeats ${r.slug}`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `row ${i + 1} carries rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} rises above row ${i}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `row ${i + 1} has no positive whole implied value`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${i + 1} carries ${r.farm_steps.length} farm steps, not 3..12`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${i + 1} has a farm step of ${t.length} characters, not 20..600`;
    }
  }
  if (board.length > 1 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'every row carries the same implied value';
  for (const w of snapshot.watchlist) {
    if (!seen.has(w)) return `watchlist protocol ${w} is missing from the board`;
  }
  return null;
}

// ---------------------------------------------------------------- run

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const m = radar.model;
const top = board.slice(0, 5);
process.stdout.write(
  `token radar v3: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${radar.verdict_counts.farm} farm / ${radar.verdict_counts.thin} thin / ${radar.verdict_counts.skip} skip)\n` +
    `token radar v3: model on ${m.comps} comps (dropped ${m.comps_dropped.wrapped} wrapped, ${m.comps_dropped.duplicate_ticker} dup ticker, ${m.comps_dropped.ratio_over_10} ratio>10); beta ${m.beta.map((v) => v.toFixed(3)).join(', ')}; R2 ${m.r2}\n` +
    `token radar v3: LOO ${m.loo} vs flat-median ${m.loo_flat_median} vs flat-0.22 ${m.loo_flat_022} (${radar.validation.loo_improvement_vs_flat}x better than flat); CV x5 seeds ${m.cv_seeds.join(', ')} (mean ${m.cv_mean}); WF ${m.walk_forward.map((w) => `${Math.round(w.fraction * 100)}/${Math.round((1 - w.fraction) * 100)} ${w.fitted} vs flat ${w.flat}`).join(', ')}\n` +
    `token radar v3: coverage ${radar.coverage.ranked} ranked + ${radar.coverage.wrapped_excluded} wrapped-excluded + ${radar.coverage.with_mcap} with-mcap + ${radar.coverage.symbol_no_mcap} symbol-no-mcap = ${radar.coverage.total}; watchlist ${radar.coverage.watchlist_covered}/${radar.coverage.watchlist}\n` +
    `token radar v3: top 5: ${top.map((r) => `#${r.rank} ${r.slug} ${fmtUsd(r.implied_value_usd)} odds ${r.launch_odds} EV ${fmtUsd(r.expected_value_usd)} ${r.farm_verdict}`).join(' | ')}\n` +
    `token radar v3: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
