// Token Radar dashboard (radar-2). Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail drawer with the model's own inputs and the protocol's
// farm plan, plus a model lab that recomputes implied value with the same
// formula. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, labBase: DATA.model.base_multiple, labGrowth: DATA.model.growth_weight, labOn: false };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function, identical to lib/model.ts impliedValue: the
  // page recomputes a row from the snapshot figures and checks the number
  // board.json carries, so the page's code and the board's data are visibly
  // the same arithmetic. The lab only changes base_multiple and
  // growth_weight; every other multiplier is the board's own.
  function maturityOf(age, model) {
    if (age === null || age === undefined) return model.unknown_age_multiplier;
    if (age < model.young_age_days) return model.young_multiplier;
    if (age < 365) return 0.95 + ((age - 90) / 275) * 0.1;
    if (age < 1095) return 1.05 + ((age - 365) / 730) * 0.08;
    return model.maturity_max;
  }
  function impliedOf(row, model, base, growthW) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * growthW;
    return Math.max(1, Math.round(row.tvl_usd * base * growthMult * maturityOf(row.age_days, model) * row.breadth_multiplier * row.category_multiplier));
  }
  function shownImplied(row) {
    return state.labOn ? impliedOf(row, DATA.model, state.labBase, state.labGrowth) : row.implied_value_usd;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open, so the loan book counts your address.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open through at least one fee cycle.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge, then close it in profit or at a small loss.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ', then settle it when the market resolves.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares until the vault\'s next epoch.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it in the protocol\'s own vault.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it, so the on-chain record shows a real holder.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy until it expires.';
    if (c.indexOf('chain') >= 0) return 'Use $' + capital + ' on ' + name + "'s chain for one real transaction a week, such as a swap or a transfer.";
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var second = (p.chains && p.chains.length > 1)
      ? { text: 'Repeat the qualifying action on a second chain, ' + p.chains[1] + ', so the activity is not tied to one chain only.', cost: 'about $2 of gas', time: '10 minutes' }
      : { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' };
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      second,
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Check the protocol's own points or rewards page weekly, and note which actions it counts before you change anything.", cost: 'no fee to check', time: '5 minutes a week' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch')) state.watchOnly = params.get('watch') === '1';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'readiness') { av = a.readiness; bv = b.readiness; }
      else { av = shownImplied(a); bv = shownImplied(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function csvEscapeField(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (text.indexOf('"') >= 0 || text.indexOf(',') >= 0 || text.indexOf('\n') >= 0) {
      return '"' + text.split('"').join('""') + '"';
    }
    return text;
  }
  function buildCsvText(list) {
    var headerRow = ['rank', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'readiness', 'implied_value_usd'];
    var lines = [headerRow.join(',')];
    list.forEach(function (r) {
      var cells = [
        r.rank,
        r.name,
        r.category || '',
        (r.chains || []).join(' + '),
        r.tvl_usd,
        r.change_7d === null || r.change_7d === undefined ? '' : r.change_7d,
        r.age_days === null || r.age_days === undefined ? '' : r.age_days,
        r.readiness,
        shownImplied(r)
      ];
      lines.push(cells.map(csvEscapeField).join(','));
    });
    return lines.join('\n') + '\n';
  }
  function downloadFilteredCsv() {
    var list = sortedRows(rows());
    var text = buildCsvText(list);
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'token-radar-board.csv';
    link.textContent = 'token-radar-board.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function topMoversLists() {
    var scored = DATA.rows.filter(function (r) { return r.change_7d !== null && r.change_7d !== undefined; });
    var gainers = scored.slice().sort(function (a, b) { return b.change_7d - a.change_7d; }).slice(0, 5);
    var losers = scored.slice().sort(function (a, b) { return a.change_7d - b.change_7d; }).slice(0, 5);
    return { gainers: gainers, losers: losers };
  }
  function moverRow(r) {
    return el('button', { type: 'button', class: 'mover-row', onclick: function () { openDetail(r.slug); } },
      el('span', { class: 'mover-name', text: r.name }),
      el('span', { class: 'num ' + (r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
      el('span', { class: 'num mover-value', text: fmtUsd(r.implied_value_usd) })
    );
  }
  function renderTopMovers() {
    var lists = topMoversLists();
    var template = document.getElementById('top-movers-template');
    var panel;
    if (template && template.content && template.content.firstElementChild) {
      panel = template.content.firstElementChild.cloneNode(true);
    } else {
      panel = el('section', { class: 'movers-panel', 'aria-label': 'Top movers (7d)' }, el('h2', { text: 'Top movers (7d)' }));
    }
    var cols = panel.querySelector('.movers-cols');
    if (!cols) { cols = el('div', { class: 'movers-cols' }); panel.appendChild(cols); }
    cols.appendChild(el('div', { class: 'movers-col' },
      el('h3', { text: 'Biggest gains' }),
      lists.gainers.map(function (r) { return moverRow(r); })
    ));
    cols.appendChild(el('div', { class: 'movers-col' },
      el('h3', { text: 'Biggest losses' }),
      lists.losers.map(function (r) { return moverRow(r); })
    ));
    return panel;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols that the watchlist left out. Implied value is a model, not a promise.' }),
        el('p', { class: 'sub', text: DATA.excluded_pre_token + ' pre-token protocols are set aside as wrapped, staked or bridged products of a token that already trades, and ' + DATA.live_size + ' live-token protocols are shown with their market caps instead of a model value.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows, not watchlist' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0) }))
      )
    );
  }

  function spotlight() {
    var top = DATA.rows.slice(0, 5);
    return el('section', { class: 'spotlight', 'aria-label': 'Top five by implied value' },
      top.map(function (r) {
        return el('button', { type: 'button', class: 'spot', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'spot-rank', text: '#' + r.rank }),
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + fmtUsd(r.tvl_usd) + ' TVL' }),
          el('span', { class: 'spot-value', text: fmtUsd(r.implied_value_usd) })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search protocols', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var watchBtn = el('button', { type: 'button', 'aria-pressed': state.watchOnly ? 'true' : 'false', text: state.watchOnly ? 'Watchlist only ✓' : 'Watchlist only', onclick: function () { state.watchOnly = !state.watchOnly; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), watchBtn),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Export' }), el('button', { type: 'button', class: 'csv-button', text: 'Download CSV', onclick: function () { downloadFilteredCsv(); } })),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return shownImplied(r); })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.watchlist ? ' · watchlist' : ' · early') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'ready' },
          el('div', { class: 'bar small', 'aria-hidden': 'true' }, el('i', { style: 'width:' + r.readiness + '%' })),
          el('span', { class: 'num', text: String(r.readiness) })
        )),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((shownImplied(r) / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(shownImplied(r)) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('readiness', 'Ready'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var baseSlider = el('input', { type: 'range', min: '0.1', max: '0.4', step: '0.01', value: String(state.labBase), 'aria-label': 'Base multiple' });
    var growthSlider = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.labGrowth), 'aria-label': 'Growth weight' });
    var labNote = el('p', { class: 'sub', id: 'lab-note', text: state.labOn ? 'Lab on: base ' + state.labBase.toFixed(2) + ', growth weight ' + state.labGrowth.toFixed(2) + '. The board below uses these values; board.json keeps the published model.' : 'Lab off: the board uses the published model. Move a slider to try another.' });
    baseSlider.addEventListener('input', function () { state.labBase = parseFloat(baseSlider.value); state.labOn = true; labNote.textContent = 'Lab on: base ' + state.labBase.toFixed(2) + ', growth weight ' + state.labGrowth.toFixed(2) + '. The board below uses these values; board.json keeps the published model.'; render(); });
    growthSlider.addEventListener('input', function () { state.labGrowth = parseFloat(growthSlider.value); state.labOn = true; labNote.textContent = 'Lab on: base ' + state.labBase.toFixed(2) + ', growth weight ' + state.labGrowth.toFixed(2) + '. The board below uses these values; board.json keeps the published model.'; render(); });
    var reset = el('button', { type: 'button', text: 'Reset lab', onclick: function () { state.labBase = DATA.model.base_multiple; state.labGrowth = DATA.model.growth_weight; state.labOn = false; render(); } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x maturity(age) x breadth(chains) x category )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_multiplier + '. Growth is capped at +' + m.growth_cap + '% because one protocol in this snapshot grew 4,448% in a week, and a single week must not buy the top of the board. Breadth rewards multi-chain protocols, and the category premium follows where token launches are the norm. Farm readiness (0-100) is size 25, maturity 30, growth 25 and breadth 20.' }),
      el('div', { class: 'lab' },
        el('div', { class: 'field' }, el('label', { text: 'Model lab: base multiple' }), baseSlider),
        el('div', { class: 'field' }, el('label', { text: 'Model lab: growth weight' }), growthSlider),
        reset
      ),
      labNote
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function riskNotes(row) {
    var notes = [];
    if (row.age_days !== null && row.age_days < 90) notes.push('Young protocol: listed ' + row.age_days + ' days ago, so the maturity multiplier discounts it as unproven.');
    if (row.age_days === null) notes.push('Age unknown: no listed date in the snapshot, so the model uses a 0.92 discount for an unknown history.');
    if (row.change_7d !== null && row.change_7d > 100) notes.push('Growth capped: the snapshot shows ' + fmtPct(row.change_7d) + ' in seven days, but the model caps growth at +100% so one week cannot buy the top of the board.');
    if (row.change_7d !== null && row.change_7d < -20) notes.push('TVL is falling fast: ' + fmtPct(row.change_7d) + ' in seven days, so the growth multiplier pulls the implied value down.');
    if ((row.chains || []).length >= 8) notes.push('Very wide distribution: ' + row.chains.length + ' chains earn the top breadth multiplier.');
    if (notes.length === 0) notes.push('No special warning: the protocol\'s TVL, growth and age all sit inside the model\'s normal range.');
    return notes;
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · watchlist' : ' · early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Category multiplier' }), el('b', { class: 'num', text: String(row.category_multiplier) })),
        el('div', null, el('span', { text: 'Farm readiness (0-100)' }), el('b', { class: 'num', text: String(row.readiness) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model, DATA.model.base_multiple, DATA.model.growth_weight)) + (impliedOf(row, DATA.model, DATA.model.base_multiple, DATA.model.growth_weight) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'What to watch' }),
      el('ul', { class: 'notes' }, riskNotes(row).map(function (n) { return el('li', { text: n }); }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(spotlight());
    if (state.tab === 'pre-token') shell.appendChild(renderTopMovers());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
