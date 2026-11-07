/* hermes-artifacts Dashboard: Design, as Claude's Dashboard type has it.
 *
 *  - Looks: dashboard.json "look" ({system, light, dark, corners, sizes, fonts}), the ready-made Clay,
 *    Ocean and Meadow, or a design system recorded once as values. Every value is checked (forms,
 *    ground bounds, contrast) before it becomes the dashboard's tokens, in light and dark.
 *  - Drafts: a new format (Dashboard, Scrollyteller, Visual analysis, Visual short) is written by
 *    Hermes beside the dashboard under drafts/<id>/; the page shows it with Save / Cancel and Undo /
 *    Redo between the dashboard as it is and the draft.
 */
(function () {
  "use strict";
  var kit = window.kit;

  // ------------------------------------------------------------------ looks
  var LOOKS = {
    Clay: { system: { name: "Clay" },
      light: { ground: "#f6f1e9", card: "#ffffff", text: "#2b2620", muted: "#7a6f62", border: "#e6dfd3", good: "#006300", warning: "#734500", bad: "#8e2626",
        charts: ["#d97757", "#3d3929", "#c2b280", "#788c5d", "#6a9bcc", "#8b5d7d", "#c9952b", "#5f6b73"] },
      dark: { ground: "#14110d", card: "#221d17", text: "#f0efec", muted: "#898781", border: "#272726", good: "#0ca30c", warning: "#db9300", bad: "#ec7e7e",
        charts: ["#e08363", "#c9c2b3", "#b98e5a", "#93a877", "#7eaddb", "#a97a9b", "#d8a747", "#8d9aa3"] } },
    Ocean: { system: { name: "Ocean" },
      light: { ground: "#f0f5fa", card: "#ffffff", text: "#0f2233", muted: "#5a6d80", border: "#d8e2ec", good: "#006300", warning: "#734500", bad: "#8e2626",
        charts: ["#1d4e89", "#2a78d6", "#1b9aaa", "#62b6e6", "#7fd1ae", "#7a4fb8", "#7a8b99", "#d9c8a0"] },
      dark: { ground: "#0b1219", card: "#15202b", text: "#f0efec", muted: "#898781", border: "#272726", good: "#0ca30c", warning: "#db9300", bad: "#ec7e7e",
        charts: ["#608fcc", "#2f7fe8", "#49b2c2", "#81cffe", "#9deac8", "#a58be8", "#93a3b1", "#edddb6"] } },
    Meadow: { system: { name: "Meadow" },
      light: { ground: "#f2f5ec", card: "#ffffff", text: "#1e2a1f", muted: "#66735f", border: "#dde4d2", good: "#006300", warning: "#734500", bad: "#8e2626",
        charts: ["#2d6a4f", "#52b788", "#a3b43c", "#7a5c3e", "#d99a2b", "#2b8c8c", "#8a8f85", "#a8415b"] },
      dark: { ground: "#0e130e", card: "#192019", text: "#f0efec", muted: "#898781", border: "#272726", good: "#0ca30c", warning: "#db9300", bad: "#ec7e7e",
        charts: ["#488166", "#72d0a2", "#d8e983", "#917356", "#f1b454", "#4ea4a4", "#a3a79e", "#c05c73"] } }
  };
  var SWATCH = { Default: ["#f9f9f7", "#2a78d6", "#0b0b0b", "#eb6834"], Clay: ["#f6f1e9", "#d97757", "#2b2620", "#3d3929"],
    Ocean: ["#f0f5fa", "#1d4e89", "#0f2233", "#2a78d6"], Meadow: ["#f2f5ec", "#2d6a4f", "#1e2a1f", "#52b788"] };

  var COLOR_FORM = /^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([^()]{1,80}\))$/i;
  var probe = null;
  function rgb(c) {
    if (typeof c !== "string" || !COLOR_FORM.test(c.trim())) return null;
    if (!probe) { probe = document.createElement("i"); probe.style.display = "none"; document.documentElement.appendChild(probe); }
    probe.style.color = ""; probe.style.color = c.trim();
    if (!probe.style.color) return null;
    var m = getComputedStyle(probe).color.match(/[\d.]+/g);
    if (!m) return null;
    var v = m.map(Number);
    if (/^color\(/.test(getComputedStyle(probe).color)) v = v.slice(0, 3).map(function (x) { return x * 255; }).concat(v.slice(3));
    return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 };
  }
  function hex(c) { return "#" + [c.r, c.g, c.b].map(function (x) { return ("0" + Math.round(Math.max(0, Math.min(255, x))).toString(16)).slice(-2); }).join(""); }
  function lum(c) {
    var f = function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, t) { return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 }; }
  function flat(c, under) { return c.a >= 1 ? c : mix(under, { r: c.r, g: c.g, b: c.b, a: 1 }, c.a); }
  var WHITE = { r: 255, g: 255, b: 255, a: 1 }, BLACK = { r: 0, g: 0, b: 0, a: 1 };
  var LIM = null; // the ground and card bounds, as luminance (worked out on first use)
  function lims() {
    if (!LIM) {
      var g = function (x) { var v = parseInt(x, 16); return lum({ r: v, g: v, b: v, a: 1 }); };
      LIM = { ea: g("ea"), x38: g("38"), x76: g("76"), x75: g("75"), cc: g("cc"), x4f: g("4f") };
    }
    return LIM;
  }

  /** One theme's set, checked the way Claude's dashboard checks it; null when its ground can't be used. */
  function checkSet(set, dark) {
    if (!set || typeof set !== "object") return null;
    var g = rgb(set.ground);
    if (!g || g.a < 1) return null;
    var L = lum(g), B = lims();
    if (!dark && L < B.ea) { if (L < B.x76) return null; while (lum(g) < B.ea) g = mix(g, WHITE, 0.08); }
    if (dark && L > B.x38) { if (L > B.x75) return null; while (lum(g) > B.x38) g = mix(g, BLACK, 0.08); }
    var card = rgb(set.card);
    card = card ? flat(card, g) : null;
    if (!card || (!dark && lum(card) < B.cc) || (dark && lum(card) > B.x4f)) card = g;
    var text = rgb(set.text); text = text ? flat(text, g) : null;
    if (!text || contrast(text, g) < 4.5 || contrast(text, card) < 4.5) text = dark ? WHITE : BLACK;
    var muted = rgb(set.muted); muted = muted ? flat(muted, g) : null;
    if (!muted || contrast(muted, g) < 3 || contrast(muted, card) < 3) muted = mix(text, g, 0.38);
    var border = rgb(set.border); border = border ? flat(border, g) : mix(text, g, 0.85);
    var out = { ground: hex(g), card: hex(card), text: hex(text), muted: hex(muted), border: hex(border) };
    ["good", "warning", "bad"].forEach(function (k) {
      var c = rgb(set[k]); c = c ? flat(c, g) : null;
      if (c && contrast(c, g) >= 3 && contrast(c, card) >= 3) out[k] = hex(c);
    });
    var charts = [];
    (Array.isArray(set.charts) ? set.charts.slice(0, 8) : []).forEach(function (v, i) {
      var c = rgb(v); c = c ? flat(c, g) : null;
      var close = c && charts.some(function (x) { var p = rgb(x); return p && Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) < 24; });
      charts[i] = c && contrast(c, g) >= 1.5 && contrast(c, card) >= 1.5 && !close ? hex(c) : null;
    });
    out.charts = charts;
    return out;
  }
  function px(v, lo, hi) {
    var m = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(String(v || "").trim());
    if (!m) return null;
    var n = m[2] === "rem" ? +m[1] * 16 : +m[1];
    return n >= lo && n <= hi ? m[1] + m[2] : null;
  }
  function stack(v) {
    if (typeof v !== "string" || v.length > 200) return null;
    var names = v.split(",").map(function (s) { return s.trim().replace(/^['"]|['"]$/g, ""); });
    if (!names.length || names.length > 12) return null;
    return names.every(function (n) { return /^[A-Za-z0-9 _.-]{1,60}$/.test(n); }) ? v : null;
  }
  /** The look as it can be worn: {name, light, dark, corners, sizes, fonts}, or null. */
  function check(look) {
    if (!look || typeof look !== "object") return null;
    var out = { name: look.system && look.system.name ? String(look.system.name).slice(0, 60) : "", light: checkSet(look.light, false), dark: checkSet(look.dark, true),
      corners: px(look.corners, 0, 32), sizes: {}, fonts: {} };
    var sz = look.sizes || {}, lim = { caption: [9, 18], body: [11, 22], heading: [12, 32], title: [16, 64] };
    Object.keys(lim).forEach(function (k) { var v = px(sz[k], lim[k][0], lim[k][1]); if (v) out.sizes[k] = v; });
    var f = look.fonts || {};
    if (stack(f.text)) out.fonts.text = f.text;
    if (stack(f.display)) out.fonts.display = f.display;
    return out.light || out.dark ? out : null;
  }
  var worn = null, applied = [];
  function mode() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t === "dark" || t === "light") return t;
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function apply() {
    if (!worn) return;
    var st = document.documentElement.style, m = mode(), set = worn[m] || worn.light || worn.dark;
    var put = function (k, v) { if (v) { st.setProperty(k, v); applied.push(k); } };
    put("--color-bg", set.ground); put("--color-panel", set.card); put("--color-fg", set.text);
    put("--color-fg-secondary", hex(mix(rgb(set.text), rgb(set.muted), 0.45)));
    put("--color-fg-muted", set.muted); put("--color-border-line", set.border);
    put("--color-border-strong", hex(mix(rgb(set.border), rgb(set.text), 0.18)));
    put("--color-hover", "color-mix(in srgb, " + set.text + " 7%, transparent)");
    put("--chart-grid", hex(mix(rgb(set.border), rgb(set.card), 0.2)));
    put("--color-ok", set.good); put("--color-warn", set.warning); put("--color-bad", set.bad);
    set.charts.forEach(function (c, i) { if (c) put("--chart-" + (i + 1), c); });
    if (set.charts[0]) { put("--color-accent", set.charts[0]); put("--color-accent-soft", "color-mix(in srgb, " + set.charts[0] + " 14%, transparent)"); }
    put("--radius", worn.corners);
    put("--size-caption", worn.sizes.caption); put("--size-body", worn.sizes.body); put("--size-heading", worn.sizes.heading); put("--size-title", worn.sizes.title);
    put("--font-sans", worn.fonts.text); put("--font-display", worn.fonts.display || worn.fonts.text);
    document.documentElement.setAttribute("data-dash-look", worn.name || "custom");
  }
  function wear(look) {
    worn = check(look);
    apply();
    if (kit.hostTheme) kit.hostTheme(function () { apply(); });
    if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply);
    return worn;
  }

  /** A design system recorded as a look: its colors by name and usage, per theme, as values. */
  function lookFromDs(ds) {
    var st = document.createElement("style");
    st.textContent = window.dsKit.css(ds);
    document.head.appendChild(st);
    var themes = window.dsKit.themes(ds), out = { system: { name: String(ds.name || ds.title || "Design system").slice(0, 60), id: ds.id || null } };
    var sets = (themes.length ? themes : [{ id: null }]).map(function (th) {
      var p = document.createElement("div");
      if (th.id) p.setAttribute("data-theme", th.id);
      document.body.appendChild(p);
      var cs = getComputedStyle(p);
      var toks = ((ds.tokens.color || {}).tokens || []).map(function (t) {
        var v = cs.getPropertyValue("--" + t.name).trim(), c = rgb(v) || (function () { p.style.color = v; return rgb(getComputedStyle(p).color); })();
        return c ? { name: t.name, usage: String(t.usage || ""), c: c, L: lum(c), C: (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255 } : null;
      }).filter(Boolean);
      p.remove();
      var pick = function (re, ure) { var t = toks.find(function (x) { return re.test(x.name); }) || (ure && toks.find(function (x) { return ure.test(x.usage); })); return t ? hex(t.c) : undefined; };
      var byL = toks.slice().sort(function (a, b) { return a.L - b.L; });
      var ground = pick(/^(bg|background|surface-?0|canvas|paper|page|ground)/i, /(page|app)?\s*background|the ground/i);
      var dark = ground ? lum(rgb(ground)) < 0.3 : /dark|night/i.test(th.id || "");
      if (!ground && byL.length) ground = hex((dark ? byL[0] : byL[byL.length - 1]).c);
      var accents = toks.filter(function (t) { return t.C > 0.18; }).sort(function (a, b) { return b.C - a.C; });
      var brand = pick(/(accent|brand|primary)$/i, /accent|brand colou?r|primary/i);
      var charts = [brand].concat(accents.map(function (t) { return hex(t.c); })).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 8);
      return { dark: dark, set: { ground: ground, card: pick(/^(surface|card|panel|raised)/i, /cards?|surfaces?|panel/i),
        text: pick(/^(ink|fg|text|foreground|on-?surface)$/i, /^(body )?text/i) || (byL.length ? hex((dark ? byL[byL.length - 1] : byL[0]).c) : undefined),
        muted: pick(/(muted|secondary|subtle|ink-?2|text-?2)/i, /secondary text|muted/i), border: pick(/(line|border|divider|rule|hairline)/i, /borders?|dividers?|hairlines?/i),
        good: pick(/(success|positive|good|ok)$/i), warning: pick(/(warning|caution)$/i), bad: pick(/(danger|error|negative|bad|critical)$/i), charts: charts } };
    });
    st.remove();
    var light = sets.filter(function (s) { return !s.dark; })[0], dk = sets.filter(function (s) { return s.dark; })[0];
    if (light) out.light = light.set;
    if (dk) out.dark = dk.set;
    var r = ds.tokens && ds.tokens.radius && ds.tokens.radius.tokens && ds.tokens.radius.tokens[0];
    if (r && r.value) out.corners = String(r.value);
    var fam = (ds.tokens.type || {}).families || {}, fk = Object.keys(fam);
    var font = function (re) { var k = fk.find(function (x) { return re.test(x); }); return k ? fam[k] : undefined; };
    var text = font(/^(sans|body|text)/i) || font(/./), display = font(/^(display|heading|serif|head)/i);
    if (text || display) out.fonts = { text: text || display, display: display || text };
    return out;
  }

  // ------------------------------------------------------------------ drafts
  var FORMATS = ["dashboard", "scrollyteller", "visual-analysis", "visual-short"];
  /** The newest draft request in this version's files: {id, format, at, page?} or null. */
  function draftOf(files) {
    var best = null;
    Object.keys(files || {}).forEach(function (p) {
      var m = /^drafts\/([A-Za-z0-9_-]{1,40})\/request\.json$/.exec(p);
      if (!m) return;
      var r = null;
      try { r = JSON.parse(files[p]); } catch (e) {}
      if (!r || FORMATS.indexOf(r.format) < 0) return;
      if (!best || String(r.at) > String(best.at)) best = { id: m[1], format: r.format, at: String(r.at || "") };
    });
    if (best && typeof files["drafts/" + best.id + "/index.html"] === "string") best.page = "drafts/" + best.id + "/index.html";
    return best;
  }
  function draftFiles(files, d) {
    var pre = "drafts/" + d.id + "/";
    return Object.keys(files).filter(function (p) { return p.indexOf(pre) === 0; });
  }
  function isPageFile(p) { return /^[A-Za-z0-9_-]{1,64}\.(html|css|js)$/.test(p); }
  /** The files a Save writes: the draft's page over the dashboard's (the old page's other files go). */
  function saveDraftFiles(files, spec, d) {
    var out = {}, pre = "drafts/" + d.id + "/", next = JSON.parse(JSON.stringify(spec || {}));
    var dfiles = draftFiles(files, d), names = {};
    dfiles.forEach(function (p) {
      var rel = p.slice(pre.length);
      out[p] = null;
      if (rel === "request.json") return;
      if (rel === "datasets.json") {
        try { var ds = JSON.parse(files[p]); next.datasets = Object.assign({}, next.datasets || {}, ds || {}); } catch (e) {}
        return;
      }
      if (rel === "params.json") { try { next.params = JSON.parse(files[p]); } catch (e) {} return; }
      if (isPageFile(rel)) { out[rel] = files[p]; names[rel] = 1; }
    });
    Object.keys(files).forEach(function (p) { if (isPageFile(p) && !names[p]) out[p] = null; });
    delete next.layout; delete next.page; // the draft's page is the whole page now
    out["dashboard.json"] = JSON.stringify(next, null, 2);
    return out;
  }


  window.dashDesignKit = { LOOKS: LOOKS, check: check, wear: wear, lookFromDs: lookFromDs, draftOf: draftOf, saveDraftFiles: saveDraftFiles,
    draftFiles: draftFiles, FORMATS: FORMATS };
})();
