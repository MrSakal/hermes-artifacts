"""The page's check and runs reports, and artifact_check reading them."""

import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, store  # noqa: E402
from test_types import load_plugin  # noqa: E402

SPEC = {"datasets": {"a": {"title": "A", "source": {"kind": "rows", "rows": [{"x": 1}]}}}, "layout": []}


class CheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def setUp(self):
        self.aid = store.publish(title="c", type="dashboard", files={"dashboard.json": SPEC})["id"]

    def test_page_reports_through_the_api(self):
        api.handle("POST", f"artifacts/{self.aid}/op", {}, {"op": "report", "args": {"kind": "check",
                   "data": {"version": 1, "status": "failed", "page": [{"kind": "output", "what": "not_a_number"}]}}})
        api.handle("POST", f"artifacts/{self.aid}/op", {}, {"op": "report", "args": {"kind": "runs",
                   "data": {"version": 1, "datasets": {"a": {"status": "ok", "rows": 1}}}}})
        r = json.loads(self.p._check({"id": self.aid, "wait": 0}))
        self.assertEqual(r["check"]["status"], "failed")
        self.assertEqual(r["check"]["page"][0]["what"], "not_a_number")
        self.assertEqual(r["runs"]["datasets"]["a"]["rows"], 1)
        self.assertIn("Claims", r["note"])

    def test_refuses_bad_or_oversized_reports(self):
        with self.assertRaises(api.ApiError):
            api.handle("POST", f"artifacts/{self.aid}/op", {}, {"op": "report", "args": {"kind": "other", "data": {}}})
        with self.assertRaises(api.ApiError):
            api.handle("POST", f"artifacts/{self.aid}/op", {}, {"op": "report", "args": {"kind": "check", "data": {"x": "y" * 70000}}})

    def test_waits_for_the_latest_version(self):
        store.publish(aid=self.aid, base=True, files={"dashboard.json": SPEC})  # v2
        store.report_set(self.aid, "check", {"version": 1, "status": "passed"})
        r = json.loads(self.p._check({"id": self.aid, "wait": 0}))
        self.assertIsNone(r["check"])  # a stale check (v1) is not this version's

        def later():
            time.sleep(1.2)
            store.report_set(self.aid, "check", {"version": 2, "status": "passed"})
        threading.Thread(target=later).start()
        started = time.time()
        r = json.loads(self.p._check({"id": self.aid, "wait": 10}))
        self.assertEqual(r["check"]["version"], 2)
        self.assertLess(time.time() - started, 6)


if __name__ == "__main__":
    unittest.main()
