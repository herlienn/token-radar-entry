// Local gate for Token Radar v2 — mirrors the scorer's seven rows.
// Usage: node scripts/check.mjs --out <out-dir> --input <snapshot.json>
// Exit 0 when all 7 rows pass, 1 otherwise. (The kit has no local grade
// by design; this is the local shape/coverage/screenshot/dossier gate.)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const out = arg('out', '/tmp/token-radar-v2-out');
const inputArg = arg('input', '/home/hatch/workspace/makefun/token-radar-kit/token-radar-01-kit/input/snapshot.json');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');

const rows = [];
function check(name, ok, detail) {
  rows.push({ name, ok, detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8'));
const board = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
const dataJs = readFileSync(join(out, 'data.js'), 'utf8');
const radar = JSON.parse(dataJs.replace(/^window\.RADAR = /, '').replace(/;\s*$/, ''));

// 1. dashboard — files, bytes, names, no network
{
  const dir = join(out, 'dashboard');
  const files = [];
  let bytes = 0;
  let bad = null;
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) { bad = `dot entry ${rel}${e.name}`; continue; }
      if (e.isDirectory()) { walk(join(d, e.name), `${rel}${e.name}/`); continue; }
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(e.name)) { bad = `bad name ${rel}${e.name}`; continue; }
      const size = statSync(join(d, e.name)).size;
      files.push(`${rel}${e.name}`);
      bytes += size;
      const text = readFileSync(join(d, e.name), 'utf8');
      if (/https?:\/\/(?!www\.w3\.org)/.test(text) || /\bfetch\s*\(/.test(text) || /XMLHttpRequest/.test(text)) {
        bad = `${rel}${e.name} references the network`;
      }
    }
  };
  walk(dir, '');
  check('dashboard', bad === null && files.length <= 400 && bytes <= 4_194_304,
    `${files.length} files, ${bytes} bytes${bad ? '; ' + bad : ''}`);
}

// 2. board — shape, counts, implied values
{
  const rs = board.rows;
  let bad = null;
  if (!Array.isArray(rs) || rs.length < 100 || rs.length > 4000) bad = `${rs?.length} rows`;
  else {
    for (let i = 0; i < rs.length && bad === null; i++) {
      const r = rs[i];
      if (r.rank !== i + 1) bad = `rank ${i + 1} is ${r.rank}`;
      else if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) bad = `${r.slug} implied ${r.implied_value_usd}`;
      else if (r.implied_value_usd > 100_000_000_000_000) bad = `${r.slug} implied over $100T`;
      else if (r.token_status !== 'pre-token' || r.mcap_usd !== null || r.gecko_id !== null || r.symbol !== null) bad = `${r.slug} is not a clean pre-token row`;
    }
    if (bad === null && rs[0].implied_value_usd === rs[rs.length - 1].implied_value_usd) bad = 'all rows share one implied value';
  }
  check('board', bad === null, bad ?? `${rs.length} rows, implied ${rs[0].implied_value_usd.toLocaleString()} down to ${rs[rs.length - 1].implied_value_usd.toLocaleString()}`);
}

// 3. sorted_by_value — strictly non-increasing implied value
{
  const rs = board.rows;
  let bad = null;
  for (let i = 1; i < rs.length; i++) {
    if (rs[i].implied_value_usd > rs[i - 1].implied_value_usd) { bad = `row ${i + 1} outranks row ${i}`; break; }
  }
  check('sorted_by_value', bad === null, bad ?? 'non-increasing implied value');
}

// 4. coverage — every snapshot protocol accounted for, watchlist complete
{
  const c = radar.coverage;
  const sum = c.ranked + c.wrappedExcluded + c.withMcap + c.symbolNoMcap;
  const onBoard = new Set(board.rows.map((r) => r.slug));
  const missingWatch = (snapshot.watchlist ?? []).filter((s) => !onBoard.has(s));
  const ok = sum === c.total && missingWatch.length === 0 && c.watchlist === (snapshot.watchlist ?? []).length;
  check('coverage', ok,
    `ranked ${c.ranked} + wrapped ${c.wrappedExcluded} + mcap ${c.withMcap} + symbol-only ${c.symbolNoMcap} = ${sum} of ${c.total}; watchlist ${c.watchlist}/${(snapshot.watchlist ?? []).length}${missingWatch.length ? '; missing ' + missingWatch.join(',') : ''}`);
}

// 5. farm_steps — 3-12 steps, each 20-600 chars, costed verdicts present
{
  const rs = board.rows;
  let bad = null;
  let steps = 0;
  for (const r of rs) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) { bad = `${r.slug} has ${r.farm_steps.length} steps`; break; }
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) { bad = `${r.slug} step of ${s.length} chars`; break; }
    }
    if (bad) break;
    steps += r.farm_steps.length;
    if (!['farm', 'thin', 'skip'].includes(r.verdict) || typeof r.net_usd !== 'number') { bad = `${r.slug} has no verdict/net`; break; }
  }
  check('farm_steps', bad === null, bad ?? `${steps} steps across ${rs.length} rows`);
}

// 6. screenshots — 3-4 images, PNG/JPEG, <=512 KiB, long side <=1440, short side >=800
function pngDims(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function jpegDims(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}
{
  const dir = join(out, 'screenshots');
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')).sort() : [];
  let bad = null;
  if (names.length < 3 || names.length > 4) bad = `${names.length} images`;
  for (const n of names) {
    const buf = readFileSync(join(dir, n));
    const dims = pngDims(buf) ?? jpegDims(buf);
    if (!dims) { bad = `${n} is not a PNG or JPEG`; break; }
    if (buf.length > 524_288) { bad = `${n} is ${buf.length} bytes`; break; }
    if (Math.max(dims.w, dims.h) > 1440 || Math.min(dims.w, dims.h) < 800) { bad = `${n} is ${dims.w}x${dims.h}`; break; }
  }
  check('screenshots', bad === null, bad ?? names.map((n) => `${n} (${statSync(join(dir, n)).size} B)`).join(', '));
}

// 7. dossier_matches — the scorer rebuilds the dossier from /output and compares bytes
{
  let detail = '';
  let ok = false;
  try {
    const rebuilt = buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
    const stored = readFileSync(join(out, 'dossier.json'));
    ok = Buffer.from(rebuilt).equals(stored);
    const doc = JSON.parse(stored.toString('utf8'));
    detail = `dossier ${stored.length} bytes, text ${doc.text.length} bytes, ${doc.images.length} images${ok ? ', bytes match' : ', BYTES DIFFER'}`;
  } catch (e) {
    detail = `buildDossier failed: ${e.message}`;
  }
  check('dossier_matches', ok, detail);
}

const failed = rows.filter((r) => !r.ok).length;
console.log(failed === 0 ? `\n7/7 rows pass` : `\n${failed} row(s) fail`);
process.exit(failed === 0 ? 0 : 1);
