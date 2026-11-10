"""live.py reaches Hermes only through public surfaces (tools.registry) plus one lazy MCP seam
(tools.mcp_tool_discovery) that degrades to a readable message when a release moves it."""

import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "plugin"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import live  # noqa: E402


class Reg:
    def __init__(self, scoped, plain):
        self.scoped, self.plain, self.lookups = scoped, plain, []

    @staticmethod
    def current_scope_key():
        return "/home/profile"

    def get_entry(self, name, scope=None):
        self.lookups.append((name, scope))
        src = self.scoped if scope else self.plain
        return types.SimpleNamespace(toolset=src[name]) if name in src else None

    def get_toolset_for_tool(self, name):
        return self.plain.get(name) or self.scoped.get(name)


class SeamTests(unittest.TestCase):
    def setUp(self):
        self._saved = {k: sys.modules.get(k) for k in ("tools", "tools.registry", "tools.mcp_tool_discovery")}
        self.tools_pkg = types.ModuleType("tools")
        self.tools_pkg.__path__ = []
        sys.modules["tools"] = self.tools_pkg

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v

    def _install(self, reg, disc=None):
        rmod = types.ModuleType("tools.registry")
        rmod.registry = reg
        sys.modules["tools.registry"] = rmod
        self.tools_pkg.registry = rmod
        if disc is None:
            sys.modules["tools.mcp_tool_discovery"] = None  # import fails, as after a move
            self.tools_pkg.__dict__.pop("mcp_tool_discovery", None)
        else:
            sys.modules["tools.mcp_tool_discovery"] = disc
            self.tools_pkg.mcp_tool_discovery = disc

    def test_scope_comes_from_the_registry(self):
        reg = Reg({"mcp_db_q": "mcp-db"}, {})
        self._install(reg)
        _, entry, scope = live._registry_entry("mcp_db_q")
        self.assertEqual(scope, "/home/profile")
        self.assertEqual(entry.toolset, "mcp-db")

    def test_discovery_runs_once_when_the_tool_is_missing(self):
        reg = Reg({}, {})
        disc = types.ModuleType("tools.mcp_tool_discovery")
        ran = []

        def discover():
            ran.append(1)
            reg.plain["mcp_db_q"] = "mcp-db"
        disc.discover_mcp_tools = discover
        disc.get_mcp_status = lambda include_runtime=True: [{"name": "db", "connected": True}]
        self._install(reg, disc)
        _, entry, _ = live._registry_entry("mcp_db_q")
        self.assertEqual(ran, [1])
        self.assertEqual(entry.toolset, "mcp-db")
        self.assertEqual(live.server_state("db"), {"state": "ok"})

    def test_a_moved_seam_reads_as_a_message_not_a_crash(self):
        self._install(Reg({}, {}))
        _, entry, _ = live._registry_entry("mcp_db_q")
        self.assertIsNone(entry)
        st = live.server_state("db")
        self.assertEqual(st["state"], "absent")
        self.assertIn("tools.mcp_tool_discovery.get_mcp_status", st["error"])
        with self.assertRaises(live.LiveError) as e:
            live.run_tool("mcp_db_q", {})
        self.assertEqual(e.exception.status, "absent")
        self.assertIn("no longer exposes MCP server status", e.exception.message)


if __name__ == "__main__":
    unittest.main()
