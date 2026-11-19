"""Round V6w (d979db4) of the in-frame pages in a real browser (headless Chrome, driven from node): what rings while a
comment is picked (a design's resize handle, a board connector's label, a sheet's grid round its cells), and the
numbered marks: back on a part drawn again, off the type's own controls, in order, one size in every type. Skipped
without Chrome or node."""

import json
import unittest

import _browser as B
import test_type_pages_v6s as v6s
from test_type_pages_browser import DASH2, DASH2_CSV, EX

RING = ("[...document.querySelectorAll('[data-hermes-ui]')].filter(e => e.tagName === 'DIV' && /border:/.test(e.style.cssText) && e.style.display !== 'none' && e.getClientRects().length)"
        ".map(e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } })")
ARM = """
  await api.top('window.__post("comment-mode", {on: true})')
  for (let i = 0; i < 40 && !(await api.top('window.__events.some(e => e.event === "pick-ready")')); i++) await api.sleep(150)
"""


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6wPages(unittest.TestCase):
    """Live round V6w (d979db4)."""

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

    def test_an_artboards_size_handle_is_chrome_while_a_comment_is_picked(self):
        # V6w 2: an artboard's size handle (bottom right, unseen until hovered) rang and took a draft while picking. It
        # is the design's chrome: no ring, no draft, and the board keeps its size.
        o = self.design(1250, 716, ARM + """
          const spot = await api.frame(`(() => { for (const b of Object.values(__design.boards)) { if (b.el.hidden) continue; const r = b.resize.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
            if (x > 0 && y > 0 && x < innerWidth && y < innerHeight && document.elementFromPoint(x, y) === b.resize) return [x, y, b.path, b.el.style.width] } return null })()`)
          if (!spot) return { spot }
          await api.pointer('mouseMoved', spot[0], spot[1], false); await api.sleep(300)
          const o = { spot, hover: await api.frame(""" + json.dumps(RING) + """) }
          await api.mouse(spot[0], spot[1]); await api.sleep(500)
          o.click = await api.frame(""" + json.dumps(RING) + """)
          o.picked = await api.top('window.__events.filter(e => e.event === "picked" || e.event === "comment").length')
          o.width = await api.frame(`__design.boards[${JSON.stringify(spot[2])}].el.style.width`)
          return o""")
        self.assertTrue(o.get("spot"), o)
        self.assertEqual((o["hover"], o["click"], o["picked"]), ([], [], 0), o)
        self.assertEqual(o["width"], o["spot"][3], o)
