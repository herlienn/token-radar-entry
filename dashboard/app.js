// Token Radar v4 — dashboard. Static page, no network. Reads window.RADAR
// (the board, written by main.ts) and window.EVIDENCE (the validation
// numbers, also written by main.ts). Written from scratch for this entry.
(function () {
  'use strict';
  var R = window.RADAR;
  var E = window.EVIDENCE;
  var rows = R.rows;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    if (!isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  }
  function pct(x, d) { return (x * 100).toFixed(d === undefined ? 1 : d) + '%'; }
  function signed(n, d) { return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(d === undefined ? 1 : d) + '%'; }
  function dollars(n) { return (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(2); }
  // FNV-1a, identical to the one in lib/model.ts — the in-browser self-test
  // recomputes the checksum over the same canonical row string.
  function fnv1aHex(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // ---------- in-browser self-test: the same invariants main.ts gates on ----------
  function selfTest() {
    var out = [];
    function check(name, pass, detail) { out.push({ name: name, pass: pass, detail: detail }); }
    check('board rows', rows.length === 198, rows.length + ' rows');
    var wl = rows.filter(function (r) { return r.watchlist; }).length;
    check('watchlist 40/40', wl === 40, wl + ' of 40 on the board');
    var ordered = rows.every(function (r, i) { return r.rank === i + 1; }) &&
      rows.every(function (r, i) { return i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd; });
    check('ranks 1..198, implied value descending', ordered, 'sequential ranks, sorted by implied value');
    var acct = E.accounting.reduce(function (a, g) { return a + g.count; }, 0);
    check('accounting sums to 758', acct === 758, acct + ' of 758');
    check('all implied values finite and positive', rows.every(function (r) { return isFinite(r.implied_value_usd) && r.implied_value_usd > 0; }), rows.length + ' rows checked');
    var odds = rows.map(function (r) { return r.odds; });
    check('all odds in (0, 1)', rows.every(function (r) { return r.odds > 0 && r.odds < 1; }), 'min ' + Math.min.apply(null, odds).toFixed(3) + ', max ' + Math.max.apply(null, odds).toFixed(3));
    check('farm steps: 8 per row, 20–600 chars each', rows.every(function (r) { return r.farm_steps.length === 8 && r.farm_steps.every(function (s) { return s.length >= 20 && s.length <= 600; }); }), rows.length + ' rows × 8 steps');
    var sum = fnv1aHex(rows.map(function (r) { return r.rank + ',' + r.slug + ',' + Math.round(r.implied_value_usd); }).join('\n'));
    check('checksum recomputes', sum === E.checksum, sum);
    check('dossier text <= 64 KiB', E.dossierTextBytes <= 65536, 'dossier text ' + E.dossierTextBytes + ' bytes of 65,536');
    return out;
  }

  // ---------- KPI strip ----------
  function renderKpi() {
    var keptV = E.valueTerms.filter(function (t) { return t.verdict === 'kept'; }).length;
    var keptO = E.oddsTerms.filter(function (t) { return t.verdict === 'kept'; }).length;
    var tiles = [
      ['×' + E.valueWf.toFixed(2), 'walk-forward miss, vs flat ×' + E.valueFlatWf.toFixed(2)],
      [pct(E.rangeHonesty.looP2575, 0) + ' · ' + pct(E.rangeHonesty.wfP2575, 0), 'held-out caps inside P25–P75 (stated 50%), LOO · WF'],
      [E.oddsLooBrier.toFixed(3), 'odds Brier, LOO · base rate ' + E.oddsBaseBrier.toFixed(3)],
      [keptV + ' + ' + keptO, 'terms survived both tests (value + odds)'],
      [E.farmCounts.farm + ' of ' + E.boardN, 'FARM verdicts (' + E.farmCounts.marginal + ' marginal)'],
      ['40/40', 'watchlist ranked · ' + E.compsN + ' comps'],
    ];
    document.getElementById('kpi').innerHTML = tiles.map(function (t) {
      return '<div class="tile"><b>' + esc(t[0]) + '</b><span>' + esc(t[1]) + '</span></div>';
    }).join('');
    document.getElementById('asof').textContent = R.asOf;
    document.getElementById('counts').textContent = E.boardN + ' ranked of 758 scanned, ' + E.compsN + ' traded comps';
  }

  // ---------- board ----------
  var state = { q: '', cat: '', verdict: '' };
  function filteredRows() {
    var q = state.q.toLowerCase();
    return rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      return true;
    });
  }
  function renderBoard() {
    var list = filteredRows();
    var tb = document.querySelector('#board tbody');
    tb.innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="meta">' + esc(r.slug) + ' · ' + esc(r.category) + ' · ' + r.chains + ' chain' + (r.chains === 1 ? '' : 's') + (r.watchlist ? ' · watchlist' : '') + (r.kin ? ' · family token' : '') + '</span></td>' +
        '<td>' + money(r.tvl_usd) + '</td>' +
        '<td>' + (r.change_7d === null ? '—' : signed(r.change_7d)) + '</td>' +
        '<td>' + (r.age_days === null ? '—' : r.age_days + 'd') + '</td>' +
        '<td>' + money(r.implied_value_usd) + '</td>' +
        '<td>' + pct(r.odds) + '</td>' +
        '<td>' + money(r.expected_value_usd) + '</td>' +
        '<td>' + pct(r.own_token_share, 0) + '</td>' +
        '<td>' + dollars(r.net_usd) + '</td>' +
        '<td><span class="badge ' + r.verdict + '">' + r.verdict + '</span></td></tr>';
    }).join('');
    document.getElementById('shown').textContent = list.length + ' of ' + rows.length + ' rows';
    tb.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }
  function renderCatOptions() {
    var cats = Array.from(new Set(rows.map(function (r) { return r.category; }))).sort();
    var sel = document.getElementById('fcat');
    cats.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c + ' (' + rows.filter(function (r) { return r.category === c; }).length + ')';
      sel.appendChild(o);
    });
  }

  // ---------- detail dialog ----------
  function openDetail(slug) {
    var r = rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    var dlg = document.getElementById('detail');
    var logSum = r.contrib_intercept + r.contrib_size + r.contrib_growth;
    dlg.innerHTML = '<div class="dlg"><button class="close" id="dlgclose">Close</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<p class="meta">' + esc(r.slug) + ' · ' + esc(r.category) + ' · ' + r.chains + ' chain' + (r.chains === 1 ? '' : 's') + (r.watchlist ? ' · on the watchlist' : ' · early, below the floor') + ' · TVL ' + money(r.tvl_usd) + ' · 7d ' + (r.change_7d === null ? '—' : signed(r.change_7d)) + ' · age ' + (r.age_days === null ? '—' : r.age_days + ' days') + '</p>' +
      '<div class="grid">' +
      '<div><b>' + money(r.implied_value_usd) + '</b><span>implied value if it launches</span></div>' +
      '<div><b>' + pct(r.odds) + '</b><span>odds it ever records a token</span></div>' +
      '<div><b>' + money(r.expected_value_usd) + '</b><span>expected value = implied × odds × share</span></div>' +
      '<div><b>' + pct(r.own_token_share, 0) + '</b><span>own-token share</span></div>' +
      '<div><b>' + money(r.range_lo_usd) + ' – ' + money(r.range_hi_usd) + '</b><span>P25–P75 range of the implied value</span></div>' +
      '<div><b>#' + r.rank_band_lo + '–#' + r.rank_band_hi + '</b><span>rank band over 200 bootstrap refits</span></div>' +
      '<div><b>' + dollars(r.net_usd) + '</b><span>net: expected drop ' + dollars(r.expected_drop_usd) + ' − cost ' + dollars(r.total_cost_usd) + '</span></div>' +
      '<div><b>' + r.verdict + '</b><span>farm verdict · deposit $' + r.deposit_usd + ' · hold until ' + r.hold_until_date + ' · break-even ' + (r.break_even_date || 'none') + '</span></div>' +
      '</div>' +
      '<h3>How the implied value is built (log10 contributions)</h3>' +
      '<p>intercept ' + r.contrib_intercept.toFixed(2) + ' + size ' + r.contrib_size.toFixed(2) + ' + growth ' + r.contrib_growth.toFixed(2) + ' = ' + logSum.toFixed(2) + ' → ' + money(r.implied_value_usd) + '. The growth term is the 7-day TVL change, clamped to [−60%, +120%].</p>' +
      (r.kin ? '<p><b>Family token:</b> ' + esc(r.kin_name || 'a same-stem protocol') + ' already records a token. The value is not discounted for this — the fitted family factor is a premium from 3 comps, not a discount — but the odds model credits it (see the Model &amp; tests tab).</p>' : '') +
      '<h3>Farm plan — 8 dated, costed steps</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></div>';
    document.getElementById('dlgclose').addEventListener('click', function () { dlg.close(); });
    if (!dlg.open) dlg.showModal();
  }

  // ---------- Model & tests tab ----------
  function verdictBadge(v) {
    if (v === 'kept') return '<span class="badge kept">kept</span>';
    if (v === 'control') return '<span class="badge control">control</span>';
    return '<span class="badge notkept">tested-not-kept</span>';
  }
  function renderModel() {
    var keptV = E.valueTerms.filter(function (t) { return t.verdict === 'kept'; }).map(function (t) { return t.label; });
    var keptO = E.oddsTerms.filter(function (t) { return t.verdict === 'kept'; }).map(function (t) { return t.label; });
    var h = '<div class="model">';
    h += '<h2>The model</h2>' +
      '<p>Value: log10(market cap) = ' + E.valueBeta[0].toFixed(2) + ' + ' + E.valueBeta[1].toFixed(2) + ' × log10(TVL)' +
      (E.valueTerms.some(function (t) { return t.term === 'growth' && t.verdict === 'kept'; }) ? ' + ' + E.valueBeta[2].toFixed(2) + ' × growth' : '') +
      ', fit by OLS on ' + E.compsN + ' traded comps with a usable cap and a listing date (of ' + E.compsPriced + ' priced tokens). ' +
      'A term is kept only if adding it to the base lowers the held-out error in <b>both</b> tests — leave-one-out and walk-forward (older half fits, newer half scored) — by at least 1% for the value model and 0.002 Brier for the odds model. A term that wins by a hair is noise, not signal. ' +      'Kept for value: ' + (keptV.length ? keptV.join(', ') : 'none beyond size') + '. Kept for odds: ' + (keptO.length ? keptO.join(', ') : 'none beyond age and size') + '.</p>';
    h += '<h3>Value coefficients (bootstrap SE, 200 refits)</h3><table><thead><tr><th>Term</th><th class="num">Coefficient</th><th class="num">SE</th></tr></thead><tbody>' +
      E.valueLabels.map(function (lab, i) {
        return '<tr><td>' + esc(lab) + '</td><td class="num">' + E.valueBeta[i].toFixed(3) + '</td><td class="num">± ' + E.valueSe[i].toFixed(3) + '</td></tr>';
      }).join('') + '</tbody></table>';
    h += '<h3>Value terms — two tests each</h3><table><thead><tr><th>Term</th><th class="num">LOO miss</th><th class="num">Walk-forward miss</th><th class="num">Win share, 200 splits</th><th>Verdict</th><th>Note</th></tr></thead><tbody>' +
      '<tr><td>size only (base)</td><td class="num">×' + E.valueBaseLoo.toFixed(2) + '</td><td class="num">×' + E.valueBaseWf.toFixed(2) + '</td><td class="num">—</td><td>base</td><td>The base every candidate is added to. Flat-median baseline: LOO ×' + E.valueFlatLoo.toFixed(2) + ', walk-forward ×' + E.valueFlatWf.toFixed(2) + '.</td></tr>' +
      E.valueTerms.map(function (t) {
        return '<tr><td>' + esc(t.label) + '</td><td class="num">×' + t.loo.toFixed(2) + '</td><td class="num">×' + t.wf.toFixed(2) + '</td><td class="num">' + pct(t.winShare, 0) + '</td><td>' + verdictBadge(t.verdict) + '</td><td>' + esc(t.note) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p>Final value model: LOO ×' + E.valueLoo.toFixed(2) + ', walk-forward ×' + E.valueWf.toFixed(2) + ' — against a flat median of ×' + E.valueFlatLoo.toFixed(2) + ' / ×' + E.valueFlatWf.toFixed(2) + '.</p>';
    h += '<h3>Odds terms — two tests each (Brier, lower is better)</h3><table><thead><tr><th>Term</th><th class="num">LOO Brier</th><th class="num">Walk-forward Brier</th><th class="num">Win share, 200 splits</th><th>Verdict</th><th>Note</th></tr></thead><tbody>' +
      '<tr><td>age + size (base)</td><td class="num">' + E.oddsBaseLoo.toFixed(3) + '</td><td class="num">' + E.oddsBaseWf.toFixed(3) + '</td><td class="num">—</td><td>base</td><td>Base rate of the ' + E.peersN + ' peers is ' + pct(E.peersBaseRate) + ', Brier ' + E.oddsBaseBrier.toFixed(3) + '.</td></tr>' +
      E.oddsTerms.map(function (t) {
        return '<tr><td>' + esc(t.label) + '</td><td class="num">' + t.loo.toFixed(3) + '</td><td class="num">' + t.wf.toFixed(3) + '</td><td class="num">' + pct(t.winShare, 0) + '</td><td>' + verdictBadge(t.verdict) + '</td><td>' + esc(t.note) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p>Final odds model: Brier LOO ' + E.oddsLooBrier.toFixed(3) + ', walk-forward ' + E.oddsWfBrier.toFixed(3) + ', against a base rate of ' + E.oddsBaseBrier.toFixed(3) + '.</p>';
    h += '<h3>Range honesty — do the printed bands cover what they state?</h3>' +
      '<p>Intervals come from held-out residuals only. P25–P75 states 50%, P10–P90 states 80%.</p>' +
      '<table><thead><tr><th>Test</th><th class="num">P25–P75 coverage</th><th class="num">P10–P90 coverage</th><th class="num">Held-out caps</th></tr></thead><tbody>' +
      '<tr><td>Leave-one-out (2-fold split)</td><td class="num">' + pct(E.rangeHonesty.looP2575, 0) + '</td><td class="num">' + pct(E.rangeHonesty.looP1090, 0) + '</td><td class="num">' + E.rangeHonesty.looN + '</td></tr>' +
      '<tr><td>Walk-forward</td><td class="num">' + pct(E.rangeHonesty.wfP2575, 0) + '</td><td class="num">' + pct(E.rangeHonesty.wfP1090, 0) + '</td><td class="num">' + E.rangeHonesty.wfN + '</td></tr>' +
      '</tbody></table><p>' + esc(E.rangeHonesty.note) + '</p>';
    h += '<h3>Named rivals — win share against the final model, 200 splits</h3>' +
      '<table><thead><tr><th>Rival</th><th class="num">LOO</th><th class="num">Walk-forward</th><th class="num">Beats the final model</th></tr></thead><tbody>' +
      E.valueRivals.map(function (r) {
        return '<tr><td>' + esc(r.name) + ' (value)</td><td class="num">×' + r.loo.toFixed(2) + '</td><td class="num">×' + r.wf.toFixed(2) + '</td><td class="num">' + pct(r.winShareVsFinal, 0) + ' of splits</td></tr>';
      }).join('') +
      E.oddsRivals.map(function (r) {
        return '<tr><td>' + esc(r.name) + ' (odds)</td><td class="num">' + r.loo.toFixed(3) + '</td><td class="num">' + r.wf.toFixed(3) + '</td><td class="num">' + pct(r.winShareVsFinal, 0) + ' of splits</td></tr>';
      }).join('') + '</tbody></table>';
    h += '<h3>Own-token share — tested, not applied as a discount</h3>' +
      '<p>Adding a family-token dummy to the value model gives a coefficient of ' + E.kinBeta.toFixed(2) + ' ± ' + E.kinSe.toFixed(2) + ' (bootstrap SE) — a <b>premium</b>, not a discount, estimated from only ' + E.kinCompsN + ' comps that carry the flag, and it does not lower the held-out miss in both tests (LOO ×' + E.valueTerms.find(function (t) { return t.term === 'kin'; }).loo.toFixed(2) + ', walk-forward ×' + E.valueTerms.find(function (t) { return t.term === 'kin'; }).wf.toFixed(2) + ' against a size-only base of ×' + E.valueBaseLoo.toFixed(2) + ' LOO and ×' + E.valueBaseWf.toFixed(2) + ' walk-forward). ' +
      'Applying it would inflate the values of family protocols on three comps of evidence, so the own-token share is 100% for every row and the formula stays explicit: value = value-if-launches × odds × share. ' +
      'The family effect is used where the data support it: in the odds model, where the family-token term lowers the Brier score in both tests and is kept.</p>';
    h += '<h3>Self-test (recomputed in this page, same invariants as the program)</h3>' +
      '<table><thead><tr><th>Invariant</th><th>Result</th><th>Detail</th></tr></thead><tbody>' +
      selfTest().map(function (t) {
        return '<tr><td>' + esc(t.name) + '</td><td class="' + (t.pass ? 'pass' : 'fail') + '">' + (t.pass ? 'PASS' : 'FAIL') + '</td><td>' + esc(t.detail) + '</td></tr>';
      }).join('') + '</tbody></table>';
    h += '<p>Checksum ' + esc(E.checksum) + ' · dossier text ' + E.dossierTextBytes + ' bytes of 65,536 · odds coefficients: ' +
      E.oddsLabels.map(function (lab, i) { return esc(lab) + ' ' + E.oddsBeta[i].toFixed(3); }).join(', ') + '.</p>';
    h += '</div>';
    document.getElementById('model').innerHTML = h;
  }

  // ---------- Coverage tab ----------
  function renderCoverage() {
    var total = E.accounting.reduce(function (a, g) { return a + g.count; }, 0);
    var colors = ['#2e7d32', '#66bb6a', '#1565c0', '#90caf9', '#ef6c00', '#ffb74d', '#8e24aa', '#ce93d8', '#616161'];
    var bar = '<div class="bar">' + E.accounting.map(function (g, i) {
      return '<div style="width:' + (g.count / total * 100).toFixed(2) + '%;background:' + colors[i % colors.length] + '" title="' + esc(g.label) + ' ' + g.count + '"></div>';
    }).join('') + '</div>';
    var h = '<div class="coverage"><h2>Coverage — all ' + total + ' protocols accounted for</h2>' + bar +
      '<table><thead><tr><th>Group</th><th class="num">Count</th><th>Detail</th></tr></thead><tbody>' +
      E.accounting.map(function (g) {
        return '<tr><td>' + esc(g.label) + '</td><td class="num">' + g.count + '</td><td>' + esc(g.detail) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p>The board is the whole watchlist (40/40) plus the top 158 rankable protocols below the $' + (R.floorUsd / 1e6) + 'M floor by TVL — the kit starter\u2019s rule. ' +
      'Rankable means pre-token, not an exchange, not a versioned name. The early set includes bridge, staking and wrapped-name rows (the house list keeps those categories off the watchlist, but the starter\u2019s rule ranks by TVL below the floor); they are listed here so the count still sums to 758.</p>' +
      '<p>Comps: ' + E.compsN + ' traded protocols with a usable cap and a listing date fit the value model (of ' + E.compsPriced + ' priced tokens). Odds peers: ' + E.peersN + ' protocols with a listing date, base rate ' + pct(E.peersBaseRate) + '.</p></div>';
    document.getElementById('coverage').innerHTML = h;
  }

  // ---------- tabs, hash routing, init ----------
  function showTab(name) {
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.tabpage').forEach(function (s) {
      s.hidden = s.id !== 'tab-' + name;
    });
  }
  function readHash() {
    var h = {};
    location.hash.slice(1).split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) h[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    return h;
  }
  function init() {
    renderKpi();
    renderCatOptions();
    var h = readHash();
    if (h.q) { state.q = h.q; document.getElementById('q').value = h.q; }
    if (h.category) { state.cat = h.category; document.getElementById('fcat').value = h.category; }
    if (h.verdict) { state.verdict = h.verdict; document.getElementById('fverdict').value = h.verdict; }
    renderBoard();
    renderModel();
    renderCoverage();
    document.getElementById('integrity').textContent = 'Checksum ' + E.checksum + ' · dossier text ' + E.dossierTextBytes + ' bytes of 65,536 · ' +
      selfTest().filter(function (t) { return t.pass; }).length + ' of ' + selfTest().length + ' self-test invariants hold in this page.';
    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
    document.getElementById('fcat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
    document.getElementById('fverdict').addEventListener('change', function (e) { state.verdict = e.target.value; renderBoard(); });
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
    });
    if (h.tab) showTab(h.tab);
    if (h.p) openDetail(h.p);
  }
  init();
})();
