"""Round V6s (57009df) of the in-frame pages in a real browser (headless Chrome, driven from node): a design's
artboard buttons while a comment is picked and its strips at any width, its panel by the same width test as its
stylesheet, and every type's numbered mark on a part with an open thread. Skipped without Chrome or node."""

import json
import unittest

import _browser as B
from test_type_pages_browser import EX, HERMES_DARK, READY


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6sPages(unittest.TestCase):
    """Live round V6s (57009df)."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def drive_page(self, aid, body, w=1250, hh=716, settle=3000):
        r = B.drive(f"await api.size({w}, {hh}); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK, lang='en'))}, 800); {READY}\n await api.sleep({settle})\n" + body, timeout=300)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def design(self, w, hh, then):
        if not hasattr(self, "design_id"):
            type(self).design_id = self.store.publish(path=str(EX / "design"), title="Test design", type="design")["id"]
        return self.drive_page(self.design_id, then, w, hh)

    def test_an_artboards_play_and_full_window_act_while_a_comment_is_picked(self):
        # V6s 1: with the header's Comment armed, a strip's Play did not play and its Full window did not open (the
        # strip is the design's chrome: the pick took the press). They act as with Comment off, with no ring and no
        # draft, and picking stays on; the full window's Back too.
        o = self.design(1250, 716, """
          const at = (p, t) => api.frame(`(() => { const b = __design.boards[${JSON.stringify(p)}]; const x = [...b.strip.querySelectorAll(".dc-sbtn")].find(x => x.title === ${JSON.stringify(t)} && x.getClientRects().length && getComputedStyle(x).display !== "none"); if (!x) return null; const r = x.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
          const st = () => api.frame(`({ playing: __design.boards["Order.dc.html"].el.classList.contains("is-playing"), focus: !!document.querySelector(".dc-fstage"), picking: document.documentElement.hasAttribute("data-commenting"),
            ring: [...document.querySelectorAll("[data-hermes-ui]")].some(e => e.tagName === "DIV" && /border:/.test(e.style.cssText) && e.style.display !== "none" && e.getClientRects().length) })`)
          await api.top('window.__post("comment-mode", {on: true})')
          for (let i = 0; i < 40 && !(await api.top('window.__events.some(e => e.event === "pick-ready")')); i++) await api.sleep(150)
          const o = {}, play = await at("Order.dc.html", "Play"), full = await at("Main.dc.html", "Full window")
          if (!play || !full) return { play, full }
          await api.pointer('mouseMoved', play[0], play[1], false); await api.sleep(200)
          await api.mouse(play[0], play[1]); await api.sleep(500); o.play = await st()
          await api.mouse(full[0], full[1]); await api.sleep(800); o.full = await st()
          const back = await api.frame('(() => { const b = document.querySelector(".dc-fhead button"); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()')
          if (back) { await api.mouse(back[0], back[1]); await api.sleep(500) }
          o.back = await st()
          o.picked = await api.top('window.__events.filter(e => e.event === "picked").length')
          return o""")
        self.assertEqual(o.get("play"), {"playing": True, "focus": False, "picking": True, "ring": False}, o)
        self.assertEqual(o["full"], {"playing": True, "focus": True, "picking": True, "ring": False}, o)
        self.assertEqual(o["back"]["focus"], False, o)
        self.assertEqual(o["picked"], 0, o)

    def test_a_narrow_strip_keeps_its_buttons_while_they_fit(self):
        # V6s 1: under 110 px on screen a strip dropped its buttons: Order's Play and Full window were gone in a 987 px
        # frame (its strip 99 px) and every narrower one. A strip shows its buttons wherever they fit beside its handle,
        # wholly inside it and on nothing else of it.
        probe = r"""(() => { const box = e => { const q = e.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom] }
          const vis = e => e.getClientRects().length && getComputedStyle(e).display !== 'none'
          return Object.values(__design.boards).filter(b => !b.el.hidden && getComputedStyle(b.strip).visibility !== 'hidden').map(b => ({ path: b.path, strip: box(b.strip),
            want: [...b.strip.querySelectorAll('.dc-sbtn')].filter(x => !x.hidden).length, btns: [...b.strip.querySelectorAll('.dc-sbtn')].filter(vis).map(box),
            label: [b.name, b.strip.querySelector('.dc-grip'), b.strip.querySelector('.dc-dot')].filter(vis).map(box).filter(q => q[2] - q[0] >= 1) })) })()"""
        for w in (987, 739, 459):
            o = self.design(w, 716, f"return await api.frame({json.dumps(probe)})")
            for s in o:
                what = (w, s)
                st = s["strip"]
                if st[2] - st[0] >= s["want"] * 24 + 16:
                    self.assertEqual(len(s["btns"]), s["want"], ("its buttons fit and are gone", what))
                for q in s["btns"]:
                    self.assertTrue(st[0] - 0.5 <= q[0] and q[2] <= st[2] + 0.5, ("a button cut", what))
                    for l in s["label"]:
                        self.assertFalse(l[0] < q[2] - 0.5 and q[0] < l[2] - 0.5, ("a button on the name or handle", what))
            if w == 987:
                order = [s for s in o if s["path"] == "Order.dc.html"][0]
                self.assertEqual(len(order["btns"]), 2, order)
