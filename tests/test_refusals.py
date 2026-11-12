"""Fix-it refusals: every tool refuses in one shape ("<Outcome>: <why>. Next: <call>. Don't <x>.", ok
false, a code, payloads beside), and an identical resend of a refused call is answered without running."""

import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import boards, docs, live, sheets, store  # noqa: E402
from test_types import load_plugin  # noqa: E402

SHAPE = re.compile(r"^Nothing was (published|changed|posted|deleted|written|read|opened|copied): .+\.$", re.S)


class _Plugin(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def setUp(self):
        self.p._REFUSED.clear()

    def shape(self, out: str, code: str | None = None) -> dict:
        r = json.loads(out)
        self.assertEqual(list(r)[:2], ["error", "ok"], r)  # error first: Hermes' spill preview shows it
        self.assertIs(r["ok"], False)
        self.assertRegex(r["error"], SHAPE)
        self.assertLessEqual(len(r["error"]), self.p.ERROR_MAX)
        self.assertTrue(r.get("code"), r)
        if code:
            self.assertEqual(r["code"], code, r)
        return r


class ExceptionTests(_Plugin):
    """Each kind of exception a handler raises, worded by the one wrapper."""

    def run_raising(self, exc, args=None, name="ha_read", outcome="Nothing was read", **kw):
        @self.p._tool(name, outcome)
        def handler(a, **_kw):
            raise exc
        return handler(args if args is not None else {"id": "some-art"}, **kw)

    def test_refusal_carries_why_next_dont_and_payload(self):
        r = self.shape(self.run_raising(self.p.Refusal("the deck has no slides", next="add one to deck.json",
                                                       dont="resend the same files", code="empty",
                                                       live={"version": 3})), "empty")
        self.assertEqual(r["error"], "Nothing was read: the deck has no slides. Next: add one to deck.json. "
                                     "Don't resend the same files.")
        self.assertEqual(r["live"], {"version": 3})
        self.assertNotIn("detail", r)

    def test_a_refusal_may_name_its_own_outcome(self):
        r = self.shape(self.run_raising(self.p.Refusal("x", outcome="Nothing was copied")))
        self.assertTrue(r["error"].startswith("Nothing was copied: x."))

    def test_not_found(self):
        r = self.shape(self.run_raising(self.p.store.no_artifact("gone-1")), "not_found")
        self.assertEqual(r["error"], "Nothing was read: no artifact 'gone-1'. Next: ha_list for ids.")
        self.assertIsInstance(self.p.store.no_artifact("x"), FileNotFoundError)  # the web API's 404
        self.assertIsInstance(self.p.Refusal("x"), ValueError)  # the web API's 400

    def test_path_refused(self):
        e = self.p.store.PathRefused("x is outside the working directory w")
        e.next = "path= a file in the working directory"
        r = self.shape(self.run_raising(e), "path_refused")
        self.assertIn("outside the working directory", r["error"])
        self.assertIn("Next: path=", r["error"])

    def test_the_live_modules_errors(self):
        r = self.shape(self.run_raising(docs.DocError("absent", "no tab 'x'")), "not_found")
        self.assertIn("no tab 'x'. Next: ha_live_read id=some-art", r["error"])
        r = self.shape(self.run_raising(sheets.SheetError("conflict", "read it again", rev=7, cells=["B2"]),
                                        {"id": "some-art", "ops": [{"op": "x"}]}, name="ha_live_edit",
                                        outcome="Nothing was changed"), "conflict")
        self.assertEqual((r["conflict"], r["rev"], r["cells"]), (True, 7, ["B2"]))
        r = self.shape(self.run_raising(boards.BoardError("invalid", "items[0].type: unknown")), "invalid")
        self.assertIn("Next: fix that and call again", r["error"])
        r = self.shape(self.run_raising(live.LiveError("refused", "only SELECT")), "refused")
        self.assertIn("only SELECT", r["error"])

    def test_a_missing_argument_in_words_hermes_uses(self):
        r = self.shape(self.run_raising(KeyError("text"), name="ha_comments", outcome="Nothing was posted"),
                       "missing_argument")
        self.assertIn("ha_comments is missing required argument(s): text. The tool was NOT invoked", r["error"])

    def test_a_key_error_of_the_plugin_is_not_a_missing_argument(self):
        r = self.shape(self.run_raising(KeyError("id")), "error")  # "id" was passed: not the caller's
        self.assertIn("KeyError", r["error"])

    def test_value_error(self):
        r = self.shape(self.run_raising(ValueError("rows must be a list")), "invalid")
        self.assertEqual(r["error"], "Nothing was read: rows must be a list. Next: fix that and call again.")

    def test_a_plain_file_not_found(self):
        r = self.shape(self.run_raising(FileNotFoundError("some-art")), "not_found")
        self.assertIn("no artifact 'some-art'", r["error"])
        r = self.shape(self.run_raising(FileNotFoundError("x.json")), "not_found")
        self.assertIn("not found: x.json", r["error"])

    def test_storage_error_is_the_hosts_not_the_callers(self):
        r = self.shape(self.run_raising(PermissionError("disk is locked")), "storage_error")
        self.assertIn("a storage error on the Hermes host, not your call: disk is locked", r["error"])
        self.assertIn("Next: try once; if it fails again tell the user.", r["error"])
        self.assertIn("Don't change the content to get around it.", r["error"])

    def test_anything_else(self):
        r = self.shape(self.run_raising(TypeError("'int' object is not iterable")), "error")
        self.assertIn("TypeError: 'int' object is not iterable", r["error"])

    def test_a_long_why_is_cut_in_error_and_whole_in_detail(self):
        why = "bad: " + "x" * 2000
        r = self.shape(self.run_raising(ValueError(why)))
        self.assertEqual(len(r["error"]), self.p.ERROR_MAX)
        self.assertIn("…. Next: fix that and call again.", r["error"])
        self.assertEqual(r["detail"], why)

    def test_merging_two_refusals(self):
        a = self.p.Refusal("v7 is newer than v5", next="merge onto live", code="stale_version", live={"version": 7})
        b = self.p.Refusal("this type's rules weren't read", next="follow guide", code="guide_first", guide="…")
        r = self.shape(self.run_raising(self.p._merge_refusals(a, b), name="ha_publish",
                                        outcome="Nothing was published"), "stale_version")
        self.assertEqual((r["live"], r["guide"]), ({"version": 7}, "…"))
        self.assertIn("v7 is newer than v5; also this type's rules weren't read", r["error"])
        self.assertIn("Next: follow guide.", r["error"])


class ResendTests(_Plugin):
    def setUp(self):
        super().setUp()
        self.page = store.publish(title="r", html="<p>x</p>")["id"]
        self.p._read({"id": self.page}, task_id="task-1", session_id="sess-1")  # seen: not refused as unread

    def bad(self, **kw):
        # A page's type can't change: refused for what it asks, until something changes.
        return self.p._publish({"id": self.page, "type": "dashboard", "files": {"dashboard.json": {}},
                                "open": False, **kw}, task_id="task-1", session_id="sess-1")

    def test_the_same_call_again_is_answered_without_running(self):
        first = self.shape(self.bad())
        self.assertIn("its type can't change", first["error"])
        calls = []
        real = self.p.store.publish
        self.p.store.publish = lambda **k: calls.append(k) or real(**k)
        try:
            again = self.shape(self.bad(open=True), "repeated_call")  # open does not make it another call
        finally:
            self.p.store.publish = real
        self.assertEqual(calls, [])
        self.assertEqual(again["refused_code"], first["code"])
        self.assertTrue(again["error"].startswith("Nothing was published: this is the call just refused, and "
                                                  "nothing it depends on changed ("))
        self.assertIn("its type can't change", again["error"])
        self.assertIn("Next: leave type out", again["error"])
        self.assertTrue(again["error"].endswith("Don't send it unchanged again."))
        third = self.shape(self.bad(), "repeated_call")
        self.assertIn("stop and tell the user", third["error"])
        self.assertNotIn("Next:", third["error"])

    def test_payloads_are_not_sent_again(self):
        @self.p._tool("ha_read", "Nothing was read")
        def handler(a, **kw):
            raise self.p.Refusal("old", next="x", live={"content": "big"})
        self.assertIn("live", json.loads(handler({"id": self.page}, task_id="t-pay")))
        self.assertNotIn("live", json.loads(handler({"id": self.page}, task_id="t-pay")))

    def test_a_change_to_the_target_runs_it_again(self):
        self.shape(self.bad())
        store.publish(aid=self.page, html="<p>y</p>")  # a new version: what the refusal depended on moved
        self.assertNotEqual(json.loads(self.bad())["code"], "repeated_call")

    def test_other_arguments_run_again_and_a_success_clears_it(self):
        self.shape(self.bad())
        ok = json.loads(self.p._publish({"id": self.page, "html": "<p>z</p>", "open": False},
                                        task_id="task-1", session_id="sess-1"))
        self.assertTrue(ok["ok"], ok)
        self.assertNotIn(("task-1", "ha_publish"), self.p._REFUSED)

    def test_without_a_chat_nothing_is_remembered(self):
        for _ in range(3):
            r = json.loads(self.p._publish({"id": self.page, "type": "dashboard", "files": {"dashboard.json": {}},
                                            "open": False}))
            self.assertEqual(r["code"], "refused")
        self.assertEqual(len(self.p._REFUSED), 0)

    def test_chats_and_tools_are_apart(self):
        self.shape(self.bad())
        other = json.loads(self.p._publish({"id": self.page, "type": "dashboard", "files": {"dashboard.json": {}},
                                            "open": False}, task_id="task-2"))
        self.assertEqual(other["code"], "would_delete")  # task-2 never saw index.html: its own refusal, not a repeat

    def test_a_storage_error_may_be_tried_again(self):
        n = []

        @self.p._tool("ha_read", "Nothing was read")
        def handler(a, **kw):
            n.append(1)
            raise OSError("busy")
        for _ in range(2):
            self.shape(handler({"id": self.page}, task_id="t-io"), "storage_error")
        self.assertEqual(len(n), 2)

    def test_a_fixed_file_at_the_same_path_runs(self):
        work = Path(tempfile.mkdtemp(prefix="ha-refusal-work-"))
        self.addCleanup(shutil.rmtree, work, True)

        class Ctx:
            def session_cwd(self):
                return str(work)

            def get_config(self, key):
                return None

        self.p._ctx = Ctx()
        self.addCleanup(setattr, self.p, "_ctx", None)
        call = {"path": "page.html", "title": "f", "open": False}
        self.shape(self.p._publish(dict(call), task_id="t-path"), "not_found")
        (work / "page.html").write_text("<p>fixed</p>", "utf-8")
        r = json.loads(self.p._publish(dict(call), task_id="t-path"))
        self.assertTrue(r["ok"], r)

    def test_a_stale_refusal_is_not_held_back_as_a_repeat(self):
        store.publish(aid=self.page, html="<p>theirs</p>", by="user")
        call = {"id": self.page, "html": "<p>mine</p>", "open": False}
        r = self.shape(self.p._publish(dict(call), task_id="t-seen", session_id="s-seen"), "stale_version")
        self.assertEqual(r["live"]["content"], {"index.html": "<p>theirs</p>"})
        self.assertIn("the same files again replace those changes", r["error"])
        # It was shown what it replaces: the same call now runs (as write_file after a read), never a loop.
        self.assertNotIn(("t-seen", "ha_publish"), self.p._REFUSED)
        self.assertTrue(json.loads(self.p._publish(dict(call), task_id="t-seen", session_id="s-seen"))["ok"])

    def test_the_memory_is_bounded(self):
        @self.p._tool("ha_read", "Nothing was read")
        def handler(a, **kw):
            raise self.p.Refusal("no")
        for i in range(self.p._REFUSED_MAX + 10):
            handler({"id": "x"}, task_id=f"t-{i}")
        self.assertEqual(len(self.p._REFUSED), self.p._REFUSED_MAX)

    def test_more_state_can_join_the_fingerprint(self):
        state = {"guided": False}
        fp = lambda tool, args, kw: state["guided"]  # noqa: E731
        self.p.FINGERPRINTS.append(fp)
        self.addCleanup(self.p.FINGERPRINTS.remove, fp)
        self.shape(self.bad())
        state["guided"] = True
        self.assertEqual(json.loads(self.bad())["code"], "refused")


class EveryToolTests(_Plugin):
    """All 14 tools: a missing required argument and an unknown id come back in the helper's shape."""

    def test_the_fourteen_tools(self):
        self.assertEqual(len(self.p.TOOLS), 14)
        handlers = {name: h for name, _s, h, _e in self.p.TOOLS}
        required = {name: s["parameters"]["required"] for name, s, _h, _e in self.p.TOOLS}
        unknown = {
            "ha_publish": {"id": "Not An Id!", "html": "<p>x</p>"},  # any free id makes a new one
            "ha_check": {"id": "no-such-art", "wait": 0},
            "ha_design_system_get": {"id": "no-such-art"},
            "ha_design_system_export": {"id": "no-such-art", "dir": "ds"},
            "ha_guide": {"type": "no-such-type"},
            "ha_live_read": {"id": "no-such-art"},
            "ha_live_edit": {"id": "no-such-art", "ops": [{"op": "delete", "block": "b"}]},
            "ha_list": None,  # takes no id
            "ha_read": {"id": "no-such-art"},
            "ha_open": {"id": "no-such-art"},
            "ha_inbox": {"id": "no-such-art"},
            "ha_delete": {"id": "no-such-art"},
            "ha_comments": {"id": "no-such-art"},
            "ha_reply": {"id": "no-such-art", "request": "r-1"},
        }
        self.assertEqual(set(unknown), set(handlers))
        for name, h in handlers.items():
            with self.subTest(tool=name, case="missing"):
                if name == "ha_guide":  # type left out: the page guide, as before
                    self.assertEqual(json.loads(h({}))["type"], "page")
                elif required[name]:
                    r = self.shape(h({}), "missing_argument")
                    self.assertIn(f"{name} is missing required argument(s): {', '.join(required[name])}. "
                                  "The tool was NOT invoked", r["error"])
                elif name == "ha_publish":  # nothing required, but it needs content
                    self.assertIn("exactly one of html, path or files", self.shape(h({}))["error"])
                else:  # nothing required, nothing needed: it answers
                    self.assertTrue(json.loads(h({}))["ok"])
            with self.subTest(tool=name, case="unknown id"):
                if unknown[name] is None:
                    continue
                r = self.shape(h(dict(unknown[name])))
                self.assertIn(r["code"], ("not_found", "bad_id"), r)
                self.assertIn("Next: ", r["error"])


if __name__ == "__main__":
    unittest.main()
