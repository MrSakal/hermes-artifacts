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
        # on thumbnail 3's number. A mark lies on no strip button and no number, still by its part, at any width.
        aid = self.store.publish(path=str(EX / "slides"), title="Test slides", type="slides")["id"]
        box = 'e => { const r = e.getBoundingClientRect(); return { n: e.textContent || e.title, l: r.left, t: r.top, r: r.right, b: r.bottom } }'
        for w in (391, 463, 1250):
            o = self.drive_page(aid, """
              await api.top('window.__post("pins", [{selector: "#cover", n: 1}, {selector: "#numbers", n: 2}, {selector: "#plan", n: 3}])'); await api.sleep(800)
              return { marks: await api.frame('[...document.body.querySelectorAll(":scope > div[data-hermes-ui]")].filter(e => e.offsetWidth).map(""" + box + """)'),
                chrome: await api.frame('[...document.querySelectorAll("#sl-strip .sl-num, #sl-strip button.kit-btn")].filter(e => e.offsetWidth).map(""" + box + """)'),
                thumbs: await api.frame('[...document.querySelectorAll(".sl-thumb")].map(""" + box + """)'), w: await api.frame('innerWidth') }""", w=w)
            self.assertEqual(sorted(m["n"] for m in o["marks"]), ["1", "1", "2", "3"], (w, o))
            hit = lambda a, b: a["l"] < b["r"] - 0.5 and b["l"] < a["r"] - 0.5 and a["t"] < b["b"] - 0.5 and b["t"] < a["b"] - 0.5
            for m in o["marks"]:
                self.assertFalse([c for c in o["chrome"] if hit(m, c)], (w, m, o))
                self.assertTrue(0 <= m["l"] and m["r"] <= o["w"], (w, m))
            # each thumbnail's mark still by it: within 30 px of its top right as seen in the frame
            for n, th in (("2", o["thumbs"][1]), ("3", o["thumbs"][2])):
                m = [x for x in o["marks"] if x["n"] == n and x["t"] > o["thumbs"][0]["t"] - 60][0]
                right = min(th["r"], o["w"])
                self.assertLess(abs(m["l"] - right), 30, (w, n, m, th))
                self.assertLess(abs(m["t"] - th["t"]), 40, (w, n, m, th))


if __name__ == "__main__":
    unittest.main()
