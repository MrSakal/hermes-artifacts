"""Typed artifacts render through their runtimes; the plugin's tools work end to end."""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import render, store  # noqa: E402


def load_plugin():
    spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", ROOT / "__init__.py",
                                                  submodule_search_locations=[str(ROOT)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules["hermes_artifacts_plugin"] = mod
    spec.loader.exec_module(mod)
    return mod


class TypeTests(unittest.TestCase):
    def _render(self, example, kind, thumb=False):
        m = store.publish(path=str(ROOT / "examples" / example), title=example, type=kind)
        return m, render.render(m, store.version_dir(m["id"]), thumb=thumb)

    def _content(self, html):
        start = html.index('id="hermes-artifact-content">') + len('id="hermes-artifact-content">')
        return json.loads(html[start:html.index("</script>", start)])

    def test_dashboard(self):
        _, html = self._render("dashboard", "dashboard")
        c = self._content(html)
        self.assertEqual(c["type"], "dashboard")
        self.assertIn("data/monthly.csv", c["files"])
        self.assertIn("window.dash = dash", html)
        self.assertIn("d3js.org v7.9.0", html)
        self.assertNotIn('src="dashboard.js"', html)

    def test_slides_libs_load_on_demand(self):
        _, html = self._render("slides", "slides", thumb=True)
        c = self._content(html)
        self.assertTrue(c["thumb"])
        self.assertIn("slides/plan.html", c["files"])
        self.assertLess(len(html), 300_000)  # PptxGenJS / pdf-lib are not inlined

    def test_doc(self):
        _, html = self._render("doc", "doc")
        self.assertIn("window.md =", html)
        self.assertIn("doc.md", self._content(html)["files"])

    def test_content_cannot_close_script(self):
        m = store.publish(title="x", type="doc", files={"doc.md": "</script><script>alert(1)</script>"})
        html = render.render(m, store.version_dir(m["id"]))
        blob = html[html.index('id="hermes-artifact-content">'):]
        self.assertNotIn("</script><script>alert", blob[: blob.index("</script>") + 30])

    def test_tools(self):
        p = load_plugin()
        out = json.loads(p._publish({"type": "doc", "title": "Memo", "files": {"doc.md": "# Memo\n\nHi"}, "open": False},
                                    session_id="sess-1"))
        self.assertTrue(out["ok"], out)
        self.assertEqual(out["type"], "doc")
        self.assertEqual(store.get_meta(out["id"])["session"], "sess-1")
        r = json.loads(p._read({"id": out["id"]}))
        self.assertEqual(r["path"], "doc.md")
        self.assertIn("Hi", r["content"])
        g = json.loads(p._guide({"type": "dashboard"}))
        self.assertIn("dash.onData", g["guide"])
        c = store.comment_add(out["id"], "shorter please")
        self.assertTrue(json.loads(p._comments({"id": out["id"], "action": "reply", "comment": c["id"], "text": "done"}))["ok"])
        ask = store.inbox_add(out["id"], "next?", kind="ask")
        self.assertTrue(json.loads(p._reply({"id": out["id"], "request": ask["id"], "text": "yes"}))["ok"])
        self.assertEqual(store.reply_get(out["id"], ask["id"])["text"], "yes")
        self.assertTrue(json.loads(p._delete({"id": out["id"]}))["ok"])

    def test_every_type_has_a_guide_and_runtime(self):
        for kind in store.TYPES:
            self.assertTrue((render.TYPES_DIR / kind / "GUIDE.md").is_file(), kind)
            if kind != "page":
                self.assertTrue((render.TYPES_DIR / kind / "runtime.html").is_file(), kind)


if __name__ == "__main__":
    unittest.main()


class LayoutRuntimeTests(unittest.TestCase):
    def test_layout_examples_render_with_their_components(self):
        for example, kind, marker in (("dashboard-layout", "dashboard", "window.dashLayout"),
                                      ("slides-layout", "slides", "window.slideLayout")):
            m = store.publish(path=str(ROOT / "examples" / example), title=example, type=kind)
            html = render.render(m, store.version_dir(m["id"]))
            self.assertIn(marker, html)
            entry = "dashboard.json" if kind == "dashboard" else "deck.json"
            spec = json.loads((ROOT / "examples" / example / entry).read_text(encoding="utf-8"))
            self.assertTrue(spec.get("layout") or spec.get("slides"))

    def test_guides_lead_with_the_declarative_form(self):
        g = (render.TYPES_DIR / "dashboard" / "GUIDE.md").read_text(encoding="utf-8")
        self.assertIn('"layout"', g)
        self.assertIn("rowsAt", g)
        s = (render.TYPES_DIR / "slides" / "GUIDE.md").read_text(encoding="utf-8")
        self.assertIn('"layout": "kpis"', s)
