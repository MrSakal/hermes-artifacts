/* The score (sound.md): S records notes, drums and effects against the film's timeline; this file
   synthesizes them on WebAudio, live against the playhead (with seeking) and offline for Export.
   window.MotionSound = { build(fns, T, end, map), Live(score), render(score, seconds, rate) }. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ the record
  var NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  function midiOf(p) {
    if (typeof p === "number") return p;
    var m = /^([A-Ga-g])([#b]*)(-?\d)$/.exec(String(p).trim());
    if (!m) return 60;
    var n = NOTE[m[1].toLowerCase()];
    for (var i = 0; i < m[2].length; i++) n += m[2][i] === "#" ? 1 : -1;
    return n + (parseInt(m[3], 10) + 1) * 12;
  }
  function hz(p) { return 440 * Math.pow(2, (midiOf(p) - 69) / 12); }
  var PATCHES = ["marimba", "vibes", "glock", "ep", "keys", "pluck", "bass", "pad"];

  /** Run the score functions; returns {events, programs, master, end}. map(t) turns film seconds into
   *  played seconds (a scene recut by hand plays slower or faster). */
  function build(fns, T, end, map) {
    map = map || function (t) { return t; };
    var bpm = 120, t0 = 0, programs = {}, events = [], master = { gain: 0, fadeOut: 0 };
    function spb() { return 60 / bpm; }
    function beatT(b) { return t0 + b * spb(); }
    function when(o, defBeats) {
      o = o || {};
      if (o.t != null) return [+o.t, o.dur != null ? +o.dur : (o.beats != null ? o.beats * spb() : (defBeats || 1) * spb())];
      if (o.beat != null) return [beatT(+o.beat), (o.beats != null ? +o.beats : (defBeats || 1)) * spb()];
      return [0, o.dur != null ? +o.dur : (defBeats || 1) * spb()];
    }
    function push(ev) {
      if (!(ev.t >= -0.1) || !isFinite(ev.t)) return;   // an event 0.1 s or more before 0 is dropped
      ev.t = Math.max(0, ev.t);
      var a = map(ev.t), b = ev.dur != null ? map(ev.t + ev.dur) : null;
      ev.t = a; if (b != null) ev.dur = Math.max(0.02, b - a);
      events.push(ev);
    }
    function patchOf(track) {
      var p = programs[track];
      return p ? p.patch : (PATCHES.indexOf(track) >= 0 ? track : "keys");
    }
    function note(track, pitch, o) {
      var w = when(o, 1);
      push({ type: "note", track: track, patch: patchOf(track), t: w[0], dur: w[1], freq: hz(pitch), vel: o && o.vel != null ? +o.vel : 80 });
    }
    function hits(str, o, fn) {
      o = o || {}; str = String(str || "");
      var stepB = o.step || 0.5, from = o.from || 0, rep = Math.max(1, o.repeat || 1), k = 0;
      for (var r = 0; r < rep; r++) {
        for (var i = 0; i < str.length; i++) {
          var c = str[i];
          if (c !== "x" && c !== "X" && c !== "o") continue;
          var vel = (o.vel != null ? +o.vel : 90) * (c === "X" ? 1.25 : c === "o" ? 0.45 : 1);
          fn(beatT(from + (r * str.length + i) * stepB), Math.min(127, vel), stepB * spb(), k++);
        }
      }
    }
    var S = {
      tempo: function (b, o) { bpm = +b || 120; t0 = o && o.t0 != null ? +o.t0 : 0; },
      beat: function (n) { return beatT(+n || 0); },
      program: function (track, patch, o) {
        o = o || {};
        programs[track] = { patch: PATCHES.indexOf(patch) >= 0 ? patch : "keys", pan: +o.pan || 0, gain: +o.gain || 0,
          rev: o.rev == null ? 0.2 : +o.rev, bright: o.bright == null ? 0.5 : +o.bright };
      },
      note: note,
      chord: function (track, pitches, o) { (pitches || []).forEach(function (p) { note(track, p, o); }); },
      pattern: function (track, str, o) {
        var pitch = [].concat((o && o.pitch) || ["C4"]);
        hits(str, o, function (t, vel, d, k) {
          push({ type: "note", track: track, patch: patchOf(track), t: t, dur: d, freq: hz(pitch[k % pitch.length]), vel: vel });
        });
      },
      drums: function (map2, o) {
        Object.keys(map2 || {}).forEach(function (name) {
          hits(map2[name], o, function (t, vel) { push({ type: "drum", name: name, t: t, vel: vel, pan: o && o.pan || 0 }); });
        });
      },
      drum: function (name, o) { var w = when(o, 0.25); push({ type: "drum", name: name, t: w[0], vel: o && o.vel != null ? +o.vel : 90, pan: o && o.pan || 0 }); },
      run: function (track, pitches, o) {
        o = o || {};
        var start = o.t != null ? +o.t : beatT(o.beat || 0), stepS = o.t != null ? (o.step || 0.08) : (o.step || 0.25) * spb();
        var v0 = o.vel != null ? +o.vel : 70, n = (pitches || []).length;
        (pitches || []).forEach(function (p, i) {
          var vel = Math.max(1, Math.min(127, v0 + (o.cresc || 0) * (n > 1 ? i / (n - 1) : 0)));
          push({ type: "note", track: track, patch: patchOf(track), t: start + i * stepS, dur: Math.max(stepS * 1.5, 0.15), freq: hz(p), vel: vel });
        });
      },
      ticks: function (times, o) { (times || []).forEach(function (t) { push({ type: "fx", name: "tick", t: +t, vel: o && o.vel != null ? +o.vel : 70 }); }); },
      fx: function (name, t, o) {
        o = o || {};
        push({ type: "fx", name: String(name), t: +t, dur: o.dur != null ? +o.dur : null, vel: o.vel != null ? +o.vel : 90,
          pitch: o.pitch != null ? +o.pitch : 0, pan: +o.pan || 0, into: !!o.into });
      },
      master: function (o) { o = o || {}; if (o.gain != null) master.gain = +o.gain; if (o.fadeOut != null) master.fadeOut = +o.fadeOut; }
    };
    (fns || []).forEach(function (fn) { try { fn(S, T); } catch (e) { console.error("score:", e); } });
    // revswell swells INTO its t: it starts dur earlier.
    events.forEach(function (e) { if (e.type === "fx" && e.name === "revswell") { var d = e.dur || 1; e.t0 = e.t - d; } });
    events.sort(function (a, b) { return (a.t0 != null ? a.t0 : a.t) - (b.t0 != null ? b.t0 : b.t); });
    return { events: events, programs: programs, master: master, end: map(end) };
  }

  // ------------------------------------------------------------------ the synth
  function db(x) { return Math.pow(10, (x || 0) / 20); }
  function amp(vel) { return Math.pow(Math.max(0, Math.min(127, vel)) / 127, 1.5) * 0.55; }
  var NOISE = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function noiseBuf(c) {
    var b = NOISE && NOISE.get(c);
    if (b) return b;
    var n = c.sampleRate * 2, seed = 12345;
    b = c.createBuffer(1, n, c.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < n; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = seed / 2147483648 - 1; }
    if (NOISE) NOISE.set(c, b);
    return b;
  }
  // The reverb's impulse, made once per context (every play and seek builds a new graph on it).
  var IMPULSE = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function impulse(c) {
    var b = IMPULSE && IMPULSE.get(c);
    if (b) return b;
    var len = Math.floor(c.sampleRate * 2.4), seed = 777;
    b = c.createBuffer(2, len, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch);
      for (var i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = (seed / 2147483648 - 1) * Math.pow(1 - i / len, 2.6); }
    }
    if (IMPULSE) IMPULSE.set(c, b);
    return b;
  }

  /** A graph on context c whose output goes to dest: tracks, a reverb, effects and drums. */
  function Graph(c, dest, score) {
    var rev = c.createConvolver(); rev.buffer = impulse(c);
    var wet = c.createGain(); wet.gain.value = 0.55; rev.connect(wet); wet.connect(dest);
    var tracks = {};
    function track(name) {
      if (tracks[name]) return tracks[name];
      var p = score.programs[name] || { pan: 0, gain: 0, rev: 0.2, bright: 0.5 };
      var g = c.createGain(); g.gain.value = db(p.gain);
      var out = g;
      if (c.createStereoPanner) { var pn = c.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, p.pan || 0)); g.connect(pn); out = pn; }
      out.connect(dest);
      var send = c.createGain(); send.gain.value = Math.max(0, Math.min(1, p.rev)); out.connect(send); send.connect(rev);
      return (tracks[name] = { input: g, bright: p.bright });
    }
    var bus = c.createGain(); bus.connect(dest);
    var busRev = c.createGain(); busRev.gain.value = 0.18; bus.connect(busRev); busRev.connect(rev);
    function panned(pan) {
      if (!pan || !c.createStereoPanner) return bus;
      var p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(bus); return p;
    }

    function osc(type, f, when, end) {
      var o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, when); o.start(when); o.stop(end + 0.05); return o;
    }
    function env(when, peak, a, tau, end, rel) {
      var g = c.createGain(), gg = g.gain;
      gg.setValueAtTime(0, when); gg.linearRampToValueAtTime(peak, when + a);
      if (tau) gg.setTargetAtTime(0, when + a, tau);
      if (end != null) { gg.setTargetAtTime(0, Math.max(when + a, end), rel || 0.05); }
      return g;
    }
    function noise(when, dur) {
      var s = c.createBufferSource(); s.buffer = noiseBuf(c); s.loop = true;
      s.start(when, (when * 7.31) % 1.5); s.stop(when + dur + 0.05); return s;
    }
    function filt(type, f, q) { var b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
    function chain() { for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); return arguments[arguments.length - 1]; }

    // ---- pitched patches: (when, f, dur, a, out, bright, off) ----
    var P = {
      marimba: function (w, f, d, a, out) {
        [[1, 1, 0.42], [4, 0.28, 0.12], [10, 0.06, 0.04]].forEach(function (p) {
          chain(osc("sine", f * p[0], w, w + 1.6), env(w, a * p[1], 0.003, p[2], null), out);
        });
      },
      vibes: function (w, f, d, a, out) {
        var trem = c.createGain(); trem.gain.value = 1;
        var lfo = osc("sine", 5.4, w, w + d + 2), depth = c.createGain(); depth.gain.value = 0.25; lfo.connect(depth); depth.connect(trem.gain);
        [[1, 1, 1.4], [4, 0.22, 0.25]].forEach(function (p) { chain(osc("sine", f * p[0], w, w + d + 2), env(w, a * p[1], 0.004, p[2], w + d + 0.3, 0.4), trem); });
        trem.connect(out);
      },
      glock: function (w, f, d, a, out) {
        [[1, 1, 1.1], [2.76, 0.4, 0.5], [5.4, 0.2, 0.25], [8.93, 0.1, 0.12]].forEach(function (p) {
          chain(osc("sine", f * p[0], w, w + 2.5), env(w, a * p[1] * 0.8, 0.002, p[2], null), out);
        });
      },
      ep: function (w, f, d, a, out) {
        var car = osc("sine", f, w, w + d + 1.5), mod = osc("sine", f, w, w + d + 1.5), mg = c.createGain();
        mg.gain.setValueAtTime(f * 2.2, w); mg.gain.setTargetAtTime(f * 0.35, w, 0.25);
        mod.connect(mg); mg.connect(car.frequency);
        chain(car, env(w, a * 0.9, 0.006, 1.3, w + d, 0.25), out);
        chain(osc("sine", f * 14, w, w + 0.3), env(w, a * 0.06, 0.001, 0.04, null), out);
      },
      keys: function (w, f, d, a, out, br) {
        var lp = filt("lowpass", 900 + 2600 * br, 0.6);
        lp.frequency.setValueAtTime(1200 + 3600 * br, w); lp.frequency.setTargetAtTime(700 + 900 * br, w, 0.4);
        var g = env(w, a * 0.55, 0.004, 1.1, w + d, 0.18);
        chain(osc("triangle", f, w, w + d + 1), g); chain(osc("sawtooth", f * 1.003, w, w + d + 1), lp); chain(osc("sine", f * 2, w, w + d + 1), g);
        lp.connect(g); g.connect(out);
      },
      pluck: function (w, f, d, a, out, br) {
        var lp = filt("lowpass", 300, 2.5);
        lp.frequency.setValueAtTime(2500 + 4000 * br, w); lp.frequency.setTargetAtTime(280, w, 0.08);
        chain(osc("sawtooth", f, w, w + 1.2), lp, env(w, a * 0.8, 0.002, 0.32, null), out);
      },
      bass: function (w, f, d, a, out) {
        var lp = filt("lowpass", 650, 0.9), g = env(w, a * 0.95, 0.008, 0, w + d, 0.08);
        g.gain.setTargetAtTime(a * 0.7, w + 0.01, 0.2);
        chain(osc("sine", f, w, w + d + 0.5), g); chain(osc("triangle", f, w, w + d + 0.5), lp, g);
        g.connect(out);
      },
      pad: function (w, f, d, a, out, br, off) {
        var lp = filt("lowpass", 700 + 1400 * br, 0.5), att = Math.min(0.6, Math.max(0.05, d * 0.3));
        var g = c.createGain(), gg = g.gain, end = w + d;
        if (off > 0) { gg.setValueAtTime(a * 0.45 * Math.min(1, off / att), w); gg.linearRampToValueAtTime(a * 0.45, w + Math.max(0.01, att - off)); }
        else { gg.setValueAtTime(0, w); gg.linearRampToValueAtTime(a * 0.45, w + att); }
        gg.setTargetAtTime(0, end, 0.35);
        [-9, 0, 8].forEach(function (cents) { var o = osc("sawtooth", f, w, end + 2); o.detune.value = cents; o.connect(lp); });
        var sub = osc("sine", f / 2, w, end + 2), sg = c.createGain(); sg.gain.value = 0.5; sub.connect(sg); sg.connect(g);
        lp.connect(g); g.connect(out);
      }
    };

    // ---- drums: (when, a, out) ----
    var D = {
      kick: function (w, a, out) { var o = osc("sine", 150, w, w + 0.5); o.frequency.exponentialRampToValueAtTime(42, w + 0.18); chain(o, env(w, a * 1.4, 0.002, 0.13, null), out); },
      snare: function (w, a, out) {
        chain(noise(w, 0.3), filt("bandpass", 2400, 0.7), env(w, a * 0.9, 0.001, 0.07, null), out);
        var o = osc("triangle", 190, w, w + 0.2); o.frequency.exponentialRampToValueAtTime(140, w + 0.1); chain(o, env(w, a * 0.6, 0.001, 0.05, null), out);
      },
      clap: function (w, a, out) {
        [0, 0.011, 0.023].forEach(function (dt, i) { chain(noise(w + dt, i === 2 ? 0.3 : 0.03), filt("bandpass", 1300, 1.2), env(w + dt, a * 0.9, 0.001, i === 2 ? 0.09 : 0.008, null), out); });
      },
      sidestick: function (w, a, out) { chain(osc("triangle", 1700, w, w + 0.06), env(w, a * 0.6, 0.0005, 0.012, null), out); chain(noise(w, 0.03), filt("highpass", 3000), env(w, a * 0.3, 0.0005, 0.008, null), out); },
      hat: function (w, a, out) { chain(noise(w, 0.1), filt("highpass", 7500, 0.8), env(w, a * 0.45, 0.001, 0.022, null), out); },
      openhat: function (w, a, out) { chain(noise(w, 0.5), filt("highpass", 7000, 0.8), env(w, a * 0.4, 0.002, 0.13, null), out); },
      shaker: function (w, a, out) { var g = c.createGain(), gg = g.gain; gg.setValueAtTime(0, w); gg.linearRampToValueAtTime(a * 0.3, w + 0.03); gg.setTargetAtTime(0, w + 0.04, 0.03); chain(noise(w, 0.15), filt("bandpass", 6500, 1.4), g, out); },
      tamb: function (w, a, out) { chain(noise(w, 0.3), filt("highpass", 6500), env(w, a * 0.4, 0.001, 0.07, null), out); chain(osc("square", 5100, w, w + 0.2), filt("bandpass", 5100, 8), env(w, a * 0.05, 0.001, 0.06, null), out); },
      woodblock: function (w, a, out) { var o = osc("sine", 820, w, w + 0.15); o.frequency.exponentialRampToValueAtTime(760, w + 0.05); chain(o, env(w, a * 0.8, 0.001, 0.03, null), out); },
      cowbell: function (w, a, out) { var b = filt("bandpass", 650, 2), g = env(w, a * 0.35, 0.001, 0.12, null); osc("square", 540, w, w + 0.5).connect(b); osc("square", 800, w, w + 0.5).connect(b); chain(b, g, out); },
      tom: function (w, a, out) { var o = osc("sine", 130, w, w + 0.5); o.frequency.exponentialRampToValueAtTime(82, w + 0.25); chain(o, env(w, a * 1.0, 0.002, 0.16, null), out); },
      crash: function (w, a, out) { chain(noise(w, 2.2), filt("highpass", 3800, 0.5), env(w, a * 0.42, 0.002, 0.6, null), out); },
      ride: function (w, a, out) {
        chain(noise(w, 1.4), filt("highpass", 6000, 0.6), env(w, a * 0.18, 0.001, 0.35, null), out);
        var b = filt("bandpass", 4200, 6), g = env(w, a * 0.08, 0.001, 0.4, null); osc("square", 3300, w, w + 1).connect(b); osc("square", 4870, w, w + 1).connect(b); chain(b, g, out);
      }
    };

    // ---- effects: (ev, when, a, out) ----
    var F = {
      tick: function (e, w, a, out) { chain(osc("square", 3200 * Math.pow(2, e.pitch / 12), w, w + 0.03), filt("bandpass", 3200, 3), env(w, a * 0.5, 0.0005, 0.006, null), out); },
      click: function (e, w, a, out) { chain(noise(w, 0.02), filt("bandpass", 2200 * Math.pow(2, e.pitch / 12), 2), env(w, a * 0.9, 0.0005, 0.005, null), out); chain(osc("sine", 1800, w, w + 0.03), env(w, a * 0.3, 0.0005, 0.006, null), out); },
      doubleclick: function (e, w, a, out) { F.click(e, w, a, out); F.click(e, w + 0.085, a * 0.9, out); },
      pop: function (e, w, a, out) { var o = osc("sine", 380 * Math.pow(2, e.pitch / 12), w, w + 0.15); o.frequency.exponentialRampToValueAtTime(980 * Math.pow(2, e.pitch / 12), w + 0.05); chain(o, env(w, a * 0.8, 0.002, 0.025, null), out); },
      ding: function (e, w, a, out) { var f = 1318.5 * Math.pow(2, e.pitch / 12); [[1, 1, 0.8], [2.0, 0.3, 0.4], [3.01, 0.12, 0.2]].forEach(function (p) { chain(osc("sine", f * p[0], w, w + 3), env(w, a * 0.5 * p[1], 0.002, p[2], null), out); }); },
      chime: function (e, w, a, out) {
        var base = 72 + (e.pitch || 0);
        [0, 4, 7, 12].forEach(function (iv, i) { var f = 440 * Math.pow(2, (base + iv - 69) / 12), t = w + i * 0.07; [[1, 1, 1.1], [2.76, 0.25, 0.35]].forEach(function (p) { chain(osc("sine", f * p[0], t, t + 3), env(t, a * 0.3 * p[1], 0.002, p[2], null), out); }); });
      },
      sparkle: function (e, w, a, out) {
        var d = e.dur || 0.6, n = Math.max(5, Math.round(d * 16)), s = 99 + Math.round(e.t * 100);
        for (var i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; var t = w + d * i / n, f = 2000 + (s % 3000) * Math.pow(2, e.pitch / 12); chain(osc("sine", f, t, t + 0.3), env(t, a * 0.18 * (1 - i / n * 0.5), 0.001, 0.05, null), out); }
      },
      whoosh: function (e, w, a, out) {
        var d = e.dur || 0.6, bp = filt("bandpass", 400, 1.4), g = c.createGain(), gg = g.gain, fr = bp.frequency;
        if (e.into) { fr.setValueAtTime(3500, w); fr.exponentialRampToValueAtTime(300, w + d); gg.setValueAtTime(0, w); gg.linearRampToValueAtTime(a * 0.7, w + d * 0.85); gg.linearRampToValueAtTime(0, w + d); }
        else { fr.setValueAtTime(300, w); fr.exponentialRampToValueAtTime(3500, w + d * 0.5); fr.exponentialRampToValueAtTime(900, w + d); gg.setValueAtTime(0, w); gg.linearRampToValueAtTime(a * 0.7, w + d * 0.35); gg.linearRampToValueAtTime(0, w + d); }
        chain(noise(w, d), bp, g, out);
      },
      revswell: function (e, w, a, out) {
        var d = e.dur || 1, s = w - d, g = c.createGain(), gg = g.gain, lp = filt("lowpass", 300, 0.8);
        gg.setValueAtTime(0.0001, Math.max(0, s)); gg.exponentialRampToValueAtTime(a * 0.6, w); gg.linearRampToValueAtTime(0, w + 0.03);
        lp.frequency.setValueAtTime(300, Math.max(0, s)); lp.frequency.exponentialRampToValueAtTime(6000, w);
        chain(noise(Math.max(0, s), d), lp, g, out);
        var o = osc("sawtooth", 220 * Math.pow(2, e.pitch / 12), Math.max(0, s), w + 0.05), og = c.createGain(); og.gain.setValueAtTime(0.0001, Math.max(0, s)); og.gain.exponentialRampToValueAtTime(a * 0.12, w); og.gain.linearRampToValueAtTime(0, w + 0.03);
        chain(o, filt("lowpass", 1800), og, out);
      },
      roll: function (e, w, a, out) { var d = e.dur || 0.8, n = Math.round(d * 22); for (var i = 0; i < n; i++) { var p = i / n, t = w + d * (1 - Math.pow(1 - p, 1.3)); D.snare(t, a * (0.3 + 0.7 * p) * 0.6, out); } },
      boing: function (e, w, a, out) {
        var f = 160 * Math.pow(2, e.pitch / 12), o = osc("triangle", f, w, w + 0.7), lfo = osc("sine", 14, w, w + 0.7), lg = c.createGain();
        o.frequency.exponentialRampToValueAtTime(f * 2.6, w + 0.45); lg.gain.setValueAtTime(f * 0.3, w); lg.gain.linearRampToValueAtTime(0, w + 0.6); lfo.connect(lg); lg.connect(o.frequency);
        chain(o, env(w, a * 0.5, 0.005, 0.2, null), out);
      },
      thud: function (e, w, a, out) {
        var o = osc("sine", 90 * Math.pow(2, e.pitch / 12), w, w + 0.5); o.frequency.exponentialRampToValueAtTime(38, w + 0.25);
        chain(o, env(w, a * 1.3, 0.002, 0.12, null), out); chain(noise(w, 0.2), filt("lowpass", 500), env(w, a * 0.5, 0.001, 0.04, null), out);
      }
    };

    return {
      /** Play event e at context time `when`, `off` seconds into it (joining a long note mid-way). */
      play: function (e, when, off) {
        off = off || 0;
        var a = amp(e.vel);
        try {
          if (e.type === "note") {
            if (off > 0 && e.patch !== "pad" && e.patch !== "bass") return;
            var tr = track(e.track), fn = P[e.patch] || P.keys;
            fn(when, e.freq, Math.max(0.03, e.dur - off), a, tr.input, tr.bright, off);
          } else if (e.type === "drum") {
            if (off > 0 || !D[e.name]) return;
            D[e.name](when, a, panned(e.pan));
          } else if (e.type === "fx") {
            if (off > 0.02 || !F[e.name]) return;
            F[e.name](e, when, a, panned(e.pan));
          }
        } catch (err) { /* an odd value never stops the film */ }
      }
    };
  }

  function masterChain(c, score) {
    var g = c.createGain(); g.gain.value = db(score.master.gain || 0);
    var comp = c.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    g.connect(comp); comp.connect(c.destination);
    return g;
  }
  function eventStart(e) { return e.t0 != null ? e.t0 : e.t; }
  function eventEnd(e) { return e.t + (e.dur || (e.type === "note" ? 0.5 : 0.8)) + (e.patch === "pad" ? 1.2 : 0.3); }

  /** Live playback against the playhead: start(t), stop(), setVolume(v). Muted means never started. */
  function Live(score) {
    var c = null, master = null, run = null;
    function ensure() {
      if (c) return c;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      c = new AC({ latencyHint: "interactive" });
      master = masterChain(c, score);
      return c;
    }
    function stop() {
      if (!run) return;
      clearInterval(run.timer);
      var bus = run.bus, now = c.currentTime;
      bus.gain.cancelScheduledValues(now); bus.gain.setTargetAtTime(0, now, 0.015);
      setTimeout(function () { try { bus.disconnect(); } catch (e) {} }, 300);
      run = null;
    }
    /** Start sounding from film second t; clock() gives the playhead now (seconds). */
    function start(t, clock) {
      if (!ensure()) return;
      stop();
      if (c.state === "suspended") c.resume();
      var bus = c.createGain(); bus.connect(master);
      var g = Graph(c, bus, score), evs = score.events, i = 0;
      // Long notes already sounding join mid-way; the rest is scheduled 0.35 s ahead.
      evs.forEach(function (e) { if (eventStart(e) < t && eventEnd(e) > t && e.type === "note") g.play(e, c.currentTime + 0.02, t - e.t); });
      while (i < evs.length && eventStart(evs[i]) < t) i++;
      var fo = score.master.fadeOut, end = score.end;
      if (fo > 0 && end > 0) {
        var now = c.currentTime, fs = end - fo;
        if (t < fs) bus.gain.setValueAtTime(1, now + (fs - t));
        else bus.gain.setValueAtTime(Math.max(0, (end - t) / fo), now);
        bus.gain.linearRampToValueAtTime(0, now + Math.max(0.01, end - t));
      }
      run = { bus: bus, timer: 0 };
      function pump() {
        var pt = clock(), now = c.currentTime;
        while (i < evs.length && eventStart(evs[i]) < pt + 0.35) {
          var e = evs[i++], at = now + (e.t - pt);
          if (e.t < pt - 0.05 && !(e.name === "revswell")) continue;
          g.play(e, Math.max(now, at), 0);
        }
      }
      pump();
      run.timer = setInterval(pump, 40);
    }
    return {
      start: start, stop: stop,
      ready: function () { return !!ensure(); },
      setVolume: function (v) { if (master) master.gain.value = db(score.master.gain || 0) * v; },
      close: function () { stop(); if (c) c.close(); c = null; }
    };
  }

  /** The whole score rendered offline (for Export): Promise<AudioBuffer>. */
  function render(score, seconds, rate) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return Promise.reject(new Error("no OfflineAudioContext"));
    rate = rate || 48000;
    var c = new OAC(2, Math.max(1, Math.ceil(seconds * rate)), rate);
    var master = masterChain(c, score), bus = c.createGain(); bus.connect(master);
    var g = Graph(c, bus, score), fo = score.master.fadeOut, end = Math.min(score.end || seconds, seconds);
    if (fo > 0) { bus.gain.setValueAtTime(1, Math.max(0, end - fo)); bus.gain.linearRampToValueAtTime(0, end); }
    score.events.forEach(function (e) { if (e.t <= seconds) g.play(e, e.t, 0); });
    return c.startRendering();
  }

  window.MotionSound = { build: build, Live: Live, render: render };
})();
