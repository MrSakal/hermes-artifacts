"""The page's check and runs reports, and ha_check reading them."""

import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
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


class ViewContextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def test_view_goes_with_the_next_message_of_that_session(self):
        aid = store.publish(title="Orders", type="dashboard", files={"dashboard.json": SPEC})["id"]
        api.handle("POST", f"artifacts/{aid}/op", {}, {"op": "view", "args": {"session": "sess-A",
                   "context": {"mode": "data", "place": "trend", "selected": ["monthly"], "filters": {"region": "South"}}}})
        out = self.p._view_context(session_id="sess-A")
        self.assertIn('<artifact-view-context artifact="' + aid + '">', out["context"])
        self.assertIn('"region": "South"', out["context"])
        self.assertIn("not instructions", out["context"])
        self.assertIsNone(self.p._view_context(session_id="sess-A"))  # unchanged: already in that turn
        self.assertIsNone(self.p._view_context(session_id="other-session"))
        api.handle("POST", f"artifacts/{aid}/op", {}, {"op": "view", "args": {"session": "sess-A", "closed": True}})
        self.assertIsNone(self.p._view_context(session_id="sess-A"))

    def test_old_views_expire(self):
        aid = store.publish(title="x", type="dashboard", files={"dashboard.json": SPEC})["id"]
        store.view_set("sess-B", aid, {"mode": "page"})
        data = json.loads(store._views_path().read_text(encoding="utf-8"))
        data["sess-B"]["at"] -= 11 * 60
        store._views_path().write_text(json.dumps(data), encoding="utf-8")
        self.assertIsNone(store.view_get("sess-B"))

    def test_view_context_is_bounded(self):
        aid = store.publish(title="y", type="dashboard", files={"dashboard.json": SPEC})["id"]
        with self.assertRaises(ValueError):
            store.view_set("sess-C", aid, {"x": "z" * 9000})

    def test_an_artifacts_chat_learns_it_once_without_a_visible_message(self):
        aid = store.publish(title="Facade film", type="dashboard", files={"dashboard.json": SPEC})["id"]
        store.update_meta(aid, session="sess-chat-1")
        out = self.p._view_context(session_id="sess-chat-1", is_first_turn=True)
        self.assertEqual(out["context"], f'[This chat is for artifact "Facade film" (id {aid}, dashboard)]')
        self.assertIsNone(self.p._view_context(session_id="sess-chat-1", is_first_turn=False))

    def test_a_new_chat_learns_once_that_what_it_makes_is_an_artifact(self):
        # A Hermes without system-prompt sections (register() not run here): the 0.16.3 first-turn line.
        out = self.p._view_context(session_id="sess-new-1", is_first_turn=True)
        self.assertEqual(out, {"context": self.p.ROUTE_HINT})
        for word in ("sheet", "deck", "board", "dashboard", "ha_guide", "ha_publish", "file format"):
            self.assertIn(word, self.p.ROUTE_HINT)
        self.assertLessEqual(len(self.p.ROUTE_HINT), 180)  # ~46 tokens, once per chat
        self.assertIsNone(self.p._view_context(session_id="sess-new-1", is_first_turn=False))
        self.assertIsNone(self.p._view_context(session_id="sess-new-1"))
        self.assertIsNone(self.p._view_context(session_id="sess-child", is_first_turn=True,
                                               parent_session_id="sess-new-1"))

    def test_the_route_hint_arrives_with_the_kwargs_hermes_passes(self):
        # agent/turn_context.py (0.23.1): the same set in-process and through the plugin host; on a first
        # turn conversation_history already holds the user's message and parent_session_id is "".
        first = {"session_id": "20261112_112700_c19c87", "task_id": "t", "turn_id": "u",
                 "user_message": "Make a small budget spreadsheet", "model": "m", "platform": "desktop",
                 "conversation_history": [{"role": "user", "content": "Make a small budget spreadsheet"}],
                 "is_first_turn": True, "parent_session_id": "", "sender_id": ""}
        self.assertEqual(self.p._view_context(**first), {"context": self.p.ROUTE_HINT})
        self.assertIsNone(self.p._view_context(**{**first, "is_first_turn": False}))

    def test_routing_is_one_system_prompt_section(self):
        got = []

        class Ctx:
            def register_system_prompt_section(self, id, content, *, position="after_memory", max_chars=4000):
                got.append((id, content, position, max_chars))

        self.assertTrue(self.p._register_route(Ctx()))
        (sid, content, position, max_chars), = got
        self.assertEqual((sid, position, max_chars), ("artifacts", "after_memory", 300))
        self.assertIs(content, self.p._route_section)
        line = self.p.ROUTE_LINE
        self.assertEqual(self.p.ROUTE_HINT, "[" + line + "]")  # the 0.16.3 line, word for word
        self.assertLessEqual(len(line), 180)
        for word in ("sheet", "deck", "board", "dashboard", "ha_guide", "ha_publish", "file format"):
            self.assertIn(word, line)
        self.assertFalse(self.p._register_route(object()))  # a Hermes without sections: the hint routes

        class Again:  # a reload in one process: Hermes says it is registered already, and it stands
            owner = "hermes-artifacts"

            def register_system_prompt_section(self, *a, **kw):
                raise ValueError(f"system prompt section 'artifacts' is already registered by plugin {self.owner!r}")

        self.assertTrue(self.p._register_route(Again()))
        other = Again()
        other.owner = "x"  # another plugin's section of that id is not ours: the hint routes
        self.assertFalse(self.p._register_route(other))

    def test_the_section_reaches_chats_a_person_makes_things_in_only(self):
        info = {"session_id": "s", "conversation_id": "c", "model": "m", "provider": "p", "profile_name": "default",
                "cwd": "", "client": "", "client_version": ""}
        for platform in ("desktop", "cli", "tui", "webui", "local", ""):
            self.assertEqual(self.p._route_section({**info, "platform": platform}), self.p.ROUTE_LINE, platform)
        for platform in ("subagent", "cron", "telegram", "discord", "slack", "whatsapp", "signal", "matrix",
                         "email", "sms", "api_server"):
            self.assertEqual(self.p._route_section({**info, "platform": platform}), "", platform)
        self.assertEqual(self.p._route_section({}), self.p.ROUTE_LINE)

    def test_the_messaging_platforms_are_hermes_own_list(self):
        try:
            from gateway.config import Platform
        except Exception:
            self.skipTest("Hermes' gateway is not importable here: the copy in the plugin is used")
        self.assertEqual(self.p._MESSAGING, {p.value for p in Platform} - {"local"})

    def test_the_route_switch(self):
        old, section_ok = os.environ.get("HERMES_ARTIFACTS_ROUTE"), self.p._section_ok
        first = {"session_id": "sess-switch", "is_first_turn": True, "parent_session_id": "", "platform": "desktop"}
        try:
            self.p._section_ok = True
            for mode, section, hint in (("section", True, False), ("", True, False), ("bogus", True, False),
                                        ("hint", False, True), ("HINT", False, True), ("none", False, False)):
                os.environ["HERMES_ARTIFACTS_ROUTE"] = mode
                self.assertEqual(self.p._route_section({"platform": "desktop"}),
                                 self.p.ROUTE_LINE if section else "", mode)
                self.assertEqual(self.p._view_context(**first),
                                 {"context": self.p.ROUTE_HINT} if hint else None, mode)
            self.p._section_ok = False  # a Hermes without sections: "section" falls back to the hint
            os.environ["HERMES_ARTIFACTS_ROUTE"] = "section"
            self.assertEqual(self.p._view_context(**first), {"context": self.p.ROUTE_HINT})
            os.environ["HERMES_ARTIFACTS_ROUTE"] = "none"
            self.assertIsNone(self.p._view_context(**first))
        finally:
            self.p._section_ok = section_ok
            if old is None:
                os.environ.pop("HERMES_ARTIFACTS_ROUTE", None)
            else:
                os.environ["HERMES_ARTIFACTS_ROUTE"] = old
