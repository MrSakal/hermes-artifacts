"""What the viewer's title menu calls: the artifact with its size, Duplicate and Rename."""

import os
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, store  # noqa: E402


class ViewerApiTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(path=str(ROOT / "examples" / "dashboard"), title="Orders", type="dashboard",
                                 session="20261106_x")["id"]

    def test_one_artifact_carries_its_size(self):
        r = api.handle("GET", f"artifacts/{self.aid}", {}, None)
        self.assertGreater(r["size"], 500)
        self.assertEqual(r["session"], "20261106_x")

    def test_duplicate_copies_files_type_and_chat(self):
        r = api.handle("POST", f"artifacts/{self.aid}/duplicate", {}, {})
        self.assertNotEqual(r["id"], self.aid)
        self.assertEqual((r["title"], r["type"], r["session"], r["version"]), ("Orders (copy)", "dashboard", "20261106_x", 1))
        self.assertEqual(store.list_files(r["id"]), store.list_files(self.aid))

    def test_rename(self):
        self.assertEqual(api.handle("POST", f"artifacts/{self.aid}/meta", {}, {"title": "Orders ✓"})["title"], "Orders ✓")


class ChatTests(unittest.TestCase):
    """Claude's Chat: the artifact's chat while it exists and isn't archived, else a new one it moves to."""

    def setUp(self):
        self.aid = store.publish(html="<p>x</p>", title="P", session="s-old")["id"]

    def fake_db(self, rows):
        import types
        class DB:
            def __init__(self, read_only=False):
                assert read_only
            def get_session_list_row(self, sid):
                return rows.get(sid)
            def close(self):
                pass
        mod = types.ModuleType("hermes_state")
        mod.SessionDB = DB
        return mock.patch.dict(sys.modules, {"hermes_state": mod})

    def test_status(self):
        with self.fake_db({"s-old": {"id": "s-old", "archived": 0}}):
            self.assertEqual(api.handle("GET", f"artifacts/{self.aid}/chat", {}, None),
                             {"session": "s-old", "known": True, "exists": True, "archived": False})
        with self.fake_db({"s-old": {"id": "s-old", "archived": 1}}):
            self.assertTrue(api.handle("GET", f"artifacts/{self.aid}/chat", {}, None)["archived"])
        with self.fake_db({}):
            self.assertFalse(api.handle("GET", f"artifacts/{self.aid}/chat", {}, None)["exists"])

    def test_moves_to_the_new_chat(self):
        self.assertEqual(api.handle("POST", f"artifacts/{self.aid}/meta", {}, {"session": "s-new"})["session"], "s-new")
        with self.assertRaises(api.ApiError):
            api.handle("POST", f"artifacts/{self.aid}/meta", {}, {"session": "../x y"})

    def test_a_page_cannot_relink(self):
        with self.assertRaises(api.ApiError):
            api.handle("POST", f"artifacts/{self.aid}/op", {}, {"op": "meta", "args": {"session": "s-evil"}})
        self.assertEqual(store.get_meta(self.aid)["session"], "s-old")


if __name__ == "__main__":
    unittest.main()
