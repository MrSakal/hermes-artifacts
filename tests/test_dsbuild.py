"""A design system's generated files, as Claude's Design System type writes them on every save."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import dsbuild, store  # noqa: E402

NODE = shutil.which("node")
TOKENS = {"name": "T", "color": {"themes": [{"id": "light", "name": "Light"}, {"id": "dark", "name": "Dark"}],
                                  "tokens": [{"name": "bg", "value": {"light": "#FFF", "dark": "#111111"}, "usage": "Page."},
                                             {"name": "ink", "value": {"light": "#222", "dark": "#eee"}, "usage": "Text on bg."},
                                             {"name": "focus", "value": "{ink}"}, {"name": "bad", "value": "red"},
                                             {"name": "loop", "value": "{loop}"}, {"name": "ok.5", "value": "rgb(1 2 3 / 50%)"}]},
          "type": {"fonts": [{"family": "Acme", "file": "Acme.woff2", "weight": "300 800"}],
                   "families": {"Sans": '"Acme", system-ui, sans-serif'},
                   "groups": [{"name": "Text", "family": "sans", "styles": [{"name": "body", "fontSize": 15, "lineHeight": 1.4, "fontWeight": "bold"},
                                                                            {"name": "2xl", "fontSize": "2rem"}]}]},
          "spacing": {"tokens": [{"name": "space-1", "value": 4}, {"name": "space-x", "value": "big"}]},
          "radius": {"tokens": [{"name": "r", "value": "8px"}]},
          "shadow": {"tokens": [{"name": "s1", "value": {"light": "0 1px 2px #0003", "dark": "0 1px 2px #000"}}]},
          "zIndex": {"tokens": [{"name": "z-top", "value": "100"}]}}

PARITY = r"""
global.window = {}; global.CSS = { escape: (s) => s.replace(/\./g, '\\.').replace(/^(\d)/, '\\3$1 ') };
eval(require('fs').readFileSync(process.argv[1], 'utf8'));
const r = window.dsKit.compile(JSON.parse(process.argv[2]));
console.log(JSON.stringify({ css: r.css, problems: r.problems.length }));
"""


class BuildTests(unittest.TestCase):
    def test_tokens_css_matches_the_pages_compiler(self):
        css, m = dsbuild.compile_css(TOKENS, "T")
        self.assertTrue(css.startswith("/* T — generated from tokens.json */\n"))
        self.assertIn("--focus: var(--ink);", css)
        self.assertNotIn("--bad", css)
        self.assertNotIn("--loop", css)
        self.assertIn("--space-1: 4px;", css)
        self.assertIn("--ok\\.5: rgb(1 2 3 / 50%);", css)
        self.assertIn(".\\32 xl {", css)
        names = {(p["family"], p["name"]) for p in m["problems"]}
        self.assertTrue({("color", "bad"), ("color", "loop"), ("spacing", "space-x")} <= names)
        if NODE:
            r = subprocess.run([NODE, "-e", PARITY, str(PLUGIN / "hermes_artifacts" / "types" / "_kit" / "ds.js"), json.dumps(TOKENS)],
                               capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
            js = json.loads(r.stdout)
            self.assertEqual(css.split("\n", 1)[1], js["css"])
            self.assertEqual(len(m["problems"]), js["problems"])

    def test_publish_writes_the_generated_files_once(self):
        m = store.publish(path=str(ROOT / "examples" / "design-system"), title="Kiln", type="design-system")
        aid = m["id"]
        files = store.list_files(aid)
        for p in ("tokens.css", "manifest.json", "api/tokens.md", "api/components/Button.md", "api/assets/Marks.md"):
            self.assertIn(p, files)
        man = json.loads(store.read_file(aid, "manifest.json"))
        self.assertEqual((man["manifestVersion"], man["namespace"]), (3, "Kiln"))
        self.assertIn("Button", [c["name"] for c in man["components"]])
        card = store.read_file(aid, "api/components/Button.md").decode()
        self.assertIn('<x-import component-from-global-scope="Kiln.Button">', card)
        self.assertIn("| `label` (required) | `string` |", card)
        store.publish(aid=aid, base=True, files={"design-system.json": store.read_file(aid, "design-system.json").decode()})
        readme = store.read_file(aid, "README.md").decode()
        self.assertEqual(readme.count("## Consuming this system"), 1)
        self.assertEqual(readme.count(dsbuild.README_MARK), 1)

    def test_a_windows_readme_keeps_one_generated_part(self):
        files = {"design-system.json": '{"v": 3, "title": "W"}', "tokens.json": json.dumps(TOKENS), "README.md": "Brand.\r\n"}
        once = dsbuild.build(files, {"title": "W"})["README.md"]
        twice = dsbuild.build({**files, "README.md": once.replace("\n", "\r\n")}, {"title": "W"})["README.md"]
        self.assertEqual(twice.count(dsbuild.README_MARK), 1)
        self.assertEqual(twice.count("## Consuming this system"), 1)
        self.assertTrue(twice.startswith("Brand.\n"))

    def test_gallery_folders_and_last_opened(self):
        from hermes_artifacts import api
        a = store.publish(title="F1", html="<p>x</p>")["id"]
        self.assertIsNone(api.handle("GET", "artifacts", {}, None)["artifacts"][0].get("opened") if False else None)
        v = api.handle("POST", f"artifacts/{a}/meta", {}, {"opened": True, "folder": "  Q4   reports "})
        self.assertEqual(v["folder"], "Q4 reports")
        self.assertIsInstance(v["opened"], float)
        self.assertIn("Q4 reports", api.handle("GET", "artifacts", {}, None)["folders"])
        api.handle("POST", "folders", {}, {"name": "Empty one"})
        self.assertIn("Empty one", api.handle("GET", "artifacts", {}, None)["folders"])
        self.assertIsNone(api.handle("POST", f"artifacts/{a}/meta", {}, {"folder": ""})["folder"])
        api.handle("POST", "folders", {}, {"name": "Empty one", "delete": True})
        self.assertNotIn("Empty one", api.handle("GET", "artifacts", {}, None)["folders"])
        with self.assertRaises(api.ApiError):
            api.handle("POST", "folders", {}, {"name": "  "})

    def test_a_stylesheet_of_their_own_stays(self):
        m = store.publish(title="Own", type="design-system", files={
            "design-system.json": {"v": 3, "title": "Own"}, "tokens.json": TOKENS, "README.md": "Use it.",
            "tokens.css": ":root { --x: 1px; }"})
        self.assertEqual(store.read_file(m["id"], "tokens.css").decode(), ":root { --x: 1px; }")

    def test_the_page_uploads_fonts_and_deletes_files(self):
        from hermes_artifacts import api
        aid = store.publish(title="F", type="design-system", files={
            "design-system.json": {"v": 3, "title": "F"}, "tokens.json": TOKENS, "README.md": "x", "notes.md": "n"})["id"]
        op = lambda files: api.handle("POST", f"artifacts/{aid}/op", {}, {"op": "save", "args": {"files": files}})
        self.assertTrue(op({"fonts/Acme.woff2": "data:font/woff2;base64,d09GMgABAAAA"})["ok"])
        self.assertEqual(store.read_file(aid, "fonts/Acme.woff2")[:4], b"wOF2")
        for bad in ({"fonts/x.woff2": "not a data uri"}, {"fonts/x.exe": "data:font/woff2;base64,AAAA"}, {"api/tokens.md": "mine"}):
            with self.assertRaises(api.ApiError, msg=bad):
                op(bad)
        self.assertTrue(op({"notes.md": None})["ok"])
        self.assertNotIn("notes.md", store.list_files(aid))

    def test_the_gallery_sees_and_sets_the_default(self):
        from hermes_artifacts import api
        a = store.publish(title="A", type="design-system", files={"design-system.json": {"v": 3, "title": "A"}, "tokens.json": TOKENS, "README.md": "a"})["id"]
        b = store.publish(title="B", type="design-system", files={"design-system.json": {"v": 3, "title": "B"}, "tokens.json": TOKENS, "README.md": "b"})["id"]
        op = lambda aid, on: api.handle("POST", f"artifacts/{aid}/op", {}, {"op": "ds.default", "args": {"on": on}})
        try:
            self.assertEqual(op(a, True)["default"], a)
            self.assertEqual(api.handle("GET", "artifacts", {}, None)["default_design_system"], a)
            self.assertEqual(op(b, True)["default"], b)  # one default at a time
            self.assertIsNone(op(b, False)["default"])
            self.assertIsNone(api.handle("GET", "artifacts", {}, None)["default_design_system"])
        finally:
            store.settings_set("default_design_system", None)

    def test_a_system_from_claude_comes_up_from_project(self):
        src = Path(tempfile.mkdtemp()) / "sys"
        (src / "project" / "components" / "Tag").mkdir(parents=True)
        (src / "artifact-type").mkdir()
        (src / "SKILL.md").write_text("type's", encoding="utf-8")
        (src / "artifact-type" / "app.js").write_text("x", encoding="utf-8")
        (src / "project" / "design-system.json").write_text(json.dumps({"v": 3, "title": "Moved"}), encoding="utf-8")
        (src / "project" / "tokens.json").write_text(json.dumps(TOKENS), encoding="utf-8")
        (src / "project" / "README.md").write_text("Brand.", encoding="utf-8")
        (src / "project" / "components" / "Tag" / "README.md").write_text("A tag marks a state.", encoding="utf-8")
        m = store.publish(path=str(src), title="Moved", type="design-system")
        files = store.list_files(m["id"])
        self.assertIn("design-system.json", files)
        self.assertIn("api/components/Tag.md", files)
        self.assertFalse(any(f.startswith(("project/", "artifact-type/")) or f == "SKILL.md" for f in files))


if __name__ == "__main__":
    unittest.main()
