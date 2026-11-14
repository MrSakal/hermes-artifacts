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
        p._guide({"type": "slides"}, **kw)
        aid = json.loads(p._publish({"title": "D", "type": "slides", "files": {"deck.json": deck}, "open": False}, **kw))["id"]
        self.assertTrue(json.loads(p._publish({"id": aid, "files": {"deck.json": deck}, "open": False}, **kw))["ok"])
        op(aid, "save", base_version=2, files={"slides/a.html": '<section id="a"><p>mine</p></section>'})
        r = json.loads(p._publish({"id": aid, "files": {"deck.json": deck}, "open": False}, **kw))
        self.assertFalse(r["ok"])
        # A whole publish of deck.json alone would delete the slide the person saved, never shown to Hermes.
        self.assertEqual((r["code"], r["would_delete"]), ("would_delete", ["slides/a.html"]))
        self.assertIn("mine", json.loads(p._read({"id": aid, "path": "slides/a.html"}, **kw))["content"])
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


try:
    import _browser as B
except ImportError:  # run from elsewhere
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import _browser as B

READY = "await api.sleep(300); for (let i = 0; i < 60; i++) { if (await api.top('window.__events.some(e => e.event === \"ready\")')) break; await api.sleep(150) }"
# a button of the page by its words (English or Hungarian), shown
BTN = ("window.BTN = labs => [...document.querySelectorAll('button')].find(b => labs.includes(b.getAttribute('aria-label') || b.title)"
       " && b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')")
PROPS, ALL, ONE, CLOSE = '["Properties", "Tulajdonságok"]', '["All slides", "Összes dia"]', '["One slide", "Egy dia"]', '["Close", "Bezárás"]'
# every shown control of the chrome inside the window, and no two pills on one another
FITS = r"""(() => { const bad = [], vw = innerWidth
  const shown = el => { const r = el.getBoundingClientRect(); if (r.width < 1) return null; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return null } return r }
  document.querySelectorAll('button, select, input').forEach(el => { if (el.closest('#sl-strip, #sl-stage')) return; const r = shown(el); if (r && (r.left < -0.5 || r.right > vw + 0.5)) bad.push('off: ' + (el.getAttribute('aria-label') || el.textContent).trim()) })
  const pills = [...document.querySelectorAll('.sl-pill')].map(shown).filter(Boolean)
  for (let i = 0; i < pills.length; i++) for (let j = i + 1; j < pills.length; j++) { const a = pills[i], b = pills[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) bad.push('pills meet') }
  return bad })()"""


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class PageTests(unittest.TestCase):
    """Round 4: the properties column went blank after All slides -> One slide; a thumbnail kept its "picked" outline;
    at 400 px the pills ran off the window and over the properties column."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.aid = store.publish(path=str(ROOT / "examples" / "slides"), title="Deck", type="slides")["id"]

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def run_page(self, body, w=1000):
        r = B.drive(f"await api.size({w}, 760); await api.go({json.dumps(self.host.url(self.aid))}, 800); {READY}\n"
                    f"await api.sleep(800); await api.frame({json.dumps(BTN)})\n"
                    "const click = async labs => { await api.frame('BTN(' + labs + ').click()'); await api.sleep(400) }\n" + body)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_properties_come_back_after_all_slides(self):
        out = self.run_page(f"""
          await click({json.dumps(PROPS)})
          const before = await api.frame('document.getElementById("sl-props").querySelectorAll("select, input").length')
          await click({json.dumps(ALL)})
          const grid = await api.frame('[document.getElementById("sl-props").hidden, BTN({PROPS}).disabled]')
          await click({json.dumps(ONE)})
          const after = await api.frame('[document.getElementById("sl-props").hidden, document.getElementById("sl-props").querySelectorAll("select, input").length, BTN({PROPS}).getAttribute("aria-pressed")]')
          return {{ before, grid, after }}
        """)
        self.assertGreater(out["before"], 0)
        self.assertEqual(out["grid"], [True, True])  # all slides: no column, the button off
        self.assertEqual(out["after"], [False, out["before"], "true"])

    def test_one_current_slide_and_no_stale_pick(self):
        out = self.run_page("""
          const thumb = i => 'document.querySelectorAll("#sl-rail .sl-thumb")[' + i + ']'
          await api.clickIn(thumb(0))
          await api.frame(thumb(1) + '.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}))'); await api.sleep(300)
          await api.key('Escape', 'Escape', 27); await api.sleep(200)
          await api.clickIn(thumb(2)); await api.sleep(300)
          return await api.frame('[...document.querySelectorAll("#sl-rail .sl-thumb")].map(b => (b.classList.contains("on") ? "on" : "") + (b.classList.contains("picked") && !b.classList.contains("on") ? "picked" : ""))')
        """)
        self.assertEqual(out, ["", "", "on", ""])

    def test_a_narrow_window(self):
        for w in (360, 400, 560):
            out = self.run_page(f"""
              const open = await api.frame({json.dumps(FITS)})
              await click({json.dumps(PROPS)})
              const sheet = await api.frame('(() => {{ const p = document.getElementById("sl-props"), r = p.getBoundingClientRect(); return [p.hidden, getComputedStyle(p).position, Math.round(r.right), !!BTN({CLOSE}), [...document.querySelectorAll(".sl-pill")].filter(x => x.getClientRects().length).length] }})()')
              const inSheet = await api.frame({json.dumps(FITS)})
              await click({json.dumps(CLOSE)})
              const closed = await api.frame('[document.getElementById("sl-props").hidden, document.activeElement && document.activeElement.getAttribute("aria-label")]')
              const first = await api.frame('document.querySelector("#sl-main button").closest(".sl-pill") !== null')
              return {{ open, sheet, inSheet, closed, first }}
            """, w=w)
            self.assertEqual(out["open"], [], w)
            self.assertEqual(out["sheet"], [False, "absolute", w, True, 0], w)  # a sheet over the stage, its Close; the pills under it step aside
            self.assertEqual(out["inSheet"], [], w)
            self.assertTrue(out["closed"][0], w)
            self.assertIn(out["closed"][1], ("Properties", "Tulajdonságok"))  # the focus back on its button
            self.assertTrue(out["first"])  # the toolbar first in the tab order


if __name__ == "__main__":
    unittest.main()
