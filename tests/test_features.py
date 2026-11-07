"""Multi-file publish, bundling, delete, pin, comments, ask/reply."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import bundle, render, store  # noqa: E402

PNG = {"base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="}


class FeatureTests(unittest.TestCase):
    def test_files_publish_and_bundle(self):
        m = store.publish(title="multi", files={
            "index.html": '<html><head><link rel="stylesheet" href="css/a.css"><script src="app.js"></script>'
                          '</head><body><img src="img/p.png"><a href="two.html">2</a>'
                          '<img src="https://x.test/y.png"></body></html>',
            "css/a.css": "body{background:url(../img/p.png)}",
            "app.js": "window.ok = '</script>';",
            "img/p.png": PNG, "two.html": "<p>two</p>"})
        vdir = store.version_dir(m["id"])
        out = bundle.bundle(vdir)
        self.assertNotIn('src="app.js"', out)
        self.assertIn("window.ok", out)
        self.assertNotIn("</script>';", out)
        self.assertEqual(out.count("data:image/png;base64"), 2)
        self.assertIn('data-hermes-page="two.html"', out)
        self.assertIn("https://x.test/y.png", out)
        self.assertIn("two", render.render(m, vdir, page="two.html"))

    def test_base_and_remove(self):
        m = store.publish(title="b", files={"index.html": "<p>1</p>", "x.txt": "x"})
        m = store.publish(aid=m["id"], base=True, files={"x.txt": None, "y.txt": "y"})
        self.assertEqual(store.list_files(m["id"]), ["index.html", "y.txt"])
        self.assertEqual(store.list_files(m["id"], 1), ["index.html", "x.txt"])

    def test_rejects_bad_paths_and_missing_entry(self):
        for bad in ("../x", "/abs", "a/../../b", ".hidden"):
            with self.assertRaises(ValueError):
                store.publish(title="p", files={"index.html": "x", bad: "y"})
        with self.assertRaises(ValueError):
            store.publish(title="p", files={"other.html": "x"})
        with self.assertRaises(ValueError):
            store.publish(title="d", type="dashboard", files={"index.html": "x"})

    def test_type_is_fixed(self):
        m = store.publish(title="t", files={"index.html": "x"})
        with self.assertRaises(ValueError):
            store.publish(aid=m["id"], type="slides", files={"deck.json": "{}"})

    def test_pin_delete(self):
        m = store.publish(title="pin", html="<p>x</p>")
        self.assertTrue(store.update_meta(m["id"], pinned=True)["pinned"])
        dest = store.delete(m["id"])
        self.assertTrue((dest / "meta.json").is_file())
        self.assertIsNone(store.get_meta(m["id"]))
        self.assertNotIn(m["id"], [x["id"] for x in store.list_all()])

    def test_comments_and_reply(self):
        aid = store.publish(title="c", html="<p>x</p>")["id"]
        c = store.comment_add(aid, "make it blue", anchor={"selector": "#h1", "text": "Hi", "evil": "x"})
        self.assertNotIn("evil", c["anchor"])
        r = store.comment_add(aid, "done", author="hermes", parent=c["id"])
        store.comment_resolve(aid, c["id"])
        self.assertEqual(len(store.comments_list(aid, include_resolved=False)), 1)
        self.assertEqual(r["parent"], c["id"])
        with self.assertRaises(ValueError):
            store.comment_add(aid, "x", parent="nope")
        ask = store.inbox_add(aid, "what next?", kind="ask")
        store.reply_set(aid, ask["id"], "this", {"n": 1})
        self.assertEqual(store.reply_get(aid, ask["id"])["data"], {"n": 1})
        other = store.publish(title="o", html="x")["id"]
        with self.assertRaises(FileNotFoundError):
            store.reply_set(other, ask["id"], "no")


if __name__ == "__main__":
    unittest.main()
