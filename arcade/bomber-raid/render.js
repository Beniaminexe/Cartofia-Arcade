/* Bomber Raid — canvas art renderer (v1).
 *
 * Visual only. render(view) READS the game state that index.html hands it
 * (map, players, enemies, bombs, explosions, power-ups, flags) and never
 * writes to it. Gameplay, timing, collision, bot AI, the wire protocol and
 * the game's Math.random() sequence are untouched: every random number used
 * for effects comes from the private vr() generator below.
 *
 * Layers:   arena base (floor + solid walls, cached offscreen, DPR-aware)
 *         + crates      (pre-rendered sprites composited into a second cache,
 *                        rebuilt only when a crate breaks or a new map starts)
 *         + per-frame   scorch, power-ups, bombs, characters, flames,
 *                       particles, rings, floating text, markers.
 * Effects are derived from state diffs, so the online guest (which only
 * receives snapshots) gets the same explosions, pickups and deaths.
 */
(function () {
  'use strict';
  if (window.BomberRaidArt) return;

  var W = 13, H = 11, T = 48, LW = W * T, LH = H * T, N = W * H;
  var INK = '#1b1230';

  /* ---------- palettes ---------- */
  var CHAR = {
    p1: { kind: 'raider', crest: 'fin',  base: '#56b8ff', light: '#c4e9ff', dark: '#2a7fe0', deep: '#14397f', trim: '#ff6b4a', trimL: '#ffb29c', trimD: '#b8391f', tag: 'P1' },
    p2: { kind: 'raider', crest: 'ears', base: '#3ee6a6', light: '#b8f9dd', dark: '#14ad78', deep: '#0a5a3e', trim: '#ffcf5c', trimL: '#fff0bf', trimD: '#a8861a', tag: 'P2' },
    e0: { kind: 'bot', top: 'antenna', eye: 'round', base: '#ff5d6c', light: '#ffb8bf', dark: '#d22a43', deep: '#6f1022' },
    e1: { kind: 'bot', top: 'rotor',   eye: 'slit',  base: '#a07bff', light: '#ddd0ff', dark: '#6a44e6', deep: '#2f1b80' },
    e2: { kind: 'bot', top: 'horns',   eye: 'twin',  base: '#ffc23d', light: '#ffeaa8', dark: '#df8f16', deep: '#7d4a06' }
  };
  var CKEYS = ['p1', 'p2', 'e0', 'e1', 'e2'];
  var PU = {
    bomb:   { base: '#ffcf5c', light: '#fff3c4', dark: '#d1920c', label: '+BOMB' },
    range:  { base: '#ff6b4a', light: '#ffc6b4', dark: '#c23a1c', label: '+RANGE' },
    speed:  { base: '#3ee6a6', light: '#c6fbe5', dark: '#119a69', label: '+SPEED' },
    shield: { base: '#8f74ff', light: '#e0d6ff', dark: '#5536dd', label: '+SHIELD' }
  };
  var PU_KEYS = [null, 'bomb', 'range', 'speed', 'shield'];
  var PU_CODE = { bomb: 1, range: 2, speed: 3, shield: 4 };

  /* particle colours (constant strings: nothing is allocated per frame) */
  var PCOL = ['#fff6d0', '#ffe066', '#ffb43a', '#ff7a1a', '#c8643a', '#8c3b20', '#5a4f80', '#2a2140',
    '#f5f0ff', '#7c5cff', '#3ee6a6', '#ffcf5c', '#ff6b4a', '#56b8ff', '#ff5d6c', '#a07bff', '#ffc23d', '#b4abe4', '#e8875a'];
  var C_WHITE = 0, C_LEMON = 1, C_AMBER = 2, C_ORANGE = 3, C_BRICK = 4, C_BRICKD = 5, C_SLATE = 6, C_BOMB = 7,
    C_TEXT = 8, C_VIOLET = 9, C_MINT = 10, C_GOLD = 11, C_CORAL = 12, C_SKY = 13, C_RED = 14, C_PURP = 15, C_AMB2 = 16,
    C_STEEL = 17, C_BRICKL = 18;
  var CHAR_PCOL = { p1: C_SKY, p2: C_MINT, e0: C_RED, e1: C_PURP, e2: C_AMB2 };
  var PU_PCOL = [C_WHITE, C_GOLD, C_CORAL, C_MINT, C_VIOLET];
  var CONFETTI = [C_VIOLET, C_CORAL, C_MINT, C_GOLD, C_SKY, C_TEXT];

  /* ---------- helpers ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeOutCubic(t) { t = 1 - t; return 1 - t * t * t; }
  function easeOutBack(t) { var c1 = 1.9, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; }
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  /* visual-only PRNG (mulberry32) — keeps the game's Math.random() sequence untouched */
  var vseed = 0x2f6b1d3 | 0;
  function vr() {
    vseed = (vseed + 0x6D2B79F5) | 0;
    var t = Math.imul(vseed ^ (vseed >>> 15), 1 | vseed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function hash(x, y, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function rr(k, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    k.beginPath();
    k.moveTo(x + r, y);
    k.arcTo(x + w, y, x + w, y + h, r);
    k.arcTo(x + w, y + h, x, y + h, r);
    k.arcTo(x, y + h, x, y, r);
    k.arcTo(x, y, x + w, y, r);
    k.closePath();
  }
  function star(k, cx, cy, R, r, n, rot) {
    k.beginPath();
    for (var i = 0; i < n * 2; i++) {
      var a = rot + i * Math.PI / n, rad = (i & 1) ? r : R;
      if (i === 0) k.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      else k.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    k.closePath();
  }

  function create(canvas) {
    var ctx = canvas.getContext('2d');
    var S = 1, SX = 1, SY = 1, bw = 0, bh = 0;
    var needResize = true;
    var sprites = null;
    var baseCv = document.createElement('canvas'), baseK = baseCv.getContext('2d');
    var compCv = document.createElement('canvas'), compK = compCv.getContext('2d');
    var baseDirty = true, compDirty = true;

    /* reduced motion */
    var rmq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var RM = !!(rmq && rmq.matches);
    if (rmq) {
      var onRm = function () { RM = rmq.matches; };
      if (rmq.addEventListener) rmq.addEventListener('change', onRm); else if (rmq.addListener) rmq.addListener(onRm);
    }

    /* theme accent (local-player marker) */
    var accent = '#7c5cff';
    function readTheme() {
      try {
        var v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        if (/^#[0-9a-f]{6}$/i.test(v)) accent = v;
      } catch (e) { /* keep default */ }
    }
    readTheme();
    document.addEventListener('cartofia:theme-changed', function () { readTheme(); });
    window.addEventListener('load', readTheme);

    if (window.ResizeObserver) { try { new ResizeObserver(function () { needResize = true; }).observe(canvas); } catch (e) { /* ignore */ } }
    window.addEventListener('resize', function () { needResize = true; });

    function applySize() {
      needResize = false;
      var w = canvas.getBoundingClientRect().width;
      if (!(w > 40)) w = LW;
      var dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));   // same cap as Ludo: crisp, and kind to phone GPUs
      var tw = Math.round(clamp(w * dpr, 312, 2600));
      var th = Math.round(tw * LH / LW);
      if (tw !== canvas.width || th !== canvas.height) { canvas.width = tw; canvas.height = th; }
      if (tw !== bw || th !== bh || !sprites) {
        bw = tw; bh = th; SX = bw / LW; SY = bh / LH; S = SX;
        baseCv.width = bw; baseCv.height = bh; compCv.width = bw; compCv.height = bh;
        buildSprites();
        baseDirty = true; compDirty = true;
      }
    }

    /* ======================= sprites ======================= */
    function mk(wL, hL, fn) {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(wL * S)); c.height = Math.max(1, Math.ceil(hL * S));
      var k = c.getContext('2d');
      k.setTransform(c.width / wL, 0, 0, c.height / hL, 0, 0);
      k.lineJoin = 'round'; k.lineCap = 'round';
      fn(k);
      return c;
    }
    function whiteOf(src) {
      var c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      var k = c.getContext('2d');
      k.drawImage(src, 0, 0); k.globalCompositeOperation = 'source-in'; k.fillStyle = '#fff'; k.fillRect(0, 0, c.width, c.height);
      return c;
    }
    function radialSprite(stops, sy) {
      return mk(64, 64 * (sy || 1), function (k) {
        k.save(); k.scale(1, sy || 1);
        var g = k.createRadialGradient(32, 32, 0, 32, 32, 32);
        for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
        k.fillStyle = g; k.fillRect(0, 0, 64, 64);
        k.restore();
      });
    }

    function raiderBodyPath(k) {
      k.beginPath();
      k.moveTo(24, 13);
      k.bezierCurveTo(34.8, 13, 40.6, 21, 40.6, 32);
      k.bezierCurveTo(40.6, 43.5, 34, 49, 24, 49);
      k.bezierCurveTo(14, 49, 7.4, 43.5, 7.4, 32);
      k.bezierCurveTo(7.4, 21, 13.2, 13, 24, 13);
      k.closePath();
    }
    function drawRaider(k, C) {
      // crest (behind the body): silhouette cue
      k.lineWidth = 2.2; k.strokeStyle = INK;
      if (C.crest === 'fin') {
        var gf = k.createLinearGradient(18, 2, 30, 16); gf.addColorStop(0, C.trimL); gf.addColorStop(0.5, C.trim); gf.addColorStop(1, C.trimD);
        k.beginPath(); k.moveTo(16.5, 17); k.quadraticCurveTo(18.5, 4.5, 31.5, 2.2); k.quadraticCurveTo(27.6, 9.5, 31.8, 17); k.closePath();
        k.fillStyle = gf; k.fill(); k.stroke();
        k.beginPath(); k.moveTo(20.5, 13); k.quadraticCurveTo(22.5, 7.5, 28, 5); k.strokeStyle = 'rgba(255,255,255,.55)'; k.lineWidth = 1.4; k.stroke();
      } else {
        for (var s = -1; s <= 1; s += 2) {
          var ex = 24 + s * 11.5;
          var ge = k.createRadialGradient(ex - 1.5, 11, 0.5, ex, 13, 7);
          ge.addColorStop(0, C.trimL); ge.addColorStop(0.55, C.trim); ge.addColorStop(1, C.trimD);
          k.beginPath(); k.arc(ex, 14, 5.8, 0, Math.PI * 2); k.fillStyle = ge; k.fill(); k.strokeStyle = INK; k.lineWidth = 2.2; k.stroke();
          k.beginPath(); k.arc(ex, 14.6, 2.6, 0, Math.PI * 2); k.fillStyle = C.trimD; k.fill();
        }
      }
      // ear flaps
      for (var f = -1; f <= 1; f += 2) {
        k.beginPath(); k.ellipse(24 + f * 16.3, 31.5, 3.6, 6.2, f * 0.12, 0, Math.PI * 2);
        k.fillStyle = C.deep; k.fill(); k.strokeStyle = INK; k.lineWidth = 2; k.stroke();
      }
      // body
      var g = k.createRadialGradient(17, 22, 1.5, 22, 30, 27);
      g.addColorStop(0, C.light); g.addColorStop(0.42, C.base); g.addColorStop(1, C.dark);
      raiderBodyPath(k); k.fillStyle = g; k.fill();
      k.save(); raiderBodyPath(k); k.clip();
      var gs = k.createLinearGradient(0, 34, 0, 50); gs.addColorStop(0, 'rgba(0,0,0,0)'); gs.addColorStop(1, hexA(C.deep, 0.55));
      k.fillStyle = gs; k.fillRect(0, 30, 48, 22);
      // belly
      k.beginPath(); k.ellipse(24, 44, 9.5, 5.4, 0, 0, Math.PI * 2); k.fillStyle = hexA(C.light, 0.38); k.fill();
      // aviator cap
      var gc = k.createLinearGradient(0, 12, 0, 28); gc.addColorStop(0, C.dark); gc.addColorStop(1, C.deep);
      k.beginPath(); k.moveTo(0, 0); k.lineTo(48, 0); k.lineTo(48, 27.5); k.quadraticCurveTo(24, 20.5, 0, 27.5); k.closePath();
      k.fillStyle = gc; k.fill();
      k.beginPath(); k.moveTo(24, 13); k.lineTo(24, 22); k.strokeStyle = 'rgba(0,0,0,.28)'; k.lineWidth = 1.2; k.stroke();
      k.beginPath(); k.arc(24, 30, 16.2, Math.PI * 1.18, Math.PI * 1.42); k.strokeStyle = 'rgba(255,255,255,.32)'; k.lineWidth = 1.8; k.stroke();
      // scarf band
      k.beginPath(); k.moveTo(6, 37.2); k.quadraticCurveTo(24, 43.2, 42, 37.2); k.lineTo(42, 41.4); k.quadraticCurveTo(24, 47.6, 6, 41.4); k.closePath();
      k.fillStyle = C.trim; k.fill();
      k.beginPath(); k.moveTo(6, 37.6); k.quadraticCurveTo(24, 43.6, 42, 37.6); k.strokeStyle = hexA(C.trimL, 0.7); k.lineWidth = 1; k.stroke();
      k.beginPath(); k.moveTo(6, 41.4); k.quadraticCurveTo(24, 47.6, 42, 41.4); k.strokeStyle = INK; k.lineWidth = 1.3; k.stroke();
      k.restore();
      raiderBodyPath(k); k.strokeStyle = INK; k.lineWidth = 2.5; k.stroke();
      // goggle strap + goggles pushed up on the cap
      k.beginPath(); k.moveTo(7.8, 26.6); k.quadraticCurveTo(24, 20.6, 40.2, 26.6); k.strokeStyle = '#2a2140'; k.lineWidth = 3; k.stroke();
      for (var gx = -1; gx <= 1; gx += 2) {
        var cx = 24 + gx * 5.8, cy = 21.2;
        k.beginPath(); k.ellipse(cx, cy, 4.4, 3.5, gx * 0.12, 0, Math.PI * 2); k.fillStyle = '#5a5470'; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.6; k.stroke();
        var gl = k.createLinearGradient(cx - 2, cy - 2.4, cx + 2, cy + 2.4);
        gl.addColorStop(0, '#ffb45a'); gl.addColorStop(0.55, '#b4521f'); gl.addColorStop(1, '#5a2410');
        k.beginPath(); k.ellipse(cx, cy, 2.8, 2.1, gx * 0.12, 0, Math.PI * 2); k.fillStyle = gl; k.fill();
        k.beginPath(); k.moveTo(cx - 1.6, cy - 0.4); k.lineTo(cx - 0.2, cy - 1.5); k.strokeStyle = 'rgba(255,255,255,.85)'; k.lineWidth = 0.9; k.stroke();
      }
    }

    function drawBot(k, C) {
      k.strokeStyle = INK;
      // topper (silhouette cue)
      if (C.top === 'antenna') {
        k.beginPath(); k.moveTo(24, 18); k.lineTo(24, 8.5); k.lineWidth = 3.6; k.stroke();
        k.beginPath(); k.moveTo(24, 18); k.lineTo(24, 8.5); k.strokeStyle = '#9d94c9'; k.lineWidth = 1.6; k.stroke();
        var ga = k.createRadialGradient(22.8, 5.4, 0.4, 24, 6.6, 4.2); ga.addColorStop(0, '#fff'); ga.addColorStop(0.45, C.light); ga.addColorStop(1, C.base);
        k.beginPath(); k.arc(24, 6.8, 3.6, 0, Math.PI * 2); k.fillStyle = ga; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.9; k.stroke();
      } else if (C.top === 'rotor') {
        k.beginPath(); k.moveTo(24, 18); k.lineTo(24, 10.5); k.lineWidth = 3.8; k.stroke();
        k.beginPath(); k.moveTo(24, 18); k.lineTo(24, 10.5); k.strokeStyle = '#9d94c9'; k.lineWidth = 1.8; k.stroke();
      } else {
        for (var hs = -1; hs <= 1; hs += 2) {
          var gh = k.createLinearGradient(24 + hs * 8, 20, 24 + hs * 13, 6); gh.addColorStop(0, C.dark); gh.addColorStop(1, C.light);
          k.beginPath(); k.moveTo(24 + hs * 5.5, 20); k.quadraticCurveTo(24 + hs * 9.5, 11, 24 + hs * 14.5, 6.5); k.quadraticCurveTo(24 + hs * 14, 14.5, 24 + hs * 12.5, 20.5); k.closePath();
          k.fillStyle = gh; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.9; k.stroke();
        }
      }
      // side nubs
      for (var sn = -1; sn <= 1; sn += 2) {
        rr(k, sn < 0 ? 5 : 38.5, 25, 4.5, 11, 2); k.fillStyle = C.deep; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.8; k.stroke();
      }
      // body
      var g = k.createLinearGradient(9, 16, 39, 48); g.addColorStop(0, C.light); g.addColorStop(0.38, C.base); g.addColorStop(1, C.dark);
      rr(k, 8.5, 16.5, 31, 31, 11); k.fillStyle = g; k.fill();
      k.save(); rr(k, 8.5, 16.5, 31, 31, 11); k.clip();
      // hazard band (enemy pattern)
      k.fillStyle = C.deep; k.fillRect(8, 40, 32, 9);
      k.fillStyle = 'rgba(27,18,48,.55)';
      for (var hx = 4; hx < 44; hx += 6) { k.beginPath(); k.moveTo(hx, 48.5); k.lineTo(hx + 3, 48.5); k.lineTo(hx + 7, 40); k.lineTo(hx + 4, 40); k.closePath(); k.fill(); }
      k.beginPath(); k.moveTo(8, 40); k.lineTo(40, 40); k.strokeStyle = INK; k.lineWidth = 1.3; k.stroke();
      // top sheen
      k.beginPath(); k.ellipse(18, 21, 8, 3.4, -0.35, 0, Math.PI * 2); k.fillStyle = 'rgba(255,255,255,.38)'; k.fill();
      k.restore();
      rr(k, 8.5, 16.5, 31, 31, 11); k.strokeStyle = INK; k.lineWidth = 2.5; k.stroke();
      // visor
      rr(k, 12.3, 23.5, 23.4, 13, 6.2); k.fillStyle = '#150d27'; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.8; k.stroke();
      var gv = k.createLinearGradient(0, 23.5, 0, 36.5); gv.addColorStop(0, 'rgba(255,255,255,.16)'); gv.addColorStop(0.5, 'rgba(255,255,255,0)');
      rr(k, 13.5, 24.6, 21, 6, 4); k.fillStyle = gv; k.fill();
      // bolts
      k.fillStyle = 'rgba(27,18,48,.55)';
      k.beginPath(); k.arc(13, 21.2, 1.3, 0, Math.PI * 2); k.arc(35, 21.2, 1.3, 0, Math.PI * 2); k.fill();
    }

    function drawCrate(k, v) {
      var x0 = 3, y0 = 2.5, w = 42, h = 42.5, F = 8.5, r = 6, top = h - F;
      k.save();
      k.shadowColor = 'rgba(10,2,14,0.6)'; k.shadowBlur = 7 * S; k.shadowOffsetX = 2.5 * S; k.shadowOffsetY = 5 * S;
      rr(k, x0, y0, w, h, r); k.fillStyle = '#7e3420'; k.fill();
      k.restore();
      var gF = k.createLinearGradient(0, y0 + top, 0, y0 + h); gF.addColorStop(0, '#a54b2b'); gF.addColorStop(1, '#6f2b17');
      rr(k, x0, y0, w, h, r); k.fillStyle = gF; k.fill();
      // front-face mortar
      k.strokeStyle = 'rgba(72,22,10,.85)'; k.lineWidth = 1.6;
      var fx1 = v === 1 ? 0.5 : 0.33, fx2 = v === 1 ? -1 : 0.66;
      k.beginPath(); k.moveTo(x0 + w * fx1, y0 + top + 1); k.lineTo(x0 + w * fx1, y0 + h - 1);
      if (fx2 > 0) { k.moveTo(x0 + w * fx2, y0 + top + 1); k.lineTo(x0 + w * fx2, y0 + h - 1); }
      k.stroke();
      // top face
      var gT = k.createLinearGradient(0, y0, 0, y0 + top); gT.addColorStop(0, '#f0965f'); gT.addColorStop(1, '#c65d32');
      rr(k, x0, y0, w, top, r); k.fillStyle = gT; k.fill();
      k.save(); rr(k, x0, y0, w, top, r); k.clip();
      var rows = v === 1 ? [[0.25, 0.75], [0.5], [0.25, 0.75]] : [[0.5], [0.25, 0.75], [0.5]];
      var rh = top / 3;
      for (var ri = 0; ri < 3; ri++) {
        var splits = rows[ri], yA = y0 + ri * rh, prev = 0;
        for (var si = 0; si <= splits.length; si++) {
          var nx = si < splits.length ? splits[si] : 1;
          var bx = x0 + w * prev, bW = w * (nx - prev);
          var hv = hash(ri * 7 + si, v * 13 + 3, 11);
          k.fillStyle = hv < 0.33 ? 'rgba(255,214,170,.16)' : (hv < 0.66 ? 'rgba(90,22,8,.13)' : 'rgba(255,170,110,.07)');
          k.fillRect(bx, yA, bW, rh);
          k.beginPath(); k.moveTo(bx + 2.2, yA + 2.2); k.lineTo(bx + bW - 2.2, yA + 2.2);
          k.strokeStyle = 'rgba(255,232,205,.42)'; k.lineWidth = 1.1; k.stroke();
          prev = nx;
        }
      }
      k.strokeStyle = '#7a2e1a'; k.lineWidth = 2.3;
      k.beginPath();
      for (var rj = 1; rj < 3; rj++) { k.moveTo(x0, y0 + rj * rh); k.lineTo(x0 + w, y0 + rj * rh); }
      for (var rk = 0; rk < 3; rk++) {
        for (var sk = 0; sk < rows[rk].length; sk++) {
          var vx = x0 + w * rows[rk][sk]; k.moveTo(vx, y0 + rk * rh); k.lineTo(vx, y0 + (rk + 1) * rh);
        }
      }
      k.stroke();
      if (v === 2) {
        // chipped corner + hairline crack
        k.beginPath(); k.moveTo(x0 + w - 9, y0); k.lineTo(x0 + w, y0); k.lineTo(x0 + w, y0 + 7); k.lineTo(x0 + w - 4, y0 + 5.5); k.closePath();
        k.fillStyle = '#7a2e1a'; k.fill();
        k.beginPath(); k.moveTo(x0 + 9, y0 + rh + 3); k.lineTo(x0 + 13, y0 + rh + 7); k.lineTo(x0 + 11.5, y0 + rh + 10.5);
        k.strokeStyle = 'rgba(80,20,8,.8)'; k.lineWidth = 1.1; k.stroke();
      }
      k.restore();
      k.beginPath(); k.moveTo(x0 + 1.5, y0 + top); k.lineTo(x0 + w - 1.5, y0 + top); k.strokeStyle = 'rgba(27,18,48,.6)'; k.lineWidth = 1.4; k.stroke();
      rr(k, x0, y0, w, h, r); k.strokeStyle = INK; k.lineWidth = 2.4; k.stroke();
    }

    function drawPillar(k, px, py) {
      var x0 = px + 3, y0 = py + 2, w = T - 6, h = T - 5, F = 9, r = 7, top = h - F;
      var gF = k.createLinearGradient(0, y0 + top, 0, y0 + h); gF.addColorStop(0, '#372e5e'); gF.addColorStop(1, '#1d1736');
      rr(k, x0, y0, w, h, r); k.fillStyle = gF; k.fill();
      // front face ribs
      k.fillStyle = 'rgba(255,255,255,.05)';
      for (var i = 1; i < 4; i++) k.fillRect(x0 + (w * i) / 4 - 0.6, y0 + top + 2, 1.2, F - 4);
      var gT = k.createLinearGradient(x0, y0, x0 + w * 0.4, y0 + top); gT.addColorStop(0, '#7f76b8'); gT.addColorStop(1, '#4f4682');
      rr(k, x0, y0, w, top, r); k.fillStyle = gT; k.fill();
      // inset plate
      rr(k, x0 + 7, y0 + 6.5, w - 14, top - 13, 4); k.fillStyle = 'rgba(22,14,46,.28)'; k.fill();
      k.strokeStyle = 'rgba(255,255,255,.12)'; k.lineWidth = 1; k.stroke();
      k.beginPath(); k.moveTo(x0 + 10, y0 + top - 8); k.lineTo(x0 + w - 16, y0 + 9.5); k.strokeStyle = 'rgba(255,255,255,.07)'; k.lineWidth = 3; k.stroke();
      // rivets
      var rx = [x0 + 4.2, x0 + w - 4.2], ry = [y0 + 4.2, y0 + top - 4.2];
      for (var a = 0; a < 2; a++) for (var b = 0; b < 2; b++) {
        k.beginPath(); k.arc(rx[a] + 0.5, ry[b] + 0.7, 1.9, 0, Math.PI * 2); k.fillStyle = 'rgba(12,8,28,.55)'; k.fill();
        k.beginPath(); k.arc(rx[a], ry[b], 1.75, 0, Math.PI * 2); k.fillStyle = '#c3bbec'; k.fill();
      }
      k.beginPath(); k.moveTo(x0 + r, y0 + 1.5); k.lineTo(x0 + w - r, y0 + 1.5); k.strokeStyle = 'rgba(255,255,255,.38)'; k.lineWidth = 1.5; k.stroke();
      k.beginPath(); k.moveTo(x0 + 1.5, y0 + top); k.lineTo(x0 + w - 1.5, y0 + top); k.strokeStyle = 'rgba(27,18,48,.7)'; k.lineWidth = 1.4; k.stroke();
      rr(k, x0, y0, w, h, r); k.strokeStyle = INK; k.lineWidth = 2.3; k.stroke();
    }

    function drawBombBody(k) {
      // sphere centred at (24, 26) R 14; cap at top-right (partly behind the sphere)
      k.save(); k.translate(30.2, 12.4); k.rotate(-0.44);
      rr(k, -5.2, -4, 10.4, 7.4, 2); k.fillStyle = '#5a5470'; k.fill(); k.strokeStyle = INK; k.lineWidth = 2; k.stroke();
      k.beginPath(); k.moveTo(-3.4, -2.2); k.lineTo(3.4, -2.2); k.strokeStyle = 'rgba(255,255,255,.4)'; k.lineWidth = 1.1; k.stroke();
      k.restore();
      var g = k.createRadialGradient(18.5, 20, 1, 24, 26, 15.5);
      g.addColorStop(0, '#776bab'); g.addColorStop(0.36, '#3c3164'); g.addColorStop(1, '#130d24');
      k.beginPath(); k.arc(24, 26, 14, 0, Math.PI * 2); k.fillStyle = g; k.fill(); k.strokeStyle = INK; k.lineWidth = 2.4; k.stroke();
      k.beginPath(); k.arc(24, 26, 9.6, Math.PI * 1.12, Math.PI * 1.46); k.strokeStyle = 'rgba(255,246,229,.88)'; k.lineWidth = 3.2; k.stroke();
      k.beginPath(); k.arc(15.6, 27.5, 1.4, 0, Math.PI * 2); k.fillStyle = 'rgba(255,255,255,.45)'; k.fill();
    }

    function drawToken(k, P, type) {
      var g = k.createRadialGradient(15, 13.5, 1, 20, 20, 15);
      g.addColorStop(0, P.light); g.addColorStop(0.5, P.base); g.addColorStop(1, P.dark);
      k.beginPath(); k.arc(20, 20, 13.6, 0, Math.PI * 2); k.fillStyle = g; k.fill(); k.strokeStyle = INK; k.lineWidth = 2.4; k.stroke();
      k.beginPath(); k.arc(20, 20, 10.4, 0, Math.PI * 2); k.strokeStyle = 'rgba(255,255,255,.38)'; k.lineWidth = 1.2; k.stroke();
      k.strokeStyle = INK; k.lineWidth = 1.7;
      if (type === 'bomb') {
        k.save(); k.translate(20.8, 13.6); k.rotate(-0.44); rr(k, -2.6, -2, 5.2, 3.8, 1); k.fillStyle = '#5a5470'; k.fill(); k.stroke(); k.restore();
        k.beginPath(); k.moveTo(21.5, 11.6); k.quadraticCurveTo(23.5, 7.8, 27, 8.6); k.strokeStyle = INK; k.lineWidth = 2.6; k.stroke();
        k.beginPath(); k.moveTo(21.5, 11.6); k.quadraticCurveTo(23.5, 7.8, 27, 8.6); k.strokeStyle = '#f2d9a6'; k.lineWidth = 1.2; k.stroke();
        k.beginPath(); k.arc(18.8, 21.4, 7, 0, Math.PI * 2); k.fillStyle = '#2a2140'; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.8; k.stroke();
        k.beginPath(); k.arc(18.8, 21.4, 4.6, Math.PI * 1.12, Math.PI * 1.5); k.strokeStyle = 'rgba(255,246,229,.9)'; k.lineWidth = 1.8; k.stroke();
        star(k, 27.6, 8.4, 3.4, 1.4, 5, -Math.PI / 2); k.fillStyle = '#fff'; k.fill();
      } else if (type === 'range') {
        k.beginPath(); k.moveTo(20, 11); k.lineTo(20, 29); k.moveTo(11, 20); k.lineTo(29, 20);
        k.strokeStyle = INK; k.lineWidth = 6.4; k.stroke();
        k.strokeStyle = '#fff'; k.lineWidth = 3.4; k.stroke();
        k.beginPath(); k.arc(20, 20, 3.4, 0, Math.PI * 2); k.fillStyle = '#ffe066'; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.3; k.stroke();
      } else if (type === 'speed') {
        k.beginPath(); k.moveTo(22.6, 9.4); k.lineTo(13.6, 21.6); k.lineTo(19.4, 21.6); k.lineTo(16.6, 30.8); k.lineTo(26.6, 17.8); k.lineTo(20.8, 17.8); k.lineTo(24.8, 9.4); k.closePath();
        k.fillStyle = '#fff'; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.7; k.stroke();
      } else {
        k.beginPath(); k.moveTo(20, 10); k.lineTo(27.8, 13.2); k.lineTo(27.8, 19.6); k.bezierCurveTo(27.8, 25.4, 24.2, 28.6, 20, 30.6); k.bezierCurveTo(15.8, 28.6, 12.2, 25.4, 12.2, 19.6); k.lineTo(12.2, 13.2); k.closePath();
        k.fillStyle = '#fff'; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.7; k.stroke();
        k.beginPath(); k.moveTo(16.4, 19.8); k.lineTo(19.3, 22.8); k.lineTo(24, 16.8); k.strokeStyle = P.dark; k.lineWidth = 2.3; k.stroke();
      }
      k.beginPath(); k.ellipse(14.6, 12.6, 5.2, 2.6, -0.6, 0, Math.PI * 2); k.fillStyle = 'rgba(255,255,255,.5)'; k.fill();
    }

    /* small pre-rendered parts: fewer draw calls per character / bomb each frame */
    var FACE_OFF = [[0, 0.5, 0, 1.1], [0, -1.6, 0, -1.5], [-2.6, 0, -1.4, 0.3], [2.6, 0, 1.4, 0.3]]; // eyeDx, eyeDy, pupilDx, pupilDy
    function drawEyes(k, face, blink) {
      var o = FACE_OFF[face];
      for (var s = -1; s <= 1; s += 2) {
        var ex = 13 + s * 5, ey = 8;
        k.beginPath(); k.ellipse(ex, ey, 3.5, blink ? 0.8 : 4.3, 0, 0, Math.PI * 2);
        k.fillStyle = '#fff'; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.2; k.stroke();
        if (!blink) {
          k.beginPath(); k.arc(ex + o[2], ey + o[3], 2.1, 0, Math.PI * 2); k.fillStyle = INK; k.fill();
          k.beginPath(); k.arc(ex + o[2] - 0.7, ey + o[3] - 0.8, 0.75, 0, Math.PI * 2); k.fillStyle = '#fff'; k.fill();
        }
      }
    }
    function drawFoot(k, C) {
      if (C.kind === 'bot') {
        k.fillStyle = C.deep; k.fillRect(3.8, 0.5, 4.4, 6); k.strokeStyle = INK; k.lineWidth = 1.2; k.strokeRect(3.8, 0.5, 4.4, 6);
        k.beginPath(); k.ellipse(6, 7.4, 4.6, 2.7, 0, 0, Math.PI * 2); k.fillStyle = C.deep; k.fill(); k.lineWidth = 1.6; k.stroke();
      } else {
        k.beginPath(); k.ellipse(7, 5, 5.3, 3.4, 0, 0, Math.PI * 2); k.fillStyle = C.deep; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.6; k.stroke();
        k.beginPath(); k.ellipse(5.6, 3.6, 2.4, 1.1, 0, 0, Math.PI * 2); k.fillStyle = 'rgba(255,255,255,.22)'; k.fill();
      }
    }
    function drawBotEye(k, C) {
      var g = k.createRadialGradient(13, 10, 0, 13, 10, 11);
      g.addColorStop(0, hexA(C.light, 0.75)); g.addColorStop(0.45, hexA(C.base, 0.35)); g.addColorStop(1, hexA(C.base, 0));
      k.fillStyle = g; k.fillRect(0, 0, 26, 20);
      k.fillStyle = C.light;
      if (C.eye === 'round') {
        k.beginPath(); k.arc(13, 10, 3.7, 0, Math.PI * 2); k.fill();
        k.beginPath(); k.arc(13, 10, 1.6, 0, Math.PI * 2); k.fillStyle = '#fff'; k.fill();
      } else if (C.eye === 'slit') {
        rr(k, 6, 8.2, 14, 3.6, 1.6); k.fill();
        k.fillStyle = '#fff'; k.fillRect(9, 9.2, 8, 1.6);
      } else {
        rr(k, 6.4, 8, 4.4, 4.4, 1); k.fill(); rr(k, 15.2, 8, 4.4, 4.4, 1); k.fill();
        k.fillStyle = '#fff'; k.fillRect(7.4, 9, 1.6, 1.6); k.fillRect(16.2, 9, 1.6, 1.6);
      }
    }
    function drawSpark(k) {
      star(k, 10, 10, 5.6, 2.3, 6, 0); k.fillStyle = '#ffe066'; k.fill();
      star(k, 10, 10, 3, 1.3, 6, 0.5); k.fillStyle = '#fff8d8'; k.fill();
    }
    function buildSprites() {
      var sp = { ch: {}, chW: {}, chGlow: {}, crate: [], pu: {}, puGlow: {} };
      for (var i = 0; i < CKEYS.length; i++) {
        var ck = CKEYS[i], C = CHAR[ck];
        sp.ch[ck] = mk(48, 56, C.kind === 'raider' ? function (k) { drawRaider(k, this); }.bind(C) : function (k) { drawBot(k, this); }.bind(C));
        sp.chW[ck] = whiteOf(sp.ch[ck]);
        sp.chGlow[ck] = radialSprite([[0, hexA(C.light, 0.9)], [0.4, hexA(C.base, 0.45)], [1, hexA(C.base, 0)]]);
      }
      for (var v = 0; v < 3; v++) sp.crate.push(mk(52, 56, function (k) { drawCrate(k, this.v); }.bind({ v: v })));
      for (var t = 1; t < PU_KEYS.length; t++) {
        var key = PU_KEYS[t];
        sp.pu[key] = mk(40, 40, function (k) { drawToken(k, PU[this.key], this.key); }.bind({ key: key }));
        sp.puGlow[key] = radialSprite([[0, hexA(PU[key].base, 0.7)], [0.45, hexA(PU[key].base, 0.25)], [1, hexA(PU[key].base, 0)]]);
      }
      sp.bomb = mk(48, 48, drawBombBody);
      sp.bombW = whiteOf(sp.bomb);
      sp.bombBy = {};
      for (var bo = 0; bo < CKEYS.length; bo++) {
        sp.bombBy[CKEYS[bo]] = mk(48, 48, function (k) {
          k.drawImage(sp.bomb, 0, 0, 48, 48);
          k.beginPath(); k.ellipse(24, 29.5, 12.6, 5.4, 0, Math.PI * 0.1, Math.PI * 0.9);
          k.strokeStyle = INK; k.lineWidth = 4.4; k.stroke();
          k.strokeStyle = CHAR[this.ck].base; k.lineWidth = 2.6; k.stroke();
        }.bind({ ck: CKEYS[bo] }));
      }
      sp.spark = mk(20, 20, drawSpark);
      sp.eyes = [];
      for (var fc = 0; fc < 4; fc++) for (var bl = 0; bl < 2; bl++) sp.eyes[fc * 2 + bl] = mk(26, 16, function (k) { drawEyes(k, this.f, this.b); }.bind({ f: fc, b: bl }));
      sp.foot = {}; sp.botEye = {};
      for (var fi = 0; fi < CKEYS.length; fi++) {
        var fk = CKEYS[fi];
        sp.foot[fk] = mk(14, 11, function (k) { drawFoot(k, CHAR[this.ck]); }.bind({ ck: fk }));
        if (CHAR[fk].kind === 'bot') sp.botEye[fk] = mk(26, 20, function (k) { drawBotEye(k, CHAR[this.ck]); }.bind({ ck: fk }));
      }
      sp.glow = radialSprite([[0, 'rgba(255,246,208,1)'], [0.22, 'rgba(255,205,100,.8)'], [0.55, 'rgba(255,122,40,.3)'], [1, 'rgba(255,90,30,0)']]);
      sp.smoke = radialSprite([[0, 'rgba(78,62,96,.9)'], [0.6, 'rgba(56,42,72,.45)'], [1, 'rgba(44,32,58,0)']]);
      sp.dust = radialSprite([[0, 'rgba(214,140,104,.75)'], [0.6, 'rgba(170,96,72,.35)'], [1, 'rgba(150,80,60,0)']]);
      sp.scorch = radialSprite([[0, 'rgba(14,3,10,.85)'], [0.5, 'rgba(22,6,14,.5)'], [1, 'rgba(22,6,14,0)']]);
      sp.shadow = radialSprite([[0, 'rgba(6,0,12,.72)'], [0.6, 'rgba(6,0,12,.38)'], [1, 'rgba(6,0,12,0)']], 0.375);
      sp.gold = radialSprite([[0, 'rgba(255,240,180,.95)'], [0.35, 'rgba(255,207,92,.45)'], [1, 'rgba(255,180,60,0)']]);
      sprites = sp;
    }

    /* ======================= arena cache ======================= */
    function tileAt(m, x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return 'wall';
      var row = m[y]; return row ? row[x] : 'wall';
    }
    function buildBase(m) {
      baseDirty = false; compDirty = true;
      var k = baseK;
      k.setTransform(SX, 0, 0, SY, 0, 0);
      k.lineJoin = 'round'; k.lineCap = 'round';
      k.globalAlpha = 1; k.globalCompositeOperation = 'source-over';
      // rampart (solid border) slab
      var gR = k.createLinearGradient(0, 0, LW * 0.3, LH); gR.addColorStop(0, '#4c4378'); gR.addColorStop(1, '#2c2550');
      k.fillStyle = gR; k.fillRect(0, 0, LW, LH);
      for (var by = 0; by < H; by++) {
        for (var bx = 0; bx < W; bx++) {
          if (bx > 0 && by > 0 && bx < W - 1 && by < H - 1) continue;
          var px = bx * T, py = by * T, hv = hash(bx, by, 5);
          k.fillStyle = hv < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(10,6,24,.08)'; k.fillRect(px, py, T, T);
          k.fillStyle = 'rgba(255,255,255,.10)'; k.fillRect(px + 1, py + 1, T - 2, 1.4); k.fillRect(px + 1, py + 1, 1.4, T - 2);
          k.fillStyle = 'rgba(10,6,26,.42)'; k.fillRect(px, py + T - 1.6, T, 1.6); k.fillRect(px + T - 1.6, py, 1.6, T);
          var corner = (bx === 0 || bx === W - 1) && (by === 0 || by === H - 1);
          var rad = corner ? 4.2 : 2.1;
          if (corner || ((bx + by) & 1) === 0) {
            k.beginPath(); k.arc(px + T / 2 + 0.6, py + T / 2 + 0.8, rad, 0, Math.PI * 2); k.fillStyle = 'rgba(10,6,24,.55)'; k.fill();
            k.beginPath(); k.arc(px + T / 2, py + T / 2, rad, 0, Math.PI * 2); k.fillStyle = corner ? '#a59cd2' : '#8178b2'; k.fill();
            if (corner) { k.beginPath(); k.arc(px + T / 2 - 1.2, py + T / 2 - 1.3, 1.3, 0, Math.PI * 2); k.fillStyle = 'rgba(255,255,255,.7)'; k.fill(); }
          }
        }
      }
      // floor
      k.save(); k.beginPath(); k.rect(T, T, LW - 2 * T, LH - 2 * T); k.clip();
      for (var y = 1; y < H - 1; y++) {
        for (var x = 1; x < W - 1; x++) {
          var fx = x * T, fy = y * T;
          k.fillStyle = ((x + y) & 1) ? '#47203f' : '#3f1c38'; k.fillRect(fx, fy, T, T);
          k.fillStyle = 'rgba(255,214,196,.05)'; k.fillRect(fx + 2, fy + 2, T - 4, 1.5); k.fillRect(fx + 2, fy + 2, 1.5, T - 4);
          k.fillStyle = 'rgba(8,0,10,.24)'; k.fillRect(fx + 2, fy + T - 3.5, T - 4, 1.5); k.fillRect(fx + T - 3.5, fy + 2, 1.5, T - 4);
          k.strokeStyle = 'rgba(14,3,16,.6)'; k.lineWidth = 1.3; k.strokeRect(fx + 0.65, fy + 0.65, T - 1.3, T - 1.3);
          var h1 = hash(x, y, 1), h2 = hash(x, y, 2), h3 = hash(x, y, 3);
          if (h1 < 0.3) {
            var cx0 = fx + 10 + h2 * 26, cy0 = fy + 10 + h3 * 26;
            k.beginPath(); k.moveTo(cx0, cy0); k.lineTo(cx0 + 4 + h3 * 4, cy0 + 3 - h2 * 5); k.lineTo(cx0 + 8 + h2 * 3, cy0 + 2 + h1 * 6);
            k.strokeStyle = 'rgba(12,2,12,.32)'; k.lineWidth = 1; k.stroke();
          }
          if (h2 > 0.62) {
            for (var pb = 0; pb < 3; pb++) {
              var qx = fx + 7 + hash(x, y, 10 + pb) * 34, qy = fy + 7 + hash(x, y, 20 + pb) * 34;
              k.beginPath(); k.arc(qx, qy, 0.9 + hash(x, y, 30 + pb) * 1.1, 0, Math.PI * 2); k.fillStyle = 'rgba(255,214,196,.07)'; k.fill();
            }
          }
        }
      }
      // cover-style dot texture
      k.fillStyle = 'rgba(255,255,255,.04)';
      for (var dy = T + 6; dy < LH - T; dy += 12) for (var dx = T + 6; dx < LW - T; dx += 12) k.fillRect(dx, dy, 1.6, 1.6);
      // warm centre light (the cover's orange glow) + vignette
      var gl = k.createRadialGradient(LW / 2, LH * 0.46, 10, LW / 2, LH * 0.46, LW * 0.6);
      gl.addColorStop(0, 'rgba(255,148,69,.3)'); gl.addColorStop(0.5, 'rgba(255,110,60,.11)'); gl.addColorStop(1, 'rgba(255,110,60,0)');
      k.fillStyle = gl; k.fillRect(0, 0, LW, LH);
      var gv = k.createRadialGradient(LW / 2, LH / 2, LW * 0.25, LW / 2, LH / 2, LW * 0.68);
      gv.addColorStop(0, 'rgba(14,4,18,0)'); gv.addColorStop(1, 'rgba(14,4,18,.5)');
      k.fillStyle = gv; k.fillRect(0, 0, LW, LH);
      // rampart cast shadows (light from the top-left)
      var gs1 = k.createLinearGradient(0, T, 0, T + 16); gs1.addColorStop(0, 'rgba(8,2,14,.6)'); gs1.addColorStop(1, 'rgba(8,2,14,0)');
      k.fillStyle = gs1; k.fillRect(T, T, LW - 2 * T, 16);
      var gs2 = k.createLinearGradient(T, 0, T + 10, 0); gs2.addColorStop(0, 'rgba(8,2,14,.42)'); gs2.addColorStop(1, 'rgba(8,2,14,0)');
      k.fillStyle = gs2; k.fillRect(T, T, 10, LH - 2 * T);
      // pillar shadows
      k.save();
      k.shadowColor = 'rgba(8,2,14,.62)'; k.shadowBlur = 8 * S; k.shadowOffsetX = 3 * S; k.shadowOffsetY = 6 * S;
      k.fillStyle = 'rgba(8,2,14,.4)';
      for (var y2 = 1; y2 < H - 1; y2++) for (var x2 = 1; x2 < W - 1; x2++) {
        if (tileAt(m, x2, y2) !== 'wall') continue;
        rr(k, x2 * T + 3, y2 * T + 2, T - 6, T - 5, 7); k.fill();
      }
      k.restore();
      k.restore();
      // rampart front face (top wall faces the viewer) + inner outline
      var F = 9;
      var gF = k.createLinearGradient(0, T - F, 0, T); gF.addColorStop(0, '#2f2754'); gF.addColorStop(1, '#1b1533');
      k.fillStyle = gF; k.fillRect(T, T - F, LW - 2 * T, F);
      k.fillStyle = 'rgba(255,255,255,.06)';
      for (var fx2 = 2; fx2 < W - 1; fx2++) k.fillRect(fx2 * T - 0.6, T - F + 2, 1.2, F - 4);
      k.strokeStyle = INK; k.lineWidth = 2;
      k.strokeRect(T, T - F, LW - 2 * T, LH - 2 * T + F);
      k.beginPath(); k.moveTo(T + 2, LH - T + 2); k.lineTo(LW - T - 2, LH - T + 2); k.strokeStyle = 'rgba(255,255,255,.2)'; k.lineWidth = 1.3; k.stroke();
      k.beginPath(); k.moveTo(LW - T + 2, T); k.lineTo(LW - T + 2, LH - T); k.strokeStyle = 'rgba(255,255,255,.12)'; k.stroke();
      // pillars
      for (var y3 = 1; y3 < H - 1; y3++) for (var x3 = 1; x3 < W - 1; x3++) {
        if (tileAt(m, x3, y3) === 'wall') drawPillar(k, x3 * T, y3 * T);
      }
      // outer rim
      k.strokeStyle = INK; k.lineWidth = 2.5; k.strokeRect(1.25, 1.25, LW - 2.5, LH - 2.5);
      k.strokeStyle = 'rgba(255,255,255,.1)'; k.lineWidth = 1; k.strokeRect(3.5, 3.5, LW - 7, LH - 7);
    }
    function buildComp(m) {
      compDirty = false;
      var k = compK;
      k.setTransform(1, 0, 0, 1, 0, 0);
      k.globalAlpha = 1; k.globalCompositeOperation = 'source-over';
      k.drawImage(baseCv, 0, 0);
      k.setTransform(SX, 0, 0, SY, 0, 0);
      for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
        if (tileAt(m, x, y) !== 'crate') continue;
        k.drawImage(sprites.crate[(hash(x, y, 7) * 3) | 0], x * T, y * T, 52, 56);
      }
    }

    /* ======================= effect pools ======================= */
    var PMAX = 480, pNext = 0;
    var pX = new Float32Array(PMAX), pY = new Float32Array(PMAX), pVX = new Float32Array(PMAX), pVY = new Float32Array(PMAX);
    var pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX), pSize = new Float32Array(PMAX), pRot = new Float32Array(PMAX);
    var pVR = new Float32Array(PMAX), pG = new Float32Array(PMAX), pDrag = new Float32Array(PMAX);
    var pKind = new Uint8Array(PMAX), pCol = new Uint8Array(PMAX);
    var K_SPARK = 1, K_DEBRIS = 2, K_SMOKE = 3, K_CONF = 4, K_STAR = 5, K_EMBER = 6, K_DUST = 7;
    function emit(kind, x, y, vx, vy, life, size, col, g, drag) {
      var i = pNext; pNext = (pNext + 1) % PMAX;
      pKind[i] = kind; pX[i] = x; pY[i] = y; pVX[i] = vx; pVY[i] = vy; pLife[i] = life; pMax[i] = life;
      pSize[i] = size; pCol[i] = col; pG[i] = g; pDrag[i] = drag; pRot[i] = vr() * 6.283; pVR[i] = (vr() - 0.5) * 14;
    }
    function burst(kind, x, y, n, sp0, sp1, life0, life1, s0, s1, cols, g, drag, up) {
      for (var i = 0; i < n; i++) {
        var a = vr() * 6.283, sp = sp0 + vr() * (sp1 - sp0);
        emit(kind, x, y, Math.cos(a) * sp, Math.sin(a) * sp - (up || 0), life0 + vr() * (life1 - life0), s0 + vr() * (s1 - s0), cols[(vr() * cols.length) | 0], g, drag);
      }
    }
    var COLS_FIRE = [C_WHITE, C_LEMON, C_AMBER, C_ORANGE], COLS_BRICK = [C_BRICK, C_BRICKD, C_BRICKL], COLS_BOT = [C_STEEL, C_SLATE, C_BOMB];

    var SMAX = 64, sNext = 0;
    var scX = new Float32Array(SMAX), scY = new Float32Array(SMAX), scT0 = new Float32Array(SMAX), scR = new Float32Array(SMAX);
    function addScorch(x, y, r, now) { var i = sNext; sNext = (sNext + 1) % SMAX; scX[i] = x; scY[i] = y; scT0[i] = now; scR[i] = r; }

    var RMAX = 24, rNext = 0;
    var rgX = new Float32Array(RMAX), rgY = new Float32Array(RMAX), rgT0 = new Float32Array(RMAX), rgDur = new Float32Array(RMAX);
    var rgR0 = new Float32Array(RMAX), rgR1 = new Float32Array(RMAX), rgKind = new Uint8Array(RMAX), rgCol = new Uint8Array(RMAX);
    function addRing(kind, x, y, r0, r1, dur, col, now) {
      var i = rNext; rNext = (rNext + 1) % RMAX;
      rgKind[i] = kind; rgX[i] = x; rgY[i] = y; rgR0[i] = r0; rgR1[i] = r1; rgDur[i] = dur; rgT0[i] = now; rgCol[i] = col;
    }

    var TMAX = 12, tNext = 0;
    var txX = new Float32Array(TMAX), txY = new Float32Array(TMAX), txT0 = new Float32Array(TMAX), txCol = new Uint8Array(TMAX), txStr = new Array(TMAX);
    for (var ti = 0; ti < TMAX; ti++) { txStr[ti] = ''; txT0[ti] = -1e9; }
    function addText(str, x, y, col, now) { var i = tNext; tNext = (tNext + 1) % TMAX; txStr[i] = str; txX[i] = x; txY[i] = y; txCol[i] = col; txT0[i] = now; }

    var CBMAX = 24, cbNext = 0;
    var cbX = new Int16Array(CBMAX), cbY = new Int16Array(CBMAX), cbT0 = new Float32Array(CBMAX);
    for (var ci = 0; ci < CBMAX; ci++) cbT0[ci] = -1e9;

    var shakeAmp = 0;
    function shake(a) { if (!RM) shakeAmp = Math.min(4, Math.max(shakeAmp, a)); }

    function clearFx() {
      for (var i = 0; i < PMAX; i++) pLife[i] = 0;
      for (var j = 0; j < SMAX; j++) scT0[j] = -1e9;
      for (var r = 0; r < RMAX; r++) rgT0[r] = -1e9;
      for (var t = 0; t < TMAX; t++) txT0[t] = -1e9;
      for (var c = 0; c < CBMAX; c++) cbT0[c] = -1e9;
      shakeAmp = 0;
    }
    clearFx();

    /* ======================= state diffing ======================= */
    var haveMap = false;
    var prevCrate = new Uint8Array(N), prevWall = new Uint8Array(N);
    var crateGoneAt = new Uint8Array(N);
    var bombCur = new Uint8Array(N), bombPrev = new Uint8Array(N), bombInit = new Float32Array(N), bombBorn = new Float32Array(N);
    var bombOwner = new Array(N);
    var exT = new Float32Array(N), exPrev = new Float32Array(N), exBorn = new Float32Array(N), flameW = new Float32Array(N);
    var puCur = new Uint8Array(N), puPrev = new Uint8Array(N), puBorn = new Float32Array(N);
    var recs = {}, recList = [], frameNo = 0;
    var prevWin = false, prevOver = false, prevRun = false, prevPau = false;
    var winT0 = -1e9, lossT0 = -1e9, youT0 = -1e9, endT0 = -1e9;
    var lastNow = 0;

    function ownerKey(owner) {
      if (owner === 'p1' || owner === 'p2' || owner === 'e0' || owner === 'e1' || owner === 'e2') return owner;
      return 'e0';
    }

    function onDetonate(idx, owner, now) {
      var cx = (idx % W) * T + 24, cy = ((idx / W) | 0) * T + 24;
      addRing(2, cx, cy, 10, 80, 260, C_LEMON, now);
      if (RM) return;
      addRing(1, cx, cy, 8, 46, 340, C_LEMON, now);
      burst(K_SPARK, cx, cy, 14, 90, 260, 0.25, 0.55, 1.6, 3.2, COLS_FIRE, 120, 2.4, 20);
      for (var i = 0; i < 5; i++) emit(K_SMOKE, cx + (vr() - 0.5) * 24, cy + (vr() - 0.5) * 16, (vr() - 0.5) * 30, -18 - vr() * 26, 0.9 + vr() * 0.6, 18 + vr() * 14, C_SLATE, -6, 1.2);
      shake(2.4);
    }
    function onCrateBreak(idx, now) {
      var x = idx % W, y = (idx / W) | 0, cx = x * T + 24, cy = y * T + 22;
      var i = cbNext; cbNext = (cbNext + 1) % CBMAX; cbX[i] = x; cbY[i] = y; cbT0[i] = now;
      if (RM) return;
      for (var d = 0; d < 9; d++) {
        var a = -Math.PI / 2 + (vr() - 0.5) * 2.6, sp = 70 + vr() * 120;
        emit(K_DEBRIS, cx + (vr() - 0.5) * 20, cy + (vr() - 0.5) * 16, Math.cos(a) * sp, Math.sin(a) * sp, 0.55 + vr() * 0.4, 3 + vr() * 3.5, COLS_BRICK[(vr() * 3) | 0], 520, 1.2);
      }
      for (var s = 0; s < 3; s++) emit(K_DUST, cx + (vr() - 0.5) * 22, cy + (vr() - 0.5) * 14, (vr() - 0.5) * 24, -10 - vr() * 16, 0.6 + vr() * 0.4, 16 + vr() * 10, C_BRICK, -4, 1.4);
    }
    function onFreshFlame(idx, now) {
      var cx = (idx % W) * T + 24, cy = ((idx / W) | 0) * T + 26;
      addScorch(cx + (hash(idx, 1, now | 0) - 0.5) * 6, cy + (hash(idx, 2, now | 0) - 0.5) * 6, 17 + hash(idx, 3, 9) * 6, now);
      if (RM) return;
      for (var e = 0; e < 2; e++) emit(K_EMBER, cx + (vr() - 0.5) * 28, cy + (vr() - 0.5) * 22, (vr() - 0.5) * 40, -40 - vr() * 60, 0.4 + vr() * 0.5, 1.4 + vr() * 1.6, COLS_FIRE[(vr() * 4) | 0], -30, 1.5);
    }
    function onCollect(idx, code, now) {
      var key = PU_KEYS[code] || 'bomb', cx = (idx % W) * T + 24, cy = ((idx / W) | 0) * T + 20;
      addText(PU[key].label, cx, cy - 8, PU_PCOL[code], now);
      addRing(1, cx, cy, 6, 30, 380, PU_PCOL[code], now);
      if (RM) return;
      burst(K_STAR, cx, cy, 12, 60, 150, 0.35, 0.7, 2, 3.6, [PU_PCOL[code], C_WHITE], 60, 2.5, 30);
    }
    function onDeath(r, now) {
      var cx = r.x * T + 24, cy = r.y * T + 26, C = CHAR[r.ckey];
      if (r.ckey.charAt(0) === 'e') addText('+120', cx, cy - 26, C_GOLD, now);
      if (RM) return;
      var col = CHAR_PCOL[r.ckey];
      burst(K_SPARK, cx, cy, 10, 70, 190, 0.3, 0.6, 1.6, 3, [col, C_WHITE, C_LEMON], 140, 2, 30);
      if (C.kind === 'bot') burst(K_DEBRIS, cx, cy - 6, 8, 80, 170, 0.6, 0.9, 2.5, 4, COLS_BOT, 480, 1, 120);
      else burst(K_DEBRIS, cx, cy - 6, 6, 60, 140, 0.5, 0.8, 2.5, 4, [col, C_BOMB], 420, 1, 100);
      for (var i = 0; i < 4; i++) emit(K_SMOKE, cx + (vr() - 0.5) * 18, cy - 4 + (vr() - 0.5) * 12, (vr() - 0.5) * 26, -26 - vr() * 20, 0.8 + vr() * 0.5, 14 + vr() * 10, C_SLATE, -4, 1.3);
      addRing(1, cx, cy - 14, 8, 34, 320, col, now);
      shake(1.6);
    }
    function onShieldPop(r, now) {
      var cx = r.x * T + 24, cy = r.y * T + 24;
      r.hitT = now;
      addRing(1, cx, cy - 6, 22, 40, 360, C_VIOLET, now);
      if (RM) return;
      burst(K_STAR, cx, cy - 6, 14, 80, 170, 0.35, 0.6, 2, 3.4, [C_VIOLET, C_WHITE, C_STEEL], 40, 2.5, 0);
    }
    function onVictory(now) {
      winT0 = now;
      if (RM) return;
      for (var i = 0; i < 110; i++) {
        emit(K_CONF, vr() * LW, -10 - vr() * 60, (vr() - 0.5) * 80, 40 + vr() * 120, 2.2 + vr() * 1.6, 4 + vr() * 3, CONFETTI[(vr() * CONFETTI.length) | 0], 150, 0.9);
      }
    }

    function strSeed(str) {
      var h = 7;
      for (var i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
      return hash(h, str.length, 4);
    }
    function newRec(id, ckey, x, y) {
      return { id: id, ckey: ckey, x: x, y: y, fx: x, fy: y, tx: x, ty: y, t0: 0, dur: 1, face: 0, phase: 0, mv: 0, lean: 0,
        alive: true, dying: 0, sh: 0, hitT: -1e9, seed: strSeed(id), frame: -1 };
    }
    function faceFrom(r, dx, dy) {
      if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return;
      if (Math.abs(dx) >= Math.abs(dy)) r.face = dx > 0 ? 3 : 2; else r.face = dy > 0 ? 0 : 1;
    }
    function track(id, ckey, lx, ly, alive, sh, dur, external, snapAll, now, dt) {
      var r = recs[id];
      if (!r) { r = recs[id] = newRec(id, ckey, lx, ly); r.alive = alive; r.sh = sh; recList.push(r); }
      r.ckey = ckey; r.frame = frameNo;
      if (snapAll || (alive && !r.alive)) {
        r.x = r.fx = r.tx = lx; r.y = r.fy = r.ty = ly; r.alive = alive; r.dying = 0; r.sh = sh; r.mv = 0;
        return;
      }
      if (!alive) {
        if (r.alive) {
          /* update() moves a player/bot before checking blast contact, so the
             fatal step may not have been drawn yet: die on the final tile,
             not the previous (possibly safe) one. */
          r.x = r.fx = r.tx = lx; r.y = r.fy = r.ty = ly; r.mv = 0;
          r.alive = false; r.dying = now; onDeath(r, now);
        }
        return;
      }
      if (sh < r.sh) onShieldPop(r, now);
      r.sh = sh;
      var ox = r.x, oy = r.y;
      if (external) {
        if (Math.abs(lx - r.x) + Math.abs(ly - r.y) > 1.6) { r.x = lx; r.y = ly; ox = lx; oy = ly; }
        else { faceFrom(r, lx - r.x, ly - r.y); r.x = lx; r.y = ly; }
        r.tx = r.fx = lx; r.ty = r.fy = ly;
      } else {
        if (lx !== r.tx || ly !== r.ty) {
          var jump = Math.abs(lx - r.x) + Math.abs(ly - r.y);
          if (RM || jump > 1.6 || dur <= 0) { r.x = r.fx = r.tx = lx; r.y = r.fy = r.ty = ly; ox = lx; oy = ly; }
          else { faceFrom(r, lx - r.tx, ly - r.ty); r.fx = r.x; r.fy = r.y; r.tx = lx; r.ty = ly; r.t0 = now; r.dur = dur; }
        }
        if (r.x !== r.tx || r.y !== r.ty) {
          var u = clamp((now - r.t0) / r.dur, 0, 1);
          r.x = r.fx + (r.tx - r.fx) * u; r.y = r.fy + (r.ty - r.fy) * u;
          if (u >= 1) { r.x = r.tx; r.y = r.ty; }
        }
      }
      var dist = Math.abs(r.x - ox) + Math.abs(r.y - oy);
      r.phase += dist * Math.PI;
      var k = Math.min(1, dt / 70);
      r.mv += ((dist > 0.0004 ? 1 : 0) - r.mv) * k;
      var targetLean = 0;
      if (dist > 0.0004) targetLean = (r.face === 3 ? 0.08 : (r.face === 2 ? -0.08 : 0));
      r.lean += (targetLean - r.lean) * k;
    }

    function sync(v, now, dt) {
      var m = v.m;
      var newMap = false, i, idx;
      if (m && m.length) {
        var crateGone = 0, wallsChanged = false, cratesChanged = false, firstMap = !haveMap;
        for (i = 0; i < N; i++) crateGoneAt[i] = 0;
        for (var y = 0; y < H; y++) {
          var row = m[y];
          for (var x = 0; x < W; x++) {
            idx = y * W + x;
            var t = row ? row[x] : 'wall';
            var c = t === 'crate' ? 1 : 0, w = t === 'wall' ? 1 : 0;
            if (w !== prevWall[idx]) { wallsChanged = true; prevWall[idx] = w; }
            if (c !== prevCrate[idx]) {
              cratesChanged = true;
              if (c) newMap = true; else crateGone++;
              prevCrate[idx] = c;
              crateGoneAt[idx] = c ? 0 : 1;
            }
          }
        }
        if (firstMap) { haveMap = true; newMap = true; wallsChanged = true; cratesChanged = true; }
        if (wallsChanged) baseDirty = true;
        if (cratesChanged) compDirty = true;
        if (newMap) clearFx();
        else if (crateGone) {
          for (i = 0; i < N; i++) if (crateGoneAt[i]) onCrateBreak(i, now);
        }
      }
      // explosions grid
      for (i = 0; i < N; i++) { exT[i] = 0; bombCur[i] = 0; puCur[i] = 0; }
      var ex = v.ex || [];
      for (i = 0; i < ex.length; i++) {
        var e = ex[i];
        if (!(e.x >= 0 && e.x < W && e.y >= 0 && e.y < H)) continue;
        idx = e.y * W + e.x;
        if (e.t > exT[idx]) exT[idx] = e.t;
      }
      for (i = 0; i < N; i++) {
        if (exT[i] > 0 && exT[i] > exPrev[i] + 8) { exBorn[i] = now; if (!newMap) onFreshFlame(i, now); }
      }
      // bombs
      var bb = v.bb || [];
      for (i = 0; i < bb.length; i++) {
        var b = bb[i];
        if (!(b.x >= 0 && b.x < W && b.y >= 0 && b.y < H)) continue;
        idx = b.y * W + b.x;
        bombCur[idx] = 1;
        if (!bombPrev[idx] || newMap) { bombBorn[idx] = newMap ? now - 2000 : now; bombInit[idx] = Math.max(1, b.t); }
        else if (b.t > bombInit[idx]) bombInit[idx] = b.t;
        bombOwner[idx] = b.owner;
      }
      for (i = 0; i < N; i++) {
        if (bombPrev[i] && !bombCur[i] && exT[i] > 0 && !newMap) onDetonate(i, bombOwner[i], now);
        bombPrev[i] = bombCur[i];
        exPrev[i] = exT[i];
      }
      // power-ups
      var pus = v.powerups || [];
      for (i = 0; i < pus.length; i++) {
        var p = pus[i];
        if (!(p.x >= 0 && p.x < W && p.y >= 0 && p.y < H)) continue;
        idx = p.y * W + p.x;
        var code = PU_CODE[p.type] || 1;
        puCur[idx] = code;
        if (puPrev[idx] !== code) puBorn[idx] = newMap ? now - 2000 : now;
      }
      for (i = 0; i < N; i++) {
        if (puPrev[i] && !puCur[i] && !newMap) onCollect(i, puPrev[i], now);
        puPrev[i] = puCur[i];
      }
      // characters
      var players = v.players || [], en = v.en || [];
      for (i = 0; i < players.length; i++) {
        var pl = players[i], pid = pl.id || ('p' + (i + 1));
        var lx = pl.x, ly = pl.y, ext = false;
        if (v.guestInterp && v.remotePlayers) {
          var ent = v.remotePlayers[pl.id || ('p' + i)];
          if (ent) { lx = ent.x; ly = ent.y; ext = true; }
        }
        var md = Number.isFinite(pl.md) ? pl.md : 110;
        var dur = v.guestNoInterp ? 0 : clamp(md, 60, 140);
        track(pid, i === 0 ? 'p1' : 'p2', lx, ly, !!pl.a, pl.sh || 0, dur, ext, newMap, now, dt);
      }
      for (i = 0; i < en.length; i++) {
        var o = en[i], eid = 'E' + (o.id || ('e' + i));
        var elx = o.x, ely = o.y, eext = false;
        if (v.guestInterp && v.remoteEnemies && v.remoteEnemies[i]) { elx = v.remoteEnemies[i].x; ely = v.remoteEnemies[i].y; eext = true; }
        track(eid, CKEYS[2 + (i % 3)], elx, ely, !!o.a, 0, v.guestNoInterp ? 0 : 170, eext, newMap, now, dt);
      }
      // round flags
      if (v.win && !prevWin) onVictory(now);
      if (v.over && !v.win && !prevOver) lossT0 = now;
      if (v.over && !prevOver) endT0 = now;
      if (!v.over) { winT0 = v.win ? winT0 : -1e9; lossT0 = -1e9; }
      if (newMap) { winT0 = -1e9; lossT0 = -1e9; youT0 = -1e9; }
      if (v.run && !prevRun && !prevPau) youT0 = now;
      prevWin = !!v.win; prevOver = !!v.over; prevRun = !!v.run; prevPau = !!v.pau;
    }

    /* ======================= per-frame drawing ======================= */
    var drawList = [];
    function drawScorch(now) {
      var spr = sprites.scorch;
      for (var i = 0; i < SMAX; i++) {
        var age = now - scT0[i];
        if (age < 0 || age > 6000) continue;
        var a = 0.62 * (1 - age / 6000);
        ctx.globalAlpha = a;
        var r = scR[i];
        ctx.drawImage(spr, scX[i] - r, scY[i] - r * 0.8, r * 2, r * 1.6);
      }
      ctx.globalAlpha = 1;
    }
    function drawCrateBreaks(now) {
      for (var i = 0; i < CBMAX; i++) {
        var age = now - cbT0[i];
        if (age < 0 || age > 240) continue;
        var u = age / 240, s = RM ? 1 : 1 + 0.22 * u;
        var x = cbX[i], y = cbY[i], spr = sprites.crate[(hash(x, y, 7) * 3) | 0];
        ctx.globalAlpha = 1 - u;
        ctx.drawImage(spr, x * T + 26 - 26 * s, y * T + 28 - 28 * s, 52 * s, 56 * s);
      }
      ctx.globalAlpha = 1;
    }
    function drawPowerups(now, v) {
      var pus = v.powerups || [];
      for (var i = 0; i < pus.length; i++) {
        var p = pus[i];
        if (!(p.x >= 0 && p.x < W && p.y >= 0 && p.y < H)) continue;
        var key = PU[p.type] ? p.type : 'bomb', idx = p.y * W + p.x;
        var cx = p.x * T + 24, cy = p.y * T + 24;
        var age = now - puBorn[idx];
        var pop = RM ? 1 : (age < 360 ? Math.max(0.05, easeOutBack(clamp(age / 360, 0, 1))) : 1);
        var bob = RM ? 0 : Math.sin(now / 330 + idx * 0.9) * 2.4;
        var pulse = RM ? 0.5 : 0.5 + 0.5 * Math.sin(now / 420 + idx);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (0.35 + 0.25 * pulse) * Math.min(1, pop);
        ctx.drawImage(sprites.puGlow[key], cx - 27, cy - 25, 54, 54);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.75 * Math.min(1, pop);
        var sw = 26 - bob * 1.2;
        ctx.drawImage(sprites.shadow, cx - sw / 2, cy + 12, sw, 9);
        ctx.globalAlpha = 1;
        var s = 0.94 * pop;
        ctx.drawImage(sprites.pu[key], cx - 20 * s, cy - 22 * s - bob - 2, 40 * s, 40 * s);
        if (!RM && vr() < 0.012) emit(K_STAR, cx + (vr() - 0.5) * 24, cy - 6 + (vr() - 0.5) * 20, 0, -12, 0.5, 2.2, PU_PCOL[PU_CODE[key]], 0, 0);
      }
    }
    function drawBombs(now, v) {
      var bb = v.bb || [];
      for (var i = 0; i < bb.length; i++) {
        var b = bb[i];
        if (!(b.x >= 0 && b.x < W && b.y >= 0 && b.y < H)) continue;
        var idx = b.y * W + b.x, cx = b.x * T + 24, cy = b.y * T + 26;
        var init = bombInit[idx] || 1800, frac = clamp(b.t / init, 0, 1);
        var el = Math.max(0, init - b.t);
        var phase = el * 0.009 + el * el * 0.0000042;
        var age = now - bombBorn[idx];
        var pop = RM ? 1 : (age < 200 ? Math.max(0.1, easeOutBack(clamp(age / 200, 0, 1))) : 1);
        var pulse = RM ? 1 : 1 + 0.055 * Math.sin(phase);
        var C = CHAR[ownerKey(b.owner)];
        // floor ring in the owner's colour + shadow
        ctx.globalAlpha = 0.8;
        ctx.drawImage(sprites.shadow, cx - 16, cy + 8, 32, 11);
        ctx.globalAlpha = 0.55 + 0.25 * (RM ? 0 : Math.sin(phase));
        ctx.beginPath(); ctx.ellipse(cx, cy + 13, 17, 6, 0, 0, Math.PI * 2);
        ctx.strokeStyle = C.base; ctx.lineWidth = 1.8; ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(cx, cy);
        var s = pop * pulse;
        ctx.scale(s, s * (RM ? 1 : (1 - 0.03 * Math.sin(phase))));
        ctx.drawImage(sprites.bombBy[ownerKey(b.owner)], -24, -26, 48, 48);   // owner band baked in
        // last-moment red flash
        if (frac < 0.32) {
          var f = (0.5 + 0.5 * Math.sin(phase * 2.2)) * (0.32 - frac) / 0.32;
          ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fillStyle = '#ff4630'; ctx.globalAlpha = f * 0.55; ctx.fill();
          ctx.globalAlpha = f * 0.35;
          ctx.drawImage(sprites.bombW, -24, -26, 48, 48);
          ctx.globalAlpha = 1;
        }
        // burning fuse (partial quadratic: control (1-f)P0 + fP1, end P(f))
        var p0x = 6.4, p0y = -16.8, p1x = 10.8, p1y = -26.4, p2x = 18.6, p2y = -24.4;
        var fl = 0.12 + 0.88 * frac, q = 1 - fl;
        var qx = q * p0x + fl * p1x, qy = q * p0y + fl * p1y;
        var ex = q * q * p0x + 2 * q * fl * p1x + fl * fl * p2x, ey = q * q * p0y + 2 * q * fl * p1y + fl * fl * p2y;
        ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.quadraticCurveTo(qx, qy, ex, ey);
        ctx.lineCap = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 3.8; ctx.stroke();
        ctx.strokeStyle = '#e8c48a'; ctx.lineWidth = 1.9; ctx.stroke();
        // spark
        var fl2 = RM ? 1 : 0.8 + vr() * 0.4;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.85;
        ctx.drawImage(sprites.glow, ex - 11 * fl2, ey - 11 * fl2, 22 * fl2, 22 * fl2);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.translate(ex, ey); if (!RM) ctx.rotate(now / 90);
        ctx.drawImage(sprites.spark, -10 * fl2, -10 * fl2, 20 * fl2, 20 * fl2);
        ctx.restore();
        if (!RM && vr() < 0.22) emit(K_SPARK, cx + ex * s, cy + ey * s, (vr() - 0.3) * 60, -30 - vr() * 50, 0.18 + vr() * 0.2, 1 + vr() * 0.9, vr() < 0.5 ? C_LEMON : C_WHITE, 160, 1);
      }
    }

    function drawRaiderDetail(r, C, now, face, alpha) {
      // eyes
      var o = FACE_OFF[face];
      var blink = !RM && ((now + r.seed * 5000) % 4100) < 120;
      ctx.drawImage(sprites.eyes[face * 2 + (blink ? 1 : 0)], o[0] - 13, -20.3 + o[1] - 8, 26, 16);
      // scarf knot + fluttering tail (streams behind the direction of travel)
      var dir = face === 3 ? -1 : 1;
      var kx = dir * 10.5, ky = -9.6;
      var wv = RM ? 0 : Math.sin(now / 85 + r.seed * 9) * (0.6 + 1.4 * r.mv);
      var len = 8 + 5 * r.mv;
      ctx.beginPath();
      ctx.moveTo(kx, ky - 1.2);
      ctx.quadraticCurveTo(kx + dir * len * 0.55, ky + 1 + wv, kx + dir * len, ky + 2.5 + wv * 1.4 - r.mv * 3);
      ctx.lineTo(kx + dir * (len - 1.5), ky + 6 + wv * 1.4 - r.mv * 3);
      ctx.quadraticCurveTo(kx + dir * len * 0.45, ky + 5 + wv, kx, ky + 2.6);
      ctx.closePath();
      ctx.fillStyle = C.trim; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.beginPath(); ctx.arc(kx, ky + 0.6, 2.7, 0, Math.PI * 2); ctx.fillStyle = C.trimD; ctx.fill(); ctx.stroke();
    }
    function drawBotDetail(r, C, now, face) {
      var exo = 0, eyo = 0;
      if (face === 1) eyo = -2; else if (face === 2) exo = -4; else if (face === 3) exo = 4; else eyo = 0.8;
      if (!RM) exo += Math.sin(now / 640 + r.seed * 7) * 1.4 * (1 - r.mv);
      var ex = exo, ey = -21 + eyo, ga = ctx.globalAlpha;
      ctx.drawImage(sprites.botEye[r.ckey], ex - 13, ey - 10, 26, 20);
      if (C.top === 'rotor') {
        var a = RM ? 0.6 : now * 0.03;
        var rx = 1.5 + 11.5 * Math.abs(Math.cos(a));
        ctx.beginPath(); ctx.ellipse(0, -41.5, 12.5, 2.6, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, -41.5, rx, 2.3, 0, 0, Math.PI * 2); ctx.fillStyle = C.light; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -41.5, 2, 0, Math.PI * 2); ctx.fillStyle = C.deep; ctx.fill(); ctx.stroke();
      } else if (C.top === 'antenna' && !RM) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = ga * (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(now / 260 + r.seed * 4)));
        ctx.drawImage(sprites.chGlow[r.ckey], -9, -52.5, 18, 18);
        ctx.globalAlpha = ga; ctx.globalCompositeOperation = 'source-over';
      }
    }

    function drawCharacter(r, now, v) {
      var C = CHAR[r.ckey], bot = C.kind === 'bot';
      var cx = r.x * T + 24, fy = r.y * T + 45;
      var alpha = 1, lift = 0, sx = 1, sy = 1, flash = 0, ghost = false;
      if (!r.alive) {
        var d = now - r.dying;
        if (RM) { alpha = 1 - d / 320; if (alpha <= 0) return; }
        else if (d < 150) { var u0 = d / 150; sx = 1 + 0.22 * u0; sy = 1 - 0.26 * u0; flash = 1 - u0 * 0.3; }
        else {
          if (bot) return;
          var u = (d - 150) / 850; if (u >= 1) return;
          ghost = true; alpha = 0.5 * (1 - u); lift = 28 * easeOutCubic(u); sx = sy = 1 - 0.12 * u;
        }
      }
      var bob = 0, stepL = 0, stepR = 0, lean = 0;
      if (!RM && r.alive) {
        var sn = Math.sin(r.phase), as = Math.abs(sn);
        bob = as * 2.8 * r.mv;
        stepL = Math.max(0, sn) * 2.6 * r.mv; stepR = Math.max(0, -sn) * 2.6 * r.mv;
        var br = Math.sin(now / 430 + r.seed * 6.283);
        sy = 1 + 0.03 * br * (1 - r.mv) - 0.05 * r.mv * (1 - as);
        sx = 1 - 0.022 * br * (1 - r.mv) + 0.045 * r.mv * (1 - as);
        lean = r.lean;
        var wa = now - winT0;
        if (wa >= 0 && wa < 2800) bob += Math.abs(Math.sin(wa / 150)) * 6 * (1 - wa / 2800);
      }
      // shadow (stays on the floor)
      ctx.globalAlpha = ghost ? alpha * 0.4 : alpha * 0.92;
      var shw = 30 - bob * 1.4;
      ctx.drawImage(sprites.shadow, cx - shw / 2, fy - 4.5, shw, 10);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, fy - bob - lift);
      if (lean) ctx.rotate(lean);
      ctx.scale(sx, sy);
      // feet / legs
      var foot = sprites.foot[r.ckey];
      if (bot) {
        ctx.drawImage(foot, -12.3, -9 - stepL, 14, 11); ctx.drawImage(foot, 0.3, -9 - stepR, 14, 11);
      } else {
        ctx.drawImage(foot, -14, -6.6 - stepL, 14, 11); ctx.drawImage(foot, 0, -6.6 - stepR, 14, 11);
      }
      ctx.drawImage(sprites.ch[r.ckey], -24, -50, 48, 56);
      if (!ghost) {
        if (bot) drawBotDetail(r, C, now, r.face); else drawRaiderDetail(r, C, now, r.face, alpha);
      }
      var hit = now - r.hitT;
      if (hit >= 0 && hit < 260) flash = Math.max(flash, 1 - hit / 260);
      if (ghost) flash = 0.55;
      if (flash > 0) {
        ctx.globalAlpha = alpha * flash;
        ctx.drawImage(sprites.chW[r.ckey], -24, -50, 48, 56);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      // shield bubble
      if (r.alive && r.sh > 0) {
        var by = fy - 21 - bob, rad = 24 + (RM ? 0 : Math.sin(now / 260) * 0.9);
        ctx.beginPath(); ctx.arc(cx, by, rad, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(143,116,255,.14)'; ctx.fill();
        ctx.strokeStyle = 'rgba(206,194,255,.85)'; ctx.lineWidth = 1.7; ctx.stroke();
        var a0 = RM ? -2.4 : now / 700;
        ctx.beginPath(); ctx.arc(cx, by, rad - 3.2, a0, a0 + 0.9); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; ctx.stroke();
        for (var pi = 0; pi < r.sh; pi++) {
          var px = cx - (r.sh - 1) * 4.5 + pi * 9, py = by - rad;
          ctx.beginPath(); ctx.moveTo(px, py - 4); ctx.lineTo(px + 3.4, py); ctx.lineTo(px, py + 4); ctx.lineTo(px - 3.4, py); ctx.closePath();
          ctx.fillStyle = '#e0d6ff'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.stroke();
        }
      }
    }
    function drawCharacters(now, v) {
      var n = 0;
      for (var i = 0; i < recList.length; i++) {
        var r = recList[i];
        if (r.frame !== frameNo) continue;
        if (!r.alive && now - r.dying > 1100) continue;
        // insertion sort by y (depth)
        var j = n; drawList[n++] = r;
        while (j > 0 && drawList[j - 1].y > r.y) { drawList[j] = drawList[j - 1]; j--; }
        drawList[j] = r;
      }
      for (var k = 0; k < n; k++) drawCharacter(drawList[k], now, v);
    }

    function drawFlames(now, v) {
      var any = false, i;
      // the simulation stops when a round ends; let the last flames die down visually
      var endFade = v.over ? clamp(1 - (now - endT0 - 100) / 520, 0, 1) : 1;
      for (i = 0; i < N; i++) {
        var t = exT[i];
        if (t <= 0) { flameW[i] = 0; continue; }
        var life = clamp(t / 520, 0, 1);
        var grow = RM ? 1 : clamp((now - exBorn[i]) / 110, 0, 1);
        var g = 0.5 + 0.5 * easeOutCubic(grow);
        var shrink = life < 0.42 ? easeOutCubic(life / 0.42) : 1;
        var flick = RM ? 1 : 1 + 0.07 * Math.sin(now * 0.04 + i * 1.9);
        flameW[i] = T * 0.74 * g * shrink * flick * endFade;
        if (flameW[i] < 2) { flameW[i] = 0; continue; }
        any = true;
      }
      if (!any) return;
      // four bands, wide to narrow: ink outline, fire, amber, white-hot core (the cover's beam)
      flamePass(INK, 1, 4.5);
      flamePass('#ff6a1a', 1, 0);
      flamePass('#ffb83a', 0.62, 0);
      flamePass('#fff1b0', 0.27, 0);
      if (!RM) flameTongues(now);
    }
    /* flickering licks along the beams (additive, one batched path) */
    function flameTongues(now) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16 + 0.06 * Math.sin(now * 0.021);
      ctx.fillStyle = '#ff8a2a';
      ctx.beginPath();
      for (var i = 0; i < N; i++) {
        var w = flameW[i]; if (w <= 0) continue;
        var x = (i % W) * T + 24, y = ((i / W) | 0) * T + 24;
        for (var j = 0; j < 1; j++) {
          var ph = now * 0.017 + i * 2.3 + j * 3.1;
          var ox = Math.sin(ph * 1.3) * w * 0.3, oy = Math.cos(ph) * w * 0.3;
          var r = w * (0.14 + 0.05 * Math.sin(ph * 2.1));
          ctx.moveTo(x + ox + r, y + oy); ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    /* One colour layer of every beam: a circle per burning cell plus an axis-aligned
       bar to each burning neighbour, all in ONE path and ONE fill (same winding, so the
       sub-shapes union cleanly). Layers drawn wide-to-narrow give the cover's banding. */
    function flamePass(col, mul, add) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (var i = 0; i < N; i++) {
        var w = flameW[i]; if (w <= 0) continue;
        // the outline thins with the flame, so dying beams never leave bare ink lines
        var cx = i % W, cy = (i / W) | 0, x = cx * T + 24, y = cy * T + 24, r = (w * mul + add * Math.min(1, w / 16)) / 2;
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (cx + 1 < W) {
          var wb = flameW[i + 1];
          if (wb > 0) { var mb = Math.min(w, wb), hb = (mb * mul + add * Math.min(1, mb / 16)) / 2; ctx.rect(x, y - hb, T, hb * 2); }
        }
        if (cy + 1 < H) {
          var wc = flameW[i + W];
          if (wc > 0) { var mc = Math.min(w, wc), hc = (mc * mul + add * Math.min(1, mc / 16)) / 2; ctx.rect(x - hc, y, hc * 2, T); }
        }
      }
      ctx.fill();
    }

    function stepParticles(dt) {
      var s = dt / 1000;
      for (var i = 0; i < PMAX; i++) {
        if (pLife[i] <= 0) continue;
        pLife[i] -= s;
        var dr = Math.max(0, 1 - pDrag[i] * s);
        pVX[i] *= dr; pVY[i] = pVY[i] * dr + pG[i] * s;
        pX[i] += pVX[i] * s; pY[i] += pVY[i] * s;
        pRot[i] += pVR[i] * s;
      }
    }
    function drawSmoke() {
      var i, u, a;
      for (i = 0; i < PMAX; i++) {
        if (pLife[i] <= 0) continue;
        var kd = pKind[i];
        if (kd !== K_SMOKE && kd !== K_DUST) continue;
        u = 1 - pLife[i] / pMax[i];
        a = (u < 0.2 ? u / 0.2 : 1 - (u - 0.2) / 0.8) * 0.7;
        var sz = pSize[i] * (0.6 + u * 1.1);
        ctx.globalAlpha = a;
        ctx.drawImage(kd === K_SMOKE ? sprites.smoke : sprites.dust, pX[i] - sz / 2, pY[i] - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
    }
    function drawParticles(ox, oy) {
      var i, u, a;
      for (i = 0; i < PMAX; i++) {
        if (pLife[i] <= 0) continue;
        var k2 = pKind[i];
        if (k2 !== K_DEBRIS && k2 !== K_CONF) continue;
        u = 1 - pLife[i] / pMax[i];
        a = u > 0.75 ? 1 - (u - 0.75) / 0.25 : 1;
        var c = Math.cos(pRot[i]), sn = Math.sin(pRot[i]), fl = k2 === K_CONF ? Math.cos(pRot[i] * 1.7) : 1;
        ctx.globalAlpha = a;
        ctx.setTransform(c * fl * SX, sn * fl * SY, -sn * SX, c * SY, (pX[i] + ox) * SX, (pY[i] + oy) * SY);
        ctx.fillStyle = PCOL[pCol[i]];
        var z = pSize[i];
        if (k2 === K_CONF) ctx.fillRect(-z / 2, -z * 0.3, z, z * 0.6);
        else { ctx.fillRect(-z / 2, -z / 2, z, z); ctx.fillStyle = 'rgba(27,18,48,.45)'; ctx.fillRect(-z / 2, z * 0.15, z, z * 0.35); }
      }
      ctx.setTransform(SX, 0, 0, SY, ox * SX, oy * SY);
      // additive pass: sparks, stars, embers
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < PMAX; i++) {
        if (pLife[i] <= 0) continue;
        var k3 = pKind[i];
        if (k3 !== K_SPARK && k3 !== K_STAR && k3 !== K_EMBER) continue;
        u = 1 - pLife[i] / pMax[i];
        a = 1 - u * u;
        var z2 = pSize[i] * (1 - u * 0.6);
        ctx.globalAlpha = a;
        ctx.fillStyle = PCOL[pCol[i]];
        if (k3 === K_STAR) {
          var x = pX[i], y = pY[i];
          ctx.beginPath(); ctx.moveTo(x, y - z2 * 1.6); ctx.lineTo(x + z2 * 0.45, y); ctx.lineTo(x, y + z2 * 1.6); ctx.lineTo(x - z2 * 0.45, y); ctx.closePath();
          ctx.moveTo(x - z2 * 1.6, y); ctx.lineTo(x, y - z2 * 0.45); ctx.lineTo(x + z2 * 1.6, y); ctx.lineTo(x, y + z2 * 0.45); ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(pX[i], pY[i], z2, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    function drawRings(now) {
      for (var i = 0; i < RMAX; i++) {
        var age = now - rgT0[i];
        if (age < 0 || age > rgDur[i]) continue;
        var u = age / rgDur[i], r = rgR0[i] + (rgR1[i] - rgR0[i]) * easeOutCubic(u);
        if (rgKind[i] === 2) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (RM ? 0.5 : 0.85) * (1 - u);
          ctx.drawImage(sprites.glow, rgX[i] - r, rgY[i] - r, r * 2, r * 2);
          ctx.globalCompositeOperation = 'source-over';
        } else {
          ctx.globalAlpha = 0.9 * (1 - u);
          ctx.beginPath(); ctx.arc(rgX[i], rgY[i], r, 0, Math.PI * 2);
          ctx.strokeStyle = PCOL[rgCol[i]]; ctx.lineWidth = 3 * (1 - u) + 0.8; ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    function drawTexts(now) {
      var set = false;
      for (var i = 0; i < TMAX; i++) {
        var age = now - txT0[i];
        if (age < 0 || age > 1100) continue;
        if (!set) { ctx.font = '700 10px Unbounded, Outfit, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; set = true; }
        var u = age / 1100, y = txY[i] - (RM ? 0 : 22 * easeOutCubic(u));
        var pop = RM ? 1 : (age < 140 ? 0.6 + 0.4 * easeOutBack(age / 140) : 1);
        ctx.globalAlpha = u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1;
        ctx.save(); ctx.translate(txX[i], y); ctx.scale(pop, pop);
        ctx.strokeStyle = INK; ctx.lineWidth = 3.4; ctx.strokeText(txStr[i], 0, 0);
        ctx.fillStyle = PCOL[txCol[i]]; ctx.fillText(txStr[i], 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    var pillW = {};
    function pill(text, cx, y, fill, edge, fg) {
      ctx.font = '700 8px Unbounded, Outfit, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var w = pillW[text];
      if (!w) w = pillW[text] = Math.max(18, ctx.measureText(text).width + 9);
      rr(ctx, cx - w / 2, y - 6.5, w, 13, 6.5);
      ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = fg; ctx.fillText(text, cx, y + 0.5);
    }
    function drawMarkers(now, v) {
      var online = v.mode === 'multi';
      var sinceStart = now - youT0;
      var showYou = !online && !v.over && (!v.run && !v.pau ? true : (sinceStart >= 0 && sinceStart < 3000));
      for (var i = 0; i < recList.length; i++) {
        var r = recList[i];
        if (r.frame !== frameNo || !r.alive || r.ckey.charAt(0) !== 'p') continue;
        var cx = r.x * T + 24, top = r.y * T - 3 - (r.sh > 0 ? 7 : 0);
        var bob = RM ? 0 : Math.sin(now / 260) * 1.6;
        var mine = r.id === v.localId;
        if (online) {
          var C = CHAR[r.ckey];
          ctx.globalAlpha = 0.95;
          pill(C.tag, cx, top - 6 + bob * 0.5, mine ? accent : 'rgba(20,14,40,.88)', INK, mine ? '#fff' : C.base);
          ctx.globalAlpha = 1;
        } else if (mine && showYou) {
          var fade = (v.run && sinceStart > 2400) ? 1 - (sinceStart - 2400) / 600 : 1;
          ctx.globalAlpha = clamp(fade, 0, 1);
          pill('YOU', cx, top - 10 + bob, accent, INK, '#fff');
          ctx.beginPath(); ctx.moveTo(cx - 4, top - 3 + bob); ctx.lineTo(cx + 4, top - 3 + bob); ctx.lineTo(cx, top + 2 + bob); ctx.closePath();
          ctx.fillStyle = accent; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
    function drawEndState(now, v) {
      var la = now - lossT0;
      if (v.over && !v.win && la >= 0) {
        ctx.globalAlpha = RM ? 0.38 : 0.38 * clamp(la / 700, 0, 1);
        ctx.fillStyle = '#0c0414'; ctx.fillRect(0, 0, LW, LH);
        ctx.globalAlpha = 1;
      }
      var wa = now - winT0;
      if (v.win && wa >= 0 && wa < 2200) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35 * (1 - wa / 2200);
        ctx.drawImage(sprites.gold, LW / 2 - LW * 0.6, LH / 2 - LW * 0.6, LW * 1.2, LW * 1.2);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
    }

    function render(v) {
      var now = performance.now();
      var dt = lastNow ? Math.min(50, Math.max(0, now - lastNow)) : 16;
      lastNow = now; frameNo++;
      if (needResize || !sprites) applySize();
      if (!sprites) return;
      sync(v, now, dt);
      if (baseDirty && v.m) buildBase(v.m);
      if (compDirty && v.m) buildComp(v.m);
      stepParticles(dt);
      var ox = 0, oy = 0;
      if (shakeAmp > 0.05 && !RM) { ox = (vr() * 2 - 1) * shakeAmp; oy = (vr() * 2 - 1) * shakeAmp; }
      shakeAmp *= Math.exp(-dt / 80);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (ox || oy) { ctx.fillStyle = '#1a0a1c'; ctx.fillRect(0, 0, bw, bh); }
      ctx.drawImage(compCv, Math.round(ox * SX), Math.round(oy * SY));
      ctx.setTransform(SX, 0, 0, SY, ox * SX, oy * SY);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      drawScorch(now);
      drawCrateBreaks(now);
      drawPowerups(now, v);
      drawBombs(now, v);
      drawCharacters(now, v);
      drawSmoke();
      drawFlames(now, v);
      drawParticles(ox, oy);
      drawRings(now);
      drawTexts(now);
      drawMarkers(now, v);
      drawEndState(now, v);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }

    return { render: render, resize: function () { needResize = true; }, get reducedMotion() { return RM; } };
  }

  window.BomberRaidArt = { create: create, CHAR: CHAR, POWERUPS: PU, VERSION: '1' };
})();
