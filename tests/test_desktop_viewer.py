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

EXPORTS = "\nexport { Viewer, openArtifact, closeArtifact, Ago, clock, sawEdit, shownUpdated, $list, $panel, $panelHere, $picking, $panelShown, $draft, STRINGS }\n"
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
            ' return { text: h.textContent, over, above: r.bottom <= f.top + 0.5, picking: window.H.M.$picking.get(),'
            ' cut: [...h.querySelectorAll("span")].some(s => s.scrollWidth > s.clientWidth + 0.5) } })()')
    CURSOR = 'getComputedStyle(document.querySelector(".doc-blk a, .doc-blk")).cursor'

    def test_picking_says_so_in_a_band_over_nothing_and_esc_or_cancel_ends_it(self):
        # V4: the header's Comment (the list closed, docked) armed picking with nothing shown but its own highlight
        for w in (1300, 406, 400):
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
            # V6d at 406 px: "Click what you wa…", the Esc advice lost: the whole hint or its short form, never cut
            self.assertIn(on["text"], ("Click what you want to comment on · Esc to cancelCancel", "Click a part · EscCancel"), (w, out))
            self.assertFalse(on["cut"], (w, out))
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



# Any type's page in the viewer (BOOT is the doc's): ready once SEL (frame JS) finds its part drawn.
BOOT_ANY = """
  await api.go(URL, 400)
  for (let i = 0; i < 50 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(100)
  await api.top(`(async () => { const { M, R, jsx, ctx } = window.H; M.$list.set((await ctx.rest('/artifacts')).artifacts)
    M.openArtifact(ctx, ${JSON.stringify(AID)}); R.mount(() => jsx(M.Viewer, { ctx }), document.getElementById('root')) })()`)
  for (let i = 0; i < 80; i++) { await api.sleep(150); try { if (await api.frame('!!(' + SEL + ')')) break } catch (_) {} }
  await api.sleep(SETTLE)
  const frameAt = () => api.top('(() => { const r = document.querySelector("iframe").getBoundingClientRect(); return [r.left, r.top] })()')
  // Picking armed, a real click at the frame's point q (frame JS, read once picking shows its band): the new
  // comment's pin and box (in the window), and the page's own controls that `chrome` (frame JS: a list of
  // elements) finds, in the window too.
  const pickAt = async (where, chrome) => {
    await api.top('window.H.M.$picking.set(true)'); await api.sleep(300)
    let off = await frameAt(); const q = await api.frame(where)
    await api.mouse(off[0] + q[0], off[1] + q[1]); await api.sleep(900)
    off = await frameAt()
    const top = await api.top(`(() => { const box = q => { const b = q.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom } }
      const ta = document.querySelector('textarea'), card = ta && ta.closest('div[style*="z-index: 27"]')
      const pin = [...document.querySelectorAll('div')].find(d => d.style.zIndex === '28' && d.style.borderRadius === '50%')
      return { box: card ? box(card) : null, pin: pin ? box(pin) : null, title: card ? card.firstElementChild.textContent : null, selector: (window.H.M.$draft.get() || { anchor: {} }).anchor.selector } })()`)
    const kept = await api.frame('(' + chrome + ').filter(e => e.getClientRects().length).map(e => { const b = e.getBoundingClientRect(); return { n: e.id || e.className, l: b.left, t: b.top, r: b.right, b: b.bottom } })')
    return { ...top, off, kept: kept.map(k => ({ ...k, l: k.l + off[0], r: k.r + off[0], t: k.t + off[1], b: k.b + off[1] })) }
  }
"""


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class CommentBoxOffThePagesControls(unittest.TestCase):
    """Live round V6: the new comment's box sat over a film's playback bar and scenes (and had no pin on its
    picture: a point has no size, so the bridge said it was out of sight and the box waited in the corner), over a
    design's tool palette after a pan and over the name strip of the very artboard commented on, and over a deck's
    thumbnails after a pick on the slide's blank. Each page marks its own controls (data-comment-keep) and the box
    keeps off them where there is room, at 1500 and at 400 px."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def drive(self, aid, sel, body, w, h=900, settle=1500):
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = {json.dumps(sel)}, SETTLE = {settle}; await api.size({w}, {h});"
                    + BOOT_ANY + body, timeout=240)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def clear(self, o, what):
        self.assertTrue(o["box"], (what, o))
        self.assertTrue(o["kept"], (what, o))  # the controls were there to keep off
        b = o["box"]
        for k in o["kept"]:
            self.assertFalse(b["l"] < k["r"] - 0.5 and k["l"] < b["r"] - 0.5 and b["t"] < k["b"] - 0.5 and k["t"] < b["b"] - 0.5, (what, k, o))

    def test_a_films_point_has_its_pin_and_the_box_keeps_off_the_playback_bar_and_scenes(self):
        aid = store.publish(path=str(D.ROOT / "examples" / "motion"), title="Harbor film", type="motion")["id"]
        for w in (1500, 400):
            # the tester's point: the sky right of the title (73 %, 29 %); and one low on the water (40 %, 85 %)
            for fx, fy in ((0.73, 0.29), (0.4, 0.85)):
                o = self.drive(aid, 'document.querySelector("#mo-frame")', f"""
                  const o = await pickAt('(() => {{ const r = document.getElementById("mo-frame").getBoundingClientRect(); return [r.left + r.width * {fx}, r.top + r.height * {fy}] }})()', '[document.getElementById("mo-controls")]')
                  // the point said in the comment, on the picture as it is now (the band gone, the frame taller)
                  const xy = (/@xy=([0-9.]+)%,([0-9.]+)%/.exec(o.selector) || []).slice(1).map(Number)
                  o.at = await api.frame(`(() => {{ const r = document.getElementById("mo-frame").getBoundingClientRect(); return [r.left + r.width * ${{xy[0]}} / 100, r.top + r.height * ${{xy[1]}} / 100] }})()`)
                  o.at = [o.at[0] + o.off[0], o.at[1] + o.off[1]]
                  return o""", w, settle=2500)
                what = (w, fx, fy)
                self.assertTrue(o["pin"], (what, o))  # V6: no pin while the draft was open
                self.assertAlmostEqual((o["pin"]["l"] + o["pin"]["r"]) / 2, o["at"][0], delta=2, msg=(what, o))
                self.assertAlmostEqual((o["pin"]["t"] + o["pin"]["b"]) / 2, o["at"][1], delta=2, msg=(what, o))
                self.clear(o, what)

    def test_a_design_box_keeps_off_its_palette_after_a_pan_and_off_the_strip_commented_on(self):
        aid = store.publish(path=str(D.ROOT / "examples" / "design"), title="Test design", type="design")["id"]
        chrome = '[...document.querySelectorAll(".dc-pill, .dc-strip")]'
        board = '__design.boards["Main.dc.html"].el'
        for w in (1500, 400):
            # panned (the wheel) until a point high in the landing page sits 250 px over the canvas's foot, then picked
            o = self.drive(aid, board, f"""
              const spot = () => api.frame('(() => {{ const r = {board}.querySelector("iframe").getBoundingClientRect(), v = document.getElementById("dc-view").getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + Math.min(r.height * 0.2, 120), v.left + v.width * 0.45, v.bottom - 250] }})()')
              for (let i = 0; i < 4; i++) {{ const s = await spot(); await api.frame(`document.getElementById("dc-view").dispatchEvent(new WheelEvent("wheel", {{ deltaX: ${{s[0] - s[2]}}, deltaY: ${{s[1] - s[3]}}, clientX: 200, clientY: 200, bubbles: true, cancelable: true }}))`); await api.sleep(300) }}
              return await pickAt('(() => {{ const r = {board}.querySelector("iframe").getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + Math.min(r.height * 0.2, 120)] }})()', {json.dumps(chrome)})""", w, settle=3000)
            self.clear(o, (w, "panned"))
            # a pick on the landing page's name strip: a comment on that artboard, its strip kept clear (zoomed in on
            # it until its name shows: at 400 px the whole canvas fitted is too small for any)
            o = self.drive(aid, board, f"""
              await api.frame('__design.fitAll()'); await api.sleep(600)
              for (let i = 0; i < 12 && await api.frame('getComputedStyle({board}.querySelector(".dc-strip")).visibility !== "visible"'); i++) {{
                await api.frame('(() => {{ const r = {board}.getBoundingClientRect(); document.getElementById("dc-view").dispatchEvent(new WheelEvent("wheel", {{ deltaY: -120, ctrlKey: true, clientX: r.left + 10, clientY: r.top + 10, bubbles: true, cancelable: true }})) }})()'); await api.sleep(250)
              }}
              const o = await pickAt('(() => {{ const r = {board}.querySelector(".dc-strip").getBoundingClientRect(); return [r.left + Math.min(30, r.width / 3), r.top + r.height / 2] }})()', {json.dumps(chrome)})
              const s = await api.frame('(() => {{ const r = {board}.querySelector(".dc-strip").getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }})()')
              o.strip = [s[0] + o.off[0], s[1] + o.off[1], s[2] + o.off[0], s[3] + o.off[1]]
              // the name's words and the strip's buttons, in the window
              o.parts = (await api.frame('(() => {{ const s = {board}.querySelector(".dc-strip"), rg = document.createRange(); rg.selectNodeContents(s.querySelector(".dc-name"))'
                + '; return [rg.getBoundingClientRect(), ...[...s.querySelectorAll("button")].filter(b => b.getClientRects().length).map(b => b.getBoundingClientRect())].map(b => [b.left, b.right]) }})()'))
                .map(p => [p[0] + o.off[0], p[1] + o.off[0]])
              return o""", w, settle=3000)
            self.clear(o, (w, "strip"))
            # V6d: the pin lay 6 px left of the artboard, off it: on the strip picked
            self.assertTrue(o["pin"], (w, o))
            cx, cy = (o["pin"]["l"] + o["pin"]["r"]) / 2, (o["pin"]["t"] + o["pin"]["b"]) / 2
            self.assertTrue(o["strip"][0] <= cx <= o["strip"][2] and o["strip"][1] <= cy <= o["strip"][3], ("pin off the strip", w, o))
            # V6e: its centre was 11 px before the name's end, on "…age"; the box 7 px off the strip. The pin goes
            # after the name and its buttons, PIN_GAP (6 px) past the last, as after any words; the box 8 px off
            end = max(p[1] for p in o["parts"])
            self.assertTrue(0 <= o["pin"]["l"] - end <= 12, ("pin not right after the name and its buttons", w, o))
            b, s = o["box"], o["strip"]
            self.assertGreaterEqual(max(b["l"] - s[2], s[0] - b["r"], b["t"] - s[3], s[1] - b["b"]), 8 - 0.5, ("box within 8 px of the strip", w, o))

    def test_every_artboards_strip_comment_has_its_pin_on_the_strip_and_the_box_by_it(self):
        # V6f (1506 px window: a 1246 x 750 frame): "App: pick a drink" and "App: your order" (phone artboards: no room
        # after the strip's buttons before the next strip) opened with no pin (it went left of the strip, onto the
        # landing page's, a control: not drawn) and the box 235 px under the strip (off every artboard); strips 3 and
        # 4 had their pin and the same far box. A pin on its strip, after the buttons or over/under its end, never on
        # the name, a button or another strip; the box 8-12 px from the strip, off every strip.
        aid = store.publish(path=str(D.ROOT / "examples" / "design"), title="Test design", type="design")["id"]
        strips = ('[...Object.values(__design.boards)].map(b => b.strip).filter(s => getComputedStyle(s).visibility === "visible" && s.getClientRects().length)'
                  '.map(s => { const r = s.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(s.querySelector(".dc-name"))'
                  '; return { r: [r.left, r.top, r.right, r.bottom], parts: [rg.getBoundingClientRect(), ...[...s.querySelectorAll("button")].filter(b => b.getClientRects().length).map(b => b.getBoundingClientRect())].map(b => [b.left, b.top, b.right, b.bottom]) } })')
        meet = lambda a, b: a[0] < b[2] - 0.5 and b[0] < a[2] - 0.5 and a[1] < b[3] - 0.5 and b[1] < a[3] - 0.5
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        done = 0
        for w, h in ((1246, 798), (1500, 900)):
            for i in range(5):
                r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = '__design.boards[\"Main.dc.html\"].el', SETTLE = 3000; await api.size({w}, {h});" + BOOT_ANY + f"""
                  const all = await api.frame({json.dumps(strips)}), off = await frameAt()
                  if (all.length <= {i}) return null
                  const s = all[{i}]
                  await api.top('window.H.M.$picking.set(true)'); await api.sleep(300)
                  await api.mouse(off[0] + s.parts[0][0] + 6, off[1] + (s.r[1] + s.r[3]) / 2); await api.sleep(1200)
                  const top = await api.top(`(() => {{ const box = q => {{ const b = q.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }}
                    const ta = document.querySelector('textarea'), card = ta && ta.closest('div[style*="z-index: 27"]')
                    const pin = [...document.querySelectorAll('div')].find(d => d.style.zIndex === '28' && d.style.borderRadius === '50%')
                    return {{ box: card ? box(card) : null, pin: pin ? box(pin) : null, label: (window.H.M.$draft.get() || {{ anchor: {{}} }}).anchor.label }} }})()`)
                  const mv = q => [q[0] + off[0], q[1] + off[1], q[2] + off[0], q[3] + off[1]]
                  // what of the name shows: it is cut at the strip's end (an ellipsis)
                  const seen = q => [Math.max(q[0], s.r[0]), q[1], Math.min(q[2], s.r[2]), q[3]]
                  return {{ ...top, strip: mv(s.r), parts: s.parts.map(seen).map(mv), others: all.filter((x, j) => j !== {i}).map(x => mv(x.r)) }}""", timeout=240)
                self.assertIsNone(r.get("err"), r)
                o = r["out"]
                if not o:
                    continue
                done += 1
                what = (w, i, o)
                self.assertTrue(o["pin"], ("no pin", what))
                p, s, b = o["pin"], o["strip"], o["box"]
                for q in o["parts"]:
                    self.assertFalse(meet(p, q), ("pin on the name or a button", q, what))
                for q in o["others"]:
                    self.assertFalse(meet(p, q), ("pin on another strip", q, what))
                    self.assertFalse(meet(b, q), ("box on another strip", q, what))
                self.assertTrue(s[0] - 0.5 <= (p[0] + p[2]) / 2 <= s[2] + 40 and s[1] - 40 <= (p[1] + p[3]) / 2 <= s[3] + 40, ("pin off its strip", what))
                self.assertFalse(meet(b, s), what)
                gap = max(b[0] - s[2], s[0] - b[2], b[1] - s[3], s[1] - b[3])
                self.assertTrue(7.5 <= gap <= 14, ("box not by its strip", gap, what))
        self.assertGreaterEqual(done, 6)

    def test_the_box_follows_its_pin_as_the_canvas_zooms(self):
        # V6f: a design's element commented on, the canvas zoomed in and out: the pin followed, the box stayed up to
        # 200 px behind on the empty canvas. It keeps its place by the pin, as it does on a pan.
        aid = store.publish(path=str(D.ROOT / "examples" / "design"), title="Test design", type="design")["id"]
        board = '__design.boards["Main.dc.html"].el'
        o = self.drive(aid, board, f"""
          const o = await pickAt('(() => {{ const r = {board}.querySelector("iframe").getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + r.height * 0.35] }})()', '[]')
          const rel = () => api.top(`(() => {{ const box = q => {{ const b = q.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }}
            const ta = document.querySelector('textarea'), card = ta && ta.closest('div[style*="z-index: 27"]')
            const pin = [...document.querySelectorAll('div')].find(d => d.style.zIndex === '28' && d.style.borderRadius === '50%')
            return card && pin ? [box(card), box(pin)] : null }})()`)
          const steps = [await rel()]
          for (const dy of [-120, -120, 300, 240]) {{
            await api.frame(`document.getElementById("dc-view").dispatchEvent(new WheelEvent("wheel", {{ deltaY: ${{dy}}, ctrlKey: true, clientX: 300, clientY: 300, bubbles: true, cancelable: true }}))`); await api.sleep(700)
            steps.push(await rel())
          }}
          return steps""", 1246, h=798, settle=3000)
        for st in o:
            self.assertTrue(st, o)
            b, p = st
            gap = max(b[0] - p[2], p[0] - b[2], b[1] - p[3], p[1] - b[3])
            self.assertLessEqual(gap, 60, ("box left behind its pin", st, o))

    def test_a_decks_blank_pick_keeps_the_box_off_the_thumbnails(self):
        aid = store.publish(path=str(D.ROOT / "examples" / "slides"), title="Test slides", type="slides")["id"]
        for w in (1500, 400):
            o = self.drive(aid, 'document.querySelector(".sl-clip .sl-canvas")', """
              return await pickAt('(() => { const r = document.querySelector(".sl-clip .sl-canvas").getBoundingClientRect(); return [r.left + r.width * 0.97, r.top + r.height * 0.97] })()', '[...document.querySelectorAll("#sl-strip, .sl-pill")]')""", w, settle=2500)
            self.assertIn(o["title"], ("Slide 1", "Dia 1"), (w, o))
            self.clear(o, (w, "blank"))


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class GalleryThumbs(unittest.TestCase):
    """Live round V6: card pictures stayed dark boxes for minutes after a window resize or a list refresh, until a
    scroll. Hermes' SandboxedFrame loads every frame lazily (the browser decides when), and a card's frame is shown
    only once its load is heard: our frames load at once (when is ours to say: a card near the window), and a card
    whose load is not heard in THUMB_LOAD_MS shows its frame anyway."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files("\nexport { Gallery, refresh, $layout, STRINGS }\n"))
        for i in range(10):
            store.publish(title=f"Card {i}", type="doc", files={"doc.md": f"# Card {i}\n\nA few words."})

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    PROBE = ("(() => { const fs = [...document.querySelectorAll('iframe')].filter(f => { const r = f.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight });"
             " return { n: fs.length, shown: fs.filter(f => f.style.opacity === '1').length, eager: fs.filter(f => f.getAttribute('loading') === 'eager').length } })()")

    def gallery(self, body):
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"""
          await api.size(1500, 900); await api.go({json.dumps(url)}, 400)
          for (let i = 0; i < 50 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(100)
          const mount = () => api.top(`(async () => {{ const {{ M, R, jsx, ctx }} = window.H; M.$layout.set('grid'); document.getElementById('root').style.height = '100%'
            await M.refresh(ctx); R.mount(() => jsx(M.Gallery, {{ ctx, pageRef: {{ current: null }} }}), document.getElementById('root')) }})()`)
          const probe = () => api.top({json.dumps(self.PROBE)})
        """ + body, 240)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_a_cards_frame_loads_at_once_also_after_a_resize_and_a_refresh(self):
        out = self.gallery("""
          await mount(); await api.sleep(4000); const o = { first: await probe() }
          await api.size(1100, 900); await api.sleep(300)
          await api.top('(async () => { const { M, ctx } = window.H; await M.refresh(ctx) })()'); await api.sleep(4000)
          o.after = await probe(); return o""")
        for k, o in out.items():
            self.assertGreater(o["n"], 2, (k, out))
            self.assertEqual(o["eager"], o["n"], (k, out))  # none left to the browser's lazy loading
            self.assertEqual(o["shown"], o["n"], (k, out))

    def test_a_card_whose_load_is_never_heard_shows_its_frame_after_the_wait(self):
        out = self.gallery("""
          await api.top('window.__noLoad = true'); await mount(); await api.sleep(1500); const o = { soon: await probe() }
          await api.sleep(8500); o.later = await probe(); return o""")
        self.assertGreater(out["later"]["n"], 2, out)
        self.assertEqual(out["soon"]["shown"], 0, out)  # its load not heard: hidden for now
        self.assertGreaterEqual(out["later"]["shown"], 3, out)  # V6: dark for good; now the first slots' after THUMB_LOAD_MS


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class SlideBlankPickPinsThePoint(unittest.TestCase):
    """Live round V6 (3404f5e): a pick on a slide's blank pinned the whole slide, the pin right of the slide's edge
    (beside its first line) and the box at the window's edge. The pin is on the point clicked, inside the slide (at
    the same share of it while the comment is open), the box 8 px off the pin and the stage's edges."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))
        cls.aid = store.publish(path=str(D.ROOT / "examples" / "slides"), title="Test slides", type="slides")["id"]

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_the_pin_is_on_the_point_clicked_and_the_box_keeps_its_gaps(self):
        canvas = 'document.querySelector(".sl-clip .sl-canvas")'
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        for w in (1500, 400):
            # the tester's: the blank over the title, right of it; the blank corner at the bottom right; the top left
            for fx, fy in ((0.75, 0.25), (0.97, 0.97), (0.04, 0.06)):
                r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(self.aid)}, SEL = {json.dumps(canvas)}, SETTLE = 2500; await api.size({w}, 900);" + BOOT_ANY + f"""
                  const o = await pickAt('(() => {{ const r = {canvas}.getBoundingClientRect(); return [r.left + r.width * {fx}, r.top + r.height * {fy}] }})()', '[...document.querySelectorAll("#sl-strip, .sl-pill")]')
                  // the slide and the point as they are now (the band gone, the frame taller), and the stage
                  const s = await api.frame('(() => {{ const r = {canvas}.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }})()')
                  o.slide = [s[0] + o.off[0], s[1] + o.off[1], s[2] + o.off[0], s[3] + o.off[1]]
                  o.at = [o.slide[0] + (o.slide[2] - o.slide[0]) * {fx}, o.slide[1] + (o.slide[3] - o.slide[1]) * {fy}]
                  o.stage = await api.top('(() => {{ const b = document.querySelector("iframe").parentElement.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }})()')
                  return o""", timeout=240)
                self.assertIsNone(r.get("err"), r)
                o, what = r["out"], (w, fx, fy, r["out"])
                self.assertIn(o["title"], ("Slide 1", "Dia 1"), what)
                p, b, s, st = o["pin"], o["box"], o["slide"], o["stage"]
                self.assertTrue(p and b, what)
                # V6: the pin sat right of the slide's edge, level with its first line
                self.assertAlmostEqual((p["l"] + p["r"]) / 2, o["at"][0], delta=2, msg=what)
                self.assertAlmostEqual((p["t"] + p["b"]) / 2, o["at"][1], delta=2, msg=what)
                self.assertTrue(s[0] - 0.5 <= (p["l"] + p["r"]) / 2 <= s[2] + 0.5 and s[1] - 0.5 <= (p["t"] + p["b"]) / 2 <= s[3] + 0.5, what)
                # the box: 8 px off the pin, 8 px inside the stage
                gap = max(p["l"] - b["r"], b["l"] - p["r"], p["t"] - b["b"], b["t"] - p["b"])
                self.assertGreaterEqual(gap, 7.5, what)
                self.assertTrue(b["l"] >= st[0] + 7.5 and b["r"] <= st[2] - 7.5 and b["t"] >= st[1] + 7.5 and b["b"] <= st[3] - 7.5, what)

    def test_a_title_picked_has_its_pin_after_its_words_and_the_box_off_the_slides_other_words(self):
        # V6d: "Q4 sales pipeline" (a full-width block) picked: the pin at the block's right end, 560 px from the words,
        # and the box over the eyebrow line "QUARTERLY REVIEW". The pin right after the title's first line; the box
        # off every other line of the slide (the room above the eyebrow is there at these widths).
        h1 = 'document.querySelector(".sl-clip .sl-canvas h1")'
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        words = r"""(() => { const rg = document.createRange(), out = []; const w = document.createTreeWalker(document.querySelector('.sl-clip .sl-canvas'), NodeFilter.SHOW_TEXT)
          for (let n; (n = w.nextNode());) { if (!/\S/.test(n.nodeValue) || n.parentElement.closest('aside')) continue; rg.selectNodeContents(n); const q = rg.getBoundingClientRect(); out.push({ t: n.nodeValue.trim(), l: q.left, t0: q.top, r: q.right, b: q.bottom, own: n.parentElement.tagName === 'H1' }) }
          const t = [...document.querySelector('.sl-clip .sl-canvas h1').childNodes].find(n => n.nodeType === 3); rg.selectNodeContents(t); const first = rg.getClientRects()[0]
          return { words: out, end: first.right, mid: (first.top + first.bottom) / 2 } })()"""
        for w in (1500, 1000):
            r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(self.aid)}, SEL = {json.dumps(h1)}, SETTLE = 2500; await api.size({w}, 900);" + BOOT_ANY + f"""
              const o = await pickAt('(() => {{ const r = {h1}.getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2] }})()', '[]')
              o.w = await api.frame({json.dumps(words)}); return o""", timeout=240)
            self.assertIsNone(r.get("err"), r)
            o = r["out"]
            off, p, b = o["off"], o["pin"], o["box"]
            what = (w, o)
            self.assertTrue(p and b, what)
            end, mid = o["w"]["end"] + off[0], o["w"]["mid"] + off[1]
            self.assertTrue(0 <= p["l"] - end <= 8, ("pin away from the title's words", what))  # PIN_GAP after them
            self.assertLessEqual(abs((p["t"] + p["b"]) / 2 - mid), 2, what)
            for q in o["w"]["words"]:
                if q["own"]:
                    continue
                l, t, rr, bb = q["l"] + off[0], q["t0"] + off[1], q["r"] + off[0], q["b"] + off[1]
                self.assertFalse(b["l"] < rr and l < b["r"] and b["t"] < bb and t < b["b"], ("box over", q["t"], what))


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class ModelViewPickPinsThePoint(unittest.TestCase):
    """Live round V6d: a 3D view picked where no part is ("3D view") had its pin in the view's top right corner, on
    the page's own Panel pill. The pin is on the point clicked, and never on the page's pills."""

    def test_the_views_pin_is_on_the_point_clicked_off_the_pills(self):
        from test_models import PANEL
        host = B.Host()
        try:
            host.files.update(D.viewer_files(EXPORTS))
            aid = store.publish(title="Panel", type="model", files={"model.json": PANEL})["id"]
            url = f"http://127.0.0.1:{host.port}/dom/index.html"
            # a point of the view with no part under it, nearest the top right (the tester's), no pill over it
            spot = ("(() => { const c = document.querySelector('.md-canvas'), r = c.getBoundingClientRect();"
                    " for (let j = 2; j < 20; j++) for (let i = 18; i > 1; i--) { const x = r.left + r.width * i / 20, y = r.top + r.height * j / 20;"
                    " if (document.elementFromPoint(x, y) === c && !__model.pick(x, y)) return [x, y] } return null })()")
            pills = '[...document.querySelectorAll("[data-comment-keep]")]'
            for w in (1500, 400):
                r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = 'document.querySelector(\".md-canvas\")', SETTLE = 3000; await api.size({w}, 900);" + BOOT_ANY + f"""
                  const at = await api.frame({json.dumps(spot)}); if (!at) return null
                  const o = await pickAt({json.dumps(spot)}, {json.dumps(pills)})
                  o.at = [at[0] + o.off[0], at[1] + o.off[1]]; return o""", timeout=240)
                self.assertIsNone(r.get("err"), r)
                o, what = r["out"], (w, r["out"])
                self.assertTrue(o and o["pin"], what)
                p = o["pin"]
                self.assertLessEqual(abs((p["l"] + p["r"]) / 2 - o["at"][0]), 2, what)
                self.assertLessEqual(abs((p["t"] + p["b"]) / 2 - o["at"][1]), 2, what)
                self.assertTrue(o["kept"], what)
                for k in o["kept"]:
                    self.assertFalse(p["l"] < k["r"] and k["l"] < p["r"] and p["t"] < k["b"] and k["t"] < p["b"], (k, what))
        finally:
            host.close()


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class PickKeepsTheFrame(unittest.TestCase):
    """Live round V6c (3404f5e): picking put a band under the header that took 33 px from the frame, and gave them
    back as the new comment opened. Live, a film's page stayed laid out for the smaller frame (innerHeight 706 in a
    738 px frame, the picture 1062 -> 1004 px, an empty strip under it) and its pin was 33 px off the point clicked
    until the comment was discarded. The header says it is picking in the title's place: the frame keeps its size
    from before picking to the open comment, in every type, and the pin stays on what was picked."""

    @classmethod
    def setUpClass(cls):
        from test_models import PANEL
        from test_type_pages_browser import PICK_DASH, PICK_PAGE
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))
        ex = D.ROOT / "examples"
        cls.types = [
            # (artifact, frame JS: the part clicked, where on it, a point (the pin on it) or a part (the pin beside it))
            (store.publish(path=str(ex / "motion"), title="Harbor film", type="motion")["id"], 'document.getElementById("mo-frame")', (0.4, 0.85), True),
            (store.publish(path=str(ex / "doc"), title="Quote process", type="doc")["id"], 'document.querySelectorAll(".doc-blk")[1]', (0.1, 0.5), False),
            (store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [{"name": "Budget", "rows": [["Item", "Cost"], ["Panels", 182]]}]}})["id"],
             '[...document.querySelectorAll("#sh-grid .sh-c")].find(x => x.textContent.trim() === "Panels")', (0.5, 0.5), False),
            (store.publish(title="Flow", type="board", files={"board.json": {"title": "Flow", "items": [{"id": "a", "type": "box", "text": "Survey"}, {"id": "n", "type": "note", "text": "", "near": "a"}]}})["id"],
             'document.querySelector(".bd-it[data-id=n]")', (0.5, 0.5), False),
            (store.publish(title="Orders", type="dashboard", files={"dashboard.json": PICK_DASH})["id"], 'document.querySelector(".c-kpi")', (0.9, 0.15), False),
            (store.publish(path=str(ex / "slides"), title="Deck", type="slides")["id"], 'document.querySelector(".sl-clip .sl-canvas h1")', (0.2, 0.5), False),
            (store.publish(path=str(ex / "design"), title="Test design", type="design")["id"], '__design.boards["Main.dc.html"].el.querySelector("iframe")', (0.25, 0.35), False),
            (store.publish(path=str(ex / "design-system"), title="Kiln", type="design-system")["id"], 'document.querySelector(".ds-cover")', (0.5, 0.5), False),
            (store.publish(title="Panel", type="model", files={"model.json": PANEL})["id"], 'document.querySelector(".md-canvas")', (0.5, 0.5), False),
            (store.publish(title="Plain", type="page", html=PICK_PAGE)["id"], 'document.getElementById("p")', (0.1, 0.5), False),
        ]

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_the_frame_keeps_its_size_from_picking_to_the_open_comment_and_the_pin_stays_on_its_part(self):
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        size = '(() => { const r = document.querySelector("iframe").getBoundingClientRect(); return [r.left, r.top, r.width, r.height] })()'
        for aid, el, (fx, fy), point in self.types:
            for w in (1500, 400):
                part = f'(() => {{ const r = ({el}).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }})()'
                r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = {json.dumps(el)}, SETTLE = 2500; await api.size({w}, 900);" + BOOT_ANY + f"""
                  const o = {{ before: [await api.top({json.dumps(size)}), await api.frame('innerHeight')] }}
                  await api.top('window.H.M.$picking.set(true)'); await api.sleep(400)
                  o.picking = [await api.top({json.dumps(size)}), await api.frame('innerHeight')]
                  const q = await api.frame({json.dumps(f'(() => {{ const r = ({el}).getBoundingClientRect(); return [r.left + r.width * {fx}, r.top + r.height * {fy}] }})()')})
                  let off = await frameAt(); await api.mouse(off[0] + q[0], off[1] + q[1]); await api.sleep(1200)
                  o.open = [await api.top({json.dumps(size)}), await api.frame('innerHeight')]
                  off = await frameAt()
                  const p = await api.frame({json.dumps(part)}); o.part = [p[0] + off[0], p[1] + off[1], p[2] + off[0], p[3] + off[1]]
                  o.at = [o.part[0] + (o.part[2] - o.part[0]) * {fx}, o.part[1] + (o.part[3] - o.part[1]) * {fy}]
                  o.pin = await api.top('(() => {{ const d = [...document.querySelectorAll("div")].find(d => d.style.zIndex === "28" && d.style.borderRadius === "50%"); if (!d) return null; const b = d.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }})()')
                  return o""", timeout=240)
                self.assertIsNone(r.get("err"), r)
                o, what = r["out"], (aid, el, w, r["out"])
                self.assertEqual(o["picking"], o["before"], what)  # picking takes nothing from the frame
                self.assertEqual(o["open"], o["before"], what)  # nor does the comment opening
                pin = o["pin"]
                self.assertTrue(pin, what)
                cx, cy = (pin[0] + pin[2]) / 2, (pin[1] + pin[3]) / 2
                if point:  # on the point clicked
                    self.assertLessEqual(abs(cx - o["at"][0]), 4, what)
                    self.assertLessEqual(abs(cy - o["at"][1]), 4, what)
                else:  # beside the part (pinSpot: PIN_GAP 6 off it) or on it
                    pt = o["part"]
                    self.assertTrue(pin[2] >= pt[0] - 7 and pin[0] <= pt[2] + 7 and pin[3] >= pt[1] - 7 and pin[1] <= pt[3] + 7, what)



# The tester's plain page (V6e): a heading, a line under it, a field and its button across the page.
BRIDGE_PAGE = ("<!doctype html><meta charset=utf-8><style>body{margin:0;font:16px system-ui;background:#1d1d1b;color:#eee}main{padding:24px}"
               "h1{font-size:32px;margin:40px 0 16px}.row{display:flex;gap:8px;margin-top:40px}.row input{flex:1;height:34px}</style>"
               "<main><h1 id=h>Bridge demo v2</h1><p>This page checks the bridge: state, notify, reloads)</p>"
               "<div class=row><input id=msg><button>Send</button></div></main>")
# Every line of words and every picture or control in the frame, in the window (frame JS, off: the frame's corner).
CONTENT = r"""(() => { const out = [], rg = document.createRange(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n; (n = w.nextNode());) { if (!/\S/.test(n.nodeValue) || n.parentElement.closest('[data-hermes-ui], script, style')) continue; rg.selectNodeContents(n)
    for (const q of rg.getClientRects()) if (q.width && q.height && q.bottom > 0 && q.top < innerHeight) out.push({ t: n.nodeValue.trim().slice(0, 20), l: q.left, t0: q.top, r: q.right, b: q.bottom }) }
  for (const e of document.querySelectorAll('input, button, select, svg, canvas, img, iframe')) { const q = e.getBoundingClientRect(); if (q.width && q.height && q.bottom > 0 && q.top < innerHeight) out.push({ t: e.tagName, l: q.left, t0: q.top, r: q.right, b: q.bottom }) }
  return out })()"""


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6eComments(unittest.TestCase):
    """Live round V6e (2fb9e93): a sheet's B3 picked had its pin over C3; the new comment's box lay on the paragraph
    under a plain page's heading with room free to its right, and on the next KPI and a chart's title of a
    dashboard."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def pick(self, aid, sel, where, w, then="return o", h=714, settle=2500):
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = {json.dumps(sel)}, SETTLE = {settle}; await api.size({w}, {h});"
                    + BOOT_ANY + f"const o = await pickAt({json.dumps(where)}, '[]')\n"
                    f"o.content = (await api.frame({json.dumps(CONTENT)})).map(c => ({{ ...c, l: c.l + o.off[0], r: c.r + o.off[0], t0: c.t0 + o.off[1], b: c.b + o.off[1] }}))\n" + then, timeout=240)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    @staticmethod
    def meet(a, c):
        return a["l"] < c["r"] - 0.5 and c["l"] < a["r"] - 0.5 and a["t"] < c["b"] - 0.5 and c["t0"] < a["b"] - 0.5

    def test_a_sheet_cells_pin_is_in_the_cell_never_on_a_neighbour(self):
        rows = [["Item", "Unit price", "Qty", "Total"], ["Wall panels", 2000, 3, 6000], ["Rails", 300, 10, 3000], ["Total"]]
        aid = store.publish(title="Costs", type="sheet", files={"sheet.json": {"title": "Costs", "sheets": [{"name": "Costs", "rows": rows}]}})["id"]
        cell = '[...document.querySelectorAll("#sh-grid .sh-c")].find(c => c.textContent.trim() === "{}")'
        for w in (1249, 600):
            for v in ("300", "Rails", "10"):
                c = cell.format(v)
                o = self.pick(aid, c, f'(() => {{ const r = ({c}).getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + r.height / 2] }})()', w,
                              f"const b = await api.frame('(() => {{ const r = ({c}).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }})()'); o.cell = [b[0] + o.off[0], b[1] + o.off[1], b[2] + o.off[0], b[3] + o.off[1]]; return o")
                what = (w, v, o["pin"], o["cell"])
                self.assertTrue(o["pin"], what)
                p, cl = o["pin"], o["cell"]
                # V6e: B3's pin 6 px right of the cell, over C3. In its cell, across its borders at most (a pin is
                # taller than a row), on no words
                self.assertTrue(cl[0] <= p["l"] and p["r"] <= cl[2], ("pin outside its cell", what))
                for c2 in o["content"]:
                    self.assertFalse(self.meet(p, c2), ("pin on words", c2, what))

    def test_a_sheet_cells_pin_lies_wholly_inside_its_cell(self):
        # V6f: a 26 px pin in a 24 px row stuck 2 px into the cell above, on its gridline. The pin is never taller than
        # its cell: inside it on every side (gridlines too), for a text, a number set right, an empty, a long text's
        # and the last column's cell.
        rows = [["Item", "Unit price", "Qty", "Total"], ["Wall panels", 2000, 3, 6000], ["Rails", 300, 10, 3000], ["Total"],
                ["A rather long description that runs on over the next cells"]]
        aid = store.publish(title="Costs", type="sheet", files={"sheet.json": {"title": "Costs", "sheets": [{"name": "Costs", "rows": rows}]}})["id"]
        find = '[...document.querySelectorAll("#sh-grid .sh-c")].find(c => c.textContent.trim() === {})'
        empty = '(() => { const r = [...document.querySelectorAll("#sh-grid .sh-c")].filter(c => c.textContent.trim() === "Total").pop().getBoundingClientRect(); return document.elementFromPoint(r.right + 20, r.top + r.height / 2) })()'
        cells = (("Rails", find.format('"Rails"')), ("300", find.format('"300"')), ("empty", empty),
                 ("long", '[...document.querySelectorAll("#sh-grid .sh-c")].find(c => c.textContent.startsWith("A rather"))'), ("last", find.format('"6,000"') + ' || ' + find.format('"6000"')))
        for w in (1249, 600):
            for name, c in cells:
                o = self.pick(aid, c, f'(() => {{ const r = ({c}).getBoundingClientRect(); return [r.left + Math.min(r.width * 0.5, 60), r.top + r.height / 2] }})()', w,
                              f"const b = await api.frame('(() => {{ const r = ({c}).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }})()'); o.cell = [b[0] + o.off[0], b[1] + o.off[1], b[2] + o.off[0], b[3] + o.off[1]]; return o")
                p, cl, what = o["pin"], o["cell"], (w, name, o["pin"], o["cell"])
                self.assertTrue(p, what)
                self.assertTrue(cl[0] < p["l"] and p["r"] < cl[2] and cl[1] < p["t"] and p["b"] < cl[3] - 0.5, ("pin not wholly in its cell", what))
                self.assertGreaterEqual(p["b"] - p["t"], 16, what)  # still a pin one reads

    def test_the_box_takes_empty_room_before_the_words_around_its_element(self):
        from test_type_pages_browser import DASH2, DASH2_CSV
        page = store.publish(title="Test page", type="page", html=BRIDGE_PAGE)["id"]
        dash = store.publish(title="Test dash2", type="dashboard", files={"dashboard.json": DASH2, "data/monthly.csv": DASH2_CSV})["id"]
        cases = ((page, 'document.getElementById("h")', 0.3, None),
                 (dash, '[...document.querySelectorAll(".c-kpi")][1]', 0.2, "Value, M USD"))
        for aid, el, fx, own in cases:
            for w in (1249, 900):
                o = self.pick(aid, el, f'(() => {{ const r = ({el}).getBoundingClientRect(); return [r.left + r.width * {fx}, r.top + r.height * 0.5] }})()', w,
                              f"const b = await api.frame('(() => {{ const r = ({el}).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }})()'); o.el = [b[0] + o.off[0], b[1] + o.off[1], b[2] + o.off[0], b[3] + o.off[1]]; return o")
                what = (aid, w, o["box"], o["el"])
                self.assertTrue(o["box"] and o["pin"], what)
                under = [c for c in o["content"] if self.meet(o["box"], c) and not (o["el"][0] <= c["l"] and c["r"] <= o["el"][2] and o["el"][1] <= c["t0"] and c["b"] <= o["el"][3])]
                self.assertEqual(under, [], ("the box on the page's content", what))


    def test_the_box_never_lies_on_the_part_picked_nor_its_pin(self):
        # V6f: Test dash2's KPI "Value, M USD" picked: at 1506 px the box lay 44 x 6 px on it, at 1000 over its top
        # 22 px (its label half hidden), room free elsewhere. The box never meets the part picked nor its pin; empty
        # room is only a preference after that.
        from test_type_pages_browser import DASH2, DASH2_CSV
        dash = store.publish(title="Test dash2", type="dashboard", files={"dashboard.json": DASH2, "data/monthly.csv": DASH2_CSV})["id"]
        page = store.publish(title="Test page", type="page", html=BRIDGE_PAGE)["id"]
        kpi = '[...document.querySelectorAll(".c-kpi")].find(k => k.textContent.includes("Value, M USD"))'
        cases = [(dash, kpi, fx, fy) for fx, fy in ((0.2, 0.15), (0.5, 0.5), (0.9, 0.85))] + [(page, 'document.getElementById("h")', 0.3, 0.5), (page, 'document.getElementById("msg")', 0.5, 0.5)]
        for aid, el, fx, fy in cases:
            for w, h in ((1246, 750), (906, 750), (740, 700), (600, 700)):
                o = self.pick(aid, el, f'(() => {{ const r = ({el}).getBoundingClientRect(); return [r.left + r.width * {fx}, r.top + r.height * {fy}] }})()', w,
                              f"const b = await api.frame('(() => {{ const r = ({el}).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }})()'); o.el = [b[0] + o.off[0], b[1] + o.off[1], b[2] + o.off[0], b[3] + o.off[1]]; return o", h=h)
                what = (el[:40], fx, fy, w, o["box"], o["pin"], o["el"])
                self.assertTrue(o["box"] and o["pin"], what)
                b, p, e = o["box"], o["pin"], o["el"]
                self.assertFalse(b["l"] < e[2] and e[0] < b["r"] and b["t"] < e[3] and e[1] < b["b"], ("the box on the part picked", what))
                self.assertFalse(b["l"] < p["r"] and p["l"] < b["r"] and b["t"] < p["b"] and p["t"] < b["b"], ("the box on its pin", what))

    def test_a_pick_right_after_comment_in_a_page_just_opened_is_never_lost(self):
        # V6e: the header's Comment and a click 0 ms after it in a page just opened: slides 4/13, doc 2/4, sheet 4/4
        # made no draft; a design none until its artboards had loaded (~1.5 s). The click is held until the page
        # says its click picks, then picked there.
        ex = D.ROOT / "examples"
        cases = (
            (store.publish(path=str(ex / "doc"), title="Doc", type="doc")["id"], 'document.querySelectorAll(".doc-blk")[1]', (0.1, 0.5), r"^#"),
            (store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [{"name": "Budget", "rows": [["Item", "Cost"], ["Panels", 182]]}]}})["id"],
             '[...document.querySelectorAll("#sh-grid .sh-c")].find(x => x.textContent.trim() === "Panels")', (0.5, 0.5), r"."),
            (store.publish(path=str(ex / "slides"), title="Deck", type="slides")["id"], 'document.querySelector(".sl-clip .sl-canvas h1")', (0.2, 0.5), r"."),
            (store.publish(path=str(ex / "design"), title="Lumen", type="design")["id"], '__design.boards["Main.dc.html"].el.querySelector("iframe")', (0.3, 0.15), r"^Main\.dc\.html#\d+:"),
        )
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        for aid, el, (fx, fy), sel in cases:
            for attempt in range(2):
                r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}; await api.size(1300, 800);" + """
                  await api.go(URL, 400)
                  for (let i = 0; i < 50 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(100)
                  await api.top(`(async () => { const { M, R, jsx, ctx } = window.H; M.$list.set((await ctx.rest('/artifacts')).artifacts)
                    M.openArtifact(ctx, ${JSON.stringify(AID)}); R.mount(() => jsx(M.Viewer, { ctx }), document.getElementById('root')) })()`)
                  let q = null
                  for (let i = 0; i < 200 && !q; i++) { try { q = await api.frame(""" + json.dumps(f'(() => {{ const e = {el}; if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [r.left + r.width * {fx}, r.top + r.height * {fy}] : null }})()') + """) } catch (_) {} if (!q) await api.sleep(25) }
                  const f = await api.top('(() => { const r = document.querySelector("iframe").getBoundingClientRect(); return [r.left, r.top] })()')
                  const b = await api.top('(() => { const b = [...document.querySelectorAll("button")].find(b => b.title === "Comment" || b.getAttribute("aria-label") === "Comment"); const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2] })()')
                  await api.mouse(b[0], b[1]); await api.mouse(f[0] + q[0], f[1] + q[1])
                  for (let i = 0; i < 40 && !(await api.top('Boolean(window.H.M.$draft.get())')); i++) await api.sleep(100)
                  return { draft: await api.top('window.H.M.$draft.get()'), picking: await api.top('window.H.M.$picking.get()') }""", timeout=240)
                self.assertIsNone(r.get("err"), r)
                o, what = r["out"], (aid, attempt, r["out"])
                self.assertTrue(o["draft"] and o["draft"]["anchor"], ("the pick was lost", what))
                self.assertRegex(o["draft"]["anchor"]["selector"], sel, what)
                self.assertFalse(o["picking"], what)


    def test_a_pick_made_while_the_page_still_loads_is_never_lost(self):
        # V6f (a3c8b07): the page said its click picks as soon as picking came (its port), before it had drawn: the
        # click held for it came back as pick-at on a page with nothing under it yet (a sheet's grid not laid out, a
        # plain page not parsed), or a click made then hit nothing; header armed, no draft. Sheet 14/22 lost on an
        # empty cell, slides 1/6, page 1/3, board 2/8. Here: open, Comment as soon as the button exists, a click on a
        # part 0 or 100 ms later, 20 times per type: never lost.
        from test_type_pages_browser import PICK_DASH, PICK_PAGE, at
        ex = D.ROOT / "examples"
        cases = (
            ("sheet", store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [{"name": "Budget", "rows": [["Item", "Cost"], ["Panels", 182]]}]}})["id"],
             # an empty cell: two rows under "Panels"
             '(() => { const e = [...document.querySelectorAll("#sh-grid .sh-c")].find(x => x.textContent.trim() === "Panels"); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [r.left + r.width / 2, r.top + r.height * 2.5] : null })()'),
            ("slides", store.publish(path=str(ex / "slides"), title="Deck", type="slides")["id"], at('document.querySelector(".sl-clip .sl-canvas h1")', 0.2)),
            ("page", store.publish(title="Plain", type="page", html=PICK_PAGE)["id"], at('document.getElementById("p")', 0.1)),
            ("board", store.publish(title="Flow", type="board", files={"board.json": {"title": "Flow", "items": [{"id": "a", "type": "box", "text": "Survey"}, {"id": "n", "type": "note", "text": "Call", "near": "a"}]}})["id"],
             at('document.querySelector(".bd-it[data-id=a]")')),
            ("doc", store.publish(path=str(ex / "doc"), title="Doc", type="doc")["id"], at('document.querySelectorAll(".doc-blk")[1]', 0.1)),
            ("dashboard", store.publish(title="Orders", type="dashboard", files={"dashboard.json": PICK_DASH})["id"], at('document.querySelector(".c-kpi")', 0.3)),
            ("design", store.publish(path=str(ex / "design"), title="Lumen", type="design")["id"], at('__design.boards["Main.dc.html"].el.querySelector("iframe")', 0.3, 0.15)),
        )
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        lost = []
        for kind, aid, where in cases:
            r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, WHERE = {json.dumps(where)}; await api.size(1300, 800);" + """
              await api.go(URL, 400)
              for (let i = 0; i < 50 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(100)
              const open = () => api.top(`(() => { const { M, ctx } = window.H; M.openArtifact(ctx, ${JSON.stringify(AID)}) })()`)
              await api.top(`(async () => { const { M, R, jsx, ctx } = window.H; M.$list.set((await ctx.rest('/artifacts')).artifacts)
                M.openArtifact(ctx, ${JSON.stringify(AID)}); R.mount(() => jsx(M.Viewer, { ctx }), document.getElementById('root')) })()`)
              let q = null
              for (let i = 0; i < 200 && !q; i++) { try { q = await api.frame(WHERE) } catch (_) {} if (!q) await api.sleep(50) }
              await api.sleep(600); q = await api.frame(WHERE)
              const f = await api.top('(() => { const r = document.querySelector("iframe").getBoundingClientRect(); return [r.left, r.top] })()')
              const button = '(() => { const b = [...document.querySelectorAll("button")].find(b => b.title === "Comment" || b.getAttribute("aria-label") === "Comment"); if (!b) return null; const q = b.getBoundingClientRect(); return q.width ? [q.left + q.width / 2, q.top + q.height / 2] : null })()'
              const out = []
              for (let n = 0; n < 20; n++) {
                await api.top('window.H.M.closeArtifact()')
                for (let i = 0; i < 100 && (await api.top('document.querySelectorAll("iframe").length')); i++) await api.sleep(20)
                await open()
                let b = null
                for (let i = 0; i < 400 && !b; i++) { b = await api.top(button); if (!b) await api.sleep(5) }
                const fresh = await api.top('document.querySelectorAll("iframe").length === 0 || !document.querySelector("iframe").contentDocument || document.querySelector("iframe").contentDocument.readyState !== "complete"')
                await api.mouse(b[0], b[1])
                if (n % 2) await api.sleep(100)
                await api.mouse(f[0] + q[0], f[1] + q[1])
                let d = null
                for (let i = 0; i < 70 && !d; i++) { d = await api.top('window.H.M.$draft.get()'); if (!d) await api.sleep(100) }
                out.push({ n, fresh, draft: Boolean(d && d.anchor), picking: await api.top('window.H.M.$picking.get()') })
                await api.top('(() => { window.H.M.$draft.set(null); window.H.M.$picking.set(false) })()')
              }
              return out""", timeout=600)
            self.assertIsNone(r.get("err"), (kind, r))
            lost += [(kind, o) for o in r["out"] if not o["draft"] or o["picking"]]
        self.assertFalse(lost, ("picks lost", lost))

    def test_the_comment_button_keeps_no_ring_after_esc_or_cancel_ends_picking(self):
        # V6e: Comment clicked, Esc: the button showed its focus ring (a key pressed makes Chromium's :focus-visible
        # match the button the click focused). Hermes' buttons ring only for the keyboard's focus.
        aid = store.publish(path=str(D.ROOT / "examples" / "doc"), title="Doc", type="doc")["id"]
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        ring = ('(() => { const b = [...document.querySelectorAll("button")].find(b => b.title === "Comment" || b.getAttribute("aria-label") === "Comment")'
                '; return [document.activeElement === b, b.matches(":focus-visible"), window.H.M.$picking.get()] })()')
        at = ('(() => { const b = [...document.querySelectorAll("button")].find(b => b.title === "@" || b.getAttribute("aria-label") === "@" || b.textContent.trim() === "@")'
              '; const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2] })()')
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = 'document.querySelector(\".doc-blk\")', SETTLE = 1500; await api.size(1300, 800);" + BOOT_ANY + f"""
          const o = {{}}, ring = () => api.top({json.dumps(ring)})
          let b = await api.top({json.dumps(at.replace("@", "Comment"))}); await api.mouse(b[0], b[1]); await api.sleep(300); o.armed = await ring()
          await api.key('Escape', 'Escape', 27); await api.sleep(300); o.esc = await ring()
          await api.mouse(b[0], b[1]); await api.sleep(300)
          const c = await api.top({json.dumps(at.replace("@", "Cancel"))}); await api.mouse(c[0], c[1]); await api.sleep(300)
          await api.key('Shift', 'ShiftLeft', 16); await api.sleep(200); o.cancel = await ring()
          return o""", timeout=240)
        self.assertIsNone(r.get("err"), r)
        o = r["out"]
        self.assertEqual(o["armed"][2], True, o)
        self.assertEqual(o["esc"][1:], [False, False], o)  # picking over, no ring
        self.assertEqual(o["cancel"][1:], [False, False], o)


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6fViewer(unittest.TestCase):
    """Live round V6f (a3c8b07): the header's Comment button and the title's menu."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def drive(self, aid, body, w=1300):
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = 'document.querySelector(\".doc-blk\")', SETTLE = 1500; await api.size({w}, 800);" + BOOT_ANY + body, timeout=240)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    COMMENT = ('(() => { const b = [...document.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === "Comment"), q = b.getBoundingClientRect(), i = b.querySelector("svg").getBoundingClientRect()'
               '; return { w: q.width, mid: q.left + q.width / 2, icon: i.left + i.width / 2, text: b.textContent } })()')

    def test_the_comment_button_with_no_comments_is_its_icon_centred(self):
        # V6f: 48 px wide with no comments, its icon at the left and empty room right of it (room kept for a count).
        aid = store.publish(path=str(D.ROOT / "examples" / "doc"), title="Doc", type="doc")["id"]
        o = self.drive(aid, f"return await api.top({json.dumps(self.COMMENT)})")
        self.assertEqual(o["text"], "", o)
        self.assertAlmostEqual(o["icon"], o["mid"], delta=0.75, msg=o)
        self.assertLessEqual(o["w"], 32, o)
        b = docs.read(aid)["blocks"][1]
        api.handle("POST", f"artifacts/{aid}/comments", {}, {"text": "note", "anchor": {"selector": f"#blk-{b['id']}", "text": "x", "label": "text"}})
        o = self.drive(aid, f"return await api.top({json.dumps(self.COMMENT)})")
        self.assertEqual(o["text"], "1", o)  # the count, in its room

    def test_a_press_in_the_page_closes_the_title_menu(self):
        # V6f: the artifact's title menu open in the header, a press in the page left it open (the page is a document
        # of its own: its presses never reach the host's). The bridge says so; the menu closes as on any press outside.
        aid = store.publish(path=str(D.ROOT / "examples" / "doc"), title="Doc", type="doc")["id"]
        title = '[...document.querySelectorAll("button[aria-expanded]")][0]'
        o = self.drive(aid, f"""
          const t = await api.top('(() => {{ const b = {title}.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] }})()')
          await api.mouse(t[0], t[1]); await api.sleep(400)
          const o = {{ open: await api.top('{title}.getAttribute("aria-expanded")') }}
          const off = await frameAt(), q = await api.frame('(() => {{ const r = document.querySelectorAll(".doc-blk")[2].getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2] }})()')
          await api.mouse(off[0] + q[0], off[1] + q[1]); await api.sleep(400)
          o.after = await api.top('{title}.getAttribute("aria-expanded")')
          return o""")
        self.assertEqual(o, {"open": "true", "after": "false"})


if __name__ == "__main__":
    unittest.main()
