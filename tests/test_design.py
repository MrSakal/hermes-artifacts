"""The design canvas: the example renders through its runtime, and what its editor may save."""

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
                     "is_interactive", "expand", "designSystems", "ha_guide` returns `design_system", "base=true",
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


try:
    import _browser as B
except ImportError:  # run from elsewhere
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import _browser as B

READY = "await api.sleep(300); for (let i = 0; i < 60; i++) { if (await api.top('window.__events.some(e => e.event === \"ready\")')) break; await api.sleep(150) }"
# an element of the Landing page picked as a person does: a click on its words
PICK = ("const q = await api.frame('(() => { const r = __design.boards[\"Main.dc.html\"].el.querySelector(\"iframe\").getBoundingClientRect();"
        " return [r.left + r.width * 0.25, r.top + r.height * 0.35] })()'); await api.mouse(q[0], q[1]); await api.sleep(900)\n")
# where every head-row control is, whether it is the topmost thing at its centre
HEAD = ("[...document.querySelectorAll('.dc-fhead button')].map(b => { const r = b.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);"
        " return [b.getAttribute('aria-label') || b.textContent.trim(), !!t && b.contains(t), b.disabled] })")


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class PageTests(unittest.TestCase):
    """Round 4: an opened artboard sat under the canvas's pills (Back, its title and Previous / Next covered);
    at 400 px a pick wrapped "Ask Hermes" on two lines, the breadcrumb lay under the drawing tools and the panel
    (its close named "Properties") covered the canvas."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.aid = store.publish(path=str(ROOT / "examples" / "design"), title="Lumen", type="design")["id"]

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def run_page(self, body, w=1000):
        r = B.drive(f"await api.size({w}, 760); await api.go({json.dumps(self.host.url(self.aid))}, 800); {READY}\n await api.sleep(1500)\n" + body)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_an_opened_artboard_has_its_own_head_row(self):
        for w in (400, 1000):
            out = self.run_page(f"""
              await api.frame('__design.openFocus("Main.dc.html")'); await api.sleep(1200)
              return {{ head: await api.frame({json.dumps(HEAD)}),
                       pills: await api.frame('[...document.querySelectorAll(".dc-pill, .dc-crumbs, .dc-tools")].filter(x => x.getClientRects().length).length') }}
            """, w=w)
            self.assertEqual(len(out["head"]), 3, out)
            self.assertTrue(all(b[1] for b in out["head"]), out)  # nothing over Back, Previous, Next
            self.assertEqual([b[2] for b in out["head"]], [False, True, False])  # the first artboard: no Previous
            self.assertEqual(out["pills"], 0, w)  # the canvas's own chrome is away

    def test_a_pick_in_a_narrow_window(self):
        out = self.run_page(PICK + """
          const tools = await api.frame('(() => { const t = document.querySelector(".dc-tools"), r = t.getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth, Math.max(...[...t.querySelectorAll("button")].map(b => b.getBoundingClientRect().height))] })()')
          const crumbs = await api.frame('document.querySelector(".dc-crumbs").getBoundingClientRect().bottom <= document.querySelector(".dc-pill-b").getBoundingClientRect().top')
          const panel = await api.frame('document.getElementById("dc-panel").hidden')
          await api.frame('[...document.querySelectorAll(".dc-pill-r button")].find(b => /Properties|Tulajdonságok/.test(b.getAttribute("aria-label"))).click()'); await api.sleep(500)
          const sheet = await api.frame('[document.getElementById("dc-panel").hidden, [...document.querySelectorAll("#dc-panel .dc-tabs button")].pop().getAttribute("aria-label"), document.querySelector(".dc-tools").getClientRects().length]')
          await api.frame('[...document.querySelectorAll("#dc-panel .dc-tabs button")].pop().click()'); await api.sleep(400)
          return { tools, crumbs, panel, sheet, after: await api.frame('[document.getElementById("dc-panel").hidden, document.querySelector(".dc-tools").getClientRects().length > 0]') }
        """, w=400)
        self.assertEqual(out["tools"][:2], [True, True], out)
        self.assertLessEqual(out["tools"][2], 32, out)  # one line: no word wrapped
        self.assertTrue(out["crumbs"], out)
        self.assertTrue(out["panel"], out)  # a pick opens no sheet over the canvas
        self.assertEqual(out["sheet"][0], False)
        self.assertIn(out["sheet"][1], ("Close", "Bezárás"))
        self.assertEqual(out["sheet"][2], 0)  # the element toolbar steps aside under the sheet
        self.assertEqual(out["after"], [True, True])

    def test_an_artboard_moved_just_before_the_frame_goes_is_saved_once(self):
        # Round 7h: Hermes takes the frame away under 1.2 s after the move: the frame gets pagehide, never
        # beforeunload, so the move waiting for its pause was lost.
        aid = store.publish(path=str(ROOT / "examples" / "design"), title="Moved", type="design")["id"]
        r = B.drive(f"await api.size(1000, 760); await api.go({json.dumps(self.host.url(aid))}, 800); {READY}\n"
                    "await api.sleep(1500)\n"
                    "const at = await api.frame('(() => { const b = document.querySelector(\".dc-board[data-path=\\\\\"Main.dc.html\\\\\"] .dc-name\").getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()')\n"
                    "await api.drag(at[0], at[1], at[0] + 60, at[1]); await api.sleep(400)\n"
                    "const x = await api.frame('__design.canvas().boards[\"Main.dc.html\"].x')\n"
                    "await api.top('document.getElementById(\"f\").remove()'); await api.sleep(2500)\n"
                    "return { x, saves: await api.top('window.__ops.filter(o => o.op === \"save\").map(o => JSON.parse(o.args.files[\"canvas.json\"]).boards[\"Main.dc.html\"].x)') }")
        self.assertIsNone(r.get("err"), r)
        self.assertNotEqual(r["out"]["x"], 0)
        self.assertEqual(r["out"]["saves"], [r["out"]["x"]])
        self.assertEqual(len(store.get_meta(aid)["versions"]), 2)
        saved = json.loads(render.content_json(store.version_dir(aid))["canvas.json"])
        self.assertEqual(saved["boards"]["Main.dc.html"]["x"], r["out"]["x"])


if __name__ == "__main__":
    unittest.main()


class PickReadyTests(unittest.TestCase):
    def test_a_pick_waits_for_the_artboards_drawn_not_their_pictures_and_fonts(self):
        # V6n: a click made soon after a design opened was held 4-6 s: until every artboard had settled (its pictures
        # decoded and fonts loaded, up to 4 s each, an artboard out of view never drawing its pictures). It waits for
        # the artboards mounted, which they say before settling.
        types = ROOT / "plugin" / "hermes_artifacts" / "types" / "design"
        frame, design = (types / "frame.js").read_text("utf-8"), (types / "design.js").read_text("utf-8")
        self.assertLess(frame.index('post({ t: "mounted" })'), frame.index("if (!st.ready) settle()"))
        pick = design[design.index("function pickWhenDrawn()"):]
        pick = pick[:pick.index("\n  }\n")]
        self.assertIn("f.whenMounted()", pick)
        self.assertNotIn("whenReady", pick)
