"""Live dashboard sources: filters and rules, answer decoding, approval, cache, MCP-only."""

import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import live, store  # noqa: E402

SPEC = {"title": "Live", "params": {"region": "", "n": 5},
        "datasets": {"sales": {"title": "Sales", "source": {
            "kind": "call", "tool": "mcp_db_query",
            "args": {"sql": "SELECT * FROM t WHERE ('{{region}}' = '' OR region = '{{region}}') LIMIT {{n}}", "limit": "{{n}}"},
            "rules": {"region": {"pattern": "^[A-Za-z ]{0,20}$"}, "n": {"type": "number", "minimum": 1, "maximum": 100}}}}}}


class FakeRegistry:
    def __init__(self):
        self.calls = []
        self.tools = {"mcp_db_query": "mcp-db", "terminal": "terminal"}

    def get_entry(self, name, scope=None):
        t = self.tools.get(name)
        return types.SimpleNamespace(toolset=t) if t else None

    def dispatch(self, name, args, scope=None):
        self.calls.append((name, args))
        return json.dumps({"content": [{"type": "text", "text": json.dumps({"rows": [{"region": "Pest", "n": 3}]})}]})


class LiveTests(unittest.TestCase):
    def setUp(self):
        self.reg = FakeRegistry()
        self._orig = live._registry_entry
        live._registry_entry = lambda tool: (self.reg, self.reg.get_entry(tool), None)
        live._cache.clear()
        self.aid = store.publish(title="live", type="dashboard",
                                 files={"dashboard.json": SPEC, "index.html": "<p>x</p>"})["id"]

    def tearDown(self):
        live._registry_entry = self._orig

    def test_fill_and_rules(self):
        a = live.fill(SPEC["datasets"]["sales"]["source"]["args"], {"region": "Pest", "n": 7},
                      SPEC["datasets"]["sales"]["source"]["rules"])
        self.assertIn("region = 'Pest') LIMIT 7", a["sql"])
        self.assertEqual(a["limit"], 7)  # whole-argument filter keeps its type
        with self.assertRaises(live.LiveError):
            live.fill({"q": "x = '{{region}}'"}, {"region": "x' OR 1=1 --"}, {"region": {"pattern": "^[A-Za-z ]{0,20}$"}})
        with self.assertRaises(live.LiveError):  # no rule: plain text only
            live.fill({"q": "'{{who}}'"}, {"who": "O'Brien"}, {})
        with self.assertRaises(live.LiveError):
            live.fill({"n": "{{n}}"}, {"n": 1000}, {"n": {"type": "number", "maximum": 100}})
        self.assertEqual(live.fill({"q": "IN ({{p}})"}, {"p": ["a", "b"]}, {"p": {"enum": ["a", "b", "c"]}})["q"], "IN (a,b)")

    def test_decode_and_rows(self):
        self.assertEqual(live.rows_of(live.decode('[{"a": 1}]'))["rows"], [{"a": 1}])
        bq = {"schema": {"fields": [{"name": "d", "type": "STRING"}, {"name": "n", "type": "INTEGER"}]},
              "rows": [{"f": [{"v": "2026-01"}, {"v": "12"}]}]}
        self.assertEqual(live.rows_of(bq)["rows"], [{"d": "2026-01", "n": 12}])
        self.assertEqual(live.decode({"structuredContent": {"x": 1}, "content": []}), {"x": 1})
        self.assertIsNone(live.rows_of({"total": 3}))
        with self.assertRaises(live.LiveError):
            live.decode({"isError": True, "content": [{"type": "text", "text": "denied"}]})

    def test_approval_cache_and_force(self):
        r = live.run_dataset(self.aid, "sales", {})
        self.assertEqual(r["status"], "approval")
        self.assertEqual(self.reg.calls, [])  # nothing runs before the user allows it
        d = live.dataset(self.aid, "sales")
        store.set_approval(self.aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)
        r = live.run_dataset(self.aid, "sales", {"region": "Pest"})
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["rows"], [{"region": "Pest", "n": 3}])
        self.assertIn("LIMIT 5", self.reg.calls[0][1]["sql"])  # default from dashboard.json params
        self.assertTrue(live.run_dataset(self.aid, "sales", {"region": "Pest"})["cached"])
        self.assertEqual(len(self.reg.calls), 1)
        live.run_dataset(self.aid, "sales", {"region": "Pest"}, force=True)
        self.assertEqual(len(self.reg.calls), 2)
        self.assertEqual(live.run_dataset(self.aid, "sales", {"region": "Pe'st"})["status"], "error")

    def test_changed_query_needs_new_approval(self):
        d = live.dataset(self.aid, "sales")
        store.set_approval(self.aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)
        spec = json.loads(json.dumps(SPEC))
        spec["datasets"]["sales"]["source"]["args"]["sql"] = "DROP TABLE t"
        store.publish(aid=self.aid, base=True, files={"dashboard.json": spec})
        self.assertEqual(live.run_dataset(self.aid, "sales", {})["status"], "approval")

    def test_only_mcp_tools(self):
        spec = json.loads(json.dumps(SPEC))
        spec["datasets"]["sales"]["source"]["tool"] = "terminal"
        aid = store.publish(title="t", type="dashboard", files={"dashboard.json": spec, "index.html": "x"})["id"]
        d = live.dataset(aid, "sales")
        store.set_approval(aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)
        r = live.run_dataset(aid, "sales", {})
        self.assertEqual(r["status"], "refused")
        self.assertEqual(self.reg.calls, [])


if __name__ == "__main__":
    unittest.main()


class GuardTests(unittest.TestCase):
    def ok(self, v):
        live.guard({"sql": v})

    def bad(self, v):
        with self.assertRaises(live.LiveError):
            live.guard({"sql": v})

    def test_guard(self):
        self.ok("SELECT month, SUM(net) FROM orders WHERE region = 'update' GROUP BY month")
        self.ok("WITH x AS (SELECT 1) SELECT * FROM x;")
        self.ok("-- monthly\nSELECT 1")
        live.guard({"query": "Azure Functions"})       # a search phrase is not SQL
        live.guard({"query": "update notes for Teams"})  # starts with a SQL word, still a search phrase
        live.guard({"query": "select the best Azure SKU"})
        self.bad("DELETE FROM orders")
        self.bad("SELECT 1; DROP TABLE orders")
        self.bad("SELECT * INTO OUTFILE '/tmp/x' FROM t")
        self.bad("SELECT 'unclosed FROM t")
        self.bad("UPDATE t SET a = 1")
        with self.assertRaises(live.LiveError):
            live.guard({"q": "x" * 40_000})
