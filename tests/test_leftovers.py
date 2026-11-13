"""Nothing is left behind: a permanent delete removes the artifact's whole folder and its id everywhere else,
the sweep removes what nothing will read again (and never what a writer is writing now), versions past
max_versions go with their files, and the live histories stay bounded."""

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
EX = ROOT / "examples"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, boards, diagnostics, docs, live, sheets, store  # noqa: E402
from test_types import load_plugin  # noqa: E402

PNG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
OLD = time.time() - 30 * 86400


def age(p: Path, t: float = OLD) -> Path:
    os.utime(p, (t, t))
    return p


def everywhere(aid: str) -> list:
    """Every path under the data folder naming ``aid``, and every file whose text holds it."""
    hits = []
    for dirpath, dirs, files in os.walk(store.root()):
        for name in dirs + files:
            if aid in name:
                hits.append(os.path.join(dirpath, name))
        for name in files:
            p = os.path.join(dirpath, name)
            try:
                if aid.encode() in Path(p).read_bytes():
                    hits.append(p)
            except OSError:
                pass
    return hits


def op(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


class DeleteForeverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def use_everything(self, aid: str, kind: str) -> None:
        """Every feature that writes a file for an artifact."""
        store.publish(aid=aid, base=True, files={"extra.txt": "v2"})
        c = store.comment_add(aid, "a note")
        store.comment_add(aid, "a reply", author="hermes", parent=c["id"])
        store.comment_react(aid, c["id"], "👍")
        store.kv_set(aid, "k", {"v": 1})
        store.set_approval(aid, "call-1", "mcp_x", True)
        store.report_set(aid, "check", {"version": 1, "status": "passed"})
        store.preview_set(aid, PNG)
        sent = store.inbox_add(aid, "hello", {"x": 1})
        store.reply_set(aid, sent["id"], "an answer")
        store.view_set("sess-" + aid, aid, {"slide": 1})
        store.making_set("make-" + aid, "doc", "writing", id=aid, title="t")
        store.history_add(aid, "ds1", {"q": 1}, "agent")
        live.cache_put(aid, "k" * 64, {"rows": [1]})
        with mock.patch.object(diagnostics, "enabled", lambda getter=None: True):
            v = store.get_meta(aid)["versions"][-1]["n"]
            diagnostics.record(aid, diagnostics.parse_shown(store.get_meta(aid), {"version": v, "viewer": "desktop", "outcome": "ready"}))
            diagnostics.flush(aid)
        if kind == "doc":
            r = docs.read(aid)
            up = docs.upload(aid, PNG)
            docs.apply(aid, [{"op": "replace", "block": r["blocks"][0]["id"], "md": f"![x]({up['src']})"}], by="user")
            docs.apply(aid, [{"op": "insert", "after": None, "md": "hermes"}], by="hermes", base_rev=docs.read(aid)["rev"])
            op(aid, "doc.ask", text="help", blocks=[r["blocks"][0]["id"]])
        if kind == "sheet":
            sheets.apply(aid, [{"op": "set", "range": "A1", "values": [[5]]}], by="user")
            sheets.apply(aid, [{"op": "set", "range": "A2", "values": [[6]]}], by="hermes", base_rev=sheets.read(aid)["rev"])
        if kind == "board":
            boards.apply(aid, [{"op": "set", "id": "a", "text": "y"}], by="user")
            boards.apply(aid, [{"op": "add", "items": [{"type": "note", "text": "n"}]}], by="hermes", base_rev=boards.read(aid)["rev"])
        d = store._dir(aid)
        (d / "meta.json.4242-1.tmp").write_text("{", "utf-8")  # a writer that died
        (d / "comments.json.corrupt-1700000000").write_text("[", "utf-8")
        self.p._SHOWN_AT[aid] = time.time()
        self.p._SEEN[("who", aid, 1.0)] = {"files": {}, "top": 1}

    def make(self, kind: str) -> str:
        if kind == "doc":
            return store.publish(type="doc", title="d", files={"doc.md": "# D\n\nx"})["id"]
        if kind == "sheet":
            return store.publish(type="sheet", title="s", files={"sheet.json": {"sheets": [{"name": "A", "rows": [[1]]}]}})["id"]
        if kind == "board":
            return store.publish(type="board", title="b", files={"board.json": {"items": [{"id": "a", "type": "box", "text": "x"}]}})["id"]
        if kind == "design-system":
            aid = store.publish(type="design-system", title="ds", path=str(EX / "design-system"))["id"]
            store.settings_set("default_design_system", aid)
            store.settings_set("design_system_for", {"slides": aid})
            return aid
        return store.publish(type=kind, title=kind, path=str(EX / kind))["id"] if kind != "page" else \
            store.publish(html="<p>p</p>", title="p")["id"]

    def test_delete_forever_leaves_nothing(self):
        for kind in ("page", "doc", "sheet", "board", "dashboard", "design-system"):
            for how in ("trash_delete", "purge"):
                with self.subTest(kind=kind, how=how):
                    aid = self.make(kind)
                    self.use_everything(aid, kind)
                    self.assertTrue(everywhere(aid))
                    dest = store.delete(aid)
                    if how == "trash_delete":
                        store.trash_delete(dest.name)
                    else:
                        store.purge_trash(now=time.time() + (store.TRASH_DAYS + 1) * 86400)
                    self.assertEqual(everywhere(aid), [])
                    self.assertNotIn(aid, store.settings().values())
                    self.assertFalse(any(k[1] == aid for k in self.p._SEEN if isinstance(k, tuple)))
                    self.assertNotIn(aid, self.p._SHOWN_AT)

    def test_an_id_in_use_again_keeps_its_references(self):
        aid = self.make("page")
        dest = store.delete(aid)
        store.restore(dest.name, entry=True)  # back
        store.inbox_add(aid, "still mine")
        dest = store.delete(aid)
        again = store.publish(html="<p>new</p>", title="x", aid=aid)  # the id made anew meanwhile
        store.inbox_add(aid, "the new one's")
        store.trash_delete(dest.name)
        self.assertEqual([i["text"] for i in store.inbox_list(aid)], ["still mine", "the new one's"])
        self.assertEqual(again["id"], aid)

    @unittest.skipUnless(os.name == "nt", "a file held open blocks its deletion on Windows only")
    def test_a_file_held_open_is_finished_by_the_sweep(self):
        aid = self.make("doc")
        self.use_everything(aid, "doc")
        dest = store.delete(aid)
        held = open(dest / "comments.json", "rb")
        try:
            store.trash_delete(dest.name)
            self.assertNotIn(dest.name, [t["name"] for t in store.trash_list()])  # never shown half deleted
        finally:
            held.close()
        store.sweep()
        self.assertEqual(everywhere(aid), [])

    def test_delete_while_a_file_is_open_changes_nothing(self):
        aid = self.make("page")
        with mock.patch.object(store.os, "rename", side_effect=PermissionError(13, "in use")):
            with self.assertRaises(OSError):
                store.delete(aid)
        self.assertTrue((store._dir(aid) / "meta.json").is_file())
        self.assertIn(aid, [m["id"] for m in store.list_all()])


class SweepTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(type="doc", title="sw", files={"doc.md": "# S\n\none"})["id"]
        self.d = store._dir(self.aid)

    def sweep(self):
        store._SWEPT["after"] = ""
        return store.sweep(budget_s=60)

    def test_dead_writers_temp_files_go_a_live_writers_stay(self):
        dead = self.d / "meta.json.999-1.tmp"
        dead.write_text("{", "utf-8")
        age(dead)
        fresh = self.d / "meta.json.1000-2.tmp"
        fresh.write_text("{", "utf-8")
        root_dead = store.root() / "settings.json.77-1.tmp"
        root_dead.write_text("{", "utf-8")
        age(root_dead)
        self.sweep()
        self.assertFalse(dead.exists())
        self.assertFalse(root_dead.exists())
        self.assertTrue(fresh.exists())  # a writer in another process may be writing it now
        fresh.unlink()

    def test_copies_and_corrupt_files(self):
        lone = self.d / "replies.json.bak"
        lone.write_text("{}", "utf-8")
        age(lone)
        store.comment_add(self.aid, "x")
        store._BAK_AT.clear()
        store.comment_add(self.aid, "y")
        kept_bak = self.d / "comments.json.bak"
        age(kept_bak)
        old = self.d / f"meta.json.corrupt-{int(OLD)}"
        old.write_text("{", "utf-8")
        new = self.d / f"meta.json.corrupt-{int(time.time())}"
        new.write_text("{", "utf-8")
        self.sweep()
        self.assertFalse(lone.exists())
        self.assertTrue(kept_bak.exists())
        self.assertFalse(old.exists())
        self.assertTrue(new.exists())

    def test_versions_meta_no_longer_names_and_entries_naming_none(self):
        store.publish(aid=self.aid, files={"doc.md": "# S\n\ntwo"})
        stray = self.d / "v9"
        stray.mkdir()
        (stray / "doc.md").write_text("x", "utf-8")
        age(stray / "doc.md")
        age(stray)
        busy = self.d / "v3"  # a publish in another process: just made
        busy.mkdir()
        m = store.get_meta(self.aid)
        m["versions"].insert(0, {"n": 0, "published": 1, "bytes": 1, "by": "hermes"})  # names a folder that is gone
        store._write_json(self.d / "meta.json", m)
        self.sweep()
        self.assertFalse(stray.exists())
        self.assertTrue(busy.exists())
        self.assertEqual([v["n"] for v in store.get_meta(self.aid)["versions"]], [1, 2])
        busy.rmdir()

    def test_old_previews_doc_leftovers_and_empty_folders(self):
        store.preview_set(self.aid, PNG)
        for n in (2, 3, 4, 5):
            store.publish(aid=self.aid, files={"doc.md": f"# S\n\n{n}"})
        pv = self.d / "previews"
        stale = pv / "v1.png"
        self.assertTrue(stale.exists())  # preview_set only trims when it writes again
        empty = self.d / "cache"
        empty.mkdir(exist_ok=True)
        age(empty)
        r = docs.read(self.aid)
        used = docs.upload(self.aid, PNG)
        docs.apply(self.aid, [{"op": "replace", "block": r["blocks"][1]["id"], "md": f"![u]({used['src']})"}], by="user")
        unused = self.d / "doc" / "files" / ("0" * 20 + ".png")
        unused.write_bytes(b"x")
        age(unused)
        age(self.d / "doc" / "files" / used["name"])
        docs.apply(self.aid, [{"op": "insert", "after": None, "md": "h"}], by="hermes", base_rev=docs.read(self.aid)["rev"])
        snaps = self.d / "doc" / "snaps"
        loose = snaps / "999.json"
        loose.write_text('{"blocks": []}', "utf-8")
        age(loose)
        h = json.loads((self.d / "doc" / "hist.json").read_text("utf-8"))
        named = snaps / f"{h['snaps'][0]['f']}.json"
        named.unlink()  # an entry whose file is gone
        oldfmt = self.d / "doc" / "history.json"
        oldfmt.write_text('{"version": 1, "snaps": []}', "utf-8")
        age(oldfmt)
        self.sweep()
        self.assertFalse(stale.exists())
        self.assertFalse(empty.exists())
        self.assertFalse(unused.exists())
        self.assertTrue((self.d / "doc" / "files" / used["name"]).exists())
        self.assertFalse(loose.exists())
        self.assertFalse(oldfmt.exists())
        for s in docs.history(self.aid)["snaps"]:
            docs.at_rev(self.aid, None, s["rev"])  # every listed one restorable

    def test_unlisted_folders_cache_answers_and_half_purges(self):
        orphan = store.root() / "died-before-meta-abc123"
        (orphan / "v1").mkdir(parents=True)
        (orphan / "v1" / "index.html").write_text("x", "utf-8")
        for p in (orphan / "v1" / "index.html", orphan / "v1", orphan):
            age(p)
        young = store.root() / "publishing-now-abc123"
        (young / "v1").mkdir(parents=True)
        live.cache_put(self.aid, "a" * 64, {"rows": []})
        ans = self.d / "cache" / ("a" * 64 + ".json")
        age(ans)
        half = store._trash() / (store.PURGING + "gone-1700000000-abcdef")
        (half / "v1").mkdir(parents=True)
        self.sweep()
        self.assertFalse(orphan.exists())
        self.assertTrue(young.exists())
        self.assertFalse(ans.exists())
        self.assertFalse(half.exists())
        store._rmtree(young)

    def test_bounded_per_call_and_goes_on_next_time(self):
        for i in range(3):
            store.publish(html=f"<p>{i}</p>", title=f"b{i}")
        store._SWEPT["after"] = ""
        first = store.sweep(budget_s=0)
        self.assertLessEqual(first["artifacts"], 1)
        before = store._SWEPT["after"]
        store.sweep(budget_s=0)
        self.assertNotEqual(store._SWEPT["after"], before)

    def test_it_rides_the_trash_purge(self):
        with mock.patch.object(store, "sweep") as sw:
            store._PURGED_AT = None
            t = store.purge_trash_due()
            t.join(10)
        sw.assert_called_once()


class RetentionTests(unittest.TestCase):
    def test_the_newest_are_kept_numbers_never_reused(self):
        with mock.patch.object(store, "max_versions", return_value=3):
            aid = store.publish(html="<p>1</p>", title="r")["id"]
            store.preview_set(aid, PNG)
            for i in range(2, 7):
                store.publish(aid=aid, html=f"<p>{i}</p>")
            m = store.get_meta(aid)
            self.assertEqual([v["n"] for v in m["versions"]], [4, 5, 6])
            d = store._dir(aid)
            self.assertEqual(sorted(p.name for p in d.iterdir() if p.name.startswith("v")), ["v4", "v5", "v6"])
            self.assertFalse((d / "previews" / "v1.png").exists())
            self.assertEqual(store.publish(aid=aid, html="<p>7</p>")["versions"][-1]["n"], 7)
            with self.assertRaises(store.NotFound) as cm:
                store.version_dir(aid, 2)
            self.assertIn("no longer kept", str(cm.exception))
            with self.assertRaises(api.ApiError) as ae:
                api.handle("GET", f"artifacts/{aid}/html", {"v": "2"}, None)
            self.assertEqual(ae.exception.status, 404)
            self.assertEqual([v["n"] for v in api.handle("POST", f"artifacts/{aid}/op", {}, {"op": "history.list", "args": {}})["versions"]],
                             [7, 6, 5])
            r = json.loads(load_plugin()._read({"id": aid, "version": 2}))
            self.assertFalse(r.get("ok", True))
            self.assertIn("no longer kept", r["error"])

    def test_a_version_an_open_comment_was_made_on_stays(self):
        with mock.patch.object(store, "max_versions", return_value=2):
            aid = store.publish(html="<p>1</p>", title="c")["id"]
            store.publish(aid=aid, html="<p>2</p>")
            c = store.comment_add(aid, "about v2")
            for i in range(3, 6):
                store.publish(aid=aid, html=f"<p>{i}</p>")
            self.assertEqual([v["n"] for v in store.get_meta(aid)["versions"]], [2, 4, 5])
            store.comment_resolve(aid, c["id"])
            store.publish(aid=aid, html="<p>6</p>")
            self.assertEqual([v["n"] for v in store.get_meta(aid)["versions"]], [5, 6])

    def test_zero_keeps_all_and_the_setting_is_read(self):
        with mock.patch.object(store, "max_versions", return_value=0):
            aid = store.publish(html="<p>1</p>", title="z")["id"]
            for i in range(40):
                store.publish(aid=aid, html=f"<p>{i}</p>")
            self.assertEqual(len(store.get_meta(aid)["versions"]), 41)
        try:
            store.set_config_getter(lambda key: {"max_versions": "5"}.get(key))
            self.assertEqual(store.max_versions(), 5)
            store.set_config_getter(lambda key: None)
            self.assertEqual(store.max_versions(), store.MAX_VERSIONS)
        finally:
            store.set_config_getter(None)


class LiveHistoryBoundsTests(unittest.TestCase):
    def test_sheet_and_board_histories_are_bounded(self):
        sid = store.publish(type="sheet", title="s", files={"sheet.json": {"sheets": [{"name": "A", "rows": [[1]]}]}})["id"]
        bid = store.publish(type="board", title="b", files={"board.json": {"items": [{"id": "a", "type": "box", "text": "x"}]}})["id"]
        with mock.patch.object(sheets, "MAX_SNAPS", 5), mock.patch.object(boards, "MAX_SNAPS", 5):
            for i in range(12):
                by = "user" if i % 2 else "hermes"
                sheets.apply(sid, [{"op": "set", "range": "A1", "values": [[i]]}], by=by, base_rev=sheets.read(sid)["rev"])
                boards.apply(bid, [{"op": "set", "id": "a", "text": str(i)}], by=by, base_rev=boards.read(bid)["rev"])
            self.assertLessEqual(len(sheets.history(sid)["snaps"]), 5)
            self.assertLessEqual(len(boards.history(bid)["snaps"]), 5)


if __name__ == "__main__":
    unittest.main()
