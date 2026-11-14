"""A sheet in a real browser (headless Chrome, driven from node; skipped without them).

Round 3 and 4 of the 0.20.0 acceptance: a sort or an inserted or deleted row could not be undone and wiped the
undo history; the error bar showed once on open and never followed the count; the toolbar re-laid itself out as the
selection moved (Insert, Sort, Freeze jumped ~110 px); a restored state drew a broken grid until reopened."""

import json
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


if __name__ == "__main__":
    unittest.main()
