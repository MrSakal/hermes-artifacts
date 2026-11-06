"""Motion films: the example renders through the motion runtime, and the page may save only its own records."""

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

EXAMPLE = ROOT / "examples" / "motion"


def op(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


def content(html):
    start = html.index('id="hermes-artifact-content">') + len('id="hermes-artifact-content">')
    return json.loads(html[start:html.index("</script>", start)])


class MotionRenderTests(unittest.TestCase):
    def test_example_renders_with_the_runtime(self):
        m = store.publish(path=str(EXAMPLE), title="Harbor Lights", type="motion")
        html = render.render(m, store.version_dir(m["id"]))
        c = content(html)
        self.assertEqual(c["type"], "motion")
        for f in ("film.json", "modules/scenes.json", "modules/base.css", "modules/shared.js", "modules/score.js",
                  "modules/scene-harbor.js", "modules/scene-lamp.js", "modules/scene-walk.js"):
            self.assertIn(f, c["files"])
        # The runtime's own scripts are inlined, not referenced.
        for marker in ("window.FilmKit =", "window.MotionSound =", "window.MotionEncode =", "window.__motion =", 'id="stage"', 'id="mo-fx"'):
            self.assertIn(marker, html)
        for src in ('src="filmkit.js"', 'src="motion.js"', 'href="motion.css"'):
            self.assertNotIn(src, html)

    def test_example_is_a_valid_film(self):
        sj = json.loads((EXAMPLE / "modules" / "scenes.json").read_text("utf-8"))
        self.assertEqual(sj["stage"], "final")
        total = sum(s["dur"] for s in sj["scenes"])
        self.assertTrue(12 <= total <= 15, total)
        self.assertEqual(len(sj["scenes"]), 3)
        for s in sj["scenes"]:
            self.assertRegex(s["id"], r"^[a-z][a-z0-9-]{0,31}$")
            self.assertGreaterEqual(s["dur"], 1)
            self.assertTrue((EXAMPLE / "modules" / f"scene-{s['id']}.js").is_file(), s["id"])
        for p in sj["palettes"]:
            self.assertEqual(len(p), 4)
            for col in p:
                self.assertRegex(col, r"^#[0-9A-Fa-f]{6}$")
        base = (EXAMPLE / "modules" / "base.css").read_text("utf-8")
        for var in ("--ground", "--main", "--second", "--accent"):
            self.assertIn(var + ":#", base)

    def test_thumbnail_is_the_poster(self):
        m = store.publish(path=str(EXAMPLE), title="Harbor Lights", type="motion")
        html = render.render(m, store.version_dir(m["id"]), thumb=True)
        self.assertTrue(content(html)["thumb"])

    def test_guide(self):
        g = (render.TYPES_DIR / "motion" / "GUIDE.md").read_text("utf-8")
        for needle in ("modules/scenes.json", "kit.scene(", "kit.score(", "base=true", "three times a second", "retyped.json"):
            self.assertIn(needle, g)


class MotionSaveTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(path=str(EXAMPLE), title="Harbor Lights", type="motion")["id"]

    def test_the_page_saves_its_records(self):
        rec = {"retyped": {"v": 1, "lines": [{"scene": "harbor", "was": "Harbor Lights", "v": "Pier Lights"}]},
               "recolored": {"v": 1, "colors": [{"name": "--ground", "was": "#0F2233", "v": "#1D1B2E"}], "palette": 3},
               "refaced": {"v": 1, "slots": {"sans": {"was": None, "v": "manrope"}}},
               "recut": {"v": 1, "scenes": [{"id": "lamp", "dur": {"was": 4, "v": 5}}]},
               "retouched": {"v": 1, "layers": [{"id": "walk-1/h2", "cls": "line", "at": 2, "kin": [0, 1], "ink": {"was": "#f4e9d8", "v": "#ffcc00"}}]}}
        files = {f"modules/{k}.json": json.dumps(v) for k, v in rec.items()}
        r = op(self.aid, "save", base_version=1, files=files)
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["version"], 2)
        vdir = store.version_dir(self.aid)
        self.assertEqual(json.loads((vdir / "modules" / "recut.json").read_text("utf-8"))["scenes"][0]["dur"]["v"], 5)
        # The film's own code is still there, unchanged.
        self.assertEqual((vdir / "modules" / "scene-harbor.js").read_text("utf-8"),
                         (EXAMPLE / "modules" / "scene-harbor.js").read_text("utf-8"))
        # Reset all: null removes a record.
        r = op(self.aid, "save", base_version=2, files={"modules/recut.json": None})
        self.assertTrue(r["ok"], r)
        self.assertFalse((store.version_dir(self.aid) / "modules" / "recut.json").exists())

    def test_what_the_page_may_not_save(self):
        for files in ({"modules/scene-harbor.js": "kit.scene('harbor', {render(){}})"}, {"modules/scenes.json": "{}"},
                      {"modules/base.css": "#stage{}"}, {"modules/score.js": ""}, {"film.json": "{}"},
                      {"modules/fetched-fonts.json": "{}"}, {"modules/retyped~1.json": "{}"}, {"modules/../film.json": "{}"},
                      {"assets/logo.png": "data:image/png;base64,AAAA"}, {"modules/retyped.json": 5}):
            with self.assertRaises(api.ApiError, msg=files):
                op(self.aid, "save", files=files)

    def test_stale_base_is_a_conflict(self):
        op(self.aid, "save", base_version=1, files={"modules/recolored.json": "{}"})
        r = op(self.aid, "save", base_version=1, files={"modules/recolored.json": '{"v":1}'})
        self.assertTrue(r["conflict"])


if __name__ == "__main__":
    unittest.main()
