"""Formula values computed on the server (calc.py running types/sheet/formula.js under node) when no
page is open: what Hermes reads after its own edit."""

import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "plugin"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import calc, sheets, store  # noqa: E402

NODE = shutil.which("node")

BOOK = {"title": "Budget", "sheets": [
    {"name": "Costs",
     "rows": [["Item", "Unit price", "Qty", "Total"],
              ["Wall panels", 1200, 3, "=B2*C2"],
              ["Doors", 500, 2, "=B3*C3"],
              ["Total", None, None, "=SUM(D2:D3)"],
              ["Bad", "=1/0", "=NOPE(1)", "=D2&\" Ft\""],
              ["Half", "=C2/2", "=B2>1000", "=Missing!A1"]]},
    {"name": "My plan", "rows": [["Ref", "=Costs!D4+'Costs'!B3"], ["Twice", "=B1*2"]]}]}


def pub(book=None):
    return store.publish(title="Budget", type="sheet", files={"sheet.json": book or BOOK})["id"]


def disk(aid):
    return json.loads(sheets._state_path(aid).read_text(encoding="utf-8"))


@unittest.skipUnless(NODE, "node is not on PATH")
class CalcTests(unittest.TestCase):
    def setUp(self):
        calc._failed.clear()
        self.aid = pub()

    def test_fresh_values_after_an_agent_edit_with_no_page(self):
        r = sheets.read(self.aid, agent=True)
        self.assertFalse(r["stale"])
        self.assertEqual(r["values"]["D2"], 3600)
        self.assertEqual(r["values"]["D4"], 4600)
        time.sleep(0.01)
        sheets.apply(self.aid, [{"op": "set", "range": "C2", "values": [[4]]}], by="hermes", base_rev=r["rev"])
        self.assertTrue(sheets.read(self.aid)["stale"])  # the page's read computes nothing
        self.assertEqual(sheets.read(self.aid)["values"]["D2"], 3600)
        r2 = sheets.read(self.aid, agent=True)
        self.assertFalse(r2["stale"])
        self.assertEqual((r2["values"]["D2"], r2["values"]["D4"]), (4800, 5800))
        self.assertEqual(r2["rev"], r["rev"] + 1)  # values are not edits
        with mock.patch.dict(calc._node, {"path": None, "at": time.monotonic()}):
            self.assertEqual(set(r2), set(sheets.read(pub(), agent=True)))  # the keys of a read that computed nothing
        self.assertEqual(disk(self.aid)["sheets"][0]["vals"]["D4"], 5800)  # kept: the next read is free
        with mock.patch.object(calc, "run", side_effect=AssertionError("computed twice")):
            self.assertEqual(sheets.read(self.aid, agent=True)["values"]["D4"], 5800)
            self.assertFalse(sheets.read(self.aid)["stale"])

    def test_cross_sheet(self):
        r = sheets.read(self.aid, "My plan", agent=True)
        self.assertEqual(r["values"], {"B1": 5100, "B2": 10200})
        time.sleep(0.01)
        costs = sheets.read(self.aid, "Costs", agent=True)
        sheets.apply(self.aid, [{"op": "set", "range": "B3", "values": [[600]]}], by="hermes", sheet="Costs",
                     base_rev=costs["rev"])
        r = sheets.read(self.aid, "My plan", agent=True)  # the other sheet changed: this one follows
        self.assertEqual(r["values"], {"B1": 5400, "B2": 10800})
        self.assertFalse(r["stale"])
        self.assertFalse(sheets.read(self.aid, "Costs")["stale"])  # the whole workbook was computed at once

    def test_error_values(self):
        v = sheets.read(self.aid, agent=True)["values"]
        self.assertEqual(v["B5"], {"error": "#DIV/0!"})
        self.assertEqual(v["C5"], {"error": "#NAME?"})
        self.assertEqual(v["D6"], {"error": "#REF!"})
        self.assertEqual((v["D5"], v["B6"], v["C6"]), ("3600 Ft", 1.5, True))
        self.assertIsInstance(v["D2"], int)

    def test_search_and_since_rev_see_computed_values(self):
        r = sheets.read(self.aid, agent=True)
        time.sleep(0.01)
        sheets.apply(self.aid, [{"op": "set", "range": "B2", "values": [[1234]]}], by="hermes", base_rev=r["rev"])
        d = sheets.read(self.aid, since_rev=r["rev"], agent=True)
        self.assertEqual(d["changed"], {"B2": 1234})
        self.assertFalse(d["stale"])
        time.sleep(0.01)
        sheets.apply(self.aid, [{"op": "set", "range": "B2", "values": [[1111]]}], by="hermes", base_rev=d["rev"])
        found = sheets.read(self.aid, search="3333", agent=True)["found"]  # 1111 * 3, only as a computed value
        self.assertEqual(found, [{"cell": "D2", "value": "=B2*C2"}, {"cell": "D5", "value": "=D2&\" Ft\""}])

    def test_dump_shows_computed_values(self):
        time.sleep(0.01)
        sheets.apply(self.aid, [{"op": "set", "range": "C2", "values": [[10]]}], by="hermes", base_rev=1)
        one = json.loads(sheets.dump(self.aid))["sheets"][0]
        self.assertEqual(one["values"]["D2"], 12000)

    def test_same_shape_as_the_page_posts(self):
        """What the page would post through set_vals, stored by set_vals, equals what the server stores."""
        sheets.read(self.aid, agent=True)
        server = [dict(s["vals"]) for s in disk(self.aid)["sheets"]]
        other = pub()
        st = sheets.load(other)
        raw = calc.run([{"name": s["name"], "cells": s["cells"], "charts": []} for s in st["sheets"]])
        for s, vals in zip(st["sheets"], raw):
            self.assertTrue(sheets.set_vals(other, s["id"], s["rev"], vals)["ok"])
        page = [dict(s["vals"]) for s in disk(other)["sheets"]]
        self.assertEqual(server, page)
        self.assertEqual([[type(v) for _, v in sorted(a.items())] for a in server],
                         [[type(v) for _, v in sorted(a.items())] for a in page])
        cells = disk(self.aid)["sheets"][0]["cells"]
        self.assertEqual(set(server[0]), {k for k, v in cells.items() if sheets._is_formula(v)})
        self.assertGreater(disk(self.aid)["sheets"][0]["vals_at"], disk(self.aid)["hermes_at"])

    def test_page_extent_reaches_past_a_chart(self):
        book = {"sheets": [{"name": "S", "rows": [[1, "=ROWS(A:A)"], [2]],
                            "charts": [{"type": "bar", "range": "A1:A2", "at": "D5"}]}]}
        self.assertEqual(sheets.read(pub(book), agent=True)["values"]["B1"], 15)  # row 5 + 10, as sheet.js used()

    def test_falls_back_when_node_is_missing(self):
        with mock.patch.dict(calc._node, {"path": None, "at": time.monotonic()}):
            self.assertIsNone(calc.node_path())
            r = sheets.read(self.aid, agent=True)
            self.assertTrue(r["stale"])
            self.assertEqual(r["values"], {})
            self.assertNotIn("values", json.loads(sheets.dump(self.aid))["sheets"][0])
        r = sheets.read(self.aid, agent=True)  # node is back: a missing node is not held against the workbook
        self.assertFalse(r["stale"])
        self.assertEqual(r["values"]["D2"], 3600)

    def test_timeout_falls_back(self):
        fd, path = tempfile.mkstemp(suffix=".js")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("setInterval(function () {}, 1000);\n")
        try:
            with mock.patch.object(calc, "RUNNER", Path(path)), mock.patch.object(calc, "TIMEOUT", 0.5):
                t = time.time()
                r = sheets.read(self.aid, agent=True)
                took = time.time() - t
                self.assertTrue(r["stale"])
                self.assertEqual(r["values"], {})
                self.assertLess(took, 4)
                t = time.time()
                self.assertTrue(sheets.read(self.aid, agent=True)["stale"])  # the same state is not tried again
                self.assertLess(time.time() - t, 0.4)
        finally:
            os.unlink(path)
        time.sleep(0.01)
        sheets.apply(self.aid, [{"op": "set", "range": "C2", "values": [[5]]}], by="hermes", base_rev=1)
        self.assertEqual(sheets.read(self.aid, agent=True)["values"]["D2"], 6000)  # a new state is

    def test_bad_output_falls_back(self):
        fd, path = tempfile.mkstemp(suffix=".js")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("process.stdin.resume(); process.stdin.on('end', function () { process.stdout.write('{\"sheets\": [1'); });\n")
        try:
            with mock.patch.object(calc, "RUNNER", Path(path)):
                self.assertTrue(sheets.read(self.aid, agent=True)["stale"])
        finally:
            os.unlink(path)
        with mock.patch.object(calc, "MAX_OUT", 10):  # more output than accepted: the runner writes none
            calc._failed.clear()
            self.assertTrue(sheets.read(self.aid, agent=True)["stale"])

    def test_big_sheet_cold(self):
        """5000 rows x 10 columns, 5000 formulas (one per row, plus a total over them all)."""
        rows = [[r * 10 + c for c in range(9)] + [f"=SUM(A{r + 1}:I{r + 1})*2+IF(A{r + 1}>100,1,0)"] for r in range(4999)]
        rows.append(["=SUM(J1:J4999)"])
        aid = pub({"sheets": [{"name": "Big", "rows": rows}]})
        sheets.load(aid)
        t = time.time()
        r = sheets.read(aid, range="J1:J3", agent=True)
        took = time.time() - t
        self.assertFalse(r["stale"])
        self.assertEqual(r["values"], {"J1": 72, "J2": 252, "J3": 432})
        want = sum(sum(r * 10 + c for c in range(9)) * 2 + (1 if r * 10 > 100 else 0) for r in range(4999))
        self.assertEqual(sheets.load(aid)["sheets"][0]["vals"]["A5000"], want)
        t = time.time()
        raw = calc.run([{"name": "Big", "cells": sheets.load(aid)["sheets"][0]["cells"], "charts": []}])
        only = time.time() - t
        self.assertEqual(len(raw[0]), 5000)
        print(f"\n[calc] 5000 x 10 cells, 5000 formulas, cold: read {took * 1000:.0f} ms (node process alone {only * 1000:.0f} ms)",
              file=sys.stderr)
        self.assertLess(took, calc.TIMEOUT + 2)


class NoNodeTests(unittest.TestCase):
    def test_nothing_raises_without_node(self):
        aid = pub()
        with mock.patch.dict(calc._node, {"path": None, "at": time.monotonic()}):
            self.assertIsNone(calc.run([{"name": "S", "cells": {"A1": "=1+1"}, "charts": []}]))
            r = sheets.read(aid, agent=True)
            self.assertTrue(r["stale"])
            self.assertEqual(r["rows"][1], ["Wall panels", 1200, 3, "=B2*C2"])

    def test_merge_is_the_set_vals_check(self):
        cur = {"A1": 1, "A2": 2}
        calc.merge(cur, {"A1": None, "A3": {"error": "#DIV/0!" + "x" * 40}, "A4": 2.0, "A5": "x" * 5000, "zz": 1,
                         "A6": {"nope": 1}, 7: 1, "A8": True}, sheets._value, sheets.parse_key, 100)
        self.assertEqual(cur, {"A2": 2, "A3": {"error": ("#DIV/0!" + "x" * 40)[:20]}, "A4": 2, "A8": True})
        self.assertIsInstance(cur["A4"], int)


if __name__ == "__main__":
    unittest.main()
