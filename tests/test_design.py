"""The design canvas: the example renders through its runtime, and what its editor may save."""

import base64
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, render, store  # noqa: E402

PNG = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")).decode()
DC = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>X</title><script src="./support.js"></script>'
      '</head><body><x-dc><div style="padding: 8px">Hi</div></x-dc><script type="text/x-dc" data-dc-script>'
      'class Component extends DCLogic { renderVals() { return {}; } }</script></body></html>')


def op(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


def content(html):
    start = html.index('id="hermes-artifact-content">') + len('id="hermes-artifact-content">')
    return json.loads(html[start:html.index("</script>", start)])


class RenderTests(unittest.TestCase):
    def test_example_renders_with_the_runtime(self):
        m = store.publish(path=str(ROOT / "examples" / "design"), title="design", type="design")
        html = render.render(m, store.version_dir(m["id"]))
        c = content(html)
        self.assertEqual(c["type"], "design")
        canvas = json.loads(c["files"]["canvas.json"])
        for p in canvas["order"]:
            self.assertIn(p, c["files"])
            self.assertIn("<x-dc>", c["files"][p])
        self.assertTrue(c["files"]["uploads/hero.png"].startswith("data:image/png;base64,"))
        self.assertEqual(canvas["boards"]["Main.dc.html"]["expand"], "fill")
        self.assertTrue(canvas["boards"]["Order.dc.html"]["is_interactive"])
        self.assertIn('href="Checkout.dc.html"', c["files"]["Order.dc.html"])
        self.assertIn('"accent":{"editor":"color"', c["files"]["Poster.dc.html"])
        kinds = {n.get("kind", "sticky") for n in canvas["notes"].values()}
        self.assertEqual(kinds, {"title1", "sticky"})
        # The runtime, inlined: the template runtime, the artboard agent (inert in the page), the kit and ds kit.
        self.assertIn("window.DC = {", html)
        self.assertRegex(html, r'<script type="text/x-dc-frame" data-dc="frame"\s*>')
        self.assertRegex(html, r'<script data-dc="kit"\s*>')
        self.assertIn("window.dsKit", html)
        self.assertIn("window.__design", html)
        for ref in ('src="design.js"', 'src="dc.js"', 'src="frame.js"', 'href="design.css"'):
            self.assertNotIn(ref, html)

    def test_thumbnail(self):
        m = store.publish(path=str(ROOT / "examples" / "design"), title="design", type="design")
        c = content(render.render(m, store.version_dir(m["id"]), thumb=True))
        self.assertTrue(c["thumb"])

    def test_guide_documents_the_format(self):
        g = (render.TYPES_DIR / "design" / "GUIDE.md").read_text("utf-8")
        for word in ("canvas.json", "<x-dc>", "<sc-for", "<sc-if", "<dc-import", "data-props", "DCLogic",
                     "is_interactive", "expand", "designSystems", "artifact_list type=design-system", "base=true",
                     "visibleArtboards", "print"):
            self.assertIn(word, g, word)


class SaveTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(title="Canvas", type="design", files={
            "canvas.json": {"v": 3, "boards": {"Main.dc.html": {"x": 0, "y": 0, "w": 400, "h": 300}}, "order": ["Main.dc.html"]},
            "Main.dc.html": DC})["id"]

    def test_editor_saves_the_index_artboards_and_uploads(self):
        r = op(self.aid, "save", base_version=1, files={
            "canvas.json": json.dumps({"v": 3, "boards": {"Main.dc.html": {"x": 80, "y": 0, "w": 400, "h": 300, "props": {"accent": "#ff0000"}}}}),
            "Main.dc.html": DC.replace("Hi", "Hello"),
            "screens/app/flow/Deep.dc.html": DC,
            "uploads/ab12cd34.png": "data:image/png;base64," + PNG})
        self.assertTrue(r["ok"], r)
        vdir = store.version_dir(self.aid)
        self.assertEqual((vdir / "uploads" / "ab12cd34.png").read_bytes()[:4], b"\x89PNG")
        files = render.content_json(vdir)
        self.assertIn("Hello", files["Main.dc.html"])
        self.assertIn("screens/app/flow/Deep.dc.html", files)
        self.assertEqual(json.loads(files["canvas.json"])["boards"]["Main.dc.html"]["props"]["accent"], "#ff0000")
        self.assertTrue(files["uploads/ab12cd34.png"].startswith("data:image/png;base64,"))

    def test_an_artboard_can_be_removed(self):
        op(self.aid, "save", base_version=1, files={"Other.dc.html": DC})
        r = op(self.aid, "save", base_version=2, files={"Other.dc.html": None})
        self.assertTrue(r["ok"])
        self.assertNotIn("Other.dc.html", render.content_json(store.version_dir(self.aid)))

    def test_what_the_page_may_not_save(self):
        for files in ({"index.html": "<p>x</p>"}, {"Main.html": DC}, {"../x.dc.html": DC}, {"/x.dc.html": DC},
                      {"a/b/c/d/Deep.dc.html": DC}, {".hidden.dc.html": DC}, {"has space.dc.html": DC},
                      {"ds/ember/tokens.json": "{}"}, {"uploads/x.svg": "data:image/svg+xml;base64,PHN2Zz4="},
                      {"uploads/x.png": "data:text/html;base64,PGI+"}, {"uploads/x.png": "not a data uri"},
                      {"img/x.png": "data:image/png;base64," + PNG}, {"uploads/sub/x.png": "data:image/png;base64," + PNG},
                      {"canvas.json": {"v": 3}}):
            with self.assertRaises(api.ApiError, msg=files):
                op(self.aid, "save", files=files)

    def test_stale_base_is_a_conflict(self):
        op(self.aid, "save", base_version=1, files={"Main.dc.html": DC.replace("Hi", "One")})
        r = op(self.aid, "save", base_version=1, files={"Main.dc.html": DC.replace("Hi", "Two")})
        self.assertTrue(r["conflict"])
        self.assertIn("One", render.content_json(store.version_dir(self.aid))["Main.dc.html"])


if __name__ == "__main__":
    unittest.main()
