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


if __name__ == "__main__":
    unittest.main()
