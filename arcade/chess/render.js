/* ==========================================================================
   Cartofia Chess — board art  (window.ChessArt)
   Pure presentation. game.js still owns the position, the rules, the bot,
   the online wire protocol and result reporting; it calls in here only to
   draw. Nothing in this file reads or writes game state except the board
   snapshot it is handed, and it never touches Math.random (visual
   randomness uses its own seeded PRNG).

   The cover (assets/games/chess.svg) come to life:
     - an original lathe-turned piece set drawn as inline SVG symbols:
       warm ivory pieces with an ink outline, obsidian-violet pieces with a
       lilac rim (the cover's knight and king), cylinder shading, gloss and
       a soft contact shadow; readable from ~20px up
     - a pearl-marble / amethyst-velvet board painted once into a canvas
       (devicePixelRatio aware, repainted only on resize), in a lacquered
       frame with a gold inlay and in-square coordinates
     - last-move, selection, legal-move (dot) and capture (filled corners)
       markers, a pulsing check halo with a ring; shape cues, not only colour
     - moves glide from square to square (FLIP on the final DOM: the board
       is always rendered from the final position first, then the moved
       piece is animated in from where it came from), castling moves both
       pieces, captures shatter the taken piece on the destination square,
       promotions sparkle, checkmate topples the king and throws confetti
   prefers-reduced-motion: no gliding, shards, shake or confetti; the
   captured piece just fades and banners fade in.

   API (used by game.js):
     ChessArt.piece(p)                 -> element for a board square
     ChessArt.observe(board, logLen)   -> change descriptor, call once per board render
     ChessArt.lastMove()               -> {fr, fc, tr, tc} | null
     ChessArt.afterRender(boardEl, change, info)   info: {flip, sameDevice, turn, check, over, result, you}
     ChessArt.renderTray(el, pieces, advantage)
     ChessArt.renderLog(el, lines)
     ChessArt.label(p)                 -> "white knight"
   ========================================================================== */
(function () {
  'use strict';
  if (window.ChessArt) return;

  const NS = 'http://www.w3.org/2000/svg';
  const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const ORDER = { q: 0, r: 1, b: 2, n: 3, p: 4, k: 5 };
  const LEMON = '#ffcf5c', CORAL = '#ff6b4a', MINT = '#3ee6a6', PEARL = '#f3ecff';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const colorOf = (p) => (p ? (p === p.toUpperCase() ? 'w' : 'b') : '');
  const typeOf = (p) => (p ? p.toLowerCase() : '');
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
  const FX = prng(0x0c4e55);   // visual-only randomness for effects

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
     Piece set — original art. 100 x 100 units, base sits on y = 92.
     Every piece is: contact shadow, outline (the silhouette stroked wide),
     then the turned parts with cylinder / sphere gradients, inner seams,
     a carved detail or two and specular highlights.
     ====================================================================== */
  const rr = (x, y, w, h, r) => 'M' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + r) +
    'V' + (y + h - r) + 'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w - r) + ' ' + (y + h) + 'H' + (x + r) + 'Q' + x + ' ' + (y + h) + ' ' + x + ' ' + (y + h - r) +
    'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'Z';
  const ell = (cx, cy, rx, ry) => 'M' + (cx - rx) + ' ' + cy + 'a' + rx + ' ' + ry + ' 0 1 0 ' + (2 * rx) + ' 0a' + rx + ' ' + ry + ' 0 1 0 ' + (-2 * rx) + ' 0Z';
  const base = (hw) => [
    { d: rr(50 - hw, 83, hw * 2, 9, 4.5), f: 'base' },
    { d: rr(50 - hw + 5, 77.5, hw * 2 - 10, 6.5, 3), f: 'body' }
  ];
  const BODY_TALL = 'M34 78C35.5 66 40 56.5 41.5 47H58.5C60 56.5 64.5 66 66 78Z';

  const GEO = {
    p: {
      parts: base(23).concat([
        { d: 'M36 78C37.5 69 42 62.5 44 57.5H56C58 62.5 62.5 69 64 78Z', f: 'body' },
        { d: ell(50, 57, 12.5, 4), f: 'body' },
        { d: ell(50, 41, 13, 13), f: 'head' }
      ]),
      hi: ['M42.6 63.5C41.2 68 39.8 72.5 39.4 76.5'],
      gloss: [[45, 35.5, 4.6, 3]]
    },
    r: {
      parts: base(27).concat([
        { d: 'M33 78C34 66 35 55.5 36 46.5H64C65 55.5 66 66 67 78Z', f: 'body' },
        { d: 'M31.5 41V23.5Q31.5 21 34 21H38.5Q41 21 41 23.5V28.5H45.5V23.5Q45.5 21 48 21H52Q54.5 21 54.5 23.5V28.5H59V23.5Q59 21 61.5 21H66Q68.5 21 68.5 23.5V41Z', f: 'body' },
        { d: rr(29.5, 39.5, 41, 8, 3), f: 'body' }
      ]),
      carve: ['M45.5 70V62.5a4.5 4.5 0 0 1 9 0V70Z'],
      seams: ['M33.5 32.5H66.5'],
      hi: ['M39.5 50C39 58 38.3 67 37.6 75.5', 'M35.5 25V36.5'],
      gloss: []
    },
    n: {
      parts: base(25).concat([
        { d: 'M33.5 78C34 69.5 37.5 63.5 43.5 59C39.5 58 34 58.5 28.5 58C23 57.4 17.5 54 17.5 48C17.5 44.5 19 41.8 22 39L36 25.2L37.8 13.6C38.2 11.6 40.6 11 41.8 12.6L48 20C60.5 21.5 70.5 32.5 71.5 49.5C72.3 61.5 70 70.5 67.5 78Z', f: 'body' }
      ]),
      mane: 'M48 20C60.5 21.5 70.5 32.5 71.5 49.5C72.3 61.5 70 70.5 67.5 78H62.5C64.2 71 65 64 64.6 58.5L60.6 55.8L64 51.8C63.4 47.4 62.4 44 60.8 41L56.4 39.6L58.6 35.4C56.6 31.8 53.8 28.8 50.4 26.4L46 26Z',
      seams: ['M43.5 59C40.6 53.5 40.8 47.5 44.6 42.6', 'M21.8 46.8Q24.2 44.8 26.6 46.6', 'M18.6 52.4Q22.4 54 26.4 53'],
      eye: [37.6, 33.6],
      hi: ['M27 41.5L37.5 31', 'M38.5 66C37.2 70 36.4 73.6 36.2 76.5'],
      gloss: []
    },
    b: {
      parts: base(24).concat([
        { d: 'M36 78C37.5 67 42 59 43.5 51.5H56.5C58 59 62.5 67 64 78Z', f: 'body' },
        { d: ell(50, 51, 13.5, 4), f: 'body' },
        { d: 'M50 15.5C59.5 22 64.5 31.5 62.5 38.5C61 44.5 56 47.5 50 47.5C44 47.5 39 44.5 37.5 38.5C35.5 31.5 40.5 22 50 15.5Z', f: 'head' },
        { d: ell(50, 12, 4.4, 4.4), f: 'head' }
      ]),
      slit: 'M56 25.5L47 36',
      hi: ['M42.8 57.5C41.4 63.5 39.8 69.5 39.2 76'],
      gloss: [[44.5, 27, 3.6, 2.4], [48.6, 10.6, 1.5, 1.1]]
    },
    q: {
      parts: base(28).concat([
        { d: BODY_TALL, f: 'body' },
        { d: 'M35 45L27.5 26L36.8 33.4L39.8 19L45.2 31.4L50 15.5L54.8 31.4L60.2 19L63.2 33.4L72.5 26L65 45Z', f: 'body' },
        { d: ell(27.5, 25, 3.8, 3.8), f: 'head' },
        { d: ell(39.8, 18, 3.8, 3.8), f: 'head' },
        { d: ell(50, 13.6, 4.4, 4.4), f: 'head' },
        { d: ell(60.2, 18, 3.8, 3.8), f: 'head' },
        { d: ell(72.5, 25, 3.8, 3.8), f: 'head' },
        { d: ell(50, 46.5, 15.5, 4.3), f: 'body' }
      ]),
      jewels: [[42.5, 39.5], [50, 38.6], [57.5, 39.5]],
      hi: ['M42.6 52C41.6 60 39.4 68.5 38.4 76'],
      gloss: [[48.6, 12.4, 1.6, 1.1], [26.4, 23.8, 1.3, 1], [38.7, 16.8, 1.3, 1]]
    },
    k: {
      parts: base(28).concat([
        { d: BODY_TALL, f: 'body' },
        { d: 'M46.75 8.5Q46.75 6.5 48.75 6.5H51.25Q53.25 6.5 53.25 8.5V12.2H57.4Q59.4 12.2 59.4 14.2V16.6Q59.4 18.6 57.4 18.6H53.25V28H46.75V18.6H42.6Q40.6 18.6 40.6 16.6V14.2Q40.6 12.2 42.6 12.2H46.75Z', f: 'head' },
        { d: 'M35.5 45C31 37 32.5 27 40.5 26C44.5 25.5 47.5 28 50 31.5C52.5 28 55.5 25.5 59.5 26C67.5 27 69 37 64.5 45Z', f: 'head' },
        { d: ell(50, 46.5, 15.5, 4.3), f: 'body' }
      ]),
      seams: ['M50 31.5V44'],
      hi: ['M42.6 52C41.6 60 39.4 68.5 38.4 76', 'M37 39C36 35 37.4 31 40.6 30'],
      gloss: [[48.8, 9.6, 1.2, 1.6]]
    }
  };

  const PAL = {
    w: {
      outline: '#1b1230', ow: 8, rim: null,
      seam: 'rgba(27,18,48,.5)', carve: '#8f7650', carveEdge: 'rgba(27,18,48,.7)',
      hi: '#ffffff', hiOp: 0.75, gloss: '#ffffff', glossOp: 0.9,
      mane: ['#cbb38a', '#9b8159'], eye: '#1b1230', eyeHi: '#ffffff', jewel: '#ff6b4a'
    },
    b: {
      outline: '#0b0716', ow: 10, rim: '#cdbcff', rw: 6.2,
      seam: 'rgba(205,188,255,.42)', carve: '#120c22', carveEdge: 'rgba(205,188,255,.55)',
      hi: '#d7caff', hiOp: 0.5, gloss: '#efe8ff', glossOp: 0.7,
      mane: ['#7a62c6', '#3f2f78'], eye: '#e7dbff', eyeHi: '#ffffff', jewel: '#ffcf5c'
    }
  };

  function stops(list) {
    return list.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('');
  }
  function gradients() {
    let s = '';
    s += '<linearGradient id="cbw-body" x1="0" y1="0" x2="1" y2="0">' + stops([[0, '#ad946c'], [0.15, '#e6d7b9'], [0.34, '#fffaf0'], [0.55, '#f6ecd8'], [0.82, '#d6c29d'], [1, '#a2895f']]) + '</linearGradient>';
    s += '<linearGradient id="cbw-base" x1="0" y1="0" x2="1" y2="0">' + stops([[0, '#9c8259'], [0.2, '#dccaa6'], [0.4, '#f6ecd6'], [0.75, '#cdb68e'], [1, '#937a52']]) + '</linearGradient>';
    s += '<radialGradient id="cbw-head" cx=".36" cy=".3" r=".8">' + stops([[0, '#ffffff'], [0.32, '#fff8ea'], [0.72, '#e6d6b5'], [1, '#ad946b']]) + '</radialGradient>';
    s += '<linearGradient id="cbb-body" x1="0" y1="0" x2="1" y2="0">' + stops([[0, '#0b0716'], [0.16, '#2a2050'], [0.35, '#4a3b80'], [0.56, '#30255a'], [0.84, '#181030'], [1, '#09060f']]) + '</linearGradient>';
    s += '<linearGradient id="cbb-base" x1="0" y1="0" x2="1" y2="0">' + stops([[0, '#08050f'], [0.22, '#2b2150'], [0.42, '#3f3170'], [0.78, '#160f2c'], [1, '#07050d']]) + '</linearGradient>';
    s += '<radialGradient id="cbb-head" cx=".36" cy=".3" r=".8">' + stops([[0, '#a593e0'], [0.28, '#5d4a9b'], [0.68, '#2a1f4f'], [1, '#100a20']]) + '</radialGradient>';
    s += '<radialGradient id="cb-shadow" cx=".5" cy=".5" r=".5">' + stops([[0, '#05020c', 0.5], [0.6, '#05020c', 0.22], [1, '#05020c', 0]]) + '</radialGradient>';
    s += '<linearGradient id="cbw-mane" x1="0" y1="0" x2="1" y2="1">' + stops([[0, PAL.w.mane[0]], [1, PAL.w.mane[1]]]) + '</linearGradient>';
    s += '<linearGradient id="cbb-mane" x1="0" y1="0" x2="1" y2="1">' + stops([[0, PAL.b.mane[0]], [1, PAL.b.mane[1]]]) + '</linearGradient>';
    return s;
  }

  function symbol(col, t) {
    const g = GEO[t], P = PAL[col];
    const fill = (f) => 'url(#cb' + col + '-' + f + ')';
    const sil = g.parts.map((p) => '<path d="' + p.d + '"/>').join('');
    let s = '<symbol id="cb-' + col + t + '" viewBox="0 0 100 100">';
    s += '<ellipse cx="50" cy="92.5" rx="33" ry="6" fill="url(#cb-shadow)"/>';
    s += '<g fill="' + P.outline + '" stroke="' + P.outline + '" stroke-width="' + P.ow + '" stroke-linejoin="round">' + sil + '</g>';
    if (P.rim) s += '<g fill="' + P.rim + '" stroke="' + P.rim + '" stroke-width="' + P.rw + '" stroke-linejoin="round">' + sil + '</g>';
    g.parts.forEach((p) => {
      s += '<path d="' + p.d + '" fill="' + fill(p.f) + '" stroke="' + P.seam + '" stroke-width="1.3" stroke-linejoin="round"/>';
    });
    if (g.mane) {
      s += '<path d="' + g.mane + '" fill="url(#cb' + col + '-mane)" stroke="' + P.seam + '" stroke-width="1.2" stroke-linejoin="round"/>';
      s += '<path d="M53 31.5C57 35 59.5 39 60.6 41M58.6 47.5C60.2 50 61 52.5 61.4 54M61 62C61.4 65 61.2 69 60.6 72" fill="none" stroke="' + P.hi + '" stroke-opacity="' + (P.hiOp * 0.7) + '" stroke-width="1.6" stroke-linecap="round"/>';
    }
    (g.carve || []).forEach((d) => {
      s += '<path d="' + d + '" fill="' + P.carve + '" stroke="' + P.carveEdge + '" stroke-width="1.2"/>';
    });
    (g.seams || []).forEach((d) => {
      s += '<path d="' + d + '" fill="none" stroke="' + P.seam + '" stroke-width="1.6" stroke-linecap="round"/>';
    });
    if (g.slit) {
      s += '<path d="' + g.slit + '" stroke="' + P.outline + '" stroke-width="3.6" stroke-linecap="round" fill="none"/>';
      s += '<path d="' + g.slit + '" stroke="' + P.carve + '" stroke-width="1.6" stroke-linecap="round" fill="none" transform="translate(.6 .5)"/>';
    }
    (g.jewels || []).forEach((j) => {
      s += '<circle cx="' + j[0] + '" cy="' + j[1] + '" r="2.1" fill="' + P.jewel + '" stroke="' + P.outline + '" stroke-width=".9"/>';
    });
    if (g.eye) {
      s += '<ellipse cx="' + g.eye[0] + '" cy="' + g.eye[1] + '" rx="3" ry="3.5" transform="rotate(-24 ' + g.eye[0] + ' ' + g.eye[1] + ')" fill="' + P.eye + '"/>';
      s += '<circle cx="' + (g.eye[0] - 0.9) + '" cy="' + (g.eye[1] - 1.1) + '" r="1" fill="' + P.eyeHi + '"/>';
    }
    (g.hi || []).forEach((d) => {
      s += '<path d="' + d + '" fill="none" stroke="' + P.hi + '" stroke-opacity="' + P.hiOp + '" stroke-width="2.6" stroke-linecap="round"/>';
    });
    (g.gloss || []).forEach((e) => {
      s += '<ellipse cx="' + e[0] + '" cy="' + e[1] + '" rx="' + e[2] + '" ry="' + e[3] + '" transform="rotate(-30 ' + e[0] + ' ' + e[1] + ')" fill="' + P.gloss + '" opacity="' + P.glossOp + '"/>';
    });
    // plinth rim light
    s += '<path d="M' + (50 - (t === 'q' || t === 'k' ? 24 : t === 'r' ? 23 : 20) ) + ' 85.6H' + (50 + (t === 'q' || t === 'k' ? 16 : t === 'r' ? 15 : 13)) + '" stroke="' + P.hi + '" stroke-opacity="' + (P.hiOp * 0.6) + '" stroke-width="1.6" stroke-linecap="round"/>';
    s += '</symbol>';
    return s;
  }

  function ensureDefs() {
    if (document.getElementById('cb-defs')) return;
    let s = '<defs>' + gradients() + '</defs>';
    ['w', 'b'].forEach((c) => { ['p', 'n', 'b', 'r', 'q', 'k'].forEach((t) => { s += symbol(c, t); }); });
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('id', 'cb-defs');
    svg.setAttribute('class', 'cb-defs');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = s;
    (document.body || document.documentElement).appendChild(svg);
  }

  function useSvg(p, cls) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#cb-' + colorOf(p) + typeOf(p));
    svg.appendChild(u);
    return svg;
  }
  function label(p) { return (colorOf(p) === 'w' ? 'white ' : 'black ') + NAMES[typeOf(p)]; }

  function piece(p) {
    ensureDefs();
    const o = document.createElement('span');
    o.className = 'cb-pc cb-' + colorOf(p) + ' cb-t-' + typeOf(p);
    const i = document.createElement('span');
    i.className = 'cb-pc-in';
    i.appendChild(useSvg(p, 'cb-svg'));
    o.appendChild(i);
    return o;
  }
  function mini(p, cls) {
    ensureDefs();
    const s = useSvg(p, 'cb-mini' + (cls ? ' ' + cls : ''));
    return s;
  }

  /* ======================================================================
     Board surface: pearl marble + amethyst velvet, painted once per size.
     ====================================================================== */
  let surface = null, surfaceN = 0, wrapEl = null, ro = null, sqPx = 48;
  function paintSurface(boardEl) {
    if (!surface) return;
    const css = boardEl.clientWidth;
    if (!css) return;
    sqPx = css / 8;
    if (wrapEl) wrapEl.style.setProperty('--sq', sqPx.toFixed(2) + 'px');
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const N = Math.round(css * dpr);
    if (Math.abs(N - surfaceN) < 2) return;
    surfaceN = N;
    surface.width = N; surface.height = N;
    const g = surface.getContext('2d');
    if (!g) return;
    const s = N / 8;
    const R = prng(0x9a6cf0);

    // 1. squares
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const x = c * s, y = r * s, light = (r + c) % 2 === 0;
        const gr = g.createLinearGradient(x, y, x + s, y + s);
        if (light) { gr.addColorStop(0, '#ece4fd'); gr.addColorStop(1, '#d3c4f3'); }
        else { gr.addColorStop(0, '#7253c6'); gr.addColorStop(1, '#5438a1'); }
        g.fillStyle = gr;
        g.fillRect(Math.floor(x), Math.floor(y), Math.ceil(s) + 1, Math.ceil(s) + 1);
      }
    }
    const clipTo = (light) => {
      g.beginPath();
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (((r + c) % 2 === 0) === light) g.rect(c * s, r * s, s, s);
      g.clip();
    };

    // 2. marble veins on the pearl squares (continuous across the slab)
    g.save();
    clipTo(true);
    for (let i = 0; i < 11; i++) {
      let x = R() * N, y = R() * N;
      const ang = R() * Math.PI * 2;
      const pts = [[x, y]];
      let a = ang;
      for (let k = 0; k < 4; k++) {
        a += (R() - 0.5) * 1.1;
        const len = s * (1.2 + R() * 1.8);
        x += Math.cos(a) * len; y += Math.sin(a) * len;
        pts.push([x, y]);
      }
      const path = () => {
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length - 1; k++) {
          const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2;
          g.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
        }
      };
      path();
      g.strokeStyle = 'rgba(132, 104, 196, ' + (0.1 + R() * 0.12).toFixed(3) + ')';
      g.lineWidth = s * (0.012 + R() * 0.03);
      g.lineCap = 'round';
      g.stroke();
      g.save();
      g.translate(s * 0.012, s * 0.012);
      path();
      g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      g.lineWidth = s * 0.008;
      g.stroke();
      g.restore();
    }
    // soft clouding
    for (let i = 0; i < 26; i++) {
      const cx = R() * N, cy = R() * N, rad = s * (0.5 + R() * 1.2);
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const tone = R() < 0.5 ? '255, 255, 255' : '160, 132, 220';
      rg.addColorStop(0, 'rgba(' + tone + ', ' + (0.08 + R() * 0.08).toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(' + tone + ', 0)');
      g.fillStyle = rg;
      g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    g.restore();

    // 3. velvet / stone mottling on the amethyst squares
    g.save();
    clipTo(false);
    for (let i = 0; i < 34; i++) {
      const cx = R() * N, cy = R() * N, rad = s * (0.35 + R() * 0.9);
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const tone = R() < 0.45 ? '170, 140, 255' : '30, 14, 70';
      rg.addColorStop(0, 'rgba(' + tone + ', ' + (0.07 + R() * 0.08).toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(' + tone + ', 0)');
      g.fillStyle = rg;
      g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    // velvet nap: a soft sheen in each square
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 0) continue;
        const x = c * s, y = r * s;
        const rg = g.createRadialGradient(x + s * 0.3, y + s * 0.25, 0, x + s * 0.3, y + s * 0.25, s * 0.85);
        rg.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
        rg.addColorStop(1, 'rgba(255, 255, 255, 0)');
        g.fillStyle = rg;
        g.fillRect(x, y, s, s);
      }
    }
    g.restore();

    // 4. fine grain over everything
    const T = 96;
    const tile = document.createElement('canvas');
    tile.width = T; tile.height = T;
    const tg = tile.getContext('2d');
    if (tg) {
      const id = tg.createImageData(T, T);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = R() < 0.5 ? 0 : 255;
        id.data[i] = v; id.data[i + 1] = v; id.data[i + 2] = v;
        id.data[i + 3] = Math.round(R() * 22);
      }
      tg.putImageData(id, 0, 0);
      const pat = g.createPattern(tile, 'repeat');
      if (pat) { g.fillStyle = pat; g.fillRect(0, 0, N, N); }
    }

    // 5. inlaid-tile bevel
    const lw = Math.max(1, s * 0.014);
    g.lineWidth = lw;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const x = c * s, y = r * s, light = (r + c) % 2 === 0;
        g.strokeStyle = light ? 'rgba(255, 255, 255, 0.55)' : 'rgba(205, 185, 255, 0.22)';
        g.beginPath(); g.moveTo(x + lw / 2, y + s - lw); g.lineTo(x + lw / 2, y + lw / 2); g.lineTo(x + s - lw, y + lw / 2); g.stroke();
        g.strokeStyle = light ? 'rgba(80, 52, 150, 0.22)' : 'rgba(14, 6, 36, 0.32)';
        g.beginPath(); g.moveTo(x + s - lw / 2, y + lw); g.lineTo(x + s - lw / 2, y + s - lw / 2); g.lineTo(x + lw, y + s - lw / 2); g.stroke();
      }
    }

    // 6. key light from the top-left + vignette
    let rg = g.createRadialGradient(N * 0.22, N * 0.12, 0, N * 0.22, N * 0.12, N * 0.95);
    rg.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
    rg.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = rg; g.fillRect(0, 0, N, N);
    rg = g.createRadialGradient(N / 2, N / 2, N * 0.42, N / 2, N / 2, N * 0.75);
    rg.addColorStop(0, 'rgba(18, 8, 44, 0)');
    rg.addColorStop(1, 'rgba(18, 8, 44, 0.24)');
    g.fillStyle = rg; g.fillRect(0, 0, N, N);
  }

  /* ======================================================================
     Change detection: what happened between the last board and this one.
     ====================================================================== */
  let prevBoard = null, prevLog = 0, last = null;
  function observe(board, logLen) {
    const prev = prevBoard;
    prevBoard = board.map((row) => row.slice());
    const pl = prevLog;
    prevLog = logLen;
    if (!prev) { last = null; return { kind: 'reset' }; }
    const vac = [], arr = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const a = prev[r][c], b = board[r][c];
        if (a === b) continue;
        if (a) vac.push({ r, c, p: a });
        if (b) arr.push({ r, c, p: b });
      }
    }
    if (!vac.length && !arr.length) return null;
    if (!logLen) { last = null; return { kind: 'reset' }; }
    if (logLen !== pl + 1 || arr.length < 1 || arr.length > 2 || vac.length > 3) { last = null; return { kind: 'sync' }; }
    const used = new Set();
    const moves = [];
    for (const a of arr) {
      let m = vac.find((v) => !used.has(v) && v.p === a.p && !(v.r === a.r && v.c === a.c));
      let promo = false;
      if (!m) {
        m = vac.find((v) => !used.has(v) && typeOf(v.p) === 'p' && colorOf(v.p) === colorOf(a.p) && !(v.r === a.r && v.c === a.c));
        promo = !!m;
      }
      if (!m) { last = null; return { kind: 'sync' }; }
      used.add(m);
      moves.push({ fr: m.r, fc: m.c, tr: a.r, tc: a.c, p: a.p, promo });
    }
    const mover = colorOf(moves[0].p);
    const left = vac.filter((v) => !used.has(v));
    let captured = null;
    for (const v of left) {
      if (colorOf(v.p) !== mover) { captured = v; break; }
    }
    if (left.length > (captured ? 1 : 0)) { last = null; return { kind: 'sync' }; }
    const main = moves.find((m) => typeOf(m.p) === 'k') && moves.length === 2 ? moves.find((m) => typeOf(m.p) === 'k') : moves[0];
    last = { fr: main.fr, fc: main.fc, tr: main.tr, tc: main.tc };
    return { kind: 'move', moves, main, captured, castle: moves.length === 2, promo: moves.some((m) => m.promo) };
  }

  /* ======================================================================
     Effects
     ====================================================================== */
  let fxUnder = null, fxOver = null, resultEl = null, orbEl = null, chipEl = null, statusBar = null;
  let overShown = false, resultTimer = 0, gameKey = 0;

  function vrc(r, c, flip) { return flip ? [7 - r, 7 - c] : [r, c]; }
  function span(cls) { const e = document.createElement('span'); e.className = cls; return e; }
  function place(el, vr, vc) { el.style.left = (vc * 12.5) + '%'; el.style.top = (vr * 12.5) + '%'; }
  function placeCenter(el, vr, vc) { el.style.left = ((vc + 0.5) * 12.5) + '%'; el.style.top = ((vr + 0.5) * 12.5) + '%'; }
  function anim(el, frames, opts) {
    if (!el.animate) { if (opts && opts.remove) el.remove(); return null; }
    const a = el.animate(frames, opts);
    if (opts && opts.remove) {
      const rm = () => { if (el.parentNode) el.parentNode.removeChild(el); };
      a.onfinish = rm; a.oncancel = rm;
    }
    return a;
  }

  function ring(layer, vr, vc, color, delay, size, dur) {
    const e = span('cb-ring');
    placeCenter(e, vr, vc);
    e.style.borderColor = color;
    e.style.boxShadow = '0 0 12px ' + color;
    e.style.opacity = '0';
    layer.appendChild(e);
    anim(e, [
      { transform: 'translate(-50%, -50%) scale(.35)', opacity: 0.95 },
      { transform: 'translate(-50%, -50%) scale(' + (size || 1.5) + ')', opacity: 0 }
    ], { duration: dur || 460, delay: delay || 0, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both', remove: true });
  }
  function flash(layer, vr, vc, color, delay) {
    const e = span('cb-flash');
    placeCenter(e, vr, vc);
    e.style.background = 'radial-gradient(closest-side, ' + color + ', transparent)';
    e.style.opacity = '0';
    layer.appendChild(e);
    anim(e, [
      { transform: 'translate(-50%, -50%) scale(.5)', opacity: 0.9 },
      { transform: 'translate(-50%, -50%) scale(1.5)', opacity: 0 }
    ], { duration: 360, delay: delay || 0, easing: 'ease-out', fill: 'both', remove: true });
  }
  function shards(layer, vr, vc, col, delay) {
    const n = 14;
    const colors = col === 'w' ? ['#fff8ea', '#f1e2c4', '#d7c29b', '#ffffff'] : ['#2a2050', '#4a3b80', '#cdbcff', '#160f2c'];
    for (let i = 0; i < n; i++) {
      const e = span('cb-shard');
      placeCenter(e, vr, vc);
      e.style.background = colors[i % colors.length];
      e.style.borderColor = col === 'w' ? '#1b1230' : '#cdbcff';
      e.style.opacity = '0';
      layer.appendChild(e);
      const a = (i / n) * Math.PI * 2 + FX() * 0.5;
      const d = sqPx * (0.55 + FX() * 0.45);
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d - sqPx * 0.15;
      const rot = (FX() - 0.5) * 540;
      anim(e, [
        { transform: 'translate(-50%, -50%) rotate(0deg) scale(1)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + (dx * 0.7).toFixed(1) + 'px), calc(-50% + ' + (dy * 0.7).toFixed(1) + 'px)) rotate(' + (rot * 0.7).toFixed(0) + 'deg) scale(.9)', opacity: 1, offset: 0.55 },
        { transform: 'translate(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + (dy + sqPx * 0.35).toFixed(1) + 'px)) rotate(' + rot.toFixed(0) + 'deg) scale(.4)', opacity: 0 }
      ], { duration: 560 + FX() * 200, delay: delay || 0, easing: 'cubic-bezier(.15,.65,.35,1)', fill: 'both', remove: true });
    }
  }
  function sparkle(layer, vr, vc, delay) {
    const colors = [LEMON, '#fff3c4', PEARL, accent];
    for (let i = 0; i < 10; i++) {
      const e = span('cb-spark');
      placeCenter(e, vr, vc);
      e.style.background = colors[i % colors.length];
      e.style.opacity = '0';
      layer.appendChild(e);
      const a = (i / 10) * Math.PI * 2 + FX() * 0.4;
      const d = sqPx * (0.5 + FX() * 0.35);
      anim(e, [
        { transform: 'translate(-50%, -50%) scale(.2) rotate(0deg)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + (Math.cos(a) * d).toFixed(1) + 'px), calc(-50% + ' + (Math.sin(a) * d).toFixed(1) + 'px)) scale(1) rotate(90deg)', opacity: 1, offset: 0.6 },
        { transform: 'translate(calc(-50% + ' + (Math.cos(a) * d * 1.15).toFixed(1) + 'px), calc(-50% + ' + (Math.sin(a) * d * 1.15).toFixed(1) + 'px)) scale(0) rotate(180deg)', opacity: 0 }
      ], { duration: 620, delay: delay || 0, easing: 'ease-out', fill: 'both', remove: true });
    }
  }
  function confetti(layer, vr, vc, delay) {
    const colors = [LEMON, CORAL, MINT, accent, PEARL];
    for (let i = 0; i < 34; i++) {
      const e = span('cb-confetti');
      placeCenter(e, vr, vc);
      e.style.background = colors[i % colors.length];
      e.style.opacity = '0';
      layer.appendChild(e);
      const vx = (FX() - 0.5) * sqPx * 6;
      const up = sqPx * (1.4 + FX() * 2.2);
      const fall = sqPx * (1.2 + FX() * 2.4);
      const rot = (FX() - 0.5) * 900;
      anim(e, [
        { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + (vx * 0.55).toFixed(1) + 'px), calc(-50% - ' + up.toFixed(1) + 'px)) rotate(' + (rot * 0.5).toFixed(0) + 'deg)', opacity: 1, offset: 0.4, easing: 'cubic-bezier(.3,.6,.6,1)' },
        { transform: 'translate(calc(-50% + ' + vx.toFixed(1) + 'px), calc(-50% + ' + (fall - up).toFixed(1) + 'px)) rotate(' + rot.toFixed(0) + 'deg)', opacity: 0 }
      ], { duration: 1300 + FX() * 600, delay: (delay || 0) + FX() * 120, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'both', remove: true });
    }
  }

  function sqEl(boardEl, r, c) { return boardEl.querySelector('.sq[data-r="' + r + '"][data-c="' + c + '"]'); }

  function slide(boardEl, m, flip, dur, delay) {
    const el = sqEl(boardEl, m.tr, m.tc);
    const pc = el && el.querySelector('.cb-pc');
    if (!pc) return;
    const a = vrc(m.fr, m.fc, flip), b = vrc(m.tr, m.tc, flip);
    const dx = (a[1] - b[1]) * 100, dy = (a[0] - b[0]) * 100;
    el.classList.add('cb-flying');
    const an = anim(pc, [
      { transform: 'translate(' + dx + '%, ' + dy + '%) scale(1)' },
      { transform: 'translate(' + (dx * 0.42) + '%, ' + (dy * 0.42) + '%) scale(1.12)', offset: 0.5 },
      { transform: 'translate(0, 0) scale(1)' }
    ], { duration: dur, delay: delay || 0, easing: 'cubic-bezier(.35,.1,.25,1)', fill: 'backwards' });
    if (an) {
      const done = () => el.classList.remove('cb-flying');
      an.onfinish = done; an.oncancel = done;
    } else el.classList.remove('cb-flying');
  }

  function ghost(vr, vc, p, rot, delay, quick) {
    if (!fxUnder) return;
    const g = span('cb-ghost');
    place(g, vr, vc);
    const i = span('cb-pc-in' + (rot ? ' cb-rot' : ''));
    i.appendChild(useSvg(p, 'cb-svg'));
    g.appendChild(i);
    fxUnder.appendChild(g);
    if (quick) {
      anim(g, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'both', remove: true });
      return;
    }
    const tilt = (FX() < 0.5 ? -1 : 1) * (10 + FX() * 10);
    anim(g, [
      { transform: 'scale(1) rotate(0deg)', opacity: 1, filter: 'brightness(1)' },
      { transform: 'scale(1.08) rotate(' + (tilt * 0.4) + 'deg)', opacity: 1, filter: 'brightness(1.6)', offset: 0.25 },
      { transform: 'scale(1.3) translateY(-6%) rotate(' + tilt + 'deg)', opacity: 0, filter: 'brightness(2)' }
    ], { duration: 300, delay: delay, easing: 'ease-out', fill: 'both', remove: true });
  }

  function dealIn(boardEl, flip) {
    const pcs = boardEl.querySelectorAll('.cb-pc');
    pcs.forEach((pc) => {
      const sq = pc.parentNode;
      const r = +sq.dataset.r, c = +sq.dataset.c;
      const v = vrc(r, c, flip);
      const fromTop = v[0] < 4;
      const order = fromTop ? v[0] : 7 - v[0];
      anim(pc, [
        { transform: 'translateY(' + (fromTop ? -40 : 40) + '%) scale(.7)', opacity: 0 },
        { transform: 'translateY(0) scale(1)', opacity: 1 }
      ], { duration: 360, delay: order * 70 + v[1] * 18, easing: 'cubic-bezier(.3,1.3,.5,1)', fill: 'backwards' });
    });
  }

  function shake() {
    if (!wrapEl || reduced) return;
    anim(wrapEl, [
      { transform: 'translate(0, 0)' }, { transform: 'translate(-2px, 1px)' }, { transform: 'translate(2px, -1px)' },
      { transform: 'translate(-1px, 0)' }, { transform: 'translate(0, 0)' }
    ], { duration: 280, easing: 'ease-out' });
  }

  function findKing(boardEl, col) {
    const list = boardEl.querySelectorAll('.cb-pc.cb-' + col + '.cb-t-k');
    return list.length ? list[0].parentNode : null;
  }

  /* ---------- result banner + status orb ---------- */
  function hideResult() {
    clearTimeout(resultTimer);
    if (resultEl) { resultEl.hidden = true; resultEl.classList.remove('cb-on'); }
  }
  function showResult(info, delay) {
    if (!resultEl) return;
    clearTimeout(resultTimer);
    const txt = String(info.result || '');
    const winner = /white wins/i.test(txt) ? 'w' : (/black wins/i.test(txt) ? 'b' : '');
    const mate = /checkmate/i.test(txt);
    const icon = resultEl.querySelector('.cb-result-icon');
    const title = resultEl.querySelector('.cb-result-title');
    const sub = resultEl.querySelector('.cb-result-sub');
    if (icon) {
      icon.textContent = '';
      if (winner) icon.appendChild(mini(winner === 'w' ? 'K' : 'k'));
      else { icon.appendChild(mini('K')); icon.appendChild(mini('k')); }
    }
    resultEl.dataset.outcome = !winner ? 'draw' : (info.you ? (info.you === winner ? 'win' : 'loss') : winner);
    if (title) title.textContent = mate ? 'Checkmate' : (/stalemate/i.test(txt) ? 'Stalemate' : (txt.replace(/\.$/, '') || 'Game over'));
    if (sub) {
      let s = '';
      if (winner) {
        const side = winner === 'w' ? 'White' : 'Black';
        if (info.you) s = info.you === winner ? 'You win as ' + side + '!' : side + ' wins this one';
        else s = side + ' wins';
      } else s = 'Draw — no legal moves';
      sub.textContent = s;
    }
    resultTimer = setTimeout(() => {
      resultEl.hidden = false;
      // next frame so the transition runs
      requestAnimationFrame(() => resultEl.classList.add('cb-on'));
    }, delay);
  }

  function initOrb() {
    if (!orbEl || orbEl.childNodes.length) return;
    const w = span('cb-orb-k cb-orb-w'); w.appendChild(mini('K'));
    const b = span('cb-orb-k cb-orb-b'); b.appendChild(mini('k'));
    orbEl.appendChild(w); orbEl.appendChild(b);
  }

  function bind(boardEl) {
    if (wrapEl) return;
    ensureDefs();
    wrapEl = boardEl.parentNode;
    surface = document.getElementById('chessSurface');
    fxUnder = document.getElementById('chessFxUnder');
    fxOver = document.getElementById('chessFx');
    resultEl = document.getElementById('chessResult');
    orbEl = document.getElementById('chessTurnOrb');
    chipEl = document.getElementById('chessCheckChip');
    statusBar = document.getElementById('chessStatusBar');
    initOrb();
    if (resultEl) {
      const x = resultEl.querySelector('[data-cb-dismiss]');
      if (x) x.addEventListener('click', hideResult);
      const again = resultEl.querySelector('[data-cb-again]');
      if (again) again.addEventListener('click', () => {
        hideResult();
        const btn = document.getElementById('newGameBtn');
        if (btn) btn.click();
      });
    }
    paintSurface(boardEl);
    if (window.ResizeObserver) {
      let raf = 0;
      ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => paintSurface(boardEl));
      });
      ro.observe(boardEl);
    } else {
      window.addEventListener('resize', () => paintSurface(boardEl));
    }
  }

  function afterRender(boardEl, change, info) {
    bind(boardEl);
    if (!surfaceN) paintSurface(boardEl);
    const flip = !!info.flip;
    const rotBlack = !!info.sameDevice;
    const mate = info.over && /checkmate/i.test(String(info.result || ''));

    // status bar
    if (statusBar) {
      statusBar.dataset.turn = info.turn;
      statusBar.classList.toggle('is-check', !!info.check && !info.over);
      statusBar.classList.toggle('is-over', !!info.over);
      const txt = String(info.result || '');
      statusBar.dataset.winner = info.over ? (/white wins/i.test(txt) ? 'w' : (/black wins/i.test(txt) ? 'b' : 'draw')) : '';
    }
    if (chipEl) chipEl.hidden = !(info.check && !info.over);

    if (!change) {
      if (info.over && !overShown) { overShown = true; showResult(info, 0); }
      return;
    }

    if (change.kind === 'reset' || change.kind === 'sync') {
      if (change.kind === 'reset') { gameKey++; overShown = false; hideResult(); }
      if (!reduced && change.kind === 'reset') dealIn(boardEl, flip);
      if (info.over && !overShown) { overShown = true; showResult(info, reduced ? 0 : 400); }
      else if (!info.over && overShown) { overShown = false; hideResult(); }
      return;
    }

    // a single move
    const m = change.main;
    const dist = Math.max(Math.abs(m.tr - m.fr), Math.abs(m.tc - m.fc));
    const D = reduced ? 0 : clamp(150 + dist * 16, 170, 240);
    const to = vrc(m.tr, m.tc, flip);
    const hit = Math.round(D * 0.72);
    const layer = fxOver || fxUnder;

    if (!reduced) {
      change.moves.forEach((mv, i) => slide(boardEl, mv, flip, D, i ? 30 : 0));
    }
    if (change.captured && layer) {
      const cv = vrc(change.captured.r, change.captured.c, flip);
      const rot = rotBlack && colorOf(change.captured.p) === 'b';
      ghost(cv[0], cv[1], change.captured.p, rot, hit, reduced);
      if (!reduced) {
        flash(layer, cv[0], cv[1], 'rgba(255, 196, 120, .95)', hit);
        ring(layer, cv[0], cv[1], CORAL, hit, 1.45);
        shards(layer, cv[0], cv[1], colorOf(change.captured.p), hit);
      }
    } else if (!reduced && layer) {
      ring(layer, to[0], to[1], 'rgba(255, 255, 255, .55)', D - 30, 1.1, 360);
      if (change.castle) {
        const rk = change.moves.find((x) => typeOf(x.p) === 'r');
        if (rk) { const rv = vrc(rk.tr, rk.tc, flip); ring(layer, rv[0], rv[1], 'rgba(62, 230, 166, .8)', D, 1.2, 420); }
      }
    }
    if (change.promo && !reduced && layer) {
      flash(layer, to[0], to[1], 'rgba(255, 216, 110, .95)', D);
      ring(layer, to[0], to[1], LEMON, D, 1.7, 560);
      sparkle(layer, to[0], to[1], D);
      const el = sqEl(boardEl, m.tr, m.tc);
      const inner = el && el.querySelector('.cb-svg');
      if (inner) anim(inner, [{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: 420, delay: D, easing: 'cubic-bezier(.3,1.5,.5,1)' });
    }

    if (info.check && layer) {
      const ksq = findKing(boardEl, info.turn);
      if (ksq) {
        const kv = vrc(+ksq.dataset.r, +ksq.dataset.c, flip);
        if (!reduced) {
          ring(layer, kv[0], kv[1], CORAL, D, 1.35, 520);
          ring(layer, kv[0], kv[1], CORAL, D + 160, 1.7, 620);
        }
      }
    }

    if (mate) {
      const loser = info.turn;
      const winner = loser === 'w' ? 'b' : 'w';
      const ksq = findKing(boardEl, loser);
      if (ksq && !reduced) {
        ksq.classList.add('cb-fall-anim');
        setTimeout(shake, D + 260);
      }
      const wk = findKing(boardEl, winner);
      if (wk && !reduced && layer) {
        const wv = vrc(+wk.dataset.r, +wk.dataset.c, flip);
        flash(layer, wv[0], wv[1], 'rgba(255, 216, 110, .9)', D + 300);
        confetti(layer, wv[0], wv[1], D + 320);
      }
    }
    if (info.over && !overShown) { overShown = true; showResult(info, reduced ? 0 : D + 900); }
    else if (!info.over && overShown) { overShown = false; hideResult(); }
  }

  /* ======================================================================
     Captured trays and the move log
     ====================================================================== */
  function renderTray(el, list, adv) {
    const prev = el._cbPrev || '';
    const now = list.join('');
    el._cbPrev = now;
    const grew = now.length > prev.length && prev.length >= 0 && el._cbSeen;
    el._cbSeen = true;
    let newType = '';
    if (grew) {
      const cnt = {};
      for (const ch of prev) cnt[ch] = (cnt[ch] || 0) + 1;
      for (const ch of now) { if (cnt[ch]) cnt[ch]--; else { newType = ch; } }
    }
    el.textContent = '';
    const sorted = list.slice().sort((a, b) => ORDER[typeOf(a)] - ORDER[typeOf(b)]);
    let group = null, gt = '';
    const names = [];
    sorted.forEach((p, i) => {
      if (p !== gt) { group = span('cb-tray-g'); el.appendChild(group); gt = p; }
      const isNewest = newType === p && (i === sorted.length - 1 || sorted[i + 1] !== p);
      group.appendChild(mini(p, isNewest && !reduced ? 'cb-pop' : ''));
      names.push(NAMES[typeOf(p)]);
    });
    if (!sorted.length) {
      const e = span('cb-tray-empty');
      e.textContent = 'Nothing yet';
      el.appendChild(e);
    }
    if (adv > 0) {
      const a = span('cb-adv');
      a.textContent = '+' + adv;
      a.title = 'Material ahead';
      el.appendChild(a);
    }
    el.setAttribute('aria-label', sorted.length ? names.join(', ') + (adv > 0 ? ', ahead by ' + adv : '') : 'none');
  }

  const NOTE = /^([KQRBN]?)([a-h][1-8])([-x])([a-h][1-8])(=Q)?$/;
  function moveCell(text, white, isLast) {
    const cell = span('cb-log-m' + (isLast ? ' is-last' : ''));
    if (!text) { cell.classList.add('is-empty'); return cell; }
    const col = white ? 'w' : 'b';
    const up = (t) => (white ? t.toUpperCase() : t.toLowerCase());
    if (text === 'O-O' || text === 'O-O-O') {
      cell.appendChild(mini(up('k'), 'cb-log-ic'));
      const t = span('cb-log-sq'); t.textContent = text; cell.appendChild(t);
      cell.title = (white ? 'White' : 'Black') + (text === 'O-O' ? ' castles kingside' : ' castles queenside');
      return cell;
    }
    const m = NOTE.exec(text);
    if (!m) { const t = span('cb-log-sq'); t.textContent = text; cell.appendChild(t); return cell; }
    const pt = (m[1] || 'P').toLowerCase();
    cell.appendChild(mini(up(pt), 'cb-log-ic'));
    const a = span('cb-log-sq'); a.textContent = m[2]; cell.appendChild(a);
    const sep = span(m[3] === 'x' ? 'cb-log-x' : 'cb-log-dash'); sep.textContent = m[3] === 'x' ? '×' : '–'; cell.appendChild(sep);
    const b = span('cb-log-sq cb-log-to'); b.textContent = m[4]; cell.appendChild(b);
    if (m[5]) {
      const pr = span('cb-log-promo');
      pr.appendChild(mini(up('q'), 'cb-log-ic'));
      cell.appendChild(pr);
    }
    cell.title = text + (col === 'w' ? ' (White)' : ' (Black)');
    return cell;
  }

  function renderLog(el, lines) {
    el.textContent = '';
    if (!lines.length) {
      const e = document.createElement('div');
      e.className = 'cb-log-empty';
      e.textContent = 'No moves yet.';
      el.appendChild(e);
      return;
    }
    const strip = (s) => String(s).replace(/^\s*\d+\.(\.\.)?\s*/, '');
    for (let i = 0; i < lines.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'cb-log-row';
      const n = span('cb-log-n');
      const mm = /^\s*(\d+)\./.exec(String(lines[i]));
      n.textContent = (mm ? mm[1] : String(i / 2 + 1)) + '.';
      row.appendChild(n);
      row.appendChild(moveCell(strip(lines[i]), true, i === lines.length - 1));
      row.appendChild(moveCell(i + 1 < lines.length ? strip(lines[i + 1]) : '', false, i + 1 === lines.length - 1));
      el.appendChild(row);
    }
    el.scrollTop = el.scrollHeight;
  }

  window.ChessArt = {
    piece, mini, observe, afterRender, renderTray, renderLog, label,
    lastMove: () => last,
    points: (t) => ({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }[t] || 0),
    isReduced: () => reduced
  };
})();
