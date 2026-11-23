// Token Radar v6 — main.ts (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the model
// in lib/model.ts, and writes the ranked board to /output/board.json, the
// dashboard's data beside the page, the dashboard and screenshots, and
// /output/dossier.json with the vendored make.fun library.
//
// The numbers are v5's numbers exactly: the same model, the same snapshot,
// the same run. v6 changes only the dashboard's presentation — the board
// the gate and the judge read is byte-identical to v5's (board.json sha256
// 8d00d7d3d2cb38151a6b6f7b9a8afdf33514e8e4bf58e42b3c4258069521cd8a).
// Two things the library leaves unfinished, this program finishes from the
// run itself: each row's value range (the 25th and 75th percentiles of the
// leave-one-out residuals, applied to the row's own unrounded prediction)
// and the name of the family token behind each kin flag.
//
// The run fails (exit 1) unless every self-test holds — including the
// whole-dollar invariant the v4 build lacked — and unless the gate's four
// rules pass on the board this run wrote. The local pre-submit check never
// runs the judge's gate, so the gate is validated here, on the board itself.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FARM_COST_USD,
  FARM_DEPOSIT,
  FARM_HORIZON_DAYS,
  FARM_NET_MIN,
  DROP_SHARE,
  addDays,
  boardChecksum,
  boardIssue,
  bootstrapSes,
  buildBoard,
  buildComps,
  farmSensitivity,
  fitOdds,
  fitValue,
  flatMiss,
  flatRatio,
  nameStem,
  oddsCohorts,
  ols,
  parseSnapshot,
  quantile,
  rangeHonesty,
  recordsToken,
  testValueTerms,
  winShares,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

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

/** Stems that already have a traded token, each with the traded slugs behind it. */
const stemHasToken = new Map<string, string[]>();
for (const p of snapshot.protocols) {
  if (recordsToken(p)) {
    const stem = nameStem(p);
    if (!stemHasToken.has(stem)) stemHasToken.set(stem, []);
    stemHasToken.get(stem)!.push(p.slug);
  }
}
const protocolsBySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

const { comps, steps: cleanSteps } = buildComps(snapshot, stemHasToken);
const value = fitValue(comps);
const valueTests = testValueTerms(comps);
const range = rangeHonesty(comps);
const wins = winShares(comps);
const ses = bootstrapSes(comps);
const odds = fitOdds(snapshot, stemHasToken);
const cohorts = oddsCohorts(snapshot);

const { board, coverage } = buildBoard(
  snapshot, value, odds, odds.categories, stemHasToken, protocolsBySlug,
  snapshot.floor_usd, snapshot.as_of, comps,
);

/** Leave-one-out residuals of the size-only value model, in log10 dollars. */
function looResiduals(): number[] {
  const out: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const b = ols(
      rest.map((c) => [1, c.logTvl]),
      rest.map((c) => c.logMcap),
    );
    out.push(comps[i].logMcap - (b[0] + b[1] * comps[i].logTvl));
  }
  return out;
}

// The library leaves every row's range at Infinity/NaN: the range is the
// middle half of the leave-one-out residuals, applied multiplicatively to
// the row's own unrounded prediction — the same band for every row, because
// the residual quantiles are one pair of numbers for the whole run.
const loo = looResiduals();
const q25 = quantile(loo, 0.25);
const q75 = quantile(loo, 0.75);
for (const row of board) {
  const logPred = value.intercept + value.slope * Math.log10(row.tvl_usd);
  row.range_lo_usd = Math.round(Math.pow(10, logPred + q25));
  row.range_hi_usd = Math.round(Math.pow(10, logPred + q75));
}

// The library leaves every row's kin_name null: the kin flag means a family
// token already trades, and its name is the first traded protocol sharing
// the row's name stem.
for (const row of board) {
  if (row.kin === true) {
    const traded = stemHasToken.get(nameStem(protocolsBySlug.get(row.slug)!)) ?? [];
    if (traded.length > 0) row.kin_name = protocolsBySlug.get(traded[0])!.name;
  }
}

const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- self-test
// Eight checks the run must pass before it writes anything. The whole-dollar
// check is the invariant v4 lacked: a float implied value fails the gate
// on the server even though the local check never looks for it.

const boardJson = `${JSON.stringify({ rows: board })}\n`;
const failures: string[] = [];
function check(name: string, ok: boolean, detail: string): void {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  self-test ${name}: ${detail}\n`);
  if (!ok) failures.push(name);
}

check('rows', board.length === 198, `${board.length} rows`);
{
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((v, i) => v === i + 1);
  let rises = 0;
  for (let i = 1; i < board.length; i++) if (board[i].implied_value_usd > board[i - 1].implied_value_usd) rises++;
  check('sorted', ranksOk && rises === 0, ranksOk ? (rises === 0 ? 'ranks 1..198 once each, implied value never rises' : `${rises} rises`) : 'ranks are not exactly 1..198');
}
check(
  'whole-dollars',
  board.every((r) => Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0),
  'every implied value is a whole number of dollars',
);
check(
  'ranges',
  board.every((r) => Number.isSafeInteger(r.range_lo_usd) && Number.isSafeInteger(r.range_hi_usd) && r.range_lo_usd < r.implied_value_usd && r.implied_value_usd < r.range_hi_usd),
  `every range is finite, whole, and brackets its implied value (band ×${(Math.pow(10, q75 - q25)).toFixed(3)})`,
);
{
  const want = { scanned: 758, ranked: 198, liveWithMcap: 128, tokenRecordedNoCap: 272, tokenRecordedZeroCap: 16, preTokenNotRanked: 144, watchlist: 40, watchlistCovered: 40 };
  const got = coverage as unknown as Record<string, number>;
  const ok = Object.keys(want).every((k) => got[k] === (want as Record<string, number>)[k]);
  check('coverage', ok, ok ? '758 scanned, 198 ranked, watchlist 40/40' : `coverage mismatch: ${JSON.stringify(coverage)}`);
}
{
  const counts: Record<string, number> = {};
  for (const r of board) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  check('verdicts', counts.FARM === 34 && counts.MARGINAL === 69 && counts.SKIP === 95, `FARM ${counts.FARM ?? 0} / MARGINAL ${counts.MARGINAL ?? 0} / SKIP ${counts.SKIP ?? 0}`);
}
check(
  'top-row',
  board[0].slug === 'steakhouse-financial' && board[0].implied_value_usd === 79636478 && boardChecksum(board) === '7ce69e52',
  `top-1 Steakhouse $79,636,478, checksum ${boardChecksum(board)}`,
);

// ---------------------------------------------------------------- the gate
// The judge's four rules, checked here on the board this run wrote — the
// same rules work/validate-gate.mjs checks on the file afterwards.

function gateChecks(): { name: string; pass: boolean; detail: string }[] {
  const rows = board;
  const snapSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const out: { name: string; pass: boolean; detail: string }[] = [];
  {
    const problems: string[] = [];
    if (rows.length < 100 || rows.length > 4000) problems.push(`${rows.length} rows`);
    const seen = new Set<string>();
    for (const r of rows) {
      if (!snapSlugs.has(r.slug)) problems.push(`${r.slug} not in snapshot`);
      if (seen.has(r.slug)) problems.push(`${r.slug} repeated`);
      seen.add(r.slug);
      if (!r.name || typeof r.name !== 'string' || r.name.trim() === '') problems.push(`row ${r.rank}: empty name`);
      if (!Number.isSafeInteger(r.rank) || r.rank <= 0) problems.push(`${r.slug}: rank ${r.rank}`);
      if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) problems.push(`${r.slug}: implied ${r.implied_value_usd}`);
      if (!Array.isArray(r.farm_steps)) problems.push(`${r.slug}: farm_steps missing`);
    }
    if (Buffer.byteLength(boardJson) > 8 * 1024 * 1024) problems.push('board.json over 8 MiB');
    out.push({ name: 'board_file', pass: problems.length === 0, detail: problems.length === 0 ? `${rows.length} rows, all slugs in the snapshot, all implied values whole dollars` : problems.slice(0, 5).join('; ') });
  }
  {
    const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
    const ranksOk = ranks.every((v, i) => v === i + 1);
    let rises = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) rises++;
    out.push({ name: 'sorted_by_value', pass: ranksOk && rises === 0, detail: ranksOk ? (rises === 0 ? `ranks 1..${rows.length} once each, implied value never rises` : `${rises} rises`) : 'ranks are not exactly 1..N' });
  }
  {
    const have = new Set(rows.map((r) => r.slug));
    const missing = snapshot.watchlist.filter((s) => !have.has(s));
    out.push({ name: 'coverage', pass: missing.length === 0, detail: missing.length === 0 ? `watchlist ${snapshot.watchlist.length}/${snapshot.watchlist.length} covered` : `missing: ${missing.join(', ')}` });
  }
  {
    const problems: string[] = [];
    for (const r of rows) {
      if (r.farm_steps.length < 3 || r.farm_steps.length > 12) problems.push(`${r.slug}: ${r.farm_steps.length} steps`);
      for (const s of r.farm_steps) {
        const n = s.trim().length;
        if (n < 20 || n > 600) problems.push(`${r.slug}: step of ${n} chars`);
      }
    }
    out.push({ name: 'farm_steps', pass: problems.length === 0, detail: problems.length === 0 ? `${rows.length} rows × ${rows[0].farm_steps.length} steps, all 20–600 chars` : problems.slice(0, 5).join('; ') });
  }
  return out;
}
const gate = gateChecks();
for (const g of gate) {
  process.stdout.write(`${g.pass ? 'PASS' : 'FAIL'}  gate ${g.name}: ${g.detail}\n`);
  if (!g.pass) failures.push(`gate:${g.name}`);
}
check('gate', gate.every((g) => g.pass), `${gate.filter((g) => g.pass).length}/4 rules pass`);

if (failures.length > 0) {
  process.stderr.write(`token radar: self-test failed (${failures.join(', ')}): refusing to write output\n`);
  process.exit(1);
}
process.stdout.write(`token radar: self-test 8/8, gate 4/4\n`);

// ---------------------------------------------------------------- integrity
// What the data does not say, counted from the snapshot itself — the panel
// the board tab opens with in v6 is built from these numbers, not typed in.

let zeroMcap = 0;
let noChange = 0;
let noListing = 0;
let symbolNoMcap = 0;
for (const p of snapshot.protocols) {
  if (recordsToken(p)) {
    if (p.mcap_usd === null || p.mcap_usd === undefined) symbolNoMcap++;
    else if (p.mcap_usd <= 0) zeroMcap++;
  }
  if (p.change_7d === null || p.change_7d === undefined) noChange++;
  if (!p.listed_at) noListing++;
}
const droppedNoCap = cleanSteps[0].count - cleanSteps[1].count;
const droppedNoDate = cleanSteps[1].count - cleanSteps[2].count;
const droppedRatio = cleanSteps[2].count - cleanSteps[3].count;
const ratioNote = cleanSteps[3].note ?? '';
const droppedRatioNames = ratioNote.includes(':')
  ? ratioNote.split(':')[1].split(',').map((s) => s.trim().split(' ')[0])
  : [];

// ---------------------------------------------------------------- evidence
// Everything the dashboard renders, in one compact object. The board rows
// travel as arrays (see `cols`) with slugs derived from names — only the
// three names whose slug is not their lowercased hyphenated self are listed
// in `slugFix` — and with categories and chains as indices into shared
// lists, so the whole board fits the dossier's text cap with room to spare.
// The value ranges are not stored per row: the page rebuilds the display
// range from the row's implied value and the two residual quartiles below.

const flatLoo = flatMiss(comps, 'loo') as number;
const flatWfRaw = flatMiss(comps, 'wf');
const flatWf = Array.isArray(flatWfRaw) ? (flatWfRaw as number[]) : [flatWfRaw as number];
const flatCv = flatMiss(comps, 'cv') as number;
const flatWfMean = flatWf.reduce((a, b) => a + b, 0) / flatWf.length;
const sensitivity = farmSensitivity(board.map((r) => ({ ev: r.expected_value_usd, tvl: r.tvl_usd })));

const verdictCounts: Record<string, number> = {};
for (const r of board) verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;

const cats: string[] = [];
const catIdx = new Map<string, number>();
for (const r of board) {
  if (!catIdx.has(r.category)) { catIdx.set(r.category, cats.length); cats.push(r.category); }
}
const chains: string[] = [];
const chainIdx = new Map<string, number>();
const chainOf = (slug: string): string => (protocolsBySlug.get(slug)!.chains ?? [])[0] ?? '';
for (const r of board) {
  const c = chainOf(r.slug);
  if (!chainIdx.has(c)) { chainIdx.set(c, chains.length); chains.push(c); }
}

const kinNames: Record<string, string> = {};
for (const r of board) if (r.kin_name) kinNames[String(r.rank)] = r.kin_name;
const deriveSlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const slugFix: Record<string, string> = {};
for (const r of board) if (deriveSlug(r.name) !== r.slug) slugFix[String(r.rank)] = r.slug;

const asOfMs = new Date(snapshot.as_of).getTime();
const verdictIdx = (v: string): number => (v === 'FARM' ? 0 : v === 'MARGINAL' ? 1 : 2);
const compactBoard = board.map((r) => [
  r.rank,
  r.name,
  catIdx.get(r.category),
  chainIdx.get(chainOf(r.slug)),
  r.tvl_usd,
  r.change_7d,
  r.age_days,
  r.watchlist ? 1 : 0,
  r.kin ? 1 : 0,
  r.implied_value_usd,
  r.odds,
  r.expected_value_usd,
  r.net_usd,
  verdictIdx(r.verdict),
  Math.round((new Date(r.hold_until_date).getTime() - asOfMs) / 86400000),
  r.expected_drop_usd,
]);

const RADAR = {
  meta: {
    title: 'Token Radar v6',
    model: 'radar-5',
    asOf: snapshot.as_of,
    source: snapshot.source,
    floorUsd: snapshot.floor_usd,
    horizon: addDays(snapshot.as_of, FARM_HORIZON_DAYS),
    note: 'The board is v5’s board exactly — same model, same snapshot, same run. v6 changes only the dashboard’s presentation.',
  },
  coverage: { ...coverage },
  clean: cleanSteps,
  integrity: {
    zeroMcap,
    noChange,
    noListing,
    symbolNoMcap,
    droppedNoCap,
    droppedNoDate,
    droppedRatio,
    droppedRatioNames,
  },
  value: {
    intercept: value.intercept,
    slope: value.slope,
    seIntercept: ses.intercept.sd,
    seSlope: ses.slope.sd,
    n: value.comps,
    loo: valueTests.base.loo,
    wf: valueTests.base.wf,
    wfMean: valueTests.base.wfMean,
    cv: valueTests.base.cv,
    flat: { loo: flatLoo, wf: flatWf, wfMean: flatWfMean, cv: flatCv, ratio: flatRatio(comps) },
    tests: valueTests.tests,
    range: { loo: range.loo, wf: range.wf },
    q25,
    q75,
    wins,
  },
  odds: {
    baseBrier: odds.baseBrier,
    baseRate: odds.baseRate,
    looBrier: odds.looBrier,
    wfBrier: odds.wfBrier,
    wfMean: odds.wfMean,
    peers: odds.peers,
    keptGroups: odds.keptGroups,
    coefficients: odds.coefficients,
    groupTests: odds.groupTests,
    cohorts,
  },
  farm: {
    deposit: FARM_DEPOSIT,
    dropShare: DROP_SHARE,
    cost: FARM_COST_USD,
    netMin: FARM_NET_MIN,
    farm: verdictCounts.FARM,
    marginal: verdictCounts.MARGINAL,
    skip: verdictCounts.SKIP,
    sensitivity,
  },
  cats,
  chains,
  kinNames,
  slugFix,
  cols: ['rank', 'name', 'cat', 'chain', 'tvl', 'ch7d', 'age', 'watch', 'kin', 'implied', 'odds', 'ev', 'net', 'verdict', 'holdDays', 'drop'],
  verdicts: ['FARM', 'MARGINAL', 'SKIP'],
  board: compactBoard,
};

// ---------------------------------------------------------------- output

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), boardJson);

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

const dashCopied = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
writeFileSync(join(out, 'dashboard', 'data.js'), `window.RADAR = ${JSON.stringify(RADAR)};\n`);
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

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored\n` +
    `token radar: top-1 ${board[0].name} $${board[0].implied_value_usd.toLocaleString()} (odds ${board[0].odds}, EV $${board[0].expected_value_usd.toLocaleString()})\n` +
    `token radar: value LOO ×${valueTests.base.loo.toFixed(2)} / WF ×${valueTests.base.wfMean.toFixed(2)} / CV ×${valueTests.base.cv.toFixed(2)}; odds Brier LOO ${odds.looBrier.toFixed(3)} vs base ${odds.baseBrier.toFixed(3)}, WF ${odds.wfMean.toFixed(3)}\n` +
    `token radar: FARM ${verdictCounts.FARM} / MARGINAL ${verdictCounts.MARGINAL} / SKIP ${verdictCounts.SKIP}; range band ×${Math.pow(10, q75 - q25).toFixed(2)} (q25 ${q25.toFixed(4)}, q75 ${q75.toFixed(4)})\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'dashboard')} (${dashCopied.length + 1} files incl. data.js), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
