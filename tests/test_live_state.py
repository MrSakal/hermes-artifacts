"""A connector that's out: expired login, turned off, not connected — named as such, not as a failure."""

import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import live, store  # noqa: E402

SPEC = {"datasets": {"w": {"title": "Work logs", "source": {"kind": "call", "tool": "mcp__erp_platform__list_work_logs", "args": {}}}}}


class Ctx:
    """ctx.call_mcp answering with the envelope Hermes makes of the MCP handler's result."""

    def __init__(self, env=None, raises=None):
        self.env, self.raises = env, raises

    def call_mcp(self, server, tool, arguments=None, timeout=30):
        if self.raises:
            raise self.raises
        return self.env


class StateTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(title="s", type="dashboard", files={"dashboard.json": SPEC, "index.html": "x"})["id"]
        d = live.dataset(self.aid, "w")
        store.set_approval(self.aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)
        live._cache.clear()
        self._saved = live._CTX, live._known_servers
        live._known_servers = lambda: ["erp_platform"]

    def tearDown(self):
        live._CTX, live._known_servers = self._saved

    def use(self, ctx):
        live.set_ctx(ctx)

    def test_reauth_from_hermes(self):
        self.use(Ctx({"ok": False, "error": "MCP server 'erp_platform' requires re-authentication."}))
        r = live.run_dataset(self.aid, "w", {})
        self.assertEqual((r["status"], r["server"]), ("reauth", "erp_platform"))

    def test_auth_words_in_a_plain_error(self):
        self.use(Ctx({"ok": False, "error": "HTTP 401 Unauthorized: token expired"}))
        self.assertEqual(live.run_dataset(self.aid, "w", {})["status"], "reauth")
        live._cache.clear()
        self.use(Ctx({"ok": True, "result": json.dumps({"error": "token has expired, sign in again"})}))
        self.assertEqual(live.run_dataset(self.aid, "w", {})["status"], "reauth")

    def test_server_not_connected(self):
        self.use(Ctx({"ok": False, "error": "MCP server 'erp_platform' is not connected"}))
        r = live.run_dataset(self.aid, "w", {})
        self.assertEqual(r["status"], "absent")
        self.assertIn("not connected", r["message"])

    def test_an_ordinary_failure_stays_a_failure(self):
        self.use(Ctx({"ok": False, "error": "column 'x' does not exist"}))
        self.assertEqual(live.run_dataset(self.aid, "w", {})["status"], "failed")
        live._cache.clear()
        self.use(Ctx(raises=RuntimeError("boom")))
        self.assertEqual(live.run_dataset(self.aid, "w", {})["status"], "failed")

    def test_structured_content_is_the_answer(self):
        self.use(Ctx({"ok": True, "result": "ignored", "structuredContent": [{"a": 1}]}))
        self.assertEqual(live.run_dataset(self.aid, "w", {})["rows"], [{"a": 1}])

    def test_server_name_from_the_tool_name(self):
        self.assertEqual(live.server_of("mcp__microsoft_learn__microsoft_docs_search"), "microsoft_learn")
        self.assertEqual(live.split_tool("mcp__erp_platform__list_work_logs"), ("erp_platform", "list_work_logs"))
        self.assertEqual(live.split_tool("terminal"), (None, None))


if __name__ == "__main__":
    unittest.main()


class PollTests(unittest.TestCase):
    def setUp(self):
        self._rt = live.run_tool

    def tearDown(self):
        live.run_tool = self._rt

    def test_repeats_until_done_with_backoff(self):
        answers = [{"jobComplete": False, "jobReference": {"jobId": "j1"}}] * 3 + [[{"n": 1}]]
        calls, slept = [], []
        live.run_tool = lambda tool, args: (calls.append((tool, args)), answers[len(calls) - 1])[1]
        out = live.run_polling("mcp_bq_query", {"sql": "SELECT 1"}, None, sleep=slept.append, clock=lambda: 0)
        self.assertEqual(out, [{"n": 1}])
        self.assertEqual(slept, [2.0, 4.0, 8.0])
        self.assertTrue(all(c == ("mcp_bq_query", {"sql": "SELECT 1"}) for c in calls))

    def test_poll_tool_takes_values_from_the_answer(self):
        seq = [{"status": {"state": "RUNNING"}, "statement_id": "s-9"}, {"status": {"state": "SUCCEEDED"}, "rows": [{"a": 1}]}]
        calls = []
        live.run_tool = lambda tool, args: (calls.append((tool, args)), seq[len(calls) - 1])[1]
        live.run_polling("mcp_db_run", {"sql": "SELECT 1"},
                         {"tool": "mcp_db_poll", "args": {"id": "{{answer.statement_id}}"}}, sleep=lambda s: None, clock=lambda: 0)
        self.assertEqual(calls[1], ("mcp_db_poll", {"id": "s-9"}))

    def test_gives_up_after_three_minutes(self):
        live.run_tool = lambda tool, args: {"jobComplete": False}
        t = [0.0]
        def clock():
            return t[0]
        def sleep(s):
            t[0] += s
        with self.assertRaises(live.LiveError) as cm:
            live.run_polling("mcp_bq_query", {}, None, sleep=sleep, clock=clock)
        self.assertIn("3 minutes", cm.exception.message)
        self.assertLessEqual(t[0], 180)
