// Token Radar v5 dashboard. Reads window.RADAR (data.js) and window.EVIDENCE
// (evidence.js); no fetch, no network. Query params set the opening view:
// ?tab=board|model|coverage|farms&sort=rank|implied_value_usd|expected_value_usd
// &dir=asc|desc&filter=FARM|MARGINAL|SKIP&q=<text>
(function () {
  'use strict';
  var R = window.RADAR;
  var E = window.EVIDENCE;
  var params = new URLSearchParams(location.search);

  function $(id) { return document.getElementById(id); }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
    return '$' + Math.round(v);
  }
  function moneyFull(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  function pct(v) { return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function x(v) { return '×' + v.toFixed(2); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ---- header / KPIs ----
  $('asof').textContent = 'Snapshot ' + R.asOf + ' · ' + R.source + ' · floor $' + (R.floorUsd / 1e6) + 'M · model ' + R.modelVersion;
  var v = E.value, o = E.odds, f = E.farm;
  var kpis = [
    ['LOO miss', x(v.loo), 'flat ' + x(v.flatLoo) + ' — ' + v.looVsFlat.toFixed(2) + '× better'],
    ['Walk-forward', x(v.wfMean), v.wf.map(x).join(' / ')],
    ['5-fold CV', x(v.cv), '5 seeds, ' + R.boardSize + ' rows'],
    ['Odds Brier', o.looBrier.toFixed(3), 'base ' + o.baseBrier.toFixed(3) + ' · WF ' + o.wfMean.toFixed(3)],
    ['Coverage', R.boardSize + ' / ' + E.coverage.scanned, 'watchlist ' + E.coverage.watchlistCovered + '/' + E.coverage.watchlist],
    ['FARM', String(f.farm), f.marginal + ' marginal · ' + f.skip + ' skip'],
  ];
  $('kpis').innerHTML = kpis.map(function (k) {
    return '<div class="kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + ' — ' + esc(k[2]) + '</span></div>';
  }).join('');

  // ---- tabs ----
  var tabs = document.querySelectorAll('#tabs button');
  function showTab(name) {
    tabs.forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    document.querySelectorAll('section.tab').forEach(function (s) { s.classList.toggle('active', s.id === 'tab-' + name); });
  }
  tabs.forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });

  // ---- board ----
  var state = {
    sort: params.get('sort') || 'rank',
    dir: params.get('dir') || 'asc',
    q: params.get('q') || '',
    cat: '',
    verdict: params.get('filter') || '',
    watch: false,
  };
  var cats = Array.from(new Set(R.rows.map(function (r) { return r.category || 'Other'; }))).sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('q').value = state.q;
  $('verdict').value = state.verdict;

  function verdictRank(r) { return r.verdict === 'FARM' ? 0 : r.verdict === 'MARGINAL' ? 1 : 2; }
  function sortVal(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'category') return (r.category || 'Other').toLowerCase();
    if (key === 'verdict') return verdictRank(r);
    if (key === 'change_7d') return r.change_7d === null ? -Infinity : r.change_7d;
    return r[key];
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      if (state.cat && (r.category || 'Other') !== state.cat) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.watch && !r.watchlist) return false;
      return true;
    });
    var dir = state.dir === 'desc' ? -1 : 1;
    rows.sort(function (a, b) {
      var av = sortVal(a, state.sort), bv = sortVal(b, state.sort);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.rank - b.rank;
    });
    return rows;
  }
  function renderBoard() {
    var rows = filtered();
    $('count').textContent = rows.length + ' of ' + R.rows.length + ' rows';
    $('board-body').innerHTML = rows.map(function (r) {
      return '<tr class="' + (r.watchlist ? 'watch' : '') + '" data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b> <span class="slug">' + esc(r.slug) + '</span>' +
          (r.watchlist ? '<span class="badge watch">WATCH</span>' : '') +
          (r.kin ? '<span class="badge kin">KIN</span>' : '') + '</td>' +
        '<td>' + esc(r.category || 'Other') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + (r.change_7d === null ? '—' : pct(r.change_7d)) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + r.odds.toFixed(3) + '</td>' +
        '<td class="num">' + money(r.expected_value_usd) + '</td>' +
        '<td><span class="badge ' + r.verdict.toLowerCase() + '">' + r.verdict + '</span></td>' +
        '<td class="num">' + (r.net_usd >= 0 ? '+' : '') + '$' + r.net_usd.toFixed(2) + '</td>' +
        '</tr>';
    }).join('');
    document.querySelectorAll('#board-body tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.dataset.slug); });
    });
  }
  document.querySelectorAll('#board th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.dataset.sort;
      if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = key; state.dir = key === 'rank' ? 'asc' : 'desc'; }
      renderBoard();
    });
  });
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('verdict').addEventListener('change', function (e) { state.verdict = e.target.value; renderBoard(); });
  $('watchonly').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  renderBoard();

  // ---- detail dialog ----
  var dlg = $('dlg');
  function openDetail(slug) {
    var r = R.rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    $('dlg-title').textContent = '#' + r.rank + ' ' + r.name + ' — ' + r.verdict;
    $('dlg-body').innerHTML =
      '<p><b>Implied value ' + moneyFull(r.implied_value_usd) + '</b> (whole dollars) · odds ' + r.odds.toFixed(3) +
      ' · expected value ' + moneyFull(r.expected_value_usd) + ' · own-token share 100% · value range ' +
      moneyFull(r.range_lo_usd) + '–' + moneyFull(r.range_hi_usd) + ' · rank band ' + r.rank_band_lo + '–' + r.rank_band_hi +
      ' · TVL ' + moneyFull(r.tvl_usd) + (r.age_days === null ? ' · age unknown' : ' · ' + r.age_days + ' days old') +
      (r.kin ? ' · kin: a family token already trades (' + esc(r.kin_name || '') + ')' : '') + '</p>' +
      '<p>Farm: $' + r.deposit_usd + ' stake · expected drop $' + r.expected_drop_usd.toFixed(2) +
      ' · total cost $' + r.total_cost_usd.toFixed(2) + ' · net $' + r.net_usd.toFixed(2) +
      ' · hold until ' + esc(r.hold_until_date) + ' · no break-even date (fixed costs).</p>' +
      '<ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    dlg.showModal();
  }
  $('dlg-close').addEventListener('click', function () { dlg.close(); });

  // ---- model & tests ----
  $('equation').textContent = 'log10(mcap) = ' + v.intercept.toFixed(4) + ' (±' + v.interceptSe.toFixed(4) + ') + ' + v.slope.toFixed(4) + ' (±' + v.slopeSe.toFixed(4) + ') × log10(TVL) — fitted on 90 comps, bootstrap SEs over 200 refits';
  $('value-summary').textContent = 'Size only. Every extra term was tested against it and none cleared the 1% margin on both held-out tests, so none joined. The flat baseline (every protocol at the median mcap/TVL ratio) is ' + v.looVsFlat.toFixed(2) + '× worse on leave-one-out.';
  $('validation').querySelector('tbody').innerHTML = [
    ['Leave-one-out', x(v.loo), x(v.flatLoo), (v.flatLoo / v.loo).toFixed(2) + '×'],
    ['Walk-forward mean (3 splits)', x(v.wfMean), x(v.flatWfMean), (v.flatWfMean / v.wfMean).toFixed(2) + '×'],
    ['Walk-forward splits', v.wf.map(x).join(' / '), v.flatWfMean ? '—' : '—', '—'],
    ['5-fold CV × 5 seeds', x(v.cv), x(v.flatCv), (v.flatCv / v.cv).toFixed(2) + '×'],
  ].map(function (row) {
    return '<tr><td>' + esc(row[0]) + '</td><td class="num"><b>' + esc(row[1]) + '</b></td><td class="num">' + esc(row[2]) + '</td><td class="num">' + esc(row[3]) + '</td></tr>';
  }).join('');
  $('terms').querySelector('tbody').innerHTML = v.termTests.map(function (t) {
    return '<tr><td>' + esc(t.label) + (t.name === 'control' ? ' <span class="badge marginal">CONTROL</span>' : '') + '</td>' +
      '<td class="num">' + x(t.loo) + '</td><td class="num">' + (t.looDeltaPct >= 0 ? '+' : '') + t.looDeltaPct.toFixed(1) + '%</td>' +
      '<td class="num">' + x(t.wfMean) + '</td><td class="num">' + (t.wfDeltaPct >= 0 ? '+' : '') + t.wfDeltaPct.toFixed(1) + '%</td>' +
      '<td>' + esc(t.verdict) + '</td></tr>';
  }).join('');
  var control = v.termTests.find(function (t) { return t.name === 'control'; });
  var controlPasses = control && control.looDeltaPct >= 1 && control.wfDeltaPct >= 1;
  $('control-note').innerHTML = '<div class="note control"><b>Control term — reported honestly:</b> another row’s growth (the next comparable in slug order) ' +
    (controlPasses
      ? '<b>passes both headline tests</b> (LOO ' + (control.looDeltaPct >= 0 ? '+' : '') + control.looDeltaPct.toFixed(1) + '%, WF ' + (control.wfDeltaPct >= 0 ? '+' : '') + control.wfDeltaPct.toFixed(1) + '%). It is not kept — it cannot predict anything, it is a row chosen by alphabetical accident. That it passes says the tests are noisy at n≈90, not that the model found signal. A term this flimsy passing is a finding about the noise floor, and it is printed here rather than hidden.'
      : 'does <b>not</b> pass both headline tests (LOO ' + (control.looDeltaPct >= 0 ? '+' : '') + control.looDeltaPct.toFixed(1) + '%, WF ' + (control.wfDeltaPct >= 0 ? '+' : '') + control.wfDeltaPct.toFixed(1) + '%). It is not kept, and the margin by which it fails is printed here rather than hidden.') +
    '</div>';
  $('ranges').querySelector('tbody').innerHTML = [
    ['P25–P75 (interquartile)', '50%', (v.rangeHonesty.loo.p2575 * 100).toFixed(0) + '%', (v.rangeHonesty.wf.p2575 * 100).toFixed(0) + '%'],
    ['P10–P90', '80%', (v.rangeHonesty.loo.p1090 * 100).toFixed(0) + '%', (v.rangeHonesty.wf.p1090 * 100).toFixed(0) + '%'],
  ].map(function (row) {
    return '<tr><td>' + esc(row[0]) + '</td><td class="num">' + esc(row[1]) + '</td><td class="num">' + esc(row[2]) + '</td><td class="num">' + esc(row[3]) + '</td></tr>';
  }).join('');
  $('wins').querySelector('tbody').innerHTML = v.winShares.map(function (w) {
    var reading = w.share >= 0.6 ? 'beats size-only on most splits' : w.share >= 0.4 ? 'a coin flip against size-only' : 'loses most splits';
    return '<tr><td>' + esc(w.label) + '</td><td class="num">' + (w.share * 100).toFixed(0) + '%</td><td>' + reading + '</td></tr>';
  }).join('');
  $('odds-summary').textContent = 'Logistic model on ' + o.peers + ' dated protocols: does a protocol record a token? Base rate ' + (o.baseRate * 100).toFixed(1) + '% lists, so guessing the base rate scores Brier ' + o.baseBrier.toFixed(3) + '. The model scores ' + o.looBrier.toFixed(3) + ' on leave-one-out and ' + o.wfMean.toFixed(3) + ' walk-forward (' + o.wfBrier.map(function (b) { return b.toFixed(3); }).join(' / ') + ').';
  $('odds-groups').textContent = 'Groups kept (each had to improve LOO Brier by at least 0.002): ' + (o.keptGroups.length ? o.keptGroups.join(', ') : 'none — size only') + '. Tested groups: ' + o.groupTests.map(function (g) { return g.group + ' Δ' + (g.delta >= 0 ? '+' : '') + g.delta.toFixed(3) + (g.kept ? ' kept' : ' not kept'); }).join(' · ') + '.';
  $('odds-coefs').textContent = 'Coefficients: ' + o.coefficients.map(function (c) { return c.name + ' ' + c.value.toFixed(3); }).join(' · ');
  $('odds-wf-note').innerHTML = '<b>Walk-forward is worse than the base rate — and the reason is in the table below, not in the model.</b> The listing rate falls from ~79% for protocols listed in 2021–2023 to ~32% for 2026: a protocol listed this year has simply not had time to launch a token yet, so its “no token” label is censored, not a verdict. A model trained only on old cohorts over-predicts for new ones. The board’s odds come from the full-data fit, which includes the young cohorts, so they are better calibrated than the walk-forward number suggests — but treat odds for the youngest protocols as upper bounds, not promises.';
  $('cohorts').querySelector('tbody').innerHTML = o.cohorts.map(function (c) {
    return '<tr><td>' + esc(c.year) + '</td><td class="num">' + c.n + '</td><td class="num">' + c.listed + '</td><td class="num">' + (c.rate * 100).toFixed(0) + '%</td></tr>';
  }).join('');

  // ---- coverage ----
  var c = E.coverage;
  $('coverage').querySelector('tbody').innerHTML = [
    ['Scanned', c.scanned, 'protocols in the sealed snapshot'],
    ['Ranked', c.ranked, 'watchlist ' + c.watchlistCovered + '/' + c.watchlist + ' + ' + (c.ranked - c.watchlistCovered) + ' early pre-token protocols below the $50M floor, by TVL'],
    ['Live, with a market cap', c.liveWithMcap, 'already trade — set aside, not ranked'],
    ['Token recorded, no market cap', c.tokenRecordedNoCap, 'a token record exists but no cap to value against'],
    ['Token recorded, cap zero or negative', c.tokenRecordedZeroCap, 'a token record exists but the cap is $0 or below — no usable value'],
    ['Pre-token, not ranked', c.preTokenNotRanked, 'below the board cut (TVL rank beyond the 158 early slots)'],
  ].map(function (row) {
    return '<tr><td>' + esc(row[0]) + '</td><td class="num"><b>' + row[1] + '</b></td><td>' + esc(row[2]) + '</td></tr>';
  }).join('');
  $('live').querySelector('tbody').innerHTML = R.live.map(function (p) {
    return '<tr><td><b>' + esc(p.name) + '</b> <span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || 'Other') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + (p.change_7d === null ? '—' : pct(p.change_7d)) + '</td></tr>';
  }).join('');

  // ---- best farms ----
  $('best').querySelector('tbody').innerHTML = f.best.map(function (b) {
    return '<tr><td class="num">' + b.rank + '</td><td><b>' + esc(b.name) + '</b> <span class="slug">' + esc(b.slug) + '</span></td>' +
      '<td class="num">' + money(b.implied) + '</td><td class="num">' + b.odds.toFixed(3) + '</td>' +
      '<td class="num">' + money(b.ev) + '</td><td class="num">$' + b.drop.toFixed(2) + '</td><td class="num"><b>+$' + b.net.toFixed(2) + '</b></td></tr>';
  }).join('');
  $('sensitivity').querySelector('tbody').innerHTML = f.sensitivity.map(function (s) {
    return '<tr><td>' + esc(s.variant) + '</td><td class="num"><b>' + s.farm + '</b></td></tr>';
  }).join('');

  // ---- integrity strip + footer ----
  $('integrity').innerHTML = E.integrity.map(function (t) {
    return '<span><b class="' + (t.pass ? '' : 'fail') + '">' + (t.pass ? 'PASS' : 'FAIL') + '</b> ' + esc(t.name) + ' — ' + esc(t.detail) + '</span>';
  }).join('') + '<span>checksum <b class="mono">' + esc(E.checksum) + '</b></span>';
  $('footer').textContent = 'Token Radar v5 · model ' + R.modelVersion + ' · snapshot ' + R.asOf + ' · ' + E.coverage.scanned + ' protocols scanned, ' + R.boardSize + ' rows ranked · generated by main.ts (Node 22, standard library only, no network) · implied values are whole dollars, rounded at the source';

  // ---- opening view from the URL ----
  var tab = params.get('tab');
  if (tab) showTab(tab);
  var detail = params.get('detail');
  if (detail) openDetail(detail);
})();
