"""Deleting is for good; what older versions left in .trash/ is emptied when the plugin starts."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import store  # noqa: E402


class DeleteTests(unittest.TestCase):
    def test_delete_is_for_good_and_drops_the_default(self):
        aid = store.publish(title="DS", html="<p>x</p>")["id"]
        store.publish(aid=aid, html="<p>y</p>")
        store.comment_add(aid, "note")
        store.settings_set("default_design_system", aid)
        store.delete(aid)
        self.assertFalse(store._dir(aid).exists())
        self.assertIsNone(store.settings().get("default_design_system"))
        self.assertFalse((store.root() / ".trash").exists())
        with self.assertRaises(FileNotFoundError):
            store.delete(aid)

    def test_the_old_trash_is_emptied(self):
        trash = store.root() / ".trash"
        trash.mkdir(exist_ok=True)
        for name in ("old-one-1700000000", "old-two-1790000000"):
            (trash / name).mkdir()
            (trash / name / "meta.json").write_text("{}", encoding="utf-8")
        gone = store.empty_trash()
        self.assertEqual(sorted(gone), ["old-one-1700000000", "old-two-1790000000"])
        self.assertFalse(trash.exists())
        self.assertEqual(store.empty_trash(), [])


if __name__ == "__main__":
    unittest.main()
