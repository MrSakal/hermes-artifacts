"""Who consents to a live dashboard query. Neither the agent's own dashboard.json nor the page's JS may
make Hermes run an MCP call the user did not sanction: at publish a query is approved without asking only
when the agent really ran that call in its chat (post_tool_call); anything else waits for the user's yes in
a dialog Hermes Desktop draws, which nothing inside the sandboxed frame can answer."""

import importlib
import json
import os
import re
import socket
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, live, store  # noqa: E402

SQL = "SELECT month, SUM(v) FROM t WHERE region = '{{region}}' AND year = {{year}} GROUP BY month"
SPEC = {"params": {"region": "South", "year": 2026},
        "datasets": {"m": {"title": "M", "source": {
            "kind": "call", "tool": "mcp__db__query", "args": {"sql": SQL, "limit": "{{n}}"},
            "rules": {"region": {"enum": ["North", "South"]}, "year": {"type": "number", "minimum": 2000, "maximum": 2100},
                      "n": {"type": "number", "maximum": 500}}}}}}
RAN = {"sql": "SELECT month, SUM(v) FROM t WHERE region = 'South' AND year = 2026 GROUP BY month", "limit": 100}


def ds(**over):
    src = json.loads(json.dumps(SPEC["datasets"]["m"]["source"]))
    src.update(over)
    return {"tool": src["tool"], "args": src["args"], "rules": src.get("rules") or {}, "poll": src.get("poll")}


class MatchTests(unittest.TestCase):
    """live.recorded_match: the rule a query must meet to run without asking."""

    def setUp(self):
        live._RAN.clear()

    def ran(self, tool="mcp__db__query", args=None, session="s1", status="ok"):
        return live.record_call(session, tool, RAN if args is None else args, status)

    def test_the_same_call_with_filter_values_in_its_holes_matches(self):
        self.ran()
        self.assertTrue(live.recorded_match("s1", ds()))

    def test_unrecorded_or_other_session_does_not(self):
        self.assertFalse(live.recorded_match("s1", ds()))
        self.ran(session="other")
        self.assertFalse(live.recorded_match("s1", ds()))

    def test_any_difference_outside_the_holes_does_not(self):
        self.ran(args={**RAN, "sql": RAN["sql"].replace("SUM(v)", "SUM(v), secret")})
        self.ran(args={**RAN, "extra": 1})
        self.ran(tool="mcp__db__query_all")
        self.assertFalse(live.recorded_match("s1", ds()))

    def test_a_value_its_rule_refuses_does_not(self):
        self.ran(args={**RAN, "sql": RAN["sql"].replace("'South'", "'x'' OR 1=1'")})
        self.ran(args={**RAN, "limit": 100000})
        self.assertFalse(live.recorded_match("s1", ds()))

    def test_a_hole_without_a_pinning_rule_never_matches(self):
        self.ran(args={"sql": "SELECT 1"})
        self.assertFalse(live.recorded_match("s1", ds(args={"sql": "{{q}}"}, rules={})))
        self.assertFalse(live.recorded_match("s1", ds(args={"sql": "{{q}}"}, rules={"q": {"maxLength": 99}})))

    def test_a_poll_tool_must_have_run_too(self):
        self.ran()
        poll = {"tool": "mcp__db__get_result", "args": {"id": "{{answer.id}}"}}
        self.assertFalse(live.recorded_match("s1", ds(poll=poll)))
        self.ran(tool="mcp__db__get_result", args={"id": "j1"})
        self.assertTrue(live.recorded_match("s1", ds(poll=poll)))

    def test_only_mcp_calls_that_worked_are_kept_and_bounded(self):
        self.assertFalse(live.record_call("s1", "terminal", {"command": "ls"}))
        self.assertFalse(live.record_call("s1", "mcp__db__query", RAN, "error"))
        self.assertFalse(live.record_call(None, "mcp__db__query", RAN))
        for i in range(live.RAN_PER_SESSION + 5):
            live.record_call("s1", "mcp__db__query", {"i": i}, "ok")
        self.assertEqual(len(live.recorded("s1")), live.RAN_PER_SESSION)
        for i in range(live.RAN_SESSIONS + 3):
            live.record_call(f"x{i}", "mcp__db__query", {}, "ok")
        self.assertLessEqual(len(live._RAN), live.RAN_SESSIONS)


class Cfg:
    """The plugin's ctx: settings only (require_approval)."""

    def __init__(self, ask=False):
        self.ask = ask

    def get_config(self, key, default=None):
        return self.ask if key == "require_approval" else default


class PublishTests(unittest.TestCase):
    """The agent's publish: approved only what it ran; require_approval: true always asks."""

    def setUp(self):
        from test_types import load_plugin
        self.p = load_plugin()
        self.plive = importlib.import_module(self.p.__name__ + ".hermes_artifacts.live")
        self.plive._RAN.clear()
        saved = self.plive.allowlist, self.plive._known_servers
        self.plive.allowlist, self.plive._known_servers = (lambda: ["db"]), (lambda: ["db"])
        self.addCleanup(lambda: (setattr(self.plive, "allowlist", saved[0]), setattr(self.plive, "_known_servers", saved[1])))
        self.p._ctx = Cfg()

    def publish(self, session="chat-1"):
        out = json.loads(self.p._publish({"type": "dashboard", "title": "t", "open": False,
                                          "files": {"dashboard.json": SPEC, "index.html": "x"}}, session_id=session))
        d = live.dataset(out["id"], "m")
        return out, store.approved(out["id"], live.call_id(d["tool"], d["args"], d["rules"]))

    def ran(self, session="chat-1"):
        self.p._tool_ran(tool_name="mcp__db__query", args=RAN, session_id=session, status="ok")  # post_tool_call

    def test_unrecorded_query_is_not_auto_approved(self):
        out, ok = self.publish()
        self.assertFalse(ok)
        self.assertEqual(out["live_queries_waiting"], ["m"])
        self.assertIn("run each one yourself", out["live_note"])
        self.assertNotIn("live_queries_approved", out)

    def test_recorded_query_is_approved(self):
        self.ran()
        out, ok = self.publish()
        self.assertTrue(ok)
        self.assertEqual(out["live_queries_approved"], 1)
        self.assertNotIn("live_queries_waiting", out)

    def test_recorded_in_another_chat_is_not(self):
        self.ran("chat-2")
        self.assertFalse(self.publish("chat-1")[1])

    def test_require_approval_always_asks(self):
        self.p._ctx = Cfg(ask=True)
        self.ran()
        out, ok = self.publish()
        self.assertFalse(ok)
        self.assertIn("require_approval", out["live_note"])

    def test_the_hook_is_registered(self):
        hooks = []
        ctx = type("C", (), {"register_hook": lambda s, n, f, **k: hooks.append(n), "register_tool": lambda s, **k: None,
                             "register_cli_command": lambda s, *a, **k: None, "get_config": lambda s, k, d=None: d})()
        self.p.register(ctx)
        self.assertIn("post_tool_call", hooks)
        self.assertIs(self.plive._CTX, ctx)
        self.plive.set_ctx(None)


class HostOnlyConsentTests(unittest.TestCase):
    """The page's bridge can't approve; only the host route (unreachable from the frame) can, and only
    the call the dialog showed."""

    def setUp(self):
        self.aid = store.publish(title="c", type="dashboard", files={"dashboard.json": SPEC, "index.html": "x"})["id"]

    def op(self, op, **args):
        return api.handle("POST", f"artifacts/{self.aid}/op", {}, {"op": op, "args": args})

    def test_an_in_frame_click_cannot_approve(self):
        with self.assertRaises(api.ApiError) as e:
            self.op("dataset.approve", id="m")  # whatever gesture the page had
        self.assertEqual(e.exception.status, 403)
        self.assertEqual(self.op("dataset.run", id="m")["status"], "approval")
        self.assertEqual(self.op("dataset.decline", id="m")["allowed"], False)  # taking away is fine

    def test_the_host_dialog_approves_exactly_what_it_showed(self):
        url = f"artifacts/{self.aid}/approval"
        shown = api.handle("POST", url, {}, {"id": "m"})
        self.assertEqual((shown["tool"], shown["args"]["sql"], shown["approved"]), ("mcp__db__query", SQL, False))
        with self.assertRaises(api.ApiError):  # the query changed after the dialog was drawn
            api.handle("POST", url, {}, {"id": "m", "call": "0" * 24, "allowed": True})
        r = api.handle("POST", url, {}, {"id": "m", "call": shown["call"], "allowed": True})
        self.assertTrue(r["allowed"])
        d = live.dataset(self.aid, "m")
        self.assertTrue(store.approved(self.aid, live.call_id(d["tool"], d["args"], d["rules"])))

    def test_desktop_host_draws_the_dialog_and_never_forwards_approve(self):
        js = (PLUGIN / "desktop" / "plugin.js").read_text(encoding="utf-8")
        branch = js[js.index("if (m.op === 'dataset.approve') {"):]
        branch = branch[:branch.index("\n          }")]
        self.assertIn("approveQueries(", branch)
        self.assertNotIn("/op", branch)
        fn = js[js.index("async function approveQueries("):]
        fn = fn[:fn.index("\n}\n") if "\n}\n" in fn else fn.index("\r\n}\r\n")]
        self.assertLess(fn.index("await askUser('query'"), fn.index("allowed: true"))  # yes only after the dialog
        # the dialog ignores an Allow in its first half second and never focuses it by default
        self.assertTrue(re.search(r"if \(ok && Date\.now\(\) - \(c\.at \|\| 0\) < 500\) return", js))
        self.assertIn("autoFocus: !query", js)


class BrowserViewerTests(unittest.TestCase):
    """The browser viewer has no host dialog, so it runs no live query at all and says where to go."""

    def test_dataset_ops_are_refused_with_a_pointer_to_desktop(self):
        from hermes_artifacts.server import ArtifactServer, Config

        def free():
            s = socket.socket()
            s.bind(("127.0.0.1", 0))
            n = s.getsockname()[1]
            s.close()
            return n
        cfg = Config(free(), free())
        srv = ArtifactServer(cfg).start()
        try:
            aid = store.publish(title="b", type="dashboard", files={"dashboard.json": SPEC, "index.html": "x"})["id"]
            for op in ("dataset.run", "dataset.approve", "dataset.call"):
                req = urllib.request.Request(f"{cfg.shell_origin}/api/{aid}/{op}", data=b'{"id": "m"}', method="POST",
                                             headers={"Origin": cfg.shell_origin, "X-Hermes-Token": cfg.token,
                                                      "Content-Type": "application/json"})
                with self.assertRaises(urllib.error.HTTPError) as e:
                    urllib.request.urlopen(req, timeout=5)
                self.assertEqual(e.exception.code, 403)
                self.assertIn("Hermes Desktop", json.loads(e.exception.read())["error"])
        finally:
            srv.stop()


if __name__ == "__main__":
    unittest.main()
