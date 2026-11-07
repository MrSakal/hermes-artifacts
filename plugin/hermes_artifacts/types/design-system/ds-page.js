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
  // The UI's words in the app's language (hu over en, key by key); messages to Hermes are always English.
  function pickLang(t, l) { var o = {}, k; for (k in t.en) o[k] = t.en[k]; for (k in t[l] || {}) o[k] = t[l][k]; return o; }
  var kit = window.kit, h = kit.h, C = kit.content, dsKit = window.dsKit, md = window.md;
  var L = /^hu\b/i.test(kit.content.lang || navigator.language || "") ? "hu" : "en";
  var T = pickLang({
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
      search: "Search", noMatch: "Nothing matches.", wouldDrop: "That value would drop: ", download: "Download", empty: "Nothing here yet.", other: "Other",
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
      search: "Keresés", noMatch: "Nincs találat.", wouldDrop: "Ez az érték kimaradna: ", download: "Letöltés", empty: "Itt még nincs semmi.", other: "Egyéb",
      ci: "Egy pipeline újraközli ezt a rendszert: az itteni szerkesztések felülíródhatnak.", readOnly: "Ennél a rendszernél a szerkesztés ki van kapcsolva.",
      updated: function (by, at) { return "Frissítve" + (by ? " · " + by : "") + (at ? " · " + at : ""); },
      noTokens: "A tokens.json hiányzik, vagy nem érvényes JSON.", addColor: "Új szín", tokens: "token", delSure: "Törlöd ezt a tokent?",
      uploaded: "Feltöltve", fam: { spacing: "Térközök", radius: "Lekerekítés", shadow: "Árnyékok" } }
  }, L);

  var bar = document.getElementById("ds-bar"), nav = document.getElementById("ds-nav"), main = document.getElementById("ds-main");
  bar.hidden = true; // no bar of its own: the artifact header carries the title, Export and Make default
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
      return /\.mdx?$/i.test(p) && p !== "README.md" && !/^(components|archived|assets|api)\//.test(p);
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
  var state = { section: "overview", theme: null, sel: null, editing: null, chosenTheme: false, renaming: null, file: null, q: "" };
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
    main.querySelectorAll(".ds-theme-sel").forEach(function (s) { s.value = id; });
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

  // The theme the page previews in, picked where themes show (Colors, Shadows, Components).
  function themeSelect() {
    if (!multiTheme()) return null;
    var sel = h("select", { "class": "ds-in ds-theme-sel", "aria-label": T.theme, title: T.theme },
      S.m.themes.map(function (t) { return h("option", { value: t.id, text: t.name }); }));
    sel.value = state.theme;
    sel.addEventListener("change", function () { state.chosenTheme = true; setTheme(sel.value); });
    return sel;
  }

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
  var NAV_ICON = {
    overview: "M4 11l8-7 8 7v9h-5v-6H9v6H4z", md: "M7 3h7l5 5v12H7zM14 3v5h5M9 13h6M9 17h6",
    colors: "M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1-.9-1.4-.9-2.3 0-.9.8-1.6 1.7-1.6h1.9a4.2 4.2 0 0 0 4.2-4.2C20.5 6.7 16.7 3 12 3zM7.5 12h.01M9.5 7.8h.01M14.5 7.8h.01",
    type: "M4 19l5-14 5 14M6 14h6M15 19v-6.5a2.5 2.5 0 0 1 5 0V19M15 15.5h5",
    spacing: "M4 4v16M20 4v16M8 12h8M8 12l2-2M8 12l2 2M16 12l-2-2M16 12l-2 2",
    radius: "M4 20v-8a8 8 0 0 1 8-8h8", shadow: "M4 4h12v12H4zM8 20h12V8",
    family: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6",
    components: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7",
    assets: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01", files: "M3 6h6l2 2h10v11H3z",
    search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4"
  };
  function navIcon(id) {
    var k = id.slice(0, 3) === "md:" ? "md" : id.slice(0, 4) === "fam:" ? (NAV_ICON[id.slice(4)] ? id.slice(4) : "family") : id;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (NAV_ICON[k] || NAV_ICON.family) + '"/></svg>';
  }
  // Search: tokens, type styles, components, sections and files, by name.
  function searchHits(q) {
    q = q.toLowerCase();
    var out = [], hit = function (s) { return String(s || "").toLowerCase().indexOf(q) >= 0; };
    S.sections.forEach(function (s) { if (hit(s.title)) out.push({ label: s.title, sub: T.sections, icon: s.id, run: function () { go(s.id); } }); });
    S.m.colors.forEach(function (c) { if (hit(c.name) || hit(c.usage)) out.push({ label: c.name, sub: T.colors, icon: "colors", run: function () { goToken(c.name); } }); });
    S.m.type.groups.forEach(function (g) { g.styles.forEach(function (st) { if (hit(st.name)) out.push({ label: st.name, sub: T.type, icon: "type", run: function () {
      go("type"); var row = main.querySelector('[data-token="' + st.name + '"]'); if (row) row.scrollIntoView({ block: "center" }); } }); }); });
    S.m.families.forEach(function (f) { f.tokens.forEach(function (t) { if (hit(t.name) || hit(t.usage)) out.push({ label: t.name, sub: T.fam[f.key] || f.title, icon: "fam:" + f.key, run: function () { goToken(t.name); } }); }); });
    S.components.forEach(function (c) { if (hit(c.name)) out.push({ label: c.name, sub: T.components, icon: "components", run: function () {
      state.section = "components"; state.sel = { kind: "component", name: c.name }; render(); } }); });
    Object.keys(C.files).forEach(function (p) { if (hit(p)) out.push({ label: p, sub: T.files, icon: "files", run: function () { state.file = p; go("files"); } }); });
    return out.slice(0, 40);
  }
  var searchIn = h("input", { type: "search", "class": "ds-nav-search", placeholder: T.search, "aria-label": T.search, spellcheck: "false" });
  searchIn.addEventListener("input", function () { state.q = searchIn.value; drawNav(); });
  searchIn.addEventListener("keydown", function (e) { if (e.key === "Escape") { searchIn.value = ""; state.q = ""; drawNav(); } });
  function navBtn(id, title, on, run, extra) {
    return h("button", { type: "button", "class": "ds-nav-i" + (on ? " on" : ""), "aria-current": on ? "page" : null, onclick: run },
      [h("span", { "class": "ds-nav-ic", html: navIcon(id) }), h("span", { "class": "ds-nav-t", text: title }), extra ? h("span", { "class": "ds-nav-n", text: extra }) : null]);
  }
  function drawNav() {
    var items = navItems(), kids = [h("div", { "class": "ds-nav-s" }, [h("span", { "class": "ds-nav-ic", html: navIcon("search") }), searchIn])];
    if (!items.some(function (x) { return x.id === state.section; })) state.section = "overview";
    var q = String(state.q || "").trim();
    if (q) {
      var hits = searchHits(q);
      hits.forEach(function (r) { kids.push(navBtn(r.icon, r.label, false, function () { r.run(); }, r.sub)); });
      if (!hits.length) kids.push(h("p", { "class": "ds-nav-none", text: T.noMatch }));
    } else items.forEach(function (it) {
      if (it.id === "files") return;
      kids.push(navBtn(it.id, it.title, it.id === state.section, function () { go(it.id); }));
    });
    var foot = [navBtn("files", T.files, state.section === "files", function () { go("files"); }, String(Object.keys(C.files).length))];
    var lc = S.index.lastChange;
    foot.push(h("div", { "class": "ds-nav-meta" }, [statusEl, lc && (lc.by || lc.at) ? h("span", { text: T.updated(lc.by, String(lc.at || "").slice(0, 10)) }) : null]));
    kids.push(h("div", { "class": "ds-nav-foot" }, foot));
    nav.replaceChildren.apply(nav, kids);
  }
  function go(id) {
    state.section = id; state.sel = null; state.editing = null; state.renaming = null;
    render();
    main.scrollTop = 0; window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ shared bits
  function heading(text, extra) { return h("div", { "class": "ds-head" }, [h("h1", { text: text })].concat((extra || []).filter(Boolean))); }
  function problemsNote(list) {
    if (!list.length) return null;
    return h("details", { "class": "ds-problems" }, [
      h("summary", { text: T.problems(list.length) + " · " + T.problemsWhy }),
      h("ul", {}, list.map(function (p) {
        return h("li", {}, [h("code", { text: (p.family ? p.family + (p.name ? "." : "") : "") + (p.name || "") }), " " + p.reason]);
      })),
      !C.thumb && window.hermes && window.hermes.send ? btn(X.fixHermes, "", function () {
        askHermes(X.ask.fix + "\n" + list.map(function (p) { return "- " + (p.family || "") + (p.name ? "." + p.name : "") + ": " + p.reason; }).join("\n"),
          { section: state.section, problems: list });
      }) : null
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
  function mdEditor(path, text, onDone, toFile) {
    var ta = h("textarea", { "class": "ds-md-edit", spellcheck: "true" });
    ta.value = text || "";
    var wrap = h("div", { "class": "ds-editor" }, [ta, h("div", { "class": "ds-row-btns" }, [
      btn(T.save, "primary", function () {
        var v = ta.value.replace(/\r\n?/g, "\n"), files = {}; files[path] = toFile ? toFile(v) : v;
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
  // Claude's Design System page: each foundation a table (Name | a column per theme), values edited in place,
  // usage notes and a row menu on every token, contrast on what is read, empty states that ask Hermes.
  var README_MARK = "<!-- @generated below by the Design System type: Consuming this system, Index -->";
  var X = pickLang({
    en: { generated: "Generated by this page on every save", genReadme: "Consuming this system · Index — generated on every save",
      inherits: function (n) { return "Inherits " + n; }, inherit: function (n, t) { return "Inherit " + n + " (" + t + ")"; },
      readable: "Use a readable shade", against: function (g, k) { return "Measured against " + g + " · needs " + k + ":1"; },
      rename: "Rename", copyName: "Copy name", copied: "Copied", goAlias: function (a) { return "Go to " + a; }, more: "More",
      addHere: "Add", delGroup: "Delete group", delGroupSure: function (n) { return "Delete these " + n + " tokens?"; },
      addUsage: "Add a usage note", noUsage: "No usage note yet.", needValue: "The first theme needs a value",
      roles: { surfaces: "Surfaces", text: "Text", fills: "Fills and status backgrounds", borders: "Borders and rings", charts: "Charts", palette: "Palette" },
      preview: "Preview", props: "Props", noProps: "This component declares no props.", propType: "Type", note: "Note", required: "required",
      sizeCol: "Type · size", storage: function (n, s) { return n + (n === 1 ? " file · " : " files · ") + s; }, newSet: "New set",
      uploadFont: "Upload font", addStyle: "Add style", group: "Group", family: "Family", size: "Size", weight: "Weight",
      lineHeight: "Line height", layers: "Layers", addLayer: "Add layer", inset: "inset", color: "Color", blur: "Blur", spread: "Spread",
      cats: { docs: "Documents", css: "Stylesheets", js: "Scripts", data: "Data", fonts: "Fonts", images: "Images", other: "Other" },
      noFilePreview: "No preview for this file.", delFile: "Delete this file?", fontTooBig: "Fonts up to 8 MB (woff2, woff, ttf, otf)",
      askHermes: "Ask Hermes", fixHermes: "Fix with Hermes", guideline: "Guidelines", noGuide: "No guidelines yet.",
      desc: { "design-system.json": "The index: title, namespace, libraries, asset groups", "tokens.json": "The tokens every stylesheet is compiled from",
        "README.md": "The brand book: every reader starts here", "components/bundle.js": "The components, compiled for the global scope",
        "components/bundle.css": "The components' styles", "components/index.d.ts": "The components' props" },
      empty: { colors: "No colors yet.", type: "No type styles yet.", components: "No components yet.", assets: "No assets yet.", readme: "No README.md yet: every reader starts there." },
      ask: { colors: "Add this design system's colors to tokens.json: surfaces, text, fills and status backgrounds, borders and rings, charts — a usage note on each, a value for every theme, text that reads at 4.5:1 on its surfaces.",
        type: "Add this design system's type to tokens.json: the families, the font files and the styles (display, headings, body, captions, code) with size, line height and weight.",
        components: "Build this design system's components: each under components/<Name>/ with a README (guidelines), a preview.html, its props in components/index.d.ts, compiled into components/bundle.js.",
        assets: "Add this design system's assets (logos, marks, icons, imagery) under assets/<Group>/, each group with a README on when to use them.",
        readme: "Write this design system's README.md: what the brand is, its voice, when to use what, and how to build with it.",
        fix: "These tokens.json values dropped when the page compiled them. Fix each so it compiles, keeping what it meant:" } },
    hu: { generated: "Ezt az oldal generálja minden mentéskor", genReadme: "A rendszer használata · Index — minden mentéskor generálva",
      inherits: function (n) { return n + " értékét örökli"; }, inherit: function (n, t) { return n + " értékét örökölje (" + t + ")"; },
      readable: "Olvasható árnyalat", against: function (g, k) { return "Ehhez mérve: " + g + " · kell " + k + ":1"; },
      rename: "Átnevezés", copyName: "Név másolása", copied: "Kimásolva", goAlias: function (a) { return "Ugrás ide: " + a; }, more: "Továbbiak",
      addHere: "Hozzáadás", delGroup: "Csoport törlése", delGroupSure: function (n) { return "Törlöd ezt a(z) " + n + " tokent?"; },
      addUsage: "Használati megjegyzés", noUsage: "Még nincs használati megjegyzés.", needValue: "Az első témának kell érték",
      roles: { surfaces: "Felületek", text: "Szöveg", fills: "Kitöltések és státuszhátterek", borders: "Keretek és gyűrűk", charts: "Diagramok", palette: "Paletta" },
      preview: "Előnézet", props: "Propok", noProps: "Ez a komponens nem deklarál propokat.", propType: "Típus", note: "Megjegyzés", required: "kötelező",
      sizeCol: "Típus · méret", storage: function (n, s) { return n + " fájl · " + s; }, newSet: "Új készlet",
      uploadFont: "Betű feltöltése", addStyle: "Új stílus", group: "Csoport", family: "Család", size: "Méret", weight: "Vastagság",
      lineHeight: "Sormagasság", layers: "Rétegek", addLayer: "Új réteg", inset: "belső", color: "Szín", blur: "Elmosás", spread: "Terítés",
      cats: { docs: "Dokumentumok", css: "Stíluslapok", js: "Szkriptek", data: "Adat", fonts: "Betűk", images: "Képek", other: "Egyéb" },
      noFilePreview: "Ehhez a fájlhoz nincs előnézet.", delFile: "Törlöd ezt a fájlt?", fontTooBig: "Legfeljebb 8 MB-os betűfájl (woff2, woff, ttf, otf)",
      askHermes: "Kérdezd Hermest", fixHermes: "Javítsa Hermes", guideline: "Irányelvek", noGuide: "Még nincsenek irányelvek.",
      desc: { "design-system.json": "Az index: cím, névtér, könyvtárak, eszközcsoportok", "tokens.json": "A tokenek: minden stíluslap ebből készül",
        "README.md": "A brand book: minden olvasó itt kezdi", "components/bundle.js": "A komponensek, a globális scope-ba fordítva",
        "components/bundle.css": "A komponensek stílusai", "components/index.d.ts": "A komponensek propjai" },
      empty: { colors: "Még nincsenek színek.", type: "Még nincsenek betűstílusok.", components: "Még nincsenek komponensek.", assets: "Még nincsenek eszközök.", readme: "Még nincs README.md: minden olvasó ott kezdi." },}
  }, L);

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
    if (isSel(fam, name) && state.editing === "token:" + fam + ":" + name) { state.sel = null; state.editing = null; }
    else { state.sel = { kind: "token", family: fam, name: name }; state.editing = S.editable ? "token:" + fam + ":" + name : null; }
    render();
  }

  // ---- asking Hermes (staged in the artifact's chat, the user sends it)
  function askHermes(text, data) {
    if (!window.hermes || !window.hermes.send) return;
    window.hermes.send(text, data || { section: state.section }).then(null, function (e) { kit.toast(String(e && e.message || e)); });
  }
  function askBox(what) {
    var can = !C.thumb && window.hermes && window.hermes.send;
    return h("div", { "class": "ds-empty" }, [h("p", { text: X.empty[what] }),
      can ? btn(X.askHermes, "", function () { askHermes(X.ask[what], { section: state.section }); }) : null]);
  }

  // ---- small shared controls
  function iconBtn(name, label, fn, extra) {
    return h("button", { type: "button", "class": "ds-ib" + (extra ? " " + extra : ""), title: label, "aria-label": label, html: kit.icon(name), onclick: fn });
  }
  function confirmMenu(anchor, q, fn) { kit.menu(anchor, [{ hint: q }, { label: T.del, onClick: fn }]); }
  function copyText(s) {
    var done = function () { kit.toast(X.copied + ": " + s); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s).then(done, fallback); } catch (e) {}
    fallback();
    function fallback() {
      var ta = h("textarea", { style: "position:fixed;left:-9999px" }); ta.value = s; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) {} ta.remove();
    }
  }
  var pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener("mousedown", popOut, true); } }
  function popOut(e) { if (pop && !pop.contains(e.target)) closePop(); }
  function popover(anchor, kids, wide) {
    closePop();
    pop = h("div", { "class": "ds-pop" + (wide ? " ds-pop-wide" : ""), role: "dialog" }, kids);
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8)) + "px";
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + "px";
    setTimeout(function () { document.addEventListener("mousedown", popOut, true); }, 0);
    pop.addEventListener("keydown", function (e) { if (e.key === "Escape") closePop(); });
    return pop;
  }
  function enterBlurs(inp, reset) {
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && inp.tagName === "INPUT") inp.blur();
      if (e.key === "Escape") { inp.value = reset; inp.blur(); }
    });
  }
  function themeName(id) { var t = S.m.themes.filter(function (x) { return x.id === id; })[0]; return t ? t.name : id; }
  function multiTheme() { return S.m.themes.length > 1 && !S.m.themes[0].implicit; }
  function ownValue(raw, tid) {
    var v = raw ? raw.value : null;
    if (v && typeof v === "object") {
      for (var k in v) if (k.toLowerCase() === tid && v[k] != null) return String(v[k]);
      return "";
    }
    return tid === S.m.first ? (v == null ? "" : String(v)) : "";
  }

  // ---- token edits (each a save of tokens.json; refused when the page would drop a value)
  function cleanKey(n) { return String(n || "").replace(/^(--|\.)/, ""); }
  function saveTokens(next, note) {
    var before = {};
    S.compiled.problems.forEach(function (p) { before[p.family + "\n" + p.name + "\n" + p.reason] = 1; });
    var fresh = dsKit.compile(next, { fonts: false }).problems.filter(function (p) { return !before[p.family + "\n" + p.name + "\n" + p.reason]; });
    if (fresh.length) { kit.toast(T.wouldDrop + fresh.map(function (p) { return (p.name ? p.name + ": " : "") + p.reason; }).join("; ")); render(); return Promise.resolve(false); }
    return saveFiles({ "tokens.json": tokensText(next) }, note).then(function (ok) { render(); return ok; });
  }
  function editToken(fam, name, fn, note) {
    var next = JSON.parse(JSON.stringify(S.tokens || {}));
    var list = next[fam] && Array.isArray(next[fam].tokens) ? next[fam].tokens : [];
    var entry = list.filter(function (t) { return t && cleanKey(t.name) === name; })[0];
    if (!entry) { kit.toast(T.notSaved); return Promise.resolve(false); }
    var err = fn(entry, next);
    if (err) { kit.toast(err); render(); return Promise.resolve(false); }
    return saveTokens(next, note);
  }
  function setThemed(fam, t, tid, v) {
    return editToken(fam, t.name, function (e) {
      if (!multiTheme()) { if (!v) return X.needValue; e.value = v; return; }
      var val = {};
      if (e.value && typeof e.value === "object") Object.keys(e.value).forEach(function (k) { val[k.toLowerCase() === tid ? tid : k] = e.value[k]; });
      else if (e.value != null && e.value !== "") val[S.m.first] = e.value;
      if (v) val[tid] = v;
      else { if (tid === S.m.first) return X.needValue; delete val[tid]; }
      e.value = val;
    }, "edited " + fam + " token " + t.name + (multiTheme() ? " (" + tid + ")" : ""));
  }
  function setUsage(fam, t, v) {
    if (fam === "type") return editStyle(t.name, function (s) { if (v) s.usage = v; else delete s.usage; }, "edited usage of " + t.name);
    return editToken(fam, t.name, function (e) { if (v) e.usage = v; else delete e.usage; }, "edited usage of " + t.name);
  }
  function allNames() {
    var all = S.m.colors.map(function (c) { return c.name; });
    S.m.families.forEach(function (f) { f.tokens.forEach(function (t) { all.push(t.name); }); });
    S.m.type.groups.forEach(function (g) { g.styles.forEach(function (s) { all.push(s.name); }); });
    return all;
  }
  function swapAlias(v, from, to) {
    if (typeof v === "string") return v.split("{" + from + "}").join("{" + to + "}");
    if (Array.isArray(v)) return v.map(function (x) { return swapAlias(x, from, to); });
    if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { o[k] = swapAlias(v[k], from, to); }); return o; }
    return v;
  }
  function renameToken(fam, from, to) {
    if (!NAME.test(to)) { kit.toast(T.badName); return render(); }
    if (allNames().indexOf(to) >= 0) { kit.toast(T.taken); return render(); }
    var next = JSON.parse(JSON.stringify(S.tokens || {})), hit = false;
    function ren(t) { if (t && cleanKey(t.name) === from && !hit) { hit = true; t.name = String(t.name).replace(from, to); } }
    if (fam === "type") ((next.type && next.type.groups) || []).forEach(function (g) { (g.styles || []).forEach(ren); });
    else ((next[fam] && next[fam].tokens) || []).forEach(ren);
    if (!hit) return render();
    next = swapAlias(next, from, to);
    saveTokens(next, "renamed " + fam + " token " + from + " to " + to).then(function (ok) {
      if (ok) { state.sel = { kind: "token", family: fam, name: to }; render(); }
    });
  }
  function removeTokens(fam, names, note) {
    var next = JSON.parse(JSON.stringify(S.tokens || {}));
    if (fam === "type") ((next.type && next.type.groups) || []).forEach(function (g) {
      g.styles = (g.styles || []).filter(function (s) { return names.indexOf(cleanKey(s && s.name)) < 0; });
    });
    else if (next[fam] && Array.isArray(next[fam].tokens)) next[fam].tokens = next[fam].tokens.filter(function (t) { return names.indexOf(cleanKey(t && t.name)) < 0; });
    state.sel = null; state.editing = null;
    return saveTokens(next, note);
  }
  function aliasOf(fam, t) {
    var v = t.raw && t.raw.value, out = null;
    (v && typeof v === "object" ? Object.keys(v).map(function (k) { return v[k]; }) : [v]).forEach(function (x) {
      var m = /^\{([^}]+)\}$/.exec(String(x == null ? "" : x).trim()); if (m && !out) out = m[1];
    });
    return out;
  }
  function goToken(name) {
    var sec = null, fam = null;
    if (S.m.colors.some(function (c) { return c.name === name; })) { sec = "colors"; fam = "color"; }
    S.m.families.forEach(function (f) { if (!sec && f.tokens.some(function (t) { return t.name === name; })) { sec = "fam:" + f.key; fam = f.key; } });
    if (!sec) return;
    state.section = sec; state.sel = { kind: "token", family: fam, name: name }; state.editing = null;
    render();
    var row = main.querySelector('[data-token="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]');
    if (row) { row.scrollIntoView({ block: "center" }); row.classList.add("ds-flash"); }
  }

  // ---- the parts every token row has: its name (renamed in place), the usage note, the row menu
  function nameCell(fam, t) {
    if (state.renaming === fam + ":" + t.name) {
      var inp = h("input", { type: "text", "class": "ds-cin ds-rename", value: t.name, spellcheck: "false", "aria-label": X.rename }), done = false;
      var commit = function () {
        if (done) return; done = true;
        var n = cleanKey(inp.value.trim()); state.renaming = null;
        if (!n || n === t.name) render(); else renameToken(fam, t.name, n);
      };
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") commit(); if (e.key === "Escape") { done = true; state.renaming = null; render(); } });
      inp.addEventListener("blur", commit);
      setTimeout(function () { inp.focus(); inp.select(); }, 0);
      return inp;
    }
    return h("button", { type: "button", "class": "ds-tname", title: S.editable ? T.edit : t.name, onclick: function () { select(fam, t.name); } },
      [h("code", { text: (fam === "type" ? "." : "") + t.name })]);
  }
  function usageBtn(fam, t) {
    var u = t.usage || "", b = iconBtn("notes", u || X.addUsage, null, u ? "has" : "");
    b.addEventListener("click", function () {
      if (!S.editable) { popover(b, [h("div", { "class": "ds-label", text: T.usage + " · " + t.name }), h("p", { text: u || X.noUsage })]); return; }
      var ta = h("textarea", { "class": "ds-in", rows: "4", "aria-label": T.usage }); ta.value = u;
      popover(b, [h("div", { "class": "ds-label", text: T.usage + " · " + t.name }), ta, h("div", { "class": "ds-row-btns" }, [
        btn(T.save, "primary", function () { var v = ta.value.trim(); closePop(); if (v !== u) setUsage(fam, t, v); }), btn(T.cancel, "", closePop)])]);
      setTimeout(function () { ta.focus(); }, 0);
    });
    return b;
  }
  function rowMenu(fam, t) {
    var b = iconBtn("more", X.more);
    b.addEventListener("click", function () {
      var items = [];
      if (S.editable) items.push({ label: X.rename, onClick: function () { state.renaming = fam + ":" + t.name; render(); } });
      items.push({ label: X.copyName, onClick: function () { copyText(fam === "type" ? "." + t.name : "var(--" + t.name + ")"); } });
      var al = fam !== "type" && aliasOf(fam, t);
      if (al) items.push({ label: X.goAlias(al), onClick: function () { goToken(al); } });
      if (S.editable && (fam === "color" || fam === "shadow") && multiTheme()) S.m.themes.slice(1).forEach(function (th) {
        if (ownValue(t.raw, th.id)) items.push({ label: X.inherit(themeName(S.m.first), th.name), onClick: function () { setThemed(fam, t, th.id, ""); } });
      });
      if (S.editable) items.push({ label: T.del, onClick: function () {
        setTimeout(function () { confirmMenu(b, T.delSure, function () { removeTokens(fam, [t.name], "removed " + fam + " token " + t.name); }); }, 0);
      } });
      kit.menu(b, items);
    });
    return b;
  }
  function detailRow(cols, kid) { return h("tr", { "class": "ds-detail" }, [h("td", { colspan: String(cols) }, [kid])]); }

  // ---- colour, read the way the browser paints it
  var cvs = document.createElement("canvas"); cvs.width = cvs.height = 1;
  var cx = null; try { cx = cvs.getContext("2d", { willReadFrequently: true }); } catch (e) { cx = null; }
  var rgbaMemo = {};
  function rgba(c) {
    if (!c || !cx) return null;
    if (rgbaMemo[c] !== undefined) return rgbaMemo[c];
    var out = null;
    cx.fillStyle = "#000"; cx.fillStyle = String(c); var a = cx.fillStyle;
    cx.fillStyle = "#fff"; cx.fillStyle = String(c);
    if (a === cx.fillStyle) {
      cx.clearRect(0, 0, 1, 1); cx.fillRect(0, 0, 1, 1);
      var d = cx.getImageData(0, 0, 1, 1).data; out = [d[0], d[1], d[2], d[3] / 255];
    }
    return (rgbaMemo[c] = out);
  }
  function over(fg, bg) { var a = fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]; }
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function hex(c) { return "#" + c.slice(0, 3).map(function (v) { var s = Math.round(Math.max(0, Math.min(255, v))).toString(16); return s.length < 2 ? "0" + s : s; }).join(""); }
  function toOklab(c) {
    var r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
      s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function fromOklch(L, Ch, hh) {
    for (var i = 0; i < 40; i++, Ch *= 0.94) {
      var a = Ch * Math.cos(hh), b = Ch * Math.sin(hh);
      var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3),
        s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
      var rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
      if (rgb.every(function (v) { return v >= -0.001 && v <= 1.001; }) || i === 39)
        return rgb.map(function (v) { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }).concat([1]);
    }
  }
  // Which colours are read (text 4.5:1, large text 3:1) or must be seen (rings, charts, icons 3:1), and on what:
  // by the name first, then by what the usage note says.
  function role(c) {
    var s = (typeof c === "string" ? c : c.name).toLowerCase(), u = typeof c === "string" ? "" : String(c.usage || "");
    if (/(^|[-_.])(chart|series|viz|dataviz|categorical|sequential|diverging)([-_.\d]|$)/.test(s)) return "charts";
    if (/(^|[-_.])(text|fg|foreground|ink|on)([-_.]|$)|^(heading|body|muted|link|label|caption|placeholder)([-_.]|$)/.test(s)) return "text";
    if (/(^|[-_.])(border|ring|outline|divider|stroke|line|rule|focus|separator|hairline)([-_.]|$)/.test(s)) return "borders";
    if (/(^|[-_.])(success|warning|warn|danger|error|info|positive|negative|critical|caution|status|primary|secondary|tertiary|accent|brand|fill|btn|button|selected|highlight|destructive)([-_.]|$)/.test(s)) return "fills";
    if (/(^|[-_.])(bg|background|surface|page|canvas|paper|ground|well|card|panel|overlay|elevated|raised|base|backdrop|scrim|sunken|popover|sheet)([-_.]|$)/.test(s)) return "surfaces";
    if (/\bcharts?\b|\bseries\b/i.test(u)) return "charts";
    if (/^\W*(page |app |screen )?(background|surface|canvas)\b|\bpage background\b/i.test(u)) return "surfaces";
    if (/^\W*((body|secondary|muted|link) )?text\b/i.test(u)) return "text";
    if (/\b(borders?|hairlines?|dividers?|rules?|outlines?|focus ring)\b/i.test(u)) return "borders";
    if (/\b(fills?|status|brand|buttons?)\b/i.test(u)) return "fills";
    return "palette";
  }
  function mentioned(c) {
    var u = String(c.usage || ""), out = [];
    if (!/\bon\b/i.test(u)) return out;
    // Longest names first, each struck out once found, so "bone-raised" is not also "bone".
    S.m.colors.slice().sort(function (a, b) { return b.name.length - a.name.length; }).forEach(function (o) {
      var re = new RegExp("(^|[^\\w.-])" + o.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])", "g");
      if (!re.test(u)) return;
      u = u.replace(re, "$1 ");
      if (o.name !== c.name) out.push(o);
    });
    return out;
  }
  function need(c) {
    var r = role(c), s = c.name.toLowerCase(), u = String(c.usage || "");
    if (r === "text") return /(large|display|heading|title|hero|xl)/.test(s) ? 3 : 4.5;
    if (/\b(text|links?)\b/i.test(u) && mentioned(c).length && !/^\W*(tag|notice)?\s*fills?\b/i.test(u)) return 4.5;
    if (r === "charts" || /(^|[-_.])(ring|focus|icon)([-_.]|$)/.test(s) || /\b3(\.0)?:1\b/.test(u)) return 3;
    return 0;
  }
  var WELL = /^(surface|page|background|bg|canvas|paper|ground|well)([-_.](base|default|page|primary|app|body|0|1|100))?$/i;
  var CARD = /(^|[-_.])(card|panel|raised|elevated)([-_.]|$)/i;
  function ground(g, th) {
    var v = rgba(S.m.resolve(g.name, th));
    return v ? { c: g, name: g.name, rgb: v[3] < 1 ? over(v, th === "dark" ? [0, 0, 0, 1] : [255, 255, 255, 1]) : v } : null;
  }
  // The grounds a colour is read on: the ones its usage note names ("on bone and bone-raised", "on a clay fill",
  // and "on-clay" is read on clay), else the page and the card.
  function grounds(th, c) {
    var named = [];
    if (c) {
      var on = /^on[-_.](.+)$/i.exec(c.name), base = on && S.m.colors.filter(function (o) { return o.name === on[1]; })[0];
      named = base ? [base] : mentioned(c);
    }
    if (!named.length) {
      var well = null, card = null;
      S.m.colors.forEach(function (o) {
        if (!well && (WELL.test(o.name) || /\bpage background\b|^\W*background\b/i.test(o.usage || ""))) well = o;
        if (!card && role(o) === "surfaces" && (CARD.test(o.name) || /\bcards?\b/i.test(o.usage || ""))) card = o;
      });
      if (!well) well = S.m.colors.filter(function (o) { return role(o) === "surfaces"; })[0] || null;
      named = [well, card].filter(function (g, i, a) { return g && a.indexOf(g) === i; });
    }
    var out = named.map(function (g) { return ground(g, th); }).filter(Boolean);
    if (!out.length) out.push({ name: th === "dark" ? "black" : "white", rgb: th === "dark" ? [0, 0, 0, 1] : [255, 255, 255, 1] });
    return out;
  }
  function contrast(c, th) {
    var k = need(c); if (!k) return null;
    var fg = rgba(S.m.resolve(c.name, th)); if (!fg) return null;
    var worst = null;
    grounds(th, c).forEach(function (g) {
      if (g.name === c.name) return;
      var r = ratio(fg[3] < 1 ? over(fg, g.rgb) : fg, g.rgb);
      if (!worst || r < worst.r) worst = { r: r, g: g.name };
    });
    return worst ? { r: worst.r, need: k, ok: worst.r >= k - 0.005, g: worst.g } : null;
  }
  function readable(c, th) {
    var k = need(c), fg = rgba(S.m.resolve(c.name, th));
    if (!k || !fg) return null;
    var gs = grounds(th, c).filter(function (g) { return g.name !== c.name; });
    var lab = toOklab(fg), ch = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]), hh = Math.atan2(lab[2], lab[1]);
    var darker = gs.reduce(function (s, g) { return s + lum(g.rgb); }, 0) / gs.length > 0.18;
    for (var L = lab[0], i = 0; i < 220; i++) {
      L += darker ? -0.005 : 0.005;
      if (L < 0 || L > 1) break;
      var rgb = fromOklch(L, ch, hh);
      if (gs.every(function (g) { return ratio(rgb, g.rgb) >= k; })) return hex(rgb);
    }
    return darker ? "#000000" : "#ffffff";
  }

  // ---- Overview: the cover, the brand book (the author's part), the generated part apart
  function readmeParts() {
    var text = kit.fileText("README.md");
    if (text == null) return { own: null, tail: "" };
    var i = text.indexOf(README_MARK);
    if (i < 0) return { own: text, tail: "" };
    var cut = text.lastIndexOf("\n---\n", i), own = cut >= 0 && i - cut <= 8 ? text.slice(0, cut) : text.slice(0, i);
    return { own: own.replace(/\s+$/, "") + "\n", tail: text.slice(i + README_MARK.length) };
  }
  function overview() {
    var kids = [], cv = cover();
    if (S.index.lastChange && /^CI/i.test(String(S.index.lastChange.via || ""))) kids.push(h("div", { "class": "ds-banner", text: T.ci }));
    if (S.index.editing && !C.thumb) kids.push(h("div", { "class": "ds-banner", text: T.readOnly }));
    if (cv) kids.push(cv);
    if (S.tokensBad) kids.push(h("div", { "class": "ds-banner", text: T.noTokens }));
    var pn = problemsNote(S.compiled.problems);
    if (pn) kids.push(pn);
    var rp = readmeParts(), editing = state.editing === "README.md";
    var tools = S.editable && !editing ? [btn(rp.own == null ? T.writeReadme : T.edit, "", function () { state.editing = "README.md"; render(); })] : [];
    kids.push(heading(S.title, tools));
    if (editing) kids.push(mdEditor("README.md", rp.own == null ? "# " + S.title + "\n\n" : rp.own, null, function (v) {
      return v.replace(/\s+$/, "") + "\n" + (rp.tail ? "\n---\n" + README_MARK + rp.tail : "");
    }));
    else if (rp.own == null) kids.push(askBox("readme"));
    else kids.push(markdown(rp.own, "README.md", true));
    if (rp.tail && !editing) kids.push(h("details", { "class": "ds-gen" }, [h("summary", { text: X.genReadme }), markdown(rp.tail, "README.md", false)]));
    return kids;
  }

  // ---- Colors: a table per role (and per stem in the palette), a column per theme
  var ROLES = ["surfaces", "text", "fills", "borders", "charts", "palette"];
  function tableHead(cols) { return h("thead", {}, [h("tr", {}, cols.map(function (c) { return h("th", { "class": c.cls || null, text: c.text || "" }); }))]); }
  function themeCols() { return multiTheme() ? S.m.themes.map(function (t) { return { text: t.name }; }) : [{ text: T.value }]; }
  function colorView() {
    var kids = [heading(T.colors, [themeSelect()])];
    if (S.m.note) kids.push(h("p", { "class": "ds-muted", text: S.m.note }));
    var pn = problemsNote(familyProblems("color")); if (pn) kids.push(pn);
    if (!S.m.colors.length) kids.push(askBox("colors"));
    var by = {};
    S.m.colors.forEach(function (c) { var r = role(c); (by[r] = by[r] || []).push(c); });
    ROLES.forEach(function (r) {
      if (!by[r]) return;
      if (r === "palette") stemRuns(by[r]).forEach(function (run) { kids.push(colorTable(run.stem || X.roles.palette, run.items, run.stem ? run.stem + "-" : "")); });
      else kids.push(colorTable(X.roles[r], by[r], ""));
    });
    if (S.editable) kids.push(state.editing === "new:color" ? tokenEditor("color", null) : btn("+ " + T.addColor, "", function () { state.editing = "new:color"; state.sel = null; render(); }));
    return kids;
  }
  function groupHead(title, n, tools) {
    return h("div", { "class": "ds-head ds-h2row" }, [h("h2", { "class": "ds-h2", text: title }), h("span", { "class": "ds-count", text: String(n) }), h("span", { style: "flex:1" })].concat(tools || []));
  }
  function groupTools(fam, title, list, key) {
    if (!S.editable) return [];
    var del = iconBtn("trash", X.delGroup);
    del.addEventListener("click", function () {
      confirmMenu(del, X.delGroupSure(list.length), function () { removeTokens(fam, list.map(function (t) { return t.name; }), "removed " + fam + " group " + title); });
    });
    return [iconBtn("plus", X.addHere, function () { state.editing = key; state.sel = null; render(); }), del];
  }
  function colorTable(title, list, prefix) {
    var key = "new:color:" + title, cols = themeCols(), body = h("tbody");
    list.forEach(function (c) {
      var tr = h("tr", { "class": "ds-row" + (isSel("color", c.name) ? " on" : ""), "data-token": c.name }, [h("td", { "class": "ds-cname" }, [nameCell("color", c)])]);
      (multiTheme() ? S.m.themes : [S.m.themes[0]]).forEach(function (t, i) { tr.appendChild(h("td", {}, [colorCell(c, t, multiTheme() && i > 0)])); });
      tr.appendChild(h("td", { "class": "ds-act" }, [usageBtn("color", c), rowMenu("color", c)]));
      body.appendChild(tr);
      if (state.editing === "token:color:" + c.name) body.appendChild(detailRow(cols.length + 2, tokenEditor("color", c)));
    });
    var out = h("section", { "class": "ds-group" }, [groupHead(title, list.length, groupTools("color", title, list, key)),
      h("div", { "class": "ds-table-wrap" }, [h("table", { "class": "ds-table ds-ctable" }, [tableHead([{ text: T.name }].concat(cols, [{ cls: "ds-th-act" }])), body])])]);
    if (state.editing === key) out.appendChild(tokenEditor("color", null, prefix));
    return out;
  }
  function colorCell(c, t, canInherit) {
    var own = ownValue(c.raw, t.id), resolved = S.m.resolve(c.name, t.id) || "";
    var sw = h("label", { "class": "ds-sw", style: "--sw:" + (resolved || "transparent"), title: resolved });
    var cell = h("div", { "class": "ds-ccell" }, [sw]);
    if (S.editable) {
      var pick = h("input", { type: "color", "class": "ds-sw-pick", "aria-label": c.name + " · " + t.name, tabindex: "-1" }), rr = rgba(resolved);
      pick.value = rr ? hex(rr) : "#000000";
      pick.addEventListener("change", function () { setThemed("color", c, t.id, pick.value); });
      sw.appendChild(pick);
      var inp = h("input", { type: "text", "class": "ds-cin", value: own, placeholder: canInherit ? X.inherits(themeName(S.m.first)) : "", spellcheck: "false",
        "aria-label": c.name + " · " + t.name });
      enterBlurs(inp, own);
      inp.addEventListener("change", function () { var v = inp.value.trim(); if (v !== own) setThemed("color", c, t.id, v); });
      cell.appendChild(inp);
    } else cell.appendChild(h("code", { "class": "ds-cval" + (own ? "" : " ds-muted"), text: own || (canInherit ? X.inherits(themeName(S.m.first)) : "") }));
    var ct = contrast(c, t.id);
    if (ct) {
      cell.appendChild(h("span", { "class": "ds-badge " + (ct.ok ? "ok" : "bad"), text: (ct.ok ? "✓ " : "✕ ") + ct.r.toFixed(1) + ":1", title: X.against(ct.g, ct.need) }));
      if (!ct.ok && S.editable) cell.appendChild(h("button", { type: "button", "class": "ds-link", text: X.readable, onclick: function () {
        var v = readable(c, t.id); if (v) setThemed("color", c, t.id, v);
      } }));
    }
    return cell;
  }

  // ---- Spacing, Radius, Shadows and further families: Name | value in place | what it looks like
  function splitTop(s, sep) {
    var out = [], cur = "", d = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === "(") d++; else if (ch === ")" && d) d--;
      if (d === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) { if (cur.trim() || sep !== " ") out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  var LEN = /^-?\d*\.?\d+(px|rem|em)?$/;
  function parseShadow(s) {
    if (!s || /^none$/i.test(s.trim())) return [];
    return splitTop(s, ",").map(function (l) {
      var parts = splitTop(l, " "), lens = [], color = [], inset = false;
      parts.forEach(function (p) { if (p === "inset") inset = true; else if (LEN.test(p) && lens.length < 4 && !color.length) lens.push(p); else color.push(p); });
      return { x: lens[0] || "0", y: lens[1] || "0", blur: lens[2] || "0", spread: lens[3] || "0", color: color.join(" ") || "rgb(0 0 0 / 20%)", inset: inset };
    });
  }
  function shadowText(layers) {
    var px = function (v) { v = String(v).trim() || "0"; return /^-?\d*\.?\d+$/.test(v) && +v !== 0 ? v + "px" : v; };
    return layers.map(function (l) { return (l.inset ? "inset " : "") + [px(l.x), px(l.y), px(l.blur), px(l.spread)].join(" ") + " " + l.color; }).join(", ");
  }
  function famView(key) {
    var f = S.m.families.filter(function (x) { return x.key === key; })[0];
    if (!f) return [heading(key), h("p", { "class": "ds-muted", text: T.empty })];
    var kids = [heading(T.fam[f.key] || f.title, f.kind === "shadow" ? [themeSelect()] : [])];
    if (f.note) kids.push(h("p", { "class": "ds-muted", text: f.note }));
    var pn = problemsNote(familyProblems(key)); if (pn) kids.push(pn);
    var shadow = f.kind === "shadow", cols = shadow ? themeCols() : [{ text: T.value }, { text: X.preview }], body = h("tbody");
    stemRuns(f.tokens).forEach(function (run) {
      if (run.stem && f.tokens.length > 6) body.appendChild(h("tr", { "class": "ds-stem" }, [h("td", { colspan: String(cols.length + 2), text: run.stem })]));
      run.items.forEach(function (t) {
        var tr = h("tr", { "class": "ds-row" + (isSel(key, t.name) ? " on" : ""), "data-token": t.name }, [h("td", { "class": "ds-cname" }, [nameCell(key, t)])]);
        if (shadow) (multiTheme() ? S.m.themes : [S.m.themes[0]]).forEach(function (th, i) { tr.appendChild(h("td", {}, [shadowCell(key, t, th, multiTheme() && i > 0)])); });
        else { tr.appendChild(h("td", {}, [valueCell(key, t)])); tr.appendChild(h("td", {}, [famVis(key, t.value)])); }
        tr.appendChild(h("td", { "class": "ds-act" }, [usageBtn(key, t), rowMenu(key, t)]));
        body.appendChild(tr);
        if (state.editing === "token:" + key + ":" + t.name) body.appendChild(detailRow(cols.length + 2, tokenEditor(key, t)));
      });
    });
    if (f.tokens.length) kids.push(h("div", { "class": "ds-table-wrap" }, [h("table", { "class": "ds-table" }, [tableHead([{ text: T.name }].concat(cols, [{ cls: "ds-th-act" }])), body])]));
    else kids.push(h("p", { "class": "ds-muted", text: T.empty }));
    if (S.editable) kids.push(state.editing === "new:" + key ? tokenEditor(key, null) : btn("+ " + T.add, "", function () { state.editing = "new:" + key; state.sel = null; render(); }));
    return kids;
  }
  function famVis(key, v) {
    if (key === "spacing") return h("span", { "class": "ds-vis" }, [h("span", { "class": "ds-space", style: "width:min(100%," + v + ")" })]);
    if (key === "radius") return h("span", { "class": "ds-vis" }, [h("span", { "class": "ds-radius", style: "border-radius:" + v })]);
    if (/opacity/i.test(key) && /^[\d.]+%?$/.test(v)) return h("span", { "class": "ds-vis" }, [h("span", { "class": "ds-opacity", style: "opacity:" + v })]);
    if (/^(z|zindex|z-index|layer)/i.test(key)) return h("span", { "class": "ds-muted", text: "" });
    if (/(duration|motion|ease|easing|transition)/i.test(key)) return h("span", { "class": "ds-vis" }, [h("span", { "class": "ds-motion", style: /ms|s$/.test(v) ? "animation-duration:" + v : "animation-timing-function:" + v })]);
    if (/(border|stroke|width)/i.test(key) && LEN.test(v)) return h("span", { "class": "ds-vis" }, [h("span", { "class": "ds-stroke", style: "border-top-width:" + v })]);
    return h("span", { "class": "ds-vis" });
  }
  function valueCell(key, t) {
    var raw = t.raw && t.raw.value, v = raw == null ? "" : typeof raw === "object" ? String(raw[S.m.first] || "") : String(raw);
    if (!S.editable) return h("code", { "class": "ds-cval", text: t.value });
    var m = /^(-?\d*\.?\d+)\s*(px)?$/.exec(v), px = m && (key === "spacing" || key === "radius" || m[2]);
    var inp = h("input", { type: px ? "number" : "text", step: "any", "class": "ds-cin" + (px ? " ds-num" : ""), value: px ? m[1] : v, spellcheck: "false", "aria-label": t.name });
    enterBlurs(inp, px ? m[1] : v);
    inp.addEventListener("change", function () {
      var s = inp.value.trim(); if (px && /^-?\d*\.?\d+$/.test(s)) s += "px";
      if (s && s !== v && s !== v + "px") editToken(key, t.name, function (e) { e.value = s; }, "edited " + key + " token " + t.name);
    });
    return h("span", { "class": "ds-unit" }, [inp, px ? h("span", { "class": "ds-suffix", text: "px" }) : null]);
  }
  function shadowCell(key, t, th, canInherit) {
    var css = S.m.shadow(t, th.id) || "none", own = ownValue(t.raw, th.id), g = grounds(th.id)[0];
    var layers = parseShadow(css);
    var tile = h("button", { type: "button", "class": "ds-shtile", style: "background:" + hex(g.rgb), title: css, "aria-label": t.name + " · " + th.name },
      [h("span", { "class": "ds-shcard", style: "box-shadow:" + css + ";background:" + cardOf(th.id) })]);
    var sum = h("span", { "class": "ds-muted ds-shsum", text: (own ? "" : canInherit ? X.inherits(themeName(S.m.first)) + " · " : "") +
      (L === "hu" ? layers.length + " réteg" : layers.length + (layers.length === 1 ? " layer" : " layers")) + (layers[0] ? " · " + [layers[0].x, layers[0].y, layers[0].blur].join(" ") : "") });
    tile.addEventListener("click", function () { layerEditor(tile, key, t, th, parseShadow(own || css)); });
    return h("div", { "class": "ds-shcell" }, [tile, sum]);
  }
  function cardOf(th) { var gs = grounds(th); return hex((gs[1] || gs[0]).rgb); }
  function layerEditor(anchor, key, t, th, layers) {
    layers = layers.length ? layers : [{ x: "0", y: "1px", blur: "2px", spread: "0", color: "rgb(0 0 0 / 12%)", inset: false }];
    var list = h("div", { "class": "ds-layers" }), prev = h("span", { "class": "ds-shcard" });
    function paint() { prev.style.boxShadow = shadowText(layers); prev.style.background = cardOf(th.id); }
    function draw() {
      list.replaceChildren.apply(list, layers.map(function (l, i) {
        function f(k, lab) { var inp = h("input", { type: "text", "class": "ds-cin ds-mono", value: l[k], "aria-label": lab, title: lab, spellcheck: "false" });
          inp.addEventListener("input", function () { l[k] = inp.value; paint(); }); return inp; }
        var ins = h("input", { type: "checkbox", "aria-label": X.inset }); ins.checked = !!l.inset;
        ins.addEventListener("change", function () { l.inset = ins.checked; paint(); });
        return h("div", { "class": "ds-layer" }, [f("x", "x"), f("y", "y"), f("blur", X.blur), f("spread", X.spread), f("color", X.color),
          h("label", { "class": "ds-inset" }, [ins, X.inset]), iconBtn("minus", T.del, function () { layers.splice(i, 1); draw(); paint(); })]);
      }));
    }
    draw(); paint();
    popover(anchor, [h("div", { "class": "ds-label", text: X.layers + " · " + t.name + (multiTheme() ? " · " + th.name : "") }),
      h("div", { "class": "ds-shtile ds-shbig", style: "background:" + hex(grounds(th.id)[0].rgb) }, [prev]),
      h("div", { "class": "ds-layer ds-layer-h" }, ["x", "y", X.blur, X.spread, X.color, "", ""].map(function (s) { return h("span", { text: s }); })), list,
      S.editable ? h("div", { "class": "ds-row-btns" }, [btn("+ " + X.addLayer, "", function () { layers.push({ x: "0", y: "4px", blur: "12px", spread: "0", color: "rgb(0 0 0 / 10%)", inset: false }); draw(); paint(); }),
        h("span", { style: "flex:1" }), btn(T.save, "primary", function () { var v = layers.length ? shadowText(layers) : "none"; closePop(); setThemed(key, t, th.id, v); }), btn(T.cancel, "", closePop)]) : null], true);
  }

  // Edit a token's value (per theme for colours and shadows) and usage, add one, remove one.
  function tokenEditor(fam, tok, prefix) {
    var perTheme = (fam === "color" || fam === "shadow") && multiTheme();
    var raw = tok && tok.raw ? tok.raw : null, nameIn = null, inputs = {}, err = h("div", { "class": "ds-err", "aria-live": "polite" });
    var kids = [];
    if (!tok) {
      nameIn = h("input", { type: "text", "class": "ds-in", placeholder: T.name, "aria-label": T.name, spellcheck: "false", value: prefix || "" });
      kids.push(h("label", { "class": "ds-field" }, [h("span", { text: T.name }), nameIn]));
    }
    function valueField(label, val, key) {
      var inp = h("input", { type: "text", "class": "ds-in ds-mono", value: val == null ? "" : String(val), "aria-label": label, spellcheck: "false",
        placeholder: perTheme && key !== S.m.first ? X.inherits(themeName(S.m.first)) : "" });
      inputs[key] = inp;
      var extra = null;
      if (fam === "color") {
        var pick = h("input", { type: "color", "class": "ds-pick", "aria-label": label, tabindex: "-1" });
        var sync = function () { var c = rgba(inp.value.trim()); pick.value = c ? hex(c) : "#000000"; };
        sync(); inp.addEventListener("input", sync);
        pick.addEventListener("input", function () { inp.value = pick.value; });
        extra = pick;
      }
      return h("label", { "class": "ds-field" }, [h("span", { text: label }), h("span", { "class": "ds-in-row" }, [inp, extra])]);
    }
    if (perTheme) S.m.themes.forEach(function (t) { kids.push(valueField(T.value + " · " + t.name, ownValue(raw, t.id), t.id)); });
    else kids.push(valueField(T.value, raw ? (typeof raw.value === "object" && raw.value ? raw.value[S.m.first] : raw.value) : "", "_"));
    var usage = h("textarea", { "class": "ds-in", rows: "2", "aria-label": T.usage });
    usage.value = raw && raw.usage ? raw.usage : "";
    kids.push(h("label", { "class": "ds-field" }, [h("span", { text: T.usage }), usage]));
    kids.push(err);
    var btns = [btn(T.save, "primary", function () { commit(false); }), btn(T.cancel, "", function () { state.editing = null; render(); })];
    if (tok) { var db = btn(T.del, "danger", function () { confirmMenu(db, T.delSure, function () { commit(true); }); }); btns.push(db); }
    kids.push(h("div", { "class": "ds-row-btns" }, btns));
    var box = h("div", { "class": "ds-editor ds-token-editor", onclick: function (e) { e.stopPropagation(); } }, kids);
    setTimeout(function () { var el = nameIn || inputs[Object.keys(inputs)[0]]; el.focus(); if (nameIn) el.setSelectionRange(el.value.length, el.value.length); }, 0);

    function commit(remove) {
      var next = JSON.parse(JSON.stringify(S.tokens || {})), name = tok ? tok.name : cleanKey(String(nameIn.value || "").trim());
      if (!next[fam] || !Array.isArray(next[fam].tokens)) next[fam] = Object.assign({}, next[fam] && Array.isArray(next[fam].themes) ? { themes: next[fam].themes } : {}, { tokens: [] });
      var list = next[fam].tokens, at = -1;
      list.forEach(function (t, i) { if (at < 0 && t && cleanKey(t.name) === name) at = i; });
      if (!tok) {
        if (!NAME.test(name)) { err.textContent = T.badName; return; }
        if (allNames().indexOf(name) >= 0 || at >= 0) { err.textContent = T.taken; return; }
      }
      if (remove) { if (at >= 0) list.splice(at, 1); }
      else {
        var entry = at >= 0 ? list[at] : { name: name }, value;
        if (perTheme) {
          value = {};
          S.m.themes.forEach(function (t) { var s = inputs[t.id].value.trim(); if (s) value[t.id] = s; });
          if (!value[S.m.first]) { err.textContent = X.needValue; return; }
        } else {
          value = inputs._.value.trim();
          if (!value) { err.textContent = X.needValue; return; }
          if ((fam === "spacing" || fam === "radius") && /^-?\d+(\.\d+)?$/.test(value)) value = value + "px";
        }
        entry.value = value;
        var u = usage.value.trim();
        if (u) entry.usage = u; else delete entry.usage;
        if (at < 0) list.push(entry);
      }
      saveTokens(next, (remove ? "removed " : tok ? "edited " : "added ") + fam + " token " + name).then(function (ok) {
        if (!ok) return;
        state.editing = null;
        state.sel = remove ? null : { kind: "token", family: fam, name: name };
        render();
      });
    }
    return box;
  }

  // ---- Typography: a table per group, Name | Preview (the style itself and its family · size), add styles, upload fonts
  function editStyle(name, fn, note) {
    var next = JSON.parse(JSON.stringify(S.tokens || {})), hit = null;
    ((next.type && next.type.groups) || []).forEach(function (g) { (g.styles || []).forEach(function (s) { if (!hit && s && cleanKey(s.name) === name) hit = s; }); });
    if (!hit) { kit.toast(T.notSaved); return Promise.resolve(false); }
    var err = fn(hit, next);
    if (err) { kit.toast(err); return Promise.resolve(false); }
    return saveTokens(next, note);
  }
  function styleCss(s) {
    var ty = S.m.type, fam = s.family ? ty.families[s.family] : "inherit";
    return "font-family:" + fam + ";font-size:" + s.fontSize + ";" + (s.lineHeight ? "line-height:" + s.lineHeight + ";" : "") +
      (s.fontWeight ? "font-weight:" + s.fontWeight + ";" : "") + (s.letterSpacing ? "letter-spacing:" + s.letterSpacing + ";" : "") +
      (s.fontStyle ? "font-style:" + s.fontStyle + ";" : "") + (s.opticalSize != null ? "font-variation-settings:'opsz' " + s.opticalSize + ";" : "");
  }
  function familyLabel(key) {
    var st = key ? S.m.type.families[key] : "";
    var m = /^\s*["']?([^"',]+)/.exec(st || ""); return m ? m[1].trim() : key || "inherit";
  }
  function typeView() {
    var ty = S.m.type, tools = [];
    if (S.editable) tools.push(btn("+ " + X.uploadFont, "", pickFont));
    var kids = [heading(T.type, tools)];
    var pn = problemsNote(familyProblems("type")); if (pn) kids.push(pn);
    if (!ty.groups.length && !ty.familyKeys.length && !ty.fonts.length) kids.push(askBox("type"));
    ty.groups.forEach(function (g, gi) {
      var key = "new:style:" + gi, list = g.styles, body = h("tbody");
      list.forEach(function (s) {
        var chip = h("span", { "class": "ds-chip-t", text: familyLabel(s.family) + " · " + String(s.fontSize).replace(/px$/, "") + (s.fontWeight ? " · " + s.fontWeight : "") });
        body.appendChild(h("tr", { "class": "ds-row" + (isSel("type", s.name) ? " on" : ""), "data-token": s.name }, [
          h("td", { "class": "ds-cname" }, [nameCell("type", s)]),
          h("td", { "class": "ds-tprev" }, [h("div", { "class": "ds-type-sample", style: styleCss(s), text: s.sample || T.sample }), chip]),
          h("td", { "class": "ds-act" }, [usageBtn("type", s), rowMenu("type", s)])]));
        if (state.editing === "token:type:" + s.name) body.appendChild(detailRow(3, styleEditor(gi, s)));
      });
      kids.push(h("section", { "class": "ds-group" }, [groupHead(g.name, list.length, groupTools("type", g.name, list, key)),
        h("div", { "class": "ds-table-wrap" }, [h("table", { "class": "ds-table" }, [tableHead([{ text: T.name }, { text: X.preview }, { cls: "ds-th-act" }]), body])]),
        state.editing === key ? styleEditor(gi, null) : null]));
    });
    if (S.editable && !ty.groups.length && ty.familyKeys.length) kids.push(state.editing === "new:style:0" ? styleEditor(0, null) :
      btn("+ " + X.addStyle, "", function () { state.editing = "new:style:0"; render(); }));
    if (ty.familyKeys.length) {
      kids.push(groupHead(T.families, ty.familyKeys.length));
      kids.push(h("div", { "class": "ds-table-wrap" }, [h("table", { "class": "ds-table" }, [tableHead([{ text: T.name }, { text: X.preview }]),
        h("tbody", {}, ty.familyKeys.map(function (k) {
          return h("tr", { "class": "ds-row" }, [h("td", { "class": "ds-cname" }, [h("code", { text: "--font-" + k })]),
            h("td", { "class": "ds-tprev" }, [h("div", { "class": "ds-type-sample", style: "font-family:" + ty.families[k] + ";font-size:22px", text: "Aa Bb Cc 0123" }),
              h("span", { "class": "ds-chip-t", text: ty.families[k] })])]);
        }))])]));
    }
    var fontFiles = Object.keys(S.fontUrls).sort(), listed = {};
    if (ty.fonts.length || fontFiles.length) {
      kids.push(groupHead(T.fonts, fontFiles.length));
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
  function styleEditor(gi, s) {
    var raw = null;
    if (s) ((S.tokens.type && S.tokens.type.groups) || []).forEach(function (g) { (g.styles || []).forEach(function (x) { if (!raw && x && cleanKey(x.name) === s.name) raw = x; }); });
    raw = raw || {};
    var err = h("div", { "class": "ds-err" }), f = {};
    function field(k, label, val, attrs) {
      var inp = h("input", Object.assign({ type: "text", "class": "ds-in ds-mono", "aria-label": label, spellcheck: "false" }, attrs || {}));
      inp.value = val == null ? "" : String(val); f[k] = inp;
      return h("label", { "class": "ds-field" }, [h("span", { text: label }), inp]);
    }
    var famSel = h("select", { "class": "ds-in", "aria-label": X.family }, [h("option", { value: "", text: "—" })].concat(S.m.type.familyKeys.map(function (k) {
      return h("option", { value: k, text: familyLabel(k) + " (" + k + ")" });
    })));
    famSel.value = raw.family ? String(raw.family).toLowerCase() : "";
    var kids = [h("div", { "class": "ds-grid4" }, [s ? null : field("name", T.name, ""), field("fontSize", X.size, raw.fontSize, { placeholder: "16px" }),
      field("lineHeight", X.lineHeight, raw.lineHeight, { placeholder: "1.5" }), field("fontWeight", X.weight, raw.fontWeight, { placeholder: "400" }),
      h("label", { "class": "ds-field" }, [h("span", { text: X.family }), famSel])]), field("sample", T.sample, raw.sample), err,
      h("div", { "class": "ds-row-btns" }, [btn(T.save, "primary", save), btn(T.cancel, "", function () { state.editing = null; render(); })])];
    function save() {
      var next = JSON.parse(JSON.stringify(S.tokens || {}));
      next.type = next.type && typeof next.type === "object" ? next.type : {};
      next.type.groups = Array.isArray(next.type.groups) ? next.type.groups : [];
      if (!next.type.groups[gi]) next.type.groups[gi] = { name: "Text", styles: [] };
      var g = next.type.groups[gi]; g.styles = Array.isArray(g.styles) ? g.styles : [];
      var target, name;
      if (s) { name = s.name; target = g.styles.filter(function (x) { return x && cleanKey(x.name) === name; })[0]; }
      else {
        name = cleanKey(f.name.value.trim());
        if (!NAME.test(name)) { err.textContent = T.badName; return; }
        if (allNames().indexOf(name) >= 0) { err.textContent = T.taken; return; }
        target = { name: name }; g.styles.push(target);
      }
      if (!target) { err.textContent = T.notSaved; return; }
      ["fontSize", "lineHeight", "fontWeight", "sample"].forEach(function (k) {
        var v = f[k].value.trim();
        if (!v) { delete target[k]; return; }
        target[k] = k !== "sample" && /^-?\d+(\.\d+)?$/.test(v) ? (k === "fontSize" ? v + "px" : +v) : v;
      });
      if (!target.fontSize) { err.textContent = X.size + ": " + X.needValue; return; }
      if (famSel.value && famSel.value !== String(g.family || "").toLowerCase()) target.family = famSel.value; else if (!famSel.value) delete target.family;
      saveTokens(next, (s ? "edited" : "added") + " type style " + name).then(function (ok) {
        if (ok) { state.editing = null; state.sel = { kind: "token", family: "type", name: name }; render(); }
      });
    }
    return h("div", { "class": "ds-editor", onclick: function (e) { e.stopPropagation(); } }, kids);
  }
  var fontPick = h("input", { type: "file", accept: ".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf", hidden: true });
  document.body.appendChild(fontPick);
  function pickFont() { fontPick.value = ""; fontPick.click(); }
  fontPick.addEventListener("change", function () {
    var file = fontPick.files && fontPick.files[0];
    if (!file) return;
    var ext = (/\.(woff2?|ttf|otf)$/i.exec(file.name) || [])[1];
    if (!ext || file.size > 8 * 1024 * 1024) { kit.toast(X.fontTooBig); return; }
    ext = ext.toLowerCase();
    var base = file.name.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 80) || "font";
    var name = base + "." + ext, n = 2;
    while (C.files["fonts/" + name] != null) name = base + "-" + (n++) + "." + ext;
    var rd = new FileReader();
    rd.onload = function () {
      var b64 = String(rd.result).slice(String(rd.result).indexOf(",") + 1), files = {};
      files["fonts/" + name] = "data:font/" + ext + ";base64," + b64;
      var next = JSON.parse(JSON.stringify(S.tokens || {}));
      next.type = next.type && typeof next.type === "object" ? next.type : {};
      next.type.fonts = Array.isArray(next.type.fonts) ? next.type.fonts : [];
      var w = /thin/i.test(base) ? 100 : /extra-?light/i.test(base) ? 200 : /light/i.test(base) ? 300 : /medium/i.test(base) ? 500 : /semi-?bold/i.test(base) ? 600 :
        /extra-?bold/i.test(base) ? 800 : /black|heavy/i.test(base) ? 900 : /bold/i.test(base) ? 700 : /variable|\bvf\b|\[/i.test(file.name) ? "100 900" : 400;
      var family = base.replace(/[-_]?(thin|extra-?light|light|regular|medium|semi-?bold|extra-?bold|bold|black|heavy|italic|variable|vf)\b/gi, "").replace(/[-_]+/g, " ").trim() || base;
      next.type.fonts.push({ family: family, file: name, weight: String(w), style: /italic/i.test(base) ? "italic" : "normal" });
      files["tokens.json"] = tokensText(next);
      saveFiles(files, "uploaded fonts/" + name).then(function (ok) { if (ok) { kit.toast(T.uploaded + ": " + name); state.section = "type"; render(); } });
    };
    rd.readAsDataURL(file);
  });

  // ---- Components: Name | live Preview, the theme to preview in, the guidelines and the props
  function propsOf(dts, comp) {
    if (!dts) return [];
    var re = new RegExp("(?:export\\s+)?(?:declare\\s+)?(?:interface|type)\\s+" + comp.replace(/\$/g, "\\$") + "Props\\b[^{]*\\{"), m = re.exec(dts);
    if (!m) return [];
    var start = m.index + m[0].length, i = start, depth = 1;
    while (i < dts.length && depth) { if (dts[i] === "{") depth++; else if (dts[i] === "}") depth--; i++; }
    var body = dts.slice(start, i - 1), parts = [], cur = "", d = 0;
    for (var k = 0; k < body.length; k++) {
      var ch = body[k];
      if ("{([<".indexOf(ch) >= 0) d++; else if ("})]>".indexOf(ch) >= 0 && d) d--;
      if (d === 0 && (ch === ";" || ch === "\n")) { parts.push(cur); cur = ""; } else cur += ch;
    }
    parts.push(cur);
    var out = [], note = "";
    parts.forEach(function (part) {
      var s = part.trim(), cm;
      while ((cm = /^\/\*\*?\s*([\s\S]*?)\s*\*\/\s*/.exec(s) || /^\/\/\s*([^\n]*)\n?\s*/.exec(s))) {
        note = cm[1].replace(/\s*\n\s*\*?\s*/g, " ").trim(); s = s.slice(cm[0].length).trim();
      }
      var p = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]+)$/.exec(s);
      if (p) { out.push({ name: p[1], type: p[3].replace(/\s+/g, " ").trim().replace(/,$/, ""), optional: !!p[2], note: note }); note = ""; }
    });
    return out;
  }
  function componentView() {
    var kids = [heading(T.components, [themeSelect()])];
    if (reactMissing()) kids.push(h("div", { "class": "ds-banner", text: T.reactMissing }));
    if (!S.components.length) { kids.push(askBox("components")); return kids; }
    var groups = [], by = {};
    S.components.forEach(function (c) { var g = c.group || ""; if (!by[g]) { by[g] = []; groups.push(g); } by[g].push(c); });
    var dts = kit.fileText("components/index.d.ts") || "";
    groups.forEach(function (g) {
      var body = h("tbody");
      by[g].forEach(function (c) {
        var open = state.sel && state.sel.kind === "component" && state.sel.name === c.name;
        body.appendChild(componentRow(c, open));
        if (open) body.appendChild(detailRow(3, componentDetail(c, dts)));
      });
      kids.push(h("section", { "class": "ds-group" }, [g ? groupHead(g, by[g].length) : null,
        h("div", { "class": "ds-table-wrap" }, [h("table", { "class": "ds-table ds-comps" }, [tableHead([{ text: T.name }, { text: X.preview }, { cls: "ds-th-act" }]), body])])]));
    });
    return kids;
  }
  function componentRow(c, open) {
    var errEl = h("div", { "class": "ds-err" });
    var prev = c.preview && !c.marker.floor ? frame(c.preview, { marker: c.marker, title: c.name, lazy: true, max: 520, onError: function (m) { errEl.textContent = T.previewFailed + m; } })
      : h("div", { "class": "ds-noprev", text: c.preview ? (c.marker.subtitle || c.name) : T.noPreview });
    var gb = iconBtn("notes", X.guideline, null, c.readme ? "has" : "");
    gb.addEventListener("click", function (e) {
      e.stopPropagation();
      var path = "components/" + c.name + "/README.md";
      popover(gb, [h("div", { "class": "ds-label", text: X.guideline + " · " + c.name }),
        c.readme ? markdown(c.readme, path, true) : h("p", { "class": "ds-muted", text: X.noGuide }),
        S.editable ? h("div", { "class": "ds-row-btns" }, [btn(T.edit, "", function () { closePop(); state.sel = { kind: "component", name: c.name }; state.editing = path; render(); })]) : null], true);
    });
    var name = h("button", { type: "button", "class": "ds-tname", "aria-expanded": String(!!open), onclick: function () {
      state.sel = open ? null : { kind: "component", name: c.name }; state.editing = null; render();
    } }, [h("span", { "class": "ds-caret", html: kit.icon(open ? "caretDown" : "caretRight") }), h("code", { text: c.name })]);
    return h("tr", { "class": "ds-row" + (open ? " on" : ""), "data-component": c.name }, [
      h("td", { "class": "ds-cname" }, [name, c.marker.subtitle ? h("div", { "class": "ds-muted ds-sub", text: c.marker.subtitle }) : null,
        c.marker.page ? h("span", { "class": "ds-tag", text: "page" }) : null]),
      h("td", { "class": "ds-cprev" }, [prev, errEl]),
      h("td", { "class": "ds-act" }, [gb])]);
  }
  function componentDetail(c, dts) {
    var path = "components/" + c.name + "/README.md", editing = state.editing === path, props = propsOf(dts, c.name);
    var kids = [h("div", { "class": "ds-label", text: X.props })];
    if (!props.length) kids.push(h("p", { "class": "ds-muted", text: X.noProps }));
    else kids.push(h("table", { "class": "ds-table ds-props" }, [tableHead([{ text: T.name }, { text: X.propType }, { text: X.note }]),
      h("tbody", {}, props.map(function (p) {
        return h("tr", {}, [h("td", {}, [h("code", { text: p.name }), p.optional ? null : h("span", { "class": "ds-tag", text: X.required })]),
          h("td", {}, [h("code", { "class": "ds-ptype", text: p.type })]), h("td", { "class": "ds-muted", text: p.note || "" })]);
      }))]));
    kids.push(h("div", { "class": "ds-head ds-h2row" }, [h("div", { "class": "ds-label", style: "flex:1;margin:0", text: X.guideline }),
      S.editable && !editing ? btn(T.edit, "", function () { state.editing = path; render(); }) : null]));
    if (editing) kids.push(mdEditor(path, c.readme == null ? "# " + c.name + "\n\n" : c.readme));
    else kids.push(c.readme ? markdown(c.readme, path, true) : h("p", { "class": "ds-muted", text: X.noGuide }));
    return h("div", { "class": "ds-cdetail" }, kids);
  }

  // ---- Assets: a table per set, Name | Preview | Type · size, upload, delete, a new set
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
  function assetVis(f) {
    if (IMG.test(f.name)) return h("img", { src: kit.fileUrl(f.path), alt: f.name, loading: "lazy" });
    if (VIDEO.test(f.name)) return h("video", { src: kit.fileUrl(f.path), muted: true, controls: true, preload: "metadata" });
    if (FONT.test(f.name)) return h("span", { "class": "ds-aa", text: "Aa" });
    return h("span", { "class": "ds-ext", text: (f.name.split(".").pop() || "").toUpperCase() });
  }
  function assetView() {
    var kids = [heading(T.assets, S.editable ? [btn("+ " + X.newSet, "", function () { state.editing = "new-group"; render(); })] : [])];
    var all = assetPaths().filter(function (p) { return !/README\.md$/i.test(p); });
    if (all.length) kids.push(h("p", { "class": "ds-muted ds-storage", text: X.storage(all.length, fmtSize(all.reduce(function (s, p) { return s + sizeOf(p); }, 0))) }));
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
      var body = h("tbody", {}, g.files.map(function (f) {
        var del = S.editable && DELETABLE.test(f.path) ? iconBtn("trash", T.del) : null;
        if (del) del.addEventListener("click", function () { confirmMenu(del, X.delFile, function () { deleteFile(f.path); }); });
        return h("tr", { "class": "ds-row", "data-asset": f.path }, [h("td", { "class": "ds-cname" }, [h("code", { text: f.name })]),
          h("td", {}, [h("div", { "class": "ds-aprev ds-tile-" + g.tile }, [assetVis(f)])]),
          h("td", { "class": "ds-muted ds-nowrap", text: (f.name.split(".").pop() || "").toUpperCase() + " · " + fmtSize(sizeOf(f.path)) }),
          h("td", { "class": "ds-act" }, [iconBtn("download", T.download, function () { downloadFile(f.path); }), del])]);
      }));
      kids.push(h("section", { "class": "ds-group" }, [groupHead(g.name, g.files.length, tools),
        g.readme ? markdown(g.readme, "assets/" + g.name + "/README.md", true) : null,
        g.files.length ? h("div", { "class": "ds-table-wrap" }, [h("table", { "class": "ds-table" }, [tableHead([{ text: T.name }, { text: X.preview }, { text: X.sizeCol }, { cls: "ds-th-act" }]), body])])
          : h("p", { "class": "ds-muted", text: T.empty })]));
    });
    if (!groups.length && state.editing !== "new-group") kids.push(askBox("assets"));
    return kids;
  }
  var DELETABLE = /^(?!README\.md$)([A-Za-z0-9][A-Za-z0-9_-]{0,63}\.md|components\/[A-Za-z_][A-Za-z0-9_]{0,63}\/README\.md|assets\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.(png|jpe?g|gif|webp)|fonts\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.(woff2?|ttf|otf))$/;
  function deleteFile(p) {
    var files = {}; files[p] = null;
    var am = /^assets\/([^/]+)\/(.+)$/.exec(p), ix = S.index;
    if (am && ix.assetGroups && ix.assetGroups[am[1]]) {
      var rec = ix.assetGroups[am[1]];
      if (Array.isArray(rec.order)) rec.order = rec.order.filter(function (n) { return n !== am[2]; });
      if (rec.files && typeof rec.files === "object") delete rec.files[am[2]];
    }
    if (/^fonts\//.test(p) && S.tokens.type && Array.isArray(S.tokens.type.fonts)) {
      var next = JSON.parse(JSON.stringify(S.tokens)), base = p.slice(6);
      next.type.fonts = next.type.fonts.filter(function (f) { return !f || (f.file !== base && f.file !== p); });
      files["tokens.json"] = tokensText(next);
    }
    if (state.file === p) state.file = null;
    saveFiles(files, "deleted " + p).then(function () { render(); });
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

  // ---- Files: every file by kind, what made it, a preview, download and delete
  function downloadFile(p) { kit.download(p.replace(/^.*\//, ""), new Blob([bytesOf(p)], { type: mimeOf(p) }), mimeOf(p)); }
  function sizeOf(p) {
    var v = C.files[p];
    if (typeof v === "string" && v.slice(0, 5) === "data:") return Math.floor((v.length - v.indexOf(",") - 1) * 3 / 4);
    return new Blob([String(v)]).size;
  }
  function fmtSize(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function isGenerated(p) {
    if (/^api\//.test(p) || p === "manifest.json") return true;
    return p === "tokens.css" && /^\s*\/\*[^*]*generated from tokens\.json\s*\*\//.test(kit.fileText(p) || "");
  }
  function catOf(p) {
    if (/\.mdx?$/i.test(p)) return "docs";
    if (/\.css$/i.test(p)) return "css";
    if (/\.(m?js|ts|tsx|jsx)$/i.test(p)) return "js";
    if (/\.(json|csv|tsv|ya?ml)$/i.test(p)) return "data";
    if (FONT.test(p)) return "fonts";
    if (IMG.test(p) || VIDEO.test(p)) return "images";
    return "other";
  }
  function filesView() {
    var paths = Object.keys(C.files).sort(), by = {};
    paths.forEach(function (p) { (by[catOf(p)] = by[catOf(p)] || []).push(p); });
    if (state.file && C.files[state.file] == null) state.file = null;
    var cur = state.file || paths.filter(function (p) { return p === "README.md"; })[0] || paths[0];
    var list = h("div", { "class": "ds-fl" });
    ["docs", "css", "js", "data", "fonts", "images", "other"].forEach(function (k) {
      if (!by[k]) return;
      list.appendChild(h("div", { "class": "ds-fl-h", text: X.cats[k] + " · " + by[k].length }));
      by[k].forEach(function (p) {
        list.appendChild(h("button", { type: "button", "class": "ds-fl-i" + (p === cur ? " on" : ""), title: p, onclick: function () { state.file = p; render(); } }, [
          h("span", { "class": "ds-file-ic", html: kit.icon(k === "images" ? "image" : k === "data" ? "braces" : "file") }),
          h("code", { text: p }), isGenerated(p) ? h("span", { "class": "ds-tag", text: "gen" }) : null]));
      });
    });
    expBtn.classList.add("ds-exp");
    return [heading(T.files, [h("span", { "class": "ds-muted", text: paths.length + " · " + fmtSize(paths.reduce(function (s, p) { return s + sizeOf(p); }, 0)) }), expBtn]),
      h("div", { "class": "ds-fb" }, [list, cur ? filePane(cur) : h("div")])];
  }
  function filePane(p) {
    var gen = isGenerated(p), desc = gen ? X.generated : X.desc[p] || (/^components\/[^/]+\/README\.md$/.test(p) ? X.guideline : /^components\/[^/]+\/preview\.html$/.test(p) ? X.preview : "");
    var del = S.editable && !gen && DELETABLE.test(p) ? btn(T.del, "danger", null) : null;
    if (del) del.addEventListener("click", function () { confirmMenu(del, X.delFile, function () { deleteFile(p); }); });
    var body;
    if (IMG.test(p)) body = h("div", { "class": "ds-fp-img" }, [h("img", { src: kit.fileUrl(p), alt: p })]);
    else if (FONT.test(p)) body = h("div", { "class": "ds-spec-glyphs", style: "font-family:\"" + fontFamOf(p) + "\"", text: "Aa Bb Cc Dd Ee 0123456789" });
    else if (typeof C.files[p] === "string" && C.files[p].slice(0, 5) !== "data:") {
      var t = String(C.files[p]);
      body = /\.md$/i.test(p) ? markdown(t, p, false) : h("pre", { "class": "ds-fp-text", text: t.length > 200000 ? t.slice(0, 200000) + "\n…" : t });
    } else body = h("p", { "class": "ds-muted", text: X.noFilePreview });
    return h("div", { "class": "ds-fp" }, [h("div", { "class": "ds-fp-h" }, [h("div", { "class": "ds-fp-t" }, [h("code", { text: p }),
      h("span", { "class": "ds-muted", text: [desc, fmtSize(sizeOf(p))].filter(Boolean).join(" · ") })]),
      btn(T.download, "", function () { downloadFile(p); }), del]), h("div", { "class": "ds-fp-b" }, [body])]);
  }
  function fontFamOf(p) { var f = S.m.type.fonts.filter(function (x) { return x.file === p; })[0]; return f ? f.family : "inherit"; }

  // ------------------------------------------------------------------ render
  function render() {
    frames = {}; closePop();
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
