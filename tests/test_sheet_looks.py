"""Conditional formats, borders, merged cells and dropdown colours of a sheet: checked, stored, moved with rows and
columns, kept by history, told to Hermes, and carried by xlsx both ways."""

import base64
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "plugin"))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, sheets, store, xlsx_in  # noqa: E402
from test_sheet_xlsx import NODE, node  # noqa: E402
from test_types import load_plugin  # noqa: E402

LATE = {"range": "C3:C6", "if": '=AND(C3<TODAY(),D3<>"Done")', "bg": "#FDE2E1", "bold": True}
SCALE = {"range": "E3:E6", "scale": ["#ffffff", "#57BB8A"]}
BOOK = {"title": "Plan", "sheets": [{
    "name": "Plan",
    "rows": [["Plan 2026", "x", "y", None, None], ["Task", "Owner", "Due", "Status", "Cost"],
             ["Dig", "Ann", "2026-01-05", "Done", 10], ["Pour", "Bob", "2026-02-01", "To do", 20],
             ["Frame", "Cy", "2026-03-01", "To do", 30], ["Roof", "Di", "2026-04-01", "To do", 40]],
    "formats": {"A2:E2": {"bold": True, "border": "bottom"},
                "D3:D6": {"options": ["To do", "Done"], "colors": ["gray", "green"]}},
    "merges": ["A1:E1"], "rules": [LATE, SCALE]}]}


def pub(book=None):
    return store.publish(title="Plan", type="sheet", files={"sheet.json": book or BOOK})["id"]


def sheet(aid):
    return sheets.load(aid)["sheets"][0]


def edit(aid, *ops, by="user", **kw):
    return sheets.apply(aid, list(ops), by=by, **kw)


def page(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


def bad(test, fn, *words):
    with test.assertRaises(sheets.SheetError) as e:
        fn()
    for w in words:
        test.assertIn(w, e.exception.message)
    return e.exception


class RuleTests(unittest.TestCase):
    def test_published_and_read(self):
        aid = pub()
        sh = sheet(aid)
        self.assertEqual(sh["rules"], [{**LATE, "bg": "#fde2e1"}, {"range": "E3:E6", "scale": ["#ffffff", "#57bb8a"]}])
        r = page(aid, "sheet.read")
        self.assertEqual((len(r["rules"]), r["merges"]), (2, ["A1:E1"]))
        plain = pub({"sheets": [{"name": "S", "rows": [[1]]}]})
        self.assertNotIn("rules", sheet(plain))
        self.assertEqual((page(plain, "sheet.read")["rules"], page(plain, "sheet.read")["merges"]), ([], []))

    def test_op_replaces_and_clears(self):
        aid = pub()
        r = edit(aid, {"op": "rules", "rules": [{"range": "B:B", "if": "=B1=\"Ann\"", "fg": "#ff0000", "strike": True, "bold": False}]},
                 by="hermes")  # no cell is written over: no base_rev needed
        self.assertEqual(sheet(aid)["rules"], [{"range": "B1:B5000", "if": '=B1="Ann"', "fg": "#ff0000", "strike": True}])
        self.assertEqual(r["changed"], [])
        d = page(aid, "sheet.read", since_rev=r["rev"] - 1)  # the open page hears of it
        self.assertEqual(len(d["rules"]), 1)
        edit(aid, {"op": "rules", "rules": []})
        self.assertNotIn("rules", sheet(aid))

    def test_validation(self):
        aid = pub()
        for rules, word in (
                ("x", "list"), ([1], "a rule is"), ([{"range": "A1", "if": "A1>1", "bg": "#ffffff"}], "formula"),
                ([{"range": "A1", "if": "=A1>1"}], "needs a format"), ([{"range": "A1", "if": "=A1>1", "bg": "red"}], "bg, fg"),
                ([{"range": "A1", "if": "=A1>1", "italic": True}], "italic"), ([{"range": "zz", "scale": ["#ffffff", "#000000"]}], "bad range"),
                ([{"range": "A1:A9", "scale": ["#ffffff"]}], "2 or 3 colours"),
                ([{"range": "A1:A9", "scale": ["#ffffff", "#000000"], "bg": "#ffffff"}], "nothing else"),
                ([{"range": "A1", "if": "=" + "1+" * 300 + "1", "bg": "#ffffff"}], "500"),
                ([{"range": "A1", "if": "=A1", "bold": True}] * 51, "at most 50")):
            bad(self, lambda: edit(aid, {"op": "rules", "rules": rules}), word)
        with self.assertRaises(ValueError):
            pub({"sheets": [{"name": "S", "rows": [[1]], "rules": [{"range": "A1"}]}]})

    def test_rows_and_columns_move_them(self):
        aid = pub()
        edit(aid, {"op": "insert_rows", "at": 2, "n": 2})
        late, scale = sheet(aid)["rules"]
        self.assertEqual((late["range"], late["if"], scale["range"]), ("C5:C8", '=AND(C5<TODAY(),D5<>"Done")', "E5:E8"))
        edit(aid, {"op": "insert_cols", "at": "A", "n": 1})
        late = sheet(aid)["rules"][0]
        self.assertEqual((late["range"], late["if"]), ("D5:D8", '=AND(D5<TODAY(),E5<>"Done")'))
        # the first rows of a rule's range deleted: the formula is written for the first one left
        edit(aid, {"op": "delete_rows", "at": 4, "n": 3})
        late, scale = sheet(aid)["rules"]
        self.assertEqual((late["range"], late["if"], scale["range"]), ("D4:D5", '=AND(D4<TODAY(),E4<>"Done")', "F4:F5"))
        edit(aid, {"op": "insert_rows", "at": 5, "n": 1})  # inside: the range grows
        self.assertEqual(sheet(aid)["rules"][0]["range"], "D4:D6")
        edit(aid, {"op": "delete_cols", "at": "D", "n": 1})  # all of a rule's range gone: so is the rule
        self.assertEqual([r["range"] for r in sheet(aid)["rules"]], ["E4:E6"])

    def test_sort_leaves_them_and_sheet_names_follow(self):
        aid = pub()
        edit(aid, {"op": "sort", "range": "A3:E6", "col": "E", "desc": True})
        self.assertEqual(sheet(aid)["rules"][0]["range"], "C3:C6")
        edit(aid, {"op": "add_sheet", "name": "Rates", "rows": [[5]]})
        edit(aid, {"op": "rules", "rules": [{"range": "E3:E6", "if": "=E3>Rates!A1", "bold": True}]})
        sheets.apply(aid, [{"op": "rename_sheet", "name": "Limits"}], by="user", sheet="Rates")
        self.assertEqual(sheet(aid)["rules"][0]["if"], "=E3>Limits!A1")
        sheets.apply(aid, [{"op": "insert_rows", "at": 1, "n": 2}], by="user", sheet="Limits")
        self.assertEqual(sheet(aid)["rules"][0]["if"], "=E3>Limits!A3")
        sheets.apply(aid, [{"op": "delete_sheet"}], by="user", sheet="Limits")
        self.assertEqual(sheet(aid)["rules"][0]["if"], "=E3>#REF!")

    def test_history_keeps_them(self):
        aid = pub()
        r0 = sheet(aid)["rev"]
        edit(aid, {"op": "rules", "rules": []}, {"op": "unmerge", "range": "A1"}, {"op": "set", "range": "B1", "values": [["b"]]})
        self.assertEqual((sheet(aid).get("rules"), sheet(aid).get("merges")), (None, None))
        then = page(aid, "sheet.at", rev=r0)
        self.assertEqual((len(then["rules"]), then["merges"]), (2, ["A1:E1"]))
        sheets.restore(aid, None, r0)
        sh = sheet(aid)
        self.assertEqual((len(sh["rules"]), sh["merges"], sh["cells"].get("B1")), (2, ["A1:E1"], None))
        edit(aid, {"op": "insert_rows", "at": 1, "n": 1})  # a later move leaves the snapshot's rules as they were
        self.assertEqual(page(aid, "sheet.at", rev=r0)["rules"][0]["range"], "C3:C6")


class MergeTests(unittest.TestCase):
    def test_merge_keeps_the_top_left_only(self):
        aid = pub()
        self.assertEqual((sheet(aid)["merges"], sheet(aid)["cells"].get("B1"), sheet(aid)["cells"]["A1"]), (["A1:E1"], None, "Plan 2026"))
        r = edit(aid, {"op": "merge", "range": "A3:B4"})
        self.assertEqual(r["changed"], ["B3", "A4", "B4"])  # the cells it emptied
        self.assertEqual(sheet(aid)["merges"], ["A1:E1", "A3:B4"])
        # Hermes empties cells that way only with the rev it read
        self.assertEqual(bad(self, lambda: edit(aid, {"op": "merge", "range": "C5:D5"}, by="hermes")).code, "missing_guard")
        edit(aid, {"op": "merge", "range": "A8:B9"}, by="hermes")  # nothing there: no guard
        edit(aid, {"op": "merge", "range": "A8:C10"})  # a merged cell inside a new one becomes part of it
        self.assertEqual(sheet(aid)["merges"], ["A1:E1", "A3:B4", "A8:C10"])
        bad(self, lambda: edit(aid, {"op": "merge", "range": "B4:C5"}), "cuts across the merged cell A3:B4")
        bad(self, lambda: edit(aid, {"op": "merge", "range": "A1"}), "two or more")
        edit(aid, {"op": "unmerge", "range": "A1:B5"})  # every merged cell the range touches
        self.assertEqual(sheet(aid)["merges"], ["A8:C10"])
        edit(aid, {"op": "unmerge", "range": "B9"})
        self.assertNotIn("merges", sheet(aid))

    def test_writes_inside_one_are_skipped_and_said(self):
        aid = pub()
        r = edit(aid, {"op": "set", "range": "A1", "values": [["Title", "lost", ""], ["T", "O"]]})
        self.assertIn("B1 not written: inside a merged cell", r["skipped"])
        sh = sheet(aid)
        self.assertEqual((sh["cells"]["A1"], sh["cells"].get("B1"), sh["cells"]["B2"]), ("Title", None, "O"))
        self.assertNotIn("skipped", edit(aid, {"op": "set", "range": "A2", "values": [["Task"]]}))

    def test_rows_and_columns_move_them(self):
        aid = pub()
        edit(aid, {"op": "merge", "range": "A8:B10"})
        edit(aid, {"op": "insert_rows", "at": 1, "n": 1}, {"op": "insert_cols", "at": "C", "n": 2})
        self.assertEqual(sheet(aid)["merges"], ["A2:G2", "A9:B11"])  # moved down; the wide one grew
        edit(aid, {"op": "delete_rows", "at": 10, "n": 1}, {"op": "delete_cols", "at": "B", "n": 1})
        self.assertEqual(sheet(aid)["merges"], ["A2:F2", "A9:A10"])
        edit(aid, {"op": "delete_rows", "at": 10, "n": 1})  # one cell left: no merged cell any more
        self.assertEqual(sheet(aid)["merges"], ["A2:F2"])
        edit(aid, {"op": "delete_rows", "at": 2, "n": 1})
        self.assertNotIn("merges", sheet(aid))

    def test_sort_is_refused_across_one(self):
        aid = pub()
        edit(aid, {"op": "merge", "range": "A8:B8"})
        bad(self, lambda: edit(aid, {"op": "sort", "range": "A3:E8", "col": "E"}), "merged cell A8:B8", "unmerge")
        edit(aid, {"op": "sort", "range": "A3:E6", "col": "E", "desc": True})  # beside it: fine
        self.assertEqual(sheet(aid)["cells"]["A3"], "Roof")


class BorderTests(unittest.TestCase):
    def bd(self, aid, *keys):
        f = sheet(aid)["fmt"]
        return [f.get(k, {}).get("bd", "") for k in keys]

    def test_presets_become_cell_edges(self):
        aid = pub()
        self.assertEqual(self.bd(aid, "A2", "E2", "A3"), ["b", "b", ""])
        self.assertEqual(sheet(aid)["fmt"]["A2"], {"bold": True, "bd": "b"})
        edit(aid, {"op": "format", "range": "A8:C10", "border": "outer"})
        self.assertEqual(self.bd(aid, "A8", "B8", "C8", "A9", "B9", "C10"), ["tl", "t", "tr", "l", "", "br"])
        edit(aid, {"op": "format", "range": "A8:C10", "border": "inner"})
        self.assertEqual(self.bd(aid, "A8", "B9", "C10"), ["tblr", "tblr", "tblr"])
        edit(aid, {"op": "format", "range": "A12:B13", "border": "all", "bold": True})
        self.assertEqual(sheet(aid)["fmt"]["B13"], {"bold": True, "bd": "tblr"})
        for kind, want in (("top", ["t", ""]), ("left", ["tl", "l"]), ("right", ["tlr", "lr"]), ("bottom", ["tlr", "blr"])):
            r = edit(aid, {"op": "format", "range": "E12:E13", "border": kind})
            self.assertEqual(self.bd(aid, "E12", "E13"), want)
        self.assertEqual(r["changed"], ["E13"])
        # the inner lines one way only (the page's presets; inner is both)
        edit(aid, {"op": "format", "range": "G12:H13", "border": "horizontal"}, {"op": "format", "range": "J12:K13", "border": "vertical"})
        self.assertEqual(self.bd(aid, "G12", "H13", "J12", "K13"), ["b", "t", "r", "l"])

    def test_none_clears_the_range_and_the_edges_facing_it(self):
        aid = pub()
        edit(aid, {"op": "format", "range": "A8:C10", "border": "all"})
        edit(aid, {"op": "format", "range": "B9", "border": "none"})
        self.assertEqual(self.bd(aid, "B9", "B8", "B10", "A9", "C9"), ["", "tlr", "blr", "tbl", "tbr"])
        edit(aid, {"op": "format", "range": "A8:C10", "border": None})
        self.assertEqual(self.bd(aid, "A8", "B9", "C10"), ["", "", ""])
        self.assertNotIn("A8", sheet(aid)["fmt"])

    def test_raw_edges_and_validation(self):
        aid = pub()
        edit(aid, {"op": "format", "range": "A8:A9", "bd": "rt"})  # as the page and a file's import write them
        self.assertEqual(self.bd(aid, "A8", "A9"), ["tr", "tr"])
        edit(aid, {"op": "format", "range": "A8", "bd": ""})
        self.assertEqual(self.bd(aid, "A8"), [""])
        bad(self, lambda: edit(aid, {"op": "format", "range": "A8", "border": "thick"}), "border is one of")
        bad(self, lambda: edit(aid, {"op": "format", "range": "A8", "bd": "x"}), "edges")

    def test_they_move_with_their_cells(self):
        aid = pub()
        edit(aid, {"op": "insert_rows", "at": 1, "n": 1})
        self.assertEqual(self.bd(aid, "A2", "A3"), ["", "b"])


class DropdownColourTests(unittest.TestCase):
    def test_colours_belong_to_the_list(self):
        aid = pub()
        sh = sheet(aid)
        self.assertEqual((sh["lists"], sh["list_colors"], sh["fmt"]["D3"]), ({"1": ["To do", "Done"]}, {"1": ["gray", "green"]}, {"opt": "1"}))
        r = page(aid, "sheet.read")
        self.assertEqual(r["list_colors"], {"1": ["gray", "green"]})
        # the same options in other colours are another list; without colours a third, with no entry
        edit(aid, {"op": "format", "range": "D5", "options": ["To do", "Done"], "colors": ["red", None]},
             {"op": "format", "range": "D6", "options": ["To do", "Done"]})
        sh = sheet(aid)
        self.assertEqual((sh["fmt"]["D5"], sh["fmt"]["D6"], sh["list_colors"]), ({"opt": "2"}, {"opt": "3"}, {"1": ["gray", "green"], "2": ["red"]}))
        edit(aid, {"op": "format", "range": "D4", "options": ["To do", "Done"], "colors": ["gray", "green"]})
        self.assertEqual(sheet(aid)["fmt"]["D4"], {"opt": "1"})

    def test_colours_alone_recolour_the_dropdowns_there(self):
        aid = pub()
        edit(aid, {"op": "format", "range": "C3:D4", "colors": ["blue", "teal"]})
        sh = sheet(aid)
        self.assertEqual((sh["fmt"]["D3"], sh["fmt"]["D5"], sh["fmt"].get("C3")), ({"opt": "2"}, {"opt": "1"}, None))
        self.assertEqual(sh["list_colors"]["2"], ["blue", "teal"])
        edit(aid, {"op": "format", "range": "D3", "colors": None})  # automatic again
        self.assertEqual((sheet(aid)["fmt"]["D3"], sheet(aid)["list_colors"].get("3")), ({"opt": "3"}, None))

    def test_validation(self):
        aid = pub()
        bad(self, lambda: edit(aid, {"op": "format", "range": "D3", "colors": ["pink"]}), "gray, red")
        bad(self, lambda: edit(aid, {"op": "format", "range": "D3", "colors": "red"}), "colors is a list")
        with self.assertRaises(ValueError):
            pub({"sheets": [{"name": "S", "rows": [[1]], "formats": {"A1": {"options": ["a"], "colors": ["mauve"]}}}]})


class AgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plugin = load_plugin()

    def call(self, name, **args):
        return json.loads(getattr(self.plugin, name)(args))

    def test_a_read_names_merges_and_rules_only_where_there_are_any(self):
        aid = pub()
        r = self.call("_doc_read", id=aid)
        self.assertEqual((r["merges"], len(r["rules"]), r["rules"][1]["scale"]), (["A1:E1"], 2, ["#ffffff", "#57bb8a"]))
        self.assertNotIn("merges", self.call("_doc_read", id=aid, range="A3:E6"))  # none in that part
        self.assertEqual(len(self.call("_doc_read", id=aid, range="A3:E6")["rules"]), 2)  # the op replaces all: all are shown
        plain = self.call("_doc_read", id=pub({"sheets": [{"name": "S", "rows": [[1]]}]}))
        self.assertFalse({"merges", "rules", "lists"} & set(plain))
        many = [{"range": f"A{i}", "if": f"=A{i}>0", "bold": True} for i in range(1, 13)]
        edit(aid, {"op": "rules", "rules": many})
        self.assertEqual(self.call("_doc_read", id=aid)["rules"], 12)  # past ten: their count
        dumped = json.loads(sheets.dump(aid))["sheets"][0]
        self.assertEqual((len(dumped["rules"]), dumped["merges"]), (12, ["A1:E1"]))
        self.assertFalse({"merges", "rules"} & set(json.loads(sheets.dump(pub({"sheets": [{"name": "S", "rows": [[1]]}]})))["sheets"][0]))

    def test_the_ops_through_the_edit_tool(self):
        aid = pub()
        rev = self.call("_doc_read", id=aid)["rev"]
        r = self.call("_doc_edit", id=aid, base_rev=rev, ops=[
            {"op": "merge", "range": "A8:C8"}, {"op": "format", "range": "A2:E6", "border": "all"},
            {"op": "rules", "rules": [{"range": "E3:E6", "if": "=E3>25", "bg": "#fde2e1"}]}])
        self.assertTrue(r.get("ok"), r)
        sh = sheet(aid)
        self.assertEqual((sh["merges"], sh["fmt"]["C4"]["bd"], len(sh["rules"])), (["A1:E1", "A8:C8"], "tblr", 1))

    def test_the_guide_stays_short(self):
        g = (ROOT / "plugin" / "hermes_artifacts" / "types" / "sheet" / "GUIDE.md").read_text(encoding="utf-8")
        for word in ('"rules"', '"merge"', "border", "colors"):
            self.assertIn(word, g)
        self.assertLess(len(g), 3720 + 620)


NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
STYLES = (f'<styleSheet {NS}><fonts count="1"><font/></fonts><fills count="1"><fill/></fills>'
          '<borders count="3"><border><left/><right/><top/><bottom/></border>'
          '<border><left style="thin"/><right style="none"/><top style="medium"><color auto="1"/></top><bottom/></border>'
          '<border><left/><right style="thin"/><top/><bottom style="double"/></border></borders>'
          '<cellXfs count="3"><xf/><xf borderId="1"/><xf borderId="2"/></cellXfs>'
          '<dxfs count="3"><dxf><font><b/><strike val="0"/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>'
          '<dxf><font><color theme="1"/></font></dxf><dxf><font><strike/></font></dxf></dxfs></styleSheet>')
HAND = ('<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Title</t></is></c></row>'
        '<row r="3"><c r="A3" s="1"><v>5</v></c><c r="B3" s="2"/><c r="C3"><v>7</v></c></row></sheetData>'
        '<mergeCells count="3"><mergeCell ref="A1:C1"/><mergeCell ref="E5"/><mergeCell ref="A9:B10"/></mergeCells>'
        '<conditionalFormatting sqref="A3:A9 C4:C9"><cfRule type="expression" dxfId="0" priority="2"><formula>AND(A3&gt;4,$B3&lt;&gt;"x")</formula></cfRule>'
        '<cfRule type="cellIs" dxfId="0" priority="5" operator="greaterThan"><formula>3</formula></cfRule>'
        '<cfRule type="expression" dxfId="1" priority="6"><formula>A3&gt;1</formula></cfRule></conditionalFormatting>'
        '<conditionalFormatting sqref="C3:C9"><cfRule type="colorScale" priority="1"><colorScale><cfvo type="min"/><cfvo type="percentile" val="50"/>'
        '<cfvo type="max"/><color rgb="FFF8696B"/><color rgb="FFFFEB84"/><color rgb="FF63BE7B"/></colorScale></cfRule>'
        '<cfRule type="dataBar" priority="3"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar></cfRule></conditionalFormatting>'
        '<conditionalFormatting sqref="B3:B9"><cfRule type="expression" dxfId="2" priority="4"><formula>B3=""</formula></cfRule></conditionalFormatting>')
WANT_RULES = [{"range": "B3:B9", "if": '=B3=""', "strike": True},
              {"range": "A3:A9", "if": '=AND(A3>4,$B3<>"x")', "bold": True, "fg": "#9c0006", "bg": "#ffc7ce"},
              {"range": "C4:C9", "if": '=AND(C4>4,$B4<>"x")', "bold": True, "fg": "#9c0006", "bg": "#ffc7ce"},
              {"range": "C3:C9", "scale": ["#f8696b", "#ffeb84", "#63be7b"]}]


def _workbook(sheet_xml, styles=STYLES):
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    pkg = "http://schemas.openxmlformats.org/package/2006/relationships"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("_rels/.rels", f'<Relationships xmlns="{pkg}"><Relationship Id="rId1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", f'<workbook {NS}><sheets><sheet name="Plan" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", f'<Relationships xmlns="{pkg}"><Relationship Id="rId1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/>'
                                                 f'<Relationship Id="rId2" Type="{rel}/styles" Target="styles.xml"/></Relationships>')
        z.writestr("xl/styles.xml", styles)
        z.writestr("xl/worksheets/sheet1.xml", f"<worksheet {NS}>{sheet_xml}</worksheet>")
    return buf.getvalue()


class XlsxTests(unittest.TestCase):
    def test_python_import(self):
        d = Path(tempfile.mkdtemp())
        (d / "plan.xlsx").write_bytes(_workbook(HAND))
        spec = xlsx_in.to_sheet_json(d / "plan.xlsx")["sheets"][0]
        self.assertEqual(spec["merges"], ["A1:C1", "A9:B10"])  # a one-cell "merge" is none
        self.assertEqual(spec["formats"], {"A3": {"bd": "tl"}, "B3": {"bd": "br"}})  # any line style: a thin edge; also on an empty cell
        # the kinds we do not model and a look with nothing we keep are left out; the file's first priority comes last (it wins)
        self.assertEqual(spec["rules"], WANT_RULES)
        aid = store.publish(path=str(d / "plan.xlsx"), title="P", type="sheet")["id"]
        sh = sheet(aid)
        self.assertEqual((sh["merges"], sh["fmt"]["B3"], len(sh["rules"])), (["A1:C1", "A9:B10"], {"bd": "br"}, 4))
        (d / "bare.xlsx").write_bytes(_workbook("<sheetData><row r=\"1\"><c r=\"A1\"><v>1</v></c></row></sheetData>"))
        self.assertFalse({"merges", "rules", "formats"} & set(xlsx_in.to_sheet_json(d / "bare.xlsx")["sheets"][0]))

    @unittest.skipUnless(NODE, "node is not on PATH")
    def test_page_export_and_import(self):
        rules = [{"range": "C3:C6", "if": '=AND(C3<TODAY(),IFS(D3="x",TRUE,TRUE,FALSE))', "bg": "#fde2e1", "bold": True},
                 {"range": "C3:C6", "if": "=C3>1", "bg": "#fde2e1", "bold": True},
                 {"range": "E3:E6", "scale": ["#ffffff", "#57bb8a"]}, {"range": "F3:F6", "scale": ["#f8696b", "#ffeb84", "#63be7b"]},
                 {"range": "A3:E6", "if": '=$D3="Done"', "fg": "#999999", "strike": True}, {"range": "zz", "if": "=1", "bold": True}]
        w = node("write", {"sheets": [{"name": "Plan", "cells": {"A1": "Plan", "A2": "Task", "E3": 10, "E4": 20},
                                       "fmt": {"A2": {"bold": True, "bd": "b"}, "B2": {"bd": "b"}, "C9": {"bd": "tblr"}, "D9": {"bd": ""}},
                                       "merges": ["A1:E1", "B8:C9", "D4", "nope"], "rules": rules}, {"name": "Bare", "cells": {"A1": 1}}]})
        xml, styles = w["xml"]["xl/worksheets/sheet1.xml"], w["xml"]["xl/styles.xml"]
        self.assertIn('</sheetData><mergeCells count="2"><mergeCell ref="A1:E1"/><mergeCell ref="B8:C9"/></mergeCells><conditionalFormatting', xml)
        # the last rule wins in the page: it is the file's priority 1; a function Excel 2007 lacks is prefixed
        self.assertIn('<conditionalFormatting sqref="C3:C6"><cfRule type="expression" dxfId="0" priority="6">'
                      '<formula>AND(C3&lt;TODAY(),_xlfn.IFS(D3=&quot;x&quot;,TRUE,TRUE,FALSE))</formula></cfRule></conditionalFormatting>', xml)
        self.assertIn('<cfRule type="colorScale" priority="4"><colorScale><cfvo type="min"/><cfvo type="max"/>'
                      '<color rgb="FFFFFFFF"/><color rgb="FF57BB8A"/></colorScale></cfRule>', xml)
        self.assertIn('<cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/><color rgb="FFF8696B"/>', xml)
        self.assertIn('<cfRule type="expression" dxfId="1" priority="2"><formula>$D3=&quot;Done&quot;</formula>', xml)
        self.assertIn('</conditionalFormatting><pageMargins', xml)
        self.assertIn('<dxfs count="2"><dxf><font><b/></font><fill><patternFill><bgColor rgb="FFFDE2E1"/></patternFill></fill></dxf>'
                      '<dxf><font><strike/><color rgb="FF999999"/></font></dxf></dxfs>', styles)  # one look, written once
        self.assertIn('<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>'
                      '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>', styles)
        self.assertIn('<c r="B2" s="2"/>', xml)  # a border alone writes the (empty) cell
        self.assertNotIn('r="D9"', xml)
        self.assertRegex(styles, r'<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>')
        bare = w["xml"]["xl/worksheets/sheet2.xml"]
        self.assertNotIn("mergeCells", bare)
        self.assertNotIn("conditionalFormatting", bare)
        back = w["back"]["sheets"][0]
        self.assertEqual(back["merges"], ["A1:E1", "B8:C9"])
        self.assertEqual(back["rules"], rules[:5])
        self.assertEqual((back["fmt"]["A2"], back["fmt"]["B2"], back["fmt"]["C9"]), ({"bold": True, "bd": "b"}, {"bd": "b"}, {"bd": "tblr"}))
        self.assertEqual((w["back"]["sheets"][1]["merges"], w["back"]["sheets"][1]["rules"]), ([], []))
        # what the page wrote, the server's importer reads the same
        d = Path(tempfile.mkdtemp())
        (d / "plan.xlsx").write_bytes(base64.b64decode(w["b64"]))
        spec = xlsx_in.to_sheet_json(d / "plan.xlsx")["sheets"][0]
        self.assertEqual((spec["merges"], spec["rules"]), (["A1:E1", "B8:C9"], rules[:5]))
        self.assertEqual((spec["formats"]["A2"], spec["formats"]["C9"]), ({"bold": True, "bd": "b"}, {"bd": "tblr"}))
        # and a file made by hand, the page reads as the server does
        hand = node("read", base64.b64encode(_workbook(HAND)).decode())["sheets"][0]
        self.assertEqual((hand["merges"], hand["rules"]), (["A1:C1", "A9:B10"], WANT_RULES))
        self.assertEqual((hand["fmt"]["A3"], hand["fmt"]["B3"]), ({"bd": "tl"}, {"bd": "br"}))


EVAL = r"""
const F = require(process.argv[1]);
const cells = { A1: '2020-01-05', A2: '2999-01-05', A3: 5, A4: 'Done', B1: '=A3*2', B2: '=B3+1', B3: '=B2+1' };
for (let i = 1; i <= 3000; i++) cells['D' + i] = i === 1 ? 1 : '=D' + (i - 1) + '+1';   // a chain deeper than the stack takes
const wb = F.workbook((n, k) => cells[k], () => ['S'], () => ({ rows: 3000, cols: 5 }), { locale: 'en' });
const asked = ['=A1<TODAY()', '=A2<TODAY()', '=AND(A5<>"",A5<TODAY())', '=A5=""', '=A4<>""', '=ISNUMBER(SEARCH("on",A4))', '=AND(A3>=1,A3<=5)',
  '=B1=10', '=A4="done"', '=NOSUCH(A1)', '=B2>0', '=D3000=3000', '=1/0', '=A3>'];
const out = asked.map((f) => wb.evalAt('S', 'C1', f));
out.push(wb.evalAt('Nope', 'C1', '=1'), wb.value('S', 'B1'), wb.evalAt('S', 'C1', F.shiftRefs('=AND(A1<TODAY(),$A4="Done")', 1, 0)));
process.stdout.write(JSON.stringify(out));
"""


class EngineTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "node is not on PATH")
    def test_a_rule_formula_is_computed_as_if_in_the_cell(self):
        import subprocess
        formula = ROOT / "plugin" / "hermes_artifacts" / "types" / "sheet" / "formula.js"
        r = subprocess.run([NODE, "-e", EVAL, str(formula)], capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        e = lambda c: {"error": c}  # noqa: E731
        self.assertEqual(json.loads(r.stdout), [
            True, False, False, True, True, True, True, True, True, e("#NAME?"), e("#CYCLE!"), True, e("#DIV/0!"), e("#NAME?"),
            e("#REF!"), 10, False])  # the last: shifted a row down, A2 is not before today


if __name__ == "__main__":
    unittest.main()
