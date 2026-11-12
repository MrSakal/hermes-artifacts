"""Editing a live query from the Sources panel."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import live, store  # noqa: E402

SPEC = {"datasets": {"q": {"title": "Q", "source": {"kind": "call", "tool": "mcp_db_query", "args": {"sql": "SELECT 1"}}},
                     "f": {"title": "F", "source": {"kind": "rows", "rows": []}}}}


class EditTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(title="e", type="dashboard", files={"dashboard.json": SPEC, "index.html": "x"})["id"]

    def test_edit_keeps_tool_and_waits_for_the_hosts_yes(self):
        d = live.dataset(self.aid, "q")
        store.set_approval(self.aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)
        r = live.edit_args(self.aid, "q", {"sql": "SELECT 2", "tool": "terminal"}, base_version=1)
        self.assertEqual(r, {"ok": True, "version": 2})
        spec = json.loads(store.read_file(self.aid, "dashboard.json").decode())
        self.assertEqual(spec["datasets"]["q"]["source"]["tool"], "mcp_db_query")  # the tool can't change
        self.assertEqual(spec["datasets"]["q"]["source"]["args"]["sql"], "SELECT 2")
        self.assertEqual(spec["datasets"]["q"]["edit"]["via"], "user")
        d2 = live.dataset(self.aid, "q")
        # The save came from the page: it is not consent. The changed query waits for Hermes Desktop's dialog.
        self.assertFalse(store.approved(self.aid, live.call_id(d2["tool"], d2["args"], d2["rules"])))
        self.assertEqual(live.run_dataset(self.aid, "q", {})["status"], "approval")

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


class HistoryAndTestTests(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(ROOT / "tests"))
        from test_types import load_plugin
        self.p = load_plugin()
        out = json.loads(self.p._publish({"type": "dashboard", "title": "h", "open": False,
                                          "files": {"dashboard.json": SPEC, "index.html": "x"}}))
        self.aid = out["id"]

    def test_history_records_agent_publish_and_user_edits(self):
        live.edit_args(self.aid, "q", {"sql": "SELECT 2"})
        live.edit_args(self.aid, "q", {"sql": "SELECT 3"})
        h = store.history(self.aid, "q")
        self.assertEqual([e["args"]["sql"] for e in h], ["SELECT 1", "SELECT 2", "SELECT 3"])
        self.assertEqual(h[0]["via"], "agent")
        self.assertEqual(h[-1]["via"], "user")

    def test_test_runs_without_saving_once_the_user_allowed_those_args(self):
        calls = []
        ctx = type("C", (), {"call_mcp": lambda s, server, tool, a=None, timeout=30:
                             (calls.append(a), {"ok": True, "result": json.dumps([{"n": 1}, {"n": 2}])})[1]})()
        saved = live._CTX, live._known_servers
        live.set_ctx(ctx)
        live._known_servers = lambda: ["db"]
        try:
            r = live.test_args(self.aid, "q", {"sql": "SELECT 7"})
            self.assertEqual(r["status"], "approval")  # args the page made up: the host asks first
            self.assertEqual(calls, [])
            live.decide(self.aid, "q", r["call"], True, args={"sql": "SELECT 7"})  # the host dialog's yes
            r = live.test_args(self.aid, "q", {"sql": "SELECT 7"})
            self.assertEqual((r["status"], r["total"]), ("ok", 2))
            self.assertEqual(calls[0]["sql"], "SELECT 7")
            spec = json.loads(store.read_file(self.aid, "dashboard.json").decode())
            self.assertEqual(spec["datasets"]["q"]["source"]["args"]["sql"], "SELECT 1")  # nothing saved
            with self.assertRaises(live.LiveError):  # a write is never offered in the dialog
                live.pending(self.aid, "q", args={"sql": "DELETE FROM t"})
            p = live.pending(self.aid, "q", args={"sql": "DELETE FROM t"}, dialog=False)
            store.set_approval(self.aid, p["call"], p["tool"], True)  # even if it were allowed
            self.assertEqual(live.test_args(self.aid, "q", {"sql": "DELETE FROM t"})["status"], "refused")  # still read-only
        finally:
            live._CTX, live._known_servers = saved
