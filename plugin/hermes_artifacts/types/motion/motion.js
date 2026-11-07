/* Motion: a film written as code, every frame a pure function of t (film-api.md). The player loads
   the film's files (film.json, modules/*, assets/*), runs its modules, plays and scrubs it, plays its
   score, takes comments on moments and ranges, keeps the page's own records of hand edits
   (retyped, recolored, refaced, recut, retouched) and exports MP4, GIF and PNG. */
(function () {
  "use strict";
  // The UI's words in the app's language (hu over en, key by key); messages to Hermes are always English.
  function pickLang(t, l) { var o = {}, k; for (k in t.en) o[k] = t.en[k]; for (k in t[l] || {}) o[k] = t[l][k]; return o; }
  var kit = window.kit, h = kit.h, C = kit.content, FK = window.FilmKit, SND = window.MotionSound, ENC = window.MotionEncode;
  var L = /^hu\b/i.test(kit.content.lang || navigator.language || "") ? "hu" : "en";
  var T = pickLang({
    en: { retypedH: "Retyped words", layersH: "Changed by hand", play: "Play (space)", pause: "Pause (space)", loop: "Loop", mute: "Turn sound on (M)", unmute: "Mute (M)", back: "Previous frame (←)",
      fwd: "Next frame (→)", present: "Full screen (F)", exitP: "Exit full screen (Esc)", exp: "Export", mp4: "Video (MP4)", gif: "GIF", png: "This frame (PNG)",
      comment: "Comment (C)", commentAt: "Comment on this moment", commentRange: "Comment on this stretch", tweaks: "Tweaks", rough: "Rough cut",
      cont: "Continue", fin: "Finalize", contMsg: "Continue the animation.", left: "Scenes left: ", finMsg: "Finalize the animation.",
      scene: "Scene", of: "of", soon: "Still to come", failed: "This scene didn't run", bad: "modules/scenes.json is missing or not valid.",
      badScenes: "scenes.json: ", noFilm: "This film has no scenes yet.", saving: "Saving…", saved: "Saved", notSaved: "Not saved", retry: "Save",
      conflict: "Changed meanwhile: the new version loads", noSave: "Can't save here", rangeHint: "Shift-drag the timeline to mark a stretch · I / O set its ends",
      editHint: "Double-click words to retype them", name: "Name", length: "Length", reset: "Reset", colors: "Colors", original: "Original",
      font: "Font", headlines: "Headlines", text: "Text", look: "Selected", ink: "Color", size: "Size", weight: "Weight", hidden: "Hidden",
      pickHint: "Pause, then click a thing on the picture to change its look.", resetAll: "Reset all changes", byHand: "Changes made by hand are saved as part of the film.",
      building: "Exporting", cancel: "Cancel", frames: "frames", noCodec: "This browser can't encode video (WebCodecs H.264 missing)",
      noAudio: "Exported without sound: this browser can't encode AAC", fontsOff: "Web fonts couldn't be embedded: the export uses fallback fonts",
      done: "Exported", cancelled: "Export cancelled", scrollHint: "", s: "s", mixed: "Mixed", rangeMark: "Stretch" },
    hu: { retypedH: "Átírt szövegek", layersH: "Kézzel módosítva", play: "Lejátszás (szóköz)", pause: "Szünet (szóköz)", loop: "Ismétlés", mute: "Hang bekapcsolása (M)", unmute: "Némítás (M)", back: "Előző képkocka (←)",
      fwd: "Következő képkocka (→)", present: "Teljes képernyő (F)", exitP: "Kilépés a teljes képernyőből (Esc)", exp: "Exportálás", mp4: "Videó (MP4)", gif: "GIF", png: "Ez a képkocka (PNG)",
      comment: "Komment (C)", commentAt: "Komment erre a pillanatra", commentRange: "Komment erre a szakaszra", tweaks: "Hangolás", rough: "Nyers vágás",
      cont: "Folytatás", fin: "Véglegesítés", left: "Scenes left: ",
      scene: "Jelenet", of: "/", soon: "Még készül", failed: "Ez a jelenet nem futott le", bad: "A modules/scenes.json hiányzik vagy nem érvényes.",
      badScenes: "scenes.json: ", noFilm: "Ebben a filmben még nincs jelenet.", saving: "Mentés…", saved: "Elmentve", notSaved: "Nincs mentve", retry: "Mentés",
      conflict: "Közben megváltozott: betöltöm az új verziót", noSave: "Itt nem lehet menteni", rangeHint: "Shift + húzás az idővonalon: szakasz kijelölése · I / O: a két vége",
      editHint: "Dupla katt a szövegre: átírás", name: "Név", length: "Hossz", reset: "Vissza", colors: "Színek", original: "Eredeti",
      font: "Betűtípus", headlines: "Címek", text: "Szöveg", look: "Kijelölt", ink: "Szín", size: "Méret", weight: "Vastagság", hidden: "Elrejtve",
      pickHint: "Állítsd meg, és kattints a képen egy elemre, hogy megváltoztasd.", resetAll: "Minden kézi módosítás visszaállítása", byHand: "A kézi módosítások a film részeként mentődnek.",
      building: "Exportálás", cancel: "Mégse", frames: "képkocka", noCodec: "Ez a böngésző nem tud videót kódolni (nincs WebCodecs H.264)",
      noAudio: "Hang nélkül exportálva: ez a böngésző nem tud AAC-t kódolni", fontsOff: "A webes betűk nem ágyazhatók be: az export tartalék betűkkel készül",
      done: "Exportálva", cancelled: "Export megszakítva", scrollHint: "", s: "mp", mixed: "Vegyes", rangeMark: "Szakasz" }
  }, L);

  var realNow = performance.now.bind(performance);
  var EPOCH = Date.UTC(2026, 0, 1);
  var bar = document.getElementById("mo-bar"), view = document.getElementById("mo-view"), frame = document.getElementById("mo-frame");
  var stage = document.getElementById("stage"), fxCanvas = document.getElementById("mo-fx"), controls = document.getElementById("mo-controls");
  bar.className = "kit-bar";
  var fx = fxCanvas.getContext("2d");
  var editable = !C.thumb;
  function parse(html) { var tp = document.createElement("template"); tp.innerHTML = html; return tp.content.firstElementChild; }

  // ------------------------------------------------------------------ the film's files
  var MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", mp4: "video/mp4", webm: "video/webm" };
  var MODS = {}, ASSETS = {};
  function loadFiles() {
    MODS = {}; ASSETS = {};
    Object.keys(C.files).forEach(function (p) {
      if (p.indexOf("modules/") === 0) MODS[p.slice(8)] = kit.fileText(p);
      else if (p.indexOf("assets/") === 0) {
        var name = p.slice(7), ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1], mime = MIME[(ext || "").toLowerCase()];
        var v = kit.fileUrl(p);
        if (!mime || !v) return;
        // The type comes from the extension, whatever the server guessed.
        if (v.slice(0, 5) === "data:") { var comma = v.indexOf(","), head = v.slice(5, comma); v = "data:" + mime + (/;base64/.test(head) ? ";base64" : ";charset=utf-8") + v.slice(comma); }
        ASSETS[name] = v;
      }
    });
  }
  loadFiles();
  function mjson(name, fb) { var t = MODS[name]; if (t == null) return fb; try { return JSON.parse(t); } catch (e) { return fb; } }
  var META = kit.json("film.json", {}) || {};
  var SJ = mjson("scenes.json", null);
  var REC = {};
  function loadRecords() { ["retyped", "recolored", "refaced", "recut", "retouched"].forEach(function (k) { REC[k] = mjson(k + ".json", null); }); }
  loadRecords();

  var W = 1920, H = 1080, FPS = 30;
  if (SJ) {
    if (SJ.width > 0 && SJ.width <= 4096) W = Math.round(SJ.width);
    if (SJ.height > 0 && SJ.height <= 4096) H = Math.round(SJ.height);
    if ([24, 25, 30, 50, 60].indexOf(SJ.fps) >= 0) FPS = SJ.fps;
  }
  var TITLE = META.title || C.title || "Film";

  // ------------------------------------------------------------------ fonts
  var TEN = {
    "plus-jakarta-sans": { f: "Plus Jakarta Sans", q: "Plus+Jakarta+Sans:wght@400;500;700;800", k: "sans" },
    "manrope": { f: "Manrope", q: "Manrope:wght@400;500;700;800", k: "sans" },
    "space-grotesk": { f: "Space Grotesk", q: "Space+Grotesk:wght@400;500;700", k: "sans" },
    "instrument-sans": { f: "Instrument Sans", q: "Instrument+Sans:wght@400;500;700", k: "sans" },
    "fraunces": { f: "Fraunces", q: "Fraunces:opsz,wght@9..144,400;9..144,700", k: "serif" },
    "dm-mono": { f: "DM Mono", q: "DM+Mono:wght@400", k: "mono" },
    "departure-mono": { f: "VT323", q: "VT323", k: "mono" },          // not on Google Fonts: the nearest pixel mono there
    "fraunces-display": { f: "Fraunces", q: "Fraunces:ital,opsz,wght@1,9..144,200", k: "serif" },
    "inter-display": { f: "Inter", q: "Inter:opsz,wght@14..32,400;14..32,700;14..32,900", k: "sans" },
    "shantell-sans": { f: "Shantell Sans", q: "Shantell+Sans:wght@400;600;700;800", k: "sans" }
  };
  var FALL = { sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, "Cascadia Mono", Consolas, monospace' };
  var fontLinks = {};
  function googleLink(q, fallbackQ) {
    var href = "https://fonts.googleapis.com/css2?family=" + q + "&display=block";
    if (fontLinks[href]) return;
    var ln = document.createElement("link");
    ln.rel = "stylesheet"; ln.href = href; ln.setAttribute("data-mo-font", "");
    ln.onerror = function () { if (fallbackQ && fallbackQ !== q) { delete fontLinks[href]; googleLink(fallbackQ); } };
    document.head.appendChild(ln);
    fontLinks[href] = ln;
  }
  function slotStack(slot, v) {
    var kind = slot === "display" ? "sans" : slot;
    if (typeof v === "string" && TEN[v]) { googleLink(TEN[v].q); return '"' + TEN[v].f + '", ' + FALL[TEN[v].k === "serif" && kind !== "mono" ? "serif" : kind]; }
    if (v && typeof v === "object" && typeof v.family === "string" && /^[\w\s'-]{1,60}$/.test(v.family)) {
      var ws = (Array.isArray(v.weights) ? v.weights : [400, 700]).filter(function (w) { return w >= 100 && w <= 900; }).slice(0, 4).sort(function (a, b) { return a - b; });
      var plus = v.family.trim().replace(/\s+/g, "+");
      googleLink(plus + ":wght@" + (ws.length ? ws.join(";") : "400"), plus);
      var or = TEN[v.or] ? TEN[v.or] : null;
      if (or) googleLink(or.q);
      return '"' + v.family.trim() + '"' + (or ? ', "' + or.f + '"' : "") + ", " + FALL[or && or.k === "serif" ? "serif" : (or && or.k) || kind];
    }
    return null;
  }
  function fontSlots() {
    var f = Object.assign({}, (SJ && SJ.fonts) || {});
    var rf = REC.refaced && REC.refaced.slots;
    if (rf) Object.keys(rf).forEach(function (s) { var e = rf[s]; if (e && e.v && TEN[e.v]) f[s] = e.v; });
    return f;
  }
  var FONTS = {};
  function fontCss() {
    FONTS = {};
    var slots = fontSlots(), css = "#stage{";
    ["display", "sans", "serif", "mono"].forEach(function (s) {
      var st = slots[s] != null ? slotStack(s, slots[s]) : null;
      if (st) { FONTS[s] = st; css += "--" + s + ":" + st + ";"; }
    });
    css += "font-synthesis:style}";
    // Each font asset is a face named by its file's stem.
    Object.keys(ASSETS).forEach(function (n) {
      var m = /^(.+)\.(woff2|woff|ttf|otf)$/i.exec(n);
      if (!m) return;
      var fmt = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" }[m[2].toLowerCase()];
      css += '@font-face{font-family:"' + m[1].replace(/"/g, "") + '";src:url("' + ASSETS[n] + '") format("' + fmt + '");font-display:block}';
    });
    return css;
  }

  // ------------------------------------------------------------------ records: colors, retype, recut, retouch
  var ROLES = ["--ground", "--main", "--second", "--accent"];
  function baseVars() {
    var css = MODS["base.css"] || "", out = [], seen = {}, re = /(--[A-Za-z][\w-]*)\s*:\s*(#[0-9a-fA-F]{6})\b/g, m;
    while ((m = re.exec(css))) if (!seen[m[1]]) { seen[m[1]] = 1; out.push({ name: m[1], v: m[2] }); }
    var byRole = ROLES.map(function (r) { return out.filter(function (x) { return x.name === r; })[0]; });
    if (byRole.every(Boolean)) return byRole;
    return out.slice(0, 4);
  }
  function colorNow() {
    var base = baseVars(), rc = REC.recolored && Array.isArray(REC.recolored.colors) ? REC.recolored.colors : [];
    return base.map(function (b) {
      var e = rc.filter(function (x) { return x && x.name === b.name; })[0];
      var ok = e && typeof e.v === "string" && /^#[0-9a-fA-F]{6}$/.test(e.v) && String(e.was).toLowerCase() === b.v.toLowerCase();
      return { name: b.name, base: b.v, v: ok ? e.v : b.v };
    });
  }
  function recolorCss() {
    var cs = colorNow().filter(function (c) { return c.v.toLowerCase() !== c.base.toLowerCase(); });
    if (!cs.length) return "";
    return "#stage{" + cs.map(function (c) { return c.name + ":" + c.v + " !important"; }).join(";") + "}";
  }
  function stageBackground() {
    var bg = SJ && typeof SJ.background === "string" ? SJ.background : "#ffffff";
    var g = colorNow()[0];
    if (g && bg.toLowerCase() === g.base.toLowerCase()) bg = g.v;
    return /^(#[0-9a-fA-F]{3,8}|transparent)$/.test(bg) ? bg : "#ffffff";
  }
  function retypeMap() {
    var m = {};
    ((REC.retyped && REC.retyped.lines) || []).forEach(function (x) { if (x && typeof x.was === "string" && typeof x.v === "string") m[norm(x.was)] = x.v; });
    return m;
  }
  function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }
  var RETYPE = {};
  function retext(s) { var k = norm(s); return RETYPE[k] != null ? RETYPE[k] : s; }
  function applyRetype(root) {
    if (!Object.keys(RETYPE).length) return;
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n, list = [];
    while ((n = tw.nextNode())) list.push(n);
    list.forEach(function (n) {
      var s = n.textContent, k = norm(s);
      if (k && RETYPE[k] != null) n.textContent = s.replace(s.trim(), RETYPE[k]);
    });
  }
  function recutOf(sc) {
    var e = ((REC.recut && REC.recut.scenes) || []).filter(function (x) { return x && x.id === sc.id; })[0], out = { dur: null, name: null };
    if (!e) return out;
    if (e.dur && +e.dur.was === +sc.dur && +e.dur.v >= sc.dur / 2 && +e.dur.v <= sc.dur * 3) out.dur = +e.dur.v;
    if (e.name && typeof e.name.v === "string" && e.name.v.trim()) out.name = e.name.v.trim().slice(0, 48);
    return out;
  }

  // ------------------------------------------------------------------ styles the film wears
  var styles = {};
  function styleEl(key, css, before) {
    var s = styles[key];
    if (!s) { s = styles[key] = document.createElement("style"); s.setAttribute("data-mo", key); document.head.appendChild(s); }
    s.textContent = css || "";
    return s;
  }
  var DETERMINISM = "#stage *,#stage *::before,#stage *::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}";
  var STAGE_BASE = ".mo-scene{position:absolute;left:0;top:0;overflow:hidden}.mo-scene[hidden]{display:none!important}" +
    ".mo-card{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 160px;background:#f4f2ee;color:#1c1c1c;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}" +
    ".mo-card .n{font-size:30px;letter-spacing:.14em;text-transform:uppercase;opacity:.55}.mo-card .t{font-size:120px;font-weight:700;line-height:1.05;margin:18px 0 26px}" +
    ".mo-card .d{font-size:38px;line-height:1.35;max-width:1300px;opacity:.75}.mo-card .s{position:absolute;left:160px;bottom:90px;font-size:26px;letter-spacing:.1em;text-transform:uppercase;opacity:.45}" +
    ".mo-rough{filter:grayscale(1) contrast(1.15)}";
  function filmCssText() {
    return ["ds", "fonts", "base", "recolor", "retouch", "stage", "det"].map(function (k) { return styles[k] ? styles[k].textContent : ""; }).join("\n") + STAGE_BASE;
  }

  // ------------------------------------------------------------------ boot
  var timeline = [], total = 0, CUT = null, custom = false, env = null, fk = null, score = null, live = null, failedModules = {};
  var bootErr = null;

  function validate() {
    if (!SJ || typeof SJ !== "object") return T.bad;
    var list = SJ.scenes;
    if (!Array.isArray(list)) return T.bad;
    if (list.length > 24) return T.badScenes + "more than 24 scenes";
    var seen = {}, sum = 0;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || typeof s.id !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(s.id)) return T.badScenes + "scene " + (i + 1) + " has a bad id";
      if (seen[s.id]) return T.badScenes + "two scenes are called " + s.id;
      seen[s.id] = 1;
      if (!(typeof s.dur === "number" && s.dur > 0)) return T.badScenes + "scene " + s.id + " has a bad dur";
      sum += s.dur;
    }
    if (sum > 300) return T.badScenes + "longer than 300 s";
    return null;
  }

  function runModule(name, code, k) {
    if (code == null) return false;
    try {
      new Function("kit", String(code) + "\n//# sourceURL=modules/" + name)(k);
      return true;
    } catch (e) {
      failedModules[name] = String(e && e.message || e);
      console.error("modules/" + name + ":", e);
      return false;
    }
  }

  function fmap(ft) {
    if (custom || !timeline.length) return ft;
    for (var i = 0; i < timeline.length; i++) {
      var s = timeline[i];
      if (ft < s.start + s.dur || i === timeline.length - 1) return s.pstart + Math.max(0, ft - s.start) * (s.pdur / s.dur);
    }
    return ft;
  }
  function unmap(pt) {
    if (custom || !timeline.length) return pt;
    var s = sceneAt(pt);
    return s.start + (pt - s.pstart) * (s.dur / s.pdur);
  }
  function sceneAt(pt) {
    for (var i = 0; i < timeline.length; i++) if (pt < timeline[i].pstart + timeline[i].pdur) return timeline[i];
    return timeline[timeline.length - 1];
  }

  async function boot() {
    bootErr = null; failedModules = {}; timeline = []; total = 0; CUT = null; custom = false;
    stage.textContent = "";
    RETYPE = retypeMap();
    stage.style.width = W + "px"; stage.style.height = H + "px";
    stage.style.background = stageBackground();
    frame.style.width = W + "px"; frame.style.height = H + "px";
    fxCanvas.width = W; fxCanvas.height = H; fxCanvas.style.width = W + "px"; fxCanvas.style.height = H + "px";
    // A design system the film names (scenes.json designSystem: {id, version} it was built on; an id, or true
    // for the default one, from older films).
    if (SJ && SJ.designSystem && window.dsKit && !styles.ds) {
      try {
        var ds = await Promise.race([window.dsKit.load(SJ.designSystem === true ? null : SJ.designSystem), new Promise(function (r) { setTimeout(function () { r(null); }, 3000); })]);
        styleEl("ds", ds ? window.dsKit.css(ds) : "");
      } catch (e) { styleEl("ds", ""); }
    }
    styleEl("fonts", fontCss());
    styleEl("base", MODS["base.css"] || "");
    styleEl("recolor", recolorCss());
    styleEl("retouch", "");
    styleEl("stage", "#stage{width:" + W + "px;height:" + H + "px}");
    styleEl("det", DETERMINISM);
    // Hand-drawn boil for rough scenes: three displacement maps, stepped at 12 fps.
    stage.appendChild(parse('<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' + [0, 1, 2].map(function (i) {
      return '<filter id="mo-boil-' + i + '"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="' + (i * 7 + 3) + '"/><feDisplacementMap in="SourceGraphic" scale="5"/><feColorMatrix type="saturate" values="0"/></filter>';
    }).join("") + "</defs></svg>"));

    env = { W: W, H: H, fps: FPS, root: stage, fx: fx, modules: MODS, assets: ASSETS, fonts: FONTS, raster: rasterNode, videos: [],
      text: retext, scenes: {}, scoreFns: [], buildCut: function () { return { __scenes: true }; } };
    fk = FK.make(env);
    window.W = undefined;
    var err = SJ ? validate() : null;
    var list = !err && SJ ? SJ.scenes : [];
    // Scene stages exist before any module runs: a module's kit is its scene's own.
    var fstart = 0, pstart = 0;
    list.forEach(function (s, i) {
      var rc = recutOf(s), pdur = rc.dur || s.dur;
      var el = parse('<div class="mo-scene" hidden></div>');
      el.setAttribute("data-scene", s.id);
      el.style.width = W + "px"; el.style.height = H + "px";
      stage.appendChild(el);
      var sc = { id: s.id, index: i, name: rc.name || String(s.name || s.id).slice(0, 48), codeName: String(s.name || s.id), desc: String(s.desc || ""),
        dur: s.dur, pdur: pdur, start: fstart, pstart: pstart, el: el, def: null, state: "missing", recut: rc };
      sc.kit = fk.sceneKit({ stage: el, start: fstart, dur: s.dur, id: s.id, name: sc.name });
      timeline.push(sc);
      fstart += s.dur; pstart += pdur;
    });
    total = pstart;
    runModule("shared.js", MODS["shared.js"], fk);
    if (window.W === undefined) window.W = {};
    var script = MODS["script.js"] != null ? MODS["script.js"] : "window.CUT = kit.scenes();";
    window.CUT = undefined;
    runModule("script.js", script, fk);
    CUT = window.CUT;
    if (CUT && !CUT.__scenes && typeof CUT.render === "function") {
      // A film with no list of scenes (later.md): window.CUT is the whole film.
      custom = true; timeline = []; stage.querySelectorAll(".mo-scene").forEach(function (n) { n.remove(); });
      if (CUT.width > 0 && CUT.width <= 4096 && CUT.height > 0 && CUT.height <= 4096 && (CUT.width !== W || CUT.height !== H)) {
        W = Math.round(CUT.width); H = Math.round(CUT.height); return boot();
      }
      if ([24, 25, 30, 50, 60].indexOf(CUT.fps) >= 0) FPS = CUT.fps;
      total = Math.min(300, Math.max(0.1, +CUT.duration || 1));
      if (CUT.background) stage.style.background = CUT.background;
    } else if (err) {
      bootErr = err;
    } else {
      timeline.forEach(function (sc) {
        runModule("scene-" + sc.id + ".js", MODS["scene-" + sc.id + ".js"], sc.kit);
        var def = env.scenes[sc.id];
        if (def && typeof def.render === "function") { sc.def = def; sc.state = "loaded"; }
        else if (failedModules["scene-" + sc.id + ".js"] || (MODS["scene-" + sc.id + ".js"] != null)) sc.state = "failed";
      });
      if (!timeline.length) bootErr = T.noFilm;
    }
    runModule("score.js", MODS["score.js"], fk);

    if (custom) {
      try { if (CUT.init) await CUT.init(fk); } catch (e) { console.error("CUT.init:", e); bootErr = String(e && e.message || e); }
      applyRetype(stage);
    } else {
      for (var i = 0; i < timeline.length; i++) await initScene(timeline[i]);
    }
    buildScore();
    applyRetouch();
    return true;
  }

  function nameCard(sc, why) {
    var old = sc.el.querySelector(":scope > .mo-card");
    if (old) old.remove();
    if (why !== "failed") sc.el.textContent = "";
    var c = parse('<div class="mo-card' + (why === "failed" ? " failed" : "") + '"><div class="n"></div><div class="t"></div><div class="d"></div><div class="s"></div></div>');
    c.querySelector(".n").textContent = T.scene + " " + (sc.index + 1) + " " + T.of + " " + timeline.length;
    c.querySelector(".t").textContent = sc.name;
    c.querySelector(".d").textContent = sc.desc;
    c.querySelector(".s").textContent = why === "failed" ? T.failed : T.soon;
    if (why === "failed") { Array.prototype.forEach.call(sc.el.children, function (n) { n.style.visibility = "hidden"; }); c.style.visibility = "visible"; }
    sc.el.appendChild(c);
  }

  async function initScene(sc) {
    timeline.forEach(function (o) { o.el.hidden = o !== sc; });
    if (!sc.def) { nameCard(sc, sc.state === "failed" ? "failed" : "missing"); return; }
    try {
      if (typeof sc.def.init === "function") await sc.def.init.call(sc.def, sc.kit);
      applyRetype(sc.el);
      frozen(0, function () { sc.def.render.call(sc.def, 0, sc.kit); });
      sc.state = "ok";
      if (sc.def.rough) sc.el.classList.add("mo-rough");
    } catch (e) {
      sc.state = "failed"; sc.err = String(e && e.message || e);
      console.error("scene " + sc.id + ":", e);
      nameCard(sc, "failed");
    }
  }

  function buildScore() {
    var Tm = { END: custom ? total : timeline.reduce(function (a, s) { return a + s.dur; }, 0) };
    timeline.forEach(function (s) { Tm[s.id] = s.start; });
    var fns = env.scoreFns.slice();
    if (custom && typeof CUT.score === "function") fns.push(function (S) { CUT.score(S, fk); });
    score = fns.length ? SND.build(fns, Tm, Tm.END, fmap) : null;
    if (live) live.close();
    live = score && score.events.length ? SND.Live(score) : null;
  }

  // ------------------------------------------------------------------ retouch (the page's record of one thing's look)
  function hashWords(s) { return ("00000000" + FK.hash(norm(s)).toString(16)).slice(-8); }
  function partsOf(sc, tag, cls) {
    var want = String(cls || "").split(/\s+/).filter(Boolean);
    return Array.prototype.filter.call(sc.el.getElementsByTagName(tag), function (n) {
      var c = (n.getAttribute("class") || "").split(/\s+/);
      return want.every(function (w) { return c.indexOf(w) >= 0; }) && !n.closest(".mo-card");
    });
  }
  var RT_KEYS = {
    ink: function (v) { return "color:" + v; }, px: function (v) { return "font-size:" + v + "px"; }, weight: function (v) { return "font-weight:" + v; },
    italic: function (v) { return "font-style:" + (+v ? "italic" : "normal"); }, leading: function (v) { return v === "normal" ? "" : "line-height:" + v; },
    tracking: function (v) { return "letter-spacing:" + v + "em"; }, align: function (v) { return /^(left|center|right|justify)$/.test(v) ? "text-align:" + v : ""; },
    fill: function (v) { return "background:" + v; }, size: function (v) { return v >= 0.1 && v <= 4 ? "scale:" + v : ""; },
    radius: function (v) { return v >= 0 && v <= 2000 ? "border-radius:" + v + "px" : ""; }, hidden: function (v) { return +v === 1 ? "opacity:0;visibility:hidden" : ""; },
    svgfill: function (v) { return "fill:" + v; }, svgstroke: function (v) { return "stroke:" + v; }
  };
  var COLOR_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  function rtValueOk(k, v) {
    if (k === "ink" || k === "fill" || k === "svgfill" || k === "svgstroke") return typeof v === "string" && COLOR_RE.test(v);
    if (k === "align") return typeof v === "string";
    if (k === "leading" && v === "normal") return true;
    return typeof v === "number" && isFinite(v);
  }
  function applyRetouch() {
    var layers = (REC.retouched && REC.retouched.layers) || [], css = "";
    stage.querySelectorAll("[data-mo-rt]").forEach(function (n) { n.removeAttribute("data-mo-rt"); });
    layers.forEach(function (e, i) {
      if (!e || typeof e.id !== "string") return;
      var m = /^([a-z][a-z0-9-]*|film)-\d+\/([a-zA-Z][\w-]*)$/.exec(e.id);
      if (!m) return;
      var sc = timeline.filter(function (s) { return s.id === m[1]; })[0];
      if (!sc && !custom) return;
      var list = sc ? partsOf(sc, m[2], e.cls) : Array.prototype.slice.call(stage.getElementsByTagName(m[2]));
      var kin = Array.isArray(e.kin) ? e.kin : [0];
      var node = list[kin[0] | 0];
      if (kin[2]) { var byHash = list.filter(function (n) { return hashWords(n.getAttribute("data-mo-text") || n.textContent) === kin[2]; }); if (byHash.length) node = byHash[0]; }
      if (!node) return;
      var decl = [];
      Object.keys(RT_KEYS).forEach(function (k) {
        var p = e[k];
        if (!p || typeof p !== "object" || !rtValueOk(k, p.v)) return;
        var d = RT_KEYS[k](p.v);
        if (d) decl.push(d.split(";").map(function (x) { return x + " !important"; }).join(";"));
      });
      if (!decl.length) return;
      node.setAttribute("data-mo-rt", String(i));
      css += '#stage [data-mo-rt="' + i + '"]{' + decl.join(";") + "}";
    });
    styleEl("retouch", css);
  }

  // ------------------------------------------------------------------ determinism and rendering
  function frozen(t, fn) {
    var dn = Date.now, mr = Math.random, ms = Math.round(t * 1000);
    Date.now = function () { return EPOCH + ms; };
    performance.now = function () { return ms; };
    Math.random = FK.rng("frame:" + ms);
    try { return fn(); } finally { Date.now = dn; delete performance.now; if (performance.now === undefined) performance.now = realNow; Math.random = mr; }
  }

  var cur = 0, curScene = null;
  function renderAt(t) {
    t = Math.max(0, Math.min(total, t));
    cur = t;
    fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, W, H);
    env.videos.forEach(function (x) { x.want = null; });
    if (custom) {
      frozen(t, function () { try { CUT.render(t, fk); } catch (e) { console.error("CUT.render:", e); } });
      syncVideos(t);
      return;
    }
    if (!timeline.length) return;
    var sc = sceneAt(t);
    if (sc !== curScene) { timeline.forEach(function (o) { o.el.hidden = o !== sc; }); curScene = sc; }
    var local = Math.max(0, Math.min(sc.dur, (t - sc.pstart) * (sc.dur / sc.pdur)));
    sc.local = local;
    if (sc.state === "ok") {
      frozen(t, function () {
        try { sc.def.render.call(sc.def, local, sc.kit); }
        catch (e) { sc.state = "failed"; sc.err = String(e && e.message || e); console.error("scene " + sc.id + ":", e); nameCard(sc, "failed"); refreshSegs(); }
      });
      if (sc.def.rough) sc.el.style.filter = "url(#mo-boil-" + (Math.floor(t * 12) % 3) + ")";
    }
    syncVideos(t);
  }

  function localOf(id, t) {
    var sc = timeline.filter(function (s) { return s.id === id; })[0];
    if (!sc) return t;
    return Math.max(0, Math.min(sc.dur, (t - sc.pstart) * (sc.dur / sc.pdur)));
  }
  function videoTime(x, t) {
    var base = x.scene ? localOf(x.scene, t) : unmap(t), vt = x.want != null ? x.want : base - x.start, d = x.v.duration;
    if (x.loop && d > 0) vt = ((vt % d) + d) % d;
    else if (d > 0) vt = Math.min(vt, d - 0.001);
    return Math.max(0, vt);
  }
  function syncVideos(t) {
    env.videos.forEach(function (x) {
      var vt = videoTime(x, t), shown = !x.scene || (curScene && curScene.id === x.scene);
      if (playing && shown) {
        if (Math.abs(x.v.currentTime - vt) > 0.25) x.v.currentTime = vt;
        if (x.v.paused) x.v.play().catch(function () {});
      } else {
        if (!x.v.paused) x.v.pause();
        if (Math.abs(x.v.currentTime - vt) > 0.5 / FPS) x.v.currentTime = vt;
      }
    });
  }
  function seekVideosExact(t) {
    return Promise.all(env.videos.map(function (x) {
      var vt = videoTime(x, t);
      if (!x.v.paused) x.v.pause();
      if (Math.abs(x.v.currentTime - vt) < 0.001 || !(x.v.readyState >= 1)) return null;
      return new Promise(function (r) {
        var done = function () { x.v.removeEventListener("seeked", done); r(); };
        x.v.addEventListener("seeked", done); x.v.currentTime = vt; setTimeout(done, 1500);
      });
    }));
  }

  // ------------------------------------------------------------------ pictures: the stage as an image (Export, kit.raster)
  function rasterNode(node, o) {
    o = o || {};
    var w = o.width || W, hh = o.height || H, sc = o.scale || 1;
    var wrap = document.createElement("div");
    wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    wrap.setAttribute("style", "position:relative;width:" + w + "px;height:" + hh + "px;overflow:hidden");
    wrap.appendChild(node.cloneNode(true));
    return svgImage(wrap, w, hh, filmCssText() + (o.css || "")).then(function (img) {
      var c = document.createElement("canvas"); c.width = Math.round(w * sc); c.height = Math.round(hh * sc);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c;
    });
  }
  function svgImage(node, w, hh, css) {
    return new Promise(function (resolve, reject) {
      var xhtml = new XMLSerializer().serializeToString(node);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + hh + '"><foreignObject width="100%" height="100%">' +
        '<style xmlns="http://www.w3.org/1999/xhtml"><![CDATA[' + css.replace(/]]>/g, "") + "]]></style>" + xhtml + "</foreignObject></svg>";
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("frame picture failed")); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }
  /** The current frame of the stage (only the scene on show) as an image. */
  var exportFontCss = "";
  function snapshot() {
    var root = stage.cloneNode(false);
    root.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    root.style.background = stage.style.background;
    var defs = stage.querySelector(":scope > svg");
    if (defs) root.appendChild(defs.cloneNode(true));
    var live = custom ? Array.prototype.filter.call(stage.children, function (n) { return n !== defs; }) : (curScene ? [curScene.el] : []);
    live.forEach(function (n) {
      var c = n.cloneNode(true);
      // Clips and canvases snapshot as their current frame.
      var lv = n.querySelectorAll("video,canvas"), cl = c.querySelectorAll("video,canvas");
      for (var i = 0; i < lv.length; i++) {
        try {
          var src = lv[i], cw = src.videoWidth || src.width, ch = src.videoHeight || src.height;
          var cv = document.createElement("canvas"); cv.width = Math.max(1, cw); cv.height = Math.max(1, ch);
          if (cw && ch) cv.getContext("2d").drawImage(src, 0, 0);
          var im = document.createElement("img");
          im.setAttribute("src", cv.toDataURL("image/png"));
          im.setAttribute("style", (cl[i].getAttribute("style") || "") + ";object-fit:" + (getComputedStyle(src).objectFit || "contain"));
          if (cl[i].getAttribute("class")) im.setAttribute("class", cl[i].getAttribute("class"));
          var rr = src.getBoundingClientRect(), k = frameScale();
          im.style.width = rr.width / k + "px"; im.style.height = rr.height / k + "px";
          cl[i].replaceWith(im);
        } catch (e) { cl[i].remove(); }
      }
      root.appendChild(c);
    });
    return svgImage(root, W, H, filmCssText() + exportFontCss);
  }
  /** Web fonts inlined as data: URIs, so they show inside the exported pictures (latin subsets). */
  var fontInline = null;
  function inlineFonts() {
    if (fontInline) return fontInline;
    var hrefs = Object.keys(fontLinks);
    if (!hrefs.length) return (fontInline = Promise.resolve({ css: "", ok: true }));
    return (fontInline = Promise.all(hrefs.map(function (href) {
      return fetch(href).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (css) {
        var blocks = css.split(/(?=\/\*\s*[\w-]+\s*\*\/)/).filter(function (b) { return !/^\/\*/.test(b) || /^\/\*\s*(latin|latin-ext)\s*\*\//.test(b); });
        return Promise.all(blocks.map(function (b) {
          var urls = []; b.replace(/url\((https:[^)]+)\)/g, function (_, u) { urls.push(u); });
          return Promise.all(urls.map(function (u) {
            return fetch(u).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
              var bin = "", by = new Uint8Array(buf);
              for (var i = 0; i < by.length; i += 32768) bin += String.fromCharCode.apply(null, by.subarray(i, i + 32768));
              b = b.split(u).join("data:font/woff2;base64," + btoa(bin));
            });
          })).then(function () { return b; });
        })).then(function (bs) { return bs.join("\n"); });
      });
    })).then(function (list) { return { css: list.join("\n"), ok: true }; }, function () { return { css: "", ok: false }; }));
  }
  /** One full frame (stage + kit.fx) drawn into a canvas of size cw×ch. */
  async function drawFrame(t, canvas) {
    renderAt(t);
    await seekVideosExact(t);
    var img = await snapshot(), g = canvas.getContext("2d");
    g.fillStyle = stageBackground() === "transparent" ? "#000" : (stage.style.background || "#fff");
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    g.drawImage(fxCanvas, 0, 0, canvas.width, canvas.height);
  }

  // ------------------------------------------------------------------ playback
  var playing = false, wall0 = 0, t0 = 0, raf = 0, loop = true, muted = true;
  function clock() { return playing ? t0 + (realNow() - wall0) / 1000 : cur; }
  function play() {
    if (playing || !total) return;
    if (cur >= total - 1e-3) cur = 0;
    playing = true; t0 = cur; wall0 = realNow();
    startSound();
    raf = requestAnimationFrame(tick);
    ui();
  }
  function pause() {
    if (!playing) return;
    cur = clock(); playing = false;
    cancelAnimationFrame(raf);
    if (live) live.stop();
    renderAt(cur);
    ui();
  }
  function toggle() { if (playing) pause(); else play(); }
  function startSound() { if (live && !muted && playing) live.start(cur, clock); }
  function tick() {
    if (!playing) return;
    var t = clock();
    if (t >= total) {
      if (loop) { t = 0; t0 = 0; wall0 = realNow(); renderAt(0); startSound(); }
      else { renderAt(total); playing = false; if (live) live.stop(); ui(); return; }
    }
    renderAt(t);
    ui();
    raf = requestAnimationFrame(tick);
  }
  function seek(t) {
    t = Math.max(0, Math.min(total, t));
    if (playing) { t0 = t; wall0 = realNow(); renderAt(t); startSound(); }
    else renderAt(t);
    ui();
  }
  function stepFrame(n) { pause(); seek((Math.round(cur * FPS) + n) / FPS); }

  // ------------------------------------------------------------------ chrome
  function fmt(t) {
    t = Math.max(0, t || 0);
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(2);
  }
  function fmtShort(t) { var s = Math.floor(t); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  var statusEl = h("span", { "class": "mo-status", "aria-live": "polite" });
  var retryBtn = kit.labelled(kit.button(T.retry, "", function () { if (pendingSave) doSave(pendingSave); }, T.retry), T.retry);
  retryBtn.hidden = true;
  var roughBadge = h("span", { "class": "mo-badge", text: T.rough });
  var contBtn = kit.labelled(kit.button(T.cont, "next", function () { sendToChat(continueMsg()); }, T.cont), T.cont);
  var finBtn = kit.labelled(kit.button(T.fin, "sparkle", function () { sendToChat(T.finMsg); }, T.fin), T.fin);
  var tweaksBtn = kit.labelled(kit.button(T.tweaks, "panel", function () { toggleTweaks(); }, T.tweaks), T.tweaks);
  var commentBtn = kit.button("", "comment", function () { commentHere(); }, T.comment);
  var exportList = [{ id: "mp4", label: T.mp4, run: exportMp4 }, { id: "gif", label: T.gif, run: exportGif }, { id: "png", label: T.png, run: exportPng }];
  var expBtn = kit.labelled(kit.button(T.exp, "download", function () {
    kit.menu(expBtn, exportList.map(function (x) { return { label: x.label, onClick: x.run }; }));
  }), T.exp);
  expBtn.hidden = true;
  var titleEl = h("span", { "class": "kit-title", style: "visibility:hidden" }); // the host's toolbar shows the title

  var playBtn = kit.button("", "play", toggle, T.play);
  var backBtn = kit.button("", "prev", function () { stepFrame(-1); }, T.back);
  var fwdBtn = kit.button("", "next", function () { stepFrame(1); }, T.fwd);
  var timeEl = h("span", { "class": "mo-time" });
  var tl = h("div", { "class": "mo-tl", role: "slider", tabindex: "0", "aria-label": "Timeline" });
  var segsEl = h("div", { "class": "mo-segs" }), headEl = h("div", { "class": "mo-head" }), rangeEl = h("div", { "class": "mo-range", hidden: true });
  tl.append(segsEl, rangeEl, headEl);
  var loopBtn = kit.button("", "refresh", function () { loop = !loop; ui(); }, T.loop);
  var muteBtn = h("button", { "class": "kit-btn", type: "button", title: T.mute, onclick: function () { setMuted(!muted); } });
  var SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>';
  function muteIcon() { muteBtn.innerHTML = SPK + (muted ? '<path d="M17 9l5 6M22 9l-5 6"/>' : '<path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>') + "</svg>"; muteBtn.title = muted ? T.mute : T.unmute; }
  function setMuted(m) {
    muted = m; muteIcon();
    if (muted) { if (live) live.stop(); }
    else if (live && live.ready()) startSound();
  }
  controls.append(tl, playBtn, backBtn, fwdBtn, timeEl, h("span", { "class": "mo-spacer" }), commentBtn, loopBtn, muteBtn,
    kit.button("", "presenter", function () { present(!presenting); }, T.present));

  function continueMsg() {
    var left = timeline.filter(function (s) { return s.state !== "ok"; }).map(function (s) { return s.index + 1; });
    return T.contMsg + (left.length ? " " + T.left + left.join(", ") + "." : "");
  }
  function sendToChat(text) {
    if (window.hermes && window.hermes.send) window.hermes.send(text, null, { deliver: "send" }).then(function (r) { if (!(r && r.mode === "declined")) kit.toast(text); }, function () {});
  }

  function refreshSegs() {
    segsEl.textContent = "";
    var segs = custom ? chapters() : timeline;
    segs.forEach(function (s, i) {
      var el = h("div", { "class": "mo-seg" + (s.state === "failed" ? " failed" : s.state === "missing" ? " missing" : "") + (s.recut && (s.recut.dur || s.recut.name) ? " recut" : ""),
        title: s.name + " · " + fmt(s.pdur) });
      el.style.flex = s.pdur + " 1 0";
      el.appendChild(h("div", { "class": "fill" }));
      el.appendChild(h("span", { text: s.name }));
      if (!custom && editable) {
        var grip = h("div", { "class": "grip", title: T.length });
        grip.addEventListener("pointerdown", function (e) { e.stopPropagation(); trimStart(e, s, grip); });
        el.appendChild(grip);
      }
      s.segEl = el;
      segsEl.appendChild(el);
    });
    var anyBad = timeline.some(function (s) { return s.state !== "ok"; });
    var rough = SJ && SJ.stage === "rough";
    roughBadge.hidden = !rough;
    contBtn.hidden = !(anyBad && !custom);
    finBtn.hidden = !(rough && !anyBad && timeline.length);
    pinsDraw();
  }
  function chapters() {
    var ch = Array.isArray(CUT && CUT.chapters) && CUT.chapters.length ? CUT.chapters : [{ t: 0, label: TITLE }];
    return ch.map(function (c, i) {
      var a = Math.max(0, +c.t || 0), b = i + 1 < ch.length ? +ch[i + 1].t : total;
      return { name: String(c.label || ""), pstart: a, pdur: Math.max(0.01, b - a), state: "ok" };
    });
  }

  function ui() {
    var pct = total ? cur / total * 100 : 0;
    headEl.style.left = pct + "%";
    timeEl.textContent = fmt(cur) + " / " + fmt(total);
    playBtn.innerHTML = kit.icon(playing ? "pause" : "play");
    playBtn.title = playing ? T.pause : T.play;
    loopBtn.setAttribute("aria-pressed", String(loop));
    var segs = custom ? chapters() : timeline;
    segs.forEach(function (s, i) {
      var el = custom ? segsEl.children[i] : s.segEl;
      if (!el) return;
      var on = cur >= s.pstart && (cur < s.pstart + s.pdur || (i === segs.length - 1));
      el.classList.toggle("on", on);
      var f = el.querySelector(".fill");
      if (f) f.style.width = (on ? Math.min(100, (cur - s.pstart) / s.pdur * 100) : cur >= s.pstart + s.pdur ? 100 : 0) + "%";
    });
    if (range) { rangeEl.hidden = false; rangeEl.style.left = range[0] / total * 100 + "%"; rangeEl.style.width = (range[1] - range[0]) / total * 100 + "%"; }
    else rangeEl.hidden = true;
    commentBtn.title = range ? T.commentRange : T.commentAt;
    if (!playing) { if (tweaksOpen) tweaksSync(); }
    sendView();
  }

  // Scrub, Shift-drag a stretch, and drag a scene's right edge to recut it.
  var range = null;
  function tAtX(x) { var r = tl.getBoundingClientRect(); return Math.max(0, Math.min(total, (x - r.left) / r.width * total)); }
  tl.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    tl.setPointerCapture(e.pointerId);
    var a = tAtX(e.clientX), was = playing, mark = e.shiftKey;
    if (mark) { range = null; } else { if (was) pause(); seek(a); }
    function move(ev) {
      var b = tAtX(ev.clientX);
      if (mark) { range = Math.abs(b - a) > 0.05 ? [Math.min(a, b), Math.max(a, b)] : null; ui(); }
      else seek(b);
    }
    function up() { tl.removeEventListener("pointermove", move); tl.removeEventListener("pointerup", up); tl.removeEventListener("pointercancel", up); if (!mark && was) play(); }
    tl.addEventListener("pointermove", move); tl.addEventListener("pointerup", up); tl.addEventListener("pointercancel", up);
  });
  tl.title = T.rangeHint;

  function trimStart(e, s, grip) {
    pause();
    var r = tl.getBoundingClientRect(), pxPerS = r.width / total, x0 = e.clientX, d0 = s.pdur;
    grip.classList.add("on");
    grip.setPointerCapture(e.pointerId);
    var lo = s.dur / 2, hi = s.dur * 3, nv = d0;
    function move(ev) {
      nv = Math.round(Math.max(lo, Math.min(hi, d0 + (ev.clientX - x0) / pxPerS)) * 10) / 10;
      timeEl.textContent = s.name + ": " + nv.toFixed(1) + " " + T.s;
    }
    function up() {
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up);
      grip.classList.remove("on");
      if (Math.abs(nv - d0) >= 0.05) setRecut(s.id, { dur: nv });
      else ui();
    }
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
  }

  // ------------------------------------------------------------------ comments on moments and stretches
  function secs(t) { return (Math.round(t * 100) / 100).toFixed(2); }
  function commentHere() {
    if (!window.hermes || !window.hermes.comment) return;
    pause();
    var anchor;
    if (range) {
      var a = unmap(range[0]), b = unmap(range[1]);
      anchor = { selector: "@t=" + secs(a) + "-" + secs(b), label: fmtShort(range[0]) + "–" + fmtShort(range[1]),
        text: "from " + secs(a) + " s to " + secs(b) + " s · " + scenesIn(range[0], range[1]).join(", ") };
    } else {
      var sc = custom ? null : sceneAt(cur);
      anchor = { selector: "@t=" + secs(unmap(cur)), label: fmtShort(cur), text: "at " + secs(unmap(cur)) + " s · " + (sc ? sc.name : TITLE) };
    }
    window.hermes.comment(anchor);
  }
  function scenesIn(a, b) {
    if (custom) return [TITLE];
    return timeline.filter(function (s) { return s.pstart < b && s.pstart + s.pdur > a; }).map(function (s) { return s.name; });
  }
  // The host's comment pick mode: a click on the picture comments on that point at this moment.
  var picking = false;
  window.addEventListener("click", function (e) {
    if (!picking || !frame.contains(e.target)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    pause();
    var r = frame.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
    var sc = custom ? null : sceneAt(cur);
    window.hermes.comment({ selector: "@t=" + secs(unmap(cur)) + " @xy=" + x.toFixed(2) + "%," + y.toFixed(2) + "%", label: fmtShort(cur),
      text: "at " + secs(unmap(cur)) + " s, x " + x.toFixed(2) + "% y " + y.toFixed(2) + "%" + (sc ? " · " + sc.name : "") });
    picking = false; view.classList.remove("picking");
  }, true);
  var pins = [];
  function parseAnchor(sel) {
    var m = /^@t=(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?/.exec(String(sel || ""));
    return m ? [parseFloat(m[1]), m[2] != null ? parseFloat(m[2]) : null] : null;
  }
  function pinsDraw() {
    tl.querySelectorAll(".mo-pin").forEach(function (n) { n.remove(); });
    if (!total) return;
    pins.forEach(function (p) {
      var a = parseAnchor(p.selector);
      if (!a) return;
      var ta = fmap(a[0]), b = h("div", { "class": "mo-pin" + (a[1] != null ? " range" : ""), text: String(p.n), title: fmtShort(ta) });
      b.style.left = Math.min(100, ta / total * 100) + "%";
      b.addEventListener("pointerdown", function (e) { e.stopPropagation(); pause(); seek(ta); if (a[1] != null) { range = [ta, fmap(a[1])]; ui(); } });
      tl.appendChild(b);
    });
  }
  // Host events: numbered pins for the comments, a comment clicked in the panel, comment pick mode.
  var HOST = {
    pins: function (items) { pins = (items || []).filter(function (x) { return x && parseAnchor(x.selector); }); pinsDraw(); },
    flash: function (d) {
      var a = parseAnchor(d && d.selector);
      if (!a) return;
      pause(); seek(fmap(a[0]));
      range = a[1] != null ? [fmap(a[0]), fmap(a[1])] : null; ui();
    },
    "comment-mode": function (d) { picking = !!(d && d.on); view.classList.toggle("picking", picking); }
  };
  if (window.hermes && window.hermes.on) Object.keys(HOST).forEach(function (k) { window.hermes.on(k, HOST[k]); });

  // ------------------------------------------------------------------ view context
  function sendView() {
    kit.view(function () {
      var sc = custom ? null : sceneAt(cur);
      return {
        type: "motion", time: +cur.toFixed(2), filmTime: +unmap(cur).toFixed(2), duration: +total.toFixed(2), playing: playing,
        scene: sc ? { id: sc.id, name: sc.name, n: sc.index + 1, of: timeline.length, local: +(sc.local || 0).toFixed(2) } : null,
        range: range ? { from: +unmap(range[0]).toFixed(2), to: +unmap(range[1]).toFixed(2) } : null,
        stage: SJ && SJ.stage || null, muted: muted,
        failing: timeline.filter(function (s) { return s.state === "failed"; }).map(function (s) { return s.id; }),
        missing: timeline.filter(function (s) { return s.state === "missing"; }).map(function (s) { return s.id; }),
        selected: selected ? { tag: selected.tagName.toLowerCase(), text: norm(selected.getAttribute("data-mo-text") || selected.textContent).slice(0, 80) } : null
      };
    });
  }

  // ------------------------------------------------------------------ saving the page's records
  var pendingSave = null;
  function status(kind) {
    statusEl.textContent = kind === "saving" ? T.saving : kind === "saved" ? T.saved : kind === "failed" ? T.notSaved : "";
    retryBtn.hidden = kind !== "failed";
    if (kind === "saved") setTimeout(function () { if (statusEl.textContent === T.saved) statusEl.textContent = ""; }, 2000);
  }
  /** Save records: {name: object | null}. Applies them at once, then writes them as a new version. */
  function saveRecords(map) {
    var files = {};
    Object.keys(map).forEach(function (name) {
      var path = "modules/" + name + ".json", obj = map[name];
      if (obj == null) { if (C.files[path] == null) return; delete C.files[path]; files[path] = null; }
      else { var txt = JSON.stringify(obj, null, 1); C.files[path] = txt; files[path] = txt; }
    });
    loadFiles(); loadRecords();
    reload();
    if (!Object.keys(files).length) return;
    doSave(files);
  }
  function doSave(files) {
    pendingSave = files;
    if (!window.hermes || !window.hermes.save) { status("failed"); kit.toast(T.noSave); return; }
    status("saving");
    window.hermes.save(files, C.version).then(function (r) {
      if (r && r.conflict) { status("failed"); kit.toast(T.conflict); if (window.hermes.history) window.hermes.history.show(null); return; }
      if (!r || r.ok === false) { status("failed"); return; }
      if (r.version) C.version = r.version;
      pendingSave = null; status("saved");
    }).catch(function (e) { status("failed"); kit.toast(String(e && e.message || e)); });
  }
  var reloading = null;
  function reload() {
    var keep = cur, was = playing;
    pause();
    selected = null; selBox.hidden = true;
    reloading = boot().then(function () {
      refreshSegs(); renderAt(Math.min(keep, total)); ui();
      if (tweaksOpen) buildTweaks();
      if (was) play();
    });
    return reloading;
  }

  function setRecut(id, ch) {
    var rc = JSON.parse(JSON.stringify(REC.recut || { v: 1, scenes: [] }));
    rc.v = 1; rc.scenes = (rc.scenes || []).filter(function (x) { return x && x.id; });
    var sc = timeline.filter(function (s) { return s.id === id; })[0];
    if (!sc) return;
    var e = rc.scenes.filter(function (x) { return x.id === id; })[0];
    if (!e) { e = { id: id }; rc.scenes.push(e); }
    if ("dur" in ch) { if (ch.dur == null || Math.abs(ch.dur - sc.dur) < 0.005) delete e.dur; else e.dur = { was: sc.dur, v: ch.dur }; }
    if ("name" in ch) { var nm = String(ch.name || "").trim().slice(0, 48); if (!nm || nm === sc.codeName) delete e.name; else e.name = { was: sc.codeName, v: nm }; }
    rc.scenes = rc.scenes.filter(function (x) { return x.dur || x.name; });
    saveRecords({ recut: rc.scenes.length ? rc : null });
  }

  // ------------------------------------------------------------------ retype: double-click words on the paused stage
  function isLine(n) {
    if (!n || n.nodeType !== 1 || n === stage || n.namespaceURI !== "http://www.w3.org/1999/xhtml" || n.classList.contains("mo-word")) return false;
    if (n.closest("svg,.mo-card,[data-label]")) return false;
    if (!norm(n.textContent)) return false;
    return Array.prototype.every.call(n.childNodes, function (c) {
      return c.nodeType === 3 || (c.nodeType === 1 && (c.classList.contains("mo-word") || c.tagName === "BR"));
    });
  }
  function lineAt(target) {
    var n = target;
    while (n && n !== stage && stage.contains(n)) { if (isLine(n)) return n; n = n.parentElement; }
    return null;
  }
  function frameScale() { return frame.getBoundingClientRect().width / W || 1; }
  var editor = null;
  frame.addEventListener("dblclick", function (e) {
    if (!editable || picking) return;
    var line = lineAt(e.target);
    if (!line) return;
    e.preventDefault();
    pause();
    startRetype(line);
  });
  function startRetype(line) {
    stopRetype();
    var shown = norm(line.getAttribute("data-mo-text") || line.textContent);
    var rec = ((REC.retyped && REC.retyped.lines) || []).filter(function (x) { return x && norm(x.v) === shown; })[0];
    var was = rec ? rec.was : shown;
    var r = line.getBoundingClientRect(), vr = view.getBoundingClientRect(), cs = getComputedStyle(line), k = frameScale();
    var ta = h("textarea", { "class": "mo-edit", spellcheck: "true" });
    ta.value = shown;
    ta.style.left = (r.left - vr.left - 4) + "px"; ta.style.top = (r.top - vr.top - 4) + "px";
    ta.style.width = Math.max(120, r.width + 8) + "px"; ta.style.minHeight = (r.height + 8) + "px";
    ta.style.font = cs.fontStyle + " " + cs.fontWeight + " " + (parseFloat(cs.fontSize) * k).toFixed(1) + "px/" + 1.15 + " " + cs.fontFamily;
    ta.style.textAlign = cs.textAlign;
    view.appendChild(ta);
    ta.focus(); ta.select();
    function fit() { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
    fit(); ta.addEventListener("input", fit);
    var sc = custom ? null : sceneAt(cur);
    editor = { ta: ta, commit: function () {
      var v = norm(ta.value);
      stopRetype();
      if (!v || v === shown) return;
      var rt = JSON.parse(JSON.stringify(REC.retyped || { v: 1, lines: [] }));
      rt.v = 1; rt.lines = (rt.lines || []).filter(function (x) { return x && norm(x.was) !== norm(was); });
      if (v !== norm(was)) rt.lines.push({ scene: sc ? sc.id : "film", was: was, v: v });
      saveRecords({ retyped: rt.lines.length ? rt : null });
    } };
    ta.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); editor && editor.commit(); }
      if (e.key === "Escape") { e.preventDefault(); stopRetype(); }
    });
    ta.addEventListener("blur", function () { if (editor && editor.ta === ta) editor.commit(); });
  }
  function stopRetype() { if (editor) { var t = editor.ta; editor = null; t.remove(); } }

  // ------------------------------------------------------------------ Tweaks: scene name and length, colors, font, one thing's look
  var drawer = null, tweaksOpen = false, selected = null;
  var selBox = h("div", { "class": "mo-sel", hidden: true });
  view.appendChild(selBox);
  function toggleTweaks() {
    tweaksOpen = !tweaksOpen;
    tweaksBtn.setAttribute("aria-pressed", String(tweaksOpen));
    if (!tweaksOpen) { if (drawer) drawer.remove(); drawer = null; selected = null; selBox.hidden = true; fit(); return; }
    pause();
    buildTweaks();
  }
  function row(label, kids) { return h("div", { "class": "mo-row" }, [h("label", { text: label })].concat(kids)); }
  function resetLink(fn) { return h("button", { "class": "reset", type: "button", text: T.reset, onclick: fn }); }
  var tweakSceneId = null;
  function buildTweaks() {
    if (drawer) drawer.remove();
    drawer = h("div", { "class": "kit-drawer mo-drawer" });
    var sc = custom ? null : sceneAt(cur);
    tweakSceneId = sc ? sc.id : null;
    if (sc) {
      drawer.appendChild(h("h3", { text: T.scene + " " + (sc.index + 1) + " · " + sc.codeName }));
      var nameIn = h("input", { type: "text", value: sc.name, maxlength: "48" });
      nameIn.addEventListener("change", function () { setRecut(sc.id, { name: nameIn.value }); });
      drawer.appendChild(row(T.name, [nameIn].concat(sc.recut.name ? [resetLink(function () { setRecut(sc.id, { name: null }); })] : [])));
      var lenIn = h("input", { type: "number", step: "0.1", min: String(sc.dur / 2), max: String(sc.dur * 3), value: String(sc.pdur) });
      lenIn.addEventListener("change", function () { var v = parseFloat(lenIn.value); if (v > 0) setRecut(sc.id, { dur: Math.max(sc.dur / 2, Math.min(sc.dur * 3, v)) }); });
      drawer.appendChild(row(T.length + " (" + T.s + ")", [lenIn].concat(sc.recut.dur ? [resetLink(function () { setRecut(sc.id, { dur: null }); })] : [])));
    }
    // Colors: the film's palettes on base.css's four variables.
    var cols = colorNow();
    if (cols.length) {
      drawer.appendChild(h("h3", { text: T.colors }));
      var pals = h("div", { "class": "mo-pals" });
      var palList = [cols.map(function (c) { return c.base; })].concat(Array.isArray(SJ && SJ.palettes) ? SJ.palettes : []);
      var picked = REC.recolored && typeof REC.recolored.palette === "number" ? REC.recolored.palette : null, marked = false;
      palList.forEach(function (p, i) {
        if (!Array.isArray(p) || p.length < cols.length || !p.every(function (c) { return /^#[0-9a-fA-F]{6}$/.test(c); })) return;
        var same = cols.every(function (c, j) { return c.v.toLowerCase() === String(p[j]).toLowerCase(); });
        var on = same && !marked && (picked == null || picked === i);
        if (on) marked = true;
        var b = h("button", { "class": "mo-pal" + (on ? " on" : ""), type: "button", title: p.join(" ") }, [
          h("i", { style: "background:linear-gradient(90deg," + p.slice(0, 4).map(function (c, j) { return c + " " + j * 25 + "% " + (j + 1) * 25 + "%"; }).join(",") + ")" }),
          h("span", { text: i === 0 ? T.original : (i <= ((SJ && SJ.theirs) | 0) ? "★ " : "") + "#" + i })]);
        b.addEventListener("click", function () { setColors(p, i); });
        pals.appendChild(b);
      });
      drawer.appendChild(pals);
      cols.forEach(function (c, j) {
        var inp = h("input", { type: "color", value: c.v.toLowerCase() });
        inp.addEventListener("change", function () { var p = colorNow().map(function (x) { return x.v; }); p[j] = inp.value; setColors(p, null); });
        drawer.appendChild(row(c.name.replace(/^--/, ""), [inp, h("code", { text: c.v, style: "font-size:11px;color:var(--color-fg-muted)" })]));
      });
    }
    // Font: the headline and text slots, one of the ten or the film's own.
    drawer.appendChild(h("h3", { text: T.font }));
    [["display", T.headlines], ["sans", T.text]].forEach(function (pair) {
      var sel = h("select", {}), rf = REC.refaced && REC.refaced.slots && REC.refaced.slots[pair[0]];
      sel.appendChild(h("option", { value: "", text: T.original }));
      Object.keys(TEN).forEach(function (id) { sel.appendChild(h("option", { value: id, text: id })); });
      sel.value = rf && rf.v && TEN[rf.v] ? rf.v : "";
      sel.addEventListener("change", function () { setFace(pair[0], sel.value || null); });
      drawer.appendChild(row(pair[1], [sel]));
    });
    // What was changed by hand in this scene, each with its own Reset (Claude's per-line Reset).
    var here = function (id) { return sc ? id === sc.id : true; };
    var lines = ((REC.retyped && REC.retyped.lines) || []).filter(function (x) { return x && here(x.scene || "film"); });
    if (lines.length) {
      drawer.appendChild(h("h3", { text: T.retypedH }));
      lines.forEach(function (x) {
        drawer.appendChild(h("div", { "class": "mo-chg" }, [
          h("span", { "class": "mo-chg-t", title: x.was + " → " + x.v, text: String(x.v).slice(0, 60) }),
          resetLink(function () {
            var rt = JSON.parse(JSON.stringify(REC.retyped));
            rt.lines = rt.lines.filter(function (y) { return !(y && norm(y.was) === norm(x.was) && (y.scene || "film") === (x.scene || "film")); });
            saveRecords({ retyped: rt.lines.length ? rt : null });
          })]));
      });
    }
    var layers = ((REC.retouched && REC.retouched.layers) || []).filter(function (e) {
      var m = e && typeof e.id === "string" && /^([a-z][a-z0-9-]*|film)-\d+\//.exec(e.id);
      return m && here(m[1]);
    });
    if (layers.length) {
      drawer.appendChild(h("h3", { text: T.layersH }));
      layers.forEach(function (e) {
        var what = Object.keys(RT_KEYS).filter(function (k) { return e[k]; }).map(function (k) { return T[k] || k; }).join(", ");
        drawer.appendChild(h("div", { "class": "mo-chg" }, [
          h("span", { "class": "mo-chg-t", title: what, text: (e.label || e.id.split("/")[1]).slice(0, 40) + (what ? " · " + what : "") }),
          resetLink(function () {
            var all = ((REC.retouched && REC.retouched.layers) || []).filter(function (x) { return x && x.id !== e.id; });
            saveRecords({ retouched: all.length ? { v: 1, layers: all } : null });
          })]));
      });
    }
    // The look of one thing on the picture.
    drawer.appendChild(h("h3", { text: T.look }));
    if (selected && selected.isConnected) drawer.appendChild(lookControls(selected));
    else drawer.appendChild(h("div", { "class": "mo-note", text: T.pickHint }));
    drawer.appendChild(h("div", { "class": "mo-note", text: T.editHint + " · " + T.rangeHint }));
    var any = ["retyped", "recolored", "refaced", "recut", "retouched"].some(function (k) { return C.files["modules/" + k + ".json"] != null; });
    if (any) {
      var ra = kit.labelled(kit.button(T.resetAll, "undo", function () { saveRecords({ retyped: null, recolored: null, refaced: null, recut: null, retouched: null }); }), T.resetAll);
      ra.classList.add("mo-wide");
      drawer.appendChild(ra);
      drawer.appendChild(h("div", { "class": "mo-note", text: T.byHand }));
    }
    document.body.appendChild(drawer);
    fit();
  }
  function tweaksSync() { var sc = custom ? null : sceneAt(cur); if ((sc ? sc.id : null) !== tweakSceneId) { selected = null; selBox.hidden = true; buildTweaks(); } }

  function setColors(p, idx) {
    var base = colorNow();
    var list = base.map(function (c, j) { return { name: c.name, was: c.base, v: String(p[j]).toUpperCase() }; }).filter(function (c) { return c.v.toLowerCase() !== c.was.toLowerCase(); });
    var rec = list.length ? { v: 1, colors: list } : null;
    if (rec && idx != null) rec.palette = idx;
    saveRecords({ recolored: rec });
  }
  function setFace(slot, id) {
    var rf = JSON.parse(JSON.stringify(REC.refaced || { v: 1, slots: {} }));
    rf.v = 1; rf.slots = rf.slots || {};
    if (id) rf.slots[slot] = { was: (SJ && SJ.fonts && SJ.fonts[slot]) || null, v: id };
    else delete rf.slots[slot];
    saveRecords({ refaced: Object.keys(rf.slots).length ? rf : null });
  }

  // A click on the picture plays or pauses it, as in any video player (a double click retypes words,
  // so the single click waits a moment to be sure it is one).
  var clickTimer = null;
  frame.addEventListener("click", function () {
    if (tweaksOpen || picking || editor || !editable) return;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(toggle, 220);
  });
  frame.addEventListener("dblclick", function () { clearTimeout(clickTimer); });
  // Select a thing on the paused picture (Tweaks open): its color, size, weight, or hide it.
  frame.addEventListener("click", function (e) {
    if (!tweaksOpen || playing || picking || custom) return;
    var n = e.target;
    if (!stage.contains(n) || n === stage) return;
    var sc = sceneAt(cur);
    if (!sc || !sc.el.contains(n) || n === sc.el) return;
    selected = lineAt(n) || (n.namespaceURI === "http://www.w3.org/2000/svg" && n.tagName !== "svg" ? n : n.closest("div,p,h1,h2,h3,h4,span,img") || n);
    if (selected.classList && selected.classList.contains("mo-word")) selected = selected.parentElement;
    drawSel();
    buildTweaks();
  });
  function drawSel() {
    if (!selected || !selected.isConnected) { selBox.hidden = true; return; }
    var r = selected.getBoundingClientRect(), vr = view.getBoundingClientRect();
    selBox.hidden = false;
    selBox.style.left = r.left - vr.left - 3 + "px"; selBox.style.top = r.top - vr.top - 3 + "px";
    selBox.style.width = r.width + 6 + "px"; selBox.style.height = r.height + 6 + "px";
  }
  function entryFor(n) {
    var sc = sceneAt(cur), tag = n.tagName.toLowerCase(), clsAttr = n.getAttribute("class") || "";
    var cls = clsAttr.split(/\s+/).filter(function (c) { return c && c !== "mo-word"; }).join(" ");
    var list = partsOf(sc, n.tagName, cls), i = list.indexOf(n);
    var words = n.getAttribute("data-mo-text") || n.textContent || "";
    var layers = (REC.retouched && REC.retouched.layers) || [];
    var at = n.getAttribute("data-mo-rt"), ex = at != null ? layers[+at] : null;
    if (ex) return JSON.parse(JSON.stringify(ex));
    var nOf = layers.filter(function (x) { return x && String(x.id).indexOf(sc.id + "-") === 0; }).length + 1;
    var e = { id: sc.id + "-" + nOf + "/" + tag, cls: cls, at: +(sc.local || 0).toFixed(2), kin: [Math.max(0, i), list.length] };
    if (norm(words)) { e.kin.push(hashWords(words)); e.label = norm(words).slice(0, 80); }
    return e;
  }
  function hex(c) {
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || "");
    return m ? "#" + [m[1], m[2], m[3]].map(function (x) { return ("0" + (+x).toString(16)).slice(-2); }).join("") : "#000000";
  }
  function lookControls(n) {
    var box = h("div"), cs = getComputedStyle(n), svg = n.namespaceURI === "http://www.w3.org/2000/svg", e = entryFor(n);
    function put(key, was, v) {
      var layers = JSON.parse(JSON.stringify((REC.retouched && REC.retouched.layers) || []));
      var i = layers.map(function (x) { return x && x.id; }).indexOf(e.id);
      var ent = i >= 0 ? layers[i] : e;
      if (v == null) delete ent[key];
      else ent[key] = { was: ent[key] ? ent[key].was : was, v: v };
      var has = Object.keys(RT_KEYS).some(function (k) { return ent[k]; });
      if (i >= 0) { if (has) layers[i] = ent; else layers.splice(i, 1); } else if (has) layers.push(ent);
      saveRecords({ retouched: layers.length ? { v: 1, layers: layers } : null });
    }
    if (svg) {
      var fi = h("input", { type: "color", value: hex(cs.fill) });
      fi.addEventListener("change", function () { put("svgfill", hex(cs.fill), fi.value); });
      box.appendChild(row(T.ink, [fi]));
    } else {
      var ink = h("input", { type: "color", value: hex(cs.color) });
      ink.addEventListener("change", function () { put("ink", hex(cs.color), ink.value); });
      box.appendChild(row(T.ink, [ink]));
      var px = h("input", { type: "number", min: "6", max: "600", step: "1", value: String(Math.round(parseFloat(cs.fontSize))) });
      px.addEventListener("change", function () { put("px", Math.round(parseFloat(cs.fontSize)), Math.max(6, Math.min(600, +px.value))); });
      box.appendChild(row(T.size + " (px)", [px]));
      var wt = h("select", {});
      [300, 400, 500, 600, 700, 800, 900].forEach(function (w) { wt.appendChild(h("option", { value: String(w), text: String(w) })); });
      wt.value = String(Math.round((parseInt(cs.fontWeight, 10) || 400) / 100) * 100);
      wt.addEventListener("change", function () { put("weight", parseInt(cs.fontWeight, 10) || 400, +wt.value); });
      box.appendChild(row(T.weight, [wt]));
    }
    var hid = h("input", { type: "checkbox" });
    hid.checked = !!(e.hidden && e.hidden.v === 1);
    hid.addEventListener("change", function () { put("hidden", 0, hid.checked ? 1 : null); });
    box.appendChild(row(T.hidden, [hid]));
    if (Object.keys(RT_KEYS).some(function (k) { return e[k]; })) {
      box.appendChild(row("", [resetLink(function () {
        var layers = ((REC.retouched && REC.retouched.layers) || []).filter(function (x) { return x && x.id !== e.id; });
        saveRecords({ retouched: layers.length ? { v: 1, layers: layers } : null });
      })]));
    }
    return box;
  }

  // ------------------------------------------------------------------ present (full screen through the host)
  var presenting = false, ctlTimer = 0;
  function present(on) {
    presenting = !!on;
    document.body.classList.toggle("mo-present", presenting);
    if (window.hermes && window.hermes.present) window.hermes.present(presenting).catch(function () {});
    else if (presenting && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
    else if (!presenting && document.fullscreenElement) document.exitFullscreen().catch(function () {});
    if (tweaksOpen && presenting) toggleTweaks();
    setTimeout(fit, 30);
  }
  document.addEventListener("mousemove", function () {
    if (!presenting) return;
    document.body.classList.add("mo-ctl"); clearTimeout(ctlTimer);
    ctlTimer = setTimeout(function () { document.body.classList.remove("mo-ctl"); fit(); }, 1800);
  });

  // ------------------------------------------------------------------ keyboard
  document.addEventListener("keydown", function (e) {
    var tg = e.target;
    if (tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.tagName === "SELECT" || tg.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === " " || k === "k" || k === "K") { e.preventDefault(); toggle(); }
    else if (k === "ArrowLeft" || k === ",") { e.preventDefault(); if (e.shiftKey) { pause(); seek(cur - 1); } else stepFrame(-1); }
    else if (k === "ArrowRight" || k === ".") { e.preventDefault(); if (e.shiftKey) { pause(); seek(cur + 1); } else stepFrame(1); }
    else if (k === "j" || k === "J") seek(cur - 1);
    else if (k === "l" || k === "L") seek(cur + 1);
    else if (k === "Home") { e.preventDefault(); seek(0); }
    else if (k === "End") { e.preventDefault(); pause(); seek(total); }
    else if (k === "m" || k === "M") setMuted(!muted);
    else if (k === "f" || k === "F") present(!presenting);
    else if (k === "i" || k === "I") { range = [cur, range ? Math.max(cur, range[1]) : Math.min(total, cur + 1)]; ui(); }
    else if (k === "o" || k === "O") { range = [range ? Math.min(range[0], cur) : Math.max(0, cur - 1), cur]; if (range[1] - range[0] < 0.05) range = null; ui(); }
    else if (k === "c" || k === "C") commentHere();
    else if (k === "Escape") { if (presenting) present(false); else if (range) { range = null; ui(); } else if (selected) { selected = null; selBox.hidden = true; if (tweaksOpen) buildTweaks(); } }
  });

  // ------------------------------------------------------------------ export
  function busyBox(label) {
    var bx = h("div", { "class": "mo-busy" }), fill = h("i"), txt = h("span"), cancelled = { v: false };
    var cancel = h("button", { "class": "kit-btn", type: "button", text: T.cancel, onclick: function () { cancelled.v = true; } });
    bx.appendChild(h("div", {}, [h("div", { text: T.building + " · " + label, style: "font-weight:600" }), h("div", { "class": "bar" }, [fill]), h("div", { "class": "row" }, [txt, cancel])]));
    document.body.appendChild(bx);
    return { set: function (i, n) { fill.style.width = (i / n * 100).toFixed(1) + "%"; txt.textContent = i + " / " + n + " " + T.frames; },
      text: function (s) { txt.textContent = s; }, cancelled: cancelled, done: function () { bx.remove(); } };
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nameBase() { return kit.slug(TITLE); }
  async function withFonts() {
    var f = await inlineFonts();
    exportFontCss = f.css;
    if (!f.ok) kit.toast(T.fontsOff);
  }

  async function pickVideoConfig(w, hh) {
    var codecs = ["avc1.640033", "avc1.64002a", "avc1.640028", "avc1.4d0033", "avc1.4d002a", "avc1.42e033", "avc1.42e02a"];
    for (var i = 0; i < codecs.length; i++) {
      var cfg = { codec: codecs[i], width: w, height: hh, bitrate: Math.round(Math.min(16e6, w * hh * FPS * 0.12)), framerate: FPS, avc: { format: "avc" } };
      try { var s = await VideoEncoder.isConfigSupported(cfg); if (s && s.supported) return cfg; } catch (e) {}
    }
    return null;
  }
  async function encodeAudio(seconds) {
    if (!score || !score.events.length) return { track: null, why: null };
    if (!window.AudioEncoder || !window.AudioData) return { track: null, why: T.noAudio };
    var rate = 48000, cfg = { codec: "mp4a.40.2", sampleRate: rate, numberOfChannels: 2, bitrate: 160000 };
    try { var s = await AudioEncoder.isConfigSupported(cfg); if (!s || !s.supported) return { track: null, why: T.noAudio }; } catch (e) { return { track: null, why: T.noAudio }; }
    var buf = await SND.render(score, seconds, rate);
    var chunks = [], desc = null, err = null;
    var enc = new AudioEncoder({
      output: function (c, md) {
        var b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push(b);
        if (md && md.decoderConfig && md.decoderConfig.description) { var d = md.decoderConfig.description; desc = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d); }
      },
      error: function (e) { err = e; }
    });
    enc.configure(cfg);
    var L0 = buf.getChannelData(0), R0 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L0, n = buf.length, step = 4800;
    for (var off = 0; off < n; off += step) {
      var m = Math.min(step, n - off), data = new Float32Array(m * 2);
      data.set(L0.subarray(off, off + m), 0); data.set(R0.subarray(off, off + m), m);
      var ad = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: m, numberOfChannels: 2, timestamp: Math.round(off * 1e6 / rate), data: data });
      enc.encode(ad); ad.close();
    }
    await enc.flush(); enc.close();
    if (err || !chunks.length) return { track: null, why: T.noAudio };
    return { track: { kind: "audio", rate: rate, channels: 2, bitrate: 160000, asc: desc || ENC.asc(rate, 2), samples: chunks.map(function (d) { return { data: d, dur: 1024 }; }) }, why: null };
  }

  var exporting = false;
  async function exportMp4() {
    if (exporting) return;
    if (!window.VideoEncoder || !window.VideoFrame) { kit.toast(T.noCodec); return; }
    exporting = true; pause();
    var keep = cur, w = W - (W % 2), hh = H - (H % 2), n = Math.max(1, Math.round(total * FPS)), bx = busyBox("MP4");
    try {
      var cfg = await pickVideoConfig(w, hh);
      if (!cfg) { kit.toast(T.noCodec); return; }
      await withFonts();
      var samples = [], avcC = null, err = null, TS = 90000, delta = Math.round(TS / FPS);
      var enc = new VideoEncoder({
        output: function (c, md) {
          var b = new Uint8Array(c.byteLength); c.copyTo(b);
          samples.push({ data: b, key: c.type === "key", pts: c.timestamp });
          if (md && md.decoderConfig && md.decoderConfig.description) { var d = md.decoderConfig.description; avcC = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d); }
        },
        error: function (e) { err = e; }
      });
      enc.configure(cfg);
      var canvas = document.createElement("canvas"); canvas.width = w; canvas.height = hh;
      for (var i = 0; i < n; i++) {
        if (bx.cancelled.v || err) break;
        await drawFrame(i / FPS, canvas);
        var vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
        vf.close();
        while (enc.encodeQueueSize > 4) await sleep(2);
        bx.set(i + 1, n);
      }
      if (bx.cancelled.v) { enc.close(); kit.toast(T.cancelled); return; }
      await enc.flush(); enc.close();
      if (err) throw err;
      if (!avcC) throw new Error("the encoder gave no avcC");
      // Decode order is output order; a reordered stream gets composition offsets.
      var vtrack = { kind: "video", width: w, height: hh, timescale: TS, avcC: avcC, samples: samples.map(function (s, k) {
        var pts = Math.round(s.pts * TS / 1e6), dts = k * delta;
        return { data: s.data, dur: delta, key: s.key, cts: pts - dts };
      }) };
      bx.text("AAC…");
      var au = await encodeAudio(n / FPS);
      var bytes = ENC.mp4(au.track ? [vtrack, au.track] : [vtrack]);
      kit.download(nameBase() + ".mp4", new Blob([bytes], { type: "video/mp4" }), "video/mp4");
      kit.toast(au.why || T.done);
    } catch (e) { console.error(e); kit.toast(String(e && e.message || e)); }
    finally { bx.done(); exporting = false; renderAt(keep); ui(); }
  }

  async function exportGif() {
    if (exporting) return;
    exporting = true; pause();
    var keep = cur, gw = Math.min(640, W), gh = Math.round(H * gw / W), delay = 7, n = Math.max(1, Math.round(total * 100 / delay)), bx = busyBox("GIF");
    try {
      await withFonts();
      var canvas = document.createElement("canvas"); canvas.width = gw; canvas.height = gh;
      var g = canvas.getContext("2d", { willReadFrequently: true }), gif = ENC.Gif(gw, gh), samples = [];
      for (var k = 0; k < 5; k++) { await drawFrame(total * k / 4 * 0.999, canvas); samples.push(g.getImageData(0, 0, gw, gh).data); }
      gif.setPalette(samples);
      for (var i = 0; i < n; i++) {
        if (bx.cancelled.v) break;
        await drawFrame(i * delay / 100, canvas);
        gif.addFrame(g.getImageData(0, 0, gw, gh).data, delay);
        bx.set(i + 1, n);
        if (i % 4 === 3) await sleep(0);
      }
      if (bx.cancelled.v) { kit.toast(T.cancelled); return; }
      kit.download(nameBase() + ".gif", new Blob([gif.finish()], { type: "image/gif" }), "image/gif");
      kit.toast(T.done);
    } catch (e) { console.error(e); kit.toast(String(e && e.message || e)); }
    finally { bx.done(); exporting = false; renderAt(keep); ui(); }
  }

  async function exportPng() {
    if (exporting) return;
    exporting = true; pause();
    var keep = cur;
    try {
      await withFonts();
      var canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
      await drawFrame(keep, canvas);
      var blob = await new Promise(function (r) { canvas.toBlob(r, "image/png"); });
      kit.download(nameBase() + "-" + fmtShort(keep).replace(":", "m") + "s.png", blob, "image/png");
    } catch (e) { console.error(e); kit.toast(String(e && e.message || e)); }
    finally { exporting = false; renderAt(keep); ui(); }
  }

  // ------------------------------------------------------------------ layout
  function fit() {
    var r = view.getBoundingClientRect(), pad = presenting || C.thumb ? 0 : 24;
    // Tweaks lies over the right side: the film fits in what is left beside it.
    var dw = !presenting && drawer && drawer.isConnected ? Math.min(drawer.offsetWidth, r.width * 0.7) : 0;
    // Tweaks ends above the player row, so play, loop and sound stay clickable while it is open.
    if (drawer) drawer.style.bottom = (controls.offsetHeight || 0) + "px";
    r = { width: r.width - dw, height: r.height };
    var k = Math.min((r.width - pad * 2) / W, (r.height - pad * 2) / H);
    if (!(k > 0)) return;
    frame.style.transform = "scale(" + k + ")";
    frame.style.left = (r.width - W * k) / 2 + "px";
    frame.style.top = (r.height - H * k) / 2 + "px";
    if (selected) drawSel();
  }
  new ResizeObserver(fit).observe(view);

  // ------------------------------------------------------------------ start
  bar.append(titleEl, roughBadge, contBtn, finBtn, statusEl, retryBtn, tweaksBtn, expBtn);
  titleEl.textContent = TITLE;
  if (!editable) tweaksBtn.hidden = true;
  if (!(window.hermes && window.hermes.comment)) commentBtn.hidden = true;
  kit.exports(exportList).then(function (hosted) { expBtn.hidden = hosted; });
  muteIcon();

  boot().then(function () {
    if (bootErr && !timeline.length && !custom) {
      view.appendChild(h("div", { "class": "kit-empty", text: bootErr, style: "position:absolute;inset:0;min-height:0" }));
    }
    refreshSegs();
    renderAt(0);
    fit();
    ui();
    if (!live) muteBtn.hidden = true;
    kit.ready();
  }).catch(function (e) { console.error(e); kit.ready(); });

  // For checks and tests: the player's own handle.
  window.__motion = {
    renderAt: function (t) { renderAt(t); ui(); return cur; }, seek: seek, play: play, pause: pause,
    get t() { return cur; }, get total() { return total; }, get timeline() { return timeline; }, get score() { return score; },
    get playing() { return playing; }, get range() { return range; }, set range(r) { range = r; ui(); },
    fonts: function () { return FONTS; }, exportMp4: exportMp4, exportGif: exportGif, exportPng: exportPng, snapshot: snapshot,
    drawFrame: drawFrame, host: function (name, d) { if (HOST[name]) HOST[name](d); }, records: function () { return REC; }, saveRecords: saveRecords, reload: reload, fmap: fmap, comment: commentHere
  };
})();
