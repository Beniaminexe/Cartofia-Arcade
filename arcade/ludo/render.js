/* ==========================================================================
   Cartofia Ludo — board renderer  (window.LudoRenderer)
   Vanilla JS (ES2020), no dependencies. Owns everything inside its container:
   board (SVG), tokens, crates, bombs, shields, effects, dice, player pods.
   Contract: /ludo-spec/SPEC.md §2, §4, §6, §7, §10.

   API (§10 + small additions):
     const r = new LudoRenderer(el, { viewSeat, reducedMotion, sound = true, timeScale = 1 });
     r.setState(state)                 instant, idempotent sync (wire format §6; 2/3/4 seats; status
                                       "waiting" | "playing" | "finished")
     await r.playEvents(events, final) animates §7 events in order (calls are queued, never overlap;
                                       a backlog speeds up, then skips animation), then setState(final)
     r.setViewSeat(seat)               local seat's yard bottom-left (coordinates rotated, text upright)
     r.setSelectable([{seat, token}])  pulse ring + clickable; [] clears
     r.setTargeting(spec | null)       {kind: own_token|opponent_token|square|seat, valid: [...]}
     r.setDice({seat, values, phase, enabled, rolling, boost?, double?})
     r.setTimer(seat, deadlineMs, totalMs)   (seat null clears; ticks sound for the view seat < 5 s)
     r.showEmote(seat, emote); r.flash(text, kind, {icon?, hold?, y?}); r.celebrate(seat)
     r.on(evt, fn) -> unsubscribe fn; r.off(evt, fn)
        "token" {seat, token}  only for selectable tokens / valid targeting tokens
        "square" {abs}         only in square targeting
        "seat" {seat}          only in seat targeting (pod or yard click)
        "dice" {seat} on roll; {seat, index, value} when picking in choose_die (only when enabled)
        "pod" {seat}           any pod click
     r.resize(); r.destroy(); r.getState(); r.isBusy(); r.setReducedMotion(b); r.setSound(b)
     LudoRenderer.POWERUP_META {id: {name, icon_url, color, description, phases, target}}
     LudoRenderer.COLORS / GEOMETRY / SAFE_ABS / EVENT_TYPES / VERSION
   Clicking an enabled roll die starts the tumble immediately (optimistic) and emits "dice";
   if the server rejects, call setDice again and the die settles.
   ========================================================================== */
(function () {
  'use strict';
  if (window.LudoRenderer) return;

  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
  const BASE = SCRIPT_SRC ? SCRIPT_SRC.replace(/[?#].*$/, '').replace(/[^/]*$/, '') : '/arcade/ludo/';
  const VQ = '?v=1';

  /* ---------- geometry (embedded from board-geometry.json) ---------- */
  const GEO = {
    grid: 15,
    track: [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0]],
    home_column: { 0: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]], 1: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]], 2: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]], 3: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]] },
    starts_abs: [0, 13, 26, 39],
    stars_abs: [8, 21, 34, 47]
  };
  const TRACK = GEO.track, HOME = GEO.home_column;
  const STARTS = GEO.starts_abs, STARS = GEO.stars_abs;
  const SAFE = new Set(STARTS.concat(STARS));

  const COLORS = [
    { id: 'red', name: 'Red', base: '#ff3b55', light: '#ff8b99', dark: '#d3173b', deep: '#8c0b24', tint: '#ffe2e6', glow: 'rgba(255,59,85,.6)' },
    { id: 'green', name: 'Green', base: '#1fc66a', light: '#76eaa6', dark: '#0e984b', deep: '#075f2d', tint: '#d9fbe7', glow: 'rgba(31,198,106,.6)' },
    { id: 'yellow', name: 'Yellow', base: '#ffc21a', light: '#ffe383', dark: '#e89400', deep: '#975f00', tint: '#fff4d1', glow: 'rgba(255,194,26,.6)' },
    { id: 'blue', name: 'Blue', base: '#2f8cff', light: '#8cc0ff', dark: '#145ee0', deep: '#0a3994', tint: '#dfecff', glow: 'rgba(47,140,255,.6)' }
  ];

  const icon = (id) => BASE + 'assets/powerups/' + id + '.svg' + VQ;
  const POWERUP_META = {
    double_dice: { name: 'Double Dice', icon_url: icon('double_dice'), color: '#ff8a1f', description: 'Throw two dice on your next roll and keep the one you like.', phases: ['roll'], target: null },
    reroll: { name: 'Re-roll', icon_url: icon('reroll'), color: '#14c4e0', description: 'Discard this roll and throw again.', phases: ['move'], target: null },
    boost: { name: 'Rocket', icon_url: icon('boost'), color: '#ff4d3d', description: '+3 squares on this move (tokens already on the board).', phases: ['move'], target: null },
    shield: { name: 'Shield', icon_url: icon('shield'), color: '#4f7df9', description: 'Protect one of your tokens from captures and bombs for 2 rounds.', phases: ['roll', 'move'], target: 'own_token' },
    freeze: { name: 'Freeze', icon_url: icon('freeze'), color: '#5cc8ff', description: "Freeze an opponent: their next turn is skipped.", phases: ['roll', 'move'], target: 'seat' },
    bomb: { name: 'Bomb', icon_url: icon('bomb'), color: '#7c5bf5', description: 'Plant a bomb on an empty square. Opponents who land on it go home.', phases: ['roll', 'move'], target: 'square' },
    swap: { name: 'Swap', icon_url: icon('swap'), color: '#e649b5', description: 'Trade places with an opponent token (pick yours, then theirs).', phases: ['roll'], target: 'own_token+opponent_token' }
  };

  const YARD0 = [[0, 0], [0, 9], [9, 9], [9, 0]];                 // [row, col] of each yard's top-left cell
  const SLOT = [[1.95, 1.95], [1.95, 4.05], [4.05, 1.95], [4.05, 4.05]]; // [dy, dx] inside the yard
  const FIN_C = [[6.5, 7.5], [7.5, 6.5], [8.5, 7.5], [7.5, 8.5]];  // centroid of each finish triangle (x, y)
  const ALONG = [[1, 0], [0, 1], [-1, 0], [0, -1]];                // finish triangle "toward centre" axis
  const FACE_ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  const PIP_POS = { TL: [27, 27], TR: [73, 27], ML: [27, 50], C: [50, 50], MR: [73, 50], BL: [27, 73], BR: [73, 73] };
  const PIPS = { 1: ['C'], 2: ['TR', 'BL'], 3: ['TR', 'C', 'BL'], 4: ['TL', 'TR', 'BL', 'BR'], 5: ['TL', 'TR', 'C', 'BL', 'BR'], 6: ['TL', 'TR', 'ML', 'MR', 'BL', 'BR'] };
  const CORNERS = ['tl', 'tr', 'br', 'bl'];
  const SKIP_TEXT = { frozen: 'Frozen — turn skipped', three_sixes: 'Three sixes — turn lost', no_moves: 'No moves', pass: 'Passed' };
  const PLACE_TXT = ['', '1st', '2nd', '3rd', '4th'];
  let UID = 0;

  /* ---------- small helpers ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function rotPt(x, y, k) { for (let i = 0; i < k; i++) { const nx = 15 - y; y = x; x = nx; } return [x, y]; }
  function rotK(seat) { return (((3 - (seat | 0)) % 4) + 4) % 4; }
  function T(p) { return 'translate(' + ((p.x - 0.5) * 100).toFixed(2) + '%,' + ((p.y - 0.5) * 100).toFixed(2) + '%) scale(' + (p.s == null ? 1 : p.s).toFixed(3) + ')'; }
  function sfx(name, o) { try { if (window.LudoSfx) window.LudoSfx.play(name, o); } catch (e) { /* never break */ } }
  function initial(name) { const m = String(name || '?').trim().match(/[\p{L}\p{N}]/u); return m ? m[0].toUpperCase() : '?'; }
  function done(a) { return a && a.finished ? a.finished.catch(() => {}) : Promise.resolve(); }
  function activeSeatsOf(st) {
    if (st && Array.isArray(st.active_seats) && st.active_seats.length) return st.active_seats.map((s) => s | 0).filter((s) => s >= 0 && s < 4);
    if (st && Array.isArray(st.players)) { const a = st.players.filter((p) => p && p.active).map((p) => p.seat | 0); if (a.length) return a; }
    return [0, 1, 2, 3];
  }
  function starPath(cx, cy, R, r, n) {
    n = n || 5; let d = '';
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r : R;
      d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(2) + ' ' + (cy + Math.sin(a) * rr).toFixed(2);
    }
    return d + 'Z';
  }
  const lin = (id, x1, y1, x2, y2, stops) => '<linearGradient id="' + id + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">' + stops.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('') + '</linearGradient>';
  const rad = (id, cx, cy, r, stops) => '<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '">' + stops.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('') + '</radialGradient>';

  /* ---------- static art ---------- */
  const SNOW_ARMS = [0, 60, 120, 180, 240, 300].map((a) => '<g transform="rotate(' + a + ')"><path d="M0 -2.5V-20M-6 -14.5L0 -9.5L6 -14.5M-4.2 -21L0 -17L4.2 -21"/></g>').join('');
  const SNOW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-24 -24 48 48"><g stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none">' + SNOW_ARMS + '</g></svg>';
  const SNOW_URI = 'url("data:image/svg+xml,' + encodeURIComponent(SNOW_SVG) + '")';
  const CROWN_SVG = '<svg viewBox="0 0 48 34"><path d="M4 12 L14 20 L24 4 L34 20 L44 12 L40 30 H8 Z" fill="#ffd34d" stroke="#b77900" stroke-width="2.5" stroke-linejoin="round"/><rect x="8" y="27" width="32" height="5" rx="2" fill="#f0a800" stroke="#b77900" stroke-width="2"/><circle cx="24" cy="4.5" r="3" fill="#fff4b0"/><circle cx="4" cy="12" r="2.6" fill="#fff4b0"/><circle cx="44" cy="12" r="2.6" fill="#fff4b0"/></svg>';
  const ICON_SNOW = '<svg viewBox="-24 -24 48 48"><g stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none">' + SNOW_ARMS + '</g></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.2a10 10 0 0 1 13 0M9 15.8a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1.3" fill="#fff"/><path d="M3 3l18 18" stroke="#ff5a6e" stroke-width="3"/></svg>';
  const ICON_BOT = '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="4" fill="#fff"/><circle cx="9.3" cy="13" r="1.9" fill="#1b2340"/><circle cx="14.7" cy="13" r="1.9" fill="#1b2340"/><path d="M12 7V3.6" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="3.2" r="1.7" fill="#fff"/></svg>';
  const FROST_HTML =
    '<svg class="lr-icicles" viewBox="0 0 200 20" preserveAspectRatio="none"><path d="M0 0H200V3L196 3L193 12L190 3L182 3L178 17L174 3L163 3L160 10L157 3L146 3L142 15L138 3L126 3L123 9L120 3L108 3L104 18L100 3L90 3L87 11L84 3L72 3L68 14L64 3L53 3L50 9L47 3L36 3L32 16L28 3L17 3L14 10L11 3L0 3Z" fill="rgba(235,251,255,.92)"/></svg>' +
    '<i class="lr-flake lr-fk1"></i><i class="lr-flake lr-fk2"></i><i class="lr-flake lr-fk3"></i>';

  const PAWN_BASE = 'M15 103 C15 93 31 89 50 89 C69 89 85 93 85 103 C85 113 69 118 50 118 C31 118 15 113 15 103 Z';
  const PAWN_BODY = 'M29 101 C31 86 39 76 41 60 L59 60 C61 76 69 86 71 101 Z';

  function defsSVG(p) {
    let s = '';
    COLORS.forEach((c, i) => {
      s += lin(p + 'pb' + i, 0, 0, 1, 0, [[0, c.deep], [0.2, c.dark], [0.42, c.light], [0.62, c.base], [1, c.deep]]);
      s += rad(p + 'ph' + i, 0.38, 0.3, 0.78, [[0, c.light], [0.45, c.base], [1, c.deep]]);
      s += lin(p + 'pd' + i, 0, 0, 0, 1, [[0, c.base], [1, c.deep]]);
    });
    s += rad(p + 'psh', 0.5, 0.5, 0.5, [[0, '#000', 0.5], [1, '#000', 0]]);
    s += '<g id="' + p + 'psil"><path d="' + PAWN_BASE + '"/><path d="' + PAWN_BODY + '"/><circle cx="50" cy="38" r="21"/></g>';
    s += lin(p + 'cf', 0, 0, 0, 1, [[0, '#a476ff'], [1, '#5326c9']]);
    s += lin(p + 'cl', 0, 0, 0, 1, [[0, '#c9a8ff'], [1, '#7d4cf5']]);
    s += lin(p + 'cg', 0, 0, 0, 1, [[0, '#fff0a8'], [0.5, '#ffc93d'], [1, '#e8930a']]);
    s += rad(p + 'bb', 0.35, 0.3, 0.8, [[0, '#6b7486'], [0.5, '#1c2231'], [1, '#04060c']]);
    return '<defs>' + s + '</defs>';
  }
  function pawnSVG(p, i) {
    const c = COLORS[i];
    return '<svg class="lr-pawn" viewBox="0 0 100 130" aria-hidden="true">' +
      '<ellipse cx="50" cy="116" rx="40" ry="11" fill="url(#' + p + 'psh)"/>' +
      '<use href="#' + p + 'psil" fill="#0a0f1e" stroke="#0a0f1e" stroke-width="13" stroke-linejoin="round" opacity=".5"/>' +
      '<use href="#' + p + 'psil" fill="#fff" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>' +
      '<path d="' + PAWN_BASE + '" fill="url(#' + p + 'pd' + i + ')"/>' +
      '<ellipse cx="50" cy="99" rx="30" ry="8.5" fill="' + c.base + '"/>' +
      '<ellipse cx="47" cy="97.5" rx="22" ry="5" fill="' + c.light + '" opacity=".5"/>' +
      '<path d="' + PAWN_BODY + '" fill="url(#' + p + 'pb' + i + ')"/>' +
      '<ellipse cx="50" cy="60" rx="15" ry="5.5" fill="url(#' + p + 'pb' + i + ')" stroke="rgba(255,255,255,.6)" stroke-width="1.6"/>' +
      '<circle cx="50" cy="38" r="21" fill="url(#' + p + 'ph' + i + ')"/>' +
      '<ellipse cx="42" cy="29" rx="8.5" ry="5.5" transform="rotate(-28 42 29)" fill="#fff" opacity=".88"/>' +
      '<circle cx="59" cy="48" r="2.4" fill="#fff" opacity=".35"/>' +
      '<path d="M44.5 67 C43 77 39 87 36.5 96" stroke="#fff" stroke-opacity=".42" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
      '</svg>';
  }
  function crateSVG(p) {
    return '<svg class="lr-crate-svg" viewBox="0 0 100 100" aria-hidden="true">' +
      '<path d="M19 45 H81 L79 86 Q79 91 74 91 H26 Q21 91 21 86 Z" fill="url(#' + p + 'cf)" stroke="#ffd34d" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M24 50 H76 L75 60 H25 Z" fill="#000" opacity=".16"/>' +
      '<path d="M12 33 Q12 29 16 29 H84 Q88 29 88 33 V44 Q88 48 84 48 H16 Q12 48 12 44 Z" fill="url(#' + p + 'cl)" stroke="#ffd34d" stroke-width="2.4"/>' +
      '<rect x="44" y="29" width="12" height="19" fill="url(#' + p + 'cg)"/>' +
      '<path d="M15 32 H85" stroke="#fff" stroke-opacity=".45" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M50 29 C41 13 26 17 33 28 Z" fill="url(#' + p + 'cg)" stroke="#c98300" stroke-width="1.6"/>' +
      '<path d="M50 29 C59 13 74 17 67 28 Z" fill="url(#' + p + 'cg)" stroke="#c98300" stroke-width="1.6"/>' +
      '<circle cx="50" cy="28" r="5" fill="#ffd24a" stroke="#c98300" stroke-width="1.6"/>' +
      '<path d="M41.5 62 Q41.5 52 50 52 Q58.5 52 58.5 60 Q58.5 65 53 67.5 Q50 69 50 73" fill="none" stroke="#ffe066" stroke-opacity=".55" stroke-width="10" stroke-linecap="round"/>' +
      '<path d="M41.5 62 Q41.5 52 50 52 Q58.5 52 58.5 60 Q58.5 65 53 67.5 Q50 69 50 73" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>' +
      '<circle cx="50" cy="81.5" r="3.9" fill="#fff"/>' +
      '</svg>';
  }
  function bombSVG(p) {
    return '<svg class="lr-bomb-svg" viewBox="0 0 100 100" aria-hidden="true">' +
      '<ellipse cx="47" cy="88" rx="27" ry="6.5" fill="#000" opacity=".35"/>' +
      '<rect x="55" y="23" width="16" height="12" rx="3" transform="rotate(40 63 29)" fill="#4b5563" stroke="#0f172a" stroke-width="2"/>' +
      '<path d="M66 23 Q71 9 83 12" fill="none" stroke="#ecd29e" stroke-width="4.2" stroke-linecap="round"/>' +
      '<circle cx="46" cy="59" r="27" fill="url(#' + p + 'bb)"/>' +
      '<path d="M23 66 Q46 79 69 66" fill="none" style="stroke:var(--bc,#ff3b55)" stroke-width="5" stroke-linecap="round" opacity=".95"/>' +
      '<ellipse cx="36" cy="47" rx="9" ry="6" transform="rotate(-35 36 47)" fill="#fff" opacity=".5"/>' +
      '<circle cx="30" cy="57" r="2.2" fill="#fff" opacity=".3"/>' +
      '<g class="lr-spark"><path d="' + starPath(83, 12, 11, 4.5, 8) + '" fill="#ffcf33"/><path d="' + starPath(83, 12, 6, 2.6, 8) + '" fill="#fff6c9"/></g>' +
      '</svg>';
  }

  /* ---------- the board ---------- */
  function boardSVG(p, k, active) {
    const C = 40;
    const on = (s) => active.indexOf(s) >= 0;
    const rcell = (r, c) => { const q = rotPt(c + 0.5, r + 0.5, k); return [q[1] - 0.5, q[0] - 0.5]; };
    const pt = (x, y) => rotPt(x, y, k).map((v) => +(v * C).toFixed(2));
    let d = '';
    COLORS.forEach((c, i) => {
      d += lin(p + 'a' + i, 0, 0, 1, 1, [[0, c.light], [0.45, c.base], [1, c.dark]]);
      d += lin(p + 't' + i, 0, 0, 0, 1, [[0, c.light], [0.4, c.base], [1, c.dark]]);
    });
    d += lin(p + 'ax', 0, 0, 1, 1, [[0, '#7d8597'], [1, '#424959']]);
    d += lin(p + 'tx', 0, 0, 0, 1, [[0, '#a3abba'], [1, '#6b7385']]);
    d += lin(p + 'tw', 0, 0, 0, 1, [[0, '#ffffff'], [1, '#e3e8f1']]);
    d += lin(p + 'fr', 0, 0, 0, 1, [[0, '#243052'], [1, '#0d1325']]);
    d += lin(p + 'fe', 0, 0, 1, 1, [[0, '#4f7df9'], [0.5, '#7c5bf5', 0.5], [1, '#4f7df9']]);
    d += lin(p + 'pl', 0, 0, 0, 1, [[0, '#d5dceb'], [1, '#bcc5d8']]);
    d += lin(p + 'bv', 0, 0, 1, 1, [[0, '#fff', 0.55], [0.5, '#fff', 0.05], [1, '#000', 0.22]]);
    d += lin(p + 'sl', 0, 0, 0, 1, [[0, '#000', 0.2], [0.55, '#000', 0], [1, '#fff', 0.7]]);
    d += lin(p + 'st', 0, 0, 0, 1, [[0, '#cfd6e6'], [1, '#8792ad']]);
    d += rad(p + 'pn', 0.4, 0.3, 0.95, [[0, '#ffffff'], [1, '#e6eaf3']]);
    d += rad(p + 'gem', 0.38, 0.32, 0.72, [[0, '#ffffff'], [0.42, '#fff2b8'], [1, '#f0a400']]);
    d += rad(p + 'gg', 0.5, 0.5, 0.5, [[0, '#fff6c8', 0.95], [1, '#ffd34d', 0]]);
    d += '<filter id="' + p + 'ds" x="-12%" y="-12%" width="124%" height="124%"><feDropShadow dx="0" dy="3" stdDeviation="3.2" flood-color="#0b1330" flood-opacity=".38"/></filter>';
    d += '<filter id="' + p + 'is" x="-6%" y="-6%" width="112%" height="112%"><feFlood flood-color="#1a2342" flood-opacity=".38" result="f"/><feComposite in="f" in2="SourceAlpha" operator="out" result="inv"/><feOffset in="inv" dx="0" dy="3.5" result="o"/><feGaussianBlur in="o" stdDeviation="3.5" result="b"/><feComposite in="b" in2="SourceAlpha" operator="in" result="sh"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="sh"/></feMerge></filter>';

    let b = '';
    // frame + plate
    b += '<rect x="-16" y="-16" width="632" height="632" rx="28" fill="url(#' + p + 'fr)"/>';
    b += '<rect x="-15.25" y="-15.25" width="630.5" height="630.5" rx="27.25" fill="none" stroke="#fff" stroke-opacity=".13" stroke-width="1.5"/>';
    b += '<rect x="-8.5" y="-8.5" width="617" height="617" rx="20.5" fill="none" stroke="url(#' + p + 'fe)" stroke-width="1.6" opacity=".85"/>';
    b += '<rect x="-3" y="-1" width="606" height="606" rx="17" fill="#03060e" opacity=".6"/>';
    b += '<rect x="0" y="0" width="600" height="600" rx="14" fill="url(#' + p + 'pl)"/>';

    // yards
    for (let s = 0; s < 4; s++) {
      const c = COLORS[s], ok = on(s);
      const a = rcell(YARD0[s][0], YARD0[s][1]), z = rcell(YARD0[s][0] + 5, YARD0[s][1] + 5);
      const x = Math.min(a[1], z[1]) * C, y = Math.min(a[0], z[0]) * C;
      b += '<g filter="url(#' + p + 'ds)"><rect x="' + (x + 3) + '" y="' + (y + 3) + '" width="234" height="234" rx="17" fill="url(#' + p + (ok ? 'a' + s : 'ax') + ')"/></g>';
      b += '<path d="M' + (x + 3) + ' ' + (y + 22) + ' Q' + (x + 3) + ' ' + (y + 3) + ' ' + (x + 22) + ' ' + (y + 3) + ' H' + (x + 170) + ' L' + (x + 3) + ' ' + (y + 170) + ' Z" fill="#fff" opacity=".11"/>';
      b += '<rect x="' + (x + 4.5) + '" y="' + (y + 4.5) + '" width="231" height="231" rx="15.5" fill="none" stroke="url(#' + p + 'bv)" stroke-width="2.6"/>';
      // decorative corner dots
      [[16, 16], [224, 16], [16, 224], [224, 224]].forEach((q) => { b += '<circle cx="' + (x + q[0]) + '" cy="' + (y + q[1]) + '" r="3.2" fill="#fff" opacity=".35"/>'; });
      b += '<rect x="' + (x + 34) + '" y="' + (y + 34) + '" width="172" height="172" rx="30" fill="url(#' + p + 'pn)" filter="url(#' + p + 'is)"/>';
      b += '<rect x="' + (x + 34) + '" y="' + (y + 34) + '" width="172" height="172" rx="30" fill="none" stroke="#0b1330" stroke-opacity=".12" stroke-width="1.5"/>';
      for (let i = 0; i < 4; i++) {
        const q = pt(YARD0[s][1] + SLOT[i][1], YARD0[s][0] + SLOT[i][0]);
        b += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="25" fill="' + (ok ? c.tint : '#dfe3ea') + '" stroke="' + (ok ? c.base : '#9aa2b1') + '" stroke-width="4.2"/>';
        b += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="20.5" fill="none" stroke="url(#' + p + 'sl)" stroke-width="3.5"/>';
      }
    }

    // tiles
    const tile = (r, c, fill, extra) => {
      const q = rcell(r, c), x = q[1] * C, y = q[0] * C;
      return '<rect x="' + (x + 2) + '" y="' + (y + 3.6) + '" width="36" height="36" rx="7" fill="#16204a" opacity=".2"/>' +
        '<rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="36" height="36" rx="7" fill="' + fill + '"/>' +
        (extra ? extra(x, y) : '');
    };
    const dirAngle = (r0, c0, r1, c1) => { const a = rcell(r0, c0), z = rcell(r1, c1); return Math.atan2(z[0] - a[0], z[1] - a[1]) * 180 / Math.PI; };
    const bevel = (x, y) => '<rect x="' + (x + 2.8) + '" y="' + (y + 2.8) + '" width="34.4" height="34.4" rx="6.3" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.2"/>';
    for (let a = 0; a < 52; a++) {
      const rc = TRACK[a];
      const si = STARTS.indexOf(a);
      if (si >= 0) {
        const nx = TRACK[(a + 1) % 52], ang = dirAngle(rc[0], rc[1], nx[0], nx[1]);
        b += tile(rc[0], rc[1], 'url(#' + p + (on(si) ? 't' + si : 'tx') + ')', (x, y) => bevel(x, y) +
          '<path d="M9.5 17 H20.5 V11 L30.5 20 L20.5 29 V23 H9.5 Z" fill="#fff" stroke="rgba(0,0,0,.12)" stroke-width="1" transform="translate(' + x + ' ' + y + ') rotate(' + ang.toFixed(1) + ' 20 20)"/>');
      } else if (STARS.indexOf(a) >= 0) {
        b += tile(rc[0], rc[1], 'url(#' + p + 'tw)', (x, y) => '<path d="' + starPath(x + 20, y + 20.5, 13.5, 5.8) + '" fill="url(#' + p + 'st)" stroke="#6f7b98" stroke-width="1.2" stroke-linejoin="round"/>' +
          '<path d="' + starPath(x + 20, y + 20.5, 6.5, 2.8) + '" fill="#fff" opacity=".55"/>');
      } else {
        b += tile(rc[0], rc[1], 'url(#' + p + 'tw)');
      }
    }
    for (let s = 0; s < 4; s++) {
      const hc = HOME[s];
      for (let i = 0; i < 5; i++) {
        const nx = i < 4 ? hc[i + 1] : [7, 7];
        const ang = dirAngle(hc[i][0], hc[i][1], nx[0], nx[1]);
        b += tile(hc[i][0], hc[i][1], 'url(#' + p + (on(s) ? 't' + s : 'tx') + ')', (x, y) => bevel(x, y) +
          '<path d="M14.5 13 L22 20 L14.5 27" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" transform="translate(' + x + ' ' + y + ') rotate(' + ang.toFixed(1) + ' 20 20)"/>');
      }
      // entry arrow on the last track square before the home column
      const ent = TRACK[(s * 13 + 50) % 52], ang = dirAngle(ent[0], ent[1], hc[0][0], hc[0][1]);
      const q = rcell(ent[0], ent[1]);
      b += '<path d="M11 17.5 H21 V12.5 L29.5 20 L21 27.5 V22.5 H11 Z" fill="' + (on(s) ? COLORS[s].base : '#9aa2b1') + '" opacity=".9" transform="translate(' + q[1] * C + ' ' + q[0] * C + ') rotate(' + ang.toFixed(1) + ' 20 20)"/>';
    }

    // centre
    const TRI = [[[6, 6], [6, 9], [7.5, 7.5]], [[6, 6], [9, 6], [7.5, 7.5]], [[9, 6], [9, 9], [7.5, 7.5]], [[6, 9], [9, 9], [7.5, 7.5]]];
    b += '<g filter="url(#' + p + 'ds)"><rect x="241" y="241" width="118" height="118" rx="6" fill="#fff"/></g>';
    TRI.forEach((tri, s) => {
      const P = tri.map((q) => pt(q[0], q[1]));
      b += '<path d="M' + P[0] + 'L' + P[1] + 'L' + P[2] + 'Z" fill="url(#' + p + (on(s) ? 'a' + s : 'ax') + ')"/>';
      const cx = (P[0][0] + P[1][0] + P[2][0]) / 3, cy = (P[0][1] + P[1][1] + P[2][1]) / 3;
      const Q = P.map((q) => [cx + (q[0] - cx) * 0.62, cy + (q[1] - cy) * 0.62]);
      b += '<path d="M' + Q[0] + 'L' + Q[1] + 'L' + Q[2] + 'Z" fill="#fff" opacity=".13"/>';
    });
    b += '<path d="M241 241 L359 359 M359 241 L241 359" stroke="#fff" stroke-opacity=".85" stroke-width="2.6"/>';
    b += '<rect x="241" y="241" width="118" height="118" rx="6" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2"/>';
    b += '<circle cx="300" cy="300" r="30" fill="url(#' + p + 'gg)"/>';
    b += '<circle cx="300" cy="300" r="15.5" fill="url(#' + p + 'gem)" stroke="#fff" stroke-width="3"/>';
    b += '<path d="' + starPath(300, 300.5, 9, 3.6, 4) + '" fill="#fff" opacity=".9"/>';

    return '<svg class="lr-board-svg" viewBox="-16 -16 632 632" aria-hidden="true"><defs>' + d + '</defs>' + b + '</svg>';
  }

  /* ======================================================================
     Renderer
     ====================================================================== */
  class LudoRenderer {
    constructor(container, opts) {
      if (!container) throw new Error('LudoRenderer: container element required');
      opts = opts || {};
      this.host = container;
      this.opts = Object.assign({ viewSeat: 0, reducedMotion: false, sound: true, timeScale: 1 }, opts);
      this.uid = 'lr' + (++UID) + '_';
      this.viewSeat = ((this.opts.viewSeat | 0) % 4 + 4) % 4;
      this.k = rotK(this.viewSeat);
      this._mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this._rmOpt = !!this.opts.reducedMotion;
      this._listeners = Object.create(null);
      this._queue = Promise.resolve();
      this._pending = 0;
      this._busy = false;
      this._scale = 1;
      this.state = null;
      this.ws = null;
      this._active = [0, 1, 2, 3];
      this._sel = [];
      this._tgt = null;
      this._dice = { seat: null, values: [], phase: 'roll', enabled: false, rolling: false, boost: 0, double: false, chosen: null };
      this._timer = null;
      this._raf = 0;
      this._boardKey = '';
      this._crates = new Map();
      this._bombs = new Map();
      this._moving = new Set();
      this._lastCelebrate = { seat: -1, at: 0 };
      this._destroyed = false;
      this._build();
      this._layout();
      this._onResize = () => this._layout();
      if (window.ResizeObserver) { this._ro = new ResizeObserver(() => this._layout()); this._ro.observe(this.host); }
      window.addEventListener('resize', this._onResize);
      if (this._mq) {
        this._onMq = () => this._applyRm();
        if (this._mq.addEventListener) this._mq.addEventListener('change', this._onMq); else if (this._mq.addListener) this._mq.addListener(this._onMq);
      }
      this._applyRm();
    }

    /* ---------------- public API ---------------- */
    setState(state) {
      if (this._destroyed || !state || !Array.isArray(state.tokens)) return;
      this.state = clone(state);
      this.ws = clone(state);
      this._normalize(this.ws);
      this._syncAll();
    }
    playEvents(events, finalState) {
      this._pending++;
      const job = this._queue.then(() => this._runJob(events, finalState));
      this._queue = job.catch(() => {});
      return job;
    }
    setViewSeat(seat) {
      const s = ((seat | 0) % 4 + 4) % 4;
      if (s === this.viewSeat && this._boardKey) return;
      this.viewSeat = s; this.k = rotK(s);
      this._placePods();
      if (this.ws) this._syncAll(); else this._ensureBoard();
      if (!this.rm && this.boardEl.animate) this.boardEl.animate([{ opacity: 0.4, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
    }
    setSelectable(list) {
      this._sel = Array.isArray(list) ? list.filter((o) => o && isNum(+o.seat) && isNum(+o.token)).map((o) => ({ seat: o.seat | 0, token: o.token | 0 })) : [];
      this._applyInteractive();
    }
    setTargeting(spec) {
      this._tgt = spec && spec.kind ? { kind: String(spec.kind), valid: Array.isArray(spec.valid) ? spec.valid.slice() : [] } : null;
      this._applyInteractive();
    }
    setDice(spec) {
      spec = spec || {};
      const d = this._dice;
      const prevRolling = d.rolling;
      if (spec.seat != null) d.seat = spec.seat | 0;
      if (Array.isArray(spec.values)) d.values = spec.values.map((v) => v | 0).filter((v) => v >= 1 && v <= 6).slice(0, 2);
      if (spec.phase) d.phase = String(spec.phase);
      d.enabled = !!spec.enabled;
      d.rolling = !!spec.rolling;
      if (spec.boost != null) d.boost = +spec.boost || 0;
      if (spec.double != null) d.double = !!spec.double;
      if (d.phase !== 'move') d.chosen = null;
      this._renderDice({ land: prevRolling && !d.rolling });
    }
    setTimer(seat, deadlineMs, totalMs) {
      if (seat == null || deadlineMs == null || !isNum(+deadlineMs)) {
        this._timer = null;
        this.pods.forEach((p) => p.classList.remove('lr-timing', 'lr-urgent'));
        return;
      }
      this._timer = { seat: seat | 0, deadline: +deadlineMs, total: Math.max(1000, +totalMs || 20000), lastSec: null };
      this.pods.forEach((p, i) => { p.classList.toggle('lr-timing', i === (seat | 0)); p.classList.remove('lr-urgent'); });
      if (!this._raf) this._raf = requestAnimationFrame(() => this._tickTimer());
    }
    showEmote(seat, emote) {
      const pod = this.pods[seat | 0];
      if (!pod || !emote) return;
      const anchor = pod._p.emote;
      const b = h('div', 'lr-emote');
      b.textContent = String(emote).slice(0, 8);
      anchor.innerHTML = '';
      anchor.appendChild(b);
      if (this.opts.sound) sfx('emote');
      const life = 2400;
      if (this.rm) { setTimeout(() => b.remove(), life); return; }
      b.animate([{ transform: 'scale(.2) translateY(30%)', opacity: 0 }, { transform: 'scale(1.18)', opacity: 1, offset: 0.12 }, { transform: 'scale(1)', opacity: 1, offset: 0.2 }, { transform: 'scale(1) translateY(-8%)', opacity: 1, offset: 0.85 }, { transform: 'scale(.9) translateY(-30%)', opacity: 0 }], { duration: life, easing: 'ease-out', fill: 'forwards' }).finished.then(() => b.remove(), () => b.remove());
      pod._p.avw.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12) rotate(-6deg)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
    }
    flash(text, kind, opts) {
      opts = opts || {};
      if (this._destroyed || !text) return Promise.resolve();
      kind = kind === 'good' || kind === 'bad' ? kind : 'info';
      const wrap = this.flashEl;
      if (this._flashNode) { const old = this._flashNode; old.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.9)' }], { duration: 120, fill: 'forwards' }).finished.then(() => old.remove(), () => old.remove()); }
      const n = h('div', 'lr-flash-n lr-flash-' + kind);
      if (isNum(opts.y)) n.style.top = (clamp(opts.y, 0.1, 0.9) * 100) + '%';
      n.innerHTML = '<div class="lr-flash-in">' + (opts.icon ? '<img alt="" src="' + esc(opts.icon) + '">' : '') + '<span>' + esc(text) + '</span></div>';
      wrap.appendChild(n);
      this._flashNode = n;
      const hold = opts.hold || 900;
      const dur = this.rm ? hold + 200 : Math.max(500, (hold + 450) * (this.opts.timeScale || 1));
      const a = n.animate(this.rm
        ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
        : [{ transform: 'scale(.35) rotate(-4deg)', opacity: 0 }, { transform: 'scale(1.14) rotate(1deg)', opacity: 1, offset: 0.14 }, { transform: 'scale(1) rotate(0)', opacity: 1, offset: 0.24 }, { transform: 'scale(1)', opacity: 1, offset: 0.8 }, { transform: 'translateY(' + (-(this.L ? this.L.S : 400) * 0.05).toFixed(0) + 'px) scale(1.05)', opacity: 0 }],
        { duration: dur, easing: 'ease-out', fill: 'forwards' });
      return done(a).then(() => { n.remove(); if (this._flashNode === n) this._flashNode = null; });
    }
    celebrate(seat) {
      if (this._destroyed) return;
      seat = seat == null ? -1 : seat | 0;
      const now = Date.now();
      if (this._lastCelebrate.seat === seat && now - this._lastCelebrate.at < 4000) return;
      this._lastCelebrate = { seat: seat, at: now };
      if (seat >= 0 && this.pods[seat]) {
        this.pods[seat].classList.add('lr-winner');
        this.flash(this._name(seat) + ' wins!', 'good', { hold: 1800 });
      }
      if (this.opts.sound) {
        const playing = this._active.indexOf(this.viewSeat) >= 0;
        sfx(seat === this.viewSeat || !playing ? 'win' : 'lose');
      }
      this._confetti(seat);
    }
    on(evt, fn) {
      if (typeof fn !== 'function') return () => {};
      (this._listeners[evt] || (this._listeners[evt] = [])).push(fn);
      return () => this.off(evt, fn);
    }
    off(evt, fn) {
      const l = this._listeners[evt];
      if (!l) return;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    }
    resize() { this._layout(); }
    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      if (this._ro) this._ro.disconnect();
      window.removeEventListener('resize', this._onResize);
      if (this._mq && this._onMq) { if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._onMq); else if (this._mq.removeListener) this._mq.removeListener(this._onMq); }
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this._confRaf) cancelAnimationFrame(this._confRaf);
      this._listeners = Object.create(null);
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
      this.root = null;
    }
    getState() { return clone(this.ws); }
    isBusy() { return this._busy; }
    setReducedMotion(v) { this._rmOpt = !!v; this._applyRm(); }
    setSound(v) { this.opts.sound = !!v; }
    get rm() { return this._rmOpt || !!(this._mq && this._mq.matches); }

    /* ---------------- construction ---------------- */
    _build() {
      const p = this.uid;
      const root = this.root = h('div', 'lr-root');
      root.innerHTML =
        '<svg class="lr-defs" width="0" height="0" aria-hidden="true" focusable="false">' + defsSVG(p) + '</svg>' +
        '<div class="lr-stage">' +
        '<div class="lr-board"><div class="lr-board-art"></div>' +
        '<div class="lr-grid"><div class="lr-l-glow"></div><div class="lr-l-items"></div><div class="lr-dim"></div><div class="lr-l-tokens"></div><div class="lr-l-targets"></div></div>' +
        '</div>' +
        '<div class="lr-pods"></div><div class="lr-fx"></div><div class="lr-flash"></div><canvas class="lr-confetti"></canvas>' +
        '</div>';
      root.style.setProperty('--lr-snow', SNOW_URI);
      this.host.appendChild(root);
      const q = (s) => root.querySelector(s);
      this.stage = q('.lr-stage'); this.boardEl = q('.lr-board'); this.artEl = q('.lr-board-art');
      this.gridEl = q('.lr-grid'); this.glowL = q('.lr-l-glow'); this.itemsL = q('.lr-l-items'); this.dimEl = q('.lr-dim');
      this.tokL = q('.lr-l-tokens'); this.tgtL = q('.lr-l-targets'); this.podsL = q('.lr-pods'); this.fxL = q('.lr-fx');
      this.flashEl = q('.lr-flash'); this.confCv = q('.lr-confetti');

      // yard glows (one per seat)
      this.yglow = [0, 1, 2, 3].map((s) => { const g = h('div', 'lr-yglow'); g.style.setProperty('--pc', COLORS[s].base); g.style.setProperty('--pglow', COLORS[s].glow); this.glowL.appendChild(g); return g; });

      // tokens
      this.tok = [];
      for (let s = 0; s < 4; s++) {
        this.tok[s] = [];
        for (let i = 0; i < 4; i++) {
          const el = h('div', 'lr-tok', '<div class="lr-tok-in"><div class="lr-tok-ring"></div>' + pawnSVG(p, s) + '<div class="lr-tok-shield"></div></div>');
          el.dataset.seat = s; el.dataset.token = i;
          el.style.setProperty('--tc', COLORS[s].base);
          el.style.setProperty('--tglow', COLORS[s].glow);
          el._pos = null;
          el.addEventListener('click', (ev) => { ev.stopPropagation(); this._onTokenClick(s, i); });
          this.tokL.appendChild(el);
          this.tok[s][i] = el;
        }
      }

      // pods
      this.pods = [];
      for (let s = 0; s < 4; s++) {
        const c = COLORS[s];
        const pod = h('div', 'lr-pod lr-off');
        pod.dataset.seat = s;
        pod.style.setProperty('--pc', c.base); pod.style.setProperty('--pcl', c.light); pod.style.setProperty('--pcd', c.dark); pod.style.setProperty('--pglow', c.glow);
        pod.innerHTML =
          '<div class="lr-pod-card"><div class="lr-pod-main">' +
          '<div class="lr-av-wrap"><svg class="lr-timer" viewBox="0 0 100 100"><circle class="lr-timer-bg" cx="50" cy="50" r="46" pathLength="100"/><circle class="lr-timer-fg" cx="50" cy="50" r="46" pathLength="100"/></svg>' +
          '<div class="lr-av"></div><div class="lr-crown">' + CROWN_SVG + '</div><div class="lr-lvl"></div><div class="lr-badges"></div></div>' +
          '<div class="lr-pod-info"><div class="lr-name-row"><span class="lr-name"></span><span class="lr-tags"></span></div><div class="lr-row"><span class="lr-dots"></span><span class="lr-inv"></span></div></div>' +
          '</div><div class="lr-dice-slot"></div><div class="lr-frost">' + FROST_HTML + '</div></div>' +
          '<div class="lr-toast-a"></div><div class="lr-emote-a"></div>';
        const g = (sel) => pod.querySelector(sel);
        pod._p = { card: g('.lr-pod-card'), avw: g('.lr-av-wrap'), av: g('.lr-av'), lvl: g('.lr-lvl'), badges: g('.lr-badges'), name: g('.lr-name'), tags: g('.lr-tags'), dots: g('.lr-dots'), inv: g('.lr-inv'), slot: g('.lr-dice-slot'), frost: g('.lr-frost'), ring: g('.lr-timer-fg'), toast: g('.lr-toast-a'), emote: g('.lr-emote-a'), sig: {} };
        pod.addEventListener('click', () => this._onPodClick(s));
        this.podsL.appendChild(pod);
        this.pods.push(pod);
      }

      // dice
      this.diceEl = h('div', 'lr-dice', '<div class="lr-dice-row"></div><div class="lr-boost-chip"><img alt="" src="' + POWERUP_META.boost.icon_url + '"><b>+3</b></div>');
      this.diceRow = this.diceEl.firstChild;
      this.dies = [];
      this.diceEl.addEventListener('click', (ev) => { ev.stopPropagation(); this._onDiceClick(null); });

      // targets layer click delegation
      this.tgtL.addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-abs],[data-tseat]');
        if (!t || this._busy) return;
        ev.stopPropagation();
        if (t.dataset.abs != null) this._emit('square', { abs: +t.dataset.abs });
        else this._emit('seat', { seat: +t.dataset.tseat });
      });
      this._placePods();
      this._ensureBoard();
      // preload power-up icons
      Object.keys(POWERUP_META).forEach((id) => { const im = new Image(); im.src = POWERUP_META[id].icon_url; });
    }

    _applyRm() { if (this.root) this.root.classList.toggle('lr-rm', this.rm); }

    /* ---------------- layout ---------------- */
    _layout() {
      if (this._destroyed || !this.root) return;
      const host = this.host, root = this.root;
      const prevH = root.style.height;
      root.style.height = '0px';
      const W = host.clientWidth;
      let H = host.clientHeight;
      root.style.height = prevH;
      if (W < 40) return;
      const autoH = H < 80;
      if (autoH) H = Math.max(300, Math.min((window.innerHeight || 800) - 12, W * 1.42));
      const g = 0.018;
      let Sp = Math.min(W, H / (1 + 2 * (0.13 + g)));
      let ph = Math.max(46, Sp * 0.13);
      if (Sp + 2 * (ph + g * Sp) > H) Sp = Math.max(140, (H - 2 * ph) / (1 + 2 * g));
      let Sl = Math.min(H, W / (1 + 2 * (0.3 + g)));
      let pw = Math.max(136, Sl * 0.3);
      if (Sl + 2 * (pw + g * Sl) > W) Sl = Math.max(140, (W - 2 * pw) / (1 + 2 * g));
      const land = Sl > Sp * 1.06;
      const S = Math.floor(land ? Sl : Sp);
      let stageW, stageH, bx, by, podW, podH;
      if (land) {
        pw = Math.max(136, S * 0.3); podW = pw; podH = Math.min(S * 0.4, pw * 0.86);
        stageW = S + 2 * (pw + g * S); stageH = S; bx = pw + g * S; by = 0;
      } else {
        ph = Math.max(46, S * 0.13); podH = ph; podW = S * 0.49;
        stageW = S; stageH = S + 2 * (ph + g * S); bx = 0; by = ph + g * S;
      }
      stageW = Math.round(stageW); stageH = Math.round(stageH);
      root.style.height = autoH ? stageH + 'px' : '';
      const ox = Math.max(0, Math.round((W - stageW) / 2)), oy = autoH ? 0 : Math.max(0, Math.round((H - stageH) / 2));
      const st = this.stage.style;
      st.left = ox + 'px'; st.top = oy + 'px'; st.width = stageW + 'px'; st.height = stageH + 'px';
      const bs = this.boardEl.style;
      bs.left = Math.round(bx) + 'px'; bs.top = Math.round(by) + 'px'; bs.width = S + 'px'; bs.height = S + 'px';
      const fs = this.flashEl.style;
      fs.left = bs.left; fs.top = bs.top; fs.width = bs.width; fs.height = bs.height;
      root.classList.toggle('lr-land', land);
      root.classList.toggle('lr-port', !land);
      root.style.setProperty('--S', S + 'px');
      root.style.setProperty('--ph', podH.toFixed(1) + 'px');
      root.style.setProperty('--pw', podW.toFixed(1) + 'px');
      const av = land ? Math.min(podW * 0.29, podH * 0.36) : podH * 0.78;
      const ds = land ? Math.min(podW * 0.2, podH * 0.25) : podH * 0.56;
      root.style.setProperty('--av', av.toFixed(1) + 'px');
      root.style.setProperty('--ds', ds.toFixed(1) + 'px');
      root.style.setProperty('--ds2', (ds * 0.84).toFixed(1) + 'px');
      root.style.setProperty('--fs', clamp(land ? podW * 0.085 : podH * 0.25, 11, 17).toFixed(1) + 'px');
      this.L = { S: S, land: land, stageW: stageW, stageH: stageH, bx: Math.round(bx), by: Math.round(by), podW: podW, podH: podH,
        gx: Math.round(bx) + S * 16 / 632, gy: Math.round(by) + S * 16 / 632, cell: S * 600 / 632 / 15 };
      this._podBox = { podW: podW, podH: podH, stageW: stageW, stageH: stageH, S: S, land: land };
      this._placePods();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.confCv.width = Math.round(stageW * dpr); this.confCv.height = Math.round(stageH * dpr);
      this._dpr = dpr;
    }
    _placePods() {
      const B = this._podBox;
      for (let s = 0; s < 4; s++) {
        const pod = this.pods[s];
        const ci = (s + this.k) % 4, corner = CORNERS[ci];
        pod.dataset.corner = corner;
        pod.classList.toggle('lr-right', corner === 'tr' || corner === 'br');
        pod.classList.toggle('lr-bottom', corner === 'br' || corner === 'bl');
        if (!B) continue;
        const right = corner === 'tr' || corner === 'br', bottom = corner === 'br' || corner === 'bl';
        const W = B.land ? B.stageW : B.S;
        const ps = pod.style;
        ps.width = Math.round(B.podW) + 'px'; ps.height = Math.round(B.podH) + 'px';
        ps.left = Math.round(right ? W - B.podW : 0) + 'px';
        ps.top = Math.round(bottom ? (B.land ? B.S : B.stageH) - B.podH : 0) + 'px';
      }
    }

    /* ---------------- board + sync ---------------- */
    _ensureBoard() {
      const key = this.k + '|' + this._active.join(',');
      if (key === this._boardKey) return;
      this._boardKey = key;
      this.artEl.innerHTML = boardSVG(this.uid, this.k, this._active);
      for (let s = 0; s < 4; s++) {
        const a = rotPt(YARD0[s][1], YARD0[s][0], this.k), z = rotPt(YARD0[s][1] + 6, YARD0[s][0] + 6, this.k);
        const x = Math.min(a[0], z[0]), y = Math.min(a[1], z[1]);
        const g = this.yglow[s].style;
        g.left = (x / 15 * 100) + '%'; g.top = (y / 15 * 100) + '%'; g.width = '40%'; g.height = '40%';
        this.yglow[s].classList.toggle('lr-off', this._active.indexOf(s) < 0);
      }
    }
    _normalize(st) {
      if (!st.turn) st.turn = {};
      if (!Array.isArray(st.players)) st.players = [];
      for (let s = 0; s < 4; s++) {
        if (!st.players[s]) st.players[s] = { seat: s, active: false, inventory: [] };
        if (!Array.isArray(st.players[s].inventory)) st.players[s].inventory = [];
        if (!Array.isArray(st.tokens[s])) st.tokens[s] = [-1, -1, -1, -1];
      }
      if (!Array.isArray(st.crates)) st.crates = [];
      if (!Array.isArray(st.bombs)) st.bombs = [];
      if (!Array.isArray(st.shields)) st.shields = [];
    }
    _syncAll() {
      const st = this.ws;
      this._active = activeSeatsOf(st);
      this._ensureBoard();
      this._moving.clear();
      this._relayout(false);
      this._syncItems();
      this._syncShields();
      for (let s = 0; s < 4; s++) this._renderPod(s);
      this._syncDiceFromState();
      this._applyInteractive();
      this._syncYardGlow();
      if (!(st.status === 'finished' && st.winner != null)) this.pods.forEach((p) => p.classList.remove('lr-winner'));
    }
    _name(s) {
      const st = this.ws || this.state;
      const i = st && st.seats && st.seats[s];
      return (i && i.name) || COLORS[s].name;
    }
    _effTok(st, s, i) {
      const p = st.tokens[s] && st.tokens[s][i];
      if (st.players[s] && st.players[s].resigned) return -1;
      return isNum(p) ? p : -1;
    }
    _basePos(s, i, p) {
      if (!isNum(p) || p < 0) return [YARD0[s][1] + SLOT[i][1], YARD0[s][0] + SLOT[i][0]];
      if (p <= 50) { const rc = TRACK[(s * 13 + p) % 52]; return [rc[1] + 0.5, rc[0] + 0.5]; }
      if (p <= 55) { const rc = HOME[s][p - 51]; return [rc[1] + 0.5, rc[0] + 0.5]; }
      return FIN_C[s].slice();
    }
    _cellOf(s, i, p) { const q = this._basePos(s, i, p); return rotPt(q[0], q[1], this.k); }
    _absCell(abs) { const rc = TRACK[((abs % 52) + 52) % 52]; return rotPt(rc[1] + 0.5, rc[0] + 0.5, this.k); }
    _key(s, i, p) { if (p < 0) return 'y' + s + i; if (p <= 50) return 't' + ((s * 13 + p) % 52); if (p <= 55) return 'h' + s + '_' + p; return 'f' + s; }
    _layoutMap(st) {
      const groups = new Map();
      for (const s of this._active) {
        for (let i = 0; i < 4; i++) {
          const el = this.tok[s][i];
          if (this._moving.has(el)) continue;
          const p = this._effTok(st, s, i);
          const k = this._key(s, i, p);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push({ s: s, i: i, p: p });
        }
      }
      const out = new Map();
      groups.forEach((m, key) => {
        m.sort((a, b) => a.s - b.s || a.i - b.i);
        const n = m.length;
        if (key[0] === 'f') {
          const s = m[0].s, al = ALONG[s], ac = [-al[1], al[0]], c = FIN_C[s];
          const offs = n === 1 ? [[0, 0]] : n === 2 ? [[-0.05, -0.32], [-0.05, 0.32]] : n === 3 ? [[-0.1, -0.52], [-0.1, 0], [-0.1, 0.52]] : [[-0.16, -0.69], [-0.16, -0.23], [-0.16, 0.23], [-0.16, 0.69]];
          const sc = [0.8, 0.64, 0.56, 0.5][Math.min(n, 4) - 1];
          m.forEach((t, j) => {
            const o = offs[Math.min(j, offs.length - 1)];
            const q = rotPt(c[0] + al[0] * o[0] + ac[0] * o[1], c[1] + al[1] * o[0] + ac[1] * o[1], this.k);
            out.set(t.s + '-' + t.i, { x: q[0], y: q[1], s: sc, z: 100 + Math.round(q[1] * 20) + j });
          });
          return;
        }
        const q = this._cellOf(m[0].s, m[0].i, m[0].p);
        let sc = 1, offs = [[0, 0]];
        if (key[0] === 'y') sc = 1.02;
        else if (n === 2) { sc = 0.8; offs = [[-0.25, 0.05], [0.25, -0.05]]; }
        else if (n === 3) { sc = 0.7; offs = [[-0.27, 0.17], [0.27, 0.17], [0, -0.2]]; }
        else if (n === 4) { sc = 0.64; offs = [[-0.26, -0.19], [0.26, -0.19], [-0.26, 0.23], [0.26, 0.23]]; }
        else if (n > 4) {
          const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), sp = 0.86 / cols;
          sc = 1.15 / cols; offs = [];
          for (let j = 0; j < n; j++) offs.push([((j % cols) - (cols - 1) / 2) * sp, (Math.floor(j / cols) - (rows - 1) / 2) * sp + 0.04]);
        }
        m.forEach((t, j) => {
          const o = offs[Math.min(j, offs.length - 1)];
          const y = q[1] + o[1];
          out.set(t.s + '-' + t.i, { x: q[0] + o[0], y: y, s: sc, z: 100 + Math.round(y * 20) + j });
        });
      });
      return out;
    }
    _relayout(animated) {
      const st = this.ws;
      if (!st) return;
      const lay = this._layoutMap(st);
      const anim = !!animated && !this.rm;
      for (let s = 0; s < 4; s++) {
        const on = this._active.indexOf(s) >= 0;
        const pl = st.players[s] || {};
        for (let i = 0; i < 4; i++) {
          const el = this.tok[s][i];
          el.classList.toggle('lr-off', !on);
          el.classList.toggle('lr-resigned', !!pl.resigned);
          el.classList.toggle('lr-iced', !!pl.frozen);
          if (!on || this._moving.has(el)) continue;
          const L = lay.get(s + '-' + i);
          if (!L) continue;
          el.classList.toggle('lr-anim', anim && !!el._pos);
          el.style.transform = T(L);
          el._z = L.z;
          el._pos = { x: L.x, y: L.y, s: L.s };
          this._applyZ(el);
          const p = this._effTok(st, s, i);
          el.classList.toggle('lr-home', p === 56);
        }
      }
    }
    _applyZ(el) { el.style.zIndex = String((el._z || 100) + (el.classList.contains('lr-click') ? 2000 : 0) + (this._moving.has(el) ? 5000 : 0)); }
    _makeItem(kind, abs, seat) {
      const el = h('div', 'lr-item lr-' + kind, kind === 'crate'
        ? '<div class="lr-item-in"><div class="lr-crate-sh"></div><div class="lr-crate-glow"></div><div class="lr-crate-bob">' + crateSVG(this.uid) + '</div></div>'
        : '<div class="lr-item-in"><div class="lr-bomb-ring"></div>' + bombSVG(this.uid) + '</div>');
      if (kind === 'bomb') { el.style.setProperty('--bc', COLORS[seat | 0] ? COLORS[seat | 0].base : '#ff3b55'); el.dataset.seat = seat; }
      el.dataset.abs = abs;
      const q = this._absCell(abs);
      el.style.transform = T({ x: q[0], y: q[1], s: 1 });
      el.style.zIndex = String(10 + Math.round(q[1] * 2));
      this.itemsL.appendChild(el);
      return el;
    }
    _syncItems() {
      const st = this.ws;
      const want = new Set((st.crates || []).filter(isNum).map((a) => ((a % 52) + 52) % 52));
      this._crates.forEach((el, a) => { if (!want.has(a)) { el.remove(); this._crates.delete(a); } });
      want.forEach((a) => {
        if (!this._crates.has(a)) this._crates.set(a, this._makeItem('crate', a));
        else { const q = this._absCell(a); this._crates.get(a).style.transform = T({ x: q[0], y: q[1], s: 1 }); }
      });
      const bw = new Map();
      (st.bombs || []).forEach((b) => { if (b && isNum(b.abs)) bw.set(((b.abs % 52) + 52) % 52, b.seat | 0); });
      this._bombs.forEach((el, a) => { if (!bw.has(a) || +el.dataset.seat !== bw.get(a)) { el.remove(); this._bombs.delete(a); } });
      bw.forEach((seat, a) => {
        if (!this._bombs.has(a)) this._bombs.set(a, this._makeItem('bomb', a, seat));
        else { const q = this._absCell(a); this._bombs.get(a).style.transform = T({ x: q[0], y: q[1], s: 1 }); }
      });
    }
    _syncShields() {
      const st = this.ws;
      const m = new Map();
      (st.shields || []).forEach((sh) => { if (sh) m.set((sh.seat | 0) + '-' + (sh.token | 0), sh.rounds_left == null ? 2 : sh.rounds_left); });
      for (let s = 0; s < 4; s++) for (let i = 0; i < 4; i++) {
        const el = this.tok[s][i], r = m.get(s + '-' + i);
        el.classList.toggle('lr-shielded', r != null);
        el.classList.toggle('lr-shield-low', r != null && r <= 1);
      }
    }
    _syncYardGlow() {
      const st = this.ws;
      const cur = st && (!st.status || st.status === 'playing') && st.turn ? st.turn.seat : null;
      this.yglow.forEach((g, s) => g.classList.toggle('lr-on', s === cur));
    }

    /* ---------------- pods ---------------- */
    _renderPod(s) {
      const st = this.ws, pod = this.pods[s], P = pod._p, sig = P.sig;
      const on = this._active.indexOf(s) >= 0;
      pod.classList.toggle('lr-off', !on);
      if (!on) return;
      const info = (st.seats && st.seats[s]) || {};
      const pl = st.players[s] || {};
      const name = info.name || COLORS[s].name;
      const avKey = (info.avatar_url || '') + '|' + name;
      if (sig.av !== avKey) {
        sig.av = avKey;
        P.av.innerHTML = '';
        P.av.textContent = initial(name);
        if (info.avatar_url) {
          const img = new Image();
          img.alt = ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
          img.onload = () => { P.av.textContent = ''; P.av.appendChild(img); };
          img.src = info.avatar_url;
        }
      }
      if (sig.name !== name) { sig.name = name; P.name.textContent = name; pod.title = name; }
      const tags = pl.resigned ? '<span class="lr-tag lr-tag-res">RESIGNED</span>' :
        (info.kind === 'bot' ? '<span class="lr-tag lr-tag-bot">' + ICON_BOT + 'BOT</span>' : '') +
        (info.kind === 'guest' ? '<span class="lr-tag">GUEST</span>' : '');
      if (sig.tags !== tags) { sig.tags = tags; P.tags.innerHTML = tags; }
      const lvl = info.level != null && info.level !== '' ? String(info.level) : '';
      if (sig.lvl !== lvl) { sig.lvl = lvl; P.lvl.textContent = lvl ? lvl : ''; P.lvl.style.display = lvl ? '' : 'none'; P.lvl.title = lvl ? 'Level ' + lvl : ''; }
      const badges = (pl.frozen ? '<span class="lr-badge lr-b-frozen" title="Frozen">' + ICON_SNOW + '</span>' : '') +
        (info.autopilot ? '<span class="lr-badge lr-b-afk" title="Autopilot">AFK</span>' : '') +
        (info.connected === false ? '<span class="lr-badge lr-b-off" title="Disconnected">' + ICON_OFF + '</span>' : '');
      if (sig.badges !== badges) { sig.badges = badges; P.badges.innerHTML = badges; }
      const toks = st.tokens[s] || [];
      const fin = isNum(pl.finished_tokens) ? pl.finished_tokens : toks.filter((t) => t === 56).length;
      const place = isNum(pl.placement) ? pl.placement : null;
      const dots = place ? '<b class="lr-place lr-place-' + place + '">' + (PLACE_TXT[place] || place) + '</b>' : [0, 1, 2, 3].map((j) => '<i class="' + (j < fin ? 'on' : '') + '"></i>').join('');
      if (sig.dots !== dots) { sig.dots = dots; P.dots.innerHTML = dots; }
      const inv = (pl.inventory || []).filter((id) => POWERUP_META[id]);
      const invKey = inv.join(',');
      if (sig.inv !== invKey) {
        const prev = sig.inv ? sig.inv.split(',') : [];
        sig.inv = invKey;
        P.inv.innerHTML = inv.slice(0, 3).map((id, j) => '<img alt="' + esc(POWERUP_META[id].name) + '" title="' + esc(POWERUP_META[id].name) + '" data-p="' + id + '" class="' + (j >= prev.length || prev[j] !== id ? 'lr-new' : '') + '" src="' + POWERUP_META[id].icon_url + '">').join('') + (inv.length > 3 ? '<em>+' + (inv.length - 3) + '</em>' : '');
        if (!this.rm) P.inv.querySelectorAll('img.lr-new').forEach((im) => im.animate([{ transform: 'scale(0) rotate(-30deg)' }, { transform: 'scale(1.35) rotate(8deg)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: this._t(420), easing: 'ease-out' }));
      }
      const playing = !st.status || st.status === 'playing';
      pod.classList.toggle('lr-active', playing && !!st.turn && st.turn.seat === s);
      pod.classList.toggle('lr-frozen', !!pl.frozen);
      pod.classList.toggle('lr-resigned', !!pl.resigned);
      pod.classList.toggle('lr-winner', st.status === 'finished' && st.winner === s);
      pod.classList.toggle('lr-has-inv', inv.length > 0);
    }
    _podToast(s, text, kind) {
      const pod = this.pods[s];
      if (!pod || !text || this._noFx()) return;
      const t = h('div', 'lr-toast' + (kind ? ' lr-toast-' + kind : ''));
      t.textContent = text;
      pod._p.toast.innerHTML = '';
      pod._p.toast.appendChild(t);
      const dur = this.rm ? 1200 : this._t(1500);
      t.animate([{ transform: 'translateY(40%) scale(.6)', opacity: 0 }, { transform: 'translateY(0) scale(1.06)', opacity: 1, offset: 0.12 }, { transform: 'scale(1)', opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.82 }, { transform: 'translateY(-30%)', opacity: 0 }], { duration: dur, easing: 'ease-out', fill: 'forwards' }).finished.then(() => t.remove(), () => t.remove());
    }

    /* ---------------- dice ---------------- */
    _syncDiceFromState() {
      const st = this.ws, t = st.turn || {}, d = this._dice;
      const seat = isNum(t.seat) ? t.seat : d.seat;
      const phase = t.phase || 'roll';
      const keep = d.seat === seat && d.phase === phase;
      d.seat = seat;
      d.phase = phase;
      d.values = Array.isArray(t.dice) ? t.dice.filter((v) => v >= 1 && v <= 6).slice(0, 2) : [];
      d.enabled = keep ? d.enabled : false;
      d.rolling = keep ? d.rolling : false;
      d.boost = +t.boost || 0;
      d.double = !!t.double_pending;
      d.chosen = phase === 'move' && d.values.length === 2 && isNum(t.value) ? d.values.indexOf(t.value) : null;
      this._renderDice({});
    }
    _makeDie() {
      const die = h('div', 'lr-die', '<div class="lr-die-shadow"></div><div class="lr-die-hop"><div class="lr-die-tilt"><div class="lr-cube">' +
        [1, 2, 3, 4, 5, 6].map((v) => '<div class="lr-face lr-f' + v + '">' + PIPS[v].map((k) => '<i style="left:' + PIP_POS[k][0] + '%;top:' + PIP_POS[k][1] + '%"></i>').join('') + '</div>').join('') +
        '<div class="lr-core lr-cx"></div><div class="lr-core lr-cy"></div><div class="lr-core lr-cz"></div></div></div></div>');
      die._cube = die.querySelector('.lr-cube');
      die._hop = die.querySelector('.lr-die-hop');
      die._shadow = die.querySelector('.lr-die-shadow');
      die._val = 0;
      this._setFace(die, 6);
      die.addEventListener('click', (ev) => { ev.stopPropagation(); this._onDiceClick(die); });
      return die;
    }
    _setFace(die, v) {
      const r = FACE_ROT[v] || FACE_ROT[6];
      die._val = v;
      die._cube.style.transform = 'rotateX(' + r[0] + 'deg) rotateY(' + r[1] + 'deg) rotateZ(0deg)';
    }
    _ensureDice(n) {
      while (this.dies.length < n) { const d = this._makeDie(); if (this.dies.length) this._setFace(d, this.dies[0]._val || 6); this.diceRow.appendChild(d); this.dies.push(d); }
      while (this.dies.length > n) { const d = this.dies.pop(); this._stopSpin(d); d.remove(); }
      this.diceEl.classList.toggle('lr-two', n === 2);
    }
    _renderDice(o) {
      o = o || {};
      const d = this._dice, st = this.ws;
      const show = d.seat != null && this._active.indexOf(d.seat) >= 0 && !(st && st.status && st.status !== 'playing');
      if (!show) { if (this.diceEl.parentNode) this.diceEl.parentNode.removeChild(this.diceEl); this.dies.forEach((x) => this._stopSpin(x)); return; }
      const slot = this.pods[d.seat]._p.slot;
      if (this.diceEl.parentNode !== slot) slot.appendChild(this.diceEl);
      const n = d.values.length ? d.values.length : (d.double || (d.phase === 'choose_die')) ? 2 : 1;
      this._ensureDice(Math.max(1, Math.min(2, n)));
      if (d.rolling) this.dies.forEach((x) => this._startSpin(x));
      else if (!o.noFaces) {
        this.dies.forEach((x, i) => {
          const v = d.values[i] || d.values[0] || x._val || 6;
          if (x._spin) this._dieLand(x, v, o.land ? 380 : 260);
          else if (!x._landing && x._val !== v) this._setFace(x, v);
        });
      }
      const ec = this.diceEl.classList;
      ec.toggle('lr-enabled', d.enabled && d.phase === 'roll' && !d.rolling);
      ec.toggle('lr-pick', d.enabled && d.phase === 'choose_die' && this.dies.length === 2);
      ec.toggle('lr-idle', !d.values.length && !d.rolling && !(d.enabled && d.phase === 'roll'));
      ec.toggle('lr-boosted', d.boost > 0);
      this.dies.forEach((x, i) => {
        x.classList.toggle('lr-chosen', d.chosen === i);
        x.classList.toggle('lr-unchosen', d.chosen != null && d.chosen >= 0 && d.chosen !== i);
        x.classList.toggle('lr-six', !d.rolling && d.values[i] === 6);
      });
    }
    _startSpin(die) {
      if (die._spin) return;
      if (this.rm || !die._cube.animate) { die._spin = { cancel() {} }; die.classList.add('lr-spin-rm'); return; }
      const a = die._cube.animate([{ transform: 'rotateX(0deg) rotateY(0deg) rotateZ(0deg)' }, { transform: 'rotateX(360deg) rotateY(720deg) rotateZ(180deg)' }], { duration: 560, iterations: Infinity });
      const b = die._hop.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-22%)' }, { transform: 'translateY(0)' }], { duration: 280, iterations: Infinity, easing: 'ease-in-out' });
      const c = die._shadow.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.7)', opacity: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 280, iterations: Infinity });
      die._spin = { cancel() { a.cancel(); b.cancel(); c.cancel(); } };
      clearTimeout(die._watch);
      die._watch = setTimeout(() => { if (die._spin && this._dice.rolling) { this._dice.rolling = false; this._renderDice({ land: true }); } }, 8000);
    }
    _stopSpin(die) { if (die._spin) { die._spin.cancel(); die._spin = null; } die.classList.remove('lr-spin-rm'); clearTimeout(die._watch); }
    _dieLand(die, v, dur) {
      const was = !!die._spin;
      this._stopSpin(die);
      const r = FACE_ROT[v] || FACE_ROT[6];
      die._val = v;
      const fin = 'rotateX(' + r[0] + 'deg) rotateY(' + r[1] + 'deg) rotateZ(0deg)';
      die._cube.style.transform = fin;
      dur = this._t(dur);
      if (this.rm || dur < 30 || !die._cube.animate) return Promise.resolve();
      const sx = 360 * (was ? 1 : 2) * (Math.random() < 0.5 ? -1 : 1), sy = 360 * (Math.random() < 0.5 ? -1 : 1) * (was ? 1 : 2);
      const z0 = rand(-120, 120);
      die._landing = true;
      const a = die._cube.animate([
        { transform: 'rotateX(' + (r[0] + sx) + 'deg) rotateY(' + (r[1] + sy) + 'deg) rotateZ(' + z0 + 'deg)' },
        { transform: 'rotateX(' + (r[0] + sx * 0.18) + 'deg) rotateY(' + (r[1] + sy * 0.12) + 'deg) rotateZ(' + (z0 * 0.1) + 'deg)', offset: 0.72 },
        { transform: fin }
      ], { duration: dur, easing: 'cubic-bezier(.22,.68,.3,1)' });
      die._hop.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-62%) scale(1.06)', offset: 0.3 }, { transform: 'translateY(0) scale(1)', offset: 0.6 }, { transform: 'translateY(-14%)', offset: 0.78 }, { transform: 'translateY(0)', offset: 0.92 }, { transform: 'translateY(0)' }], { duration: dur, easing: 'ease-in-out' });
      die._shadow.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.45)', opacity: 0.35, offset: 0.3 }, { transform: 'scale(1)', opacity: 1, offset: 0.6 }, { transform: 'scale(.85)', offset: 0.78 }, { transform: 'scale(1)' }], { duration: dur });
      return done(a).then(() => { die._landing = false; });
    }
    async _rollAnim(seat, vals) {
      const d = this._dice;
      d.seat = seat; d.values = vals.slice(); d.rolling = false; d.enabled = false; d.chosen = null;
      d.phase = vals.length > 1 ? 'choose_die' : 'move';
      this._renderDice({ noFaces: true });
      if (this.opts.sound) sfx('roll');
      const base = this.dies.some((x) => x._spin) ? 430 : 640;
      await Promise.all(this.dies.map((x, i) => this._dieLand(x, vals[i] || vals[0], base + i * 70)));
      this._renderDice({});
      if (vals.indexOf(6) >= 0 && !this._noFx()) {
        const c = this._center(this.diceEl);
        this._burst(c[0], c[1], { n: 10, cls: 'lr-p-star', colors: ['#ffe066', '#fff', '#ffb703'], d0: 0.7, d1: 1.5, s0: 0.18, s1: 0.32 });
      }
    }
    _onDiceClick(die) {
      const d = this._dice;
      if (!d.enabled || d.rolling) return;
      if (d.phase === 'choose_die') {
        if (!die) return;
        const i = this.dies.indexOf(die);
        const v = d.values[i];
        if (!v) return;
        if (this.opts.sound) sfx('click');
        this._emit('dice', { seat: d.seat, index: i, value: v });
        return;
      }
      if (d.phase !== 'roll') { this._emit('dice', { seat: d.seat }); return; }
      if (this.opts.sound) sfx('click');
      d.rolling = true; d.enabled = false;
      this._renderDice({});
      this._emit('dice', { seat: d.seat });
    }

    /* ---------------- interactivity ---------------- */
    _applyInteractive() {
      const sel = new Set(this._sel.map((o) => o.seat + '-' + o.token));
      const t = this._tgt;
      const tk = t && (t.kind === 'own_token' || t.kind === 'opponent_token') ? new Set(t.valid.filter((o) => o && isNum(+o.seat)).map((o) => (o.seat | 0) + '-' + (o.token | 0))) : null;
      const r = this.root;
      r.classList.toggle('lr-tgt', !!t);
      r.classList.toggle('lr-tgt-token', !!tk);
      r.classList.toggle('lr-tgt-square', !!t && t.kind === 'square');
      r.classList.toggle('lr-tgt-seat', !!t && t.kind === 'seat');
      for (let s = 0; s < 4; s++) for (let i = 0; i < 4; i++) {
        const el = this.tok[s][i], key = s + '-' + i;
        const isT = !!tk && tk.has(key);
        const isS = !t && sel.has(key);
        el.classList.toggle('lr-sel', isS);
        el.classList.toggle('lr-tgt-ok', isT);
        el.classList.toggle('lr-click', isS || isT);
        this._applyZ(el);
      }
      this.tgtL.innerHTML = '';
      if (t && t.kind === 'square') {
        t.valid.forEach((a) => {
          if (!isNum(+a)) return;
          const q = this._absCell(+a);
          const c = h('div', 'lr-tcell', '<i></i>');
          c.dataset.abs = ((+a % 52) + 52) % 52;
          c.style.transform = T({ x: q[0], y: q[1], s: 1 });
          this.tgtL.appendChild(c);
        });
      }
      const seats = t && t.kind === 'seat' ? t.valid.map((v) => (typeof v === 'object' && v ? v.seat : v) | 0) : [];
      this.pods.forEach((p, s) => p.classList.toggle('lr-tgt-ok', seats.indexOf(s) >= 0));
      seats.forEach((s) => {
        if (!this.yglow[s]) return;
        const y = h('div', 'lr-tyard', '<i></i>');
        y.dataset.tseat = s;
        y.style.cssText = this.yglow[s].style.cssText;
        y.style.setProperty('--pc', COLORS[s].base);
        this.tgtL.appendChild(y);
      });
    }
    _onTokenClick(s, i) {
      if (this._busy) return;
      const t = this._tgt;
      if (t) {
        if ((t.kind === 'own_token' || t.kind === 'opponent_token') && t.valid.some((o) => o && (o.seat | 0) === s && (o.token | 0) === i)) { if (this.opts.sound) sfx('click'); this._emit('token', { seat: s, token: i }); }
        return;
      }
      if (this._sel.some((o) => o.seat === s && o.token === i)) { if (this.opts.sound) sfx('click'); this._emit('token', { seat: s, token: i }); }
    }
    _onPodClick(s) {
      this._emit('pod', { seat: s });
      const t = this._tgt;
      if (t && t.kind === 'seat' && !this._busy && t.valid.some((v) => ((typeof v === 'object' && v ? v.seat : v) | 0) === s)) { if (this.opts.sound) sfx('click'); this._emit('seat', { seat: s }); }
    }
    _emit(evt, data) {
      const l = this._listeners[evt];
      if (!l) return;
      l.slice().forEach((fn) => { try { fn(data); } catch (err) { setTimeout(() => { throw err; }); } });
    }

    /* ---------------- timer ---------------- */
    _tickTimer() {
      this._raf = 0;
      if (this._destroyed || !this._timer) return;
      const t = this._timer, pod = this.pods[t.seat];
      const rem = t.deadline - Date.now();
      const frac = clamp(rem / t.total, 0, 1);
      if (pod) {
        const ring = pod._p.ring;
        ring.style.strokeDashoffset = (100 * (1 - frac)).toFixed(2);
        ring.style.stroke = 'hsl(' + Math.round(frac * 130) + ',88%,' + (frac < 0.25 ? 58 : 50) + '%)';
        const urgent = rem > 0 && rem < 5000;
        pod.classList.toggle('lr-urgent', urgent);
        if (urgent) {
          const sec = Math.ceil(rem / 1000);
          if (sec !== t.lastSec) { t.lastSec = sec; if (t.seat === this.viewSeat && this.opts.sound) sfx('tick'); }
        }
      }
      if (rem > -500) this._raf = requestAnimationFrame(() => this._tickTimer());
    }

    /* ---------------- animation queue ---------------- */
    _t(ms) { if (this._scale === 0) return 0; return this.rm ? Math.min(ms, 160) * 0.6 : ms * (this.opts.timeScale || 1) * this._scale; }
    _noFx() { return this._scale === 0 || this._destroyed; }
    _wait(ms) { const t = this._t(ms); return t > 4 ? sleep(t) : Promise.resolve(); }
    async _runJob(events, finalState) {
      this._pending = Math.max(0, this._pending - 1);
      if (this._destroyed) return;
      if (!this.ws) { if (finalState) this.setState(finalState); return; }
      this._busy = true;
      this.root.classList.add('lr-busy');
      try {
        const list = Array.isArray(events) ? events : [];
        for (let i = 0; i < list.length; i++) {
          if (this._destroyed) return;
          const ev = list[i];
          if (!ev || typeof ev !== 'object') continue;
          const p = this._pending;
          this._scale = p >= 5 ? 0 : p >= 3 ? 0.4 : p >= 1 ? 0.7 : 1;
          const fn = HANDLERS[ev.type];
          if (!fn) continue;
          try { await fn.call(this, ev); } catch (err) { if (window.console) console.warn('[LudoRenderer] event "' + ev.type + '" failed:', err); }
        }
      } finally {
        this._scale = 1;
        this._busy = false;
        this._moving.clear();
        if (this.root) this.root.classList.remove('lr-busy');
        if (!this._destroyed) {
          if (typeof this.debugSequenceEnd === 'function') { try { this.debugSequenceEnd(clone(this.ws), finalState); } catch (e) { /* dev hook only */ } }
          if (finalState && Array.isArray(finalState.tokens)) this.setState(finalState);
          else if (this.ws) { this.state = clone(this.ws); this._syncAll(); }
        }
      }
    }

    /* ---------------- geometry helpers for fx ---------------- */
    _px(x, y) { const L = this.L; return [L.gx + x * L.cell, L.gy + y * L.cell]; }
    _center(el) {
      if (!el || !el.getBoundingClientRect) return [this.L.stageW / 2, this.L.stageH / 2];
      const r = el.getBoundingClientRect(), s = this.stage.getBoundingClientRect();
      return [r.left + r.width / 2 - s.left, r.top + r.height / 2 - s.top];
    }
    _tokPx(el) { const p = el._pos || { x: 7.5, y: 7.5, s: 1 }; return this._px(p.x, p.y - 0.28 * p.s); }
    _podPx(s, part) { const pod = this.pods[s]; if (!pod) return [this.L.stageW / 2, this.L.stageH / 2]; return this._center(part === 'inv' ? (pod._p.inv.lastElementChild || pod._p.inv) : part === 'dice' ? pod._p.slot : pod._p.avw); }

    /* ---------------- fx primitives ---------------- */
    _fx(cls, x, y, w, hh, html) {
      const e = h('div', 'lr-fxe ' + (cls || ''), html);
      const s = e.style;
      s.left = (x - w / 2).toFixed(1) + 'px'; s.top = (y - hh / 2).toFixed(1) + 'px'; s.width = w.toFixed(1) + 'px'; s.height = hh.toFixed(1) + 'px';
      this.fxL.appendChild(e);
      return e;
    }
    _anim(e, kf, dur, o) {
      o = o || {};
      const a = e.animate(kf, { duration: Math.max(1, this._t(dur)), delay: o.delay ? this._t(o.delay) : 0, easing: o.easing || 'ease-out', fill: 'both' });
      if (o.keep !== true) a.finished.then(() => e.remove(), () => e.remove());
      return a;
    }
    _burst(x, y, o) {
      if (this._noFx()) return;
      const c = this.L.cell;
      const n = this.rm ? Math.ceil((o.n || 12) / 4) : (o.n || 12);
      for (let i = 0; i < n; i++) {
        const ang = o.a0 != null ? o.a0 + Math.random() * (o.a1 - o.a0) : (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
        const dist = rand(o.d0 || 0.6, o.d1 || 1.4) * c;
        const sz = rand(o.s0 || 0.12, o.s1 || 0.26) * c;
        const e = this._fx('lr-p ' + (o.cls || 'lr-p-dot'), x, y, sz, sz);
        const col = Array.isArray(o.colors) ? pick(o.colors) : o.colors;
        if (col) e.style.setProperty('--c', col);
        const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
        const g = (o.grav || 0) * c, rot = rand(-300, 300);
        this._anim(e, [
          { transform: 'translate(0,0) rotate(0deg) scale(' + (o.sc0 == null ? 0.6 : o.sc0) + ')', opacity: 1 },
          { transform: 'translate(' + (dx * 0.72).toFixed(1) + 'px,' + (dy * 0.72 - (o.lift || 0) * c).toFixed(1) + 'px) rotate(' + (rot * 0.6).toFixed(0) + 'deg) scale(1)', opacity: 1, offset: 0.55 },
          { transform: 'translate(' + dx.toFixed(1) + 'px,' + (dy + g).toFixed(1) + 'px) rotate(' + rot.toFixed(0) + 'deg) scale(' + (o.sc1 == null ? 0.2 : o.sc1) + ')', opacity: 0 }
        ], rand(o.t0 || 420, o.t1 || 760), { easing: 'cubic-bezier(.15,.7,.3,1)', delay: (o.stagger || 0) * i });
      }
    }
    _streak(a, b) {
      if (this._noFx() || this.rm) return;
      const c = this.L.cell, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) + c * 0.6, ang = Math.atan2(dy, dx) * 180 / Math.PI;
      const e = this._fx('lr-streak', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, len, c * 0.55);
      this._anim(e, [{ transform: 'rotate(' + ang + 'deg) scaleY(1)', opacity: 1 }, { transform: 'rotate(' + ang + 'deg) scaleY(.35)', opacity: 0 }], 520, { easing: 'ease-in' });
    }
    _ring(x, y, o) {
      if (this._noFx()) return;
      o = o || {};
      const c = this.L.cell, sz = (o.size || 1) * c;
      const e = this._fx('lr-ring', x, y, sz, sz);
      if (o.c) e.style.setProperty('--c', o.c);
      this._anim(e, [{ transform: 'scale(.15)', opacity: 1 }, { transform: 'scale(' + (o.scale || 2.6) + ')', opacity: 0 }], o.dur || 520, { delay: o.delay, easing: 'cubic-bezier(.2,.8,.3,1)' });
    }
    _shake(power) {
      if (this.rm || this._noFx() || !this.boardEl.animate) return;
      const p = (power || 1) * this.L.S * 0.012, kf = [];
      for (let i = 0; i <= 8; i++) { const f = 1 - i / 8; kf.push({ transform: i === 8 ? 'none' : 'translate(' + (rand(-1, 1) * p * f).toFixed(1) + 'px,' + (rand(-1, 1) * p * f).toFixed(1) + 'px)' }); }
      this.boardEl.animate(kf, { duration: this._t(380), easing: 'linear' });
    }
    _arcKf(from, to, lift, s0, s1, rot, origin) {
      const o = origin || from;
      const kf = [], N = 14, cx = (from[0] + to[0]) / 2, cy = Math.min(from[1], to[1]) - lift;
      for (let i = 0; i <= N; i++) {
        const t = i / N, u = 1 - t;
        const bx = u * u * from[0] + 2 * u * t * cx + t * t * to[0], by = u * u * from[1] + 2 * u * t * cy + t * t * to[1];
        kf.push({ transform: 'translate(' + (bx - o[0]).toFixed(1) + 'px,' + (by - o[1]).toFixed(1) + 'px) scale(' + (s0 + (s1 - s0) * t).toFixed(3) + ') rotate(' + ((rot || 0) * t).toFixed(0) + 'deg)', offset: t });
      }
      return kf;
    }
    _hop(el, to, dur, lift) {
      const from = el._pos || to;
      el._pos = { x: to.x, y: to.y, s: to.s };
      el.style.transform = T(to);
      dur = this._t(dur);
      if (dur < 20 || this.rm) return Promise.resolve();
      const kf = [], N = 6;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        kf.push({ transform: T({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - lift * 4 * t * (1 - t), s: from.s + (to.s - from.s) * t }), offset: t });
      }
      const a = el.animate(kf, { duration: dur, easing: 'linear' });
      el.firstChild.animate([{ transform: 'scale(1,1)' }, { transform: 'scale(.9,1.1)', offset: 0.25 }, { transform: 'scale(1,1)', offset: 0.62 }, { transform: 'scale(1.15,.84)', offset: 0.9 }, { transform: 'scale(1,1)' }], { duration: dur, easing: 'linear' });
      return done(a);
    }
    _flyToken(el, to, dur, lift, spin) {
      const from = el._pos || to;
      el._pos = { x: to.x, y: to.y, s: to.s };
      el.style.transform = T(to);
      dur = this._t(dur);
      if (dur < 20 || this.rm) return Promise.resolve();
      const kf = [], N = 14;
      for (let i = 0; i <= N; i++) {
        const t = i / N, sc = (from.s + (to.s - from.s) * t) * (1 + 0.45 * Math.sin(Math.PI * t));
        kf.push({ transform: T({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - lift * 4 * t * (1 - t), s: sc }), offset: t });
      }
      const a = el.animate(kf, { duration: dur, easing: 'cubic-bezier(.35,.1,.35,1)' });
      if (spin) el.firstChild.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(' + spin + 'deg)' }], { duration: dur, easing: 'cubic-bezier(.3,.2,.3,1)' });
      return done(a);
    }
    _yardPos(s, i) { const q = this._cellOf(s, i, -1); return { x: q[0], y: q[1], s: 1.02 }; }
    async _sendHome(s, i, o) {
      o = o || {};
      const el = this.tok[s] && this.tok[s][i];
      if (!el) return;
      this._moving.add(el);
      el.classList.add('lr-moving');
      el.classList.remove('lr-anim');
      this._applyZ(el);
      const to = this._yardPos(s, i);
      await this._flyToken(el, to, o.dur || 620, o.lift || 3.2, o.spin == null ? (Math.random() < 0.5 ? -540 : 540) : o.spin);
      this._moving.delete(el);
      el.classList.remove('lr-moving');
      this.ws.tokens[s][i] = -1;
      if (!this._noFx()) {
        const q = this._tokPx(el);
        this._burst(q[0], q[1] + this.L.cell * 0.3, { n: 7, cls: 'lr-p-smoke', d0: 0.3, d1: 0.7, s0: 0.35, s1: 0.6, sc1: 1.4, t0: 420, t1: 620 });
        el.firstChild.animate([{ transform: 'scale(1.25,.75)' }, { transform: 'scale(.95,1.06)' }, { transform: 'scale(1)' }], { duration: this._t(260), easing: 'ease-out' });
      }
      this._relayout(true);
    }
    _flyIcon(power, from, to, o) {
      o = o || {};
      const meta = POWERUP_META[power];
      if (!meta || this._noFx()) return Promise.resolve();
      const sz = this.L.cell * (o.size || 1.35);
      const e = this._fx('lr-ficon', from[0], from[1], sz, sz, '<img alt="" src="' + meta.icon_url + '">');
      e.style.setProperty('--c', meta.color);
      const appear = this._anim(e, [{ transform: 'scale(.15) rotate(-40deg)', opacity: 0 }, { transform: 'scale(1.3) rotate(6deg)', opacity: 1, offset: 0.65 }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }], o.appear || 300, { keep: true });
      return done(appear).then(() => {
        if (!e.isConnected) return;
        const kf = this._arcKf(from, to, this.L.cell * (o.lift || 2.4), 1, o.s1 || 0.5, o.rot || 0);
        kf[kf.length - 1].opacity = 0.2;
        appear.cancel();
        return done(this._anim(e, kf, o.dur || 560, { easing: 'cubic-bezier(.5,0,.6,1)' }));
      });
    }

    /* ---------------- confetti ---------------- */
    _confetti(seat) {
      const cv = this.confCv, ctx = cv.getContext && cv.getContext('2d');
      if (!ctx || !this.L) return;
      const W = this.L.stageW, H = this.L.stageH, dpr = this._dpr || 1;
      const cols = COLORS.map((c) => c.base).concat(['#ffffff', '#ffd34d', '#7c5bf5', '#4f7df9']);
      if (seat >= 0) for (let i = 0; i < 4; i++) cols.push(COLORS[seat].base, COLORS[seat].light);
      const parts = this._conf || (this._conf = []);
      const N = this.rm ? 40 : 190;
      const add = (x, y, vx, vy) => parts.push({ x: x, y: y, vx: vx, vy: vy, w: rand(5, 10) * (W / 600 + 0.5), h: rand(3, 6) * (W / 600 + 0.5), r: rand(0, 6.28), vr: rand(-10, 10), c: pick(cols), shape: Math.random() < 0.25 ? 1 : 0, ph: rand(0, 6.28), life: 0 });
      for (let i = 0; i < N; i++) {
        const side = i % 3;
        if (side === 0) add(0, H * 0.75, rand(260, 700) * (W / 600), -rand(520, 1050) * (H / 700));
        else if (side === 1) add(W, H * 0.75, -rand(260, 700) * (W / 600), -rand(520, 1050) * (H / 700));
        else add(rand(0, W), -rand(0, H * 0.3), rand(-60, 60), rand(40, 200));
      }
      if (this._confRaf) return;
      let last = performance.now();
      const step = (now) => {
        const dt = Math.min(0.033, (now - last) / 1000); last = now;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        for (let i = parts.length - 1; i >= 0; i--) {
          const q = parts[i];
          q.life += dt;
          q.vy += 900 * dt * (H / 700); q.vx *= 0.985; q.vy *= 0.985;
          if (q.vy > 220) q.vy = 220 + (q.vy - 220) * 0.9;
          q.x += q.vx * dt + Math.sin(q.ph + q.life * 6) * 0.6; q.y += q.vy * dt; q.r += q.vr * dt;
          if (q.y > H + 30 || q.life > 6) { parts.splice(i, 1); continue; }
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.r);
          ctx.scale(1, Math.cos(q.ph + q.life * 9));
          ctx.fillStyle = q.c;
          if (q.shape) { ctx.beginPath(); ctx.arc(0, 0, q.h * 0.8, 0, 6.283); ctx.fill(); } else ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
          ctx.restore();
        }
        if (parts.length && !this._destroyed) this._confRaf = requestAnimationFrame(step);
        else { this._confRaf = 0; ctx.clearRect(0, 0, W, H); }
      };
      this._confRaf = requestAnimationFrame(step);
    }
  }

  /* ======================================================================
     Event handlers (§7). Each mutates this.ws and animates; unknown types ignored.
     ====================================================================== */
  const HANDLERS = {
    async turn_start(e) {
      const st = this.ws, s = e.seat | 0;
      st.turn = Object.assign({}, st.turn, { seat: s, number: e.number, phase: 'roll', dice: [], value: null, boost: 0, double_pending: false, power_used: false, legal_moves: [], can_pass: false });
      this._dice.chosen = null;
      this._syncDiceFromState();
      for (let i = 0; i < 4; i++) this._renderPod(i);
      this._syncYardGlow();
      if (s === this.viewSeat && this.opts.sound) sfx('turn');
      const pod = this.pods[s];
      if (pod && !this.rm && !this._noFx()) pod._p.card.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: this._t(320), easing: 'ease-out' });
      await this._wait(140);
    },

    async turn_skipped(e) {
      const st = this.ws, s = e.seat | 0, pod = this.pods[s];
      const reason = e.reason;
      if (reason === 'frozen') {
        if (st.players[s]) st.players[s].frozen = false;
        if (this.opts.sound) sfx('freeze');
        if (pod && !this._noFx()) {
          const c = this._center(pod._p.card);
          this._burst(c[0], c[1], { n: 16, cls: 'lr-p-shard', d0: 1.2, d1: 2.6, s0: 0.2, s1: 0.42, grav: 0.8, t0: 500, t1: 800 });
          this._burst(c[0], c[1], { n: 6, cls: 'lr-p-snow', d0: 0.8, d1: 1.6, s0: 0.3, s1: 0.5 });
        }
        this._renderPod(s);
        this._relayout(false);
      } else if (reason === 'three_sixes') {
        this.flash('Three sixes!', s === this.viewSeat ? 'bad' : 'info');
        if (!this.rm && !this._noFx()) this.diceEl.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-14deg)' }, { transform: 'rotate(12deg)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(0)' }], { duration: this._t(420) });
      } else if (!this.rm && !this._noFx() && this.diceEl.isConnected) {
        this.diceEl.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-10%)' }, { transform: 'translateX(9%)' }, { transform: 'translateX(-5%)' }, { transform: 'translateX(0)' }], { duration: this._t(360) });
      }
      this._podToast(s, SKIP_TEXT[reason] || 'Turn skipped', reason === 'pass' ? '' : 'bad');
      await this._wait(reason === 'frozen' ? 700 : 520);
    },

    async rolled(e) {
      const st = this.ws, s = e.seat | 0;
      const vals = (Array.isArray(e.dice) ? e.dice : [e.value]).map((v) => v | 0).filter((v) => v >= 1 && v <= 6).slice(0, 2);
      if (!vals.length) return;
      st.turn = Object.assign({}, st.turn, { seat: s, dice: vals.slice(), value: e.value == null ? null : e.value, phase: e.value == null && vals.length > 1 ? 'choose_die' : 'move', double_pending: false });
      if (st.turn.seat !== this._dice.seat) for (let i = 0; i < 4; i++) this._renderPod(i);
      await this._rollAnim(s, vals);
      this._dice.phase = st.turn.phase;
      await this._wait(80);
    },

    async die_chosen(e) {
      const st = this.ws, v = e.value | 0;
      const vals = (st.turn && st.turn.dice) || this._dice.values;
      const idx = vals.indexOf(v);
      st.turn = Object.assign({}, st.turn, { value: v, phase: 'move' });
      this._dice.phase = 'move';
      this._dice.enabled = false;
      this._dice.chosen = idx >= 0 ? idx : null;
      this._renderDice({});
      const die = this.dies[idx];
      if (die && !this._noFx()) {
        if (this.opts.sound) sfx('click');
        const c = this._center(die);
        this._ring(c[0], c[1], { c: '#ffe066', size: 1.2, scale: 2 });
        if (!this.rm) die.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1.12)' }], { duration: this._t(300), easing: 'ease-out' });
      }
      await this._wait(320);
    },

    async moved(e) {
      const st = this.ws, s = e.seat | 0, i = e.token | 0;
      const el = this.tok[s] && this.tok[s][i];
      if (!el || !st.tokens[s]) return;
      const to = e.to | 0;
      let path = Array.isArray(e.path) && e.path.length ? e.path.map((v) => v | 0) : [to];
      if (path[path.length - 1] !== to) path.push(to);
      const from = isNum(e.from) ? e.from : st.tokens[s][i];
      st.tokens[s][i] = from;
      const boost = +e.boost || 0;
      this._moving.add(el);
      el.classList.remove('lr-anim');
      el.classList.add('lr-moving');
      if (boost > 0) el.classList.add('lr-boosting');
      this._applyZ(el);
      this._relayout(true);
      if (boost > 0 && this.opts.sound) sfx('boost');
      if (this.rm || this._noFx()) {
        const q = this._cellOf(s, i, to);
        el._pos = { x: q[0], y: q[1], s: 1 };
        el.style.transform = T(el._pos);
        if (this.opts.sound && !this._noFx()) sfx('step', { i: 0 });
        await this._wait(120);
      } else if (from < 0) {
        const q = this._cellOf(s, i, 0);
        await this._hop(el, { x: q[0], y: q[1], s: 1 }, 380, 1.6);
        if (this.opts.sound) sfx('step', { i: 3 });
        const c = this._tokPx(el);
        this._ring(c[0], c[1] + this.L.cell * 0.32, { c: COLORS[s].light, size: 0.9, scale: 2.2, dur: 420 });
        this._burst(c[0], c[1] + this.L.cell * 0.3, { n: 8, cls: 'lr-p-dot', colors: [COLORS[s].light, '#fff'], d0: 0.5, d1: 1, s0: 0.12, s1: 0.2 });
      } else {
        const stepMs = boost > 0 ? 86 : 112;
        for (let j = 0; j < path.length; j++) {
          const q = this._cellOf(s, i, path[j]);
          const prev = el._pos;
          if (boost > 0) {
            const a = this._px(prev.x, prev.y + 0.05), b2 = this._px(prev.x + (q[0] - prev.x) * 0.45, prev.y + (q[1] - prev.y) * 0.45 + 0.05);
            this._streak(a, b2);
            this._burst(a[0], a[1], { n: 5, cls: 'lr-p-flame', d0: 0.05, d1: 0.4, s0: 0.6, s1: 0.95, sc0: 1, sc1: 0.25, t0: 420, t1: 640, lift: 0.3 });
            if (j % 2 === 0) this._burst(a[0], a[1], { n: 2, cls: 'lr-p-smoke', d0: 0.1, d1: 0.4, s0: 0.55, s1: 0.8, sc1: 1.7, t0: 700, t1: 900, lift: 0.5 });
          }
          await this._hop(el, { x: q[0], y: q[1], s: 1 }, stepMs, boost > 0 ? 0.32 : 0.42);
          if (this.opts.sound) sfx('step', { i: j });
        }
      }
      st.tokens[s][i] = to;
      this._moving.delete(el);
      el.classList.remove('lr-moving', 'lr-boosting');
      if (st.turn) st.turn.boost = 0;
      this._dice.boost = 0;
      this.diceEl.classList.remove('lr-boosted');
      this._relayout(true);
      await this._wait(60);
    },

    async captured(e) {
      const s = e.seat | 0, vs = e.victim_seat | 0, vi = e.victim_token | 0;
      const q = isNum(e.abs) ? this._absCell(e.abs) : null;
      const vel = this.tok[vs] && this.tok[vs][vi];
      const c = q ? this._px(q[0], q[1] - 0.15) : (vel ? this._tokPx(vel) : [0, 0]);
      if (this.opts.sound) sfx('capture');
      this._ring(c[0], c[1], { c: '#fff', size: 1, scale: 3.2, dur: 480 });
      this._ring(c[0], c[1], { c: COLORS[s].base, size: 1, scale: 2.2, dur: 420, delay: 60 });
      this._burst(c[0], c[1], { n: 14, cls: 'lr-p-star', colors: ['#fff', '#ffe066', COLORS[s].light], d0: 0.9, d1: 2, s0: 0.2, s1: 0.36 });
      this._burst(c[0], c[1], { n: 10, cls: 'lr-p-dot', colors: [COLORS[vs].base, COLORS[vs].light], d0: 0.6, d1: 1.5, grav: 0.6 });
      if (!this._noFx()) { const b = this._fx('lr-impact', c[0], c[1], this.L.cell * 2.2, this.L.cell * 2.2); this._anim(b, [{ transform: 'scale(.2) rotate(0deg)', opacity: 1 }, { transform: 'scale(1.1) rotate(25deg)', opacity: 0.9, offset: 0.4 }, { transform: 'scale(1.4) rotate(40deg)', opacity: 0 }], 420); }
      this._shake(0.8);
      this.flash('Captured!', s === this.viewSeat ? 'good' : vs === this.viewSeat ? 'bad' : 'info');
      await this._wait(140);
      await this._sendHome(vs, vi, {});
      await this._wait(80);
    },

    async shield_blocked(e) {
      const vs = e.victim_seat | 0, vi = e.victim_token | 0;
      const el = this.tok[vs] && this.tok[vs][vi];
      if (this.opts.sound) sfx('shield');
      if (el && !this._noFx()) {
        const c = this._tokPx(el);
        const sh = el.querySelector('.lr-tok-shield');
        if (!this.rm && sh) sh.animate([{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.38)', filter: 'brightness(2.2)', offset: 0.3 }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: this._t(460), easing: 'ease-out' });
        this._ring(c[0], c[1], { c: '#7fdcff', size: 1.4, scale: 2.4, dur: 480 });
        this._burst(c[0], c[1], { n: 14, cls: 'lr-p-dot', colors: ['#bdf0ff', '#ffffff', '#5cc8ff'], d0: 0.9, d1: 1.8, s0: 0.12, s1: 0.22 });
      }
      this._podToast(vs, 'Shield blocked!', 'good');
      this.flash('Blocked!', vs === this.viewSeat ? 'good' : 'info');
      await this._wait(520);
    },

    async bomb_triggered(e) {
      const st = this.ws, a = ((e.abs | 0) % 52 + 52) % 52, s = e.seat | 0, i = e.token | 0;
      const q = this._absCell(a), c = this._px(q[0], q[1] - 0.1);
      const bel = this._bombs.get(a);
      if (bel) {
        this._bombs.delete(a);
        if (!this.rm && !this._noFx()) bel.firstChild.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)', filter: 'brightness(3)' }], { duration: this._t(120), fill: 'forwards' }).finished.then(() => bel.remove(), () => bel.remove());
        else bel.remove();
      }
      st.bombs = (st.bombs || []).filter((b) => (((b.abs | 0) % 52) + 52) % 52 !== a);
      await this._wait(110);
      if (this.opts.sound) sfx('bomb');
      this._explosion(c[0], c[1], e.defused ? 0.6 : 1);
      if (e.defused) {
        this._podToast(s, 'Bomb defused!', 'good');
        this.flash('Defused!', s === this.viewSeat ? 'good' : 'info');
        const el = this.tok[s] && this.tok[s][i];
        const sh = el && el.querySelector('.lr-tok-shield');
        if (sh && !this.rm && !this._noFx()) sh.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.45)', filter: 'brightness(2.4)', offset: 0.3 }, { transform: 'scale(1)' }], { duration: this._t(520) });
        await this._wait(560);
      } else {
        this.flash('Boom!', s === this.viewSeat ? 'bad' : (e.bomb_seat | 0) === this.viewSeat ? 'good' : 'info');
        await this._wait(160);
        await this._sendHome(s, i, { lift: 4, dur: 700 });
      }
    },

    async crate_collected(e) {
      const st = this.ws, s = e.seat | 0, a = ((e.abs | 0) % 52 + 52) % 52;
      const q = this._absCell(a), c = this._px(q[0], q[1] - 0.2);
      const crate = this._crates.get(a);
      this._crates.delete(a);
      st.crates = (st.crates || []).filter((x) => (((x | 0) % 52) + 52) % 52 !== a);
      if (this.opts.sound) sfx('crate');
      if (crate) {
        if (!this.rm && !this._noFx()) crate.firstChild.animate([{ transform: 'scale(1) rotate(0)', opacity: 1 }, { transform: 'scale(1.45) rotate(-8deg)', opacity: 1, offset: 0.35 }, { transform: 'scale(.2) rotate(20deg)', opacity: 0 }], { duration: this._t(320), fill: 'forwards' }).finished.then(() => crate.remove(), () => crate.remove());
        else crate.remove();
      }
      if (!this._noFx()) {
        const r = this._fx('lr-rays', c[0], c[1], this.L.cell * 3.6, this.L.cell * 3.6);
        this._anim(r, [{ transform: 'scale(.2) rotate(0deg)', opacity: 0 }, { transform: 'scale(1) rotate(40deg)', opacity: 1, offset: 0.3 }, { transform: 'scale(1.15) rotate(110deg)', opacity: 0 }], 900);
        this._ring(c[0], c[1], { c: '#ffd34d', size: 1, scale: 2.6 });
        this._burst(c[0], c[1], { n: 14, cls: 'lr-p-star', colors: ['#ffe066', '#fff', '#c9a8ff', '#a476ff'], d0: 0.8, d1: 1.9, s0: 0.18, s1: 0.32 });
      }
      const pl = st.players[s];
      const pod = this.pods[s];
      const target = pod ? this._center(pod._p.inv.lastElementChild || pod._p.inv) : c;
      const tgt = pod && pod._p.inv.children.length ? [target[0] + this.L.cell * 0.8 * (pod.classList.contains('lr-right') ? -1 : 1), target[1]] : target;
      await this._flyIcon(e.power, c, tgt, { lift: 2.6, dur: 560 });
      if (pl && POWERUP_META[e.power]) pl.inventory.push(e.power);
      this._renderPod(s);
      if (this.flashEl && s === this.viewSeat && POWERUP_META[e.power]) this.flash(POWERUP_META[e.power].name, 'good', { icon: POWERUP_META[e.power].icon_url, hold: 650 });
      await this._wait(120);
    },

    async crate_full(e) {
      const a = ((e.abs | 0) % 52 + 52) % 52, crate = this._crates.get(a);
      if (crate && !this.rm && !this._noFx()) crate.firstChild.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-14deg) scale(1.1)' }, { transform: 'rotate(12deg)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(0)' }], { duration: this._t(460) });
      this._podToast(e.seat | 0, 'Power-ups full!', 'bad');
      await this._wait(480);
    },

    async crate_spawned(e) {
      const st = this.ws, a = ((e.abs | 0) % 52 + 52) % 52;
      if (this._crates.has(a)) return;
      if (st.crates.indexOf(a) < 0) st.crates.push(a);
      const el = this._makeItem('crate', a);
      this._crates.set(a, el);
      if (this.rm || this._noFx()) return;
      if (this.opts.sound) sfx('crate', { soft: true });
      const c = this.L.cell;
      el.firstChild.animate([{ transform: 'translateY(' + (-3.4 * c) + 'px) scale(.6)', opacity: 0 }, { transform: 'translateY(0) scale(1.1,.86)', opacity: 1, offset: 0.62 }, { transform: 'translateY(' + (-0.35 * c) + 'px) scale(.96,1.05)', offset: 0.8 }, { transform: 'translateY(0) scale(1)' }], { duration: this._t(520), easing: 'ease-in' });
      await this._wait(330);
      const q = this._absCell(a), p = this._px(q[0], q[1] + 0.25);
      this._burst(p[0], p[1], { n: 6, cls: 'lr-p-smoke', a0: Math.PI * 0.9, a1: Math.PI * 2.1, d0: 0.4, d1: 0.8, s0: 0.3, s1: 0.5, sc1: 1.4 });
      this._burst(p[0], p[1] - c * 0.4, { n: 6, cls: 'lr-p-star', colors: ['#ffe066', '#fff'], d0: 0.5, d1: 1.1, s0: 0.12, s1: 0.2 });
      await this._wait(150);
    },

    async power_used(e) {
      const st = this.ws, s = e.seat | 0, power = e.power, meta = POWERUP_META[power];
      const tg = e.target || {};
      const pl = st.players[s];
      const pod = this.pods[s];
      let from = pod ? this._center(pod._p.inv.querySelector('[data-p="' + power + '"]') || pod._p.avw) : [this.L.stageW / 2, this.L.stageH / 2];
      if (pl) { const j = pl.inventory.indexOf(power); if (j >= 0) pl.inventory.splice(j, 1); }
      if (st.turn) st.turn.power_used = true;
      this._renderPod(s);
      if (this.opts.sound) sfx(power === 'shield' ? 'shield' : power === 'boost' ? 'boost' : 'power');
      if (meta && !this._noFx()) {
        const sz = this.L.cell * 1.5;
        const ic = this._fx('lr-ficon lr-ficon-cast', from[0], from[1], sz, sz, '<img alt="" src="' + meta.icon_url + '">');
        ic.style.setProperty('--c', meta.color);
        this._anim(ic, [{ transform: 'scale(.6)', opacity: 1 }, { transform: 'scale(1.7) translateY(-10%)', opacity: 1, offset: 0.45 }, { transform: 'scale(2.3) translateY(-18%)', opacity: 0 }], 640);
        this._ring(from[0], from[1], { c: meta.color, size: 1.2, scale: 2.4 });
        this.flash(meta.name + '!', s === this.viewSeat ? 'good' : 'info', { icon: meta.icon_url, hold: 480, y: 0.3 });
      }
      if (power === 'shield' && isNum(tg.token)) {
        const ti = tg.token | 0;
        st.shields = (st.shields || []).filter((x) => !((x.seat | 0) === s && (x.token | 0) === ti));
        st.shields.push({ seat: s, token: ti, rounds_left: 2 });
        await this._wait(180);
        const el = this.tok[s][ti];
        this._syncShields();
        if (el && !this._noFx()) {
          const c = this._tokPx(el);
          const sh = el.querySelector('.lr-tok-shield');
          if (sh && !this.rm) sh.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.55 }, { transform: 'scale(1)', opacity: 1 }], { duration: this._t(480), easing: 'ease-out' });
          this._ring(c[0], c[1], { c: '#7fdcff', size: 1.2, scale: 2.2 });
          this._burst(c[0], c[1], { n: 12, cls: 'lr-p-star', colors: ['#bdf0ff', '#fff', '#6d94ff'], d0: 0.7, d1: 1.4, s0: 0.12, s1: 0.22 });
        }
        await this._wait(420);
      } else if (power === 'boost') {
        const amt = isNum(tg.amount) ? tg.amount : 3;
        if (st.turn) st.turn.boost = amt;
        this._dice.boost = amt;
        this._renderDice({});
        const chip = this.diceEl.querySelector('.lr-boost-chip');
        if (chip) chip.querySelector('b').textContent = '+' + amt;
        if (this.diceEl.isConnected && !this._noFx()) {
          const c = this._center(this.diceEl);
          this._burst(c[0], c[1], { n: 12, cls: 'lr-p-flame', d0: 0.4, d1: 1.2, s0: 0.4, s1: 0.7, lift: 0.5, sc0: 1 });
          if (chip && !this.rm) chip.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: this._t(380), easing: 'ease-out' });
        }
        await this._wait(520);
      } else if (power === 'double_dice') {
        if (st.turn) st.turn.double_pending = true;
        this._dice.double = true;
        this._dice.values = [];
        this._renderDice({});
        const d2 = this.dies[1];
        if (d2 && !this.rm && !this._noFx()) {
          d2.animate([{ transform: 'scale(0) rotate(-90deg)', opacity: 0 }, { transform: 'scale(1.25) rotate(10deg)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: this._t(420), easing: 'ease-out' });
          const c = this._center(d2);
          this._burst(c[0], c[1], { n: 10, cls: 'lr-p-star', colors: ['#ffbe3d', '#fff'], d0: 0.6, d1: 1.2, s0: 0.14, s1: 0.24 });
        }
        await this._wait(520);
      } else if (power === 'reroll') {
        if (this.diceEl.isConnected && !this.rm && !this._noFx()) {
          await done(this.diceEl.animate([{ transform: 'rotate(0) scale(1)', opacity: 1, filter: 'blur(0)' }, { transform: 'rotate(-200deg) scale(.6)', opacity: 0.2, filter: 'blur(2px)' }], { duration: this._t(300), easing: 'ease-in' }));
          this._dice.values = [];
          this._renderDice({});
          this.diceEl.animate([{ transform: 'scale(.6)', opacity: 0.2 }, { transform: 'scale(1)', opacity: 1 }], { duration: this._t(180) });
        }
        await this._wait(260);
      } else {
        await this._wait(420);
      }
    },

    async bomb_placed(e) {
      const st = this.ws, s = e.seat | 0, a = ((e.abs | 0) % 52 + 52) % 52;
      const rep = isNum(e.replaced_abs) ? ((e.replaced_abs % 52) + 52) % 52 : null;
      const olds = [];
      this._bombs.forEach((el, k) => { if (+el.dataset.seat === s || k === rep) olds.push(k); });
      olds.forEach((k) => {
        const el = this._bombs.get(k);
        this._bombs.delete(k);
        if (!el) return;
        if (this.rm || this._noFx()) { el.remove(); return; }
        el.firstChild.animate([{ transform: 'scale(1) rotate(0)', opacity: 1 }, { transform: 'scale(.1) rotate(200deg)', opacity: 0 }], { duration: this._t(380), easing: 'ease-in', fill: 'forwards' }).finished.then(() => el.remove(), () => el.remove());
        const q = this._absCell(k), c = this._px(q[0], q[1]);
        this._burst(c[0], c[1], { n: 5, cls: 'lr-p-smoke', d0: 0.2, d1: 0.6, s0: 0.4, s1: 0.6, sc1: 1.5 });
      });
      st.bombs = (st.bombs || []).filter((b) => (b.seat | 0) !== s && !(rep != null && (((b.abs | 0) % 52) + 52) % 52 === rep));
      st.bombs.push({ seat: s, abs: a });
      const el = this._makeItem('bomb', a, s);
      this._bombs.set(a, el);
      if (this.rm || this._noFx()) return;
      const q = this._absCell(a), tc = this._px(q[0], q[1]);
      const pc = this._podPx(s, 'av');
      const kf = this._arcKf(pc, tc, this.L.cell * 3, 0.5, 1, 540, tc);
      await done(el.firstChild.animate(kf, { duration: this._t(600), easing: 'cubic-bezier(.45,.05,.7,1)' }));
      el.firstChild.animate([{ transform: 'scale(1.25,.72)' }, { transform: 'scale(.92,1.08)' }, { transform: 'scale(1)' }], { duration: this._t(260), easing: 'ease-out' });
      if (this.opts.sound) sfx('capture');
      this._ring(tc[0], tc[1] + this.L.cell * 0.2, { c: COLORS[s].base, size: 1, scale: 2 });
      this._burst(tc[0], tc[1] + this.L.cell * 0.25, { n: 6, cls: 'lr-p-smoke', a0: Math.PI * 0.9, a1: Math.PI * 2.1, d0: 0.4, d1: 0.8, s0: 0.3, s1: 0.5, sc1: 1.4 });
      await this._wait(260);
    },

    async frozen(e) {
      const st = this.ws, s = e.seat | 0, by = e.by == null ? null : e.by | 0;
      const pod = this.pods[s];
      if (this.opts.sound) sfx('freeze');
      if (pod && !this._noFx()) {
        const to = this._center(pod._p.avw);
        if (by != null && this.pods[by] && !this.rm) {
          const fr = this._center(this.pods[by]._p.avw);
          const dx = to[0] - fr[0], dy = to[1] - fr[1], len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
          const beam = this._fx('lr-beam', fr[0], fr[1], len, this.L.cell * 0.75);
          beam.style.left = fr[0] + 'px'; beam.style.top = (fr[1] - this.L.cell * 0.375) + 'px';
          beam.style.transform = 'rotate(' + ang + 'deg)';
          this._anim(beam, [{ transform: 'rotate(' + ang + 'deg) scaleX(0)', opacity: 1 }, { transform: 'rotate(' + ang + 'deg) scaleX(1)', opacity: 1, offset: 0.5 }, { transform: 'rotate(' + ang + 'deg) scaleX(1) scaleY(.2)', opacity: 0 }], 560, { easing: 'ease-out' });
          for (let j = 0; j < 12; j++) {
            const sz = this.L.cell * rand(0.45, 0.85);
            const f = this._fx('lr-p lr-p-snow', fr[0], fr[1], sz, sz);
            this._anim(f, [{ transform: 'translate(0,0) rotate(0) scale(.5)', opacity: 0 }, { transform: 'translate(' + (dx * 0.5 + rand(-1, 1) * this.L.cell) + 'px,' + (dy * 0.5 + rand(-1, 1) * this.L.cell) + 'px) rotate(180deg) scale(1)', opacity: 1, offset: 0.5 }, { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(360deg) scale(.6)', opacity: 0.2 }], 560, { delay: j * 32, easing: 'ease-in-out' });
          }
          await this._wait(500);
        }
        if (st.players[s]) st.players[s].frozen = true;
        this._renderPod(s);
        this._relayout(false);
        const c = this._center(pod._p.card);
        if (!this.rm) pod._p.frost.animate([{ opacity: 0, transform: 'scale(1.15)' }, { opacity: 1, transform: 'scale(1)' }], { duration: this._t(380), easing: 'ease-out' });
        this._burst(c[0], c[1], { n: 12, cls: 'lr-p-snow', d0: 1, d1: 2.4, s0: 0.3, s1: 0.55, t0: 600, t1: 950 });
        this._ring(to[0], to[1], { c: '#bdf0ff', size: 1.4, scale: 2.8 });
      } else if (st.players[s]) st.players[s].frozen = true;
      this._podToast(s, 'Frozen!', 'bad');
      this._renderPod(s);
      this._relayout(false);
      await this._wait(520);
    },

    async swapped(e) {
      const st = this.ws, s = e.seat | 0, i = e.token | 0, ts = e.target_seat | 0, ti = e.target_token | 0;
      const A = this.tok[s] && this.tok[s][i], B = this.tok[ts] && this.tok[ts][ti];
      const newA = isNum(e.abs_a) ? (((e.abs_a - s * 13) % 52) + 52) % 52 : st.tokens[s][i];
      const newB = isNum(e.abs_b) ? (((e.abs_b - ts * 13) % 52) + 52) % 52 : st.tokens[ts][ti];
      if (this.opts.sound) sfx('swap');
      if (A && B && !this.rm && !this._noFx()) {
        this._moving.add(A); this._moving.add(B);
        [A, B].forEach((x) => { x.classList.remove('lr-anim'); x.classList.add('lr-moving'); this._applyZ(x); });
        const pa = A._pos, pb = B._pos, mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        const N = 16, ka = [], kb = [], dur = this._t(720);
        for (let j = 0; j <= N; j++) {
          const t = j / N, th = Math.PI * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2), co = Math.cos(th), si = Math.sin(th);
          const lift = 1 + 0.35 * Math.sin(Math.PI * t);
          const ax = pa.x - mx, ay = pa.y - my, bx = pb.x - mx, by = pb.y - my;
          ka.push({ transform: T({ x: mx + ax * co - ay * si, y: my + ax * si + ay * co - 0.4 * Math.sin(Math.PI * t), s: pa.s * lift }), offset: t });
          kb.push({ transform: T({ x: mx + bx * co - by * si, y: my + bx * si + by * co - 0.4 * Math.sin(Math.PI * t), s: pb.s * lift }), offset: t });
        }
        A.style.transform = T({ x: pb.x, y: pb.y, s: pa.s }); B.style.transform = T({ x: pa.x, y: pa.y, s: pb.s });
        A._pos = { x: pb.x, y: pb.y, s: pa.s }; B._pos = { x: pa.x, y: pa.y, s: pb.s };
        const a1 = A.animate(ka, { duration: dur }), a2 = B.animate(kb, { duration: dur });
        A.firstChild.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-22deg)', offset: 0.3 }, { transform: 'rotate(18deg)', offset: 0.75 }, { transform: 'rotate(0)' }], { duration: dur, easing: 'ease-in-out' });
        B.firstChild.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(22deg)', offset: 0.3 }, { transform: 'rotate(-18deg)', offset: 0.75 }, { transform: 'rotate(0)' }], { duration: dur, easing: 'ease-in-out' });
        const m = this._px(mx, my - 0.2), rr = Math.hypot(pa.x - mx, pa.y - my) * this.L.cell;
        const sw = this._fx('lr-swirl', m[0], m[1], Math.max(rr * 2.25, this.L.cell * 2), Math.max(rr * 2.25, this.L.cell * 2));
        this._ring(this._px(pa.x, pa.y - 0.3)[0], this._px(pa.x, pa.y - 0.3)[1], { c: '#ff7ac8', size: 1, scale: 2.2 });
        this._ring(this._px(pb.x, pb.y - 0.3)[0], this._px(pb.x, pb.y - 0.3)[1], { c: '#c9a8ff', size: 1, scale: 2.2 });
        this._anim(sw, [{ transform: 'rotate(0deg) scale(.6)', opacity: 0 }, { transform: 'rotate(220deg) scale(1)', opacity: 1, offset: 0.5 }, { transform: 'rotate(420deg) scale(1.15)', opacity: 0 }], 760);
        for (let j = 1; j < 8; j++) {
          const t = j / 8, th = Math.PI * t;
          const ax = (pa.x - mx), ay = (pa.y - my);
          const p1 = this._px(mx + ax * Math.cos(th) - ay * Math.sin(th), my + ax * Math.sin(th) + ay * Math.cos(th) - 0.3);
          const p2 = this._px(mx - ax * Math.cos(th) + ay * Math.sin(th), my - ax * Math.sin(th) - ay * Math.cos(th) - 0.3);
          const sp = { n: 3, cls: 'lr-p-star', colors: ['#ff7ac8', '#fff', '#c9a8ff', '#ffd1ec'], d0: 0.15, d1: 0.55, s0: 0.2, s1: 0.36, t0: 500, t1: 800 };
          setTimeout(() => { this._burst(p1[0], p1[1], sp); this._burst(p2[0], p2[1], sp); }, dur * t);
        }
        await Promise.all([done(a1), done(a2)]);
        this._moving.delete(A); this._moving.delete(B);
        A.classList.remove('lr-moving'); B.classList.remove('lr-moving');
      }
      st.tokens[s][i] = newA;
      st.tokens[ts][ti] = newB;
      this._relayout(true);
      await this._wait(220);
    },

    async shield_expired(e) {
      const st = this.ws, s = e.seat | 0, i = e.token | 0;
      const el = this.tok[s] && this.tok[s][i];
      st.shields = (st.shields || []).filter((x) => !((x.seat | 0) === s && (x.token | 0) === i));
      if (el && el.classList.contains('lr-shielded') && !this._noFx()) {
        const c = this._tokPx(el);
        const sh = el.querySelector('.lr-tok-shield');
        if (sh && !this.rm) await done(sh.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.25)', opacity: 1, offset: 0.4 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: this._t(320), easing: 'ease-out', fill: 'forwards' }));
        this._burst(c[0], c[1], { n: 10, cls: 'lr-p-dot', colors: ['#bdf0ff', '#fff'], d0: 0.7, d1: 1.3, s0: 0.08, s1: 0.16 });
        if (sh) sh.getAnimations().forEach((x) => x.cancel());
      }
      this._syncShields();
      await this._wait(160);
    },

    async token_finished(e) {
      const st = this.ws, s = e.seat | 0, i = e.token | 0;
      if (st.tokens[s]) st.tokens[s][i] = 56;
      const pl = st.players[s];
      if (pl) pl.finished_tokens = (st.tokens[s] || []).filter((t) => t === 56).length;
      st.shields = (st.shields || []).filter((x) => !((x.seat | 0) === s && (x.token | 0) === i));
      this._syncShields();
      this._relayout(true);
      if (this.opts.sound) sfx('finish');
      const el = this.tok[s] && this.tok[s][i];
      const c = el ? this._tokPx(el) : this._px(7.5, 7.5);
      const g = this._px(7.5, 7.5);
      if (!this._noFx()) {
        const r = this._fx('lr-rays lr-rays-gold', g[0], g[1], this.L.cell * 4, this.L.cell * 4);
        this._anim(r, [{ transform: 'scale(.2) rotate(0deg)', opacity: 0 }, { transform: 'scale(1) rotate(45deg)', opacity: 1, offset: 0.3 }, { transform: 'scale(1.2) rotate(120deg)', opacity: 0 }], 1000);
        this._ring(g[0], g[1], { c: '#ffd34d', size: 1.2, scale: 3.4, dur: 640 });
        this._ring(g[0], g[1], { c: COLORS[s].base, size: 1, scale: 2.6, dur: 560, delay: 90 });
        this._burst(c[0], c[1], { n: 18, cls: 'lr-p-star', colors: ['#ffe066', '#fff', '#ffb703', COLORS[s].light], d0: 1, d1: 2.4, s0: 0.16, s1: 0.34, t0: 600, t1: 950 });
      }
      this._renderPod(s);
      if (s === this.viewSeat) setTimeout(() => this.flash('Home!', 'good', { hold: 600, y: 0.24 }), this._t(260));
      else this._podToast(s, 'Token home!', 'good');
      await this._wait(520);
    },

    async extra_turn(e) {
      const s = e.seat | 0;
      const rs = Array.isArray(e.reasons) ? e.reasons : [];
      const why = rs.map((r) => (r === 'six' ? 'rolled 6' : r === 'capture' ? 'capture' : r === 'finish' ? 'home' : '')).filter(Boolean).join(' + ');
      if (s === this.viewSeat) this.flash('Extra roll!', 'good', { hold: 650 });
      this._podToast(s, 'Extra roll' + (why ? ' · ' + why : ''), 'good');
      await this._wait(s === this.viewSeat ? 380 : 260);
    },

    async resigned(e) {
      const st = this.ws, s = e.seat | 0;
      if (st.players[s]) st.players[s].resigned = true;
      if (st.tokens[s]) st.tokens[s] = [-1, -1, -1, -1];
      st.shields = (st.shields || []).filter((x) => (x.seat | 0) !== s);
      st.bombs = (st.bombs || []).filter((b) => (b.seat | 0) !== s);
      this._bombs.forEach((el, k) => {
        if (+el.dataset.seat !== s) return;
        this._bombs.delete(k);
        if (this.rm || this._noFx()) { el.remove(); return; }
        el.firstChild.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.1) rotate(160deg)', opacity: 0 }], { duration: this._t(380), fill: 'forwards' }).finished.then(() => el.remove(), () => el.remove());
      });
      this._syncShields();
      this._renderPod(s);
      this._podToast(s, 'Resigned', 'bad');
      this.flash(this._name(s) + ' resigned', 'info', { hold: 700 });
      this._relayout(true);
      await this._wait(500);
    },

    async game_over(e) {
      const st = this.ws;
      st.status = 'finished';
      st.winner = e.winner == null ? null : e.winner | 0;
      if (Array.isArray(e.placements)) {
        st.placements = e.placements.slice();
        e.placements.forEach((seat, j) => { if (st.players[seat | 0]) st.players[seat | 0].placement = j + 1; });
      }
      for (let i = 0; i < 4; i++) this._renderPod(i);
      this._renderDice({});
      this._syncYardGlow();
      this.setTimer(null);
      if (st.winner != null) this.celebrate(st.winner);
      await this._wait(500);
    }
  };

  /* explosion (shared by bomb_triggered) */
  LudoRenderer.prototype._explosion = function (x, y, power) {
    if (this._noFx()) return;
    const c = this.L.cell, P = power || 1;
    const f = this._fx('lr-boom-flash', x, y, c * 5 * P, c * 5 * P);
    this._anim(f, [{ transform: 'scale(.1)', opacity: 1 }, { transform: 'scale(1)', opacity: 0.9, offset: 0.35 }, { transform: 'scale(1.2)', opacity: 0 }], 420);
    const fb = this._fx('lr-boom-fire', x, y, c * 2.8 * P, c * 2.8 * P);
    this._anim(fb, [{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.4 }, { transform: 'scale(1.5) translateY(-12%)', opacity: 0 }], 640);
    this._ring(x, y, { c: '#ffb347', size: 1.2, scale: 4 * P, dur: 560 });
    this._burst(x, y, { n: 14, cls: 'lr-p-debris', colors: ['#2a2f3a', '#4b5563', '#1f2430', '#ff8a00'], d0: 1.2, d1: 2.8 * P, s0: 0.12, s1: 0.26, grav: 1.2, t0: 560, t1: 900, sc0: 1, sc1: 0.6 });
    this._burst(x, y, { n: 14, cls: 'lr-p-dot', colors: ['#ffe066', '#ff9f1c', '#fff'], d0: 1.4, d1: 3 * P, s0: 0.1, s1: 0.2, t0: 380, t1: 640 });
    for (let i = 0; i < (this.rm ? 2 : 7); i++) {
      const sz = c * rand(1, 1.6) * P;
      const sm = this._fx('lr-p-smoke', x + rand(-0.6, 0.6) * c, y + rand(-0.4, 0.4) * c, sz, sz);
      this._anim(sm, [{ transform: 'scale(.4) translateY(0)', opacity: 0 }, { transform: 'scale(1.2) translateY(-30%)', opacity: 0.85, offset: 0.25 }, { transform: 'scale(2) translateY(-110%)', opacity: 0 }], rand(1000, 1400), { delay: 100 + i * 30 });
    }
    const sc = this._fx('lr-scorch', x, y + c * 0.15, c * 1.5, c * 1.05);
    this._anim(sc, [{ opacity: 0 }, { opacity: 0.9, offset: 0.1 }, { opacity: 0 }], 1800, { delay: 150 });
    this._shake(1.4 * P);
  };

  LudoRenderer.POWERUP_META = POWERUP_META;
  LudoRenderer.COLORS = COLORS.map((c) => ({ id: c.id, name: c.name, base: c.base, light: c.light, dark: c.dark }));
  LudoRenderer.GEOMETRY = GEO;
  LudoRenderer.SAFE_ABS = Array.from(SAFE);
  LudoRenderer.EVENT_TYPES = Object.keys(HANDLERS);
  LudoRenderer.VERSION = '1.0.0';
  window.LudoRenderer = LudoRenderer;
})();
