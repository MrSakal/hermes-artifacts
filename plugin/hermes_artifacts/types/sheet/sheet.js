/* hermes-artifacts Sheet runtime: a live spreadsheet the user and Hermes edit together.
 *
 * The workbook lives on the Hermes server (sheets.py) as sparse cells per sheet; the formula engine
 * (formula.js) runs here only. The grid is virtualised: a sticky viewport of up to nine panes (headers,
 * frozen rows/columns, the scrolling body) in which only the visible cells exist, with one selection
 * overlay per pane. Every edit is applied here at once and sent as ops (batched); Hermes' edits arrive
 * through the `sheet` event and glow for a moment. Exports: Excel (.xlsx) and CSV through xlsx.js.
 */
(function () {
  "use strict";
  // The UI's words in the app's language (hu over en, key by key).
  function pickLang(t, l) { var o = {}, k; for (k in t.en) o[k] = t.en[k]; for (k in t[l] || {}) o[k] = t[l][k]; return o; }
  var kit = window.kit, h = kit.h, C = kit.content, hm = window.hermes, F = window.sheetFormula || null, X = window.sheetXlsx || null;
  var L = /^hu\b/i.test(C.lang || navigator.language || "") ? "hu" : "en";

  // ------------------------------------------------------------------ strings
  var T = pickLang({
    en: { undo: "Undo", redo: "Redo", bold: "Bold", italic: "Italic", underline: "Underline",
      alignL: "Align left", alignC: "Centre", alignR: "Align right", wrap: "Wrap text",
      numFmt: "Number format", nGeneral: "General", nNumber: "Number (0.00)", nThousands: "Thousands (1,234)", nPercent: "Percent", nFt: "Currency (Ft)",
      nEur: "Currency (€)", nUsd: "Currency ($)", nDate: "Date", nText: "Text",
      fill: "Fill colour", textColor: "Text colour", noFill: "No fill", autoColor: "Automatic",
      insert: "Insert and delete", rowAbove: "Insert row above", rowBelow: "Insert row below", colLeft: "Insert column left", colRight: "Insert column right",
      delRows: "Delete row", delCols: "Delete column", sortAsc: "Sort A → Z", sortDesc: "Sort Z → A", sort: "Sort",
      freeze: "Freeze panes", freezeRow: "Freeze top row", freezeCol: "Freeze first column", freezeHere: "Freeze up to the selection", unfreeze: "Unfreeze panes",
      clear: "Clear contents", clearFmt: "Clear formats", comment: "Comment", ask: "Ask Hermes", askQ: "What should Hermes do with {r}?", send: "Send", cancel: "Cancel",
      chart: "Chart", cBar: "Bar chart", cLine: "Line chart", cPie: "Pie chart", delChart: "Delete chart", chartNeeds: "Select the data first (labels in the first column)",
      series: "Series", find: "Find", findPh: "Find in sheet", noMatch: "No match", prev: "Previous", next: "Next", close: "Close",
      hist: "History", histNone: "No earlier states yet", byYou: "you", byH: "Hermes", byRestore: "restored", showing: "Showing the state of {t}",
      restoreThis: "Restore this state", restored: "Restored", backNow: "Back to now",
      exp: "Export", xlsx: "Excel (.xlsx)", csv: "CSV (this sheet)", imp: "Import", impNew: "Import into a new sheet…", impReplace: "Import, replacing this sheet…",
      building: "Building…", noLib: "The export library didn't load (open the sheet in Hermes Desktop)", noXlsx: "Excel files can't be read or written here",
      saving: "Saving…", saved: "Saved", offline: "Read-only: open the latest version in Hermes Desktop to edit",
      conflict: "Hermes changed these cells meanwhile: they now show Hermes' values", sheetWord: "Sheet", addSheet: "New sheet", rename: "Rename",
      delSheet: "Delete sheet", delSheetQ: "Delete this sheet and everything on it?", del: "Delete", moveL: "Move left", moveR: "Move right",
      badName: "A sheet name is 1–40 characters, none of [ ] : * ? / \\ ' ! and not used twice",
      sum: "Sum", avg: "Average", count: "Count", working: "Hermes is working…", byHermes: "Hermes", sent: "Sent to Hermes",
      drafted: "Put in the chat box: press Enter there", more: "More", nameBox: "Name box", formulaBar: "Formula bar", grid: "Sheet",
      cellAnn: "{k}: {v}", empty: "empty", copy: "Copy", cut: "Cut", paste: "Paste", pasteHint: "Press Ctrl+V to paste",
      limit: "A sheet holds at most 5000 rows and 100 columns", imported: "Imported", notUndoable: "That change is too large to undo",
      ok: "OK", fx: "fx" },
    hu: { undo: "Visszavonás", redo: "Mégis", bold: "Félkövér", italic: "Dőlt", underline: "Aláhúzott",
      alignL: "Balra igazítás", alignC: "Középre igazítás", alignR: "Jobbra igazítás", wrap: "Sortöréssel több sorba",
      numFmt: "Számformátum", nGeneral: "Általános", nNumber: "Szám (0,00)", nThousands: "Ezres tagolás (1 234)", nPercent: "Százalék", nFt: "Pénznem (Ft)",
      nEur: "Pénznem (€)", nUsd: "Pénznem ($)", nDate: "Dátum", nText: "Szöveg",
      fill: "Kitöltőszín", textColor: "Betűszín", noFill: "Nincs kitöltés", autoColor: "Automatikus",
      insert: "Beszúrás és törlés", rowAbove: "Sor beszúrása fölé", rowBelow: "Sor beszúrása alá", colLeft: "Oszlop beszúrása balra", colRight: "Oszlop beszúrása jobbra",
      delRows: "Sor törlése", delCols: "Oszlop törlése", sortAsc: "Rendezés A → Z", sortDesc: "Rendezés Z → A", sort: "Rendezés",
      freeze: "Panelek rögzítése", freezeRow: "Felső sor rögzítése", freezeCol: "Első oszlop rögzítése", freezeHere: "Rögzítés a kijelölésig", unfreeze: "Panelek feloldása",
      clear: "Tartalom törlése", clearFmt: "Formátumok törlése", comment: "Megjegyzés", ask: "Kérdezd a Hermest", askQ: "Mit csináljon a Hermes ezzel: {r}?", send: "Küldés", cancel: "Mégse",
      chart: "Diagram", cBar: "Oszlopdiagram", cLine: "Vonaldiagram", cPie: "Kördiagram", delChart: "Diagram törlése", chartNeeds: "Előbb jelöld ki az adatokat (címkék az első oszlopban)",
      series: "Adatsor", find: "Keresés", findPh: "Keresés a munkalapon", noMatch: "Nincs találat", prev: "Előző", next: "Következő", close: "Bezárás",
      hist: "Előzmények", histNone: "Még nincs korábbi állapot", byYou: "te", byH: "Hermes", byRestore: "visszaállítva", showing: "A(z) {t} állapot látszik",
      restoreThis: "Visszaállítás erre", restored: "Visszaállítva", backNow: "Vissza a mostanihoz",
      exp: "Exportálás", xlsx: "Excel (.xlsx)", csv: "CSV (ez a munkalap)", imp: "Importálás", impNew: "Importálás új munkalapra…", impReplace: "Importálás, ennek a munkalapnak a helyére…",
      building: "Készül…", noLib: "Az export könyvtár nem töltődött be (nyisd meg a Hermes Desktopban)", noXlsx: "Excel fájl itt nem olvasható és nem írható",
      saving: "Mentés…", saved: "Elmentve", offline: "Csak olvasható: a szerkesztéshez nyisd meg a legújabb verziót a Hermes Desktopban",
      conflict: "Ezeket a cellákat közben a Hermes módosította: most az ő értékei látszanak", sheetWord: "Munkalap", addSheet: "Új munkalap", rename: "Átnevezés",
      delSheet: "Munkalap törlése", delSheetQ: "Törlöd ezt a munkalapot a teljes tartalmával együtt?", del: "Törlés", moveL: "Áthelyezés balra", moveR: "Áthelyezés jobbra",
      badName: "A munkalap neve 1–40 karakter, nem lehet benne [ ] : * ? / \\ ' ! és nem lehet foglalt",
      sum: "Összeg", avg: "Átlag", count: "Darab", working: "A Hermes dolgozik…", byHermes: "Hermes", sent: "Elküldve a Hermesnek",
      drafted: "Beírva a chat mezőbe: nyomj ott Entert", more: "Továbbiak", nameBox: "Név mező", formulaBar: "Szerkesztőléc", grid: "Munkalap",
      cellAnn: "{k}: {v}", empty: "üres", copy: "Másolás", cut: "Kivágás", paste: "Beillesztés", pasteHint: "A beillesztéshez nyomd meg a Ctrl+V-t",
      limit: "Egy munkalap legfeljebb 5000 sort és 100 oszlopot tartalmazhat", imported: "Importálva", notUndoable: "Ez a módosítás túl nagy a visszavonáshoz",
      ok: "OK", fx: "fx" }
  }, L);
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] == null ? m : o[k]; }); }

  // Icons the kit does not have (24-unit paths, drawn like kit.icon).
  var ICO = {
    wrap: "M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h6",
    bucket: "M5 11l7-7 7 7-7 7zM5 11h14M20 15c0 1.2-.8 2-1.5 2S17 16.2 17 15s1.5-3 1.5-3 1.5 1.8 1.5 3z",
    fcolor: "M6 17L12 4l6 13M8.5 12h7",
    freeze: "M4 4h16v16H4zM4 9h16M9 4v16",
    sort: "M7 4v16M4 17l3 3 3-3M14 6h6M14 11h4M14 16h2",
    chart: "M4 20V10M10 20V4M16 20v-7M21 20H3",
    rows: "M4 5h16v14H4zM4 12h16M12 8v8M8 12h8",
    search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20",
    upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
    num: "M9 4L7 20M17 4l-2 16M4 9h16M3 15h16",
    eraser: "M8 20h12M5 14l8-8 6 6-6 6H9z"
  };
  function ico(name) {
    var p = ICO[name];
    if (!p) return kit.icon(name);
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + p + '"/></svg>';
  }

  // ------------------------------------------------------------------ A1 helpers (own, so the grid works even without the engine)
  var MAXR = 5000, MAXC = 100;
  function colName(n) { var s = ""; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function colIdx(s) { var n = 0; s = String(s).toUpperCase().replace(/\$/g, ""); for (var i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64; return n - 1; }
  function key(r, c) { return colName(c) + (r + 1); }
  function parseKey(k) { var m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(k)); return m ? { r: +m[2] - 1, c: colIdx(m[1]) } : null; }
  function parseRange(s) {
    var p = String(s || "").replace(/^.*!/, "").split(":"), a = parseKey(p[0]), b = parseKey(p[1] || p[0]);
    if (!a || !b) return null;
    return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  }
  function rangeName(R) { return R.r1 === R.r2 && R.c1 === R.c2 ? key(R.r1, R.c1) : key(R.r1, R.c1) + ":" + key(R.r2, R.c2); }
  function inR(R, r, c) { return r >= R.r1 && r <= R.r2 && c >= R.c1 && c <= R.c2; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function isFormula(v) { return typeof v === "string" && v.length > 1 && v.charAt(0) === "="; }
  function isErr(v) { return !!(v && typeof v === "object" && v.error); }
  var ERRS = /^#(DIV\/0!|NAME\?|REF!|VALUE!|N\/A|NUM!|CYCLE!|NULL!)$/;
  function isDate(v) { return typeof v === "string" && /^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$/.test(v); }
  function same(a, b) { return a === b || (a == null || a === "") && (b == null || b === ""); }
  function jsonEq(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }

  // ------------------------------------------------------------------ model
  // book: [{id, name, rev, cells{A1: raw}, fmt{A1:{…}}, vals{A1: computed}, cols{A: px}, freeze{rows, cols}, charts[]}]
  var FMT_KEYS = ["bold", "italic", "underline", "align", "num", "bg", "fg", "wrap"];
  var live = !!(hm && hm.sheet && hm.sheet.edit) && !C.thumb && !!C.sheet;
  var book = [], cur = 0, hermesActive = false, edits = 0, preview = null;
  function normSheet(o) {
    return { id: o.id || "local-" + Math.random().toString(36).slice(2, 8), name: o.name || T.sheetWord + " 1", rev: o.rev || 0,
      cells: o.cells || {}, fmt: o.fmt || {}, vals: o.vals || {}, cols: o.cols || {},
      freeze: { rows: (o.freeze && o.freeze.rows) || 0, cols: (o.freeze && o.freeze.cols) || 0 },
      charts: (o.charts || []).map(function (c, i) { var x = {}; for (var k in c) x[k] = c[k]; x.id = x.id || "c" + (i + 1); return x; }) };
  }
  // A published sheet.json (an earlier version, or no server): its rows, range formats spread per cell.
  function fromJson(j) {
    return ((j && j.sheets) || []).slice(0, 20).map(function (sh, i) {
      var cells = {}, fmt = {}, maxR = 0, maxC = 0;
      (sh.rows || []).forEach(function (row, r) {
        (row || []).forEach(function (v, c) { if (v !== null && v !== undefined && v !== "") { cells[key(r, c)] = v; maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); } });
      });
      Object.keys(sh.formats || {}).forEach(function (rg) {
        var R = parseRange(rg); if (!R) return;
        R.r2 = Math.min(R.r2, maxR + 200, MAXR - 1); R.c2 = Math.min(R.c2, MAXC - 1);
        for (var r = R.r1; r <= R.r2; r++) for (var c = R.c1; c <= R.c2; c++) {
          var k = key(r, c), f = fmt[k] || (fmt[k] = {}), src = sh.formats[rg];
          for (var x in src) if (src[x] != null) f[x] = src[x];
        }
      });
      return normSheet({ id: "local-" + i, name: sh.name || T.sheetWord + " " + (i + 1), cells: cells, fmt: fmt, cols: sh.cols, freeze: sh.freeze, charts: sh.charts });
    });
  }
  if (C.sheet && C.sheet.sheets && C.sheet.sheets.length) {
    book = C.sheet.sheets.map(normSheet);
    hermesActive = !!C.sheet.hermes_active;
  } else {
    var j0 = null;
    try { j0 = JSON.parse(kit.fileText("sheet.json") || "null"); } catch (e) { j0 = null; }
    book = fromJson(j0);
    if (!book.length) book = [normSheet({ name: T.sheetWord + " 1" })];
  }
  var editable = live;
  function ro() { return !editable || !!preview; }
  function S() { return preview || book[cur]; }
  function byId(id) { for (var i = 0; i < book.length; i++) if (book[i].id === id) return book[i]; return null; }
  function byName(n) {
    n = String(n || "").toLowerCase();
    for (var i = 0; i < book.length; i++) if (book[i].name.toLowerCase() === n) return preview && preview.id === book[i].id ? preview : book[i];
    return null;
  }
  // The used extent (last row/column holding a value), cached until the cells change.
  function used(s) {
    if (s._used) return s._used;
    var mr = -1, mc = -1;
    for (var k in s.cells) { var p = parseKey(k); if (p) { if (p.r > mr) mr = p.r; if (p.c > mc) mc = p.c; } }
    for (var i = 0; i < s.charts.length; i++) { var a = parseKey(s.charts[i].at); if (a) { mr = Math.max(mr, a.r + 10); mc = Math.max(mc, a.c + 4); } }
    return (s._used = { r: mr, c: mc });
  }

  // ------------------------------------------------------------------ engine glue
  var wb = null;
  function makeWb() {
    if (!F || !F.workbook) return null;
    try {
      return F.workbook(function (name, k) { var s = byName(name); return s ? s.cells[k] : undefined; },
        function () { return book.map(function (s) { return s.name; }); },
        function (name) { var s = byName(name), u = s ? used(s) : { r: -1, c: -1 }; return { rows: u.r + 1, cols: u.c + 1 }; },
        { locale: L });
    } catch (e) { console.error("sheet engine", e); return null; }
  }
  wb = makeWb();
  function invalidate() { if (wb && wb.invalidate) { try { wb.invalidate(); } catch (e) { wb = makeWb(); } } else wb = makeWb(); }
  /** The computed value of a cell: number | string | boolean | null | {error}. */
  function valueOf(s, k) {
    var raw = s.cells[k];
    if (raw === undefined || raw === null || raw === "") return null;
    if (!isFormula(raw)) return raw;
    if (wb) { try { return wb.value(s.name, k); } catch (e) { return { error: "#VALUE!" }; } }
    var v = s.vals[k];
    if (typeof v === "string" && ERRS.test(v)) return { error: v };
    return v === undefined ? null : v;
  }
  var fmtNum = new Intl.NumberFormat(L === "hu" ? "hu-HU" : "en-US", { maximumFractionDigits: 10, useGrouping: false });
  function display(s, k, v) {
    if (v === null || v === undefined || v === "") return "";
    if (isErr(v)) return String(v.error);
    var f = s.fmt[k], num = f && f.num;
    if (!num && isDate(v)) num = /T/.test(v) ? (L === "hu" ? "yyyy.mm.dd. hh:mm" : "yyyy-mm-dd hh:mm") : L === "hu" ? "yyyy.mm.dd." : "yyyy-mm-dd";
    if (F && F.format) { try { return String(F.format(v, num || null, L)); } catch (e) {} }
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number") return fmtNum.format(v);
    return String(v);
  }
  /** The text a cell is edited as. */
  function rawText(raw) {
    if (raw === undefined || raw === null) return "";
    if (typeof raw === "number") return L === "hu" ? String(raw).replace(".", ",") : String(raw);
    if (typeof raw === "boolean") return raw ? "TRUE" : "FALSE";
    return String(raw);
  }
  /** What the user typed -> {value, num?}: formulas normalised, the rest through parseInput. */
  function parseText(text) {
    if (text === "") return { value: "" };
    if (text.charAt(0) === "=" && text.length > 1) {
      var f = text;
      if (F && F.normalize) { try { f = F.normalize(text, L); } catch (e) { f = text; } }
      return { value: f };
    }
    if (F && F.parseInput) {
      try {
        var p = F.parseInput(text, L);
        if (p && typeof p === "object" && "value" in p) return { value: p.value === undefined ? text : p.value, num: p.num || null };
        return { value: p === undefined ? text : p };
      } catch (e) {}
    }
    var t = text.trim(), n = L === "hu" ? t.replace(/\s/g, "").replace(",", ".") : t.replace(/,/g, "");
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(n)) return { value: parseFloat(n) };
    if (/^(true|false)$/i.test(t)) return { value: /^t/i.test(t) };
    return { value: text };
  }
  function cellKind(v) {
    if (isErr(v)) return "e";
    if (typeof v === "number" || isDate(v)) return "n";
    if (typeof v === "boolean") return "b";
    return "";
  }

  // ------------------------------------------------------------------ geometry and the panes
  var RH = 24, HH = 24, HW = 46, DW = 96;
  var nRows = 50, nCols = 26, colX = [0], fr = 0, fc = 0, FW = 0, FH = 0, sl = 0, st = 0, vpW = 0, vpH = 0;
  var grid = document.getElementById("sh-grid");
  grid.setAttribute("aria-label", T.grid);
  var wrapEl = h("div", { "class": "sh-wrap" }), vp = h("div", { "class": "sh-vp" });
  wrapEl.appendChild(vp); grid.appendChild(wrapEl);
  var MODES = ["h", "f", "m"], Q = [], cellQ = [];
  MODES.forEach(function (ym) {
    MODES.forEach(function (xm) {
      var q = { xm: xm, ym: ym, el: h("div", { "class": "sh-q" }), inner: h("div", { "class": "sh-in" }), pool: [], used: 0, rr: null, cc: null };
      q.el.appendChild(q.inner); vp.appendChild(q.el); Q.push(q);
      if (xm !== "h" && ym !== "h") {
        q.ov = { sel: h("div", { "class": "sh-sel", hidden: true }), act: h("div", { "class": "sh-active", hidden: true }),
          handle: h("div", { "class": "sh-handle", hidden: true }), fill: h("div", { "class": "sh-fillbox", hidden: true }),
          clip: h("div", { "class": "sh-clip", hidden: true }), refs: h("div"), charts: h("div") };
        q.layer = h("div", { style: "position:absolute;left:0;top:0" }, [q.ov.sel, q.ov.clip, q.ov.fill, q.ov.act, q.ov.handle, q.ov.refs, q.ov.charts]);
        q.inner.appendChild(q.layer);
        cellQ.push(q);
      }
      if (xm === "h" && ym === "h") { q.corner = h("div", { "class": "sh-corner", title: "Ctrl+A" }); q.inner.appendChild(q.corner); }
    });
  });
  var fzX = h("div", { "class": "sh-fz-x", hidden: true }), fzY = h("div", { "class": "sh-fz-y", hidden: true }), resizeLine = h("div", { "class": "sh-resize", hidden: true });
  vp.appendChild(fzX); vp.appendChild(fzY); vp.appendChild(resizeLine);

  function cw(s, c) { var w = s.cols[colName(c)]; return w ? clamp(+w || DW, 24, 800) : DW; }
  function colAt(x) {
    var lo = 0, hi = nCols - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (colX[mid] <= x) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function layout() {
    var s = S(), u = used(s);
    nRows = clamp(Math.max(nRows, 50, u.r + 30), 1, MAXR);
    nCols = clamp(Math.max(nCols, 26, u.c + 4), 1, MAXC);
    colX = [0];
    for (var c = 0; c < nCols; c++) colX.push(colX[c] + cw(s, c));
    fr = clamp(s.freeze.rows || 0, 0, Math.min(nRows - 1, 50)); fc = clamp(s.freeze.cols || 0, 0, Math.min(nCols - 1, 20));
    FW = colX[fc]; FH = fr * RH;
    wrapEl.style.width = HW + colX[nCols] + "px"; wrapEl.style.height = HH + nRows * RH + "px";
    size();
  }
  function size() {
    vpW = grid.clientWidth; vpH = grid.clientHeight;
    vp.style.width = vpW + "px"; vp.style.height = vpH + "px";
    sl = grid.scrollLeft; st = grid.scrollTop;
    Q.forEach(function (q) {
      var x = q.xm === "h" ? 0 : q.xm === "f" ? HW : HW + FW, w = q.xm === "h" ? HW : q.xm === "f" ? FW : Math.max(0, vpW - HW - FW);
      var y = q.ym === "h" ? 0 : q.ym === "f" ? HH : HH + FH, hh = q.ym === "h" ? HH : q.ym === "f" ? FH : Math.max(0, vpH - HH - FH);
      q.el.style.cssText = "left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + hh + "px" + (w && hh ? "" : ";display:none");
    });
    fzX.hidden = !fc; fzX.style.left = HW + FW - 1 + "px";
    fzY.hidden = !fr; fzY.style.top = HH + FH - 1 + "px";
    translate();
  }
  function translate() {
    Q.forEach(function (q) {
      var tx = q.xm === "m" ? -(FW + sl) : 0, ty = q.ym === "m" ? -(FH + st) : 0;
      q.inner.style.transform = "translate(" + tx + "px," + ty + "px)";
    });
  }
  function colsFor(xm, pad) {
    if (xm === "h") return null;
    if (xm === "f") return fc ? [0, fc - 1] : null;
    var a = colAt(FW + sl) - pad, b = colAt(FW + sl + Math.max(0, vpW - HW - FW)) + pad;
    return [Math.max(fc, a), Math.min(nCols - 1, b)];
  }
  function rowsFor(ym, pad) {
    if (ym === "h") return null;
    if (ym === "f") return fr ? [0, fr - 1] : null;
    var a = Math.floor((FH + st) / RH) - pad, b = Math.floor((FH + st + Math.max(0, vpH - HH - FH)) / RH) + pad;
    return [Math.max(fr, a), Math.min(nRows - 1, b)];
  }
  function within(have, want) { return !want || (have && want[0] >= have[0] && want[1] <= have[1]); }

  // ------------------------------------------------------------------ rendering (pooled cells, no per-cell listeners)
  var meas = document.createElement("canvas").getContext("2d"), measFont = "";
  function textW(t, bold) {
    var f = (bold ? "600 " : "400 ") + "13px " + (getComputedStyle(document.body).fontFamily || "sans-serif");
    if (f !== measFont) { meas.font = f; measFont = f; }
    return meas.measureText(t).width;
  }
  var flashSet = {}, foundSet = null;
  function slot(q, i) {
    var el = q.pool[i];
    if (!el) { el = document.createElement("div"); q.pool.push(el); q.inner.insertBefore(el, q.layer || null); }
    return el;
  }
  // Text on a filled cell: dark on light fills, light on dark ones, whatever the theme.
  var inks = {};
  function inkOn(bg) {
    if (inks[bg]) return inks[bg];
    var x = bg.slice(1); if (x.length === 3) x = x.replace(/./g, "$&$&");
    var n = parseInt(x.slice(0, 6), 16), l = 0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255);
    return (inks[bg] = l > 150 ? "#1f2328" : "#f5f7fa");
  }
  function empty(s, r, c) { var v = s.cells[key(r, c)]; return v === undefined || v === null || v === ""; }
  function renderQ(q, force) {
    var s = S(), wantR = rowsFor(q.ym, 0), wantC = colsFor(q.xm, 0);
    if (!force && q.rr !== undefined && within(q.rr, wantR) && within(q.cc, wantC)) return;
    var rr = rowsFor(q.ym, 10), cc = colsFor(q.xm, 3), i = 0, R = selR(), whole = selMode;
    q.rr = rr; q.cc = cc;
    if (q.xm === "h" && q.ym === "h") {
      q.corner.style.cssText = "width:" + HW + "px;height:" + HH + "px";
    } else if (q.ym === "h") {
      if (cc) for (var c = cc[0]; c <= cc[1]; c++) {
        var el = slot(q, i++);
        el.className = "sh-h col" + (c >= R.c1 && c <= R.c2 ? (whole === "cols" || whole === "all" ? " all" : " on") : "");
        el.style.cssText = "left:" + colX[c] + "px;top:0;width:" + (colX[c + 1] - colX[c]) + "px;height:" + HH + "px";
        el.textContent = colName(c);
      }
    } else if (q.xm === "h") {
      if (rr) for (var r = rr[0]; r <= rr[1]; r++) {
        var e2 = slot(q, i++);
        e2.className = "sh-h row" + (r >= R.r1 && r <= R.r2 ? (whole === "rows" || whole === "all" ? " all" : " on") : "");
        e2.style.cssText = "left:0;top:" + r * RH + "px;width:" + HW + "px;height:" + RH + "px";
        e2.textContent = r + 1;
      }
    } else if (rr && cc) {
      for (var r2 = rr[0]; r2 <= rr[1]; r2++) {
        var skip = -1;
        for (var c2 = cc[0]; c2 <= cc[1]; c2++) {
          var el2 = slot(q, i++), k = key(r2, c2), f = s.fmt[k], v = valueOf(s, k), txt = display(s, k, v), kind = cellKind(v);
          var w = colX[c2 + 1] - colX[c2], css = "", cls = "sh-c";
          if (kind) cls += " " + kind;
          if (f) {
            if (f.bold) css += "font-weight:600;";
            if (f.italic) css += "font-style:italic;";
            if (f.underline) css += "text-decoration:underline;";
            if (f.align === "left" || f.align === "center" || f.align === "right") css += "text-align:" + f.align + ";";
            if (f.bg && /^#[0-9a-f]{3,8}$/i.test(f.bg)) css += "background:" + f.bg + ";" + (f.fg || kind === "e" ? "" : "color:" + inkOn(f.bg) + ";");
            if (f.fg && /^#[0-9a-f]{3,8}$/i.test(f.fg) && kind !== "e") css += "color:" + f.fg + ";";
            if (f.wrap) cls += " wr";
          }
          // Text runs on over empty cells to its right, as in Excel.
          if (txt && !kind && !(f && (f.wrap || f.align && f.align !== "left")) && c2 > skip && txt.length * 6 > w - 10) {
            var tw = textW(txt, f && f.bold) + 12, w0 = w, cn = c2 + 1;
            while (w < tw && cn <= cc[1] && cn - c2 < 12 && empty(s, r2, cn)) { w += colX[cn + 1] - colX[cn]; cn++; }
            if (w > w0) { cls += " ov"; if (!(f && f.bg)) css += "background:var(--color-panel);"; skip = cn - 1; }
          }
          if (foundSet && foundSet[k]) cls += " fd";
          if (flashSet[k]) cls += " hf";
          el2.className = cls;
          el2.style.cssText = "left:" + colX[c2] + "px;top:" + r2 * RH + "px;width:" + w + "px;height:" + RH + "px;" + css;
          if (el2.textContent !== txt) el2.textContent = txt;
        }
      }
    }
    for (var j = i; j < q.used; j++) q.pool[j].style.display = "none";
    q.used = i;
  }
  function renderAll(force) { Q.forEach(function (q) { renderQ(q, force); }); }
  function renderHeaders() { Q.forEach(function (q) { if (q.xm === "h" || q.ym === "h") renderQ(q, true); }); }
  function refresh() { layout(); renderAll(true); drawOverlay(); drawCharts(); updateFbar(); stats(); }
  var rafPending = false;
  function onScroll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      sl = grid.scrollLeft; st = grid.scrollTop;
      var grow = false;
      if (st + vpH > HH + nRows * RH - 6 * RH && nRows < MAXR) { nRows = Math.min(MAXR, nRows + 100); grow = true; }
      if (sl + vpW > HW + colX[nCols] - 3 * DW && nCols < MAXC) { nCols = Math.min(MAXC, nCols + 10); grow = true; }
      if (grow) layout(); else translate();
      renderAll(grow);
      if (ed) placeEditor();
      closeAc();
    });
  }
  // A cell's box in viewport pixels.
  function cellBox(r, c) {
    var x = colX[c], y = r * RH, w = colX[c + 1] - x;
    return { x: HW + (c < fc ? x : x - sl), y: HH + (r < fr ? y : y - st), w: w, h: RH };
  }
  function ensureVisible(r, c) {
    if (r >= nRows || c >= nCols) { nRows = clamp(Math.max(nRows, r + 20), 1, MAXR); nCols = clamp(Math.max(nCols, c + 4), 1, MAXC); layout(); }
    var mainW = vpW - HW - FW, mainH = vpH - HH - FH, ns = st, nl = sl;
    if (r >= fr) { var y = r * RH; if (y < FH + st) ns = y - FH; else if (y + RH > FH + st + mainH) ns = y + RH - FH - mainH; }
    if (c >= fc) { var x = colX[c], x2 = colX[c + 1]; if (x < FW + sl) nl = x - FW; else if (x2 > FW + sl + mainW) nl = Math.min(x - FW, x2 - FW - mainW); }
    if (ns !== st) grid.scrollTop = Math.max(0, ns);
    if (nl !== sl) grid.scrollLeft = Math.max(0, nl);
    if (ns !== st || nl !== sl) { sl = grid.scrollLeft; st = grid.scrollTop; translate(); renderAll(false); }
  }

  // ------------------------------------------------------------------ selection
  // anchor (sr, sc) is the active cell; (er, ec) the other corner; selMode: cells | rows | cols | all
  var sr = 0, sc = 0, er = 0, ec = 0, selMode = "cells";
  function selR() {
    var R = { r1: Math.min(sr, er), c1: Math.min(sc, ec), r2: Math.max(sr, er), c2: Math.max(sc, ec) };
    if (selMode === "rows" || selMode === "all") { R.c1 = 0; R.c2 = nCols - 1; }
    if (selMode === "cols" || selMode === "all") { R.r1 = 0; R.r2 = nRows - 1; }
    return R;
  }
  // The selection cut down to what holds data (copying a whole column copies its used part).
  function selUsed() {
    var R = selR(), u = used(S());
    return { r1: R.r1, c1: R.c1, r2: Math.max(R.r1, Math.min(R.r2, u.r)), c2: Math.max(R.c1, Math.min(R.c2, u.c)) };
  }
  function multi() { var R = selR(); return R.r1 !== R.r2 || R.c1 !== R.c2; }
  function select(r, c, extend, mode) {
    r = clamp(r, 0, MAXR - 1); c = clamp(c, 0, MAXC - 1);
    if (extend) { er = r; ec = c; } else { sr = er = r; sc = ec = c; selMode = mode || "cells"; }
    if (mode) selMode = mode;
    if (selMode === "cells" || selMode === "rows") ensureVisible(selMode === "rows" ? er : er, selMode === "rows" ? Math.max(fc, colAt(FW + sl)) : ec);
    else if (selMode === "cols") ensureVisible(Math.max(fr, Math.floor((FH + st) / RH)), ec);
    afterSel();
  }
  function setActive(r, c) { sr = r; sc = c; ensureVisible(r, c); afterSel(); }
  function afterSel() { drawOverlay(); renderHeaders(); updateFbar(); stats(); announce(); sendView(); }
  function box(el, R, pad) {
    var x = colX[R.c1], y = R.r1 * RH, w = colX[R.c2 + 1] - x, hh = (R.r2 - R.r1 + 1) * RH;
    pad = pad || 0;
    el.style.left = x - pad + "px"; el.style.top = y - pad + "px"; el.style.width = w + 2 * pad - (pad ? 0 : 0) + "px"; el.style.height = hh + 2 * pad + "px";
    el.hidden = false;
  }
  var fillPrev = null, edRefs = [];
  function drawOverlay() {
    var R = selR(), A = { r1: sr, c1: sc, r2: sr, c2: sc }, s = S();
    cellQ.forEach(function (q) {
      var o = q.ov;
      if (multi()) box(o.sel, R, 0); else o.sel.hidden = true;
      box(o.act, A, 1);
      if (!ro() && !ed && selMode !== "all") {
        o.handle.hidden = false;
        o.handle.style.left = colX[Math.min(R.c2 + 1, nCols)] - 4 + "px"; o.handle.style.top = (R.r2 + 1) * RH - 4 + "px";
      } else o.handle.hidden = true;
      if (fillPrev) box(o.fill, fillPrev, 0); else o.fill.hidden = true;
      if (clip && clip.id === s.id && !preview) box(o.clip, clip.R, 0); else o.clip.hidden = true;
      o.refs.innerHTML = "";
      edRefs.forEach(function (x) {
        if (x.sheet && x.sheet.toLowerCase() !== s.name.toLowerCase()) return;
        var R2 = { r1: x.R.r1, c1: x.R.c1, r2: Math.min(x.R.r2, nRows - 1), c2: Math.min(x.R.c2, nCols - 1) };
        var b = h("div", { "class": "sh-ref r" + x.n }); box(b, R2, 0); o.refs.appendChild(b);
      });
    });
  }

  // ------------------------------------------------------------------ the formula bar and the name box
  var fbar = document.getElementById("sh-fbar");
  var nameBox = h("input", { "class": "sh-name", type: "text", "aria-label": T.nameBox, spellcheck: "false" });
  var live1 = h("span", { "aria-live": "polite", style: "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)" });
  var fxTa = h("textarea", { "class": "sh-fx", rows: 1, spellcheck: "false", "aria-label": T.formulaBar, wrap: "off" });
  var fxMirror = h("div", { "class": "sh-mirror", "aria-hidden": "true" });
  var fxWrap = h("div", { "class": "sh-fxwrap" }, [fxMirror, fxTa]);
  fbar.append(nameBox, h("span", { "class": "sh-fxl", text: "fx", "aria-hidden": "true" }), fxWrap, live1);
  function updateFbar() {
    var s = S();
    if (document.activeElement !== nameBox) nameBox.value = multi() ? rangeName(selR()) : key(sr, sc);
    if (!ed) { fxTa.value = rawText(s.cells[key(sr, sc)]); fxWrap.classList.remove("is-formula"); fxMirror.innerHTML = ""; }
    fxTa.readOnly = ro();
  }
  var annTimer = null;
  function announce() {
    clearTimeout(annTimer);
    annTimer = setTimeout(function () {
      var s = S(), k = key(sr, sc), t = display(s, k, valueOf(s, k));
      live1.textContent = fill(T.cellAnn, { k: multi() ? rangeName(selR()) : k, v: t || T.empty });
    }, 120);
  }
  nameBox.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var R = parseRange(nameBox.value.trim().toUpperCase());
      if (R) { R.r2 = Math.min(R.r2, MAXR - 1); R.c2 = Math.min(R.c2, MAXC - 1); sr = R.r1; sc = R.c1; select(R.r2, R.c2, true, "cells"); setActive(R.r1, R.c1); }
      grid.focus();
    } else if (e.key === "Escape") { updateFbar(); grid.focus(); }
  });

  // ------------------------------------------------------------------ editing: the in-cell editor, point mode, autocomplete
  var edWrap = h("div", { "class": "sh-edwrap", hidden: true }), edMirror = h("div", { "class": "sh-mirror", "aria-hidden": "true" });
  var edTa = h("textarea", { "class": "sh-ed", rows: 1, spellcheck: "false", "aria-label": T.formulaBar });
  edWrap.append(edMirror, edTa); vp.appendChild(edWrap);
  var ed = null; // {r, c, sid, mode: "enter"|"edit", point}
  var FNAMES = (function () {
    var f = F && F.FUNCTIONS;
    if (!f) return [];
    var a = Array.isArray(f) ? f.slice() : Object.keys(f);
    return a.map(function (x) { return String(x).toUpperCase(); }).sort();
  })();
  function edSrc() { return document.activeElement === fxTa ? fxTa : edTa; }
  function beginEdit(text, mode, viaBar) {
    if (ro() || ed) return;
    var s = S();
    ed = { r: sr, c: sc, sid: s.id, mode: mode || "enter", point: null };
    var t = text == null ? rawText(s.cells[key(sr, sc)]) : text;
    edTa.value = t; fxTa.value = t;
    var f = s.fmt[key(sr, sc)];
    edWrap.classList.toggle("wr", !!(f && f.wrap));
    edWrap.hidden = false;
    var ta = viaBar ? fxTa : edTa;
    ta.focus();
    ta.setSelectionRange(t.length, t.length);
    refreshEdit();
    drawOverlay();
  }
  function placeEditor() {
    if (!ed) return;
    var b = cellBox(ed.r, ed.c), lines = edTa.value.split("\n");
    var w = b.w, hh = RH;
    if (edWrap.classList.contains("wr")) { edWrap.style.width = w + 1 + "px"; hh = Math.max(RH, edTa.scrollHeight); }
    else {
      var tw = 0;
      lines.forEach(function (ln) { tw = Math.max(tw, textW(ln) + 18); });
      w = Math.max(b.w, Math.min(tw, vpW - b.x - 6));
      hh = Math.max(RH, lines.length * 23 + 1);
    }
    edWrap.style.left = b.x + "px"; edWrap.style.top = b.y + "px"; edWrap.style.width = w + 1 + "px"; edWrap.style.height = hh + "px";
  }
  function endEdit() {
    ed = null; edWrap.hidden = true; edRefs = []; closeAc();
    edWrap.classList.remove("is-formula"); fxWrap.classList.remove("is-formula");
    drawOverlay(); updateFbar();
  }
  function cancelEdit() { if (!ed) return; endEdit(); grid.focus(); }
  // References in a formula, with where they sit in its text: [{start, end, sheet, R, n}]
  var REF = /^(?:('(?:[^']|'')+'|[A-Za-z_À-ɏ][\w.À-ɏ]*)!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)(?![\w(!.])/;
  function formulaRefs(t) {
    var out = [], i = 1, n = t.length, colors = {}, next = 0;
    while (i < n) {
      var ch = t.charAt(i);
      if (ch === '"') { i++; while (i < n && !(t.charAt(i) === '"' && t.charAt(i + 1) !== '"')) i += t.charAt(i) === '"' ? 2 : 1; i++; continue; }
      var prevOk = !/[\w.$À-ɏ]/.test(t.charAt(i - 1));
      if (prevOk) {
        var m = REF.exec(t.slice(i));
        if (m) {
          var R = parseRange(m[2]);
          if (R && R.r2 < MAXR && R.c2 < 16384) {
            var sh = m[1] ? m[1].replace(/^'|'$/g, "").replace(/''/g, "'") : null, id = (sh || "").toLowerCase() + "!" + m[2].replace(/\$/g, "").toUpperCase();
            if (colors[id] == null) colors[id] = next++ % 8;
            out.push({ start: i, end: i + m[0].length, sheet: sh, R: R, n: colors[id] });
          }
          i += m[0].length; continue;
        }
        var w = /^[A-Za-z_À-ɏ][\w.À-ɏ]*/.exec(t.slice(i));
        if (w) { i += w[0].length; continue; }
      }
      i++;
    }
    return out;
  }
  function mirrorHtml(t, refs) {
    var out = "", at = 0;
    refs.forEach(function (x) { out += kit.esc(t.slice(at, x.start)) + '<span class="r' + x.n + '">' + kit.esc(t.slice(x.start, x.end)) + "</span>"; at = x.end; });
    return out + kit.esc(t.slice(at)) + " ";
  }
  function refreshEdit() {
    if (!ed) return;
    var t = edSrc().value, isF = t.charAt(0) === "=";
    edRefs = isF ? formulaRefs(t) : [];
    edWrap.classList.toggle("is-formula", isF); fxWrap.classList.toggle("is-formula", isF);
    var mh = isF ? mirrorHtml(t, edRefs) : "";
    edMirror.innerHTML = mh; fxMirror.innerHTML = mh;
    fxMirror.scrollLeft = fxTa.scrollLeft;
    placeEditor();
    drawOverlay();
    acUpdate();
  }
  function onEdInput(e) {
    if (!ed) { if (e.target === fxTa && !ro()) { var v = fxTa.value; beginEdit(v, "edit", true); } return; }
    var other = e.target === fxTa ? edTa : fxTa;
    other.value = e.target.value;
    ed.point = null;
    refreshEdit();
  }
  edTa.addEventListener("input", onEdInput);
  fxTa.addEventListener("input", onEdInput);
  fxTa.addEventListener("scroll", function () { fxMirror.scrollLeft = fxTa.scrollLeft; });
  fxTa.addEventListener("focus", function () { if (!ed && !ro()) beginEdit(null, "edit", true); });
  // Point mode: after an operator, ( , or ; an arrow or a click puts a reference into the formula.
  function pointable() {
    if (!ed) return false;
    var ta = edSrc(), t = ta.value;
    if (t.charAt(0) !== "=") return false;
    var i = ta.selectionStart;
    if (ta.selectionEnd !== i) return false;
    if (ed.point && i === ed.point.end) return true;
    var before = t.slice(0, i).replace(/\s+$/, "");
    return /[=+\-*/^&<>(,;:]$/.test(before);
  }
  function pointInsert(R) {
    var ta = edSrc(), t = ta.value, txt = rangeName(R), a, b;
    if (ed.point) { a = ed.point.start; b = ed.point.end; } else { a = b = ta.selectionStart; }
    var v = t.slice(0, a) + txt + t.slice(b);
    ta.value = v; (ta === fxTa ? edTa : fxTa).value = v;
    ed.point = { start: a, end: a + txt.length, R: R };
    ta.setSelectionRange(a + txt.length, a + txt.length);
    refreshEdit();
  }
  function pointMove(dr, dc, extend) {
    var p = ed.point, base = p ? p.R : { r1: ed.r, c1: ed.c, r2: ed.r, c2: ed.c }, R;
    if (p && extend) {
      var ar = p.ar != null ? p.ar : base.r1, ac = p.ac != null ? p.ac : base.c1, e1 = p.er != null ? p.er : base.r2, e2 = p.ec != null ? p.ec : base.c2;
      e1 = clamp(e1 + dr, 0, MAXR - 1); e2 = clamp(e2 + dc, 0, MAXC - 1);
      R = { r1: Math.min(ar, e1), c1: Math.min(ac, e2), r2: Math.max(ar, e1), c2: Math.max(ac, e2) };
      pointInsert(R); ed.point.ar = ar; ed.point.ac = ac; ed.point.er = e1; ed.point.ec = e2;
    } else {
      var r = clamp((p ? (p.er != null ? p.er : base.r1) : base.r1) + dr, 0, MAXR - 1), c = clamp((p ? (p.ec != null ? p.ec : base.c1) : base.c1) + dc, 0, MAXC - 1);
      pointInsert({ r1: r, c1: c, r2: r, c2: c }); ed.point.ar = r; ed.point.ac = c; ed.point.er = r; ed.point.ec = c;
    }
    ensureVisible(ed.point.er, ed.point.ec);
    placeEditor();
  }
  // Function names as you type them
  var acEl = h("div", { "class": "sh-ac", role: "listbox", hidden: true }), ac = null;
  document.body.appendChild(acEl);
  function closeAc() { ac = null; acEl.hidden = true; }
  function acUpdate() {
    if (!ed || !FNAMES.length) return closeAc();
    var ta = edSrc(), t = ta.value, i = ta.selectionStart;
    if (t.charAt(0) !== "=" || ta.selectionEnd !== i) return closeAc();
    var m = /(^=|[+\-*/^&<>(,;:\s=])([A-Za-z][A-Za-z0-9.]*)$/.exec(t.slice(0, i));
    if (!m) return closeAc();
    var pre = m[2].toUpperCase(), list = FNAMES.filter(function (n) { return n.indexOf(pre) === 0; }).slice(0, 10);
    if (!list.length || list.length === 1 && list[0] === pre) return closeAc();
    ac = { list: list, on: 0, start: i - m[2].length, end: i, ta: ta };
    acEl.innerHTML = "";
    list.forEach(function (n, j) { acEl.appendChild(h("div", { role: "option", "data-i": j, "class": j === 0 ? "on" : null, text: n })); });
    var r = ta.getBoundingClientRect(), x = r.left + (ta === fxTa ? 8 : 5) + Math.min(textW(t.slice(0, ac.start)), r.width - 20) - (ta === fxTa ? ta.scrollLeft : 0);
    acEl.hidden = false;
    acEl.style.left = Math.max(4, Math.min(x, innerWidth - acEl.offsetWidth - 8)) + "px";
    acEl.style.top = (r.bottom + 2 + acEl.offsetHeight > innerHeight ? r.top - acEl.offsetHeight - 2 : r.bottom + 2) + "px";
  }
  function acMove(d) {
    if (!ac) return;
    ac.on = (ac.on + d + ac.list.length) % ac.list.length;
    [].forEach.call(acEl.children, function (n, j) { n.classList.toggle("on", j === ac.on); if (j === ac.on) n.scrollIntoView({ block: "nearest" }); });
  }
  function acAccept(j) {
    if (!ac) return;
    var name = ac.list[j == null ? ac.on : j], ta = ac.ta, t = ta.value, v = t.slice(0, ac.start) + name + "(" + t.slice(ac.end), at = ac.start + name.length + 1;
    ta.value = v; (ta === fxTa ? edTa : fxTa).value = v;
    ta.focus(); ta.setSelectionRange(at, at);
    closeAc(); ed.point = null; refreshEdit();
  }
  acEl.addEventListener("mousedown", function (e) {
    e.preventDefault();
    var o = e.target.closest("[data-i]");
    if (o) acAccept(+o.getAttribute("data-i"));
  });
  function edKey(e) {
    if (!ed) return;
    var k = e.key;
    if (ac) {
      if (k === "ArrowDown") { e.preventDefault(); return acMove(1); }
      if (k === "ArrowUp") { e.preventDefault(); return acMove(-1); }
      if (k === "Tab") { e.preventDefault(); return acAccept(); }
      if (k === "Escape") { e.preventDefault(); return closeAc(); }
    }
    if (k === "Enter" && e.altKey) {
      e.preventDefault();
      var ta = e.target, a = ta.selectionStart, v = ta.value.slice(0, a) + "\n" + ta.value.slice(ta.selectionEnd);
      ta.value = v; (ta === fxTa ? edTa : fxTa).value = v; ta.setSelectionRange(a + 1, a + 1); ed.point = null; refreshEdit();
      return;
    }
    if (k === "Enter") { e.preventDefault(); return commitEdit(e.shiftKey ? -1 : 1, 0, e.ctrlKey || e.metaKey); }
    if (k === "Tab") { e.preventDefault(); return commitEdit(0, e.shiftKey ? -1 : 1); }
    if (k === "Escape") { e.preventDefault(); return cancelEdit(); }
    if (k === "F2") { e.preventDefault(); ed.mode = ed.mode === "edit" ? "enter" : "edit"; return; }
    var arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    if (arrows && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (pointable()) { e.preventDefault(); return pointMove(arrows[0], arrows[1], e.shiftKey); }
      if (ed.mode === "enter" && e.target === edTa && !e.shiftKey) { e.preventDefault(); return commitEdit(arrows[0], arrows[1]); }
    }
  }
  edTa.addEventListener("keydown", edKey);
  fxTa.addEventListener("keydown", edKey);
  edTa.addEventListener("keyup", function () { if (ed && ac) acUpdate(); });
  edTa.addEventListener("click", function () { if (ed) { ed.point = null; acUpdate(); } });
  fxTa.addEventListener("click", function () { if (ed) { ed.point = null; acUpdate(); } });
  function commitEdit(dr, dc, all) {
    if (!ed) return;
    var e = ed, text = edSrc().value, s = byId(e.sid);
    endEdit();
    grid.focus();
    if (!s || ro() || s !== S()) return;
    var p = parseText(text), k = key(e.r, e.c), R = selR();
    if (all && multi()) {
      var rows = [];
      for (var r = R.r1; r <= R.r2; r++) {
        var row = [];
        for (var c = R.c1; c <= R.c2; c++) row.push(isFormula(p.value) ? shift(p.value, r - e.r, c - e.c) : p.value);
        rows.push(row);
      }
      setBlock(s, R.r1, R.c1, rows, p.num ? { num: p.num } : null);
      return;
    }
    var f = s.fmt[k];
    if (!same(s.cells[k], p.value) || p.num && !(f && f.num)) setBlock(s, e.r, e.c, [[p.value]], p.num && !(f && f.num) ? { num: p.num } : null);
    if (dr || dc) moveInSel(dr, dc);
  }
  function shift(fx, dr, dc) {
    if (!dr && !dc) return fx;
    if (F && F.shiftRefs) { try { return F.shiftRefs(fx, dr, dc); } catch (e) {} }
    return fx;
  }
  // Enter / Tab inside a selection walk its cells; otherwise they move the selection.
  function moveInSel(dr, dc) {
    if (!multi() || selMode !== "cells") return select(sr + dr, sc + dc, false);
    var R = selR(), r = sr + dr, c = sc + dc;
    if (dc) { if (c > R.c2) { c = R.c1; r++; } else if (c < R.c1) { c = R.c2; r--; } if (r > R.r2) r = R.r1; else if (r < R.r1) r = R.r2; }
    if (dr) { if (r > R.r2) { r = R.r1; c++; } else if (r < R.r1) { r = R.r2; c--; } if (c > R.c2) c = R.c1; else if (c < R.c1) c = R.c2; }
    setActive(r, c);
  }

  // ------------------------------------------------------------------ mouse: select, drag, headers, column widths, point mode
  function hit(cx, cy) {
    var b = vp.getBoundingClientRect(), x = cx - b.left, y = cy - b.top, r, c;
    if (x < HW) c = -1; else { var sx = x - HW < FW ? x - HW : x - HW + sl; c = colAt(Math.max(0, sx)); }
    if (y < HH) r = -1; else { var sy = y - HH < FH ? y - HH : y - HH + st; r = clamp(Math.floor(Math.max(0, sy) / RH), 0, nRows - 1); }
    return { r: r, c: c, x: x, y: y };
  }
  var drag = null, dragTimer = null, lastPt = null;
  function edgeOfCol(p) {
    // near a column's right edge in its header: resize that column
    if (p.r !== -1 || p.c < 0) return -1;
    var b = cellBox(0, p.c), x = p.x;
    if (Math.abs(x - (b.x + b.w)) <= 4) return p.c;
    if (p.c > 0 && Math.abs(x - b.x) <= 4) return p.c - 1;
    return -1;
  }
  function startDrag(kind, extra) {
    drag = { kind: kind };
    for (var k in extra || {}) drag[k] = extra[k];
    document.addEventListener("mousemove", dragMove);
    document.addEventListener("mouseup", dragEnd);
    clearInterval(dragTimer);
    dragTimer = setInterval(autoScroll, 50);
  }
  function autoScroll() {
    if (!drag || !lastPt || drag.kind === "resize") return;
    var b = vp.getBoundingClientRect(), dx = 0, dy = 0;
    if (lastPt.x > b.right - 4) dx = 30; else if (lastPt.x < b.left + HW + FW && drag.kind !== "rows" && sl > 0) dx = -30;
    if (lastPt.y > b.bottom - 4) dy = RH * 2; else if (lastPt.y < b.top + HH + FH && drag.kind !== "cols" && st > 0) dy = -RH * 2;
    if (dx || dy) { grid.scrollLeft += dx; grid.scrollTop += dy; sl = grid.scrollLeft; st = grid.scrollTop; dragMove({ clientX: lastPt.x, clientY: lastPt.y }); }
  }
  function dragMove(e) {
    if (!drag) return;
    lastPt = { x: e.clientX, y: e.clientY };
    var b = vp.getBoundingClientRect();
    var p = hit(clamp(e.clientX, b.left + HW + 1, b.right - 2), clamp(e.clientY, b.top + HH + 1, b.bottom - 2));
    if (drag.kind === "resize") {
      var x0 = cellBox(0, drag.col).x, w = clamp(Math.round(e.clientX - b.left - x0), 40, 800);
      drag.w = w; resizeLine.hidden = false; resizeLine.style.left = x0 + w - 1 + "px";
    } else if (drag.kind === "sel") { if (p.r !== er || p.c !== ec) { er = p.r; ec = p.c; afterSel(); ensureVisible(er, ec); } }
    else if (drag.kind === "rows") { if (p.r !== er) { er = p.r; afterSel(); } }
    else if (drag.kind === "cols") { if (p.c !== ec) { ec = p.c; afterSel(); } }
    else if (drag.kind === "point" && ed) {
      var R = { r1: Math.min(drag.r, p.r), c1: Math.min(drag.c, p.c), r2: Math.max(drag.r, p.r), c2: Math.max(drag.c, p.c) };
      pointInsert(R); ed.point.ar = drag.r; ed.point.ac = drag.c; ed.point.er = p.r; ed.point.ec = p.c;
    } else if (drag.kind === "fill") fillMove(p);
  }
  function dragEnd() {
    document.removeEventListener("mousemove", dragMove);
    document.removeEventListener("mouseup", dragEnd);
    clearInterval(dragTimer);
    var d = drag; drag = null; lastPt = null;
    if (!d) return;
    if (d.kind === "resize") { resizeLine.hidden = true; if (d.w) setColWidth(S(), d.col, d.w); }
    if (d.kind === "fill") fillEnd();
    if (d.kind === "point" && ed) edSrc().focus();
  }
  function onDown(e) {
    if (e.button !== 0 || !vp.contains(e.target) || e.target.closest(".sh-chart, .sh-edwrap")) return;
    var p = hit(e.clientX, e.clientY);
    lastPt = { x: e.clientX, y: e.clientY };
    if (e.target.classList.contains("sh-handle")) { e.preventDefault(); grid.focus(); return startDrag("fill", {}); }
    if (ed && p.r >= 0 && p.c >= 0 && pointable()) {
      e.preventDefault();
      pointInsert({ r1: p.r, c1: p.c, r2: p.r, c2: p.c }); ed.point.ar = ed.point.er = p.r; ed.point.ac = ed.point.ec = p.c;
      return startDrag("point", { r: p.r, c: p.c });
    }
    if (ed) commitEdit(0, 0);
    var col = edgeOfCol(p);
    if (col >= 0 && !ro()) { e.preventDefault(); return startDrag("resize", { col: col }); }
    if (p.r === -1 && p.c === -1) { e.preventDefault(); grid.focus(); return selectAll(); }
    if (p.r === -1) { e.preventDefault(); grid.focus(); if (e.shiftKey && selMode === "cols") { ec = p.c; afterSel(); } else { sr = 0; er = nRows - 1; sc = ec = p.c; selMode = "cols"; afterSel(); } return startDrag("cols"); }
    if (p.c === -1) { e.preventDefault(); grid.focus(); if (e.shiftKey && selMode === "rows") { er = p.r; afterSel(); } else { sr = er = p.r; sc = 0; ec = nCols - 1; selMode = "rows"; afterSel(); } return startDrag("rows"); }
    e.preventDefault(); grid.focus();
    if (e.shiftKey) { selMode = "cells"; select(p.r, p.c, true); } else select(p.r, p.c, false);
    startDrag("sel");
  }
  function selectAll() { sr = 0; sc = 0; er = nRows - 1; ec = nCols - 1; selMode = "all"; afterSel(); }
  grid.addEventListener("mousemove", function (e) {
    if (drag || !vp.contains(e.target)) return;
    var p = hit(e.clientX, e.clientY);
    grid.classList.toggle("is-colres", !ro() && edgeOfCol(p) >= 0);
  });
  function autofit(c) {
    var s = S(), u = used(s), w = 40;
    for (var r = 0; r <= Math.min(u.r, 2000); r++) {
      var k = key(r, c), t = display(s, k, valueOf(s, k));
      if (t) w = Math.max(w, textW(t, s.fmt[k] && s.fmt[k].bold) + 16);
    }
    setColWidth(s, c, Math.min(800, Math.ceil(w)));
  }
  function onDbl(e) {
    if (!vp.contains(e.target) || e.target.closest(".sh-chart, .sh-edwrap")) return;
    var p = hit(e.clientX, e.clientY), col = edgeOfCol(p);
    if (col >= 0 && !ro()) return autofit(col);
    if (p.r >= 0 && p.c >= 0 && !ro()) { select(p.r, p.c, false); beginEdit(null, "edit"); }
  }

  // ------------------------------------------------------------------ keyboard on the grid
  function filled(r, c) { return !empty(S(), r, c); }
  function jump(r, c, dr, dc) {
    var u = used(S()), maxR = Math.max(u.r, nRows - 1), maxC = Math.max(u.c, nCols - 1);
    function ok(a, b) { return a >= 0 && b >= 0 && a <= maxR && b <= maxC; }
    var nr = r + dr, nc = c + dc;
    if (!ok(nr, nc)) return [r, c];
    if (filled(r, c) && filled(nr, nc)) { while (ok(nr + dr, nc + dc) && filled(nr + dr, nc + dc)) { nr += dr; nc += dc; } return [nr, nc]; }
    while (ok(nr, nc) && !filled(nr, nc)) {
      if (dr > 0 && nr > u.r || dc > 0 && nc > u.c) return [dr ? maxR : nr, dc ? maxC : nc];
      nr += dr; nc += dc;
    }
    return ok(nr, nc) ? [nr, nc] : [clamp(nr, 0, maxR), clamp(nc, 0, maxC)];
  }
  function onKey(e) {
    if (e.target !== grid || ed) return;
    var k = e.key, mod = e.ctrlKey || e.metaKey;
    var arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    if (arrows) {
      e.preventDefault();
      if (selMode !== "cells" && e.shiftKey) selMode = "cells";
      var r0 = e.shiftKey ? er : sr, c0 = e.shiftKey ? ec : sc, t = mod ? jump(r0, c0, arrows[0], arrows[1]) : [r0 + arrows[0], c0 + arrows[1]];
      return select(t[0], t[1], e.shiftKey, e.shiftKey ? null : "cells");
    }
    if (k === "Tab") { e.preventDefault(); return moveInSel(0, e.shiftKey ? -1 : 1); }
    if (k === "Enter") { e.preventDefault(); return moveInSel(e.shiftKey ? -1 : 1, 0); }
    if (k === "Home") { e.preventDefault(); return select(mod ? 0 : (e.shiftKey ? er : sr), 0, e.shiftKey); }
    if (k === "End") { e.preventDefault(); var u = used(S()); return select(mod ? Math.max(0, u.r) : (e.shiftKey ? er : sr), Math.max(0, u.c), e.shiftKey); }
    if (k === "PageDown" || k === "PageUp") {
      e.preventDefault();
      var n = Math.max(1, Math.floor((vpH - HH - FH) / RH) - 1) * (k === "PageDown" ? 1 : -1);
      grid.scrollTop += n * RH;
      return select((e.shiftKey ? er : sr) + n, e.shiftKey ? ec : sc, e.shiftKey);
    }
    if (k === "F2") { e.preventDefault(); return beginEdit(null, "edit"); }
    if (k === "Escape") { if (clip) { clip = null; drawOverlay(); } if (preview) closePreview(); return; }
    if (k === "Delete" && !ro()) { e.preventDefault(); return clearSel(); }
    if (k === "Backspace" && !ro()) { e.preventDefault(); return beginEdit("", "enter"); }
    if (mod && !e.altKey) {
      var lk = k.toLowerCase();
      if (lk === "a") { e.preventDefault(); return selectAll(); }
      if (lk === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
      if (lk === "y") { e.preventDefault(); return redo(); }
      if (lk === "b") { e.preventDefault(); return toggleFmt("bold"); }
      if (lk === "i") { e.preventDefault(); return toggleFmt("italic"); }
      if (lk === "u") { e.preventDefault(); return toggleFmt("underline"); }
      if (lk === "f") { e.preventDefault(); return openFind(); }
      if (lk === "s") { e.preventDefault(); return flush(); }
      if (lk === "d" && !ro()) { e.preventDefault(); return fillDownRight(true); }
      if (lk === "r" && !ro()) { e.preventDefault(); return fillDownRight(false); }
      return; // Ctrl+C / X / V go to the clipboard events
    }
    if (k === "Dead" || k === "Process") { if (!ro()) beginEdit("", "enter"); return; }
    if (k.length === 1 && !e.altKey && !ro()) { e.preventDefault(); beginEdit(k, "enter"); }
  }
  if (!C.thumb) {
    grid.addEventListener("scroll", onScroll, { passive: true });
    grid.addEventListener("mousedown", onDown);
    grid.addEventListener("dblclick", onDbl);
    grid.addEventListener("keydown", onKey);
    grid.addEventListener("contextmenu", function (e) {
      if (!vp.contains(e.target) || e.target.closest(".sh-chart, .sh-edwrap")) return;
      e.preventDefault();
      var p = hit(e.clientX, e.clientY);
      if (ed) commitEdit(0, 0);
      if (p.r >= 0 && p.c >= 0 && !inR(selR(), p.r, p.c)) select(p.r, p.c, false);
      grid.focus();
      cellMenu(e.clientX, e.clientY);
    });
    if (window.ResizeObserver) new ResizeObserver(function () { size(); renderAll(false); if (ed) placeEditor(); }).observe(grid);
    else window.addEventListener("resize", function () { size(); renderAll(false); });
  }

  // ------------------------------------------------------------------ ops: applied here at once, sent in batches
  function eachIn(R, fn) { for (var r = R.r1; r <= R.r2; r++) for (var c = R.c1; c <= R.c2; c++) fn(r, c, key(r, c)); }
  function area(R) { return (R.r2 - R.r1 + 1) * (R.c2 - R.c1 + 1); }
  function applyLocal(s, op) {
    var R, p;
    switch (op.op) {
      case "set":
        p = parseKey(String(op.range).split(":")[0]);
        if (!p) break;
        (op.values || []).forEach(function (row, i) {
          (row || []).forEach(function (v, j) {
            if (v === null || v === undefined) return;
            var k = key(p.r + i, p.c + j);
            if (v === "") delete s.cells[k]; else s.cells[k] = v;
            delete s.vals[k];
          });
        });
        break;
      case "clear":
        R = parseRange(op.range);
        if (R) for (var k in s.cells) { p = parseKey(k); if (p && inR(R, p.r, p.c)) { delete s.cells[k]; delete s.vals[k]; } }
        break;
      case "format":
        R = parseRange(op.range);
        if (!R) break;
        R.r2 = Math.min(R.r2, MAXR - 1); R.c2 = Math.min(R.c2, MAXC - 1);
        eachIn(R, function (r, c, k) {
          var f = s.fmt[k] || {};
          FMT_KEYS.forEach(function (x) { if (x in op) { if (op[x] === null || op[x] === false || op[x] === undefined) delete f[x]; else f[x] = op[x]; } });
          if (Object.keys(f).length) s.fmt[k] = f; else delete s.fmt[k];
        });
        break;
      case "col_width": s.cols[op.col] = op.w; break;
      case "freeze": s.freeze = { rows: op.rows || 0, cols: op.cols || 0 }; break;
    }
    s._used = null;
  }
  var pend = {}, flushTimer = null, chain = Promise.resolve(), inflight = 0;
  var status = h("span", { "class": "sh-status", "aria-live": "polite" }), statusTimer = null;
  function setStatus(x) {
    status.textContent = x;
    clearTimeout(statusTimer);
    if (x === T.saved) statusTimer = setTimeout(function () { status.textContent = ""; }, 1500);
  }
  function pending() { return Object.keys(pend).length > 0; }
  function queue(s, ops) {
    if (!live || !ops.length) return;
    (pend[s.id] = pend[s.id] || []).push.apply(pend[s.id], ops);
    setStatus(T.saving);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 300);
  }
  function flush() {
    clearTimeout(flushTimer); flushTimer = null;
    Object.keys(pend).forEach(function (id) { var ops = pend[id]; delete pend[id]; sendOps(id, ops, false); });
    return chain;
  }
  function conflicted(s) {
    kit.toast(T.conflict);
    undoS = undoS.filter(function (e) { return e.id !== s.id; }); redoS = redoS.filter(function (e) { return e.id !== s.id; });
    return readSheet(s);
  }
  function sendOps(id, ops, structural) {
    inflight++;
    chain = chain.then(function () {
      var s = byId(id);
      if (!s) return null;
      return hm.sheet.edit(id, ops, s.rev).then(function (r) {
        if (r && r.conflict) return conflicted(s);
        if (r && r.ok === false) throw new Error(r.error || r.message || "edit failed");
        edits++;
        if (r && r.sheets) syncOverview(r.sheets);
        if (structural || !r || typeof r.rev !== "number" || r.rev !== s.rev + 1) return readSheet(byId(id) || s).then(function () { return r; });
        s.rev = r.rev;
        return r;
      }, function (e) {
        if (e && e.conflict) return conflicted(s);
        throw e;
      });
    }).catch(function (e) { setStatus(""); kit.toast(String(e && e.message || e)); })
      .then(function (r) {
        inflight--;
        if (!inflight && !pending()) setStatus(T.saved);
        sendView(); scheduleVals();
        return r;
      });
    return chain;
  }
  /** Fill a sheet from a read (full) result; the edits still waiting to be sent stay on top. */
  function loadRead(t, r) {
    if (r.cells) { t.cells = r.cells; }
    else {
      var cells = {}, o = (r.range && parseRange(r.range)) || { r1: 0, c1: 0 };
      (r.rows || []).forEach(function (row, i) {
        (row || []).forEach(function (v, j) { if (v !== null && v !== undefined && v !== "") cells[key(o.r1 + i, o.c1 + j)] = v; });
      });
      t.cells = cells;
    }
    if (r.name) t.name = r.name;
    if (typeof r.rev === "number") t.rev = r.rev;
    t.vals = r.values || r.vals || {};
    if (r.fmt) t.fmt = r.fmt;
    if (r.cols) t.cols = r.cols;
    if (r.freeze) t.freeze = { rows: r.freeze.rows || 0, cols: r.freeze.cols || 0 };
    if (r.charts) t.charts = r.charts;
    t._used = null; t.needsRead = false;
  }
  function readSheet(s) {
    return hm.sheet.read(s.id, null).then(function (r) {
      if (!r || r.ok === false) return;
      if (r.sheets) syncOverview(r.sheets);
      var t = byId(r.sheet || s.id) || s;
      loadRead(t, r);
      (pend[t.id] || []).forEach(function (op) { applyLocal(t, op); });
      if (typeof r.hermes_active === "boolean") setHermes(r.hermes_active);
      if (typeof r.edits === "number") edits = r.edits;
      invalidate();
      if (t === book[cur] && !preview) refresh(); else drawTabs();
      scheduleVals();
      return r;
    });
  }
  // The list of sheets as the server has it: new ones are read, deleted ones go, the order follows.
  function syncOverview(list) {
    if (!list || !list.length) return;
    var curId = book[cur] && book[cur].id;
    book = list.map(function (o) {
      var s = byId(o.id);
      if (!s) { s = normSheet({ id: o.id, name: o.name, rev: -1 }); s.needsRead = true; }
      s.name = o.name || s.name;
      if (typeof o.rev === "number" && o.rev !== s.rev && !(pend[s.id] || inflight)) s.needsRead = true;
      return s;
    });
    var i = book.findIndex(function (s) { return s.id === curId; });
    cur = i >= 0 ? i : clamp(cur, 0, book.length - 1);
    invalidate();
    drawTabs();
    book.forEach(function (s) {
      if (s.needsRead && s !== book[cur]) { s.needsRead = false; chain = chain.then(function () { return readSheet(s); }).catch(function () {}); }
    });
  }

  // ------------------------------------------------------------------ undo / redo (the user's own edits, by inverse ops)
  var undoS = [], redoS = [];
  function oldRaw(s, r, c) { var v = s.cells[key(r, c)]; return v === undefined || v === null ? "" : v; }
  function oldMatrix(s, R) {
    if (area(R) > 200000) return null;
    var rows = [];
    for (var r = R.r1; r <= R.r2; r++) { var row = []; for (var c = R.c1; c <= R.c2; c++) row.push(oldRaw(s, r, c)); rows.push(row); }
    return rows;
  }
  function fmtOp(R, patch) { var o = { op: "format", range: rangeName(R) }; for (var k in patch) o[k] = patch[k]; return o; }
  /** Ops that bring back the given format keys over R as they are now (null when too many to keep). */
  function invFmt(s, R, keys) {
    var any = false;
    eachIn(R, function (r, c, k) { var f = s.fmt[k]; if (f) keys.forEach(function (x) { if (f[x] != null) any = true; }); });
    if (!any) { var o = { op: "format", range: rangeName(R) }; keys.forEach(function (x) { o[x] = null; }); return [o]; }
    if (area(R) > 5000) return null;
    var ops = [];
    for (var r = R.r1; r <= R.r2; r++) {
      var runStart = R.c1, prev = null;
      for (var c = R.c1; c <= R.c2 + 1; c++) {
        var sig = null;
        if (c <= R.c2) { var f = s.fmt[key(r, c)] || {}, o2 = {}; keys.forEach(function (x) { o2[x] = f[x] != null ? f[x] : null; }); sig = JSON.stringify(o2); }
        if (c > R.c1 && sig !== prev) { var op = JSON.parse(prev); op.op = "format"; op.range = rangeName({ r1: r, c1: runStart, r2: r, c2: c - 1 }); ops.push(op); runStart = c; }
        prev = sig;
      }
    }
    return ops;
  }
  function changed(s) { invalidate(); if (s === S()) refresh(); scheduleVals(); sendView(); }
  /** One edit of the user: applied here, queued for the server, kept for undo (inv null: cannot be undone). */
  function doEdit(s, fwd, inv) {
    if (ro() || !fwd.length) return;
    fwd.forEach(function (op) { applyLocal(s, op); });
    queue(s, fwd);
    if (inv) { undoS.push({ id: s.id, fwd: fwd, inv: inv }); if (undoS.length > 100) undoS.shift(); }
    else if (inv === null) kit.toast(T.notUndoable);
    redoS = [];
    changed(s);
    drawUndo();
  }
  function replay(e, ops) {
    var s = byId(e.id);
    if (!s) return false;
    var i = book.indexOf(s);
    if (i !== cur) switchTo(i);
    ops.forEach(function (op) { applyLocal(s, op); });
    queue(s, ops);
    changed(s);
    return true;
  }
  function undo() { if (ro()) return; if (ed) cancelEdit(); var e = undoS.pop(); if (e && replay(e, e.inv)) redoS.push(e); drawUndo(); }
  function redo() { if (ro()) return; if (ed) cancelEdit(); var e = redoS.pop(); if (e && replay(e, e.fwd)) undoS.push(e); drawUndo(); }
  function growTo(r, c) {
    if (r >= MAXR || c >= MAXC) { kit.toast(T.limit); return false; }
    if (r >= nRows || c >= nCols) { nRows = clamp(Math.max(nRows, r + 20), 1, MAXR); nCols = clamp(Math.max(nCols, c + 4), 1, MAXC); }
    return true;
  }
  /** Write a block of values from (r, c); fmtPatch (optional) formats it too. */
  function setBlock(s, r, c, rows, fmtPatch) {
    var w = 0;
    rows = rows.slice(0, MAXR - r).map(function (row) { row = row.slice(0, MAXC - c); w = Math.max(w, row.length); return row; });
    if (!rows.length || !w) return;
    if (!growTo(r + rows.length - 1, c + w - 1) && (r + rows.length > MAXR || c + w > MAXC)) return;
    var inv = [{ op: "set", range: key(r, c), values: rows.map(function (row, i) { return row.map(function (v, j) { return v === null ? null : oldRaw(s, r + i, c + j); }); }) }];
    var fwd = [{ op: "set", range: key(r, c), values: rows }];
    if (fmtPatch) {
      var R = { r1: r, c1: c, r2: r + rows.length - 1, c2: c + w - 1 }, fi = invFmt(s, R, Object.keys(fmtPatch));
      fwd.push(fmtOp(R, fmtPatch));
      inv = fi ? inv.concat(fi) : null;
    }
    doEdit(s, fwd, inv);
  }

  // ------------------------------------------------------------------ clipboard: TSV + HTML out, internal paste keeps formulas and formats
  var clip = null;
  function tsvCell(t) { return /[\t\n\r"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
  function tsvOf(s, R) {
    var lines = [];
    for (var r = R.r1; r <= R.r2; r++) {
      var row = [];
      for (var c = R.c1; c <= R.c2; c++) { var k = key(r, c); row.push(tsvCell(display(s, k, valueOf(s, k)))); }
      lines.push(row.join("\t"));
    }
    return lines.join("\n");
  }
  function htmlOf(s, R) {
    var out = "<table>";
    for (var r = R.r1; r <= R.r2; r++) {
      out += "<tr>";
      for (var c = R.c1; c <= R.c2; c++) {
        var k = key(r, c), f = s.fmt[k] || {}, st2 = "";
        if (f.bold) st2 += "font-weight:bold;"; if (f.italic) st2 += "font-style:italic;"; if (f.underline) st2 += "text-decoration:underline;";
        if (f.bg) st2 += "background:" + f.bg + ";"; if (f.fg) st2 += "color:" + f.fg + ";"; if (f.align) st2 += "text-align:" + f.align + ";";
        out += "<td" + (st2 ? ' style="' + st2 + '"' : "") + ">" + kit.esc(display(s, k, valueOf(s, k))) + "</td>";
      }
      out += "</tr>";
    }
    return out + "</table>";
  }
  function normText(t) { return String(t || "").replace(/\r\n?/g, "\n").replace(/\n+$/, ""); }
  function onCopy(e, cut) {
    if (document.activeElement !== grid || ed) return;
    var s = S(), R = selUsed();
    if (area(R) > 500000) return;
    var text = tsvOf(s, R);
    e.clipboardData.setData("text/plain", text);
    e.clipboardData.setData("text/html", htmlOf(s, R));
    e.preventDefault();
    var raw = [], fm = [];
    for (var r = R.r1; r <= R.r2; r++) {
      var a = [], b = [];
      for (var c = R.c1; c <= R.c2; c++) { var k = key(r, c); a.push(oldRaw(s, r, c)); b.push(s.fmt[k] ? JSON.parse(JSON.stringify(s.fmt[k])) : null); }
      raw.push(a); fm.push(b);
    }
    clip = { id: s.id, R: R, raw: raw, fmt: fm, text: normText(text), cut: !!cut && !ro() };
    drawOverlay();
  }
  function parseTsv(t) {
    t = normText(t);
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (q) { if (ch === '"') { if (t.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"' && cell === "") q = true;
      else if (ch === "\t") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    row.push(cell); rows.push(row);
    return rows;
  }
  function parseHtmlTable(html) {
    try {
      var d = new DOMParser().parseFromString(html, "text/html"), t = d.querySelector("table");
      if (!t) return null;
      return [].map.call(t.querySelectorAll("tr"), function (tr) {
        return [].map.call(tr.querySelectorAll("td,th"), function (td) { return (td.innerText || td.textContent || "").replace(/ /g, " ").trim(); });
      });
    } catch (e) { return null; }
  }
  function onPaste(e) {
    if (document.activeElement !== grid || ed || ro()) return;
    var cd = e.clipboardData, text = cd.getData("text/plain") || "", html = cd.getData("text/html") || "";
    e.preventDefault();
    if (clip && normText(text) === clip.text) return pasteInternal();
    var rows = /<table/i.test(html) ? parseHtmlTable(html) : null;
    if (!rows || !rows.length) rows = parseTsv(text);
    pasteValues(rows.map(function (row) { return row.map(function (t) { return parseText(t).value; }); }));
  }
  function pasteValues(rows) {
    var s = S(), R = selR();
    if (rows.length === 1 && rows[0].length === 1 && multi() && selMode === "cells") {
      var v = rows[0][0], out = [];
      for (var r = R.r1; r <= R.r2; r++) { var row = []; for (var c = R.c1; c <= R.c2; c++) row.push(isFormula(v) ? shift(v, r - R.r1, c - R.c1) : v); out.push(row); }
      rows = out;
    }
    setBlock(s, R.r1, R.c1, rows);
    var w = rows.reduce(function (m, x) { return Math.max(m, x.length); }, 1);
    sr = R.r1; sc = R.c1; selMode = "cells"; select(Math.min(MAXR - 1, R.r1 + rows.length - 1), Math.min(MAXC - 1, R.c1 + w - 1), true);
  }
  function pasteInternal() {
    var s = S(), src = byId(clip.id), R = selR(), cR = clip.R, h0 = cR.r2 - cR.r1 + 1, w0 = cR.c2 - cR.c1 + 1, th = h0, tw = w0;
    if (multi() && selMode === "cells" && (R.r2 - R.r1 + 1) % h0 === 0 && (R.c2 - R.c1 + 1) % w0 === 0) { th = R.r2 - R.r1 + 1; tw = R.c2 - R.c1 + 1; }
    var r0 = R.r1, c0 = R.c1;
    if (!growTo(r0 + th - 1, c0 + tw - 1)) return;
    var D = { r1: r0, c1: c0, r2: r0 + th - 1, c2: c0 + tw - 1 }, vals = [], fops = [], anyFmt = false;
    for (var i = 0; i < th; i++) {
      var row = [];
      for (var j = 0; j < tw; j++) {
        var v = clip.raw[i % h0][j % w0], f = clip.fmt[i % h0][j % w0], k = key(r0 + i, c0 + j);
        if (isFormula(v) && !clip.cut) v = shift(v, r0 + i - (cR.r1 + i % h0), c0 + j - (cR.c1 + j % w0));
        row.push(v);
        if (f || s.fmt[k]) {
          anyFmt = true;
          var o = { op: "format", range: k };
          FMT_KEYS.forEach(function (x) { o[x] = f && f[x] != null ? f[x] : null; });
          fops.push(o);
        }
      }
      vals.push(row);
    }
    var fwd = [], inv = [];
    var dOld = oldMatrix(s, D), dFmt = anyFmt ? invFmt(s, D, FMT_KEYS) : [];
    if (clip.cut && src) {
      var sOld = oldMatrix(src, cR), sFmt = invFmt(src, cR, FMT_KEYS), clr = [{ op: "clear", range: rangeName(cR) }, fmtOp(cR, { bold: null, italic: null, underline: null, align: null, num: null, bg: null, fg: null, wrap: null })];
      var srcInv = sOld && sFmt ? [{ op: "set", range: key(cR.r1, cR.c1), values: sOld }].concat(sFmt) : null;
      if (src === s) { fwd = clr; inv = srcInv; }
      else doEdit(src, clr, srcInv);
    }
    fwd = fwd.concat([{ op: "set", range: key(r0, c0), values: vals }]).concat(fops);
    var dInv = dOld && dFmt ? [{ op: "set", range: key(r0, c0), values: dOld }].concat(dFmt) : null;
    inv = dInv && (inv || !clip.cut || src !== s) ? dInv.concat(src === s && clip.cut ? inv : []) : null;
    if (clip.cut) clip = null;
    doEdit(s, fwd, inv);
    sr = r0; sc = c0; selMode = "cells"; select(D.r2, D.c2, true);
  }
  if (!C.thumb) {
    document.addEventListener("copy", function (e) { onCopy(e, false); });
    document.addEventListener("cut", function (e) { onCopy(e, true); });
    document.addEventListener("paste", onPaste);
  }

  // ------------------------------------------------------------------ fill handle (series for numbers and dates, formulas shifted)
  function fillMove(p) {
    var R = selR(), dr = p.r > R.r2 ? p.r - R.r2 : p.r < R.r1 ? p.r - R.r1 : 0, dc = p.c > R.c2 ? p.c - R.c2 : p.c < R.c1 ? p.c - R.c1 : 0;
    if (p.r < 0 || p.c < 0 || !dr && !dc) fillPrev = null;
    else if (Math.abs(dr) >= Math.abs(dc)) fillPrev = { r1: Math.min(R.r1, p.r), r2: Math.max(R.r2, p.r), c1: R.c1, c2: R.c2 };
    else fillPrev = { r1: R.r1, r2: R.r2, c1: Math.min(R.c1, p.c), c2: Math.max(R.c2, p.c) };
    drawOverlay();
  }
  function fillEnd() { var Tg = fillPrev; fillPrev = null; if (!Tg) return drawOverlay(); doFill(selR(), Tg, false); }
  function addDays(iso, n) { var d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + Math.round(n))); return d.toISOString().slice(0, 10); }
  function dayNo(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5; }
  // The value at offset t (from the first source cell) of a run of source values along the fill.
  function seriesAt(src, t, copyOnly, shiftFn) {
    var n = src.length, j = ((t % n) + n) % n, k = Math.floor(t / n), v = src[j];
    if (!copyOnly) {
      if (n >= 2 && src.every(function (x) { return typeof x === "number"; })) { var step = (src[n - 1] - src[0]) / (n - 1); return Math.round((src[0] + step * t) * 1e10) / 1e10; }
      if (src.every(function (x) { return typeof x === "string" && /^\d{4}-\d\d-\d\d$/.test(x); })) {
        var ds = n >= 2 ? (dayNo(src[n - 1]) - dayNo(src[0])) / (n - 1) : 1;
        return addDays(src[0], ds * t);
      }
    }
    if (isFormula(v)) return shiftFn(v, t - j);
    if (!copyOnly && typeof v === "string" && !isDate(v)) {
      var m = /^(.*?)(\d+)$/.exec(v);
      if (m) { var num = parseInt(m[2], 10) + k * n, sN = String(Math.max(0, num)); if (m[2].charAt(0) === "0") while (sN.length < m[2].length) sN = "0" + sN; return m[1] + sN; }
    }
    return v === undefined ? "" : v;
  }
  function doFill(R, Tg, copyOnly) {
    if (ro()) return;
    var s = S(), vert = Tg.c1 === R.c1 && Tg.c2 === R.c2, rows = [], fops = [];
    if (!growTo(Tg.r2, Tg.c2)) return;
    for (var r = Tg.r1; r <= Tg.r2; r++) {
      var row = [];
      for (var c = Tg.c1; c <= Tg.c2; c++) {
        if (inR(R, r, c)) { row.push(null); continue; }
        var src = [], t, fsrc;
        if (vert) { for (var a = R.r1; a <= R.r2; a++) src.push(oldRaw(s, a, c)); t = r - R.r1; fsrc = s.fmt[key(R.r1 + (((t % src.length) + src.length) % src.length), c)]; }
        else { for (var b = R.c1; b <= R.c2; b++) src.push(oldRaw(s, r, b)); t = c - R.c1; fsrc = s.fmt[key(r, R.c1 + (((t % src.length) + src.length) % src.length))]; }
        row.push(seriesAt(src, t, copyOnly, function (fx, d) { return vert ? shift(fx, d, 0) : shift(fx, 0, d); }));
        if (fsrc || s.fmt[key(r, c)]) { var o = { op: "format", range: key(r, c) }; FMT_KEYS.forEach(function (x) { o[x] = fsrc && fsrc[x] != null ? fsrc[x] : null; }); fops.push(o); }
      }
      rows.push(row);
    }
    var fi = fops.length ? invFmt(s, Tg, FMT_KEYS) : [];
    var inv = fi ? [{ op: "set", range: key(Tg.r1, Tg.c1), values: rows.map(function (row, i) { return row.map(function (v, j) { return v === null ? null : oldRaw(s, Tg.r1 + i, Tg.c1 + j); }); }) }].concat(fi) : null;
    doEdit(s, [{ op: "set", range: key(Tg.r1, Tg.c1), values: rows }].concat(fops), inv);
    sr = R.r1; sc = R.c1; er = Tg.r1 < R.r1 ? Tg.r1 : Tg.r2; ec = Tg.c1 < R.c1 ? Tg.c1 : Tg.c2;
    if (Tg.r1 < R.r1 || Tg.c1 < R.c1) { sr = Tg.r1 < R.r1 ? R.r2 : R.r1; sc = Tg.c1 < R.c1 ? R.c2 : R.c1; }
    selMode = "cells"; afterSel();
  }
  function fillDownRight(down) {
    var R = selR();
    if (!multi()) return;
    doFill(down ? { r1: R.r1, r2: R.r1, c1: R.c1, c2: R.c2 } : { r1: R.r1, r2: R.r2, c1: R.c1, c2: R.c1 }, R, true);
  }

  // ------------------------------------------------------------------ formatting and clearing
  function commitIfEditing() { if (ed) commitEdit(0, 0); }
  function fmtSel(patch) {
    commitIfEditing();
    if (ro()) return;
    var s = S(), R = selR();
    doEdit(s, [fmtOp(R, patch)], invFmt(s, R, Object.keys(patch)));
  }
  function curFmt() { return S().fmt[key(sr, sc)] || {}; }
  function toggleFmt(k) { var o = {}; o[k] = curFmt()[k] ? null : true; fmtSel(o); }
  function clearSel() {
    commitIfEditing();
    if (ro()) return;
    var s = S(), R = selR(), U = selUsed(), old = oldMatrix(s, U);
    if (!Object.keys(s.cells).some(function (k) { var p = parseKey(k); return p && inR(R, p.r, p.c); })) return;
    doEdit(s, [{ op: "clear", range: rangeName(R) }], old ? [{ op: "set", range: key(U.r1, U.c1), values: old }] : null);
  }
  function clearFormats() {
    var o = {}; FMT_KEYS.forEach(function (x) { o[x] = null; });
    fmtSel(o);
  }
  function setColWidth(s, c, w) {
    if (ro()) return;
    var col = colName(c), old = s.cols[col] || DW;
    if (old === w) return;
    doEdit(s, [{ op: "col_width", col: col, w: w }], [{ op: "col_width", col: col, w: old }]);
  }
  function setFreeze(rows, cols) {
    commitIfEditing();
    var s = S(), o = s.freeze;
    doEdit(s, [{ op: "freeze", rows: rows, cols: cols }], [{ op: "freeze", rows: o.rows || 0, cols: o.cols || 0 }]);
  }

  // ------------------------------------------------------------------ structure: rows, columns, sort, sheets (the server rewrites references)
  function structural(ops, s) {
    commitIfEditing();
    if (ro()) return Promise.resolve();
    s = s || S();
    flush();
    undoS = undoS.filter(function (e) { return e.id !== s.id; }); redoS = redoS.filter(function (e) { return e.id !== s.id; });
    drawUndo();
    setStatus(T.saving);
    return sendOps(s.id, ops, true);
  }
  function insRows(below) { var R = selR(); structural([{ op: "insert_rows", at: (below ? R.r2 + 1 : R.r1) + 1, n: Math.min(R.r2 - R.r1 + 1, 500) }]); }
  function delRows() { var R = selR(); structural([{ op: "delete_rows", at: R.r1 + 1, n: R.r2 - R.r1 + 1 }]); }
  function insCols(right) { var R = selR(); structural([{ op: "insert_cols", at: colName(right ? R.c2 + 1 : R.c1), n: Math.min(R.c2 - R.c1 + 1, 50) }]); }
  function delCols() { var R = selR(); structural([{ op: "delete_cols", at: colName(R.c1), n: R.c2 - R.c1 + 1 }]); }
  function headerRow(s, u) {
    if (s.freeze.rows >= 1) return true;
    var allText = true, numBelow = false;
    for (var c = 0; c <= u.c; c++) {
      var a = s.cells[key(0, c)], b = valueOf(s, key(1, c));
      if (a != null && typeof a !== "string") allText = false;
      if (typeof b === "number") numBelow = true;
    }
    return allText && numBelow;
  }
  function sortSel(desc) {
    var s = S(), u = used(s), R = selR();
    if (u.r < 0) return;
    if (!multi() || selMode !== "cells") { R = { r1: R.r1, c1: 0, r2: u.r, c2: u.c }; if (R.r1 === 0 && headerRow(s, u)) R.r1 = 1; }
    else { R.r2 = Math.min(R.r2, u.r); R.c2 = Math.min(R.c2, u.c); }
    if (R.r2 <= R.r1) return;
    structural([{ op: "sort", range: rangeName(R), col: colName(clamp(sc, R.c1, R.c2)), desc: !!desc }]);
  }
  var BAD_NAME = /[\[\]:*?\/\\'!]/;
  function validName(n, exceptId) {
    n = String(n || "").trim();
    if (!n || n.length > 40 || BAD_NAME.test(n)) return false;
    return !book.some(function (s) { return s.id !== exceptId && s.name.toLowerCase() === n.toLowerCase(); });
  }
  function uniqueName(base) {
    base = String(base || T.sheetWord).replace(BAD_NAME, " ").replace(/\s+/g, " ").trim().slice(0, 34) || T.sheetWord;
    if (validName(base)) return base;
    for (var i = 2; i < 100; i++) if (validName(base + " " + i)) return base + " " + i;
    return base + " " + Date.now() % 1000;
  }
  function addSheet(name, rows) {
    name = uniqueName(name || T.sheetWord + " " + (book.length + 1));
    return structural([{ op: "add_sheet", name: name, rows: rows || [] }]).then(function () {
      var i = book.findIndex(function (s) { return s.name === name; });
      if (i >= 0) switchTo(i);
      return book[i];
    });
  }
  function renameSheet(s, name) {
    name = String(name || "").trim();
    if (name === s.name) return;
    if (!validName(name, s.id)) return kit.toast(T.badName);
    s.name = name; drawTabs(); invalidate();
    structural([{ op: "rename_sheet", name: name }], s);
  }
  function deleteSheet(s) {
    if (book.length < 2) return;
    var i = book.indexOf(s);
    structural([{ op: "delete_sheet" }], s).then(function () { if (cur >= book.length) switchTo(book.length - 1); else switchTo(cur); });
    if (i === cur) cur = Math.max(0, i - 1);
  }
  function moveSheet(s, to) {
    to = clamp(to, 0, book.length - 1);
    var i = book.indexOf(s);
    if (i === to || i < 0) return;
    var curS = book[cur];
    book.splice(i, 1); book.splice(to, 0, s); cur = book.indexOf(curS);
    drawTabs();
    structural([{ op: "move_sheet", to: to }], s);
  }

  // ------------------------------------------------------------------ charts: SVG cards anchored at a cell
  function quadFor(r, c) { var xm = c < fc ? "f" : "m", ym = r < fr ? "f" : "m"; for (var i = 0; i < cellQ.length; i++) if (cellQ[i].xm === xm && cellQ[i].ym === ym) return cellQ[i]; return cellQ[cellQ.length - 1]; }
  function chartData(s, ch) {
    var R = parseRange(ch.range);
    if (!R) return null;
    R.r2 = Math.min(R.r2, R.r1 + 200); R.c2 = Math.min(R.c2, R.c1 + 8);
    var rows = [];
    for (var r = R.r1; r <= R.r2; r++) { var row = []; for (var c = R.c1; c <= R.c2; c++) row.push(valueOf(s, key(r, c))); rows.push(row); }
    var labelCol = R.c2 > R.c1;
    var head = rows.length > 1 && (labelCol ? rows[0].slice(1).some(function (v) { return typeof v === "string" && !isDate(v); }) : typeof rows[0][0] === "string" && typeof rows[1][0] === "number");
    var body = head ? rows.slice(1) : rows, labels = body.map(function (row, i) { return labelCol ? display(s, key(R.r1 + i + (head ? 1 : 0), R.c1), row[0]) : String(i + 1); });
    var series = [], n = 0;
    for (var j = labelCol ? 1 : 0; j < rows[0].length; j++) {
      n++;
      series.push({ name: head && rows[0][j] != null ? String(rows[0][j]) : T.series + " " + n,
        values: body.map(function (row) { return typeof row[j] === "number" ? row[j] : null; }) });
    }
    return { labels: labels, series: series };
  }
  function nice(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function short(v) { var a = Math.abs(v); return a >= 1e9 ? +(v / 1e9).toFixed(1) + "G" : a >= 1e6 ? +(v / 1e6).toFixed(1) + "M" : a >= 1e4 ? +(v / 1e3).toFixed(1) + "k" : String(+v.toFixed(2)); }
  function col(i) { return "var(--chart-" + (i % 8 + 1) + ")"; }
  function chartSvg(type, d, W, H) {
    var out = '<svg class="sh-plot" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img">';
    if (!d || !d.labels.length || !d.series.length) return out + "</svg>";
    if (type === "pie") {
      var vals = d.series[0].values.map(function (v) { return v > 0 ? v : 0; }), tot = vals.reduce(function (a, b) { return a + b; }, 0);
      var cx = W / 2, cy = H / 2, rad = Math.min(W, H) / 2 - 10, a0 = -Math.PI / 2;
      if (tot > 0) vals.forEach(function (v, i) {
        if (!v) return;
        var a1 = a0 + v / tot * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
        var p = v === tot ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + rad + '"' : '<path d="M' + cx + " " + cy + "L" + (cx + rad * Math.cos(a0)).toFixed(1) + " " + (cy + rad * Math.sin(a0)).toFixed(1) +
          "A" + rad + " " + rad + " 0 " + big + " 1 " + (cx + rad * Math.cos(a1)).toFixed(1) + " " + (cy + rad * Math.sin(a1)).toFixed(1) + 'Z"';
        out += p + ' style="fill:' + col(i) + ';stroke:var(--color-panel);stroke-width:1.5"><title>' + kit.esc(d.labels[i] + ": " + short(v)) + "</title>" + (v === tot ? "</circle>" : "</path>");
        a0 = a1;
      });
      return out + "</svg>";
    }
    var all = []; d.series.forEach(function (s2) { s2.values.forEach(function (v) { if (v != null) all.push(v); }); });
    var max = Math.max.apply(null, all.concat([0])), min = Math.min.apply(null, all.concat([0]));
    var top = max > 0 ? nice(max) : 0, bot = min < 0 ? -nice(-min) : 0;
    if (top === bot) top = 1;
    var L0 = 40, R0 = 8, T0 = 8, B0 = 20, pw = W - L0 - R0, ph = H - T0 - B0, y = function (v) { return T0 + (top - v) / (top - bot) * ph; };
    for (var g = 0; g <= 4; g++) {
      var gv = bot + (top - bot) * g / 4, gy = y(gv).toFixed(1);
      out += '<line x1="' + L0 + '" x2="' + (W - R0) + '" y1="' + gy + '" y2="' + gy + '" style="stroke:var(--chart-grid);stroke-width:1"/>';
      out += '<text x="' + (L0 - 5) + '" y="' + gy + '" text-anchor="end" dominant-baseline="middle">' + kit.esc(short(gv)) + "</text>";
    }
    var n = d.labels.length, gw = pw / n, every = Math.max(1, Math.ceil(n * 46 / pw));
    d.labels.forEach(function (lb, i) {
      if (i % every) return;
      var t = String(lb).length > 10 ? String(lb).slice(0, 9) + "…" : String(lb);
      out += '<text x="' + (L0 + gw * (i + 0.5)).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + kit.esc(t) + "</text>";
    });
    if (type === "line") {
      d.series.forEach(function (s2, si) {
        var pts = [];
        s2.values.forEach(function (v, i) { if (v != null) pts.push((L0 + gw * (i + 0.5)).toFixed(1) + "," + y(v).toFixed(1)); });
        out += '<polyline points="' + pts.join(" ") + '" style="fill:none;stroke:' + col(si) + ';stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>';
        if (n <= 40) pts.forEach(function (p) { var xy = p.split(","); out += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="2.6" style="fill:' + col(si) + '"/>'; });
      });
    } else {
      var bw = Math.max(1, gw * 0.72 / d.series.length);
      d.series.forEach(function (s2, si) {
        s2.values.forEach(function (v, i) {
          if (v == null) return;
          var x = L0 + gw * i + gw * 0.14 + bw * si, y1 = y(Math.max(v, 0)), y2 = y(Math.min(v, 0));
          out += '<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + Math.max(0.5, y2 - y1).toFixed(1) + '" rx="1.5" style="fill:' + col(si) + '"><title>' +
            kit.esc(d.labels[i] + " · " + s2.name + ": " + short(v)) + "</title></rect>";
        });
      });
    }
    out += '<line x1="' + L0 + '" x2="' + (W - R0) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" style="stroke:var(--chart-axis);stroke-width:1"/>';
    return out + "</svg>";
  }
  function chartCard(s, ch) {
    var d = chartData(s, ch), type = ch.type === "line" || ch.type === "pie" ? ch.type : "bar";
    var names = type === "pie" ? (d ? d.labels.slice(0, 8) : []) : (d ? d.series.map(function (x) { return x.name; }) : []);
    var legend = names.length > (type === "pie" ? 0 : 1) ? h("div", { "class": "sh-legend", html: names.map(function (n, i) { return '<span><i style="background:' + col(i) + '"></i>' + kit.esc(n) + "</span>"; }).join("") }) : null;
    var menuBtn = h("button", { type: "button", "class": "kit-btn", title: T.chart, "aria-label": T.chart, html: kit.icon("more") });
    var head = h("div", { "class": "sh-chart-h" }, [h("span", { "class": "sh-chart-t", text: ch.title || ch.range }), ro() ? null : menuBtn]);
    var card = h("div", { "class": "sh-chart", "data-chart": ch.id });
    card.appendChild(head);
    card.insertAdjacentHTML("beforeend", chartSvg(type, d, 378, legend ? 186 : 206));
    if (legend) card.appendChild(legend);
    if (C.thumb || ro()) return card;
    menuBtn.addEventListener("click", function () {
      var re = function (t) { return function () { ch.type = t; drawCharts(); structural([{ op: "delete_chart", id: ch.id }, { op: "add_chart", type: t, range: ch.range, title: ch.title || "", at: ch.at }]); }; };
      kit.menu(menuBtn, [{ label: T.cBar, onClick: re("bar") }, { label: T.cLine, onClick: re("line") }, { label: T.cPie, onClick: re("pie") },
        { label: T.delChart, onClick: function () { s.charts = s.charts.filter(function (x) { return x !== ch; }); drawCharts(); structural([{ op: "delete_chart", id: ch.id }]); } }]);
    });
    head.addEventListener("mousedown", function (e) {
      if (e.button !== 0 || e.target.closest("button")) return;
      e.preventDefault();
      var x0 = e.clientX, y0 = e.clientY, dx = 0, dy = 0;
      card.classList.add("is-drag");
      function mv(ev) { dx = ev.clientX - x0; dy = ev.clientY - y0; card.style.transform = "translate(" + dx + "px," + dy + "px)"; }
      function up() {
        document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up);
        card.classList.remove("is-drag"); card.style.transform = "";
        var a = parseKey(ch.at) || { r: 0, c: 0 }, nc = colAt(Math.max(0, colX[Math.min(a.c, nCols - 1)] + dx)), nr = clamp(Math.floor((a.r * RH + dy) / RH), 0, MAXR - 1);
        if (nr === a.r && nc === a.c) return;
        var at = key(nr, nc);
        structural([{ op: "delete_chart", id: ch.id }, { op: "add_chart", type: type, range: ch.range, title: ch.title || "", at: at }]);
        ch.at = at; drawCharts();
      }
      document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    });
    return card;
  }
  function drawCharts() {
    cellQ.forEach(function (q) { q.ov.charts.innerHTML = ""; });
    var s = S();
    (s.charts || []).forEach(function (ch) {
      var a = parseKey(ch.at) || { r: 0, c: 0 }, c = Math.min(a.c, nCols - 1), r = Math.min(a.r, nRows - 1), card = chartCard(s, ch);
      card.style.left = colX[c] + 4 + "px"; card.style.top = r * RH + 4 + "px";
      quadFor(r, c).ov.charts.appendChild(card);
    });
  }
  function addChart(type) {
    commitIfEditing();
    var s = S(), R = selUsed();
    if (!multi() || area(R) < 2) return kit.toast(T.chartNeeds);
    var t = s.cells[key(R.r1, R.c1)], title = typeof t === "string" && !isFormula(t) && R.c2 > R.c1 ? "" : "";
    var head = s.cells[key(R.r1, R.c1 + 1)];
    title = typeof head === "string" && !isFormula(head) ? head : "";
    var at = key(R.r1, Math.min(MAXC - 1, R.c2 + 2)), ch = { id: "tmp-" + Date.now(), type: type, range: rangeName(R), title: title, at: at };
    s.charts.push(ch); s._used = null;
    refresh();
    structural([{ op: "add_chart", type: type, range: ch.range, title: title, at: at }]);
  }

  // ------------------------------------------------------------------ small popovers: a question, colours
  var pop = null;
  function closePop() { if (!pop) return; var p = pop; pop = null; p.el.remove(); document.removeEventListener("mousedown", p.out, true); if (p.done) p.done(null); }
  function openPop(el, anchor, done) {
    closePop(); if (kit.menu && document.querySelector(".kit-menu")) document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.body.appendChild(el);
    if (anchor) {
      var r = anchor.getBoundingClientRect();
      el.style.top = r.bottom + 4 + "px";
      el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + "px";
    }
    var out = function (e) { if (!el.contains(e.target) && !(anchor && anchor.contains(e.target))) closePop(); };
    pop = { el: el, out: out, done: done };
    setTimeout(function () { if (pop && pop.el === el) document.addEventListener("mousedown", out, true); }, 0);
    el.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(); grid.focus(); } });
  }
  /** A question asked in the page (the frame is sandboxed: no prompt()). Resolves the text, or null. */
  function ask(label, value, multiline) {
    return new Promise(function (done) {
      var input = h(multiline ? "textarea" : "input", { "class": "sh-q-in", type: multiline ? null : "text", "aria-label": label });
      input.value = value || "";
      var ok = h("button", { type: "button", "class": "sh-b pri", text: multiline ? T.send : T.ok }), no = h("button", { type: "button", "class": "sh-b", text: T.cancel });
      var el = h("div", { "class": "sh-pop sh-dlg", role: "dialog", "aria-label": label }, [h("div", { "class": "sh-dlg-q", text: label }), input, h("div", { "class": "sh-dlg-bar" }, [no, ok])]);
      var finish = function () { var v = input.value.trim(); var p = pop; pop = null; if (p) { p.el.remove(); document.removeEventListener("mousedown", p.out, true); } done(v || null); grid.focus(); };
      ok.addEventListener("click", finish);
      no.addEventListener("click", function () { closePop(); grid.focus(); });
      input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !(multiline && e.shiftKey)) { e.preventDefault(); finish(); } });
      openPop(el, null, done);
      input.focus(); input.select();
    });
  }
  var SWATCH = ["#000000", "#434343", "#666666", "#999999", "#cccccc", "#efefef", "#f3f3f3", "#ffffff",
    "#fde2e1", "#fdecc8", "#fff3bf", "#d3f9d8", "#d0ebff", "#e5dbff", "#ffdeeb", "#e3fafc",
    "#e03131", "#f08c00", "#f2c200", "#2f9e44", "#1971c2", "#7048e8", "#c2255c", "#0c8599"];
  function colorPop(anchor, which) {
    commitIfEditing();
    var grid8 = h("div", { "class": "sh-sw" });
    SWATCH.forEach(function (c) {
      grid8.appendChild(h("button", { type: "button", title: c, style: "background:" + c, onclick: function () { closePop(); var o = {}; o[which] = c; fmtSel(o); grid.focus(); } }));
    });
    var none = h("button", { type: "button", "class": "sh-none", text: which === "bg" ? T.noFill : T.autoColor, onclick: function () { closePop(); var o = {}; o[which] = null; fmtSel(o); grid.focus(); } });
    openPop(h("div", { "class": "sh-pop", role: "dialog", "aria-label": which === "bg" ? T.fill : T.textColor }, [grid8, none]), anchor);
  }

  // ------------------------------------------------------------------ find (Ctrl+F)
  var findEl = null, findIn = null, findN = null, findList = [], findAt = -1;
  function openFind() {
    if (!findEl) {
      findIn = h("input", { type: "search", placeholder: T.findPh, "aria-label": T.find });
      findN = h("span", { "class": "sh-n", "aria-live": "polite" });
      findEl = h("div", { "class": "sh-pop sh-find", role: "search" }, [findIn, findN,
        barBtn(T.prev, kit.icon("prev"), function () { findGo(-1); }), barBtn(T.next, kit.icon("next"), function () { findGo(1); }),
        barBtn(T.close, kit.icon("close"), closeFind)]);
      findIn.addEventListener("input", runFind);
      findIn.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); }
        else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
      });
    }
    if (!findEl.parentNode) document.body.appendChild(findEl);
    findEl.style.top = grid.getBoundingClientRect().top + 8 + "px";
    findIn.focus(); findIn.select();
    if (findIn.value) runFind();
  }
  function runFind() {
    var q = findIn.value.trim().toLowerCase(), s = S();
    findList = []; foundSet = null; findAt = -1;
    if (q) {
      foundSet = {};
      for (var k in s.cells) {
        var d = display(s, k, valueOf(s, k)).toLowerCase();
        if (d.indexOf(q) >= 0 || String(s.cells[k]).toLowerCase().indexOf(q) >= 0) { var p = parseKey(k); if (p) { findList.push(p); foundSet[k] = 1; } }
      }
      findList.sort(function (a, b) { return a.r - b.r || a.c - b.c; });
    }
    findN.textContent = q ? (findList.length ? "0/" + findList.length : T.noMatch) : "";
    renderAll(true);
    if (findList.length) findGo(1, true);
  }
  function findGo(d, keepFocus) {
    if (!findList.length) return;
    findAt = (findAt + d + findList.length) % findList.length;
    var p = findList[findAt];
    select(p.r, p.c, false);
    findN.textContent = findAt + 1 + "/" + findList.length;
    if (!keepFocus) findIn.focus();
  }
  function closeFind() { if (findEl) findEl.remove(); foundSet = null; findList = []; renderAll(true); grid.focus(); }

  // ------------------------------------------------------------------ history: list, preview in place, restore
  var banner = h("div", { "class": "sh-preview", hidden: true });
  grid.parentNode.insertBefore(banner, grid);
  var dtFmt = new Intl.DateTimeFormat(L === "hu" ? "hu" : "en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function openHistory(anchor) {
    commitIfEditing();
    flush();
    var s = book[cur];
    hm.sheet.history(s.id).then(function (r) {
      var list = ((r && r.snaps) || []).filter(function (x) { return x.rev < (r.rev != null ? r.rev : s.rev); });
      if (!list.length) return kit.menu(anchor, [{ hint: T.histNone }]);
      kit.menu(anchor, list.slice(0, 30).map(function (x) {
        var who = x.by === "hermes" ? T.byH : x.by === "restore" ? T.byRestore : x.by === "start" ? "" : T.byYou;
        return { label: dtFmt.format(new Date(x.at * 1000)) + (who ? " · " + who : ""), onClick: function () { showPreview(s, x); } };
      }));
    }).catch(function (e) { kit.toast(String(e && e.message || e)); });
  }
  function showPreview(s, x) {
    hm.sheet.at(s.id, x.rev).then(function (r) {
      var p = normSheet({ id: s.id, name: s.name, rev: s.rev });
      loadRead(p, r);
      p.name = s.name; p.vals = {};
      if (ed) cancelEdit();
      preview = p; preview.snapRev = x.rev;
      banner.innerHTML = "";
      banner.append(h("span", { text: fill(T.showing, { t: dtFmt.format(new Date((r.at || x.at) * 1000)) }) }),
        h("button", { type: "button", "class": "sh-b pri", text: T.restoreThis, onclick: function () {
          hm.sheet.restore(s.id, x.rev).then(function () { closePreview(); kit.toast(T.restored); undoS = []; redoS = []; drawUndo(); return readSheet(s); })
            .catch(function (e) { kit.toast(String(e && e.message || e)); });
        } }),
        h("button", { type: "button", "class": "sh-b", text: T.backNow, onclick: closePreview }));
      banner.hidden = false;
      document.documentElement.classList.add("sh-ro");
      invalidate(); refresh();
    }).catch(function (e) { kit.toast(String(e && e.message || e)); });
  }
  function closePreview() {
    if (!preview) return;
    preview = null; banner.hidden = true;
    document.documentElement.classList.toggle("sh-ro", !editable);
    invalidate(); refresh();
  }

  // ------------------------------------------------------------------ export and import (xlsx.js; fflate fetched on first use)
  var libs = {};
  function lib(name, global) {
    if (window[global]) return Promise.resolve(window[global]);
    if (!hm || !hm.vendor) return Promise.reject(new Error(T.noLib));
    return (libs[name] = libs[name] || hm.vendor(name).then(function (src) {
      (0, eval)(src + "\n//# sourceURL=vendor/" + name);
      if (!window[global]) throw new Error(T.noLib);
      return window[global];
    }));
  }
  function busy(on) {
    var b = document.querySelector(".sh-busy");
    if (on && !b) document.body.appendChild(h("div", { "class": "kit-empty sh-busy", text: T.building }));
    if (!on && b) b.remove();
  }
  function computedVals(s) {
    var out = {};
    for (var k in s.cells) if (isFormula(s.cells[k])) out[k] = valueOf(s, k);
    return out;
  }
  function bookTitle() { return C.title || book[0].name || "sheet"; }
  function exportXlsx() {
    commitIfEditing();
    flush();
    if (!X || !X.write) return kit.toast(T.noXlsx);
    busy(true);
    lib("fflate.umd.js", "fflate").then(function () {
      var bytes = X.write({ sheets: book.map(function (s) { return { name: s.name, cells: s.cells, fmt: s.fmt, vals: computedVals(s), cols: s.cols, freeze: s.freeze }; }) });
      var type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      kit.download(kit.slug(bookTitle()) + ".xlsx", new Blob([bytes], { type: type }), type);
    }).catch(function (e) { kit.toast(String(e && e.message || e)); }).then(function () { busy(false); });
  }
  function exportCsv() {
    commitIfEditing();
    var s = S(), sep = L === "hu" ? ";" : ",", vals = computedVals(s), text;
    if (X && X.toCsv) text = X.toCsv(s, vals, sep);
    else {
      var u = used(s), lines = [];
      for (var r = 0; r <= u.r; r++) {
        var row = [];
        for (var c = 0; c <= u.c; c++) {
          var k = key(r, c), v = isFormula(s.cells[k]) ? vals[k] : s.cells[k], t = v == null ? "" : isErr(v) ? v.error : String(v);
          row.push(/[",;\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
        }
        lines.push(row.join(sep));
      }
      text = lines.join("\r\n");
    }
    kit.download(kit.slug(bookTitle() + (book.length > 1 ? " - " + s.name : "")) + ".csv", "﻿" + text, "text/csv");
  }
  var fileIn = h("input", { type: "file", accept: ".xlsx,.csv,.tsv,.txt", hidden: true });
  document.body.appendChild(fileIn);
  var importMode = "new";
  function pickImport(mode) { importMode = mode; fileIn.value = ""; fileIn.click(); }
  fileIn.addEventListener("change", function () {
    var f = fileIn.files && fileIn.files[0];
    if (!f) return;
    var base = f.name.replace(/\.[^.]+$/, "");
    busy(true);
    var p = /\.xlsx$/i.test(f.name)
      ? (X && X.read ? f.arrayBuffer().then(function (buf) { return lib("fflate.umd.js", "fflate").then(function () { return X.read(new Uint8Array(buf)).sheets || []; }); }) : Promise.reject(new Error(T.noXlsx)))
      : f.arrayBuffer().then(function (buf) {
        var text = new TextDecoder("utf-8").decode(buf);
        if (text.indexOf("�") >= 0) { try { text = new TextDecoder("windows-1250").decode(buf); } catch (e) {} }
        text = text.replace(/^﻿/, "");
        var cells = X && X.fromCsv ? X.fromCsv(text).cells : csvCells(text);
        return [{ name: base, cells: cells, fmt: {}, cols: {}, freeze: { rows: 0, cols: 0 } }];
      });
    p.then(function (sheets) { return importSheets(sheets, base); })
      .then(function () { kit.toast(T.imported); })
      .catch(function (e) { kit.toast(String(e && e.message || e)); })
      .then(function () { busy(false); });
  });
  function csvCells(text) {
    var first = text.split("\n")[0], sep = (first.match(/\t/g) || []).length ? "\t" : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
    var rows = parseTsv(sep === "\t" ? text : text.split(sep).join("\t")), cells = {};
    rows.forEach(function (row, r) { row.forEach(function (t, c) { var v = parseText(t).value; if (v !== "") cells[key(r, c)] = v; }); });
    return cells;
  }
  function rowsOf(cells) {
    var mr = -1, mc = -1, k, p;
    for (k in cells) { p = parseKey(k); if (p && p.r < MAXR && p.c < MAXC) { mr = Math.max(mr, p.r); mc = Math.max(mc, p.c); } }
    var rows = [];
    for (var r = 0; r <= mr; r++) { var row = []; for (var c = 0; c <= mc; c++) { var v = cells[key(r, c)]; row.push(v === undefined ? null : v); } rows.push(row); }
    return rows;
  }
  // Format ops for an imported sheet: runs of equal formats along each row.
  function fmtOpsOf(fmt) {
    var byRow = {}, ops = [];
    Object.keys(fmt || {}).forEach(function (k) { var p = parseKey(k); if (p && p.r < MAXR && p.c < MAXC) (byRow[p.r] = byRow[p.r] || []).push(p.c); });
    Object.keys(byRow).forEach(function (r) {
      r = +r;
      var cs = byRow[r].sort(function (a, b) { return a - b; }), i = 0;
      while (i < cs.length) {
        var sig = JSON.stringify(fmt[key(r, cs[i])]), j = i;
        while (j + 1 < cs.length && cs[j + 1] === cs[j] + 1 && JSON.stringify(fmt[key(r, cs[j + 1])]) === sig) j++;
        var o = JSON.parse(sig) || {}, op = { op: "format", range: rangeName({ r1: r, c1: cs[i], r2: r, c2: cs[j] }) };
        FMT_KEYS.forEach(function (x) { if (o[x] != null) op[x] = o[x]; });
        ops.push(op);
        i = j + 1;
      }
    });
    return ops;
  }
  function extrasOf(sh) {
    var ops = fmtOpsOf(sh.fmt);
    Object.keys(sh.cols || {}).forEach(function (c) { ops.push({ op: "col_width", col: c, w: clamp(Math.round(sh.cols[c]), 40, 800) }); });
    if (sh.freeze && (sh.freeze.rows || sh.freeze.cols)) ops.push({ op: "freeze", rows: sh.freeze.rows || 0, cols: sh.freeze.cols || 0 });
    return ops;
  }
  function inChunks(s, ops) {
    var p = Promise.resolve();
    for (var i = 0; i < ops.length; i += 400) (function (part) { p = p.then(function () { return structural(part, byId(s.id) || s); }); })(ops.slice(i, i + 400));
    return p;
  }
  function importSheets(sheets, base) {
    if (!sheets.length) return Promise.resolve();
    if (importMode === "replace") {
      var s = S(), sh = sheets[0], u = used(s), ops = [];
      if (u.r >= 0) ops.push({ op: "clear", range: rangeName({ r1: 0, c1: 0, r2: u.r, c2: Math.max(0, u.c) }) });
      ops.push(fmtOp({ r1: 0, c1: 0, r2: Math.max(0, u.r + 1), c2: Math.max(0, u.c) }, { bold: null, italic: null, underline: null, align: null, num: null, bg: null, fg: null, wrap: null }));
      var rows = rowsOf(sh.cells);
      if (rows.length) ops.push({ op: "set", range: "A1", values: rows });
      return inChunks(s, ops.concat(extrasOf(sh)));
    }
    var p = Promise.resolve();
    sheets.slice(0, Math.max(0, 20 - book.length)).forEach(function (sh) {
      p = p.then(function () {
        return addSheet(sheets.length > 1 ? sh.name : base, rowsOf(sh.cells)).then(function (ns) {
          var extra = extrasOf(sh);
          return ns && extra.length ? inChunks(ns, extra) : null;
        });
      });
    });
    return p;
  }

  // ------------------------------------------------------------------ live: Hermes' edits arrive, computed values go back
  function setHermes(on) { if (on !== hermesActive) { hermesActive = on; drawFoot(); } }
  function flashCells(s, keys) {
    if (!keys.length || s !== S()) return;
    keys.slice(0, 300).forEach(function (k) { flashSet[k] = 1; });
    renderAll(true);
    setTimeout(function () { keys.forEach(function (k) { delete flashSet[k]; }); renderAll(true); }, 2400);
    var first = keys.map(parseKey).filter(Boolean).sort(function (a, b) { return a.r - b.r || a.c - b.c; })[0];
    if (!first || first.r >= nRows || first.c >= nCols) return;
    var b = cellBox(first.r, first.c);
    if (b.x < HW || b.y < HH || b.x > vpW || b.y > vpH) return;
    var tag = h("div", { "class": "sh-who", text: T.byHermes, style: "left:" + b.x + "px;top:" + Math.max(HH, b.y - 18) + "px" });
    vp.appendChild(tag);
    setTimeout(function () { tag.remove(); }, 2700);
  }
  function applyDelta(s, r) {
    var keys = [];
    Object.keys(r.changed || {}).forEach(function (k) { s.cells[k] = r.changed[k]; keys.push(k); });
    (r.removed || []).forEach(function (k) { delete s.cells[k]; delete s.vals[k]; keys.push(k); });
    Object.keys(r.fmt || {}).forEach(function (k) { if (r.fmt[k]) s.fmt[k] = r.fmt[k]; else delete s.fmt[k]; });
    Object.keys(r.values || {}).forEach(function (k) { s.vals[k] = r.values[k]; });
    if (r.cols) s.cols = r.cols;
    if (r.freeze) s.freeze = { rows: r.freeze.rows || 0, cols: r.freeze.cols || 0 };
    if (r.charts) s.charts = r.charts;
    s.rev = r.rev; s._used = null;
    return keys;
  }
  function diffKeys(s, r) {
    var t = normSheet({ id: s.id, name: s.name }), out = [];
    loadRead(t, r);
    for (var k in t.cells) if (!same(t.cells[k], s.cells[k])) out.push(k);
    for (k in s.cells) if (!(k in t.cells)) out.push(k);
    return out;
  }
  function pull() {
    if (!live) return;
    chain = chain.then(function () {
      if (pending() || preview) return;
      var s = book[cur];
      return hm.sheet.read(s.id, s.rev).then(function (r) {
        if (!r || r.ok === false) return;
        if (typeof r.hermes_active === "boolean") setHermes(r.hermes_active);
        if (r.sheets) syncOverview(r.sheets);
        if (byId(s.id) !== s || pending()) return;
        var keys;
        if (r.since === "unavailable" || r.rows) {
          if (r.rev === s.rev && !r.since) return;
          keys = diffKeys(s, r).slice(0, 300);
          loadRead(s, r);
          if (r.since === "unavailable") { undoS = undoS.filter(function (e) { return e.id !== s.id; }); redoS = redoS.filter(function (e) { return e.id !== s.id; }); drawUndo(); }
        } else {
          if (r.rev === s.rev) return;
          keys = applyDelta(s, r);
        }
        invalidate();
        if (s === book[cur]) refresh();
        flashCells(s, keys);
        scheduleVals();
      });
    }).catch(function () {});
    return chain;
  }
  var valsTimer = null;
  function scheduleVals() { if (!live) return; clearTimeout(valsTimer); valsTimer = setTimeout(sendVals, 800); }
  function sendVals() {
    if (inflight || pending() || preview || ed) return scheduleVals();
    book.forEach(function (s) {
      if (s.needsRead) return;
      var out = {}, n = 0, k;
      for (k in s.cells) {
        if (!isFormula(s.cells[k])) continue;
        var v = valueOf(s, k), enc = isErr(v) ? { error: String(v.error) } : v === undefined ? null : v, old = s.vals[k];
        if (JSON.stringify(old === undefined ? null : old) !== JSON.stringify(enc)) { out[k] = enc; n++; }
      }
      for (k in s.vals) if (!isFormula(s.cells[k])) { out[k] = null; n++; }
      if (!n) return;
      var sent = s.rev;
      hm.sheet.vals(s.id, sent, out).then(function (r) {
        if (r && r.ok === false) return; // the rev moved on: sent again after the next read
        if (s.rev !== sent) return;
        for (var k2 in out) { if (out[k2] === null) delete s.vals[k2]; else s.vals[k2] = out[k2]; }
      }).catch(function () {});
    });
  }

  // ------------------------------------------------------------------ comments and asking Hermes
  var canComment = !!(hm && hm.comment) && !C.thumb;
  function commentSel() {
    var s = book[cur], k = key(sr, sc);
    hm.comment({ selector: "cell:" + s.id + "!" + k, text: (k + ": " + display(s, k, valueOf(s, k))).slice(0, 200), label: (s.name + " · " + k).slice(0, 40) });
  }
  function askSel() {
    commitIfEditing();
    var s = book[cur], R = selUsed(), rn = rangeName(R);
    ask(fill(T.askQ, { r: rn }), "", true).then(function (text) {
      if (!text) return;
      var Rc = { r1: R.r1, c1: R.c1, r2: Math.min(R.r2, R.r1 + 60), c2: Math.min(R.c2, R.c1 + 20) };
      hm.sheet.ask({ text: text, sheet: s.id, tab: s.name, range: rn, selection: tsvOf(s, Rc).slice(0, 2000) })
        .then(function (r) { kit.toast(r && r.mode === "draft" ? T.drafted : T.sent); })
        .catch(function (e) { kit.toast(String(e && e.message || e)); });
    });
  }
  function flashBox(r, c) {
    var b = cellBox(r, c), el = h("div", { "class": "sh-flashbox", style: "left:" + (b.x - 1) + "px;top:" + (b.y - 1) + "px;width:" + (b.w + 2) + "px;height:" + (b.h + 2) + "px" });
    vp.appendChild(el);
    setTimeout(function () { el.remove(); }, 1900);
  }
  if (hm && hm.on && !C.thumb) {
    // A comment's anchor clicked in the host: show that cell.
    hm.on("flash", function (d) {
      var m = /^cell:([^!]+)!\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(d && d.selector || ""));
      if (!m) return;
      var i = book.findIndex(function (s) { return s.id === m[1]; });
      if (i < 0) return;
      if (i !== cur) switchTo(i);
      var p = parseKey(m[2] + m[3]);
      select(p.r, p.c, false);
      setTimeout(function () { flashBox(p.r, p.c); }, 60);
    });
  }

  // ------------------------------------------------------------------ view context (with the next chat message)
  function sendView() {
    if (C.thumb) return;
    kit.view(function () {
      var s = book[cur];
      return { sheet: { id: s.id, name: s.name, rev: s.rev }, selection: rangeName(selR()), active: key(sr, sc),
        editing: !!ed || undefined, preview: preview ? preview.snapRev : undefined, version: C.version, edits: edits, dirty: !!(inflight || pending()) };
    });
  }

  // ------------------------------------------------------------------ status bar: Sum / Average / Count
  var foot = document.getElementById("sh-foot");
  var tabsEl = h("div", { "class": "sh-tabs", role: "tablist", "aria-label": T.sheetWord });
  var statsEl = h("div", { "class": "sh-stats", "aria-live": "off" });
  var pill = h("span", { "class": "sh-pill", text: T.working });
  function statNum(v) {
    if (F && F.format) { try { return F.format(Math.round(v * 1e6) / 1e6, null, L); } catch (e) {} }
    return fmtNum.format(Math.round(v * 1e6) / 1e6);
  }
  function stats() {
    if (C.thumb) return;
    var s = S(), R = selR(), u = used(s), sum = 0, n = 0, cnt = 0;
    R.r2 = Math.min(R.r2, u.r); R.c2 = Math.min(R.c2, u.c);
    function one(k) { var v = valueOf(s, k); if (v === null || v === "") return; cnt++; if (typeof v === "number") { sum += v; n++; } }
    if (multi() && R.r2 >= R.r1 && R.c2 >= R.c1) {
      if (area(R) <= Object.keys(s.cells).length) eachIn(R, function (r, c, k) { if (s.cells[k] !== undefined) one(k); });
      else for (var k in s.cells) { var p = parseKey(k); if (p && inR(R, p.r, p.c)) one(k); }
    }
    statsEl.innerHTML = "";
    if (cnt > 1 || n > 0 && multi()) {
      if (n) {
        statsEl.appendChild(h("span", { html: kit.esc(T.sum) + ": <b>" + kit.esc(statNum(sum)) + "</b>" }));
        statsEl.appendChild(h("span", { "class": "sh-avg", html: kit.esc(T.avg) + ": <b>" + kit.esc(statNum(sum / n)) + "</b>" }));
      }
      statsEl.appendChild(h("span", { "class": "sh-cnt", html: kit.esc(T.count) + ": <b>" + cnt + "</b>" }));
    }
    if (hermesActive) statsEl.appendChild(pill);
  }

  // ------------------------------------------------------------------ sheet tabs: switch, add, rename inline, delete, reorder
  function switchTo(i) {
    i = clamp(i, 0, book.length - 1);
    if (ed) commitEdit(0, 0);
    if (preview) closePreview();
    var old = book[cur];
    if (old) old._view = { sr: sr, sc: sc, er: er, ec: ec, selMode: selMode, sl: grid.scrollLeft, st: grid.scrollTop };
    cur = i;
    var s = book[cur], v = s._view || { sr: 0, sc: 0, er: 0, ec: 0, selMode: "cells", sl: 0, st: 0 };
    sr = v.sr; sc = v.sc; er = v.er; ec = v.ec; selMode = v.selMode;
    nRows = 50; nCols = 26; clip = clip && clip.id === s.id ? clip : clip;
    if (findEl && findEl.parentNode) closeFind();
    refresh();
    grid.scrollLeft = v.sl; grid.scrollTop = v.st; sl = grid.scrollLeft; st = grid.scrollTop; translate(); renderAll(true);
    drawTabs(); afterSel();
    if (s.needsRead && live) { s.needsRead = false; chain = chain.then(function () { return readSheet(s); }).catch(function () {}); }
  }
  var dragTab = null;
  function drawTabs() {
    if (C.thumb) return;
    tabsEl.innerHTML = "";
    book.forEach(function (s, i) {
      var b = h("button", { type: "button", role: "tab", "class": "sh-tab" + (i === cur ? " on" : ""), "aria-selected": i === cur ? "true" : "false", title: s.name, "data-i": i },
        [h("span", { text: s.name })]);
      b.addEventListener("click", function () { if (dragTab && dragTab.moved) return; if (i !== cur) switchTo(i); });
      b.addEventListener("dblclick", function () { if (!ro()) renameInline(b, s); });
      b.addEventListener("contextmenu", function (e) { e.preventDefault(); tabMenu(b, s); });
      b.addEventListener("keydown", function (e) { if (e.key === "F2" && !ro()) { e.preventDefault(); renameInline(b, s); } });
      b.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 || ro()) return;
        dragTab = { s: s, x: e.clientX, moved: false, b: b };
      });
      tabsEl.appendChild(b);
    });
  }
  function tabTarget(x) {
    var bs = tabsEl.querySelectorAll(".sh-tab"), t = bs.length - 1;
    for (var i = 0; i < bs.length; i++) { var r = bs[i].getBoundingClientRect(); if (x < r.left + r.width / 2) { t = i; break; } else t = i + 1; }
    return t;
  }
  document.addEventListener("pointermove", function (e) {
    if (!dragTab) return;
    if (!dragTab.moved && Math.abs(e.clientX - dragTab.x) < 6) return;
    dragTab.moved = true;
    var t = tabTarget(e.clientX), bs = tabsEl.querySelectorAll(".sh-tab");
    [].forEach.call(bs, function (b, i) { b.classList.toggle("drop-l", i === t); b.classList.toggle("drop-r", t === bs.length && i === bs.length - 1); });
  });
  document.addEventListener("pointerup", function (e) {
    if (!dragTab) return;
    var d = dragTab;
    if (d.moved) {
      var t = tabTarget(e.clientX), from = book.indexOf(d.s);
      if (t > from) t--;
      [].forEach.call(tabsEl.querySelectorAll(".sh-tab"), function (b) { b.classList.remove("drop-l", "drop-r"); });
      if (t !== from) moveSheet(d.s, t);
      setTimeout(function () { dragTab = null; }, 0);
    } else dragTab = null;
  });
  function renameInline(b, s) {
    var input = h("input", { type: "text", value: s.name, maxlength: "40", "aria-label": T.rename });
    b.innerHTML = ""; b.appendChild(input);
    input.focus(); input.select();
    var done = false;
    function finish(save) {
      if (done) return; done = true;
      var v = input.value.trim();
      if (save && v && v !== s.name) renameSheet(s, v); else drawTabs();
      grid.focus();
    }
    input.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); });
    input.addEventListener("blur", function () { finish(true); });
    input.addEventListener("click", function (e) { e.stopPropagation(); });
  }
  function tabMenu(b, s) {
    if (ro()) return;
    var i = book.indexOf(s), items = [{ label: T.rename, onClick: function () { renameInline(tabsEl.children[book.indexOf(s)], s); } }];
    if (i > 0) items.push({ label: T.moveL, onClick: function () { moveSheet(s, i - 1); } });
    if (i < book.length - 1) items.push({ label: T.moveR, onClick: function () { moveSheet(s, i + 1); } });
    if (book.length > 1) items.push({ label: T.delSheet, onClick: function () {
      var full = Object.keys(s.cells).length > 0;
      if (!full) return deleteSheet(s);
      setTimeout(function () { kit.menu(b, [{ hint: T.delSheetQ }, { label: T.del, onClick: function () { deleteSheet(s); } }, { label: T.cancel, onClick: function () {} }]); }, 0);
    } });
    kit.menu(b, items);
  }
  var addTab = null;
  function drawFoot() { stats(); }

  // ------------------------------------------------------------------ the toolbar (an overflow menu when narrow)
  function barBtn(label, html, fn, cls) {
    var b = h("button", { type: "button", "class": "kit-btn" + (cls ? " " + cls : ""), title: label, "aria-label": label, html: html });
    b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // the grid or the editor keeps the focus
    b.addEventListener("click", function (e) { fn(e, b); });
    return b;
  }
  var CARET = '<svg class="sh-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg>';
  var bar = document.getElementById("sh-bar");
  bar.className = "kit-bar";
  var NUMS = [
    { label: T.nGeneral, num: null }, { label: T.nNumber, num: "0.00" }, { label: T.nThousands, num: "#,##0" }, { label: T.nPercent, num: "0%" },
    { label: T.nFt, num: '#,##0 "Ft"' }, { label: T.nEur, num: "#,##0.00 €" }, { label: T.nUsd, num: "$#,##0.00" },
    { label: T.nDate, num: L === "hu" ? "yyyy.mm.dd." : "yyyy-mm-dd" }, { label: T.nText, num: "@" }];
  function numMenu(anchor) { commitIfEditing(); var c = curFmt().num || null; kit.menu(anchor, NUMS.map(function (x) { return { label: (x.num === c ? "✓ " : "   ") + x.label, onClick: function () { fmtSel({ num: x.num }); } }; })); }
  function insMenu(anchor) {
    commitIfEditing();
    kit.menu(anchor, [{ label: T.rowAbove, onClick: function () { insRows(false); } }, { label: T.rowBelow, onClick: function () { insRows(true); } },
      { label: T.colLeft, onClick: function () { insCols(false); } }, { label: T.colRight, onClick: function () { insCols(true); } },
      { label: T.delRows, onClick: delRows }, { label: T.delCols, onClick: delCols }]);
  }
  function sortMenu(anchor) { commitIfEditing(); kit.menu(anchor, [{ label: T.sortAsc, onClick: function () { sortSel(false); } }, { label: T.sortDesc, onClick: function () { sortSel(true); } }]); }
  function freezeMenu(anchor) {
    commitIfEditing();
    kit.menu(anchor, [{ label: T.freezeRow, onClick: function () { setFreeze(1, 0); } }, { label: T.freezeCol, onClick: function () { setFreeze(0, 1); } },
      { label: T.freezeHere, onClick: function () { setFreeze(Math.min(sr, 50), Math.min(sc, 20)); } }, { label: T.unfreeze, onClick: function () { setFreeze(0, 0); } }]);
  }
  function chartMenu(anchor) { commitIfEditing(); kit.menu(anchor, [{ label: T.cBar, onClick: function () { addChart("bar"); } }, { label: T.cLine, onClick: function () { addChart("line"); } }, { label: T.cPie, onClick: function () { addChart("pie"); } }]); }
  function expMenu(anchor) { kit.menu(anchor, exportList.map(function (x) { return { label: x.label, onClick: x.run }; })); }
  function impMenu(anchor) { kit.menu(anchor, [{ label: T.impNew, onClick: function () { pickImport("new"); } }, { label: T.impReplace, onClick: function () { pickImport("replace"); } }]); }
  var exportList = [{ id: "xlsx", label: T.xlsx, run: exportXlsx }, { id: "csv", label: T.csv, run: exportCsv }];
  // [label, icon html, action, edits?, wide (into the overflow menu when narrow), id]
  var TOOLS = [
    [T.undo, kit.icon("undo"), function () { undo(); grid.focus(); }, true, false, "undo"],
    [T.redo, kit.icon("redo"), function () { redo(); grid.focus(); }, true, false, "redo"],
    "|",
    [T.bold + " (Ctrl+B)", kit.icon("bold"), function () { toggleFmt("bold"); }, true, false, "bold"],
    [T.italic + " (Ctrl+I)", kit.icon("italic"), function () { toggleFmt("italic"); }, true, false, "italic"],
    [T.underline + " (Ctrl+U)", kit.icon("underline"), function () { toggleFmt("underline"); }, true, true, "underline"],
    "|w",
    [T.alignL, kit.icon("alignL"), function () { fmtSel({ align: curFmt().align === "left" ? null : "left" }); }, true, true, "alignL"],
    [T.alignC, kit.icon("alignC"), function () { fmtSel({ align: curFmt().align === "center" ? null : "center" }); }, true, true, "alignC"],
    [T.alignR, kit.icon("alignR"), function () { fmtSel({ align: curFmt().align === "right" ? null : "right" }); }, true, true, "alignR"],
    [T.wrap, ico("wrap"), function () { toggleFmt("wrap"); }, true, true, "wrap"],
    "|",
    [T.numFmt, ico("num") + CARET, function (e, b) { numMenu(b); }, true, false, "num"],
    [T.fill, '<span class="sh-ico">' + ico("bucket") + '</span>' + CARET, function (e, b) { colorPop(b, "bg"); }, true, true, "bg"],
    [T.textColor, '<span class="sh-ico">' + ico("fcolor") + '</span>' + CARET, function (e, b) { colorPop(b, "fg"); }, true, true, "fg"],
    "|w",
    [T.insert, ico("rows") + CARET, function (e, b) { insMenu(b); }, true, true, "ins"],
    [T.sort, ico("sort") + CARET, function (e, b) { sortMenu(b); }, true, true, "sort"],
    [T.freeze, ico("freeze") + CARET, function (e, b) { freezeMenu(b); }, true, true, "freeze"],
    [T.chart, ico("chart") + CARET, function (e, b) { chartMenu(b); }, true, true, "chart"],
    "|w",
    [T.comment, kit.icon("comment"), function () { commitIfEditing(); commentSel(); }, "comment", true, "comment"],
    [T.ask, kit.icon("sparkle"), function () { askSel(); }, "ask", false, "ask"]
  ];
  var toolEls = {}, moreItems = [];
  function hasTool(t) { return t[3] === "comment" ? canComment && live : t[3] === "ask" ? live && !!hm.sheet.ask : t[3] ? editable : true; }
  if (!C.thumb) {
    var lastSep = null;
    TOOLS.forEach(function (t) {
      if (typeof t === "string") { lastSep = h("span", { "class": "sh-sep" + (t === "|w" ? " sh-wide" : "") }); return; }
      if (!hasTool(t)) return;
      if (lastSep) { bar.appendChild(lastSep); lastSep = null; }
      var b = barBtn(t[0], t[1], t[2], t[4] ? "sh-wide" : "");
      toolEls[t[5]] = b; bar.appendChild(b);
      if (t[4]) moreItems.push(t);
    });
    if (bar.lastChild && bar.lastChild.classList.contains("sh-sep")) bar.lastChild.remove();
    bar.appendChild(h("span", { "class": "sh-gap" }));
    bar.appendChild(status);
    bar.appendChild(barBtn(T.find + " (Ctrl+F)", ico("search"), function () { openFind(); }));
    if (live && hm.sheet.history) bar.appendChild(barBtn(T.hist, kit.icon("history"), function (e, b) { openHistory(b); }, "sh-wide"));
    if (editable) bar.appendChild(barBtn(T.imp, ico("upload"), function (e, b) { impMenu(b); }, "sh-wide"));
    bar.appendChild(kit.labelled(barBtn(T.exp, kit.icon("download") + "<span></span>", function (e, b) { expMenu(b); }), T.exp));
    var moreBtn = barBtn(T.more, kit.icon("more"), function (e, b) {
      var items = moreItems.map(function (t) {
        return { label: t[0].replace(/ \(Ctrl\+.\)$/, ""), onClick: function () { var tb = toolEls[t[5]]; t[2](null, /^(bg|fg|ins|sort|freeze|chart)$/.test(t[5]) ? b : tb); } };
      });
      if (live && hm.sheet.history) items.push({ label: T.hist, onClick: function () { openHistory(b); } });
      if (editable) items.push({ label: T.imp, onClick: function () { impMenu(b); } });
      kit.menu(b, items);
    }, "sh-more");
    bar.appendChild(moreBtn);
    if (!live) setStatus(T.offline);
    foot.append(tabsEl);
    if (editable) { addTab = barBtn(T.addSheet, kit.icon("plus"), function () { addSheet(); }, "sh-addtab"); foot.appendChild(addTab); }
    foot.appendChild(statsEl);
    kit.exports(exportList);
  }
  function drawUndo() {
    if (toolEls.undo) toolEls.undo.disabled = !undoS.length;
    if (toolEls.redo) toolEls.redo.disabled = !redoS.length;
  }
  function cellMenu(x, y) {
    var a = h("div", { style: "position:fixed;width:1px;height:1px;left:" + x + "px;top:" + y + "px" });
    document.body.appendChild(a);
    setTimeout(function () { a.remove(); }, 0);
    var items = [{ label: T.copy + "  (Ctrl+C)", onClick: function () { grid.focus(); try { document.execCommand("copy"); } catch (e) { kit.toast("Ctrl+C"); } } }];
    if (!ro()) items = items.concat([
      { label: T.cut + "  (Ctrl+X)", onClick: function () { grid.focus(); try { document.execCommand("cut"); } catch (e) { kit.toast("Ctrl+X"); } } },
      { label: T.paste + "  (Ctrl+V)", onClick: function () {
        grid.focus();
        if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function (t) {
          if (clip && normText(t) === clip.text) pasteInternal(); else pasteValues(parseTsv(t).map(function (row) { return row.map(function (c) { return parseText(c).value; }); }));
        }, function () { kit.toast(T.pasteHint); });
        else kit.toast(T.pasteHint);
      } },
      { label: T.rowAbove, onClick: function () { insRows(false); } }, { label: T.colLeft, onClick: function () { insCols(false); } },
      { label: T.delRows, onClick: delRows }, { label: T.delCols, onClick: delCols },
      { label: T.sortAsc, onClick: function () { sortSel(false); } }, { label: T.sortDesc, onClick: function () { sortSel(true); } },
      { label: T.clear, onClick: clearSel }, { label: T.clearFmt, onClick: clearFormats }]);
    if (!ro()) items.push({ label: T.chart + "…", onClick: function () { chartMenu(a.isConnected ? a : grid); } });
    if (canComment && live) items.push({ label: T.comment, onClick: commentSel });
    if (live && hm.sheet.ask) items.push({ label: T.ask, onClick: askSel });
    document.body.appendChild(a);
    kit.menu(a, items);
  }

  // ------------------------------------------------------------------ start
  if (!editable) document.documentElement.classList.add("sh-ro");
  drawTabs();
  refresh();
  afterSel();
  drawUndo();
  if (C.thumb) document.documentElement.classList.add("sh-thumb");
  kit.ready();
  if (live) {
    hm.on("sheet", function () { pull(); });
    setInterval(function () { if (!document.hidden && !ed && !inflight && !pending()) pull(); }, 4000);
    window.addEventListener("blur", function () { if (ed) return; flush(); });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });
    scheduleVals();
  }
})();
