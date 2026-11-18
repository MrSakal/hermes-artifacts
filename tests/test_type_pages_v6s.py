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

    def test_a_designs_panel_is_laid_out_by_the_stylesheets_width_test(self):
        # V6s 2: in a frame 759.63 px wide (innerWidth 760) design.js laid the Properties panel out beside the canvas
        # while the stylesheet (max-width 759.98px) made it a sheet over the view: its tabs under the canvas pills.
        # On each side of 760 px, with an element selected and Properties open, no pill is over the panel. Headless
        # Chrome lays a frame out whole css px: Hermes' rounding (759.63 laid out, innerWidth 760) is a 759 px frame
        # whose innerWidth says 760.
        o = self.design(1000, 716, """
          const out = []
          for (const [w, iw] of [[759, 0], [760, 0], [761, 0], [759, 760]]) { // the made-up innerWidth last: it stays
            await api.top(`document.getElementById("f").style.width = "${w}px"`); await api.sleep(300)
            await api.frame(`(() => { if (${iw}) Object.defineProperty(window, "innerWidth", { configurable: true, get: () => ${iw} }); dispatchEvent(new Event("resize")) })()`); await api.sleep(300)
            await api.frame('__design.selectBoard(null); __design.select("Main.dc.html", [])'); await api.sleep(200)
            await api.frame('__design.selectBoard("Main.dc.html")'); await api.sleep(300)
            const st = () => api.frame(`(() => { const p = document.getElementById("dc-panel"), q = p.getBoundingClientRect()
              const pills = [...document.querySelectorAll(".dc-pill, .dc-tools")].filter(e => !e.hidden && e.getClientRects().length && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden")
              return { w: document.documentElement.getBoundingClientRect().width, open: !p.hidden && q.width > 0, sheet: document.getElementById("dc-app").classList.contains("is-sheet"), over: getComputedStyle(p).position === "absolute",
                hits: pills.filter(e => { const r = e.getBoundingClientRect(); return r.left < q.right - 0.5 && q.left < r.right - 0.5 && r.top < q.bottom - 0.5 && q.top < r.bottom - 0.5 }).map(e => e.className) } })()`)
            let s = await st()
            if (!s.open) {
              const b = await api.frame('(() => { const b = [...document.querySelectorAll(".dc-pill button")].find(b => /propert/i.test(b.getAttribute("aria-label") || b.title)); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()')
              await api.mouse(b[0], b[1]); await api.sleep(400); s = await st()
            }
            out.push(s)
          }
          return out""")
        for s in o:
            self.assertTrue(s["open"], s)
            self.assertEqual(s["sheet"], s["over"], s)  # the page and its stylesheet say the same
            self.assertEqual(s["hits"], [], s)

    BADGES = ("[...document.querySelectorAll('div[data-hermes-ui]')].filter(b => /^\d+$/.test(b.textContent))"
              ".map(b => { const r = b.getBoundingClientRect(); return { n: b.textContent, shown: b.style.display !== 'none', l: r.left, t: r.top, r: r.right, b: r.bottom } })")

    def test_a_docs_commented_part_has_its_numbered_mark(self):
        # V6s 3: a doc's open threads showed only as unnumbered 22 px margin icons. Every part with an open thread has
        # its small numbered mark at its top right, as in every type: one mark (no folded card beside it), with the
        # part as it scrolls, hidden out of sight, back with it; beside the page's cards where there is room for them.
        md = "# Doc\n\n" + "\n\n".join(f"Paragraph {i} with a few words." for i in range(40))
        aid = self.store.publish(title="Doc", type="doc", files={"doc.md": md})["id"]
        for w in (700, 1400):
            o = self.drive_page(aid, f"""
              const id = await api.frame('document.querySelectorAll(".doc-blk")[3].id')
              await api.top(`window.__post("pins", [{{selector: "#${{id}}", n: 2, text: "Why?", author: "you", replies: 0}}])`); await api.sleep(600)
              const at = async () => ({{ part: await api.frame(`(() => {{ const r = document.getElementById("${{id}}").getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }})()`),
                b: await api.frame({json.dumps(self.BADGES)}), mini: await api.frame('document.querySelectorAll(".doc-card.is-mini:not(.is-sug)").length'),
                cards: await api.frame('[...document.querySelectorAll(".doc-card")].map(c => {{ const r = c.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }})') }})
              const sc = by => api.frame(`(() => {{ const v = document.getElementById("doc-view"), e = v.scrollHeight > v.clientHeight + 1 ? v : document.scrollingElement; if (${{by}}) e.scrollBy(0, ${{by}}); else e.scrollTop = 0 }})()`)
              const a = await at()
              await sc(120); await api.sleep(400)
              const b = await at()
              await sc(3000); await api.sleep(400)
              const c = await at()
              await sc(0); await api.sleep(400)
              return {{ a, b, c, d: await at() }}""", w=w)
            a, b, c, d = o["a"], o["b"], o["c"], o["d"]
            for s in (a, b, d):
                self.assertEqual(len(s["b"]), 1, (w, o))
                m, p = s["b"][0], s["part"]
                self.assertTrue(m["shown"] and m["n"] == "2", (w, o))
                self.assertTrue(0 < m["l"] - p[2] <= 8 and abs(m["t"] - (p[1] - 9)) <= 1, (w, s))  # its top right
                self.assertEqual(s["mini"], 0, (w, s))  # no second, unnumbered mark
                for q in s["cards"]:
                    self.assertFalse(m["l"] < q[2] and q[0] < m["r"] and m["t"] < q[3] and q[1] < m["b"], ("the mark on a card", w, s))
            self.assertAlmostEqual(b["b"][0]["t"] - a["b"][0]["t"], -120, delta=1, msg=o)
            self.assertFalse(c["b"][0]["shown"], (w, o))

    def test_an_artboard_elements_thread_has_its_numbered_mark_on_the_canvas(self):
        # V6s 4: an open thread on an element of an artboard ("Coffee roasted on Tuesday") had no numbered mark: the
        # artboard draws in a frame of its own. Its frame says where the element is drawn; the mark sits at its top
        # right and goes with a pan and a zoom of the canvas.
        o = self.design(1250, 716, """
          const f = await api.frame('(() => { const b = __design.boards["Main.dc.html"].frame.iframe.getBoundingClientRect(); return [b.left + b.width * 0.25, b.top + b.height * 0.35] })()')
          await api.top('window.__post("comment-mode", {on: true})')
          for (let i = 0; i < 40 && !(await api.top('window.__events.some(e => e.event === "pick-ready")')); i++) await api.sleep(150)
          await api.mouse(f[0], f[1]); await api.sleep(700)
          const ev = await api.top('window.__events.filter(e => e.event === "picked" || e.event === "comment").pop()')
          await api.top('window.__post("comment-mode", {on: false})')
          const sel = ev.detail.selector || (ev.detail.anchor || {}).selector
          await api.top(`window.__post("pins", [{selector: ${JSON.stringify(sel)}, n: 3}])`); await api.sleep(800)
          const at = async () => ({ b: await api.frame(""" + json.dumps(self.BADGES) + """), want: await api.frame(`(() => { const b = __design.boards["Main.dc.html"], t = +${JSON.stringify(sel)}.split("#")[1].split(":")[0], r = b.marks && b.marks[t]; if (!r) return null
              const ir = b.frame.iframe.getBoundingClientRect(), k = ir.width / b.frame.iframe.offsetWidth; return [ir.left + (r.x + r.w) * k, ir.top + r.y * k] })()`) })
          const o = { sel, a: await at() }
          await api.frame('document.getElementById("dc-view").dispatchEvent(new WheelEvent("wheel", { deltaX: 60, deltaY: 40, clientX: 300, clientY: 300, bubbles: true, cancelable: true }))'); await api.sleep(400)
          o.pan = await at()
          await api.frame('document.getElementById("dc-view").dispatchEvent(new WheelEvent("wheel", { deltaY: -200, ctrlKey: true, clientX: 300, clientY: 300, bubbles: true, cancelable: true }))'); await api.sleep(400)
          o.zoom = await at()
          await api.frame('document.getElementById("dc-view").dispatchEvent(new WheelEvent("wheel", { deltaX: 5000, deltaY: 0, clientX: 300, clientY: 300, bubbles: true, cancelable: true }))'); await api.sleep(400)
          o.away = await at()
          return o""")
        self.assertRegex(o["sel"], r"^Main\.dc\.html#\d+:", o)
        for k in ("a", "pan", "zoom"):
            s = o[k]
            self.assertEqual(len(s["b"]), 1, (k, o))
            m = s["b"][0]
            self.assertTrue(m["shown"] and m["n"] == "3" and s["want"], (k, o))
            self.assertTrue(0 < m["l"] - s["want"][0] <= 8 and abs(m["t"] - (s["want"][1] - 9)) <= 1, (k, s))  # its top right
        self.assertNotAlmostEqual(o["a"]["b"][0]["l"], o["pan"]["b"][0]["l"], delta=5, msg=o)
        self.assertFalse(o["away"]["b"][0]["shown"], o)  # panned out of the canvas's sight

    def test_two_marks_that_would_meet_are_side_by_side(self):
        # V6s 4: zoomed out, two of a design's elements had their top right corners 11 px apart: their numbered marks lay
        # one over the other. A mark that would meet one before it goes right of it; two threads on one part too.
        html = ('<p id="a" style="position:absolute;left:40px;top:100px;width:200px;margin:0">One</p>'
                '<p id="b" style="position:absolute;left:40px;top:111px;width:200px;margin:0">Two</p>')
        aid = self.store.publish(title="Close", type="page", html=html)["id"]
        o = self.drive_page(aid, """
          await api.top('window.__post("pins", [{selector: "#a", n: 1}, {selector: "#b", n: 2}, {selector: "#b", n: 3}])'); await api.sleep(500)
          return await api.frame(""" + json.dumps(self.BADGES) + """)""", settle=1500)
        self.assertEqual([m["n"] for m in o if m["shown"]], ["1", "2", "3"], o)
        for i, a in enumerate(o):
            for b in o[i + 1:]:
                self.assertFalse(a["l"] < b["r"] and b["l"] < a["r"] and a["t"] < b["b"] and b["t"] < a["b"], (a, b))
        self.assertTrue(all(0 < m["l"] - 240 <= 2 * 30 + 8 for m in o), o)  # by the parts' right end, in a row
