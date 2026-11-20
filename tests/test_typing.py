"""Words the user is typing, not saved yet, are never written over by Hermes (acceptance round 2: a doc).

(a) The server: a page says which parts it is typing in (op "typing": a doc's block, "<sheet>!A1", a board's
    item); Hermes' edit of such a part within store.TYPING_TTL_S is a conflict, nothing changed, and the error
    tells it to read again and redo. Other parts, the user's own edits and a mark gone stale are not held.
(b) The doc page in a browser: typing inside a sentence sends the mark before the 700 ms save, so Hermes'
    edit of that block within the debounce is refused and the typed words land; and when Hermes' edit does
    land first (no mark yet), the page keeps the words as a suggestion on Hermes' text and says so.
(c) The same inside Hermes Desktop's own bridge (plugin.js), typing on for 10 s and more: saved every 2 s,
    Hermes held off the whole time, a lost race keeps every key as a suggestion and says so. A board item's
    text the same; a sheet cell's editor is saved when it closes, the page going away included."""

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "plugin"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, boards, docs, sheets, store  # noqa: E402

import _browser as B  # noqa: E402


def op(aid, name, args):
    return api.handle("POST", f"/artifacts/{aid}/op", {}, {"op": name, "args": args})


class ServerHoldsTypedParts(unittest.TestCase):
    def test_a_doc_block_typed_in(self):
        aid = store.publish(title="T", type="doc", files={"doc.md": "# T\n\nAgent final.\n\nOther."})["id"]
        r = docs.read(aid)
        b = [x["id"] for x in r["blocks"]]
        self.assertEqual(op(aid, "typing", {"keys": [b[1]]}), {"ok": True})
        with self.assertRaises(docs.DocError) as cm:
            docs.apply(aid, [{"op": "replace", "block": b[1], "md": "Agent last."}], by="hermes", base_rev=r["rev"])
        e = cm.exception
        self.assertEqual((e.code, e.extra["ids"]), ("conflict", [b[1]]))
        self.assertIn("the user is typing in 1 of the blocks you edit; nothing was changed", e.message)
        self.assertIn("ha_live_read", e.next)
        self.assertEqual(docs.read(aid, blocks=[b[1]])["blocks"][0]["md"], "Agent final.")
        # another block, and the user's own save, are not held
        docs.apply(aid, [{"op": "replace", "block": b[2], "md": "Hermes."}], by="hermes", base_rev=r["rev"])
        docs.apply(aid, [{"op": "replace", "block": b[1], "md": "Agent finaYYl."}], by="user")
        self.assertEqual(docs.read(aid, blocks=[b[1]])["blocks"][0]["md"], "Agent finaYYl.")

    def test_a_tab_removed_takes_the_block_typed_in_along(self):
        aid = store.publish(title="T", type="doc", files={"doc.md": "# T\n\nA."})["id"]
        two = docs.apply(aid, [{"op": "add_tab", "title": "Two", "md": "Typed here."}], by="user")["new_tab"]
        r = docs.read(aid, two)
        op(aid, "typing", {"keys": [r["blocks"][0]["id"]]})
        with self.assertRaises(docs.DocError) as cm:
            docs.apply(aid, [{"op": "delete_tab"}], by="hermes", tab=two, base_rev=r["rev"])
        self.assertEqual(cm.exception.code, "conflict")
        self.assertEqual(docs.read(aid, two)["blocks"][0]["md"], "Typed here.")

    def test_a_stale_mark_holds_nothing(self):
        aid = store.publish(title="T", type="doc", files={"doc.md": "# T\n\nA."})["id"]
        r = docs.read(aid)
        b = r["blocks"][1]["id"]
        store.typing_set(aid, [b])
        old = store.TYPING_TTL_S
        store.TYPING_TTL_S = 0.05
        try:
            time.sleep(0.1)
            self.assertEqual(store.typing_hits(aid, [b]), [])
            docs.apply(aid, [{"op": "replace", "block": b, "md": "B."}], by="hermes", base_rev=r["rev"])
            store.typing_set(aid, [])  # stale marks are pruned, and the file goes with the last of them
            self.assertFalse((store.root() / "typing.json").exists())
        finally:
            store.TYPING_TTL_S = old

    def test_a_sheet_cell_typed_in(self):
        aid = store.publish(title="S", type="sheet", files={"sheet.json": {"sheets": [{"name": "A", "cells": {"A1": 1, "B1": 2}}]}})["id"]
        r = sheets.read(aid)
        sid = r["sheet"] if isinstance(r.get("sheet"), str) else r["sheets"][0]["id"]
        op(aid, "typing", {"keys": [f"{sid}!A1"]})
        with self.assertRaises(sheets.SheetError) as cm:
            sheets.apply(aid, [{"op": "set", "range": "A1:B1", "values": [[5, 6]]}], by="hermes", base_rev=r["rev"])
        self.assertEqual((cm.exception.code, cm.exception.extra["ids"]), ("conflict", ["A1"]))
        sheets.apply(aid, [{"op": "set", "range": "B1", "values": [[6]]}], by="hermes", base_rev=r["rev"])

    def test_a_board_item_typed_in(self):
        aid = store.publish(title="B", type="board", files={"board.json": {"title": "B", "items": [
            {"id": "n", "type": "note", "text": "Mine", "x": 0, "y": 0}, {"id": "m", "type": "note", "text": "Other", "x": 300, "y": 0}]}})["id"]
        rev = boards.read(aid)["rev"]
        op(aid, "typing", {"keys": ["n"]})
        for ops in ({"op": "set", "id": "n", "text": "Hermes"}, {"op": "delete", "ids": ["n"]}):
            with self.assertRaises(boards.BoardError) as cm:
                boards.apply(aid, ops, by="hermes", base_rev=rev)
            self.assertEqual((cm.exception.code, cm.exception.extra["ids"]), ("conflict", ["n"]))
        boards.apply(aid, {"op": "set", "id": "m", "text": "Hermes"}, by="hermes", base_rev=rev)


READY = "await api.sleep(300); for (let i = 0; i < 60; i++) { if (await api.top('window.__events.some(e => e.event === \"ready\")')) break; await api.sleep(150) }"
# The caret after "fina" in the second block, then two keys typed (Input.insertText: the page's input event),
# then, 120 ms later (inside the 700 ms save debounce), Hermes' edit of that block (the host's hook).
TYPE_THEN_HERMES = """
  await api.clickIn('document.querySelectorAll(".doc-blk[data-block] p")[0]'); await api.sleep(300)
  await api.frame(`(() => { const p = document.querySelectorAll(".doc-blk[data-block] p")[0]; const t = p.firstChild;
    const r = document.createRange(); r.setStart(t, t.nodeValue.indexOf("final") + 4); r.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(r) })()`)
  await api.type("Y"); await api.type("Y")
  await api.sleep(120)
  const hermes = await (await fetch(HOOK)).json()
  await api.top('window.__post("doc", {})')
  await api.sleep(3000)  // the save (700 ms after the keys), its answer, a read
  return { hermes, text: await api.frame('document.querySelectorAll(".doc-blk[data-block] p")[0].textContent'),
    notes: await api.top('window.__ops.filter(o => o.op === "notify").map(o => o.args.message).join(" | ")') }
"""


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class DocPageRace(unittest.TestCase):
    """Hermes' edit of the block being typed in, 120 ms after the keys (inside the 700 ms save debounce)."""

    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def setUp(self):
        self.aid = store.publish(title="Race", type="doc", files={"doc.md": "# Race\n\nAgent final. Tail."})["id"]
        r = docs.read(self.aid)
        self.rev, self.bid = r["rev"], r["blocks"][1]["id"]

    def hermes(self, unmarked=False):
        """Hermes' ha_live_edit on what it read before the keys. unmarked: as if the page's mark lost the race."""
        if unmarked:
            store.typing_set(self.aid, [])
            p = store.root() / "typing.json"
            if p.exists():
                p.unlink()
        else:
            # The page's mark goes key -> bridge -> host -> fetch -> server: ~10 ms idle, but under a loaded full
            # suite it can take longer than the 120 ms the driver waits, and the edit then lands as in the lost race
            # (the test's other case). This case is about a mark that is there: wait for it (at most 2 s).
            end = time.monotonic() + 2
            while not store.typing_hits(self.aid, [self.bid]) and time.monotonic() < end:
                time.sleep(0.01)
        try:
            docs.apply(self.aid, [{"op": "replace", "block": self.bid, "md": "Agent last. Tail."}], by="hermes", base_rev=self.rev)
            return "applied"
        except docs.DocError as e:
            return e.code

    def run_page(self, hook):
        self.host.hooks["h"] = hook
        url = f"http://127.0.0.1:{self.host.port}/hook/h"
        r = B.drive(f"const HOOK = {json.dumps(url)}; await api.go({json.dumps(self.host.url(self.aid))}, 800); {READY}\n" + TYPE_THEN_HERMES)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_the_mark_holds_hermes_edit_and_the_keys_land(self):
        out = self.run_page(lambda: self.hermes())
        self.assertEqual(out["hermes"], "conflict", out)  # Hermes is told its edit did not land
        self.assertEqual(docs.read(self.aid, blocks=[self.bid])["blocks"][0]["md"], "Agent finaYYl. Tail.")
        self.assertEqual(out["text"], "Agent finaYYl. Tail.")

    def test_a_lost_race_keeps_the_keys_as_a_suggestion_and_says_so(self):
        out = self.run_page(lambda: self.hermes(unmarked=True))
        self.assertEqual(out["hermes"], "applied", out)
        self.assertEqual(docs.read(self.aid, blocks=[self.bid])["blocks"][0]["md"], "Agent last. Tail.")
        st = docs.read(self.aid)
        self.assertIn("finaYYl", json.dumps(st.get("suggestions"), ensure_ascii=False), st.get("suggestions"))
        self.assertRegex(out["notes"], "Hermes changed this block meanwhile|közben a Hermes módosította", out)  # Hermes' own toast (EN or HU)


# The doc page inside Hermes Desktop's own bridge: plugin.js (its useBridge, makeFrames and op dispatch, the
# hidden-frame hold, the notify toast) as a module on the tests' React (_dom), the frame a real iframe of the
# doc page, and the host's transport (ctx.rest) a fetch to api.handle. So every op the page sends,
# typing included, goes the way it goes in the app, not through the test host's own port (DocPageRace).
DESKTOP_TOP = """<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body><div id="root"></div><script type="module">
import * as M from './plugin.mjs'
import * as R from './react.mjs'
window.__STRINGS = M.STRINGS.en
const aid = new URLSearchParams(location.search).get('aid')
window.__rests = []
M.$list.set([{ id: aid, title: 'Race', version: 1, versions: [1], type: 'doc' }]); M.$selected.set(aid)
const F = M.makeFrames({}), rec = F.want(aid + ':1', 1, aid)
F.setSrc(rec, '/frame/' + aid)
window.__shown = () => F.shown === rec
const ctx = { rest: async (url, o) => {
  const body = o && o.body
  window.__rests.push(body ? body.op : url)
  const r = await fetch(body ? '/op/' + aid : '/dom/none', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  const j = await r.json()
  if (j && j.ok === false && j.__error) throw new Error(j.__error)
  return j
} }
function T() {
  const ref = R.useRef(null), portRef = R.useRef(null)
  M.useBridge(ref, M.$list.get()[0], ctx, portRef, rec, F)
  // (not sandboxed here: the driver reaches only frames in the page's own process; the ops are the same)
  return R.jsx('iframe', { ref, src: rec.src, title: 'Race' })
}
R.mount(() => R.jsx(T, {}), document.getElementById('root'))
window.__ready = true
</script></body></html>"""
WORDS = "abcdefghijklmnopqrstuvwxyz0123456789"
# The caret at the end of the paragraph, then one key every 250 ms for `secs` seconds; the hooks named in
# `at` ({ms: hook}) run once that long into the typing, their answers kept in order.
STEADY = """
  for (let i = 0; i < 100 && !(await api.top('Boolean(window.__ready) && window.__shown()')); i++) await api.sleep(100)
  await api.clickIn('document.querySelectorAll(".doc-blk[data-block] p")[0]'); await api.sleep(300)
  await api.frame(`(() => { const p = document.querySelectorAll(".doc-blk[data-block] p")[0];
    const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r) })()`)
  const hooks = [], t0 = Date.now(), due = Object.entries(AT).map(([ms, h]) => [Number(ms), h]).sort((a, b) => a[0] - b[0])
  let typed = ''
  for (let i = 0; Date.now() - t0 < SECS * 1000; i++) {
    const ch = WORDS[i % WORDS.length]; await api.type(ch); typed += ch
    while (due.length && Date.now() - t0 >= due[0][0]) { const [ms, h] = due.shift(); hooks.push([h, Date.now() - t0, await (await fetch(BASE + '/hook/' + h)).json()]) }
    await api.sleep(250)
  }
  await api.sleep(3000)
  return { typed, hooks, text: await api.frame('document.querySelectorAll(".doc-blk[data-block] p")[0].textContent'),
    rests: await api.top('window.__rests'), notes: await api.top('(window.__notes || []).join(" | ")') }
"""


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class DocThroughDesktopBridge(unittest.TestCase):
    """Typing in a doc as it runs in Hermes Desktop, for 10 s and more, while Hermes edits that block."""

    @classmethod
    def setUpClass(cls):
        import _dom
        cls.host = B.Host()
        src = (ROOT / "plugin" / "desktop" / "plugin.js").read_text("utf-8")
        src = (src.replace("from '@hermes/plugin-sdk'", "from './sdk.mjs'")
                  .replace("from 'react/jsx-runtime'", "from './react.mjs'").replace("from 'react'", "from './react.mjs'"))
        cls.host.files.update({
            "plugin.mjs": src + "\nexport { makeFrames, useBridge, $list, $selected, STRINGS }\n",
            "react.mjs": _dom.REACT,
            # Hermes' own toast: what the frame's notes become (plugin.js toast -> host.notify)
            "sdk.mjs": _dom.SDK.replace("composer: {", "notify: n => (window.__notes = window.__notes || []).push(n.message), composer: {"),
            "index.html": DESKTOP_TOP})

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def setUp(self):
        self.aid = store.publish(title="Race", type="doc", files={"doc.md": "# Race\n\nStart."})["id"]
        self.bid = docs.read(self.aid)["blocks"][1]["id"]

    def md(self):
        return docs.read(self.aid, blocks=[self.bid])["blocks"][0]["md"]

    def hermes(self, unmarked=False):
        """Hermes' ha_live_edit of the block, on what it reads now (as the agent does: read, then edit)."""
        real = store.typing_hits
        if unmarked:  # as if the page's mark lost the race (it arrives after the edit)
            store.typing_hits = lambda aid, keys: []
        try:
            docs.apply(self.aid, [{"op": "replace", "block": self.bid, "md": "Hermes wrote this."}], by="hermes",
                       base_rev=docs.read(self.aid)["rev"])
            return "applied"
        except docs.DocError as e:
            return [e.code, e.message]
        finally:
            store.typing_hits = real

    def run_typing(self, secs, at):
        self.host.hooks.update({"saved": self.md, "hermes": self.hermes, "hermes_unmarked": lambda: self.hermes(unmarked=True)})
        base = f"http://127.0.0.1:{self.host.port}"
        r = B.drive(f"const BASE = {json.dumps(base)}, WORDS = {json.dumps(WORDS)}, SECS = {secs}, AT = {json.dumps(at)};"
                    f"await api.go({json.dumps(base + '/dom/index.html?aid=' + self.aid)}, 800);\n" + STEADY, timeout=240)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_steady_typing_is_saved_every_2_s_and_holds_hermes_off(self):
        out = self.run_typing(12, {"3000": "saved", "4500": "hermes", "6000": "saved", "9000": "hermes", "10500": "saved"})
        typed, hooks = out["typed"], out["hooks"]
        self.assertGreater(len(typed), 30)
        # every op the page sent went through Desktop's own bridge, the marks included
        self.assertIn("typing", out["rests"])
        self.assertIn("doc.edit", out["rests"])
        for name, ms, ans in hooks:
            if name == "saved":  # saved while the typing goes on, at most ~2 s behind it (a key every 250 ms)
                self.assertTrue(ans.startswith("Start."), ans)
                self.assertGreaterEqual(len(ans) - len("Start."), (ms - 2600) // 250, (ms, ans))
            else:  # Hermes' edit of the block being typed in: refused, and it is told why
                self.assertEqual(ans[0], "conflict", (ms, ans))
                self.assertIn("the user is typing", ans[1])
        self.assertEqual(self.md(), "Start." + typed)  # not one key lost
        self.assertEqual(out["text"], "Start." + typed)

    def test_a_lost_race_during_steady_typing_keeps_every_key_and_says_so(self):
        out = self.run_typing(10, {"4000": "hermes_unmarked"})
        typed = out["typed"]
        self.assertEqual(out["hooks"][0][2], "applied")
        self.assertEqual(self.md(), "Hermes wrote this.")  # Hermes' text stands...
        sugs = docs.read(self.aid).get("suggestions") or []
        # ...and every key typed, before and after it landed, is the person's suggestion on it
        self.assertTrue(any(("Start." + typed) in json.dumps(s, ensure_ascii=False) for s in sugs), (typed, sugs))
        self.assertRegex(out["notes"], "Hermes changed this block meanwhile|közben a Hermes módosította", out["notes"])
        self.assertEqual(out["text"], "Start." + typed)  # still on screen where it was typed


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class BoardTextTyping(unittest.TestCase):
    """A board item's text typed in for 6 s on end: saved every 2 s while the editor stays open, Hermes held off."""

    def test_steady_typing_in_an_item_is_saved_and_held(self):
        host = B.Host()
        try:
            aid = store.publish(title="B", type="board", files={"board.json": {"title": "B", "items": [
                {"id": "n", "type": "note", "text": "Mine", "x": 100, "y": 100}]}})["id"]
            text = lambda: next(i for i in boards.read(aid)["items"] if i["id"] == "n")["text"]

            def hermes():
                try:
                    boards.apply(aid, {"op": "set", "id": "n", "text": "Hermes"}, by="hermes", base_rev=boards.read(aid)["rev"])
                    return "applied"
                except boards.BoardError as e:
                    return e.code
            host.hooks.update({"text": text, "hermes": hermes})
            base = f"http://127.0.0.1:{host.port}"
            r = B.drive(f"const BASE = {json.dumps(base)}; await api.go({json.dumps(host.url(aid))}, 800); {READY}" + """
  await api.clickIn('document.querySelector(".bd-it[data-id=n]")'); await api.sleep(200)
  await api.key('Enter', 'Enter', 13); await api.sleep(300)
  await api.frame('(() => { const t = document.querySelector("textarea.bd-edit"); t.setSelectionRange(t.value.length, t.value.length); return !!t })()')
  const seen = [], t0 = Date.now(); let typed = ''
  for (let i = 0; Date.now() - t0 < 6000; i++) {
    const ch = 'xyz'[i % 3]; await api.type(ch); typed += ch
    if (i === 12 || i === 20) seen.push([Date.now() - t0, await (await fetch(BASE + '/hook/text')).json(), await (await fetch(BASE + '/hook/hermes')).json()])
    await api.sleep(250)
  }
  const open = await api.frame('!!document.querySelector("textarea.bd-edit")')
  await api.key('Enter', 'Enter', 13); await api.frame('document.activeElement && document.activeElement.blur()'); await api.sleep(1500)
  return { typed, seen, open }
""")
            self.assertIsNone(r.get("err"), r)
            out = r["out"]
            self.assertTrue(out["open"])  # the editor stayed open all along
            for ms, saved, h in out["seen"]:
                self.assertTrue(saved.startswith("Mine"), saved)
                self.assertGreaterEqual(len(saved) - 4, (ms - 2600) // 250, (ms, saved))  # at most ~2 s behind
                self.assertEqual(h, "conflict")  # Hermes' edit of it while typed in: refused
            self.assertEqual(text(), "Mine" + out["typed"])
        finally:
            host.close()

    def test_a_frame_that_goes_mid_typing_keeps_the_words(self):
        host = B.Host()
        try:
            aid = store.publish(title="B", type="board", files={"board.json": {"title": "B", "items": [
                {"id": "n", "type": "note", "text": "Mine", "x": 100, "y": 100}]}})["id"]
            r = B.drive(f"await api.go({json.dumps(host.url(aid))}, 800); {READY}" + """
  await api.clickIn('document.querySelector(".bd-it[data-id=n]")'); await api.sleep(200)
  await api.key('Enter', 'Enter', 13); await api.sleep(300)
  await api.type(' and yours')
  await api.top('document.getElementById("f").remove()'); await api.sleep(1500)
  return true
""")
            self.assertIsNone(r.get("err"), r)
            self.assertEqual(next(i for i in boards.read(aid)["items"] if i["id"] == "n")["text"], "Mine and yours")
        finally:
            host.close()



@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class SheetCellLeaving(unittest.TestCase):
    """A cell's editor is saved when it closes, never half typed: the page going away (its frame removed) closes
    it, so what was typed in it is kept."""

    def test_a_frame_that_goes_keeps_the_open_cells_words(self):
        host = B.Host()
        try:
            aid = store.publish(title="S", type="sheet", files={"sheet.json": {"sheets": [{"name": "A", "rows": [["Bolts", 3]]}]}})["id"]
            r = B.drive(f"await api.go({json.dumps(host.url(aid))}, 800); {READY}" + """
  await api.sleep(800)
  const at = await api.frame('(() => { const c = [...document.querySelectorAll("#sh-grid .sh-c")].find(x => x.textContent.trim() === "Bolts"); const b = c.getBoundingClientRect(); return [b.left + 8, b.top + b.height / 2] })()')
  await api.mouse(at[0], at[1]); await api.sleep(200)
  await api.key('F2', 'F2', 113); await api.sleep(150)
  await api.frame('(() => { const t = document.querySelector("textarea.sh-ed"); t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })) })()')
  for (const ch of 'Nuts') { await api.type(ch); await api.sleep(150) }
  const open = await api.frame('document.querySelector("textarea.sh-ed").value')
  await api.top('document.getElementById("f").remove()'); await api.sleep(1500)
  return { open }
""")
            self.assertIsNone(r.get("err"), r)
            self.assertEqual(r["out"]["open"], "Nuts")  # in the open editor, not saved, when the frame went
            self.assertEqual(sheets.read(aid)["rows"][0][0], "Nuts", r)
        finally:
            host.close()
