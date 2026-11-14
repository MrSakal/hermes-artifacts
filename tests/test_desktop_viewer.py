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

EXPORTS = "\nexport { Viewer, openArtifact, $list, $panel, $panelHere, $picking, $panelShown, STRINGS }\n"
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


if __name__ == "__main__":
    unittest.main()
