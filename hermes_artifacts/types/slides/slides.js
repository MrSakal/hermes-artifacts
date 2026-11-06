/* hermes-artifacts Slides runtime.
 *
 * Content (the artifact's files):
 *   deck.json          {title, order: [slide ids], cover?: id, faces?: {key: {family, href}}, slides?: [layout defs]}
 *   slides/<id>.html   exactly one <section id="<id>" style="..."> on a 1920x1080 canvas; speaker
 *                      notes in one <aside> (its last child); data-transition="fade|push|magic" on the section,
 *                      data-build-in="fade|rise|pop" on position:absolute children, data-key to pair
 *                      elements across slides for magic move.
 *   img/<name>         images (the editor uploads them here).
 *
 * An editor like a slide app's: click to select (shift for more), drag to move with snapping guides,
 * handles to resize, double-click to edit text, insert text / images / shapes, add, duplicate, delete
 * and reorder slides, undo and redo, speaker notes. Every change saves itself as a new version.
 * Present full screen or with the presenter view (timer, clock, next slide, notes); magic move between
 * slides. Export to PDF (with a text layer), PPTX, PNG and HTML.
 */
(function () {
  "use strict";
  var kit = window.kit, h = kit.h, C = kit.content;
  var W = 1920, H = 1080;
  var L = /^hu\b/i.test(kit.content.lang || navigator.language || "") ? "hu" : "en";
  var T = {
    en: { present: "Present", presenter: "Presenter view", grid: "All slides", notes: "Notes", exp: "Export", pdf: "PDF", pptx: "PowerPoint (.pptx)",
      png: "This slide (PNG)", html: "Web page (HTML)", save: "Save", saving: "Saving…", saved: "Saved", notSaved: "Not saved",
      conflict: "Changed meanwhile: the new version loads", noSave: "Can't save here", editHint: "Click to select · double-click text to edit",
      building: "Building…", bad: "deck.json is missing or not valid JSON.", empty: "This deck has no slides yet.",
      noLib: "The export library didn't load (open the deck in Hermes Desktop)", of: "of", nonotes: "No notes for this slide.",
      insert: "Insert", text: "Text box", image: "Image…", rect: "Rectangle", ellipse: "Ellipse", newSlide: "New slide",
      dup: "Duplicate", del: "Delete", up: "Move up", down: "Move down", front: "Bring to front", back: "Send to back",
      bigger: "Larger text", smaller: "Smaller text", align: "Align", bold: "Bold", italic: "Italic", underline: "Underline",
      ask: "Ask Hermes", askPh: "Ask Hermes about this…", sent: "Sent to the chat", undo: "Undo", redo: "Redo",
      next: "Next", end: "End of the deck", pause: "Pause", reset: "Reset timer", exitP: "Exit", notesPh: "Speaker notes…",
      tooBig: "Images up to 8 MB", lastSlide: "A deck keeps at least one slide", textSize: "Notes text size",
      phTitle: "Title", phSub: "Subtitle", phText: "Text", phPoints: ["First point", "Second point", "Third point"],
      phSection: "Section", phQuote: "A sentence worth repeating.", phBy: "Someone", phMetric: "Metric", phClosing: "Thank you",
      phHeading: "Heading", phKicker: "Kicker",
      lTitle: "Title", lSection: "Section", lBullets: "Bullets", lKpis: "Big numbers", lTwo: "Two columns", lQuote: "Quote",
      lClosing: "Closing", lBlank: "Blank",
      about: function (n, id, title, label) { return "(slide " + n + " “" + title + "”, id " + id + (label ? ", element “" + label + "”" : "") + ")"; } },
    hu: { present: "Vetítés", presenter: "Előadói nézet", grid: "Összes dia", notes: "Jegyzetek", exp: "Exportálás", pdf: "PDF", pptx: "PowerPoint (.pptx)",
      png: "Ez a dia (PNG)", html: "Weboldal (HTML)", save: "Mentés", saving: "Mentés…", saved: "Elmentve", notSaved: "Nincs mentve",
      conflict: "Közben megváltozott: betöltöm az új verziót", noSave: "Itt nem lehet menteni", editHint: "Kattints a kijelöléshez · dupla katt a szövegre",
      building: "Készül…", bad: "A deck.json hiányzik, vagy nem érvényes JSON.", empty: "Ebben a diasorban még nincs dia.",
      noLib: "Az export könyvtár nem töltődött be (nyisd meg a Hermes Desktopban)", of: "/", nonotes: "Ehhez a diához nincs jegyzet.",
      insert: "Beszúrás", text: "Szövegdoboz", image: "Kép…", rect: "Téglalap", ellipse: "Ellipszis", newSlide: "Új dia",
      dup: "Másolat", del: "Törlés", up: "Feljebb", down: "Lejjebb", front: "Előre hozás", back: "Hátra küldés",
      bigger: "Nagyobb betű", smaller: "Kisebb betű", align: "Igazítás", bold: "Félkövér", italic: "Dőlt", underline: "Aláhúzott",
      ask: "Kérdezd a Hermest", askPh: "Kérdezd a Hermest erről…", sent: "Elküldve a chatbe", undo: "Visszavonás", redo: "Mégis",
      next: "Következő", end: "A diasor vége", pause: "Szünet", reset: "Időmérő nullázása", exitP: "Kilépés", notesPh: "Előadói jegyzet…",
      tooBig: "Legfeljebb 8 MB-os kép", lastSlide: "Legalább egy dia marad", textSize: "Jegyzet betűmérete",
      phTitle: "Cím", phSub: "Alcím", phText: "Szöveg", phPoints: ["Első pont", "Második pont", "Harmadik pont"],
      phSection: "Fejezet", phQuote: "Egy mondat, amit érdemes megismételni.", phBy: "Valaki", phMetric: "Mutató", phClosing: "Köszönöm",
      phHeading: "Alcím", phKicker: "Felcím",
      lTitle: "Címdia", lSection: "Fejezet", lBullets: "Felsorolás", lKpis: "Nagy számok", lTwo: "Két hasáb", lQuote: "Idézet",
      lClosing: "Zárás", lBlank: "Üres",
      about: function (n, id, title, label) { return "(" + n + ". dia „" + title + "”, id " + id + (label ? ", elem: „" + label + "”" : "") + ")"; } }
  }[L];

  var deck = kit.json("deck.json", null);
  var bar = document.getElementById("sl-bar"), rail = document.getElementById("sl-rail");
  var stageWrap = document.getElementById("sl-stage-wrap"), stage = document.getElementById("sl-stage");
  var notesEl = document.getElementById("sl-notes");
  bar.className = "kit-bar";
  if (!deck) { document.body.appendChild(h("div", { "class": "kit-empty", text: T.bad })); return; }
  var editable = !C.thumb;

  // ------------------------------------------------------------------ slides
  var DROP = "script,iframe,frame,frameset,object,embed,link,meta,base,form,portal,style";
  function clean(html, id) {
    var tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    var sec = tpl.content.querySelector("section");
    if (!sec) { sec = document.createElement("section"); sec.id = id; }
    sec.querySelectorAll(DROP).forEach(function (n) { n.remove(); });
    [sec].concat(Array.prototype.slice.call(sec.querySelectorAll("*"))).forEach(function (el) {
      for (var j = el.attributes.length - 1; j >= 0; j--) {
        var a = el.attributes[j];
        if (/^on/i.test(a.name) || a.name === "contenteditable" || (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
      }
      if (el.tagName === "IMG") {
        var path = el.getAttribute("data-src-path") || el.getAttribute("src") || "";
        var u = kit.fileUrl(path);
        if (u) { el.setAttribute("data-src-path", path); el.setAttribute("src", u); }
      }
      if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
    });
    sec.id = id;
    return sec;
  }

  var ID = /^[A-Za-z0-9_-]{1,64}$/;
  var order = (deck.order || []).filter(function (id) { return ID.test(id); });
  var fileIds = {}; // slides that have their own HTML file in the version on the server
  Object.keys(C.files).forEach(function (p) {
    var m = /^slides\/([A-Za-z0-9_-]{1,64})\.html$/.exec(p);
    if (m) { fileIds[m[1]] = true; if (order.indexOf(m[1]) < 0) order.push(m[1]); }
  });
  // A slide is its own HTML file, or a layout described in deck.json "slides" (drawn by layouts.js).
  // An edit of a layout slide saves it as its HTML file, which then takes precedence.
  var defs = {};
  /** The deck's theme; without one, Hermes' own colors and font (once the host sends them). */
  var dsTheme = null; // the deck's design system (deck.designSystem, else the user's default), as a theme
  function deckTheme() {
    if (deck.theme) return deck.theme;
    if (dsTheme) return dsTheme;
    var t = kit.hostTheme && kit.hostTheme();
    if (!t) return null;
    return { mode: t.mode, bg: t.bg, surface: t.panel, fg: t.fg, muted: t.muted, line: t.line, accent: t.accent,
      font: t.font, headingFont: t.font };
  }
  (Array.isArray(deck.slides) ? deck.slides : []).forEach(function (d) {
    if (d && ID.test(d.id || "")) { defs[d.id] = d; if (order.indexOf(d.id) < 0) order.push(d.id); }
  });
  var slides = order.filter(function (id) { return fileIds[id] || defs[id]; }).map(function (id) {
    var html = kit.fileText("slides/" + id + ".html"), layout = null;
    if (html == null && window.slideLayout) { html = window.slideLayout(defs[id], deckTheme()); layout = defs[id].layout || "bullets"; }
    return { id: id, sec: clean(html, id), layout: layout };
  });
  function notesOf(s) { var a = s.sec.querySelector("aside"); return a ? a.textContent.trim() : ""; }
  function titleOf(s) { var t = s.sec.querySelector("h1,h2,h3") || s.sec.querySelector("p"); return t ? t.textContent.trim().slice(0, 60) : s.id; }

  function serialize(s) {
    var sec = s.sec.cloneNode(true);
    sec.querySelectorAll("[contenteditable]").forEach(function (n) { n.removeAttribute("contenteditable"); });
    sec.querySelectorAll("img").forEach(function (img) {
      // Keep the artifact's own file path instead of the inlined data: URI.
      var orig = img.getAttribute("data-src-path");
      if (orig) { img.setAttribute("src", orig); img.removeAttribute("data-src-path"); }
    });
    return sec.outerHTML + "\n";
  }
  // What the server has: a change is whatever differs from this (autosave writes only that).
  var saved = { order: slides.map(function (s) { return s.id; }), html: {} };
  slides.forEach(function (s) { saved.html[s.id] = serialize(s); });

  // Fonts the deck names (Google Fonts css2 links only).
  Object.keys(deck.faces || {}).forEach(function (k) {
    var f = deck.faces[k];
    if (f && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(f.href || "")) document.head.appendChild(h("link", { rel: "stylesheet", href: f.href }));
  });

  var cur = 0;
  var start = location.hash.match(/^#slide-(\d+)$/);
  if (start) cur = Math.min(slides.length - 1, Math.max(0, +start[1] - 1));
  if (C.thumb && deck.cover) cur = Math.max(0, slides.findIndex(function (s) { return s.id === deck.cover; }));

  function canvasFor(s, scale, live) {
    var c = h("div", { "class": "sl-canvas" });
    c.style.transform = "scale(" + scale + ")";
    var sec = live ? s.sec : s.sec.cloneNode(true);
    if (!live) sec.querySelectorAll("[contenteditable]").forEach(function (n) { n.removeAttribute("contenteditable"); });
    c.appendChild(sec);
    return c;
  }

  // ------------------------------------------------------------------ main view
  var clip = h("div", { "class": "sl-clip" }), ov = h("div", { id: "sl-ov" });
  stage.append(clip, ov);
  var SC = 1;
  function fit() {
    var r = stageWrap.getBoundingClientRect(), pad = C.thumb ? 0 : 48;
    var sc = Math.min((r.width - pad) / W, (r.height - pad) / H);
    if (!(sc > 0)) sc = 0.3;
    SC = sc;
    stage.style.width = W * sc + "px"; stage.style.height = H * sc + "px";
    var cv = clip.firstChild;
    if (cv) cv.style.transform = "scale(" + sc + ")";
    if (sel && sel.length) drawSel();
    return sc;
  }
  function curSec() { return slides[cur] && slides[cur].sec; }

  function show(i) {
    if (!slides.length) return;
    stopEdit(); sel = []; drawSel();
    cur = Math.max(0, Math.min(slides.length - 1, i));
    clip.replaceChildren(canvasFor(slides[cur], 1, true));
    fit();
    rail.querySelectorAll(".sl-thumb").forEach(function (b, j) { b.classList.toggle("on", j === cur); });
    var on = rail.querySelectorAll(".sl-thumb")[cur];
    if (on) on.scrollIntoView({ block: "nearest" });
    counter.textContent = (cur + 1) + " " + T.of + " " + slides.length;
    if (notesTa) notesTa.value = notesOf(slides[cur]); else notesEl.textContent = notesOf(slides[cur]) || T.nonotes;
    drawTools();
    sendView();
    try { history.replaceState(null, "", "#slide-" + (cur + 1)); } catch (e) {}
  }

  var dragFrom = null, dropLine = h("div", { "class": "sl-drop", hidden: true });
  function thumb(s, i, caption) {
    var box = h("div", { "class": "sl-box" });
    var b = h("button", { "class": "sl-thumb", type: "button", title: titleOf(s), onclick: function () { closeGrid(); show(i); } },
      [caption ? null : h("span", { "class": "sl-num", text: String(i + 1) }), box,
       caption ? h("span", { "class": "sl-cap", text: (i + 1) + ". " + titleOf(s) }) : null]);
    if (editable && !caption) {
      b.draggable = true;
      b.addEventListener("dragstart", function (e) { dragFrom = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "slide " + i); });
      b.addEventListener("dragend", function () { dragFrom = null; dropLine.hidden = true; });
      b.addEventListener("contextmenu", function (e) { e.preventDefault(); if (i !== cur) show(i); slideMenu(b, i); });
    }
    requestAnimationFrame(function () {
      var w = box.clientWidth || 160;
      box.appendChild(canvasFor(s, w / W, false));
    });
    return b;
  }
  var addBtn = h("button", { "class": "sl-add", type: "button", title: T.newSlide, "aria-label": T.newSlide, html: kit.icon("plus"),
    onclick: function () { layoutMenu(addBtn, cur); } });
  function buildRail() {
    rail.replaceChildren.apply(rail, slides.map(function (s, i) { return thumb(s, i, false); }).concat(editable ? [addBtn, dropLine] : []));
    rail.querySelectorAll(".sl-thumb").forEach(function (b, j) { b.classList.toggle("on", j === cur); });
  }
  var thumbTimer = null;
  function refreshThumb() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(function () {
      var b = rail.querySelectorAll(".sl-thumb")[cur], s = slides[cur];
      if (!b || !s) return;
      var box = b.querySelector(".sl-box");
      box.replaceChildren(canvasFor(s, (box.clientWidth || 160) / W, false));
      b.title = titleOf(s);
    }, 250);
  }
  function dropIndex(y) {
    var th = rail.querySelectorAll(".sl-thumb");
    for (var k = 0; k < th.length; k++) { var r = th[k].getBoundingClientRect(); if (y < r.top + r.height / 2) return k; }
    return th.length;
  }
  rail.addEventListener("dragover", function (e) {
    if (dragFrom == null) return;
    e.preventDefault();
    var th = rail.querySelectorAll(".sl-thumb"), at = dropIndex(e.clientY), ref = th[Math.min(at, th.length - 1)];
    var rr = rail.getBoundingClientRect(), r = ref.getBoundingClientRect();
    dropLine.hidden = false;
    dropLine.style.top = (at < th.length ? r.top - 6 : r.bottom + 2) - rr.top + rail.scrollTop + "px";
  });
  rail.addEventListener("drop", function (e) {
    if (dragFrom == null) return;
    e.preventDefault();
    moveSlide(dragFrom, dropIndex(e.clientY));
    dragFrom = null; dropLine.hidden = true;
  });

  var gridEl = null;
  function openGrid() {
    if (gridEl) return closeGrid();
    select([]);
    gridEl = h("div", { id: "sl-grid" }, slides.map(function (s, i) { return thumb(s, i, true); }));
    document.body.appendChild(gridEl);
    sendView();
  }
  function closeGrid() { if (gridEl) { gridEl.remove(); gridEl = null; } }

  // ------------------------------------------------------------------ view context (with the next chat message)
  function itemIndex(el) { var sec = el.parentElement; return sec ? Array.prototype.indexOf.call(sec.children, el) : -1; }
  function selectorOf(el) { return el ? "#" + el.parentElement.id + " > :nth-child(" + (itemIndex(el) + 1) + ")" : null; }
  function labelOf(el) {
    var t = el.textContent.replace(/\s+/g, " ").trim().slice(0, 60);
    if (t) return t;
    if (el.tagName === "IMG") return el.getAttribute("alt") || el.getAttribute("data-src-path") || "image";
    return el.getAttribute("data-shape") || el.getAttribute("aria-label") || el.tagName.toLowerCase();
  }
  function sendView() {
    kit.view(function () {
      var i = pres ? pres.i : cur, s = slides[i];
      var info = (pres ? [] : sel).map(function (el) { return { kind: el.tagName.toLowerCase(), label: labelOf(el), selector: selectorOf(el) }; });
      return { mode: pres ? (pres.presenter ? "presenter" : "present") : gridEl ? "grid" : "edit", slideId: s ? s.id : null,
        slideTitle: s ? titleOf(s) : null, slideIndex: s ? i + 1 : 0, slideCount: slides.length,
        editingText: !!editing, dirty: pending, selected: info.map(function (x) { return x.label; }), selection: info };
    });
  }

  // ------------------------------------------------------------------ saving (every change, as a new version)
  var saveTimer = null, inFlight = false, again = false, pending = false, seq = 0, stopped = false, uploads = {};
  function changed() {
    pending = true; seq++;
    clearTimeout(saveTimer);
    if (!stopped) saveTimer = setTimeout(save, 1200);
    refreshThumb(); sendView();
  }
  function nextDeck(ids) {
    var d = JSON.parse(JSON.stringify(deck));
    d.order = ids;
    if (Array.isArray(d.slides)) d.slides = d.slides.filter(function (x) { return x && ids.indexOf(x.id) >= 0; });
    return d;
  }
  function diff() {
    var files = {}, html = {}, ids = slides.map(function (s) { return s.id; }), all = "";
    slides.forEach(function (s) {
      var x = serialize(s);
      all += x;
      if (x !== saved.html[s.id]) { files["slides/" + s.id + ".html"] = x; html[s.id] = x; }
    });
    var removed = saved.order.filter(function (id) { return ids.indexOf(id) < 0; });
    removed.forEach(function (id) { if (fileIds[id]) files["slides/" + id + ".html"] = null; });
    var up = Object.keys(uploads).filter(function (p) { return all.indexOf('"' + p + '"') >= 0; });
    up.forEach(function (p) { files[p] = uploads[p]; });
    var next = null;
    if (ids.join("\n") !== saved.order.join("\n") || (deck.slides || []).some(function (d) { return d && ids.indexOf(d.id) < 0; })) {
      next = nextDeck(ids);
      files["deck.json"] = JSON.stringify(next, null, 2);
    }
    return { files: files, html: html, order: ids, removed: removed, uploads: up, deck: next };
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
    if (!Object.keys(d.files).length) { pending = false; status(""); return; }
    if (!window.hermes || !window.hermes.save) { status("failed"); return; }
    inFlight = true; status("saving");
    window.hermes.save(d.files, C.version).then(function (r) {
      if (r && r.conflict) { stopped = true; status("failed"); kit.toast(T.conflict); return; }
      C.version = r.version;
      Object.keys(d.html).forEach(function (id) { saved.html[id] = d.html[id]; fileIds[id] = true; });
      d.removed.forEach(function (id) { delete saved.html[id]; delete fileIds[id]; });
      saved.order = d.order;
      if (d.deck) deck = d.deck;
      d.uploads.forEach(function (p) { delete uploads[p]; });
      if (seq === at) pending = false;
      status("saved");
      sendView();
    }).catch(function () { status("failed"); }).then(function () {
      inFlight = false;
      if (again || (pending && seq !== at)) { again = false; save(); }
    });
  }

  // ------------------------------------------------------------------ undo
  var undos = [], redos = [];
  function snap() {
    var st = { order: [], html: {}, layout: {}, cur: cur };
    slides.forEach(function (s) { st.order.push(s.id); st.html[s.id] = serialize(s); st.layout[s.id] = s.layout; });
    return st;
  }
  function checkpoint() { undos.push(snap()); if (undos.length > 100) undos.shift(); redos = []; }
  function restore(st) {
    slides = st.order.map(function (id) { return { id: id, sec: clean(st.html[id], id), layout: st.layout[id] }; });
    buildRail(); show(st.cur); changed();
  }
  function undo() { if (!undos.length) return; stopEdit(); redos.push(snap()); restore(undos.pop()); }
  function redo() { if (!redos.length) return; stopEdit(); undos.push(snap()); restore(redos.pop()); }

  // ------------------------------------------------------------------ slides: add, duplicate, delete, move
  function newId() {
    var id;
    do { id = "s-" + Math.random().toString(36).slice(2, 8); } while (slides.some(function (s) { return s.id === id; }) || defs[id] || fileIds[id]);
    return id;
  }
  var LAYOUTS = [
    { label: T.lTitle, def: function () { return { layout: "title", kicker: T.phKicker, title: T.phTitle, subtitle: T.phSub }; } },
    { label: T.lSection, def: function () { return { layout: "section", number: ("0" + (cur + 2)).slice(-2), title: T.phSection }; } },
    { label: T.lBullets, def: function () { return { layout: "bullets", title: T.phTitle, bullets: T.phPoints.slice() }; } },
    { label: T.lKpis, def: function () { return { layout: "kpis", title: T.phTitle, items: [1, 2, 3].map(function (n) { return { label: T.phMetric + " " + n, value: String(n * 12), delta: "+" + n * 4 + "%" }; }) }; } },
    { label: T.lTwo, def: function () { return { layout: "two-col", title: T.phTitle, left: { heading: T.phHeading, accent: true, bullets: T.phPoints.slice(0, 2) }, right: { heading: T.phHeading, text: T.phText } }; } },
    { label: T.lQuote, def: function () { return { layout: "quote", quote: T.phQuote, by: T.phBy }; } },
    { label: T.lClosing, def: function () { return { layout: "closing", title: T.phClosing }; } },
    { label: T.lBlank, def: function () { return { layout: "blank" }; } }
  ];
  function layoutMenu(anchor, after) {
    kit.menu(anchor, LAYOUTS.map(function (x) { return { label: x.label, onClick: function () { addSlide(x.def(), after); } }; }));
  }
  function addSlide(def, after) {
    checkpoint();
    def.id = newId();
    slides.splice(after + 1, 0, { id: def.id, sec: clean(window.slideLayout(def, deckTheme()), def.id), layout: null });
    buildRail(); show(after + 1); changed();
  }
  function dupSlide(i) {
    checkpoint();
    var id = newId();
    slides.splice(i + 1, 0, { id: id, sec: clean(serialize(slides[i]), id), layout: null });
    buildRail(); show(i + 1); changed();
  }
  function delSlide(i) {
    if (slides.length <= 1) return kit.toast(T.lastSlide);
    checkpoint();
    slides.splice(i, 1);
    buildRail(); show(Math.min(i, slides.length - 1)); changed();
  }
  function moveSlide(from, to) {
    if (to > from) to--;
    if (to === from || to < 0 || to >= slides.length) return;
    checkpoint();
    slides.splice(to, 0, slides.splice(from, 1)[0]);
    buildRail(); show(to); changed();
  }
  function slideMenu(anchor, i) {
    kit.menu(anchor, [
      { label: T.newSlide, onClick: function () { layoutMenu(anchor, i); } },
      { label: T.dup, onClick: function () { dupSlide(i); } },
      { label: T.up, onClick: function () { moveSlide(i, i - 1); } },
      { label: T.down, onClick: function () { moveSlide(i, i + 2); } },
      { label: T.del, onClick: function () { delSlide(i); } }
    ]);
  }

  // ------------------------------------------------------------------ elements: select, move, resize
  var sel = [], editing = null, editSnap = false;
  var TEXT = "h1,h2,h3,h4,h5,h6,p,li,td,th,span,b,i,u,a,div,blockquote";
  function hasOwnText(el) { return Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); }); }
  function isTextBox(el) { return /^(H[1-6]|P|UL|OL|BLOCKQUOTE|TABLE)$/.test(el.tagName) || (el.tagName === "DIV" && hasOwnText(el) && !el.children.length); }
  function itemsOf(sec) {
    return Array.prototype.filter.call(sec ? sec.children : [], function (el) { return el.tagName !== "ASIDE" && !el.hasAttribute("data-deco"); });
  }
  function itemOf(t) {
    var sec = curSec();
    while (t && t !== sec && t.parentElement !== sec) t = t.parentElement;
    return t && t !== sec && t.tagName !== "ASIDE" && !t.hasAttribute("data-deco") ? t : null;
  }
  function rectOf(el) {
    var o = curSec().getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: (r.left - o.left) / SC, y: (r.top - o.top) / SC, w: r.width / SC, h: r.height / SC };
  }
  function union(bs) {
    var x = Math.min.apply(null, bs.map(function (b) { return b.x; })), y = Math.min.apply(null, bs.map(function (b) { return b.y; }));
    return { x: x, y: y, w: Math.max.apply(null, bs.map(function (b) { return b.x + b.w; })) - x, h: Math.max.apply(null, bs.map(function (b) { return b.y + b.h; })) - y };
  }
  var R = Math.round;
  /** Free layout: every element of the slide gets its own position and size (as drawn now), so moving
   *  one doesn't reflow the others. Done once per slide, on its first move. */
  function pin(sec) {
    var items = itemsOf(sec).filter(function (el) { return !(el.style.position === "absolute" && el.style.left && el.style.top); });
    if (!items.length) return;
    var boxes = items.map(rectOf);
    items.forEach(function (el, k) {
      var b = boxes[k], st = el.style;
      st.position = "absolute"; st.left = R(b.x) + "px"; st.top = R(b.y) + "px"; st.width = R(b.w) + "px";
      st.right = st.bottom = "auto"; st.margin = "0"; st.boxSizing = "border-box"; st.flex = "none";
      if (!isTextBox(el)) st.height = R(b.h) + "px";
    });
  }
  function select(list) {
    sel = list.filter(Boolean);
    drawSel(); drawTools(); sendView();
  }
  var HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  function drawSel(lines) {
    ov.replaceChildren();
    if (!editable || pres) return;
    sel = sel.filter(function (el) { return el.isConnected && el.parentElement === curSec(); });
    sel.forEach(function (el) {
      var b = rectOf(el);
      ov.appendChild(h("div", { "class": "sl-selbox" + (el === editing || (editing && el.contains(editing)) ? " is-editing" : ""),
        style: "left:" + b.x * SC + "px;top:" + b.y * SC + "px;width:" + b.w * SC + "px;height:" + b.h * SC + "px" }));
    });
    if (sel.length === 1 && !editing) {
      var b = rectOf(sel[0]);
      HANDLES.forEach(function (hd) {
        var x = /w/.test(hd) ? b.x : /e/.test(hd) ? b.x + b.w : b.x + b.w / 2, y = /n/.test(hd) ? b.y : /s/.test(hd) ? b.y + b.h : b.y + b.h / 2;
        ov.appendChild(h("div", { "class": "sl-handle", "data-h": hd, style: "left:" + x * SC + "px;top:" + y * SC + "px;cursor:" + hd + "-resize" }));
      });
    }
    (lines || []).forEach(function (ln) {
      ov.appendChild(h("div", { "class": "sl-guide", style: ln.x != null ? "left:" + ln.x * SC + "px;top:0;width:1px;height:100%" : "top:" + ln.y * SC + "px;left:0;height:1px;width:100%" }));
    });
    placeTools();
  }

  function targets(skip) {
    var xs = [0, W / 2, W], ys = [0, H / 2, H];
    itemsOf(curSec()).forEach(function (el) {
      if (skip.indexOf(el) >= 0) return;
      var b = rectOf(el);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    });
    return { xs: xs, ys: ys };
  }
  function nearest(vals, cands, tol) {
    var best = null;
    vals.forEach(function (v) { cands.forEach(function (c) { var d = c - v; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, at: c }; }); });
    return best;
  }

  function startDrag(e, mode, hd) {
    var x0 = e.clientX, y0 = e.clientY, started = false, items = sel.slice(), boxes, u0, tg;
    var img = items.length === 1 && /^(IMG|SVG)$/i.test(items[0].tagName);
    function move(ev) {
      var dx = (ev.clientX - x0) / SC, dy = (ev.clientY - y0) / SC;
      if (!started) {
        if (Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
        started = true; checkpoint(); pin(curSec());
        boxes = items.map(rectOf); u0 = union(boxes); tg = targets(items);
      }
      var tol = 6 / SC, lines = [], snapOn = !ev.altKey;
      if (mode === "move") {
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        var u = { x: u0.x + dx, y: u0.y + dy };
        if (snapOn) {
          var sx = nearest([u.x, u.x + u0.w / 2, u.x + u0.w], tg.xs, tol), sy = nearest([u.y, u.y + u0.h / 2, u.y + u0.h], tg.ys, tol);
          if (sx) { dx += sx.d; lines.push({ x: sx.at }); }
          if (sy) { dy += sy.d; lines.push({ y: sy.at }); }
        }
        items.forEach(function (el, k) { el.style.left = R(boxes[k].x + dx) + "px"; el.style.top = R(boxes[k].y + dy) + "px"; });
      } else {
        var b = boxes[0], x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
        if (/w/.test(hd)) x1 += dx; if (/e/.test(hd)) x2 += dx; if (/n/.test(hd)) y1 += dy; if (/s/.test(hd)) y2 += dy;
        var corner = hd.length === 2, keep = corner && (img !== ev.shiftKey);
        if (snapOn && !keep) {
          var ex = /w/.test(hd) ? nearest([x1], tg.xs, tol) : /e/.test(hd) ? nearest([x2], tg.xs, tol) : null;
          var ey = /n/.test(hd) ? nearest([y1], tg.ys, tol) : /s/.test(hd) ? nearest([y2], tg.ys, tol) : null;
          if (ex) { if (/w/.test(hd)) x1 += ex.d; else x2 += ex.d; lines.push({ x: ex.at }); }
          if (ey) { if (/n/.test(hd)) y1 += ey.d; else y2 += ey.d; lines.push({ y: ey.at }); }
        }
        var w = Math.max(24, x2 - x1), hh = Math.max(24, y2 - y1);
        if (keep) {
          var ratio = b.w / b.h;
          if (Math.abs(w - b.w) / b.w > Math.abs(hh - b.h) / b.h) hh = w / ratio; else w = hh * ratio;
        }
        var nx = /w/.test(hd) ? b.x + b.w - w : b.x, ny = /n/.test(hd) ? b.y + b.h - hh : b.y;
        var st = items[0].style;
        st.left = R(nx) + "px"; st.top = R(ny) + "px"; st.width = R(w) + "px";
        if (/[ns]/.test(hd) || !isTextBox(items[0])) st.height = R(hh) + "px";
      }
      drawSel(lines);
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (started) { drawSel(); changed(); }
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (editable) {
    clip.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || pres) return;
      if (editing && editing.contains(e.target)) return; // placing the caret
      stopEdit();
      var it = itemOf(e.target);
      if (!it) { select([]); return; }
      e.preventDefault();
      if (e.shiftKey) { select(sel.indexOf(it) >= 0 ? sel.filter(function (x) { return x !== it; }) : sel.concat([it])); return; }
      if (sel.indexOf(it) < 0) select([it]);
      startDrag(e, "move");
    });
    ov.addEventListener("pointerdown", function (e) {
      var hd = e.target.getAttribute && e.target.getAttribute("data-h");
      if (!hd || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      startDrag(e, "resize", hd);
    });
    clip.addEventListener("dblclick", function (e) {
      var it = itemOf(e.target);
      if (!it) return;
      if (sel.indexOf(it) < 0) select([it]);
      startEdit(textIn(it, e.target), e);
    });
    clip.addEventListener("beforeinput", function () { if (!editSnap) { checkpoint(); editSnap = true; } });
    clip.addEventListener("input", function () { drawSel(); changed(); });
    clip.addEventListener("keydown", function (e) { if (e.key === "Escape" && editing) { var it = itemOf(editing); stopEdit(); select(it ? [it] : []); e.stopPropagation(); } }, true);
  }

  // ------------------------------------------------------------------ text editing in place
  function textIn(item, target) {
    var el = target && target.closest && target.closest(TEXT);
    if (!el || !item.contains(el)) el = item;
    if (/^(LI|TD|TH|SPAN|B|I|U|A)$/.test(el.tagName) && el.parentElement) {
      // Lists and tables are edited whole (Enter adds an item), runs with their paragraph.
      var up = el.closest("ul,ol,table,p,h1,h2,h3,h4,h5,h6");
      if (up && item.contains(up)) el = up;
    }
    if (!el.textContent.trim() && el === item) return null;
    if (el === item && !hasOwnText(el) && !/^(UL|OL|TABLE)$/.test(el.tagName)) {
      var first = Array.prototype.find.call(el.querySelectorAll(TEXT), function (n) { return hasOwnText(n); });
      if (first) el = first;
    }
    return el;
  }
  function startEdit(el, e, selectAll) {
    if (!el) return;
    stopEdit();
    editing = el; editSnap = false;
    el.setAttribute("contenteditable", "true");
    el.focus();
    var s = window.getSelection();
    if (selectAll) { var r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); }
    else if (e && document.caretRangeFromPoint) { var c = document.caretRangeFromPoint(e.clientX, e.clientY); if (c) { s.removeAllRanges(); s.addRange(c); } }
    drawSel(); drawTools(); sendView();
  }
  function stopEdit() {
    if (!editing) return;
    editing.removeAttribute("contenteditable");
    editing = null;
    try { window.getSelection().removeAllRanges(); } catch (e) {}
    drawSel(); drawTools();
  }

  // ------------------------------------------------------------------ element toolbar
  var tools = h("div", { "class": "sl-tools", hidden: true, role: "toolbar" });
  document.body.appendChild(tools);
  function tbtn(icon, title, fn, on) {
    var b = h("button", { type: "button", "class": "kit-btn" + (on ? " is-on" : ""), title: title, "aria-label": title, html: kit.icon(icon) });
    b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep the text selection
    b.addEventListener("click", fn);
    return b;
  }
  function sep() { return h("span", { "class": "sl-sep" }); }
  function drawTools() {
    if (!editable || pres || gridEl || !sel.length) { tools.hidden = true; return; }
    var texty = sel.some(function (el) { return el.textContent.trim(); });
    var kids = [];
    if (editing) {
      kids.push(tbtn("bold", T.bold, function () { document.execCommand("bold"); }),
        tbtn("italic", T.italic, function () { document.execCommand("italic"); }),
        tbtn("underline", T.underline, function () { document.execCommand("underline"); }), sep());
    }
    if (texty) {
      var al = (sel[0].style.textAlign || getComputedStyle(sel[0]).textAlign);
      kids.push(tbtn("fontDown", T.smaller, function () { fontScale(1 / 1.12); }), tbtn("fontUp", T.bigger, function () { fontScale(1.12); }),
        tbtn(al === "center" ? "alignC" : al === "right" || al === "end" ? "alignR" : "alignL", T.align, cycleAlign), sep());
    }
    kids.push(tbtn("front", T.front, function () { restack(true); }), tbtn("back", T.back, function () { restack(false); }),
      tbtn("copy", T.dup, duplicate), tbtn("trash", T.del, removeSel), sep());
    var askB = tbtn("sparkle", T.ask, askAbout);
    askB.appendChild(h("span", { text: T.ask }));
    kids.push(askB);
    tools.replaceChildren.apply(tools, kids);
    tools.hidden = false;
    placeTools();
  }
  function placeTools() {
    if (tools.hidden || !sel.length) return;
    var sr = stage.getBoundingClientRect(), u = union(sel.map(rectOf));
    var top = sr.top + u.y * SC - tools.offsetHeight - 10;
    if (top < 50) top = sr.top + (u.y + u.h) * SC + 10;
    tools.style.top = Math.max(50, Math.min(innerHeight - tools.offsetHeight - 8, top)) + "px";
    tools.style.left = Math.max(8, Math.min(innerWidth - tools.offsetWidth - 8, sr.left + u.x * SC)) + "px";
  }
  function fontScale(f) {
    checkpoint();
    sel.forEach(function (item) {
      [item].concat(Array.prototype.slice.call(item.querySelectorAll("*"))).forEach(function (el) {
        if (!hasOwnText(el) || el.closest("svg")) return;
        el.style.fontSize = Math.max(12, R(parseFloat(getComputedStyle(el).fontSize) * f)) + "px";
      });
    });
    drawSel(); changed();
  }
  function cycleAlign() {
    checkpoint();
    var a = getComputedStyle(sel[0]).textAlign, next = a === "center" ? "right" : a === "right" || a === "end" ? "left" : "center";
    sel.forEach(function (el) { el.style.textAlign = next; });
    drawTools(); changed();
  }
  function restack(front) {
    checkpoint(); pin(curSec());
    var sec = curSec(), aside = sec.querySelector(":scope > aside");
    var decos = sec.querySelectorAll(":scope > [data-deco]"), after = decos.length ? decos[decos.length - 1].nextSibling : sec.firstChild;
    sel.forEach(function (el) { if (front) sec.insertBefore(el, aside); else sec.insertBefore(el, after); });
    drawSel(); changed();
  }
  function duplicate() {
    if (!sel.length) return;
    checkpoint(); pin(curSec());
    var sec = curSec(), aside = sec.querySelector(":scope > aside");
    var copies = sel.map(function (el) {
      var c = el.cloneNode(true);
      c.style.left = R(parseFloat(el.style.left) + 24) + "px"; c.style.top = R(parseFloat(el.style.top) + 24) + "px";
      sec.insertBefore(c, aside); return c;
    });
    select(copies); changed();
  }
  function removeSel() {
    if (!sel.length) return;
    checkpoint();
    sel.forEach(function (el) { el.remove(); });
    select([]); changed();
  }
  function nudge(key, n) {
    if (Date.now() - (nudge.at || 0) > 800) checkpoint();
    nudge.at = Date.now();
    pin(curSec());
    var dx = key === "ArrowLeft" ? -n : key === "ArrowRight" ? n : 0, dy = key === "ArrowUp" ? -n : key === "ArrowDown" ? n : 0;
    sel.forEach(function (el) { el.style.left = R(parseFloat(el.style.left) + dx) + "px"; el.style.top = R(parseFloat(el.style.top) + dy) + "px"; });
    drawSel(); changed();
  }
  function askAbout() {
    var target = sel[0], s = slides[cur];
    var inp = h("input", { "class": "sl-askin", placeholder: T.askPh, "aria-label": T.ask });
    tools.replaceChildren(inp);
    placeTools();
    inp.focus();
    inp.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") { drawTools(); return; }
      if (e.key !== "Enter" || !inp.value.trim()) return;
      var text = T.about(cur + 1, s.id, titleOf(s), target ? labelOf(target) : "") + " " + inp.value.trim();
      if (!window.hermes || !window.hermes.send) { kit.toast(T.noSave); drawTools(); return; }
      window.hermes.send(text, { slide: s.id, element: selectorOf(target) }).then(function () { kit.toast(T.sent); }, function (err) { kit.toast(String(err && err.message || err)); });
      drawTools();
    });
  }

  // ------------------------------------------------------------------ insert: text, images, shapes
  function accent() { var th = window.slideTheme ? window.slideTheme(deckTheme()) : null; return th ? th.accent : "#2dd4bf"; }
  function place(el) {
    var sec = curSec();
    sec.insertBefore(el, sec.querySelector(":scope > aside"));
    return el;
  }
  function insertText(text) {
    checkpoint();
    var el = place(h("p", { style: "position:absolute;left:560px;top:470px;width:800px;margin:0;box-sizing:border-box;font-size:44px;line-height:1.3", text: text || T.phText }));
    select([el]); changed();
    if (!text) startEdit(el, null, true);
  }
  function insertShape(kind) {
    checkpoint();
    var el = place(h("div", { "data-shape": kind, style: "position:absolute;left:760px;top:390px;width:400px;height:300px;margin:0;box-sizing:border-box;border-radius:" +
      (kind === "ellipse" ? "50%" : "24px") + ";background:" + accent() }));
    select([el]); changed();
  }
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return reject(new Error("png, jpeg, gif, webp"));
      var fr = new FileReader();
      fr.onload = function () {
        var url = fr.result, img = new Image();
        img.onload = function () {
          var big = file.size > 8 * 1024 * 1024 || Math.max(img.naturalWidth, img.naturalHeight) > 3840;
          if (!big) return resolve({ url: url, w: img.naturalWidth, h: img.naturalHeight, type: file.type });
          // Too big for the deck: a smaller JPEG (a slide never needs more than 4K).
          var k = Math.min(1, 3840 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
          c.width = R(img.naturalWidth * k); c.height = R(img.naturalHeight * k);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          var out = c.toDataURL("image/jpeg", 0.88);
          if (out.length * 0.75 > 8 * 1024 * 1024) return reject(new Error(T.tooBig));
          resolve({ url: out, w: c.width, h: c.height, type: "image/jpeg" });
        };
        img.onerror = function () { reject(new Error("image")); };
        img.src = url;
      };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(file);
    });
  }
  function insertImage(file, at) {
    readImage(file).then(function (im) {
      var ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[im.type];
      var path = "img/" + Math.random().toString(36).slice(2, 10) + "." + ext;
      C.files[path] = im.url; uploads[path] = im.url;
      var k = Math.min(1, 1200 / im.w, 700 / im.h), w = R(im.w * k), hh = R(im.h * k);
      var x = at ? at.x - w / 2 : (W - w) / 2, y = at ? at.y - hh / 2 : (H - hh) / 2;
      checkpoint();
      var el = place(h("img", { src: im.url, "data-src-path": path, alt: (file.name || "").replace(/\.[^.]+$/, "").slice(0, 80),
        style: "position:absolute;left:" + R(x) + "px;top:" + R(y) + "px;width:" + w + "px;height:" + hh + "px;margin:0;object-fit:cover" }));
      select([el]); changed();
    }).catch(function (e) { kit.toast(String(e && e.message || e)); });
  }
  var filePick = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true });
  filePick.addEventListener("change", function () { if (filePick.files[0]) insertImage(filePick.files[0]); filePick.value = ""; });
  document.body.appendChild(filePick);
  if (editable) {
    stageWrap.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") >= 0) e.preventDefault(); });
    stageWrap.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      var o = stage.getBoundingClientRect();
      insertImage(f, { x: Math.max(0, Math.min(W, (e.clientX - o.left) / SC)), y: Math.max(0, Math.min(H, (e.clientY - o.top) / SC)) });
    });
  }

  // ------------------------------------------------------------------ clipboard
  var clipboard = null;
  function copySel() {
    clipboard = { slide: slides[cur].id, html: sel.map(function (el) {
      var b = rectOf(el), c = el.cloneNode(true);
      if (c.style.position !== "absolute" || !c.style.left) {
        c.style.position = "absolute"; c.style.left = R(b.x) + "px"; c.style.top = R(b.y) + "px"; c.style.width = R(b.w) + "px";
        c.style.margin = "0"; c.style.boxSizing = "border-box"; if (!isTextBox(el)) c.style.height = R(b.h) + "px";
      }
      c.querySelectorAll("img").forEach(function (im) { var p = im.getAttribute("data-src-path"); if (p) im.setAttribute("src", p); });
      if (c.tagName === "IMG" && c.getAttribute("data-src-path")) c.setAttribute("src", c.getAttribute("data-src-path"));
      return c.outerHTML;
    }), n: 0, text: sel.map(function (el) { return el.textContent.trim(); }).join(String.fromCharCode(10)) };
  }
  function pasteClip() {
    checkpoint();
    var same = clipboard.slide === slides[cur].id, off = same ? 24 * ++clipboard.n : 0;
    var tmp = clean("<section>" + clipboard.html.join("") + "</section>", "x");
    var els = Array.prototype.slice.call(tmp.children).map(function (el) {
      if (off) { el.style.left = R(parseFloat(el.style.left) + off) + "px"; el.style.top = R(parseFloat(el.style.top) + off) + "px"; }
      return place(el);
    });
    select(els); changed();
  }
  if (editable) {
    document.addEventListener("copy", function (e) {
      if (editing || /input|textarea/i.test(e.target.tagName) || !sel.length) return;
      copySel();
      e.clipboardData.setData("text/plain", sel.map(function (el) { return el.textContent.trim(); }).join("\n"));
      e.preventDefault();
    });
    document.addEventListener("cut", function (e) {
      if (editing || /input|textarea/i.test(e.target.tagName) || !sel.length) return;
      copySel();
      e.clipboardData.setData("text/plain", sel.map(function (el) { return el.textContent.trim(); }).join("\n"));
      e.preventDefault(); removeSel();
    });
    document.addEventListener("paste", function (e) {
      if (/input|textarea/i.test(e.target.tagName) || pres) return;
      var cd = e.clipboardData, text = cd ? cd.getData("text/plain") : "";
      if (editing) { e.preventDefault(); document.execCommand("insertText", false, text); return; } // plain text only
      var f = cd && Array.prototype.find.call(cd.files || [], function (x) { return /^image\//.test(x.type); });
      e.preventDefault();
      if (f) insertImage(f);
      else if (clipboard && (!text || text === clipboard.text)) pasteClip();
      else if (text.trim()) insertText(text.trim().slice(0, 2000));
    });
  }

  // ------------------------------------------------------------------ speaker notes
  var notesTa = null;
  if (editable) {
    notesTa = h("textarea", { "class": "sl-notes-ta", placeholder: T.notesPh, "aria-label": T.notes });
    notesEl.appendChild(notesTa);
    var notesSnap = false;
    notesTa.addEventListener("focus", function () { notesSnap = false; select([]); });
    notesTa.addEventListener("input", function () {
      if (!notesSnap) { checkpoint(); notesSnap = true; }
      var sec = curSec(), a = sec.querySelector(":scope > aside"), v = notesTa.value;
      if (!v.trim()) { if (a) a.remove(); }
      else { if (!a) { a = document.createElement("aside"); sec.appendChild(a); } a.textContent = v; }
      changed();
    });
  }

  // ------------------------------------------------------------------ present (full screen, presenter view)
  var pres = null;
  function present(presenter) {
    stopEdit(); closeGrid(); select([]);
    var main = h("div", { "class": "sl-pmain" }), box = h("div", { "class": "sl-pbox" }), count = h("div", { "class": "sl-count" });
    main.appendChild(box);
    pres = { el: h("div", { id: "sl-present", tabindex: "0" }, [main, count]), main: main, box: box, count: count, i: cur, steps: [],
      presenter: false, t0: Date.now(), pausedFor: 0, pauseAt: null, notesSize: 22 };
    document.body.appendChild(pres.el);
    pres.el.focus();
    // Full screen is the host's: the frame can't ask for it. Outside Hermes, try the page itself.
    if (window.hermes && window.hermes.present) window.hermes.present(true).catch(function () {});
    else if (pres.el.requestFullscreen) pres.el.requestFullscreen().catch(function () {});
    var hideTimer;
    pres.el.addEventListener("mousemove", function () {
      pres.el.classList.add("cursor"); clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { pres && pres.el.classList.remove("cursor"); }, 1500);
    });
    pres.el.addEventListener("click", function (e) { if (!e.target.closest(".sl-ptop,.sl-pside")) step(1); });
    pres.el.addEventListener("keydown", presKey);
    pres.tick = setInterval(tick, 1000);
    if (presenter) setPresenter(true); else paint(null);
  }
  function pbtn(icon, title, fn) { var b = kit.button("", icon, fn, title); b.setAttribute("aria-label", title); return b; }
  function setPresenter(on) {
    pres.presenter = on;
    pres.el.classList.toggle("is-presenter", on);
    if (on && !pres.top) {
      pres.timer = h("span", { "class": "sl-ptimer" }); pres.clock = h("span", { "class": "sl-pclock" }); pres.pcount = h("span", { "class": "sl-pclock" });
      pres.pauseBtn = pbtn("pause", T.pause, function () {
        if (pres.pauseAt) { pres.pausedFor += Date.now() - pres.pauseAt; pres.pauseAt = null; } else pres.pauseAt = Date.now();
        pres.pauseBtn.innerHTML = kit.icon(pres.pauseAt ? "play" : "pause"); tick();
      });
      pres.top = h("div", { "class": "sl-ptop" }, [pres.timer, pres.pauseBtn,
        pbtn("refresh", T.reset, function () { pres.t0 = Date.now(); pres.pausedFor = 0; if (pres.pauseAt) pres.pauseAt = Date.now(); tick(); }),
        pres.clock, h("span", { style: "flex:1" }), pres.pcount,
        pbtn("fontDown", T.textSize, function () { pres.notesSize = Math.max(14, pres.notesSize - 2); pres.notes.style.fontSize = pres.notesSize + "px"; }),
        pbtn("fontUp", T.textSize, function () { pres.notesSize = Math.min(48, pres.notesSize + 2); pres.notes.style.fontSize = pres.notesSize + "px"; }),
        pbtn("play", T.present, function () { setPresenter(false); }), kit.labelled(kit.button(T.exitP, "close", endPresent, T.exitP), T.exitP)]);
      pres.next = h("div", { "class": "sl-pnext" });
      pres.notes = h("div", { "class": "sl-pnotes", style: "font-size:" + pres.notesSize + "px" });
      pres.side = h("div", { "class": "sl-pside" }, [h("div", { "class": "sl-plabel", text: T.next }), pres.next,
        h("div", { "class": "sl-plabel", text: T.notes }), pres.notes]);
      pres.el.insertBefore(pres.top, pres.main);
      pres.el.appendChild(pres.side);
    }
    if (pres.top) { pres.top.hidden = !on; pres.side.hidden = !on; }
    paint(null); tick();
  }
  function tick() {
    if (!pres || !pres.presenter || !pres.timer) return;
    var ms = (pres.pauseAt || Date.now()) - pres.t0 - pres.pausedFor, s = Math.max(0, Math.floor(ms / 1000));
    var p2 = function (n) { return ("0" + n).slice(-2); };
    pres.timer.textContent = (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + p2(Math.floor(s / 60) % 60) + ":" + p2(s % 60);
    pres.timer.classList.toggle("is-paused", !!pres.pauseAt);
    pres.clock.textContent = new Date().toLocaleTimeString(L === "hu" ? "hu-HU" : [], { hour: "2-digit", minute: "2-digit" });
  }
  function paint(dir) {
    var s = slides[pres.i], r = pres.main.getBoundingClientRect(), pad = pres.presenter ? 32 : 0;
    var sc = Math.min((r.width - pad) / W, (r.height - pad) / H);
    if (!(sc > 0)) sc = Math.min(innerWidth / W, innerHeight / H);
    var box = pres.box;
    box.style.width = W * sc + "px"; box.style.height = H * sc + "px";
    var next = canvasFor(s, sc, false);
    pres.steps = Array.prototype.slice.call(next.querySelectorAll("[data-build-in]"));
    pres.steps.forEach(function (n) { n.setAttribute("data-build-hidden", ""); });
    var old = dir ? box.lastChild : null;
    if (!dir) box.replaceChildren();
    // The transition between two slides is the earlier one's: going back plays it in reverse.
    var kind = old && old.firstChild && (dir > 0 ? old : next).firstChild.getAttribute("data-transition");
    box.appendChild(next);
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (old && !reduce && next.animate) {
      if (kind === "magic") magicMove(old, next, sc);
      else if (kind === "push") {
        old.animate([{ transform: old.style.transform }, { transform: "translateX(" + (-dir * W * sc) + "px) " + old.style.transform }], { duration: 420, easing: "ease-in-out" });
        next.animate([{ transform: "translateX(" + (dir * W * sc) + "px) " + next.style.transform }, { transform: next.style.transform }], { duration: 420, easing: "ease-in-out" })
          .finished.then(function () { old.remove(); });
      } else {
        next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: kind === "fade" ? 320 : 160, easing: "ease-out" }).finished.then(function () { old.remove(); });
      }
    } else if (old) old.remove();
    pres.count.textContent = (pres.i + 1) + " / " + slides.length;
    if (pres.presenter) {
      var n = slides[pres.i + 1];
      pres.next.replaceChildren(n ? canvasFor(n, (pres.next.clientWidth || 320) / W, false) : h("div", { "class": "sl-pend", text: T.end }));
      pres.notes.textContent = notesOf(s) || T.nonotes;
      pres.pcount.textContent = (pres.i + 1) + " / " + slides.length;
    }
    sendView();
  }

  /** Magic move: what the two slides share (the same data-key, or the same text, image or chart)
   *  travels from where it was to where it is; the rest fades out and in. */
  function magicKey(el) {
    var k = el.getAttribute("data-key");
    if (k) return "k:" + k;
    var tag = el.tagName.toLowerCase();
    if (tag === "img") return "img:" + (el.getAttribute("data-src-path") || el.getAttribute("src"));
    if (tag === "svg") return "svg:" + (el.getAttribute("aria-label") || "");
    var t = el.textContent.replace(/\s+/g, " ").trim();
    return t ? tag + ":" + t.slice(0, 300) : el.getAttribute("data-shape") ? "shape:" + el.getAttribute("style") : null;
  }
  function magicCands(sec) {
    return Array.prototype.filter.call(sec.querySelectorAll("[data-key],h1,h2,h3,h4,p,li,img,svg,table,section > div"), function (el) {
      return !el.closest("aside") && !el.hasAttribute("data-deco");
    });
  }
  function magicMove(oldCv, nextCv, sc) {
    var a = oldCv.firstChild, b = nextCv.firstChild, ca = magicCands(a), used = [], pairs = [];
    magicCands(b).forEach(function (eb) {
      if (pairs.some(function (p) { return p[1].contains(eb); })) return;
      var k = magicKey(eb);
      if (!k) return;
      var ea = ca.find(function (x) { return used.indexOf(x) < 0 && magicKey(x) === k && !pairs.some(function (p) { return p[0].contains(x) || x.contains(p[0]); }); });
      if (ea) { used.push(ea); pairs.push([ea, eb]); }
    });
    var D = 700, E = "cubic-bezier(.45,0,.2,1)";
    var oldBg = getComputedStyle(a).backgroundColor, newBg = getComputedStyle(b).backgroundColor;
    if (oldBg !== newBg) b.animate([{ backgroundColor: oldBg }, { backgroundColor: newBg }], { duration: D, easing: E });
    pairs.forEach(function (p) {
      var ra = p[0].getBoundingClientRect(), rb = p[1].getBoundingClientRect();
      if (!rb.width || !rb.height) return;
      var tx = (ra.left - rb.left) / sc, ty = (ra.top - rb.top) / sc, sx = ra.width / rb.width, sy = ra.height / rb.height;
      if (p[1].textContent.trim() && p[1].tagName !== "svg") sx = sy = Math.min(sx, sy) || 1; // text keeps its shape
      var base = getComputedStyle(p[1]).transform, keepT = base && base !== "none";
      var from = "translate(" + tx + "px," + ty + "px)" + (keepT ? " " + base : " scale(" + sx + "," + sy + ")");
      p[1].animate([{ transform: from, transformOrigin: "0 0" }, { transform: keepT ? base : "none", transformOrigin: "0 0" }], { duration: D, easing: E });
      var c1 = getComputedStyle(p[0]).color, c2 = getComputedStyle(p[1]).color;
      if (c1 !== c2) p[1].animate([{ color: c1 }, { color: c2 }], { duration: D, easing: E });
      p[0].style.visibility = "hidden";
    });
    itemsOf(b).forEach(function (el) {
      if (pairs.some(function (p) { return p[1] === el || el.contains(p[1]) || p[1].contains(el); })) return;
      el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: D, easing: "ease-out" });
    });
    // The old slide on top, without its background, fading out what didn't travel.
    a.style.background = "transparent";
    oldCv.parentNode.appendChild(oldCv);
    oldCv.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D * 0.6, easing: "ease-out", fill: "forwards" }).finished.then(function () { oldCv.remove(); });
  }

  function build(n) {
    n.removeAttribute("data-build-hidden");
    if (!n.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var k = (n.getAttribute("data-build-in") || "fade").split(/\s+/)[0];
    var from = k === "rise" ? { opacity: 0, transform: "translateY(40px)" } : k === "pop" ? { opacity: 0, transform: "scale(.85)" } : { opacity: 0 };
    n.animate([from, { opacity: 1, transform: "none" }], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  function step(d) {
    if (!pres) return;
    if (d > 0 && pres.steps.length) return build(pres.steps.shift());
    var j = pres.i + d;
    if (j < 0 || j >= slides.length) return;
    pres.i = j; paint(d);
  }
  function presKey(e) {
    var k = e.key;
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].indexOf(k) >= 0 && !(k === " " && e.shiftKey)) { e.preventDefault(); step(1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].indexOf(k) >= 0 || (k === " " && e.shiftKey)) { e.preventDefault(); step(-1); }
    else if (k === "Home") { pres.i = 0; paint(null); }
    else if (k === "End") { pres.i = slides.length - 1; paint(null); }
    else if (/^[1-9]$/.test(k)) { pres.i = Math.min(slides.length - 1, +k - 1); paint(null); }
    else if (k === "p" || k === "P") setPresenter(!pres.presenter);
    else if ((k === "f" || k === "F") && !(window.hermes && window.hermes.present)) { if (document.fullscreenElement) document.exitFullscreen(); else if (pres.el.requestFullscreen) pres.el.requestFullscreen().catch(function () {}); }
    else if (k === "Escape") endPresent();
  }
  function endPresent() {
    if (!pres) return;
    var i = pres.i;
    clearInterval(pres.tick);
    if (window.hermes && window.hermes.present) window.hermes.present(false).catch(function () {});
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    pres.el.remove(); pres = null;
    show(i);
  }
  if (window.hermes && window.hermes.on) window.hermes.on("present-exit", function () { if (pres) endPresent(); });
  window.addEventListener("resize", function () { fit(); if (pres) paint(null); });

  document.addEventListener("keydown", function (e) {
    if (pres) return;
    var k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && (k === "s" || k === "S")) { e.preventDefault(); save(); return; }
    if (editing || /input|textarea|select/i.test(e.target.tagName)) return;
    if (editable) {
      if (mod && (k === "z" || k === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && (k === "y" || k === "Y")) { e.preventDefault(); redo(); return; }
      if (mod && (k === "a" || k === "A")) { e.preventDefault(); select(itemsOf(curSec())); return; }
      if (mod && (k === "d" || k === "D") && sel.length) { e.preventDefault(); duplicate(); return; }
      if ((k === "Delete" || k === "Backspace") && sel.length) { e.preventDefault(); removeSel(); return; }
      if (k === "Escape" && sel.length) { select([]); return; }
      if (k === "Enter" && sel.length === 1) { e.preventDefault(); startEdit(textIn(sel[0]), null, true); return; }
      if (/^Arrow/.test(k) && sel.length) { e.preventDefault(); nudge(k, e.shiftKey ? 10 : 1); return; }
    }
    if (gridEl && k === "Escape") { closeGrid(); return; }
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown") { e.preventDefault(); show(cur + 1); }
    if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") { e.preventDefault(); show(cur - 1); }
  });

  // ------------------------------------------------------------------ export: measuring
  /** Render one slide off-screen at full size, for export. */
  function offscreen(s) {
    var holder = h("div", { style: "position:fixed;left:-30000px;top:0;width:" + W + "px;height:" + H + "px;overflow:hidden" });
    var cv = canvasFor(s, 1, false);
    holder.appendChild(cv);
    document.body.appendChild(holder);
    return { sec: cv.firstChild, done: function () { holder.remove(); } };
  }

  function rgba(c) {
    var cm = (c || "").match(/color\(srgb\s+([^)]+)\)/);
    if (cm) {
      var q = cm[1].split(/[\s\/]+/).filter(Boolean).map(Number);
      c = "rgba(" + q.slice(0, 3).map(function (x) { return Math.round(x * 255); }).join(",") + "," + (q.length > 3 ? q[3] : 1) + ")";
    }
    var m = (c || "").match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    var a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    var hex = p.slice(0, 3).map(function (v) { return ("0" + Math.round(v).toString(16)).slice(-2); }).join("").toUpperCase();
    return { hex: hex, transparency: Math.round((1 - a) * 100) };
  }
  function firstColor(bgImage) {
    var m = (bgImage || "").match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i);
    if (!m) return null;
    var probe = h("div", { style: "color:" + m[0] });
    document.body.appendChild(probe);
    var c = getComputedStyle(probe).color; probe.remove();
    return rgba(c);
  }

  function svgToPng(svgEl, w, h2) {
    return new Promise(function (resolve) {
      var xml = new XMLSerializer().serializeToString(svgEl);
      if (!/xmlns=/.test(xml)) xml = xml.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * 2)); c.height = Math.max(1, Math.round(h2 * 2));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        try { resolve(c.toDataURL("image/png")); } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    });
  }

  var IN = 1 / 144; // px -> inches (1920 px = 13.333 in)
  function box(el, origin) {
    var r = el.getBoundingClientRect();
    return { x: (r.left - origin.left) * IN, y: (r.top - origin.top) * IN, w: r.width * IN, h: r.height * IN, px: r };
  }
  function family(cs) { return (cs.fontFamily.split(",")[0] || "Arial").replace(/["']/g, "").trim(); }

  function runsOf(el) {
    var runs = [];
    (function walk(n, link) {
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) {
          var t = c.textContent.replace(/\s+/g, " ");
          if (!t) return;
          var cs = getComputedStyle(c.parentElement), col = rgba(cs.color);
          runs.push({ text: t, options: { bold: +cs.fontWeight >= 600, italic: cs.fontStyle === "italic",
            underline: /underline/.test(cs.textDecorationLine) ? { style: "sng" } : undefined,
            color: col ? col.hex : undefined, fontFace: family(cs), fontSize: parseFloat(cs.fontSize) / 2,
            hyperlink: link ? { url: link } : undefined } });
        } else if (c.nodeType === 1 && c.tagName === "BR") runs.push({ text: "", options: { breakLine: true } });
        else if (c.nodeType === 1 && getComputedStyle(c).display !== "none") walk(c, c.tagName === "A" ? c.getAttribute("href") : link);
      });
    })(el, null);
    if (runs.length) { runs[0].text = runs[0].text.replace(/^\s+/, ""); var l = runs[runs.length - 1]; l.text = l.text.replace(/\s+$/, ""); }
    return runs.filter(function (r) { return r.text || r.options.breakLine; });
  }

  function hasOwnText(el) {
    return Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); });
  }
  var TEXT_BLOCK = /^(H1|H2|H3|H4|H5|H6|P|BLOCKQUOTE|FIGCAPTION|LABEL)$/;

  /** One slide as PPTX shapes: native text, boxes, tables; images and SVG as pictures. */
  async function slideToPptx(pptx, s) {
    var o = offscreen(s), sec = o.sec, origin = sec.getBoundingClientRect();
    var slide = pptx.addSlide(), warn = [];
    try {
      var cs = getComputedStyle(sec);
      var bg = rgba(cs.backgroundColor) || firstColor(cs.backgroundImage) || { hex: "FFFFFF" };
      slide.background = { color: bg.hex };
      var visit = async function (el) {
        var st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || el.tagName === "ASIDE") return;
        var b = box(el, origin);
        if (b.w <= 0 || b.h <= 0) return;
        var tag = el.tagName;
        if (tag !== "SECTION" && tag !== "TABLE" && tag !== "svg") {
          var fill = rgba(st.backgroundColor) || (st.backgroundImage !== "none" ? firstColor(st.backgroundImage) : null);
          var bw = parseFloat(st.borderTopWidth) || 0, line = bw && st.borderTopStyle !== "none" ? rgba(st.borderTopColor) : null;
          if (fill || line) {
            var rad = parseFloat(st.borderTopLeftRadius) || 0;
            slide.addShape(rad ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
              x: b.x, y: b.y, w: b.w, h: b.h,
              fill: fill ? { color: fill.hex, transparency: fill.transparency } : { type: "none" },
              line: line ? { color: line.hex, width: bw * 0.5 } : { type: "none" },
              rectRadius: rad ? Math.min(0.5, rad / Math.min(b.px.width, b.px.height)) : undefined
            });
          }
        }
        if (tag === "IMG") {
          var src = el.currentSrc || el.src;
          if (/^data:image\/(png|jpe?g|gif)/i.test(src)) slide.addImage({ data: src, x: b.x, y: b.y, w: b.w, h: b.h });
          else if (/^data:image\/svg/i.test(src)) {
            var tmp = new Image(); tmp.src = src;
            await tmp.decode().catch(function () {});
            var cnv = document.createElement("canvas"); cnv.width = b.px.width * 2; cnv.height = b.px.height * 2;
            try { cnv.getContext("2d").drawImage(tmp, 0, 0, cnv.width, cnv.height); slide.addImage({ data: cnv.toDataURL("image/png"), x: b.x, y: b.y, w: b.w, h: b.h }); }
            catch (e) { warn.push("image"); }
          } else warn.push("image " + src.slice(0, 40));
          return;
        }
        if (tag.toLowerCase() === "svg") {
          var png = await svgToPng(el, b.px.width, b.px.height);
          if (png) slide.addImage({ data: png, x: b.x, y: b.y, w: b.w, h: b.h }); else warn.push("svg");
          return;
        }
        if (tag === "TABLE") {
          var rows = Array.prototype.map.call(el.rows, function (tr) {
            return Array.prototype.map.call(tr.cells, function (td) {
              var c2 = getComputedStyle(td), col = rgba(c2.color), f = rgba(c2.backgroundColor) || rgba(getComputedStyle(tr).backgroundColor);
              return { text: td.textContent.trim(), options: { bold: +c2.fontWeight >= 600, color: col ? col.hex : undefined,
                fill: f ? { color: f.hex } : undefined, fontFace: family(c2), fontSize: parseFloat(c2.fontSize) / 2,
                align: c2.textAlign === "right" ? "right" : c2.textAlign === "center" ? "center" : "left", valign: "middle" } };
            });
          });
          var first = el.rows[0];
          var colW = first ? Array.prototype.map.call(first.cells, function (td) { return td.getBoundingClientRect().width * IN; }) : undefined;
          slide.addTable(rows, { x: b.x, y: b.y, w: b.w, colW: colW, border: { type: "solid", pt: 0.5, color: "BBBBBB" }, margin: 0.04 });
          return;
        }
        if (tag === "UL" || tag === "OL") {
          var paras = [];
          Array.prototype.forEach.call(el.children, function (li, k) {
            var r = runsOf(li);
            if (!r.length) return;
            r[0].options = Object.assign({}, r[0].options, { bullet: tag === "OL" ? { type: "number" } : true });
            if (k < el.children.length - 1) r[r.length - 1].options = Object.assign({}, r[r.length - 1].options, { breakLine: true });
            paras = paras.concat(r);
          });
          if (paras.length) slide.addText(paras, { x: b.x, y: b.y, w: b.w, h: b.h, valign: "top", margin: 0, fit: "none",
            lineSpacingMultiple: (parseFloat(st.lineHeight) / parseFloat(st.fontSize)) || 1.2 });
          return;
        }
        if (TEXT_BLOCK.test(tag) || (tag !== "SECTION" && hasOwnText(el))) {
          var runs = runsOf(el);
          if (runs.length) {
            var lh = parseFloat(st.lineHeight) / parseFloat(st.fontSize);
            slide.addText(runs, { x: b.x, y: b.y, w: b.w + 0.05, h: b.h, valign: "top", margin: 0, fit: "none", wrap: true,
              align: st.textAlign === "center" ? "center" : st.textAlign === "right" || st.textAlign === "end" ? "right" : "left",
              lineSpacingMultiple: lh > 0.5 && lh < 4 ? lh : undefined });
          }
          return;
        }
        for (var i = 0; i < el.children.length; i++) await visit(el.children[i]);
      };
      await visit(sec);
      var n = notesOf(s);
      if (n) slide.addNotes(n);
    } finally { o.done(); }
    return warn;
  }

  /** One slide as a picture: SVG foreignObject -> canvas. Everything in it is a data: URI. */
  function rasterize(s, scale) {
    return new Promise(function (resolve, reject) {
      var o = offscreen(s);
      var css = Array.prototype.map.call(document.styleSheets, function (ss) {
        try { return Array.prototype.map.call(ss.cssRules, function (r) { return r.cssText; }).join("\n"); } catch (e) { return ""; }
      }).join("\n");
      var node = o.sec.cloneNode(true);
      o.done();
      node.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      var wrap = document.createElement("div");
      wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      wrap.className = "sl-canvas";
      wrap.setAttribute("style", "transform:none;position:relative");
      wrap.appendChild(node);
      var xhtml = new XMLSerializer().serializeToString(wrap);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject width="100%" height="100%">' +
        '<style xmlns="http://www.w3.org/1999/xhtml"><![CDATA[' + css.replace(/]]>/g, "") + ']]></style>' + xhtml + "</foreignObject></svg>";
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = W * scale; c.height = H * scale;
        var g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c);
      };
      img.onerror = function () { reject(new Error("slide picture failed")); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }

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
    var b = document.querySelector(".sl-busy");
    if (on && !b) document.body.appendChild(h("div", { "class": "sl-busy", text: T.building }));
    if (!on && b) b.remove();
  }

  async function exportPptx() {
    busy(true);
    try {
      var PptxGenJS = await lib("pptxgen.bundle.js", "PptxGenJS");
      var pptx = new PptxGenJS();
      pptx.defineLayout({ name: "HERMES16x9", width: W * IN, height: H * IN });
      pptx.layout = "HERMES16x9";
      pptx.title = deck.title || C.title || "Slides";
      var warn = [];
      for (var i = 0; i < slides.length; i++) warn = warn.concat(await slideToPptx(pptx, slides[i]));
      var blob = await pptx.write({ outputType: "blob", compression: true });
      kit.download(kit.slug(pptx.title) + ".pptx", blob, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      if (warn.length) kit.toast(warn.length + " element(s) exported as best effort");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }

  async function exportPdf() {
    busy(true);
    try {
      var PDFLib = await lib("pdf-lib.min.js", "PDFLib");
      var pdf = await PDFLib.PDFDocument.create();
      pdf.setTitle(deck.title || C.title || "Slides");
      pdf.setCreator("Hermes Artifacts");
      var layer = kit.pdfText(PDFLib, pdf);
      for (var i = 0; i < slides.length; i++) {
        var c = await rasterize(slides[i], 1.5);
        var jpg = await pdf.embedJpg(c.toDataURL("image/jpeg", 0.9));
        var page = pdf.addPage([960, 540]);
        page.drawImage(jpg, { x: 0, y: 0, width: 960, height: 540 });
        // The slide's text over its picture, invisible: the PDF can be searched and copied from.
        var o = offscreen(slides[i]);
        try { layer.add(page, kit.textLines(o.sec), 960 / W); } finally { o.done(); }
      }
      layer.finish();
      var bytes = await pdf.save();
      kit.download(kit.slug(deck.title || C.title) + ".pdf", new Blob([bytes], { type: "application/pdf" }), "application/pdf");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }

  async function exportPng() {
    busy(true);
    try {
      var c = await rasterize(slides[cur], 1);
      var blob = await new Promise(function (r) { c.toBlob(r, "image/png"); });
      kit.download(kit.slug(deck.title || C.title) + "-" + (cur + 1) + ".png", blob, "image/png");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }

  function exportHtml() {
    var secs = slides.map(function (s) { var c = s.sec.cloneNode(true); c.querySelectorAll("[contenteditable]").forEach(function (n) { n.removeAttribute("contenteditable"); }); c.querySelectorAll("[data-src-path]").forEach(function (n) { n.removeAttribute("data-src-path"); }); return c.outerHTML; }).join("\n");
    var css = Array.prototype.map.call(document.styleSheets, function (ss) {
      try { return Array.prototype.map.call(ss.cssRules, function (r) { return r.cssText; }).join("\n"); } catch (e) { return ""; }
    }).join("\n");
    var doc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; script-src \'unsafe-inline\'">' +
      "<title>" + kit.esc(deck.title || C.title) + "</title><style>" + css + "body{margin:0;background:#000;overflow:hidden}" +
      ".sl-canvas>section{display:none}.sl-canvas>section.on{display:flex}</style></head><body>" +
      '<div class="sl-canvas" id="c">' + secs + "</div><script>(function(){var c=document.getElementById('c'),s=c.children,i=0;" +
      "function f(){var k=Math.min(innerWidth/1920,innerHeight/1080);c.style.transform='scale('+k+')';c.style.left=(innerWidth-1920*k)/2+'px';c.style.top=(innerHeight-1080*k)/2+'px';}" +
      "function g(n){i=Math.max(0,Math.min(s.length-1,n));for(var j=0;j<s.length;j++)s[j].classList.toggle('on',j===i);}" +
      "addEventListener('resize',f);addEventListener('keydown',function(e){if(/Right|Down|PageDown| /.test(e.key))g(i+1);if(/Left|Up|PageUp/.test(e.key))g(i-1);});" +
      "addEventListener('click',function(){g(i+1)});f();g(0);})();</" + "script></body></html>";
    kit.download(kit.slug(deck.title || C.title) + ".html", doc, "text/html");
  }

  // ------------------------------------------------------------------ chrome
  var counter = h("span", { "class": "src-meta", style: "font-size:12px;color:var(--color-fg-muted);margin-right:4px" });
  var statusEl = h("span", { "class": "sl-status", "aria-live": "polite" });
  var saveBtn = kit.labelled(kit.button(T.save, "", save, T.save), T.save);
  saveBtn.classList.add("sl-save"); saveBtn.hidden = true;
  var exportList = [{ id: "pdf", label: T.pdf, run: exportPdf }, { id: "pptx", label: T.pptx, run: exportPptx },
    { id: "png", label: T.png, run: exportPng }, { id: "html", label: T.html, run: exportHtml }];
  var expBtn = kit.labelled(kit.button(T.exp, "download", function () {
    kit.menu(expBtn, exportList.map(function (x) { return { label: x.label, onClick: x.run }; }));
  }), T.exp);
  expBtn.hidden = true;
  kit.exports(exportList).then(function (hosted) { expBtn.hidden = hosted; });
  var notesBtn = kit.button("", "notes", function () {
    notesEl.hidden = !notesEl.hidden; notesBtn.setAttribute("aria-pressed", String(!notesEl.hidden)); fit();
  }, T.notes);
  var insBtn = kit.labelled(kit.button(T.insert, "plus", function () {
    kit.menu(insBtn, [
      { label: T.text, onClick: function () { insertText(); } },
      { label: T.image, onClick: function () { filePick.click(); } },
      { label: T.rect, onClick: function () { insertShape("rect"); } },
      { label: T.ellipse, onClick: function () { insertShape("ellipse"); } },
      { label: T.newSlide, onClick: function () { layoutMenu(insBtn, cur); } }
    ]);
  }), T.insert);
  var edit = editable ? [insBtn, kit.button("", "undo", undo, T.undo), kit.button("", "redo", redo, T.redo)] : [];
  bar.append.apply(bar, [h("span", { "class": "kit-title", style: "font-weight:400;font-size:12px;color:var(--color-fg-muted)", text: editable ? T.editHint : "" })]
    .concat(edit, [statusEl, saveBtn, counter, kit.button("", "grid", openGrid, T.grid), notesBtn, expBtn,
      kit.button("", "presenter", function () { present(true); }, T.presenter),
      kit.labelled(kit.button(T.present, "play", function () { present(false); }, T.present), T.present)]));

  if (!slides.length) { stage.replaceWith(h("div", { "class": "kit-empty", text: T.empty })); return; }
  buildRail();
  show(cur);
  function relayout() {
    // Layout slides nobody changed follow the theme (the design system's, else Hermes' own).
    slides.forEach(function (s) {
      if (!s.layout || fileIds[s.id] || serialize(s) !== saved.html[s.id]) return;
      s.sec = clean(window.slideLayout(defs[s.id], deckTheme()), s.id);
      saved.html[s.id] = serialize(s);
    });
    buildRail();
    if (!pres) show(cur);
  }
  if (!deck.theme && kit.hostTheme) kit.hostTheme(function () { if (!dsTheme) relayout(); });
  /** A design system's tokens as a slide theme: its colors by role (found by name), its fonts. */
  function themeFromDs(ds) {
    var st = h("style", { text: window.dsKit.css(ds) });
    document.head.appendChild(st);
    var themes = window.dsKit.themes(ds), host = kit.hostTheme && kit.hostTheme();
    var mode = host && themes.some(function (t) { return t.id === host.mode; }) ? host.mode : themes[0] ? themes[0].id : null;
    if (mode) document.documentElement.setAttribute("data-ds-theme", mode);
    var probe = h("div", mode ? { "data-theme": mode } : {});
    document.body.appendChild(probe);
    var cs = getComputedStyle(probe), toks = ((ds.tokens.color || {}).tokens || []).map(function (t) {
      var v = cs.getPropertyValue("--" + t.name).trim(), c = /^rgba?\(([^)]+)\)/.exec((probe.style.color = "", probe.style.color = v, getComputedStyle(probe).color));
      var p = c ? c[1].split(/[\s,\/]+/).map(Number) : null, mx = p ? Math.max(p[0], p[1], p[2]) : 0, mn = p ? Math.min(p[0], p[1], p[2]) : 0;
      return { name: t.name, usage: String(t.usage || ""), v: v, ok: !!p && (p.length < 4 || p[3] > 0.9), L: p ? (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255 : 0, C: (mx - mn) / 255 };
    }).filter(function (t) { return t.ok; });
    function pick(nameRe, usageRe) {
      var t = toks.find(function (x) { return nameRe.test(x.name); }) || (usageRe && toks.find(function (x) { return usageRe.test(x.usage); }));
      return t ? t.v : undefined;
    }
    var dark = mode ? /dark|night/i.test(mode) : false;
    var byL = toks.slice().sort(function (a, b) { return a.L - b.L; }), byC = toks.slice().sort(function (a, b) { return b.C - a.C; });
    var bgT = pick(/^(bg|background|surface|canvas|paper|page)/i, /(page|app|slide)?\s*background|the ground/i) || (byL.length ? (dark ? byL[0] : byL[byL.length - 1]).v : undefined);
    var fam = (ds.tokens.type || {}).families || {};
    function font(re) { var k = Object.keys(fam).find(function (x) { return re.test(x); }); return k ? fam[k] : undefined; }
    var th = { mode: mode === "light" ? "light" : mode === "dark" ? "dark" : undefined,
      bg: bgT, surface: pick(/^(surface|card|panel|raised)|-raised$/i, /cards?|raised|panel/i),
      fg: pick(/^(ink|fg|text|foreground|on-?surface)$/i, /^(body )?text|text on/i) || (byL.length ? (dark ? byL[byL.length - 1] : byL[0]).v : undefined),
      muted: pick(/(muted|secondary|subtle|ink-?2|text-?2)/i, /secondary text|muted|captions?/i),
      line: pick(/(line|border|divider|rule)/i, /borders?|dividers?|hairline/i),
      accent: pick(/(accent|brand|primary)$/i, /accent|brand colou?r|primary (action|button)|call to action/i) || (byC[0] && byC[0].C > 0.15 ? byC[0].v : undefined),
      accent2: pick(/(accent-?2|secondary-?accent|highlight)/i, /second(ary)? accent|highlight/i) || (byC[1] && byC[1].C > 0.15 ? byC[1].v : undefined),
      font: font(/^(sans|body|text)/i) || font(/./), headingFont: font(/^(display|heading|serif|head)/i) || font(/^(sans|body)/i) };
    probe.remove();
    if (th.mode === undefined) th.mode = dark ? "dark" : "light"; // themeOf only needs light/dark for its own defaults
    return th;
  }
  if (!deck.theme && window.dsKit && window.hermes && window.hermes.ds) {
    window.dsKit.load(deck.designSystem || null).then(function (ds) {
      if (!ds || !ds.tokens) return;
      dsTheme = themeFromDs(ds);
      relayout();
    }).catch(function () {});
  }
  new ResizeObserver(fit).observe(stageWrap);
  window.addEventListener("beforeunload", function () { if (pending) save(); });
  kit.ready();
})();
