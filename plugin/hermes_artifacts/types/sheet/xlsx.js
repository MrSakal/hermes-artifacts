/* xlsx and CSV for the sheet page: OOXML workbooks written and read with fflate, no DOM, so the same
   code runs in the page (window.sheetXlsx, global fflate) and under node (module.exports). */
(function () {
  "use strict";

  var FF = null;
  function ff() {
    if (FF) return FF;
    if (typeof fflate !== "undefined") FF = fflate;
    else if (typeof require === "function") FF = require("../vendor/fflate.umd.js");
    if (!FF) throw new Error("sheetXlsx: fflate is not loaded");
    return FF;
  }

  var NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  var NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  var NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
  var CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.";
  var ERRORS = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA"];
  var ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
  // Functions newer than Excel 2007 are stored with the _xlfn. prefix, or Excel shows #NAME?
  var FUTURE = {CONCAT: 1, IFS: 1, MAXIFS: 1, MINIFS: 1, SWITCH: 1, TEXTJOIN: 1, XLOOKUP: 1, XMATCH: 1, XOR: 1,
    IFNA: 1, DAYS: 1, "STDEV.S": 1, "STDEV.P": 1, "VAR.S": 1, "VAR.P": 1, "CEILING.MATH": 1, "FLOOR.MATH": 1};
  // Built-in number formats: the ids written for the spec's strings, and what is read back
  var NUM_ID = {"General": 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10, "m/d/yyyy": 14, "@": 49};
  var BUILTIN = {1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?",
    13: "# ??/??", 14: "yyyy-mm-dd", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM",
    19: "h:mm:ss AM/PM", 20: "hh:mm", 21: "hh:mm:ss", 22: "yyyy-mm-dd hh:mm", 37: "#,##0 ;(#,##0)",
    38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss",
    46: "[h]:mm:ss", 47: "mm:ss.0", 48: "##0.0E+0", 49: "@"};
  var DATE_FMT = "yyyy-mm-dd", DATETIME_FMT = "yyyy-mm-dd hh:mm";

  // ---- cells ----
  function colName(c) {
    var s = "";
    c++;
    while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - 1 - m) / 26; }
    return s;
  }
  function colIndex(s) {
    var n = 0;
    s = s.toUpperCase();
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  var CELL = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/;
  function parseCell(k) {
    var m = CELL.exec(k);
    if (!m) return null;
    var c = colIndex(m[1]), r = +m[2] - 1;
    if (c > 16383 || r > 1048575) return null;
    return {r: r, c: c};
  }
  function isFormula(v) { return typeof v === "string" && v.length > 1 && v.charAt(0) === "="; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ---- XML text ----
  // Drops what XML 1.0 cannot carry: C0 controls but tab/LF/CR, lone surrogates, U+FFFE/FFFF
  function clean(s) {
    s = String(s);
    if (!/[\x00-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF\ufffe\uffff]/.test(s)) return s;
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { out += s.charAt(i) + s.charAt(i + 1); i++; }
        continue;
      }
      if ((c >= 0xDC00 && c <= 0xDFFF) || c === 0xFFFE || c === 0xFFFF || (c < 32 && c !== 9 && c !== 10 && c !== 13)) continue;
      out += s.charAt(i);
    }
    return out;
  }
  function esc(s) {
    return clean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/\r/g, "&#13;");
  }

  // ---- dates (1900 system, Excel's phantom 1900-02-29 included) ----
  var DAY = 86400000, EPOCH = Date.UTC(1899, 11, 30);
  function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
  function isoToSerial(s) {
    var m = ISO.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], t = Date.UTC(y, mo - 1, d), dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    var h = m[4] ? +m[4] : 0, mi = m[5] ? +m[5] : 0, se = m[6] ? +m[6] : 0;
    if (h > 23 || mi > 59 || se > 59) return null;
    var n = (t - EPOCH) / DAY;
    if (n < 61) n -= 1;
    if (n < 1) return null; // before 1900: stays text
    return n + (h * 3600 + mi * 60 + se) / 86400;
  }
  function serialToIso(n, withTime) {
    if (typeof n !== "number" || !isFinite(n) || n < 0 || n >= 2958466) return null;
    var days = Math.floor(n), mins = 0;
    if (withTime) {
      mins = Math.round((n - days) * 1440);
      if (mins >= 1440) { days++; mins -= 1440; }
    }
    if (days < 60) days += 1; else if (days === 60) days = 61;
    var dt = new Date(EPOCH + days * DAY);
    var s = pad(dt.getUTCFullYear(), 4) + "-" + pad(dt.getUTCMonth() + 1, 2) + "-" + pad(dt.getUTCDate(), 2);
    if (withTime) s += "T" + pad(Math.floor(mins / 60), 2) + ":" + pad(mins % 60, 2);
    return s;
  }

  // ---- formulas ----
  // Walks a formula, copying string literals, quoted sheet names and [..] parts untouched; onRef(m, kind)
  // may return a replacement for a reference, onName(id, isCall) one for an identifier.
  var RE_CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?/;
  var RE_COLS = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/;
  var RE_ROWS = /^(\$?)(\d+):(\$?)(\d+)/;
  function walk(f, onRef, onName, onChar) {
    var out = "", i = 0, L = f.length, j, m;
    while (i < L) {
      var ch = f.charAt(i);
      if (ch === '"' || ch === "'") {
        j = i + 1;
        while (j < L) {
          if (f.charAt(j) === ch) { if (f.charAt(j + 1) === ch) { j += 2; continue; } break; }
          j++;
        }
        out += f.slice(i, j + 1); i = j + 1; continue;
      }
      if (ch === "[" || ch === "{") { // structured refs and array constants stay as they are
        j = f.indexOf(ch === "[" ? "]" : "}", i);
        j = j < 0 ? L - 1 : j;
        out += f.slice(i, j + 1); i = j + 1; continue;
      }
      var prev = i ? f.charAt(i - 1) : "";
      if (!/[A-Za-z0-9_.$]/.test(prev) && /[A-Za-z$0-9]/.test(ch)) {
        var rest = f.slice(i), kind = null;
        if ((m = RE_CELL.exec(rest))) kind = "cell";
        else if ((m = RE_COLS.exec(rest))) kind = "cols";
        else if (/[0-9$]/.test(ch) && (m = RE_ROWS.exec(rest))) kind = "rows";
        if (kind && !/^[A-Za-z0-9_(!.]/.test(f.charAt(i + m[0].length))) {
          var rep = onRef ? onRef(m, kind) : null;
          if (rep === false) return null;
          out += rep == null ? m[0] : rep; i += m[0].length; continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
          var id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest)[0];
          var call = /^\s*\(/.test(f.slice(i + id.length));
          var nrep = onName ? onName(id, call) : null;
          out += nrep == null ? id : nrep; i += id.length; continue;
        }
      }
      var crep = onChar ? onChar(ch) : null;
      out += crep == null ? ch : crep; i++;
    }
    return out;
  }
  // Relative references moved by (dr, dc); null when one would leave the sheet
  function shiftFormula(f, dr, dc) {
    function col(abs, s) {
      if (abs) return abs + s.toUpperCase();
      var c = colIndex(s) + dc;
      if (c < 0 || c > 16383) throw 0;
      return colName(c);
    }
    function row(abs, s) {
      if (abs) return abs + s;
      var r = +s + dr;
      if (r < 1 || r > 1048576) throw 0;
      return String(r);
    }
    try {
      return walk(f, function (m, kind) {
        if (kind === "cell") {
          if (colIndex(m[2]) > 16383 || (m[6] && colIndex(m[6]) > 16383)) return null;
          return col(m[1], m[2]) + row(m[3], m[4]) + (m[6] ? ":" + col(m[5], m[6]) + row(m[7], m[8]) : "");
        }
        if (kind === "cols") return col(m[1], m[2]) + ":" + col(m[3], m[4]);
        return row(m[1], m[2]) + ":" + row(m[3], m[4]);
      });
    } catch (e) { return null; }
  }
  // Page formula ("=SUM(A1;B1)") -> file formula ("SUM(A1,B1)", newer functions prefixed)
  function toFileFormula(v) {
    return walk(v.slice(1), null, function (id, call) {
      return call && own(FUTURE, id.toUpperCase()) ? "_xlfn." + id : null;
    }, function (ch) { return ch === ";" ? "," : null; });
  }
  function fromFileFormula(f) { return "=" + f.replace(/_xl(fn|ws)\./g, ""); }

  // ---- write ----
  function argb(c) {
    if (typeof c !== "string") return null;
    var m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(c.trim());
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    return "FF" + h.toUpperCase();
  }
  function styleTable() {
    var fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'], fontIx = {"": 0};
    var fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'],
      fillIx = {"": 0};
    var numFmts = [], numIx = {}, xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], xfIx = {};
    var borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"], borderIx = {"": 0}, dxfs = [], dxfIx = {};
    // A cell's edges (fmt.bd: of "tblr") as a border of thin lines in the automatic colour.
    function borderId(bd) {
      var k = "", i, E = {l: "left", r: "right", t: "top", b: "bottom"};
      for (i = 0; i < 4; i++) if (typeof bd === "string" && bd.indexOf("tblr".charAt(i)) >= 0) k += "tblr".charAt(i);
      if (!own(borderIx, k)) {
        borderIx[k] = borders.length;
        var x = "<border>";
        for (i = 0; i < 4; i++) { var e = "lrtb".charAt(i); x += k.indexOf(e) >= 0 ? "<" + E[e] + ' style="thin"><color auto="1"/></' + E[e] + ">" : "<" + E[e] + "/>"; }
        borders.push(x + "<diagonal/></border>");
      }
      return borderIx[k];
    }
    // A conditional-format rule's look ({bg, fg, bold, strike}) as a differential format.
    function dxf(rule) {
      var fg = argb(rule.fg), bg = argb(rule.bg), k = (rule.bold ? "b" : "") + (rule.strike ? "s" : "") + "|" + (fg || "") + "|" + (bg || "");
      if (!own(dxfIx, k)) {
        dxfIx[k] = dxfs.length;
        dxfs.push("<dxf>" + (rule.bold || rule.strike || fg ? "<font>" + (rule.bold ? "<b/>" : "") + (rule.strike ? "<strike/>" : "") + (fg ? '<color rgb="' + fg + '"/>' : "") + "</font>" : "") +
          (bg ? '<fill><patternFill><bgColor rgb="' + bg + '"/></patternFill></fill>' : "") + "</dxf>");
      }
      return dxfIx[k];
    }
    function numId(code) {
      if (own(NUM_ID, code)) return NUM_ID[code];
      if (!own(numIx, code)) { numIx[code] = 164 + numFmts.length; numFmts.push(code); }
      return numIx[code];
    }
    function xf(fm, dateKind) {
      if (!fm && !dateKind) return 0;
      fm = fm || {};
      var num = typeof fm.num === "string" && fm.num && fm.num !== "General" ? fm.num : null;
      if (!num && dateKind) num = dateKind === "dt" ? DATETIME_FMT : DATE_FMT;
      var nid = num ? numId(clean(num)) : 0;
      var fg = argb(fm.fg), bg = argb(fm.bg);
      var fk = (fm.bold ? "b" : "") + (fm.italic ? "i" : "") + (fm.underline ? "u" : "") + (fg || "");
      if (!own(fontIx, fk)) {
        fontIx[fk] = fonts.length;
        fonts.push("<font>" + (fm.bold ? "<b/>" : "") + (fm.italic ? "<i/>" : "") + (fm.underline ? "<u/>" : "") +
          '<sz val="11"/>' + (fg ? '<color rgb="' + fg + '"/>' : "") + '<name val="Calibri"/><family val="2"/></font>');
      }
      var lk = bg || "";
      if (!own(fillIx, lk)) {
        fillIx[lk] = fills.length;
        fills.push('<fill><patternFill patternType="solid"><fgColor rgb="' + bg + '"/><bgColor indexed="64"/></patternFill></fill>');
      }
      var al = fm.align === "left" || fm.align === "center" || fm.align === "right" ? fm.align : null;
      var bid = fm.bd ? borderId(fm.bd) : 0;
      var key = nid + "|" + fontIx[fk] + "|" + fillIx[lk] + "|" + (al || "") + "|" + (fm.wrap ? 1 : 0) + (bid ? "|" + bid : "");
      if (key === "0|0|0||0") return 0;
      if (!own(xfIx, key)) {
        xfIx[key] = xfs.length;
        var align = al || fm.wrap ? "<alignment" + (al ? ' horizontal="' + al + '"' : "") + (fm.wrap ? ' wrapText="1"' : "") + "/>" : "";
        xfs.push('<xf numFmtId="' + nid + '" fontId="' + fontIx[fk] + '" fillId="' + fillIx[lk] + '" borderId="' + bid + '" xfId="0"' +
          (nid ? ' applyNumberFormat="1"' : "") + (fontIx[fk] ? ' applyFont="1"' : "") + (fillIx[lk] ? ' applyFill="1"' : "") + (bid ? ' applyBorder="1"' : "") +
          (align ? ' applyAlignment="1">' + align + "</xf>" : "/>"));
      }
      return xfIx[key];
    }
    function xml() {
      var nf = "";
      for (var i = 0; i < numFmts.length; i++) nf += '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + esc(numFmts[i]) + '"/>';
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="' + NS_MAIN + '">' +
        (nf ? '<numFmts count="' + numFmts.length + '">' + nf + "</numFmts>" : "") +
        '<fonts count="' + fonts.length + '">' + fonts.join("") + "</fonts>" +
        '<fills count="' + fills.length + '">' + fills.join("") + "</fills>" +
        '<borders count="' + borders.length + '">' + borders.join("") + "</borders>" +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="' + xfs.length + '">' + xfs.join("") + "</cellXfs>" +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        (dxfs.length ? '<dxfs count="' + dxfs.length + '">' + dxfs.join("") + "</dxfs>" : '<dxfs count="0"/>') +
        '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
        "</styleSheet>";
    }
    return {xf: xf, xml: xml, dxf: dxf};
  }
  function sheetNames(src) {
    var used = {}, out = [];
    for (var i = 0; i < src.length; i++) {
      var n = clean(src[i] && src[i].name != null ? src[i].name : "").replace(/[\[\]:*?\/\\]/g, "_")
        .replace(/^'+|'+$/g, "").replace(/^\s+|\s+$/g, "");
      if (!n) n = "Sheet" + (i + 1);
      if (n.toLowerCase() === "history") n += "_"; // reserved by Excel
      n = clean(n.slice(0, 31));
      var base = n, k = 2;
      while (own(used, n.toLowerCase())) {
        var suf = " (" + k++ + ")";
        n = clean(base.slice(0, 31 - suf.length)) + suf;
      }
      used[n.toLowerCase()] = 1;
      out.push(n);
    }
    return out;
  }
  // A format that shows in the file's cell style (a dropdown or a checkbox alone does not).
  function styled(f) { return !!(f.bold || f.italic || f.underline || f.align || f.num || f.bg || f.fg || f.wrap || f.bd); }
  // "A1:C2" (or "A1") -> {r1, c1, r2, c2}, or null
  function parseBox(s) {
    var p = String(s || "").replace(/\$/g, "").split(":"), a = parseCell(p[0]), b = parseCell(p[1] || p[0]);
    if (!a || !b || p.length > 2) return null;
    return {r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c)};
  }
  function boxName(b) { var a = colName(b.c1) + (b.r1 + 1), z = colName(b.c2) + (b.r2 + 1); return a === z ? a : a + ":" + z; }
  // Merged cells and conditional formats, as they stand between sheetData and the validations.
  // The last rule wins in the page: in the file that is priority 1.
  function mergesXml(merges) {
    var out = "", n = 0;
    for (var i = 0; i < (merges || []).length; i++) {
      var b = parseBox(merges[i]);
      if (b && (b.r1 !== b.r2 || b.c1 !== b.c2)) { out += '<mergeCell ref="' + boxName(b) + '"/>'; n++; }
    }
    return n ? '<mergeCells count="' + n + '">' + out + "</mergeCells>" : "";
  }
  function rulesXml(rules, st) {
    var out = "", n = (rules || []).length;
    for (var i = 0; i < n; i++) {
      var r = rules[i], b = r && parseBox(r.range), body = "";
      if (!b) continue;
      if (Array.isArray(r.scale) && (r.scale.length === 2 || r.scale.length === 3)) {
        var cols = "", ok = true;
        for (var j = 0; j < r.scale.length; j++) { var c = argb(r.scale[j]); if (!c) ok = false; cols += '<color rgb="' + c + '"/>'; }
        if (!ok) continue;
        body = '<cfRule type="colorScale" priority="' + (n - i) + '"><colorScale><cfvo type="min"/>' +
          (r.scale.length === 3 ? '<cfvo type="percentile" val="50"/>' : "") + '<cfvo type="max"/>' + cols + "</colorScale></cfRule>";
      } else if (isFormula(r["if"])) {
        body = '<cfRule type="expression" dxfId="' + st.dxf(r) + '" priority="' + (n - i) + '"><formula>' + esc(toFileFormula(r["if"])) + "</formula></cfRule>";
      } else continue;
      out += '<conditionalFormatting sqref="' + boxName(b) + '">' + body + "</conditionalFormatting>";
    }
    return out;
  }
  // Dropdown cells (fmt.options) as runs down each column: [{c, r1, r2, options}], top to bottom.
  function listRuns(fmt) {
    var cols = {}, out = [], k, p, c;
    for (k in fmt) if (own(fmt, k) && fmt[k] && Array.isArray(fmt[k].options) && fmt[k].options.length && (p = parseCell(k)))
      (cols[p.c] = cols[p.c] || []).push({r: p.r, o: fmt[k].options, j: JSON.stringify(fmt[k].options)});
    for (c in cols) if (own(cols, c)) {
      var cs = cols[c].sort(function (a, b) { return a.r - b.r; }), a = 0;
      for (var b = 1; b <= cs.length; b++) {
        if (b < cs.length && cs[b].r === cs[b - 1].r + 1 && cs[b].j === cs[a].j) continue;
        out.push({c: +c, r1: cs[a].r, r2: cs[b - 1].r, options: cs[a].o, j: cs[a].j});
        a = b;
      }
    }
    return out;
  }
  // The dropdowns as list validations with their items inline ("a,b,c": at most 255 characters and
  // no comma inside an item, else that dropdown is left out and its cells stay plain values).
  function validations(fmt) {
    var runs = listRuns(fmt), by = {}, order = [], out = "", i;
    for (i = 0; i < runs.length; i++) {
      if (!own(by, runs[i].j)) { by[runs[i].j] = {options: runs[i].options, refs: []}; order.push(runs[i].j); }
      by[runs[i].j].refs.push(colName(runs[i].c) + (runs[i].r1 + 1) + (runs[i].r2 > runs[i].r1 ? ":" + colName(runs[i].c) + (runs[i].r2 + 1) : ""));
    }
    var n = 0;
    for (i = 0; i < order.length; i++) {
      var g = by[order[i]], items = [], ok = true;
      for (var j = 0; j < g.options.length; j++) {
        var o = clean(String(g.options[j])).trim();
        if (!o || o.indexOf(",") >= 0) ok = false;
        items.push(o.replace(/"/g, '""'));
      }
      var f1 = '"' + items.join(",") + '"';
      if (!ok || f1.length > 255) continue;
      n++;
      out += '<dataValidation type="list" allowBlank="1" showInputMessage="1" sqref="' + g.refs.join(" ") + '"><formula1>' + esc(f1) + "</formula1></dataValidation>";
    }
    return n ? '<dataValidations count="' + n + '">' + out + "</dataValidations>" : "";
  }
  function numText(n) { return String(n); }
  function errCode(e) { return ERRORS.indexOf(e) >= 0 ? e : "#VALUE!"; }

  function write(book) {
    var F = ff();
    var src = book && book.sheets && book.sheets.length ? book.sheets : [{name: "Sheet1", cells: {}}];
    var names = sheetNames(src), st = styleTable(), sst = [], sstIx = {}, sstRefs = 0, needCalc = false;
    function sharedString(s) {
      s = clean(s);
      if (s.length > 32767) s = s.slice(0, 32767);
      sstRefs++;
      if (!own(sstIx, "k" + s)) { sstIx["k" + s] = sst.length; sst.push(s); }
      return sstIx["k" + s];
    }
    function cachedXml(c) {
      if (c === null || c === undefined) { needCalc = true; return {t: "", v: ""}; }
      if (typeof c === "number") return isFinite(c) ? {t: "", v: numText(c)} : {t: "e", v: "#NUM!"};
      if (typeof c === "boolean") return {t: "b", v: c ? "1" : "0"};
      if (typeof c === "object" && c.error) return {t: "e", v: errCode(c.error)};
      c = String(c);
      return ERRORS.indexOf(c) >= 0 ? {t: "e", v: c} : {t: "str", v: esc(c)};
    }
    function sheetXml(sh, idx) {
      var cells = sh.cells || {}, fmt = sh.fmt || {}, vals = sh.vals || {}, rows = {}, rowKeys = [], k, p;
      var minR = Infinity, minC = Infinity, maxR = -1, maxC = -1;
      function add(key, isFmt) {
        if (!(p = parseCell(key))) return;
        if (!own(rows, p.r)) { rows[p.r] = {}; rowKeys.push(p.r); }
        var e = rows[p.r][p.c] || (rows[p.r][p.c] = {k: colName(p.c) + (p.r + 1), ck: null, fk: null});
        if (isFmt) e.fk = key; else e.ck = key;
        if (p.r < minR) minR = p.r; if (p.r > maxR) maxR = p.r;
        if (p.c < minC) minC = p.c; if (p.c > maxC) maxC = p.c;
      }
      for (k in cells) if (own(cells, k) && cells[k] !== null && cells[k] !== undefined && cells[k] !== "") add(k, false);
      for (k in fmt) if (own(fmt, k) && fmt[k] && typeof fmt[k] === "object" && styled(fmt[k])) add(k, true);
      rowKeys.sort(function (a, b) { return a - b; });
      var data = "";
      for (var ri = 0; ri < rowKeys.length; ri++) {
        var r = rowKeys[ri], cols = [], cx;
        for (cx in rows[r]) if (own(rows[r], cx)) cols.push(+cx);
        cols.sort(function (a, b) { return a - b; });
        data += '<row r="' + (r + 1) + '">';
        for (var ci = 0; ci < cols.length; ci++) {
          var ent = rows[r][cols[ci]], key = ent.k, orig = ent.ck;
          var v = orig ? cells[orig] : null, fm = ent.fk ? fmt[ent.fk] : null, t = "", body = "", dk = null;
          if (isFormula(v)) {
            var cv = cachedXml(own(vals, orig) ? vals[orig] : vals[key]);
            t = cv.t;
            body = "<f>" + esc(toFileFormula(v)) + "</f>" + (cv.v !== "" ? "<v>" + cv.v + "</v>" : "");
          } else if (typeof v === "number") {
            if (isFinite(v)) body = "<v>" + numText(v) + "</v>"; else { t = "e"; body = "<v>#NUM!</v>"; }
          } else if (typeof v === "boolean") {
            t = "b"; body = "<v>" + (v ? 1 : 0) + "</v>";
          } else if (v !== null && v !== undefined && v !== "") {
            v = String(v);
            var serial = isoToSerial(v);
            if (serial !== null) { dk = ISO.exec(v)[4] ? "dt" : "d"; body = "<v>" + numText(serial) + "</v>"; }
            else if (ERRORS.indexOf(v) >= 0) { t = "e"; body = "<v>" + v + "</v>"; }
            else { t = "s"; body = "<v>" + sharedString(v) + "</v>"; }
          }
          var s = st.xf(fm, dk);
          data += '<c r="' + key + '"' + (s ? ' s="' + s + '"' : "") + (t ? ' t="' + t + '"' : "") +
            (body ? ">" + body + "</c>" : "/>");
        }
        data += "</row>";
      }
      var dim = maxR < 0 ? "A1" : colName(minC) + (minR + 1) + (maxR > minR || maxC > minC ? ":" + colName(maxC) + (maxR + 1) : "");
      // frozen panes
      var fr = sh.freeze || {}, fy = Math.max(0, Math.min(1048575, +fr.rows || 0)) | 0, fx = Math.max(0, Math.min(16383, +fr.cols || 0)) | 0;
      var view = '<sheetView workbookViewId="0"' + (idx === 0 ? ' tabSelected="1"' : "");
      if (fy || fx) {
        var pane = fy && fx ? "bottomRight" : fy ? "bottomLeft" : "topRight", tl = colName(fx) + (fy + 1);
        view += '><pane' + (fx ? ' xSplit="' + fx + '"' : "") + (fy ? ' ySplit="' + fy + '"' : "") + ' topLeftCell="' + tl +
          '" activePane="' + pane + '" state="frozen"/><selection pane="' + pane + '" activeCell="' + tl + '" sqref="' + tl + '"/></sheetView>';
      } else view += "/>";
      // column widths: pixels -> character units (Calibri 11, 7 px per digit, 5 px padding)
      var cw = sh.cols || {}, colList = [];
      for (k in cw) if (own(cw, k) && /^[A-Za-z]{1,3}$/.test(k) && +cw[k] > 0 && colIndex(k) <= 16383) colList.push([colIndex(k), +cw[k]]);
      colList.sort(function (a, b) { return a[0] - b[0]; });
      var colsXml = "";
      for (var i = 0; i < colList.length; i++) {
        var w = Math.max(0, Math.min(255, Math.round((colList[i][1] - 5) / 7 * 100) / 100));
        colsXml += '<col min="' + (colList[i][0] + 1) + '" max="' + (colList[i][0] + 1) + '" width="' + w + '" customWidth="1"/>';
      }
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="' + NS_MAIN + '" xmlns:r="' + NS_R + '">' +
        '<dimension ref="' + dim + '"/><sheetViews>' + view + "</sheetViews>" + '<sheetFormatPr defaultColWidth="13" defaultRowHeight="15"/>' +
        (colsXml ? "<cols>" + colsXml + "</cols>" : "") + (data ? "<sheetData>" + data + "</sheetData>" : "<sheetData/>") +
        mergesXml(sh.merges) + rulesXml(sh.rules, st) + validations(fmt) + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
    }

    var files = {}, sheetsXml = "", relsXml = "", ctXml = "", n = src.length;
    var parts = [];
    for (var i = 0; i < n; i++) parts.push(sheetXml(src[i] || {}, i));
    var head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    for (i = 0; i < n; i++) {
      sheetsXml += '<sheet name="' + esc(names[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      relsXml += '<Relationship Id="rId' + (i + 1) + '" Type="' + NS_R + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      ctXml += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="' + CT + 'worksheet+xml"/>';
    }
    relsXml += '<Relationship Id="rId' + (n + 1) + '" Type="' + NS_R + '/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId' + (n + 2) + '" Type="' + NS_R + '/sharedStrings" Target="sharedStrings.xml"/>';
    var sstXml = "";
    for (i = 0; i < sst.length; i++) {
      var s = sst[i];
      sstXml += "<si><t" + (/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : "") + ">" + esc(s) + "</t></si>";
    }
    function u8(x) { return F.strToU8(x); }
    files["[Content_Types].xml"] = u8(head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="' + CT + 'sheet.main+xml"/>' + ctXml +
      '<Override PartName="/xl/styles.xml" ContentType="' + CT + 'styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="' + CT + 'sharedStrings+xml"/></Types>');
    files["_rels/.rels"] = u8(head + '<Relationships xmlns="' + NS_PKG + '"><Relationship Id="rId1" Type="' + NS_R +
      '/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    files["xl/workbook.xml"] = u8(head + '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_R + '"><workbookPr/>' +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="16384" windowHeight="8192" activeTab="0"/></bookViews>' +
      "<sheets>" + sheetsXml + '</sheets><calcPr calcId="191029"' + (needCalc ? ' fullCalcOnLoad="1"' : "") + "/></workbook>");
    files["xl/_rels/workbook.xml.rels"] = u8(head + '<Relationships xmlns="' + NS_PKG + '">' + relsXml + "</Relationships>");
    files["xl/styles.xml"] = u8(st.xml());
    files["xl/sharedStrings.xml"] = u8(head + '<sst xmlns="' + NS_MAIN + '" count="' + sstRefs + '" uniqueCount="' + sst.length + '">' + sstXml + "</sst>");
    for (i = 0; i < n; i++) files["xl/worksheets/sheet" + (i + 1) + ".xml"] = u8(parts[i]);
    return F.zipSync(files, {level: 6});
  }

  // ---- a small tolerant XML reader: {n: local name, a: attributes, c: [children | text]} ----
  var ENT = {lt: "<", gt: ">", amp: "&", quot: '"', apos: "'"};
  function chr(cp) {
    if (!(cp >= 0 && cp <= 0x10FFFF)) return "";
    if (cp <= 0xFFFF) return String.fromCharCode(cp);
    cp -= 0x10000;
    return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
  }
  function dec(s) {
    if (s.indexOf("&") < 0) return s;
    return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (m, e) {
      if (e.charAt(0) === "#") return chr(e.charAt(1) === "x" || e.charAt(1) === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return own(ENT, e) ? ENT[e] : m;
    });
  }
  function local(n) { var i = n.indexOf(":"); return i < 0 ? n : n.slice(i + 1); }
  var KEEP_WS = {t: 1, v: 1, f: 1};
  function parseXml(s) {
    var root = {n: "#root", a: {}, c: []}, stack = [root], cur = root, i = 0, L = s.length, e;
    function text(t) { if (t && (KEEP_WS[cur.n] || /\S/.test(t))) cur.c.push(dec(t)); }
    while (i < L) {
      var lt = s.indexOf("<", i);
      if (lt < 0) { text(s.slice(i)); break; }
      if (lt > i) text(s.slice(i, lt));
      var c1 = s.charAt(lt + 1);
      if (c1 === "!") {
        if (s.substr(lt, 9) === "<![CDATA[") {
          e = s.indexOf("]]>", lt + 9); if (e < 0) e = L;
          cur.c.push(s.slice(lt + 9, e)); i = e + 3; continue;
        }
        if (s.substr(lt, 4) === "<!--") { e = s.indexOf("-->", lt + 4); i = e < 0 ? L : e + 3; continue; }
        e = s.indexOf(">", lt); i = e < 0 ? L : e + 1; continue;
      }
      if (c1 === "?") { e = s.indexOf("?>", lt); i = e < 0 ? L : e + 2; continue; }
      var gt = lt + 1, q = "";
      while (gt < L) {
        var ch = s.charAt(gt);
        if (q) { if (ch === q) q = ""; } else if (ch === '"' || ch === "'") q = ch; else if (ch === ">") break;
        gt++;
      }
      if (gt >= L) break;
      var body = s.slice(lt + 1, gt);
      i = gt + 1;
      if (body.charAt(0) === "/") {
        var nm = local(body.slice(1).replace(/\s+$/, ""));
        for (var j = stack.length - 1; j > 0; j--) if (stack[j].n === nm) { stack.length = j; break; }
        cur = stack[stack.length - 1];
        continue;
      }
      var self = body.charAt(body.length - 1) === "/";
      if (self) body = body.slice(0, -1);
      var name = /^[^\s\/>]*/.exec(body)[0];
      var node = {n: local(name), a: {}, c: []}, re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, m;
      var rest = body.slice(name.length);
      while ((m = re.exec(rest))) {
        var v = dec(m[2] !== undefined ? m[2] : m[3]);
        node.a[m[1]] = v;
        var ln = local(m[1]);
        if (!own(node.a, ln)) node.a[ln] = v;
      }
      cur.c.push(node);
      if (!self) { stack.push(node); cur = node; }
    }
    return root;
  }
  function kids(n, name) {
    var out = [];
    if (n) for (var i = 0; i < n.c.length; i++) if (typeof n.c[i] !== "string" && n.c[i].n === name) out.push(n.c[i]);
    return out;
  }
  function kid(n, name) {
    if (n) for (var i = 0; i < n.c.length; i++) if (typeof n.c[i] !== "string" && n.c[i].n === name) return n.c[i];
    return null;
  }
  function txt(n, skip) {
    if (!n) return "";
    var s = "";
    for (var i = 0; i < n.c.length; i++) {
      var c = n.c[i];
      if (typeof c === "string") s += c;
      else if (!skip || !skip[c.n]) s += txt(c, skip);
    }
    return s;
  }
  var NO_PHONETIC = {rPh: 1, phoneticPr: 1};
  function xstr(s) { // OOXML _xHHHH_ escapes
    return s.indexOf("_x") < 0 ? s : s.replace(/_x([0-9A-Fa-f]{4})_/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
  }
  function onOff(n) { return !!n && n.a.val !== "0" && n.a.val !== "false"; }
  function truthy(v) { return v === "1" || v === "true"; }

  // ---- read ----
  function normNum(code) {
    if (!code || code === "General") return null;
    var s = code.replace(/\[\$-[0-9A-Fa-f]+\]/g, "").replace(/\[\$([^\]-]*)-[^\]]*\]/g, function (m, sym) {
      return sym.length === 1 ? sym : '"' + sym + '"';
    });
    s = s.replace(/(?:\\.)+/g, function (m) {
      var plain = m.replace(/\\(.)/g, "$1");
      return /[A-Za-z0-9#?@%.,]/.test(plain) ? '"' + plain + '"' : plain;
    });
    s = s.replace(/;@$/, "");
    // date/time letters lower-case outside quotes and brackets (LibreOffice writes YYYY-MM-DD)
    var out = "", q = false, b = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '"' && !b) q = !q;
      else if (ch === "[" && !q) b = true;
      else if (ch === "]" && !q) b = false;
      else if (!q && !b && /[YMDHS]/.test(ch) && !/AM\/PM|A\/P/i.test(s.substr(i - 3, 8))) ch = ch.toLowerCase();
      out += ch;
    }
    return out || null;
  }
  // "date", "time" (time-only format) or null
  function dateKind(id, code) {
    if ((id >= 14 && id <= 17) || id === 22) return "date";
    if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47)) return "time";
    if (!code) return null;
    var s = code.split(";")[0].replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
    if (/[yd]/i.test(s)) return "date";
    if (/[hs]/i.test(s)) return "time";
    if (/m/i.test(s) && !/[0#?]/.test(s)) return "date";
    return null;
  }
  function toU8(b) {
    if (b instanceof Uint8Array) return b;
    if (b && b.buffer instanceof ArrayBuffer) return new Uint8Array(b.buffer, b.byteOffset || 0, b.byteLength);
    if (b instanceof ArrayBuffer) return new Uint8Array(b);
    throw new Error("Not an xlsx file: expected bytes");
  }
  function joinPath(base, target) {
    if (target.charAt(0) === "/") return target.slice(1);
    var parts = (base ? base + "/" + target : target).split("/"), out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "..") out.pop(); else if (parts[i] && parts[i] !== ".") out.push(parts[i]);
    }
    return out.join("/");
  }

  function read(bytes) {
    var F = ff(), z;
    try { z = F.unzipSync(toU8(bytes)); } catch (e) { throw new Error("Not an xlsx file: it is not a zip archive"); }
    var lower = {};
    for (var zk in z) if (own(z, zk)) lower[zk.toLowerCase()] = zk;
    function part(p) {
      var k = own(z, p) ? p : lower[p.toLowerCase()];
      if (!k) return null;
      var s = F.strFromU8(z[k]);
      if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
      try { return parseXml(s); } catch (e) { return null; }
    }
    function rels(p) {
      var slash = p.lastIndexOf("/"), dir = slash < 0 ? "" : p.slice(0, slash);
      var x = part((dir ? dir + "/" : "") + "_rels/" + p.slice(slash + 1) + ".rels"), out = {};
      var list = x ? kids(kid(x, "Relationships"), "Relationship") : [];
      for (var i = 0; i < list.length; i++) {
        var a = list[i].a;
        if (a.Id && a.Target && a.TargetMode !== "External") out[a.Id] = {type: (a.Type || "").split("/").pop(), target: joinPath(dir, a.Target)};
      }
      return out;
    }
    var rootRels = rels(""), wbPath = null, id;
    for (id in rootRels) if (rootRels[id].type === "officeDocument") wbPath = rootRels[id].target;
    var wbx = part(wbPath || "xl/workbook.xml"), wb = wbx && kid(wbx, "workbook");
    if (!wb) throw new Error("Not an xlsx file: no workbook inside");
    wbPath = wbPath || "xl/workbook.xml";
    var wbRels = rels(wbPath), wbDir = wbPath.slice(0, wbPath.lastIndexOf("/") + 1).replace(/\/$/, "");
    function relOf(type, fallback) {
      for (var k in wbRels) if (wbRels[k].type === type) return wbRels[k].target;
      return joinPath(wbDir, fallback);
    }
    var wbPr = kid(wb, "workbookPr"), offset = wbPr && truthy(wbPr.a.date1904) ? 1462 : 0;

    // shared strings
    var sst = [], sx = part(relOf("sharedStrings", "sharedStrings.xml")), sis = kids(sx && kid(sx, "sst"), "si");
    for (var i = 0; i < sis.length; i++) sst.push(xstr(txt(sis[i], NO_PHONETIC)));

    // styles
    var numFmts = {}, fonts = [], fills = [], xfs = [], sty = part(relOf("styles", "styles.xml")), ss = sty && kid(sty, "styleSheet");
    var list = kids(kid(ss, "numFmts"), "numFmt");
    for (i = 0; i < list.length; i++) numFmts[+list[i].a.numFmtId] = list[i].a.formatCode || "";
    function rgb(n) {
      var v = n && n.a.rgb;
      if (!v || !/^[0-9A-Fa-f]{6,8}$/.test(v)) return null;
      return "#" + v.slice(-6).toLowerCase();
    }
    list = kids(kid(ss, "fonts"), "font");
    for (i = 0; i < list.length; i++) {
      var fn = list[i], u = kid(fn, "u"), col = rgb(kid(fn, "color"));
      fonts.push({bold: onOff(kid(fn, "b")), italic: onOff(kid(fn, "i")), underline: !!u && u.a.val !== "none",
        fg: col === "#000000" ? null : col});
    }
    list = kids(kid(ss, "fills"), "fill");
    for (i = 0; i < list.length; i++) {
      var pf = kid(list[i], "patternFill"), bg = pf && pf.a.patternType === "solid" ? rgb(kid(pf, "fgColor")) : null;
      fills.push(bg === "#ffffff" ? null : bg);
    }
    // borders: the edges that have a line (any style reads as the thin one); dxfs: the looks conditional formats name
    var edges = [], dxfs = [];
    list = kids(kid(ss, "borders"), "border");
    for (i = 0; i < list.length; i++) {
      var bd = "", EN = {t: "top", b: "bottom", l: "left", r: "right"};
      for (var ei = 0; ei < 4; ei++) { var en = kid(list[i], EN["tblr".charAt(ei)]); if (en && en.a.style && en.a.style !== "none") bd += "tblr".charAt(ei); }
      edges.push(bd);
    }
    list = kids(kid(ss, "dxfs"), "dxf");
    for (i = 0; i < list.length; i++) {
      var dfo = kid(list[i], "font"), dpf = kid(kid(list[i], "fill"), "patternFill"), look = {};
      if (dfo) {
        if (onOff(kid(dfo, "b"))) look.bold = true;
        if (onOff(kid(dfo, "strike"))) look.strike = true;
        var dfg = rgb(kid(dfo, "color"));
        if (dfg) look.fg = dfg;
      }
      var dbg = dpf ? rgb(kid(dpf, "bgColor")) || rgb(kid(dpf, "fgColor")) : null;
      if (dbg) look.bg = dbg;
      dxfs.push(look);
    }
    list = kids(kid(ss, "cellXfs"), "xf");
    for (i = 0; i < list.length; i++) xfs.push(list[i]);
    var styleCache = {};
    function style(s) {
      if (own(styleCache, s)) return styleCache[s];
      var x = xfs[s], out = {fmt: null, kind: null, num: null};
      if (x) {
        var f = {}, fo = fonts[+x.a.fontId || 0], fl = fills[+x.a.fillId || 0], al = kid(x, "alignment");
        if (fo) {
          if (fo.bold) f.bold = true; if (fo.italic) f.italic = true; if (fo.underline) f.underline = true;
          if (fo.fg) f.fg = fo.fg;
        }
        if (fl) f.bg = fl;
        if (al) {
          var h = al.a.horizontal === "centerContinuous" ? "center" : al.a.horizontal;
          if (h === "left" || h === "center" || h === "right") f.align = h;
          if (truthy(al.a.wrapText)) f.wrap = true;
        }
        if (edges[+x.a.borderId || 0]) f.bd = edges[+x.a.borderId || 0];
        var nid = +x.a.numFmtId || 0, code = own(numFmts, nid) ? numFmts[nid] : BUILTIN[nid];
        out.kind = dateKind(nid, code);
        out.num = nid === 14 || nid === 22 ? null : normNum(code);
        if (out.num === DATE_FMT || out.num === DATETIME_FMT) out.num = null;
        out.withTime = out.kind === "time" || (out.kind === "date" && (nid === 22 || /h/i.test((code || "").replace(/"[^"]*"/g, ""))));
        out.fmt = f;
      }
      return (styleCache[s] = out);
    }

    var book = {sheets: []}, sheetEls = kids(kid(wb, "sheets"), "sheet");
    for (var si = 0; si < sheetEls.length; si++) {
      var se = sheetEls[si], rel = wbRels[se.a["r:id"] || se.a.id];
      if (!rel || rel.type !== "worksheet") continue;
      var wx = part(rel.target), ws = wx && kid(wx, "worksheet");
      if (!ws) continue;
      book.sheets.push(readSheet(se.a.name || "Sheet" + (si + 1), ws));
    }
    return book;

    function readSheet(name, ws) {
      var cells = {}, fmt = {}, vals = {}, cols = {}, freeze = {rows: 0, cols: 0}, masters = {};
      var rows = kids(kid(ws, "sheetData"), "row"), rc = -1;
      for (var ri = 0; ri < rows.length; ri++) {
        var row = rows[ri], r = row.a.r ? +row.a.r - 1 : rc + 1, cc = -1;
        rc = r;
        var cs = kids(row, "c");
        for (var ci = 0; ci < cs.length; ci++) {
          var c = cs[ci], p = c.a.r ? parseCell(c.a.r) : {r: r, c: cc + 1};
          if (!p) continue;
          cc = p.c;
          var key = colName(p.c) + (p.r + 1), t = c.a.t || "n", vn = kid(c, "v"), raw = vn ? txt(vn) : null, v = null;
          if (t === "s") v = raw !== null && sst[+raw] !== undefined ? sst[+raw] : null;
          else if (t === "inlineStr") v = xstr(txt(kid(c, "is"), NO_PHONETIC));
          else if (t === "str") v = raw !== null ? xstr(raw) : null;
          else if (t === "b") v = raw === null ? null : raw === "1" || raw === "true";
          else if (t === "e") v = raw;
          else if (t === "d") v = raw;
          else if (raw !== null && raw !== "") { v = parseFloat(raw); if (!isFinite(v)) v = null; }
          var sx = style(+c.a.s || 0);
          var fe = kid(c, "f"), ftext = null;
          if (fe) {
            ftext = txt(fe);
            if (fe.a.t === "shared" && fe.a.si !== undefined) {
              if (/\S/.test(ftext)) masters[fe.a.si] = {f: ftext, r: p.r, c: p.c};
              else ftext = masters[fe.a.si] ? shiftFormula(masters[fe.a.si].f, p.r - masters[fe.a.si].r, p.c - masters[fe.a.si].c) : null;
            } else if (fe.a.t === "dataTable") ftext = null;
            if (ftext !== null && !/\S/.test(ftext)) ftext = null;
          }
          if (ftext !== null) {
            cells[key] = fromFileFormula(ftext);
            if (v !== null && v !== undefined) vals[key] = t === "e" ? {error: v} : v;
          } else if (v !== null && v !== "") {
            if (typeof v === "number" && sx.kind && (sx.kind === "date" || v + offset >= 1)) {
              var iso = serialToIso(v + offset, sx.withTime);
              if (iso) v = iso;
            } else if (t === "d" && typeof v === "string") {
              var dm = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(v);
              if (dm) v = dm[1] + (dm[2] && dm[2] !== "00:00" ? "T" + dm[2] : "");
            }
            cells[key] = v;
          }
          if (sx.fmt) {
            var f = {}, any = false, k2;
            for (k2 in sx.fmt) if (own(sx.fmt, k2)) { f[k2] = sx.fmt[k2]; any = true; }
            if (sx.num) { f.num = sx.num; any = true; }
            if (any) fmt[key] = f;
          }
        }
      }
      var cl = kids(kid(ws, "cols"), "col");
      for (var i = 0; i < cl.length; i++) {
        var a = cl[i].a, w = parseFloat(a.width);
        if (!(w > 0) || truthy(a.hidden)) continue;
        for (var n = Math.max(1, +a.min || 1); n <= Math.min(+a.max || +a.min || 1, 100); n++) cols[colName(n - 1)] = Math.round(w * 7 + 5);
      }
      var views = kids(kid(ws, "sheetViews"), "sheetView");
      for (i = 0; i < views.length; i++) {
        var pn = kid(views[i], "pane");
        if (pn && (pn.a.state === "frozen" || pn.a.state === "frozenSplit")) {
          freeze = {rows: Math.max(0, Math.round(+pn.a.ySplit || 0)), cols: Math.max(0, Math.round(+pn.a.xSplit || 0))};
          break;
        }
      }
      // dropdowns: list validations with their items inline, over at most 200 rows past the data
      var dv = kids(kid(ws, "dataValidations"), "dataValidation");
      for (i = 0; i < dv.length; i++) {
        var src = txt(kid(dv[i], "formula1")).trim(), refs = String(dv[i].a.sqref || "").split(/\s+/);
        if (dv[i].a.type !== "list" || src.length < 3 || src.charAt(0) !== '"' || src.charAt(src.length - 1) !== '"') continue;
        var opts = [], parts = src.slice(1, -1).replace(/""/g, '"').split(",");
        for (var oi = 0; oi < parts.length && opts.length < 50; oi++) {
          var o = xstr(parts[oi]).trim().slice(0, 60);
          if (o && opts.indexOf(o) < 0) opts.push(o);
        }
        for (var qi = 0; qi < refs.length && opts.length; qi++) {
          var ends = refs[qi].split(":"), p1 = parseCell(ends[0].replace(/\$/g, "")), p2 = parseCell((ends[1] || ends[0]).replace(/\$/g, ""));
          if (!p1 || !p2) continue;
          for (var rr = p1.r; rr <= Math.min(p2.r, Math.max(rc, p1.r) + 200, 4999); rr++)
            for (var c2 = p1.c; c2 <= Math.min(p2.c, 99); c2++) {
              var dk = colName(c2) + (rr + 1);
              (fmt[dk] = fmt[dk] || {}).options = opts;
            }
        }
      }
      // merged cells; conditional formats: expression rules with a look we model, 2- and 3-colour scales
      var merges = [], mc = kids(kid(ws, "mergeCells"), "mergeCell");
      for (i = 0; i < mc.length && merges.length < 500; i++) {
        var mb = clip(parseBox(mc[i].a.ref));
        if (mb && (mb.r1 !== mb.r2 || mb.c1 !== mb.c2)) merges.push(boxName(mb));
      }
      var found = [], cfs = kids(ws, "conditionalFormatting");
      for (i = 0; i < cfs.length; i++) {
        var boxes = [], sq = String(cfs[i].a.sqref || "").split(/\s+/), crs = kids(cfs[i], "cfRule");
        for (var bi = 0; bi < sq.length; bi++) { var cb = clip(parseBox(sq[bi])); if (cb) boxes.push(cb); }
        for (var ki = 0; ki < crs.length && boxes.length; ki++) {
          var cr = crs[ki], one = null;
          if (cr.a.type === "expression") {
            var ft = txt(kid(cr, "formula")).trim(), lk = dxfs[+cr.a.dxfId];
            if (ft && cr.a.dxfId !== undefined && lk && (lk.bg || lk.fg || lk.bold || lk.strike)) { one = {"if": fromFileFormula(ft)}; for (var lk2 in lk) one[lk2] = lk[lk2]; }
          } else if (cr.a.type === "colorScale") {
            var cc2 = kids(kid(cr, "colorScale"), "color"), scale = [];
            for (var si2 = 0; si2 < cc2.length; si2++) scale.push(rgb(cc2[si2]));
            if ((scale.length === 2 || scale.length === 3) && scale.indexOf(null) < 0) one = {scale: scale};
          }
          for (bi = 0; one && bi < boxes.length; bi++) {
            var rule = {range: boxName(boxes[bi])}, rk;
            for (rk in one) rule[rk] = one[rk];
            if (rule["if"]) {  // the formula is written for the first range's first cell
              var moved = shiftFormula(rule["if"].slice(1), boxes[bi].r1 - boxes[0].r1, boxes[bi].c1 - boxes[0].c1);
              if (moved === null || moved.length > 499) continue;
              rule["if"] = "=" + moved;
            }
            found.push({p: +cr.a.priority || 0, i: found.length, r: rule});
          }
        }
      }
      found.sort(function (a, b) { return b.p - a.p || a.i - b.i; });
      var rules = [];
      for (i = Math.max(0, found.length - 50); i < found.length; i++) rules.push(found[i].r);
      return {name: name, cells: cells, fmt: fmt, vals: vals, cols: cols, freeze: freeze, merges: merges, rules: rules};
    }
    // A box cut to what a sheet holds (null: outside it).
    function clip(b) {
      if (!b || b.r1 > 4999 || b.c1 > 99) return null;
      return {r1: b.r1, c1: b.c1, r2: Math.min(b.r2, 4999), c2: Math.min(b.c2, 99)};
    }
  }

  // ---- CSV ----
  function csvField(v, sep) {
    var s;
    if (v === null || v === undefined) s = "";
    else if (typeof v === "number") { s = isFinite(v) ? String(v) : "#NUM!"; if (sep === ";") s = s.replace(".", ","); }
    else if (typeof v === "boolean") s = v ? "TRUE" : "FALSE";
    else if (typeof v === "object") s = v.error ? String(v.error) : "";
    else s = String(v);
    return s.indexOf(sep) >= 0 || /["\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(sheet, vals, sep) {
    sheet = sheet || {};
    sep = sep || ",";
    vals = vals || sheet.vals || {};
    var cells = sheet.cells || {}, grid = {}, maxR = -1, maxC = -1, k, p;
    for (k in cells) {
      if (!own(cells, k) || !(p = parseCell(k))) continue;
      var v = cells[k];
      if (v === null || v === undefined || v === "") continue;
      if (isFormula(v) && own(vals, k)) v = vals[k]; // without a computed value the formula text goes out
      (grid[p.r] = grid[p.r] || {})[p.c] = v;
      if (p.r > maxR) maxR = p.r; if (p.c > maxC) maxC = p.c;
    }
    var out = "";
    for (var r = 0; r <= maxR; r++) {
      var line = [], row = grid[r] || {};
      for (var c = 0; c <= maxC; c++) line.push(csvField(own(row, c) ? row[c] : null, sep));
      out += line.join(sep) + "\r\n";
    }
    return out;
  }
  function sniff(text) {
    var seps = [",", ";", "\t"], counts = {",": [], ";": [], "\t": []}, cur = {",": 0, ";": 0, "\t": 0};
    var q = false, lines = 0, filled = false, i, s;
    function flush() {
      if (filled) for (var j = 0; j < 3; j++) counts[seps[j]].push(cur[seps[j]]);
      cur = {",": 0, ";": 0, "\t": 0}; filled = false; lines++;
    }
    for (i = 0; i < text.length && lines < 30; i++) {
      var ch = text.charAt(i);
      if (ch === '"') { q = !q; filled = true; }
      else if (!q && (ch === "\n" || ch === "\r")) { if (ch === "\r" && text.charAt(i + 1) === "\n") i++; flush(); }
      else { filled = true; if (!q && own(cur, ch)) cur[ch]++; }
    }
    flush();
    var best = ",", bestScore = -1;
    for (i = 0; i < 3; i++) {
      s = seps[i];
      var c = counts[s], first = c.length ? c[0] : 0, agree = 0;
      if (!first) continue;
      for (var j = 0; j < c.length; j++) if (c[j] === first) agree++;
      var score = agree / c.length * 1000 + first;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }
  function parseCsv(t, sep) {
    var rows = [], row = [], f = "", i = 0, L = t.length, q = false, quoted = false;
    while (i < L) {
      var ch = t.charAt(i);
      if (q) {
        if (ch === '"') { if (t.charAt(i + 1) === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
        f += ch; i++; continue;
      }
      if (ch === '"' && f === "" && !quoted) { q = quoted = true; i++; continue; }
      if (ch === sep) { row.push(f); f = ""; quoted = false; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        row.push(f); rows.push(row); row = []; f = ""; quoted = false;
        i += ch === "\r" && t.charAt(i + 1) === "\n" ? 2 : 1;
        continue;
      }
      f += ch; i++;
    }
    if (f !== "" || row.length || quoted) { row.push(f); rows.push(row); }
    return rows;
  }
  function csvValue(f, sep) {
    var t = f.replace(/^\s+|\s+$/g, "");
    if (!t) return f;
    if (ISO.test(t)) return t;
    var re = sep === "," ? /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/
      : sep === ";" ? /^[-+]?(\d+,?\d*|,\d+)([eE][-+]?\d+)?$/
      : /^[-+]?(\d+[.,]?\d*|[.,]\d+)([eE][-+]?\d+)?$/;
    if (re.test(t) && !/^[-+]?0\d/.test(t)) {
      var n = parseFloat(t.replace(",", "."));
      if (isFinite(n)) return n;
    }
    return f;
  }
  function fromCsv(text) {
    text = String(text == null ? "" : text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var sep = sniff(text), rows = parseCsv(text, sep), cells = {};
    for (var r = 0; r < rows.length && r < 1048576; r++) {
      for (var c = 0; c < rows[r].length && c < 16384; c++) {
        if (rows[r][c] === "") continue;
        cells[colName(c) + (r + 1)] = csvValue(rows[r][c], sep);
      }
    }
    return {cells: cells};
  }

  var api = {write: write, read: read, toCsv: toCsv, fromCsv: fromCsv,
    // small helpers, exposed for tests and the page
    shiftFormula: shiftFormula, isoToSerial: isoToSerial, serialToIso: serialToIso, parseXml: parseXml, listRuns: listRuns};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.sheetXlsx = api;
})();
