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
        store.write_atomic(p, '{"n": 1}', backup=True)
        self.assertEqual(store.read_json_from(p), ({"n": 1}, False))
        cut(p, 3)
        with self.assertLogs(store.logger, "WARNING"):
            self.assertEqual(store.read_json_from(p), ({"n": 1}, True))

    def test_backup_is_refreshed_at_every_write(self):
        p = self.d / "y.json"
        bak = self.d / "y.json.bak"
        for n in (1, 2, 3):  # in quick succession, as typing writes
            store.write_atomic(p, json.dumps({"n": n}), backup=True)
            self.assertEqual(json.loads(bak.read_text("utf-8")), {"n": n})
        store.write_atomic(p, '{"n": 4}')  # a write without backup: the copy keeps what it had
        self.assertEqual(json.loads(bak.read_text("utf-8")), {"n": 3})

    def test_a_copy_that_could_not_be_refreshed_is_said(self):
        p = self.d / "w.json"
        store.write_atomic(p, '{"n": 1}', backup=True)
        real = store.write_atomic

        def no_copy(q, data, **kw):
            if Path(q).name.endswith(".bak"):
                raise PermissionError(13, "held open")
            return real(q, data, **kw)
        with mock.patch.object(store, "write_atomic", side_effect=no_copy), \
                self.assertLogs(store.logger, "WARNING") as logs:
            real(p, '{"n": 2}', backup=True)
        self.assertIn("w.json", logs.output[0])
        self.assertEqual(json.loads(p.read_text("utf-8")), {"n": 2})

    def test_read_json_falls_back_and_warns(self):
        p = self.d / "z.json"
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


def _hold_exclusively(p: Path):
    """A real handle on ``p`` that shares nothing (Windows): every read of it fails until closed."""
    import _winapi
    return _winapi.CreateFile(str(p), _winapi.GENERIC_READ, 0, 0, _winapi.OPEN_EXISTING, 0, 0)


class ReadRaceTests(unittest.TestCase):
    """A read of a plugin file another writer is replacing this very moment (Windows answers PermissionError
    for a few ms) is tried again, then falls back to its copy; never a 500 for it."""

    def setUp(self):
        self.d = Path(tempfile.mkdtemp(prefix="ha-race-"))
        self.addCleanup(__import__("shutil").rmtree, self.d, True)

    def test_a_locked_read_is_tried_again(self):
        p = self.d / "meta.json"
        store.write_atomic(p, '{"n": 1}')
        real = Path.read_text
        busy = [2]

        def locked_for_a_moment(self_, *a, **kw):
            if self_ == p and busy[0]:
                busy[0] -= 1
                raise PermissionError(13, "in use", str(p))
            return real(self_, *a, **kw)
        with mock.patch.object(Path, "read_text", locked_for_a_moment), mock.patch.object(store.time, "sleep") as sl:
            self.assertEqual(store.read_json_from(p), ({"n": 1}, False))
        self.assertEqual(sl.call_count, 2)

    def test_still_locked_reads_the_copy_else_raises(self):
        p = self.d / "c.json"
        store.write_atomic(p, '{"n": 2}', backup=True)
        real = Path.read_text

        def locked(self_, *a, **kw):
            if self_ == p:
                raise PermissionError(13, "in use", str(p))
            return real(self_, *a, **kw)
        with mock.patch.object(Path, "read_text", locked), mock.patch.object(store.time, "sleep"):
            with self.assertLogs(store.logger, "WARNING") as logs:
                self.assertEqual(store.read_json_from(p), ({"n": 2}, True))
            self.assertIn("held by another program", logs.output[0])
            (self.d / "c.json.bak").unlink()
            with self.assertRaises(PermissionError):
                store.read_json(p)

    @unittest.skipUnless(os.name == "nt", "sharing violations are Windows'")
    def test_a_real_handle_that_shares_nothing(self):
        import _winapi
        import threading
        p = self.d / "meta.json"
        store.write_atomic(p, '{"n": 3}', backup=True)
        h = _hold_exclusively(p)
        threading.Timer(0.05, _winapi.CloseHandle, (h,)).start()  # let go of in a moment: the read gets through
        self.assertEqual(store.read_json_from(p), ({"n": 3}, False))
        h = _hold_exclusively(p)
        try:  # held past the retries: the copy
            with self.assertLogs(store.logger, "WARNING"):
                self.assertEqual(store.read_json_from(p), ({"n": 3}, True))
        finally:
            _winapi.CloseHandle(h)

    @unittest.skipUnless(os.name == "nt", "the replace race is Windows'")
    def test_reads_while_a_writer_replaces_the_file_never_fail(self):
        # The acceptance round's 500: get_meta while another request rewrote meta.json. A plain read in this
        # loop fails now and then (~25 in 3 s here); the store's never, and the writer never fails either.
        import threading
        import time
        p = self.d / "meta.json"
        store.write_atomic(p, '{"n": 0}', backup=True)
        stop, errors = threading.Event(), []

        def writer():
            i = 0
            while not stop.is_set():
                i += 1
                try:
                    store.write_atomic(p, json.dumps({"n": i}), backup=True)
                except OSError as e:
                    errors.append(e)
        t = threading.Thread(target=writer)
        t.start()
        try:
            end, reads = time.monotonic() + 1.0, 0
            while time.monotonic() < end:
                self.assertIn("n", store.read_json(p))
                reads += 1
        finally:
            stop.set()
            t.join()
        self.assertEqual(errors, [])
        self.assertGreater(reads, 50)

    @unittest.skipUnless(os.name == "nt", "the replace race is Windows'")
    def test_writes_among_overlapping_readers_never_fail(self):
        # Two gateway requests writing meta.json while others read it: readers that overlap keep the file open
        # with no gap, and a writer ran out of tries (here every time, ~5 failed writes in 1.5 s): an update
        # lost. One process's readers and writers of a file take turns: every write gets through.
        import threading
        import time
        p = self.d / "meta.json"
        store.write_atomic(p, '{"n": 0}', backup=True)
        stop, errors, writes = threading.Event(), [], []

        def writer(k):
            i = 0
            while not stop.is_set():
                i += 1
                try:
                    store.write_atomic(p, json.dumps({"w": k, "n": i}), backup=True)
                    writes.append(1)
                except OSError as e:
                    errors.append(e)

        def reader():
            while not stop.is_set():
                try:
                    store.read_json(p)
                except Exception as e:  # noqa: BLE001 - any failed read counts
                    errors.append(e)
        ts = [threading.Thread(target=writer, args=(k,)) for k in range(2)] + [threading.Thread(target=reader) for _ in range(3)]
        for t in ts:
            t.start()
        time.sleep(1.5)
        stop.set()
        for t in ts:
            t.join()
        self.assertEqual(errors, [])
        self.assertGreater(len(writes), 20)
        self.assertIn("n", store.read_json(p))

    def test_settings_held_open_are_never_written_over_with_nothing(self):
        p = store.root() / "settings.json"
        store.settings_set("folders", ["Keep"])
        (store.root() / "settings.json.bak").unlink()
        real = Path.read_text

        def locked(self_, *a, **kw):
            if self_ == p:
                raise PermissionError(13, "in use", str(p))
            return real(self_, *a, **kw)
        with mock.patch.object(Path, "read_text", locked), mock.patch.object(store.time, "sleep"):
            with self.assertRaises(PermissionError):
                store.settings_set("default_design_system", "x")
        self.assertEqual(store.settings().get("folders"), ["Keep"])
        store.settings_set("folders", None)

    def test_page_reports_held_open_are_never_written_over_with_nothing(self):
        from hermes_artifacts import diagnostics
        aid = store.publish(files={"index.html": "<p>x</p>"}, title="diag-race")["id"]
        self.addCleanup(store.delete, aid)
        m = store.get_meta(aid)
        with mock.patch.object(diagnostics, "enabled", lambda getter=None: True):
            diagnostics.record(aid, diagnostics.parse_shown(m, {"version": 1, "viewer": "desktop", "outcome": "ready"}))
            diagnostics.flush(aid)
            p = diagnostics._path(aid)
            before = p.read_text("utf-8")
            real = Path.read_text

            def locked(self_, *a, **kw):
                if self_ == p:
                    raise PermissionError(13, "in use", str(p))
                return real(self_, *a, **kw)
            diagnostics.record(aid, diagnostics.parse_shown(m, {"version": 1, "viewer": "browser", "outcome": "threw"}))
            with mock.patch.object(Path, "read_text", locked), mock.patch.object(store.time, "sleep"):
                self.assertFalse(diagnostics.flush(aid))
        self.assertEqual(p.read_text("utf-8"), before)

    def test_the_api_answers_503_with_a_sentence(self):
        aid = store.publish(files={"index.html": "<p>x</p>"}, title="race")["id"]
        self.addCleanup(store.delete, aid)
        with mock.patch.object(store, "get_meta", side_effect=PermissionError(13, "in use", "C:/x/meta.json")):
            with self.assertRaises(api.ApiError) as cm:
                api.handle("GET", f"artifacts/{aid}/html", {}, None)
        self.assertEqual(cm.exception.status, 503)
        self.assertIn("meta.json is in use", cm.exception.detail)


class MetaTests(unittest.TestCase):
    def test_a_cut_meta_reads_its_last_good_copy_and_stays_listed(self):
        aid = store.publish(html="<p>a</p>", title="Kept")["id"]
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


CHANGER = r"""
import os, sys, time
sys.path.insert(0, sys.argv[1])
from hermes_artifacts import store
aid, role, done = sys.argv[2:5]
if role == "publish":
    try:
        for i in range(20):
            store.publish(aid=aid, html=f"<p>{i}</p>")
    finally:
        open(done, "w").close()
else:
    i, end = 0, time.monotonic() + 60
    while not os.path.exists(done) and time.monotonic() < end:
        i += 1
        store.update_meta(aid, title=f"A{i}", opened=True)
    print(i)
"""


class TwoProcessTests(unittest.TestCase):
    def test_two_processes_changing_one_meta_keep_every_change(self):
        # The gateway publishes while `hermes dashboard` renames the artifact (or stamps it opened): each read
        # meta.json, changed it and wrote it back, and the later write dropped the other's change (a version
        # entry, a title). Their changes of a meta take turns across processes: every one is kept.
        import shutil
        import subprocess
        base = Path(tempfile.mkdtemp(prefix="ha-2proc-"))
        self.addCleanup(shutil.rmtree, base, True)
        done = base / "published"
        with mock.patch.dict(os.environ, {"HERMES_ARTIFACTS_DIR": str(base / "data")}):
            aid = store.publish(html="<p>v1</p>", title="T")["id"]
            run = [sys.executable, "-c", CHANGER, str(PLUGIN), aid]
            env = dict(os.environ)
            renamer = subprocess.Popen(run + ["rename", str(done)], env=env, stdout=subprocess.PIPE, text=True)
            publisher = subprocess.Popen(run + ["publish", str(done)], env=env)
            out, _ = renamer.communicate(timeout=120)  # the publisher marks done however it ends
            self.assertEqual(publisher.wait(timeout=120), 0)
            self.assertEqual(renamer.returncode, 0)
            m = store.get_meta(aid)
        self.assertEqual([v["n"] for v in m["versions"]], list(range(1, 22)))
        self.assertEqual(m["title"], f"A{int(out)}")

    def test_the_meta_lock_never_waits_without_end_and_is_let_go_of(self):
        aid = store.publish(html="<p>a</p>", title="L")["id"]
        with store._meta_lock():  # nested in this process: no wait on itself
            store.update_meta(aid, title="Nested")
        with self.assertRaises(ValueError):
            store.update_meta(aid, color="red")  # refused inside the lock: it is let go of all the same
        fd = os.open(store.root() / "meta.lock", os.O_RDWR)  # another holder (as another process would)
        try:
            store._lock_file(fd)
            with mock.patch.object(store, "META_LOCK_WAIT", 0.05), self.assertRaises(TimeoutError):
                store.update_meta(aid, title="Waited")
        finally:
            os.close(fd)  # the holder ends: its lock goes with it
        store.update_meta(aid, title="After")
        self.assertEqual(store.get_meta(aid)["title"], "After")


class CommentTests(unittest.TestCase):
    def test_cut_comments_read_the_last_good_copy(self):
        aid = store.publish(html="<p>a</p>", title="C")["id"]
        store.comment_add(aid, "first")
        cut(store._comments_path(aid), 10)
        with self.assertLogs(store.logger, "WARNING"):
            self.assertEqual([c["text"] for c in store.comments_list(aid)], ["first"])


class LiveStateTests(unittest.TestCase):
    def test_a_cut_doc_state_reads_its_last_good_copy(self):
        aid = store.publish(type="doc", title="D", files={"doc.md": "# T\n\none"})["id"]
        r = docs.read(aid)
        docs.apply(aid, [{"op": "replace", "block": r["blocks"][1]["id"], "md": "typ"}], by="user")
        docs.apply(aid, [{"op": "replace", "block": r["blocks"][1]["id"], "md": "typed"}], by="user")  # a moment later
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
        for v, t in ((6, "kep"), (7, "kept")):  # the second write a moment after the first: its copy is the last
            sheets.apply(sid, [{"op": "set", "range": "A1", "values": [[v]]}], by="user")
            boards.apply(bid, [{"op": "set", "id": "a", "text": t}], by="user")
        cut(sheets._state_path(sid), 20)
        cut(boards._state_path(bid), 20)
        with self.assertLogs(store.logger, "WARNING"):
            self.assertEqual(sheets.read(sid, None, "A1")["rows"][0][0], 7)
        with self.assertLogs(store.logger, "WARNING"):
            self.assertEqual(next(i for i in boards.read(bid)["items"] if i["id"] == "a")["text"], "kept")


if __name__ == "__main__":
    unittest.main()
