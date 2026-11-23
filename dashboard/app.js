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
    sandbox: { scale: 1, growth: 0.5, maturity: 1, on: false }
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
  // re-rank the board live. base = the category's comps multiple from the snapshot.
  function impliedOf(row, sb) {
    var m = row.model;
    var growth = Math.min(DATA.model.growth_cap, Math.max(DATA.model.growth_floor, m.growth_pct));
    var growthMult = 1 + (growth / 100) * sb.growth;
    var maturity = 1 + (m.maturity_multiplier - 1) * sb.maturity;
    return Math.max(1, Math.round(row.tvl_usd * m.base_multiple * sb.scale * growthMult * maturity * m.chain_factor));
  }
  function sandboxImplied(row) {
    return state.sandbox.on ? impliedOf(row, state.sandbox) : row.implied_value_usd;
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
    var withVal = list.map(function (r) { return { r: r, v: sandboxImplied(r) }; });
    withVal.sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.r.name.toLowerCase(); bv = b.r.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.r.tvl_usd; bv = b.r.tvl_usd; }
      else if (key === 'growth') { av = a.r.change_7d === null ? -Infinity : a.r.change_7d; bv = b.r.change_7d === null ? -Infinity : b.r.change_7d; }
      else if (key === 'age') { av = a.r.age_days === null ? Infinity : a.r.age_days; bv = b.r.age_days === null ? Infinity : b.r.age_days; }
      else { av = a.v; bv = b.v; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.r.slug < b.r.slug ? -1 : a.r.slug > b.r.slug ? 1 : 0;
    });
    return withVal;
  }

  function topMeta() {
    var elTop = document.getElementById('topmeta');
    elTop.textContent = '';
    elTop.appendChild(el('span', null, 'snapshot ', el('b', { text: DATA.as_of })));
    elTop.appendChild(el('span', null, 'model ', el('b', { text: DATA.model_version })));
    elTop.appendChild(el('span', null, 'rows ', el('b', { text: String(DATA.board_size) })));
    elTop.appendChild(el('span', null, 'global comps ', el('b', { text: 'x' + fmtMult(DATA.global_median) })));
  }

  function hero() {
    document.getElementById('lede').textContent =
      'Every protocol below records no token yet. The board ranks ' + DATA.board_size + ' of them by implied value — ' +
      'TVL times the multiple the market already pays for the same kind of protocol — and the watchlist of ' +
      DATA.watchlist_size + ' is the floor, not the ceiling: ' + DATA.early_size +
      ' more pre-token protocols below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor are ranked too. ' +
      'Implied value is this entry\u2019s own claim, never a promise, and never a prediction of whether or when a token is issued.';
    var stats = document.getElementById('stats');
    stats.textContent = '';
    var top = sortedRows(DATA.rows.slice())[0];
    var items = [
      [String(DATA.watchlist_size) + ' / ' + DATA.watchlist_size, 'watchlist covered'],
      [String(DATA.board_size), 'pre-token rows ranked'],
      [String(DATA.early_size), 'early rows below the floor'],
      [String(DATA.live_size), 'live-token protocols set aside'],
      [fmtUsd(top ? top.v : 0), 'top implied value']
    ];
    items.forEach(function (it) {
      stats.appendChild(el('div', { class: 'stat' }, el('b', { text: it[0] }), el('span', { text: it[1] })));
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
    box.appendChild(el('p', { text: 'Change the three dials and the board re-ranks in the page from the same snapshot figures. board.json keeps the published model; the sandbox only asks what-if.' }));
    var sliders = el('div', { class: 'sliders' });
    function slider(id, label, min, max, step, value, fmt) {
      var out = el('output', { text: fmt(value) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      input.addEventListener('input', function () {
        state.sandbox[id] = parseFloat(input.value);
        state.sandbox.on = state.sandbox.scale !== 1 || state.sandbox.growth !== DATA.model.growth_weight || state.sandbox.maturity !== 1;
        out.textContent = fmt(state.sandbox[id]);
        box.className = 'sandbox' + (state.sandbox.on ? ' on' : '');
        box.querySelector('h2').textContent = state.sandbox.on ? 'MODEL SANDBOX — LIVE RE-RANK (NOT board.json)' : 'MODEL SANDBOX — DRAG TO RE-RANK THE BOARD';
        renderTable();
      });
      return el('div', { class: 'slider' }, el('label', { for: id }, label, out), input);
    }
    sliders.appendChild(slider('scale', 'Base-multiple scale', 0.5, 2, 0.05, state.sandbox.scale, function (v) { return 'x' + v.toFixed(2); }));
    sliders.appendChild(slider('growth', 'Growth weight', 0, 1, 0.05, state.sandbox.growth, function (v) { return v.toFixed(2); }));
    sliders.appendChild(slider('maturity', 'Maturity strength', 0, 1, 0.05, state.sandbox.maturity, function (v) { return v.toFixed(2); }));
    box.appendChild(sliders);
    box.appendChild(el('button', { class: 'button reset', type: 'button', text: 'Reset sandbox', onclick: function () {
      state.sandbox = { scale: 1, growth: DATA.model.growth_weight, maturity: 1, on: false };
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
    var max = list[0].v || 1;
    var tbody = el('tbody');
    list.forEach(function (item, i) {
      var r = item.r;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankLabel = state.sandbox.on ? String(i + 1) : String(r.rank);
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
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((item.v / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(item.v) })
        )),
        el('td', null,
          el('span', { class: 'tag' + (WATCH[r.slug] ? ' watch' : ''), text: WATCH[r.slug] ? 'watchlist' : 'records no token' })
        )
      );
      tbody.appendChild(tr);
    });
    wrap.appendChild(el('table', null,
      el('caption', { text: state.sandbox.on
        ? 'Sandbox re-rank: the board re-sorted by your dials. The published ranks in board.json are unchanged.'
        : 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
      el('thead', null, el('tr', null,
        sortHeader('implied', 'Rank'),
        sortHeader('name', 'Protocol'),
        sortHeader('tvl', 'TVL'),
        sortHeader('growth', '7d'),
        sortHeader('age', 'Age'),
        sortHeader('implied', 'Implied value'),
        el('th', { scope: 'col', text: 'Token' })
      )),
      tbody
    ));
    document.getElementById('boardnote').textContent =
      'Rank is the model\u2019s claim, not a price. Every row records no token in the snapshot; a protocol on the list may still have a token its DefiLlama record does not carry. The farm plan is in each row\u2019s detail view.';
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
      el('caption', { text: 'The ' + DATA.live.length + ' largest live-token protocols by market cap, with the market-cap / TVL ratio the comps model is built from.' }),
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
      tbody
    ));
  }

  function renderModel() {
    var m = DATA.model;
    var mp = document.getElementById('modelpanel');
    mp.textContent = '';
    mp.appendChild(el('h2', { text: 'How implied value is computed — model ' + DATA.model_version }));
    mp.appendChild(el('p', { text: 'One function scores every protocol. The base multiple comes from the market, not from a hand-picked constant: it is the median market-cap / TVL of the live-token protocols in the same category, read from this snapshot at runtime. A category with fewer than ' + m.min_comps + ' live comps falls back to the global median, and no multiple is used above x' + m.base_cap + '.' }));
    mp.appendChild(el('div', { class: 'formula' },
      'implied = round( tvl_usd',
      el('b', { text: ' x baseMultiple' }),
      ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')',
      el('b', { text: ' x maturity' }),
      ' x chainFactor )',
      document.createElement('br'),
      'maturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + '   (age unknown: ' + m.unknown_age_days + 'd)',
      document.createElement('br'),
      'chainFactor = 1 + min(chains - 1, ' + m.chain_max_steps + ') x ' + m.chain_step
    ));
    mp.appendChild(el('p', { text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed — the best record of how long it has run with no token issued. Chain breadth counts how many chains carry its TVL: wider distribution, wider reach. No protocol name is special-cased, and no row is hand-picked.' }));
    var cp = document.getElementById('compspanel');
    cp.textContent = '';
    cp.appendChild(el('h2', { text: 'Comps: what the market pays, by category' }));
    cp.appendChild(el('p', { text: 'Each row is a category\u2019s live-token protocols. Median is the median market-cap / TVL of that category; Used is the multiple the model applies, capped at x' + m.base_cap + '. Categories with fewer than ' + m.min_comps + ' comps use the global median x' + fmtMult(DATA.global_median) + '.' }));
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
    var baseLine = 'TVL ' + fmtUsd(row.tvl_usd) + ' x base multiple x' + fmtMult(m.base_multiple) +
      ' (' + (m.comp_source === 'category' ? 'median of ' + m.comp_count + ' live comps in ' + (row.category || 'Uncategorised') : 'global median, ' + m.comp_count + ' comps in category') + ')';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'tag' + (WATCH[row.slug] ? ' watch' : ''), text: WATCH[row.slug] ? 'watchlist · rank ' + row.rank : 'rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' — records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model, line by line' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Base multiple (comps)' }), el('b', { class: 'num', text: 'x' + fmtMult(m.base_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: 'x' + fmtMult(m.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token issued' }), el('b', { class: 'num', text: fmtAge(m.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: 'x' + fmtMult(m.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain factor (' + (row.chains || []).length + ' chains)' }), el('b', { class: 'num', text: 'x' + fmtMult(m.chain_factor) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: baseLine + '. The page recomputes this row as ' + fmtUsd(impliedOf(row, { scale: 1, growth: DATA.model.growth_weight, maturity: 1 })) + ' — the same number board.json carries. This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — six steps, with cost and time' }),
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
