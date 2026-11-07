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
        return json.dumps({"content": [{"type": "text", "text": json.dumps({"rows": [{"region": "South", "n": 3}]})}]})


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
        a = live.fill(SPEC["datasets"]["sales"]["source"]["args"], {"region": "South", "n": 7},
                      SPEC["datasets"]["sales"]["source"]["rules"])
        self.assertIn("region = 'South') LIMIT 7", a["sql"])
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

    def test_approval_live_always_and_cached_for_thumbs(self):
        r = live.run_dataset(self.aid, "sales", {})
        self.assertEqual(r["status"], "approval")
        self.assertEqual(self.reg.calls, [])  # nothing runs before the user allows it
        d = live.dataset(self.aid, "sales")
        store.set_approval(self.aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)
        r = live.run_dataset(self.aid, "sales", {"region": "South"})
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["rows"], [{"region": "South", "n": 3}])
        self.assertIn("LIMIT 5", self.reg.calls[0][1]["sql"])  # default from dashboard.json params
        # live (open, refresh, filter change) always runs the call, like Claude's dashboards
        self.assertFalse(live.run_dataset(self.aid, "sales", {"region": "South"})["cached"])
        self.assertEqual(len(self.reg.calls), 2)
        # cached (thumbnails, the instant first paint) answers from the last run
        hit = live.run_dataset(self.aid, "sales", {"region": "South"}, mode="cached")
        self.assertTrue(hit["cached"])
        self.assertEqual(hit["rows"], [{"region": "South", "n": 3}])
        self.assertEqual(len(self.reg.calls), 2)
        # the last answer is on disk: a restart (empty memory) still paints it
        live._cache.clear()
        self.assertTrue(live.run_dataset(self.aid, "sales", {"region": "South"}, mode="cached")["cached"])
        self.assertEqual(len(self.reg.calls), 2)
        # cached with no answer yet runs once
        live.run_dataset(self.aid, "sales", {"region": "West"}, mode="cached")
        self.assertEqual(len(self.reg.calls), 3)
        self.assertEqual(live.run_dataset(self.aid, "sales", {"region": "Pe'st"})["status"], "error")

    def test_old_answers_expire_after_24h(self):
        d = live.dataset(self.aid, "sales")
        store.set_approval(self.aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)
        live.run_dataset(self.aid, "sales", {})
        for k in list(live._cache):
            live._cache[k]["at"] -= 25 * 3600
        for f in (store._dir(self.aid) / "cache").glob("*.json"):
            e = json.loads(f.read_text(encoding="utf-8")); e["at"] -= 25 * 3600; f.write_text(json.dumps(e), encoding="utf-8")
        live.run_dataset(self.aid, "sales", {}, mode="cached")
        self.assertEqual(len(self.reg.calls), 2)  # too old to paint: ran live

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


class LoaderCallTests(unittest.TestCase):
    """A loader's call(tool, args): only the dataset's own connector, only once it is allowed, read-only."""

    def setUp(self):
        self.reg = FakeRegistry()
        self.reg.tools.update({"mcp_db_poll": "mcp-db", "mcp_other_x": "mcp-other"})
        self._orig = live._registry_entry
        live._registry_entry = lambda tool: (self.reg, self.reg.get_entry(tool), None)
        self.aid = store.publish(title="lc", type="dashboard", files={"dashboard.json": SPEC, "index.html": "<p>x</p>"})["id"]

    def tearDown(self):
        live._registry_entry = self._orig

    def allow(self):
        d = live.dataset(self.aid, "sales")
        store.set_approval(self.aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)

    def test_needs_the_dataset_allowed(self):
        self.assertEqual(live.loader_call(self.aid, "sales", "poll", {"id": 1})["status"], "approval")
        self.assertEqual(self.reg.calls, [])

    def test_same_connector_by_its_short_or_hermes_name(self):
        self.allow()
        r = live.loader_call(self.aid, "sales", "poll", {"id": 1})
        self.assertEqual((r["status"], r["tool"]), ("ok", "mcp_db_poll"))
        self.assertEqual(r["answer"], {"rows": [{"region": "South", "n": 3}]})
        self.assertEqual(live.loader_call(self.aid, "sales", "mcp_db_poll", {})["status"], "ok")

    def test_refuses_other_connectors_and_writes(self):
        self.allow()
        self.assertEqual(live.loader_call(self.aid, "sales", "mcp_other_x", {})["status"], "refused")
        self.assertEqual(live.loader_call(self.aid, "sales", "terminal", {"command": "rm -rf /"})["status"], "refused")
        self.assertEqual(live.loader_call(self.aid, "sales", "query", {"sql": "DELETE FROM t"})["status"], "refused")
        self.assertEqual([c[0] for c in self.reg.calls], [])
