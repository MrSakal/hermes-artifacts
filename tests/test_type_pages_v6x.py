"""Round V6x (81888f6) of the in-frame pages in a real browser (headless Chrome, driven from node): the numbered marks
kept off the type's own controls and words where they meet the frame's edge. Skipped without Chrome or node."""

import unittest

import _browser as B
import test_type_pages_v6s as v6s
from test_type_pages_browser import EX


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6xPages(unittest.TestCase):
    """Live round V6x (81888f6)."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    drive_page = v6s.RoundV6sPages.drive_page

    def test_a_decks_marks_keep_off_its_strips_buttons_and_numbers_at_the_frames_edge(self):
        # V6x 2: at ~950 px with the comments open (the frame 391 px wide) slide 2's mark lay on the strip's Hide
        # thumbnails, slide 3's (its thumbnail cut by the frame's edge, its mark kept inside it and moved under slide 2's)
        # on thumbnail 3's number. V6y: mark 4 lay 11-13 px lower than marks 1-3 (they had been moved up off the next
        # thumbnail's number); at 416 px mark 2 lay 2 px on thumbnail 2's selection border and mark 3 on thumbnail 3's
        # picture; mark 3 0.9 px under Hide thumbnails, 2 px from thumbnail 4's number. Every thumbnail's mark lies at its
        # top right (6 px past it, 9 px over it), all on one line, at least 2 px off every strip button, number and
        # thumbnail; a thumbnail whose top right the strip cuts off has none (it would lie on its picture).
        aid = self.store.publish(path=str(EX / "slides"), title="Test slides", type="slides")["id"]
        box = 'e => { const r = e.getBoundingClientRect(); return { n: e.textContent || e.title, l: r.left, t: r.top, r: r.right, b: r.bottom } }'
        for w in (391, 416, 463, 700, 1250):
            o = self.drive_page(aid, """
              await api.top('window.__post("pins", [{selector: "#cover", n: 1}, {selector: "#numbers", n: 2}, {selector: "#plan", n: 3}, {selector: "#close", n: 4}])'); await api.sleep(800)
              return { marks: await api.frame('[...document.body.querySelectorAll(":scope > div[data-hermes-ui]")].filter(e => e.offsetWidth).map(""" + box + """)'),
                chrome: await api.frame('[...document.querySelectorAll("#sl-strip .sl-num, #sl-strip button.kit-btn")].filter(e => e.offsetWidth).map(""" + box + """)'),
                rail: await api.frame('(""" + box + """)(document.getElementById("sl-rail"))'),
                thumbs: await api.frame('[...document.querySelectorAll(".sl-thumb")].map(""" + box + """)'), w: await api.frame('innerWidth') }""", w=w)
            strip = [m for m in o["marks"] if m["t"] > o["rail"]["t"] - 30]
            near = lambda a, b: a["l"] < b["r"] + 2 and b["l"] < a["r"] + 2 and a["t"] < b["b"] + 2 and b["t"] < a["b"] + 2
            for m in o["marks"]:
                self.assertFalse([c for c in o["chrome"] if near(m, c)], (w, m, o))
                self.assertTrue(0 <= m["l"] and m["r"] <= o["w"], (w, m))
            for m in strip:
                self.assertFalse([t for t in o["thumbs"] if near(m, t)], (w, m, o))
            self.assertLessEqual(len({round(m["t"], 1) for m in strip}), 1, (w, strip))  # one line
            for i, th in enumerate(o["thumbs"]):
                seen = th["r"] + 26 <= min(o["rail"]["r"], o["w"]) and th["r"] > o["rail"]["l"]
                m = [x for x in strip if x["n"] == str(i + 1)]
                self.assertEqual(len(m), 1 if seen else 0, (w, i, th, strip))
                if seen:
                    self.assertAlmostEqual(m[0]["l"], th["r"] + 6, delta=0.6, msg=(w, i, m, th))
                    self.assertAlmostEqual(m[0]["t"], th["t"] - 9, delta=0.6, msg=(w, i, m, th))
            self.assertTrue(strip, (w, o))


if __name__ == "__main__":
    unittest.main()
