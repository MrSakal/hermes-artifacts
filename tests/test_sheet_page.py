"""The sheet page's pure helpers (the block between ">>> pure" and "<<< pure" in types/sheet/sheet.js),
run under node: filter conditions, error kinds, find and replace, decimals. Also: the page's two string
tables hold the same keys, and the file parses."""

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "plugin" / "hermes_artifacts" / "types" / "sheet" / "sheet.js"
NODE = shutil.which("node")

SCRIPT = r"""
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const a = src.indexOf('// >>> pure'), b = src.indexOf('// <<< pure');
if (a < 0 || b < a) throw new Error('the pure block is not marked in sheet.js');
const P = new Function(src.slice(a, b) + '\nreturn PURE;')();
const out = {};
function group(name, cases, run) {
  const fails = [];
  cases.forEach((c) => {
    let got;
    try { got = run(c); } catch (e) { got = 'THROW ' + (e && e.stack || e); }
    const want = c[c.length - 1];
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push([JSON.stringify(c.slice(0, -1)), JSON.stringify(got), JSON.stringify(want)]);
  });
  out[name] = { n: cases.length, fails };
}
const E = (c) => ({ error: c });

// [op, the condition's value, the text the cell shows, its computed value, expected] (a 6th: its text is a duplicate)
group('conditions', [
  ['is', 'done', 'Done', 'Done', true], ['is', 'Done', 'To do', 'To do', false], ['is', ' done ', 'Done', 'Done', true],
  ['is', '1,5', '1,50 Ft', 1.5, true], ['is', '1.5', '2', 2, false], ['is', '1 234,5', '1 234,50', 1234.5, true], ['is', '1,234.5', '1,234.50', 1234.5, true],
  ['is', '2026.03.01.', '2026.03.01.', '2026-03-01', true], ['is', '2026-03-01', '1 Mar', '2026-03-01', true], ['is', '2026-03-02', '2026.03.01.', '2026-03-01', false],
  ['isnt', 'To do', 'Done', 'Done', true], ['isnt', 'to do', 'To do', 'To do', false], ['isnt', '5', '5', 5, false], ['isnt', 'x', '', null, true],
  ['has', 'pp', 'Apple', 'Apple', true], ['has', 'PP', 'apple', 'apple', true], ['has', 'z', 'Apple', 'Apple', false],
  ['hasnt', 'z', 'Apple', 'Apple', true], ['hasnt', 'app', 'Apple', 'Apple', false],
  ['starts', 'ap', 'Apple', 'Apple', true], ['starts', 'pp', 'Apple', 'Apple', false], ['starts', 'apple pie', 'Apple', 'Apple', false],
  ['ends', 'LE', 'Apple', 'Apple', true], ['ends', 'app', 'Apple', 'Apple', false], ['ends', 'an apple', 'Apple', 'Apple', false],
  ['blank', '', '', null, true], ['blank', '', ' ', ' ', true], ['blank', '', '0', 0, false], ['nblank', '', 'x', 'x', true], ['nblank', '', '', null, false],
  ['gt', '10', '11', 11, true], ['gt', '10', '10', 10, false], ['gt', '10', 'eleven', 'eleven', false], ['gt', 'abc', '11', 11, false], ['gt', '1,5', '2', 2, true],
  ['ge', '10', '10', 10, true], ['ge', '10', '9,99', 9.99, false], ['lt', '0', '-1', -1, true], ['lt', '0', '0', 0, false], ['le', '0', '0', 0, true], ['le', '-1', '0', 0, false],
  ['gt', '10', '', null, false], ['lt', '10', '', null, false],
  ['before', '2026-03-01', '2026.02.28.', '2026-02-28', true], ['before', '2026-03-01', '2026.03.01.', '2026-03-01', false],
  ['after', '2026. 3. 1.', '2026.03.02.', '2026-03-02T08:30', true], ['after', '2026-03-01', 'text', 'text', false], ['after', 'soon', '2026.03.02.', '2026-03-02', false],
  ['dup', '', 'a', 'a', true, true], ['dup', '', 'a', 'a', false, false],
  ['err', '', '#DIV/0!', E('#DIV/0!'), true], ['err', '', '#DIV/0!', '#DIV/0!', false], ['err', '', '5', 5, false],
  ['true', '', 'TRUE', true, true], ['true', '', '', null, false], ['false', '', '', null, true], ['false', '', 'FALSE', false, true], ['false', '', 'TRUE', true, false],
  ['nonsense', 'x', 'y', 'y', true],
], (c) => P.test(P.prep({ op: c[0], val: c[1] }), { t: c[2], v: c[3], dup: c.length > 5 ? c[4] : false }));

group('active', [
  ['is', '', false], ['is', '  ', false], ['is', 'x', true], ['gt', '0', true], ['blank', '', true], ['nblank', '', true], ['dup', '', true], ['err', '', true],
  ['true', '', true], ['false', '', true], ['has', null, false],
], (c) => P.active({ op: c[0], val: c[1] }));
group('needsVal', [['is', true], ['after', true], ['le', true], ['blank', false], ['dup', false], ['err', false], ['true', false]], (c) => P.needsVal(c[0]));

group('numbers', [
  ['12', 12], ['-3.5', -3.5], ['1,5', 1.5], ['1 234,5', 1234.5], ['1 234', 1234], ['1,234.5', 1234.5], ['1,234,567', 1234567], ['1.234,5', 1234.5],
  [',5', 0.5], ['1e3', 1000], ['', null], ['abc', null], ['12 kg', null], ['1,2,3', null], [null, null],
], (c) => P.num(c[0]));
group('dates', [
  ['2026-03-01', '2026-03-01'], ['2026.03.01.', '2026-03-01'], ['2026. 3. 1.', '2026-03-01'], ['2026/3/1', '2026-03-01'], ['2026-03-01T10:00', '2026-03-01'],
  ['2026.03.01. 10:00', '2026-03-01'], ['2026-13-01', null], ['2026-03-32', null], ['03/01/2026', null], ['soon', null], ['', null], ['20260301', null],
], (c) => P.date(c[0]));

const FN = ['ABS', 'IF', 'SUM', 'VLOOKUP'];
group('errors', [
  ['#DIV/0!', '=A1/0', { kind: 'div', fn: null }], ['#REF!', '=Nope!A1', { kind: 'ref', fn: null }], ['#VALUE!', '=A1+"x"', { kind: 'value', fn: null }],
  ['#N/A', '=VLOOKUP(1,A:B,2,0)', { kind: 'na', fn: null }], ['#NUM!', '=SQRT(-1)', { kind: 'num', fn: null }], ['#CYCLE!', '=A1', { kind: 'cycle', fn: null }],
  ['#NULL!', '=A1 B2', { kind: 'null', fn: null }], ['#WHAT?', '=1', { kind: 'other', fn: null }], [undefined, '=1', { kind: 'other', fn: null }],
  ['#NAME?', '=SUMM(A1:A3)', { kind: 'nameFn', fn: 'SUMM' }], ['#NAME?', '=IF(A1>0,summ(B:B),0)', { kind: 'nameFn', fn: 'SUMM' }],
  ['#NAME?', '=SUM(A1:A3)+foo', { kind: 'name', fn: null }], ['#NAME?', '=IF(A1="NOPE(",1,2)', { kind: 'name', fn: null }],
  ['#NAME?', "='My SHEET(1)'!A1+SUM(1)", { kind: 'name', fn: null }], ['#NAME?', '=SUM(1,2', { kind: 'name', fn: null }],
  ['#NAME?', '=ÁTLAG(A1:A3)', { kind: 'nameFn', fn: 'ÁTLAG' }], ['#DIV/0!', '=NOPE(1)/0', { kind: 'div', fn: null }],
], (c) => P.errInfo(c[0], c[1], FN));
group('errorsNoNames', [['#NAME?', '=NOPE(1)', { kind: 'name', fn: null }]], (c) => P.errInfo(c[0], c[1], []));

// [text, query, {cs, whole}, expected]
group('matches', [
  ['Apple pie', 'pie', {}, true], ['Apple pie', 'PIE', {}, true], ['Apple pie', 'PIE', { cs: true }, false], ['Apple pie', 'Apple', { cs: true }, true],
  ['Apple pie', 'apple', { whole: true }, false], ['Apple', 'apple', { whole: true }, true], ['Apple', 'apple', { whole: true, cs: true }, false],
  ['Apple', '', {}, false], ['a.b', '.', {}, true], ['ab', '.', {}, false], [12.5, '2.5', {}, true],
], (c) => P.matches(c[0], c[1], c[2]));
// [text, query, replacement, {cs, whole}, expected]
group('replace', [
  ['Apple pie', 'p', 'b', {}, 'Abble bie'], ['Apple pie', 'P', 'b', { cs: true }, 'Apple pie'], ['Apple Pie', 'P', 'b', { cs: true }, 'Apple bie'],
  ['a.b.c', '.', '-', {}, 'a-b-c'], ['cost', 'cost', '$&x', {}, '$&x'], ['price (net)', '(net)', '[n]', {}, 'price [n]'], ['Apple', 'apple', 'Pear', { whole: true }, 'Pear'],
  ['Apple pie', 'apple', 'Pear', { whole: true }, 'Apple pie'], ['aaa', 'a', '', {}, ''], ['=SUM(A1:A3)', 'sum', 'AVERAGE', {}, '=AVERAGE(A1:A3)'], ['x', 'y', 'z', {}, 'x'],
], (c) => P.replace(c[0], c[1], c[2], c[3]));

// [format, step, the decimals a General cell shows, expected]
group('decimals', [
  [null, 1, 0, '0.0'], [null, 1, 2, '0.000'], [null, -1, 2, '0.0'], [null, -1, 0, '0'], ['', 1, 0, '0.0'],
  ['0.00', 1, 0, '0.000'], ['0.00', -1, 0, '0.0'], ['0.0', -1, 0, '0'], ['0', -1, 0, '0'], ['0', 1, 0, '0.0'],
  ['#,##0', 1, 0, '#,##0.0'], ['#,##0.00 €', -1, 0, '#,##0.0 €'], ['$#,##0.00', 1, 0, '$#,##0.000'], ['0%', 1, 0, '0.0%'], ['0.0%', -1, 0, '0%'],
  ['#,##0 "Ft"', 1, 0, '#,##0.0 "Ft"'], ['#,##0 "0 Ft"', 1, 0, '#,##0.0 "0 Ft"'], ['#,##0.00;-#,##0.00', -1, 0, '#,##0.0;-#,##0.0'], ['000.0', 1, 0, '000.00'],
  ['0.0000000000', 1, 0, '0.0000000000'], ['@', 1, 0, null], ['yyyy-mm-dd', 1, 0, null],
], (c) => P.decimals(c[0], c[1], c[2]));

// every string table of the page (pickLang({en: {...}, hu: {...}}, L)) holds the same keys in both languages
function keysIn(body) {
  const ks = [], re = /(?:^\s*|[,{]\s*|\n\s*)([A-Za-z_]\w*): (?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  let x;
  while ((x = re.exec(body))) ks.push(x[1]);
  return ks;
}
let en = [], hu = [], onlyEn = [], onlyHu = [], twice = [], tables = 0, tm;
const tre = /pickLang\(\{\n    en: \{([\s\S]*?)\},\n    hu: \{([\s\S]*?)\}\n  \}, L\)/g;
while ((tm = tre.exec(src))) {
  const e = keysIn(tm[1]), u = keysIn(tm[2]);
  tables++;
  onlyEn = onlyEn.concat(e.filter((k) => u.indexOf(k) < 0)); onlyHu = onlyHu.concat(u.filter((k) => e.indexOf(k) < 0));
  twice = twice.concat(e.filter((k, i) => e.indexOf(k) !== i));
  en = en.concat(e); hu = hu.concat(u);
}
out.strings = { tables, en: en.length, hu: hu.length, onlyEn, onlyHu, twice };
// every T.key the page reads is in the tables (T["fo_" + op], T["err_" + kind] and T[a] are built names)
const used = new Set();
src.replace(/\bT\.([A-Za-z_]\w*)/g, (m, k) => { used.add(k); return m; });
out.strings.missing = en ? [...used].filter((k) => en.indexOf(k) < 0 && k !== 'ok') : null;
const ops = ['is', 'isnt', 'has', 'hasnt', 'starts', 'ends', 'blank', 'nblank', 'gt', 'ge', 'lt', 'le', 'before', 'after', 'dup', 'err', 'true', 'false'];
const kinds = ['div', 'ref', 'name', 'nameFn', 'value', 'na', 'num', 'cycle', 'null', 'other'];
out.strings.built = en ? ops.map((o) => 'fo_' + o).concat(kinds.map((k) => 'err_' + k), ['sum', 'avg', 'min', 'max', 'count']).filter((k) => en.indexOf(k) < 0) : null;
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "node is not on PATH")
class SheetPageTests(unittest.TestCase):
    out = None

    @classmethod
    def setUpClass(cls):
        fd, path = tempfile.mkstemp(suffix=".js")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(SCRIPT)
            r = subprocess.run([NODE, path, str(SHEET)], capture_output=True, text=True, encoding="utf-8", timeout=120)
        finally:
            os.unlink(path)
        if r.returncode != 0:
            raise AssertionError(r.stderr or r.stdout)
        cls.out = json.loads(r.stdout)

    def check(self, name):
        g = self.out[name]
        self.assertGreater(g["n"], 0)
        self.assertEqual(g["fails"], [], "\n" + "\n".join("%s -> %s, want %s" % tuple(f) for f in g["fails"]))

    def test_node_check(self):
        r = subprocess.run([NODE, "--check", str(SHEET)], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_filter_conditions(self):
        self.check("conditions")
        self.check("active")
        self.check("needsVal")

    def test_condition_values(self):
        self.check("numbers")
        self.check("dates")

    def test_error_kinds(self):
        self.check("errors")
        self.check("errorsNoNames")

    def test_find_and_replace(self):
        self.check("matches")
        self.check("replace")

    def test_decimals(self):
        self.check("decimals")

    def test_strings_in_both_languages(self):
        s = self.out["strings"]
        self.assertGreater(s["en"], 150)
        self.assertEqual(s["onlyEn"], [], "keys only in the English table")
        self.assertEqual(s["onlyHu"], [], "keys only in the Hungarian table")
        self.assertEqual(s["twice"], [], "keys given twice")
        self.assertEqual(s["missing"], [], "T.keys the page reads that the tables lack")
        self.assertEqual(s["built"], [], "built key names the tables lack")

    def test_pure_block_has_no_dom(self):
        src = SHEET.read_text(encoding="utf-8")
        block = src[src.index("// >>> pure"):src.index("// <<< pure")]
        self.assertIsNone(re.search(r"\b(document|window|kit|hm)\b\.", block))


if __name__ == "__main__":
    unittest.main()
