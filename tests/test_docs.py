"""Live docs: tabs of blocks the user and Hermes edit together."""

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

from hermes_artifacts import api, docs, render, store  # noqa: E402
from test_types import load_plugin  # noqa: E402

MD = ("# Title\n\nPara one\ncontinued.\n\n- a\n- b\n\n  nested\n- c\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n"
      "```py\nx = 1\n\ny = 2\n```\n\n> q1\n> q2\n\n---\n\nlast")


def op(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


class SplitTests(unittest.TestCase):
    def test_blocks_keep_lists_tables_code_and_quotes_whole(self):
        kinds = [docs.block_kind(b) for b in docs.split_markdown(MD)]
        self.assertEqual(kinds, ["h1", "p", "ul", "table", "code", "quote", "hr", "p"])
        self.assertIn("\n\ny = 2", docs.split_markdown(MD)[4])  # a blank line inside code stays inside

    def test_round_trip(self):
        aid = store.publish(title="R", type="doc", files={"doc.md": MD})["id"]
        self.assertEqual(docs.markdown(aid).strip(), MD.strip())


class EditTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(title="D", type="doc", files={"doc.md": MD})["id"]
        self.st = docs.read(self.aid)

    def ids(self):
        return [b["id"] for b in docs.read(self.aid)["blocks"]]

    def test_replace_insert_delete_move(self):
        b = self.ids()
        docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "One\n\nTwo"}], by="user")
        r = docs.read(self.aid)["blocks"]
        self.assertEqual([x["md"] for x in r[1:3]], ["One", "Two"])  # a blank line split it
        docs.apply(self.aid, [{"op": "insert", "after": None, "md": "Top"}, {"op": "delete", "block": b[7]},
                              {"op": "move", "block": b[0], "after": None}], by="hermes", base_rev=docs.read(self.aid)["rev"])
        r = docs.read(self.aid)
        self.assertEqual(r["blocks"][0]["id"], b[0])
        self.assertEqual(r["blocks"][1]["md"], "Top")
        self.assertNotIn(b[7], [x["id"] for x in r["blocks"]])
        self.assertEqual(r["rev"], 3)

    def test_conflict_only_on_the_same_block_by_someone_else(self):
        b = self.ids()
        docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "Hermes"}], by="hermes", base_rev=docs.read(self.aid)["rev"])
        # The user's edit of another block, against the old rev, goes through.
        docs.apply(self.aid, [{"op": "replace", "block": b[2], "md": "- mine"}], by="user", base_rev=1)
        with self.assertRaises(docs.DocError) as e:
            docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "mine"}], by="user", base_rev=1)
        self.assertEqual(e.exception.code, "conflict")
        self.assertEqual(docs.read(self.aid, blocks=[b[1]])["blocks"][0]["md"], "Hermes")

    def test_since_rev_says_who_changed_what(self):
        b = self.ids()
        docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "x"}], by="user")
        docs.apply(self.aid, [{"op": "replace", "block": b[7], "md": "y"}], by="hermes", base_rev=docs.read(self.aid)["rev"])
        r = docs.read(self.aid, since_rev=2)
        self.assertEqual([(c["id"], c["by"]) for c in r["changed"]], [(b[7], "hermes")])
        self.assertEqual([c["id"] for c in docs.read(self.aid, search="continued")["blocks"]], [])
        self.assertEqual([c["id"] for c in docs.read(self.aid, search="Q2")["blocks"]], [b[5]])

    def test_tabs(self):
        r = docs.apply(self.aid, [{"op": "add_tab", "title": "Annex", "md": "# A\n\nb"}], by="hermes", base_rev=docs.read(self.aid)["rev"])
        st = docs.read(self.aid, "Annex")
        self.assertEqual(st["tab"], r["new_tab"])
        self.assertEqual(len(st["blocks"]), 2)
        docs.apply(self.aid, [{"op": "rename_tab", "title": "Appendix"}], by="user", tab=r["new_tab"])
        self.assertIn("# Appendix", docs.markdown(self.aid))
        docs.apply(self.aid, [{"op": "delete_tab"}], by="user", tab=r["new_tab"])
        with self.assertRaises(docs.DocError):
            docs.apply(self.aid, [{"op": "delete_tab"}], by="user")

    def test_doc_json_gives_tabs(self):
        aid = store.publish(title="T", type="doc", files={"doc.md": "# x", "doc.json": {"tabs": [
            {"title": "One", "markdown": "a"}, {"title": "Two", "markdown": "b\n\nc"}]}})["id"]
        self.assertEqual([(t["title"], t["blocks"]) for t in docs.read(aid)["tabs"]], [("One", 1), ("Two", 2)])

    def test_republish_starts_again_from_the_new_text(self):
        docs.apply(self.aid, [{"op": "insert", "after": None, "md": "live"}], by="user")
        store.publish(aid=self.aid, files={"doc.md": "# New"})
        self.assertEqual([b["md"] for b in docs.read(self.aid)["blocks"]], ["# New"])

    def test_guards_and_the_last_block(self):
        b = [x["id"] for x in docs.read(self.aid)["blocks"]]
        with self.assertRaises(docs.DocError) as e:  # Hermes replaces only what it read
            docs.apply(self.aid, [{"op": "replace", "block": b[0], "md": "x"}], by="hermes")
        self.assertEqual(e.exception.code, "missing_guard")
        r = docs.apply(self.aid, [{"op": "add_tab", "title": "Empty", "md": ""}], by="hermes")
        t = docs.read(self.aid, r["new_tab"])
        self.assertEqual(len(t["blocks"]), 1)  # an empty tab still has a block to type into
        with self.assertRaises(docs.DocError) as e:
            docs.apply(self.aid, [{"op": "delete", "block": t["blocks"][0]["id"]}], by="user", tab=r["new_tab"])
        self.assertEqual(e.exception.code, "last_block")

    def test_a_since_rev_older_than_the_log_returns_the_whole_tab(self):
        b = [x["id"] for x in docs.read(self.aid)["blocks"]]
        for i in range(docs.MAX_LOG + 5):
            docs.apply(self.aid, [{"op": "replace", "block": b[0], "md": f"t{i}"}], by="user")
        r = docs.read(self.aid, since_rev=1)
        self.assertEqual(r.get("since"), "unavailable")
        self.assertEqual(len(r["blocks"]), len(b))
        self.assertNotIn("since", docs.read(self.aid, since_rev=r["rev"] - 2))

    def test_history_at_rev_and_restore(self):
        b = [x["id"] for x in docs.read(self.aid)["blocks"]]
        docs.apply(self.aid, [{"op": "replace", "block": b[0], "md": "# Mine"}], by="user")
        docs.apply(self.aid, [{"op": "replace", "block": b[0], "md": "# Hermes"}], by="hermes", base_rev=2)
        h = docs.history(self.aid)
        self.assertEqual([x["by"] for x in h["snaps"]], ["hermes", "user", "start"])
        self.assertEqual(docs.at_rev(self.aid, None, 2)["blocks"][0]["md"], "# Mine")
        self.assertEqual(docs.at_rev(self.aid, None, 1)["blocks"][0]["md"], "# Title")
        r = docs.restore(self.aid, None, 2)
        self.assertEqual(r["rev"], 4)
        self.assertEqual(docs.read(self.aid)["blocks"][0]["md"], "# Mine")
        self.assertEqual(docs.history(self.aid)["snaps"][0]["by"], "restore")
        with self.assertRaises(docs.DocError):
            docs.at_rev(self.aid, None, 0)

    def test_bad_ops(self):
        for ops in ([], [{"op": "explode"}], [{"op": "replace", "block": "nope", "md": "x"}]):
            with self.assertRaises(docs.DocError):
                docs.apply(self.aid, ops, by="user")
        with self.assertRaises(docs.DocError):
            docs.apply(self.aid, [{"op": "insert", "after": None, "md": "x"}], by="someone")


class ApiAndToolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def setUp(self):
        self.aid = store.publish(title="Offer", type="doc", files={"doc.md": MD})["id"]

    def test_page_ops(self):
        r = op(self.aid, "doc.read")
        b = [x["id"] for x in r["blocks"]]
        self.assertTrue(op(self.aid, "doc.edit", ops=[{"op": "replace", "block": b[1], "md": "typed"}], base_rev=1)["ok"])
        docs.apply(self.aid, [{"op": "replace", "block": b[2], "md": "- hermes"}], by="hermes", base_rev=docs.read(self.aid)["rev"])
        c = op(self.aid, "doc.edit", ops=[{"op": "replace", "block": b[2], "md": "- typed"}], base_rev=2)
        self.assertTrue(c["conflict"])
        self.assertEqual(op(self.aid, "doc.read", since_rev=2)["changed"][0]["by"], "hermes")
        with self.assertRaises(api.ApiError):
            op(self.aid, "doc.edit", ops=[{"op": "nope"}])

    def test_ask_goes_to_the_inbox_with_where(self):
        r = op(self.aid, "doc.ask", kind="edit", text="Shorter", tab="t-1", blocks=["b-1"], selection="Para one")
        item = [i for i in store.inbox_list(self.aid) if i["id"] == r["id"]][0]
        self.assertEqual(item["kind"], "doc-edit")
        self.assertEqual(item["data"]["selection"], "Para one")

    def test_not_a_doc(self):
        aid = store.publish(title="p", html="<p>x</p>")["id"]
        with self.assertRaises(api.ApiError):
            op(aid, "doc.read")

    def test_agent_tools(self):
        r = json.loads(self.p._doc_read({"id": self.aid}))
        self.assertTrue(r["ok"])
        b = r["blocks"][1]["id"]
        e = json.loads(self.p._doc_edit({"id": self.aid, "base_rev": r["rev"],
                                         "ops": json.dumps([{"op": "replace", "block": b, "md": "Hermes wrote this"}])}))
        self.assertEqual(e["rev"], 2)
        self.assertIn("Hermes wrote this", json.loads(self.p._read({"id": self.aid}))["content"])
        op(self.aid, "doc.edit", ops=[{"op": "replace", "block": b, "md": "user again"}])
        c = json.loads(self.p._doc_edit({"id": self.aid, "base_rev": 2, "ops": [{"op": "replace", "block": b, "md": "x"}]}))
        self.assertTrue(c["conflict"])
        # A live doc is never published again: that would replace what the person typed.
        pub = json.loads(self.p._publish({"id": self.aid, "type": "doc", "files": {"doc.md": "# over"}, "open": False}))
        self.assertFalse(pub["ok"])
        self.assertIn("artifact_doc_edit", pub["error"])
        self.assertIn("user again", json.loads(self.p._read({"id": self.aid}))["content"])

    def test_hermes_adds_an_anchored_comment(self):
        r = json.loads(self.p._doc_read({"id": self.aid}))
        b = r["blocks"][1]["id"]
        c = json.loads(self.p._comments({"id": self.aid, "action": "add", "text": "Too long?", "block": b, "quote": "Para one"}))
        self.assertEqual(c["comment"]["anchor"]["selector"], "#blk-" + b)
        self.assertEqual(c["comment"]["author"], "hermes")
        bad = json.loads(self.p._comments({"id": self.aid, "action": "add", "text": "x", "block": "nope"}))
        self.assertFalse(bad["ok"])

    def test_render_carries_the_live_doc(self):
        b = docs.read(self.aid)["blocks"][0]["id"]
        docs.apply(self.aid, [{"op": "replace", "block": b, "md": "# Live title"}], by="user")
        m = store.get_meta(self.aid)
        html = render.render(m, store.version_dir(self.aid))
        self.assertIn("# Live title", html)


if __name__ == "__main__":
    unittest.main()
