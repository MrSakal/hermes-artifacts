/* Sheet formula engine: parser, lazy evaluator, number formats and typed-input parsing.
   Pure JS, no DOM: window.sheetFormula in the page, module.exports under node. */
(function (root) {
  'use strict';

  var MAX_COLS = 16384, MAX_ROWS = 1048576, DEF_ROWS = 5000, DEF_COLS = 100, DEEP = 120;
  var isArray = Array.isArray;

  // ---------- errors (shared, frozen)
  var E = {};
  ['#DIV/0!', '#NAME?', '#REF!', '#VALUE!', '#N/A', '#NUM!', '#CYCLE!', '#NULL!'].forEach(function (c) {
    E[c] = Object.freeze({ error: c });
  });
  function isErr(v) { return v !== null && typeof v === 'object' && typeof v.error === 'string'; }
  var SYN = { syntax: true };

  // ---------- columns and ranges (0-based)
  var COLN = [];
  function colName(n) {
    n = Math.floor(n);
    if (!(n >= 0)) return '';
    if (n < 1024 && COLN[n]) return COLN[n];
    var s = '', x = n + 1;
    while (x > 0) { var m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
    if (n < 1024) COLN[n] = s;
    return s;
  }
  function colIndex(s) {
    s = String(s).toUpperCase().replace(/\$/g, '');
    if (!s) return -1;
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i) - 64;
      if (c < 1 || c > 26) return -1;
      n = n * 26 + c;
    }
    return n - 1;
  }

  var RE_CELL = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)(?::(\$?)([A-Za-z]{1,3})(\$?)([0-9]+))?/;
  var RE_COLS = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/;
  var RE_ROWS = /^(\$?)([0-9]+):(\$?)([0-9]+)/;
  var RE_WORD = /^[A-Za-z_\\À-\uffff][A-Za-z0-9_.À-\uffff]*/;
  var RE_NUM = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/;
  var RE_ERR = /^#(?:DIV\/0!|N\/A|NAME\?|REF!|VALUE!|NUM!|NULL!|CYCLE!)/i;
  var RE_BOUND = /[A-Za-z0-9_.(!$À-\uffff]/;

  function bound(src, j) { var ch = src.charAt(j); return !ch || !RE_BOUND.test(ch); }
  function cpart(ca, c, ra, r) {
    var p = { ca: !!ca, c: colIndex(c), ra: !!ra, r: +r - 1 };
    return p.c >= 0 && p.c < MAX_COLS && p.r >= 0 && p.r < MAX_ROWS ? p : null;
  }
  // A reference at src[j]: {n, kind: cell|col|row|err, a, b}
  function matchRef(src, j) {
    var rest = src.slice(j), m, a, b;
    if ((m = RE_CELL.exec(rest)) && bound(src, j + m[0].length)) {
      a = cpart(m[1], m[2], m[3], m[4]);
      b = m[6] ? cpart(m[5], m[6], m[7], m[8]) : null;
      if (a && (b || !m[6])) return { n: m[0].length, kind: 'cell', a: a, b: b };
    }
    if ((m = RE_COLS.exec(rest)) && bound(src, j + m[0].length)) {
      a = { ca: !!m[1], c: colIndex(m[2]) }; b = { ca: !!m[3], c: colIndex(m[4]) };
      if (a.c < MAX_COLS && b.c < MAX_COLS) return { n: m[0].length, kind: 'col', a: a, b: b };
    }
    if ((m = RE_ROWS.exec(rest)) && bound(src, j + m[0].length)) {
      a = { ra: !!m[1], r: +m[2] - 1 }; b = { ra: !!m[3], r: +m[4] - 1 };
      if (a.r >= 0 && b.r >= 0 && a.r < MAX_ROWS && b.r < MAX_ROWS) return { n: m[0].length, kind: 'row', a: a, b: b };
    }
    if (/^#REF!/i.test(rest)) return { n: 5, kind: 'err' };
    return null;
  }

  function parseRange(text) {
    if (typeof text !== 'string') return null;
    var t = text.trim(), sheet, k = t.lastIndexOf('!');
    if (k >= 0) {
      sheet = t.slice(0, k);
      if (sheet.charAt(0) === "'" && sheet.charAt(sheet.length - 1) === "'") sheet = sheet.slice(1, -1).replace(/''/g, "'");
      t = t.slice(k + 1);
    }
    var r = matchRef(t, 0);
    if (!r || r.kind === 'err' || r.n !== t.length) return null;
    var a = r.a, b = r.b || r.a, o;
    if (r.kind === 'cell') o = { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
    else if (r.kind === 'col') o = { r1: 0, c1: Math.min(a.c, b.c), r2: DEF_ROWS - 1, c2: Math.max(a.c, b.c) };
    else o = { r1: Math.min(a.r, b.r), c1: 0, r2: Math.max(a.r, b.r), c2: DEF_COLS - 1 };
    if (sheet !== undefined) o.sheet = sheet;
    return o;
  }
  function rangeName(r1, c1, r2, c2) {
    if (r1 && typeof r1 === 'object') { c1 = r1.c1; r2 = r1.r2; c2 = r1.c2; r1 = r1.r1; }
    var a = colName(c1) + (r1 + 1);
    if (r2 === undefined || c2 === undefined || (r2 === r1 && c2 === c1)) return a;
    return a + ':' + colName(c2) + (r2 + 1);
  }

  // ---------- Hungarian aliases (Excel hu names -> English)
  var ALIAS = {};
  ('SZUM SUM|ÁTLAG AVERAGE|DARAB COUNT|DARAB2 COUNTA|DARABÜRES COUNTBLANK|SZORZAT PRODUCT|MEDIÁN MEDIAN|' +
   'SZÓRÁS STDEV|SZÓRÁS.M STDEV|VAR.M VAR|KEREKÍTÉS ROUND|KEREK.FEL ROUNDUP|KEREK.LE ROUNDDOWN|GYÖK SQRT|' +
   'HATVÁNY POWER|MARADÉK MOD|PLAFON CEILING|PADLÓ FLOOR|ELŐJEL SIGN|VÉL RAND|VÉLETLEN.KÖZÖTT RANDBETWEEN|' +
   'HA IF|HAELSŐIGAZ IFS|ÉS AND|VAGY OR|NEM NOT|XVAGY XOR|HAHIBA IFERROR|HAHIÁNYZIK IFNA|ÜRES ISBLANK|' +
   'SZÁM ISNUMBER|SZÖVEG.E ISTEXT|HIBÁS ISERROR|NINCS NA|NINCS.E ISNA|LOGIKAI ISLOGICAL|ÁTVÁLT SWITCH|' +
   'SZUMHA SUMIF|SZUMHATÖBB SUMIFS|DARABTELI COUNTIF|DARABHATÖBB COUNTIFS|ÁTLAGHA AVERAGEIF|' +
   'ÁTLAGHATÖBB AVERAGEIFS|SZORZATÖSSZEG SUMPRODUCT|MAXHA MAXIFS|MINHA MINIFS|FKERES VLOOKUP|VKERES HLOOKUP|' +
   'XKERES XLOOKUP|HOL.VAN MATCH|VÁLASZT CHOOSE|SOR ROW|OSZLOP COLUMN|SOROK ROWS|OSZLOPOK COLUMNS|FŰZ CONCAT|' +
   'ÖSSZEFŰZ CONCATENATE|SZÖVEGÖSSZEFŰZÉS TEXTJOIN|BAL LEFT|JOBB RIGHT|KÖZÉP MID|HOSSZ LEN|KISBETŰ LOWER|' +
   'NAGYBETŰS UPPER|TNÉV PROPER|KIMETSZ TRIM|HELYETTE SUBSTITUTE|CSERE REPLACE|SZÖVEG.TALÁL FIND|' +
   'SZÖVEG.KERES SEARCH|SZÖVEG TEXT|ÉRTÉK VALUE|SOKSZOR REPT|AZONOS EXACT|MA TODAY|MOST NOW|DÁTUM DATE|ÉV YEAR|' +
   'HÓNAP MONTH|NAP DAY|HÉT.NAPJA WEEKDAY|HÉT.SZÁMA WEEKNUM|KALK.DÁTUM EDATE|HÓNAP.UTOLSÓ.NAP EOMONTH|' +
   'DÁTUMTÓLIG DATEDIF|NAPOK DAYS|ÖSSZ.MUNKANAP NETWORKDAYS|RÉSZLET PMT|JBÉ FV|MÉ PV|NMÉ NPV|BMR IRR|' +
   'CSONK TRUNC|KITEVŐ EXP|IGAZ TRUE|HAMIS FALSE').split('|').forEach(function (p) {
    var x = p.split(' '); ALIAS[x[0]] = x[1];
  });
  function canonFn(word) {
    var up = word.toUpperCase();
    if (up.indexOf('_XLFN.') === 0) up = up.slice(6);
    if (up.indexOf('_XLWS.') === 0) up = up.slice(6);
    return ALIAS[up] || up;
  }

  // ---------- lexer
  function isWordStart(ch) { return /[A-Za-z_\\À-\uffff]/.test(ch); }
  function refTok(sheet, s, rs, r) {
    return { k: 'ref', sheet: sheet, s: s, rs: rs, e: rs + r.n, kind: r.kind, a: r.a, b: r.b };
  }
  function lex(src) {
    var toks = [], i = 0, n = src.length, m, ch, j, r, s, c2;
    while (i < n) {
      ch = src.charAt(i); s = i;
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\u00a0') { i++; continue; }
      if (ch === '"') {
        var v = ''; j = i + 1;
        for (;;) {
          if (j >= n) throw SYN;
          c2 = src.charAt(j);
          if (c2 === '"') { if (src.charAt(j + 1) === '"') { v += '"'; j += 2; continue; } break; }
          v += c2; j++;
        }
        toks.push({ k: 'str', v: v, s: s, e: j + 1 }); i = j + 1; continue;
      }
      if (ch === "'") {
        var name = ''; j = i + 1;
        for (;;) {
          if (j >= n) throw SYN;
          c2 = src.charAt(j);
          if (c2 === "'") { if (src.charAt(j + 1) === "'") { name += "'"; j += 2; continue; } break; }
          name += c2; j++;
        }
        j++;
        if (src.charAt(j) !== '!') throw SYN;
        j++;
        r = matchRef(src, j);
        if (!r) throw SYN;
        toks.push(refTok(name, s, j, r)); i = j + r.n; continue;
      }
      if (ch === '#') {
        m = RE_ERR.exec(src.slice(i));
        if (!m) throw SYN;
        toks.push({ k: 'err', v: m[0].toUpperCase(), s: s, e: i + m[0].length }); i += m[0].length; continue;
      }
      var digit = ch >= '0' && ch <= '9';
      if (digit || ch === '.' || ch === '$' || isWordStart(ch)) {
        if (!digit && ch !== '.' && ch !== '$') {
          m = RE_WORD.exec(src.slice(i));
          var after = src.charAt(i + m[0].length);
          if (after === '!') {
            j = i + m[0].length + 1;
            r = matchRef(src, j);
            if (!r) throw SYN;
            toks.push(refTok(m[0], s, j, r)); i = j + r.n; continue;
          }
          if (after === '(') { toks.push({ k: 'fn', v: canonFn(m[0]), s: s, e: i + m[0].length }); i += m[0].length; continue; }
        }
        r = matchRef(src, i);
        if (r && r.kind !== 'err') { toks.push(refTok(null, s, i, r)); i += r.n; continue; }
        if (digit || ch === '.') {
          m = RE_NUM.exec(src.slice(i));
          if (!m) throw SYN;
          toks.push({ k: 'num', v: parseFloat(m[0]), s: s, e: i + m[0].length }); i += m[0].length; continue;
        }
        if (ch === '$') throw SYN;
        m = RE_WORD.exec(src.slice(i));
        var up = m[0].toUpperCase();
        if (up === 'TRUE' || up === 'IGAZ') toks.push({ k: 'bool', v: true, s: s, e: i + m[0].length });
        else if (up === 'FALSE' || up === 'HAMIS') toks.push({ k: 'bool', v: false, s: s, e: i + m[0].length });
        else toks.push({ k: 'name', v: m[0], s: s, e: i + m[0].length });
        i += m[0].length; continue;
      }
      var two = src.substr(i, 2);
      if (two === '<=' || two === '>=' || two === '<>') { toks.push({ k: 'op', v: two, s: s, e: i + 2 }); i += 2; continue; }
      if ('+-*/^&=<>%:'.indexOf(ch) >= 0) { toks.push({ k: 'op', v: ch, s: s, e: i + 1 }); i++; continue; }
      if (ch === '(' || ch === ')') { toks.push({ k: ch, s: s, e: i + 1 }); i++; continue; }
      if (ch === ',' || ch === ';') { toks.push({ k: 'sep', s: s, e: i + 1 }); i++; continue; }
      throw SYN;
    }
    return toks;
  }

  // ---------- parser (Excel precedence: ':' , unary -, %, ^, * /, + -, &, comparisons)
  var CMP = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1 };
  function parseToks(toks) {
    var p = 0;
    function op(set) { var t = toks[p]; return t && t.k === 'op' && set[t.v] ? t.v : null; }
    function bin(next, set) {
      return function () {
        var l = next(), o;
        while ((o = op(set))) { p++; l = { t: 'bin', o: o, a: l, b: next() }; }
        return l;
      };
    }
    function primary() {
      var t = toks[p++];
      if (!t) throw SYN;
      switch (t.k) {
        case 'num': case 'str': case 'bool': return { t: 'v', v: t.v };
        case 'err': return { t: 'e', v: t.v };
        case 'name': return { t: 'name', v: t.v };
        case 'ref': return { t: 'ref', sheet: t.sheet, kind: t.kind, a: t.a, b: t.b };
        case '(': var x = cmp(); if (!toks[p] || toks[p].k !== ')') throw SYN; p++; return x;
        case 'fn':
          if (!toks[p] || toks[p].k !== '(') throw SYN;
          p++;
          var args = [];
          if (toks[p] && toks[p].k === ')') { p++; return { t: 'f', v: t.v, a: args }; }
          for (;;) {
            var nx = toks[p];
            if (!nx) throw SYN;
            args.push(nx.k === 'sep' || nx.k === ')' ? { t: 'miss' } : cmp());
            var d = toks[p++];
            if (!d) throw SYN;
            if (d.k === 'sep') continue;
            if (d.k === ')') break;
            throw SYN;
          }
          return { t: 'f', v: t.v, a: args };
      }
      throw SYN;
    }
    function rng() {
      var l = primary();
      while (op({ ':': 1 })) { p++; l = { t: 'rng', a: l, b: primary() }; }
      return l;
    }
    function un() {
      var o = op({ '-': 1, '+': 1 });
      if (o) { p++; return { t: 'u', o: o, a: un() }; }
      return rng();
    }
    function pct() {
      var l = un();
      while (op({ '%': 1 })) { p++; l = { t: 'pct', a: l }; }
      return l;
    }
    var pow = bin(pct, { '^': 1 }), mul = bin(pow, { '*': 1, '/': 1 }), add = bin(mul, { '+': 1, '-': 1 });
    var cat = bin(add, { '&': 1 }), cmp = bin(cat, CMP);
    var ast = cmp();
    if (p < toks.length) throw SYN;
    return ast;
  }

  var PC = Object.create(null), PCN = 0;
  function parse(text) {
    var a = PC[text];
    if (a) return a;
    try { a = parseToks(lex(text.charAt(0) === '=' ? text.slice(1) : text)); }
    catch (e) { if (e !== SYN) throw e; a = { t: 'e', v: '#NAME?' }; }
    if (++PCN > 50000) { PC = Object.create(null); PCN = 0; }
    PC[text] = a;
    return a;
  }

  // ---------- dates (1900 system, Excel's leap-year bug kept so serials match from 1900-03-01)
  var RE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
  var DAY = 864e5, EPOCH = Date.UTC(1899, 11, 30);
  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }
  function dim(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function ymd(y, m, d) {
    var s = Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY);
    return s < 61 ? s - 1 : s;
  }
  function isISO(s) { return typeof s === 'string' && s.length >= 10 && s.length <= 19 && RE_ISO.test(s) && isoSerial(s) !== null; }
  function isoSerial(s) {
    var m = RE_ISO.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > dim(y, mo)) return null;
    var t = m[4] !== undefined ? (+m[4] * 3600 + +m[5] * 60 + (+m[6] || 0)) : 0;
    if (t >= 86400) return null;
    return ymd(y, mo, d) + t / 86400;
  }
  function parts(serial) {
    var d = Math.floor(serial), secs = Math.round((serial - d) * 86400), y, m, dd;
    if (secs >= 86400) { d++; secs -= 86400; }
    if (d === 60) { y = 1900; m = 2; dd = 29; }
    else {
      var t = new Date(EPOCH + (d < 60 ? d + 1 : d) * DAY);
      y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; dd = t.getUTCDate();
    }
    return { y: y, m: m, d: dd, H: Math.floor(secs / 3600), M: Math.floor(secs % 3600 / 60), S: secs % 60, wd: ((d % 7) + 13) % 7, day: d };
  }
  function toISO(serial) {
    if (typeof serial !== 'number' || !(serial >= 1) || serial >= 2958466) return null;
    var p = parts(serial), s = pad(p.y, 4) + '-' + pad(p.m) + '-' + pad(p.d);
    if (p.H || p.M || p.S) s += 'T' + pad(p.H) + ':' + pad(p.M) + (p.S ? ':' + pad(p.S) : '');
    return s;
  }
  function dateOrNum(serial) { var s = toISO(serial); return s === null ? serial : s; }

  // ---------- numbers and text
  function textNum(s) {
    var t = s.trim();
    if (!t) return null;
    if (t.length >= 10 && RE_ISO.test(t)) return isoSerial(t);
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?%?$/.test(t)) {
      var pc = t.charAt(t.length - 1) === '%', x = parseFloat(pc ? t.slice(0, -1) : t);
      return pc ? x / 100 : x;
    }
    if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
    return null;
  }
  // General number text: 'disp' fits ~11 characters like a cell; 15 significant digits otherwise
  function expo(x, digits) {
    var e = x.toExponential(digits).split('e'), mant = e[0].indexOf('.') >= 0 ? e[0].replace(/\.?0+$/, '') : e[0], ex = +e[1];
    return mant + 'E' + (ex < 0 ? '-' : '+') + pad(Math.abs(ex));
  }
  function gen(x, disp, L) {
    var a = Math.abs(x), s;
    if (x === 0) s = '0';
    else if (a >= (disp ? 1e11 : 1e15) || a < 1e-9) s = expo(x, disp ? 5 : 14);
    else if (disp) {
      var p = 10;
      s = String(+x.toPrecision(p));
      while (s.replace('-', '').length > 11 && p > 1) { p--; s = String(+x.toPrecision(p)); }
      if (s.indexOf('e') >= 0) s = expo(x, 5);
    } else {
      s = String(+x.toPrecision(15));
      if (s.indexOf('e') >= 0) s = expo(x, 14);
    }
    return L === 'hu' ? s.replace('.', ',') : s;
  }
  function boolText(b, L) { return L === 'hu' ? (b ? 'IGAZ' : 'HAMIS') : (b ? 'TRUE' : 'FALSE'); }
  function shift(x, n) { var p = String(x).split('e'); return +(p[0] + 'e' + ((p[1] ? +p[1] : 0) + n)); }
  // mode 0 half away from zero, 1 away from zero, -1 toward zero
  function rnd(x, n, mode) {
    var sg = x < 0 ? -1 : 1, a = +Math.abs(x).toPrecision(15), y = shift(a, n);
    y = mode === 0 ? Math.round(y) : mode > 0 ? Math.ceil(y) : Math.floor(y);
    return sg * shift(y, -n);
  }
  function fix15(x) { return +x.toPrecision(15); }

  // ---------- comparisons
  function rank(v) { return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2; }
  function cmpNum(a, b) {
    if (a === b) return 0;
    var x = fix15(a), y = fix15(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function cmpStr(a, b) {
    var x = a.toLowerCase(), y = b.toLowerCase();
    if (x === y) return 0;
    var c = x.localeCompare(y);
    return c < 0 ? -1 : c > 0 ? 1 : (x < y ? -1 : 1);
  }
  function coerce2(a, b) {
    if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    if (typeof a === 'string' && typeof b === 'number' && isISO(a)) a = isoSerial(a);
    else if (typeof b === 'string' && typeof a === 'number' && isISO(b)) b = isoSerial(b);
    return [a, b];
  }
  function cmp(a, b) {
    var x = coerce2(a, b); a = x[0]; b = x[1];
    var ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (ra === 0) return cmpNum(a, b);
    if (ra === 1) return cmpStr(a, b);
    return a === b ? 0 : a ? 1 : -1;
  }
  // Same-kind comparison for lookups: null when kinds differ
  function cmpKind(a, b) {
    if (a === null || isErr(a)) return null;
    var x = coerce2(a, b);
    if (rank(x[0]) !== rank(x[1])) return null;
    return cmp(x[0], x[1]);
  }
  function wild(p) {
    var s = '';
    for (var i = 0; i < p.length; i++) {
      var ch = p.charAt(i);
      if (ch === '~' && i + 1 < p.length && '*?~'.indexOf(p.charAt(i + 1)) >= 0) s += '\\' + p.charAt(++i);
      else if (ch === '*') s += '[\\s\\S]*';
      else if (ch === '?') s += '[\\s\\S]';
      else s += ch.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    }
    return new RegExp('^' + s + '$', 'i');
  }

  // ---------- range values
  function Rng(sheet, r1, c1, r2, c2) {
    this.sheet = sheet; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2;
    this.h = r2 - r1 + 1; this.w = c2 - c1 + 1;
  }
  function multi(v) { return v instanceof Rng ? v.h > 1 || v.w > 1 : isArray(v) && (v.length > 1 || v[0].length > 1); }
  function first(v, cx) {
    if (v instanceof Rng) return cx.W.cell(v.sheet, v.r1, v.c1);
    if (isArray(v)) return v[0][0];
    return v;
  }
  // Scalar of a function argument: implicit intersection for a range
  function sc(v, cx) {
    if (v instanceof Rng) {
      if (v.h === 1 && v.w === 1) return cx.W.cell(v.sheet, v.r1, v.c1);
      if (v.w === 1 && cx.r >= v.r1 && cx.r <= v.r2) return cx.W.cell(v.sheet, cx.r, v.c1);
      if (v.h === 1 && cx.c >= v.c1 && cx.c <= v.c2) return cx.W.cell(v.sheet, v.r1, cx.c);
      return E['#VALUE!'];
    }
    if (isArray(v)) return v[0][0];
    return v === undefined ? null : v;
  }
  function arr(v, cx) {
    if (v instanceof Rng) return cx.W.mat(v);
    if (isArray(v)) return v;
    return [[v === undefined ? null : v]];
  }
  function toNum(v) {
    if (typeof v === 'number') return v;
    if (v === null) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') { var x = textNum(v); return x === null ? E['#VALUE!'] : x; }
    if (isErr(v)) return v;
    return E['#VALUE!'];
  }
  function num(v, cx) { var x = toNum(sc(v, cx)); if (isErr(x)) throw x; return x; }
  function int(v, cx) { return Math.trunc ? Math.trunc(num(v, cx)) : (function (x) { return x < 0 ? Math.ceil(x) : Math.floor(x); })(num(v, cx)); }
  function strOf(v, L) {
    if (typeof v === 'string') return v;
    if (v === null) return '';
    if (typeof v === 'number') return gen(v, false, L);
    if (typeof v === 'boolean') return boolText(v, L);
    if (isErr(v)) throw v;
    return String(v);
  }
  function str(v, cx) { return strOf(sc(v, cx), cx.L); }
  function bool(v, cx) {
    v = sc(v, cx);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v === null) return false;
    if (isErr(v)) throw v;
    var u = String(v).toUpperCase();
    if (u === 'TRUE' || u === 'IGAZ') return true;
    if (u === 'FALSE' || u === 'HAMIS') return false;
    throw E['#VALUE!'];
  }
  function opt(a, i) { return i < a.length && a[i] !== null && a[i] !== undefined; }
  // Every value of the arguments: fn(value, fromRangeOrArray)
  function each(a, cx, fn) {
    for (var i = 0; i < a.length; i++) {
      var v = a[i];
      if (v instanceof Rng || isArray(v)) {
        var t = arr(v, cx);
        for (var r = 0; r < t.length; r++) for (var c = 0; c < t[r].length; c++) fn(t[r][c], true);
      } else fn(v === undefined ? null : v, false);
    }
  }
  function rangeNum(x) {
    if (typeof x === 'number') return x;
    if (typeof x === 'string' && x.length >= 10 && RE_ISO.test(x)) return isoSerial(x);
    return null;
  }
  // Numbers of the arguments: ranges keep numbers (and dates), direct args coerce
  function nums(a, cx) {
    var out = [];
    each(a, cx, function (x, inR) {
      if (isErr(x)) throw x;
      if (inR) { var n = rangeNum(x); if (n !== null) out.push(n); }
      else if (x !== null) { var y = toNum(x); if (isErr(y)) throw y; out.push(y); }
    });
    return out;
  }
  function sum(xs) { var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i]; return s; }

  // ---------- operators
  function binop(o, a, b, L) {
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    if (o === '&') return strOf(a, L) + strOf(b, L);
    if (CMP[o]) {
      var c = cmp(a, b);
      switch (o) {
        case '=': return c === 0; case '<>': return c !== 0; case '<': return c < 0;
        case '>': return c > 0; case '<=': return c <= 0; default: return c >= 0;
      }
    }
    var x = toNum(a), y = toNum(b), r;
    if (isErr(x)) return x;
    if (isErr(y)) return y;
    var da = typeof a === 'string' && isISO(a), db = typeof b === 'string' && isISO(b);
    switch (o) {
      case '+': r = x + y; if (da !== db) return dateOrNum(fix15(r)); break;
      case '-': r = x - y; if (da && !db) return dateOrNum(fix15(r)); break;
      case '*': r = x * y; break;
      case '/': if (y === 0) return E['#DIV/0!']; r = x / y; break;
      case '^': if (x === 0 && y === 0) return E['#NUM!']; r = Math.pow(x, y); break;
    }
    return isFinite(r) ? r : E['#NUM!'];
  }
  function pick(A, i, j) { var row = A.length === 1 ? A[0] : A[i]; if (!row) return undefined; return row.length === 1 ? row[0] : row[j]; }
  function lift2(o, a, b, cx) {
    if (!multi(a) && !multi(b)) return binop(o, first(a, cx), first(b, cx), cx.L);
    var A = arr(a, cx), B = arr(b, cx), h = Math.max(A.length, B.length), w = Math.max(A[0].length, B[0].length), out = [];
    for (var i = 0; i < h; i++) {
      var row = [];
      for (var j = 0; j < w; j++) {
        var x = pick(A, i, j), y = pick(B, i, j);
        row.push(x === undefined || y === undefined ? E['#N/A'] : binop(o, x, y, cx.L));
      }
      out.push(row);
    }
    return out;
  }
  function lift1(v, fn, cx) {
    if (!multi(v)) return fn(first(v, cx));
    return arr(v, cx).map(function (row) { return row.map(fn); });
  }
  function neg(v) { var x = toNum(v); return isErr(x) ? x : -x; }
  function pctOf(v) { var x = toNum(v); return isErr(x) ? x : x / 100; }

  // ---------- evaluation
  function ev(n, cx) {
    switch (n.t) {
      case 'v': return n.v;
      case 'e': return E[n.v];
      case 'miss': return null;
      case 'name': return E['#NAME?'];
      case 'ref': return mkRange(n, cx);
      case 'rng':
        var a = ev(n.a, cx), b = ev(n.b, cx);
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        if (!(a instanceof Rng) || !(b instanceof Rng) || a.sheet !== b.sheet) return E['#VALUE!'];
        return new Rng(a.sheet, Math.min(a.r1, b.r1), Math.min(a.c1, b.c1), Math.max(a.r2, b.r2), Math.max(a.c2, b.c2));
      case 'u': var u = ev(n.a, cx); return n.o === '-' ? lift1(u, neg, cx) : u;
      case 'pct': return lift1(ev(n.a, cx), pctOf, cx);
      case 'bin': return lift2(n.o, ev(n.a, cx), ev(n.b, cx), cx);
      case 'f':
        var d = F[n.v];
        if (!d) return E['#NAME?'];
        if (d.vol) cx.W.volatile();
        if (n.a.length < d.min || n.a.length > d.max) return E['#VALUE!'];
        try {
          var r;
          if (d.lazy) r = d.fn(n.a, cx);
          else {
            var args = new Array(n.a.length);
            for (var i = 0; i < n.a.length; i++) args[i] = ev(n.a[i], cx);
            r = d.fn(args, cx);
          }
          return r === undefined ? null : r;
        } catch (e) { if (isErr(e)) return e; throw e; }
    }
    return E['#VALUE!'];
  }
  function mkRange(n, cx) {
    if (n.kind === 'err') return E['#REF!'];
    var W = cx.W, sh = n.sheet === null ? cx.sheet : W.resolve(n.sheet);
    if (!sh) return E['#REF!'];
    var a = n.a, b = n.b || n.a, x;
    if (n.kind === 'cell') return new Rng(sh, Math.min(a.r, b.r), Math.min(a.c, b.c), Math.max(a.r, b.r), Math.max(a.c, b.c));
    x = W.ext(sh);
    if (n.kind === 'col') return new Rng(sh, 0, Math.min(a.c, b.c), x.rows - 1, Math.max(a.c, b.c));
    return new Rng(sh, Math.min(a.r, b.r), 0, Math.max(a.r, b.r), x.cols - 1);
  }
  function finish(v, cx) {
    if (v instanceof Rng || isArray(v)) v = first(v, cx);
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return isFinite(v) ? fix15(v) : E['#NUM!'];
    return v;
  }

  function Deep(s, key, r, c) { this.s = s; this.key = key; this.r = r; this.c = c; }

  function workbook(getCell, sheetNames, extent, opts) {
    if (extent && typeof extent === 'object') { opts = extent; extent = null; }
    var L = opts && opts.locale === 'hu' ? 'hu' : 'en';
    var cache, mats, exts, names, busy, depth = 0, gen = 0;
    // What each computed formula read, so that changing a few cells recomputes only what follows
    // from them (invalidateCells): readers['S!A1'] = {formula id: 1}; ranges[S]['r1,c1,r2,c2'] =
    // {r1, c1, r2, c2, by}; extReaders: formulas that read a sheet's extent (whole rows / columns);
    // vol: formulas that are recomputed every time (NOW, RAND, a cycle); at[id] = [sheet, key, r, c].
    // reading: the formula being computed now (null while a range is read on its behalf).
    var readers, ranges, extReaders, vol, at, reading;
    function reset() {
      cache = Object.create(null); mats = Object.create(null); exts = Object.create(null);
      names = null; busy = Object.create(null); depth = 0; gen++;
      readers = Object.create(null); ranges = Object.create(null); extReaders = Object.create(null);
      vol = Object.create(null); at = Object.create(null); reading = [];
    }
    function reader() { return reading.length ? reading[reading.length - 1] : null; }
    function note(map, k, f) { (map[k] || (map[k] = Object.create(null)))[f] = 1; }
    reset();
    function resolve(name) {
      if (!names) {
        names = Object.create(null);
        var list = (sheetNames && sheetNames()) || [];
        for (var i = 0; i < list.length; i++) names[String(list[i]).toLowerCase()] = String(list[i]);
      }
      return names[String(name).toLowerCase()] || null;
    }
    function ext(sh) {
      var f = reader();
      if (f) note(extReaders, sh, f);
      var x = exts[sh];
      if (x) return x;
      var e = extent ? extent(sh) : null;
      x = e ? { rows: Math.max(1, Math.min(MAX_ROWS, e.rows | 0)), cols: Math.max(1, Math.min(MAX_COLS, e.cols | 0)) }
            : { rows: DEF_ROWS, cols: DEF_COLS };
      exts[sh] = x;
      return x;
    }
    function get(sh, key, r, c) {
      var f = reader();
      if (f) note(readers, sh + '!' + key, f);
      var m = cache[sh];
      if (m) { var hit = m[key]; if (hit !== undefined) return hit; }
      var v = getCell(sh, key);
      if (typeof v === 'string' && v.length > 1 && v.charAt(0) === '=') return formula(sh, key, r, c, v);
      return v === undefined || v === '' ? null : v;
    }
    function formula(sh, key, r, c, text) {
      var id = sh + '!' + key;
      if (busy[id]) return E['#CYCLE!'];
      if (depth >= DEEP) throw new Deep(sh, key, r, c);
      busy[id] = 1; depth++;
      at[id] = [sh, key, r, c]; reading.push(id);
      var v;
      try { v = finish(ev(parse(text), { W: W, sheet: sh, r: r, c: c, L: L }), { W: W }); }
      finally { busy[id] = 0; depth--; reading.pop(); }
      (cache[sh] || (cache[sh] = Object.create(null)))[key] = v;
      return v;
    }
    function cell(sh, r, c) { return get(sh, colName(c) + (r + 1), r, c); }
    function mat(g) {
      var rk = g.r1 + ',' + g.c1 + ',' + g.r2 + ',' + g.c2, k = g.sheet + '|' + rk, out = mats[k], f = reader();
      var rs = ranges[g.sheet] || (ranges[g.sheet] = Object.create(null));
      var dep = rs[rk] || (rs[rk] = { r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2, by: Object.create(null) });
      if (f) dep.by[f] = 1;
      if (out) return out;
      out = [];
      reading.push(null);  // the range is noted once above, not cell by cell
      try {
        for (var r = g.r1; r <= g.r2; r++) {
          var row = new Array(g.w);
          for (var c = g.c1; c <= g.c2; c++) row[c - g.c1] = cell(g.sheet, r, c);
          out.push(row);
        }
      } finally { reading.pop(); }
      if (g.h * g.w > 1) mats[k] = out;
      return out;
    }
    // Forget the values that follow from these cells of one sheet (typed values or formulas
    // changed there); everything when that would be most of the workbook.
    function invalidateCells(sheet, keys) {
      var sh = resolve(sheet);
      if (!sh || !keys) return reset();
      var todo = [], seen = Object.create(null), n = 0, f, x;
      function add(s, key, r, c) { var id = s + '!' + key; if (!seen[id]) { seen[id] = 1; todo.push([s, key, r, c, id]); } }
      function addF(id) { var a = at[id]; if (a) add(a[0], a[1], a[2], a[3]); }
      for (var i = 0; i < keys.length; i++) {
        var key = String(keys[i]).toUpperCase().replace(/\$/g, ''), m = /^([A-Z]{1,3})([0-9]+)$/.exec(key);
        if (m) add(sh, key, +m[2] - 1, colIndex(m[1]));
      }
      exts = Object.create(null);  // a sheet's extent may have changed
      for (x in extReaders) for (f in extReaders[x]) addF(f);
      for (f in vol) addF(f);
      while (todo.length) {
        if (++n > 20000) return reset();
        var t = todo.pop(), s = t[0], r = t[2], c = t[3], rs = ranges[s];
        if (cache[s]) delete cache[s][t[1]];
        if (readers[t[4]]) for (f in readers[t[4]]) addF(f);
        if (rs) for (x in rs) {
          var g = rs[x];
          if (r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) { delete mats[s + '|' + x]; for (f in g.by) addF(f); }
        }
      }
    }
    // Deep dependency chains are resolved bottom-up from an explicit stack instead of the JS stack
    function value(sheet, key) {
      var sh = resolve(sheet);
      if (!sh) return E['#REF!'];
      var m0 = cache[sh], hit = m0 && m0[key];  // a formula already computed, asked by its plain key
      if (hit !== undefined) return hit;
      key = String(key).toUpperCase().replace(/\$/g, '');
      var m = /^([A-Z]{1,3})([0-9]+)$/.exec(key);
      if (!m) return E['#REF!'];
      var r = +m[2] - 1, c = colIndex(m[1]), deep;
      // Most chains fit the JS stack: the explicit one is built only when one does not.
      try { return get(sh, key, r, c); } catch (e) { if (!(e instanceof Deep)) throw e; deep = e; }
      var stack = [new Deep(sh, key, r, c)], on = Object.create(null);
      on[sh + '!' + key] = 1;
      for (;;) {
        if (deep) {
          depth = 0;
          var id = deep.s + '!' + deep.key;
          if (on[id]) {
            (cache[deep.s] || (cache[deep.s] = Object.create(null)))[deep.key] = E['#CYCLE!'];
            at[id] = [deep.s, deep.key, deep.r, deep.c]; vol[id] = 1;
          }
          else { on[id] = 1; stack.push(deep); }
          deep = null;
        }
        var t = stack[stack.length - 1];
        try {
          var v = get(t.s, t.key, t.r, t.c);
          stack.pop();
          on[t.s + '!' + t.key] = 0;  // not delete: that turns the map slow
          if (!stack.length) return v;
        } catch (e) {
          if (!(e instanceof Deep)) throw e;
          deep = e;
        }
      }
    }
    function volatile() { var f = reader(); if (f) vol[f] = 1; }
    var W = { cell: cell, mat: mat, resolve: resolve, ext: ext, volatile: volatile, L: L };
    return {
      value: value,
      invalidate: reset,
      invalidateCells: invalidateCells,
      generation: function () { return gen; },
      locale: L
    };
  }

  // ---------- functions
  var F = Object.create(null);
  function def(names, min, max, fn, lazy) {
    names.split(' ').forEach(function (n) { F[n] = { min: min, max: max, fn: fn, lazy: !!lazy }; });
  }
  var MANY = 255;

  // math
  def('SUM', 1, MANY, function (a, cx) { return sum(nums(a, cx)); });
  def('AVERAGE', 1, MANY, function (a, cx) { var x = nums(a, cx); if (!x.length) throw E['#DIV/0!']; return sum(x) / x.length; });
  def('MIN', 1, MANY, function (a, cx) { var x = nums(a, cx); return x.length ? Math.min.apply(null, x) : 0; });
  def('MAX', 1, MANY, function (a, cx) { var x = nums(a, cx); return x.length ? Math.max.apply(null, x) : 0; });
  def('PRODUCT', 1, MANY, function (a, cx) { var x = nums(a, cx), p = 1; for (var i = 0; i < x.length; i++) p *= x[i]; return x.length ? p : 0; });
  def('COUNT', 1, MANY, function (a, cx) {
    var n = 0;
    each(a, cx, function (x, inR) {
      if (inR ? rangeNum(x) !== null : (typeof x === 'number' || typeof x === 'boolean' || (typeof x === 'string' && textNum(x) !== null))) n++;
    });
    return n;
  });
  def('COUNTA', 1, MANY, function (a, cx) { var n = 0; each(a, cx, function (x) { if (x !== null) n++; }); return n; });
  def('COUNTBLANK', 1, 1, function (a, cx) { var n = 0; each(a, cx, function (x) { if (x === null || x === '') n++; }); return n; });
  def('MEDIAN', 1, MANY, function (a, cx) {
    var x = nums(a, cx).sort(function (p, q) { return p - q; }), k = x.length >> 1;
    if (!x.length) throw E['#NUM!'];
    return x.length % 2 ? x[k] : (x[k - 1] + x[k]) / 2;
  });
  function variance(a, cx) {
    var x = nums(a, cx);
    if (x.length < 2) throw E['#DIV/0!'];
    var m = sum(x) / x.length, s = 0;
    for (var i = 0; i < x.length; i++) s += (x[i] - m) * (x[i] - m);
    return s / (x.length - 1);
  }
  def('VAR VAR.S', 1, MANY, variance);
  def('STDEV STDEV.S', 1, MANY, function (a, cx) { return Math.sqrt(variance(a, cx)); });
  def('ROUND', 2, 2, function (a, cx) { return rnd(num(a[0], cx), int(a[1], cx), 0); });
  def('ROUNDUP', 2, 2, function (a, cx) { return rnd(num(a[0], cx), int(a[1], cx), 1); });
  def('ROUNDDOWN TRUNC', 1, 2, function (a, cx) { return rnd(num(a[0], cx), opt(a, 1) ? int(a[1], cx) : 0, -1); });
  def('INT', 1, 1, function (a, cx) { return Math.floor(num(a[0], cx)); });
  def('ABS', 1, 1, function (a, cx) { return Math.abs(num(a[0], cx)); });
  def('SQRT', 1, 1, function (a, cx) { var x = num(a[0], cx); if (x < 0) throw E['#NUM!']; return Math.sqrt(x); });
  def('POWER', 2, 2, function (a, cx) { return binop('^', num(a[0], cx), num(a[1], cx)); });
  def('EXP', 1, 1, function (a, cx) { return Math.exp(num(a[0], cx)); });
  def('LN', 1, 1, function (a, cx) { var x = num(a[0], cx); if (x <= 0) throw E['#NUM!']; return Math.log(x); });
  def('LOG10', 1, 1, function (a, cx) { var x = num(a[0], cx); if (x <= 0) throw E['#NUM!']; return Math.log(x) / Math.LN10; });
  def('LOG', 1, 2, function (a, cx) {
    var x = num(a[0], cx), b = opt(a, 1) ? num(a[1], cx) : 10;
    if (x <= 0 || b <= 0 || b === 1) throw E['#NUM!'];
    return fix15(Math.log(x) / Math.log(b));
  });
  def('MOD', 2, 2, function (a, cx) {
    var x = num(a[0], cx), y = num(a[1], cx);
    if (y === 0) throw E['#DIV/0!'];
    return fix15(x - y * Math.floor(x / y));
  });
  def('CEILING', 1, 2, function (a, cx) {
    var x = num(a[0], cx), s = opt(a, 1) ? num(a[1], cx) : 1;
    if (s === 0) return 0;
    if (x > 0 && s < 0) throw E['#NUM!'];
    return fix15(Math.ceil(fix15(x / s)) * s);
  });
  def('FLOOR', 1, 2, function (a, cx) {
    var x = num(a[0], cx), s = opt(a, 1) ? num(a[1], cx) : 1;
    if (s === 0) throw E['#DIV/0!'];
    if (x > 0 && s < 0) throw E['#NUM!'];
    return fix15(Math.floor(fix15(x / s)) * s);
  });
  def('SIGN', 1, 1, function (a, cx) { var x = num(a[0], cx); return x > 0 ? 1 : x < 0 ? -1 : 0; });
  def('PI', 0, 0, function () { return Math.PI; });
  def('RAND', 0, 0, function () { return Math.random(); });
  def('RANDBETWEEN', 2, 2, function (a, cx) {
    var lo = Math.ceil(num(a[0], cx)), hi = Math.floor(num(a[1], cx));
    if (hi < lo) throw E['#NUM!'];
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  });
  def('SUMPRODUCT', 1, MANY, function (a, cx) {
    var ts = a.map(function (v) { return arr(v, cx); }), h = ts[0].length, w = ts[0][0].length, s = 0;
    ts.forEach(function (t) { if (t.length !== h || t[0].length !== w) throw E['#VALUE!']; });
    for (var i = 0; i < h; i++) for (var j = 0; j < w; j++) {
      var p = 1;
      for (var k = 0; k < ts.length; k++) {
        var x = ts[k][i][j];
        if (isErr(x)) throw x;
        p *= typeof x === 'number' ? x : 0;
      }
      s += p;
    }
    return s;
  });

  // logic
  def('IF', 1, 3, function (n, cx) {
    if (bool(ev(n[0], cx), cx)) return n.length > 1 ? ev(n[1], cx) : true;
    return n.length > 2 ? ev(n[2], cx) : false;
  }, true);
  def('IFS', 2, MANY, function (n, cx) {
    for (var i = 0; i + 1 < n.length; i += 2) if (bool(ev(n[i], cx), cx)) return ev(n[i + 1], cx);
    throw E['#N/A'];
  }, true);
  function errCatch(only) {
    return function (n, cx) {
      var v = ev(n[0], cx), s = v instanceof Rng && v.h === 1 && v.w === 1 ? sc(v, cx) : v;
      if (isErr(s) && (!only || s.error === only)) return n.length > 1 ? ev(n[1], cx) : null;
      return s;
    };
  }
  def('IFERROR', 2, 2, errCatch(null), true);
  def('IFNA', 2, 2, errCatch('#N/A'), true);
  def('SWITCH', 3, MANY, function (n, cx) {
    var e = sc(ev(n[0], cx), cx);
    if (isErr(e)) return e;
    for (var i = 1; i + 1 < n.length; i += 2) {
      var c = sc(ev(n[i], cx), cx);
      if (isErr(c)) return c;
      if (cmpKind(e, c) === 0) return ev(n[i + 1], cx);
    }
    if (i < n.length) return ev(n[i], cx);
    throw E['#N/A'];
  }, true);
  function logic(a, cx) {
    var out = [];
    each(a, cx, function (x, inR) {
      if (isErr(x)) throw x;
      if (typeof x === 'boolean') out.push(x);
      else if (typeof x === 'number') out.push(x !== 0);
      else if (!inR && x !== null) out.push(bool(x, cx));
    });
    if (!out.length) throw E['#VALUE!'];
    return out;
  }
  def('AND', 1, MANY, function (a, cx) { return logic(a, cx).every(Boolean); });
  def('OR', 1, MANY, function (a, cx) { return logic(a, cx).some(Boolean); });
  def('XOR', 1, MANY, function (a, cx) { return logic(a, cx).filter(Boolean).length % 2 === 1; });
  def('NOT', 1, 1, function (a, cx) { return !bool(a[0], cx); });
  def('TRUE', 0, 0, function () { return true; });
  def('FALSE', 0, 0, function () { return false; });
  def('NA', 0, 0, function () { return E['#N/A']; });
  def('ISBLANK', 1, 1, function (a, cx) { return sc(a[0], cx) === null && a[0] instanceof Rng; });
  def('ISNUMBER', 1, 1, function (a, cx) { var x = sc(a[0], cx); return typeof x === 'number' || isISO(x); });
  def('ISTEXT', 1, 1, function (a, cx) { var x = sc(a[0], cx); return typeof x === 'string' && !isISO(x); });
  def('ISLOGICAL', 1, 1, function (a, cx) { return typeof sc(a[0], cx) === 'boolean'; });
  def('ISERROR', 1, 1, function (a, cx) { return isErr(sc(a[0], cx)); });
  def('ISNA', 1, 1, function (a, cx) { var x = sc(a[0], cx); return isErr(x) && x.error === '#N/A'; });

  // criteria (*IF, *IFS)
  function critNum(v, textOk) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { if (isISO(v)) return isoSerial(v); if (textOk) return textNum(v); }
    return null;
  }
  function blank(v) { return v === null || v === ''; }
  function crit(c, cx) {
    c = sc(c, cx);
    if (isErr(c)) throw c;
    if (c === null) c = '';
    if (typeof c === 'number') return function (v) { var n = critNum(v, true); return n !== null && cmpNum(n, c) === 0; };
    if (typeof c === 'boolean') return function (v) { return v === c; };
    var m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(c), o = m[1] || '=', rhs = m[2];
    function test(k) {
      switch (o) { case '<': return k < 0; case '>': return k > 0; case '<=': return k <= 0; default: return k >= 0; }
    }
    if (rhs === '') {
      if (o === '=') return blank;
      if (o === '<>') return function (v) { return !blank(v); };
      return function () { return false; };
    }
    var rn = textNum(rhs);
    if (rn !== null) {
      if (o === '=' || o === '<>') {
        var eq = function (v) { var n = critNum(v, true); return n !== null && cmpNum(n, rn) === 0; };
        return o === '=' ? eq : function (v) { return !eq(v); };
      }
      return function (v) { var n = critNum(v, false); return n !== null && test(cmpNum(n, rn)); };
    }
    var up = rhs.toUpperCase();
    if (up === 'TRUE' || up === 'FALSE' || up === 'IGAZ' || up === 'HAMIS') {
      var b = up === 'TRUE' || up === 'IGAZ';
      if (o === '=') return function (v) { return v === b; };
      if (o === '<>') return function (v) { return v !== b; };
      return function (v) { return typeof v === 'boolean' && test(cmp(v, b)); };
    }
    if (o === '=' || o === '<>') {
      var re = wild(rhs), hit = function (v) { return typeof v === 'string' && re.test(v); };
      return o === '=' ? hit : function (v) { return !hit(v); };
    }
    return function (v) { return typeof v === 'string' && !isISO(v) && test(cmpStr(v, rhs)); };
  }
  function fit(v, h, w, cx) {
    if (v instanceof Rng) return cx.W.mat(new Rng(v.sheet, v.r1, v.c1, v.r1 + h - 1, v.c1 + w - 1));
    var t = arr(v, cx);
    if (t.length !== h || t[0].length !== w) throw E['#VALUE!'];
    return t;
  }
  // Values of `target` (or of the first criteria range) where every (range, criterion) pair matches
  function matched(target, a, from, cx) {
    var t0 = arr(a[from], cx), h = t0.length, w = t0[0].length, tv = target === null ? t0 : fit(target, h, w, cx), out = [];
    var tests = [];
    for (var k = from; k + 1 < a.length; k += 2) {
      var t = k === from ? t0 : arr(a[k], cx);
      if (t.length !== h || t[0].length !== w) throw E['#VALUE!'];
      tests.push([t, crit(a[k + 1], cx)]);
    }
    for (var i = 0; i < h; i++) for (var j = 0; j < w; j++) {
      var ok = true;
      for (var q = 0; q < tests.length && ok; q++) ok = tests[q][1](tests[q][0][i][j]);
      if (ok) {
        var x = tv[i][j];
        if (isErr(x)) throw x;
        var n = rangeNum(x);
        if (n !== null) out.push(n);
      }
    }
    return out;
  }
  function countMatched(a, cx) {
    var t0 = arr(a[0], cx), h = t0.length, w = t0[0].length, tests = [], n = 0;
    for (var k = 0; k + 1 < a.length; k += 2) {
      var t = k === 0 ? t0 : arr(a[k], cx);
      if (t.length !== h || t[0].length !== w) throw E['#VALUE!'];
      tests.push([t, crit(a[k + 1], cx)]);
    }
    for (var i = 0; i < h; i++) for (var j = 0; j < w; j++) {
      var ok = true;
      for (var q = 0; q < tests.length && ok; q++) ok = tests[q][1](tests[q][0][i][j]);
      if (ok) n++;
    }
    return n;
  }
  function pairs(a) { if ((a.length - 1) % 2) throw E['#VALUE!']; }
  def('SUMIF', 2, 3, function (a, cx) { return sum(matched(opt(a, 2) ? a[2] : null, [a[0], a[1]], 0, cx)); });
  def('AVERAGEIF', 2, 3, function (a, cx) {
    var x = matched(opt(a, 2) ? a[2] : null, [a[0], a[1]], 0, cx);
    if (!x.length) throw E['#DIV/0!'];
    return sum(x) / x.length;
  });
  def('COUNTIF', 2, 2, function (a, cx) { return countMatched(a, cx); });
  def('COUNTIFS', 2, MANY, function (a, cx) { if (a.length % 2) throw E['#VALUE!']; return countMatched(a, cx); });
  def('SUMIFS', 3, MANY, function (a, cx) { pairs(a); return sum(matched(a[0], a, 1, cx)); });
  def('AVERAGEIFS', 3, MANY, function (a, cx) {
    pairs(a);
    var x = matched(a[0], a, 1, cx);
    if (!x.length) throw E['#DIV/0!'];
    return sum(x) / x.length;
  });
  def('MAXIFS', 3, MANY, function (a, cx) { pairs(a); var x = matched(a[0], a, 1, cx); return x.length ? Math.max.apply(null, x) : 0; });
  def('MINIFS', 3, MANY, function (a, cx) { pairs(a); var x = matched(a[0], a, 1, cx); return x.length ? Math.min.apply(null, x) : 0; });

  // lookups
  function vector(t) {
    if (t.length === 1) return t[0];
    if (t[0].length === 1) return t.map(function (r) { return r[0]; });
    return null;
  }
  function findExact(list, v, wildOk, from, step) {
    var re = wildOk && typeof v === 'string' && /[*?~]/.test(v) ? wild(v) : null;
    for (var i = from; i >= 0 && i < list.length; i += step) {
      var x = list[i];
      if (re ? typeof x === 'string' && re.test(x) : cmpKind(x, v) === 0) return i;
    }
    return -1;
  }
  // Sorted search: last item <= v (dir 1) or last item >= v (dir -1)
  function findSorted(list, v, dir) {
    var best = -1;
    for (var i = 0; i < list.length; i++) {
      var c = cmpKind(list[i], v);
      if (c === null) continue;
      if (c * dir <= 0) best = i; else break;
    }
    return best;
  }
  function lookupKey(v, cx) { v = sc(v, cx); if (isErr(v)) throw v; return v === null ? 0 : v; }
  def('VLOOKUP HLOOKUP', 3, 4, null);
  F.VLOOKUP.fn = function (a, cx) { return xLookup(a, cx, true); };
  F.HLOOKUP.fn = function (a, cx) { return xLookup(a, cx, false); };
  function xLookup(a, cx, vert) {
    var v = lookupKey(a[0], cx), t = arr(a[1], cx), k = int(a[2], cx), approx = opt(a, 3) ? bool(a[3], cx) : true;
    if (k < 1) throw E['#VALUE!'];
    if (k > (vert ? t[0].length : t.length)) throw E['#REF!'];
    var list = vert ? t.map(function (r) { return r[0]; }) : t[0];
    var i = approx ? findSorted(list, v, 1) : findExact(list, v, true, 0, 1);
    if (i < 0) throw E['#N/A'];
    return vert ? t[i][k - 1] : t[k - 1][i];
  }
  def('MATCH', 2, 3, function (a, cx) {
    var v = lookupKey(a[0], cx), list = vector(arr(a[1], cx)), type = opt(a, 2) ? int(a[2], cx) : 1;
    if (!list) throw E['#N/A'];
    var i = type === 0 ? findExact(list, v, true, 0, 1) : findSorted(list, v, type > 0 ? 1 : -1);
    if (i < 0) throw E['#N/A'];
    return i + 1;
  });
  def('XLOOKUP', 3, 6, function (a, cx) {
    var v = lookupKey(a[0], cx), lt = arr(a[1], cx), list = vector(lt), rt = arr(a[2], cx);
    var mode = opt(a, 4) ? int(a[4], cx) : 0, smode = opt(a, 5) ? int(a[5], cx) : 1;
    if (!list) throw E['#VALUE!'];
    var vert = lt[0].length === 1;
    if (vert ? rt.length !== list.length : rt[0].length !== list.length) throw E['#VALUE!'];
    var rev = smode < 0, from = rev ? list.length - 1 : 0, step = rev ? -1 : 1;
    var i = findExact(list, v, mode === 2, from, step);
    if (i < 0 && (mode === 1 || mode === -1)) {
      var best = -1;
      for (var j = from; j >= 0 && j < list.length; j += step) {
        var c = cmpKind(list[j], v);
        if (c === null || c * mode < 0) continue;
        if (best < 0 || cmpKind(list[j], list[best]) * mode < 0) best = j;
      }
      i = best;
    }
    if (i < 0) { if (opt(a, 3)) return a[3]; throw E['#N/A']; }
    if (vert) return rt[i].length === 1 ? rt[i][0] : [rt[i].slice()];
    return rt.length === 1 ? rt[0][i] : rt.map(function (r) { return [r[i]]; });
  });
  def('INDEX', 2, 3, function (a, cx) {
    var src = a[0], h, w, t = null;
    if (src instanceof Rng) { h = src.h; w = src.w; } else { t = arr(src, cx); h = t.length; w = t[0].length; }
    var r = opt(a, 1) ? int(a[1], cx) : 0, c = opt(a, 2) ? int(a[2], cx) : 0;
    if (a.length < 3 && h === 1) { c = r; r = 1; }
    else if (a.length < 3 && w === 1 && c === 0) c = 1;
    if (r < 0 || c < 0 || r > h || c > w) throw E['#REF!'];
    if (src instanceof Rng) {
      return new Rng(src.sheet, r ? src.r1 + r - 1 : src.r1, c ? src.c1 + c - 1 : src.c1, r ? src.r1 + r - 1 : src.r2, c ? src.c1 + c - 1 : src.c2);
    }
    if (r && c) return t[r - 1][c - 1];
    if (r) return [t[r - 1]];
    if (c) return t.map(function (row) { return [row[c - 1]]; });
    return t;
  });
  def('CHOOSE', 2, MANY, function (n, cx) {
    var i = int(ev(n[0], cx), cx);
    if (i < 1 || i >= n.length) throw E['#VALUE!'];
    return ev(n[i], cx);
  }, true);
  def('ROW', 0, 1, function (a, cx) {
    if (!a.length || a[0] === null) return cx.r + 1;
    if (!(a[0] instanceof Rng)) throw E['#VALUE!'];
    return a[0].r1 + 1;
  });
  def('COLUMN', 0, 1, function (a, cx) {
    if (!a.length || a[0] === null) return cx.c + 1;
    if (!(a[0] instanceof Rng)) throw E['#VALUE!'];
    return a[0].c1 + 1;
  });
  def('ROWS', 1, 1, function (a, cx) { var v = a[0]; if (isErr(v)) throw v; return v instanceof Rng ? v.h : arr(v, cx).length; });
  def('COLUMNS', 1, 1, function (a, cx) { var v = a[0]; if (isErr(v)) throw v; return v instanceof Rng ? v.w : arr(v, cx)[0].length; });

  // text
  function joinAll(a, cx, sep, skipEmpty) {
    var out = [];
    each(a, cx, function (x) { var s = strOf(x, cx.L); if (!(skipEmpty && s === '')) out.push(s); });
    return out.join(sep);
  }
  def('CONCAT CONCATENATE', 1, MANY, function (a, cx) { return joinAll(a, cx, '', false); });
  def('TEXTJOIN', 3, MANY, function (a, cx) { return joinAll(a.slice(2), cx, str(a[0], cx), bool(a[1], cx)); });
  def('LEFT', 1, 2, function (a, cx) { var n = opt(a, 1) ? int(a[1], cx) : 1; if (n < 0) throw E['#VALUE!']; return str(a[0], cx).slice(0, n); });
  def('RIGHT', 1, 2, function (a, cx) {
    var s = str(a[0], cx), n = opt(a, 1) ? int(a[1], cx) : 1;
    if (n < 0) throw E['#VALUE!'];
    return n ? s.slice(Math.max(0, s.length - n)) : '';
  });
  def('MID', 3, 3, function (a, cx) {
    var s = str(a[0], cx), st = int(a[1], cx), n = int(a[2], cx);
    if (st < 1 || n < 0) throw E['#VALUE!'];
    return s.substr(st - 1, n);
  });
  def('LEN', 1, 1, function (a, cx) { return str(a[0], cx).length; });
  def('LOWER', 1, 1, function (a, cx) { return str(a[0], cx).toLowerCase(); });
  def('UPPER', 1, 1, function (a, cx) { return str(a[0], cx).toUpperCase(); });
  def('PROPER', 1, 1, function (a, cx) {
    var s = str(a[0], cx).toLowerCase(), out = '', prev = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), letter = ch.toLowerCase() !== ch.toUpperCase();
      out += letter && !prev ? ch.toUpperCase() : ch;
      prev = letter;
    }
    return out;
  });
  def('TRIM', 1, 1, function (a, cx) { return str(a[0], cx).replace(/ +/g, ' ').replace(/^ | $/g, ''); });
  def('SUBSTITUTE', 3, 4, function (a, cx) {
    var s = str(a[0], cx), o = str(a[1], cx), n = str(a[2], cx);
    if (!o) return s;
    if (!opt(a, 3)) return s.split(o).join(n);
    var k = int(a[3], cx), at = -1;
    if (k < 1) throw E['#VALUE!'];
    while (k-- > 0) { at = s.indexOf(o, at + 1); if (at < 0) return s; }
    return s.slice(0, at) + n + s.slice(at + o.length);
  });
  def('REPLACE', 4, 4, function (a, cx) {
    var s = str(a[0], cx), st = int(a[1], cx), n = int(a[2], cx);
    if (st < 1 || n < 0) throw E['#VALUE!'];
    return s.slice(0, st - 1) + str(a[3], cx) + s.slice(st - 1 + n);
  });
  def('FIND', 2, 3, function (a, cx) {
    var f = str(a[0], cx), s = str(a[1], cx), st = opt(a, 2) ? int(a[2], cx) : 1;
    if (st < 1 || st > s.length + 1) throw E['#VALUE!'];
    var i = s.indexOf(f, st - 1);
    if (i < 0) throw E['#VALUE!'];
    return i + 1;
  });
  def('SEARCH', 2, 3, function (a, cx) {
    var f = str(a[0], cx), s = str(a[1], cx), st = opt(a, 2) ? int(a[2], cx) : 1;
    if (st < 1 || st > s.length + 1) throw E['#VALUE!'];
    var re = new RegExp(wild(f).source.slice(1, -1), 'i'), m = re.exec(s.slice(st - 1));
    if (!m) throw E['#VALUE!'];
    return m.index + st;
  });
  def('TEXT', 2, 2, function (a, cx) {
    var v = sc(a[0], cx);
    if (isErr(v)) throw v;
    if (typeof v === 'string' && !isISO(v)) { var x = textNum(v); if (x !== null) v = x; }
    return format(v, str(a[1], cx), cx.L);
  });
  def('VALUE', 1, 1, function (a, cx) {
    var v = sc(a[0], cx);
    if (isErr(v)) throw v;
    if (typeof v === 'number') return v;
    if (v === null) return 0;
    if (typeof v === 'string') {
      var x = textNum(v);
      if (x === null) { var p = parseInput(v, cx.L); if (typeof p.value === 'number') x = p.value; else if (isISO(p.value)) x = isoSerial(p.value); }
      if (x !== null) return x;
    }
    throw E['#VALUE!'];
  });
  def('REPT', 2, 2, function (a, cx) {
    var s = str(a[0], cx), n = int(a[1], cx);
    if (n < 0 || s.length * n > 32767) throw E['#VALUE!'];
    return new Array(n + 1).join(s);
  });
  def('EXACT', 2, 2, function (a, cx) { return str(a[0], cx) === str(a[1], cx); });

  // dates
  function serial(v, cx) { var x = num(v, cx); if (x < 0) throw E['#NUM!']; return x; }
  function iso(s) { var r = toISO(s); if (r === null) throw E['#NUM!']; return r; }
  def('TODAY', 0, 0, function () { var d = new Date(); return iso(ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())); });
  def('NOW', 0, 0, function () {
    var d = new Date();
    return iso(ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 60 + d.getMinutes()) / 1440);
  });
  def('DATE', 3, 3, function (a, cx) {
    var y = int(a[0], cx), m = int(a[1], cx), d = int(a[2], cx);
    if (y < 0 || y > 9999) throw E['#NUM!'];
    if (y < 1900) y += 1900;
    return iso(ymd(y, m, d));
  });
  def('YEAR', 1, 1, function (a, cx) { return parts(serial(a[0], cx)).y; });
  def('MONTH', 1, 1, function (a, cx) { return parts(serial(a[0], cx)).m; });
  def('DAY', 1, 1, function (a, cx) { return parts(serial(a[0], cx)).d; });
  def('WEEKDAY', 1, 2, function (a, cx) {
    var wd = parts(serial(a[0], cx)).wd, t = opt(a, 1) ? int(a[1], cx) : 1;
    if (t === 1) return wd + 1;
    if (t === 2) return (wd + 6) % 7 + 1;
    if (t === 3) return (wd + 6) % 7;
    if (t >= 11 && t <= 17) return (wd - (t - 10) % 7 + 7) % 7 + 1;
    throw E['#NUM!'];
  });
  def('WEEKNUM', 1, 2, function (a, cx) {
    var p = parts(serial(a[0], cx)), t = opt(a, 1) ? int(a[1], cx) : 1, d = p.day;
    if (t === 21) {
      var th = d - (p.wd + 6) % 7 + 3, ty = parts(th).y;
      return Math.floor((th - ymd(ty, 1, 1)) / 7) + 1;
    }
    var start = t === 1 || t === 17 ? 0 : t === 2 || t === 11 ? 1 : t >= 12 && t <= 16 ? t - 10 : -1;
    if (start < 0) throw E['#NUM!'];
    var j1 = ymd(p.y, 1, 1), off = (parts(j1).wd - start + 7) % 7;
    return Math.floor((d - j1 + off) / 7) + 1;
  });
  def('EDATE', 2, 2, function (a, cx) {
    var p = parts(serial(a[0], cx)), m = p.m + int(a[1], cx), y = p.y + Math.floor((m - 1) / 12);
    m = ((m - 1) % 12 + 12) % 12 + 1;
    return iso(ymd(y, m, Math.min(p.d, dim(y, m))));
  });
  def('EOMONTH', 2, 2, function (a, cx) { var p = parts(serial(a[0], cx)); return iso(ymd(p.y, p.m + int(a[1], cx) + 1, 0)); });
  def('DAYS', 2, 2, function (a, cx) { return Math.floor(num(a[0], cx)) - Math.floor(num(a[1], cx)); });
  def('DATEDIF', 3, 3, function (a, cx) {
    var s = Math.floor(serial(a[0], cx)), e = Math.floor(serial(a[1], cx)), u = str(a[2], cx).toUpperCase();
    if (s > e) throw E['#NUM!'];
    var p = parts(s), q = parts(e), months = (q.y - p.y) * 12 + q.m - p.m - (q.d < p.d ? 1 : 0);
    switch (u) {
      case 'D': return e - s;
      case 'M': return months;
      case 'Y': return Math.floor(months / 12);
      case 'YM': return months % 12;
      case 'MD': var md = q.d - p.d; return md < 0 ? md + dim(q.y, q.m - 1) : md;
      case 'YD':
        var y = q.y, st = ymd(y, p.m, Math.min(p.d, dim(y, p.m)));
        if (st > e) { y--; st = ymd(y, p.m, Math.min(p.d, dim(y, p.m))); }
        return e - st;
    }
    throw E['#NUM!'];
  });
  def('NETWORKDAYS', 2, 3, function (a, cx) {
    var s = Math.floor(serial(a[0], cx)), e = Math.floor(serial(a[1], cx)), sg = 1, hol = {}, n = 0;
    if (opt(a, 2)) nums([a[2]], cx).forEach(function (h) { hol[Math.floor(h)] = 1; });
    if (s > e) { var t = s; s = e; e = t; sg = -1; }
    if (e - s > 400000) throw E['#NUM!'];
    for (var d = s; d <= e; d++) { var wd = ((d % 7) + 13) % 7; if (wd !== 0 && wd !== 6 && !hol[d]) n++; }
    return sg * n;
  });

  // finance
  function fin(a, cx, i, d) { return opt(a, i) ? num(a[i], cx) : d; }
  def('PMT', 3, 5, function (a, cx) {
    var r = num(a[0], cx), n = num(a[1], cx), pv = num(a[2], cx), fv = fin(a, cx, 3, 0), t = fin(a, cx, 4, 0) ? 1 : 0;
    if (n === 0) throw E['#NUM!'];
    if (r === 0) return -(pv + fv) / n;
    var q = Math.pow(1 + r, n);
    return -(r * (pv * q + fv)) / ((1 + r * t) * (q - 1));
  });
  def('FV', 3, 5, function (a, cx) {
    var r = num(a[0], cx), n = num(a[1], cx), p = num(a[2], cx), pv = fin(a, cx, 3, 0), t = fin(a, cx, 4, 0) ? 1 : 0;
    if (r === 0) return -(pv + p * n);
    var q = Math.pow(1 + r, n);
    return -(pv * q + p * (1 + r * t) * (q - 1) / r);
  });
  def('PV', 3, 5, function (a, cx) {
    var r = num(a[0], cx), n = num(a[1], cx), p = num(a[2], cx), fv = fin(a, cx, 3, 0), t = fin(a, cx, 4, 0) ? 1 : 0;
    if (r === 0) return -(fv + p * n);
    var q = Math.pow(1 + r, n);
    return -(fv + p * (1 + r * t) * (q - 1) / r) / q;
  });
  def('NPV', 2, MANY, function (a, cx) {
    var r = num(a[0], cx), x = nums(a.slice(1), cx), s = 0;
    if (r === -1) throw E['#DIV/0!'];
    for (var i = 0; i < x.length; i++) s += x[i] / Math.pow(1 + r, i + 1);
    return s;
  });
  def('IRR', 1, 2, function (a, cx) {
    var x = nums([a[0] instanceof Rng || isArray(a[0]) ? a[0] : [[a[0]]]], cx), r = fin(a, cx, 1, 0.1);
    for (var it = 0; it < 100; it++) {
      var f = 0, df = 0;
      for (var i = 0; i < x.length; i++) { var q = Math.pow(1 + r, i); f += x[i] / q; df -= i * x[i] / (q * (1 + r)); }
      if (!df || !isFinite(f)) break;
      var nr = r - f / df;
      if (Math.abs(nr - r) < 1e-12) return nr;
      r = nr;
    }
    throw E['#NUM!'];
  });

  // ---------- number formats
  var MON = { en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
              hu: ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'] };
  var MON3 = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
               hu: ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'] };
  var WDAY = { en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
               hu: ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'] };
  var WDAY3 = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], hu: ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'] };

  function splitSections(f) {
    var out = [], cur = '', q = false, b = false;
    for (var i = 0; i < f.length; i++) {
      var ch = f.charAt(i);
      if (ch === '\\' && !q) { cur += ch + f.charAt(++i); continue; }
      if (ch === '"') q = !q;
      else if (!q && ch === '[') b = true;
      else if (!q && ch === ']') b = false;
      else if (!q && !b && ch === ';') { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  function compileSection(sec) {
    var toks = [], i = 0, core = null, pctN = 0, date = false, m;
    function lit(s) { var t = toks[toks.length - 1]; if (t && t.lit !== undefined) t.lit += s; else toks.push({ lit: s }); }
    while (i < sec.length) {
      var ch = sec.charAt(i), rest = sec.slice(i);
      if (ch === '"') { var j = sec.indexOf('"', i + 1); if (j < 0) j = sec.length; lit(sec.slice(i + 1, j)); i = j + 1; continue; }
      if (ch === '\\') { lit(sec.charAt(i + 1)); i += 2; continue; }
      if (ch === '_') { lit(' '); i += 2; continue; }
      if (ch === '*') { i += 2; continue; }
      if (ch === '[') {
        var k = sec.indexOf(']', i); if (k < 0) k = sec.length;
        m = /^\$([^-]*)/.exec(sec.slice(i + 1, k));
        if (m) lit(m[1]);
        i = k + 1; continue;
      }
      if ((m = /^(AM\/PM|A\/P)/i.exec(rest))) { toks.push({ ampm: m[1].length > 3 }); date = true; i += m[1].length; continue; }
      if (/[yYmMdDhHsS]/.test(ch)) {
        var j2 = i, lc = ch.toLowerCase();
        while (j2 < sec.length && sec.charAt(j2).toLowerCase() === lc) j2++;
        toks.push({ code: lc, n: j2 - i }); date = true; i = j2; continue;
      }
      if ('0#?'.indexOf(ch) >= 0 || (ch === '.' && /[0#?]/.test(sec.charAt(i + 1)))) {
        m = /^[0#?,.]+/.exec(rest);
        if (core === null) { core = m[0]; toks.push({ num: true }); } else lit(m[0]);
        i += m[0].length; continue;
      }
      if (ch === '%') { pctN++; lit('%'); i++; continue; }
      lit(ch); i++;
    }
    var out = { toks: toks, date: date, pct: pctN };
    if (date) {
      // m after h or before s is minutes
      toks.forEach(function (t, x) {
        if (t.code !== 'm' || t.n > 2) return;
        var y;
        for (y = x - 1; y >= 0; y--) if (toks[y].code) { if (toks[y].code === 'h') t.code = 'min'; break; }
        for (y = x + 1; y < toks.length; y++) if (toks[y].code) { if (toks[y].code === 's') t.code = 'min'; break; }
      });
    } else if (core !== null) {
      var dot = core.indexOf('.'), ip = dot < 0 ? core : core.slice(0, dot), dp = dot < 0 ? '' : core.slice(dot + 1).replace(/,/g, ''), scale = 0;
      while (ip.charAt(ip.length - 1) === ',') { scale++; ip = ip.slice(0, -1); }
      out.group = ip.indexOf(',') >= 0;
      out.minInt = (ip.match(/0/g) || []).length;
      out.dec = dp.replace(/[^0#?]/g, '').length;
      out.minDec = (dp.match(/0/g) || []).length;
      out.scale = scale;
    }
    return out;
  }
  var FC = Object.create(null), FCN = 0;
  function compileFmt(f) {
    var c = FC[f];
    if (c) return c;
    if (++FCN > 2000) { FC = Object.create(null); FCN = 0; }
    return (FC[f] = splitSections(f).slice(0, 4).map(compileSection));
  }
  function numOut(x, sec, hu) {
    var s = '';
    if (sec.dec !== undefined) {
      x = x * Math.pow(100, sec.pct) / Math.pow(1000, sec.scale);
      var r = rnd(x, sec.dec, 0), t = r.toFixed(sec.dec), dot = t.indexOf('.'), ip = dot < 0 ? t : t.slice(0, dot), fp = dot < 0 ? '' : t.slice(dot + 1);
      while (fp.length > sec.minDec && fp.charAt(fp.length - 1) === '0') fp = fp.slice(0, -1);
      if (ip === '0' && sec.minInt === 0) ip = '';
      while (ip.length < sec.minInt) ip = '0' + ip;
      if (sec.group) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, hu ? ' ' : ',');
      s = ip + (fp ? (hu ? ',' : '.') + fp : '');
    }
    return sec.toks.map(function (t) { return t.num ? s : t.lit !== undefined ? t.lit : ''; }).join('');
  }
  function dateOut(v, sec, hu) {
    var p = parts(v), L = hu ? 'hu' : 'en', ampm = sec.toks.some(function (t) { return t.ampm !== undefined; });
    return sec.toks.map(function (t) {
      if (t.lit !== undefined) return t.lit;
      if (t.ampm !== undefined) return p.H < 12 ? (t.ampm ? 'AM' : 'A') : (t.ampm ? 'PM' : 'P');
      if (t.num) return '';
      var n = t.n;
      switch (t.code) {
        case 'y': return n <= 2 ? pad(p.y % 100) : pad(p.y, 4);
        case 'm': return n === 1 ? String(p.m) : n === 2 ? pad(p.m) : n === 3 ? MON3[L][p.m - 1] : n === 5 ? MON[L][p.m - 1].charAt(0) : MON[L][p.m - 1];
        case 'd': return n === 1 ? String(p.d) : n === 2 ? pad(p.d) : n === 3 ? WDAY3[L][p.wd] : WDAY[L][p.wd];
        case 'h': var h = ampm ? (p.H % 12 || 12) : p.H; return n === 1 ? String(h) : pad(h);
        case 'min': return n === 1 ? String(p.M) : pad(p.M);
        case 's': return n === 1 ? String(p.S) : pad(p.S);
      }
      return '';
    }).join('');
  }
  function isoDisplay(v, hu) {
    var m = RE_ISO.exec(v), s = hu ? m[1] + '.' + m[2] + '.' + m[3] + '.' : m[1] + '-' + m[2] + '-' + m[3];
    if (m[4] !== undefined) s += ' ' + m[4] + ':' + m[5] + (m[6] && m[6] !== '00' ? ':' + m[6] : '');
    return s;
  }
  function format(v, f, locale) {
    var hu = locale === 'hu', L = hu ? 'hu' : 'en';
    if (v === null || v === undefined) return '';
    if (isErr(v)) return v.error;
    if (typeof v === 'boolean') return boolText(v, L);
    f = f === null || f === undefined ? '' : String(f);
    var g = !f || /^general$/i.test(f);
    if (typeof v === 'string') {
      if (!isISO(v)) return v;
      if (g || f === '@') return g ? isoDisplay(v, hu) : v;
      v = isoSerial(v);
    }
    if (typeof v !== 'number') return String(v);
    if (!isFinite(v)) return '#NUM!';
    if (g) return gen(v, true, L);
    if (f === '@') return gen(v, false, L);
    var secs = compileFmt(f), sec = secs[0], minus = false;
    if (v < 0 && secs.length > 1 && secs[1].toks.length) { sec = secs[1]; v = -v; }
    else if (v === 0 && secs.length > 2 && secs[2].toks.length) sec = secs[2];
    else if (v < 0) { minus = true; v = -v; }
    if (sec.date) return v >= 0 && v < 2958466 ? (minus ? '-' : '') + dateOut(v, sec, hu) : '#####';
    var out = numOut(v, sec, hu);
    return minus && /[1-9]/.test(out) ? '-' + out : out;
  }

  // ---------- typed input
  function validDate(y, m, d) { return y >= 1900 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= dim(y, m); }
  function isoOf(y, m, d, H, M) {
    var s = pad(y, 4) + '-' + pad(m) + '-' + pad(d);
    if (H !== undefined && H !== null && H !== '') s += 'T' + pad(+H) + ':' + pad(+M);
    return s;
  }
  function plainNum(body, hu) {
    var m, dec = 0, grouped = false, x;
    if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(body)) return { n: parseFloat(body), dec: 0, grouped: false };
    if (hu) {
      var b = body.replace(/\u00a0/g, ' ');
      if ((m = /^(\d{1,3}(?: \d{3})+|\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/.exec(b))) {
        grouped = m[1].length > 3 && /[ .]/.test(m[1]);
        x = parseFloat(m[1].replace(/[ .]/g, '') + (m[2] ? '.' + m[2] : ''));
        dec = m[2] ? m[2].length : 0;
      } else if ((m = /^(\d*)\.(\d+)$/.exec(b)) && (m[1] || m[2])) {
        x = parseFloat(b); dec = m[2].length;
      } else if ((m = /^,(\d+)$/.exec(b))) { x = parseFloat('0.' + m[1]); dec = m[1].length; }
      else return null;
    } else {
      if ((m = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d+))?$/.exec(body)) && (m[1] || m[2])) {
        grouped = !!m[1] && m[1].indexOf(',') >= 0;
        x = parseFloat((m[1] || '0').replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
        dec = m[2] ? m[2].length : 0;
      } else return null;
    }
    return { n: x, dec: dec, grouped: grouped };
  }
  function zeros(n) { return new Array(n + 1).join('0'); }
  function parseInput(text, locale) {
    if (text === null || text === undefined) return { value: '' };
    if (typeof text !== 'string') return { value: text };
    var hu = locale === 'hu', t = text.trim(), m;
    if (text.charAt(0) === "'") return { value: text.slice(1) };
    if (!t) return { value: '' };
    if (t.charAt(0) === '=' && t.length > 1) return { value: normalize(t, locale) };
    var up = t.toUpperCase();
    if (up === 'TRUE' || up === 'IGAZ') return { value: true };
    if (up === 'FALSE' || up === 'HAMIS') return { value: false };
    // dates and times
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(t))) {
      if (validDate(+m[1], +m[2], +m[3]) && (m[4] === undefined || (+m[4] < 24 && +m[5] < 60)))
        return { value: isoOf(+m[1], +m[2], +m[3], m[4], m[5]), num: m[4] !== undefined ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd' };
      return { value: text };
    }
    if ((m = /^(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})\.?(?:\s+(\d{1,2}):(\d{2}))?$/.exec(t))) {
      if (validDate(+m[1], +m[2], +m[3]) && (m[4] === undefined || (+m[4] < 24 && +m[5] < 60)))
        return { value: isoOf(+m[1], +m[2], +m[3], m[4], m[5]), num: m[4] !== undefined ? 'yyyy.mm.dd. hh:mm' : 'yyyy.mm.dd.' };
      return { value: text };
    }
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) {
      var dd = hu ? +m[1] : +m[2], mm = hu ? +m[2] : +m[1];
      if (validDate(+m[3], mm, dd)) return { value: isoOf(+m[3], mm, dd), num: hu ? 'dd/mm/yyyy' : 'mm/dd/yyyy' };
      return { value: text };
    }
    if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t)) && +m[1] < 24 && +m[2] < 60 && (!m[3] || +m[3] < 60))
      return { value: (+m[1] * 3600 + +m[2] * 60 + (+m[3] || 0)) / 86400, num: m[3] ? 'hh:mm:ss' : 'hh:mm' };
    // numbers, percent, currency
    m = /^([-+]?)\s*(\$|€)?\s*([-+]?)\s*([\d\s\u00a0.,]*\d[\d\s\u00a0.,]*|[.,]\d+)\s*(Ft|HUF|€|EUR|\$|USD|%)?$/i.exec(t);
    if (m && !(m[1] && m[3])) {
      var cur = m[2] || m[5] || '', body = m[4].replace(/\s+$/, ''), p = plainNum(body, hu);
      if (!hu && /\s/.test(body)) p = null;
      if (p) {
        var x = (m[1] === '-' || m[3] === '-') ? -p.n : p.n, c = cur.toUpperCase(), nf;
        if (c === '%') return { value: fix15(x / 100), num: p.dec ? '0.' + zeros(p.dec) + '%' : '0%' };
        if (c === 'FT' || c === 'HUF') nf = p.dec ? '#,##0.00 "Ft"' : '#,##0 "Ft"';
        else if (c === '€' || c === 'EUR') nf = '#,##0.00 €';
        else if (c === '$' || c === 'USD') nf = '$#,##0.00';
        else if (p.grouped) nf = p.dec ? '#,##0.00' : '#,##0';
        return nf ? { value: x, num: nf } : { value: x };
      }
    }
    return { value: text };
  }

  // ---------- normalize: Hungarian names, ';' separators and decimal commas -> canonical English
  var RE_NWORD = /^[A-Za-z_$\\À-\uffff][A-Za-z0-9_.$À-\uffff]*/;
  function quoted(src, i, q) {
    var j = i + 1, n = src.length;
    while (j < n) { if (src.charAt(j) === q) { if (src.charAt(j + 1) === q) { j += 2; continue; } break; } j++; }
    return Math.min(j + 1, n);
  }
  function hasSemi(src) {
    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i);
      if (ch === '"' || ch === "'") { i = quoted(src, i, ch) - 1; continue; }
      if (ch === ';') return true;
    }
    return false;
  }
  function normalize(f, locale) {
    if (typeof f !== 'string') return f;
    var lead = /^\s*=/.exec(f);
    if (!lead) return f;
    var src = f.slice(lead[0].length), semi = hasSemi(src), hu = locale === 'hu', out = '=', i = 0, n = src.length, depth = 0, m;
    while (i < n) {
      var ch = src.charAt(i);
      if (ch === '"' || ch === "'") { var j = quoted(src, i, ch); out += src.slice(i, j); i = j; continue; }
      if (ch === ';') { out += ','; i++; continue; }
      if (ch >= '0' && ch <= '9') {
        m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
        var numText = m[0];
        i += numText.length;
        if (!m[1] && src.charAt(i) === ',' && /[0-9]/.test(src.charAt(i + 1)) && (semi || (hu && depth === 0))) {
          var m2 = /^[0-9]+/.exec(src.slice(i + 1));
          numText += '.' + m2[0];
          i += 1 + m2[0].length;
        }
        out += numText; continue;
      }
      if (RE_NWORD.test(ch)) {
        var w = RE_NWORD.exec(src.slice(i))[0], nx = src.charAt(i + w.length), up = w.toUpperCase();
        if (nx === '(') out += canonFn(w);
        else if (nx === '!') out += w;
        else if (up === 'TRUE' || up === 'IGAZ') out += 'TRUE';
        else if (up === 'FALSE' || up === 'HAMIS') out += 'FALSE';
        else if (/^\$?[A-Z]{1,3}\$?[0-9]+$/.test(up) || (/^\$?[A-Z]{1,3}$/.test(up) && (nx === ':' || src.charAt(i - 1) === ':'))) out += up;
        else out += w;
        i += w.length; continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      out += ch; i++;
    }
    return out;
  }

  // ---------- reference rewriting
  function partText(p, dr, dc) {
    var c = p.c, r = p.r;
    if (c !== undefined && !p.ca) c += dc;
    if (r !== undefined && !p.ra) r += dr;
    if ((c !== undefined && (c < 0 || c >= MAX_COLS)) || (r !== undefined && (r < 0 || r >= MAX_ROWS))) return null;
    return (c !== undefined ? (p.ca ? '$' : '') + colName(c) : '') + (r !== undefined ? (p.ra ? '$' : '') + (r + 1) : '');
  }
  function shiftRefs(f, dr, dc) {
    if (typeof f !== 'string' || f.charAt(0) !== '=') return f;
    var src = f.slice(1), toks;
    try { toks = lex(src); } catch (e) { if (e === SYN) return f; throw e; }
    var out = '', last = 0;
    dr = dr | 0; dc = dc | 0;
    toks.forEach(function (t) {
      if (t.k !== 'ref' || t.kind === 'err') return;
      var a = partText(t.a, dr, dc), b = t.b ? partText(t.b, dr, dc) : '';
      out += src.slice(last, t.rs) + (a === null || b === null ? '#REF!' : a + (t.b ? ':' + b : ''));
      last = t.e;
    });
    return '=' + out + src.slice(last);
  }
  function refs(f) {
    if (typeof f !== 'string' || f.charAt(0) !== '=') return [];
    var toks;
    try { toks = lex(f.slice(1)); } catch (e) { if (e === SYN) return []; throw e; }
    var out = [];
    toks.forEach(function (t) {
      if (t.k !== 'ref' || t.kind === 'err') return;
      var a = partText({ c: t.a.c, r: t.a.r }, 0, 0), b = t.b ? partText({ c: t.b.c, r: t.b.r }, 0, 0) : null;
      out.push({ sheet: t.sheet, range: b && b !== a || t.kind !== 'cell' ? a + ':' + b : a });
    });
    return out;
  }

  // Their value changes without any cell changing: recomputed on every invalidation.
  ['RAND', 'RANDBETWEEN', 'TODAY', 'NOW'].forEach(function (n) { F[n].vol = true; });

  var api = {
    workbook: workbook,
    format: format,
    parseInput: parseInput,
    normalize: normalize,
    shiftRefs: shiftRefs,
    refs: refs,
    colName: colName,
    colIndex: colIndex,
    parseRange: parseRange,
    rangeName: rangeName,
    isError: isErr,
    isDate: isISO,
    toSerial: function (iso) { return isISO(iso) ? isoSerial(iso) : null; },
    fromSerial: toISO,
    FUNCTIONS: Object.keys(F).sort()
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.sheetFormula = api;
  else if (root) root.sheetFormula = api;
})(this);
