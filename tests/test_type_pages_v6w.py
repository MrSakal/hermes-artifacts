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

    def test_a_connectors_label_hovered_rings_the_connector(self):
        # V6w 3: hovering an arrow's label ("yes") while picking drew a 3 x 3 ring at the canvas's left edge: the ring went
        # round the connector's own box, 0 x 0 at the canvas's origin. It goes round the connector as drawn, through its label.
        board = {"title": "B", "items": [{"id": "a", "type": "box", "text": "Review"}, {"id": "b", "type": "box", "text": "Ship"},
                                          {"id": "ab", "type": "arrow", "from": "a", "to": "b", "label": "yes"}]}
        aid = self.store.publish(title="B", type="board", files={"board.json": board})["id"]
        o = self.drive_page(aid, ARM + """
          const lbl = await api.frame('(() => { const r = document.querySelector("[data-id=ab] .bd-albl").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } })()')
          const ink = await api.frame(`(() => { const b = [...document.querySelectorAll('[data-id="ab"] path')].filter(p => !/^(none|transparent|rgba\\(0, 0, 0, 0\\))$/.test(getComputedStyle(p).stroke)).map(p => p.getBoundingClientRect())
            return { l: Math.min(...b.map(q => q.left)), t: Math.min(...b.map(q => q.top)), r: Math.max(...b.map(q => q.right)), b: Math.max(...b.map(q => q.bottom)) } })()`)
          await api.pointer('mouseMoved', (lbl.l + lbl.r) / 2, (lbl.t + lbl.b) / 2, false); await api.sleep(300)
          return { lbl, ink, ring: await api.frame(""" + json.dumps(RING) + """) }""", settle=1500)
        ring, lbl, ink = o["ring"], o["lbl"], o["ink"]
        self.assertEqual(len(ring), 1, o)
        r = ring[0]
        self.assertTrue(r["l"] < lbl["r"] and lbl["l"] < r["r"] and r["t"] < lbl["b"] and lbl["t"] < r["b"], o)  # through its label
        self.assertTrue(ink["l"] - 8 <= r["l"] and r["r"] <= ink["r"] + 8 and ink["t"] - 8 <= r["t"] and r["b"] <= ink["b"] + 8, o)  # round the line

    def test_a_marked_chart_drawn_again_keeps_its_mark(self):
        # V6w 4: a dashboard's chart drawn again at another width (a new svg) had its marks hidden for good, even after the
        # dashboard was opened again: the mark followed the old svg, and the new one was not taken for it by its words
        # (its axis changed with the width). The mark finds its part again as it found it at first.
        aid = self.store.publish(title="Test dash2", type="dashboard", files={"dashboard.json": DASH2, "data/monthly.csv": DASH2_CSV})["id"]
        o = self.drive_page(aid, """
          await api.top('window.__post("pins", [{selector: ".c-chart svg", n: 1}, {selector: ".c-chart svg", n: 2}])'); await api.sleep(600)
          const svg = () => api.frame('(() => { const s = document.querySelector(".c-chart svg"); s.__seen = s.__seen || ++window.__svgs || (window.__svgs = 1); const r = s.getBoundingClientRect(); return { id: s.__seen, l: r.left, t: r.top, r: r.right, b: r.bottom } })()')
          const o = { before: await svg(), b0: await api.frame(""" + json.dumps(self.BADGES) + """) }
          await api.size(820, 716); await api.sleep(1500)
          o.after = await svg(); o.b1 = await api.frame(""" + json.dumps(self.BADGES) + """)
          return o""")
        self.assertNotEqual(o["before"]["id"], o["after"]["id"], o)  # drawn again: another svg
        for ms in (o["b0"], o["b1"]):
            self.assertEqual([m["shown"] for m in ms], [True, True], o)
        s, ms = o["after"], o["b1"]
        self.assertTrue(all(s["r"] - 2 <= m["l"] <= s["r"] + 60 and s["t"] - 30 <= m["t"] <= s["t"] + 20 for m in ms), o)  # at its top right

    def test_a_slides_mark_by_its_thumbnail_keeps_off_the_next_ones_number(self):
        # V6w 5: slide 1's mark, at its thumbnail's top right, lay in the strip's gap over thumbnail 2's number "2": the
        # marks kept off the page's controls but not the type's own (a deck's thumbnails and their numbers, its chrome).
        aid = self.store.publish(path=str(EX / "slides"), title="Test slides", type="slides")["id"]
        for w in (1250, 900):
            o = self.drive_page(aid, """
              await api.top('window.__post("pins", [{selector: "#cover", n: 1}])'); await api.sleep(600)
              const nums = await api.frame('[...document.querySelectorAll(".sl-num")].map(e => { const r = e.getBoundingClientRect(); return { n: e.textContent, l: r.left, t: r.top, r: r.right, b: r.bottom } })')
              const thumbs = await api.frame('[...document.querySelectorAll(".sl-thumb")].map(e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } })')
              return { nums, thumbs, b: await api.frame(""" + json.dumps(self.BADGES) + """) }""", w=w)
            marks = [m for m in o["b"] if m["shown"]]
            self.assertEqual(len(marks), 2, (w, o))  # by its thumbnail and by the slide
            hit = lambda a, b: a["l"] < b["r"] and b["l"] < a["r"] and a["t"] < b["b"] and b["t"] < a["b"]
            for m in marks:
                self.assertFalse([x for x in o["nums"] + o["thumbs"][1:] if hit(m, x)], (w, m, o))
            t0 = o["thumbs"][0]
            self.assertTrue(any(t0["r"] <= m["l"] <= t0["r"] + 30 and t0["t"] - 40 <= m["t"] <= t0["t"] for m in marks), (w, o))  # still by it

    def test_a_films_marks_are_the_circle_of_every_type(self):
        # V6w 6: a film's marks were 22 x 22 on the picture and 16 x 16 on the timeline, every other type's an 18 x 18
        # circle. Both are that circle.
        aid = self.store.publish(path=str(EX / "motion"), title="Harbor film", type="motion")["id"]
        o = self.drive_page(aid, """
          await api.frame('__motion.renderAt(0)')
          await api.top('window.__post("pins", [{selector: "@t=0 @xy=50.00%,50.00%", n: 1}, {selector: "@t=2-4", n: 2}])'); await api.sleep(600)
          return await api.frame('[...document.querySelectorAll(".mo-spin, .mo-pin")].map(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return { c: e.className, w: r.width, h: r.height, rad: s.borderRadius } })')""")
        self.assertEqual(sorted(m["c"] for m in o), ["mo-pin", "mo-pin", "mo-spin"], o)
        for m in o:
            self.assertEqual((m["w"], m["h"], m["rad"]), (18, 18, "9px"), o)

    def test_marks_kept_at_the_frames_edge_read_in_order(self):
        # V6w 7: two marks on a heading as wide as the frame, kept inside it at its right edge: the second went left of the
        # first (4 read before 1). Their numbers go up left to right and top to bottom.
        aid = self.store.publish(title="Edge", type="page", html='<h1 id="h" style="margin:60px 0 0">Orders 2026</h1><p id="p">A line</p>')["id"]
        for w in (1250, 420):
            o = self.drive_page(aid, """
              await api.top('window.__post("pins", [{selector: "#h", n: 4}, {selector: "#h", n: 1}, {selector: "#h", n: 7}])'); await api.sleep(500)
              return { w: await api.frame('innerWidth'), b: await api.frame(""" + json.dumps(self.BADGES) + """) }""", w=w, settle=1500)
            ms = sorted((m for m in o["b"] if m["shown"]), key=lambda m: int(m["n"]))
            self.assertEqual([m["n"] for m in ms], ["1", "4", "7"], (w, o))
            for a, b in zip(ms, ms[1:]):
                self.assertTrue(b["t"] >= a["b"] or (abs(b["t"] - a["t"]) < 1 and b["l"] >= a["r"]), (w, a, b))
                self.assertTrue(0 <= b["l"] and b["r"] <= o["w"], (w, b))

    def test_a_sheets_grid_round_its_cells_is_not_a_part(self):
        # V6w 8: at 417 px the sheet's grid surface itself (its scrollbars, its corner) rang whole while picking: the grid
        # is the ground its cells lie on. No ring, no pick there; a cell still rings.
        rows = [["Item", "Cost", "Qty", "Note"]] + [[f"Item {i}", i * 10, i, "x"] for i in range(1, 60)]
        aid = self.store.publish(title="Grid", type="sheet", files={"sheet.json": {"title": "Grid", "sheets": [{"name": "Costs", "rows": rows}]}})["id"]
        o = self.drive_page(aid, ARM + """
          const g = await api.frame('(() => { const g = document.getElementById("sh-grid"), r = g.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, sw: g.offsetWidth - g.clientWidth, sh: g.offsetHeight - g.clientHeight } })()')
          const o = { g, at: [] }
          for (const [x, y] of [[g.r - 2, g.b - 2], [g.r - 3, (g.t + g.b) / 2], [(g.l + g.r) / 2, g.b - 3]]) {
            await api.pointer('mouseMoved', x, y, false); await api.sleep(250)
            o.at.push({ x, y, under: await api.frame(`document.elementFromPoint(${x}, ${y}).id`), ring: await api.frame(""" + json.dumps(RING) + """) })
          }
          await api.mouse(g.r - 2, g.b - 2); await api.sleep(400)
          o.picked = await api.top('window.__events.filter(e => e.event === "picked" || e.event === "comment").length')
          const c = await api.frame('(() => { const r = document.querySelector(".sh-c.n").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()')
          await api.pointer('mouseMoved', c[0], c[1], false); await api.sleep(250)
          o.cell = await api.frame(""" + json.dumps(RING) + """)
          return o""", w=417)
        self.assertGreater(o["g"]["sw"] + o["g"]["sh"], 0, o)  # it scrolls: its bars are there
        self.assertTrue(all(a["under"] == "sh-grid" and a["ring"] == [] for a in o["at"]), o)
        self.assertEqual(o["picked"], 0, o)
        self.assertEqual(len(o["cell"]), 1, o)

    def test_a_design_systems_file_list_ends_after_a_whole_row(self):
        # V6w 9: narrow, the Files list (240 px high) showed a 2 px sliver of its 9th row at its foot. It ends after the last
        # row that fits whole, at any width; it still scrolls to the rest.
        aid = self.store.publish(path=str(EX / "design-system"), title="Test design system", type="design-system")["id"]
        for w, hh in ((420, 900), (1250, 716), (1250, 560)):
            o = self.drive_page(aid, """
              await api.clickIn('[...document.querySelectorAll("button, a")].find(b => b.textContent.trim().startsWith("Files"))'); await api.sleep(800)
              return await api.frame('(() => { const l = document.querySelector(".ds-fl"), r = l.getBoundingClientRect(); return { h: r.height, scroll: l.scrollHeight > l.clientHeight + 1, cut: [...l.children].map(c => c.getBoundingClientRect()).filter(c => c.top < r.bottom - 0.5 && c.bottom > r.bottom + 0.5).length } })()')""", w=w, hh=hh, settle=1500)
            self.assertTrue(o["scroll"], (w, hh, o))  # more rows than it shows
            self.assertEqual(o["cut"], 0, (w, hh, o))
