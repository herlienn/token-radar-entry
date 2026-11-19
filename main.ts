// Token Radar v2 — radar-3 (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// fits the comps curve in lib/radar.ts, and writes the ranked board to
// /output/board.json. It copies this repository's dashboard/ and screenshots/
// to /output, and writes /output/dossier.json last with the vendored
// make.fun library — the scorer rebuilds the dossier from /output and
// compares bytes, so the dossier must be written after everything else.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, type Radar } from './lib/radar.ts';
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

const raw = JSON.parse(readFileSync(inputFile, 'utf8'));
const radar = buildRadar(raw);
const issue = boardIssue(radar);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue.row}: ${issue.text}\n`);
  process.exit(1);
}
// Every watchlist protocol must appear on the board — the scorer refuses a
// board that misses one.
const watchlist: string[] = Array.isArray(raw.watchlist) ? raw.watchlist : [];
const onBoard = new Set(radar.rows.map((r) => r.slug));
const missing = watchlist.filter((s) => !onBoard.has(s));
if (missing.length > 0) {
  process.stderr.write(`token radar: the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}\n`);
  process.exit(1);
}

/** The dashboard reads this: the whole radar as one window.RADAR value. */
function dataScript(r: Radar): string {
  return `window.RADAR = ${JSON.stringify(r)};\n`;
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: radar.rows })}\n`);
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

const f = radar.fit;
const verdicts = { farm: 0, thin: 0, skip: 0 };
for (const r of radar.rows) verdicts[r.verdict]++;
process.stdout.write(
  `token radar v2 (radar-3): ${radar.coverage.total} protocols, ${radar.coverage.watchlist} on the watchlist, ${radar.rows.length} rows scored\n` +
    `  comps fitted: ${f.n} tokens, one per ticker; beta = [${f.beta.map((v) => v.toFixed(3)).join(', ')}] (const, logTVL, growth, logAge, logChains, ageUnknown)\n` +
    `  in-sample R2 ${f.r2.toFixed(3)}, median |log err| ${f.medAbsErr.toFixed(3)}; ` +
    `LOO fitted ${f.looFitted.toFixed(3)} vs flat-median ${f.looFlatMedian.toFixed(3)} vs flat-0.22 ${f.looFlat022.toFixed(3)}\n` +
    `  walk-forward (${f.wfTrainN} older fit, ${f.wfTestN} newer test) fitted ${f.wfFitted.toFixed(3)} vs flat-train ${f.wfFlatTrain.toFixed(3)} vs flat-0.22 ${f.wfFlat022.toFixed(3)}\n` +
    `  coverage: ranked ${radar.coverage.ranked} (watchlist ${radar.coverage.watchlist} + early ${radar.coverage.early}), ` +
    `wrapped-excluded ${radar.coverage.wrappedExcluded}, with-mcap ${radar.coverage.withMcap} (${radar.coverage.mcapNonpositive} non-positive), symbol-no-mcap ${radar.coverage.symbolNoMcap}\n` +
    `  verdicts: farm ${verdicts.farm}, thin ${verdicts.thin}, skip ${verdicts.skip}\n` +
    `  top 5: ${radar.rows.slice(0, 5).map((r) => `${r.slug} $${r.implied_value_usd.toLocaleString('en-US')}`).join(', ')}\n` +
    `  wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
