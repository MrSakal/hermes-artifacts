"""The gallery's listing (store.cards, GET artifacts, list_all): one scan of the data folder, an unchanged
artifact read from memory by its folder's stamp, every change that matters to a card seen (in this process
or another), and an etag that lets the gallery's poll come back empty when nothing changed."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, store  # noqa: E402

PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


def card(aid):
    return next((a for a in api.handle("GET", "artifacts", {}, None)["artifacts"] if a["id"] == aid), None)


class Trusting:
    """While it runs, a folder's stamp is trusted however recent the change (no RACY_S grace): what the
    listing does for every artifact not changed in the last two seconds."""

    def __enter__(self):
        self.p = mock.patch.object(store, "RACY_S", -1e12)
        self.p.start()

    def __exit__(self, *exc):
        self.p.stop()


class ListingTests(unittest.TestCase):
    def test_every_change_to_a_card_is_seen_by_its_folders_stamp(self):
        aid = store.publish(html="<p>a</p>", title="First", type="page")["id"]
        with Trusting():
            self.assertEqual(card(aid)["title"], "First")
            store.update_meta(aid, title="Second")
            self.assertEqual(card(aid)["title"], "Second")
            store.comment_add(aid, "look")
            self.assertEqual(card(aid)["comments"], 1)
            self.assertNotIn("preview", card(aid))
            store.preview_set(aid, PNG)
            self.assertTrue(card(aid)["preview"])
            store.publish(aid=aid, html="<p>b</p>")
            self.assertEqual(card(aid)["version"], 2)
            self.assertNotIn("preview", card(aid))  # the picture was of v1
            store.delete(aid)
            self.assertIsNone(card(aid))
            self.assertNotIn(aid, [m["id"] for m in store.list_all()])
            store.restore(aid)
            self.assertEqual(card(aid)["title"], "Second")

    def test_an_unchanged_artifact_is_not_looked_into(self):
        aid = store.publish(html="<p>a</p>", title="Still", type="page")["id"]
        with Trusting():
            store.cards()
            with mock.patch.object(store, "json_cached", side_effect=AssertionError("meta read again")), \
                    mock.patch.object(store, "open_user_comments", side_effect=AssertionError("comments read again")):
                self.assertIn(aid, [m["id"] for m in store.list_all()])
                self.assertEqual(card(aid)["title"], "Still")

    def test_a_change_just_made_is_looked_into_whatever_the_stamp(self):
        aid = store.publish(html="<p>a</p>", title="Racy", type="page")["id"]
        store.cards()
        p = store._dir(aid) / "meta.json"
        st = os.stat(store._dir(aid))
        # A write that leaves the folder's stamp as it was (in place, times put back): within RACY_S of the
        # folder's last change, meta.json's own stamp is still checked.
        p.write_text(p.read_text("utf-8").replace('"Racy"', '"Racy2"'), "utf-8")
        os.utime(store._dir(aid), ns=(st.st_atime_ns, st.st_mtime_ns))
        self.assertEqual(card(aid)["title"], "Racy2")

    def test_another_process_s_change_is_seen(self):
        aid = store.publish(html="<p>a</p>", title="Mine", type="page")["id"]
        with Trusting():
            self.assertEqual(card(aid)["title"], "Mine")
            code = ("import sys; sys.path.insert(0, sys.argv[1]); from hermes_artifacts import store; "
                    "store.update_meta(sys.argv[2], title='Theirs'); store.comment_add(sys.argv[2], 'from there')")
            env = dict(os.environ, HERMES_ARTIFACTS_DIR=str(store.root()))
            out = subprocess.run([sys.executable, "-c", code, str(PLUGIN), aid], env=env, capture_output=True,
                                 text=True, timeout=120)
            self.assertEqual(out.returncode, 0, out.stderr[-2000:])
            c = card(aid)
            self.assertEqual((c["title"], c["comments"]), ("Theirs", 1))


class EtagTests(unittest.TestCase):
    def test_an_unchanged_list_answers_empty(self):
        aid = store.publish(html="<p>a</p>", title="E", type="page")["id"]
        full = api.handle("GET", "artifacts", {}, None)
        self.assertIn("artifacts", full)
        tag = full["etag"]
        self.assertEqual(api.handle("GET", "artifacts", {"etag": tag}, None), {"unchanged": True, "etag": tag})
        store.update_meta(aid, pinned=True)
        again = api.handle("GET", "artifacts", {"etag": tag}, None)
        self.assertIn("artifacts", again)
        self.assertNotEqual(again["etag"], tag)
        self.assertEqual(api.handle("GET", "artifacts", {"etag": "something-else"}, None)["etag"], again["etag"])


if __name__ == "__main__":
    unittest.main()
