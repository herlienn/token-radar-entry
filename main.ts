// Token Radar v7 — the entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the model in
// lib/model.ts, writes the ranked board to /output/board.json, writes the
// dashboard's data (evidence.js, generated from this run's own numbers) beside
// the page, copies dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with the vendored make.fun library.
//
// The dashboard's evidence is COMPACT on purpose: the dossier's text shows the
// dashboard's source whole only while it fits in 65,536 bytes, so the rows
// travel as short arrays (not objects) and the page recomputes the derived
// numbers (expected value, drop, net, verdict, ranges) from the stated
// formulas — the same formulas lib/model.ts uses, so page and board agree.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, parseSnapshot } from './lib/model.ts';
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
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);

/**
 * The compact evidence the page reads. One row is an array, in this order:
 * [rank, slug, name, category, first chain, tvl, change7d, age, watchlist 0/1,
 *  kin 0/1, kin name, implied value, expected value, odds, rank band lo,
 *  rank band hi, verdict 0/1/2]
 * (0 = FARM, 1 = MARGINAL, 2 = SKIP). The page recomputes drop, net and ranges
 * from the formulas in lib/model.ts, so the dossier carries no duplicated numbers.
 */
const compactRows = radar.rows.map((r) => [
  r.rank,
  r.slug,
  r.name,
  r.category ?? '',
  r.chain,
  r.tvl,
  r.change7d,
  r.age,
  r.watchlist ? 1 : 0,
  r.kin ? 1 : 0,
  r.kinName ?? '',
  r.implied,
  r.ev,
  r.odds,
  r.bandLo,
  r.bandHi,
  r.verdict === 'FARM' ? 0 : r.verdict === 'MARGINAL' ? 1 : 2,
]);
const evidenceScript = `window.EVIDENCE=${JSON.stringify(radar.evidence)};\nwindow.ROWS=${JSON.stringify(compactRows)};\n`;
writeFileSync(join(out, 'data.js'), evidenceScript);

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
// The generated evidence lives beside the page, so the judge reads it whole.
writeFileSync(join(out, 'dashboard', 'evidence.js'), evidenceScript);
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
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
writeFileSync(join(out, 'dossier.json'), dossier);

const ev = radar.evidence;
const ageRow = ev.oddsTests.find((r) => r.term === 'age (log10 days)')!;
process.stdout.write(
  `token radar v7: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored\n` +
    `token radar v7: value size-only OLS slope ${ev.valueBeta[1]} (LOO x${ev.valueLoo} / WF x${ev.valueWf} / CV x${ev.valueCv}); odds age-only logistic on ${ev.oddsPop} known-outcome peers (LOO Brier ${ageRow.loo} vs base ${ageRow.looBase} / WF ${ageRow.wf} vs base ${ageRow.wfBase})\n` +
    `token radar v7: FARM ${ev.farmCounts.farm} / MARGINAL ${ev.farmCounts.marginal} / SKIP ${ev.farmCounts.skip}; top ${ev.topRow.slug} $${ev.topRow.implied.toLocaleString()} odds ${ev.topRow.odds} EV $${ev.topRow.ev.toLocaleString()}\n` +
    `token radar v7: wrote ${join(out, 'board.json')}, ${join(out, 'dashboard')} (${readdirSync(join(out, 'dashboard')).length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${dossier.length} bytes)\n`,
);
