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
        self.assertEqual(out["picked"], ["Anchor points checked"], out)  # its words, never its tag
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
        # V3: the dashes ran through "92.4"; V4: its glyphs (and "97.9"'s) still sat on the line, and at 400 px
        # "104.2" and "97.9" were 1.4 px apart. V5: live, in a 1246 px frame, "88" was 0.6 px off the line and
        # "97.9" 1.4 px over it, the line unbroken: the halo was not counted, the chart's units were taken for px,
        # and a font that came after the first drawing (the theme's) moved every box. Each value's box with its
        # halo is 4 px clear of the line's stroke (or the line broken behind it) and of its neighbours, at every
        # width, measured after the fonts are in, and again after the theme's font changes.
        aid = self.store.publish(title="Orders", type="dashboard", files={"dashboard.json": MONTHS})["id"]
        probe = r"""(() => { const svg = document.querySelector('.c-chart svg'); const segs = [...document.querySelectorAll('.c-chart line.c-ref')].map(l => l.getBoundingClientRect()); if (!svg || !segs.length) return null
          const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width, half = 0.75 * k, ly = segs[0].top + segs[0].height / 2
          const vals = [...document.querySelectorAll('.c-chart text.c-value')].map(t => { const r = t.getBoundingClientRect(), cs = getComputedStyle(t), halo = parseFloat(cs.strokeWidth) / 2 * k
            return { v: t.textContent, l: r.left - halo, r: r.right + halo, t: r.top - halo, b: r.bottom + halo, fl: r.left, fr: r.right, ft: r.top, fb: r.bottom,
                     halo: /^stroke/.test(cs.paintOrder) && parseFloat(cs.strokeWidth) >= 2 && cs.stroke !== 'none', inside: t.classList.contains('c-value-in') } })
          const line = vals.map(v => ({ v: v.v, gap: Math.max(v.t - ly, ly - v.b) - half, under: segs.some(s => s.left < v.r + 3.9 && s.right > v.l - 3.9), halo: v.halo, inside: v.inside }))
          const near = vals.slice(1).map((c, i) => { const a = vals[i]; return Math.max(c.fl - a.fr, a.fl - c.fr, c.ft - a.fb, a.ft - c.fb) })
          return { line, near, n: vals.length, w: innerWidth } })()"""
        widths = (1500, 1246, 1100, 1000, 760, 560, 400)
        body = "const out = {}\n"
        for w in widths:
            body += f"await api.size({w}, 760); await api.sleep(700); await api.frame('document.fonts.ready.then(() => 1)'); await api.sleep(150); out[{w}] = await api.frame({json.dumps(probe)})\n"
        # the host's theme brings its font after the first drawing: drawn again around the new boxes
        body += ("await api.size(1246, 760); await api.sleep(700); await api.top(" + json.dumps("window.__post('theme', " + json.dumps(
                 {"mode": "dark", "vars": dict(THEME["vars"], font="Georgia, 'Times New Roman', serif")}) + ")") + "); await api.sleep(900);"
                 f" await api.frame('document.fonts.ready.then(() => 1)'); out.font = await api.frame({json.dumps(probe)})\n")
        out = self.drive(aid, body + "return out", w=1500, settle=2000)
        for w, o in out.items():
            self.assertTrue(o, w)
            self.assertIn(o["n"], (0, 10), (w, o))  # V6f: all of them or none (narrow: each in its bar's tooltip)
            for v in o["line"]:
                self.assertTrue(v["halo"] or v["inside"], (w, v))  # on the card: its halo; inside its bar (V6c): none
                self.assertTrue(v["gap"] >= 4 - 0.05 or not v["under"], (w, v, o))  # clear of the line, or the line broken there
            self.assertTrue(all(g >= 4 - 0.05 for g in o["near"]), (w, o))
        self.assertEqual(out["1500"]["n"], 10, out["1500"])  # room for every value

    def test_a_note_grown_by_its_text_shrinks_back_but_never_below_a_dragged_height(self):
        aid = self.store.publish(title="Notes", type="board", files={"board.json": {"title": "Notes", "items": [
            {"id": "n", "type": "note", "text": "Hi", "x": 400, "y": 120, "w": 200, "h": 200}]}})["id"]
        at = "(() => { const r = document.querySelector('.bd-it[data-id=n]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 30, r.right, r.bottom] })()"
        h = "(async () => (await window.hermes.board.read()).items.find(i => i.id === 'n').h)()"
        clear = "(() => { const ta = document.querySelector('.bd-edit'); ta.value = ''; ta.dispatchEvent(new Event('input', {bubbles: true})) })()"
        long = "Line one of the note\\n" * 14
        out = self.drive(aid, f"""
          // the note's editor waited for, not assumed (a run with the board still settling found none: null textarea)
          const edits = () => api.frame('!!document.querySelector(".bd-edit")')
          const out = {{}}, open = async () => {{
            for (let k = 0; k < 3 && !(await edits()); k++) {{
              const p = await api.frame({json.dumps(at)}); await api.mouse(p[0], p[1]); await api.sleep(60); await api.mouse(p[0], p[1])
              for (let i = 0; i < 30 && !(await edits()); i++) await api.sleep(100)
            }}
            if (!(await edits())) throw new Error('the note never opened its editor')
            await api.sleep(150)
          }}
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
        # V4: a frame whose name was hidden still showed its interactive mark, a round 7 px dot read as a comment pin
        probe = ("[...document.querySelectorAll('.dc-strip')].filter(s => s.getClientRects().length).map(s => { const n = s.querySelector('.dc-name'), d = s.querySelector('.dc-dot'), dc = getComputedStyle(d);"
                 " return { name: s.title, shown: n.getClientRects().length > 0, cut: n.scrollWidth > n.clientWidth + 1, w: n.clientWidth,"
                 " mark: d.getClientRects().length > 0, round: parseFloat(dc.borderTopLeftRadius) > 0 || dc.clipPath === 'none',"
                 " live: s.closest('.dc-board').classList.contains('is-interactive') } })")
        for w in (400, 1000):
            out = self.drive(aid, f"await api.frame('__design.fit ? __design.fit() : 0'); await api.sleep(600); return await api.frame({json.dumps(probe)})", w=w, settle=3000)
            self.assertTrue(out and all(o["name"] for o in out), (w, out))  # each named in its tooltip
            self.assertFalse([o for o in out if o["shown"] and o["cut"] and o["w"] < 40], (w, out))  # never "A…"
            self.assertFalse([o for o in out if o["mark"] and not o["shown"]], (w, out))  # never a lone mark
            self.assertFalse([o for o in out if o["mark"] and (o["round"] or not o["live"])], (w, out))  # a play mark, on a frame that plays
            if w == 400:
                self.assertTrue([o for o in out if o["live"] and not o["shown"]], (w, out))  # the V4 case is there: an interactive frame, its name hidden

    def test_esc_from_a_menu_then_a_click_on_another_button_leaves_one_focused(self):
        # V4: Esc gave the focus (and its ring) back to the doc's Fonts button; a click on Editing, whose press keeps
        # the caret, opened its menu with Fonts still ringed
        aid = self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        state = ("(() => { const f = document.querySelector('.doc-tt').closest('button'); return { fontsFocused: document.activeElement === f,"
                 " fontsRing: f.matches(':focus-visible'), rings: document.querySelectorAll(':focus-visible').length, menu: !!document.querySelector('.kit-menu') } })()")
        out = self.drive(aid, f"""
          const o = {{}}
          await api.clickIn('document.querySelectorAll(".doc-blk")[1]'); await api.sleep(300)  // the page has the keyboard (the person was writing)
          await api.clickIn('document.querySelector(".doc-tt").closest("button")'); await api.sleep(300)
          await api.key('Escape', 'Escape', 27); await api.sleep(300); o.esc = await api.frame({json.dumps(state)})
          await api.clickIn('document.querySelector(".doc-mode")'); await api.sleep(300); o.other = await api.frame({json.dumps(state)})
          return o""", w=1000)
        self.assertTrue(out["esc"]["fontsFocused"] and not out["esc"]["menu"], out)  # Esc: the focus back on its button
        self.assertTrue(out["other"]["menu"], out)
        self.assertFalse(out["other"]["fontsFocused"] or out["other"]["fontsRing"], out)
        self.assertLessEqual(out["other"]["rings"], 1, out)

    def test_a_press_that_closes_a_kit_menu_activates_nothing_under_it(self):
        # V6d (the Desktop's menus, and the kit's the same): a press outside an open menu closed it AND acted on what
        # was under it. Fonts open, Editing pressed: only the menu goes; Editing pressed again opens its own.
        aid = self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        menus = "[...document.querySelectorAll('.kit-menu')].map(m => m.textContent.slice(0, 40))"
        out = self.drive(aid, f"""
          const o = {{}}
          await api.clickIn('document.querySelector(".doc-tt").closest("button")'); await api.sleep(300); o.fonts = await api.frame({json.dumps(menus)})
          await api.clickIn('document.querySelector(".doc-mode")'); await api.sleep(300); o.pressed = await api.frame({json.dumps(menus)})
          await api.clickIn('document.querySelector(".doc-mode")'); await api.sleep(300); o.again = await api.frame({json.dumps(menus)})
          return o""", w=1000)
        self.assertEqual(len(out["fonts"]), 1, out)
        self.assertEqual(out["pressed"], [], out)
        self.assertEqual(len(out["again"]), 1, out)
        self.assertNotEqual(out["again"], out["fonts"], out)


PICK_DASH = {"title": "Orders", "params": {"region": ""},
             "datasets": {"r": {"title": "Regions", "source": {"kind": "rows", "rows": [
                 {"region": "North", "orders": 41}, {"region": "South", "orders": 17}, {"region": "East", "orders": 9}]}}},
             "layout": [{"type": "filters", "items": [{"param": "region", "label": "Region", "input": "select", "options": {"source": "r", "field": "region"}}]},
                        {"type": "kpis", "items": [{"label": "Orders", "source": "r", "field": "orders", "agg": "sum", "format": "int"},
                                                   {"label": "Regions", "source": "r", "field": "orders", "agg": "count", "format": "int"}]},
                        {"type": "chart", "kind": "bar", "title": "Orders by region", "source": "r", "x": "region", "y": "orders"}]}
PICK_PAGE = ("<!doctype html><meta charset=utf-8><style>body{margin:0;font:16px system-ui}main{padding:24px}div.box{width:160px;height:90px;"
             "background:#ccc}</style><main><p id=p>A paragraph of the page</p><div class=box id=box></div></main>")
TAG_NAMES = {"div", "span", "canvas", "svg", "img", "section", "p", "li", "td", "label", "iframe", "g", "rect", "text", "path", "main", "button"}


def at(sel, fx=0.5, fy=0.5):
    """Frame JS: [x, y] at fx, fy of the element `sel` (a JS expression) finds, scrolled into view; null without it."""
    return ("(() => { const el = %s; if (!el) return null; el.scrollIntoView({block: 'center'}); const b = el.getBoundingClientRect();"
            " return [b.left + b.width * %s, b.top + b.height * %s] })()" % (sel, fx, fy))


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class PickInEveryType(unittest.TestCase):
    """Live round V5: with the header's Comment armed, a click in a design's artboard only selected the element
    (no comment, the band stayed: the artboard is a frame of its own the bridge never hears), a click on a slide's
    blank picked nothing, a film's point had no pin, and the comment's title was a tag ("div", "canvas") or a whole
    filter row's words. In every type a click on a typical part makes one comment (a pick, or the page's own
    comment with its rect) titled with a name, never a tag, and edits nothing."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def pick(self, aid, where, before="", settle=1500, w=1200):
        """Arm picking, click where `where` (frame JS: [x, y]) says: the one comment event ("picked", or the page's
        own "comment" with a rect; checked) and the point clicked."""
        r = B.drive(f"await api.size({w}, 800); await api.go({json.dumps(self.host.url(aid, theme=THEME))}, 800); {READY}\n"
                    f"await api.sleep({settle})\n{before}\n"
                    "await api.top('window.__post(\"comment-mode\", {on: true})'); await api.sleep(300)\n"
                    f"const q = await api.frame({json.dumps(where)}); if (!q) return {{ none: true }}\n"
                    "await api.mouse(q[0], q[1]); await api.sleep(700)\n"
                    "return { at: q, ev: await api.top('window.__events.filter(e => e.event === \"picked\" || e.event === \"comment\")'), ops: await api.top('window.__ops') }",
                    timeout=240)
        self.assertIsNone(r.get("err"), r)
        out = r["out"]
        self.assertFalse(out.get("none"), "nothing to click")
        self.assertEqual(len(out["ev"]), 1, out["ev"])
        self.assertEqual(edits(out["ops"]), [], out["ops"])
        ev = out["ev"][0]
        d, rect = ev["detail"], ev["detail"].get("rect")
        self.assertTrue(rect and all(isinstance(rect[k], (int, float)) for k in "xywh"), ev)
        self.assertNotIn(str(d.get("label") or "").lower(), TAG_NAMES, ev)
        return ev, out["at"]

    def test_doc_block(self):
        aid = self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        ev, _ = self.pick(aid, at('[...document.querySelectorAll(".doc-blk li")].find(x => x.firstChild && x.firstChild.textContent.trim() === "A request for a quote arrives")', 0.1))
        self.assertIn("A request for a quote", ev["detail"]["label"])
        # V6j: a press on none of the blocks (between two, in the margins, under the last) picked nothing, or a point
        # after 3 s: the nearest block, by the line pressed
        gap = ('(() => { const b = [...document.querySelectorAll("#doc-page > .doc-blk")].filter(e => e.getClientRects().length); b[1].scrollIntoView({block: "center"});'
               ' const p = document.getElementById("doc-page").getBoundingClientRect(), r = b.map(e => e.getBoundingClientRect());'
               ' const i = r.findIndex((q, k) => k && q.top - r[k - 1].bottom >= 2); const y = (r[i - 1].bottom + r[i].top) / 2;'
               ' return %s })()')
        for spot in ('[(p.left + p.right) / 2, y, "' + 'gap' + '"]', '[Math.max(2, p.left - 30), r[1].top + 4, "left"]', '[Math.min(innerWidth - 2, p.right + 30), r[1].top + 4, "right"]'):
            ev, q = self.pick(aid, gap % spot)
            self.assertEqual(ev["event"], "picked", ev)
            self.assertRegex(ev["detail"]["selector"], r"blk-", (spot, ev))

    def test_sheet_cell(self):
        aid = self.store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [
            {"name": "Budget", "rows": [["Item", "Cost"], ["Panels", 182]]}]}})["id"]
        ev, _ = self.pick(aid, at('[...document.querySelectorAll("#sh-grid .sh-c")].find(x => x.textContent.trim() === "Panels")'), settle=2500)
        self.assertEqual(ev["detail"]["label"], "A2 · Panels")  # V6h N7: the cell's address, its value after
        # V6k: a press on a chart picked the cell under it: the chart, titled by its name, its rect the chart's
        aid = self.store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [
            {"name": "Budget", "rows": [["Item", "Cost"], ["Panels", 182], ["Rails", 40]], "charts": [{"type": "pie", "range": "A1:B3", "title": "Cost by item", "at": "D2"}]}]}})["id"]
        ev, q = self.pick(aid, at('document.querySelector(".sh-chart")', 0.5, 0.6), settle=2500)
        self.assertEqual(ev["detail"]["label"], "Cost by item", ev)
        r = ev["detail"]["rect"]
        self.assertTrue(r["x"] <= q[0] <= r["x"] + r["w"] and r["y"] <= q[1] <= r["y"] + r["h"] and r["w"] > 300, (q, r))
        self.assertNotIn("px", r)  # its pin beside it as any part's, not in its middle as a cell's

    def test_board_note(self):
        aid = self.store.publish(title="Flow", type="board", files={"board.json": {"title": "Flow", "items": [
            {"id": "a", "type": "box", "text": "Survey"}, {"id": "n", "type": "note", "text": "", "near": "a"}]}})["id"]
        ev, _ = self.pick(aid, at('document.querySelector(".bd-it[data-id=n]")'))
        self.assertIn(ev["detail"]["label"], ("Sticky note", "Cetli"))  # the page speaks the system's language

    def test_dashboard_kpi_chart_and_filter_row(self):
        aid = self.store.publish(title="Orders", type="dashboard", files={"dashboard.json": PICK_DASH})["id"]
        ev, _ = self.pick(aid, at('document.querySelector(".c-kpi")', 0.9, 0.15), settle=2000)
        self.assertEqual(ev["detail"]["label"], "Orders")  # its caption "ORDERS" is its name, not more words
        ev, _ = self.pick(aid, at('document.querySelector(".c-chart svg")', 0.5, 0.95), settle=2000)
        self.assertTrue(ev["detail"]["label"].startswith("Orders by region"), ev)
        ev, _ = self.pick(aid, at('document.querySelector(".c-filters")', 0.97, 0.5), settle=2000)
        self.assertIn(ev["detail"]["label"], ("Region filter", "Region szűrő"))  # never "REGION All North South … Reset"

    def test_slides_text_and_blank(self):
        aid = self.store.publish(path=str(EX / "slides"), title="Deck", type="slides")["id"]
        ev, _ = self.pick(aid, at('document.querySelector(".sl-clip .sl-canvas h1")', 0.2))
        self.assertRegex(ev["detail"]["label"], r"^(Slide|Dia) 1 · ")
        ev, _ = self.pick(aid, at('document.querySelector(".sl-clip .sl-canvas")', 0.97, 0.97))  # the slide's blank
        self.assertIn(ev["detail"]["label"], ("Slide 1", "Dia 1"))

    def test_motion_stage_point(self):
        aid = self.store.publish(path=str(EX / "motion"), title="Film", type="motion")["id"]
        ev, q = self.pick(aid, at('document.getElementById("mo-frame")', 0.3, 0.7), settle=2500)
        r = ev["detail"]["rect"]
        self.assertTrue(r.get("pt"), ev)  # pinned on the point
        self.assertAlmostEqual(r["x"] + r["w"] / 2, q[0], delta=1.5)
        self.assertAlmostEqual(r["y"] + r["h"] / 2, q[1], delta=1.5)
        self.assertIn("@xy=", ev["detail"]["selector"])

    def test_design_element_on_the_canvas_and_in_an_opened_artboard(self):
        aid = self.store.publish(path=str(EX / "design"), title="Lumen", type="design")["id"]
        board = ('(() => { const f = document.querySelector("[data-path=\\"Main.dc.html\\"] iframe"), b = f.getBoundingClientRect();'
                 ' return [b.left + b.width * 0.25, b.top + b.height * 0.35, b.left, b.top, b.right, b.bottom, [...document.querySelectorAll("[data-path] iframe, .dc-strip")].filter(e => e !== f && e.getClientRects().length).map(e => { const q = e.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom] })] })()')
        ev, q = self.pick(aid, board, settle=3000)
        d = ev["detail"]
        self.assertRegex(d["selector"], r"^Main\.dc\.html#\d+:")
        self.assertNotIn(" · <", d["label"])
        r = d["rect"]  # in the canvas's page px (its zoom undone): around the point clicked, inside its artboard
        self.assertTrue(r["x"] - 1 <= q[0] <= r["x"] + r["w"] + 1 and r["y"] - 1 <= q[1] <= r["y"] + r["h"] + 1, (q, r))
        self.assertTrue(q[2] - 1 <= r["x"] and r["x"] + r["w"] <= q[4] + 1 and q[3] - 1 <= r["y"] and r["y"] + r["h"] <= q[5] + 1, (q, r))
        # V5: the pin sat 90 px right of the picture, over the next frame: every spot the host may take (plugin.js
        # pinSpot: right, left, after the words, above, below) is inside this artboard, or marked taken, or (V6h: past
        # the artboard the canvas looks) on none of the other frames nor their strips
        P, G = 26, 6
        y = max(4, (r.get("ly", r["y"]) + r.get("lh", min(r["h"], 24)) / 2) - P / 2)
        spots = {"fr": (r["x"] + r["w"] + G, y), "fl": (r["x"] - G - P, y), "fa": (r["x"] + r["w"] - P, r["y"] - G - P),
                 "fb": (r["x"] + r["w"] - P, r["y"] + r["h"] + G)}
        if "lr" in r:
            spots["fw"] = (r["lr"] + G, y)
        for k, (sx, sy) in spots.items():
            if r.get(k):
                inside = q[2] - 0.5 <= sx and sx + P <= q[4] + 0.5 and q[3] - 0.5 <= sy and sy + P <= q[5] + 0.5
                on = [o for o in q[6] if sx < o[2] and o[0] < sx + P and sy < o[3] and o[1] < sy + P]
                self.assertTrue(inside or not on, (k, sx, sy, q[:6], on, r))
        ev, q = self.pick(aid, at('document.querySelector(".dc-fbox iframe")', 0.3, 0.3),
                          before="await api.frame('__design.openFocus(\"Main.dc.html\")'); await api.sleep(1500)", settle=3000)
        r = ev["detail"]["rect"]
        self.assertRegex(ev["detail"]["selector"], r"^Main\.dc\.html#\d+:")
        self.assertTrue(r["x"] - 1 <= q[0] <= r["x"] + r["w"] + 1 and r["y"] - 1 <= q[1] <= r["y"] + r["h"] + 1, (q, r))

    def test_design_system_hero_and_row(self):
        aid = self.store.publish(path=str(EX / "design-system"), title="Kiln", type="design-system")["id"]
        ev, _ = self.pick(aid, at('document.querySelector(".ds-cover")'), settle=2500)
        self.assertIn(ev["detail"]["label"], ("Hero", "Nyitókép"))
        ev, _ = self.pick(aid, at('document.querySelector(".ds-row[data-token]")', 0.6),
                          before="await api.frame('[...document.querySelectorAll(\".ds-nav-i\")].find(b => /Colou?rs|Színek/.test(b.textContent)).click()'); await api.sleep(800)", settle=2500)
        self.assertRegex(ev["detail"]["selector"], r"^token:color/")
        # V6j: a swatch picked had its pin at the row's end, 662 px off: the comment is the row's, its rect the swatch's
        ev, q = self.pick(aid, at('document.querySelector(".ds-row[data-token] .ds-sw")'),
                          before="await api.frame('[...document.querySelectorAll(\".ds-nav-i\")].find(b => /Colou?rs|Színek/.test(b.textContent)).click()'); await api.sleep(800)", settle=2500)
        self.assertRegex(ev["detail"]["selector"], r"^token:color/")
        r = ev["detail"]["rect"]
        self.assertTrue(r["x"] <= q[0] <= r["x"] + r["w"] and r["y"] <= q[1] <= r["y"] + r["h"] and r["w"] < 60, (q, r))

    def test_model_view(self):
        from test_models import PANEL
        aid = self.store.publish(title="Panel", type="model", files={"model.json": PANEL})["id"]
        # a point of the view over a part, one over none (the canvas itself there, no chrome over it)
        spot = ("(() => { const c = document.querySelector('.md-canvas'), r = c.getBoundingClientRect();"
                " for (let j = 1; j < 20; j++) for (let i = 1; i < 20; i++) { const x = r.left + r.width * i / 20, y = r.top + r.height * j / 20;"
                " if (document.elementFromPoint(x, y) === c && !!__model.pick(x, y) === %s) return [x, y] } return null })()")
        ev, _ = self.pick(aid, spot % "false", settle=3500)  # no part there: the view
        self.assertIn(ev["detail"]["label"], ("3D view", "3D nézet"))
        if not B.drive(f"await api.go({json.dumps(self.host.url(aid))}, 800); {READY}; await api.sleep(3500); return await api.frame('__model.state().glOK')")["out"]:
            return  # no WebGL in this Chrome: no part to hit
        ev, _ = self.pick(aid, spot % "true", settle=3500)  # the part there
        self.assertRegex(ev["detail"]["selector"], r"^part:")
        self.assertTrue(ev["detail"]["rect"].get("pt"), ev)  # its pin on the point clicked

    def test_plain_page(self):
        aid = self.store.publish(title="Plain", type="page", html=PICK_PAGE)["id"]
        ev, _ = self.pick(aid, at('document.getElementById("p")', 0.1))
        self.assertEqual(ev["detail"]["label"], "A paragraph of the page")
        ev, _ = self.pick(aid, at('document.getElementById("box")'))
        self.assertEqual(ev["detail"]["label"], "")  # no words, no name: the host's "Selected part"
        # V6k: a field was "Selected part": named as a button is, by its label, aria-label or placeholder
        aid = self.store.publish(title="Plain", type="page", html=PICK_PAGE.replace("</main>", "<input id=msg placeholder='Message to Hermes'></main>"))["id"]
        ev, _ = self.pick(aid, at('document.getElementById("msg")'))
        self.assertEqual(ev["detail"]["label"], "Message to Hermes")


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV5Layout(unittest.TestCase):
    """Live round V5 (0.20.0): a design's selection toolbar sat over the name strips and the top edges of the frames
    beside the selection; a film's comment had no pin on its picture."""

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

    def test_the_design_selection_toolbar_covers_no_other_frame_where_there_is_room(self):
        # V6f: by its selection first, on another frame where nothing else leaves room there (never on its strip)
        aid = self.store.publish(path=str(EX / "design"), title="Lumen", type="design")["id"]
        probe = ("(() => { const t = document.querySelector('.dc-tools'); if (!t || t.hidden || !t.getClientRects().length) return null; const r = t.getBoundingClientRect();"
                 " const hit = q => q.width && r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom;"
                 " const others = [...document.querySelectorAll('.dc-board')].filter(b => b.getAttribute('data-path') !== 'Main.dc.html' && b.getClientRects().length);"
                 " const strips = [...document.querySelectorAll('.dc-strip')].filter(s => s.getClientRects().length);"
                 " const s = document.querySelector('.dc-selbox').getBoundingClientRect(), gap = Math.max(r.left - s.right, s.left - r.right, r.top - s.bottom, s.top - r.bottom);"
                 " return { frames: gap <= 24 ? [] : others.filter(b => hit(b.getBoundingClientRect())).map(b => b.getAttribute('data-path')),"
                 " strips: strips.filter(s => hit(s.getBoundingClientRect())).map(s => s.title || s.textContent) } })()")
        out = {}
        for w in (1500, 1000):
            out[w] = B.drive(f"await api.size({w}, 800); await api.go({json.dumps(self.host.url(aid, theme=THEME))}, 800); {READY}\n await api.sleep(3000)\n"
                             "const q = await api.frame('(() => { const r = __design.boards[\"Main.dc.html\"].el.querySelector(\"iframe\").getBoundingClientRect(); return [r.left + r.width * 0.25, r.top + r.height * 0.35] })()')\n"
                             f"await api.mouse(q[0], q[1]); await api.sleep(900); return await api.frame({json.dumps(probe)})")
            self.assertIsNone(out[w].get("err"), out[w])
            o = out[w]["out"]
            self.assertTrue(o, (w, o))  # a toolbar shown
            self.assertEqual((o["frames"], o["strips"]), ([], []), (w, o))

    def test_a_colour_that_paints_nothing_shows_no_fill_never_black(self):
        # V6a: Properties' Background well was solid black for a transparent fill (design, slides)
        aid = self.store.publish(path=str(EX / "design"), title="Lumen", type="design")["id"]
        wells = ("[...document.querySelectorAll('input[type=color]')].filter(i => i.getClientRects().length).map(i => { const t = i.nextElementSibling;"
                 " const v = t && t.tagName === 'INPUT' ? (t.value || t.placeholder) : ''; return { v, clear: kit.isClear(v), mark: i.classList.contains('kit-nofill'),"
                 " swatch: getComputedStyle(i, '::-webkit-color-swatch').backgroundImage } })")
        out = self.drive(aid, """
          const q = await api.frame('(() => { const r = __design.boards["Main.dc.html"].el.querySelector("iframe").getBoundingClientRect(); return [r.left + r.width * 0.72, r.top + r.height * 0.25] })()')
          await api.mouse(q[0], q[1]); await api.sleep(900); await api.frame(%s); await api.sleep(600)
          return { wells: await api.frame(%s), kit: await api.frame('[kit.isClear("rgba(0, 0, 0, 0)"), kit.isClear("transparent"), kit.isClear(""), kit.isClear("#00000000"), kit.isClear("rgb(31, 27, 22)"), kit.isClear("var(--x)")]') }
        """ % (json.dumps(PROPS), json.dumps(wells)), w=1300, settle=3000)
        self.assertEqual(out["kit"], [True, True, True, True, False, False])
        self.assertTrue([w for w in out["wells"] if w["clear"]], out)  # the picture's transparent background is there
        for w in out["wells"]:
            self.assertEqual(w["mark"], w["clear"], w)
        css = (ROOT / "plugin" / "hermes_artifacts" / "types" / "design-system" / "ds.css").read_text("utf-8")
        self.assertIn(".ds-btn-primary { background: var(--color-accent); border-color: var(--color-accent);", css)  # D: as every primary action

    def test_a_films_saved_point_comment_has_its_pin_on_the_picture_at_its_moment(self):
        aid = self.store.publish(path=str(EX / "motion"), title="Film", type="motion")["id"]
        r = B.drive(f"await api.size(1200, 800); await api.go({json.dumps(self.host.url(aid, theme=THEME))}, 800); {READY}\n await api.sleep(2500)\n"
                    "await api.top('window.__post(\"pins\", [{selector: \"@t=0.00 @xy=30.00%,70.00%\", n: 1}, {selector: \"@t=0.00\", n: 2}])'); await api.sleep(400)\n"
                    "const at = () => api.frame('(() => { const f = document.getElementById(\"mo-frame\").getBoundingClientRect(); return [...document.querySelectorAll(\".mo-spin\")].map(p => { const b = p.getBoundingClientRect();"
                    " return { n: p.textContent, x: (b.left + b.width / 2 - f.left) / f.width, y: (b.top + b.height / 2 - f.top) / f.height } }) })()')\n"
                    "const o = { at0: await at() }\n"
                    "await api.top('window.__post(\"flash\", {selector: \"@t=1.50\"})'); await api.sleep(400); o.later = await at()\n"
                    "await api.top('window.__post(\"flash\", {selector: \"@t=0.00 @xy=30.00%,70.00%\"})'); await api.sleep(400); o.back = await at()\n"
                    "return o")
        self.assertIsNone(r.get("err"), r)
        o = r["out"]
        self.assertEqual([p["n"] for p in o["at0"]], ["1"], o)  # the point's comment only (the other is a moment's)
        self.assertAlmostEqual(o["at0"][0]["x"], 0.30, delta=0.01)
        self.assertAlmostEqual(o["at0"][0]["y"], 0.70, delta=0.01)
        self.assertEqual(o["later"], [], o)  # another moment: not there
        self.assertEqual([p["n"] for p in o["back"]], ["1"], o)  # its comment clicked in the list: there again


# Live round V6: the staging gallery's "Test dash2", as published (its dashboard.json and data/monthly.csv).
DASH2 = json.loads(
    '{"title": "Orders 2026", "params": {"region": ""}, "datasets": {"monthly": {"title": "Orders per month", '
    '"description": "Signed orders per month, in million USD.", "source": {"kind": "file", "path": '
    '"data/monthly.csv"}, "types": {"orders": "number", "value": "number", "target": "number"}, "updated": {"at": '
    '"2026-11-04T08:00:00Z", "by": "hermes"}}, "regions": {"title": "Orders by region", "source": {"kind": "rows", '
    '"rows": [{"region": "North", "orders": 41, "value": 512.4, "url": "https://example.com/bp"}, {"region": "South",'
    ' "orders": 17, "value": 198.0, "url": "https://example.com/south"}, {"region": "East", "orders": 9, "value": '
    '121.7, "url": "https://example.com/east"}, {"region": "West", "orders": 6, "value": 77.3, "url": '
    '"https://example.com/deb"}]}}}, "layout": [{"type": "header", "title": "Orders 2026", "subtitle": "**{orders}** '
    'orders worth **{value} M USD** so far; October is the weakest month against target."}, {"type": "filters", '
    '"items": [{"param": "region", "label": "Region", "input": "select", "options": {"source": "regions", "field": '
    '"region"}}]}, {"type": "kpis", "items": [{"id": "orders", "label": "Orders, year to date", "source": "monthly", '
    '"field": "orders", "agg": "sum", "format": "int"}, {"id": "value", "label": "Value, M USD", "source": "monthly",'
    ' "field": "value", "agg": "sum", "format": "number"}, {"label": "October", "source": "monthly", "field": '
    '"value", "where": {"month": "2026-10"}, "format": "number", "unit": "M USD", "delta": {"where": {"month": '
    '"2026-09"}, "label": "vs September"}}, {"label": "Region selected", "source": "regions", "field": "orders", '
    '"agg": "sum", "where": {"region": "{region}"}, "format": "int", "note": "orders in {param:region}"}]}, {"type": '
    '"chart", "kind": "bar", "title": "Value per month", "note": "M USD, dashed = 100 target", "source": "monthly", '
    '"x": "month", "y": "value", "xFormat": "month", "reference": {"value": 100, "label": "target"}}, {"type": '
    '"chart", "kind": "line", "title": "Value vs target", "source": "monthly", "x": "month", "y": ["value", '
    '"target"], "xFormat": "month", "labels": {"value": "Value", "target": "Target"}}, {"type": "chart", "kind": '
    '"donut", "title": "Share by region", "source": "regions", "x": "region", "y": "value"}, {"type": "chart", '
    '"kind": "hbar", "title": "Orders by region", "source": "regions", "x": "region", "y": "orders", "sort": '
    '"-orders", "format": "int"}, {"type": "table", "title": "By region", "source": "regions", "key": "region", '
    '"search": true, "sort": "-value", "columns": [{"field": "region", "label": "Region", "link": "url"}, {"field": '
    '"orders", "label": "Orders", "format": "int"}, {"field": "value", "label": "M USD", "format": "number", "bar": '
    'true}]}, {"type": "text", "text": "Figures are sample data. Source: [example](https://example.com)."}]}')
DASH2_CSV = 'month,orders,value,target\n2026-01,6,71.5,80\n2026-02,7,88.0,80\n2026-03,9,104.2,90\n2026-04,8,97.9,90\n2026-05,10,131.0,100\n2026-06,7,92.4,100\n2026-07,6,79.0,100\n2026-08,5,66.3,90\n2026-09,9,118.8,100\n2026-10,6,60.3,100\n'
# Hermes Desktop's own font (its --font-sans, styles.css --dt-font-sans), as its theme hands it to a page.
HERMES_FONT = ("'Segoe WPC', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif, 'Apple Color Emoji',"
               " 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', emoji")
# Its theme as the staging Desktop hands it to a page (read over CDP, V6d): the text tokens are the theme's
# foreground at 94/74/54% alpha (styles.css --ui-text-primary: color-mix(... 94%, transparent)), never opaque.
HERMES_DARK = {"mode": "dark", "vars": {"bg": "rgb(13, 16, 21)", "panel": "rgb(22, 24, 29)", "fg": "rgba(230, 237, 243, 0.94)",
                                        "fg2": "rgba(230, 237, 243, 0.74)", "muted": "rgba(230, 237, 243, 0.54)", "line": "rgba(116, 160, 251, 0.219)",
                                        "accent": "rgb(74, 132, 254)", "font": HERMES_FONT}}
HERMES_LIGHT = {"mode": "light", "vars": {"bg": "rgb(255, 255, 255)", "panel": "rgb(246, 248, 250)", "fg": "rgba(31, 35, 40, 0.94)",
                                          "fg2": "rgba(31, 35, 40, 0.74)", "muted": "rgba(31, 35, 40, 0.54)", "line": "rgb(208, 215, 222)",
                                          "accent": "rgb(0, 83, 253)", "font": HERMES_FONT}}
# The frame widths "Test dash2" was seen at: 906 is a 1500 px window with the comments panel open (its chart 377 px,
# its bars 20 px: where V6d's "88", "97.9" and "92.4" sat above the line), 1246 without it.
DASH2_FRAMES = (906, 1246, 1500)


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6Pages(unittest.TestCase):
    """Live round V6 (0.20.0): a design system's Markdown editor saved with a foreground button, not the accent;
    "Test dash2"'s "97.9" sat 3 px from its target line in a 1246 px frame."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_the_design_system_editors_save_is_hermes_accent(self):
        aid = self.store.publish(path=str(EX / "design-system"), title="Test design system", type="design-system")["id"]
        for theme in (HERMES_DARK, HERMES_LIGHT):
            r = B.drive(f"await api.size(1500, 900); await api.go({json.dumps(self.host.url(aid, theme=theme))}, 800); {READY}\n await api.sleep(1500)\n"
                        "await api.frame('[...document.querySelectorAll(\".ds-head .ds-btn\")].pop().click()'); await api.sleep(600)\n"
                        "return await api.frame('(() => { const b = [...document.querySelectorAll(\".ds-md-bar button\")].find(x => /^(Save|Mentés)$/.test(x.textContent.trim())); return b ? getComputedStyle(b).backgroundColor : null })()')")
            self.assertIsNone(r.get("err"), r)
            self.assertEqual(r["out"], theme["vars"]["accent"], theme["mode"])

    def test_test_dash2_values_keep_their_ink_off_the_target_line(self):
        # Measured as the eye sees it: each value's glyphs' own ink (the font's tight bounds, not its line box)
        # against every dash of the line drawn, at least 6 px apart (4 px past the halo), in Hermes' font and colours.
        aid = self.store.publish(title="Test dash2", type="dashboard", files={"dashboard.json": DASH2, "data/monthly.csv": DASH2_CSV})["id"]
        probe = r"""(() => { const svg = [...document.querySelectorAll('.c-chart svg')].find(s => s.querySelector('line.c-ref')); if (!svg) return null
          const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width, m0 = svg.getScreenCTM()
          const segs = [...svg.querySelectorAll('line.c-ref')].map(l => l.getBoundingClientRect())
          const cv = document.createElement('canvas').getContext('2d'); cv.textAlign = 'center'
          return { font: getComputedStyle(svg.querySelector('text.c-value') || svg.querySelector('text')).fontFamily, vals: [...svg.querySelectorAll('text.c-value')].map(t => {
            const cs = getComputedStyle(t); cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; const m = cv.measureText(t.textContent)
            const x = m0.e + (+t.getAttribute('x')) * k, y = m0.f + (+t.getAttribute('y')) * k
            const ink = { l: x - m.actualBoundingBoxLeft * k, r: x + m.actualBoundingBoxRight * k, t: y - m.actualBoundingBoxAscent * k, b: y + m.actualBoundingBoxDescent * k }
            const d = Math.min(...segs.map(s => Math.hypot(Math.max(0, s.left - ink.r, ink.l - s.right), Math.max(0, s.top - ink.b, ink.t - s.bottom))))
            return { v: t.textContent, d: Math.round(d * 10) / 10 } }) } })()"""
        out = {}
        for theme in (HERMES_DARK, HERMES_LIGHT):
            for w in DASH2_FRAMES:
                r = B.drive(f"await api.size({w}, 900); await api.go({json.dumps(self.host.url(aid, theme=theme, lang='en'))}, 800); {READY}\n await api.sleep(2500)\n"
                            f"await api.frame('document.fonts.ready.then(() => 1)'); await api.sleep(300); return await api.frame({json.dumps(probe)})")
                self.assertIsNone(r.get("err"), r)
                out[(theme["mode"], w)] = r["out"]
        for k, o in out.items():
            self.assertTrue(o and len(o["vals"]) >= 5, (k, o))
            self.assertIn("Segoe", o["font"], k)  # Hermes' font reached the chart
            self.assertTrue("97.9" in [v["v"] for v in o["vals"]], (k, o))
            for v in o["vals"]:
                self.assertGreaterEqual(v["d"], 6, (k, v, o))

    def test_test_dash2_values_stay_with_their_bars_never_across_the_target_line(self):
        # V6c: "88", "97.9" and "92.4" (bars just under the target of 100) were moved above the line, the line between
        # each and its bar; V6d: still so where the bars are 20 px (a 906 px frame) and in Hermes' real colours (its
        # text token is 94% alpha). Judged as the eye sees it, never by the drawing's own rule: a value sits over its
        # bar (its ink ending at most 8 px above the bar's top), or under the line inside its bar's top (ink in the
        # bar, 6 px under the line's stroke, at 4.5:1 on the bar, the token's alpha laid over it); its ink 6 px off
        # every dash drawn. Never on the far side of the line from its bar.
        aid = self.store.publish(title="Test dash2", type="dashboard", files={"dashboard.json": DASH2, "data/monthly.csv": DASH2_CSV})["id"]
        probe = r"""(() => { const svg = [...document.querySelectorAll('.c-chart svg')].find(s => s.querySelector('line.c-ref')); if (!svg) return null
          const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width, m0 = svg.getScreenCTM()
          const ly = m0.f + (+svg.querySelector('line.c-ref').getAttribute('y1')) * k, half = 0.75 * k
          const segs = [...svg.querySelectorAll('line.c-ref')].map(l => l.getBoundingClientRect())
          const bars = [...svg.querySelectorAll('rect')].filter(r => !r.closest('.c-axis, .c-grid') && r.getAttribute('fill') !== 'transparent')
            .map(r => { const b = r.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, fill: getComputedStyle(r).fill } })
          const cv = document.createElement('canvas').getContext('2d'); cv.textAlign = 'center'
          return { ly, half, vals: [...svg.querySelectorAll('text.c-value')].map(t => {
            const cs = getComputedStyle(t); cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; const m = cv.measureText(t.textContent)
            const x = m0.e + (+t.getAttribute('x')) * k, y = m0.f + (+t.getAttribute('y')) * k
            const ink = { l: x - m.actualBoundingBoxLeft * k, r: x + m.actualBoundingBoxRight * k, t: y - m.actualBoundingBoxAscent * k, b: y + m.actualBoundingBoxDescent * k }
            const d = Math.min(...segs.map(s => Math.hypot(Math.max(0, s.left - ink.r, ink.l - s.right), Math.max(0, s.top - ink.b, ink.t - s.bottom))))
            return { v: t.textContent, ink, d, fill: cs.fill, bar: bars.find(b => b.l <= x && x <= b.r) } }) } })()"""

        def rgba(s):
            v = [float(c) for c in s[s.index("(") + 1:s.index(")")].split(",")]
            return v[:3], (v[3] if len(v) > 3 else 1.0)

        def contrast(a, b):  # a (maybe with alpha) drawn on b
            (fa, al), (fb, _) = rgba(a), rgba(b)
            fa = [al * x + (1 - al) * y for x, y in zip(fa, fb)]

            def lum(c):
                f = [x / 255 for x in c]
                f = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in f]
                return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
            x, y = lum(fa), lum(fb)
            return (max(x, y) + 0.05) / (min(x, y) + 0.05)

        out = {}
        for theme in (HERMES_DARK, HERMES_LIGHT):
            for w in (400,) + DASH2_FRAMES:
                r = B.drive(f"await api.size({w}, 900); await api.go({json.dumps(self.host.url(aid, theme=theme, lang='en'))}, 800); {READY}\n await api.sleep(2500)\n"
                            f"await api.frame('document.fonts.ready.then(() => 1)'); await api.sleep(300); return await api.frame({json.dumps(probe)})")
                self.assertIsNone(r.get("err"), r)
                out[(theme["mode"], w)] = r["out"]
        inside = set()
        for k, o in out.items():
            self.assertTrue(o and (o["vals"] or k[1] == 400), (k, o))  # V6f: at 400 px none (all or none)
            ly, below = o["ly"], o["ly"] + o["half"]
            for v in o["vals"]:
                ink, bar = v["ink"], v["bar"]
                self.assertIsNotNone(bar, (k, v))
                where = (k, v["v"], ink, bar, ly)
                self.assertGreaterEqual(v["d"], 6, ("ink near a dash", where))
                if ink["t"] >= bar["t"]:  # inside its bar's top, under the line
                    inside.add(k)
                    self.assertTrue(bar["l"] <= ink["l"] and ink["r"] <= bar["r"] and ink["b"] <= bar["b"], where)
                    self.assertGreaterEqual(ink["t"] - below, 6, where)
                    self.assertGreaterEqual(contrast(v["fill"], bar["fill"]), 4.5, where)
                else:  # over its bar, close to it: never the line between them
                    self.assertLessEqual(ink["b"], bar["t"], where)
                    self.assertLessEqual(bar["t"] - ink["b"], 8, ("away from its bar", where))
        for w in DASH2_FRAMES:  # "88" fits in its bar wherever the window is 1500 px
            self.assertTrue({("dark", w), ("light", w)} <= inside, (w, inside))

    def test_every_types_own_controls_are_marked_for_the_comment_to_keep_off(self):
        # V6d: a 3D view's pick had its pin on the page's own Panel pill (its pills were not marked). The bars, pills
        # and palettes of every type are [data-comment-keep] (a dashboard's filters are content; a plain page has none)
        from test_models import PANEL
        cases = {
            "doc": (self.store.publish(path=str(EX / "doc"), title="Doc", type="doc")["id"], ["#doc-bar"]),
            "sheet": (self.store.publish(title="Budget", type="sheet", files={"sheet.json": {"title": "Budget", "sheets": [{"name": "Budget", "rows": [["Item", "Cost"]]}]}})["id"],
                      ["#sh-bar", "#sh-fbar", "#sh-foot"]),
            "board": (self.store.publish(title="Flow", type="board", files={"board.json": {"title": "Flow", "items": [{"id": "a", "type": "box", "text": "Survey"}]}})["id"],
                      [".bd-tools", ".bd-zoom", ".bd-top"]),
            "design-system": (self.store.publish(path=str(EX / "design-system"), title="Kiln", type="design-system")["id"], ["#ds-bar"]),
            "model": (self.store.publish(title="Panel", type="model", files={"model.json": PANEL})["id"], [".md-pill-l", ".md-pill-r"]),
        }
        for kind, (aid, sels) in cases.items():
            probe = json.dumps(sels) + ".map(s => { const e = document.querySelector(s); return e ? e.hasAttribute('data-comment-keep') : null })"
            r = B.drive(f"await api.size(1200, 800); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK))}, 800); {READY}\n await api.sleep(2500)\n"
                        f"return await api.frame({json.dumps(probe)})")
            self.assertIsNone(r.get("err"), r)
            self.assertEqual(r["out"], [True] * len(sels), (kind, sels, r["out"]))

    def test_test_dash2_axis_names_are_whole_at_every_width(self):
        # V6d: at 406 the bar chart's "May 2026" read "May 20…". A category's name is never cut: fewer are shown
        # (every second, third…), each whole, apart from its neighbours and inside its chart, in every chart kind.
        aid = self.store.publish(title="Test dash2", type="dashboard", files={"dashboard.json": DASH2, "data/monthly.csv": DASH2_CSV})["id"]
        probe = r"""[...document.querySelectorAll('.c-chart svg')].filter(svg => svg.querySelector('.c-axis')).map(svg => { const s = svg.getBoundingClientRect()
          const t = [...svg.querySelectorAll('.c-axis .tick text')].filter(x => x.textContent).map(x => { const b = x.getBoundingClientRect(); return { t: x.textContent, l: b.left, r: b.right, y: b.top, b: b.bottom } })
          return { w: s.width, l: s.left, r: s.right, t } })"""
        months = ["Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026", "Oct 2026"]
        for w in (400, 406, 600, 906, 1246, 1600):
            r = B.drive(f"await api.size({w}, 900); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK, lang='en'))}, 800); {READY}\n await api.sleep(2500)\n"
                        f"await api.frame('document.fonts.ready.then(() => 1)'); await api.sleep(300); return await api.frame({json.dumps(probe)})")
            self.assertIsNone(r.get("err"), r)
            self.assertEqual(len(r["out"]), 3, (w, r["out"]))  # bar, line, hbar (the donut has a legend)
            for c in r["out"]:
                self.assertTrue(c["t"], (w, c))
                for i, t in enumerate(c["t"]):
                    self.assertNotIn("…", t["t"], (w, c))
                    self.assertTrue(t["t"] in months or t["t"] in ("North", "South", "East", "West"), (w, t))
                    self.assertTrue(c["l"] - 0.5 <= t["l"] and t["r"] <= c["r"] + 0.5, ("outside its chart", w, t, c))
                    if i:
                        p = c["t"][i - 1]
                        self.assertGreaterEqual(max(t["l"] - p["r"], t["y"] - p["b"]), 2, ("touching", w, c["t"]))

    def test_a_click_from_one_artboard_into_another_keeps_its_selection_and_toolbar(self):
        # V6: the landing page's element selected, then one in the phone: the phone's selection was wiped (the landing
        # page's answer to its deselect came after it), so no toolbar and no properties
        aid = self.store.publish(path=str(EX / "design"), title="Lumen", type="design")["id"]
        at = ("(() => {{ const r = __design.boards[{p}].el.querySelector('iframe').getBoundingClientRect(); return [r.left + r.width * {x}, r.top + r.height * {y}] }})()")
        state = ("(() => { const t = document.querySelector('.dc-tools'), s = __design.state(); return { path: s.sel.path, n: s.sel.tids.length,"
                 " tools: !t.hidden && t.getClientRects().length > 0 && t.getBoundingClientRect().width > 0 } })()")
        r = B.drive(f"await api.size(1500, 900); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK))}, 800); {READY}\n await api.sleep(3000)\n"
                    f"let q = await api.frame({json.dumps(at.format(p=json.dumps('Main.dc.html'), x=0.3, y=0.15))}); await api.mouse(q[0], q[1]); await api.sleep(1000)\n"
                    f"const o = {{ first: await api.frame({json.dumps(state)}) }}\n"
                    f"q = await api.frame({json.dumps(at.format(p=json.dumps('Order.dc.html'), x=0.3, y=0.45))}); await api.mouse(q[0], q[1]); await api.sleep(1500)\n"
                    f"o.second = await api.frame({json.dumps(state)}); return o")
        self.assertIsNone(r.get("err"), r)
        o = r["out"]
        self.assertEqual((o["first"]["path"], o["first"]["tools"]), ("Main.dc.html", True), o)
        self.assertEqual((o["second"]["path"], o["second"]["tools"]), ("Order.dc.html", True), o)
        self.assertGreater(o["second"]["n"], 0, o)

    def test_no_scroll_moves_a_sheets_cells_off_their_column_headers(self):
        # V6: after an element's scrollIntoView the body's cells sat ~120 px left of their column letters (a pane
        # that clips by overflow: hidden is still a scroller; the grid alone may scroll)
        rows = [["Item", "Unit price", "Qty", "Total", "Note"] + [f"H{i}" for i in range(20)]] + [[f"r{r}", r, r * 2, r * 3, "dcell" if r == 9 else ""] for r in range(1, 30)]
        aid = self.store.publish(title="Costs", type="sheet", files={"sheet.json": {"title": "Costs", "sheets": [{"name": "Costs", "rows": rows, "freeze": {"rows": 1}}]}})["id"]
        probe = ("(() => { const cell = [...document.querySelectorAll('#sh-grid .sh-c')].find(c => c.textContent === 'dcell'), head = [...document.querySelectorAll('#sh-grid .sh-h.col')].find(c => c.textContent === 'E');"
                 " return { panes: [...document.querySelectorAll('.sh-q, .sh-vp')].map(q => q.scrollLeft + q.scrollTop).reduce((a, b) => a + b, 0),"
                 " dx: cell && head ? Math.round(cell.getBoundingClientRect().left - head.getBoundingClientRect().left) : null } })()")
        r = B.drive(f"await api.size(900, 700); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK))}, 800); {READY}\n await api.sleep(1500)\n"
                    "const o = {}\n"
                    "await api.frame('document.getElementById(\"sh-grid\").scrollLeft = 260'); await api.sleep(300)\n"
                    f"o.scrolled = await api.frame({json.dumps(probe)})\n"
                    "await api.frame('[...document.querySelectorAll(\"#sh-grid .sh-c\")].find(c => c.textContent === \"dcell\").scrollIntoView({ inline: \"start\", block: \"start\" })'); await api.sleep(300)\n"
                    f"o.intoView = await api.frame({json.dumps(probe)})\n"
                    "await api.frame('(() => { const c = [...document.querySelectorAll(\"#sh-grid .sh-c\")].find(c => c.textContent === \"dcell\"); c.tabIndex = -1; c.focus() })()'); await api.sleep(300)\n"
                    f"o.focused = await api.frame({json.dumps(probe)})\n"
                    "return o")
        self.assertIsNone(r.get("err"), r)
        for k, o in r["out"].items():
            self.assertEqual(o, {"panes": 0, "dx": 0}, (k, r["out"]))


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class DesignCrumbsAndSheet(unittest.TestCase):
    """Live round V6 (3404f5e): a design's breadcrumb ("Cupping night poster › div › div › h1") sat at the canvas's
    bottom left over the landing page's content and named the parts by their tags; with the Properties sheet open
    (a 739 px frame: Hermes' 1000 px window) the selection's toolbar steps aside, and its actions (Ask, Comment,
    Duplicate...) were nowhere. The frame widths are the tester's 1500 and 1000 px windows beside Hermes' sidebar."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()
        cls.aid = store.publish(path=str(EX / "design"), title="Test design", type="design")["id"]

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    AT = "(() => {{ const r = __design.boards[{p}].el.querySelector('iframe').getBoundingClientRect(); return [r.left + r.width * {x}, r.top + r.height * {y}] }})()"
    CRUMBS = r"""(() => { const box = q => { const b = q.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }
      const c = document.querySelector('.dc-crumbs'), t = document.querySelector('.dc-tools')
      return { path: __design.state().sel.path, crumbs: c.hidden || !c.getClientRects().length ? null : box(c), names: [...c.querySelectorAll('button')].map(b => b.textContent),
        tools: !t.hidden && t.getClientRects().length ? box(t) : null, sel: [...document.querySelectorAll('.dc-selbox')].map(box),
        frames: [...document.querySelectorAll('.dc-board')].filter(b => b.getClientRects().length).map(box),
        strips: [...document.querySelectorAll('.dc-strip')].filter(s => s.getClientRects().length && getComputedStyle(s).visibility !== 'hidden').map(box) } })()"""

    def pick(self, w, path, fx, fy, then, lang="en"):
        r = B.drive(f"await api.size({w}, 830); await api.go({json.dumps(self.host.url(self.aid, theme=HERMES_DARK, lang=lang))}, 800); {READY}\n await api.sleep(3000)\n"
                    f"const q = await api.frame({json.dumps(self.AT.format(p=json.dumps(path), x=fx, y=fy))}); await api.mouse(q[0], q[1]); await api.sleep(1200)\n" + then)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_the_breadcrumb_names_parts_and_covers_neither_the_selection_its_toolbar_nor_a_frame(self):
        meet = lambda a, b: a[0] < b[2] - 0.5 and b[0] < a[2] - 0.5 and a[1] < b[3] - 0.5 and b[1] < a[3] - 0.5
        cases = (("Poster.dc.html", 0.2, 0.42, ["Cupping night poster", "Group", "Group", "Cupping night"]),  # the tester's poster title
                 ("Main.dc.html", 0.5, 0.967, ["Landing page", "Group", "Lumen Coffee Roasters"]))  # the landing page's foot, by the old spot
        for w in (1243, 739):
            for path, fx, fy, names in cases:
                o = self.pick(w, path, fx, fy, f"return await api.frame({json.dumps(self.CRUMBS)})")
                what = (w, path, o)
                self.assertEqual(o["path"], path, what)
                self.assertEqual(o["names"], names, what)  # V6: "div", "div", "h1"
                self.assertTrue(o["crumbs"], what)
                # V6: over the landing page at 1243; never over the selection or its toolbar, nor a frame where a corner is free
                for q in o["sel"] + ([o["tools"]] if o["tools"] else []) + o["frames"] + o["strips"]:
                    self.assertFalse(meet(o["crumbs"], q), (q, what))
        o = self.pick(1243, "Poster.dc.html", 0.2, 0.42, f"return await api.frame({json.dumps(self.CRUMBS)})", lang="hu")
        self.assertEqual(o["names"], ["Cupping night poster", "Csoport", "Csoport", "Cupping night"], o)

    def test_the_toolbar_never_lies_on_the_properties_panel_after_a_crumb_selects_the_artboard(self):
        # V6d: a heading in "App: your order" selected, its crumb "App: your order" clicked: the panel was hidden and shown
        # again in one task, the toolbar measured in the wide canvas between, and it lay over the panel's "Title" label.
        meet = lambda a, b: a[0] < b[2] - 0.5 and b[0] < a[2] - 0.5 and a[1] < b[3] - 0.5 and b[1] < a[3] - 0.5
        then = r"""await api.frame('document.querySelector(".dc-crumbs button").click()'); await api.sleep(900)
          return await api.frame('(() => { const box = q => { const b = q.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }, t = document.querySelector(".dc-tools"), p = document.getElementById("dc-panel")'
            + '; return { board: __design.state().board || null, tools: !t.hidden && t.getClientRects().length ? box(t) : null, panel: p.hidden ? null : box(p), title: document.querySelector(".dc-crumbs button").textContent } })()')"""
        for w in (906, 1243):
            o = self.pick(w, "Checkout.dc.html", 0.3, 0.12, then)
            self.assertTrue(o["tools"] and o["panel"], (w, o))
            self.assertEqual(o["title"], "App: your order", (w, o))
            self.assertFalse(meet(o["tools"], o["panel"]), ("toolbar over the panel", w, o))

    def test_the_properties_sheet_offers_the_actions_of_the_toolbar_it_covers(self):
        labels = "sel => [...document.querySelectorAll(sel + ' button')].filter(b => b.getClientRects().length).map(b => b.getAttribute('aria-label'))"
        o = self.pick(739, "Main.dc.html", 0.3, 0.15, f"""
          const labels = {labels}, o = {{ tools: await api.frame('(' + labels + ')(".dc-tools")') }}
          await api.frame({json.dumps(PROPS)}); await api.sleep(600)
          o.sheet = await api.frame('[(' + labels + ')(".dc-tools"), (' + labels + ')(".dc-sheet-acts")]')
          await api.frame('[...document.querySelectorAll(".dc-sheet-acts button")].filter(b => b.getAttribute("aria-label") === "Comment").forEach(b => b.click())'); await api.sleep(900)
          o.after = await api.frame('[document.getElementById("dc-panel").hidden, document.querySelector(".dc-tools").getClientRects().length > 0]')
          o.comments = await api.top('window.__events.filter(e => e.event === "comment").map(e => [e.detail.selector, !!e.detail.rect])')
          return o""")
        self.assertIn("Comment", o["tools"], o)
        self.assertEqual(o["sheet"][0], [], o)  # the toolbar steps aside under the sheet (the rule at < 760 px)
        self.assertEqual(o["sheet"][1], o["tools"], o)  # V6: none of its actions were in the sheet
        self.assertEqual(o["after"], [True, True], o)  # one taken: back to the canvas, its toolbar there
        self.assertEqual(len(o["comments"]), 1, o)
        self.assertRegex(o["comments"][0][0], r"^Main\.dc\.html#\d+:")
        self.assertTrue(o["comments"][0][1], o)  # beside its element, with its pin


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6ePages(unittest.TestCase):
    """Live round V6e (2fb9e93): "Test dash2"'s "92.4" and "97.9" kept the dashed target line off them, but the solid
    gridline at 100 ran through the top of "92.4"'s digits and 1.7 px under "97.9" (a 906 px frame)."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_test_dash2_values_keep_their_ink_off_every_rule_of_the_plot(self):
        # Each value's glyphs' ink against every rule drawn (the target's dashes, every gridline; a gridline only
        # where no bar covers it), its half stroke counted: at least 4 px apart, in Hermes' font and colours.
        aid = self.store.publish(title="Test dash2", type="dashboard", files={"dashboard.json": DASH2, "data/monthly.csv": DASH2_CSV})["id"]
        probe = r"""(() => { const svg = [...document.querySelectorAll('.c-chart svg')].find(s => s.querySelector('line.c-ref')); if (!svg) return null
          const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width, m0 = svg.getScreenCTM()
          const rules = [...svg.querySelectorAll('line.c-ref, .c-grid line')].map(l => { const b = l.getBoundingClientRect(), h = (l.classList.contains('c-ref') ? 0.75 : 0.5) * k
            return { grid: !l.classList.contains('c-ref'), l: b.left, r: b.right, t: b.top - h, b: b.bottom + h } }).filter(s => s.r - s.l > 0.5)
          const bars = [...svg.querySelectorAll('rect')].filter(r => !r.closest('.c-axis, .c-grid') && r.getAttribute('fill') !== 'transparent').map(r => r.getBoundingClientRect())
          const cv = document.createElement('canvas').getContext('2d'); cv.textAlign = 'center'
          return { font: getComputedStyle(svg.querySelector('text.c-value') || svg.querySelector('text')).fontFamily, vals: [...svg.querySelectorAll('text.c-value')].map(t => {
            const cs = getComputedStyle(t); cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; const m = cv.measureText(t.textContent)
            const x = m0.e + (+t.getAttribute('x')) * k, y = m0.f + (+t.getAttribute('y')) * k
            const ink = { l: x - m.actualBoundingBoxLeft * k, r: x + m.actualBoundingBoxRight * k, t: y - m.actualBoundingBoxAscent * k, b: y + m.actualBoundingBoxDescent * k }
            const inBar = bars.some(b => b.left <= ink.l && ink.r <= b.right && b.top <= ink.t && ink.b <= b.bottom)
            const near = rules.filter(s => !(s.grid && inBar)).map(s => ({ grid: s.grid, d: Math.hypot(Math.max(0, s.l - ink.r, ink.l - s.r), Math.max(0, s.t - ink.b, ink.t - s.b)) }))
            return { v: t.textContent, d: Math.round(Math.min(...near.map(n => n.d)) * 10) / 10, grid: near.filter(n => n.d < 4).map(n => n.grid) } }) } })()"""
        for theme in (HERMES_DARK, HERMES_LIGHT):
            for w in (399, 739, 906, 1250):
                r = B.drive(f"await api.size({w}, 900); await api.go({json.dumps(self.host.url(aid, theme=theme, lang='en'))}, 800); {READY}\n await api.sleep(2500)\n"
                            f"await api.frame('document.fonts.ready.then(() => 1)'); await api.sleep(300); return await api.frame({json.dumps(probe)})")
                self.assertIsNone(r.get("err"), r)
                o, k = r["out"], (theme["mode"], w)
                self.assertTrue(o and (len(o["vals"]) >= 4 or w < 906), (k, o))  # V6f: narrower, all or none
                self.assertIn("Segoe", o["font"], k)
                for v in o["vals"]:
                    self.assertGreaterEqual(v["d"], 4, (k, v, o))

    DESIGN_AT = "(() => {{ const r = __design.boards[{p}].el.querySelector('iframe').getBoundingClientRect(); return [r.left + r.width * {x}, r.top + r.height * {y}] }})()"

    def design(self, w, hh, then, path="Main.dc.html", fx=0.3, fy=0.15):
        if not hasattr(self, "design_id"):
            type(self).design_id = self.store.publish(path=str(EX / "design"), title="Test design", type="design")["id"]
        r = B.drive(f"await api.size({w}, {hh}); await api.go({json.dumps(self.host.url(self.design_id, theme=HERMES_DARK, lang='en'))}, 800); {READY}\n await api.sleep(3000)\n"
                    f"const q = await api.frame({json.dumps(self.DESIGN_AT.format(p=json.dumps(path), x=fx, y=fy))}); await api.mouse(q[0], q[1]); await api.sleep(1200)\n" + then)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_the_design_toolbar_never_lies_on_the_pages_own_controls(self):
        # V6e: the landing page's heading selected, its crumb "Group" (the whole page) clicked: the toolbar went under
        # the selection, onto the bottom palette (a 1249 x 714 frame: the 1510 px window, Properties open); at 738 px
        # (the 999 px window, the sheet closed) the artboard or its Group selected put it over the palette too.
        meet = lambda a, b: a[0] < b[2] - 0.5 and b[0] < a[2] - 0.5 and a[1] < b[3] - 0.5 and b[1] < a[3] - 0.5
        probe = ("(() => { const box = q => { const b = q.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }, t = document.querySelector('.dc-tools'), v = document.getElementById('dc-view')"
                 "; return { tools: !t.hidden && t.getClientRects().length ? box(t) : null, view: box(v), ctl: [...document.querySelectorAll('.dc-pill, #dc-panel')].filter(e => !e.hidden && e.getClientRects().length).map(box) } })()")
        for w, hh, crumb in ((1249, 714, 1), (738, 714, 0), (738, 714, 1)):
            o = self.design(w, hh, f"await api.frame('document.querySelectorAll(\".dc-crumbs button\")[{crumb}].click()'); await api.sleep(900)\n"
                                   f"return await api.frame({json.dumps(probe)})")
            what = (w, crumb, o)
            self.assertTrue(o["tools"], what)
            self.assertTrue(o["view"][0] <= o["tools"][0] and o["tools"][2] <= o["view"][2] and o["view"][1] <= o["tools"][1] and o["tools"][3] <= o["view"][3], what)
            for c in o["ctl"]:
                self.assertFalse(meet(o["tools"], c), (c, what))

    def drive_page(self, aid, body, w=1000):
        r = B.drive(f"await api.size({w}, 760); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK, lang='en'))}, 800); {READY}\n await api.sleep(1500)\n" + body, timeout=300)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_a_press_that_closes_a_pages_own_menu_or_popover_activates_nothing(self):
        # V6e: the doc's Insert (+) menu open (the doc's own menu, not the kit's), Full width pressed: the menu closed AND
        # the page went wide. The same path in every type's own menus and toolbar popovers (a board's Shapes).
        btn = lambda label: f'[...document.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") || "").startsWith("{label}"))'
        doc = self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        st = '[document.querySelectorAll(".doc-rmenu").length, document.documentElement.classList.contains("doc-wide")]'
        out = self.drive_page(doc, f"""
          const st = () => api.frame({json.dumps(st)})
          const o = {{ before: await st() }}
          await api.clickIn({json.dumps(btn("Insert"))}); await api.sleep(300); o.open = await st()
          await api.clickIn({json.dumps(btn("Full width"))}); await api.sleep(400); o.pressed = await st()
          await api.clickIn({json.dumps(btn("Full width"))}); await api.sleep(400); o.again = await st()
          return o""")
        self.assertEqual(out["open"], [1, out["before"][1]], out)
        self.assertEqual(out["pressed"], [0, out["before"][1]], out)  # only the menu went
        self.assertEqual(out["again"], [0, not out["before"][1]], out)  # pressed again: it acts
        board = self.store.publish(title="Flow", type="board", files={"board.json": {"title": "Flow", "items": [{"id": "a", "type": "box", "text": "Survey"}]}})["id"]
        st = f'[document.querySelectorAll(".bd-pop").length, ({btn("Sticky note")}).getAttribute("aria-pressed")]'
        out = self.drive_page(board, f"""
          const st = () => api.frame({json.dumps(st)})
          await api.clickIn({json.dumps(btn("Shapes"))}); await api.sleep(300); const o = {{ open: await st() }}
          await api.clickIn({json.dumps(btn("Sticky note"))}); await api.sleep(300); o.pressed = await st()
          await api.clickIn({json.dumps(btn("Sticky note"))}); await api.sleep(300); o.again = await st()
          return o""")
        self.assertEqual(out["open"][0], 1, out)
        self.assertEqual(out["pressed"], [0, "false"], out)
        self.assertEqual(out["again"], [0, "true"], out)

    def test_the_properties_sheet_carries_the_breadcrumb_it_covers(self):
        # V6e: at 999 px (a 738 px frame) with the sheet open the canvas's breadcrumb was under it: the hierarchy
        # could not be climbed. The sheet has it, each crumb whole and in sight; one clicked selects its part, the
        # sheet stays open.
        probe = r"""(() => { const sh = [...document.querySelectorAll('.dc-sheet-crumbs button')], p = document.getElementById('dc-panel').getBoundingClientRect()
          return { panel: !document.getElementById('dc-panel').hidden, names: sh.map(b => b.textContent), canvas: [...document.querySelectorAll('.dc-crumbs button')].map(b => b.textContent),
            whole: sh.every(b => { const r = b.getBoundingClientRect(); return r.width > 0 && b.scrollWidth <= b.clientWidth + 0.5 && r.left >= p.left - 0.5 && r.right <= p.right + 0.5 && r.bottom <= innerHeight }),
            tids: __design.state().sel.tids.length } })()"""
        o = self.design(738, 714, f"""
          await api.frame({json.dumps(PROPS)}); await api.sleep(600)
          const o = {{ open: await api.frame({json.dumps(probe)}) }}
          await api.frame('document.querySelectorAll(".dc-sheet-crumbs button")[1].click()'); await api.sleep(800)
          o.climbed = await api.frame({json.dumps(probe)})
          return o""")
        op, cl = o["open"], o["climbed"]
        self.assertTrue(op["panel"], o)
        self.assertEqual(op["names"], op["canvas"], o)  # the canvas's own trail
        self.assertGreaterEqual(len(op["names"]), 3, o)
        self.assertTrue(op["whole"], o)
        self.assertTrue(cl["panel"], o)  # the sheet stays
        self.assertEqual(cl["names"], op["names"][:2], o)  # its part selected: the trail ends there


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6fPages(unittest.TestCase):
    """Live round V6f (a3c8b07)."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def drive_page(self, aid, body, w=1000, hh=760, settle=1500):
        r = B.drive(f"await api.size({w}, {hh}); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK, lang='en'))}, 800); {READY}\n await api.sleep({settle})\n" + body, timeout=300)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_a_press_that_closes_a_boards_tool_picker_leaves_what_esc_leaves(self):
        # V6f: Shapes open, Hand pressed: the popover closed, Hand was not armed, but Shapes stayed the tool and the
        # next click on the canvas made a shape. Closing by a press outside is Esc: Select, nothing armed.
        board = self.store.publish(title="Flow", type="board", files={"board.json": {"title": "Flow", "items": [{"id": "a", "type": "box", "text": "Survey"}]}})["id"]
        btn = lambda label: f'[...document.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") || "").startsWith("{label}"))'
        st = (f'[document.querySelectorAll(".bd-pop").length, document.documentElement.querySelector("[data-tool]").getAttribute("data-tool"),'
              f' ({btn("Select")}).getAttribute("aria-pressed"), ({btn("Hand")}).getAttribute("aria-pressed"), document.querySelectorAll(".bd-it").length]')
        out = {}
        for picker, press in (("Shapes", btn("Hand")), ("Shapes", btn("Select")), ("Shapes", "CANVAS"), ("Draw", "CANVAS")):
            o = self.drive_page(board, f"""
              const st = () => api.frame({json.dumps(st)})
              const o = {{ before: await st() }}
              await api.clickIn({json.dumps(btn(picker))}); await api.sleep(300); o.open = await st()
              if ({json.dumps(press)} === "CANVAS") await api.mouse(180, 330); else await api.clickIn({json.dumps(press)})
              await api.sleep(300); o.pressed = await st()
              await api.mouse(820, 330); await api.sleep(400); o.canvas = await st()
              await api.press('Escape', 'Escape', 27); await api.sleep(200); o.esc = await st()
              return o""")
            out[(picker, press)] = o
            what = (picker, press, o)
            self.assertEqual(o["open"][0], 1, what)
            self.assertNotEqual(o["open"][1], "select", what)
            self.assertEqual(o["pressed"][:4], [0, "select", "true", "false"], what)  # Esc's state: Select, the picker gone
            self.assertEqual(o["canvas"][4], o["before"][4], what)  # a click on the canvas makes nothing

    def design(self, w, hh, then):
        if not hasattr(self, "design_id"):
            type(self).design_id = self.store.publish(path=str(EX / "design"), title="Test design", type="design")["id"]
        r = B.drive(f"await api.size({w}, {hh}); await api.go({json.dumps(self.host.url(self.design_id, theme=HERMES_DARK, lang='en'))}, 800); {READY}\n await api.sleep(3000)\n" + then)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    TOOLS = ("(() => { const box = q => { const b = q.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }, t = document.querySelector('.dc-tools')"
             "; return { tools: !t.hidden && t.getClientRects().length ? box(t) : null, sel: [...document.querySelectorAll('.dc-selbox')].map(box)"
             ", words: [...document.querySelectorAll('.dc-note')].map(box), ctl: [...document.querySelectorAll('.dc-pill, .dc-strip')].filter(e => getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length).map(box) } })()")

    @staticmethod
    def meet(a, b):
        return a[0] < b[2] - 0.5 and b[0] < a[2] - 0.5 and a[1] < b[3] - 0.5 and b[1] < a[3] - 0.5

    def test_the_design_toolbar_keeps_off_the_canvas_title_and_stays_by_a_small_selection(self):
        # V6f: the landing page's Group (1246 px frame) or its artboard (740 px) selected: the toolbar lay over the
        # lower half of the canvas's title. The "Lumen" logo picked near the canvas's top (740 px): toolbar and crumbs
        # went under the whole artboard, 460 px off it.
        sel_group = ("const q = await api.frame(\"(() => { const r = __design.boards['Main.dc.html'].el.querySelector('iframe').getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + r.height * 0.15] })()\")"
                     "; await api.mouse(q[0], q[1]); await api.sleep(1000); await api.frame('document.querySelectorAll(\".dc-crumbs button\")[1].click()'); await api.sleep(900)\n")
        for w, then in ((1246, sel_group), (740, "await api.frame('__design.selectBoard(\"Main.dc.html\")'); await api.sleep(900)\n")):
            o = self.design(w, 750, then + f"return await api.frame({json.dumps(self.TOOLS)})")
            self.assertTrue(o["tools"] and o["words"], (w, o))
            for q in o["words"] + o["ctl"]:
                self.assertFalse(self.meet(o["tools"], q), ("toolbar on the canvas's words or a control", w, q, o))
        # the logo at the canvas's top: panned until the artboard's top is 10 px under the canvas's
        o = self.design(740, 750, """
          for (let i = 0; i < 3; i++) { const d = await api.frame("(() => { const r = __design.boards['Main.dc.html'].el.querySelector('iframe').getBoundingClientRect(), v = document.getElementById('dc-view').getBoundingClientRect(); return r.top - v.top - 10 })()")
            await api.frame(`document.getElementById("dc-view").dispatchEvent(new WheelEvent("wheel", { deltaY: ${d}, clientX: 200, clientY: 200, bubbles: true, cancelable: true }))`); await api.sleep(300) }
          const q = await api.frame("(() => { const r = __design.boards['Main.dc.html'].el.querySelector('iframe').getBoundingClientRect(); return [r.left + r.width * 0.08, r.top + r.height * 0.024] })()")
          await api.mouse(q[0], q[1]); await api.sleep(1000)
          return await api.frame(""" + json.dumps(self.TOOLS) + ")")
        self.assertTrue(o["tools"] and o["sel"], o)
        s, t = o["sel"][0], o["tools"]
        self.assertLess(s[3] - s[1], 60, o)  # a small part (the logo) was picked
        gap = max(t[0] - s[2], s[0] - t[2], t[1] - s[3], s[1] - t[3])
        self.assertLessEqual(gap, 24, ("toolbar away from its selection", o))
        for q in o["ctl"]:
            self.assertFalse(self.meet(t, q), ("toolbar on a control", q, o))

    def test_the_design_properties_cut_no_label_and_say_what_an_artboard_offers(self):
        # V6f: "Page (fills the w…" cut, and "Select an element or an artboard." while an artboard was selected.
        probe = ("(() => [...document.querySelectorAll('#dc-panel .dc-row > span, #dc-panel .dc-hint')].filter(e => e.getClientRects().length)"
                 ".map(e => ({ t: e.textContent, cut: e.scrollWidth > e.clientWidth + 0.5 || e.scrollHeight > e.clientHeight + 0.5 })))()")
        for w in (1246, 740):
            o = self.design(w, 750, "await api.frame('__design.selectBoard(\"Main.dc.html\")'); await api.sleep(600)\n"
                            f"await api.frame({json.dumps(PROPS)}); await api.sleep(800)\nreturn await api.frame({json.dumps(probe)})")
            self.assertTrue(any(x["t"].startswith("Page (fills the window)") for x in o), (w, o))
            self.assertEqual([x for x in o if x["cut"]], [], (w, o))
            self.assertNotIn("Select an element or an artboard.", [x["t"] for x in o], (w, o))

    def test_test_dash2_shows_all_of_a_series_values_or_none(self):
        # V6f: at a 739 px frame (the 1000 px window with comments open) and 400 px every second value was gone
        # ("88", "97.9", "92.4", "66.3", "60.3"): read as missing at random. All or none, each in its bar's tooltip.
        aid = self.store.publish(title="Test dash2", type="dashboard", files={"dashboard.json": DASH2, "data/monthly.csv": DASH2_CSV})["id"]
        probe = ("(() => [...document.querySelectorAll('.c-chart svg')].filter(s => s.querySelector('line.c-ref')).map(s => [s.querySelectorAll('g.c-values text').length,"
                 " [...s.querySelectorAll('rect')].filter(r => !r.closest('.c-axis, .c-grid') && r.getAttribute('fill') !== 'transparent').length]))()")
        seen = set()
        for w in (399, 739, 906, 1250):
            r = B.drive(f"await api.size({w}, 900); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK, lang='en'))}, 800); {READY}\n await api.sleep(2500)\nreturn await api.frame({json.dumps(probe)})")
            self.assertIsNone(r.get("err"), r)
            self.assertTrue(r["out"], (w, r))
            for vals, bars in r["out"]:
                self.assertIn(vals, (0, bars), (w, r["out"]))
                seen.add(vals == bars)
        self.assertEqual(seen, {True, False}, "both cases met: a wide chart shows them all, a narrow one none")


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6gPages(unittest.TestCase):
    """Live round V6g (8b4afe7)."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def drive_page(self, aid, body, w=1250, hh=716, settle=1500):
        r = B.drive(f"await api.size({w}, {hh}); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK, lang='en'))}, 800); {READY}\n await api.sleep({settle})\n" + body, timeout=300)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_a_docs_block_handles_are_not_shown_while_a_comment_is_picked_or_written(self):
        # V6g N1: a table cell picked at 1523 px: the box lay on "Add a block below" and "Drag to move", the handles the
        # pointer had brought up beside the block. They are hover-only edit affordances: hidden while picking and while
        # the new comment is written, back after (and never reported as the page's content).
        aid = self.store.publish(path=str(EX / "doc"), title="Quote process", type="doc")["id"]
        seen = '[...document.querySelectorAll(".doc-gutter button")].some(b => b.getClientRects().length && getComputedStyle(b).visibility === "visible")'
        out = self.drive_page(aid, f"""
          const cell = await api.frame('(() => {{ const r = document.querySelector(".doc-blk td").getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2] }})()')
          await api.pointer('mouseMoved', cell[0], cell[1], false); await api.sleep(300)
          const o = {{ hover: await api.frame({json.dumps(seen)}) }}
          await api.top('window.__post("comment-mode", {{on: true}})'); await api.sleep(300)
          await api.pointer('mouseMoved', cell[0] + 4, cell[1], false); await api.sleep(300); o.picking = await api.frame({json.dumps(seen)})
          await api.mouse(cell[0], cell[1]); await api.sleep(500)
          await api.top('window.__post("comment-mode", {{on: false}})'); await api.sleep(200) // the host: picked, its draft open
          await api.pointer('mouseMoved', cell[0] + 8, cell[1], false); await api.sleep(300); o.writing = await api.frame({json.dumps(seen)})
          o.picked = await api.top('window.__events.filter(e => e.event === "picked").length')
          await api.top('window.__post("pick-follow", {{on: false}})'); await api.sleep(200)
          await api.pointer('mouseMoved', cell[0] + 2, cell[1], false); await api.sleep(300); o.after = await api.frame({json.dumps(seen)})
          return o""")
        self.assertEqual(out, {"hover": True, "picking": False, "writing": False, "picked": 1, "after": True})

    def design(self, w, hh, then):
        if not hasattr(self, "design_id"):
            type(self).design_id = self.store.publish(path=str(EX / "design"), title="Test design", type="design")["id"]
        return self.drive_page(self.design_id, then, w, hh, settle=3000)

    def test_the_design_toolbar_stays_by_a_selection_the_crumbs_climbed_to(self):
        # V6g N5 (1523 px window, Properties open: a 1250 x 716 frame): the landing page's Group selected by its crumb
        # got its toolbar at the canvas's top, 106 px off; its artboard's (fewer actions) sat 10 px under it. Where the
        # whole toolbar has no room by the selection, its icons alone do, before any spot farther off.
        meet = lambda a, b: a[0] < b[2] - 0.5 and b[0] < a[2] - 0.5 and a[1] < b[3] - 0.5 and b[1] < a[3] - 0.5
        probe = ("(() => { const box = q => { const b = q.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }, t = document.querySelector('.dc-tools')"
                 "; return { tools: !t.hidden && t.getClientRects().length ? box(t) : null, sel: [...document.querySelectorAll('.dc-selbox')].map(box), crumbs: [...document.querySelectorAll('.dc-crumbs button')].map(b => b.textContent),"
                 " ctl: [...document.querySelectorAll('.dc-pill, .dc-strip, #dc-panel')].filter(e => !e.hidden && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length).map(box) } })()")
        at = "(() => { const r = __design.boards['Main.dc.html'].el.querySelector('iframe').getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + r.height * 0.15] })()"
        o = self.design(1250, 716, f"""
          const q = await api.frame({json.dumps(at)}); await api.mouse(q[0], q[1]); await api.sleep(1000)
          await api.frame('document.querySelectorAll(".dc-crumbs button")[0].click()'); await api.sleep(900); const o = {{ board: await api.frame({json.dumps(probe)}) }}
          await api.mouse(q[0], q[1]); await api.sleep(1000); await api.frame('document.querySelectorAll(".dc-crumbs button")[1].click()'); await api.sleep(900)
          o.group = await api.frame({json.dumps(probe)}); return o""")
        for k in ("board", "group"):
            s = o[k]
            self.assertTrue(s["tools"] and s["sel"], (k, o))
            self.assertTrue(any(c[0] > 900 for c in s["ctl"]), ("Properties open", k, o))
            t, sel = s["tools"], s["sel"][0]
            gap = max(t[0] - sel[2], sel[0] - t[2], t[1] - sel[3], sel[1] - t[3])
            self.assertTrue(0 <= gap <= 24, ("toolbar away from its selection", k, gap, o))
            for c in s["ctl"]:
                self.assertFalse(meet(t, c), ("toolbar on a control", k, c, o))
        self.assertEqual(o["group"]["crumbs"][-1], "Group", o)

    def test_every_shown_strip_reads_as_a_strip_at_every_width(self):
        # V6g N8 (1000 px window: a 739 px frame): "Tag (component)"'s strip was 35 px wide and empty, neither name nor
        # buttons. A strip shown has its name (cut with an ellipsis, never mid-glyph) or, too narrow for that, the
        # frame's handle, wholly inside it; none meets another.
        probe = r"""(() => { const box = q => { const b = q.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }
          return [...Object.values(__design.boards)].map(b => b.strip).filter(s => s.getClientRects().length && getComputedStyle(s).visibility !== 'hidden').map(s => {
            const vis = e => e && e.getClientRects().length && getComputedStyle(e).display !== 'none'
            const name = s.querySelector('.dc-name'), grip = s.querySelector('.dc-grip')
            return { title: s.title, strip: box(s), name: vis(name) && name.getBoundingClientRect().width > 8 ? { box: box(name), ellipsis: getComputedStyle(name).textOverflow } : null,
              grip: vis(grip) ? box(grip) : null } }) })()"""
        for w in (1250, 739, 400):
            o = self.design(w, 716, f"return await api.frame({json.dumps(probe)})")
            self.assertTrue(o, w)
            for s in o:
                what = (w, s)
                self.assertTrue(s["name"] or s["grip"], ("an empty strip", what))
                if s["name"]:
                    self.assertEqual(s["name"]["ellipsis"], "ellipsis", what)
                if s["grip"]:
                    g, st = s["grip"], s["strip"]
                    self.assertTrue(st[0] - 0.5 <= g[0] and g[2] <= st[2] + 0.5 and st[1] - 0.5 <= g[1] and g[3] <= st[3] + 0.5, ("the handle cut", what))
            for i, a in enumerate(o):
                for b in o[i + 1:]:
                    sa, sb = a["strip"], b["strip"]
                    self.assertFalse(sa[0] < sb[2] - 0.5 and sb[0] < sa[2] - 0.5 and sa[1] < sb[3] - 0.5 and sb[1] < sa[3] - 0.5, (w, a, b))
            if w == 739:
                tag = [s for s in o if s["title"].startswith("Tag")]
                self.assertTrue(tag and tag[0]["grip"], ("Tag (component) shows its handle", o))


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6hPages(unittest.TestCase):
    """Live round V6h (0440f61)."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def drive_page(self, aid, body, w=1250, hh=716, settle=1500):
        r = B.drive(f"await api.size({w}, {hh}); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK, lang='en'))}, 800); {READY}\n await api.sleep({settle})\n" + body, timeout=300)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    RING = """
      const ring = async (sel, keyboard) => {
        const q = await api.frame(`(() => { const b = ${sel}; if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
        if (!q) return null
        if (keyboard) { await api.key('Tab', 'Tab', 9); await api.frame(`${sel}.focus()`) } else await api.mouse(q[0], q[1])
        await api.sleep(250)
        await api.key('Escape', 'Escape', 27); await api.sleep(250)
        return await api.frame(`(() => { const b = ${sel}, a = document.activeElement; return a === b && b.matches(':focus-visible') })()`)
      }
"""

    def test_a_button_a_press_focused_keeps_no_ring_after_esc_one_the_keyboard_reached_keeps_it(self):
        # N13: a design's Properties pill clicked shut, then Esc: a thick ring as if the keyboard had reached it. One
        # rule for every page's buttons (bridge.js): by a press, no ring left; by the keyboard, the focus and the ring.
        cases = (("design", self.store.publish(path=str(EX / "design"), title="Test design", type="design")["id"],
                  '[...document.querySelectorAll(".dc-pill button")].find(b => /propert/i.test(b.getAttribute("aria-label") || b.title))'),
                 ("model", self.store.publish(title="Panel", type="model", files={"model.json": __import__("test_models").PANEL})["id"],
                  '[...document.querySelectorAll(".md-pill-l button")].pop()'),
                 ("doc", self.store.publish(title="Doc", type="doc", files={"doc.md": "# Doc\n\nWords."})["id"],
                  '[...document.querySelectorAll("#doc-bar button")].filter(b => !b.disabled && b.getClientRects().length).pop()'),
                 # V6k: a free-form page (no kit.js): its Reset clicked, then Esc, rang. The rule is the bridge's, for every page.
                 ("page", self.store.publish(title="Plain", type="page", html=PICK_PAGE.replace("</main>", "<button id=reset>Reset</button></main>"))["id"],
                  'document.getElementById("reset")'))
        for kind, aid, sel in cases:
            o = self.drive_page(aid, self.RING + f"const keys = await ring({json.dumps(sel)}, true); return {{ mouse: await ring({json.dumps(sel)}, false), keys }}", settle=2500)
            self.assertEqual(o, {"mouse": False, "keys": True}, (kind, o))

    def test_a_strip_cut_by_the_canvas_edge_shows_its_name_in_the_part_in_sight(self):
        # N6: a strip cut by the canvas's left edge showed an empty 26 px sliver (its name off screen). Its name, or
        # its handle, is in the part in sight.
        aid = self.store.publish(path=str(EX / "design"), title="Test design", type="design")["id"]
        o = self.drive_page(aid, """
          const out = []
          for (const keep of [26, 60, 140]) {
            const d = await api.frame(`(() => { const s = __design.boards["Main.dc.html"].strip.getBoundingClientRect(), v = document.getElementById("dc-view").getBoundingClientRect(); return s.right - (v.left + ${keep}) })()`)
            await api.frame(`document.getElementById("dc-view").dispatchEvent(new WheelEvent("wheel", { deltaX: ${d}, deltaY: 0, clientX: 300, clientY: 300, bubbles: true, cancelable: true }))`); await api.sleep(400)
            out.push(await api.frame(`(() => { const b = __design.boards["Main.dc.html"], v = document.getElementById("dc-view").getBoundingClientRect(), s = b.strip.getBoundingClientRect()
              const shown = [b.name, b.grip].filter(e => e.getClientRects().length && getComputedStyle(e).display !== "none").map(e => { const r = e.getBoundingClientRect(); return [Math.max(r.left, v.left), Math.min(r.right, s.right)] }).filter(([l, r]) => r - l >= 10)
              return { keep: ${keep}, sliver: [Math.max(s.left, v.left), s.right], shown, title: b.strip.title } })()`))
          }
          return out""", settle=3000)
        for s in o:
            self.assertTrue(s["shown"], s)
            self.assertTrue(all(s["sliver"][0] - 0.5 <= l and r <= s["sliver"][1] + 0.5 for l, r in s["shown"]), s)
            self.assertTrue(s["title"], s)

    def test_esc_on_the_menu_of_a_block_just_added_takes_it_back(self):
        # N10: "Add a block below" makes an empty paragraph and opens the block menu on it (as on main 414fa59); Esc
        # on that menu left the empty paragraph behind. It takes it back while still empty; a block typed in stays.
        # V6j: that Esc sent an insert and a delete: the doc saved (its rev and time moved) with nothing changed. The
        # new block is sent once something is written in it, never for "+" and Esc.
        from hermes_artifacts import docs
        aid = self.store.publish(title="Doc", type="doc", files={"doc.md": "# Doc\n\nFirst paragraph.\n\nSecond paragraph."})["id"]
        plus = """
          const n = () => api.frame('document.querySelectorAll(".doc-blk").length')
          const plus = async () => {
            const b = await api.frame('(() => { const r = document.querySelectorAll(".doc-blk")[1].getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2] })()')
            await api.pointer('mouseMoved', b[0], b[1], false); await api.sleep(300)
            const p = await api.frame('(() => { const e = document.querySelector(".doc-g-plus"); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()')
            await api.mouse(p[0], p[1]); await api.sleep(700)
          }"""
        rev0 = docs.read(aid)["rev"]
        o = self.drive_page(aid, plus + """
          const o = { before: await n() }
          await plus(); o.added = await n(); o.menu = await api.frame('!!document.querySelector(".doc-slash:not([hidden])")')
          await api.key('Escape', 'Escape', 27); await api.sleep(3200); o.esc = await n()
          return o""")
        self.assertEqual(o, {"before": 3, "added": 4, "menu": True, "esc": 3}, o)
        self.assertEqual(docs.read(aid)["rev"], rev0)  # nothing sent
        o = self.drive_page(aid, plus + """
          await plus(); await api.type('kept'); await api.sleep(300); await api.key('Escape', 'Escape', 27); await api.sleep(2500)
          return { typed: await n() }""")
        self.assertEqual(o, {"typed": 4}, o)
        r = docs.read(aid)
        self.assertGreater(r["rev"], rev0)
        self.assertEqual([b["md"] for b in r["blocks"]], ["# Doc", "First paragraph.", "kept", "Second paragraph."])
        # V6k: a type chosen on that menu (Heading 2, Bulleted list) and nothing typed: Esc, or a click elsewhere,
        # left the empty block saved ("##" drawn 0 px high). It stays unsent while empty and goes when left.
        rev1 = r["rev"]
        pick = "const it = await api.frame('(() => { const b = [...document.querySelectorAll(\".doc-slash .doc-rm-item\")].find(b => b.textContent.trim() === %s); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()'); await api.mouse(it[0], it[1]); await api.sleep(500)"
        for label, leave in (("Heading 2", "await api.key('Escape', 'Escape', 27)"), ("Bulleted list", "await api.key('Escape', 'Escape', 27)"),
                             ("Heading 2", "const t = await api.frame('(() => { const r = document.querySelectorAll(\".doc-blk\")[0].getBoundingClientRect(); return [r.left + 30, r.top + r.height / 2] })()'); await api.mouse(t[0], t[1])")):
            o = self.drive_page(aid, plus + f"""
              await plus(); {pick % json.dumps(json.dumps(label))[1:-1]}
              const o = {{ chosen: await n() }}
              {leave}; await api.sleep(3200); o.left = await n()
              return o""")
            self.assertEqual(o, {"chosen": 5, "left": 4}, (label, o))
            self.assertEqual(docs.read(aid)["rev"], rev1, (label, "an empty block was sent"))
        o = self.drive_page(aid, plus + f"""
          await plus(); {pick % json.dumps(json.dumps("Heading 2"))[1:-1]}
          await api.type('Kept head'); await api.sleep(300); await api.key('Escape', 'Escape', 27); await api.sleep(2500)
          return {{ n: await n() }}""")
        self.assertEqual([b["md"] for b in docs.read(aid)["blocks"]], ["# Doc", "First paragraph.", "## Kept head", "kept", "Second paragraph."], o)

    def test_an_empty_heading_stored_is_drawn_a_line_high(self):
        aid = self.store.publish(title="Doc", type="doc", files={"doc.md": "# Doc\n\nFirst.\n\n##\n\nLast."})["id"]
        o = self.drive_page(aid, "return await api.frame('[...document.querySelectorAll(\".doc-blk\")].map(b => Math.round(b.getBoundingClientRect().height))')")
        self.assertEqual(len(o), 4, o)
        self.assertGreaterEqual(o[2], 20, o)


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class RoundV6hBoardPick(unittest.TestCase):
    """V6h B2: a board's shape picked on its words ("Ship"): the part picked was the words inside the pill, so the box
    kept 8 px off them and lay 5 px off the pill drawn round them. A board item is picked whole, its strokes counted."""

    @classmethod
    def setUpClass(cls):
        from hermes_artifacts import store
        cls.store = store
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_a_board_item_picked_on_its_words_is_the_whole_item(self):
        board = {"title": "B", "items": [{"id": "a", "type": "box", "text": "Draft"}, {"id": "b", "type": "box", "text": "Ship", "near": "a"},
                                          {"id": "n", "type": "note", "text": "Owner: Anna", "near": "b"}]}
        aid = self.store.publish(title="B", type="board", files={"board.json": board})["id"]
        out = []
        for word in ("Ship", "Owner"):
            r = B.drive(f"await api.size(1250, 716); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK, lang='en'))}, 800); {READY}\n await api.sleep(1500)\n" + f"""
              const w = await api.frame(`(() => {{ const it = [...document.querySelectorAll(".bd-it")].find(e => e.textContent.includes({json.dumps(word)})), rg = document.createRange()
                const t = document.createTreeWalker(it, NodeFilter.SHOW_TEXT); let n; while ((n = t.nextNode()) && !n.nodeValue.trim()); rg.selectNodeContents(n)
                const q = rg.getBoundingClientRect(), b = it.getBoundingClientRect(); return {{ at: [q.left + q.width / 2, q.top + q.height / 2], item: [b.left, b.top, b.right, b.bottom] }} }})()`)
              await api.top('window.__post("comment-mode", {{on: true}})'); await api.sleep(300)
              await api.mouse(w.at[0], w.at[1]); await api.sleep(500)
              const ev = await api.top('window.__events.filter(e => e.event === "picked").pop()')
              return {{ item: w.item, rect: ev && ev.detail.rect, label: ev && ev.detail.label }}""", timeout=200)
            self.assertIsNone(r.get("err"), r)
            out.append(r["out"])
        for o in out:
            r, it = o["rect"], o["item"]
            self.assertTrue(r, o)
            self.assertTrue(r["x"] <= it[0] + 0.5 and r["y"] <= it[1] + 0.5 and r["x"] + r["w"] >= it[2] - 0.5 and r["y"] + r["h"] >= it[3] - 0.5, o)
        self.assertEqual([o["label"] for o in out], ["Shape · Ship", "Sticky note · Owner: Anna"], out)

    def test_a_connector_picked_is_its_drawn_line(self):
        # V6j: a connector's own box is 0 x 0 at the canvas's origin, its lines drawn overflowing it; that corner was
        # counted, so the part picked was 750 x 296 px and the comment's box went 57 px off past it. Its strokes only.
        board = {"title": "B", "items": [{"id": "a", "type": "box", "text": "Review"}, {"id": "b", "type": "box", "text": "Ship"},
                                          {"id": "ab", "type": "arrow", "from": "a", "to": "b", "label": "yes"}]}
        aid = self.store.publish(title="B", type="board", files={"board.json": board})["id"]
        r = B.drive(f"await api.size(1250, 716); await api.go({json.dumps(self.host.url(aid, theme=HERMES_DARK, lang='en'))}, 800); {READY}\n await api.sleep(1500)\n" + """
          const w = await api.frame(`(() => { const ps = [...document.querySelectorAll('[data-id="ab"] path')].filter(p => !/^(none|transparent|rgba\\(0, 0, 0, 0\\))$/.test(getComputedStyle(p).stroke))
            const ink = ps.map(p => p.getBoundingClientRect()), p = ps[0], m = p.getScreenCTM(), q = p.getPointAtLength(p.getTotalLength() * 0.2)
            return { at: [q.x * m.a + m.e, q.y * m.d + m.f], ink: [Math.min(...ink.map(b => b.left)), Math.min(...ink.map(b => b.top)), Math.max(...ink.map(b => b.right)), Math.max(...ink.map(b => b.bottom))] } })()`)
          await api.top('window.__post("comment-mode", {on: true})'); await api.sleep(300)
          await api.mouse(w.at[0], w.at[1]); await api.sleep(500)
          const ev = await api.top('window.__events.filter(e => e.event === "picked").pop()')
          return { ink: w.ink, rect: ev && ev.detail.rect, label: ev && ev.detail.label }""", timeout=200)
        self.assertIsNone(r.get("err"), r)
        o = r["out"]
        rect, ink = o["rect"], o["ink"]
        self.assertTrue(rect and o["label"].startswith("Arrow"), o)
        # the strokes' box (half the stroke round it), not the canvas's corner
        self.assertTrue(ink[0] - 4 <= rect["x"] and rect["x"] + rect["w"] <= ink[2] + 4 and ink[1] - 4 <= rect["y"] and rect["y"] + rect["h"] <= ink[3] + 4, o)
        # V6l: the spot after its label is on its own line (the pin sat between "yes" and the arrowhead): not free
        self.assertIn("lr", rect, o)
        self.assertIs(rect["fw"], False, o)

