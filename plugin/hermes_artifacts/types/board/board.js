/* hermes-artifacts Board runtime: a whiteboard the user and Hermes edit together.
 *
 * The board lives on the Hermes server (boards.py) as a list of items, back to front. All geometry
 * (shapes, text measure, arrow routes, hit tests, snapping) is geo.js (window.boardGeo); this file
 * draws the items, takes the pointer and the keyboard, and talks to the server: every edit is applied
 * here at once and sent as ops through hermes.board.edit, undo sends the inverse ops, and what
 * Hermes changes arrives through the `board` event and glows for a moment.
 *
 * Drawing: one absolutely positioned element per item inside a world layer that pan and zoom
 * transform; z-order is the item's index (sections stay behind). Elements are built when an item
 * first comes into view and hidden when it leaves, so 800 items stay smooth.
 */
(function () {
  "use strict";
  // The UI's words in the app's language (hu over en, key by key).
  function pickLang(t, l) { var o = {}, k; for (k in t.en) o[k] = t.en[k]; for (k in t[l] || {}) o[k] = t[l][k]; return o; }
  var kit = window.kit, h = kit.h, C = kit.content, hm = window.hermes, G = window.boardGeo;
  var L = /^hu\b/i.test(C.lang || navigator.language || "") ? "hu" : "en";

  // ------------------------------------------------------------------ strings
  var T = pickLang({
    en: {
      board: "Whiteboard", noGeo: "The board could not load its geometry module.",
      select: "Select", hand: "Hand", text: "Text", section: "Section", sticky: "Sticky note", draw: "Draw", shapes: "Shapes",
      image: "Image", ask: "Ask Hermes", askPh: "Describe a change", send: "Send", sent: "Sent to Hermes", drafted: "Put in the chat box",
      pen: "Pen", arrow: "Arrow", table: "Table", colour: "Colour",
      zoomIn: "Zoom in", zoomOut: "Zoom out", zoom: "Zoom level", fit: "Fit the board", undo: "Undo", redo: "Redo", keys: "Single-key tool shortcuts",
      hist: "Version history", histNone: "No earlier versions yet", byH: "Hermes", byYou: "you", byRestore: "restored",
      showing: "Showing the board as it was on {t}. View only.", restoreThis: "Restore this version", backNow: "Back to now", restored: "Restored",
      exp: "Export", expPng: "PNG picture", expSvg: "SVG drawing", expFail: "The picture could not be made",
      working: "Hermes is working…", conflict: "Hermes changed that at the same time. The board was read again.", failed: "That change did not go through. The board was read again.",
      kind: "Shape", size: "Text size", szSmall: "Small", szBody: "Normal", szLarge: "Large", szTitle: "Title", szHuge: "Huge",
      bold: "Bold", italic: "Italic", link: "Link", linkPh: "https://…", apply: "Apply", list: "List",
      align: "Align text", alLeft: "Left", alCenter: "Centre", alRight: "Right",
      fillC: "Fill colour", outline: "Outline", hollow: "No fill", none: "None", custom: "Custom colour",
      lock: "Lock", unlock: "Unlock", more: "More", locked: "Locked. Unlock it to change it.",
      startHead: "Start of the arrow", endHead: "End of the arrow", hNone: "No head", hArrow: "Arrow head", hCircle: "Dot",
      lineStyle: "Line", solid: "Solid", dashed: "Dashed", label: "Label", labelPh: "Label", width: "Thickness",
      addRow: "Add a row", addCol: "Add a column", rowAbove: "Insert row above", rowBelow: "Insert row below", colLeft: "Insert column left",
      colRight: "Insert column right", delRow: "Delete row", delCol: "Delete column",
      arrange: "Align", aLeft: "Align left", aCenter: "Align centres", aRight: "Align right", aTop: "Align top", aMiddle: "Align middles",
      aBottom: "Align bottom", aH: "Distribute horizontally", aV: "Distribute vertically",
      group: "Group", ungroup: "Ungroup", cut: "Cut", copy: "Copy", paste: "Paste", dup: "Duplicate", front: "Bring to front", back: "Send to back",
      tidy: "Tidy up", del: "Delete", selAll: "Select all", pasteHint: "Press Ctrl+V to paste", copied: "Copied",
      clickType: "Click or type…", editText: "Text of the item", cell: "Table cell", interact: "Use it", interactHint: "Double-click to use it. Esc leaves.",
      embed: "Embed", imgBig: "That picture is too large to put on the board.", imgBad: "That file is not a picture the board can show.",
      limit: "The board is full (800 items).", nItems: "{n} items selected", nothing: "Nothing selected",
      tBox: "Block", tNote: "Sticky note", tText: "Text", tSection: "Section", tArrow: "Arrow", tPen: "Drawing line", tTable: "Table",
      tImage: "Image", tDrawing: "Drawing", tEmbed: "Embed",
      kinds: { rect: "Rectangle", rounded: "Rounded", ellipse: "Ellipse", diamond: "Diamond", pill: "Pill", hexagon: "Hexagon",
        parallelogram: "Parallelogram", database: "Database", queue: "Queue", document: "Document", cloud: "Cloud", person: "Person" },
      colours: { yellow: "Yellow", peach: "Peach", pink: "Pink", green: "Green", blue: "Blue", purple: "Purple", gray: "Gray", ink: "Ink", terracotta: "Terracotta" }
    },
    hu: {
      board: "Tábla", noGeo: "A tábla geometriai modulja nem töltődött be.",
      select: "Kijelölés", hand: "Kéz", text: "Szöveg", section: "Szakasz", sticky: "Cetli", draw: "Rajz", shapes: "Alakzatok",
      image: "Kép", ask: "Hermes megkérése", askPh: "Írd le a változtatást", send: "Küldés", sent: "Elküldve Hermesnek", drafted: "Bekerült a csevegőmezőbe",
      pen: "Toll", arrow: "Nyíl", table: "Táblázat", colour: "Szín",
      zoomIn: "Nagyítás", zoomOut: "Kicsinyítés", zoom: "Nagyítás mértéke", fit: "Teljes tábla", undo: "Visszavonás", redo: "Újra", keys: "Egybetűs eszközbillentyűk",
      hist: "Korábbi változatok", histNone: "Még nincs korábbi változat", byH: "Hermes", byYou: "te", byRestore: "visszaállítva",
      showing: "A tábla ekkori állapota: {t}. Csak megtekintés.", restoreThis: "Változat visszaállítása", backNow: "Vissza a mostanihoz", restored: "Visszaállítva",
      exp: "Exportálás", expPng: "PNG kép", expSvg: "SVG rajz", expFail: "A képet nem sikerült elkészíteni",
      working: "Hermes dolgozik…", conflict: "Hermes ugyanekkor módosította. A tábla újra be lett olvasva.", failed: "A módosítás nem ment át. A tábla újra be lett olvasva.",
      kind: "Alakzat", size: "Szövegméret", szSmall: "Kicsi", szBody: "Normál", szLarge: "Nagy", szTitle: "Cím", szHuge: "Óriás",
      bold: "Félkövér", italic: "Dőlt", link: "Hivatkozás", linkPh: "https://…", apply: "Alkalmaz", list: "Lista",
      align: "Szöveg igazítása", alLeft: "Balra", alCenter: "Középre", alRight: "Jobbra",
      fillC: "Kitöltés színe", outline: "Körvonal", hollow: "Nincs kitöltés", none: "Nincs", custom: "Egyéni szín",
      lock: "Zárolás", unlock: "Feloldás", more: "Továbbiak", locked: "Zárolva. A módosításhoz oldd fel.",
      startHead: "A nyíl eleje", endHead: "A nyíl vége", hNone: "Nincs nyílhegy", hArrow: "Nyílhegy", hCircle: "Pötty",
      lineStyle: "Vonal", solid: "Folytonos", dashed: "Szaggatott", label: "Felirat", labelPh: "Felirat", width: "Vastagság",
      addRow: "Sor hozzáadása", addCol: "Oszlop hozzáadása", rowAbove: "Sor beszúrása fölé", rowBelow: "Sor beszúrása alá", colLeft: "Oszlop beszúrása balra",
      colRight: "Oszlop beszúrása jobbra", delRow: "Sor törlése", delCol: "Oszlop törlése",
      arrange: "Igazítás", aLeft: "Balra igazítás", aCenter: "Középvonalra igazítás", aRight: "Jobbra igazítás", aTop: "Felülre igazítás", aMiddle: "Középre igazítás",
      aBottom: "Alulra igazítás", aH: "Vízszintes elosztás", aV: "Függőleges elosztás",
      group: "Csoportosítás", ungroup: "Csoport bontása", cut: "Kivágás", copy: "Másolás", paste: "Beillesztés", dup: "Kettőzés", front: "Előre hozás", back: "Hátra küldés",
      tidy: "Elrendezés", del: "Törlés", selAll: "Összes kijelölése", pasteHint: "Beillesztés: Ctrl+V", copied: "Másolva",
      clickType: "Kattints vagy írj…", editText: "Az elem szövege", cell: "Táblázatcella", interact: "Használat", interactHint: "Dupla kattintással használható. Esc: kilépés.",
      embed: "Beágyazás", imgBig: "Ez a kép túl nagy a táblához.", imgBad: "Ezt a fájlt a tábla nem tudja képként megjeleníteni.",
      limit: "A tábla megtelt (800 elem).", nItems: "{n} elem kijelölve", nothing: "Nincs kijelölés",
      tBox: "Blokk", tNote: "Cetli", tText: "Szöveg", tSection: "Szakasz", tArrow: "Nyíl", tPen: "Rajzolt vonal", tTable: "Táblázat",
      tImage: "Kép", tDrawing: "Rajz", tEmbed: "Beágyazás",
      kinds: { rect: "Téglalap", rounded: "Lekerekített", ellipse: "Ellipszis", diamond: "Rombusz", pill: "Kapszula", hexagon: "Hatszög",
        parallelogram: "Paralelogramma", database: "Adatbázis", queue: "Sor", document: "Dokumentum", cloud: "Felhő", person: "Személy" },
      colours: { yellow: "Sárga", peach: "Barack", pink: "Rózsaszín", green: "Zöld", blue: "Kék", purple: "Lila", gray: "Szürke", ink: "Tinta", terracotta: "Terrakotta" }
    }
  }, L);
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }

  var root = document.getElementById("bd-root") || document.getElementById("board") || document.body.appendChild(h("div", { id: "bd-root" }));
  root.classList.add("bd");
  if (!G) { root.appendChild(h("div", { "class": "kit-empty", text: T.noGeo })); kit.ready(); return; }

  // ------------------------------------------------------------------ small helpers
  var ICONS = {
    lock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3", unlock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 5.7-1.3",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
    group: "M4 4h6v6H4zM14 14h6v6h-6zM10 7h7v7M7 10v7h7", fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    ring: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z", dash: "M3 12h4M10 12h4M17 12h4", solid: "M3 12h18",
    hNone: "M4 12h16", hArrow: "M4 12h16M14 6l6 6-6 6", hCircle: "M4 12h10M14 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
    hNoneS: "M4 12h16", hArrowS: "M20 12H4M10 6l-6 6 6 6", hCircleS: "M20 12H10M4 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
    width: "M4 6h16M4 11h16M4 11.8h16M4 17h16M4 17.8h16M4 18.6h16", arrange: "M4 4v16M8 7h10v4H8zM8 14h6v4H8z",
    rowAdd: "M4 5h16v6H4zM12 14v6M9 17h6", colAdd: "M5 4h6v16H5zM14 12h6M17 9v6", tag: "M4 9h12l4 3-4 3H4z"
  };
  function ico(name) {
    return ICONS[name] ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICONS[name] + '"/></svg>' : kit.icon(name);
  }
  var CARET = '<svg class="bd-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>';
  function kindIcon(kind) {
    var d = kind === "table" ? "M1 1h20v16H1zM1 6.5h20M1 12h20M8 1v16" : G.shapePath(kind, 20, kind === "person" ? 18 : 15);
    return '<svg viewBox="-2 -2 24 ' + (kind === "person" ? 22 : kind === "table" ? 22 : 19) + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  /** Equal as data, whatever order the keys came in (the server stores an item's keys in its own order). */
  function same(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !same(a[ka[i]], b[ka[i]])) return false;
    return true;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rnd(v) { return Math.round(v); }
  function newId(p) { var id; do { id = (p || "u") + Math.random().toString(36).slice(2, 8); } while (byId[id]); return id; }
  function cross(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  function union(list) {
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    list.forEach(function (b) { if (!b) return; x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); });
    return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  function svgEl(tag, attrs) { var n = document.createElementNS("http://www.w3.org/2000/svg", tag); for (var k in attrs || {}) n.setAttribute(k, attrs[k]); return n; }

  // ------------------------------------------------------------------ the board's own colours (board.css holds the values, light and dark)
  var FILLS = ["yellow", "peach", "pink", "green", "blue", "purple", "gray"], STROKES = ["ink", "terracotta", "blue", "green", "purple"];
  var HEX = /^#[0-9a-f]{6}$/i;
  function lum(hex) { var n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
  function shade(hex, k) { // a darker (k < 0) or lighter tone of a custom colour, for its outline
    var n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(function (v) { return clamp(rnd(k < 0 ? v * (1 + k) : v + (255 - v) * k), 0, 255); });
    return "#" + c.map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
  }
  /** The fill, its outline and the ink that reads on it, as CSS colours. */
  function fillOf(name, dflt) {
    var c = name || dflt;
    if (HEX.test(c)) return { bg: c, line: shade(c, lum(c) > 0.5 ? -0.28 : 0.3), ink: lum(c) > 0.55 ? "#1b1f24" : "#ffffff" };
    if (FILLS.indexOf(c) < 0) c = dflt;
    return { bg: "var(--bd-f-" + c + ")", line: "var(--bd-l-" + c + ")", ink: "var(--bd-i-" + c + ")" };
  }
  function strokeOf(name, dflt) {
    var c = name || dflt || "ink";
    if (HEX.test(c)) return c;
    return "var(--bd-s-" + (STROKES.indexOf(c) < 0 ? "ink" : c) + ")";
  }
  /** A CSS colour of the palette as its present value (exports cannot carry variables). */
  function solidColour(c) {
    var m = /^var\((--[\w-]+)\)$/.exec(c);
    return m ? (getComputedStyle(root).getPropertyValue(m[1]).trim() || "#888888") : c;
  }

  // >>> pure: what needs no page (tests/test_board_page.py runs this block under node)
  var LIST = /^(- |\d+\. )(.*)$/;
  /** The words without the marks (exports, names read aloud). */
  function plain(text) {
    return String(text || "").replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1").replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1").replace(/`([^`\n]+)`/g, "$1");
  }
  /** A line made a link as a whole: a list mark stays in front, a link it had gives way, and its bold,
   * italic and code stay inside the label (`[***Dia***](url)`: the screen, the export and measure all read that). */
  function linkLine(url) {
    return function (ln) {
      var x = LIST.exec(ln), body = (x ? x[2] : ln).replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1").replace(/[\[\]]/g, "");
      return plain(body).trim() ? (x ? x[1] : "") + "[" + body + "](" + url + ")" : ln;
    };
  }
  // B, I and the list button wrap what is selected in the editor, or every line of the selected items
  function isWrapped(s, m) {
    if (s.length < 2 * m.length + 1 || s.slice(0, m.length) !== m || s.slice(-m.length) !== m) return false;
    return m !== "*" || (s.slice(0, 2) !== "**" || s.slice(0, 3) === "***");
  }
  function markText(text, m) {
    var lines = String(text || "").split("\n"), parts = lines.map(function (ln) { var x = LIST.exec(ln); return x ? [x[1], x[2]] : ["", ln]; });
    var all = parts.every(function (p) { return !p[1].trim() || isWrapped(p[1], m); });
    return parts.map(function (p) { return p[0] + (!p[1].trim() ? p[1] : all ? p[1].slice(m.length, -m.length) : isWrapped(p[1], m) ? p[1] : m + p[1] + m); }).join("\n");
  }
  function listText(text) {
    var lines = String(text || "").split("\n"), all = lines.every(function (ln) { return !ln.trim() || LIST.test(ln); });
    return lines.map(function (ln) { return !ln.trim() ? ln : all ? ln.replace(LIST, "$2") : LIST.test(ln) ? ln : "- " + ln; }).join("\n");
  }
  /** Whether a table the server sent still has the cell being typed in (row r, column c): then the typing stays. */
  function cellStays(rows, r, c) {
    if (!Array.isArray(rows) || !Array.isArray(rows[r])) return false;
    var cols = 0;
    rows.forEach(function (x) { if (Array.isArray(x)) cols = Math.max(cols, x.length); });
    return c >= 0 && c < cols;
  }
  var PURE = { plain: plain, linkLine: linkLine, markText: markText, listText: listText, cellStays: cellStays };
  // <<< pure

  // ------------------------------------------------------------------ text: the inline marks and lists
  function inline(s) {
    var code = [];
    var out = kit.esc(s).replace(/`([^`\n]+)`/g, function (m, c) { code.push(c); return "\u0001" + (code.length - 1) + "\u0001"; });
    out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/\*([^*\n]+)\*/g, "<i>$1</i>");
    return out.replace(/\u0001(\d+)\u0001/g, function (m, i) { return "<code>" + code[+i] + "</code>"; });
  }
  function rich(text) {
    var out = "", list = null;
    String(text || "").split("\n").forEach(function (ln) {
      var m = LIST.exec(ln), kind = m ? (m[1] === "- " ? "ul" : "ol") : null;
      if (kind !== list) { if (list) out += "</" + list + ">"; if (kind) out += "<" + kind + ">"; list = kind; }
      out += kind ? "<li>" + inline(m[2]) + "</li>" : "<div>" + (inline(ln) || "<br>") + "</div>";
    });
    return out + (list ? "</" + list + ">" : "");
  }

  // ------------------------------------------------------------------ the model
  var live = !!(hm && hm.board && hm.board.edit) && !C.thumb && !!C.board;
  var B0 = C.board || kit.json("board.json", null) || {};
  var items = [], byId = {}, zOf = {}, rev = B0.rev || 0, title = B0.title || C.title || "";
  var aIdx = null, solidList = null;         // arrows by the item they touch; the items arrows route around
  var N = {};                                 // per item: {el, b (bounds), r (route), off, dirty, ...}
  var sel = [], ed = null, g = null, preview = null, interact = null, fresh = {};
  var TYPES = { box: 1, note: 1, text: 1, section: 1, arrow: 1, pen: 1, table: 1, image: 1, drawing: 1, embed: 1 };
  var TEXTY = { box: 1, note: 1, text: 1, section: 1 }, DOTS = { box: 1, note: 1, text: 1, section: 1, table: 1, image: 1 };
  function normItems(list) {
    var out = [], seen = {}, n = 0;
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      if (!raw || typeof raw !== "object" || !TYPES[raw.type] || out.length >= 800) return;
      var it = clone(raw);
      if (typeof it.id !== "string" || !it.id || seen[it.id]) { do { it.id = "e" + (++n); } while (seen[it.id]); }
      seen[it.id] = 1;
      if (it.type !== "arrow") { it.x = +it.x || 0; it.y = +it.y || 0; }
      out.push(it);
    });
    return out;
  }
  function index() {
    byId = {}; zOf = {}; aIdx = null; solidList = null;
    items.forEach(function (it, i) { byId[it.id] = it; zOf[it.id] = it.type === "section" ? i + 1 : i + 1001; });
  }
  function nd(id) { return N[id] || (N[id] = {}); }
  var laneMap = {};                           // arrows that join the same two items: each its own lane (geo.lanes)
  function laneOf(id) { if (!aIdx) arrowsAt(""); return laneMap[id] || 0; }
  function arrowsAt(id) {
    if (!aIdx) {
      try { laneMap = G.lanes(items) || {}; } catch (e) { laneMap = {}; }
      aIdx = {};
      items.forEach(function (a) {
        if (a.type !== "arrow") return;
        if (typeof a.from === "string") (aIdx[a.from] = aIdx[a.from] || []).push(a);
        if (typeof a.to === "string" && a.to !== a.from) (aIdx[a.to] = aIdx[a.to] || []).push(a);
      });
    }
    return aIdx[id] || [];
  }
  function solids() {
    return solidList || (solidList = items.filter(function (it) { return it.type !== "arrow" && it.type !== "pen" && it.type !== "section"; }));
  }
  function px(it) { return G.SIZES[it.size] || G.SIZES.body; }
  function kindOf(it) { return it.type === "note" ? "rect" : (G.KINDS.indexOf(it.kind) >= 0 ? it.kind : "rounded"); }

  /** An item's box on the board (cached until the item changes). */
  function bb(it) {
    var n = nd(it.id);
    if (n.b) return n.b;
    var b;
    if (it.type === "arrow") {
      var r = routeOf(it), pts = r && r.pts || [];
      b = union(pts.map(function (p) { return { x: p[0], y: p[1], w: 0, h: 0 }; })) || { x: 0, y: 0, w: 0, h: 0 };
      b = { x: b.x - 8, y: b.y - 8, w: b.w + 16, h: b.h + 16 };
    } else {
      try { b = G.bounds(it, byId); } catch (e) { b = null; }
      if (!b || !isFinite(b.x + b.y + b.w + b.h)) b = { x: it.x || 0, y: it.y || 0, w: +it.w || 0, h: +it.h || 0 };
    }
    return (n.b = b);
  }
  function endOf(a, which) {
    var v = a[which];
    // a box's end meets its real outline (a diamond's slope, an ellipse), not its bounding box
    if (typeof v === "string") { var t = byId[v]; return t && t.type !== "arrow" ? { rect: bb(t), kind: t.type === "box" ? kindOf(t) : "rect" } : { pt: [0, 0] }; }
    return { pt: Array.isArray(v) && v.length > 1 ? [+v[0] || 0, +v[1] || 0] : [0, 0] };
  }
  function endBox(e) { return e.rect || { x: e.pt[0], y: e.pt[1], w: 0, h: 0 }; }
  // An arrow's route as drawn: its own route (n.r: round what is in the way, on its lane and slot),
  // then moved off any other arrow it would run on top of (n.f). Slots and that separation look at
  // every arrow, so when any arrow's own route went stale both are worked out again for all of them,
  // and the arrows whose drawn route changed are drawn again.
  var slotMap = {}, settled = false;
  function settle() {
    settled = true;
    var arrows = items.filter(function (a) { return a.type === "arrow"; }), old = slotMap, list, sep, moved = false;
    try { slotMap = G.slots(items, byId) || {}; } catch (e) { slotMap = {}; }
    arrows.forEach(function (a) { if (!same(old[a.id] || null, slotMap[a.id] || null)) { var n = nd(a.id); n.r = null; } });
    list = arrows.map(function (a) { return { id: a.id, pts: rawRoute(a).pts, fixed: Array.isArray(a.via) && a.via.length > 0 }; });
    try { sep = G.separate(list) || {}; } catch (e) { sep = {}; }
    arrows.forEach(function (a) {
      var n = nd(a.id), f = n.r;
      if (sep[a.id]) { try { f = G.withPts(n.r, sep[a.id]); } catch (e) { f = n.r; } }
      if (!n.f || !same(n.f.pts, f.pts)) { if (n.f) { n.b = null; n.dirty = true; moved = true; } n.f = f; }
    });
    if (moved) cullSoon();
  }
  function routeOf(a) {
    var n = nd(a.id);
    if (!n.r) settled = false;
    if (!settled) settle();
    return n.f || rawRoute(a);
  }
  /** The blocks an arrow between two ends goes round: those near the way from one to the other, not the ends' own. */
  function obstaclesFor(f, t, skip) {
    var zone = union([endBox(f), endBox(t)]), obs = [], list = solids();
    zone = { x: zone.x - 60, y: zone.y - 60, w: zone.w + 120, h: zone.h + 120 };
    for (var i = 0; i < list.length && obs.length < 40; i++) {
      var o = list[i];
      if (skip.indexOf(o.id) >= 0) continue;
      var b = bb(o);
      if (cross(b, zone)) obs.push(b);
    }
    return obs;
  }
  function rawRoute(a) {
    var n = nd(a.id);
    if (n.r) return n.r;
    var f = endOf(a, "from"), t = endOf(a, "to"), o2 = { obstacles: obstaclesFor(f, t, [a.from, a.to]) };
    if (a.fromSide) o2.fromSide = a.fromSide;
    if (a.toSide) o2.toSide = a.toSide;
    if (Array.isArray(a.via) && a.via.length) o2.via = a.via;
    if (laneOf(a.id)) o2.lane = laneOf(a.id);
    var sl = slotMap[a.id];
    if (sl) { if (sl.from) o2.fromAt = sl.from; if (sl.to) o2.toAt = sl.to; }
    try { n.r = G.route(f, t, o2); } catch (e) { n.r = null; }
    if (!n.r || !n.r.pts) { var p = endBox(f), q = endBox(t); n.r = { pts: [[p.x, p.y], [q.x, q.y]], d: "M" + p.x + " " + p.y + "L" + q.x + " " + q.y, labelAt: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } }; }
    return n.r;
  }
  /** Forget what was derived from an item (and from the arrows that touch it). */
  function inval(id) {
    var n = nd(id); n.b = null; n.r = null; n.dirty = true;
    arrowsAt(id).forEach(function (a) { var m = nd(a.id); m.b = null; m.r = null; m.dirty = true; });
  }

  // ------------------------------------------------------------------ the canvas: a world layer under pan and zoom, a screen layer for handles
  var ro = !live;                              // no bridge, a thumbnail, a history preview: view only
  function canEdit() { return live && !preview; }
  var view = h("div", { "class": "bd-view", tabindex: "0", role: "application", "aria-label": T.board + (title ? ": " + title : "") });
  var world = h("div", { "class": "bd-world" }), ui = h("div", { "class": "bd-ui" });
  var draftSvg = svgEl("svg", { "class": "bd-draft", "aria-hidden": "true" });  // in board units: a line being drawn, snapping guides
  var uiSel = h("div", { "class": "bd-uisel" }), ctx = h("div", { "class": "bd-ctx", role: "toolbar", "aria-label": T.more, hidden: true });
  var liveEl = h("div", { "class": "bd-sr", "aria-live": "polite" });
  world.appendChild(draftSvg); ui.append(uiSel, ctx); view.append(world, ui); root.append(view, liveEl);
  var cam = { x: 0, y: 0, z: 1 }, vw = 1, vh = 1, vrc = { left: 0, top: 0 }, camRaf = 0;
  function measureView() { vrc = view.getBoundingClientRect(); vw = vrc.width || 1; vh = vrc.height || 1; }
  function toWorld(e) { return { x: (e.clientX - vrc.left - cam.x) / cam.z, y: (e.clientY - vrc.top - cam.y) / cam.z }; }
  var panTimer = null;
  function setCam(x, y, z) {
    // While only the position changes the world is its own layer (a pan repaints nothing); a zoom draws it again, sharp.
    if (z !== cam.z) { clearTimeout(panTimer); world.classList.remove("bd-panning"); }
    else if (x !== cam.x || y !== cam.y) { world.classList.add("bd-panning"); clearTimeout(panTimer); panTimer = setTimeout(function () { world.classList.remove("bd-panning"); }, 250); }
    cam.x = x; cam.y = y; cam.z = z;
    if (!camRaf) camRaf = requestAnimationFrame(applyCam);
  }
  function applyCam() {
    camRaf = 0;
    world.style.transform = "translate(" + cam.x + "px," + cam.y + "px) scale(" + cam.z + ")";
    var cell = 24 * cam.z; while (cell < 12) cell *= 4;
    view.style.backgroundSize = cell + "px " + cell + "px";
    view.style.backgroundPosition = cam.x + "px " + cam.y + "px";
    root.style.setProperty("--bd-k", String(1 / cam.z));   // 1 screen px in board units (hairlines that keep their weight)
    cull(); drawUi(); zoomSync(); saveCam(); sendView();
  }
  function zoomAt(sx, sy, z2) {
    z2 = clamp(z2, 0.1, 4);
    var wx = (sx - cam.x) / cam.z, wy = (sy - cam.y) / cam.z;
    setCam(sx - wx * z2, sy - wy * z2, z2);
  }
  function zoomStep(dir) {
    var stops = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4], z = cam.z, i;
    if (dir > 0) { for (i = 0; i < stops.length && stops[i] <= z + 0.001; i++); z = stops[Math.min(i, stops.length - 1)]; }
    else { for (i = stops.length - 1; i >= 0 && stops[i] >= z - 0.001; i--); z = stops[Math.max(i, 0)]; }
    zoomAt(vw / 2, vh / 2, z);
  }
  function fitAll(now) {
    var rects = items.map(bb), pad = ro ? Math.min(32, vw * 0.06) : Math.min(72, vw * 0.08);
    if (!rects.length) { cam.x = vw / 2; cam.y = vh / 2; cam.z = 1; }
    else { var f = G.fit(rects, vw, vh, pad, ro ? 2 : 1); cam.z = f.zoom; cam.x = f.tx; cam.y = f.ty; }
    if (now) applyCam(); else setCam(cam.x, cam.y, cam.z);
  }
  /** Bring a box into view (keyboard moves, pasted items) without changing the zoom. */
  function reveal(b) {
    var m = 60, x = cam.x, y = cam.y, l = b.x * cam.z + x, t = b.y * cam.z + y, r = l + b.w * cam.z, bt = t + b.h * cam.z;
    if (r - l > vw - 2 * m) x += vw / 2 - (l + r) / 2; else if (l < m) x += m - l; else if (r > vw - m) x -= r - (vw - m);
    if (bt - t > vh - 2 * m) y += vh / 2 - (t + bt) / 2; else if (t < m) y += m - t; else if (bt > vh - m - 60) y -= bt - (vh - m - 60);
    if (x !== cam.x || y !== cam.y) setCam(x, y, cam.z);
  }
  var store = null, VKEY = "bd-view:" + (C.id || title || "board"), PKEY = "bd-prefs";
  try { store = window.localStorage; store.getItem(PKEY); } catch (e) { store = null; }
  function loadJson(k) { try { return store ? JSON.parse(store.getItem(k) || "null") : null; } catch (e) { return null; } }
  function saveJson(k, v) { try { if (store) store.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var prefs = { keys: true, draw: "pen", penColor: "ink", penWidth: 3, shape: "rounded" };
  (function () { var p = loadJson(PKEY) || {}; for (var k in prefs) if (typeof p[k] === typeof prefs[k]) prefs[k] = p[k]; })();
  if (STROKES.indexOf(prefs.penColor) < 0 && !HEX.test(prefs.penColor)) prefs.penColor = "ink";
  if (prefs.shape !== "table" && G.KINDS.indexOf(prefs.shape) < 0) prefs.shape = "rounded";
  function savePrefs() { saveJson(PKEY, prefs); }
  var camTimer = null;
  function saveCam() { if (ro) return; clearTimeout(camTimer); camTimer = setTimeout(function () { saveJson(VKEY, { x: rnd(cam.x), y: rnd(cam.y), z: +cam.z.toFixed(3) }); }, 400); }

  // ------------------------------------------------------------------ drawing the items
  function posCss(b) { return "left:" + b.x + "px;top:" + b.y + "px;width:" + b.w + "px;height:" + b.h + "px;"; }
  function inset(kind, w, h2) {
    var r; try { r = G.shapeInset(kind, w, h2); } catch (e) { r = null; }
    return r && r.w > 0 && r.h > 0 ? r : { x: 12, y: 8, w: Math.max(w - 24, 8), h: Math.max(h2 - 16, 8) };
  }
  function boxInk(it) { return it.type !== "note" && it.hollow ? strokeOf("ink") : fillOf(it.color, it.type === "note" ? "yellow" : "green").ink; }
  function shapeSvg(it, b) {
    var note = it.type === "note", c = fillOf(it.color, note ? "yellow" : "green");
    var stroke = note ? "none" : it.stroke ? strokeOf(it.stroke) : it.hollow ? strokeOf("ink") : c.line;
    return '<svg class="bd-shape" viewBox="0 0 ' + b.w + " " + b.h + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + G.shapePath(kindOf(it), b.w, b.h) +
      '" style="fill:' + (it.hollow && !note ? "transparent" : c.bg) + ";stroke:" + stroke + '"/></svg>';
  }
  function txCss(it, b) {
    return posCss(inset(kindOf(it), b.w, b.h)) + "font-size:" + px(it) + "px;text-align:" + (it.align || "center") + ";color:" + boxInk(it);
  }
  function vec(inner) { return '<svg class="bd-vec" aria-hidden="true">' + inner + "</svg>"; }
  function imgSrc(src) {
    if (typeof src !== "string") return "";
    if (/^data:image\/(png|jpeg|webp);base64,/i.test(src)) return src;
    return kit.fileUrl(src) || (/^[\w][\w./ -]*$/.test(src) && src.indexOf("..") < 0 ? src : "");
  }
  /** A drawing as a picture: an <img> knows no currentColor, so the board's ink goes in as its value. */
  function drawingUri(svg) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(String(svg).replace(/currentColor/gi, solidColour(strokeOf("ink")))); }
  function headDir(pts, atStart) { // the unit direction the line arrives with at that end
    var a = atStart ? pts[1] : pts[pts.length - 2], b = atStart ? pts[0] : pts[pts.length - 1];
    if (!a || !b) return { x: 1, y: 0 };
    var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / l, y: dy / l };
  }
  function heads(a, r) {
    var hs = Array.isArray(a.heads) ? a.heads : ["none", "arrow"], out = "", pts = r.pts || [];
    [0, 1].forEach(function (i) {
      var k = hs[i];
      if (k !== "arrow" && k !== "circle") return;
      var tip = i ? pts[pts.length - 1] : pts[0], d = "";
      try { d = G.headPath(k, tip, headDir(pts, !i), 10) || ""; } catch (e) {}
      if (d) out += '<path class="bd-ahead' + (k === "circle" ? " bd-acirc" : "") + '" d="' + d + '"/>';
    });
    return out;
  }
  var BUILD = {
    box: function (it) {
      var b = bb(it), el = h("div", { "class": it.type === "note" ? "bd-note" : "bd-box", html: shapeSvg(it, b) });
      el.style.cssText = posCss(b);
      var tx = h("div", { "class": "bd-tx", html: rich(it.text) });
      tx.style.cssText = txCss(it, b);
      el.appendChild(tx);
      return el;
    },
    text: function (it) {
      var b = bb(it), el = h("div", { "class": "bd-text bd-s-" + (it.size || "body") });
      el.style.cssText = "left:" + b.x + "px;top:" + b.y + "px;width:" + b.w + "px;min-height:" + b.h + "px;font-size:" + px(it) + "px;text-align:" +
        (it.align || "left") + ";color:" + strokeOf(it.color) + (it.w ? "" : ";white-space:pre");
      el.appendChild(h("div", { "class": "bd-tx", html: rich(it.text) }));
      return el;
    },
    section: function (it) {
      var b = bb(it), c = fillOf(it.color, "gray"), el = h("div", { "class": "bd-section" });
      el.style.cssText = posCss(b) + "--bd-c:" + c.bg + ";--bd-cl:" + c.line + ";--bd-ci:" + c.ink;
      el.innerHTML = '<svg class="bd-shape" aria-hidden="true"><rect class="bd-sfill" width="100%" height="100%" rx="10"/><rect class="bd-shit" width="100%" height="100%" rx="10"/></svg>';
      el.appendChild(h("div", { "class": "bd-stitle bd-tx", text: plain(it.text) }));
      return el;
    },
    table: function (it) {
      var lay = G.tableLayout(it), rows = Array.isArray(it.rows) ? it.rows : [], el = h("div", { "class": "bd-table" });
      el.style.cssText = posCss({ x: it.x, y: it.y, w: lay.w, h: lay.h });
      var s = '<table role="presentation"><colgroup>' + lay.colw.map(function (w) { return '<col style="width:' + w + 'px">'; }).join("") + "</colgroup>";
      rows.forEach(function (row, r) {
        s += '<tr style="height:' + lay.rowh[r] + 'px">';
        for (var c = 0; c < lay.colw.length; c++) {
          var t = row && row[c] != null ? String(row[c]) : "";
          s += (r ? "<td" : "<th") + ' data-r="' + r + '" data-c="' + c + '"><div class="bd-cell">' + inline(t).replace(/\n/g, "<br>") + "</div>" + (r ? "</td>" : "</th>");
        }
        s += "</tr>";
      });
      el.innerHTML = s + "</table>";
      return el;
    },
    image: function (it) {
      var el = h("div", { "class": "bd-image" }), src = imgSrc(it.src);
      el.style.cssText = posCss(bb(it));
      if (src) el.appendChild(h("img", { src: src, alt: "", draggable: "false" }));
      return el;
    },
    drawing: function (it) {
      // The server sanitised the SVG; as an <img> nothing in it could run anyway.
      var el = h("div", { "class": "bd-image bd-drawing" });
      el.style.cssText = posCss(bb(it));
      if (typeof it.svg === "string" && it.svg) el.appendChild(h("img", { src: drawingUri(it.svg), alt: "", draggable: "false" }));
      return el;
    },
    pen: function (it) {
      var d = ""; try { d = G.penPath(it.points || [], it.x, it.y) || ""; } catch (e) {}
      var el = h("div", { "class": "bd-pen" });
      el.innerHTML = vec('<path class="bd-ahit" d="' + d + '" style="--bd-pw:' + clamp(+it.width || 3, 1, 40) + 'px"/><path class="bd-pline" d="' + d + '" style="stroke:' + strokeOf(it.color) + ";stroke-width:" + clamp(+it.width || 3, 1, 40) + '"/>');
      return el;
    },
    arrow: function (a) {
      var r = routeOf(a), el = h("div", { "class": "bd-arrow" + (a.dash ? " bd-dash" : "") });
      el.style.color = strokeOf(a.color);
      el.innerHTML = vec('<path class="bd-ahit" d="' + r.d + '"/><path class="bd-aline" d="' + r.d + '"/>' + heads(a, r));
      if (a.label || lblFor === a.id) {
        var at = r.labelAt || r.mid || { x: 0, y: 0 }, lb = h("div", { "class": "bd-albl", html: inline(a.label || "") });
        lb.style.cssText = "left:" + at.x + "px;top:" + at.y + "px";
        el.appendChild(lb);
      }
      return el;
    },
    embed: function (it, n) { return buildEmbed(it, n); }
  };
  BUILD.note = BUILD.box;
  /** Draw (or draw again) one item. An item being typed in keeps its editor; an embed keeps its frame. */
  function draw(it) {
    var n = nd(it.id), old = n.el, el;
    n.dirty = false; n.off = false;
    if (it.type === "embed" && old && n.html === it.html && !C.thumb) { updateEmbed(it, n); el = old; }
    else if (ed && ed.id === it.id && old && ed.kind === "text") { reshape(it); el = old; }
    else if (ed && ed.id === it.id && old) el = old;      // a cell or a label being typed: as it is until the typing ends
    else {
      try { el = BUILD[it.type](it, n); } catch (e) { el = h("div", {}); }
      el.classList.add("bd-it");
      el.setAttribute("data-id", it.id);
      if (old) old.replaceWith(el); else world.insertBefore(el, draftSvg);
      n.el = el;
    }
    el.classList.remove("bd-off");
    el.style.zIndex = zOf[it.id];
    el.classList.toggle("bd-locked", !!it.locked);
    el.classList.toggle("bd-sel", sel.indexOf(it.id) >= 0);
    if (interact === it.id) el.classList.add("bd-live");
  }
  /** An item whose text is being typed: its box and outline follow, the editor stays. */
  function reshape(it) {
    var n = nd(it.id), el = n.el, b = bb(it);
    if (!el) return;
    if (it.type === "text") { el.style.left = b.x + "px"; el.style.top = b.y + "px"; el.style.width = b.w + "px"; el.style.minHeight = b.h + "px"; return; }
    el.style.left = b.x + "px"; el.style.top = b.y + "px"; el.style.width = b.w + "px"; el.style.height = b.h + "px";
    if (it.type === "section") return;
    var sv = el.querySelector(".bd-shape"), tx = el.querySelector(".bd-tx");
    if (sv) { sv.setAttribute("viewBox", "0 0 " + b.w + " " + b.h); sv.firstChild.setAttribute("d", G.shapePath(kindOf(it), b.w, b.h)); }
    if (tx) { var i = inset(kindOf(it), b.w, b.h); tx.style.left = i.x + "px"; tx.style.top = i.y + "px"; tx.style.width = i.w + "px"; tx.style.height = i.h + "px"; }
  }
  /** Only where it is (a drag): no rebuild for the boxed kinds. */
  function place(it) {
    var n = nd(it.id);
    n.b = null;
    if (!n.el || n.off) { n.dirty = true; return; }
    if (it.type === "pen" || it.type === "arrow") { n.r = null; draw(it); return; }
    var b = bb(it);
    n.el.style.left = b.x + "px"; n.el.style.top = b.y + "px";
  }
  var cullRaf = 0;
  function cullSoon() { if (!cullRaf) cullRaf = requestAnimationFrame(function () { cullRaf = 0; cull(); drawUi(); }); }
  /** Build what came into view, hide what left it, redraw what changed. */
  function cull() {
    var m = 240 / cam.z, vr = { x: -cam.x / cam.z - m, y: -cam.y / cam.z - m, w: vw / cam.z + 2 * m, h: vh / cam.z + 2 * m };
    for (var i = 0; i < items.length; i++) {
      var it = items[i], n = nd(it.id), b = bb(it);
      var on = (b.x <= vr.x + vr.w && b.x + b.w >= vr.x && b.y <= vr.y + vr.h && b.y + b.h >= vr.y) || (ed && ed.id === it.id) || interact === it.id;
      if (on) { if (!n.el || n.dirty) draw(it); else if (n.off) { n.el.classList.remove("bd-off"); n.off = false; } }
      else if (n.el && !n.off) { n.el.classList.add("bd-off"); n.off = true; }
    }
  }
  function touched(ids) { ids.forEach(inval); }
  function dropNode(id) {
    var n = N[id];
    if (n && n.el) n.el.remove();
    if (n && n.nonce) delete embeds[n.nonce];
    delete N[id];
  }
  function resetNodes() { Object.keys(N).forEach(dropNode); N = {}; }
  function zSync() { items.forEach(function (it) { var n = N[it.id]; if (n && n.el) n.el.style.zIndex = zOf[it.id]; }); }
  /** Every arrow routes again (what it goes around may have moved). */
  function reroute() { items.forEach(function (a) { if (a.type === "arrow") { var n = nd(a.id); n.r = null; n.b = null; n.dirty = true; } }); }
  function glow(ids) {
    ids.forEach(function (id) {
      var n = N[id];
      if (!n || !n.el) return;
      n.el.classList.remove("bd-glow"); void n.el.offsetWidth; n.el.classList.add("bd-glow");
      setTimeout(function () { if (n.el) n.el.classList.remove("bd-glow"); }, 2000);
    });
  }

  // ------------------------------------------------------------------ embeds: a sandboxed frame that keeps a small state on the board
  var embeds = {};   // nonce -> item id
  function embedDoc(it, nonce) {
    var st = it.state && typeof it.state === "object" ? it.state : {};
    // boardEmbed inside the frame: load() gives the saved state (also usable as a promise), save(object)
    // stores it on the board, onLoad(fn) runs with the state now and whenever another copy saved.
    var shim = "(function(){var N=" + JSON.stringify(nonce) + ",st=" + JSON.stringify(st).replace(/</g, "\\u003c") + ",cbs=[];" +
      "function out(){var o=JSON.parse(JSON.stringify(st||{}));Object.defineProperty(o,'then',{value:function(f){var c=JSON.parse(JSON.stringify(st||{}));return Promise.resolve(c).then(f)}});return o}" +
      "window.boardEmbed={load:out,save:function(o){try{st=JSON.parse(JSON.stringify(o||{}))}catch(e){return}parent.postMessage({boardEmbed:N,t:'save',state:st},'*')}," +
      "onLoad:function(f){if(typeof f!=='function')return;cbs.push(f);setTimeout(function(){try{f(JSON.parse(JSON.stringify(st||{})))}catch(e){}},0)}};" +
      "addEventListener('message',function(e){var d=e.data;if(!d||d.boardEmbed!==N||e.source!==parent)return;if(d.t==='state'){st=d.state||{};cbs.forEach(function(f){try{f(JSON.parse(JSON.stringify(st)))}catch(x){}})}});" +
      "addEventListener('keydown',function(e){if(e.key==='Escape')parent.postMessage({boardEmbed:N,t:'esc'},'*')});})();";
    return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:">' +
      // an embed is a small page of its own: light paper in either theme, like a picture, so the colours it was written with hold
      '<meta name="color-scheme" content="light"><style>html,body{margin:0}body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;padding:12px;box-sizing:border-box;color:#1b1f24;background:#fff}</style>' +
      "<script>" + shim + "</" + "script></head><body>" + String(it.html || "") + "</body></html>";
  }
  function buildEmbed(it, n) {
    var el = h("div", { "class": "bd-embed" });
    el.style.cssText = posCss(bb(it));
    el.appendChild(h("div", { "class": "bd-etab", text: it.title || T.embed, title: T.interactHint }));
    if (n.nonce) delete embeds[n.nonce];
    n.html = it.html; n.state = JSON.stringify(it.state || {});
    if (C.thumb) { el.appendChild(h("div", { "class": "bd-ebody bd-eph", text: it.title || T.embed })); return el; }
    n.nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    embeds[n.nonce] = it.id;
    var fr = h("iframe", { "class": "bd-ebody", sandbox: "allow-scripts", title: it.title || T.embed, referrerpolicy: "no-referrer", tabindex: "-1" });
    fr.srcdoc = embedDoc(it, n.nonce);
    n.frame = fr;
    el.append(fr, h("div", { "class": "bd-shield" }));
    return el;
  }
  function updateEmbed(it, n) {
    var el = n.el, b = bb(it), tab = el.querySelector(".bd-etab");
    el.style.left = b.x + "px"; el.style.top = b.y + "px"; el.style.width = b.w + "px"; el.style.height = b.h + "px";
    if (tab) tab.textContent = it.title || T.embed;
    var s = JSON.stringify(it.state || {});
    if (s !== n.state) { n.state = s; try { n.frame.contentWindow.postMessage({ boardEmbed: n.nonce, t: "state", state: it.state || {} }, "*"); } catch (e) {} }
  }
  var stateTimers = {};
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d.boardEmbed !== "string") return;
    var id = embeds[d.boardEmbed], it = id && byId[id], n = id && N[id];
    if (!it || !n || !n.frame || e.source !== n.frame.contentWindow) return;
    if (d.t === "esc") { if (interact === id) { setInteract(null); view.focus({ preventScroll: true }); } return; }
    if (d.t !== "save" || !d.state || typeof d.state !== "object" || Array.isArray(d.state)) return;
    var s; try { s = JSON.stringify(d.state); } catch (x) { return; }
    if (s.length > 16000 || s === n.state) return;
    it.state = JSON.parse(s); n.state = s;
    if (!canEdit()) return;
    clearTimeout(stateTimers[id]);
    stateTimers[id] = setTimeout(function () { if (byId[id]) { own(id); queue([{ op: "state", id: id, state: clone(byId[id].state) }]); } }, 200);
  });
  function setInteract(id) {
    if (interact === id) return;
    var o = interact && N[interact];
    if (o && o.el) o.el.classList.remove("bd-live");
    interact = id;
    var n = id && N[id];
    if (n && n.el) { n.el.classList.add("bd-live"); try { n.frame.focus(); } catch (e) {} }
  }

  // ------------------------------------------------------------------ edits: applied here at once, sent as ops, undone as inverse ops
  var undoS = [], redoS = [], pend = [], inflight = 0, chain = Promise.resolve(), needPull = false, pulling = false, flushTimer = null;
  var ownAt = {}, hermesActive = false;
  function own(id) { ownAt[id] = Date.now(); }
  function shiftArrow(a, dx, dy) {
    ["from", "to"].forEach(function (k) { if (Array.isArray(a[k])) a[k] = [a[k][0] + dx, a[k][1] + dy]; });
    if (Array.isArray(a.via)) a.via = a.via.map(function (p) { return [p[0] + dx, p[1] + dy]; });
  }
  /** One op on the local board. Returns the ids to draw again. */
  function applyLocal(op) {
    var out = [], it;
    if (op.op === "add") {
      // as the server does it: an item with `at` goes back to that place in the z-order (in rising order), the rest on top
      var spots = [];
      (op.items || []).forEach(function (raw) {
        if (!raw || byId[raw.id] || items.length >= 800) return;
        var c = clone(raw), at = c.at;
        delete c.at;
        byId[c.id] = c; out.push(c.id);
        if (typeof at === "number") spots.push([at, spots.length, c]); else items.push(c);
      });
      spots.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).forEach(function (s) { items.splice(Math.min(s[0], items.length), 0, s[2]); });
      index();
    } else if (op.op === "set") {
      it = byId[op.id];
      if (!it) return out;
      for (var k in op) { if (k === "op" || k === "id" || k === "with") continue; if (op[k] === null) delete it[k]; else it[k] = clone(op[k]); }
      if (it.type === "arrow") aIdx = null;
      out.push(it.id);
    } else if (op.op === "move") {
      (op.ids || []).forEach(function (id) {
        var m = byId[id];
        if (!m) return;
        if (m.type === "arrow") shiftArrow(m, op.dx, op.dy); else { m.x += op.dx; m.y += op.dy; }
        out.push(id);
      });
    } else if (op.op === "delete") {
      var gone = {};
      (op.ids || []).forEach(function (id) { if (byId[id]) { gone[id] = 1; arrowsAt(id).forEach(function (a) { gone[a.id] = 1; }); } });
      items = items.filter(function (x) { return !gone[x.id]; });
      Object.keys(gone).forEach(function (id) { if (ed && ed.id === id) dropEdit(); if (interact === id) interact = null; dropNode(id); delete fresh[id]; });
      sel = sel.filter(function (id) { return !gone[id]; });
      index(); reroute();
    } else if (op.op === "order") {
      var set = {};                                   // as the server does it: the named items keep their order among themselves
      (op.ids || []).forEach(function (id) { set[id] = 1; });
      var rest = items.filter(function (x) { return !set[x.id]; }), mv = items.filter(function (x) { return set[x.id]; });
      items = op.to === "back" ? mv.concat(rest) : rest.concat(mv);
      index(); zSync();
    } else if (op.op === "state") {
      it = byId[op.id];
      if (it) { it.state = clone(op.state); out.push(it.id); }
    } else if (op.op === "title") { title = String(op.title || ""); }
    return out;
  }
  function ownIds(ops) {
    ops.forEach(function (op) { if (op.id) own(op.id); (op.ids || []).forEach(own); (op.items || []).forEach(function (x) { if (x && x.id) own(x.id); }); });
  }
  /** One step of the user: fwd is applied and sent, inv is what undo sends. `applied`: the board already shows it (a drag). */
  function doEdit(fwd, inv, applied) {
    if (!canEdit() || !fwd.length) return false;
    if (!applied) { var ids = []; fwd.forEach(function (op) { ids = ids.concat(applyLocal(op)); }); touched(ids); }
    if (inv) { undoS.push({ fwd: fwd, inv: inv }); if (undoS.length > 100) undoS.shift(); redoS = []; }
    queue(fwd);
    afterChange();
    return true;
  }
  function replay(ops) {
    var ids = [];
    ops.forEach(function (op) { ids = ids.concat(applyLocal(op)); });
    touched(ids);
    sel = sel.filter(function (id) { return byId[id]; });
    queue(ops);
    afterChange();
    return ids;
  }
  function undo() { endEdit(); var e = undoS.pop(); if (!e || !canEdit()) return; var ids = replay(e.inv); redoS.push(e); pickAfter(ids); undoSync(); }
  function redo() { endEdit(); var e = redoS.pop(); if (!e || !canEdit()) return; var ids = replay(e.fwd); undoS.push(e); pickAfter(ids); undoSync(); }
  function pickAfter(ids) { ids = ids.filter(function (id) { return byId[id]; }); if (ids.length && ids.length <= 40) { sel = ids; selChanged(); } }
  /** After the board changed: draw, handles, toolbar, undo buttons. */
  function afterChange() { reroute(); cull(); drawCtx(); drawUi(); undoSync(); sendView(); }
  function queue(ops) {
    if (!live || !ops.length) return;
    ownIds(ops);
    pend.push.apply(pend, clone(ops));
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 120);
  }
  var PLAIN_OPS = { set: 1, move: 1, order: 1, state: 1, title: 1 };
  function flush() {
    clearTimeout(flushTimer); flushTimer = null;
    if (!pend.length) return chain;
    var ops = pend; pend = [];
    inflight++;
    chain = chain.then(function () {
      var base = rev;
      return hm.board.edit(ops, base).then(function (r) {
        if (r && (r.ok === false || (r.conflict && r.conflict.length))) { var err = new Error(r.error || r.message || T.failed); err.conflict = r.conflict; throw err; }
        // Our own op alone moved the board one step on: nothing to read. Anything else (an add the
        // server may have sized, a delete that took arrows along, someone else's change between) is read.
        if (r && r.rev === base + 1 && !needPull && ops.every(function (o) { return PLAIN_OPS[o.op]; })) rev = r.rev;
        else needPull = true;
      });
    }).catch(function (e) {
      // Refused as a whole. On a conflict only the items Hermes changed meanwhile lose this change: the
      // board is read again and the rest of what was sent (and what was waiting) is done again on top.
      var bad = {}, keep = [];
      if (e && Array.isArray(e.conflict) && e.conflict.length) {
        e.conflict.forEach(function (id) { bad[id] = 1; });
        keep = salvage(ops.concat(pend), bad);
        undoS = undoS.filter(function (s) { return !names(s, bad); }); redoS = redoS.filter(function (s) { return !names(s, bad); });
      } else { undoS = []; redoS = []; }
      pend = [];
      kit.toast(e && e.conflict ? T.conflict : (e && e.message ? String(e.message) : T.failed));
      return readAll().then(function () {
        if (!keep.length || !canEdit()) return;
        var ids = [];
        keep.forEach(function (op) { ids = ids.concat(applyLocal(op)); });
        touched(ids); queue(keep); afterChange();
      });
    }).then(function () {
      inflight--;
      if (!inflight && !pend.length && needPull) pull();
      undoSync(); sendView();
    });
    return chain;
  }
  /** The ops of a refused batch without what they did to the `bad` items (a tidy goes whole: it lays out together). */
  function salvage(ops, bad) {
    var out = [];
    ops.forEach(function (op) {
      if (op.op === "tidy") return;
      if (op.id != null) { if (!bad[op.id]) out.push(op); return; }
      if (Array.isArray(op.ids)) {
        var ids = op.ids.filter(function (id) { return !bad[id]; });
        if (ids.length) { var c = clone(op); c.ids = ids; out.push(c); }
        return;
      }
      out.push(op);                                     // add, title
    });
    return out;
  }
  /** Does an undo step touch any of these items? */
  function names(step, set) {
    return step.fwd.concat(step.inv).some(function (op) {
      return set[op.id] || (op.ids || []).some(function (id) { return set[id]; }) || (op.items || []).some(function (x) { return x && set[x.id]; });
    });
  }
  function busy() { return inflight > 0 || pend.length > 0 || !!g || !!nudgeAcc; }
  /** What changed on the server since our revision (Hermes, another window, our own adds as the server stored them). */
  function pull() {
    if (!live || preview) return;
    if (pulling && Date.now() - pulling > 20000) pulling = false;   // a read that never came back does not stop the next
    if (busy() || pulling) { needPull = true; return; }
    pulling = Date.now(); needPull = false;
    hm.board.read(rev).then(function (r) {
      pulling = false;
      if (!r || r.ok === false || preview) return;
      if (typeof r.hermes_active === "boolean") setHermes(r.hermes_active, r.hermes_left);
      if (busy()) { needPull = true; return; }     // the board moved on here meanwhile: read again when it is quiet
      if (r.since === "unavailable") return readAll();
      if (Array.isArray(r.items) && !r.changed) return adopt(r);
      merge(r);
    }, function () { pulling = false; }).then(function () { if (needPull && !busy()) pull(); });
  }
  function readAll() {
    return hm.board.read(null).then(function (r) {
      if (!r || r.ok === false || !Array.isArray(r.items)) return;
      if (typeof r.hermes_active === "boolean") setHermes(r.hermes_active, r.hermes_left);
      adopt(r);
    }).catch(function () {});
  }
  /** A whole board from the server: taken as a change list against what is here. */
  function adopt(r) {
    var next = normItems(r.items), keep = {}, ch = [];
    next.forEach(function (it) { keep[it.id] = 1; if (!byId[it.id] || !same(byId[it.id], it)) ch.push(it); });
    merge({ rev: r.rev, title: r.title, changed: ch, removed: items.filter(function (it) { return !keep[it.id] && !fresh[it.id]; }).map(function (it) { return it.id; }),
      order: next.map(function (it) { return it.id; }) });
  }
  function merge(r) {
    var lit = [], now = Date.now(), any = false;
    (r.removed || []).forEach(function (id) {
      if (!byId[id] || fresh[id]) return;
      if (ed && ed.id === id) dropEdit();
      if (interact === id) interact = null;
      items = items.filter(function (x) { return x.id !== id; });
      delete byId[id]; dropNode(id); any = true;
    });
    normItems(r.changed).forEach(function (nw) {
      var old = byId[nw.id];
      if (old && ed && ed.id === nw.id) {            // being typed in: the typing stays, the rest follows
        if (ed.kind === "text") { nw.text = old.text; if (old.h != null && nw.type !== "text") nw.h = Math.max(old.h, nw.h || 0); }
        else if (ed.kind === "cell") {
          // the cell being typed in stays while the table still has it (the server's copy of a table
          // just placed differs from ours only in what it worked out); the typing is put into its rows
          if (!cellStays(nw.rows, ed.r, ed.c)) dropEdit();
        }
        else if (ed.kind === "label") nw.label = old.label;
      }
      if (old && same(old, nw)) return;
      if (old) items[items.indexOf(old)] = nw; else items.push(nw);
      byId[nw.id] = nw; any = true;
      nd(nw.id).b = null; nd(nw.id).r = null; nd(nw.id).dirty = true;
      if (!(now - (ownAt[nw.id] || 0) < 5000)) lit.push(nw.id);
    });
    if (Array.isArray(r.order)) {
      var at = {}, n = r.order.length;
      r.order.forEach(function (id, i) { at[id] = i; });
      var sorted = items.slice().sort(function (a, b) { return (at[a.id] != null ? at[a.id] : n) - (at[b.id] != null ? at[b.id] : n); });
      if (sorted.some(function (x, i) { return x !== items[i]; })) { items = sorted; any = true; }
    }
    if (typeof r.title === "string" && r.title !== title) { title = r.title; view.setAttribute("aria-label", T.board + ": " + title); }
    if (typeof r.rev === "number") rev = r.rev;
    if (!any) return;
    index(); zSync();
    sel = sel.filter(function (id) { return byId[id]; });
    undoS = undoS.filter(usable); redoS = redoS.filter(usable);
    afterChange();
    if (lit.length) glow(lit);
  }
  /** An undo step still makes sense only while the items it names exist (or the step itself brings them back). */
  function usable(e) {
    var ops = e.fwd.concat(e.inv), made = {};
    ops.forEach(function (op) { if (op.op === "add") (op.items || []).forEach(function (x) { made[x.id] = 1; }); });
    return ops.every(function (op) {
      if (op.op === "add") return true;
      return (op.id ? [op.id] : op.ids || []).every(function (id) { return byId[id] || made[id]; });
    });
  }
  var pill = h("div", { "class": "bd-pill", role: "status", hidden: true, text: T.working });
  // The pill goes when Hermes' window runs out (hermes_left seconds, else the server's 5 minutes) even
  // if no read comes then (a read that hangs, a hidden page); every read sets it afresh.
  var hermesTimer = null;
  function setHermes(on, left) {
    hermesActive = !!on; pill.hidden = !on || ro;
    clearTimeout(hermesTimer);
    if (on) hermesTimer = setTimeout(function () { setHermes(false); }, (left > 0 ? left : 300) * 1000 + 500);
  }
  /** set ops for several items with their inverses: make(it) gives the fields to change (null removes one). */
  function patch(ids, make) {
    var fwd = [], inv = [];
    ids.forEach(function (id) {
      var it = byId[id], p = it && make(it);
      if (!p) return;
      var f = { op: "set", id: id }, i = { op: "set", id: id }, any = false;
      for (var k in p) {
        var old = it[k] === undefined ? null : it[k];
        if (same(old, p[k])) continue;
        f[k] = p[k]; i[k] = clone(old); any = true;
      }
      if (any) { fwd.push(f); inv.unshift(i); }
    });
    return doEdit(fwd, inv);
  }

  // ------------------------------------------------------------------ selection
  function selItems() { return sel.map(function (id) { return byId[id]; }).filter(Boolean); }
  function mates(id) {
    var it = byId[id];
    if (!it || !it.group) return [id];
    return items.filter(function (o) { return o.group === it.group; }).map(function (o) { return o.id; });
  }
  function setSel(ids) {
    var seen = {};
    if (nudgeAcc) nudgeEnd();
    sel = ids.filter(function (id) { if (!byId[id] || seen[id]) return false; seen[id] = 1; return true; });
    selChanged();
  }
  function selChanged() {
    world.querySelectorAll(".bd-sel").forEach(function (el) { el.classList.remove("bd-sel"); });
    sel.forEach(function (id) { var n = N[id]; if (n && n.el) n.el.classList.add("bd-sel"); });
    if (interact && sel.indexOf(interact) < 0) setInteract(null);
    drawCtx(); drawUi(); sendView();
  }
  function nameOf(it) {
    var t = { box: T.tBox, note: T.tNote, text: T.tText, section: T.tSection, arrow: T.tArrow, pen: T.tPen, table: T.tTable, image: T.tImage, drawing: T.tDrawing, embed: T.tEmbed }[it.type] || "";
    var w = it.type === "arrow" ? it.label : it.type === "embed" ? it.title : it.type === "table" ? (it.rows && it.rows[0] || []).join(", ") : it.text;
    return t + (w ? ": " + plain(String(w)).slice(0, 80) : "");
  }
  function announce() {
    var l = selItems();
    liveEl.textContent = !l.length ? T.nothing : l.length === 1 ? nameOf(l[0]) + (l[0].locked ? " (" + T.lock + ")" : "") : fill(T.nItems, { n: l.length });
  }
  function scr(b) { return { x: b.x * cam.z + cam.x, y: b.y * cam.z + cam.y, w: b.w * cam.z, h: b.h * cam.z }; }
  function boxDiv(b, cls) { var d = h("div", { "class": cls }); d.style.cssText = "left:" + b.x + "px;top:" + b.y + "px;width:" + b.w + "px;height:" + b.h + "px"; return d; }
  function knob(cls, x, y, attr, val, title2) {
    var d = h("div", { "class": cls, title: title2 || null });
    d.setAttribute(attr, val);
    d.style.cssText = "left:" + x + "px;top:" + y + "px";
    return d;
  }
  /** The screen layer: outlines of the selection, resize handles, connector dots, the arrow's handles. */
  function drawUi() {
    uiSel.textContent = "";
    if (ro) { ctx.hidden = true; return; }
    var list = selItems(), boxes = [], quiet = g && (g.type === "move" || g.type === "marquee" || g.type === "pen");
    list.forEach(function (it) {
      var b = scr(bb(it));
      boxes.push(b);
      if (it.type !== "arrow" && list.length <= 80) uiSel.appendChild(boxDiv(b, "bd-selbox" + (it.locked ? " bd-lk" : "")));
    });
    var all = union(boxes);
    if (list.length > 1 && all) uiSel.appendChild(boxDiv(all, "bd-selbox bd-union"));
    var one = list.length === 1 && !list[0].locked && !quiet && tool === "select" ? list[0] : null;
    if (one) {
      var b = boxes[0], cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      if (one.type === "arrow") {
        var r = routeOf(one), pts = r.pts || [], m = r.mid || r.labelAt, s = function (p) { return { x: p[0] * cam.z + cam.x, y: p[1] * cam.z + cam.y }; };
        if (pts.length > 1) {
          var a = s(pts[0]), z = s(pts[pts.length - 1]);
          uiSel.append(knob("bd-h bd-ah", a.x, a.y, "data-end", "from"), knob("bd-h bd-ah", z.x, z.y, "data-end", "to"));
          if (m) uiSel.appendChild(knob("bd-h bd-ah bd-amid", m.x * cam.z + cam.x, m.y * cam.z + cam.y, "data-end", "mid"));
        }
      } else if (b.w < 26 || (b.h < 26 && one.type !== "text")) {
        // too small on screen for handles: they would cover it, and it could not be picked up to move
      } else if (one.type === "text") {
        uiSel.append(knob("bd-h bd-hside", b.x - 7, cy, "data-h", "w"), knob("bd-h bd-hside", b.x + b.w + 7, cy, "data-h", "e"));
      } else if (one.type === "table") {
        if (!ed) {
          var pc = h("button", { type: "button", "class": "bd-tplus bd-nop", title: T.addCol, "aria-label": T.addCol, html: kit.icon("plus"), onclick: function () { tableAdd(one.id, "col"); } });
          var pr = h("button", { type: "button", "class": "bd-tplus bd-nop", title: T.addRow, "aria-label": T.addRow, html: kit.icon("plus"), onclick: function () { tableAdd(one.id, "row"); } });
          pc.style.cssText = "left:" + (b.x + b.w + 16) + "px;top:" + cy + "px"; pr.style.cssText = "left:" + cx + "px;top:" + (b.y + b.h + 16) + "px";
          uiSel.append(pc, pr);
        }
      } else {
        uiSel.append(knob("bd-h", b.x, b.y, "data-h", "nw"), knob("bd-h", b.x + b.w, b.y, "data-h", "ne"),
          knob("bd-h", b.x + b.w, b.y + b.h, "data-h", "se"), knob("bd-h", b.x, b.y + b.h, "data-h", "sw"));
      }
      if (DOTS[one.type] && !(g && g.type !== "dot") && !ed && items.length < 799) {
        var o = one.type === "text" ? 28 : 18, far = one.type === "table" ? 44 : o;    // a table's + buttons sit between it and its far dots
        uiSel.append(knob("bd-dot", cx, b.y - 18, "data-side", "top"), knob("bd-dot", b.x - o, cy, "data-side", "left"),
          knob("bd-dot", b.x + b.w + far, cy, "data-side", "right"), knob("bd-dot", cx, b.y + b.h + (one.type === "table" ? 44 : 18), "data-side", "bottom"));
      }
    }
    posCtx(all);
  }
  /** How much of the other items (on screen) a toolbar at r would cover: blocks whole, a section by its title strip. */
  function covered(r) {
    var mine = {}, area = 0;
    sel.forEach(function (id) { mine[id] = 1; });
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (mine[it.id] || it.type === "arrow" || it.type === "pen") continue;
      var b = scr(bb(it));
      if (it.type === "section") b = { x: b.x, y: b.y - 26, w: b.w, h: 26 };
      var ow = Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x), oh = Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y);
      if (ow > 0 && oh > 0) area += ow * oh;
    }
    return area;
  }
  var ctxFitAt = -1;                           // the width the toolbar was last fitted to
  function posCtx(all) {
    var show = !!all && !!ctx.firstChild && !g && tool === "select" && !(all.x > vw || all.y > vh || all.x + all.w < 0 || all.y + all.h < 0);
    ctx.hidden = !show;
    if (!show) return;
    if (ctxFitAt !== vw) { if (ctxFitAt >= 0) drawCtx(); fitCtx(); }
    var w = ctx.offsetWidth, hh = ctx.offsetHeight, one = sel.length === 1 && byId[sel[0]];
    var up = 30 + (one && one.type === "section" ? 22 : one && one.type === "embed" ? 26 : 0), down = 34 + (one && one.type === "table" ? 30 : 0);
    var x = clamp(all.x + all.w / 2 - w / 2, 8, Math.max(8, vw - w - 8)), lo = 8, hi = vh - hh - 70;   // the tools pill holds the bottom
    // Above the selection unless that covers more of its neighbours than below does; never off the view.
    var best = null;
    [all.y - hh - up, all.y + all.h + down].forEach(function (y, k) {
      if (y < lo || y > hi) return;
      var c = covered({ x: x, y: y, w: w, h: hh }) + k * 0.5;
      if (!best || c < best.c) best = { y: y, c: c };
    });
    ctx.style.left = x + "px";
    ctx.style.top = (best ? best.y : Math.max(lo, Math.min(all.y + 8, hi))) + "px";
  }
  /** Too wide for the view (a phone): the least needed controls move into "More", none scrolls out of sight. */
  function fitCtx() {
    ctxFitAt = vw;
    var room = vw - 16, list = Array.prototype.slice.call(ctx.children), moved = [];
    while (ctx.scrollWidth > room + 0.5) {
      var cands = list.filter(function (b) { return b._pri && b.parentNode === ctx; });
      if (!cands.length) break;
      var b = cands.reduce(function (a, c) { return c._pri > a._pri ? c : a; });
      b.remove(); moved.push(b);
      var kids = Array.prototype.slice.call(ctx.children);            // no separator left at an end or next to another
      kids.forEach(function (k, i) { if (k.classList.contains("bd-sep") && (!i || i === kids.length - 1 || (kids[i + 1] && kids[i + 1].classList.contains("bd-sep")))) k.remove(); });
    }
    ctxExtra = moved.sort(function (a, c) { return a._ord - c._ord; }).map(function (b) { return b._entry; });
  }

  // ------------------------------------------------------------------ pointer: pan, select, move, resize, connect, draw, place
  var tool = "select", pointers = {}, spaceDown = false, lastPt = null, lastClick = null, mvEv = null, mvRaf = 0;
  var mq = h("div", { "class": "bd-marquee", hidden: true }), ghost = h("div", { "class": "bd-ghost", hidden: true });
  ui.append(mq, ghost);
  var PLACING = { text: 1, section: 1, sticky: 1, shape: 1 }, DRAG = 8;   // DRAG: screen px a pointer moves before a press is a drag
  function dist(a, e) { return Math.abs(e.clientX - a.x) + Math.abs(e.clientY - a.y); }
  function viewWorld() { return { x: -cam.x / cam.z, y: -cam.y / cam.z, w: vw / cam.z, h: vh / cam.z }; }
  function guides(list) {
    (list || []).forEach(function (l) { draftSvg.appendChild(svgEl("line", { "class": "bd-guide", x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 })); });
  }
  function clearGuides() { draftSvg.querySelectorAll(".bd-guide").forEach(function (n) { n.remove(); }); }
  function draft(d, colour, width) {
    var p = draftSvg.querySelector(".bd-dpath");
    if (d == null) { if (p) p.remove(); return; }
    if (!p) p = draftSvg.appendChild(svgEl("path", { "class": "bd-dpath" }));
    p.setAttribute("d", d);
    p.style.stroke = colour || ""; p.style.strokeWidth = width || "";
  }
  function target(it) {
    world.querySelectorAll(".bd-target").forEach(function (el) { el.classList.remove("bd-target"); });
    var n = it && N[it.id];
    if (n && n.el) n.el.classList.add("bd-target");
  }
  /** The topmost item an arrow could attach to at a point (blocks before the sections behind them). */
  function dropTarget(p, skip) {
    var tol = 4 / cam.z, sec = null;
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      if (it.id === skip || it.type === "arrow" || it.type === "pen") continue;
      var b = bb(it);
      if (p.x < b.x - tol || p.x > b.x + b.w + tol || p.y < b.y - tol || p.y > b.y + b.h + tol) continue;
      if (it.type === "section") { sec = sec || it; continue; }
      var hit = true;
      try { hit = !!G.hit(it, p.x, p.y, tol, byId); } catch (e) {}
      if (hit) return it;
    }
    return sec;
  }
  function onDown(e) {
    var t = e.target;
    if (t.closest(".bd-ctx,.bd-nop")) return;
    measureView();
    if (ed && t.closest(".bd-edit")) return;
    if (interact) { var ie = t.closest(".bd-it"); if (ie && ie.getAttribute("data-id") === interact) return; setInteract(null); }
    if (ed) endEdit();
    closePop();
    if (e.pointerType === "touch") {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pointers).length === 2) { cancelGesture(); startPinch(); return; }
    }
    if (e.button === 2) return;
    e.preventDefault();
    view.focus({ preventScroll: true });
    try { view.setPointerCapture(e.pointerId); } catch (x) {}
    var p = toWorld(e), s0 = { x: e.clientX, y: e.clientY };
    if (e.button === 1 || tool === "hand" || spaceDown || ro) { g = { type: "pan", s0: s0, cx: cam.x, cy: cam.y }; view.classList.add("bd-grabbing"); return; }
    if (e.button !== 0) return;
    if (tool === "select") return downSelect(e, t, p, s0);
    if (tool === "draw") {
      if (prefs.draw === "pen") g = { type: "pen", s0: s0, pts: [p.x, p.y] };
      else { var ft = dropTarget(p); g = { type: "arrow", s0: s0, p0: p, from: ft ? ft.id : [rnd(p.x), rnd(p.y)], to: null }; }
      return;
    }
    g = { type: "place", s0: s0, p0: p };
    ghost.hidden = true;
  }
  function downSelect(e, t, p, s0) {
    var one = sel.length === 1 ? byId[sel[0]] : null, k = t.closest("[data-h],[data-side],[data-end]");
    if (k && one && !one.locked) {
      if (k.hasAttribute("data-h")) g = { type: "resize", s0: s0, p0: p, it: one, hd: k.getAttribute("data-h"), orig: clone(one), b0: clone(bb(one)) };
      else if (k.hasAttribute("data-side")) g = { type: "dot", s0: s0, p0: p, it: one, side: k.getAttribute("data-side"), to: null };
      else g = { type: "aend", s0: s0, p0: p, a: one, end: k.getAttribute("data-end"), orig: clone(one), moved: false };
      return;
    }
    var el = t.closest(".bd-it"), id = el && el.getAttribute("data-id"), it = id && byId[id];
    if (it) {
      var was = sel.indexOf(id) >= 0, m = mates(id);
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        setSel(was ? sel.filter(function (x) { return m.indexOf(x) < 0; }) : sel.concat(m));
        g = { type: "none", s0: s0 };
        return;
      }
      if (!was) setSel(m);
      g = { type: "press", s0: s0, p0: p, id: id, t: t, was: was };
      announce();
      return;
    }
    if (e.pointerType === "touch") { g = { type: "pan", s0: s0, cx: cam.x, cy: cam.y, tap: true }; return; }
    g = { type: "marquee", s0: s0, p0: p, base: e.shiftKey ? sel.slice() : [] };
    if (!e.shiftKey && sel.length) setSel([]);
  }
  function onMove(e) {
    lastPt = { x: e.clientX, y: e.clientY };
    if (e.pointerType === "touch" && pointers[e.pointerId]) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (g && g.type === "pinch") return pinchMove();
    }
    if (!g) { if (PLACING[tool] && !ro) ghostAt(e); return; }
    if (g.type === "pen") { var p = toWorld(e); g.pts.push(p.x, p.y); }
    mvEv = e;
    if (!mvRaf) mvRaf = requestAnimationFrame(function () { mvRaf = 0; if (mvEv && g) step(mvEv); });
  }
  function step(e) {
    var p = toWorld(e), dxs = e.clientX - g.s0.x, dys = e.clientY - g.s0.y, t;
    switch (g.type) {
      case "pan": setCam(g.cx + dxs, g.cy + dys, cam.z); break;
      case "press": if (Math.abs(dxs) + Math.abs(dys) > 4) { startMove(); if (g.type === "move") moveStep(p, e); } break;
      case "move": moveStep(p, e); break;
      case "resize": resizeStep(p, e); break;
      case "marquee":
        mq.hidden = false;
        mq.style.cssText = "left:" + (Math.min(e.clientX, g.s0.x) - vrc.left) + "px;top:" + (Math.min(e.clientY, g.s0.y) - vrc.top) + "px;width:" + Math.abs(dxs) + "px;height:" + Math.abs(dys) + "px";
        break;
      case "dot":
        if (!g.far && dist(g.s0, e) <= DRAG) break;        // a dot only clicked makes nothing
        g.far = true;
        t = dropTarget(p, g.it.id); g.to = t; target(t);
        try {
          var df = { rect: bb(g.it) }, dt = t ? { rect: bb(t) } : { pt: [p.x, p.y] };
          draft(G.route(df, dt, { fromSide: g.side, obstacles: obstaclesFor(df, dt, [g.it.id, t && t.id]) }).d);
        } catch (x) {}
        break;
      case "arrow":
        t = dropTarget(p, typeof g.from === "string" ? g.from : null); g.to = t; target(t);
        try {
          var af = typeof g.from === "string" ? { rect: bb(byId[g.from]) } : { pt: g.from }, at2 = t ? { rect: bb(t) } : { pt: [p.x, p.y] };
          draft(G.route(af, at2, { obstacles: obstaclesFor(af, at2, [g.from, t && t.id]) }).d, strokeOf(prefs.penColor));
        } catch (x) {}
        break;
      case "aend": aendStep(p, e); break;
      case "pen":
        t = "M" + g.pts[0] + " " + g.pts[1];
        for (var i = 2; i < g.pts.length; i += 2) t += "L" + g.pts[i] + " " + g.pts[i + 1];
        draft(t, strokeOf(prefs.penColor), prefs.penWidth);
        break;
      case "place":
        if (Math.abs(dxs) + Math.abs(dys) > 10) {
          mq.hidden = false;
          mq.style.cssText = "left:" + (Math.min(e.clientX, g.s0.x) - vrc.left) + "px;top:" + (Math.min(e.clientY, g.s0.y) - vrc.top) + "px;width:" + Math.abs(dxs) + "px;height:" + Math.abs(dys) + "px";
        }
        break;
    }
  }
  function onUp(e) {
    delete pointers[e.pointerId];
    try { view.releasePointerCapture(e.pointerId); } catch (x) {}
    if (!g) return;
    if (g.type === "pinch") { if (!Object.keys(pointers).length) g = null; return; }
    if (mvRaf) { cancelAnimationFrame(mvRaf); mvRaf = 0; }
    var cancel = e.type === "pointercancel";
    if (!cancel && g.type !== "press" && g.type !== "none") step(e);
    var gg = g, p = toWorld(e);
    g = null;
    view.classList.remove("bd-grabbing");
    clearGuides(); draft(null); target(null); mq.hidden = true;
    if (cancel) undoGesture(gg); else finish(gg, p, e);
    drawUi();
    if (needPull && !busy()) pull();
  }
  function cancelGesture() {
    if (!g) return;
    var gg = g;
    g = null;
    if (mvRaf) { cancelAnimationFrame(mvRaf); mvRaf = 0; }
    view.classList.remove("bd-grabbing");
    clearGuides(); draft(null); target(null); mq.hidden = true;
    undoGesture(gg);
    drawUi();
  }
  /** A drag given up (Esc, a second finger): what it moved goes back. */
  function undoGesture(gg) {
    if (gg.type === "move") {
      gg.ids.forEach(function (id) { var it = byId[id], o = gg.orig[id]; if (!it) return; if (it.type === "arrow") { it.from = o.from; it.to = o.to; if (o.via) it.via = o.via; } else { it.x = o.x; it.y = o.y; } });
      touched(gg.ids); afterChange();
    } else if (gg.type === "resize" || gg.type === "aend") {
      var it = gg.it || gg.a, i = items.indexOf(it);
      if (i >= 0) { items[i] = gg.orig; byId[gg.orig.id] = gg.orig; aIdx = null; inval(gg.orig.id); afterChange(); }
    }
  }
  function isDouble(key, e) {
    var now = e.timeStamp, d = lastClick && lastClick.key === key && now - lastClick.t < 450 && dist(lastClick, e) < 8;
    lastClick = d ? null : { key: key, t: now, x: e.clientX, y: e.clientY };
    return d;
  }
  function finish(gg, p, e) {
    var it, ids;
    switch (gg.type) {
      case "pan":
        if (gg.tap && dist(gg.s0, e) < 6 && !ro) { if (sel.length) setSel([]); }
        break;
      case "press":
        it = byId[gg.id];
        if (!it) break;
        if (isDouble("i:" + gg.id, e)) { openItem(it, gg.t); break; }
        if (gg.was && sel.length > mates(gg.id).length) setSel(mates(gg.id));
        else if (gg.was && gg.t.closest && gg.t.closest("a[href]")) { try { window.open(gg.t.closest("a[href]").href, "_blank", "noopener"); } catch (x) {} }
        break;
      case "move":
        if (gg.dx || gg.dy) doEdit([{ op: "move", ids: gg.ids, dx: gg.dx, dy: gg.dy }], [{ op: "move", ids: gg.ids, dx: -gg.dx, dy: -gg.dy }], true);
        else drawCtx();
        break;
      case "resize":
        // a handle only clicked counts as a click on its item (a section's title sits right at its corner handle)
        if (dist(gg.s0, e) < 4) { if (isDouble("i:" + gg.it.id, e)) openItem(gg.it, null); }
        else finishResize(gg);
        break;
      case "marquee":
        if (dist(gg.s0, e) < 5) {
          if (isDouble("empty", e) && canEdit()) addText(p);
          break;
        }
        var r = { x: Math.min(p.x, gg.p0.x), y: Math.min(p.y, gg.p0.y), w: Math.abs(p.x - gg.p0.x), h: Math.abs(p.y - gg.p0.y) };
        ids = gg.base.slice();
        items.forEach(function (o) {
          if (o.locked) return;
          var b = bb(o), inside = b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
          if (o.type === "arrow") inside = (routeOf(o).pts || []).every(function (q) { return q[0] >= r.x && q[1] >= r.y && q[0] <= r.x + r.w && q[1] <= r.y + r.h; });   // its route as drawn (on its lane)
          else try { inside = !!G.inRect(o, r, true, byId); } catch (x) {}
          if (inside) ids = ids.concat(mates(o.id));
        });
        setSel(ids);
        announce();
        break;
      case "dot":
        // only a drag past DRAG makes something: an arrow to what it was let go on, else a new block there
        if (!gg.far && dist(gg.s0, e) <= DRAG) break;
        if (gg.to) addArrow({ from: gg.it.id, to: gg.to.id, fromSide: gg.side }, true);
        else placeholder(gg.it, gg.side, p);
        break;
      case "arrow":
        if (dist(gg.s0, e) < 8) break;
        addArrow({ from: gg.from, to: gg.to && gg.to.id !== gg.from ? gg.to.id : [rnd(p.x), rnd(p.y)], color: prefs.penColor !== "ink" ? prefs.penColor : undefined }, false);
        break;
      case "aend": finishAend(gg, e); break;
      case "pen": finishPen(gg); break;
      case "place": placeItem(gg, p, e); break;
    }
  }
  /** Double-click: type in it, use the embed, edit a cell or the arrow's label. */
  function openItem(it, t) {
    if (!canEdit()) return;
    if (it.locked) return kit.toast(T.locked);
    if (it.type === "embed") return setInteract(it.id);
    if (it.type === "table") { var c = t && t.closest && t.closest("[data-r]"); return editCell(it.id, c ? +c.getAttribute("data-r") : 0, c ? +c.getAttribute("data-c") : 0); }
    if (it.type === "arrow") return editLabel(it.id);
    if (TEXTY[it.type]) startEdit(it.id, {});
  }

  // moving: the selection, its group mates, the members of its sections, and the arrows that go along
  function moveSet(base) {
    var set = {}, out = [];
    function add(id) {
      var it = byId[id];
      if (!it || it.locked || set[id]) return;
      set[id] = 1; out.push(id);
      if (it.group) items.forEach(function (o) { if (o.group === it.group) add(o.id); });
      if (it.type === "section") {
        var ms = []; try { ms = G.members(it, items) || []; } catch (e) {}
        ms.forEach(function (m) { add(typeof m === "string" ? m : m && m.id); });
      }
    }
    base.forEach(add);
    items.forEach(function (a) {   // an arrow between two moving items takes its waypoints along
      if (a.type !== "arrow" || set[a.id] || a.locked || !a.via) return;
      if (typeof a.from === "string" && set[a.from] && typeof a.to === "string" && set[a.to]) { set[a.id] = 1; out.push(a.id); }
    });
    return out;
  }
  function startMove() {
    var p0 = g.p0, s0 = g.s0, ids = canEdit() ? moveSet(sel) : [];
    if (!ids.length) { if (canEdit() && selItems().some(function (it) { return it.locked; })) kit.toast(T.locked); g = { type: "none", s0: s0 }; return; }
    var set = {}, orig = {}, att = {}, others = [], vr = viewWorld();
    ids.forEach(function (id) {
      var it = byId[id];
      set[id] = 1;
      orig[id] = it.type === "arrow" ? { from: clone(it.from), to: clone(it.to), via: clone(it.via) } : { x: it.x, y: it.y };
    });
    ids.forEach(function (id) { arrowsAt(id).forEach(function (a) { if (!set[a.id]) att[a.id] = a; }); });
    items.forEach(function (it) {
      if (set[it.id] || it.type === "arrow" || it.type === "pen" || others.length >= 150) return;
      var b = bb(it);
      if (cross(b, vr)) others.push(b);
    });
    var rect0 = union(ids.map(function (id) { return byId[id]; }).filter(function (it) { return it.type !== "arrow"; }).map(bb));
    g = { type: "move", s0: s0, p0: p0, ids: ids, orig: orig, rect0: rect0, others: others, att: Object.keys(att).map(function (k) { return att[k]; }), dx: 0, dy: 0 };
    ctx.hidden = true;
  }
  function moveStep(p, e) {
    var dx = p.x - g.p0.x, dy = p.y - g.p0.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    clearGuides();
    if (!e.altKey && g.rect0) {
      try {
        var s = G.snap({ x: g.rect0.x + dx, y: g.rect0.y + dy, w: g.rect0.w, h: g.rect0.h }, g.others, 6 / cam.z);
        if (s) { dx += s.dx || 0; dy += s.dy || 0; guides(s.guides); }
      } catch (x) {}
    }
    dx = rnd(dx); dy = rnd(dy);
    if (dx === g.dx && dy === g.dy) return;
    g.dx = dx; g.dy = dy;
    g.ids.forEach(function (id) {
      var it = byId[id], o = g.orig[id];
      if (it.type === "arrow") { it.from = clone(o.from); it.to = clone(o.to); if (o.via) it.via = clone(o.via); shiftArrow(it, dx, dy); }
      else { it.x = o.x + dx; it.y = o.y + dy; }
      nd(id).b = null;
    });
    var lines = g.att.slice();
    g.ids.forEach(function (id) { var it = byId[id]; if (it.type === "arrow") lines.push(it); else place(it); });
    redrawMany(lines);
    drawUi();
  }
  function redrawNow(it) { redrawMany([it]); }
  /** Draw items again now (arrows that route afresh): all are marked stale first, so the arrows settle once. */
  function redrawMany(list) {
    list.forEach(function (it) { var n = nd(it.id); n.r = null; n.b = null; });
    list.forEach(function (it) { var n = nd(it.id); if (n.el && !n.off) draw(it); else n.dirty = true; });
  }

  function resizeStep(p, e) {
    if (!g.moved && dist(g.s0, e) < 4) return;
    g.moved = true;
    var it = g.it, o = g.b0, hd = g.hd, x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h, min = it.type === "section" ? 80 : 24;
    if (hd.indexOf("w") >= 0) x1 = Math.min(p.x, x2 - min);
    if (hd.indexOf("e") >= 0) x2 = Math.max(p.x, x1 + min);
    if (hd.indexOf("n") >= 0) y1 = Math.min(p.y, y2 - min);
    if (hd.indexOf("s") >= 0) y2 = Math.max(p.y, y1 + min);
    var w = rnd(x2 - x1), hh = rnd(y2 - y1);
    if (it.type === "text") { it.w = Math.max(40, w); it.x = hd === "w" ? rnd(x2 - it.w) : g.orig.x; }
    else if (it.type === "pen") {
      var sx = o.w > 0 ? w / o.w : 1, sy = o.h > 0 ? hh / o.h : 1, ox = o.x - g.orig.x, oy = o.y - g.orig.y;
      it.points = (g.orig.points || []).map(function (v, i) { return Math.round((i % 2 ? (v - oy) * sy : (v - ox) * sx) * 10) / 10; });
      it.x = rnd(x1); it.y = rnd(y1);
    } else {
      if ((it.type === "image" || it.type === "drawing" || e.shiftKey) && o.w > 0 && o.h > 0) {
        var k = Math.max(w / o.w, hh / o.h);
        w = rnd(o.w * k); hh = rnd(o.h * k);
        if (hd.indexOf("w") >= 0) x1 = x2 - w;
        if (hd.indexOf("n") >= 0) y1 = y2 - hh;
      }
      it.x = rnd(x1); it.y = rnd(y1); it.w = w; it.h = hh;
    }
    inval(it.id); draw(it);
    redrawMany(arrowsAt(it.id));
    drawUi();
  }
  /** A set op and its inverse from what a gesture changed on an item. */
  function diffOps(orig, it, keys) {
    var f = { op: "set", id: it.id }, i = { op: "set", id: it.id }, any = false;
    keys.forEach(function (k) {
      var a = orig[k] === undefined ? null : orig[k], b = it[k] === undefined ? null : it[k];
      if (same(a, b)) return;
      f[k] = clone(b); i[k] = clone(a); any = true;
    });
    return any ? [f, i] : null;
  }
  function finishResize(gg) {
    var d = diffOps(gg.orig, gg.it, ["x", "y", "w", "h", "points"]);
    if (d) doEdit([d[0]], [d[1]], true); else drawCtx();
  }
  function aendStep(p, e) {
    var a = g.a;
    if (!g.moved && dist(g.s0, e) < 4) return;
    g.moved = true;
    if (g.end === "mid") a.via = [[rnd(p.x), rnd(p.y)]];
    else {
      var other = g.end === "from" ? a.to : a.from, t = dropTarget(p, typeof other === "string" ? other : null);
      if (t && t.id === a.id) t = null;
      target(t);
      a[g.end] = t ? t.id : [rnd(p.x), rnd(p.y)];
      delete a[g.end + "Side"];
      aIdx = null;
    }
    redrawNow(a);
    drawUi();
  }
  function finishAend(gg, e) {
    var a = gg.a;
    if (!gg.moved) {
      if (gg.end === "mid" && isDouble("mid:" + a.id, e) && a.via) patch([a.id], function () { return { via: null }; });
      return;
    }
    var d = diffOps(gg.orig, a, ["from", "to", "fromSide", "toSide", "via"]);
    if (d) doEdit([d[0]], [d[1]], true);
  }
  function finishPen(gg) {
    var pts = gg.pts, tol = 0.8 / cam.z;
    if (pts.length < 4) pts = pts.concat([pts[0] + 0.1, pts[1] + 0.1]);
    try { var s = pts; do { s = G.simplify(pts, tol); tol *= 1.6; } while (s && s.length > 4000); if (s && s.length >= 4) pts = s; } catch (x) {}
    if (pts.length > 4000) pts = pts.slice(0, 4000);
    var x0 = Infinity, y0 = Infinity, i;
    for (i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); y0 = Math.min(y0, pts[i + 1]); }
    x0 = Math.floor(x0); y0 = Math.floor(y0);
    var it = { id: newId("p"), type: "pen", x: x0, y: y0, points: pts.map(function (v, j) { return Math.round((v - (j % 2 ? y0 : x0)) * 10) / 10; }) };
    if (prefs.penColor !== "ink") it.color = prefs.penColor;
    if (prefs.penWidth !== 3) it.width = prefs.penWidth;
    addItems([it], false);
  }
  function full() { if (items.length >= 800) { kit.toast(T.limit); return true; } return false; }
  /** New items as one undoable step. */
  function addItems(list, pick) {
    if (!canEdit() || full()) return false;
    list = list.slice(0, 800 - items.length);
    doEdit([{ op: "add", items: list }], [{ op: "delete", ids: list.map(function (x) { return x.id; }).reverse() }]);
    if (pick) setSel(list.map(function (x) { return x.id; }));
    return true;
  }
  function addArrow(a, pick) {
    var it = { id: newId("a"), type: "arrow", from: a.from, to: a.to };
    if (a.fromSide) it.fromSide = a.fromSide;
    if (a.color) it.color = a.color;
    addItems([it], pick);
  }
  /** A connector dot dragged out onto empty canvas: a block of the same kind there, joined by an arrow, ready to type in. */
  function placeholder(src, side, p) {
    if (!canEdit() || items.length >= 799) { if (items.length >= 799) kit.toast(T.limit); return; }
    var alike = src.type === "box" || src.type === "note", sb = bb(src), nw = alike ? { type: src.type } : { type: "box", kind: "rounded" };
    if (alike) ["kind", "color", "stroke", "hollow", "size", "align"].forEach(function (k) { if (src[k] != null) nw[k] = clone(src[k]); });
    nw.id = newId(); nw.text = "";
    nw.w = alike ? rnd(sb.w) : 180; nw.h = alike ? rnd(sb.h) : 64;
    var gap = 72, x, y;
    if (p) { x = side === "left" ? p.x - nw.w : side === "right" ? p.x : p.x - nw.w / 2; y = side === "top" ? p.y - nw.h : side === "bottom" ? p.y : p.y - nw.h / 2; }
    else { x = side === "left" ? sb.x - gap - nw.w : side === "right" ? sb.x + sb.w + gap : sb.x + sb.w / 2 - nw.w / 2; y = side === "top" ? sb.y - gap - nw.h : side === "bottom" ? sb.y + sb.h + gap : sb.y + sb.h / 2 - nw.h / 2; }
    nw.x = rnd(x); nw.y = rnd(y);
    var ar = { id: newId("a"), type: "arrow", from: src.id, to: nw.id, fromSide: side };
    doEdit([{ op: "add", items: [nw, ar] }], [{ op: "delete", ids: [ar.id, nw.id] }]);
    setSel([nw.id]);
    reveal(bb(nw));
    startEdit(nw.id, { ph: [nw.id, ar.id] });
  }
  var SHAPE_SIZE = { rect: [180, 80], rounded: [180, 80], pill: [180, 64], ellipse: [180, 110], diamond: [170, 120], hexagon: [190, 100], parallelogram: [190, 80],
    database: [140, 110], queue: [180, 90], document: [170, 110], cloud: [200, 120], person: [110, 130] };
  function proto(t) {
    if (t === "sticky") return { type: "note", w: 200, h: 200, text: "" };
    if (t === "section") return { type: "section", w: 520, h: 340, text: T.section };
    if (t === "text") return { type: "text", text: "" };
    if (prefs.shape === "table") return { type: "table", rows: [["", "", ""], ["", "", ""], ["", "", ""]] };
    var s = SHAPE_SIZE[prefs.shape] || [180, 100];
    return { type: "box", kind: prefs.shape, w: s[0], h: s[1], text: "" };
  }
  function protoSize(it) {
    if (it.type === "table") { try { var l = G.tableLayout(it); return { w: l.w, h: l.h }; } catch (e) { return { w: 240, h: 100 }; } }
    if (it.type === "text") return { w: 0, h: 0 };
    return { w: it.w, h: it.h };
  }
  function ghostAt(e) {
    var s = protoSize(proto(tool));
    if (!s.w) { ghost.hidden = true; return; }
    ghost.hidden = false;
    ghost.style.cssText = "left:" + (e.clientX - vrc.left - s.w * cam.z / 2) + "px;top:" + (e.clientY - vrc.top - s.h * cam.z / 2) + "px;width:" + s.w * cam.z + "px;height:" + s.h * cam.z + "px";
  }
  function addText(p) {
    if (full()) return;
    var it = { id: newId(), type: "text", text: "", x: rnd(p.x), y: rnd(p.y - 11) };
    items.push(it); fresh[it.id] = 1; index();
    cull(); setSel([it.id]);
    startEdit(it.id, {});
  }
  function placeItem(gg, p, e) {
    if (!canEdit() || full()) return setTool("select");
    var it = proto(tool), dragged = dist(gg.s0, e) > 10;
    var r = { x: Math.min(p.x, gg.p0.x), y: Math.min(p.y, gg.p0.y), w: Math.abs(p.x - gg.p0.x), h: Math.abs(p.y - gg.p0.y) };
    it.id = newId();
    if (it.type === "text") {
      it.x = rnd(dragged ? r.x : p.x); it.y = rnd(dragged ? r.y : p.y - 11);
      if (dragged && r.w > 60) it.w = rnd(r.w);
      items.push(it); fresh[it.id] = 1; index(); cull();
      setTool("select"); setSel([it.id]); startEdit(it.id, {});
      return;
    }
    var s = protoSize(it);
    if (dragged && it.type !== "table") { it.w = Math.max(40, rnd(r.w)); it.h = Math.max(40, rnd(r.h)); it.x = rnd(r.x); it.y = rnd(r.y); }
    else { it.x = rnd(p.x - s.w / 2); it.y = rnd(p.y - s.h / 2); }
    setTool("select");
    if (!addItems([it], true)) return;
    if (it.type === "table") editCell(it.id, 0, 0); else startEdit(it.id, { all: it.type === "section" });
  }

  function startPinch() {
    var k = Object.keys(pointers), a = pointers[k[0]], b = pointers[k[1]];
    g = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - vrc.left, my: (a.y + b.y) / 2 - vrc.top, cam: { x: cam.x, y: cam.y, z: cam.z } };
  }
  function pinchMove() {
    var k = Object.keys(pointers);
    if (k.length < 2) return;
    var a = pointers[k[0]], b = pointers[k[1]], z = clamp(g.cam.z * Math.hypot(a.x - b.x, a.y - b.y) / g.d0, 0.1, 4);
    var mx = (a.x + b.x) / 2 - vrc.left, my = (a.y + b.y) / 2 - vrc.top, wx = (g.mx - g.cam.x) / g.cam.z, wy = (g.my - g.cam.y) / g.cam.z;
    setCam(mx - wx * z, my - wy * z, z);
  }
  view.addEventListener("pointerdown", onDown);
  view.addEventListener("pointermove", onMove);
  view.addEventListener("pointerup", onUp);
  view.addEventListener("pointercancel", onUp);
  view.addEventListener("pointerleave", function () { ghost.hidden = true; });
  view.addEventListener("wheel", function (e) {
    if (C.thumb || e.target.closest(".bd-ctx,.bd-edit")) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - vrc.left, e.clientY - vrc.top, cam.z * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0022)));
    else {
      var dx = e.deltaX, dy = e.deltaY;
      if (e.deltaMode === 1) { dx *= 32; dy *= 32; }
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      setCam(cam.x - dx, cam.y - dy, cam.z);
    }
  }, { passive: false });
  view.addEventListener("dragstart", function (e) { e.preventDefault(); });
  // The canvas never scrolls (overflow: clip; a browser without it scrolls on focus and this puts it
  // back): the camera is the only way the scene moves, so the stored view stays true. What the
  // keyboard focuses inside an item (a link in a block) is brought into view by panning instead.
  [root, view, ui].forEach(function (el) {
    el.addEventListener("scroll", function () { if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } });
  });
  world.addEventListener("focusin", function (e) {
    var el = e.target.closest && e.target.closest(".bd-it"), it = el && byId[el.getAttribute("data-id")];
    if (!it || e.target === el) return;
    measureView();
    var r = e.target.getBoundingClientRect && e.target.getBoundingClientRect();
    if (r && r.width + r.height > 0) {          // the focused thing itself (a link), in board units
      var p = toWorld({ clientX: r.left, clientY: r.top });
      reveal({ x: p.x, y: p.y, w: r.width / cam.z, h: r.height / cam.z });
    } else reveal(bb(it));
  });

  // ------------------------------------------------------------------ popovers and menus
  var popEl = null, popAnchor = null, menuAnchor = null, popEsc = null;
  function closeMenu() { var m = document.querySelector(".kit-menu"); if (m && m.close) m.close(); }
  function closePop() {
    if (!popEl) return;
    popEl.remove(); popEl = null; popAnchor = null; popEsc = null;
    document.removeEventListener("mousedown", popOut, true);
  }
  function popOut(e) { if (popEl && !popEl.contains(e.target) && !(popAnchor && popAnchor.contains && popAnchor.contains(e.target))) closePop(); }
  /** A small panel by its button (colours, shapes, a link field). Clicking the button again closes it.
   * onEsc: what Esc does besides closing it (a tool's picker: back to Select). */
  function pop(anchor, content, label, onEsc) {
    var again = popAnchor === anchor;
    closePop(); closeMenu();
    if (again) return null;
    var p = h("div", { "class": "bd-pop", role: "dialog", "aria-label": label });
    p.appendChild(content);
    document.body.appendChild(p);
    var r = anchor.getBoundingClientRect(), ph = p.offsetHeight, pw = p.offsetWidth, above = r.top - 8 - ph >= 8;
    p.style.top = (above ? r.top - 8 - ph : Math.min(r.bottom + 8, innerHeight - ph - 8)) + "px";
    p.style.left = clamp(r.left + r.width / 2 - pw / 2, 8, Math.max(8, innerWidth - pw - 8)) + "px";
    p.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); escPop(); if (anchor.focus) anchor.focus(); } });
    popEl = p; popAnchor = anchor; popEsc = onEsc || null;
    setTimeout(function () { document.addEventListener("mousedown", popOut, true); }, 0);
    return p;
  }
  function escPop() { var f = popEsc; closePop(); if (f) f(); }
  function menu(anchor, list) { closePop(); menuAnchor = anchor; kit.menu(anchor, list); }
  function menuAt(x, y, list) {
    var a = { getBoundingClientRect: function () { return { left: x, right: x, top: y, bottom: y, width: 0, height: 0 }; }, contains: function () { return false; } };
    closePop(); closeMenu(); menuAnchor = view;
    kit.menu(a, list);
    var m = document.querySelector(".kit-menu");
    if (!m) return;
    m.style.left = clamp(x, 8, Math.max(8, innerWidth - m.offsetWidth - 8)) + "px";
    m.style.top = clamp(y, 8, Math.max(8, innerHeight - m.offsetHeight - 8)) + "px";
  }
  function tick(on, label) { return (on ? "✓ " : "") + label; }
  function swatches(names, cur, isFill, onPick, extra) {
    var box = h("div", { "class": "bd-sw" });
    names.forEach(function (n) {
      var b = h("button", { type: "button", "class": "bd-swatch" + (cur === n ? " on" : ""), title: T.colours[n], "aria-label": T.colours[n], "aria-pressed": cur === n ? "true" : "false",
        onclick: function () { closePop(); onPick(n); } });
      b.style.background = "var(--bd-" + (isFill ? "f" : "s") + "-" + n + ")";
      if (isFill) b.style.borderColor = "var(--bd-l-" + n + ")";
      box.appendChild(b);
    });
    var ci = h("input", { type: "color", "class": "bd-custom", title: T.custom, "aria-label": T.custom, value: HEX.test(cur || "") ? cur : "#888888" });
    ci.addEventListener("change", function () { closePop(); if (HEX.test(ci.value)) onPick(ci.value.toLowerCase()); });
    box.appendChild(ci);
    var wrap = h("div", { "class": "bd-popcol" }, [box]);
    (extra || []).forEach(function (x) { wrap.appendChild(x); });
    return wrap;
  }

  // ------------------------------------------------------------------ the tools (a pill at the bottom), the zoom pill, the top corner
  var toolBtn = {}, toolsEl = h("div", { "class": "bd-tools bd-chrome", role: "toolbar", "aria-label": T.board });
  var TOOLS = [["select", T.select, "V", "cursor"], ["hand", T.hand, "H", "hand"], ["text", T.text, "T", "text"], ["section", T.section, "A", "frame"],
    ["sticky", T.sticky, "S", "sticky"], ["draw", T.draw, "L", ""], ["shape", T.shapes, "", ""], ["image", T.image, "", "image"]];
  var TOOLKEY = { v: "select", h: "hand", t: "text", a: "section", s: "sticky", l: "draw" };
  var canAsk = live && !!hm.board.ask;
  function toolSync() {
    for (var k in toolBtn) toolBtn[k].setAttribute("aria-pressed", k === tool ? "true" : "false");
    if (toolBtn.draw) {
      toolBtn.draw.innerHTML = kit.icon(prefs.draw === "pen" ? "pencil" : "arrowUR") + '<i class="bd-pendot"></i>';
      toolBtn.draw.querySelector("i").style.background = strokeOf(prefs.penColor);
    }
    if (toolBtn.shape) toolBtn.shape.innerHTML = kindIcon(prefs.shape);
    root.setAttribute("data-tool", tool);
  }
  function setTool(t, anchor) {
    if (ro) return;
    if (t === "image") return pickImage();
    endEdit(); setInteract(null); closePop();
    tool = t; ghost.hidden = true;
    toolSync(); drawUi();
    if (anchor && t === "draw") drawPop(anchor);
    if (anchor && t === "shape") shapePop(anchor, prefs.shape, true, function (k) { prefs.shape = k; savePrefs(); toolSync(); }, toSelect);
  }
  function drawPop(anchor) {
    var seg = h("div", { "class": "kit-seg" });
    [["pen", T.pen, "pencil"], ["arrow", T.arrow, "arrowUR"]].forEach(function (x) {
      var b = h("button", { type: "button", "class": "kit-btn", title: x[1], "aria-label": x[1], "aria-pressed": prefs.draw === x[0] ? "true" : "false", html: kit.icon(x[2]) + "<span></span>",
        onclick: function () { prefs.draw = x[0]; savePrefs(); toolSync(); closePop(); } });
      b.querySelector("span").textContent = x[1];
      seg.appendChild(b);
    });
    pop(anchor, swatches(STROKES, prefs.penColor, false, function (c) { prefs.penColor = c; savePrefs(); toolSync(); }, [seg]), T.draw, toSelect);
  }
  function toSelect() { setTool("select"); }
  function shapePop(anchor, cur, withTable, onPick, onEsc) {
    var grid = h("div", { "class": "bd-kinds" });
    G.KINDS.concat(withTable ? ["table"] : []).forEach(function (k) {
      var name = k === "table" ? T.table : T.kinds[k] || k;
      grid.appendChild(h("button", { type: "button", "class": "bd-kind" + (cur === k ? " on" : ""), title: name, "aria-label": name, "aria-pressed": cur === k ? "true" : "false", html: kindIcon(k),
        onclick: function () { closePop(); onPick(k); } }));
    });
    pop(anchor, grid, T.shapes, onEsc);
  }
  var zoomLbl = h("button", { type: "button", "class": "kit-btn bd-zl", title: T.zoom, "aria-label": T.zoom, onclick: function () {
    menu(zoomLbl, [25, 50, 75, 100, 150, 200].map(function (p) { return { label: p + "%", onClick: function () { zoomAt(vw / 2, vh / 2, p / 100); } }; })
      .concat([{ label: T.fit + "  (Ctrl+0)", onClick: function () { fitAll(); } },
        { label: tick(prefs.keys, T.keys), onClick: function () { prefs.keys = !prefs.keys; savePrefs(); } }]));
  } });
  var undoBtn = kit.button("", "undo", function () { undo(); }, T.undo + " (Ctrl+Z)"), redoBtn = kit.button("", "redo", function () { redo(); }, T.redo + " (Ctrl+Shift+Z)");
  var zoomEl = h("div", { "class": "bd-zoom bd-chrome", role: "toolbar", "aria-label": T.zoom }, [
    kit.button("", "minus", function () { zoomStep(-1); }, T.zoomOut + " (Ctrl+−)"), zoomLbl, kit.button("", "plus", function () { zoomStep(1); }, T.zoomIn + " (Ctrl++)"),
    h("span", { "class": "bd-sep" }), undoBtn, redoBtn]);
  var histBtn = kit.button("", "history", function (e) { openHistory(histBtn); }, T.hist);
  var expBtn = kit.button("", "download", function () { menu(expBtn, exportList.map(function (x) { return { label: x.label, onClick: x.run }; })); }, T.exp);
  var topEl = h("div", { "class": "bd-top bd-chrome", role: "toolbar", "aria-label": T.more }, [histBtn, expBtn]);
  var banner = h("div", { "class": "bd-banner", hidden: true });
  function zoomSync() { zoomLbl.textContent = rnd(cam.z * 100) + "%"; }
  function undoSync() {
    undoBtn.disabled = !undoS.length || !canEdit(); redoBtn.disabled = !redoS.length || !canEdit();
  }
  [undoBtn, redoBtn, histBtn, expBtn].forEach(function (b) { b.setAttribute("aria-label", b.title); });
  zoomEl.querySelectorAll("button").forEach(function (b) { if (!b.getAttribute("aria-label")) b.setAttribute("aria-label", b.title); });

  // "Ask Hermes": a line above the tools that goes to the chat with the selected items' ids
  var askIn = h("input", { type: "text", "class": "bd-askin", placeholder: T.askPh, "aria-label": T.askPh, maxlength: "2000", autocomplete: "off" });
  var askEl = h("form", { "class": "bd-ask bd-chrome", hidden: true }, [h("span", { "class": "bd-askic", html: kit.icon("sparkle") }), askIn,
    h("button", { type: "submit", "class": "kit-btn bd-asksend", title: T.send, "aria-label": T.send, html: kit.icon("arrowUR") })]);
  function openAsk() {
    if (!canAsk || preview) return;
    endEdit(); closePop();
    askEl.hidden = false;
    askIn.focus();
  }
  function closeAsk() { askEl.hidden = true; askIn.value = ""; }
  askEl.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = askIn.value.trim();
    if (!text) return;
    flush();
    hm.board.ask({ text: text.slice(0, 2000), ids: sel.slice(0, 100) })
      .then(function (r) { kit.toast(r && r.mode === "draft" ? T.drafted : T.sent); })
      .catch(function (x) { kit.toast(String(x && x.message || x)); });
    closeAsk();
    view.focus({ preventScroll: true });
  });
  askIn.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); closeAsk(); view.focus({ preventScroll: true }); } });

  // ------------------------------------------------------------------ the toolbar over the selection
  function cbtn(label, html, fn, pressed) {
    var b = h("button", { type: "button", "class": "kit-btn bd-cb", title: label, "aria-label": label, html: html });
    if (pressed != null) b.setAttribute("aria-pressed", pressed ? "true" : "false");
    b.addEventListener("click", function (e) { fn(b, e); });
    return b;
  }
  function sep() { return h("span", { "class": "bd-sep" }); }
  function free() { return sel.filter(function (id) { return byId[id] && !byId[id].locked; }); }
  var SIZE_LBL = { small: "S", body: "M", large: "L", title: "XL", huge: "XXL" };
  /** The height a block needs for its text at a size (by the shared measure rule); null when it fits. */
  function grown(it, over) {
    var t = {}, k; for (k in it) t[k] = it[k]; for (k in over) t[k] = over[k];
    if (t.type !== "box" && t.type !== "note") return null;
    try {
      var hh = t.h, i, need;
      for (i = 0; i < 8; i++) {
        var ins = inset(kindOf(t), t.w, hh);
        need = G.measure(plain(t.text || ""), px(t), ins.w).h;
        if (ins.h >= need) break;
        hh += Math.ceil(need - ins.h);
      }
      return hh > t.h ? hh : null;
    } catch (e) { return null; }
  }
  function sizeMenu(b) {
    endEdit();
    var cur = (selItems()[0] || {}).size || "body";
    menu(b, [["small", T.szSmall], ["body", T.szBody], ["large", T.szLarge], ["title", T.szTitle], ["huge", T.szHuge]].map(function (x) {
      return { label: tick(cur === x[0], x[1]), onClick: function () {
        patch(free(), function (it) {
          if (!TEXTY[it.type] || it.type === "section") return null;
          var p = { size: x[0] === "body" ? null : x[0] }, hh = grown(it, { size: x[0] });
          if (hh) p.h = hh;
          return p;
        });
      } };
    }));
  }
  function alignMenu(b) {
    endEdit();
    var it0 = selItems()[0] || {}, cur = it0.align || (it0.type === "text" ? "left" : "center");
    menu(b, [["left", T.alLeft], ["center", T.alCenter], ["right", T.alRight]].map(function (x) {
      return { label: tick(cur === x[0], x[1]), onClick: function () {
        patch(free(), function (it) { return it.type === "box" || it.type === "text" ? { align: x[0] === (it.type === "text" ? "left" : "center") ? null : x[0] } : null; });
      } };
    }));
  }
  function fillPop(b) {
    endEdit();
    var it0 = selItems()[0] || {}, cur = it0.hollow ? "" : it0.color || (it0.type === "note" ? "yellow" : it0.type === "section" ? "gray" : "green");
    var extra = [];
    if (selItems().some(function (it) { return it.type === "box"; })) {
      extra.push(h("button", { type: "button", "class": "kit-btn bd-wide", "aria-pressed": it0.hollow ? "true" : "false", text: T.hollow, onclick: function () {
        closePop(); patch(free(), function (it) { return it.type === "box" ? { hollow: it0.hollow ? null : true } : null; });
      } }));
    }
    pop(b, swatches(FILLS, cur, true, function (c) {
      patch(free(), function (it) { return it.type === "box" ? { color: c, hollow: null } : it.type === "note" || it.type === "section" ? { color: c } : null; });
    }, extra), T.fillC);
  }
  function strokePop(b, field, label, types, noneOk) {
    endEdit();
    var it0 = selItems()[0] || {}, cur = it0[field] || (noneOk ? "" : "ink"), extra = [];
    if (noneOk) extra.push(h("button", { type: "button", "class": "kit-btn bd-wide", "aria-pressed": it0[field] ? "false" : "true", text: T.none, onclick: function () {
      closePop(); patch(free(), function (it) { return types[it.type] ? mk(null) : null; });
    } }));
    function mk(v) { var p = {}; p[field] = v; return p; }
    pop(b, swatches(STROKES, cur, false, function (c) {
      patch(free(), function (it) { return types[it.type] ? mk(!noneOk && c === "ink" ? null : c) : null; });
    }, extra), label);
  }
  function headMenu(b, i) {
    var a = selItems()[0], cur = (Array.isArray(a.heads) ? a.heads : ["none", "arrow"])[i];
    menu(b, [["none", T.hNone], ["arrow", T.hArrow], ["circle", T.hCircle]].map(function (x) {
      return { label: tick(cur === x[0], x[1]), onClick: function () {
        patch(free(), function (it) {
          if (it.type !== "arrow") return null;
          var hs = (Array.isArray(it.heads) ? it.heads : ["none", "arrow"]).slice(0, 2);
          hs[i] = x[0];
          return { heads: hs[0] === "none" && hs[1] === "arrow" ? null : hs };
        });
      } };
    }));
  }
  function linePop(b) {
    var a = selItems()[0] || {}, seg = h("div", { "class": "kit-seg" });
    [[false, T.solid, "solid"], [true, T.dashed, "dash"]].forEach(function (x) {
      var bt = h("button", { type: "button", "class": "kit-btn", title: x[1], "aria-label": x[1], "aria-pressed": !!a.dash === x[0] ? "true" : "false", html: ico(x[2]) + "<span></span>",
        onclick: function () { closePop(); patch(free(), function (it) { return it.type === "arrow" ? { dash: x[0] ? true : null } : null; }); } });
      bt.querySelector("span").textContent = x[1];
      seg.appendChild(bt);
    });
    pop(b, swatches(STROKES, a.color || "ink", false, function (c) {
      patch(free(), function (it) { return it.type === "arrow" ? { color: c === "ink" ? null : c } : null; });
    }, [seg]), T.lineStyle);
  }
  function widthMenu(b) {
    var cur = +(selItems()[0] || {}).width || 3;
    menu(b, [2, 3, 5, 8, 12].map(function (w) {
      return { label: tick(cur === w, w + " px"), onClick: function () { patch(free(), function (it) { return it.type === "pen" ? { width: w === 3 ? null : w } : null; }); } };
    }));
  }
  function linkPop(b) {
    var keep = ed && ed.kind === "text" ? { s: ed.ta.selectionStart, e: ed.ta.selectionEnd } : null;
    var inp = h("input", { type: "url", "class": "bd-askin bd-linkin", placeholder: T.linkPh, "aria-label": T.link, value: "https://" });
    var go = function () {
      var url = inp.value.trim();
      closePop();
      if (!/^https?:\/\/[^\s)]+$/.test(url)) return;
      if (ed && ed.kind === "text" && keep) {
        var ta = ed.ta, v = ta.value, word = v.slice(keep.s, keep.e) || url.replace(/^https?:\/\//, "");
        ta.focus(); ta.setRangeText("[" + word + "](" + url + ")", keep.s, keep.e, "end"); edInput();
      } else patch(free(), function (it) {
        if (!TEXTY[it.type] || it.type === "section" || !it.text) return null;
        return { text: it.text.split("\n").map(linkLine(url)).join("\n") };
      });
    };
    var form = h("form", { "class": "bd-linkform" }, [inp, h("button", { type: "submit", "class": "kit-btn bd-wide", text: T.apply })]);
    form.addEventListener("submit", function (e) { e.preventDefault(); go(); });
    if (pop(b, form, T.link)) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
  function toggleMark(m) {
    if (ed && ed.kind === "text") {
      var ta = ed.ta, s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
      if (s === e) { ta.setRangeText(m + m, s, e, "end"); ta.setSelectionRange(s + m.length, s + m.length); }
      else if (v.slice(s - m.length, s) === m && v.slice(e, e + m.length) === m) { ta.setRangeText(v.slice(s, e), s - m.length, e + m.length, "select"); }
      else { ta.setRangeText(m + v.slice(s, e) + m, s, e, "end"); ta.setSelectionRange(s + m.length, e + m.length); }
      ta.focus(); edInput();
      return;
    }
    patch(free(), function (it) { return TEXTY[it.type] && it.type !== "section" && it.text ? { text: markText(it.text, m) } : null; });
  }
  function toggleList() {
    if (ed && ed.kind === "text") {
      var ta = ed.ta, v = ta.value, s = v.lastIndexOf("\n", ta.selectionStart - 1) + 1, e = v.indexOf("\n", ta.selectionEnd);
      if (e < 0) e = v.length;
      var out = listText(v.slice(s, e) || " ").replace(/^- $/, "- ");
      ta.setRangeText(out, s, e, "end"); ta.focus(); edInput();
      return;
    }
    patch(free(), function (it) {
      if (!TEXTY[it.type] || it.type === "section" || !it.text) return null;
      var p = { text: listText(it.text) }, hh = grown(it, p);
      if (hh) p.h = hh;
      return p;
    });
  }
  function toggleLock() {
    endEdit();
    var all = selItems().every(function (it) { return it.locked; });
    patch(sel.slice(), function () { return { locked: all ? null : true }; });
  }
  var ctxExtra = [];                            // the toolbar's controls that did not fit, as menu entries
  function moreBtn() {
    var b = cbtn(T.more, kit.icon("more"), function (b) { endEdit(); menu(b, ctxExtra.concat(moreItems())); });
    b.classList.add("bd-more");
    return b;
  }
  /** A control that may move into "More" on a narrow view: pri (higher goes first) and its menu entry; run gets the More button as its anchor. */
  function opt(b, pri, label, run) {
    b._pri = pri;
    b._entry = { label: label, onClick: function () { run(ctx.querySelector(".bd-more") || b); } };
    return b;
  }
  function lockBtn(on) { return cbtn(on ? T.unlock : T.lock, ico(on ? "lock" : "unlock"), toggleLock, !!on); }
  function textBtns() {
    var bold = function () { toggleMark("**"); }, ital = function () { toggleMark("*"); };
    return [opt(cbtn(T.bold + " (Ctrl+B)", kit.icon("bold"), bold), 5, T.bold, bold), opt(cbtn(T.italic + " (Ctrl+I)", kit.icon("italic"), ital), 7, T.italic, ital),
      opt(cbtn(T.link, ico("link"), linkPop), 8, T.link + "…", linkPop), opt(cbtn(T.list, ico("list"), toggleList), 9, T.list, toggleList),
      opt(cbtn(T.align, kit.icon("alignC") + CARET, alignMenu), 10, T.align + "…", alignMenu)];
  }
  function sizeBtn(it) { var b = cbtn(T.size, "<b class=\"bd-szl\"></b>" + CARET, sizeMenu); b.querySelector("b").textContent = SIZE_LBL[it.size] || "M"; return opt(b, 4, T.size + "…", sizeMenu); }
  function dotBtn(label, colour, fn, ring) {
    var b = cbtn(label, '<i class="bd-cdot' + (ring ? " bd-ring" : "") + '"></i>' + CARET, fn);
    b.querySelector("i").style[ring ? "borderColor" : "background"] = colour;
    return b;
  }
  function drawCtx() {
    ctx.textContent = ""; ctxExtra = []; ctxFitAt = -1;
    if (ro || !sel.length) { ctx.hidden = true; return; }
    var list = selItems(), one = list.length === 1 ? list[0] : null, locked = list.every(function (it) { return it.locked; }), c = [];
    if (!list.length) { ctx.hidden = true; return; }
    if (locked) c = [lockBtn(true), moreBtn()];
    else if (one) {
      var f = fillOf(one.color, one.type === "note" ? "yellow" : one.type === "section" ? "gray" : "green");
      switch (one.type) {
        case "box":
          var kindRun = function (b) { endEdit(); shapePop(b, kindOf(one), false, function (k) { patch(free(), function (it) { return it.type === "box" ? { kind: k === "rounded" ? null : k } : null; }); }); };
          var lineRun = function (b) { strokePop(b, "stroke", T.outline, { box: 1 }, true); };
          c = [opt(cbtn(T.kind, kindIcon(kindOf(one)) + CARET, kindRun), 3, T.kind + "…", kindRun),
            sizeBtn(one), sep()].concat(textBtns(), [sep(), opt(dotBtn(T.fillC, one.hollow ? "transparent" : f.bg, fillPop), 2, T.fillC + "…", fillPop),
            opt(dotBtn(T.outline, one.stroke ? strokeOf(one.stroke) : f.line, lineRun, true), 6, T.outline + "…", lineRun), sep(), lockBtn(false), moreBtn()]);
          break;
        case "text":
          var colRun = function (b) { strokePop(b, "color", T.colour, { text: 1 }, false); };
          c = [sizeBtn(one), opt(dotBtn(T.colour, strokeOf(one.color), colRun), 2, T.colour + "…", colRun), sep()].concat(textBtns(), [sep(), lockBtn(false), moreBtn()]);
          break;
        case "note": c = [dotBtn(T.colour, f.bg, fillPop), sizeBtn(one), sep(), lockBtn(false), moreBtn()]; break;
        case "section": c = [dotBtn(T.colour, f.bg, fillPop), sep(), lockBtn(false), moreBtn()]; break;
        case "arrow":
          var hs = Array.isArray(one.heads) ? one.heads : ["none", "arrow"], cap = function (k) { return k.charAt(0).toUpperCase() + k.slice(1); };
          var h0 = function (b) { headMenu(b, 0); }, h1 = function (b) { headMenu(b, 1); }, lbl = function () { editLabel(one.id); };
          c = [opt(cbtn(T.startHead, ico("h" + cap(hs[0] || "none") + "S") + CARET, h0), 5, T.startHead + "…", h0),
            opt(cbtn(T.lineStyle, ico(one.dash ? "dash" : "solid") + '<i class="bd-cdot"></i>' + CARET, linePop), 3, T.lineStyle + "…", linePop),
            opt(cbtn(T.endHead, ico("h" + cap(hs[1] || "none")) + CARET, h1), 4, T.endHead + "…", h1),
            opt(cbtn(T.label, ico("tag"), lbl), 6, T.label, lbl), sep(), lockBtn(false), moreBtn()];
          c[1].querySelector("i").style.background = strokeOf(one.color);
          break;
        case "pen":
          var penRun = function (b) { strokePop(b, "color", T.colour, { pen: 1 }, false); };
          c = [opt(dotBtn(T.colour, strokeOf(one.color), penRun), 2, T.colour + "…", penRun), opt(cbtn(T.width, ico("width") + CARET, widthMenu), 3, T.width + "…", widthMenu), sep(), lockBtn(false), moreBtn()];
          break;
        case "table":
          c = [cbtn(T.addRow, ico("rowAdd"), function () { tableAdd(one.id, "row"); }), cbtn(T.addCol, ico("colAdd"), function () { tableAdd(one.id, "col"); }), sep(), lockBtn(false), moreBtn()];
          break;
        case "embed":
          c = [cbtn(T.interact, kit.icon("play"), function () { setInteract(one.id); }), sep(), lockBtn(false), moreBtn()];
          break;
        default: c = [lockBtn(false), moreBtn()];
      }
    } else {
      var grp = list[0].group && list.every(function (it) { return it.group === list[0].group; });
      var arr = function (b) {
        menu(b, [["left", T.aLeft], ["center", T.aCenter], ["right", T.aRight], ["top", T.aTop], ["middle", T.aMiddle], ["bottom", T.aBottom], ["hspace", T.aH], ["vspace", T.aV]]
          .map(function (x) { return { label: x[1], onClick: function () { alignSel(x[0]); } }; }));
      }, grpRun = function () { if (grp) ungroup(); else group(); };
      c = [opt(cbtn(T.arrange, ico("arrange") + CARET, arr), 3, T.arrange + "…", arr), opt(dotBtn(T.colour, "var(--bd-f-green)", fillPop), 4, T.colour + "…", fillPop),
        opt(cbtn(grp ? T.ungroup + " (Ctrl+Shift+G)" : T.group + " (Ctrl+G)", ico("group"), grpRun, !!grp), 5, grp ? T.ungroup : T.group, grpRun), sep(), lockBtn(false), moreBtn()];
    }
    c.forEach(function (x, i) { x._ord = i; ctx.appendChild(x); });
  }
  ctx.addEventListener("mousedown", function (e) { if (!e.target.closest("input")) e.preventDefault(); });   // the editor keeps its focus and selection

  // ------------------------------------------------------------------ typing: a block's text, a table cell, an arrow's label
  var lblFor = null;
  function startEdit(id, o) {
    var it = byId[id];
    if (!it || !canEdit() || it.locked || !TEXTY[it.type]) return;
    endEdit(); setInteract(null);
    if (sel.length !== 1 || sel[0] !== id) setSel([id]);
    var n = nd(id);
    if (!n.el || n.off || n.dirty) draw(it);
    var tx = n.el.querySelector(".bd-tx"), one = it.type === "section";
    var ta = h("textarea", { "class": "bd-edit", rows: "1", spellcheck: "false", "aria-label": T.editText, placeholder: o.ph ? T.clickType : null, maxlength: "4000" });
    ta.value = it.text || "";
    tx.textContent = ""; tx.appendChild(ta);
    n.el.classList.add("bd-editing");
    ed = { kind: "text", id: id, ta: ta, orig: it.text || "", h0: it.h, ph: o.ph || null, one: one };
    ta.addEventListener("input", edInput);
    ta.addEventListener("keydown", function (e) {
      var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (e.key === "Escape") {
        // Esc gives the typing up (as in a cell or a label): the text as it was; a new placeholder block goes
        e.preventDefault(); e.stopPropagation();
        if (ed && ed.ph) discardPlaceholder(); else endEdit(true);
        view.focus({ preventScroll: true });
      } else if ((e.key === "Enter" && (mod || one)) || e.key === "Tab") { e.preventDefault(); endEdit(); view.focus({ preventScroll: true }); }
      else if (mod && k === "b" && !one) { e.preventDefault(); toggleMark("**"); }
      else if (mod && k === "i" && !one) { e.preventDefault(); toggleMark("*"); }
    });
    ta.addEventListener("blur", function () { setTimeout(function () { if (ed && ed.ta === ta && document.activeElement !== ta && !popEl) endEdit(); }, 0); });
    ta.focus({ preventScroll: true });
    if (o.all) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
    if (o.ch) ta.setRangeText(o.ch, ta.selectionStart, ta.selectionEnd, "end");
    edInput(); drawCtx(); drawUi();
  }
  /** While typing: the text is the item's at once (not yet sent), a block grows taller to hold it. */
  function edInput() {
    if (!ed || ed.kind !== "text") return;
    var it = byId[ed.id], ta = ed.ta, n = nd(ed.id);
    if (!it) return;
    it.text = ed.one ? ta.value.replace(/\n/g, " ") : ta.value;
    n.b = null;
    if (it.type === "text") { reshape(it); ta.style.height = "0px"; ta.style.height = ta.scrollHeight + "px"; }
    else if (it.type !== "section") {
      ta.style.height = "0px";
      var need = ta.scrollHeight, hh = ed.h0, i;
      ta.style.height = need + "px";
      for (i = 0; i < 8; i++) { var ins = inset(kindOf(it), it.w, hh); if (ins.h >= need) break; hh += Math.ceil(need - ins.h); }
      if (hh !== it.h) { it.h = hh; n.b = null; reshape(it); }
    }
    redrawMany(arrowsAt(it.id));
    drawUi();
  }
  /** The typing ends: kept (clicking away, Tab, Ctrl+Enter) or, with `cancel` (Esc), given up. */
  function endEdit(cancel) {
    if (!ed) return;
    var e = ed, it = byId[e.id];
    if (cancel === true) e.ta.value = e.orig;
    ed = null;
    if (e.kind === "cell") return commitCell(e, it);
    if (e.kind === "label") return commitLabel(e, it);
    var n = N[e.id];
    if (n && n.el) n.el.classList.remove("bd-editing");
    if (!it) return;
    var text = (e.one ? e.ta.value.replace(/\n/g, " ") : e.ta.value).replace(/\s+$/, "").slice(0, 4000), hNew = cancel === true ? e.h0 : it.h;
    if (cancel === true) text = e.orig;
    it.text = e.orig;                                   // back to what it was, then one undoable edit
    if (e.h0 != null) it.h = e.h0;
    inval(it.id);
    if (fresh[it.id]) {                                 // a text that was never sent: it starts existing now, or never did
      delete fresh[it.id];
      items = items.filter(function (x) { return x !== it; });
      index();
      if (!text) { dropNode(it.id); sel = sel.filter(function (x) { return x !== it.id; }); selChanged(); afterChange(); return; }
      it.text = text;
      doEdit([{ op: "add", items: [clone(it)] }], [{ op: "delete", ids: [it.id] }]);
      return;
    }
    if (it.type === "text" && !text) {
      var one = {}; one[it.id] = 1;
      doEdit([{ op: "delete", ids: [it.id] }], [{ op: "add", items: withAt(one) }]);
      selChanged();
      return;
    }
    var p = { text: text };
    if ((it.type === "box" || it.type === "note") && hNew !== e.h0) p.h = hNew;
    if (!patch([it.id], function () { return p; })) afterChange();
  }
  /** Typing given up because the item went away. */
  function dropEdit() { var e = ed; ed = null; if (e && e.kind === "text") { var n = N[e.id]; if (n && n.el) n.el.classList.remove("bd-editing"); } }
  /** Esc in a placeholder block nobody typed in: the block and its arrow go, with no trace in undo. */
  function discardPlaceholder() {
    var e = ed, ids = e.ph, last = undoS[undoS.length - 1];
    ed = null;
    if (last && last.fwd[0] && last.fwd[0].op === "add" && (last.fwd[0].items || []).some(function (x) { return x.id === ids[0]; })) undoS.pop();
    replay([{ op: "delete", ids: ids.slice() }]);
    selChanged();
  }
  function cellText(it, r, c) { var row = it.rows && it.rows[r]; return row && row[c] != null ? String(row[c]) : ""; }
  function editCell(id, r, c) {
    var it = byId[id];
    if (!it || it.type !== "table" || it.locked || !canEdit()) return;
    endEdit();
    it = byId[id];
    if (!it) return;
    if (sel.length !== 1 || sel[0] !== id) setSel([id]);
    var n = nd(id);
    if (!n.el || n.off || n.dirty) draw(it);
    var td = n.el.querySelector('[data-r="' + r + '"][data-c="' + c + '"]');
    if (!td) return;
    var ta = h("textarea", { "class": "bd-edit bd-celled", rows: "1", spellcheck: "false", "aria-label": T.cell + " " + (r + 1) + ":" + (c + 1), maxlength: "4000" });
    ta.value = cellText(it, r, c);
    td.firstChild.textContent = ""; td.firstChild.appendChild(ta);
    ed = { kind: "cell", id: id, ta: ta, r: r, c: c, orig: ta.value };
    var size = function () { ta.style.height = "0px"; ta.style.height = ta.scrollHeight + "px"; };
    ta.addEventListener("input", size);
    ta.addEventListener("keydown", function (e) {
      var rows = (it.rows || []).length, cols = n.el.querySelectorAll("col").length, r2 = r, c2 = c;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); ta.value = ed.orig; endEdit(); view.focus({ preventScroll: true }); return; }
      if (e.key === "Tab") { c2 += e.shiftKey ? -1 : 1; if (c2 < 0) { c2 = cols - 1; r2--; } else if (c2 >= cols) { c2 = 0; r2++; } }
      else if (e.key === "Enter" && !e.shiftKey) r2++;
      else return;
      e.preventDefault();
      endEdit();
      if (r2 >= 0 && r2 < rows) editCell(id, r2, c2); else view.focus({ preventScroll: true });
    });
    ta.addEventListener("blur", function () { setTimeout(function () { if (ed && ed.ta === ta && document.activeElement !== ta) endEdit(); }, 0); });
    ta.focus({ preventScroll: true }); ta.select(); size();
    drawUi();
  }
  function commitCell(e, it) {
    if (!it) return;
    var v = e.ta.value.slice(0, 4000);
    if (v === e.orig) { inval(it.id); cull(); drawUi(); return; }
    var rows = clone(it.rows || []);
    while (rows.length <= e.r) rows.push([]);
    while (rows[e.r].length <= e.c) rows[e.r].push("");
    rows[e.r][e.c] = v;
    patch([it.id], function () { return { rows: rows }; });
  }
  function tableAdd(id, what, at, del) {
    var it = byId[id];
    if (!it || it.type !== "table" || it.locked || !canEdit()) return;
    endEdit();
    var rows = clone(it.rows || [[""]]), cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1), p = {};
    rows.forEach(function (r) { while (r.length < cols) r.push(""); });
    if (what === "row") {
      if (del) { if (rows.length < 2) return; rows.splice(at, 1); }
      else if (rows.length >= 60) return; else rows.splice(at == null ? rows.length : at, 0, rows[0].map(function () { return ""; }));
    } else {
      if (del && cols < 2) return;
      if (!del && cols >= 20) return;
      var i = at == null ? cols : at;
      rows.forEach(function (r) { if (del) r.splice(i, 1); else r.splice(i, 0, ""); });
      if (Array.isArray(it.colw)) { var cw = it.colw.slice(); if (del) cw.splice(i, 1); else cw.splice(i, 0, 120); p.colw = cw; }
    }
    p.rows = rows;
    patch([id], function () { return p; });
  }
  function editLabel(id) {
    var a = byId[id];
    if (!a || a.type !== "arrow" || a.locked || !canEdit()) return;
    endEdit();
    if (sel.length !== 1 || sel[0] !== id) setSel([id]);
    lblFor = id; nd(id).r = null; draw(a); lblFor = null;
    var lb = N[id].el.querySelector(".bd-albl");
    if (!lb) return;
    var inp = h("input", { type: "text", "class": "bd-edit bd-lbled", placeholder: T.labelPh, "aria-label": T.label, maxlength: "200" });
    inp.value = a.label || "";
    lb.textContent = ""; lb.appendChild(inp);
    ed = { kind: "label", id: id, ta: inp, orig: a.label || "" };
    inp.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== "Escape" && e.key !== "Tab") return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") inp.value = ed.orig;
      endEdit(); view.focus({ preventScroll: true });
    });
    inp.addEventListener("blur", function () { setTimeout(function () { if (ed && ed.ta === inp && document.activeElement !== inp) endEdit(); }, 0); });
    inp.focus({ preventScroll: true }); inp.select();
    drawUi();
  }
  function commitLabel(e, a) {
    if (!a) return;
    var v = e.ta.value.trim().slice(0, 200);
    nd(a.id).dirty = true;
    if (v === e.orig) { redrawNow(a); drawUi(); return; }
    if (!patch([a.id], function () { return { label: v || null }; })) redrawNow(a);
  }

  // ------------------------------------------------------------------ actions on the selection
  function selectAll() { endEdit(); setSel(items.map(function (it) { return it.id; })); announce(); }
  /** Copies of the items in `set` with where each stands in the z-order now: undoing their delete puts them back there. */
  function withAt(set) {
    var out = [];
    items.forEach(function (it, i) { if (set[it.id]) { var c = clone(it); c.at = i; out.push(c); } });
    return out;
  }
  function deleteSel() {
    endEdit();
    var ids = free();
    if (!ids.length) { if (sel.length) kit.toast(T.locked); return; }
    var set = {};
    ids.forEach(function (id) { set[id] = 1; arrowsAt(id).forEach(function (a) { set[a.id] = 1; }); });
    doEdit([{ op: "delete", ids: ids }], [{ op: "add", items: withAt(set) }]);
    selChanged();
  }
  function orderSel(to) {
    endEdit();
    var set = {}, ids;
    free().forEach(function (id) { set[id] = 1; });
    ids = items.filter(function (it) { return set[it.id]; }).map(function (it) { return it.id; });
    if (!ids.length) return;
    // Undo: `order` keeps the named items' order among themselves, so the old order comes back run by
    // run (moved, not moved, moved, …) from the first item that moved to the far end.
    var all = items.map(function (it) { return it.id; }), inv = [], run = [], i, first = -1, last = -1;
    all.forEach(function (id, k) { if (set[id]) { if (first < 0) first = k; last = k; } });
    var seq = to === "front" ? all.slice(first) : all.slice(0, last + 1).reverse();
    for (i = 0; i < seq.length; i++) {
      if (run.length && !!set[seq[i]] !== !!set[run[0]]) { inv.push({ op: "order", ids: run, to: to }); run = []; }
      run.push(seq[i]);
    }
    if (run.length) inv.push({ op: "order", ids: run, to: to });
    doEdit([{ op: "order", ids: ids, to: to }], inv);
  }
  function group() {
    endEdit();
    var ids = free();
    if (ids.length < 2) return;
    var gid = newId("g");
    patch(ids, function () { return { group: gid }; });
    drawCtx();
  }
  function ungroup() {
    endEdit();
    patch(free(), function (it) { return it.group ? { group: null } : null; });
    drawCtx();
  }
  function alignSel(how) {
    endEdit();
    var list = free().map(function (id) { return byId[id]; }).filter(function (it) { return it.type !== "arrow"; }), set = {}, res;
    if (list.length < 2) return;
    list.forEach(function (it) { set[it.id] = 1; });
    try { res = G.align(list.map(function (it) { var b = bb(it); return { id: it.id, x: b.x, y: b.y, w: b.w, h: b.h }; }), how); } catch (e) { res = null; }
    var fwd = [], inv = [];
    (res || []).forEach(function (r) {
      var it = byId[r.id];
      if (!it) return;
      var b = bb(it), dx = rnd(r.x - b.x), dy = rnd(r.y - b.y), ids = [it.id];
      if (!dx && !dy) return;
      if (it.type === "section") { try { (G.members(it, items) || []).forEach(function (m) { var id = typeof m === "string" ? m : m.id; if (!set[id] && byId[id] && !byId[id].locked) ids.push(id); }); } catch (e) {} }
      fwd.push({ op: "move", ids: ids, dx: dx, dy: dy });
      inv.unshift({ op: "move", ids: ids, dx: -dx, dy: -dy });
    });
    doEdit(fwd, inv);
  }
  /** "Tidy up": the server lays the selection out again; undo puts every item back where it was. */
  function tidy() {
    endEdit();
    var ids = free(), inv = [], set = {};
    if (!ids.length) return;
    ids.forEach(function (id) { set[id] = 1; });
    ids.forEach(function (id) {                         // as the server does: a section goes with what is in it
      if (byId[id] && byId[id].type === "section") { try { G.members(byId[id], items).forEach(function (m) { set[m.id] = 1; }); } catch (e) {} }
    });
    // What the server may change: the named blocks, the sections (one grows around a member put in
    // it), and the bends and sides of the arrows between the named blocks (they route again).
    items.forEach(function (it) {
      if (it.type === "arrow") {
        // tidy clears these and may set sides afresh (a loop goes round below): all go back as they were
        if (typeof it.from === "string" && typeof it.to === "string" && set[it.from] && set[it.to])
          inv.push({ op: "set", id: it.id, via: clone(it.via) || null, fromSide: it.fromSide || null, toSide: it.toSide || null });
        return;
      }
      if (!set[it.id] && it.type !== "section") return;
      var o = { op: "set", id: it.id, x: it.x, y: it.y };
      if (it.w != null && it.type !== "table") o.w = it.w;
      if (it.h != null && it.type !== "text" && it.type !== "table") o.h = it.h;
      inv.push(o);
    });
    doEdit([{ op: "tidy", ids: ids }], inv, true);
  }
  var nudgeAcc = null, nudgeTimer = null;
  function nudge(dx, dy) {
    endEdit();
    if (!nudgeAcc) { var ids = canEdit() ? moveSet(sel) : []; if (!ids.length) return; nudgeAcc = { ids: ids, dx: 0, dy: 0 }; }
    nudgeAcc.dx += dx; nudgeAcc.dy += dy;
    touched(applyLocal({ op: "move", ids: nudgeAcc.ids, dx: dx, dy: dy }));
    reroute(); cull(); drawUi();
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(nudgeEnd, 500);
  }
  /** A run of arrow-key nudges is one move (one op, one undo step). */
  function nudgeEnd() {
    clearTimeout(nudgeTimer);
    var a = nudgeAcc;
    nudgeAcc = null;
    if (a && (a.dx || a.dy)) doEdit([{ op: "move", ids: a.ids, dx: a.dx, dy: a.dy }], [{ op: "move", ids: a.ids, dx: -a.dx, dy: -a.dy }], true);
  }
  function cycle(dir) {
    if (!items.length) return false;
    // Tab walks the items back to front; Shift+Tab with nothing selected (and Tab after the last item) leaves the canvas
    var cur = sel.length === 1 ? items.indexOf(byId[sel[0]]) : -1, next = cur < 0 ? (dir > 0 ? 0 : -1) : cur + dir;
    if (next < 0 || next >= items.length) { if (sel.length) { setSel([]); announce(); } return false; }
    setSel([items[next].id]);
    reveal(bb(items[next]));
    announce();
    return true;
  }

  // ------------------------------------------------------------------ copy, paste, duplicate, pictures
  var clipLocal = "";
  function clipText() {
    var set = {};
    sel.forEach(function (id) { set[id] = 1; });
    items.forEach(function (a) { if (a.type === "arrow" && typeof a.from === "string" && typeof a.to === "string" && set[a.from] && set[a.to]) set[a.id] = 1; });
    return JSON.stringify({ hermesBoard: 1, items: items.filter(function (it) { return set[it.id]; }).map(clone) });
  }
  /** Copies of items as new ones, moved by (dx, dy) or centred on `at`. */
  function pasteItems(list, at, dx, dy) {
    list = normItems(list);
    if (!list.length || !canEdit() || full()) return;
    var map = {}, groups = {}, out = [], lookup = {};
    list.forEach(function (it) { lookup[it.id] = it; });
    var box = union(list.filter(function (it) { return it.type !== "arrow"; }).map(function (it) { try { return G.bounds(it, lookup); } catch (e) { return null; } }));
    if (at && box) { dx = rnd(at.x - (box.x + box.w / 2)); dy = rnd(at.y - (box.y + box.h / 2)); }
    var used = {};
    list.forEach(function (it) { var id; do { id = newId(it.type === "arrow" ? "a" : "u"); } while (used[id]); used[id] = 1; map[it.id] = id; });
    list.forEach(function (it) {
      var c = clone(it), ok = true;
      c.id = map[it.id];
      delete c.locked;
      if (c.group) c.group = groups[c.group] || (groups[c.group] = newId("g"));
      if (c.type === "arrow") {
        ["from", "to"].forEach(function (k) {
          if (typeof c[k] !== "string") return;
          if (map[c[k]]) c[k] = map[c[k]]; else if (!byId[c[k]]) ok = false;
        });
        shiftArrow(c, dx || 0, dy || 0);
      } else { c.x += dx || 0; c.y += dy || 0; }
      if (ok) out.push(c);
    });
    out.sort(function (a, b) { return (a.type === "arrow") - (b.type === "arrow"); });
    if (addItems(out, true)) { var b = union(sel.map(function (id) { return byId[id] && bb(byId[id]); })); if (b) reveal(b); }
  }
  function duplicate() {
    endEdit();
    if (!sel.length) return;
    pasteItems(JSON.parse(clipText()).items, null, 24, 24);
  }
  function pastePoint() {
    if (lastPt && vrc && lastPt.x >= vrc.left && lastPt.x <= vrc.left + vw && lastPt.y >= vrc.top && lastPt.y <= vrc.top + vh) return toWorld({ clientX: lastPt.x, clientY: lastPt.y });
    return { x: (vw / 2 - cam.x) / cam.z, y: (vh / 2 - cam.y) / cam.z };
  }
  function pasteText(text) {
    var j = null;
    try { j = JSON.parse(text); } catch (e) {}
    if (j && j.hermesBoard && Array.isArray(j.items)) return pasteItems(j.items, pastePoint());
    text = String(text || "").replace(/\r/g, "").replace(/\s+$/, "").slice(0, 4000);
    if (!text.trim() || !canEdit() || full()) return;
    var p = pastePoint(), it = { id: newId(), type: "text", text: text, x: rnd(p.x), y: rnd(p.y) };
    if (text.length > 60 || text.indexOf("\n") >= 0) it.w = 360;
    addItems([it], true);
  }
  function typingIn(t) { return !!(t && t.closest && t.closest("textarea,input,select,[contenteditable='true']")); }
  document.addEventListener("copy", function (e) {
    if (typingIn(e.target) || !sel.length || C.thumb) return;
    clipLocal = clipText();
    e.clipboardData.setData("text/plain", clipLocal);
    e.preventDefault();
  });
  document.addEventListener("cut", function (e) {
    if (typingIn(e.target) || !sel.length || !canEdit()) return;
    clipLocal = clipText();
    e.clipboardData.setData("text/plain", clipLocal);
    e.preventDefault();
    deleteSel();
  });
  document.addEventListener("paste", function (e) {
    if (typingIn(e.target) || !canEdit()) return;
    var cd = e.clipboardData, f = null, i;
    if (!cd) return;
    for (i = 0; i < (cd.files || []).length; i++) if (/^image\//.test(cd.files[i].type)) { f = cd.files[i]; break; }
    e.preventDefault();
    if (f) return addImageFile(f, pastePoint());
    pasteText(cd.getData("text/plain"));
  });
  function menuCopy(cut) {
    if (!sel.length) return;
    clipLocal = clipText();
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(clipLocal).catch(function () {}); } catch (e) {}
    if (cut) deleteSel(); else kit.toast(T.copied);
  }
  function menuPaste() {
    var local = function () { if (clipLocal) pasteText(clipLocal); else kit.toast(T.pasteHint); };
    try { navigator.clipboard.readText().then(function (t) { if (t) pasteText(t); else local(); }, local); } catch (e) { local(); }
  }
  var URI_MAX = 100000;
  /** A picture as a data URI the board may hold (at most 100 KB): scaled down and re-encoded until it fits. */
  function shrink(img) {
    var w = img.naturalWidth, hh = img.naturalHeight, cv = document.createElement("canvas"), dims = [1600, 1200, 900, 700, 520, 400, 300, 200, 128];
    for (var i = 0; i < dims.length; i++) {
      var k = Math.min(1, dims[i] / Math.max(w, hh));
      cv.width = Math.max(1, rnd(w * k)); cv.height = Math.max(1, rnd(hh * k));
      var c2 = cv.getContext("2d");
      c2.clearRect(0, 0, cv.width, cv.height);
      c2.drawImage(img, 0, 0, cv.width, cv.height);
      var types = [["image/webp", 0.85], ["image/webp", 0.6], ["image/jpeg", 0.7]];
      for (var j = 0; j < types.length; j++) {
        var u = cv.toDataURL(types[j][0], types[j][1]);
        if (/^data:image\/(png|jpeg|webp);base64,/.test(u) && u.length <= URI_MAX && (types[j][0] !== "image/jpeg" || u.indexOf("data:image/jpeg") === 0)) return u;
      }
      if (k < 1 && i === dims.length - 1) break;
    }
    return null;
  }
  function addImageFile(file, at) {
    if (!canEdit() || full()) return;
    if (!file || !/^image\//.test(file.type)) return kit.toast(T.imgBad);
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var w = img.naturalWidth, hh = img.naturalHeight, src = null;
      try { src = w && hh ? shrink(img) : null; } catch (e) { src = null; }
      URL.revokeObjectURL(url);
      if (!src) return kit.toast(w && hh ? T.imgBig : T.imgBad);
      var k = Math.min(1, 420 / w, 420 / hh), p = at || { x: (vw / 2 - cam.x) / cam.z, y: (vh / 2 - cam.y) / cam.z };
      var it = { id: newId(), type: "image", src: src, w: Math.max(8, rnd(w * k)), h: Math.max(8, rnd(hh * k)) };
      it.x = rnd(p.x - it.w / 2); it.y = rnd(p.y - it.h / 2);
      var put = function () { addItems([it], true); };
      // a bridge that stores pictures as files of the artifact takes it; otherwise it stays a data URI
      if (hm.board.upload) hm.board.upload(src).then(function (r) { if (r && typeof r.src === "string" && r.src) it.src = r.src; }).catch(function () {}).then(put);
      else put();
    };
    img.onerror = function () { URL.revokeObjectURL(url); kit.toast(T.imgBad); };
    img.src = url;
  }
  function pickImage() {
    if (!canEdit()) return;
    var inp = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml" });
    inp.addEventListener("change", function () { if (inp.files && inp.files[0]) addImageFile(inp.files[0], null); });
    inp.click();
  }

  // ------------------------------------------------------------------ "More" and the right-click menu
  function moreItems() {
    var list = selItems(), locked = list.length && list.every(function (it) { return it.locked; }), out;
    out = [{ label: locked ? T.unlock : T.lock, onClick: toggleLock },
      { label: T.cut + "  (Ctrl+X)", onClick: function () { menuCopy(true); } }, { label: T.copy + "  (Ctrl+C)", onClick: function () { menuCopy(false); } },
      { label: T.paste + "  (Ctrl+V)", onClick: menuPaste }, { label: T.dup + "  (Ctrl+D)", onClick: duplicate },
      { label: T.front + "  ( ] )", onClick: function () { orderSel("front"); } }, { label: T.back + "  ( [ )", onClick: function () { orderSel("back"); } },
      { label: T.group + "  (Ctrl+G)", onClick: group }, { label: T.ungroup + "  (Ctrl+Shift+G)", onClick: ungroup },
      { label: T.tidy, onClick: tidy }, { label: T.del + "  (Del)", onClick: deleteSel }];
    if (canAsk) out.push({ label: T.ask + "  (Ctrl+K)", onClick: openAsk });
    return out;
  }
  view.addEventListener("contextmenu", function (e) {
    if (C.thumb || typingIn(e.target) || e.target.closest(".bd-ctx")) return;
    e.preventDefault();
    if (!canEdit()) return;
    endEdit();
    measureView();
    lastPt = { x: e.clientX, y: e.clientY };
    var el = e.target.closest(".bd-it"), id = el && el.getAttribute("data-id"), it = id && byId[id], list;
    if (it) {
      if (sel.indexOf(id) < 0) setSel(mates(id));
      list = moreItems();
      var td = it.type === "table" && !it.locked && e.target.closest("[data-r]");
      if (td) {
        var r = +td.getAttribute("data-r"), c = +td.getAttribute("data-c");
        list = [{ label: T.rowAbove, onClick: function () { tableAdd(id, "row", Math.max(r, 1)); } }, { label: T.rowBelow, onClick: function () { tableAdd(id, "row", r + 1); } },
          { label: T.colLeft, onClick: function () { tableAdd(id, "col", c); } }, { label: T.colRight, onClick: function () { tableAdd(id, "col", c + 1); } },
          { label: T.delRow, onClick: function () { tableAdd(id, "row", r, true); } }, { label: T.delCol, onClick: function () { tableAdd(id, "col", c, true); } }].concat(list);
      }
    } else {
      if (sel.length && !e.target.closest(".bd-uisel")) setSel([]);
      list = sel.length ? moreItems() : [{ label: T.paste + "  (Ctrl+V)", onClick: menuPaste }, { label: T.selAll + "  (Ctrl+A)", onClick: selectAll }, { label: T.fit + "  (Ctrl+0)", onClick: function () { fitAll(); } }]
        .concat(canAsk ? [{ label: T.ask + "  (Ctrl+K)", onClick: openAsk }] : []);
    }
    menuAt(e.clientX, e.clientY, list);
  });

  // ------------------------------------------------------------------ export: an SVG of the whole board (text laid out by the measure rule), PNG drawn from it
  function num(v) { return Math.round(v * 100) / 100; }
  var monoFont = "", baseFont = "", measCtx = null;
  // The export lays text out with the real fonts (canvas metrics of the faces the page draws with), so
  // its lines break where the screen's do and every run has its own place (a code chip behind its code).
  function runFont(run, fs, weight) {
    return (run.i ? "italic " : "") + (run.b ? 700 : weight || 400) + " " + (run.code ? fs * 0.9 : fs) + "px " + (run.code ? monoFont : baseFont);
  }
  function runW(t, run, fs, weight) {
    if (!measCtx) return t.length * fs * (run.b ? 0.6 : 0.55);
    measCtx.font = runFont(run, fs, weight);
    return measCtx.measureText(t).width + (run.code && run.first ? fs * 0.225 : 0) + (run.code && run.last ? fs * 0.225 : 0);
  }
  /** Text as the page shows it (geo.richLines: its marks, its list items), wrapped at w by the real font. */
  function svgLines(text, fs, w, noLists, weight) {
    var lines;
    try { lines = G.richLines(text || "", fs, 0, noLists ? { lists: false } : null).lines; }
    catch (e) { lines = String(text || "").split("\n").map(function (t) { return { runs: [{ t: t }], indent: 0 }; }); }
    if (!(w > 0)) return lines;
    var out = [];
    lines.forEach(function (ln) {
      var room = w - ln.indent, toks = [], cur = [], cw = 0, first = true;
      ln.runs.forEach(function (r) {
        var parts = r.t.split(/( )/).filter(Boolean);
        parts.forEach(function (p, k) { toks.push({ t: p, r: r, first: !k, last: k === parts.length - 1 }); });
      });
      function push() {
        while (cur.length && cur[cur.length - 1].t === " ") cur.pop();
        var runs = [];
        cur.forEach(function (tk) {
          var last = runs[runs.length - 1];
          if (last && last.src === tk.r) last.t += tk.t; else runs.push({ t: tk.t, b: tk.r.b, i: tk.r.i, code: tk.r.code, href: tk.r.href, src: tk.r });
        });
        out.push({ runs: runs, indent: ln.indent, mark: first ? ln.mark : undefined });
        first = false; cur = []; cw = 0;
      }
      function width(tk) { return runW(tk.t, { b: tk.r.b, i: tk.r.i, code: tk.r.code, first: tk.first, last: tk.last }, fs, weight); }
      toks.forEach(function (tk) {
        if (tk.t === " ") { if (cur.length) { cur.push(tk); cw += width(tk); } return; }
        var tw = width(tk);
        if (cur.length && cw + tw > room + 0.5) push();
        while (tw > room && tk.t.length > 1) {        // a word longer than the line: cut where it fills it
          var n = tk.t.length - 1;
          while (n > 1 && width({ t: tk.t.slice(0, n), r: tk.r, first: tk.first }) > room - cw) n--;
          cur.push({ t: tk.t.slice(0, n), r: tk.r, first: tk.first, last: false }); push();
          tk = { t: tk.t.slice(n), r: tk.r, first: false, last: tk.last }; tw = width(tk);
        }
        cur.push(tk); cw += tw;
      });
      if (cur.length || first) push();
    });
    return out;
  }
  /** Lines in a box, centred in it (top: from its top); every run placed by its measured width, so the
   * marks keep their faces (bold, italic, code on its chip, a link underlined and linked); a list item
   * left-aligned with its marker before it. */
  function svgText(lines, r, fs, align, colour, top, weight) {
    var lh = fs * 1.4, y0 = top ? r.y : r.y + (r.h - lines.length * lh) / 2, out = "", wt = weight ? ' font-weight="' + weight + '"' : "";
    lines.forEach(function (ln, i) {
      var y = num(y0 + i * lh + lh / 2 + fs * 0.35), list = ln.indent > 0;
      var ws = ln.runs.map(function (u, k) { return runW(u.t, { b: u.b, i: u.i, code: u.code, first: true, last: true }, fs, weight); });
      var lw = ws.reduce(function (a, b) { return a + b; }, 0);
      var x = list || align === "left" ? r.x + ln.indent : align === "right" ? r.x + r.w - lw : r.x + (r.w - lw) / 2;
      if (ln.mark) out += '<text x="' + num(r.x + ln.indent - fs * 0.45) + '" y="' + y + '" font-size="' + fs + '" text-anchor="end" fill="' + colour + '"' + wt + ">" + kit.esc(ln.mark) + "</text>";
      ln.runs.forEach(function (u, k) {
        if (!u.t.trim()) { x += ws[k]; return; }
        var pad = u.code ? fs * 0.225 : 0, a = (u.b ? ' font-weight="700"' : wt) + (u.i ? ' font-style="italic"' : "") + (u.href ? ' text-decoration="underline"' : "") +
          (u.code ? ' font-family="' + kit.esc(monoFont) + '" font-size="' + num(fs * 0.9) + '"' : ' font-size="' + fs + '"');
        if (u.code) out += '<rect x="' + num(x) + '" y="' + num(y - fs * 0.35 - fs * 0.62) + '" width="' + num(ws[k]) + '" height="' + num(fs * 1.24) + '" rx="4" fill="' + colour + '" fill-opacity="0.12"/>';
        var t = '<text x="' + num(x + pad) + '" y="' + y + '" fill="' + colour + '"' + a + ' xml:space="preserve">' + kit.esc(u.t) + "</text>";
        out += u.href ? '<a href="' + kit.esc(u.href) + '" target="_blank">' + t + "</a>" : t;
        x += ws[k];
      });
    });
    return out;
  }
  function svgRun(run, fs) {   // a run inside one <text> (an arrow's label, centred as a whole)
    var a = (run.b ? ' font-weight="700"' : "") + (run.i ? ' font-style="italic"' : "") +
      (run.code ? ' font-family="' + kit.esc(monoFont) + '" font-size="' + num(fs * 0.9) + '"' : "") + (run.href ? ' text-decoration="underline"' : "");
    return a ? "<tspan" + a + ">" + kit.esc(run.t) + "</tspan>" : kit.esc(run.t);
  }
  function buildSvg() {
    var all = union(items.map(bb)) || { x: 0, y: 0, w: 400, h: 300 }, pad = 32, X = Math.floor(all.x - pad), Y = Math.floor(all.y - pad - 20);
    var W = Math.ceil(all.w + 2 * pad), H = Math.ceil(all.h + 2 * pad + 20), cs = getComputedStyle(root), S = solidColour;
    var bg = getComputedStyle(view).backgroundColor || "#ffffff", ink = S(strokeOf("ink")), line = cs.getPropertyValue("--color-border-strong").trim() || "#cbd5e1";
    var panel = cs.getPropertyValue("--color-panel").trim() || "#ffffff", muted = cs.getPropertyValue("--color-fg-muted").trim() || "#64748b";
    monoFont = cs.getPropertyValue("--font-mono").trim() || "ui-monospace, Consolas, monospace";
    baseFont = cs.fontFamily || "sans-serif";
    try { measCtx = measCtx || document.createElement("canvas").getContext("2d"); } catch (e) { measCtx = null; }
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="' + X + " " + Y + " " + W + " " + H + '" font-family="' +
      kit.esc(cs.fontFamily || "sans-serif") + '"><rect x="' + X + '" y="' + Y + '" width="' + W + '" height="' + H + '" fill="' + bg + '"/>';
    items.slice().sort(function (a, b) { return zOf[a.id] - zOf[b.id]; }).forEach(function (it) {
      var b = bb(it), c, fs = px(it), r, d;
      try {
        switch (it.type) {
          case "box": case "note":
            c = fillOf(it.color, it.type === "note" ? "yellow" : "green");
            var stroke = it.type === "note" ? "none" : S(it.stroke ? strokeOf(it.stroke) : it.hollow ? strokeOf("ink") : c.line), ins = inset(kindOf(it), b.w, b.h);
            s += '<g transform="translate(' + num(b.x) + " " + num(b.y) + ')"><path d="' + G.shapePath(kindOf(it), b.w, b.h) + '" fill="' + (it.hollow && it.type !== "note" ? "none" : S(c.bg)) +
              '" stroke="' + stroke + '" stroke-width="1.5" stroke-linejoin="round"/>' + svgText(svgLines(it.text, fs, ins.w), ins, fs, it.align || "center", S(boxInk(it))) + "</g>";
            break;
          case "text":
            s += svgText(svgLines(it.text, fs, it.w, false, fs >= 48 ? 600 : 0), b, fs, it.align || "left", S(strokeOf(it.color)), true, fs >= 48 ? 600 : 0);
            break;
          case "section":
            c = fillOf(it.color, "gray");
            s += '<rect x="' + num(b.x) + '" y="' + num(b.y) + '" width="' + num(b.w) + '" height="' + num(b.h) + '" rx="10" fill="' + S(c.bg) + '" fill-opacity="0.38" stroke="' + S(c.line) + '" stroke-width="1.5"/>' +
              '<text x="' + num(b.x + 2) + '" y="' + num(b.y - 8) + '" font-size="14" font-weight="600" fill="' + ink + '">' + kit.esc(plain(it.text)) + "</text>";
            break;
          case "arrow":
            r = routeOf(it); c = S(strokeOf(it.color));
            s += '<path d="' + r.d + '" fill="none" stroke="' + c + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' + (it.dash ? ' stroke-dasharray="7 6"' : "") + "/>";
            var hs = Array.isArray(it.heads) ? it.heads : ["none", "arrow"];
            [0, 1].forEach(function (i) {
              if (hs[i] !== "arrow" && hs[i] !== "circle") return;
              var hd = G.headPath(hs[i], i ? r.pts[r.pts.length - 1] : r.pts[0], headDir(r.pts, !i), 10);
              if (hd) s += '<path d="' + hd + '" fill="' + (hs[i] === "circle" ? bg : c) + '" stroke="' + c + '" stroke-width="1.8" stroke-linejoin="round"/>';
            });
            if (it.label) {
              var at = r.labelAt || r.mid, m = G.measure(it.label, 13), ln = svgLines(it.label, 13, 0, true)[0] || { runs: [] };
              s += '<rect x="' + num(at.x - m.w / 2 - 6) + '" y="' + num(at.y - 11) + '" width="' + num(m.w + 12) + '" height="22" rx="6" fill="' + bg + '"/>' +
                '<text x="' + num(at.x) + '" y="' + num(at.y + 4.5) + '" font-size="13" text-anchor="middle" fill="' + ink + '" xml:space="preserve">' +
                ln.runs.map(function (u) { return svgRun(u, 13); }).join("") + "</text>";
            }
            break;
          case "pen":
            d = G.penPath(it.points || [], it.x, it.y);
            s += '<path d="' + d + '" fill="none" stroke="' + S(strokeOf(it.color)) + '" stroke-width="' + clamp(+it.width || 3, 1, 40) + '" stroke-linecap="round" stroke-linejoin="round"/>';
            break;
          case "table":
            var lay = G.tableLayout(it), y = it.y;
            s += '<rect x="' + it.x + '" y="' + it.y + '" width="' + lay.w + '" height="' + lay.h + '" fill="' + panel + '" stroke="' + line + '"/>';
            if (lay.rowh.length) s += '<rect x="' + it.x + '" y="' + it.y + '" width="' + lay.w + '" height="' + lay.rowh[0] + '" fill="' + line + '" fill-opacity="0.35"/>';
            (it.rows || []).forEach(function (row, ri) {
              var x = it.x;
              lay.colw.forEach(function (cw, ci) {
                s += svgText(svgLines(row && row[ci] != null ? String(row[ci]) : "", 16, cw - 20, true, ri ? 0 : 600), { x: x + 10, y: y, w: cw - 20, h: lay.rowh[ri] }, 16, "left", ink, false, ri ? 0 : 600);
                if (ci) s += '<path d="M' + x + " " + it.y + "v" + lay.h + '" stroke="' + line + '"/>';
                x += cw;
              });
              if (ri) s += '<path d="M' + it.x + " " + y + "h" + lay.w + '" stroke="' + line + '"/>';
              y += lay.rowh[ri];
            });
            break;
          case "image": case "drawing":
            d = it.type === "drawing" ? (it.svg ? drawingUri(it.svg) : "") : imgSrc(it.src);
            if (/^data:/.test(d)) s += '<image x="' + num(b.x) + '" y="' + num(b.y) + '" width="' + num(b.w) + '" height="' + num(b.h) + '" preserveAspectRatio="xMidYMid meet" href="' + kit.esc(d) + '"/>';
            else s += '<rect x="' + num(b.x) + '" y="' + num(b.y) + '" width="' + num(b.w) + '" height="' + num(b.h) + '" fill="' + panel + '" stroke="' + line + '"/>';
            break;
          case "embed":
            s += '<rect x="' + num(b.x) + '" y="' + num(b.y) + '" width="' + num(b.w) + '" height="' + num(b.h) + '" rx="8" fill="' + panel + '" stroke="' + line + '" stroke-dasharray="5 5"/>' +
              svgText([{ runs: [{ t: String(it.title || T.embed) }], indent: 0 }], b, 15, "center", muted);
            break;
        }
      } catch (e) {}
    });
    return { svg: s + "</svg>", w: W, h: H };
  }
  function fileName() { return kit.slug(title || C.title || "board"); }
  function exportSvg() { endEdit(); kit.download(fileName() + ".svg", buildSvg().svg, "image/svg+xml"); }
  function exportPng() {
    endEdit();
    var o = buildSvg(), k = Math.max(0.1, Math.min(2, 8000 / Math.max(o.w, o.h))), img = new Image();
    img.onload = function () {
      try {
        var cv = document.createElement("canvas");
        cv.width = Math.round(o.w * k); cv.height = Math.round(o.h * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) { if (b) kit.download(fileName() + ".png", b, "image/png"); else kit.toast(T.expFail); }, "image/png");
      } catch (e) { kit.toast(T.expFail); }
    };
    img.onerror = function () { kit.toast(T.expFail); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(o.svg);
  }
  var exportList = [{ id: "png", label: T.expPng, run: exportPng }, { id: "svg", label: T.expSvg, run: exportSvg }];

  // ------------------------------------------------------------------ history: list, view-only preview in place, restore
  var dtFmt = new Intl.DateTimeFormat(L === "hu" ? "hu" : "en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function openHistory(anchor) {
    if (!live || !hm.board.history) return;
    endEdit(); nudgeEnd(); flush();
    chain.then(function () { return hm.board.history(); }).then(function (r) {
      var cur = r && r.rev != null ? r.rev : rev, list = ((r && r.snaps) || []).filter(function (x) { return x.rev < cur; });
      if (!list.length) return menu(anchor, [{ hint: T.histNone }]);
      menu(anchor, list.slice(0, 30).map(function (x) {
        var who = x.by === "hermes" ? T.byH : x.by === "restore" ? T.byRestore : x.by === "start" ? "" : T.byYou;
        return { label: dtFmt.format(new Date(x.at * 1000)) + (who ? " · " + who : ""), onClick: function () { showPreview(x); } };
      }));
    }).catch(function (e) { kit.toast(String(e && e.message || e)); });
  }
  function swap(list) {
    endEdit(); cancelGesture(); setInteract(null); closePop();
    resetNodes();
    items = list; sel = []; fresh = {};
    index();
  }
  function showPreview(x) {
    hm.board.at(x.rev).then(function (r) {
      if (!r || !Array.isArray(r.items)) return;
      var keep = preview ? preview.keep : items;
      swap(normItems(r.items));
      preview = { rev: x.rev, keep: keep };
      ro = true; root.classList.add("bd-ro", "bd-preview");
      banner.textContent = "";
      banner.append(h("span", { text: fill(T.showing, { t: dtFmt.format(new Date((r.at || x.at) * 1000)) }) }),
        h("button", { type: "button", "class": "kit-btn bd-pri", text: T.restoreThis, onclick: function () {
          hm.board.restore(x.rev).then(function () { closePreview(); undoS = []; redoS = []; undoSync(); kit.toast(T.restored); return readAll(); })
            .catch(function (e) { kit.toast(String(e && e.message || e)); });
        } }),
        h("button", { type: "button", "class": "kit-btn", text: T.backNow, onclick: closePreview }));
      banner.hidden = false;
      cull(); drawCtx(); drawUi(); undoSync();
    }).catch(function (e) { kit.toast(String(e && e.message || e)); });
  }
  function closePreview() {
    if (!preview) return;
    var keep = preview.keep;
    preview = null;
    swap(keep);
    ro = !live; root.classList.remove("bd-preview"); root.classList.toggle("bd-ro", ro);
    banner.hidden = true;
    afterChange();
    pull();
  }

  // ------------------------------------------------------------------ view context (goes along with the next chat message)
  function sendView() {
    if (C.thumb || !live) return;
    kit.view(function () {
      var v = viewWorld();
      return { selected: sel.slice(0, 100), viewport: { x: rnd(v.x), y: rnd(v.y), w: rnd(v.w), h: rnd(v.h) } };
    });
  }

  // ------------------------------------------------------------------ keyboard
  document.addEventListener("keydown", function (e) {
    if (C.thumb) return;
    var t = e.target, k = e.key, lk = k.length === 1 ? k.toLowerCase() : k, mod = e.ctrlKey || e.metaKey, m = document.querySelector(".kit-menu");
    if (m) {
      var bs = Array.prototype.slice.call(m.querySelectorAll("button")), at = bs.indexOf(document.activeElement);
      if (k === "Escape") { e.preventDefault(); if (m.close) m.close(); if (menuAnchor && menuAnchor.focus) menuAnchor.focus(); return; }
      if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); if (bs.length) bs[(at + (k === "ArrowDown" ? 1 : at < 0 ? 0 : -1) + bs.length) % bs.length].focus(); return; }
      if (k === "Tab") { if (m.close) m.close(); }
    }
    if (mod && lk === "k" && canAsk) { e.preventDefault(); if (askEl.hidden) openAsk(); else { closeAsk(); view.focus({ preventScroll: true }); } return; }
    if (typingIn(t)) return;
    var onBtn = !!(t && t.closest && t.closest("button,a[href],summary"));
    if (mod) {
      if (k === "=" || k === "+") zoomStep(1);
      else if (k === "-" || k === "_") zoomStep(-1);
      else if (k === "0") fitAll();
      else if (ro) { if (lk === "a") e.preventDefault(); return; }   // view only: Ctrl+A selects nothing (never the page's words)
      else if (lk === "z") { if (e.shiftKey) redo(); else undo(); }
      else if (lk === "y") redo();
      else if (lk === "a") selectAll();
      else if (lk === "d") duplicate();
      else if (lk === "g") { if (e.shiftKey) ungroup(); else group(); }
      else if (lk === "b") toggleMark("**");
      else if (lk === "i") toggleMark("*");
      else return;
      e.preventDefault();
      return;
    }
    if (e.altKey) return;
    if (k.indexOf("Arrow") === 0 && !onBtn) {
      var dx = k === "ArrowLeft" ? -1 : k === "ArrowRight" ? 1 : 0, dy = k === "ArrowUp" ? -1 : k === "ArrowDown" ? 1 : 0, st = e.shiftKey ? 10 : 1;
      e.preventDefault();
      if (sel.length && canEdit()) nudge(dx * st, dy * st); else setCam(cam.x - dx * 60, cam.y - dy * 60, cam.z);
      return;
    }
    if (ro) return;
    if (k === " " && !onBtn) { e.preventDefault(); if (!spaceDown) { spaceDown = true; view.classList.add("bd-grab"); } return; }
    if (onBtn && (k === "Enter" || k === " ")) return;
    if (k === "Escape") {
      if (popEl) escPop();
      else if (g) cancelGesture();
      else if (interact) setInteract(null);
      else if (tool !== "select") setTool("select");
      else if (!askEl.hidden) closeAsk();
      else if (sel.length) { setSel([]); announce(); }
      return;
    }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); deleteSel(); return; }
    if (k === "Tab" && t === view) { if (cycle(e.shiftKey ? -1 : 1)) e.preventDefault(); return; }
    if (k === "Enter" && t === view && sel.length === 1) { e.preventDefault(); openItem(byId[sel[0]], null); return; }
    if (k === "]") { orderSel("front"); return; }
    if (k === "[") { orderSel("back"); return; }
    if (k.length === 1) {
      if (prefs.keys && TOOLKEY[lk]) { e.preventDefault(); setTool(TOOLKEY[lk]); return; }
      var one = sel.length === 1 && byId[sel[0]];
      if (t === view && one && TEXTY[one.type] && !one.locked && canEdit()) { e.preventDefault(); startEdit(one.id, { ch: k }); }
    }
  });
  document.addEventListener("keyup", function (e) { if (e.key === " ") { spaceDown = false; view.classList.remove("bd-grab"); } });
  window.addEventListener("blur", function () { spaceDown = false; view.classList.remove("bd-grab"); });

  // The theme changing: everything follows through the variables, except drawings (pictures with the ink written in).
  function themeChanged() { items.forEach(function (it) { if (it.type === "drawing") nd(it.id).dirty = true; }); cullSoon(); }
  if (kit.hostTheme) kit.hostTheme(themeChanged);
  if (window.MutationObserver && !C.thumb) new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (window.matchMedia) { try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", themeChanged); } catch (e) {} }

  // ------------------------------------------------------------------ start
  items = normItems(B0.items);
  index();
  if (ro) root.classList.add("bd-ro");
  if (live) {                                            // no bridge, a thumbnail: the board alone, no chrome
    root.insertBefore(topEl, view);                      // the toolbars come before the canvas in the Tab order
    root.append(banner, pill);
    if (!hm.board.history) histBtn.hidden = true;
    TOOLS.forEach(function (x) {
      var b = h("button", { type: "button", "class": "kit-btn bd-tb", title: x[1] + (x[2] ? " (" + x[2] + ")" : ""), "aria-label": x[1], "aria-pressed": "false", html: x[3] ? kit.icon(x[3]) : "" });
      b.addEventListener("click", function () { setTool(x[0], b); });
      toolBtn[x[0]] = b;
      toolsEl.appendChild(b);
    });
    if (canAsk) {
      toolsEl.append(h("span", { "class": "bd-sep" }), h("button", { type: "button", "class": "kit-btn bd-tb bd-asktb", title: T.ask + " (Ctrl+K)", "aria-label": T.ask, html: kit.icon("sparkle"),
        onclick: function () { if (askEl.hidden) openAsk(); else closeAsk(); } }));
    }
    root.insertBefore(toolsEl, view); root.insertBefore(askEl, view); root.insertBefore(zoomEl, view);
    toolSync();
    kit.exports(exportList).then(function (took) { expBtn.hidden = !!took; });
  }
  var booted = false;
  function boot() {
    measureView();
    if (booted || vw < 2 || vh < 2) return;
    booted = true;
    var sv = ro ? null : loadJson(VKEY);
    if (sv && isFinite(sv.x + sv.y + sv.z) && sv.z >= 0.05 && sv.z <= 4) { cam.x = sv.x; cam.y = sv.y; cam.z = sv.z; applyCam(); }
    else fitAll(true);
    drawCtx(); undoSync();
    kit.ready();
  }
  boot();
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      if (!booted) return boot();
      measureView();
      if (ro && !preview) fitAll(true); else { cullSoon(); }
    }).observe(view);
  } else window.addEventListener("resize", function () { measureView(); cullSoon(); });
  if (!booted) setTimeout(function () { if (!booted) { vw = vw < 2 ? 800 : vw; vh = vh < 2 ? 600 : vh; booted = true; fitAll(true); kit.ready(); } }, 300);
  setHermes(!!B0.hermes_active, B0.hermes_left);
  if (live) {
    hm.on("board", function () { pull(); });
    setInterval(function () { if (!document.hidden && !busy()) pull(); }, 4000);
    window.addEventListener("pagehide", function () { endEdit(); nudgeEnd(); flush(); });
    document.addEventListener("visibilitychange", function () { if (document.hidden) { nudgeEnd(); flush(); } });
  }
})();
