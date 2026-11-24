/* ==========================================================================
   Cartofia Word Puzzle — tile art  (window.WordArt)
   Pure presentation. The inline game script in index.html still owns the
   word list, the target, scoring, input and result reporting. It hands this
   file a read-only snapshot after every render and calls a few hooks; this
   file never writes game state and never touches Math.random (decoration
   and particles use their own seeded PRNG).

   What it adds (see render.css for the look):
     - data-show on every tile / key: the face to display. It equals the
       game's final state except while a row is flipping, when not-yet
       flipped tiles still show the typed face and keys only show what the
       flipped tiles have revealed. With nothing in flight the keys show the
       game's own best-known state per letter.
     - typing pop, backspace settle, a per-tile flip reveal that lands on the
       state the game scored, a shake for an invalid word, a bounce with
       sparkles + confetti on a win, a dimmed tray on a loss
     - every timer and animation is owned by a generation counter; reset()
       (new puzzle) cancels all of them and clears the particle layer
   prefers-reduced-motion: no flips, pops, shakes, bounces or particles;
   tiles change face instantly (with a short fade) and the end states glow.

   API (used by index.html):
     WordArt.afterRender({ guesses:[{word, states}], current, over, keyState })
     WordArt.invalid(rowIndex)        an invalid submit on that row
     WordArt.reset()                  a new puzzle is starting
     WordArt.revealDelay()            ms until the board has finished its
                                      reveal / celebration (overlay timing)
   ========================================================================== */
(function () {
  'use strict';
  if (window.WordArt) return;

  const COLS = 5;
  const RANK = { absent: 1, present: 2, correct: 3 };
  const MINT = '#3ee6a6', LEMON = '#ffcf5c', CORAL = '#ff6b4a', PEARL = '#f3ecff';
  const T = { stagger: 230, half1: 210, half2: 270, bounceStep: 95, bounce: 600, lossPause: 520, rmPause: 380 };
  const P = 'perspective(520px) ';

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
  const FX = prng(0x5eed1e);      // particles
  const now = () => (window.performance && performance.now ? performance.now() : Date.now());

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
  const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

  /* ---------- timers + animations, all tied to the current puzzle ---------- */
  let gen = 0;
  const timers = new Set();
  const anims = new Set();
  function later(fn, ms) {
    const g = gen;
    const id = setTimeout(() => { timers.delete(id); if (g === gen) fn(); }, Math.max(0, ms));
    timers.add(id);
    return id;
  }
  function drop(id) { if (id) { clearTimeout(id); timers.delete(id); } }
  function anim(el, frames, opts) {
    if (!canAnimate || !el) return null;
    const a = el.animate(frames, opts);
    anims.add(a);
    const done = () => {
      anims.delete(a);
      if (opts && opts.remove && el.parentNode) el.parentNode.removeChild(el);
    };
    a.addEventListener('finish', done);
    a.addEventListener('cancel', done);
    return a;
  }

  /* ---------- DOM ---------- */
  let boardEl = null, kbEl = null, noticeEl = null, trayEl = null, fxEl = null;
  function bind() {
    if (boardEl) return true;
    boardEl = document.getElementById('board');
    if (!boardEl) return false;
    kbEl = document.getElementById('keyboard');
    noticeEl = document.getElementById('puzzleNotice');
    trayEl = boardEl.closest('.wp-tray') || boardEl.parentNode;
    fxEl = trayEl.querySelector('.wp-fx');
    if (!fxEl) {
      fxEl = document.createElement('div');
      fxEl.className = 'wp-fx';
      fxEl.setAttribute('aria-hidden', 'true');
      trayEl.appendChild(fxEl);
    }
    boardEl.classList.add('wp-live');
    if (kbEl) kbEl.classList.add('wp-live');
    decorate();
    return true;
  }

  // the cover's sparkles on the tray rim (seeded, so they never move between visits)
  const STAR = 'M10 0L12.4 7.6 20 10 12.4 12.4 10 20 7.6 12.4 0 10 7.6 7.6Z';
  function decorate() {
    if (trayEl.querySelector('.wp-star')) return;
    const R = prng(0x57a125);
    const spots = [
      { x: 100, y: 0, c: LEMON, s: 1.15 },
      { x: 0, y: 100, c: MINT, s: 1 },
      { x: 0, y: 0, c: PEARL, s: 0.62 },
      { x: 100, y: 100, c: LEMON, s: 0.7 }
    ];
    spots.forEach((p, i) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'wp-star');
      svg.setAttribute('viewBox', '0 0 20 20');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', STAR);
      path.setAttribute('fill', p.c);
      svg.appendChild(path);
      const jx = (R() - 0.5) * 6, jy = (R() - 0.5) * 6;
      svg.style.left = 'calc(' + p.x + '% - ' + (10 * p.s - jx).toFixed(1) + 'px)';
      svg.style.top = 'calc(' + p.y + '% - ' + (10 * p.s - jy).toFixed(1) + 'px)';
      svg.style.width = svg.style.height = (20 * p.s).toFixed(1) + 'px';
      svg.style.animationDelay = (-R() * 3.2).toFixed(2) + 's';
      if (i > 1) svg.style.opacity = '0.8';
      trayEl.appendChild(svg);
    });
  }

  function rowEl(r) { return boardEl ? boardEl.children[r] || null : null; }
  function cellEl(r, c) { const row = rowEl(r); return row ? row.children[c] || null : null; }
  function keyEl(k) { return kbEl ? kbEl.querySelector('.kbd-btn[data-key="' + k + '"]') : null; }
  function setAttr(el, name, on, value) {
    if (!el) return;
    if (on) { if (el.getAttribute(name) !== (value || '')) el.setAttribute(name, value || ''); }
    else if (el.hasAttribute(name)) el.removeAttribute(name);
  }

  /* ---------- what the art knows about the puzzle ---------- */
  let rows = [];            // [{ word, states, shown:[bool], end }]
  let cur = '', curRow = 0, over = false, overSeen = false, won = false;
  let finalKeys = {};
  let busyUntil = 0;
  let holdTimer = 0;
  const badTimers = new Map();

  function reset() {
    gen++;
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    Array.from(anims).forEach((a) => { try { a.cancel(); } catch (e) { /* already gone */ } });
    anims.clear();
    badTimers.clear();
    holdTimer = 0;
    rows = [];
    cur = ''; curRow = 0; over = false; overSeen = false; won = false;
    finalKeys = {};
    busyUntil = 0;
    if (!boardEl) return;
    if (fxEl) fxEl.textContent = '';
    if (trayEl) trayEl.removeAttribute('data-over');
    if (noticeEl) noticeEl.removeAttribute('data-wp-hold');
    Array.prototype.forEach.call(boardEl.children, (r) => r.removeAttribute('data-bad'));
    if (kbEl) kbEl.querySelectorAll('[data-bad]').forEach((k) => k.removeAttribute('data-bad'));
    paint();
  }

  /* ---------- painting faces ---------- */
  function faceFor(r, c) {
    const row = rows[r];
    if (row) return row.shown[c] ? row.states[c] : 'typed';
    if (!over && r === curRow) return c < cur.length ? 'typed' : 'empty';
    return 'empty';
  }
  function paintCell(r, c) {
    const cell = cellEl(r, c);
    if (!cell) return;
    const v = faceFor(r, c);
    if (cell.dataset.show !== v) cell.dataset.show = v;
    setAttr(cell, 'data-next', !over && r === curRow && c === cur.length && cur.length < COLS);
  }
  function paint() {
    if (!boardEl) return;
    const n = boardEl.children.length;
    for (let r = 0; r < n; r++) {
      setAttr(rowEl(r), 'data-active', !over && r === curRow);
      for (let c = 0; c < COLS; c++) paintCell(r, c);
    }
    syncKeys(false);
  }

  function pending() {
    for (let i = 0; i < rows.length; i++) if (rows[i].shown.indexOf(false) !== -1) return true;
    return false;
  }
  // keys: best state over the tiles revealed so far; with no reveal in flight
  // that is exactly the game's own keyState (the final, best-known state)
  function syncKeys(popUps) {
    if (!kbEl) return;
    let best;
    if (!pending()) best = finalKeys;
    else {
      best = {};
      rows.forEach((row) => {
        row.shown.forEach((on, c) => {
          if (!on) return;
          const L = row.word[c], st = row.states[c];
          if ((RANK[st] || 0) > (RANK[best[L]] || 0)) best[L] = st;
        });
      });
    }
    kbEl.querySelectorAll('.kbd-btn[data-key]').forEach((btn) => {
      const k = btn.dataset.key;
      if (!k || k.length !== 1) return;
      const v = best[k.toLowerCase()] || '';
      const old = btn.dataset.show || '';
      if (v === old) return;
      if (v) btn.dataset.show = v; else btn.removeAttribute('data-show');
      if (popUps && v && !reduced && (RANK[v] || 0) > (RANK[old] || 0)) {
        anim(btn, [{ transform: 'scale(1)' }, { transform: 'scale(1.2)', offset: 0.4 }, { transform: 'scale(1)' }],
          { duration: 280, easing: 'cubic-bezier(.3,1.5,.5,1)' });
      }
    });
  }

  /* ---------- small effects ---------- */
  function pressKey(k, bad) {
    const btn = keyEl(k);
    if (!btn) return;
    if (bad) flagBad(btn, 520);
    if (reduced) return;
    anim(btn, [
      { transform: 'translateY(0)', filter: 'brightness(1)' },
      { transform: 'translateY(3px)', filter: 'brightness(1.35)', offset: 0.3 },
      { transform: 'translateY(0)', filter: 'brightness(1)' }
    ], { duration: 170, easing: 'ease-out' });
  }
  function flagBad(el, ms) {
    drop(badTimers.get(el));
    el.setAttribute('data-bad', '');
    badTimers.set(el, later(() => { el.removeAttribute('data-bad'); badTimers.delete(el); }, ms));
  }

  function typed(r, c, letter) {
    pressKey(String(letter || '').toUpperCase());
    if (reduced) return;
    const cell = cellEl(r, c);
    anim(cell, [
      { transform: 'scale(.78)' },
      { transform: 'scale(1.12)', offset: 0.55 },
      { transform: 'scale(1)' }
    ], { duration: 190, easing: 'cubic-bezier(.3,1.3,.5,1)' });
    ringAt(cell, accent, 1.3, 300);
  }
  function erased(r, c) {
    pressKey('BACK');
    if (reduced) return;
    anim(cellEl(r, c), [{ transform: 'scale(1.06)' }, { transform: 'scale(.94)', offset: 0.5 }, { transform: 'scale(1)' }],
      { duration: 150, easing: 'ease-out' });
  }

  // centre of a tile in the particle layer, from layout offsets, so a tile
  // that is mid-flip / mid-pop is measured at its resting size and place
  function centerOf(el) {
    if (!el || !fxEl || !trayEl) return null;
    let x = 0, y = 0, n = el;
    while (n && n !== trayEl) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    if (n !== trayEl) return null;
    return {
      x: x - fxEl.offsetLeft + el.offsetWidth / 2,
      y: y - fxEl.offsetTop + el.offsetHeight / 2,
      w: el.offsetWidth, h: el.offsetHeight
    };
  }
  function ringAt(el, color, scale, dur, delay) {
    const p = centerOf(el);
    if (!p) return;
    const e = document.createElement('span');
    e.className = 'wp-ring';
    e.style.width = p.w + 'px';
    e.style.height = p.h + 'px';
    e.style.marginLeft = (-p.w / 2) + 'px';
    e.style.marginTop = (-p.h / 2) + 'px';
    e.style.borderColor = color;
    e.style.opacity = '0';
    e.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px)';
    fxEl.appendChild(e);
    const t = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) ';
    anim(e, [
      { transform: t + 'scale(.9)', opacity: 0.85 },
      { transform: t + 'scale(' + scale + ')', opacity: 0 }
    ], { duration: dur || 360, delay: delay || 0, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both', remove: true });
  }
  function sparks(el, n, colors, reach, lift) {
    const p = centerOf(el);
    if (!p) return;
    p.y -= p.h * (lift || 0);
    for (let i = 0; i < n; i++) {
      const e = document.createElement('span');
      e.className = 'wp-spark';
      e.style.background = colors[i % colors.length];
      e.style.opacity = '0';
      fxEl.appendChild(e);
      const a = (i / n) * Math.PI * 2 + FX() * 0.6;
      const d = p.w * (reach || 0.75) * (0.7 + FX() * 0.5);
      const x0 = p.x, y0 = p.y, x1 = x0 + Math.cos(a) * d, y1 = y0 + Math.sin(a) * d;
      const s = 0.6 + FX() * 0.7;
      anim(e, [
        { transform: 'translate(' + x0.toFixed(1) + 'px,' + y0.toFixed(1) + 'px) scale(.2) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + ((x0 + x1) / 2).toFixed(1) + 'px,' + ((y0 + y1) / 2).toFixed(1) + 'px) scale(' + s.toFixed(2) + ') rotate(60deg)', opacity: 1, offset: 0.5 },
        { transform: 'translate(' + x1.toFixed(1) + 'px,' + y1.toFixed(1) + 'px) scale(0) rotate(140deg)', opacity: 0 }
      ], { duration: 520 + FX() * 220, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'both', remove: true });
    }
  }
  function confetti(el) {
    const p = centerOf(el);
    if (!p || !fxEl) return;
    const W = fxEl.clientWidth, H = fxEl.clientHeight;
    const colors = [MINT, LEMON, CORAL, accent, PEARL];
    for (let i = 0; i < 42; i++) {
      const e = document.createElement('span');
      e.className = 'wp-confetti';
      e.style.background = colors[i % colors.length];
      e.style.opacity = '0';
      fxEl.appendChild(e);
      const x0 = p.x + (FX() - 0.5) * p.w * 0.8;
      const y0 = p.y;
      const x1 = Math.min(W - 8, Math.max(8, x0 + (FX() - 0.5) * W * 0.95));
      const up = Math.min(y0 - 10, H * (0.25 + FX() * 0.35));
      const ym = y0 - up;
      const y2 = Math.min(H - 6, ym + H * (0.35 + FX() * 0.55));
      const xm = x0 + (x1 - x0) * 0.55;
      const rot = (FX() - 0.5) * 900;
      anim(e, [
        { transform: 'translate(' + x0.toFixed(1) + 'px,' + y0.toFixed(1) + 'px) rotate(0deg) scale(.6)', opacity: 1 },
        { transform: 'translate(' + xm.toFixed(1) + 'px,' + ym.toFixed(1) + 'px) rotate(' + (rot * 0.45).toFixed(0) + 'deg) scale(1)', opacity: 1, offset: 0.35, easing: 'cubic-bezier(.3,.6,.6,1)' },
        { transform: 'translate(' + x1.toFixed(1) + 'px,' + y2.toFixed(1) + 'px) rotate(' + rot.toFixed(0) + 'deg) scale(.9)', opacity: 0 }
      ], { duration: 1500 + FX() * 700, delay: FX() * 140, easing: 'cubic-bezier(.25,.6,.45,1)', fill: 'both', remove: true });
    }
  }

  /* ---------- the reveal ---------- */
  function addRow(r, word, states) {
    const row = { word: String(word || ''), states: (states || []).slice(0, COLS), shown: [], end: now() };
    for (let c = 0; c < COLS; c++) row.shown.push(false);
    rows[r] = row;
    pressKey('ENTER');
    if (reduced || !canAnimate || !cellEl(r, 0)) {
      for (let c = 0; c < COLS; c++) row.shown[c] = true;
      for (let c = 0; c < COLS; c++) {
        anim(cellEl(r, c), [{ opacity: 0.35 }, { opacity: 1 }], { duration: 220, delay: c * 30, easing: 'ease-out', fill: 'backwards' });
      }
      return;
    }
    row.end = now() + (COLS - 1) * T.stagger + T.half1 + T.half2;
    busyUntil = Math.max(busyUntil, row.end);
    for (let c = 0; c < COLS; c++) flip(r, c, c * T.stagger);
  }

  function flip(r, c, delay) {
    const cell = cellEl(r, c);
    const g = gen;
    const a = anim(cell, [
      { transform: P + 'rotateX(0deg)' },
      { transform: P + 'rotateX(90deg)' }
    ], { duration: T.half1, delay, easing: 'cubic-bezier(.55,0,.85,.4)', fill: 'forwards' });
    if (!a) { reveal(r, c); return; }
    a.addEventListener('finish', () => {
      if (g !== gen) return;
      reveal(r, c);
      anim(cell, [
        { transform: P + 'rotateX(-90deg)' },
        { transform: P + 'rotateX(10deg)', offset: 0.72 },
        { transform: P + 'rotateX(0deg)' }
      ], { duration: T.half2, easing: 'cubic-bezier(.2,.75,.35,1)' });
      a.cancel();
      const st = rows[r] && rows[r].states[c];
      if (st === 'correct') ringAt(cell, MINT, 1.32, 420, T.half2 * 0.6);
      else if (st === 'present') ringAt(cell, LEMON, 1.22, 380, T.half2 * 0.6);
      if (c === COLS - 1) later(() => rowDone(r), T.half2);
    });
  }

  function reveal(r, c) {
    const row = rows[r];
    if (!row || row.shown[c]) return;
    row.shown[c] = true;
    paintCell(r, c);
    syncKeys(true);
  }

  function rowDone(r) {
    syncKeys(true);
    if (overSeen && r === rows.length - 1) finale();
  }

  function onOver() {
    const last = rows[rows.length - 1];
    won = !!last && last.states.length === COLS && last.states.every((s) => s === 'correct');
    if (noticeEl && !reduced && canAnimate && pending()) noticeEl.setAttribute('data-wp-hold', '');
    if (reduced || !canAnimate || !last || !pending()) {
      busyUntil = now() + T.rmPause;
      finale();
    } else {
      busyUntil = Math.max(busyUntil, last.end + (won ? (COLS - 1) * T.bounceStep + T.bounce + 260 : T.lossPause));
    }
    // the result line is held until the last tile has turned (not through the bounce)
    const revealEnd = (reduced || !canAnimate || !last) ? now() : last.end;
    drop(holdTimer);
    holdTimer = later(() => { if (noticeEl) noticeEl.removeAttribute('data-wp-hold'); }, revealEnd - now());
  }

  function finale() {
    if (!trayEl) return;
    trayEl.setAttribute('data-over', won ? 'win' : 'loss');
    if (!won || reduced || !canAnimate) return;
    const r = rows.length - 1;
    for (let c = 0; c < COLS; c++) {
      const cell = cellEl(r, c);
      anim(cell, [
        { transform: 'translateY(0) scale(1, 1)' },
        { transform: 'translateY(4%) scale(1.08, .9)', offset: 0.12 },
        { transform: 'translateY(-52%) scale(.95, 1.07)', offset: 0.42 },
        { transform: 'translateY(0) scale(1.07, .92)', offset: 0.7 },
        { transform: 'translateY(-10%) scale(1, 1)', offset: 0.84 },
        { transform: 'translateY(0) scale(1, 1)' }
      ], { duration: T.bounce, delay: c * T.bounceStep, easing: 'ease-in-out' });
      later(() => sparks(cell, 7, [LEMON, MINT, PEARL, accent], 0.95, 0.45), c * T.bounceStep + T.bounce * 0.4);
    }
    later(() => confetti(cellEl(r, 2)), 2 * T.bounceStep + T.bounce * 0.38);
  }

  /* ---------- public hooks ---------- */
  function afterRender(s) {
    if (!bind() || !s) return;
    const gs = Array.isArray(s.guesses) ? s.guesses : [];
    if (gs.length < rows.length) reset();
    for (let r = rows.length; r < gs.length; r++) addRow(r, gs[r] && gs[r].word, gs[r] && gs[r].states);
    finalKeys = Object.assign({}, s.keyState || {});
    const isOver = !!s.over;
    const active = gs.length;
    const next = (!isOver && active < (boardEl.children.length || 6)) ? String(s.current || '') : '';
    if (!isOver && active === curRow) {
      if (next.length > cur.length) typed(active, next.length - 1, next[next.length - 1]);
      else if (next.length < cur.length) erased(active, next.length);
    }
    cur = next;
    curRow = active;
    over = isOver;
    if (isOver && !overSeen) { overSeen = true; onOver(); }
    paint();
  }

  function invalid(r) {
    if (!bind()) return;
    pressKey('ENTER', true);
    const row = rowEl(r);
    if (!row) return;
    flagBad(row, 640);
    if (!reduced) {
      anim(row, [
        { transform: 'translateX(0)' }, { transform: 'translateX(-9px)', offset: 0.12 },
        { transform: 'translateX(8px)', offset: 0.28 }, { transform: 'translateX(-6px)', offset: 0.44 },
        { transform: 'translateX(4px)', offset: 0.6 }, { transform: 'translateX(-2px)', offset: 0.76 },
        { transform: 'translateX(0)' }
      ], { duration: 460, easing: 'ease-out' });
      anim(noticeEl, [{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)', offset: 0.3 }, { transform: 'translateY(0)' }],
        { duration: 260, easing: 'ease-out' });
    } else if (noticeEl) {
      anim(noticeEl, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    }
  }

  function revealDelay() {
    return Math.round(Math.max(0, busyUntil - now()));
  }

  window.WordArt = { afterRender, invalid, reset, revealDelay, isReduced: () => reduced };
})();
