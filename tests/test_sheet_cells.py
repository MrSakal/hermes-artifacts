"""Dropdown and checkbox cells of a sheet: the format keys, how they are stored, what carries them, xlsx both ways."""

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

STATUS = ["To do", "In progress", "Done"]
BOOK = {"title": "Tasks", "sheets": [{
    "name": "Tasks", "freeze": {"rows": 1},
    "rows": [["Task", "Status", "Done"], ["Plan", "Done", True], ["Build", "In progress", False], ["Ship", "To do", None]],
    "formats": {"A1:C1": {"bold": True}, "B2:B4": {"options": STATUS}, "C2:C4": {"check": True}}}]}


def pub(book=None):
    return store.publish(title="Tasks", type="sheet", files={"sheet.json": book or BOOK})["id"]


def sheet(aid):
    return sheets.load(aid)["sheets"][0]


def page(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


class CellFormatTests(unittest.TestCase):
    def test_stored_once_and_read_by_the_page(self):
        aid = pub()
        sh = sheet(aid)
        self.assertEqual(sh["lists"], {"1": STATUS})  # the options once, the cells name them
        self.assertEqual(sh["fmt"]["B3"], {"opt": "1"})
        self.assertEqual(sh["fmt"]["C2"], {"check": True})
        self.assertEqual(sh["cells"]["C2"], True)  # a checkbox's value is the boolean
        self.assertNotIn("C4", sh["cells"])  # nothing is written into a blank
        r = page(aid, "sheet.read")
        self.assertEqual((r["lists"], r["fmt"]["B2"]), ({"1": STATUS}, {"opt": "1"}))
        self.assertNotIn("lists", sheets.read(pub({"sheets": [{"name": "S", "rows": [[1]]}]})))
        self.assertNotIn("lists", sheet(pub({"sheets": [{"name": "S", "rows": [[1]]}]})))

    def test_format_op(self):
        aid = pub()
        sheets.apply(aid, [{"op": "format", "range": "A2:A4", "options": ["High", "Low", "Low", 3]},
                           {"op": "format", "range": "D2:D3", "check": True}], by="hermes")
        sh = sheet(aid)
        self.assertEqual(sh["lists"], {"1": STATUS, "2": ["High", "Low", "3"]})
        self.assertEqual((sh["fmt"]["A4"], sh["fmt"]["D3"]), ({"opt": "2"}, {"check": True}))
        sheets.apply(aid, [{"op": "format", "range": "E2:E3", "options": STATUS}], by="hermes")  # the same list again
        self.assertEqual((len(sheet(aid)["lists"]), sheet(aid)["fmt"]["E2"]), (2, {"opt": "1"}))
        sheets.apply(aid, [{"op": "format", "range": "A2:A4", "options": None}, {"op": "format", "range": "D2", "check": False},
                           {"op": "format", "range": "D3", "check": None}], by="hermes")
        sh = sheet(aid)
        self.assertFalse([k for k in sh["fmt"] if k[0] in "AD" and k != "A1"])
        self.assertEqual(sh["fmt"]["A1"], {"bold": True})
        for bad in ({"options": []}, {"options": "Done"}, {"options": ["x" * 61]}, {"options": [""]}, {"options": [True]},
                    {"options": [str(i) for i in range(51)]}, {"check": "yes"}, {"opt": "1"}):
            with self.assertRaises(sheets.SheetError, msg=bad):
                sheets.apply(aid, [{"op": "format", "range": "A2", **bad}], by="hermes")
        with self.assertRaises(ValueError):
            pub({"sheets": [{"name": "S", "rows": [[1]], "formats": {"A1": {"options": [1, []]}}}]})

    def test_structural_ops_and_sort_carry_them(self):
        aid = pub()
        sheets.apply(aid, [{"op": "insert_rows", "at": 3, "n": 2}], by="user")  # inside the runs: the new rows are that too
        sh = sheet(aid)
        self.assertEqual([sh["fmt"].get(f"B{r}") for r in range(2, 7)], [{"opt": "1"}] * 5)
        self.assertEqual([sh["fmt"].get(f"C{r}") for r in range(2, 7)], [{"check": True}] * 5)
        self.assertNotIn("A3", sh["fmt"])
        sheets.apply(aid, [{"op": "delete_rows", "at": 3, "n": 2}, {"op": "insert_cols", "at": "A", "n": 1}], by="user")
        sh = sheet(aid)
        self.assertEqual((sh["fmt"]["C4"], sh["fmt"]["D4"], sh["cells"]["C2"]), ({"opt": "1"}, {"check": True}, "Done"))
        self.assertNotIn("C5", sh["fmt"])
        sheets.apply(aid, [{"op": "format", "range": "C3", "options": None},
                           {"op": "sort", "range": "B2:D4", "col": "B"}], by="user")  # Build, Plan, Ship
        sh = sheet(aid)
        self.assertEqual([sh["cells"][f"B{r}"] for r in (2, 3, 4)], ["Build", "Plan", "Ship"])
        self.assertEqual([sh["fmt"].get(f"C{r}") for r in (2, 3, 4)], [None, {"opt": "1"}, {"opt": "1"}])  # formats go with their rows
        self.assertEqual(sh["cells"]["D3"], True)
        sheets.apply(aid, [{"op": "delete_cols", "at": "C", "n": 1}], by="user")
        self.assertEqual(sheet(aid)["fmt"]["C3"], {"check": True})

    def test_history_restore(self):
        aid = pub()
        sheets.apply(aid, [{"op": "format", "range": "B2:B4", "options": ["A", "B"]}, {"op": "format", "range": "C2:C4", "check": None}], by="user")
        self.assertEqual(sheet(aid)["fmt"]["B2"], {"opt": "2"})
        then = page(aid, "sheet.at", rev=1)
        self.assertEqual((then["fmt"]["B2"], then["lists"]["1"]), ({"opt": "1"}, STATUS))  # ids are never used again
        sheets.restore(aid, None, 1)
        sh = sheet(aid)
        self.assertEqual((sh["fmt"]["B2"], sh["fmt"]["C3"], sh["lists"]["1"]), ({"opt": "1"}, {"check": True}, STATUS))

    def test_lists_stay_bounded(self):
        aid = pub()
        for i in range(sheets.MAX_LISTS + 5):  # a dropdown's options edited over and over
            sheets.apply(aid, [{"op": "format", "range": "B2:B4", "options": ["v%d" % i]}], by="user")
        sh = sheet(aid)
        self.assertLessEqual(len(sh["lists"]), sheets.MAX_LISTS)
        self.assertEqual(sh["lists"][sh["fmt"]["B2"]["opt"]], ["v%d" % (sheets.MAX_LISTS + 4)])

    def test_agent_read_names_the_dropdowns(self):
        p = load_plugin()
        aid = pub()
        r = json.loads(p._doc_read({"id": aid}))
        self.assertEqual(r["lists"], {"B2:B4": STATUS})
        self.assertNotIn("fmt", r)
        self.assertEqual(r["rows"][1], ["Plan", "Done", True])
        self.assertNotIn("lists", json.loads(p._doc_read({"id": aid, "range": "A1:A4"})))
        self.assertNotIn("lists", json.loads(p._doc_read({"id": pub({"sheets": [{"name": "S", "rows": [[1]]}]})})))
        e = json.loads(p._doc_edit({"id": aid, "base_rev": r["rev"], "ops": [{"op": "format", "range": "D2:E4", "options": ["x", "y"]}]}))
        self.assertTrue(e["ok"], e)
        self.assertEqual(json.loads(p._doc_read({"id": aid}))["lists"], {"B2:B4": STATUS})  # D:E is past what was read
        self.assertEqual(json.loads(p._doc_read({"id": aid, "range": "A1:E4"}))["lists"], {"B2:B4": STATUS, "D2:E4": ["x", "y"]})


def _workbook(sheet_xml):
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' \
         'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    pkg = "http://schemas.openxmlformats.org/package/2006/relationships"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("_rels/.rels", f'<Relationships xmlns="{pkg}"><Relationship Id="rId1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", f'<workbook {ns}><sheets><sheet name="Tasks" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", f'<Relationships xmlns="{pkg}"><Relationship Id="rId1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", f"<worksheet {ns}>{sheet_xml}</worksheet>")
    return buf.getvalue()


HAND = ('<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Task</t></is></c><c r="B1" t="inlineStr"><is><t>Status</t></is></c></row>'
        '<row r="2"><c r="A2" t="inlineStr"><is><t>Plan</t></is></c><c r="B2" t="inlineStr"><is><t>Done</t></is></c><c r="C2" t="b"><v>1</v></c></row></sheetData>'
        '<dataValidations count="3">'
        '<dataValidation type="list" allowBlank="1" sqref="B2:B1048576 E2"><formula1>"To do, In progress,Done,""Later"""</formula1></dataValidation>'
        '<dataValidation type="list" sqref="D2"><formula1>$F$1:$F$3</formula1></dataValidation>'
        '<dataValidation type="whole" sqref="A2"><formula1>1</formula1></dataValidation></dataValidations>')


class XlsxTests(unittest.TestCase):
    def test_import_reads_inline_lists(self):
        d = Path(tempfile.mkdtemp())
        (d / "tasks.xlsx").write_bytes(_workbook(HAND))
        spec = xlsx_in.to_sheet_json(d / "tasks.xlsx")["sheets"][0]
        opts = ["To do", "In progress", "Done", '"Later"']
        self.assertEqual(spec["formats"], {"B2:B5000": {"options": opts}, "E2": {"options": opts}})  # a range or another kind: left out
        self.assertEqual(spec["rows"][1], ["Plan", "Done", True])
        aid = store.publish(path=str(d / "tasks.xlsx"), title="T", type="sheet")["id"]
        sh = sheet(aid)
        self.assertEqual((sh["lists"], sh["fmt"]["B2"], sh["fmt"]["E2"]), ({"1": opts}, {"opt": "1"}, {"opt": "1"}))
        self.assertIn("B202", sh["fmt"])  # a whole column: as far as a range format reaches
        self.assertNotIn("B203", sh["fmt"])

    @unittest.skipUnless(NODE, "node is not on PATH")
    def test_page_export_and_import(self):
        fmt = {"A1": {"bold": True}, "C2": {"check": True}, "C3": {"check": True}, "C4": {"check": True}, "E2": {"options": ["a, b", "c"]}}
        for r in (2, 3, 4, 5):
            fmt[f"B{r}"] = {"options": STATUS}
        fmt["D2"] = {"options": STATUS, "bold": True}
        w = node("write", {"sheets": [{"name": "Tasks", "fmt": fmt,
                                       "cells": {"A1": "Task", "B2": "Done", "C2": True, "C3": False, "D2": "To do", "E2": "c"}}]})
        xml = w["xml"]["xl/worksheets/sheet1.xml"]
        self.assertIn('<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" sqref="B2:B5 D2">'
                      '<formula1>&quot;To do,In progress,Done&quot;</formula1></dataValidation></dataValidations><pageMargins', xml)
        self.assertNotIn("a, b", xml)  # an option with a comma cannot be written inline: that dropdown is left out
        self.assertIn('<c r="C2" t="b"><v>1</v></c>', xml)  # a checkbox: the boolean
        self.assertIn('<c r="C3" t="b"><v>0</v></c>', xml)
        self.assertNotIn('r="C4"', xml)  # an unticked blank and an empty dropdown cell write no cell
        self.assertNotIn('r="B5"', xml)
        back = w["back"]["sheets"][0]
        self.assertEqual(back["fmt"]["B4"], {"options": STATUS})
        self.assertEqual(back["fmt"]["D2"], {"bold": True, "options": STATUS})
        self.assertEqual((back["cells"]["C2"], back["cells"]["C3"]), (True, False))
        hand = node("read", base64.b64encode(_workbook(HAND)).decode())["sheets"][0]
        opts = ["To do", "In progress", "Done", '"Later"']
        self.assertEqual((hand["fmt"]["B2"], hand["fmt"]["E2"], hand["fmt"]["B202"]), ({"options": opts},) * 3)
        self.assertNotIn("B203", hand["fmt"])
        self.assertNotIn("D2", hand["fmt"])


if __name__ == "__main__":
    unittest.main()
