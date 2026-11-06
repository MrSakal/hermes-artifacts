/* hermes-artifacts Design System runtime: a brand's browsable reference that agents read and build on.
 *
 * Content (the artifact's files, at its root):
 *   design-system.json   the index {v, title, namespace, libraries, groups, assetGroups, lastChange}
 *   tokens.json          the tokens (grammar: _kit/ds.js), compiled into tokens.css here
 *   README.md, *.md      the brand book and further sections
 *   components/<Comp>/README.md + preview.html (line 1: <!-- @dsCard group= height= width= subtitle= -->)
 *   components/Cover/preview.html  the cover; components/bundle.js, bundle.css, index.d.ts, lib/*.js
 *   fonts/*, assets/<Group>/*
 *
 * A left nav: Overview (cover + brand book), the sections, Colors (per theme), Typography, Spacing, Radius,
 * Shadows and further families, Components (live previews), Assets, Files. People edit token values and
 * usage, add and remove tokens, edit the markdown and upload images; each save is a new version.
 */
(function () {
  "use strict";
  var kit = window.kit, h = kit.h, C = kit.content, dsKit = window.dsKit, md = window.md;
  var L = /^hu\b/i.test(C.lang || navigator.language || "") ? "hu" : "en";
  var T = {
    en: { overview: "Overview", colors: "Colors", type: "Typography", components: "Components", assets: "Assets", files: "Files",
      sections: "Sections", foundations: "Foundations", theme: "Theme", makeDefault: "Make default", isDefault: "Default",
      defaultOn: "Designs, decks and films now build on this system", defaultOff: "No longer the default design system",
      defaultTitle: "The design system new designs, decks and films use", exp: "Export", css: "tokens.css", json: "tokens.json",
      zip: "All files (.zip)", noLib: "The export library didn't load (open the system in Hermes Desktop)",
      edit: "Edit", save: "Save", cancel: "Cancel", del: "Delete", add: "Add token", saving: "Saving…", saved: "Saved",
      notSaved: "Not saved", conflict: "Changed meanwhile: reopen to see the new version", noSave: "Can't save here",
      problems: function (n) { return n === 1 ? "1 value dropped" : n + " values dropped"; }, problemsWhy: "What dropped and why",
      noReadme: "No README.md yet: every reader starts there.", writeReadme: "Write the README", usage: "Usage", value: "Value",
      name: "Name", sample: "The quick brown fox jumps over the lazy dog", fonts: "Font files", families: "Families",
      notListed: "not in tokens.json type.fonts: no @font-face", missingFont: "listed, but the file is missing",
      noPreview: "No preview.html", guidelines: "Guidelines", previewFailed: "The preview failed: ",
      reactMissing: "The index lists React, but components/lib/ doesn't carry it: previews that need it stay static here (no network).",
      upload: "Upload image", newGroup: "New group", groupName: "Group name", tooBig: "Images up to 8 MB (png, jpeg, gif, webp)",
      badName: "Names: letters, digits, _ . - (no spaces, no /), up to 64", taken: "That name is used already",
      wouldDrop: "That value would drop: ", download: "Download", empty: "Nothing here yet.", other: "Other",
      ci: "A pipeline republishes this system: edits here may be overwritten.", readOnly: "Editing is off for this system.",
      updated: function (by, at) { return "Updated" + (by ? " by " + by : "") + (at ? " · " + at : ""); },
      noTokens: "tokens.json is missing or not valid JSON.", addColor: "Add color", tokens: "tokens", delSure: "Delete this token?",
      uploaded: "Uploaded", fam: { spacing: "Spacing", radius: "Radius", shadow: "Shadows" } },
    hu: { overview: "Áttekintés", colors: "Színek", type: "Tipográfia", components: "Komponensek", assets: "Eszközök", files: "Fájlok",
      sections: "Fejezetek", foundations: "Alapok", theme: "Téma", makeDefault: "Legyen alapértelmezett", isDefault: "Alapértelmezett",
      defaultOn: "Az új tervek, diasorok és filmek mostantól erre épülnek", defaultOff: "Már nem ez az alapértelmezett",
      defaultTitle: "Erre a design systemre épülnek az új tervek, diasorok és filmek", exp: "Exportálás", css: "tokens.css", json: "tokens.json",
      zip: "Minden fájl (.zip)", noLib: "Az export könyvtár nem töltődött be (nyisd meg a Hermes Desktopban)",
      edit: "Szerkesztés", save: "Mentés", cancel: "Mégse", del: "Törlés", add: "Új token", saving: "Mentés…", saved: "Elmentve",
      notSaved: "Nincs mentve", conflict: "Közben megváltozott: nyisd meg újra az új verzióért", noSave: "Itt nem lehet menteni",
      problems: function (n) { return n + " érték kimaradt"; }, problemsWhy: "Mi maradt ki és miért",
      noReadme: "Még nincs README.md: minden olvasó ott kezdi.", writeReadme: "README írása", usage: "Használat", value: "Érték",
      name: "Név", sample: "Árvíztűrő tükörfúrógép, gyors barna róka", fonts: "Betűfájlok", families: "Családok",
      notListed: "nincs a tokens.json type.fonts listájában: nincs @font-face", missingFont: "listázva, de a fájl hiányzik",
      noPreview: "Nincs preview.html", guidelines: "Irányelvek", previewFailed: "Az előnézet hibát dobott: ",
      reactMissing: "Az index Reactot listáz, de a components/lib/ nem tartalmazza: az ezt igénylő előnézetek itt statikusak (nincs hálózat).",
      upload: "Kép feltöltése", newGroup: "Új csoport", groupName: "Csoport neve", tooBig: "Legfeljebb 8 MB-os kép (png, jpeg, gif, webp)",
      badName: "Név: betű, szám, _ . - (szóköz és / nélkül), legfeljebb 64", taken: "Ez a név már foglalt",
      wouldDrop: "Ez az érték kimaradna: ", download: "Letöltés", empty: "Itt még nincs semmi.", other: "Egyéb",
      ci: "Egy pipeline újraközli ezt a rendszert: az itteni szerkesztések felülíródhatnak.", readOnly: "Ennél a rendszernél a szerkesztés ki van kapcsolva.",
      updated: function (by, at) { return "Frissítve" + (by ? " · " + by : "") + (at ? " · " + at : ""); },
      noTokens: "A tokens.json hiányzik, vagy nem érvényes JSON.", addColor: "Új szín", tokens: "token", delSure: "Törlöd ezt a tokent?",
      uploaded: "Feltöltve", fam: { spacing: "Térközök", radius: "Lekerekítés", shadow: "Árnyékok" } }
  }[L];

  var bar = document.getElementById("ds-bar"), nav = document.getElementById("ds-nav"), main = document.getElementById("ds-main");
  bar.className = "kit-bar";
  var IMG = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i, VIDEO = /\.(mp4|webm|mov)$/i, FONT = /\.(woff2?|ttf|otf|ttc)$/i;
  var NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

  // ------------------------------------------------------------------ the system as read
  var S = {};
  function load() {
    S.index = kit.json("design-system.json", {}) || {};
    var tt = kit.fileText("tokens.json");
    S.tokensRaw = null;
    if (tt != null) { try { S.tokensRaw = JSON.parse(tt); } catch (e) { S.tokensRaw = null; } }
    S.tokensBad = tt != null && !S.tokensRaw;
    S.tokens = S.tokensRaw && typeof S.tokensRaw === "object" ? S.tokensRaw : {};
    S.fontUrls = {};
    Object.keys(C.files).forEach(function (p) { if (/^fonts\//.test(p)) S.fontUrls[p] = kit.fileUrl(p); });
    S.compiled = dsKit.compile(S.tokens, { fonts: S.fontUrls });
    S.m = S.compiled.model;
    S.title = S.index.title || C.title || "Design system";
    S.bundle = kit.fileText("components/bundle.js") || "";
    S.header = null;
    var hm = /^\s*\/\*\s*@ds-bundle:\s*(\{[\s\S]*?\})\s*\*\//.exec(S.bundle);
    if (hm) { try { S.header = JSON.parse(hm[1]); } catch (e) { S.header = null; } }
    S.components = components();
    S.sections = sections();
    S.editable = !C.thumb && !!(window.hermes && window.hermes.save) && !S.index.editing;
    var fx = document.getElementById("ds-fontfaces") || document.head.appendChild(h("style", { id: "ds-fontfaces" }));
    fx.textContent = fontFaces();
  }

  function fontFaces() {
    return S.m.type.fonts.filter(function (f) { return S.fontUrls[f.file]; }).map(function (f) {
      return "@font-face{font-family:\"" + f.family + "\";src:url(\"" + S.fontUrls[f.file] + "\");font-weight:" + f.weight + ";font-style:" + f.style + ";font-display:swap}";
    }).join("\n");
  }

  function sections() {
    return Object.keys(C.files).filter(function (p) {
      return /\.mdx?$/i.test(p) && p !== "README.md" && !/^(components|archived|assets)\//.test(p);
    }).sort().slice(0, 24).map(function (p) {
      var t = /^#\s+(.+)$/m.exec(kit.fileText(p) || "");
      return { id: "md:" + p, path: p, title: t ? t[1].trim() : p.replace(/^.*\//, "").replace(/\.mdx?$/i, "") };
    });
  }

  function marker(src) {
    var m = /^\s*<!--\s*@dsCard\b([\s\S]*?)-->/.exec(src || ""), out = {};
    if (!m) return out;
    var re = /([A-Za-z]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g, a;
    while ((a = re.exec(m[1]))) out[a[1]] = a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : true;
    return out;
  }

  function components() {
    var names = [], seen = {};
    function add(n) { if (n && !seen[n] && /^[A-Za-z_$][\w$]*$/.test(n)) { seen[n] = 1; names.push(n); } }
    (S.header && Array.isArray(S.header.components) ? S.header.components : []).forEach(function (c) { add(c && c.name); });
    var folders = {};
    Object.keys(C.files).forEach(function (p) {
      var m = /^components\/([A-Za-z_$][\w$]*)\/(preview\.html|README\.md)$/.exec(p);
      if (m && m[1] !== "lib" && m[1] !== "src") folders[m[1]] = 1;
    });
    S.coverIsComponent = !!(C.files["components/Cover/README.md"] || C.files["components/Cover/Cover.d.ts"] || seen.Cover);
    Object.keys(folders).sort().forEach(function (n) { if (n !== "Cover" || S.coverIsComponent) add(n); });
    return names.map(function (n) {
      var prev = C.files["components/" + n + "/preview.html"] != null ? "components/" + n + "/preview.html" : null;
      var mk = prev ? marker(kit.fileText(prev)) : {};
      var readme = kit.fileText("components/" + n + "/README.md");
      return { name: n, preview: prev, marker: mk, group: mk.group || "", readme: readme };
    });
  }

  // ------------------------------------------------------------------ state
  var state = { section: "overview", theme: null, sel: null, editing: null, chosenTheme: false };
  load();
  state.theme = S.m.first;
  (function pickTheme() {
    var dark = document.documentElement.getAttribute("data-theme") === "dark" ||
      (!document.documentElement.getAttribute("data-theme") && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    var want = dark ? "dark" : "light";
    if (S.m.themes.some(function (t) { return t.id === want; })) state.theme = want;
  })();

  function sendView() {
    kit.view(function () {
      var nv = navItems().filter(function (x) { return x.id === state.section; })[0];
      var ctx = { section: state.section, sectionTitle: nv ? nv.title : state.section, theme: state.theme,
        problems: S.compiled.problems.length };
      if (state.sel && state.sel.kind === "token") ctx.selectedToken = { family: state.sel.family, name: state.sel.name };
      if (state.sel && state.sel.kind === "component") ctx.selectedComponent = state.sel.name;
      if (state.editing) ctx.editing = state.editing;
      return ctx;
    });
  }

  // ------------------------------------------------------------------ saving (each save is a new version)
  var statusEl = h("span", { "class": "ds-status", "aria-live": "polite" });
  function status(kind) {
    statusEl.textContent = kind === "saving" ? T.saving : kind === "saved" ? T.saved : kind === "failed" ? T.notSaved : "";
    if (kind === "saved") setTimeout(function () { if (statusEl.textContent === T.saved) statusEl.textContent = ""; }, 2000);
  }
  function withChange(note) {
    var ix = JSON.parse(JSON.stringify(S.index || {}));
    ix.lastChange = { by: "user", at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), via: "page", note: String(note || "").slice(0, 280) };
    return JSON.stringify(ix, null, 2) + "\n";
  }
  function saveFiles(files, note) {
    if (!S.editable) { kit.toast(T.noSave); return Promise.resolve(false); }
    if (C.files["design-system.json"] != null) files["design-system.json"] = withChange(note);
    status("saving");
    return window.hermes.save(files, C.version).then(function (r) {
      if (!r || r.conflict || !r.ok) { status("failed"); kit.toast(r && r.conflict ? T.conflict : T.notSaved); return false; }
      C.version = r.version;
      Object.keys(files).forEach(function (p) { if (files[p] == null) delete C.files[p]; else C.files[p] = files[p]; });
      load();
      status("saved");
      return true;
    }, function (e) { status("failed"); kit.toast(String(e && e.message || T.notSaved)); return false; });
  }
  function tokensText(t) { return JSON.stringify(t, null, 2) + "\n"; }

  // ------------------------------------------------------------------ chrome
  var themeSeg = h("div", { "class": "kit-seg ds-themes", role: "group", "aria-label": T.theme });
  function drawThemes() {
    themeSeg.replaceChildren();
    themeSeg.hidden = S.m.themes.length < 2;
    S.m.themes.forEach(function (t) {
      var b = kit.labelled(kit.button(t.name, "", function () { state.chosenTheme = true; setTheme(t.id); }, t.name), t.name);
      b.setAttribute("aria-pressed", String(t.id === state.theme));
      themeSeg.appendChild(b);
    });
  }
  function setTheme(id) {
    state.theme = id;
    drawThemes();
    Object.keys(frames).forEach(function (k) {
      var f = frames[k];
      try { f.iframe.contentWindow.postMessage({ dsTheme: id }, "*"); } catch (e) {}
    });
    if (/^(colors|fam:)/.test(state.section)) render();
    sendView();
  }
  if (kit.hostTheme) kit.hostTheme(function (ht) {
    if (state.chosenTheme || !ht) return;
    var want = ht.mode === "dark" ? "dark" : "light";
    if (want !== state.theme && S.m.themes.some(function (t) { return t.id === want; })) setTheme(want);
  });

  var defBtn = kit.labelled(kit.button(T.makeDefault, "", toggleDefault, T.defaultTitle), T.makeDefault);
  defBtn.classList.add("ds-default"); defBtn.hidden = true;
  var isDefault = false;
  function drawDefault() {
    defBtn.setAttribute("aria-pressed", String(isDefault));
    kit.labelled(defBtn, isDefault ? "✓ " + T.isDefault : T.makeDefault);
  }
  function toggleDefault() {
    var on = !isDefault;
    window.hermes.ds.makeDefault(on).then(function (r) {
      if (!r || r.ok === false) throw new Error(T.notSaved);
      isDefault = r.default !== undefined ? r.default === C.id : on;
      drawDefault();
      kit.toast(isDefault ? T.defaultOn : T.defaultOff);
    }).catch(function (e) { kit.toast(String(e && e.message || e)); });
  }
  if (!C.thumb && window.hermes && window.hermes.ds) {
    window.hermes.ds.get().then(function (d) {
      isDefault = !!(d && !d.none && d.id && d.id === C.id);
      defBtn.hidden = false; drawDefault();
    }).catch(function () {});
  }

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
  function tokensCss() {
    return "/* " + S.title + " — generated from tokens.json */\n" + dsKit.compile(S.tokens).css;
  }
  function bytesOf(path) {
    var v = C.files[path];
    if (typeof v === "string" && v.slice(0, 5) === "data:") {
      var b64 = v.slice(v.indexOf(",") + 1), bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new TextEncoder().encode(String(v == null ? "" : v));
  }
  function mimeOf(path) {
    var v = C.files[path];
    if (typeof v === "string" && v.slice(0, 5) === "data:") return v.slice(5, v.indexOf(";")) || "application/octet-stream";
    return /\.svg$/i.test(path) ? "image/svg+xml" : /\.json$/i.test(path) ? "application/json" : /\.css$/i.test(path) ? "text/css" :
      /\.js$/i.test(path) ? "text/javascript" : /\.html?$/i.test(path) ? "text/html" : /\.md$/i.test(path) ? "text/markdown" : "text/plain";
  }
  function exportZip() {
    lib("fflate.umd.js", "fflate").then(function (fflate) {
      var all = {};
      Object.keys(C.files).forEach(function (p) { all[p] = bytesOf(p); });
      if (!all["tokens.css"]) all["tokens.css"] = new TextEncoder().encode(tokensCss());
      var zip = fflate.zipSync(all, { level: 6 });
      kit.download(kit.slug(S.title) + ".zip", new Blob([zip], { type: "application/zip" }), "application/zip");
    }).catch(function (e) { kit.toast(String(e && e.message || e)); });
  }
  var exportList = [
    { id: "tokens-css", label: T.css, run: function () { kit.download("tokens.css", tokensCss(), "text/css"); } },
    { id: "tokens-json", label: T.json, run: function () { kit.download("tokens.json", kit.fileText("tokens.json") || tokensText(S.tokens), "application/json"); } },
    { id: "zip", label: T.zip, run: exportZip }];
  var expBtn = kit.labelled(kit.button(T.exp, "download", function () {
    kit.menu(expBtn, exportList.map(function (x) { return { label: x.label, onClick: x.run }; }));
  }), T.exp);
  expBtn.hidden = true;
  if (!C.thumb) kit.exports(exportList).then(function (hosted) { expBtn.hidden = hosted; });

  bar.append(h("span", { "class": "kit-title", text: S.title }), statusEl, themeSeg, defBtn, expBtn);

  // ------------------------------------------------------------------ nav
  function navItems() {
    var out = [{ id: "overview", title: T.overview, part: "top" }];
    S.sections.forEach(function (s) { out.push({ id: s.id, title: s.title, part: "sections" }); });
    if (S.m.colors.length || S.tokens.color) out.push({ id: "colors", title: T.colors, part: "foundations" });
    if (S.m.type.groups.length || S.m.type.familyKeys.length || S.m.type.fonts.length || Object.keys(S.fontUrls).length)
      out.push({ id: "type", title: T.type, part: "foundations" });
    S.m.families.forEach(function (f) { out.push({ id: "fam:" + f.key, title: T.fam[f.key] || f.title, part: "foundations" }); });
    if (S.components.length) out.push({ id: "components", title: T.components, part: "build" });
    if (assetPaths().length || S.editable) out.push({ id: "assets", title: T.assets, part: "build" });
    out.push({ id: "files", title: T.files, part: "build" });
    return out;
  }
  function drawNav() {
    var items = navItems(), last = null, kids = [];
    if (!items.some(function (x) { return x.id === state.section; })) state.section = "overview";
    items.forEach(function (it) {
      if (it.part !== last) {
        if (it.part === "sections") kids.push(h("div", { "class": "ds-nav-h", text: T.sections }));
        if (it.part === "foundations") kids.push(h("div", { "class": "ds-nav-h", text: T.foundations }));
        if (it.part === "build" && last !== "build") kids.push(h("div", { "class": "ds-nav-h ds-nav-gap" }));
        last = it.part;
      }
      kids.push(h("button", { type: "button", "class": "ds-nav-i" + (it.id === state.section ? " on" : ""), "aria-current": it.id === state.section ? "page" : null,
        text: it.title, onclick: function () { go(it.id); } }));
    });
    var lc = S.index.lastChange;
    if (lc && (lc.by || lc.at)) kids.push(h("div", { "class": "ds-nav-foot", text: T.updated(lc.by, String(lc.at || "").slice(0, 10)) }));
    nav.replaceChildren.apply(nav, kids);
  }
  function go(id) {
    state.section = id; state.sel = null; state.editing = null;
    render();
    main.scrollTop = 0; window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ shared bits
  function heading(text, extra) { return h("div", { "class": "ds-head" }, [h("h1", { text: text })].concat(extra || [])); }
  function problemsNote(list) {
    if (!list.length) return null;
    return h("details", { "class": "ds-problems" }, [
      h("summary", { text: T.problems(list.length) + " · " + T.problemsWhy }),
      h("ul", {}, list.map(function (p) {
        return h("li", {}, [h("code", { text: (p.family ? p.family + (p.name ? "." : "") : "") + (p.name || "") }), " " + p.reason]);
      }))
    ]);
  }
  function familyProblems(key) { return S.compiled.problems.filter(function (p) { return p.family === key; }); }
  function resolveRel(base, rel) {
    if (/^(data:|https?:|mailto:|#|\/)/i.test(rel)) return null;
    var parts = base ? base.split("/") : [];
    rel.split(/[?#]/)[0].split("/").forEach(function (seg) {
      if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(decodeURIComponent(seg));
    });
    return parts.join("/");
  }
  function dirOf(p) { return p.indexOf("/") >= 0 ? p.slice(0, p.lastIndexOf("/")) : ""; }
  function markdown(text, path, stripTitle) {
    var src = String(text || "");
    if (stripTitle) src = src.replace(/^\s*#\s+[^\n]*\n?/, "");
    var art = h("div", { "class": "ds-prose" });
    art.innerHTML = md.html(md.parse(src), function (u) {
      if (/^data:image\//i.test(u)) return u;
      var p = resolveRel(dirOf(path || ""), u);
      return p && C.files[p] != null ? kit.fileUrl(p) : "";
    });
    return art;
  }
  function mdEditor(path, text, onDone) {
    var ta = h("textarea", { "class": "ds-md-edit", spellcheck: "true" });
    ta.value = text || "";
    var wrap = h("div", { "class": "ds-editor" }, [ta, h("div", { "class": "ds-row-btns" }, [
      btn(T.save, "primary", function () {
        var files = {}; files[path] = ta.value.replace(/\r\n?/g, "\n");
        saveFiles(files, "edited " + path).then(function (ok) { if (ok) { state.editing = null; render(); } });
      }),
      btn(T.cancel, "", function () { state.editing = null; onDone ? onDone() : render(); })
    ])]);
    setTimeout(function () { ta.focus(); ta.style.height = Math.min(640, Math.max(220, ta.scrollHeight + 4)) + "px"; }, 0);
    return wrap;
  }
  function btn(label, kind, fn, title) {
    return h("button", { type: "button", "class": "ds-btn" + (kind ? " ds-btn-" + kind : ""), text: label, title: title || null, onclick: fn });
  }
  function mdSection(path, title) {
    var text = kit.fileText(path), editing = state.editing === path;
    var tools = S.editable && !editing ? [btn(T.edit, "", function () { state.editing = path; render(); })] : [];
    var kids = [heading(title, tools)];
    if (editing) kids.push(mdEditor(path, text));
    else if (text == null) kids.push(h("p", { "class": "ds-muted", text: T.noReadme }));
    else kids.push(markdown(text, path, true));
    return kids;
  }

  // ------------------------------------------------------------------ preview frames
  var frames = {}, frameSeq = 0;
  function libFiles() {
    var out = [], seen = {};
    (Array.isArray(S.index.libraries) ? S.index.libraries : []).forEach(function (l) {
      var f = l && l.file ? String(l.file) : null;
      if (f && f.indexOf("/") < 0) f = "components/lib/" + f;
      if (f && C.files[f] != null && !seen[f]) { seen[f] = 1; out.push(f); }
    });
    Object.keys(C.files).filter(function (p) { return /^components\/lib\/[^/]+\.js$/i.test(p) && !seen[p]; }).sort(function (a, b) {
      var ra = /\/react\./i.test(a) ? 0 : /\/react-dom/i.test(a) ? 1 : 2, rb = /\/react\./i.test(b) ? 0 : /\/react-dom/i.test(b) ? 1 : 2;
      return ra - rb || (a < b ? -1 : 1);
    }).forEach(function (p) { out.push(p); });
    return out;
  }
  function reactMissing() {
    var wants = (Array.isArray(S.index.libraries) ? S.index.libraries : []).some(function (l) { return l && /^react(-dom)?$/i.test(l.name); });
    return wants && !libFiles().some(function (p) { return /react/i.test(p); });
  }
  function inlineJs(s) { return "<script>" + String(s).replace(/<\/script/gi, "<\\/script") + "</" + "script>"; }
  function frameHtml(path, id) {
    var dir = dirOf(path), src = (kit.fileText(path) || "").replace(/^\s*<!--\s*@dsCard\b[\s\S]*?-->\s*/, "");
    // The system's own files by relative path: scripts inline, the rest as data: URLs.
    src = src.replace(/<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi, function (all, a, q, u) {
      var p = resolveRel(dir, u);
      return p && C.files[p] != null && /\.m?js$/i.test(p) ? inlineJs(kit.fileText(p)) : all;
    });
    src = src.replace(/\b(src|href|poster)\s*=\s*(["'])([^"']+)\2/gi, function (all, a, q, u) {
      var p = resolveRel(dir, u);
      return p && C.files[p] != null ? a + "=" + q + kit.fileUrl(p) + q : all;
    });
    src = src.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, function (all, q, u) {
      var p = resolveRel(dir, u);
      return p && C.files[p] != null ? "url(\"" + kit.fileUrl(p) + "\")" : all;
    });
    var css = dsKit.css({ tokens: S.tokens, fonts: S.fontUrls, css: kit.fileText("components/bundle.css") || "" });
    var probe = "(function(){var ID=" + JSON.stringify(id) + ";document.documentElement.setAttribute('data-theme'," + JSON.stringify(state.theme) + ");" +
      "function post(m){m.dsFrame=ID;try{parent.postMessage(m,'*')}catch(e){}}" +
      "addEventListener('error',function(e){post({error:String(e.message||'error')})});" +
      "addEventListener('message',function(e){if(e.source===parent&&e.data&&e.data.dsTheme)document.documentElement.setAttribute('data-theme',e.data.dsTheme)});" +
      "function size(){var b=document.body,d=document.documentElement;post({h:Math.max(b?b.scrollHeight:0,d.scrollHeight)})}" +
      "addEventListener('load',function(){size();setTimeout(size,250);post({loaded:1});if(window.ResizeObserver&&document.body)new ResizeObserver(size).observe(document.body)})})();";
    var pre = "<meta charset=\"utf-8\"><style>" + css.replace(/<\/style/gi, "<\\/style") + "</style>" + inlineJs(probe) +
      libFiles().map(function (p) { return inlineJs(kit.fileText(p)); }).join("") + (S.bundle ? inlineJs(S.bundle) : "");
    if (/<head\b[^>]*>/i.test(src)) return src.replace(/<head\b[^>]*>/i, function (m) { return m + pre; });
    if (/<html\b[^>]*>/i.test(src)) return src.replace(/<html\b[^>]*>/i, function (m) { return m + "<head>" + pre + "</head>"; });
    return "<!doctype html><html><head>" + pre + "</head><body>" + src + "</body></html>";
  }
  function frame(path, opts) {
    var id = "f" + (++frameSeq), mk = opts.marker || {};
    var hgt = Math.max(opts.min || 40, Math.min(opts.max || 4000, parseInt(mk.height, 10) || opts.height || 120));
    var w = parseInt(mk.width, 10) || opts.width || 0;
    var iframe = h("iframe", { sandbox: "allow-scripts", title: opts.title || path, loading: opts.lazy ? "lazy" : null, "class": "ds-frame" });
    iframe.srcdoc = frameHtml(path, id);
    var wrap = h("div", { "class": "ds-frame-wrap" + (w ? " ds-scaled" : "") }, [iframe]);
    var f = frames[id] = { iframe: iframe, wrap: wrap, h: hgt, base: hgt, w: w, grow: !opts.fixed, onError: opts.onError, onLoad: opts.onLoad };
    layoutFrame(f);
    return wrap;
  }
  function layoutFrame(f) {
    if (f.w) {
      var avail = f.wrap.clientWidth || f.wrap.parentNode && f.wrap.parentNode.clientWidth || f.w;
      var k = Math.min(1, avail / f.w);
      f.iframe.style.width = f.w + "px"; f.iframe.style.height = f.h + "px";
      f.iframe.style.transform = "scale(" + k + ")";
      f.wrap.style.height = Math.ceil(f.h * k) + "px";
    } else {
      f.iframe.style.width = "100%"; f.iframe.style.height = f.h + "px"; f.iframe.style.transform = "";
      f.wrap.style.height = "";
    }
  }
  window.addEventListener("message", function (e) {
    var d = e.data, f = d && d.dsFrame && frames[d.dsFrame];
    if (!f || e.source !== f.iframe.contentWindow) return;
    if (d.error && f.onError) f.onError(d.error);
    if (d.loaded && f.onLoad) f.onLoad();
    if (d.h && f.grow) {
      var nh = Math.max(f.base, Math.min(4000, Math.ceil(d.h)));
      if (Math.abs(nh - f.h) > 1) { f.h = nh; layoutFrame(f); }
    }
  });
  if (window.ResizeObserver) new ResizeObserver(function () {
    Object.keys(frames).forEach(function (k) { if (frames[k].w) layoutFrame(frames[k]); });
  }).observe(main);

  function cover(opts) {
    var path = "components/Cover/preview.html";
    if (S.coverIsComponent || C.files[path] == null) return null;
    var mk = marker(kit.fileText(path));
    return h("div", { "class": "ds-cover" }, [frame(path, { marker: { height: mk.height, width: 960 }, min: 240, max: 360, height: 288, fixed: true,
      title: S.title, onLoad: opts && opts.onLoad })]);
  }

  // ------------------------------------------------------------------ views
  function overview() {
    var kids = [], cv = cover();
    if (S.index.lastChange && /^CI/i.test(String(S.index.lastChange.via || ""))) kids.push(h("div", { "class": "ds-banner", text: T.ci }));
    if (S.index.editing && !C.thumb) kids.push(h("div", { "class": "ds-banner", text: T.readOnly }));
    if (cv) kids.push(cv);
    if (S.tokensBad) kids.push(h("div", { "class": "ds-banner", text: T.noTokens }));
    var pn = problemsNote(S.compiled.problems);
    if (pn) kids.push(pn);
    var text = kit.fileText("README.md"), editing = state.editing === "README.md";
    var tools = S.editable && !editing ? [btn(text == null ? T.writeReadme : T.edit, "", function () { state.editing = "README.md"; render(); })] : [];
    kids.push(heading(S.title, tools));
    if (editing) kids.push(mdEditor("README.md", text == null ? "# " + S.title + "\n\n" : text));
    else if (text == null) kids.push(h("p", { "class": "ds-muted", text: T.noReadme }));
    else kids.push(markdown(text, "README.md", true));
    return kids;
  }

  function stem(n) { var m = /^(.+?)[-_.][^-_.]+$/.exec(n); return m ? m[1] : n; }
  function stemRuns(list) {
    var runs = [];
    list.forEach(function (t) {
      var s = stem(t.name), r = runs[runs.length - 1];
      if (r && r.stem === s) r.items.push(t); else runs.push({ stem: s, items: [t] });
    });
    // Neighbouring single tokens share one unlabelled run.
    var out = [];
    runs.forEach(function (r) {
      var p = out[out.length - 1];
      if (r.items.length === 1 && p && p.loose) p.items = p.items.concat(r.items);
      else out.push(r.items.length === 1 ? { stem: "", loose: true, items: r.items } : r);
    });
    return out;
  }
  function isSel(fam, name) { return state.sel && state.sel.kind === "token" && state.sel.family === fam && state.sel.name === name; }
  function select(fam, name) {
    if (isSel(fam, name) && state.editing !== "token:" + fam + ":" + name) { state.sel = null; state.editing = null; }
    else { state.sel = { kind: "token", family: fam, name: name }; state.editing = S.editable ? "token:" + fam + ":" + name : null; }
    render();
  }

  function colorView() {
    var th = state.theme, kids = [heading(T.colors, S.m.themes.length > 1 ? [h("span", { "class": "ds-muted", text: T.theme + ": " +
      S.m.themes.filter(function (t) { return t.id === th; })[0].name })] : [])];
    if (S.m.note) kids.push(h("p", { "class": "ds-muted", text: S.m.note }));
    var pn = problemsNote(familyProblems("color")); if (pn) kids.push(pn);
    var list = h("div", { "class": "ds-tokens ds-colors" });
    stemRuns(S.m.colors).forEach(function (run) {
      if (run.stem) list.appendChild(h("div", { "class": "ds-divider", text: run.stem }));
      run.items.forEach(function (c) {
        var v = c.values[th] || c.values[S.m.first], resolved = S.m.resolve(c.name, th) || "transparent";
        var shown = v.alias ? "{" + v.alias + "} → " + resolved : v.ok;
        var chips = S.m.themes.length > 1 ? h("span", { "class": "ds-chips" }, S.m.themes.map(function (t) {
          return h("span", { "class": "ds-chip" + (t.id === th ? " on" : ""), title: t.name + ": " + (S.m.resolve(c.name, t.id) || ""),
            style: "--sw:" + (S.m.resolve(c.name, t.id) || "transparent") });
        })) : null;
        var row = h("div", { "class": "ds-token" + (isSel("color", c.name) ? " on" : ""), tabindex: "0", role: "button",
          "data-token": c.name, onclick: function () { select("color", c.name); },
          onkeydown: function (e) { if (e.key === "Enter" && e.target === row) select("color", c.name); } }, [
          h("span", { "class": "ds-swatch", style: "--sw:" + resolved }),
          h("span", { "class": "ds-token-main" }, [h("code", { "class": "ds-token-name", text: c.name }), h("span", { "class": "ds-token-val", text: shown }), chips]),
          h("span", { "class": "ds-token-usage", text: c.usage || "" })
        ]);
        list.appendChild(row);
        if (state.editing === "token:color:" + c.name) list.appendChild(tokenEditor("color", c));
      });
    });
    if (!S.m.colors.length) list.appendChild(h("p", { "class": "ds-muted", text: T.empty }));
    kids.push(list);
    if (S.editable) kids.push(state.editing === "new:color" ? tokenEditor("color", null) : btn("+ " + T.addColor, "", function () { state.editing = "new:color"; state.sel = null; render(); }));
    return kids;
  }

  function famView(key) {
    var f = S.m.families.filter(function (x) { return x.key === key; })[0];
    if (!f) return [heading(key), h("p", { "class": "ds-muted", text: T.empty })];
    var kids = [heading(T.fam[f.key] || f.title)];
    if (f.note) kids.push(h("p", { "class": "ds-muted", text: f.note }));
    var pn = problemsNote(familyProblems(key)); if (pn) kids.push(pn);
    var list = h("div", { "class": "ds-tokens ds-fam-" + (key === "spacing" || key === "radius" || key === "shadow" ? key : "plain") });
    stemRuns(f.tokens).forEach(function (run) {
      if (run.stem) list.appendChild(h("div", { "class": "ds-divider", text: run.stem }));
      run.items.forEach(function (t) {
        var v = f.kind === "shadow" ? S.m.shadow(t, state.theme) : t.value, vis;
        if (key === "spacing") vis = h("span", { "class": "ds-vis" }, [h("span", { "class": "ds-space", style: "width:min(100%," + v + ")" })]);
        else if (key === "radius") vis = h("span", { "class": "ds-vis" }, [h("span", { "class": "ds-radius", style: "border-radius:" + v })]);
        else if (key === "shadow") vis = h("span", { "class": "ds-vis" }, [h("span", { "class": "ds-shadow", style: "box-shadow:" + v })]);
        else if (/opacity/i.test(key) && /^[\d.]+%?$/.test(v)) vis = h("span", { "class": "ds-vis" }, [h("span", { "class": "ds-opacity", style: "opacity:" + v })]);
        else vis = h("span", { "class": "ds-vis" });
        var row = h("div", { "class": "ds-token" + (isSel(key, t.name) ? " on" : ""), tabindex: "0", role: "button", "data-token": t.name,
          onclick: function () { select(key, t.name); }, onkeydown: function (e) { if (e.key === "Enter" && e.target === row) select(key, t.name); } }, [
          vis, h("span", { "class": "ds-token-main" }, [h("code", { "class": "ds-token-name", text: t.name }), h("span", { "class": "ds-token-val", text: v })]),
          h("span", { "class": "ds-token-usage", text: t.usage || "" })
        ]);
        list.appendChild(row);
        if (state.editing === "token:" + key + ":" + t.name) list.appendChild(tokenEditor(key, t));
      });
    });
    if (!f.tokens.length) list.appendChild(h("p", { "class": "ds-muted", text: T.empty }));
    kids.push(list);
    if (S.editable) kids.push(state.editing === "new:" + key ? tokenEditor(key, null) : btn("+ " + T.add, "", function () { state.editing = "new:" + key; state.sel = null; render(); }));
    return kids;
  }

  // Edit a token's value (per theme for colours and shadows) and usage, add one, remove one.
  function tokenEditor(fam, tok) {
    var perTheme = (fam === "color" || fam === "shadow") && S.m.themes.length > 1 && !S.m.themes[0].implicit;
    var raw = tok && tok.raw ? tok.raw : null, nameIn = null, inputs = {}, err = h("div", { "class": "ds-err", "aria-live": "polite" });
    var kids = [];
    if (!tok) {
      nameIn = h("input", { type: "text", "class": "ds-in", placeholder: T.name, "aria-label": T.name, spellcheck: "false" });
      kids.push(h("label", { "class": "ds-field" }, [h("span", { text: T.name }), nameIn]));
    }
    function valueField(label, val, key) {
      var inp = h("input", { type: "text", "class": "ds-in ds-mono", value: val == null ? "" : String(val), "aria-label": label, spellcheck: "false" });
      inputs[key] = inp;
      var extra = null;
      if (fam === "color") {
        var pick = h("input", { type: "color", "class": "ds-pick", "aria-label": label, tabindex: "-1" });
        var sync = function () { var m = /^#([0-9a-f]{6})/i.exec(inp.value.trim()) || /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(inp.value.trim()); pick.value = m ? (m.length > 2 ? "#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3] : "#" + m[1]) : "#000000"; };
        sync(); inp.addEventListener("input", sync);
        pick.addEventListener("input", function () { inp.value = pick.value; });
        extra = pick;
      }
      return h("label", { "class": "ds-field" }, [h("span", { text: label }), h("span", { "class": "ds-in-row" }, [inp, extra])]);
    }
    if (perTheme) {
      S.m.themes.forEach(function (t) {
        var v = raw && raw.value && typeof raw.value === "object" ? raw.value[t.id] : t.id === S.m.first && raw ? raw.value : "";
        kids.push(valueField(T.value + " · " + t.name, v, t.id));
      });
    } else kids.push(valueField(T.value, raw ? (typeof raw.value === "object" && raw.value ? raw.value[S.m.first] : raw.value) : "", "_"));
    var usage = h("textarea", { "class": "ds-in", rows: "2", "aria-label": T.usage });
    usage.value = raw && raw.usage ? raw.usage : "";
    kids.push(h("label", { "class": "ds-field" }, [h("span", { text: T.usage }), usage]));
    kids.push(err);
    var btns = [btn(T.save, "primary", function () { commit(false); }),btn(T.cancel, "", function () { state.editing = null; render(); })];
    if (tok) btns.push(btn(T.del, "danger", function () { if (window.confirm ? confirm(T.delSure) : true) commit(true); }));
    kids.push(h("div", { "class": "ds-row-btns" }, btns));
    var box = h("div", { "class": "ds-editor ds-token-editor", onclick: function (e) { e.stopPropagation(); } }, kids);
    setTimeout(function () { (nameIn || inputs[Object.keys(inputs)[0]]).focus(); }, 0);

    function commit(remove) {
      var next = JSON.parse(JSON.stringify(S.tokens || {})), name = tok ? tok.name : String(nameIn.value || "").trim().replace(/^(--|\.)/, "");
      if (!next[fam] || !Array.isArray(next[fam].tokens)) next[fam] = Object.assign({}, next[fam] && Array.isArray(next[fam].themes) ? { themes: next[fam].themes } : {}, { tokens: [] });
      var list = next[fam].tokens, at = -1;
      list.forEach(function (t, i) { if (at < 0 && t && String(t.name || "").replace(/^(--|\.)/, "") === name) at = i; });
      if (!tok) {
        if (!NAME.test(name)) { err.textContent = T.badName; return; }
        var all = S.m.colors.map(function (c) { return c.name; });
        S.m.families.forEach(function (f) { f.tokens.forEach(function (t) { all.push(t.name); }); });
        if (all.indexOf(name) >= 0 || at >= 0) { err.textContent = T.taken; return; }
      }
      if (remove) { if (at >= 0) list.splice(at, 1); }
      else {
        var entry = at >= 0 ? list[at] : { name: name }, value;
        if (perTheme) {
          value = {};
          S.m.themes.forEach(function (t) { var s = inputs[t.id].value.trim(); if (s) value[t.id] = s; });
          var ks = Object.keys(value);
          if (!ks.length) { err.textContent = T.wouldDrop + "—"; return; }
        } else {
          value = inputs._.value.trim();
          if (fam !== "color" && fam !== "shadow" && /^-?\d+(\.\d+)?$/.test(value) && (fam === "spacing" || fam === "radius")) value = value + "px";
        }
        entry.value = value;
        var u = usage.value.trim();
        if (u) entry.usage = u; else delete entry.usage;
        if (at < 0) list.push(entry);
        // Refuse a value the page would drop.
        var before = {};
        S.compiled.problems.forEach(function (p) { before[p.family + "\n" + p.name + "\n" + p.reason] = 1; });
        var fresh = dsKit.compile(next, { fonts: false }).problems.filter(function (p) {
          return p.name === name && !before[p.family + "\n" + p.name + "\n" + p.reason];
        });
        if (fresh.length) { err.textContent = T.wouldDrop + fresh.map(function (p) { return p.reason; }).join("; "); return; }
      }
      saveFiles({ "tokens.json": tokensText(next) }, (remove ? "removed " : tok ? "edited " : "added ") + fam + " token " + name).then(function (ok) {
        if (!ok) return;
        state.editing = null;
        state.sel = remove ? null : { kind: "token", family: fam, name: name };
        render();
      });
    }
    return box;
  }

  function typeView() {
    var kids = [heading(T.type)], ty = S.m.type;
    var pn = problemsNote(familyProblems("type")); if (pn) kids.push(pn);
    ty.groups.forEach(function (g) {
      kids.push(h("h2", { "class": "ds-h2", text: g.name }));
      g.styles.forEach(function (s) {
        var fam = s.family ? ty.families[s.family] : "inherit";
        var style = "font-family:" + fam + ";font-size:" + s.fontSize + ";" + (s.lineHeight ? "line-height:" + s.lineHeight + ";" : "") +
          (s.fontWeight ? "font-weight:" + s.fontWeight + ";" : "") + (s.letterSpacing ? "letter-spacing:" + s.letterSpacing + ";" : "") +
          (s.fontStyle ? "font-style:" + s.fontStyle + ";" : "") + (s.opticalSize != null ? "font-variation-settings:'opsz' " + s.opticalSize + ";" : "");
        var meta = [s.fontSize + (s.lineHeight ? " / " + s.lineHeight : ""), s.fontWeight, s.letterSpacing, s.family].filter(Boolean).join(" · ");
        kids.push(h("div", { "class": "ds-type-row" + (isSel("type", s.name) ? " on" : ""), "data-token": s.name,
          onclick: function () { state.sel = { kind: "token", family: "type", name: s.name }; render(); } }, [
          h("div", { "class": "ds-type-meta" }, [h("code", { text: s.name }), h("span", { text: meta }), s.usage ? h("span", { "class": "ds-muted", text: s.usage }) : null]),
          h("div", { "class": "ds-type-sample", style: style, text: s.sample || T.sample })
        ]));
      });
    });
    if (ty.familyKeys.length) {
      kids.push(h("h2", { "class": "ds-h2", text: T.families }));
      kids.push(h("div", { "class": "ds-tokens" }, ty.familyKeys.map(function (k) {
        return h("div", { "class": "ds-token ds-static" }, [h("span", { "class": "ds-vis ds-aa", style: "font-family:" + ty.families[k], text: "Aa" }),
          h("span", { "class": "ds-token-main" }, [h("code", { "class": "ds-token-name", text: "--font-" + k }), h("span", { "class": "ds-token-val", text: ty.families[k] })])]);
      })));
    }
    var fontFiles = Object.keys(S.fontUrls).sort(), listed = {};
    if (ty.fonts.length || fontFiles.length) {
      kids.push(h("h2", { "class": "ds-h2", text: T.fonts }));
      ty.fonts.forEach(function (f) {
        listed[f.file] = 1;
        kids.push(h("div", { "class": "ds-specimen" }, [
          h("div", { "class": "ds-spec-meta" }, [h("strong", { text: f.family }), h("span", { text: f.weight + " · " + f.style }), h("code", { text: f.file }),
            S.fontUrls[f.file] ? null : h("span", { "class": "ds-warn", text: T.missingFont })]),
          h("div", { "class": "ds-spec-glyphs", style: "font-family:\"" + f.family + "\";font-weight:" + f.weight.split(" ")[0] + ";font-style:" + f.style,
            text: "Aa Bb Cc Dd Ee Ff Gg 0123456789 & ?!" })
        ]));
      });
      fontFiles.filter(function (p) { return !listed[p]; }).forEach(function (p) {
        kids.push(h("div", { "class": "ds-specimen" }, [h("div", { "class": "ds-spec-meta" }, [h("code", { text: p }), h("span", { "class": "ds-warn", text: T.notListed })])]));
      });
    }
    return kids;
  }

  function componentView() {
    var kids = [heading(T.components)];
    if (reactMissing()) kids.push(h("div", { "class": "ds-banner", text: T.reactMissing }));
    var groups = [], by = {};
    S.components.forEach(function (c) {
      var g = c.group || "";
      if (!by[g]) { by[g] = []; groups.push(g); }
      by[g].push(c);
    });
    groups.forEach(function (g) {
      if (g) kids.push(h("h2", { "class": "ds-h2", text: g }));
      by[g].forEach(function (c) { kids.push(componentCard(c)); });
    });
    if (!S.components.length) kids.push(h("p", { "class": "ds-muted", text: T.empty }));
    return kids;
  }
  function componentCard(c) {
    var path = "components/" + c.name + "/README.md", editing = state.editing === path;
    var errEl = h("div", { "class": "ds-err" });
    var body = c.preview && !c.marker.floor ? frame(c.preview, { marker: c.marker, title: c.name, lazy: true, onError: function (m) { errEl.textContent = T.previewFailed + m; } })
      : h("div", { "class": "ds-noprev", text: c.preview ? (c.marker.subtitle || c.name) : T.noPreview });
    var tools = S.editable && !editing ? btn(T.edit, "", function (e) { e.stopPropagation(); state.editing = path; state.sel = { kind: "component", name: c.name }; render(); }) : null;
    var card = h("section", { "class": "ds-card" + (state.sel && state.sel.kind === "component" && state.sel.name === c.name ? " on" : ""), "data-component": c.name,
      onclick: function (e) {
        if (e.target.closest("textarea,button,a")) return;
        state.sel = { kind: "component", name: c.name };
        main.querySelectorAll(".ds-card.on").forEach(function (n) { n.classList.remove("on"); });
        card.classList.add("on"); sendView();
      } }, [
      h("header", { "class": "ds-card-h" }, [h("h3", { text: c.name }), c.marker.subtitle ? h("span", { "class": "ds-muted", text: c.marker.subtitle }) : null,
        c.marker.page ? h("span", { "class": "ds-tag", text: "page" }) : null, h("span", { style: "flex:1" }), tools]),
      h("div", { "class": "ds-card-prev" }, [body]), errEl,
      editing ? mdEditor(path, c.readme == null ? "# " + c.name + "\n\n" : c.readme) :
        c.readme ? h("div", { "class": "ds-card-doc" }, [h("div", { "class": "ds-label", text: T.guidelines }), markdown(c.readme, path, true)]) : null
    ]);
    return card;
  }

  function assetPaths() { return Object.keys(C.files).filter(function (p) { return /^assets\/./.test(p); }); }
  function assetGroups() {
    var ix = S.index, ag = ix.assetGroups && typeof ix.assetGroups === "object" ? ix.assetGroups : {}, order = [], files = {};
    assetPaths().forEach(function (p) {
      var rest = p.slice(7), i = rest.indexOf("/"), g = i < 0 ? T.other : rest.slice(0, i), name = i < 0 ? rest : rest.slice(i + 1);
      (files[g] = files[g] || []).push({ path: p, name: name });
    });
    (Array.isArray(ix.groups) ? ix.groups : []).forEach(function (g) { if (order.indexOf(g) < 0 && (files[g] || ag[g])) order.push(g); });
    Object.keys(ag).forEach(function (g) { if (order.indexOf(g) < 0) order.push(g); });
    Object.keys(files).sort().forEach(function (g) { if (order.indexOf(g) < 0) order.push(g); });
    return order.map(function (g) {
      var meta = ag[g] || {}, list = (files[g] || []).filter(function (f) { return !/(^|\/)README\.md$/i.test(f.name); });
      var ord = Array.isArray(meta.order) ? meta.order : [];
      list.sort(function (a, b) {
        var ia = ord.indexOf(a.name), ib = ord.indexOf(b.name);
        return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || (a.name < b.name ? -1 : 1);
      });
      return { name: g, tile: /^(l|m|s|xs)$/.test(meta.tile) ? meta.tile : "m", files: list,
        readme: g === T.other ? null : kit.fileText("assets/" + g + "/README.md") };
    });
  }
  var GROUP = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/; // stored paths have no spaces
  function assetView() {
    var kids = [heading(T.assets, S.editable ? [btn("+ " + T.newGroup, "", function () { state.editing = "new-group"; render(); })] : [])];
    if (state.editing === "new-group") {
      var gin = h("input", { type: "text", "class": "ds-in", placeholder: T.groupName, "aria-label": T.groupName });
      var gerr = h("div", { "class": "ds-err" });
      kids.push(h("div", { "class": "ds-editor" }, [h("label", { "class": "ds-field" }, [h("span", { text: T.groupName }), gin]), gerr,
        h("div", { "class": "ds-row-btns" }, [btn(T.upload, "primary", function () {
          var g = gin.value.trim();
          if (!GROUP.test(g)) { gerr.textContent = T.badName; return; }
          pickUpload(g);
        }), btn(T.cancel, "", function () { state.editing = null; render(); })])]));
      setTimeout(function () { gin.focus(); }, 0);
    }
    var groups = assetGroups();
    groups.forEach(function (g) {
      var tools = S.editable && g.name !== T.other && GROUP.test(g.name) ? [btn(T.upload, "", function () { pickUpload(g.name); })] : [];
      kids.push(h("div", { "class": "ds-head ds-h2row" }, [h("h2", { "class": "ds-h2", text: g.name })].concat(tools)));
      if (g.readme) kids.push(markdown(g.readme, "assets/" + g.name + "/README.md", true));
      kids.push(h("div", { "class": "ds-tiles ds-tile-" + g.tile }, g.files.map(function (f) {
        var vis;
        if (IMG.test(f.name)) vis = h("img", { src: kit.fileUrl(f.path), alt: f.name, loading: "lazy" });
        else if (VIDEO.test(f.name)) vis = h("video", { src: kit.fileUrl(f.path), muted: true, controls: true, preload: "metadata" });
        else if (FONT.test(f.name)) vis = h("span", { "class": "ds-aa", text: "Aa" });
        else vis = h("span", { "class": "ds-ext", text: (f.name.split(".").pop() || "").toUpperCase() });
        return h("figure", { "class": "ds-tile", title: f.path }, [h("div", { "class": "ds-tile-vis" }, [vis]),
          h("figcaption", {}, [h("span", { text: f.name }), h("button", { type: "button", "class": "ds-link", text: T.download, onclick: function () { downloadFile(f.path); } })])]);
      })));
    });
    if (!groups.length) kids.push(h("p", { "class": "ds-muted", text: T.empty }));
    return kids;
  }
  var filePick = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true });
  document.body.appendChild(filePick);
  var uploadGroup = null;
  function pickUpload(g) { uploadGroup = g; filePick.value = ""; filePick.click(); }
  filePick.addEventListener("change", function () {
    var file = filePick.files && filePick.files[0], g = uploadGroup;
    if (!file || !g) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) { kit.toast(T.tooBig); return; }
    var ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[file.type];
    var base = file.name.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 80) || "image";
    var name = base + "." + ext, n = 2;
    while (C.files["assets/" + g + "/" + name] != null) name = base + "-" + (n++) + "." + ext;
    var rd = new FileReader();
    rd.onload = function () {
      var files = {}, path = "assets/" + g + "/" + name;
      files[path] = String(rd.result).replace(/^data:image\/jpg;/, "data:image/jpeg;");
      var ix = S.index;
      ix.groups = Array.isArray(ix.groups) ? ix.groups : [];
      if (ix.groups.indexOf(g) < 0) ix.groups.push(g);
      ix.assetGroups = ix.assetGroups && typeof ix.assetGroups === "object" ? ix.assetGroups : {};
      var rec = ix.assetGroups[g] = ix.assetGroups[g] || { name: g, tile: "m", order: [], files: {} };
      rec.order = Array.isArray(rec.order) ? rec.order : []; rec.files = rec.files && typeof rec.files === "object" ? rec.files : {};
      if (rec.order.indexOf(name) < 0) rec.order.push(name);
      rec.files[name] = { name: name, size: file.size, type: file.type };
      saveFiles(files, "uploaded " + path).then(function (ok) {
        if (!ok) { load(); return; }
        kit.toast(T.uploaded + ": " + name);
        state.section = "assets"; state.editing = null; render();
      });
    };
    rd.readAsDataURL(file);
  });

  function downloadFile(p) { kit.download(p.replace(/^.*\//, ""), new Blob([bytesOf(p)], { type: mimeOf(p) }), mimeOf(p)); }
  function sizeOf(p) {
    var v = C.files[p];
    if (typeof v === "string" && v.slice(0, 5) === "data:") return Math.floor((v.length - v.indexOf(",") - 1) * 3 / 4);
    return new Blob([String(v)]).size;
  }
  function fmtSize(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function filesView() {
    var paths = Object.keys(C.files).sort();
    return [heading(T.files, [h("span", { "class": "ds-muted", text: paths.length + "" })]), h("div", { "class": "ds-files" }, paths.map(function (p) {
      return h("div", { "class": "ds-file" }, [kit.icon ? h("span", { "class": "ds-file-ic", html: kit.icon("file") }) : null,
        h("code", { text: p }), h("span", { "class": "ds-muted", text: fmtSize(sizeOf(p)) }),
        h("button", { type: "button", "class": "kit-btn", title: T.download, "aria-label": T.download + " " + p, html: kit.icon("download"), onclick: function () { downloadFile(p); } })]);
    }))];
  }

  // ------------------------------------------------------------------ render
  function render() {
    frames = {};
    drawNav(); drawThemes();
    var s = state.section, kids;
    if (s === "overview") kids = overview();
    else if (s.slice(0, 3) === "md:") { var sec = S.sections.filter(function (x) { return x.id === s; })[0]; kids = sec ? mdSection(sec.path, sec.title) : overview(); }
    else if (s === "colors") kids = colorView();
    else if (s === "type") kids = typeView();
    else if (s.slice(0, 4) === "fam:") kids = famView(s.slice(4));
    else if (s === "components") kids = componentView();
    else if (s === "assets") kids = assetView();
    else kids = filesView();
    main.replaceChildren(h("div", { "class": "ds-page" }, kids.filter(Boolean)));
    Object.keys(frames).forEach(function (k) { layoutFrame(frames[k]); });
    sendView();
  }

  // ------------------------------------------------------------------ thumbnail: the cover
  if (C.thumb) {
    document.documentElement.setAttribute("data-ds-thumb", "");
    var done = false, finish = function () { if (!done) { done = true; kit.ready(); } };
    var cv = cover({ onLoad: function () { setTimeout(finish, 150); } });
    if (cv) { main.appendChild(cv); Object.keys(frames).forEach(function (k) { layoutFrame(frames[k]); }); setTimeout(finish, 2500); }
    else {
      var blocks = S.m.colors.slice(0, 5).map(function (c) { return h("span", { style: "background:" + (S.m.resolve(c.name, S.m.first) || "transparent") }); });
      main.appendChild(h("div", { "class": "ds-thumb-fallback" }, [h("div", { "class": "ds-thumb-blocks" }, blocks), h("div", { "class": "ds-thumb-name", text: S.title })]));
      finish();
    }
    return;
  }

  render();
})();
