// Token Radar v7 — the page. Reads window.EVIDENCE + window.ROWS (evidence.js),
// recomputes the derived numbers from the same formulas lib/model.ts uses,
// and renders the board, the farm plans, the model evidence and the coverage.
//
// Row array order: [rank, slug, name, category, chain, tvl, change7d, age,
// watchlist 0/1, kin 0/1, kin name, implied, ev, odds, band lo, band hi,
// verdict 0/1/2] (0 FARM, 1 MARGINAL, 2 SKIP).
// Screenshot helpers (?shot=board|farms|model|detail&slug=...) only choose what
// the capture shows; the page works the same without them.
(function () {
  var E = window.EVIDENCE, ROWS = window.ROWS;
  var $ = function (id) { return document.getElementById(id); };
  var V = ['FARM', 'MARGINAL', 'SKIP'];
  var money = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
  var moneyM = function (n) { return '$' + (n / 1e6).toFixed(1) + 'M'; };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var R = function (r) {
    return { rank: r[0], slug: r[1], name: r[2], cat: r[3] || null, chain: r[4], tvl: r[5], chg: r[6], age: r[7], wl: !!r[8], kin: !!r[9], kinName: r[10] || null, implied: r[11], ev: r[12], odds: r[13], bandLo: r[14], bandHi: r[15], verdict: V[r[16]] };
  };
  var rows = ROWS.map(R);
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var q25 = E.honesty.q25, q75 = E.honesty.q75;
  var dropOf = function (r) { return Math.round((r.ev * 0.07 * 2000) / (0.1 * r.tvl) * 100) / 100; };
  var netOf = function (r) { return Math.round((dropOf(r) - 11) * 100) / 100; };
  var rangeLo = function (r) { return Math.max(1, Math.round(r.implied * Math.pow(10, q25))); };
  var rangeHi = function (r) { return Math.max(1, Math.round(r.implied * Math.pow(10, q75))); };
  var holdUntil = (function () { var d = new Date(E.asOf + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 364); return d.toISOString().slice(0, 10); })();

  // The farm plan: the same eight steps lib/model.ts writes into board.json,
  // generated here from the same inputs so the page and the board agree.
  function actionFor(r) {
    var c = (r.cat || '').toLowerCase(), n = r.name, ch = r.chain || 'its main chain';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $2,000 of USDC to ' + n + ' on ' + ch + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $2,000 of liquidity to ' + n + "'s main pool on " + ch + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $2,000 of USDC to ' + ch + ' through ' + n + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $2,000 of the chain' + "'s staking asset through " + n + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $2,000 of USDC as margin on ' + n + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $2,000 and place one market position on ' + n + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $2,000 into a ' + n + ' vault on ' + ch + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $2,000 of the stable asset through ' + n + ' on ' + ch + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $2,000 of the protocol' + "'s yield asset on " + ch + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $2,000 of cover from ' + n + ' on ' + ch + ' and keep the policy.';
    return 'Deposit $2,000 of USDC into ' + n + ' on ' + ch + ' and keep the position open.';
  }
  function farmSteps(r) {
    var net = netOf(r), drop = dropOf(r);
    var word = net >= 10 ? 'a farm' : net >= 0 ? 'a thin farm' : 'not a farm on these numbers';
    var steps = [
      ['Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'],
      [actionFor(r), '$2,000 of capital and about $8 of gas', '15 minutes to set up'],
      ['Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', 'about $2 of gas a week', '10 minutes a week'],
      ['Hold the position for at least 52 weeks so the activity is counted in more than one snapshot, until ' + holdUntil + '.', 'the $2,000 stays in the position', '52 weeks'],
      ['This board prices the position at an expected drop of $' + drop.toFixed(2) + ' against $11 of gas, a net of $' + net.toFixed(2) + ' — ' + word + '.', 'the $11 of gas is already counted', 'read the board before you start'],
      ['Before you withdraw, open the protocol' + "'s own points or rewards page and claim only from the link it publishes.", 'no fee to check, and never pay to claim', '10 minutes'],
      ['If the protocol records a token before the 52 weeks are up, check the claim window at once — airdrop claims expire.', 'nothing but the check', '10 minutes'],
      ['Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes'],
    ];
    return steps.map(function (s) { var t = s[0] + ' Cost: ' + s[1] + '. Time: ' + s[2] + '.'; return t.length > 600 ? t.slice(0, 596) + '...' : t; });
  }

  // ---- header numbers ----
  var ageRow = null, baseRow = null;
  E.oddsTests.forEach(function (t) { if (t.term === 'age (log10 days)') ageRow = t; if (t.term === 'base rate only') baseRow = t; });
  $('kpis').innerHTML =
    kpi('Value LOO', 'x' + E.valueLoo, 'median miss, 90 comps') +
    kpi('Value walk-forward', 'x' + E.valueWf, '3 splits, older to newer') +
    kpi('Value 5-fold CV', 'x' + E.valueCv, 'x5 seeds') +
    kpi('Odds Brier LOO', ageRow.loo, 'age-only logistic, n=' + E.oddsPop + ' · base ' + ageRow.looBase) +
    kpi('Odds Brier walk-forward', ageRow.wf, 'beats base ' + ageRow.wfBase + ' on both tests') +
    kpi('Board', E.coverage.ranked + ' / ' + E.coverage.scanned, E.coverage.watchlistCovered + '/' + E.coverage.watchlist + ' watchlist') +
    kpi('Farms', E.farmCounts.farm + ' FARM', E.farmCounts.marginal + ' marginal · ' + E.farmCounts.skip + ' skip') +
    kpi('Top implied', moneyM(E.topRow.implied), E.topRow.name + ' · odds ' + E.topRow.odds + ' · EV ' + moneyM(E.topRow.ev));
  function kpi(label, value, sub) { return '<div class="kpi"><b>' + esc(value) + '</b><span>' + esc(label) + ' — ' + esc(sub) + '</span></div>'; }
  $('bestfarms').innerHTML = E.bestFarms.map(function (f) {
    return '<div class="farmcard"><b>+' + money(f.net) + ' net</b><span>' + esc(f.name) + ' · implied ' + moneyM(f.implied) + ' · odds ' + f.odds + ' · EV ' + moneyM(f.ev) + '</span></div>';
  }).join('');
  $('integrity').innerHTML = '<b>Integrity strip —</b> ' + E.selfTest.map(esc).join(' · ');
  (function () {
    var c = E.coverage;
    var seg = function (n, cls, label) { var pct = n / c.scanned; return '<div class="' + cls + '" style="flex:' + n + '">' + (pct >= 0.04 ? label : '') + '</div>'; };
    $('accounting').innerHTML = '<div class="bar">' + seg(c.ranked, 'ranked', 'ranked ' + c.ranked) + seg(c.liveWithMcap, 'live', 'live ' + c.liveWithMcap) + seg(c.tokenRecordedNoCap, 'nocap', 'token, no cap ' + c.tokenRecordedNoCap) + seg(c.tokenRecordedZeroCap, 'zero', 'zero cap ' + c.tokenRecordedZeroCap) + seg(c.preTokenNotRanked, 'notranked', 'pre-token, not ranked ' + c.preTokenNotRanked) + '</div>' +
      '<div class="legend">All ' + c.scanned + ' protocols in the snapshot, accounted for. ' + c.watchlistCovered + ' of ' + c.watchlist + ' watchlist protocols are on the board; ' + c.preTokenNotRanked + ' pre-token protocols are not ranked.</div>';
  })();
  $('term-table').innerHTML = table(
    ['Term', 'LOO', 'Walk-forward', '5-fold CV', 'Win share /200', 'Kept?'],
    E.valueTests.map(function (t) { return [t.term, 'x' + t.loo, 'x' + t.wf, 'x' + t.cv, t.winShare, t.kept ? 'KEPT' : 'tested, not kept']; }));
  $('honesty').innerHTML = '<dl class="kv">' +
    kv('Inside P25–P75, leave-one-out', (E.honesty.loo2575 * 100).toFixed(1) + '% (stated 50%)') +
    kv('Inside P10–P90, leave-one-out', (E.honesty.loo1090 * 100).toFixed(1) + '% (stated 80%)') +
    kv('Inside P25–P75, walk-forward', (E.honesty.wf2575 * 100).toFixed(1) + '% (stated 50%)') +
    kv('Inside P10–P90, walk-forward', (E.honesty.wf1090 * 100).toFixed(1) + '% (stated 80%)') +
    kv('Range factors', 'P25 x' + Math.pow(10, E.honesty.q25).toFixed(2) + ' · P75 x' + Math.pow(10, E.honesty.q75).toFixed(2)) +
    '</dl>';
  function kv(k, v) { return '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>'; }
  function table(head, rowsHtml) {
    return '<table><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rowsHtml.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (i > 0 ? ' class="num"' : '') + '>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }

  // ---- board table ----
  var sortKey = 'rank', sortDir = 1;
  var sortFns = { rank: function (a, b) { return a.rank - b.rank; }, name: function (a, b) { return a.name < b.name ? -1 : 1; }, tvl: function (a, b) { return a.tvl - b.tvl; }, age: function (a, b) { return (a.age || 0) - (b.age || 0); }, implied: function (a, b) { return a.implied - b.implied; }, odds: function (a, b) { return a.odds - b.odds; }, ev: function (a, b) { return a.ev - b.ev; }, net: function (a, b) { return netOf(a) - netOf(b); }, verdict: function (a, b) { return a.verdict < b.verdict ? -1 : 1; } };
  var cats = [];
  rows.forEach(function (r) { if (r.cat && cats.indexOf(r.cat) < 0) cats.push(r.cat); });
  cats.sort();
  $('f-cat').innerHTML = '<option value="">all</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  function filtered() {
    var v = $('f-verdict').value, c = $('f-cat').value, w = $('f-watch').checked, q = ($('f-q').value || '').toLowerCase();
    var list = rows.filter(function (r) {
      return (!v || r.verdict === v) && (!c || r.cat === c) && (!w || r.wl) && (!q || r.name.toLowerCase().indexOf(q) >= 0 || r.slug.indexOf(q) >= 0);
    });
    list.sort(function (a, b) { return sortFns[sortKey](a, b) * sortDir; });
    return list;
  }
  function renderBoard() {
    var list = filtered();
    $('rowcount').textContent = list.length + ' of ' + rows.length + ' rows (sorted by ' + sortKey + ')';
    $('board').querySelector('tbody').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td><td><b>' + esc(r.name) + '</b><br><span style="color:#8b949e">' + esc(r.cat || 'no category') + ' · ' + esc(r.chain || '—') + (r.wl ? ' · watchlist' : '') + (r.kin ? ' · kin: ' + esc(r.kinName) : '') + '</span></td>' +
        '<td class="num">' + moneyM(r.tvl) + '</td><td class="num">' + (r.age === null ? '—' : r.age + 'd') + '</td>' +
        '<td class="num">' + money(r.implied) + '<br><span style="color:#8b949e">' + money(rangeLo(r)) + '–' + money(rangeHi(r)) + '</span></td>' +
        '<td class="num">' + r.odds.toFixed(3) + '</td><td class="num">' + money(r.ev) + '</td>' +
        '<td class="num">' + (netOf(r) >= 0 ? '+' : '') + money(netOf(r)) + '</td><td><span class="badge ' + r.verdict + '">' + r.verdict + '</span></td></tr>';
    }).join('');
  }
  function showDetail(r, el) {
    var steps = farmSteps(r);
    el.innerHTML = '<h3>#' + r.rank + ' ' + esc(r.name) + ' <span class="badge ' + r.verdict + '">' + r.verdict + '</span></h3>' +
      '<div class="meta">' + esc(r.cat || 'no category') + ' · ' + esc(r.chain || '—') + ' · TVL ' + money(r.tvl) + ' · age ' + (r.age === null ? 'unknown' : r.age + ' days') + (r.wl ? ' · on the watchlist' : '') + (r.kin ? ' · family token: ' + esc(r.kinName) : '') + '<br>' +
      'Implied value ' + money(r.implied) + ' (range ' + money(rangeLo(r)) + '–' + money(rangeHi(r)) + ', rank band ' + r.bandLo + '–' + r.bandHi + ') · 24-month odds ' + r.odds.toFixed(3) + ' · expected value ' + money(r.ev) + ' · own-token share 100%<br>' +
      'Farm: $2,000 in, expected drop ' + money(dropOf(r)) + ', gas $11, net ' + (netOf(r) >= 0 ? '+' : '') + money(netOf(r)) + ', hold until ' + holdUntil + (netOf(r) >= 0 ? ', break-even ' + holdUntil : ', never breaks even on these numbers') + '</div>' +
      '<div class="steps"><b>Farm plan — eight steps:</b><ol>' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>';
  }
  $('board').querySelector('tbody').addEventListener('click', function (e) { var tr = e.target.closest('tr'); if (tr) showDetail(bySlug[tr.getAttribute('data-slug')], $('detail')); });
  $('board').querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () { var k = th.getAttribute('data-sort'); if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; } renderBoard(); });
  });
  ['f-verdict', 'f-cat', 'f-watch', 'f-q'].forEach(function (id) { $(id).addEventListener('input', renderBoard); });
  renderBoard();
  showDetail(rows[0], $('detail'));

  // ---- farms tab ----
  (function () {
    var farms = rows.filter(function (r) { return r.verdict === 'FARM'; }).sort(function (a, b) { return netOf(b) - netOf(a); });
    $('farmstable').querySelector('tbody').innerHTML = farms.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td><td><b>' + esc(r.name) + '</b></td><td class="num">' + moneyM(r.tvl) + '</td><td class="num">' + money(r.implied) + '</td><td class="num">' + r.odds.toFixed(3) + '</td><td class="num">' + money(r.ev) + '</td><td class="num">' + money(dropOf(r)) + '</td><td class="num">+' + money(netOf(r)) + '</td></tr>';
    }).join('');
    $('farmstable').querySelector('tbody').addEventListener('click', function (e) { var tr = e.target.closest('tr'); if (tr) showDetail(bySlug[tr.getAttribute('data-slug')], $('farmdetail')); });
    if (farms[0]) showDetail(farms[0], $('farmdetail'));
  })();

  // ---- model tab ----
  $('value-model').innerHTML = '<dl class="kv">' +
    kv('Model', 'log10(mcap) = ' + E.valueBeta[0] + ' + ' + E.valueBeta[1] + ' x log10(TVL)') +
    kv('Slope (size exponent)', E.valueBeta[1] + ' ± ' + E.valueBetaSe[1] + ' (bootstrap SE, 200 refits)') +
    kv('Intercept', E.valueBeta[0] + ' ± ' + E.valueBetaSe[0]) +
    kv('Median miss', 'LOO x' + E.valueLoo + ' · walk-forward x' + E.valueWf + ' · 5-fold CV x' + E.valueCv) +
    kv('Flat multiple rival', 'x' + E.flatRival.loo + ' LOO / x' + E.flatRival.wf + ' WF at multiple ' + E.flatRival.multiple + ' — the size curve beats it ' + (E.flatRival.loo / E.valueLoo).toFixed(1) + 'x on LOO') +
    '</dl>';
  $('value-table').innerHTML = table(['Term', 'LOO', 'WF', 'CV', 'Win share', 'Kept?'], E.valueTests.map(function (t) { return [t.term, 'x' + t.loo, 'x' + t.wf, 'x' + t.cv, t.winShare, t.kept ? 'KEPT' : 'no']; }));
  $('odds-model').innerHTML = '<dl class="kv">' +
    kv('Model', 'logit P(listed by age A) = ' + E.oddsBeta[0] + ' + ' + E.oddsBeta[1] + ' x log10(age)') +
    kv('Age coefficient', E.oddsBeta[1] + ' ± ' + E.oddsBetaSe[1] + ' (bootstrap SE, 200 refits)') +
    kv('Population', E.oddsPop + ' protocols with age >= 730 days (outcome known); base rate ' + E.oddsBaseRate + ', base Brier ' + E.oddsBaseBrier) +
    kv('200-split win share', E.oddsAgeWinShare + ' vs the base rate') +
    kv('What the odds mean', 'odds(A) = [F(730) - F(A)] / [1 - F(A)]: the chance a protocol still tokenless at age A records one within its first 24 months') +
    '</dl>';
  $('odds-table').innerHTML = table(['Term', 'LOO Brier', 'LOO base', 'WF Brier', 'WF base', 'Kept?', 'Why'], E.oddsTests.map(function (t) { return [t.term, t.loo, t.looBase, t.wf, t.wfBase, t.kept ? 'KEPT' : 'no', t.note || '']; }));
  $('odds-curve').innerHTML = table(['Age', 'Odds (24m)'], E.oddsAt.map(function (p) { return [p[0] + ' days', p[1]]; }));
  $('cohorts').innerHTML = table(['Listed', 'n', 'With token', 'Rate'], E.cohortByYear.map(function (c) { return [c.label, c.n, c.listed, c.rate]; })) +
    '<br>' + table(['Age band', 'n', 'With token', 'Share'], E.cohortByAgeBand.map(function (c) { return [c.label, c.n, c.listed, c.rate]; }));
  $('rivals').innerHTML = '<dl class="kv">' +
    kv('Flat multiple (value)', 'LOO x' + E.flatRival.loo + ' / WF x' + E.flatRival.wf + ' — worse than the size curve on both tests') +
    kv('Kitchen-sink odds (age+growth+kin+size)', 'LOO ' + E.oddsTests[7].loo + ' / WF ' + E.oddsTests[7].wf + ' — beats age alone on both tests, but only through the kin term: 8 kin protocols, 0 listed in the clean population, so the coefficient runs to about -12 and is not identified. It would zero out the board\'s 8 kin rows on n=8 evidence, so it is not kept.') +
    kv('Control (another row\'s growth)', 'value LOO x' + E.valueTests[11].loo + ' vs size-only x' + E.valueTests[0].loo + '; odds LOO ' + E.oddsTests[9].loo + ' — a nonsense term that "wins" LOO proves the noise floor, not a model') +
    '</dl>';
  $('pipeline').innerHTML = '<dl class="kv">' +
    kv('With a token recorded', E.comps.recorded) +
    kv('With a usable cap (mcap > 0)', E.comps.usableCap) +
    kv('One per ticker symbol', E.comps.onePerTicker) +
    kv('Dated (listed_at known)', E.comps.dated) +
    kv('Kept after dropping mcap/TVL > 10', E.comps.kept + ' (' + E.comps.droppedRatio.join(', ') + ' dropped)') +
    '</dl>';

  // ---- coverage tab ----
  (function () {
    var c = E.coverage;
    $('coverage').innerHTML = '<dl class="kv">' +
      kv('Protocols scanned', c.scanned) +
      kv('Ranked on the board', c.ranked) +
      kv('Live with a market cap', c.liveWithMcap + ' (shown at the market\'s own values, never ranked)') +
      kv('Token recorded, no cap', c.tokenRecordedNoCap) +
      kv('Token recorded, zero/negative cap', c.tokenRecordedZeroCap) +
      kv('Pre-token, not ranked', c.preTokenNotRanked + ' (below the floor and not in the early radar)') +
      kv('Watchlist', c.watchlistCovered + ' of ' + c.watchlist + ' covered') +
      '</dl>';
  })();
  $('asof').textContent = E.asOf;

  // ---- tabs + screenshot helpers ----
  function showTab(name) {
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('on', t.id === 'tab-' + name); });
  }
  document.querySelectorAll('nav button').forEach(function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); }); });
  var q = new URLSearchParams(location.search);
  var shot = q.get('shot');
  if (shot === 'farms') showTab('farms');
  else if (shot === 'model') showTab('model');
  else if (shot === 'coverage') showTab('coverage');
  else if (shot === 'detail') { var r = bySlug[q.get('slug')] || rows[0]; showDetail(r, $('detail')); document.body.classList.add('shot-detail'); }
})();
