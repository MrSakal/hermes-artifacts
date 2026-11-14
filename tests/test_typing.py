"""Words the user is typing, not saved yet, are never written over by Hermes (acceptance round 2: a doc).

(a) The server: a page says which parts it is typing in (op "typing": a doc's block, "<sheet>!A1", a board's
    item); Hermes' edit of such a part within store.TYPING_TTL_S is a conflict, nothing changed, and the error
    tells it to read again and redo. Other parts, the user's own edits and a mark gone stale are not held.
(b) The doc page in a browser: typing inside a sentence sends the mark before the 700 ms save, so Hermes'
    edit of that block within the debounce is refused and the typed words land; and when Hermes' edit does
    land first (no mark yet), the page keeps the words as a suggestion on Hermes' text and says so."""

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
