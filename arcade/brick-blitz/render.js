/* ==========================================================================
   Cartofia Brick Blitz — board art  (window.BrickBlitzArt)
   Pure presentation. draw(view) READS the game state that index.html hands it
   (bricks, paddle, ball, level, lives, flags) and never writes to it, so the
   physics, speeds, collision, scoring, lives, levels and reportResult in
   index.html stay exactly as they were.

   The cover (assets/games/brick-blitz.svg) come to life:
     - a plum arcade playfield: the cover's pink stage light and dot grid,
       a faint perspective floor, neon bounce walls and a coral drain edge
       (painted once into an offscreen canvas)
     - glossy ink-outlined candy bricks with the cover's highlight streak and
       a per-row engraved glyph (circle / diamond / triangle / square / star),
       so rows read by shape as well as colour; the palette shifts each level
     - bricks are pre-rendered sprites composited into a scene cache that is
       rebuilt only when a brick breaks or a new wall arrives
     - a theme-accent capsule paddle with a centre notch (aim cue), floor
       glow and a squash on every hit
     - a cream ball with a soft glow and a short comet trail
   Effects come from diffing the state at draw time, i.e. the FINAL state of
   each frame: a break burst at the brick that actually broke (shards fly away
   from the ball), "+10" pops, paddle / wall sparks, a cracked heart and a
   gentle shake when a life drains, confetti + shockwave on level clear, the
   new wall dropping in, and a dimmed, powered-down board on game over.

   DPR-aware (backing store follows the CSS size x devicePixelRatio, capped
   at 2x). prefers-reduced-motion: no shake, particles, drop-in, glint or
   squash; breaks and banners become short fades.
   Visual randomness uses its own seeded PRNG: the game's Math.random
   sequence (launch direction) is never touched.

   const art = BrickBlitzArt.create(canvas);
   art.draw(view)    every frame; view = { bricks, paddle, ball, level, lives,
                     score, running, paused, gameOver }  (read-only)
   ========================================================================== */
(function () {
  'use strict';
  if (window.BrickBlitzArt) return;

  const LW = 900, LH = 600;
  const TAU = Math.PI * 2;
  const INK = '#1b1230';
  const CREAM = '#fff6e5';
  const LEMON = '#ffd93d';
  const CORAL = '#ff6b4a';
  const PINK = '#ff52a2';
  const EDGE = '#0a0412';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easeOutCubic = (t) => { const u = 1 - t; return 1 - u * u * u; };
  const easeOutBack = (t) => { const u = t - 1; return 1 + 2.70158 * u * u * u + 1.70158 * u * u; };
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
  function hexRgb(v) {
    const s = String(v || '').trim();
    let m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) { const h = m[1]; return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]; }
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }
  function mixRgb(c, to, t) {
    return 'rgb(' + Math.round(c[0] + (to[0] - c[0]) * t) + ',' + Math.round(c[1] + (to[1] - c[1]) * t) + ',' + Math.round(c[2] + (to[2] - c[2]) * t) + ')';
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function mk() { return document.createElement('canvas'); }

  /* ---------- brick palettes (the cover's rows, plus Night Market violet) ---------- */
  const PAL = [
    { base: '#5ef0ff', light: '#dcfdff', dark: '#1fb0d6', deep: '#0b4f70', glyph: 0 },
    { base: '#ffd93d', light: '#fff6c4', dark: '#e9a10f', deep: '#7a4d00', glyph: 1 },
    { base: '#ff8c3a', light: '#ffd5b2', dark: '#e2541b', deep: '#7a2208', glyph: 2 },
    { base: '#ff5fa2', light: '#ffcae0', dark: '#d62873', deep: '#6e0a37', glyph: 3 },
    { base: '#a68dff', light: '#e8e0ff', dark: '#6d4fee', deep: '#2c1880', glyph: 4 }
  ];
  const NPAL = PAL.length;
  const SPARK_COLS = [CREAM, LEMON, '#ffffff', '#ffd0e6'];
  const DRAIN_COLS = [CORAL, '#ff9a5a', LEMON, PINK];

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    const R = prng(0xb71c4a);          // visual-only randomness

    /* ---------- environment ---------- */
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let rm = !!(mq && mq.matches);
    if (mq) {
      const onMq = () => { rm = mq.matches; };
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    }
    let accentRgb = [124, 92, 255];
    let confetti = ['#7c5cff', CORAL, '#3ee6a6', LEMON, '#5ef0ff', PINK];
    function readTheme() {
      let c = null;
      try { c = hexRgb(getComputedStyle(document.documentElement).getPropertyValue('--accent')); } catch (_) { c = null; }
      if (!c) return false;
      if (c[0] === accentRgb[0] && c[1] === accentRgb[1] && c[2] === accentRgb[2]) return false;
      accentRgb = c;
      confetti = [mixRgb(c, c, 0), CORAL, '#3ee6a6', LEMON, '#5ef0ff', PINK];
      return true;
    }
    readTheme();
    function onTheme() { if (readTheme() && ballSpr) { buildPaddle(); paintBg(); sceneDirty = true; } }
    document.addEventListener('cartofia:theme-changed', onTheme);
    window.addEventListener('cartofia:theme-changed', onTheme);
    window.addEventListener('load', onTheme);

    /* ---------- sizing / caches ---------- */
    let kx = 1, ky = 1, bw = 0, bh = 0, fxS = 1;
    let needFit = true;
    let FONT = '800 15px Unbounded, Outfit, system-ui, sans-serif';
    const bgCv = mk(), sceneCv = mk();
    let sceneDirty = true;
    let brickSpr = null, flashSpr = null, padSpr = null, padGrey = null, padGlow = null;
    let ballSpr = null, ballGrey = null, ballGlow = null, drainGlow = null;

    // geometry (refreshed from the live objects; these are the game's values)
    let BW = 79.2, BH = 22;            // brick
    let PW = 130, PH = 14;             // paddle
    let BR = 9;                        // ball radius
    const SP = 7;                      // brick sprite padding (outline + shadow)
    const PP = 6;                      // paddle sprite padding
    const BP = 4;                      // ball sprite padding
    const GLOW_R = 34;

    if (typeof ResizeObserver === 'function') {
      try { new ResizeObserver(() => { needFit = true; }).observe(canvas); } catch (_) { /* resize event covers it */ }
    }
    window.addEventListener('resize', () => { needFit = true; });

    function fit() {
      needFit = false;
      const r = canvas.getBoundingClientRect();
      const cssW = r.width > 40 ? r.width : LW;
      // 2x is retina-crisp and keeps phones at 60 fps (DPR 3 would be 2.25x the pixels)
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const tw = Math.round(clamp(cssW * dpr, 300, 2600));
      const th = Math.round(tw * LH / LW);
      if (tw !== canvas.width || th !== canvas.height) { canvas.width = tw; canvas.height = th; }
      // small boards (phones): effects and labels grow a little so they stay readable
      fxS = clamp(620 / cssW, 1, 1.9);
      FONT = '800 ' + Math.round(14 * fxS) + 'px Unbounded, Outfit, system-ui, sans-serif';
      if (tw !== bw || th !== bh || !ballSpr) {
        bw = tw; bh = th; kx = bw / LW; ky = bh / LH;
        bgCv.width = bw; bgCv.height = bh;
        sceneCv.width = bw; sceneCv.height = bh;
        buildSprites();
        paintBg();
        sceneDirty = true;
      }
    }

    function sprite(lw, lh) {
      const c = mk();
      c.width = Math.max(1, Math.ceil(lw * kx));
      c.height = Math.max(1, Math.ceil(lh * ky));
      const g = c.getContext('2d');
      g.setTransform(c.width / lw, 0, 0, c.height / lh, 0, 0);
      c._g = g;
      return c;
    }

    /* soft round glow, fixed 96px so stretching it never shows a square edge */
    function glowSprite(c0, c1, c2) {
      const c = mk();
      c.width = 96; c.height = 96;
      const g = c.getContext('2d');
      const gg = g.createRadialGradient(48, 48, 0, 48, 48, 47);
      gg.addColorStop(0, c0); gg.addColorStop(0.45, c1); gg.addColorStop(1, c2);
      g.fillStyle = gg; g.fillRect(0, 0, 96, 96);
      return c;
    }

    function buildSprites() {
      buildBricks();
      buildPaddle();
      buildBall();
      drainGlow = glowSprite('rgba(255, 140, 90, 0.9)', 'rgba(255, 82, 120, 0.35)', 'rgba(255, 82, 162, 0)');
    }

    /* ----- background ----- */
    function paintBg() {
      const g = bgCv.getContext('2d');
      g.setTransform(kx, 0, 0, ky, 0, 0);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      const r = prng(0x51a7);
      // deep plum base, lit near the wall (the cover's radial, taken down a few stops)
      const base = g.createRadialGradient(450, 150, 10, 450, 260, 660);
      base.addColorStop(0, '#3f1146');
      base.addColorStop(0.5, '#210a2d');
      base.addColorStop(1, EDGE);
      g.fillStyle = base; g.fillRect(0, 0, LW, LH);
      // pink stage light behind the brick wall
      const pk = g.createRadialGradient(450, 115, 0, 450, 115, 480);
      pk.addColorStop(0, 'rgba(255, 82, 162, 0.24)');
      pk.addColorStop(0.55, 'rgba(255, 82, 162, 0.07)');
      pk.addColorStop(1, 'rgba(255, 82, 162, 0)');
      g.fillStyle = pk; g.fillRect(0, 0, LW, LH);
      // perspective floor grid in the lower half, fading in toward the paddle
      const fg = g.createLinearGradient(0, 300, 0, LH);
      fg.addColorStop(0, 'rgba(255, 120, 200, 0)');
      fg.addColorStop(1, 'rgba(255, 120, 200, 0.13)');
      g.strokeStyle = fg; g.lineWidth = 1;
      g.beginPath();
      const hz = 300;
      for (let i = -16; i <= 16; i++) { g.moveTo(450 + i * 14, hz); g.lineTo(450 + i * 86, LH); }
      for (let j = 1; j <= 9; j++) { const t = j / 9, y = hz + (LH - hz) * t * t; g.moveTo(0, y); g.lineTo(LW, y); }
      g.stroke();
      // the cover's dot pattern
      g.fillStyle = 'rgba(255, 255, 255, 0.055)';
      g.beginPath();
      for (let y = 11; y < LH; y += 22) for (let x = 11; x < LW; x += 22) { g.moveTo(x + 1.15, y); g.arc(x, y, 1.15, 0, TAU); }
      g.fill();
      // a few faint stars in the upper dark
      for (let i = 0; i < 26; i++) {
        const x = r() * LW, y = 8 + r() * 240, s = 0.6 + r() * 1.1;
        g.globalAlpha = 0.12 + r() * 0.22;
        g.fillStyle = r() < 0.3 ? '#ffd0e6' : '#ffffff';
        g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      // theme-accent light pooled under the paddle lane
      g.save();
      g.translate(450, 596); g.scale(1, 0.3);
      const ag = g.createRadialGradient(0, 0, 0, 0, 0, 560);
      ag.addColorStop(0, rgba(accentRgb, 0.26));
      ag.addColorStop(1, rgba(accentRgb, 0));
      g.fillStyle = ag; g.fillRect(-560, -560, 1120, 1120);
      g.restore();
      // paddle rail: faint studs along the lane
      g.fillStyle = 'rgba(255, 255, 255, 0.07)';
      g.beginPath();
      for (let x = 15; x < LW; x += 30) { g.moveTo(x + 1.3, 565); g.arc(x, 565, 1.3, 0, TAU); }
      g.fill();
      // drain: a coral edge where the ball is lost
      const dr = g.createLinearGradient(0, 566, 0, LH);
      dr.addColorStop(0, 'rgba(255, 107, 74, 0)');
      dr.addColorStop(1, 'rgba(255, 107, 74, 0.2)');
      g.fillStyle = dr; g.fillRect(0, 566, LW, LH - 566);
      g.setLineDash([12, 9]);
      g.strokeStyle = 'rgba(255, 120, 90, 0.5)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, LH - 1.5); g.lineTo(LW, LH - 1.5); g.stroke();
      g.setLineDash([]);
      // vignette
      const vg = g.createRadialGradient(450, 290, 250, 450, 300, 640);
      vg.addColorStop(0, 'rgba(6, 2, 12, 0)');
      vg.addColorStop(1, 'rgba(6, 2, 12, 0.5)');
      g.fillStyle = vg; g.fillRect(0, 0, LW, LH);
      // neon bounce walls (left, right, top), fading toward the drain
      const wg = g.createLinearGradient(0, 0, 0, LH);
      wg.addColorStop(0, 'rgba(255, 150, 205, 0.7)');
      wg.addColorStop(0.75, 'rgba(255, 150, 205, 0.28)');
      wg.addColorStop(1, 'rgba(255, 150, 205, 0)');
      g.fillStyle = wg;
      g.fillRect(0, 0, 2.5, LH); g.fillRect(LW - 2.5, 0, 2.5, LH);
      g.fillStyle = 'rgba(255, 150, 205, 0.7)'; g.fillRect(0, 0, LW, 2.5);
      const gl = g.createLinearGradient(0, 0, 18, 0);
      gl.addColorStop(0, 'rgba(255, 82, 162, 0.16)'); gl.addColorStop(1, 'rgba(255, 82, 162, 0)');
      g.fillStyle = gl; g.fillRect(0, 0, 18, LH);
      const grr = g.createLinearGradient(LW, 0, LW - 18, 0);
      grr.addColorStop(0, 'rgba(255, 82, 162, 0.16)'); grr.addColorStop(1, 'rgba(255, 82, 162, 0)');
      g.fillStyle = grr; g.fillRect(LW - 18, 0, 18, LH);
      const gt = g.createLinearGradient(0, 0, 0, 18);
      gt.addColorStop(0, 'rgba(255, 82, 162, 0.16)'); gt.addColorStop(1, 'rgba(255, 82, 162, 0)');
      g.fillStyle = gt; g.fillRect(0, 0, LW, 18);
    }

    /* ----- bricks ----- */
    function glyph(g, kind, cx, cy, s) {
      g.beginPath();
      if (kind === 0) { g.arc(cx, cy, s * 0.82, 0, TAU); }
      else if (kind === 1) { g.moveTo(cx, cy - s); g.lineTo(cx + s * 0.85, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s * 0.85, cy); g.closePath(); }
      else if (kind === 2) { g.moveTo(cx, cy - s * 0.95); g.lineTo(cx + s * 0.98, cy + s * 0.72); g.lineTo(cx - s * 0.98, cy + s * 0.72); g.closePath(); }
      else if (kind === 3) { g.rect(cx - s * 0.72, cy - s * 0.72, s * 1.44, s * 1.44); }
      else {
        for (let i = 0; i < 8; i++) {
          const a = -Math.PI / 2 + i * Math.PI / 4, rad = (i & 1) ? s * 0.42 : s * 1.05;
          if (i) g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); else g.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        }
        g.closePath();
      }
    }

    function paintBrick(g, p, x, y, w, h) {
      const r = 5;
      // ink outline + soft drop shadow
      g.save();
      g.shadowColor = 'rgba(4, 0, 12, 0.62)';
      g.shadowBlur = 6 * kx; g.shadowOffsetY = 3.5 * ky;
      rr(g, x - 1.5, y - 1.5, w + 3, h + 3, r + 1.5);
      g.fillStyle = INK; g.fill();
      g.restore();
      // glossy body
      const gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, p.light);
      gr.addColorStop(0.34, p.base);
      gr.addColorStop(0.8, p.base);
      gr.addColorStop(1, p.dark);
      rr(g, x, y, w, h, r);
      g.fillStyle = gr; g.fill();
      g.save();
      rr(g, x, y, w, h, r); g.clip();
      // thickness lip along the bottom
      g.globalAlpha = 0.5; g.fillStyle = p.deep; g.fillRect(x, y + h - 4.2, w, 4.2);
      g.globalAlpha = 0.35; g.fillStyle = p.light; g.fillRect(x, y + h - 4.2, w, 0.9);
      // left lit / right shaded
      g.globalAlpha = 1;
      const sg = g.createLinearGradient(x, 0, x + w, 0);
      sg.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
      sg.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
      sg.addColorStop(1, 'rgba(20, 0, 30, 0.14)');
      g.fillStyle = sg; g.fillRect(x, y, w, h);
      // top rim light
      g.fillStyle = 'rgba(255, 255, 255, 0.45)'; g.fillRect(x, y, w, 1.3);
      g.restore();
      // the cover's highlight streak + glint
      g.lineCap = 'round';
      g.globalAlpha = 0.8; g.strokeStyle = '#ffffff'; g.lineWidth = 2.8;
      g.beginPath(); g.moveTo(x + 7.5, y + 5.6); g.lineTo(x + w * 0.36, y + 5.6); g.stroke();
      g.globalAlpha = 0.9; g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(x + w * 0.36 + 5.5, y + 5.6, 1.45, 0, TAU); g.fill();
      g.globalAlpha = 1;
      // engraved row glyph (shape cue, independent of colour)
      const gx = x + w - 13, gy = y + h / 2 - 0.4, gs = 4.6;
      glyph(g, p.glyph, gx, gy + 1, gs);
      g.fillStyle = 'rgba(255, 255, 255, 0.42)'; g.fill();
      glyph(g, p.glyph, gx, gy, gs);
      g.fillStyle = p.deep; g.globalAlpha = 0.62; g.fill();
      g.globalAlpha = 1;
    }

    function buildBricks() {
      const lw = BW + SP * 2, lh = BH + SP * 2 + 3;
      brickSpr = [];
      for (let i = 0; i < NPAL; i++) {
        const c = sprite(lw, lh);
        paintBrick(c._g, PAL[i], SP, SP, BW, BH);
        brickSpr.push(c);
      }
      flashSpr = sprite(lw, lh);
      rr(flashSpr._g, SP - 1.5, SP - 1.5, BW + 3, BH + 3, 6.5);
      flashSpr._g.fillStyle = '#ffffff'; flashSpr._g.fill();
    }

    /* ----- paddle ----- */
    function paintPaddle(g, c) {
      const x = PP, y = PP, w = PW, h = PH, r = h / 2;
      rr(g, x - 1.7, y - 1.7, w + 3.4, h + 3.4, r + 1.7);
      g.fillStyle = INK; g.fill();
      const gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, c.light); gr.addColorStop(0.45, c.base); gr.addColorStop(1, c.dark);
      rr(g, x, y, w, h, r);
      g.fillStyle = gr; g.fill();
      g.save();
      rr(g, x, y, w, h, r); g.clip();
      // bumper caps + grooves
      g.fillStyle = 'rgba(255, 255, 255, 0.13)';
      g.fillRect(x, y, 16, h); g.fillRect(x + w - 16, y, 16, h);
      g.fillStyle = 'rgba(27, 18, 48, 0.42)';
      g.fillRect(x + 16, y, 1.6, h); g.fillRect(x + w - 17.6, y, 1.6, h);
      // bottom lip
      g.fillStyle = 'rgba(27, 18, 48, 0.28)'; g.fillRect(x, y + h - 3.4, w, 3.4);
      g.restore();
      // the cover's highlight streak
      g.lineCap = 'round';
      g.strokeStyle = c.hi; g.lineWidth = 2.6; g.globalAlpha = 0.95;
      g.beginPath(); g.moveTo(x + 24, y + 4.1); g.lineTo(x + 60, y + 4.1); g.stroke();
      g.beginPath(); g.arc(x + 66, y + 4.1, 1.3, 0, TAU); g.fillStyle = c.hi; g.fill();
      g.globalAlpha = 1;
      // centre notch: where the ball bounces straight up
      g.fillStyle = INK; g.globalAlpha = 0.55;
      g.beginPath(); g.moveTo(x + w / 2 - 3.2, y + h); g.lineTo(x + w / 2, y + h - 4.2); g.lineTo(x + w / 2 + 3.2, y + h); g.closePath(); g.fill();
      g.globalAlpha = 1;
      // cap lights
      g.fillStyle = c.pip;
      g.beginPath(); g.arc(x + 8, y + h / 2, 2.1, 0, TAU); g.moveTo(x + w - 8 + 2.1, y + h / 2); g.arc(x + w - 8, y + h / 2, 2.1, 0, TAU); g.fill();
    }

    function buildPaddle() {
      const lw = PW + PP * 2, lh = PH + PP * 2;
      const a = accentRgb;
      padSpr = sprite(lw, lh);
      paintPaddle(padSpr._g, {
        light: mixRgb(a, [255, 255, 255], 0.5), base: mixRgb(a, a, 0), dark: mixRgb(a, [18, 8, 40], 0.42),
        hi: mixRgb(a, [255, 255, 255], 0.78), pip: CREAM
      });
      padGrey = sprite(lw, lh);
      paintPaddle(padGrey._g, { light: '#b9b3c8', base: '#7d7792', dark: '#47415a', hi: '#d8d3e3', pip: '#8d87a0' });
      padGlow = glowSprite(rgba(a, 0.6), rgba(a, 0.18), rgba(a, 0));
    }

    /* ----- ball ----- */
    function paintBall(g, c, r, grey) {
      g.beginPath(); g.arc(c, c, r + 1.0, 0, TAU); g.fillStyle = INK; g.fill();
      const rf = r - 0.7;
      const gr = g.createRadialGradient(c - rf * 0.38, c - rf * 0.42, rf * 0.08, c, c, rf * 1.05);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.42, grey ? '#d5d1de' : CREAM);
      gr.addColorStop(1, grey ? '#8a849c' : '#f2c6a6');
      g.beginPath(); g.arc(c, c, rf, 0, TAU); g.fillStyle = gr; g.fill();
      g.beginPath(); g.arc(c, c, rf * 0.7, 0.25, 1.45);
      g.strokeStyle = grey ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 150, 190, 0.6)'; g.lineWidth = 1.3; g.lineCap = 'round'; g.stroke();
      g.beginPath(); g.ellipse(c - rf * 0.34, c - rf * 0.42, rf * 0.28, rf * 0.18, -0.6, 0, TAU);
      g.fillStyle = '#ffffff'; g.fill();
    }
    function buildBall() {
      const s = (BR + BP) * 2;
      ballSpr = sprite(s, s); paintBall(ballSpr._g, s / 2, BR, false);
      ballGrey = sprite(s, s); paintBall(ballGrey._g, s / 2, BR, true);
      ballGlow = sprite(GLOW_R * 2, GLOW_R * 2);
      const g = ballGlow._g;
      const gg = g.createRadialGradient(GLOW_R, GLOW_R, 0, GLOW_R, GLOW_R, GLOW_R);
      gg.addColorStop(0, 'rgba(255, 244, 228, 0.5)');
      gg.addColorStop(0.32, 'rgba(255, 170, 210, 0.2)');
      gg.addColorStop(1, 'rgba(255, 82, 162, 0)');
      g.fillStyle = gg; g.fillRect(0, 0, GLOW_R * 2, GLOW_R * 2);
    }

    /* ---------- fx pools (preallocated: nothing is allocated per frame) ---------- */
    const PN = 220;
    const parts = [];
    for (let i = 0; i < PN; i++) parts.push({ on: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, t0: 0, life: 1, s: 1, rot: 0, vr: 0, col: '', u: 0 });
    const rings = [];
    for (let i = 0; i < 10; i++) rings.push({ on: false, x: 0, y: 0, t0: 0, dur: 1, r0: 0, r1: 0, w: 2, col: '', sy: 1 });
    const pops = [];
    for (let i = 0; i < 8; i++) pops.push({ on: false, x: 0, y: 0, t0: 0 });
    const ghosts = [];
    for (let i = 0; i < 10; i++) ghosts.push({ on: false, x: 0, y: 0, pal: 0, t0: 0 });

    function spawn(kind, x, y, vx, vy, life, s, col, g, drag, now) {
      for (let i = 0; i < PN; i++) {
        const p = parts[i];
        if (p.on) continue;
        p.on = true; p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.s = s;
        p.col = col; p.g = g; p.drag = drag; p.t0 = now; p.rot = R() * TAU; p.vr = (R() - 0.5) * 16; p.u = 0;
        return;
      }
    }
    function ring(x, y, r0, r1, dur, w, col, sy, now) {
      let q = rings[0];
      for (let i = 0; i < rings.length; i++) { if (!rings[i].on) { q = rings[i]; break; } if (rings[i].t0 < q.t0) q = rings[i]; }
      q.on = true; q.x = x; q.y = y; q.r0 = r0; q.r1 = r1; q.dur = dur; q.w = w; q.col = col; q.sy = sy; q.t0 = now;
    }
    function pop(x, y, now) {
      let q = pops[0];
      for (let i = 0; i < pops.length; i++) { if (!pops[i].on) { q = pops[i]; break; } if (pops[i].t0 < q.t0) q = pops[i]; }
      q.on = true; q.x = x; q.y = y; q.t0 = now;
    }
    function ghost(x, y, pal, now) {
      let q = ghosts[0];
      for (let i = 0; i < ghosts.length; i++) { if (!ghosts[i].on) { q = ghosts[i]; break; } if (ghosts[i].t0 < q.t0) q = ghosts[i]; }
      q.on = true; q.x = x; q.y = y; q.pal = pal; q.t0 = now;
    }

    /* ---------- tracking (diffs of the game's state, read-only) ---------- */
    const MAXB = 256;
    const snap = new Uint8Array(MAXB), palOf = new Uint8Array(MAXB), rowOf = new Uint8Array(MAXB), colOf = new Uint8Array(MAXB);
    let bricksRef = null, nB = 0, nCols = 10, introAt = -1e9, introOn = false;
    let lastLevel = 0, lastLives = -1, wasOver = false, overAt = -1e9;
    let prevVx = 0, prevVy = 0, prevStuck = true, prevBX = 450, prevBY = 500;
    let lastRunX = 450, lastBreakX = 450, lastBreakY = 120;
    let lastNow = 0;
    let shakeAt = -1e9, shakeAmp = 0, shakeDur = 1;
    let squashAt = -1e9, lostAt = -1e9, lostX = 450, heartX = 450, clearAt = -1e9;
    let glintAt = -1e9, glintNext = 0;
    const TMAX = 11;
    const trX = new Float32Array(TMAX), trY = new Float32Array(TMAX);
    let trN = 0;
    const seenCols = [];

    function adopt(v, now, levelUp) {
      const bricks = v.bricks;
      bricksRef = bricks;
      nB = Math.min(bricks.length, MAXB);
      if (nB && (bricks[0].w !== BW || bricks[0].h !== BH)) { BW = bricks[0].w; BH = bricks[0].h; buildBricks(); }
      seenCols.length = 0;
      const lvl = Math.max(1, v.level | 0);
      let cnt0 = 0, curRow = -1, col = 0;
      nCols = 1;
      for (let i = 0; i < nB; i++) {
        const b = bricks[i];
        let row = seenCols.indexOf(b.color);
        if (row < 0) { row = seenCols.length; seenCols.push(b.color); }
        if (row !== curRow) { curRow = row; col = 0; } else col++;
        if (row === 0) cnt0++;
        rowOf[i] = row; colOf[i] = col;
        palOf[i] = (row + lvl - 1) % NPAL;
        snap[i] = b.alive ? 1 : 0;
      }
      nCols = Math.max(1, cnt0);
      introAt = now + (levelUp ? 380 : 0);
      introOn = true;
      sceneDirty = true;
    }

    function breakBrick(b, i, bx, by, now) {
      const pi = palOf[i], p = PAL[pi];
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      lastBreakX = cx; lastBreakY = cy;
      ghost(b.x, b.y, pi, now);
      pop(cx, b.y, now);
      if (rm) return;
      // contact point: nearest point on the brick to the ball
      const px = clamp(bx, b.x, b.x + b.w), py = clamp(by, b.y, b.y + b.h);
      // debris flies away from the ball
      let dx = cx - bx, dy = cy - by;
      const dl = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= dl; dy /= dl;
      for (let k = 0; k < 10; k++) {
        const sp = 90 + R() * 210, sx = (R() - 0.5) * 220, sy = (R() - 0.5) * 160;
        const c = k % 3 === 0 ? p.light : (k % 3 === 1 ? p.base : p.dark);
        spawn(0, b.x + 6 + R() * (b.w - 12), b.y + 4 + R() * (b.h - 8), dx * sp + sx, dy * sp + sy - 60, 520 + R() * 380, (2.4 + R() * 2.6) * fxS, c, 820, 0.8, now);
      }
      for (let k = 0; k < 6; k++) {
        const an = R() * TAU, sp = 70 + R() * 190;
        spawn(1, px, py, Math.cos(an) * sp, Math.sin(an) * sp, 300 + R() * 240, (2.4 + R() * 2.4) * fxS, SPARK_COLS[k & 3], 0, 3.2, now);
      }
      ring(px, py, 3, 30 * Math.min(1.4, fxS), 300, 2.6, p.light, 1, now);
    }

    function paddleHit(now, x, y) {
      squashAt = now;
      if (rm) return;
      for (let k = 0; k < 7; k++) {
        const an = -Math.PI / 2 + (R() - 0.5) * 2.4, sp = 80 + R() * 170;
        spawn(1, x, y, Math.cos(an) * sp, Math.sin(an) * sp, 260 + R() * 200, (2 + R() * 2.2) * fxS, k & 1 ? CREAM : mixAccent, 0, 3.4, now);
      }
      ring(x, y + 1, 4, 34, 300, 2.4, CREAM, 0.42, now);
    }
    let mixAccent = '#b9a6ff';

    function wallHit(now, x, y, nx, ny) {
      if (rm) return;
      for (let k = 0; k < 4; k++) {
        const an = Math.atan2(ny, nx) + (R() - 0.5) * 2.0, sp = 60 + R() * 130;
        spawn(1, x, y, Math.cos(an) * sp, Math.sin(an) * sp, 220 + R() * 160, (1.8 + R() * 1.6) * fxS, k & 1 ? '#ffd0e6' : CREAM, 0, 3.6, now);
      }
      ring(x, y, 2, 20, 260, 2, 'rgba(255, 170, 215, 0.95)', 1, now);
    }

    function lifeLost(now) {
      lostAt = now;
      lostX = clamp(lastRunX, 40, LW - 40);
      heartX = clamp(lostX, 60, LW - 60);
      if (rm) return;
      shakeAt = now; shakeAmp = 4.5; shakeDur = 380;
      for (let k = 0; k < 18; k++) {
        const an = -Math.PI / 2 + (R() - 0.5) * 1.7, sp = 220 + R() * 330;
        spawn(k % 3 === 0 ? 1 : 2, lostX + (R() - 0.5) * 24, LH - 2, Math.cos(an) * sp, Math.sin(an) * sp, 520 + R() * 380, (2 + R() * 2.6) * fxS, DRAIN_COLS[k & 3], 700, 1.2, now);
      }
      ring(lostX, LH, 8, 120, 520, 4, 'rgba(255, 120, 90, 0.9)', 0.4, now);
    }

    function levelClear(now) {
      clearAt = now;
      if (rm) return;
      shakeAt = now; shakeAmp = 2; shakeDur = 260;
      ring(lastBreakX, lastBreakY, 10, 760, 820, 7, CREAM, 1, now);
      ring(lastBreakX, lastBreakY, 6, 520, 700, 4, mixAccent, 1, now);
      for (let k = 0; k < 30; k++) {
        const an = R() * TAU, sp = 160 + R() * 360;
        spawn(3, lastBreakX, lastBreakY, Math.cos(an) * sp, Math.sin(an) * sp - 120, 1300 + R() * 700, (4 + R() * 3) * fxS, confetti[k % confetti.length], 380, 1.6, now);
      }
      for (let k = 0; k < 40; k++) {
        spawn(3, R() * LW, -10 - R() * 80, (R() - 0.5) * 80, 60 + R() * 120, 1700 + R() * 900, (4 + R() * 3) * fxS, confetti[k % confetti.length], 160, 0.9, now);
      }
      for (let k = 0; k < 12; k++) {
        const an = R() * TAU, sp = 60 + R() * 240;
        spawn(1, lastBreakX, lastBreakY, Math.cos(an) * sp, Math.sin(an) * sp, 500 + R() * 400, (3 + R() * 3) * fxS, SPARK_COLS[k & 3], 0, 2.4, now);
      }
    }

    function track(v, now) {
      const bricks = v.bricks || [];
      const ball = v.ball;
      // where the ball was when it hit (after a level clear it has already been reset to the paddle)
      const hx = ball.stuck ? prevBX : ball.x, hy = ball.stuck ? prevBY : ball.y;
      if (bricks !== bricksRef) {
        let broke = false;
        if (bricksRef) {
          for (let i = 0; i < nB; i++) if (snap[i] && !bricksRef[i].alive) { breakBrick(bricksRef[i], i, hx, hy, now); broke = true; }
        }
        const up = !!bricksRef && (v.level | 0) > lastLevel;
        if (up && broke) levelClear(now);
        else if (up) { clearAt = now; }
        adopt(v, now, up);
      } else {
        for (let i = 0; i < nB; i++) {
          const a = bricks[i].alive ? 1 : 0;
          if (a !== snap[i]) {
            if (!a) breakBrick(bricks[i], i, hx, hy, now);
            snap[i] = a;
            sceneDirty = true;
          }
        }
      }
      lastLevel = v.level | 0;
      // lives
      if (lastLives >= 0 && v.lives < lastLives) lifeLost(now);
      lastLives = v.lives;
      if (v.gameOver && !wasOver) overAt = now;
      wasOver = !!v.gameOver;
      // ball: bounces + trail
      if (ball.stuck || v.gameOver) {
        trN = 0;
      } else {
        if (!prevStuck) {
          if (prevVy > 0 && ball.vy < 0 && ball.y > v.paddle.y - 40) paddleHit(now, ball.x, v.paddle.y);
          else if (prevVy < 0 && ball.vy > 0 && ball.y <= ball.r + 8) wallHit(now, ball.x, 0, 0, 1);
          if (prevVx !== 0 && (prevVx > 0) !== (ball.vx > 0)) {
            if (ball.x <= ball.r + 8) wallHit(now, 0, ball.y, 1, 0);
            else if (ball.x >= LW - ball.r - 8) wallHit(now, LW, ball.y, -1, 0);
          }
        }
        const dx = ball.x - trX[0], dy = ball.y - trY[0], d2 = dx * dx + dy * dy;
        if (trN === 0 || d2 > 2500) { trN = 1; trX[0] = ball.x; trY[0] = ball.y; }
        else if (d2 > 0.2) {
          for (let i = Math.min(trN, TMAX - 1); i > 0; i--) { trX[i] = trX[i - 1]; trY[i] = trY[i - 1]; }
          trX[0] = ball.x; trY[0] = ball.y;
          if (trN < TMAX) trN++;
        }
        lastRunX = ball.x;
      }
      prevVx = ball.vx; prevVy = ball.vy; prevStuck = ball.stuck; prevBX = ball.x; prevBY = ball.y;
    }

    /* ---------- drawing ---------- */
    function drawBrickAt(g, b, pi, oy) {
      g.drawImage(brickSpr[pi], b.x - SP, b.y - SP + oy, BW + SP * 2, BH + SP * 2 + 3);
    }
    function composeScene(bricks) {
      const g = sceneCv.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.drawImage(bgCv, 0, 0);
      g.setTransform(kx, 0, 0, ky, 0, 0);
      for (let i = 0; i < nB; i++) if (bricks[i].alive) drawBrickAt(g, bricks[i], palOf[i], 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      sceneDirty = false;
    }
    /* the new wall drops in row by row (reduced motion: a short fade) */
    function drawIntro(bricks, now) {
      ctx.drawImage(bgCv, 0, 0, LW, LH);
      let pending = false;
      const mid = (nCols - 1) / 2;
      for (let i = 0; i < nB; i++) {
        const b = bricks[i];
        if (!b.alive) continue;
        const d = rm ? introAt : introAt + rowOf[i] * 60 + Math.abs(colOf[i] - mid) * 22;
        const u = (now - d) / (rm ? 220 : 440);
        if (u <= 0) { pending = true; continue; }
        if (u >= 1) { drawBrickAt(ctx, b, palOf[i], 0); continue; }
        pending = true;
        if (rm) { ctx.globalAlpha = u; drawBrickAt(ctx, b, palOf[i], 0); }
        else { ctx.globalAlpha = Math.min(1, u * 3); drawBrickAt(ctx, b, palOf[i], -36 * (1 - easeOutBack(u))); }
        ctx.globalAlpha = 1;
      }
      if (!pending) { introOn = false; sceneDirty = true; }
    }

    function drawGlint(v, now) {
      if (rm) return;
      if (v.running && !v.paused && !v.gameOver && now > glintNext) {
        if (glintNext === 0) glintNext = now + 2500;
        else { glintAt = now; glintNext = now + 6500 + R() * 3500; }
      }
      const u = (now - glintAt) / 1100;
      if (u < 0 || u >= 1) return;
      const bricks = v.bricks;
      const sx0 = -160 + u * (LW + 420);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
      for (let i = 0; i < nB; i++) {
        const b = bricks[i];
        if (!b.alive) continue;
        const sx = sx0 - (b.y - 58) * 0.9;
        if (sx < b.x - 30 || sx > b.x + b.w + 30) continue;
        ctx.save();
        rr(ctx, b.x, b.y, b.w, b.h, 5); ctx.clip();
        ctx.beginPath();
        ctx.moveTo(sx - 4, b.y - 2); ctx.lineTo(sx + 12, b.y - 2); ctx.lineTo(sx + 2, b.y + b.h + 2); ctx.lineTo(sx - 14, b.y + b.h + 2);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawGhosts(now) {
      for (let i = 0; i < ghosts.length; i++) {
        const q = ghosts[i];
        if (!q.on) continue;
        const dur = rm ? 160 : 200;
        const u = (now - q.t0) / dur;
        if (u >= 1) { q.on = false; continue; }
        const sc = rm ? 1 : 1 + 0.2 * easeOutCubic(u);
        const w = (BW + SP * 2) * sc, h = (BH + SP * 2 + 3) * sc;
        const cx = q.x + BW / 2, cy = q.y + BH / 2 + 1.5;
        ctx.globalAlpha = 1 - u;
        ctx.drawImage(brickSpr[q.pal], cx - w / 2, cy - h / 2, w, h);
        ctx.globalAlpha = (1 - u) * (rm ? 0.5 : 0.85);
        ctx.drawImage(flashSpr, cx - w / 2, cy - h / 2, w, h);
      }
      ctx.globalAlpha = 1;
    }

    function stepParts(now, dt) {
      for (let i = 0; i < PN; i++) {
        const p = parts[i];
        if (!p.on) continue;
        const u = (now - p.t0) / p.life;
        if (u >= 1) { p.on = false; continue; }
        const dr = Math.max(0, 1 - p.drag * dt);
        p.vx *= dr; p.vy = p.vy * dr + p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.u = u;
      }
    }
    /* solid debris: brick shards (kind 0) and confetti (kind 3) */
    function drawSolids() {
      ctx.lineJoin = 'round';
      for (let i = 0; i < PN; i++) {
        const p = parts[i];
        if (!p.on || (p.kind !== 0 && p.kind !== 3)) continue;
        const u = p.u;
        ctx.globalAlpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        const hw = p.s, hh = p.kind === 3 ? p.s * 0.55 * Math.abs(Math.cos(p.rot * 1.7)) + 0.4 : p.s * 0.62;
        const ax = c * hw, ay = s * hw, bx = -s * hh, by = c * hh;
        ctx.beginPath();
        ctx.moveTo(p.x + ax + bx, p.y + ay + by);
        ctx.lineTo(p.x - ax + bx, p.y - ay + by);
        ctx.lineTo(p.x - ax - bx, p.y - ay - by);
        ctx.lineTo(p.x + ax - bx, p.y + ay - by);
        ctx.closePath();
        if (p.kind === 0) { ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke(); }
        ctx.fillStyle = p.col; ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    /* light: sparks (kind 1) and embers (kind 2), additive */
    function drawLights() {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < PN; i++) {
        const p = parts[i];
        if (!p.on || (p.kind !== 1 && p.kind !== 2)) continue;
        const u = p.u;
        ctx.globalAlpha = 1 - u;
        ctx.fillStyle = p.col;
        ctx.beginPath();
        if (p.kind === 1) {
          const s = p.s * (1 - u * 0.6);
          ctx.moveTo(p.x, p.y - s);
          ctx.quadraticCurveTo(p.x, p.y, p.x + s, p.y);
          ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s);
          ctx.quadraticCurveTo(p.x, p.y, p.x - s, p.y);
          ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s);
        } else {
          ctx.arc(p.x, p.y, p.s * (1 - u * 0.5), 0, TAU);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    function drawRings(now) {
      for (let i = 0; i < rings.length; i++) {
        const q = rings[i];
        if (!q.on) continue;
        const u = (now - q.t0) / q.dur;
        if (u >= 1) { q.on = false; continue; }
        const e = easeOutCubic(u);
        ctx.globalAlpha = 1 - u;
        ctx.strokeStyle = q.col;
        ctx.lineWidth = Math.max(0.6, q.w * (1 - u * 0.7));
        ctx.beginPath();
        ctx.ellipse(q.x, q.y, q.r0 + (q.r1 - q.r0) * e, (q.r0 + (q.r1 - q.r0) * e) * q.sy, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function drawPops(now) {
      ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      for (let i = 0; i < pops.length; i++) {
        const q = pops[i];
        if (!q.on) continue;
        const u = (now - q.t0) / 720;
        if (u >= 1) { q.on = false; continue; }
        const rise = rm ? 0 : easeOutCubic(Math.min(1, u * 1.3)) * 26 * fxS;
        const sc = rm ? 1 : 0.65 + 0.35 * easeOutBack(Math.min(1, u * 3.2));
        const x = clamp(q.x, 30 * fxS, LW - 30 * fxS), y = Math.max(12 * fxS, q.y - 2 - rise);
        ctx.globalAlpha = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
        ctx.save();
        ctx.translate(x, y); ctx.scale(sc, sc);
        ctx.strokeStyle = INK; ctx.lineWidth = 4 * Math.min(1.4, fxS); ctx.strokeText('+10', 0, 0);
        ctx.fillStyle = CREAM; ctx.fillText('+10', 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    function heartPath(cx, cy, s) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.92);
      ctx.bezierCurveTo(cx - s * 1.3, cy + s * 0.05, cx - s * 0.98, cy - s * 1.08, cx, cy - s * 0.42);
      ctx.bezierCurveTo(cx + s * 0.98, cy - s * 1.08, cx + s * 1.3, cy + s * 0.05, cx, cy + s * 0.92);
      ctx.closePath();
    }
    function paintHeart(s) {
      heartPath(0, 0, s);
      ctx.strokeStyle = INK; ctx.lineWidth = 3.2; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = CORAL; ctx.fill();
      ctx.beginPath(); ctx.arc(-s * 0.42, -s * 0.3, s * 0.26, Math.PI * 1.05, Math.PI * 1.65);
      ctx.strokeStyle = '#ffd5c8'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
    }
    /* zig-zag crack down the middle: clip one half of the heart */
    function halfClip(side, s) {
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.3);
      ctx.lineTo(s * 0.12, -s * 0.5); ctx.lineTo(-s * 0.14, -s * 0.12); ctx.lineTo(s * 0.12, s * 0.28); ctx.lineTo(-s * 0.06, s * 0.6); ctx.lineTo(0, s * 1.2);
      ctx.lineTo(side * s * 1.6, s * 1.2); ctx.lineTo(side * s * 1.6, -s * 1.3);
      ctx.closePath();
      ctx.clip();
    }
    function drawLifeLost(now) {
      const t = now - lostAt;
      if (t < 0 || t > 1100) return;
      // drain flash at the spot the ball fell through
      const fu = t / 650;
      if (fu < 1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - fu) * (rm ? 0.6 : 0.9);
        const w = 170 + (rm ? 0 : 60 * easeOutCubic(fu)), h = 80;
        ctx.drawImage(drainGlow, lostX - w, LH - h, w * 2, h * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      // cracked heart rising from the drain
      const s = 13 * fxS;
      const a = t < 760 ? 1 : 1 - (t - 760) / 340;
      ctx.globalAlpha = Math.max(0, a);
      if (rm) {
        ctx.save(); ctx.translate(heartX, LH - 70); paintHeart(s); ctx.restore();
        ctx.globalAlpha = 1;
        return;
      }
      const rise = easeOutCubic(Math.min(1, t / 520)) * 70;
      const cy = LH - 26 - rise;
      const sc = 0.5 + 0.5 * easeOutBack(Math.min(1, t / 260));
      const split = clamp((t - 300) / 420, 0, 1);
      const sep = easeOutCubic(split) * 9, ang = easeOutCubic(split) * 0.42;
      for (let side = -1; side <= 1; side += 2) {
        ctx.save();
        ctx.translate(heartX + side * sep, cy + split * 6);
        ctx.rotate(side * ang);
        ctx.scale(sc, sc);
        if (split > 0) halfClip(side, s);
        paintHeart(s);
        ctx.restore();
        if (split === 0) break;
      }
      ctx.globalAlpha = 1;
    }

    function drawPaddle(v, now) {
      const p = v.paddle;
      const over = !!v.gameOver;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      // accent glow pooled on the floor
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = over ? 0.12 : 0.6;
      ctx.drawImage(padGlow, cx - p.w * 0.85, cy - 22, p.w * 1.7, 50);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      // cover's soft shadow ellipse
      ctx.fillStyle = 'rgba(4, 0, 10, 0.5)';
      ctx.beginPath(); ctx.ellipse(cx + 2, p.y + p.h + 7, p.w * 0.45, 3.6, 0, 0, TAU); ctx.fill();
      // squash on hit (spring), dip after a lost life
      let sqx = 1, sqy = 1;
      if (!rm) {
        const t = now - squashAt;
        if (t < 320) { const e = Math.exp(-t / 75) * Math.cos(t / 40); sqy = 1 - 0.24 * e; sqx = 1 + 0.045 * e; }
      }
      let a = 1;
      const lt = now - lostAt;
      if (!rm && !over && lt >= 0 && lt < 700) a = 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(lt / 700 * TAU * 2));
      const lw = (p.w + PP * 2) * sqx, lh = (p.h + PP * 2) * sqy;
      ctx.globalAlpha = a;
      // anchored at the bottom: the hit presses the top face down
      ctx.drawImage(over ? padGrey : padSpr, cx - lw / 2, p.y + p.h + PP - lh, lw, lh);
      ctx.globalAlpha = 1;
    }

    function drawBall(v, now) {
      const b = v.ball;
      const over = !!v.gameOver;
      const r = b.r;
      // comet trail
      if (trN > 1 && !over) {
        const n = rm ? Math.min(trN, 4) : trN;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ffc4e0';
        for (let i = n - 1; i >= 1; i--) {
          const f = 1 - i / n;
          ctx.globalAlpha = 0.26 * f + 0.04;
          ctx.beginPath(); ctx.arc(trX[i], trY[i], r * (0.35 + 0.6 * f), 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      // glow
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = over ? 0.15 : 0.85;
      ctx.drawImage(ballGlow, b.x - GLOW_R, b.y - GLOW_R, GLOW_R * 2, GLOW_R * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      // ready-to-launch halo
      if (b.stuck && !v.running && !over) {
        const ph = rm ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.005);
        ctx.globalAlpha = 0.35 + 0.4 * ph;
        ctx.strokeStyle = CREAM; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(b.x, b.y, r + 5 + ph * 3, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // shadow + ball
      ctx.fillStyle = 'rgba(4, 0, 10, 0.42)';
      ctx.beginPath(); ctx.arc(b.x + 2.5, b.y + 4.5, r, 0, TAU); ctx.fill();
      const s = r + BP;
      ctx.drawImage(over ? ballGrey : ballSpr, b.x - s, b.y - s, s * 2, s * 2);
    }

    function draw(v) {
      const now = (window.performance && performance.now) ? performance.now() : Date.now();
      if (needFit || !ballSpr) fit();
      const dt = lastNow ? clamp((now - lastNow) / 1000, 0, 0.05) : 1 / 60;
      lastNow = now;
      if (v.ball && v.ball.r !== BR) { BR = v.ball.r; buildBall(); }
      if (v.paddle && (v.paddle.w !== PW || v.paddle.h !== PH)) { PW = v.paddle.w; PH = v.paddle.h; buildPaddle(); }
      track(v, now);
      stepParts(now, dt);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      let sx = 0, sy = 0;
      const st = now - shakeAt;
      if (!rm && st >= 0 && st < shakeDur) {
        const amp = shakeAmp * Math.exp(-st / (shakeDur * 0.32));
        sx = Math.sin(st * 0.09) * amp; sy = Math.cos(st * 0.117) * amp * 0.7;
        ctx.fillStyle = EDGE; ctx.fillRect(0, 0, bw, bh);
      }
      ctx.setTransform(kx, 0, 0, ky, sx * kx, sy * ky);

      // board: background + bricks (one cached blit unless the wall is dropping in)
      if (introOn) drawIntro(v.bricks, now);
      else {
        if (sceneDirty) composeScene(v.bricks);
        ctx.drawImage(sceneCv, 0, 0, LW, LH);
      }
      drawGlint(v, now);
      drawGhosts(now);
      drawSolids();
      drawPaddle(v, now);
      drawBall(v, now);
      drawLights();
      drawRings(now);
      drawLifeLost(now);
      drawPops(now);

      // level clear: a quick flash over the board
      const cu = (now - clearAt) / 420;
      if (cu >= 0 && cu < 1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - cu) * (rm ? 0.12 : 0.22);
        ctx.fillStyle = '#ffe3f0'; ctx.fillRect(0, 0, LW, LH);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      // game over: the board powers down
      if (v.gameOver) {
        const ou = rm ? 1 : clamp((now - overAt) / 500, 0, 1);
        ctx.globalAlpha = 0.42 * ou;
        ctx.fillStyle = '#07030e'; ctx.fillRect(-8, -8, LW + 16, LH + 16);
        ctx.globalAlpha = 1;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // accent tint used by a few sparks / rings
    function refreshMix() { mixAccent = mixRgb(accentRgb, [255, 255, 255], 0.45); }
    refreshMix();
    document.addEventListener('cartofia:theme-changed', refreshMix);
    window.addEventListener('cartofia:theme-changed', refreshMix);

    fit();

    return {
      draw: draw,
      resize: function () { needFit = true; },
      reducedMotion: function () { return rm; }
    };
  }

  window.BrickBlitzArt = { create: create, VERSION: 1 };
})();
