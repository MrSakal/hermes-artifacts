"""A doc's state and history on disk: one file per snapshot plus a small index (an edit writes its snapshot
and the index, never the whole history again), bounded by count and bytes, every listed snapshot restorable,
the old one-file history moved over without loss within the bounds; and the parsed state kept in memory
between polls, read again when another process wrote it, dropped when an edit fails."""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import docs, store  # noqa: E402


def new_doc(md="# T\n\none\n\ntwo"):
    return store.publish(title="H", type="doc", files={"doc.md": md})["id"]


def edit(aid, by, i=1, text=None, base=None):
    r = docs.read(aid)
    return docs.apply(aid, [{"op": "replace", "block": r["blocks"][i]["id"], "md": text or f"{by} {time.time()}"}],
                      by=by, base_rev=r["rev"] if base is None else base)


def snap_files(aid):
    d = docs._snaps_dir(aid)
    return sorted(int(p.name[:-5]) for p in d.iterdir()) if d.is_dir() else []


def all_restorable(tc, aid):
    listed = docs.history(aid)["snaps"]
    for s in listed:
        got = docs.at_rev(aid, None, s["rev"])
        tc.assertEqual((got["rev"], len(got["blocks"])), (s["rev"], s["blocks"]))
    return listed


class SnapshotFileTests(unittest.TestCase):
    def test_an_edit_writes_its_snapshot_and_the_index_only(self):
        aid = new_doc()
        edit(aid, "hermes")
        edit(aid, "user")
        files = snap_files(aid)
        self.assertEqual(len(files), 3)  # the start, hermes', the user's
        stamps = {f: os.stat(docs._snaps_dir(aid) / f"{f}.json").st_mtime_ns for f in files}
        time.sleep(0.02)
        edit(aid, "hermes")
        for f in files:  # nothing older written again
            self.assertEqual(os.stat(docs._snaps_dir(aid) / f"{f}.json").st_mtime_ns, stamps[f])
        self.assertEqual(len(snap_files(aid)), 4)
        self.assertFalse(docs._old_hist_path(aid).exists())
        all_restorable(self, aid)

    def test_a_burst_of_typing_replaces_its_snapshot_file(self):
        aid = new_doc()
        edit(aid, "user", text="a")
        n = len(snap_files(aid))
        edit(aid, "user", text="ab")
        edit(aid, "user", text="abc")
        self.assertEqual(len(snap_files(aid)), n)  # one snapshot for the burst, the replaced files gone
        self.assertEqual(docs.at_rev(aid, None, docs.read(aid)["rev"])["blocks"][1]["md"], "abc")

    def test_bounded_by_bytes_and_count_and_every_listed_one_restorable(self):
        aid = new_doc("# T\n\n" + "x" * 3000)
        with mock.patch.object(docs, "MAX_HIST_BYTES", 12_000), mock.patch.object(docs, "MAX_SNAPS", 50):
            for i in range(12):
                edit(aid, "hermes" if i % 2 else "user", text="y" * 3000 + str(i))
            listed = all_restorable(self, aid)
            self.assertLessEqual(sum(json.loads(docs._hist_path(aid).read_text("utf-8"))["snaps"][k]["bytes"]
                                     for k in range(len(listed))), 12_000 + 3100)
            self.assertLess(len(listed), 13)
            self.assertEqual(len(snap_files(aid)), len(listed))  # dropped ones are deleted
        with mock.patch.object(docs, "MAX_SNAPS", 3):
            edit(aid, "hermes", text="last")
            self.assertEqual(len(all_restorable(self, aid)), 3)
            self.assertEqual(len(snap_files(aid)), 3)

    def test_a_republish_starts_the_history_again(self):
        aid = new_doc()
        edit(aid, "hermes")
        old = snap_files(aid)
        store.publish(aid=aid, files={"doc.md": "# New\n\nfresh"})
        edit(aid, "hermes")
        self.assertTrue(set(old).isdisjoint(snap_files(aid)))
        self.assertEqual(len(all_restorable(self, aid)), 2)


class MigrationTests(unittest.TestCase):
    def legacy(self, aid, n, size=50):
        st = docs.load(aid)
        t = st["tabs"][0]
        snaps = []
        for i in range(n):
            snaps.append({"tab": t["id"], "rev": i + 1, "by": "user" if i % 2 else "hermes", "at": time.time() - 1000 + i,
                          "title": t["title"], "blocks": [{"id": b["id"], "md": f"v{i} " + "z" * size} for b in t["blocks"]]})
        t["rev"] = n + 1
        docs._save(aid, st)
        p = docs._old_hist_path(aid)
        p.write_text(json.dumps({"version": st["version"], "snaps": snaps}), "utf-8")
        return snaps

    def test_an_old_history_file_is_moved_over_whole(self):
        aid = new_doc()
        snaps = self.legacy(aid, 30)
        listed = all_restorable(self, aid)
        self.assertEqual([s["rev"] for s in listed], [s["rev"] for s in reversed(snaps)])
        self.assertEqual(docs.at_rev(aid, None, 7)["blocks"][0]["md"], snaps[6]["blocks"][0]["md"])
        self.assertFalse(docs._old_hist_path(aid).exists())
        edit(aid, "hermes")  # and goes on from there
        self.assertEqual(len(docs.history(aid)["snaps"]), 31)

    def test_over_the_bounds_the_newest_move_over(self):
        aid = new_doc()
        snaps = self.legacy(aid, 20, size=2000)
        with mock.patch.object(docs, "MAX_HIST_BYTES", 30_000):
            listed = all_restorable(self, aid)
        self.assertLess(len(listed), 20)
        self.assertEqual(listed[0]["rev"], snaps[-1]["rev"])  # newest kept
        self.assertEqual(len(snap_files(aid)), len(listed))


class StateCacheTests(unittest.TestCase):
    def test_a_poll_does_not_parse_the_state_again(self):
        aid = new_doc()
        docs.read(aid)
        with mock.patch.object(store, "load_state", side_effect=AssertionError("parsed again")):
            docs.read(aid)
            docs.read(aid, since_rev=1)

    def test_a_failed_edit_leaves_the_doc_as_it_was(self):
        aid = new_doc()
        r = docs.read(aid)
        with self.assertRaises(docs.DocError):
            docs.apply(aid, [{"op": "replace", "block": r["blocks"][1]["id"], "md": "half"},
                             {"op": "replace", "block": "b-nothere", "md": "x"}], by="user")
        self.assertEqual(docs.read(aid)["blocks"][1]["md"], "one")
        self.assertEqual(docs.read(aid)["rev"], r["rev"])

    def test_another_process_s_edit_is_read(self):
        aid = new_doc()
        r = docs.read(aid)
        code = ("import sys, os; sys.path.insert(0, sys.argv[1]); from hermes_artifacts import docs; "
                "r = docs.read(sys.argv[2]); docs.apply(sys.argv[2], [{'op': 'replace', 'block': r['blocks'][1]['id'], "
                "'md': 'from the other process'}], by='user')")
        env = dict(os.environ, HERMES_ARTIFACTS_DIR=str(store.root()))
        out = subprocess.run([sys.executable, "-c", code, str(PLUGIN), aid], env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 0, out.stderr[-2000:])
        got = docs.read(aid)
        self.assertEqual(got["blocks"][1]["md"], "from the other process")
        self.assertEqual(got["rev"], r["rev"] + 1)
        self.assertEqual(len(all_restorable(self, aid)), 2)  # its snapshots too


if __name__ == "__main__":
    unittest.main()
