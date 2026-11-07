/* The kit a film's code sees (film-api.md, recreate-ui.md). window.FilmKit.make(env) gives the
   film-level kit; base.sceneKit(info) gives a scene's own (its stage, start, dur, css, svgLayer).
   Everything here is pure in t, so frames scrub and export the same. */
(function () {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";

  // ------------------------------------------------------------------ time and easing
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function clamp01(x) { return clamp(x, 0, 1); }
  function seg(t, a, b) { return b === a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a)); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function smoothstep(a, b, x) { var p = seg(x, a, b); return p * p * (3 - 2 * p); }
  function eo(x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3); }
  function ei(x) { x = clamp01(x); return x * x * x; }
  function eio(x) { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function eoq(x) { x = clamp01(x); return 1 - Math.pow(1 - x, 4); }
  // A whip: slow off the mark, fast through the middle, a hard settle (expo in-out).
  function eox(x) {
    x = clamp01(x);
    if (x === 0 || x === 1) return x;
    return x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;
  }
  function eob(x, s) {
    x = clamp01(x); var c1 = s == null ? 1.4 : s, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }
  function spring(x) { x = clamp01(x); return x >= 1 ? 1 : 1 - Math.exp(-7 * x) * Math.cos(14 * x); }
  function step(t, a) { return t >= a ? 1 : 0; }
  function pulse(t, a, b) { return t >= a && t < b ? 1 : 0; }
  function hash(s) {
    s = String(s); var hh = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { hh ^= s.charCodeAt(i); hh = Math.imul(hh, 16777619) >>> 0; }
    return hh;
  }
  /** A seeded generator: rng(7)() is 0..1, the same sequence every time. */
  function rng(seed) {
    var a = typeof seed === "number" ? (seed * 2654435761) >>> 0 : hash(seed);
    a = (a ^ 0x9e3779b9) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Smooth value noise: vnoise(seed)(x) is -1..1, for boil and drift. */
  function vnoise(seed) {
    var base = hash("vn" + seed), cache = {};
    function v(i) {
      if (cache[i] == null) { var r = rng(base ^ Math.imul(i | 0, 374761393)); r(); cache[i] = r() * 2 - 1; }
      return cache[i];
    }
    return function (x) {
      var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
      return lerp(v(i), v(i + 1), u);
    };
  }
  /** Keystrokes: {times, end, count(t), at(t)} for text typed from t0 at about cps a second. */
  function typist(text, t0, cps) {
    text = String(text); cps = cps || 22; t0 = t0 || 0;
    var r = rng("typist:" + text), times = [], t = t0;
    for (var i = 0; i < text.length; i++) {
      t += (1 / cps) * (0.65 + 0.7 * r()) * (text[i] === " " ? 1.2 : 1);
      times.push(t);
    }
    function count(tt) { var n = 0; while (n < times.length && times[n] <= tt) n++; return n; }
    return { times: times, end: times.length ? times[times.length - 1] : t0, count: count,
      at: function (tt) { return text.slice(0, count(tt)); } };
  }
  /** The part of text revealed by t, whole words, at cps characters a second from t0. */
  function streamed(text, t, t0, cps) {
    text = String(text); var n = Math.floor((t - (t0 || 0)) * (cps || 40));
    if (n <= 0) return "";
    if (n >= text.length) return text;
    var cut = text.lastIndexOf(" ", n);
    return cut <= 0 ? "" : text.slice(0, cut);
  }
  function breathe(t, amt, period) { return 1 + (amt == null ? 0.015 : amt) * Math.sin(2 * Math.PI * t / (period || 3)); }

  // ------------------------------------------------------------------ shapes
  function cutPaper(seed, n, irr) {
    var r = rng("paper:" + seed), pts = []; n = n || 9; irr = irr == null ? 0.25 : irr;
    for (var i = 0; i < n; i++) {
      var a = (i + (r() - 0.5) * irr) / n * Math.PI * 2, rad = 1 - irr / 2 + r() * irr;
      pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
    }
    return pts;
  }
  function polyLerp(A, B, p) {
    var n = Math.max(A.length, B.length), out = [];
    for (var i = 0; i < n; i++) {
      var a = A[Math.floor(i * A.length / n)], b = B[Math.floor(i * B.length / n)];
      out.push([lerp(a[0], b[0], p), lerp(a[1], b[1], p)]);
    }
    return out;
  }
  function polyStr(pts, cx, cy, sx, sy, rot) {
    cx = cx || 0; cy = cy || 0; sx = sx == null ? 1 : sx; sy = sy == null ? sx : sy;
    var c = Math.cos((rot || 0) * Math.PI / 180), s = Math.sin((rot || 0) * Math.PI / 180);
    return pts.map(function (p) {
      var x = p[0] * sx, y = p[1] * sy;
      return (cx + x * c - y * s).toFixed(1) + "," + (cy + x * s + y * c).toFixed(1);
    }).join(" ");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var SVG_TAGS = /^(svg|g|path|rect|circle|ellipse|line|polyline|polygon|defs|linearGradient|radialGradient|stop|pattern|mask|clipPath|use|symbol|filter|fe[A-Z]\w*|image|tspan|text)$/;

  // ------------------------------------------------------------------ the factory
  /** env: {W, H, fps, root (#stage), fx (2D context), modules {name: text}, assets {name: dataURI},
   *  fonts {sans, serif, mono, display}, raster(node, opts) -> Promise<canvas>, videos [] (registry),
   *  text(s) -> s (retyped), scenes {}, scoreFns []} */
  function make(env) {
    var W = env.W, H = env.H;

    function el(tag, o, kids) {
      o = o || {};
      var n = SVG_TAGS.test(tag) ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
      if (o["class"]) n.setAttribute("class", o["class"]);
      if (o.style) n.setAttribute("style", o.style);
      if (o.text != null) n.textContent = env.text(String(o.text));
      if (o.html != null) n.innerHTML = o.html;
      var at = o.attrs || {};
      for (var k in at) if (at[k] != null) n.setAttribute(k, at[k]);
      (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
      return n;
    }
    function h(html) {
      var tp = document.createElement("template");
      tp.innerHTML = String(html).trim();
      return tp.content.firstElementChild;
    }
    function moduleText(name) { var v = env.modules[name]; return v == null ? null : v; }
    function json(name) { var v = moduleText(name); if (v == null) return null; try { return JSON.parse(v); } catch (e) { return null; } }
    var images = {};
    var assets = {
      url: function (name) { return env.assets[name] || ""; },
      has: function (name) { return !!env.assets[name]; },
      list: function () { return Object.keys(env.assets); },
      image: function (name) {
        if (images[name]) return images[name];
        return (images[name] = new Promise(function (res, rej) {
          var im = new Image();
          im.onload = function () { res(im); };
          im.onerror = function () { rej(new Error("asset " + name + " didn't load")); };
          im.src = env.assets[name] || "";
        }));
      }
    };

    // ---------------------------------------------------------------- camera
    function Camera(layer) { this.layer = layer; this.keys = []; this.state = { cx: W / 2, cy: H / 2, z: 1 }; }
    Camera.prototype.set = function (keys) {
      this.keys = (keys || []).slice().sort(function (a, b) { return a.t - b.t; });
      return this;
    };
    Camera.prototype.at = function (t) {
      var ks = this.keys;
      if (!ks.length) return { cx: W / 2, cy: H / 2, z: 1 };
      function val(k, dt) {
        var d = k.drift || [0, 0, 0];
        dt = Math.max(0, dt);
        var cx = k.cx == null ? W / 2 : k.cx, cy = k.cy == null ? H / 2 : k.cy, z = k.z == null ? 1 : k.z;
        return { cx: cx + (d[0] || 0) * dt, cy: cy + (d[1] || 0) * dt, z: z * Math.exp((d[2] || 0) * dt) };
      }
      if (t <= ks[0].t) return val(ks[0], 0);
      for (var i = 0; i < ks.length - 1; i++) {
        var a = ks[i], b = ks[i + 1];
        if (t >= b.t) continue;
        var moveFrom = b.from != null ? b.from : a.t + (a.hold || 0);
        if (b.cut || t < moveFrom) return val(a, t - a.t);
        var A = val(a, moveFrom - a.t), B = val(b, 0);
        var p = (b.ease || eio)(seg(t, moveFrom, b.t));
        return { cx: lerp(A.cx, B.cx, p), cy: lerp(A.cy, B.cy, p), z: Math.exp(lerp(Math.log(A.z), Math.log(B.z), p)) };
      }
      var last = ks[ks.length - 1];
      return val(last, t - last.t);
    };
    Camera.prototype.apply = function (t) {
      var s = this.state = this.at(t);
      if (this.layer) {
        this.layer.style.transformOrigin = "0 0";
        this.layer.style.transform = "translate(" + (W / 2 - s.cx * s.z).toFixed(2) + "px," + (H / 2 - s.cy * s.z).toFixed(2) + "px) scale(" + s.z.toFixed(5) + ")";
      }
      return s;
    };
    /** Stage px to the camera's un-zoomed scene space. */
    Camera.prototype.toScene = function (x, y) { var s = this.state; return [(x - W / 2) / s.z + s.cx, (y - H / 2) / s.z + s.cy]; };

    // ---------------------------------------------------------------- type
    function words(node) {
      if (node.__moWords) return node.__moWords;
      var text = node.textContent;
      node.setAttribute("data-mo-text", text);
      node.textContent = "";
      var list = [];
      text.split(/(\s+)/).forEach(function (w) {
        if (!w) return;
        if (/^\s+$/.test(w)) { node.appendChild(document.createTextNode(" ")); return; }
        var s = document.createElement("span");
        s.className = "mo-word"; s.style.display = "inline-block"; s.textContent = w;
        node.appendChild(s); list.push(s);
      });
      node.__moWords = list;
      return list;
    }
    var TextFx = {
      words: words,
      fadeFromRight: function (node, t, t0, o) {
        if (!node) return; o = o || {};
        var st = o.stagger == null ? 0.11 : o.stagger, d = o.dur || 0.5, dx = o.dx == null ? 28 : o.dx;
        words(node).forEach(function (w, i) {
          var p = eo(seg(t, (t0 || 0) + i * st, (t0 || 0) + i * st + d));
          w.style.opacity = p.toFixed(3);
          w.style.transform = "translateX(" + ((1 - p) * dx).toFixed(2) + "px)";
        });
      },
      fadeOutLeft: function (node, t, t0, o) {
        if (!node) return; o = o || {};
        var st = o.stagger == null ? 0.06 : o.stagger, d = o.dur || 0.4, dx = o.dx == null ? 28 : o.dx;
        words(node).forEach(function (w, i) {
          var p = ei(seg(t, (t0 || 0) + i * st, (t0 || 0) + i * st + d));
          if (p <= 0) return;
          w.style.opacity = (1 - p).toFixed(3);
          w.style.transform = "translateX(" + (-p * dx).toFixed(2) + "px)";
        });
      }
    };

    // ---------------------------------------------------------------- geometry (stage px)
    function stageBox() { return env.root.getBoundingClientRect(); }
    function srect(node) {
      var o = stageBox(), k = o.width / W || 1, r = node.getBoundingClientRect();
      return { x: (r.left - o.left) / k, y: (r.top - o.top) / k, w: r.width / k, h: r.height / k };
    }
    function camrect(node, cam) {
      var r = srect(node), z = cam && cam.state ? cam.state.z : 1, p = cam ? cam.toScene(r.x, r.y) : [r.x, r.y];
      return { x: p[0], y: p[1], w: r.w / z, h: r.h / z };
    }
    function center(node, dx, dy) {
      return function () { var r = srect(typeof node === "string" ? env.root.querySelector(node) : node); return [r.x + r.w / 2 + (dx || 0), r.y + r.h / 2 + (dy || 0)]; };
    }
    function phraseRect(node, phrase) {
      if (!node) return null;
      var tw = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), n, full = "", nodes = [];
      while ((n = tw.nextNode())) { nodes.push([n, full.length]); full += n.textContent; }
      var i = full.indexOf(phrase);
      if (i < 0) return null;
      var rg = document.createRange(), end = i + phrase.length, s = null, e = null;
      nodes.forEach(function (x) {
        var a = x[1], b = a + x[0].textContent.length;
        if (!s && i >= a && i <= b) s = [x[0], i - a];
        if (!e && end >= a && end <= b) e = [x[0], end - a];
      });
      if (!s || !e) return null;
      rg.setStart(s[0], s[1]); rg.setEnd(e[0], e[1]);
      var r = rg.getBoundingClientRect(), o = stageBox(), k = o.width / W || 1;
      if (!r.width) return null;
      return { x: (r.left - o.left) / k, y: (r.top - o.top) / k, w: r.width / k, h: r.height / k };
    }
    function phraseCamRect(node, phrase, cam) {
      var r = phraseRect(node, phrase);
      if (!r || !cam) return r;
      var p = cam.toScene(r.x, r.y), z = cam.state.z;
      return { x: p[0], y: p[1], w: r.w / z, h: r.h / z };
    }

    // ---------------------------------------------------------------- marks (drawn on by hand)
    function Marks(svg) { this.svg = svg; this.list = []; }
    Marks.prototype.add = function (m) {
      var r = rng("mark:" + (m.id || this.list.length)), j = function (a) { return (r() - 0.5) * 2 * (a || 4); };
      var d = "", head = "", k = m.kind || "underline";
      if (k === "circle") {
        var cx = m.x + m.w / 2, cy = m.y + m.h / 2, rx = m.w / 2 + 18, ry = m.h / 2 + 14, a0 = -2.2 + j(0.2), pts = [];
        for (var i = 0; i <= 28; i++) { var a = a0 + i / 28 * Math.PI * 2.15, f = 1 + 0.04 * Math.sin(i * 1.7 + r() * 2); pts.push([cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f]); }
        d = smooth(pts);
      } else if (k === "underline") {
        d = "M" + m.x + " " + (m.y + j(2)) + " Q" + (m.x + m.w / 2) + " " + (m.y + 8 + j(3)) + " " + (m.x + m.w) + " " + (m.y - 2 + j(2));
      } else if (k === "arrow") {
        var f0 = m.from, t1 = m.to, mx = (f0[0] + t1[0]) / 2, my = (f0[1] + t1[1]) / 2, dx = t1[0] - f0[0], dy = t1[1] - f0[1], L = Math.hypot(dx, dy) || 1;
        var bx = mx - dy / L * L * 0.15, by = my + dx / L * L * 0.15;
        d = "M" + f0[0] + " " + f0[1] + " Q" + bx + " " + by + " " + t1[0] + " " + t1[1];
        var ang = Math.atan2(t1[1] - by, t1[0] - bx), hl = Math.min(40, L * 0.3);
        head = "M" + (t1[0] - hl * Math.cos(ang - 0.5)) + " " + (t1[1] - hl * Math.sin(ang - 0.5)) + " L" + t1[0] + " " + t1[1] + " L" + (t1[0] - hl * Math.cos(ang + 0.5)) + " " + (t1[1] - hl * Math.sin(ang + 0.5));
      } else if (k === "bracket") {
        var sd = m.side === "right" ? -1 : 1, x0 = m.x;
        d = "M" + (x0 + 24 * sd) + " " + m.y + " Q" + x0 + " " + m.y + " " + x0 + " " + (m.y + 24) + " L" + (x0 + j(2)) + " " + (m.y + m.h - 24) + " Q" + x0 + " " + (m.y + m.h) + " " + (x0 + 24 * sd) + " " + (m.y + m.h);
      } else if (k === "scribble") {
        var p2 = [], n2 = Math.max(4, Math.round(m.w / 40));
        for (var q = 0; q <= n2; q++) p2.push([m.x + q / n2 * m.w + j(6), q % 2 ? m.y + j(4) : m.y + m.h + j(4)]);
        d = smooth(p2);
      } else if (k === "burst") {
        for (var b = 0; b < 10; b++) { var an = b / 10 * Math.PI * 2 + j(0.1), r1 = m.r * 0.55, r2 = m.r * (0.95 + j(0.1)); d += "M" + (m.x + Math.cos(an) * r1).toFixed(1) + " " + (m.y + Math.sin(an) * r1).toFixed(1) + " L" + (m.x + Math.cos(an) * r2).toFixed(1) + " " + (m.y + Math.sin(an) * r2).toFixed(1) + " "; }
      } else if (k === "check") {
        var s = m.size || 60; d = "M" + (m.x - s * 0.5) + " " + m.y + " L" + (m.x - s * 0.12) + " " + (m.y + s * 0.4) + " L" + (m.x + s * 0.55) + " " + (m.y - s * 0.5);
      } else if (k === "cross") {
        var c = (m.size || 60) / 2; d = "M" + (m.x - c) + " " + (m.y - c) + " L" + (m.x + c + j(3)) + " " + (m.y + c) + " M" + (m.x + c) + " " + (m.y - c) + " L" + (m.x - c) + " " + (m.y + c + j(3));
      } else if (k === "path") {
        d = smooth(m.d || []);
      }
      var g = document.createElementNS(SVGNS, "g");
      var st = "fill:none;stroke:" + (m.color || "#e5484d") + ";stroke-width:" + (m.width || 9) + ";stroke-linecap:round;stroke-linejoin:round";
      var p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", d); p.setAttribute("pathLength", "1"); p.setAttribute("style", st + ";stroke-dasharray:1 1;stroke-dashoffset:1");
      g.appendChild(p);
      var hp = null;
      if (head) { hp = document.createElementNS(SVGNS, "path"); hp.setAttribute("d", head); hp.setAttribute("style", st + ";opacity:0"); g.appendChild(hp); }
      this.svg.appendChild(g);
      this.list.push({ m: m, g: g, p: p, hp: hp });
      return g;
    };
    Marks.prototype.render = function (t) {
      this.list.forEach(function (x) {
        var m = x.m, t0 = m.t0 || 0, d = m.dur || 0.4;
        var pr = eo(seg(t, t0, t0 + d)), multi = m.kind === "burst" || m.kind === "cross";
        x.p.style.strokeDashoffset = multi ? 0 : (1 - pr).toFixed(4);
        var op = multi ? pr : (t >= t0 ? 1 : 0);
        if (m.out != null) op *= 1 - seg(t, m.out, m.out + 0.3);
        x.g.style.opacity = op.toFixed(3);
        if (x.hp) x.hp.style.opacity = seg(t, t0 + d * 0.85, t0 + d).toFixed(3);
      });
    };
    function smooth(pts) {
      if (!pts.length) return "";
      var d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
      for (var i = 1; i < pts.length - 1; i++) {
        var mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        d += " Q" + pts[i][0].toFixed(1) + " " + pts[i][1].toFixed(1) + " " + mx.toFixed(1) + " " + my.toFixed(1);
      }
      var l = pts[pts.length - 1];
      return d + " L" + l[0].toFixed(1) + " " + l[1].toFixed(1);
    }

    // ---------------------------------------------------------------- cursor
    var CURSORS = {
      arrow: '<path d="M2 2 L2 25 L8.5 19 L13 29 L17.5 27 L13 17.5 L22 17.5 Z" style="fill:#111;stroke:#fff;stroke-width:2;stroke-linejoin:round"/>',
      pointer: '<path d="M10 3 q3 -1 3.5 2 v9 q2 -1.4 4 0 q2 -1 3.6 .6 q2.4 -.6 3.4 1.6 v7 q0 5 -4 7 h-8 q-3 -2 -6 -8 l-3 -5 q-1 -2.4 1.4 -2.8 q1.6 0 3.6 3 v-14 q0 -2 2 -2.4 z" style="fill:#fff;stroke:#111;stroke-width:1.8;stroke-linejoin:round"/>',
      text: '<path d="M10 3 h3 q2 0 3 1.5 q1 -1.5 3 -1.5 h3 M16 4.5 v21 M10 27 h3 q2 0 3 -1.5 q1 1.5 3 1.5 h3" style="fill:none;stroke:#111;stroke-width:2.2;stroke-linecap:round"/>',
      ew: '<path d="M3 15 l6 -6 v4 h12 v-4 l6 6 l-6 6 v-4 h-12 v4 z" style="fill:#111;stroke:#fff;stroke-width:1.6;stroke-linejoin:round"/>'
    };
    function cursorIn(stage) {
      return function () {
        var root = el("div", { "class": "mo-cursor", style: "position:absolute;left:0;top:0;width:32px;height:32px;pointer-events:none;z-index:50;transform-origin:2px 2px" });
        var ring = el("div", { style: "position:absolute;left:-22px;top:-22px;width:48px;height:48px;border-radius:50%;border:3px solid rgba(255,255,255,.95);box-shadow:0 0 0 2px rgba(0,0,0,.25);opacity:0" });
        var svg = el("svg", { attrs: { width: 32, height: 32, viewBox: "0 0 32 32" }, style: "position:absolute;left:0;top:0;overflow:visible;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))" });
        root.appendChild(ring); root.appendChild(svg);
        stage.appendChild(root);
        var cur = { el: root, keys: [], clicks: [], holds: [], ewSpans: [], shapes: [], visible: null, scale: 1, _g: null };
        function within(spans, t) { return (spans || []).some(function (s) { return t >= s[0] && t < s[1]; }); }
        cur.at = function (t) {
          var ks = cur.keys;
          if (!ks.length) return [W / 2, H / 2];
          function pos(k) { return typeof k.at === "function" ? k.at() : k.at; }
          if (t <= ks[0].t) return pos(ks[0]);
          for (var i = 0; i < ks.length - 1; i++) {
            var a = ks[i], b = ks[i + 1];
            if (t >= b.t) continue;
            var A = pos(a), B = pos(b), dur = b.t - a.t, travel = Math.min(dur, Math.max(0.35, Math.hypot(B[0] - A[0], B[1] - A[1]) / 1400));
            var p = seg(t, b.t - travel, b.t); p = b.lin ? p : eio(p);
            var bow = b.bow == null ? 0.12 : b.bow, dx = B[0] - A[0], dy = B[1] - A[1], s = Math.sin(Math.PI * p) * bow;
            return [lerp(A[0], B[0], p) - dy * s, lerp(A[1], B[1], p) + dx * s];
          }
          return pos(ks[ks.length - 1]);
        };
        cur.render = function (t) {
          var p = cur.at(t), gfx = within(cur.ewSpans, t) ? "ew" : "arrow";
          (cur.shapes || []).forEach(function (s) { if (within(s.spans, t)) gfx = s.gfx; });
          var mark = CURSORS[gfx] || gfx;
          if (cur._g !== mark) { svg.innerHTML = mark; cur._g = mark; }
          var dip = 1, ringP = -1;
          (cur.clicks || []).forEach(function (c) {
            if (t >= c - 0.08 && t < c + 0.12) dip = Math.min(dip, 1 - 0.12 * Math.sin(Math.PI * seg(t, c - 0.08, c + 0.12)));
            if (t >= c && t < c + 0.45) ringP = seg(t, c, c + 0.45);
          });
          if (within(cur.holds, t)) dip = 0.9;
          root.style.transform = "translate(" + p[0].toFixed(1) + "px," + p[1].toFixed(1) + "px) scale(" + (dip * (cur.scale || 1)).toFixed(3) + ")";
          ring.style.opacity = ringP < 0 ? "0" : (1 - ringP).toFixed(3);
          ring.style.transform = "scale(" + (ringP < 0 ? 0.4 : 0.4 + ringP * 0.9).toFixed(3) + ")";
          root.style.opacity = cur.visible ? String(clamp01(cur.visible(t))) : "1";
        };
        return cur;
      };
    }

    // ---------------------------------------------------------------- walkthrough devices
    function chipIn(stage) {
      return function (text, o) {
        o = o || {};
        var x = o.x || 0, y = o.y || 0, n = el("div", { "class": "mo-chip", style: "position:absolute;left:" + x + "px;top:" + y + "px;opacity:0;z-index:40" });
        var pill = el("div", { text: text, style: "position:relative;padding:12px 22px;border-radius:999px;background:#fff;color:#16181d;font:500 26px/1.25 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.18);white-space:nowrap;" + (o.style || "") });
        n.appendChild(pill);
        if (o.anchor) {
          var ax = o.anchor[0] - x, ay = o.anchor[1] - y;
          var svg = el("svg", { attrs: { width: 1, height: 1 }, style: "position:absolute;left:0;top:0;overflow:visible;pointer-events:none" });
          svg.innerHTML = '<path d="M30 30 L' + ax + " " + ay + '" style="stroke:#fff;stroke-width:3;fill:none"/><circle cx="' + ax + '" cy="' + ay + '" r="8" style="fill:#fff;stroke:rgba(0,0,0,.2);stroke-width:2"/>';
          n.insertBefore(svg, pill);
        }
        stage.appendChild(n);
        return n;
      };
    }
    function show(node, t, tIn, tOut) {
      if (!node) return;
      var p = eo(seg(t, tIn, tIn + 0.35)) * (tOut != null ? 1 - ei(seg(t, tOut, tOut + 0.3)) : 1);
      node.style.opacity = p.toFixed(3);
      node.style.transform = "translateY(" + ((1 - p) * 12).toFixed(2) + "px)";
    }
    function spotlight(rect, amount, o) {
      o = o || {}; var pad = o.pad == null ? 24 : o.pad, rad = o.radius == null ? 18 : o.radius, g = env.fx;
      if (!g || !rect || amount <= 0) return;
      var x = rect.x - pad, y = rect.y - pad, w = rect.w + pad * 2, hh = rect.h + pad * 2;
      g.save();
      g.fillStyle = "rgba(0,0,0," + (0.55 * clamp01(amount)).toFixed(3) + ")";
      g.beginPath(); g.rect(0, 0, W, H);
      g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + hh, rad); g.arcTo(x + w, y + hh, x, y + hh, rad);
      g.arcTo(x, y + hh, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath();
      g.fill("evenodd");
      g.restore();
    }
    var plates = { count: 0, pixels: 0 };
    function raster(src, o) {
      o = o || {};
      var node = typeof src === "string" ? h(src) : src;
      return env.raster(node, o).then(function (c) { plates.count++; plates.pixels += c.width * c.height; return c; });
    }

    // ---------------------------------------------------------------- clips
    function videoIn(stage, sceneId) {
      return function (name, o) {
        o = o || {};
        var v = el("video", { "class": o["class"], style: o.style });
        v.muted = true; v.playsInline = true; v.preload = "auto"; v.loop = !!o.loop;
        v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
        v.src = env.assets[name] || "";
        env.videos.push({ v: v, scene: sceneId, start: o.start || 0, loop: !!o.loop, want: null });
        return v;
      };
    }
    function seek(v, s) {
      var e = env.videos.filter(function (x) { return x.v === v; })[0];
      if (e) e.want = Math.max(0, s);
    }

    function svgLayerIn(stage) {
      return function () {
        var s = el("svg", { "class": "mo-svglayer", attrs: { viewBox: "0 0 " + W + " " + H, width: W, height: H },
          style: "position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px;overflow:visible;pointer-events:none" });
        stage.appendChild(s);
        return s;
      };
    }
    function cssIn(stage) {
      return function (text) { var s = document.createElement("style"); s.setAttribute("data-mo-css", ""); s.textContent = text; stage.appendChild(s); return s; };
    }

    var base = {
      W: W, H: H, fps: env.fps, stage: env.root, fx: env.fx, fonts: env.fonts,
      clamp: clamp, clamp01: clamp01, seg: seg, lerp: lerp, smoothstep: smoothstep, eo: eo, ei: ei, eio: eio, eoq: eoq, eox: eox,
      eob: eob, spring: spring, step: step, pulse: pulse, rng: rng, vnoise: vnoise,
      typist: function (text, t0, cps) { return typist(env.text(String(text)), t0, cps); },
      streamed: function (text, t, t0, cps) { return streamed(env.text(String(text)), t, t0, cps); },
      Camera: Camera, TextFx: TextFx, cutPaper: cutPaper, polyLerp: polyLerp, polyStr: polyStr, breathe: breathe,
      el: el, h: h, esc: esc, module: moduleText, json: json, assets: assets, seek: seek,
      Marks: Marks, srect: srect, camrect: camrect, center: center, phraseRect: phraseRect, phraseCamRect: phraseCamRect,
      cursors: CURSORS, show: show, spotlight: spotlight, raster: raster, plateStats: function () { return { count: plates.count, pixels: plates.pixels }; },
      css: cssIn(env.root), svgLayer: svgLayerIn(env.root), video: videoIn(env.root, null),
      cursor: cursorIn(env.root), chip: chipIn(env.root),
      start: 0, dur: 0,
      scene: function (id, def) { env.scenes[String(id)] = def || {}; return def; },
      score: function (fn) { if (typeof fn === "function") env.scoreFns.push(fn); },
      scenes: function () { return env.buildCut(); }
    };
    base.sceneKit = function (info) {
      var k = Object.create(base);
      k.stage = info.stage; k.start = info.start; k.dur = info.dur; k.id = info.id; k.name = info.name;
      k.css = cssIn(info.stage); k.svgLayer = svgLayerIn(info.stage); k.video = videoIn(info.stage, info.id);
      k.cursor = cursorIn(info.stage); k.chip = chipIn(info.stage);
      return k;
    };
    return base;
  }

  window.FilmKit = { make: make, rng: rng, hash: hash, seg: seg, eo: eo, ei: ei, eio: eio, clamp01: clamp01 };
})();
