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
CONTENT = "#sl-strip, #sh-grid, .doc-blk, #doc-page, .bd-world, #dc-world, #sl-stage, #stage, #mo-frame, #dash-main, .ds-page, .kit-menu, .doc-rmenu"
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
  // an open menu: whole in the window; one taller than its box scrolls (never cut with no way to its last rows)
  for (const m of document.querySelectorAll('.kit-menu, .doc-rmenu')) {
    const r = shown(m); if (!r) continue
    if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) bad.push('menu off screen: ' + name(m))
    if (m.scrollHeight > m.clientHeight + 1 && !/auto|scroll/.test(getComputedStyle(m).overflowY)) bad.push('menu cut: ' + name(m))
  }
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

    # Secondary states (rounds 3 and 4 found their faults only there): each page measured at STATE_WIDTHS with a
    # panel, a menu, an opened artboard or a selection showing. `setup` runs once (driver context, may click for
    # real); `again` (frame JS) after each resize, to bring back what a resize closes (a menu) or a width resets.
    def states(self, aid, cases, settle=1500, widths=None):
        widths = widths or STATE_WIDTHS
        body = "const out = {}\n"
        for name, setup, again in cases:
            body += setup + "\n"
            for w in widths:
                body += (f"await api.size({w}, 760); await api.sleep(600);"
                         + (f" await api.frame({json.dumps(again)}); await api.sleep(500);" if again else "")
                         + f" out[{json.dumps(name + ' @' + str(w))}] = await api.frame({json.dumps(PROBE)})\n")
        r = B.drive(f"await api.size({widths[0]}, 760); await api.go({json.dumps(self.host.url(aid, theme=THEME))}, 800); {READY}\n"
                    f"await api.sleep({settle})\n" + body + "return out", timeout=420)
        self.assertIsNone(r.get("err"), r)
        self.assertEqual({k: v for k, v in r["out"].items() if v}, {})

    def test_slides_with_properties_open(self):
        aid = self.store.publish(path=str(EX / "slides"), title="Deck", type="slides")["id"]
        props = ("(() => { const b = [...document.querySelectorAll('button')].find(b => ['Properties','Tulajdonságok'].includes(b.getAttribute('aria-label'))"
                 " && b.getClientRects().length); if (b && b.getAttribute('aria-pressed') !== 'true') b.click() })()")
        self.states(aid, [("properties", "", props)])

    def test_slides_with_an_element_selected_and_with_properties_open(self):
        # live round V3: the selection toolbar ran 8..456 px in a 400 px frame (its comment and its ··· cut off)
        # and, Properties open, across their sheet
        aid = self.store.publish(path=str(EX / "slides"), title="Deck", type="slides")["id"]
        pick = "await api.clickIn('document.querySelector(\".sl-clip .sl-canvas h1\")'); await api.sleep(500)"
        self.states(aid, [("element selected", pick, None), ("element selected and properties open", "", SL_PROPS)], widths=(400, 560, 760))

    def test_design_with_an_artboard_opened_and_an_element_selected(self):
        aid = self.store.publish(path=str(EX / "design"), title="Lumen", type="design")["id"]
        self.states(aid, [
            ("artboard opened", "await api.frame('__design.openFocus(\"Main.dc.html\")'); await api.sleep(1200)", None),
            ("element selected", "await api.frame('__design.closeFocus ? __design.closeFocus() : document.dispatchEvent(new KeyboardEvent(\"keydown\", {key: \"Escape\", bubbles: true}))'); await api.sleep(900);"
             " await api.size(1000, 760); await api.sleep(600);"
             " { const q = await api.frame('(() => { const r = __design.boards[\"Main.dc.html\"].el.querySelector(\"iframe\").getBoundingClientRect(); return [r.left + r.width * 0.25, r.top + r.height * 0.35] })()');"
             " await api.mouse(q[0], q[1]); await api.sleep(900) }", None),
        ], settle=3000)

    def test_design_system_on_every_tab(self):
        aid = self.store.publish(path=str(EX / "design-system"), title="Kiln", type="design-system")["id"]
        tabs = ["(() => { const t = document.querySelectorAll('.ds-nav-i')[%d]; if (t) t.click() })()" % i for i in range(10)]
        self.states(aid, [("tab %d" % i, "", t) for i, t in enumerate(tabs)])

    def test_sheet_with_an_error_its_callout_and_more(self):
        aid = self.store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [
            {"name": "Costs", "rows": [["Item", "Unit price", "Qty", "Total"], ["Wall panels", 2000, 3, "=B2*C2"], ["Rails", 300, 10, "=B3*C3"],
                                       [None, "=1/0"]], "charts": [{"type": "bar", "range": "A1:D3", "at": "F2"}]}]}})["id"]
        pick = ('(() => { const c = [...document.querySelectorAll("#sh-grid .sh-c")].find(x => /^#/.test(x.textContent.trim())); if (!c) return;'
                ' c.scrollIntoView({block: "center", inline: "center"}); const b = c.getBoundingClientRect(), o = {bubbles: true, clientX: b.left + 8, clientY: b.top + b.height / 2, button: 0};'
                ' c.dispatchEvent(new MouseEvent("mousedown", o)); document.dispatchEvent(new MouseEvent("mouseup", o)) })()')
        more = '(() => { const b = [...document.querySelectorAll("#sh-bar button")].find(b => /^(More|Továbbiak)$/.test(b.title) && b.offsetParent); if (b) b.click() })()'
        self.states(aid, [("error callout", "", pick), ("more menu", "", pick[:-4] + "; setTimeout(() => " + more + ", 350) })()")], settle=2500)

    def test_doc_with_each_menu_open(self):
        aid = self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        btn = lambda d: '[...document.querySelectorAll("#doc-bar .kit-btn")].find(b => b.querySelector(\'path[d^="%s"]\')).click()' % d
        menus = {
            "tabs": 'document.querySelector(".doc-tabbtn").click()',
            "fonts": 'document.querySelectorAll(".doc-tool")[1].click()',
            "insert": 'document.querySelector(".doc-plus").click()',
            "history": btn("M3 12a9 9"),
            "export": btn("M12 4v11"),
            "mode": 'document.querySelector(".doc-mode").click()',
            "table menu": '(() => { const c = document.querySelectorAll(".doc-blk table td")[3]; c.scrollIntoView({block: "center"}); const b = c.getBoundingClientRect();'
                          ' c.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true, clientX: b.left + 20, clientY: b.top + b.height / 2})) })()',
        }
        # the click that opens a menu is a toggle: each width first closes what is open (Esc), then opens it
        esc = 'document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})); document.body.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));'
        self.states(aid, [(k, "", "(() => { " + esc + " setTimeout(() => { " + v + " }, 120) })()") for k, v in menus.items()])

    def test_board_with_an_item_selected(self):
        aid = self.store.publish(title="Flow", type="board", files={"board.json": {"title": "Release flow", "items": [
            {"id": "a", "type": "box", "text": "Draft"}, {"id": "b", "type": "box", "kind": "diamond", "text": "Review ok?"},
            {"id": "c", "type": "box", "kind": "pill", "text": "Ship", "color": "blue"}, {"type": "arrow", "from": "a", "to": "b"},
            {"type": "arrow", "from": "b", "to": "c", "label": "yes"}, {"type": "note", "text": "Owner: Anna", "near": "c"}]}})["id"]
        self.states(aid, [("selected", "await api.clickIn('document.querySelector(\".bd-it[data-id=c]\")'); await api.sleep(500)", None)])


STATE_WIDTHS = (400, 560, 760, 1000, 1500)
SL_PROPS = ("(() => { const b = [...document.querySelectorAll('button')].find(b => ['Properties','Tulajdonságok'].includes(b.getAttribute('aria-label'))"
            " && b.getClientRects().length); if (b && b.getAttribute('aria-pressed') !== 'true') b.click() })()")


BAR_PAGE = ("<!doctype html><meta charset=utf-8><style>body{margin:0;font:16px system-ui}.bar{position:sticky;top:0;height:44px;"
            "background:#333;color:#fff}main{padding:20px;min-height:2400px}p{margin:0 0 12px}.side{position:sticky;top:44px;width:120px}"
            "</style><div class=bar>Toolbar</div><div class=side>Contents</div><main><p id=a>First paragraph</p><p id=b>Second paragraph</p></main>")


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class PickBandTests(unittest.TestCase):
    """Round 1: a click on the blank under a doc's last block picked the whole doc, and a picked item scrolled up
    under the doc's sticky toolbar kept its pin there. A click on no content picks nothing (pick mode stays on);
    the picked rect says whether any of the element is seen (vis) and the band the page's own bars leave (vt, vb)."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()
        cls.aid = store.publish(title="Bar page", type="page", html=BAR_PAGE)["id"]

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_blank_picks_nothing_and_a_hidden_element_says_so(self):
        r = B.drive(f"await api.go({json.dumps(self.host.url(self.aid))}, 800); {READY}\n" + """
          await api.top('window.__post("comment-mode", {on: true})'); await api.sleep(200)
          const picked = () => api.top('window.__events.filter(e => e.event === "picked").map(e => e.detail)')
          await api.mouse(600, 700); await api.sleep(300)            // the blank of <main>, under its last paragraph
          const blank = await picked()
          const hover = await api.frame('[...document.querySelectorAll("[data-hermes-ui]")].map(b => b.style.display)')
          await api.clickIn('document.getElementById("a")'); await api.sleep(300)
          const first = (await picked()).pop()
          await api.top('window.__post("comment-mode", {on: false})')
          const rect = () => api.top('(() => { const e = window.__events.filter(e => e.event === "picked-rect").pop(); return e && e.detail.rect })()')
          // under the sticky bar: its bottom 4 px above the bar's
          await api.frame('scrollBy(0, document.getElementById("a").getBoundingClientRect().bottom - 40)'); await api.sleep(250)
          const under = await rect()
          await api.frame('scrollTo(0, 0)'); await api.sleep(250)
          const back = await rect()
          await api.top('window.__post("pick-follow", {on: false})')
          return { blank, hover, first: first && first.rect, under, back }
        """)
        self.assertIsNone(r.get("err"), r)
        o = r["out"]
        self.assertEqual(o["blank"], [])  # nothing picked: pick mode stays on
        self.assertIn("none", o["hover"])  # and no box drawn over the blank
        self.assertEqual((o["first"]["vt"], o["first"]["vb"], o["first"]["vis"]), (44, 800, True))  # the side column is no bar
        self.assertLess(o["under"]["y"] + o["under"]["h"], 44)
        self.assertGreaterEqual(o["under"]["y"] + o["under"]["h"], 0)
        self.assertFalse(o["under"]["vis"])
        self.assertTrue(o["back"]["vis"])


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class DocQuoteMarkTests(unittest.TestCase):
    """Round 1: list item 1 of a doc kept its thread's highlight after the thread was resolved. A thread's words are
    marked while it is open and the mark goes with it; marked, they are still the doc's own words."""

    def test_the_mark_goes_with_its_thread_and_keeps_the_words(self):
        from hermes_artifacts import store
        host = B.Host()
        try:
            aid = store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
            pin = {"selector": ".doc-blk li", "n": 1, "id": "c1", "author": "user", "text": "Shorter", "quote": "A request for a quote arrives", "replies": 0}
            r = B.drive(f"await api.go({json.dumps(host.url(aid))}, 800); {READY}\n" + """
              await api.sleep(600)
              const marks = () => api.frame('[...document.querySelectorAll("mark.doc-cq")].map(m => m.textContent)')
              const md = () => api.frame('docEdit.toMd(document.querySelector(".doc-blk li").closest(".doc-blk"))')
              await api.top('window.__post("pins", [' + %s + '])'); await api.sleep(400)
              const open = await marks(), openMd = await md()
              await api.top('window.__post("pins", [])'); await api.sleep(400)
              const resolved = await marks(), resolvedMd = await md()
              await api.top('window.__post("pins", [' + %s + '])'); await api.sleep(400)
              const reopened = await marks()
              return { open, openMd, resolved, resolvedMd, reopened }
            """ % (json.dumps(json.dumps(pin)), json.dumps(json.dumps(pin))))
        finally:
            host.close()
        self.assertIsNone(r.get("err"), r)
        o = r["out"]
        self.assertEqual(o["open"], ["A request for a quote arrives"])
        self.assertEqual(o["resolved"], [])
        self.assertEqual(o["reopened"], ["A request for a quote arrives"])
        self.assertIn("A request for a quote arrives", o["openMd"])  # never dropped from the doc's Markdown
        self.assertNotIn("==", o["openMd"])  # nor written as a highlight
        self.assertEqual(o["openMd"], o["resolvedMd"])

    def test_a_block_drawn_again_when_the_focus_leaves_it_keeps_its_threads_marks(self):
        # live round V3: a click into a paragraph holding an open thread's mark, then the focus elsewhere (a comment
        # draft's Discard): the commit drew the block again from its Markdown and the mark was gone until a reopen
        from hermes_artifacts import store
        host = B.Host()
        try:
            aid = store.publish(title="Marks", type="doc", files={"doc.md": "# Marks\n\nThe paragraph with a thread in it.\n\nAnother paragraph."})["id"]
            pin = {"selector": ".doc-blk:nth-child(2)", "n": 1, "id": "c1", "author": "user", "text": "note", "quote": "thread", "replies": 0}
            r = B.drive(f"await api.go({json.dumps(host.url(aid))}, 800); {READY}\n" + """
              await api.sleep(600)
              const marks = () => api.frame('[...document.querySelectorAll("mark.doc-cq")].map(m => m.textContent)')
              await api.top('window.__post("pins", [' + %s + '])'); await api.sleep(400)
              const open = await marks()
              await api.clickIn('document.querySelectorAll(".doc-blk")[1]'); await api.sleep(300)
              const inBlock = await api.frame('!!document.activeElement.closest(".doc-blk")')
              await api.clickIn('document.querySelectorAll(".doc-blk")[2]'); await api.sleep(600)
              return { open, inBlock, after: await marks() }
            """ % json.dumps(json.dumps(pin)))
        finally:
            host.close()
        self.assertIsNone(r.get("err"), r)
        self.assertEqual(r["out"], {"open": ["thread"], "inBlock": True, "after": ["thread"]})


class EverySelectIsTheKits(unittest.TestCase):
    """No native select arrow in any type's page: every select a runtime makes is the kit's (kit-select)."""

    def test_every_select(self):
        import re
        types = ROOT / "plugin" / "hermes_artifacts" / "types"
        made = 0
        for f in sorted(types.rglob("*")):
            if f.suffix not in (".js", ".html") or "vendor" in f.parts:
                continue
            src = f.read_text("utf-8")
            for m in re.finditer(r'h\("select",\s*(\{[^}]*\})', src):
                made += 1
                self.assertRegex(m.group(1), r'"class":\s*"[^"]*\bkit-select\b', f"{f.relative_to(types)}: {m.group(0)}")
            native = re.findall(r"<select\b(?![^>]*kit-select)[^>]*>?|createElement\([\"']select[\"']\)", src)
            self.assertEqual(native, [], f.relative_to(types))
        self.assertGreater(made, 15)


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class ThemedControls(unittest.TestCase):
    """Controls drawn in the theme's colours, not the system's native ones. A doc's checklist box: empty = the
    ground in a strong line, ticked = the accent, in a light and in a dark doc, also on a dark system (where the
    native empty box was filled dark in a light doc and looked ticked). A dashboard's filter select: the kit's
    select (no native arrow, the kit's chevron)."""

    LIGHT = {"mode": "light", "vars": {"bg": "rgb(250, 249, 245)", "fg": "rgb(31, 30, 29)", "accent": "rgb(201, 100, 66)",
                                       "line": "rgb(230, 228, 220)", "strong": "rgb(176, 174, 165)", "panel": "rgb(255, 255, 255)"}}
    DARK = {"mode": "dark", "vars": dict(THEME["vars"], strong="rgb(98, 97, 92)")}
    BOX = """[...document.querySelectorAll('.doc-prose li.task > input')].map(b => { const s = getComputedStyle(b)
      return { checked: b.checked, appearance: s.appearance, bg: s.backgroundColor, border: s.borderTopColor, image: s.backgroundImage.slice(0, 18) } })"""

    def test_the_doc_checklist_box_in_both_themes(self):
        from hermes_artifacts import store
        aid = store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        host = B.Host()
        try:
            body = "const out = {}\n"
            for system in ("dark", "light"):
                for name, theme in (("light", self.LIGHT), ("dark", self.DARK)):
                    body += (f"await api.scheme({json.dumps(system)}); await api.go({json.dumps(host.url(aid, theme=theme))}, 800); {READY}\n"
                             f"await api.sleep(600); out[{json.dumps(name + '-on-' + system)}] = await api.frame({json.dumps(self.BOX)})\n")
            r = B.drive(body + "return out")
        finally:
            host.close()
        self.assertIsNone(r.get("err"), r)
        for key, boxes in r["out"].items():
            theme = self.LIGHT if key.startswith("light") else self.DARK
            empty, ticked = [b for b in boxes if not b["checked"]], [b for b in boxes if b["checked"]]
            self.assertTrue(empty and ticked, (key, boxes))
            for b in boxes:
                self.assertEqual(b["appearance"], "none", key)
            for b in empty:
                self.assertEqual((b["bg"], b["border"], b["image"]), (theme["vars"]["bg"], theme["vars"]["strong"], "none"), key)
            for b in ticked:
                self.assertEqual((b["bg"], b["border"]), (theme["vars"]["accent"], theme["vars"]["accent"]), key)
                self.assertTrue(b["image"].startswith('url("data:image/s'), (key, b))

    def test_the_dashboard_filter_is_the_kits_select(self):
        from hermes_artifacts import store
        aid = store.publish(path=str(EX / "dashboard-layout"), title="Layout", type="dashboard")["id"]
        host = B.Host()
        try:
            r = B.drive(f"await api.go({json.dumps(host.url(aid, theme=self.DARK))}, 800); {READY}\n await api.sleep(800)\n"
                        "return await api.frame(\"[...document.querySelectorAll('.c-filter select')].map(s => { const c = getComputedStyle(s);"
                        " return [s.classList.contains('kit-select'), c.appearance, c.backgroundImage.slice(0, 18), c.backgroundColor] })\")")
        finally:
            host.close()
        self.assertIsNone(r.get("err"), r)
        self.assertTrue(r["out"], r)
        for kit, appearance, image, bg in r["out"]:
            self.assertEqual((kit, appearance, image), (True, "none", 'url("data:image/sv'))
            self.assertEqual(bg, self.DARK["vars"]["bg"])


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class PageScrollbars(unittest.TestCase):
    """A plain page's scrollbars take the host's theme (thin, its muted colour on its background) when the page
    styles none of its own; a page with its own scrollbar style (scrollbar-color or ::-webkit-scrollbar, in a
    <style> or a style attribute) and a type runtime are left as they are; no error line moves."""

    THEME = {"mode": "dark", "vars": dict(THEME["vars"], muted="rgb(140, 139, 134)")}
    PLAIN = ("<!doctype html>\n<html><head><meta charset=utf-8><title>Plain</title>\n"
             "<style>.box{height:80px;overflow:auto}</style>\n</head><body>\n"
             "<div class=box><div style=\"height:400px\">tall</div></div>\n"
             "<script>setTimeout(function () { notDefinedHere(); }, 50);</script>\n</body></html>\n")
    WEBKIT = PLAIN.replace(".box{", ".box::-webkit-scrollbar{width:12px} .box{")
    INLINE = PLAIN.replace("<div class=box>", "<div class=box style=\"scrollbar-color: red blue\">")

    def test_only_a_page_without_its_own(self):
        import shutil
        import tempfile
        from hermes_artifacts import store
        ids, tmp = {}, Path(tempfile.mkdtemp(prefix="ha-bars-"))
        try:
            for name, html in (("plain", self.PLAIN), ("webkit", self.WEBKIT), ("inline", self.INLINE)):
                (tmp / name).mkdir()
                (tmp / name / "index.html").write_text(html, "utf-8")
                ids[name] = store.publish(path=str(tmp / name), title=name)["id"]
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        ids["dashboard"] = store.publish(path=str(EX / "dashboard"), title="Dash", type="dashboard")["id"]
        host = B.Host()
        try:
            look = """(() => { const r = getComputedStyle(document.documentElement), b = document.querySelector('.box') || document.body
              const s = document.getElementById('hermes-scrollbars')
              return { style: !!s, first: !!s && document.head.firstElementChild === s, rootW: r.scrollbarWidth, rootC: r.scrollbarColor,
                       boxW: getComputedStyle(b).scrollbarWidth, boxC: getComputedStyle(b).scrollbarColor } })()"""
            body = "const out = {}\n"
            for name, aid in ids.items():
                body += (f"await api.go({json.dumps(host.url(aid, theme=self.THEME))}, 800); {READY}\n await api.sleep(1800)\n"
                         f"out[{json.dumps(name)}] = Object.assign(await api.frame({json.dumps(look)}), "
                         "{ at: await api.top('window.__events.filter(e => e.event === \"diag\").flatMap(e => e.detail.entries).map(x => x.at || null)') })\n")
            r = B.drive(body + "return out")
        finally:
            host.close()
        self.assertIsNone(r.get("err"), r)
        o = r["out"]
        p = o["plain"]
        self.assertTrue(p["style"] and p["first"], p)
        self.assertEqual((p["rootW"], p["boxW"]), ("thin", "thin"))
        self.assertEqual(p["rootC"], "rgb(140, 139, 134) rgb(31, 31, 30)")
        self.assertTrue(p["boxC"].startswith("rgb(140, 139, 134) "), p)
        self.assertEqual([str(a).split(":")[:2] for a in p["at"]], [["index.html", "6"]], p)  # the error's own line
        for name in ("webkit", "inline", "dashboard"):
            self.assertFalse(o[name]["style"], (name, o[name]))
        self.assertEqual((o["webkit"]["rootW"], o["inline"]["rootW"]), ("auto", "auto"))
        self.assertEqual(o["inline"]["boxC"], "rgb(255, 0, 0) rgb(0, 0, 255)")
        self.assertEqual(o["webkit"]["at"], p["at"])  # the same line in each
        self.assertEqual(o["inline"]["at"], p["at"])


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class NoResizeObserverLoop(unittest.TestCase):
    """Round V1: Hermes' desktop.log filled with "ResizeObserver loop completed with undelivered notifications"
    from dashboards and design systems (their gallery cards too) on every window resize: an observer laid out
    what it observed (a KPI row's columns, a redraw) inside its own callback. kit.onResize does it in the next frame."""

    def test_resizing_a_dashboard_and_a_design_system_logs_no_loop(self):
        from hermes_artifacts import store
        host = B.Host()
        try:
            for ex, typ in (("dashboard", "dashboard"), ("design-system", "design-system")):
                aid = store.publish(path=str(EX / ex), title=ex, type=typ)["id"]
                r = B.drive(f"await api.size(1400, 800); await api.go({json.dumps(host.url(aid))}, 800); {READY}" + """
  await api.sleep(1200)
  await api.frame('window.__ro = []; window.addEventListener("error", e => window.__ro.push(String(e.message)))')
  for (const w of [1300, 900, 620, 480, 360, 700, 1100, 1500, 820, 400, 1250]) { await api.size(w, 760 + w % 7); await api.sleep(90) }
  await api.sleep(600)
  return await api.frame('window.__ro')
""")
                self.assertIsNone(r.get("err"), r)
                loops = [m for m in (r["out"] or []) + (r.get("logs") or []) if "ResizeObserver" in m]
                self.assertEqual(loops, [], ex)
        finally:
            host.close()


BUDGET = {"sheet.json": {"title": "Budget", "sheets": [
    {"name": "Costs", "rows": [["Item", "Unit price", "Qty", "Total"], ["Wall panels", 1200, 3, "=B2*C2"], ["Rails", 300, 10, "=B3*C3"],
                               [None, "=1/0"]], "charts": [{"type": "bar", "range": "A1:D3", "at": "F2"}]},
    {"name": "Notes", "rows": [["x"]]}]}}
# a status element: its whole words, or a dot (kit.status) with them as its tooltip; never words cut inside it
STATUS = r"""(sel => { const s = document.querySelector(sel); if (!s || !s.getClientRects().length) return null
  const r = s.getBoundingClientRect(), bar = s.parentElement.getBoundingClientRect(), dot = s.classList.contains('is-dot')
  return { text: s.textContent, dot, title: s.title, cut: !dot && s.scrollWidth > s.clientWidth, out: r.right > bar.right + 0.5 || r.left < bar.left - 0.5 } })"""
PROPS = ("(() => { const b = [...document.querySelectorAll('button')].find(b => ['Properties','Tulajdonságok'].includes(b.getAttribute('aria-label'))"
         " && b.getClientRects().length); if (b && b.getAttribute('aria-pressed') !== 'true') b.click() })()")
MEET = "const meet = (a, b) => a.left + 1 < b.right && b.left + 1 < a.right && a.top + 1 < b.bottom && b.top + 1 < a.bottom; "


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV2Layout(unittest.TestCase):
    """Live round V2 (0.20.0): a sheet's "Saving…" squeezed to a lone "S"; its error callout left behind (cut at the
    frame's edge) by a resize and over the sheet tabs; a chart's "Wall pane…" with room to spare; a design's top
    pills drawn over its properties sheet at 400 px and a resize closing the panel (slides too); a design system's
    Files out of reach at 400 px; a motion pill "The harbor ·…" and its Length field in another number shape; a
    slide's right click making it current."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def drive(self, aid, body, w=1000, settle=1500, timeout=300):
        r = B.drive(f"await api.size({w}, 760); await api.go({json.dumps(self.host.url(aid, theme=THEME))}, 800); {READY}\n"
                    f"await api.sleep({settle})\n" + body, timeout=timeout)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_save_status_is_whole_or_a_dot_at_every_width(self):
        aid = self.store.publish(title="Budget", type="sheet", files=BUDGET)["id"]
        # the "Rails" cell picked, its whole text replaced in the formula bar ("Rails360", "Rails420"...), Enter
        edit = ('(() => { const c = [...document.querySelectorAll("#sh-grid .sh-c")].find(x => /^Rails/.test(x.textContent.trim())); const b = c.getBoundingClientRect(),'
                ' o = {bubbles: true, clientX: b.left + 8, clientY: b.top + b.height / 2, button: 0}; c.dispatchEvent(new MouseEvent("mousedown", o));'
                ' document.dispatchEvent(new MouseEvent("mouseup", o)) })()')
        body, probe = "const out = {}\n", json.dumps(STATUS + '(".sh-status")')
        for w in WIDTHS:
            body += (f"await api.size({w}, 760); await api.sleep(500); await api.frame({json.dumps(edit)}); await api.clickIn('document.querySelector(\".sh-fx\")');"
                     f" await api.frame('document.querySelector(\".sh-fx\").select()'); await api.type('Rails{w}'); await api.key('Enter', 'Enter', 13); await api.sleep(20);"
                     f" out['{w} saving'] = await api.frame({probe}); await api.sleep(450);"
                     f" out['{w} saved'] = await api.frame({probe}); await api.sleep(1700)\n")
        out = self.drive(aid, body + "return out", w=WIDTHS[0], settle=2500)
        for k, s in out.items():
            self.assertTrue(s is None or (not s["cut"] and not s["out"]), (k, s))
            if s and s["dot"]:
                self.assertTrue(s["title"] and s["text"] == s["title"], (k, s))  # the dot says it in its tooltip
        self.assertTrue(any(s and s["text"] for s in out.values()), out)  # the status did show
        self.assertTrue(any(s and s["text"] and not s["dot"] for s in out.values()), out)  # wide: the words themselves
        # the doc's status the same way
        aid = self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        body, probe = "const out = {}\n", json.dumps(STATUS + '(".doc-status")')
        for w in (360, 420, 560, 1000):
            body += (f"await api.size({w}, 760); await api.sleep(400); await api.clickIn('document.querySelector(\".doc-blk p\")'); await api.type(' x{w}');"
                     f" await api.sleep(700); out[{w}] = await api.frame({probe}); await api.sleep(1600)\n")
        for k, s in self.drive(aid, body + "return out", w=360).items():
            self.assertTrue(s is None or (not s["cut"] and not s["out"]), (k, s))

    def test_the_error_callout_follows_a_resize_and_stays_in_the_grid(self):
        aid = self.store.publish(title="Budget", type="sheet", files=BUDGET)["id"]
        pick = ('(() => { const c = [...document.querySelectorAll("#sh-grid .sh-c")].find(x => /^#/.test(x.textContent.trim())); c.scrollIntoView({block: "center", inline: "center"});'
                ' const b = c.getBoundingClientRect(), o = {bubbles: true, clientX: b.left + 8, clientY: b.top + b.height / 2, button: 0};'
                ' c.dispatchEvent(new MouseEvent("mousedown", o)); document.dispatchEvent(new MouseEvent("mouseup", o)) })()')
        where = ("(() => { " + MEET + "const t = document.querySelector('.sh-errtip'); if (!t || t.hidden) return null; const r = t.getBoundingClientRect(), g = document.getElementById('sh-grid'),"
                 " gr = g.getBoundingClientRect(), c = [...document.querySelectorAll('#sh-grid .sh-active')].find(x => !x.hidden && x.getClientRects().length), cr = c && c.getBoundingClientRect();"
                 " return { inGrid: r.left >= gr.left - 0.5 && r.right <= gr.left + g.clientLeft + g.clientWidth + 0.5 && r.top >= gr.top - 0.5 && r.bottom <= gr.top + g.clientTop + g.clientHeight + 0.5,"
                 " onTabs: meet(r, document.getElementById('sh-foot').getBoundingClientRect()), onBar: meet(r, document.getElementById('sh-bar').getBoundingClientRect()),"
                 " near: !cr || Math.min(Math.abs(r.top - cr.bottom), Math.abs(cr.top - r.bottom)) < 40 || meet(r, cr) } })()")
        body = "const out = {}\n"
        for a, b in ((1000, 400), (400, 1000), (1500, 560), (560, 360)):
            body += (f"await api.size({a}, 760); await api.sleep(500); await api.frame({json.dumps(pick)}); await api.sleep(500);"
                     f" out['{a}'] = await api.frame({json.dumps(where)}); await api.size({b}, 700); await api.sleep(700);"
                     f" out['{a}>{b}'] = await api.frame({json.dumps(where)})\n")
        out = self.drive(aid, body + "return out", settle=2500)
        for k, o in out.items():
            self.assertIsNotNone(o, (k, out))
            self.assertEqual((o["inGrid"], o["onTabs"], o["onBar"], o["near"]), (True, False, False, True), (k, o))

    def test_a_chart_label_is_whole_where_it_fits(self):
        aid = self.store.publish(title="Budget", type="sheet", files=BUDGET)["id"]
        out = self.drive(aid, "return await api.frame('[...document.querySelectorAll(\".sh-chart text\")].map(t => t.firstChild && t.firstChild.textContent)')",
                         w=1500, settle=2000)
        self.assertIn("Wall panels", out)

    def test_design_properties_sheet_is_above_the_canvas_tools_and_survives_a_resize(self):
        aid = self.store.publish(path=str(EX / "design"), title="Lumen", type="design")["id"]
        probe = ("(() => { " + MEET + "const p = document.getElementById('dc-panel'); if (!p || p.hidden || !p.getClientRects().length) return 'closed';"
                 " const pr = p.getBoundingClientRect(), under = [...document.querySelectorAll('.dc-pill')].filter(x => x.getClientRects().length && meet(x.getBoundingClientRect(), pr));"
                 " const close = p.querySelector('.dc-tabs .kit-btn:last-child').getBoundingClientRect(), at = document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2);"
                 " return { under: under.map(x => x.className), close: !!at && !!at.closest('#dc-panel') } })()")
        out = self.drive(aid, """
          const q = await api.frame('(() => { const r = __design.boards["Main.dc.html"].el.querySelector("iframe").getBoundingClientRect(); return [r.left + r.width * 0.25, r.top + r.height * 0.35] })()')
          await api.mouse(q[0], q[1]); await api.sleep(900)
          const out = {}
          out.wide = await api.frame(%(p)s)
          await api.size(400, 760); await api.sleep(900); out.narrow = await api.frame(%(p)s)
          await api.frame(%(props)s); await api.sleep(600); out.asked = await api.frame(%(p)s)
          await api.size(1000, 760); await api.sleep(900); out.wideAgain = await api.frame(%(p)s)
          await api.size(400, 760); await api.sleep(900); out.narrowAgain = await api.frame(%(p)s)
          return out""" % {"p": json.dumps(probe), "props": json.dumps(PROPS)}, settle=3000)
        self.assertNotEqual(out["wide"], "closed", out)
        for k in ("narrow", "asked", "wideAgain", "narrowAgain"):  # open before a resize: open after it
            self.assertNotEqual(out[k], "closed", (k, out))
            self.assertEqual((out[k]["under"], out[k]["close"]), ([], True), (k, out))

    def test_slides_properties_survive_a_resize(self):
        aid = self.store.publish(path=str(EX / "slides"), title="Deck", type="slides")["id"]
        probe = ("(() => { " + MEET + "const p = document.getElementById('sl-props'); if (!p || p.hidden) return 'closed'; const pr = p.getBoundingClientRect();"
                 " return { under: [...document.querySelectorAll('.sl-pill')].filter(x => x.getClientRects().length && meet(x.getBoundingClientRect(), pr)).length } })()")
        out = self.drive(aid, f"""
          await api.frame({json.dumps(PROPS)}); await api.sleep(600)
          const out = {{ wide: await api.frame({json.dumps(probe)}) }}
          await api.size(400, 760); await api.sleep(800); out.narrow = await api.frame({json.dumps(probe)})
          await api.size(1000, 760); await api.sleep(800); out.wideAgain = await api.frame({json.dumps(probe)})
          return out""")
        for k, v in out.items():
            self.assertEqual(v, {"under": 0}, (k, out))

    def test_every_design_system_section_is_reachable_at_400(self):
        aid = self.store.publish(path=str(EX / "design-system"), title="Kiln", type="design-system")["id"]
        out = self.drive(aid, """return await api.frame(`(() => [...document.querySelectorAll('.ds-nav-i')].filter(b => b.getClientRects().length).map(b => {
            const r = b.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            return { t: b.querySelector('.ds-nav-t').textContent, reach: !!at && b.contains(at) && r.right <= innerWidth + 0.5 } }))()`)""", w=400)
        names = [o["t"] for o in out]
        self.assertTrue({"Files", "Fájlok"} & set(names), names)
        self.assertTrue(all(o["reach"] for o in out), out)
        spec = self.drive(aid, """
          await api.frame('[...document.querySelectorAll(".ds-nav-i")].find(b => /Typography|Tipográfia/.test(b.textContent)).click()'); await api.sleep(600)
          return await api.frame('[...document.querySelectorAll(".ds-type-sample")].map(s => [getComputedStyle(s).textOverflow, s.scrollWidth <= s.clientWidth + 1])')""", w=400)
        self.assertTrue(spec and all(t != "ellipsis" and fits for t, fits in spec), spec)  # specimens wrap, never cut

    def test_motion_pills_keep_their_names_and_one_number_shape(self):
        aid = self.store.publish(path=str(EX / "motion"), title="Film", type="motion")["id"]
        out = self.drive(aid, """
          await api.frame('[...document.querySelectorAll("button")].find(b => /^(Tweaks|Hangolás)$/.test(b.title) && b.getClientRects().length).click()'); await api.sleep(900)
          return await api.frame(`(() => ({
            segs: [...document.querySelectorAll('.mo-seg')].map(s => { const t = s.querySelector('.mo-seg-t'); return { name: t.querySelector('b').textContent, whole: t.scrollWidth <= t.clientWidth, len: s.querySelector('.mo-seg-t i').getClientRects().length > 0 } }),
            chip: document.querySelector('.mo-seg.on .mo-seg-t i').textContent, field: (document.querySelector('.mo-panel input[aria-label="Length"], .mo-panel input[aria-label="Hossz"]') || {}).value }))()`)""",
                         w=400, settle=2500)
        self.assertTrue(out["segs"] and all(s["whole"] for s in out["segs"]), out)
        self.assertTrue(out["chip"].startswith(out["field"]), out)  # "4.5 s" and "4.5": one shape
        out = self.drive(aid, "return await api.frame('[...document.querySelectorAll(\".mo-seg .mo-seg-t i\")].map(i => i.getClientRects().length > 0)')", w=1500, settle=2500)
        self.assertTrue(all(out), out)  # with room, every length shows

    def test_a_slide_right_click_does_not_change_the_current_slide(self):
        aid = self.store.publish(path=str(EX / "slides"), title="Deck", type="slides")["id"]
        state = "(() => { const t = [...document.querySelectorAll('#sl-rail .sl-thumb')]; return { on: t.findIndex(x => x.classList.contains('on')), ctx: t.findIndex(x => x.classList.contains('is-ctx')), menu: !!document.querySelector('.kit-menu') } })()"
        out = self.drive(aid, f"""
          const out = {{}}
          await api.frame('(() => {{ const b = document.querySelectorAll("#sl-rail .sl-thumb")[1], r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent("contextmenu", {{bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20}})) }})()')
          await api.sleep(300); out.open = await api.frame({json.dumps(state)})
          await api.frame('document.dispatchEvent(new KeyboardEvent("keydown", {{key: "Escape", bubbles: true}}))'); await api.sleep(300)
          out.esc = await api.frame({json.dumps(state)})
          return out""")
        self.assertEqual(out["open"], {"on": 0, "ctx": 1, "menu": True}, out)
        self.assertEqual(out["esc"], {"on": 0, "ctx": -1, "menu": False}, out)

    def test_a_narrow_doc_adds_a_block_from_the_grip(self):
        aid = self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        out = self.drive(aid, """
          const n = () => api.frame('document.querySelectorAll(".doc-blk[data-block]").length')
          const before = await n()
          await api.frame('(() => { const b = document.querySelectorAll(".doc-blk[data-block]")[2], r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: r.left + 30, clientY: r.top + 8})) })()')
          await api.sleep(300)
          const grip = await api.frame('(() => { const g = document.querySelector(".doc-g-grip"); if (!g || !g.getClientRects().length) return null; const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()')
          if (!grip) return { grip }
          await api.mouse(grip[0], grip[1]); await api.sleep(300)
          const items = await api.frame('[...document.querySelectorAll(".doc-rmenu button, .kit-menu button")].map(b => b.textContent.trim())')
          await api.frame('[...document.querySelectorAll(".doc-rmenu button, .kit-menu button")].find(b => /Add a block below|Új blokk alá/.test(b.textContent)).click()'); await api.sleep(500)
          return { grip, items, added: (await n()) - before }""", w=400)
        self.assertTrue(out.get("grip"), out)
        self.assertTrue({"Add a block below", "Új blokk alá"} & set(out["items"]), out)
        self.assertEqual(out["added"], 1, out)

    def test_model_more_button_is_as_strong_as_its_neighbours(self):
        from test_models import PANEL
        aid = self.store.publish(title="Panel", type="model", files={"model.json": PANEL})["id"]
        out = self.drive(aid, "return await api.frame('[...document.querySelectorAll(\".md-pill-r .kit-btn\")].filter(b => b.getClientRects().length).map(b => [b.getAttribute(\"aria-label\") || b.title, getComputedStyle(b).color, getComputedStyle(b).opacity])')",
                         w=400, settle=3000)
        self.assertGreater(len(out), 2, out)
        self.assertEqual(len({(c, o) for _, c, o in out}), 1, out)


MONTHS = {"title": "Orders", "datasets": {"m": {"title": "Months", "source": {"kind": "rows", "rows": [
    {"month": f"2026-{i + 1:02d}", "value": v} for i, v in enumerate([71.5, 88, 104.2, 97.9, 131, 92.4, 79, 66.3, 118.8, 60.3])]}}},
    "layout": [{"type": "chart", "kind": "bar", "title": "Value per month", "source": "m", "x": "month", "y": "value",
                "reference": {"value": 100, "label": "target"}}]}


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV3Layout(unittest.TestCase):
    """Live round V3 (0.20.0): the slides selection toolbar past a 400 px frame's edge and across the Properties
    sheet; two thumbnails marked after Esc from one's menu; a dashboard's target line through its bar values; a
    board note left tall after its text was cleared; a design frame's name cut to "A…" at the default fit."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def drive(self, aid, body, w=1000, settle=1500, timeout=300):
        r = B.drive(f"await api.size({w}, 760); await api.go({json.dumps(self.host.url(aid, theme=THEME))}, 800); {READY}\n"
                    f"await api.sleep({settle})\n" + body, timeout=timeout)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_the_slide_selection_toolbar_stays_in_the_frame_and_folds_into_more(self):
        aid = self.store.publish(path=str(EX / "slides"), title="Deck", type="slides")["id"]
        tools = ("(() => { const t = document.querySelector('.sl-tools'); if (!t || t.hidden || !t.getClientRects().length) return null; const r = t.getBoundingClientRect();"
                 " return { l: r.left, r: r.right, vw: innerWidth, btns: [...t.querySelectorAll('button')].map(b => b.getAttribute('aria-label')) } })()")
        more = ("(async () => { const b = [...document.querySelectorAll('.sl-tools button')].pop(); b.click(); await new Promise(r => setTimeout(r, 200));"
                " const m = [...document.querySelectorAll('.kit-menu .kit-ml')].map(x => x.textContent); b.click(); return m })()")
        body = "const out = {}\n"
        for w in (400, 560, 760, 1000):
            body += (f"await api.size({w}, 760); await api.sleep(600); await api.clickIn('document.querySelector(\".sl-clip .sl-canvas h1\")'); await api.sleep(400);"
                     f" out[{w}] = await api.frame({json.dumps(tools)}); out['{w} more'] = await api.frame({json.dumps(more)}); await api.sleep(200)\n")
        body += (f"await api.size(400, 760); await api.sleep(600); await api.frame({json.dumps(SL_PROPS)}); await api.sleep(600);"
                 " out.sheet = await api.frame(`(() => { const t = document.querySelector('.sl-tools'), p = document.getElementById('sl-props').getBoundingClientRect();"
                 " if (!t.getClientRects().length) return 'hidden'; const r = t.getBoundingClientRect(); return r.left < p.right && p.left < r.right && r.top < p.bottom && p.top < r.bottom ? 'over' : 'beside' })()`)\n")
        out = self.drive(aid, body + "return out", w=400)
        for w in (400, 560, 760, 1000):
            t = out[str(w)]
            self.assertTrue(t and t["l"] >= 0 and t["r"] <= t["vw"], (w, t))
        wide = set(out["1000"]["btns"]) | set(out["1000 more"])
        narrow = set(out["400"]["btns"]) | set(out["400 more"])
        self.assertLess(len(out["400"]["btns"]), len(out["1000"]["btns"]), out)  # some folded at 400
        self.assertTrue(wide - {None} <= narrow | {None}, (wide, narrow))  # every one still reachable (in ···)
        self.assertIn(out["sheet"], ("hidden", "beside"), out)

    def test_esc_from_a_thumbnail_menu_leaves_one_slide_marked(self):
        aid = self.store.publish(path=str(EX / "slides"), title="Deck", type="slides")["id"]
        out = self.drive(aid, """
          await api.frame('(() => { const b = document.querySelectorAll("#sl-rail .sl-thumb")[2], r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20})) })()')
          await api.sleep(300)
          await api.frame('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))'); await api.sleep(300)
          return await api.frame('(() => { const t = [...document.querySelectorAll("#sl-rail .sl-thumb")]; return { on: t.findIndex(x => x.classList.contains("on")), focus: t.indexOf(document.activeElement), menu: !!document.querySelector(".kit-menu") } })()')""")
        self.assertFalse(out["menu"], out)
        self.assertEqual(out["on"], 0, out)
        self.assertIn(out["focus"], (-1, 0), out)  # never a ring on the thumbnail the menu was for

    def test_a_dashboard_value_stays_readable_across_its_target_line(self):
        aid = self.store.publish(title="Orders", type="dashboard", files={"dashboard.json": MONTHS})["id"]
        probe = r"""(() => { const ln = document.querySelector('.c-chart line.c-ref'); if (!ln) return null; const lr = ln.getBoundingClientRect()
          return [...document.querySelectorAll('.c-chart text.c-value')].filter(t => { const r = t.getBoundingClientRect(); return r.top - 1 < lr.top && lr.top < r.bottom + 1 && r.left < lr.right })
            .map(t => { const cs = getComputedStyle(t); return { v: t.textContent, above: !!(ln.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING),
              halo: /^stroke/.test(cs.paintOrder) && parseFloat(cs.strokeWidth) >= 2 && cs.stroke !== 'none' } }) })()"""
        for w in (1500, 400):
            out = self.drive(aid, f"return await api.frame({json.dumps(probe)})", w=w, settle=2000)
            self.assertTrue(out, (w, out))  # the line does cross some ("97.9", "92.4")
            self.assertTrue(all(o["above"] and o["halo"] for o in out), (w, out))

    def test_a_note_grown_by_its_text_shrinks_back_but_never_below_a_dragged_height(self):
        aid = self.store.publish(title="Notes", type="board", files={"board.json": {"title": "Notes", "items": [
            {"id": "n", "type": "note", "text": "Hi", "x": 400, "y": 120, "w": 200, "h": 200}]}})["id"]
        at = "(() => { const r = document.querySelector('.bd-it[data-id=n]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 30, r.right, r.bottom] })()"
        h = "(async () => (await window.hermes.board.read()).items.find(i => i.id === 'n').h)()"
        clear = "(() => { const ta = document.querySelector('.bd-edit'); ta.value = ''; ta.dispatchEvent(new Event('input', {bubbles: true})) })()"
        long = "Line one of the note\\n" * 14
        out = self.drive(aid, f"""
          const out = {{}}, open = async () => {{ const p = await api.frame({json.dumps(at)}); await api.mouse(p[0], p[1]); await api.sleep(60); await api.mouse(p[0], p[1]); await api.sleep(400) }}
          const done = async () => {{ await api.key('Tab', 'Tab', 9); await api.sleep(1800) }}
          await open(); await api.frame('document.querySelector(".bd-edit").setSelectionRange(9999, 9999)'); await api.type("{long}"); await done(); out.grown = await api.frame({json.dumps(h)})
          await open(); await api.frame({json.dumps(clear)}); await done(); out.cleared = await api.frame({json.dumps(h)})
          let p = await api.frame({json.dumps(at)}); await api.mouse(p[0], p[1]); await api.sleep(400)
          const hd = await api.frame('(() => {{ const k = document.querySelector("[data-h=se]"); if (!k) return null; const r = k.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }})()')
          out.handle = !!hd; if (hd) {{ await api.drag(hd[0], hd[1], hd[0], hd[1] + 90); await api.sleep(1800) }}
          out.dragged = await api.frame({json.dumps(h)})
          await open(); await api.frame('document.querySelector(".bd-edit").setSelectionRange(9999, 9999)'); await api.type("{long}"); await done(); out.grown2 = await api.frame({json.dumps(h)})
          await open(); await api.frame({json.dumps(clear)}); await done(); out.cleared2 = await api.frame({json.dumps(h)})
          return out""", w=1300, settle=2000)
        self.assertGreater(out["grown"], 300, out)
        self.assertEqual(out["cleared"], 200, out)  # back to the size it was given
        self.assertTrue(out["handle"], out)
        self.assertGreater(out["dragged"], 240, out)
        self.assertGreater(out["grown2"], out["dragged"], out)
        self.assertEqual(out["cleared2"], out["dragged"], out)  # never below the dragged height

    def test_the_design_selection_toolbar_is_in_the_frame_and_under_the_properties_sheet(self):
        # the slides toolbar's pair checked in design: the element toolbar inside a 400 px frame, the sheet over it
        aid = self.store.publish(path=str(EX / "design"), title="Lumen", type="design")["id"]
        probe = ("(() => { const t = document.querySelector('.dc-tools'); if (!t || t.hidden || !t.getClientRects().length) return 'none'; const r = t.getBoundingClientRect();"
                 " const p = document.getElementById('dc-panel'), pr = p && !p.hidden && p.getClientRects().length ? p.getBoundingClientRect() : null;"
                 " const x0 = pr ? Math.max(r.left, pr.left) : 0, x1 = pr ? Math.min(r.right, pr.right) : 0, y0 = pr ? Math.max(r.top, pr.top) : 0, y1 = pr ? Math.min(r.bottom, pr.bottom) : 0;"
                 " const at = x1 > x0 && y1 > y0 ? document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2) : null;"
                 " return { inside: r.left >= 0 && r.right <= innerWidth, under: !at || !!at.closest('#dc-panel') } })()")
        out = self.drive(aid, """
          const q = await api.frame('(() => { const r = __design.boards["Main.dc.html"].el.querySelector("iframe").getBoundingClientRect(); return [r.left + r.width * 0.25, r.top + r.height * 0.35] })()')
          await api.mouse(q[0], q[1]); await api.sleep(900)
          const out = { selected: await api.frame(%(p)s) }
          await api.frame(%(props)s); await api.sleep(600); out.sheet = await api.frame(%(p)s)
          return out""" % {"p": json.dumps(probe), "props": json.dumps(PROPS)}, w=400, settle=3000)
        self.assertNotEqual(out["selected"], "none", out)
        for k, o in out.items():
            self.assertTrue(o == "none" or (o["inside"] and o["under"]), (k, out))

    def test_a_design_frame_too_narrow_for_its_name_shows_none(self):
        aid = self.store.publish(path=str(EX / "design"), title="Lumen", type="design")["id"]
        probe = ("[...document.querySelectorAll('.dc-strip')].filter(s => s.getClientRects().length).map(s => { const n = s.querySelector('.dc-name');"
                 " return { name: s.title, shown: n.getClientRects().length > 0, cut: n.scrollWidth > n.clientWidth + 1, w: n.clientWidth } })")
        for w in (400, 1000):
            out = self.drive(aid, f"await api.frame('__design.fit ? __design.fit() : 0'); await api.sleep(600); return await api.frame({json.dumps(probe)})", w=w, settle=3000)
            self.assertTrue(out and all(o["name"] for o in out), (w, out))  # each named in its tooltip
            self.assertFalse([o for o in out if o["shown"] and o["cut"] and o["w"] < 40], (w, out))  # never "A…"
