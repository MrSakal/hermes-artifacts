"""live.py reaches MCP only through ctx.call_mcp (Hermes' trust gates and the plugin's default-deny
mcp_allowlist), never through private modules; a denied server reads as the config key to set."""

import importlib
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "plugin"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import live, store  # noqa: E402


class Ctx:
    def __init__(self, allow=(), env=None):
        self.allow, self.env, self.calls = set(allow), env, []

    def call_mcp(self, server, tool, arguments=None, timeout=30):
        if server not in self.allow:  # what Hermes does: default-deny, PermissionError naming the key
            raise PermissionError(f"Plugin 'hermes-artifacts' is not allowed to call MCP server {server!r}.")
        self.calls.append((server, tool, arguments, timeout))
        return self.env if self.env is not None else {"ok": True, "result": "[]"}


SPEC = {"datasets": {"q": {"title": "Q", "source": {"kind": "call", "tool": "mcp__my_db__run_query",
                                                     "args": {"sql": "SELECT 1"}}}}}


class SeamTests(unittest.TestCase):
    def setUp(self):
        self._saved = live._CTX, live._known_servers
        live._known_servers = lambda: ["my-db"]

    def tearDown(self):
        live._CTX, live._known_servers = self._saved

    def test_no_private_hermes_imports(self):
        src = (ROOT / "plugin" / "hermes_artifacts" / "live.py").read_text(encoding="utf-8")
        for private in ("mcp_tool_discovery", "registry.dispatch", "get_mcp_status", "mcp_tool_handlers"):
            self.assertNotIn(private, src)

    def test_server_and_tool_name_go_to_call_mcp(self):
        ctx = Ctx(allow=("my-db",))
        live.set_ctx(ctx)
        live.run_tool("mcp__my_db__run_query", {"sql": "SELECT 1"})
        self.assertEqual(ctx.calls[0][:3], ("my-db", "run_query", {"sql": "SELECT 1"}))  # the configured spelling
        live.run_tool("mcp_my_db_run_query", {})  # the older single-underscore name
        self.assertEqual(ctx.calls[1][:2], ("my-db", "run_query"))

    def test_allowlist_denial_names_the_config_key(self):
        live.set_ctx(Ctx(allow=()))
        with self.assertRaises(live.LiveError) as e:
            live.run_tool("mcp__my_db__run_query", {})
        self.assertEqual(e.exception.status, "denied")
        self.assertIn("plugins.entries.hermes-artifacts.mcp_allowlist", e.exception.message)
        self.assertIn("my-db", e.exception.message)
        # and on the dashboard: the source says the same, nothing ran
        aid = store.publish(title="d", type="dashboard", files={"dashboard.json": SPEC, "index.html": "x"})["id"]
        d = live.dataset(aid, "q")
        store.set_approval(aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)
        r = live.run_dataset(aid, "q", {})
        self.assertEqual((r["status"], r["config"]), ("denied", "plugins.entries.hermes-artifacts.mcp_allowlist"))

    def test_publish_tells_the_agent_which_key_to_set(self):
        sys.path.insert(0, str(ROOT / "tests"))
        from test_types import load_plugin
        p = load_plugin()
        plive = importlib.import_module(p.__name__ + ".hermes_artifacts.live")  # the plugin's own copy
        saved = plive.allowlist, plive._known_servers
        plive.allowlist, plive._known_servers = (lambda: []), (lambda: ["my-db"])
        try:
            out = json.loads(p._publish({"type": "dashboard", "title": "t", "open": False,
                                         "files": {"dashboard.json": SPEC, "index.html": "x"}}))
            self.assertIn("plugins.entries.hermes-artifacts.mcp_allowlist", out["live_blocked"])
            self.assertIn("my-db", out["live_blocked"])
            plive.allowlist = lambda: ["my-db"]
            out = json.loads(p._publish({"type": "dashboard", "title": "t", "open": False,
                                         "files": {"dashboard.json": SPEC, "index.html": "x"}}))
            self.assertNotIn("live_blocked", out)
        finally:
            plive.allowlist, plive._known_servers = saved

    def test_publish_hands_the_agent_the_command_to_relay(self):
        sys.path.insert(0, str(ROOT / "tests"))
        from test_types import load_plugin
        p = load_plugin()
        plive = importlib.import_module(p.__name__ + ".hermes_artifacts.live")
        saved = plive.allowlist, plive._known_servers, plive._granted, plive._managed
        plive.allowlist, plive._known_servers = (lambda: ["other"]), (lambda: ["my-db"])
        plive._granted, plive._managed = (lambda: ["other"]), (lambda: False)
        try:
            out = json.loads(p._publish({"type": "dashboard", "title": "t", "open": False,
                                         "files": {"dashboard.json": SPEC, "index.html": "x"}}))
            self.assertIn("hermes config set plugins.entries.hermes-artifacts.mcp_allowlist '[other, my-db]'",
                          out["live_blocked"])
            self.assertIn("don't run it", out["live_blocked"])
            self.assertLess(len(out["live_blocked"]), 220)  # one short line: token economy
        finally:
            plive.allowlist, plive._known_servers, plive._granted, plive._managed = saved

    def test_the_agents_check_carries_the_command(self):
        sys.path.insert(0, str(ROOT / "tests"))
        from test_types import load_plugin
        p = load_plugin()
        plive = importlib.import_module(p.__name__ + ".hermes_artifacts.live")
        pstore = importlib.import_module(p.__name__ + ".hermes_artifacts.store")
        saved = plive.allowlist, plive._known_servers, plive._granted, plive._managed
        plive.allowlist, plive._known_servers = (lambda: ["other"]), (lambda: ["my-db"])
        plive._granted, plive._managed = (lambda: ["other"]), (lambda: False)
        try:
            aid = pstore.publish(title="d", type="dashboard", files={"dashboard.json": SPEC, "index.html": "x"})["id"]
            out = json.loads(p._check({"id": aid, "wait": 0}))
            self.assertIn(PREFIX + "other, my-db]'", out["live_blocked"])
            plive.allowlist = plive._granted = lambda: ["other", "my-db"]
            self.assertNotIn("live_blocked", json.loads(p._check({"id": aid, "wait": 0})))
        finally:
            plive.allowlist, plive._known_servers, plive._granted, plive._managed = saved

    def test_ctx_is_found_in_the_plugin_module_the_web_server_did_not_import(self):
        live._CTX = None
        ctx = Ctx(allow=("my-db",))
        mod = types.ModuleType("hermes_plugins_fake_artifacts")
        mod.PLUGIN_ID, mod._ctx = "hermes-artifacts", ctx
        sys.modules[mod.__name__] = mod
        try:
            live.run_tool("mcp__my_db__run_query", {})
            self.assertEqual(len(ctx.calls), 1)
        finally:
            sys.modules.pop(mod.__name__, None)

    def test_without_a_ctx_a_readable_message(self):
        live._CTX = None
        saved = {k: v for k, v in sys.modules.items() if getattr(v, "PLUGIN_ID", None) == "hermes-artifacts" and v is not live}
        for k in saved:
            sys.modules.pop(k)
        try:
            with self.assertRaises(live.LiveError) as e:
                live.run_tool("mcp__my_db__run_query", {})
            self.assertIn("ctx.call_mcp", e.exception.message)
        finally:
            sys.modules.update(saved)

    def test_a_truncated_answer_is_a_clear_failure(self):
        live.set_ctx(Ctx(allow=("my-db",), env={"ok": True, "result": "[{\"a\": 1", "truncated": True}))
        with self.assertRaises(live.LiveError) as e:
            live.run_tool("mcp__my_db__run_query", {})
        self.assertIn("64 KB", e.exception.message)


PREFIX = "hermes config set plugins.entries.hermes-artifacts.mcp_allowlist '["


class AllowCommandTests(unittest.TestCase):
    """The one command a denied server gets: the user's grants plus the missing ones, plain names only."""

    def setUp(self):
        self._saved = live._CTX, live._known_servers, live._granted, live._managed
        live._known_servers = lambda: ["my-db"]
        live._granted, live._managed = (lambda: ["bigquery", "my-db"]), (lambda: False)

    def tearDown(self):
        live._CTX, live._known_servers, live._granted, live._managed = self._saved

    def test_existing_grants_are_kept_and_names_not_repeated(self):
        self.assertEqual(live.allow_command(["my-db", "pg.main", "pg.main"]), PREFIX + "bigquery, my-db, pg.main]'")
        live._granted = lambda: []
        self.assertEqual(live.allow_command(["my-db"]), PREFIX + "my-db]'")
        self.assertIsNone(live.allow_command([]))

    def test_a_hostile_or_yaml_coerced_name_gets_no_command(self):
        for bad in ("db'; rm -rf ~ #", "db]' && curl x", "a b", "$(id)", "db\n", "true", "null", "1.5", "2024-01-01", "", "x" * 101):
            self.assertIsNone(live.allow_command([bad]), bad)
        live._granted = lambda: ["ok", "we ird"]  # a grant no command can carry: no command, not a dropped grant
        self.assertIsNone(live.allow_command(["my-db"]))

    def test_no_command_when_the_list_cant_be_read_or_the_install_is_managed(self):
        live._granted = lambda: None
        self.assertIsNone(live.allow_command(["my-db"]))
        live._granted, live._managed = (lambda: []), (lambda: True)
        self.assertIsNone(live.allow_command(["my-db"]))
        self.assertIn("administrator", live.denied_message("my-db"))

    def test_the_page_gets_no_command_and_no_other_grants(self):
        live.set_ctx(Ctx(allow=()))
        aid = store.publish(title="d", type="dashboard", files={"dashboard.json": SPEC, "index.html": "x"})["id"]
        d = live.dataset(aid, "q")
        store.set_approval(aid, live.call_id(d["tool"], d["args"], d["rules"]), d["tool"], True)
        live._granted = lambda: ["bigquery"]
        for r in (live.run_dataset(aid, "q", {}),  # what /op dataset.run, call and test hand the frame
                  live.loader_call(aid, "q", "mcp__my_db__run_query", {"sql": "SELECT 1"}),
                  live.test_args(aid, "q", {"sql": "SELECT 1"}, {})):
            if r["status"] == "approval":
                continue
            self.assertEqual((r["status"], r["server"]), ("denied", "my-db"))
            self.assertNotIn("command", r)
            self.assertNotIn("bigquery", json.dumps(r))
            self.assertNotIn("hermes config set", json.dumps(r))
            self.assertIn("Show the command", r["message"])
        help_ = live.allow_help(aid)  # host only: what Hermes Desktop's dialog gets for this artifact
        self.assertEqual((help_["servers"], help_["command"]), (["my-db"], PREFIX + "bigquery, my-db]'"))

    def test_a_hostile_server_in_a_dashboard_gets_words_not_a_command(self):
        live.set_ctx(Ctx(allow=()))
        live._known_servers = lambda: []
        spec = {"datasets": {"q": {"title": "Q", "source": {"kind": "call", "tool": "mcp__x$(id)__run", "args": {}}}}}
        aid = store.publish(title="d", type="dashboard", files={"dashboard.json": spec, "index.html": "x"})["id"]
        help_ = live.allow_help(aid)
        self.assertTrue(help_["servers"])
        self.assertIsNone(help_["command"])
        with self.assertRaises(live.LiveError) as e:
            live.run_tool("mcp__x$(id)__run", {})
        self.assertNotIn("command", e.exception.extra)
        self.assertNotIn("hermes config set", e.exception.message)


if __name__ == "__main__":
    unittest.main()
