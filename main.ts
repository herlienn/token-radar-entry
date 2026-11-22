// Token Radar v4 — entrypoint (Node 22, standard library only).
//
// Reads the sealed DeFiLlama snapshot (default /input, or --input
// <snapshot.json|directory>), scores every pre-token protocol with the
// model in lib/model.ts, and writes the ranked board to the output
// directory (default MAKEFUN_OUTPUT_DIR, or /output):
//   board.json      { rows: [...] } — the 198-row ranked board
//   data.js         window.RADAR — the same board for the dashboard page
//   dashboard/      the static page (index.html, app.css, app.js) plus
//                   evidence.js, generated here from the model results
//   screenshots/    the four screenshots, copied from this repository
//   dossier.json    written last with the vendored make.fun library
//
// The dossier text is the judge-read part (dashboard files only, capped at
// 64 KiB). evidence.js reports its byte size, so the file is written,
// measured, and rewritten until the reported size matches the measured one.
//
// Outside the grader's container:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel } from './lib/model.ts';
import type { Snapshot, SnapshotProtocol } from './lib/model.ts';
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

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** Parse and validate the sealed snapshot; refuse anything malformed.
 * A negative mcap_usd is the source's sentinel for "no usable cap" (one
 * protocol carries -1): it is kept as-is and the model treats the protocol
 * as token-recorded with no usable cap, never as a comp. */
function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('snapshot is not valid JSON');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o !== 'object' || o === null || Array.isArray(o)) fail('snapshot is not a JSON object');
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) fail('snapshot.as_of must be a YYYY-MM-DD date');
  if (typeof o.source !== 'string') fail('snapshot.source must be a string');
  if (typeof o.floor_usd !== 'number' || !(o.floor_usd > 0)) fail('snapshot.floor_usd must be a positive number');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) fail('snapshot.watchlist must be an array of strings');
  if (!Array.isArray(o.protocols)) fail('snapshot.protocols must be an array');
  const protocols: SnapshotProtocol[] = [];
  for (const v of o.protocols as Record<string, unknown>[]) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('a protocol is not an object');
    if (typeof v.slug !== 'string' || typeof v.name !== 'string') fail('every protocol needs a string slug and name');
    if (typeof v.tvl_usd !== 'number' || !Number.isFinite(v.tvl_usd) || v.tvl_usd <= 0) fail(`protocol ${v.slug}: tvl_usd must be a positive number`);
    protocols.push({
      slug: v.slug,
      name: v.name,
      category: typeof v.category === 'string' ? v.category : null,
      chains: Array.isArray(v.chains) ? v.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: v.tvl_usd,
      change_7d: typeof v.change_7d === 'number' && Number.isFinite(v.change_7d) ? v.change_7d : null,
      mcap_usd: typeof v.mcap_usd === 'number' && Number.isFinite(v.mcap_usd) ? v.mcap_usd : null,
      listed_at: typeof v.listed_at === 'string' ? v.listed_at : null,
      gecko_id: typeof v.gecko_id === 'string' ? v.gecko_id : null,
      symbol: typeof v.symbol === 'string' ? v.symbol : null,
    });
  }
  return { as_of: o.as_of as string, source: o.source as string, floor_usd: o.floor_usd as number, watchlist: o.watchlist as string[], protocols };
}

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
  return copied.sort();
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, evidence } = buildModel(snapshot);

// The model gates on its own invariants; refuse to write a board that fails.
const failed = evidence.selfTest.filter((t) => t.name !== 'dossier text <= 64 KiB' && !t.pass);
if (failed.length > 0) {
  fail(`the model wrote a board the gate refuses: ${failed.map((t) => `${t.name} (${t.detail})`).join('; ')}`);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(
  join(out, 'data.js'),
  `window.RADAR = ${JSON.stringify({ asOf: snapshot.as_of, floorUsd: snapshot.floor_usd, rows: board })};\n`,
);

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length !== 4) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 4, the board, a detail view, a filtered view and the Model & tests tab`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const size = statSync(join(out, 'screenshots', name)).size;
  if (size > SCREENSHOT_CAPS.max_bytes) fail(`screenshots/${name} is ${size} bytes, over the ${SCREENSHOT_CAPS.max_bytes} cap`);
}

/** The dossier text (the judge-read part) and whether any file was cut. */
function measureDossier(): { textBytes: number; cut: boolean } {
  const bytes = buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  const doc = JSON.parse(Buffer.from(bytes).toString('utf8')) as { text: string };
  return { textBytes: Buffer.byteLength(doc.text, 'utf8'), cut: doc.text.includes('[Cut at') };
}

/**
 * evidence.js reports the dossier text size, and the dossier text includes
 * evidence.js — so write it, measure, and rewrite until the reported size
 * matches the measured one. The placeholder is five digits, like the real
 * size, so the file size does not move between iterations and the loop
 * converges in two passes.
 */
function writeEvidence(): void {
  writeFileSync(
    join(out, 'dashboard', 'evidence.js'),
    `window.EVIDENCE = ${JSON.stringify(evidence)};\n`,
  );
}
evidence.dossierTextBytes = 40000;
writeEvidence();
let measured = measureDossier();
for (let pass = 0; pass < 5 && measured.textBytes !== evidence.dossierTextBytes; pass++) {
  evidence.dossierTextBytes = measured.textBytes;
  const entry = evidence.selfTest.find((t) => t.name === 'dossier text <= 64 KiB');
  if (entry) {
    entry.pass = measured.textBytes <= TEXT_MAX_BYTES && !measured.cut;
    entry.detail = `dossier text ${measured.textBytes} bytes of ${TEXT_MAX_BYTES}${measured.cut ? ' — a file was cut, the text does not fit' : ''}`;
  }
  writeEvidence();
  measured = measureDossier();
}
if (measured.textBytes !== evidence.dossierTextBytes) {
  fail(`dossier text size did not converge (${evidence.dossierTextBytes} reported, ${measured.textBytes} measured)`);
}
if (measured.cut) fail('dossier text does not fit: a dashboard file was cut — shrink the dashboard');
if (measured.textBytes > TEXT_MAX_BYTES) fail(`dossier text is ${measured.textBytes} bytes, over the ${TEXT_MAX_BYTES} cap`);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossierBytes = buildDossier(out, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(out, 'dossier.json'), dossierBytes);

const farm = evidence.farmCounts;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored\n` +
    `token radar: value model log10(mcap) ~ log10(TVL)${evidence.valueTerms.some((t) => t.term === 'growth' && t.verdict === 'kept') ? ' + growth' : ''}: LOO x${evidence.valueLoo.toFixed(2)}, walk-forward x${evidence.valueWf.toFixed(2)} (flat x${evidence.valueFlatLoo.toFixed(2)} / x${evidence.valueFlatWf.toFixed(2)})\n` +
    `token radar: odds Brier LOO ${evidence.oddsLooBrier.toFixed(3)}, walk-forward ${evidence.oddsWfBrier.toFixed(3)} (base rate ${evidence.oddsBaseBrier.toFixed(3)})\n` +
    `token radar: farms ${farm.farm} FARM / ${farm.marginal} MARGINAL / ${farm.skip} SKIP of ${board.length}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files + evidence.js), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${dossierBytes.length} bytes, text ${measured.textBytes} bytes)\n`,
);
