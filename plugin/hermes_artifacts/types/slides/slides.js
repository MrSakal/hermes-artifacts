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
  window.__hermesDefer = true; // the host's "ready" comes from kit.ready(), after the first real render
  // The UI's words in the app's language (hu over en, key by key); messages to Hermes are always English.
  function pickLang(t, l) { var o = {}, k; for (k in t.en) o[k] = t.en[k]; for (k in t[l] || {}) o[k] = t[l][k]; return o; }
  var kit = window.kit, h = kit.h, C = kit.content;
  var W = 1920, H = 1080;
  var L = /^hu\b/i.test(kit.content.lang || navigator.language || "") ? "hu" : "en";
  var T = pickLang({
    en: { noHost: "Not connected to Hermes: changes won't be saved.", color: "Text color", textStyle: "Text style", comment: "Comment", hiddenTag: "Hidden: skipped when presenting", addSection: "Add section",
      delSection: "Remove section", sectionPh: "Section name", newSection: "Section",
      present: "Present", grid: "All slides", notes: "Notes", exp: "Export", pdf: "PDF", pptx: "PowerPoint (.pptx)",
      png: "This slide (PNG)", html: "Web page (HTML)", save: "Save", saving: "Saving…", saved: "Saved", notSaved: "Not saved",
      conflict: "Changed meanwhile: the new version loads", noSave: "Can't save here",
      building: "Building…", bad: "deck.json is missing or not valid JSON.", empty: "This deck has no slides yet.",
      noLib: "The export library didn't load (open the deck in Hermes Desktop)", of: "of", nonotes: "No notes for this slide.",
      insert: "Insert", text: "Text box", image: "Image…", rect: "Rectangle", ellipse: "Ellipse", newSlide: "New slide",
      dup: "Duplicate", del: "Delete", front: "Bring to front", back: "Send to back",
      align: "Align", bold: "Bold", italic: "Italic", underline: "Underline",
      ask: "Ask Hermes", askPh: "Ask Hermes about this…", sent: "Sent to the chat", undo: "Undo", redo: "Redo",
      next: "Next", end: "End of the deck", pause: "Pause", reset: "Reset timer", exitP: "Exit", notesPh: "Speaker notes…",
      tooBig: "Images up to 8 MB", lastSlide: "A deck keeps at least one slide", textSize: "Notes text size",
      phTitle: "Title", phSub: "Subtitle", phText: "Text", phPoints: ["First point", "Second point", "Third point"],
      phSection: "Section", phQuote: "A sentence worth repeating.", phBy: "Someone", phMetric: "Metric", phClosing: "Thank you",
      phHeading: "Heading", phKicker: "Kicker",
      lTitle: "Title", lSection: "Section", lBullets: "Bullets", lKpis: "Big numbers", lTwo: "Two columns", lQuote: "Quote",
      lClosing: "Closing", lBlank: "Blank", lTable: "Table",
      table: "Table", shapes: "Shapes", rounded: "Rounded rectangle", diamond: "Diamond", arrowR: "Arrow right", arrowL: "Arrow left",
      arrowU: "Arrow up", arrowD: "Arrow down", line: "Line", props: "Properties", zoom: "Zoom", zoomIn: "Zoom in", zoomOut: "Zoom out",
      fitSlide: "Fit the slide", presentNotes: "Present with speaker notes", showNotes: "Speaker notes", showThumbs: "Slide thumbnails",
      hideThumbs: "Hide thumbnails", oneSlide: "One slide", prev: "Previous slide", nextSlide: "Next slide", more: "More",
      pSlide: "Slide", pTransition: "Transition", trNone: "None", trFade: "Fade", trPush: "Push", trMagic: "Magic move",
      pAppearance: "Appearance", pBackground: "Background", pSize: "Size", pX: "X", pY: "Y", pWidth: "Width", pHeight: "Height",
      pText: "Text", pStyle: "Text style", pCustom: "Custom", pFontSize: "Size", pWeight: "Weight", pLine: "Line height", pTrack: "Spacing",
      pColor: "Color", pAlign: "Align", pOpacity: "Opacity", pRadius: "Radius", pBorder: "Border", pShadow: "Shadow", pEffects: "Effects",
      none: "None", wRegular: "Regular", wMedium: "Medium", wSemi: "Semibold", wBold: "Bold", wLight: "Light",
      bSolid: "Solid", bDashed: "Dashed", bDotted: "Dotted", cut: "Cut", copy: "Copy", paste: "Paste", addAfter: "Add slide after",
      skip: "Skip slide", unskip: "Don't skip slide", moveLeft: "Move left", moveRight: "Move right", delSlide: "Delete slide", dupSlide: "Duplicate slide",
      th1: "Column",
      pSizing: "Sizing", szFill: "Fill", szHug: "Hug contents", szFixed: "Fixed", pLayout: "Layout", pDirection: "Direction", dirRow: "Row",
      dirCol: "Column", pGap: "Gap", pPadding: "Padding", detach: "Free position",
      about: function (n, id, title, label) { return "(slide " + n + " “" + title + "”, id " + id + (label ? ", element “" + label + "”" : "") + ")"; } },
    hu: { noHost: "Nincs kapcsolat a Hermesszel: a módosítások nem mentődnek.", color: "Szövegszín", textStyle: "Szövegstílus", comment: "Megjegyzés", hiddenTag: "Rejtett: vetítéskor kimarad", addSection: "Szakasz hozzáadása",
      delSection: "Szakasz törlése", sectionPh: "Szakasz neve", newSection: "Szakasz",
      present: "Vetítés", grid: "Összes dia", notes: "Jegyzetek", exp: "Exportálás", pdf: "PDF", pptx: "PowerPoint (.pptx)",
      png: "Ez a dia (PNG)", html: "Weboldal (HTML)", save: "Mentés", saving: "Mentés…", saved: "Elmentve", notSaved: "Nincs mentve",
      conflict: "Közben megváltozott: betöltöm az új verziót", noSave: "Itt nem lehet menteni",
      building: "Készül…", bad: "A deck.json hiányzik, vagy nem érvényes JSON.", empty: "Ebben a diasorban még nincs dia.",
      noLib: "Az export könyvtár nem töltődött be (nyisd meg a Hermes Desktopban)", of: "/", nonotes: "Ehhez a diához nincs jegyzet.",
      insert: "Beszúrás", text: "Szövegdoboz", image: "Kép…", rect: "Téglalap", ellipse: "Ellipszis", newSlide: "Új dia",
      dup: "Másolat", del: "Törlés", front: "Előre hozás", back: "Hátra küldés",
      align: "Igazítás", bold: "Félkövér", italic: "Dőlt", underline: "Aláhúzott",
      ask: "Kérdezd a Hermest", askPh: "Kérdezd a Hermest erről…", sent: "Elküldve a chatbe", undo: "Visszavonás", redo: "Mégis",
      next: "Következő", end: "A diasor vége", pause: "Szünet", reset: "Időmérő nullázása", exitP: "Kilépés", notesPh: "Előadói jegyzet…",
      tooBig: "Legfeljebb 8 MB-os kép", lastSlide: "Legalább egy dia marad", textSize: "Jegyzet betűmérete",
      phTitle: "Cím", phSub: "Alcím", phText: "Szöveg", phPoints: ["Első pont", "Második pont", "Harmadik pont"],
      phSection: "Fejezet", phQuote: "Egy mondat, amit érdemes megismételni.", phBy: "Valaki", phMetric: "Mutató", phClosing: "Köszönöm",
      phHeading: "Alcím", phKicker: "Felcím",
      lTitle: "Címdia", lSection: "Fejezet", lBullets: "Felsorolás", lKpis: "Nagy számok", lTwo: "Két hasáb", lQuote: "Idézet",
      lClosing: "Zárás", lBlank: "Üres", lTable: "Táblázat",
      table: "Táblázat", shapes: "Alakzatok", rounded: "Lekerekített téglalap", diamond: "Rombusz", arrowR: "Nyíl jobbra", arrowL: "Nyíl balra",
      arrowU: "Nyíl fel", arrowD: "Nyíl le", line: "Vonal", props: "Tulajdonságok", zoom: "Nagyítás", zoomIn: "Nagyítás", zoomOut: "Kicsinyítés",
      fitSlide: "Dia illesztése", presentNotes: "Vetítés előadói jegyzetekkel", showNotes: "Előadói jegyzetek", showThumbs: "Diák bélyegképei",
      hideThumbs: "Bélyegképek elrejtése", oneSlide: "Egy dia", prev: "Előző dia", nextSlide: "Következő dia", more: "Továbbiak",
      pSlide: "Dia", pTransition: "Áttűnés", trNone: "Nincs", trFade: "Áttűnés", trPush: "Betolás", trMagic: "Varázsmozgás",
      pAppearance: "Megjelenés", pBackground: "Háttér", pSize: "Méret", pX: "X", pY: "Y", pWidth: "Szélesség", pHeight: "Magasság",
      pText: "Szöveg", pStyle: "Szövegstílus", pCustom: "Egyéni", pFontSize: "Méret", pWeight: "Vastagság", pLine: "Sorköz", pTrack: "Betűköz",
      pColor: "Szín", pAlign: "Igazítás", pOpacity: "Átlátszatlanság", pRadius: "Lekerekítés", pBorder: "Keret", pShadow: "Árnyék", pEffects: "Effektek",
      none: "Nincs", wRegular: "Normál", wMedium: "Közepes", wSemi: "Félkövér", wBold: "Kövér", wLight: "Vékony",
      bSolid: "Folytonos", bDashed: "Szaggatott", bDotted: "Pontozott", cut: "Kivágás", copy: "Másolás", paste: "Beillesztés", addAfter: "Új dia utána",
      skip: "Dia kihagyása", unskip: "Dia ne maradjon ki", moveLeft: "Balra", moveRight: "Jobbra", delSlide: "Dia törlése", dupSlide: "Dia másolata",
      th1: "Oszlop",
      pSizing: "Méretezés", szFill: "Kitöltés", szHug: "Tartalomhoz igazodik", szFixed: "Fix", pLayout: "Elrendezés", pDirection: "Irány", dirRow: "Vízszintes",
      dirCol: "Függőleges", pGap: "Térköz", pPadding: "Belső margó", detach: "Szabad elhelyezés" }
  }, L);
  kit.degraded(T.noHost); // no host: said once; the page still shows what it has

  var deck = kit.json("deck.json", null);
  var bar = document.getElementById("sl-bar"), rail = document.getElementById("sl-rail");
  var stageWrap = document.getElementById("sl-stage-wrap"), stage = document.getElementById("sl-stage");
  var notesEl = document.getElementById("sl-notes");
  bar.hidden = true; // Claude's deck has no bar: its tools float over the stage, thumbnails sit below, properties at the right
  var mainEl = document.getElementById("sl-main"), strip = document.getElementById("sl-strip"), stripHead = document.getElementById("sl-striphead"),
    propsEl = document.getElementById("sl-props");
  if (!deck) { document.body.appendChild(h("div", { "class": "kit-empty", text: T.bad })); kit.ready(); return; }
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
  /** The deck's theme: its own, else its design system's, else the layouts' fixed default look. Never Hermes' theme: the app's
   *  colours are for the editor around the slides; a deck looks the same whoever opens it, in whatever theme. */
  var dsColors = [], dsStyles = []; // the deck's design system: its colors and text styles, for the menus
  var dsTheme = null; // the deck's design system (the copy deck.designSystems[0] records), as a theme
  var dsRec = (Array.isArray(deck.designSystems) && deck.designSystems[0]) || deck.designSystem || null;
  function deckTheme() {
    if (deck.theme) return deck.theme;
    return dsTheme; // null: the layouts' own defaults
  }
  (Array.isArray(deck.slides) ? deck.slides : []).forEach(function (d) {
    if (d && ID.test(d.id || "")) { defs[d.id] = d; if (order.indexOf(d.id) < 0) order.push(d.id); }
  });
  var slides = order.filter(function (id) { return fileIds[id] || defs[id]; }).map(function (id) {
    var html = kit.fileText("slides/" + id + ".html"), layout = null;
    if (html == null && window.slideLayout) { html = window.slideLayout(defs[id], deckTheme()); layout = defs[id].layout || "bullets"; }
    var sec = clean(html, id), d = defs[id];
    if (layout && d.hidden) sec.setAttribute("data-hidden", "");
    if (layout && typeof d.section === "string") sec.setAttribute("data-section", d.section.slice(0, 80));
    return { id: id, sec: sec, layout: layout };
  });
  function isHidden(s) { return !!(s && s.sec.hasAttribute("data-hidden")); }
  function sectionOf(s) { return s && s.sec.hasAttribute("data-section") ? s.sec.getAttribute("data-section") : null; }
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
  var SC = 1, zoom = 0, zoomLabel = null; // zoom 0 = the slide fits its space
  function fitScale() {
    var r = stageWrap.getBoundingClientRect(), pad = C.thumb ? 0 : 48;
    var sc = Math.min((r.width - pad) / W, (r.height - pad - (C.thumb ? 0 : 56)) / H); // the pills keep clear of the slide
    return sc > 0 ? sc : 0.3;
  }
  function fit() {
    var sc = zoom || fitScale();
    SC = sc;
    stageWrap.classList.toggle("is-zoomed", !!zoom);
    if (zoomLabel) zoomLabel.textContent = Math.round(sc * 100) + "%";
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
    var thumbs = rail.querySelectorAll(".sl-thumb");
    thumbs.forEach(function (b, j) { b.classList.toggle("on", j === cur); });
    var on = thumbs[cur];
    if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
    counter.textContent = (cur + 1) + " " + T.of + " " + slides.length;
    if (notesTa) notesTa.value = notesOf(slides[cur]); else notesEl.textContent = notesOf(slides[cur]) || T.nonotes;
    drawTools(); drawProps();
    sendView();
    if (C.thumb) {
      // A card's preview: the bands around the 16:9 slide take the slide's own colour, not white.
      var placed = clip.querySelector("section"), bg = placed && getComputedStyle(placed).backgroundColor;
      if (bg && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg)) document.body.style.background = bg;
    }
    try { history.replaceState(null, "", "#slide-" + (cur + 1)); } catch (e) {}
  }

  // Slides picked in the rail (the current one, and more with Shift or Ctrl/Cmd): the menu acts on them all.
  var picked = [];
  function pickedIdx(i) {
    var ids = picked.indexOf(slides[i].id) >= 0 && picked.length > 1 ? picked : [slides[i].id];
    return slides.map(function (s, j) { return ids.indexOf(s.id) >= 0 ? j : -1; }).filter(function (j) { return j >= 0; });
  }
  function pick(i, how) {
    var id = slides[i].id;
    if (!picked.length) picked = [slides[cur].id];
    if (how === "toggle") {
      var k = picked.indexOf(id);
      if (k >= 0 && picked.length > 1) picked.splice(k, 1); else if (k < 0) picked.push(id);
    } else {
      var a = Math.min(cur, i), z = Math.max(cur, i);
      picked = slides.slice(a, z + 1).map(function (s) { return s.id; });
    }
    rail.querySelectorAll(".sl-thumb").forEach(function (b, j) { b.classList.toggle("picked", picked.indexOf(slides[j].id) >= 0); });
  }
  var dragFrom = null, dropLine = h("div", { "class": "sl-drop", hidden: true });
  function thumb(s, i, caption) {
    var box = h("div", { "class": "sl-box" });
    var b = h("button", { "class": "sl-thumb" + (isHidden(s) ? " is-hidden" : "") + (!caption && picked.indexOf(s.id) >= 0 ? " picked" : ""),
      type: "button", title: isHidden(s) ? titleOf(s) + " · " + T.hiddenTag : titleOf(s), onclick: function (e) {
        if (!caption && editable && (e.shiftKey || e.ctrlKey || e.metaKey)) return pick(i, e.shiftKey ? "range" : "toggle");
        closeGrid(); picked = [s.id]; show(i);
      } },
      [caption ? null : h("span", { "class": "sl-num", text: String(i + 1) }), box,
       caption ? h("span", { "class": "sl-cap", text: (i + 1) + ". " + titleOf(s) }) : null]);
    if (editable && !caption) {
      b.draggable = true;
      b.addEventListener("dragstart", function (e) { dragFrom = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "slide " + i); });
      b.addEventListener("dragend", function () { dragFrom = null; dropLine.hidden = true; });
      b.addEventListener("contextmenu", function (e) { e.preventDefault(); if (i !== cur) show(i); slideMenu(b, i); });
    }
    queueThumb(box, function (w) { return canvasFor(s, (w || 160) / W, false); });
    return b;
  }
  // Thumbnails are drawn a frame later, every box measured before any is filled: one layout for the
  // whole rail instead of one per slide.
  var thumbQ = [];
  function queueThumb(box, make) {
    if (thumbQ.push([box, make]) > 1) return;
    requestAnimationFrame(function () {
      var q = thumbQ; thumbQ = [];
      var ws = q.map(function (x) { return x[0].clientWidth; });
      q.forEach(function (x, k) { x[0].appendChild(x[1](ws[k])); });
    });
  }
  function sectionHead(s, i) {
    var name = sectionOf(s);
    if (name == null) return null;
    if (!editable) return h("div", { "class": "sl-sec", text: name || T.newSection });
    var inp = h("input", { "class": "sl-sec", type: "text", value: name, placeholder: T.sectionPh, "aria-label": T.sectionPh, maxlength: "80" });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); inp.blur(); } e.stopPropagation(); });
    inp.addEventListener("change", function () {
      checkpoint();
      slides[i].sec.setAttribute("data-section", inp.value.trim().slice(0, 80));
      changed();
    });
    return inp;
  }
  function buildRail() {
    var items = [];
    slides.forEach(function (s, i) { var hd = sectionHead(s, i); if (hd) items.push(hd); items.push(thumb(s, i, false)); });
    rail.replaceChildren.apply(rail, items.concat(editable ? [dropLine] : []));
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
  function dropIndex(x) { // the thumbnails run left to right
    var th = rail.querySelectorAll(".sl-thumb");
    for (var k = 0; k < th.length; k++) { var r = th[k].getBoundingClientRect(); if (x < r.left + r.width / 2) return k; }
    return th.length;
  }
  rail.addEventListener("keydown", function (e) {
    if (!editable || e.target.closest("input")) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); delSlide(cur); }
  });
  rail.addEventListener("dragover", function (e) {
    if (dragFrom == null) return;
    e.preventDefault();
    var th = rail.querySelectorAll(".sl-thumb"), at = dropIndex(e.clientX), ref = th[Math.min(at, th.length - 1)];
    var rr = rail.getBoundingClientRect(), r = ref.getBoundingClientRect();
    dropLine.hidden = false;
    dropLine.style.left = (at < th.length ? r.left - 6 : r.right + 3) - rr.left + rail.scrollLeft + "px";
  });
  rail.addEventListener("drop", function (e) {
    if (dragFrom == null) return;
    e.preventDefault();
    moveSlide(dragFrom, dropIndex(e.clientX));
    dragFrom = null; dropLine.hidden = true;
  });

  var gridEl = null;
  function openGrid() {
    if (gridEl) return closeGrid();
    select([]);
    var kids = [];
    slides.forEach(function (s, i) {
      var name = sectionOf(s);
      if (name != null) kids.push(h("div", { "class": "sl-gsec", text: name || T.newSection }));
      var cell = h("div", { "class": "sl-gcell" }, [thumb(s, i, true)]), n = notesOf(s);
      if (n) cell.appendChild(h("div", { "class": "sl-gnote", text: n }));
      kids.push(cell);
    });
    gridEl = h("div", { id: "sl-grid" }, kids);
    mainEl.appendChild(gridEl);
    drawChrome(); drawProps(); sendView();
  }
  function closeGrid() { if (gridEl) { gridEl.remove(); gridEl = null; drawChrome(); } }

  // ------------------------------------------------------------------ view context (with the next chat message)
  function itemIndex(el) { var sec = el.parentElement; return sec ? Array.prototype.indexOf.call(sec.children, el) : -1; }
  function selectorOf(el) { // "#slide > :nth-child(2) > :nth-child(1)": the way down from the slide's section
    if (!el) return null;
    var sec = el.closest("section"), path = "";
    for (var n = el; n && n !== sec; n = n.parentElement) path = " > :nth-child(" + (itemIndex(n) + 1) + ")" + path;
    return sec ? "#" + sec.id + path : null;
  }
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
        hidden: isHidden(s), section: sectionOf(s), editingText: !!editing, dirty: pending, selected: info.map(function (x) { return x.label; }), selection: info };
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
      if (r && r.conflict) { stopped = true; status("failed"); kit.toast(T.conflict); if (window.hermes.history) window.hermes.history.show(null); return; }
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
    { label: T.lBlank, def: function () { return { layout: "blank" }; } },
    { label: T.lTitle, def: function () { return { layout: "title", kicker: T.phKicker, title: T.phTitle, subtitle: T.phSub }; } },
    { label: T.lSection, def: function () { return { layout: "section", number: ("0" + (cur + 2)).slice(-2), title: T.phSection }; } },
    { label: T.lBullets, def: function () { return { layout: "bullets", title: T.phTitle, bullets: T.phPoints.slice() }; } },
    { label: T.lKpis, def: function () { return { layout: "kpis", title: T.phTitle, items: [1, 2, 3].map(function (n) { return { label: T.phMetric + " " + n, value: String(n * 12), delta: "+" + n * 4 + "%" }; }) }; } },
    { label: T.lTwo, def: function () { return { layout: "two-col", title: T.phTitle, left: { heading: T.phHeading, accent: true, bullets: T.phPoints.slice(0, 2) }, right: { heading: T.phHeading, text: T.phText } }; } },
    { label: T.lQuote, def: function () { return { layout: "quote", quote: T.phQuote, by: T.phBy }; } },
    { label: T.lTable, def: function () { return { layout: "table", title: T.phTitle, columns: [1, 2, 3].map(function (n) { return T.th1 + " " + n; }),
      rows: [1, 2, 3].map(function () { return ["", "", ""]; }) }; } },
    { label: T.lClosing, def: function () { return { layout: "closing", title: T.phClosing }; } }
  ];
  /** New slide: a dialog of the layouts, each drawn as it will look in this deck's theme (Claude's). */
  var layoutDlg = null;
  function closeLayouts() { if (layoutDlg) { layoutDlg.remove(); layoutDlg = null; } }
  function layoutMenu(anchor, after) {
    closeLayouts();
    var grid = h("div", { "class": "sl-newgrid" }, LAYOUTS.map(function (x) {
      var box = h("div", { "class": "sl-box" });
      var b = h("button", { type: "button", "class": "sl-newitem", onclick: function () { closeLayouts(); addSlide(x.def(), after); } }, [box, h("span", { text: x.label })]);
      queueThumb(box, function (w) {
        var def = x.def(); def.id = "preview";
        return canvasFor({ sec: clean(window.slideLayout(def, deckTheme()), "preview") }, (w || 200) / W, false);
      });
      return b;
    }));
    var x0 = h("button", { type: "button", "class": "kit-btn", title: T.exitP, "aria-label": T.exitP, html: kit.icon("close"), onclick: closeLayouts });
    layoutDlg = h("div", { "class": "sl-modal", onmousedown: function (e) { if (e.target === layoutDlg) closeLayouts(); } },
      [h("div", { "class": "sl-dialog", role: "dialog", "aria-label": T.newSlide }, [h("div", { "class": "sl-dhead" }, [h("b", { text: T.newSlide }), x0]), grid])]);
    layoutDlg.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Escape") closeLayouts(); });
    document.body.appendChild(layoutDlg);
    var first = grid.querySelector("button"); if (first) first.focus();
  }
  function addSlide(def, after) {
    checkpoint();
    def.id = newId();
    slides.splice(after + 1, 0, { id: def.id, sec: clean(window.slideLayout(def, deckTheme()), def.id), layout: null });
    buildRail(); show(after + 1); changed();
  }
  function dupSlide(i) {
    var idx = pickedIdx(i), last = idx[idx.length - 1], copies = [];
    checkpoint();
    idx.forEach(function (j) { var id = newId(); copies.push({ id: id, sec: clean(serialize(slides[j]), id), layout: null }); });
    slides.splice.apply(slides, [last + 1, 0].concat(copies));
    picked = copies.map(function (c) { return c.id; });
    buildRail(); show(last + 1); changed();
  }
  function delSlide(i) {
    var idx = pickedIdx(i);
    if (slides.length - idx.length < 1) return kit.toast(T.lastSlide);
    checkpoint();
    idx.slice().reverse().forEach(function (j) { slides.splice(j, 1); });
    i = idx[0]; picked = [];
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
      { label: T.dupSlide, onClick: function () { dupSlide(i); } },
      { label: isHidden(slides[i]) ? T.unskip : T.skip, onClick: function () { toggleHidden(i); } },
      sectionOf(slides[i]) == null ? { label: T.addSection, onClick: function () { setSection(i, T.newSection); } }
        : { label: T.delSection, onClick: function () { setSection(i, null); } },
      { label: T.addAfter, onClick: function () { layoutMenu(anchor, i); } },
      { label: T.moveLeft, onClick: function () { moveSlide(i, i - 1); } },
      { label: T.moveRight, onClick: function () { moveSlide(i, i + 2); } },
      { label: T.delSlide, onClick: function () { delSlide(i); } }
    ]);
  }
  function toggleHidden(i) {
    checkpoint();
    var hide = !isHidden(slides[i]);
    pickedIdx(i).forEach(function (j) { var sec = slides[j].sec; if (hide) sec.setAttribute("data-hidden", ""); else sec.removeAttribute("data-hidden"); });
    buildRail(); show(i); changed();
  }
  function setSection(i, name) {
    checkpoint();
    if (name == null) slides[i].sec.removeAttribute("data-section"); else slides[i].sec.setAttribute("data-section", name);
    buildRail(); show(i); changed();
    if (name != null) {
      var inp = rail.querySelectorAll("input.sl-sec")[slides.slice(0, i + 1).filter(function (s) { return sectionOf(s) != null; }).length - 1];
      if (inp) { inp.focus(); inp.select(); }
    }
  }

  // ------------------------------------------------------------------ elements: select, move, resize
  var sel = [], editing = null, editSnap = false;
  var TEXT = "h1,h2,h3,h4,h5,h6,p,li,td,th,span,b,i,u,a,div,blockquote";
  function hasOwnText(el) { return Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); }); }
  function isTextBox(el) { return /^(H[1-6]|P|UL|OL|BLOCKQUOTE|TABLE)$/.test(el.tagName) || (el.tagName === "DIV" && hasOwnText(el) && !el.children.length); }
  function itemsOf(sec) {
    return Array.prototype.filter.call(sec ? sec.children : [], function (el) { return el.tagName !== "ASIDE" && !el.hasAttribute("data-deco"); });
  }
  /** What a click selects (as in Claude's deck): the innermost thing with a look of its own under the pointer: a text block,
   *  a picture, a shape, a painted box (a card). A bare container is passed through; at the slide's top level anything counts. */
  function painted(el) {
    var cs = getComputedStyle(el);
    return !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor) || cs.backgroundImage !== "none" || cs.boxShadow !== "none" ||
      (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none");
  }
  function selectable(el, sec) {
    if (/^(H[1-6]|P|UL|OL|TABLE|IMG|BLOCKQUOTE)$/.test(el.tagName) || el.hasAttribute("data-shape")) return true;
    if (el.tagName.toLowerCase() === "svg") return true;
    if (el.tagName === "DIV") return el.parentElement === sec || painted(el) || (hasOwnText(el) && !el.children.length);
    return el.parentElement === sec;
  }
  function itemOf(t) {
    var sec = curSec();
    if (!t || !sec || t === sec || !sec.contains(t)) return null;
    if (t.closest("aside, [data-deco]")) return null;
    var svg = t.closest("svg"); // a drawing is one thing
    while (svg && svg.parentElement && svg.parentElement.closest("svg")) svg = svg.parentElement.closest("svg");
    for (var n = svg || t; n && n !== sec; n = n.parentElement) if (selectable(n, sec)) return n;
    return null;
  }
  /** Pinned to its place (position:absolute), as against a flow child laid out by its container. */
  function isFree(el) { return getComputedStyle(el).position === "absolute"; }
  /** A pinned element's place written out in px (left, top, width as drawn), so moving and sizing it is plain arithmetic. */
  function freeze(el) {
    var cs = getComputedStyle(el), st = el.style, l = parseFloat(cs.left), t = parseFloat(cs.top);
    st.boxSizing = "border-box";
    st.width = R(el.offsetWidth) + "px";
    if (!isTextBox(el)) st.height = R(el.offsetHeight) + "px";
    st.left = R(isFinite(l) ? l : 0) + "px"; st.top = R(isFinite(t) ? t : 0) + "px";
    st.right = st.bottom = "auto";
  }
  /** Take a flow child out of its container: pinned on the slide where it is drawn now, with the look it had there. */
  function detach() {
    var sec = curSec(), aside = sec.querySelector(":scope > aside");
    var list = sel.filter(function (el) { return !isFree(el); }).map(function (el) { var cs = getComputedStyle(el); return { el: el, b: rectOf(el), color: cs.color, font: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, align: cs.textAlign }; });
    if (!list.length) return;
    checkpoint();
    list.forEach(function (x) {
      var st = x.el.style;
      sec.insertBefore(x.el, aside);
      st.position = "absolute"; st.left = R(x.b.x) + "px"; st.top = R(x.b.y) + "px"; st.width = R(x.b.w) + "px";
      if (!isTextBox(x.el)) st.height = R(x.b.h) + "px";
      st.right = st.bottom = "auto"; st.margin = "0"; st.boxSizing = "border-box"; st.flex = "none";
      if (x.el.textContent.trim()) { st.color = x.color; st.fontFamily = x.font; st.fontSize = x.size; st.fontWeight = x.weight; st.textAlign = x.align; }
    });
    drawSel(); drawTools(); drawProps(); changed();
  }
  /** Dragging a flow child moves it among its siblings (the container lays them out again). */
  function reorder(el, ev) {
    var par = el.parentElement, sibs = Array.prototype.filter.call(par.children, function (x) { return x !== el && x.tagName !== "ASIDE" && !x.hasAttribute("data-deco") && !isFree(x); });
    var pcs = getComputedStyle(par), row = pcs.display === "grid" || (/flex/.test(pcs.display) && /^row/.test(pcs.flexDirection));
    for (var k = 0; k < sibs.length; k++) {
      var r = sibs[k].getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) continue;
      var before = row ? ev.clientX < r.left + r.width / 2 : ev.clientY < r.top + r.height / 2, ref = before ? sibs[k] : sibs[k].nextSibling;
      if (ref === el || el.nextSibling === ref) return false;
      par.insertBefore(el, ref);
      return true;
    }
    return false;
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
  function select(list) {
    sel = list.filter(Boolean);
    drawSel(); drawTools(); drawProps(); sendView();
  }
  var HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  function drawSel(lines) {
    ov.replaceChildren();
    if (!editable || pres) return;
    sel = sel.filter(function (el) { return el.isConnected && curSec().contains(el); });
    var rects = sel.map(rectOf); // measured before the overlay changes: one layout, not one per box
    sel.forEach(function (el, k) {
      var b = rects[k];
      ov.appendChild(h("div", { "class": "sl-selbox" + (el === editing || (editing && el.contains(editing)) ? " is-editing" : ""),
        style: "left:" + b.x * SC + "px;top:" + b.y * SC + "px;width:" + b.w * SC + "px;height:" + b.h * SC + "px" }));
    });
    if (sel.length === 1 && !editing) {
      var b = rects[0];
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
    var x0 = e.clientX, y0 = e.clientY, started = false, items = sel.slice(), boxes, u0, tg, at;
    var img = items.length === 1 && /^(IMG|SVG)$/i.test(items[0].tagName);
    var free = items.every(isFree), moved = false;
    function move(ev) {
      var dx = (ev.clientX - x0) / SC, dy = (ev.clientY - y0) / SC;
      if (!started) {
        if (Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
        started = true; checkpoint();
        if (free) items.forEach(freeze);
        boxes = items.map(rectOf); u0 = union(boxes); tg = targets(items);
        at = items.map(function (el) { return { l: parseFloat(el.style.left) || 0, t: parseFloat(el.style.top) || 0 }; });
      }
      if (mode === "move" && !free) { // a flow child: its place among its siblings
        if (items.length === 1 && reorder(items[0], ev)) moved = true;
        drawSel();
        return;
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
        items.forEach(function (el, k) { el.style.left = R(at[k].l + dx) + "px"; el.style.top = R(at[k].t + dy) + "px"; });
        moved = true;
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
        moved = true;
        if (free) {
          st.left = R(at[0].l + nx - b.x) + "px"; st.top = R(at[0].t + ny - b.y) + "px"; st.width = R(w) + "px";
          if (/[ns]/.test(hd) || !isTextBox(items[0])) st.height = R(hh) + "px";
        } else { // a flow child takes a size of its own; its container lays the rest out around it
          st.flex = "none"; st.boxSizing = "border-box";
          if (/[ew]/.test(hd)) st.width = R(w) + "px";
          if (/[ns]/.test(hd)) st.height = R(hh) + "px";
        }
      }
      drawSel(lines);
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (started) { drawSel(); drawProps(); if (moved) changed(); else undos.pop(); }
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
      // Claude's order: the face and size, the colour, then the marks and the alignment.
      var cs0 = getComputedStyle(sel[0]), al = (sel[0].style.textAlign || cs0.textAlign);
      var face = (cs0.fontFamily.split(",")[0] || "").replace(/["']/g, "").trim();
      var tsB = tbtn("text", T.textStyle, function () { styleMenu(tsB); });
      tsB.classList.add("sl-tface");
      tsB.appendChild(h("span", { text: (face ? face + " · " : "") + R(parseFloat(cs0.fontSize)) }));
      tsB.insertAdjacentHTML("beforeend", kit.icon("caretDown"));
      var colB = h("button", { type: "button", "class": "kit-btn sl-tcolor", title: T.color, "aria-label": T.color }, [h("i", { style: "background:" + cs0.color })]);
      colB.addEventListener("mousedown", function (e) { e.preventDefault(); });
      colB.addEventListener("click", function () { colorMenu(colB); });
      kids.push(tsB, colB);
      if (!editing) {
        kids.push(tbtn("bold", T.bold, function () { toggleMark("fontWeight", parseInt(cs0.fontWeight, 10) >= 600 ? "400" : "700"); }, parseInt(cs0.fontWeight, 10) >= 600),
          tbtn("italic", T.italic, function () { toggleMark("fontStyle", cs0.fontStyle === "italic" ? "normal" : "italic"); }, cs0.fontStyle === "italic"),
          tbtn("underline", T.underline, function () { toggleMark("textDecoration", /underline/.test(cs0.textDecorationLine) ? "none" : "underline"); }, /underline/.test(cs0.textDecorationLine)));
      }
      kids.push(tbtn(al === "center" ? "alignC" : al === "right" || al === "end" ? "alignR" : "alignL", T.align, cycleAlign), sep());
    }
    kids.push(tbtn("sparkle", T.ask, askAbout));
    if (window.hermes && window.hermes.comment && sel.length === 1) {
      // A comment on this element (Claude's): the host opens its comment form there; the thread names the slide.
      kids.push(tbtn("comment", T.comment, function () {
        var el = sel[0], s = slides[cur];
        window.hermes.comment({ selector: selectorOf(el), text: el.textContent.trim().slice(0, 200),
          label: (cur + 1 + ". " + titleOf(s) + " · " + labelOf(el)).slice(0, 60) });
      }));
    }
    var moreB = tbtn("more", T.more, function () {
      var flow = sel.some(function (el) { return !isFree(el); });
      kit.menu(moreB, (flow ? [{ label: T.detach, onClick: detach }] : [{ label: T.front, onClick: function () { restack(true); } }, { label: T.back, onClick: function () { restack(false); } }])
        .concat([{ label: T.dup, onClick: duplicate }, { label: T.del, onClick: removeSel }]));
    });
    kids.push(moreB);
    tools.replaceChildren.apply(tools, kids);
    tools.hidden = false;
    placeTools();
  }
  function toggleMark(prop, value) {
    checkpoint();
    sel.forEach(function (el) { el.style[prop] = value; });
    drawSel(); drawTools(); drawProps(); changed();
  }
  function placeTools() {
    if (tools.hidden || !sel.length) return;
    var sr = stage.getBoundingClientRect(), u = union(sel.map(rectOf));
    var top = sr.top + u.y * SC - tools.offsetHeight - 10;
    if (top < 50) top = sr.top + (u.y + u.h) * SC + 10;
    tools.style.top = Math.max(50, Math.min(innerHeight - tools.offsetHeight - 8, top)) + "px";
    tools.style.left = Math.max(8, Math.min(innerWidth - tools.offsetWidth - 8, sr.left + u.x * SC)) + "px";
  }
  /** Text color: the design system's colors (else the deck theme's), as their values in the slide. */
  function colorMenu(anchor) {
    var th = deckTheme() || {}, list = dsColors.length ? dsColors
      : ["fg", "accent", "muted", "bg"].filter(function (k) { return th[k]; }).map(function (k) { return { name: k, v: th[k] }; });
    kit.menu(anchor, list.slice(0, 40).map(function (c) {
      return { label: "● " + c.name, onClick: function () {
        checkpoint();
        sel.forEach(function (el) { el.style.color = c.v; });
        drawSel(); changed();
      } };
    }));
  }
  var SLIDE_SCALE = 2;
  function px(v) { var m = /^(-?[\d.]+)(px|rem|em|%)?$/.exec(String(v)); if (!m) return null; var n = +m[1]; return m[2] === "rem" || m[2] === "em" ? n * 16 : m[2] === "%" ? n * 0.16 : n; }
  /** Text style: one of the design system's styles (size, weight, line height, tracking, face). */
  function styleMenu(anchor) {
    var sizes = [24, 28, 32, 36, 44, 56, 72, 96, 120].map(function (n) {
      return { label: n + " px", onClick: function () { checkpoint(); sel.forEach(function (el) { el.style.fontSize = n + "px"; }); drawSel(); drawTools(); drawProps(); changed(); } };
    });
    kit.menu(anchor, (dsStyles.length ? [{ hint: T.pStyle }] : []).concat(dsStyles.slice(0, 40).map(function (x) {
      var st = x.st;
      // A system's sizes are for screens; a slide is a 1920px canvas seen from across a room: twice the size.
      var f = px(st.fontSize), onSlide = f ? Math.max(24, R(f * SLIDE_SCALE)) : null;
      return { label: st.name + (onSlide ? " · " + onSlide + "px" : ""), onClick: function () {
        checkpoint();
        sel.forEach(function (el) {
          if (onSlide) el.style.fontSize = onSlide + "px"; // nothing on a slide under 24px
          if (st.fontWeight) el.style.fontWeight = st.fontWeight;
          if (st.lineHeight) el.style.lineHeight = st.lineHeight;
          if (st.letterSpacing) el.style.letterSpacing = st.letterSpacing;
          if (st.fontStyle) el.style.fontStyle = st.fontStyle;
          if (x.stack) el.style.fontFamily = x.stack;
        });
        drawSel(); drawTools(); drawProps(); changed();
      } };
    })).concat([{ hint: T.pFontSize }], sizes));
  }
  function cycleAlign() {
    checkpoint();
    var a = getComputedStyle(sel[0]).textAlign, next = a === "center" ? "right" : a === "right" || a === "end" ? "left" : "center";
    sel.forEach(function (el) { el.style.textAlign = next; });
    drawTools(); changed();
  }
  function restack(front) {
    checkpoint();
    sel.forEach(function (el) { // within its own container: later paints on top; a flow child keeps its place in the layout
      if (!isFree(el)) return;
      var par = el.parentElement, aside = par.querySelector(":scope > aside");
      var decos = par.querySelectorAll(":scope > [data-deco]"), after = decos.length ? decos[decos.length - 1].nextSibling : par.firstChild;
      if (front) par.insertBefore(el, aside); else par.insertBefore(el, after);
    });
    drawSel(); changed();
  }
  function duplicate() {
    if (!sel.length) return;
    checkpoint();
    var copies = sel.map(function (el) {
      var c = el.cloneNode(true);
      if (isFree(el)) { freeze(el); c = el.cloneNode(true); c.style.left = R(parseFloat(el.style.left) + 24) + "px"; c.style.top = R(parseFloat(el.style.top) + 24) + "px"; }
      el.after(c); // a flow child's copy sits right after it, in the same container
      return c;
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
    var list = sel.filter(isFree); // a flow child has no place of its own to nudge
    if (!list.length) return;
    if (Date.now() - (nudge.at || 0) > 800) checkpoint();
    nudge.at = Date.now();
    var dx = key === "ArrowLeft" ? -n : key === "ArrowRight" ? n : 0, dy = key === "ArrowUp" ? -n : key === "ArrowDown" ? n : 0;
    list.forEach(function (el) { freeze(el); el.style.left = R(parseFloat(el.style.left) + dx) + "px"; el.style.top = R(parseFloat(el.style.top) + dy) + "px"; });
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
      window.hermes.send(text, { slide: s.id, element: selectorOf(target) }, { deliver: "send" }).then(function (r) { if (!(r && r.mode === "declined")) kit.toast(T.sent); }, function (err) { kit.toast(String(err && err.message || err)); });
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
  var SHAPES = { // each fills its box; the arrows' heads are the last 40% of their length
    rect: "", rounded: "border-radius:24px", ellipse: "border-radius:50%",
    diamond: "clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)",
    "arrow-right": "clip-path:polygon(0 25%,60% 25%,60% 0,100% 50%,60% 100%,60% 75%,0 75%)",
    "arrow-left": "clip-path:polygon(100% 25%,40% 25%,40% 0,0 50%,40% 100%,40% 75%,100% 75%)",
    "arrow-up": "clip-path:polygon(25% 100%,25% 40%,0 40%,50% 0,100% 40%,75% 40%,75% 100%)",
    "arrow-down": "clip-path:polygon(25% 0,25% 60%,0 60%,50% 100%,100% 60%,75% 60%,75% 0)",
    line: "" };
  function insertShape(kind) {
    checkpoint();
    var wide = /^arrow-(right|left)$/.test(kind), tall = /^arrow-(up|down)$/.test(kind), line = kind === "line";
    var w = line ? 480 : wide ? 400 : tall ? 200 : 400, hh = line ? 6 : wide ? 200 : tall ? 400 : 300;
    var el = place(h("div", { "data-shape": kind, style: "position:absolute;left:" + R((W - w) / 2) + "px;top:" + R((H - hh) / 2) + "px;width:" + w + "px;height:" + hh +
      "px;margin:0;box-sizing:border-box;" + (SHAPES[kind] || "") + ";background:" + accent() }));
    select([el]); changed();
  }
  function insertTable() {
    checkpoint();
    var th = window.slideTheme ? window.slideTheme(deckTheme()) : {}, line = th.line || "rgba(0,0,0,.15)";
    var row = function (tag, text) { return "<tr>" + [1, 2, 3].map(function (n) { return "<" + tag + ' style="width:33.3%;text-align:left">' + (text ? text + " " + n : "") + "</" + tag + ">"; }).join("") + "</tr>"; };
    var tpl = document.createElement("template");
    tpl.innerHTML = '<table style="position:absolute;left:260px;top:360px;width:1400px;margin:0;box-sizing:border-box;font-size:32px;border-collapse:collapse;border-top:1px solid ' + line + '">' +
      row("th", T.th1) + row("td") + row("td") + row("td") + "</table>";
    var el = place(tpl.content.firstChild);
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
    notesTa = h("textarea", { "class": "sl-notes-ta", placeholder: T.notesPh, maxlength: "4000", "aria-label": T.notes });
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
    pres = { el: h("div", { id: "sl-present", tabindex: "0" }, [main, count]), main: main, box: box, count: count,
      i: isHidden(slides[cur]) ? visible(cur, 1) : cur, steps: [],
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
    pres.clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function paint(dir) {
    var s = slides[pres.i], r = pres.main.getBoundingClientRect(), pad = pres.presenter ? 32 : 0;
    var sc = Math.min((r.width - pad) / W, (r.height - pad) / H);
    if (!(sc > 0)) sc = Math.min(innerWidth / W, innerHeight / H);
    var box = pres.box;
    box.style.width = W * sc + "px"; box.style.height = H * sc + "px";
    var next = canvasFor(s, sc, false);
    pres.steps = buildSteps(next);
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
      var nj = pres.i + 1;
      while (nj < slides.length && isHidden(slides[nj])) nj++;
      var n = slides[nj];
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
    if (el.id && el.tagName !== "SECTION") return "id:" + el.id; // the same id on both slides: the same element
    var tag = el.tagName.toLowerCase();
    if (tag === "img") return "img:" + (el.getAttribute("data-src-path") || el.getAttribute("src"));
    if (tag === "svg") return "svg:" + (el.getAttribute("aria-label") || "");
    var t = el.textContent.replace(/\s+/g, " ").trim();
    return t ? tag + ":" + t.slice(0, 300) : el.getAttribute("data-shape") ? "shape:" + el.getAttribute("style") : null;
  }
  function magicCands(sec) {
    return Array.prototype.filter.call(sec.querySelectorAll("[data-key],[id]:not(section),h1,h2,h3,h4,p,li,img,svg,table,section > div"), function (el) {
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

  /** A slide's builds, one per click: each element's way in (data-build-in) and, later, its way out
   *  (data-build-out). data-build-order="n" sets the order (lower first; ties keep the page order, ins
   *  before outs). Elements that build in start hidden. */
  var BUILD = {
    fade: { opacity: 0 }, rise: { opacity: 0, transform: "translateY(40px)" }, drop: { opacity: 0, transform: "translateY(-40px)" },
    pop: { opacity: 0, transform: "scale(.85)" }, zoom: { opacity: 0, transform: "scale(1.15)" },
    left: { opacity: 0, transform: "translateX(-80px)" }, right: { opacity: 0, transform: "translateX(80px)" },
    wipe: { clipPath: "inset(0 100% 0 0)" }
  };
  function buildSteps(cv) {
    var list = [], k = 0;
    Array.prototype.forEach.call(cv.querySelectorAll("[data-build-in],[data-build-out]"), function (n) {
      var o = parseFloat(n.getAttribute("data-build-order"));
      if (n.hasAttribute("data-build-in")) { n.setAttribute("data-build-hidden", ""); list.push({ el: n, out: false, o: isNaN(o) ? 1e6 : o, k: k++ }); }
      if (n.hasAttribute("data-build-out")) list.push({ el: n, out: true, o: isNaN(o) ? 2e6 : o + 0.5, k: k++ });
    });
    return list.sort(function (a, b) { return a.o - b.o || a.k - b.k; });
  }
  function build(st) {
    var n = st.el, reduce = !n.animate || matchMedia("(prefers-reduced-motion: reduce)").matches;
    var k = (n.getAttribute(st.out ? "data-build-out" : "data-build-in") || "fade").split(/\s+/)[0];
    var off = BUILD[k] || BUILD.fade, on = { opacity: 1, transform: "none", clipPath: off.clipPath ? "inset(0 0 0 0)" : "none" };
    if (!off.clipPath) delete on.clipPath;
    if (!st.out) {
      n.removeAttribute("data-build-hidden");
      if (!reduce) n.animate([off, on], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" });
      return;
    }
    if (reduce) { n.setAttribute("data-build-hidden", ""); return; }
    n.animate([on, off], { duration: 300, easing: "ease-in" }).finished.then(function () { n.setAttribute("data-build-hidden", ""); });
  }
  function visible(i, d) {
    for (var j = i; j >= 0 && j < slides.length; j += d) if (!isHidden(slides[j])) return j;
    return i;
  }
  function step(d) {
    if (!pres) return;
    if (d > 0 && pres.steps.length) return build(pres.steps.shift());
    var j = pres.i + d;
    while (j >= 0 && j < slides.length && isHidden(slides[j])) j += d; // hidden: skipped when presenting
    if (j < 0 || j >= slides.length) return;
    pres.i = j; paint(d);
  }
  function presKey(e) {
    var k = e.key;
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].indexOf(k) >= 0 && !(k === " " && e.shiftKey)) { e.preventDefault(); step(1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].indexOf(k) >= 0 || (k === " " && e.shiftKey)) { e.preventDefault(); step(-1); }
    else if (k === "Home") { pres.i = visible(0, 1); paint(null); }
    else if (k === "End") { pres.i = visible(slides.length - 1, -1); paint(null); }
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
            var own = { ellipse: "ellipse", diamond: "diamond", "arrow-right": "rightArrow", "arrow-left": "leftArrow", "arrow-up": "upArrow", "arrow-down": "downArrow" }[el.getAttribute("data-shape")];
            if (own) rad = 0;
            slide.addShape(own ? pptx.ShapeType[own] : rad ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
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
  // The deck's chrome, as Claude's: no bar. Insert tools and view tools float over the stage as two pills,
  // the thumbnails run in a strip below (or a small pill of arrows when the strip is put away), and the
  // properties of what is selected (the slide itself when nothing is) open at the right.
  function cbtn(html, title, fn, cls) {
    var b = h("button", { type: "button", "class": "kit-btn" + (cls ? " " + cls : ""), title: title, "aria-label": title, html: html });
    b.addEventListener("click", fn);
    return b;
  }
  function pref(key, fallback) { try { var v = localStorage.getItem("sl-" + key); return v == null ? fallback : v === "1"; } catch (e) { return fallback; } }
  function keep(key, on) { try { localStorage.setItem("sl-" + key, on ? "1" : "0"); } catch (e) {} }
  var stripOn = pref("strip", true), propsOn = pref("props", false);
  function toggleNotes() { notesEl.hidden = !notesEl.hidden; drawChrome(); fit(); }
  function setStrip(on) { stripOn = on; keep("strip", on); drawChrome(); fit(); }
  function setProps(on) { propsOn = on; keep("props", on); drawChrome(); drawProps(); fit(); }
  function setZoom(z) { zoom = z; fit(); }

  var shapesBtn = cbtn(kit.icon("shape") + kit.icon("caretDown"), T.shapes, function () {
    kit.menu(shapesBtn, [["rect", T.rect], ["rounded", T.rounded], ["ellipse", T.ellipse], ["diamond", T.diamond], ["arrow-right", T.arrowR],
      ["arrow-left", T.arrowL], ["arrow-up", T.arrowU], ["arrow-down", T.arrowD], ["line", T.line]].map(function (x) {
      return { label: x[1], onClick: function () { insertShape(x[0]); } };
    }));
  }, "sl-caret");
  var insertPill = h("div", { "class": "sl-pill sl-pill-l", role: "toolbar", "aria-label": T.insert }, [
    cbtn(kit.icon("text"), T.text, function () { insertText(); }), cbtn(kit.icon("image"), T.image, function () { filePick.click(); }),
    cbtn(kit.icon("table"), T.table, function () { insertTable(); }), shapesBtn]);

  var dlBtn = cbtn(kit.icon("download"), T.exp, function () {
    kit.menu(dlBtn, exportList.map(function (x) { return { label: x.label, onClick: x.run }; }));
  });
  var playBtn = cbtn(kit.icon("play"), T.present, function () {
    kit.menu(playBtn, [{ label: T.present, onClick: function () { present(false); } }, { label: T.presentNotes, onClick: function () { present(true); } }]);
  });
  var propsBtn = cbtn(kit.icon("sliders"), T.props, function () { setProps(!propsOn); });
  zoomLabel = h("span");
  var zoomBtn = cbtn("", T.zoom, function () {
    var step = function (f) { setZoom(Math.max(0.1, Math.min(3, SC * f))); };
    kit.menu(zoomBtn, [{ label: T.zoomIn, onClick: function () { step(1.25); } }, { label: T.zoomOut, onClick: function () { step(0.8); } },
      { label: T.fitSlide, onClick: function () { setZoom(0); } }]
      .concat([0.5, 0.75, 1, 1.5, 2].map(function (z) { return { label: z * 100 + "%", onClick: function () { setZoom(z); } }; }))
      .concat(editable ? [{ label: T.undo + "  (Ctrl+Z)", onClick: undo }, { label: T.redo + "  (Ctrl+Shift+Z)", onClick: redo }] : []));
  }, "sl-zoom");
  zoomBtn.appendChild(zoomLabel); zoomBtn.insertAdjacentHTML("beforeend", kit.icon("caretDown"));
  var viewPill = h("div", { "class": "sl-pill sl-pill-r", role: "toolbar" }, [statusEl, saveBtn, dlBtn, playBtn].concat(editable ? [propsBtn] : [], [zoomBtn]));

  var notesBtn = cbtn(kit.icon("notes"), T.showNotes, toggleNotes), notesBtn2 = cbtn(kit.icon("notes"), T.showNotes, toggleNotes);
  var navPill = h("div", { "class": "sl-pill sl-pill-b", role: "toolbar" }, [
    cbtn(kit.icon("prev"), T.prev, function () { show(cur - 1); }), counter, cbtn(kit.icon("next"), T.nextSlide, function () { show(cur + 1); }),
    h("span", { "class": "sl-sep" }), notesBtn2, cbtn(kit.icon("strip"), T.showThumbs, function () { setStrip(true); })]);
  var oneBtn = cbtn(kit.icon("slide"), T.oneSlide, function () { closeGrid(); });
  var gridBtn = cbtn(kit.icon("grid"), T.grid, function () { if (!gridEl) openGrid(); });
  stripHead.append.apply(stripHead, (editable ? [cbtn(kit.icon("plus"), T.newSlide, function () { layoutMenu(null, cur); })] : []).concat(
    [notesBtn, h("span", { "class": "sl-gap" }), oneBtn, gridBtn, cbtn(kit.icon("chevDown"), T.hideThumbs, function () { setStrip(false); })]));
  mainEl.insertBefore(navPill, notesEl);
  mainEl.append(insertPill, viewPill);

  function drawChrome() {
    var thumbOnly = !!C.thumb;
    strip.hidden = thumbOnly || !stripOn;
    navPill.hidden = thumbOnly || stripOn;
    viewPill.hidden = thumbOnly;
    insertPill.hidden = thumbOnly || !editable || !!gridEl;
    rail.hidden = !!gridEl;
    [notesBtn, notesBtn2].forEach(function (b) { b.classList.toggle("is-on", !notesEl.hidden); });
    oneBtn.classList.toggle("is-on", !gridEl); gridBtn.classList.toggle("is-on", !!gridEl);
    propsBtn.classList.toggle("is-on", propsOn);
    propsEl.hidden = thumbOnly || !editable || !propsOn;
  }

  // ------------------------------------------------------------------ properties (Claude's panel at the right)
  function cssHex(v) { var c = v ? rgba(v) : null; return c ? "#" + c.hex.toLowerCase() : ""; }
  function themeColors() {
    var th = deckTheme() || {};
    return (dsColors.length ? dsColors : ["fg", "muted", "accent", "accent2", "surface", "bg"].filter(function (k) { return th[k]; }).map(function (k) { return { name: k, v: th[k] }; })).slice(0, 24);
  }
  /** A change made in the panel: one undo step per run of edits, the slide redrawn, the panel left as it is (the caret stays). */
  var panelRun = 0;
  function panelEdit(fn) {
    if (Date.now() - panelRun > 900) checkpoint();
    panelRun = Date.now();
    fn();
    drawSel(); placeTools(); changed();
  }
  function prow(label, control) { return h("label", { "class": "sl-prow" }, [h("span", { text: label }), control]); }
  function pnum(value, set, o) {
    o = o || {};
    var i = h("input", { type: "number", value: value == null || isNaN(value) ? "" : String(value), step: String(o.step || 1), min: o.min == null ? null : String(o.min), max: o.max == null ? null : String(o.max) });
    i.addEventListener("keydown", function (e) { e.stopPropagation(); });
    i.addEventListener("change", function () { var v = parseFloat(i.value); if (isFinite(v)) panelEdit(function () { set(v); }); });
    return i;
  }
  function ppick(value, options, set) {
    var sl = h("select", {}, options.map(function (o) { var op = h("option", { value: o[0], text: o[1] }); if (String(o[0]) === String(value)) op.selected = true; return op; }));
    sl.addEventListener("change", function () { panelEdit(function () { set(sl.value); }); });
    return sl;
  }
  function pcolor(value, set, allowNone) {
    var hex = cssHex(value);
    var c = h("input", { type: "color", value: hex || "#000000" }), t = h("input", { type: "text", value: hex, placeholder: T.none, spellcheck: "false" });
    var put = function (v) { panelEdit(function () { set(v); }); };
    c.addEventListener("input", function () { t.value = c.value; put(c.value); });
    t.addEventListener("keydown", function (e) { e.stopPropagation(); });
    t.addEventListener("change", function () {
      var v = t.value.trim();
      if (!v && allowNone) return put("");
      if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) { v = v[0] === "#" ? v : "#" + v; if (v.length === 7) c.value = v; put(v); } else t.value = cssHex(value);
    });
    var sw = h("div", { "class": "sl-pswatches" }, themeColors().map(function (k) {
      return h("button", { type: "button", title: k.name, "aria-label": k.name, style: "background:" + k.v, onclick: function () { var x = cssHex(k.v); if (x) { c.value = x; t.value = x; } put(k.v); } });
    }));
    return h("div", { "class": "sl-pcolorbox" }, [h("div", { "class": "sl-pcolor" }, [c, t]), sw]);
  }
  function psec(title, rows) { return h("div", { "class": "sl-psec" }, [h("b", { text: title })].concat(rows.filter(Boolean))); }
  function textEls(el) { // the elements that carry the words: the element itself, else what is inside it
    if (hasOwnText(el) || /^(UL|OL|TABLE|P|H[1-6])$/.test(el.tagName)) return [el];
    return Array.prototype.filter.call(el.querySelectorAll("*"), function (n) { return hasOwnText(n) && !n.closest("svg"); });
  }
  function drawProps() {
    if (!propsEl || propsEl.hidden) return;
    var sec = curSec();
    if (!sec || gridEl) { propsEl.replaceChildren(); return; }
    if (!sel.length) { // nothing selected: the slide itself
      propsEl.replaceChildren(
        psec(T.pSlide, [prow(T.pTransition, ppick(sec.getAttribute("data-transition") || "", [["", T.trNone], ["fade", T.trFade], ["push", T.trPush], ["magic", T.trMagic]],
          function (v) { if (v) sec.setAttribute("data-transition", v); else sec.removeAttribute("data-transition"); }))]),
        psec(T.pAppearance, [prow(T.pBackground, pcolor(getComputedStyle(sec).backgroundColor, function (v) { sec.style.background = v; }))]));
      return;
    }
    var el = sel[0], cs = getComputedStyle(el), b = rectOf(el), all = function (fn) { sel.forEach(fn); };
    var free = isFree(el);
    var shift = function (prop, v) { // X and Y are the slide's; the element's own offset moves by the difference
      var d = v - rectOf(el)[prop === "left" ? "x" : "y"];
      all(function (x) { if (!isFree(x)) return; freeze(x); x.style[prop] = R(parseFloat(x.style[prop]) + d) + "px"; });
    };
    var size = function (prop, v) { all(function (x) { if (isFree(x)) freeze(x); else { x.style.flex = "none"; x.style.boxSizing = "border-box"; } x.style[prop] = R(v) + "px"; }); };
    var sizing = parseFloat(cs.flexGrow) > 0 ? "fill" : /px$/.test(el.style.width) || /px$/.test(el.style.height) ? "fixed" : "hug";
    var out = [psec(T.pSize, [
      free ? h("div", { "class": "sl-p2" }, [prow(T.pX, pnum(R(b.x), function (v) { shift("left", v); })), prow(T.pY, pnum(R(b.y), function (v) { shift("top", v); }))]) : null,
      h("div", { "class": "sl-p2" }, [prow(T.pWidth, pnum(R(b.w), function (v) { size("width", Math.max(8, v)); }, { min: 8 })),
        prow(T.pHeight, pnum(R(b.h), function (v) { size("height", Math.max(4, v)); }, { min: 4 }))]),
      free ? null : prow(T.pSizing, ppick(sizing, [["fill", T.szFill], ["hug", T.szHug], ["fixed", T.szFixed]], function (v) {
        all(function (x) {
          if (isFree(x)) return;
          var st = x.style, r = rectOf(x);
          if (v === "fill") { st.flex = "1 1 0"; st.width = ""; st.height = ""; }
          else if (v === "hug") { st.flex = "none"; st.width = ""; st.height = ""; }
          else { st.flex = "none"; st.boxSizing = "border-box"; st.width = R(r.w) + "px"; if (!isTextBox(x)) st.height = R(r.h) + "px"; }
        });
        setTimeout(drawProps, 0);
      }))])];
    if (el.tagName === "DIV" && el.children.length && !el.hasAttribute("data-shape")) { // a container: how it lays its children out
      var grid = cs.display === "grid", rowNow = /flex/.test(cs.display) && /^row/.test(cs.flexDirection);
      out.push(psec(T.pLayout, [
        grid ? null : prow(T.pDirection, ppick(rowNow ? "row" : "column", [["row", T.dirRow], ["column", T.dirCol]], function (v) {
          all(function (x) { x.style.display = "flex"; x.style.flexDirection = v; });
        })),
        prow(T.pGap, pnum(parseFloat(cs.rowGap) || parseFloat(cs.columnGap) || 0, function (v) {
          all(function (x) { if (getComputedStyle(x).display === "block") { x.style.display = "flex"; x.style.flexDirection = "column"; } x.style.gap = Math.max(0, Math.min(512, v)) + "px"; });
        }, { min: 0, max: 512 })),
        prow(T.pPadding, pnum(parseFloat(cs.paddingTop) || 0, function (v) { all(function (x) { x.style.padding = Math.max(0, Math.min(256, v)) + "px"; x.style.boxSizing = "border-box"; }); }, { min: 0, max: 256 }))]));
    }
    if (el.textContent.trim()) {
      var te = textEls(el)[0] || el, ts = getComputedStyle(te), words = function (fn) { all(function (x) { textEls(x).forEach(fn); }); };
      var fsz = parseFloat(ts.fontSize), alignNow = ts.textAlign === "start" ? "left" : ts.textAlign === "end" ? "right" : ts.textAlign;
      var seg = h("div", { "class": "sl-pseg" }, [["left", kit.icon("alignL")], ["center", kit.icon("alignC")], ["right", kit.icon("alignR")], ["justify", kit.icon("justify")]].map(function (a) {
        var bt = cbtn(a[1], T.pAlign + ": " + a[0], function () {
          panelEdit(function () { all(function (x) { x.style.textAlign = a[0]; }); });
          seg.querySelectorAll("button").forEach(function (o) { o.classList.toggle("is-on", o === bt); });
          drawTools();
        });
        if (a[0] === alignNow) bt.classList.add("is-on");
        return bt;
      }));
      out.push(psec(T.pText, [
        dsStyles.length ? prow(T.pStyle, ppick("", [["", T.pCustom]].concat(dsStyles.slice(0, 40).map(function (x, k) { return [String(k), x.st.name]; })), function (k) {
          var x = dsStyles[+k]; if (!x) return;
          var f = px(x.st.fontSize), onSlide = f ? Math.max(24, R(f * SLIDE_SCALE)) : null;
          words(function (n) {
            if (onSlide) n.style.fontSize = onSlide + "px";
            if (x.st.fontWeight) n.style.fontWeight = x.st.fontWeight;
            if (x.st.lineHeight) n.style.lineHeight = x.st.lineHeight;
            if (x.st.letterSpacing) n.style.letterSpacing = x.st.letterSpacing;
            if (x.stack) n.style.fontFamily = x.stack;
          });
          setTimeout(drawProps, 0);
        })) : null,
        prow(T.pFontSize, pnum(R(fsz), function (v) { words(function (n) { n.style.fontSize = Math.max(8, Math.min(400, v)) + "px"; }); drawTools(); }, { min: 8, max: 400 })),
        prow(T.pWeight, ppick(String(Math.round((parseInt(ts.fontWeight, 10) || 400) / 100) * 100), [["300", T.wLight], ["400", T.wRegular], ["500", T.wMedium], ["600", T.wSemi], ["700", T.wBold]],
          function (v) { words(function (n) { n.style.fontWeight = v; }); drawTools(); })),
        h("div", { "class": "sl-p2" }, [
          prow(T.pLine, pnum(Math.round(parseFloat(ts.lineHeight) / fsz * 100) / 100 || 1.2, function (v) { words(function (n) { n.style.lineHeight = String(Math.max(0.5, Math.min(4, v))); }); }, { step: 0.05, min: 0.5, max: 4 })),
          prow(T.pTrack, pnum(parseFloat(ts.letterSpacing) || 0, function (v) { words(function (n) { n.style.letterSpacing = v + "px"; }); }, { step: 0.5 }))]),
        prow(T.pColor, pcolor(ts.color, function (v) { words(function (n) { n.style.color = v; }); drawTools(); })),
        prow(T.pAlign, seg)]));
    }
    var bw = parseFloat(cs.borderTopWidth) || 0, bstyle = bw && cs.borderTopStyle !== "none" ? cs.borderTopStyle : "none";
    var border = function (style, width, color) {
      all(function (x) { x.style.border = style === "none" ? "none" : Math.max(1, width) + "px " + style + " " + color; });
    };
    var isImg = el.tagName === "IMG", bg = cs.backgroundColor;
    out.push(psec(T.pAppearance, [
      isImg ? null : prow(T.pBackground, pcolor(/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg) ? "" : bg, function (v) { all(function (x) { x.style.background = v || "none"; }); }, true)),
      prow(T.pOpacity, pnum(Math.round(parseFloat(cs.opacity) * 100) / 100, function (v) { all(function (x) { x.style.opacity = String(Math.max(0, Math.min(1, v))); }); }, { step: 0.05, min: 0, max: 1 })),
      /clip-path/.test(el.getAttribute("style") || "") ? null : prow(T.pRadius, pnum(parseFloat(cs.borderTopLeftRadius) || 0, function (v) { all(function (x) { x.style.borderRadius = Math.max(0, v) + "px"; }); }, { min: 0 })),
      prow(T.pBorder, ppick(bstyle, [["none", T.none], ["solid", T.bSolid], ["dashed", T.bDashed], ["dotted", T.bDotted]], function (v) {
        border(v, bw || 2, cssHex(cs.borderTopColor) || "#000000"); setTimeout(drawProps, 0);
      })),
      bstyle === "none" ? null : prow(T.pWidth, pnum(bw, function (v) { border(bstyle, Math.min(32, v), cssHex(cs.borderTopColor) || "#000000"); }, { min: 1, max: 32 })),
      bstyle === "none" ? null : prow(T.pColor, pcolor(cs.borderTopColor, function (v) { border(bstyle, bw, v); }))]));
    var shadow = cs.boxShadow && cs.boxShadow !== "none";
    out.push(psec(T.pEffects, [prow(T.pShadow, ppick(shadow ? "1" : "", [["", T.none], ["1", T.pShadow]], function (v) {
      all(function (x) { x.style.boxShadow = v ? "0 16px 48px rgba(0,0,0,.18)" : "none"; });
    }))]));
    propsEl.replaceChildren.apply(propsEl, out);
  }

  // Right-click on an element: Claude's menu (cut, copy, paste, duplicate, order, delete).
  if (editable) clip.addEventListener("contextmenu", function (e) {
    if (editing) return;
    var it = itemOf(e.target);
    if (!it && !clipboard) return;
    e.preventDefault();
    if (it && sel.indexOf(it) < 0) select([it]);
    var items = it ? [{ label: T.cut, onClick: function () { copySel(); removeSel(); } }, { label: T.copy, onClick: copySel }] : [];
    if (clipboard) items.push({ label: T.paste, onClick: pasteClip });
    if (it) items.push({ label: T.dup, onClick: duplicate });
    if (it && isFree(it)) items.push({ label: T.front, onClick: function () { restack(true); } }, { label: T.back, onClick: function () { restack(false); } });
    else if (it) items.push({ label: T.detach, onClick: detach });
    if (it) items.push({ label: T.del, onClick: removeSel });
    var a = h("span", { style: "position:fixed;width:1px;height:1px;left:" + e.clientX + "px;top:" + (e.clientY - 4) + "px" });
    document.body.appendChild(a);
    kit.menu(a, items);
    var m = document.querySelector(".kit-menu");
    if (m) m.style.left = Math.max(8, Math.min(e.clientX, innerWidth - m.offsetWidth - 8)) + "px";
    setTimeout(function () { a.remove(); }, 0);
  });

  // A click beside the slide lets go of the selection: the panel then shows the slide's own properties.
  if (editable) stageWrap.addEventListener("pointerdown", function (e) { if (e.target === stageWrap || e.target === stage) { stopEdit(); select([]); } });

  if (!slides.length) { stage.replaceWith(h("div", { "class": "kit-empty", text: T.empty })); kit.ready(); return; }
  buildRail();
  show(cur);
  drawChrome(); drawProps();
  function relayout() {
    // Layout slides nobody changed follow the theme (the design system's, else the layouts' default look).
    slides.forEach(function (s) {
      if (!s.layout || fileIds[s.id] || serialize(s) !== saved.html[s.id]) return;
      s.sec = clean(window.slideLayout(defs[s.id], deckTheme()), s.id);
      saved.html[s.id] = serialize(s);
    });
    buildRail();
    if (!pres) show(cur);
  }
  /** A design system's tokens as a slide theme: its colors by role (found by name), its fonts. */
  function themeFromDs(ds) {
    var st = h("style", { text: window.dsKit.css(ds) });
    document.head.appendChild(st);
    var themes = window.dsKit.themes(ds), want = dsRec && dsRec.theme;
    var mode = want && themes.some(function (t) { return t.id === want; }) ? want : themes[0] ? themes[0].id : null; // the system's first theme, not the app's mode
    if (mode) document.documentElement.setAttribute("data-ds-theme", mode);
    var probe = h("div", mode ? { "data-theme": mode } : {});
    document.body.appendChild(probe);
    var cs = getComputedStyle(probe), toks = ((ds.tokens.color || {}).tokens || []).map(function (t) {
      var v = cs.getPropertyValue("--" + t.name).trim(), c = /^rgba?\(([^)]+)\)/.exec((probe.style.color = "", probe.style.color = v, getComputedStyle(probe).color));
      var p = c ? c[1].split(/[\s,\/]+/).map(Number) : null, mx = p ? Math.max(p[0], p[1], p[2]) : 0, mn = p ? Math.min(p[0], p[1], p[2]) : 0;
      return { name: t.name, usage: String(t.usage || ""), v: v, ok: !!p && (p.length < 4 || p[3] > 0.9), L: p ? (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255 : 0, C: (mx - mn) / 255 };
    }).filter(function (t) { return t.ok; });
    dsColors = toks.map(function (t) { return { name: t.name, v: t.v }; });
    try {
      var mdl = window.dsKit.model(ds.tokens);
      dsStyles = [];
      (mdl.type.groups || []).forEach(function (g) { g.styles.forEach(function (st) { dsStyles.push({ st: st, stack: st.family ? mdl.type.families[st.family] : null }); }); });
    } catch (e) { dsStyles = []; }
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
  if (!deck.theme && dsRec && window.dsKit) {
    window.dsKit.load(dsRec).then(function (ds) {
      if (!ds || !ds.tokens) return;
      dsTheme = themeFromDs(ds);
      relayout();
    }).catch(function () {});
  }
  new ResizeObserver(fit).observe(stageWrap);
  window.addEventListener("beforeunload", function () { if (pending) save(); });
  kit.ready();
})();
