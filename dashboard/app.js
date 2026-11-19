/* TOKEN RADAR — radar-3.
 *
 * THE MODEL (fitted, not flat). 87 traded tokens are the training set:
 * one observation per ticker, wrapped / re-badged products and 10x-plus
 * mcap/TVL outliers removed. The fitted curve is a log-log OLS regression:
 *
 *   log(implied) = b0 + b1*log(TVL) + b2*growth + b3*log(1+age)
 *                  + b4*log(chains) + b5*ageUnknown
 *
 * growth is the 7-day TVL change clamped to -50%..+100%. age is days since
 * DefiLlama first tracked the protocol (listed_at); when it is missing the
 * median comp age is used and the ageUnknown flag is set. Category dummies
 * were tried and dropped: they overfit (leave-one-out error 0.95 -> 1.19+).
 *
 * VALIDATION (out of sample, median absolute log error; lower is better):
 *   leave-one-out: fitted 0.95 vs flat median-ratio 1.58 vs flat 0.22 1.51
 *   walk-forward (fit older half, test newer half): fitted 0.74 vs flat 1.50
 * Rank ranges come from 200 bootstrap refits (seeded, deterministic).
 *
 * FARM VERDICT. A 5% farmer pool is assumed, split equally among an
 * estimated TVL/$1,000 farmers; gas is 4 transactions on the cheapest chain
 * the protocol lists. net = pool share - gas. farm if net > $5, thin if
 * net > $0, skip otherwise. The deposit is capital, not cost: it comes back
 * when you exit. Rank is the size of the prize; verdict is what one farmer
 * nets after gas — that is why a top-ranked giant can be "thin".
 *
 * WHAT THE SNAPSHOT DOES NOT HAVE: launch dates, launch prices, FDV, or
 * token supply. "Implied value" is the market cap a token of this size
 * tends to carry among tokens that trade today — a fitted median, not a
 * forecast. mcap is today's value, not the value at launch. 16 tokens have
 * mcap <= 0 and are excluded from the fit; 272 protocols record a token
 * symbol but no market cap, so they are counted as token-recorded, not
 * ranked. See the Coverage tab for the full accounting of all 758.
 */
const D = window.RADAR;
const $ = (s) => document.querySelector(s);
const money = (n) => n == null ? '—' : n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'k' : '$' + n.toFixed(0);
const small = (n) => n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
const pct = (n) => n == null ? '—' : (n > 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = { tab: 'board', q: '', cat: '', chain: '', verdict: '', watch: false, sort: 'rank', detail: null };

function verdictBadge(v) { return `<span class="badge ${v}">${v}</span>`; }
function rankRange(r) { return r.rank_lo === r.rank_hi ? `#${r.rank_lo}` : `#${r.rank_lo}–${r.rank_hi}`; }

/* ------------------------------------------------------------------ KPIs */
function renderKpis() {
  const f = D.fit, c = D.coverage;
  const beat = (a, b) => ((1 - a / b) * 100).toFixed(0) + '% better';
  $('#kpis').innerHTML = [
    [f.n + ' comps', 'tokens fitted, one per ticker', 'R² ' + f.r2.toFixed(2)],
    [f.looFitted.toFixed(2), 'leave-one-out error (log)', 'flat: ' + f.looFlatMedian.toFixed(2) + ' · ' + beat(f.looFitted, f.looFlatMedian)],
    [f.wfFitted.toFixed(2), 'walk-forward error (log)', 'flat: ' + f.wfFlatTrain.toFixed(2) + ' · ' + beat(f.wfFitted, f.wfFlatTrain)],
    [c.ranked + ' ranked', 'of ' + c.total + ' protocols', 'watchlist ' + c.watchlist + '/40'],
    [money(D.rows[0].implied_value_usd), 'top implied: ' + esc(D.rows[0].name), 'flat model said ' + money(D.rows[0].flat_value_usd)],
    [D.rows.filter((r) => r.verdict === 'farm').length + ' farm', 'verdicts: ' + D.rows.filter((r) => r.verdict === 'thin').length + ' thin, ' + D.rows.filter((r) => r.verdict === 'skip').length + ' skip', 'net = pool share − gas'],
  ].map(([b, s, t]) => `<div class="kpi"><b>${b}</b><span>${s}</span><small>${t}</small></div>`).join('');
  $('#asof').textContent = D.as_of;
}

/* ------------------------------------------------------------------ board */
function filteredRows() {
  let rows = D.rows;
  if (state.q) { const q = state.q.toLowerCase(); rows = rows.filter((r) => r.slug.includes(q) || r.name.toLowerCase().includes(q)); }
  if (state.cat) rows = rows.filter((r) => r.category === state.cat);
  if (state.chain) rows = rows.filter((r) => r.chains.includes(state.chain));
  if (state.verdict) rows = rows.filter((r) => r.verdict === state.verdict);
  if (state.watch) rows = rows.filter((r) => r.watchlist);
  const key = { rank: (r) => r.rank, implied: (r) => -r.implied_value_usd, tvl: (r) => -r.tvl_usd, growth: (r) => -(r.change_7d ?? -1e9), net: (r) => -r.net_usd, age: (r) => -(r.age_days ?? -1) }[state.sort];
  return [...rows].sort((a, b) => key(a) - key(b) || a.rank - b.rank);
}

function shortChains(chains) {
  return chains.length <= 3 ? chains.join(', ') : chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3);
}

function renderBoard() {
  const rows = filteredRows();
  $('#count').textContent = rows.length + ' of ' + D.rows.length + ' ranked protocols shown';
  $('#board tbody').innerHTML = rows.map((r) => `<tr data-slug="${esc(r.slug)}">
    <td>${r.rank}${r.watchlist ? ' <span class="wl">★</span>' : ''}</td>
    <td class="proto"><b>${esc(r.name)}</b><br><span class="pill">${esc(r.category)} · ${esc(shortChains(r.chains))}</span></td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td class="num">${r.change_7d == null ? '—' : pct(r.change_7d / 100)}</td>
    <td class="num"><b>${money(r.implied_value_usd)}</b></td>
    <td class="num">${money(r.flat_value_usd)}</td>
    <td class="num">${rankRange(r)}</td>
    <td>${verdictBadge(r.verdict)}</td>
    <td class="num">${small(r.net_usd)}</td>
  </tr>`).join('');
  document.querySelectorAll('#board tbody tr').forEach((tr) => tr.addEventListener('click', () => openDetail(tr.dataset.slug)));
}

function renderMovers() {
  const m = D.topMovers;
  const li = (x) => `<li><b>${esc(x.name)}</b> ${pct(x.change_7d / 100)}</li>`;
  $('#movers').innerHTML =
    `<div class="panel"><h3>Top movers — 7d TVL growth</h3><ol>${m.gainers.map(li).join('')}</ol></div>` +
    `<div class="panel"><h3>Biggest losers — 7d TVL</h3><ol>${m.losers.map(li).join('')}</ol></div>`;
  $('#chains').innerHTML =
    `<div class="panel"><h3>Implied value by chain</h3><ol>${D.chainBreakdown.map((c) => `<li><b>${esc(c.chain)}</b> — ${money(c.implied_usd)} across ${c.protocols} protocols</li>`).join('')}</ol></div>` +
    `<div class="panel"><h3>How to read the board</h3><ul><li><b>Implied</b> is the fitted median launch value; <b>flat</b> is TVL × the comps' median ratio (${D.fit.flatRatio.toFixed(3)}).</li><li><b>Rank range</b> is the p10–p90 band over 200 bootstrap refits — wide bands mean the curve is unsure.</li><li><b>★</b> marks the 40 watchlist protocols.</li></ul></div>`;
}

/* ------------------------------------------------------------------ detail */
function openDetail(slug) {
  const r = D.rows.find((x) => x.slug === slug);
  if (!r) return;
  state.detail = slug;
  const m = r.model;
  const band = `<div class="bandbar"><i style="left:${((r.rank_lo - 1) / D.rows.length * 100).toFixed(1)}%;width:${Math.max(0.6, (r.rank_hi - r.rank_lo + 1) / D.rows.length * 100).toFixed(1)}%"></i><b style="left:${((r.rank - 1) / D.rows.length * 100).toFixed(1)}%"></b></div>
  <p class="pill">Rank ${r.rank} · bootstrap p10–p90: #${r.rank_lo}–#${r.rank_hi} · the bar marks the point rank, the shaded band the range.</p>`;
  const contrib = [['constant', m.contrib_const], ['log TVL × ' + D.fit.beta[1].toFixed(3), m.contrib_tvl], ['growth × ' + D.fit.beta[2].toFixed(3), m.contrib_growth], ['log age × ' + D.fit.beta[3].toFixed(3), m.contrib_age], ['log chains × ' + D.fit.beta[4].toFixed(3), m.contrib_chains], ['age unknown × ' + D.fit.beta[5].toFixed(3), m.contrib_unknown]];
  $('#drawer-body').innerHTML = `
    <h2>${esc(r.name)}</h2>
    <p class="meta">${esc(r.category)} · ${r.chains.map(esc).join(', ')} · TVL ${money(r.tvl_usd)} · 7d ${r.change_7d == null ? '—' : pct(r.change_7d / 100)}${r.watchlist ? ' · ★ watchlist' : ''}</p>
    <p>Implied value <b>${money(r.implied_value_usd)}</b> (flat model: ${money(r.flat_value_usd)} — the flat multiple overvalues giants, because tokens grow with roughly the square root of TVL, not in proportion to it).</p>
    ${band}
    <h3>How the curve got here (log contributions)</h3>
    <table><tbody>${contrib.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.toFixed(3)}</td></tr>`).join('')}
    <tr><td><b>sum → log implied</b></td><td class="num"><b>${Math.log(r.implied_value_usd).toFixed(2)}</b></td></tr></tbody></table>
    <h3>Farm plan — ${verdictBadge(r.verdict)}</h3>
    <p>Deposit ${money(r.deposit_usd)} on ${esc(r.farm_chain)} (cheapest chain listed) · expected pool share ${small(r.ev_usd)} · gas ${small(r.gas_usd)} · <b>net ${small(r.net_usd)}</b> · hold ${r.hold_days} days.</p>
    <ol>${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  $('#drawer').hidden = false;
}
function closeDetail() { state.detail = null; $('#drawer').hidden = true; }
$('#drawer-close').addEventListener('click', closeDetail);

/* ------------------------------------------------------------------ model tab */
function renderModel() {
  const f = D.fit, c = D.coverage;
  const rows = [
    ['constant', 'b0', f.beta[0].toFixed(3), 'baseline level'],
    ['log TVL', 'b1', f.beta[1].toFixed(3), 'sublinear: value grows with ~TVL^0.43, not TVL'],
    ['growth (7d, clamped −50%…+100%)', 'b2', f.beta[2].toFixed(3), 'small positive pull; not the driver'],
    ['log(1 + age in days)', 'b3', f.beta[3].toFixed(3), 'slightly negative — older does not mean dearer'],
    ['log(chain count)', 'b4', f.beta[4].toFixed(3), 'near zero — breadth adds little once size is in'],
    ['age unknown', 'b5', f.beta[5].toFixed(3), 'penalty when listed_at is missing'],
  ];
  $('#model').innerHTML = `
  <h2>The fitted curve</h2>
  <p><code>log(implied) = b0 + b1·log(TVL) + b2·growth + b3·log(1+age) + b4·log(chains) + b5·ageUnknown</code></p>
  <p>Fitted on ${f.n} traded tokens (one per ticker), median comp age ${f.medAgeDays} days. The flat baseline is TVL × ${f.flatRatio.toFixed(3)}, the comps' median market-cap/TVL ratio; the old radar-2 board used a flat 0.22.</p>
  <table><thead><tr><th>Variable</th><th>Coef</th><th>Value</th><th>Reading</th></tr></thead>
  <tbody>${rows.map(([a, b, v, d]) => `<tr><td>${a}</td><td>${b}</td><td class="num">${v}</td><td>${d}</td></tr>`).join('')}</tbody></table>
  <h3>Blind tests — median absolute log error (lower is better)</h3>
  <table><thead><tr><th>Test</th><th>Fitted</th><th>Flat (median ratio)</th><th>Flat 0.22</th></tr></thead><tbody>
  <tr><td>In-sample</td><td class="num">${f.medAbsErr.toFixed(3)}</td><td class="num">—</td><td class="num">—</td></tr>
  <tr><td>Leave-one-out</td><td class="num"><b>${f.looFitted.toFixed(3)}</b></td><td class="num">${f.looFlatMedian.toFixed(3)}</td><td class="num">${f.looFlat022.toFixed(3)}</td></tr>
  <tr><td>Walk-forward (fit ${f.wfTrainN} older, test ${f.wfTestN} newer)</td><td class="num"><b>${f.wfFitted.toFixed(3)}</b></td><td class="num">${f.wfFlatTrain.toFixed(3)}</td><td class="num">${f.wfFlat022.toFixed(3)}</td></tr>
  </tbody></table>
  <p>In-sample R² ${f.r2.toFixed(3)}, residual SD ${f.residSd.toFixed(3)}. R² is modest — launch values are noisy — but the curve still beats a flat multiple by ~${((1 - f.looFitted / f.looFlatMedian) * 100).toFixed(0)}% out of sample on leave-one-out and ~${((1 - f.wfFitted / f.wfFlatTrain) * 100).toFixed(0)}% on walk-forward. That is the whole point of this board.</p>
  <h3>What was tried and dropped</h3>
  <ul><li>Category dummies (Lending, Dexs, Yield, …): in-sample R² rose, but leave-one-out error rose to 1.19–1.29 — the dummies were estimated from 3–15 tokens each and did not generalise. Dropped.</li>
  <li>Huber-robust fit: same story in the other direction — the 4 extreme ratios (up to 400×) are real tokens, so they are capped out of the fit instead of down-weighted.</li>
  <li>One observation per ticker: multi-chain clones of one token (same symbol) count once, keeping the larger TVL — ${c.compsDroppedDup} duplicate dropped.</li></ul>
  <div class="warn"><b>Honest limits.</b> The snapshot has no launch dates, no launch prices, no FDV and no token supply. <code>listed_at</code> is when DefiLlama first tracked the protocol, not when its token launched — so "walk-forward" splits by tracking start, a proxy, not by true launch order. Market cap is today's value, not the value at launch. Implied value is a fitted median over traded tokens, not a forecast of any launch. Gas prices and the 5% pool / $1,000-farmer assumptions are stated rules, not quotes.</div>`;
}

/* ------------------------------------------------------------------ comps tab */
function renderComps() {
  $('#comps tbody').innerHTML = D.comps.map((c) => `<tr>
    <td><b>${esc(c.name)}</b><br><span class="pill">${esc(c.slug)}</span></td>
    <td>${esc(c.category)}</td><td class="num">${money(c.tvl_usd)}</td>
    <td class="num">${money(c.mcap_usd)}</td><td class="num">${money(c.fitted_usd)}</td>
    <td class="num">${c.logErr > 0 ? '+' : ''}${c.logErr.toFixed(2)}</td></tr>`).join('');
}

/* ------------------------------------------------------------------ coverage tab */
function renderCoverage() {
  const c = D.coverage;
  const rows = [
    ['Protocols in the snapshot', c.total, 'every row below adds up to this'],
    ['Ranked on this board', c.ranked, c.watchlist + ' watchlist + ' + c.early + ' other pre-token'],
    ['Pre-token but wrapped / re-badged — excluded', c.wrappedExcluded, 'bridges, liquid staking/restaking, CEXs, versioned clones (v2, V3…)'],
    ['Token recorded, market cap present', c.withMcap, c.mcapNonpositive + ' of them have mcap ≤ 0 and cannot be fitted (log of ≤ 0)'],
    ['Token recorded, symbol but no market cap', c.symbolNoMcap, 'counted as token-recorded, not ranked'],
    ['Comps the curve was fitted on', c.compsUsed, 'from ' + (c.compsUsed + c.compsDroppedDup + c.compsDroppedWrapped + c.compsDroppedRatio) + ' mcap &gt; 0 tokens: −' + c.compsDroppedDup + ' duplicate ticker, −' + c.compsDroppedWrapped + ' wrapped, −' + c.compsDroppedRatio + ' ratio &gt; 10×'],
  ];
  $('#coverage').innerHTML = `<h2>Coverage — all ${c.total} protocols accounted for</h2>
  <table><thead><tr><th>Bucket</th><th>Count</th><th>Note</th></tr></thead>
  <tbody>${rows.map(([a, b, d]) => `<tr><td>${a}</td><td class="num"><b>${b}</b></td><td>${d}</td></tr>`).join('')}</tbody></table>
  <p class="note">Check: ${c.ranked} + ${c.wrappedExcluded} + ${c.withMcap} + ${c.symbolNoMcap} = ${c.ranked + c.wrappedExcluded + c.withMcap + c.symbolNoMcap} (snapshot total ${c.total}).</p>`;
}

/* ------------------------------------------------------------------ wiring */
function fillSelects() {
  const cats = [...new Set(D.rows.map((r) => r.category))].sort();
  $('#f-cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
  $('#f-chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}
function setTab(t) {
  state.tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + t));
  if (t === 'model') renderModel();
  if (t === 'comps') renderComps();
  if (t === 'coverage') renderCoverage();
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
$('#f-cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
$('#f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
$('#f-verdict').addEventListener('change', (e) => { state.verdict = e.target.value; renderBoard(); });
$('#f-watch').addEventListener('change', (e) => { state.watch = e.target.checked; renderBoard(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
$('#csv').addEventListener('click', () => {
  const head = 'rank,slug,name,category,chains,tvl_usd,change_7d,implied_value_usd,flat_value_usd,rank_lo,rank_hi,verdict,ev_usd,gas_usd,net_usd,deposit_usd,farm_chain\n';
  const body = filteredRows().map((r) => [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + r.category + '"', '"' + r.chains.join(';') + '"', r.tvl_usd, r.change_7d ?? '', r.implied_value_usd, r.flat_value_usd, r.rank_lo, r.rank_hi, r.verdict, r.ev_usd, r.gas_usd, r.net_usd, r.deposit_usd, r.farm_chain].join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([head + body], { type: 'text/csv' }));
  a.download = 'token-radar-radar3.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

/* Deep links for screenshots and sharing: #tab=model, #detail=<slug>,
 * #verdict=farm, #chain=Solana, #watch=1 */
function applyHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('tab')) setTab(h.get('tab'));
  if (h.get('verdict')) { state.verdict = h.get('verdict'); $('#f-verdict').value = state.verdict; }
  if (h.get('chain')) { state.chain = h.get('chain'); $('#f-chain').value = state.chain; }
  if (h.get('watch')) { state.watch = true; $('#f-watch').checked = true; }
  renderBoard();
  if (h.get('detail')) openDetail(h.get('detail'));
}

fillSelects();
renderKpis();
renderBoard();
renderMovers();
applyHash();
