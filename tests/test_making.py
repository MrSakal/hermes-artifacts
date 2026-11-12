"""The "being made" state: Hermes read a type's guide in a chat, Desktop may open the pane before the publish."""

import json
import os
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api  # noqa: E402
from test_types import load_plugin  # noqa: E402


def sid():
    return "s-" + uuid.uuid4().hex[:12]


class StoreMakingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()
        cls.store = cls.p.store

    def test_set_get_clear(self):
        s = sid()
        st = self.store.making_set(s, "slides", "guide")
        self.assertEqual((st["session"], st["type"], st["phase"]), (s, "slides", "guide"))
        self.assertEqual(self.store.making_get(s)["type"], "slides")
        self.assertIn(s, self.store.making_all())
        self.assertEqual(self.store.making_clear(s)["type"], "slides")
        self.assertIsNone(self.store.making_get(s))
        self.assertIsNone(self.store.making_clear(s))  # nothing left: no write, None

    def test_start_kept_for_same_type_reset_for_another(self):
        s = sid()
        first = self.store.making_set(s, "page", "guide")["started"]
        time.sleep(0.01)
        self.assertEqual(self.store.making_set(s, "page", "guide", title="T")["started"], first)
        self.assertEqual(self.store.making_get(s)["title"], "T")
        self.assertGreater(self.store.making_set(s, "dashboard", "guide")["started"], first)
        self.store.making_clear(s)

    def test_stale_is_gone(self):
        s = sid()
        self.store.making_set(s, "design", "guide")
        old = self.store.MAKING_TTL_S
        self.store.MAKING_TTL_S = -1
        try:
            self.assertIsNone(self.store.making_get(s))
            self.assertNotIn(s, self.store.making_all())
            self.assertIsNone(self.store.making_clear(s))
        finally:
            self.store.MAKING_TTL_S = old

    def test_refuses_bad_input(self):
        with self.assertRaises(ValueError):
            self.store.making_set("", "page", "guide")
        with self.assertRaises(ValueError):
            self.store.making_set(sid(), "nope", "guide")
        self.assertIsNone(self.store.making_get(""))

    def test_broken_file_reads_as_empty(self):
        self.store._making_path().write_text("{not json", encoding="utf-8")
        self.assertEqual(self.store.making_all(), {})
        s = sid()
        self.store.making_set(s, "page", "guide")  # and is replaced by the next write
        self.assertIsNotNone(self.store.making_get(s))
        self.store.making_clear(s)


class _Events(unittest.TestCase):
    """The plugin with its broadcasts recorded."""
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def setUp(self):
        self.events = []
        self._real = self.p._broadcast
        self.p._broadcast = lambda event, payload: self.events.append((event, payload)) or True

    def tearDown(self):
        self.p._broadcast = self._real

    def named(self, name):
        return [p for e, p in self.events if e == name]


class PluginMakingTests(_Events):

    def test_guide_starts_publish_ends_then_opens(self):
        s = sid()
        before = json.loads(self.p._guide({"type": "page"}))
        self.events.clear()
        out = json.loads(self.p._guide({"type": "page"}, session_id=s))
        self.assertEqual(set(out), set(before))  # the agent reads exactly what it read before
        m = self.named("making")
        self.assertEqual(len(m), 1)
        self.assertEqual((m[0]["session"], m[0]["type"], m[0]["phase"]), (s, "page", "guide"))
        self.assertIn("started", m[0])
        self.assertNotIn("at", m[0])
        self.assertEqual(self.p.store.making_get(s)["phase"], "guide")

        res = json.loads(self.p._publish({"type": "page", "title": "Hello", "html": "<p>hi</p>"}, session_id=s))
        self.assertTrue(res["ok"])
        self.assertNotIn("session", res)  # the tool result is unchanged
        self.assertNotIn("making", res)
        names = [e for e, _ in self.events]
        self.assertEqual(names[-2:], ["making", "open"])  # done, then the existing open
        done = self.named("making")[-1]
        self.assertEqual((done["phase"], done["id"], done["title"], done["type"]), ("done", res["id"], "Hello", "page"))
        self.assertEqual(done["started"], m[0]["started"])
        self.assertEqual(self.named("open")[-1]["session"], s)
        self.assertIsNone(self.p.store.making_get(s))

    def test_publish_without_making_sends_no_making(self):
        s = sid()
        json.loads(self.p._publish({"type": "page", "title": "x", "html": "<p>x</p>"}, session_id=s))
        self.assertEqual(self.named("making"), [])
        self.assertEqual(self.named("open")[-1]["session"], s)

    def test_failed_publish_keeps_making(self):
        s = sid()
        self.p._guide({"type": "slides"}, session_id=s)
        res = json.loads(self.p._publish({"type": "slides", "title": "x"}, session_id=s))  # no content
        self.assertFalse(res["ok"])
        self.assertEqual(self.p.store.making_get(s)["type"], "slides")
        self.p.store.making_clear(s)

    def test_topic_read_keeps_it_going(self):
        s = sid()
        self.p._guide({"type": "dashboard"}, session_id=s)
        started = self.p.store.making_get(s)["started"]
        self.p._guide({"type": "dashboard", "topic": "no-such-topic"}, session_id=s)
        self.assertEqual(self.p.store.making_get(s)["started"], started)
        self.p.store.making_clear(s)

    def test_no_session_no_state(self):
        self.p._guide({"type": "page"})
        self.p._publish({"type": "page", "title": "x", "html": "<p>x</p>", "open": False})
        self.assertEqual(self.named("making"), [])
        self.assertEqual(self.named("open"), [])

    def test_bad_type_starts_nothing(self):
        s = sid()
        self.p._guide({"type": "nope"}, session_id=s)
        self.assertIsNone(self.p.store.making_get(s))

    def test_turn_end_ends_it(self):
        s = sid()
        self.p._guide({"type": "motion"}, session_id=s)
        self.p._turn_end(session_id=s, completed=True, interrupted=False)
        end = self.named("making")[-1]
        self.assertEqual((end["session"], end["phase"], end["type"]), (s, "ended", "motion"))
        self.assertIsNone(self.p.store.making_get(s))
        n = len(self.events)
        self.p._turn_end(session_id=s)  # nothing open: silent
        self.p._turn_end()
        self.assertEqual(len(self.events), n)

    def test_next_turn_ends_a_left_one(self):
        s = sid()
        self.p._guide({"type": "design"}, session_id=s)
        self.assertIsNone(self.p._view_context(session_id=s, is_first_turn=False))
        self.assertEqual(self.named("making")[-1]["phase"], "ended")
        self.assertIsNone(self.p.store.making_get(s))

    def test_register_adds_the_turn_end_hook(self):
        hooks = {}

        class Ctx:
            def register_hook(self, name, fn):
                hooks[name] = fn

            def register_tool(self, **kw):
                pass

            def register_cli_command(self, *a, **kw):
                pass

            def get_config(self, key):
                return None

        self.p.register(Ctx())
        self.assertIs(hooks["on_session_end"], self.p._turn_end)
        self.assertIs(hooks["post_compaction"], self.p._compacted)
        self.assertIs(hooks["pre_llm_call"], self.p._view_context)


class PublishFlagTests(_Events):
    def test_done_says_when_no_open_follows(self):
        s = sid()
        self.p._guide({"type": "page"}, session_id=s)
        self.p._publish({"type": "page", "title": "q", "html": "<p>q</p>", "open": False}, session_id=s)
        self.assertEqual(self.named("open"), [])
        done = self.named("making")[-1]
        self.assertEqual((done["phase"], done["open"]), ("done", False))
        self.p._guide({"type": "page"}, session_id=s)
        self.p._publish({"type": "page", "title": "q", "html": "<p>q</p>"}, session_id=s)
        self.assertNotIn("open", self.named("making")[-1])


class CompressedChatTests(_Events):
    def test_artifacts_and_making_follow_the_chat(self):
        old, new = sid(), sid()
        a = json.loads(self.p._publish({"type": "page", "title": "c", "html": "<p>c</p>"}, session_id=old))["id"]
        other = json.loads(self.p._publish({"type": "page", "title": "o", "html": "<p>o</p>"}, session_id=sid()))["id"]
        self.p._guide({"type": "slides"}, session_id=old)
        self.events.clear()
        self.p._compacted(session_id=new, old_session_id=old, kind="auto", reason="threshold")
        st = self.p.store
        self.assertEqual(st.get_meta(a)["session"], new)
        self.assertNotEqual(st.get_meta(other)["session"], new)
        self.assertIsNone(st.making_get(old))
        self.assertEqual(st.making_get(new)["type"], "slides")
        self.assertTrue(any(k[:2] == (new, a) for k in self.p._SEEN))
        self.assertTrue(any(k[:2] == (old, a) for k in self.p._SEEN))  # kept too: the turn in flight calls with it
        self.assertEqual(self.named("moved"), [{"old": old, "new": new}])
        st.making_clear(new)

    def test_same_id_or_nothing_there_is_quiet(self):
        s = sid()
        self.p._compacted(session_id=s, old_session_id=s)
        self.p._compacted(session_id=sid(), old_session_id=sid())
        self.p._compacted(session_id=s)
        self.assertEqual(self.named("moved"), [])
        self.assertEqual(self.p.store.repoint_session("a", "bad id!"), [])

    def test_start_pass_follows_past_compressions(self):
        old, new = sid(), sid()
        a = json.loads(self.p._publish({"type": "page", "title": "p", "html": "<p>p</p>"}, session_id=old))["id"]
        import types
        fake = types.ModuleType("hermes_state")

        class SessionDB:
            def __init__(self, read_only=False):
                self.read_only = read_only

            def get_compression_tip(self, session_id):
                return new if session_id == old else session_id

            def close(self):
                pass

        fake.SessionDB = SessionDB
        real = sys.modules.get("hermes_state")
        sys.modules["hermes_state"] = fake
        try:
            self.assertGreaterEqual(self.p._follow_compressed_now(), 1)
        finally:
            if real is None:
                sys.modules.pop("hermes_state", None)
            else:
                sys.modules["hermes_state"] = real
        self.assertEqual(self.p.store.get_meta(a)["session"], new)


class ApiMakingTests(unittest.TestCase):
    def test_read_back(self):
        store = api.store
        s = sid()
        store.making_set(s, "sheet", "guide")
        self.assertEqual(api.handle("GET", "making", {"session": s}, None)["making"]["type"], "sheet")
        self.assertIn(s, api.handle("GET", "making", {}, None)["making"])
        self.assertIn(s, api.handle("GET", "artifacts", {}, None)["making"])
        store.making_clear(s)
        self.assertIsNone(api.handle("GET", "making", {"session": s}, None)["making"])


if __name__ == "__main__":
    unittest.main()
