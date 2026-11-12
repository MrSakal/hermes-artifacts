"""Live sheets: a workbook of cells the user and Hermes edit together; xlsx/CSV import."""

import json
import re
import os
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, render, sheets, store, xlsx_in  # noqa: E402
from test_types import load_plugin  # noqa: E402

BOOK = {"title": "Budget 2026", "sheets": [
    {"name": "Costs",
     "rows": [["Item", "Unit price", "Qty", "Total"],
              ["Wall panels", 1200, 3, "=B2*C2"],
              ["Total", None, None, "=SUM(D2:D2)"]],
     "cols": {"A": 180}, "freeze": {"rows": 1},
     "formats": {"A1:D1": {"bold": True}, "B2:B99": {"num": "#,##0 \"Ft\""}},
     "charts": [{"type": "bar", "range": "A1:D2", "title": "Costs", "at": "F2"}]},
    {"name": "My plan", "rows": [["Ref", "=Costs!D2+'Costs'!B3"], ["Text", "=\"Costs!A5 \"&Costs!A5"]]}]}


def op(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


def pub(book=None):
    return store.publish(title="Budget", type="sheet", files={"sheet.json": book or BOOK})["id"]


class PublishTests(unittest.TestCase):
    def test_first_state(self):
        aid = pub()
        r = sheets.read(aid)
        self.assertEqual(r["name"], "Costs")
        self.assertEqual(r["rev"], 1)
        self.assertEqual(r["range"], "A1:D3")
        self.assertEqual(r["rows"][1], ["Wall panels", 1200, 3, "=B2*C2"])
        self.assertEqual(r["rows"][2], ["Total", None, None, "=SUM(D2:D2)"])
        self.assertEqual(r["fmt"]["A1"], {"bold": True})
        self.assertEqual(r["fmt"]["B3"]["num"], '#,##0 "Ft"')
        self.assertIn("B99", r["fmt"])  # range formats reach as far as the used range + 200 rows
        self.assertEqual(r["freeze"], {"rows": 1, "cols": 0})
        self.assertEqual(r["charts"][0]["id"], "c1")
        self.assertTrue(r["stale"])  # formulas nobody computed yet
        self.assertTrue(r["hermes_active"])
        self.assertEqual([s["name"] for s in r["sheets"]], ["Costs", "My plan"])
        self.assertEqual((r["sheets"][0]["rows"], r["sheets"][0]["cols"]), (3, 4))
        self.assertEqual(store.TYPES.index("sheet"), store.TYPES.index("doc") + 1)

    def test_validation(self):
        bad = [({"sheets": []}, "sheets"),
               ({"sheets": [{"name": "a/b", "rows": []}]}, "name"),
               ({"sheets": [{"name": "A", "rows": [[{"x": 1}]]}]}, "rows[0][0]"),
               ({"sheets": [{"name": "A", "rows": [[None] * 101]}]}, "100 columns"),
               ({"sheets": [{"name": "A", "rows": [["x" * 4001]]}]}, "4000"),
               ({"sheets": [{"name": "A", "rows": []}, {"name": "a", "rows": []}]}, "two sheets"),
               ({"sheets": [{"name": "A", "rows": [], "formats": {"A1": {"blink": True}}}]}, "blink"),
               ({"sheets": [{"name": "A", "rows": [], "charts": [{"type": "radar", "range": "A1:B2"}]}]}, "bar, line or pie"),
               ({"sheets": [{"name": str(i), "rows": []} for i in range(21)]}, "20 sheets")]
        for book, word in bad:
            with self.assertRaises(ValueError) as e:
                store.publish(title="x", type="sheet", files={"sheet.json": book})
            self.assertIn(word, str(e.exception))
            self.assertIn("sheet.json", str(e.exception))
        with self.assertRaises(ValueError):
            store.publish(title="x", type="sheet", files={"sheet.json": "{nope"})

    def test_republish_starts_again(self):
        aid = pub()
        sheets.apply(aid, [{"op": "set", "range": "A5", "values": [["x"]]}], by="user")
        store.publish(aid=aid, files={"sheet.json": {"sheets": [{"name": "New", "rows": [[1]]}]}})
        self.assertEqual(sheets.read(aid)["name"], "New")


class EditTests(unittest.TestCase):
    def setUp(self):
        self.aid = pub()

    def cells(self, sheet=None):
        return sheets.load(self.aid)["sheets"][0 if sheet is None else sheet]["cells"]

    def test_set_clear_format(self):
        r = sheets.apply(self.aid, [{"op": "set", "range": "B4", "values": [[900, 2], [None, ""]]},
                                    {"op": "set", "range": "E1", "values": "Note"}], by="user")
        self.assertEqual(r["rev"], 2)
        self.assertEqual(r["changed"], ["E1", "B4", "C4"])
        c = self.cells()
        self.assertEqual((c["B4"], c["C4"], c["E1"]), (900, 2, "Note"))
        sheets.apply(self.aid, [{"op": "set", "range": "C4", "values": [[""]]}], by="user")
        self.assertNotIn("C4", self.cells())
        sheets.apply(self.aid, [{"op": "format", "range": "A2:A3", "italic": True, "bg": "#FFEE00"},
                                {"op": "format", "range": "A1", "bold": None}], by="user")
        sheets.apply(self.aid, [{"op": "clear", "range": "A2:B9"}], by="user")
        r = sheets.read(self.aid)
        self.assertNotIn("A2", self.cells())
        self.assertEqual(r["fmt"]["A2"], {"italic": True, "bg": "#ffee00"})  # formats stay
        self.assertNotIn("A1", r["fmt"])
        for bad in ({"op": "format", "range": "A1", "align": "middle"}, {"op": "set", "range": "Z1:", "values": 1},
                    {"op": "set", "range": "CW1", "values": 1}, {"op": "nope"}, {"op": "set", "range": "A1", "values": [[[1]]]}):
            with self.assertRaises(sheets.SheetError):
                sheets.apply(self.aid, [bad], by="user")

    def test_insert_and_delete_rows_rewrite_formulas(self):
        sheets.apply(self.aid, [{"op": "set", "range": "D3", "values": [["=SUM(D2:D2)+$B$2+COUNT(B:B)+SUM(2:2)"]]}], by="user")
        sheets.apply(self.aid, [{"op": "insert_rows", "at": 2, "n": 2}], by="user")
        c = self.cells()
        self.assertEqual(c["D4"], "=B4*C4")
        self.assertEqual(c["D5"], "=SUM(D4:D4)+$B$4+COUNT(B:B)+SUM(4:4)")
        self.assertNotIn("A2", c)
        plan = self.cells(1)
        self.assertEqual(plan["B1"], "=Costs!D4+'Costs'!B5")
        self.assertEqual(plan["B2"], "=\"Costs!A5 \"&Costs!A7")  # text inside quotes untouched
        st = sheets.read(self.aid)
        self.assertEqual(st["fmt"]["B4"]["num"], '#,##0 "Ft"')
        self.assertEqual(st["charts"][0]["range"], "A1:D4")  # the chart's range grew around the insert
        self.assertEqual(st["freeze"]["rows"], 1)
        # Deleting the rows a reference points into turns it into #REF!.
        sheets.apply(self.aid, [{"op": "delete_rows", "at": 4, "n": 1}], by="user")
        c = self.cells()
        self.assertEqual(c["D4"], "=SUM(#REF!)+#REF!+COUNT(B:B)+SUM(#REF!)")
        self.assertEqual(self.cells(1)["B1"], "=#REF!+'Costs'!B4")
        # Inside a range it shrinks.
        sheets.apply(self.aid, [{"op": "set", "range": "F1", "values": [["=SUM(A1:A9)"]]}], by="user")
        sheets.apply(self.aid, [{"op": "delete_rows", "at": 2, "n": 2}], by="user")
        self.assertEqual(self.cells()["F1"], "=SUM(A1:A7)")

    def test_columns_and_sheet_names(self):
        sheets.apply(self.aid, [{"op": "insert_cols", "at": "B", "n": 1}], by="user")
        c = self.cells()
        self.assertEqual(c["E2"], "=C2*D2")
        self.assertEqual(self.cells(1)["B1"], "=Costs!E2+'Costs'!C3")
        st = sheets.read(self.aid)
        self.assertEqual(st["cols"], {"A": 180})
        self.assertEqual(st["charts"][0]["range"], "A1:E2")
        self.assertEqual(st["charts"][0]["at"], "G2")
        sheets.apply(self.aid, [{"op": "col_width", "col": "B", "w": 2000}, {"op": "delete_cols", "at": "A"}], by="user")
        st = sheets.read(self.aid)
        self.assertEqual(st["cols"], {"A": 800})
        self.assertEqual(self.cells()["D2"], "=B2*C2")
        r = sheets.apply(self.aid, [{"op": "rename_sheet", "name": "Q1 costs"}], by="user")
        self.assertEqual(r["sheets"][0]["name"], "Q1 costs")
        self.assertEqual(self.cells(1)["B1"], "='Q1 costs'!D2+'Q1 costs'!B3")
        plan = sheets.load(self.aid)["sheets"][1]["id"]
        sheets.apply(self.aid, [{"op": "move_sheet", "to": 0}], by="user", sheet=plan)
        self.assertEqual(sheets.read(self.aid)["name"], "My plan")
        r = sheets.apply(self.aid, [{"op": "add_sheet", "name": "Q2", "rows": [[1, "=A1*2"]]}], by="user", sheet="Q1 costs")
        self.assertTrue(r["new_sheet"])
        sheets.apply(self.aid, [{"op": "delete_sheet"}], by="user", sheet="Q1 costs")
        self.assertEqual(sheets.load(self.aid)["sheets"][0]["cells"]["B1"], "=#REF!+#REF!")
        self.assertEqual([s["name"] for s in sheets.read(self.aid)["sheets"]], ["My plan", "Q2"])
        with self.assertRaises(sheets.SheetError):
            sheets.apply(self.aid, [{"op": "rename_sheet", "name": "q2"}], by="user")

    def test_sort_numbers_text_empty(self):
        rows = [["k", "v"], [3, "c"], ["b", "x"], [None, "e"], [1, "=A5*2"], ["A", "y"], [1, "z"]]
        aid = pub({"sheets": [{"name": "S", "rows": rows}]})
        sheets.apply(aid, [{"op": "sort", "range": "A2:B7", "col": "A"}], by="user")
        g = sheets.read(aid)["rows"][1:]
        self.assertEqual([r[0] if r else None for r in g], [1, 1, 3, "A", "b", None])
        self.assertEqual(g[0][1], "=A2*2")  # the formula moved with its row, references shifted
        self.assertEqual(g[1][1], "z")      # stable
        sheets.apply(aid, [{"op": "sort", "range": "A2:B7", "col": "A", "desc": True}], by="user")
        g = sheets.read(aid)["rows"][1:]
        self.assertEqual([r[0] if r else None for r in g], ["b", "A", 3, 1, 1, None])
        with self.assertRaises(sheets.SheetError):
            sheets.apply(aid, [{"op": "sort", "range": "A2:B7", "col": "D"}], by="user")

    def test_charts_freeze(self):
        r = sheets.apply(self.aid, [{"op": "add_chart", "type": "pie", "range": "A1:B3"}, {"op": "freeze", "rows": 2, "cols": 1}], by="user")
        st = sheets.read(self.aid)
        self.assertEqual([c["id"] for c in st["charts"]], ["c1", "c2"])
        self.assertEqual(st["freeze"], {"rows": 2, "cols": 1})
        sheets.apply(self.aid, [{"op": "delete_chart", "id": "c1"}], by="user")
        self.assertEqual([c["id"] for c in sheets.read(self.aid)["charts"]], ["c2"])
        self.assertTrue(r["ok"])

    def test_guards_and_conflicts(self):
        # Hermes writing over values needs base_rev; into empty cells it does not.
        with self.assertRaises(sheets.SheetError) as e:
            sheets.apply(self.aid, [{"op": "set", "range": "B2", "values": [[1300]]}], by="hermes")
        self.assertEqual(e.exception.code, "missing_guard")
        sheets.apply(self.aid, [{"op": "set", "range": "A9", "values": [["new"]]}], by="hermes")
        for o in ({"op": "clear", "range": "A1:A2"}, {"op": "delete_rows", "at": 2}, {"op": "sort", "range": "A1:D3"}):
            with self.assertRaises(sheets.SheetError):
                sheets.apply(self.aid, [o], by="hermes")
        base = sheets.read(self.aid)["rev"]
        sheets.apply(self.aid, [{"op": "set", "range": "B2", "values": [[1250]]}], by="user")
        with self.assertRaises(sheets.SheetError) as e:
            sheets.apply(self.aid, [{"op": "set", "range": "B2", "values": [[1300]]}], by="hermes", base_rev=base)
        self.assertEqual(e.exception.code, "conflict")
        self.assertEqual(e.exception.extra["ids"], ["B2"])  # Hermes' conflict: one shape for docs, sheets, boards
        self.assertEqual(e.exception.extra["current"], {"B2": {"v": 1250}})
        self.assertEqual(self.cells()["B2"], 1250)
        # Another cell, against the same old rev, goes through; formats alone never conflict.
        sheets.apply(self.aid, [{"op": "format", "range": "C2", "bold": True}], by="user")
        sheets.apply(self.aid, [{"op": "set", "range": "C2", "values": [[4]]}], by="hermes", base_rev=base)
        # Rows moved meanwhile: every cell op of the other author is refused.
        base = sheets.read(self.aid)["rev"]
        sheets.apply(self.aid, [{"op": "insert_rows", "at": 1}], by="user")
        with self.assertRaises(sheets.SheetError) as e:
            sheets.apply(self.aid, [{"op": "set", "range": "Z1", "values": 1}], by="hermes", base_rev=base)
        self.assertEqual(e.exception.code, "conflict")
        # A failed batch changes nothing, in memory either.
        rev = sheets.read(self.aid)["rev"]
        with self.assertRaises(sheets.SheetError):
            sheets.apply(self.aid, [{"op": "set", "range": "A1", "values": "x"}, {"op": "bogus"}], by="user")
        self.assertEqual(sheets.read(self.aid)["rev"], rev)
        self.assertNotEqual(self.cells().get("A1"), "x")

    def test_reads(self):
        sheets.apply(self.aid, [{"op": "set", "range": "B2", "values": [[1300]]}], by="user")
        sheets.apply(self.aid, [{"op": "set", "range": "A3", "values": [[""]]}], by="user")
        r = sheets.read(self.aid, since_rev=1)
        self.assertEqual(r["changed"], {"B2": 1300})
        self.assertEqual(r["removed"], ["A3"])
        self.assertEqual(sheets.read(self.aid, since_rev=3)["changed"], {})
        sheets.apply(self.aid, [{"op": "insert_rows", "at": 1}], by="user")
        self.assertEqual(sheets.read(self.aid, since_rev=3)["since"], "unavailable")
        self.assertIn("rows", sheets.read(self.aid, since_rev=3))
        self.assertEqual([f["cell"] for f in sheets.read(self.aid, search="wall")["found"]], ["A3"])
        r = sheets.read(self.aid, "Costs", "B3:D3")
        self.assertEqual((r["range"], r["rows"]), ("B3:D3", [[1300, 3, "=B3*C3"]]))
        self.assertEqual(sheets.read(self.aid, None, "'My plan'!A1")["name"], "My plan")
        with self.assertRaises(sheets.SheetError):
            sheets.read(self.aid, "Nope")

    def test_agent_read_is_capped(self):
        rows = [[r * 100 + c for c in range(40)] for r in range(300)]
        aid = pub({"sheets": [{"name": "Big", "rows": rows}]})
        r = sheets.read(aid, agent=True)
        self.assertEqual(r["range"], "A1:AD200")
        self.assertEqual((len(r["rows"]), len(r["rows"][0])), (200, 30))
        self.assertIn("A1:AN300", r["more"])
        self.assertNotIn("fmt", r)
        self.assertEqual(len(sheets.read(aid)["rows"]), 300)  # the page's own read is whole
        r = sheets.read(aid, range="AE250:AN300", agent=True)
        self.assertEqual(r["rows"][0][0], 249 * 100 + 30)
        self.assertNotIn("more", r)

    def test_vals_and_stale(self):
        st = sheets.read(self.aid)
        self.assertTrue(st["stale"])
        self.assertFalse(sheets.set_vals(self.aid, None, st["rev"] - 1, {"D2": 3600})["ok"])  # an old rev
        sheets.set_vals(self.aid, None, st["rev"], {"D2": 3600, "D3": 3600, "A1": "not a formula", "E9": {"error": "#DIV/0!"}})
        r = sheets.read(self.aid)
        self.assertEqual(r["values"], {"D2": 3600, "D3": 3600})
        self.assertFalse(r["stale"])
        time.sleep(0.01)
        sheets.apply(self.aid, [{"op": "set", "range": "C2", "values": [[4]]}], by="hermes", base_rev=r["rev"])
        r = sheets.read(self.aid)
        self.assertTrue(r["stale"])
        self.assertEqual(r["values"]["D2"], 3600)  # kept until the page computes again
        sheets.set_vals(self.aid, None, r["rev"], {"D2": 4800})
        self.assertFalse(sheets.read(self.aid)["stale"])

    def test_history_and_restore(self):
        sheets.apply(self.aid, [{"op": "set", "range": "A2", "values": [["Doors"]]}], by="user")
        sheets.apply(self.aid, [{"op": "set", "range": "A2", "values": [["Windows"]]}], by="hermes", base_rev=2)
        h = sheets.history(self.aid)
        self.assertEqual([s["rev"] for s in h["snaps"]], [3, 2, 1])
        self.assertEqual(sheets.at_rev(self.aid, None, 1, agent=True)["rows"][1][0], "Wall panels")
        r = sheets.restore(self.aid, None, 2)
        self.assertEqual((r["rev"], r["restored"]), (4, 2))
        self.assertEqual(self.cells()["A2"], "Doors")
        with self.assertRaises(sheets.SheetError):
            sheets.at_rev(self.aid, None, 0)


class RefTests(unittest.TestCase):
    def test_edge_cases(self):
        cb = sheets._struct_cb("Costs", "Costs", "row", 2, 2, False)  # delete rows 3-4
        for f, want in [("=SUM(A1:A10)+$B$5*C3", "=SUM(A1:A8)+$B$3*#REF!"),
                        ('="A5"&A5', '="A5"&A3'),
                        ("=Costs!A5+'My sheet'!A5+costs!A5", "=Costs!A3+'My sheet'!A5+costs!A3"),
                        ("=SUM(2:6)+SUM(A:A)+LOG10(A6)", "=SUM(2:4)+SUM(A:A)+LOG10(A4)"),
                        ("=A3:A4", "=#REF!")]:
            self.assertEqual(sheets.map_refs(f, cb), want)
        self.assertEqual(sheets.shift_refs("=B2*$C$2+C$1+$D3", 3, 1), "=C5*$C$2+D$1+$D6")
        self.assertEqual(sheets.shift_refs("=A1", -1, 0), "=#REF!")
        self.assertEqual(sheets.quote_name("My plan"), "'My plan'")
        self.assertEqual(sheets.quote_name("Costs"), "Costs")
        self.assertEqual(sheets.parse_range("b2:d9"), (1, 1, 8, 3))

    def test_big_sparse_sheet_is_quick(self):
        aid = pub({"sheets": [{"name": "Big", "rows": [[1]]}]})
        block = [[r * 100 + c if c % 10 == 0 else None for c in range(100)] for r in range(4990)]
        block[0][1] = "=SUM(A2:A4990)"
        t = time.time()
        sheets.apply(aid, [{"op": "set", "range": "A1", "values": block}], by="user")
        sheets.apply(aid, [{"op": "insert_rows", "at": 10, "n": 1}, {"op": "delete_rows", "at": 10, "n": 1}], by="user")
        sheets.apply(aid, [{"op": "sort", "range": "A2:CV4990", "col": "A", "desc": True}], by="user")
        sheets.read(aid)
        sheets.read(aid, agent=True)
        self.assertLess(time.time() - t, 20)
        self.assertEqual(sheets.load(aid)["sheets"][0]["cells"]["B1"], "=SUM(A2:A4990)")


class BridgeTests(unittest.TestCase):
    def test_a_comment_on_a_cell_is_never_sent_empty(self):
        # The page's Comment button only opens the host's form at the cell (hermes.comment: an anchor, its
        # quote "A14" or "A14: <what it shows>"); what gets stored is the text typed there. Empty, blank
        # or only the "@Hermes " the form starts with: refused by the form and by the server.
        aid = pub()
        anchor = {"selector": "cell:" + sheets.load(aid)["sheets"][0]["id"] + "!A14", "text": "A14", "label": "Costs · A14"}
        for body in ("", "   ", "\n\t"):
            with self.assertRaises(ValueError):
                store.comment_add(aid, body, anchor=anchor)
            with self.assertRaises(api.ApiError):
                api.handle("POST", f"artifacts/{aid}/comments", {}, {"text": body, "anchor": anchor})
        self.assertEqual(store.comments_list(aid), [])
        host = (ROOT / "plugin" / "desktop" / "plugin.js").read_text("utf-8")
        form = host[host.index("function CommentForm("):]
        submit = form[:form.index("ctx.rest(")]
        # what is left once the "@Hermes" the text starts with goes (the form's own pattern, run here):
        # "@Hermes " alone is nothing. (A stray control character once stood where its \b is: nothing was cut.)
        m = re.search(r"text\.trim\(\)\.replace\(/(.+?)/i, ''\)", submit)
        self.assertTrue(m, submit)
        self.assertNotRegex(m.group(1), r"[\x00-\x1f]")
        cut = lambda t: re.sub(m.group(1), "", t.strip(), count=1, flags=re.I)  # noqa: E731
        self.assertEqual([cut(t) for t in ("@Hermes ", "@hermes, ", "@Hermes: fix it", "@Hermesx")], ["", "", "fix it", "@Hermesx"])
        self.assertIn("if (!body || busy) return", submit)                   # nothing is sent then
        self.assertIn("if (e.key === 'Escape') return onDone()", form)       # Esc closes, sends nothing
        page = (ROOT / "plugin" / "hermes_artifacts" / "types" / "sheet" / "sheet.js").read_text("utf-8")
        sel = page[page.index("function commentSel()"):page.index("function askSel()")]
        self.assertNotIn("hm.sheet.edit", sel)
        self.assertIn("text: (shown ? k + \": \" + shown : k)", sel)            # an empty cell's quote is just "A14"

    def test_ops(self):
        aid = pub()
        r = op(aid, "sheet.read")
        self.assertIn("fmt", r)
        e = op(aid, "sheet.edit", sheet=r["sheet"], ops=[{"op": "set", "range": "B2", "values": [[1]]}], base_rev=1)
        self.assertEqual(e["rev"], 2)
        sheets.apply(aid, [{"op": "set", "range": "C2", "values": [[9]]}], by="hermes", base_rev=2)
        c = op(aid, "sheet.edit", ops=[{"op": "set", "range": "C2", "values": [[1]]}], base_rev=2)
        self.assertEqual((c["ok"], c["conflict"], c["cells"]), (False, True, ["C2"]))
        d = op(aid, "sheet.read", since_rev=2)
        self.assertEqual(d["changed"], {"C2": 9})
        self.assertIn("C2", d["fmt"])
        self.assertTrue(op(aid, "sheet.vals", rev=3, vals={"D2": 9})["ok"])
        self.assertEqual(op(aid, "sheet.history")["snaps"][0]["rev"], 3)
        self.assertEqual(op(aid, "sheet.at", rev=2)["rev"], 2)
        self.assertEqual(op(aid, "sheet.restore", rev=1)["rev"], 4)
        a = op(aid, "sheet.ask", text="Is this right?", sheet=r["sheet"], range="B2:C3", selection="1\t9")
        item = store.inbox_get(a["id"])
        self.assertEqual(item["kind"], "sheet-ask")
        self.assertEqual(item["data"], {"sheet": r["sheet"], "range": "B2:C3", "selection": "1\t9"})
        with self.assertRaises(api.ApiError) as e:
            op(aid, "sheet.read", sheet="nope")
        self.assertEqual(e.exception.status, 404)
        with self.assertRaises(api.ApiError) as e:
            op(aid, "sheet.edit", ops=[{"op": "bogus"}])
        self.assertEqual(e.exception.status, 400)
        with self.assertRaises(api.ApiError):
            op(aid, "sheet.drop")

    def test_render_carries_the_live_sheet(self):
        if not (render.TYPES_DIR / "sheet" / "runtime.html").is_file():
            self.skipTest("the sheet page is not there yet")
        aid = pub()
        sheets.apply(aid, [{"op": "set", "range": "A2", "values": [["Live"]]}], by="user")
        html = render.render(store.get_meta(aid), store.version_dir(aid))
        start = html.index('id="hermes-artifact-content">') + len('id="hermes-artifact-content">')
        c = json.loads(html[start:html.index("</script>", start)])
        s0 = c["sheet"]["sheets"][0]
        self.assertEqual(s0["cells"]["A2"], "Live")
        for k in ("fmt", "vals", "cols", "freeze", "charts", "rev", "id", "name"):
            self.assertIn(k, s0)


class ToolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def test_publish_read_edit(self):
        p = self.p
        out = json.loads(p._publish({"type": "sheet", "title": "Budget", "files": {"sheet.json": BOOK}, "open": False}))
        self.assertTrue(out["ok"], out)
        self.assertEqual([s["name"] for s in out["sheet"]["sheets"]], ["Costs", "My plan"])
        aid = out["id"]
        r = json.loads(p._doc_read({"id": aid, "tab": "Costs"}))
        self.assertEqual(r["rows"][1][3], "=B2*C2")
        self.assertIn("ha_live_edit", r["note"])
        self.assertNotIn("fmt", r)
        r2 = json.loads(p._doc_read({"id": aid, "range": "A1:B1"}))
        self.assertEqual(r2["rows"], [["Item", "Unit price"]])
        g = json.loads(p._doc_edit({"id": aid, "ops": [{"op": "set", "range": "B2", "values": [[1300]]}]}))
        self.assertFalse(g["ok"])
        self.assertIn("base_rev", g["error"])
        e = json.loads(p._doc_edit({"id": aid, "tab": "Costs", "base_rev": r["rev"],
                                    "ops": json.dumps([{"op": "set", "range": "B2", "values": [[1300]]}])}))
        self.assertTrue(e["ok"], e)
        self.assertEqual(e["changed"], ["B2"])
        op(aid, "sheet.edit", ops=[{"op": "set", "range": "C2", "values": [[5]]}])
        c = json.loads(p._doc_edit({"id": aid, "base_rev": r["rev"], "ops": [{"op": "set", "range": "C2", "values": [[6]]}]}))
        self.assertTrue(c["conflict"])
        self.assertEqual(json.loads(p._doc_read({"id": aid, "since_rev": e["rev"]}))["changed"], {"C2": 5})
        self.assertTrue(json.loads(p._doc_read({"id": aid, "history": True}))["snaps"])
        self.assertEqual(json.loads(p._doc_read({"id": aid, "at_rev": 1}))["rows"][1][1], 1200)
        live = json.loads(p._read({"id": aid}))
        self.assertEqual(live["type"], "sheet")
        self.assertEqual(json.loads(live["content"])["sheets"][0]["rows"][1][1:3], [1300, 5])
        self.assertIn("1200", json.loads(p._read({"id": aid, "path": "sheet.json"}))["content"])
        again = json.loads(p._publish({"id": aid, "type": "sheet", "files": {"sheet.json": BOOK}, "open": False}))
        self.assertFalse(again["ok"])
        self.assertIn("live sheet", again["error"])
        self.assertIn("sheet", json.loads(p._guide({"type": "sheet"}))["guide"])

    def test_tool_schemas_name_sheets(self):
        tools = {t[0]: t[1] for t in self.p.TOOLS}
        self.assertIn("sheet", tools["ha_publish"]["parameters"]["properties"]["type"]["enum"])
        self.assertIn("range", tools["ha_live_read"]["parameters"]["properties"])
        self.assertLessEqual(len(json.dumps([t[1] for t in self.p.TOOLS])), 7296)  # 7385 before the ha_ names


def _xlsx(path):
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' \
         'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    files = {
        "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        "_rels/.rels": f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                       f'<Relationship Id="rId1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<workbook {ns}><sheets><sheet name="Costs" sheetId="1" r:id="rId1"/>'
                           f'<sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                                      f'<Relationship Id="rId1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/>'
                                      f'<Relationship Id="rId2" Type="{rel}/worksheet" Target="worksheets/sheet2.xml"/>'
                                      f'<Relationship Id="rId3" Type="{rel}/sharedStrings" Target="sharedStrings.xml"/>'
                                      f'<Relationship Id="rId4" Type="{rel}/styles" Target="styles.xml"/></Relationships>',
        "xl/sharedStrings.xml": f'<sst {ns}><si><t>Item</t></si><si><r><t>Wall </t></r><r><t>panels</t></r></si></sst>',
        "xl/styles.xml": f'<styleSheet {ns}><numFmts><numFmt numFmtId="164" formatCode="#,##0 &quot;Ft&quot;"/></numFmts>'
                         f'<fonts><font/><font><b/></font></fonts>'
                         f'<cellXfs><xf numFmtId="0" fontId="0"/><xf numFmtId="0" fontId="1"/><xf numFmtId="164" fontId="0"/>'
                         f'<xf numFmtId="14" fontId="0"/></cellXfs></styleSheet>',
        "xl/worksheets/sheet1.xml": f'<worksheet {ns}><sheetViews><sheetView><pane ySplit="1" topLeftCell="A2" state="frozen"/>'
                                    f'</sheetView></sheetViews><cols><col min="1" max="1" width="25" customWidth="1"/></cols><sheetData>'
                                    f'<row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Price</t></is></c></row>'
                                    f'<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" s="2"><v>1200</v></c>'
                                    f'<c r="C2"><f t="shared" ref="C2:C3" si="0">B2*2</f><v>2400</v></c><c r="D2" s="3"><v>46023</v></c></row>'
                                    f'<row r="3"><c r="B3"><v>2.5</v></c><c r="C3"><f t="shared" si="0"/><v>5</v></c>'
                                    f'<c r="D3" t="b"><v>1</v></c><c r="E3"><f>_xlfn.XLOOKUP(1,B2:B3,Notes!A1:A2)</f><v>0</v></c></row>'
                                    f'</sheetData></worksheet>',
        "xl/worksheets/sheet2.xml": f'<worksheet {ns}><sheetData><row r="1"><c r="A1" t="str"><v>hello</v></c></row></sheetData></worksheet>',
    }
    with zipfile.ZipFile(path, "w") as z:
        for n, t in files.items():
            z.writestr(n, t)


class ImportTests(unittest.TestCase):
    def test_xlsx(self):
        d = Path(tempfile.mkdtemp())
        _xlsx(d / "budget_2026.xlsx")
        spec = xlsx_in.to_sheet_json(d / "budget_2026.xlsx")
        self.assertEqual(spec["title"], "budget 2026")
        costs, notes = spec["sheets"]
        self.assertEqual(costs["name"], "Costs")
        self.assertEqual(costs["rows"][0], ["Item", "Price"])
        self.assertEqual(costs["rows"][1], ["Wall panels", 1200, "=B2*2", "2026-01-01"])
        self.assertEqual(costs["rows"][2], [None, 2.5, "=B3*2", True, "=XLOOKUP(1,B2:B3,Notes!A1:A2)"])
        self.assertEqual(costs["formats"]["A1"], {"bold": True})
        self.assertEqual(costs["formats"]["B2"], {"num": '#,##0 "Ft"'})
        self.assertEqual(costs["freeze"], {"rows": 1, "cols": 0})
        self.assertEqual(costs["cols"], {"A": 180})
        self.assertEqual(notes["rows"], [["hello"]])
        aid = store.publish(path=str(d / "budget_2026.xlsx"), title="B", type="sheet")["id"]
        self.assertEqual(store.list_files(aid), ["sheet.json"])
        self.assertEqual(sheets.read(aid, "Notes")["rows"], [["hello"]])

    def test_csv_with_semicolons(self):
        d = Path(tempfile.mkdtemp())
        (d / "arak.csv").write_bytes("﻿Tétel;Ár;Dátum;Kész\nPanel;1 200,50;2026.03.01.;IGAZ\n\"Ajtó; fa\";900;;\n"
                                     .encode("utf-8"))
        spec = xlsx_in.to_sheet_json(d / "arak.csv")
        rows = spec["sheets"][0]["rows"]
        self.assertEqual(rows[0], ["Tétel", "Ár", "Dátum", "Kész"])
        self.assertEqual(rows[1], ["Panel", 1200.5, "2026-03-01", True])
        self.assertEqual(rows[2], ["Ajtó; fa", 900])
        (d / "cp.csv").write_bytes("Név,Összeg\nÉva,12\n".encode("cp1250"))
        self.assertEqual(xlsx_in.to_sheet_json(d / "cp.csv")["sheets"][0]["rows"][1], ["Éva", 12])
        aid = store.publish(path=str(d / "arak.csv"), title="Árak", type="sheet")["id"]
        self.assertEqual(sheets.read(aid)["rows"][1][1], 1200.5)
        with self.assertRaises(ValueError):
            xlsx_in.to_sheet_json(d / "x.pdf")


if __name__ == "__main__":
    unittest.main()
