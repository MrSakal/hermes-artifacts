"""The board page's pure helpers (the block between ">>> pure" and "<<< pure" in types/board/board.js),
run under node: the link button keeps a line's marks, the B/I/list buttons, whether a cell being typed
in survives a read of the table. Also: the page's two string tables hold the same keys, the file parses,
and the behaviours fixed in the page that are plain to see in its source stay so."""

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOARD = ROOT / "plugin" / "hermes_artifacts" / "types" / "board"
PAGE = BOARD / "board.js"
NODE = shutil.which("node")

SCRIPT = r"""
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const G = require(process.argv[3]);
const a = src.indexOf('// >>> pure'), b = src.indexOf('// <<< pure');
if (a < 0 || b < a) throw new Error('the pure block is not marked in board.js');
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
const U = 'https://x.io';
// [a line, what the link button makes of it]
group('linkLine', [
  ['***Dia***', '[***Dia***](' + U + ')'],
  ['**Kiadás**', '[**Kiadás**](' + U + ')'],
  ['plain words', '[plain words](' + U + ')'],
  ['*a* and `c`', '[*a* and `c`](' + U + ')'],
  ['- **item**', '- [**item**](' + U + ')'],
  ['1. one', '1. [one](' + U + ')'],
  ['[old](https://o.io) **b**', '[old **b**](' + U + ')'],
  ['a [b] c', '[a b c](' + U + ')'],
  ['', ''], ['   ', '   '], ['- ', '- '],
], (c) => P.linkLine(U)(c[0]));
// the link made keeps every mark, as the export (geo.richLines) and measure read it
group('linkReads', [
  ['***Dia***', [[{ t: 'Dia', b: true, i: true, href: U }], ['Dia']]],
  ['**Kiadás** *now*', [[{ t: 'Kiadás', b: true, href: U }, { t: ' ', href: U }, { t: 'now', i: true, href: U }], ['Kiadás now']]],
], (c) => { const t = P.linkLine(U)(c[0]); return [G.richLines(t, 16).lines[0].runs, G.measure(t, 16).lines]; });
group('marks', [
  ['Dia', '**', '**Dia**'], ['**Dia**', '**', 'Dia'], ['***Dia***', '*', '**Dia**'], ['**Dia**', '*', '***Dia***'],
  ['- a\n- b', '**', '- **a**\n- **b**'],
], (c) => P.markText(c[0], c[1]));
group('list', [['a\nb', '- a\n- b'], ['- a\n- b', 'a\nb'], ['- a\nb', '- a\n- b']], (c) => P.listText(c[0]));
group('plain', [['[**a**](https://x.io) *b* `c`', 'a b c'], ['[***Dia***](https://x.io)', 'Dia']], (c) => P.plain(c[0]));
// [rows, r, c, does the cell being typed in stay]
group('cellStays', [
  [[['', '', ''], ['', '', '']], 0, 0, true], [[['', '', ''], ['', '', '']], 1, 2, true],
  [[['', '']], 0, 2, false], [[['', '']], 1, 0, false], [null, 0, 0, false], [[['a'], ['b', 'c']], 0, 1, true],
], (c) => P.cellStays(c[0], c[1], c[2]));

// every string table (pickLang({en: {...}, hu: {...}}, L)) holds the same keys in both languages
function keysIn(body) {
  const ks = [];
  body = body.replace(/"(?:[^"\\]|\\.)*"/g, '""');   // the words themselves (a "Esc: …" in one) are not keys
  let depth = 0, m;
  const re = /([{}])|(?:^|[\s,{])([A-Za-z_]\w*)\s*:/g;
  while ((m = re.exec(body))) { if (m[1] === '{') depth++; else if (m[1] === '}') depth--; else if (!depth) ks.push(m[2]); }
  return ks;
}
const tm = /pickLang\(\{\r?\n    en: \{([\s\S]*?)\r?\n    \},\r?\n    hu: \{([\s\S]*?)\r?\n    \}\r?\n  \}, L\)/.exec(src);
const en = tm ? keysIn(tm[1]) : [], hu = tm ? keysIn(tm[2]) : [];
out.strings = { found: !!tm, en: en.length, onlyEn: en.filter((k) => hu.indexOf(k) < 0), onlyHu: hu.filter((k) => en.indexOf(k) < 0) };
process.stdout.write(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "node is not installed")
class BoardPageTests(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        fd, path = tempfile.mkstemp(suffix=".js")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(SCRIPT)
        try:
            r = subprocess.run([NODE, path, str(PAGE), str(BOARD / "geo.js")], capture_output=True, text=True, encoding="utf-8", timeout=120)
        finally:
            os.unlink(path)
        if r.returncode != 0:
            raise AssertionError("node failed:\n" + r.stderr[-4000:])
        cls.out = json.loads(r.stdout)
        cls.src = PAGE.read_text("utf-8")

    def check(self, name, at_least):
        g = self.out[name]
        self.assertEqual(g["fails"], [], name)
        self.assertGreaterEqual(g["n"], at_least, name)

    def test_node_check(self):
        for f in ("board.js", "geo.js"):
            r = subprocess.run([NODE, "--check", str(BOARD / f)], capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_the_link_button_keeps_bold_and_italic(self):
        self.check("linkLine", 11)
        self.check("linkReads", 2)
        self.check("plain", 2)

    def test_marks_and_lists(self):
        self.check("marks", 5)
        self.check("list", 3)

    def test_a_cell_being_typed_in_survives_a_read_of_its_table(self):
        self.check("cellStays", 6)
        merge = self.src[self.src.index("function merge(r)"):self.src.index("function usable(e)")]
        self.assertIn("if (!cellStays(nw.rows, ed.r, ed.c)) dropEdit();", merge)
        # what made it drop: the server's copy of an item, its keys in its own order, was "changed"
        same = self.src[self.src.index("function same(a, b)"):self.src.index("function clamp(")]
        self.assertNotIn("JSON.stringify", same)

    def test_strings_in_both_languages(self):
        s = self.out["strings"]
        self.assertTrue(s["found"])
        self.assertGreater(s["en"], 100)
        self.assertEqual((s["onlyEn"], s["onlyHu"]), ([], []))

    def test_esc_gives_typing_up_everywhere(self):
        src = self.src
        block = src[src.index("function startEdit(id, o)"):src.index("function edInput()")]
        self.assertIn("if (ed && ed.ph) discardPlaceholder(); else endEdit(true);", block)   # a block, a section title
        cell = src[src.index("function editCell(id, r, c)"):src.index("function commitCell(e, it)")]
        self.assertIn("ta.value = ed.orig; endEdit();", cell)
        label = src[src.index("function editLabel(id)"):src.index("function commitLabel(e, a)")]
        self.assertIn('if (e.key === "Escape") inp.value = ed.orig;', label)
        end = src[src.index("function endEdit(cancel)"):src.index("function dropEdit()")]
        self.assertIn("if (cancel === true) e.ta.value = e.orig;", end)
        self.assertIn("if (cancel === true) text = e.orig;", end)

    def test_a_dot_only_clicked_makes_nothing(self):
        fin = self.src[self.src.index("// only a drag past DRAG makes something"):]
        fin = fin[:fin.index("placeholder(")]
        self.assertIn("if (!gg.far && dist(gg.s0, e) <= DRAG) break;", fin)

    def test_esc_on_a_tools_picker_returns_to_select(self):
        src = self.src
        self.assertIn("T.draw, toSelect);", src)
        self.assertRegex(src, r"shapePop\(anchor, prefs\.shape, true, function \(k\) \{[^}]*\}, toSelect\)")
        self.assertIn("if (popEl) escPop();", src)

    def test_the_canvas_never_scrolls(self):
        css = (BOARD / "board.css").read_text("utf-8")
        for sel in (".bd {", ".bd-view {", ".bd-ui {"):
            rule = css[css.index("\n" + sel):]
            self.assertIn("overflow: clip;", rule[:rule.index("}")], sel)
        self.assertIn('world.addEventListener("focusin"', self.src)
        self.assertRegex(self.src, r'el\.addEventListener\("scroll", function \(\) \{ if \(el\.scrollTop \|\| el\.scrollLeft\)')

    def test_pen_lines_are_hit_6_screen_px_out(self):
        css = (BOARD / "board.css").read_text("utf-8")
        self.assertIn(".bd-pen .bd-ahit { stroke-width: calc(var(--bd-pw, 3px) + 12px * var(--bd-k, 1)); }", css)
        self.assertIn("stroke-width: max(14px, calc(12px * var(--bd-k, 1)));", css)

    def test_view_only_select_all_selects_nothing(self):
        self.assertIn('else if (ro) { if (lk === "a") e.preventDefault(); return; }', self.src)

    def test_the_working_pill_goes_on_its_own(self):
        for f, call in ((PAGE, "setHermes(r.hermes_active, r.hermes_left, r.hermes_ago)"),
                        (ROOT / "plugin" / "hermes_artifacts" / "types" / "sheet" / "sheet.js", "setHermes(r.hermes_active, r.hermes_left, r.hermes_ago)")):
            src = f.read_text("utf-8")
            fn = src[src.index("function setHermes("):]
            fn = fn[:fn.index("\n  }\n")]
            self.assertIn("hermesTimer = setTimeout(function () { setHermes(false); }, kit.hermesWork.left() * 1000 + 500);", fn, f.name)
            self.assertIn("kit.hermesWork.seen(active, left, ago);", fn, f.name)  # every read through the run-aware rule
            self.assertIn("kit.hermesWork.change(function () { setHermes(); });", src, f.name)  # and every word from the host
            self.assertEqual(src.count(call), 2, f.name)


if __name__ == "__main__":
    unittest.main()
