"""The whole viewer as Hermes Desktop runs it (plugin.js's Viewer, its frames and bridge, the real doc page in an
iframe, the plugin's REST routes on a temporary store: _dom.viewer_files on _browser.Host), headless Chrome.

Round V1 of the 0.20.0 live check: a doc opened on the full page drew none of its open threads' marks (the
bridge listened to "pins" itself from the start, so the threads sent before the doc's script ran never reached
it); under 700 px "All comments" did nothing while an element was being picked (the list counted as shown while
it stepped aside, so the item closed it), and the Comment button only started picking, which shows nothing there.
Skipped without Chrome or node."""

import json
import unittest

import _browser as B
import _dom as D
from hermes_artifacts import api, docs, store

EXPORTS = "\nexport { Viewer, openArtifact, closeArtifact, Ago, clock, sawEdit, shownUpdated, $list, $panel, $panelHere, $picking, $panelShown, STRINGS }\n"
BOOT = """
  await api.go(URL, 400)
  for (let i = 0; i < 50 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(100)
  await api.top(`(async () => { const { M, R, jsx, ctx } = window.H; M.$list.set((await ctx.rest('/artifacts')).artifacts)
    M.openArtifact(ctx, ${JSON.stringify(AID)}); R.mount(() => jsx(M.Viewer, { ctx }), document.getElementById('root')) })()`)
  for (let i = 0; i < 60; i++) { await api.sleep(150); try { if (await api.frame('document.querySelectorAll(".doc-blk").length > 0')) break } catch (_) {} }
  await api.sleep(800)
  const btn = async label => { const r = await api.top(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.title === ${JSON.stringify(label)} || b.getAttribute("aria-label") === ${JSON.stringify(label)} || b.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return null; const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2] })()`); if (!r) throw new Error('no button ' + label); await api.mouse(r[0], r[1]); await api.sleep(400) }
  const list = () => api.top('(() => { const a = document.querySelector("aside"); if (!a) return null; const b = a.getBoundingClientRect(); return { display: getComputedStyle(a).display, w: Math.round(b.width), shown: window.H.M.$panelShown.get(), picking: window.H.M.$picking.get() } })()')
"""


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class ViewerComments(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def setUp(self):
        self.aid = store.publish(title="Marks", type="doc", files={"doc.md": "# Marks\n\nThis document describes the steps.\n\nSecond paragraph here."})["id"]
        b = docs.read(self.aid)["blocks"]
        for blk, q in ((b[1], "describes"), (b[2], "Second")):
            api.handle("POST", f"artifacts/{self.aid}/comments", {}, {"text": "note " + q, "anchor": {"selector": f"#blk-{blk['id']}", "text": q, "label": "text"}})

    def drive(self, body, w=1300):
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(self.aid)}; await api.size({w}, 800);" + BOOT + body)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_open_threads_are_marked_on_load_and_a_thread_clicked_flashes_its_element(self):
        for w in (1300, 600):  # the full page, and narrow (the doc's cards fold to small marks)
            out = self.drive("""
              const marks = await api.frame('[...document.querySelectorAll("mark.doc-cq")].map(m => m.textContent)')
              const cards = await api.frame('document.querySelectorAll(".doc-card").length')
              await btn('More comment options'); await btn('All comments')
              const thread = await api.top('(() => { const t = [...document.querySelectorAll("aside div")].find(d => d.textContent.trim() === "note Second"); const b = t.getBoundingClientRect(); return [b.left + 10, b.top + b.height / 2] })()')
              await api.mouse(thread[0], thread[1]); await api.sleep(250)
              const flash = await api.frame('document.querySelectorAll("[data-hermes-ui]").length')
              return { marks, cards, flash }""", w)
            self.assertEqual(sorted(out["marks"]), ["Second", "describes"], (w, out))
            self.assertEqual(out["cards"], 2, (w, out))
            self.assertGreaterEqual(out["flash"], 1, (w, out))  # the bridge's flash box on the element

    def test_under_700_px_every_way_opens_the_whole_stage_list_at_the_first_click(self):
        for w in (400, 614):
            out = self.drive("""
              const o = {}
              await btn('Comment'); o.button = await list()               // the Comment button (its count): the list
              await btn('Back to the artifact'); o.back = await list()
              await api.top('window.H.M.$picking.set(true)'); await api.sleep(200)   // an element being picked
              await btn('More comment options'); await btn('All comments'); o.all = await list()
              return o""", w)
            for k in ("button", "all"):
                self.assertEqual((out[k]["display"], out[k]["shown"], out[k]["picking"]), ("flex", True, False), (w, k, out))
                self.assertEqual(out[k]["w"], w, (w, k, out))  # the whole stage
            self.assertFalse(out["back"]["shown"], out)

    def test_wide_the_comment_button_picks_and_the_list_docks_beside(self):
        out = self.drive("""
          const o = {}
          await btn('Comment'); o.pick = await api.top('window.H.M.$picking.get()')
          await btn('Comment'); await btn('More comment options'); await btn('All comments'); o.all = await list()
          return o""", 1300)
        self.assertTrue(out["pick"])
        self.assertEqual((out["all"]["display"], out["all"]["shown"]), ("flex", True))
        self.assertIn(out["all"]["w"], (340, 341))  # PANEL_W beside the stage (and its border)


    def test_a_thread_shown_from_the_whole_stage_list_shows_its_element_and_the_list_comes_back_where_it_was(self):
        # live round V3: at 400 px a click on a thread flashed its element behind the list, out of sight
        b = docs.read(self.aid)["blocks"]
        for i in range(10):  # a list long enough to scroll
            api.handle("POST", f"artifacts/{self.aid}/comments", {}, {"text": f"more {i}", "anchor": {"selector": f"#blk-{b[1]['id']}", "text": "steps", "label": "text"}})
        for w in (400, 1300):
            out = self.drive("""
              const o = {}, scroller = 'document.querySelector("aside").children[1]'
              await btn('More comment options'); await btn('All comments')
              await api.top(scroller + '.scrollTop = 120'); await api.sleep(200)
              o.top = await api.top(scroller + '.scrollTop')
              const show = await api.top('(() => { const t = [...document.querySelectorAll("aside div")].find(d => d.textContent.trim() === "note Second").parentElement; const s = [...t.querySelectorAll("button")].find(x => x.textContent === "Show"); s.scrollIntoView({block: "center"}); const b = s.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()')
              o.topBefore = await api.top(scroller + '.scrollTop')
              await api.mouse(show[0], show[1]); await api.sleep(250)
              o.after = await list()
              o.flash = await api.frame('document.querySelectorAll("[data-hermes-ui]").length')
              o.seen = await api.frame('(() => { const r = document.querySelector("mark.doc-cq[data-cq*=Second]").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })()')
              if (!o.after.shown) { await api.sleep(1500); await btn('Comment') }
              o.again = await list(); o.topAgain = await api.top(scroller + '.scrollTop')
              return o""", w)
            self.assertGreaterEqual(out["flash"], 1, (w, out))  # the element flashed
            self.assertTrue(out["seen"], (w, out))
            if w == 400:  # the whole-stage list stepped aside for it and came back where it was
                self.assertFalse(out["after"]["shown"], out)
                self.assertTrue(out["again"]["shown"], out)
                self.assertEqual(out["topAgain"], out["topBefore"], out)
            else:  # docked beside the page: it stays
                self.assertTrue(out["after"]["shown"], out)

    def test_a_discarded_draft_leaves_every_open_thread_marked(self):
        # live round V3 (3 of 3): Comment, a list item picked (the draft opens), a click into the paragraph that
        # holds an open thread's mark, Discard: that mark was gone until the doc was opened again
        aid = store.publish(title="Draft", type="doc", files={"doc.md": "# Draft\n\nThe paragraph with a thread in it.\n\n- First item\n- Second item"})["id"]
        blk = docs.read(aid)["blocks"]
        api.handle("POST", f"artifacts/{aid}/comments", {}, {"text": "note thread", "anchor": {"selector": f"#blk-{blk[1]['id']}", "text": "thread", "label": "text"}})
        self.aid = aid
        out = self.drive("""
          const at = async sel => { const f = await api.top('(() => { const r = document.querySelector("iframe").getBoundingClientRect(); return [r.left, r.top] })()')
            const r = await api.frame('(() => { const e = ' + sel + '; const b = e.getBoundingClientRect(); return [b.left + Math.min(40, b.width / 2), b.top + b.height / 2] })()'); return [f[0] + r[0], f[1] + r[1]] }
          const marks = () => api.frame('[...document.querySelectorAll("mark.doc-cq")].map(m => m.textContent)')
          const o = { before: await marks() }
          await btn('Comment')
          let p = await at('document.querySelector(".doc-blk li")'); await api.mouse(p[0], p[1]); await api.sleep(500)
          o.draft = await api.top('!!document.querySelector("textarea")')
          p = await at('document.querySelector("mark.doc-cq").closest(".doc-blk")'); await api.mouse(p[0] + 10, p[1]); await api.sleep(400)
          o.inBlock = await api.frame('!!document.activeElement.closest(".doc-blk")')
          await btn('Discard'); await api.sleep(800)
          o.after = await marks()
          return o""")
        self.assertEqual(out["before"], ["thread"], out)
        self.assertTrue(out["draft"], out)
        self.assertTrue(out["inBlock"], out)
        self.assertEqual(out["after"], ["thread"], out)

    # Live round V4.
    HINT = ('(() => { const h = document.querySelector("[data-ha-pick-hint]"); if (!h) return null; const r = h.getBoundingClientRect(), f = document.querySelector("iframe").getBoundingClientRect();'
            ' const over = [...document.querySelectorAll("button, iframe")].filter(b => !h.contains(b)).some(b => { const q = b.getBoundingClientRect(); return q.width && q.left < r.right && r.left < q.right && q.top < r.bottom && r.top < q.bottom });'
            ' return { text: h.textContent, over, above: r.bottom <= f.top + 0.5, picking: window.H.M.$picking.get() } })()')
    CURSOR = 'getComputedStyle(document.querySelector(".doc-blk a, .doc-blk")).cursor'

    def test_picking_says_so_in_a_band_over_nothing_and_esc_or_cancel_ends_it(self):
        # V4: the header's Comment (the list closed, docked) armed picking with nothing shown but its own highlight
        for w in (1300, 400):
            out = self.drive(f"""
              const o = {{}}, hint = () => api.top({json.dumps(self.HINT)})
              await btn('Comment')
              if (await api.top('!window.H.M.$picking.get()')) {{  // narrow: the list first, its own Comment picks
                const p = await api.top('(() => {{ const b = document.querySelector("aside button[title=Comment]"); const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2] }})()')
                await api.mouse(p[0], p[1]); await api.sleep(400)
              }}
              o.on = await hint(); o.cursor = await api.frame({json.dumps(self.CURSOR)})
              await api.key('Escape', 'Escape', 27); await api.sleep(300); o.esc = await hint()
              o.cursorAfter = await api.frame({json.dumps(self.CURSOR)})
              await api.top('window.H.M.$picking.set(true)'); await api.sleep(300)
              await api.frame('window.dispatchEvent(new KeyboardEvent("keydown", {{key: "Escape", bubbles: true}}))'); await api.sleep(300)
              o.escInPage = await hint()
              await api.top('window.H.M.$picking.set(true)'); await api.sleep(300); await btn('Cancel'); o.cancel = await hint()
              return o""", w)
            on = out["on"]
            self.assertTrue(on and on["picking"], (w, out))
            self.assertIn("Esc", on["text"], (w, out))
            self.assertFalse(on["over"], (w, out))  # over no button and not over the page
            self.assertTrue(on["above"], (w, out))
            self.assertEqual(out["cursor"], "crosshair", (w, out))
            self.assertNotEqual(out["cursorAfter"], "crosshair", (w, out))
            for k in ("esc", "escInPage", "cancel"):
                self.assertIsNone(out[k], (w, k, out))

    def test_updated_follows_an_edit_while_open_and_the_gallery_has_it_at_once(self):
        # V4: "Updated" in the title menu stayed at the time the doc was opened; the gallery showed the old time
        m = store.get_meta(self.aid)
        m["updated"] = m["updated"] - 86400
        store._write_meta(store._dir(self.aid), m)
        out = self.drive(f"""
          const o = {{}}, mine = 'window.H.M.$list.get().find(a => a.id === ' + JSON.stringify(AID) + ').updated', upd = () => api.top(mine)
          const sub = async () => {{ await btn('Marks'); const s = await api.top('(() => {{ const d = [...document.querySelectorAll("div")].find(x => x.children.length === 0 && /^Updated /.test(x.textContent)); return d ? d.textContent : null }})()'); await api.key('Escape', 'Escape', 27); await api.sleep(200); return s }}
          o.t0 = Date.now() / 1000; o.before = await upd(); o.menuBefore = await sub()
          await api.clickIn('document.querySelectorAll(".doc-blk")[1]'); await api.key('End', 'End', 35); await api.type(' typed'); await api.sleep(2500)
          o.after = await upd()
          o.menuAfter = await sub()
          o.closed = await api.top('(() => {{ window.H.M.closeArtifact(); return ' + mine + ' }})()')
          return o""")
        self.assertLess(out["before"], out["t0"] - 80000, out)
        self.assertGreaterEqual(out["after"], out["t0"] - 1, out)  # the edit seen here (sawEdit), no poll
        self.assertTrue(out["menuBefore"] and out["menuAfter"], out)
        self.assertNotEqual(out["menuBefore"], out["menuAfter"], out)
        self.assertGreaterEqual(out["closed"], out["t0"] - 1, out)  # the gallery's list, as it goes back

    def test_ages_tick_on_one_shared_clock_paused_while_hidden_and_released(self):
        # V4: a card's "1m" stayed at 127, 147 and 201 s while a search kept the list as it was
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"""
          await api.go({json.dumps(url)}, 400)
          for (let i = 0; i < 50 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(100)
          const st = () => api.top('(() => {{ const c = window.H.M.clock; return {{ subs: c.subs.size, timer: !!c.timer, watching: c.watching, text: document.getElementById("root").textContent }} }})()')
          const o = {{}}
          await api.top(`(() => {{ const {{ M, R, jsx }} = window.H, now = Date.now() / 1000
            R.mount(() => jsx('div', {{ children: [jsx(M.Ago, {{ ts: now - 59 }}), jsx('span', {{ children: '|' }}), jsx(M.Ago, {{ ts: now - 3599, fmt: s => 'Deleted ' + s }})] }}), document.getElementById('root')) }})()`)
          await api.sleep(200); o.mounted = await st()
          await api.sleep(1300); await api.top('window.H.M.clock.tick()'); await api.sleep(200); o.ticked = await st()
          await api.top('(() => {{ Object.defineProperty(document, "hidden", {{ configurable: true, get: () => true }}); document.dispatchEvent(new Event("visibilitychange")) }})()')
          o.hidden = await st()
          await api.top('(() => {{ delete document.hidden; document.dispatchEvent(new Event("visibilitychange")) }})()')
          o.back = await st()
          await api.top('window.H.R.unmount()'); await api.sleep(200); o.gone = await st()
          return o""")
        self.assertIsNone(r.get("err"), r)
        out = r["out"]
        self.assertEqual(out["mounted"]["text"], "now|Deleted 59m", out)
        self.assertEqual((out["mounted"]["subs"], out["mounted"]["timer"], out["mounted"]["watching"]), (2, True, True), out)
        self.assertEqual(out["ticked"]["text"], "1m|Deleted 1h", out)
        self.assertFalse(out["hidden"]["timer"], out)  # paused out of sight
        self.assertTrue(out["back"]["timer"], out)
        self.assertEqual((out["gone"]["subs"], out["gone"]["timer"], out["gone"]["watching"]), (0, False, False), out)

    def test_a_flashed_block_keeps_clear_of_its_margin_icon(self):
        # V4: docked at 1500 the "Show" flash covered the doc's comment icon in the margin for its 1.6 s
        for w in (1000, 1300, 1500):
            out = self.drive("""
              await btn('More comment options'); await btn('All comments')
              const show = await api.top('(() => { const t = [...document.querySelectorAll("aside div")].find(d => d.textContent.trim() === "note describes").parentElement; const s = [...t.querySelectorAll("button")].find(x => x.textContent === "Show"); const b = s.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()')
              await api.mouse(show[0], show[1]); await api.sleep(600)
              return await api.frame(`(() => { const f = [...document.querySelectorAll("div[data-hermes-ui]")].pop(); if (!f) return null; const r = f.getBoundingClientRect()
                return { box: [r.left, r.right], cards: [...document.querySelectorAll(".doc-margin > *")].filter(c => { const q = c.getBoundingClientRect(); return q.width && q.top < r.bottom + 7 && q.bottom > r.top - 7 })
                  .map(c => { const q = c.getBoundingClientRect(); return Math.max(q.left - r.right, r.left - q.right) }) } })()`)""", w)
            self.assertTrue(out and out["cards"], (w, out))  # a card or icon beside the flashed block
            self.assertTrue(all(g >= 3 + 4 - 0.5 for g in out["cards"]), (w, out))  # its 3 px halo and 4 px clear


    def test_picking_presses_the_comment_button_until_it_ends(self):
        # V5: the header's Comment showed no pressed state while picking was armed
        out = self.drive("""
          const st = () => api.top('(() => { const b = [...document.querySelectorAll("header button, button")].find(b => b.getAttribute("aria-label") === "Comment"); return { pressed: b.hasAttribute("aria-pressed") && b.getAttribute("aria-pressed") !== "false", bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color, picking: window.H.M.$picking.get() } })()')
          const o = { before: await st() }
          await btn('Comment'); await api.mouse(5, 400); await api.sleep(300); o.armed = await st()
          await api.key('Escape', 'Escape', 27); await api.sleep(300); await api.mouse(5, 400); await api.sleep(300); o.after = await st()
          return o""")
        self.assertEqual((out["armed"]["picking"], out["armed"]["pressed"]), (True, True), out)  # (the tests' React writes a true one as "")
        self.assertNotEqual(out["armed"]["bg"], out["before"]["bg"], out)  # the pressed look, not only the attribute
        self.assertEqual((out["after"]["picking"], out["after"]["pressed"]), (False, False), out)
        self.assertEqual(out["after"]["bg"], out["before"]["bg"], out)

    def test_an_age_turns_within_seconds_of_its_minute_and_updated_shows_the_latest_edit(self):
        # V5: a card read "now" 67-80 s after its edit (the clock ticked twice a minute), and an edit within 30 s of
        # the list's "updated" did not move the open viewer's "Updated" (only the list is throttled now)
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"""
          await api.go({json.dumps(url)}, 400)
          for (let i = 0; i < 50 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(100)
          const o = {{}}
          await api.top(`(() => {{ const {{ M, R, jsx }} = window.H, now = Date.now() / 1000
            R.mount(() => jsx(M.Ago, {{ ts: now - 55 }}), document.getElementById('root')) }})()`)
          await api.sleep(200); o.mounted = await api.top('document.getElementById("root").textContent')
          await api.sleep(6500); o.later = await api.top('document.getElementById("root").textContent')  // no tick called: the clock's own
          await api.top('window.H.R.unmount()')
          o.seen = await api.top(`(() => {{ const M = window.H.M, now = Date.now() / 1000, id = 'x1'
            M.$list.set([{{ id, title: 'X', type: 'doc', version: 1, versions: [1], updated: now - 10 }}])
            M.sawEdit(id, now)
            const a = M.$list.get()[0]
            return {{ list: a.updated, shown: M.shownUpdated(a), now }} }})()`)
          return o""")
        self.assertIsNone(r.get("err"), r)
        o = r["out"]
        self.assertEqual(o["mounted"], "now", o)
        self.assertEqual(o["later"], "1m", o)  # within AGE_TICK_MS of the minute's turn
        s = o["seen"]
        self.assertLess(s["list"], s["now"] - 5, s)  # the list itself waits (SEEN_EVERY_S)
        self.assertGreaterEqual(s["shown"], s["now"] - 0.01, s)  # what the title menu says does not

    def test_a_first_load_shows_loading_until_its_page_is_drawn(self):
        # V5: a pane opened beside a chat was a blank area for ~2 s while the doc's page booted in its frame
        for docked in (False, True):
            url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
            r = B.drive(f"""
              const URL = {json.dumps(url)}, AID = {json.dumps(self.aid)}; await api.size(900, 800)
              await api.go(URL, 400)
              for (let i = 0; i < 50 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(100)
              await api.top(`(async () => {{ const {{ M, R, jsx, ctx }} = window.H; M.$list.set((await ctx.rest('/artifacts')).artifacts)
                M.openArtifact(ctx, ${{JSON.stringify(AID)}}); R.mount(() => jsx(M.Viewer, {{ ctx, docked: {str(docked).lower()} }}), document.getElementById('root')) }})()`)
              const seen = []
              for (let i = 0; i < 120; i++) {{
                const s = await api.top('(() => {{ const f = document.querySelector("iframe"), l = [...document.querySelectorAll("div")].find(d => !d.children.length && d.textContent === "Loading…" && d.getClientRects().length);'
                  + ' let over = false; if (f && l) {{ const a = f.getBoundingClientRect(), x = a.left + a.width / 2, y = a.top + a.height / 2; const top = document.elementFromPoint(x, y); over = !!top && top !== f && !f.contains(top) }}'
                  + ' return {{ frame: !!f, loading: !!l, over }} }})()')
                let drawn = false; try {{ drawn = s.frame && await api.frame('document.querySelectorAll(".doc-blk").length > 0') }} catch (_) {{}}
                seen.push({{ ...s, drawn }})
                if (drawn && !s.loading) break
                await api.sleep(40)
              }}
              return seen""")
            self.assertIsNone(r.get("err"), r)
            seen = r["out"]
            self.assertTrue(seen and seen[-1]["drawn"] and not seen[-1]["loading"], (docked, seen[-6:]))  # gone once drawn
            blank = [s for s in seen if s["frame"] and not s["drawn"] and not (s["loading"] and s["over"])]
            self.assertEqual(blank, [], (docked, seen))  # never the frame's own blank while its page boots


    def test_the_docs_selection_bar_closes_when_the_host_takes_the_focus(self):
        # V6a: a word double-clicked (its bar up), then the header's Comment: the bar stayed, cut at the list's edge
        out = self.drive("""
          const bar = () => api.frame('(() => { const b = document.querySelector(".doc-selbar"); return !!b && !b.hidden })()')
          const pick = async () => { await api.clickIn('document.querySelectorAll(".doc-blk")[1]'); await api.frame('(() => { const p = document.querySelectorAll(".doc-blk")[1], w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode(), r = document.createRange(); r.setStart(w, 0); r.setEnd(w, 8); getSelection().removeAllRanges(); getSelection().addRange(r) })()'); await api.sleep(500) }
          const o = {}
          await pick(); o.shown = await bar()
          await btn('Comment'); await api.sleep(300); o.armed = await bar()
          await api.key('Escape', 'Escape', 27); await api.sleep(200)
          await pick(); o.again = await bar()
          await btn('More comment options'); await btn('All comments'); await api.sleep(300); o.list = await bar()
          return o""")
        self.assertEqual(out, {"shown": True, "armed": False, "again": True, "list": False})


if __name__ == "__main__":
    unittest.main()
