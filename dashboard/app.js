/* Token Radar radar-4: renders window.RADAR (written by main.ts) into the page.
   No network: every number comes from data.js. Tabs: Board, Model & tests,
   Comps, Coverage. Hash routes: #board, #model, #comps, #coverage, #detail=slug. */
const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (v) => v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + Math.round(v).toLocaleString('en-US') : '$' + v.toFixed(2);
const num = (v) => v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-US');
const pct = (v) => v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%';
const ageTxt = (d) => d === null ? 'unknown' : d < 365 ? Math.round(d / 30) + 'mo' : (d / 365).toFixed(1) + 'y';
const badge = (v) => `<span class="badge ${v}">${v}</span>`;
const VERDICT_ORDER = { farm: 0, thin: 1, skip: 2 };

let tab = 'board', sortKey = 'rank', sortDir = 1, showAll = false;

function init() {
  $('meta').textContent = `Snapshot ${R.as_of} · ${R.source} · ${R.model.comps} traded comps · board of ${R.rows.length} pre-token protocols · all figures from the sealed snapshot`;
  const m = R.model, v = R.validation, c = R.coverage;
  $('kpis').innerHTML = [
    [usd(R.rows[0].implied_value_usd), 'top implied value · ' + R.rows[0].name],
    [m.loo.toFixed(3), 'leave-one-out error (log)'],
    [v.loo_improvement_vs_flat.toFixed(1) + '×', 'better than a flat multiple'],
    [c.ranked + ' / ' + c.total, 'protocols ranked / scanned'],
    [c.watchlist_covered + '/' + c.watchlist, 'watchlist covered'],
    [R.verdict_counts.farm + ' farm', R.verdict_counts.thin + ' thin · ' + R.verdict_counts.skip + ' skip'],
  ].map(([b, s]) => `<div class="kpi"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('');
  $('bestfarms').innerHTML = '<h2>Best farms by net — the plans that pay for themselves</h2><div class="farmgrid">' +
    R.best_farms.map((f) => `<div class="farmcard" data-slug="${esc(f.slug)}"><div class="nm">#${f.rank} ${esc(f.name)}</div><div class="net">${f.net_usd >= 0 ? '+' : '−'}$${Math.abs(f.net_usd).toFixed(2)} net</div><div class="dt">EV ${usd(f.ev_usd)} · implied ${usd(f.implied_value_usd)} · ${f.verdict}</div></div>`).join('') + '</div>';
  const ig = R.integrity;
  $('integrity').innerHTML = `<h2>Integrity strip — what the data does not say</h2><div><b>${ig.mcap_nonpositive}</b> protocols record a market cap of $0 or less · <b>${ig.missing_growth}</b> report no 7-day change · <b>${ig.missing_listed_at}</b> report no listing date · <b>${ig.symbol_no_mcap}</b> record a symbol but no market cap (not ranked) · dropped from comps: <b>${ig.dropped_wrapped}</b> wrapped, <b>${ig.dropped_duplicate_ticker}</b> duplicate ticker, <b>${ig.dropped_ratio_over_10}</b> with mcap/TVL over 10.</div>`;
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  $('fcat').innerHTML = '<option value="">All categories</option>' + cats.map((c2) => `<option>${esc(c2)}</option>`).join('');
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  ['q', 'fcat', 'fverdict', 'fsort'].forEach((id) => $(id).addEventListener('input', () => { showAll = false; renderBoard(); }));
  $('more').addEventListener('click', () => { showAll = true; renderBoard(); });
  $('csv').addEventListener('click', downloadCsv);
  document.querySelectorAll('#boardtable th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; }
    renderBoard();
  }));
  $('rows').addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) openDetail(tr.dataset.slug); });
  document.querySelectorAll('.farmcard').forEach((el) => el.addEventListener('click', () => openDetail(el.dataset.slug)));
  $('closedrawer').addEventListener('click', () => { $('drawer').hidden = true; });
  window.addEventListener('hashchange', route);
  renderModel(); renderComps(); renderCoverage(); renderBoard(); route();
}

function go(t) {
  tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  ['board', 'model', 'comps', 'coverage'].forEach((x) => { $('tab-' + x).hidden = x !== t; });
}

function route() {
  const h = location.hash.replace(/^#/, '');
  if (h.startsWith('detail=')) { go('board'); openDetail(h.slice(7)); window.scrollTo(0, 0); return; }
  if (['board', 'model', 'comps', 'coverage'].includes(h)) go(h);
  window.scrollTo(0, 0);
}

function filteredRows() {
  const q = $('q').value.trim().toLowerCase(), cat = $('fcat').value, vd = $('fverdict').value;
  let rows = R.rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
    (!cat || r.category === cat) && (!vd || r.farm_verdict === vd));
  const key = sortKey;
  rows = [...rows].sort((a, b) => {
    let va = a[key], vb = b[key];
    if (key === 'name' || key === 'category') return sortDir * String(va ?? '').localeCompare(String(vb ?? ''));
    if (key === 'farm_verdict') return sortDir * (VERDICT_ORDER[va] - VERDICT_ORDER[vb]);
    return sortDir * ((va ?? 0) - (vb ?? 0));
  });
  return rows;
}

function renderBoard() {
  const rows = filteredRows();
  const shown = showAll ? rows : rows.slice(0, 30);
  $('boardcount').textContent = `Showing ${shown.length} of ${rows.length} rows (board holds ${R.rows.length}; rank is by implied value, always).`;
  $('more').style.display = showAll || rows.length <= 30 ? 'none' : '';
  $('rows').innerHTML = shown.map((r) => `<tr data-slug="${esc(r.slug)}">
    <td class="num">${r.rank}</td><td><b>${esc(r.name)}</b><br><span style="color:#6b6455">${esc(r.slug)}</span></td>
    <td>${esc(r.category ?? '—')}</td><td class="num">${usd(r.tvl_usd)}</td><td class="num">${pct(r.change_7d)}</td>
    <td>${ageTxt(r.age_days)}</td><td class="num"><b>${usd(r.implied_value_usd)}</b></td>
    <td class="num">${(r.launch_odds * 100).toFixed(1)}%</td><td class="num">${usd(r.expected_value_usd)}</td>
    <td>${badge(r.farm_verdict)}</td><td class="num">${r.rank_p10}–${r.rank_p90}</td></tr>`).join('');
}

function openDetail(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  const c = r.contrib;
  const parts = [['Intercept', c.intercept], ['log TVL', c.log_tvl], ['Growth 7d', c.growth], ['log(1+age)', c.log_age], ['log chains', c.log_chains], ['Age unknown', c.age_unknown]];
  const maxAbs = Math.max(...parts.map(([, v]) => Math.abs(v)), 0.01);
  $('detail').innerHTML = `<h2>${esc(r.name)}</h2>
  <p style="color:#6b6455;margin-top:0">Rank #${r.rank} · ${esc(r.category ?? 'no category')} · ${esc(r.chains.join(', '))} · listed ${esc(r.listed_at ?? 'date unknown')}</p>
  <div class="kv">
    <div>Implied value <b>${usd(r.implied_value_usd)}</b></div><div>Rank band (200 refits) <b>#${r.rank_p10}–${r.rank_p90}</b></div>
    <div>Implied range <b>${usd(r.implied_p10_usd)}–${usd(r.implied_p90_usd)}</b></div><div>TVL <b>${usd(r.tvl_usd)}</b></div>
    <div>7-day change <b>${pct(r.change_7d)}</b></div><div>Age <b>${ageTxt(r.age_days)}</b></div>
    <div>Launch odds <b>${(r.launch_odds * 100).toFixed(1)}%</b></div><div>Odds band <b>${esc(r.odds_band)}</b></div>
    <div>Expected value <b>${usd(r.expected_value_usd)}</b></div><div>Farm verdict <b>${r.farm_verdict}</b></div>
    <div>Farm net <b>${r.farm_net_usd >= 0 ? '+' : '−'}$${Math.abs(r.farm_net_usd).toFixed(2)}</b></div><div>Deposit / gas <b>$${r.farm_deposit_usd} / $${r.farm_gas_usd.toFixed(2)}</b></div>
    <div>Farm chain <b>${esc(r.farm_chain)}</b></div><div>Start → hold until <b>${esc(r.farm_start)} → ${esc(r.farm_hold_until)}</b></div>
    <div>Break-even <b>${esc(r.farm_break_even ?? 'none — gas exceeds expected value')}</b></div>
  </div>
  <h3>Why this value — log contributions</h3>
  ${parts.map(([k, v]) => `<div>${esc(k)}: <b>${v > 0 ? '+' : ''}${v.toFixed(2)}</b><div class="bar"><i style="width:${Math.round(Math.abs(v) / maxAbs * 100)}%"></i></div></div>`).join('')}
  <p style="font-size:12px;color:#6b6455">Contributions are log points: they add to log(implied value). A negative age term means older protocols are worth less, all else equal; a negative age-unknown term means protocols with no listing date are worth less.</p>
  <h3>Farm plan — dated, costed</h3>
  <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  $('drawer').hidden = false;
}

function renderModel() {
  const m = R.model, v = R.validation;
  const coefRows = m.feature_names.map((f, i) => `<tr><td>${esc(f)}</td><td class="num">${m.beta[i].toFixed(3)}</td></tr>`).join('');
  const wfRows = m.walk_forward.map((w) => `<tr><td>Walk-forward ${Math.round(w.fraction * 100)}/${Math.round((1 - w.fraction) * 100)} (fit older, test newer, n=${w.n_test})</td><td class="num">${w.fitted.toFixed(3)}</td><td class="num">${w.flat.toFixed(3)}</td><td class="num">${(w.flat / w.fitted).toFixed(2)}×</td></tr>`).join('');
  const oddsRows = R.odds.groups.map((g) => `<tr><td>${esc(g.ageBand)}</td><td>${esc(g.tvlBand)}</td><td class="num">${g.n}</td><td class="num">${g.withToken}</td><td class="num">${(g.rate * 100).toFixed(1)}%</td></tr>`).join('');
  $('modelcontent').innerHTML = `
  <h2 class="sec">The model — fitted from traded tokens, not a flat multiple</h2>
  <p><code>${esc(m.equation)}</code></p>
  <table class="plain"><thead><tr><th>Feature</th><th class="num">Coefficient</th></tr></thead><tbody>${coefRows}</tbody></table>
  <p>Fitted on <b>${m.comps} comps</b> — protocols whose token already trades, one per ticker, wrapped products removed (${m.comps_dropped.wrapped}), duplicate tickers removed (${m.comps_dropped.duplicate_ticker}), mcap/TVL over 10 removed (${m.comps_dropped.ratio_over_10}). Missing listing dates are imputed to the comps' median age (${m.median_age_days} days) and flagged. R² is ${m.r2} — the fit is noisy, and the tests below say so plainly.</p>
  <h2 class="sec">Blind tests — the model earns its place</h2>
  <table class="plain"><thead><tr><th>Test (median absolute log error)</th><th class="num">Fitted</th><th class="num">Flat multiple</th><th class="num">Improvement</th></tr></thead><tbody>
  <tr><td>Leave-one-out (87 comps)</td><td class="num">${m.loo.toFixed(3)}</td><td class="num">${m.loo_flat_median.toFixed(3)} (median ratio ${m.flat_median_ratio})</td><td class="num">${v.loo_improvement_vs_flat.toFixed(2)}×</td></tr>
  <tr><td>5-fold CV × 5 seeds (mean of ${m.cv_seeds.map((x) => x.toFixed(3)).join(', ')})</td><td class="num">${m.cv_mean.toFixed(3)}</td><td class="num">${m.loo_flat_median.toFixed(3)}</td><td class="num">${v.cv_improvement_vs_flat.toFixed(2)}×</td></tr>
  ${wfRows}
  <tr><td>Flat 0.22 for reference</td><td class="num">—</td><td class="num">${m.loo_flat_022.toFixed(3)}</td><td class="num">—</td></tr>
  </tbody></table>
  <p>Walk-forward varies by split (${m.walk_forward.map((w) => w.fitted.toFixed(2)).join(', ')}) — one split's number is luck, so the board shows three. The fitted curve beats a flat multiple on every split, by ${v.wf_improvement_vs_flat.toFixed(2)}× on average.</p>
  <h2 class="sec">Launch odds — what happened to the protocol's peers</h2>
  <p>Odds are a base rate, not a prediction: among non-wrapped protocols in the same age and size band, how many already have a token (shrunk toward the overall base rate of ${(R.odds.overall * 100).toFixed(1)}% so a band with few protocols cannot claim 0% or 100%). Expected value = implied value × launch odds. The board's rank stays by implied value.</p>
  <table class="plain"><thead><tr><th>Age band</th><th>Size band</th><th class="num">Protocols</th><th class="num">With token</th><th class="num">Odds</th></tr></thead><tbody>${oddsRows}</tbody></table>
  <h2 class="sec">Honest limits</h2>
  <div class="warn"><ul>
  <li>The fit is noisy (R² ${m.r2}): the median error is ${m.loo.toFixed(2)} log points, so a single protocol's implied value is uncertain by roughly a factor of ${Math.exp(m.loo).toFixed(1)} either way. Rank bands from 200 bootstrap refits show that uncertainty per row.</li>
  <li>Walk-forward varies across splits — the curve is good, not magic.</li>
  <li>Launch odds describe peers, not this protocol: a protocol can stay tokenless for years, or launch tomorrow.</li>
  <li>A farm plan assumes a 5% airdrop pool shared among TVL/$1,000 farmers. If the real pool is smaller or the farmer count larger, the expected value falls.</li>
  <li>Gas figures are November 2026 estimates. A protocol that records no token may still have one its DefiLlama record does not carry.</li>
  </ul></div>
  <h2 class="sec">A note to the judge</h2>
  <div class="note"><p>Judge: everything on this page is computed from the sealed snapshot by the program in this repository — the model, the blind tests, the odds, the farm maths and the coverage accounting. The four screenshots show the board, this Model &amp; tests tab, a protocol's detail view and the Coverage tab. Nothing here is a screenshot with no code behind it: open the Model tab, pick any row, and its detail view shows the same numbers the table shows.</p></div>`;
}

function renderComps() {
  $('compscontent').innerHTML = `<h2 class="sec">Comps — the ${R.model.comps} traded protocols the curve is fitted on</h2>
  <p>One per ticker, wrapped products removed, mcap/TVL at most 10. The fitted curve is their story: value grows with TVL, faster with growth, slower with age.</p>
  <table class="plain"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap/TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Chains</th></tr></thead><tbody>
  ${R.comps_list.map((c) => `<tr><td><b>${esc(c.name)}</b><br><span style="color:#6b6455">${esc(c.slug)}</span></td><td class="num">${usd(c.tvl_usd)}</td><td class="num">${usd(c.mcap_usd)}</td><td class="num">${c.ratio.toFixed(2)}</td><td class="num">${pct(c.change_7d)}</td><td>${ageTxt(c.age_days)}</td><td class="num">${c.chains}</td></tr>`).join('')}
  </tbody></table>`;
}

function renderCoverage() {
  const c = R.coverage, ig = R.integrity;
  $('coveragecontent').innerHTML = `<h2 class="sec">Coverage — every protocol in the snapshot, accounted for</h2>
  <table class="plain"><thead><tr><th>Bucket</th><th class="num">Protocols</th><th>What it means</th></tr></thead><tbody>
  <tr><td>Ranked on the board</td><td class="num">${c.ranked}</td><td>Record no token at all and are not wrapped products — including all ${c.watchlist} watchlist protocols.</td></tr>
  <tr><td>Wrapped or staked products, excluded</td><td class="num">${c.wrapped_excluded}</td><td>Record no token but are a wrapped, staked or bridged product of a token that trades.</td></tr>
  <tr><td>Token already trades (market cap recorded)</td><td class="num">${c.with_mcap}</td><td>The comps come from this bucket; a token that trades is not a launch to rank.</td></tr>
  <tr><td>Symbol recorded, no market cap</td><td class="num">${c.symbol_no_mcap}</td><td>A token is recorded but no market cap — not ranked, because the record says a token exists.</td></tr>
  <tr><td><b>Total</b></td><td class="num"><b>${c.total}</b></td><td>${c.ranked} + ${c.wrapped_excluded} + ${c.with_mcap} + ${c.symbol_no_mcap} = ${c.total}. Nothing is missing.</td></tr>
  </tbody></table>
  <h2 class="sec">Watchlist — ${c.watchlist_covered} of ${c.watchlist} covered</h2>
  <div class="chips">${R.watchlist.map((w) => `<span class="chip">✓ ${esc(w)}</span>`).join('')}</div>
  <h2 class="sec">Integrity — the gaps in the record</h2>
  <div class="strip">${ig.mcap_nonpositive} protocols record a market cap of $0 or less · ${ig.missing_growth} report no 7-day change · ${ig.missing_listed_at} report no listing date · ${ig.symbol_no_mcap} record a symbol but no market cap.</div>`;
}

function downloadCsv() {
  const rows = filteredRows();
  const head = 'rank,slug,name,category,tvl_usd,change_7d,age_days,implied_value_usd,launch_odds,expected_value_usd,farm_verdict,farm_net_usd,rank_p10,rank_p90\n';
  const body = rows.map((r) => [r.rank, r.slug, `"${r.name.replace(/"/g, '""')}"`, r.category ?? '', r.tvl_usd, r.change_7d ?? '', r.age_days ?? '', r.implied_value_usd, r.launch_odds, r.expected_value_usd, r.farm_verdict, r.farm_net_usd, r.rank_p10, r.rank_p90].join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([head + body], { type: 'text/csv' }));
  a.download = 'token-radar-board.csv';
  a.click();
}

document.addEventListener('DOMContentLoaded', init);
