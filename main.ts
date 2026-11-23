// Token Radar v5 — main.ts (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the model in
// lib/model.ts, writes the ranked board to /output/board.json, and copies this
// repository's dashboard/ and screenshots/ to /output. Last, it writes
// /output/dossier.json with the vendored make.fun library.
//
// The run fails (exit 1) unless every self-test holds — including the v5
// invariant the v4 build lacked: every implied value is a whole number of
// dollars. The local pre-submit check never runs the judge's gate, so the
// gate's four rules are validated here, on the board this run wrote.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boardChecksum,
  boardIssue,
  bootstrapSes,
  buildBoard,
  buildComps,
  dataScript,
  farmSensitivity,
  fitOdds,
  fitValue,
  flatMiss,
  isPreToken,
  nameStem,
  ols,
  parseSnapshot,
  quantile,
  rangeHonesty,
  recordsToken,
  testValueTerms,
  valueDesign,
  winShares,
} from './lib/model.ts';
import type { Evidence, Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MODEL_VERSION = 'radar-5';

/** Fail the run with a message on stderr. */
function fail(message: string): never {
  process.stderr.write(`token radar v5: ${message}\n`);
  process.exit(1);
}

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot: Snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

// Family stems: which stems already record a token, and the token's name (for kin_name).
const stemHasToken = new Map<string, string[]>();
const stemName = new Map<string, string>();
for (const p of snapshot.protocols) {
  if (!recordsToken(p)) continue;
  const stem = nameStem(p);
  if (!stemHasToken.has(stem)) stemHasToken.set(stem, []);
  stemHasToken.get(stem)!.push(p.slug);
  if (!stemName.has(stem)) stemName.set(stem, p.name);
}

// ---- value model: fit + held-out validation, all from this run's numbers ----
const { comps, steps: cleaning } = buildComps(snapshot, stemHasToken);
const value = fitValue(comps);
const termTests = testValueTerms(comps);
const honesty = rangeHonesty(comps);
const shares = winShares(comps);
const ses = bootstrapSes(comps);
const flatLoo = flatMiss(comps, 'loo') as number;
const flatWf = flatMiss(comps, 'wf') as number[];
const flatWfMean = flatWf.reduce((s, v) => s + v, 0) / flatWf.length;
const flatCv = flatMiss(comps, 'cv') as number;

// LOO residuals of the size-only model: the range bands and their quantiles.
const looResiduals: number[] = [];
for (let i = 0; i < comps.length; i++) {
  const train = comps.filter((_, j) => j !== i);
  const b = ols(train.map((c) => valueDesign(c, [])), train.map((c) => c.logMcap));
  const pred = valueDesign(comps[i]!, []).reduce((s, v, j) => s + v * b[j]!, 0);
  looResiduals.push(comps[i]!.logMcap - pred);
}
const q25 = quantile(looResiduals, 0.25);
const q75 = quantile(looResiduals, 0.75);

// ---- odds model ----
const odds = fitOdds(snapshot, stemHasToken);
const categories = odds.categories;

// ---- board ----
const { board, coverage } = buildBoard(snapshot, value, odds, categories, stemHasToken, stemName, q25, q75, comps);

// ---- farm ----
const sensitivity = farmSensitivity(board.map((r) => ({ ev: r.expected_value_usd, tvl: r.tvl_usd })));
const farmCounts = {
  farm: board.filter((r) => r.verdict === 'FARM').length,
  marginal: board.filter((r) => r.verdict === 'MARGINAL').length,
  skip: board.filter((r) => r.verdict === 'SKIP').length,
};
const bestFarms = [...board]
  .filter((r) => r.verdict === 'FARM')
  .sort((a, b) => b.net_usd - a.net_usd)
  .slice(0, 10)
  .map((r) => ({ rank: r.rank, slug: r.slug, name: r.name, implied: r.implied_value_usd, odds: r.odds, ev: r.expected_value_usd, drop: r.expected_drop_usd, net: r.net_usd }));

// ---- self-tests: the run fails unless every invariant holds ----
const integrity: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string): void => {
  integrity.push({ name, pass, detail });
  if (!pass) fail(`self-test failed: ${name} — ${detail}`);
};
check(
  'ranks 1..198, implied value descending',
  board.every((r, i) => r.rank === i + 1) && board.every((r, i) => i === 0 || board[i - 1]!.implied_value_usd >= r.implied_value_usd),
  'sequential ranks, sorted by implied value',
);
check(
  'all implied values are whole numbers',
  board.every((r) => Number.isSafeInteger(r.implied_value_usd)),
  `${board.length} rows checked — the v4 gate failure, fixed by rounding at the source`,
);
check(
  'all implied values finite and positive',
  board.every((r) => Number.isFinite(r.implied_value_usd) && r.implied_value_usd > 0),
  `${board.length} rows checked`,
);
check(
  'watchlist covered 40/40',
  coverage.watchlistCovered === coverage.watchlist,
  `${coverage.watchlistCovered}/${coverage.watchlist} watchlist slugs on the board`,
);
check(
  'all farm steps 3–12 strings, 20–600 characters',
  board.every((r) => r.farm_steps.length >= 3 && r.farm_steps.length <= 12 && r.farm_steps.every((s) => s.trim().length >= 20 && s.trim().length <= 600)),
  `${board.length} rows checked`,
);
check(
  'all slugs in the snapshot, none repeated',
  board.every((r) => snapshot.protocols.some((p) => p.slug === r.slug)) && new Set(board.map((r) => r.slug)).size === board.length,
  `${board.length} distinct slugs`,
);
const checksum = boardChecksum(board);
check(
  'checksum recomputes',
  boardChecksum(board) === checksum,
  `fnv1a ${checksum}`,
);
const gateIssue = boardIssue(board, snapshot);
check('board passes the gate rules', gateIssue === null, gateIssue ?? 'coverage, ranks, order, whole implied values, farm steps');

// ---- evidence: everything the dashboard's Model & tests tab shows ----
const evidence: Evidence = {
  asOf: snapshot.as_of,
  modelVersion: MODEL_VERSION,
  cleaning,
  value: {
    intercept: value.intercept,
    slope: value.slope,
    interceptSe: ses.intercept.sd,
    slopeSe: ses.slope.sd,
    loo: termTests.base.loo,
    wf: termTests.base.wf,
    wfMean: termTests.base.wfMean,
    cv: termTests.base.cv,
    flatLoo,
    flatWfMean,
    flatCv,
    looVsFlat: flatLoo / termTests.base.loo,
    termTests: termTests.tests,
    rangeHonesty: honesty,
    winShares: shares,
    q25,
    q75,
  },
  odds,
  farm: { ...farmCounts, sensitivity, best: bestFarms },
  coverage,
  integrity: integrity.map(({ name, pass, detail }) => ({ name, pass, detail })),
  checksum,
};

// ---- live-token set, set aside from the ranking ----
const live = snapshot.protocols
  .filter((p) => !isPreToken(p) && p.category !== 'CEX' && (p.mcap_usd ?? 0) > 0)
  .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
  .slice(0, 24)
  .map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));

const radarRows: Record<string, unknown>[] = board.map((r) => ({ ...r }));
const earlySize = board.filter((r) => !r.watchlist).length;

// ---- write outputs ----
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(
  join(out, 'data.js'),
  dataScript({
    asOf: snapshot.as_of,
    source: snapshot.source,
    floorUsd: snapshot.floor_usd,
    modelVersion: MODEL_VERSION,
    watchlistSize: snapshot.watchlist.length,
    boardSize: board.length,
    earlySize,
    liveSize: live.length,
    rows: radarRows,
    live,
  }),
);

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
writeFileSync(join(out, 'dashboard', 'evidence.js'), `window.EVIDENCE=${JSON.stringify(evidence)};\n`);
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
writeFileSync(join(out, 'dossier.json'), dossier);
const dossierText = JSON.parse(new TextDecoder('utf-8').decode(dossier)).text as string;
if (dossierText.includes('[Cut at')) fail('dossier text does not fit whole: a dashboard file was cut — shrink the dashboard');
if (dossierText.length > TEXT_MAX_BYTES) fail(`dossier text is ${dossierText.length} bytes, over the ${TEXT_MAX_BYTES} cap`);

process.stdout.write(
  `token radar v5: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${earlySize} early, ${live.length} live set aside)\n` +
    `token radar v5: value log10(mcap) = ${value.intercept.toFixed(4)} + ${value.slope.toFixed(4)} x log10(TVL) on ${value.comps} comps; LOO x${termTests.base.loo.toFixed(2)}, WF x${termTests.base.wfMean.toFixed(2)} [${termTests.base.wf.map((v) => `x${v.toFixed(2)}`).join(' / ')}], CV x${termTests.base.cv.toFixed(2)} (flat x${flatLoo.toFixed(2)} / x${flatWfMean.toFixed(2)} / x${flatCv.toFixed(2)})\n` +
    `token radar v5: odds Brier LOO ${odds.looBrier.toFixed(3)}, WF ${odds.wfMean.toFixed(3)} [${odds.wfBrier.map((v) => v.toFixed(3)).join(' / ')}], base ${odds.baseBrier.toFixed(3)} (${odds.peers} peers)\n` +
    `token radar v5: farms ${farmCounts.farm} FARM / ${farmCounts.marginal} MARGINAL / ${farmCounts.skip} SKIP of ${board.length}\n` +
    `token radar v5: top 5: ${board
      .slice(0, 5)
      .map((r) => `#${r.rank} ${r.slug} $${(r.implied_value_usd / 1e6).toFixed(1)}M odds ${r.odds} EV $${(r.expected_value_usd / 1e6).toFixed(1)}M ${r.verdict.toLowerCase()}`)
      .join(' | ')}\n` +
    `token radar v5: self-test ${integrity.filter((t) => t.pass).length}/${integrity.length} invariants hold (incl. whole-number implied values); checksum ${checksum}\n` +
    `token radar v5: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (4 files + evidence.js), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${dossier.length} bytes, text ${dossierText.length} bytes)\n`,
);