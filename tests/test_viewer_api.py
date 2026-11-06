"""What the viewer's title menu calls: the artifact with its size, Duplicate and Rename."""

import os
import sys
import tempfile
import unittest
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
        self.assertEqual(api.handle("POST", f"artifacts/{self.aid}/meta", {}, {"title": "Megrendelések"})["title"], "Megrendelések")


if __name__ == "__main__":
    unittest.main()
