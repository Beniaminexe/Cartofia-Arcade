/* ==========================================================================
   Cartofia Snake — board art  (window.SnakeArt)
   Pure presentation. It reads the game's state every frame and never writes
   it, so rules, timing, input and scoring stay in index.html untouched.

   The cover (assets/games/snake.svg) come to life:
     - a textured checkered lawn, painted once into an offscreen canvas
     - one continuous, rounded snake: ink outline, shaded body, bead markings,
       tapered tail, a "gulp" bulge that travels down after each apple
     - a head whose eyes face the travel direction (and glance at the apple),
       that blinks, flicks its tongue and opens its mouth near food
     - a bobbing, glowing apple that pops in when it spawns
     - an eat burst (juice, sparkles, ring, "+1") and a death animation
       (bonk + gentle shake, X eyes, the colour drains head to tail)
   Smooth motion: the snake glides between grid steps using the game's own
   step fraction (accumulator / stepDelay), so the tick speed never changes.

   DPR-aware (backing store follows the CSS size x devicePixelRatio, capped at 2x).
   prefers-reduced-motion: no gliding, bobbing, particles or shake; state
   changes become instant or short fades.
   Visual randomness uses its own seeded PRNG, so the game's Math.random
   sequence (food spawns) is never touched.

   const art = SnakeArt.create(canvas, { grid: 24 });
   art.draw(now, snake, food, dir, t, running, paused, gameOver)   every frame
   art.deathHoldMs()   ms to let the death animation play before the game-over card
   ========================================================================== */
(function () {
  'use strict';
  if (window.SnakeArt) return;

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easeOutBack = (t) => { const u = t - 1; return 1 + 2.70158 * u * u * u + 1.70158 * u * u; };
  const easeOutCubic = (t) => { const u = 1 - t; return 1 - u * u * u; };
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

  /* ---------- palette (from the cover) ---------- */
  const INK = '#1b1230';
  const SHADOW = 'rgba(4, 20, 9, 0.34)';
  const LIVE = { base: '#279a44', mid: '#55da72', hi: '#c2fa96', dot: '#f2ffe0', g0: '#c4fbab', g1: '#5ad972', g2: '#238a3e' };
  const DEAD = { base: '#4b5955', mid: '#7d8c86', hi: '#b2bfba', dot: '#e1e8e4', g0: '#d3dcd8', g1: '#86958f', g2: '#4a5753' };
  const CREAM = '#fff6e5';
  const TONGUE = '#ff4d6d';
  const JUICE = ['#ff4d4d', '#ff7a6b', '#ffb199', '#e8304a'];
  const LEAF = '#5fd35b';
  const LEMON = '#ffd84a';

  function create(canvas, opts) {
    const G = (opts && opts.grid) || 24;
    const S = 576;                 // logical board size in px (all drawing uses this space)
    const C = S / G;               // one cell
    // opaque: every frame repaints the whole board, so the compositor can skip blending it
    const ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    const R = prng(0x5a4e6b);      // visual-only randomness

    /* body geometry */
    const W = C * 0.78;            // body width
    const HW = W / 2;
    const IW = C * 0.11;           // ink outline, each side
    const RC = C * 0.5;            // corner radius of the body's centreline
    const HRX = C * 0.57, HRY = C * 0.5;    // head ellipse radii
    const ER = C * 0.2;            // eye radius
    const FONT = '800 ' + Math.round(C * 0.66) + 'px Unbounded, Outfit, system-ui, sans-serif';

    /* ---------- environment ---------- */
    let k = 1;                     // device px per logical px
    let field = null, appleSpr = null, glowSpr = null;
    const GLOW_R = C * 1.05;
    let accent = '#7c5cff';
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let rm = !!(mq && mq.matches);
    if (mq) {
      const onMq = () => { rm = mq.matches; };
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    }
    function readTheme() {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        if (v) accent = v;
      } catch (_) { /* keep default */ }
    }
    readTheme();
    document.addEventListener('cartofia:theme-changed', () => { readTheme(); });
    window.addEventListener('cartofia:theme-changed', () => { readTheme(); });

    /* head gradients live in head-local space (translated, never rotated: light stays top-left) */
    function headGrad(p) {
      const g = ctx.createRadialGradient(-HRX * 0.35, -HRY * 0.5, 1, 0, 0, HRX * 1.15);
      g.addColorStop(0, p.g0); g.addColorStop(0.5, p.g1); g.addColorStop(1, p.g2);
      return g;
    }
    const HEAD_LIVE = headGrad(LIVE), HEAD_DEAD = headGrad(DEAD);

    /* ---------- tracking (inferred from the game's state, read-only) ---------- */
    let snakeRef = null, headRef = null, lastLen = 0, lastTailX = 0, lastTailY = 0;
    let hasPrev = false, grew = false, prevTailX = 0, prevTailY = 0, stepCount = 0;
    let foodX = -1, foodY = -1, foodBorn = -1e9;
    let eatPending = false, eatX = 0, eatY = 0;
    let deathAt = 0, wasOver = false, crashDX = 0, crashDY = 0, puffIdx = 0;
    let blinkAt = -1e9, blinkNext = 1800, tongueAt = -1e9, tongueNext = 2600;
    let mouth = 0, lastNow = 0, shakeAt = -1e9;
    let restDX = 1, restDY = 0;

    /* ---------- buffers (no per-frame allocation) ---------- */
    const MAXP = G * G + 8;                    // raw points: head, cells, tail end
    const RX = new Float32Array(MAXP), RY = new Float32Array(MAXP), DOTI = new Int32Array(MAXP);
    const MAXS = MAXP * 7;                     // smoothed centreline (corners become arcs)
    const PX = new Float32Array(MAXS), PY = new Float32Array(MAXS), CUM = new Float32Array(MAXS);
    const QX = new Float32Array(MAXS), QY = new Float32Array(MAXS);
    let NR = 0, NP = 0, NQ = 0, LEN = 0, NCELL = 0;
    let headAng = 0, SX = 0, SY = 0, TGX = 1, TGY = 0;
    const ARC_N = 6, ARC_C = new Float32Array(ARC_N + 1), ARC_S = new Float32Array(ARC_N + 1);
    for (let j = 0; j <= ARC_N; j++) { ARC_C[j] = Math.cos(j * Math.PI / 2 / ARC_N); ARC_S[j] = Math.sin(j * Math.PI / 2 / ARC_N); }
    const TMAX = 64;                           // tail taper samples
    const TSX = new Float32Array(TMAX), TSY = new Float32Array(TMAX), TNX = new Float32Array(TMAX), TNY = new Float32Array(TMAX), TR = new Float32Array(TMAX);
    let NT = 0, TCX = 0, TCY = 0, TRAD = 0, TSPAN = false;
    const DMAX = 40;
    const DX = new Float32Array(DMAX), DYY = new Float32Array(DMAX), DR = new Float32Array(DMAX), DSS = new Float32Array(DMAX);
    let ND = 0;
    const OFX = new Float32Array(4), OFY = new Float32Array(4);
    let NOF = 0;

    const PN = 80;
    const parts = [];
    for (let i = 0; i < PN; i++) parts.push({ on: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, t0: 0, life: 1, r: 1, col: '' });
    const rings = [];
    for (let i = 0; i < 4; i++) rings.push({ on: false, x: 0, y: 0, t0: 0, dur: 1, r0: 0, r1: 0, w: 2, col: '' });
    const pops = [];
    for (let i = 0; i < 3; i++) pops.push({ on: false, x: 0, y: 0, t0: 0 });
    const bulges = [];
    for (let i = 0; i < 4; i++) bulges.push({ on: false, t0: 0 });

    /* ---------- sizing / caches ---------- */
    function mk(px) { const c = document.createElement('canvas'); c.width = px; c.height = px; return c; }

    function fit() {
      const r = canvas.getBoundingClientRect();
      // 2x is retina-crisp for a soft, rounded art style and keeps phones at 60 fps (DPR 3 = 2.25x the pixels)
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let px = r.width > 0 ? Math.round(r.width * dpr) : (canvas.width || S);
      px = clamp(px, 288, 2304);
      if (px !== canvas.width || px !== canvas.height || !field) {
        canvas.width = px; canvas.height = px;
        k = px / S;
        buildCaches();
      }
    }

    function buildCaches() {
      field = mk(Math.round(S * k));
      const f = field.getContext('2d', { alpha: false }) || field.getContext('2d');
      f.setTransform(k, 0, 0, k, 0, 0);
      paintField(f);

      const as = Math.ceil(2 * C * k);
      appleSpr = mk(as);
      const a = appleSpr.getContext('2d');
      a.setTransform(as / (2 * C), 0, 0, as / (2 * C), 0, 0);
      paintApple(a);

      const gs = Math.ceil(2 * GLOW_R * k);
      glowSpr = mk(gs);
      const g = glowSpr.getContext('2d');
      g.setTransform(gs / (2 * GLOW_R), 0, 0, gs / (2 * GLOW_R), 0, 0);
      const rg = g.createRadialGradient(GLOW_R, GLOW_R, 0, GLOW_R, GLOW_R, GLOW_R);
      rg.addColorStop(0, 'rgba(255, 240, 170, 0.62)');
      rg.addColorStop(0.42, 'rgba(255, 214, 92, 0.24)');
      rg.addColorStop(1, 'rgba(255, 200, 80, 0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 2 * GLOW_R, 2 * GLOW_R);
    }

    function paintField(f) {
      const r = prng(0xC0FFEE);
      // base lawn: lit centre falling into a deep forest edge (cover radial)
      const base = f.createRadialGradient(S * 0.5, S * 0.4, 0, S * 0.5, S * 0.42, S * 0.8);
      base.addColorStop(0, '#5fae44');
      base.addColorStop(0.55, '#3f8b39');
      base.addColorStop(1, '#194a28');
      f.fillStyle = base;
      f.fillRect(0, 0, S, S);
      // checker + per-cell tonal jitter (organic, never flat)
      for (let y = 0; y < G; y++) {
        for (let x = 0; x < G; x++) {
          const j = r() * 0.05 - 0.025;
          const dark = ((x + y) & 1) ? 0.1 : 0;
          const a = dark + (j < 0 ? -j : 0);
          if (a > 0) { f.fillStyle = 'rgba(6, 30, 12,' + a.toFixed(3) + ')'; f.fillRect(x * C, y * C, C, C); }
          if (j > 0) { f.fillStyle = 'rgba(230, 255, 180,' + (j * 0.9).toFixed(3) + ')'; f.fillRect(x * C, y * C, C, C); }
        }
      }
      // soft bevel on light cells: a faint top-left lip
      f.fillStyle = 'rgba(255, 255, 255, 0.045)';
      for (let y = 0; y < G; y++) for (let x = (y & 1); x < G; x += 2) { f.fillRect(x * C, y * C, C, 1.2); f.fillRect(x * C, y * C, 1.2, C); }
      // grass blades
      f.lineCap = 'round';
      f.lineWidth = 1;
      f.beginPath();
      for (let i = 0; i < G * G * 3; i++) {
        const x = r() * S, y = r() * S, l = 1.6 + r() * 2.8, an = -Math.PI / 2 + (r() - 0.5) * 1.0;
        f.moveTo(x, y); f.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l);
      }
      f.strokeStyle = 'rgba(214, 255, 160, 0.11)';
      f.stroke();
      f.beginPath();
      for (let i = 0; i < G * G * 3; i++) {
        const x = r() * S, y = r() * S, l = 1.6 + r() * 2.8, an = -Math.PI / 2 + (r() - 0.5) * 1.0;
        f.moveTo(x, y); f.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l);
      }
      f.strokeStyle = 'rgba(8, 42, 16, 0.17)';
      f.stroke();
      // the cover's dot pattern, as tiny studs on the grid intersections
      f.beginPath();
      for (let y = 1; y < G; y++) for (let x = 1; x < G; x++) { f.moveTo(x * C + 0.95, y * C); f.arc(x * C, y * C, 0.95, 0, TAU); }
      f.fillStyle = 'rgba(255, 255, 255, 0.13)';
      f.fill();
      // a few tiny clover flowers
      for (let i = 0; i < 22; i++) {
        const cx = (Math.floor(r() * G) + 0.2 + r() * 0.6) * C, cy = (Math.floor(r() * G) + 0.2 + r() * 0.6) * C;
        f.fillStyle = r() < 0.5 ? 'rgba(255, 246, 229, 0.30)' : 'rgba(255, 216, 74, 0.26)';
        for (let p = 0; p < 4; p++) { const an = p * TAU / 4 + 0.4; f.beginPath(); f.arc(cx + Math.cos(an) * 1.3, cy + Math.sin(an) * 1.3, 1.05, 0, TAU); f.fill(); }
      }
      // light pool + vignette (cover)
      const sun = f.createRadialGradient(S * 0.36, S * 0.26, 0, S * 0.36, S * 0.26, S * 0.55);
      sun.addColorStop(0, 'rgba(255, 255, 220, 0.09)');
      sun.addColorStop(1, 'rgba(255, 255, 220, 0)');
      f.fillStyle = sun; f.fillRect(0, 0, S, S);
      const vig = f.createRadialGradient(S * 0.5, S * 0.46, S * 0.3, S * 0.5, S * 0.46, S * 0.78);
      vig.addColorStop(0, 'rgba(3, 12, 6, 0)');
      vig.addColorStop(1, 'rgba(3, 12, 6, 0.40)');
      f.fillStyle = vig; f.fillRect(0, 0, S, S);
      // inner rim: depth at the screen edge
      f.lineWidth = 3;
      f.strokeStyle = 'rgba(0, 0, 0, 0.28)';
      f.strokeRect(1.5, 1.5, S - 3, S - 3);
      f.lineWidth = 1;
      f.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      f.beginPath(); f.moveTo(3.5, 3.5); f.lineTo(S - 3.5, 3.5); f.stroke();
    }

    function applePath(g, cx, cy, r) {
      g.beginPath();
      g.moveTo(cx, cy - r * 0.66);
      g.bezierCurveTo(cx + r * 0.5, cy - r * 1.12, cx + r * 1.12, cy - r * 0.74, cx + r * 1.03, cy + r * 0.06);
      g.bezierCurveTo(cx + r * 0.96, cy + r * 0.74, cx + r * 0.52, cy + r * 1.06, cx + r * 0.17, cy + r * 0.98);
      g.quadraticCurveTo(cx, cy + r * 0.9, cx - r * 0.17, cy + r * 0.98);
      g.bezierCurveTo(cx - r * 0.52, cy + r * 1.06, cx - r * 0.96, cy + r * 0.74, cx - r * 1.03, cy + r * 0.06);
      g.bezierCurveTo(cx - r * 1.12, cy - r * 0.74, cx - r * 0.5, cy - r * 1.12, cx, cy - r * 0.66);
      g.closePath();
    }

    function paintApple(g) {
      const cx = C, cy = C + 1.5, r = C * 0.385;
      g.lineCap = 'round'; g.lineJoin = 'round';
      // stem
      g.beginPath(); g.moveTo(cx - 0.4, cy - r * 0.5); g.quadraticCurveTo(cx + 0.3, cy - r * 1.3, cx + r * 0.6, cy - r * 1.62);
      g.strokeStyle = INK; g.lineWidth = 3.2; g.stroke();
      g.strokeStyle = '#8a5a32'; g.lineWidth = 1.2; g.stroke();
      // body: ink outline then gradient fill
      applePath(g, cx, cy, r);
      g.strokeStyle = INK; g.lineWidth = 4.2; g.stroke();
      const grd = g.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.08, cx, cy, r * 1.15);
      grd.addColorStop(0, '#ffa08e'); grd.addColorStop(0.38, '#ff4d4d'); grd.addColorStop(1, '#b9183a');
      g.fillStyle = grd; g.fill();
      // bounce light at the bottom right
      g.save(); applePath(g, cx, cy, r); g.clip();
      g.beginPath(); g.arc(cx + r * 0.35, cy + r * 0.45, r * 0.85, -0.2, 1.9);
      g.strokeStyle = 'rgba(255, 140, 120, 0.35)'; g.lineWidth = 1.6; g.stroke();
      g.restore();
      // cream highlight (cover's swoosh) + glint
      g.beginPath(); g.arc(cx, cy, r * 0.62, Math.PI * 1.08, Math.PI * 1.42);
      g.strokeStyle = CREAM; g.lineWidth = 2.1; g.stroke();
      g.beginPath(); g.arc(cx - r * 0.08, cy - r * 0.66, 0.95, 0, TAU); g.fillStyle = CREAM; g.fill();
      // leaf
      g.save();
      g.translate(cx + r * 0.62, cy - r * 1.28);
      g.rotate(-0.42);
      g.beginPath();
      g.moveTo(-r * 0.62, 0);
      g.quadraticCurveTo(0, -r * 0.5, r * 0.62, 0);
      g.quadraticCurveTo(0, r * 0.5, -r * 0.62, 0);
      g.closePath();
      g.strokeStyle = INK; g.lineWidth = 2.4; g.stroke();
      g.fillStyle = LEAF; g.fill();
      g.beginPath(); g.moveTo(-r * 0.4, 0); g.lineTo(r * 0.4, 0);
      g.strokeStyle = 'rgba(20, 90, 30, 0.55)'; g.lineWidth = 0.9; g.stroke();
      g.restore();
    }

    if (typeof ResizeObserver === 'function') {
      try { new ResizeObserver(() => fit()).observe(canvas); } catch (_) { /* fall back to resize */ }
    }
    window.addEventListener('resize', fit);
    fit();

    /* ---------- fx pools ---------- */
    function spawn(kind, x, y, vx, vy, life, r, col, g, drag, now) {
      for (let i = 0; i < PN; i++) {
        const p = parts[i];
        if (p.on) continue;
        p.on = true; p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
        p.life = life; p.r = r; p.col = col; p.g = g; p.drag = drag; p.t0 = now;
        return;
      }
    }
    function ring(x, y, r0, r1, dur, w, col, now) {
      for (let i = 0; i < rings.length; i++) {
        const q = rings[i];
        if (q.on) continue;
        q.on = true; q.x = x; q.y = y; q.r0 = r0; q.r1 = r1; q.dur = dur; q.w = w; q.col = col; q.t0 = now;
        return;
      }
    }
    function pop(x, y, now) {
      let best = pops[0];
      for (let i = 0; i < pops.length; i++) { if (!pops[i].on) { best = pops[i]; break; } if (pops[i].t0 < best.t0) best = pops[i]; }
      best.on = true; best.x = x; best.y = y; best.t0 = now;
    }
    function bulge(now) {
      for (let i = 0; i < bulges.length; i++) { if (!bulges[i].on) { bulges[i].on = true; bulges[i].t0 = now; return; } }
    }
    function resetFx() {
      for (let i = 0; i < PN; i++) parts[i].on = false;
      for (let i = 0; i < rings.length; i++) rings[i].on = false;
      for (let i = 0; i < pops.length; i++) pops[i].on = false;
      for (let i = 0; i < bulges.length; i++) bulges[i].on = false;
      shakeAt = -1e9;
    }

    function burstEat(now) {
      eatPending = false;
      const x = eatX * C + C / 2, y = eatY * C + C / 2;
      if (restDX === 0) pop(x + (eatX > G - 3 ? -1.05 : 1.05) * C, y + C * 0.35, now);
      else pop(x, y, now);
      if (rm) { ring(x, y, C * 0.62, C * 0.62, 320, 3, CREAM, now); return; }
      for (let i = 0; i < 12; i++) {
        const an = R() * TAU, sp = 60 + R() * 120;
        spawn(0, x, y, Math.cos(an) * sp, Math.sin(an) * sp - 30, 380 + R() * 260, 1.4 + R() * 1.8, JUICE[i & 3], 260, 2.2, now);
      }
      for (let i = 0; i < 3; i++) {
        const an = -Math.PI / 2 + (R() - 0.5) * 2.2, sp = 50 + R() * 70;
        spawn(0, x, y, Math.cos(an) * sp, Math.sin(an) * sp, 520 + R() * 200, 1.6 + R(), LEAF, 220, 2, now);
      }
      for (let i = 0; i < 5; i++) {
        const an = R() * TAU, sp = 40 + R() * 70;
        spawn(1, x, y, Math.cos(an) * sp, Math.sin(an) * sp, 420 + R() * 260, 2.6 + R() * 2, i === 0 ? accent : (i & 1 ? LEMON : CREAM), 0, 3, now);
      }
      ring(x, y, C * 0.3, C * 1.15, 380, 3.2, 'rgba(255, 236, 160, 0.9)', now);
      bulge(now);
    }

    function onDeath(now) {
      deathAt = now;
      puffIdx = 0;
      eatPending = false;
      for (let i = 0; i < bulges.length; i++) bulges[i].on = false;
      if (rm) return;
      shakeAt = now;
      // impact point: the front of the head, toward what it hit
      const lx = local(PX[0] + crashDX * C * 0.55), ly = local(PY[0] + crashDY * C * 0.55);
      for (let i = 0; i < 9; i++) {
        const an = R() * TAU, sp = 70 + R() * 110;
        spawn(1, lx, ly, Math.cos(an) * sp, Math.sin(an) * sp, 380 + R() * 240, 2.4 + R() * 2.2, i & 1 ? LEMON : CREAM, 0, 3.2, now);
      }
      ring(lx, ly, C * 0.2, C * 1.0, 300, 3, 'rgba(255, 246, 229, 0.9)', now);
    }

    function local(v) { return v - Math.floor(v / S) * S; }
    function wrapD(a, b) { let d = b - a; if (d > 1) d -= G; else if (d < -1) d += G; return d; }
    function wrapFar(a, b) { let d = ((b - a) % G + G) % G; if (d > G / 2) d -= G; return d; }

    function track(now, snake, food, dir, over) {
      if (snake !== snakeRef) {
        snakeRef = snake; hasPrev = false; grew = false; stepCount = 0;
        resetFx(); eatPending = false; deathAt = 0; wasOver = over; mouth = 0;
        headRef = snake.length ? snake[0] : null; lastLen = snake.length;
        if (snake.length) { lastTailX = snake[snake.length - 1].x; lastTailY = snake[snake.length - 1].y; }
      } else if (snake.length && snake[0] !== headRef) {
        const one = snake[1] === headRef;
        hasPrev = one; grew = one && snake.length > lastLen;
        prevTailX = lastTailX; prevTailY = lastTailY;
        stepCount++;
        if (eatPending) burstEat(now);
        if (snake.length > lastLen) {
          eatPending = true; eatX = snake[0].x; eatY = snake[0].y;
          if (rm || !one) burstEat(now);
        }
        headRef = snake[0]; lastLen = snake.length;
        lastTailX = snake[snake.length - 1].x; lastTailY = snake[snake.length - 1].y;
      }
      if (food && (food.x !== foodX || food.y !== foodY)) { foodX = food.x; foodY = food.y; foodBorn = now; }
      if (dir) { restDX = dir.x; restDY = dir.y; }
      if (over && !wasOver) { crashDX = dir ? dir.x : 0; crashDY = dir ? dir.y : 0; wasOver = true; return true; }
      wasOver = over;
      return false;
    }

    /* ---------- path ---------- */
    function buildPath(snake, e) {
      NR = 0; NP = 0; LEN = 0; NCELL = 0;
      const n = snake.length;
      if (!n) return;
      const s0 = snake[0];
      const ax = s0.x * C + C / 2, ay = s0.y * C + C / 2;
      const moving = hasPrev && n > 1 && e < 1;
      let fdx = restDX, fdy = restDY;
      if (n > 1) { fdx = wrapD(snake[1].x, s0.x); fdy = wrapD(snake[1].y, s0.y); }
      if (moving) { RX[0] = ax - fdx * C * (1 - e); RY[0] = ay - fdy * C * (1 - e); }
      else { RX[0] = ax; RY[0] = ay; }
      NR = 1;
      let px = ax, py = ay;
      for (let i = 1; i < n && NR < MAXP - 2; i++) {
        px += wrapD(snake[i - 1].x, snake[i].x) * C;
        py += wrapD(snake[i - 1].y, snake[i].y) * C;
        RX[NR] = px; RY[NR] = py; NR++;
      }
      NCELL = NR;
      if (moving && !grew && 1 - e > 0.002) {
        const tl = snake[n - 1];
        RX[NR] = px + wrapD(tl.x, prevTailX) * C * (1 - e);
        RY[NR] = py + wrapD(tl.y, prevTailY) * C * (1 - e);
        NR++;
      }
      smooth();
      // head angle: turn smoothly through a corner during the first part of the glide
      const aNow = Math.atan2(fdy, fdx);
      headAng = aNow;
      if (moving && n > 2) {
        const pdx = wrapD(snake[2].x, snake[1].x), pdy = wrapD(snake[2].y, snake[1].y);
        if (pdx !== fdx || pdy !== fdy) {
          const aPrev = Math.atan2(pdy, pdx);
          let da = aNow - aPrev;
          while (da > Math.PI) da -= TAU;
          while (da < -Math.PI) da += TAU;
          const u = clamp(e * 2.2, 0, 1);
          headAng = aPrev + da * (u * u * (3 - 2 * u));
        }
      }
    }
    /* raw grid polyline -> centreline with every 90-degree turn replaced by a circular arc
       (radius up to half a cell), so the body bends like a tube instead of a pipe */
    function smooth() {
      NP = 0;
      if (NR < 1) return;
      PX[0] = RX[0]; PY[0] = RY[0]; DOTI[0] = 0; NP = 1;
      for (let i = 1; i < NR - 1; i++) {
        const ax = RX[i] - RX[i - 1], ay = RY[i] - RY[i - 1];
        const bx = RX[i + 1] - RX[i], by = RY[i + 1] - RY[i];
        const la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
        let r = 0;
        if (la > 0.01 && lb > 0.01 && Math.abs(ax * by - ay * bx) > 0.01 * la * lb) {
          r = Math.min(RC, i === 1 ? la : la * 0.5, i + 1 === NR - 1 ? lb : lb * 0.5);
        }
        if (r < 0.6) { DOTI[i] = NP; PX[NP] = RX[i]; PY[NP] = RY[i]; NP++; continue; }
        const uax = ax / la, uay = ay / la, ubx = bx / lb, uby = by / lb;
        const kx = RX[i] - uax * r + ubx * r, ky = RY[i] - uay * r + uby * r;   // arc centre
        for (let j = 0; j <= ARC_N; j++) {
          PX[NP] = kx + r * (-ubx * ARC_C[j] + uax * ARC_S[j]);
          PY[NP] = ky + r * (-uby * ARC_C[j] + uay * ARC_S[j]);
          if (j === ARC_N / 2) DOTI[i] = NP;
          NP++;
        }
      }
      if (NR > 1) { DOTI[NR - 1] = NP; PX[NP] = RX[NR - 1]; PY[NP] = RY[NR - 1]; NP++; }
    }
    function measure() {
      CUM[0] = 0;
      for (let i = 1; i < NP; i++) {
        const dx = PX[i] - PX[i - 1], dy = PY[i] - PY[i - 1];
        CUM[i] = CUM[i - 1] + Math.sqrt(dx * dx + dy * dy);
      }
      LEN = NP ? CUM[NP - 1] : 0;
    }
    function sampleAt(s) {
      if (NP < 2 || s <= 0) { SX = PX[0]; SY = PY[0]; return; }
      if (s >= LEN) s = LEN - 0.0001;
      let lo = 0, hi = NP - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (CUM[m] <= s) lo = m; else hi = m; }
      const seg = CUM[hi] - CUM[lo];
      const u = seg > 0 ? (s - CUM[lo]) / seg : 0;
      SX = PX[lo] + (PX[hi] - PX[lo]) * u;
      SY = PY[lo] + (PY[hi] - PY[lo]) * u;
      if (seg > 0.0001) { TGX = (PX[hi] - PX[lo]) / seg; TGY = (PY[hi] - PY[lo]) / seg; }
    }
    function slice(a, b) {
      NQ = 0;
      if (b - a < 0.01 || NP < 2) return;
      sampleAt(a); QX[0] = SX; QY[0] = SY; NQ = 1;
      for (let i = 1; i < NP - 1; i++) {
        if (CUM[i] > a && CUM[i] < b) { QX[NQ] = PX[i]; QY[NQ] = PY[i]; NQ++; }
      }
      sampleAt(b); QX[NQ] = SX; QY[NQ] = SY; NQ++;
    }
    /* stroke the current slice; it is unwrapped, so split it into runs per board tile */
    function strokeQ(width, color, ox, oy) {
      if (NQ < 2) return;
      ctx.lineWidth = width; ctx.strokeStyle = color;
      ctx.beginPath();
      let tx = Math.floor(QX[0] / S), ty = Math.floor(QY[0] / S);
      ctx.moveTo(QX[0] - tx * S + ox, QY[0] - ty * S + oy);
      for (let i = 1; i < NQ; i++) {
        const nx = Math.floor(QX[i] / S), ny = Math.floor(QY[i] / S);
        if (nx !== tx || ny !== ty) {
          ctx.lineTo(QX[i] - tx * S + ox, QY[i] - ty * S + oy);
          ctx.moveTo(QX[i - 1] - nx * S + ox, QY[i - 1] - ny * S + oy);
          tx = nx; ty = ny;
        }
        ctx.lineTo(QX[i] - tx * S + ox, QY[i] - ty * S + oy);
      }
      ctx.stroke();
    }
    /* offsets at which something of radius r around unwrapped (x, y) shows on the board.
       Duplicates on the far edge are drawn only while the anchor (ax, ay) is inside the
       half-cell crossing zone, so a head resting in an edge cell never leaks a sliver. */
    function offsets(x, y, r, ax, ay) {
      const lx = local(x), ly = local(y);
      let cx = true, cy = true;
      if (ax !== undefined) {
        const zx = local(ax), zy = local(ay);
        cx = zx < C * 0.5 - 0.01 || zx > S - C * 0.5 + 0.01;
        cy = zy < C * 0.5 - 0.01 || zy > S - C * 0.5 + 0.01;
      }
      const ex = !cx ? 0 : (lx < r ? S : (lx > S - r ? -S : 0));
      const ey = !cy ? 0 : (ly < r ? S : (ly > S - r ? -S : 0));
      OFX[0] = lx; OFY[0] = ly; NOF = 1;
      if (ex) { OFX[NOF] = lx + ex; OFY[NOF] = ly; NOF++; }
      if (ey) { OFX[NOF] = lx; OFY[NOF] = ly + ey; NOF++; }
      if (ex && ey) { OFX[NOF] = lx + ex; OFY[NOF] = ly + ey; NOF++; }
    }
    function addDisc(x, y, r) {
      offsets(x, y, r + 1, x, y);
      for (let i = 0; i < NOF; i++) { ctx.moveTo(OFX[i] + r, OFY[i]); ctx.arc(OFX[i], OFY[i], r, 0, TAU); }
    }
    /* discs (tail taper + bulges) for one layer; sel: 0 = all, 1 = live part only, 2 = dead part only */
    function fillDiscs(scale, add, ox, oy, color, sel, lg) {
      ctx.fillStyle = color;
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < ND; i++) {
        if (sel === 1 && DSS[i] < lg) continue;
        if (sel === 2 && DSS[i] >= lg) continue;
        const r = DR[i] * scale + add;
        const f = DR[i] / HW;
        addDisc(DX[i] + ox * f, DYY[i] + oy * f, r);
        any = true;
      }
      if (any) ctx.fill();
    }

    /* tail taper: one polygon per layer (no overlapping alpha, no beading) */
    function buildTaper(Lb, taper) {
      NT = 0;
      if (taper < 0.5 || NP < 2) return;
      const steps = Math.min(TMAX - 1, Math.max(4, Math.ceil(taper / 2.4)));
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let j = 0; j <= steps; j++) {
        const sp = Lb + taper * j / steps;
        sampleAt(sp);
        TSX[NT] = SX; TSY[NT] = SY; TNX[NT] = -TGY; TNY[NT] = TGX; TR[NT] = bodyRadius(sp, Lb, taper); NT++;
        if (SX < x0) x0 = SX; if (SX > x1) x1 = SX; if (SY < y0) y0 = SY; if (SY > y1) y1 = SY;
      }
      TCX = (x0 + x1) / 2; TCY = (y0 + y1) / 2;
      TRAD = Math.max(x1 - x0, y1 - y0) / 2 + HW + IW + 6;
      TSPAN = Math.floor(x0 / S) !== Math.floor(x1 / S) || Math.floor(y0 / S) !== Math.floor(y1 / S);
    }
    function fillTaper(scale, add, ox, oy, scaleOff, color) {
      if (NT < 2) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (TSPAN) offsets(TCX, TCY, TRAD);   // crossing an edge: draw on both sides
      else { OFX[0] = local(TSX[0]) - TSX[0] + TCX; OFY[0] = local(TSY[0]) - TSY[0] + TCY; NOF = 1; }
      for (let o = 0; o < NOF; o++) {
        const sx = OFX[o] - TCX, sy = OFY[o] - TCY;
        for (let j = 0; j < NT; j++) {
          const r = TR[j] * scale + add, f = scaleOff ? TR[j] / HW : 1;
          const x = TSX[j] + TNX[j] * r + ox * f + sx, y = TSY[j] + TNY[j] * r + oy * f + sy;
          if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        const e = NT - 1, r = TR[e] * scale + add, f = scaleOff ? TR[e] / HW : 1;
        const an = Math.atan2(TNY[e], TNX[e]);
        ctx.arc(TSX[e] + ox * f + sx, TSY[e] + oy * f + sy, r, an, an - Math.PI, true);
        for (let j = NT - 1; j >= 0; j--) {
          const r2 = TR[j] * scale + add, f2 = scaleOff ? TR[j] / HW : 1;
          ctx.lineTo(TSX[j] - TNX[j] * r2 + ox * f2 + sx, TSY[j] - TNY[j] * r2 + oy * f2 + sy);
        }
        ctx.closePath();
      }
      ctx.fill();
    }

    /* ---------- drawing ---------- */
    function drawFood(now) {
      if (foodX < 0) return;
      const cx = foodX * C + C / 2, cy = foodY * C + C / 2;
      const age = now - foodBorn;
      let sc = 1, al = 1;
      if (age < 360) { const u = clamp(age / 360, 0, 1); if (rm) al = u; else sc = Math.max(0.01, easeOutBack(u)); }
      const bob = rm ? 0 : Math.sin(now * 0.0044 + foodX * 1.7 + foodY);
      const lift = 2.2 + bob * 1.7;
      const pulse = rm ? 0.85 : 0.72 + 0.28 * Math.sin(now * 0.0031);
      ctx.globalAlpha = al * pulse * Math.min(1, sc);
      ctx.drawImage(glowSpr, cx - GLOW_R, cy - GLOW_R, GLOW_R * 2, GLOW_R * 2);
      ctx.globalAlpha = al;
      ctx.fillStyle = 'rgba(4, 20, 9, 0.36)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + C * 0.36, C * 0.3 * sc * (1 - bob * 0.07), C * 0.1 * sc, 0, 0, TAU);
      ctx.fill();
      ctx.drawImage(appleSpr, cx - C * sc, cy - C * sc - lift, C * 2 * sc, C * 2 * sc);
      ctx.globalAlpha = 1;
    }
    function drawEaten(e) {
      if (!eatPending) return;
      const cx = eatX * C + C / 2, cy = eatY * C + C / 2;
      const sc = 1 - e * 0.45;
      ctx.drawImage(appleSpr, cx - C * sc, cy - C * sc - 2, C * 2 * sc, C * 2 * sc);
    }

    function bodyRadius(s, Lb, taper) {
      if (s <= Lb || taper <= 0) return HW;
      const u = clamp((s - Lb) / taper, 0, 1);
      return HW * (1 - 0.64 * Math.pow(u, 1.25));
    }

    function drawSnake(now, dead) {
      if (NP < 1) return;
      const taper = Math.min(C * 2.4, LEN * 0.6);
      const Lb = LEN - taper;
      // how far the colour has drained (death ripple, head -> tail)
      let lg = 0;
      if (dead) {
        if (rm) lg = LEN + 1;
        else lg = clamp((now - deathAt - 130) * Math.max(0.35, LEN / 520), 0, LEN + 1);
      }
      const tailDead = lg > Lb + taper * 0.5;
      buildTaper(Lb, taper);
      // gulp bulges (discs riding along the body)
      ND = 0;
      if (!dead) {
        const sp = Math.max(0.3, LEN / 900);
        for (let b = 0; b < bulges.length; b++) {
          const q = bulges[b];
          if (!q.on) continue;
          const d = C * 0.55 + (now - q.t0) * sp;
          if (d > LEN - C * 0.4) { q.on = false; continue; }
          const grow = clamp((now - q.t0) / 120, 0, 1);
          for (let j = -1; j <= 1 && ND < DMAX; j++) {
            const s = d + j * 5;
            if (s < 0 || s > LEN) continue;
            sampleAt(s);
            const f = j === 0 ? 1.28 : 1.14;
            DX[ND] = SX; DYY[ND] = SY; DR[ND] = bodyRadius(s, Lb, taper) * (1 + (f - 1) * grow); DSS[ND] = s; ND++;
          }
        }
      }
      const bodyEnd = Math.max(0, Lb);
      const lgS = Math.min(lg, bodyEnd);
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round';

      // 1) soft shadow (body, taper and head; each a single fill so alpha never stacks)
      slice(0, bodyEnd);
      strokeQ(W + IW * 2 + 2.5, SHADOW, 1.4, 3.4);
      fillTaper(1, IW + 1.25, 1.4, 3.4, false, SHADOW);
      headShadow(now, dead);

      // 2) ink outline
      slice(0, bodyEnd);
      strokeQ(W + IW * 2, INK, 0, 0);
      fillTaper(1, IW, 0, 0, false, INK);
      fillDiscs(1, IW, 0, 0, INK, 0, 0);

      // 3..5) shaded body: base, rounded mid tone, highlight
      layer(W, 1, 0, 0, 'base', lgS, bodyEnd, lg, tailDead);
      layer(W * 0.68, 0.68, -0.9, -1.4, 'mid', lgS, bodyEnd, lg, tailDead);
      layer(W * 0.24, 0.24, -2.0, -3.0, 'hi', lgS, bodyEnd, lg, tailDead);

      // 6) bead markings at the cell centres (the cover's dotted line)
      dots(true, lg, Lb, taper);
      if (lg > 0) dots(false, lg, Lb, taper);
    }
    function layer(width, scale, ox, oy, key, lgS, bodyEnd, lg, tailDead) {
      if (lg > 0) {
        slice(0, lgS); strokeQ(width, DEAD[key], ox, oy);
        slice(lgS, bodyEnd); strokeQ(width, LIVE[key], ox, oy);
      } else {
        slice(0, bodyEnd); strokeQ(width, LIVE[key], ox, oy);
      }
      fillTaper(scale, 0, ox, oy, true, tailDead ? DEAD[key] : LIVE[key]);
      if (ND) {
        if (key === 'hi') {
          // one glint on each bulge instead of a beaded stripe
          ctx.fillStyle = LIVE.hi;
          ctx.beginPath();
          for (let i = 1; i < ND; i += 3) addDisc(DX[i] + ox * 1.25, DYY[i] + oy * 1.25, DR[i] * 0.3);
          ctx.fill();
        } else {
          fillDiscs(scale, 0, ox, oy, LIVE[key], 0, 0);
        }
      }
    }
    function dots(live, lg, Lb, taper) {
      ctx.fillStyle = live ? LIVE.dot : DEAD.dot;
      ctx.beginPath();
      let any = false;
      for (let i = 1; i < NCELL; i++) {
        const pi = DOTI[i], s = CUM[pi];
        if (s > LEN - 4) break;
        if (live ? s < lg : s >= lg) continue;
        const r = C * 0.085 * (bodyRadius(s, Lb, taper) / HW) * (((stepCount - i) & 1) ? 0.8 : 1);
        addDisc(PX[pi] - 0.9, PY[pi] - 1.4, r);
        any = true;
      }
      if (any) ctx.fill();
    }

    /* ---------- head ---------- */
    let lookX = 1, lookY = 0;
    function headCenter(now, dead) {
      let x = PX[0], y = PY[0];
      if (dead && !rm) {
        // bonk: lunge into what it hit, then spring back
        const t = now - deathAt;
        let l = 0;
        if (t < 80) l = 0.3 * (t / 80);
        else l = 0.3 * Math.exp(-(t - 80) / 85) * Math.cos((t - 80) / 48);
        x += crashDX * C * l; y += crashDY * C * l;
      }
      SX = x + Math.cos(headAng) * C * 0.07;
      SY = y + Math.sin(headAng) * C * 0.07;
    }
    function headShadow(now, dead) {
      if (NP < 1) return;
      headCenter(now, dead);
      offsets(SX, SY, HRX + IW + 4, PX[0], PY[0]);
      ctx.fillStyle = SHADOW;
      ctx.beginPath();
      for (let i = 0; i < NOF; i++) {
        ctx.moveTo(OFX[i] + 1.4 + HRX + IW, OFY[i] + 3.4);
        ctx.ellipse(OFX[i] + 1.4, OFY[i] + 3.4, HRX + IW + 0.6, HRY + IW + 0.6, headAng, 0, TAU);
      }
      ctx.fill();
    }
    function drawHeads(now, dead, snake) {
      if (NP < 1) return;
      // tongue flick / blink scheduling (visual RNG only)
      if (now > blinkNext) { blinkAt = now; blinkNext = now + (R() < 0.22 ? 260 : 2200 + R() * 3200); }
      if (now > tongueNext) { tongueAt = now; tongueNext = now + 1700 + R() * 2600; }
      // mouth opens when the apple is just ahead (logical head + direction)
      let want = 0;
      if (!dead && snake.length > 0 && foodX >= 0) {
        const h = snake[0];
        const dx = wrapFar(h.x, foodX), dy = wrapFar(h.y, foodY);
        const along = dx * restDX + dy * restDY, side = dx * restDY - dy * restDX;
        if (side === 0 && along >= 1 && along <= 2) want = 1;
      }
      if (eatPending) want = 1;
      mouth = rm ? want : mouth + (want - mouth) * 0.28;
      // glance toward the apple
      const fx = Math.cos(headAng), fy = Math.sin(headAng);
      let ax = fx, ay = fy;
      if (foodX >= 0 && snake.length) {
        const h = snake[0];
        let dx = wrapFar(h.x, foodX), dy = wrapFar(h.y, foodY);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0) { dx /= d; dy /= d; ax = fx * 0.55 + dx * 0.45; ay = fy * 0.55 + dy * 0.45; }
      }
      const al = Math.sqrt(ax * ax + ay * ay) || 1;
      lookX += (ax / al - lookX) * 0.2; lookY += (ay / al - lookY) * 0.2;

      headCenter(now, dead);
      offsets(SX, SY, HRX + IW + C * 0.7, PX[0], PY[0]);
      for (let i = 0; i < NOF; i++) drawHead(OFX[i], OFY[i], now, dead);
    }
    function drawHead(x, y, now, dead) {
      const a = headAng, fx = Math.cos(a), fy = Math.sin(a), lx = -fy, ly = fx;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // tongue (under the head)
      let tl = 0, ta = 0;
      if (dead) { tl = C * 0.42; ta = 0.55; }
      else if (!rm && mouth < 0.3) { const u = (now - tongueAt) / 320; if (u >= 0 && u <= 1) tl = Math.sin(u * Math.PI) * C * 0.6; }
      if (tl > 0.5) {
        const ca = Math.cos(a + ta), sa = Math.sin(a + ta);
        const bx = x + fx * HRX * 0.8, by = y + fy * HRX * 0.8;
        const tx = bx + ca * tl, ty = by + sa * tl;
        const fl = Math.min(4.2, tl * 0.4);
        ctx.beginPath();
        ctx.moveTo(bx, by); ctx.lineTo(tx, ty);
        ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(a + ta + 0.55) * fl, ty + Math.sin(a + ta + 0.55) * fl);
        ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(a + ta - 0.55) * fl, ty + Math.sin(a + ta - 0.55) * fl);
        ctx.strokeStyle = INK; ctx.lineWidth = 3.6; ctx.stroke();
        ctx.strokeStyle = TONGUE; ctx.lineWidth = 1.7; ctx.stroke();
      }
      // ink + shaded head
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.ellipse(x, y, HRX + IW, HRY + IW, a, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = HEAD_LIVE;
      ctx.beginPath(); ctx.ellipse(0, 0, HRX, HRY, a, 0, TAU); ctx.fill();
      if (dead) {
        const m = rm ? 1 : clamp((now - deathAt - 80) / 180, 0, 1);
        if (m > 0) { ctx.globalAlpha = m; ctx.fillStyle = HEAD_DEAD; ctx.fill(); ctx.globalAlpha = 1; }
      }
      ctx.restore();
      // rosy cheeks
      if (!dead) {
        ctx.fillStyle = 'rgba(255, 120, 150, 0.28)';
        ctx.beginPath();
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const cx = x - fx * C * 0.1 + lx * sgn * C * 0.33, cy = y - fy * C * 0.1 + ly * sgn * C * 0.33;
          ctx.moveTo(cx + C * 0.09, cy); ctx.arc(cx, cy, C * 0.09, 0, TAU);
        }
        ctx.fill();
      }
      // mouth
      if (mouth > 0.04) {
        const mx = x + fx * HRX * 0.64, my = y + fy * HRX * 0.64;
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.ellipse(mx, my, HRX * 0.3 * mouth + 1.2, HRY * 0.56 * mouth + 1.2, a, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5a1430';
        ctx.beginPath(); ctx.ellipse(mx, my, HRX * 0.3 * mouth, HRY * 0.56 * mouth, a, 0, TAU); ctx.fill();
        ctx.fillStyle = TONGUE;
        ctx.beginPath(); ctx.ellipse(mx - fx * HRX * 0.08 * mouth, my - fy * HRX * 0.08 * mouth, HRX * 0.14 * mouth, HRY * 0.28 * mouth, a, 0, TAU); ctx.fill();
      } else if (!dead) {
        // nostrils
        ctx.fillStyle = 'rgba(27, 18, 48, 0.55)';
        ctx.beginPath();
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const nx = x + fx * HRX * 0.78 + lx * sgn * C * 0.09, ny = y + fy * HRX * 0.78 + ly * sgn * C * 0.09;
          ctx.moveTo(nx + 0.9, ny); ctx.arc(nx, ny, 0.9, 0, TAU);
        }
        ctx.fill();
      }
      // eyes
      const blink = !dead && now - blinkAt < 140;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const ex = x + fx * C * 0.1 + lx * sgn * C * 0.245, ey = y + fy * C * 0.1 + ly * sgn * C * 0.245;
        if (dead) {
          ctx.fillStyle = CREAM; ctx.strokeStyle = INK; ctx.lineWidth = 1.7;
          ctx.beginPath(); ctx.arc(ex, ey, ER, 0, TAU); ctx.fill(); ctx.stroke();
          const d = ER * 0.55;
          ctx.lineWidth = 1.9;
          ctx.beginPath();
          ctx.moveTo(ex - d, ey - d); ctx.lineTo(ex + d, ey + d);
          ctx.moveTo(ex + d, ey - d); ctx.lineTo(ex - d, ey + d);
          ctx.stroke();
        } else if (blink) {
          ctx.strokeStyle = INK; ctx.lineWidth = 1.9;
          ctx.beginPath();
          ctx.moveTo(ex - lx * ER * 0.9 + fx * 0.6, ey - ly * ER * 0.9 + fy * 0.6);
          ctx.quadraticCurveTo(ex - fx * ER * 0.7, ey - fy * ER * 0.7, ex + lx * ER * 0.9 + fx * 0.6, ey + ly * ER * 0.9 + fy * 0.6);
          ctx.stroke();
        } else {
          ctx.fillStyle = CREAM; ctx.strokeStyle = INK; ctx.lineWidth = 1.7;
          ctx.beginPath(); ctx.arc(ex, ey, ER, 0, TAU); ctx.fill(); ctx.stroke();
          const px = ex + lookX * ER * 0.4, py = ey + lookY * ER * 0.4;
          ctx.fillStyle = INK;
          ctx.beginPath(); ctx.arc(px, py, ER * 0.52, 0, TAU); ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(px - ER * 0.2, py - ER * 0.24, ER * 0.17, 0, TAU); ctx.fill();
        }
      }
    }
    function drawDizzy(now) {
      if (rm) return;
      const t = now - deathAt;
      if (t < 160) return;
      headCenter(now, true);
      const hx = local(SX), hy = local(SY);
      const above = hy > C * 1.3 ? -1 : 1;
      const fade = clamp((t - 160) / 200, 0, 1);
      ctx.globalAlpha = fade;
      for (let i = 0; i < 3; i++) {
        const an = now * 0.006 + i * TAU / 3;
        const x = hx + Math.cos(an) * C * 0.55, y = hy + above * C * 0.62 + Math.sin(an) * C * 0.18;
        star(x, y, C * 0.17, LEMON);
      }
      ctx.globalAlpha = 1;
    }
    function star(x, y, s, col) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const an = -Math.PI / 2 + i * Math.PI / 5, r = i & 1 ? s * 0.45 : s;
        if (i) ctx.lineTo(x + Math.cos(an) * r, y + Math.sin(an) * r); else ctx.moveTo(x + Math.cos(an) * r, y + Math.sin(an) * r);
      }
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = col; ctx.fill();
    }

    /* death ripple puffs: one soft puff per cell as the colour drains */
    function deathPuffs(now) {
      if (rm || NCELL < 1) return;
      const lg = (now - deathAt - 130) * Math.max(0.35, LEN / 520);
      while (puffIdx < NCELL && CUM[DOTI[puffIdx]] <= lg) {
        if ((puffIdx & 1) === 0) {
          const x = local(PX[DOTI[puffIdx]]), y = local(PY[DOTI[puffIdx]]);
          const an = R() * TAU;
          spawn(2, x, y, Math.cos(an) * 14, Math.sin(an) * 14 - 12, 520, C * 0.28, 'rgba(225, 235, 228, 0.55)', 0, 1.5, now);
          if ((puffIdx & 3) === 0) spawn(0, x, y, Math.cos(an) * 60, Math.sin(an) * 60 - 40, 480, 1.5, LEAF, 240, 2, now);
        }
        puffIdx++;
      }
    }

    function drawFx(now, dt) {
      for (let i = 0; i < PN; i++) {
        const p = parts[i];
        if (!p.on) continue;
        const u = (now - p.t0) / p.life;
        if (u >= 1) { p.on = false; continue; }
        const dr = Math.max(0, 1 - p.drag * dt);
        p.vx *= dr; p.vy = p.vy * dr + p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.kind === 0) {
          ctx.globalAlpha = 1 - u * u;
          ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - u * 0.5), 0, TAU); ctx.fill();
        } else if (p.kind === 1) {
          const s = p.r * (1 - u * 0.7);
          ctx.globalAlpha = 1 - u;
          ctx.fillStyle = p.col;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - s);
          ctx.quadraticCurveTo(p.x, p.y, p.x + s, p.y);
          ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s);
          ctx.quadraticCurveTo(p.x, p.y, p.x - s, p.y);
          ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s);
          ctx.fill();
        } else {
          ctx.globalAlpha = 1 - u;
          ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + u * 0.9), 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < rings.length; i++) {
        const q = rings[i];
        if (!q.on) continue;
        const u = (now - q.t0) / q.dur;
        if (u >= 1) { q.on = false; continue; }
        const e = easeOutCubic(u);
        ctx.globalAlpha = 1 - u;
        ctx.strokeStyle = q.col; ctx.lineWidth = Math.max(0.5, q.w * (1 - u * 0.7));
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r0 + (q.r1 - q.r0) * e, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (let i = 0; i < pops.length; i++) {
        const q = pops[i];
        if (!q.on) continue;
        const u = (now - q.t0) / 760;
        if (u >= 1) { q.on = false; continue; }
        const rise = rm ? 0 : easeOutCubic(Math.min(1, u * 1.4)) * C * 0.95;
        const sc = rm ? 1 : 0.7 + 0.3 * easeOutBack(Math.min(1, u * 3));
        const x = clamp(q.x, C * 0.8, S - C * 0.8), y = Math.max(C * 0.7, q.y - C * 0.55 - rise);
        ctx.globalAlpha = u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35;
        ctx.save();
        ctx.translate(x, y); ctx.scale(sc, sc);
        ctx.fillStyle = accent; ctx.fillText('+1', 0, 2.2);
        ctx.strokeStyle = INK; ctx.lineWidth = 3.4; ctx.strokeText('+1', 0, 0);
        ctx.fillStyle = CREAM; ctx.fillText('+1', 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    /* ---------- public ---------- */
    function draw(now, snake, food, dir, t, running, paused, over) {
      if (!field) fit();
      const dt = lastNow ? clamp((now - lastNow) / 1000, 0, 0.05) : 0.016;
      lastNow = now;
      snake = snake || [];
      const died = track(now, snake, food, dir, over);
      const e = (rm || !hasPrev || over) ? 1 : clamp(t, 0, 1);
      buildPath(snake, e);
      measure();
      if (died) onDeath(now);
      if (eatPending && (e >= 0.6 || over)) burstEat(now);

      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.globalAlpha = 1;
      let sx = 0, sy = 0;
      const st = now - shakeAt;
      if (!rm && st < 340) {
        const amp = 3 * Math.exp(-st / 110);
        sx = Math.sin(st * 0.11) * amp; sy = Math.cos(st * 0.137) * amp * 0.7;
      }
      if (sx || sy) {
        ctx.fillStyle = '#1d532b'; ctx.fillRect(0, 0, S, S);
        ctx.drawImage(field, sx - 4, sy - 4, S + 8, S + 8);
        ctx.translate(sx, sy);
      } else {
        ctx.drawImage(field, 0, 0, S, S);
      }
      drawFood(now);
      drawEaten(e);
      const dead = !!over && deathAt > 0;
      if (dead) deathPuffs(now);
      drawSnake(now, dead);
      drawHeads(now, dead, snake);
      if (dead) drawDizzy(now);
      drawFx(now, dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    return {
      draw: draw,
      resize: fit,
      deathHoldMs: function () { return rm ? 300 : 900; },
      reducedMotion: function () { return rm; }
    };
  }

  window.SnakeArt = { create: create, VERSION: 1 };
})();
