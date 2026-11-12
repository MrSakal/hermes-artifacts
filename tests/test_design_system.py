"""The design-system type: its runtime renders the example, the page may save only its own paths,
other artifacts get a system through ds.get, and dsKit compiles tokens.json as the format says."""

import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
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
        g = (PLUGIN / "hermes_artifacts" / "types" / "design-system" / "GUIDE.md").read_text("utf-8")
        for s in ("design-system.json", "tokens.json", "default_design_system", "base=true", "README.md"):
            self.assertIn(s, g)

    def test_content_is_in_the_users_language(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", PLUGIN / "__init__.py",
                                                      submodule_search_locations=[str(PLUGIN)])
        plugin = sys.modules.get("hermes_artifacts_plugin")
        if plugin is None:
            plugin = importlib.util.module_from_spec(spec)
            sys.modules["hermes_artifacts_plugin"] = plugin
            spec.loader.exec_module(plugin)
        for kind in ("page", "dashboard", "slides", "doc", "sheet", "design", "motion", "design-system"):
            out = json.loads(plugin._guide({"type": kind}))
            self.assertIn("language the user asked in", out["language"], kind)
        pub = [t for t in plugin.TOOLS if t[0] == "ha_publish"][0][1]
        self.assertIn("language the user asked in", json.dumps(pub))

    def test_the_system_while_coding(self):
        import importlib.util
        plugin = sys.modules.get("hermes_artifacts_plugin")
        if plugin is None:
            spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", PLUGIN / "__init__.py",
                                                          submodule_search_locations=[str(PLUGIN)])
            plugin = importlib.util.module_from_spec(spec)
            sys.modules["hermes_artifacts_plugin"] = plugin
            spec.loader.exec_module(plugin)
        store.settings_set("default_design_system", None)
        try:
            self.assertIsNone(plugin._view_context(session_id="none-open"))
            self.assertTrue(json.loads(plugin._ds_get({}))["design_system"]["none"])  # only a call shows it
            kiln = store.publish(path=str(ROOT / "examples" / "design-system"), title="Kiln", type="design-system")["id"]
            store.settings_set("default_design_system", kiln)
            self.assertIsNone(plugin._view_context(session_id="none-open"))  # like Claude: no line per turn
            ds = json.loads(plugin._ds_get({}))["design_system"]
            self.assertTrue(ds["default"])
            self.assertIn("--ink", ds["tokens_css"])
            self.assertIn("components/bundle.js", ds["files"])
            work, saved = Path(tempfile.mkdtemp()), plugin._ctx
            plugin._ctx = types.SimpleNamespace(session_cwd=lambda: str(work))  # the chat's working directory
            out = work / "src" / "design-system"
            r = json.loads(plugin._ds_export({"dir": str(out)}))
            self.assertTrue(r["ok"], r)
            self.assertTrue((out / "tokens.css").is_file() and (out / "components" / "bundle.js").is_file())
            self.assertFalse(json.loads(plugin._ds_export({"dir": str(out)}))["ok"])  # not empty: no overwrite
            (out / "mine.txt").write_text("keep", encoding="utf-8")
            r = json.loads(plugin._ds_export({"dir": str(out), "overwrite": True, "only": ["tokens.css"]}))
            self.assertEqual(r["files"], ["tokens.css"])
            self.assertEqual((out / "mine.txt").read_text(encoding="utf-8"), "keep")
            self.assertIn("ha_design_system_get", [t[0] for t in plugin.TOOLS])
        finally:
            plugin._ctx = saved if "saved" in locals() else plugin._ctx
            store.settings_set("default_design_system", None)

    def test_a_card_saved_before_the_rename_reads_with_the_new_tool_name(self):
        import importlib.util
        plugin = sys.modules.get("hermes_artifacts_plugin")
        if plugin is None:
            spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", PLUGIN / "__init__.py",
                                                          submodule_search_locations=[str(PLUGIN)])
            plugin = importlib.util.module_from_spec(spec)
            sys.modules["hermes_artifacts_plugin"] = plugin
            spec.loader.exec_module(plugin)
        kiln = store.publish(path=str(EXAMPLE), title="Kiln", type="design-system")["id"]
        card = next(p for p in store.list_files(kiln) if p.startswith("api/assets/"))
        f = store.version_dir(kiln, 1) / card
        self.assertIn("(`ha_read` with `path`)", f.read_text("utf-8"))  # a new save writes the new name
        f.write_text(f.read_text("utf-8").replace("`ha_read`", "`artifact_read`"), encoding="utf-8")
        text = json.loads(plugin._read({"id": kiln, "path": card}))["content"]
        self.assertIn("(`ha_read` with `path`)", text)
        self.assertNotIn("artifact_read", text)

    def test_an_artifact_keeps_the_version_it_was_built_on(self):
        import importlib.util
        plugin = sys.modules.get("hermes_artifacts_plugin")
        if plugin is None:
            spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", PLUGIN / "__init__.py",
                                                          submodule_search_locations=[str(PLUGIN)])
            plugin = importlib.util.module_from_spec(spec)
            sys.modules["hermes_artifacts_plugin"] = plugin
            spec.loader.exec_module(plugin)
        store.settings_set("default_design_system", None)
        try:
            ds = store.publish(path=str(ROOT / "examples" / "design-system"), title="Kiln", type="design-system")["id"]
            t1 = json.loads(store.read_file(ds, "tokens.json").decode("utf-8"))
            t2 = json.loads(json.dumps(t1)); t2["color"]["tokens"][0]["value"] = {"light": "#000000", "dark": "#111111"}
            store.publish(aid=ds, base=True, files={"tokens.json": t2})
            v1 = api.design_system(ds, 1)
            self.assertEqual((v1["version"], v1["latest"]), (1, 2))
            self.assertEqual(v1["tokens"]["color"]["tokens"][0]["value"], t1["color"]["tokens"][0]["value"])
            self.assertEqual(api.design_system(ds)["version"], 2)
            self.assertEqual(api.design_system(ds, 99)["version"], 2)  # a version no longer kept: the latest
            deck = store.publish(title="D", type="slides", files={"deck.json": {"title": "D", "slides": [], "designSystem": {"id": ds, "version": 1}}})["id"]
            moved = json.loads(plugin._read({"id": deck}))["design_system_changed"]
            self.assertEqual((moved["built_on"], moved["latest"]), (1, 2))
            store.publish(aid=deck, base=True, files={"deck.json": {"title": "D", "slides": [], "designSystem": {"id": ds, "version": 2}}})
            self.assertNotIn("design_system_changed", json.loads(plugin._read({"id": deck})))
            dash = store.publish(title="B", type="dashboard", files={"dashboard.json": {"title": "B", "look": {"system": {"name": "Kiln", "id": ds, "version": 1}}}})["id"]
            self.assertIn("design_system_changed", json.loads(plugin._read({"id": dash})))
            g = json.loads(plugin._guide({"type": "slides"}))["design_system"]  # none default: name them
            self.assertTrue(g["none"])
            self.assertIn(ds, [s["id"] for s in g["systems"]])
            self.assertIn("ask", g["rule"])
        finally:
            store.settings_set("default_design_system", None)

    def test_the_guide_hands_over_the_default_system(self):
        import importlib.util
        plugin = sys.modules.get("hermes_artifacts_plugin")
        if plugin is None:
            spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", PLUGIN / "__init__.py",
                                                          submodule_search_locations=[str(PLUGIN)])
            plugin = importlib.util.module_from_spec(spec)
            sys.modules["hermes_artifacts_plugin"] = plugin
            spec.loader.exec_module(plugin)
        store.settings_set("default_design_system", None)
        try:
            self.assertTrue(json.loads(plugin._guide({"type": "slides"}))["design_system"]["none"])
            kiln = store.publish(path=str(ROOT / "examples" / "design-system"), title="Kiln", type="design-system")["id"]
            store.settings_set("default_design_system", kiln)
            ds = json.loads(plugin._guide({"type": "design"}))["design_system"]
            self.assertEqual(ds["id"], kiln)
            self.assertIn("Kiln", ds["readme"])
            self.assertNotIn("@generated", ds["readme"])
            self.assertIn("--ink", ds["tokens"])
            self.assertIn("Button", ds["components"].split(", "))  # names only: a card is one read away
            self.assertIn("never made-up", ds["rule"])
            self.assertNotIn("design_system", json.loads(plugin._guide({"type": "doc"})))
            out = json.loads(plugin._publish({"type": "slides", "title": "d", "open": False,
                                              "files": {"deck.json": {"title": "d", "slides": []}}}))
            self.assertEqual(out["design_system"]["id"], kiln)
            # each type is handed only what it uses: a dashboard and a film take values, a deck no components
            dash = json.loads(plugin._guide({"type": "dashboard"}))["design_system"]
            self.assertEqual(sorted(dash), ["id", "rule", "title", "tokens", "version"])
            film = json.loads(plugin._guide({"type": "motion"}))["design_system"]
            self.assertNotIn("readme", film)
            deck = json.loads(plugin._guide({"type": "slides"}))["design_system"]
            self.assertIn("readme", deck)
            self.assertNotIn("components", deck)
            self.assertLess(len(json.dumps(dash)), len(json.dumps(deck)))
            self.assertLess(len(json.dumps(deck)), len(json.dumps(ds)))
            # a deck that wears a system gets no reminder
            out = json.loads(plugin._publish({"type": "slides", "title": "d2", "open": False,
                                              "files": {"deck.json": {"title": "d", "slides": [], "designSystems": [kiln]}}}))
            self.assertNotIn("design_system", out)
        finally:
            store.settings_set("default_design_system", None)

    def test_a_publish_shown_in_the_desktop_hands_over_its_chat_card(self):
        import importlib.util
        plugin = sys.modules.get("hermes_artifacts_plugin")
        if plugin is None:
            spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", PLUGIN / "__init__.py",
                                                          submodule_search_locations=[str(PLUGIN)])
            plugin = importlib.util.module_from_spec(spec)
            sys.modules["hermes_artifacts_plugin"] = plugin
            spec.loader.exec_module(plugin)
        real = plugin._broadcast
        try:
            plugin._broadcast = lambda event, payload: True
            out = json.loads(plugin._publish({"title": "Card", "html": "<p>x</p>"}))
            self.assertIn(f'::artifact{{id="{out["id"]}"}}', out["card"])
            plugin._broadcast = lambda event, payload: False  # no desktop: no card line to print raw
            self.assertNotIn("card", json.loads(plugin._publish({"title": "Card 2", "html": "<p>x</p>"})))
            self.assertNotIn("card", json.loads(plugin._publish({"title": "Card 3", "html": "<p>x</p>", "open": False})))
        finally:
            plugin._broadcast = real

    def test_the_system_is_copied_into_what_wears_it(self):
        kiln = store.publish(path=str(EXAMPLE), title="Kiln", type="design-system")["id"]
        canvas = store.publish(title="C", type="design", files={
            "canvas.json": {"v": 3, "title": "C", "boards": {}, "order": [], "designSystems": [kiln]},
            "Main.dc.html": "<!doctype html><p>x</p>"})["id"]
        rec = json.loads(store.read_file(canvas, "canvas.json").decode("utf-8"))["designSystems"][0]
        self.assertEqual((rec["artifact"], rec["version"], rec["namespace"], rec["title"]), (kiln, 1, "kiln", "Kiln"))
        self.assertTrue(rec["copiedAt"])
        files = store.list_files(canvas)
        for p in ("ds/kiln/tokens.json", "ds/kiln/tokens.css", "ds/kiln/components/bundle.css",
                  "ds/kiln/components/bundle.js", "ds/kiln/assets/Marks/kiln-mark.svg"):
            self.assertIn(p, files)
        # the system moves on (and is then deleted): the copy stays as it was
        t = json.loads(store.read_file(kiln, "tokens.json").decode("utf-8"))
        before = store.read_file(canvas, "ds/kiln/tokens.json")
        t["color"]["tokens"][0]["value"] = {"light": "#000000", "dark": "#111111"}
        store.publish(aid=kiln, base=True, files={"tokens.json": t})
        store.publish(aid=canvas, base=True, files={"Main.dc.html": "<!doctype html><p>y</p>"})
        self.assertEqual(store.read_file(canvas, "ds/kiln/tokens.json"), before)
        self.assertEqual(json.loads(store.read_file(canvas, "canvas.json").decode("utf-8"))["designSystems"][0], rec)
        # named again, by id alone, even in a publish that brings every file anew: the copy and its version stay
        store.publish(aid=canvas, base=True, files={"canvas.json": {"v": 3, "title": "C", "boards": {}, "order": [], "designSystems": [kiln]}})
        self.assertEqual(json.loads(store.read_file(canvas, "canvas.json").decode("utf-8"))["designSystems"][0], rec)
        store.publish(aid=canvas, files={"canvas.json": {"v": 3, "title": "C", "boards": {}, "order": [], "designSystems": [kiln]},
                                         "Main.dc.html": "<!doctype html><p>z</p>"})
        self.assertEqual(json.loads(store.read_file(canvas, "canvas.json").decode("utf-8"))["designSystems"][0], rec)
        self.assertEqual(store.read_file(canvas, "ds/kiln/tokens.json"), before)
        # asked to update: the latest version
        store.publish(aid=canvas, base=True, files={"canvas.json": {"v": 3, "title": "C", "boards": {}, "order": [], "designSystems": [{"artifact": kiln, "update": True}]}})
        self.assertEqual(json.loads(store.read_file(canvas, "canvas.json").decode("utf-8"))["designSystems"][0]["version"], 2)
        self.assertNotEqual(store.read_file(canvas, "ds/kiln/tokens.json"), before)
        # a deck: no component bundle (slides cannot run one); an older index is brought over
        deck = store.publish(title="D", type="slides", files={"deck.json": {"title": "D", "slides": [], "designSystem": {"id": kiln, "version": 1, "theme": "dark"}}})["id"]
        d = json.loads(store.read_file(deck, "deck.json").decode("utf-8"))
        self.assertNotIn("designSystem", d)
        self.assertEqual((d["designSystems"][0]["version"], d["designSystems"][0]["theme"]), (1, "dark"))
        self.assertNotIn("ds/kiln/components/bundle.js", store.list_files(deck))
        self.assertIn("ds/kiln/tokens.json", store.list_files(deck))
        store.delete(kiln)
        store.publish(aid=deck, base=True, files={"notes.txt": "x"})
        self.assertIn("ds/kiln/tokens.json", store.list_files(deck))
        # dropping the record drops the copy
        store.publish(aid=deck, base=True, files={"deck.json": {"title": "D", "slides": []}})
        self.assertFalse([f for f in store.list_files(deck) if f.startswith("ds/")])

    def test_a_type_may_have_its_own_default_or_none(self):
        import importlib.util
        plugin = sys.modules.get("hermes_artifacts_plugin")
        if plugin is None:
            spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", PLUGIN / "__init__.py",
                                                          submodule_search_locations=[str(PLUGIN)])
            plugin = importlib.util.module_from_spec(spec)
            sys.modules["hermes_artifacts_plugin"] = plugin
            spec.loader.exec_module(plugin)
        try:
            a = store.publish(path=str(EXAMPLE), title="Kiln", type="design-system")["id"]
            b = store.publish(path=str(EXAMPLE), title="Other", type="design-system")["id"]
            store.settings_set("default_design_system", a)
            r = api.handle("POST", "design-system-for", {}, {"type": "slides", "id": b})
            self.assertEqual(r["design_system_for"], {"slides": b})
            self.assertEqual(json.loads(plugin._guide({"type": "slides"}))["design_system"]["id"], b)
            self.assertEqual(json.loads(plugin._guide({"type": "design"}))["design_system"]["id"], a)
            api.handle("POST", "design-system-for", {}, {"type": "motion", "id": "none"})
            self.assertNotIn("design_system", json.loads(plugin._guide({"type": "motion"})))  # nothing to read, nothing offered
            with self.assertRaises(api.ApiError):
                api.handle("POST", "design-system-for", {}, {"type": "doc", "id": a})
            store.delete(b)
            self.assertEqual(store.default_design_system("slides"), a)
            api.handle("POST", "design-system-for", {}, {"type": "motion", "id": None})
            self.assertEqual(store.default_design_system("motion"), a)
        finally:
            store.settings_set("default_design_system", None)
            store.settings_set("design_system_for", None)


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

    SVG = ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">'
           '<defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>'
           '<rect width="10" height="10" fill="url(#g)"/><use xlink:href="#g"/>'
           '<image href="data:image/png;base64,' + PNG + '"/></svg>')

    def test_a_static_svg_saves_as_text(self):
        uri = "data:image/svg+xml;base64," + base64.b64encode(self.SVG.encode()).decode()
        r = op(self.aid, "save", base_version=1, files={"assets/Logos/mark.svg": uri, "assets/Logos/plain.svg": self.SVG,
                                                         "assets/Logos/mark.png": "data:image/png;base64," + PNG})
        self.assertTrue(r["ok"], r)
        vdir = store.version_dir(self.aid)
        self.assertEqual((vdir / "assets" / "Logos" / "mark.svg").read_text("utf-8"), self.SVG)
        self.assertEqual((vdir / "assets" / "Logos" / "plain.svg").read_text("utf-8"), self.SVG)
        self.assertEqual((vdir / "assets" / "Logos" / "mark.png").read_bytes()[:4], b"\x89PNG")
        c = render.content_json(vdir)
        self.assertIn("assets/Logos/mark.svg", c)
        self.assertIn("<svg", c["assets/Logos/mark.svg"] if not c["assets/Logos/mark.svg"].startswith("data:")
                      else base64.b64decode(c["assets/Logos/mark.svg"].split(",", 1)[1]).decode())

    def test_an_unsafe_svg_is_refused(self):
        ns = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
        bad = [f'<svg {ns}><script>alert(1)</script></svg>',
               f'<svg {ns}><foreignObject><div/></foreignObject></svg>',
               f'<svg {ns}><iframe src="x"/></svg>', f'<svg {ns}><embed src="x"/></svg>', f'<svg {ns}><object data="x"/></svg>',
               f'<svg {ns} onload="alert(1)"/>', f'<svg {ns}><rect onClick="alert(1)"/></svg>',
               f'<svg {ns}><a href="javascript:alert(1)"><rect/></a></svg>',
               f'<svg {ns}><a xlink:href="  JaVaScRiPt:alert(1)"><rect/></a></svg>',
               f'<svg {ns}><a href="java&#9;script:alert(1)"><rect/></a></svg>',
               f'<svg {ns}><use href="https://evil.example/x.svg#a"/></svg>',
               f'<svg {ns}><image href="data:text/html;base64,PGI+"/></svg>',
               f'<svg {ns}><set attributeName="href" to="javascript:alert(1)"/></svg>',
               '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
               '<?xml-stylesheet href="https://evil.example/a.css"?><svg xmlns="http://www.w3.org/2000/svg"/>',
               '<html xmlns="http://www.w3.org/1999/xhtml"/>', '<svg><rect></svg>', "not xml",
               "data:image/svg+xml;base64,!!!", "data:text/html;base64,PGI+"]
        for svg in bad:
            with self.assertRaises(api.ApiError, msg=svg):
                op(self.aid, "save", files={"assets/Logos/x.svg": svg})
        self.assertEqual(len(store.get_meta(self.aid)["versions"]), 1)

    def test_an_svg_over_the_cap_is_refused(self):
        big = '<svg xmlns="http://www.w3.org/2000/svg"><desc>' + "x" * (2 * 1024 * 1024) + "</desc></svg>"
        with self.assertRaises(api.ApiError):
            op(self.aid, "save", files={"assets/Logos/big.svg": big})
        with self.assertRaises(api.ApiError):
            op(self.aid, "save", files={"assets/Logos/big.svg": "data:image/svg+xml;base64," + base64.b64encode(big.encode()).decode()})

    def test_only_design_system_assets_take_svg(self):
        svg = '<svg xmlns="http://www.w3.org/2000/svg"/>'
        for path in ("fonts/a.svg", "a.svg", "components/Button/a.svg"):
            with self.assertRaises(api.ApiError, msg=path):
                op(self.aid, "save", files={path: svg})
        import re
        for typ, pat in api._SAVE_PATHS.items():  # no other type's save paths take an SVG
            if typ != "design-system":
                for path in ("img/a.svg", "uploads/a.svg", "a.svg", "assets/Logos/a.svg"):
                    self.assertIsNone(re.match(pat, path), (typ, path))

    def test_the_page_comments_through_the_host(self):
        js = (PLUGIN / "hermes_artifacts" / "types" / "design-system" / "ds-page.js").read_text("utf-8")
        self.assertIn("window.hermes.comment({ selector: anchor", js)
        self.assertIn('window.hermes.on("flash"', js)
        for kind in ("token:", "style:", "component:", "asset:", "section:"):
            self.assertIn('"' + kind, js)

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
        spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", PLUGIN / "__init__.py",
                                                      submodule_search_locations=[str(PLUGIN)])
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
            json.dumps(str(PLUGIN / "hermes_artifacts" / "types" / "_kit" / "ds.js")), json.dumps(tokens), expr)
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
