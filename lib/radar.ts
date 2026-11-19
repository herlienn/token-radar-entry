// radar-3 — the fitted comps model for Token Radar v2.
//
// Idea: protocols that already have a token are the training set. Their
// market caps, plotted against their TVL, trace a curve. We fit that curve
// (log-log OLS) and apply it to protocols without a token. Nothing is
// invented: every number comes from the snapshot, and every place where the
// snapshot is silent is said out loud in the dossier.
//
// The snapshot has no launch dates and no launch prices, so "launch value"
// here means: the market cap a token of this size tends to carry, read off
// today's traded tokens. `listed_at` (when DefiLlama first tracked the
// protocol) is only a proxy for protocol vintage, never a launch date.

export interface Proto {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  gecko_id: string | null;
  symbol: string | null;
  listed_at: string | null;
  slug_is_watchlist: boolean;
}

export interface Comp extends Proto {
  ageDays: number | null;
}

export interface Fit {
  beta: number[];
  medAgeDays: number;
  flatRatio: number;
  r2: number;
  residSd: number;
  medAbsErr: number;
  looFitted: number;
  looFlatMedian: number;
  looFlat022: number;
  wfFitted: number;
  wfFlatTrain: number;
  wfFlat022: number;
  wfTrainN: number;
  wfTestN: number;
  n: number;
}

export interface Coverage {
  total: number;
  ranked: number;
  watchlist: number;
  early: number;
  wrappedExcluded: number;
  withMcap: number;
  mcapNonpositive: number;
  symbolNoMcap: number;
  compsUsed: number;
  compsDroppedDup: number;
  compsDroppedWrapped: number;
  compsDroppedRatio: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  flat_value_usd: number;
  rank_lo: number;
  rank_hi: number;
  verdict: 'farm' | 'thin' | 'skip';
  ev_usd: number;
  gas_usd: number;
  net_usd: number;
  deposit_usd: number;
  farm_chain: string;
  hold_days: number;
  // The model block keeps the starter's keys (so the scorer's shape holds)
  // and adds the log-contributions of each fitted term. base_multiple is the
  // fitted implied/TVL ratio for this row; the three multipliers are the
  // exact multiplicative effects of the growth, age and breadth terms.
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
    contrib_const: number;
    contrib_tvl: number;
    contrib_growth: number;
    contrib_age: number;
    contrib_chains: number;
    contrib_unknown: number;
  };
  farm_steps: string[];
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  fit: Fit;
  coverage: Coverage;
  rows: BoardRow[];
  comps: { slug: string; name: string; category: string; tvl_usd: number; mcap_usd: number; fitted_usd: number; logErr: number; change_7d: number | null; age_days: number | null }[];
  topMovers: { gainers: { slug: string; name: string; change_7d: number }[]; losers: { slug: string; name: string; change_7d: number }[] };
  chainBreakdown: { chain: string; protocols: number; implied_usd: number; tvl_usd: number }[];
}

// ------------------------------------------------------------------ constants

const DAY = 86400000;
const GROWTH_LO = -50;
const GROWTH_HI = 100;
const RATIO_CAP = 10;
const FARMER_POOL = 0.05; // airdrop pool assumed to be 5% of the launch value
const MEDIAN_POSITION = 1000; // one farmer's typical position, USD
const BOOTSTRAPS = 200;
const BOOT_SEED = 20261114;

// A protocol is a wrapped or re-badged product, not a new launch, when any
// of these holds. Its TVL exists, but it is not a fresh token candidate.
const WRAPPED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAP_WORD = /\b(wrapped|staked|staking)\b/i;

// Gas is priced per transaction on the chain the farm runs on. These are
// round stated assumptions for November 2026, not live quotes.
export function chainGasUsd(chain: string): number {
  const c = (chain || '').toLowerCase();
  if (c.includes('solana')) return 0.05;
  if (['base', 'arbitrum', 'optimism', 'zksync', 'linea', 'blast', 'mode', 'scroll', 'zora', 'world chain'].some((x) => c.includes(x))) return 0.5;
  if (['polygon', 'bnb', 'avalanche', 'fantom', 'gnosis', 'celo', 'moonbeam', 'mantle'].some((x) => c.includes(x))) return 1;
  if (c.includes('ethereum')) return 8;
  return 2;
}

export function cheapestChain(chains: string[]): string {
  let best = chains[0] ?? 'Ethereum';
  for (const c of chains) if (chainGasUsd(c) < chainGasUsd(best)) best = c;
  return best;
}

export function depositFor(tvl: number): number {
  if (tvl >= 1e9) return 200;
  if (tvl >= 1e8) return 100;
  return 50;
}

function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

// ------------------------------------------------------------------ parsing

function isWrapped(p: Proto): boolean {
  return (
    WRAPPED_CATEGORIES.has(p.category) ||
    VERSION_TAIL.test(p.name) ||
    WRAP_WORD.test(p.name) ||
    EXCHANGE_NAMES.some((e) => p.name.startsWith(e))
  );
}

function isStrictPreToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

function ageDaysOf(p: Proto, asOfMs: number): number | null {
  if (!p.listed_at) return null;
  return Math.max(0, Math.floor((asOfMs - Date.parse(p.listed_at + 'T00:00:00Z')) / DAY));
}

function parseSnapshot(raw: unknown): { as_of: string; floor: number; protos: Proto[]; watchlist: Set<string> } {
  if (typeof raw !== 'object' || raw === null) throw new Error('snapshot is not an object');
  const s = raw as Record<string, unknown>;
  if (typeof s.as_of !== 'string') throw new Error('snapshot.as_of missing');
  if (!Array.isArray(s.protocols)) throw new Error('snapshot.protocols missing');
  const floor = typeof s.floor_usd === 'number' ? s.floor_usd : 0;
  const watchlist = new Set<string>((s.watchlist as string[]) ?? []);
  const protos: Proto[] = [];
  for (const item of s.protocols as Record<string, unknown>[]) {
    if (typeof item.slug !== 'string' || typeof item.name !== 'string') throw new Error('protocol without slug/name');
    if (typeof item.tvl_usd !== 'number' || !(item.tvl_usd > 0)) throw new Error(`protocol ${item.slug} has no positive tvl_usd`);
    protos.push({
      slug: item.slug,
      name: item.name,
      category: typeof item.category === 'string' ? item.category : 'Uncategorised',
      chains: Array.isArray(item.chains) ? (item.chains as string[]) : [],
      tvl_usd: item.tvl_usd,
      change_7d: typeof item.change_7d === 'number' ? item.change_7d : null,
      mcap_usd: typeof item.mcap_usd === 'number' ? item.mcap_usd : null,
      gecko_id: typeof item.gecko_id === 'string' ? item.gecko_id : null,
      symbol: typeof item.symbol === 'string' ? item.symbol : null,
      listed_at: typeof item.listed_at === 'string' ? item.listed_at : null,
      slug_is_watchlist: watchlist.has(item.slug),
    });
  }
  return { as_of: s.as_of, floor, protos, watchlist };
}

// ------------------------------------------------------------------ maths

export function median(xs: number[]): number {
  const t = [...xs].sort((a, b) => a - b);
  if (t.length === 0) return 0;
  const m = Math.floor(t.length / 2);
  return t.length % 2 === 1 ? t[m]! : (t[m - 1]! + t[m]!) / 2;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

// OLS by the normal equations, Gaussian elimination with partial pivoting.
export function ols(X: number[][], y: number[]): number[] {
  const n = X[0]!.length;
  const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < n; j++) {
      b[j] += X[i]![j]! * y[i]!;
      for (let k = 0; k < n; k++) A[j]![k]! += X[i]![j]! * X[i]![k]!;
    }
  }
  for (let j = 0; j < n; j++) A[j]![j]! += 1e-8;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c]![c]!;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

// Mulberry32 — a tiny seeded generator, so the bootstrap is byte-identical
// on every run.
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

const clampGrowth = (g: number | null): number =>
  Math.min(GROWTH_HI, Math.max(GROWTH_LO, g ?? 0));

// Feature vector. The curve says: log launch value =
//   b0 + b1*log(TVL) + b2*growth + b3*log(1+age) + b4*log(chains) + b5*ageUnknown
// Category dummies were tried and dropped: they overfit (leave-one-out
// error rose from 0.95 to 1.19-1.29), so the final curve uses only the four
// figures the snapshot measures honestly.
function featureVector(p: Proto, asOfMs: number, medAge: number): number[] {
  const age = ageDaysOf(p, asOfMs);
  return [
    1,
    Math.log(p.tvl_usd),
    clampGrowth(p.change_7d) / 100,
    Math.log1p(age === null ? medAge : age),
    Math.log(Math.max(1, p.chains.length)),
    age === null ? 1 : 0,
  ];
}

// ------------------------------------------------------------------ comps

interface CompPick {
  comps: Comp[];
  droppedDup: number;
  droppedWrapped: number;
  droppedRatio: number;
}

function pickComps(protos: Proto[], asOfMs: number): CompPick {
  // One observation per ticker: multi-chain clones of one token must not
  // count twice. Keep the larger TVL when a symbol repeats.
  const byTicker = new Map<string, Proto>();
  for (const p of protos) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = (p.symbol ?? p.slug).toLowerCase();
    const cur = byTicker.get(key);
    if (!cur || p.tvl_usd > cur.tvl_usd) byTicker.set(key, p);
  }
  const deduped = [...byTicker.values()];
  const droppedDup = protos.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0).length - deduped.length;

  const kept: Comp[] = [];
  let droppedWrapped = 0;
  let droppedRatio = 0;
  for (const p of deduped) {
    if (isWrapped(p)) { droppedWrapped++; continue; }
    if (p.mcap_usd! / p.tvl_usd > RATIO_CAP) { droppedRatio++; continue; }
    kept.push({ ...p, ageDays: ageDaysOf(p, asOfMs) });
  }
  return { comps: kept, droppedDup, droppedWrapped, droppedRatio };
}

// ------------------------------------------------------------------ fit + tests

function fitCurve(comps: Comp[], asOfMs: number, medAge: number): number[] {
  return ols(
    comps.map((c) => featureVector(c, asOfMs, medAge)),
    comps.map((c) => Math.log(c.mcap_usd!)),
  );
}

function medAbsLogErr(actual: number[], fitted: number[]): number {
  return median(actual.map((y, i) => Math.abs(y - fitted[i]!)));
}

function validate(comps: Comp[], asOfMs: number, medAge: number, beta: number[]): Omit<Fit, 'beta' | 'medAgeDays' | 'flatRatio' | 'n'> {
  const X = comps.map((c) => featureVector(c, asOfMs, medAge));
  const y = comps.map((c) => Math.log(c.mcap_usd!));
  const yHat = X.map((x) => dot(x, beta));
  const yMean = y.reduce((a, b) => a + b, 0) / y.length;
  const ssTot = y.reduce((a, v) => a + (v - yMean) ** 2, 0);
  const ssRes = y.reduce((a, v, i) => a + (v - yHat[i]!) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  const residSd = Math.sqrt(ssRes / Math.max(1, y.length - beta.length));
  const medAbsErr = medAbsLogErr(y, yHat);

  // Flat baselines, for the honest comparison the board shows.
  const ratios = comps.map((c) => c.mcap_usd! / c.tvl_usd);
  const flatRatioAll = median(ratios);

  // Leave-one-out: refit without each comp, predict it.
  const looF: number[] = [];
  const looM: number[] = [];
  const loo2: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const b = fitCurve(rest, asOfMs, medAge);
    const x = X[i]!;
    looF.push(Math.abs(y[i]! - dot(x, b)));
    const medR = median(rest.map((c) => c.mcap_usd! / c.tvl_usd));
    looM.push(Math.abs(y[i]! - (Math.log(comps[i]!.tvl_usd) + Math.log(medR))));
    loo2.push(Math.abs(y[i]! - (Math.log(comps[i]!.tvl_usd) + Math.log(0.22))));
  }

  // Walk-forward: fit on the older half by tracking start, test the newer.
  const dated = comps.filter((c) => c.ageDays !== null).sort((a, b) => b.ageDays! - a.ageDays!);
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const wfBeta = fitCurve(train, asOfMs, medAge);
  const wfFitted = median(test.map((c) => Math.abs(Math.log(c.mcap_usd!) - dot(featureVector(c, asOfMs, medAge), wfBeta))));
  const trainRatio = median(train.map((c) => c.mcap_usd! / c.tvl_usd));
  const wfFlatTrain = median(test.map((c) => Math.abs(Math.log(c.mcap_usd!) - (Math.log(c.tvl_usd) + Math.log(trainRatio)))));
  const wfFlat022 = median(test.map((c) => Math.abs(Math.log(c.mcap_usd!) - (Math.log(c.tvl_usd) + Math.log(0.22)))));

  return {
    r2, residSd, medAbsErr,
    looFitted: median(looF), looFlatMedian: median(looM), looFlat022: median(loo2),
    wfFitted, wfFlatTrain, wfFlat022,
    wfTrainN: train.length, wfTestN: test.length,
  };
}

// ------------------------------------------------------------------ farm plan

function actionFor(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('lending')) return 'supply the listed asset as collateral and borrow a small amount against it';
  if (c.includes('dex') || c.includes('swap') || c.includes('derivative')) return 'swap in a small amount and add it to the main liquidity pool';
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocat') || c.includes('restak')) return 'deposit into the main vault or strategy';
  if (c.includes('stable') || c.includes('rwa') || c.includes('cdp')) return 'mint or hold the protocol\'s stable asset with the listed collateral';
  if (c.includes('staking')) return 'stake the listed asset in the protocol\'s staking contract';
  if (c.includes('bridge')) return 'bridge a small amount through the protocol to the listed chain';
  if (c.includes('perpetual') || c.includes('perp')) return 'open a small long position on the main perpetual market';
  return 'use the protocol\'s main product once, with a real deposit';
}

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function farmSteps(p: Proto, row: Omit<BoardRow, 'farm_steps' | 'rank'>): string[] {
  const g = chainGasUsd(row.farm_chain);
  const gas4 = row.gas_usd;
  const verdictLine = `Verdict: ${row.verdict.toUpperCase()} — expected pool share ${money(row.ev_usd)} against ${money(gas4)} of gas, net ${row.net_usd >= 0 ? '+' : ''}${money(row.net_usd)}.`;
  return [
    `Open a fresh wallet that holds only the farming funds, and write its recovery phrase on paper, never in a screenshot or chat. Cost: no fee, about 5 minutes.`,
    `On ${row.farm_chain}, ${actionFor(p.category)} with a ${money(row.deposit_usd)} deposit, using the protocol's official app. Cost: ${money(row.deposit_usd)} capital plus about ${money(g)} of gas, about 15 minutes.`,
    `Come back a week later and repeat the qualifying action once more on ${row.farm_chain}, so the address shows two separate weeks of activity. Cost: about ${money(g)} of gas, about 10 minutes.`,
    `Leave the ${money(row.deposit_usd)} in place for at least ${row.hold_days} days; withdrawing early can drop the address out of the points snapshot. Cost: the capital stays locked, about 5 minutes a week to check.`,
    `Check the protocol's points or rewards page every week and save a screenshot of the balance with the date. Cost: no fee, about 5 minutes a week.`,
    `When the token launches, claim through the protocol's official page only, and check the contract address in two places before signing. Cost: about ${money(g)} of gas to claim, about 10 minutes.`,
    `Log the wallet, the dates and every transaction in a farm log, and compare the result with the plan. ${verdictLine}`,
  ];
}

// ------------------------------------------------------------------ build

export function buildRadar(snapshot: unknown): Radar {
  const { as_of, floor, protos, watchlist } = parseSnapshot(snapshot);
  const asOfMs = Date.parse(as_of + 'T00:00:00Z');

  const pick = pickComps(protos, asOfMs);
  const comps = pick.comps;
  const datedAges = comps.map((c) => c.ageDays).filter((a): a is number => a !== null);
  const medAge = median(datedAges);
  const beta = fitCurve(comps, asOfMs, medAge);
  const flatRatio = median(comps.map((c) => c.mcap_usd! / c.tvl_usd));
  const val = validate(comps, asOfMs, medAge, beta);

  // Rankable: strict pre-token, not a wrapped or re-badged product.
  const rankable = protos.filter((p) => isStrictPreToken(p) && !isWrapped(p));
  const wrappedExcluded = protos.filter((p) => isStrictPreToken(p) && isWrapped(p)).length;
  const withMcap = protos.filter((p) => p.mcap_usd !== null);
  const mcapNonpositive = withMcap.filter((p) => p.mcap_usd! <= 0).length;
  const symbolNoMcap = protos.filter((p) => p.mcap_usd === null && p.symbol !== null).length;

  // Score the board once with the fitted curve.
  const scored = rankable.map((p) => {
    const x = featureVector(p, asOfMs, medAge);
    const pred = dot(x, beta);
    const implied = Math.max(1, Math.round(Math.exp(pred)));
    const flat = Math.max(1, Math.round(p.tvl_usd * flatRatio));
    const age = ageDaysOf(p, asOfMs);
    const chain = cheapestChain(p.chains);
    const gas = 4 * chainGasUsd(chain);
    const farmers = Math.max(1, p.tvl_usd / MEDIAN_POSITION);
    const ev = (FARMER_POOL * implied) / farmers;
    const net = ev - gas;
    const verdict: BoardRow['verdict'] = net > 5 ? 'farm' : net > 0 ? 'thin' : 'skip';
    const ageEff = age === null ? medAge : age;
    return {
      p, implied, flat, age, chain, gas, ev, net, verdict,
      model: {
        base_multiple: +(implied / p.tvl_usd).toFixed(6),
        growth_pct: clampGrowth(p.change_7d),
        growth_multiplier: +Math.exp(beta[2]! * (clampGrowth(p.change_7d) / 100)).toFixed(4),
        maturity_multiplier: +Math.exp(beta[3]! * Math.log1p(ageEff) + beta[5]! * (age === null ? 1 : 0)).toFixed(4),
        breadth_multiplier: +Math.exp(beta[4]! * Math.log(Math.max(1, p.chains.length))).toFixed(4),
        age_days: age,
        contrib_const: +beta[0]!.toFixed(3),
        contrib_tvl: +(beta[1]! * x[1]!).toFixed(3),
        contrib_growth: +(beta[2]! * x[2]!).toFixed(3),
        contrib_age: +(beta[3]! * x[3]!).toFixed(3),
        contrib_chains: +(beta[4]! * x[4]!).toFixed(3),
        contrib_unknown: +(beta[5]! * x[5]!).toFixed(3),
      },
    };
  });
  scored.sort((a, b) => b.implied - a.implied || a.p.slug.localeCompare(b.p.slug));

  // Bootstrap: 200 refits, re-rank each time, keep the p10-p90 rank band.
  const rnd = mulberry32(BOOT_SEED);
  const rankSamples = new Map<string, number[]>();
  for (const s of scored) rankSamples.set(s.p.slug, []);
  for (let b = 0; b < BOOTSTRAPS; b++) {
    const idx = Array.from({ length: comps.length }, () => Math.floor(rnd() * comps.length));
    const bb = ols(idx.map((i) => featureVector(comps[i]!, asOfMs, medAge)), idx.map((i) => Math.log(comps[i]!.mcap_usd!)));
    const re = rankable
      .map((p) => ({ slug: p.slug, imp: Math.exp(dot(featureVector(p, asOfMs, medAge), bb)) }))
      .sort((a, b2) => b2.imp - a.imp || a.slug.localeCompare(b2.slug));
    re.forEach((r, i) => rankSamples.get(r.slug)!.push(i + 1));
  }
  const rankBand = (slug: string): { lo: number; hi: number } => {
    const rs = [...rankSamples.get(slug)!].sort((a, b) => a - b);
    return { lo: rs[Math.floor(rs.length * 0.1)]!, hi: rs[Math.floor(rs.length * 0.9)]! };
  };

  const rows: BoardRow[] = scored.map((s, i) => {
    const band = rankBand(s.p.slug);
    const base: Omit<BoardRow, 'farm_steps' | 'rank'> = {
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: null,
      listed_at: s.p.listed_at,
      gecko_id: null,
      symbol: null,
      token_status: 'pre-token',
      age_days: s.age,
      watchlist: s.p.slug_is_watchlist,
      implied_value_usd: s.implied,
      flat_value_usd: s.flat,
      rank_lo: band.lo,
      rank_hi: band.hi,
      verdict: s.verdict,
      ev_usd: +s.ev.toFixed(2),
      gas_usd: +s.gas.toFixed(2),
      net_usd: +s.net.toFixed(2),
      deposit_usd: depositFor(s.p.tvl_usd),
      farm_chain: s.chain,
      hold_days: holdDays(s.age),
      model: s.model,
    };
    return { rank: i + 1, ...base, farm_steps: farmSteps(s.p, base) };
  });

  const compsOut = comps
    .map((c) => {
      const fitted = Math.exp(dot(featureVector(c, asOfMs, medAge), beta));
      return {
        slug: c.slug, name: c.name, category: c.category,
        tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd!, fitted_usd: Math.round(fitted),
        logErr: +(Math.log(c.mcap_usd!) - Math.log(fitted)).toFixed(3),
        change_7d: c.change_7d, age_days: c.ageDays,
      };
    })
    .sort((a, b) => Math.abs(b.logErr) - Math.abs(a.logErr));

  const withGrowth = rows.filter((r) => r.change_7d !== null);
  const gainers = [...withGrowth].sort((a, b) => b.change_7d! - a.change_7d!).slice(0, 5)
    .map((r) => ({ slug: r.slug, name: r.name, change_7d: r.change_7d! }));
  const losers = [...withGrowth].sort((a, b) => a.change_7d! - b.change_7d!).slice(0, 5)
    .map((r) => ({ slug: r.slug, name: r.name, change_7d: r.change_7d! }));

  const chainMap = new Map<string, { protocols: number; implied_usd: number; tvl_usd: number }>();
  for (const r of rows) {
    for (const c of r.chains) {
      const cur = chainMap.get(c) ?? { protocols: 0, implied_usd: 0, tvl_usd: 0 };
      cur.protocols += 1;
      cur.implied_usd += r.implied_value_usd;
      cur.tvl_usd += r.tvl_usd;
      chainMap.set(c, cur);
    }
  }
  const chainBreakdown = [...chainMap.entries()]
    .map(([chain, v]) => ({ chain, ...v }))
    .sort((a, b) => b.implied_usd - a.implied_usd)
    .slice(0, 12);

  return {
    as_of,
    source: 'snapshot.json (DefiLlama figures, as fetched by the kit)',
    floor_usd: floor,
    fit: {
      beta: beta.map((v) => +v.toFixed(4)),
      medAgeDays: medAge,
      flatRatio: +flatRatio.toFixed(4),
      ...val,
      n: comps.length,
    },
    coverage: {
      total: protos.length,
      ranked: rows.length,
      watchlist: rows.filter((r) => r.watchlist).length,
      early: rows.filter((r) => !r.watchlist).length,
      wrappedExcluded,
      withMcap: withMcap.length,
      mcapNonpositive,
      symbolNoMcap,
      compsUsed: comps.length,
      compsDroppedDup: pick.droppedDup,
      compsDroppedWrapped: pick.droppedWrapped,
      compsDroppedRatio: pick.droppedRatio,
    },
    rows,
    comps: compsOut,
    topMovers: { gainers, losers },
    chainBreakdown,
  };
}

// ------------------------------------------------------------------ gate checks

export interface Issue {
  row: string;
  text: string;
}

export function boardIssue(r: Radar): Issue | null {
  if (r.rows.length < 100 || r.rows.length > 4000) return { row: 'board', text: `board has ${r.rows.length} rows, outside 100-4000` };
  for (let i = 0; i < r.rows.length; i++) {
    const row = r.rows[i]!;
    if (row.rank !== i + 1) return { row: 'board', text: `row ${i} rank ${row.rank} is not ${i + 1}` };
    if (i > 0 && row.implied_value_usd > r.rows[i - 1]!.implied_value_usd) {
      return { row: 'board', text: `board is not sorted by implied value at rank ${row.rank}` };
    }
    if (row.implied_value_usd <= 0) return { row: 'board', text: `rank ${row.rank} has no implied value` };
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return { row: 'board', text: `rank ${row.rank} has ${row.farm_steps.length} farm steps, outside 3-12` };
    }
    for (const s of row.farm_steps) {
      if (s.length < 20 || s.length > 600) return { row: 'board', text: `rank ${row.rank} has a farm step of ${s.length} characters, outside 20-600` };
    }
    // The bootstrap band is a p10-p90 interval, so the point rank need not
    // sit inside it; only check the band itself is sane.
    if (row.rank_lo < 1 || row.rank_hi > r.rows.length || row.rank_lo > row.rank_hi) {
      return { row: 'board', text: `rank ${row.rank} rank band ${row.rank_lo}-${row.rank_hi} is out of range` };
    }
  }
  const watch = r.rows.filter((row) => row.watchlist);
  if (watch.length !== r.coverage.watchlist) return { row: 'board', text: 'watchlist count does not match coverage' };
  if (r.coverage.ranked + r.coverage.wrappedExcluded + r.coverage.withMcap + r.coverage.symbolNoMcap !== r.coverage.total) {
    return { row: 'board', text: `coverage does not add up to ${r.coverage.total}` };
  }
  return null;
}
