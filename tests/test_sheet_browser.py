"""A sheet in a real browser (headless Chrome, driven from node; skipped without them).

Round 3 and 4 of the 0.20.0 acceptance: a sort or an inserted or deleted row could not be undone and wiped the
undo history; the error bar showed once on open and never followed the count; the toolbar re-laid itself out as the
selection moved (Insert, Sort, Freeze jumped ~110 px); a restored state drew a broken grid until reopened."""

import json
import re
import unittest

import _browser as B

READY = "await api.sleep(300); for (let i = 0; i < 60; i++) { if (await api.top('window.__events.some(e => e.event === \"ready\")')) break; await api.sleep(150) }"
# helpers in the driver: a toolbar button by its title (English or Hungarian), a menu item by its place, the
# sheet as the server holds it, the A column as the server holds it
HELP = r"""
  const btn = async re => { const r = await api.frame('(() => { const b = [...document.querySelectorAll("#sh-bar button")].find(b => ' + re + '.test(b.title) && b.offsetParent); if (!b) return null; const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2] })()'); if (!r) throw new Error('no button ' + re); await api.mouse(r[0], r[1]); await api.sleep(400) }
  const item = async i => { const r = await api.frame('(() => { const bs = [...document.querySelectorAll(".kit-menu button")]; const b = bs[' + i + ' < 0 ? bs.length + ' + i + ' : ' + i + ']; if (!b) return null; const q = b.getBoundingClientRect(); return [q.left + 24, q.top + q.height / 2] })()'); if (!r) throw new Error('no menu item ' + i); await api.mouse(r[0], r[1]); await api.sleep(300) }
  const server = () => api.top('fetch("/op/" + location.pathname.split("/")[2], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "sheet.read", args: {} }) }).then(r => r.json())')
  const colA = async () => { const r = await server(); const out = []; for (let i = 0; i < 8; i++) { const row = (r.rows || [])[i]; out.push(row && row[0] != null && row[0] !== "" ? row[0] : null) } return { a: out, charts: (r.charts || []).length, rev: r.rev } }
  const cellAt = async t => { const r = await api.frame('(() => { const c = [...document.querySelectorAll("#sh-grid .sh-c")].find(x => x.textContent.trim() === ' + JSON.stringify(t) + '); if (!c) return null; const b = c.getBoundingClientRect(); return [b.left + 8, b.top + b.height / 2] })()'); if (!r) throw new Error('no cell ' + t); await api.mouse(r[0], r[1]); await api.sleep(200) }
  const settle = async () => { for (let i = 0; i < 40; i++) { await api.sleep(250); if (await api.frame('!document.querySelector(".sh-status") || !/Ment|Sav/.test(document.querySelector(".sh-status").textContent) || /Elmentve|Saved/.test(document.querySelector(".sh-status").textContent)')) break } await api.sleep(600) }
  const undoOn = () => api.frame('[...document.querySelectorAll("#sh-bar button")].filter(b => /^(Undo|Visszavonás|Redo|Mégis)$/.test(b.title)).map(b => !b.disabled)')
"""


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class SheetInTheBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store, sheets
        cls.store, cls.sheets = store, sheets
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def pub(self, rows, charts=None, extra=None):
        sh = {"name": "Costs", "rows": rows}
        if charts:
            sh["charts"] = charts
        return self.store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [sh] + (extra or [])}})["id"]

    def run_page(self, aid, body, w=1500):
        r = B.drive(f"await api.size({w}, 800); await api.go({json.dumps(self.host.url(aid))}, 800); {READY}\n await api.sleep(1500)\n" + HELP + body)
        self.assertIsNone(r.get("err"), r)
        self.assertEqual(r.get("logs"), [], r.get("logs"))
        return r["out"]

    def test_structural_edits_are_undo_steps_and_keep_the_history(self):
        rows = [["Item", "Cost"], ["Bolts", 3], ["Anchors", 9], ["Clamps", 5], ["Rails", 24]]
        aid = self.pub(rows, charts=[{"type": "bar", "range": "A1:B5", "at": "D2"}])
        o = self.run_page(aid, """
          const out = {}
          await cellAt('Bolts'); await btn('/^(Sort|Rendezés)$/'); await item(0); await settle()
          out.sorted = await colA(); out.u1 = await undoOn()
          await cellAt('Clamps'); await btn('/^(Insert and delete|Beszúrás és törlés)$/'); await item(0); await settle()   // a row above
          out.inserted = await colA()
          await cellAt('Rails'); await btn('/^(Insert and delete|Beszúrás és törlés)$/'); await item(-2); await settle()   // delete the row
          out.deleted = await colA()
          await btn('/^(Undo|Visszavonás)$/'); await settle(); out.undo1 = await colA()
          await btn('/^(Undo|Visszavonás)$/'); await settle(); out.undo2 = await colA()
          await btn('/^(Undo|Visszavonás)$/'); await settle(); out.undo3 = await colA(); out.u2 = await undoOn()
          await btn('/^(Redo|Mégis)$/'); await settle(); out.redo1 = await colA()
          // a chart: added, undone, redone
          await btn('/^(Undo|Visszavonás)$/'); await settle()
          await api.frame('document.querySelector(".sh-chart .kit-btn").click()'); await api.sleep(300); await item(-1); await settle()
          out.chartGone = await colA()
          await btn('/^(Undo|Visszavonás)$/'); await settle(); out.chartBack = await colA()
          await btn('/^(Redo|Mégis)$/'); await settle(); out.chartGoneAgain = await colA()
          await btn('/^(Undo|Visszavonás)$/'); await settle(); out.chartBackAgain = await colA()
          return out
        """)
        orig = ["Item", "Bolts", "Anchors", "Clamps", "Rails", None, None, None]
        self.assertEqual(o["sorted"]["a"], ["Item", "Anchors", "Bolts", "Clamps", "Rails", None, None, None])
        self.assertEqual(o["u1"], [True, False])
        self.assertEqual(o["inserted"]["a"], ["Item", "Anchors", "Bolts", None, "Clamps", "Rails", None, None])
        self.assertEqual(o["deleted"]["a"], ["Item", "Anchors", "Bolts", None, "Clamps", None, None, None])
        self.assertEqual(o["undo1"]["a"], o["inserted"]["a"])
        self.assertEqual(o["undo2"]["a"], o["sorted"]["a"])
        self.assertEqual(o["undo3"]["a"], orig)
        self.assertEqual(o["u2"], [False, True])
        self.assertEqual(o["redo1"]["a"], o["sorted"]["a"])
        self.assertEqual([o[k]["charts"] for k in ("chartGone", "chartBack", "chartGoneAgain", "chartBackAgain")], [0, 1, 0, 1])
        self.assertEqual(o["chartBackAgain"]["a"], orig)

    def test_the_error_bar_follows_the_count(self):
        aid = self.pub([["Item", "Cost"], ["Bolts", 3], ["Anchors", 9]])
        sid = self.sheets.load(aid)["sheets"][0]["id"]

        def hermes(ops):
            return lambda: self.sheets.apply(aid, ops, by="hermes", sheet=sid, base_rev=self.sheets.load(aid)["sheets"][0]["rev"])
        self.host.hooks["one"] = hermes([{"op": "set", "range": "C2", "values": [["=1/0"]]}])
        self.host.hooks["two"] = hermes([{"op": "set", "range": "C3", "values": [["=2/0"]]}])
        self.host.hooks["none"] = hermes([{"op": "clear", "range": "C2:C3"}])
        bar = "(() => { const b = document.querySelector('.sh-errbar'); return b && !b.hidden ? b.querySelector('span').textContent : null })()"
        o = self.run_page(aid, """
          const out = {}, bar = () => api.frame(%s)
          const step = async (name, k) => { await api.top('fetch("/hook/' + name + '")'); for (let i = 0; i < 100; i++) { await api.sleep(300); if ((await bar()) !== k) break } return await bar() }
          out.start = await bar()
          out.one = await step('one', null)
          for (let i = 0; i < 40 && !out.one; i++) { await api.sleep(300); out.one = await bar() }
          out.two = await step('two', out.one)
          out.none = await step('none', out.two)
          return out
        """ % json.dumps(bar))
        self.assertIsNone(o["start"])
        self.assertIn("1", o["one"] or "")
        self.assertIn("2", o["two"] or "")
        self.assertIsNone(o["none"])

    def test_the_toolbar_keeps_its_places_and_the_callout_stays_in_view(self):
        aid = self.pub([["Item", "Cost", None, None, None, None, None, None, None, None, None, None, "=1/0"], ["Bolts", 3]])
        o = self.run_page(aid, """
          const pos = () => api.frame('[...document.querySelectorAll("#sh-bar button")].filter(b => b.offsetParent).map(b => b.title + "@" + Math.round(b.getBoundingClientRect().left))')
          const out = {}
          await cellAt('Bolts'); out.filled = await pos()
          await api.frame('(() => { const g = document.getElementById("sh-grid"); g.focus() })()')
          await api.key('ArrowDown', 'ArrowDown', 40); await api.key('ArrowDown', 'ArrowDown', 40); await api.sleep(300); out.empty = await pos()
          await cellAt('3'); out.number = await pos()
          // the error cell far right: its callout inside the frame; scrolled away: no callout
          await api.size(400, 800); await api.sleep(600)
          await api.frame('(() => { const g = document.getElementById("sh-grid"); g.scrollLeft = 900 })()'); await api.sleep(400)
          await cellAt('#DIV/0!'); await api.sleep(500)
          out.tip = await api.frame('(() => { const t = document.querySelector(".sh-errtip"); if (t.hidden) return null; const r = t.getBoundingClientRect(); return [r.left, r.right, innerWidth] })()')
          await api.frame('document.getElementById("sh-grid").scrollLeft = 0'); await api.sleep(150)
          await api.size(420, 800); await api.sleep(600)   // laid out again with the active cell scrolled away
          out.tipAway = await api.frame('document.querySelector(".sh-errtip").hidden')
          out.hermesIcons = await api.frame('[...document.querySelectorAll("#sh-bar button")].filter(b => b.offsetParent && b.innerHTML.includes("M12 6v15")).length')
          return out
        """)
        self.assertEqual(o["filled"], o["empty"])
        self.assertEqual(o["filled"], o["number"])
        self.assertIsNotNone(o["tip"])
        self.assertGreaterEqual(o["tip"][0], 8)
        self.assertLessEqual(o["tip"][1], o["tip"][2] - 8)
        self.assertTrue(o["tipAway"])
        self.assertLessEqual(o["hermesIcons"], 1)

    def test_a_restored_state_draws_as_a_fresh_open(self):
        aid = self.pub([["Item", "Qty", "Price", "Total"]])
        sid = self.sheets.load(aid)["sheets"][0]["id"]
        self.sheets.apply(aid, [{"op": "set", "range": "A2", "values": [["Notebook", 5, 4.5, "=B2*C2"], ["Pen", 12, 1.25, "=1/0"]]},
                                {"op": "col_width", "col": "A", "w": 200}, {"op": "freeze", "rows": 1, "cols": 0},
                                {"op": "add_chart", "type": "bar", "range": "A1:B3", "title": "Qty", "at": "F2"}],
                          by="hermes", sheet=sid, base_rev=self.sheets.load(aid)["sheets"][0]["rev"])
        sig = r"""(() => ({
          cells: [...document.querySelectorAll("#sh-grid .sh-c")].filter(c => c.style.display !== "none" && c.textContent).map(c => { const b = c.getBoundingClientRect(); return Math.round(b.left) + "," + Math.round(b.top) + ":" + c.textContent }).sort(),
          charts: [...document.querySelectorAll(".sh-chart")].map(c => { const b = c.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top)] }),
          bar: (b => b && !b.hidden ? b.textContent : null)(document.querySelector(".sh-errbar")),
          panes: [...document.querySelectorAll("#sh-grid .sh-vp > div")].filter(d => d.style.display !== "none").map(d => d.style.cssText).sort() }))()"""
        o = self.run_page(aid, """
          await btn('/^(History|Előzmények)$/'); await api.sleep(600); await item(-1); await api.sleep(1200)
          await api.frame('[...document.querySelectorAll(".sh-preview button")][0].click()'); await settle(); await api.sleep(800)
          return await api.frame(%s)
        """ % json.dumps(sig))
        fresh = self.run_page(aid, "return await api.frame(%s)" % json.dumps(sig))
        self.assertEqual(o, fresh)
        self.assertEqual(sorted(c.split(":", 1)[1] for c in fresh["cells"]), ["Item", "Price", "Qty", "Total"])
        self.assertEqual(fresh["charts"], [])
        self.assertIsNone(fresh["bar"])

    def test_a_drag_held_at_or_past_an_edge_scrolls_and_grows_the_selection(self):
        # V6: a selection dragged to the grid's right or bottom edge and held there did not scroll (only the last
        # 4 px or the scrollbar did, at one speed)
        def col(c):
            s = ""
            c += 1
            while c:
                c, m = divmod(c - 1, 26)
                s = chr(65 + m) + s
            return s
        aid = self.pub([[f"{col(c)}{r + 1}" for c in range(40)] for r in range(200)])
        # the pane's box, its scroll, the name box, the last column and row in sight, and how far any cell in
        # sight sits from its column letter and row number
        probe = r"""(() => {
          const g = document.getElementById("sh-grid"), v = g.querySelector(".sh-vp").getBoundingClientRect()
          const shown = e => { const b = e.getBoundingClientRect(); return e.offsetParent && b.left + b.width / 2 > v.left && b.left + b.width / 2 < v.right && b.top + b.height / 2 > v.top && b.top + b.height / 2 < v.bottom }
          const ci = t => [...t].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
          const cols = {}, rows = {}
          document.querySelectorAll("#sh-grid .sh-h.col").forEach(h => { if (shown(h)) cols[h.textContent.trim()] = h.getBoundingClientRect() })
          document.querySelectorAll("#sh-grid .sh-h.row").forEach(h => { if (shown(h)) rows[h.textContent.trim()] = h.getBoundingClientRect() })
          let n = 0, off = 0
          document.querySelectorAll("#sh-grid .sh-c").forEach(c => {
            const m = /^([A-Z]+)(\d+)$/.exec(c.textContent.trim()); if (!m || !shown(c) || !cols[m[1]] || !rows[m[2]]) return
            const b = c.getBoundingClientRect(); n++
            off = Math.max(off, Math.abs(b.left - cols[m[1]].left), Math.abs(b.top - rows[m[2]].top))
          })
          return { l: v.left, t: v.top, r: v.right, b: v.bottom, iw: innerWidth, ih: innerHeight, sl: g.scrollLeft, st: g.scrollTop,
            sel: document.querySelector(".sh-name").value, lastCol: Math.max(...Object.keys(cols).map(ci)), lastRow: Math.max(...Object.keys(rows).map(Number)), n, off }
        })()"""
        o = self.run_page(aid, """
          const out = {}, geo = () => api.frame(%s)
          const hold = async (x, y) => { await api.pointer('mouseMoved', x, y, true); await api.sleep(700) }
          const at = t => api.frame('(() => { const c = [...document.querySelectorAll("#sh-grid .sh-c, #sh-grid .sh-h.row")].find(x => x.textContent.trim() === ' + JSON.stringify(t) + '); const b = c.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()')
          out.start = await geo()
          const s = out.start, p = await at('C3')
          await api.pointer('mouseMoved', p[0], p[1], false); await api.pointer('mousePressed', p[0], p[1], true)
          for (let i = 1; i <= 6; i++) await api.pointer('mouseMoved', p[0] + (s.r - 30 - p[0]) * i / 6, p[1], true)
          await hold(s.r - 8, p[1]); out.nearRight = await geo()
          await hold(Math.min(s.r + 12, s.iw - 1), p[1]); out.right = await geo()
          await hold(s.r - 30, s.b - 8); out.nearBottom = await geo()
          await hold(s.r - 30, Math.min(s.b + 12, s.ih - 1)); out.bottom = await geo()
          await api.pointer('mouseReleased', s.r - 30, Math.min(s.b + 12, s.ih - 1), false); await api.sleep(150); out.released = await geo()
          await api.sleep(600); out.after = await geo()
          // a row number dragged down past the bottom: the rows follow
          await api.frame('document.getElementById("sh-grid").scrollTop = 0'); await api.sleep(300)
          const q = await at('5')
          await api.pointer('mouseMoved', q[0], q[1], false); await api.pointer('mousePressed', q[0], q[1], true)
          await api.pointer('mouseMoved', q[0], s.b - 10, true); await hold(q[0], Math.min(s.b + 12, s.ih - 1)); out.rows = await geo()
          await api.pointer('mouseReleased', q[0], Math.min(s.b + 12, s.ih - 1), false); await api.sleep(150)
          return out
        """ % json.dumps(probe), w=900)
        s, nr, right, nb, bottom = o["start"], o["nearRight"], o["right"], o["nearBottom"], o["bottom"]
        end = lambda g: re.match(r"C3:([A-Z]+)(\d+)$", g["sel"]).groups()
        ci = lambda t: sum((ord(ch) - 64) * 26 ** i for i, ch in enumerate(reversed(t)))
        self.assertEqual((s["sl"], s["st"]), (0, 0), s)
        self.assertGreater(nr["sl"], 0, nr)                                   # held at the right edge: it scrolled
        self.assertGreater(ci(end(nr)[0]), s["lastCol"], nr)                  # and the selection took columns out of sight before
        self.assertGreater(right["sl"], nr["sl"], right)                      # past it: on
        self.assertGreater(ci(end(right)[0]), ci(end(nr)[0]), right)
        self.assertGreater(nb["st"], 0, nb)                                   # at the bottom
        self.assertGreater(int(end(nb)[1]), s["lastRow"], nb)
        self.assertGreater(bottom["st"], nb["st"], bottom)                    # past it
        self.assertGreater(int(end(bottom)[1]), int(end(nb)[1]), bottom)
        for g in (s, nr, right, nb, bottom, o["after"]):
            self.assertGreater(g["n"], 10, g)
            self.assertLessEqual(g["off"], 1, g)                              # every cell under its letter and number
        self.assertEqual((o["released"]["sl"], o["released"]["st"]), (o["after"]["sl"], o["after"]["st"]))   # let go: it stops
        self.assertEqual(o["after"]["sel"], o["released"]["sel"])
        self.assertGreater(o["rows"]["st"], 0, o["rows"])
        self.assertRegex(o["rows"]["sel"], r"^A5:[A-Z]+\d+$")
        self.assertGreater(int(re.search(r"(\d+)$", o["rows"]["sel"]).group(1)), s["lastRow"], o["rows"])


if __name__ == "__main__":
    unittest.main()
