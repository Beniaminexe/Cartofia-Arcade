/* ==========================================================================
   Cartofia Ludo — synthesized sound effects (window.LudoSfx)
   Pure WebAudio, no audio files. The AudioContext is created lazily on the
   first play() after a user gesture, so nothing throws or warns before one.
   Mute state persists in localStorage under "ludo_muted".
   ========================================================================== */
(function () {
  'use strict';
  if (window.LudoSfx) return;

  var KEY = 'ludo_muted';
  var NAMES = ['roll', 'step', 'capture', 'finish', 'crate', 'power', 'freeze', 'bomb', 'shield',
    'swap', 'boost', 'win', 'lose', 'turn', 'tick', 'click', 'emote',
    'whoosh', 'splat', 'crack', 'splash', 'pop', 'chime', 'bonk', 'chat', 'prompt'];

  var ctx = null, master = null, noiseBuf = null;
  var gestured = false;
  var volume = 0.8;
  var lastAt = Object.create(null);
  var muted = readMuted();
  function applyGain() {
    if (!master || !ctx) return;
    var target = muted ? 0 : volume;
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(target, ctx.currentTime, 0.015);
    } catch (_) { master.gain.value = target; }
  }

  function readMuted() {
    try { return window.localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function writeMuted(v) {
    try { window.localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* private mode */ }
  }
  function hasGesture() {
    if (gestured) return true;
    try { return !!(navigator.userActivation && navigator.userActivation.hasBeenActive); } catch (e) { return false; }
  }

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') { try { ctx.resume().catch(function () {}); } catch (e) { /* ignore */ } }
      return ctx;
    }
    if (!hasGesture()) return null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.18;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(comp); comp.connect(ctx.destination);
      var len = Math.floor(ctx.sampleRate * 2.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; return null; }
    return ctx;
  }

  function onGesture() {
    gestured = true;
    if (!muted) ensure();
    if (ctx) {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      window.removeEventListener('touchend', onGesture, true);
    }
  }
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  window.addEventListener('touchend', onGesture, true);

  /* ---------- building blocks ---------- */
  function out(pan) {
    if (pan && ctx.createStereoPanner) {
      var p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(master); return p;
    }
    return master;
  }
  function env(g, t, a, peak, dur, curve) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (curve === 'lin') g.gain.linearRampToValueAtTime(0.0001, t + dur);
    else g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  /* tone: oscillator with optional pitch glide */
  function tone(o) {
    var t = o.t, dur = o.dur || 0.2;
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.glide || dur));
    if (o.detune) osc.detune.value = o.detune;
    var g = ctx.createGain();
    env(g, t, o.a || 0.005, o.g || 0.2, dur, o.curve);
    var node = osc;
    if (o.lp) { var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 0.7; osc.connect(f); node = f; }
    node.connect(g); g.connect(o.dest || out(o.pan));
    if (o.vib) {
      var lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = o.vib[0]; lg.gain.value = o.vib[1];
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    osc.start(t); osc.stop(t + dur + 0.05);
    return osc;
  }
  /* noise: filtered white noise burst with optional filter sweep */
  function noise(o) {
    var t = o.t, dur = o.dur || 0.2;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = o.rate || 1;
    var f = ctx.createBiquadFilter();
    f.type = o.ft || 'bandpass';
    f.frequency.setValueAtTime(o.f0 || 1000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.sweep || dur));
    f.Q.value = o.q == null ? 1 : o.q;
    var g = ctx.createGain();
    env(g, t, o.a || 0.003, o.g || 0.3, dur, o.curve);
    src.connect(f); f.connect(g); g.connect(o.dest || out(o.pan));
    var off = Math.random() * 0.5;
    src.start(t, off, dur + 0.1);
    return src;
  }
  function bell(t, f, g, dur) {
    tone({ t: t, f0: f, g: g, dur: dur, a: 0.004 });
    tone({ t: t, f0: f * 2.01, g: g * 0.32, dur: dur * 0.55, a: 0.004 });
    tone({ t: t, f0: f * 3.98, g: g * 0.12, dur: dur * 0.3, a: 0.003 });
  }

  /* ---------- the sound library ---------- */
  var LIB = {
    roll: function (t) {
      var n = 9;
      for (var i = 0; i < n; i++) {
        var tt = t + i * 0.048 + Math.random() * 0.018;
        var gg = 0.32 * (1 - i / (n + 2));
        noise({ t: tt, dur: 0.035, f0: 2200 + Math.random() * 2200, q: 3.5, g: gg, pan: (Math.random() - 0.5) * 0.6 });
        tone({ t: tt, f0: 700 + Math.random() * 900, f1: 380, dur: 0.03, type: 'triangle', g: gg * 0.35 });
      }
      tone({ t: t + 0.47, f0: 210, f1: 90, dur: 0.1, g: 0.35 });
      noise({ t: t + 0.47, dur: 0.06, f0: 1800, q: 2, g: 0.25 });
    },
    step: function (t, o) {
      var i = (o && o.i) || 0;
      var f = 560 + (i % 7) * 45;
      tone({ t: t, f0: f, f1: f * 0.72, dur: 0.07, type: 'triangle', g: 0.2 });
      noise({ t: t, dur: 0.02, f0: 5200, q: 2, g: 0.06 });
    },
    capture: function (t) {
      tone({ t: t, f0: 150, f1: 42, dur: 0.38, g: 0.75 });
      noise({ t: t, dur: 0.3, ft: 'lowpass', f0: 2400, f1: 160, q: 0.8, g: 0.6 });
      tone({ t: t, f0: 340, f1: 110, dur: 0.09, type: 'square', g: 0.12, lp: 1800 });
      noise({ t: t + 0.05, dur: 0.12, f0: 3200, q: 1.5, g: 0.16 });
    },
    finish: function (t) {
      [1046.5, 1318.5, 1568, 2093].forEach(function (f, i) { bell(t + i * 0.085, f, 0.2, 0.75); });
      tone({ t: t + 0.34, f0: 2637, g: 0.06, dur: 0.9 });
    },
    crate: function (t, o) {
      var s = (o && o.soft) ? 0.45 : 1;
      noise({ t: t, dur: 0.07, f0: 900, q: 1.2, g: 0.5 * s });
      tone({ t: t, f0: 520, f1: 1500, dur: 0.16, g: 0.2 * s, glide: 0.12 });
      if (!(o && o.soft)) {
        [2093, 2637, 3136, 4186].forEach(function (f, i) { bell(t + 0.08 + i * 0.055, f, 0.07, 0.35); });
      }
    },
    power: function (t) {
      noise({ t: t, dur: 0.5, f0: 350, f1: 4200, sweep: 0.42, q: 2.2, g: 0.45, a: 0.06, curve: 'lin' });
      tone({ t: t, f0: 300, f1: 950, dur: 0.42, g: 0.1, a: 0.05, type: 'triangle' });
      bell(t + 0.32, 1760, 0.08, 0.4);
    },
    freeze: function (t) {
      for (var i = 0; i < 7; i++) {
        bell(t + i * 0.05, 3000 - i * 230 + Math.random() * 80, 0.06, 0.45);
      }
      noise({ t: t, dur: 0.7, ft: 'highpass', f0: 5500, q: 0.6, g: 0.14, a: 0.05 });
      tone({ t: t, f0: 1200, f1: 420, dur: 0.6, g: 0.06, vib: [11, 30] });
    },
    bomb: function (t) {
      tone({ t: t, f0: 95, f1: 26, dur: 1.15, g: 0.95, glide: 0.9 });
      noise({ t: t, dur: 1.1, ft: 'lowpass', f0: 3600, f1: 70, q: 0.6, g: 0.95, sweep: 0.95 });
      noise({ t: t + 0.03, dur: 0.35, f0: 500, q: 0.8, g: 0.35 });
      for (var i = 0; i < 5; i++) noise({ t: t + 0.15 + Math.random() * 0.5, dur: 0.05, f0: 2500, q: 3, g: 0.08 });
    },
    shield: function (t) {
      tone({ t: t, f0: 330, dur: 0.75, g: 0.12, a: 0.14, curve: 'lin' });
      tone({ t: t, f0: 331.8, dur: 0.75, g: 0.12, a: 0.14, curve: 'lin' });
      tone({ t: t, f0: 660, dur: 0.6, g: 0.06, a: 0.12, type: 'triangle' });
      bell(t + 0.05, 1760, 0.12, 0.5);
      bell(t + 0.12, 2637, 0.05, 0.4);
    },
    swap: function (t) {
      tone({ t: t, f0: 300, f1: 1300, dur: 0.38, g: 0.13, pan: -0.6, a: 0.04 });
      tone({ t: t, f0: 1300, f1: 300, dur: 0.38, g: 0.13, pan: 0.6, a: 0.04 });
      noise({ t: t, dur: 0.42, f0: 2600, f1: 500, q: 1.6, g: 0.28, a: 0.06, curve: 'lin' });
    },
    boost: function (t) {
      noise({ t: t, dur: 0.75, ft: 'lowpass', f0: 380, f1: 3200, sweep: 0.55, q: 1.2, g: 0.65, a: 0.06, curve: 'lin' });
      tone({ t: t, f0: 70, f1: 230, dur: 0.7, type: 'sawtooth', g: 0.13, lp: 900, a: 0.05 });
      tone({ t: t + 0.1, f0: 140, f1: 460, dur: 0.55, type: 'sawtooth', g: 0.06, lp: 1400 });
    },
    win: function (t) {
      var v = function (tt, f, d, g) {
        tone({ t: tt, f0: f, dur: d, type: 'sawtooth', g: g, lp: 2600, a: 0.012 });
        tone({ t: tt, f0: f * 1.003, dur: d, type: 'square', g: g * 0.35, lp: 1800, a: 0.012 });
      };
      v(t, 392, 0.14, 0.1); v(t + 0.13, 523.25, 0.14, 0.1); v(t + 0.26, 659.25, 0.14, 0.1);
      v(t + 0.39, 783.99, 0.3, 0.11);
      v(t + 0.62, 659.25, 0.13, 0.09); v(t + 0.74, 783.99, 0.9, 0.1);
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f) { v(t + 0.74, f, 1.0, 0.055); });
      [2093, 2637, 3136].forEach(function (f, i) { bell(t + 0.8 + i * 0.07, f, 0.05, 0.6); });
    },
    lose: function (t) {
      [392, 369.99, 349.23, 293.66].forEach(function (f, i) {
        var last = i === 3;
        tone({ t: t + i * 0.3, f0: f, dur: last ? 0.8 : 0.28, type: 'sawtooth', g: 0.1, lp: 1100, a: 0.02, vib: last ? [5.5, 7] : null, curve: 'lin' });
      });
    },
    turn: function (t) {
      bell(t, 1318.5, 0.2, 0.7);
      bell(t + 0.11, 1975.5, 0.14, 0.7);
    },
    tick: function (t) {
      tone({ t: t, f0: 1850, dur: 0.03, type: 'square', g: 0.06, lp: 5000 });
      noise({ t: t, dur: 0.015, f0: 6000, q: 2, g: 0.05 });
    },
    click: function (t) {
      tone({ t: t, f0: 1150, f1: 850, dur: 0.04, type: 'triangle', g: 0.14 });
    },
    emote: function (t) {
      tone({ t: t, f0: 420, f1: 900, dur: 0.12, g: 0.16, glide: 0.1 });
      tone({ t: t + 0.09, f0: 880, f1: 1320, dur: 0.11, g: 0.1, glide: 0.08 });
    },
    /* throwables + social */
    whoosh: function (t) {
      noise({ t: t, dur: 0.42, f0: 500, f1: 2600, sweep: 0.38, q: 1.4, g: 0.22, a: 0.08, curve: 'lin' });
    },
    splat: function (t) {
      noise({ t: t, dur: 0.22, ft: 'lowpass', f0: 1800, f1: 240, q: 1.2, g: 0.7 });
      tone({ t: t, f0: 180, f1: 60, dur: 0.18, g: 0.4 });
      for (var i = 0; i < 4; i++) noise({ t: t + 0.08 + i * 0.05 + Math.random() * 0.03, dur: 0.04, f0: 900 + Math.random() * 600, q: 4, g: 0.12 });
    },
    crack: function (t) {
      noise({ t: t, dur: 0.05, f0: 4200, q: 3, g: 0.45 });
      noise({ t: t + 0.03, dur: 0.04, f0: 3000, q: 3, g: 0.3 });
      noise({ t: t + 0.07, dur: 0.18, ft: 'lowpass', f0: 1400, f1: 300, q: 1, g: 0.4 });
    },
    splash: function (t) {
      noise({ t: t, dur: 0.5, f0: 2600, f1: 700, sweep: 0.45, q: 0.9, g: 0.55 });
      tone({ t: t, f0: 520, f1: 160, dur: 0.22, g: 0.15 });
      for (var i = 0; i < 6; i++) tone({ t: t + 0.12 + Math.random() * 0.35, f0: 900 + Math.random() * 900, f1: 1800, dur: 0.05, g: 0.05, glide: 0.04 });
    },
    pop: function (t) {
      noise({ t: t, dur: 0.06, f0: 1800, q: 1.2, g: 0.6 });
      tone({ t: t, f0: 300, f1: 900, dur: 0.08, g: 0.2, glide: 0.06 });
      [1568, 2093, 2637].forEach(function (f, i) { bell(t + 0.06 + i * 0.05, f, 0.06, 0.3); });
    },
    chime: function (t) {
      [880, 1108.7, 1318.5, 1760].forEach(function (f, i) { bell(t + i * 0.09, f, 0.11, 0.9); });
    },
    bonk: function (t) {
      tone({ t: t, f0: 260, f1: 120, dur: 0.16, type: 'triangle', g: 0.55 });
      tone({ t: t, f0: 780, f1: 300, dur: 0.06, type: 'square', g: 0.08, lp: 2000 });
      noise({ t: t, dur: 0.05, f0: 1500, q: 2, g: 0.25 });
      tone({ t: t + 0.12, f0: 1400, f1: 900, dur: 0.3, g: 0.05, vib: [14, 40] });
    },
    chat: function (t) {
      tone({ t: t, f0: 990, dur: 0.07, g: 0.09, type: 'triangle' });
      tone({ t: t + 0.07, f0: 1320, dur: 0.09, g: 0.07, type: 'triangle' });
    },
    prompt: function (t) {
      bell(t, 784, 0.16, 0.6); bell(t + 0.14, 1046.5, 0.16, 0.6); bell(t + 0.28, 1318.5, 0.14, 0.8);
    }
  };
  var MIN_GAP = { step: 0.035, tick: 0.2, click: 0.03 };

  function play(name, opts) {
    try {
      if (muted || !LIB[name]) return false;
      if (!ensure()) return false;
      if (ctx.state !== 'running' && ctx.state !== 'suspended') return false;
      var now = ctx.currentTime;
      var gap = MIN_GAP[name] || 0.05;
      if (lastAt[name] != null && now - lastAt[name] < gap) return false;
      lastAt[name] = now;
      LIB[name](now + 0.01, opts || {});
      return true;
    } catch (e) {
      return false;
    }
  }

  var api = {
    names: NAMES.slice(),
    play: play,
    setMuted: function (v) {
      muted = !!v; writeMuted(muted);
      if (!muted && hasGesture()) ensure();
      applyGain();
      return muted;
    },
    toggle: function () { return api.setMuted(!muted); },
    setVolume: function (v) {
      volume = Math.max(0, Math.min(1, +v || 0));
      applyGain();
    },
    unlock: function () { gestured = true; return !!ensure(); }
  };
  Object.defineProperty(api, 'muted', {
    get: function () { return muted; },
    set: function (v) { api.setMuted(v); },
    enumerable: true
  });
  window.LudoSfx = api;
})();
