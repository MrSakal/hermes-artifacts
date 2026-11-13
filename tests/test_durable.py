"""Durable writes (store.write_atomic) and the way back from a file a power cut left empty or cut short:
meta.json, comments, a doc's, sheet's or board's live state fall back to their last good copy (.bak) with a
warning in the log, never to an exception that hides the artifact; a meta.json with no copy is made again
from the version folders, a live state with none starts again from the published version (the bad file kept
aside)."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, boards, docs, sheets, store  # noqa: E402


def cut(p: Path, keep: int = 0) -> None:
    """The file as a power cut leaves it: its first ``keep`` bytes (0: empty), written in place."""
    data = p.read_bytes()[:keep]
    with open(p, "r+b") as f:
        f.truncate(0)
        f.write(data)


class WriteTests(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp(prefix="ha-durable-"))

    def test_atomic_write_fsyncs_and_leaves_no_temp_file(self):
        p = self.d / "x.json"
        real = os.fsync
        with mock.patch.object(store.os, "fsync", side_effect=real) as fs:
            store.write_atomic(p, '{"a": 1}')
            self.assertGreaterEqual(fs.call_count, 1)
            fs.reset_mock()
            store.write_atomic(p, '{"a": 2}', durable=False)
            self.assertEqual(fs.call_count, 0)
        self.assertEqual(json.loads(p.read_text("utf-8")), {"a": 2})
        self.assertEqual([c.name for c in self.d.iterdir()], ["x.json"])

    def test_a_failed_write_keeps_the_old_file_and_no_temp(self):
        p = self.d / "x.json"
        store.write_atomic(p, "old")
        with mock.patch.object(store.os, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                store.write_atomic(p, "new")
        self.assertEqual(p.read_text("utf-8"), "old")
        self.assertEqual([c.name for c in self.d.iterdir()], ["x.json"])

    def test_a_target_held_open_is_tried_again_then_fails_cleanly(self):
        p = self.d / "x.json"
        store.write_atomic(p, "old")
        real = os.replace
        busy = [2]

        def held_for_a_moment(a, b):
            if busy[0]:
                busy[0] -= 1
                raise PermissionError(13, "in use")
            return real(a, b)
        with mock.patch.object(store.os, "replace", side_effect=held_for_a_moment), \
                mock.patch.object(store.time, "sleep"):
            store.write_atomic(p, "new")
        self.assertEqual(p.read_text("utf-8"), "new")
        with mock.patch.object(store.os, "replace", side_effect=PermissionError(13, "in use")) as rep, \
                mock.patch.object(store.time, "sleep"):
            with self.assertRaises(PermissionError) as cm:
                store.write_atomic(p, "newer")
        self.assertEqual(rep.call_count, store.REPLACE_TRIES)
        self.assertIn("holds it open", str(cm.exception))
        self.assertEqual(p.read_text("utf-8"), "new")
        self.assertEqual([c.name for c in self.d.iterdir()], ["x.json"])

    @unittest.skipUnless(os.name == "nt", "a file held open blocks its replacement on Windows only")
    def test_a_target_another_program_holds_open(self):
        import threading
        p = self.d / "meta.json"
        store.write_atomic(p, "old")
        f = open(p, "rb")
        try:
            with self.assertRaises(PermissionError):
                store.write_atomic(p, "new")
        finally:
            f.close()
        self.assertEqual(p.read_text("utf-8"), "old")
        self.assertEqual([c.name for c in self.d.iterdir()], ["meta.json"])
        f = open(p, "rb")
        threading.Timer(0.05, f.close).start()  # let go of in a moment: the write gets through
        store.write_atomic(p, "new")
        self.assertEqual(p.read_text("utf-8"), "new")

    def test_read_json_says_when_it_read_a_copy(self):
        p = self.d / "c.json"
        store.write_atomic(p, '{"n": 1}', backup=True, backup_every=0)
        self.assertEqual(store.read_json_from(p), ({"n": 1}, False))
        cut(p, 3)
        with self.assertLogs(store.logger, "WARNING"):
            self.assertEqual(store.read_json_from(p), ({"n": 1}, True))

    def test_backup_is_the_copy_last_written_and_refreshed_at_most_every_few_seconds(self):
        p = self.d / "y.json"
        store._BAK_AT.pop(str(p), None)
        store.write_atomic(p, '{"n": 1}', backup=True)
        bak = self.d / "y.json.bak"
        self.assertEqual(json.loads(bak.read_text("utf-8")), {"n": 1})
        store.write_atomic(p, '{"n": 2}', backup=True)  # within BACKUP_EVERY: the copy stays
        self.assertEqual(json.loads(bak.read_text("utf-8")), {"n": 1})
        store._BAK_AT[str(p)] -= store.BACKUP_EVERY
        store.write_atomic(p, '{"n": 3}', backup=True)
        self.assertEqual(json.loads(bak.read_text("utf-8")), {"n": 3})
        store.write_atomic(p, '{"n": 4}')  # the next write replaces the file: the copy keeps what it had
        self.assertEqual(json.loads(bak.read_text("utf-8")), {"n": 3})

    def test_read_json_falls_back_and_warns(self):
        p = self.d / "z.json"
        store._BAK_AT.pop(str(p), None)
        store.write_atomic(p, '{"good": true}', backup=True)
        cut(p, 4)
        with self.assertLogs(store.logger, "WARNING") as logs:
            self.assertEqual(store.read_json(p), {"good": True})
        self.assertIn("z.json", logs.output[0])
        (self.d / "z.json.bak").unlink()
        with self.assertRaises(ValueError):
            store.read_json(p)
        (self.d / "z.json.4242-1.tmp").write_text('{"left": "complete"}', "utf-8")  # a writer that died after writing
        with self.assertLogs(store.logger, "WARNING"):
            self.assertEqual(store.read_json(p), {"left": "complete"})


class MetaTests(unittest.TestCase):
    def test_a_cut_meta_reads_its_last_good_copy_and_stays_listed(self):
        aid = store.publish(html="<p>a</p>", title="Kept")["id"]
        store._BAK_AT.clear()
        store.update_meta(aid, title="Renamed")
        p = store._dir(aid) / "meta.json"
        for keep in (0, 30):
            cut(p, keep)
            with self.assertLogs(store.logger, "WARNING"):
                self.assertEqual(store.get_meta(aid)["title"], "Renamed")
            store._METAS.clear()
            with self.assertLogs(store.logger, "WARNING"):
                self.assertIn(aid, [m["id"] for m in store.list_all()])
            self.assertIn(aid, [a["id"] for a in api.handle("GET", "artifacts", {}, None)["artifacts"]])
        store.update_meta(aid, pinned=True)  # the next write puts it right
        self.assertEqual(json.loads(p.read_text("utf-8"))["title"], "Renamed")

    def test_a_meta_with_no_copy_is_made_again_from_its_versions(self):
        aid = store.publish(type="sheet", title="S", files={"sheet.json": {"sheets": [{"name": "A", "rows": [[1]]}]}})["id"]
        store.publish(aid=aid, base=True, files={"sheet.json": {"sheets": [{"name": "A", "rows": [[2]]}]}})
        d = store._dir(aid)
        for c in d.iterdir():
            if c.name.startswith("meta.json."):
                c.unlink()
        cut(d / "meta.json")
        with self.assertLogs(store.logger, "WARNING"):
            m = store.get_meta(aid)
        self.assertEqual((m["id"], m["type"], [v["n"] for v in m["versions"]]), (aid, "sheet", [1, 2]))
        store._METAS.clear()
        with self.assertLogs(store.logger, "WARNING"):
            self.assertIn(aid, [x["id"] for x in store.list_all()])


class CommentTests(unittest.TestCase):
    def test_cut_comments_read_the_last_good_copy(self):
        aid = store.publish(html="<p>a</p>", title="C")["id"]
        store._BAK_AT.clear()
        store.comment_add(aid, "first")
        cut(store._comments_path(aid), 10)
        with self.assertLogs(store.logger, "WARNING"):
            self.assertEqual([c["text"] for c in store.comments_list(aid)], ["first"])


class LiveStateTests(unittest.TestCase):
    def test_a_cut_doc_state_reads_its_last_good_copy(self):
        aid = store.publish(type="doc", title="D", files={"doc.md": "# T\n\none"})["id"]
        r = docs.read(aid)
        store._BAK_AT.clear()
        docs.apply(aid, [{"op": "replace", "block": r["blocks"][1]["id"], "md": "typed"}], by="user")
        p = docs._state_path(aid)
        cut(p, 50)
        with self.assertLogs(store.logger, "WARNING"):
            self.assertEqual(docs.read(aid)["blocks"][1]["md"], "typed")

    def test_a_cut_doc_state_with_no_copy_starts_again_and_is_kept_aside(self):
        aid = store.publish(type="doc", title="D", files={"doc.md": "# T\n\npublished"})["id"]
        docs.read(aid)
        p = docs._state_path(aid)
        for c in p.parent.iterdir():
            if c.name.startswith("state.json."):
                c.unlink()
        cut(p)
        with self.assertLogs(store.logger, "WARNING"):
            self.assertEqual(docs.read(aid)["blocks"][1]["md"], "published")
        self.assertTrue(any(c.name.startswith("state.json.corrupt-") for c in p.parent.iterdir()))

    def test_cut_sheet_and_board_states_read_their_last_good_copy(self):
        sid = store.publish(type="sheet", title="S", files={"sheet.json": {"sheets": [{"name": "A", "rows": [[1, 2]]}]}})["id"]
        bid = store.publish(type="board", title="B", files={"board.json": {"items": [{"id": "a", "type": "box", "text": "x"}]}})["id"]
        sheets.load(sid), boards.load(bid)
        store._BAK_AT.clear()
        sheets.apply(sid, [{"op": "set", "range": "A1", "values": [[7]]}], by="user")
        boards.apply(bid, [{"op": "set", "id": "a", "text": "kept"}], by="user")
        cut(sheets._state_path(sid), 20)
        cut(boards._state_path(bid), 20)
        with self.assertLogs(store.logger, "WARNING"):
            self.assertEqual(sheets.read(sid, None, "A1")["rows"][0][0], 7)
        with self.assertLogs(store.logger, "WARNING"):
            self.assertEqual(next(i for i in boards.read(bid)["items"] if i["id"] == "a")["text"], "kept")


if __name__ == "__main__":
    unittest.main()
