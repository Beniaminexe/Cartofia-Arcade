/* ==========================================================================
   Cartofia Minesweeper — board art  (window.MinesArt)
   Pure presentation. The page script still owns the grid, the rules, the
   first-click safety, the timer, scoring and result reporting; it hands
   this file a read-only view of the grid after every change. Nothing here
   writes game state, and nothing here calls Math.random (decoration uses its
   own seeded PRNG), so mine placement is untouched.

   What it draws (the cover, assets/games/minesweeper.svg, come to life):
     - the board is built once per size and then patched cell by cell, so a
       cell keeps animating while its neighbours change; every cell keeps the
       classes the game used (cell, revealed, numN, flagged, question, mine,
       exploded, wrong) and its data-x / data-y
     - tiles are sized to the space they have (and to the window height on
       desktop); on a narrow phone a wide board is turned on its side
       (CSS only: the DOM order and the coordinates never change) so tiles
       stay big enough to tap
     - effects come from the diff between the last grid it drew and this one:
       the cells the game actually opened dig out in a wave from the clicked
       cell, flags pop, the mine marked `exploded` blows up and the other
       mines are uncovered in a ripple from it, wrong flags get an X, and a
       win sends the auto-placed flags out in a ripple with confetti
     - newGame() drops every pending timer, particle and animation, so
       nothing from the old board can draw over the new one
   prefers-reduced-motion: no dig wave, particles, shake or confetti; changes
   fade in, game-over states are shown at once.

   API (used by the page script):
     MinesArt.bind({ board, wrap, shell, stage, fx, face, mineCounter, timeCounter })
     MinesArt.newGame()                       before the first render of a new board
     MinesArt.render(grid, cfg, info)         info: { finished, won, hint: {x, y} | null }
     MinesArt.face(mode)                      normal | wow | dead | cool
     MinesArt.counter(el, text)               "010" / "-01"
     MinesArt.overHoldMs(isWin)               how long the result card waits
   ========================================================================== */
(function () {
  'use strict';
  if (window.MinesArt) return;

  const NS = 'http://www.w3.org/2000/svg';
  const INK = '#1b1230', CORAL = '#ff6b4a', LEMON = '#ffcf5c', MINT = '#3ee6a6', PEARL = '#f3ecff', STEEL = '#9fb4d8';
  const MAX = 44, FLOOR = 24, MIN = 18, TAP = 22, RESERVE = 358;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pf = (v) => parseFloat(v) || 0;
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
  const FX = prng(0x5eed1e);   // visual-only randomness

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
     Art: inline SVG symbols (mine, flag, X) + gradients + the face
     ====================================================================== */
  function defsMarkup() {
    let s = '<defs>';
    s += '<radialGradient id="msg-mine" cx=".36" cy=".3" r=".78"><stop offset="0" stop-color="#7a69ad"/><stop offset=".38" stop-color="#3a2e63"/><stop offset=".78" stop-color="#1d1535"/><stop offset="1" stop-color="#110b20"/></radialGradient>';
    s += '<linearGradient id="msg-flag" x1="0" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#ff9a7a"/><stop offset=".45" stop-color="#ff4d4d"/><stop offset="1" stop-color="#c7283c"/></linearGradient>';
    s += '<linearGradient id="msg-base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a3d7a"/><stop offset="1" stop-color="#201838"/></linearGradient>';
    s += '<radialGradient id="msg-face" cx=".38" cy=".3" r=".82"><stop offset="0" stop-color="#fff6cf"/><stop offset=".4" stop-color="#ffd84a"/><stop offset=".85" stop-color="#f0a230"/><stop offset="1" stop-color="#d98a20"/></radialGradient>';
    s += '<radialGradient id="msg-face-dead" cx=".38" cy=".3" r=".82"><stop offset="0" stop-color="#ffe6d6"/><stop offset=".45" stop-color="#ffb08c"/><stop offset="1" stop-color="#e0674a"/></radialGradient>';
    s += '<linearGradient id="msg-lens" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b46c9"/><stop offset=".55" stop-color="#1b1230"/><stop offset="1" stop-color="#0b0716"/></linearGradient>';
    s += '</defs>';
    // mine: ink spikes, a glossy violet-ink body, a warm highlight (the cover's mine)
    let spikes = '', tips = '';
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const c = Math.cos(a), si = Math.sin(a);
      const x1 = (50 + c * 22).toFixed(1), y1 = (50 + si * 22).toFixed(1);
      const x2 = (50 + c * 43).toFixed(1), y2 = (50 + si * 43).toFixed(1);
      spikes += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
      tips += '<circle cx="' + x2 + '" cy="' + y2 + '" r="4.6"/>';
    }
    s += '<symbol id="ms-mine" viewBox="0 0 100 100">' +
      '<g stroke="' + INK + '" stroke-width="10" stroke-linecap="round">' + spikes + '</g>' +
      '<g fill="#5d4d8f" stroke="' + INK + '" stroke-width="3">' + tips + '</g>' +
      '<g stroke="#6f5fa6" stroke-width="3" stroke-linecap="round" opacity=".9">' + spikes + '</g>' +
      '<circle cx="50" cy="50" r="27" fill="url(#msg-mine)" stroke="' + INK + '" stroke-width="5"/>' +
      '<path d="M33 58a19 19 0 0 0 30 7" fill="none" stroke="#0c0818" stroke-width="3" stroke-linecap="round" opacity=".55"/>' +
      '<ellipse cx="41" cy="40" rx="8.5" ry="6" transform="rotate(-38 41 40)" fill="#fff6e5" opacity=".92"/>' +
      '<circle cx="54.5" cy="34.5" r="2.6" fill="#ffffff" opacity=".7"/>' +
      '</symbol>';
    // flag: ink pole with a lemon knob, coral-red pennant, dark plinth
    s += '<symbol id="ms-flag" viewBox="0 0 100 100">' +
      '<ellipse cx="48" cy="88" rx="26" ry="5" fill="#0a0618" opacity=".35"/>' +
      '<rect x="27" y="75" width="42" height="12" rx="4.5" fill="url(#msg-base)" stroke="' + INK + '" stroke-width="4.5"/>' +
      '<path d="M32 79.5H62" stroke="#8b7cc4" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>' +
      '<path d="M44 78V15" stroke="' + INK + '" stroke-width="9" stroke-linecap="round"/>' +
      '<path d="M44 76V18" stroke="#d9d3f0" stroke-width="2.6" stroke-linecap="round" opacity=".75"/>' +
      '<path d="M46.5 15C59.5 18 71 23 83 30.5C71 37 59 42.5 46.5 46.5Z" fill="url(#msg-flag)" stroke="' + INK + '" stroke-width="5.5" stroke-linejoin="round"/>' +
      '<path d="M51 21.5C59 23.5 66 26.5 72 29.5" fill="none" stroke="#ffd6c9" stroke-width="3.2" stroke-linecap="round" opacity=".85"/>' +
      '<circle cx="44" cy="12" r="6" fill="' + LEMON + '" stroke="' + INK + '" stroke-width="3.5"/>' +
      '</symbol>';
    // X for a wrong flag: coral bars with an ink outline (shape, not just colour)
    s += '<symbol id="ms-x" viewBox="0 0 100 100">' +
      '<path d="M20 20L80 80M80 20L20 80" stroke="' + INK + '" stroke-width="22" stroke-linecap="round"/>' +
      '<path d="M20 20L80 80M80 20L20 80" stroke="#ff5a4e" stroke-width="12" stroke-linecap="round"/>' +
      '<path d="M24 22L44 42M76 22L66 32" stroke="#ffc2b8" stroke-width="3.5" stroke-linecap="round" opacity=".8"/>' +
      '</symbol>';
    return s;
  }
  function ensureDefs() {
    if (document.getElementById('ms-defs')) return;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('id', 'ms-defs');
    svg.setAttribute('class', 'ms-defs');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = defsMarkup();
    (document.body || document.documentElement).appendChild(svg);
  }
  function icon(id, cls) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ms-ico ' + cls);
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#' + id);
    svg.appendChild(u);
    return svg;
  }

  function faceMarkup() {
    const eye = (x) => '<ellipse cx="' + x + '" cy="43" rx="4.8" ry="6.8" fill="' + INK + '"/><circle cx="' + (x - 1.4) + '" cy="40.4" r="1.8" fill="#fff"/>';
    let s = '<ellipse cx="50" cy="93" rx="30" ry="5" fill="#05030c" opacity=".45"/>';
    s += '<circle class="f-head" cx="50" cy="50" r="40" fill="url(#msg-face)" stroke="' + INK + '" stroke-width="5"/>';
    s += '<ellipse cx="35" cy="29" rx="12" ry="7" transform="rotate(-32 35 29)" fill="#fff" opacity=".62"/>';
    s += '<circle cx="26" cy="60" r="6.5" fill="#ff7a5c" opacity=".38"/><circle cx="74" cy="60" r="6.5" fill="#ff7a5c" opacity=".38"/>';
    // normal: a smile
    s += '<g class="fx fx-normal">' + eye(37) + eye(63) +
      '<path d="M33 58Q50 78 67 58Q50 66 33 58Z" fill="#7a2433" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"/>' +
      '<path d="M43 66.5Q50 70 57 66.5" fill="none" stroke="#ff8a8a" stroke-width="2.6" stroke-linecap="round"/></g>';
    // wow: round eyes, brows up, an O
    s += '<g class="fx fx-wow">' +
      '<circle cx="37" cy="43" r="6.6" fill="' + INK + '"/><circle cx="35" cy="40.6" r="2.2" fill="#fff"/>' +
      '<circle cx="63" cy="43" r="6.6" fill="' + INK + '"/><circle cx="61" cy="40.6" r="2.2" fill="#fff"/>' +
      '<path d="M29 31Q36 26 43 30M57 30Q64 26 71 31" fill="none" stroke="' + INK + '" stroke-width="3.6" stroke-linecap="round"/>' +
      '<ellipse cx="50" cy="66" rx="7" ry="8.6" fill="#7a2433" stroke="' + INK + '" stroke-width="4"/></g>';
    // dead: X eyes and a wobbly mouth
    s += '<g class="fx fx-dead" stroke="' + INK + '" stroke-linecap="round" fill="none">' +
      '<path d="M31 37L43 49M43 37L31 49M57 37L69 49M69 37L57 49" stroke-width="5"/>' +
      '<path d="M35 67Q42.5 60 50 67Q57.5 74 65 67" stroke-width="4.6"/></g>';
    // cool: shades and a grin
    s += '<g class="fx fx-cool">' +
      '<path d="M22 37H78" stroke="' + INK + '" stroke-width="4.5" stroke-linecap="round"/>' +
      '<path d="M24.5 36.5H46Q46 52 36 52Q24.5 52 24.5 36.5Z" fill="url(#msg-lens)" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"/>' +
      '<path d="M54 36.5H75.5Q75.5 52 64 52Q54 52 54 36.5Z" fill="url(#msg-lens)" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"/>' +
      '<path d="M29 40.5L35 40.5M58.5 40.5L64.5 40.5" stroke="#cdbcff" stroke-width="2.6" stroke-linecap="round" opacity=".9"/>' +
      '<path d="M34 61Q50 76 66 61" fill="none" stroke="' + INK + '" stroke-width="4.6" stroke-linecap="round"/>' +
      '<path d="M63 59.5L68.5 57" stroke="' + INK + '" stroke-width="3.6" stroke-linecap="round"/></g>';
    return s;
  }

  /* ======================================================================
     State (presentation only)
     ====================================================================== */
  let boardEl = null, wrapEl = null, shellEl = null, stageEl = null, fxEl = null;
  let faceBtn = null, faceSvg = null, mineEl = null, timeEl = null;
  let W = 0, H = 0, built = false, cells = [], sigs = [];
  let size = 28, turned = false, outcome = '', dealNext = true, gen = 0, lastCfg = null;
  const timers = new Set();
  const live = new Set();

  function later(fn, ms) {
    const g = gen;
    const id = setTimeout(() => { timers.delete(id); if (g === gen) fn(); }, ms);
    timers.add(id);
  }
  function anim(el, frames, opts, keep) {
    if (!el || !el.animate) { if (opts && opts.remove && el && el.parentNode) el.parentNode.removeChild(el); return null; }
    const a = el.animate(frames, opts);
    if (keep) { live.add(a); const drop = () => live.delete(a); a.onfinish = drop; a.oncancel = drop; }
    if (opts && opts.remove) {
      const rm = () => { if (el.parentNode) el.parentNode.removeChild(el); };
      a.onfinish = rm; a.oncancel = rm;
    }
    return a;
  }

  /* ======================================================================
     Binding + layout
     ====================================================================== */
  function bind(o) {
    ensureDefs();
    boardEl = o.board; wrapEl = o.wrap; shellEl = o.shell; stageEl = o.stage; fxEl = o.fx;
    faceBtn = o.face; mineEl = o.mineCounter; timeEl = o.timeCounter;
    if (faceBtn && !faceSvg) {
      faceSvg = document.createElementNS(NS, 'svg');
      faceSvg.setAttribute('class', 'ms-face');
      faceSvg.setAttribute('viewBox', '0 0 100 100');
      faceSvg.setAttribute('aria-hidden', 'true');
      faceSvg.setAttribute('focusable', 'false');
      faceSvg.setAttribute('data-mode', 'normal');
      faceSvg.innerHTML = faceMarkup();
      faceBtn.textContent = '';
      faceBtn.appendChild(faceSvg);
      faceBtn.setAttribute('aria-label', 'New game');
    }
    let raf = 0;
    const relayout = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => layout(false)); };
    if (window.ResizeObserver && stageEl) new ResizeObserver(relayout).observe(stageEl);
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
  }

  function layout(force) {
    if (!boardEl || !stageEl || !W) return;
    const st = getComputedStyle(stageEl), sh = getComputedStyle(shellEl), wr = getComputedStyle(wrapEl);
    let avail = stageEl.clientWidth - pf(st.paddingLeft) - pf(st.paddingRight);
    avail -= pf(sh.paddingLeft) + pf(sh.paddingRight) + pf(sh.borderLeftWidth) + pf(sh.borderRightWidth);
    avail -= pf(wr.paddingLeft) + pf(wr.paddingRight) + pf(wr.borderLeftWidth) + pf(wr.borderRightWidth);
    if (avail <= 0) return;
    const narrow = window.innerWidth <= 720;
    let cols = W, rows = H, t = false;
    if (avail / W < TAP && H < W) { t = true; cols = H; rows = W; }
    const wFit = avail / cols;
    let s = Math.min(wFit, MAX);
    if (!narrow) {
      const hFit = (window.innerHeight - RESERVE) / rows;
      s = Math.min(s, Math.max(hFit, Math.min(wFit, FLOOR)));
    }
    s = Math.max(MIN, Math.floor(s * 2) / 2);
    if (!force && s === size && t === turned) return;
    size = s; turned = t;
    boardEl.style.setProperty('--cell-size', s + 'px');
    boardEl.style.gridTemplateColumns = 'repeat(' + cols + ', var(--cell-size))';
    boardEl.style.gridTemplateRows = t ? 'repeat(' + rows + ', var(--cell-size))' : '';
    boardEl.style.gridAutoFlow = t ? 'column' : '';
    boardEl.classList.toggle('is-turned', t);
  }

  // screen position (column, row) of grid cell (x, y)
  const colOf = (x, y) => (turned ? y : x);
  const rowOf = (x, y) => (turned ? x : y);

  /* ======================================================================
     Board DOM: built once per size, then patched
     ====================================================================== */
  function build() {
    const frag = document.createDocumentFragment();
    cells = new Array(W * H);
    sigs = new Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cell';
        b.dataset.x = String(x);
        b.dataset.y = String(y);
        cells[y * W + x] = b;
        frag.appendChild(b);
      }
    }
    boardEl.textContent = '';
    boardEl.appendChild(frag);
    built = true;
  }

  // the same classes the game's own renderer used, in the same cases
  function classesFor(c) {
    let s = 'cell';
    if (c.revealed) {
      s += ' revealed';
      if (c.mine) { s += ' mine'; if (c.exploded) s += ' exploded'; }
      else if (c.adj > 0) s += ' num' + c.adj;
    } else if (c.mark === 1) s += ' flagged';
    else if (c.mark === 2) s += ' question';
    if (c.wrong) s += ' wrong';
    return s;
  }

  function patch(b, c, sig, x, y) {
    b.className = sig;
    b.style.removeProperty('--d');
    b.textContent = '';
    let label = 'covered';
    if (c.revealed) {
      if (c.mine) {
        b.appendChild(icon('ms-mine', 'ms-mine'));
        if (c.mark === 1 && !c.exploded) { b.appendChild(icon('ms-flag', 'ms-badge')); label = 'mine, flagged'; }
        else label = c.exploded ? 'exploded mine' : 'mine';
      } else if (c.adj > 0) {
        const n = document.createElement('span');
        n.className = 'ms-n';
        n.textContent = String(c.adj);
        b.appendChild(n);
        label = c.adj + (c.adj === 1 ? ' mine' : ' mines') + ' around';
      } else label = 'empty';
    } else if (c.mark === 1) { b.appendChild(icon('ms-flag', 'ms-flag')); label = 'flagged'; }
    else if (c.mark === 2) {
      const q = document.createElement('span');
      q.className = 'ms-q';
      q.textContent = '?';
      b.appendChild(q);
      label = 'question mark';
    }
    if (c.wrong) { b.appendChild(icon('ms-x', 'ms-x')); label = 'wrong flag'; }
    b.setAttribute('aria-label', label + ', row ' + (y + 1) + ', column ' + (x + 1));
  }

  function render(grid, cfg, info) {
    if (!boardEl || !grid || !grid.length) return;
    info = info || {};
    lastCfg = cfg;
    let fresh = false;
    if (!built || cfg.w !== W || cfg.h !== H) {
      W = cfg.w; H = cfg.h;
      build();
      layout(true);
      fresh = true;
    }
    boardEl.classList.toggle('is-over', !!info.finished);

    const opened = [], flagged = [], asked = [], mines = [], wrongs = [];
    let blast = -1;
    for (let y = 0; y < H; y++) {
      const row = grid[y];
      for (let x = 0; x < W; x++) {
        const c = row[x];
        const i = y * W + x;
        let sig = classesFor(c);
        if (c.revealed && c.mine && c.mark === 1 && !c.exploded) sig += ' ms-wf';
        const prev = sigs[i];
        if (sig === prev) continue;
        sigs[i] = sig;
        patch(cells[i], c, sig, x, y);
        if (prev === undefined) continue;
        const wasOpen = prev.indexOf(' revealed') >= 0;
        if (c.revealed && !wasOpen) {
          if (!c.mine) opened.push(i);
          else if (c.exploded) blast = i;
          else mines.push(i);
        } else if (!c.revealed) {
          if (c.wrong && prev.indexOf(' wrong') < 0) wrongs.push(i);
          else if (c.mark === 1 && prev.indexOf(' flagged') < 0) flagged.push(i);
          else if (c.mark === 2 && prev.indexOf(' question') < 0) asked.push(i);
        }
      }
    }

    if (fresh) {
      if (dealNext) deal();
      dealNext = false;
      return;
    }
    const hint = info.hint || null;
    const lost = blast >= 0 && outcome !== 'loss';
    const won = !!(info.finished && info.won) && outcome !== 'win';
    let digEnd = 0;
    if (opened.length) digEnd = dig(opened, hint);
    if (asked.length) asked.forEach((i) => mark(cells[i], reduced ? 'ms-fade' : 'ms-qpop', 0));
    if (lost) { outcome = 'loss'; loss(blast, mines, wrongs); }
    else {
      if (mines.length) mines.forEach((i) => mark(cells[i], reduced ? 'ms-fade' : 'ms-dig', 0));
      if (wrongs.length) wrongs.forEach((i) => mark(cells[i], reduced ? 'ms-fade' : 'ms-x-in', 0));
    }
    if (won) { outcome = 'win'; win(flagged, hint, digEnd); }
    else if (flagged.length) flagged.forEach((i) => mark(cells[i], reduced ? 'ms-fade' : 'ms-pop', 0));
  }

  function mark(b, cls, d, extra) {
    if (!b) return;
    b.classList.add(cls);
    if (extra) b.classList.add(extra);
    if (d) b.style.setProperty('--d', Math.round(d) + 'ms');
  }

  /* ---------- new board: a quick diagonal settle ---------- */
  function deal() {
    if (reduced) return;
    const span = turned ? (H + W) : (W + H);
    const k = Math.min(18, 300 / Math.max(1, span));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) mark(cells[y * W + x], 'ms-deal', (colOf(x, y) + rowOf(x, y)) * k);
    }
  }

  /* ---------- the dig wave: BFS over the cells that actually opened ---------- */
  function dig(list, hint) {
    if (reduced) { list.forEach((i) => mark(cells[i], 'ms-fade', 0)); return 0; }
    const dist = new Map();
    list.forEach((i) => dist.set(i, -1));
    const queue = [];
    const seed = (i) => { dist.set(i, 0); queue.push(i); };
    if (hint) {
      list.forEach((i) => {
        const x = i % W, y = (i / W) | 0;
        if (Math.abs(x - hint.x) <= 1 && Math.abs(y - hint.y) <= 1) seed(i);
      });
    }
    let maxD = 0;
    const run = () => {
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q], d = dist.get(i);
        const x = i % W, y = (i / W) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (dist.get(j) === -1) { dist.set(j, d + 1); if (d + 1 > maxD) maxD = d + 1; queue.push(j); }
          }
        }
      }
      queue.length = 0;
    };
    run();
    list.forEach((i) => { if (dist.get(i) === -1) { seed(i); run(); } });
    const step = clamp(520 / Math.max(1, maxD), 14, 36);
    list.forEach((i) => {
      const b = cells[i];
      mark(b, 'ms-dig', dist.get(i) * step);
      b.style.setProperty('--rot', ((FX() - 0.5) * 30).toFixed(1) + 'deg');
    });
    if (list.length >= 8 && hint && fxEl) {
      const g = geo();
      const p = at(g, hint.x, hint.y);
      ring(p, 'rgba(210, 225, 255, .7)', size * 0.6, size * 3.2, 0, 520, 2);
    }
    return maxD * step + 360;
  }

  /* ---------- particles ---------- */
  function geo() {
    const br = boardEl.getBoundingClientRect(), fr = fxEl.getBoundingClientRect();
    return { ox: br.left - fr.left, oy: br.top - fr.top, bw: br.width, bh: br.height };
  }
  function at(g, x, y) {
    return { x: g.ox + (colOf(x, y) + 0.5) * size, y: g.oy + (rowOf(x, y) + 0.5) * size };
  }
  function part(cls, p) {
    const e = document.createElement('span');
    e.className = 'ms-p ' + cls;
    e.style.left = p.x.toFixed(1) + 'px';
    e.style.top = p.y.toFixed(1) + 'px';
    e.style.opacity = '0';
    fxEl.appendChild(e);
    return e;
  }
  function ring(p, color, from, to, delay, dur, bw) {
    const e = part('ms-ring', p);
    e.style.width = e.style.height = to + 'px';
    e.style.marginLeft = e.style.marginTop = (-to / 2) + 'px';
    e.style.borderColor = color;
    e.style.borderWidth = (bw || 3) + 'px';
    e.style.boxShadow = '0 0 12px ' + color;
    anim(e, [
      { transform: 'scale(' + (from / to).toFixed(3) + ')', opacity: 0.95 },
      { transform: 'scale(1)', opacity: 0 }
    ], { duration: dur, delay: delay, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both', remove: true });
  }
  function flash(p, color, d, delay) {
    const e = part('ms-flash', p);
    e.style.width = e.style.height = d + 'px';
    e.style.marginLeft = e.style.marginTop = (-d / 2) + 'px';
    e.style.background = 'radial-gradient(closest-side, ' + color + ', rgba(255,120,60,.45) 45%, transparent)';
    anim(e, [
      { transform: 'scale(.3)', opacity: 1 },
      { transform: 'scale(1)', opacity: 0.85, offset: 0.35 },
      { transform: 'scale(1.25)', opacity: 0 }
    ], { duration: 520, delay: delay, easing: 'ease-out', fill: 'both', remove: true });
  }
  function debris(p, n, delay) {
    const cols = [INK, CORAL, LEMON, '#3a2e63', '#ff9a7a'];
    for (let i = 0; i < n; i++) {
      const e = part('ms-shard', p);
      e.style.background = cols[i % cols.length];
      if (cols[i % cols.length] === INK) e.style.borderColor = '#6f5fa6';
      const a = (i / n) * Math.PI * 2 + FX() * 0.5;
      const d = size * (1.4 + FX() * 2.2);
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d - size * 0.9;
      const rot = (FX() - 0.5) * 720;
      anim(e, [
        { transform: 'translate(-50%,-50%) rotate(0deg) scale(1)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + (dx * 0.65).toFixed(1) + 'px), calc(-50% + ' + (dy * 0.65).toFixed(1) + 'px)) rotate(' + (rot * 0.6).toFixed(0) + 'deg) scale(1)', opacity: 1, offset: 0.45 },
        { transform: 'translate(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + (dy + size * 1.8).toFixed(1) + 'px)) rotate(' + rot.toFixed(0) + 'deg) scale(.5)', opacity: 0 }
      ], { duration: 640 + FX() * 260, delay: delay, easing: 'cubic-bezier(.15,.6,.4,1)', fill: 'both', remove: true });
    }
    for (let i = 0; i < 10; i++) {
      const e = part('ms-spark', p);
      const c = i % 2 ? LEMON : '#fff3c4';
      e.style.background = c; e.style.color = c;
      const a = FX() * Math.PI * 2, d = size * (0.9 + FX() * 1.6);
      anim(e, [
        { transform: 'translate(-50%,-50%) scale(1.2)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + (Math.cos(a) * d).toFixed(1) + 'px), calc(-50% + ' + (Math.sin(a) * d).toFixed(1) + 'px)) scale(0)', opacity: 0 }
      ], { duration: 380 + FX() * 200, delay: delay, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both', remove: true });
    }
  }
  function smoke(p, n, delay) {
    for (let i = 0; i < n; i++) {
      const s = size * (1.3 + FX() * 1.1);
      const e = part('ms-smoke', p);
      e.style.width = e.style.height = s + 'px';
      e.style.marginLeft = e.style.marginTop = (-s / 2) + 'px';
      const dx = (FX() - 0.5) * size * 1.6, dy = -size * (0.8 + FX() * 1.2);
      anim(e, [
        { transform: 'translate(0,0) scale(.35)', opacity: 0 },
        { transform: 'translate(' + (dx * 0.4).toFixed(1) + 'px,' + (dy * 0.4).toFixed(1) + 'px) scale(.9)', opacity: 0.9, offset: 0.25 },
        { transform: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(1.5)', opacity: 0 }
      ], { duration: 900 + FX() * 400, delay: delay + 60 + i * 40, easing: 'ease-out', fill: 'both', remove: true });
    }
  }
  function confetti(p, n, spread, delay) {
    const cols = [LEMON, CORAL, MINT, accent, PEARL, STEEL];
    for (let i = 0; i < n; i++) {
      const e = part('ms-confetti', p);
      e.style.background = cols[i % cols.length];
      const vx = (FX() - 0.5) * spread;
      const up = size * (2 + FX() * 2.6);
      const fall = size * (3 + FX() * 3.5);
      const rot = (FX() - 0.5) * 900;
      anim(e, [
        { transform: 'translate(-50%,-50%) rotate(0deg) scale(.6)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + (vx * 0.5).toFixed(1) + 'px), calc(-50% - ' + up.toFixed(1) + 'px)) rotate(' + (rot * 0.45).toFixed(0) + 'deg) scale(1)', opacity: 1, offset: 0.38, easing: 'cubic-bezier(.3,.6,.6,1)' },
        { transform: 'translate(calc(-50% + ' + vx.toFixed(1) + 'px), calc(-50% + ' + (fall - up).toFixed(1) + 'px)) rotate(' + rot.toFixed(0) + 'deg) scale(.9)', opacity: 0 }
      ], { duration: 1400 + FX() * 700, delay: delay + FX() * 160, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'both', remove: true });
    }
  }
  function shake() {
    if (!shellEl || reduced) return;
    anim(shellEl, [
      { transform: 'translate(0, 0)' }, { transform: 'translate(-3px, 1px)' }, { transform: 'translate(3px, -1px)' },
      { transform: 'translate(-2px, 1px)' }, { transform: 'translate(1px, 0)' }, { transform: 'translate(0, 0)' }
    ], { duration: 360, easing: 'ease-out' }, true);
  }

  /* ---------- loss: the mine marked `exploded` goes off, the rest ripple out ---------- */
  function loss(bi, mines, wrongs) {
    if (shellEl) shellEl.classList.add('ms-lost');
    const all = [bi].concat(mines);
    if (reduced) {
      all.concat(wrongs).forEach((i) => mark(cells[i], 'ms-fade', 0));
      return;
    }
    const bx = bi % W, by = (bi / W) | 0;
    mark(cells[bi], 'ms-dig', 0, 'ms-blast');
    if (fxEl) {
      const g = geo();
      const p = at(g, bx, by);
      flash(p, 'rgba(255, 236, 170, 1)', size * 4.2, 0);
      ring(p, LEMON, size * 0.4, size * 3.4, 0, 460, 3);
      ring(p, CORAL, size * 0.5, size * 5.2, 110, 620, 3);
      debris(p, 18, 20);
      smoke(p, 5, 80);
    }
    shake();
    let far = 1;
    const dd = mines.map((i) => {
      const x = i % W, y = (i / W) | 0;
      const d = Math.hypot(x - bx, y - by);
      if (d > far) far = d;
      return d;
    });
    const k = Math.min(48, 820 / far);
    mines.forEach((i, n) => mark(cells[i], 'ms-dig', 170 + dd[n] * k, 'ms-hot'));
    const after = 170 + far * k + 160;
    wrongs.forEach((i) => mark(cells[i], 'ms-x-in', after));
  }

  /* ---------- win: auto-placed flags ripple out, shine + confetti ---------- */
  function win(flags, hint, digEnd) {
    if (shellEl) shellEl.classList.add('ms-won');
    if (reduced) { flags.forEach((i) => mark(cells[i], 'ms-fade', 0)); return; }
    const o = hint || { x: W >> 1, y: H >> 1 };
    const start = clamp(digEnd * 0.55, 120, 700);
    let far = 1;
    const dd = flags.map((i) => {
      const d = Math.hypot(i % W - o.x, ((i / W) | 0) - o.y);
      if (d > far) far = d;
      return d;
    });
    const k = Math.min(45, 650 / far);
    flags.forEach((i, n) => mark(cells[i], 'ms-pop', start + dd[n] * k, 'ms-gold'));
    if (shellEl) shellEl.style.setProperty('--ms-sweep-d', Math.round(start + 100) + 'ms');
    const burst = start + far * k * 0.5;
    later(() => {
      if (!fxEl) return;
      const g = geo();
      const top = { x: g.ox + g.bw / 2, y: g.oy + g.bh * 0.32 };
      confetti(top, 44, Math.max(g.bw * 1.1, size * 8), 0);
      ring(top, MINT, size, Math.max(g.bw, g.bh) * 0.9, 0, 760, 3);
      if (faceBtn && faceSvg) {
        anim(faceSvg, [{ transform: 'scale(1)' }, { transform: 'translateY(-14%) scale(1.18) rotate(-8deg)' }, { transform: 'translateY(0) scale(.96)' }, { transform: 'scale(1)' }],
          { duration: 620, easing: 'cubic-bezier(.3,1.4,.5,1)' }, true);
      }
    }, burst);
    later(() => {
      if (!fxEl) return;
      const g = geo();
      confetti({ x: g.ox + g.bw * 0.15, y: g.oy + g.bh * 0.55 }, 18, size * 6, 0);
      confetti({ x: g.ox + g.bw * 0.85, y: g.oy + g.bh * 0.55 }, 18, size * 6, 60);
    }, burst + 260);
  }

  /* ======================================================================
     Page API
     ====================================================================== */
  function newGame() {
    gen++;
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    live.forEach((a) => { try { a.cancel(); } catch (e) { /* gone */ } });
    live.clear();
    if (fxEl) fxEl.textContent = '';
    if (shellEl) { shellEl.classList.remove('ms-won', 'ms-lost'); shellEl.style.removeProperty('--ms-sweep-d'); }
    if (faceSvg && faceSvg.getAnimations) faceSvg.getAnimations().forEach((a) => a.cancel());
    built = false;
    outcome = '';
    dealNext = true;
  }

  const FACE_LABEL = { normal: 'New game', wow: 'New game', dead: 'New game (you hit a mine)', cool: 'New game (board cleared)' };
  function face(mode) {
    if (!faceSvg) return false;
    const m = FACE_LABEL[mode] ? mode : 'normal';
    const prev = faceSvg.getAttribute('data-mode');
    faceSvg.setAttribute('data-mode', m);
    faceBtn.setAttribute('aria-label', FACE_LABEL[m]);
    if (prev !== m && m === 'dead' && !reduced) {
      anim(faceSvg, [{ transform: 'rotate(0)' }, { transform: 'rotate(-14deg) scale(1.08)' }, { transform: 'rotate(10deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(0)' }],
        { duration: 520, easing: 'ease-out' }, true);
    }
    return true;
  }

  function counter(el, text) {
    if (!el) return;
    text = String(text);
    if (el._msText === text) return;
    const first = el._msText === undefined;
    el._msText = text;
    const m = /^(-?)(0*)(\d*)$/.exec(text);
    el.textContent = '';
    if (!m) { el.textContent = text; return; }
    let sign = m[1], zeros = m[2], rest = m[3];
    if (!rest && zeros) { rest = zeros.slice(-1); zeros = zeros.slice(0, -1); }
    if (sign) { const s = document.createElement('span'); s.textContent = sign; el.appendChild(s); }
    if (zeros) { const z = document.createElement('span'); z.className = 'z'; z.textContent = zeros; el.appendChild(z); }
    if (rest) el.appendChild(document.createTextNode(rest));
    el.classList.toggle('is-neg', !!sign);
    const pod = el.closest('.ms-pod');
    if (el === timeEl && pod) pod.style.setProperty('--sec', String(parseInt(text, 10) || 0));
    if (el === mineEl && pod && !first && !reduced) {
      pod.classList.remove('ms-bump');
      void pod.offsetWidth;   // restart the pulse
      pod.classList.add('ms-bump');
    }
  }

  function overHoldMs(isWin) {
    if (reduced) return 650;
    return isWin ? 1900 : 1500;
  }

  window.MinesArt = {
    bind, newGame, render, face, counter, overHoldMs,
    isReduced: () => reduced,
    tileSize: () => size,
    isTurned: () => turned
  };
})();
