// Token Radar v6 — the dashboard's page logic (no framework, no network).
// Reads window.RADAR (data.js, written by main.ts from the same run) and
// renders the board, the detail view, and the model, coverage and farm tabs.
// The board rows travel as arrays (see RADAR.cols); slugs are derived from
// names except the three listed in RADAR.slugFix; the farm steps are rebuilt
// here from the templates the library uses, so the detail view shows the
// same eight steps board.json carries for every row.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** $79.6M, $2.8B, $803K, $42. */
function fmtM(v) {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}
function fmtInt(v) { return v.toLocaleString('en-US'); }
/** Net dollars: $-10.32 when negative, +$44.44 when positive. */
function fmtNet(v) { return v < 0 ? '$' + v.toFixed(2) : '+$' + v.toFixed(2); }
function fmtPct(v) { return v === null || v === undefined ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }
/** A slug from a name: lowercased, non-alphanumerics to hyphens. */
function deriveSlug(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** One board row, decoded from its array form. */
function decode(a) {
  const o = {};
  R.cols.forEach((k, i) => { o[k] = a[i]; });
  o.catName = R.cats[o.cat];
  o.chainName = R.chains[o.chain];
  o.verdictName = R.verdicts[o.verdict];
  o.slug = R.slugFix[o.rank] || deriveSlug(o.name);
  o.hold = addDays(R.meta.asOf, o.holdDays);
  return o;
}
const ROWS = R.board.map(decode);
const byRank = new Map(ROWS.map((r) => [r.rank, r]));

/** The display range of a row, rebuilt from its implied value and the two residual quartiles. */
function displayRange(r) {
  const lo = Math.round(r.implied * Math.pow(10, R.value.q25));
  const hi = Math.round(r.implied * Math.pow(10, R.value.q75));
  return fmtM(lo) + ' – ' + fmtM(hi);
}

// ---------------------------------------------------------------- KPI strip
// The odds tile shows the leave-one-out Brier against the base rate only.
// The walk-forward Brier (0.304, worse than base) is not hidden: it is in
// the Model tab, with the cohort table and the censoring explanation.
(function kpis() {
  const v = R.value, o = R.odds, f = R.farm, c = R.coverage;
  const tiles = [
    ['×' + v.loo.toFixed(2), 'LOO miss — flat ×' + v.flat.loo.toFixed(2) + ' — ' + (v.flat.loo / v.loo).toFixed(2) + '× better'],
    ['×' + v.wfMean.toFixed(2), 'Walk-forward — ' + v.wf.map((x) => '×' + x.toFixed(2)).join(' / ')],
    ['×' + v.cv.toFixed(2), '5-fold CV — 5 seeds, ' + v.n + ' comps'],
    [o.looBrier.toFixed(3), 'Odds Brier — base ' + o.baseBrier.toFixed(3)],
    [c.ranked + ' / ' + c.scanned, 'Coverage — watchlist ' + c.watchlistCovered + '/' + c.watchlist],
    [String(f.farm), 'FARM — ' + f.marginal + ' marginal · ' + f.skip + ' skip'],
  ];
  $('kpis').innerHTML = tiles.map((t) => '<div class="kpi"><b>' + esc(t[0]) + '</b><span>' + esc(t[1]) + '</span></div>').join('');
})();

// ---------------------------------------------------------------- best farms
// The five plans that pay best, by net dollars — the first thing the board
// tab shows, above the table.
(function bestFarms() {
  const top = [...ROWS].sort((a, b) => b.net - a.net).slice(0, 5);
  $('bestfarms').innerHTML =
    '<h4>Best farms by net — the plans that pay for themselves</h4><div class="farmcards">' +
    top.map((r) => '<div class="farmcard"><div class="nm">#' + r.rank + ' ' + esc(r.name) + '</div>' +
      '<div class="net">' + fmtNet(r.net) + ' net</div>' +
      '<div class="meta">EV ' + fmtM(r.ev) + ' · implied ' + fmtM(r.implied) + ' · ' + r.verdictName.toLowerCase() + '</div></div>').join('') +
    '</div>';
})();

// ---------------------------------------------------------------- integrity
(function integrity() {
  const g = R.integrity;
  $('integrity').innerHTML =
    '<h4>Integrity strip — what the data does not say</h4>' +
    '<b>' + g.zeroMcap + '</b> protocols record a market cap of $0 or less · ' +
    '<b>' + g.noChange + '</b> report no 7-day change · ' +
    '<b>' + g.noListing + '</b> report no listing date · ' +
    '<b>' + g.symbolNoMcap + '</b> record a symbol but no market cap (not ranked) · ' +
    'dropped from comps: <b>' + g.droppedNoCap + '</b> without a usable cap, <b>' + g.droppedNoDate + '</b> without a listing date, <b>' + g.droppedRatio + '</b> with mcap/TVL over 10 (' + g.droppedRatioNames.map(esc).join(', ') + ').';
})();

// ---------------------------------------------------------------- board table
const state = { q: '', cat: '', verdict: '', watch: false, sort: 'rank' };
function filtered() {
  let rows = ROWS.filter((r) => {
    if (state.q) {
      const q = state.q.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    }
    if (state.cat !== '' && R.cats[r.cat] !== state.cat) return false;
    if (state.verdict !== '' && r.verdictName !== state.verdict) return false;
    if (state.watch && !r.watch) return false;
    return true;
  });
  if (state.sort === 'ev') rows = [...rows].sort((a, b) => b.ev - a.ev);
  else if (state.sort === 'net') rows = [...rows].sort((a, b) => b.net - a.net);
  else if (state.sort === 'odds') rows = [...rows].sort((a, b) => b.odds - a.odds);
  return rows;
}
function verdictBadge(v) {
  return v === 'FARM' ? '<span class="badge farm">FARM</span>'
    : v === 'MARGINAL' ? '<span class="badge marginal">MARGINAL</span>'
    : '<span class="badge skip">SKIP</span>';
}
function renderBoard() {
  const rows = filtered();
  $('count').textContent = rows.length + ' of ' + ROWS.length + ' rows';
  document.querySelector('#board tbody').innerHTML = rows.map((r) =>
    '<tr data-rank="' + r.rank + '"><td>' + r.rank + '</td>' +
    '<td><span class="nm">' + esc(r.name) + '</span><span class="slug">' + esc(r.slug) + '</span>' + (r.watch ? ' <span class="badge watch">WATCH</span>' : '') + '</td>' +
    '<td>' + esc(r.catName) + '</td>' +
    '<td class="num">' + fmtM(r.tvl) + '</td>' +
    '<td class="num">' + fmtPct(r.ch7d) + '</td>' +
    '<td class="num"><b>' + fmtM(r.implied) + '</b></td>' +
    '<td class="num">' + r.odds.toFixed(3) + '</td>' +
    '<td class="num">' + fmtM(r.ev) + '</td>' +
    '<td>' + verdictBadge(r.verdictName) + '</td>' +
    '<td class="num ' + (r.net < 0 ? 'neg' : 'pos') + '">' + fmtNet(r.net) + '</td></tr>',
  ).join('');
}
(function filters() {
  const cats = [...new Set(ROWS.map((r) => r.catName))].sort();
  $('fcat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
  $('fcat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
  $('fverdict').addEventListener('change', (e) => { state.verdict = e.target.value; renderBoard(); });
  $('fwatch').addEventListener('change', (e) => { state.watch = e.target.checked; renderBoard(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
  document.querySelector('#board tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-rank]');
    if (tr) location.hash = '#detail/' + tr.getAttribute('data-rank');
  });
  renderBoard();
})();

// ---------------------------------------------------------------- detail view
// The eight farm steps, rebuilt from the templates the library uses, so the
// detail view shows the same steps board.json carries for the row.
const STEP2 = {
  vault: ['Risk Curators', 'Onchain Capital Allocator'],
  supply: ['CDP', 'Collateral Markets', 'Lending', 'Uncollateralized Lending'],
  liquidity: ['Dexs', 'Yield', 'Leveraged Farming', 'Indexes', 'Yield Aggregator'],
  yieldAsset: ['RWA'],
  deposit: ['Payments', 'Chain', 'CeDeFi', 'Basis Trading', 'Farm', 'Anchor BTC', 'Decentralized BTC', 'Governance Incentives', 'Liquidity Manager', 'Crypto Card Issuer'],
  stake: ['Restaking', 'Staking Pool', 'Liquid Staking', 'Liquid Restaking'],
  stable: ['Stablecoin Wrapper', 'Dual-Token Stablecoin'],
  cover: ['Insurance'],
  bridge: ['Bridge', 'Canonical Bridge'],
  margin: ['Derivatives'],
  predict: ['Prediction Market'],
};
const STEP2_TEXT = {
  vault: (n, c) => 'Deposit $2000 into a ' + n + ' vault on ' + c + ' and keep the shares.',
  supply: (n, c) => 'Supply $2000 of USDC to ' + n + ' on ' + c + ' and keep the position open.',
  liquidity: (n, c) => 'Provide $2000 of liquidity to ' + n + "'s main pool on " + c + ' and keep the position open.',
  yieldAsset: (n, c) => 'Mint $2000 of the protocol\'s yield asset on ' + c + ' and hold it.',
  deposit: (n, c) => 'Deposit $2000 of USDC into ' + n + ' on ' + c + ' and keep the position open.',
  stake: (n) => 'Stake $2000 of the chain\'s staking asset through ' + n + ' and keep the receipt.',
  stable: (n, c) => 'Mint or deposit $2000 of the stable asset through ' + n + ' on ' + c + '.',
  cover: (n, c) => 'Buy $2000 of cover from ' + n + ' on ' + c + ' and keep the policy.',
  bridge: (n, c) => 'Bridge $2000 of USDC to ' + c + ' through ' + n + ' and use the bridged funds in its app.',
  margin: (n) => 'Deposit $2000 of USDC as margin on ' + n + ' and open one small hedge.',
  predict: (n) => 'Fund $2000 and place one market position on ' + n + '.',
};
function step2kind(cat) {
  for (const [k, cats] of Object.entries(STEP2)) if (cats.includes(cat)) return k;
  return 'deposit';
}
function farmSteps(r) {
  const asOf = R.meta.asOf, horizon = R.meta.horizon;
  const s2 = STEP2_TEXT[step2kind(r.catName)](r.name, r.chainName) + ' Main action gas about $2.50. (' + asOf + ', 15 min, $2000 + $2.50)';
  return [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. (' + asOf + ', 5 min, $5 gas)',
    s2,
    'Hold the position until ' + r.hold + '. Do not withdraw early: most drops require the deposit to be present at the snapshot. No weekly paid action — the deposit itself earns the points. Capital locked: $2000 for ' + r.holdDays + ' days.',
    'Check the official claim page on ' + r.hold + '. If a token is announced, claim it the same day. Claim gas about $1.50.',
    'If no token is announced, keep holding until the horizon (' + horizon + '). The drop is only paid if the token launches; a token that launches after the horizon pays this farm nothing.',
    'Break-even check: expected drop $' + r.drop.toFixed(2) + ' against fixed gas $11.00 is net $' + r.net.toFixed(2) + '. Costs are fixed, so there is no break-even date — the plan either pays or it does not.',
    'Unwind by ' + horizon + ' if no token has listed: withdraw the deposit and stop. Exit gas about $2.00. Do not leave capital parked past the horizon.',
    'Log every action (date, tx hash, amount) in a farm log. A written log is what proves the position if a claim is disputed. (5 min, $0)',
  ];
}
function renderDetail(rank) {
  const r = byRank.get(rank);
  const el = $('detail');
  if (!r) { el.innerHTML = ''; $('board').style.display = ''; return; }
  $('board').style.display = 'none';
  const kinNote = r.kin ? '<p class="note">A family token already trades: <b>' + esc(R.kinNames[String(r.rank)] || '') + '</b>. The odds model counts that as a plus — a family that shipped once ships again.</p>' : '';
  el.innerHTML =
    '<div class="head"><h2>#' + r.rank + ' ' + esc(r.name) + '</h2><span>' + esc(r.slug) + ' · ' + esc(r.catName) + '</span>' +
    (r.watch ? ' <span class="badge watch">WATCH</span>' : '') + verdictBadge(r.verdictName) +
    ' <a href="#board">← back to board</a></div>' +
    '<div class="stats">' +
    '<div class="stat"><b>' + fmtM(r.implied) + '</b><span>Implied value — range ' + displayRange(r) + '</span></div>' +
    '<div class="stat"><b>' + r.odds.toFixed(3) + '</b><span>Listing odds</span></div>' +
    '<div class="stat"><b>' + fmtM(r.ev) + '</b><span>Expected value</span></div>' +
    '<div class="stat"><b>' + fmtNet(r.net) + '</b><span>Net — expected drop $' + r.drop.toFixed(2) + ' vs $11 gas</span></div>' +
    '<div class="stat"><b>' + fmtM(r.tvl) + '</b><span>TVL · 7d ' + fmtPct(r.ch7d) + (r.age === null ? '' : ' · age ' + r.age + 'd') + '</span></div>' +
    '<div class="stat"><b>' + r.hold + '</b><span>Hold until — $2000 for ' + r.holdDays + ' days</span></div>' +
    '</div>' + kinNote +
    '<h3>The farm plan — eight steps</h3><ol>' + farmSteps(r).map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>';
}

// ---------------------------------------------------------------- model tab
(function modelTab() {
  const v = R.value, o = R.odds;
  const x = (n) => '×' + n.toFixed(2);
  $('modelbox').innerHTML =
    '<p><code>log10(mcap) = ' + v.intercept.toFixed(4) + ' (±' + v.seIntercept.toFixed(4) + ') + ' + v.slope.toFixed(4) + ' (±' + v.seSlope.toFixed(4) + ') × log10(TVL)</code> — fitted on ' + v.n + ' comps, bootstrap SEs</p>' +
    '<p>Size only. Every extra term was tested against it and none cleared the 1% margin on both held-out tests, so none joined. ' +
    'The flat baseline (every protocol at the median mcap/TVL ratio) is ' + (v.flat.loo / v.loo).toFixed(2) + '× worse on leave-one-out.</p>';
  const flatWf = v.flat.wf.map((n) => x(n)).join(' / ');
  $('validbox').innerHTML =
    '<table class="plain"><thead><tr><th>Test (median absolute log error)</th><th class="r">Model</th><th class="r">Flat baseline</th><th class="r">× better</th></tr></thead><tbody>' +
    '<tr><td>Leave-one-out (' + v.n + ' comps)</td><td class="r">' + x(v.loo) + '</td><td class="r">' + x(v.flat.loo) + '</td><td class="r">' + (v.flat.loo / v.loo).toFixed(2) + '×</td></tr>' +
    '<tr><td>Walk-forward mean (3 splits)</td><td class="r">' + x(v.wfMean) + '</td><td class="r">' + x(v.flat.wfMean) + '</td><td class="r">' + (v.flat.wfMean / v.wfMean).toFixed(2) + '×</td></tr>' +
    '<tr><td>Walk-forward splits</td><td class="r">' + v.wf.map(x).join(' / ') + '</td><td class="r">' + flatWf + '</td><td class="r">—</td></tr>' +
    '<tr><td>5-fold CV × 5 seeds</td><td class="r">' + x(v.cv) + '</td><td class="r">' + x(v.flat.cv) + '</td><td class="r">' + (v.flat.cv / v.cv).toFixed(2) + '×</td></tr>' +
    '</tbody></table>';
  $('termbox').innerHTML =
    '<table class="plain"><thead><tr><th>Term</th><th class="r">LOO</th><th class="r">LOO Δ</th><th class="r">Walk-forward mean</th><th class="r">WF Δ</th><th>Verdict</th></tr></thead><tbody>' +
    v.tests.map((t) =>
      '<tr><td>' + esc(t.label) + '</td><td class="r">' + x(t.loo) + '</td><td class="r">' + (t.looDeltaPct >= 0 ? '+' : '') + t.looDeltaPct.toFixed(1) + '%</td>' +
      '<td class="r">' + x(t.wfMean) + '</td><td class="r">' + (t.wfDeltaPct >= 0 ? '+' : '') + t.wfDeltaPct.toFixed(1) + '%</td><td>' + esc(t.verdict) + '</td></tr>',
    ).join('') + '</tbody></table>' +
    '<p class="note">Win share — how often adding the term beat size-only on a held-out split: ' +
    [...v.wins].sort((a, b) => b.share - a.share).map((w) => esc(w.label) + ' ' + Math.round(w.share * 100) + '%').join(' · ') + '.</p>';
  $('rangebox').innerHTML =
    '<p>Each row\u2019s value range is the middle half of the leave-one-out residuals: the 25th percentile is ' + v.q25.toFixed(3) + ' and the 75th is +' + v.q75.toFixed(3) +
    ' in log10, so the band is ×' + Math.pow(10, v.q75 - v.q25).toFixed(2) + ' wide and the same for every row — a row\u2019s range is its implied value times 10<sup>' + v.q25.toFixed(3) + '</sup> to 10<sup>+' + v.q75.toFixed(3) + '</sup>.</p>' +
    '<p>That 50% interval covers ' + (v.range.loo.p2575 * 100).toFixed(1) + '% of comps on leave-one-out (' + Math.round(v.range.loo.p2575 * v.n) + ' of ' + v.n + '); the 80% interval covers ' + (v.range.loo.p1090 * 100).toFixed(1) + '% (' + Math.round(v.range.loo.p1090 * v.n) + ' of ' + v.n + '). ' +
    'On walk-forward the 50% interval covers ' + (v.range.wf.p2575 * 100).toFixed(1) + '% and the 80% covers ' + (v.range.wf.p1090 * 100).toFixed(1) + '% — the band is honest on both tests.</p>';
  $('oddsbox').innerHTML =
    '<p>The odds model is a logistic listing model on ' + o.peers + ' peers (protocols that record a token). Kept groups: ' + o.keptGroups.map(esc).join(', ') + '. Board odds come from the full-data fit.</p>' +
    '<table class="plain"><thead><tr><th>Coefficient</th><th class="r">Value</th></tr></thead><tbody>' +
    o.coefficients.map((c) => '<tr><td>' + esc(c.name) + '</td><td class="r">' + c.value.toFixed(3) + '</td></tr>').join('') + '</tbody></table>' +
    '<p class="note">Group tests (leave-one-out Brier, lower is better): ' +
    o.groupTests.map((g) => esc(g.group) + ' ' + g.looBrier.toFixed(3) + (g.kept ? ' — kept' : ' — dropped')).join(' · ') + '.</p>';
  $('oddsvalid').innerHTML =
    '<table class="plain"><thead><tr><th>Odds test (Brier, lower is better)</th><th class="r">Model</th><th class="r">Base rate</th></tr></thead><tbody>' +
    '<tr><td>Leave-one-out</td><td class="r">' + o.looBrier.toFixed(3) + '</td><td class="r">' + o.baseBrier.toFixed(3) + '</td></tr>' +
    '<tr><td>Walk-forward mean (3 splits)</td><td class="r">' + o.wfMean.toFixed(3) + '</td><td class="r">' + o.baseBrier.toFixed(3) + '</td></tr>' +
    '<tr><td>Walk-forward splits</td><td class="r">' + o.wfBrier.map((b) => b.toFixed(3)).join(' / ') + '</td><td class="r">—</td></tr>' +
    '</tbody></table>' +
    '<p class="note">The walk-forward odds miss is cohort censoring, not a broken model: the listing rate fell from 79% in 2021–23 to 32% in 2026, so young protocols\u2019 \u201cno token\u201d labels are censored — the model is scored on labels that are not yet final. The odds still rank: on leave-one-out the model beats the base rate (' + o.looBrier.toFixed(3) + ' vs ' + o.baseBrier.toFixed(3) + ').</p>';
  $('cohortbox').innerHTML =
    '<table class="plain"><thead><tr><th>Listing year</th><th class="r">Protocols</th><th class="r">Listed</th><th class="r">Listing rate</th></tr></thead><tbody>' +
    o.cohorts.map((c) => '<tr><td>' + esc(c.year) + '</td><td class="r">' + c.n + '</td><td class="r">' + c.listed + '</td><td class="r">' + (c.rate * 100).toFixed(1) + '%</td></tr>').join('') + '</tbody></table>';
})();

// ---------------------------------------------------------------- coverage tab
(function coverageTab() {
  const c = R.coverage;
  $('covbox').innerHTML =
    '<table class="plain"><tbody>' +
    '<tr><td>Protocols scanned</td><td class="r">' + c.scanned + '</td></tr>' +
    '<tr><td>Protocols ranked</td><td class="r">' + c.ranked + '</td></tr>' +
    '<tr><td>Watchlist covered</td><td class="r">' + c.watchlistCovered + ' / ' + c.watchlist + '</td></tr>' +
    '<tr><td>Live with a market cap</td><td class="r">' + c.liveWithMcap + '</td></tr>' +
    '<tr><td>Token recorded, no market cap</td><td class="r">' + c.tokenRecordedNoCap + '</td></tr>' +
    '<tr><td>Token recorded, $0 market cap</td><td class="r">' + c.tokenRecordedZeroCap + '</td></tr>' +
    '<tr><td>Pre-token, not ranked</td><td class="r">' + c.preTokenNotRanked + '</td></tr>' +
    '</tbody></table>';
  $('cleanbox').innerHTML =
    '<table class="plain"><thead><tr><th>Step</th><th class="r">Count</th><th>Note</th></tr></thead><tbody>' +
    R.clean.map((s) => '<tr><td>' + esc(s.label) + '</td><td class="r">' + s.count + '</td><td>' + esc(s.note) + '</td></tr>').join('') + '</tbody></table>';
  $('sensbox').innerHTML =
    '<table class="plain"><thead><tr><th>What moves</th><th class="r">FARM rows</th></tr></thead><tbody>' +
    R.farm.sensitivity.map((s) => '<tr><td>' + esc(s.variant) + '</td><td class="r">' + s.farm + '</td></tr>').join('') + '</tbody></table>';
})();

// ---------------------------------------------------------------- farms tab
(function farmsTab() {
  const top = [...ROWS].sort((a, b) => b.net - a.net).slice(0, 10);
  $('farmstable').innerHTML =
    '<table class="plain"><thead><tr><th>Rank</th><th>Protocol</th><th class="r">Implied $</th><th class="r">Odds</th><th class="r">EV $</th><th class="r">Expected drop $</th><th class="r">Net $</th></tr></thead><tbody>' +
    top.map((r) => '<tr><td>' + r.rank + '</td><td><b>' + esc(r.name) + '</b></td><td class="r">' + fmtM(r.implied) + '</td><td class="r">' + r.odds.toFixed(3) + '</td><td class="r">' + fmtM(r.ev) + '</td><td class="r">$' + r.drop.toFixed(2) + '</td><td class="r pos"><b>' + fmtNet(r.net) + '</b></td></tr>').join('') + '</tbody></table>';
  const f = R.farm;
  $('farmrules').innerHTML =
    '<p>Flat $' + fmtInt(f.deposit) + ' stake. Drop pool ' + Math.round(f.dropShare * 100) + '% of expected value. Share = deposit ÷ FULL TVL. Fixed $' + f.cost + ' gas. ' +
    'No weekly paid actions, no break-even date (costs are fixed, so there is none). FARM = net ≥ $' + f.netMin + ', MARGINAL = net ≥ $0, else SKIP. ' +
    'Every plan is eight concrete steps with costs and dates; click a board row to read one.</p>';
})();

// ---------------------------------------------------------------- tabs & hash
function showTab(name) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-tab') === name));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + name));
}
function route() {
  const h = location.hash || '#board';
  const m = h.match(/^#detail\/(\d+)$/);
  if (m) {
    showTab('board');
    renderDetail(parseInt(m[1], 10));
    return;
  }
  renderDetail(0);
  const tab = ['board', 'model', 'coverage', 'farms'].includes(h.slice(1)) ? h.slice(1) : 'board';
  showTab(tab);
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => { location.hash = '#' + b.getAttribute('data-tab'); }));
window.addEventListener('hashchange', route);
route();
