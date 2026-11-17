"""The whole viewer as Hermes Desktop runs it (plugin.js's Viewer, its frames and bridge, the real doc page in an
iframe, the plugin's REST routes on a temporary store: _dom.viewer_files on _browser.Host), headless Chrome.

Round V1 of the 0.20.0 live check: a doc opened on the full page drew none of its open threads' marks (the
bridge listened to "pins" itself from the start, so the threads sent before the doc's script ran never reached
it); under 700 px "All comments" did nothing while an element was being picked (the list counted as shown while
it stepped aside, so the item closed it), and the Comment button only started picking, which shows nothing there.
Skipped without Chrome or node."""

import json
import sys
import unittest

import _browser as B
import _dom as D
from hermes_artifacts import api, docs, store

EXPORTS = "\nexport { Viewer, openArtifact, closeArtifact, Ago, clock, sawEdit, shownUpdated, $list, $panel, $panelHere, $picking, $pickHeld, $panelShown, $draft, STRINGS }\n"
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

    def test_narrow_the_lists_comment_picks_with_the_page_in_sight_and_drafts_in_the_list(self):
        # V6h N11 (586 px and 414 px windows): Comment opens the whole-stage list; its own Comment arms picking, the
        # list steps aside so the page is seen and clicked; the draft opens in the list, the part named; Discard: the
        # list again, nothing left over the page.
        for w in (414, 586):
            out = self.drive("""
              const o = {}
              await btn('Comment'); o.list = await list()
              const here = await api.top('(() => { const a = document.querySelector("aside"); const b = a && [...a.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === "Comment" || b.title === "Comment" || b.textContent.trim() === "Comment"); if (!b) return null; const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2] })()')
              if (!here) return { o, none: true }
              await api.mouse(here[0], here[1]); await api.sleep(400)
              o.picking = await list()
              const f = await api.top('(() => { const r = document.querySelector("iframe").getBoundingClientRect(); return [r.left, r.top, r.width] })()')
              const q = await api.frame('(() => { const r = document.querySelectorAll(".doc-blk")[2].getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2] })()')
              o.under = await api.top(`(() => { const e = document.elementFromPoint(${f[0] + q[0]}, ${f[1] + q[1]}); return e && (e.tagName === "IFRAME" || e.hasAttribute("data-pick-hold")) ? "page" : e && e.tagName })()`)
              await api.mouse(f[0] + q[0], f[1] + q[1]); await api.sleep(900)
              o.draft = await api.top('(() => { const a = document.querySelector("aside"), ta = a && a.querySelector("textarea"); if (!ta || getComputedStyle(a).display === "none") return null; const r = a.getBoundingClientRect(); const d = window.H.M.$draft.get(); return { words: !!(d && d.anchor && d.anchor.label) && a.innerText.indexOf(d.anchor.label) >= 0 && a.innerText.indexOf(d.anchor.label) < a.innerText.indexOf("Send to Hermes"), w: Math.round(r.width), over: [...document.querySelectorAll("textarea")].length } })()')
              await btn('Discard')
              o.after = await list(); o.left = await api.top('Boolean(window.H.M.$draft.get())')
              return o""", w)
            self.assertNotIn("none", out, (w, out))
            self.assertEqual((out["list"]["display"], out["list"]["w"]), ("flex", w), (w, out))
            self.assertEqual((out["picking"]["display"], out["picking"]["picking"]), ("none", True), (w, out))  # out of the way
            self.assertEqual(out["under"], "page", (w, out))  # the page (or the cover holding its click) is what a click there reaches
            self.assertTrue(out["draft"] and out["draft"]["words"], (w, out))
            self.assertEqual((out["draft"]["w"], out["draft"]["over"]), (w, 1), (w, out))  # in the list only, no box over the page
            self.assertEqual((out["after"]["display"], out["left"]), ("flex", False), (w, out))

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
        # holds an open thread's mark, Discard: that mark was gone until the doc was opened again. Now that click
        # only closes the empty draft (the box a popover): the mark stays, the paragraph is not entered
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
          o.closed = !(await api.top('!!document.querySelector("textarea")')); await api.sleep(800)
          o.after = await marks()
          return o""")
        self.assertEqual(out["before"], ["thread"], out)
        self.assertTrue(out["draft"], out)
        self.assertEqual((out["inBlock"], out["closed"]), (False, True), out)
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
          // the pointer moved off the button (a press there would pick the doc's nearest block)
          await btn('Comment'); await api.pointer('mouseMoved', 5, 400); await api.sleep(300); o.armed = await st()
          await api.key('Escape', 'Escape', 27); await api.sleep(300); await api.pointer('mouseMoved', 5, 400); await api.sleep(300); o.after = await st()
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
class CommentPinsOnCanvases(unittest.TestCase):
    """Live round V6: a film's point had no pin on its picture (a point has no size, so the bridge said it was out of
    sight and the box waited in the corner); a design's pin lay off the strip of the artboard commented on. The pin
    on the point or the strip, the box a popover by it (8-24 px), at 1500 and at 400 px."""

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

    def by_pin(self, o, what):
        self.assertTrue(o["box"] and o["pin"], (what, o))
        b, p = o["box"], o["pin"]
        gap = max(p["l"] - b["r"], b["l"] - p["r"], p["t"] - b["b"], b["t"] - p["b"])
        self.assertTrue(7.5 <= gap <= 25, ("the box not by its pin", gap, what, o))

    def test_a_films_point_has_its_pin_and_the_box_by_it(self):
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
                self.by_pin(o, what)

    def test_a_designs_pin_after_a_pan_and_on_the_strip_commented_on(self):
        aid = store.publish(path=str(D.ROOT / "examples" / "design"), title="Test design", type="design")["id"]
        chrome = '[...document.querySelectorAll(".dc-pill, .dc-strip")]'
        board = '__design.boards["Main.dc.html"].el'
        for w in (1500, 400):
            # panned (the wheel) until a point high in the landing page sits 250 px over the canvas's foot, then picked
            o = self.drive(aid, board, f"""
              const spot = () => api.frame('(() => {{ const r = {board}.querySelector("iframe").getBoundingClientRect(), v = document.getElementById("dc-view").getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + Math.min(r.height * 0.2, 120), v.left + v.width * 0.45, v.bottom - 250] }})()')
              for (let i = 0; i < 4; i++) {{ const s = await spot(); await api.frame(`document.getElementById("dc-view").dispatchEvent(new WheelEvent("wheel", {{ deltaX: ${{s[0] - s[2]}}, deltaY: ${{s[1] - s[3]}}, clientX: 200, clientY: 200, bubbles: true, cancelable: true }}))`); await api.sleep(300) }}
              return await pickAt('(() => {{ const r = {board}.querySelector("iframe").getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + Math.min(r.height * 0.2, 120)] }})()', {json.dumps(chrome)})""", w, settle=3000)
            self.by_pin(o, (w, "panned"))
            # a pick on the landing page's name strip: a comment on that artboard, its pin on the strip (zoomed in on
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
            self.by_pin(o, (w, "strip"))
            # V6d: the pin lay 6 px left of the artboard, off it: on the strip picked
            self.assertTrue(o["pin"], (w, o))
            cx, cy = (o["pin"]["l"] + o["pin"]["r"]) / 2, (o["pin"]["t"] + o["pin"]["b"]) / 2
            self.assertTrue(o["strip"][0] <= cx <= o["strip"][2] and o["strip"][1] <= cy <= o["strip"][3], ("pin off the strip", w, o))
            # V6e: its centre was 11 px before the name's end, on "…age"; the box 7 px off the strip. The pin goes
            # after the name and its buttons, PIN_GAP (6 px) past the last, as after any words; the box 8 px off
            end = max(p[1] for p in o["parts"])
            self.assertTrue(0 <= o["pin"]["l"] - end <= 12, ("pin not right after the name and its buttons", w, o))

    def test_every_artboards_strip_comment_has_its_pin_on_the_strip_and_the_box_by_it(self):
        # V6f (1506 px window: a 1246 x 750 frame): "App: pick a drink" and "App: your order" (phone artboards: no room
        # after the strip's buttons before the next strip) opened with no pin (it went left of the strip, onto the
        # landing page's, a control: not drawn) and the box 235 px under the strip (off every artboard); strips 3 and
        # 4 had their pin and the same far box. A pin on its strip, after the buttons or over/under its end, never on
        # the name, a button or another strip; the box a popover by it.
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
                self.assertTrue(s[0] - 0.5 <= (p[0] + p[2]) / 2 <= s[2] + 40 and s[1] - 40 <= (p[1] + p[3]) / 2 <= s[3] + 40, ("pin off its strip", what))
                gap = max(b[0] - p[2], p[0] - b[2], b[1] - p[3], p[1] - b[3])
                self.assertTrue(7.5 <= gap <= 25, ("box not by its pin", gap, what))
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

    def test_a_title_picked_has_its_pin_after_its_words_and_the_box_by_it(self):
        # V6d: "Q4 sales pipeline" (a full-width block) picked: the pin at the block's right end, 560 px from the words.
        # The pin right after the title's first line; the box a popover by it (it may lie on the slide's other words).
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
            self.assertTrue(7.5 <= max(p["l"] - b["r"], b["l"] - p["r"], p["t"] - b["b"], b["t"] - p["b"]) <= 25, what)


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
# The live Test page (V6i B2): its controls 8 px apart and a full-width field under them, none marked for the box.
LIVE_PAGE = ("<!doctype html><meta charset=utf-8><style>body{margin:0;font:16px system-ui;background:#1d1d1b;color:#eee}main{padding:16px}"
             "h1{font-size:32px;margin:30px 0 24px}p{margin:0 0 16px}button{font:inherit;padding:6px 14px}.row{display:flex;gap:8px;margin-top:12px}.row input{flex:1;height:34px}</style>"
             "<main><h1>Bridge demo v2</h1><p>Counter: <b>0</b> (kept in this artifact's storage, survives reloads)</p>"
             "<div><button id=inc>+1</button> <button id=reset>Reset</button></div>"
             "<div class=row><input id=msg placeholder='Message to Hermes'><button>Send</button></div></main>")
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

    def test_the_box_lies_by_its_pin_before_empty_room_farther_off(self):
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
                # V6h N1: nearness first (a box far off over other content read as lost): by its pin, then the least
                # covering of the spots that near
                b, p = o["box"], o["pin"]
                self.assertLessEqual(max(p["l"] - b["r"], b["l"] - p["r"], p["t"] - b["b"], b["t"] - p["b"]), 25, ("the box away from its pin", what))


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
                # the part picked, as the host has it (a KPI's value, its label; a heading's words)
                pt = f'(() => {{ const r = ({el}).getBoundingClientRect(); return [r.left + r.width * {fx}, r.top + r.height * {fy}] }})()'
                o = self.pick(aid, el, pt, w,
                              "const d = await api.top('window.H.M.$draft.get().rect'); o.el = [d.x + o.off[0], d.y + o.off[1], d.x + d.w + o.off[0], d.y + d.h + o.off[1]]; return o", h=h)
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

    COMMENT = ('(() => { const b = [...document.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === "Comment"), q = b.getBoundingClientRect(), i = b.querySelector("i.codicon").getBoundingClientRect()'
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
          // V6h N9: the press only closed the menu, as anywhere outside it: nothing in the page took it
          o.focus = await api.frame('!(document.activeElement && document.activeElement.closest && document.activeElement.closest(".doc-blk"))')
          o.cover = await api.top('!document.querySelector("[data-menu-cover]")')
          return o""")
        self.assertEqual(o, {"open": "true", "after": "false", "focus": True, "cover": True})


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6gPicks(unittest.TestCase):
    """Live round V6g (8b4afe7): a deck just opened, the header's Comment, the slide's blank clicked at once: 2 of 16
    made no draft. The page said its click picks as the frame was revealed; the cover over the stage went, but the
    frame was still inert (React drops it in a passive effect, after the paint), so the press hit the inert frame and
    went nowhere. Here React's passive effects run a task later (__passiveMs), as they do live."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def drive(self, aid, sel, body, w, h=764, settle=2500):
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = {json.dumps(sel)}, SETTLE = {settle}; await api.size({w}, {h});" + BOOT_ANY + body, timeout=300)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    DRAFT = ("(() => { const box = q => { const b = q.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }, ta = document.querySelector('textarea'), card = ta && ta.closest('div[style*=\"z-index: 27\"]')"
             "; const pin = [...document.querySelectorAll('div')].find(d => d.style.zIndex === '28' && d.style.borderRadius === '50%')"
             "; return { box: card ? box(card) : null, pin: pin ? box(pin) : null, stage: box(document.querySelector('iframe')) } })()")

    def test_a_press_held_for_a_page_not_ready_shows_it_was_taken(self):
        # V6g N6: a sheet's draft came 1.7-2.9 s after a pick made as it opened, nothing seen meanwhile. The held press
        # shows at once as the new comment's pin to be, pulsing, "Loading…" its name, at the point pressed.
        aid = store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [{"name": "Budget", "rows": [["Item", "Cost"], ["Panels", 182]]}]}})["id"]
        o = self.drive(aid, 'document.querySelector("#sh-grid .sh-c")', """
          // the page does not say its click picks yet (its pick-ready held back)
          await api.frame('(() => { const po = MessagePort.prototype.postMessage; window.__po = po; MessagePort.prototype.postMessage = function (m, ...r) { if (m && m.event === "pick-ready") return; return po.call(this, m, ...r) } })()')
          await api.top('window.H.M.$picking.set(true)'); await api.sleep(300)
          const f = await frameAt(); await api.mouse(f[0] + 200, f[1] + 150); await api.sleep(300)
          const o = await api.top('(() => { const m = document.querySelector("[data-pick-hold] [role=status]"); if (!m) return null; const b = m.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, label: m.getAttribute("aria-label"), cls: m.className } })()')
          return { mark: o, at: [f[0] + 200, f[1] + 150], draft: await api.top('Boolean(window.H.M.$draft.get())') }""", 1250, 764, 1500)
        m = o["mark"]
        self.assertTrue(m, o)
        self.assertLessEqual(abs(m["x"] - o["at"][0]), 1, o)
        self.assertLessEqual(abs(m["y"] - o["at"][1]), 1, o)
        self.assertEqual((m["w"], m["label"], m["cls"]), (26, "Loading…", "animate-spin"), o)  # V6h N8: busy, not a placed pin
        self.assertFalse(o["draft"], o)

    def test_a_designs_draft_keeps_by_its_pin_through_a_zoom_and_off_screen_has_neither(self):
        # V6g N3: a design's element commented on, then zoomed: the box 72 px from its pin at first, 17-37 px after.
        # The box by its pin at every step in sight; the element out of sight, neither pin nor box (V6n, the owner:
        # they were parked at the stage's edge), both back with it.
        aid = store.publish(path=str(D.ROOT / "examples" / "design"), title="Test design", type="design")["id"]
        board = '__design.boards["Main.dc.html"].el'
        o = self.drive(aid, board, f"""
          const pick = await api.frame('(() => {{ const r = {board}.querySelector("iframe").getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + r.height * 0.35] }})()')
          await api.top('window.H.M.$picking.set(true)'); await api.sleep(300)
          let off = await frameAt(); await api.mouse(off[0] + pick[0], off[1] + pick[1]); await api.sleep(1200)
          const steps = [await api.top({json.dumps(self.DRAFT)})]
          // zoomed in far from it (it leaves the stage), then back out
          for (const dy of [-240, -240, -240, -240, 480, 480]) {{
            await api.frame(`document.getElementById("dc-view").dispatchEvent(new WheelEvent("wheel", {{ deltaY: ${{dy}}, ctrlKey: true, clientX: innerWidth - 40, clientY: innerHeight - 120, bubbles: true, cancelable: true }}))`); await api.sleep(700)
            const s = await api.top({json.dumps(self.DRAFT)})
            s.el = await api.frame('(() => {{ const r = {board}.querySelector("iframe").getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }})()')
            steps.push(s)
          }}
          return steps""", 1250, 764, 3000)
        out_of_sight = 0
        for s in o:
            b, p, st, el = s["box"], s["pin"], s["stage"], s.get("el")
            if el and (el[2] + st[0] < st[0] or el[0] + st[0] > st[2] or el[3] + st[1] < st[1] or el[1] + st[1] > st[3]):
                out_of_sight += 1
                self.assertEqual((p, b), (None, None), ("a pin or box for a part out of sight", s))
                continue
            self.assertTrue(b and p, ("no box or no pin", s, o))
            gap = max(b[0] - p[2], p[0] - b[2], b[1] - p[3], p[1] - b[3])
            self.assertTrue(8 - 0.5 <= gap <= 24, ("box away from its pin", gap, s))
        self.assertGreater(out_of_sight, 0, ("the zoom never took the artboard out of sight", o))
        self.assertTrue(o[-1]["box"] and o[-1]["pin"], ("not back with it", o[-1]))

    def test_a_strip_cut_by_the_window_has_its_pin_off_its_name(self):
        # V6g N9: the window narrowed (no refit), a design's strip partly past the stage's edge picked: the pin on its
        # name. Never on the name, its buttons or another strip: over or under the strip's part in sight.
        aid = store.publish(path=str(D.ROOT / "examples" / "design"), title="Test design", type="design")["id"]
        strips = ('[...Object.values(__design.boards)].map(b => b.strip).filter(s => getComputedStyle(s).visibility === "visible" && s.getClientRects().length)'
                  '.map(s => { const r = s.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(s.querySelector(".dc-name"))'
                  '; const clip = q => [Math.max(q.left, 0), q.top, Math.min(q.right, innerWidth), q.bottom]'
                  '; return { r: [r.left, r.top, r.right, r.bottom], parts: [rg.getBoundingClientRect(), ...[...s.querySelectorAll("button")].filter(b => b.getClientRects().length).map(b => b.getBoundingClientRect())].map(clip).filter(q => q[2] > q[0]) } })')
        o = self.drive(aid, '__design.boards["Main.dc.html"].el', f"""
          await api.size(1000, 764); await api.sleep(800)
          // pan until the poster's strip straddles the stage's right edge, its name in sight
          for (let i = 0; i < 4; i++) {{
            const d = await api.frame('(() => {{ const s = __design.boards["Poster.dc.html"].strip.getBoundingClientRect(); return s.left - (innerWidth - 90) }})()')
            await api.frame(`document.getElementById("dc-view").dispatchEvent(new WheelEvent("wheel", {{ deltaX: ${{d}}, deltaY: 0, clientX: 200, clientY: 200, bubbles: true, cancelable: true }}))`); await api.sleep(300)
          }}
          const all = await api.frame({json.dumps(strips)}), off = await frameAt(), w = await api.frame('innerWidth')
          const i = all.findIndex(s => s.r[0] < w - 20 && s.r[2] > w)
          if (i < 0) return {{ none: all, w }}
          const s = all[i]
          await api.top('window.H.M.$picking.set(true)'); await api.sleep(300)
          await api.mouse(off[0] + s.r[0] + 12, off[1] + (s.r[1] + s.r[3]) / 2); await api.sleep(1200)
          const d = await api.top({json.dumps(self.DRAFT)})
          const mv = q => [q[0] + off[0], q[1] + off[1], q[2] + off[0], q[3] + off[1]]
          return {{ ...d, strip: mv(s.r), parts: s.parts.map(mv), others: all.filter((x, j) => j !== i).map(x => mv(x.r)) }}""", 1250, 764, 3000)
        self.assertNotIn("none", o, o)
        meet = lambda a, b: a[0] < b[2] - 0.5 and b[0] < a[2] - 0.5 and a[1] < b[3] - 0.5 and b[1] < a[3] - 0.5
        p, st = o["pin"], o["stage"]
        self.assertTrue(p and o["box"], o)
        self.assertTrue(st[0] <= p[0] and p[2] <= st[2] and st[1] <= p[1] and p[3] <= st[3], ("pin out of the stage", o))
        for q in o["parts"] + o["others"]:
            self.assertFalse(meet(p, q), ("pin on the name, a button or another strip", q, o))
        self.assertTrue(o["strip"][0] - 0.5 <= (p[0] + p[2]) / 2 <= o["strip"][2] + 0.5, ("pin not over or under its strip", o))

    def test_a_decks_blank_picked_as_it_shows_is_never_lost_in_40_opens(self):
        aid = store.publish(path=str(D.ROOT / "examples" / "slides"), title="Test slides", type="slides")["id"]
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        # the tester's point: the slide's blank over the title (frame-local 460,158 of 1250 x 716)
        where = '(() => { const c = document.querySelector(".sl-clip .sl-canvas"); if (!c) return null; const r = c.getBoundingClientRect(); return r.width ? [r.left + r.width * 0.12, r.top + r.height * 0.1] : null })()'
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, WHERE = {json.dumps(where)}; await api.size(1250, 764);" + """
          await api.go(URL, 400)
          for (let i = 0; i < 50 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(100)
          await api.top('window.__passiveMs = 100')
          const open = () => api.top(`(() => { const { M, ctx } = window.H; M.openArtifact(ctx, ${JSON.stringify(AID)}) })()`)
          await api.top(`(async () => { const { M, R, jsx, ctx } = window.H; M.$list.set((await ctx.rest('/artifacts')).artifacts)
            M.openArtifact(ctx, ${JSON.stringify(AID)}); R.mount(() => jsx(M.Viewer, { ctx }), document.getElementById('root')) })()`)
          let q = null
          for (let i = 0; i < 200 && !q; i++) { try { q = await api.frame(WHERE) } catch (_) {} if (!q) await api.sleep(50) }
          await api.sleep(600); q = await api.frame(WHERE)
          const f = await api.top('(() => { const r = document.querySelector("iframe").getBoundingClientRect(); return [r.left, r.top] })()')
          const button = '(() => { const b = [...document.querySelectorAll("button")].find(b => b.title === "Comment" || b.getAttribute("aria-label") === "Comment"); if (!b) return null; const q = b.getBoundingClientRect(); return q.width ? [q.left + q.width / 2, q.top + q.height / 2] : null })()'
          const out = []
          for (let n = 0; n < 40; n++) {
            await api.top('window.H.M.closeArtifact()')
            for (let i = 0; i < 100 && (await api.top('document.querySelectorAll("iframe").length')); i++) await api.sleep(20)
            await open()
            let b = null
            for (let i = 0; i < 400 && !b; i++) { b = await api.top(button); if (!b) await api.sleep(5) }
            await api.mouse(b[0], b[1])
            // the click at once after Comment, or the moment the stage's cover goes (the page said its click picks)
            await api.pointer('mouseMoved', f[0] + q[0], f[1] + q[1], false)
            if (n % 2) await api.top('new Promise(r => { const h = document.querySelector("[data-pick-hold]"); if (!h || h.style.display === "none") return r(); const mo = new MutationObserver(() => { if (h.style.display === "none") { mo.disconnect(); r() } }); mo.observe(h, { attributes: true }); setTimeout(r, 4000) })')
            await api.pointer('mousePressed', f[0] + q[0], f[1] + q[1], true); await api.pointer('mouseReleased', f[0] + q[0], f[1] + q[1], false)
            let d = null
            for (let i = 0; i < 70 && !d; i++) { d = await api.top('window.H.M.$draft.get()'); if (!d) await api.sleep(100) }
            out.push({ n, draft: Boolean(d && d.anchor), title: d && d.anchor && d.anchor.label, picking: await api.top('window.H.M.$picking.get()') })
            await api.top('(() => { window.H.M.$draft.set(null); window.H.M.$picking.set(false) })()')
          }
          return out""", timeout=900)
        self.assertIsNone(r.get("err"), r)
        lost = [o for o in r["out"] if not o["draft"] or o["picking"]]
        self.assertEqual(len(r["out"]), 40)
        self.assertFalse(lost, ("picks lost", lost))


# The page's own controls (each region, and the controls in it), in the frame, after a pick (frame JS).
PLACED = r"""(() => { const box = q => [q.left, q.top, q.right, q.bottom]
  const seen = e => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return false } return true }
  const ctl = 'a[href], button, input, select, textarea, [role=button], [role=tab], [role=link]'
  const keep = [...document.querySelectorAll('[data-comment-keep]')].filter(e => e.getClientRects().length && seen(e)).map(e => ({ r: box(e.getBoundingClientRect()),
    c: [...e.querySelectorAll(ctl)].filter(c => c.getClientRects().length && seen(c)).map(c => box(c.getBoundingClientRect())) }))
  // V6i B2: every other control of the page, marked or not (a free-form page's buttons and fields, a doc's checkboxes)
  const foc = ctl + ', [role=checkbox], [role=switch], [role=menuitem], [role=option], [role=slider], [role=combobox], summary, [tabindex]:not([tabindex="-1"])'
  const ctls = [...document.querySelectorAll(foc)].filter(e => !e.closest('[data-comment-keep], [data-hermes-ui], [data-comment-under], [data-comment-hide]') && !e.hasAttribute('contenteditable')
    && e.getClientRects().length && seen(e)).map(e => [...box(e.getBoundingClientRect()), e.tagName + '.' + e.className + ' ' + (e.getAttribute('aria-label') || '')])
    .filter(q => q[2] - q[0] >= 1 && q[3] - q[1] >= 1 && (q[2] - q[0]) * (q[3] - q[1]) <= innerWidth * innerHeight / 4 && q[2] > 0 && q[3] > 0 && q[0] < innerWidth && q[1] < innerHeight)
  return { keep, ctls } })()"""
# What the host drew for the draft (its box and pin), the bridge's rect of the part picked, and the stage.
# Points on a model's parts as its camera shows them: each part's box on screen, at its middle and 20 % in from it,
# where the part is hit and no bar of the view is over it.
MODEL_PARTS = r"""(() => { const c = document.querySelector(".md-canvas").getBoundingClientRect(), cam = __model.three().camera, b = __model.built(), o = []
  for (const id in b.byId) { const q = new THREE.Box3().setFromObject(b.byId[id]), s = []
    for (let i = 0; i < 8; i++) { const v = new THREE.Vector3(i & 1 ? q.max.x : q.min.x, i & 2 ? q.max.y : q.min.y, i & 4 ? q.max.z : q.min.z).project(cam); s.push([c.left + (v.x + 1) / 2 * c.width, c.top + (1 - v.y) / 2 * c.height]) }
    const x0 = Math.min(...s.map(p => p[0])), x1 = Math.max(...s.map(p => p[0])), y0 = Math.min(...s.map(p => p[1])), y1 = Math.max(...s.map(p => p[1]))
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) o.push([x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy]) }
  return o.filter(([x, y]) => { const e = document.elementFromPoint(x, y); return __model.pick(x, y) && e && e.localName === "canvas" && e.closest(".md-canvas") }) })()"""

DRAWN = r"""(() => { const box = q => { const b = q.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }
  const ta = document.querySelector('textarea'), card = ta && ta.closest('div[style*="z-index: 27"]')
  if (!card) return null
  const pin = [...document.querySelectorAll('div')].find(d => d.style.zIndex === '28' && d.style.borderRadius === '50%'), d = window.H.M.$draft.get()
  return { box: box(card), pin: pin ? box(pin) : null, rect: d && d.rect, stage: box(document.querySelector('[data-frame="shown"] iframe') || document.querySelector('iframe')) } })()"""
# Points to pick in the frame: each part's first line (an element) or the point itself ([x, y]); none on a control.
POINTS = r"""(els => { const out = [], keep = [...document.querySelectorAll('[data-comment-keep]')]
  for (const e of els) { if (Array.isArray(e)) { out.push(e); continue }
    const r = [...e.getClientRects()].find(q => q.width >= 6 && q.height >= 6); if (!r) continue
    const x = r.left + Math.min(r.width / 2, 30), y = r.top + Math.min(r.height / 2, 10)
    if (x < 4 || y < 4 || x > innerWidth - 4 || y > innerHeight - 4) continue
    const at = document.elementFromPoint(x, y); if (!at || keep.some(k => k.contains(at))) continue
    out.push([x, y]) }
  return out })"""


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class CommentPlacementProperty(unittest.TestCase):
    """The new comment's box is a popover beside its pin (the owner's rule, as a design tool's comment), checked as a
    property over many picks per type with the real rects: every part the page names (or its words, cells, blocks,
    points: at most CAP) at four stage sizes (Hermes' 1523 px window: a 1250 x 716 frame; with the comments list:
    906; the 1000 px window: 740; 400). Inside the stage (8 px), 8 px off its pin and never more than 24, off the
    part picked by 8 px (all of a part drawn as one) wherever a spot that near its pin is, at its full height. It may
    lie on the page's content and its controls. The pin's own rules: always there, never on a control of the page,
    never over a small part."""

    CAP = 16
    STAGES = ((1250, 716), (906, 716), (740, 716), (400, 700))
    W, GAP, M, NEAR = 320, 8, 8, 24

    @classmethod
    def setUpClass(cls):
        from test_models import PANEL
        from test_type_pages_browser import DASH2, DASH2_CSV
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))
        ex = D.ROOT / "examples"
        board = {"title": "Test board", "items": [{"id": "t", "type": "text", "text": "Release flow"}, {"id": "a", "type": "box", "text": "Draft"},
                                                  {"id": "b", "type": "box", "text": "Ship", "near": "a"}, {"id": "n", "type": "note", "text": "Owner: Anna", "near": "b"}]}
        sheet = {"title": "Costs", "sheets": [{"name": "Costs", "rows": [["Item", "Unit price", "Qty", "Total"], ["Wall panels", 2000, 3, 6000], ["Rails", 300, 10, 3000], ["Total"]]}]}
        grid = lambda sel: f'(() => {{ const r = {sel}.getBoundingClientRect(), o = []; for (const fx of [0.15, 0.5, 0.85]) for (const fy of [0.15, 0.5, 0.85]) o.push([r.left + r.width * fx, r.top + r.height * fy]); return o }})()'
        cls.fixtures = {
            "page": (store.publish(title="Test page", type="page", html=BRIDGE_PAGE)["id"], 'document.querySelector("main")', '[...document.querySelectorAll("h1, p, input, button")]'),
            # V6i B2: the live Test page's shape, nothing marked: "+1" with Reset 8 px after it, the message field under
            "page-live": (store.publish(title="Test page", type="page", html=LIVE_PAGE)["id"], 'document.querySelector("main")', '[...document.querySelectorAll("h1, p, input, button")]'),
            "doc": (store.publish(path=str(ex / "doc"), title="Test doc", type="doc")["id"], 'document.querySelector(".doc-blk")', '[...document.querySelectorAll(".doc-blk, .doc-blk td")]'),
            "sheet": (store.publish(title="Costs", type="sheet", files={"sheet.json": sheet})["id"], 'document.querySelector("#sh-grid .sh-c")',
                      '[...document.querySelectorAll("#sh-grid .sh-c")].filter(c => c.textContent.trim())'),
            "board": (store.publish(title="Test board", type="board", files={"board.json": board})["id"], 'document.querySelector(".bd-it")', '[...document.querySelectorAll("[data-comment-label]")]'),
            "dashboard": (store.publish(title="Test dash2", type="dashboard", files={"dashboard.json": DASH2, "data/monthly.csv": DASH2_CSV})["id"], 'document.querySelector(".c-kpi")',
                          '[...document.querySelectorAll("[data-comment-label], .c-kpi > *, select")]'),
            "slides": (store.publish(path=str(ex / "slides"), title="Test slides", type="slides")["id"], 'document.querySelector(".sl-clip .sl-canvas h1")',
                       '[...document.querySelectorAll(".sl-clip .sl-canvas section > *:not(aside)")].concat(' + grid('document.querySelector(".sl-clip .sl-canvas")') + ')'),
            "design": (store.publish(path=str(ex / "design"), title="Test design", type="design")["id"], '__design.boards["Main.dc.html"].el',
                       '[...Object.values(__design.boards)].filter(b => b.el.getClientRects().length).flatMap(b => { const r = b.el.querySelector("iframe").getBoundingClientRect(); return [[r.left + r.width * 0.3, r.top + r.height * 0.12], [r.left + r.width * 0.5, r.top + r.height * 0.5]] })'),
            "design-system": (store.publish(path=str(ex / "design-system"), title="Kiln", type="design-system")["id"], 'document.querySelector(".ds-cover")',
                              '[...document.querySelectorAll("[data-comment-label], #ds-main h1, #ds-main h2, #ds-main p")]'),
            "film": (store.publish(path=str(ex / "motion"), title="Harbor film", type="motion")["id"], 'document.getElementById("mo-frame")', grid('document.getElementById("mo-frame")')),
            # its parts only, as the camera shows them: the view itself (floor, grid, axes) is no part (fb02caf)
            "model": (store.publish(title="Panel", type="model", files={"model.json": PANEL})["id"], 'document.querySelector(".md-canvas")', MODEL_PARTS),
        }
        # open threads on two of the doc's blocks: their comment marks beside them are the page's own controls (N2)
        blocks = docs.read(cls.fixtures["doc"][0])["blocks"]
        for blk in (blocks[1], blocks[4]):
            api.handle("POST", f"artifacts/{cls.fixtures['doc'][0]}/comments", {}, {"text": "note", "anchor": {"selector": f"#blk-{blk['id']}", "text": "x", "label": "text"}})
        cls.far = {}

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def picks(self, kind, w, h):
        aid, sel, parts = self.fixtures[kind]
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = {json.dumps(sel)}, SETTLE = 2000; await api.size({w}, {h + 48});" + BOOT_ANY + f"""
          let pts = await api.frame('(' + {json.dumps(POINTS)} + ')(' + {json.dumps(parts)} + ')')
          const step = Math.max(1, pts.length / {self.CAP}); pts = pts.filter((p, i) => Math.floor(i % step) === 0).slice(0, {self.CAP})
          const out = []
          for (const [x, y] of pts) {{
            await api.top('window.H.M.$picking.set(true)')
            for (let i = 0; i < 100 && await api.top('(() => {{ const h = document.querySelector("[data-pick-hold]"); return !!h && h.style.display !== "none" }})()'); i++) await api.sleep(20)
            const off = await frameAt()
            await api.mouse(off[0] + x, off[1] + y)
            let o = null
            for (let i = 0; i < 40 && !o; i++) {{ await api.sleep(60); o = await api.top({json.dumps(DRAWN)}) }}
            if (o) {{ await api.sleep(120); o = await api.top({json.dumps(DRAWN)}); o.page = await api.frame({json.dumps(PLACED)}); o.off = off; o.at = [x, y]
              // (a heading or paragraph of words alone is its words, as the bridge measures it: wordsRect, V6j)
              o.whole = await api.frame(`(() => {{ const e = document.elementFromPoint(${{x}}, ${{y}}), w = e && e.closest('[data-comment-whole]'); if (!w || (/^(H[1-6]|P)$/.test(w.tagName) && !w.querySelector('img, svg, canvas, video, iframe, input, select, textarea, button'))) return null; const q = w.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom] }})()`) }}
            out.push(o || {{ at: [x, y], none: true }})
            await api.top('(() => {{ window.H.M.$draft.set(null); window.H.M.$picking.set(false) }})()'); await api.sleep(150)
          }}
          return out""", timeout=600)
        self.assertIsNone(r.get("err"), (kind, w, r))
        return r["out"]

    @staticmethod
    def gap(a, b):
        return max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3])

    @staticmethod
    def meet(a, b, pad):
        return a[0] < b[2] + pad - 0.5 and b[0] - pad + 0.5 < a[2] and a[1] < b[3] + pad - 0.5 and b[1] - pad + 0.5 < a[3]

    @staticmethod
    def dist(a, b):
        return ((max(0, b[0] - a[2], a[0] - b[2])) ** 2 + (max(0, b[1] - a[3], a[1] - b[3])) ** 2) ** 0.5

    def by_pin(self, q, s, p):
        """q inside the stage, 8-24 px from the pin p."""
        return (q[0] >= s[0] + self.M - 0.5 and q[2] <= s[2] - self.M + 0.5 and q[1] >= s[1] + self.M - 0.5 and q[3] <= s[3] - self.M + 0.5
                and self.gap(q, p) >= self.GAP - 0.5 and self.dist(q, p) <= self.NEAR + 2)

    def spot_off(self, s, p, e, bh):
        """A box spot (every 2 px) by the pin and 8 px off the part, if there is one."""
        for x in range(int(p[0] - self.W - self.NEAR), int(p[2] + self.NEAR) + 1, 2):
            for y in range(int(p[1] - bh - self.NEAR), int(p[3] + self.NEAR) + 1, 2):
                q = [x, y, x + self.W, y + bh]
                if self.gap(q, p) >= self.GAP and self.dist(q, p) <= self.NEAR and self.by_pin(q, s, p) and self.gap(q, e) >= self.GAP:
                    return q
        return None

    def check(self, kind):
        worst = 0
        for w, h in self.STAGES:
            out = self.picks(kind, w, h)
            made = [o for o in out if not o.get("none")]
            self.assertGreaterEqual(len(made), max(1, len(out) // 2), (kind, w, "picks made no draft", out))
            for o in made:
                ox, oy = o["off"]
                mv = lambda q: [q[0] + ox, q[1] + oy, q[2] + ox, q[3] + oy]
                r = o["rect"]
                e = [r["x"] + ox, r["y"] + oy, r["x"] + r["w"] + ox, r["y"] + r["h"] + oy]
                b, p, s = o["box"], o["pin"], o["stage"]
                if isinstance(r.get("vt"), (int, float)) and isinstance(r.get("vb"), (int, float)) and r["vb"] - r["vt"] >= 146:
                    s = [s[0], s[1] + r["vt"], s[2], s[1] + r["vb"]]  # between the page's own bars (commentLayout's band)
                holds = lambda k: k[0] - 0.5 <= r["x"] and r["x"] + r["w"] <= k[2] + 0.5 and k[1] - 0.5 <= r["y"] and r["y"] + r["h"] <= k[3] + 0.5
                # a region of the page's controls holding the part (a design system's nav, an item of it picked): its
                # other controls each (V6h N2: the box 1 px on the nav's "Assets")
                keep = [mv(k["r"]) for k in o["page"]["keep"] if not holds(k["r"])] + [mv(c) for k in o["page"]["keep"] if holds(k["r"]) for c in k["c"] if not holds(c)]
                # V6i B2: every other control of the page, not the part picked nor one in it
                inside = lambda k: r["x"] - 0.5 <= k[0] and k[2] <= r["x"] + r["w"] + 0.5 and r["y"] - 0.5 <= k[1] and k[3] <= r["y"] + r["h"] + 0.5
                keep += [mv(c) + c[4:] for c in o["page"]["ctls"] if not holds(c) and not inside(c)]
                if o.get("whole"):  # drawn as one (a board's sticky): the box keeps off all of it (V6h B2)
                    wb = mv(o["whole"])
                    e = [min(e[0], wb[0]), min(e[1], wb[1]), max(e[2], wb[2]), max(e[3], wb[3])]
                bh = b[3] - b[1]
                what = (kind, w, h, o["at"], {"box": b, "pin": p, "el": e})
                # V6i B3: a pick always has its pin (a nav item between two others had none)
                self.assertTrue(p, ("no pin", what))
                # V6i B2: the pin's centre never on another control of the page ("+1"'s pin in Reset)
                pc = ((p[0] + p[2]) / 2, (p[1] + p[3]) / 2)
                own = [c for c in o["page"]["ctls"] if inside(c) and not holds(c)]  # the part's own buttons too
                for k in keep + [mv(c) + c[4:] for c in own]:
                    self.assertFalse(k[0] + 0.5 < pc[0] < k[2] - 0.5 and k[1] + 0.5 < pc[1] < k[3] - 0.5, ("the pin on a control of the page", k, r.get("kp"), what))
                # V6h N5: a part under two pins wide or tall is never covered by its pin (a grid's cell has it inside)
                after = "lr" in r and p and p[0] >= r["lr"] + ox - 0.5  # after its words, inside its box: its own room
                if p and (r["w"] < 52 or r["h"] < 52) and "px" not in r and not r.get("pt") and not after:
                    over = max(0, min(p[2], e[2]) - max(p[0], e[0])) * max(0, min(p[3], e[3]) - max(p[1], e[1]))
                    self.assertLessEqual(over, 0.25 * (e[2] - e[0]) * (e[3] - e[1]), ("the pin covers a small part", what))
                # the box: a popover by its pin, inside the stage, off the part where a spot by the pin is
                self.assertTrue(self.by_pin(b, s, p), ("the box not 8-24 px from its pin inside the stage", self.gap(b, p), what))
                if self.gap(b, e) < self.GAP - 0.5:
                    can = self.spot_off(s, p, e, bh)
                    self.assertIsNone(can, ("the box on the part picked with a spot by its pin off it", can, what))
                worst = max(worst, self.gap(b, p))
        type(self).far[kind] = worst
        print(f"\n{kind}: max pin-box gap {worst:.0f} px", file=sys.stderr)

    def test_the_pages_own_controls_are_marked(self):
        # V6g B3, N2: a filter row's Reset (the box 9 px on it) and a doc's comment marks beside their blocks were not
        # marked as the page's own controls, so nothing kept the box off them. Every one shown is marked.
        cases = (("dashboard", '[...document.querySelectorAll(".c-filters select, .c-filters input, .c-filters button")]'),
                 ("doc", '[...document.querySelectorAll(".doc-card")]'))
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        for kind, sel in cases:
            for w in (1250, 740):
                aid, ready, _ = self.fixtures[kind]
                r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = {json.dumps(ready)}, SETTLE = 2000; await api.size({w}, 764);" + BOOT_ANY
                            + f"return await api.frame('({sel}).filter(e => e.getClientRects().length).map(e => e.hasAttribute(\"data-comment-keep\"))')", timeout=240)
                self.assertIsNone(r.get("err"), r)
                self.assertTrue(r["out"], (kind, w, "none shown"))
                self.assertTrue(all(r["out"]), (kind, w, r["out"]))

    def test_page(self):
        self.check("page")

    def test_page_live(self):
        self.check("page-live")

    def test_doc(self):
        self.check("doc")

    def test_sheet(self):
        self.check("sheet")

    def test_board(self):
        self.check("board")

    def test_dashboard(self):
        self.check("dashboard")

    def test_slides(self):
        self.check("slides")

    def test_design(self):
        self.check("design")

    def test_design_system(self):
        self.check("design-system")

    def test_film(self):
        self.check("film")

    def test_model(self):
        self.check("model")


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class CommentPopoverCloses(unittest.TestCase):
    """The owner's rule for the box (as a design tool's comment): a press outside it and its pin closes it and does
    nothing else on the page; a draft with words keeps its pin, and a press on the pin opens the box again with them
    (Send to Hermes as it was); an empty one goes with its pin. Then the page's own presses work again."""

    def test_a_press_outside_closes_the_box_its_pin_opens_it_again(self):
        host = B.Host()
        try:
            host.files.update(D.viewer_files(EXPORTS))
            aid = store.publish(title="Test page", type="page", html=LIVE_PAGE)["id"]
            url = f"http://127.0.0.1:{host.port}/dom/index.html"
            h1 = 'document.querySelector("h1")'
            r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = {json.dumps(h1)}, SETTLE = 1500; await api.size(1250, 764);" + BOOT_ANY + f"""
              await api.frame('window.__got = 0; document.addEventListener("click", () => window.__got++); document.addEventListener("mousedown", () => window.__got++)')
              const state = () => api.top(`(() => {{ const d = window.H.M.$draft.get(), ta = document.querySelector('textarea'), cb = document.querySelector('input[type=checkbox]')
                const pin = [...document.querySelectorAll('div')].find(d => d.style.zIndex === '28' && d.style.borderRadius === '50%'), q = pin && pin.getBoundingClientRect()
                return {{ draft: !!d, closed: !!(d && d.closed), box: !!ta, text: ta ? ta.value : null, send: cb ? cb.checked : null, pin: q ? [q.left + q.width / 2, q.top + q.height / 2] : null }} }})()`)
              const outside = async () => {{ const off = await frameAt(), q = await api.frame('(() => {{ const r = document.getElementById("msg").getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2] }})()'); await api.mouse(off[0] + q[0], off[1] + q[1]); await api.sleep(400) }}
              const out = {{}}
              await pickAt('(() => {{ const r = {h1}.getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2] }})()', '[]')
              await api.type('first line\\nsecond')
              await api.top(`document.querySelector('input[type=checkbox]').click()`); await api.sleep(200)
              out.typed = await state()
              await outside(); out.closed = await state(); out.got = await api.frame('window.__got')
              out.focus = await api.frame('document.activeElement && document.activeElement.id')
              await api.mouse(out.closed.pin[0], out.closed.pin[1]); await api.sleep(400); out.again = await state()
              await outside(); await api.top('window.H.M.$draft.set(null)'); await api.sleep(300)
              await pickAt('(() => {{ const r = {h1}.getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2] }})()', '[]')
              await outside(); out.empty = await state(); out.got2 = await api.frame('window.__got')
              await outside(); out.got3 = await api.frame('window.__got')
              return out""", timeout=240)
            self.assertIsNone(r.get("err"), r)
            o, TWO_LINES = r["out"], "first line" + chr(10) + "second"
            self.assertEqual((o["typed"]["box"], o["typed"]["text"], o["typed"]["send"]), (True, TWO_LINES, False), o)  # two lines typed
            self.assertEqual((o["closed"]["draft"], o["closed"]["closed"], o["closed"]["box"]), (True, True, False), o)
            self.assertTrue(o["closed"]["pin"], o)  # its pin stays
            self.assertEqual(o["got"], 0, o)  # the press reached nothing of the page
            self.assertNotEqual(o["focus"], "msg", o)
            self.assertEqual((o["again"]["box"], o["again"]["text"], o["again"]["send"], o["again"]["closed"]), (True, TWO_LINES, False, False), o)
            self.assertEqual((o["empty"]["draft"], o["empty"]["pin"]), (False, None), o)  # an empty one goes with its pin
            self.assertEqual(o["got2"], 0, o)
            self.assertGreater(o["got3"], 0, o)  # closed: the page's own presses again
        finally:
            host.close()


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class PageMenusCloseOnEsc(unittest.TestCase):
    """Live loop V6l: on a doc just opened, Fonts mouse-pressed opened its menu but Esc left it open: the toolbar's
    button keeps the focus where it is (mousedown cancelled), so the frame never took the keys. A press in the page
    takes them; an Esc that lands in the host anyway (nothing of its own focused) is the page's."""

    def test_a_doc_toolbar_menu_closes_on_esc_in_the_frame_or_in_the_host(self):
        host = B.Host()
        try:
            host.files.update(D.viewer_files(EXPORTS))
            aid = store.publish(path=str(D.ROOT / "examples" / "doc"), title="Test doc", type="doc")["id"]
            url = f"http://127.0.0.1:{host.port}/dom/index.html"
            fonts = '[...document.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") || b.title || b.textContent.trim()) === "Fonts")'
            r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = {json.dumps(fonts)}, SETTLE = 1500; await api.size(1250, 764);" + BOOT_ANY + f"""
              const open = () => api.frame('!!document.querySelector(".kit-menu")')
              const press = async () => {{ const off = await frameAt(), q = await api.frame('(() => {{ const r = ({fonts}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }})()'); await api.mouse(off[0] + q[0], off[1] + q[1]); await api.sleep(400) }}
              const out = {{}}
              await api.top('document.body.focus()'); await press(); out.opened = await open()
              await api.key('Escape', 'Escape', 27); await api.sleep(300); out.afterEsc = await open()
              await press(); out.again = await open()
              await api.top('(() => {{ document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute("tabindex") }})()'); await api.sleep(100)
              out.hostHasKeys = await api.top('document.hasFocus() && document.activeElement === document.body')
              await api.key('Escape', 'Escape', 27); await api.sleep(300); out.afterHostEsc = await open()
              return out""", timeout=240)
            self.assertIsNone(r.get("err"), r)
            o = r["out"]
            self.assertEqual((o["opened"], o["afterEsc"], o["again"], o["afterHostEsc"]), (True, False, True, False), o)
        finally:
            host.close()


LONG_PAGE = ("<!doctype html><meta charset=utf-8><style>body{margin:0;font:16px system-ui;background:#1d1d1b;color:#eee}main{padding:24px;width:1800px}"
             "h2{margin:30px 0 10px}</style><main>" + "".join(f"<h2 id=s{i}>Section {i}</h2><p>Words of section {i}, a line of them.</p>" for i in range(30)) + "</main>")
# Driver JS: what the host drew for the draft (pin, box, the stage) in the window.
DRAFT_NOW = ("(() => { const box = q => { const b = q.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }, ta = document.querySelector('textarea'), card = ta && ta.closest('div[style*=\"z-index: 27\"]')"
             "; const pin = [...document.querySelectorAll('div')].find(d => d.style.zIndex === '28' && d.style.borderRadius === '50%')"
             "; const r = (window.H.M.$draft.get() || {}).rect"
             "; return { box: card ? box(card) : null, pin: pin ? box(pin) : null, stage: box(document.querySelector('[data-frame=\"shown\"] iframe') || document.querySelector('iframe')), band: r && Number.isFinite(r.vt) ? [r.vt, r.vb] : null, out: !!r && (r.x + r.w <= 0 || r.y + r.h <= (r.vt || 0) || r.y >= (Number.isFinite(r.vb) ? r.vb : 1e9)) } })()")


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6hFollow(unittest.TestCase):
    """Live round V6h (0440f61), B1: a board's sticky commented on, then panned and zoomed: the item moved, its pin and
    box stayed where they were. The rule for every type: the pin is at its part wherever the content moves (a
    pan, a zoom, a scroll on either axis, a re-layout); pin and box hidden while it is out of sight or not drawn
    (V6n, the owner; a part not drawn, another slide, keeps its box) and back with it; the box by its pin. Here a draft is opened by a
    real pick in each type, the content moved by each means it has, and after every move: a part in sight has its
    pin on or by it (and moved by exactly as much as a part moved without a zoom, 1 px), the box 8-24 px from the
    pin; a part out of sight has neither, its draft kept."""

    @classmethod
    def setUpClass(cls):
        from test_type_pages_browser import DASH2, DASH2_CSV
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))
        ex = D.ROOT / "examples"
        board = {"title": "Test board", "items": [{"id": "t", "type": "text", "text": "Release flow"}, {"id": "a", "type": "box", "text": "Draft"},
                                                  {"id": "b", "type": "box", "text": "Ship", "near": "a"}, {"id": "n", "type": "note", "text": "Owner: Anna", "near": "b"}]}
        rows = [["Item", "Unit price", "Qty", "Total"]] + [[f"Part {i}", 100 + i, i % 7, (100 + i) * (i % 7)] for i in range(80)]
        cls.aids = {
            "board": store.publish(title="Test board", type="board", files={"board.json": board})["id"],
            "design": store.publish(path=str(ex / "design"), title="Test design", type="design")["id"],
            "sheet": store.publish(title="Costs", type="sheet", files={"sheet.json": {"title": "Costs", "sheets": [{"name": "Costs", "rows": rows}]}})["id"],
            "doc": store.publish(path=str(ex / "doc"), title="Test doc", type="doc")["id"],
            "page": store.publish(title="Long page", type="page", html=LONG_PAGE)["id"],
            "dashboard": store.publish(title="Test dash2", type="dashboard", files={"dashboard.json": DASH2, "data/monthly.csv": DASH2_CSV})["id"],
            "design-system": store.publish(path=str(ex / "design-system"), title="Kiln", type="design-system")["id"],
            "slides": store.publish(path=str(ex / "slides"), title="Test slides", type="slides")["id"],
            "model": store.publish(title="Panel", type="model", files={"model.json": __import__("test_models").PANEL})["id"],
        }

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def follow(self, kind, ready, part, moves, w=1250, h=764, zoom=()):
        """part: frame JS for the element picked (picked at its first line, in sight); moves: driver JS, each one move."""
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(self.aids[kind])}, SEL = {json.dumps(ready)}, SETTLE = 2000, PART = {json.dumps(part)}; await api.size({w}, {h});" + BOOT_ANY + f"""
          const partAt = async () => {{ const off = await frameAt(); const q = await api.frame('(() => {{ const e = ' + PART + '; if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }})()'); return q && [q[0] + off[0], q[1] + off[1], q[2] + off[0], q[3] + off[1]] }}
          const at = await api.frame('(() => {{ const e = ' + PART + '; e.scrollIntoView({{ block: "center", inline: "center" }}); const q = [...e.getClientRects()].find(q => q.width >= 4 && q.height >= 4) || e.getBoundingClientRect(); return [q.left + Math.min(q.width / 2, 24), q.top + Math.min(q.height / 2, 10)] }})()')
          await api.sleep(400)
          const at2 = await api.frame('(() => {{ const e = ' + PART + '; const q = [...e.getClientRects()].find(q => q.width >= 4 && q.height >= 4) || e.getBoundingClientRect(); return [Math.max(q.left, 0) + Math.min(q.width / 2, 24), q.top + Math.min(q.height / 2, 10)] }})()')
          await api.top('window.H.M.$picking.set(true)')
          for (let i = 0; i < 100 && await api.top('(() => {{ const h = document.querySelector("[data-pick-hold]"); return !!h && h.style.display !== "none" }})()'); i++) await api.sleep(20)
          const off0 = await frameAt(); await api.mouse(off0[0] + at2[0], off0[1] + at2[1]); await api.sleep(1200)
          const steps = [{{ move: 'pick', part: await partAt(), ...(await api.top({json.dumps(DRAFT_NOW)})) }}]
          const moves = {json.dumps(list(moves))}
          for (const mv of moves) {{
            const d = await api.top({json.dumps(DRAFT_NOW)}), st = d.stage
            // the wheel over the stage, off the box and the pin
            const free = [[st[0] + 40, st[1] + (st[3] - st[1]) / 2], [st[2] - 40, st[1] + (st[3] - st[1]) / 2], [st[0] + (st[2] - st[0]) / 2, st[1] + 60], [st[0] + (st[2] - st[0]) / 2, st[3] - 120]]
              .find(([x, y]) => !(d.box && x > d.box[0] - 4 && x < d.box[2] + 4 && y > d.box[1] - 4 && y < d.box[3] + 4))
            const cx = free[0], cy = free[1], off = await frameAt()
            await (new Function('api', 'cx', 'cy', 'off', 'frameAt', 'return (async () => {{ ' + mv + ' }})()'))(api, cx, cy, off, frameAt)
            await api.sleep(700)
            steps.push({{ move: mv, part: await partAt(), ...(await api.top({json.dumps(DRAFT_NOW)})), draft: Boolean(await api.top('window.H.M.$draft.get()')) }})
          }}
          return steps""", timeout=300)
        self.assertIsNone(r.get("err"), (kind, r))
        steps = r["out"]
        self.assertTrue(steps[0]["pin"] and steps[0]["box"], (kind, "no draft from the pick", steps[0]))
        gap = lambda a, b: max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3])
        seen = lambda p, s: p and p[0] >= s[0] - 0.5 and p[2] <= s[2] + 0.5 and p[1] >= s[1] - 0.5 and p[3] <= s[3] + 0.5
        out_of_sight = 0
        for i, s in enumerate(steps):
            what = (kind, i, s, steps[i - 1] if i else None)
            if i:
                self.assertTrue(s["draft"], ("the draft went", what))
            p, b, part, st = s["pin"], s["box"], s["part"], s["stage"]
            if s.get("band") and s["band"][1] - s["band"][0] >= 146:  # between the page's own bars (commentLayout's BAND_MIN)
                st = [st[0], st[1] + s["band"][0], st[2], st[1] + s["band"][1]]
            if s.get("out"):  # what was picked (its words, its line) out of sight, the rest of its part maybe not: neither (V6n)
                out_of_sight += 1
                self.assertEqual((p, b), (None, None), ("a pin or box for a part out of sight", what))
                continue
            if part is None:  # not drawn (another slide): its pin away, its box and words kept
                self.assertIsNone(p, ("a pin for a part not drawn", what))
                continue
            whole = part[0] >= st[0] and part[2] <= st[2] and part[1] >= st[1] and part[3] <= st[3]
            gone = part[2] <= st[0] or part[0] >= st[2] or part[3] <= st[1] or part[1] >= st[3]
            if gone:
                out_of_sight += 1
                self.assertEqual((p, b), (None, None), ("a pin or box for a part out of sight", what))
                continue
            self.assertTrue(b, ("no box", what))
            if whole:
                self.assertTrue(p, ("no pin for a part in sight", what))
                self.assertLessEqual(gap(p, part), 26 + 6 + 2, ("pin detached from its part", what))
                prev = steps[i - 1] if i else None
                if prev and prev["part"] and prev["pin"] and i not in zoom and seen(prev["part"], prev["stage"]):
                    dx, dy = part[0] - prev["part"][0], part[1] - prev["part"][1]
                    near_edge = min(part[0] - st[0], st[2] - part[2], part[1] - st[1], st[3] - part[3]) < 60
                    if not near_edge and (abs(dx) + abs(dy)) > 0.5:
                        self.assertLessEqual(abs(p[0] - prev["pin"][0] - dx), 1, ("pin did not move with its part", what))
                        self.assertLessEqual(abs(p[1] - prev["pin"][1] - dy), 1, ("pin did not move with its part", what))
            if p:  # by its pin, or by its part (the pin beside it): 8-24 px, whole px rounded away
                self.assertGreaterEqual(gap(b, p), 8 - 0.01, ("box on its pin", what))
                self.assertLessEqual(min(gap(b, p), gap(b, part) if not gone else 99), 25, ("box not by its pin", gap(b, p), what))
        return steps, out_of_sight

    WHEEL = "await api.wheel(cx, cy, {dx}, {dy}, {ctrl})"

    def moves(self, *spec):
        return [self.WHEEL.format(dx=dx, dy=dy, ctrl="true" if ctrl else "false") for dx, dy, ctrl in spec]

    def test_board_pan_and_zoom(self):
        steps, off = self.follow("board", 'document.querySelector(".bd-it")', '[...document.querySelectorAll(".bd-it")].find(e => e.textContent.includes("Owner"))',
                                 self.moves((80, 0, False), (0, 120, False), (-80, -120, False), (0, -300, True), (0, 300, True), (3000, 0, False), (-3000, 0, False)), zoom=(4, 5))
        self.assertGreater(off, 0, ("never out of sight", steps))

    def test_design_pan_and_zoom(self):
        steps, off = self.follow("design", '__design.boards["Main.dc.html"].el', '__design.boards["Main.dc.html"].el.querySelector("iframe")',
                                 self.moves((80, 0, False), (0, 120, False), (0, -300, True), (0, 300, True), (2500, 0, False), (-2500, 0, False)), zoom=(3, 4))
        self.assertGreater(off, 0, ("never out of sight", steps))

    def test_sheet_scroll_both_ways(self):
        self.follow("sheet", 'document.querySelector("#sh-grid .sh-c")', '[...document.querySelectorAll("#sh-grid .sh-c")].find(c => c.textContent === "Part 3")',
                    self.moves((0, 60, False), (0, -60, False), (0, 1200, False), (0, -1200, False)))  # in sight, then under its headers and back

    def test_doc_scroll(self):
        self.follow("doc", 'document.querySelector(".doc-blk")', 'document.querySelectorAll(".doc-blk")[3]', self.moves((0, 120, False), (0, 200, False), (0, 2000, False), (0, -2320, False)))

    def test_page_scroll_both_ways(self):
        self.follow("page", 'document.querySelector("main")', 'document.getElementById("s4")', self.moves((0, 120, False), (300, 0, False), (0, 1500, False), (-300, -1620, False)))

    def test_dashboard_scroll(self):
        self.follow("dashboard", 'document.querySelector(".c-kpi")', 'document.querySelector(".c-kpi")', self.moves((0, 120, False), (0, 600, False), (0, -720, False)))

    def test_design_system_scroll(self):
        self.follow("design-system", 'document.querySelector(".ds-cover")', 'document.querySelector("#ds-main h2")', self.moves((0, 120, False), (0, 1500, False), (0, -1620, False)))

    def test_a_kept_pin_stays_on_its_design_system_heading(self):
        # An Overview heading picked, a word written, the box closed by a press outside (its pin kept), the page
        # wheeled by 40 and 400 px each way, out of sight and back: the pin keeps its place by its heading while the
        # heading is in sight (V6n: it went [-55.7, -30.6] aside), hidden while it is not, back on it after.
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(self.aids['design-system'])}, SEL = 'document.querySelector(\".ds-cover\")', SETTLE = 2000; await api.size(1250, 764);" + BOOT_ANY + """
          const H = 'document.querySelector("#ds-main h2")'
          const at = await api.frame('(() => { const e = ' + H + '; e.scrollIntoView({ block: "center" }); const q = e.getBoundingClientRect(); return [q.left + 20, q.top + q.height / 2] })()')
          await api.sleep(400)
          await api.top('window.H.M.$picking.set(true)')
          for (let i = 0; i < 100 && await api.top('(() => { const h = document.querySelector("[data-pick-hold]"); return !!h && h.style.display !== "none" })()'); i++) await api.sleep(20)
          let off = await frameAt(); await api.mouse(off[0] + at[0], off[1] + at[1]); await api.sleep(1200)
          await api.type('word'); await api.sleep(200)
          await api.mouse(off[0] + 20, off[1] + 740); await api.sleep(500)
          const now = async move => { const o = await frameAt(), q = await api.frame('(() => { const q = ' + H + '.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom] })()')
            const p = await api.top('(() => { const p = [...document.querySelectorAll("div")].find(d => d.style.zIndex === "28" && d.style.borderRadius === "50%"); if (!p) return null; const b = p.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] })()')
            const d = await api.top('(() => { const d = window.H.M.$draft.get(); return d && { closed: !!d.closed, text: d.text, vt: d.rect && d.rect.vt, vb: d.rect && d.rect.vb } })()')
            return { move, head: [q[0] + o[0], q[1] + o[1], q[2] + o[0], q[3] + o[1]], pin: p, draft: d, stage: o } }
          const steps = [await now('kept')]
          for (const dy of [40, -40, 400, -400, 1600, -1600, 40, -40]) { await api.wheel(off[0] + 600, off[1] + 400, 0, dy, false); await api.sleep(700); steps.push(await now(dy)) }
          return steps""", timeout=300)
        self.assertIsNone(r.get("err"), r)
        steps = r["out"]
        k = steps[0]
        self.assertTrue(k["draft"] and k["draft"]["closed"] and k["draft"]["text"] == "word", k)
        self.assertTrue(k["pin"], ("no pin kept", k))
        rel = (k["pin"][0] - k["head"][2], k["pin"][1] - k["head"][1])  # from the heading's top right
        band = lambda s: (s["stage"][1] + s["draft"]["vt"], s["stage"][1] + s["draft"]["vb"])
        out = back = worst = 0
        for s in steps[1:]:
            t, b = band(s)
            if s["head"][3] <= t or s["head"][1] >= b:  # out of sight: no pin
                out += 1
                self.assertIsNone(s["pin"], ("a pin for a heading out of sight", s))
            elif s["head"][1] >= t and s["head"][3] <= b:  # wholly in sight: by it as kept
                back += out > 0
                self.assertTrue(s["pin"], ("no pin for its heading in sight", s))
                self.assertLessEqual(abs(s["pin"][0] - s["head"][2] - rel[0]), 1, ("pin aside of its heading", rel, s))
                self.assertLessEqual(abs(s["pin"][1] - s["head"][1] - rel[1]), 1, ("pin aside of its heading", rel, s))
                worst = max(worst, abs(s["pin"][0] - s["head"][2] - rel[0]), abs(s["pin"][1] - s["head"][1] - rel[1]))
        self.assertTrue(out and back, ("never out of sight and back", steps))
        print(f"\ndesign-system kept pin: {len(steps) - 1} wheels, {out} out of sight, at most {worst:.1f} px off its place", file=sys.stderr)

    def test_slides_another_slide_and_back(self):
        # the deck's own move to another slide (a press on a thumbnail would only close the open box: the popover)
        nav = "await api.frame('document.querySelectorAll(\"#sl-rail .sl-thumb\")[{i}].click()')"
        steps, _ = self.follow("slides", 'document.querySelector(".sl-clip .sl-canvas h1")', '(window.__part = window.__part || document.querySelector(".sl-clip .sl-canvas h1"))', [nav.format(i=1), nav.format(i=0)])
        self.assertIsNone(steps[1]["pin"], steps)  # another slide: its pin away
        self.assertTrue(steps[2]["pin"], steps)  # back with it

    def test_a_models_point_follows_an_orbit(self):
        # a part of a model picked: its pin on the point of it clicked, wherever an orbit takes that point (the box
        # closed with its words: an orbit's press with the box open only closes it)
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(self.aids['model'])}, SEL = 'document.querySelector(\".md-canvas\")', SETTLE = 2500; await api.size(1250, 764);" + BOOT_ANY + f"""
          const off = await frameAt(), c = await api.frame('(() => {{ const r = document.querySelector(".md-canvas").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }})()')
          await api.top('window.H.M.$picking.set(true)'); await api.sleep(300)
          await api.mouse(off[0] + c[0], off[1] + c[1]); await api.sleep(1200)
          const a = await api.top({json.dumps(DRAFT_NOW)}), label = await api.top('window.H.M.$draft.get().anchor.label')
          // words written, the box closed by a press outside (its pin kept): the orbit's own press reaches the page
          await api.type('a note'); await api.mouse(off[0] + 30, off[1] + c[1] * 2 - 30); await api.sleep(400)
          await api.drag(off[0] + c[0] + 200, off[1] + c[1] + 150, off[0] + c[0] + 320, off[1] + c[1] + 150); await api.sleep(900)
          return {{ a, b: await api.top({json.dumps(DRAFT_NOW)}), label }}""", timeout=240)
        self.assertIsNone(r.get("err"), r)
        o = r["out"]
        self.assertTrue(o["a"]["pin"] and o["b"]["pin"], o)
        self.assertGreater(abs(o["b"]["pin"][0] - o["a"]["pin"][0]) + abs(o["b"]["pin"][1] - o["a"]["pin"][1]), 2, o)


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6hHeldPress(unittest.TestCase):
    """Live round V6h (0440f61), B4: 1 of 22 picks of a deck's title made at once after Comment was lost (no draft,
    picking still armed). The host gave the held press to the page once and forgot it: whatever happened to that
    one replay (the node under the point replaced by a re-render, a frame replaced, the page not picking yet) lost
    it. Now the host keeps it until a pick comes of it, gives it again, and after HOLD_MAX_MS picks the point."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))
        cls.slides = store.publish(path=str(D.ROOT / "examples" / "slides"), title="Test slides", type="slides")["id"]

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    # In the frame: pick-ready said ~250 ms late (the press is held), and the first `n` replays hit nothing there (the
    # node under the point replaced as the deck lays out again); n < 0: none ever does.
    LOSE = ("(n => { const po = MessagePort.prototype.postMessage; MessagePort.prototype.postMessage = function (m, ...r) { if (m && m.event === 'pick-ready') { setTimeout(() => po.call(this, m, ...r), 250); return } return po.call(this, m, ...r) }"
            "; const ef = document.elementFromPoint.bind(document); let k = 0; document.elementFromPoint = (x, y) => (n < 0 || k++ < n) ? null : ef(x, y) })")

    def held(self, n):
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        title = '(() => { const e = document.querySelector(".sl-clip .sl-canvas h1"); const q = e.getClientRects()[0]; return [q.left + 30, q.top + q.height / 2] })()'
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(self.slides)}, SEL = 'document.querySelector(\".sl-clip .sl-canvas h1\")', SETTLE = 1500; await api.size(1250, 764);" + BOOT_ANY + f"""
          await api.frame('(' + {json.dumps(self.LOSE)} + ')({n})')
          const q = await api.frame({json.dumps(title)}), f = await frameAt()
          await api.top('window.H.M.$picking.set(true)')
          const t0 = Date.now(); await api.mouse(f[0] + q[0], f[1] + q[1])
          let d = null
          for (let i = 0; i < 80 && !d; i++) {{ await api.sleep(100); d = await api.top('window.H.M.$draft.get()') }}
          return {{ ms: Date.now() - t0, draft: d, held: await api.top('window.H.M.$pickHeld.get()'), picking: await api.top('window.H.M.$picking.get()') }}""", timeout=180)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_a_held_press_whose_replay_hits_nothing_is_given_again(self):
        o = self.held(2)
        self.assertTrue(o["draft"] and o["draft"]["anchor"], o)
        self.assertIn("Slide", o["draft"]["anchor"]["label"], o)
        self.assertFalse(o["picking"], o)
        self.assertLess(o["ms"], 2500, o)

    def test_a_held_press_the_page_never_answers_is_let_go_picking_on(self):
        # V6p: it was a point comment wherever pressed (a sheet's bar too); what is under it is not known, and only a
        # part the page names is commented on: let go after HOLD_MAX_MS, picking stays on for the next press.
        o = self.held(-1)
        self.assertIsNone(o["draft"], o)
        self.assertTrue(o["picking"], o)
        self.assertIsNone(o["held"], o)

    def test_the_held_ring_stays_until_its_draft_is_drawn(self):
        # V6k: the turning ring went ~20-50 ms before the draft came (the cover hidden as the page said its click
        # picks, the press still held): in no frame is there neither between them.
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        title = '(() => { const e = document.querySelector(".sl-clip .sl-canvas h1"); const q = e.getClientRects()[0]; return [q.left + 30, q.top + q.height / 2] })()'
        out = []
        for _ in range(3):
            r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(self.slides)}, SEL = 'document.querySelector(\".sl-clip .sl-canvas h1\")', SETTLE = 1500; await api.size(1250, 764);" + BOOT_ANY + f"""
              await api.frame('(' + {json.dumps(self.LOSE)} + ')(0)')
              const q = await api.frame({json.dumps(title)}), f = await frameAt()
              await api.top('window.H.M.$picking.set(true)')
              await api.top(`(() => {{ window.__seen = []; const t0 = performance.now(), g = () => {{ const h = document.querySelector('[data-pick-hold]'); window.__seen.push([!!(h && h.style.display !== 'none' && h.querySelector('[role=status]')), !!document.querySelector('textarea')])
                if (performance.now() - t0 < 2500) requestAnimationFrame(g) }}; requestAnimationFrame(g) }})()`)
              await api.mouse(f[0] + q[0], f[1] + q[1]); await api.sleep(2600)
              return await api.top('window.__seen')""", timeout=180)
            self.assertIsNone(r.get("err"), r)
            s = r["out"]
            first = next((i for i, x in enumerate(s) if x[0]), None)
            drawn = next((i for i, x in enumerate(s) if x[1]), None)
            out.append((first, drawn, [x for x in s[first:drawn] if not x[0]] if first is not None and drawn is not None else None))
        for first, drawn, blank in out:
            self.assertIsNotNone(first, out)  # the press was held
            self.assertIsNotNone(drawn, out)
            self.assertEqual(blank, [], out)  # the ring until the draft, no frame of nothing

    def test_a_press_held_while_the_page_loads_shows_its_ring_and_no_loading_words(self):
        # V6k: the press held as the stage still said "Loading…" (the frame's own placeholder, before its page came):
        # the ring at the press with those words across the stage for 2-3 frames. The ring alone says it.
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(self.slides)}; await api.size(1250, 764);" + """
          await api.go(URL, 400)
          for (let i = 0; i < 50 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(100)
          await api.top(`(async () => { const { M, R, jsx, ctx } = window.H; M.$list.set((await ctx.rest('/artifacts')).artifacts)
            R.mount(() => jsx(M.Viewer, { ctx }), document.getElementById('root')) })()`)
          const out = []
          for (let n = 0; n < 6; n++) {
            await api.top('window.H.M.closeArtifact()'); await api.sleep(200)
            await api.top(`(() => { window.__seen = []; const t0 = performance.now(), f = () => { const ring = !!document.querySelector('[data-pick-hold] [role=status]')
              const words = [...document.querySelectorAll('div')].some(e => e.children.length === 0 && (e.textContent || '').trim() === 'Loading…' && e.getBoundingClientRect().width > 400)
              window.__seen.push([ring, words]); if (performance.now() - t0 < 3000) requestAnimationFrame(f) }; window.H.M.openArtifact(window.H.ctx, ${JSON.stringify(AID)}); window.H.M.$picking.set(true); requestAnimationFrame(f) })()`)
            await api.sleep(30)
            await api.mouse(625, 420)
            await api.sleep(3100)
            const s = await api.top('window.__seen')
            out.push({ ring: s.filter(x => x[0]).length, both: s.filter(x => x[0] && x[1]).length })
            await api.top('(() => { window.H.M.$draft.set(null); window.H.M.$picking.set(false) })()')
          }
          return out""", timeout=300)
        self.assertIsNone(r.get("err"), r)
        self.assertTrue(any(o["ring"] for o in r["out"]), ("never held", r["out"]))
        self.assertFalse([o for o in r["out"] if o["both"]], r["out"])

    def test_a_decks_title_and_blank_picked_as_it_opens_never_lost_in_40_opens_each(self):
        # B4's stress: React's passive effects a task later (__passiveMs), pick-ready said 0-300 ms late, the deck fit
        # again (a resize: a font come late) at a random moment after the press; the press at once after Comment, or
        # the moment the stage's cover goes. The title (frame-local 460,430 live) and the slide's blank.
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        title = '(() => { const e = document.querySelector(".sl-clip .sl-canvas h1"); if (!e) return null; const q = e.getClientRects()[0]; return q && q.width ? [q.left + 30, q.top + q.height / 2] : null })()'
        blank = '(() => { const c = document.querySelector(".sl-clip .sl-canvas"); if (!c) return null; const r = c.getBoundingClientRect(); return r.width ? [r.left + r.width * 0.12, r.top + r.height * 0.1] : null })()'
        late = ("(() => { const po = MessagePort.prototype.postMessage; MessagePort.prototype.postMessage = function (m, ...r) { if (m && m.event === 'pick-ready') { setTimeout(() => po.call(this, m, ...r), Math.random() * 300); return } return po.call(this, m, ...r) }"
                "; setTimeout(() => dispatchEvent(new Event('resize')), 50 + Math.random() * 400) })()")
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(self.slides)}, WHERE = [{json.dumps(title)}, {json.dumps(blank)}], LATE = {json.dumps(late)}; await api.size(1250, 764);" + """
          await api.go(URL, 400)
          for (let i = 0; i < 50 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(100)
          await api.top('window.__passiveMs = 100')
          await api.top(`(async () => { const { M, R, jsx, ctx } = window.H; M.$list.set((await ctx.rest('/artifacts')).artifacts)
            M.openArtifact(ctx, ${JSON.stringify(AID)}); R.mount(() => jsx(M.Viewer, { ctx }), document.getElementById('root')) })()`)
          const qs = []
          for (const w of WHERE) { let q = null; for (let i = 0; i < 200 && !q; i++) { try { q = await api.frame(w) } catch (_) {} if (!q) await api.sleep(50) } qs.push(q) }
          const f = await api.top('(() => { const r = document.querySelector("iframe").getBoundingClientRect(); return [r.left, r.top] })()')
          const button = '(() => { const b = [...document.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === "Comment"); if (!b) return null; const q = b.getBoundingClientRect(); return q.width ? [q.left + q.width / 2, q.top + q.height / 2] : null })()'
          const out = []
          for (let n = 0; n < 80; n++) {
            const q = qs[n % 2]
            await api.top('window.H.M.closeArtifact()')
            for (let i = 0; i < 100 && (await api.top('document.querySelectorAll("iframe").length')); i++) await api.sleep(20)
            await api.top(`window.H.M.openArtifact(window.H.ctx, ${JSON.stringify(AID)})`)
            for (let i = 0; i < 200; i++) { try { await api.frame(LATE); break } catch (_) { await api.sleep(5) } }
            let b = null
            for (let i = 0; i < 400 && !b; i++) { b = await api.top(button); if (!b) await api.sleep(5) }
            await api.mouse(b[0], b[1])
            await api.pointer('mouseMoved', f[0] + q[0], f[1] + q[1], false)
            if (n % 4 >= 2) await api.top('new Promise(r => { const h = document.querySelector("[data-pick-hold]"); if (!h || h.style.display === "none") return r(); const mo = new MutationObserver(() => { if (h.style.display === "none") { mo.disconnect(); r() } }); mo.observe(h, { attributes: true }); setTimeout(r, 4000) })')
            await api.pointer('mousePressed', f[0] + q[0], f[1] + q[1], true); await api.pointer('mouseReleased', f[0] + q[0], f[1] + q[1], false)
            let d = null
            for (let i = 0; i < 70 && !d; i++) { d = await api.top('window.H.M.$draft.get()'); if (!d) await api.sleep(100) }
            out.push({ n, what: n % 2 ? 'blank' : 'title', draft: Boolean(d), point: Boolean(d && !d.anchor), picking: await api.top('window.H.M.$picking.get()') })
            await api.top('(() => { window.H.M.$draft.set(null); window.H.M.$picking.set(false) })()')
          }
          return out""", timeout=1500)
        self.assertIsNone(r.get("err"), r)
        out = r["out"]
        self.assertEqual(len(out), 80)
        lost = [o for o in out if not o["draft"] or o["picking"]]
        self.assertFalse(lost, ("picks lost", lost))
        self.assertFalse([o for o in out if o["point"]], ("a pick fell back to the point", out))


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6iPress(unittest.TestCase):
    """Live round V6i (5fd0b90), B1: a deck just opened, Comment, a press 20-90 ms later: 3 of 24 lost, picking left
    armed, nothing held. The page had said its click picks and the cover was gone, but Chromium hit-tested the
    out-of-process frame just revealed as the frame ELEMENT of the host's document (CDP: pointerdown target=IFRAME at
    the top, nothing in the page): neither the page nor the cover saw it. Here that press is made as it arrived live,
    on the stage's iframe element in the host, at each type's part; it ends in a draft within 3 s."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))
        ex = D.ROOT / "examples"
        cls.cases = {
            "slides": (store.publish(path=str(ex / "slides"), title="Test slides", type="slides")["id"], 'document.querySelector(".sl-clip .sl-canvas h1")'),
            "page": (store.publish(title="Test page", type="page", html=LIVE_PAGE)["id"], 'document.querySelector("h1")'),
            "doc": (store.publish(path=str(ex / "doc"), title="Test doc", type="doc")["id"], 'document.querySelector(".doc-blk")'),
            "sheet": (store.publish(title="Costs", type="sheet", files={"sheet.json": {"title": "Costs", "sheets": [{"name": "Costs", "rows": [["Item", "Cost"], ["Panels", 182]]}]}})["id"],
                      # a cell drawn (the grid's first .sh-c is its dropdown's hidden overlay: pressed at its 0 x 0 box,
                      # the frame's corner, the sheet's own bar)
                      'document.querySelector("#sh-grid .sh-c:not([hidden])")'),
        }

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_a_press_the_frame_never_got_ends_in_a_draft(self):
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        for kind, (aid, sel) in self.cases.items():
            r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = {json.dumps(sel)}, SETTLE = 1500; await api.size(1250, 764);" + BOOT_ANY + """
              const q = await api.frame('(() => { const e = ' + SEL + '; const b = e.getClientRects()[0] || e.getBoundingClientRect(); return [b.left + Math.min(20, b.width / 2), b.top + Math.min(10, b.height / 2)] })()')
              await api.top('window.H.M.$picking.set(true)')
              for (let i = 0; i < 100 && await api.top('(() => { const h = document.querySelector("[data-pick-hold]"); return !!h && h.style.display !== "none" })()'); i++) await api.sleep(20)
              const off = await frameAt(), x = off[0] + q[0], y = off[1] + q[1]
              await api.top(`(() => { const f = document.querySelector('[data-frame="shown"] iframe'), o = { bubbles: true, cancelable: true, composed: true, clientX: ${x}, clientY: ${y}, button: 0, pointerId: 1, isPrimary: true }
                for (const [T, t] of [[PointerEvent, 'pointerdown'], [MouseEvent, 'mousedown'], [PointerEvent, 'pointerup'], [MouseEvent, 'mouseup'], [MouseEvent, 'click']]) f.dispatchEvent(new T(t, o)) })()`)
              const t0 = Date.now(); let d = null
              for (let i = 0; i < 35 && !d; i++) { await api.sleep(100); d = await api.top('window.H.M.$draft.get()') }
              return { ms: Date.now() - t0, draft: d, picking: await api.top('window.H.M.$picking.get()') }""", timeout=180)
            self.assertIsNone(r.get("err"), (kind, r))
            o = r["out"]
            self.assertTrue(o["draft"], (kind, "the press was lost", o))
            self.assertTrue(o["draft"].get("anchor"), (kind, "a point, not the part pressed", o))
            self.assertFalse(o["picking"], (kind, o))
            self.assertLess(o["ms"], 3100, (kind, o))


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6pHeldOff(unittest.TestCase):
    """Live round V6p: a press the frame never got (RoundV6iPress), made on the type's chrome or the ground its parts
    lie on (a sheet's bar at the frame's corner, its headers; a deck's pill), became a point comment there after
    HOLD_MAX_MS (3.2 s live), while a press made in the page there picks nothing. The page says it picked nothing
    ("pick-none"): the press is let go at once, no draft, picking stays armed."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(EXPORTS))
        ex = D.ROOT / "examples"
        sheet = store.publish(title="Costs", type="sheet", files={"sheet.json": {"title": "Costs", "sheets": [{"name": "Costs", "rows": [["Item", "Cost"], ["Panels", 182]]}]}})["id"]
        cls.cases = {
            "sheet corner": (sheet, 'document.querySelector("#sh-grid")', '[2, 2]'),
            "sheet header": (sheet, 'document.querySelector("#sh-grid")', '(() => { const e = [...document.querySelectorAll("[data-comment-off]")].find(e => e.getBoundingClientRect().width > 100); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()'),
            "slides pill": (store.publish(path=str(ex / "slides"), title="Test slides", type="slides")["id"], 'document.querySelector(".sl-clip .sl-canvas h1")',
                            '(() => { const b = document.querySelector(".sl-pill-l").getBoundingClientRect(); return [b.left + 4, b.top + b.height / 2] })()'),
        }

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_a_press_the_frame_never_got_on_chrome_picks_nothing_at_once(self):
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        for kind, (aid, sel, where) in self.cases.items():
            r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = {json.dumps(sel)}, WHERE = {json.dumps(where)}, SETTLE = 1500; await api.size(1250, 764);" + BOOT_ANY + """
              const q = await api.frame(WHERE)
              await api.top('window.H.M.$picking.set(true)')
              for (let i = 0; i < 100 && await api.top('(() => { const h = document.querySelector("[data-pick-hold]"); return !!h && h.style.display !== "none" })()'); i++) await api.sleep(20)
              const off = await frameAt(), x = off[0] + q[0], y = off[1] + q[1]
              await api.top(`(() => { window.__let = null; const t0 = performance.now(), un = window.H.M.$pickHeld.listen(v => { if (!v && window.__let == null) window.__let = performance.now() - t0 })
                const f = document.querySelector('[data-frame="shown"] iframe'), o = { bubbles: true, cancelable: true, composed: true, clientX: ${x}, clientY: ${y}, button: 0, pointerId: 1, isPrimary: true }
                for (const [T, t] of [[PointerEvent, 'pointerdown'], [MouseEvent, 'mousedown'], [PointerEvent, 'pointerup'], [MouseEvent, 'mouseup'], [MouseEvent, 'click']]) f.dispatchEvent(new T(t, o)) })()`)
              await api.sleep(3600)
              return { let: await api.top('window.__let'), held: await api.top('window.H.M.$pickHeld.get()'), draft: await api.top('window.H.M.$draft.get()'), picking: await api.top('window.H.M.$picking.get()'),
                ring: await api.top('!!document.querySelector("[data-pick-hold] [role=status]")') }""", timeout=180)
            self.assertIsNone(r.get("err"), (kind, r))
            o = r["out"]
            self.assertIsNone(o["draft"], (kind, "a comment on chrome", o))
            self.assertTrue(o["picking"], (kind, "picking ended", o))
            self.assertIsNone(o["held"], (kind, o))
            self.assertFalse(o["ring"], (kind, o))
            self.assertIsNotNone(o["let"], (kind, o))
            self.assertLess(o["let"], 1000, (kind, "let go only by the 3 s fallback", o))


if __name__ == "__main__":
    unittest.main()
