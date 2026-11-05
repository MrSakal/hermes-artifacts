"""Editing a live query from the Sources panel."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import live, store  # noqa: E402

SPEC = {"datasets": {"q": {"title": "Q", "source": {"kind": "call", "tool": "mcp_db_query", "args": {"sql": "SELECT 1"}}},
                     "f": {"title": "F", "source": {"kind": "rows", "rows": []}}}}


class EditTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(title="e", type="dashboard", files={"dashboard.json": SPEC, "index.html": "x"})["id"]

    def test_edit_keeps_tool_and_is_approved_by_the_save(self):
        d = live.dataset(self.aid, "q")
        store.set_approval(self.aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)
        r = live.edit_args(self.aid, "q", {"sql": "SELECT 2", "tool": "terminal"}, base_version=1)
        self.assertEqual(r, {"ok": True, "version": 2})
        spec = json.loads(store.read_file(self.aid, "dashboard.json").decode())
        self.assertEqual(spec["datasets"]["q"]["source"]["tool"], "mcp_db_query")  # the tool can't change
        self.assertEqual(spec["datasets"]["q"]["source"]["args"]["sql"], "SELECT 2")
        self.assertEqual(spec["datasets"]["q"]["edit"]["via"], "user")
        d2 = live.dataset(self.aid, "q")
        self.assertTrue(store.approved(self.aid, live.call_id(d2["tool"], d2["args"], d2["rules"])))  # the save is the approval

    def test_edit_with_require_approval_waits_for_a_click(self):
        live.edit_args(self.aid, "q", {"sql": "SELECT 9"}, auto_approve=False)
        self.assertEqual(live.run_dataset(self.aid, "q", {})["status"], "approval")

    def test_publishing_through_the_tool_approves_its_queries(self):
        sys.path.insert(0, str(ROOT / "tests"))
        from test_types import load_plugin
        p = load_plugin()
        out = json.loads(p._publish({"type": "dashboard", "title": "t", "open": False,
                                     "files": {"dashboard.json": SPEC, "index.html": "x"}}))
        self.assertEqual(out["live_queries_approved"], 1)
        d = live.dataset(out["id"], "q")
        self.assertTrue(store.approved(out["id"], live.call_id(d["tool"], d["args"], d["rules"])))

    def test_conflict_and_refusals(self):
        self.assertTrue(live.edit_args(self.aid, "q", {"sql": "SELECT 3"}, base_version=7)["conflict"])
        with self.assertRaises(live.LiveError):
            live.edit_args(self.aid, "f", {"x": 1})  # not a live dataset
        with self.assertRaises(live.LiveError):
            live.edit_args(self.aid, "q", ["not", "an", "object"])
        page = store.publish(title="p", html="<p>x</p>")["id"]
        with self.assertRaises(live.LiveError):
            live.edit_args(page, "q", {"sql": "SELECT 1"})


if __name__ == "__main__":
    unittest.main()
