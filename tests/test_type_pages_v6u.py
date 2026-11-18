"""Round V6u (854d5f3) of the in-frame pages in a real browser (headless Chrome, driven from node): a design's own
controls while a comment is picked, and every type's numbered marks: inside the frame and all of one size. Skipped
without Chrome or node."""

import json
import unittest

import _browser as B
import test_type_pages_v6s as v6s


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6uPages(unittest.TestCase):
    """Live round V6u (854d5f3)."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    drive_page = v6s.RoundV6sPages.drive_page
    design = v6s.RoundV6sPages.design
    BADGES = v6s.RoundV6sPages.BADGES

    ARM = """
      await api.top('window.__post("comment-mode", {on: true})')
      for (let i = 0; i < 40 && !(await api.top('window.__events.some(e => e.event === "pick-ready")')); i++) await api.sleep(150)
      const st = () => api.frame(`({ menu: [...document.querySelectorAll(".kit-menu")].filter(m => m.getClientRects().length).map(m => m.innerText.replace(/\\\\s+/g, " ")).join(),
        focus: !!document.querySelector(".dc-fstage"), picking: document.documentElement.hasAttribute("data-commenting"),
        ring: [...document.querySelectorAll("[data-hermes-ui]")].some(e => e.tagName === "DIV" && /border:/.test(e.style.cssText) && e.style.display !== "none" && e.getClientRects().length) })`)
      const mid = s => api.frame(`(() => { const e = ${s}; if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
      const back = async () => { const b = await mid('document.querySelector(".dc-fhead button")'); if (b) { await api.mouse(b[0], b[1]); await api.sleep(500) } }
    """

    def test_the_view_pills_play_and_its_menu_act_while_a_comment_is_picked(self):
        # V6u B1: with Comment armed the view pill's Play did nothing (its menu of prototypes and artboards opened only
        # with Comment off). It is the design's own control: it and its menu act, with no ring and no draft, picking on;
        # a press outside the menu only closes it, Esc closes it before it ends the picking.
        o = self.design(1250, 716, self.ARM + """
          const play = () => mid('[...document.querySelectorAll(".dc-pill-r button")].find(b => b.getAttribute("aria-label") === "Play")')
          const p = await play(), o = {}
          await api.pointer('mouseMoved', p[0], p[1], false); await api.sleep(200)
          await api.mouse(p[0], p[1]); await api.sleep(400); o.open = await st()
          const v = await api.frame('(() => { const r = document.getElementById("dc-view").getBoundingClientRect(); return [r.left + 30, r.bottom - 120] })()')
          await api.mouse(v[0], v[1]); await api.sleep(400); o.out = await st()
          await api.mouse(p[0], p[1]); await api.sleep(400)
          await api.key('Escape', 'Escape', 27); await api.sleep(300); o.esc = await st()
          await api.mouse(p[0], p[1]); await api.sleep(400)
          const it = await mid('[...document.querySelectorAll(".kit-menu button")][0]')
          await api.mouse(it[0], it[1]); await api.sleep(900); o.item = await st()
          await back(); o.back = await st()
          o.picked = await api.top('window.__events.filter(e => e.event === "picked").length')
          return o""")
        self.assertIn("Prototypes", o["open"]["menu"], o)
        self.assertEqual({k: o["open"][k] for k in ("picking", "ring", "focus")}, {"picking": True, "ring": False, "focus": False}, o)
        self.assertEqual((o["out"]["menu"], o["out"]["picking"]), ("", True), o)
        self.assertEqual((o["esc"]["menu"], o["esc"]["picking"]), ("", True), o)
        self.assertEqual((o["item"]["menu"], o["item"]["focus"], o["item"]["picking"]), ("", True, True), o)
        self.assertEqual(o["back"]["focus"], False, o)
        self.assertEqual(o["picked"], 0, o)


if __name__ == "__main__":
    unittest.main()
