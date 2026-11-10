"""Regression tests for the Python cleanup: the bundle's folder check and the caches added for speed."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, bundle, docs, sheets, store  # noqa: E402


class BundleContainmentTests(unittest.TestCase):
    def test_a_version_cannot_inline_a_sibling_folder_sharing_its_prefix(self):
        # <dir>/v1 and <dir>/v10: "../v10/x.js" resolves outside v1 although its path starts with ".../v1".
        top = Path(tempfile.mkdtemp(prefix="hermes-bundle-"))
        (top / "v1").mkdir()
        (top / "v10").mkdir()
        (top / "v10" / "x.js").write_text("SECRET()", encoding="utf-8")
        (top / "v1" / "a.js").write_text("OWN()", encoding="utf-8")
        (top / "v1" / "index.html").write_text(
            '<html><head><script src="../v10/x.js"></script><script src="a.js"></script></head></html>', encoding="utf-8")
        out = bundle.bundle(top / "v1", "index.html")
        self.assertNotIn("SECRET()", out)
        self.assertIn('src="../v10/x.js"', out)
        self.assertIn("OWN()", out)


class CacheTests(unittest.TestCase):
    def test_walk_files_matches_rglob(self):
        m = store.publish(files={"index.html": "<p>x</p>", "b/c.txt": "1", "b/d/e.txt": "2", "a-b.txt": "3",
                                 "z.txt": "4"}, title="walk")
        vdir = store.version_dir(m["id"])
        want = [f.relative_to(vdir).as_posix() for f in vdir.rglob("*") if f.is_file()]
        self.assertEqual([rel for rel, _ in store.walk_files(vdir)], want)
        self.assertEqual(sum(e.stat().st_size for _, e in store.walk_files(vdir)),
                         sum(f.stat().st_size for f in vdir.rglob("*") if f.is_file()))

    def test_gallery_follows_meta_and_comment_changes(self):
        m = store.publish(html="<p>x</p>", title="Before")
        aid = m["id"]

        def card():
            return next(a for a in api.handle("GET", "artifacts", {}, None)["artifacts"] if a["id"] == aid)

        self.assertEqual((card()["title"], card()["comments"]), ("Before", 0))
        store.update_meta(aid, title="After")
        c = store.comment_add(aid, "a note")
        store.comment_add(aid, "Hermes' reply", author="hermes", parent=c["id"])
        self.assertEqual((card()["title"], card()["comments"]), ("After", 1))
        store.comment_resolve(aid, c["id"])
        self.assertEqual(card()["comments"], 0)
        store.update_meta(aid, pinned=True)
        self.assertTrue(card()["pinned"])
        store.delete(aid)
        self.assertFalse(any(a["id"] == aid for a in store.list_all()))

    def test_list_all_hands_out_copies(self):
        m = store.publish(html="<p>x</p>", title="Copy")
        next(x for x in store.list_all() if x["id"] == m["id"])["title"] = "changed by a caller"
        self.assertEqual(next(x for x in store.list_all() if x["id"] == m["id"])["title"], "Copy")

    def test_doc_history_survives_the_cache(self):
        aid = store.publish(files={"doc.md": "one\n\ntwo"}, title="h", type="doc")["id"]
        for i, by in enumerate(("user", "hermes", "user")):
            t = docs.load(aid)["tabs"][0]
            docs.apply(aid, [{"op": "replace", "block": t["blocks"][0]["id"], "md": f"v{i}"}], by=by, base_rev=t["rev"])
        revs = [s["rev"] for s in docs.history(aid)["snaps"]]
        self.assertEqual(revs, sorted(revs, reverse=True))
        self.assertEqual(len(revs), 4)  # the start, then one per author change
        first = revs[-1]
        self.assertEqual(docs.at_rev(aid, None, first)["blocks"][0]["md"], "one")
        docs.restore(aid, None, first)
        self.assertEqual(docs.read(aid)["blocks"][0]["md"], "one")
        self.assertEqual(len(docs.history(aid)["snaps"]), 5)

    def test_sheet_history_survives_the_cache(self):
        aid = store.publish(files={"sheet.json": {"sheets": [{"name": "S", "rows": [[1, 2]]}]}}, title="s", type="sheet")["id"]
        for i, by in enumerate(("user", "hermes", "user")):
            sh = sheets.load(aid)["sheets"][0]
            sheets.apply(aid, [{"op": "set", "range": "A1", "values": [[10 + i]]}], by=by, base_rev=sh["rev"])
        snaps = sheets.history(aid)["snaps"]
        self.assertEqual(len(snaps), 4)
        sheets.restore(aid, None, snaps[-1]["rev"])
        self.assertEqual(sheets.read(aid)["rows"], [[1, 2]])
        self.assertEqual(len(sheets.history(aid)["snaps"]), 5)

    def test_sheet_read_extent_unchanged(self):
        aid = store.publish(files={"sheet.json": {"sheets": [{"name": "S", "rows": [[1, None, 3], [None, "=A1"]]}]}},
                            title="e", type="sheet")["id"]
        r = sheets.read(aid, agent=True)
        self.assertEqual(r["range"], "A1:C2")
        self.assertEqual(r["rows"], [[1, None, 3], [None, "=A1"]])
        self.assertEqual((r["sheets"][0]["rows"], r["sheets"][0]["cols"]), (2, 3))


if __name__ == "__main__":
    unittest.main()
