"""The slide editor's saves (slides, deck.json, uploaded images) and versions that share files."""

import base64
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, render, store  # noqa: E402

PNG = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")).decode()


def op(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


class SaveTests(unittest.TestCase):
    def setUp(self):
        deck = {"title": "D", "order": ["a", "b"], "slides": [{"id": "a", "layout": "title", "title": "A"},
                                                                {"id": "b", "layout": "bullets", "title": "B"}]}
        self.aid = store.publish(title="Deck", type="slides", files={"deck.json": deck})["id"]

    def test_editor_save_with_an_image(self):
        r = op(self.aid, "save", base_version=1, files={
            "slides/s-new1.html": '<section id="s-new1"><img src="img/ab12.png" style="position:absolute"></section>\n',
            "img/ab12.png": "data:image/png;base64," + PNG,
            "deck.json": json.dumps({"title": "D", "order": ["a", "s-new1"], "slides": [{"id": "a", "layout": "title"}]})})
        self.assertTrue(r["ok"])
        vdir = store.version_dir(self.aid)
        self.assertEqual((vdir / "img" / "ab12.png").read_bytes()[:4], b"\x89PNG")
        c = render.content_json(vdir)
        self.assertTrue(c["img/ab12.png"].startswith("data:image/png;base64,"))
        self.assertEqual(json.loads(c["deck.json"])["order"], ["a", "s-new1"])

    def test_what_the_page_may_not_save(self):
        for files in ({"img/x.png": "data:text/html;base64,PGI+"}, {"img/x.svg": "data:image/svg+xml;base64,PHN2Zz4="},
                      {"img/x.png": "not a data uri"}, {"index.html": "<p>x</p>"}, {"slides/../x.html": "x"}):
            with self.assertRaises(api.ApiError, msg=files):
                op(self.aid, "save", files=files)

    def test_stale_base_is_a_conflict(self):
        op(self.aid, "save", base_version=1, files={"slides/a.html": '<section id="a"></section>'})
        r = op(self.aid, "save", base_version=1, files={"slides/a.html": '<section id="a"><p>x</p></section>'})
        self.assertTrue(r["conflict"])


class UnreadEditTests(unittest.TestCase):
    """Hermes' publish over a version the person saved, which Hermes hasn't read, is refused (Claude's rule)."""

    def test_publish_needs_a_read_after_the_persons_save(self):
        sys.path.insert(0, str(ROOT / "tests"))
        from test_types import load_plugin
        p = load_plugin()
        deck = {"title": "D", "order": ["a"], "slides": [{"id": "a", "layout": "title", "title": "A"}]}
        kw = {"session_id": "chat-1"}
        aid = json.loads(p._publish({"title": "D", "type": "slides", "files": {"deck.json": deck}, "open": False}, **kw))["id"]
        self.assertTrue(json.loads(p._publish({"id": aid, "files": {"deck.json": deck}, "open": False}, **kw))["ok"])
        op(aid, "save", base_version=2, files={"slides/a.html": '<section id="a"><p>mine</p></section>'})
        r = json.loads(p._publish({"id": aid, "files": {"deck.json": deck}, "open": False}, **kw))
        self.assertFalse(r["ok"])
        self.assertEqual((r["code"], r["version"]), ("unread_edit", 3))
        json.loads(p._read({"id": aid}, **kw))
        self.assertTrue(json.loads(p._publish({"id": aid, "files": {"deck.json": deck}, "open": False}, **kw))["ok"])


class SharedFileTests(unittest.TestCase):
    """A new version links the files it doesn't change; writing one must never touch an older version."""

    def test_older_versions_stay_as_they_were(self):
        aid = store.publish(title="Img", type="slides", files={"deck.json": {"order": []}, "img/a.png": {"base64": PNG},
                                                              "slides/a.html": "<section id=a>one</section>"})["id"]
        store.publish(aid=aid, base=True, files={"slides/a.html": "<section id=a>two</section>"})
        store.publish(aid=aid, base=True, files={"img/a.png": {"base64": base64.b64encode(b"GIF89a").decode()}})
        v1, v2, v3 = (store.version_dir(aid, n) for n in (1, 2, 3))
        self.assertIn("one", (v1 / "slides" / "a.html").read_text())
        self.assertIn("two", (v2 / "slides" / "a.html").read_text())
        self.assertEqual((v2 / "img" / "a.png").read_bytes()[:4], b"\x89PNG")
        self.assertEqual((v3 / "img" / "a.png").read_bytes(), b"GIF89a")

    def test_publishing_a_folder_over_a_base(self):
        aid = store.publish(title="F", html="<p>old</p>")["id"]
        src = Path(tempfile.mkdtemp()) / "site"
        src.mkdir()
        (src / "index.html").write_text("<p>new</p>", encoding="utf-8")
        store.publish(aid=aid, base=True, path=str(src))
        self.assertIn("old", (store.version_dir(aid, 1) / "index.html").read_text())
        self.assertIn("new", (store.version_dir(aid, 2) / "index.html").read_text())
        store.publish(aid=aid, base=True, html="<p>third</p>")
        self.assertIn("new", (store.version_dir(aid, 2) / "index.html").read_text())


class RuntimeTests(unittest.TestCase):
    def test_editor_presenter_and_text_layer_ship(self):
        m = store.publish(path=str(ROOT / "examples" / "slides-layout"), title="L", type="slides")
        html = render.render(m, store.version_dir(m["id"]))
        for marker in ("function magicMove", "function setPresenter", "kit.pdfText(PDFLib", "function itemOf(t)", "function reorder(el, ev)", "function detach()", "function drawProps()",
                       "window.slideTheme", "L.blank", "data-deco"):
            self.assertIn(marker, html)


if __name__ == "__main__":
    unittest.main()
