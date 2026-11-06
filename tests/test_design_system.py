"""The design-system type: its runtime renders the example, the page may save only its own paths,
other artifacts get a system through ds.get, and dsKit compiles tokens.json as the format says."""

import base64
import json
import os
import shutil
import subprocess
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
EXAMPLE = ROOT / "examples" / "design-system"


def op(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


def content(html):
    start = html.index('id="hermes-artifact-content">') + len('id="hermes-artifact-content">')
    return json.loads(html[start:html.index("</script>", start)])


class RenderTests(unittest.TestCase):
    def test_example_renders_through_the_runtime(self):
        m = store.publish(path=str(EXAMPLE), title="Kiln", type="design-system")
        html = render.render(m, store.version_dir(m["id"]))
        c = content(html)
        self.assertEqual(c["type"], "design-system")
        for p in ("design-system.json", "tokens.json", "README.md", "layout.md", "components/bundle.js",
                  "components/Cover/preview.html", "components/Button/preview.html", "assets/Marks/kiln-mark.svg"):
            self.assertIn(p, c["files"])
        self.assertIn('id="ds-nav"', html)          # the runtime's page
        self.assertIn("window.dsKit =", html)       # the shared helper, inlined
        self.assertIn("window.md =", html)          # the markdown renderer
        self.assertNotIn('src="ds-page.js"', html)  # everything inlined
        self.assertTrue(c["files"]["components/Button/preview.html"].startswith("<!-- @dsCard"))
        self.assertEqual(json.loads(c["files"]["design-system.json"])["namespace"], "Kiln")

    def test_thumbnail(self):
        m = store.publish(path=str(EXAMPLE), title="Kiln", type="design-system")
        c = content(render.render(m, store.version_dir(m["id"]), thumb=True))
        self.assertTrue(c["thumb"])

    def test_needs_its_index(self):
        with self.assertRaises(ValueError):
            store.publish(title="x", type="design-system", files={"tokens.json": "{}"})

    def test_guide(self):
        g = (ROOT / "hermes_artifacts" / "types" / "design-system" / "GUIDE.md").read_text("utf-8")
        for s in ("design-system.json", "tokens.json", "default_design_system", "base=true", "README.md"):
            self.assertIn(s, g)

    def test_content_is_in_the_users_language(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", ROOT / "__init__.py",
                                                      submodule_search_locations=[str(ROOT)])
        plugin = sys.modules.get("hermes_artifacts_plugin")
        if plugin is None:
            plugin = importlib.util.module_from_spec(spec)
            sys.modules["hermes_artifacts_plugin"] = plugin
            spec.loader.exec_module(plugin)
        for kind in ("page", "dashboard", "slides", "doc", "design", "motion", "design-system"):
            out = json.loads(plugin._guide({"type": kind}))
            self.assertIn("language the user asked in", out["language"], kind)
        pub = [t for t in plugin.TOOLS if t[0] == "artifact_publish"][0][1]
        self.assertIn("language the user asked in", json.dumps(pub))


class SaveTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(title="DS", type="design-system", files={
            "design-system.json": {"v": 3, "title": "DS", "namespace": "DS", "libraries": [], "groups": [], "assetGroups": {}},
            "tokens.json": {"color": {"tokens": [{"name": "ink", "value": "#111111"}]}},
            "README.md": "# DS\n"})["id"]

    def test_the_page_saves_its_own_paths(self):
        r = op(self.aid, "save", base_version=1, files={
            "tokens.json": json.dumps({"color": {"tokens": [{"name": "ink", "value": "#222222", "usage": "Text."}]}}),
            "README.md": "# DS\n\nNew rules.\n",
            "voice.md": "# Voice\n",
            "components/Button/README.md": "# Button\n\nOne action.\n",
            "assets/Logos/mark.png": "data:image/png;base64," + PNG,
            "assets/Photo_shoots/studio-1.webp": "data:image/webp;base64," + PNG,
            "design-system.json": json.dumps({"v": 3, "title": "DS", "groups": ["Logos"],
                                              "assetGroups": {"Logos": {"name": "Logos", "order": ["mark.png"]}}})})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["version"], 2)
        vdir = store.version_dir(self.aid)
        self.assertEqual((vdir / "assets" / "Logos" / "mark.png").read_bytes()[:4], b"\x89PNG")  # stored as binary
        self.assertIn("New rules.", (vdir / "README.md").read_text("utf-8"))
        self.assertTrue((vdir / "voice.md").is_file())
        c = render.content_json(vdir)
        self.assertTrue(c["assets/Logos/mark.png"].startswith("data:image/png;base64,"))

    def test_what_the_page_may_not_save(self):
        for files in ({"components/bundle.js": "window.x=1"}, {"components/Button/preview.html": "<p>x</p>"},
                      {"components/bundle.css": "a{}"}, {"tokens.css": ":root{}"}, {"fonts/a.woff2": "data:font/woff2;base64,AA"},
                      {"assets/Logos/mark.svg": "data:image/svg+xml;base64,PHN2Zz4="},
                      {"assets/Logos/mark.png": "data:text/html;base64,PGI+"}, {"assets/Logos/mark.png": "not a data uri"},
                      {"assets/mark.png": "data:image/png;base64," + PNG}, {"docs/notes.md": "x"}, {"../x.md": "x"},
                      {"components/Button/x/README.md": "x"}, {"index.html": "<p>x</p>"}, {".env.md": "x"},
                      {"assets/Photo shoots/a.png": "data:image/png;base64," + PNG}):  # no spaces in stored paths
            with self.assertRaises(api.ApiError, msg=files):
                op(self.aid, "save", files=files)

    def test_stale_base_is_a_conflict(self):
        op(self.aid, "save", base_version=1, files={"README.md": "# a\n"})
        r = op(self.aid, "save", base_version=1, files={"README.md": "# b\n"})
        self.assertTrue(r["conflict"])


class DefaultTests(unittest.TestCase):
    def setUp(self):
        store.settings_set("default_design_system", None)
        self.ds = store.publish(path=str(EXAMPLE), title="Kiln", type="design-system")["id"]
        self.page = store.publish(title="p", files={"index.html": "<p>x</p>"})["id"]

    def tearDown(self):
        store.settings_set("default_design_system", None)

    def test_get_and_default(self):
        self.assertEqual(op(self.page, "ds.get"), {"none": True})
        got = op(self.page, "ds.get", id=self.ds)  # any page may build on a named system
        self.assertEqual(got["id"], self.ds)
        self.assertEqual(got["title"], "Kiln")
        self.assertIn(".kl-btn", got["css"])
        self.assertEqual(got["tokens"]["color"]["themes"][0]["id"], "light")
        self.assertIn("Content fundamentals", got["readme"])

        self.assertEqual(op(self.ds, "ds.default", on=True)["default"], self.ds)
        self.assertEqual(op(self.page, "ds.get")["id"], self.ds)  # no id: the default
        self.assertEqual(store.settings()["default_design_system"], self.ds)

        self.assertIsNone(op(self.ds, "ds.default", on=False)["default"])
        self.assertEqual(op(self.page, "ds.get"), {"none": True})

    def test_only_a_design_system_can_be_the_default(self):
        with self.assertRaises(api.ApiError):
            op(self.page, "ds.default", on=True)

    def test_artifact_list_names_the_default(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", ROOT / "__init__.py",
                                                      submodule_search_locations=[str(ROOT)])
        p = importlib.util.module_from_spec(spec)
        sys.modules["hermes_artifacts_plugin"] = p
        spec.loader.exec_module(p)
        op(self.ds, "ds.default", on=True)
        out = json.loads(p._list({"type": "design-system"}))
        self.assertEqual(out["default_design_system"], self.ds)
        self.assertTrue(all(a["type"] == "design-system" for a in out["artifacts"]))


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class CompileTests(unittest.TestCase):
    """dsKit.compile against the format's drop rules (run in node)."""

    def run_js(self, tokens, expr):
        js = ("global.window = global; require(%s); var t = %s; var r = dsKit.compile(t); "
              "process.stdout.write(JSON.stringify(%s));") % (
            json.dumps(str(ROOT / "hermes_artifacts" / "types" / "_kit" / "ds.js")), json.dumps(tokens), expr)
        out = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_example_compiles_clean(self):
        tokens = json.loads((EXAMPLE / "tokens.json").read_text("utf-8"))
        r = self.run_js(tokens, "{css: r.css, problems: r.problems, themes: dsKit.themes(t)}")
        self.assertEqual(r["problems"], [])
        self.assertEqual(r["themes"], [{"id": "light", "name": "Light"}, {"id": "dark", "name": "Dark"}])
        css = r["css"]
        self.assertIn(':root, [data-theme="light"] {\n  --bone: #f6f1e9;', css)
        self.assertIn('[data-theme="dark"] {\n  --bone: #1b1916;', css)
        self.assertIn("--focus: var(--ink);", css.split('[data-theme="dark"]')[1])  # aliases re-declared per theme
        self.assertIn("--space-4: 16px;", css)
        self.assertIn("--font-serif:", css)
        self.assertIn(".label {", css)

    def test_drops(self):
        tokens = {"color": {"themes": [{"id": "light"}, {"id": "dark"}], "tokens": [
            {"name": "ok", "value": {"light": "#ABC", "dark": "rgb(1 2 3 / 50%)"}},
            {"name": "named", "value": "red"}, {"name": "v", "value": "var(--x)"}, {"name": "mix", "value": "color-mix(in srgb, #fff, #000)"},
            {"name": "self", "value": "{self}"}, {"name": "missing", "value": "{nope}"}, {"name": "ok", "value": "#000"},
            {"name": "bad name", "value": "#000"}, {"name": "later", "value": {"dark": "#123456"}}]},
            "type": {"families": {"Sans": "Inter, sans-serif", "bad": "x;y"},
                     "groups": [{"name": "T", "family": "sans", "styles": [{"name": "body", "fontSize": 15, "lineHeight": 1.4, "fontWeight": "bold"},
                                                                         {"name": "big", "fontSize": "huge"}]}]},
            "spacing": {"tokens": [{"name": "space-1.5", "value": "6px"}, {"name": "ok", "value": "4px"}, {"name": "auto", "value": "auto"}]},
            "zIndex": {"tokens": [{"name": "z-top", "value": "100"}, {"name": "z-url", "value": "url(x)"}]},
            "opacity": {"brand": {"$value": 1}}}
        r = self.run_js(tokens, "{css: r.css, dropped: r.problems.map(function (p) { return p.family + '/' + p.name; })}")
        css, dropped = r["css"], r["dropped"]
        for name in ("color/named", "color/v", "color/mix", "color/self", "color/missing", "color/ok", "color/bad name",
                     "type/bad", "type/big", "spacing/ok", "spacing/auto", "zIndex/z-url", "opacity/"):
            self.assertIn(name, dropped)
        self.assertIn("--ok: #abc;", css)                    # hex lowercased
        self.assertIn("--later: #123456;", css)              # a value only in a later theme is borrowed for the first
        self.assertIn("--space-1\\.5: 6px;", css)            # dots escaped
        self.assertIn("--z-top: 100;", css)
        self.assertIn("font-size: 15px;", css)
        self.assertIn("line-height: 1.4;", css)
        self.assertIn("font-weight: 700;", css)
        self.assertNotIn("--named", css)
        self.assertNotIn("--self", css)


if __name__ == "__main__":
    unittest.main()
