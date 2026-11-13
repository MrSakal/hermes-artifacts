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
  window.__hermesDefer = true; // the host's "ready" comes from kit.ready(), after the first real render
  // The UI's words in the app's language (hu over en, key by key).
  function pickLang(t, l) { var o = {}, k; for (k in t.en) o[k] = t.en[k]; for (k in t[l] || {}) o[k] = t[l][k]; return o; }
  var kit = window.kit, h = kit.h, C = kit.content, hm = window.hermes, F = window.sheetFormula || null, X = window.sheetXlsx || null;
  var L = /^hu\b/i.test(C.lang || navigator.language || "") ? "hu" : "en";

  // ------------------------------------------------------------------ strings
  var T = pickLang({
    en: { noHost: "Not connected to Hermes: changes won't be saved.", undo: "Undo", redo: "Redo", bold: "Bold", italic: "Italic", underline: "Underline",
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
      dropdown: "Dropdown", ddTitle: "Dropdown options, one per line", ddRemove: "Remove dropdown", ddEdit: "Edit options…", ddNone: "Clear",
      checkbox: "Checkbox", filter: "Filter", fltCol: "Filter this column", fltOn: "Filter on: {n} of {m} rows shown", fltClear: "Clear filter",
      fltSearch: "Search values", fltAll: "Select all", fltBlank: "(Blanks)", fltHide: "Hide filter buttons", fltMore: "{n} more: search to find them",
      csvAll: "CSV (this sheet, all rows)",
      align: "Align", borders: "Borders", merge: "Merge cells", unmerge: "Unmerge cells", rules: "Conditional formatting",
      decLess: "Fewer decimals", decMore: "More decimals", currency: "Currency", ddOptions: "Options", ckTick: "Tick or untick", ckRemove: "Remove checkbox", dateToday: "Date (today)",
      view: "View", zoom: "Zoom", zoomIn: "Zoom in", zoomOut: "Zoom out", zoomReset: "Reset", showFx: "Show formulas", layout: "Layout", layComfy: "Comfortable", layCompact: "Compact",
      theme: "Theme", thAuto: "Automatic", thLight: "Light", thDark: "Dark",
      err_div: "The formula divides by zero or by an empty cell.", err_ref: "The formula refers to a cell or a sheet that does not exist.",
      err_name: "The formula has a name or a piece of syntax the sheet does not understand.", err_nameFn: "The formula uses {f}, a function this sheet does not know.",
      err_value: "The formula uses a value of the wrong kind, such as text where a number is needed.", err_na: "The formula looked for a value and did not find it.",
      err_num: "The formula gives a number that is not valid or is too large.", err_cycle: "The formula refers back to its own cell (a circular reference).",
      err_null: "The formula uses two ranges that do not meet.", err_other: "The formula returns an error.",
      fixAsk: "Ask Hermes to fix", fixMsg1: "Fix this formula error.", fixMsgN: "Fix these {n} formula errors.", fixMsgMore: "(The workbook has {n} in all.)",
      errOne: "1 error", errMany: "{n} errors",
      fltAddCol: "Filter another column", fltYou: "Filtered for you only", fltClearAll: "Clear all", fltChip: "{c} {o} {v}", fltChipVals: "{c}: {n} values",
      fltRows: "{n} of {m} rows", fltDrop: "Remove", fltSortAll: "Sort — for everyone", fltYouHead: "Filter — for you only", fltAddCond: "Add a condition",
      fltSuggest: "Suggested", fltNot: "Not {v}", fltNRows: "{n} rows", fltRow1: "1 row", fltCond: "Condition", fltValue: "Value", fltValsHead: "Values — {n} of {m} rows",
      fo_is: "Is", fo_isnt: "Is not", fo_has: "Contains", fo_hasnt: "Does not contain", fo_starts: "Starts with", fo_ends: "Ends with", fo_blank: "Is blank", fo_nblank: "Is not blank",
      fo_gt: "Is greater than", fo_ge: "Is at least", fo_lt: "Is less than", fo_le: "Is at most", fo_before: "Is before", fo_after: "Is after",
      fo_dup: "Is a duplicate", fo_err: "Is an error", fo_true: "Is ticked", fo_false: "Is not ticked",
      repl: "Replace", repPh: "Replace with", rep1: "Replace", repAll: "Replace all", findScope: "Search in", findThis: "This sheet", findAll: "All sheets",
      findCase: "Match case", findWhole: "Match entire cell", findFx: "Also search in formulas", repDone: "Replaced in {n} cells", repNone: "Nothing to replace",
      min: "Min", max: "Max", aggPick: "Choose what the selection shows",
      ok: "OK" },
    hu: { noHost: "Nincs kapcsolat a Hermesszel: a módosítások nem mentődnek.", undo: "Visszavonás", redo: "Mégis", bold: "Félkövér", italic: "Dőlt", underline: "Aláhúzott",
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
      dropdown: "Legördülő lista", ddTitle: "A lista elemei, soronként egy", ddRemove: "Lista eltávolítása", ddEdit: "Elemek szerkesztése…", ddNone: "Törlés",
      checkbox: "Jelölőnégyzet", filter: "Szűrő", fltCol: "Oszlop szűrése", fltOn: "Szűrő bekapcsolva: {m} sorból {n} látszik", fltClear: "Szűrő törlése",
      fltSearch: "Értékek keresése", fltAll: "Összes kijelölése", fltBlank: "(Üres)", fltHide: "Szűrőgombok elrejtése", fltMore: "Még {n}: kereséssel megtalálod",
      csvAll: "CSV (ez a munkalap, minden sor)",
      align: "Igazítás", borders: "Szegélyek", merge: "Cellák egyesítése", unmerge: "Egyesítés megszüntetése", rules: "Feltételes formázás",
      decLess: "Kevesebb tizedesjegy", decMore: "Több tizedesjegy", currency: "Pénznem", ddOptions: "Elemek", ckTick: "Bejelölés vagy törlés", ckRemove: "Jelölőnégyzet eltávolítása", dateToday: "Dátum (ma)",
      view: "Nézet", zoom: "Nagyítás", zoomIn: "Nagyítás", zoomOut: "Kicsinyítés", zoomReset: "Alaphelyzet", showFx: "Képletek megjelenítése", layout: "Elrendezés", layComfy: "Kényelmes", layCompact: "Tömör",
      theme: "Téma", thAuto: "Automatikus", thLight: "Világos", thDark: "Sötét",
      err_div: "A képlet nullával vagy üres cellával oszt.", err_ref: "A képlet nem létező cellára vagy munkalapra hivatkozik.",
      err_name: "A képletben olyan név vagy írásmód van, amelyet a munkalap nem ért.", err_nameFn: "A képlet a(z) {f} függvényt használja, amelyet ez a munkalap nem ismer.",
      err_value: "A képlet nem megfelelő típusú értéket használ, például szöveget ott, ahol szám kell.", err_na: "A képlet keresett egy értéket, de nem találta.",
      err_num: "A képlet érvénytelen vagy túl nagy számot ad.", err_cycle: "A képlet a saját cellájára hivatkozik vissza (körkörös hivatkozás).",
      err_null: "A képlet két olyan tartományt használ, amelyek nem metszik egymást.", err_other: "A képlet hibát ad.",
      fixAsk: "Javíttasd a Hermesszel", fixMsg1: "Javítsd ki ezt a képlethibát.", fixMsgN: "Javítsd ki ezt a(z) {n} képlethibát.", fixMsgMore: "(A munkafüzetben összesen {n} van.)",
      errOne: "1 hiba", errMany: "{n} hiba",
      fltAddCol: "Másik oszlop szűrése", fltYou: "Csak neked szűrve", fltClearAll: "Összes törlése", fltChip: "{c}: {o} {v}", fltChipVals: "{c}: {n} érték",
      fltRows: "{m} sorból {n}", fltDrop: "Eltávolítás", fltSortAll: "Rendezés — mindenkinek", fltYouHead: "Szűrés — csak neked", fltAddCond: "Feltétel hozzáadása",
      fltSuggest: "Javasolt", fltNot: "Nem {v}", fltNRows: "{n} sor", fltRow1: "1 sor", fltCond: "Feltétel", fltValue: "Érték", fltValsHead: "Értékek — {m} sorból {n}",
      fo_is: "Egyenlő", fo_isnt: "Nem egyenlő", fo_has: "Tartalmazza", fo_hasnt: "Nem tartalmazza", fo_starts: "Ezzel kezdődik", fo_ends: "Erre végződik", fo_blank: "Üres", fo_nblank: "Nem üres",
      fo_gt: "Nagyobb, mint", fo_ge: "Legalább", fo_lt: "Kisebb, mint", fo_le: "Legfeljebb", fo_before: "Korábbi, mint", fo_after: "Későbbi, mint",
      fo_dup: "Ismétlődik", fo_err: "Hibás", fo_true: "Bejelölve", fo_false: "Nincs bejelölve",
      repl: "Csere", repPh: "Csere erre", rep1: "Csere", repAll: "Összes cseréje", findScope: "Keresés helye", findThis: "Ez a munkalap", findAll: "Minden munkalap",
      findCase: "Kis- és nagybetű egyezzen", findWhole: "A teljes cella egyezzen", findFx: "Keresés a képletekben is", repDone: "{n} cellában cserélve", repNone: "Nincs mit cserélni",
      min: "Minimum", max: "Maximum", aggPick: "Válaszd ki, mit mutasson a kijelölésről",
      ok: "OK" }
  }, L);
  kit.degraded(T.noHost); // no host: said once; the page still shows what it has
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
    eraser: "M8 20h12M5 14l8-8 6 6-6 6H9z",
    dropdown: "M3 7h18v10H3zM13.5 11l2.5 2.5 2.5-2.5M6.5 12h4",
    checkbox: "M5 5h14v14H5zM8.5 12l2.5 2.5 4.5-5",
    filter: "M4 5h16l-6 7.5V19l-4-2v-4.5z"
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

  // ------------------------------------------------------------------ pure helpers (no DOM): filter conditions, error kinds, find and replace, decimals
  // tests/test_sheet_page.py runs the block between the two markers under node.
  // >>> pure
  var PURE = (function () {
    // "1 234,5", "1,234.5", "12" -> a number; anything else -> null
    function num(t) {
      t = String(t == null ? "" : t).replace(/[\s\u00a0]/g, "");
      if (!t) return null;
      if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
      else if (/^[-+]?\d{1,3}(\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
      else if (/^[-+]?\d*,\d+$/.test(t)) t = t.replace(",", ".");
      return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? parseFloat(t) : null;
    }
    // "2026-03-01", "2026.03.01.", "2026. 3. 1." -> "2026-03-01"; anything else -> null
    function date(t) {
      var m = /^(\d{4})\s*[-.\/]\s*(\d{1,2})\s*[-.\/]\s*(\d{1,2})\.?(?:$|[\sT])/.exec(String(t == null ? "" : t).trim());
      if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
      return m[1] + "-" + (m[2].length < 2 ? "0" : "") + m[2] + "-" + (m[3].length < 2 ? "0" : "") + m[3];
    }
    var NOVAL = /^(blank|nblank|dup|err|true|false)$/;
    function needsVal(op) { return !NOVAL.test(op); }
    // A condition filters once it is complete: one that needs a value does nothing until it has one.
    function active(c) { return !!c && (!needsVal(c.op) || String(c.val == null ? "" : c.val).trim() !== ""); }
    function prep(c) { var v = String(c.val == null ? "" : c.val).trim(); return { op: c.op, s: v.toLowerCase(), n: num(v), d: date(v) }; }
    function isIso(v) { return typeof v === "string" && /^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$/.test(v); }
    /** Does a cell meet a prepared condition? x: {t: the text it shows, v: its computed value, dup: its text is in the column twice}. */
    function test(p, x) {
      var t = String(x.t == null ? "" : x.t).trim().toLowerCase(), v = x.v;
      switch (p.op) {
        case "is": return t === p.s || typeof v === "number" && p.n !== null && Math.abs(v - p.n) < 1e-9 || isIso(v) && p.d !== null && v.slice(0, 10) === p.d;
        case "isnt": return !test({ op: "is", s: p.s, n: p.n, d: p.d }, x);
        case "has": return t.indexOf(p.s) >= 0;
        case "hasnt": return t.indexOf(p.s) < 0;
        case "starts": return t.slice(0, p.s.length) === p.s;
        case "ends": return p.s.length <= t.length && t.slice(t.length - p.s.length) === p.s;
        case "blank": return t === "";
        case "nblank": return t !== "";
        case "gt": return typeof v === "number" && p.n !== null && v > p.n;
        case "ge": return typeof v === "number" && p.n !== null && v >= p.n;
        case "lt": return typeof v === "number" && p.n !== null && v < p.n;
        case "le": return typeof v === "number" && p.n !== null && v <= p.n;
        case "before": return isIso(v) && p.d !== null && v.slice(0, 10) < p.d;
        case "after": return isIso(v) && p.d !== null && v.slice(0, 10) > p.d;
        case "dup": return !!x.dup;
        case "err": return !!(v && typeof v === "object" && v.error);
        case "true": return v === true;
        case "false": return v !== true;
      }
      return true;
    }
    // The first function a formula calls that is not among names (upper case); null when all are known.
    function unknownFn(fx, names) {
      var t = String(fx == null ? "" : fx), i = 0, n = t.length;
      if (!names || !names.length) return null;
      while (i < n) {
        var ch = t.charAt(i);
        if (ch === '"' || ch === "'") { i++; while (i < n && !(t.charAt(i) === ch && t.charAt(i + 1) !== ch)) i += t.charAt(i) === ch ? 2 : 1; i++; continue; }
        var m = /^[A-Za-z_\u00c0-\u024f][\w.\u00c0-\u024f]*/.exec(t.slice(i));
        if (m) {
          i += m[0].length;
          if (t.charAt(i) === "(" && names.indexOf(m[0].toUpperCase()) < 0) return m[0].toUpperCase();
          continue;
        }
        i++;
      }
      return null;
    }
    var ERRK = { "#DIV/0!": "div", "#REF!": "ref", "#NAME?": "name", "#VALUE!": "value", "#N/A": "na", "#NUM!": "num", "#CYCLE!": "cycle", "#NULL!": "null" };
    /** What kind of error a code is, for its sentence: {kind, fn} (fn: the unknown function of a #NAME?). */
    function errInfo(code, fx, names) {
      var k = ERRK[String(code)] || "other", f = k === "name" ? unknownFn(fx, names) : null;
      return { kind: f ? "nameFn" : k, fn: f };
    }
    function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    // o: {cs: match case, whole: the entire cell}
    function matches(text, q, o) {
      text = String(text); q = String(q);
      if (!q) return false;
      if (!(o && o.cs)) { text = text.toLowerCase(); q = q.toLowerCase(); }
      return o && o.whole ? text === q : text.indexOf(q) >= 0;
    }
    function replace(text, q, rep, o) {
      text = String(text);
      if (!matches(text, q, o)) return text;
      if (o && o.whole) return String(rep);
      return text.replace(new RegExp(reEsc(q), o && o.cs ? "g" : "gi"), function () { return String(rep); });
    }
    /** A number format with d more (or fewer) decimals; shown: the decimals a General cell shows now. null: not a number format. */
    function decimals(fmt, d, shown) {
      var zeros = function (n) { return n > 0 ? "." + new Array(n + 1).join("0") : ""; };
      if (fmt == null || fmt === "") return "0" + zeros(Math.max(0, Math.min(10, (shown || 0) + d)));
      fmt = String(fmt);
      var mask = fmt.replace(/"[^"]*"|\\./g, function (m) { return new Array(m.length + 1).join(" "); }), out = "", at = 0, hit = false;
      mask.replace(/0(?:\.(0+))?(?![0.#,]*0)/g, function (m, dec, off) {
        var n = Math.max(0, Math.min(10, (dec ? dec.length : 0) + d));
        out += fmt.slice(at, off) + "0" + zeros(n); at = off + m.length; hit = true;
        return m;
      });
      return hit ? out + fmt.slice(at) : null;
    }
    return { num: num, date: date, needsVal: needsVal, active: active, prep: prep, test: test, unknownFn: unknownFn, errInfo: errInfo,
      matches: matches, replace: replace, decimals: decimals };
  })();
  // <<< pure

  // ------------------------------------------------------------------ model
  // book: [{id, name, rev, cells{A1: raw}, fmt{A1:{…}}, vals{A1: computed}, cols{A: px}, freeze{rows, cols}, charts[]}]
  // A fmt here holds a dropdown's options themselves (fmt.options, one array shared by its cells) and
  // check: true for a checkbox; the server keeps a dropdown as fmt.opt, the id of a list of the sheet.
  // Only in this page, never sent: _flt (the viewer's filter), _hid (the rows it hides), _fon.
  // colors: a dropdown's option colours (beside options); bd: the edges the cell draws, of "tblr".
  // A sheet also holds rules (its conditional formats) and merges (its merged ranges), as the server does.
  var FMT_KEYS = ["bold", "italic", "underline", "align", "num", "bg", "fg", "wrap", "options", "check", "colors", "bd"];
  var cfGen = 0, mgTok = 0;  // conditional formats are computed again when cfGen moves on; mgTok: one drawing of a pane (see renderQ)
  function noFmt() { var o = {}; FMT_KEYS.forEach(function (x) { o[x] = null; }); return o; }
  // The server's fmt (opt: a list id) as the page's (options: that list, colors: its colours), in place.
  function bindLists(fmt, lists, keys, colors) {
    (keys || Object.keys(fmt)).forEach(function (k) {
      var f = fmt[k];
      if (!f || f.opt == null) return;
      if (lists && lists[f.opt]) { f.options = lists[f.opt]; if (colors && colors[f.opt]) f.colors = colors[f.opt]; }
      delete f.opt;
      if (!Object.keys(f).length) delete fmt[k];
    });
    return fmt;
  }
  var live = !!(hm && hm.sheet && hm.sheet.edit) && !C.thumb && !!C.sheet;
  var book = [], cur = 0, hermesActive = false, edits = 0, preview = null;
  function normSheet(o) {
    if (o.lists && o.fmt) bindLists(o.fmt, o.lists, null, o.list_colors);
    return { id: o.id || "local-" + Math.random().toString(36).slice(2, 8), name: o.name || T.sheetWord + " 1", rev: o.rev || 0,
      rules: o.rules || [], merges: o.merges || [],
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
          for (var x in src) if (src[x] != null && x !== "border") f[x] = src[x];
        }
        if (sh.formats[rg].border) bdLocal(fmt, sh.formats[rg].border, R);
      });
      var merges = (sh.merges || []).filter(function (m) { var R = parseRange(m); if (R) eachIn(R, function (r, c, k) { if (r !== R.r1 || c !== R.c1) delete cells[k]; }); return !!R; });
      return normSheet({ id: "local-" + i, name: sh.name || T.sheetWord + " " + (i + 1), cells: cells, fmt: fmt, cols: sh.cols, freeze: sh.freeze, charts: sh.charts,
        rules: sh.rules, merges: merges });
    });
  }
  if (C.sheet && C.sheet.sheets && C.sheet.sheets.length) {
    book = C.sheet.sheets.map(normSheet);
    kit.hermesWork.seen(!!C.sheet.hermes_active, C.sheet.hermes_left, C.sheet.hermes_ago);
    hermesActive = kit.hermesWork.on();
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
  // The cells typed over on one sheet since the last recompute ({s, keys}): changed() then
  // recomputes only what follows from them. false: more than one sheet, recompute everything.
  var touched = null;
  function touch(s, k) {
    if (touched === null) touched = { s: s, keys: [] };
    if (touched && touched.s === s) touched.keys.push(k); else touched = false;
  }
  function invalidate() { touched = null; cfGen++; if (wb && wb.invalidate) { try { wb.invalidate(); } catch (e) { wb = makeWb(); } } else wb = makeWb(); }
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
  var ZM = 1, showFx = false;  // the view's zoom (RH, HH, HW and the column widths follow it) and "show formulas"
  var nRows = 50, nCols = 26, colX = [0], fr = 0, fc = 0, FW = 0, FH = 0, sl = 0, st = 0, vpW = 0, vpH = 0;
  var grid = document.getElementById("sh-grid");
  grid.setAttribute("aria-label", T.grid);
  var wrapEl = h("div", { "class": "sh-wrap" }), vp = h("div", { "class": "sh-vp" });
  wrapEl.appendChild(vp); grid.appendChild(wrapEl);
  var MODES = ["h", "f", "m"], Q = [], cellQ = [];
  MODES.forEach(function (ym) {
    MODES.forEach(function (xm) {
      var q = { xm: xm, ym: ym, el: h("div", { "class": "sh-q" }), inner: h("div", { "class": "sh-in" }), pool: [], rr: null, cc: null };
      q.el.appendChild(q.inner); vp.appendChild(q.el); Q.push(q);
      if (xm !== "h" && ym !== "h") {
        q.ov = { sel: h("div", { "class": "sh-sel", hidden: true }), act: h("div", { "class": "sh-active", hidden: true }),
          handle: h("div", { "class": "sh-handle", hidden: true }), fill: h("div", { "class": "sh-fillbox", hidden: true }),
          clip: h("div", { "class": "sh-clip", hidden: true }), refs: h("div"), charts: h("div"),
          dd: h("div", { "class": "sh-c dd sh-ddsel", hidden: true, html: '<span class="sh-pl pe"></span><i class="sh-dc"></i>' }) };
        q.layer = h("div", { style: "position:absolute;left:0;top:0" }, [q.ov.sel, q.ov.clip, q.ov.fill, q.ov.dd, q.ov.act, q.ov.handle, q.ov.refs, q.ov.charts]);
        q.inner.appendChild(q.layer);
        cellQ.push(q);
      }
      if (xm === "h" && ym === "h") { q.corner = h("div", { "class": "sh-corner", title: "Ctrl+A" }); q.inner.appendChild(q.corner); }
    });
  });
  var fzX = h("div", { "class": "sh-fz-x", hidden: true }), fzY = h("div", { "class": "sh-fz-y", hidden: true }), resizeLine = h("div", { "class": "sh-resize", hidden: true });
  vp.appendChild(fzX); vp.appendChild(fzY); vp.appendChild(resizeLine);

  function cw(s, c) { var w = s.cols[colName(c)]; return Math.round((w ? clamp(+w || DW, 24, 800) : DW) * ZM); }
  function colAt(x) {
    var lo = 0, hi = nCols - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (colX[mid] <= x) lo = mid; else hi = mid - 1; }
    return lo;
  }
  // Rows a filter hides take no place in the grid: the panes lay out the shown rows only. vis: place
  // (0-based, top to bottom) -> row; vix: row -> place (a hidden row: that of the next shown one);
  // both null without a filter, when a row's place is its number. nVis: how many places there are.
  var vis = null, vix = null, nVis = 50;
  function hid(s, r) { return !!(s._hid && s._hid[r]); }
  function isHid(r) { return hid(S(), r); }
  function buildVis() {
    var hd = S()._hid;
    if (!hd) { vis = vix = null; nVis = nRows; return; }
    vis = []; vix = new Int32Array(nRows + 1);
    for (var r = 0; r < nRows; r++) { vix[r] = vis.length; if (!hd[r]) vis.push(r); }
    vix[nRows] = nVis = vis.length;
  }
  function rowY(r) { return (vis ? (r >= nRows ? nVis + r - nRows : vix[r]) : r) * RH; }
  function rowOf(i) { return vis ? vis[clamp(i, 0, nVis - 1)] : i; }
  // The shown row nearest to r: itself, else the next one down, else up.
  function seen(r) {
    if (!isHid(r)) return r;
    var a = r;
    while (a < MAXR - 1 && isHid(a)) a++;
    if (!isHid(a)) return a;
    for (a = r; a > 0 && isHid(a);) a--;
    return a;
  }
  // d rows on from r, counting the shown rows only.
  function stepRow(r, d) {
    if (!S()._hid) return r + d;
    for (var n = Math.abs(d), step = d < 0 ? -1 : 1; n > 0; n--) {
      var x = r + step;
      while (x >= 0 && x < MAXR && isHid(x)) x += step;
      if (x < 0 || x >= MAXR) break;
      r = x;
    }
    return r;
  }
  // [first, last] of each run of shown rows in r1..r2.
  function visRuns(s, r1, r2) {
    if (!s._hid) return [[r1, r2]];
    var out = [], a = -1;
    for (var r = r1; r <= r2 + 1; r++) {
      var on = r <= r2 && !s._hid[r];
      if (on && a < 0) a = r;
      if (!on && a >= 0) { out.push([a, r - 1]); a = -1; }
    }
    return out;
  }
  function layout() {
    var s = S(), u = used(s);
    nRows = clamp(Math.max(nRows, 50, u.r + 30), 1, MAXR);
    nCols = clamp(Math.max(nCols, 26, u.c + 4), 1, MAXC);
    buildVis();
    colX = [0];
    for (var c = 0; c < nCols; c++) colX.push(colX[c] + cw(s, c));
    fr = clamp(s.freeze.rows || 0, 0, Math.min(nRows - 1, 50)); fc = clamp(s.freeze.cols || 0, 0, Math.min(nCols - 1, 20));
    FW = colX[fc]; FH = fr * RH;
    wrapEl.style.width = HW + colX[nCols] + "px"; wrapEl.style.height = HH + nVis * RH + "px";
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
  // The rows a pane shows, as places (see vis): the frozen rows are never hidden, so theirs are their numbers.
  function rowsFor(ym, pad) {
    if (ym === "h") return null;
    if (ym === "f") return fr ? [0, fr - 1] : null;
    var a = Math.floor((FH + st) / RH) - pad, b = Math.floor((FH + st + Math.max(0, vpH - HH - FH)) / RH) + pad;
    return [Math.max(fr, a), Math.min(nVis - 1, b)];
  }
  function within(have, want) { return !want || (have && want[0] >= have[0] && want[1] <= have[1]); }

  // ------------------------------------------------------------------ rendering (pooled cells, no per-cell listeners)
  var meas = document.createElement("canvas").getContext("2d"), measFont = "";
  function family() { return getComputedStyle(document.body).fontFamily || "sans-serif"; }
  // fam: the body's font family when the caller already has it (reading it restyles the page).
  function textW(t, bold, fam) {
    var f = (bold ? "600 " : "400 ") + "13px " + (fam || family());
    if (f !== measFont) { meas.font = f; measFont = f; }
    return meas.measureText(t).width;
  }
  var flashSet = {}, foundSet = null;
  // A pane's cells sit in slots by row and column modulo the window (q.H rows x q.W columns), so a
  // cell still in view after a scroll keeps its element, and an element is written only where its
  // class, style or text changed: restyling a cell costs far more than comparing strings.
  function slot(q, i) {
    var el = q.pool[i];
    if (!el) { el = q.pool[i] = document.createElement("div"); q.inner.insertBefore(el, q.layer || null); }
    return el;
  }
  // A box at x, y of w x hh with the extra declarations css; a move alone sets just what moved.
  function put(el, cls, x, y, w, hh, css, txt, html) {
    if (el._c !== cls) { el.className = cls; el._c = cls; }
    if (el._s !== css) {
      el.style.cssText = "left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + hh + "px;" + css;
      el._s = css; el._x = x; el._y = y; el._w = w; el._h = hh;
    } else {
      if (el._x !== x) { el.style.left = x + "px"; el._x = x; }
      if (el._y !== y) { el.style.top = y + "px"; el._y = y; }
      if (el._w !== w) { el.style.width = w + "px"; el._w = w; }
      if (el._h !== hh) { el.style.height = hh + "px"; el._h = hh; }
    }
    var tk = html == null ? txt : "\u0000" + html;  // html: a cell with parts (a pill, a button) instead of plain text
    if (el._t !== tk) { if (html == null) el.textContent = txt; else el.innerHTML = html; el._t = tk; }
  }
  function hide(el) { if (el && el._s !== null) { el.style.display = "none"; el._s = null; } }
  function hideAll(q) { for (var i in q.pool) hide(q.pool[i]); q.rowAt = []; }
  // Fits the slot grid to a window of nr rows and nc columns, starting over when it is too small.
  function fitSlots(q, nr, nc) {
    if (q.H >= nr && q.W >= nc) return;
    hideAll(q);
    q.H = Math.max(q.H || 0, nr + 4); q.W = Math.max(q.W || 0, nc + 2);
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
    var rr = rowsFor(q.ym, 10), cc = colsFor(q.xm, 3), R = selR(), whole = selMode, kept = !force && q.cc && cc && q.cc[0] === cc[0] && q.cc[1] === cc[1];
    q.rr = rr; q.cc = cc;
    if (q.xm === "h" && q.ym === "h") {
      q.corner.style.cssText = "width:" + HW + "px;height:" + HH + "px";
      return;
    }
    if (q.ym === "h" ? !cc : q.xm === "h" ? !rr : !(rr && cc)) return hideAll(q);
    if (q.ym === "h") {
      fitSlots(q, 1, cc[1] - cc[0] + 1);
      for (var c = cc[0]; c <= cc[1]; c++)
        put(slot(q, c % q.W), "sh-h col" + (c >= R.c1 && c <= R.c2 ? (whole === "cols" || whole === "all" ? " all" : " on") : "") + (s._fact && s._fact[c] ? " fl" : ""),
          colX[c], 0, colX[c + 1] - colX[c], HH, "", colName(c));
      for (c = cc[1] + 1; c < cc[0] + q.W; c++) hide(q.pool[c % q.W]);
    } else if (q.xm === "h") {
      fitSlots(q, rr[1] - rr[0] + 1, 1);
      // r, r2 below: a row's place in the pane; rw, rw2: its number (they differ while a filter hides rows)
      for (var r = rr[0]; r <= rr[1]; r++) {
        var rw = vis ? vis[r] : r;
        put(slot(q, r % q.H), "sh-h row" + (rw >= R.r1 && rw <= R.r2 ? (whole === "rows" || whole === "all" ? " all" : " on") : "") + (vis ? " fl" : ""),
          0, r * RH, HW, RH, "", String(rw + 1));
      }
      for (r = rr[1] + 1; r < rr[0] + q.H; r++) hide(q.pool[r % q.H]);
    } else {
      fitSlots(q, rr[1] - rr[0] + 1, cc[1] - cc[0] + 1);
      var H = q.H, W = q.W, j, c3, fam = null, u = used(s), hr = C.thumb || preview ? -1 : hdrRow(s), fa = s._fact || {};
      // vm: the merged cells in this window (each drawn once, over its whole area, by the first of its cells met: tok);
      // cfOn: the sheet has conditional formats; bdOn: some cell draws a border
      var vm = mgIn(s, rr, cc), tok = ++mgTok, cfOn = s.rules.length > 0, bdOn = hasBd(s);
      if (vm) kept = false;
      for (var r2 = rr[0]; r2 <= rr[1]; r2++) {
        var skip = -1, base = (r2 % H) * W, rw2 = vis ? vis[r2] : r2;
        // A row already drawn for these columns and these cells is still right.
        if (kept && q.rowAt[r2 % H] === rw2) continue;
        q.rowAt[r2 % H] = rw2;
        for (var c2 = cc[0]; c2 <= cc[1]; c2++) {
          var el2 = slot(q, base + c2 % W), mg = vm && mgHit(vm, rw2, c2);
          if (mg) { if (mg.tok === tok) { hide(el2); continue; } mg.tok = tok; }
          var k = mg ? key(mg.r1, mg.c1) : key(rw2, c2), f = s.fmt[k], v = valueOf(s, k), txt = display(s, k, v), kind = cellKind(v);
          var w = colX[c2 + 1] - colX[c2], css = "", cls = "sh-c", html = null;
          if (showFx && isFormula(s.cells[k])) { txt = String(s.cells[k]); kind = ""; }  // View > Show formulas
          if (rw2 === hr && c2 <= u.c && u.r > hr) {  // a header cell: the button of its filter
            html = kit.esc(txt) + '<i class="sh-fb' + (fa[c2] ? " on" : "") + '"></i>'; cls += fa[c2] ? " fh fa" : " fh";
          } else if (f && f.options) {  // a dropdown: its value as a pill when it is one of the options
            var oi = optIdx(f.options, v, txt);
            html = (oi >= 0 ? '<span class="sh-pl ' + pillCls(f, oi) + '">' + kit.esc(txt) + "</span>" : txt ? kit.esc(txt) : '<span class="sh-pl pe"></span>') + '<i class="sh-dc"></i>';
            cls += txt ? " dd" : " dd de"; kind = "";
          } else if (f && f.check && (v === null || typeof v === "boolean")) {  // a checkbox, drawn by the style sheet
            cls += v ? " ck on" : " ck"; kind = ""; txt = ""; html = "";
          }
          if (kind) cls += " " + kind;
          if (cfOn) f = cfMix(f, cfAt(s, mg ? mg.r1 : rw2, mg ? mg.c1 : c2, k));  // a rule's format over the cell's own
          if (mg) { w = colX[Math.min(mg.c2 + 1, nCols)] - colX[mg.c1]; cls += " mg"; if (!(f && f.wrap)) css += "line-height:" + (rowY(mg.r2 + 1) - rowY(mg.r1) - 1) + "px;"; }
          if (bdOn) css += bdCss(s, mg, rw2, c2);
          if (f) {
            if (f.bold) css += "font-weight:600;";
            if (f.italic) css += "font-style:italic;";
            if (f.underline || f.strike) css += "text-decoration:" + (f.underline ? "underline " : "") + (f.strike ? "line-through" : "") + ";";
            if (f.align === "left" || f.align === "center" || f.align === "right") css += "text-align:" + f.align + ";";
            if (f.bg && /^#[0-9a-f]{3,8}$/i.test(f.bg)) css += "background:" + f.bg + ";" + (f.fg || kind === "e" ? "" : "color:" + inkOn(f.bg) + ";");
            if (f.fg && /^#[0-9a-f]{3,8}$/i.test(f.fg) && kind !== "e") css += "color:" + f.fg + ";";
            if (f.wrap) cls += " wr";
          }
          // Text runs on over empty cells to its right, as in Excel.
          if (txt && !kind && html === null && !mg && !(f && (f.wrap || f.align && f.align !== "left")) && c2 > skip && txt.length * 6 * ZM > w - 10) {
            var tw = (textW(txt, f && f.bold, fam || (fam = family())) + 12) * ZM, w0 = w, cn = c2 + 1;
            while (w < tw && cn <= cc[1] && cn - c2 < 12 && empty(s, rw2, cn) && !(vm && mgHit(vm, rw2, cn))) { w += colX[cn + 1] - colX[cn]; cn++; }
            if (w > w0) { cls += " ov"; if (!(f && f.bg)) css += "background:var(--color-panel);"; skip = cn - 1; }
          }
          if (foundSet && foundSet[k]) cls += " fd";
          if (flashSet[k]) cls += " hf";
          if (mg) put(el2, cls, colX[mg.c1], rowY(mg.r1), w, rowY(mg.r2 + 1) - rowY(mg.r1), css, txt, html === "" ? null : html);
          else put(el2, cls, colX[c2], r2 * RH, w, RH, css, txt, html === "" ? null : html);
        }
        for (c3 = cc[1] + 1; c3 < cc[0] + W; c3++) hide(q.pool[base + c3 % W]);
      }
      for (r2 = rr[1] + 1; r2 < rr[0] + H; r2++) {
        j = r2 % H;
        if (q.rowAt[j] === -1) continue;
        q.rowAt[j] = -1;
        for (c3 = 0; c3 < W; c3++) hide(q.pool[j * W + c3]);
      }
    }
  }
  // Which option a dropdown cell holds (-1: none of them, shown as plain text).
  function optIdx(options, v, txt) { return v === null ? -1 : options.indexOf(typeof v === "string" ? v : typeof v === "number" ? String(v) : txt); }
  function renderAll(force) { Q.forEach(function (q) { renderQ(q, force); }); }
  function renderHeaders() { Q.forEach(function (q) { if (q.xm === "h" || q.ym === "h") renderQ(q, true); }); }
  function refresh() { layout(); renderAll(true); drawOverlay(); drawCharts(); updateFbar(); stats(); drawFlt(); uiSync(); }
  var rafPending = false;
  function onScroll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      sl = grid.scrollLeft; st = grid.scrollTop;
      var grow = false;
      if (st + vpH > HH + nVis * RH - 6 * RH && nRows < MAXR) { nRows = Math.min(MAXR, nRows + 100); grow = true; }
      if (sl + vpW > HW + colX[nCols] - 3 * DW && nCols < MAXC) { nCols = Math.min(MAXC, nCols + 10); grow = true; }
      if (grow) layout(); else translate();
      renderAll(grow);
      if (ed) placeEditor();
      closeAc();
    });
  }
  // A cell's box in viewport pixels.
  function cellBox(r, c) {
    var x = colX[c], y = rowY(r), w = colX[c + 1] - x;
    return { x: HW + (c < fc ? x : x - sl), y: HH + (r < fr ? y : y - st), w: w, h: RH };
  }
  function ensureVisible(r, c) {
    if (r >= nRows || c >= nCols) { nRows = clamp(Math.max(nRows, r + 20), 1, MAXR); nCols = clamp(Math.max(nCols, c + 4), 1, MAXC); layout(); }
    var mainW = vpW - HW - FW, mainH = vpH - HH - FH, ns = st, nl = sl;
    if (r >= fr) { var y = rowY(r); if (y < FH + st) ns = y - FH; else if (y + RH > FH + st + mainH) ns = y + RH - FH - mainH; }
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
  // More than one cell selected (one merged cell is one cell).
  function multi() {
    var R = selR(), m;
    if (R.r1 === R.r2 && R.c1 === R.c2) return false;
    return !(selMode === "cells" && (m = mergeAt(S(), sr, sc)) && m.r1 === R.r1 && m.c1 === R.c1 && m.r2 === R.r2 && m.c2 === R.c2);
  }
  function select(r, c, extend, mode) {
    r = seen(clamp(r, 0, MAXR - 1)); c = clamp(c, 0, MAXC - 1);
    if (extend) { er = r; ec = c; } else { sr = er = r; sc = ec = c; selMode = mode || "cells"; }
    if (mode) selMode = mode;
    if (selMode === "cells" || selMode === "rows") ensureVisible(er, selMode === "rows" ? Math.max(fc, colAt(FW + sl)) : ec);
    else if (selMode === "cols") ensureVisible(rowOf(Math.max(fr, Math.floor((FH + st) / RH))), ec);
    afterSel();
  }
  function setActive(r, c) { sr = r = seen(r); sc = c; ensureVisible(r, c); afterSel(); }
  function afterSel() { snapSel(); drawOverlay(); renderHeaders(); updateFbar(); stats(); announce(); sendView(); uiSync(); }
  function box(el, R, pad) {
    var x = colX[R.c1], y = rowY(R.r1), w = colX[R.c2 + 1] - x, hh = rowY(R.r2 + 1) - y;
    pad = pad || 0;
    el.style.left = x - pad + "px"; el.style.top = y - pad + "px"; el.style.width = w + 2 * pad + "px"; el.style.height = hh + 2 * pad + "px";
    el.hidden = false;
  }
  var fillPrev = null, edRefs = [];
  function drawOverlay() {
    var R = selR(), s = S(), A = mergeAt(s, sr, sc) || { r1: sr, c1: sc, r2: sr, c2: sc }, fa = s.fmt[key(sr, sc)];
    // an empty dropdown cell shows what it is while it is the active one (the others on hover)
    var ddHere = !ro() && !ed && !!(fa && fa.options) && empty(s, sr, sc) && sr !== hdrRow(s);
    cellQ.forEach(function (q) {
      var o = q.ov;
      if (multi()) box(o.sel, R, 0); else o.sel.hidden = true;
      box(o.act, A, 1);
      if (ddHere) box(o.dd, A, 0); else o.dd.hidden = true;
      if (!ro() && !ed && selMode !== "all") {
        o.handle.hidden = false;
        o.handle.style.left = colX[Math.min(R.c2 + 1, nCols)] - 4 + "px"; o.handle.style.top = rowY(R.r2 + 1) - 4 + "px";
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
    var b = mBox(ed.r, ed.c), lines = edTa.value.split("\n");
    var w = b.w, hh = b.h;
    if (edWrap.classList.contains("wr")) { edWrap.style.width = w + 1 + "px"; hh = Math.max(RH, edTa.scrollHeight); }
    else {
      var tw = 0;
      lines.forEach(function (ln) { tw = Math.max(tw, (textW(ln) + 18) * ZM); });
      w = Math.max(b.w, Math.min(tw, vpW - b.x - 6));
      hh = Math.max(b.h, lines.length * (RH - 1) + 1);
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
        for (var c = R.c1; c <= R.c2; c++) row.push(hid(s, r) ? null : isFormula(p.value) ? shift(p.value, r - e.r, c - e.c) : p.value);
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
    var t = stepOut(sr, sc, dr, dc);  // past the merged cell the active cell is
    if (!multi() || selMode !== "cells") return select(t[0], t[1], false);
    var R = selR(), r = t[0], c = t[1];
    if (dc) { if (c > R.c2) { c = R.c1; r++; } else if (c < R.c1) { c = R.c2; r--; } if (r > R.r2) r = R.r1; else if (r < R.r1) r = R.r2; }
    if (dr) { if (r > R.r2) { r = R.r1; c++; } else if (r < R.r1) { r = R.r2; c--; } if (c > R.c2) c = R.c1; else if (c < R.c1) c = R.c2; }
    setActive(r, c);
  }

  // ------------------------------------------------------------------ mouse: select, drag, headers, column widths, point mode
  function hit(cx, cy) {
    var b = vp.getBoundingClientRect(), x = cx - b.left, y = cy - b.top, r, c;
    if (x < HW) c = -1; else { var sx = x - HW < FW ? x - HW : x - HW + sl; c = colAt(Math.max(0, sx)); }
    if (y < HH) r = -1; else { var sy = y - HH < FH ? y - HH : y - HH + st; r = rowOf(clamp(Math.floor(Math.max(0, sy) / RH), 0, nVis - 1)); }
    var m = r >= 0 && c >= 0 ? mergeAt(S(), r, c) : null;  // anywhere in a merged cell: its top-left cell
    if (m) { r = m.r1; c = m.c1; }
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
    if (d.kind === "resize") { resizeLine.hidden = true; if (d.w) setColWidth(S(), d.col, Math.round(d.w / ZM)); }
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
    if (!e.shiftKey && !C.thumb) {
      // a header's filter button, a dropdown's pill or caret, a checkbox's box: these act, the rest of the cell selects
      var s = S(), cb = mBox(p.r, p.c), f = s.fmt[key(p.r, p.c)], tc = e.target.classList;
      if (tc.contains("sh-fb")) { select(p.r, p.c, false); return openFilter(p.c); }
      if (!ro() && p.r !== hdrRow(s)) {
        if (f && f.options && (tc.contains("sh-pl") || p.x >= cb.x + cb.w - 20)) { select(p.r, p.c, false); return openDd(p.r, p.c); }
        if (checkable(s, p.r, p.c) && Math.abs(p.x - cb.x - cb.w / 2) <= 10) { select(p.r, p.c, false); return toggleChecks({ r1: p.r, c1: p.c, r2: p.r, c2: p.c }); }
      }
    }
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
    if (pop || p.r >= 0 && p.c >= 0 && checkable(S(), p.r, p.c)) return;  // a list just opened, a checkbox ticked twice
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
    // Alt+Down opens what the cell offers: a header's filter, a dropdown's list (Enter opens that too).
    if (k === "ArrowDown" && e.altKey || k === "Enter" && !e.shiftKey && !mod && !ro() && isDd(S(), sr, sc)) {
      e.preventDefault();
      if (sr === hdrRow(S())) return k === "Enter" ? moveInSel(1, 0) : openFilter(sc);
      return openDd(sr, sc);
    }
    if (arrows) {
      e.preventDefault();
      if (selMode !== "cells" && e.shiftKey) selMode = "cells";
      var r0 = e.shiftKey ? er : sr, c0 = e.shiftKey ? ec : sc;
      if (e.shiftKey && !multi()) { if (arrows[0] < 0) r0 = sr; if (arrows[1] < 0) c0 = sc; }  // one merged cell: grown from the side the arrow points to
      var t = mod ? jump(r0, c0, arrows[0], arrows[1]) : e.shiftKey ? [stepRow(r0, arrows[0]), c0 + arrows[1]] : stepOut(r0, c0, arrows[0], arrows[1]);
      return select(t[0], t[1], e.shiftKey, e.shiftKey ? null : "cells");
    }
    if (k === "Tab") { e.preventDefault(); return moveInSel(0, e.shiftKey ? -1 : 1); }
    if (k === "Enter") { e.preventDefault(); return moveInSel(e.shiftKey ? -1 : 1, 0); }
    if (k === " " && !mod && !e.altKey && !ro() && checkable(S(), sr, sc)) { e.preventDefault(); return toggleChecks(selR()); }
    if (k === "Home") { e.preventDefault(); return select(mod ? 0 : (e.shiftKey ? er : sr), 0, e.shiftKey); }
    if (k === "End") { e.preventDefault(); var u = used(S()); return select(mod ? Math.max(0, u.r) : (e.shiftKey ? er : sr), Math.max(0, u.c), e.shiftKey); }
    if (k === "PageDown" || k === "PageUp") {
      e.preventDefault();
      var n = Math.max(1, Math.floor((vpH - HH - FH) / RH) - 1) * (k === "PageDown" ? 1 : -1);
      grid.scrollTop += n * RH;
      return select(stepRow(e.shiftKey ? er : sr, n), e.shiftKey ? ec : sc, e.shiftKey);
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
      if (lk === "h") { e.preventDefault(); return openFind(true); }
      if (k === "`" || e.code === "Backquote") { e.preventDefault(); return toggleFx(); }
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
  // The used extent after one cell was filled or emptied: grown in place, recounted only when an
  // edge cell emptied (recounting reads every key of the sheet).
  function usedAfter(s, r, c, filled) {
    var u = s._used;
    if (!u) return;
    if (filled) { if (r > u.r || c > u.c) s._used = { r: Math.max(u.r, r), c: Math.max(u.c, c) }; }
    else if (r >= u.r || c >= u.c) s._used = null;
  }
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
            if (v !== "" && covered(s, p.r + i, p.c + j)) return;  // inside a merged cell: only its top-left cell holds content
            if (v === "") delete s.cells[k]; else s.cells[k] = v;
            delete s.vals[k]; touch(s, k); usedAfter(s, p.r + i, p.c + j, v !== "");
          });
        });
        break;
      case "clear":
        R = parseRange(op.range);
        if (R) for (var k in s.cells) { p = parseKey(k); if (p && inR(R, p.r, p.c)) { delete s.cells[k]; delete s.vals[k]; touch(s, k); usedAfter(s, p.r, p.c, false); } }
        break;
      case "format":
        R = parseRange(op.range);
        if (!R) break;
        R.r2 = Math.min(R.r2, MAXR - 1); R.c2 = Math.min(R.c2, MAXC - 1);
        eachIn(R, function (r, c, k) {
          var f = s.fmt[k] || {};
          FMT_KEYS.forEach(function (x) {
            if (!(x in op) || x === "colors" && !("options" in op) && !f.options) return;  // colours alone: for the dropdowns there
            if (op[x] === null || op[x] === false || op[x] === undefined || op[x] === "") delete f[x]; else f[x] = op[x];
          });
          if (Object.keys(f).length) s.fmt[k] = f; else delete s.fmt[k];
        });
        if ("border" in op) bdLocal(s.fmt, op.border || "none", R);
        if ("border" in op || "bd" in op) s._bd = undefined;
        break;
      case "merge": R = parseRange(op.range); if (R) mgApply(s, R); break;
      case "unmerge": R = parseRange(op.range); if (R) s.merges = s.merges.filter(function (m) { var b = parseRange(m); return !b || b.r2 < R.r1 || b.r1 > R.r2 || b.c2 < R.c1 || b.c1 > R.c2; }); break;
      case "rules": s.rules = op.rules || []; s._cf = null; break;
      case "col_width": s.cols[op.col] = op.w; break;
      case "freeze": s.freeze = { rows: op.rows || 0, cols: op.cols || 0 }; break;
    }
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
    if (r.fmt) { t.fmt = bindLists(r.fmt, r.lists, null, r.list_colors); t._bd = undefined; }
    if (r.rules) { t.rules = r.rules; t._cf = null; }
    if (r.merges) t.merges = r.merges;
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
      if (typeof r.hermes_active === "boolean") setHermes(r.hermes_active, r.hermes_left, r.hermes_ago);
      if (typeof r.edits === "number") edits = r.edits;
      invalidate();
      refit(t);
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
  function changed(s) {
    var t = touched === null ? { s: s, keys: [] } : touched;  // formats and widths change no value
    cfGen++;
    if (t && t.s === s && wb && wb.invalidateCells) { touched = null; try { wb.invalidateCells(s.name, t.keys); } catch (e) { invalidate(); } }
    else invalidate();
    if (s === S()) refresh();
    scheduleVals(); sendView();
  }
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
      if (hid(s, r)) continue;
      var row = [];
      for (var c = R.c1; c <= R.c2; c++) { var k = key(r, c); row.push(tsvCell(display(s, k, valueOf(s, k)))); }
      lines.push(row.join("\t"));
    }
    return lines.join("\n");
  }
  function htmlOf(s, R) {
    var out = "<table>";
    for (var r = R.r1; r <= R.r2; r++) {
      if (hid(s, r)) continue;
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
    var raw = [], fm = [], rws = [];
    for (var r = R.r1; r <= R.r2; r++) {
      if (hid(s, r)) continue;  // the rows a filter hides are not copied
      var a = [], b = [];
      for (var c = R.c1; c <= R.c2; c++) { var k = key(r, c); a.push(oldRaw(s, r, c)); b.push(s.fmt[k] ? JSON.parse(JSON.stringify(s.fmt[k])) : null); }
      raw.push(a); fm.push(b); rws.push(r);
    }
    if (!raw.length) return;
    // rows: where each copied row came from, when hidden rows were left out (then a cut is a copy: it would empty those too)
    var gaps = rws.length < R.r2 - R.r1 + 1;
    clip = { id: s.id, R: R, raw: raw, fmt: fm, rows: gaps ? rws : null, text: normText(text), cut: !!cut && !ro() && !gaps };
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
        return [].map.call(tr.querySelectorAll("td,th"), function (td) { return (td.innerText || td.textContent || "").replace(/\u00a0/g, " ").trim(); });
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
    var s = S(), src = byId(clip.id), R = selR(), cR = clip.R, h0 = clip.raw.length, w0 = cR.c2 - cR.c1 + 1, th = h0, tw = w0;
    if (multi() && selMode === "cells" && (R.r2 - R.r1 + 1) % h0 === 0 && (R.c2 - R.c1 + 1) % w0 === 0) { th = R.r2 - R.r1 + 1; tw = R.c2 - R.c1 + 1; }
    var r0 = R.r1, c0 = R.c1;
    if (!growTo(r0 + th - 1, c0 + tw - 1)) return;
    var D = { r1: r0, c1: c0, r2: r0 + th - 1, c2: c0 + tw - 1 }, vals = [], fops = [], anyFmt = false;
    for (var i = 0; i < th; i++) {
      var row = [];
      for (var j = 0; j < tw; j++) {
        var v = clip.raw[i % h0][j % w0], f = clip.fmt[i % h0][j % w0], k = key(r0 + i, c0 + j);
        if (isFormula(v) && !clip.cut) v = shift(v, r0 + i - (clip.rows ? clip.rows[i % h0] : cR.r1 + i % h0), c0 + j - (cR.c1 + j % w0));
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
      var sOld = oldMatrix(src, cR), sFmt = invFmt(src, cR, FMT_KEYS), clr = [{ op: "clear", range: rangeName(cR) }, fmtOp(cR, noFmt())];
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
        if (inR(R, r, c) || hid(s, r)) { row.push(null); continue; }  // the rows a filter hides stay as they are
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
    if (!Object.keys(s.cells).some(function (k) { var p = parseKey(k); return p && inR(R, p.r, p.c) && !hid(s, p.r); })) return;
    if (!s._hid) return doEdit(s, [{ op: "clear", range: rangeName(R) }], old ? [{ op: "set", range: key(U.r1, U.c1), values: old }] : null);
    // under a filter: the shown rows only, run by run
    var fwd = [], inv = [];
    visRuns(s, U.r1, U.r2).forEach(function (x) {
      var P = { r1: x[0], c1: U.c1, r2: x[1], c2: U.c2 }, was = oldMatrix(s, P);
      fwd.push({ op: "clear", range: rangeName({ r1: x[0], c1: R.c1, r2: x[1], c2: R.c2 }) });
      if (was && inv) inv.push({ op: "set", range: key(P.r1, P.c1), values: was }); else inv = null;
    });
    doEdit(s, fwd, inv);
  }
  function clearFormats() { fmtSel(noFmt()); }

  // ------------------------------------------------------------------ dropdown and checkbox cells
  function isDd(s, r, c) { var f = s.fmt[key(r, c)]; return !!(f && f.options); }
  // A cell a click or Space ticks: in a checkbox range, holding true, false or nothing (not a formula).
  function checkable(s, r, c) {
    var k = key(r, c), f = s.fmt[k], raw = s.cells[k];
    return !!(f && f.check) && (raw === undefined || raw === null || raw === "" || typeof raw === "boolean");
  }
  // Every checkbox of R takes the opposite of the active cell's state (an empty one becomes true first).
  function toggleChecks(R) {
    if (ro()) return;
    var s = S(), to = s.cells[key(sr, sc)] !== true, rows = [], last = -1;
    R = { r1: R.r1, c1: R.c1, r2: Math.min(R.r2, used(s).r + 200, MAXR - 1), c2: Math.min(R.c2, MAXC - 1) };
    for (var r = R.r1; r <= R.r2; r++) {
      var row = [];
      for (var c = R.c1; c <= R.c2; c++) {
        var ok = checkable(s, r, c) && !hid(s, r) && s.cells[key(r, c)] !== to;
        row.push(ok ? to : null);
        if (ok) last = r;
      }
      rows.push(row);
    }
    if (last >= 0) setBlock(s, R.r1, R.c1, rows.slice(0, last - R.r1 + 1));
  }
  function openDd(r, c) {
    var s = S(), k = key(r, c), f = s.fmt[k];
    if (!f || !f.options || ro()) return;
    commitIfEditing();
    var opts = f.options, v = valueOf(s, k), now = optIdx(opts, v, display(s, k, v)), on = Math.max(0, now);
    var list = h("div", { "class": "sh-pop sh-ddl", role: "listbox", tabindex: "-1", "aria-label": T.dropdown });
    opts.forEach(function (o, i) {
      list.appendChild(h("div", { role: "option", "data-i": i, "aria-selected": i === now ? "true" : "false" }, [h("span", { "class": "sh-pl " + pillCls(f, i), text: o }),
        h("button", { type: "button", "class": "sh-ddm", "data-m": i, title: T.ddOpt, "aria-label": T.ddOpt + ": " + o, tabindex: "-1", text: "⋯" })]));
    });
    list.appendChild(h("div", { "class": "sh-ddsep" }));
    list.appendChild(h("div", { role: "option", "data-i": opts.length, text: T.ddNone }));
    list.appendChild(h("div", { role: "option", "data-i": opts.length + 1, text: T.ddEdit }));
    list.appendChild(h("div", { role: "option", "data-i": opts.length + 2, text: "+ " + T.ddAdd }));
    list.appendChild(h("div", { role: "option", "data-i": opts.length + 3, text: T.ddPresets }));
    var items = list.querySelectorAll("[data-i]");
    function mark(i) {
      on = (i + items.length) % items.length;
      [].forEach.call(items, function (n, j) { n.classList.toggle("on", j === on); if (j === on) { n.scrollIntoView({ block: "nearest" }); list.setAttribute("aria-activedescendant", n.id); } });
    }
    [].forEach.call(items, function (n, j) { n.id = "sh-ddo" + j; });
    function pick(i) {
      if (i === opts.length + 2) return ddOptView(list, s, f, -1);     // a new option
      if (i === opts.length + 3) return ddPresetView(list, function (p) { ddChange(s, f, p.options.slice(), p.colors.slice()); });
      closePop(); grid.focus();
      if (i > opts.length) return dropdownDlg();
      // a number among the options is written as a number, so sums and sorts see it as one
      var o = i < opts.length ? opts[i] : "", val = o !== "" && String(Number(o)) === o ? Number(o) : o;
      if (!same(s.cells[k], val) || typeof s.cells[k] !== typeof val && val !== "") setBlock(s, r, c, [[val]]);
    }
    list.addEventListener("mousedown", function (e) { e.preventDefault(); });
    list.addEventListener("mousedown", function (e) { if (e.target.closest("input")) e.stopPropagation(); }, true);  // a view's own input takes the click
    list.addEventListener("click", function (e) {
      var m = e.target.closest("[data-m]"), o = e.target.closest("[data-i]");
      if (m) ddOptView(list, s, f, +m.getAttribute("data-m")); else if (o) pick(+o.getAttribute("data-i"));
    });
    list.addEventListener("keydown", function (e) {
      var kk = e.key;
      if (e.target !== list) return;  // an option's own view (ddOptView) has its keys
      if (kk === "ArrowDown") { e.preventDefault(); mark(on + 1); }
      else if (kk === "ArrowUp") { e.preventDefault(); mark(on - 1); }
      else if (kk === "Home") { e.preventDefault(); mark(0); }
      else if (kk === "End") { e.preventDefault(); mark(items.length - 1); }
      else if (kk === "Enter" || kk === " ") { e.preventDefault(); pick(on); }
      else if (kk === "Tab") { e.preventDefault(); closePop(); grid.focus(); }
      else if (kk.length === 1 && !e.ctrlKey && !e.metaKey) {  // a letter: the next option that starts with it
        for (var n = 1; n <= opts.length; n++) { var j = (on + n) % opts.length; if (opts[j].charAt(0).toLowerCase() === kk.toLowerCase()) { mark(j); break; } }
      }
    });
    openPop(list, null);
    var b = mBox(r, c), vr = vp.getBoundingClientRect(), top = vr.top + b.y + b.h + 2;
    list.style.minWidth = Math.min(b.w, 320) + "px";
    list.style.left = Math.max(8, Math.min(vr.left + b.x, innerWidth - list.offsetWidth - 8)) + "px";
    list.style.top = (top + list.offsetHeight > innerHeight - 8 ? Math.max(8, vr.top + b.y - list.offsetHeight - 2) : top) + "px";
    mark(on);
    list.focus();
  }
  // Make the selection a dropdown, or change or remove the one it is: its options, one per line.
  function dropdownDlg() {
    commitIfEditing();
    if (ro()) return;
    var s = S(), U = selUsed(), had = curFmt().options, hadCols = curFmt().colors || [], start = had ? had.slice() : [];
    if (!had && area(U) <= 5000) eachIn(U, function (r, c, k) {  // the texts already there are the first guess
      var v = valueOf(s, k), t = typeof v === "string" && !isDate(v) ? v.trim() : "";
      if (t && t.length <= 60 && start.length < 20 && start.indexOf(t) < 0 && r !== hdrRow(s)) start.push(t);
    });
    var ta = h("textarea", { "class": "sh-q-in", "aria-label": T.ddTitle, rows: 7 });
    ta.value = start.join("\n");
    var ok = h("button", { type: "button", "class": "sh-b pri", text: T.ok }), no = h("button", { type: "button", "class": "sh-b", text: T.cancel });
    var rm = had ? h("button", { type: "button", "class": "sh-b sh-left", text: T.ddRemove }) : null;
    // ready-made lists with their colours: one click makes the selection that dropdown
    var presets = h("div", { "class": "sh-chips" }, DD_PRESETS.map(function (p) {
      return h("button", { type: "button", "class": "sh-chip", text: p.name, title: p.options.join(" · "), onclick: function () { done(p.options.slice(), p.colors.slice()); } });
    }));
    var el = h("div", { "class": "sh-pop sh-dlg", role: "dialog", "aria-label": T.dropdown }, [h("div", { "class": "sh-dlg-q", text: T.ddTitle }), presets, ta, h("div", { "class": "sh-dlg-bar" }, [rm, no, ok])]);
    function done(options, colors) { closePop(); grid.focus(); if (options !== undefined) fmtSel({ options: options, colors: options && colors && colors.some(Boolean) ? colors : null }); }
    ok.addEventListener("click", function () {
      var out = [];
      ta.value.split("\n").forEach(function (t) { t = t.trim().slice(0, 60); if (t && out.indexOf(t) < 0 && out.length < 50) out.push(t); });
      // an option keeps the colour it had
      done(out.length ? out : had ? null : undefined, out.map(function (o) { var i = had ? had.indexOf(o) : -1; return i >= 0 && hadCols[i] || null; }));
    });
    no.addEventListener("click", function () { done(); });
    if (rm) rm.addEventListener("click", function () { done(null); });
    ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok.click(); } });
    openPop(el, null);
    ta.focus();
  }

  // ------------------------------------------------------------------ filter: rows hidden in this viewer's page only (nothing is stored or sent)
  // s._flt: {column key: {vals: {shown value: 1} | null, conds: [{op, val}]}}: a row shows when, in every
  // filtered column, its value is ticked (vals; null: all are) and meets every condition (PURE.test).
  // s._hid: the rows that hides (Uint8Array by row number, or null); s._fact: {column: 1} for the header
  // buttons; s._fn: the counts. The header row: the last frozen row, else row 1 once Filter was asked
  // for (s._fon); -1: none.
  function hdrRow(s) { return s.freeze.rows >= 1 ? Math.min(s.freeze.rows, 50) - 1 : s._fon ? 0 : -1; }
  function shown(s, r, c) { var k = key(r, c); return display(s, k, valueOf(s, k)); }
  // The last row and column holding a value (used() also counts the charts).
  function dataEnd(s) {
    var mr = -1, mc = -1;
    for (var k in s.cells) { var p = parseKey(k); if (p) { if (p.r > mr) mr = p.r; if (p.c > mc) mc = p.c; } }
    return { r: mr, c: mc };
  }
  // {column key: column}: a column is known by its header's text, so its filter follows it through a
  // sort or an inserted column; by its place when the header is empty or used twice.
  function fltCols(s, hr, end) {
    var n = Object.create(null), out = Object.create(null), c;
    for (c = 0; c <= end.c; c++) { var t = shown(s, hr, c); n[t] = (n[t] || 0) + 1; }
    for (c = 0; c <= end.c; c++) { t = shown(s, hr, c); out[t && n[t] === 1 ? "t" + t : "#" + c] = c; }
    return out;
  }
  // A column's filter as a test of a row; null when it lets every row through.
  function colTest(s, c, f, hr, end) {
    var conds = (f.conds || []).filter(PURE.active).map(PURE.prep), vals = f.vals, dup = null;
    if (!vals && !conds.length) return null;
    if (conds.some(function (p) { return p.op === "dup"; })) {
      dup = Object.create(null);
      for (var r0 = hr + 1; r0 <= end.r; r0++) { var t0 = shown(s, r0, c); if (t0) dup[t0] = (dup[t0] || 0) + 1; }
    }
    return function (r) {
      var k = key(r, c), v = valueOf(s, k), t = display(s, k, v);
      if (vals && !vals[t]) return false;
      for (var i = 0; i < conds.length; i++) if (!PURE.test(conds[i], { t: t, v: v, dup: !!dup && dup[t] > 1 })) return false;
      return true;
    };
  }
  function refilter(s) {
    var f = s._flt, hr = hdrRow(s), end = dataEnd(s), tests = [], n = 0, k;
    s._hid = null; s._fact = null; s._fn = null;
    if (!f || hr < 0) { s._flt = null; return; }
    var cols = fltCols(s, hr, end), fa = {};
    for (k in f) {
      if (cols[k] === undefined) { delete f[k]; continue; }
      var t = colTest(s, cols[k], f[k], hr, end);
      if (t) { tests.push(t); fa[cols[k]] = 1; }
      else if (!(f[k].conds || []).length) delete f[k];  // a condition still being typed stays for the popover
    }
    if (!Object.keys(f).length) { s._flt = null; return; }
    if (!tests.length) return;
    var hd = new Uint8Array(MAXR);
    for (var r = hr + 1; r <= end.r; r++)
      for (var i = 0; i < tests.length; i++) if (!tests[i](r)) { hd[r] = 1; n++; break; }
    if (n) s._hid = hd;
    s._fact = fa; s._fn = { n: end.r - hr - n, m: end.r - hr };
  }
  // The filter again over what the sheet holds now (after it was read anew); the selection leaves hidden rows.
  function refit(s) {
    if (!s._flt) return;
    refilter(s);
    if (s === S()) { sr = seen(sr); er = seen(er); }
  }
  function applyFilter(s) {
    refilter(s);
    if (s !== S()) return;
    sr = seen(sr); er = seen(er);
    refresh(); afterSel();
  }
  function clearFilter() { var s = S(); if (!s._flt) return; s._flt = null; applyFilter(s); grid.focus(); }
  // The bar over the grid while a filter is on: a chip per condition (x takes it off), + for another
  // column, how many rows show, and that all this is the viewer's own.
  var fltBar = h("div", { "class": "sh-fltbar", hidden: true, role: "group", "aria-label": T.filter });
  var fltChips = h("div", { "class": "sh-chips" }), fltText = h("span", { "class": "sh-fltn", "aria-live": "polite" }), fltSig = "";
  var fltAdd = h("button", { type: "button", "class": "sh-chip-add", title: T.fltAddCol, "aria-label": T.fltAddCol, text: "+" });
  fltAdd.addEventListener("click", function () {
    var s = S(), hr = hdrRow(s), end = dataEnd(s), items = [];
    if (hr < 0) return;
    for (var c = 0; c <= Math.min(end.c, 59); c++) (function (c) { items.push({ label: shown(s, hr, c) || colName(c), onClick: function () { openFilter(c); } }); })(c);
    kit.menu(fltAdd, items);
  });
  fltBar.append(fltChips, fltAdd, fltText, h("span", { "class": "sh-flt-you", text: T.fltYou }),
    h("button", { type: "button", "class": "sh-b", text: T.fltClearAll, onclick: clearFilter }));
  grid.parentNode.insertBefore(fltBar, grid);
  function lcFirst(t) { return t.charAt(0).toLowerCase() + t.slice(1); }
  // The filter as chips: [{c: column, ck: its key, i: which condition (-1: the ticked values), text}]
  function fltChipList(s) {
    var hr = hdrRow(s), out = [];
    if (!s._flt || hr < 0) return out;
    var cols = fltCols(s, hr, dataEnd(s));
    Object.keys(s._flt).forEach(function (ck) {
      var c = cols[ck], f = s._flt[ck];
      if (c === undefined) return;
      var name = shown(s, hr, c) || colName(c);
      (f.conds || []).forEach(function (cd, i) {
        if (PURE.active(cd)) out.push({ c: c, ck: ck, i: i, text: fill(T.fltChip, { c: name, o: lcFirst(T["fo_" + cd.op] || cd.op), v: PURE.needsVal(cd.op) ? cd.val : "" }).trim() });
      });
      if (f.vals) {
        var ks = Object.keys(f.vals);
        out.push({ c: c, ck: ck, i: -1, text: ks.length && ks.length <= 2 ? fill(T.fltChip, { c: name, o: lcFirst(T.fo_is), v: ks.map(function (v) { return v || T.fltBlank; }).join(", ") })
          : fill(T.fltChipVals, { c: name, n: ks.length }) });
      }
    });
    return out;
  }
  function dropChip(ck, i) {
    var s = S(), f = s._flt && s._flt[ck];
    if (!f) return;
    if (i < 0) f.vals = null; else f.conds.splice(i, 1);
    if (!f.vals && !f.conds.length) delete s._flt[ck];
    if (!Object.keys(s._flt).length) s._flt = null;
    applyFilter(s);
    if (fltBar.hidden) grid.focus(); else fltAdd.focus();
  }
  function drawFlt() {
    var s = S(), on = !!(s._flt && s._fn) && !C.thumb, chips = on ? fltChipList(s) : [], t = on ? fill(T.fltRows, s._fn) : "";
    var sig = on ? s.id + "\u0001" + chips.map(function (x) { return x.ck + "\u0002" + x.i + "\u0002" + x.text; }).join("\u0001") : "";
    if (fltText.textContent !== t) fltText.textContent = t;
    if (sig !== fltSig) {
      fltSig = sig;
      fltChips.innerHTML = "";
      chips.forEach(function (x) {
        var open = h("button", { type: "button", "class": "sh-chip-t", text: x.text, title: x.text, onclick: function () { openFilter(x.c); } });
        var del = h("button", { type: "button", "class": "sh-chip-x", title: T.fltDrop, "aria-label": T.fltDrop + ": " + x.text, text: "×", onclick: function () { dropChip(x.ck, x.i); } });
        fltChips.appendChild(h("span", { "class": "sh-chip" }, [open, del]));
      });
    }
    if (fltBar.hidden === on) fltBar.hidden = !on;
  }
  function sortCol(c, desc) {
    var s = S(), hr = hdrRow(s), end = dataEnd(s);
    if (ro() || hr < 0 || end.r <= hr + 1) return;
    structural([{ op: "sort", range: rangeName({ r1: hr + 1, c1: 0, r2: end.r, c2: end.c }), col: colName(c), desc: !!desc }]);
  }
  // Start filtering at the active cell's column (row 1 becomes the header when no row is frozen).
  function filterHere() {
    commitIfEditing();
    var s = S();
    if (preview) return;
    if (hdrRow(s) < 0) { s._fon = true; refresh(); }
    openFilter(clamp(sc, 0, Math.max(0, dataEnd(s).c)));
  }
  var FLT_OPS = { text: ["has", "hasnt", "is", "isnt", "starts", "ends", "blank", "nblank", "dup", "err"],
    num: ["gt", "ge", "lt", "le", "is", "isnt", "blank", "nblank", "dup", "err", "has", "hasnt", "starts", "ends"],
    date: ["after", "before", "is", "isnt", "blank", "nblank", "dup", "err"],
    dd: ["is", "isnt", "blank", "nblank", "has", "hasnt", "starts", "ends", "dup", "err"],
    check: ["true", "false"] };
  // A column's popover: sort it (for everyone), and filter it (for this viewer): conditions, quick
  // picks, and the values to tick. Every change shows at once.
  function openFilter(c) {
    commitIfEditing();
    var s = S(), hr = hdrRow(s), end = dataEnd(s);
    if (hr < 0 || preview || end.r <= hr || c > end.c) return;
    var cols = fltCols(s, hr, end), ck = null, k, others = [];
    for (k in cols) if (cols[k] === c) ck = k;
    for (k in s._flt || {}) if (k !== ck && cols[k] !== undefined) { var ot = colTest(s, cols[k], s._flt[k], hr, end); if (ot) others.push(ot); }
    // the column's values in the rows the other columns' filters let through (blanks last), and what kind it is
    var count = Object.create(null), vals = [], nNum = 0, nDate = 0, nAny = 0, nTrue = 0, passN = 0, opts = null, isCheck = false;
    for (var r = hr + 1; r <= end.r; r++) {
      var k2 = key(r, c), fm = s.fmt[k2], pass = true;
      if (fm && fm.options && !opts) opts = fm.options;
      if (fm && fm.check) isCheck = true;
      var v = valueOf(s, k2), d = display(s, k2, v);
      if (d && !isErr(v)) { nAny++; if (typeof v === "number") nNum++; else if (isDate(v)) nDate++; }  // the kind: from every row
      for (var i = 0; i < others.length && pass; i++) pass = others[i](r);
      if (!pass) continue;
      if (!count[d]) { count[d] = 0; vals.push(d); }
      count[d]++; passN++;
      if (v === true) nTrue++;
    }
    var kind = isCheck ? "check" : opts ? "dd" : nAny && nDate * 2 > nAny ? "date" : nAny && nNum * 2 > nAny ? "num" : "text";
    var coll = new Intl.Collator(L, { numeric: true, sensitivity: "base" });
    vals.sort(function (a, b) { return a === "" ? 1 : b === "" ? -1 : coll.compare(a, b); });
    var had = s._flt && s._flt[ck], sel = Object.create(null), conds = had ? (had.conds || []).map(function (x) { return { op: x.op, val: x.val }; }) : [];
    vals.forEach(function (x) { if (!had || !had.vals || had.vals[x]) sel[x] = 1; });
    var search = h("input", { type: "search", placeholder: T.fltSearch, "aria-label": T.fltSearch });
    var all = h("input", { type: "checkbox" }), listEl = h("div", { "class": "sh-flt-list" });
    var clr = h("button", { type: "button", "class": "sh-b", text: T.fltClear });
    var condsEl = h("div", { "class": "sh-flt-conds" }), valsHead = h("div", { "class": "sh-flt-h" });
    var addBtn = h("button", { type: "button", "class": "sh-flt-add", text: "+ " + T.fltAddCond });
    var name = shown(s, hr, c) || colName(c), dlId = "sh-flt-dl";
    var el = h("div", { "class": "sh-pop sh-flt", role: "dialog", "aria-label": T.filter + ": " + name });
    if (!ro()) el.append(h("div", { "class": "sh-flt-h", text: T.fltSortAll }), h("div", { "class": "sh-flt-row" }, [
      h("button", { type: "button", "class": "sh-b", text: T.sortAsc, onclick: function () { closePop(); grid.focus(); sortCol(c, false); } }),
      h("button", { type: "button", "class": "sh-b", text: T.sortDesc, onclick: function () { closePop(); grid.focus(); sortCol(c, true); } })]));
    el.append(h("div", { "class": "sh-flt-h", text: T.fltYouHead }), condsEl, addBtn);
    if (opts) { var dl = h("datalist", { id: dlId }); opts.forEach(function (o) { dl.appendChild(h("option", { value: o })); }); el.appendChild(dl); }
    // quick picks for a dropdown or a checkbox column: one click sets the column's one condition
    var quick = [];
    if (kind === "check") quick = [[T.fo_true, "true", "", nTrue], [T.fo_false, "false", "", passN - nTrue]];
    else if (kind === "dd") {
      var top = opts.filter(function (o) { return count[o] > 0; }).sort(function (a, b) { return count[b] - count[a]; }).slice(0, 3);
      top.forEach(function (o) { quick.push([o, "is", o, count[o]]); });
      top.slice(0, 2).forEach(function (o) { if (passN - count[o] > 0) quick.push([fill(T.fltNot, { v: o }), "isnt", o, passN - count[o]]); });
    }
    quick = quick.filter(function (q) { return q[3] > 0; });
    if (quick.length) {
      el.appendChild(h("div", { "class": "sh-flt-h", text: T.fltSuggest }));
      var qEl = h("div", { "class": "sh-flt-quick" });
      quick.forEach(function (q) {
        qEl.appendChild(h("button", { type: "button", "class": "sh-flt-q" }, [h("span", { text: q[0] }), h("small", { text: q[3] === 1 ? T.fltRow1 : fill(T.fltNRows, { n: q[3] }) })]))
          .addEventListener("click", function () { conds = [{ op: q[1], val: q[2] }]; vals.forEach(function (x) { sel[x] = 1; }); commit(); drawConds(); draw(); sync(); });
      });
      el.appendChild(qEl);
    }
    el.append(valsHead, search, h("label", { "class": "sh-flt-all" }, [all, h("span", { text: T.fltAll })]), listEl, h("div", { "class": "sh-flt-row" }, [clr]));
    function matches() { var q = search.value.trim().toLowerCase(); return q ? vals.filter(function (x) { return (x || T.fltBlank).toLowerCase().indexOf(q) >= 0; }) : vals; }
    function drawConds() {
      condsEl.innerHTML = "";
      conds.forEach(function (cd, i) {
        var opSel = h("select", { "aria-label": T.fltCond });
        var list = FLT_OPS[kind].indexOf(cd.op) < 0 ? [cd.op].concat(FLT_OPS[kind]) : FLT_OPS[kind];
        list.forEach(function (o) { opSel.appendChild(h("option", { value: o, text: T["fo_" + o] || o })); });
        opSel.value = cd.op;
        var inp = h("input", { type: kind === "date" ? "date" : "text", "aria-label": T.fltValue, placeholder: T.fltValue, list: opts ? dlId : null, inputmode: kind === "num" ? "decimal" : null });
        inp.value = cd.val || "";
        inp.hidden = !PURE.needsVal(cd.op);
        opSel.addEventListener("change", function () { cd.op = opSel.value; inp.hidden = !PURE.needsVal(cd.op); commit(); sync(); if (!inp.hidden && !inp.value) inp.focus(); });
        inp.addEventListener("input", function () { cd.val = inp.value; commit(); sync(); });
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); closePop(); grid.focus(); } });
        var del = h("button", { type: "button", "class": "sh-chip-x", title: T.fltDrop, "aria-label": T.fltDrop, text: "×" });
        del.addEventListener("click", function () { conds.splice(i, 1); commit(); drawConds(); sync(); (condsEl.querySelector("select") || addBtn).focus(); });
        condsEl.appendChild(h("div", { "class": "sh-flt-cond" }, [opSel, inp, del]));
      });
      place();
    }
    function draw() {
      var m = matches();
      listEl.innerHTML = "";
      m.slice(0, 300).forEach(function (x) {
        var cb = h("input", { type: "checkbox" });
        cb.checked = !!sel[x];
        cb.addEventListener("change", function () { if (cb.checked) sel[x] = 1; else delete sel[x]; commit(); sync(); });
        listEl.appendChild(h("label", { title: x || T.fltBlank }, [cb, h("span", { "class": x ? null : "sh-muted", text: x || T.fltBlank }), h("small", { text: String(count[x]) })]));
      });
      if (m.length > 300) listEl.appendChild(h("div", { "class": "sh-muted sh-flt-more", text: fill(T.fltMore, { n: m.length - 300 }) }));
    }
    function sync() {
      var m = matches(), on = m.filter(function (x) { return sel[x]; }).length, total = end.r - hr;
      all.checked = on === m.length && m.length > 0; all.indeterminate = on > 0 && on < m.length;
      clr.disabled = !(s._flt && s._flt[ck]);
      valsHead.textContent = fill(T.fltValsHead, { n: s._fn ? s._fn.n : total, m: total });
    }
    // The page follows every change: all ticked and no condition means no filter on this column.
    function commit() {
      var f = s._flt || Object.create(null), keep = null, n = 0;
      vals.forEach(function (x) { if (sel[x]) n++; });
      if (n !== vals.length) { keep = Object.create(null); vals.forEach(function (x) { if (sel[x]) keep[x] = 1; }); }
      if (!keep && !conds.length) delete f[ck]; else f[ck] = { vals: keep, conds: conds.map(function (x) { return { op: x.op, val: x.val }; }) };
      s._flt = Object.keys(f).length ? f : null;
      applyFilter(s);
      place();  // the bar coming or going moves the grid
    }
    function place() {
      if (!el.parentNode) return;
      var b = cellBox(hr, c), vr = vp.getBoundingClientRect(), top = vr.top + b.y + b.h + 2;
      el.style.left = Math.max(8, Math.min(vr.left + b.x, innerWidth - el.offsetWidth - 8)) + "px";
      el.style.top = Math.max(8, Math.min(top, innerHeight - el.offsetHeight - 8)) + "px";
    }
    addBtn.addEventListener("click", function () {
      conds.push({ op: FLT_OPS[kind][0], val: "" });
      commit(); drawConds(); sync();
      var rows = condsEl.querySelectorAll(".sh-flt-cond"), last = rows[rows.length - 1], inp = last && last.querySelector("input");
      (inp && !inp.hidden ? inp : last.querySelector("select")).focus();
    });
    all.addEventListener("change", function () {
      var m = matches(), to = all.checked;
      m.forEach(function (x) { if (to) sel[x] = 1; else delete sel[x]; });
      commit(); draw(); sync();
    });
    search.addEventListener("input", function () { draw(); sync(); });
    search.addEventListener("keydown", function (e) {  // Enter: keep just what the search found
      if (e.key !== "Enter") return;
      e.preventDefault();
      var m = matches();
      if (search.value.trim() && m.length) { sel = Object.create(null); m.forEach(function (x) { sel[x] = 1; }); commit(); }
      closePop(); grid.focus();
    });
    clr.addEventListener("click", function () { vals.forEach(function (x) { sel[x] = 1; }); conds = []; commit(); closePop(); grid.focus(); });
    draw(); sync();
    openPop(el, null);
    drawConds();
    search.focus();
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
  function delRows() {
    // under a filter the shown rows only, from the bottom up so the row numbers above stay right
    var R = selR(), runs = visRuns(S(), R.r1, R.r2).reverse();
    if (runs.length) structural(runs.map(function (x) { return { op: "delete_rows", at: x[0] + 1, n: x[1] - x[0] + 1 }; }));
  }
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
        var a = parseKey(ch.at) || { r: 0, c: 0 }, nc = colAt(Math.max(0, colX[Math.min(a.c, nCols - 1)] + dx)), nr = clamp(rowOf(Math.max(0, Math.floor((rowY(a.r) + dy) / RH))), 0, MAXR - 1);
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
      card.style.left = colX[c] + 4 + "px"; card.style.top = rowY(r) + 4 + "px";
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

  // ------------------------------------------------------------------ find and replace (Ctrl+F, Ctrl+H)
  // findList: the matches in order [{s: sheet, r, c}]; foundSet marks those of the sheet in view.
  var findEl = null, findIn = null, findN = null, repIn = null, repRow = null, repTog = null, findList = [], findAt = -1, findNav = false;
  var findOpt = { all: false, cs: false, whole: false, fx: false };
  function buildFind() {
    findIn = h("input", { type: "search", placeholder: T.findPh, "aria-label": T.find });
    findN = h("span", { "class": "sh-n", "aria-live": "polite" });
    repIn = h("input", { type: "text", placeholder: T.repPh, "aria-label": T.repPh });
    var one = h("button", { type: "button", "class": "sh-b", text: T.rep1, onclick: function () { replaceOne(); } });
    var every = h("button", { type: "button", "class": "sh-b", text: T.repAll, onclick: function () { replaceEvery(); } });
    repRow = h("div", { "class": "sh-find-row sh-rep", hidden: true }, [repIn, one, every]);
    repTog = barBtn(T.repl + " (Ctrl+H)", ico("replace"), function () { showRep(repRow.hidden); if (!repRow.hidden) repIn.focus(); });
    repTog.setAttribute("aria-expanded", "false");
    var scope = h("select", { "aria-label": T.findScope }, [h("option", { value: "", text: T.findThis }), h("option", { value: "1", text: T.findAll })]);
    scope.addEventListener("change", function () { findOpt.all = !!scope.value; runFind(); });
    function chk(label, k) {
      var cb = h("input", { type: "checkbox" });
      cb.addEventListener("change", function () { findOpt[k] = cb.checked; runFind(); });
      return h("label", {}, [cb, h("span", { text: label })]);
    }
    findEl = h("div", { "class": "sh-pop sh-find", role: "dialog", "aria-label": T.find }, [
      h("div", { "class": "sh-find-row" }, [findIn, findN,
        barBtn(T.prev, kit.icon("prev"), function () { findGo(-1); }), barBtn(T.next, kit.icon("next"), function () { findGo(1); }),
        repTog, barBtn(T.close, kit.icon("close"), closeFind)]),
      repRow,
      h("div", { "class": "sh-find-row sh-find-opts" }, [scope, chk(T.findCase, "cs"), chk(T.findWhole, "whole"), chk(T.findFx, "fx")])]);
    findIn.addEventListener("input", function () { runFind(); });
    findEl.addEventListener("keydown", function (e) {
      var mod = e.ctrlKey || e.metaKey, lk = e.key.toLowerCase();
      if (e.key === "Escape") { e.preventDefault(); closeFind(); }
      else if (e.key === "Enter" && e.target === findIn) { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); }
      else if (e.key === "Enter" && e.target === repIn) { e.preventDefault(); replaceOne(); }
      else if (mod && lk === "f") { e.preventDefault(); findIn.focus(); findIn.select(); }
      else if (mod && lk === "h") { e.preventDefault(); if (!ro()) { showRep(true); repIn.focus(); repIn.select(); } }
    });
  }
  function showRep(on) {
    on = on && !ro();
    repRow.hidden = !on;
    repTog.setAttribute("aria-expanded", on ? "true" : "false"); repTog.setAttribute("aria-pressed", on ? "true" : "false");
  }
  /** Open the find box; withReplace: with its Replace row, the cursor there. */
  function openFind(withReplace) {
    if (!findEl) buildFind();
    if (!findEl.parentNode) document.body.appendChild(findEl);
    findEl.style.top = grid.getBoundingClientRect().top + 8 + "px";
    if (withReplace === true && !ro()) showRep(true);
    repTog.hidden = ro();
    if (ro()) showRep(false);
    if (withReplace === true && !ro() && findIn.value) { repIn.focus(); repIn.select(); } else { findIn.focus(); findIn.select(); }
    if (findIn.value) runFind();
  }
  // The texts a cell is found by: what it shows, what it was typed as, and its formula when asked.
  function findHit(s, k, q) {
    var raw = s.cells[k], fx = isFormula(raw);
    if (PURE.matches(display(s, k, valueOf(s, k)), q, findOpt)) return true;
    if (fx) return findOpt.fx && PURE.matches(raw, q, findOpt);
    return PURE.matches(rawText(raw), q, findOpt);
  }
  function markFound() {
    var s = S();
    foundSet = null;
    findList.forEach(function (e) { if (e.s === s) (foundSet || (foundSet = {}))[key(e.r, e.c)] = 1; });
  }
  /** Search again. stay: do not move the selection to the first match. */
  function runFind(stay) {
    var q = findIn ? findIn.value : "", cur0 = S();
    findList = []; findAt = -1;
    if (q) (findOpt.all && !preview ? book : [cur0]).forEach(function (s0) {
      var s = s0 === book[cur] ? cur0 : s0, list = [];
      for (var k in s.cells) { var p = parseKey(k); if (p && !hid(s, p.r) && findHit(s, k, q)) list.push({ s: s, r: p.r, c: p.c }); }
      list.sort(function (a, b) { return a.r - b.r || a.c - b.c; });
      findList = findList.concat(list);
    });
    markFound();
    findN.textContent = q ? (findList.length ? "0/" + findList.length : T.noMatch) : "";
    renderAll(true);
    if (findList.length && stay !== true) {
      // the first match of the sheet in view, else the first of all
      for (var i = 0; i < findList.length; i++) if (findList[i].s === cur0) { findAt = i - 1; break; }
      findGo(1, true);
    }
  }
  function findGo(d, keepFocus) {
    if (!findList.length) return;
    findAt = (findAt + d + findList.length) % findList.length;
    var e = findList[findAt];
    if (e.s !== S()) { var i = book.indexOf(e.s); if (i < 0) return runFind(); findNav = true; try { switchTo(i); } finally { findNav = false; } }
    select(e.r, e.c, false);
    findN.textContent = findAt + 1 + "/" + findList.length;
    if (!keepFocus && !findEl.contains(document.activeElement)) findIn.focus();
  }
  // The sheet in view changed: the marks follow; a search of this sheet alone runs again.
  function findSheet() {
    if (!findEl || !findEl.parentNode) return;
    if (findNav || findOpt.all) markFound();
    else setTimeout(function () { if (findEl.parentNode) runFind(true); }, 0);
  }
  // What a cell holds after the replacement; undefined: nothing to replace there (a computed value, a tick).
  function replaced(s, k, q, rep) {
    var raw = s.cells[k], fx = isFormula(raw);
    if (raw === undefined || raw === null || typeof raw === "boolean" || fx && !findOpt.fx) return undefined;
    var src = fx ? raw : rawText(raw), out = PURE.replace(src, q, rep, findOpt);
    return out === src ? undefined : parseText(out).value;
  }
  function replaceOne() {
    if (ro() || !findIn.value) return;
    if (findAt < 0 || !findList[findAt]) return findGo(1);
    var e = findList[findAt], k = key(e.r, e.c), v = e.s === S() ? replaced(e.s, k, findIn.value, repIn.value) : undefined;
    if (v === undefined) return findGo(1);
    setBlock(e.s, e.r, e.c, [[v]]);
    runFind(true);
    if (!findList.length) return;
    // on to the match after the cell just changed
    findAt = -1;
    for (var i = 0; i < findList.length; i++) { var x = findList[i]; if (x.s === e.s && (x.r > e.r || x.r === e.r && x.c > e.c)) { findAt = i - 1; break; } }
    findGo(1);
  }
  // Every match that can be replaced, as one edit per sheet (one Undo brings a sheet's cells back).
  function replaceEvery() {
    var q = findIn.value, rep = repIn.value, n = 0, bySheet = [];
    if (ro() || !q) return;
    findList.forEach(function (e) {
      var v = replaced(e.s, key(e.r, e.c), q, rep);
      if (v === undefined) return;
      var g = bySheet.filter(function (x) { return x.s === e.s; })[0];
      if (!g) bySheet.push(g = { s: e.s, fwd: [], inv: [] });
      g.fwd.push({ op: "set", range: key(e.r, e.c), values: [[v]] });
      g.inv.push({ op: "set", range: key(e.r, e.c), values: [[oldRaw(e.s, e.r, e.c)]] });
      n++;
    });
    bySheet.forEach(function (g) { doEdit(g.s, g.fwd, g.inv); });
    kit.toast(n ? fill(T.repDone, { n: n }) : T.repNone);
    runFind(true);
  }
  function closeFind() { if (findEl) findEl.remove(); foundSet = null; findList = []; findAt = -1; renderAll(true); grid.focus(); }

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
      var bytes = X.write({ sheets: book.map(function (s) { return { name: s.name, cells: s.cells, fmt: s.fmt, vals: computedVals(s), cols: s.cols, freeze: s.freeze, merges: s.merges, rules: s.rules }; }) });
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
    kit.download(kit.slug(bookTitle() + (book.length > 1 ? " - " + s.name : "")) + ".csv", "\ufeff" + text, "text/csv");
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
        text = text.replace(/^\ufeff/, "");
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
        var o = JSON.parse(sig) || {}, op = { op: "format", range: rangeName({ r1: r, c1: cs[i], r2: r, c2: cs[j] }) }, any = false;
        FMT_KEYS.forEach(function (x) { if (o[x] != null && x !== "options" && x !== "colors") { op[x] = o[x]; any = true; } });
        if (any) ops.push(op);
        i = j + 1;
      }
    });
    return ops;
  }
  function extrasOf(sh) {
    var ops = fmtOpsOf(sh.fmt);
    // dropdowns: one op for each run down a column, not one for each row
    (X && X.listRuns ? X.listRuns(sh.fmt || {}) : []).forEach(function (x) {
      if (x.r1 < MAXR && x.c < MAXC) ops.push({ op: "format", range: rangeName({ r1: x.r1, c1: x.c, r2: Math.min(x.r2, MAXR - 1), c2: x.c }), options: x.options });
    });
    Object.keys(sh.cols || {}).forEach(function (c) { ops.push({ op: "col_width", col: c, w: clamp(Math.round(sh.cols[c]), 40, 800) }); });
    if (sh.freeze && (sh.freeze.rows || sh.freeze.cols)) ops.push({ op: "freeze", rows: sh.freeze.rows || 0, cols: sh.freeze.cols || 0 });
    (sh.merges || []).forEach(function (m) { ops.push({ op: "merge", range: m }); });
    if (sh.rules && sh.rules.length) ops.push({ op: "rules", rules: sh.rules });
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
      if (s.merges.length) ops.push({ op: "unmerge", range: "A1:" + key(MAXR - 1, MAXC - 1) });
      if (s.rules.length) ops.push({ op: "rules", rules: [] });
      if (u.r >= 0) ops.push({ op: "clear", range: rangeName({ r1: 0, c1: 0, r2: u.r, c2: Math.max(0, u.c) }) });
      ops.push(fmtOp({ r1: 0, c1: 0, r2: Math.max(0, u.r + 1), c2: Math.max(0, u.c) }, noFmt()));
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
  // The pill shows while Hermes is at work here (kit.hermesWork: a run in flight that changed the sheet, as
  // Hermes Desktop and the reads tell). It goes when that runs out even when no read comes then (reads pause
  // while a cell is typed in, or one hangs); every read and every word from the host sets it afresh.
  var hermesTimer = hermesActive ? setTimeout(function () { setHermes(false); }, kit.hermesWork.left() * 1000 + 500) : null;
  function setHermes(active, left, ago) {
    if (typeof active === "boolean") kit.hermesWork.seen(active, left, ago);
    var on = kit.hermesWork.on();
    clearTimeout(hermesTimer);
    if (on) hermesTimer = setTimeout(function () { setHermes(false); }, kit.hermesWork.left() * 1000 + 500);
    if (on !== hermesActive) { hermesActive = on; drawFoot(); }
  }
  kit.hermesWork.change(function () { setHermes(); });
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
    if (r.fmt) { bindLists(s.fmt, r.lists, Object.keys(r.fmt), r.list_colors); s._bd = undefined; }
    if (r.rules) { s.rules = r.rules; s._cf = null; }
    if (r.merges) s.merges = r.merges;
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
        if (typeof r.hermes_active === "boolean") setHermes(r.hermes_active, r.hermes_left, r.hermes_ago);
        if (r.sheets) syncOverview(r.sheets);
        if (byId(s.id) !== s || pending()) return;
        var keys;
        if (r.since === "unavailable" || r.rows) {
          if (r.rev === s.rev && !r.since) return;
          keys = diffKeys(s, r).slice(0, 300);
          loadRead(s, r);
          refit(s);
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
  // JSON.stringify(a) === JSON.stringify(b), stringifying only objects (an error).
  function sameJson(a, b) { return a === b || (a !== null && typeof a === "object" || b !== null && typeof b === "object") && JSON.stringify(a) === JSON.stringify(b); }
  function sendVals() {
    if (inflight || pending() || preview || ed) return scheduleVals();
    book.forEach(function (s) {
      if (s.needsRead) return;
      var out = {}, n = 0, k;
      for (k in s.cells) {
        if (!isFormula(s.cells[k])) continue;
        var v = valueOf(s, k), enc = isErr(v) ? { error: String(v.error) } : v === undefined ? null : v, old = s.vals[k];
        if (!sameJson(old === undefined ? null : old, enc)) { out[k] = enc; n++; }
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
    // This only opens the host's comment form at the cell (its anchor: the cell and what it shows); the
    // comment itself is what the user types there, and an empty one is never sent (the form and the
    // server both refuse it).
    var s = book[cur], k = key(sr, sc), shown = String(display(s, k, valueOf(s, k)) || "").trim();
    hm.comment({ selector: "cell:" + s.id + "!" + k, text: (shown ? k + ": " + shown : k).slice(0, 200), label: (s.name + " · " + k).slice(0, 40) });
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

  // ------------------------------------------------------------------ status bar: one number of the selection (Sum, Average, Min, Max or Count: the viewer's pick)
  var foot = document.getElementById("sh-foot");
  var tabsEl = h("div", { "class": "sh-tabs", role: "tablist", "aria-label": T.sheetWord });
  var statsEl = h("div", { "class": "sh-stats", "aria-live": "off" });
  var pill = h("span", { "class": "sh-pill", text: T.working, hidden: true });
  var aggBtn = h("button", { type: "button", "class": "sh-agg", "aria-haspopup": "menu", title: T.aggPick, hidden: true });
  var AGGS = ["sum", "avg", "min", "max", "count"], aggNow = null;
  statsEl.append(aggBtn, pill);
  function statNum(v) {
    if (F && F.format) { try { return F.format(Math.round(v * 1e6) / 1e6, null, L); } catch (e) {} }
    return fmtNum.format(Math.round(v * 1e6) / 1e6);
  }
  // One aggregate of the selection as text; null when it has no numbers to give it.
  function aggText(a) {
    var g = aggNow;
    if (!g) return null;
    if (a === "count") return String(g.cnt);
    if (!g.n) return null;
    return statNum(a === "sum" ? g.sum : a === "avg" ? g.sum / g.n : a === "min" ? g.min : g.max);
  }
  aggBtn.addEventListener("click", function () {
    if (!aggNow) return;
    kit.menu(aggBtn, AGGS.map(function (a) {
      var v = aggText(a);
      return { label: (a === prefs.agg ? "✓ " : "  ") + T[a] + (v === null ? "" : ": " + v), onClick: function () { setPref("agg", a); stats(); aggBtn.focus(); } };
    }));
  });
  // Under a filter the hidden rows count for nothing.
  function stats() {
    if (C.thumb) return;
    var s = S(), R = selR(), u = used(s), g = { sum: 0, n: 0, cnt: 0, min: Infinity, max: -Infinity };
    R.r2 = Math.min(R.r2, u.r); R.c2 = Math.min(R.c2, u.c);
    function one(k) {
      var v = valueOf(s, k);
      if (v === null || v === "") return;
      g.cnt++;
      if (typeof v === "number") { g.sum += v; g.n++; if (v < g.min) g.min = v; if (v > g.max) g.max = v; }
    }
    if (multi() && R.r2 >= R.r1 && R.c2 >= R.c1) {
      if (area(R) <= Object.keys(s.cells).length) eachIn(R, function (r, c, k) { if (s.cells[k] !== undefined && !hid(s, r)) one(k); });
      else for (var k in s.cells) { var p = parseKey(k); if (p && inR(R, p.r, p.c) && !hid(s, p.r)) one(k); }
    }
    aggNow = g.cnt > 1 || g.n > 0 && multi() ? g : null;
    if (aggNow) {
      var a = AGGS.indexOf(prefs.agg) >= 0 ? prefs.agg : "sum", v = aggText(a);
      if (v === null) { a = "count"; v = String(g.cnt); }
      var html = kit.esc(T[a]) + ": <b>" + kit.esc(v) + "</b>" + CARET;
      if (aggBtn._t !== html) { aggBtn.innerHTML = html; aggBtn._t = html; }
    }
    if (aggBtn.hidden === !!aggNow) aggBtn.hidden = !aggNow;
    if (pill.hidden === hermesActive) pill.hidden = !hermesActive;
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
    nRows = 50; nCols = 26;
    findSheet();
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
  function drawFoot() { stats(); }

  // ------------------------------------------------------------------ view: zoom, formulas shown, layout, theme (this viewer's own, kept in localStorage when there is one)
  var PREF_KEY = "hermes-sheet-view", ZOOMS = [50, 75, 100, 125, 150, 200];
  var prefs = { zoom: 100, fx: false, compact: false, theme: "auto", agg: "sum" };
  if (!C.thumb) {
    try {
      var p0 = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
      if (p0 && typeof p0 === "object") {
        if (ZOOMS.indexOf(p0.zoom) >= 0) prefs.zoom = p0.zoom;
        prefs.fx = p0.fx === true; prefs.compact = p0.compact === true;
        if (p0.theme === "light" || p0.theme === "dark") prefs.theme = p0.theme;
        if (AGGS.indexOf(p0.agg) >= 0) prefs.agg = p0.agg;
      }
    } catch (e) {}
  }
  function setPref(k, v) {
    prefs[k] = v;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  // The grid's measures follow the zoom and the layout: every position is computed from these, so
  // the panes, the headers and the editor stay aligned at any zoom.
  function applyMetrics() {
    var de = document.documentElement;
    ZM = prefs.zoom / 100; showFx = prefs.fx;
    RH = HH = Math.round((prefs.compact ? 20 : 24) * ZM); HW = Math.round(46 * ZM);
    de.style.setProperty("--sh-z", String(ZM)); de.style.setProperty("--sh-rh", RH + "px");
    de.classList.toggle("sh-compact", prefs.compact);
  }
  // A view setting changed: the cell at the top left stays there.
  function setView(k, v) {
    if (prefs[k] === v) return;
    commitIfEditing();
    var place = Math.round(st / RH), col = colAt(FW + sl);
    setPref(k, v);
    applyMetrics();
    layout();
    grid.scrollTop = place * RH; grid.scrollLeft = Math.max(0, colX[col] - FW);
    refresh();
    barSync(true);
  }
  function zoomStep(d) { var i = ZOOMS.indexOf(prefs.zoom); setView("zoom", ZOOMS[clamp((i < 0 ? 2 : i) + d, 0, ZOOMS.length - 1)]); }
  function toggleFx() { setView("fx", !prefs.fx); }
  // The sheet's own theme: "auto" follows the host; light or dark sets the page's mode and puts the
  // host's colours aside (they belong to the host's mode) until the choice is Automatic again.
  var THEME_VARS = ["--color-bg", "--color-panel", "--color-fg", "--color-fg-secondary", "--color-fg-muted", "--color-border-line", "--color-border-strong",
    "--color-hover", "--color-bad", "--color-ok", "--color-warn", "--color-elevated"];
  var hostAttr = document.documentElement.getAttribute("data-theme"), themeStash = null, themeObs = null;
  function applyTheme() {
    var de = document.documentElement, want = prefs.theme, known = (kit.hostTheme && kit.hostTheme() || {}).mode || hostAttr;
    var hostMode = known || (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (want !== "auto" && want !== hostMode) {
      themeStash = themeStash || {};
      THEME_VARS.forEach(function (n) { var v = de.style.getPropertyValue(n); if (v) { themeStash[n] = v; de.style.removeProperty(n); } });
      de.setAttribute("data-theme", want);
    } else {
      if (themeStash) { for (var k in themeStash) if (!de.style.getPropertyValue(k)) de.style.setProperty(k, themeStash[k]); themeStash = null; }
      if (want !== "auto") de.setAttribute("data-theme", want);
      else if (known) de.setAttribute("data-theme", known);
      else de.removeAttribute("data-theme");
    }
    if (themeObs) themeObs.takeRecords();
  }
  if (!C.thumb && window.MutationObserver) {
    // the host's theme arriving later (kit.js writes the mode and the colours) goes under the viewer's choice
    themeObs = new MutationObserver(function () {
      var a = document.documentElement.getAttribute("data-theme");
      if (prefs.theme === "auto") { hostAttr = a; return; }
      if (a !== prefs.theme) hostAttr = a;
      applyTheme();
    });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
  }
  function viewPop(anchor) {
    commitIfEditing();
    var el = h("div", { "class": "sh-pop sh-view", role: "dialog", "aria-label": T.view });
    function head(t) { return h("div", { "class": "sh-flt-h", text: t }); }
    function seg(label, items, now, pick) {
      var g = h("div", { "class": "sh-seg", role: "radiogroup", "aria-label": label });
      items.forEach(function (it) {
        var b = h("button", { type: "button", role: "radio", "aria-checked": it[0] === now ? "true" : "false", text: it[1] });
        b.addEventListener("click", function () { pick(it[0]); [].forEach.call(g.children, function (x) { x.setAttribute("aria-checked", x === b ? "true" : "false"); }); draw(); });
        g.appendChild(b);
      });
      return g;
    }
    var zl = h("span", { "class": "sh-zl", "aria-live": "polite" });
    var out = h("button", { type: "button", "class": "sh-b", title: T.zoomOut, "aria-label": T.zoomOut, text: "−", onclick: function () { zoomStep(-1); draw(); } });
    var inn = h("button", { type: "button", "class": "sh-b", title: T.zoomIn, "aria-label": T.zoomIn, text: "+", onclick: function () { zoomStep(1); draw(); } });
    var reset = h("button", { type: "button", "class": "sh-b", text: T.zoomReset, onclick: function () { setView("zoom", 100); draw(); } });
    var levels = seg(T.zoom, ZOOMS.map(function (z) { return [z, z + "%"]; }), prefs.zoom, function (z) { setView("zoom", z); });
    var fx = h("input", { type: "checkbox" });
    fx.checked = prefs.fx;
    fx.addEventListener("change", function () { setView("fx", fx.checked); });
    function draw() {
      zl.textContent = prefs.zoom + "%";
      out.disabled = prefs.zoom <= ZOOMS[0]; inn.disabled = prefs.zoom >= ZOOMS[ZOOMS.length - 1]; reset.disabled = prefs.zoom === 100;
      [].forEach.call(levels.children, function (x, i) { x.setAttribute("aria-checked", ZOOMS[i] === prefs.zoom ? "true" : "false"); });
    }
    el.append(head(T.zoom), h("div", { "class": "sh-view-row" }, [out, zl, inn, reset]), levels,
      h("label", { "class": "sh-view-chk" }, [fx, h("span", { text: T.showFx }), h("small", { text: "Ctrl+`" })]),
      head(T.layout), seg(T.layout, [[false, T.layComfy], [true, T.layCompact]], prefs.compact, function (v) { setView("compact", v); }),
      head(T.theme), seg(T.theme, [["auto", T.thAuto], ["light", T.thLight], ["dark", T.thDark]], prefs.theme, function (v) { setPref("theme", v); applyTheme(); }));
    draw();
    openPop(el, anchor);
    el.style.left = Math.max(8, Math.min(anchor.getBoundingClientRect().right - el.offsetWidth, innerWidth - el.offsetWidth - 8)) + "px";
    (el.querySelector('[aria-checked="true"]') || out).focus();
  }

  // ------------------------------------------------------------------ errors: a sentence for each, and asking Hermes to fix them (never sent unasked)
  function canFix() { return live && !!(hm.sheet && hm.sheet.ask) && !ro() && !C.thumb; }
  /** Why a cell shows an error, in a sentence. */
  function errSentence(s, k, v) {
    var i = PURE.errInfo(v && v.error, s.cells[k], FNAMES);
    return fill(T["err_" + i.kind] || T.err_other, { f: i.fn });
  }
  // The error cells of the workbook, the sheet in view first: [{s, k, code}] (at most max; n counts them all).
  function errCells(max) {
    var out = [], n = 0, order = [book[cur]].concat(book.filter(function (x, i) { return i !== cur; }));
    order.forEach(function (s) {
      var here = [];
      for (var k in s.cells) { if (!isFormula(s.cells[k])) continue; var v = valueOf(s, k); if (isErr(v)) { n++; here.push({ s: s, k: k, code: String(v.error) }); } }
      here.sort(function (a, b) { var p = parseKey(a.k), q = parseKey(b.k); return p.r - q.r || p.c - q.c; });
      out = out.concat(here);
    });
    return { list: out.slice(0, max), n: n };
  }
  // The request goes the way "Ask Hermes" does (hermes.sheet.ask); cells, formulas and codes are quoted as data.
  function askFix(cells, total) {
    if (!canFix() || !cells.length) return;
    commitIfEditing();
    var first = cells[0], lines = cells.map(function (x) { return x.s.name + "!" + x.k + ": " + String(x.s.cells[x.k]).slice(0, 200) + " -> " + x.code; });
    var text = (cells.length === 1 ? T.fixMsg1 : fill(T.fixMsgN, { n: cells.length })) + (total > cells.length ? " " + fill(T.fixMsgMore, { n: total }) : "") + "\n" + lines.join("\n");
    var sameSheet = cells.filter(function (x) { return x.s === first.s; }), R = null;
    sameSheet.forEach(function (x) { var p = parseKey(x.k); R = R ? { r1: Math.min(R.r1, p.r), c1: Math.min(R.c1, p.c), r2: Math.max(R.r2, p.r), c2: Math.max(R.c2, p.c) } : { r1: p.r, c1: p.c, r2: p.r, c2: p.c }; });
    hm.sheet.ask({ text: text.slice(0, 3500), sheet: first.s.id, tab: first.s.name, range: rangeName(R), selection: lines.join("\n").slice(0, 2000) })
      .then(function (r) { kit.toast(r && r.mode === "draft" ? T.drafted : T.sent); })
      .catch(function (e) { kit.toast(String(e && e.message || e)); });
  }
  // The error cells of the selection (the active cell first), for the toolbar's button.
  function selErrs() {
    var s = S(), out = [], R = selUsed(), v = valueOf(s, key(sr, sc));
    if (isErr(v)) out.push({ s: s, k: key(sr, sc), code: String(v.error) });
    if (multi() && area(R) <= 4000) eachIn(R, function (r, c, k) {
      if (out.length >= 8 || r === sr && c === sc || hid(s, r) || !isFormula(s.cells[k])) return;
      var x = valueOf(s, k);
      if (isErr(x)) out.push({ s: s, k: k, code: String(x.error) });
    });
    return out;
  }
  // The bubble by an error cell: under the active one, or the one the pointer rests on.
  var errTip = h("div", { "class": "sh-errtip", role: "status", hidden: true }), errAt = null, errTimer = null;
  var errText = h("span"), errBtn = h("button", { type: "button", "class": "sh-b pri", text: T.fixAsk });
  errTip.append(errText, errBtn);
  errBtn.addEventListener("mousedown", function (e) { e.preventDefault(); });
  errBtn.addEventListener("click", function () { var a = errAt; hideErr(); if (a) askFix([{ s: a.s, k: a.k, code: a.code }], 1); });
  if (!C.thumb) document.body.appendChild(errTip);
  function hideErr() { clearTimeout(errTimer); errAt = null; if (!errTip.hidden) errTip.hidden = true; }
  function showErr(r, c, hover) {
    var s = S(), k = key(r, c), v = valueOf(s, k);
    if (!isErr(v) || ed || pop || r >= nRows || c >= nCols) return hideErr();
    if (errAt && errAt.s === s && errAt.k === k && !errTip.hidden) { errAt.hover = hover; return; }
    errAt = { s: s, k: k, code: String(v.error), hover: hover };
    errText.textContent = errSentence(s, k, v);
    errBtn.hidden = !canFix();
    errTip.hidden = false;
    var b = cellBox(r, c), vr = vp.getBoundingClientRect(), x = vr.left + b.x, y = vr.top + b.y + b.h + 4;
    if (b.x < HW - b.w || b.y < 0 || b.x > vpW || b.y > vpH) return hideErr();
    errTip.style.left = Math.max(8, Math.min(x, innerWidth - errTip.offsetWidth - 8)) + "px";
    errTip.style.top = (y + errTip.offsetHeight > innerHeight - 8 ? Math.max(8, vr.top + b.y - errTip.offsetHeight - 4) : y) + "px";
  }
  function errSync() { if (C.thumb) return; if (!multi() && !ed) showErr(sr, sc, false); else hideErr(); }
  if (!C.thumb) {
    grid.addEventListener("mousemove", function (e) {
      if (drag || ed || !vp.contains(e.target)) return;
      var p = hit(e.clientX, e.clientY);
      clearTimeout(errTimer);
      if (p.r < 0 || p.c < 0) return;
      if (isErr(valueOf(S(), key(p.r, p.c)))) errTimer = setTimeout(function () { showErr(p.r, p.c, true); }, 350);
      else if (errAt && errAt.hover) errTimer = setTimeout(errSync, 250);
    });
    grid.addEventListener("mouseleave", function (e) { if (errAt && errAt.hover && !errTip.contains(e.relatedTarget)) { clearTimeout(errTimer); errTimer = setTimeout(errSync, 250); } });
    errTip.addEventListener("mouseenter", function () { clearTimeout(errTimer); });
    errTip.addEventListener("mouseleave", function () { if (errAt && errAt.hover) errTimer = setTimeout(errSync, 250); });
    // typing, scrolling or opening the editor puts the bubble away (the selection moving brings the next one)
    grid.addEventListener("keydown", function (e) { if (!/^(Shift|Control|Alt|Meta)$/.test(e.key)) hideErr(); }, true);
    grid.addEventListener("scroll", hideErr, { passive: true });
    grid.addEventListener("dblclick", hideErr, true);
    fxTa.addEventListener("focus", hideErr);
  }
  // Once after the sheet opens: how many errors it holds, and the same request for the first of them.
  function errToast() {
    if (C.thumb || preview) return;
    var e = errCells(8);
    if (!e.n) return;
    var el = h("div", { "class": "sh-errtoast", role: "status" }), close = h("button", { type: "button", "class": "sh-chip-x", title: T.close, "aria-label": T.close, text: "×" });
    el.appendChild(h("span", { text: e.n === 1 ? T.errOne : fill(T.errMany, { n: e.n }) }));
    if (canFix()) el.appendChild(h("button", { type: "button", "class": "sh-b pri", text: T.fixAsk, onclick: function () { el.remove(); var now = errCells(8); askFix(now.list, now.n); } }));
    close.addEventListener("click", function () { el.remove(); grid.focus(); });
    el.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { el.remove(); grid.focus(); } });
    el.appendChild(close);
    document.body.appendChild(el);
  }

  // ------------------------------------------------------------------ the toolbar: what it offers follows the selection; what does not fit goes into More
  function barBtn(label, html, fn, cls) {
    var b = h("button", { type: "button", "class": "kit-btn" + (cls ? " " + cls : ""), title: label, "aria-label": label, html: html });
    b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // the grid or the editor keeps the focus
    b.addEventListener("click", function (e) { fn(e, b); });
    return b;
  }
  var CARET = '<svg class="sh-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg>';
  ICO.borders = "M4 4h16v16H4zM12 4v16M4 12h16";
  ICO.merge = "M4 5h16v14H4zM6.5 12h4M8.5 10l2 2-2 2M17.5 12h-4M15.5 10l-2 2 2 2";
  ICO.unmerge = "M4 5h16v14H4zM12 5v14M10 12H6.5M8.5 10l-2 2 2 2M14 12h3.5M15.5 10l2 2-2 2";
  ICO.rules = "M4 4h16v16H4zM4 10h16M10 4v16M13 13h4v4h-4z";
  ICO.date = "M5 6h14v14H5zM5 10h14M9 4v4M15 4v4";
  ICO.replace = "M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3";
  function txtIco(t) { return '<span class="sh-ico sh-txt">' + kit.esc(t) + "</span>"; }
  var bar = document.getElementById("sh-bar");
  bar.className = "kit-bar";
  var DATE_FMT = L === "hu" ? "yyyy.mm.dd." : "yyyy-mm-dd", CUR_FMT = L === "hu" ? '#,##0 "Ft"' : "$#,##0.00";
  var NUMS = [
    { label: T.nGeneral, num: null }, { label: T.nNumber, num: "0.00" }, { label: T.nThousands, num: "#,##0" }, { label: T.nPercent, num: "0%" },
    { label: T.nFt, num: '#,##0 "Ft"' }, { label: T.nEur, num: "#,##0.00 €" }, { label: T.nUsd, num: "$#,##0.00" },
    { label: T.nDate, num: DATE_FMT }, { label: T.nText, num: "@" }];
  function tick(on, label) { return (on ? "✓ " : "  ") + label; }
  function numMenu(anchor) { commitIfEditing(); var c = curFmt().num || null; kit.menu(anchor, NUMS.map(function (x) { return { label: tick(x.num === c, x.label), onClick: function () { fmtSel({ num: x.num }); } }; })); }
  function alignMenu(anchor) {
    commitIfEditing();
    var f = curFmt();
    kit.menu(anchor, [["left", T.alignL], ["center", T.alignC], ["right", T.alignR]].map(function (x) {
      return { label: tick(f.align === x[0], x[1]), onClick: function () { fmtSel({ align: f.align === x[0] ? null : x[0] }); } };
    }).concat([{ label: tick(!!f.wrap, T.wrap), onClick: function () { toggleFmt("wrap"); } }]));
  }
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
  // The CSV holds every row, also the ones a filter hides: its entry says so then.
  function expMenu(anchor) { kit.menu(anchor, exportList.map(function (x) { return { label: x.id === "csv" && S()._hid ? T.csvAll : x.label, onClick: x.run }; })); }
  function filterMenu(anchor) {
    var s = S(), items = [{ label: T.fltCol, onClick: filterHere }];
    if (s._flt) items.push({ label: T.fltClear, onClick: clearFilter });
    if (s._fon && s.freeze.rows < 1) items.push({ label: T.fltHide, onClick: function () { s._fon = false; s._flt = null; applyFilter(s); } });
    kit.menu(anchor, items);
  }
  function impMenu(anchor) { kit.menu(anchor, [{ label: T.impNew, onClick: function () { pickImport("new"); } }, { label: T.impReplace, onClick: function () { pickImport("replace"); } }]); }
  var exportList = [{ id: "xlsx", label: T.xlsx, run: exportXlsx }, { id: "csv", label: T.csv, run: exportCsv }];
  // Decimals, currency, percent: the selection's number format, from the active cell's.
  function stepDecimals(d) {
    var s = S(), k = key(sr, sc), cur0 = curFmt().num || null, m = /[.,](\d+)\D*$/.exec(display(s, k, valueOf(s, k)));
    var f = PURE.decimals(cur0, d, cur0 ? 0 : m ? m[1].length : 0);
    if (f && f !== cur0) fmtSel({ num: f });
  }
  function toggleNum(f) { fmtSel({ num: curFmt().num === f ? null : f }); }
  // Today's date into the active cell, the date format over the selection (one step to undo).
  function insertDate() {
    commitIfEditing();
    if (ro()) return;
    var s = S(), R = selR(), d = new Date(), k = key(sr, sc);
    var iso = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    R = { r1: R.r1, c1: R.c1, r2: Math.min(R.r2, MAXR - 1), c2: Math.min(R.c2, MAXC - 1) };
    var fi = invFmt(s, R, ["num"]), inv = [{ op: "set", range: k, values: [[oldRaw(s, sr, sc)]] }];
    doEdit(s, [{ op: "set", range: k, values: [[iso]] }, fmtOp(R, { num: DATE_FMT })], fi ? inv.concat(fi) : null);
  }
  // What the selection is, for the tools it brings: a dropdown, a checkbox, numbers, nothing yet, an error, merged cells.
  function sheetUI() { return window.__sheetUI || {}; }
  function uiCall(name, a) { var f = sheetUI()[name]; if (typeof f !== "function") return undefined; try { return f(a); } catch (e) { console.error("sheet ui " + name, e); return undefined; } }
  function ctxOf() {
    var s = S(), k = key(sr, sc), f = s.fmt[k] || {}, v = valueOf(s, k), R = selR(), u = used(s), any = false, numHere = typeof v === "number";
    var cx = { dd: !!f.options && sr !== hdrRow(s), check: !!f.check, num: false, empty: false, err: isErr(v), merged: uiCall("canUnmerge") === true, on: v === true };
    R = { r1: R.r1, c1: R.c1, r2: Math.min(R.r2, u.r), c2: Math.min(R.c2, u.c) };
    if (R.r2 >= R.r1 && R.c2 >= R.c1) {
      if (area(R) > 4000) any = true;
      else eachIn(R, function (r, c, k2) {
        var raw = s.cells[k2];
        if (raw === undefined || raw === null || raw === "") return;
        any = true;
        if (!numHere && typeof valueOf(s, k2) === "number") numHere = true;
      });
    }
    cx.num = numHere && !cx.dd && !cx.check;
    cx.empty = !any && !cx.dd && !cx.check;
    return cx;
  }
  // The tools, left to right. edit: needs an editable sheet ("comment", "ask": those paths); pri: the
  // higher, the sooner it moves into More when the bar is short; on(cx): "bar", "more" (in More only)
  // or false for this selection; menu: it opens under its button (under More when it sits in there).
  var TOOLS = [
    { id: "undo", label: T.undo, html: kit.icon("undo"), run: function () { undo(); grid.focus(); }, edit: true, pri: 1 },
    { id: "redo", label: T.redo, html: kit.icon("redo"), run: function () { redo(); grid.focus(); }, edit: true, pri: 1 },
    "|",
    { id: "bold", label: T.bold + " (Ctrl+B)", html: kit.icon("bold"), run: function () { toggleFmt("bold"); }, edit: true, pri: 1, pressed: function () { return !!curFmt().bold; } },
    { id: "italic", label: T.italic + " (Ctrl+I)", html: kit.icon("italic"), run: function () { toggleFmt("italic"); }, edit: true, pri: 1, pressed: function () { return !!curFmt().italic; } },
    { id: "underline", label: T.underline + " (Ctrl+U)", html: kit.icon("underline"), run: function () { toggleFmt("underline"); }, edit: true, pri: 5, pressed: function () { return !!curFmt().underline; } },
    "|",
    { id: "align", label: T.align, html: kit.icon("alignL") + CARET, run: function (e, b) { alignMenu(b); }, edit: true, pri: 5, menu: true },
    { id: "fg", label: T.textColor, html: '<span class="sh-ico">' + ico("fcolor") + "</span>" + CARET, run: function (e, b) { colorPop(b, "fg"); }, edit: true, pri: 6, menu: true },
    { id: "bg", label: T.fill, html: '<span class="sh-ico">' + ico("bucket") + "</span>" + CARET, run: function (e, b) { colorPop(b, "bg"); }, edit: true, pri: 6, menu: true },
    { id: "borders", label: T.borders, html: ico("borders") + CARET, run: function (e, b) { commitIfEditing(); uiCall("openBorders", b); }, edit: true, pri: 6, menu: true,
      on: function () { return typeof sheetUI().openBorders === "function" ? "bar" : false; } },
    { id: "merge", label: T.merge, html: ico("merge"), run: function () { commitIfEditing(); uiCall("mergeSel"); }, edit: true, pri: 6,
      on: function (cx) { return typeof sheetUI().mergeSel === "function" && !cx.merged ? "bar" : false; } },
    { id: "unmerge", label: T.unmerge, html: ico("unmerge"), run: function () { commitIfEditing(); uiCall("unmergeSel"); }, edit: true, pri: 6,
      on: function (cx) { return typeof sheetUI().unmergeSel === "function" && cx.merged ? "bar" : false; } },
    "|",
    { id: "num", label: T.numFmt, html: ico("num") + CARET, run: function (e, b) { numMenu(b); }, edit: true, pri: 1, menu: true },
    { id: "decLess", label: T.decLess, html: txtIco("←.0"), run: function () { stepDecimals(-1); }, edit: true, pri: 3, on: function (cx) { return cx.num ? "bar" : false; } },
    { id: "decMore", label: T.decMore, html: txtIco(".00→"), run: function () { stepDecimals(1); }, edit: true, pri: 3, on: function (cx) { return cx.num ? "bar" : false; } },
    { id: "cur", label: T.currency, html: txtIco(L === "hu" ? "Ft" : "$"), run: function () { toggleNum(CUR_FMT); }, edit: true, pri: 3, on: function (cx) { return cx.num ? "bar" : false; },
      pressed: function () { return curFmt().num === CUR_FMT; } },
    { id: "pct", label: T.nPercent, html: txtIco("%"), run: function () { toggleNum("0%"); }, edit: true, pri: 3, on: function (cx) { return cx.num ? "bar" : false; },
      pressed: function () { return curFmt().num === "0%"; } },
    "|",
    { id: "dd", label: T.dropdown, html: ico("dropdown"), run: function () { dropdownDlg(); }, edit: true, pri: 3, on: function (cx) { return cx.empty ? "bar" : cx.dd ? false : "more"; } },
    { id: "ddOpts", label: T.ddOptions, html: ico("dropdown") + "<span></span>", text: T.ddOptions, run: function () { dropdownDlg(); }, edit: true, pri: 3, on: function (cx) { return cx.dd ? "bar" : false; } },
    { id: "check", label: T.checkbox, html: ico("checkbox"), run: function () { toggleFmt("check"); }, edit: true, pri: 3, on: function (cx) { return cx.empty ? "bar" : cx.check ? false : "more"; } },
    { id: "ckTick", label: T.ckTick, html: '<span class="sh-ico sh-ckb"></span>', run: function () { toggleChecks(selR()); }, edit: true, pri: 3, on: function (cx) { return cx.check ? "bar" : false; },
      pressed: function (cx) { return cx.on; } },
    { id: "ckOff", label: T.ckRemove, html: ico("checkbox"), run: function () { toggleFmt("check"); }, edit: true, pri: 7, on: function (cx) { return cx.check ? "more" : false; } },
    { id: "date", label: T.dateToday, html: ico("date"), run: function () { insertDate(); }, edit: true, pri: 3, on: function (cx) { return cx.empty ? "bar" : false; } },
    { id: "fix", label: T.fixAsk, html: kit.icon("sparkle") + "<span></span>", text: T.fixAsk, run: function () { var e = selErrs(); askFix(e, e.length); }, edit: "ask", pri: 3,
      on: function (cx) { return cx.err && canFix() ? "bar" : false; } },
    "|",
    { id: "ins", label: T.insert, html: ico("rows") + CARET, run: function (e, b) { insMenu(b); }, edit: true, pri: 8, menu: true },
    { id: "sort", label: T.sort, html: ico("sort") + CARET, run: function (e, b) { sortMenu(b); }, edit: true, pri: 8, menu: true },
    { id: "freeze", label: T.freeze, html: ico("freeze") + CARET, run: function (e, b) { freezeMenu(b); }, edit: true, pri: 8, menu: true },
    { id: "chart", label: T.chart, html: ico("chart") + CARET, run: function (e, b) { chartMenu(b); }, edit: true, pri: 6, menu: true },
    { id: "filter", label: T.filter, html: ico("filter") + CARET, run: function (e, b) { filterMenu(b); }, edit: false, pri: 7, menu: true },
    { id: "rules", label: T.rules, html: ico("rules"), run: function () { commitIfEditing(); uiCall("openRules"); }, edit: true, pri: 7,
      on: function () { return typeof sheetUI().openRules === "function" ? "bar" : false; } },
    "|",
    { id: "comment", label: T.comment, html: kit.icon("comment"), run: function () { commitIfEditing(); commentSel(); }, edit: "comment", pri: 9 },
    { id: "ask", label: T.ask, html: kit.icon("sparkle"), run: function () { askSel(); }, edit: "ask", pri: 4 },
    "gap",
    { id: "find", label: T.find + " (Ctrl+F)", html: ico("search"), run: function () { openFind(); }, edit: false, pri: 2 },
    { id: "view", label: T.view, html: '<span class="sh-ico sh-txt sh-zoom"></span>' + CARET, run: function (e, b) { viewPop(b); }, edit: false, pri: 4, menu: true },
    { id: "hist", label: T.hist, html: kit.icon("history"), run: function (e, b) { openHistory(b); }, edit: "hist", pri: 9, menu: true },
    { id: "imp", label: T.imp, html: ico("upload"), run: function (e, b) { impMenu(b); }, edit: true, pri: 9, menu: true },
    { id: "exp", label: T.exp, html: kit.icon("download") + "<span></span>", text: T.exp, run: function (e, b) { expMenu(b); }, edit: false, pri: 4, menu: true }
  ];
  var toolEls = {}, tools = [], moreBtn = null, barSig = "", barOver = [], barTight = false;
  function hasTool(t) {
    return t.edit === "comment" ? canComment && live : t.edit === "ask" ? live && !!hm.sheet.ask : t.edit === "hist" ? live && !!hm.sheet.history : t.edit ? editable : true;
  }
  if (!C.thumb) {
    TOOLS.forEach(function (t) {
      if (t === "|") { var sp = h("span", { "class": "sh-sep" }); bar.appendChild(sp); return tools.push({ sep: sp }); }
      if (t === "gap") { bar.appendChild(h("span", { "class": "sh-gap" })); bar.appendChild(status); return tools.push({ gap: true }); }
      if (!hasTool(t)) return;
      t.el = barBtn(t.label, t.html, t.run);
      if (t.text) kit.labelled(t.el, t.text);
      if (t.pressed) t.el.setAttribute("aria-pressed", "false");
      if (t.menu) t.el.setAttribute("aria-haspopup", "true");
      toolEls[t.id] = t.el; bar.appendChild(t.el); tools.push(t);
    });
    moreBtn = barBtn(T.more, kit.icon("more"), function (e, b) {
      kit.menu(b, barOver.map(function (t) {
        var on = t.pressed ? t.pressed(ctxOf()) : false;
        return { label: (on ? "✓ " : "") + t.label.replace(/ \(Ctrl\+.\)$/, ""), onClick: function () { t.run(null, t.menu ? b : t.el); } };
      }));
    });
    moreBtn.setAttribute("aria-haspopup", "true");
    bar.appendChild(moreBtn);
    if (!live) setStatus(T.offline);
    foot.append(tabsEl);
    if (editable) foot.appendChild(barBtn(T.addSheet, kit.icon("plus"), function () { addSheet(); }, "sh-addtab"));
    foot.appendChild(statsEl);
    kit.exports(exportList);
    if (window.ResizeObserver) new ResizeObserver(function () { barSync(true); }).observe(bar);
    else window.addEventListener("resize", function () { barSync(true); });
  }
  // Lay the bar out for the selection: the tools it brings, as many as fit by priority, the rest under More.
  function barSync(force) {
    if (C.thumb || !moreBtn) return;
    var cx = ctxOf(), zl = toolEls.view && toolEls.view.querySelector(".sh-zoom"), W = bar.clientWidth;
    var sig = [W, ro() ? 1 : 0, cx.dd, cx.check, cx.num, cx.empty, cx.err && canFix(), cx.merged, Object.keys(sheetUI()).join(",")].join("|");
    if (zl && zl.textContent !== prefs.zoom + "%") { zl.textContent = prefs.zoom + "%"; toolEls.view.w = 0; force = true; }
    tools.forEach(function (t) { if (t.el && t.pressed) { var p = t.pressed(cx) ? "true" : "false"; if (t.el.getAttribute("aria-pressed") !== p) t.el.setAttribute("aria-pressed", p); } });
    if (!force && sig === barSig) return;
    barSig = sig;
    var list = tools.filter(function (t) { return t.el; }), onBar = [];
    // a short bar drops the buttons' text labels; their widths are measured again then
    if (W < 700 !== barTight) { barTight = W < 700; bar.classList.toggle("sh-tight", barTight); list.forEach(function (t) { t.el.w = 0; }); }
    list.forEach(function (t) {
      t.where = preview && t.edit && t.edit !== "hist" ? false : t.on ? t.on(cx) : "bar";
      if (t.where === "bar") { t.el.classList.remove("sh-off"); onBar.push(t); } else t.el.classList.add("sh-off");
    });
    tools.forEach(function (t) { if (t.sep) t.sep.classList.remove("sh-off"); });
    moreBtn.classList.remove("sh-off");
    // widths, measured once each while shown (a hidden button has none)
    onBar.forEach(function (t) { if (!t.el.w) t.el.w = t.el.offsetWidth; });
    if (!moreBtn.w) moreBtn.w = moreBtn.offsetWidth;
    var seps = tools.filter(function (t) { return t.sep; }).length;
    var room = W - 16 - moreBtn.w - 2 - Math.min(status.scrollWidth, 90) - 6 - seps * 11;
    var need = 0, byPri = onBar.slice().sort(function (a, b) { return b.pri - a.pri || list.indexOf(b) - list.indexOf(a); });
    onBar.forEach(function (t) { need += t.el.w + 2; });
    barOver = [];
    for (var i = 0; i < byPri.length && need > room; i++) {
      if (byPri[i].pri <= 1) break;  // the essentials stay: the status text gives way first
      byPri[i].el.classList.add("sh-off"); byPri[i].where = "over"; need -= byPri[i].el.w + 2;
    }
    barOver = list.filter(function (t) { return t.where === "over" || t.where === "more"; });
    // a separator stands between two shown groups only
    var seen1 = false, pend1 = null;
    tools.forEach(function (t) {
      if (t.gap) { if (pend1) pend1.classList.add("sh-off"); pend1 = null; seen1 = false; return; }
      if (t.sep) { if (!seen1 || pend1) t.sep.classList.add("sh-off"); else pend1 = t.sep; return; }
      if (t.el && !t.el.classList.contains("sh-off")) { seen1 = true; pend1 = null; }
    });
    if (pend1) pend1.classList.add("sh-off");
    moreBtn.classList.toggle("sh-off", !barOver.length);
  }
  // After the selection or the sheet changed: the bar, the error bubble.
  function uiSync() { if (C.thumb) return; barSync(false); errSync(); }
  function drawUndo() {
    if (toolEls.undo) toolEls.undo.disabled = !undoS.length;
    if (toolEls.redo) toolEls.redo.disabled = !redoS.length;
  }
  if (!C.thumb) { applyMetrics(); if (prefs.theme !== "auto") applyTheme(); setTimeout(errToast, 700); }
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
    if (!ro()) items.push({ label: T.chart + "…", onClick: function () { chartMenu(a.isConnected ? a : grid); } },
      { label: T.dropdown + "…", onClick: dropdownDlg }, { label: T.checkbox, onClick: function () { toggleFmt("check"); } },
      { label: T.cfTitle + "…", onClick: function () { openRules(); } }, { label: T.borders + "…", onClick: function () { openBorders(null); } },
      canUnmerge() ? { label: T.unmerge, onClick: unmergeSel } : { label: T.merge, onClick: mergeSel });
    if (!preview) items.push({ label: T.fltCol, onClick: filterHere });
    if (canComment && live) items.push({ label: T.comment, onClick: commentSel });
    if (live && hm.sheet.ask) items.push({ label: T.ask, onClick: askSel });
    kit.menu(a, items);
  }

  // ==================================================================== merged cells, borders, conditional formatting, dropdown colours
  // One block. The grid's own functions call into it (renderQ, the selection, applyLocal); its commands
  // are on window.__sheetUI for the toolbar: openRules(), openBorders(anchor), mergeSel(), unmergeSel(), canUnmerge().
  var T2 = pickLang({
    en: { cfTitle: "Conditional formatting", borders: "Borders", merge: "Merge cells", unmerge: "Unmerge cells",
      mergeNeeds: "Select two or more cells to merge",
      bAll: "All borders", bInner: "Inner borders", bHorizontal: "Horizontal inner borders", bVertical: "Vertical inner borders", bOuter: "Outer border",
      bLeft: "Left border", bTop: "Top border", bRight: "Right border", bBottom: "Bottom border", bNone: "No borders",
      cfAdd: "Add rule", cfNone: "No rules on this sheet yet. A rule colours the cells that meet a condition.", cfHighlight: "Highlight", cfScale: "Colour scale",
      cfApplies: "Applies to", cfUseSel: "Use the selection", cfWhen: "Format cells if the value", cfAndCol: "And", cfAddAnd: "+ And another column",
      cfNoAnd: "Remove the second condition", cfFormat: "Format", cfFill: "Fill", cfText: "Text", cfBold: "Bold", cfStrike: "Strikethrough", cfNoColor: "None",
      cfLow: "Low", cfMid: "Midpoint", cfHigh: "High", cfSave: "Save", cfDelete: "Delete rule", cfRules: "Rules", cfSample: "Sample 123",
      cfBadRange: "Enter a range like C2:C20", cfBadFormula: "Enter a formula like =C2>10", cfNeedsValue: "Enter a value to compare with",
      cfNoFormat: "Pick a format", cfMax: "A sheet holds at most 50 rules", cfCell: "Cell", cfAndWord: "and", cfValue: "Value", cfTo: "and", cfFormula: "Formula",
      opIs: "is", opNot: "is not", opGt: "is greater than", opLt: "is less than", opBetween: "is between", opContains: "contains", opBlank: "is blank",
      opFilled: "is not blank", opBefore: "is before today", opAfter: "is after today", opCustom: "Custom formula",
      fRed: "Red", fOrange: "Orange", fGreen: "Green", fBlue: "Blue",
      ddOpt: "Option", ddAdd: "Add option", ddPresets: "Presets", ddRename: "Name", ddColor: "Colour", ddNoColor: "No colour", ddDelOpt: "Delete option", ddNewPh: "New option",
      pStatus: "Status", pPriority: "Priority", pYesNo: "Yes / No", pApproval: "Approval",
      pTodo: "To do", pDoing: "In progress", pDone: "Done", pLow: "Low", pMedium: "Medium", pHigh: "High", pYes: "Yes", pNo: "No",
      pPending: "Pending", pApproved: "Approved", pRejected: "Rejected",
      c_gray: "Gray", c_red: "Red", c_orange: "Orange", c_yellow: "Yellow", c_green: "Green", c_teal: "Teal", c_blue: "Blue", c_purple: "Purple", c_magenta: "Magenta" },
    hu: { cfTitle: "Feltételes formázás", borders: "Szegélyek", merge: "Cellák egyesítése", unmerge: "Egyesítés megszüntetése",
      mergeNeeds: "Az egyesítéshez jelölj ki legalább két cellát",
      bAll: "Minden szegély", bInner: "Belső szegélyek", bHorizontal: "Vízszintes belső szegélyek", bVertical: "Függőleges belső szegélyek", bOuter: "Külső szegély",
      bLeft: "Bal szegély", bTop: "Felső szegély", bRight: "Jobb szegély", bBottom: "Alsó szegély", bNone: "Nincs szegély",
      cfAdd: "Új szabály", cfNone: "Ezen a munkalapon még nincs szabály. Egy szabály kiszínezi a feltételnek megfelelő cellákat.", cfHighlight: "Kiemelés", cfScale: "Színskála",
      cfApplies: "Tartomány", cfUseSel: "A kijelölés használata", cfWhen: "Formázás, ha az érték", cfAndCol: "És", cfAddAnd: "+ És egy másik oszlop",
      cfNoAnd: "Második feltétel törlése", cfFormat: "Formátum", cfFill: "Kitöltés", cfText: "Szöveg", cfBold: "Félkövér", cfStrike: "Áthúzott", cfNoColor: "Nincs",
      cfLow: "Alsó", cfMid: "Középpont", cfHigh: "Felső", cfSave: "Mentés", cfDelete: "Szabály törlése", cfRules: "Szabályok", cfSample: "Minta 123",
      cfBadRange: "Adj meg egy tartományt, például C2:C20", cfBadFormula: "Adj meg egy képletet, például =C2>10", cfNeedsValue: "Adj meg egy értéket az összehasonlításhoz",
      cfNoFormat: "Válassz formátumot", cfMax: "Egy munkalapon legfeljebb 50 szabály lehet", cfCell: "Cella", cfAndWord: "és", cfValue: "Érték", cfTo: "és", cfFormula: "Képlet",
      opIs: "egyenlő", opNot: "nem egyenlő", opGt: "nagyobb, mint", opLt: "kisebb, mint", opBetween: "a két érték között van", opContains: "tartalmazza", opBlank: "üres",
      opFilled: "nem üres", opBefore: "a mai nap előtti", opAfter: "a mai nap utáni", opCustom: "Egyéni képlet",
      fRed: "Piros", fOrange: "Narancs", fGreen: "Zöld", fBlue: "Kék",
      ddOpt: "Elem", ddAdd: "Új elem", ddPresets: "Kész listák", ddRename: "Név", ddColor: "Szín", ddNoColor: "Nincs szín", ddDelOpt: "Elem törlése", ddNewPh: "Új elem",
      pStatus: "Állapot", pPriority: "Prioritás", pYesNo: "Igen / Nem", pApproval: "Jóváhagyás",
      pTodo: "Teendő", pDoing: "Folyamatban", pDone: "Kész", pLow: "Alacsony", pMedium: "Közepes", pHigh: "Magas", pYes: "Igen", pNo: "Nem",
      pPending: "Függőben", pApproved: "Jóváhagyva", pRejected: "Elutasítva",
      c_gray: "Szürke", c_red: "Piros", c_orange: "Narancs", c_yellow: "Sárga", c_green: "Zöld", c_teal: "Türkiz", c_blue: "Kék", c_purple: "Lila", c_magenta: "Magenta" }
  }, L);
  Object.keys(T2).forEach(function (k) { if (T[k] == null) T[k] = T2[k]; });

  // ---- merges
  // s.merges: ranges ("A1:C1"); a merged cell holds content in its top-left cell only, and is one cell
  // to the selection, the keyboard and the editor. The boxes are parsed once for each list.
  function mgBoxes(s) {
    var m = s._mg;
    if (!m || m.src !== s.merges) m = s._mg = { src: s.merges, boxes: (s.merges || []).map(parseRange).filter(Boolean) };
    return m.boxes;
  }
  function mergeAt(s, r, c) {
    if (!s.merges || !s.merges.length) return null;
    for (var b = mgBoxes(s), i = 0; i < b.length; i++) if (r >= b[i].r1 && r <= b[i].r2 && c >= b[i].c1 && c <= b[i].c2) return b[i];
    return null;
  }
  function covered(s, r, c) { var m = mergeAt(s, r, c); return !!m && (m.r1 !== r || m.c1 !== c); }
  function mgTouch(b, R) { return !(b.r2 < R.r1 || b.r1 > R.r2 || b.c2 < R.c1 || b.c1 > R.c2); }
  // The merged cells a pane's window shows (rr: places, cc: columns), or null.
  function mgIn(s, rr, cc) {
    if (!s.merges || !s.merges.length) return null;
    var W = { r1: rowOf(rr[0]), r2: rowOf(rr[1]), c1: cc[0], c2: cc[1] }, out = null;
    for (var b = mgBoxes(s), i = 0; i < b.length; i++) if (mgTouch(b[i], W)) (out = out || []).push(b[i]);
    return out;
  }
  function mgHit(vm, r, c) {
    for (var i = 0; i < vm.length; i++) if (r >= vm[i].r1 && r <= vm[i].r2 && c >= vm[i].c1 && c <= vm[i].c2) return vm[i];
    return null;
  }
  // A cell's box in viewport pixels, the whole merged cell when it is one.
  function mBox(r, c) {
    var m = mergeAt(S(), r, c);
    if (!m) return cellBox(r, c);
    var b = cellBox(m.r1, m.c1);
    b.w = colX[Math.min(m.c2 + 1, nCols)] - colX[m.c1]; b.h = rowY(m.r2 + 1) - rowY(m.r1);
    return b;
  }
  // The selection after any change: the active cell is a merged cell's top-left one, and the selection
  // holds the whole of every merged cell it reaches into.
  function snapSel() {
    var s = S();
    if (rpOn) rpSync();
    if (!s.merges || !s.merges.length || selMode !== "cells") return;
    var m = mergeAt(s, sr, sc), one = sr === er && sc === ec;
    if (m) { sr = m.r1; sc = m.c1; if (one) { er = m.r2; ec = m.c2; } }
    var R = { r1: Math.min(sr, er), c1: Math.min(sc, ec), r2: Math.max(sr, er), c2: Math.max(sc, ec) }, b = mgBoxes(s), grew = true, any = false;
    while (grew) {
      grew = false;
      for (var i = 0; i < b.length; i++) {
        var x = b[i];
        if (!mgTouch(x, R)) continue;
        if (x.r1 < R.r1) { R.r1 = x.r1; grew = true; } if (x.r2 > R.r2) { R.r2 = x.r2; grew = true; }
        if (x.c1 < R.c1) { R.c1 = x.c1; grew = true; } if (x.c2 > R.c2) { R.c2 = x.c2; grew = true; }
      }
      any = any || grew;
    }
    if (!any) return;
    var top = sr === R.r1, left = sc === R.c1, bottom = sr === R.r2, right = sc === R.c2;
    if ((top || bottom) && (left || right)) { er = top ? R.r2 : R.r1; ec = left ? R.c2 : R.c1; }
    else { sr = R.r1; sc = R.c1; er = R.r2; ec = R.c2; }  // the anchor is no corner any more: the top-left cell is
  }
  // One step from a cell, leaving the merged cell it is in by the side the step points to.
  function stepOut(r, c, dr, dc) {
    var m = mergeAt(S(), r, c);
    if (m) { if (dr > 0) r = m.r2; else if (dr < 0) r = m.r1; if (dc > 0) c = m.c2; else if (dc < 0) c = m.c1; }
    return [dr ? stepRow(r, dr) : r, c + dc];
  }
  function mgApply(s, R) {
    var keep = s.merges.filter(function (m) { var b = parseRange(m); return !b || !(b.r1 >= R.r1 && b.r2 <= R.r2 && b.c1 >= R.c1 && b.c2 <= R.c2); });
    for (var k in s.cells) {
      var p = parseKey(k);
      if (p && inR(R, p.r, p.c) && (p.r !== R.r1 || p.c !== R.c1)) { delete s.cells[k]; delete s.vals[k]; touch(s, k); usedAfter(s, p.r, p.c, false); }
    }
    s.merges = keep.concat([rangeName(R)]);
  }
  function selBox() { var R = selR(); return { r1: R.r1, c1: R.c1, r2: Math.min(R.r2, MAXR - 1), c2: Math.min(R.c2, MAXC - 1) }; }
  function canUnmerge() { var s = S(), R = selR(); return !!(s.merges && s.merges.length) && mgBoxes(s).some(function (b) { return mgTouch(b, R); }); }
  // Merge the selection: the top-left cell's content stays, the rest is emptied (undo brings it back).
  function mergeSel() {
    commitIfEditing();
    if (ro()) return;
    var s = S(), R = selBox();
    if (selMode !== "cells" || area(R) < 2 || area(R) > 200000) return kit.toast(T.mergeNeeds);
    var inside = s.merges.filter(function (m) { var b = parseRange(m); return b && mgTouch(b, R); }), old = oldMatrix(s, R);
    if (inside.length === 1 && inside[0] === rangeName(R)) return;
    var inv = old ? [{ op: "unmerge", range: rangeName(R) }, { op: "set", range: key(R.r1, R.c1), values: old }].concat(inside.map(function (m) { return { op: "merge", range: m }; })) : null;
    doEdit(s, [{ op: "merge", range: rangeName(R) }], inv);
    sr = R.r1; sc = R.c1; er = R.r2; ec = R.c2; afterSel();
  }
  function unmergeSel() {
    commitIfEditing();
    if (ro()) return;
    var s = S(), R = selBox(), hitM = s.merges.filter(function (m) { var b = parseRange(m); return b && mgTouch(b, R); });
    if (!hitM.length) return;
    doEdit(s, [{ op: "unmerge", range: rangeName(R) }], hitM.map(function (m) { return { op: "merge", range: m }; }));
    afterSel();
  }

  // ---- borders
  // fmt.bd: the edges a cell draws, of "tblr" (thin, in the theme's line colour). A cell's right and
  // bottom lines are its own box's; its top and left ones are drawn by the cells above and to the
  // left (as their bottom and right), so two cells sharing a line draw it once.
  function hasBd(s) {
    if (s._bd === undefined) { s._bd = false; for (var k in s.fmt) if (s.fmt[k].bd) { s._bd = true; break; } }
    return s._bd;
  }
  function bdOf(s, r, c) { var f = r >= 0 && c >= 0 ? s.fmt[key(r, c)] : null; return f && f.bd || ""; }
  function bdCss(s, mg, r, c) {
    var r1 = mg ? mg.r1 : r, c1 = mg ? mg.c1 : c, r2 = mg ? mg.r2 : r, c2 = mg ? mg.c2 : c, own = bdOf(s, r1, c1), css = "", sh = "";
    if ((mg ? bdOf(s, r1, c2) : own).indexOf("r") >= 0 || bdOf(s, r1, c2 + 1).indexOf("l") >= 0) css += "border-right-color:var(--sh-bd);";
    if ((mg ? bdOf(s, r2, c1) : own).indexOf("b") >= 0 || bdOf(s, r2 + 1, c1).indexOf("t") >= 0) css += "border-bottom-color:var(--sh-bd);";
    if (r1 === 0 && own.indexOf("t") >= 0) sh = "inset 0 1px 0 var(--sh-bd)";
    if (c1 === 0 && own.indexOf("l") >= 0) sh += (sh ? "," : "") + "inset 1px 0 0 var(--sh-bd)";
    return sh ? css + "box-shadow:" + sh + ";" : css;
  }
  // A range's border preset as the edges of its cells, as the server resolves it (sheets.py _apply_border).
  function bdLocal(fmt, kind, R) {
    function put(r, c, add, drop) {
      if (r < 0 || c < 0 || r >= MAXR || c >= MAXC) return;
      var k = key(r, c), f = fmt[k], have = f && f.bd || "", bd = "";
      for (var i = 0; i < 4; i++) { var ch = "tblr".charAt(i); if ((have.indexOf(ch) >= 0 || add.indexOf(ch) >= 0) && drop.indexOf(ch) < 0) bd += ch; }
      if (bd === have) return;
      if (!f) f = fmt[k] = {};
      if (bd) f.bd = bd; else { delete f.bd; if (!Object.keys(f).length) delete fmt[k]; }
    }
    var r, c;
    if (kind === "none") {
      for (r = R.r1; r <= R.r2; r++) { for (c = R.c1; c <= R.c2; c++) put(r, c, "", "tblr"); put(r, R.c1 - 1, "", "r"); put(r, R.c2 + 1, "", "l"); }
      for (c = R.c1; c <= R.c2; c++) { put(R.r1 - 1, c, "", "b"); put(R.r2 + 1, c, "", "t"); }
      return;
    }
    for (r = R.r1; r <= R.r2; r++) for (c = R.c1; c <= R.c2; c++) {
      var e = "";
      if (kind === "all") e = "tblr";
      else if (kind === "inner" || kind === "horizontal" || kind === "vertical")
        e = (kind !== "vertical" ? (r > R.r1 ? "t" : "") + (r < R.r2 ? "b" : "") : "") + (kind !== "horizontal" ? (c > R.c1 ? "l" : "") + (c < R.c2 ? "r" : "") : "");
      else e = ((kind === "outer" || kind === "top") && r === R.r1 ? "t" : "") + ((kind === "outer" || kind === "bottom") && r === R.r2 ? "b" : "") +
        ((kind === "outer" || kind === "left") && c === R.c1 ? "l" : "") + ((kind === "outer" || kind === "right") && c === R.c2 ? "r" : "");
      if (e) put(r, c, e, "");
    }
  }
  var BD_KINDS = [["all", "bAll"], ["inner", "bInner"], ["horizontal", "bHorizontal"], ["vertical", "bVertical"], ["outer", "bOuter"],
    ["left", "bLeft"], ["top", "bTop"], ["right", "bRight"], ["bottom", "bBottom"], ["none", "bNone"]];
  var BD_PATH = { all: "M3 3h18v18H3zM12 3v18M3 12h18", inner: "M12 3v18M3 12h18", horizontal: "M3 12h18", vertical: "M12 3v18", outer: "M3 3h18v18H3z",
    left: "M3 3v18", top: "M3 3h18", right: "M21 3v18", bottom: "M3 21h18", none: "" };
  function bdIcon(kind) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 3h18v18H3zM12 3v18M3 12h18" stroke-width="1" stroke-dasharray="1.5 2.6" opacity=".5"/>' +
      (BD_PATH[kind] ? '<path d="' + BD_PATH[kind] + '" stroke-width="2" stroke-linecap="square"/>' : "") + "</svg>";
  }
  function setBorder(kind) {
    commitIfEditing();
    if (ro()) return;
    var s = S(), R = selBox();
    // "none" also takes the facing edges of the cells around: undo brings those back too
    var G = kind === "none" ? { r1: Math.max(0, R.r1 - 1), c1: Math.max(0, R.c1 - 1), r2: Math.min(MAXR - 1, R.r2 + 1), c2: Math.min(MAXC - 1, R.c2 + 1) } : R;
    doEdit(s, [{ op: "format", range: rangeName(R), border: kind }], invFmt(s, G, ["bd"]));
  }
  // The borders popover: ten presets over the selection. anchor: the toolbar's button, or none (then by the active cell).
  function openBorders(anchor) {
    commitIfEditing();
    if (ro()) return;
    var el = h("div", { "class": "sh-pop sh-bdp", role: "dialog", "aria-label": T.borders });
    BD_KINDS.forEach(function (x) {
      el.appendChild(h("button", { type: "button", title: T[x[1]], "aria-label": T[x[1]], html: bdIcon(x[0]), onclick: function () { closePop(); setBorder(x[0]); grid.focus(); } }));
    });
    el.addEventListener("mousedown", function (e) { e.preventDefault(); });
    openPop(el, anchor && anchor.getBoundingClientRect ? anchor : null);
    if (!anchor || !anchor.getBoundingClientRect) popAtCell(el);
    var first = el.querySelector("button");
    if (first) first.focus();
  }
  function popAtCell(el) {
    var b = mBox(sr, sc), vr = vp.getBoundingClientRect(), top = vr.top + b.y + b.h + 4;
    el.style.left = Math.max(8, Math.min(vr.left + b.x, innerWidth - el.offsetWidth - 8)) + "px";
    el.style.top = Math.max(8, top + el.offsetHeight > innerHeight - 8 ? vr.top + b.y - el.offsetHeight - 4 : top) + "px";
  }

  // ---- conditional formatting
  // s.rules: [{range, if: "=formula", bg, fg, bold, strike} | {range, scale: [low, (mid,) high]}]. A rule's formula is
  // written for its range's top-left cell and shifted for the others; later rules win, and all win over the
  // cell's own format. Only the cells drawn are computed, and kept until a value changes (cfGen).
  function cfState(s) {
    var st = s._cf;
    if (!st || st.src !== s.rules) {
      st = s._cf = { src: s.rules, gen: -1, cache: null, rules: [] };
      s.rules.forEach(function (r) { var R = r && parseRange(r.range); if (R) st.rules.push({ R: R, rule: r, stat: null }); });
    }
    if (st.gen !== cfGen) { st.gen = cfGen; st.cache = Object.create(null); st.rules.forEach(function (x) { x.stat = null; }); }
    return st;
  }
  // What the rules give a cell: {bg, fg, bold, strike} or null.
  function cfAt(s, r, c, k) {
    var st = cfState(s), hitC = st.cache[k];
    if (hitC !== undefined) return hitC || null;
    var out = null;
    for (var i = 0; i < st.rules.length; i++) {
      var x = st.rules[i], ru = x.rule;
      if (!inR(x.R, r, c)) continue;
      if (ru.scale) { var col = cfScaleAt(s, x, k); if (col) (out = out || {}).bg = col; }
      else if (cfTrue(s, x, r, c, k)) {
        out = out || {};
        if (ru.bg) out.bg = ru.bg; if (ru.fg) out.fg = ru.fg; if (ru.bold) out.bold = true; if (ru.strike) out.strike = true;
      }
    }
    st.cache[k] = out || 0;
    return out;
  }
  function cfMix(f, x) {
    if (!x) return f;
    var o = {}, k;
    for (k in f || {}) o[k] = f[k];
    for (k in x) o[k] = x[k];
    return o;
  }
  function cfTrue(s, x, r, c, k) {
    if (!wb || !wb.evalAt) return false;
    var f = x.rule["if"], dr = r - x.R.r1, dc = c - x.R.c1, v;
    try { v = wb.evalAt(s.name, k, dr || dc ? shift(f, dr, dc) : f); } catch (e) { return false; }
    return v === true || typeof v === "number" && v !== 0;
  }
  function cfNum(v) { return typeof v === "number" ? v : isDate(v) && F && F.toSerial ? F.toSerial(v) : null; }
  // The lowest, middle and highest number of a colour scale's range.
  function cfStat(s, x) {
    if (x.stat) return x.stat;
    var xs = [], R = x.R, k, p, n;
    for (k in s.cells) { p = parseKey(k); if (p && inR(R, p.r, p.c)) { n = cfNum(valueOf(s, k)); if (n !== null) xs.push(n); } }
    xs.sort(function (a, b) { return a - b; });
    var h2 = xs.length >> 1;
    return (x.stat = xs.length ? { lo: xs[0], hi: xs[xs.length - 1], mid: xs.length % 2 ? xs[h2] : (xs[h2 - 1] + xs[h2]) / 2 } : { none: true });
  }
  function hexMix(a, b, t) {
    var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16), out = "#";
    t = clamp(t, 0, 1);
    for (var sft = 16; sft >= 0; sft -= 8) { var v = Math.round((x >> sft & 255) + ((y >> sft & 255) - (x >> sft & 255)) * t).toString(16); out += v.length < 2 ? "0" + v : v; }
    return out;
  }
  function cfScaleAt(s, x, k) {
    var n = cfNum(valueOf(s, k)), cs = x.rule.scale;
    if (n === null) return null;
    var st = cfStat(s, x);
    if (st.none) return null;
    if (st.hi === st.lo) return cs[0];
    if (cs.length === 2) return hexMix(cs[0], cs[1], (n - st.lo) / (st.hi - st.lo));
    return n <= st.mid ? hexMix(cs[0], cs[1], st.mid === st.lo ? 1 : (n - st.lo) / (st.mid - st.lo)) : hexMix(cs[1], cs[2], st.hi === st.mid ? 1 : (n - st.mid) / (st.hi - st.mid));
  }

  // A condition of the builder <-> the formula it stands for. ref: "C3" (the range's first cell) or "$D3" (another column of the row).
  var CF_OPS = ["is", "not", "gt", "lt", "between", "contains", "blank", "filled", "before", "after"];
  var CF_OPT = { is: "opIs", not: "opNot", gt: "opGt", lt: "opLt", between: "opBetween", contains: "opContains", blank: "opBlank", filled: "opFilled", before: "opBefore", after: "opAfter", custom: "opCustom" };
  var CF_ARGS = { is: 1, not: 1, gt: 1, lt: 1, between: 2, contains: 1, blank: 0, filled: 0, before: 0, after: 0 };
  function cfQuote(t) { return '"' + String(t).replace(/"/g, '""') + '"'; }
  function cfLit(t) {
    var p = parseText(String(t).trim()).value;
    return typeof p === "number" ? String(p) : typeof p === "boolean" ? (p ? "TRUE" : "FALSE") : cfQuote(p);
  }
  function cfCond(ref, op, a, b) {
    switch (op) {
      case "is": return ref + "=" + cfLit(a);
      case "not": return ref + "<>" + cfLit(a);
      case "gt": return ref + ">" + cfLit(a);
      case "lt": return "AND(" + ref + '<>"",' + ref + "<" + cfLit(a) + ")";  // an empty cell is not "less than"
      case "between": return "AND(" + ref + ">=" + cfLit(a) + "," + ref + "<=" + cfLit(b) + ")";
      case "contains": return "ISNUMBER(SEARCH(" + cfQuote(String(a).trim()) + "," + ref + "))";
      case "blank": return ref + '=""';
      case "filled": return ref + '<>""';
      case "before": return "AND(" + ref + '<>"",' + ref + "<TODAY())";
      case "after": return ref + ">TODAY()";
    }
    return "FALSE";
  }
  var CF_REF = "(\\$?[A-Z]{1,3}\\$?[0-9]+)", CF_LIT = '("(?:[^"]|"")*"|-?[0-9]+(?:\\.[0-9]+)?|TRUE|FALSE)';
  var CF_RE = [
    ["before", new RegExp("^AND\\(" + CF_REF + '<>"",\\1<TODAY\\(\\)\\)$')], ["after", new RegExp("^" + CF_REF + ">TODAY\\(\\)$")],
    ["lt", new RegExp("^AND\\(" + CF_REF + '<>"",\\1<' + CF_LIT + "\\)$")], ["between", new RegExp("^AND\\(" + CF_REF + ">=" + CF_LIT + ",\\1<=" + CF_LIT + "\\)$")],
    ["contains", new RegExp('^ISNUMBER\\(SEARCH\\(("(?:[^"]|"")*"),' + CF_REF + "\\)\\)$")], ["blank", new RegExp("^" + CF_REF + '=""$')],
    ["filled", new RegExp("^" + CF_REF + '<>""$')], ["is", new RegExp("^" + CF_REF + "=" + CF_LIT + "$")], ["not", new RegExp("^" + CF_REF + "<>" + CF_LIT + "$")],
    ["gt", new RegExp("^" + CF_REF + ">" + CF_LIT + "$")],
    // as Hermes or a file writes them, without the guard against empty cells
    ["before", new RegExp("^" + CF_REF + "<TODAY\\(\\)$")], ["lt", new RegExp("^" + CF_REF + "<" + CF_LIT + "$")]];
  function cfUnlit(t) { return t.charAt(0) === '"' ? t.slice(1, -1).replace(/""/g, '"') : L === "hu" && /^-?[0-9]/.test(t) ? t.replace(".", ",") : t; }
  function cfCondParse(t) {
    for (var i = 0; i < CF_RE.length; i++) {
      var m = CF_RE[i][1].exec(t), op = CF_RE[i][0];
      if (!m) continue;
      if (op === "contains") return { ref: m[2], op: op, a: cfUnlit(m[1]), b: "" };
      return { ref: m[1], op: op, a: m[2] !== undefined ? cfUnlit(m[2]) : "", b: m[3] !== undefined ? cfUnlit(m[3]) : "" };
    }
    return null;
  }
  // A rule's formula as one or two conditions, or null (a formula of the user's own).
  function cfParse(f) {
    var t = String(f || "").slice(1), one = cfCondParse(t);
    if (one) return [one];
    if (!/^AND\(.*\)$/.test(t)) return null;
    var inner = t.slice(4, -1), depth = 0, q = false, cut = -1;
    for (var i = 0; i < inner.length; i++) {
      var ch = inner.charAt(i);
      if (ch === '"') q = !q;
      else if (q) continue;
      else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) { if (cut >= 0) return null; cut = i; }
    }
    if (cut < 0) return null;
    var a = cfCondParse(inner.slice(0, cut)), b = cfCondParse(inner.slice(cut + 1));
    return a && b ? [a, b] : null;
  }
  // What a column is called: its header's text (the row above the range, else the header row), else its letter.
  function cfColName(s, c, R) {
    var rows = [R.r1 - 1, hdrRow(s)];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] < 0 || rows[i] >= R.r1) continue;
      var v = valueOf(s, key(rows[i], c));
      if (typeof v === "string" && v.trim() && !isDate(v)) return v.trim().slice(0, 30);
    }
    return null;
  }
  // A rule in words: "Due is before today and Status is not “Done”".
  function cfTitleOf(s, rule) {
    if (rule.scale) return T.cfScale;
    var R = parseRange(rule.range), conds = cfParse(rule["if"]);
    if (!conds || !R) return String(rule["if"] || "");
    return conds.map(function (x) {
      var p = parseKey(x.ref), name = p && cfColName(s, p.c, R) || (p && R.c1 !== R.c2 || !p ? x.ref.replace(/\$/g, "") : T.cfCell);
      var n = CF_ARGS[x.op], word = T[CF_OPT[x.op]], txt = function (t) { return /^-?[0-9]/.test(t) || /^(TRUE|FALSE)$/.test(t) ? t : "“" + t + "”"; };
      return name + " " + word + (n ? " " + txt(x.a) + (n > 1 ? " " + T.cfTo + " " + txt(x.b) : "") : "");
    }).join(" " + T.cfAndWord + " ");
  }
  function cfSwatch(rule) {
    var st = "";
    if (rule.scale) st = "background:linear-gradient(90deg," + rule.scale.join(",") + ");color:transparent;";
    else {
      if (rule.bg) st += "background:" + rule.bg + ";color:" + (rule.fg || inkOn(rule.bg)) + ";"; else if (rule.fg) st += "color:" + rule.fg + ";";
      if (rule.bold) st += "font-weight:700;"; if (rule.strike) st += "text-decoration:line-through;";
    }
    return h("span", { "class": "sh-rc-sw", style: st, text: "Aa", "aria-hidden": "true" });
  }
  var CF_LOOKS = [["fRed", { bg: "#fde2e1", fg: "#b42318" }], ["fOrange", { bg: "#fdecc8", fg: "#9a5b00" }], ["fGreen", { bg: "#d3f9d8", fg: "#1b6e2d" }],
    ["fBlue", { bg: "#d0ebff", fg: "#1557a0" }], ["cfStrike", { fg: "#999999", strike: true }], ["cfBold", { bold: true }]];
  var CF_FILLS = ["#fde2e1", "#fdecc8", "#fff3bf", "#d3f9d8", "#d0ebff", "#e5dbff", "#efefef"];
  var CF_INKS = ["#b42318", "#9a5b00", "#1b6e2d", "#1557a0", "#7048e8", "#999999", "#000000"];
  var CF_SCALES = [["#ffffff", "#57bb8a"], ["#f8696b", "#ffeb84", "#63be7b"], ["#ffffff", "#e67c73"], ["#63be7b", "#ffeb84", "#f8696b"]];

  // The panel: docked at the right of the grid (over it when the page is narrow), a list of the sheet's rules, or one rule's editor.
  var rpEl = null, rpOn = false, rpSig = "", rpView = "list", rpTimer = null;
  function setRules(s, rules) { doEdit(s, [{ op: "rules", rules: rules }], [{ op: "rules", rules: s.rules }]); }
  function rpPlace() {
    if (!rpOn) return;
    var g = grid.getBoundingClientRect();
    rpEl.style.top = g.top + "px"; rpEl.style.height = g.height + "px";
  }
  function openRules() {
    commitIfEditing();
    if (C.thumb) return;
    if (!rpEl) {
      rpEl = h("aside", { "class": "sh-rp", "aria-label": T.cfTitle });
      document.body.appendChild(rpEl);
      rpEl.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); if (rpView === "edit") rpList(); else closeRules(); } });
      if (window.ResizeObserver) new ResizeObserver(rpPlace).observe(grid);
      window.addEventListener("resize", rpPlace);
    }
    rpOn = true; rpEl.hidden = false;
    document.documentElement.classList.add("sh-rp-on");
    rpList();
    rpPlace();
    clearInterval(rpTimer);
    rpTimer = setInterval(rpSync, 1200);  // Hermes or another window may change the rules
    var first = rpEl.querySelector(".sh-rc, .sh-rp-add");
    if (first) first.focus();
  }
  function closeRules() {
    if (!rpOn) return;
    rpOn = false; rpEl.hidden = true; clearInterval(rpTimer);
    document.documentElement.classList.remove("sh-rp-on");
    grid.focus();
  }
  // The list again when the sheet shown or its rules changed under it.
  function rpSync() {
    if (!rpOn || rpView !== "list") return;
    var s = S(), sig = s.id + "|" + (preview ? 1 : 0) + "|" + JSON.stringify(s.rules);
    if (sig !== rpSig) rpList();
  }
  function rpHead(title, back) {
    var x = h("button", { type: "button", "class": "sh-rp-x", title: T.close, "aria-label": T.close, html: kit.icon("close"), onclick: closeRules });
    var bk = back ? h("button", { type: "button", "class": "sh-rp-x", title: T.cfRules, "aria-label": T.cfRules, html: kit.icon("prev"), onclick: rpList }) : null;
    return h("div", { "class": "sh-rp-h" }, [bk, h("span", { text: title }), x]);
  }
  function rpList() {
    var s = S(), body = h("div", { "class": "sh-rp-b" });
    rpView = "list"; rpSig = s.id + "|" + (preview ? 1 : 0) + "|" + JSON.stringify(s.rules);
    rpEl.innerHTML = "";
    if (!s.rules.length) body.appendChild(h("p", { "class": "sh-rp-none", text: T.cfNone }));
    s.rules.forEach(function (rule, i) {
      var card = h("div", { "class": "sh-rc", role: "button", tabindex: "0" }, [cfSwatch(rule),
        h("span", { "class": "sh-rc-t" }, [h("b", { text: cfTitleOf(s, rule) }), h("small", { text: rule.range })])]);
      function open() { var R = parseRange(rule.range); if (R) { sr = R.r1; sc = R.c1; selMode = "cells"; select(Math.min(R.r2, MAXR - 1), R.c2, true); } if (!ro()) rpEdit(i); }
      card.addEventListener("click", open);
      card.addEventListener("keydown", function (e) { if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } });
      if (!ro()) card.appendChild(h("button", { type: "button", "class": "sh-rc-x", title: T.cfDelete, "aria-label": T.cfDelete, html: kit.icon("close"),
        onclick: function (e) { e.stopPropagation(); setRules(s, s.rules.filter(function (x, j) { return j !== i; })); rpList(); } }));
      body.appendChild(card);
    });
    rpEl.append(rpHead(T.cfTitle, false), body);
    if (!ro()) body.appendChild(h("button", { type: "button", "class": "sh-b sh-rp-add", text: "+ " + T.cfAdd, onclick: function () { rpEdit(-1); } }));
  }
  function rpField(label, kids) { return h("label", { "class": "sh-rp-f" }, [h("span", { text: label })].concat(kids)); }
  // One rule's editor (i: its place in the list, -1: a new one).
  function rpEdit(i) {
    var s = S(), old = i >= 0 ? s.rules[i] : null, R0 = old ? parseRange(old.range) : selBox();
    if (!old && s.rules.length >= 50) return kit.toast(T.cfMax);
    if (!old && selMode !== "cells") R0 = { r1: R0.r1, c1: R0.c1, r2: Math.max(R0.r1, Math.min(R0.r2, used(s).r)), c2: Math.max(R0.c1, Math.min(R0.c2, used(s).c)) };
    var conds = old && old["if"] ? cfParse(old["if"]) : null, first = R0 ? key(R0.r1, R0.c1) : "A1";
    // the builder holds a rule only when its conditions are about the range's first cell and (at most) one other column of that row
    if (conds && (conds[0].ref !== first || conds[1] && !/^\$[A-Z]+[0-9]+$/.test(conds[1].ref))) conds = null;
    var st = { kind: old && old.scale ? "scale" : "hl", op: old && old["if"] && !conds ? "custom" : conds ? conds[0].op : "gt", a: conds ? conds[0].a : "", b: conds ? conds[0].b : "",
      formula: old && old["if"] || "", and: conds && conds[1] ? { col: parseKey(conds[1].ref).c, op: conds[1].op, a: conds[1].a, b: conds[1].b } : null,
      look: old && !old.scale ? { bg: old.bg || null, fg: old.fg || null, bold: !!old.bold, strike: !!old.strike } : { bg: CF_LOOKS[0][1].bg, fg: CF_LOOKS[0][1].fg, bold: false, strike: false },
      scale: old && old.scale ? old.scale.slice() : CF_SCALES[0].slice() };
    rpView = "edit";
    var body = h("div", { "class": "sh-rp-b" }), rangeIn = h("input", { type: "text", "class": "sh-q-in", spellcheck: "false", value: R0 ? rangeName(R0) : "", "aria-label": T.cfApplies });
    var useSel = h("button", { type: "button", "class": "sh-b", title: T.cfUseSel, "aria-label": T.cfUseSel, text: "⌖", onclick: function () { rangeIn.value = rangeName(selBox()); draw(); } });
    var kindSeg = h("div", { "class": "sh-seg", role: "radiogroup", "aria-label": T.cfTitle });
    [["hl", T.cfHighlight], ["scale", T.cfScale]].forEach(function (x) {
      kindSeg.appendChild(h("button", { type: "button", role: "radio", "data-k": x[0], text: x[1], onclick: function () { st.kind = x[0]; draw(); } }));
    });
    var part = h("div", { "class": "sh-rp-part" }), err = h("div", { "class": "sh-rp-err", role: "alert" });
    var save = h("button", { type: "button", "class": "sh-b pri", text: T.cfSave }), no = h("button", { type: "button", "class": "sh-b", text: T.cancel, onclick: rpList });
    var del = old ? h("button", { type: "button", "class": "sh-b sh-left", text: T.del, title: T.cfDelete, onclick: function () { setRules(s, s.rules.filter(function (x, j) { return j !== i; })); rpList(); } }) : null;
    function rangeOf() { var R = parseRange(rangeIn.value.trim().toUpperCase()); return R && R.r2 < MAXR && R.c2 < MAXC ? R : null; }
    function opSelect(now, custom, pick) {
      var sel = h("select", { "aria-label": T.cfWhen });
      CF_OPS.concat(custom ? ["custom"] : []).forEach(function (o) { var op = h("option", { value: o, text: T[CF_OPT[o]] }); if (o === now) op.selected = true; sel.appendChild(op); });
      sel.addEventListener("change", function () { pick(sel.value); draw(); });
      return sel;
    }
    function valIn(o, name, label) {
      var inp = h("input", { type: "text", "class": "sh-q-in", value: o[name] || "", placeholder: label, "aria-label": label });
      inp.addEventListener("input", function () { o[name] = inp.value; });
      return inp;
    }
    function condRow(o, custom) {
      var n = CF_ARGS[o.op] || 0, row = h("div", { "class": "sh-rp-cond" }, [opSelect(o.op, custom, function (v) { o.op = v; })]);
      if (n >= 1) row.appendChild(valIn(o, "a", T.cfValue));
      if (n >= 2) row.append(h("span", { "class": "sh-muted", text: T.cfTo }), valIn(o, "b", T.cfValue));
      return row;
    }
    function swatches(list, now, none, pick) {
      var g = h("div", { "class": "sh-rp-sw" });
      g.appendChild(h("button", { type: "button", "class": "none" + (now ? "" : " on"), title: none, "aria-label": none, onclick: function () { pick(null); draw(); } }));
      list.forEach(function (c) { g.appendChild(h("button", { type: "button", "class": now === c ? "on" : null, title: c, "aria-label": c, style: "background:" + c, onclick: function () { pick(c); draw(); } })); });
      var own = h("input", { type: "color", value: now || "#ffffff", title: T.cfFormat, "aria-label": T.cfFormat });
      own.addEventListener("change", function () { pick(own.value.toLowerCase()); draw(); });
      g.appendChild(own);
      return g;
    }
    function toggle(label, name, cls) {
      return h("button", { type: "button", "class": "sh-b sh-rp-tg " + cls, "aria-pressed": st.look[name] ? "true" : "false", title: label, "aria-label": label, text: name === "bold" ? "B" : "S",
        onclick: function () { st.look[name] = !st.look[name]; draw(); } });
    }
    function draw() {
      var R = rangeOf();
      [].forEach.call(kindSeg.children, function (b) { b.setAttribute("aria-checked", b.getAttribute("data-k") === st.kind ? "true" : "false"); });
      part.innerHTML = ""; err.textContent = "";
      if (st.kind === "scale") {
        var pre = h("div", { "class": "sh-rp-looks" });
        CF_SCALES.forEach(function (cs) {
          pre.appendChild(h("button", { type: "button", "class": "sh-rp-grad" + (JSON.stringify(cs) === JSON.stringify(st.scale) ? " on" : ""), title: cs.join(" → "), "aria-label": cs.join(" → "),
            style: "background:linear-gradient(90deg," + cs.join(",") + ")", onclick: function () { st.scale = cs.slice(); draw(); } }));
        });
        var stops = h("div", { "class": "sh-rp-stops" }), has3 = st.scale.length === 3;
        [[T.cfLow, 0], [T.cfMid, 1], [T.cfHigh, has3 ? 2 : 1]].forEach(function (x, j) {
          var mid = j === 1, inp = h("input", { type: "color", value: mid && !has3 ? "#ffeb84" : st.scale[x[1]], "aria-label": x[0] });
          inp.addEventListener("change", function () { if (mid && !has3) st.scale.splice(1, 0, inp.value.toLowerCase()); else st.scale[x[1]] = inp.value.toLowerCase(); draw(); });
          var lab = h("label", { "class": "sh-rp-stop" }, [h("span", { text: x[0] }), inp]);
          if (mid) {
            var on = h("input", { type: "checkbox", "aria-label": x[0] });
            on.checked = has3;
            on.addEventListener("change", function () { if (on.checked) st.scale.splice(1, 0, "#ffeb84"); else st.scale.splice(1, 1); draw(); });
            lab.insertBefore(on, inp); inp.disabled = !has3;
          }
          stops.appendChild(lab);
        });
        part.append(h("div", { "class": "sh-rp-l", text: T.cfFormat }), pre, stops);
        return;
      }
      part.appendChild(h("div", { "class": "sh-rp-l", text: T.cfWhen }));
      part.appendChild(condRow(st, true));
      if (st.op === "custom") {
        var fx = h("textarea", { "class": "sh-q-in sh-rp-fx", rows: 2, spellcheck: "false", placeholder: "=" + (R ? key(R.r1, R.c1) : "A1") + ">10", "aria-label": T.cfFormula });
        fx.value = st.formula;
        fx.addEventListener("input", function () { st.formula = fx.value; });
        part.appendChild(fx);
      } else if (st.and) {
        var cols = h("select", { "aria-label": T.cfAndCol }), u = used(s), last = Math.max(u.c, R ? R.c2 : 0, st.and.col);
        for (var c = 0; c <= Math.min(last, MAXC - 1); c++) {
          var nm = R ? cfColName(s, c, R) : null, op = h("option", { value: String(c), text: colName(c) + (nm ? " · " + nm : "") });
          if (c === st.and.col) op.selected = true;
          cols.appendChild(op);
        }
        cols.addEventListener("change", function () { st.and.col = +cols.value; });
        part.append(h("div", { "class": "sh-rp-and" }, [h("span", { "class": "sh-rp-l", text: T.cfAndCol }), cols,
          h("button", { type: "button", "class": "sh-rp-x", title: T.cfNoAnd, "aria-label": T.cfNoAnd, html: kit.icon("close"), onclick: function () { st.and = null; draw(); } })]), condRow(st.and, false));
      } else {
        part.appendChild(h("button", { type: "button", "class": "sh-flt-add", text: T.cfAddAnd, onclick: function () {
          var Rn = rangeOf(), base = Rn ? Rn.c2 : 0;
          st.and = { col: Math.min(base + 1, MAXC - 1), op: "is", a: "", b: "" }; draw();
        } }));
      }
      var looks = h("div", { "class": "sh-rp-looks" });
      CF_LOOKS.forEach(function (x) {
        var lk = x[1], same2 = (lk.bg || null) === st.look.bg && (lk.fg || null) === st.look.fg && !!lk.bold === st.look.bold && !!lk.strike === st.look.strike;
        looks.appendChild(h("button", { type: "button", "class": "sh-rp-look" + (same2 ? " on" : ""), text: T[x[0]],
          style: (lk.bg ? "background:" + lk.bg + ";" : "") + (lk.fg ? "color:" + lk.fg + ";" : "") + (lk.bold ? "font-weight:700;" : "") + (lk.strike ? "text-decoration:line-through;" : ""),
          onclick: function () { st.look = { bg: lk.bg || null, fg: lk.fg || null, bold: !!lk.bold, strike: !!lk.strike }; draw(); } }));
      });
      var sample = h("div", { "class": "sh-rp-sample", text: T.cfSample, style: (st.look.bg ? "background:" + st.look.bg + ";color:" + (st.look.fg || inkOn(st.look.bg)) + ";" : st.look.fg ? "color:" + st.look.fg + ";" : "") +
        (st.look.bold ? "font-weight:700;" : "") + (st.look.strike ? "text-decoration:line-through;" : "") });
      part.append(h("div", { "class": "sh-rp-l", text: T.cfFormat }), looks,
        h("div", { "class": "sh-rp-row" }, [h("span", { "class": "sh-rp-k", text: T.cfFill }), swatches(CF_FILLS, st.look.bg, T.cfNoColor, function (c2) { st.look.bg = c2; })]),
        h("div", { "class": "sh-rp-row" }, [h("span", { "class": "sh-rp-k", text: T.cfText }), swatches(CF_INKS, st.look.fg, T.cfNoColor, function (c2) { st.look.fg = c2; })]),
        h("div", { "class": "sh-rp-row" }, [h("span", { "class": "sh-rp-k" }), toggle(T.cfBold, "bold", "b"), toggle(T.cfStrike, "strike", "s"), sample]));
    }
    function build() {
      var R = rangeOf();
      if (!R) { err.textContent = T.cfBadRange; rangeIn.focus(); return null; }
      var rule = { range: rangeName(R) };
      if (st.kind === "scale") { rule.scale = st.scale.slice(); return rule; }
      if (st.op === "custom") {
        var f = parseText(st.formula.trim()).value;
        if (!isFormula(f) || f.length > 500) { err.textContent = T.cfBadFormula; return null; }
        rule["if"] = f;
      } else {
        var need = function (o) { var n = CF_ARGS[o.op]; return n >= 1 && !String(o.a).trim() || n >= 2 && !String(o.b).trim(); };
        if (need(st) || st.and && need(st.and)) { err.textContent = T.cfNeedsValue; return null; }
        var c1 = cfCond(key(R.r1, R.c1), st.op, st.a, st.b);
        rule["if"] = "=" + (st.and ? "AND(" + c1 + "," + cfCond("$" + colName(st.and.col) + (R.r1 + 1), st.and.op, st.and.a, st.and.b) + ")" : c1);
        if (rule["if"].length > 500) { err.textContent = T.cfBadFormula; return null; }
      }
      if (st.look.bg) rule.bg = st.look.bg; if (st.look.fg) rule.fg = st.look.fg; if (st.look.bold) rule.bold = true; if (st.look.strike) rule.strike = true;
      if (!rule.bg && !rule.fg && !rule.bold && !rule.strike) { err.textContent = T.cfNoFormat; return null; }
      return rule;
    }
    save.addEventListener("click", function () {
      if (ro()) return;
      var rule = build();
      if (!rule) return;
      var rules = s.rules.slice();
      if (i >= 0) rules[i] = rule; else rules.push(rule);
      setRules(s, rules);
      rpList();
    });
    rangeIn.addEventListener("change", draw);
    body.append(kindSeg, rpField(T.cfApplies, [h("div", { "class": "sh-rp-rng" }, [rangeIn, useSel])]), part, err, h("div", { "class": "sh-dlg-bar" }, [del, no, save]));
    rpEl.innerHTML = "";
    rpEl.append(rpHead(old ? cfTitleOf(s, old) : T.cfAdd, true), body);
    draw();
    rangeIn.focus();
  }

  // ---- dropdown options: colours, rename, delete, add, presets (the list a dropdown cell opens; see openDd)
  var PILLS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "magenta"];
  var DD_PRESETS = [
    { name: T.pStatus, options: [T.pTodo, T.pDoing, T.pDone], colors: ["gray", "blue", "green"] },
    { name: T.pPriority, options: [T.pLow, T.pMedium, T.pHigh], colors: ["green", "yellow", "red"] },
    { name: T.pYesNo, options: [T.pYes, T.pNo], colors: ["green", "red"] },
    { name: T.pApproval, options: [T.pPending, T.pApproved, T.pRejected], colors: ["yellow", "green", "red"] }];
  // The class of an option's pill: its own colour, else one by its place among the options.
  function pillCls(f, i) { var c = f.colors && f.colors[i]; return c && PILLS.indexOf(c) >= 0 ? "c-" + c : "p" + i % 8; }
  // The cells that share a dropdown's list, as runs down each column.
  function ddRuns(s, f) {
    var j = JSON.stringify([f.options, f.colors || []]), cols = {}, out = [];
    for (var k in s.fmt) {
      var x = s.fmt[k];
      if (!x.options || !(x.options === f.options && x.colors === f.colors || JSON.stringify([x.options, x.colors || []]) === j)) continue;
      var p = parseKey(k);
      if (p) (cols[p.c] = cols[p.c] || []).push(p.r);
    }
    Object.keys(cols).forEach(function (c) {
      var rs = cols[c].sort(function (a, b) { return a - b; }), a = 0;
      for (var b = 1; b <= rs.length; b++) if (b === rs.length || rs[b] !== rs[b - 1] + 1) { out.push({ r1: rs[a], c1: +c, r2: rs[b - 1], c2: +c }); a = b; }
    });
    return out;
  }
  // A dropdown's list changed for every cell that shares it; rename: [old, new] rewrites the cells holding the old name.
  function ddChange(s, f, opts, cols, rename) {
    closePop(); grid.focus();
    if (ro()) return;
    var colors = opts.length && cols && cols.some(Boolean) ? cols : null, patch = { options: opts.length ? opts : null, colors: colors }, fwd = [], inv = [];
    ddRuns(s, f).forEach(function (R) {
      var fi = invFmt(s, R, ["options", "colors"]);
      fwd.push(fmtOp(R, patch));
      if (inv && fi) inv = inv.concat(fi); else inv = null;
      if (!rename) return;
      var rows = [], was = [], any = false;
      for (var r = R.r1; r <= R.r2; r++) {
        var v = s.cells[key(r, R.c1)], hitV = v !== undefined && v !== null && String(v) === rename[0];
        rows.push([hitV ? rename[1] : null]); was.push([hitV ? v : null]); any = any || hitV;
      }
      if (any) { fwd.push({ op: "set", range: key(R.r1, R.c1), values: rows }); if (inv) inv.push({ op: "set", range: key(R.r1, R.c1), values: was }); }
    });
    if (fwd.length) doEdit(s, fwd, inv);
  }
  // One option's own view inside the open list: its name, its colour, delete (i < 0: a new option).
  function ddOptView(list, s, f, i) {
    var opts = f.options, cols = opts.map(function (o, j) { return f.colors && f.colors[j] || null; }), isNew = i < 0, color = isNew ? null : cols[i];
    list.innerHTML = ""; list.classList.add("sh-ddv"); list.removeAttribute("tabindex"); list.removeAttribute("role");
    var name = h("input", { type: "text", "class": "sh-q-in", maxlength: "60", value: isNew ? "" : opts[i], placeholder: T.ddNewPh, "aria-label": isNew ? T.ddAdd : T.ddRename });
    var dots = h("div", { "class": "sh-dots", role: "radiogroup", "aria-label": T.ddColor });
    function mark() { [].forEach.call(dots.children, function (b) { b.setAttribute("aria-checked", (b.getAttribute("data-c") || null) === color ? "true" : "false"); }); }
    [null].concat(PILLS).forEach(function (c) {
      dots.appendChild(h("button", { type: "button", role: "radio", "class": "sh-dot" + (c ? " sh-pl c-" + c : " none"), "data-c": c || "", title: c ? T["c_" + c] : T.ddNoColor, "aria-label": c ? T["c_" + c] : T.ddNoColor,
        onclick: function () { color = c; mark(); } }));
    });
    function apply() {
      var v = name.value.trim().slice(0, 60), no = opts.slice(), nc = cols.slice();
      if (!v || opts.some(function (o, j) { return o === v && j !== i; }) || isNew && no.length >= 50) return name.focus();
      if (isNew) { no.push(v); nc.push(color); } else { no[i] = v; nc[i] = color; }
      ddChange(s, f, no, nc, !isNew && v !== opts[i] ? [opts[i], v] : null);
    }
    var ok = h("button", { type: "button", "class": "sh-b pri", text: T.ok, onclick: apply });
    var del = isNew ? null : h("button", { type: "button", "class": "sh-b sh-left", text: T.ddDelOpt, onclick: function () {
      var no = opts.slice(), nc = cols.slice();
      no.splice(i, 1); nc.splice(i, 1);
      ddChange(s, f, no, nc, null);
    } });
    name.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); apply(); } });
    list.append(name, dots, h("div", { "class": "sh-dlg-bar" }, [del, ok]));
    mark(); ddFit(list);
    name.focus(); name.select();
  }
  // The list's new view kept inside the window.
  function ddFit(list) {
    var r = list.getBoundingClientRect();
    if (r.right > innerWidth - 8) list.style.left = Math.max(8, innerWidth - r.width - 8) + "px";
    if (r.bottom > innerHeight - 8) list.style.top = Math.max(8, innerHeight - r.height - 8) + "px";
  }
  // The ready-made lists, inside the open list.
  function ddPresetView(list, pick) {
    list.innerHTML = ""; list.classList.add("sh-ddv"); list.removeAttribute("tabindex"); list.removeAttribute("role");
    DD_PRESETS.forEach(function (p) {
      var row = h("button", { type: "button", "class": "sh-ddp", "aria-label": p.name + ": " + p.options.join(", ") }, [h("small", { text: p.name })].concat(
        p.options.map(function (o, j) { return h("span", { "class": "sh-pl c-" + p.colors[j], text: o }); })));
      row.addEventListener("click", function (e) { e.stopPropagation(); pick(p); });
      list.appendChild(row);
    });
    ddFit(list);
    var first = list.querySelector("button");
    if (first) first.focus();
  }

  window.__sheetUI = window.__sheetUI || {};
  window.__sheetUI.openRules = openRules;
  window.__sheetUI.openBorders = openBorders;
  window.__sheetUI.mergeSel = mergeSel;
  window.__sheetUI.unmergeSel = unmergeSel;
  window.__sheetUI.canUnmerge = canUnmerge;

  // ------------------------------------------------------------------ start
  if (!editable) document.documentElement.classList.add("sh-ro");
  drawTabs();
  refresh();
  afterSel();
  drawUndo();
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
