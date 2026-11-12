"""Deleting moves an artifact to the trash: it leaves every list, `hermes artifacts restore` brings it
back, and what was deleted more than 30 days ago is purged."""

import argparse
import contextlib
import importlib.util
import io
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

from hermes_artifacts import api, store  # noqa: E402


def load_plugin():
    spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", PLUGIN / "__init__.py",
                                                  submodule_search_locations=[str(PLUGIN)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules["hermes_artifacts_plugin"] = mod
    spec.loader.exec_module(mod)
    return mod


class TrashTests(unittest.TestCase):
    def test_delete_goes_to_the_trash_and_drops_the_default(self):
        aid = store.publish(title="DS", html="<p>x</p>")["id"]
        store.publish(aid=aid, html="<p>y</p>")
        store.comment_add(aid, "note")
        store.settings_set("default_design_system", aid)
        dest = store.delete(aid)
        self.assertFalse(store._dir(aid).exists())
        self.assertIsNone(store.get_meta(aid))
        self.assertNotIn(aid, [m["id"] for m in store.list_all()])
        self.assertNotIn(aid, [a["id"] for a in api.handle("GET", "artifacts", {}, None)["artifacts"]])
        self.assertIsNone(store.settings().get("default_design_system"))
        self.assertTrue((dest / "v2").is_dir() and (dest / store.TRASH_MARK).is_file())
        self.assertEqual(store.trash_list()[0]["id"], aid)
        with self.assertRaises(FileNotFoundError):
            store.delete(aid)

    def test_restore_brings_back_every_version_and_comment(self):
        aid = store.publish(title="Keep me", html="<p>1</p>")["id"]
        store.publish(aid=aid, html="<p>2</p>")
        store.comment_add(aid, "a note")
        store.delete(aid)
        meta = store.restore(aid)
        self.assertEqual(([v["n"] for v in meta["versions"]], meta["title"]), ([1, 2], "Keep me"))
        self.assertEqual(store.read_file(aid, "index.html", 1), b"<p>1</p>")
        self.assertEqual(len(store.comments_list(aid)), 1)
        self.assertFalse((store._dir(aid) / store.TRASH_MARK).exists())
        self.assertIn(aid, [m["id"] for m in store.list_all()])
        self.assertNotIn(aid, [t["id"] for t in store.trash_list()])
        with self.assertRaises(FileNotFoundError):
            store.restore(aid)

    def test_restore_is_refused_while_the_id_is_taken(self):
        aid = store.publish(title="Twice", html="<p>a</p>")["id"]
        store.delete(aid)
        store.publish(aid=aid, html="<p>new</p>")
        with self.assertRaises(FileExistsError):
            store.restore(aid)
        self.assertEqual(store.read_file(aid, "index.html"), b"<p>new</p>")
        self.assertIn(aid, [t["id"] for t in store.trash_list()])

    def test_purge_drops_only_what_is_older_than_30_days(self):
        old = store.publish(title="Old", html="<p>o</p>")["id"]
        new = store.publish(title="New", html="<p>n</p>")["id"]
        old_dir, new_dir = store.delete(old), store.delete(new)
        mark = json.loads((old_dir / store.TRASH_MARK).read_text("utf-8"))
        mark["deleted_at"] = time.time() - 31 * 86400
        (old_dir / store.TRASH_MARK).write_text(json.dumps(mark), "utf-8")
        self.assertIn(old_dir.name, store.purge_trash())
        self.assertFalse(old_dir.exists())
        self.assertTrue(new_dir.exists())
        self.assertNotIn(new_dir.name, store.purge_trash(now=time.time() + 29 * 86400))
        self.assertIn(new_dir.name, store.purge_trash(now=time.time() + 31 * 86400))
        self.assertFalse(new_dir.exists())

    def test_a_delete_purges_the_old_trash_on_its_way(self):
        trash = store.root() / ".trash"
        trash.mkdir(exist_ok=True)
        (trash / "ancient-1700000000").mkdir()  # left by a version before 0.13, with no mark
        aid = store.publish(title="x", html="<p>x</p>")["id"]
        store.delete(aid)
        self.assertFalse((trash / "ancient-1700000000").exists())

    def test_the_tool_says_where_it_went_and_the_cli_restores(self):
        p = load_plugin()
        aid = store.publish(title="Tool", html="<p>t</p>")["id"]
        r = json.loads(p._delete({"id": aid}))
        self.assertTrue(r["ok"], r)
        self.assertIn("trash", r["note"])
        self.assertIn(f"hermes artifacts restore {aid}", r["note"])
        self.assertLess(len(r["note"]), 100)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            p._cli(argparse.Namespace(artifacts_cmd="trash"))
            p._cli(argparse.Namespace(artifacts_cmd="restore", id=aid))
            p._cli(argparse.Namespace(artifacts_cmd="restore", id=aid))
        text = out.getvalue()
        self.assertIn(aid, text.splitlines()[0])
        self.assertIn(f"restored {aid}", text)
        self.assertIn("not restored", text)
        self.assertIsNotNone(store.get_meta(aid))

    def test_the_api_lists_and_restores(self):
        aid = store.publish(title="Api", html="<p>a</p>")["id"]
        api.handle("DELETE", f"artifacts/{aid}", {}, None)
        listed = api.handle("GET", "trash", {}, None)
        self.assertEqual(listed["days"], 30)
        self.assertIn(aid, [t["id"] for t in listed["trash"]])
        self.assertEqual(api.handle("POST", "trash/restore", {}, {"id": aid})["artifact"]["id"], aid)
        with self.assertRaises(api.ApiError):
            api.handle("POST", "trash/restore", {}, {"id": aid})

    def test_each_entry_says_how_many_days_it_has_left(self):
        aid = store.publish(title="Days", html="<p>d</p>")["id"]
        dest = store.delete(aid)
        self.assertEqual(next(t for t in store.trash_list() if t["name"] == dest.name)["days_left"], 30)
        mark = json.loads((dest / store.TRASH_MARK).read_text("utf-8"))
        mark["deleted_at"] = time.time() - 27.5 * 86400
        (dest / store.TRASH_MARK).write_text(json.dumps(mark), "utf-8")
        listed = api.handle("GET", "trash", {}, None)["trash"]
        self.assertEqual(next(t for t in listed if t["name"] == dest.name)["days_left"], 3)

    def test_the_gallery_restores_the_very_copy_it_shows(self):
        """Two deletions of one id are two entries: restoring by entry name brings back that one, not the
        newest, and a name never falls back to matching an id."""
        aid = store.publish(title="First", html="<p>1</p>")["id"]
        first = store.delete(aid)
        store.publish(aid=aid, title="Second", html="<p>2</p>")
        second = store.delete(aid)
        mark = json.loads((first / store.TRASH_MARK).read_text("utf-8"))
        mark["deleted_at"] = time.time() - 86400  # the older deletion
        (first / store.TRASH_MARK).write_text(json.dumps(mark), "utf-8")
        with self.assertRaises(api.ApiError) as no:
            api.handle("POST", "trash/restore", {}, {"name": aid})
        self.assertEqual(no.exception.status, 404)
        got = api.handle("POST", "trash/restore", {}, {"name": first.name})["artifact"]
        self.assertEqual((got["id"], got["title"]), (aid, "First"))
        self.assertTrue(second.exists())
        with self.assertRaises(api.ApiError) as taken:
            api.handle("POST", "trash/restore", {}, {"name": second.name})
        self.assertEqual(taken.exception.status, 409)
        self.assertIn("exists again", taken.exception.detail)


def _age(dest: Path, days: float) -> None:
    """Make a trashed item look deleted ``days`` ago."""
    mark = json.loads((dest / store.TRASH_MARK).read_text("utf-8"))
    mark["deleted_at"] = time.time() - days * 86400
    (dest / store.TRASH_MARK).write_text(json.dumps(mark), "utf-8")


class PurgeWithoutATimerTests(unittest.TestCase):
    """The gallery's own list and trash requests purge, at most once a day per process; an item past its
    time is never listed, even before a purge removes it."""

    def setUp(self):
        self._saved = store._PURGED_AT
        store._PURGED_AT = None

    def tearDown(self):
        store._PURGED_AT = self._saved

    def test_purge_runs_at_most_once_a_day(self):
        from unittest import mock
        with mock.patch.object(store, "purge_trash", return_value=[]) as purge:
            t = store.purge_trash_due(now=1_000_000.0)
            self.assertIsNotNone(t)
            t.join(5)
            self.assertIsNone(store.purge_trash_due(now=1_000_000.0 + 3600))
            self.assertIsNone(store.purge_trash_due(now=1_000_000.0 + 86399))
            t2 = store.purge_trash_due(now=1_000_000.0 + 86400)
            self.assertIsNotNone(t2)
            t2.join(5)
            self.assertEqual(purge.call_count, 2)

    def test_the_gallery_list_starts_the_daily_purge(self):
        from unittest import mock
        with mock.patch.object(store, "purge_trash", return_value=[]) as purge:
            api.handle("GET", "artifacts", {}, None)
            api.handle("GET", "artifacts", {}, None)
            for th in __import__("threading").enumerate():
                if th.name == "hermes-artifacts-trash":
                    th.join(5)
            self.assertEqual(purge.call_count, 1)

    def test_a_purge_that_fails_never_reaches_the_request(self):
        from unittest import mock
        with mock.patch.object(store, "purge_trash", side_effect=OSError("locked")):
            t = store.purge_trash_due(now=5.0)
            t.join(5)
            self.assertIn("artifacts", api.handle("GET", "artifacts", {}, None))

    def test_an_expired_item_is_never_listed_nor_restorable(self):
        aid = store.publish(title="Expired", html="<p>e</p>")["id"]
        dest = store.delete(aid)
        _age(dest, 30.01)  # past its time; no purge has run since
        self.assertTrue(dest.exists())
        self.assertNotIn(dest.name, [t["name"] for t in store.trash_list()])
        with self.assertRaises(FileNotFoundError):
            store.restore(dest.name, entry=True)

    def test_get_trash_purges_what_is_past_its_time(self):
        old = store.publish(title="Old", html="<p>o</p>")["id"]
        new = store.publish(title="New", html="<p>n</p>")["id"]
        old_dir, new_dir = store.delete(old), store.delete(new)
        _age(old_dir, 31)
        store._PURGED_AT = time.time()  # the daily one is not due: GET trash itself must purge
        listed = api.handle("GET", "trash", {}, None)["trash"]
        self.assertFalse(old_dir.exists())
        self.assertTrue(new_dir.exists())
        self.assertNotIn(old_dir.name, [t["name"] for t in listed])
        self.assertIn(new_dir.name, [t["name"] for t in listed])


class DeleteForeverTests(unittest.TestCase):
    """POST trash/delete {name}: the user deletes one trashed copy for good from the gallery."""

    def test_it_removes_exactly_the_named_entry(self):
        aid = store.publish(title="Twice", html="<p>1</p>")["id"]
        first = store.delete(aid)
        store.publish(aid=aid, title="Again", html="<p>2</p>")
        second = store.delete(aid)
        other = store.delete(store.publish(title="Other", html="<p>o</p>")["id"])
        self.assertEqual(api.handle("POST", "trash/delete", {}, {"name": first.name}), {"deleted": first.name})
        self.assertFalse(first.exists())
        self.assertTrue(second.exists() and other.exists())
        self.assertTrue(store.root().is_dir() and (store.root() / ".trash").is_dir())
        with self.assertRaises(api.ApiError) as again:
            api.handle("POST", "trash/delete", {}, {"name": first.name})
        self.assertEqual(again.exception.status, 404)

    def test_it_refuses_bad_names_traversal_ids_and_unknown_names(self):
        aid = store.publish(title="Stay", html="<p>s</p>")["id"]
        live = store.publish(title="Live", html="<p>l</p>")["id"]
        dest = store.delete(aid)
        bad = ["", ".", "..", "../" + live, "..\\" + live, f"{dest.name}/..", f"{dest.name}/meta.json",
               "/etc", "C:\\Windows", "x\0y", f"..{dest.name}"]
        for name in bad:
            with self.assertRaises(api.ApiError, msg=name) as e:
                api.handle("POST", "trash/delete", {}, {"name": name})
            self.assertIn(e.exception.status, (400, 404), name)
        for name in (aid, live, "nope-1700000000"):  # a bare id, a live artifact, an unknown entry
            with self.assertRaises(api.ApiError) as e:
                api.handle("POST", "trash/delete", {}, {"name": name})
            self.assertEqual(e.exception.status, 404, name)
        with self.assertRaises(api.ApiError):
            api.handle("POST", "trash/delete", {}, {"id": dest.name})  # only {name}
        self.assertTrue(dest.exists())
        self.assertIsNotNone(store.get_meta(live))

    def test_it_refuses_a_link_in_the_trash(self):
        outside = Path(tempfile.mkdtemp(prefix="ha-outside-"))
        (outside / "keep.txt").write_text("keep", "utf-8")
        link = store.root() / ".trash" / "linked-1700000000"
        (store.root() / ".trash").mkdir(exist_ok=True)
        try:
            os.symlink(outside, link, target_is_directory=True)
        except (OSError, NotImplementedError):
            try:  # Windows without the symlink privilege: a junction, which needs none
                import _winapi
                _winapi.CreateJunction(str(outside), str(link))
            except Exception:
                self.skipTest("cannot make a link here")
        try:
            with self.assertRaises(api.ApiError):
                api.handle("POST", "trash/delete", {}, {"name": link.name})
            with self.assertRaises(ValueError):  # even when something lists it
                from unittest import mock
                with mock.patch.object(store, "trash_list", return_value=[{"name": link.name}]):
                    store.trash_delete(link.name)
            self.assertTrue((outside / "keep.txt").is_file())
        finally:
            try:
                os.unlink(link)
            except OSError:
                os.rmdir(link)  # a junction

    def test_a_page_cannot_ask_for_it(self):
        m = store.publish(html="<p>x</p>", title="ops")
        dest = store.delete(store.publish(title="T", html="<p>t</p>")["id"])
        for op in ("trash.delete", "trash/delete", "trash"):
            with self.assertRaises(api.ApiError):
                api.handle("POST", f"artifacts/{m['id']}/op", {}, {"op": op, "args": {"name": dest.name}})
        self.assertTrue(dest.exists())

    def test_the_agent_has_no_way_to_purge(self):
        p = load_plugin()
        names = [t[0] for t in p.TOOLS]
        text = json.dumps([t[1] for t in p.TOOLS])
        for word in ("purge", "forever", "trash/delete", "trash_delete", "permanent"):
            self.assertNotIn(word, text.lower())
        self.assertFalse([n for n in names if "trash" in n or "purge" in n])
        aid = store.publish(title="Agent", html="<p>a</p>")["id"]
        r = json.loads(p._delete({"id": aid, "forever": True, "purge": True}))
        self.assertTrue(r["ok"], r)
        self.assertIn(aid, [t["id"] for t in store.trash_list()])  # still only moved to the trash


if __name__ == "__main__":
    unittest.main()
