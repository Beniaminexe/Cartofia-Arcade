/* ==========================================================================
   Cartofia Maze Chase — board art  (window.MazeChaseArt)
   Pure presentation. It reads the game's state every frame and never writes
   it, so rules, speed, AI, timing, scoring and the game's Math.random()
   sequence stay in index.html untouched. Visual randomness comes from the
   private seeded PRNG below.

   The cover (assets/games/maze-chase.svg) come to life:
     - neon glass maze: the wall network becomes rounded glass tubes with a
       cyan neon rim, an inner glow and a top-left specular edge, painted once
       into offscreen canvases (a cyan set and a hot-pink "power" set that the
       board crossfades to while the hero is powered up)
     - Spud, a golden potato hero with a sprout, who glides between tiles,
       waddles, looks where he is going and munches pellets
     - four chaser critters (antenna, horns, spikes, ears) that hop tile to
       tile and watch the hero. Powered up, they turn pale and scared (shape
       cues: worried brows, "o" mouth, drooping headgear, sweat drop); in the
       last two seconds they flash back to their own colour as a warning, and
       a power meter in the top wall runs down
     - pellets with a soft glow, glossy pink power orbs with a pulsing halo
     - effects: munch sparkles, power shockwave, critter poof + respawn pop,
       "mashed" death where the hero was actually caught, level-clear party
   Effects come from the frame's final state (pellet diffs, positions) plus two
   one-line hooks from the game for things it resets in the same tick
   (a catch and an eaten critter), so they always play where they happened.

   DPR-aware (backing store follows the CSS size x devicePixelRatio, capped at 2x).
   prefers-reduced-motion: no gliding, hopping, bobbing, particles or shake;
   changes become instant or short fades, the power warning fades instead of flashing.

   const art = MazeChaseArt.create(canvas, { tile, cols, rows, powerMs, graceMs });
   art.draw(now, view)                  every frame (view: map, pellets, player,
                                        ghosts, frightMs, graceMs, running, paused,
                                        gameOver, won, pf = player step fraction)
   art.event('caught', ghostIndex, x, y)   the hero was caught on tile x,y
   art.event('eat', ghostIndex, x, y)      a scared critter was eaten on tile x,y
   art.deathHoldMs() / art.clearHoldMs()   time to let the end animation play
   ========================================================================== */
(function () {
  'use strict';
  if (window.MazeChaseArt) return;

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutBack = (t) => { const u = t - 1; return 1 + 2.70158 * u * u * u + 1.70158 * u * u; };
  const easeOutCubic = (t) => { const u = 1 - t; return 1 - u * u * u; };
  const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
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

  /* ---------- palette (from the cover + Night Market tokens) ---------- */
  const INK = '#1b1230';
  const CREAM = '#fff6e5';
  const LEMON = '#ffcf5c';
  const MINT = '#3ee6a6';
  const CORAL = '#ff6b4a';
  const PINK = '#ff7ad9';
  const NEON = {   // the cover's cyan maze
    f0: '#211d5e', f1: '#110e34', f2: '#07061a', dot: 'rgba(170, 200, 255, 0.11)', tile: 'rgba(120, 140, 255, 0.035)',
    glow: 'rgba(56, 189, 248, 0.95)', rim: '#8fdcff', glass0: '#17205a', glass1: '#0b0f33',
    inner: 'rgba(56, 189, 248, 0.85)', spec: 'rgba(225, 248, 255, 0.62)'
  };
  const HOT = {    // power mode: the orb's pink takes over the neon
    f0: '#2f1660', f1: '#170b38', f2: '#09051c', dot: 'rgba(255, 180, 240, 0.11)', tile: 'rgba(255, 120, 230, 0.035)',
    glow: 'rgba(255, 79, 216, 0.95)', rim: '#ffa6ec', glass0: '#3a1258', glass1: '#1a0832',
    inner: 'rgba(255, 90, 220, 0.85)', spec: 'rgba(255, 232, 250, 0.62)'
  };
  const HERO = { hi: '#fff2b8', base: '#fbd05c', mid: '#e7a944', dark: '#b8772b', spot: 'rgba(128, 72, 18, 0.62)' };
  const LEAF = '#5fd35b';
  /* four distinct chasers: colour AND silhouette differ (colour-blind safe) */
  const CRIT = [
    { base: '#ff6fae', light: '#ffc4de', dark: '#cf3a7c', foot: '#a82a63', top: 'antenna', eyes: 1, mouth: 0 },
    { base: '#5ef0ff', light: '#d2fcff', dark: '#1fb0d4', foot: '#1585a6', top: 'horns', eyes: 1, mouth: 1 },
    { base: '#ffa63d', light: '#ffdca8', dark: '#d9711b', foot: '#a85412', top: 'spikes', eyes: 2, mouth: 2 },
    { base: '#7cf08a', light: '#d8ffdc', dark: '#2fb357', foot: '#20853f', top: 'ears', eyes: 2, mouth: 3 }
  ];
  const SCARED = { base: '#e3e7ff', light: '#ffffff', dark: '#a0abe6', foot: '#7f8bd0' };
  const CONFETTI = ['#7c5cff', CORAL, MINT, LEMON, '#5ef0ff', PINK, CREAM];

  function create(canvas, cfg) {
    cfg = cfg || {};
    const T = cfg.tile || 28, COLS = cfg.cols || 21, ROWS = cfg.rows || 17;
    const LW = COLS * T, LH = ROWS * T, N = COLS * ROWS;
    const POWER = cfg.powerMs || 8000, GRACE = cfg.graceMs || 1100;
    const WARN = 2000;
    const WW = T * 0.58;          // wall tube width
    const RIM = 2.1;              // neon rim
    const HOP_MS = 190;           // critter hop between tiles (they step every 400ms)
    const DEATH_MS = 1050;
    const SPR = T * 2;            // character sprite box (logical px)
    const FONT = '800 13px Unbounded, Outfit, system-ui, sans-serif';
    const ctx = canvas.getContext('2d');
    const R = prng(0x6d617a65);

    /* ---------- environment ---------- */
    let kx = 1, ky = 1, k = 1, needFit = true, cssW = 0, built = false;
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
        if (/^#[0-9a-f]{3,8}$/i.test(v)) accent = v;
      } catch (_) { /* keep default */ }
    }
    readTheme();
    document.addEventListener('cartofia:theme-changed', readTheme);
    window.addEventListener('cartofia:theme-changed', readTheme);

    if (typeof ResizeObserver === 'function') {
      try {
        new ResizeObserver((entries) => {
          const e = entries && entries[0];
          if (e && e.contentRect && e.contentRect.width > 0) cssW = e.contentRect.width;
          needFit = true;
        }).observe(canvas);
      } catch (_) { /* resize event fallback */ }
    }
    window.addEventListener('resize', () => { cssW = 0; needFit = true; });

    /* ---------- grid / state caches (no per-frame allocation) ---------- */
    const SOLID = new Uint8Array(N), PEL = new Uint8Array(N);
    const KEYS = new Array(N), CX = new Float32Array(N), CY = new Float32Array(N);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      KEYS[i] = x + ',' + y; CX[i] = (x + 0.5) * T; CY[i] = (y + 0.5) * T;
    }
    const FLOOD = new Int32Array(N);
    let mapRef = null, mapSig = '', wallsDirty = true, segPath = null, blkPath = null;
    let pelRef = null, pelSize = -1;
    let wallsN = null, wallsH = null, tmpI = null, tmpO = null;
    let sprDot, sprOrb, sprHalo, sprHeroGlow, sprPuff, sprHero, sprMash, sprGlowS;
    const sprCrit = [], sprCritS = [], sprGlowC = [];

    /* hero */
    let heroRef = null, HLX = -99, HLY = -99, HPX = 0, HPY = 0, gliding = false, lastPf = 0;
    let hvx = 0, hvy = 0, hDir = 'l', walk = 0, chompAt = -1e9, heroPopAt = -1e9;
    let lookX = -1, lookY = 0, blinkAt = -1e9, blinkNext = 1500;
    /* critters */
    const GM = 8;
    let ghostsRef = null, ng = 0;
    const GLX = new Float32Array(GM).fill(-99), GLY = new Float32Array(GM).fill(-99);
    const GPX = new Float32Array(GM), GPY = new Float32Array(GM), HOP = new Float64Array(GM).fill(-1e9);
    const GVX = new Float32Array(GM), GVY = new Float32Array(GM), LIFT = new Float32Array(GM);
    const EATEN = new Float64Array(GM).fill(-1e9), POPIN = new Float64Array(GM).fill(-1e9);
    const EX = new Float32Array(GM), EY = new Float32Array(GM);
    const FZX = new Float32Array(GM), FZY = new Float32Array(GM), POOF = new Uint8Array(GM);
    /* episodes */
    let deathAt = -1e9, deathOn = false, deathX = 0, deathY = 0, deathGi = -1, deathFinal = false, regroupAt = -1e9;
    let clearAt = -1e9, wasWon = false;
    let powerA = 0, lastNow = 0, shakeAt = -1e9;

    /* ---------- fx pools ---------- */
    const PN = 200;
    const parts = [];
    for (let i = 0; i < PN; i++) parts.push({ on: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, t0: 0, life: 1, r: 1, col: '', rot: 0, vr: 0 });
    const rings = [];
    for (let i = 0; i < 10; i++) rings.push({ on: false, x: 0, y: 0, t0: 0, dur: 1, r0: 0, r1: 0, w: 2, col: '' });
    const pops = [];
    for (let i = 0; i < 6; i++) pops.push({ on: false, x: 0, y: 0, t0: 0, txt: '', col: '' });

    let pNext = 0;
    function spawn(kind, x, y, vx, vy, life, r, col, g, drag, now) {
      // first free slot from a rotating cursor; when the pool is full, recycle the next one
      let p = null;
      for (let j = 0; j < PN; j++) {
        const q = parts[(pNext + j) % PN];
        if (!q.on) { p = q; pNext = (pNext + j + 1) % PN; break; }
      }
      if (!p) { p = parts[pNext]; pNext = (pNext + 1) % PN; }
      p.on = true; p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.r = r;
      p.col = col; p.g = g; p.drag = drag; p.t0 = now; p.rot = R() * TAU; p.vr = (R() - 0.5) * 12;
    }
    function ring(x, y, r0, r1, dur, w, col, now) {
      let q = null;
      for (let i = 0; i < rings.length; i++) { if (!rings[i].on) { q = rings[i]; break; } }
      if (!q) return;
      q.on = true; q.x = x; q.y = y; q.r0 = r0; q.r1 = r1; q.dur = dur; q.w = w; q.col = col; q.t0 = now;
    }
    function pop(x, y, txt, col, now) {
      let q = pops[0];
      for (let i = 0; i < pops.length; i++) { if (!pops[i].on) { q = pops[i]; break; } if (pops[i].t0 < q.t0) q = pops[i]; }
      q.on = true; q.x = x; q.y = y; q.txt = txt; q.col = col; q.t0 = now;
    }
    function resetFx() {
      for (let i = 0; i < PN; i++) parts[i].on = false;
      for (let i = 0; i < rings.length; i++) rings[i].on = false;
      for (let i = 0; i < pops.length; i++) pops[i].on = false;
      shakeAt = -1e9;
    }

    /* ---------- sizing / caches ---------- */
    function mkc(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
    /* a sprite of logical size w x h, painted by fn in logical px (origin at its centre) */
    function sprite(w, h, fn) {
      const c = mkc(w * k, h * k);
      const g = c.getContext('2d');
      g.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
      g.translate(w / 2, h / 2);
      g.lineCap = 'round'; g.lineJoin = 'round';
      fn(g);
      return c;
    }
    function glowSprite(r, c0, c1) {
      return sprite(r * 2, r * 2, (g) => {
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, r);
        rg.addColorStop(0, c0); rg.addColorStop(0.45, c1); rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg; g.fillRect(-r, -r, r * 2, r * 2);
      });
    }

    function fit() {
      needFit = false;
      let w = cssW;
      if (!(w > 0)) { const r = canvas.getBoundingClientRect(); w = r.width; }
      // 2x is retina-crisp for this soft art style and keeps phones at 60 fps
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      let pw = w > 0 ? Math.round(w * dpr) : LW;
      pw = clamp(pw, 294, 2400);
      const ph = Math.round(pw * LH / LW);
      if (pw !== canvas.width || ph !== canvas.height || !built) {
        canvas.width = pw; canvas.height = ph;
        kx = pw / LW; ky = ph / LH; k = Math.max(kx, ky);
        buildSprites();
        built = true;
        wallsDirty = true;
      }
    }

    /* ---------- maze geometry ---------- */
    function syncMap(map, player) {
      if (map === mapRef) return;
      mapRef = map;
      let sig = '';
      for (let y = 0; y < ROWS; y++) sig += (map[y] && map[y].join) ? map[y].join('') : String(map[y]);
      if (sig === mapSig && segPath) return;
      mapSig = sig;
      // walls, plus floor the hero can never reach (sealed pockets) are drawn as solid glass
      for (let i = 0; i < N; i++) SOLID[i] = 1;
      const isWall = (x, y) => map[y][x] === '#';
      let head = 0, tail = 0;
      const sx = player ? player.x : 1, sy = player ? player.y : 1;
      if (sx >= 0 && sy >= 0 && sx < COLS && sy < ROWS && !isWall(sx, sy)) { FLOOD[tail++] = sy * COLS + sx; SOLID[sy * COLS + sx] = 0; }
      while (head < tail) {
        const i = FLOOD[head++], x = i % COLS, y = (i / COLS) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const j = ny * COLS + nx;
          if (!SOLID[j] || isWall(nx, ny)) continue;
          SOLID[j] = 0; FLOOD[tail++] = j;
        }
      }
      // tubes along the wall-cell centres + filled 2x2 blocks; outside the board counts as wall
      const solid = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS) ? true : SOLID[y * COLS + x] === 1;
      segPath = new Path2D(); blkPath = new Path2D();
      for (let y = -1; y <= ROWS; y++) {
        for (let x = -1; x <= COLS; x++) {
          if (!solid(x, y)) continue;
          const cx = (x + 0.5) * T, cy = (y + 0.5) * T;
          const r = solid(x + 1, y), d = solid(x, y + 1);
          if (r) { segPath.moveTo(cx, cy); segPath.lineTo(cx + T, cy); }
          if (d) { segPath.moveTo(cx, cy); segPath.lineTo(cx, cy + T); }
          if (!r && !d && !solid(x - 1, y) && !solid(x, y - 1)) { segPath.moveTo(cx, cy); segPath.lineTo(cx + 0.01, cy); }
          if (r && d && solid(x + 1, y + 1)) blkPath.rect(cx, cy, T, T);
        }
      }
      wallsDirty = true;
    }

    function shape(g, width) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.lineWidth = width;
      g.stroke(segPath);
      g.fill(blkPath);
    }

    function paintFloor(g, P) {
      const bg = g.createRadialGradient(LW * 0.5, LH * 0.42, 0, LW * 0.5, LH * 0.46, LW * 0.64);
      bg.addColorStop(0, P.f0); bg.addColorStop(0.55, P.f1); bg.addColorStop(1, P.f2);
      g.fillStyle = bg; g.fillRect(0, 0, LW, LH);
      // faint floor panels on walkable cells
      g.fillStyle = P.tile;
      for (let i = 0; i < N; i++) {
        if (SOLID[i]) continue;
        const x = (i % COLS) * T, y = ((i / COLS) | 0) * T;
        if (((i % COLS) + ((i / COLS) | 0)) & 1) g.fillRect(x + 1, y + 1, T - 2, T - 2);
      }
      // the cover's dot pattern on the tile corners
      g.fillStyle = P.dot;
      g.beginPath();
      for (let y = 1; y < ROWS; y++) for (let x = 1; x < COLS; x++) { g.moveTo(x * T + 0.9, y * T); g.arc(x * T, y * T, 0.9, 0, TAU); }
      g.fill();
    }

    function paintLayer(cv, P) {
      const W = canvas.width, H = canvas.height;
      if (!cv || cv.width !== W || cv.height !== H) cv = mkc(W, H);
      const g = cv.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, W, H);
      g.setTransform(kx, 0, 0, ky, 0, 0);
      paintFloor(g, P);
      // neon: wide soft glow, a tighter hot glow, then the solid rim
      g.save();
      g.strokeStyle = P.rim; g.fillStyle = P.rim;
      g.shadowColor = P.glow;
      g.shadowBlur = 16 * k; g.globalAlpha = 0.85; shape(g, WW);
      g.shadowBlur = 5 * k; g.globalAlpha = 1; shape(g, WW);
      g.restore();
      // glass interior with its own lighting
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(interior(P), 0, 0);
      // vignette (cover) over everything
      g.setTransform(kx, 0, 0, ky, 0, 0);
      const vig = g.createRadialGradient(LW * 0.5, LH * 0.46, LH * 0.42, LW * 0.5, LH * 0.46, LW * 0.72);
      vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vig.addColorStop(1, 'rgba(0, 0, 0, 0.38)');
      g.fillStyle = vig; g.fillRect(0, 0, LW, LH);
      return cv;
    }

    function interior(P) {
      const W = canvas.width, H = canvas.height, OFF = W + 64;
      if (!tmpI || tmpI.width !== W || tmpI.height !== H) { tmpI = mkc(W, H); tmpO = mkc(W, H); }
      // O: everything that is NOT glass interior (used to cast light into it)
      const o = tmpO.getContext('2d');
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalCompositeOperation = 'source-over';
      o.clearRect(0, 0, W, H);
      o.fillStyle = '#000'; o.fillRect(0, 0, W, H);
      o.globalCompositeOperation = 'destination-out';
      o.setTransform(kx, 0, 0, ky, 0, 0);
      o.strokeStyle = '#000'; o.fillStyle = '#000';
      shape(o, WW - RIM * 2);
      o.globalCompositeOperation = 'source-over';
      o.setTransform(1, 0, 0, 1, 0, 0);
      // I: the glass itself
      const g = tmpI.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, W, H);
      g.setTransform(kx, 0, 0, ky, 0, 0);
      const gl = g.createLinearGradient(0, 0, 0, LH);
      gl.addColorStop(0, P.glass0); gl.addColorStop(1, P.glass1);
      g.strokeStyle = gl; g.fillStyle = gl;
      shape(g, WW - RIM * 2);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      // neon light bleeding in from every edge (only the shadow of O lands here)
      g.save();
      g.shadowColor = P.inner; g.shadowBlur = 7 * k; g.shadowOffsetX = OFF; g.shadowOffsetY = 0;
      g.drawImage(tmpO, -OFF, 0);
      g.restore();
      // specular edge, top-left light
      g.save();
      g.shadowColor = P.spec; g.shadowBlur = 1.1 * k; g.shadowOffsetX = OFF + 1.25 * k; g.shadowOffsetY = 1.25 * k;
      g.drawImage(tmpO, -OFF, 0);
      g.restore();
      // bottom-right inner shade
      g.save();
      g.shadowColor = 'rgba(0, 0, 0, 0.5)'; g.shadowBlur = 2 * k; g.shadowOffsetX = OFF - 1.4 * k; g.shadowOffsetY = -1.4 * k;
      g.drawImage(tmpO, -OFF, 0);
      g.restore();
      // diagonal glass sheen + the cover's dot pattern inside the slabs
      g.setTransform(kx, 0, 0, ky, 0, 0);
      const sh = g.createLinearGradient(0, 0, LW, LH);
      for (let s = 0; s <= 10; s++) {
        const u = s / 10;
        sh.addColorStop(u, (s % 3 === 1) ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0)');
      }
      g.fillStyle = sh; g.fillRect(0, 0, LW, LH);
      g.fillStyle = 'rgba(255, 255, 255, 0.06)';
      g.beginPath();
      for (let y = 3; y < LH; y += 7) for (let x = 3 + ((y / 7) & 1) * 3.5; x < LW; x += 7) { g.moveTo(x + 0.55, y); g.arc(x, y, 0.55, 0, TAU); }
      g.fill();
      g.globalCompositeOperation = 'source-over';
      return tmpI;
    }

    function buildWalls() {
      wallsDirty = false;
      if (!segPath) return;
      wallsN = paintLayer(wallsN, NEON);
      wallsH = paintLayer(wallsH, HOT);
    }

    /* ---------- character sprites ---------- */
    function heroPath(g) {
      g.beginPath();
      for (let j = 0; j <= 56; j++) {
        const a = j / 56 * TAU;
        const wob = 1 + 0.045 * Math.sin(3 * a + 0.7) + 0.03 * Math.sin(5 * a + 2.1) + 0.022 * Math.sin(2 * a + 0.3);
        const x = Math.cos(a) * 11.7 * wob;
        let y = Math.sin(a) * 10.3 * wob;
        if (y > 0) y *= 0.93;
        if (j) g.lineTo(x, y + 0.8); else g.moveTo(x, y + 0.8);
      }
      g.closePath();
    }
    function leaf(g, len, wid) {
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.5, -wid, len, 0);
      g.quadraticCurveTo(len * 0.5, wid, 0, 0);
      g.closePath();
      g.strokeStyle = INK; g.lineWidth = 1.7; g.stroke();
      g.fillStyle = LEAF; g.fill();
      g.beginPath(); g.moveTo(len * 0.15, 0); g.lineTo(len * 0.8, 0);
      g.strokeStyle = 'rgba(20, 90, 30, 0.6)'; g.lineWidth = 0.6; g.stroke();
    }
    function paintHero(g, tone) {
      // sprout (behind the body)
      g.save();
      g.translate(1.6, -8.6);
      g.beginPath(); g.moveTo(0, 1); g.quadraticCurveTo(0.6, -2.2, 0.2, -4.2);
      g.strokeStyle = INK; g.lineWidth = 2.6; g.stroke();
      g.strokeStyle = '#3fae4a'; g.lineWidth = 1.1; g.stroke();
      g.save(); g.translate(0.2, -4); g.rotate(-2.45); leaf(g, 6.4, 2.6); g.restore();
      g.save(); g.translate(0.2, -4); g.rotate(-0.55); leaf(g, 5.2, 2.2); g.restore();
      g.restore();
      // body
      heroPath(g);
      g.strokeStyle = INK; g.lineWidth = 3.3; g.stroke();
      const gr = g.createRadialGradient(-4.6, -5.6, 0.8, 0, 0.5, 14);
      gr.addColorStop(0, tone.hi); gr.addColorStop(0.38, tone.base); gr.addColorStop(0.74, tone.mid); gr.addColorStop(1, tone.dark);
      g.fillStyle = gr; g.fill();
      g.save();
      heroPath(g); g.clip();
      // bounce light along the lower right
      g.beginPath(); g.arc(0.4, 0.8, 10.2, 0.05 * Math.PI, 0.58 * Math.PI);
      g.strokeStyle = 'rgba(255, 226, 160, 0.5)'; g.lineWidth = 1.4; g.stroke();
      // potato eyes (the little spots), kept away from the face area
      const spots = [-8.6, 3.8, 0.4, 8.2, -4.6, -0.5, 5.6, 7.2, 0.9, -6.4, -6.4, 2.6];
      for (let s = 0; s < spots.length; s += 3) {
        g.save(); g.translate(spots[s], spots[s + 1]); g.rotate(spots[s + 2]);
        g.beginPath(); g.ellipse(0, 0, 1.55, 0.85, 0, 0, TAU); g.fillStyle = tone.spot; g.fill();
        g.beginPath(); g.arc(0, 0.9, 1.4, 1.15 * Math.PI, 1.85 * Math.PI);
        g.strokeStyle = 'rgba(255, 240, 190, 0.55)'; g.lineWidth = 0.55; g.stroke();
        g.restore();
      }
      g.restore();
      // gloss
      g.fillStyle = 'rgba(255, 255, 255, 0.72)';
      g.beginPath(); g.ellipse(-5.6, -5.3, 2.7, 1.45, -0.62, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255, 255, 255, 0.9)';
      g.beginPath(); g.arc(-2.5, -7.5, 0.7, 0, TAU); g.fill();
    }
    function paintMash(g) {
      // a squashed puddle of mash: the death leftover
      g.beginPath();
      for (let j = 0; j <= 40; j++) {
        const a = j / 40 * TAU;
        const wob = 1 + 0.12 * Math.sin(5 * a + 0.4) + 0.06 * Math.sin(9 * a + 1.3);
        const x = Math.cos(a) * 13.5 * wob, y = Math.sin(a) * 5.2 * wob;
        if (j) g.lineTo(x, y + 6); else g.moveTo(x, y + 6);
      }
      g.closePath();
      g.strokeStyle = INK; g.lineWidth = 2.8; g.stroke();
      const gr = g.createRadialGradient(-4, 3, 0.5, 0, 6, 14);
      gr.addColorStop(0, '#fff6cf'); gr.addColorStop(0.5, '#ffdf7e'); gr.addColorStop(1, '#d9a447');
      g.fillStyle = gr; g.fill();
      g.fillStyle = 'rgba(255, 255, 255, 0.6)';
      g.beginPath(); g.ellipse(-5, 3.6, 3.2, 1.1, -0.15, 0, TAU); g.fill();
    }

    /* critter body: the cover's gumdrop silhouette, centred */
    function critPath(g) {
      const s = 0.66;
      const X = (v) => (v - 18) * s, Y = (v) => (v - 19.25) * s;
      g.beginPath();
      g.moveTo(X(0), Y(22));
      g.bezierCurveTo(X(0), Y(-4), X(36), Y(-4), X(36), Y(22));
      g.bezierCurveTo(X(36), Y(34), X(30), Y(36), X(18), Y(36));
      g.bezierCurveTo(X(6), Y(36), X(0), Y(34), X(0), Y(22));
      g.closePath();
    }
    function headgear(g, d, P, droop) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (d.top === 'antenna') {
        const ex = droop ? 8.6 : 4.2, ey = droop ? -12.6 : -16.2;
        g.beginPath(); g.moveTo(0.6, -9); g.quadraticCurveTo(droop ? 5.5 : 0.2, droop ? -15.5 : -14, ex, ey);
        g.strokeStyle = INK; g.lineWidth = 2.8; g.stroke();
        g.strokeStyle = P.dark; g.lineWidth = 1.1; g.stroke();
        g.beginPath(); g.arc(ex + 0.6, ey - 0.8, 2.5, 0, TAU);
        g.strokeStyle = INK; g.lineWidth = 2.2; g.stroke();
        g.fillStyle = droop ? P.dark : P.base; g.fill();
        g.fillStyle = 'rgba(255, 255, 255, 0.75)';
        g.beginPath(); g.arc(ex - 0.2, ey - 1.6, 0.8, 0, TAU); g.fill();
      } else if (d.top === 'horns') {
        for (let s = -1; s <= 1; s += 2) {
          g.beginPath();
          g.moveTo(s * 3.6, -9.6);
          if (droop) g.quadraticCurveTo(s * 9.5, -11.5, s * 11.4, -8.6);
          else g.quadraticCurveTo(s * 6.2, -12.5, s * 8.6, -16.2);
          g.lineTo(s * 8.2, -7.4);
          g.closePath();
          g.strokeStyle = INK; g.lineWidth = 2.2; g.stroke();
          g.fillStyle = droop ? '#e7e2f4' : CREAM; g.fill();
          g.beginPath(); g.moveTo(s * 5.4, -9.8); g.lineTo(s * (droop ? 8.6 : 7.2), droop ? -9.6 : -12.4);
          g.strokeStyle = 'rgba(27, 18, 48, 0.25)'; g.lineWidth = 0.8; g.stroke();
        }
      } else if (d.top === 'spikes') {
        const h = droop ? 0.5 : 1;
        const tips = [-6.6, -12.6, 0, -15.8, 6.6, -12.6];
        for (let s = 0; s < tips.length; s += 2) {
          const bx = tips[s];
          g.beginPath();
          g.moveTo(bx - 3.3, -8.6 + Math.abs(bx) * 0.15);
          g.lineTo(bx + (droop ? bx * 0.25 : 0), -9.4 + (tips[s + 1] + 9.4) * h);
          g.lineTo(bx + 3.3, -8.6 + Math.abs(bx) * 0.15);
          g.closePath();
          g.strokeStyle = INK; g.lineWidth = 2.2; g.stroke();
          g.fillStyle = P.dark; g.fill();
        }
      } else if (d.top === 'ears') {
        for (let s = -1; s <= 1; s += 2) {
          const ex = s * (droop ? 10.4 : 7.6), ey = droop ? -5.6 : -8.6;
          g.beginPath(); g.arc(ex, ey, 4.3, 0, TAU);
          g.strokeStyle = INK; g.lineWidth = 2.2; g.stroke();
          g.fillStyle = P.base; g.fill();
          g.beginPath(); g.arc(ex + s * 0.2, ey + 0.3, 2.2, 0, TAU);
          g.fillStyle = droop ? '#c9cff5' : '#ff9fbc'; g.fill();
        }
      }
    }
    function paintCritter(g, d, P, droop) {
      headgear(g, d, P, droop);
      critPath(g);
      g.strokeStyle = INK; g.lineWidth = 3.1; g.stroke();
      const gr = g.createRadialGradient(-4.2, -6.2, 0.8, 0, 0, 15);
      gr.addColorStop(0, P.light); gr.addColorStop(0.42, P.base); gr.addColorStop(1, P.dark);
      g.fillStyle = gr; g.fill();
      g.save(); critPath(g); g.clip();
      g.fillStyle = 'rgba(255, 255, 255, 0.16)';
      g.beginPath(); g.ellipse(0, 7.2, 7, 3.8, 0, 0, TAU); g.fill();
      g.beginPath(); g.arc(0.5, 0.5, 11, 0.1 * Math.PI, 0.55 * Math.PI);
      g.strokeStyle = 'rgba(255, 255, 255, 0.28)'; g.lineWidth = 1.2; g.stroke();
      g.restore();
      g.fillStyle = 'rgba(255, 255, 255, 0.62)';
      g.beginPath(); g.ellipse(-5.4, -5.4, 2.8, 1.5, -0.7, 0, TAU); g.fill();
    }

    function buildSprites() {
      sprDot = sprite(14, 14, (g) => {
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, 7);
        rg.addColorStop(0, 'rgba(255, 246, 229, 0.55)'); rg.addColorStop(1, 'rgba(255, 220, 160, 0)');
        g.fillStyle = rg; g.fillRect(-7, -7, 14, 14);
        g.beginPath(); g.arc(0, 0, 2.55, 0, TAU);
        g.fillStyle = CREAM; g.fill();
        g.beginPath(); g.arc(-0.7, -0.8, 0.9, 0, TAU);
        g.fillStyle = '#ffffff'; g.fill();
      });
      sprOrb = sprite(24, 24, (g) => {
        g.beginPath(); g.arc(0, 0, 6.6, 0, TAU);
        g.strokeStyle = INK; g.lineWidth = 2.6; g.stroke();
        const rg = g.createRadialGradient(-2.2, -2.6, 0.5, 0, 0, 7.2);
        rg.addColorStop(0, '#ffe2f6'); rg.addColorStop(0.4, PINK); rg.addColorStop(1, '#b8318f');
        g.fillStyle = rg; g.fill();
        g.beginPath(); g.arc(0, 0, 4.6, 0.15 * Math.PI, 0.6 * Math.PI);
        g.strokeStyle = 'rgba(255, 200, 240, 0.6)'; g.lineWidth = 1; g.stroke();
        g.fillStyle = 'rgba(255, 255, 255, 0.85)';
        g.beginPath(); g.ellipse(-2.4, -2.6, 1.9, 1.1, -0.7, 0, TAU); g.fill();
      });
      sprHalo = glowSprite(22, 'rgba(255, 150, 230, 0.75)', 'rgba(255, 90, 210, 0.28)');
      sprHeroGlow = glowSprite(22, 'rgba(255, 225, 140, 0.42)', 'rgba(255, 200, 90, 0.14)');
      sprGlowS = glowSprite(20, 'rgba(210, 220, 255, 0.4)', 'rgba(170, 180, 255, 0.12)');
      sprPuff = sprite(24, 24, (g) => {
        const rg = g.createRadialGradient(-2, -2, 0, 0, 0, 12);
        rg.addColorStop(0, 'rgba(255, 255, 255, 0.95)'); rg.addColorStop(0.6, 'rgba(236, 232, 255, 0.7)'); rg.addColorStop(1, 'rgba(220, 215, 255, 0)');
        g.fillStyle = rg; g.fillRect(-12, -12, 24, 24);
      });
      sprHero = sprite(SPR, SPR, (g) => paintHero(g, HERO));
      sprMash = sprite(SPR, SPR, paintMash);
      for (let i = 0; i < CRIT.length; i++) {
        sprCrit[i] = sprite(SPR, SPR, (g) => paintCritter(g, CRIT[i], CRIT[i], false));
        sprCritS[i] = sprite(SPR, SPR, (g) => paintCritter(g, CRIT[i], SCARED, true));
        const n = parseInt(CRIT[i].base.slice(1), 16);
        const rgb = ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
        sprGlowC[i] = glowSprite(20, 'rgba(' + rgb + ', 0.42)', 'rgba(' + rgb + ', 0.13)');
      }
    }

    /* ---------- sync: read the game's state, derive events ---------- */
    function syncPellets(pellets, now) {
      if (!pellets) return;
      if (pellets !== pelRef) {
        // a new run (resetGame builds a fresh pellet map): resync silently
        pelRef = pellets; pelSize = pellets.size;
        for (let i = 0; i < N; i++) { const t = pellets.get(KEYS[i]); PEL[i] = t === 'power' ? 2 : (t ? 1 : 0); }
        newRun(now);
        return;
      }
      if (pellets.size === pelSize) return;
      pelSize = pellets.size;
      for (let i = 0; i < N; i++) {
        if (!PEL[i]) continue;
        if (pellets.has(KEYS[i])) continue;
        const kind = PEL[i];
        PEL[i] = 0;
        onPellet(i, kind, now);
      }
    }
    function newRun(now) {
      resetFx();
      deathOn = false; deathAt = -1e9; regroupAt = -1e9; clearAt = -1e9; wasWon = false;
      for (let i = 0; i < GM; i++) { EATEN[i] = -1e9; POPIN[i] = -1e9; POOF[i] = 0; }
      heroPopAt = now; powerA = 0;
    }

    function onPellet(i, kind, now) {
      const x = CX[i], y = CY[i];
      chompAt = now;
      if (kind === 1) {
        if (rm) return;
        ring(x, y, 2, 9, 220, 1.4, 'rgba(255, 246, 229, 0.8)', now);
        for (let j = 0; j < 3; j++) {
          const an = R() * TAU, sp = 30 + R() * 40;
          spawn(1, x, y, Math.cos(an) * sp, Math.sin(an) * sp, 260 + R() * 160, 1.6 + R() * 1.2, j ? CREAM : LEMON, 0, 3.5, now);
        }
        return;
      }
      // power orb: shockwave + pink sparks + "+50"
      pop(x, y, '+50', PINK, now);
      ring(x, y, 4, T * 3.2, rm ? 360 : 560, 3.2, 'rgba(255, 122, 217, 0.95)', now);
      if (rm) return;
      ring(x, y, 2, T * 1.6, 380, 2, 'rgba(255, 246, 229, 0.9)', now);
      for (let j = 0; j < 16; j++) {
        const an = j / 16 * TAU + R() * 0.3, sp = 70 + R() * 90;
        spawn(1, x, y, Math.cos(an) * sp, Math.sin(an) * sp, 420 + R() * 260, 2.2 + R() * 2, j & 1 ? PINK : CREAM, 0, 2.6, now);
      }
    }

    function event(type, gi, x, y) {
      const now = lastNow || performance.now();
      const px = (x + 0.5) * T, py = (y + 0.5) * T;
      if (type === 'eat') {
        if (gi < 0 || gi >= GM) return;
        EATEN[gi] = now;
        EX[gi] = px; EY[gi] = py;
        POPIN[gi] = now + (rm ? 120 : 260);
        pop(px, py, '+200', accent, now);
        ring(px, py, 3, T * 1.3, 420, 2.6, 'rgba(227, 231, 255, 0.95)', now);
        if (rm) return;
        for (let j = 0; j < 7; j++) {
          const an = R() * TAU, sp = 24 + R() * 40;
          spawn(2, px + Math.cos(an) * 3, py + Math.sin(an) * 3, Math.cos(an) * sp, Math.sin(an) * sp - 10, 480 + R() * 240, 5 + R() * 3, '', 0, 2.4, now);
        }
        const col = CRIT[gi % CRIT.length].base;
        for (let j = 0; j < 9; j++) {
          const an = R() * TAU, sp = 60 + R() * 80;
          spawn(1, px, py, Math.cos(an) * sp, Math.sin(an) * sp, 380 + R() * 220, 2 + R() * 1.6, j % 3 ? col : CREAM, 0, 3, now);
        }
        return;
      }
      if (type === 'caught') {
        deathOn = true; deathAt = now; regroupAt = -1e9;
        deathX = px; deathY = py; deathGi = gi; deathFinal = false;
        // freeze everyone where they are on screen; the catcher sits beside the hero, on the line of contact
        for (let i = 0; i < ng; i++) { FZX[i] = GVX[i]; FZY[i] = GVY[i]; }
        if (gi >= 0 && gi < ng) {
          let dx = 0, dy = -1;
          if (GLX[gi] === x && GLY[gi] === y) {          // the hero walked into it
            if (HLX !== x || HLY !== y) { dx = x - HLX; dy = y - HLY; }
          } else { dx = GLX[gi] - x; dy = GLY[gi] - y; }  // it stepped onto the hero
          const l = Math.sqrt(dx * dx + dy * dy) || 1;
          dx /= l; dy /= l;
          // it stays on the hero's side of the contact line
          FZX[gi] = px + dx * T * 0.46; FZY[gi] = py + dy * T * 0.46;
        }
        chompAt = -1e9;
        if (rm) return;
        shakeAt = now;
        ring(px, py, 3, T * 1.1, 360, 3, 'rgba(255, 246, 229, 0.95)', now);
        for (let j = 0; j < 10; j++) {
          const an = R() * TAU, sp = 60 + R() * 90;
          spawn(3, px, py, Math.cos(an) * sp, Math.sin(an) * sp - 50, 520 + R() * 260, 1.6 + R() * 1.4, j & 1 ? HERO.base : HERO.mid, 340, 1.6, now);
        }
        for (let j = 0; j < 6; j++) {
          const an = R() * TAU, sp = 40 + R() * 70;
          spawn(1, px, py, Math.cos(an) * sp, Math.sin(an) * sp, 420 + R() * 200, 2.4 + R() * 1.6, j & 1 ? LEMON : CREAM, 0, 3, now);
        }
      }
    }

    function syncActors(v, now) {
      const player = v.player, ghosts = v.ghosts || [];
      // hero: glide between tiles using the game's own step fraction (timing unchanged)
      if (player) {
        if (player !== heroRef) {
          heroRef = player; HLX = player.x; HLY = player.y; HPX = HLX; HPY = HLY; gliding = false;
        } else if (player.x !== HLX || player.y !== HLY) {
          const d = Math.abs(player.x - HLX) + Math.abs(player.y - HLY);
          if (d === 1 && !rm) { HPX = HLX; HPY = HLY; gliding = true; } else { HPX = player.x; HPY = player.y; gliding = false; }
          HLX = player.x; HLY = player.y;
        } else if (v.pf < lastPf - 0.4) {
          gliding = false; HPX = HLX; HPY = HLY;          // a step went by without moving (blocked)
        }
        lastPf = v.pf;
        // The sim stops on the last pellet, so the step fraction freezes mid-glide:
        // finish the step on a win so the hero (and the clear confetti) sit on
        // the tile he actually reached.
        const e = gliding && !v.won ? clamp(v.pf, 0, 1) : 1;
        const nx = (lerp(HPX, HLX, e) + 0.5) * T, ny = (lerp(HPY, HLY, e) + 0.5) * T;
        const mv = Math.abs(nx - hvx) + Math.abs(ny - hvy);
        if (mv < T * 1.5) walk += mv / T;
        hvx = nx; hvy = ny;
        if (player.dir) hDir = player.dir;
      }
      // critters: a quick hop when they step (they step every 400ms)
      if (ghosts !== ghostsRef) {
        ghostsRef = ghosts;
        for (let i = 0; i < GM; i++) { GLX[i] = -99; GLY[i] = -99; }
      }
      ng = Math.min(GM, ghosts.length);
      for (let i = 0; i < ng; i++) {
        const g = ghosts[i];
        if (g.x !== GLX[i] || g.y !== GLY[i]) {
          const d = Math.abs(g.x - GLX[i]) + Math.abs(g.y - GLY[i]);
          if (d === 1 && !rm) { GPX[i] = GLX[i]; GPY[i] = GLY[i]; HOP[i] = now; }
          else { GPX[i] = g.x; GPY[i] = g.y; HOP[i] = -1e9; }
          GLX[i] = g.x; GLY[i] = g.y;
        }
        const u = clamp((now - HOP[i]) / HOP_MS, 0, 1);
        const e = easeInOut(u);
        GVX[i] = (lerp(GPX[i], GLX[i], e) + 0.5) * T;
        GVY[i] = (lerp(GPY[i], GLY[i], e) + 0.5) * T;
        LIFT[i] = u < 1 ? Math.sin(u * Math.PI) * 3.4 : 0;
      }
    }

    /* ---------- drawing: hero ---------- */
    function dirVec(d) {
      if (d === 'u') { lookX = lookX + (0 - lookX) * 0.35; lookY = lookY + (-1 - lookY) * 0.35; }
      else if (d === 'd') { lookX = lookX + (0 - lookX) * 0.35; lookY = lookY + (1 - lookY) * 0.35; }
      else if (d === 'r') { lookX = lookX + (1 - lookX) * 0.35; lookY = lookY + (0 - lookY) * 0.35; }
      else { lookX = lookX + (-1 - lookX) * 0.35; lookY = lookY + (0 - lookY) * 0.35; }
      if (rm) {
        lookX = d === 'r' ? 1 : d === 'l' ? -1 : 0;
        lookY = d === 'd' ? 1 : d === 'u' ? -1 : 0;
      }
    }

    /* mode: 0 normal, 1 dead, 2 happy */
    function heroFace(now, mode, powered) {
      const fx = lookX * 2.6, fy = lookY * 2.1 - 0.4;
      const blink = mode === 0 && now - blinkAt < 130;
      const chomp = mode === 0 && now - chompAt < 150;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // cheeks
      ctx.fillStyle = 'rgba(255, 105, 140, 0.36)';
      ctx.beginPath();
      ctx.ellipse(fx - 6.3, fy + 2.2, 1.9, 1.2, 0, 0, TAU);
      ctx.moveTo(fx + 8.2, fy + 2.2); ctx.ellipse(fx + 6.3, fy + 2.2, 1.9, 1.2, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = INK;
      for (let s = -1; s <= 1; s += 2) {
        const ex = fx + s * 3.7, ey = fy - 1.9;
        if (mode === 1) {
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ex - 1.7, ey - 1.7); ctx.lineTo(ex + 1.7, ey + 1.7);
          ctx.moveTo(ex + 1.7, ey - 1.7); ctx.lineTo(ex - 1.7, ey + 1.7);
          ctx.stroke();
        } else if (mode === 2 || blink) {
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          if (mode === 2) ctx.arc(ex, ey + 1, 2, 1.15 * Math.PI, 1.85 * Math.PI);
          else { ctx.moveTo(ex - 2, ey); ctx.quadraticCurveTo(ex, ey + 1.2, ex + 2, ey); }
          ctx.stroke();
        } else {
          ctx.fillStyle = CREAM; ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.ellipse(ex, ey, 2.4, 2.85, 0, 0, TAU); ctx.fill(); ctx.stroke();
          const px = ex + lookX * 0.75, py = ey + lookY * 0.85 + 0.2;
          ctx.fillStyle = INK;
          ctx.beginPath(); ctx.arc(px, py, 1.45, 0, TAU); ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(px - 0.5, py - 0.6, 0.5, 0, TAU); ctx.fill();
          if (powered) {
            // game face: brows down toward the middle
            ctx.lineWidth = 1.3;
            ctx.beginPath(); ctx.moveTo(ex - s * 2.4, ey - 3.9); ctx.lineTo(ex + s * 1.6, ey - 2.9); ctx.stroke();
          }
        }
      }
      // mouth
      const mx = fx, my = fy + 3.4;
      if (mode === 1) {
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(mx - 2.6, my + 0.6);
        ctx.quadraticCurveTo(mx - 1.3, my - 0.7, mx, my + 0.4); ctx.quadraticCurveTo(mx + 1.3, my + 1.4, mx + 2.6, my);
        ctx.stroke();
      } else if (chomp || mode === 2) {
        ctx.fillStyle = INK;
        ctx.beginPath();
        if (mode === 2) { ctx.moveTo(mx - 3, my - 0.6); ctx.quadraticCurveTo(mx, my + 5, mx + 3, my - 0.6); ctx.closePath(); }
        else ctx.ellipse(mx, my + 0.3, 1.9, 2.3, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#ff6d8a';
        ctx.beginPath(); ctx.ellipse(mx, my + (mode === 2 ? 1.9 : 1.4), 1.2, 0.8, 0, 0, TAU); ctx.fill();
      } else if (powered) {
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.moveTo(mx - 3, my - 0.7); ctx.quadraticCurveTo(mx, my + 3.6, mx + 3, my - 0.7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = CREAM;
        ctx.fillRect(mx - 2.2, my - 0.5, 4.4, 0.9);
      } else {
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(mx, my - 1.4, 2.5, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
      }
    }

    function drawHeroAt(now, x, y, sx, sy, rot, mode, powered, alpha) {
      if (alpha <= 0.01) return;
      ctx.globalAlpha = alpha;
      // contact shadow (stays on the floor)
      ctx.fillStyle = 'rgba(4, 2, 16, 0.42)';
      ctx.beginPath(); ctx.ellipse(x, y + 10.8, 9.6 * sx, 2.6, 0, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(x, y + 10);           // squash from the feet
      ctx.rotate(rot);
      ctx.scale(sx, sy);
      ctx.translate(0, -10);
      ctx.save();
      if (lookX > 0.2) ctx.scale(-1, 1);  // the sprout leans away from where he is heading
      ctx.drawImage(sprHero, -SPR / 2, -SPR / 2, SPR, SPR);
      ctx.restore();
      heroFace(now, mode, powered);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    function drawHero(now, v) {
      const powered = v.frightMs > 0;
      if (now > blinkNext) { blinkAt = now; blinkNext = now + (R() < 0.2 ? 240 : 2000 + R() * 2800); }
      // death: play where he was caught
      if (deathOn) {
        const t = now - deathAt;
        dirVec(hDir);
        if (rm) {
          const a = deathFinal ? 1 : clamp(1 - (t - 500) / 400, 0, 1);
          drawMash(deathX, deathY, 1, a * 0.9);
          drawHeroAt(now, deathX, deathY, 1, 1, 0, 1, false, clamp(1 - t / 260, 0, 1));
          return;
        }
        if (t < 140) {
          const u = t / 140;
          drawHeroAt(now, deathX, deathY - Math.sin(u * Math.PI) * 3, 1 + u * 0.12, 1 + u * 0.12, 0, 1, false, 1);
          // white flash on impact
          ctx.globalAlpha = 0.6 * (1 - u);
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(deathX, deathY, 13, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
        } else if (t < 520) {
          const u = easeOutCubic((t - 140) / 380);
          const a = 1 - u;
          drawMash(deathX, deathY, 0.4 + u * 0.6, u);
          drawHeroAt(now, deathX, deathY, 1.12 + u * 0.45, 1.12 - u * 0.8, Math.sin(t * 0.05) * 0.12 * a, 1, false, a);
        } else {
          const fade = deathFinal ? 0.85 : clamp(1 - (t - 760) / 300, 0, 1);
          drawMash(deathX, deathY, 1, fade);
          if (!deathFinal && t > 560 && ((t / 160) | 0) % 2 === 0 && t < 900) {
            spawn(2, deathX + (R() - 0.5) * 12, deathY + 3, (R() - 0.5) * 8, -18 - R() * 12, 700, 3.2 + R() * 2, '', -8, 1.2, now);
          }
        }
        return;
      }
      if (v.won && clearAt > 0) {
        // level clear: happy hops
        const t = now - clearAt;
        const hop = rm ? 0 : Math.abs(Math.sin(t * 0.0105)) * 6 * clamp(1 - t / 1700, 0.35, 1);
        dirVec('d');
        drawHeroAt(now, hvx, hvy - hop, 1, 1, 0, 2, false, 1);
        return;
      }
      dirVec(hDir);
      // spawn pop-in (new run, or back after a lost life)
      const pt = now - heroPopAt;
      let sc = 1, al = 1;
      if (pt < 380) {
        if (pt < 0) return;
        const u = pt / 380;
        if (rm) al = u; else sc = Math.max(0.05, easeOutBack(u));
      }
      const moving = gliding && v.running && !v.paused && !rm;
      const ph = walk * Math.PI;
      const rot = moving ? Math.sin(ph) * 0.09 : 0;
      const bob = moving ? Math.abs(Math.sin(ph)) * 1.3 : 0;
      const breath = rm ? 0 : Math.sin(now * 0.0042) * 0.022;
      const chomp = now - chompAt < 150 && !rm ? 0.05 : 0;
      // floor glow + power aura
      if (powered || powerA > 0.02) {
        const pulse = rm ? 0.9 : 0.8 + 0.2 * Math.sin(now * 0.012);
        const warnFlick = v.frightMs > 0 && v.frightMs < WARN && !rm && (((v.frightMs / 110) | 0) & 1) ? 0.45 : 1;
        const aura = al * Math.min(1, powerA * 1.2) * pulse * warnFlick;
        const r = 25 * sc * (rm ? 1 : 1 + 0.06 * Math.sin(now * 0.009));
        ctx.globalAlpha = aura;
        ctx.drawImage(sprHalo, hvx - r, hvy - r, r * 2, r * 2);
        // a charged rim around Spud
        ctx.globalAlpha = aura * 0.85;
        ctx.strokeStyle = v.frightMs > 0 && v.frightMs < WARN ? CORAL : PINK;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(hvx, hvy + 0.5, 14.2 * sc, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = al * 0.9;
        ctx.drawImage(sprHeroGlow, hvx - 22, hvy - 20, 44, 44);
        ctx.globalAlpha = 1;
      }
      drawHeroAt(now, hvx, hvy - bob, sc * (1 + chomp - breath * 0.5), sc * (1 - chomp + breath), rot, 0, powered, al);
      // power sparks orbiting
      if (powered && !rm) {
        ctx.fillStyle = v.frightMs < WARN ? CORAL : PINK;
        for (let j = 0; j < 3; j++) {
          const an = now * 0.006 + j * TAU / 3;
          sparkle(hvx + Math.cos(an) * 15, hvy + Math.sin(an) * 12.5, 2.2);
        }
      }
      // invulnerable bubble while the critters are still waking up
      if (v.running && v.graceMs > 0) {
        const a = Math.min(1, v.graceMs / 260) * al;
        ctx.globalAlpha = a * 0.85;
        ctx.strokeStyle = 'rgba(200, 236, 255, 0.75)'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(hvx, hvy, 16, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(160, 210, 255, 0.08)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(hvx, hvy, 13.4, 1.1 * Math.PI, 1.4 * Math.PI); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    function drawMash(x, y, sc, alpha) {
      if (alpha <= 0.01) return;
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(x, y + 6);
      ctx.scale(sc, sc);
      ctx.drawImage(sprMash, -SPR / 2, -SPR / 2 - 6, SPR, SPR);
      // little X eyes in the mash
      ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let s = -1; s <= 1; s += 2) {
        const ex = s * 3.6, ey = -0.6;
        ctx.moveTo(ex - 1.3, ey - 1.1); ctx.lineTo(ex + 1.3, ey + 1.1);
        ctx.moveTo(ex + 1.3, ey - 1.1); ctx.lineTo(ex - 1.3, ey + 1.1);
      }
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    function sparkle(x, y, s) {
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.quadraticCurveTo(x, y, x + s, y);
      ctx.quadraticCurveTo(x, y, x, y + s);
      ctx.quadraticCurveTo(x, y, x - s, y);
      ctx.quadraticCurveTo(x, y, x, y - s);
      ctx.fill();
    }

    /* ---------- drawing: critters ---------- */
    /* mode: 0 hunt, 1 scared, 2 gloat (it caught the hero), 3 dizzy (level clear) */
    function critFace(i, mode, lid, now, P) {
      const d = CRIT[i % CRIT.length];
      // look toward the hero
      let lx = hvx - GVX[i], ly = hvy - GVY[i];
      const l = Math.sqrt(lx * lx + ly * ly) || 1;
      lx /= l; ly /= l;
      if (deathOn) { lx = deathX - GVX[i]; ly = deathY - GVY[i]; const m = Math.sqrt(lx * lx + ly * ly) || 1; lx /= m; ly /= m; }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      const one = d.eyes === 1;
      const er = one ? 5.0 : 3.35;
      for (let e = 0; e < d.eyes; e++) {
        const ex = one ? 0 : (e ? 4.25 : -4.25), ey = one ? -2.2 : -2.4;
        if (mode === 2 || mode === 3) {
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          if (mode === 2) ctx.arc(ex, ey + er * 0.45, er * 0.72, 1.15 * Math.PI, 1.85 * Math.PI);
          else {
            // dizzy spiral
            const sp = now * 0.012 + i;
            for (let j = 0; j <= 14; j++) {
              const a = sp + j * 0.75, r = er * 0.85 * j / 14;
              if (j) ctx.lineTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r); else ctx.moveTo(ex, ey);
            }
          }
          ctx.stroke();
          continue;
        }
        const big = mode === 1 ? 1.1 : 1;
        ctx.fillStyle = CREAM; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(ex, ey, er * big, 0, TAU); ctx.fill(); ctx.stroke();
        if (mode === 1) {
          const jx = rm ? 0 : Math.sin(now * 0.05 + i * 2) * 0.55, jy = rm ? 0 : Math.cos(now * 0.043 + i) * 0.45;
          ctx.fillStyle = INK;
          ctx.beginPath(); ctx.arc(ex + jx, ey + jy + 0.3, one ? 1.25 : 0.95, 0, TAU); ctx.fill();
        } else {
          const pr = one ? 2.35 : 1.6, reach = one ? 1.8 : 1.15;
          const px = ex + lx * reach, py = ey + ly * reach;
          ctx.fillStyle = INK;
          ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(px - pr * 0.35, py - pr * 0.4, pr * 0.32, 0, TAU); ctx.fill();
          if (lid > 0.02) {
            // drowsy lid (waiting for the round to start)
            ctx.save();
            ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU); ctx.clip();
            ctx.fillStyle = P.base;
            ctx.fillRect(ex - er - 1, ey - er - 1, er * 2 + 2, (er * 2 + 1) * lid);
            ctx.restore();
            ctx.lineWidth = 1.3;
            const ly2 = ey - er + er * 2 * lid;
            const hw = Math.sqrt(Math.max(0, er * er - (ly2 - ey) * (ly2 - ey)));
            ctx.beginPath(); ctx.moveTo(ex - hw, ly2); ctx.lineTo(ex + hw, ly2); ctx.stroke();
          }
        }
      }
      // brows
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (mode === 0) {
        if (one) { ctx.moveTo(-4.8, -8.4); ctx.lineTo(4.6, -6.9); }
        else { ctx.moveTo(-6.6, -7.2); ctx.lineTo(-2.4, -5.9); ctx.moveTo(6.6, -7.2); ctx.lineTo(2.4, -5.9); }
      } else if (mode === 1) {
        if (one) { ctx.moveTo(-4.6, -8.6); ctx.lineTo(-1.2, -9.6); ctx.moveTo(4.6, -8.6); ctx.lineTo(1.2, -9.6); }
        else { ctx.moveTo(-6.4, -6.2); ctx.lineTo(-2.8, -7.4); ctx.moveTo(6.4, -6.2); ctx.lineTo(2.8, -7.4); }
      }
      ctx.stroke();
      // mouth
      const my = 5.6;
      if (mode === 1) {
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.ellipse(0, my, 1.7, rm ? 2 : 2 + Math.sin(now * 0.03 + i) * 0.35, 0, 0, TAU); ctx.fill();
      } else if (mode === 2) {
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.moveTo(-3.6, my - 0.8); ctx.quadraticCurveTo(0, my + 4.2, 3.6, my - 0.8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = CREAM; ctx.fillRect(-2.6, my - 0.6, 5.2, 0.9);
      } else if (mode === 3) {
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(-3, my); ctx.quadraticCurveTo(-1.5, my - 1.4, 0, my); ctx.quadraticCurveTo(1.5, my + 1.4, 3, my); ctx.stroke();
      } else {
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        if (d.mouth === 0) { ctx.moveTo(-3.6, my - 0.2); ctx.quadraticCurveTo(0, my + 2.6, 3.8, my - 1); ctx.stroke(); }
        else if (d.mouth === 1) {
          ctx.moveTo(-3.8, my); ctx.quadraticCurveTo(0, my + 2.4, 3.8, my); ctx.stroke();
          ctx.fillStyle = CREAM;
          ctx.beginPath(); ctx.moveTo(-2.6, my + 0.6); ctx.lineTo(-1.6, my + 2.6); ctx.lineTo(-0.8, my + 1.1); ctx.closePath();
          ctx.moveTo(2.6, my + 0.6); ctx.lineTo(1.6, my + 2.6); ctx.lineTo(0.8, my + 1.1); ctx.closePath();
          ctx.fill();
        } else if (d.mouth === 2) {
          ctx.moveTo(-3.8, my); ctx.lineTo(-1.9, my + 1.5); ctx.lineTo(0, my); ctx.lineTo(1.9, my + 1.5); ctx.lineTo(3.8, my); ctx.stroke();
        } else {
          ctx.moveTo(-3.2, my - 0.4); ctx.quadraticCurveTo(0, my + 2.4, 3.2, my - 0.4); ctx.stroke();
          ctx.fillStyle = CREAM;
          ctx.fillRect(-0.9, my + 0.5, 1.8, 1.5);
        }
      }
      // scared: sweat drop
      if (mode === 1) {
        const dy = rm ? 0 : ((now * 0.02 + i * 7) % 6);
        ctx.fillStyle = '#9fe3ff'; ctx.strokeStyle = INK; ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(9.6, -9.6 + dy);
        ctx.quadraticCurveTo(11.6, -6.6 + dy, 9.6, -5.6 + dy);
        ctx.quadraticCurveTo(7.6, -6.6 + dy, 9.6, -9.6 + dy);
        ctx.fill(); ctx.stroke();
      }
    }

    function drawCritter(now, i, x, y, lift, sx, sy, scaredMix, mode, lid, alpha, hopping) {
      if (alpha <= 0.01) return;
      const d = CRIT[i % CRIT.length];
      const P = scaredMix > 0.5 ? SCARED : d;
      ctx.globalAlpha = alpha;
      // glow + contact shadow on the floor
      ctx.globalAlpha = alpha * 0.85;
      ctx.drawImage(scaredMix > 0.5 ? sprGlowS : sprGlowC[i % CRIT.length], x - 20, y - 17, 40, 40);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(4, 2, 16, 0.42)';
      const shw = 9.4 * sx * (1 - lift * 0.05);
      ctx.beginPath(); ctx.ellipse(x, y + 11.4, shw, 2.5, 0, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(x, y + 11 - lift);
      ctx.scale(sx, sy);
      ctx.translate(0, -11);
      // feet (peek out under the body; tucked while hopping)
      const fy = hopping ? -1.4 : 0;
      const pat = (!rm && mode === 1) ? Math.sin(now * 0.04 + i) * 0.8 : 0;
      ctx.fillStyle = P.foot; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(-5.2, 10.4 + fy + pat, 3.3, 2.3, 0, 0, TAU);
      ctx.moveTo(8.5, 10.4 + fy - pat); ctx.ellipse(5.2, 10.4 + fy - pat, 3.3, 2.3, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
      // body (rm warning: colour returns gradually instead of flashing)
      if (scaredMix > 0 && scaredMix < 1) {
        ctx.drawImage(sprCrit[i % CRIT.length], -SPR / 2, -SPR / 2, SPR, SPR);
        ctx.globalAlpha = alpha * scaredMix;
        ctx.drawImage(sprCritS[i % CRIT.length], -SPR / 2, -SPR / 2, SPR, SPR);
        ctx.globalAlpha = alpha;
      } else {
        ctx.drawImage(scaredMix >= 1 ? sprCritS[i % CRIT.length] : sprCrit[i % CRIT.length], -SPR / 2, -SPR / 2, SPR, SPR);
      }
      critFace(i, mode, lid, now, P);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    function drawCritters(now, v) {
      const fright = v.frightMs;
      let scared = 0;
      if (fright > 0) {
        scared = 1;
        if (fright < WARN) {
          if (rm) scared = 0.25 + 0.75 * fright / WARN;
          else {
            // warning: flash back to their own colours, faster near the end
            const half = fright > 1000 ? 170 : 95;
            scared = ((fright / half) | 0) & 1 ? 0 : 1;
          }
        }
      }
      const idle = !v.running && !v.gameOver && !v.won && !deathOn;
      for (let i = 0; i < ng; i++) {
        let x = GVX[i], y = GVY[i], lift = LIFT[i], sx = 1, sy = 1, alpha = 1;
        let mode = scared > 0.5 ? 1 : 0;
        let lid = 0;
        const hopping = lift > 0.2;
        if (!rm) {
          // land squash after a hop, idle breathing otherwise
          const tl = now - HOP[i] - HOP_MS;
          if (tl > 0 && tl < 130) { const u = tl / 130; sy = 1 - Math.sin(u * Math.PI) * 0.12; sx = 1 + Math.sin(u * Math.PI) * 0.09; }
          else if (!hopping) { const b = Math.sin(now * 0.005 + i * 1.7) * 0.025; sy = 1 + b; sx = 1 - b * 0.6; }
          if (mode === 1) x += Math.sin(now * 0.09 + i * 3) * 0.45;   // shiver
        }
        if (idle) lid = 0.55;
        else if (v.running && v.graceMs > 0) lid = clamp(v.graceMs / 700, 0, 1) * 0.55;
        // eaten: poof where it was caught, pop back in at home
        const ep = now - POPIN[i];
        const et = now - EATEN[i];
        if (et >= 0 && et < 240 && !deathOn) {
          // the caught critter swells and bursts on the catch tile
          const u = et / 240;
          const s = rm ? 1 : 1 + easeOutCubic(u) * 0.55;
          drawCritter(now, i, EX[i], EY[i], 0, s, s * (rm ? 1 : 1 - u * 0.25), 1, 1, 0, 1 - u, false);
        }
        if (et < 900 && !deathOn) {
          if (ep < 0) continue;
          const u = clamp(ep / 340, 0, 1);
          if (rm) alpha = u; else { const s = Math.max(0.05, easeOutBack(u)); sx *= s; sy *= s; }
          if (ep < 30 && !rm) {
            ring(x, y, 2, T * 0.8, 320, 2, 'rgba(227, 231, 255, 0.9)', now);
            for (let j = 0; j < 6; j++) {
              const an = j / 6 * TAU;
              spawn(1, x + Math.cos(an) * 14, y + Math.sin(an) * 14, -Math.cos(an) * 50, -Math.sin(an) * 50, 260, 1.8, CREAM, 0, 1, now);
            }
            POPIN[i] -= 30;
          }
        }
        // the hero was caught: everyone freezes on screen, the catcher gloats
        if (deathOn) {
          const t = now - deathAt;
          x = FZX[i]; y = FZY[i]; lift = 0; mode = 0; lid = 0;
          if (i === deathGi) {
            mode = t > 140 ? 2 : 0;
            if (!rm) { const b = Math.abs(Math.sin(t * 0.016)) * 3 * clamp(1 - t / 1100, 0, 1); lift = b; }
          }
          if (regroupAt > 0) {
            // back to their homes: fade out here, pop in there
            const u = now - regroupAt;
            if (u < 170) alpha = 1 - u / 170;
            else {
              x = GVX[i]; y = GVY[i]; mode = 0; lid = v.running ? clamp(v.graceMs / 700, 0, 1) * 0.55 : 0.55;
              const w = clamp((u - 170) / 300, 0, 1);
              if (rm) alpha = w; else { const s = Math.max(0.05, easeOutBack(w)); sx = s; sy = s; }
            }
          }
          drawCritter(now, i, x, y, lift, sx, sy, 0, mode, lid, alpha, false);
          continue;
        }
        // level clear: dizzy, then poof one by one
        if (v.won && clearAt > 0) {
          const t = now - clearAt - 260 - i * 150;
          mode = 3; lid = 0;
          if (t > 0) {
            if (!POOF[i]) {
              POOF[i] = 1;
              if (!rm) {
                for (let j = 0; j < 6; j++) {
                  const an = R() * TAU, sp = 20 + R() * 36;
                  spawn(2, x, y, Math.cos(an) * sp, Math.sin(an) * sp - 10, 520 + R() * 200, 5 + R() * 3, '', 0, 2.2, now);
                }
                for (let j = 0; j < 6; j++) {
                  const an = R() * TAU, sp = 50 + R() * 60;
                  spawn(1, x, y, Math.cos(an) * sp, Math.sin(an) * sp, 380, 2.2, CRIT[i % CRIT.length].base, 0, 3, now);
                }
              }
            }
            const u = clamp(t / 240, 0, 1);
            alpha = 1 - u;
            if (!rm) { sx = 1 + u * 0.4; sy = 1 - u * 0.5; }
          } else if (!rm) {
            sx = 1 + Math.sin(now * 0.02 + i) * 0.05;
          }
          drawCritter(now, i, x, y, 0, sx, sy, 0, mode, 0, alpha, false);
          continue;
        }
        if (v.gameOver) { mode = 0; lid = 0; }
        drawCritter(now, i, x, y, lift, sx, sy, scared, mode, lid, alpha, hopping);
      }
    }

    /* ---------- drawing: board pieces ---------- */
    function drawPellets(now) {
      const tw = !rm;
      ctx.globalAlpha = 1;
      for (let i = 0; i < N; i++) {
        if (PEL[i] !== 1) continue;
        if (tw) ctx.globalAlpha = 0.8 + 0.2 * Math.sin(now * 0.0032 - (CX[i] + CY[i]) * 0.018);
        ctx.drawImage(sprDot, CX[i] - 7, CY[i] - 7, 14, 14);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < N; i++) {
        if (PEL[i] !== 2) continue;
        const x = CX[i], y = CY[i];
        const p = rm ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.006 + i);
        const hr = 15 + p * 5;
        ctx.globalAlpha = 0.55 + p * 0.35;
        ctx.drawImage(sprHalo, x - hr, y - hr, hr * 2, hr * 2);
        ctx.globalAlpha = 1;
        const s = 1 + (rm ? 0 : Math.sin(now * 0.006 + i) * 0.07);
        ctx.drawImage(sprOrb, x - 12 * s, y - 12 * s, 24 * s, 24 * s);
        if (!rm) {
          ctx.fillStyle = CREAM;
          for (let j = 0; j < 2; j++) {
            const an = now * 0.0035 + j * Math.PI + i;
            sparkle(x + Math.cos(an) * 10.5, y + Math.sin(an) * 7, 1.8 + 0.6 * Math.sin(now * 0.01 + j));
          }
        }
      }
    }

    /* power meter: an LED strip set into the top glass wall */
    function drawMeter(now, v) {
      const f = (v.won || deathOn) ? 0 : v.frightMs;
      if (f <= 0 && powerA < 0.02) return;
      const frac = clamp(f / POWER, 0, 1);
      const w = LW * 0.34, h = 6, x = (LW - w) / 2, y = T * 0.5 - 4.5;
      ctx.globalAlpha = clamp(powerA * 1.5, 0, 1);
      ctx.fillStyle = 'rgba(8, 4, 20, 0.72)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 1.5, y - 1.5, w + 3, h + 3, 4.5) : ctx.rect(x - 1.5, y - 1.5, w + 3, h + 3);
      ctx.fill(); ctx.stroke();
      if (frac > 0) {
        const warn = f < WARN;
        const on = rm || !warn || ((((f / 140) | 0) & 1) === 0);
        ctx.fillStyle = warn ? (on ? CORAL : '#7a2a3a') : PINK;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w * frac, h, 3) : ctx.rect(x, y, w * frac, h);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillRect(x + 2, y + 1, Math.max(0, w * frac - 4), 1.2);
      }
      ctx.globalAlpha = 1;
    }

    function drawFx(now, dt) {
      for (let i = 0; i < PN; i++) {
        const p = parts[i];
        if (!p.on) continue;
        const u = (now - p.t0) / p.life;
        if (u >= 1 || u < 0) { p.on = false; continue; }
        const dr = Math.max(0, 1 - p.drag * dt);
        p.vx *= dr; p.vy = p.vy * dr + p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.kind === 0) {
          ctx.globalAlpha = 1 - u * u;
          ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - u * 0.5), 0, TAU); ctx.fill();
        } else if (p.kind === 1) {
          ctx.globalAlpha = 1 - u;
          ctx.fillStyle = p.col;
          sparkle(p.x, p.y, p.r * (1 - u * 0.6));
        } else if (p.kind === 2) {
          ctx.globalAlpha = (1 - u) * 0.8;
          const s = p.r * (0.7 + u * 0.9);
          ctx.drawImage(sprPuff, p.x - s, p.y - s, s * 2, s * 2);
        } else if (p.kind === 3) {
          ctx.globalAlpha = 1 - u * u;
          ctx.fillStyle = INK;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 0.9, 0, TAU); ctx.fill();
          ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        } else {
          ctx.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 1;
          ctx.fillStyle = p.col;
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < rings.length; i++) {
        const q = rings[i];
        if (!q.on) continue;
        const u = (now - q.t0) / q.dur;
        if (u >= 1 || u < 0) { q.on = false; continue; }
        const e = rm ? 1 : easeOutCubic(u);
        ctx.globalAlpha = 1 - u;
        ctx.strokeStyle = q.col; ctx.lineWidth = Math.max(0.5, q.w * (1 - u * 0.7));
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r0 + (q.r1 - q.r0) * e, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      let any = false;
      for (let i = 0; i < pops.length; i++) if (pops[i].on) { any = true; break; }
      if (!any) return;
      ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (let i = 0; i < pops.length; i++) {
        const q = pops[i];
        if (!q.on) continue;
        const u = (now - q.t0) / 820;
        if (u >= 1 || u < 0) { q.on = false; continue; }
        const rise = rm ? 0 : easeOutCubic(Math.min(1, u * 1.4)) * T * 0.9;
        const sc = rm ? 1 : 0.7 + 0.3 * easeOutBack(Math.min(1, u * 3));
        const x = clamp(q.x, T * 1.2, LW - T * 1.2), y = Math.max(T * 0.9, q.y - T * 0.55 - rise);
        ctx.globalAlpha = u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35;
        ctx.save();
        ctx.translate(x, y); ctx.scale(sc, sc);
        ctx.fillStyle = q.col; ctx.fillText(q.txt, 0, 2.2);
        ctx.strokeStyle = INK; ctx.lineWidth = 3.4; ctx.strokeText(q.txt, 0, 0);
        ctx.fillStyle = CREAM; ctx.fillText(q.txt, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    function onClear(now) {
      clearAt = now;
      for (let i = 0; i < GM; i++) POOF[i] = 0;
      if (rm) return;
      ring(hvx, hvy, 4, T * 4, 700, 3, 'rgba(255, 246, 229, 0.9)', now);
      for (let j = 0; j < 46; j++) {
        const an = -Math.PI / 2 + (R() - 0.5) * 2.6, sp = 120 + R() * 160;
        spawn(4, hvx, hvy, Math.cos(an) * sp, Math.sin(an) * sp, 1100 + R() * 600, 2.2 + R() * 1.6, j % 7 === 0 ? accent : CONFETTI[j % CONFETTI.length], 260, 1.4, now);
      }
    }

    /* ---------- public ---------- */
    function draw(now, v) {
      if (needFit) fit();
      if (!v || !v.map || !built) return;
      const dt = lastNow ? clamp((now - lastNow) / 1000, 0, 0.05) : 0.016;
      lastNow = now;
      syncMap(v.map, v.player);
      if (wallsDirty) buildWalls();
      if (!wallsN) return;
      syncPellets(v.pellets, now);
      syncActors(v, now);

      // episodes
      if (deathOn && !deathFinal && v.gameOver) deathFinal = true;
      if (deathOn && !deathFinal && regroupAt < 0 && (now - deathAt > DEATH_MS || v.running)) { regroupAt = now; heroPopAt = now + 110; }
      if (deathOn && regroupAt > 0 && now - regroupAt > 520) { deathOn = false; regroupAt = -1e9; }
      if (v.won && !wasWon) onClear(now);
      wasWon = !!v.won;

      // power crossfade target: on while powered, flashing in the warning window
      let target = 0;
      if (v.frightMs > 0) {
        target = 1;
        if (v.frightMs < WARN) {
          if (rm) target = 0.3 + 0.7 * v.frightMs / WARN;
          else target = (((v.frightMs / (v.frightMs > 1000 ? 170 : 95)) | 0) & 1) ? 0.35 : 1;
        }
      }
      if (deathOn || v.won) target = 0;
      powerA += (target - powerA) * (1 - Math.exp(-dt * (rm ? 10 : 22)));
      if (Math.abs(target - powerA) < 0.004) powerA = target;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      let sx = 0, sy = 0;
      const st = now - shakeAt;
      if (!rm && st < 380) {
        const amp = 2.6 * Math.exp(-st / 120);
        sx = Math.sin(st * 0.11) * amp; sy = Math.cos(st * 0.137) * amp * 0.7;
        ctx.fillStyle = NEON.f2; ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.setTransform(kx, 0, 0, ky, sx * kx, sy * ky);
      if (powerA < 0.995) ctx.drawImage(wallsN, 0, 0, LW, LH);
      if (powerA > 0.005) {
        ctx.globalAlpha = powerA;
        ctx.drawImage(wallsH, 0, 0, LW, LH);
        ctx.globalAlpha = 1;
      }
      if (v.won && clearAt > 0) {
        // level clear: the neon pulses brighter
        const t = now - clearAt;
        const a = rm ? 0.35 : (t < 1500 ? 0.55 * (0.5 - 0.5 * Math.cos(t * 0.0126)) : 0.3);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a;
        ctx.drawImage(wallsN, 0, 0, LW, LH);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      drawMeter(now, v);
      drawPellets(now);
      if (deathOn) { drawHero(now, v); drawCritters(now, v); }
      else { drawCritters(now, v); drawHero(now, v); }
      if (deathOn && regroupAt > 0) {
        // hero pops back in at the spawn while the mash fades
        const save = deathOn; deathOn = false;
        drawHero(now, v);
        deathOn = save;
      }
      drawFx(now, dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    return {
      draw: draw,
      event: event,
      resize: () => { needFit = true; },
      deathHoldMs: () => (rm ? 350 : 1150),
      clearHoldMs: () => (rm ? 450 : 1650),
      reducedMotion: () => rm
    };
  }

  window.MazeChaseArt = { create: create, VERSION: 1 };
})();
