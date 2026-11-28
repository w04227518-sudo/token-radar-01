// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, its filters, the model sandbox, a detail
// drawer for every protocol, the live-token view and the comps table. No network:
// every byte it shows is in data.js, and every number it shows is recomputed here
// from the snapshot figures, so the page and board.json are the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  // The watchlist flag rides on each data.js row (the model writes it from the snapshot).
  var state = {
    view: 'board', q: '', category: 'all', chain: 'all', wl: false, minTvl: 0,
    sort: 'implied', dir: -1, selected: null,
    sandbox: { scale: 1, rankByEv: false, on: false }
  };
  var WATCH = {};
  DATA.rows.forEach(function (r) { WATCH[r.slug] = !!r.watchlist; });

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
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
  function fmtMult(n) { return (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }

  // The model in one function: the same arithmetic main.ts runs, so the sandbox can
  // re-rank the board live. The fitted multiple is the fitted value from the snapshot;
  // the sandbox only scales it, and optionally ranks by expected value (implied x odds).
  function impliedOf(row, sb) {
    return Math.max(1, Math.round(row.tvl_usd * row.model.fitted_multiple * sb.scale));
  }
  function sandboxImplied(row) {
    return state.sandbox.on ? impliedOf(row, state.sandbox) : row.implied_value_usd;
  }
  function sortValue(row) {
    var v = sandboxImplied(row);
    return state.sandbox.rankByEv ? v * row.launch_odds : v;
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

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('wl') === '1') state.wl = true;
    if (p.get('min')) state.minTvl = parseFloat(p.get('min')) || 0;
    if (p.get('view')) state.view = p.get('view');
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.wl) p.set('wl', '1');
    if (state.minTvl) p.set('min', String(state.minTvl));
    if (state.view !== 'board') p.set('view', state.view);
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.wl && !WATCH[r.slug]) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var withVal = list.map(function (r) { return { r: r, v: sandboxImplied(r), ev: sortValue(r) }; });
    withVal.sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.r.name.toLowerCase(); bv = b.r.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.r.tvl_usd; bv = b.r.tvl_usd; }
      else if (key === 'growth') { av = a.r.change_7d === null ? -Infinity : a.r.change_7d; bv = b.r.change_7d === null ? -Infinity : b.r.change_7d; }
      else if (key === 'age') { av = a.r.age_days === null ? Infinity : a.r.age_days; bv = b.r.age_days === null ? Infinity : b.r.age_days; }
      else if (key === 'odds') { av = a.r.launch_odds; bv = b.r.launch_odds; }
      else if (key === 'verdict') { av = verdictRank(a.r.farm_verdict); bv = verdictRank(b.r.farm_verdict); }
      else { av = a.ev; bv = b.ev; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.r.slug < b.r.slug ? -1 : a.r.slug > b.r.slug ? 1 : 0;
    });
    return withVal;
  }
  function verdictRank(v) { return v === 'Farm' ? 2 : v === 'Watch' ? 1 : 0; }

  function topMeta() {
    var elTop = document.getElementById('topmeta');
    elTop.textContent = '';
    elTop.appendChild(el('span', null, 'snapshot ', el('b', { text: DATA.as_of })));
    elTop.appendChild(el('span', null, 'model ', el('b', { text: DATA.model_version })));
    elTop.appendChild(el('span', null, 'rows ', el('b', { text: String(DATA.board_size) })));
    elTop.appendChild(el('span', null, 'global comps ', el('b', { text: 'x' + fmtMult(DATA.global_median) })));
  }

  function hero() {
    var v = DATA.validation;
    var c = DATA.coverage;
    document.getElementById('lede').textContent =
      'Every protocol below records no token yet. The board ranks ' + DATA.board_size + ' of them by implied value — ' +
      'TVL times a multiple fitted on the ' + v.comps_n + ' live-token protocols that already trade — and each row carries ' +
      'launch odds from the peers\u2019 own record and a 90% range for its implied value. The watchlist of ' +
      DATA.watchlist_size + ' is the floor, not the ceiling: ' + DATA.early_size +
      ' more pre-token protocols below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor are ranked too. ' +
      'Implied value is this entry\u2019s own claim, never a promise, and never a prediction of whether or when a token is issued.';
    var stats = document.getElementById('stats');
    stats.textContent = '';
    var top = sortedRows(DATA.rows.slice())[0];
    var kept = v.terms.filter(function (t) { return t.kept; }).map(function (t) { return t.name; }).join(', ');
    var items = [
      [String(c.ranked) + ' + ' + String(c.live) + ' + ' + String(c.excluded_cex + c.excluded_versioned + c.excluded_wrapped + c.excluded_chain_bridge), 'of ' + String(c.total) + ' protocols accounted for'],
      ['x' + v.loo_multiple + (v.loo_typical_multiple !== undefined ? ' (typical x' + v.loo_typical_multiple + ')' : ''), 'leave-one-out error, ' + v.loo_n + ' comps'],
      ['x' + v.walk_forward_multiple + (v.walk_forward_typical_multiple !== undefined ? ' (typical x' + v.walk_forward_typical_multiple + ')' : ''), 'walk-forward error, ' + v.walk_forward_n + ' newer listings'],
      ['x' + v.interval_factor + ' as-fitted', '90% interval, single factor'],
      [v.interval_bands.map(function (b) { return b.band + ' x' + b.factor + (b.fallback ? '*' : ''); }).join('  '), '90% interval by TVL band, honest (* global fallback)'],
      [kept, 'terms kept by held-out tests'],
      [fmtUsd(top ? top.v : 0), 'top implied value']
    ];
    items.forEach(function (it) {
      stats.appendChild(el('div', { class: 'stat' }, el('b', { text: it[0] }), el('span', { text: it[1] })));
    });
    var checks = document.getElementById('checks');
    checks.textContent = '';
    DATA.checks.forEach(function (chk) {
      checks.appendChild(el('span', { class: 'checkline' }, el('b', { text: '✓ ' }), chk));
    });
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false');
    });
    document.getElementById('view-board').hidden = view !== 'board';
    document.getElementById('view-live').hidden = view !== 'live';
    document.getElementById('view-model').hidden = view !== 'model';
    writeHash();
  }

  function controls() {
    var box = document.getElementById('controls');
    box.textContent = '';
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); renderTable(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); renderTable(); });
    var minSel = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      [[0, 'Any TVL'], [5e7, 'TVL $50M+'], [1e8, 'TVL $100M+'], [5e8, 'TVL $500M+'], [1e9, 'TVL $1B+']].map(function (o) {
        return el('option', { value: String(o[0]), text: o[1], selected: state.minTvl === o[0] ? 'selected' : null });
      })
    );
    minSel.addEventListener('change', function () { state.minTvl = parseFloat(minSel.value) || 0; writeHash(); renderTable(); });
    var wl = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.wl ? 'checked' : null, 'aria-label': 'Watchlist only' }),
      'Watchlist only'
    );
    wl.querySelector('input').addEventListener('change', function (e) { state.wl = e.target.checked; writeHash(); renderTable(); });
    box.appendChild(el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search));
    box.appendChild(el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel));
    box.appendChild(el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel));
    box.appendChild(el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Minimum TVL' }), minSel));
    box.appendChild(wl);
    box.appendChild(el('span', { class: 'count', id: 'rowcount' }));
  }

  function sandboxPanel() {
    var box = document.getElementById('sandbox');
    box.textContent = '';
    box.className = 'sandbox' + (state.sandbox.on ? ' on' : '');
    box.appendChild(el('h2', { text: state.sandbox.on ? 'MODEL SANDBOX — LIVE RE-RANK (NOT board.json)' : 'MODEL SANDBOX — DRAG TO RE-RANK THE BOARD' }));
    box.appendChild(el('p', { text: 'Scale the fitted multiple, or rank by expected value — implied value times launch odds — instead of by implied value alone. The board re-ranks in the page from the same snapshot figures. board.json keeps the published model; the sandbox only asks what-if.' }));
    var sliders = el('div', { class: 'sliders' });
    function slider(id, label, min, max, step, value, fmt) {
      var out = el('output', { text: fmt(value) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      input.addEventListener('input', function () {
        state.sandbox[id] = parseFloat(input.value);
        state.sandbox.on = state.sandbox.scale !== 1 || state.sandbox.rankByEv;
        out.textContent = fmt(state.sandbox[id]);
        box.className = 'sandbox' + (state.sandbox.on ? ' on' : '');
        box.querySelector('h2').textContent = state.sandbox.on ? 'MODEL SANDBOX — LIVE RE-RANK (NOT board.json)' : 'MODEL SANDBOX — DRAG TO RE-RANK THE BOARD';
        renderTable();
      });
      return el('div', { class: 'slider' }, el('label', { for: id }, label, out), input);
    }
    sliders.appendChild(slider('scale', 'Fitted-multiple scale', 0.5, 2, 0.05, state.sandbox.scale, function (v) { return 'x' + v.toFixed(2); }));
    box.appendChild(sliders);
    var ev = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.sandbox.rankByEv ? 'checked' : null, 'aria-label': 'Rank by expected value' }),
      'Rank by expected value (implied value x launch odds)'
    );
    ev.querySelector('input').addEventListener('change', function (e) {
      state.sandbox.rankByEv = e.target.checked;
      state.sandbox.on = state.sandbox.scale !== 1 || state.sandbox.rankByEv;
      box.className = 'sandbox' + (state.sandbox.on ? ' on' : '');
      box.querySelector('h2').textContent = state.sandbox.on ? 'MODEL SANDBOX — LIVE RE-RANK (NOT board.json)' : 'MODEL SANDBOX — DRAG TO RE-RANK THE BOARD';
      renderTable();
    });
    box.appendChild(ev);
    box.appendChild(el('button', { class: 'button reset', type: 'button', text: 'Reset sandbox', onclick: function () {
      state.sandbox = { scale: 1, rankByEv: false, on: false };
      sandboxPanel(); renderTable();
    } }));
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderTable(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function renderTable() {
    var wrap = document.getElementById('tablewrap');
    wrap.textContent = '';
    var list = sortedRows(filteredRows());
    var count = document.getElementById('rowcount');
    if (count) count.textContent = list.length + ' of ' + DATA.board_size + ' rows shown';
    if (list.length === 0) {
      wrap.appendChild(el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; state.minTvl = 0;
          writeHash(); controls(); sandboxPanel(); renderTable();
        } })
      ));
      return;
    }
    var max = list[0].ev || 1;
    var tbody = el('tbody');
    list.forEach(function (item, i) {
      var r = item.r;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankLabel = state.sandbox.on ? String(i + 1) : String(r.rank);
      var verdictClass = r.farm_verdict === 'Farm' ? 'farm' : r.farm_verdict === 'Watch' ? 'watchv' : 'skip';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: rankLabel }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((item.ev / max) * 100)) + '%' })),
          el('div', null,
            el('span', { class: 'num', text: fmtUsd(item.v) }),
            el('div', { class: 'sub', text: fmtUsd(r.implied_lo_usd) + ' – ' + fmtUsd(r.implied_hi_usd) + ' (90%)' })
          )
        )),
        el('td', { class: 'num', text: (r.launch_odds * 100).toFixed(0) + '%' }),
        el('td', null, el('span', { class: 'tag verdict ' + verdictClass, text: r.farm_verdict })),
        el('td', null,
          el('span', { class: 'tag' + (WATCH[r.slug] ? ' watch' : ''), text: WATCH[r.slug] ? 'watchlist' : 'records no token' })
        )
      );
      tbody.appendChild(tr);
    });
    wrap.appendChild(el('table', null,
      el('caption', { text: state.sandbox.on
        ? 'Sandbox re-rank: the board re-sorted by your dials. The published ranks in board.json are unchanged.'
        : 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown, launch odds and farm plan.' }),
      el('thead', null, el('tr', null,
        sortHeader('implied', 'Rank'),
        sortHeader('name', 'Protocol'),
        sortHeader('tvl', 'TVL'),
        sortHeader('growth', '7d'),
        sortHeader('age', 'Age'),
        sortHeader('implied', 'Implied value'),
        sortHeader('odds', 'Launch odds'),
        sortHeader('verdict', 'Verdict'),
        el('th', { scope: 'col', text: 'Token' })
      )),
      tbody
    ));
    document.getElementById('boardnote').textContent =
      'Rank is the model\u2019s claim, not a price. Every row records no token in the snapshot; a protocol on the list may still have a token its DefiLlama record does not carry. Launch odds are the chance of a launch in the next ' + Math.round(DATA.validation.odds_horizon_days / 365) + ' years, fitted from the peers\u2019 record — they fall with age, and the farm verdict weighs implied value against them. The farm plan is in each row\u2019s detail view.';
  }

  function renderLive() {
    var wrap = document.getElementById('livetable');
    wrap.textContent = '';
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var ratio = r.mcap_usd !== null && r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a';
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'tag live', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: ratio })
      ));
    });
    wrap.appendChild(el('table', null,
      el('caption', { text: 'All ' + DATA.live.length + ' live-token protocols by market cap, with the market-cap / TVL ratio the comps model is built from. ' + DATA.coverage.live_no_mcap + ' of them record a token but no market cap, so they sit at the bottom with no ratio.' }),
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
      tbody
    ));
  }

  function renderModel() {
    var v = DATA.validation;
    var m = DATA.model;
    var mp = document.getElementById('modelpanel');
    mp.textContent = '';
    mp.appendChild(el('h2', { text: 'How implied value is computed — model ' + DATA.model_version }));
    mp.appendChild(el('p', { text: 'A log-linear fit on the ' + v.comps_n + ' live-token protocols that record a market cap and TVL. The target is log10(market cap / TVL) — what the market pays for one dollar of TVL. Every term was kept or dropped on held-out tests, not on in-sample fit: dropping a term must make leave-one-out error worse, or the term goes.' }));
    var coefs = {};
    v.coefficients.forEach(function (c) { coefs[c.name] = c.value; });
    mp.appendChild(el('div', { class: 'formula' },
      'log10(mcap / TVL) = ' + (coefs.const !== undefined ? coefs.const.toFixed(4) : '?') +
      (coefs.log_tvl !== undefined ? '  ' + (coefs.log_tvl < 0 ? '−' : '+') + ' ' + Math.abs(coefs.log_tvl).toFixed(4) + ' x log10(TVL)' : '') +
      (coefs.log_catmed !== undefined ? '  ' + (coefs.log_catmed < 0 ? '−' : '+') + ' ' + Math.abs(coefs.log_catmed).toFixed(4) + ' x log10(category median)' : ''),
      document.createElement('br'),
      'implied = round( TVL x 10^log10(mcap / TVL) ), clamped to the 5th–95th percentile of the ratios the market actually pays (x' + v.clamp_lo + ' – x' + v.clamp_hi + ')'
    ));
    // Term selection: what the held-out tests kept and what they dropped.
    var tBody = el('tbody');
    v.terms.forEach(function (t) {
      tBody.appendChild(el('tr', null,
        el('td', { text: t.name }),
        el('td', { text: t.kept ? 'kept' : 'dropped' }),
        el('td', { class: 'num', text: 'x' + t.loo_multiple_with }),
        el('td', { class: 'num', text: 'x' + t.loo_multiple_without })
      ));
    });
    mp.appendChild(el('div', { class: 'compstable' }, el('table', null,
      el('caption', { text: 'Term selection by leave-one-out error. A term stays only when removing it makes held-out error worse.' }),
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Term' }), el('th', { scope: 'col', text: 'Decision' }), el('th', { scope: 'col', text: 'LOO with term' }), el('th', { scope: 'col', text: 'LOO without term' }))),
      tBody
    )));
    mp.appendChild(el('p', { text: 'Held-out validation, computed at runtime from this snapshot. As-fitted builds the category table once on all ' + v.loo_n + ' comps, so a held-out protocol\u2019s own ratio leaks into its prediction; honest rebuilds the table inside every fold and every split, so nothing leaks — and the honest numbers are worse for it. Both are printed, labelled, so this entry can be compared with any claimed error on the same footing.' }));
    var vBody = el('tbody');
    [
      ['Leave-one-out', v.loo_multiple, v.loo_mae_multiple, v.loo_typical_multiple, v.honest_loo_multiple, v.honest_loo_mae_multiple, v.honest_loo_typical_multiple],
      ['Walk-forward', v.walk_forward_multiple, v.walk_forward_mae_multiple, v.walk_forward_typical_multiple, v.honest_walk_forward_multiple, v.honest_walk_forward_mae_multiple, v.honest_walk_forward_typical_multiple],
      ['Reverse walk-forward', v.walk_forward_reverse_multiple, v.walk_forward_reverse_mae_multiple, v.walk_forward_reverse_typical_multiple, v.honest_walk_forward_reverse_multiple, v.honest_walk_forward_reverse_mae_multiple, v.honest_walk_forward_reverse_typical_multiple],
      ['10-fold (round-robin by slug), honest', null, null, null, v.honest_tenfold_multiple, v.honest_tenfold_mae_multiple, v.honest_tenfold_typical_multiple]
    ].forEach(function (r) {
      var cells = [el('td', { text: r[0] })];
      for (var i = 1; i < r.length; i++) cells.push(el('td', { class: 'num', text: (r[i] === null || r[i] === undefined) ? '—' : 'x' + r[i] }));
      vBody.appendChild(el('tr', null, cells));
    });
    mp.appendChild(el('div', { class: 'compstable' }, el('table', null,
      el('caption', { text: 'Held-out error as a multiple (10^error in log10), ' + v.loo_n + ' comps. RMSE is pulled up by a few protocols orders of magnitude off their peers; MAE and median say what the model usually gets wrong.' }),
      el('thead', null,
        el('tr', null, el('th', { scope: 'col', text: 'Test' }), el('th', { scope: 'col', colspan: '3', text: 'As-fitted' }), el('th', { scope: 'col', colspan: '3', text: 'Honest' })),
        el('tr', null, el('th', { scope: 'col', text: '' }), el('th', { scope: 'col', text: 'RMSE' }), el('th', { scope: 'col', text: 'MAE' }), el('th', { scope: 'col', text: 'Median' }), el('th', { scope: 'col', text: 'RMSE' }), el('th', { scope: 'col', text: 'MAE' }), el('th', { scope: 'col', text: 'Median' }))
      ),
      vBody
    )));
    mp.appendChild(el('p', { text: 'The 10-fold line deals the ' + v.loo_n + ' comps round-robin by slug into 10 folds (11, 10, 10, 10, 10, 10, 10, 10, 10, 10); each fold refits with the category table rebuilt from the other nine folds, so it is honest the same way the leave-one-out and walk-forward numbers are. There is no as-fitted 10-fold column because the test is only meaningful with the table rebuilt per fold.' }));
    mp.appendChild(el('p', { text: 'The 90% interval on each implied value is priced per TVL band from the honest leave-one-out residuals: ' + v.interval_bands.map(function (b) { return b.band + ' x' + b.factor + ' (' + b.n + ' comps' + (b.fallback ? ', global fallback' : '') + ')'; }).join(', ') + '. The old single factor was x' + v.interval_factor + ' as-fitted (x' + v.interval_factor_honest + ' honest); one factor overstates the range on the big rows and understates it on the small ones, because market multiples span four orders of magnitude and small protocols are noisier.' }));
    mp.appendChild(el('p', { text: 'The comps leave out exchanges and bridges: an exchange\u2019s token prices its whole exchange business, not the TVL on its DeFi product, and a bridge\u2019s TVL is assets in transit, not value captured. Their market-cap / TVL ratios run from 0.00025x to 69x — nearly six orders of magnitude — so they would set the board\u2019s prices from businesses the board does not rank. The ' + v.comps_n + ' comps are the live-token protocols outside those four categories; the rule is over categories, never names, and pre-token bridges are still ranked, on the global median.' }));
    mp.appendChild(el('p', { text: 'The category median behind each row is shrunk toward the global median x' + fmtMult(DATA.global_median) + ' by weight n / (n + ' + m.shrinkage_k + '), so a category with one comp cannot set the board. No protocol name is special-cased, and no row is hand-picked.' }));
    // Launch odds: the fitted curve, and what it says at each age.
    var oc = {};
    v.odds_coefficients.forEach(function (c) { oc[c.name] = c.value; });
    function sig(z) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))); }
    function oddsAt(age, share) {
      var pNow = sig((oc.const || 0) + (oc.log_age || 0) * Math.log10(age + 30) + (oc.cat_share || 0) * share);
      var pHor = sig((oc.const || 0) + (oc.log_age || 0) * Math.log10(age + v.odds_horizon_days + 30) + (oc.cat_share || 0) * share);
      if (pHor <= pNow) return 0;
      return Math.min(0.95, (pHor - pNow) / (1 - pNow));
    }
    mp.appendChild(el('h2', { text: 'Launch odds — the peers\u2019 own record' }));
    mp.appendChild(el('p', { text: 'A logistic fit on every protocol with a listing date: launched (1) or not (0), on log age and the category\u2019s launched share (shrunk toward the overall share ' + v.odds_overall_share + ' with prior weight ' + m.odds_prior + '). Coefficients: const ' + (oc.const !== undefined ? oc.const.toFixed(3) : '?') + ', log age ' + (oc.log_age !== undefined ? oc.log_age.toFixed(3) : '?') + ', category share ' + (oc.cat_share !== undefined ? oc.cat_share.toFixed(3) : '?') + '. Odds for a protocol are the chance it launches in the next ' + Math.round(v.odds_horizon_days / 365) + ' years, given it has not launched by its current age. Protocols with no listing date use the median pre-token age, ' + v.median_age_days + ' days.' }));
    var oBody = el('tbody');
    [30, 90, 180, 365, 730, 1095, 1500].forEach(function (age) {
      oBody.appendChild(el('tr', null,
        el('td', { class: 'num', text: fmtAge(age) }),
        el('td', { class: 'num', text: (oddsAt(age, v.odds_overall_share) * 100).toFixed(1) + '%' })
      ));
    });
    mp.appendChild(el('div', { class: 'compstable' }, el('table', null,
      el('caption', { text: 'Launch odds by age for the average category (overall launched share ' + v.odds_overall_share + '). Odds fall with age: older unlaunched protocols are the ones the market has already passed over.' }),
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Age with no token' }), el('th', { scope: 'col', text: 'Launch odds, next ' + Math.round(v.odds_horizon_days / 365) + 'y' }))),
      oBody
    )));
    var cp = document.getElementById('compspanel');
    cp.textContent = '';
    cp.appendChild(el('h2', { text: 'Comps: what the market pays, by category' }));
    cp.appendChild(el('p', { text: 'Each row is a category\u2019s live-token protocols. Median is the median market-cap / TVL of that category; Used is the shrunk multiple the model applies, falling back to the global median x' + fmtMult(DATA.global_median) + ' when a category has no comps.' }));
    var tbody = el('tbody');
    DATA.comps.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.comps) }),
        el('td', { class: 'num', text: 'x' + fmtMult(c.median) }),
        el('td', { class: 'num', text: 'x' + fmtMult(c.used) }),
        el('td', { text: c.source === 'category' ? 'category comps' : 'global fallback' })
      ));
    });
    cp.appendChild(el('div', { class: 'compstable' }, el('table', null,
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Comps' }), el('th', { scope: 'col', text: 'Median' }), el('th', { scope: 'col', text: 'Used' }), el('th', { scope: 'col', text: 'Source' }))),
      tbody
    )));
  }

  var dialog = document.getElementById('detail');
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); renderTable(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var m = row.model;
    var catLine = 'category median x' + fmtMult(m.catmed_used) +
      (m.comp_source === 'category'
        ? ' (median of ' + m.comp_count + ' live comp' + (m.comp_count === 1 ? '' : 's') + ' in ' + (row.category || 'Uncategorised') + (m.catmed_raw !== null ? ', raw median x' + fmtMult(m.catmed_raw) : '') + ', shrunk toward the global median)'
        : ' (global median — ' + m.comp_count + ' comps in category)');
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'tag' + (WATCH[row.slug] ? ' watch' : ''), text: WATCH[row.slug] ? 'watchlist · rank ' + row.rank : 'rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' — records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the fitted model, line by line' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Fitted multiple' }), el('b', { class: 'num', text: 'x' + fmtMult(m.fitted_multiple) + (m.clamped ? ' (clamped)' : '') })),
        el('div', null, el('span', { text: 'log10(TVL)' }), el('b', { class: 'num', text: m.log_tvl.toFixed(4) })),
        el('div', null, el('span', { text: 'log10(category median)' }), el('b', { class: 'num', text: m.log_catmed.toFixed(4) })),
        el('div', null, el('span', { text: 'Age with no token issued' }), el('b', { class: 'num', text: fmtAge(m.age_days) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: '90% range (' + m.interval_band + ' band, x' + m.interval_factor + ')' }), el('b', { class: 'num', text: fmtUsd(row.implied_lo_usd) + ' – ' + fmtUsd(row.implied_hi_usd) }))
      ),
      el('p', { class: 'sub', text: catLine + '. The page recomputes this row as ' + fmtUsd(impliedOf(row, { scale: 1 })) + ' — the same number board.json carries. This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Launch odds and verdict' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Launch odds, next ' + Math.round(DATA.validation.odds_horizon_days / 365) + ' years' }), el('b', { class: 'num', text: (row.launch_odds * 100).toFixed(1) + '%' })),
        el('div', null, el('span', { text: 'Expected value (implied x odds)' }), el('b', { class: 'num', text: fmtUsd(Math.round(row.implied_value_usd * row.launch_odds)) })),
        el('div', { class: 'total' }, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: row.farm_verdict + ' — farm cost about $' + row.farm_cost_usd + ' (~$' + row.farm_cost_per_hour_usd + ' per active hour)' }))
      ),
      el('p', { class: 'sub', text: 'Odds come from a logistic fit on the peers\u2019 record (log age and the category\u2019s launched share); they fall with age, so an old protocol can rank high on value and still be a Watch. The verdict is Farm when both implied value and odds sit above their board medians, Watch when one does, Skip when neither does.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — six steps, with cost and time' }),
      DATA.farm_capital ? el('p', { class: 'sub', text: 'Capital is the larger of the TVL tier and five times the plan\u2019s six-transaction gas, so fees stay under a fifth of the position — on Ethereum that means $' + DATA.farm_capital.ethereum_capital + ', not $' + DATA.farm_capital.min_tier + '; on Bitcoin $' + DATA.farm_capital.bitcoin_capital + '.' }) : null,
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
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
    topMeta();
    hero();
    controls();
    sandboxPanel();
    renderTable();
    renderLive();
    renderModel();
    setView(state.view);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });
  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
