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


class Reg:
    def __init__(self, present=True, answer=None):
        self.present, self.answer = present, answer

    def get_entry(self, name, scope=None):
        return types.SimpleNamespace(toolset="mcp-erp_platform") if self.present else None

    def get_toolset_for_tool(self, name):
        return "mcp-erp_platform" if self.present else None

    def dispatch(self, name, args, scope=None):
        return self.answer


class StateTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(title="s", type="dashboard", files={"dashboard.json": SPEC, "index.html": "x"})["id"]
        d = live.dataset(self.aid, "w")
        store.set_approval(self.aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)
        live._cache.clear()
        self._entry, self._state = live._registry_entry, live.server_state

    def tearDown(self):
        live._registry_entry, live.server_state = self._entry, self._state

    def use(self, reg, state=None):
        live._registry_entry = lambda tool: (reg, reg.get_entry(tool), None)
        if state:
            live.server_state = lambda server: state

    def test_structured_reauth_from_hermes(self):
        self.use(Reg(answer=json.dumps({"error": "MCP server 'erp_platform' requires re-authentication.",
                                        "needs_reauth": True, "server": "erp_platform"})))
        r = live.run_dataset(self.aid, "w", {})
        self.assertEqual((r["status"], r["server"]), ("reauth", "erp_platform"))

    def test_auth_words_in_a_plain_error(self):
        self.use(Reg(answer=json.dumps({"error": "HTTP 401 Unauthorized: token expired"})))
        self.assertEqual(live.run_dataset(self.aid, "w", {})["status"], "reauth")

    def test_tool_missing_and_server_parked_on_login(self):
        self.use(Reg(present=False), {"state": "reauth"})
        r = live.run_dataset(self.aid, "w", {})
        self.assertEqual(r["status"], "reauth")
        self.assertIn("again", r["message"])

    def test_tool_missing_and_server_off_or_absent(self):
        self.use(Reg(present=False), {"state": "off"})
        self.assertEqual(live.run_dataset(self.aid, "w", {})["status"], "off")
        live._cache.clear()
        self.use(Reg(present=False), {"state": "absent", "error": "connection refused"})
        r = live.run_dataset(self.aid, "w", {})
        self.assertEqual(r["status"], "absent")
        self.assertIn("connection refused", r["message"])

    def test_an_ordinary_failure_stays_a_failure(self):
        self.use(Reg(answer=json.dumps({"error": "column 'x' does not exist"})))
        self.assertEqual(live.run_dataset(self.aid, "w", {})["status"], "failed")

    def test_server_name_from_the_tool_name(self):
        self.assertEqual(live.server_of("mcp__microsoft_learn__microsoft_docs_search"), "microsoft_learn")


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
