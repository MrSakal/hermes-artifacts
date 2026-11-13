"""The in-frame pages in a real browser (headless Chrome, driven from node): looking is never editing.

(a) A doc in comment-pick mode: clicking a block sends the host "picked" and makes no edit; the stored doc is
    byte-identical after (the 0.19.0 acceptance run saw a pick turn a plain bullet beside two checklist items
    into a checklist item, saved).
(b) The editor reads a list back as it was written: plain bullets beside checklist items, nested, ordered,
    ordered checklist items (load -> Markdown -> load again changes nothing).
(c) Opening a live page (doc, sheet, board, slides), clicking, selecting, a theme switch and closing it
    leaves every stored file byte-identical.
Skipped without Chrome or node. Starts its own Chrome and a host on free ports."""

import json
import unittest
from pathlib import Path

import _browser as B

ROOT = Path(__file__).resolve().parent.parent
EX = ROOT / "examples"

READY = "await api.sleep(300); for (let i = 0; i < 60; i++) { if (await api.top('window.__events.some(e => e.event === \"ready\")')) break; await api.sleep(150) }"
THEME = {"mode": "dark", "vars": {"bg": "rgb(31, 31, 30)", "fg": "rgb(236, 235, 230)", "accent": "rgb(217, 119, 87)",
                                   "line": "rgb(58, 57, 54)", "panel": "rgb(38, 38, 36)", "elevated": "rgb(38, 38, 36)"}}


def edits(ops):
    return [o for o in ops if o["op"] in ("doc.edit", "doc.suggest", "sheet.edit", "board.edit", "save", "history.restore",
                                           "doc.restore", "sheet.restore", "board.restore")]


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class LookingIsNotEditing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def run_page(self, aid, body, theme=None):
        r = B.drive(f"await api.go({json.dumps(self.host.url(aid, theme=theme))}, 800); {READY}\n" + body)
        self.assertIsNone(r.get("err"), r)
        return r

    def test_a_pick_in_a_doc_never_edits(self):
        aid = self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        before = self.warm(aid, "doc.read")
        r = self.run_page(aid, """
          await api.sleep(800)
          await api.top('window.__post("comment-mode", {on: true})'); await api.sleep(200)
          const find = t => '[...document.querySelectorAll(".doc-blk li")].find(x => x.firstChild && x.firstChild.textContent.trim() === ' + JSON.stringify(t) + ')'
          await api.clickIn(find('A request for a quote arrives')); await api.sleep(300)
          const focus = await api.frame('document.activeElement && document.activeElement.className')
          await api.top('window.__post("comment-mode", {on: false})')
          // the host's comment form takes the focus: whatever the pick focused is left (that is when a block saves)
          await api.frame('document.activeElement && document.activeElement.blur && document.activeElement.blur()')
          await api.sleep(1500)  // a save waits 700 ms for a pause
          await api.go('about:blank', 1200)
          return { focus }
        """, theme=THEME)
        out = r["out"]
        self.assertEqual(B.snapshot(aid), before, "a pick changed the stored doc")
        self.assertNotIn("doc-blk", str(out["focus"] or ""), "the pick focused the editor")

    def test_a_pick_reports_and_makes_no_edit_op(self):
        aid = self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        r = self.run_page(aid, """
          await api.sleep(800)
          await api.top('window.__post("comment-mode", {on: true})'); await api.sleep(200)
          await api.clickIn('[...document.querySelectorAll(".doc-blk li")].find(x => x.firstChild && x.firstChild.textContent.trim() === "A request for a quote arrives")')
          await api.frame('document.activeElement && document.activeElement.blur && document.activeElement.blur()')
          await api.sleep(1500)
          return await api.top('({ ops: window.__ops, picked: window.__events.filter(e => e.event === "picked").map(e => e.detail.text) })')
        """)
        out = r["out"]
        self.assertEqual(edits(out["ops"]), [], out["ops"])
        self.assertEqual(len(out["picked"]), 1, out)
        self.assertIn("A request for a quote arrives", out["picked"][0])

    def test_lists_read_back_as_written(self):
        aid = self.store.publish(path=str(EX / "doc"), title="Lists", type="doc")["id"]
        cases = [
            "1. A request for a quote arrives\n2. Site survey\n   - photos, measurements\n   - [x] request the structural data\n   - [ ] pricing\n3. Send the quote",
            "- plain\n- [ ] open\n- [x] done\n- plain again",
            "- [ ] first\n- second",
            "- a\n  - [x] b\n    - c\n    - [ ] d\n  - e",
            "1. [ ] ordered task\n2. ordered plain",
            "- [x] **bold** done\n- *em* plain",
        ]
        r = self.run_page(aid, "await api.sleep(500); return await api.frame(" + json.dumps(
            "(" + json.dumps(cases) + ").map(s => { const d = document.createElement('div');"
            " d.innerHTML = md.html(md.parse(s), null, { live: true }); return docEdit.toMd(d) })") + ")")
        self.assertEqual(r["out"], cases)

    def warm(self, aid, op):
        """The live state as the server keeps it once a page has read it (it is made at the first read)."""
        if op:
            self.host.api.handle("POST", f"/artifacts/{aid}/op", {}, {"op": op, "args": {}})
        return B.snapshot(aid)

    def _idle(self, aid, op, actions="", settle=False, exports=()):
        if settle:  # a sheet hands the server its computed values once (sheet.vals: no rev, no edit); from then on, nothing
            self.run_page(aid, "await api.sleep(2500); await api.go('about:blank', 500)")
        before = self.warm(aid, op)
        dark = "await api.top(" + json.dumps("window.__post('theme', " + json.dumps(THEME) + ")") + ")\n"
        # exports, as the host's title menu sends them (each makes a download, never an edit)
        exp = "".join("await api.top(" + json.dumps("window.__post('export', {id: '%s'})" % x) + "); await api.sleep(1500);\n" for x in exports)
        r = self.run_page(aid, "await api.sleep(1200);\n" + actions + exp + dark + """
          await api.sleep(300)
          await api.top('window.__post("theme", {mode: "light", vars: {bg: "rgb(250, 249, 245)", fg: "rgb(20, 20, 19)", accent: "rgb(201, 100, 66)"}})')
          await api.sleep(1500)
          const ops = await api.top('window.__ops')
          await api.go('about:blank', 1500)
          return { ops }
        """)
        self.assertEqual(edits(r["out"]["ops"]), [], r["out"]["ops"])
        self.assertEqual(len([o for o in r["out"]["ops"] if o["op"] == "download"]), len(exports), [o["op"] for o in r["out"]["ops"]])
        after = B.snapshot(aid)
        self.assertEqual(sorted(after), sorted(before))
        for k in before:
            self.assertEqual(after[k], before[k], k)

    def test_a_doc_opened_clicked_and_closed_is_unchanged(self):
        aid = self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        self._idle(aid, "doc.read", """
          for (const t of ['A request for a quote arrives', 'photos, measurements', 'pricing']) {
            await api.clickIn('[...document.querySelectorAll(".doc-blk li")].find(x => [...x.childNodes].filter(n => !/^(UL|OL)$/.test(n.tagName)).map(n => n.textContent).join("").trim() === ' + JSON.stringify(t) + ')')
            await api.sleep(250)
          }
          await api.clickIn('document.querySelector(".doc-blk table td")'); await api.sleep(250)
          await api.frame('(() => { const p = document.querySelector(".doc-blk p"); const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r); })()')
          await api.sleep(400)
          await api.clickIn('document.querySelector(".doc-blk h1")'); await api.sleep(300)
        """, exports=("md", "html", "docx"))

    def test_a_sheet_opened_clicked_and_closed_is_unchanged(self):
        aid = self.store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [
            {"name": "Budget", "rows": [["Item", "Cost", "Qty", "Total"], ["Panels", 182, 1240, "=B2*C2"], ["Rails", 24, 3100, "=B3*C3"],
                                        ["Total", None, None, "=SUM(D2:D3)"]],
             "formats": {"A1:D1": {"bold": True}, "B2:B3": {"num": "$#,##0"}}}]}})["id"]
        self._idle(aid, "sheet.read", """
          const cell = (r, c) => '[...document.querySelectorAll("div")].find(x => !x.children.length && x.textContent.trim() === ' + JSON.stringify(r) + ')'
          await api.clickIn(cell('Panels')); await api.sleep(250)
          await api.clickIn(cell('Rails')); await api.sleep(250)
          await api.key('ArrowDown', 'ArrowDown', 40); await api.sleep(250)
        """, settle=True, exports=("xlsx", "csv"))

    def test_a_board_opened_clicked_and_closed_is_unchanged(self):
        aid = self.store.publish(title="Flow", type="board", files={"board.json": {"title": "Flow", "items": [
            {"id": "a", "type": "box", "text": "Survey"}, {"id": "b", "type": "box", "text": "Order"},
            {"type": "arrow", "from": "a", "to": "b"}, {"type": "note", "text": "Six weeks", "near": "b"}]}})["id"]
        self._idle(aid, "board.read", """
          await api.mouse(600, 400); await api.sleep(300)
          await api.mouse(300, 300); await api.sleep(300)
        """)

    def test_slides_opened_clicked_and_closed_are_unchanged(self):
        aid = self.store.publish(path=str(EX / "slides"), title="Deck", type="slides")["id"]
        self._idle(aid, None, """
          await api.mouse(600, 400); await api.sleep(300)
          await api.key('ArrowRight', 'ArrowRight', 39); await api.sleep(300)
          await api.key('ArrowLeft', 'ArrowLeft', 37); await api.sleep(300)
        """, exports=("png", "html"))


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class CardPictures(unittest.TestCase):
    """Slides and motion draw the gallery card's picture once per version (preview.set): a PNG of at most
    400 KB the card shows instead of loading the whole page. Not again once one is kept."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def picture_ops(self, aid):
        r = B.drive(f"await api.go({json.dumps(self.host.url(aid))}, 800); {READY}\n await api.sleep(5000);"
                    " return await api.top('window.__ops.filter(o => o.op === \"preview.set\").map(o => [o.args.data.slice(0, 22), o.args.data.length, o.args.version])')")
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def check(self, aid):
        first = self.picture_ops(aid)
        self.assertEqual(len(first), 1, first)
        self.assertEqual(first[0][0], "data:image/png;base64,")
        self.assertLessEqual(first[0][1] * 0.75, 400 * 1024)
        self.assertEqual(first[0][2], 1)
        self.assertTrue(self.store.preview_get(aid, 1))
        self.assertEqual(self.picture_ops(aid), [])  # kept: not drawn again

    def test_slides(self):
        self.check(self.store.publish(path=str(EX / "slides"), title="Deck", type="slides")["id"])

    def test_motion(self):
        self.check(self.store.publish(path=str(EX / "motion"), title="Film", type="motion")["id"])


LONG_PAGE = ("<!doctype html><meta charset=utf-8><style>body{margin:0;font:16px system-ui}p{margin:0;padding:12px 16px;height:60px}"
             "label{display:block;padding:12px 16px}</style><label><input type=checkbox id=c> Anchor points checked</label>"
             + "".join(f"<p id=p{i}>Paragraph {i}</p>" for i in range(60)))


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class PickInThePage(unittest.TestCase):
    """The comment pick in a page: the picked element's rect follows a scroll at most every 40 ms and only
    while its comment is open (the host's pick-follow off ends it); a finger's tap picks too and leaves the
    page's own controls alone."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()
        cls.aid = store.publish(title="Long page", type="page", html=LONG_PAGE)["id"]

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def run_page(self, body):
        r = B.drive(f"await api.go({json.dumps(self.host.url(self.aid))}, 800); {READY}\n" + body)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_the_rect_follows_while_the_comment_is_open_and_then_stops(self):
        out = self.run_page("""
          const n = () => api.top('window.__events.filter(e => e.event === "picked-rect").length')
          await api.top('window.__post("comment-mode", {on: true})'); await api.sleep(200)
          await api.clickIn('document.getElementById("p20")')
          await api.top('window.__post("comment-mode", {on: false})'); await api.sleep(100)
          const picked = await api.top('window.__events.filter(e => e.event === "picked").length')
          const t0 = Date.now(), start = await n()
          for (let i = 0; i < 40; i++) { await api.frame('scrollBy(0, 7)'); await api.sleep(5) }
          await api.sleep(200)
          const ms = Date.now() - t0, during = (await n()) - start
          const last = await api.top('window.__events.filter(e => e.event === "picked-rect").pop().detail.rect.y')
          const real = await api.frame('document.getElementById("p20").getBoundingClientRect().top')
          await api.top('window.__post("pick-follow", {on: false})'); await api.sleep(100)
          const stopped = await n()
          for (let i = 0; i < 10; i++) { await api.frame('scrollBy(0, 9)'); await api.sleep(30) }
          await api.sleep(200)
          return { picked, during, ms, last, real, after: (await n()) - stopped }
        """)
        self.assertEqual(out["picked"], 1, out)
        self.assertGreater(out["during"], 0, out)
        self.assertLessEqual(out["during"], out["ms"] / 40 + 2, out)  # at most one every 40 ms (40 scrolls in a row)
        self.assertAlmostEqual(out["last"], out["real"], delta=1)  # the last one is where the element ended up
        self.assertEqual(out["after"], 0, out)  # the comment closed: nothing more

    def test_a_tap_picks_and_does_not_toggle_the_page(self):
        out = self.run_page("""
          await api.top('window.__post("comment-mode", {on: true})'); await api.sleep(200)
          const r = await api.frame('(() => { const b = document.querySelector("label").getBoundingClientRect(); return [b.left + 120, b.top + b.height / 2] })()')
          await api.tap(r[0], r[1]); await api.sleep(400)
          return { picked: await api.top('window.__events.filter(e => e.event === "picked").map(e => e.detail.label)'),
                   checked: await api.frame('document.getElementById("c").checked') }
        """)
        self.assertEqual(out["picked"], ["label"], out)
        self.assertFalse(out["checked"], out)


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class FocusOnWholeSurfaces(unittest.TestCase):
    """Keyboard focus on a whole surface (a sheet's grid, a film's timeline) draws no kit ring round it: the
    grid shows its active cell, the timeline its own 2 px ring; a control still gets the kit's 3 px one."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def ring(self, aid, sel, then=None, key=("Shift", "ShiftLeft", 16)):
        """Click `sel` (it takes the focus), press `key` (the focus is now the keyboard's; in a sheet's grid only
        a key it acts on counts), optionally move the focus to `then` by script (still the keyboard's):
        [:focus-visible, box-shadow] of where it is."""
        probe = json.dumps("(() => { const el = " + (then or sel) + "; return [el === document.activeElement && el.matches(':focus-visible'),"
                           " getComputedStyle(el).boxShadow] })()")
        r = B.drive(f"await api.go({json.dumps(self.host.url(aid, theme=THEME))}, 800); {READY}\n await api.sleep(600)\n"
                    f"await api.clickIn({json.dumps(sel)}); await api.key({json.dumps(key[0])}, {json.dumps(key[1])}, {key[2]}); await api.sleep(150)\n"
                    + (f"await api.frame({json.dumps(then + '.focus()')}); await api.sleep(100)\n" if then else "")
                    + f"return await api.frame({probe})")
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_the_sheet_grid(self):
        aid = self.store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [
            {"name": "Budget", "rows": [["Item", "Cost"], ["Panels", 182]]}]}})["id"]
        grid = 'document.getElementById("sh-grid")'
        visible, shadow = self.ring(aid, grid, key=("Tab", "Tab", 9))
        self.assertTrue(visible)
        self.assertEqual(shadow, "none")
        visible, shadow = self.ring(aid, grid, then='[...document.querySelectorAll("#sh-bar .kit-btn")].find(b => b.offsetParent && !b.disabled)', key=("Tab", "Tab", 9))
        self.assertTrue(visible)
        self.assertIn("0px 0px 0px 3px", shadow)  # a control: the kit's ring

    def test_the_motion_timeline(self):
        aid = self.store.publish(path=str(EX / "motion"), title="Film", type="motion")["id"]
        visible, shadow = self.ring(aid, 'document.querySelector(".mo-tl")')
        self.assertTrue(visible)
        self.assertIn("0px 0px 0px 2px", shadow)  # its own ring, not the kit's 3 px one


WIDTHS = (360, 420, 560, 720, 760, 900, 1000, 1500)   # 720, 900: where a board's tools and zoom pills met (0.20.0)
# Content a page draws (cells, blocks, board items, frames, slides and their filmstrip, cards): its controls may sit anywhere in it.
CONTENT = "#sl-strip, #sh-grid, .doc-blk, #doc-page, .bd-world, #dc-world, #sl-stage, #stage, #mo-frame, #dash-main, .ds-page, .kit-menu"
# At each width: every control of the chrome whole on screen and inside what clips it (or in a strip that
# scrolls), its words not cut; floating toolbars and pills never on one another; a design frame's name strip on
# nothing else.
PROBE = r"""(() => {
  const CONTENT = %s, vw = innerWidth, bad = []
  const shown = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null
    for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null }
    return r }
  const name = el => (el.getAttribute('aria-label') || el.title || el.textContent || el.className || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40)
  const clip = el => { for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) if (getComputedStyle(e).overflowX !== 'visible') return e; return null }
  const meet = (a, b) => a.left + 1 < b.right && b.left + 1 < a.right && a.top + 1 < b.bottom && b.top + 1 < a.bottom
  const ctrls = [...document.querySelectorAll('button, [role=button], [role=tab], select, input:not([type=hidden])')].filter(el => !el.closest(CONTENT) && shown(el))
  for (const el of ctrls) {
    const r = el.getBoundingClientRect(), c = clip(el), cr = c && c.getBoundingClientRect()
    if (cr && (r.right <= cr.left || r.left >= cr.right)) continue   // scrolled out of its strip: reached by scrolling it
    if (r.left < -0.5 || r.right > vw + 0.5) bad.push('off screen: ' + name(el))
    // a strip that scrolls counts too: a tab half under its edge is cut
    if (cr && (r.left < cr.left - 0.5 || r.right > cr.right + 0.5)) bad.push('clipped: ' + name(el))
    if (el.scrollWidth > el.clientWidth + 1 && el.tagName === 'BUTTON') bad.push('words cut: ' + name(el))
  }
  const floats = [...document.querySelectorAll('body *')].filter(el => !el.closest(CONTENT) && /absolute|fixed/.test(getComputedStyle(el).position)
    && el.querySelector('button') && shown(el)).filter(el => { const r = el.getBoundingClientRect(); return r.width * r.height < vw * innerHeight / 3 })  // a toolbar, not a whole layer
  const outer = floats.filter(el => !floats.some(o => o !== el && o.contains(el)))
  for (let i = 0; i < outer.length; i++) for (let j = i + 1; j < outer.length; j++)
    if (meet(outer[i].getBoundingClientRect(), outer[j].getBoundingClientRect())) bad.push('overlap: ' + name(outer[i]) + ' / ' + name(outer[j]))
  for (const f of outer) for (const el of ctrls)
    if (!f.contains(el) && !outer.some(o => o.contains(el)) && meet(f.getBoundingClientRect(), el.getBoundingClientRect())) bad.push('covers: ' + name(f) + ' over ' + name(el))
  const strips = [...document.querySelectorAll('.dc-strip')].map(shown).filter(Boolean)
  const others = [...document.querySelectorAll('.dc-frame, .dc-note')].map(shown).filter(Boolean)
  strips.forEach((s, i) => { if (strips.some((t, j) => j > i && meet(s, t)) || others.some(o => meet(s, o))) bad.push('frame name strip on something') })
  if (document.documentElement.scrollWidth > vw + 1 && getComputedStyle(document.body).overflowX !== 'hidden') bad.push('page wider than the view')
  return bad
})()""" % json.dumps(CONTENT)


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class NothingOverlapsAtAnyWidth(unittest.TestCase):
    """Every type page at 360-1500 px: no control off screen or clipped, no words cut, no two floating toolbars
    on one another (the 0.20.0 acceptance run: a sheet's "Ask Herm…", a board's zoom pill over its tools, a
    design canvas's frame names over its title, a design system's last tab cut)."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def check(self, aid, settle=1500):
        body = "const out = {}\n"
        for w in WIDTHS:
            body += f"await api.size({w}, 760); await api.sleep(700); out[{w}] = await api.frame({json.dumps(PROBE)})\n"
        r = B.drive(f"await api.size({WIDTHS[0]}, 760); await api.go({json.dumps(self.host.url(aid, theme=THEME))}, 800); {READY}\n"
                    f"await api.sleep({settle})\n" + body + "return out")
        self.assertIsNone(r.get("err"), r)
        found = {w: v for w, v in r["out"].items() if v}
        self.assertEqual(found, {})

    def test_doc(self):
        self.check(self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"])

    def test_sheet_with_an_error(self):
        self.check(self.store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [
            {"name": "Costs", "rows": [["Item", "Unit price", "Qty", "Total"], ["Wall panels", 2000, 3, "=B2*C2"], ["Rails", 300, 10, "=B3*C3"],
                                       [None, "=1/0"]], "charts": [{"type": "bar", "range": "A1:D3", "at": "F2"}]},
            {"name": "Notes", "rows": [["x"]]}]}})["id"], settle=2500)

    def test_board(self):
        self.check(self.store.publish(title="Flow", type="board", files={"board.json": {"title": "Release flow", "items": [
            {"type": "text", "size": "title", "text": "Release flow"}, {"id": "dev", "type": "section", "text": "Development"},
            {"id": "a", "type": "box", "text": "Draft", "in": "dev"}, {"id": "b", "type": "box", "kind": "diamond", "text": "Review ok?", "in": "dev"},
            {"id": "c", "type": "box", "kind": "pill", "text": "Ship", "color": "blue"}, {"type": "arrow", "from": "a", "to": "b"},
            {"type": "arrow", "from": "b", "to": "c", "label": "yes"}, {"type": "note", "text": "Owner: Anna", "near": "c"}]}})["id"])

    def test_dashboard(self):
        self.check(self.store.publish(path=str(EX / "dashboard"), title="Orders", type="dashboard")["id"])

    def test_slides(self):
        self.check(self.store.publish(path=str(EX / "slides"), title="Deck", type="slides")["id"])

    def test_motion(self):
        self.check(self.store.publish(path=str(EX / "motion"), title="Film", type="motion")["id"], settle=2500)

    def test_design_system(self):
        self.check(self.store.publish(path=str(EX / "design-system"), title="Kiln", type="design-system")["id"])

    def test_model(self):
        from test_models import PANEL
        self.check(self.store.publish(title="Panel", type="model", files={"model.json": PANEL})["id"], settle=3000)

    def test_design_canvas(self):
        self.check(self.store.publish(path=str(EX / "design"), title="Lumen", type="design")["id"], settle=3000)


if __name__ == "__main__":
    unittest.main()
