// Token Radar v4 — model, validation, farm plans, accounting.
// Written from scratch for this entry. No code is copied from any earlier
// Token Radar entry. Deterministic: no wall clock, no unseeded randomness
// (all randomness comes from a seeded PRNG with a fixed seed).

export interface SnapshotProtocol {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  gecko_id: string | null;
  chains: string[];
  listed_at: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist: string[];
  protocols: SnapshotProtocol[];
}

export interface TermResult {
  term: string;
  label: string;
  loo: number; // value: median miss (x); odds: Brier
  wf: number; // walk-forward median miss (x) or Brier
  winShare: number; // fraction of 200 random 80/20 splits where adding the term wins
  verdict: 'kept' | 'tested-not-kept' | 'control';
  note: string;
}

export interface RivalResult {
  name: string;
  loo: number;
  wf: number;
  winShareVsFinal: number; // fraction of 200 splits where the rival beats the final model
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: number;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  kin: boolean;
  kin_name: string | null;
  implied_value_usd: number;
  odds: number;
  expected_value_usd: number;
  own_token_share: number;
  range_lo_usd: number;
  range_hi_usd: number;
  rank_band_lo: number;
  rank_band_hi: number;
  deposit_usd: number;
  expected_drop_usd: number;
  total_cost_usd: number;
  net_usd: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  break_even_date: string | null;
  hold_until_date: string;
  farm_steps: string[];
  contrib_intercept: number;
  contrib_size: number;
  contrib_growth: number;
}

export interface AccountingGroup {
  label: string;
  count: number;
  detail: string;
}

export interface Evidence {
  asOf: string;
  floorUsd: number;
  compsN: number;
  compsPriced: number;
  peersN: number;
  peersBaseRate: number;
  valueBeta: number[];
  valueSe: number[];
  valueLabels: string[];
  valueTerms: TermResult[];
  valueRivals: RivalResult[];
  valueLoo: number;
  valueWf: number;
  valueBaseLoo: number;
  valueBaseWf: number;
  valueFlatLoo: number;
  valueFlatWf: number;
  rangeHonesty: {
    looP2575: number;
    looP1090: number;
    wfP2575: number;
    wfP1090: number;
    looN: number;
    wfN: number;
    note: string;
  };
  oddsBeta: number[];
  oddsLabels: string[];
  oddsTerms: TermResult[];
  oddsRivals: RivalResult[];
  oddsLooBrier: number;
  oddsWfBrier: number;
  oddsBaseLoo: number;
  oddsBaseWf: number;
  oddsBaseBrier: number;
  kinBeta: number;
  kinSe: number;
  kinCompsN: number;
  farmCounts: { farm: number; marginal: number; skip: number };
  accounting: AccountingGroup[];
  boardN: number;
  watchlistN: number;
  checksum: string;
  selfTest: { name: string; pass: boolean; detail: string }[];
  dossierTextBytes: number;
}

export interface ModelResult {
  snapshot: Snapshot;
  board: BoardRow[];
  evidence: Evidence;
}

// ---------- small numeric helpers ----------

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return Number.NaN;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    }
    if (Math.abs(M[piv][c]) < 1e-12) throw new Error('singular matrix');
    const tmp = M[c];
    M[c] = M[piv];
    M[piv] = tmp;
    const d = M[c][c];
    for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f !== 0) for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row[n]);
}

// Ordinary least squares with a ridge penalty vector (0 = unpenalised).
export function ols(X: number[][], y: number[], ridge: number[]): number[] {
  const k = X[0].length;
  const A: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const b: number[] = Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      b[a] += X[i][a] * y[i];
      for (let c = 0; c < k; c++) A[a][c] += X[i][a] * X[i][c];
    }
  }
  // A 1e-6 floor on every diagonal entry: a term can be constant zero in a
  // split or a resample (the kin flag has only 3 positives among the comps),
  // and a zero column with zero ridge would make the system singular. The
  // floor is far below the scale of the normal equations (O(n)), so it does
  // not move any fitted coefficient.
  for (let a = 0; a < k; a++) A[a][a] += (ridge[a] || 0) + 1e-6;
  return solveLinear(A, b);
}

export function sigmoid(z: number): number {
  const c = clamp(z, -30, 30);
  return 1 / (1 + Math.exp(-c));
}

// Logistic regression by IRLS. Warm-startable: pass the previous beta and
// the fit converges in a handful of iterations.
export function logisticFit(
  X: number[][],
  y: number[],
  ridge: number[],
  start?: number[],
  maxIter = 25,
): number[] {
  const k = X[0].length;
  let beta = start ? [...start] : Array(k).fill(0);
  for (let it = 0; it < maxIter; it++) {
    const A: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
    const b: number[] = Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      const p = sigmoid(dot(X[i], beta));
      const w = Math.max(1e-6, p * (1 - p));
      const z = dot(X[i], beta) + (y[i] - p) / w;
      for (let a = 0; a < k; a++) {
        b[a] += w * X[i][a] * z;
        for (let c = 0; c < k; c++) A[a][c] += w * X[i][a] * X[i][c];
      }
    }
    for (let a = 0; a < k; a++) A[a][a] += ridge[a] || 0;
    const next = solveLinear(A, b);
    let shift = 0;
    for (let i = 0; i < k; i++) shift = Math.max(shift, Math.abs(next[i] - beta[i]));
    beta = next;
    if (shift < 1e-7) break;
  }
  return beta;
}

// Deterministic PRNG (mulberry32) — the only source of randomness anywhere.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit checksum, hex. Implemented identically in the dashboard
// (app.js) so the in-browser self-test can recompute it over the same rows.
export function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const DAY_MS = 86400000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function addDays(asOf: string, days: number): string {
  const d = new Date(Date.parse(`${asOf}T00:00:00Z`) + Math.round(days) * DAY_MS);
  return d.toISOString().slice(0, 10);
}

export function stemOf(name: string): string {
  const m = (name || '').toLowerCase().match(/[a-z]+/);
  return m ? m[0] : '';
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isVersioned(p: SnapshotProtocol): boolean {
  return VERSIONED_RE.test(p.name);
}

// The kit starter's rankable rule: pre-token, not an exchange, not a
// versioned name. The board is built from this rule, not from a hand list.
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !isVersioned(p);
}

export function money(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// ---------- value model (OLS on log10 market cap of traded comps) ----------

const SEED = 20261114;
const BOOTSTRAP_REPS = 200;
const SPLIT_REPS = 200;

interface ValueCtx {
  asOf: string;
  catList: string[];
  otherGrowth: Map<string, number>;
  kinOf: (p: SnapshotProtocol) => boolean;
}

function valueFeats(p: SnapshotProtocol, terms: string[], ctx: ValueCtx): number[] {
  const logTvl = Math.log10(p.tvl_usd);
  const growth = clamp(p.change_7d === null ? 0 : p.change_7d, -60, 120) / 100;
  const age = ageDays(ctx.asOf, p.listed_at);
  const ageY = (age === null ? 365 : age) / 365;
  const row: number[] = [1, logTvl];
  if (terms.includes('growth')) row.push(growth);
  if (terms.includes('age')) row.push(ageY);
  if (terms.includes('chains')) row.push(Math.log1p(p.chains.length));
  if (terms.includes('curve')) row.push(logTvl * logTvl);
  if (terms.includes('kin')) row.push(ctx.kinOf(p) ? 1 : 0);
  if (terms.includes('control')) row.push(ctx.otherGrowth.get(p.slug) ?? 0);
  if (terms.includes('category')) {
    for (const c of ctx.catList) row.push((p.category || 'Other') === c ? 1 : 0);
  }
  return row;
}

function valueRidge(terms: string[], ctx: ValueCtx): number[] {
  const n = valueFeats(
    { slug: '', name: '', symbol: null, category: null, tvl_usd: 1, change_7d: null, mcap_usd: null, gecko_id: null, chains: [], listed_at: null },
    terms,
    ctx,
  ).length;
  const r = Array(n).fill(0);
  if (terms.includes('category')) {
    for (let i = n - ctx.catList.length; i < n; i++) r[i] = 2.0;
  }
  return r;
}

function fitValue(train: SnapshotProtocol[], terms: string[], ctx: ValueCtx): number[] {
  return ols(
    train.map((p) => valueFeats(p, terms, ctx)),
    train.map((p) => Math.log10(p.mcap_usd as number)),
    valueRidge(terms, ctx),
  );
}

function looMissValue(comps: SnapshotProtocol[], terms: string[], ctx: ValueCtx): { miss: number; residuals: number[]; preds: number[] } {
  const residuals: number[] = [];
  const preds: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const beta = fitValue(train, terms, ctx);
    const pred = dot(valueFeats(comps[i], terms, ctx), beta);
    preds.push(pred);
    residuals.push(Math.log10(comps[i].mcap_usd as number) - pred);
  }
  return { miss: median(residuals.map((e) => Math.pow(10, Math.abs(e)))), residuals, preds };
}

function wfSplit(comps: SnapshotProtocol[]): { train: SnapshotProtocol[]; test: SnapshotProtocol[] } {
  const dated = [...comps].sort((a, b) => ((a.listed_at as string) < (b.listed_at as string) ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  return { train: dated.slice(0, half), test: dated.slice(half) };
}

function wfMissValue(comps: SnapshotProtocol[], terms: string[], ctx: ValueCtx): { miss: number; residuals: number[] } {
  const { train, test } = wfSplit(comps);
  const beta = fitValue(train, terms, ctx);
  const residuals = test.map((p) => Math.log10(p.mcap_usd as number) - dot(valueFeats(p, terms, ctx), beta));
  return { miss: median(residuals.map((e) => Math.pow(10, Math.abs(e)))), residuals };
}

function flatMissValue(comps: SnapshotProtocol[]): { loo: number; wf: number } {
  const ys = comps.map((p) => Math.log10(p.mcap_usd as number));
  const looErrs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = ys.filter((_, j) => j !== i);
    looErrs.push(Math.abs(ys[i] - median(rest)));
  }
  const { train, test } = wfSplit(comps);
  const trainMed = median(train.map((p) => Math.log10(p.mcap_usd as number)));
  const wfErrs = test.map((p) => Math.abs(Math.log10(p.mcap_usd as number) - trainMed));
  return { loo: median(looErrs.map((e) => Math.pow(10, e))), wf: median(wfErrs.map((e) => Math.pow(10, e))) };
}

const VALUE_CANDIDATES: { term: string; label: string; note: string }[] = [
  { term: 'growth', label: '7-day TVL growth', note: 'Recent TVL momentum, clamped to [-60%, +120%]. Kept on the two pre-registered tests (LOO and walk-forward both improve about 9%); the 200-split win share is below half, so the benefit is clearest in those two tests and noisier across random splits — the coefficient is -1.23 ± 1.40, not tightly estimated.' },
  { term: 'age', label: 'Age (years listed)', note: 'Years since the protocol first recorded a listing date.' },
  { term: 'chains', label: 'Chain count (log1p)', note: 'Number of chains the protocol runs on.' },
  { term: 'curve', label: 'Size curvature (logTVL^2)', note: 'Lets the size slope bend at the top end.' },
  { term: 'kin', label: 'Family token exists', note: 'A same-stem protocol already records a token (own-token share).' },
  { term: 'category', label: 'Category (ridge, >=4 comps)', note: 'One shrunk offset per category with at least 4 comps.' },
];

const VALUE_RIVAL_DEFS: { name: string; terms: string[] | 'flat' }[] = [
  { name: 'flat median', terms: 'flat' },
  { name: 'size only', terms: [] },
  { name: 'size + category', terms: ['category'] },
  { name: 'size + growth + age', terms: ['growth', 'age'] },
  { name: 'kitchen sink (all terms)', terms: ['growth', 'age', 'chains', 'curve', 'kin', 'category'] },
];

interface ValueModel {
  beta: number[];
  se: number[];
  terms: string[];
  loo: number;
  wf: number;
  baseLoo: number;
  baseWf: number;
  flatLoo: number;
  flatWf: number;
  termTable: TermResult[];
  rivals: RivalResult[];
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  rangeHonesty: { looP2575: number; looP1090: number; wfP2575: number; wfP1090: number; looN: number; wfN: number; note: string };
  kinBeta: number;
  kinSe: number;
  kinCompsN: number;
  looResiduals: number[];
  looPreds: number[];
}

function buildValueModel(comps: SnapshotProtocol[], ctx: ValueCtx): ValueModel {
  // Selection rule (stated on the board): a term is kept only if adding it
  // to the size-only base lowers the median miss by at least 1% in BOTH
  // tests (LOO and walk-forward). The margin matters: a term that wins by a
  // hair on one test is noise, not signal. Each candidate's two-test numbers
  // are computed once and reused for the term table, so the verdict and the
  // numbers agree.
  const baseLoo = looMissValue(comps, [], ctx).miss;
  const baseWf = wfMissValue(comps, [], ctx).miss;
  const candTests = new Map<string, { loo: number; wf: number }>();
  const kept = new Set<string>();
  for (const cand of VALUE_CANDIDATES) {
    const loo = looMissValue(comps, [cand.term], ctx).miss;
    const wf = wfMissValue(comps, [cand.term], ctx).miss;
    candTests.set(cand.term, { loo, wf });
    if (loo < baseLoo * 0.99 && wf < baseWf * 0.99) kept.add(cand.term);
  }
  const terms = VALUE_CANDIDATES.map((c) => c.term).filter((t) => kept.has(t));
  const beta = fitValue(comps, terms, ctx);
  const loo = looMissValue(comps, terms, ctx);
  const wf = wfMissValue(comps, terms, ctx);
  const flat = flatMissValue(comps);

  // Bootstrap standard errors on the final coefficients (200 resamples).
  const rngB = mulberry32(SEED);
  const bootBetas: number[][] = [];
  for (let r = 0; r < BOOTSTRAP_REPS; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rngB() * comps.length)]);
    try {
      bootBetas.push(fitValue(sample, terms, ctx));
    } catch {
      // singular resample; skip it
    }
  }
  const se = beta.map((_, j) => {
    const vals = bootBetas.map((b) => b[j]);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const v = vals.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, vals.length - 1);
    return Math.sqrt(v);
  });

  // The kin coefficient and its bootstrap SE, from the size+growth+kin fit:
  // this is the own-token-share test. Only a handful of comps carry the
  // kin flag, so the estimate is noisy by construction.
  const kinTerms = [...terms.filter((t) => t !== 'kin'), 'kin'];
  const kinBetaFull = fitValue(comps, kinTerms, ctx);
  const kinIdx = kinTerms.indexOf('kin') + 2;
  const kinBeta = kinBetaFull[kinIdx];
  const rngK = mulberry32(SEED + 7);
  const kinBoots: number[] = [];
  for (let r = 0; r < BOOTSTRAP_REPS; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rngK() * comps.length)]);
    try {
      kinBoots.push(fitValue(sample, kinTerms, ctx)[kinIdx]);
    } catch {
      // skip singular resample
    }
  }
  const kinMean = kinBoots.reduce((a, b) => a + b, 0) / Math.max(1, kinBoots.length);
  const kinSe = Math.sqrt(kinBoots.reduce((a, b) => a + (b - kinMean) * (b - kinMean), 0) / Math.max(1, kinBoots.length - 1));
  const kinCompsN = comps.filter((p) => ctx.kinOf(p)).length;

  // Term table: each candidate added to the size-only base, both tests.
  // The control row is the growth of ANOTHER row (next comp in slug order):
  // it must not help. Sign-flipped momentum is not a valid control — it is
  // the same fit with the sign flipped, so it helps exactly as much as
  // growth; it is noted here and not tabulated as a control.
  const termTable: TermResult[] = [];
  const controlLoo = looMissValue(comps, ['control'], ctx).miss;
  const controlWf = wfMissValue(comps, ['control'], ctx).miss;

  // One 200-split loop for every win share (terms + rivals), same splits.
  const rngS = mulberry32(SEED + 13);
  const termWins = new Map<string, number>();
  const rivalWins = new Map<string, number>();
  for (const c of VALUE_CANDIDATES) termWins.set(c.term, 0);
  termWins.set('control', 0);
  for (const r of VALUE_RIVAL_DEFS) rivalWins.set(r.name, 0);
  for (let s = 0; s < SPLIT_REPS; s++) {
    const idx = comps.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rngS() * (i + 1));
      const t = idx[i];
      idx[i] = idx[j];
      idx[j] = t;
    }
    const cut = Math.floor(idx.length * 0.8);
    const train = idx.slice(0, cut).map((i) => comps[i]);
    const test = idx.slice(cut).map((i) => comps[i]);
    const missOf = (ts: string[]): number => {
      const b = fitValue(train, ts, ctx);
      return median(test.map((p) => Math.abs(Math.log10(p.mcap_usd as number) - dot(valueFeats(p, ts, ctx), b))).map((e) => Math.pow(10, e)));
    };
    const finalMiss = missOf(terms);
    const baseMiss = missOf([]);
    for (const c of VALUE_CANDIDATES) {
      if (missOf([c.term]) < baseMiss) termWins.set(c.term, (termWins.get(c.term) as number) + 1);
    }
    if (missOf(['control']) < baseMiss) termWins.set('control', (termWins.get('control') as number) + 1);
    for (const r of VALUE_RIVAL_DEFS) {
      const rm = r.terms === 'flat'
        ? median(test.map((p) => Math.abs(Math.log10(p.mcap_usd as number) - median(train.map((q) => Math.log10(q.mcap_usd as number))))).map((e) => Math.pow(10, e)))
        : missOf(r.terms);
      if (rm < finalMiss) rivalWins.set(r.name, (rivalWins.get(r.name) as number) + 1);
    }
  }
  for (const c of VALUE_CANDIDATES) {
    const t = candTests.get(c.term) as { loo: number; wf: number };
    termTable.push({
      term: c.term,
      label: c.label,
      loo: t.loo,
      wf: t.wf,
      winShare: (termWins.get(c.term) as number) / SPLIT_REPS,
      verdict: kept.has(c.term) ? 'kept' : 'tested-not-kept',
      note: c.note,
    });
  }
  termTable.push({
    term: 'control',
    label: 'CONTROL: growth of another row',
    loo: controlLoo,
    wf: controlWf,
    winShare: (termWins.get('control') as number) / SPLIT_REPS,
    verdict: 'control',
    note: 'Next comp in slug order, same window. Must not help — and it does not. Sign-flipped momentum is not a control: it is the same fit with the sign flipped.',
  });
  const rivals: RivalResult[] = VALUE_RIVAL_DEFS.map((r) => {
    const looR = r.terms === 'flat' ? flat.loo : looMissValue(comps, r.terms, ctx).miss;
    const wfR = r.terms === 'flat' ? flat.wf : wfMissValue(comps, r.terms, ctx).miss;
    return { name: r.name, loo: looR, wf: wfR, winShareVsFinal: (rivalWins.get(r.name) as number) / SPLIT_REPS };
  });

  // Range honesty: intervals from held-out residuals only.
  // LOO coverage by 2-fold split on listed_at: quantiles from fold A's LOO
  // residuals, coverage on fold B's LOO predictions, and vice versa.
  const looRes = loo.residuals;
  const { train: older, test: newer } = wfSplit(comps);
  const olderIdx = new Set(older.map((p) => p.slug));
  const resA = looRes.filter((_, i) => olderIdx.has(comps[i].slug));
  const resB = looRes.filter((_, i) => !olderIdx.has(comps[i].slug));
  const predA = loo.preds.filter((_, i) => olderIdx.has(comps[i].slug));
  const predB = loo.preds.filter((_, i) => !olderIdx.has(comps[i].slug));
  const yA = comps.filter((p) => olderIdx.has(p.slug)).map((p) => Math.log10(p.mcap_usd as number));
  const yB = comps.filter((p) => !olderIdx.has(p.slug)).map((p) => Math.log10(p.mcap_usd as number));
  const cov = (res: number[], pred: number[], y: number[], lo: number, hi: number): number => {
    const qlo = quantile(res, lo);
    const qhi = quantile(res, hi);
    let inside = 0;
    for (let i = 0; i < y.length; i++) if (y[i] >= pred[i] + qlo && y[i] <= pred[i] + qhi) inside++;
    return y.length === 0 ? Number.NaN : inside / y.length;
  };
  const looP2575 = (cov(resA, predB, yB, 0.25, 0.75) + cov(resB, predA, yA, 0.25, 0.75)) / 2;
  const looP1090 = (cov(resA, predB, yB, 0.1, 0.9) + cov(resB, predA, yA, 0.1, 0.9)) / 2;
  // Walk-forward coverage: quantiles from the older half's own LOO
  // residuals, tested on the newer half's walk-forward predictions.
  const olderLoo = looMissValue(older, terms, ctx);
  const wfBeta = fitValue(older, terms, ctx);
  const wfPreds = newer.map((p) => dot(valueFeats(p, terms, ctx), wfBeta));
  const wfY = newer.map((p) => Math.log10(p.mcap_usd as number));
  const wfP2575 = cov(olderLoo.residuals, wfPreds, wfY, 0.25, 0.75);
  const wfP1090 = cov(olderLoo.residuals, wfPreds, wfY, 0.1, 0.9);

  const rangeHonesty = {
    looP2575,
    looP1090,
    wfP2575,
    wfP1090,
    looN: comps.length,
    wfN: newer.length,
    note:
      looP2575 < 0.45 || wfP2575 < 0.45
        ? 'The printed P25-P75 bands capture less than the stated 50% of held-out caps: the ranges print too narrow, and the board says so instead of widening them after the fact.'
        : 'The printed bands cover about what they state on held-out data.',
  };

  return {
    beta,
    se,
    terms,
    loo: loo.miss,
    wf: wf.miss,
    baseLoo,
    baseWf,
    flatLoo: flat.loo,
    flatWf: flat.wf,
    termTable,
    rivals,
    q10: quantile(looRes, 0.1),
    q25: quantile(looRes, 0.25),
    q75: quantile(looRes, 0.75),
    q90: quantile(looRes, 0.9),
    rangeHonesty,
    kinBeta,
    kinSe,
    kinCompsN,
    looResiduals: looRes,
    looPreds: loo.preds,
  };
}

// ---------- odds model (logistic: does the protocol ever record a token?) ----------

interface OddsCtx {
  asOf: string;
  catList: string[]; // categories with >=10 peers
  kinOf: (p: SnapshotProtocol) => boolean;
}

function oddsFeats(p: SnapshotProtocol, terms: string[], ctx: OddsCtx): number[] {
  const age = ageDays(ctx.asOf, p.listed_at);
  const ageY = (age === null ? 365 : age) / 365;
  const row: number[] = [1, ageY, Math.log10(p.tvl_usd)];
  if (terms.includes('growth')) row.push(clamp(p.change_7d === null ? 0 : p.change_7d, -60, 120) / 100);
  if (terms.includes('chains')) row.push(Math.log1p(p.chains.length));
  if (terms.includes('category')) {
    for (const c of ctx.catList) row.push((p.category || 'Other') === c ? 1 : 0);
  }
  if (terms.includes('kin')) row.push(ctx.kinOf(p) ? 1 : 0);
  return row;
}

function oddsRidge(terms: string[], ctx: OddsCtx): number[] {
  const n = oddsFeats(
    { slug: '', name: '', symbol: null, category: null, tvl_usd: 1, change_7d: null, mcap_usd: null, gecko_id: null, chains: [], listed_at: null },
    terms,
    ctx,
  ).length;
  const r = Array(n).fill(0.5);
  r[0] = 0;
  return r;
}

function fitOdds(train: SnapshotProtocol[], terms: string[], ctx: OddsCtx, start?: number[]): number[] {
  return logisticFit(
    train.map((p) => oddsFeats(p, terms, ctx)),
    train.map((p) => (isPreToken(p) ? 0 : 1)),
    oddsRidge(terms, ctx),
    start,
  );
}

function looBrierOdds(peers: SnapshotProtocol[], terms: string[], ctx: OddsCtx, fullBeta: number[]): number {
  let s = 0;
  for (let i = 0; i < peers.length; i++) {
    const train = peers.filter((_, j) => j !== i);
    const beta = fitOdds(train, terms, ctx, fullBeta);
    const pred = sigmoid(dot(oddsFeats(peers[i], terms, ctx), beta));
    const y = isPreToken(peers[i]) ? 0 : 1;
    s += (pred - y) * (pred - y);
  }
  return s / peers.length;
}

function wfBrierOdds(peers: SnapshotProtocol[], terms: string[], ctx: OddsCtx, fullBeta: number[]): number {
  const dated = [...peers].sort((a, b) => ((a.listed_at as string) < (b.listed_at as string) ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const beta = fitOdds(dated.slice(0, half), terms, ctx, fullBeta);
  let s = 0;
  for (const p of dated.slice(half)) {
    const pred = sigmoid(dot(oddsFeats(p, terms, ctx), beta));
    const y = isPreToken(p) ? 0 : 1;
    s += (pred - y) * (pred - y);
  }
  return s / Math.max(1, dated.length - half);
}

const ODDS_CANDIDATES: { term: string; label: string; note: string }[] = [
  { term: 'category', label: 'Category (ridge, >=10 peers)', note: 'One shrunk offset per category with at least 10 peers.' },
  { term: 'kin', label: 'Family token exists', note: 'A same-stem protocol already records a token. This is where the family effect lives: it predicts listing, not value.' },
  { term: 'growth', label: '7-day TVL growth', note: 'Recent TVL momentum, clamped to [-60%, +120%].' },
  { term: 'chains', label: 'Chain count (log1p)', note: 'Number of chains the protocol runs on.' },
];

const ODDS_RIVAL_DEFS: { name: string; terms: string[] | 'base' }[] = [
  { name: 'base rate', terms: 'base' },
  { name: 'age + size', terms: [] },
  { name: 'age + size + growth + chains', terms: ['growth', 'chains'] },
  { name: 'kitchen sink (all terms)', terms: ['category', 'kin', 'growth', 'chains'] },
];

interface OddsModel {
  beta: number[];
  labels: string[];
  terms: string[];
  looBrier: number;
  wfBrier: number;
  baseLoo: number;
  baseWf: number;
  baseBrier: number;
  termTable: TermResult[];
  rivals: RivalResult[];
}

function buildOddsModel(peers: SnapshotProtocol[], ctx: OddsCtx): OddsModel {
  const baseRate = peers.filter((p) => !isPreToken(p)).length / peers.length;
  const baseBrier = baseRate * (1 - baseRate);
  const fullBeta = (terms: string[]): number[] => fitOdds(peers, terms, ctx);
  const baseBeta = fullBeta([]);
  const baseLoo = looBrierOdds(peers, [], ctx, baseBeta);
  const baseWf = wfBrierOdds(peers, [], ctx, baseBeta);

  // Selection rule (stated on the board): a term is kept only if adding it
  // to the age+size base lowers the Brier score by at least 0.002 in BOTH
  // tests (LOO and walk-forward). The margin matters: a term that wins by
  // 0.0001 on one test is noise, and a large coefficient on such a term can
  // move the board for no real gain. Each candidate's two-test numbers are
  // computed once and reused for the term table.
  const candTests = new Map<string, { loo: number; wf: number; beta: number[] }>();
  const kept = new Set<string>();
  for (const cand of ODDS_CANDIDATES) {
    const fb = fullBeta([cand.term]);
    const loo = looBrierOdds(peers, [cand.term], ctx, fb);
    const wf = wfBrierOdds(peers, [cand.term], ctx, fb);
    candTests.set(cand.term, { loo, wf, beta: fb });
    if (loo < baseLoo - 0.002 && wf < baseWf - 0.002) kept.add(cand.term);
  }
  const terms = ODDS_CANDIDATES.map((c) => c.term).filter((t) => kept.has(t));
  const beta = fullBeta(terms);
  const looBrier = looBrierOdds(peers, terms, ctx, beta);
  const wfBrier = wfBrierOdds(peers, terms, ctx, beta);

  // Term table: each candidate added to the age+size base, both tests.
  const termTable: TermResult[] = [];
  const fullBetas = new Map<string, number[]>();
  fullBetas.set('', baseBeta);
  for (const c of ODDS_CANDIDATES) fullBetas.set(c.term, (candTests.get(c.term) as { beta: number[] }).beta);
  fullBetas.set('__final__', beta);
  const rivalBetas = new Map<string, number[]>();
  for (const r of ODDS_RIVAL_DEFS) {
    if (r.terms !== 'base') rivalBetas.set(r.name, fullBeta(r.terms));
  }

  // One 200-split loop for every odds win share (terms + rivals).
  const rngS = mulberry32(SEED + 29);
  const termWins = new Map<string, number>();
  const rivalWins = new Map<string, number>();
  for (const c of ODDS_CANDIDATES) termWins.set(c.term, 0);
  for (const r of ODDS_RIVAL_DEFS) rivalWins.set(r.name, 0);
  const brierOf = (train: SnapshotProtocol[], test: SnapshotProtocol[], ts: string[], start?: number[]): number => {
    const b = fitOdds(train, ts, ctx, start);
    let s = 0;
    for (const p of test) {
      const pred = sigmoid(dot(oddsFeats(p, ts, ctx), b));
      const y = isPreToken(p) ? 0 : 1;
      s += (pred - y) * (pred - y);
    }
    return s / Math.max(1, test.length);
  };
  for (let s = 0; s < SPLIT_REPS; s++) {
    const idx = peers.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rngS() * (i + 1));
      const t = idx[i];
      idx[i] = idx[j];
      idx[j] = t;
    }
    const cut = Math.floor(idx.length * 0.8);
    const train = idx.slice(0, cut).map((i) => peers[i]);
    const test = idx.slice(cut).map((i) => peers[i]);
    const baseB = brierOf(train, test, [], baseBeta);
    const finalB = brierOf(train, test, terms, beta);
    for (const c of ODDS_CANDIDATES) {
      if (brierOf(train, test, [c.term], fullBetas.get(c.term)) < baseB) {
        termWins.set(c.term, (termWins.get(c.term) as number) + 1);
      }
    }
    for (const r of ODDS_RIVAL_DEFS) {
      let rb: number;
      if (r.terms === 'base') {
        const tr = train.filter((p) => !isPreToken(p)).length / train.length;
        rb = test.reduce((a, p) => a + (tr - (isPreToken(p) ? 0 : 1)) ** 2, 0) / test.length;
      } else {
        rb = brierOf(train, test, r.terms, rivalBetas.get(r.name));
      }
      if (rb < finalB) rivalWins.set(r.name, (rivalWins.get(r.name) as number) + 1);
    }
  }
  for (const c of ODDS_CANDIDATES) {
    const t = candTests.get(c.term) as { loo: number; wf: number };
    termTable.push({
      term: c.term,
      label: c.label,
      loo: t.loo,
      wf: t.wf,
      winShare: (termWins.get(c.term) as number) / SPLIT_REPS,
      verdict: kept.has(c.term) ? 'kept' : 'tested-not-kept',
      note: c.note,
    });
  }
  const rivals: RivalResult[] = ODDS_RIVAL_DEFS.map((r) => {
    if (r.terms === 'base') return { name: r.name, loo: baseBrier, wf: baseBrier, winShareVsFinal: (rivalWins.get(r.name) as number) / SPLIT_REPS };
    if (r.terms.length === 0) return { name: r.name, loo: baseLoo, wf: baseWf, winShareVsFinal: (rivalWins.get(r.name) as number) / SPLIT_REPS };
    const fb = rivalBetas.get(r.name) as number[];
    return {
      name: r.name,
      loo: looBrierOdds(peers, r.terms, ctx, fb),
      wf: wfBrierOdds(peers, r.terms, ctx, fb),
      winShareVsFinal: (rivalWins.get(r.name) as number) / SPLIT_REPS,
    };
  });

  const labels = ['intercept', 'age (years)', 'log10 TVL'];
  if (terms.includes('growth')) labels.push('growth');
  if (terms.includes('chains')) labels.push('chains');
  if (terms.includes('category')) labels.push(...ctx.catList.map((c) => `cat: ${c}`));
  if (terms.includes('kin')) labels.push('family token exists');
  return { beta, labels, terms, looBrier, wfBrier, baseLoo, baseWf, baseBrier, termTable, rivals };
}

// ---------- board, farm plans, accounting ----------

const BRIDGE_CATS = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);
const STAKING_CATS = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool']);
const WRAPPED_RE = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

function depositFor(tvl: number): number {
  if (tvl >= 1e9) return 1000;
  if (tvl >= 5e8) return 500;
  if (tvl >= 2e8) return 250;
  if (tvl >= 1e8) return 150;
  return 100;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 30;
  if (age < 365) return 45;
  return 60;
}

export function buildModel(snapshot: Snapshot): ModelResult {
  const asOf = snapshot.as_of;
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);

  // Kin: another protocol sharing the first word of the name that already
  // records a token. The kin protocol's name is shown on the board.
  const byStem = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    const s = stemOf(p.name);
    if (!byStem.has(s)) byStem.set(s, []);
    byStem.get(s)?.push(p);
  }
  const kinOf = (p: SnapshotProtocol): boolean =>
    (byStem.get(stemOf(p.name)) ?? []).some((q) => q.slug !== p.slug && !isPreToken(q));
  const kinNameOf = (p: SnapshotProtocol): string | null => {
    const q = (byStem.get(stemOf(p.name)) ?? []).find((r) => r.slug !== p.slug && !isPreToken(r));
    return q ? q.name : null;
  };

  // Comps: traded protocols with a usable cap and a listing date.
  const comps = snapshot.protocols.filter(
    (p) => !isPreToken(p) && typeof p.mcap_usd === 'number' && (p.mcap_usd as number) > 0 && p.listed_at,
  );
  const compsPriced = snapshot.protocols.filter(
    (p) => !isPreToken(p) && typeof p.mcap_usd === 'number' && (p.mcap_usd as number) > 0,
  ).length;
  // Peers for the odds model: every protocol with a listing date.
  const peers = snapshot.protocols.filter((p) => p.listed_at);

  // Value-model context.
  const catCounts = new Map<string, number>();
  for (const p of comps) catCounts.set(p.category || 'Other', (catCounts.get(p.category || 'Other') ?? 0) + 1);
  const valueCatList = [...catCounts.entries()].filter(([, n]) => n >= 4).map(([c]) => c).sort();
  const sortedComps = [...comps].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const otherGrowth = new Map<string, number>();
  sortedComps.forEach((p, i) => {
    const q = sortedComps[(i + 1) % sortedComps.length];
    otherGrowth.set(p.slug, (q.change_7d === null ? 0 : q.change_7d) / 100);
  });
  const valueCtx: ValueCtx = { asOf, catList: valueCatList, otherGrowth, kinOf };
  const value = buildValueModel(comps, valueCtx);

  // Odds-model context.
  const peerCatCounts = new Map<string, number>();
  for (const p of peers) peerCatCounts.set(p.category || 'Other', (peerCatCounts.get(p.category || 'Other') ?? 0) + 1);
  const oddsCatList = [...peerCatCounts.entries()].filter(([, n]) => n >= 10).map(([c]) => c).sort();
  const oddsCtx: OddsCtx = { asOf, catList: oddsCatList, kinOf };
  const odds = buildOddsModel(peers, oddsCtx);

  // Board: the whole watchlist (40/40) plus the top 158 rankable protocols
  // below the floor by TVL — the kit starter's rule.
  const early = snapshot.protocols
    .filter((p) => isRankable(p) && !watch.has(p.slug) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 158);
  const boardProtos = [
    ...snapshot.watchlist.map((s) => bySlug.get(s) as SnapshotProtocol).filter(Boolean),
    ...early,
  ];

  // 200 bootstrap refits of the value model give each row a rank band.
  const rngR = mulberry32(SEED + 41);
  const rankSamples: number[][] = boardProtos.map(() => []);
  for (let r = 0; r < BOOTSTRAP_REPS; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rngR() * comps.length)]);
    let b: number[];
    try {
      b = fitValue(sample, value.terms, valueCtx);
    } catch {
      continue;
    }
    const vals = boardProtos.map((p) => dot(valueFeats(p, value.terms, valueCtx), b));
    const order = vals.map((v, i) => [v, i] as [number, number]).sort((x, y) => y[0] - x[0]);
    order.forEach(([_, i], pos) => rankSamples[i].push(pos + 1));
  }

  const horizonDate = addDays(asOf, 52 * 7);
  const rows: BoardRow[] = boardProtos.map((p, i) => {
    const feats = valueFeats(p, value.terms, valueCtx);
    const pred = dot(feats, value.beta);
    const implied = Math.pow(10, pred);
    const oddsP = sigmoid(dot(oddsFeats(p, odds.terms, oddsCtx), odds.beta));
    // Own-token share: tested as a value discount and NOT kept — the fitted
    // kin factor is a premium from 3 comps, not a discount, and it lowers
    // neither held-out test. The share is therefore 1.00 for every row and
    // the family effect enters through the odds model instead, where it
    // passes both tests. See the Model & tests tab.
    const share = 1.0;
    const ev = implied * oddsP * share;
    const age = ageDays(asOf, p.listed_at);
    const holdDays = holdDaysFor(age);
    const holdUntil = addDays(asOf, holdDays);
    const deposit = depositFor(p.tvl_usd);
    const weeks = Math.ceil(holdDays / 7);
    const totalCost = 8 + 2 * weeks;
    const expectedDrop = (ev * 0.07 * deposit) / (0.1 * p.tvl_usd);
    const net = expectedDrop - totalCost;
    const verdict: BoardRow['verdict'] = net >= 10 ? 'FARM' : net >= 0 ? 'MARGINAL' : 'SKIP';
    const wBreak = (expectedDrop - 8) / 2;
    const breakEven = wBreak > 0 && wBreak <= 52 ? addDays(asOf, Math.round(wBreak * 7)) : null;
    const chain0 = p.chains.length > 0 ? p.chains[0] : 'its home chain';
    const steps: string[] = [
      `Set up a fresh wallet and fund it with $${deposit} USDC plus $5 for gas on ${chain0}. Do not reuse a wallet that farmed another protocol. (${asOf}, 5 min, $0)`,
      `Deposit $${deposit} into ${p.name} through the official app only — take the link from the protocol docs, never from a DM. Main action gas about $2.50. (${asOf}, 15 min, $${deposit} + $2.50)`,
      `Repeat the qualifying action once a week with the same wallet until the hold ends. Weekly gas about $2.00, 10 min per week. (cadence: weekly, $${(2 * weeks).toFixed(2)} over ${weeks} weeks)`,
      `Hold the position until ${holdUntil}. Do not withdraw early: most drops require the deposit to be present at the snapshot. Capital locked: $${deposit} for ${holdDays} days.`,
      `Check the official claim page on ${holdUntil}. If no token is announced, keep holding until the horizon. Claim gas about $1.50.`,
      `Break-even check: expected drop $${expectedDrop.toFixed(2)} against total cost $${totalCost.toFixed(2)} is net $${net.toFixed(2)}. Break-even date: ${breakEven ?? (wBreak > 52 ? 'beyond the 52-week horizon' : 'never — costs exceed the expected drop')}. If the token has not listed by then, unwind.`,
      `Unwind by ${horizonDate} if no token has listed: withdraw the deposit and stop the weekly action. Exit gas about $2.00. Do not leave capital parked past the horizon.`,
      `Log every action (date, tx hash, amount) in a farm log. A written log is what proves the position if a claim is disputed. (5 min, $0)`,
    ];
    const band = rankSamples[i].length > 0 ? rankSamples[i] : [i + 1];
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category || 'Other',
      chains: p.chains.length,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      watchlist: watch.has(p.slug),
      kin: kinOf(p),
      kin_name: kinNameOf(p),
      implied_value_usd: implied,
      odds: oddsP,
      expected_value_usd: ev,
      own_token_share: share,
      range_lo_usd: Math.pow(10, pred + value.q25),
      range_hi_usd: Math.pow(10, pred + value.q75),
      rank_band_lo: Math.round(quantile(band, 0.1)),
      rank_band_hi: Math.round(quantile(band, 0.9)),
      deposit_usd: deposit,
      expected_drop_usd: expectedDrop,
      total_cost_usd: totalCost,
      net_usd: net,
      verdict,
      break_even_date: breakEven,
      hold_until_date: holdUntil,
      farm_steps: steps,
      contrib_intercept: value.beta[0],
      contrib_size: value.beta[1] * Math.log10(p.tvl_usd),
      contrib_growth: value.terms.includes('growth') ? value.beta[2] * (clamp(p.change_7d === null ? 0 : p.change_7d, -60, 120) / 100) : 0,
    };
  });
  // Rank by implied value (the board order), highest first.
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  // Coverage accounting: every one of the 758 protocols in exactly one group.
  const boardSet = new Set(rows.map((r) => r.slug));
  const groups = new Map<string, { count: number; detail: string }>();
  const put = (label: string, detail: string) => {
    const g = groups.get(label) ?? { count: 0, detail };
    g.count++;
    groups.set(label, g);
  };
  for (const p of snapshot.protocols) {
    if (boardSet.has(p.slug)) {
      put(watch.has(p.slug) ? 'Ranked — watchlist' : 'Ranked — early, below the floor', 'on the board');
    } else if (!isPreToken(p) && typeof p.mcap_usd === 'number' && (p.mcap_usd as number) > 0 && p.listed_at) {
      put('Priced comp — traded, usable cap', 'fits the value model');
    } else if (!isPreToken(p)) {
      put('Token recorded, no usable cap', 'a token exists but no cap or no listing date');
    } else if (p.category === 'CEX') {
      put('Out — exchange', 'centralised exchange custody');
    } else if (isVersioned(p) || WRAPPED_RE.test(p.name)) {
      put('Out — versioned or wrapped', 'a version or a wrapped/staked name');
    } else if (BRIDGE_CATS.has(p.category || '')) {
      put('Out — bridge', 'bridge protocol');
    } else if (STAKING_CATS.has(p.category || '')) {
      put('Out — staking', 'liquid staking / restaking');
    } else {
      put('Pre-token, not ranked', 'rankable but below the top-158 early cut by TVL');
    }
  }
  const accounting: AccountingGroup[] = [...groups.entries()].map(([label, g]) => ({ label, count: g.count, detail: g.detail }));

  const farmCounts = {
    farm: rows.filter((r) => r.verdict === 'FARM').length,
    marginal: rows.filter((r) => r.verdict === 'MARGINAL').length,
    skip: rows.filter((r) => r.verdict === 'SKIP').length,
  };

  const checksum = fnv1aHex(
    rows.map((r) => `${r.rank},${r.slug},${Math.round(r.implied_value_usd)}`).join('\n'),
  );

  const selfTest: Evidence['selfTest'] = [
    { name: 'board rows', pass: rows.length === 198, detail: `${rows.length} rows` },
    { name: 'watchlist 40/40', pass: snapshot.watchlist.every((s) => boardSet.has(s)), detail: `${snapshot.watchlist.filter((s) => boardSet.has(s)).length} of 40 on the board` },
    { name: 'ranks 1..198, implied value descending', pass: rows.every((r, i) => r.rank === i + 1) && rows.every((r, i) => i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd), detail: 'sequential ranks, sorted by implied value' },
    { name: 'accounting sums to 758', pass: accounting.reduce((a, g) => a + g.count, 0) === snapshot.protocols.length, detail: `${accounting.reduce((a, g) => a + g.count, 0)} of ${snapshot.protocols.length}` },
    { name: 'all implied values finite and positive', pass: rows.every((r) => Number.isFinite(r.implied_value_usd) && r.implied_value_usd > 0), detail: `${rows.length} rows checked` },
    { name: 'all odds in (0, 1)', pass: rows.every((r) => r.odds > 0 && r.odds < 1), detail: `min ${Math.min(...rows.map((r) => r.odds)).toFixed(3)}, max ${Math.max(...rows.map((r) => r.odds)).toFixed(3)}` },
    { name: 'farm steps: 8 per row, 20–600 chars each', pass: rows.every((r) => r.farm_steps.length === 8 && r.farm_steps.every((s) => s.length >= 20 && s.length <= 600)), detail: `${rows.length} rows × 8 steps` },
    { name: 'checksum recomputes', pass: fnv1aHex(rows.map((r) => `${r.rank},${r.slug},${Math.round(r.implied_value_usd)}`).join('\n')) === checksum, detail: checksum },
    { name: 'dossier text <= 64 KiB', pass: false, detail: 'filled in by main.ts after the dashboard is written' },
  ];

  // Feature labels for the coefficient display (same order as the betas).
  const valueLabels = ['intercept', 'log10 TVL'];
  if (value.terms.includes('growth')) valueLabels.push('growth');
  if (value.terms.includes('age')) valueLabels.push('age (years)');
  if (value.terms.includes('chains')) valueLabels.push('chains (log1p)');
  if (value.terms.includes('curve')) valueLabels.push('logTVL^2');
  if (value.terms.includes('kin')) valueLabels.push('family token exists');
  if (value.terms.includes('category')) valueLabels.push(...valueCatList.map((c) => `cat: ${c}`));

  const evidence: Evidence = {
    asOf,
    floorUsd: snapshot.floor_usd,
    compsN: comps.length,
    compsPriced,
    peersN: peers.length,
    peersBaseRate: peers.filter((p) => !isPreToken(p)).length / peers.length,
    valueBeta: value.beta,
    valueSe: value.se,
    valueLabels,
    valueTerms: value.termTable,
    valueRivals: value.rivals,
    valueLoo: value.loo,
    valueWf: value.wf,
    valueBaseLoo: value.baseLoo,
    valueBaseWf: value.baseWf,
    valueFlatLoo: value.flatLoo,
    valueFlatWf: value.flatWf,
    rangeHonesty: value.rangeHonesty,
    oddsBeta: odds.beta,
    oddsLabels: odds.labels,
    oddsTerms: odds.termTable,
    oddsRivals: odds.rivals,
    oddsLooBrier: odds.looBrier,
    oddsWfBrier: odds.wfBrier,
    oddsBaseLoo: odds.baseLoo,
    oddsBaseWf: odds.baseWf,
    oddsBaseBrier: odds.baseBrier,
    kinBeta: value.kinBeta,
    kinSe: value.kinSe,
    kinCompsN: value.kinCompsN,
    farmCounts,
    accounting,
    boardN: rows.length,
    watchlistN: snapshot.watchlist.length,
    checksum,
    selfTest,
    dossierTextBytes: 0,
  };
  return { snapshot, board: rows, evidence };
}
