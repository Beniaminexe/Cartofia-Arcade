/* ==========================================================================
   Cartofia Blackjack — table art  (window.BJArt)
   Pure presentation. game.js still owns the shoe, the rules, the turn order,
   the room wire protocol, the casino wallet and result reporting; it hands
   this file a read-only "view" of the table once per render and asks it to
   draw. Nothing here writes game state, and nothing here touches
   Math.random (decoration uses its own seeded PRNG).

   The cover (assets/games/blackjack.svg) come to life:
     - a lamp-lit green felt with grain and the cover's dot print, inside a
       padded Night Market rail with a gold inlay; the payout rules printed
       on the felt along the cover's arcs; a card shoe and a dealer chip rack
     - an original deck drawn as inline SVG (crisp at any size): ivory cards
       with an ink outline, serif indices, classic pip layouts, original
       court panels (crown / tiara / plume), and a theme-accent back.
       Four-colour suits (spades ink, hearts red, diamonds blue, clubs
       green) so suit never depends on red vs black alone
     - casino chips in the cover's colours, stacked in betting spots
     - cards fly out of the shoe and turn over as they land, the dealer's
       hole card flips to the card it really is, bets slide onto the spots,
       winnings slide out of the rack, lost bets are swept into it
   Every effect is driven by the final state of each render: the board is
   always drawn from the view first, then the new parts are animated in
   from where they came from. A new round removes every card, chip, stamp
   and particle of the previous one.
   prefers-reduced-motion: no flights, flips, sweeps or particles; new
   things fade in.

   API (used by game.js):
     BJArt.renderTable(view)            view: see game.js renderTable()
     BJArt.banner(el, text, kind)       draws the round-result plaque
     BJArt.betPreview(el, amount)       chip stack beside the bet stepper
     BJArt.isReduced()
   ========================================================================== */
(function () {
  'use strict';
  if (window.BJArt) return;

  const INK = '#1b1230', IVORY = '#fff6e5';
  const LEMON = '#ffcf5c', CORAL = '#ff6b4a', MINT = '#3ee6a6';
  const SUITS = {
    S: { name: 'spades', color: '#1b1230' },
    H: { name: 'hearts', color: '#d3223f' },
    D: { name: 'diamonds', color: '#1c58d4' },
    C: { name: 'clubs', color: '#0b7a50' }
  };
  const RANK_LABEL = { T: '10' };
  const RANK_NAME = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King', T: '10' };
  const SEAT_COLORS = ['#ff6b4a', '#3ee6a6', '#ffcf5c', '#a58bff', '#5c9dff', '#ff86c2'];
  // Chip colours: the cover's red / blue / yellow, plus Night Market ink and violet.
  const DENOMS = [
    { v: 1000, base: '#f2c94c', side: '#b0861b', light: '#ffe596', spot: '#1b1230' },
    { v: 500, base: '#8f72ff', side: '#5a3fd0', light: '#c0b0ff', spot: IVORY },
    { v: 100, base: '#2e2549', side: '#140f25', light: '#4a3e72', spot: LEMON },
    { v: 50, base: '#e0314b', side: '#a01b32', light: '#ff7488', spot: IVORY },
    { v: 10, base: '#2f6bff', side: '#1b43b8', light: '#79a0ff', spot: IVORY }
  ];

  function prng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const FX = prng(0xb1ac6);   // visual-only randomness for particles
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ---------- environment ---------- */
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(mq && mq.matches);
  if (mq) {
    const onMq = () => { reduced = !!mq.matches; };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  }
  let accent = '#7c5cff';
  function readTheme() {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      if (v) accent = v;
    } catch (e) { /* keep default */ }
  }
  readTheme();
  document.addEventListener('cartofia:theme-changed', readTheme);
  window.addEventListener('cartofia:theme-changed', readTheme);

  /* ======================================================================
     Shared SVG defs: suit shapes, gradients, the card back, the lattice.
     ====================================================================== */
  const SUIT_SHAPES = {
    S: '<path d="M0-.96C.3-.62 1-.3 1 .14 1 .48.74.64.48.64.3.64.16.56.08.46.1.7.22.86.36.96H-.36C-.22.86-.1.7-.08.46-.16.56-.3.64-.48.64-.74.64-1 .48-1 .14-1-.3-.3-.62 0-.96Z"/>',
    H: '<path d="M0 .92C-.35.62-1 .2-1-.34-1-.74-.68-.96-.42-.96-.2-.96-.05-.82 0-.62.05-.82.2-.96.42-.96.68-.96 1-.74 1-.34 1 .2.35.62 0 .92Z"/>',
    D: '<path d="M0-1C.22-.62.46-.3.78 0 .46.3.22.62 0 1-.22.62-.46.3-.78 0-.46-.3-.22-.62 0-1Z"/>',
    C: '<circle cx="0" cy="-.5" r=".4"/><circle cx="-.5" cy=".1" r=".4"/><circle cx=".5" cy=".1" r=".4"/>' +
       '<circle cx="0" cy=".05" r=".26"/><path d="M-.09.1C-.09.55-.2.8-.38.96H.38C.2.8.09.55.09.1Z"/>'
  };
  const EMBLEM = {
    // King: crown
    K: '<path d="M-14 7V-5L-7 1.5 0-9 7 1.5 14-5V7Z"/><rect x="-14.5" y="7" width="29" height="5" rx="1.4"/>' +
       '<circle cx="0" cy="-10.5" r="2.3"/><circle cx="-14" cy="-6.2" r="1.9"/><circle cx="14" cy="-6.2" r="1.9"/>',
    // Queen: tiara
    Q: '<path d="M-15 9C-13-3-6-9 0-11 6-9 13-3 15 9 9 6.2 4 5.4 0 5.4-4 5.4-9 6.2-15 9Z"/>' +
       '<circle cx="-8.6" cy="1.6" r="1.5"/><circle cx="8.6" cy="1.6" r="1.5"/>',
    // Jack: plume
    J: '<path d="M-7 12C-13 1-8-10 9-13 5-6 6.5 2-7 12Z"/><path d="M-9 13.5-6.4 10.6" stroke-width="2.4"/>'
  };
  const EMBLEM_GEM = { K: [0, 2.6, 2.4], Q: [0, -2.6, 3.1], J: [1, -2, 0] };

  function stops(list) {
    return list.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('');
  }
  function ensureDefs() {
    if (document.getElementById('bj-defs')) return;
    let s = '<defs>';
    s += '<linearGradient id="bj-g-face" x1="0" y1="0" x2="0" y2="1">' + stops([[0, '#fffdf7'], [0.6, '#fbf3e2'], [1, '#efe2c6']]) + '</linearGradient>';
    s += '<linearGradient id="bj-g-gloss" x1="0" y1="0" x2="1" y2="1">' + stops([[0, '#ffffff', 0.85], [0.45, '#ffffff', 0]]) + '</linearGradient>';
    s += '<linearGradient id="bj-g-shade" x1="0" y1="0" x2="1" y2="1">' + stops([[0, '#ffffff', 0.26], [0.5, '#ffffff', 0], [1, '#05020c', 0.42]]) + '</linearGradient>';
    s += '<linearGradient id="bj-g-gold" x1="0" y1="0" x2="0" y2="1">' + stops([[0, '#fff1b8'], [0.55, '#f4c64e'], [1, '#c98f1c']]) + '</linearGradient>';
    s += '<radialGradient id="bj-g-medal" cx=".38" cy=".32" r=".8">' + stops([[0, '#3e3170'], [1, '#120b24']]) + '</radialGradient>';
    s += '<pattern id="bj-p-lattice" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
         '<path d="M0 .5H9M.5 0V9" stroke="#ffffff" stroke-opacity=".2" stroke-width="1"/>' +
         '<circle cx="5" cy="5" r=".9" fill="#ffffff" fill-opacity=".22"/></pattern>';
    s += '</defs>';
    Object.keys(SUIT_SHAPES).forEach((k) => {
      s += '<symbol id="bj-s-' + k + '" viewBox="-1 -1 2 2" overflow="visible">' + SUIT_SHAPES[k] + '</symbol>';
    });
    // card back — the field takes the user's theme accent (CSS var, inherited through <use>)
    s += '<symbol id="bj-back" viewBox="0 0 100 140">' +
      '<rect x="1.5" y="1.5" width="97" height="137" rx="9" fill="' + IVORY + '" stroke="' + INK + '" stroke-width="3"/>' +
      '<rect x="7.5" y="7.5" width="85" height="125" rx="5" style="fill:var(--bj-back, #7c5cff)"/>' +
      '<rect x="7.5" y="7.5" width="85" height="125" rx="5" fill="url(#bj-p-lattice)"/>' +
      '<rect x="7.5" y="7.5" width="85" height="125" rx="5" fill="url(#bj-g-shade)"/>' +
      '<rect x="12" y="12" width="76" height="116" rx="3" fill="none" stroke="' + IVORY + '" stroke-opacity=".6" stroke-width="1.3"/>' +
      '<circle cx="50" cy="70" r="19" fill="url(#bj-g-medal)" stroke="' + LEMON + '" stroke-width="2.2"/>' +
      '<circle cx="50" cy="70" r="14.5" fill="none" stroke="' + IVORY + '" stroke-width="3.4" stroke-dasharray="4.2 3.4" opacity=".9"/>' +
      '<rect x="42.2" y="62.2" width="7" height="7" rx="1.6" fill="' + LEMON + '" opacity=".6"/>' +
      '<rect x="50.8" y="62.2" width="7" height="7" rx="1.6" fill="' + LEMON + '"/>' +
      '<rect x="42.2" y="70.8" width="7" height="7" rx="1.6" fill="' + LEMON + '"/>' +
      '<rect x="50.8" y="70.8" width="7" height="7" rx="1.6" fill="' + LEMON + '" opacity=".6"/>' +
      '<path d="M5 14Q5 5 14 5H58Q26 26 5 64Z" fill="url(#bj-g-gloss)" opacity=".35"/>' +
      '</symbol>';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'bj-defs');
    svg.setAttribute('class', 'bj-defs');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = s;
    (document.body || document.documentElement).appendChild(svg);
  }

  /* ======================================================================
     Card faces. 100 x 140 units; built once per card, then cloned.
     ====================================================================== */
  const f1 = (n) => Math.round(n * 10) / 10;
  function pip(suit, cx, cy, size, col, flip) {
    const h = size / 2;
    return '<use href="#bj-s-' + suit + '" x="' + f1(cx - h) + '" y="' + f1(cy - h) + '" width="' + size + '" height="' + size + '" fill="' + col + '"' +
      (flip ? ' transform="rotate(180 ' + f1(cx) + ' ' + f1(cy) + ')"' : '') + '/>';
  }
  function cornerIndex(rank, suit, col) {
    const label = RANK_LABEL[rank] || rank;
    const ten = label.length > 1;
    return '<text x="13" y="27" text-anchor="middle" class="bj-idx" fill="' + col + '"' +
      (ten ? ' font-size="21" textLength="20" lengthAdjust="spacingAndGlyphs"' : ' font-size="24"') + '>' + label + '</text>' +
      pip(suit, 13, 36.5, 12.5, col, false);
  }
  const PL = 33, PM = 50, PR = 67, PT = 28.5, PB = 111.5;
  const LAYOUT = {
    2: [[PM, 0], [PM, 1]],
    3: [[PM, 0], [PM, 0.5], [PM, 1]],
    4: [[PL, 0], [PR, 0], [PL, 1], [PR, 1]],
    5: [[PL, 0], [PR, 0], [PM, 0.5], [PL, 1], [PR, 1]],
    6: [[PL, 0], [PR, 0], [PL, 0.5], [PR, 0.5], [PL, 1], [PR, 1]],
    7: [[PL, 0], [PR, 0], [PM, 0.25], [PL, 0.5], [PR, 0.5], [PL, 1], [PR, 1]],
    8: [[PL, 0], [PR, 0], [PM, 0.25], [PL, 0.5], [PR, 0.5], [PM, 0.75], [PL, 1], [PR, 1]],
    9: [[PL, 0], [PR, 0], [PL, 1 / 3], [PR, 1 / 3], [PM, 0.5], [PL, 2 / 3], [PR, 2 / 3], [PL, 1], [PR, 1]],
    10: [[PL, 0], [PR, 0], [PM, 1 / 6], [PL, 1 / 3], [PR, 1 / 3], [PL, 2 / 3], [PR, 2 / 3], [PM, 5 / 6], [PL, 1], [PR, 1]]
  };
  function centre(rank, suit, col) {
    if (rank === 'A') {
      const big = suit === 'S' ? 56 : 48;
      return '<circle cx="50" cy="70" r="33" fill="none" stroke="' + col + '" stroke-opacity=".16" stroke-width="1.2"/>' +
        '<circle cx="50" cy="70" r="29" fill="none" stroke="' + col + '" stroke-opacity=".3" stroke-width="1.1" stroke-dasharray="1.2 3.2" stroke-linecap="round"/>' +
        pip(suit, 50, 70, big, col, false);
    }
    if (rank === 'J' || rank === 'Q' || rank === 'K') {
      const g = EMBLEM_GEM[rank];
      let s = '<rect x="21" y="17" width="58" height="106" rx="5" fill="' + col + '" fill-opacity=".08" stroke="' + col + '" stroke-opacity=".55" stroke-width="1.4"/>';
      s += '<rect x="24.5" y="20.5" width="51" height="99" rx="3" fill="none" stroke="' + col + '" stroke-opacity=".25" stroke-width=".8" stroke-dasharray="2 2"/>';
      s += '<g transform="translate(50 41)" fill="url(#bj-g-gold)" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">' + EMBLEM[rank] + '</g>';
      if (g[2]) s += '<circle cx="' + (50 + g[0]) + '" cy="' + (41 + g[1]) + '" r="' + g[2] + '" fill="' + col + '" stroke="' + INK + '" stroke-width="1"/>';
      s += '<text x="50" y="92" text-anchor="middle" class="bj-court" font-size="40" fill="' + col + '" stroke="' + IVORY + '" stroke-width="3" paint-order="stroke">' + rank + '</text>';
      s += pip(suit, 50, 107, 13, col, false);
      return s;
    }
    const n = rank === 'T' ? 10 : (Number(rank) || 0);
    const list = LAYOUT[n] || [];
    const size = n <= 3 ? 20 : (n >= 9 ? 15.5 : 17.5);
    return list.map((p) => pip(suit, p[0], PT + (PB - PT) * p[1], size, col, p[1] > 0.5)).join('');
  }
  const faceCache = Object.create(null);
  const tpl = document.createElement('template');
  function fromString(str) {
    tpl.innerHTML = str;
    return tpl.content.firstElementChild;
  }
  function faceNode(code) {
    let n = faceCache[code];
    if (!n) {
      const rank = String(code).charAt(0), suit = String(code).charAt(1);
      const col = (SUITS[suit] || SUITS.S).color;
      let s = '<svg class="bj-face bj-face-front" viewBox="0 0 100 140" aria-hidden="true" focusable="false">';
      s += '<rect x="1.5" y="1.5" width="97" height="137" rx="9" fill="url(#bj-g-face)" stroke="' + INK + '" stroke-width="3"/>';
      s += '<rect x="5.5" y="5.5" width="89" height="129" rx="6" fill="none" stroke="' + col + '" stroke-opacity=".12" stroke-width="1"/>';
      s += centre(rank, suit, col);
      s += cornerIndex(rank, suit, col);
      s += '<g transform="rotate(180 50 70)">' + cornerIndex(rank, suit, col) + '</g>';
      s += '<path d="M5 14Q5 5 14 5H60Q28 24 5 58Z" fill="url(#bj-g-gloss)" opacity=".5"/>';
      s += '</svg>';
      n = faceCache[code] = fromString(s);
    }
    return n.cloneNode(true);
  }
  let backTpl = null;
  function backNode() {
    if (!backTpl) {
      backTpl = fromString('<svg class="bj-face bj-face-back" viewBox="0 0 100 140" aria-hidden="true" focusable="false"><use href="#bj-back"/></svg>');
    }
    return backTpl.cloneNode(true);
  }
  function cardName(code) {
    const rank = String(code).charAt(0), suit = String(code).charAt(1);
    return (RANK_NAME[rank] || rank) + ' of ' + ((SUITS[suit] || {}).name || suit);
  }
  function span(cls) { const e = document.createElement('span'); if (cls) e.className = cls; return e; }

  function cardEl(code, up, tilt) {
    const el = span('bj-card' + (up ? '' : ' is-down'));
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', up ? cardName(code) : 'Hidden card');
    el.style.rotate = tilt.toFixed(2) + 'deg';
    const inner = span('bj-card-in');
    if (up) inner.appendChild(faceNode(code));
    inner.appendChild(backNode());
    el.appendChild(inner);
    return el;
  }
  function tiltFor(key, i) {
    const h = hash(key + ':' + i);
    return ((h % 1000) / 1000 - 0.5) * 5;   // -2.5 .. 2.5 deg, stable per seat + slot
  }

  /* ======================================================================
     Chips
     ====================================================================== */
  function chipList(amount) {
    let a = Math.max(0, Math.round(Number(amount) || 0));
    const out = [];
    for (const d of DENOMS) {
      while (a >= d.v && out.length < 24) { out.push(d); a -= d.v; }
    }
    if (!out.length && amount > 0) out.push(DENOMS[DENOMS.length - 1]);
    return out;
  }
  const colCache = Object.create(null);
  function columnNode(list) {
    const key = list.map((d) => d.v).join(',');
    let n = colCache[key];
    if (!n) {
      const STEP = 4.2;
      const H = 18 + (list.length - 1) * STEP;
      let s = '<svg class="bj-chipcol" viewBox="0 0 40 ' + f1(H) + '" style="--n:' + list.length + '" aria-hidden="true" focusable="false">';
      for (let k = 0; k < list.length; k++) {
        const d = list[k];
        const cy = f1(H - 11 - k * STEP);
        s += '<path d="M2 ' + cy + 'A18 7 0 0 0 38 ' + cy + 'V' + f1(cy + 4) + 'A18 7 0 0 1 2 ' + f1(cy + 4) + 'Z" fill="' + d.side + '" stroke="#120b24" stroke-width=".9"/>';
        s += '<path d="M2 ' + f1(cy + 2) + 'A18 7 0 0 0 38 ' + f1(cy + 2) + '" fill="none" stroke="' + d.spot + '" stroke-width="2.4" stroke-dasharray="3.4 4.6" stroke-dashoffset="1.5"/>';
        s += '<ellipse cx="20" cy="' + cy + '" rx="18" ry="7" fill="' + d.base + '" stroke="#120b24" stroke-width=".9"/>';
        if (k === list.length - 1) {
          s += '<ellipse cx="20" cy="' + cy + '" rx="15.8" ry="6.1" fill="none" stroke="' + d.spot + '" stroke-width="1.5" stroke-dasharray="2.6 5" opacity=".9"/>';
          s += '<ellipse cx="20" cy="' + cy + '" rx="11.2" ry="4.2" fill="' + d.light + '" stroke="' + d.side + '" stroke-width=".7"/>';
          s += '<ellipse cx="20" cy="' + cy + '" rx="7.4" ry="2.7" fill="none" stroke="' + d.spot + '" stroke-width="1.1" stroke-dasharray="1.8 1.6"/>';
          s += '<ellipse cx="13.5" cy="' + f1(cy - 3) + '" rx="6" ry="1.5" fill="#ffffff" opacity=".32"/>';
        }
      }
      s += '</svg>';
      n = colCache[key] = fromString(s);
    }
    return n.cloneNode(true);
  }
  function stackEl(amount, cls) {
    const chips = chipList(amount);
    const wrap = span('bj-stack' + (cls ? ' ' + cls : ''));
    const cols = [];
    for (let i = 0; i < chips.length && cols.length < 3; i += 8) cols.push(chips.slice(i, i + 8));
    cols.forEach((c) => wrap.appendChild(columnNode(c)));
    wrap.setAttribute('aria-hidden', 'true');
    return wrap;
  }

  /* ======================================================================
     Small icons (stroked, 24 units)
     ====================================================================== */
  const ICON = {
    win: '<path d="M12 18V6M6.5 11.5 12 6l5.5 5.5"/>',
    lose: '<path d="M12 6v12M6.5 12.5 12 18l5.5-5.5"/>',
    push: '<path d="M6 9.5h12M6 14.5h12"/>',
    bj: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" fill="currentColor"/>',
    warn: '<path d="M12 6.5v7"/><circle cx="12" cy="17.6" r=".6" fill="currentColor"/>',
    ok: '<path d="M6.5 12.5l3.6 3.6 7.4-8"/>'
  };
  function iconSvg(name) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICON[name] || '') + '</svg>';
  }

  /* ======================================================================
     Table furniture: felt grain, shoe, chip rack
     ====================================================================== */
  let root = null;
  function paintGrain(felt) {
    try {
      const T = 128;
      const c = document.createElement('canvas');
      c.width = T; c.height = T;
      const g = c.getContext('2d');
      if (!g) return;
      const R = prng(0x7e17);
      const id = g.createImageData(T, T);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = R() < 0.5 ? 0 : 255;
        id.data[i] = v; id.data[i + 1] = v; id.data[i + 2] = v;
        id.data[i + 3] = Math.round(R() * 20);
      }
      g.putImageData(id, 0, 0);
      // a few soft fibres
      g.lineCap = 'round';
      for (let i = 0; i < 70; i++) {
        const x = R() * T, y = R() * T, a = R() * Math.PI, l = 2 + R() * 5;
        g.strokeStyle = R() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
        g.lineWidth = 0.6;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
      felt.style.setProperty('--bj-grain', 'url(' + c.toDataURL('image/png') + ')');
    } catch (e) { /* plain felt */ }
  }
  function buildShoe(el) {
    if (!el || el.childNodes.length) return;
    el.innerHTML =
      '<svg viewBox="0 0 96 64" aria-hidden="true" focusable="false">' +
      '<defs><linearGradient id="bj-g-shoe" x1="0" y1="0" x2="0" y2="1">' + stops([[0, '#43357a'], [0.5, '#251c48'], [1, '#120b24']]) + '</linearGradient></defs>' +
      '<ellipse cx="50" cy="58" rx="42" ry="5" fill="#02130b" opacity=".45"/>' +
      '<path d="M14 54L24 14Q25 10 29 10H84Q90 10 90 16V50Q90 56 84 56H18Q13 56 14 54Z" fill="url(#bj-g-shoe)" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<g transform="rotate(-14 40 30)"><svg x="27" y="12" width="26" height="36" viewBox="0 0 100 140"><use href="#bj-back"/></svg></g>' +
      '<path d="M14 54L24 14Q25 10 29 10H40L30 54Z" fill="#ffffff" opacity=".06"/>' +
      '<path d="M44 20H84V48H44Z" fill="#0d0820" stroke="' + LEMON + '" stroke-opacity=".7" stroke-width="1.4" rx="3"/>' +
      '<path d="M48 26H80M48 32H80M48 38H80M48 44H72" stroke="#ffffff" stroke-opacity=".1" stroke-width="1.2"/>' +
      '<path d="M29 12H84" stroke="#ffffff" stroke-opacity=".22" stroke-width="1.4" stroke-linecap="round"/>' +
      '</svg>';
  }
  function buildRack(el) {
    if (!el || el.childNodes.length) return;
    DENOMS.forEach((d) => {
      const t = span('bj-rack-tube');
      t.style.setProperty('--c', d.base);
      t.style.setProperty('--s', d.side);
      el.appendChild(t);
    });
  }
  function init() {
    if (root) return root;
    ensureDefs();
    root = {
      felt: document.getElementById('bjFelt'),
      fx: document.getElementById('bjFx'),
      shoe: document.getElementById('bjShoe'),
      rack: document.getElementById('bjRack'),
      dealerCards: document.getElementById('dealerCards'),
      dealerTotal: document.getElementById('dealerTotal'),
      list: document.getElementById('playersList'),
      status: document.getElementById('tableStatus'),
      banner: document.getElementById('roundResult')
    };
    if (root.felt) paintGrain(root.felt);
    buildShoe(root.shoe);
    buildRack(root.rack);
    return root;
  }

  /* ======================================================================
     Animation helpers
     ====================================================================== */
  function anim(el, frames, opts) {
    if (!el || !el.animate) { if (opts && opts.remove && el && el.parentNode) el.parentNode.removeChild(el); return null; }
    const a = el.animate(frames, opts);
    if (opts && opts.remove) {
      const rm = () => { if (el.parentNode) el.parentNode.removeChild(el); };
      a.onfinish = rm; a.oncancel = rm;
    }
    return a;
  }
  function centreOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }
  function shoeMouth() {
    if (!root.shoe) return null;
    const r = root.shoe.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width * 0.34, y: r.top + r.height * 0.42 };
  }
  function rackPoint() {
    if (!root.rack) return null;
    const r = root.rack.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function fxPoint(p) {
    const r = root.felt.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top };
  }

  /* particles (fx layer, felt coordinates) */
  function particle(cls, p, color) {
    const e = span('bj-pt ' + cls);
    e.style.left = p.x.toFixed(1) + 'px';
    e.style.top = p.y.toFixed(1) + 'px';
    if (color) e.style.background = color;
    e.style.opacity = '0';
    root.fx.appendChild(e);
    return e;
  }
  function burst(at, kind, delay) {
    if (reduced || !root.fx || !at) return;
    const p = fxPoint(at);
    const set = kind === 'bj'
      ? { n: 22, cls: 'bj-pt-star', colors: [LEMON, '#fff3c4', IVORY, accent], dist: [40, 90], dur: 820 }
      : kind === 'bust'
        ? { n: 12, cls: 'bj-pt-puff', colors: [CORAL, '#ff9f86', '#ffd0c4'], dist: [18, 44], dur: 560 }
        : kind === 'banner'
          ? { n: 16, cls: 'bj-pt-star', colors: [LEMON, MINT, accent, IVORY], dist: [50, 120], dur: 900 }
          : { n: 12, cls: 'bj-pt-chip', colors: [LEMON, MINT, '#fff3c4', IVORY], dist: [26, 60], dur: 640 };
    for (let i = 0; i < set.n; i++) {
      const e = particle(set.cls, p, set.colors[i % set.colors.length]);
      const a = (i / set.n) * Math.PI * 2 + FX() * 0.6;
      const d = set.dist[0] + FX() * (set.dist[1] - set.dist[0]);
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d * 0.7 - (kind === 'bust' ? 0 : 10);
      const rot = (FX() - 0.5) * 360;
      anim(e, [
        { transform: 'translate(-50%, -50%) scale(.3) rotate(0deg)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + (dx * 0.75).toFixed(1) + 'px), calc(-50% + ' + (dy * 0.75).toFixed(1) + 'px)) scale(1) rotate(' + (rot * 0.6).toFixed(0) + 'deg)', opacity: 1, offset: 0.55 },
        { transform: 'translate(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + (dy + 12).toFixed(1) + 'px)) scale(.2) rotate(' + rot.toFixed(0) + 'deg)', opacity: 0 }
      ], { duration: set.dur + FX() * 200, delay: Math.max(0, delay), easing: 'cubic-bezier(.15,.7,.35,1)', fill: 'both', remove: true });
    }
  }

  /* ======================================================================
     Round model (renderer-owned copies only)
     ====================================================================== */
  const T = { FLY: 430, STAG: 170, FLIP: 440, DSTEP: 560, BET: 360, SETTLE: 560 };
  const R = {
    round: -1, phase: 'lobby',
    seats: new Map(),       // id -> seat record
    dealer: [],             // [{code, up, el}]
    nextDealAt: 0,          // when the shoe is free for the next card
    seqEnd: 0,              // when the last scheduled card lands
    dealerLast: 0,
    dealerText: ''
  };
  let bannerDirty = false, bannerNeedsAnim = false, bannerAnim = null, bannerQueued = false;

  function resetRound(newRound) {
    R.seats.forEach((st) => { if (st.li.parentNode) st.li.parentNode.removeChild(st.li); });
    R.seats.clear();
    R.dealer = [];
    if (root.dealerCards) root.dealerCards.textContent = '';
    if (root.list) root.list.textContent = '';
    if (root.fx) root.fx.textContent = '';
    R.nextDealAt = 0; R.seqEnd = 0; R.dealerLast = 0; R.dealerText = '';
    if (root.dealerTotal && root.dealerTotal.getAnimations) root.dealerTotal.getAnimations().forEach((a) => a.cancel());
    // A new round starts with a clear felt: drop the last round's plaque,
    // unless the game set a fresh one during this same update.
    if (newRound && root.banner) {
      if (bannerDirty) bannerNeedsAnim = true;
      else if (!root.banner.hidden) {
        if (bannerAnim) { bannerAnim.cancel(); bannerAnim = null; }
        root.banner.hidden = true;
        root.banner.textContent = '';
        root.banner.classList.remove('win', 'lose', 'push', 'warn', 'ok', 'bj-bj');
      }
    }
  }

  function makeSeat(s) {
    const li = document.createElement('li');
    li.className = 'player-item bj-seat';
    li.innerHTML =
      '<div class="bj-hand-wrap"><div class="cards bj-hand"></div>' +
        '<span class="bj-total" hidden></span><span class="bj-stamp" hidden></span></div>' +
      '<div class="bj-spot"><span class="bj-spot-ring"></span><span class="bj-spot-chips"></span></div>' +
      '<div class="player-head"><span class="bj-avatar" aria-hidden="true"></span>' +
        '<strong class="player-name-label"></strong><span class="player-meta"></span></div>' +
      '<div class="player-meta bj-tags"></div>';
    const q = (sel) => li.querySelector(sel);
    return {
      id: s.id, li,
      hand: q('.bj-hand'), total: q('.bj-total'), stamp: q('.bj-stamp'),
      spot: q('.bj-spot'), chips: q('.bj-spot-chips'),
      avatar: q('.bj-avatar'), name: q('.player-name-label'), meta: q('.player-head .player-meta'),
      tags: q('.bj-tags'),
      cards: [], totalKey: '', stampKey: '', tagsKey: '', metaKey: '',
      bet: 0, betEl: null, dbl: false, dblEl: null, payEl: null, outcome: '',
      lastLand: 0
    };
  }

  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

  /* -------- seat static parts (text / classes), every render -------- */
  function updateSeatChrome(st, s, phase) {
    const li = st.li;
    li.classList.toggle('active', !!s.active);
    li.classList.toggle('is-you', !!s.you);
    li.style.setProperty('--seat', SEAT_COLORS[s.idx % SEAT_COLORS.length]);
    setText(st.avatar, (String(s.name || '?').trim().charAt(0) || '?').toUpperCase());
    setText(st.name, s.label);
    // the head's right-hand text is exactly what the game wrote there before:
    // "Bet 100" / "Bet 100 ×2" while playing, the result text at results
    st.meta.classList.toggle('player-result', phase === 'results');
    setText(st.meta, s.metaText);
    // tags as pills (text stays readable as one line for screen readers)
    const tagKey = [s.blackjack ? 'bj' : '', s.bust ? 'bust' : '', s.stand ? 'stand' : '', s.doubled ? 'dbl' : ''].join('|');
    if (tagKey !== st.tagsKey) {
      st.tagsKey = tagKey;
      st.tags.textContent = '';
      const add = (cls, txt) => { const t = span('bj-tag ' + cls); t.textContent = txt; st.tags.appendChild(t); };
      if (s.blackjack) add('bj-tag-bj', 'Blackjack');
      if (s.bust) add('bj-tag-bust', 'Bust');
      if (s.stand) add('bj-tag-stand', 'Stand');
      if (s.doubled) add('bj-tag-dbl', 'Doubled');
    }
  }

  function totalLabel(s) {
    if (!s.cards.length) return '';
    return String(s.total);
  }
  function popIn(el, delay) {
    if (reduced) { anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: 'backwards' }); return; }
    anim(el, [
      { transform: 'scale(.3)', opacity: 0 },
      { transform: 'scale(1.18)', opacity: 1, offset: 0.6 },
      { transform: 'scale(1)', opacity: 1 }
    ], { duration: 360, delay: Math.max(0, delay), easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'backwards' });
  }
  function updateTotal(st, s, landAt, now) {
    const key = totalLabel(s) + '|' + (s.soft ? 's' : '') + (s.bust ? 'b' : '') + (s.blackjack ? 'j' : '');
    if (key === st.totalKey) return;
    st.totalKey = key;
    const el = st.total;
    if (!s.cards.length) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'bj-total' + (s.bust ? ' is-bust' : s.blackjack ? ' is-bj' : s.total === 21 ? ' is-21' : '');
    el.textContent = '';
    const v = span('bj-total-v'); v.textContent = String(s.total); el.appendChild(v);
    if (s.soft && !s.blackjack) { const k = span('bj-total-s'); k.textContent = 'soft'; el.appendChild(k); }
    el.setAttribute('aria-label', 'Total ' + s.total + (s.soft ? ' (soft)' : ''));
    if (el.getAnimations) el.getAnimations().forEach((a) => a.cancel());
    popIn(el, landAt - now);
  }
  function updateStamp(st, s, landAt, now) {
    const key = s.bust ? 'bust' : (s.blackjack ? 'bj' : '');
    if (key === st.stampKey) return;
    const first = !st.stampKey;
    st.stampKey = key;
    const el = st.stamp;
    if (!key) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'bj-stamp ' + (key === 'bust' ? 'is-bust' : 'is-bj');
    el.textContent = key === 'bust' ? 'Bust' : 'Blackjack';
    el.setAttribute('aria-hidden', 'true');
    if (!first) return;
    const delay = Math.max(0, landAt - now);
    if (reduced) { anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay, fill: 'backwards' }); return; }
    anim(el, [
      { transform: 'translate(-50%, -50%) rotate(-14deg) scale(2.4)', opacity: 0 },
      { transform: 'translate(-50%, -50%) rotate(-14deg) scale(.92)', opacity: 1, offset: 0.7 },
      { transform: 'translate(-50%, -50%) rotate(-14deg) scale(1)', opacity: 1 }
    ], { duration: 380, delay, easing: 'cubic-bezier(.5,0,.6,1)', fill: 'backwards' });
    if (key === 'bust') {
      anim(st.hand, [
        { transform: 'translateX(0)' }, { transform: 'translateX(-4px) rotate(-1deg)' }, { transform: 'translateX(4px) rotate(1deg)' },
        { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }
      ], { duration: 340, delay: delay + 140, easing: 'ease-out' });
      st.pendingBurst = { kind: 'bust', delay: delay + 120 };
    } else {
      st.pendingBurst = { kind: 'bj', delay: delay + 120 };
    }
  }

  /* -------- chips on the betting spot -------- */
  function chipsSlideIn(el, fromPt, delay, dur) {
    if (reduced || !fromPt) { anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: reduced ? 0 : Math.max(0, delay), fill: 'backwards' }); return; }
    const c = centreOf(el);
    const dx = fromPt.x - c.x, dy = fromPt.y - c.y;
    anim(el, [
      { transform: 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px) scale(.8)', opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { transform: 'translate(0, -10px) scale(1.04)', opacity: 1, offset: 0.8 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1 }
    ], { duration: dur || T.BET, delay: Math.max(0, delay), easing: 'cubic-bezier(.25,.8,.3,1)', fill: 'backwards' });
  }
  function chipsSweep(el, toPt, delay) {
    if (!el) return;
    if (reduced || !toPt) {
      anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, delay: reduced ? 0 : Math.max(0, delay), fill: 'forwards', remove: true });
      return;
    }
    const c = centreOf(el);
    const dx = toPt.x - c.x, dy = toPt.y - c.y;
    anim(el, [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: 'translate(0, -8px) scale(1.04)', opacity: 1, offset: 0.18 },
      { transform: 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px) scale(.6)', opacity: 0 }
    ], { duration: T.SETTLE, delay: Math.max(0, delay), easing: 'cubic-bezier(.45,0,.3,1)', fill: 'forwards', remove: true });
  }
  function belowPoint(el) {
    const c = centreOf(el);
    return { x: c.x, y: c.y + 70 };
  }

  /* ======================================================================
     Main render
     ====================================================================== */
  function renderTable(v) {
    if (!init().felt) return;
    const now = performance.now();
    root.felt.dataset.phase = v.phase;
    if (root.status) root.status.classList.toggle('is-mine', !!v.myTurn);

    if (v.phase === 'lobby') {
      if (R.round !== -1 || R.seats.size || R.dealer.length) resetRound(false);
      R.round = -1; R.phase = 'lobby';
      renderEmptyDealer();
      renderEmptySeats(v.emptyText);
      updateDealerTotal(v, now, 0);
      return;
    }

    const fresh = v.round !== R.round;
    if (fresh) { resetRound(true); R.round = v.round; }
    R.phase = v.phase;

    const shoe = shoeMouth();
    const rack = rackPoint();
    const steps = [];                       // cards to fly, in dealing order
    const newBets = [];                     // [st]
    const newDoubles = [];                  // [st, cardIdx]

    /* ---- seats: create / remove / order ---- */
    const ph = root.list.querySelector('.player-item-empty');
    if (ph) ph.remove();
    const ids = v.seats.map((s) => s.id);
    R.seats.forEach((st, id) => {
      if (ids.indexOf(id) < 0) { if (st.li.parentNode) st.li.parentNode.removeChild(st.li); R.seats.delete(id); }
    });
    v.seats.forEach((s, i) => {
      let st = R.seats.get(s.id);
      if (!st) { st = makeSeat(s); R.seats.set(s.id, st); }
      const at = root.list.children[i];
      if (at !== st.li) root.list.insertBefore(st.li, at || null);
    });
    if (!v.seats.length) renderEmptySeats(v.emptyText);

    /* ---- seat cards: diff against what is on the felt ---- */
    const seatNew = new Map();
    v.seats.forEach((s) => {
      const st = R.seats.get(s.id);
      updateSeatChrome(st, s, v.phase);
      const want = Array.isArray(s.cards) ? s.cards : [];
      let ok = want.length >= st.cards.length;
      for (let i = 0; ok && i < st.cards.length; i++) if (st.cards[i].code !== want[i]) ok = false;
      if (!ok) {
        // out of sync (should not happen inside a round): redraw without motion
        st.hand.textContent = '';
        st.cards = want.map((c, i) => {
          const el = cardEl(c, true, tiltFor(s.id, i));
          st.hand.appendChild(el);
          return { code: c, el };
        });
        st.totalKey = ''; st.stampKey = '';
      } else {
        const add = [];
        for (let i = st.cards.length; i < want.length; i++) {
          const el = cardEl(want[i], true, tiltFor(s.id, i));
          st.hand.appendChild(el);
          st.cards.push({ code: want[i], el });
          add.push({ el, idx: i, up: true, seat: st });
        }
        if (add.length) seatNew.set(s.id, add);
      }
      // chips
      if (st.bet !== s.bet) {
        st.chips.textContent = '';
        st.betEl = st.dblEl = st.payEl = null;
        st.dbl = false; st.outcome = '';
        if (s.bet > 0) { st.betEl = stackEl(s.bet, 'bj-stack-bet'); st.chips.appendChild(st.betEl); newBets.push(st); }
        st.bet = s.bet;
      }
      if (s.doubled && !st.dbl && s.bet > 0) {
        st.dbl = true;
        st.dblEl = stackEl(s.bet, 'bj-stack-dbl');
        st.chips.appendChild(st.dblEl);
        newDoubles.push([st, want.length - 1]);
      }
    });

    /* ---- dealer cards ---- */
    const dWant = Array.isArray(v.dealer) ? v.dealer : [];
    let dOk = dWant.length >= R.dealer.length;
    for (let i = 0; dOk && i < R.dealer.length; i++) if (R.dealer[i].code !== dWant[i]) dOk = false;
    const dealerNew = [], dealerFlips = [];
    if (!dOk || (!dWant.length && R.dealer.length)) {
      root.dealerCards.textContent = '';
      R.dealer = dWant.map((c, i) => {
        const up = !(v.hideHole && i > 0);
        const el = cardEl(c, up, tiltFor('dealer', i));
        root.dealerCards.appendChild(el);
        return { code: c, up, el };
      });
    } else {
      if (R.dealer.length === 0 && root.dealerCards.querySelector('.bj-slot')) root.dealerCards.textContent = '';
      for (let i = 0; i < R.dealer.length; i++) {
        const d = R.dealer[i];
        const up = !(v.hideHole && i > 0);
        if (!d.up && up) dealerFlips.push(d);
      }
      for (let i = R.dealer.length; i < dWant.length; i++) {
        const up = !(v.hideHole && i > 0);
        // a revealed hole card that arrives in the same update is dealt face down, then turned
        const dealUp = up && !(i === 1);
        const el = cardEl(dWant[i], dealUp, tiltFor('dealer', i));
        root.dealerCards.appendChild(el);
        const rec = { code: dWant[i], up: dealUp, el };
        R.dealer.push(rec);
        dealerNew.push({ el, idx: i, up: dealUp, dealer: true });
        if (up && !dealUp) dealerFlips.push(rec);
      }
    }
    if (!dWant.length) renderEmptyDealer();

    /* ---- dealing order: first two rounds round-robin, then each seat's
            extra cards, then the dealer turns the hole card and draws ---- */
    for (let k = 0; k < 2; k++) {
      v.seats.forEach((s) => {
        const add = seatNew.get(s.id);
        if (add) add.forEach((c) => { if (c.idx === k) steps.push(c); });
      });
      dealerNew.forEach((c) => { if (c.idx === k) steps.push(c); });
    }
    v.seats.forEach((s) => {
      const add = seatNew.get(s.id);
      if (add) add.forEach((c) => { if (c.idx >= 2) steps.push(c); });
    });

    /* ---- layout reads happen once, after every write above ---- */
    let clock = Math.max(now, R.nextDealAt);
    let lastLand = Math.max(now, R.seqEnd);
    if (fresh && newBets.length) {
      newBets.forEach((st) => chipsSlideIn(st.betEl, belowPoint(st.spot), clock - now));
      if (!reduced) clock += 240;
    }
    const doubleAt = new Map();
    newDoubles.forEach(([st, idx]) => doubleAt.set(st, idx));

    steps.forEach((c) => {
      const start = reduced ? now : clock;
      dealCard(c.el, shoe, start - now, c.up);
      const land = reduced ? now : start + T.FLY;
      if (c.seat) {
        c.seat.lastLand = land;
        if (doubleAt.has(c.seat) && doubleAt.get(c.seat) === c.idx) {
          chipsSlideIn(c.seat.dblEl, belowPoint(c.seat.spot), start - now - 80);
          doubleAt.delete(c.seat);
        }
      } else {
        R.dealerLast = land;
      }
      lastLand = Math.max(lastLand, land);
      if (!reduced) clock += c.dealer && c.idx >= 2 ? T.DSTEP : T.STAG;
    });
    doubleAt.forEach((idx, st) => chipsSlideIn(st.dblEl, belowPoint(st.spot), clock - now));

    // hole card: turned over after every player card has landed
    if (dealerFlips.length) {
      const start = reduced ? now : Math.max(clock, lastLand + 120);
      dealerFlips.forEach((d) => flipCard(d, start - now));
      const end = reduced ? now : start + T.FLIP;
      lastLand = Math.max(lastLand, end); R.dealerLast = end;
      if (!reduced) clock = end + 80;
    }
    // dealer's draws (after the turn)
    dealerNew.forEach((c) => {
      if (c.idx < 2) return;
      const start = reduced ? now : clock;
      dealCard(c.el, shoe, start - now, c.up);
      const land = reduced ? now : start + T.FLY;
      R.dealerLast = land;
      lastLand = Math.max(lastLand, land);
      if (!reduced) clock += T.DSTEP;
    });
    R.nextDealAt = clock;
    R.seqEnd = lastLand;

    /* ---- totals, stamps, outcomes ---- */
    v.seats.forEach((s) => {
      const st = R.seats.get(s.id);
      const land = seatNew.has(s.id) ? st.lastLand : now;
      updateTotal(st, s, land, now);
      updateStamp(st, s, land, now);
      if (st.pendingBurst) {
        const pb = st.pendingBurst; st.pendingBurst = null;
        burst(centreOf(st.hand), pb.kind, pb.delay);
      }
      if (v.phase === 'results') settleSeat(st, s, rack, now);
      else if (st.outcome) { st.outcome = ''; st.li.removeAttribute('data-outcome'); }
    });
    updateDealerTotal(v, now, R.dealerLast - now);
    if (bannerDirty) queueBanner();
  }

  function dealCard(el, from, delay, up) {
    if (reduced || !from) {
      anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: reduced ? 0 : Math.max(0, delay), fill: 'backwards' });
      return;
    }
    const c = centreOf(el);
    const dx = from.x - c.x, dy = from.y - c.y;
    const d = Math.max(0, delay);
    anim(el, [
      { transform: 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px) rotate(-32deg) scale(.7)', opacity: 0 },
      { opacity: 1, offset: 0.1 },
      { transform: 'translate(0, -6px) rotate(2deg) scale(1.04)', opacity: 1, offset: 0.82 },
      { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 }
    ], { duration: T.FLY, delay: d, easing: 'cubic-bezier(.2,.7,.25,1)', fill: 'backwards' });
    if (up) {
      anim(el.firstChild, [
        { transform: 'rotateY(180deg)' },
        { transform: 'rotateY(180deg)', offset: 0.3 },
        { transform: 'rotateY(0deg)' }
      ], { duration: T.FLY, delay: d, easing: 'ease-in-out', fill: 'backwards' });
    }
  }
  function flipCard(rec, delay) {
    const el = rec.el;
    const inner = el.firstChild;
    if (!inner.querySelector('.bj-face-front')) inner.insertBefore(faceNode(rec.code), inner.firstChild);
    el.classList.remove('is-down');
    el.setAttribute('aria-label', cardName(rec.code));
    rec.up = true;
    if (reduced) return;
    const d = Math.max(0, delay);
    anim(inner, [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }],
      { duration: T.FLIP, delay: d, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'backwards' });
    anim(el, [
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-16%) scale(1.1)', offset: 0.5 },
      { transform: 'translateY(0) scale(1)' }
    ], { duration: T.FLIP, delay: d, easing: 'ease-in-out', fill: 'backwards' });
  }

  function settleSeat(st, s, rack, now) {
    if (!s.outcome || st.outcome === s.outcome) return;
    st.outcome = s.outcome;
    const delay = Math.max(0, R.seqEnd + 200 - now);
    st.li.style.setProperty('--od', (reduced ? 0 : delay) + 'ms');
    // chips follow the outcome the game settled; the gold "natural" look
    // only when this seat really holds a two-card 21
    const natural = s.outcome === 'blackjack' && !!s.blackjack;
    st.li.dataset.outcome = s.outcome === 'blackjack' ? 'win' : s.outcome;
    st.li.classList.toggle('is-bj', natural);
    // result ribbon (the game's own result text, already in place) pops in
    // once the dealer has finished
    popIn(st.meta, delay);
    if (s.outcome === 'win' || s.outcome === 'blackjack') {
      if (s.payout > 0) {
        st.payEl = stackEl(s.payout, 'bj-stack-pay');
        st.chips.insertBefore(st.payEl, st.chips.firstChild);
        chipsSlideIn(st.payEl, rack, delay, T.SETTLE);
      }
      burst(centreOf(st.spot), natural ? 'bj' : 'win', delay + T.SETTLE - 60);
    } else if (s.outcome === 'lose') {
      chipsSweep(st.betEl, rack, delay);
      chipsSweep(st.dblEl, rack, delay + 70);
      st.betEl = st.dblEl = null;
    } else if (s.outcome === 'push' && !reduced) {
      anim(st.chips, [{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }],
        { duration: 520, delay, easing: 'ease-out' });
    }
  }

  function updateDealerTotal(v, now, delay) {
    const el = root.dealerTotal;
    if (!el) return;
    const text = String(v.dealerText || '');
    const key = text + '|' + (v.dealerState || '');
    if (key === R.dealerText) return;
    R.dealerText = key;
    el.textContent = '';
    el.className = 'dealer-total' + (v.dealerState ? ' is-' + v.dealerState : '');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    const i = text.indexOf(':');
    if (i > 0) {
      const a = span('bj-dt-k'); a.textContent = text.slice(0, i + 1) + ' ';
      const b = span('bj-dt-v'); b.textContent = text.slice(i + 1).trim();
      el.appendChild(a); el.appendChild(b);
    } else el.textContent = text;
    if (el.getAnimations) el.getAnimations().forEach((a) => a.cancel());
    popIn(el, delay);
  }

  function renderEmptyDealer() {
    if (R.dealer.length) return;
    if (root.dealerCards.querySelector('.bj-slot')) return;
    root.dealerCards.textContent = '';
    for (let i = 0; i < 2; i++) root.dealerCards.appendChild(span('bj-slot'));
  }
  function renderEmptySeats(text) {
    if (R.seats.size) return;
    let ph = root.list.querySelector('.player-item-empty');
    if (!ph) {
      root.list.textContent = '';
      ph = document.createElement('li');
      ph.className = 'player-item player-item-empty';
      const ring = span('bj-spot-ring bj-ghost-spot');
      ring.setAttribute('aria-hidden', 'true');
      ph.appendChild(ring);
      ph.appendChild(span('bj-empty-txt'));
      root.list.appendChild(ph);
    }
    setText(ph.querySelector('.bj-empty-txt'), text || '');
  }

  /* ======================================================================
     Round-result plaque (#roundResult). game.js decides the text and kind;
     this only lays it out and times its entrance after the dealer is done.
     ====================================================================== */
  function banner(el, text, kind) {
    if (!el) return;
    init();
    const wasHidden = el.hidden || !el.textContent;
    el.classList.remove('win', 'lose', 'push', 'warn', 'ok', 'bj-bj');
    if (kind) el.classList.add(kind);
    el.textContent = '';
    if (!text) {
      el.hidden = true;
      if (bannerAnim) { bannerAnim.cancel(); bannerAnim = null; }
      bannerNeedsAnim = false;
      return;
    }
    const s = String(text);
    const cut = s.indexOf(' — ');
    const title = cut >= 0 ? s.slice(0, cut) : s;
    const amt = cut >= 0 ? s.slice(cut + 3) : '';
    // gold star only for the game's natural-blackjack result ("Blackjack! (3:2)")
    const isBJ = kind === 'win' && /^blackjack/i.test(title);
    if (isBJ) el.classList.add('bj-bj');
    const icName = isBJ ? 'bj' : (kind === 'win' ? 'win' : kind === 'lose' ? 'lose' : kind === 'push' ? 'push' : kind === 'ok' ? 'ok' : 'warn');
    const ic = span('bj-res-ic'); ic.innerHTML = iconSvg(icName);
    const tx = span('bj-res-tx');
    const t1 = span('bj-res-title'); t1.textContent = title;
    tx.appendChild(t1);
    if (amt) {
      const sep = span('bj-res-sep'); sep.textContent = ' — ';
      const t2 = span('bj-res-amt'); t2.textContent = amt;
      tx.appendChild(sep); tx.appendChild(t2);
    }
    el.appendChild(ic); el.appendChild(tx);
    el.hidden = false;
    el.dataset.kind = icName;
    if (wasHidden) bannerNeedsAnim = true;
    bannerDirty = true;
    queueBanner();
  }
  function queueBanner() {
    if (bannerQueued) return;
    bannerQueued = true;
    // runs after the rest of this update (renderTable sets the dealer timeline)
    Promise.resolve().then(playBanner);
  }
  function playBanner() {
    bannerQueued = false;
    bannerDirty = false;
    const el = root && root.banner;
    if (!el || el.hidden || !bannerNeedsAnim) { bannerNeedsAnim = false; return; }
    bannerNeedsAnim = false;
    if (bannerAnim) bannerAnim.cancel();
    const now = performance.now();
    const delay = reduced ? 0 : Math.max(0, R.seqEnd + 320 - now);
    if (reduced) {
      bannerAnim = anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: 'backwards' });
      return;
    }
    bannerAnim = anim(el, [
      { transform: 'scale(.4)', opacity: 0 },
      { transform: 'scale(1.08)', opacity: 1, offset: 0.62 },
      { transform: 'scale(1)', opacity: 1 }
    ], { duration: 460, delay, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'backwards' });
    if (el.classList.contains('bj-bj') || el.classList.contains('win')) {
      const c = centreOf(el);
      burst(c, el.classList.contains('bj-bj') ? 'banner' : 'win', delay + 200);
    }
  }

  /* ======================================================================
     Rail: bet preview
     ====================================================================== */
  function betPreview(el, amount) {
    if (!el) return;
    ensureDefs();
    const a = Math.max(0, Math.round(Number(amount) || 0));
    if (el.dataset.amount === String(a)) return;
    el.dataset.amount = String(a);
    el.textContent = '';
    if (a > 0) el.appendChild(stackEl(a, 'bj-stack-preview'));
  }

  window.BJArt = {
    renderTable, banner, betPreview,
    isReduced: () => reduced
  };
})();
