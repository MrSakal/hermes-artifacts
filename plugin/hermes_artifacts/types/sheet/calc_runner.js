/* Formula values for a whole workbook, computed outside the page (calc.py starts this under node).
   argv: <path of formula.js> [max output bytes]
   stdin:  {"locale": "en" | "hu", "sheets": [{"name", "cells": {A1: raw}, "charts": ["F2", ...]}]}
   stdout: {"sheets": [{A1: value}, ...]} in the same order, formula cells only, each value as the
   page posts it (sheet.js sendVals): number | string | boolean | null | {"error": "#DIV/0!"}.
   Reads and writes nothing else. */
'use strict';
var F = require(process.argv[2]);
var MAX_OUT = +process.argv[3] || 32 * 1024 * 1024;
var MAX_TEXT = 4000;  // sheets.py MAX_TEXT: a longer text is not a cell value

function isFormula(v) { return typeof v === 'string' && v.length > 1 && v.charAt(0) === '='; }
var KEY = /^([A-Z]{1,3})([0-9]+)$/;

// The extent the page gives the engine (sheet.js used()): the last row and column holding a
// value, reaching past a chart's anchor.
function extent(s) {
  var mr = -1, mc = -1, k, m, i, r, c;
  for (k in s.cells) {
    m = KEY.exec(k);
    if (!m) continue;
    r = +m[2] - 1; c = F.colIndex(m[1]);
    if (r > mr) mr = r;
    if (c > mc) mc = c;
  }
  for (i = 0; i < s.charts.length; i++) {
    m = KEY.exec(String(s.charts[i] || '').toUpperCase().replace(/\$/g, ''));
    if (m) { mr = Math.max(mr, +m[2] - 1 + 10); mc = Math.max(mc, F.colIndex(m[1]) + 4); }
  }
  return { rows: mr + 1, cols: mc + 1 };
}

function compute(inp) {
  var by = new Map(), names = [], sheets = [];
  (inp.sheets || []).forEach(function (s) {
    var one = { name: String(s.name), cells: s.cells || {}, charts: s.charts || [], ext: null };
    sheets.push(one); names.push(one.name);
    if (!by.has(one.name.toLowerCase())) by.set(one.name.toLowerCase(), one);
  });
  function find(name) { return by.get(String(name).toLowerCase()); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  var wb = F.workbook(
    function (name, k) { var s = find(name); return s && own(s.cells, k) ? s.cells[k] : undefined; },
    function () { return names; },
    function (name) { var s = find(name); return s ? (s.ext || (s.ext = extent(s))) : { rows: 0, cols: 0 }; },
    { locale: inp.locale === 'hu' ? 'hu' : 'en' });
  return sheets.map(function (s) {
    var out = {}, k, v;
    for (k in s.cells) {
      if (!own(s.cells, k) || !isFormula(s.cells[k])) continue;
      try { v = wb.value(s.name, k); } catch (e) { v = { error: '#VALUE!' }; }
      if (v && typeof v === 'object') v = v.error ? { error: String(v.error) } : null;
      else if (v === undefined || (typeof v === 'number' && !isFinite(v))) v = null;
      else if (typeof v === 'string' && v.length > MAX_TEXT) v = null;
      out[k] = v;
    }
    return out;
  });
}

var chunks = [];
process.stdin.on('data', function (d) { chunks.push(d); });
process.stdin.on('end', function () {
  var text;
  try { text = JSON.stringify({ sheets: compute(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }); }
  catch (e) { process.exitCode = 2; return; }
  if (Buffer.byteLength(text, 'utf8') > MAX_OUT) { process.exitCode = 3; return; }
  process.stdout.write(text);
});
