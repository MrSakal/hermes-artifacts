/* hermes-artifacts Design runtime: a canvas of live artboards.
 *
 * Content (the artifact's files):
 *   canvas.json       {v, title, launch, pages, boards: {path: {x, y, w, h, title, page, expand, print, paper,
 *                     is_interactive, guides, radius, frameless, props}}, order, notes, designSystems}
 *   <name>.dc.html    one artboard each (dc.js reads the format); every .dc.html outside ds/ shows, listed or not
 *   uploads/<name>    images the user adds in the page
 *
 * A pan/zoom canvas of artboards (name strips, drag to move, notes, pages, layout guides); Play for
 * interactive artboards and links between them; a full-window view per artboard. WYSIWYG editing:
 * click to select (outline, breadcrumb), double-click literal text to retype it, a properties panel for
 * the inline style, Tweaks from data-props, image replace; undo and redo; every change saves itself as a
 * new version (only the files that changed). Ask Hermes and comment on an element. Exports: PNG, PDF
 * (artboards or print pages, with a text layer), standalone HTML.
 *
 * Each artboard renders in a srcdoc iframe of its own (frame.js + dc.js): its own document and origin,
 * so its script can't reach the bridge. The canvas keeps the parsed templates; frames get the sources.
 */
(function () {
  "use strict";
  // The UI's words in the app's language (hu over en, key by key); messages to Hermes are always English.
  function pickLang(t, l) { var o = {}, k; for (k in t.en) o[k] = t.en[k]; for (k in t[l] || {}) o[k] = t[l][k]; return o; }
  var kit = window.kit, h = kit.h, C = kit.content, DC = window.DC;
  var L = /^hu\b/i.test(kit.content.lang || navigator.language || "") ? "hu" : "en";
  var T = pickLang({
    en: { pages: "Pages", page1: "Page 1", pageN: "Page", newPage: "New page", prototypes: "Prototypes", statics: "Static artboards", zoom: "Zoom",
      tools: "Tools", tSelect: "Select (V)", tHand: "Hand (H)", tText: "Text (T)", tBoard: "Artboard (A)", tSticky: "Sticky note (S)", tPen: "Pencil (P)",
      shapes: "Shapes", rect: "Rectangle (R)", oval: "Oval (O)", arrow: "Arrow (Shift+L)", line: "Line (L)", newBoard: "New artboard", phText: "Text",
      properties: "Properties", outline: "Outline", code: "Code", copyCode: "Copy", copied: "Copied", nothing: "Select an artboard or an element.",
      noteTitle: "Title", noteSticky: "Note", noteShape: "Shape", noteLink: "Link", noteDraw: "Drawing",
      fixIt: "Ask Hermes to fix",
      fixMsg: function (path, err) { return "The artboard " + path + " fails with: " + err + ". Fix it (artifact_read the canvas first)."; },
      canvas: "Canvas", fit: "Zoom to fit", zoomIn: "Zoom in", zoomOut: "Zoom out", sel: "Zoom to selection", play: "Play", stop: "Stop",
      tweaks: "Tweaks", design: "Design", expand: "Full window", back: "Canvas", prev: "Previous artboard", next: "Next artboard",
      save: "Save", saving: "Saving…", saved: "Saved", notSaved: "Not saved", conflict: "Changed meanwhile: the new version loads",
      noSave: "Can't save here", editHint: "Click to select · double-click text to edit", building: "Building…",
      bad: "canvas.json is missing or not valid JSON.", empty: "This canvas has no artboards yet.", missing: "Missing file",
      error: "Error", noLib: "The export library didn't load (open the canvas in Hermes Desktop)", tooBig: "Images up to 8 MB",
      undo: "Undo", redo: "Redo", del: "Delete", ask: "Ask Hermes", askPh: "Ask Hermes about this…", sent: "Sent to the chat",
      comment: "Comment", editText: "Edit text", image: "Replace image…", theme: "Theme", defTheme: "Default", panel: "Properties",
      exp: "Export", png: "This artboard (PNG)", pdf: "This artboard (PDF)", pdfAll: "All artboards (PDF)", html: "This artboard (HTML)",
      dupEl: "Duplicate", group: "Group", ungroup: "Ungroup", forward: "Bring forward", backward: "Send backward",
      text: "Text", color: "Color", size: "Size", weight: "Weight", align: "Align", fill: "Fill", background: "Background",
      layout: "Layout", width: "Width", height: "Height", padding: "Padding", gap: "Gap", radius: "Radius", display: "Display",
      direction: "Direction", columns: "Columns", rows: "Rows", justify: "Justify", items: "Align items", wrap: "Wrap", style: "Text style",
      artboard: "Artboard", title: "Title", fillPage: "Page (fills the window)", interactive: "Interactive (Play)", reset: "Reset",
      bound: "Set from the template ({{…}})", noTweaks: "This artboard has no tweaks.", none: "Select an element or an artboard.",
      noBoard: "No artboard to export", pick: "Pick an artboard first", fonts: "Fonts", imgOnly: "png, jpeg, gif or webp",
      about: function (board, file, label) { return "(artboard “" + board + "”, " + file + (label ? ", element “" + label + "”" : "") + ")"; } },
    hu: { pages: "Oldalak", page1: "1. oldal", pageN: "Oldal", newPage: "Új oldal", prototypes: "Prototípusok", statics: "Álló rajzlapok", zoom: "Nagyítás",
      tools: "Eszközök", tSelect: "Kijelölés (V)", tHand: "Kéz (H)", tText: "Szöveg (T)", tBoard: "Rajzlap (A)", tSticky: "Cetli (S)", tPen: "Ceruza (P)",
      shapes: "Alakzatok", rect: "Téglalap (R)", oval: "Ellipszis (O)", arrow: "Nyíl (Shift+L)", line: "Vonal (L)", newBoard: "Új rajzlap", phText: "Szöveg",
      properties: "Tulajdonságok", outline: "Szerkezet", code: "Kód", copyCode: "Másolás", copied: "Kimásolva", nothing: "Jelölj ki egy rajzlapot vagy egy elemet.",
      noteTitle: "Cím", noteSticky: "Cetli", noteShape: "Alakzat", noteLink: "Hivatkozás", noteDraw: "Rajz",
      canvas: "Vászon", fit: "Mindent mutat", zoomIn: "Nagyítás", zoomOut: "Kicsinyítés", sel: "Kijelölésre nagyít", play: "Lejátszás", stop: "Leállítás",
      tweaks: "Hangolás", design: "Tervezés", expand: "Teljes ablak", back: "Vászon", prev: "Előző rajztábla", next: "Következő rajztábla",
      save: "Mentés", saving: "Mentés…", saved: "Elmentve", notSaved: "Nincs mentve", conflict: "Közben megváltozott: betöltöm az új verziót",
      noSave: "Itt nem lehet menteni", editHint: "Kattints a kijelöléshez · dupla katt a szövegre", building: "Készül…",
      bad: "A canvas.json hiányzik, vagy nem érvényes JSON.", empty: "Ezen a vásznon még nincs rajztábla.", missing: "Hiányzó fájl",
      error: "Hiba", noLib: "Az export könyvtár nem töltődött be (nyisd meg a Hermes Desktopban)", tooBig: "Legfeljebb 8 MB-os kép",
      undo: "Visszavonás", redo: "Mégis", del: "Törlés", ask: "Kérdezd a Hermest", askPh: "Kérdezd a Hermest erről…", sent: "Elküldve a chatbe",
      comment: "Megjegyzés", editText: "Szöveg szerkesztése", image: "Kép cseréje…", theme: "Téma", defTheme: "Alap", panel: "Tulajdonságok",
      exp: "Exportálás", png: "Ez a rajztábla (PNG)", pdf: "Ez a rajztábla (PDF)", pdfAll: "Minden rajztábla (PDF)", html: "Ez a rajztábla (HTML)",
      fixIt: "Kérd meg a Hermest, hogy javítsa",
      dupEl: "Duplikálás", group: "Csoportosítás", ungroup: "Csoport bontása", forward: "Előrébb", backward: "Hátrébb",
      text: "Szöveg", color: "Szín", size: "Méret", weight: "Vastagság", align: "Igazítás", fill: "Kitöltés", background: "Háttér",
      layout: "Elrendezés", width: "Szélesség", height: "Magasság", padding: "Belső margó", gap: "Térköz", radius: "Lekerekítés", display: "Megjelenés",
      direction: "Irány", columns: "Oszlopok", rows: "Sorok", justify: "Igazítás (fő)", items: "Igazítás (kereszt)", wrap: "Tördelés", style: "Szövegstílus",
      artboard: "Rajztábla", title: "Cím", fillPage: "Oldal (kitölti az ablakot)", interactive: "Interaktív (lejátszható)", reset: "Alaphelyzet",
      bound: "A sablon állítja ({{…}})", noTweaks: "Ennek a rajztáblának nincs hangolása.", none: "Jelölj ki egy elemet vagy rajztáblát.",
      noBoard: "Nincs exportálható rajztábla", pick: "Előbb válassz rajztáblát", fonts: "Betűk", imgOnly: "png, jpeg, gif vagy webp",}
  }, L);

  var bar = document.getElementById("dc-bar"), app = document.getElementById("dc-app");
  var viewEl = document.getElementById("dc-view"), world = document.getElementById("dc-world"), panelEl = document.getElementById("dc-panel");
  bar.className = "kit-bar";
  var canvas = kit.json("canvas.json", null);
  if (!canvas || typeof canvas !== "object" || Array.isArray(canvas)) { app.replaceChildren(h("div", { "class": "kit-empty", text: T.bad })); kit.ready(); return; }
  var editable = !C.thumb;
  var SRC = {};
  ["kit", "dc", "frame"].forEach(function (k) { var s = document.querySelector('script[data-dc="' + k + '"]'); SRC[k] = s ? s.textContent : ""; });
  var R = Math.round;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function capture(el, id) { try { el.setPointerCapture(id); } catch (e) {} }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }

  // ------------------------------------------------------------------ files
  var PATH = /^[A-Za-z0-9_][A-Za-z0-9_.!~*'()-]{0,99}(\/[A-Za-z0-9_][A-Za-z0-9_.!~*'()-]{0,99}){0,3}\.dc\.html$/;
  var ID = /^[A-Za-z0-9_-]{1,40}$/;
  function okPath(p) { return typeof p === "string" && PATH.test(p) && p.indexOf("..") < 0; }
  var files = {}, cur = {}; // path -> parsed template, path -> its current text
  Object.keys(C.files).forEach(function (p) {
    if (!/\.dc\.html$/.test(p) || /^ds\//.test(p) || !okPath(p)) return;
    files[p] = DC.parse(kit.fileText(p));
    cur[p] = DC.serialize(files[p]);
  });
  var cssFiles = {};
  Object.keys(C.files).forEach(function (p) { if (/\.css$/i.test(p)) cssFiles[p] = kit.fileText(p); });
  var IMG = /\.(png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf)$/i; // pictures and fonts the artboards name
  function stem(p) { return p.replace(/\.dc\.html$/, ""); }
  function enc(p) { return encodeURIComponent(stem(p)) + ".dc.html"; }

  // ------------------------------------------------------------------ the index (canvas.json)
  if (!canvas.boards || typeof canvas.boards !== "object" || Array.isArray(canvas.boards)) canvas.boards = {};
  if (!Array.isArray(canvas.order)) canvas.order = [];
  if (!canvas.notes || typeof canvas.notes !== "object" || Array.isArray(canvas.notes)) canvas.notes = {};
  var pages = (Array.isArray(canvas.pages) ? canvas.pages : []).filter(function (p) { return p && ID.test(p.id || ""); }).slice(0, 40);
  function canvasText() { return JSON.stringify(canvas, null, 2) + "\n"; }
  function pageOf(x) { return pages.length ? (x && pages.some(function (p) { return p.id === x.page; }) ? x.page : pages[0].id) : null; }
  var auto = {}; // where artboards that canvas.json doesn't list are drawn
  function previewSize(p) {
    var pv = files[p] && files[p].props && files[p].props.$preview;
    return { w: pv && num(pv.width, 0) ? num(pv.width, 880) : 880, h: pv && num(pv.height, 0) ? num(pv.height, 560) : 560 };
  }
  function entry(p) { var e = canvas.boards[p]; return e && typeof e === "object" ? e : null; }
  function geo(p) {
    var e = entry(p) || auto[p] || {}, pv = previewSize(p);
    return { x: num(e.x, 0), y: num(e.y, 0), w: clamp(num(e.w, pv.w), 40, 8000), h: clamp(num(e.h, pv.h), 40, 8000) };
  }
  function boardPaths() {
    var listed = [];
    canvas.order.concat(Object.keys(canvas.boards)).forEach(function (p) { if (okPath(p) && entry(p) && listed.indexOf(p) < 0) listed.push(p); });
    var extra = Object.keys(files).filter(function (p) { return listed.indexOf(p) < 0; }).sort();
    var right = 0;
    listed.forEach(function (p) { var g = geo(p); if (pageOf(entry(p)) === pageOf(null)) right = Math.max(right, g.x + g.w + 80); });
    extra.forEach(function (p) {
      if (!auto[p]) { var pv = previewSize(p); auto[p] = { x: right, y: 0, w: pv.w, h: pv.h }; right += pv.w + 80; }
    });
    return listed.concat(extra);
  }
  /** The artboard's entry in canvas.json, made when the user first changes an unlisted one. */
  function ensureEntry(p) {
    if (!entry(p)) { var g = geo(p); canvas.boards[p] = { x: g.x, y: g.y, w: g.w, h: g.h }; }
    if (canvas.order.indexOf(p) < 0) canvas.order.push(p);
    return canvas.boards[p];
  }
  function titleOf(p) { var e = entry(p); return (e && typeof e.title === "string" && e.title) || p; }
  function propsOf(p) { var e = entry(p); return e && e.props && typeof e.props === "object" ? e.props : {}; }

  // ------------------------------------------------------------------ what a frame gets
  function importsOf(p, seen) {
    seen = seen || {};
    if (seen[p] || !cur[p]) return seen;
    seen[p] = 1;
    var re = /<dc-import\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi, m;
    while ((m = re.exec(cur[p]))) importsOf(DC.sibling(p, m[1]), seen);
    return seen;
  }
  function urlsFor(p) {
    var text = Object.keys(importsOf(p)).map(function (f) { return cur[f]; }).join("\n") + Object.keys(cssFiles).map(function (k) { return cssFiles[k]; }).join("\n");
    var out = {};
    Object.keys(C.files).forEach(function (k) {
      if (!IMG.test(k)) return;
      var tail = k.slice(k.lastIndexOf("/") + 1);
      if (text.indexOf(tail) >= 0) out[k] = kit.fileUrl(k);
    });
    return out;
  }
  var FRAME_CSS = "html.dc-edit,html.dc-edit *{cursor:default!important}html.dc-edit [contenteditable=true],html.dc-edit [contenteditable=true] *{cursor:text!important;outline:none}" +
    "html.dc-canvas{overflow:hidden;scrollbar-width:none}html.dc-canvas::-webkit-scrollbar{display:none}" +
    "[data-dc-ximport]:empty{display:inline-block!important;min-width:24px;min-height:24px;outline:1px dashed #9aa4b2}";
  var SRCDOC = '<!doctype html><html lang="en"><head><meta charset="utf-8"><style>' + FRAME_CSS + "</style><script>" + SRC.kit + "</" + "script><script>" +
    SRC.dc + "</" + "script><script>" + SRC.frame + "</" + "script></head><body></body></html>";

  var frames = [];
  /** One artboard frame: opts {path, mode (edit|play|view|export), wheel (forward|native|none), parent, w, h, onMsg}. */
  function Frame(opts) {
    var self = this;
    this.path = opts.path; this.mode = opts.mode; this.wheel = opts.wheel; this.onMsg = opts.onMsg; this.queue = []; this.loaded = false;
    this.reqs = {};
    this.iframe = h("iframe", { "class": "dc-iframe", title: titleOf(opts.path), sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox",
      tabindex: opts.mode === "export" ? "-1" : null });
    this.iframe.srcdoc = SRCDOC;
    opts.parent.appendChild(this.iframe);
    frames.push(this);
    this.dispose = function () { self.iframe.remove(); frames.splice(frames.indexOf(self), 1); };
  }
  Frame.prototype.init = function () {
    return { t: "init", id: this.path, file: this.path, sources: cur, urls: urlsFor(this.path), css: cssFiles, props: propsOf(this.path),
      mode: this.mode, wheel: this.wheel, ds: ds.css, theme: ds.theme, scripts: ds.scripts };
  };
  Frame.prototype.send = function (m) {
    m.__dc = 1;
    if (!this.loaded) { this.queue.push(m); return; }
    try { this.iframe.contentWindow.postMessage(m, "*"); } catch (e) {}
  };
  Frame.prototype.request = function (m) {
    var self = this, id = Math.random().toString(36).slice(2);
    m.req = id;
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { if (self.reqs[id]) self.reqs[id]({ error: "the artboard didn't answer" }); }, 90000);
      self.reqs[id] = function (r) { clearTimeout(t); delete self.reqs[id]; if (r.error) reject(new Error(r.error)); else resolve(r); };
      self.send(m);
    });
  };
  Frame.prototype.whenReady = function () {
    var self = this;
    if (this.ready) return Promise.resolve();
    return new Promise(function (r) { (self.readyWaiters = self.readyWaiters || []).push(r); });
  };
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.__dc !== 1) return;
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      if (e.source !== f.iframe.contentWindow) continue;
      if (m.t === "hello") {
        f.loaded = true;
        f.iframe.contentWindow.postMessage(Object.assign(f.init(), { __dc: 1 }), "*");
        f.queue.splice(0).forEach(function (q) { f.iframe.contentWindow.postMessage(q, "*"); });
        return;
      }
      if (m.t === "ready") { f.ready = true; (f.readyWaiters || []).splice(0).forEach(function (r) { r(); }); }
      if (m.t === "raster" && f.reqs[m.req]) { f.reqs[m.req](m); return; }
      if (f.onMsg) f.onMsg(m, f);
      return;
    }
  });
  function broadcast(m, path) { frames.forEach(function (f) { if (!path || f.path === path) f.send(Object.assign({}, m)); }); }

  // ------------------------------------------------------------------ design system
  // Up to four systems (Claude's): the first is the canvas's own (its themes); the others add their colors,
  // type styles and CSS. Each is the copy the canvas carries (ds/<namespace>/), so a later edit of a system
  // changes nothing here.
  var dsRecs = (Array.isArray(canvas.designSystems) ? canvas.designSystems : []).filter(function (r) { return r && r.artifact; }).slice(0, 4);
  var ds = { rec: dsRecs[0] || null, css: "", themes: [], theme: null, model: null, scripts: [], ready: Promise.resolve() };
  /** A system copy's component scripts for the frames: components/lib/*.js (react, then react-dom, then
   *  the rest) and components/bundle.js; null when it has no bundle. */
  function dsScripts(d) {
    var bundle = d && d.base ? kit.fileText(d.base + "components/bundle.js") : null;
    if (bundle == null) return null;
    var lib = d.base + "components/lib/";
    function rank(n) { return /^react-dom([.-]|$)/i.test(n) ? 1 : /^react([.-]|$)/i.test(n) ? 0 : 2; }
    var libs = Object.keys(C.files).map(function (p) { return p.indexOf(lib) === 0 ? p.slice(lib.length) : null; })
      .filter(function (n) { return n && /\.js$/i.test(n) && n.indexOf("/") < 0; })
      .sort(function (a, b) { return rank(a) - rank(b) || (a < b ? -1 : 1); })
      .map(function (n) { return { name: n, code: kit.fileText(lib + n) || "" }; });
    return { id: d.base, libs: libs, bundle: bundle };
  }
  if (dsRecs.length && window.dsKit && editable !== null) {
    ds.ready = Promise.all(dsRecs.map(function (r) {
      return window.dsKit.load(r).catch(function () { return null; });
    })).then(function (all) {
      var got = all.filter(Boolean);
      if (!got.length) return;
      var models = [];
      got.forEach(function (d) { try { models.push(window.dsKit.model(d.tokens || {})); } catch (e) {} });
      // The others' CSS first, the canvas's own system last: on a clash, its own wins.
      ds.css = got.slice(1).concat(got.slice(0, 1)).map(function (d) { return window.dsKit.css(d) || ""; }).join("\n");
      ds.themes = all[0] ? window.dsKit.themes(all[0]) || [] : [];
      if (models.length) {
        var seen = {};
        ds.model = {
          colors: [].concat.apply([], models.map(function (m) { return m.colors; })).filter(function (c) { if (seen[c.name]) return false; seen[c.name] = 1; return true; }),
          resolve: function (name, theme) { for (var i = 0; i < models.length; i++) { var v = models[i].resolve(name, theme); if (v) return v; } return null; },
          type: { groups: [].concat.apply([], models.map(function (m) { return m.type.groups; })) }
        };
      }
      ds.scripts = got.map(dsScripts).filter(Boolean);
      broadcast({ t: "ds", css: ds.css, scripts: ds.scripts });
      if (themeBtn) themeBtn.hidden = ds.themes.length < 2;
      if (sel && sel.path) renderPanel();
    }).catch(function () {});
  }
  function setTheme(id) { ds.theme = id || null; broadcast({ t: "theme", theme: ds.theme }); }

  // ------------------------------------------------------------------ thumbnail: the launch artboard, fitted
  var paths = boardPaths();
  var launch = canvas.launch && typeof canvas.launch === "object" ? canvas.launch : {};
  if (launch.page && pages.some(function (p) { return p.id === launch.page; })) var startPage = launch.page;
  if (C.thumb) {
    var tp = launch.view === "focused" && files[launch.file] ? launch.file : paths.filter(function (p) { return files[p] && pageOf(entry(p)) === pageOf(null); })[0] || paths[0];
    if (!tp || !files[tp]) { app.replaceChildren(h("div", { "class": "kit-empty", text: T.empty })); kit.ready(); return; }
    var g0 = geo(tp), box = h("div", { "class": "dc-thumb" });
    app.replaceChildren(box);
    var k0 = Math.min(innerWidth / g0.w, innerHeight / g0.h);
    box.style.cssText = "width:" + g0.w + "px;height:" + g0.h + "px;transform:translate(" + (innerWidth - g0.w * k0) / 2 + "px," + (innerHeight - g0.h * k0) / 2 + "px) scale(" + k0 + ")";
    var done = false;
    var finish = function () { if (!done) { done = true; kit.ready(); } };
    // The systems first, so the picture has their styles and components.
    Promise.race([ds.ready, new Promise(function (r) { setTimeout(r, 3000); })]).then(function () {
      new Frame({ path: tp, mode: "view", wheel: "none", parent: box }).whenReady().then(finish);
    });
    setTimeout(finish, 8000);
    return;
  }

  // ------------------------------------------------------------------ the canvas
  var z = 1, tx = 0, ty = 0, page = startPage || pageOf(null);
  var boards = {}; // path -> {path, el, wrap, strip, frame, err, playing, errors}
  var overlay = h("div", { "class": "dc-overlay" }), notesLayer = h("div", { "class": "dc-notes" });
  world.append(notesLayer, overlay);
  function apply() {
    world.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + z + ")";
    world.style.setProperty("--z", z); world.style.setProperty("--inv", 1 / z);
    var g = 24 * z; while (g < 12) g *= 2;
    viewEl.style.backgroundSize = g + "px " + g + "px";
    viewEl.style.backgroundPosition = tx + "px " + ty + "px";
    zoomLabel.textContent = R(z * 100) + "%";
    drawSel(); placeTools(); sendView();
  }
  function vrect() { return viewEl.getBoundingClientRect(); }
  function zoomAt(f, sx, sy) {
    var nz = clamp(z * f, 0.02, 8), wx = (sx - tx) / z, wy = (sy - ty) / z;
    z = nz; tx = sx - wx * z; ty = sy - wy * z; apply();
  }
  function zoomTo(nz) { var r = vrect(); zoomAt(nz / z, r.width / 2, r.height / 2); }
  function fitRect(b, max) {
    var r = vrect(), pad = 64;
    if (!b || b.w <= 0) return;
    z = clamp(Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h, max || 1), 0.02, 8);
    tx = (r.width - b.w * z) / 2 - b.x * z; ty = (r.height - b.h * z) / 2 - b.y * z;
    apply();
  }
  function bounds(list) {
    var xs = [], ys = [], xe = [], ye = [];
    list.forEach(function (b) { xs.push(b.x); ys.push(b.y); xe.push(b.x + b.w); ye.push(b.y + b.h); });
    if (!xs.length) return null;
    var x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
    return { x: x, y: y, w: Math.max.apply(null, xe) - x, h: Math.max.apply(null, ye) - y };
  }
  function onPage(p) { return pageOf(entry(p) || auto[p]) === page; }
  function pagePaths() { return paths.filter(onPage); }
  function fitAll() {
    var list = pagePaths().map(function (p) { var g = geo(p); return { x: g.x, y: g.y - 30, w: g.w, h: g.h + 30 }; });
    Object.keys(canvas.notes).forEach(function (id) { var n = canvas.notes[id]; if (n && pageOf(n) === page && isFinite(n.x)) list.push({ x: +n.x, y: +n.y, w: +n.maxW || +n.w || 200, h: 80 }); });
    fitRect(bounds(list), 1);
  }
  function center(p) {
    var g = geo(p), r = vrect();
    tx = r.width / 2 - (g.x + g.w / 2) * z; ty = r.height / 2 - (g.y + g.h / 2) * z; apply();
  }

  // wheel and trackpad: pan; ctrl/pinch: zoom about the pointer
  function wheel(dx, dy, dm, ctrl, sx, sy, shift) {
    var k = dm === 1 ? 16 : dm === 2 ? 400 : 1;
    dx *= k; dy *= k;
    if (ctrl) { zoomAt(Math.exp(-dy * 0.0025 * (dm ? 4 : 1)), sx, sy); return; }
    if (shift && !dx) { dx = dy; dy = 0; }
    tx -= dx; ty -= dy; apply();
  }
  viewEl.addEventListener("wheel", function (e) {
    e.preventDefault();
    var r = vrect();
    wheel(e.deltaX, e.deltaY, e.deltaMode, e.ctrlKey || e.metaKey, e.clientX - r.left, e.clientY - r.top, e.shiftKey);
  }, { passive: false });
  var space = false;
  function setSpace(on) { if (space === on) return; space = on; viewEl.classList.toggle("is-space", on); broadcast({ t: "space", on: on }); }
  // drag the empty canvas (or space-drag, middle-drag anywhere) to pan
  viewEl.addEventListener("pointerdown", function (e) {
    var onBg = e.target === viewEl || e.target === world || e.target === notesLayer || e.target === overlay;
    if (!(e.button === 1 || (e.button === 0 && (space || onBg)))) return;
    e.preventDefault();
    if (onBg && e.button === 0 && !space) { commitAll(); select(null, []); selectBoard(null); }
    var x0 = e.clientX, y0 = e.clientY, t0 = tx, u0 = ty;
    capture(viewEl, e.pointerId);
    viewEl.classList.add("is-panning");
    function move(ev) { tx = t0 + ev.clientX - x0; ty = u0 + ev.clientY - y0; apply(); }
    function up() { viewEl.removeEventListener("pointermove", move); viewEl.removeEventListener("pointerup", up); viewEl.classList.remove("is-panning"); }
    viewEl.addEventListener("pointermove", move); viewEl.addEventListener("pointerup", up);
  });
  var framePan = null;

  // ------------------------------------------------------------------ artboards
  var COLORS = { gray: "#5f5e5a", red: "#b42318", orange: "#b54708", green: "#2b7a3d", teal: "#0f766e", blue: "#1d5bd8", purple: "#6d3fd1", pink: "#b8336a" };
  var FILLS = { gray: "#ebeae6", red: "#fdd8d3", orange: "#fde2c4", green: "#d6efd4", teal: "#cdeeea", blue: "#d9e6ff", purple: "#e6ddff", pink: "#fbd9e8" };
  function paint(c, map, fallback) { return map[c] || (typeof c === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(c) ? c : fallback); }
  function makeBoard(p) {
    var b = { path: p, playing: false, errors: [] };
    b.el = h("div", { "class": "dc-board", "data-path": p });
    b.wrap = h("div", { "class": "dc-frame" });
    b.name = h("span", { "class": "dc-name" });
    b.strip = h("div", { "class": "dc-strip" }, [h("span", { "class": "dc-dot", "aria-hidden": "true" }), b.name]);
    b.tw = sbtn("sliders", T.tweaks, function () { selectBoard(p); setTab("tweaks"); });
    b.playBtn = sbtn("play", T.play, function () { setPlay(b, !b.playing); });
    b.full = sbtn("expand", T.expand, function () { openFocus(p); });
    b.strip.append(b.tw, b.playBtn, b.full);
    b.err = h("div", { "class": "dc-err", hidden: true });
    b.guides = h("div", { "class": "dc-guides" });
    b.resize = h("div", { "class": "dc-resize", title: T.size });
    b.el.append(b.strip, b.wrap, b.guides, b.err, b.resize);
    world.insertBefore(b.el, notesLayer);
    b.strip.addEventListener("pointerdown", function (e) { if (e.button === 0 && !e.target.closest("button")) dragBoard(e, b); });
    b.strip.addEventListener("dblclick", function (e) { if (!e.target.closest("button")) openFocus(p); });
    b.resize.addEventListener("pointerdown", function (e) { if (e.button === 0) resizeBoard(e, b); });
    boards[p] = b;
    layoutBoard(b);
    return b;
  }
  function sbtn(icon, title, fn) {
    var bt = h("button", { type: "button", "class": "dc-sbtn", title: title, "aria-label": title, html: ICON[icon] || kit.icon(icon) });
    bt.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    bt.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
    return bt;
  }
  var ICON = {
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
  };
  function layoutBoard(b) {
    var p = b.path, g = geo(p), e = entry(p) || {}, z0 = canvas.order.indexOf(p);
    b.el.style.cssText = "left:" + g.x + "px;top:" + g.y + "px;width:" + g.w + "px;height:" + g.h + "px;--bw:" + g.w + "px;z-index:" + (z0 < 0 ? 1 : z0 + 2);
    b.el.hidden = !onPage(p);
    b.el.classList.toggle("is-frameless", !!e.frameless);
    b.wrap.style.borderRadius = num(e.radius, 0) ? num(e.radius, 0) + "px" : "";
    b.name.textContent = titleOf(p);
    b.el.classList.toggle("is-interactive", !!e.is_interactive);
    b.playBtn.hidden = !e.is_interactive;
    b.tw.hidden = !tweakKeys(p).length;
    b.el.classList.toggle("is-missing", !files[p]);
    if (!files[p]) { b.err.hidden = false; b.err.textContent = T.missing + ": " + p; }
    drawGuides(b, e.guides);
    if (!b.frame && !b.el.hidden && files[p]) {
      b.frame = new Frame({ path: p, mode: "edit", wheel: "forward", parent: b.wrap, onMsg: function (m) { boardMsg(b, m); } });
    }
  }
  function drawGuides(b, gs) {
    b.guides.replaceChildren();
    if (!Array.isArray(gs)) return;
    var g = geo(b.path);
    gs.slice(0, 6).forEach(function (gd) {
      if (!gd || gd.hidden) return;
      var col = paint(gd.color, {}, "rgba(255,0,0,.1)"), kind = gd.kind;
      if (kind === "grid") {
        var s = clamp(num(gd.size, 8), 2, 400);
        b.guides.appendChild(h("div", { "class": "dc-guide-grid", style: "background-image:linear-gradient(to right," + col + " 1px,transparent 1px),linear-gradient(to bottom," + col + " 1px,transparent 1px);background-size:" + s + "px " + s + "px" }));
        return;
      }
      var rows = kind === "rows", total = rows ? g.h : g.w, margin = num(gd.margin, 0), gutter = num(gd.gutter, rows ? 8 : 24);
      var align = gd.align || "stretch", count = gd.count, size = num(gd.size, rows ? 8 : 80), offset = num(gd.offset, 0), tracks = [];
      if (align === "stretch") {
        if (count === "auto" || count == null) count = rows ? Math.floor((total - 2 * margin + gutter) / (size + gutter)) : 12;
        count = clamp(num(count, 12), 1, 200);
        var tw = (total - 2 * margin - gutter * (count - 1)) / count;
        for (var i = 0; i < count; i++) tracks.push([margin + i * (tw + gutter), tw]);
      } else {
        if (count === "auto" || count == null) count = Math.floor((total - offset + gutter) / (size + gutter));
        count = clamp(num(count, 1), 1, 200);
        var span = count * size + (count - 1) * gutter;
        var start = align === "start" ? offset : align === "end" ? total - offset - span : (total - span) / 2;
        for (var j = 0; j < count; j++) tracks.push([start + j * (size + gutter), size]);
      }
      tracks.forEach(function (t) {
        b.guides.appendChild(h("div", { "class": "dc-guide", style: rows ? "left:0;right:0;top:" + t[0] + "px;height:" + t[1] + "px;background:" + col
          : "top:0;bottom:0;left:" + t[0] + "px;width:" + t[1] + "px;background:" + col }));
      });
    });
  }
  function layoutAll() {
    paths = boardPaths();
    Object.keys(boards).forEach(function (p) { if (paths.indexOf(p) < 0) { if (boards[p].frame) boards[p].frame.dispose(); boards[p].el.remove(); delete boards[p]; } });
    paths.forEach(function (p) { if (boards[p]) layoutBoard(boards[p]); else makeBoard(p); });
    renderNotes(); drawSel();
  }
  function showErrors(b) {
    var has = b.errors.length > 0;
    b.el.classList.toggle("has-error", has);
    if (files[b.path]) {
      b.err.hidden = !has;
      b.err.replaceChildren();
      if (has) {
        b.err.append(h("span", { text: T.error + ": " + b.errors[0] }));
        if (editable && window.hermes && window.hermes.send) {
          var fx = h("button", { type: "button", "class": "dc-fix", text: T.fixIt });
          fx.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
          fx.addEventListener("click", function (e) {
            e.stopPropagation();
            window.hermes.send(T.fixMsg(b.path, String(b.errors[0]).slice(0, 300)), { artboard: b.path }, { deliver: "send" })
              .then(function (r) { if (!(r && r.mode === "declined")) kit.toast(T.sent); }).catch(function (er) { kit.toast(String(er && er.message || er)); });
          });
          b.err.append(fx);
        }
      }
    }
  }

  function dragBoard(e, b) {
    e.preventDefault();
    commitAll();
    selectBoard(b.path);
    var x0 = e.clientX, y0 = e.clientY, g = geo(b.path), started = false;
    capture(b.strip, e.pointerId);
    function move(ev) {
      var dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
      if (!started) { if (Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return; started = true; checkpoint(); }
      var en = ensureEntry(b.path);
      en.x = R(g.x + dx); en.y = R(g.y + dy);
      if (!ev.altKey) { en.x = R(en.x / 8) * 8; en.y = R(en.y / 8) * 8; }
      layoutBoard(b); drawSel();
    }
    function up() {
      b.strip.removeEventListener("pointermove", move); b.strip.removeEventListener("pointerup", up);
      if (started) changed();
    }
    b.strip.addEventListener("pointermove", move); b.strip.addEventListener("pointerup", up);
  }
  function resizeBoard(e, b) {
    e.preventDefault(); e.stopPropagation();
    var x0 = e.clientX, y0 = e.clientY, g = geo(b.path), started = false;
    capture(b.resize, e.pointerId);
    function move(ev) {
      if (!started) { started = true; checkpoint(); }
      var en = ensureEntry(b.path);
      en.w = clamp(R(g.w + (ev.clientX - x0) / z), 40, 8000); en.h = clamp(R(g.h + (ev.clientY - y0) / z), 40, 8000);
      layoutBoard(b); drawSel();
    }
    function up() { b.resize.removeEventListener("pointermove", move); b.resize.removeEventListener("pointerup", up); if (started) { changed(); renderPanel(); } }
    b.resize.addEventListener("pointermove", move); b.resize.addEventListener("pointerup", up);
  }

  // ------------------------------------------------------------------ notes: titles and stickies
  var SIZES = { s: 14, m: 17, l: 22, xl: 28, xxl: 36 }, TSIZES = { s: 40, m: 52, l: 64, xl: 72, xxl: 96 };
  function renderNotes() {
    notesLayer.replaceChildren();
    Object.keys(canvas.notes).forEach(function (id) {
      var n = canvas.notes[id];
      if (!n || typeof n !== "object" || !isFinite(+n.x) || !isFinite(+n.y) || pageOf(n) !== page) return;
      var el;
      if (n.kind === "title1") {
        var fs = typeof n.size === "number" ? n.size : TSIZES[n.size] || 72;
        el = h("div", { "class": "dc-note dc-title1", text: String(n.text || "") });
        el.style.cssText = "left:" + n.x + "px;top:" + n.y + "px;font-size:" + fs + "px;color:" + paint(n.color, COLORS, "var(--dc-note-fg)") +
          (n.bold === false ? ";font-weight:400" : "") + (n.italic ? ";font-style:italic" : "");
        notesLayer.appendChild(el);
        var maxW = num(n.maxW, 0), maxH = num(n.maxH, 0);
        if (maxW && el.scrollWidth > maxW) el.style.fontSize = Math.max(12, fs * maxW / el.scrollWidth) + "px";
        if (maxH && el.offsetHeight > maxH) el.style.fontSize = Math.max(12, parseFloat(el.style.fontSize) * maxH / el.offsetHeight) + "px";
        if (maxW) el.style.maxWidth = maxW + "px";
      } else if (!n.kind) {
        var w = clamp(num(n.w, 240), 60, 2000), fz = typeof n.size === "number" ? n.size : SIZES[n.size] || 17;
        el = h("div", { "class": "dc-note dc-sticky", text: String(n.text || "") });
        el.style.cssText = "left:" + n.x + "px;top:" + n.y + "px;width:" + w + "px;max-height:" + (num(n.maxH, 0) || w * 4 / 3) + "px;font-size:" + fz + "px;" +
          "background:" + paint(n.fill, FILLS, "#fdf1b8") + ";color:" + paint(n.color, COLORS, "#2b2a26") + (n.bold ? ";font-weight:600" : "") + (n.italic ? ";font-style:italic" : "");
        notesLayer.appendChild(el);
      } else if (n.kind === "link" && /^https?:\/\/[^\s"<>]+$/i.test(String(n.url || ""))) {
        // A link card: a page the canvas points at (its title, or the host, and the address).
        var u = String(n.url), host = u.replace(/^https?:\/\//i, "").split(/[\/?#]/)[0];
        el = h("div", { "class": "dc-note dc-link" }, [
          h("a", { href: u, target: "_blank", rel: "noopener noreferrer", "class": "dc-link-t", text: String(n.text || host).slice(0, 200) }),
          h("span", { "class": "dc-link-u", text: u.slice(0, 300) })]);
        el.style.cssText = "left:" + n.x + "px;top:" + n.y + "px;width:" + clamp(num(n.w, 320), 120, 2000) + "px";
        notesLayer.appendChild(el);
      } else if ((n.kind === "rect" || n.kind === "oval") && num(n.w, 0) && num(n.h, 0)) {
        el = h("div", { "class": "dc-note dc-shape" });
        el.style.cssText = "left:" + n.x + "px;top:" + n.y + "px;width:" + n.w + "px;height:" + n.h + "px;border-radius:" + (n.kind === "oval" ? "50%" : "4px") +
          ";background:" + paint(n.fill, FILLS, "transparent") + ";border-color:" + paint(n.color, COLORS, "var(--color-fg-muted)");
        notesLayer.appendChild(el);
      } else if (n.kind === "line" || n.kind === "arrow" || n.kind === "pen") {
        // drawn with a tool: a straight stroke (x,y to x2,y2), or a pen stroke (points from x,y)
        var pts = n.kind === "pen" ? (Array.isArray(n.points) ? n.points : []).filter(function (q) { return Array.isArray(q) && isFinite(+q[0]) && isFinite(+q[1]); }).slice(0, 4000)
          : [[0, 0], [num(n.x2, +n.x + 200) - n.x, num(n.y2, +n.y) - n.y]];
        if (pts.length > 1) {
          var xs = pts.map(function (q) { return +q[0]; }), ys = pts.map(function (q) { return +q[1]; }), pad = 12;
          var x0 = Math.min.apply(null, xs) - pad, y0 = Math.min.apply(null, ys) - pad, bw = Math.max.apply(null, xs) - x0 + pad, bh = Math.max.apply(null, ys) - y0 + pad;
          var path = pts.map(function (q, k) { return (k ? "L" : "M") + (q[0] - x0) + " " + (q[1] - y0); }).join("");
          if (n.kind === "arrow") { // the head: two short strokes back from the tip
            var q1 = pts[0], q2 = pts[1], ang = Math.atan2(q2[1] - q1[1], q2[0] - q1[0]), hx = q2[0] - x0, hy = q2[1] - y0;
            [ang + 2.6, ang - 2.6].forEach(function (t) { path += "M" + hx + " " + hy + "L" + (hx + 16 * Math.cos(t)) + " " + (hy + 16 * Math.sin(t)); });
          }
          el = h("div", { "class": "dc-note dc-draw", html: '<svg width="' + bw + '" height="' + bh + '" viewBox="0 0 ' + bw + " " + bh + '" fill="none" stroke="currentColor" stroke-width="' +
            clamp(num(n.w, 3), 1, 24) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>' });
          el.style.cssText = "left:" + (+n.x + x0) + "px;top:" + (+n.y + y0) + "px;color:" + paint(n.color, COLORS, "var(--dc-note-fg)");
          el.__off = { x: x0, y: y0 };
          notesLayer.appendChild(el);
        }
      }
      if (!el) return;
      el.setAttribute("data-note", id);
      if (editable) {
        el.addEventListener("pointerdown", function (e) { if (e.button === 0 && el.contentEditable !== "true") dragNote(e, el, id); });
        if (n.kind === "title1" || !n.kind) el.addEventListener("dblclick", function () { editNote(el, id); });
      }
      if (id === selNote) el.classList.add("is-sel");
    });
  }
  function dragNote(e, el, id) {
    e.preventDefault(); e.stopPropagation();
    commitAll();
    var n = canvas.notes[id], x0 = e.clientX, y0 = e.clientY, nx = +n.x, ny = +n.y, started = false, off = el.__off || { x: 0, y: 0 };
    var ex = isFinite(+n.x2) ? +n.x2 - nx : null, ey = isFinite(+n.y2) ? +n.y2 - ny : null;
    capture(el, e.pointerId);
    function move(ev) {
      if (!started) { if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 4) return; started = true; checkpoint(); }
      n.x = R(nx + (ev.clientX - x0) / z); n.y = R(ny + (ev.clientY - y0) / z);
      if (ex != null) { n.x2 = n.x + ex; n.y2 = n.y + ey; }
      el.style.left = n.x + off.x + "px"; el.style.top = n.y + off.y + "px";
    }
    function up() { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); if (started) changed(); }
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
  }
  function editNote(el, id) {
    var before = el.textContent;
    el.contentEditable = "plaintext-only";
    if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    el.focus();
    var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r);
    function done() {
      el.removeEventListener("blur", done);
      el.contentEditable = "false";
      var text = el.innerText.replace(/\n$/, "");
      if (text !== before) { checkpoint(); canvas.notes[id].text = text; changed(); }
      renderNotes();
    }
    el.addEventListener("blur", done);
    el.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Escape" || (e.key === "Enter" && canvas.notes[id].kind === "title1")) { e.preventDefault(); el.blur(); } });
  }

  // ------------------------------------------------------------------ messages from artboards
  function boardMsg(b, m) {
    switch (m.t) {
      case "error": b.errors = Array.isArray(m.errors) ? m.errors.map(String) : []; showErrors(b); sendView(); break;
      case "sel":
        if (b.playing) break;
        if (m.board) { select(null, []); selectBoard(b.path); break; }
        receiveSel(b, m); break;
      case "hover": hoverRect = m.rect ? { path: b.path, r: m.rect } : null; drawHover(); break;
      case "wheel": var p = toView(b, m.x, m.y); wheel(m.dx, m.dy, m.dm, m.ctrl, p.x, p.y, false); break;
      case "pan":
        if (m.ph === "start") { framePan = { sx: m.sx, sy: m.sy }; viewEl.classList.add("is-panning"); }
        else if (m.ph === "move" && framePan) { tx += m.sx - framePan.sx; ty += m.sy - framePan.sy; framePan.sx = m.sx; framePan.sy = m.sy; apply(); }
        else { framePan = null; viewEl.classList.remove("is-panning"); }
        break;
      case "down": closeMenus(); if (sel.path && sel.path !== b.path) { boards[sel.path] && boards[sel.path].frame && boards[sel.path].frame.send({ t: "commit" }); } break;
      case "key": key(m); break;
      case "editing": editing = m.on ? { path: b.path, tid: m.tid } : null; drawTools(); sendView(); break;
      case "text": applyText(b.path, m.tid, m.html); break;
      case "link": followLink(b.path, m.file); break;
      case "drop": replaceImage(b.path, m.tid, m.url, m.type, m.size); break;
      case "size": b.contentH = m.h; break;
    }
  }
  function toView(b, x, y) {
    var r = b.wrap.getBoundingClientRect(), v = vrect(), k = r.width / geo(b.path).w;
    return { x: r.left - v.left + x * k, y: r.top - v.top + y * k };
  }

  // ------------------------------------------------------------------ selection
  var sel = { path: null, tids: [], info: {} }, selBoard = null, hoverRect = null, editing = null;
  var selLayer = h("div"), hoverBox = h("div", { "class": "dc-hover", hidden: true });
  overlay.append(selLayer, hoverBox);
  function receiveSel(b, m) {
    var items = (m.items || []).filter(function (it) { return it && typeof it.tid === "number" && it.count > 0; });
    var same = sel.path === b.path && items.map(function (i) { return i.tid; }).join() === sel.tids.join();
    if (sel.path && sel.path !== b.path && boards[sel.path] && boards[sel.path].frame) boards[sel.path].frame.send({ t: "select", tids: [] });
    selBoard = null;
    sel = { path: items.length ? b.path : null, tids: items.map(function (i) { return i.tid; }), info: {} };
    items.forEach(function (i) { sel.info[i.tid] = i; });
    drawSel(); drawTools(); drawCrumbs();
    if (!same) renderPanel(); else refreshComputed();
    sendView();
  }
  /** Select elements (tids) of an artboard: the frame answers with where they are. */
  function select(path, tids, scroll) {
    if (sel.path && sel.path !== path && boards[sel.path] && boards[sel.path].frame) boards[sel.path].frame.send({ t: "select", tids: [] });
    if (!path || !tids.length) { sel = { path: null, tids: [], info: {} }; drawSel(); drawTools(); drawCrumbs(); renderPanel(); sendView(); return; }
    selBoard = null;
    if (boards[path] && boards[path].frame) boards[path].frame.send({ t: "select", tids: tids, scroll: !!scroll });
  }
  function selectBoard(p) {
    if (p && sel.path) select(null, []);
    selBoard = p;
    drawSel(); drawTools(); drawCrumbs(); renderPanel(); sendView();
  }
  function drawSel() {
    selLayer.replaceChildren();
    if (selBoard && boards[selBoard] && onPage(selBoard)) {
      var g = geo(selBoard);
      selLayer.appendChild(h("div", { "class": "dc-selbox is-board", style: "left:" + g.x + "px;top:" + g.y + "px;width:" + g.w + "px;height:" + g.h + "px" }));
    }
    if (sel.path && boards[sel.path] && onPage(sel.path)) {
      var o = geo(sel.path);
      sel.tids.forEach(function (tid) {
        ((sel.info[tid] || {}).rects || []).forEach(function (r) {
          var x = Math.max(0, r.x), y = Math.max(0, r.y), x2 = Math.min(o.w, r.x + r.w), y2 = Math.min(o.h, r.y + r.h);
          if (x2 < x || y2 < y) return;
          selLayer.appendChild(h("div", { "class": "dc-selbox" + (editing ? " is-editing" : ""), style: "left:" + (o.x + x) + "px;top:" + (o.y + y) + "px;width:" + (x2 - x) + "px;height:" + (y2 - y) + "px" }));
        });
      });
    }
    drawHover();
  }
  function drawHover() {
    var hr = hoverRect;
    if (!hr || !boards[hr.path] || (sel.path === hr.path && editing)) { hoverBox.hidden = true; return; }
    var o = geo(hr.path), r = hr.r;
    hoverBox.hidden = false;
    hoverBox.style.cssText = "left:" + (o.x + r.x) + "px;top:" + (o.y + r.y) + "px;width:" + r.w + "px;height:" + r.h + "px";
  }

  // breadcrumb: the selected element's template ancestors
  var crumbs = h("nav", { "class": "dc-crumbs", "aria-label": "Breadcrumb", hidden: true });
  viewEl.appendChild(crumbs);
  function nodeOf(path, tid) { var f = files[path]; return f ? f.nodes[tid] : null; }
  function tagLabel(n) {
    var t = n.localName;
    if (t === "dc-import") return "<" + (n.getAttribute("name") || "import") + ">";
    var cls = (n.getAttribute("class") || "").trim().split(/\s+/)[0];
    return t + (n.id ? "#" + n.id : cls && cls.indexOf("{{") < 0 ? "." + cls : "");
  }
  function ancestors(n) {
    var out = [];
    for (var p = n; p && p.nodeType === 1; p = p.parentNode) if (!/^(sc-for|sc-if)$/.test(p.localName)) out.unshift(p);
    return out;
  }
  function drawCrumbs() {
    crumbs.replaceChildren();
    var n = sel.path && sel.tids.length ? nodeOf(sel.path, sel.tids[sel.tids.length - 1]) : null;
    if (!n && !selBoard) { crumbs.hidden = true; return; }
    crumbs.hidden = false;
    var bp = sel.path || selBoard;
    crumbs.appendChild(h("button", { type: "button", text: titleOf(bp), onclick: function () { selectBoard(bp); } }));
    if (n) ancestors(n).forEach(function (a) {
      crumbs.appendChild(h("span", { "class": "dc-crumb-sep", text: "›", "aria-hidden": "true" }));
      crumbs.appendChild(h("button", { type: "button", "class": a === n ? "is-on" : null, text: tagLabel(a), onclick: function () { select(sel.path, [a.__dcTid]); } }));
    });
  }

  // ------------------------------------------------------------------ element toolbar
  var tools = h("div", { "class": "dc-tools", hidden: true, role: "toolbar" });
  document.body.appendChild(tools);
  function tbtn(icon, label, fn, withText) {
    var b = h("button", { type: "button", "class": "kit-btn", title: label, "aria-label": label, html: kit.icon(icon) });
    if (withText) b.appendChild(h("span", { text: label }));
    b.addEventListener("click", fn);
    return b;
  }
  function drawTools() {
    var n = sel.path && sel.tids.length ? nodeOf(sel.path, sel.tids[0]) : null;
    if (!editable || (!n && !selBoard) || focus) { tools.hidden = true; return; }
    var kids = [];
    if (n && sel.tids.length === 1 && DC.textEditable(n) && !editing) kids.push(tbtn("text", T.editText, function () { boards[sel.path].frame.send({ t: "edit", tid: sel.tids[0] }); }));
    if (n && n.localName === "img") kids.push(tbtn("image", T.image, function () { pickImage(sel.path, sel.tids[0]); }));
    kids.push(tbtn("sparkle", T.ask, askAbout, true), tbtn("comment", T.comment, commentOn, true));
    if (n && !editing) {
      kids.push(tbtn("copy", T.dupEl, dupSel), tbtn("front", T.forward, function () { reorderSel(1); }), tbtn("back", T.backward, function () { reorderSel(-1); }));
      if (sameParent().length > 1) kids.push(tbtn("grid", T.group, groupSel));
      else if (n.localName === "div" && n.children.length && n.parentNode && n.parentNode.nodeType === 1) kids.push(tbtn("panel", T.ungroup, ungroupSel));
      kids.push(tbtn("trash", T.del, removeSel));
    }
    tools.replaceChildren.apply(tools, kids);
    tools.hidden = false;
    placeTools();
  }
  function selScreenRect() {
    var v = vrect();
    if (sel.path && sel.tids.length) {
      var o = geo(sel.path), rs = [];
      sel.tids.forEach(function (t) { ((sel.info[t] || {}).rects || []).slice(0, 1).forEach(function (r) { rs.push({ x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h }); }); });
      var u = bounds(rs);
      if (u) return { left: v.left + tx + u.x * z, top: v.top + ty + u.y * z, bottom: v.top + ty + (u.y + u.h) * z };
    }
    if (selBoard) { var g = geo(selBoard); return { left: v.left + tx + g.x * z, top: v.top + ty + (g.y - 30) * z, bottom: v.top + ty + (g.y + g.h) * z }; }
    return null;
  }
  function placeTools() {
    if (tools.hidden) return;
    var r = selScreenRect();
    if (!r) { tools.hidden = true; return; }
    var v = vrect(), top = r.top - tools.offsetHeight - 10;
    if (top < v.top + 4) top = r.bottom + 10;
    tools.style.top = clamp(top, v.top + 4, innerHeight - tools.offsetHeight - 8) + "px";
    tools.style.left = clamp(r.left, v.left + 4, v.right - tools.offsetWidth - 8) + "px";
  }

  // ------------------------------------------------------------------ editing the templates
  function snap() { return { files: Object.assign({}, cur), canvas: canvasText() }; }
  var undos = [], redos = [], edits = 0;
  function checkpoint() { undos.push(snap()); if (undos.length > 100) undos.shift(); redos = []; edits++; }
  function setFiles(changedFiles) {
    var ch = {};
    Object.keys(changedFiles).forEach(function (p) { if (cur[p] !== changedFiles[p]) { cur[p] = changedFiles[p]; files[p] = DC.parse(cur[p]); ch[p] = cur[p]; } });
    if (Object.keys(ch).length) broadcast({ t: "src", sources: ch });
    return ch;
  }
  function restore(s) {
    commitAll();
    setFiles(s.files);
    if (s.canvas !== canvasText()) {
      var before = JSON.stringify(canvas.boards);
      canvas = JSON.parse(s.canvas);
      if (before !== JSON.stringify(canvas.boards)) frames.forEach(function (f) { f.send({ t: "props", props: propsOf(f.path) }); });
      layoutAll();
    }
    if (sel.path) select(sel.path, sel.tids); else { renderPanel(); drawSel(); }
    changed();
  }
  function undo() { if (!undos.length) return; redos.push(snap()); restore(undos.pop()); }
  function redo() { if (!redos.length) return; undos.push(snap()); restore(redos.pop()); }
  /** A template was edited in place: its text again, to the frames, and saved. */
  function commitFile(path) {
    var text = DC.serialize(files[path]), o = {};
    o[path] = text;
    cur[path] = null;
    setFiles(o);
    changed();
  }
  function applyText(path, tid, html) {
    var n = nodeOf(path, tid);
    if (!n || !DC.textEditable(n)) { var o = {}; o[path] = cur[path]; broadcast({ t: "src", sources: o }); return; }
    checkpoint();
    DC.applyText(n, String(html).slice(0, 200000));
    commitFile(path);
    if (sel.path === path) select(path, sel.tids);
  }
  function setStyle(prop, value, noCheckpoint) {
    if (!sel.path || !sel.tids.length) return;
    if (!noCheckpoint) checkpoint();
    sel.tids.forEach(function (tid) {
      var n = nodeOf(sel.path, tid);
      if (!n) return;
      var s = DC.styleSet(n.getAttribute("style") || "", prop, value);
      if (s) n.setAttribute("style", s); else n.removeAttribute("style");
    });
    commitFile(sel.path);
    select(sel.path, sel.tids);
  }
  function setAttr(name, value) {
    if (!sel.path || !sel.tids.length) return;
    checkpoint();
    sel.tids.forEach(function (tid) { var n = nodeOf(sel.path, tid); if (!n) return; if (value) n.setAttribute(name, value); else n.removeAttribute(name); });
    commitFile(sel.path);
    select(sel.path, sel.tids);
  }
  function removeSel() {
    if (!sel.path || !sel.tids.length) return;
    checkpoint();
    var p = sel.path;
    sel.tids.map(function (t) { return nodeOf(p, t); }).forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    select(null, []);
    commitFile(p);
  }
  // ------------------------------------------------------------------ element operations
  /** The selected nodes in document order, when they share one parent (else just the first). */
  function sameParent() {
    if (!sel.path) return [];
    var ns = sel.tids.map(function (t) { return nodeOf(sel.path, t); }).filter(Boolean);
    if (!ns.length) return [];
    var par = ns[0].parentNode;
    ns = ns.filter(function (n) { return n.parentNode === par; });
    return ns.sort(function (a, b) { return a.__dcTid - b.__dcTid; });
  }
  /** After a change to the template: number it again and select these nodes (the reparse keeps the order). */
  function settle(p, nodes) {
    DC.index(files[p]);
    var tids = nodes.map(function (n) { return n.__dcTid; }).filter(function (t) { return typeof t === "number"; });
    commitFile(p);
    select(p, tids);
  }
  function dupSel() {
    var ns = sameParent(), p = sel.path;
    if (!ns.length) return;
    checkpoint();
    var last = ns[ns.length - 1], copies = ns.map(function (n) { return n.cloneNode(true); });
    copies.forEach(function (c) { last.parentNode.insertBefore(c, last.nextSibling); last = c; });
    settle(p, copies);
  }
  function groupSel() {
    var ns = sameParent(), p = sel.path;
    if (ns.length < 2) return;
    checkpoint();
    var doc = ns[0].ownerDocument, g = doc.createElement("div");
    ns[0].parentNode.insertBefore(g, ns[0]);
    ns.forEach(function (n) { g.appendChild(n); });
    settle(p, [g]);
  }
  function ungroupSel() {
    var g = sel.path && nodeOf(sel.path, sel.tids[0]), p = sel.path;
    if (!g || g.localName !== "div" || !g.children.length || !g.parentNode || g.parentNode.nodeType !== 1) return;
    checkpoint();
    var kids = Array.prototype.slice.call(g.children);
    while (g.firstChild) g.parentNode.insertBefore(g.firstChild, g);
    g.parentNode.removeChild(g);
    settle(p, kids);
  }
  /** Forward (later in the order: over its siblings) or backward, one step. */
  function reorderSel(d) {
    var ns = sameParent(), p = sel.path;
    if (!ns.length) return;
    var par = ns[0].parentNode;
    if (d > 0) { var after = ns[ns.length - 1].nextElementSibling; if (!after) return; checkpoint(); ns.forEach(function (n) { par.insertBefore(n, after.nextSibling); after = n; }); }
    else { var before = ns[0].previousElementSibling; if (!before) return; checkpoint(); ns.forEach(function (n) { par.insertBefore(n, before); }); }
    settle(p, ns);
  }
  function commitAll() { frames.forEach(function (f) { if (f.mode === "edit") f.send({ t: "commit" }); }); }

  // images: replace an <img>'s picture with an upload (uploads/<name>.<ext>)
  var uploads = {};
  var filePick = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true });
  document.body.appendChild(filePick);
  function pickImage(path, tid) {
    filePick.onchange = function () {
      var f = filePick.files[0]; filePick.value = "";
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { replaceImage(path, tid, fr.result, f.type, f.size); };
      fr.readAsDataURL(f);
    };
    filePick.click();
  }
  function shrink(url, type, size) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(type || "") || !/^data:image\/(png|jpeg|gif|webp);base64,/.test(url || "")) return reject(new Error(T.imgOnly));
      var img = new Image();
      img.onload = function () {
        if (size <= 8 * 1024 * 1024 && Math.max(img.naturalWidth, img.naturalHeight) <= 4096) return resolve({ url: url, type: type });
        var k = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
        c.width = R(img.naturalWidth * k); c.height = R(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        var out = c.toDataURL("image/jpeg", 0.88);
        if (out.length * 0.75 > 8 * 1024 * 1024) return reject(new Error(T.tooBig));
        resolve({ url: out, type: "image/jpeg" });
      };
      img.onerror = function () { reject(new Error(T.imgOnly)); };
      img.src = url;
    });
  }
  function replaceImage(path, tid, url, type, size) {
    var n = nodeOf(path, tid);
    if (!n || n.localName !== "img") return;
    shrink(url, type, size || 0).then(function (im) {
      var ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[im.type];
      var up = "uploads/" + Math.random().toString(36).slice(2, 10) + "." + ext;
      C.files[up] = im.url; uploads[up] = im.url;
      var u = {}; u[up] = im.url;
      broadcast({ t: "urls", urls: u });
      checkpoint();
      n.setAttribute("src", new Array(path.split("/").length).join("../") + up);
      commitFile(path);
      select(path, [tid]);
    }).catch(function (e) { kit.toast(String(e && e.message || e)); });
  }

  // ------------------------------------------------------------------ properties panel
  var tab = "design", panelHidden = false;
  function setTab(t) { tab = t; panelHidden = false; renderPanel(); }
  function computed(k) { var i = sel.info[sel.tids[0]]; return i && i.computed ? i.computed[k] || "" : ""; }
  function inline(prop) { var n = nodeOf(sel.path, sel.tids[0]); return n ? DC.styleGet(n.getAttribute("style") || "", prop) : ""; }
  function hex(c) {
    var m = String(c || "").match(/rgba?\(([^)]+)\)/);
    if (!m) return /^#[0-9a-f]{6}$/i.test(c) ? c : /^#[0-9a-f]{3}$/i.test(c) ? "#" + c.slice(1).split("").map(function (x) { return x + x; }).join("") : "#000000";
    return "#" + m[1].split(/[\s,\/]+/).slice(0, 3).map(function (v) { return ("0" + clamp(R(+v), 0, 255).toString(16)).slice(-2); }).join("");
  }
  function px(v) { v = String(v).trim(); return /^-?\d+(\.\d+)?$/.test(v) ? v + "px" : v; }
  function row(label, ctl) { return h("label", { "class": "dc-row" }, [h("span", { text: label }), ctl]); }
  function boundNote(v) { return v.indexOf("{{") >= 0; }
  function textField(prop, ph, norm) {
    var v = inline(prop), inp = h("input", { type: "text", value: v, placeholder: ph || "", spellcheck: "false" });
    if (boundNote(v)) { inp.disabled = true; inp.title = T.bound; return inp; }
    inp.addEventListener("change", function () { setStyle(prop, (norm || px)(inp.value)); });
    inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") inp.blur(); });
    return inp;
  }
  function colorField(prop, comp) {
    var v = inline(prop), wrap = h("span", { "class": "dc-color" });
    var sw = h("input", { type: "color", value: hex(v || computed(comp)), "aria-label": prop });
    var tx2 = h("input", { type: "text", value: v, placeholder: computed(comp), spellcheck: "false" });
    if (boundNote(v)) { sw.disabled = tx2.disabled = true; tx2.title = T.bound; }
    var live = false;
    sw.addEventListener("input", function () { setStyle(prop, sw.value, live); live = true; tx2.value = sw.value; });
    sw.addEventListener("change", function () { live = false; });
    tx2.addEventListener("change", function () { setStyle(prop, tx2.value.trim()); });
    tx2.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") tx2.blur(); });
    wrap.append(sw, tx2);
    if (ds.model && ds.model.colors.length) {
      var sws = h("span", { "class": "dc-swatches" });
      ds.model.colors.slice(0, 24).forEach(function (c) {
        sws.appendChild(h("button", { type: "button", title: c.name, "aria-label": c.name, style: "background:var(--ds-preview," + (ds.model.resolve(c.name) || "#ccc") + ")",
          onclick: function () { setStyle(prop, "var(--" + c.name + ")"); } }));
      });
      return h("span", { "class": "dc-colorbox" }, [wrap, sws]);
    }
    return wrap;
  }
  function selectField(prop, opts) {
    var v = inline(prop), s = h("select", {}, [h("option", { value: "", text: "—" })].concat(opts.map(function (o) { return h("option", { value: o, text: o }); })));
    if (v && opts.indexOf(v) < 0) s.appendChild(h("option", { value: v, text: v }));
    s.value = v;
    if (boundNote(v)) s.disabled = true;
    s.addEventListener("change", function () { setStyle(prop, s.value); });
    return s;
  }
  function segField(prop, opts) {
    var v = inline(prop) || computed("textAlign"), seg = h("span", { "class": "kit-seg" });
    opts.forEach(function (o) {
      seg.appendChild(h("button", { type: "button", "class": "kit-btn", "aria-pressed": String(v === o[0]), title: o[0], "aria-label": o[0], html: kit.icon(o[1]),
        onclick: function () { setStyle(prop, v === o[0] && inline(prop) ? "" : o[0]); } }));
    });
    return seg;
  }
  var TRACKS = /^repeat\(\s*(\d+)\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)$/;
  function trackField(prop) {
    var v = inline(prop), m = TRACKS.exec(v), inp = h("input", { type: "text", value: m ? m[1] : v, placeholder: m || !v ? "1" : "", spellcheck: "false" });
    if (boundNote(v)) { inp.disabled = true; return inp; }
    inp.addEventListener("change", function () {
      var t = inp.value.trim();
      setStyle(prop, /^\d+$/.test(t) && +t > 0 ? "repeat(" + clamp(+t, 1, 48) + ", minmax(0, 1fr))" : t);
    });
    inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") inp.blur(); });
    return inp;
  }
  function section(title, rows) { return h("section", { "class": "dc-sec" }, [h("h3", { text: title })].concat(rows)); }
  function renderPanel() {
    if (!editable) return;
    var bp = sel.path || selBoard;
    panelEl.hidden = panelHidden || !!focus || (!bp && tab !== "outline");
    panelBtn.classList.toggle("is-on", !panelHidden);
    if (panelEl.hidden) return;
    var tabBtn = function (k, label) { return h("button", { type: "button", "class": "kit-btn", "aria-pressed": String(tab === k), text: label, onclick: function () { setTab(k); } }); };
    var tabs = h("div", { "class": "dc-tabs" }, [tabBtn("design", T.properties), tabBtn("outline", T.outline), tabBtn("code", T.code), tabBtn("tweaks", T.tweaks),
      h("span", { "class": "dc-gap" }), h("button", { type: "button", "class": "kit-btn", title: T.panel, "aria-label": T.panel, html: kit.icon("close"), onclick: function () { panelHidden = true; renderPanel(); } })]);
    var body = tab === "outline" ? outlinePanel() : !bp ? h("div", { "class": "dc-pbody dc-pnote", text: T.nothing })
      : tab === "code" ? codePanel(bp) : tab === "tweaks" ? tweaksPanel(bp) : sel.path && sel.tids.length ? designPanel() : boardPanel(bp);
    panelEl.replaceChildren(tabs, body);
  }
  /** Outline: the page's notes, then each artboard and (for the open one) its elements; a click selects. */
  var openOutline = {};
  function outlinePanel() {
    var out = h("div", { "class": "dc-pbody dc-outline" });
    var skip = /^(helmet|style|script|link)$/;
    var line = function (depth, icon, label, sub, on, click, caret) {
      var r = h("button", { type: "button", "class": "dc-orow" + (on ? " is-on" : ""), style: "padding-left:" + (6 + depth * 14) + "px", onclick: click },
        [h("span", { "class": "dc-ocaret", html: caret == null ? "" : kit.icon(caret ? "caretDown" : "caretRight") }), h("span", { "class": "dc-oicon", html: kit.icon(icon) }),
         h("b", { text: label }), h("span", { text: sub || "" })]);
      out.appendChild(r);
      return r;
    };
    Object.keys(canvas.notes).forEach(function (id) {
      var n = canvas.notes[id];
      if (!n || typeof n !== "object" || pageOf(n) !== page) return;
      var kind = n.kind === "title1" ? [T.noteTitle, "text"] : !n.kind ? [T.noteSticky, "sticky"] : n.kind === "link" ? [T.noteLink, "sticky"] : /^(rect|oval)$/.test(n.kind) ? [T.noteShape, "shape"] : [T.noteDraw, "pencil"];
      line(0, kind[1], kind[0], String(n.text || "").slice(0, 28), id === selNote, function () { selectNote(id); renderPanel(); });
    });
    var walk = function (p, el, depth) {
      if (depth > 9) return;
      Array.prototype.forEach.call(el.children, function (c) {
        if (skip.test(c.localName)) return;
        var tid = c.__dcTid, key = p + "#" + tid, kids = Array.prototype.some.call(c.children, function (k) { return !skip.test(k.localName); });
        var text = Array.prototype.filter.call(c.childNodes, function (t) { return t.nodeType === 3; }).map(function (t) { return t.nodeValue; }).join(" ").replace(/[ \t\n\r]+/g, " ").trim().slice(0, 26);
        var isText = /^(h[1-6]|p|span|a|li|button|label)$/.test(c.localName), isImg = c.localName === "img";
        line(depth, isImg ? "image" : isText ? "text" : "frame", tagLabel(c), text, sel.path === p && sel.tids.indexOf(tid) >= 0, function () {
          if (kids) openOutline[key] = !openOutline[key];
          if (tid != null) select(p, [tid]); else renderPanel();
        }, kids ? !!openOutline[key] : null);
        if (kids && openOutline[key]) walk(p, c, depth + 1);
      });
    };
    pagePaths().forEach(function (p) {
      var open = openOutline[p] == null ? p === (sel.path || selBoard) : openOutline[p];
      line(0, "frame", titleOf(p), "", selBoard === p && !sel.path, function () { openOutline[p] = !open; selectBoard(p); renderPanel(); }, open);
      if (open && files[p]) walk(p, files[p].tpl, 1);
    });
    return out;
  }
  /** Code: the selected element's markup, else the artboard's whole file, to read and copy. */
  function codePanel(p) {
    var n = sel.path && sel.tids.length ? nodeOf(sel.path, sel.tids[0]) : null, text = n ? n.outerHTML : cur[p] || "";
    var copy = h("button", { type: "button", "class": "kit-btn dc-wide", text: T.copyCode, onclick: function () {
      var done = function () { copy.textContent = T.copied; setTimeout(function () { copy.textContent = T.copyCode; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    } });
    return h("div", { "class": "dc-pbody" }, [h("div", { "class": "dc-ptitle", text: n ? tagLabel(n) : p }), h("pre", { "class": "dc-code", text: text.slice(0, 60000) }), copy]);
  }
  function refreshComputed() {
    if (panelEl.hidden || tab !== "design" || !sel.path) return;
    if (panelEl.contains(document.activeElement)) return;
    renderPanel();
  }
  function designPanel() {
    var n = nodeOf(sel.path, sel.tids[0]), out = h("div", { "class": "dc-pbody" });
    if (!n) return out;
    var disp = inline("display") || computed("display");
    out.appendChild(h("div", { "class": "dc-ptitle", text: tagLabel(n) + (sel.tids.length > 1 ? " +" + (sel.tids.length - 1) : "") }));
    if (n.localName === "img") out.appendChild(section(T.image.replace("…", ""), [h("button", { type: "button", "class": "kit-btn dc-wide", text: T.image, onclick: function () { pickImage(sel.path, sel.tids[0]); } })]));
    var textRows = [row(T.color, colorField("color", "color")), row(T.size, textField("font-size", computed("fontSize"))),
      row(T.weight, selectField("font-weight", ["300", "400", "500", "600", "700", "800", "900"])),
      row(T.align, segField("text-align", [["left", "alignL"], ["center", "alignC"], ["right", "alignR"]]))];
    if (ds.model && ds.model.type.groups.length) {
      var names = [];
      ds.model.type.groups.forEach(function (g) { g.styles.forEach(function (s) { names.push(s.name); }); });
      var cls = (n.getAttribute("class") || "").split(/\s+/).filter(Boolean), curName = cls.filter(function (c) { return names.indexOf(c) >= 0; })[0] || "";
      var ts = h("select", {}, [h("option", { value: "", text: "—" })].concat(names.map(function (x) { return h("option", { value: x, text: x }); })));
      ts.value = curName;
      ts.addEventListener("change", function () {
        var rest = cls.filter(function (c) { return names.indexOf(c) < 0; });
        if (ts.value) rest.push(ts.value);
        setAttr("class", rest.join(" "));
      });
      textRows.unshift(row(T.style, ts));
    }
    out.appendChild(section(T.text, textRows));
    out.appendChild(section(T.fill, [row(T.background, colorField("background", "backgroundColor"))]));
    var lay = [row(T.width, textField("width", computed("width"))), row(T.height, textField("height", computed("height"))),
      row(T.padding, textField("padding", [computed("paddingTop"), computed("paddingRight"), computed("paddingBottom"), computed("paddingLeft")].join(" "))),
      row(T.radius, textField("border-radius", computed("borderTopLeftRadius"))),
      row(T.display, selectField("display", ["block", "flex", "grid", "inline-block", "inline-flex", "none"]))];
    if (/flex|grid/.test(disp)) lay.push(row(T.gap, textField("gap", computed("rowGap"))));
    if (/flex/.test(disp)) lay.push(row(T.direction, selectField("flex-direction", ["row", "column", "row-reverse", "column-reverse"])),
      row(T.justify, selectField("justify-content", ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"])),
      row(T.items, selectField("align-items", ["stretch", "flex-start", "center", "flex-end", "baseline"])),
      row(T.wrap, selectField("flex-wrap", ["nowrap", "wrap"])));
    if (/grid/.test(disp)) lay.push(row(T.columns, trackField("grid-template-columns")), row(T.rows, trackField("grid-template-rows")),
      row(T.items, selectField("align-items", ["stretch", "start", "center", "end"])));
    out.appendChild(section(T.layout, lay));
    return out;
  }
  function boardPanel(p) {
    var out = h("div", { "class": "dc-pbody" }), e = entry(p) || {}, g = geo(p);
    out.appendChild(h("div", { "class": "dc-ptitle", text: titleOf(p) }));
    function boardSet(fn) { checkpoint(); fn(ensureEntry(p)); layoutBoard(boards[p]); drawSel(); changed(); renderPanel(); }
    var title = h("input", { type: "text", value: typeof e.title === "string" ? e.title : "", placeholder: p });
    title.addEventListener("change", function () { boardSet(function (en) { if (title.value.trim()) en.title = title.value.trim(); else delete en.title; }); });
    var w = h("input", { type: "number", min: "40", max: "8000", value: String(g.w) }), hh = h("input", { type: "number", min: "40", max: "8000", value: String(g.h) });
    w.addEventListener("change", function () { boardSet(function (en) { en.w = clamp(R(num(w.value, g.w)), 40, 8000); }); });
    hh.addEventListener("change", function () { boardSet(function (en) { en.h = clamp(R(num(hh.value, g.h)), 40, 8000); }); });
    var fill = h("input", { type: "checkbox" }); fill.checked = e.expand === "fill";
    fill.addEventListener("change", function () { boardSet(function (en) { if (fill.checked) en.expand = "fill"; else delete en.expand; }); });
    var inter = h("input", { type: "checkbox" }); inter.checked = !!e.is_interactive;
    inter.addEventListener("change", function () { boardSet(function (en) { if (inter.checked) en.is_interactive = true; else delete en.is_interactive; }); });
    [title, w, hh].forEach(function (i) { i.addEventListener("keydown", function (ev) { ev.stopPropagation(); if (ev.key === "Enter") i.blur(); }); });
    out.appendChild(section(T.artboard, [row(T.title, title), row(T.width, w), row(T.height, hh), row(T.fillPage, fill), row(T.interactive, inter)]));
    out.appendChild(h("p", { "class": "dc-hint", text: T.none }));
    return out;
  }
  function tweakKeys(p) {
    var pr = files[p] && files[p].props || {};
    return Object.keys(pr).filter(function (k) { return k.charAt(0) !== "$" && pr[k] && typeof pr[k] === "object" && pr[k].editor; });
  }
  function setProp(p, k, v, live) {
    if (!live) checkpoint();
    var en = ensureEntry(p);
    if (!en.props || typeof en.props !== "object") en.props = {};
    if (v === undefined) delete en.props[k]; else en.props[k] = v;
    if (!Object.keys(en.props).length) delete en.props;
    frames.forEach(function (f) { if (f.path === p) f.send({ t: "props", props: propsOf(p) }); });
    changed();
  }
  function tweaksPanel(p) {
    var out = h("div", { "class": "dc-pbody" }), pr = files[p] && files[p].props || {}, keys = tweakKeys(p), vals = propsOf(p);
    out.appendChild(h("div", { "class": "dc-ptitle", text: titleOf(p) }));
    if (!keys.length) { out.appendChild(h("p", { "class": "dc-hint", text: T.noTweaks })); return out; }
    var groups = {};
    keys.forEach(function (k) { var s = String(pr[k].section || ""); (groups[s] = groups[s] || []).push(k); });
    Object.keys(groups).forEach(function (s) {
      out.appendChild(section(s || T.tweaks, groups[s].map(function (k) { return tweakRow(p, k, pr[k], vals[k]); })));
    });
    return out;
  }
  function tweakRow(p, k, d, v) {
    var has = v !== undefined, val = has ? v : d["default"], ed = d.editor, ctl, live = false;
    var label = d.label || k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, function (c) { return c.toUpperCase(); });
    function opts() { return (Array.isArray(d.options) ? d.options : []).map(function (o) { return o && typeof o === "object" ? { v: o.value, l: o.label || String(o.value) } : { v: o, l: String(o) }; }); }
    if (ed === "boolean") {
      ctl = h("input", { type: "checkbox" }); ctl.checked = !!val;
      ctl.addEventListener("change", function () { setProp(p, k, ctl.checked); });
    } else if (ed === "enum") {
      var os = opts();
      ctl = h("select", {}, os.map(function (o, i) { return h("option", { value: String(i), text: o.l }); }));
      ctl.value = String(Math.max(0, os.map(function (o) { return o.v; }).indexOf(val)));
      ctl.addEventListener("change", function () { setProp(p, k, os[+ctl.value].v); });
    } else if (ed === "color") {
      var sw = h("input", { type: "color", value: hex(val) }), t2 = h("input", { type: "text", value: val == null ? "" : String(val), spellcheck: "false" });
      sw.addEventListener("input", function () { setProp(p, k, sw.value, live); live = true; t2.value = sw.value; });
      sw.addEventListener("change", function () { live = false; });
      t2.addEventListener("change", function () { setProp(p, k, t2.value.trim()); });
      t2.addEventListener("keydown", function (e) { e.stopPropagation(); });
      ctl = h("span", { "class": "dc-color" }, [sw, t2]);
      var os2 = opts();
      if (os2.length) ctl = h("span", { "class": "dc-colorbox" }, [ctl, h("span", { "class": "dc-swatches" }, os2.map(function (o) {
        return h("button", { type: "button", title: String(o.v), "aria-label": String(o.v), style: "background:" + o.v, onclick: function () { setProp(p, k, o.v); } });
      }))]);
    } else if (ed === "range" || ed === "int" || ed === "float") {
      var step = d.step != null ? d.step : ed === "int" ? 1 : ed === "float" ? 0.1 : 1;
      var inp = h("input", { type: ed === "range" ? "range" : "number", min: d.min, max: d.max, step: step, value: val == null ? "" : String(val) });
      var out = h("span", { "class": "dc-rangeval", text: val == null ? "" : String(val) + (d.unit || "") });
      var read = function () { var x = parseFloat(inp.value); return isFinite(x) ? (ed === "int" ? R(x) : x) : undefined; };
      inp.addEventListener("input", function () { if (ed !== "range") return; out.textContent = inp.value + (d.unit || ""); setProp(p, k, read(), live); live = true; });
      inp.addEventListener("change", function () { live = false; if (ed !== "range") setProp(p, k, read()); });
      inp.addEventListener("keydown", function (e) { e.stopPropagation(); });
      ctl = h("span", { "class": "dc-range" }, ed === "range" ? [inp, out] : [inp]);
    } else {
      var multi = typeof val === "string" && val.indexOf("\n") >= 0;
      var ti = h(multi ? "textarea" : "input", multi ? { rows: "3" } : { type: "text" });
      ti.value = val == null ? "" : String(val);
      ti.addEventListener("change", function () { setProp(p, k, ti.value); });
      ti.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter" && !multi) ti.blur(); });
      ctl = ti;
    }
    var reset = has ? h("button", { type: "button", "class": "dc-reset", title: T.reset, "aria-label": T.reset, html: kit.icon("undo"),
      onclick: function (e) { e.preventDefault(); setProp(p, k, undefined); renderPanel(); } }) : null;
    return h("div", { "class": "dc-row" }, [h("span", { text: label }), ctl, reset]);
  }

  // ------------------------------------------------------------------ Play, links, the full-window view
  function setPlay(b, on) {
    if (!b.frame) return;
    b.playing = on;
    b.el.classList.toggle("is-playing", on);
    b.playBtn.innerHTML = on ? ICON.stop : kit.icon("play");
    b.playBtn.title = on ? T.stop : T.play;
    if (on && sel.path === b.path) select(null, []);
    b.frame.send({ t: "mode", mode: on ? "play" : "edit", wheel: "forward" });
    sendView();
  }
  function followLink(from, target) {
    if (!files[target]) return;
    if (focus) { openFocus(target); return; }
    var a = boards[from], b = boards[target];
    if (a && a.playing && from !== target) setPlay(a, false);
    if (!onPage(target)) setPage(pageOf(entry(target) || auto[target]));
    b = boards[target];
    if (b) { setPlay(b, true); center(target); }
  }
  var focus = null;
  var focusEl = h("div", { id: "dc-focus", hidden: true });
  app.appendChild(focusEl);
  function openFocus(p) {
    if (!files[p]) return;
    closeFocus(true);
    commitAll();
    var e = entry(p) || {}, fill = e.expand === "fill", g = geo(p);
    var list = pagePaths().filter(function (x) { return files[x]; }), i = list.indexOf(p);
    var stage = h("div", { "class": "dc-fstage" + (fill ? " is-fill" : "") }), boxEl = h("div", { "class": "dc-fbox" });
    stage.appendChild(boxEl);
    var head = h("div", { "class": "dc-fhead" }, [
      kit.labelled(kit.button(T.back, "prev", function () { closeFocus(); }, T.back), T.back),
      h("span", { "class": "dc-ftitle", text: titleOf(p) }),
      kit.button("", "prev", function () { if (i > 0) openFocus(list[i - 1]); }, T.prev),
      h("span", { "class": "dc-fcount", text: (i + 1) + " / " + list.length }),
      kit.button("", "next", function () { if (i < list.length - 1) openFocus(list[i + 1]); }, T.next)]);
    focusEl.replaceChildren(head, stage);
    focusEl.hidden = false;
    focus = { path: p, fill: fill, g: g, box: boxEl, stage: stage };
    focus.frame = new Frame({ path: p, mode: "play", wheel: "native", parent: boxEl, onMsg: function (m) {
      if (m.t === "link") followLink(p, m.file);
      else if (m.t === "key") key(m);
      else if (m.t === "error" && m.errors && m.errors.length) kit.toast(T.error + ": " + m.errors[0]);
    } });
    fitFocus();
    drawTools(); renderPanel(); sendView();
  }
  function fitFocus() {
    if (!focus) return;
    var r = focus.stage.getBoundingClientRect(), g = focus.g;
    if (focus.fill) { focus.box.style.cssText = "width:100%;height:100%"; return; }
    var k = Math.min((r.width - 48) / g.w, (r.height - 48) / g.h, 1);
    focus.box.style.cssText = "width:" + g.w + "px;height:" + g.h + "px;transform:scale(" + k + ");left:" + (r.width - g.w * k) / 2 + "px;top:" + (r.height - g.h * k) / 2 + "px";
  }
  function closeFocus(quiet) {
    if (!focus) return;
    focus.frame.dispose();
    focus = null;
    focusEl.hidden = true; focusEl.replaceChildren();
    if (!quiet) { drawTools(); renderPanel(); sendView(); }
  }

  // ------------------------------------------------------------------ pages
  function setPage(id) {
    page = id;
    Object.keys(boards).forEach(function (p) { var b = boards[p]; if (b.playing && !onPage(p)) setPlay(b, false); });
    select(null, []); selectBoard(null);
    layoutAll(); drawPages(); sendView();
  }

  // ------------------------------------------------------------------ view context, asking, comments
  function kindOf(n) {
    var t = n.localName;
    if (t === "img") return "image";
    if (t === "svg") return n.querySelector("line,polyline,[marker-end],[marker-start]") ? "line" : n.textContent.trim() ? "text" : "shape";
    if (n.namespaceURI !== "http://www.w3.org/1999/xhtml") return "shape";
    var own = Array.prototype.some.call(n.childNodes, function (c) { return c.nodeType === 3 && c.data.trim(); });
    if (/^(input|textarea|select)$/.test(t) || (n.textContent.trim() && /^(h[1-6]|p|span|a|button|label|li|td|th|b|strong|em|i|blockquote|figcaption)$/.test(t))) return "text";
    if (/^(div|section|article|aside|header|footer|main|nav|figure)$/.test(t)) return own ? "text" : "shape";
    return "other";
  }
  function labelOf(n) {
    if (n.localName === "img") return (n.getAttribute("alt") || "").slice(0, 60) || null;
    var t = n.textContent.replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 60) : n.getAttribute("aria-label") ? n.getAttribute("aria-label").slice(0, 60) : null;
  }
  function cssPath(n) {
    return ancestors(n).filter(function (a) { return a.localName !== "helmet"; }).map(function (a) {
      var same = 0, k = 0;
      var sibs = a.parentNode ? Array.prototype.filter.call(a.parentNode.children, function (s) { return s.localName === a.localName; }) : [a];
      sibs.forEach(function (s, i) { if (s === a) k = i + 1; same++; });
      return a.localName + (same > 1 ? ":nth-of-type(" + k + ")" : "");
    }).join(" > ");
  }
  function selId(p, tid) { var n = nodeOf(p, tid); return n ? enc(p) + "#" + tid + ":" + n.__dcPath : null; }
  function sendView() {
    kit.view(function () {
      var vis = [], v = vrect();
      if (focus) vis = [enc(focus.path)];
      else pagePaths().forEach(function (p) {
        var g = geo(p), x = tx + g.x * z, y = ty + g.y * z;
        if (x < v.width && y < v.height && x + g.w * z > 0 && y + g.h * z > 0 && vis.length < 20) vis.push(enc(p));
      });
      var errs = pagePaths().filter(function (p) { return !files[p] || (boards[p] && boards[p].errors.length); });
      var ctx = { mode: focus ? "focused" : "canvas", page: page, visibleArtboards: vis,
        selectedArtboards: focus ? [] : sel.path ? [enc(sel.path)] : selBoard ? [enc(selBoard)] : [],
        dirty: pending || !!editing, edits: edits, zoom: R(z * 100),
        playing: Object.keys(boards).filter(function (p) { return boards[p].playing; }).map(enc),
        selected: [], selection: [] };
      if (page) { var pg = pages.filter(function (x) { return x.id === page; })[0]; ctx.pageName = String(pg && pg.name || page).slice(0, 60); }
      if (errs.length) {
        ctx.erroredArtboards = errs.slice(0, 10).map(enc);
        ctx.firstError = (files[errs[0]] ? boards[errs[0]].errors[0] : "missing file " + errs[0]).slice(0, 60);
      }
      if (!focus && sel.path) sel.tids.slice(-20).forEach(function (tid) {
        var n = nodeOf(sel.path, tid), id = selId(sel.path, tid);
        if (!n || !id) return;
        ctx.selected.push(id);
        var it = { id: id, kind: kindOf(n), path: cssPath(n), text: ((sel.info[tid] || {}).text || "").slice(0, 200) };
        var lb = labelOf(n); if (lb) it.label = lb;
        ctx.selection.push(it);
      });
      ctx.selection = ctx.selection.slice(-5);
      return ctx;
    });
  }
  function about() {
    var p = sel.path || selBoard, n = sel.path ? nodeOf(sel.path, sel.tids[0]) : null;
    return { p: p, n: n, id: n ? selId(sel.path, sel.tids[0]) : enc(p), label: n ? (labelOf(n) || tagLabel(n)) : "" };
  }
  function askAbout() {
    var a = about();
    if (!a.p) return;
    var inp = h("input", { "class": "dc-askin", placeholder: T.askPh, "aria-label": T.ask });
    tools.replaceChildren(inp);
    placeTools();
    inp.focus();
    inp.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") { drawTools(); return; }
      if (e.key !== "Enter" || !inp.value.trim()) return;
      var text = T.about(titleOf(a.p), a.p, a.label) + " " + inp.value.trim();
      if (!window.hermes || !window.hermes.send) { kit.toast(T.noSave); drawTools(); return; }
      window.hermes.send(text, { artboard: a.p, element: a.id, selector: a.n ? cssPath(a.n) : null }, { deliver: "send" })
        .then(function (r) { if (!(r && r.mode === "declined")) kit.toast(T.sent); }, function (err) { kit.toast(String(err && err.message || err)); });
      drawTools();
    });
  }
  function commentOn() {
    var a = about();
    if (!a.p || !window.hermes || !window.hermes.comment) return;
    var text = a.n ? ((sel.info[sel.tids[0]] || {}).text || labelOf(a.n) || "") : titleOf(a.p);
    window.hermes.comment({ selector: a.id, text: text.slice(0, 200), label: (a.p + (a.n ? " · " + tagLabel(a.n) : "")).slice(0, 40) });
  }
  if (window.hermes && window.hermes.on) {
    // A comment's anchor clicked in the host: show that element.
    window.hermes.on("flash", function (d) {
      var m = /^(.+\.dc\.html)#(\d{1,4}):/.exec(String(d && d.selector || ""));
      var p = m && Object.keys(files).filter(function (f) { return enc(f) === m[1]; })[0];
      if (!p) { var p2 = Object.keys(files).filter(function (f) { return enc(f) === String(d && d.selector || ""); })[0]; if (p2) { selectBoard(p2); center(p2); } return; }
      closeFocus();
      if (!onPage(p)) setPage(pageOf(entry(p) || auto[p]));
      center(p);
      select(p, [+m[2]], true);
    });
  }

  // ------------------------------------------------------------------ saving (every change, as a new version)
  var saved = { files: Object.assign({}, cur), canvas: canvasText() };
  var saveTimer = null, inFlight = false, again = false, pending = false, seq = 0, stopped = false;
  function changed() {
    pending = true; seq++;
    clearTimeout(saveTimer);
    if (!stopped) saveTimer = setTimeout(save, 1200);
    sendView();
  }
  function diff() {
    var out = {}, all = "", ct = canvasText();
    Object.keys(cur).forEach(function (p) { all += cur[p]; if (cur[p] !== saved.files[p]) out[p] = cur[p]; });
    if (ct !== saved.canvas) out["canvas.json"] = ct;
    var up = Object.keys(uploads).filter(function (p) { return all.indexOf(p) >= 0; });
    up.forEach(function (p) { out[p] = uploads[p]; });
    return { files: out, uploads: up, canvas: ct, cur: Object.assign({}, cur) };
  }
  function status(kind) {
    statusEl.textContent = kind === "saving" ? T.saving : kind === "saved" ? T.saved : kind === "failed" ? T.notSaved : "";
    saveBtn.hidden = kind !== "failed";
    if (kind === "saved") setTimeout(function () { if (statusEl.textContent === T.saved) statusEl.textContent = ""; }, 2000);
  }
  function save() {
    clearTimeout(saveTimer);
    if (inFlight) { again = true; return; }
    if (stopped) return;
    var d = diff(), at = seq;
    if (!Object.keys(d.files).length) { pending = false; status(""); sendView(); return; }
    if (!window.hermes || !window.hermes.save) { status("failed"); return; }
    inFlight = true; status("saving");
    window.hermes.save(d.files, C.version).then(function (r) {
      if (r && r.conflict) { stopped = true; status("failed"); kit.toast(T.conflict); if (window.hermes.history) window.hermes.history.show(null); return; }
      if (!r || !r.ok) throw new Error(r && r.error || "save failed");
      C.version = r.version;
      Object.keys(d.files).forEach(function (p) { if (d.cur[p] != null) saved.files[p] = d.cur[p]; });
      saved.canvas = d.canvas;
      d.uploads.forEach(function (p) { delete uploads[p]; });
      if (seq === at) pending = false;
      status("saved");
      sendView();
    }).catch(function () { status("failed"); }).then(function () {
      inFlight = false;
      if (again || (pending && seq !== at)) { again = false; save(); }
    });
  }

  // ------------------------------------------------------------------ keys (the page's and the artboards')
  function key(e) {
    var k = e.key, mod = e.ctrl || e.meta;
    if (k === " ") { if (!focus) setSpace(!e.up); return; }
    if (e.up) return;
    if (mod && (k === "s" || k === "S")) { save(); return; }
    if (focus) { if (k === "Escape") closeFocus(); return; }
    if (mod && (k === "z" || k === "Z")) { if (e.shift) redo(); else undo(); return; }
    if (mod && (k === "y" || k === "Y")) { redo(); return; }
    if (mod && (k === "=" || k === "+")) { zoomTo(z * 1.25); return; }
    if (mod && k === "-") { zoomTo(z / 1.25); return; }
    if (mod && k === "0") { zoomTo(1); return; }
    if (e.shift && (k === "!" || e.code === "Digit1")) { fitAll(); return; }
    if (e.shift && (k === "@" || k === "\"" || e.code === "Digit2")) { zoomSel(); return; }
    if (k === "Escape") {
      var playing = Object.keys(boards).filter(function (p) { return boards[p].playing; });
      if (sel.path) { var n = nodeOf(sel.path, sel.tids[0]), up = n && ancestors(n).slice(-2)[0]; if (up && up !== n) select(sel.path, [up.__dcTid]); else { select(null, []); } }
      else if (selBoard) selectBoard(null);
      else playing.forEach(function (p) { setPlay(boards[p], false); });
      return;
    }
    if ((k === "Delete" || k === "Backspace") && sel.path) { removeSel(); return; }
    if (mod && (k === "d" || k === "D") && sel.path) { dupSel(); return; }
    if (mod && (k === "g" || k === "G") && sel.path) { if (e.shift) ungroupSel(); else groupSel(); return; }
    if (k === "]" && sel.path) { reorderSel(1); return; }
    if (k === "[" && sel.path) { reorderSel(-1); return; }
    if (k === "Enter" && sel.path && sel.tids.length === 1) { boards[sel.path].frame.send({ t: "edit", tid: sel.tids[0] }); return; }
  }
  function zoomSel() {
    var p = sel.path || selBoard;
    if (!p) return fitAll();
    var g = geo(p);
    if (sel.path && sel.tids.length) {
      var rs = [];
      sel.tids.forEach(function (t) { ((sel.info[t] || {}).rects || []).forEach(function (r) { rs.push({ x: g.x + r.x, y: g.y + r.y, w: r.w, h: r.h }); }); });
      var u = bounds(rs); if (u) return fitRect(u, 4);
    }
    fitRect(g, 4);
  }
  document.addEventListener("keydown", function (e) {
    if (/input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable) return;
    var mod = e.ctrlKey || e.metaKey;
    if (e.key === " " || (mod && /^[zysdgZYSDG=+0-]$/.test(e.key)) || ((e.key === "Delete" || e.key === "Backspace") && sel.path)) e.preventDefault();
    key({ key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey });
  });
  document.addEventListener("keyup", function (e) { if (e.key === " ") key({ key: " ", up: true }); });
  window.addEventListener("blur", function () { setSpace(false); });
  // A click anywhere in the page ends typing in an artboard.
  document.addEventListener("pointerdown", function () { if (editing) commitAll(); }, true);

  // ------------------------------------------------------------------ exports
  var libs = {};
  function lib(name, global) {
    if (window[global]) return Promise.resolve(window[global]);
    if (!window.hermes || !window.hermes.vendor) return Promise.reject(new Error(T.noLib));
    return (libs[name] = libs[name] || window.hermes.vendor(name).then(function (src) {
      (0, eval)(src + "\n//# sourceURL=vendor/" + name);
      if (!window[global]) throw new Error(T.noLib);
      return window[global];
    }));
  }
  function busy(on) {
    var b = document.querySelector(".dc-busy");
    if (on && !b) document.body.appendChild(h("div", { "class": "dc-busy", text: T.building }));
    if (!on && b) b.remove();
  }
  /** The artboard an export means: the selected one, the one open full window, else the one nearest the middle. */
  function currentBoard() {
    if (focus) return focus.path;
    if (sel.path || selBoard) return sel.path || selBoard;
    var v = vrect(), cx = v.width / 2, cy = v.height / 2, best = null, bd = Infinity;
    pagePaths().filter(function (p) { return files[p]; }).forEach(function (p) {
      var g = geo(p), x = tx + (g.x + g.w / 2) * z, y = ty + (g.y + g.h / 2) * z, d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bd) { bd = d; best = p; }
    });
    return best;
  }
  var exportHost = h("div", { "class": "dc-export-host", "aria-hidden": "true" });
  document.body.appendChild(exportHost);
  /** An artboard as a picture: rendered fresh in a hidden frame at its size. */
  function picture(p, opts) {
    var g = geo(p), box = h("div", { style: "width:" + g.w + "px;height:" + g.h + "px" });
    exportHost.appendChild(box);
    var f = new Frame({ path: p, mode: "export", wheel: "none", parent: box });
    var stop = function () { f.dispose(); box.remove(); };
    f.iframe.getBoundingClientRect();
    return Promise.race([f.whenReady(), new Promise(function (r) { setTimeout(r, 20000); })]).then(function () { f.iframe.getBoundingClientRect(); return f.request(Object.assign({ t: "raster", w: g.w, h: g.h }, opts)); })
      .then(function (r) { stop(); return r; }, function (e) { stop(); throw e; });
  }
  function bitmap(blob) {
    return new Promise(function (resolve, reject) {
      var u = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { resolve(img); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); };
      img.onerror = function () { reject(new Error("picture failed")); };
      img.src = u;
    });
  }
  function baseName() { return kit.slug(canvas.title || C.title || "design"); }
  async function exportPng() {
    var p = currentBoard();
    if (!p) return kit.toast(T.noBoard);
    busy(true);
    try {
      var r = await picture(p, { scale: 2 });
      kit.download(baseName() + "-" + kit.slug(stem(p).replace(/\//g, "-")) + ".png", r.blob, "image/png");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }
  var PAPER = { letter: [816, 1056], a4: [794, 1123] };
  async function addBoardPages(P, pdf, layer, p) {
    var e = entry(p) || {}, g = geo(p);
    if (e.print === "flow") {
      var paper = PAPER[e.paper] || PAPER.letter, pw = paper[0], ph = paper[1], pad = 53;
      var r = await picture(p, { scale: 1.5, full: true, paper: { pageH: ph, pad: pad }, type: "image/jpeg" });
      var img = await bitmap(r.blob), k = r.scale, starts = [0].concat(r.cuts), ends = r.cuts.concat([r.h]);
      for (var i = 0; i < starts.length && i < 100; i++) {
        var s = starts[i], en = ends[i], off = i ? pad : 0, c = document.createElement("canvas");
        c.width = R(pw * k); c.height = R(ph * k);
        var cx = c.getContext("2d");
        cx.fillStyle = r.bg; cx.fillRect(0, 0, c.width, c.height);
        cx.drawImage(img, 0, R(s * k), Math.min(img.width, R(pw * k)), R((en - s) * k), 0, R(off * k), Math.min(img.width, R(pw * k)), R((en - s) * k));
        var jpg = await pdf.embedJpg(c.toDataURL("image/jpeg", 0.9));
        var page2 = pdf.addPage([pw * 0.75, ph * 0.75]);
        page2.drawImage(jpg, { x: 0, y: 0, width: pw * 0.75, height: ph * 0.75 });
        layer.add(page2, r.lines.filter(function (l) { var m = l.y + l.h / 2; return m >= s && m < en; })
          .map(function (l) { return Object.assign({}, l, { y: l.y - s + off }); }), 0.75);
      }
      return;
    }
    var rr = await picture(p, { scale: Math.min(1.5, 4000 / Math.max(g.w, g.h)), type: "image/jpeg" });
    var jp = await pdf.embedJpg(await blobUrl(rr.blob));
    var pg = pdf.addPage([g.w * 0.75, g.h * 0.75]);
    pg.drawImage(jp, { x: 0, y: 0, width: g.w * 0.75, height: g.h * 0.75 });
    layer.add(pg, rr.lines.filter(function (l) { return l.y < g.h && l.y + l.h > 0; }), 0.75);
  }
  function blobUrl(b) { return new Promise(function (r) { var fr = new FileReader(); fr.onload = function () { r(fr.result); }; fr.readAsDataURL(b); }); }
  async function exportPdf(all) {
    var list = all ? pagePaths().filter(function (p) { return files[p]; }) : [currentBoard()].filter(Boolean);
    if (!list.length) return kit.toast(T.noBoard);
    busy(true);
    try {
      var P = await lib("pdf-lib.min.js", "PDFLib");
      var pdf = await P.PDFDocument.create();
      pdf.setTitle(canvas.title || C.title || "Design"); pdf.setCreator("Hermes Artifacts");
      var layer = kit.pdfText(P, pdf);
      for (var i = 0; i < list.length; i++) await addBoardPages(P, pdf, layer, list[i]);
      layer.finish();
      var bytes = await pdf.save();
      kit.download(baseName() + (all ? "" : "-" + kit.slug(stem(list[0]).replace(/\//g, "-"))) + ".pdf", new Blob([bytes], { type: "application/pdf" }), "application/pdf");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }
  /** A standalone page: the artboard and the runtime, working (links to the other artboards too). */
  function exportHtml() {
    var p = currentBoard();
    if (!p) return kit.toast(T.noBoard);
    var urls = {};
    Object.keys(cur).forEach(function (f) { Object.assign(urls, urlsFor(f)); });
    var props = {};
    Object.keys(cur).forEach(function (f) { props[f] = propsOf(f); });
    var data = { file: p, sources: cur, urls: urls, css: cssFiles, props: props, ds: ds.css, theme: ds.theme, scripts: ds.scripts };
    var head = files[p].head;
    var doc = '<!doctype html>\n<html lang="' + kit.esc(head.lang || "en") + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>" + kit.esc(head.title || titleOf(p)) + "</title></head><body>" +
      '<script type="application/json" id="dc-standalone">' + JSON.stringify(data).replace(/</g, "\\u003c") + "</" + "script>" +
      "<script>" + SRC.dc + "</" + "script><script>" + SRC.frame + "</" + "script></body></html>";
    kit.download(kit.slug(stem(p).replace(/\//g, "-")) + ".html", doc, "text/html");
  }

  // ------------------------------------------------------------------ chrome
  var statusEl = h("span", { "class": "dc-status", "aria-live": "polite" });
  var saveBtn = kit.labelled(kit.button(T.save, "", save, T.save), T.save);
  saveBtn.classList.add("dc-save"); saveBtn.hidden = true;
  var exportList = [{ id: "png", label: T.png, run: exportPng }, { id: "pdf", label: T.pdf, run: function () { exportPdf(false); } },
    { id: "pdf-all", label: T.pdfAll, run: function () { exportPdf(true); } }, { id: "html", label: T.html, run: exportHtml }];
  kit.exports(exportList); // the host's title menu lists them too
  // The canvas's chrome, as Claude's: no bar. Pages at the top left, the view's tools at the top right (play, properties,
  // zoom), and the drawing tools in a row at the bottom (select, hand, text, artboard, sticky, pen, shapes).
  function cbtn(html, title, fn, cls) {
    var b = h("button", { type: "button", "class": "kit-btn" + (cls ? " " + cls : ""), title: title, "aria-label": title, html: html });
    b.addEventListener("click", fn);
    return b;
  }
  function closeMenus() { var m = document.querySelector(".kit-menu"); if (m) m.remove(); }
  bar.hidden = true;

  // pages (top left)
  var pagesLabel = h("span");
  var pagesBtn = cbtn(kit.icon("pages") + kit.icon("caretDown"), T.pages, function () {
    kit.menu(pagesBtn, (pages.length ? pages : [{ id: null, name: T.page1 }]).map(function (pg) {
      return { label: (pg.id === page || (!pg.id && !pages.length) ? "✓ " : "   ") + String(pg.name || pg.id).slice(0, 40), onClick: function () { if (pg.id) { setPage(pg.id); fitAll(); } } };
    }).concat(editable ? [{ label: T.newPage, onClick: newPage }] : []));
  }, "dc-caret");
  pagesBtn.insertBefore(pagesLabel, pagesBtn.lastChild);
  function drawPages() {
    var pg = pages.filter(function (x) { return x.id === page; })[0];
    pagesLabel.textContent = pages.length > 1 && pg ? String(pg.name || pg.id).slice(0, 24) : "";
  }
  function newPage() {
    commitAll(); checkpoint();
    if (!pages.length) { // the canvas had no pages: what is on it becomes page 1
      canvas.pages = [{ id: "page-1", name: T.page1 }];
    }
    var n = canvas.pages.length + 1, id;
    do { id = "page-" + n++; } while (canvas.pages.some(function (x) { return x.id === id; }));
    canvas.pages.push({ id: id, name: T.pageN + " " + (canvas.pages.length + 1) });
    pages = canvas.pages;
    changed(); setPage(id);
  }
  var pagesPill = h("div", { "class": "dc-pill dc-pill-l" }, [pagesBtn]);

  // the view (top right)
  var dlBtn = cbtn(kit.icon("download"), T.exp, function () { kit.menu(dlBtn, exportList.map(function (x) { return { label: x.label, onClick: x.run }; })); });
  var themeBtn = cbtn(kit.icon("palette"), T.theme, function () {
    kit.menu(themeBtn, [{ label: T.defTheme, onClick: function () { setTheme(null); } }].concat(ds.themes.map(function (t) {
      return { label: t.name, onClick: function () { setTheme(t.id); } };
    })));
  });
  themeBtn.hidden = true;
  var playBtn = cbtn(kit.icon("play"), T.play, function () {
    var list = pagePaths(), live = list.filter(function (p) { return (entry(p) || {}).is_interactive; }), rest = list.filter(function (p) { return live.indexOf(p) < 0; });
    var item = function (p) { return { label: titleOf(p), onClick: function () { openFocus(p); } }; };
    kit.menu(playBtn, (live.length ? [{ hint: T.prototypes }].concat(live.map(item)) : []).concat(rest.length ? [{ hint: T.statics }].concat(rest.map(item)) : []));
  });
  var panelBtn = cbtn(kit.icon("sliders"), T.panel, function () { panelHidden = !panelHidden; renderPanel(); });
  var zoomLabel = h("span");
  var zoomBtn = cbtn("", T.zoom, function () {
    kit.menu(zoomBtn, [{ label: T.zoomIn, onClick: function () { zoomTo(z * 1.25); } }, { label: T.zoomOut, onClick: function () { zoomTo(z / 1.25); } },
      { label: T.fit, onClick: fitAll }, { label: T.sel, onClick: zoomSel }]
      .concat([0.25, 0.5, 0.75, 1, 1.5, 2].map(function (v) { return { label: v * 100 + "%", onClick: function () { zoomTo(v); } }; }))
      .concat(editable ? [{ label: T.undo + "  (Ctrl+Z)", onClick: undo }, { label: T.redo + "  (Ctrl+Shift+Z)", onClick: redo }] : []));
  }, "dc-zoomval");
  zoomBtn.appendChild(zoomLabel); zoomBtn.insertAdjacentHTML("beforeend", kit.icon("caretDown"));
  var viewPill = h("div", { "class": "dc-pill dc-pill-r" }, [statusEl, saveBtn, themeBtn, dlBtn, playBtn].concat(editable ? [panelBtn] : [], [zoomBtn]));

  // the tools (bottom)
  var tool = "select", toolBtns = {}, shapeKind = "rect", penKind = "pen";
  function setTool(t) {
    tool = t;
    Object.keys(toolBtns).forEach(function (k) { toolBtns[k].classList.toggle("is-on", k === t || (k === "shape" && /^(rect|oval|arrow|line)$/.test(t)) || (k === "pen" && t === "pen")); });
    viewEl.classList.toggle("is-hand", t === "hand");
    viewEl.classList.toggle("is-draw", t !== "select" && t !== "hand");
  }
  function tbtn2(key, icon, title) { return (toolBtns[key] = cbtn(kit.icon(icon), title, function () { setTool(key === "shape" ? shapeKind : key); })); }
  var shapeCaret = cbtn(kit.icon("caretDown"), T.shapes, function () {
    kit.menu(shapeCaret, [["rect", T.rect], ["oval", T.oval], ["arrow", T.arrow], ["line", T.line]].map(function (x) {
      return { label: x[1], onClick: function () { shapeKind = x[0]; toolBtns.shape.innerHTML = kit.icon(x[0] === "rect" ? "shape" : x[0] === "oval" ? "oval" : x[0] === "arrow" ? "arrowUR" : "lineD"); setTool(x[0]); } };
    }));
  }, "dc-caretonly");
  var toolPill = h("div", { "class": "dc-pill dc-pill-b", role: "toolbar", "aria-label": T.tools }, [
    tbtn2("select", "cursor", T.tSelect), tbtn2("hand", "hand", T.tHand), tbtn2("text", "text", T.tText), tbtn2("board", "frame", T.tBoard),
    tbtn2("sticky", "sticky", T.tSticky), tbtn2("pen", "pencil", T.tPen), tbtn2("shape", "shape", T.shapes), shapeCaret]);
  viewEl.append(pagesPill, viewPill);
  if (editable) viewEl.appendChild(toolPill);
  setTool("select");

  // ------------------------------------------------------------------ making things on the canvas with a tool
  function worldAt(e) { var r = vrect(); return { x: (e.clientX - r.left - tx) / z, y: (e.clientY - r.top - ty) / z }; }
  function noteId() { var id; do { id = "n-" + Math.random().toString(36).slice(2, 8); } while (canvas.notes[id]); return id; }
  function withPage(n) { if (page) n.page = page; return n; }
  function newBoardAt(x, y, w, hh) {
    var n = 1, p;
    do { p = "Board-" + n++ + ".dc.html"; } while (cur[p] != null || files[p]);
    w = R(clamp(w, 40, 8000)); hh = R(clamp(hh, 40, 8000));
    var src = '<!doctype html>\n<html lang="' + L + '">\n<head>\n<meta charset="utf-8">\n<title>' + T.newBoard + '</title>\n<script src="./support.js"></' + 'script>\n</head>\n<body>\n<x-dc>\n<helmet>\n<style>\nbody{margin:0}\n</style>\n</helmet>\n' +
      '<div style="width: ' + w + 'px; height: ' + hh + 'px; box-sizing: border-box; padding: 48px; display: flex; flex-direction: column; gap: 16px; background: #ffffff"></div>\n</x-dc>\n' +
      '<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":' + w + ',"height":' + hh + '}}\'>\nclass Component extends DCLogic {\n  renderVals() { return {}; }\n}\n</' + 'script>\n</body>\n</html>\n';
    checkpoint();
    cur[p] = src; files[p] = DC.parse(src);
    canvas.boards[p] = withPage({ x: R(x), y: R(y), w: w, h: hh, title: T.newBoard });
    if (canvas.order.indexOf(p) < 0) canvas.order.push(p);
    layoutAll(); changed(); selectBoard(p);
  }
  if (editable) viewEl.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || tool === "select" || focus || e.target.closest(".dc-pill, .kit-menu")) return;
    if (tool === "hand") { // drag anywhere pans
      e.preventDefault(); e.stopPropagation();
      var x0 = e.clientX, y0 = e.clientY, t0 = tx, u0 = ty;
      capture(viewEl, e.pointerId); viewEl.classList.add("is-panning");
      var mv = function (ev) { tx = t0 + ev.clientX - x0; ty = u0 + ev.clientY - y0; apply(); };
      var upH = function () { viewEl.removeEventListener("pointermove", mv); viewEl.removeEventListener("pointerup", upH); viewEl.classList.remove("is-panning"); };
      viewEl.addEventListener("pointermove", mv); viewEl.addEventListener("pointerup", upH);
      return;
    }
    e.preventDefault(); e.stopPropagation();
    commitAll(); select(null, []); selectBoard(null);
    var a = worldAt(e), kind = tool, pts = [[0, 0]], ghost = h("div", { "class": "dc-ghost" });
    notesLayer.appendChild(ghost);
    capture(viewEl, e.pointerId);
    function move(ev) {
      var b = worldAt(ev);
      if (kind === "pen") { pts.push([R(b.x - a.x), R(b.y - a.y)]); ghost.style.cssText = "left:" + b.x + "px;top:" + b.y + "px;width:4px;height:4px"; return; }
      ghost.style.cssText = "left:" + Math.min(a.x, b.x) + "px;top:" + Math.min(a.y, b.y) + "px;width:" + Math.abs(b.x - a.x) + "px;height:" + Math.abs(b.y - a.y) + "px";
    }
    function up(ev) {
      viewEl.removeEventListener("pointermove", move); viewEl.removeEventListener("pointerup", up);
      ghost.remove();
      var b = worldAt(ev), w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y), x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), id = noteId(), drawn = w > 6 || hh > 6;
      if (kind === "board") { newBoardAt(drawn ? x : a.x, drawn ? y : a.y, drawn ? w : 880, drawn ? hh : 560); setTool("select"); return; }
      var n = null;
      if (kind === "text") n = { x: R(a.x), y: R(a.y), text: T.phText, kind: "title1", size: 40 };
      else if (kind === "sticky") n = { x: R(a.x), y: R(a.y), text: "", w: 240 };
      else if (kind === "rect" || kind === "oval") n = { kind: kind, x: R(drawn ? x : a.x), y: R(drawn ? y : a.y), w: R(drawn ? w : 200), h: R(drawn ? hh : 140) };
      else if (kind === "line" || kind === "arrow") { if (!drawn) { b = { x: a.x + 200, y: a.y }; } n = { kind: kind, x: R(a.x), y: R(a.y), x2: R(b.x), y2: R(b.y) }; }
      else if (kind === "pen" && pts.length > 2) n = { kind: "pen", x: R(a.x), y: R(a.y), points: pts };
      if (!n) return;
      checkpoint();
      canvas.notes[id] = withPage(n);
      renderNotes(); changed(); selectNote(id);
      if (kind !== "pen") setTool("select");
      if (kind === "text" || kind === "sticky") { var el = notesLayer.querySelector('[data-note="' + id + '"]'); if (el) editNote(el, id); }
    }
    viewEl.addEventListener("pointermove", move); viewEl.addEventListener("pointerup", up);
  }, true);

  // a note is selected by a click; Delete removes it
  var selNote = null;
  function selectNote(id) {
    selNote = id && canvas.notes[id] ? id : null;
    notesLayer.querySelectorAll("[data-note]").forEach(function (el) { el.classList.toggle("is-sel", el.getAttribute("data-note") === selNote); });
  }
  function removeNote() {
    if (!selNote || !canvas.notes[selNote]) return false;
    checkpoint(); delete canvas.notes[selNote]; selNote = null;
    renderNotes(); changed();
    return true;
  }
  if (editable) {
    notesLayer.addEventListener("pointerdown", function (e) { var el = e.target.closest("[data-note]"); if (el && tool === "select") selectNote(el.getAttribute("data-note")); }, true);
    viewEl.addEventListener("pointerdown", function (e) { if (!e.target.closest("[data-note]")) selectNote(null); });
    document.addEventListener("keydown", function (e) {
      if (/input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable || focus) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selNote) { e.preventDefault(); removeNote(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = { v: "select", h: "hand", t: "text", a: "board", s: "sticky", p: "pen", r: "rect", o: "oval", l: "line" }[e.key.toLowerCase()];
      if (t && !sel.path) { if (t === "line" && e.shiftKey) t = "arrow"; setTool(t); }
      if (e.key === "Escape" && tool !== "select") setTool("select");
    });
  }

  if (!paths.length) viewEl.appendChild(h("div", { "class": "kit-empty dc-emptymsg", text: T.empty }));
  drawPages();
  layoutAll();
  fitAll();
  if (launch.view === "focused" && files[launch.file]) openFocus(launch.file);
  window.addEventListener("resize", function () { apply(); fitFocus(); });
  new ResizeObserver(function () { placeTools(); fitFocus(); }).observe(viewEl);
  window.addEventListener("beforeunload", function () { if (pending) save(); });
  window.__design = { select: select, selectBoard: selectBoard, boards: boards, files: files, cur: cur, canvas: function () { return canvas; },
    state: function () { return { z: z, tx: tx, ty: ty, sel: sel, selBoard: selBoard, focus: focus && focus.path, page: page, pending: pending }; },
    openFocus: openFocus, closeFocus: closeFocus, setPlay: function (p, on) { setPlay(boards[p], on); }, undo: undo, redo: redo, setStyle: setStyle,
    exportPng: exportPng, exportPdf: exportPdf, exportHtml: exportHtml, picture: picture, setProp: setProp, fitAll: fitAll };
  kit.ready();
})();
