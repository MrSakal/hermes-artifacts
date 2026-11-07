"""Trash retention: each deleted artifact is purged N days after its own deletion."""

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import store  # noqa: E402


class TrashTests(unittest.TestCase):
    def _trash(self, title, deleted_days_ago):
        aid = store.publish(title=title, html="<p>x</p>")["id"]
        dest = store.delete(aid)
        mark = dest / store.TRASH_MARK
        data = json.loads(mark.read_text(encoding="utf-8"))
        data["deleted_at"] = time.time() - deleted_days_ago * 86400
        mark.write_text(json.dumps(data), encoding="utf-8")
        return dest

    def test_each_item_counts_from_its_own_deletion(self):
        old = self._trash("old", 31)
        recent = self._trash("recent", 29)
        purged = store.purge_trash(30)
        self.assertIn(old.name, purged)
        self.assertFalse(old.exists())
        self.assertTrue(recent.exists())
        self.assertEqual(store.purge_trash(30), [])
        # 1 more day later the recent one goes too
        self.assertIn(recent.name, store.purge_trash(30, now=time.time() + 2 * 86400))

    def test_zero_keeps_everything_and_mark_records_title(self):
        item = self._trash("Keep me", 400)
        self.assertEqual(store.purge_trash(0), [])
        self.assertTrue(item.exists())
        listed = [t for t in store.trash_list() if t["name"] == item.name][0]
        self.assertEqual(listed["title"], "Keep me")
        store.purge_trash(30)

    def test_old_items_without_a_mark_use_the_folder_time(self):
        trash = store.root() / ".trash"
        trash.mkdir(exist_ok=True)
        legacy = trash / f"legacy-abc123-{int(time.time() - 40 * 86400)}"
        legacy.mkdir()
        (legacy / "meta.json").write_text("{}", encoding="utf-8")
        self.assertIn(legacy.name, store.purge_trash(30))

    def test_deleting_twice_in_one_second_keeps_both(self):
        a = store.publish(title="same", html="x", aid="same-name-01")["id"]
        d1 = store.delete(a)
        store.publish(title="same", html="x", aid="same-name-01")
        d2 = store.delete(a)
        self.assertNotEqual(d1, d2)
        self.assertTrue(d1.exists() and d2.exists())


if __name__ == "__main__":
    unittest.main()
