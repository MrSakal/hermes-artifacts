"""The sheet page's xlsx and CSV reader/writer (types/sheet/xlsx.js), run under node."""

import base64
import datetime
import io
import json
import shutil
import subprocess
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
XLSX_JS = ROOT / "plugin" / "hermes_artifacts" / "types" / "sheet" / "xlsx.js"
FFLATE = ROOT / "plugin" / "hermes_artifacts" / "types" / "vendor" / "fflate.umd.js"
NODE = shutil.which("node")
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# stdin: {"mode", "arg"}; stdout: JSON
SCRIPT = r"""
const X = require(process.argv[1]), F = require(process.argv[2]);
const inp = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const b64 = (u) => Buffer.from(u).toString('base64');
let out;
if (inp.mode === 'write') {
  const bytes = X.write(inp.arg);
  const z = F.unzipSync(bytes), xml = {};
  for (const k of Object.keys(z)) xml[k] = F.strFromU8(z[k]);
  out = {parts: Object.keys(z), xml, back: X.read(bytes), b64: b64(bytes)};
} else if (inp.mode === 'read') {
  out = X.read(new Uint8Array(Buffer.from(inp.arg, 'base64')));
} else if (inp.mode === 'csv') {
  out = {comma: X.toCsv(inp.arg.sheet, inp.arg.sheet.vals, ','), semi: X.toCsv(inp.arg.sheet, null, ';'),
         parsed: inp.arg.texts.map((t) => X.fromCsv(t).cells)};
} else if (inp.mode === 'shift') {
  out = inp.arg.map((a) => X.shiftFormula(a[0], a[1], a[2]));
} else if (inp.mode === 'bad') {
  out = inp.arg.map((s) => { try { X.read(new Uint8Array(Buffer.from(s, 'base64'))); return null; } catch (e) { return e.message; } });
}
process.stdout.write(JSON.stringify(out));
"""


def node(mode, arg):
    r = subprocess.run([NODE, "-e", SCRIPT, str(XLSX_JS), str(FFLATE)], input=json.dumps({"mode": mode, "arg": arg}),
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    if r.returncode:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


def serial(y, m, d, h=0, mi=0):
    return (datetime.date(y, m, d) - datetime.date(1899, 12, 30)).days + (h * 60 + mi) / 1440


SHEET1 = {
    "name": 'Costs & <Q1> "draft"',
    "cells": {
        "A1": "Item", "B1": "Price", "C1": "Qty", "D1": "Total",
        "A2": 'Wall <panels> & "co"', "B2": 1200.5, "C2": 3, "D2": "=B2*C2",
        "A3": "  leading space", "B3": True, "C3": False, "D3": '=IF(B3,"yes","no")',
        "A4": "2026-03-15", "B4": "2026-03-15T08:30", "C4": "1900-02-28", "D4": "=1/0",
        "A5": "line1\nline2", "B5": 0.25, "C5": "=SUM(B2:C2)", "D5": "=B4>0",
        "A6": "bad\u0001char", "B6": -1.5e-7, "C6": '=TEXTJOIN(",";TRUE;A1:B1)', "D6": "#N/A",
        "A7": "2026-12-24", "B7": "00123", "C7": "1900-03-01",
        "B8": 1234567, "C8": "ünïcödé ✓ 😀",
    },
    "fmt": {
        "A1": {"bold": True}, "B1": {"italic": True, "underline": True},
        "D1": {"align": "center", "bg": "#ffeeaa", "fg": "#aa0000"},
        "B2": {"num": "#,##0.00"}, "A5": {"wrap": True}, "B5": {"num": "0%"}, "A7": {"num": "dd/mm/yyyy"},
        "B7": {"num": "@", "align": "right"}, "B8": {"num": '#,##0 "Ft"'}, "E1": {"bold": True},
    },
    "vals": {"D2": 3601.5, "D3": "yes", "D4": {"error": "#DIV/0!"}, "D5": True},
    "cols": {"A": 180, "C": 64},
    "freeze": {"rows": 1, "cols": 1},
}
BOOK = {"sheets": [
    SHEET1,
    {"name": "A rather long sheet name that is cut", "cells": {"A1": 1, "B3": "x"}, "freeze": {"rows": 2, "cols": 0}},
    {"name": "A rather long sheet name that is cut too", "cells": {}},
]}


@unittest.skipUnless(NODE, "node is not on PATH")
class XlsxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = node("write", BOOK)

    def test_round_trip(self):
        back = self.w["back"]["sheets"]
        self.assertEqual([s["name"] for s in back], ['Costs & <Q1> "draft"', "A rather long sheet name that i",
                                                    "A rather long sheet name th (2)"])
        s = back[0]
        want = dict(SHEET1["cells"], A6="badchar", C6='=TEXTJOIN(",",TRUE,A1:B1)')
        self.assertEqual(s["cells"], want)
        self.assertEqual(s["vals"], SHEET1["vals"])
        self.assertEqual(s["fmt"], SHEET1["fmt"])
        self.assertEqual(s["cols"], {"A": 180, "C": 64})
        self.assertEqual(s["freeze"], {"rows": 1, "cols": 1})
        self.assertEqual(back[1]["cells"], {"A1": 1, "B3": "x"})
        self.assertEqual(back[1]["freeze"], {"rows": 2, "cols": 0})
        self.assertEqual(back[2]["cells"], {})

    def test_written_parts_are_wellformed_ooxml(self):
        xml = self.w["xml"]
        for p in ("[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
                  "xl/sharedStrings.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"):
            self.assertIn(p, self.w["parts"])
        trees = {p: ET.fromstring(x.encode("utf-8")) for p, x in xml.items()}  # every part parses
        # Python's zipfile opens it too, and the content types cover every part
        z = zipfile.ZipFile(io.BytesIO(base64.b64decode(self.w["b64"])))
        self.assertIsNone(z.testzip())
        ct = {o.get("PartName") for o in trees["[Content_Types].xml"]}
        for p in self.w["parts"]:
            if p.endswith(".xml") and p != "[Content_Types].xml":
                self.assertIn("/" + p, ct)

        wb = trees["xl/workbook.xml"]
        names = [s.get("name") for s in wb.iter(M + "sheet")]
        self.assertTrue(all(len(n) <= 31 for n in names))
        self.assertEqual(len({n.lower() for n in names}), 3)
        self.assertEqual(wb.find(M + "calcPr").get("fullCalcOnLoad"), "1")  # C5 has no cached value

        sh = trees["xl/worksheets/sheet1.xml"]
        cells = {c.get("r"): c for c in sh.iter(M + "c")}
        self.assertEqual(sh.find(M + "dimension").get("ref"), "A1:E8")
        self.assertEqual((cells["D2"].findtext(M + "f"), cells["D2"].findtext(M + "v")), ("B2*C2", "3601.5"))
        self.assertEqual((cells["D3"].get("t"), cells["D3"].findtext(M + "v")), ("str", "yes"))
        self.assertEqual((cells["D4"].get("t"), cells["D4"].findtext(M + "v")), ("e", "#DIV/0!"))
        self.assertEqual((cells["D5"].get("t"), cells["D5"].findtext(M + "v")), ("b", "1"))
        self.assertIsNone(cells["C5"].find(M + "v"))
        self.assertEqual(cells["C6"].findtext(M + "f"), '_xlfn.TEXTJOIN(",",TRUE,A1:B1)')
        self.assertEqual((cells["B3"].get("t"), cells["B3"].findtext(M + "v")), ("b", "1"))
        self.assertEqual(cells["D6"].get("t"), "e")
        self.assertEqual(cells["A1"].get("t"), "s")
        self.assertAlmostEqual(float(cells["A4"].findtext(M + "v")), serial(2026, 3, 15))
        self.assertAlmostEqual(float(cells["B4"].findtext(M + "v")), serial(2026, 3, 15, 8, 30))
        self.assertEqual(cells["C4"].findtext(M + "v"), "59")  # before Excel's phantom 1900-02-29
        self.assertEqual(cells["C7"].findtext(M + "v"), "61")
        self.assertIsNone(cells["E1"].find(M + "v"))
        pane = sh.find(f"{M}sheetViews/{M}sheetView/{M}pane")
        self.assertEqual((pane.get("state"), pane.get("xSplit"), pane.get("ySplit"), pane.get("topLeftCell")),
                         ("frozen", "1", "1", "B2"))
        cols = {c.get("min"): float(c.get("width")) for c in sh.iter(M + "col")}
        self.assertEqual(cols, {"1": 25.0, "3": 8.43})
        # rows and cells in order
        rows = [int(r.get("r")) for r in sh.iter(M + "row")]
        self.assertEqual(rows, sorted(rows))

        st = trees["xl/styles.xml"]
        xfs = st.find(M + "cellXfs")
        self.assertEqual(int(xfs.get("count")), len(xfs))
        ids = {int(x.get("numFmtId")) for x in xfs}
        self.assertTrue({4, 9, 49} <= ids)
        custom = {int(n.get("numFmtId")): n.get("formatCode") for n in st.iter(M + "numFmt")}
        self.assertIn('#,##0 "Ft"', custom.values())
        self.assertIn("yyyy-mm-dd", custom.values())
        self.assertTrue(all(i >= 164 for i in custom))
        self.assertEqual(st.find(M + "fills")[1][0].get("patternType"), "gray125")
        self.assertIn('rgb="FFFFEEAA"', xml["xl/styles.xml"])
        sst = trees["xl/sharedStrings.xml"]
        self.assertEqual(int(sst.get("uniqueCount")), len(sst))
        self.assertIn('<t xml:space="preserve">  leading space</t>', xml["xl/sharedStrings.xml"])
        self.assertIn("Wall &lt;panels&gt; &amp; &quot;co&quot;", xml["xl/sharedStrings.xml"])

    def test_reads_a_hand_built_workbook(self):
        sst = ('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
               '<si><r><t>Hel</t></r><r><rPr><b/></rPr><t>lo</t></r><rPh><t>X</t></rPh></si>'
               '<si><t>A &amp; B_x000D_</t></si></sst>')
        styles = ('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                  '<numFmts count="1"><numFmt numFmtId="165" formatCode="[$-409]DD/MM/YYYY;@"/></numFmts>'
                  '<fonts><font><sz val="11"/></font><font><b/><color theme="1"/></font><font><i val="0"/><color rgb="FF00AA00"/></font></fonts>'
                  '<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
                  '<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill>'
                  '<fill><patternFill patternType="solid"><fgColor theme="4"/></patternFill></fill></fills>'
                  '<cellXfs><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="14" fontId="0" fillId="0"/>'
                  '<xf numFmtId="165" fontId="0" fillId="0"/><xf numFmtId="0" fontId="1" fillId="2"/>'
                  '<xf numFmtId="22" fontId="0" fillId="0"/><xf numFmtId="3" fontId="2" fillId="3"><alignment horizontal="right" wrapText="1"/></xf>'
                  '</cellXfs></styleSheet>')
        sheet1 = ('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                  '<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" state="frozen"/></sheetView></sheetViews>'
                  '<cols><col min="1" max="2" width="20" customWidth="1"/><col min="3" max="3" width="9" hidden="1"/></cols>'
                  '<sheetData>'
                  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="G1" s="3" t="inlineStr"><is><t>B</t></is></c></row>'
                  '<row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c><c r="C2"><f t="shared" ref="C2:C4" si="0">A2+$B$2*B2</f><v>5</v></c>'
                  '<c r="D2"><f t="shared" si="7"/><v>9</v></c></row>'
                  '<row r="3"><c r="A3"><v>3</v></c><c r="B3"><v>4</v></c><c r="C3"><f t="shared" si="0"/><v>11</v></c></row>'
                  '<row r="4"><c r="C4"><f t="shared" si="0"/><v>0</v></c></row>'
                  f'<row r="5"><c r="A5" s="1"><v>{serial(2026, 3, 15)}</v></c><c r="B5" s="2"><v>{serial(2026, 3, 15, 12)}</v></c>'
                  f'<c r="C5" s="4"><v>{serial(2026, 3, 15, 18)}</v></c><c r="D5" s="5"><v>1234.5</v></c></row>'
                  '<row r="6"><c r="A6" t="b"><v>1</v></c><c r="B6" t="e"><v>#DIV/0!</v></c>'
                  '<c r="C6" t="str"><f>"x"&amp;"y"</f><v>xy</v></c><c r="D6" t="inlineStr"><is><t>inl</t></is></c>'
                  '<c r="E6"><f>_xlfn.IFS(A6,1)</f><v>1</v></c><c r="F6" t="inlineStr"><is><t><![CDATA[a<b]]></t></is></c>'
                  '<c r="G6" t="e"><f>1/0</f><v>#DIV/0!</v></c></row>'
                  '<row r="7"><c t="inlineStr"><is><t>noref</t></is></c><c><v>7</v></c></row>'
                  '</sheetData></worksheet>')
        sheet2 = ('<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>'
                  '<x:row r="1"><x:c r="A1"><x:v>42</x:v></x:c></x:row></x:sheetData></x:worksheet>')
        R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
            z.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                                      f'<Relationship Id="rId1" Type="{R}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
            z.writestr("xl/workbook.xml", f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="{R}">'
                                          '<sheets><sheet name="Data &amp; more" sheetId="1" r:id="rId1"/>'
                                          '<sheet name="Second" sheetId="2" r:id="rId2"/></sheets></workbook>')
            z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                       f'<Relationship Id="rId1" Type="{R}/worksheet" Target="worksheets/sheet1.xml"/>'
                       f'<Relationship Id="rId2" Type="{R}/worksheet" Target="/xl/worksheets/sheet2.xml"/>'
                       f'<Relationship Id="rId3" Type="{R}/sharedStrings" Target="sharedStrings.xml"/>'
                       f'<Relationship Id="rId4" Type="{R}/styles" Target="styles.xml"/></Relationships>')
            z.writestr("xl/sharedStrings.xml", sst)
            z.writestr("xl/styles.xml", styles)
            z.writestr("xl/worksheets/sheet1.xml", sheet1)
            z.writestr("xl/worksheets/sheet2.xml", sheet2)
            z.writestr("xl/media/junk.bin", b"\x00\x01")
        book = node("read", base64.b64encode(buf.getvalue()).decode())
        self.assertEqual([s["name"] for s in book["sheets"]], ["Data & more", "Second"])
        s = book["sheets"][0]
        self.assertEqual(s["cells"], {
            "A1": "Hello", "B1": "A & B\r", "G1": "B",
            "A2": 1, "B2": 2, "C2": "=A2+$B$2*B2", "D2": 9,
            "A3": 3, "B3": 4, "C3": "=A3+$B$2*B3", "C4": "=A4+$B$2*B4",
            "A5": "2026-03-15", "B5": "2026-03-15", "C5": "2026-03-15T18:00", "D5": 1234.5,
            "A6": True, "B6": "#DIV/0!", "C6": '="x"&"y"', "D6": "inl", "E6": "=IFS(A6,1)", "F6": "a<b", "G6": "=1/0",
            "A7": "noref", "B7": 7,
        })
        self.assertEqual(s["vals"], {"C2": 5, "C3": 11, "C4": 0, "C6": "xy", "E6": 1, "G6": {"error": "#DIV/0!"}})
        self.assertEqual(s["fmt"], {"G1": {"bold": True, "bg": "#ff0000"}, "B5": {"num": "dd/mm/yyyy"},
                                    "D5": {"num": "#,##0", "fg": "#00aa00", "align": "right", "wrap": True}})
        self.assertEqual(s["cols"], {"A": 145, "B": 145})
        self.assertEqual(s["freeze"], {"rows": 2, "cols": 0})
        self.assertEqual(book["sheets"][1]["cells"], {"A1": 42})

    def test_reference_shifter(self):
        got = node("shift", [["A1+$B$2*B$3+$C4", 2, 1], ["SUM(A1:B2)+'My sheet'!A1&\"A1\"", 1, 0],
                             ["SUM(A:A)+SUM(1:1)+LOG10(A1)", 1, 1], ["A1", -1, 0], ["Sheet1!B2+TRUE", 0, -1]])
        self.assertEqual(got, ["B3+$B$2*C$3+$C6", "SUM(A2:B3)+'My sheet'!A2&\"A1\"", "SUM(B:B)+SUM(2:2)+LOG10(B2)",
                               None, "Sheet1!A2+TRUE"])

    def test_not_an_xlsx_throws_one_clear_error(self):
        empty_zip = io.BytesIO()
        zipfile.ZipFile(empty_zip, "w").writestr("hello.txt", "hi")
        got = node("bad", [base64.b64encode(b"just some text").decode(), base64.b64encode(empty_zip.getvalue()).decode()])
        self.assertEqual(got, ["Not an xlsx file: it is not a zip archive", "Not an xlsx file: no workbook inside"])

    def test_csv_both_ways(self):
        sheet = {"cells": {"A1": "a,b", "B1": 'say "hi"', "C1": 1.5, "A2": "=C1*2", "B2": True, "C2": "line\nbreak",
                           "A3": "=1/0", "C3": "a;b", "B4": "=C9"},
                 "vals": {"A2": 3, "A3": {"error": "#DIV/0!"}}}
        texts = ['﻿Name;Price;Date\r\n"Smith; J";1,5;2026-01-02\r\n"multi\nline";-3;007\r\n',
                 'a,b,c\n1.25,"x,y",\n,"q ""z""",1e3\n',
                 "a\tb\n1,5\t2.5\n",
                 "solo\n12\n"]
        got = node("csv", {"sheet": sheet, "texts": texts})
        self.assertEqual(got["comma"], '"a,b","say ""hi""",1.5\r\n3,TRUE,"line\nbreak"\r\n#DIV/0!,,a;b\r\n,=C9,\r\n')
        self.assertEqual(got["semi"], 'a,b;"say ""hi""";1,5\r\n3;TRUE;"line\nbreak"\r\n#DIV/0!;;"a;b"\r\n;=C9;\r\n')
        semi, comma, tab, solo = got["parsed"]
        self.assertEqual(semi, {"A1": "Name", "B1": "Price", "C1": "Date", "A2": "Smith; J", "B2": 1.5, "C2": "2026-01-02",
                                "A3": "multi\nline", "B3": -3, "C3": "007"})
        self.assertEqual(comma, {"A1": "a", "B1": "b", "C1": "c", "A2": 1.25, "B2": "x,y", "B3": 'q "z"', "C3": 1000})
        self.assertEqual(tab, {"A1": "a", "B1": "b", "A2": 1.5, "B2": 2.5})
        self.assertEqual(solo, {"A1": "solo", "A2": 12})


if __name__ == "__main__":
    unittest.main()
