"""What the agent's reads of a long doc hand over: past ~30 KB of text an outline (parts, each the blocks=
value that reads it) and one line saying so, never the whole text; every block still within reach, and an
edit after such a read goes through as after a whole one. Sheet and board ha_read: objects, not JSON in a
string; a board's compact read leaves out place and size, which range= gives."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import docs, store  # noqa: E402
from test_types import load_plugin  # noqa: E402

LONG = "# Long doc\n\n## Part one\n\n" + "\n\n".join(
    (f"## Section {i}\n\n" if i % 100 == 50 else "") + f"Paragraph {i}: " + "lorem ipsum dolor sit amet consectetur " * 8
    for i in range(600))
KW = {"task_id": "R", "session_id": "S-R"}


class LongDocTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def setUp(self):
        self.aid = store.publish(title="Long", type="doc", files={"doc.md": LONG})["id"]

    def live_read(self, **args):
        return json.loads(self.p._doc_read({"id": self.aid, **args}, **KW))

    def test_a_whole_read_is_an_outline_and_every_block_is_within_reach(self):
        raw = self.p._doc_read({"id": self.aid}, **KW)
        self.assertLess(len(raw), 12_000)
        r = json.loads(raw)
        self.assertNotIn("blocks", r)
        self.assertIn("blocks=[its blocks]", r["note"])
        every = [b["id"] for b in docs.read(self.aid)["blocks"]]
        got = []
        for part in r["outline"]:
            pr = self.live_read(blocks=[part["blocks"]])
            self.assertEqual(len(pr["blocks"]), part["n"])
            self.assertLess(len(json.dumps(pr)), 20_000)
            got += [b["id"] for b in pr["blocks"]]
        self.assertEqual(got, every)  # all of them, in order, once
        heads = [h for p in r["outline"] for h in p.get("heads", [])]
        self.assertIn("## Section 50", heads)

    def test_an_edit_after_an_outline_goes_through(self):
        r = self.live_read()
        part = r["outline"][3]
        blocks = self.live_read(blocks=[part["blocks"]])["blocks"]
        out = json.loads(self.p._doc_edit({"id": self.aid, "base_rev": r["rev"], "ops": [
            {"op": "replace", "block": blocks[2]["id"], "md": "Rewritten by Hermes."}]}, **KW))
        self.assertTrue(out.get("rev"), out)
        self.assertNotIn("error", out)
        self.assertEqual(self.live_read(blocks=[blocks[2]["id"]])["blocks"][0]["md"], "Rewritten by Hermes.")

    def test_ha_read_gives_each_tabs_outline(self):
        raw = self.p._read({"id": self.aid}, **KW)
        self.assertLess(len(raw), 12_000)
        r = json.loads(raw)
        self.assertNotIn("content", r)
        self.assertGreater(r["chars"], docs.READ_MAX)
        tab = r["outline"][0]
        self.assertIn(f"ha_live_read id={self.aid} tab=<tab>", r["note"])
        part = self.live_read(tab=tab["tab"], blocks=[tab["parts"][-1]["blocks"]])
        out = json.loads(self.p._doc_edit({"id": self.aid, "tab": tab["tab"], "base_rev": tab["rev"], "ops": [
            {"op": "replace", "block": part["blocks"][-1]["id"], "md": "The end."}]}, **KW))
        self.assertNotIn("error", out)
        self.assertTrue(docs.markdown(self.aid).rstrip().endswith("The end."))

    def test_filters_still_read_blocks(self):
        self.assertEqual([b["md"][:13] for b in self.live_read(search="Paragraph 599")["blocks"]], ["Paragraph 599"])
        rev = self.live_read()["rev"]
        b = docs.read(self.aid)["blocks"][5]["id"]
        docs.apply(self.aid, [{"op": "replace", "block": b, "md": "typed"}], by="user")
        self.assertEqual([c["md"] for c in self.live_read(since_rev=rev)["changed"]], ["typed"])

    def test_a_part_whose_end_is_gone_is_refused_with_a_way_on(self):
        part = self.live_read()["outline"][1]
        first, last = part["blocks"].split("..")
        docs.apply(self.aid, [{"op": "delete", "block": last}], by="user")
        r = self.live_read(blocks=[part["blocks"]])
        self.assertFalse(r.get("ok", True))
        self.assertIn("read it again for its outline", r["error"])

    def test_a_short_doc_is_read_whole_as_before(self):
        aid = store.publish(title="Short", type="doc", files={"doc.md": "# S\n\none\n\ntwo"})["id"]
        r = json.loads(self.p._doc_read({"id": aid}, **KW))
        self.assertEqual([b["md"] for b in r["blocks"]], ["# S", "one", "two"])
        self.assertNotIn("outline", r)
        self.assertEqual(json.loads(self.p._read({"id": aid}, **KW))["content"], "# S\n\none\n\ntwo\n")


class ObjectReadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def test_sheet_and_board_reads_are_objects(self):
        sid = store.publish(title="S", type="sheet", files={"sheet.json": {"sheets": [{"name": "A", "rows": [["a", 1]]}]}})["id"]
        bid = store.publish(title="B", type="board", files={"board.json": {"items": [{"id": "a", "type": "box", "text": "x"}]}})["id"]
        s = json.loads(self.p._read({"id": sid}, **KW))
        b = json.loads(self.p._read({"id": bid}, **KW))
        self.assertEqual(s["content"]["sheets"][0]["rows"][0], ["a", 1])
        self.assertEqual(b["content"]["items"][0]["text"], "x")
        self.assertIn("x", b["content"]["items"][0])  # ha_read keeps the whole board
        live = json.loads(self.p._doc_read({"id": bid}, **KW))["items"][0]
        self.assertNotIn("x", live)
        full = json.loads(self.p._doc_read({"id": bid, "range": "a"}, **KW))["items"][0]
        self.assertEqual({"x", "y", "w", "h"} <= set(full), True)


if __name__ == "__main__":
    unittest.main()
