/* hermes-artifacts Doc runtime: a live doc the user and Hermes edit together.
 *
 * The doc is tabs of blocks (each a piece of Markdown with a stable id) kept on the Hermes server. Each
 * block is edited in place as formatted text (editor.js writes it back as Markdown); Hermes edits blocks
 * too (ha_live_edit) and its changes appear here at once. A selection offers formatting, "Edit with
 * Hermes" and "Comment"; "/" and "+" insert blocks and chips; Suggesting mode proposes changes instead of
 * making them. Exports: Word, PDF, Markdown, HTML.
 */
(function () {
  "use strict";
  window.__hermesDefer = true; // the host's "ready" comes from kit.ready(), after the first real render
  // The UI's words in the app's language (hu over en, key by key); messages to Hermes are always English.
  function pickLang(t, l) { var o = {}, k; for (k in t.en) o[k] = t.en[k]; for (k in t[l] || {}) o[k] = t[l][k]; return o; }
  var kit = window.kit, h = kit.h, C = kit.content, md = window.md, hm = window.hermes, E = window.docEdit, WG = window.docWidgets;
  var L = /^hu\b/i.test(kit.content.lang || navigator.language || "") ? "hu" : "en";
  var T = pickLang({
    en: { hist: "History", histNone: "No earlier states yet", byYou: "you", byH: "Hermes", byRestore: "restored", 
      restoreThis: "Restore this state", restored: "Restored", cancel: "Cancel",
      exp: "Export", docx: "Word (.docx)", pdf: "PDF", mdf: "Markdown (.md)", html: "Web page (HTML)", toSlides: "Slides from this doc", toDesign: "Design from this doc",
      building: "Building…", noLib: "The export library didn't load (open the doc in Hermes Desktop)", empty: "Type / for blocks, or @Hermes and a request.",
      saving: "Saving…", saved: "Saved", offline: "Not saved: open the doc in Hermes Desktop", noHost: "Not connected to Hermes: changes won't be saved.", conflict: "Hermes changed this block meanwhile: it shows Hermes' text, yours is kept as a suggestion on it",
      keptGone: "Hermes removed this block meanwhile: your text is kept as a new block",
      retrying: "Not saved yet: your text stays here and is sent again",
      keptNew: "Hermes changed this block meanwhile: your text is kept as a new block after it",
      asking: "Hermes is writing…", editWith: "Edit with Hermes", comment: "Comment",
      editAsk: "What should Hermes change?", send: "Send", newTab: "New tab", tabName: "Tab name", delTab: "Delete tab", rename: "Rename tab", tabs: "Tabs", delTabAsk: "Delete this tab and everything in it?", ok: "OK",
      byHermes: "Hermes edited this", sent: "Sent to Hermes", drafted: "Put in the chat box: press Enter there", untitled: "Untitled",
      hermesHere: "Hermes", dropSection: "Leave this section out",
      editing: "Editing", editingHint: "Change the text directly", suggesting: "Suggesting", suggestingHint: "Your edits become suggestions",
      headings: "Headings", textFont: "Text", serif: "Serif", sans: "Sans", width: "Full width", fonts: "Fonts",
      bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough", code: "Code", color: "Colour", link: "Link", linkAsk: "Link address",
      clear: "No colour", textColor: "Text colour", highlight: "Highlight",
      insert: "Insert", text: "Text", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", bullets: "Bulleted list", numbers: "Numbered list",
      checklist: "Checklist", quote: "Quote", codeBlock: "Code block", divider: "Divider", table: "Table", date: "Date", dropdown: "Dropdown",
      mention: "Mention", formula: "Formula", chart: "Chart", image: "Image", slashHint: "Type / in the document for more",
      mentionAsk: "Who? (a name)", dropdownAsk: "Dropdown name (e.g. Status)", optionsAsk: "Options, comma-separated", editOptions: "Edit options…",
      rowAbove: "Insert row above", rowBelow: "Insert row below", colLeft: "Insert column left", colRight: "Insert column right",
      delRow: "Delete row", delCol: "Delete column", alignL: "Align left", alignC: "Align centre", alignR: "Align right",
      addRow: "Add a row", addCol: "Add a column", source: "Source", done: "Done",
      editData: "Edit", chartTitle: "Title", chartType: "Type", cBar: "Bars", cLine: "Line", cArea: "Area", chartUnit: "Unit", chartHighlight: "Highlight",
      chartSource: "Source line", addSeries: "Add a series", seriesN: "Series",
      rowMenu: "Row", colMenu: "Column", sortAsc: "Sort A → Z", sortDesc: "Sort Z → A", moveUp: "Move up", moveDown: "Move down",
      moveRowCol: "Move row or column", moveRowUp: "Move row up", moveRowDown: "Move row down", moveColLeft: "Move column left", moveColRight: "Move column right",
      colWidth: "Set column width", wNarrow: "Narrow", wMedium: "Medium", wWide: "Wide", wExtra: "Extra wide", wAuto: "Auto", askBlock: "Ask Hermes about this",
      askGroup: "Ask Hermes", people: "People", dates: "Dates", today: "Today's date", tomorrow: "Tomorrow's date", newMention: "Someone else…", textStyle: "Text style", listStyle: "List",
      duplicate: "Duplicate", delTable: "Delete table", addBelow: "Add a block below", blockMenu: "Drag to move, click for options", turnInto: "Turn into", del: "Delete",
      typeHint: "Type, or press / for commands",
      accept: "Accept", reject: "Reject", sReplace: "Change", sInsert: "Addition", sDelete: "Deletion", replies: "replies", reply1: "reply",
      wLabels: { latex: "Formula", math: "Formula", tex: "Formula", csv: "CSV", chart: "Chart", svg: "Drawing" },
      colors: { gray: "Gray", red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", blue: "Blue", purple: "Purple" } },
    hu: { hist: "Előzmények", histNone: "Még nincs korábbi állapot", byYou: "te", byH: "Hermes", byRestore: "visszaállítva", 
      restoreThis: "Visszaállítás erre", restored: "Visszaállítva", cancel: "Mégse",
      exp: "Exportálás", docx: "Word (.docx)", pdf: "PDF", mdf: "Markdown (.md)", html: "Weboldal (HTML)", toSlides: "Slides készítése a doksiból", toDesign: "Design készítése a doksiból",
      building: "Készül…", noLib: "Az export könyvtár nem töltődött be (nyisd meg a Hermes Desktopban)", empty: "Írj / jelet a blokkokhoz, vagy @Hermes és a kérésed.",
      saving: "Mentés…", saved: "Elmentve", offline: "Nincs mentve: nyisd meg a Hermes Desktopban", noHost: "Nincs kapcsolat a Hermesszel: a módosítások nem mentődnek.", conflict: "Ezt a blokkot közben a Hermes módosította: az ő szövege látszik, a tiéd javaslatként megmaradt rajta",
      keptGone: "Ezt a blokkot közben a Hermes törölte: a szövegedet új blokként megtartottuk",
      retrying: "Még nincs mentve: a szöveged itt marad, és újra elküldjük",
      keptNew: "Ezt a blokkot közben a Hermes módosította: a szövegedet utána, új blokként megtartottuk",
      asking: "A Hermes ír…", editWith: "Szerkesztés a Hermesszel", comment: "Komment",
      editAsk: "Mit változtasson a Hermes?", send: "Küldés", newTab: "Új fül", tabName: "Fül neve", delTab: "Fül törlése", rename: "Fül átnevezése", tabs: "Fülek", delTabAsk: "Törlöd ezt a fület a teljes tartalmával együtt?", ok: "OK",
      byHermes: "A Hermes módosította", sent: "Elküldve a Hermesnek", drafted: "Beírva a chat mezőbe: nyomj ott Entert", untitled: "Névtelen",
      hermesHere: "Hermes", dropSection: "Ez a rész ne legyen benne",
      editing: "Szerkesztés", editingHint: "Közvetlenül módosítod a szöveget", suggesting: "Javaslat", suggestingHint: "A módosításaid javaslatok lesznek",
      headings: "Címsorok", textFont: "Szöveg", serif: "Talpas", sans: "Talpatlan", width: "Teljes szélesség", fonts: "Betűtípus",
      bold: "Félkövér", italic: "Dőlt", underline: "Aláhúzott", strike: "Áthúzott", code: "Kód", color: "Szín", link: "Hivatkozás", linkAsk: "Hivatkozás címe",
      clear: "Nincs szín", textColor: "Szövegszín", highlight: "Kiemelés",
      insert: "Beszúrás", text: "Szöveg", h1: "Címsor 1", h2: "Címsor 2", h3: "Címsor 3", bullets: "Felsorolás", numbers: "Számozott lista",
      checklist: "Teendőlista", quote: "Idézet", codeBlock: "Kódblokk", divider: "Elválasztó", table: "Táblázat", date: "Dátum", dropdown: "Legördülő",
      mention: "Említés", formula: "Képlet", chart: "Grafikon", image: "Kép", slashHint: "Írj / jelet a doksiban a többihez",
      mentionAsk: "Kit? (név)", dropdownAsk: "A legördülő neve (pl. Státusz)", optionsAsk: "Opciók vesszővel elválasztva", editOptions: "Opciók szerkesztése…",
      rowAbove: "Sor beszúrása fölé", rowBelow: "Sor beszúrása alá", colLeft: "Oszlop beszúrása balra", colRight: "Oszlop beszúrása jobbra",
      delRow: "Sor törlése", delCol: "Oszlop törlése", alignL: "Balra igazítás", alignC: "Középre igazítás", alignR: "Jobbra igazítás",
      addRow: "Új sor", addCol: "Új oszlop", source: "Forrás", done: "Kész",
      editData: "Szerkesztés", chartTitle: "Cím", chartType: "Típus", cBar: "Oszlop", cLine: "Vonal", cArea: "Terület", chartUnit: "Mértékegység", chartHighlight: "Kiemelés",
      chartSource: "Forrás sor", addSeries: "Új sorozat", seriesN: "Sorozat",
      rowMenu: "Sor", colMenu: "Oszlop", sortAsc: "Rendezés A → Z", sortDesc: "Rendezés Z → A", moveUp: "Feljebb", moveDown: "Lejjebb",
      moveRowCol: "Sor vagy oszlop mozgatása", moveRowUp: "Sor feljebb", moveRowDown: "Sor lejjebb", moveColLeft: "Oszlop balra", moveColRight: "Oszlop jobbra",
      colWidth: "Oszlopszélesség", wNarrow: "Keskeny", wMedium: "Közepes", wWide: "Széles", wExtra: "Extra széles", wAuto: "Automatikus", askBlock: "Kérdezd a Hermest erről",
      askGroup: "Kérdezd a Hermest", people: "Személyek", dates: "Dátumok", today: "Mai dátum", tomorrow: "Holnapi dátum", newMention: "Valaki más…", textStyle: "Szövegstílus", listStyle: "Lista",
      duplicate: "Duplikálás", delTable: "Táblázat törlése", addBelow: "Új blokk alá", blockMenu: "Húzd a mozgatáshoz, kattints a lehetőségekért", turnInto: "Átalakítás", del: "Törlés",
      typeHint: "Írj, vagy nyomd meg a / jelet a parancsokhoz",
      accept: "Elfogadás", reject: "Elutasítás", sReplace: "Módosítás", sInsert: "Hozzáadás", sDelete: "Törlés", replies: "válasz", reply1: "válasz",
      wLabels: { latex: "Képlet", math: "Képlet", tex: "Képlet", csv: "CSV", chart: "Grafikon", svg: "Rajz" },
      colors: { gray: "Szürke", red: "Piros", orange: "Narancs", yellow: "Sárga", green: "Zöld", blue: "Kék", purple: "Lila" } }
  }, L);
  kit.degraded(T.noHost); // no host: said once; the page still shows what it has

  var bar = document.getElementById("doc-bar"), page = document.getElementById("doc-page"), toc = document.getElementById("doc-toc");
  var view = document.getElementById("doc-view");
  bar.className = "kit-bar doc-bar";
  var live = !!(hm && hm.doc) && !C.thumb;
  if (live) document.documentElement.setAttribute("data-own-pins", ""); // comments show as cards in the margin
  if (live) document.documentElement.classList.add("doc-live"); // room for the block handles

  // ------------------------------------------------------------------ the doc
  var tabs, cur = 0, ast = [];
  if (C.doc && C.doc.tabs && C.doc.tabs.length) tabs = C.doc.tabs;
  else tabs = [{ id: "local", title: C.title || "Doc", rev: 0, blocks: [{ id: "local-0", md: kit.fileText("doc.md") || "" }] }];
  var selects = (C.doc && C.doc.selects) || {}, settings = (C.doc && C.doc.settings) || {}, suggestions = (C.doc && C.doc.suggestions) || [];
  var MODE_KEY = "hermes-doc-mode:" + (C.id || "");
  var mode = "edit";
  try { if (live && localStorage.getItem(MODE_KEY) === "suggest") mode = "suggest"; } catch (e) {}
  function tab() { return tabs[cur]; }
  // A section Hermes is still to write: `<!-- pending: what comes here -->`, shown in place, never exported.
  function pendingOf(s) { var m = /^<!--\s*pending:\s*([\s\S]*?)\s*-->$/.exec(String(s || "").trim()); return m ? m[1] : null; }
  kit.hermesWork.seen(!!(C.doc && C.doc.hermes_active), C.doc && C.doc.hermes_left, C.doc && C.doc.hermes_ago);
  var hermesActive = kit.hermesWork.on(); // Hermes is at work in this doc (a run in flight that changed it)
  function tabMd(t) { return t.blocks.filter(function (b) { return pendingOf(b.md) === null; }).map(function (b) { return b.md; }).join("\n\n") + "\n"; }
  function fullText() {
    return tabs.length === 1 ? tabMd(tabs[0]) : tabs.map(function (t) { return "# " + t.title + "\n\n" + tabMd(t); }).join("\n\n");
  }

  // Pictures put in the doc live beside it (`doc:<name>`), fetched once and kept.
  var docFiles = {}, fetching = {};
  function imgSrc(p) {
    if (/^data:image\//.test(p)) return p;
    var m = /^doc:([0-9a-f]{20}\.\w+)$/.exec(p || "");
    if (m) {
      if (docFiles[m[1]]) return docFiles[m[1]];
      if (live && !fetching[m[1]]) {
        fetching[m[1]] = hm.doc.file(m[1]).then(function (r) {
          docFiles[m[1]] = r.url;
          page.querySelectorAll('img[data-src="' + p + '"]').forEach(function (i) { i.src = r.url; });
        }).catch(function () {});
      }
      return "";
    }
    return kit.fileUrl(p) || "";
  }
  var dateFmt = new Intl.DateTimeFormat(L === "hu" ? "hu" : undefined, { year: "numeric", month: "short", day: "numeric" });
  function fmtDate(v) { var d = new Date(v + "T12:00:00"); return isNaN(d) ? v : dateFmt.format(d); }
  var PALETTE = ["gray", "blue", "green", "yellow", "orange", "red", "purple"]; // by option order: not started, under way, done…
  function optionsOf(name) {
    var list = (selects[name] || []).slice();
    tabs.forEach(function (t) { t.blocks.forEach(function (b) {
      var re = /\{\{select:([^{}=\n]+)=([^{}\n]*)\}\}/g, m;
      while ((m = re.exec(b.md))) if (m[1].trim() === name && m[2].trim() && list.indexOf(m[2].trim()) < 0) list.push(m[2].trim());
    }); });
    return list;
  }
  var ICON = { date: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>' };
  function chipHtml(n) {
    var src = n.kind === "date" ? "{{date:" + n.v + "}}" : n.kind === "mention" ? "{{@" + n.v + "}}" : "{{select:" + n.name + "=" + n.v + "}}";
    var a = ' contenteditable="false" data-md="' + kit.esc(src) + '"';
    if (n.kind === "date") return '<span class="chip chip-date"' + a + ">" + ICON.date + kit.esc(fmtDate(n.v)) + "</span>";
    if (n.kind === "mention") return '<span class="chip chip-mention"' + a + ">@" + kit.esc(n.v) + "</span>";
    var i = optionsOf(n.name).indexOf(n.v), col = n.v ? PALETTE[Math.max(0, i) % PALETTE.length] : "gray";
    return '<span class="chip chip-select c-' + col + '"' + a + ' data-select="' + kit.esc(n.name) + '">' + kit.esc(n.v || "—") + '<i aria-hidden="true">▾</i></span>';
  }
  function widgetHtml(lang, v) { return WG.html(lang, v, { vendor: live && hm.vendor ? hm.vendor : null, redraw: redrawWidgets, labels: T.wLabels, sourceLabel: T.source, editLabel: live ? T.editData : null }); }
  function redrawWidgets() {
    tab().blocks.forEach(function (b) { if (isWidget(b.md)) { var el = blockEl(b.id); if (el) drawBlock(b, el); } });
  }
  var R = { chip: chipHtml, widget: widgetHtml, live: live, date: fmtDate };
  function renderMd(x) { return md.html(md.parse(x), imgSrc, R); }
  function fixDom(el) {
    el.querySelectorAll("table").forEach(function (t) { // a new, still blank table spans the page, as in Claude's doc
      t.classList.toggle("t-blank", !Array.prototype.some.call(t.querySelectorAll("td,th"), function (c) { return c.textContent.trim() || c.querySelector("[data-md],img"); }));
    });
    el.querySelectorAll("td, th").forEach(function (c) {
      var only = c.children.length === 1 && c.firstElementChild.tagName === "SPAN" && c.textContent === c.firstElementChild.textContent ? c.firstElementChild : null;
      var m = only && /\bmd-(bg-[a-z]+)\b/.exec(only.className);
      if (m) { c.classList.add("md-" + m[1]); only.classList.remove("md-" + m[1]); if (!only.className.trim()) { while (only.firstChild) c.insertBefore(only.firstChild, only); only.remove(); } }
    });
  }
  function title() {
    var h1 = ast.find(function (b) { return b.t === "h" && b.level === 1; });
    return (h1 && md.plain(h1.c)) || C.title || "Doc";
  }
  function cleanHtml() {
    return md.html(md.parse(fullText()), imgSrc, { date: fmtDate, widget: function (lang, v) { return WG.html(lang, v, { bare: true }); } });
  }
  function blockEl(id) { return page.querySelector('.doc-blk[data-block="' + id + '"]'); }
  function indexOf(id) { for (var i = 0; i < tab().blocks.length; i++) if (tab().blocks[i].id === id) return i; return -1; }
  function blockOf(id) { return tab().blocks[indexOf(id)]; }
  function isWidget(s) { var m = /^(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(String(s || "").trim()); return !!(m && WG.kinds[m[2].toLowerCase()]); }
  function isCode(s) { return /^(`{3,}|~{3,})/.test(String(s || "").trim()); }

  // ------------------------------------------------------------------ suggestions (Suggesting mode)
  function sugFor(id) {
    var list = suggestions.filter(function (s) { return s.block === id && s.kind !== "insert"; });
    var p = pendingSug(id); // the person's proposal still on its way shows as theirs already (a failure keeps it in sight)
    return p ? [p].concat(list.filter(function (s) { return s.by !== "user"; })) : list;
  }
  function pendingSug(id) {
    var box = typeof outbox === "undefined" || !outbox ? [] : outbox;
    for (var i = box.length - 1; i >= 0; i--) {
      var e = box[i], o = e.ops[0];
      if (e.via === "suggest" && e.ops.length === 1 && o.op === "replace" && (realIds[o.block] || o.block) === id)
        return { id: "p-" + e.cid, block: id, kind: "replace", md: o.md, by: "user" };
    }
    return null;
  }
  function sugAfter(id) { return suggestions.filter(function (s) { return s.kind === "insert" && (s.block || null) === id; }); }
  function words(s) { return String(s).split(/(\s+)/).filter(function (x) { return x !== ""; }); }
  function simple(s) { var a = md.parse(s); return a.length === 1 && (a[0].t === "p" || a[0].t === "h"); }
  // Word-level difference of two one-paragraph blocks, as Markdown with the struck and the added words marked.
  function diffMd(was, now) {
    var a = words(was), b = words(now), n = a.length, m = b.length;
    if (n * m > 160000) return null;
    var dp = []; for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = [], del = [], ins = [];
    function flush() {
      if (del.join("").trim()) out.push("[" + del.join("") + "]{.sug-del}"); else out.push(del.join(""));
      if (ins.join("").trim()) out.push("[" + ins.join("") + "]{.sug-ins}"); else out.push(ins.join(""));
      del = []; ins = [];
    }
    i = 0; j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { flush(); out.push(a[i]); i++; j++; }
      else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) ins.push(b[j++]);
      else del.push(a[i++]);
    }
    flush();
    var head = /^#{1,6}\s/.exec(now) || /^#{1,6}\s/.exec(was);
    return out.join("").replace(/^\[#{1,6}\s/, "[").replace(/^(#{1,6}\s)/, "") .replace(/^/, head ? head[0] : "");
  }

  // ------------------------------------------------------------------ drawing
  var focused = null; // {id, el, saved, timer}: the block being typed in
  var pendingAsks = {}; // block id -> true while Hermes answers there
  function firstPending() { var b = tab().blocks.find(function (x) { return pendingOf(x.md) !== null; }); return b && b.id; }
  function editable(b) {
    if (!live || pendingOf(b.md) !== null || pendingAsks[b.id] || sugFor(b.id).length) return false;
    return !isWidget(b.md) && !/^@hermes\b/i.test((b.md || "").trim());
  }
  function blockHtml(b) {
    var s = (b.md || "").trim(), intent = pendingOf(s);
    if (intent !== null) {
      var here = hermesActive && b.id === firstPending();
      return '<p class="doc-pend' + (here ? " is-here" : "") + '" contenteditable="false">' + (here ? '<span class="doc-who">' + kit.esc(T.hermesHere) + "</span>" : "") +
        "<span>" + kit.esc(intent) + "</span>" +
        (live ? '<button type="button" class="doc-pend-x" data-drop="' + kit.esc(b.id) + '" title="' + kit.esc(T.dropSection) + '" aria-label="' + kit.esc(T.dropSection) + '">×</button>' : "") + "</p>";
    }
    if (!s) return "<p><br></p>";
    if (pendingAsks[b.id] || /^@hermes\b/i.test(s)) {
      return '<p class="doc-ask' + (pendingAsks[b.id] ? " is-pending" : "") + '"><span class="doc-ask-at">@Hermes</span> ' +
        kit.esc(s.replace(/^@hermes\b\s*/i, "")) + (pendingAsks[b.id] ? ' <span class="doc-ask-st">' + kit.esc(T.asking) + "</span>" : "") + "</p>";
    }
    var sg = sugFor(b.id)[0];
    if (sg && sg.kind === "replace") {
      var d = simple(s) && simple(sg.md) ? diffMd(s, sg.md) : null;
      return d ? renderMd(d) : '<div class="sug-old">' + renderMd(s) + '</div><div class="sug-new">' + renderMd(sg.md) + "</div>";
    }
    if (sg && sg.kind === "delete") return '<div class="sug-old">' + renderMd(s) + "</div>";
    return renderMd(s);
  }
  // What a block's drawing depends on: a block whose key did not change is not drawn again.
  function drawKey(b, html) { return (html == null ? blockHtml(b) : html) + "\u0001" + editable(b) + "\u0001" + (!s(b.md) && tab().blocks.length === 1); }
  function drawBlock(b, el) {
    el = el || h("div", { "class": "doc-blk" });
    el.setAttribute("data-block", b.id);
    el.id = "blk-" + b.id;
    el.className = "doc-blk";
    el.classList.toggle("is-pend", pendingOf(b.md) !== null);
    el.classList.toggle("is-widget", isWidget(b.md));
    el.classList.toggle("has-sug", sugFor(b.id).length > 0);
    var html = blockHtml(b);
    el.innerHTML = html;
    el._drawn = drawKey(b, html);
    fixDom(el);
    var ed = editable(b);
    if (ed && isCode(b.md)) { el.removeAttribute("contenteditable"); var c = el.querySelector("pre code"); if (c) c.setAttribute("contenteditable", "plaintext-only"); }
    else if (ed) el.setAttribute("contenteditable", "true");
    else el.removeAttribute("contenteditable");
    if (!s(b.md) && tab().blocks.length === 1) el.setAttribute("data-empty", T.empty); else el.removeAttribute("data-empty");
    return el;
  }
  function s(x) { return String(x || "").trim(); }
  function sugBlock(sg) {
    var el = h("div", { "class": "doc-blk sug-add", "data-sug": sg.id });
    el.innerHTML = renderMd(sg.md); fixDom(el);
    return el;
  }
  function render() {
    var keep = focused && blockEl(focused.id);
    var nodes = [];
    var top = sugAfter(null);
    top.forEach(function (sg) { nodes.push(sugBlock(sg)); });
    tab().blocks.forEach(function (b) {
      nodes.push(keep && b.id === focused.id ? keep : drawBlock(b));
      sugAfter(b.id).forEach(function (sg) { nodes.push(sugBlock(sg)); });
    });
    page.replaceChildren.apply(page, nodes);
    if (focused && !keep) focused = null;
    ast = md.parse(fullText());
    applySettings();
    drawToc(); drawTabs(); drawMargin();
  }

  // >>> pure: what needs no page (tests/test_doc_page.py runs this block under node)
  /** Put `nodes` into `parent` in that order, moving only what is out of place. `keep` (the block being typed
   *  in) is never taken out of the page: a node taken out loses the focus, the caret, an IME composition and
   *  its undo, and the keys typed next go nowhere. The others move around it. */
  function placeBlocks(parent, nodes, keep) {
    var want = new Set(nodes), n, nx, ref, i;
    if (keep && (!want.has(keep) || keep.parentNode !== parent)) keep = null;
    for (n = parent.firstChild; n; n = nx) { nx = n.nextSibling; if (!want.has(n)) parent.removeChild(n); }
    var at = keep ? nodes.indexOf(keep) : nodes.length;
    for (ref = parent.firstChild, i = 0; i < at; i++) { if (nodes[i] === ref) ref = ref.nextSibling; else parent.insertBefore(nodes[i], ref); }
    if (keep) for (ref = keep.nextSibling, i = at + 1; i < nodes.length; i++) { if (nodes[i] === ref) ref = ref.nextSibling; else parent.insertBefore(nodes[i], ref); }
  }
  /** What a read of the doc does to the block being typed in. here: the server still has it; same: its text
   *  there is the one this page has; unsaved: words typed here are not saved yet (or are on their way).
   *  "keep": left as it is (the person's words win until they pause; a change by Hermes then meets the save
   *  as a conflict); "redraw": the server's text, the caret kept; "readd": gone there, kept here and saved
   *  as a new block; "drop": gone, nothing of the person's lost. */
  function onRead(here, same, unsaved) {
    if (here) return same || unsaved ? "keep" : "redraw";
    return unsaved ? "readd" : "drop";
  }
  /** The tab's blocks after a read: the server's, except blocks whose words here are not saved yet (keepMd:
   *  id -> those words), which keep them. One of those the server no longer has stays where it was, after the
   *  block it followed. -> {blocks, back: [{id, after}]} (back: kept here although gone there). */
  function mergeBlocks(srv, was, keepMd) {
    var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); }, at = {}, back = [];
    var out = srv.map(function (b) { at[b.id] = 1; return { id: b.id, md: has(keepMd, b.id) ? keepMd[b.id] : b.md }; });
    was.forEach(function (w, i) {
      if (!has(keepMd, w.id) || at[w.id]) return;
      var after = null;
      for (var k = i - 1; k >= 0 && after === null; k--) if (at[was[k].id]) after = was[k].id;
      var j = 0;
      if (after !== null) for (j = 0; j < out.length; j++) if (out[j].id === after) { j++; break; }
      out.splice(j, 0, { id: w.id, md: keepMd[w.id] }); at[w.id] = 1; back.push({ id: w.id, after: after });
    });
    return { blocks: out, back: back };
  }
  /** A save's answer: "ok" only when the server took the words; anything else (no answer, an error, a
   *  refusal) is "failed" and the words wait to be sent again; "conflict": Hermes changed that block. */
  function saveOutcome(r) { return r && r.refused ? "refused" : r && r.conflict ? "conflict" : r && r.rev && r.ok !== false ? "ok" : "failed"; }
  /** The page's edits still on their way (the outbox: [{via, ops}]), played over the server's blocks so a read
   *  never takes back a change not answered yet: a block's new words, a new block (by its tmp id, after its
   *  anchor or, that gone, after the nearest block before it that is still there), a removed or moved block.
   *  A changed block the server no longer has shows again where it was. real: tmp id -> the server's id. */
  function replayOps(blocks, entries, real) {
    var out = blocks.map(function (b) { return { id: b.id, md: b.md }; });
    var R = function (id) { return id != null && real[id] ? real[id] : id; };
    var at = function (id) { id = R(id); for (var i = 0; i < out.length; i++) if (out[i].id === id) return i; return -1; };
    var spot = function (after, prevs) { // where a block goes after `after` (null: the top)
      if (after == null) return 0;
      var list = [after].concat(prevs || []);
      for (var i = 0; i < list.length; i++) { var k = list[i] == null ? -1 : at(list[i]); if (k >= 0) return k + 1; }
      return 0;
    };
    entries.forEach(function (e) {
      if (e.via !== "edit") return; // a proposal changes no block
      e.ops.forEach(function (o) {
        var k;
        if (o.op === "replace") {
          if ((k = at(o.block)) >= 0) out[k].md = o.md;
          else out.splice(spot((o._prevs || [])[0], (o._prevs || []).slice(1)), 0, { id: o.block, md: o.md });
        } else if (o.op === "insert") {
          if (at(o.tmp) < 0) out.splice(spot(o.after, o._aprevs), 0, { id: o.tmp, md: o.md });
        } else if (o.op === "delete") {
          if ((k = at(o.block)) >= 0) out.splice(k, 1);
        } else if (o.op === "move" && (k = at(o.block)) >= 0) {
          var b = out.splice(k, 1)[0];
          out.splice(spot(o.after, o._aprevs), 0, b);
        }
      });
    });
    return out;
  }
  /** An edit the server refused because a block it names is gone (Hermes removed it meanwhile), made to fit
   *  the doc as it is now (ids: the server's blocks): new words for a gone block go in as a new block where
   *  it was; a delete or a move of a gone block is dropped; a new or moved block whose anchor is gone goes
   *  after the nearest block before it that is still there. -> {via, ops, gone} or null when nothing in it
   *  could be the reason (it is dropped then). */
  function repairOps(e, ids, real) {
    var have = {}, made = {}, ops = [], changed = false, gone = false;
    ids.forEach(function (id) { have[id] = 1; });
    var ok = function (id) { return id == null || !!have[id != null && real[id] ? real[id] : id] || !!made[id]; };
    var anchor = function (list) { for (var i = 0; i < (list || []).length; i++) if (list[i] != null && ok(list[i])) return list[i]; return null; };
    e.ops.forEach(function (o) {
      var x = {}, k;
      for (k in o) x[k] = o[k];
      if ((o.op === "replace" || o.op === "delete" || o.op === "move") && !ok(o.block)) {
        changed = true;
        if (o.op !== "replace") return;
        x = { op: "insert", after: anchor(o._prevs), md: o.md, tmp: o.block, _aprevs: o._prevs };
        gone = true;
      }
      if ((x.op === "insert" || x.op === "move") && x.after != null && !ok(x.after)) { x.after = anchor(x._aprevs); changed = true; }
      if (x.tmp) made[x.tmp] = 1;
      ops.push(x);
    });
    if (!changed) return null;
    return { via: gone && e.asBlock ? "edit" : e.via, ops: ops, gone: gone };
  }
  /** A read older than what this page already saw (the newest read merged, or its own saves' revs) would put
   *  old text back: it is not merged. */
  function staleRead(rev, seen, acked) { return rev < Math.max(seen || 0, acked || 0); }
  /** How many of the outbox's oldest entries one batch takes: as many as fit maxCount entries and maxChars of
   *  JSON (sizes: each entry's JSON length), at least one. The rest waits (see flush). */
  function batchFit(sizes, maxCount, maxChars) {
    var n = 0, chars = 0;
    while (n < sizes.length && n < maxCount && (n === 0 || chars + sizes[n] <= maxChars)) chars += sizes[n++];
    return n;
  }
  var PURE = { placeBlocks: placeBlocks, onRead: onRead, mergeBlocks: mergeBlocks, saveOutcome: saveOutcome, staleRead: staleRead,
    replayOps: replayOps, repairOps: repairOps, batchFit: batchFit };
  // <<< pure

  // A read of the doc changes only the blocks that changed (see placeBlocks), and what is on screen stays put:
  // the block being typed in, or else the first one on screen, keeps its place in the window.
  function patch(redrawMine) {
    var keep = focused && blockEl(focused.id), have = {}, nodes = [];
    page.querySelectorAll(".doc-blk[data-block]").forEach(function (el) { have[el.getAttribute("data-block")] = el; });
    var anchor = keep && onScreen(keep) ? keep : firstOnScreen(), top = anchor ? anchor.getBoundingClientRect().top : 0;
    sugAfter(null).forEach(function (sg) { nodes.push(sugBlock(sg)); });
    tab().blocks.forEach(function (b) {
      var el = have[b.id];
      if (el && el === keep) { if (redrawMine) redrawKept(b, el); nodes.push(el); }
      else nodes.push(el && el._drawn === drawKey(b) ? el : drawBlock(b, el));
      sugAfter(b.id).forEach(function (sg) { nodes.push(sugBlock(sg)); });
    });
    placeBlocks(page, nodes, keep);
    ast = md.parse(fullText());
    applySettings();
    drawToc(); drawTabs(); drawMargin();
    if (anchor && anchor.isConnected) { var dy = anchor.getBoundingClientRect().top - top; if (Math.abs(dy) >= 1) window.scrollBy(0, dy); }
  }
  function onScreen(el) { var r = el.getBoundingClientRect(); return r.bottom > bar.getBoundingClientRect().bottom && r.top < innerHeight; }
  function firstOnScreen() {
    var all = page.querySelectorAll(".doc-blk[data-block]");
    for (var i = 0; i < all.length; i++) if (onScreen(all[i])) return all[i];
    return null;
  }
  // Hermes changed the block the caret is in while nothing typed there waits to be saved: its new text, the
  // caret where it was (by its place in the text), the focus kept.
  function redrawKept(b, el) {
    var had = el.contains(document.activeElement), off = had ? caretOffset(el) : -1;
    drawBlock(b, el);
    focused.saved = b.md; focused.base = tab().rev;
    if (!had) return;
    var tg = el.getAttribute("contenteditable") === "true" ? el : el.querySelector("[contenteditable=plaintext-only]");
    if (!tg) { focused = null; return; }
    if (document.activeElement !== tg) tg.focus({ preventScroll: true });
    if (off >= 0) caretAtOffset(tg, off);
  }
  function caretOffset(el) {
    var s0 = window.getSelection();
    if (!s0.rangeCount || !el.contains(s0.anchorNode)) return -1;
    var r = document.createRange(); r.selectNodeContents(el); r.setEnd(s0.anchorNode, s0.anchorOffset);
    return r.toString().length;
  }
  function drawToc() {
    toc.replaceChildren.apply(toc, Array.prototype.map.call(page.querySelectorAll(".doc-blk > h1, .doc-blk > h2, .doc-blk > h3"), function (el) {
      return h("a", { href: "#", "class": "l" + el.tagName[1], text: el.textContent,
        onclick: function (e) { e.preventDefault(); el.scrollIntoView({ behavior: "smooth", block: "start" }); } });
    }));
  }
  function applySettings() {
    page.classList.toggle("head-serif", settings.head === "serif"); // the theme's font unless the doc chose serif
    page.classList.toggle("body-serif", settings.body === "serif");
    document.documentElement.classList.toggle("doc-wide", !!settings.wide);
  }

  // ------------------------------------------------------------------ saving (each change goes to the server)
  var status = h("span", { "class": "doc-status", "aria-live": "polite" }), statusTimer = null;
  function setStatus(x) {
    status.textContent = x;
    clearTimeout(statusTimer);
    if (x === T.saved) statusTimer = setTimeout(function () { status.textContent = ""; }, 1500);
  }
  var edits = 0;
  // The outbox: every change the page makes goes out as one logical edit, {cid, via ("edit" or "suggest"),
  // ops, base, t}, and stays here until the server answers it: taken, a conflict, or a refusal. One at a
  // time, in order. A failure (an error, no answer within 20 s) keeps it at the head; it goes again after a
  // pause that doubles up to 30 s, with the SAME cid, and the server answers a cid it already applied with
  // that first answer, so an edit is applied once however often it is sent. Until answered, its ops are played
  // over every read (replayOps), so a read never takes back a change still on its way. An edit that changes
  // several blocks (a split, a merge) is one entry: the server takes all of it or none.
  // A cid is "<page>.<n>[.<tag>]": n counts this page's edits in the order they were made; an edit mended or
  // split up keeps its n (tag m1, r…), so the server can tell an older edit of a block from a newer one (docs._seq).
  var outbox = [], sending = null, mending = false, retryTimer = null, retryMs = 0, cidN = 0, leaving = false;
  var PAGE = Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  function prevsOf(id) { // the blocks before it here (nearest first): where it goes back if what it names is gone
    var i = indexOf(realIds[id] || id), out = [];
    for (var k = i - 1; k >= 0 && out.length < 8; k--) out.push(tab().blocks[k].id);
    return out;
  }
  function enqueue(via, ops, base, more) {
    if (!live) { setStatus(T.offline); return Promise.reject(new Error(T.offline)); }
    var t = tab();
    ops = ops.map(function (o) {
      var x = {}; for (var k in o) x[k] = o[k];
      if (x.op === "insert" && !x.tmp) x.tmp = "tmp-" + Math.random().toString(36).slice(2, 10);
      if (x.block) x._prevs = prevsOf(x.block);
      if (x.op === "insert" || x.op === "move") x._aprevs = x.after == null ? [] : [x.after].concat(prevsOf(x.after));
      return x;
    });
    // New words for a block whose last change waits unsent go in that same entry (never past another one).
    var last = more && more.at != null ? null : outbox[outbox.length - 1];
    if (last && last !== sending && !last.sent && last.t === t && last.via === via && last.ops.length === 1 && ops.length === 1 &&
        last.ops[0].op === "replace" && ops[0].op === "replace" && last.ops[0].block === ops[0].block) {
      last.ops[0].md = ops[0].md;
      if (base != null && (last.base == null || base < last.base)) last.base = base;
      return last.promise;
    }
    var n = more && more.n != null ? more.n : ++cidN;
    var e = { n: n, cid: PAGE + "." + n + (more && more.tag ? "." + more.tag : ""), via: via, ops: ops, base: base, t: t, sent: false, fixes: 0 };
    for (var k2 in more || {}) if (k2 !== "at" && k2 !== "n" && k2 !== "tag") e[k2] = more[k2];
    e.promise = new Promise(function (res) { e.done = res; });
    if (more && more.at != null) outbox.splice(more.at, 0, e); else outbox.push(e); // at: the place of the edit it stands for
    setStatus(T.saving);
    pump();
    return e.promise;
  }
  /** base: the rev a block's words were typed against (its own, older than the tab's when Hermes changed
   *  that block meanwhile), so the server sees the conflict instead of the person's save overwriting it. */
  function edit(ops, base) { return enqueue("edit", ops, base); }
  function propose(ops) { return enqueue("suggest", ops).then(function (r) { return pull(true).then(function () { return r; }); }); }
  function wire(e) { // the ops as the server takes them: ids it gave meanwhile, an anchor still unsettled moved back, the cid
    return e.ops.map(function (o, i) {
      var x = {}; for (var k in o) if (k !== "tmp" && k.charAt(0) !== "_") x[k] = o[k];
      if (x.block && realIds[x.block]) x.block = realIds[x.block];
      if (x.after && realIds[x.after]) x.after = realIds[x.after];
      if (x.after && /^tmp-/.test(x.after)) { var a = (o._aprevs || []).slice(1).filter(function (p) { return !/^tmp-/.test(realIds[p] || p); })[0]; x.after = a ? realIds[a] || a : null; }
      if (i === 0) x.cid = e.cid;
      return x;
    });
  }
  function baseOf(e) { // fixed when it first goes out: the same base however often it is sent
    if (!e.sent) { e.sent = true; e.sentBase = e.base != null && e.base < e.t.rev ? e.base : e.t.rev; }
    return e.sentBase;
  }
  function send(e) {
    var t = e.t;
    baseOf(e);
    e.flying = true;
    var ops = wire(e);
    inTime(e.via === "suggest" ? hm.doc.suggest(t.id, ops) : hm.doc.edit(t.id, ops, e.sentBase))
      .then(function (r) { answered(e, r); }, function () { answered(e, null); });
  }
  function pump() {
    if (leaving || batching || sending || mending || retryTimer || !outbox.length) return; // a batch out: its answer first
    sending = outbox[0];
    send(sending);
  }
  function inTime(p) { // a save with no answer is a failed save (it is sent again), not a hang
    return Promise.race([p, new Promise(function (res, rej) { setTimeout(function () { rej(new Error(T.retrying)); }, 20000); })]);
  }
  function answered(e, r) {
    e.flying = false;
    if (sending === e) sending = null;
    var how = saveOutcome(r), i = outbox.indexOf(e);
    if (i < 0) return pump(); // answered already (sent twice: a retry and a flush)
    if (how === "failed") { if (i === 0) failed(); return; } // stays where it is; the pump sends it again
    if (how === "refused") { if (i === 0) mend(e, r); return; }
    outbox.splice(i, 1);
    retryMs = 0;
    if (how === "conflict") e.done(conflicted(e.t, e, r, i));
    else { took(e, r); e.done(r); }
    if (!outbox.length) setStatus(T.saved);
    sendView();
    pump();
  }
  function took(e, r) { // the server has it: its new blocks get their ids, the page knows the rev it reached
    var per = r.per_op || [];
    e.ops.forEach(function (o, i) {
      if (o.tmp && per[i] && per[i].length) settleId(o.tmp, per[i][0]);
      else if (o.tmp && !r.per_op && r.changed && r.changed.length) settleId(o.tmp, r.changed[r.changed.length - 1]);
    });
    if (e.say) { kit.toast(e.say); e.say = null; } // what became of the person's words, once it is true
    if (!r.rev) return;
    var t = e.t;
    t.acked = Math.max(t.acked || 0, r.rev); // the server is at least here: an older read is stale
    if (r.rev === t.rev + 1) t.rev = r.rev; else if (!r.repeat) pull(true); // someone else edited in between
    if (e.via !== "edit") return;
    edits++;
    if (e.ops.some(function (o) { return o.op === "insert" && md.parse(o.md || "").length > 1 || o.op === "replace" && md.parse(o.md || "").length > 1 && !/^(`{3,}|~{3,})/.test((o.md || "").trim()); })) pull(true); // it split into blocks
  }
  function failed() {
    if (leaving) return; // the page is going: what it had went out in its flush
    setStatus(T.retrying);
    if (!retryMs) kit.toast(T.retrying); // once, however often it fails
    retryMs = Math.min(30000, (retryMs || 1500) * 2);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () { retryTimer = null; pump(); }, retryMs);
  }
  // Refused (Hermes removed a block it names): read the doc, make the edit fit it (repairOps), send that,
  // still first in line; dropped when nothing in it could be the reason, and said.
  function mend(e, r) {
    mending = true;
    pull(true).then(function () {
      mending = false;
      if (outbox[0] !== e) return pump();
      var fix = repairOps(e, (e.t.srv || []).slice(), realIds);
      if (fix && !fix.ops.length) { outbox.shift(); e.done(r); return pump(); } // all it did is done already (a delete of a removed block)
      if (fix) {
        e.cid = PAGE + "." + e.n + ".m" + (++e.fixes); e.via = fix.via; e.ops = fix.ops; e.sent = false; // the same n: still that edit
        if (fix.gone) e.say = T.keptGone;
        fix.ops.forEach(function (o) { if (o.tmp && focused && focused.id === o.tmp) focused.sug = false; }); // its words: a block of its own now
      } else {
        outbox.shift(); e.done(r);
        kit.toast(String(r.message || r.refused));
      }
      pump();
    });
  }
  // Hermes changed a block meanwhile that this edit changes too, and the server kept Hermes' text. The
  // person's words are not dropped: they become a suggestion on that block (accepting it puts them back).
  // The block being typed in stays focused and editable with the person's words: what they type on goes to
  // that suggestion (f.sug), and the block shows Hermes' text with it once they leave it. The edit's other
  // ops (a new block from a split, a move, a block Hermes did not touch) go again, as one edit; a block
  // Hermes removed meanwhile gets the words back as a new block (repairOps).
  function conflicted(t, e, r, at) {
    var hit = r.blocks || [], rest = [];
    e.ops.forEach(function (o) {
      var bid = realIds[o.block] || o.block;
      if (o.op === "replace" && hit.indexOf(bid) >= 0) {
        var f = focused && focused.id === bid ? focused : null, el = blockEl(bid);
        var text = f && el ? mdOf(el) : o.md; // what was typed since the save left, too
        if (f) { f.sug = true; f.saved = text; }
        enqueue("suggest", [{ op: "replace", block: bid, md: text }], null, { asBlock: true, say: T.conflict }); // said once it is there
      } else if (!(o.op === "delete" && hit.indexOf(bid) >= 0)) rest.push(o); // a delete of what Hermes changed: it stays
    });
    // in its place and with its n: never after (nor taken for newer than) an edit made after it
    if (rest.length) enqueue("edit", rest, e.sentBase, { at: at || 0, n: e.n, tag: "r" + (++e.fixes) });
    return pull(true).then(function () { return r; });
  }
  // Leaving the page (a reload, the pane closed, another artifact, a new version) or hiding it: what waits for
  // a pause is saved now, and the whole outbox goes out at once as ONE ordered batch (docs.apply_batch): every
  // entry not answered yet, in outbox order, the one in flight included (its first request may still land:
  // its cid makes that harmless), each with its own cid. Never side by side, so never out of order. Posted in
  // this handler (the frame may be going). On pagehide nothing is sent after it: no retry, no pump.
  function flush(going) {
    if (!live) return;
    if (focused && blockEl(focused.id)) save(false);
    clearTimeout(retryTimer); retryTimer = null;
    if (going) leaving = true;
    if (!outbox.length || batching) return;
    var all = outbox.map(function (e) { return { cid: e.cid, via: e.via, ops: wireBatch(e), base: baseOf(e), tab: e.t.id }; });
    // The oldest stretch that fits one call (docs.MAX_BATCH, MAX_BATCH_CHARS): nothing sent side by side. A
    // page that stays sends the rest one by one after the answer (pump); one that goes loses only what did not
    // fit, which takes hours of typing offline.
    var n = batchFit(all.map(function (x) { return JSON.stringify(x).length; }), BATCH_COUNT, BATCH_CHARS), run = outbox.slice(0, n);
    batching++;
    run.forEach(function (e) { e.batched = (e.batched || 0) + 1; });
    inTime(hm.doc.edit(tab().id, [{ op: "batch", entries: all.slice(0, n) }], null))
      .then(function (r) { batchAnswered(run, r); }, function () { batchAnswered(run, null); });
  }
  var BATCH_COUNT = 2000, BATCH_CHARS = 1900000, batching = 0; // under docs.MAX_BATCH and MAX_BATCH_CHARS (2 000 000)
  // The answers to a batch, the page still here (hidden, not gone): each entry as if it had been answered on
  // its own, in order; a held one (it depends on one that failed) stays, in its place, for the pump.
  function batchAnswered(run, r) {
    batching--;
    run.forEach(function (e) { e.batched--; });
    var answers = r && r.ok !== false && Array.isArray(r.batch) ? r.batch : null;
    if (!answers) { if (!leaving && outbox.length) failed(); return; }
    run.forEach(function (e, k) {
      var a = answers[k], i = outbox.indexOf(e), how = a && a.held ? "held" : saveOutcome(a);
      if (i < 0 || how === "held" || how === "failed") return;
      if (how === "refused") { e.refusal = a; return; }
      outbox.splice(i, 1);
      if (how === "conflict") e.done(conflicted(e.t, e, a, i));
      else { took(e, a); e.done(a); }
    });
    retryMs = 0;
    if (!outbox.length) setStatus(T.saved);
    sendView();
    var head = outbox[0];
    if (head && head.refusal && !sending && !mending) { var a0 = head.refusal; head.refusal = null; return mend(head, a0); }
    pump();
  }
  function wireBatch(e) { // as wire(), but a tmp id an earlier entry of the batch makes is left for the server to fill in
    return e.ops.map(function (o) {
      var x = {}; for (var k in o) if (k.charAt(0) !== "_") x[k] = o[k];
      if (x.block && realIds[x.block]) x.block = realIds[x.block];
      if (x.after && realIds[x.after]) x.after = realIds[x.after];
      return x;
    });
  }
  function unsaved() { return outbox.length > 0 || !!(focused && (focused.timer || composing)); }
  window.addEventListener("pagehide", function () { flush(true); });
  window.addEventListener("pageshow", function (ev) { if (ev.persisted && leaving) { leaving = false; pump(); } }); // back from the page cache
  document.addEventListener("visibilitychange", function () { if (document.hidden) flush(false); });
  window.addEventListener("beforeunload", function (ev) { if (!live || !unsaved()) return; flush(false); ev.preventDefault(); ev.returnValue = ""; });
  /** One block's new Markdown: an edit, or in Suggesting mode a proposal. */
  function writeBlock(id, mdText, opts) {
    var b = blockOf(id);
    if (!b) return Promise.resolve();
    if (mode === "suggest" && !(opts && opts.direct)) {
      var was = b.md;
      if (mdText === was) return Promise.resolve();
      b.md = was; // the doc keeps its words until the person accepts
      return propose([{ op: "replace", block: id, md: mdText }]);
    }
    b.md = mdText;
    if (opts && opts.sug) return enqueue("suggest", [{ op: "replace", block: id, md: mdText }], null, { asBlock: true })
      .then(function (r) { return r && r.ok !== false ? { ok: true, sug: true, rev: r.rev } : r; });
    return edit([{ op: "replace", block: id, md: mdText }], opts && opts.base != null ? opts.base : tab().rev);
  }
  // A new block shows and takes the caret at once; its id comes back from the server a moment later.
  var realIds = {}, tmpWait = {};
  function settleId(tmp, real) {
    realIds[tmp] = real;
    var b = blockOf(tmp), el = blockEl(tmp);
    if (b && !blockOf(real)) b.id = real; else if (b) tab().blocks.splice(indexOf(tmp), 1); // a read showed it already
    if (el && !blockEl(real)) { el.setAttribute("data-block", real); el.id = "blk-" + real; } else if (el && el !== blockEl(real)) { if (!(focused && focused.id === tmp)) el.remove(); else { var o = blockEl(real); o.remove(); el.setAttribute("data-block", real); el.id = "blk-" + real; } }
    if (focused && focused.id === tmp) focused.id = real;
    if (tmpWait[tmp]) { tmpWait[tmp](real); delete tmpWait[tmp]; }
  }
  function showNew(afterId, mdText, focusIt) { // a block here at once, under a tmp id until the server gives it one
    var tmp = { id: "tmp-" + Math.random().toString(36).slice(2, 10), md: mdText };
    tab().blocks.splice(afterId ? indexOf(afterId) + 1 : 0, 0, tmp);
    var tel = drawBlock(tmp), prev0 = afterId ? blockEl(afterId) : null;
    if (prev0) { var nx0 = prev0.nextSibling; while (nx0 && nx0.classList && nx0.classList.contains("sug-add")) nx0 = nx0.nextSibling; page.insertBefore(tel, nx0); }
    else page.insertBefore(tel, page.firstChild);
    if (focusIt) focusBlock(tmp.id, focusIt === "end");
    drawToc();
    return tmp.id;
  }
  function insertBlock(afterId, mdText, focusIt) {
    if (mode === "suggest") return propose([{ op: "insert", after: afterId, md: mdText }]);
    if (realIds[afterId]) afterId = realIds[afterId];
    var tmp = showNew(afterId, mdText, focusIt); // several paragraphs too: the server splits them, a read then shows each
    var waiting = new Promise(function (res) { tmpWait[tmp] = res; });
    edit([{ op: "insert", after: afterId, md: mdText, tmp: tmp }]);
    return waiting;
  }
  /** One block becomes two, as ONE edit (the server takes both or neither): block `id` gets `mdText`, and a
   *  new block with `newMd` goes after `after` (id itself, or the block before it). Enter in a paragraph,
   *  leaving a list, lifting a list's first item, "---". base: the rev id's words were typed against. */
  function splitBlock(id, mdText, after, newMd, focusIt, base) {
    var b = blockOf(id), el = blockEl(id);
    if (!b) return Promise.resolve();
    if (mode === "suggest") return propose([{ op: "replace", block: id, md: mdText }, { op: "insert", after: after, md: newMd }]);
    if (realIds[after]) after = realIds[after];
    b.md = mdText;
    if (el) drawBlock(b, el);
    var tmp = showNew(after, newMd, focusIt);
    var waiting = new Promise(function (res) { tmpWait[tmp] = res; });
    edit([{ op: "replace", block: id, md: mdText }, { op: "insert", after: after, md: newMd, tmp: tmp }], base != null ? base : tab().rev);
    return waiting;
  }
  function removeBlock(id) {
    if (mode === "suggest") return propose([{ op: "delete", block: id }]);
    var i = indexOf(id);
    if (i < 0) return Promise.resolve();
    if (tab().blocks.length === 1) { tab().blocks[0].md = ""; drawBlock(tab().blocks[0], blockEl(id)); return edit([{ op: "replace", block: id, md: "" }]); }
    var p = edit([{ op: "delete", block: id }]); // first: it notes where the block was
    tab().blocks.splice(i, 1);
    var el = blockEl(id); if (el) el.remove();
    drawToc();
    return p;
  }

  // ------------------------------------------------------------------ editing a block in place
  function focusBlock(id, atEnd) {
    var el = blockEl(id);
    if (!el) return;
    var target = el.getAttribute("contenteditable") === "true" ? el : el.querySelector("[contenteditable=plaintext-only]");
    if (!target) return;
    target.focus({ preventScroll: false });
    var leaf = atEnd ? lastLeaf(target) : firstLeaf(target);
    E.placeCaret(leaf || target, atEnd);
  }
  function firstLeaf(el) { var n = el.querySelector("h1,h2,h3,h4,h5,h6,p,li,td,th,code") || el; return n; }
  function lastLeaf(el) { var all = el.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,td,th,code"); return all.length ? all[all.length - 1] : el; }
  function currentBlockEl() {
    var r = E.caretRange(); if (!r) return null;
    var n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
    return n && n.closest ? n.closest(".doc-blk[data-block]") : null;
  }
  function mdOf(el) {
    var src = el.querySelector("textarea.doc-src");
    if (src) return src.fenced ? src.fenced(src.value) : src.value;
    var code = el.querySelector("[contenteditable=plaintext-only]");
    if (code) { var b = blockOf(el.getAttribute("data-block")), m = /^(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(s(b && b.md)) || [0, "```", ""]; return m[1] + m[2] + "\n" + code.textContent.replace(/\n$/, "") + "\n" + m[1]; }
    return E.toMd(el);
  }
  // The block being typed in: saved (its words as last handed to the outbox), timer (a save waiting for a
  // pause), base (the rev its words were typed against: Hermes' change to it after that is a conflict, never
  // overwritten), sug (Hermes changed it: the words typed here go to the person's suggestion on it), theirs
  // (Hermes' text then). Words handed to the outbox stay there until the server takes them.
  function track(id, el) { return { id: id, el: el, saved: (blockOf(id) || {}).md, timer: null, base: tab().rev, sug: false, theirs: null }; }
  var composing = false; // an IME composition: the block it is in is not touched until it ends
  page.addEventListener("compositionstart", function () { composing = true; });
  page.addEventListener("compositionend", function () { composing = false; });
  function pendingFor(id) { // an edit of this block still in the outbox
    return outbox.some(function (e) { return e.ops.some(function (o) { return (realIds[o.block] || o.block) === id || o.tmp === id || realIds[o.tmp] === id; }); });
  }
  function dirty(f, el) { return !!(f.timer || f.sug || composing || pendingFor(f.id) || (el && mdOf(el) !== f.saved)); }
  function scheduleSave(el) {
    var id = el.getAttribute("data-block");
    if (!focused || focused.id !== id) focused = track(id, el);
    clearTimeout(focused.timer);
    focused.timer = setTimeout(function () { save(false); }, 700);
  }
  function save(final) {
    if (!focused) return Promise.resolve();
    var f = focused, el = blockEl(f.id);
    clearTimeout(f.timer); f.timer = null;
    if (!el) return Promise.resolve();
    var now = mdOf(el);
    if (now === f.saved) return Promise.resolve();
    f.saved = now; // in the outbox now: kept and sent until the server takes it (a block Hermes removed comes back: repairOps)
    var p = writeBlock(f.id, now, f.sug ? { sug: true } : { base: f.base });
    if (final) redrawOne(f.id);
    return p.then(function (r) {
      if (r && !r.sug && saveOutcome(r) === "ok" && mode !== "suggest") f.base = r.rev; // the next save is checked from here
    });
  }
  function redrawOne(id) { var b = blockOf(id), el = blockEl(id); if (b && el && !(focused && focused.id === id)) { drawBlock(b, el); drawToc(); } }
  function commit() {
    if (!focused) return;
    var f = focused;
    save(false);
    focused = null;
    if (f.sug) { var b0 = blockOf(f.id); if (b0 && f.theirs != null) b0.md = f.theirs; pull(true); } // now it shows Hermes' text and the person's suggestion on it
    redrawOne(f.id);
    ast = md.parse(fullText());
    sendView();
  }
  // Notion's hint on the empty line being typed in
  function markEmpty(el, on) {
    var empty = on && !el.textContent.trim() && !el.querySelector("img,[data-md],table,hr,pre");
    el.classList.toggle("is-empty", !!empty);
    if (empty) el.setAttribute("data-ph", /^H[1-6]$/.test((el.firstElementChild || {}).tagName) ? el.firstElementChild.tagName.replace("H", T.h1.replace(/1$/, "")) : T.typeHint);
  }
  page.addEventListener("focusin", function (e) {
    var el = e.target.closest && e.target.closest(".doc-blk[data-block]");
    if (!el || el.hasAttribute("data-source")) return;
    markEmpty(el, true);
    if (focused && focused.id !== el.getAttribute("data-block")) commit();
    if (!focused) focused = track(el.getAttribute("data-block"), el);
    sendView();
  });
  page.addEventListener("focusout", function (e) {
    var el = e.target.closest && e.target.closest(".doc-blk[data-block]");
    if (el) markEmpty(el, false);
    setTimeout(function () {
      if (!el || !focused || focused.id !== el.getAttribute("data-block")) return;
      if (el.contains(document.activeElement) || floating()) return;
      commit();
    }, 0);
  });
  function floating() { return [selBar, slash.el, popover, dlg && dlg.el].some(function (x) { return x && !x.hidden && x.contains(document.activeElement); }); }
  // Questions are asked in the page itself: the viewer's frame is sandboxed, where prompt() and confirm() do nothing.
  var dlg = null;
  function closeDlg(v) {
    if (!dlg) return;
    var d = dlg; dlg = null;
    d.el.remove(); document.removeEventListener("mousedown", d.out, true);
    d.done(v);
  }
  /** ask(label, value) -> the text typed (null when left); ask(label) -> true or false. */
  function ask(label, value, yes) {
    closeDlg(null);
    return new Promise(function (done) {
      var text = value !== undefined, none = text ? null : false;
      var input = text ? h("input", { type: "text", "class": "doc-dlg-in", value: value || "", "aria-label": label }) : null;
      var ok = h("button", { type: "button", "class": "doc-src-done", text: yes || T.ok });
      var no = h("button", { type: "button", "class": "doc-data-cancel", text: T.cancel });
      var el = h("div", { "class": "doc-dlg", role: "dialog", "aria-label": label }, [h("div", { "class": "doc-dlg-q", text: label }), input, h("div", { "class": "doc-dlg-bar" }, [no, ok])]);
      var finish = function () { closeDlg(text ? input.value.trim() || null : true); };
      ok.addEventListener("click", finish);
      no.addEventListener("click", function () { closeDlg(none); });
      el.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(); }
        else if (e.key === "Escape") { e.preventDefault(); closeDlg(none); }
      });
      var out = function (e) { if (!el.contains(e.target)) closeDlg(none); };
      dlg = { el: el, done: done, out: out };
      document.body.appendChild(el);
      setTimeout(function () { if (dlg && dlg.el === el) document.addEventListener("mousedown", out, true); }, 0);
      (input || ok).focus(); if (input) input.select();
    });
  }
  page.addEventListener("input", function (e) {
    var el = e.target.closest && e.target.closest(".doc-blk[data-block]");
    if (!el || el.hasAttribute("data-source")) return;
    el.removeAttribute("data-empty");
    markEmpty(el, true);
    if (slash.open) slash.update();
    else if (slashTyped(el)) slash.show(el, slashTyped(el));
    else shortcuts(el);
    scheduleSave(el);
  });

  // Markdown shortcuts at the start of a paragraph: "# ", "- ", "1. ", "[] ", "> ".
  function shortcuts(el) {
    var p = el.firstElementChild;
    if (!p || el.children.length !== 1 || p.tagName !== "P") return;
    var t = p.textContent.replace(/\u00a0/g, " "), m = /^(#{1,3}|[-*]|1\.|\[\s?\]|>) $/.exec(t.slice(0, 5).replace(/^(\S+ ).*$/, "$1"));
    if (!m || !E.caretRange() || t.indexOf(m[0]) !== 0) return;
    var r = E.caretRange(); if (r.startContainer.textContent.slice(0, r.startOffset).replace(/\u00a0/g, " ") !== m[0]) return;
    var rest = E.inlineMd(p).replace(/^(\\?#{1,3}|\\?[-*]|1\\?\.|\\\[\s?\\\]|>)(\s|&nbsp;)+/, "");
    var k = m[1], newMd = /^#/.test(k) ? k + " " + (rest || "") : k === "-" || k === "*" ? "- " + rest : k === "1." ? "1. " + rest : k === ">" ? "> " + rest : "- [ ] " + rest;
    var id = el.getAttribute("data-block"), b = blockOf(id);
    b.md = newMd;
    drawBlock(b, el);
    if (!rest) { // nothing typed yet: the empty heading, item or quote still needs a line for the caret
      var q = el.querySelector("blockquote");
      if (q && !q.firstChild) q.innerHTML = "<p><br></p>";
      var leaf = firstLeaf(el);
      if (leaf !== el && leaf.tagName !== "LI" && !leaf.textContent) leaf.innerHTML = "<br>";
    }
    focusBlock(id, true);
    scheduleSave(el);
  }

  // "/" typed at the start of a block or after a space opens the block menu
  function slashTyped(el) {
    var r = E.caretRange();
    if (!r || !r.collapsed || r.startContainer.nodeType !== 3 || cellOf(r.startContainer)) return false;
    var before = r.startContainer.nodeValue.slice(0, r.startOffset);
    var m = /(^|\s)([\/@])$/.exec(before.replace(/\u00a0/g, " "));
    return m ? m[2] : false;
  }
  function liOf(n) { n = n && (n.nodeType === 1 ? n : n.parentNode); return n && n.closest ? n.closest("li") : null; }
  function cellOf(n) { n = n && (n.nodeType === 1 ? n : n.parentNode); return n && n.closest ? n.closest("td,th") : null; }
  function containerOf(n, el) {
    n = n && (n.nodeType === 1 ? n : n.parentNode);
    while (n && n.parentNode !== el && n !== el) n = n.parentNode;
    return n === el ? null : n;
  }
  function editableNeighbour(id, dir) {
    var i = indexOf(id) + dir;
    while (i >= 0 && i < tab().blocks.length) { var b = tab().blocks[i]; if (editable(b)) return b; i += dir; }
    return null;
  }
  page.addEventListener("keydown", function (e) {
    var el = e.target.closest && e.target.closest(".doc-blk[data-block]");
    if (!el || !live || el.hasAttribute("data-source")) return; // the source box is a plain text field
    var id = el.getAttribute("data-block"), b = blockOf(id);
    if (!b) return;
    if (slash.open && slash.key(e)) return;
    var r = E.caretRange(), code = el.querySelector("[contenteditable=plaintext-only]");
    if (focused && focused.sug && focused.id === id && (e.key === "Enter" || e.key === "Tab" || (e.key === "Backspace" && r && r.collapsed && E.caretAt(el, false)))) {
      e.preventDefault(); // the block holds the person's suggestion on Hermes' text: typed on, never split or merged
      if (e.key === "Enter") document.execCommand("insertLineBreak");
      return;
    }
    if (code) { // a code block: lines are its own; Escape leaves it
      if (e.key === "Escape") { e.preventDefault(); code.blur(); }
      return;
    }
    var li = r && liOf(r.startContainer), cell = r && cellOf(r.startContainer);
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && /^[bius]$/i.test(e.key)) {
      e.preventDefault(); format({ b: "bold", i: "italic", u: "underline", s: "strikeThrough" }[e.key.toLowerCase()]); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); makeLink(); return; }
    if (e.key === "Escape") { e.preventDefault(); el.blur(); commit(); return; }
    if (e.key === "F10" && e.shiftKey && cell) { e.preventDefault(); var cr = cell.getBoundingClientRect(); tableMenu(cell, cr.left + 12, cr.bottom + 4); return; }
    if (e.key === "Tab" && cell) { e.preventDefault(); moveCell(cell, e.shiftKey ? -1 : 1); return; }
    if (e.key === "Tab" && li) { e.preventDefault(); e.shiftKey ? outdent(li) : indent(li); scheduleSave(el); return; }
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); document.execCommand("insertLineBreak"); return; }
    if (e.key === "Enter") {
      var ask = /^@hermes\b\s*([\s\S]+)$/i.exec(el.textContent.trim());
      if (ask && !li && !cell) { e.preventDefault(); askHere(id, ask[1].trim()); return; }
      if (cell) { e.preventDefault(); moveCellDown(cell); return; }
      e.preventDefault();
      if (li) return enterInItem(el, li);
      return enterInBlock(el);
    }
    if (e.key === "Backspace" && r && r.collapsed) {
      if (li && E.caretAt(li, false) && !li.previousElementSibling && li.parentNode.parentNode === el) { e.preventDefault(); liftItem(el, li); return; }
      if (cell || li) return;
      var c0 = containerOf(r.startContainer, el) || el;
      if (!E.caretAt(c0, false)) return;
      e.preventDefault();
      if (/^H[1-6]$/.test(c0.tagName)) { b.md = E.inlineMd(c0); drawBlock(b, el); focusBlock(id, false); scheduleSave(el); return; }
      if (el.textContent.trim() === "" && !el.querySelector("img,[data-md]") && tab().blocks.length > 1) {
        var prevB = editableNeighbour(id, -1); focused = null;
        removeBlock(id); if (prevB) focusBlock(prevB.id, true); return;
      }
      mergeUp(el, b);
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && r && r.collapsed && !cell && (e.key === "ArrowUp" ? E.caretLine(el, false) : E.caretAt(el, false))) {
      var p = editableNeighbour(id, -1); if (p) { e.preventDefault(); commit(); focusBlock(p.id, true); }
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowRight") && r && r.collapsed && !cell && (e.key === "ArrowDown" ? E.caretLine(el, true) : E.caretAt(el, true))) {
      var n = editableNeighbour(id, 1); if (n) { e.preventDefault(); commit(); focusBlock(n.id, false); }
    }
  });
  function enterInBlock(el) {
    var id = el.getAttribute("data-block"), r = E.caretRange();
    var c0 = containerOf(r.startContainer, el) || el, quote = c0.tagName === "BLOCKQUOTE";
    var line = el.textContent.trim();
    if (/^(```|~~~)\s*[\w+#.-]*$/.test(line) || /^-{3,}$/.test(line)) { // "```" or "---" then Enter
      var b0 = blockOf(id), base0 = focused && focused.id === id ? focused.base : null;
      if (/^-{3,}$/.test(line)) { focused = null; splitBlock(id, "---", id, "", "start", base0); return; } // the rule and the line after it: one edit
      b0.md = line + "\n\n" + line.slice(0, 3);
      drawBlock(b0, el); writeBlock(id, b0.md); focusBlock(id, false);
      return;
    }
    if (E.caretAt(c0, false) && c0.textContent.trim()) { // at the start: a new empty block above
      var prev = indexOf(id) > 0 ? tab().blocks[indexOf(id) - 1].id : null;
      insertBlock(prev, "", null).then(function () { focusBlock(id, false); });
      return;
    }
    var frag = E.splitAtCaret(c0);
    var tmp = h("p"); tmp.appendChild(frag);
    var after = E.inlineMd(tmp).trim();
    if (quote) after = after ? "> " + after : "";
    var now = mdOf(el), base = focused && focused.id === id ? focused.base : null;
    focused = null;
    splitBlock(id, now, id, after, "start", base); // its first part and the new block: one edit
  }
  function enterInItem(el, li) {
    var list = li.parentNode, task = li.classList.contains("task") || !!li.querySelector(":scope > input");
    if (!li.textContent.trim() && !li.querySelector("ul,ol,img,[data-md]")) { // an empty item: leave the list
      var nested = list.parentNode.closest && list.parentNode.closest("li");
      if (nested) { outdent(li); scheduleSave(el); return; }
      li.remove();
      if (!list.children.length) list.remove();
      var id = el.getAttribute("data-block"), now = mdOf(el), base = focused && focused.id === id ? focused.base : null;
      focused = null;
      if (!s(now)) { blockOf(id).md = ""; drawBlock(blockOf(id), el); writeBlock(id, ""); focusBlock(id, false); return; }
      splitBlock(id, now, id, "", "start", base); // the list and the line after it: one edit
      return;
    }
    var sub = Array.prototype.filter.call(li.children, function (c) { return c.tagName === "UL" || c.tagName === "OL"; });
    sub.forEach(function (x) { x.remove(); });
    var frag = E.splitAtCaret(li);
    var nl = document.createElement("li");
    if (task) { nl.className = "task"; var cb = document.createElement("input"); cb.type = "checkbox"; nl.appendChild(cb); }
    var rest = h("span"); rest.appendChild(frag);
    rest.querySelectorAll("input[type=checkbox]").forEach(function (x) { x.remove(); });
    while (rest.firstChild) nl.appendChild(rest.firstChild);
    if (!nl.textContent) nl.appendChild(document.createElement("br"));
    sub.forEach(function (x) { nl.appendChild(x); });
    li.after(nl);
    var rr = document.createRange(); rr.setStart(nl, task ? 1 : 0); rr.collapse(true);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rr);
    scheduleSave(el);
  }
  function indent(li) {
    var prev = li.previousElementSibling; if (!prev) return;
    var list = li.parentNode, sub = Array.prototype.find.call(prev.children, function (c) { return c.tagName === list.tagName; });
    if (!sub) { sub = document.createElement(list.tagName); prev.appendChild(sub); }
    sub.appendChild(li);
    E.placeCaret(li, true);
  }
  function outdent(li) {
    var list = li.parentNode, parentLi = list.parentNode.closest && list.parentNode.closest("li");
    if (!parentLi) return;
    var after = []; var n = li.nextElementSibling; while (n) { after.push(n); n = n.nextElementSibling; }
    parentLi.after(li);
    if (after.length) { var sub = document.createElement(list.tagName); after.forEach(function (x) { sub.appendChild(x); }); li.appendChild(sub); }
    if (!list.children.length) list.remove();
    E.placeCaret(li, true);
  }
  function liftItem(el, li) { // the first item, Backspace at its start: it becomes a paragraph above the list
    var id = el.getAttribute("data-block"), tmp = h("p");
    Array.prototype.slice.call(li.childNodes).forEach(function (c) { if (!(c.nodeType === 1 && (c.tagName === "INPUT" || c.tagName === "UL" || c.tagName === "OL"))) tmp.appendChild(c); });
    var lead = E.inlineMd(tmp).trim(), list = li.parentNode;
    li.remove();
    var rest = list.children.length ? mdOf(el) : "", base = focused && focused.id === id ? focused.base : null;
    focused = null;
    var prev = indexOf(id) > 0 ? tab().blocks[indexOf(id) - 1].id : null;
    if (rest) { splitBlock(id, rest, prev, lead || "", "start", base); } // the list's rest and the paragraph above it: one edit
    else { blockOf(id).md = lead; drawBlock(blockOf(id), el); writeBlock(id, lead); focusBlock(id, false); }
  }
  function mergeUp(el, b) {
    var p = editableNeighbour(b.id, -1);
    if (!p || indexOf(p.id) !== indexOf(b.id) - 1) return;
    var pa = md.parse(p.md), ca = md.parse(mdOf(el));
    if (!pa.length || !(pa[pa.length - 1].t === "p" || pa[pa.length - 1].t === "h") || ca.length !== 1 || ca[0].t !== "p") return;
    var pel = blockEl(p.id), offset = pel.textContent.length, mine = E.inlineMd(el.firstElementChild || el).trim();
    var merged = p.md.replace(/\s+$/, "") + mine;
    focused = null;
    var id = b.id;
    tab().blocks.splice(indexOf(id), 1); el.remove();
    p.md = merged; drawBlock(p, pel);
    (mode === "suggest" ? propose([{ op: "replace", block: p.id, md: merged }, { op: "delete", block: id }]) : edit([{ op: "replace", block: p.id, md: merged }, { op: "delete", block: id }]));
    pel.focus(); caretAtOffset(pel, offset);
  }
  function caretAtOffset(el, n) {
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), t;
    while ((t = w.nextNode())) { if (n <= t.nodeValue.length) { var r = document.createRange(); r.setStart(t, n); r.collapse(true); var s0 = window.getSelection(); s0.removeAllRanges(); s0.addRange(r); return; } n -= t.nodeValue.length; }
    E.placeCaret(el, true);
  }

  // ------------------------------------------------------------------ tables
  function cellsOf(row) { return Array.prototype.filter.call(row.children, function (c) { return c.tagName === "TD" || c.tagName === "TH"; }); }
  function rowsOf(table) { return Array.prototype.filter.call(table.querySelectorAll("tr"), function (tr) { return tr.closest("table") === table; }); }
  function moveCell(cell, dir) {
    var table = cell.closest("table"), all = []; rowsOf(table).forEach(function (r) { all = all.concat(cellsOf(r)); });
    var i = all.indexOf(cell) + dir;
    if (i >= all.length) { addRow(table, rowsOf(table).length - 1, true); all = []; rowsOf(table).forEach(function (r) { all = all.concat(cellsOf(r)); }); }
    if (i >= 0 && all[i]) E.placeCaret(all[i], true);
  }
  function moveCellDown(cell) {
    var row = cell.parentNode, k = cellsOf(row).indexOf(cell), rows = rowsOf(cell.closest("table")), i = rows.indexOf(row);
    if (rows[i + 1]) E.placeCaret(cellsOf(rows[i + 1])[k] || cellsOf(rows[i + 1])[0], true);
  }
  function addRow(table, at, below) {
    var rows = rowsOf(table), ref = rows[Math.max(0, Math.min(at, rows.length - 1))], n = cellsOf(rows[0]).length;
    var tr = document.createElement("tr");
    for (var k = 0; k < n; k++) tr.appendChild(document.createElement("td"));
    if (ref.parentNode.tagName === "THEAD") { var tb = table.querySelector("tbody") || table.appendChild(document.createElement("tbody")); tb.insertBefore(tr, tb.firstChild); }
    else if (below) ref.after(tr); else ref.before(tr);
    return tr;
  }
  function addCol(table, at, right) {
    rowsOf(table).forEach(function (row) {
      var cs = cellsOf(row), ref = cs[Math.max(0, Math.min(at, cs.length - 1))], c = document.createElement(ref.tagName);
      if (right) ref.after(c); else ref.before(c);
    });
  }
  // ------------------------------------------------------------------ menus like Claude's doc: icons, groups, submenus, a swatch row
  var MI = {
    plus: "M12 5v14M5 12h14",
    text: "M5 7V5h14v2M12 5v14M9 19h6", h1: "M4 6v12M12 6v12M4 12h8M17 10l2-1v9", h2: "M4 6v12M12 6v12M4 12h8M16 10.5a2 2 0 0 1 4 .5c0 2-4 3.5-4 6h4", h3: "M4 6v12M12 6v12M4 12h8M16 9.5h4l-2.5 3a2.3 2.3 0 1 1-1.5 4",
    table: "M4 5h16v14H4zM4 10h16M4 14.5h16M10 5v14", dropdown: "M4 6h16v12H4zM14 11l2 2 2-2", bullets: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
    checklist: "M4 7l2 2 3-3M4 15l2 2 3-3M12 8h8M12 16h8", code: "M9 8l-4 4 4 4M15 8l4 4-4 4", date: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4", divider: "M4 12h16",
    image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01", numbers: "M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 13.5a1.5 1.5 0 0 1 3 0c0 1.5-3 2-3 3.5h3", quote: "M5 6v12M9 8h10M9 12h10M9 16h6",
    formula: "M18 5H8l5 7-5 7h10", chart: "M5 19V9M10 19V5M15 19v-7M20 19v-4", mention: "M16 12a4 4 0 1 1-1.2-2.8V13a2 2 0 0 0 4 0v-1a7 7 0 1 0-3 5.7",
    hermes: "M12 6v15M12 6.5c-1.8-2.2-4.6-2.9-8-2.4 1.6 1.6 4.4 2.6 8 2.6M12 6.5c1.8-2.2 4.6-2.9 8-2.4-1.6 1.6-4.4 2.6-8 2.6M12 4.6a1.3 1.3 0 1 0 0-.1M9 10.5c4.5 1.2 6 2.6 6 3.6s-6 1.6-6 3.4c0 1 1.5 1.6 3 2M15 10.5c-4.5 1.2-6 2.6-6 3.6s6 1.6 6 3.4c0 1-1.5 1.6-3 2", person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0", tab: "M7 3h7l5 5v12H7zM14 3v5h5",
    rowAbove: "M4 14h16v6H4zM12 4v7M9 7l3-3 3 3", rowBelow: "M4 4h16v6H4zM12 13v7M9 17l3 3 3-3", colLeft: "M14 4h6v16h-6zM4 12h7M7 9l-3 3 3 3", colRight: "M4 4h6v16H4zM13 12h7M17 9l3 3-3 3",
    move: "M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3", width: "M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3M12 5v14",
    delRow: "M4 8h16v8H4zM9 12h6", delCol: "M8 4h8v16H8zM12 9v6", trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13", sortAsc: "M12 19V5M6 11l6-6 6 6", sortDesc: "M12 5v14M6 13l6 6 6-6",
    alignL: "M4 6h16M4 10h10M4 14h16M4 18h10", alignC: "M4 6h16M7 10h10M4 14h16M7 18h10", alignR: "M4 6h16M10 10h10M4 14h16M10 18h10", header: "M4 5h16v14H4zM4 10h16",
    duplicate: "M8 8h12v12H8zM16 8V4H4v12h4", up: "M12 19V5M6 11l6-6 6 6", down: "M12 5v14M6 13l6 6 6-6", comment: "M4 5h16v11H9l-5 4z", turn: "M4 7h11l-3-3M20 17H9l3 3",
    caret: "M10 7l5 5-5 5"
  };
  function micon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (MI[name] || "") + '"/></svg>';
  }
  var menuStack = [];
  function closeMenus(from) {
    while (menuStack.length > (from || 0)) { var m = menuStack.pop(); m.el.remove(); }
    if (!menuStack.length) { document.removeEventListener("mousedown", menuOut, true); window.removeEventListener("scroll", closeAllMenus, true); window.removeEventListener("resize", closeAllMenus); }
  }
  function closeAllMenus(e) { // the page scrolling closes menus; a menu's own list scrolling does not
    if (e && e.type === "scroll" && e.target && e.target.nodeType === 1 && e.target.closest(".doc-rmenu")) return;
    closeMenus(0);
  }
  function menuOpen() { return menuStack.length > 0 || !!document.querySelector(".kit-menu, .doc-pop"); }
  function menuOut(e) {
    var opener = menuStack[0] && menuStack[0].from;
    if (opener && opener.contains(e.target)) return; // its own button: the click closes it (no close-and-reopen)
    if (!menuStack.some(function (m) { return m.el.contains(e.target); })) closeMenus(0);
  }
  /** items: {icon, label, onClick, danger, disabled, sub: [items] | () => [items], hint, sep, swatches: [{color, label, onClick}]} */
  function richMenu(x, y, items, level, from) {
    level = level || 0;
    if (!level && from && menuStack[0] && menuStack[0].from === from) { closeMenus(0); return null; } // a second click on its button closes it
    closeMenus(level);
    var el = h("div", { "class": "doc-rmenu", role: "menu" }), rows = [];
    items.forEach(function (it) {
      if (it.sep) return el.appendChild(h("div", { "class": "doc-rm-sep" }));
      if (it.hint) return el.appendChild(h("div", { "class": "doc-rm-hint", text: it.hint }));
      if (it.swatches) {
        el.appendChild(h("div", { "class": "doc-rm-swatches" }, it.swatches.map(function (s) {
          var b = h("button", { type: "button", "class": "doc-rm-sw" + (s.color ? " sw-" + s.color : " sw-none"), title: s.label, "aria-label": s.label });
          b.addEventListener("mousedown", function (e) { e.preventDefault(); });
          b.addEventListener("click", function () { closeMenus(0); s.onClick(); });
          return b;
        })));
        return;
      }
      var b = h("button", { type: "button", role: "menuitem", "class": "doc-rm-item" + (it.danger ? " is-danger" : "") + (it.active ? " is-on" : ""), disabled: it.disabled || null,
        html: (it.icon ? micon(it.icon) : '<span class="doc-rm-noicon"></span>') + "<span>" + kit.esc(it.label) + "</span>" + (it.sub ? micon("caret") : it.active ? '<i class="doc-rm-check">✓</i>' : "") });
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      var openSub = function () {
        var r = b.getBoundingClientRect(), list = typeof it.sub === "function" ? it.sub() : it.sub;
        richMenu(r.right + 2, r.top - 4, list, level + 1);
      };
      if (it.sub) b.addEventListener("mouseenter", openSub);
      else b.addEventListener("mouseenter", function () { closeMenus(level + 1); });
      b.addEventListener("click", function () { if (it.disabled) return; if (it.sub) return openSub(); closeMenus(0); it.onClick && it.onClick(); });
      rows.push(b);
      el.appendChild(b);
    });
    document.body.appendChild(el);
    var w = el.offsetWidth, hh = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
    el.style.top = Math.max(8, Math.min(y, innerHeight - hh - 8)) + "px";
    menuStack.push({ el: el, rows: rows, i: -1, from: from || null });
    if (menuStack.length === 1) setTimeout(function () {
      document.addEventListener("mousedown", menuOut, true);
      window.addEventListener("scroll", closeAllMenus, true); window.addEventListener("resize", closeAllMenus); // a menu never drifts from its button
    }, 0);
    return el;
  }
  // The keyboard drives the top menu: arrows, Enter, Escape, → into a submenu, ← out of it.
  document.addEventListener("keydown", function (e) {
    if (!menuStack.length) return;
    var m = menuStack[menuStack.length - 1], n = m.rows.length;
    var move = function (d) { var i = m.i; do { i = (i + d + n) % n; } while (m.rows[i].disabled && i !== m.i); m.i = i; m.rows.forEach(function (r, k) { r.classList.toggle("is-focus", k === i); }); };
    if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); move(-1); }
    else if ((e.key === "Enter" || e.key === "ArrowRight") && m.i >= 0) { e.preventDefault(); e.stopPropagation(); if (e.key === "Enter" || m.rows[m.i].querySelector("svg:last-child")) m.rows[m.i].click(); }
    else if (e.key === "Escape" || e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); closeMenus(menuStack.length - 1); }
  }, true);
  function swatchRow(apply) {
    return { swatches: [{ color: "", label: T.clear, onClick: function () { apply(""); } }].concat(md.COLORS.map(function (c) { return { color: c, label: T.colors[c], onClick: function () { apply(c); } }; })) };
  }

  function saveEl(el) {
    var id = el.getAttribute("data-block");
    if (!focused || focused.id !== id) focused = track(id, el);
    var p = save(false);
    if (!(document.activeElement && el.contains(document.activeElement))) focused = null;
    return p;
  }
  function eachInCol(table, k, fn) { rowsOf(table).forEach(function (r) { var c = cellsOf(r)[k]; if (c) fn(c, r); }); }
  function sortRows(table, k, dir) {
    var rows = rowsOf(table).slice(1);
    if (!rows.length) return;
    var parent = rows[0].parentNode, num = function (s) { var n = parseFloat(String(s).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : null; };
    rows.sort(function (a, b) {
      var x = ((cellsOf(a)[k] || {}).textContent || "").trim(), y = ((cellsOf(b)[k] || {}).textContent || "").trim(), nx = num(x), ny = num(y);
      if (!x || !y) return x ? -1 : y ? 1 : 0; // blank cells go last, whichever way it sorts
      return (nx !== null && ny !== null ? nx - ny : x.localeCompare(y, L)) * dir;
    });
    rows.forEach(function (r) { parent.appendChild(r); });
  }
  function paint(cell, c) { cell.className = (cell.className || "").replace(/\bmd-bg-[a-z]+\b/g, "").trim(); if (c) cell.classList.add("md-bg-" + c); }
  function setWidth(table, k, w) {
    var th = cellsOf(rowsOf(table)[0])[k];
    if (!th) return;
    th.className = (th.className || "").replace(/\bcw-[a-z]+\b/g, "").trim();
    if (w) th.classList.add("cw-" + w);
  }
  function chipInCell(cell, src) {
    var el = cell.closest(".doc-blk");
    el.focus(); E.placeCaret(cell, true);
    var tmp = h("span"); tmp.innerHTML = md.inline(md.parseInline(src), imgSrc, R);
    document.execCommand("insertHTML", false, tmp.innerHTML + "&nbsp;");
    saveEl(el);
  }
  // Claude's cell menu: right-click a cell, or Shift+F10 in it.
  function tableMenu(cell, x, y, from) {
    var table = cell.closest("table"), el = table.closest(".doc-blk"), id = el.getAttribute("data-block");
    var row = cell.parentNode, rows = rowsOf(table), k = cellsOf(row).indexOf(cell), i = rows.indexOf(row), cols = cellsOf(rows[0]).length;
    var done = function () { saveEl(el); hideTableUi(); };
    var th = cellsOf(rows[0])[k], cw = th && (/\bcw-(narrow|medium|wide|extra)\b/.exec(th.className || "") || [])[1] || "";
    richMenu(x, y, [
      { icon: "rowAbove", label: T.rowAbove, onClick: function () { addRow(table, i, false); done(); } },
      { icon: "rowBelow", label: T.rowBelow, onClick: function () { addRow(table, i, true); done(); } },
      { icon: "colLeft", label: T.colLeft, onClick: function () { addCol(table, k, false); done(); } },
      { icon: "colRight", label: T.colRight, onClick: function () { addCol(table, k, true); done(); } },
      { icon: "move", label: T.moveRowCol, sub: [
        { icon: "up", label: T.moveRowUp, disabled: i < 2, onClick: function () { rows[i - 1].before(row); done(); } },
        { icon: "down", label: T.moveRowDown, disabled: i < 1 || i >= rows.length - 1, onClick: function () { rows[i + 1].after(row); done(); } },
        { icon: "colLeft", label: T.moveColLeft, disabled: k < 1, onClick: function () { eachInCol(table, k, function (c) { c.previousElementSibling.before(c); }); done(); } },
        { icon: "colRight", label: T.moveColRight, disabled: k >= cols - 1, onClick: function () { eachInCol(table, k, function (c) { c.nextElementSibling.after(c); }); done(); } }] },
      { icon: "width", label: T.colWidth, sub: [["narrow", T.wNarrow], ["medium", T.wMedium], ["wide", T.wWide], ["extra", T.wExtra], ["", T.wAuto]].map(function (w) {
        return { label: w[1], active: cw === w[0], onClick: function () { setWidth(table, k, w[0]); done(); } };
      }) },
      { sep: true },
      { icon: "delRow", label: T.delRow, disabled: i < 1 || rows.length < 3, onClick: function () { row.remove(); done(); } },
      { icon: "delCol", label: T.delCol, disabled: cols < 2, onClick: function () { eachInCol(table, k, function (c) { c.remove(); }); done(); } },
      { icon: "trash", label: T.delTable, danger: true, onClick: function () { hideTableUi(); removeBlock(id); } },
      { sep: true },
      { icon: "sortAsc", label: T.sortAsc, onClick: function () { sortRows(table, k, 1); done(); } },
      { icon: "sortDesc", label: T.sortDesc, onClick: function () { sortRows(table, k, -1); done(); } },
      { sep: true },
      { icon: "alignL", label: T.alignL, onClick: function () { eachInCol(table, k, function (c) { c.style.textAlign = ""; }); done(); } },
      { icon: "alignC", label: T.alignC, onClick: function () { eachInCol(table, k, function (c) { c.style.textAlign = "center"; }); done(); } },
      { icon: "alignR", label: T.alignR, onClick: function () { eachInCol(table, k, function (c) { c.style.textAlign = "right"; }); done(); } },
      { sep: true },
      swatchRow(function (c) { paint(cell, c); done(); }),
      { sep: true },
      { icon: "dropdown", label: T.dropdown, onClick: function () { Promise.resolve(itemByKey("dropdown").chip()).then(function (c) { if (c) chipInCell(cell, c); }); } },
      { icon: "date", label: T.date, onClick: function () { chipInCell(cell, "{{date:" + new Date().toISOString().slice(0, 10) + "}}"); } }
    ], 0, from);
  }
  page.addEventListener("contextmenu", function (e) {
    var cell = live && cellOf(e.target);
    if (!cell || !cell.closest(".doc-blk[contenteditable=true]")) return;
    e.preventDefault();
    tableMenu(cell, e.clientX, e.clientY);
  });

  // Claude's table handles: a pill on the hovered row's left edge and the hovered column's top edge,
  // a + bar when the pointer nears the bottom or right edge, a … menu, and ⋮⋮ to move the table.
  var PLUS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>';
  var GRIP_V = '<svg viewBox="0 0 10 16" fill="currentColor"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';
  function uiBtn(cls, label, html) {
    var b = h("button", { type: "button", "class": "doc-tui " + cls, title: label, "aria-label": label, html: html || "", hidden: true });
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    document.body.appendChild(b);
    return b;
  }
  var tui = { row: uiBtn("doc-tui-row", T.rowMenu), col: uiBtn("doc-tui-col", T.colMenu),
    addRow: uiBtn("doc-tui-addrow", T.addRow, PLUS), addCol: uiBtn("doc-tui-addcol", T.addCol, PLUS) };
  var tState = { table: null, row: 0, col: 0 };
  function hideTableUi() { Object.keys(tui).forEach(function (k) { tui[k].hidden = true; }); tState.table = null; }
  function place(b, x, y, w, hh) { b.hidden = false; b.style.left = x + "px"; b.style.top = y + "px"; if (w != null) b.style.width = w + "px"; if (hh != null) b.style.height = hh + "px"; }
  function showTableUi(table, cell, px, py) {
    tState.table = table;
    var tr = table.getBoundingClientRect();
    if (cell) {
      var row = cell.parentNode, rr = row.getBoundingClientRect();
      tState.row = rowsOf(table).indexOf(row); tState.col = cellsOf(row).indexOf(cell);
      place(tui.row, tr.left - 4, rr.top + rr.height / 2 - 9);
      var head = cellsOf(rowsOf(table)[0])[tState.col], hr = head ? head.getBoundingClientRect() : cell.getBoundingClientRect();
      place(tui.col, hr.left + hr.width / 2 - 9, tr.top - 4);
    }
    // The two "add" bars follow one rule: the bar under the table shows from the last row (and below it),
    // the bar beside it from the last column (and right of it).
    var rows = rowsOf(table);
    var nearRow = cell ? cell.parentNode === rows[rows.length - 1] : py != null && py > tr.bottom - 4;
    var nearCol = cell ? !cell.nextElementSibling : px != null && px > tr.right - 4;
    if (nearRow) place(tui.addRow, tr.left, tr.bottom + 2, tr.width); else if (!tui.addRow.matches(":hover")) tui.addRow.hidden = true;
    if (nearCol) place(tui.addCol, tr.right + 2, tr.top, null, tr.height); else if (!tui.addCol.matches(":hover")) tui.addCol.hidden = true;
  }
  tui.row.addEventListener("click", function (e) {
    var t = tState.table; if (!t) return;
    var c = cellsOf(rowsOf(t)[tState.row])[0]; if (c) tableMenu(c, e.clientX + 8, e.clientY, tui.row);
  });
  tui.col.addEventListener("click", function (e) {
    var t = tState.table; if (!t) return;
    var c = cellsOf(rowsOf(t)[0])[tState.col]; if (c) tableMenu(c, e.clientX, e.clientY + 10, tui.col);
  });
  tui.addRow.addEventListener("click", function () {
    var t = tState.table; if (!t) return;
    var tr = addRow(t, rowsOf(t).length - 1, true), el = t.closest(".doc-blk");
    saveEl(el); el.focus(); E.placeCaret(tr.firstChild, true);
    var r = t.getBoundingClientRect(); place(tui.addRow, r.left, r.bottom + 2, r.width); // the bar moves with the table's new edge
  });
  tui.addCol.addEventListener("click", function () {
    var t = tState.table; if (!t) return;
    addCol(t, 999, true);
    var el = t.closest(".doc-blk"), head = cellsOf(rowsOf(t)[0]);
    saveEl(el); el.focus(); E.placeCaret(head[head.length - 1], true); // the caret goes to the new column, as it does to a new row
    var r = t.getBoundingClientRect(); place(tui.addCol, r.right + 2, r.top, null, r.height); // the bar moves with the table's new edge
  });

  // ⋮⋮ beside a table: drag it to another place, or click for its menu (as in Claude's doc).
  var drag = null, dropLine = h("div", { "class": "doc-dropline", hidden: true });
  document.body.appendChild(dropLine);
  // ⋮⋮ and + beside every block, as in Notion: + adds a block below and opens the / menu; ⋮⋮ drags it or opens its menu.
  var gut = { el: h("div", { "class": "doc-gutter", hidden: true }), id: null };
  gut.plus = h("button", { type: "button", "class": "doc-g-plus", title: T.addBelow, "aria-label": T.addBelow, html: PLUS });
  gut.grip = h("button", { type: "button", "class": "doc-g-grip", title: T.blockMenu, "aria-label": T.blockMenu, html: GRIP_V });
  gut.el.append(gut.plus, gut.grip);
  document.body.appendChild(gut.el);
  [gut.plus, gut.grip].forEach(function (b) { b.addEventListener("mousedown", function (e) { e.preventDefault(); }); });
  function hideGutter() { gut.el.hidden = true; gut.id = null; }
  function showGutter(el) {
    var r = el.getBoundingClientRect(), first = el.firstElementChild, cs = getComputedStyle(first || el);
    var lh = parseFloat(cs.lineHeight); if (!isFinite(lh)) lh = (parseFloat(cs.fontSize) || 16) * 1.5;
    var ft = first ? first.getBoundingClientRect().top + (parseFloat(cs.paddingTop) || 0) : r.top;
    if (first && /^(TABLE|DIV|FIGURE|PRE)$/.test(first.tagName)) lh = 32;
    gut.id = el.getAttribute("data-block"); gut.el.hidden = false;
    var roomy = r.left >= 50; // a narrow pane has room for ⋮⋮ only; its menu then offers "add below"
    gut.plus.hidden = !roomy;
    gut.el.style.left = Math.max(0, r.left - (roomy ? 46 : 23)) + "px"; gut.el.style.top = (ft + Math.min(lh, 40) / 2 - 12) + "px";
  }
  function addBelow(id) {
    insertBlock(id, "", "end");
    var el = document.activeElement && document.activeElement.closest && document.activeElement.closest(".doc-blk");
    if (el) setTimeout(function () { slash.show(el, "/", true); }, 0); // after this click has passed the page's close-on-click
  }
  gut.plus.addEventListener("click", function () { var id = gut.id; if (!id) return; hideGutter(); addBelow(id); });
  gut.grip.addEventListener("mousedown", function (e) {
    var el = gut.id && blockEl(gut.id); if (!el) return;
    drag = { el: el, id: gut.id, x: e.clientX, y: e.clientY, moved: false, after: undefined };
  });
  document.addEventListener("mousemove", function (e) {
    if (drag) {
      if (!drag.moved && Math.abs(e.clientY - drag.y) + Math.abs(e.clientX - drag.x) < 5) return;
      drag.moved = true;
      drag.el.classList.add("is-dragging");
      var list = Array.prototype.filter.call(page.querySelectorAll(".doc-blk[data-block]"), function (x) { return x !== drag.el; });
      var before = list.find(function (x) { var r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      var ref = before ? before.getBoundingClientRect() : (list.length ? list[list.length - 1].getBoundingClientRect() : page.getBoundingClientRect());
      var pr = page.getBoundingClientRect();
      dropLine.hidden = false; dropLine.style.top = (before ? ref.top - 3 : ref.bottom + 1) + "px"; dropLine.style.left = pr.left + "px"; dropLine.style.width = pr.width + "px";
      var prev = before ? list[list.indexOf(before) - 1] : list[list.length - 1];
      drag.after = prev ? prev.getAttribute("data-block") : null;
      return;
    }
    hoverEv = e;
    if (!hoverRaf) hoverRaf = requestAnimationFrame(hoverUi); // the pointer fires far more often than the screen draws
  });
  var hoverEv = null, hoverRaf = 0;
  function hoverUi() {
    var e = hoverEv; hoverRaf = 0; hoverEv = null;
    if (!e || drag) return;
    if (!live || menuOpen()) return;
    if (bar.contains(e.target)) { hideGutter(); if (tState.table) hideTableUi(); return; } // nothing of the page's floats over its bar
    if (e.target === tui.addRow || tui.addRow.contains(e.target)) { tui.addCol.hidden = true; return; } // on one bar: the other goes
    if (e.target === tui.addCol || tui.addCol.contains(e.target)) { tui.addRow.hidden = true; return; }
    if (e.target.closest && e.target.closest(".doc-tui, .doc-gutter")) return;
    var pr0 = page.getBoundingClientRect(), over = null;
    if (e.clientX > pr0.left - 64 && e.clientX < pr0.right + 20) {
      over = e.target.closest ? e.target.closest(".doc-blk[data-block]") : null; // over a block: no need to measure them all
      if (over && !page.contains(over)) over = null;
      if (!over) over = Array.prototype.find.call(page.querySelectorAll(".doc-blk[data-block]"), function (x) { var r = x.getBoundingClientRect(); return e.clientY >= r.top && e.clientY < r.bottom; }) || null;
    }
    if (over && !/^tmp-/.test(over.getAttribute("data-block"))) showGutter(over); else if (!gut.el.matches(":hover")) hideGutter();
    var cell = cellOf(e.target), table = cell ? cell.closest("table") : null;
    if (table && table.closest(".doc-blk[contenteditable=true]")) showTableUi(table, cell, e.clientX, e.clientY);
    else if (tState.table) {
      var tr = tState.table.getBoundingClientRect();
      if (e.clientX < tr.left - 34 || e.clientX > tr.right + 44 || e.clientY < tr.top - 20 || e.clientY > tr.bottom + 26) hideTableUi();
      else showTableUi(tState.table, null, e.clientX, e.clientY);
    }
  }
  document.addEventListener("mouseup", function (e) {
    if (!drag) return;
    var d = drag; drag = null;
    dropLine.hidden = true; d.el.classList.remove("is-dragging");
    if (!d.moved) { var gr = gut.grip.getBoundingClientRect(); blockMenu(d.id, gr.left, gr.bottom + 4, gut.grip); return; }
    moveBlock(d.id, d.after);
  });
  window.addEventListener("scroll", function () {
    hideTableUi(); hideGutter(); closePopover();
    if (slash.open) { // the / menu stays with its line, and goes when the line passes under the bar
      if (slash.block && slash.block.getBoundingClientRect().bottom < bar.getBoundingClientRect().bottom) slash.close(); else slash.update();
    }
    if (!selBar.hidden && !selBar.contains(document.activeElement)) showSelBar(); // so does the bar over a selection
  }, { passive: true });
  function moveBlock(id, after) {
    var i = indexOf(id);
    if (i < 0 || after === undefined) return;
    var prev = i > 0 ? tab().blocks[i - 1].id : null;
    if (after === prev || after === id) return;
    commit();
    var b = tab().blocks.splice(i, 1)[0];
    tab().blocks.splice(after ? indexOf(after) + 1 : 0, 0, b);
    render();
    edit([{ op: "move", block: id, after: after }]);
  }
  // Turn a block into another kind: its words stay, its marks change.
  function turnInto(id, kind) {
    var b = blockOf(id);
    if (!b) return;
    var el = blockEl(id);
    if (focused && focused.id === id && el) b.md = mdOf(el);
    var lines = b.md.split("\n").map(function (l) { return l.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/, "").trim(); }).filter(Boolean);
    if (!lines.length) lines = [""];
    var one = lines.join(" ");
    var out = { text: lines.join("\n\n"), h1: "# " + one, h2: "## " + one, h3: "### " + one,
      bullets: lines.map(function (l) { return "- " + l; }).join("\n"), numbers: lines.map(function (l, n) { return (n + 1) + ". " + l; }).join("\n"),
      checklist: lines.map(function (l) { return "- [ ] " + l; }).join("\n"), quote: lines.map(function (l) { return "> " + l; }).join("\n"),
      code: "```\n" + lines.join("\n") + "\n```" }[kind];
    if (out == null || out === b.md) return;
    if (focused && focused.id === id) { clearTimeout(focused.timer); focused = null; }
    writeBlock(id, out);
    if (mode !== "suggest" && el) { drawBlock(blockOf(id), el); drawToc(); }
  }
  var TURN = [["text", "text", function () { return T.text; }], ["h1", "h1", function () { return T.h1; }], ["h2", "h2", function () { return T.h2; }], ["h3", "h3", function () { return T.h3; }],
    ["bullets", "bullets", function () { return T.bullets; }], ["numbers", "numbers", function () { return T.numbers; }], ["checklist", "checklist", function () { return T.checklist; }],
    ["quote", "quote", function () { return T.quote; }], ["code", "code", function () { return T.codeBlock; }]];
  function blockMenu(id, x, y, from) {
    var b = blockOf(id), el = blockEl(id);
    if (!b) return;
    var plain = !isWidget(b.md) && !/^\s*\|/.test(b.md) && !isCode(b.md) && pendingOf(b.md) === null && editable(b);
    var i = indexOf(id), items = [];
    if (plain) items.push({ icon: "turn", label: T.turnInto, sub: TURN.map(function (k) { return { icon: k[1], label: k[2](), onClick: function () { turnInto(id, k[0]); } }; }) }, { sep: true });
    if (live) items.unshift({ icon: "hermes", label: T.askBlock, onClick: function () { askBlock(id); } }, { sep: true });
    items.push(
      { icon: "plus", label: T.addBelow, onClick: function () { addBelow(id); } },
      { icon: "duplicate", label: T.duplicate, onClick: function () { insertBlock(id, b.md, null); } },
      { icon: "up", label: T.moveUp, disabled: i < 1, onClick: function () { moveBlock(id, i > 1 ? tab().blocks[i - 2].id : null); } },
      { icon: "down", label: T.moveDown, disabled: i >= tab().blocks.length - 1, onClick: function () { moveBlock(id, tab().blocks[i + 1].id); } });
    if (hm.comment) items.push({ icon: "comment", label: T.comment, onClick: function () { hm.comment({ selector: "#blk-" + id, text: (el ? el.textContent : "").trim().slice(0, 200), label: "text", tab: tab().id }); } });
    items.push({ sep: true }, { icon: "trash", label: T.del, danger: true, onClick: function () { hideTableUi(); hideGutter(); removeBlock(id); } });
    hideTableUi();
    richMenu(x, y, items, 0, from);
  }

  function askBlock(id) { // ask Hermes about one whole block
    var el = blockEl(id);
    if (!el) return;
    var r = el.getBoundingClientRect();
    selBar.hidden = false;
    selBar.style.top = r.bottom + 6 + "px"; selBar.style.left = Math.max(8, r.left) + "px";
    askEdit({ ids: [id], text: el.textContent.trim().slice(0, 600), rect: r });
  }

  // ------------------------------------------------------------------ checkboxes, chips, widgets, pending sections
  page.addEventListener("change", function (e) {
    if (e.target.type !== "checkbox") return;
    var li = e.target.closest("li"), el = e.target.closest(".doc-blk[data-block]");
    if (!li || !el || !live) return;
    li.classList.toggle("done", e.target.checked);
    if (!focused || focused.id !== el.getAttribute("data-block")) focused = track(el.getAttribute("data-block"), el);
    save(false);
  });
  var popover = null;
  function closePopover() { if (popover) { popover.remove(); popover = null; } }
  // Where a chip sits: its block and which occurrence of its source it is (the block may be redrawn
  // while its menu is open, so the change is made on the block's Markdown, not on the element).
  function chipPlace(chip) {
    var el = chip.closest(".doc-blk[data-block]"), src = chip.getAttribute("data-md");
    var same = Array.prototype.filter.call(el.querySelectorAll(".chip"), function (c) { return c.getAttribute("data-md") === src; });
    return { id: el.getAttribute("data-block"), src: src, nth: same.indexOf(chip) };
  }
  function chipChanged(place, src) {
    var b = blockOf(place.id);
    if (!b) return;
    var el = blockEl(place.id);
    if (focused && focused.id === place.id && el) { var now = mdOf(el); if (now !== b.md) b.md = now; } // keep what was typed
    var k = -1, at = -1;
    for (var i = 0; i <= place.nth; i++) { at = b.md.indexOf(place.src, k + 1); if (at < 0) return; k = at; }
    var next = b.md.slice(0, at) + src + b.md.slice(at + place.src.length);
    if (focused && focused.id === place.id) focused = null;
    writeBlock(place.id, next).then(function () { redrawOne(place.id); });
    if (mode !== "suggest") { b.md = next; if (el) drawBlock(b, el); }
  }
  page.addEventListener("click", function (e) {
    var drop = e.target.closest("[data-drop]");
    if (drop) { removeBlock(drop.getAttribute("data-drop")); render(); return; }
    var src = e.target.closest(".w-src");
    if (src) { openSource(src.closest(".doc-blk[data-block]")); return; }
    var ed = e.target.closest(".w-edit");
    if (ed) { openData(ed.closest(".doc-blk[data-block]")); return; }
    var chip = live && e.target.closest(".chip");
    if (chip && chip.closest(".doc-blk[contenteditable=true]")) { e.preventDefault(); chipMenu(chip); return; }
    var sugBtn = e.target.closest("[data-decide]");
    if (sugBtn) { decide(sugBtn.getAttribute("data-sid"), sugBtn.getAttribute("data-decide")); return; }
  });
  function chipMenu(chip) {
    var m = /^\{\{(?:date:(\d{4}-\d{2}-\d{2})|@(.*)|select:([^=]*)=(.*))\}\}$/.exec(chip.getAttribute("data-md") || "");
    if (!m) return;
    var r = chip.getBoundingClientRect(), place = chipPlace(chip);
    hideTableUi(); hideGutter();
    if (m[1]) {
      closePopover();
      var inp = h("input", { type: "date", value: m[1], "class": "doc-dateinp" });
      popover = h("div", { "class": "doc-pop" }, [inp]);
      document.body.appendChild(popover);
      popover.style.left = r.left + "px"; popover.style.top = r.bottom + 4 + "px";
      inp.focus(); try { inp.showPicker(); } catch (_) {}
      inp.addEventListener("change", function () {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) return;
        chipChanged(place, "{{date:" + inp.value + "}}");
        closePopover();
      });
      setTimeout(function () { document.addEventListener("mousedown", function out(ev) { if (popover && !popover.contains(ev.target)) { closePopover(); document.removeEventListener("mousedown", out, true); } }, true); }, 0);
      return;
    }
    if (m[3] != null) {
      var name = m[3].trim(), opts = optionsOf(name);
      menuAt(r.left, r.bottom + 4, opts.map(function (o, i) {
        return { label: (o === m[4].trim() ? "✓ " : "   ") + o, onClick: function () {
          chipChanged(place, "{{select:" + name + "=" + o + "}}");
        } };
      }).concat([{ label: T.editOptions, onClick: function () {
        ask(T.optionsAsk, opts.join(", ")).then(function (v) {
          if (v == null) return;
          var list = v.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
          selects[name] = list;
          edit([{ op: "set_select", name: name, options: list }]).then(function () { render(); });
        });
      } }]));
    }
  }
  // A chart's or a CSV's data, edited as a table: no JSON or CSV to know. The block keeps its source as text.
  function csvLine(cells) {
    return cells.map(function (c) { c = String(c == null ? "" : c); return /[",\n;]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(",");
  }
  function openData(el) {
    if (!el || !live) return;
    var id = el.getAttribute("data-block"), b = blockOf(id);
    var m = /^(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(s(b.md));
    if (!m) return openSource(el);
    var fence = m[1], lang = m[2].toLowerCase(), body = m[3];
    if (focused && focused.id === id) { clearTimeout(focused.timer); focused = null; }
    el.setAttribute("data-source", ""); el.removeAttribute("contenteditable");
    var spec = null, rows, head;
    if (lang === "chart") {
      try { spec = JSON.parse(body); } catch (e) { spec = {}; }
      var data = Array.isArray(spec.data) ? spec.data : [];
      var xk = spec.x || (data[0] ? Object.keys(data[0])[0] : "label");
      var ys = [].concat(spec.y || (data[0] ? Object.keys(data[0]).filter(function (k) { return k !== xk && typeof data[0][k] === "number"; }) : ["value"]));
      if (!ys.length) ys = ["value"];
      head = [xk].concat(ys);
      rows = data.map(function (r) { return head.map(function (k) { return r[k] == null ? "" : String(r[k]); }); });
    } else {
      var all = WG.csvRows(body);
      head = all[0] || ["A", "B"];
      rows = all.slice(1).map(function (r) { return head.map(function (_, k) { return r[k] || ""; }); });
    }
    if (!rows.length) rows = [head.map(function () { return ""; })];
    var box = h("div", { "class": "doc-data" });
    var meta = null;
    if (spec) {
      var titleIn = h("input", { type: "text", "class": "doc-data-in", value: spec.title || "", placeholder: T.chartTitle, "aria-label": T.chartTitle });
      var typeSel = h("select", { "class": "doc-data-in", "aria-label": T.chartType }, [["bar", T.cBar], ["line", T.cLine], ["area", T.cArea]].map(function (o) {
        var op = h("option", { value: o[0], text: o[1] }); if ((spec.type || "bar") === o[0]) op.selected = true; return op; }));
      var unitIn = h("input", { type: "text", "class": "doc-data-in doc-data-short", value: spec.unit || "", placeholder: T.chartUnit, "aria-label": T.chartUnit });
      var hiSel = h("select", { "class": "doc-data-in", "aria-label": T.chartHighlight });
      hiSel.addEventListener("change", function () { spec.highlight = hiSel.value || null; });
      var srcIn = h("input", { type: "text", "class": "doc-data-in", value: spec.source || "", placeholder: T.chartSource, "aria-label": T.chartSource });
      meta = h("div", { "class": "doc-data-meta" }, [
        h("label", {}, [h("span", { text: T.chartTitle }), titleIn]), h("label", {}, [h("span", { text: T.chartType }), typeSel]),
        h("label", {}, [h("span", { text: T.chartUnit }), unitIn]), h("label", {}, [h("span", { text: T.chartHighlight }), hiSel]),
        h("label", { "class": "doc-data-wide" }, [h("span", { text: T.chartSource }), srcIn])]);
      box.appendChild(meta);
    }
    var grid = h("table", { "class": "doc-data-grid" });
    var wrap = h("div", { "class": "doc-data-scroll" }, [grid]);
    box.appendChild(wrap);
    function cellIn(v, hd) {
      var i = h("input", { type: "text", "class": "doc-data-cell" + (hd ? " is-head" : ""), value: v });
      i.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(); }
        else if (e.key === "Enter") { e.preventDefault(); var td = i.closest("td,th"), tr = td.parentNode, k = Array.prototype.indexOf.call(tr.children, td), nx = tr.nextElementSibling;
          if (!nx) { readGrid(); rows.push(head.map(function () { return ""; })); draw(); nx = grid.rows[grid.rows.length - 1]; }
          var t = nx.children[k] && nx.children[k].querySelector("input"); if (t) t.focus(); }
        else if (e.key === "Escape") { e.preventDefault(); cancel(); }
      });
      return i;
    }
    function del(label, fn) { var b0 = h("button", { type: "button", "class": "doc-data-x", title: label, "aria-label": label, text: "×" }); b0.addEventListener("click", fn); return b0; }
    function readGrid() {
      var trs = grid.rows;
      head = Array.prototype.slice.call(trs[0].querySelectorAll("input")).map(function (i) { return i.value; });
      rows = Array.prototype.slice.call(trs, 1).map(function (tr) { return Array.prototype.slice.call(tr.querySelectorAll("input")).map(function (i) { return i.value; }); });
    }
    function draw() {
      grid.replaceChildren();
      var hr = h("tr");
      head.forEach(function (v, k) {
        var th = h("th", {}, [cellIn(v, true)]);
        if (k > 0 && head.length > 2) th.appendChild(del(T.delCol, function () { readGrid(); head.splice(k, 1); rows.forEach(function (r) { r.splice(k, 1); }); draw(); }));
        hr.appendChild(th);
      });
      hr.appendChild(h("th", { "class": "doc-data-side" }));
      grid.appendChild(hr);
      rows.forEach(function (r, i) {
        var tr = h("tr");
        head.forEach(function (_, k) { tr.appendChild(h("td", { "class": k > 0 && spec ? "num" : "" }, [cellIn(r[k] || "", false)])); });
        tr.appendChild(h("td", { "class": "doc-data-side" }, rows.length > 1 ? [del(T.delRow, function () { readGrid(); rows.splice(i, 1); draw(); })] : []));
        grid.appendChild(tr);
      });
      if (hiSel) {
        var cur = spec.highlight == null ? "" : String(spec.highlight);
        hiSel.replaceChildren.apply(hiSel, [h("option", { value: "", text: "—" })].concat(rows.map(function (r) { var o = h("option", { value: r[0], text: r[0] }); if (r[0] === cur) o.selected = true; return o; })));
      }
    }
    draw();
    var addRow = h("button", { type: "button", "class": "doc-data-add", text: "+ " + T.addRow });
    addRow.addEventListener("click", function () { readGrid(); rows.push(head.map(function () { return ""; })); draw(); var last = grid.rows[grid.rows.length - 1].querySelector("input"); if (last) last.focus(); });
    var addCol = h("button", { type: "button", "class": "doc-data-add", text: "+ " + (spec ? T.addSeries : T.addCol) });
    addCol.addEventListener("click", function () { readGrid(); head.push(spec ? T.seriesN + " " + head.length : String.fromCharCode(64 + head.length + 1)); rows.forEach(function (r) { r.push(""); }); draw(); });
    var ok = h("button", { type: "button", "class": "doc-src-done", text: T.done });
    var cancelB = h("button", { type: "button", "class": "doc-data-cancel", text: T.cancel });
    var srcB = h("button", { type: "button", "class": "doc-data-cancel", text: T.source });
    box.appendChild(h("div", { "class": "doc-src-bar" }, [addRow, addCol, h("span", { "class": "doc-gap" }), srcB, cancelB, ok]));
    el.replaceChildren(box);
    var firstIn = box.querySelector("input"); if (firstIn) firstIn.focus();
    var closed = false;
    function cancel() { if (closed) return; closed = true; el.removeAttribute("data-source"); drawBlock(blockOf(id) || b, el); }
    function finish() {
      if (closed) return; closed = true;
      readGrid();
      var keep = rows.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
      var out;
      if (spec) {
        var num = function (v) { var n = parseFloat(String(v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : null; };
        var next = { type: typeSel.value };
        if (titleIn.value.trim()) next.title = titleIn.value.trim();
        next.x = head[0] || "label";
        next.y = head.length > 2 ? head.slice(1) : head[1] || "value";
        if (unitIn.value.trim()) next.unit = unitIn.value.trim();
        if (hiSel.value) next.highlight = hiSel.value;
        next.data = keep.map(function (r) { var o = {}; o[next.x] = r[0]; head.slice(1).forEach(function (k, j) { o[k] = num(r[j + 1]); }); return o; });
        if (srcIn.value.trim()) next.source = srcIn.value.trim();
        out = fence + "chart\n" + JSON.stringify(next, null, 2) + "\n" + fence;
      } else {
        out = fence + "csv\n" + [head].concat(keep).map(csvLine).join("\n") + "\n" + fence;
      }
      el.removeAttribute("data-source");
      var cur = blockOf(id) || b;
      if (out !== cur.md) { cur.md = out; drawBlock(cur, el); writeBlock(id, out); } else drawBlock(cur, el);
    }
    ok.addEventListener("click", finish);
    cancelB.addEventListener("click", cancel);
    srcB.addEventListener("click", function () { if (closed) return; closed = true; el.removeAttribute("data-source"); drawBlock(blockOf(id) || b, el); openSource(el); });
    box.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(); } });
  }

  function openSource(el) { // a widget's source, as text, in place
    if (!el || !live) return;
    var id = el.getAttribute("data-block"), b = blockOf(id);
    if (focused && focused.id === id) { clearTimeout(focused.timer); focused = null; }
    // The block shows its source as text: the rich editor keeps out of it until Done.
    el.setAttribute("data-source", ""); el.removeAttribute("contenteditable");
    var ta = h("textarea", { "class": "doc-src", spellcheck: "false", "aria-label": T.source });
    // A widget shows what is inside its fence (the formula, the rows): the fence itself is not the person's to keep right.
    var fm = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n?\1\s*$/.exec(s(b.md));
    ta.fenced = fm ? function (v) { return fm[1] + fm[2] + "\n" + v.replace(/\s+$/, "") + "\n" + fm[1]; } : null;
    ta.value = fm ? fm[3] : b.md;
    var ok = h("button", { type: "button", "class": "doc-src-done", text: T.done });
    el.replaceChildren(h("div", { "class": "doc-src-box" }, [ta, h("div", { "class": "doc-src-bar" }, [h("span", { "class": "doc-src-hint", text: "Ctrl+Enter" }), ok])]));
    var size = function () { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
    size(); ta.focus();
    ta.addEventListener("input", size);
    var done = false;
    var finish = function () {
      if (done) return; done = true;
      var v = ta.fenced ? ta.fenced(ta.value) : ta.value, cur = blockOf(id) || b;
      el.removeAttribute("data-source");
      if ((ta.fenced || v.trim()) && v !== cur.md) { cur.md = v; drawBlock(cur, el); writeBlock(id, v); }
      else drawBlock(cur, el);
      drawToc();
    };
    ok.addEventListener("click", finish);
    ta.addEventListener("keydown", function (e) { if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finish(); } });
  }

  // ------------------------------------------------------------------ formatting (the selection bar and shortcuts)
  try { document.execCommand("styleWithCSS", false, false); } catch (_) {}
  function inEditable() { var r = E.caretRange(); return r && currentBlockEl() && currentBlockEl().getAttribute("contenteditable") === "true"; }
  function after(fn) { var el = currentBlockEl(); fn(); if (el) scheduleSave(el); showSelBar(); }
  function format(cmd) { if (!inEditable()) return; after(function () { document.execCommand(cmd); }); }
  function wrapSel(tag, cls) {
    var r = E.caretRange(); if (!r || r.collapsed || !inEditable()) return;
    after(function () {
      var w = document.createElement(tag); if (cls) w.className = cls;
      if (tag === "code") w.textContent = r.toString(); else w.appendChild(r.extractContents());
      r.deleteContents(); r.insertNode(w);
      var s0 = window.getSelection(); s0.removeAllRanges(); var nr = document.createRange(); nr.selectNodeContents(w); s0.addRange(nr);
    });
  }
  function clearColor() {
    var r = E.caretRange(); if (!r || !inEditable()) return;
    after(function () {
      var el = currentBlockEl();
      el.querySelectorAll("span[class*=md-],mark").forEach(function (sp) {
        if (!r.intersectsNode(sp) || /\bmd-underline\b/.test(sp.className) && sp.tagName === "SPAN" && !/md-(?!underline)/.test(sp.className)) return;
        if (sp.tagName === "SPAN") { sp.className = sp.className.split(/\s+/).filter(function (c) { return c === "md-underline"; }).join(" "); if (sp.className) return; }
        while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp); sp.remove();
      });
    });
  }
  function makeLink() {
    if (!inEditable()) return;
    var r = E.caretRange(); var saved = r && r.cloneRange();
    var home = currentBlockEl();
    ask(T.linkAsk, "https://").then(function (url) {
      if (!url || !/^(https?:\/\/|mailto:)/i.test(url)) return;
      if (home) home.focus();
      var s0 = window.getSelection(); s0.removeAllRanges(); if (saved) s0.addRange(saved);
      after(function () { if (saved && saved.collapsed) document.execCommand("insertHTML", false, '<a href="' + kit.esc(url) + '">' + kit.esc(url) + "</a>"); else document.execCommand("createLink", false, url); });
    });
  }
  var selBar = h("div", { "class": "doc-selbar", hidden: true });
  document.body.appendChild(selBar);
  selBar.addEventListener("mousedown", function (e) { if (e.target.tagName !== "INPUT") e.preventDefault(); }); // keep the selection
  function selectedBlocks() {
    var s0 = window.getSelection();
    if (!s0 || s0.isCollapsed || !s0.rangeCount) return null;
    var r = s0.getRangeAt(0), ids = [];
    tab().blocks.forEach(function (b) { var el = blockEl(b.id); if (el && r.intersectsNode(el)) ids.push(b.id); });
    return ids.length ? { ids: ids, text: String(s0).trim(), rect: r.getBoundingClientRect() } : null;
  }
  function tb(label, ico, fn, cls) {
    var b = h("button", { type: "button", "class": "doc-sb" + (cls ? " " + cls : ""), title: label, "aria-label": label, html: ico });
    b.addEventListener("click", fn);
    return b;
  }
  var SVG = function (d, extra) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' + (extra || "") + '><path d="' + d + '"/></svg>'; };
  var I = {
    hermes: SVG("M12 6v15M12 6.5c-1.8-2.2-4.6-2.9-8-2.4 1.6 1.6 4.4 2.6 8 2.6M12 6.5c1.8-2.2 4.6-2.9 8-2.4-1.6 1.6-4.4 2.6-8 2.6M12 4.6a1.3 1.3 0 1 0 0-.1M9 10.5c4.5 1.2 6 2.6 6 3.6s-6 1.6-6 3.4c0 1 1.5 1.6 3 2M15 10.5c-4.5 1.2-6 2.6-6 3.6s6 1.6 6 3.4c0 1-1.5 1.6-3 2"), comment: SVG("M4 5h16v11H9l-5 4z"),
    bold: '<b>B</b>', italic: '<i style="font-family:Georgia,serif">I</i>', underline: '<u>U</u>', strike: '<s>S</s>', code: SVG("M9 8l-4 4 4 4M15 8l4 4-4 4"),
    color: SVG("M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.1-.9-1.4-.9-2.4 0-.9.8-1.5 1.7-1.5H17a4 4 0 0 0 4-4c0-4.6-4-8.5-9-8.5z"),
    link: SVG("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1")
  };
  function showSelBar() {
    var sel = live ? selectedBlocks() : null;
    if (!sel || !sel.text) { selBar.hidden = true; return; }
    var canFormat = inEditable();
    selBar.replaceChildren.apply(selBar, [
      tb(T.editWith, I.hermes, function () { askEdit(sel); }, "is-hermes"),
      tb(T.comment, I.comment, function () {
        selBar.hidden = true;
        hm.comment && hm.comment({ selector: "#blk-" + sel.ids[0], text: sel.text.slice(0, 200), label: "text", tab: tabs[cur] && tabs[cur].id });
      })].concat(canFormat ? [h("span", { "class": "doc-sb-sep" }),
      tb(T.textStyle, '<span class="doc-sb-tt">T<small>T</small></span>' + CARET_S, function (e) {
        var r = e.currentTarget.getBoundingClientRect();
        richMenu(r.left, r.bottom + 6, TURN.slice(0, 4).concat([TURN[7], TURN[8]]).map(function (k) { return { icon: k[1], label: k[2](), onClick: function () { sel.ids.forEach(function (id) { turnInto(id, k[0]); }); } }; }), 0, e.currentTarget);
      }),
      tb(T.bold, I.bold, function () { format("bold"); }), tb(T.italic, I.italic, function () { format("italic"); }),
      tb(T.underline, I.underline, function () { format("underline"); }), tb(T.strike, I.strike, function () { format("strikeThrough"); }),
      tb(T.code, I.code, function () { wrapSel("code"); }),
      tb(T.color, I.color + CARET_S, function (e) { colorMenu(e.currentTarget); }),
      tb(T.listStyle, micon("bullets") + CARET_S, function (e) {
        var r = e.currentTarget.getBoundingClientRect();
        richMenu(r.left, r.bottom + 6, [TURN[4], TURN[5], TURN[6]].map(function (k) { return { icon: k[1], label: k[2](), onClick: function () { sel.ids.forEach(function (id) { turnInto(id, k[0]); }); } }; }), 0, e.currentTarget);
      }),
      tb(T.link, I.link, makeLink)] : []));
    var floor = bar.getBoundingClientRect().bottom + 4; // never over the doc's own bar
    if (sel.rect.bottom < floor || sel.rect.top > innerHeight) { selBar.hidden = true; return; } // the words scrolled out of sight
    selBar.hidden = false;
    var top = sel.rect.top - selBar.offsetHeight - 8;
    selBar.style.top = Math.max(floor, top < floor ? sel.rect.bottom + 8 : top) + "px";
    selBar.style.left = Math.max(8, Math.min(innerWidth - selBar.offsetWidth - 8, sel.rect.left + sel.rect.width / 2 - selBar.offsetWidth / 2)) + "px";
  }
  var CARET_S = '<svg class="doc-sb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg>';
  function colorMenu(anchor) {
    var r0 = anchor.getBoundingClientRect(), saved0 = E.caretRange() && E.caretRange().cloneRange();
    var back = function () { var s0 = window.getSelection(); s0.removeAllRanges(); if (saved0) s0.addRange(saved0); };
    var row = function (prefix) { return swatchRow(function (c) { back(); if (c) wrapSel("span", "md-" + prefix + c); else clearColor(); }); };
    richMenu(r0.left, r0.bottom + 6, [{ hint: T.textColor }, row(""), { hint: T.highlight }, row("bg-")], 0, anchor);
  }
  function askEdit(sel) {
    var input = h("input", { type: "text", "class": "doc-askin", placeholder: T.editAsk, "aria-label": T.editAsk });
    var go = function () {
      var v = input.value.trim();
      if (!v) return;
      selBar.hidden = true;
      sel.ids.forEach(function (id) { var el = blockEl(id); if (el) el.classList.add("is-pending"); });
      toChat("edit", v, sel.ids, sel.text);
    };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } if (e.key === "Escape") selBar.hidden = true; });
    selBar.replaceChildren(input, kit.labelled(kit.button(T.send, "", go), T.send));
    input.focus();
  }
  var selTimer = null;
  document.addEventListener("selectionchange", function () {
    clearTimeout(selTimer);
    if (selBar.contains(document.activeElement)) return;
    selTimer = setTimeout(showSelBar, 200);
  });
  document.addEventListener("mousedown", function (e) {
    if (!selBar.contains(e.target)) selBar.hidden = true;
    if (slash.open && !slash.el.contains(e.target)) slash.close();
  });

  // ------------------------------------------------------------------ menus: "/" in the doc, "+" in the bar
  function menuAt(x, y, items) {
    hideTableUi(); hideGutter();
    var a = h("span", { style: "position:fixed;width:1px;height:1px;left:" + x + "px;top:" + (y - 4) + "px" });
    document.body.appendChild(a);
    kit.menu(a, items);
    var m = document.querySelector(".kit-menu"); if (m) { m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + "px"; m.style.maxHeight = "60vh"; m.style.overflow = "auto"; }
    setTimeout(function () { a.remove(); }, 0);
  }
  var TABLE_MD = "| | | |\n| --- | --- | --- |\n| | | |\n| | | |";
  function blockItems() {
    return [
      { k: "h1", ic: "h1", label: T.h1, md: "# " }, { k: "h2", ic: "h2", label: T.h2, md: "## " }, { k: "h3", ic: "h3", label: T.h3, md: "### " },
      { k: "table", ic: "table", label: T.table, md: TABLE_MD },
      { k: "dropdown", ic: "dropdown", label: T.dropdown, chip: function () {
        return ask(T.dropdownAsk, Object.keys(selects)[0] || (L === "hu" ? "Státusz" : "Status")).then(function (name) {
          if (!name) return null;
          name = name.replace(/[{}=]/g, "").trim();
          var chip = function () { return "{{select:" + name + "=" + (optionsOf(name)[0] || "") + "}}"; };
          if (optionsOf(name).length) return chip();
          return ask(T.optionsAsk, L === "hu" ? "Nincs elkezdve, Folyamatban, Kész" : "Not started, In progress, Done").then(function (o) {
            var list = (o || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
            if (list.length) { selects[name] = list; edit([{ op: "set_select", name: name, options: list }]); }
            return chip();
          });
        });
      } },
      { sep: true },
      { k: "bullets", ic: "bullets", label: T.bullets, md: "- " }, { k: "checklist", ic: "checklist", label: T.checklist, md: "- [ ] " },
      { k: "code", ic: "code", label: T.codeBlock, md: "```\n\n```" },
      { k: "date", ic: "date", label: T.date, chip: function () { return "{{date:" + new Date().toISOString().slice(0, 10) + "}}"; } },
      { k: "divider", ic: "divider", label: T.divider, md: "---" },
      { k: "image", ic: "image", label: T.image, image: true },
      { k: "numbers", ic: "numbers", label: T.numbers, md: "1. " }, { k: "quote", ic: "quote", label: T.quote, md: "> " },
      { sep: true },
      { k: "formula", ic: "formula", label: T.formula, md: "```latex\nE = mc^2\n```" },
      { k: "chart", ic: "chart", label: T.chart, md: "```chart\n" + JSON.stringify({ type: "bar", title: "", x: "label", y: "value", data: [{ label: "A", value: 3 }, { label: "B", value: 5 }, { label: "C", value: 4 }] }, null, 2) + "\n```" },
      { k: "mention", ic: "mention", label: T.mention, chip: function () { return ask(T.mentionAsk, "").then(function (n) { return n ? "{{@" + n.replace(/[{}]/g, "").trim() + "}}" : null; }); } },
      { k: "text", ic: "text", label: T.text, md: "" }
    ];
  }
  function itemByKey(k) { return blockItems().find(function (it) { return it.k === k; }); }
  // "@": ask Hermes, a person, a date (Claude's @ menu)
  function atItems() {
    var people = [];
    tabs.forEach(function (t) { t.blocks.forEach(function (b) { var re = /\{\{@([^{}\n]+)\}\}/g, m; while ((m = re.exec(b.md))) if (people.indexOf(m[1].trim()) < 0) people.push(m[1].trim()); }); });
    var day = function (n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    return [{ group: T.askGroup }, { k: "hermes", ic: "hermes", label: "Hermes", text: "@Hermes " }]
      .concat([{ group: T.people }]).concat(people.slice(0, 8).map(function (n) { return { k: n.toLowerCase(), ic: "person", label: n, chip: function () { return "{{@" + n + "}}"; } }; }))
      .concat([{ k: "mention", ic: "person", label: T.newMention, chip: function () { return ask(T.mentionAsk, "").then(function (n) { return n ? "{{@" + n.replace(/[{}]/g, "").trim() + "}}" : null; }); } }])
      .concat([{ group: T.dates }, { k: "date", ic: "date", label: T.date, chip: function () { return "{{date:" + day(0) + "}}"; } },
        { k: "today", ic: "date", label: T.today, chip: function () { return "{{date:" + day(0) + "}}"; } },
        { k: "tomorrow", ic: "date", label: T.tomorrow, chip: function () { return "{{date:" + day(1) + "}}"; } }]);
  }
  function applyItem(it, el, replace) {
    var id = el ? el.getAttribute("data-block") : (tab().blocks.length ? tab().blocks[tab().blocks.length - 1].id : null);
    if (it.image) return pickImage(id);
    if (it.text) { if (el) { el.focus(); document.execCommand("insertText", false, it.text); scheduleSave(el); } return; }
    if (it.chip) {
      var saved = E.caretRange() && E.caretRange().cloneRange();
      return Promise.resolve(it.chip()).then(function (c) { // a chip that asks first (a name, the options) comes later
      if (!c) return;
      var cur = id && blockEl(id), bb = id && blockOf(id);
      if (cur && bb && editable(bb) && !isCode(bb.md)) { // in the line, where the caret was
        cur.focus();
        if (saved && cur.contains(saved.startContainer)) { var s0 = window.getSelection(); s0.removeAllRanges(); s0.addRange(saved); }
        else E.placeCaret(lastLeaf(cur), true);
        // Put in with the Range API: insertHTML refuses an empty line (the "/date" just taken out of it).
        var tmp = h("span"); tmp.innerHTML = md.inline(md.parseInline(c), imgSrc, R);
        var at = E.caretRange(), gap = document.createTextNode("\u00a0"), frag = document.createDocumentFragment();
        while (tmp.firstChild) frag.appendChild(tmp.firstChild);
        at.deleteContents(); at.insertNode(gap); at.insertNode(frag);
        var after = document.createRange(); after.setStartAfter(gap); after.collapse(true);
        var s1 = window.getSelection(); s1.removeAllRanges(); s1.addRange(after);
        markEmpty(cur, true); scheduleSave(cur); return;
      }
      return insertBlock(id, c, "end");
      });
    }
    if (replace && el) {
      var b = blockOf(id); b.md = it.md; drawBlock(b, el);
      if (it.md === "---") { b.md = ""; return splitBlock(id, "---", id, "", "start"); } // one edit
      if (/^(```|\|)/.test(it.md)) writeBlock(id, it.md);
      if (/^\|/.test(it.md)) { var c1 = el.querySelector("td,th"); if (c1) { el.focus(); E.placeCaret(c1, true); } return; }
      if (/^```/.test(it.md) && !isWidget(it.md)) { var cd = el.querySelector("[contenteditable=plaintext-only]"); if (cd) { cd.focus(); E.placeCaret(cd, false); } return; }
      if (isWidget(it.md)) return /^```chart/.test(it.md) ? openData(el) : openSource(el);
      var q0 = el.querySelector("blockquote");
      if (q0 && !q0.firstChild) q0.innerHTML = "<p><br></p>";
      var leaf = firstLeaf(el); if (leaf !== el && !leaf.textContent) leaf.innerHTML = "<br>";
      focusBlock(id, true); scheduleSave(el);
      return;
    }
    // a new table starts in its first cell
    insertBlock(id, it.md, /^\|/.test(it.md) ? "start" : "end").then(function (nid) { if (nid && isWidget(it.md)) (/^```chart/.test(it.md) ? openData : openSource)(blockEl(nid)); });
  }
  var slash = { open: false, el: null, block: null, items: [], idx: 0,
    trigger: "/",
    bare: false, // opened by +: no "/" typed, the block's own words filter the list
    show: function (blockElm, trigger, bare) {
      this.block = blockElm; this.open = true; this.idx = 0; this.trigger = trigger || "/"; this.bare = !!bare;
      this.el = this.el || document.body.appendChild(h("div", { "class": "doc-slash doc-rmenu", role: "menu" }));
      this.el.hidden = false; this.update();
    },
    query: function () {
      var t = this.block ? this.block.textContent.replace(/\u200b/g, "").replace(/\u00a0/g, " ") : ""; // a typed space at the end of a line is a no-break space
      if (this.bare) return t.trim().toLowerCase();
      var i = t.lastIndexOf(this.trigger); return i < 0 ? null : t.slice(i + 1).toLowerCase();
    },
    update: function () {
      var q = this.query();
      if (q == null || q.length > 20 || /\s{2}/.test(q)) return this.close();
      var all = this.trigger === "@" ? atItems() : blockItems();
      var match = function (it) { return it.k && (!q || it.label.toLowerCase().indexOf(q) >= 0 || it.k.indexOf(q) >= 0); };
      this.items = all.filter(match);
      if (!this.items.length) return this.close();
      this.idx = Math.min(this.idx, this.items.length - 1);
      var me = this, nodes = [], n = 0, pendingHead = null, pendingSep = false;
      all.forEach(function (it) {
        if (it.group) { pendingHead = it.group; return; }
        if (it.sep) { pendingSep = !q; return; }
        if (!match(it)) return;
        if (pendingHead) { nodes.push(h("div", { "class": "doc-rm-hint", text: pendingHead })); pendingHead = null; }
        else if (pendingSep && nodes.length) nodes.push(h("div", { "class": "doc-rm-sep" }));
        pendingSep = false;
        var i = n++;
        nodes.push(h("button", { type: "button", "class": "doc-rm-item" + (i === me.idx ? " is-focus" : ""), html: micon(it.ic) + "<span>" + kit.esc(it.label) + "</span>",
          onmousedown: function (e) { e.preventDefault(); }, onclick: function () { me.pick(i); } }));
      });
      if (this.trigger === "/") nodes.push(h("div", { "class": "doc-rm-foot", text: T.slashHint }));
      this.el.replaceChildren.apply(this.el, nodes);
      var r = E.caretRange(), rc = r && r.getClientRects()[0] || this.block.getBoundingClientRect();
      this.el.style.left = Math.min(rc.left, innerWidth - 240) + "px";
      this.el.style.top = Math.min(rc.bottom + 6, innerHeight - this.el.offsetHeight - 8) + "px";
    },
    key: function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); this.idx = (this.idx + (e.key === "ArrowDown" ? 1 : this.items.length - 1)) % this.items.length; this.update(); return true; }
      if (e.key === "Enter") { e.preventDefault(); this.pick(this.idx); return true; }
      if (e.key === "Escape") { e.preventDefault(); this.close(); return true; }
      return false;
    },
    pick: function (i) {
      var it = this.items[i], el = this.block, bare = this.bare, trig = this.trigger;
      this.close();
      if (!it || !el) return;
      // take the "/query" out of the block
      var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), t, last = null;
      if (bare) { while ((t = w.nextNode())) t.nodeValue = ""; } // what was typed was only the filter
      else {
        while ((t = w.nextNode())) if (t.nodeValue.indexOf(trig) >= 0) last = t;
        if (last) last.nodeValue = last.nodeValue.slice(0, last.nodeValue.lastIndexOf(trig));
      }
      var empty = !el.textContent.trim() && !el.querySelector("[data-md],img");
      if (it.chip || it.text) { if (last) { var rr = document.createRange(); rr.setStart(last, last.nodeValue.length); rr.collapse(true); var s0 = window.getSelection(); s0.removeAllRanges(); s0.addRange(rr); } return applyItem(it, el, false); }
      if (empty) return applyItem(it, el, true);
      scheduleSave(el);
      applyItem(it, el, false);
    },
    close: function () { this.open = false; this.bare = false; if (this.el) this.el.hidden = true; }
  };

  // ------------------------------------------------------------------ pictures: insert, paste, drop
  function upload(file, afterId) {
    if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return;
    var rd = new FileReader();
    rd.onload = function () {
      setStatus(T.saving);
      hm.doc.upload(rd.result).then(function (r) {
        docFiles[r.name] = rd.result;
        insertBlock(afterId, "![" + (file.name || "").replace(/\.[^.]+$/, "").replace(/[\[\]]/g, "") + "](" + r.src + ")", null);
      }).catch(function (e) { setStatus(""); kit.toast(String(e && e.message || e)); });
    };
    rd.readAsDataURL(file);
  }
  function pickImage(afterId) {
    var inp = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", style: "display:none" });
    document.body.appendChild(inp);
    inp.addEventListener("change", function () { if (inp.files[0]) upload(inp.files[0], afterId); inp.remove(); });
    inp.click();
  }
  page.addEventListener("paste", function (e) {
    var el = e.target.closest && e.target.closest(".doc-blk[data-block]");
    if (!el || !live || el.hasAttribute("data-source")) return;
    if (el.querySelector("[contenteditable=plaintext-only]")) { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); return; }
    var files = Array.prototype.filter.call(e.clipboardData.files || [], function (f) { return /^image\//.test(f.type); });
    if (files.length) { e.preventDefault(); files.forEach(function (f) { upload(f, el.getAttribute("data-block")); }); return; }
    e.preventDefault();
    var htmlData = e.clipboardData.getData("text/html"), plain = e.clipboardData.getData("text/plain");
    var mdText;
    if (htmlData) { var tmp = h("div"); tmp.innerHTML = htmlData.replace(/<(script|style|meta|link)[\s\S]*?(<\/\1>|>)/gi, ""); mdText = E.toMd(tmp); }
    else mdText = plain;
    var parsed = md.parse(mdText);
    if (parsed.length <= 1 && (!parsed[0] || parsed[0].t === "p")) { // words: in place, formatted
      var span = h("span"); span.innerHTML = parsed[0] ? md.inline(parsed[0].c, imgSrc, R) : "";
      document.execCommand("insertHTML", false, span.innerHTML || kit.esc(plain));
      scheduleSave(el);
      return;
    }
    save(false); // its own words first (the outbox keeps the order), the pasted blocks after them, at once
    insertBlock(el.getAttribute("data-block"), mdText, null);
  });
  page.addEventListener("dragover", function (e) { if (live && e.dataTransfer && Array.prototype.some.call(e.dataTransfer.items || [], function (i) { return i.kind === "file"; })) e.preventDefault(); });
  page.addEventListener("drop", function (e) {
    if (!live || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    var el = e.target.closest && e.target.closest(".doc-blk[data-block]");
    Array.prototype.forEach.call(e.dataTransfer.files, function (f) { upload(f, el ? el.getAttribute("data-block") : null); });
  });
  view.addEventListener("click", function (e) { // a click below the last block: type at the end
    if (!live || e.target !== view && e.target !== page) return;
    var last = tab().blocks[tab().blocks.length - 1];
    if (last && editable(last) && !s(last.md)) return focusBlock(last.id, true);
    if (last) insertBlock(last.id, "", "start");
  });

  // ------------------------------------------------------------------ asking Hermes in the doc
  function toChat(kind, txt, blocks, selection, extra) {
    return hm.doc.ask(Object.assign({ kind: kind, tab: tab().id, tabTitle: tab().title, blocks: blocks, selection: selection || "", text: txt }, extra || {}))
      .then(function (r) { kit.toast(r && r.mode === "draft" ? T.drafted : T.sent); return r; })
      .catch(function (e) { kit.toast(String(e && e.message || e)); });
  }
  function askHere(id, request) {
    var b = blockOf(id);
    b.md = "@Hermes " + request;
    pendingAsks[id] = true;
    focused = null;
    edit([{ op: "replace", block: id, md: b.md }]);
    drawBlock(b, blockEl(id));
    toChat("ask", request, [id]);
  }

  // ------------------------------------------------------------------ the margin: comment cards and suggestion cards
  var margin = h("div", { "class": "doc-margin", "aria-label": T.comment });
  view.appendChild(margin);
  var pins = [];
  var timeFmt = new Intl.DateTimeFormat(L === "hu" ? "hu" : undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function drawMargin() {
    if (!live) return;
    var cards = [];
    suggestions.forEach(function (sg) {
      var anchor = sg.kind === "insert" ? page.querySelector('[data-sug="' + sg.id + '"]') : blockEl(sg.block);
      if (!anchor) return;
      cards.push({ el: anchor, node: h("div", { "class": "doc-card is-sug" }, [
        h("div", { "class": "doc-card-head" }, [
          h("span", { "class": "doc-card-who" + (sg.by === "hermes" ? " is-hermes" : ""), text: sg.by === "hermes" ? T.byH : T.byYou }),
          h("span", { "class": "doc-card-when", text: sg.at ? timeFmt.format(new Date(sg.at * 1000)) : "" }),
          h("button", { type: "button", "class": "doc-card-ok", "data-sid": sg.id, "data-decide": "accept", title: T.accept, "aria-label": T.accept, text: "✓", onclick: function () { decide(sg.id, "accept"); } }),
          h("button", { type: "button", "class": "doc-card-no", "data-sid": sg.id, "data-decide": "reject", title: T.reject, "aria-label": T.reject, text: "✕", onclick: function () { decide(sg.id, "reject"); } })]),
        h("div", { "class": "doc-card-text", text: sg.kind === "replace" ? T.sReplace : sg.kind === "insert" ? T.sInsert : T.sDelete })]) });
    });
    pins.forEach(function (p) {
      var anchor; try { anchor = page.querySelector(p.selector); } catch (_) {}
      if (!anchor) return;
      var node = h("div", { "class": "doc-card", tabindex: "0", role: "button" }, [
        h("div", { "class": "doc-card-head" }, [
          h("span", { "class": "doc-card-who" + (p.author === "hermes" ? " is-hermes" : ""), text: p.author === "hermes" ? T.byH : T.byYou }),
          h("span", { "class": "doc-card-when", text: p.at ? timeFmt.format(new Date((p.at > 1e12 ? p.at : p.at * 1000))) : "" })]),
        h("div", { "class": "doc-card-text", text: p.text }),
        p.replies ? h("div", { "class": "doc-card-rep", text: p.replies + " " + (p.replies === 1 ? T.reply1 : T.replies) }) : null]);
      node.addEventListener("click", function () { hm.openPin && hm.openPin(p.n); });
      if (p.quote) hiQuote(anchor, p.quote);
      cards.push({ el: anchor, node: node });
    });
    // Beside the page when there is room; else each card folds to a small mark that opens on a click.
    view.classList.remove("has-mini");
    var pr = page.getBoundingClientRect(), vr0 = view.getBoundingClientRect();
    var left = pr.right - vr0.left + 24, room = vr0.width - left - 12, mini = room < 170 && cards.length > 0;
    view.classList.toggle("has-mini", mini); // the page leaves a lane for the marks
    if (mini) pr = page.getBoundingClientRect();
    margin.style.left = (mini ? pr.right - vr0.left - 28 : left) + "px";
    margin.style.width = (mini ? 22 : Math.min(270, room)) + "px";
    cards.forEach(function (c) {
      c.node.classList.toggle("is-mini", mini);
      if (mini) c.node.addEventListener("click", function (e) {
        if (e.target.closest("button")) return;
        var was = c.node.classList.contains("is-open");
        margin.querySelectorAll(".doc-card.is-open").forEach(function (n) { n.classList.remove("is-open"); });
        c.node.classList.toggle("is-open", !was);
      }, true);
    });
    margin.replaceChildren.apply(margin, cards.map(function (c) { return c.node; }));
    var vr = view.getBoundingClientRect(), y0 = 0;
    cards.map(function (c) { return { c: c, y: c.el.getBoundingClientRect().top - vr.top + view.scrollTop }; })
      .sort(function (a, b) { return a.y - b.y; })
      .forEach(function (x) { var top = Math.max(x.y, y0); x.c.node.style.top = top + "px"; y0 = top + (mini ? 26 : x.c.node.offsetHeight + 8); });
  }
  function hiQuote(el, q) { // the commented words, lightly marked
    if (el.querySelector("mark.doc-cq") || !q) return;
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), t;
    while ((t = w.nextNode())) {
      var i = t.nodeValue.indexOf(q);
      if (i >= 0) { var r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + q.length); var m = document.createElement("mark"); m.className = "doc-cq"; m.setAttribute("data-ui", ""); try { r.surroundContents(m); } catch (_) {} return; }
    }
  }
  if (live && hm.on) hm.on("pins", function (items) { pins = items || []; drawMargin(); });
  var marginRaf = 0; // a resize fires many times a frame; the cards are laid out once
  window.addEventListener("resize", function () { if (!marginRaf) marginRaf = requestAnimationFrame(function () { marginRaf = 0; drawMargin(); }); });
  function decide(sid, verdict) {
    hm.doc.decide(sid, verdict).then(function () { return pull(true); }).catch(function (e) { kit.toast(String(e && e.message || e)); });
  }

  // ------------------------------------------------------------------ live: Hermes' changes appear here
  // The "Hermes is here" mark on the section it writes next follows kit.hermesWork (a run in flight that
  // changed the doc): it goes when that run ends, not minutes later.
  function hermesNow() {
    var on = kit.hermesWork.on();
    if (on === hermesActive) return;
    hermesActive = on;
    tab().blocks.forEach(function (b) { if (pendingOf(b.md) !== null && blockEl(b.id)) drawBlock(b, blockEl(b.id)); });
  }
  kit.hermesWork.change(hermesNow);
  var pulling = null;
  function pull(force) {
    if (!live) return Promise.resolve();
    if (pulling) return force ? pulling.then(function () { return pull(true); }) : pulling; // a forced read sees what is there now
    var t = tab();
    pulling = hm.doc.read(t.id, force ? null : t.rev).then(function (r) {
      if (typeof r.hermes_active === "boolean") { kit.hermesWork.seen(r.hermes_active, r.hermes_left, r.hermes_ago); hermesNow(); }
      if (!force && !(r.changed && r.changed.length) && !(r.removed && r.removed.length) && r.rev === t.rev && r.tabs.length === tabs.length) return;
      var byHermes = (r.changed || []).filter(function (c) { return c.by === "hermes"; }).map(function (c) { return c.id; });
      return (force && r.blocks ? Promise.resolve(r) : hm.doc.read(t.id, null)).then(function (full) { merge(full, byHermes); });
    }).catch(function () {}).then(function () { pulling = null; });
    return pulling;
  }
  function merge(full, flash) {
    var byId = {};
    tabs.forEach(function (t) { byId[t.id] = t; });
    var seen = byId[full.tab];
    if (seen && staleRead(full.rev, seen.rev, seen.acked)) return; // sent before a save landed, come after it: old text
    var curId = tab().id;
    tabs = full.tabs.map(function (o) { var t = byId[o.id] || { id: o.id, blocks: [], rev: 0 }; t.title = o.title; return t; });
    cur = Math.max(0, tabs.findIndex(function (t) { return t.id === curId; }));
    var t = tabs[cur];
    if (typeof full.edits === "number") edits = full.edits;
    selects = full.selects || {}; settings = full.settings || {}; suggestions = full.suggestions || [];
    if (t.id !== full.tab) return;
    // An edit the server applied whose answer never came (an error after it, a lost connection): the read
    // says so (done: cid -> its blocks), so it is settled here and never sent, nor shown, twice.
    var done = full.done || {}, settled = false;
    while (outbox.length && !outbox[0].flying && Object.prototype.hasOwnProperty.call(done, outbox[0].cid)) {
      var e0 = outbox.shift(), r0 = { ok: true, rev: full.rev, per_op: done[e0.cid], repeat: true };
      clearTimeout(retryTimer); retryTimer = null; retryMs = 0; settled = true;
      took(e0, r0); e0.done(r0);
    }
    // The block being typed in keeps the person's words (theirs win until they pause), Hermes' change to it
    // included: the save then meets it as a conflict and keeps their words as a suggestion (see conflicted).
    // Every edit still in the outbox is played over the server's blocks (replayOps): a failed or slow save,
    // a split, a new or moved block, a paste, is never taken back by a read.
    var keepMd = {};
    var f = focused, fel = f && blockEl(f.id), mine = fel ? f.id : null, act = null, local = null;
    if (mine) {
      var srv = full.blocks.find(function (b) { return b.id === mine; });
      local = (blockOf(mine) || {}).md;
      if (f.sug && srv) f.theirs = srv.md;
      act = onRead(!!srv, !!srv && srv.md === local, dirty(f, fel));
      if (act === "keep" || act === "readd") keepMd[mine] = local;
    }
    var was = t.blocks;
    t.srv = full.blocks.map(function (b) { return b.id; }); // what the server has: an edit it refuses is made to fit it (mend)
    var m = mergeBlocks(replayOps(full.blocks, outbox, realIds), was, keepMd);
    t.blocks = m.blocks;
    m.back.forEach(function (x) { if (x.id === mine) f.sug = false; }); // gone there: its words go back in as a new block
    if (act === "drop") { clearTimeout(f.timer); focused = null; }
    t.rev = full.rev;
    flash.forEach(function (id) { delete pendingAsks[id]; });
    patch(act === "redraw");
    if (settled) { setStatus(outbox.length ? T.saving : T.saved); pump(); }
    flash.forEach(function (id) {
      if (id === mine && act !== "redraw") return; // still the person's words there
      var el = blockEl(id);
      if (!el) return;
      el.classList.add("by-hermes"); el.title = T.byHermes;
      setTimeout(function () { el.classList.remove("by-hermes"); el.removeAttribute("title"); }, 2400);
    });
  }
  if (live) {
    hm.on("doc", function () { pull(false); });
    setInterval(function () { if (!document.hidden && !(focused && sending)) pull(false); }, 2500);
  }

  // ------------------------------------------------------------------ view context (with the next chat message)
  function sendView() {
    kit.view(function () {
      var head = kit.inView("#doc-page h1, #doc-page h2, #doc-page h3");
      var sel = "", blocks = [], s0 = selectedBlocks();
      if (s0) { sel = s0.text; blocks = s0.ids; } else if (focused) blocks = [focused.id];
      return { mode: focused ? "edit" : "read", suggesting: mode === "suggest" || undefined, tab: { id: tab().id, title: tab().title, rev: tab().rev },
        section: head ? head.textContent.trim().slice(0, 80) : null,
        selected: sel ? [sel.trim().slice(0, 300)] : [], blocks: blocks.slice(0, 20),
        asking: Object.keys(pendingAsks), version: C.version, edits: edits, dirty: !!(outbox.length || focused && focused.timer) };
    });
  }
  window.addEventListener("scroll", sendView, { passive: true });
  document.addEventListener("selectionchange", sendView);

  // ------------------------------------------------------------------ chrome (Claude's doc bar)
  function barBtn(label, html, fn, cls) {
    var b = h("button", { type: "button", "class": "kit-btn doc-tool" + (cls ? " " + cls : ""), title: label, "aria-label": label, html: html });
    b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // the caret stays where it is
    b.addEventListener("click", fn);
    return b;
  }
  var CARET = '<svg class="doc-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg>';
  var tabBtn = barBtn(T.tabs, "", function () { tabMenu(); }, "doc-tabbtn");
  function drawTabs() {
    tabBtn.innerHTML = "<span>" + kit.esc(tab().title || T.untitled) + "</span>" + CARET;
  }
  function tabMenu() {
    var items = tabs.map(function (t, i) {
      return { label: (i === cur ? "✓ " : "   ") + (t.title || T.untitled), onClick: function () { if (i !== cur) { commit(); cur = i; focused = null; render(); pull(true); sendView(); } } };
    });
    if (live) items = items.concat([
      { label: "+ " + T.newTab, onClick: function () {
        ask(T.tabName, T.newTab).then(function (name) {
          if (!name) return;
          edit([{ op: "add_tab", title: name, md: "" }]).then(function (r) { pull(true).then(function () {
            var i = tabs.findIndex(function (t) { return t.id === r.new_tab; });
            if (i >= 0) { cur = i; render(); pull(true); }
          }); });
        });
      } },
      { label: T.rename, onClick: function () {
        ask(T.tabName, tab().title).then(function (name) {
          if (!name || name === tab().title) return;
          edit([{ op: "rename_tab", title: name }]).then(function () { tab().title = name; drawTabs(); });
        });
      } }].concat(tabs.length > 1 ? [{ label: T.delTab, onClick: function () {
        var full = tab().blocks.some(function (b) { return s(b.md); }); // an empty tab goes without asking
        (full ? ask(T.delTabAsk, undefined, T.delTab) : Promise.resolve(true)).then(function (yes) {
          if (yes) edit([{ op: "delete_tab" }]).then(function () { cur = 0; pull(true); });
        });
      } }] : []));
    kit.menu(tabBtn, items);
  }
  function setSettings(patch) {
    for (var k in patch) settings[k] = patch[k];
    applySettings(); drawMargin();
    if (live) edit([{ op: "settings", set: patch }]);
  }
  var fontBtn = barBtn(T.fonts, '<span class="doc-tt">T<small>T</small></span>', function () {
    kit.menu(fontBtn, [{ hint: T.headings },
      { label: (settings.head === "serif" ? "✓ " : "   ") + T.serif, onClick: function () { setSettings({ head: "serif" }); } },
      { label: (settings.head !== "serif" ? "✓ " : "   ") + T.sans, onClick: function () { setSettings({ head: "sans" }); } },
      { hint: T.textFont },
      { label: (settings.body === "serif" ? "✓ " : "   ") + T.serif, onClick: function () { setSettings({ body: "serif" }); } },
      { label: (settings.body !== "serif" ? "✓ " : "   ") + T.sans, onClick: function () { setSettings({ body: "sans" }); } }]);
  });
  var widthBtn = barBtn(T.width, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>', function () { setSettings({ wide: !settings.wide }); });
  function insertHere(it) { var el = focused && blockEl(focused.id); applyItem(it, el, !!(el && el.textContent.trim() === "" && !it.chip && !it.image)); }
  var tableBtn = barBtn(T.table, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 10h16M4 14.5h16M10 5v14"/></svg>', function () { insertHere({ md: TABLE_MD }); });
  var imageBtn = barBtn(T.image, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 16l5-5 4 4 3-3 4 4"/><circle cx="15" cy="9" r="1"/></svg>', function () { insertHere({ image: true }); });
  var checkBtn = barBtn(T.checklist, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l2 2 3-3M4 15l2 2 3-3M12 8h8M12 16h8"/></svg>', function () { insertHere({ md: "- [ ] " }); });
  var plusBtn = barBtn(T.insert, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' + CARET, function () {
    var r = plusBtn.getBoundingClientRect();
    richMenu(r.left, r.bottom + 6, blockItems().filter(function (it) { return it.k !== "text"; }).map(function (it) { return it.sep ? it : { icon: it.ic, label: it.label, onClick: function () { insertHere(it); } }; })
      .concat([{ sep: true }, { hint: T.slashHint }]), 0, plusBtn);
  }, "doc-plus");
  var PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg>';
  var modeBtn = barBtn(T.editing, "", function () {
    kit.menu(modeBtn, [
      { label: (mode === "edit" ? "✓ " : "   ") + T.editing + " — " + T.editingHint, onClick: function () { setMode("edit"); } },
      { label: (mode === "suggest" ? "✓ " : "   ") + T.suggesting + " — " + T.suggestingHint, onClick: function () { setMode("suggest"); } }]);
  }, "doc-mode");
  function setMode(m) {
    commit();
    mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    modeBtn.innerHTML = PEN + "<span>" + kit.esc(m === "suggest" ? T.suggesting : T.editing) + "</span>" + CARET;
    document.documentElement.classList.toggle("doc-suggesting", m === "suggest");
    sendView();
  }

  // ------------------------------------------------------------------ export helpers
  var libs = {};
  function lib(name, global) {
    if (window[global]) return Promise.resolve(window[global]);
    if (!window.hermes || !window.hermes.vendor) return Promise.reject(new Error(T.noLib));
    return (libs[name] = libs[name] || window.hermes.vendor(name).then(function (s) {
      (0, eval)(s + "\n//# sourceURL=vendor/" + name);
      if (!window[global]) throw new Error(T.noLib);
      return window[global];
    }));
  }
  function busy(on) {
    var b = document.querySelector(".doc-busy");
    if (on && !b) document.body.appendChild(h("div", { "class": "kit-empty doc-busy", style: "position:fixed;inset:0;z-index:200;min-height:0;background:color-mix(in srgb,var(--color-bg) 70%,transparent)", text: T.building }));
    if (!on && b) b.remove();
  }
  function css() {
    return Array.prototype.map.call(document.styleSheets, function (ss) {
      try { return Array.prototype.map.call(ss.cssRules, function (r) { return r.cssText; }).join("\n"); } catch (e) { return ""; }
    }).join("\n");
  }

  function exportHtml() {
    var doc = '<!doctype html><html lang="' + L + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: https:; style-src 'unsafe-inline'\">" +
      "<title>" + kit.esc(title()) + "</title><style>" + css() + "body{padding:40px 24px}</style></head><body><article class=\"doc-prose\">" +
      cleanHtml() + "</article></body></html>";
    kit.download(kit.slug(title()) + ".html", doc, "text/html");
  }

  // --- Word: a minimal WordprocessingML package, zipped with fflate ---------------------------
  function xesc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""); }

  function docxParts(tree, pics) {
    var rels = [], media = {}, imgN = 0;
    function rel(type, target, ext) {
      var id = "rId" + (rels.length + 10);
      rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + type + '" Target="' + xesc(target) + '"' + (ext ? ' TargetMode="External"' : "") + "/>");
      return id;
    }
    var WCOL = { gray: "787774", red: "C4362B", orange: "C76A1C", yellow: "A68A0A", green: "2F8A3E", blue: "2F6FC7", purple: "7A4FC2" };
    function runs(nodes, fmt) {
      fmt = fmt || {};
      return nodes.map(function (n) {
        var f = Object.assign({}, fmt);
        if (n.t === "strong") { f.b = true; return runs(n.c, f); }
        if (n.t === "em") { f.i = true; return runs(n.c, f); }
        if (n.t === "del") { f.s = true; return runs(n.c, f); }
        if (n.t === "br") return "<w:r><w:br/></w:r>";
        if (n.t === "link") {
          if (!/^(https?:|mailto:)/i.test(n.href)) return runs(n.c, f);
          return '<w:hyperlink r:id="' + rel("hyperlink", n.href, true) + '">' + runs(n.c, Object.assign(f, { link: true })) + "</w:hyperlink>";
        }
        if (n.t === "img") return image(n) || run("[" + (n.alt || "image") + "]", f);
        if (n.t === "code") { f.code = true; return run(n.v, f); }
        if (n.t === "chip") return run(md.chipText(n, fmtDate), f);
        if (n.t === "mark") { f.hl = "yellow"; return runs(n.c, f); }
        if (n.t === "span") {
          n.cls.forEach(function (c) {
            if (c === "underline") f.u = true;
            else if (/^bg-/.test(c)) f.hl = { gray: "lightGray", red: "red", orange: "yellow", yellow: "yellow", green: "green", blue: "cyan", purple: "magenta" }[c.slice(3)];
            else if (WCOL[c]) f.color = WCOL[c];
          });
          return runs(n.c, f);
        }
        return run(n.v, f);
      }).join("");
    }
    function run(t, f) {
      // CT_RPr element order: rStyle, rFonts, b, i, strike, shd.
      var p = (f.link ? '<w:rStyle w:val="Hyperlink"/>' : "") +
        (f.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : "") +
        (f.b ? "<w:b/>" : "") + (f.i ? "<w:i/>" : "") + (f.s ? "<w:strike/>" : "") +
        (f.color ? '<w:color w:val="' + f.color + '"/>' : "") + (f.hl ? '<w:highlight w:val="' + f.hl + '"/>' : "") + (f.u ? '<w:u w:val="single"/>' : "") +
        (f.code ? '<w:shd w:val="clear" w:color="auto" w:fill="F1EFE8"/>' : "");
      return "<w:r>" + (p ? "<w:rPr>" + p + "</w:rPr>" : "") + '<w:t xml:space="preserve">' + xesc(t) + "</w:t></w:r>";
    }
    function image(n) {
      var data = imgSrc(n.src), m = /^data:image\/(png|jpe?g|gif);base64,(.*)$/i.exec(data || "");
      if (!m) return null;
      var el = Array.prototype.find.call(page.querySelectorAll("img"), function (i) { return i.getAttribute("alt") === n.alt; });
      return picRun(Uint8Array.from(atob(m[2]), function (c) { return c.charCodeAt(0); }), m[1].toLowerCase() === "jpg" ? "jpeg" : m[1].toLowerCase(),
        el && el.naturalWidth || 600, el && el.naturalHeight || 400, n.alt);
    }
    function picRun(bytes, ext, w, hh, alt) {
      var max = 600;
      if (w > max) { hh = hh * max / w; w = max; }
      var name = "image" + (++imgN) + "." + ext;
      media["word/media/" + name] = bytes;
      var id = rel("image", "media/" + name), cx = Math.round(w * 9525), cy = Math.round(hh * 9525);
      return '<w:r><w:drawing><wp:inline><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + imgN + '" name="' + name + '" descr="' + xesc(alt || "") + '"/>' +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + imgN + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
        "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";
    }
    function para(inner, pPr) { return "<w:p>" + (pPr ? "<w:pPr>" + pPr + "</w:pPr>" : "") + inner + "</w:p>"; }
    function blocks(list, depth, quote) {
      return list.map(function (b) {
        // CT_PPr order: pStyle, keepNext, numPr, pBdr, shd, spacing, ind, jc.
        var qb = quote ? '<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="BBBBBB"/></w:pBdr>' : "";
        var qi = quote ? '<w:ind w:left="567"/>' : "";
        var q = qb + qi;
        switch (b.t) {
          case "h": return para(runs(b.c), '<w:pStyle w:val="Heading' + Math.min(b.level, 4) + '"/>');
          case "p": return para(runs(b.c), quote ? '<w:pStyle w:val="Quote"/>' + q : "");
          case "hr": return para("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr>');
          case "code":
            var made = WG.kinds[String(b.lang || "").toLowerCase()] ? widget(String(b.lang).toLowerCase(), b) : null;
            if (made) return made;
            return b.v.split("\n").map(function (l) { return para(run(l || " ", { code: true }), '<w:pStyle w:val="Code"/>'); }).join("") + para("");
          case "quote": return blocks(b.c, depth, true);
          case "list":
            return b.items.map(function (it) {
              var head = it.c[0] && it.c[0].t === "p" ? it.c[0] : null;
              // A task is a line with Word's own check box (it can be ticked there), not a bullet with a box drawn after it.
              var p0 = it.task
                ? para(checkBox(it.checked) + "<w:r><w:tab/></w:r>" + (head ? runs(head.c) : ""),
                  '<w:pStyle w:val="ListParagraph"/>' + qb + '<w:ind w:left="' + (720 + 360 * Math.min(depth, 8)) + '" w:hanging="360"/>')
                : para(head ? runs(head.c) : "",
                  '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="' + Math.min(depth, 8) + '"/><w:numId w:val="' + (b.ordered ? 2 : 1) + '"/></w:numPr>' + qb);
              return p0 + blocks(head ? it.c.slice(1) : it.c, depth + 1, quote);
            }).join("");
          case "table": return table(b);
        }
        return "";
      }).join("");
    }
    function table(b) {
      // The doc's column widths (narrow … extra) become the columns' share of the page.
      var share = b.head.map(function (_, k) { return { narrow: 1, medium: 2.5, wide: 4, extra: 6 }[b.widths && b.widths[k]] || 2; });
      var sum = share.reduce(function (x, y) { return x + y; }, 0), wide = share.map(function (x) { return Math.round(9298 * x / sum); });
      var cell = function (c, k, hd) {
        var a = b.align[k] ? '<w:jc w:val="' + (b.align[k] === "right" ? "right" : b.align[k] === "center" ? "center" : "left") + '"/>' : "";
        return '<w:tc><w:tcPr><w:tcW w:w="' + wide[k] + '" w:type="dxa"/>' + (hd ? '<w:shd w:val="clear" w:color="auto" w:fill="F1EFE8"/>' : "") + "</w:tcPr>" + para(runs(c, hd ? { b: true } : {}), a) + "</w:tc>";
      };
      return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>' +
        '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideH w:val="single" w:sz="4" w:color="CCCCCC"/></w:tblBorders>' +
        '<w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>' +
        "<w:tblGrid>" + wide.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join("") + "</w:tblGrid>" +
        // The first row is the table's heading row: it repeats on each page and is read out as the header.
        "<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>" + b.head.map(function (c, k) { return cell(c, k, true); }).join("") + "</w:tr>" +
        b.rows.map(function (r) { return "<w:tr>" + b.head.map(function (_, k) { return cell(r[k] || [], k, false); }).join("") + "</w:tr>"; }).join("") +
        "</w:tbl>" + para("");
    }
    function checkBox(on) {
      return '<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="' + (on ? 1 : 0) + '"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>' +
        '<w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/></w:rPr><w:t>' + (on ? "\u2612" : "\u2610") + "</w:t></w:r></w:sdtContent></w:sdt>";
    }
    // A widget as Word has it: rows are a table; a chart, a drawing and a formula are pictures (their source is the picture's description).
    function widget(lang, b) {
      if (lang === "csv") {
        var rows = WG.csvRows(b.v);
        if (!rows.length) return null;
        var txt = function (v) { return v ? [{ t: "text", v: v }] : []; }, rest = rows.slice(1);
        var isNum = function (v) { return /^-?[\d\s.,]+%?$/.test(String(v || "").trim()); };
        return table({ head: rows[0].map(txt), rows: rest.map(function (r) { return rows[0].map(function (_, k) { return txt(r[k] || ""); }); }),
          align: rows[0].map(function (_, k) { return rest.length && rest.every(function (r) { return !r[k] || isNum(r[k]); }) ? "right" : null; }) });
      }
      var pic = pics && pics.get(b);
      if (!pic) return null;
      return para(picRun(pic.bytes, "png", pic.w, pic.h, pic.alt), '<w:jc w:val="center"/>') +
        (pic.caption ? para(run(pic.caption, {}), '<w:pStyle w:val="Caption"/>') : "");
    }
    var body = blocks(tree, 0, false);
    var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
      'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"';
    var bodyFont = settings.body === "serif" ? "Georgia" : "Calibri", headFont = settings.head === "serif" ? "Georgia" : bodyFont; // the doc's own choice of fonts
    var lvls = function (ordered) {
      var out = "";
      for (var k = 0; k < 9; k++) out += '<w:lvl w:ilvl="' + k + '"><w:start w:val="1"/><w:numFmt w:val="' + (ordered ? (k % 3 === 0 ? "decimal" : k % 3 === 1 ? "lowerLetter" : "lowerRoman") : "bullet") +
        '"/><w:lvlText w:val="' + (ordered ? "%" + (k + 1) + "." : ["•", "◦", "▪"][k % 3]) + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 + 360 * k) + '" w:hanging="360"/></w:pPr></w:lvl>';
      return out;
    };
    var hstyle = function (n, size) {
      return '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
        '<w:pPr><w:keepNext/><w:spacing w:before="' + (n === 1 ? 0 : 320) + '" w:after="120"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr>' +
        '<w:rPr><w:rFonts w:ascii="' + headFont + '" w:hAnsi="' + headFont + '"/><w:b/><w:sz w:val="' + size + '"/></w:rPr></w:style>';
    };
    return {
      "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      "docProps/core.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        "<dc:title>" + xesc(title()) + '</dc:title><dc:creator>Hermes</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().slice(0, 19) + "Z</dcterms:created></cp:coreProperties>",
      "word/_rels/document.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' + rels.join("") + "</Relationships>",
      "word/styles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + NS + '>' +
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + bodyFont + '" w:hAnsi="' + bodyFont + '" w:eastAsia="' + bodyFont + '" w:cs="' + bodyFont + '"/><w:sz w:val="22"/>' +
        '<w:lang w:val="' + (L === "hu" ? "hu-HU" : "en-US") + '"/></w:rPr></w:rPrDefault>' + // the language Word checks the spelling in
        '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
        hstyle(1, 44) + hstyle(2, 32) + hstyle(3, 26) + hstyle(4, 23) +
        '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1EFE8"/><w:spacing w:after="0"/></w:pPr>' +
        '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:noProof/><w:sz w:val="20"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr></w:style>' +
        '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="C96442"/><w:u w:val="single"/></w:rPr></w:style>' +
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>',
      "word/numbering.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ' + NS + '>' +
        '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + lvls(false) + "</w:abstractNum>" +
        '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + lvls(true) + "</w:abstractNum>" +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
      "word/document.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + "><w:body>" + body +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>',
      _media: media
    };
  }

  async function exportDocx() {
    busy(true);
    try {
      var fflate = await lib("fflate.umd.js", "fflate");
      var tree = md.parse(fullText());
      var parts = docxParts(tree, await widgetPics(tree)), files = {}, enc = new TextEncoder();
      Object.keys(parts).forEach(function (k) { if (k !== "_media") files[k] = enc.encode(parts[k]); });
      Object.keys(parts._media).forEach(function (k) { files[k] = [parts._media[k], { level: 0 }]; });
      var zip = fflate.zipSync(files, { level: 6 });
      kit.download(kit.slug(title()) + ".docx", new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }

  // --- PDF: A4 pages laid out from whole blocks, each page pictured (SVG foreignObject) ----------
  function pages() {
    var PH = 1123 - 152, holder = h("div", { style: "position:fixed;left:-30000px;top:0" });
    var probe = h("article", { "class": "doc-prose doc-pdfpage", style: "height:auto" });
    probe.innerHTML = cleanHtml();
    holder.appendChild(probe); document.body.appendChild(holder);
    var out = [], curr = [], used = 0;
    Array.prototype.slice.call(probe.children).forEach(function (el) {
      var cs = getComputedStyle(el);
      var hgt = el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
      var keepNext = /^H[1-6]$/.test(el.tagName);
      if (used + hgt > PH && curr.length) { out.push(curr); curr = []; used = 0; }
      curr.push(el.outerHTML); used += hgt;
      if (keepNext && used > PH * 0.85) { curr.pop(); out.push(curr); curr = [el.outerHTML]; used = hgt; }
    });
    if (curr.length) out.push(curr);
    holder.remove();
    return out;
  }
  /** A piece of the doc pictured on white paper (SVG foreignObject), twice as sharp as it is wide. */
  function shoot(el, sheet, w, hh) {
    return new Promise(function (resolve, reject) {
      el.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      var xhtml = new XMLSerializer().serializeToString(el);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + hh + '"><foreignObject width="100%" height="100%">' +
        '<style xmlns="http://www.w3.org/1999/xhtml"><![CDATA[' + sheet + ']]></style>' + xhtml + "</foreignObject></svg>";
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas"); c.width = w * 2; c.height = hh * 2;
        var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c);
      };
      img.onerror = function () { reject(new Error("page picture failed")); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }
  function picture(htmlStr, sheet) {
    var wrap = h("article", { "class": "doc-prose doc-pdfpage" });
    wrap.innerHTML = htmlStr;
    return shoot(wrap, sheet, 794, 1123);
  }
  /** Light colors on paper whatever the viewer's theme; the accent stays the theme's. */
  function paperSheet() {
    return css().replace(/]]>/g, "") + ".doc-pdfpage{--color-fg:#1f1e1d;--color-fg-secondary:#3d3c39;--color-fg-muted:#6f6d66;--color-border-line:#e7e5dd;--color-border-strong:#cfccc0;--color-hover:rgba(0,0,0,.05);--color-accent:" + ((kit.hostTheme() || {}).accent || "#c96442") + "}";
  }
  /** Word has no chart, drawing or formula of ours: each goes in as a picture. Map of the tree's code block -> {bytes, w, h, alt, caption}. */
  async function widgetPics(tree) {
    var found = [], out = new Map();
    (function walk(list) {
      list.forEach(function (b) {
        if (b.t === "code" && /^(chart|svg|latex|math|tex)$/i.test(b.lang || "")) found.push(b);
        else if (b.t === "quote") walk(b.c);
        else if (b.t === "list") b.items.forEach(function (it) { walk(it.c); });
      });
    })(tree);
    if (!found.length) return out;
    var isMath = function (b) { return !/^(chart|svg)$/i.test(b.lang); };
    if (found.some(isMath) && !WG.ready() && live && hm.vendor) { // the formula drawer loads on first use
      await new Promise(function (res) { WG.html("latex", "x", { vendor: hm.vendor, redraw: res, bare: true }); setTimeout(res, 5000); });
    }
    var sheet = paperSheet();
    for (var i = 0; i < found.length; i++) {
      var b = found[i], math = isMath(b);
      try {
        if (math && !WG.ready()) continue;
        var box = h("article", { "class": "doc-prose doc-pdfpage", style: "display:inline-block;height:auto;overflow:visible;width:" + (math ? "auto" : "640px") + ";padding:" + (math ? "4px 10px" : "0") });
        box.innerHTML = WG.html(b.lang, b.v, { bare: true }) || "";
        if (!box.firstChild || box.querySelector(".w-error, .w-wait")) continue;
        var cap = box.querySelector("figcaption"), caption = cap ? cap.textContent.trim() : "";
        if (cap) cap.remove();
        var holder = h("div", { style: "position:fixed;left:-30000px;top:0" }, [box]);
        document.body.appendChild(holder);
        var r = box.getBoundingClientRect(), w = Math.ceil(r.width), hh = Math.ceil(r.height);
        holder.remove();
        if (!w || !hh) continue;
        var c = await shoot(box, sheet, w, hh), title = "";
        if (/^chart$/i.test(b.lang)) { try { title = JSON.parse(b.v).title || ""; } catch (e) {} }
        out.set(b, { bytes: Uint8Array.from(atob(c.toDataURL("image/png").split(",")[1]), function (ch) { return ch.charCodeAt(0); }), w: w, h: hh,
          alt: math ? b.v.trim() : title || (T.wLabels[String(b.lang).toLowerCase()] || ""), caption: caption });
      } catch (e) { /* the block then goes in as its source text */ }
    }
    return out;
  }
  async function exportPdf() {
    busy(true);
    try {
      var PDFLib = await lib("pdf-lib.min.js", "PDFLib");
      var pdf = await PDFLib.PDFDocument.create();
      pdf.setTitle(title()); pdf.setCreator("Hermes Artifacts");
      var sheet = paperSheet();
      var list = pages();
      for (var i = 0; i < list.length; i++) {
        var c = await picture(list[i].join(""), sheet);
        var jpg = await pdf.embedJpg(c.toDataURL("image/jpeg", 0.9));
        var p = pdf.addPage([595.28, 841.89]);
        p.drawImage(jpg, { x: 0, y: 0, width: 595.28, height: 841.89 });
      }
      var bytes = await pdf.save();
      kit.download(kit.slug(title()) + ".pdf", new Blob([bytes], { type: "application/pdf" }), "application/pdf");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }

  // ------------------------------------------------------------------ export menu, history, the bar
  var titleEl = h("span", { "class": "kit-title", style: "display:none" }); // the host toolbar shows the title
  var exportList = [{ id: "docx", label: T.docx, run: exportDocx }, { id: "pdf", label: T.pdf, run: exportPdf },
    { id: "md", label: T.mdf, run: function () { kit.download(kit.slug(title()) + ".md", fullText(), "text/markdown"); } },
    { id: "html", label: T.html, run: exportHtml }];
  if (live) exportList.push(
    { id: "to-slides", label: T.toSlides, run: function () { toChat("convert", "", [], "", { target: "slides" }); } },
    { id: "to-design", label: T.toDesign, run: function () { toChat("convert", "", [], "", { target: "design" }); } });
  var expBtn = kit.labelled(kit.button(T.exp, "download", function () {
    kit.menu(expBtn, exportList.map(function (x) { return { label: x.label, onClick: x.run }; }));
  }), T.exp);
  kit.exports(exportList); // the host's title menu lists them too; the bar keeps its own button
  // History (Claude's): the tab's earlier states; picking one and confirming brings it back as a new edit.
  var histBtn = kit.labelled(kit.button(T.hist, "history", function () {
    commit();
    var t = tab();
    hm.doc.history(t.id).then(function (r) {
      var fmt = new Intl.DateTimeFormat(L === "hu" ? "hu" : undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      var list = (r.snaps || []).filter(function (x) { return x.rev < r.rev; });
      if (!list.length) return kit.menu(histBtn, [{ label: T.histNone, onClick: function () {} }]);
      kit.menu(histBtn, list.slice(0, 30).map(function (x) {
        var who = x.by === "hermes" ? T.byH : x.by === "restore" ? T.byRestore : x.by === "start" ? "" : T.byYou;
        return { label: fmt.format(new Date(x.at * 1000)) + (who ? " · " + who : ""), onClick: function () {
          kit.menu(histBtn, [{ label: T.restoreThis, onClick: function () {
            hm.doc.restore(t.id, x.rev).then(function () { kit.toast(T.restored); return pull(true); })
              .catch(function (e) { kit.toast(String(e && e.message || e)); });
          } }, { label: T.cancel, onClick: function () {} }]);
        } };
      }));
    }).catch(function (e) { kit.toast(String(e && e.message || e)); });
  }), T.hist);
  histBtn.hidden = !live;
  var sep = function () { return h("span", { "class": "doc-sep" }); };
  var tools = live ? [tabBtn, fontBtn, widthBtn, sep(), tableBtn, imageBtn, checkBtn, plusBtn] : [tabBtn, fontBtn, widthBtn];
  bar.append.apply(bar, [titleEl].concat(tools).concat([h("span", { "class": "doc-gap" }), status, histBtn, expBtn]).concat(live ? [modeBtn] : []));
  setMode(mode);

  // The first render, then ready for the host, once: also when the render throws (the bridge then says threw;
  // an error before this point gets the bridge's own fallback, 1 s after it). An empty doc renders like any other.
  try {
    render();
    titleEl.textContent = title();
    if (live) pull(true);
  } finally {
    kit.ready();
  }
})();
