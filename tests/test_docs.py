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

    def test_a_multi_op_edit_is_all_or_nothing(self):  # (i) the doc page's split, merge, paste
        b = self.ids()
        rev = docs.read(self.aid)["rev"]
        with self.assertRaises(docs.DocError) as e:  # an op that fails: none of the edit is applied
            docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "head"}, {"op": "insert", "after": "b-gone", "md": "tail"}], by="user")
        self.assertEqual(e.exception.code, "absent")
        self.assertEqual((docs.read(self.aid)["rev"], self.ids()), (rev, b))
        self.assertNotIn("head", docs.markdown(self.aid))
        docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "Hermes"}], by="hermes", base_rev=rev)
        with self.assertRaises(docs.DocError) as e:  # a conflict on one op: the others are not applied either
            docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "head"}, {"op": "insert", "after": b[1], "md": "tail"}], by="user", base_rev=rev)
        self.assertEqual(e.exception.code, "conflict")
        self.assertNotIn("tail", docs.markdown(self.aid))
        r = docs.apply(self.aid, [{"op": "replace", "block": b[2], "md": "- head"}, {"op": "insert", "after": b[2], "md": "tail\n\nmore"},
                                  {"op": "move", "block": b[0], "after": b[3]}], by="user")
        self.assertEqual(r["per_op"][0], [b[2]])
        self.assertEqual(len(r["per_op"][1]), 2)  # the new blocks of that insert, in order
        self.assertEqual(r["per_op"][2], [b[0]])
        self.assertEqual([x["md"] for x in docs.read(self.aid, blocks=r["per_op"][1])["blocks"]], ["tail", "more"])

    def test_an_edit_sent_again_is_applied_once(self):  # (j)
        b = self.ids()
        ops = [{"op": "insert", "after": b[1], "md": "once", "cid": "pg.1"}]
        r1 = docs.apply(self.aid, ops, by="user")
        r2 = docs.apply(self.aid, ops, by="user")  # its answer lost: sent again
        self.assertEqual(docs.markdown(self.aid).count("once"), 1)
        self.assertTrue(r2["repeat"])
        self.assertEqual((r2["rev"], r2["per_op"]), (r1["rev"], r1["per_op"]))
        # The page learns it from a read too, and the record lives in the doc's state (a restart keeps it).
        self.assertEqual(docs.read(self.aid)["done"]["pg.1"], r1["per_op"])
        self.assertEqual(docs.read(self.aid, since_rev=r1["rev"])["done"]["pg.1"], r1["per_op"])
        self.assertTrue(any(d["cid"] == "pg.1" for d in json.loads(docs._state_path(self.aid).read_text("utf-8"))["done"]))
        # Any kind of edit, and proposals.
        docs.apply(self.aid, [{"op": "delete", "block": b[7], "cid": "pg.2"}], by="user")
        docs.apply(self.aid, [{"op": "delete", "block": b[7], "cid": "pg.2"}], by="user")  # no "absent": the same answer
        for _ in range(2):
            docs.suggest(self.aid, [{"op": "insert", "after": b[1], "md": "proposed", "cid": "pg.3"}], by="user")
        self.assertEqual(len(docs.read(self.aid)["suggestions"]), 1)
        # A refused edit is not remembered: nothing of it was applied, so sent again it is tried again.
        with self.assertRaises(docs.DocError):
            docs.apply(self.aid, [{"op": "replace", "block": "b-gone", "md": "x", "cid": "pg.4"}], by="user")
        self.assertIsNone(docs._done(docs.load(self.aid), "pg.4", "user"))
        # Bounded: the last MAX_DONE.
        for i in range(docs.MAX_DONE + 5):
            docs.apply(self.aid, [{"op": "replace", "block": b[0], "md": f"# t{i}", "cid": f"pg.n{i}"}], by="user")
        st = docs.load(self.aid)
        self.assertEqual(len(st["done"]), docs.MAX_DONE)
        self.assertIsNone(docs._done(st, "pg.1", "user"))
        self.assertLessEqual(len(docs.read(self.aid)["done"]), docs.DONE_IN_READ)

    def test_the_page_gets_a_refusal_as_an_answer(self):  # (i) the outbox mends or drops it, never retries it as is
        b = self.ids()
        r = op(self.aid, "doc.edit", ops=[{"op": "replace", "block": "b-gone", "md": "x", "cid": "pg.9"}])
        self.assertEqual((r["ok"], r["refused"]), (False, "absent"))
        r = op(self.aid, "doc.suggest", ops=[{"op": "replace", "block": "b-gone", "md": "x", "cid": "pg.10"}])
        self.assertEqual(r["refused"], "absent")
        with self.assertRaises(api.ApiError):  # without a cid, as before
            op(self.aid, "doc.edit", ops=[{"op": "replace", "block": "b-gone", "md": "x"}])
        r = op(self.aid, "doc.edit", ops=[{"op": "insert", "after": b[0], "md": "x", "cid": "pg.11"}])
        self.assertEqual(op(self.aid, "doc.edit", ops=[{"op": "insert", "after": b[0], "md": "x", "cid": "pg.11"}])["per_op"], r["per_op"])

    def test_a_batch_is_applied_in_order(self):  # (l)
        b = self.ids()
        para = b[1]
        r = op(self.aid, "doc.edit", ops=[{"op": "batch", "entries": [
            {"cid": "pg.1", "via": "edit", "ops": [{"op": "replace", "block": para, "md": "V1"}], "base": 1},
            {"cid": "pg.2", "via": "edit", "ops": [{"op": "replace", "block": para, "md": "V1 V2"}], "base": 1},
            {"cid": "pg.3", "via": "edit", "ops": [{"op": "insert", "after": para, "md": "new", "tmp": "tmp-a"}], "base": 1},
            {"cid": "pg.4", "via": "edit", "ops": [{"op": "replace", "block": "tmp-a", "md": "new, typed on"}], "base": 1},  # names the tmp id
            {"cid": "pg.5", "via": "suggest", "ops": [{"op": "replace", "block": b[7], "md": "proposed"}]}]}])
        self.assertTrue(r["ok"])
        self.assertEqual([a["ok"] for a in r["batch"]], [True] * 5)
        self.assertEqual(docs.read(self.aid, blocks=[para])["blocks"][0]["md"], "V1 V2")  # the later words win
        new = r["batch"][2]["per_op"][0][0]
        self.assertEqual(docs.read(self.aid, blocks=[new])["blocks"][0]["md"], "new, typed on")
        self.assertEqual(len(docs.read(self.aid)["suggestions"]), 1)
        # The first request of pg.1 lands late (it was in flight): applied already, so not again.
        late = op(self.aid, "doc.edit", ops=[{"op": "replace", "block": para, "md": "V1", "cid": "pg.1"}], base_rev=1)
        self.assertTrue(late["repeat"])
        self.assertEqual(docs.read(self.aid, blocks=[para])["blocks"][0]["md"], "V1 V2")
        # The same batch again (sent twice): nothing applied twice.
        rev = docs.read(self.aid)["rev"]
        op(self.aid, "doc.edit", ops=[{"op": "batch", "entries": [
            {"cid": "pg.3", "via": "edit", "ops": [{"op": "insert", "after": para, "md": "new", "tmp": "tmp-a"}]}]}])
        self.assertEqual((docs.read(self.aid)["rev"], docs.markdown(self.aid).count("new, typed on")), (rev, 1))

    def test_a_batch_holds_only_what_depends_on_a_failed_entry(self):  # (l) the dependency rule
        b = self.ids()
        base = docs.read(self.aid)["rev"]
        docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "Hermes"}], by="hermes", base_rev=base)
        r = docs.apply_batch(self.aid, [
            {"cid": "pg.1", "ops": [{"op": "replace", "block": b[1], "md": "mine"}], "base": base},           # conflict
            {"cid": "pg.2", "ops": [{"op": "replace", "block": b[1], "md": "mine, more"}], "base": base},     # the same block: held
            {"cid": "pg.3", "ops": [{"op": "insert", "after": b[1], "md": "split", "tmp": "tmp-s"}]},          # anchored on it: held
            {"cid": "pg.4", "ops": [{"op": "replace", "block": "tmp-s", "md": "split, on"}]},                 # names that tmp: held
            {"cid": "pg.5", "ops": [{"op": "replace", "block": b[2], "md": "- other"}], "base": base},        # independent: applied
            {"cid": "pg.6", "ops": [{"op": "insert", "after": "b-gone", "md": "x", "tmp": "tmp-g"}]},          # refused
            {"cid": "pg.7", "ops": [{"op": "replace", "block": b[7], "md": "last one"}]}], by="user")       # independent: applied
        a = r["batch"]
        self.assertTrue(a[0]["conflict"])
        self.assertEqual([x.get("held", False) for x in a[1:4]], [True, True, True])
        self.assertTrue(a[4]["ok"] and a[6]["ok"])
        self.assertEqual(a[5]["refused"], "absent")
        md_now = docs.markdown(self.aid)
        self.assertNotIn("mine", md_now)
        self.assertNotIn("split", md_now)
        self.assertIn("- other", md_now)
        self.assertIn("last one", md_now)
        self.assertIsNone(docs._done(docs.load(self.aid), "pg.2", "user"))  # held: nothing of it applied, sent again later

    def test_a_late_text_edit_from_the_same_page_never_overwrites_a_newer_one(self):  # (l) the sequence rule
        b = self.ids()
        docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "V1 V2", "cid": "pg.2"}], by="user")
        r = docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "V1", "cid": "pg.1"}], by="user")  # overtaken
        self.assertTrue(r["superseded"])
        self.assertEqual(docs.read(self.aid, blocks=[b[1]])["blocks"][0]["md"], "V1 V2")
        self.assertTrue(docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "V1", "cid": "pg.1"}], by="user")["repeat"])
        # In a mixed edit only the overtaken text op is skipped.
        r = docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "old", "cid": "pg.0"}, {"op": "insert", "after": b[1], "md": "kept"}], by="user")
        self.assertEqual((r["per_op"][0], len(r["per_op"][1])), ([], 1))
        self.assertEqual(docs.read(self.aid, blocks=[b[1]])["blocks"][0]["md"], "V1 V2")
        # Never rejected: another page (or the doc opened again), the same n again (mended or split up), a newer
        # n with older words (an undo), another block, an edit without a cid, Hermes.
        for ops in ([{"op": "replace", "block": b[1], "md": "other page", "cid": "qq.1"}],
                    [{"op": "replace", "block": b[1], "md": "same n", "cid": "pg.2.m1"}],
                    [{"op": "replace", "block": b[1], "md": "V1", "cid": "pg.3"}],
                    [{"op": "replace", "block": b[2], "md": "- other block", "cid": "pg.1.r1"}],
                    [{"op": "replace", "block": b[1], "md": "no cid"}]):
            r = docs.apply(self.aid, ops, by="user")
            self.assertFalse(r.get("superseded"), ops)
            self.assertEqual(docs.read(self.aid, blocks=[ops[0]["block"]])["blocks"][0]["md"], ops[0]["md"])
        r = docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "Hermes", "cid": "pg.0"}], by="hermes", base_rev=docs.read(self.aid)["rev"])
        self.assertFalse(r.get("superseded"))
        # Kept in the doc's state, bounded.
        st = json.loads(docs._state_path(self.aid).read_text("utf-8"))
        self.assertIn("user:pg", st["seq"])
        for i in range(docs.SEQ_PAGES + 3):
            docs.apply(self.aid, [{"op": "replace", "block": b[7], "md": f"p{i}", "cid": f"pp{i}.1"}], by="user")
        self.assertLessEqual(len(docs.load(self.aid)["seq"]), docs.SEQ_PAGES)

    def test_a_batch_takes_each_entry_on_its_own_tab(self):  # (e) one call, the whole outbox, in order
        b = self.ids()
        t1 = docs.read(self.aid)["tab"]
        t2 = docs.apply(self.aid, [{"op": "add_tab", "title": "Two", "md": "two"}], by="user")["new_tab"]
        r = docs.apply_batch(self.aid, [
            {"cid": "pg.1", "tab": t1, "ops": [{"op": "insert", "after": b[1], "md": "one", "tmp": "tmp-1"}]},
            {"cid": "pg.2", "tab": t2, "ops": [{"op": "insert", "after": None, "md": "in two"}]},
            {"cid": "pg.3", "tab": t1, "ops": [{"op": "replace", "block": "tmp-1", "md": "one, on"}]}], by="user")
        self.assertEqual([a["ok"] for a in r["batch"]], [True, True, True])
        self.assertIn("one, on", docs.markdown(self.aid))
        self.assertEqual(docs.read(self.aid, t2)["blocks"][0]["md"], "in two")

    def test_an_over_bound_batch_is_refused_whole(self):  # (f) nothing half-applied, nothing kept for later
        b = self.ids()
        rev = docs.read(self.aid)["rev"]
        big = [{"cid": f"pg.{i}", "ops": [{"op": "replace", "block": b[1], "md": f"v{i}"}]} for i in range(docs.MAX_BATCH + 1)]
        r = op(self.aid, "doc.edit", ops=[{"op": "batch", "entries": big}])
        self.assertEqual((r["ok"], r["refused"]), (False, "too_large"))
        wide = [{"cid": f"pw.{i}", "ops": [{"op": "replace", "block": b[1], "md": "x" * 15000}]} for i in range(docs.MAX_BATCH_CHARS // 15000 + 2)]
        self.assertEqual(op(self.aid, "doc.edit", ops=[{"op": "batch", "entries": wide}])["refused"], "too_large")
        self.assertEqual(docs.read(self.aid)["rev"], rev)  # not one entry applied
        self.assertIsNone(docs._done(docs.load(self.aid), "pg.0", "user"))
        self.assertTrue(op(self.aid, "doc.edit", ops=[{"op": "batch", "entries": big[:3]}])["batch"][2]["ok"])  # what fits goes

    def test_no_stored_batches(self):
        # A state file from a build that kept batches in parts: those keys are dropped, nothing else changes.
        b = self.ids()
        st = docs.load(self.aid)
        st["parts"] = {"pg.b1": {"at": 0, "next": 0, "n": 2, "held": {"1": [{"ops": [{"op": "replace", "block": b[1], "md": "OLD"}]}]}}}
        st["parts_done"] = ["pg.b0"]
        docs._save(self.aid, st)
        docs.apply_batch(self.aid, [{"cid": "pz.1", "ops": [{"op": "replace", "block": b[7], "md": "new"}]}], by="user")
        st = json.loads(docs._state_path(self.aid).read_text("utf-8"))
        self.assertNotIn("parts", st)
        self.assertNotIn("parts_done", st)
        self.assertNotIn("OLD", docs.markdown(self.aid))
        self.assertFalse(hasattr(docs, "PART_TTL") or hasattr(docs, "_parts_expire"))

    def test_the_batch_is_a_page_op_only(self):
        # Hermes' tool calls docs.apply, which knows no batch op.
        with self.assertRaises(docs.DocError) as e:
            docs.apply(self.aid, [{"op": "batch", "entries": []}], by="hermes")
        self.assertEqual(e.exception.code, "invalid")
        self.assertEqual(op(self.aid, "doc.edit", ops=[{"op": "batch", "entries": []}])["refused"], "invalid")

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

    def test_a_base_rev_older_than_the_log_is_checked_block_by_block(self):
        # The doc page saves the block being typed in against the rev its words were typed from, which can
        # fall behind the log in a long session: each block's last text change, kept beyond the log, says.
        b = self.ids()
        for i in range(docs.MAX_LOG + 5):
            docs.apply(self.aid, [{"op": "replace", "block": b[0], "md": f"t{i}"}], by="hermes", base_rev=docs.read(self.aid)["rev"])
        self.assertGreater(min(e["rev"] for e in docs.load(self.aid)["log"]), 2)  # the log no longer reaches rev 1
        docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "mine"}], by="user", base_rev=1)  # untouched since: no conflict
        with self.assertRaises(docs.DocError) as e:
            docs.apply(self.aid, [{"op": "replace", "block": b[0], "md": "mine"}], by="user", base_rev=1)
        self.assertEqual((e.exception.code, e.exception.extra["blocks"]), ("conflict", [b[0]]))
        docs.apply(self.aid, [{"op": "insert", "after": b[1], "md": "new"}], by="user", base_rev=1)  # an insert overwrites nothing

    def test_beyond_the_log_with_no_record_is_a_conflict(self):
        # A doc state from before blocks' last changes were kept: before that record began nothing is known.
        b = self.ids()
        st = docs.load(self.aid)
        st.pop("last", None)
        st["last_from"] = {}
        docs._save(self.aid, st)
        docs.apply(self.aid, [{"op": "replace", "block": b[7], "md": "x"}], by="user")  # the record begins here (rev 1)
        st = docs.load(self.aid)
        st["last_from"][st["tabs"][0]["id"]] = 50  # as if it had begun later, and the log moved on since
        st["tabs"][0]["rev"] = 60
        st["log"] = []
        docs._save(self.aid, st)
        with self.assertRaises(docs.DocError) as e:
            docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "mine"}], by="user", base_rev=10)
        self.assertEqual(e.exception.code, "conflict")

    def test_a_move_is_no_conflict_for_a_text_edit(self):
        # Hermes moves the block being typed in: its words did not change, so the person's save goes through.
        b = self.ids()
        base = docs.read(self.aid)["rev"]
        r = docs.apply(self.aid, [{"op": "move", "block": b[1], "after": b[5]}], by="hermes", base_rev=base)
        self.assertIn(b[1], r["changed"])  # a reader still learns it changed place
        self.assertEqual(docs.load(self.aid)["log"][-1]["moved"], [b[1]])
        docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "mine"}], by="user", base_rev=base)
        self.assertEqual(docs.read(self.aid, blocks=[b[1]])["blocks"][0]["md"], "mine")
        # A move and a text change of the same block in one edit is a text change.
        base = docs.read(self.aid)["rev"]
        docs.apply(self.aid, [{"op": "replace", "block": b[2], "md": "- theirs"}, {"op": "move", "block": b[2], "after": None}],
                   by="hermes", base_rev=base)
        self.assertNotIn("moved", docs.load(self.aid)["log"][-1])
        with self.assertRaises(docs.DocError):
            docs.apply(self.aid, [{"op": "replace", "block": b[2], "md": "- mine"}], by="user", base_rev=base)
        # Beyond the log too: a move is not a text change.
        base = docs.read(self.aid)["rev"]
        docs.apply(self.aid, [{"op": "move", "block": b[3], "after": None}], by="hermes", base_rev=base)
        for i in range(docs.MAX_LOG + 5):
            docs.apply(self.aid, [{"op": "replace", "block": b[0], "md": f"t{i}"}], by="user")
        docs.apply(self.aid, [{"op": "replace", "block": b[3], "md": "| x | y |\n|---|---|\n| 3 | 4 |"}], by="user", base_rev=base)

    def test_the_pages_conflict_keeps_the_persons_words_as_a_suggestion(self):
        # What the doc page does when its save of the block being typed in meets Hermes' change to it.
        b = self.ids()
        base = docs.read(self.aid)["rev"]
        docs.apply(self.aid, [{"op": "replace", "block": b[1], "md": "Hermes' words."}], by="hermes", base_rev=base)
        docs.apply(self.aid, [{"op": "replace", "block": b[7], "md": "Hermes elsewhere."}], by="hermes", base_rev=base + 1)
        r = op(self.aid, "doc.edit", ops=[{"op": "replace", "block": b[1], "md": "My words."}], base_rev=base)
        self.assertEqual((r["ok"], r["conflict"], r["blocks"]), (False, True, [b[1]]))
        self.assertEqual(docs.read(self.aid, blocks=[b[1]])["blocks"][0]["md"], "Hermes' words.")
        op(self.aid, "doc.suggest", ops=[{"op": "replace", "block": b[1], "md": "My words."}])
        sg = docs.read(self.aid)["suggestions"][0]
        self.assertEqual((sg["by"], sg["md"], sg["was"]), ("user", "My words.", "Hermes' words."))
        op(self.aid, "doc.decide", id=sg["id"], verdict="accept")
        self.assertEqual(docs.read(self.aid, blocks=[b[1]])["blocks"][0]["md"], "My words.")
        # The page's save of another block against the same old rev goes through: Hermes did not touch it.
        self.assertTrue(op(self.aid, "doc.edit", ops=[{"op": "replace", "block": b[2], "md": "- mine"}], base_rev=base)["ok"])

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
        self.assertIn("ha_live_edit", pub["error"])
        self.assertIn("user again", json.loads(self.p._read({"id": self.aid}))["content"])

    def test_hermes_adds_an_anchored_comment(self):
        r = json.loads(self.p._doc_read({"id": self.aid}))
        b = r["blocks"][1]["id"]
        c = json.loads(self.p._comments({"id": self.aid, "action": "add", "text": "Too long?", "block": b, "quote": "Para one"}))
        self.assertEqual(c["comment"]["anchor"]["selector"], "#blk-" + b)
        self.assertEqual(c["comment"]["author"], "hermes")
        bad = json.loads(self.p._comments({"id": self.aid, "action": "add", "text": "x", "block": "nope"}))
        self.assertFalse(bad["ok"])

    def test_an_outline_fills_section_by_section(self):
        outline = ("# Plan\n\n<!-- pending: Goals: the three outcomes -->\n\n"
                   "<!-- pending: Risks: what could slip -->\n\n<!-- pending: Staffing -->")
        pub = json.loads(self.p._publish({"type": "doc", "title": "Plan", "files": {"doc.md": outline}, "open": False}))
        aid, tab = pub["id"], pub["doc"]["tabs"][0]
        goals, risks, staff = [x["block"] for x in tab["pending"]]
        self.assertEqual(tab["pending"][0]["intent"], "Goals: the three outcomes")
        self.assertEqual(docs.read(aid)["blocks"][1]["kind"], "pending")
        self.assertTrue(docs.read(aid)["hermes_active"])
        # With how long that window has left, as sheets and boards: the page tells from it whether the change
        # came in the run now in flight (kit.hermesWork), so its "Hermes is here" ends with the run.
        self.assertIn(docs.read(aid)["hermes_left"], (299, 300))
        # A pending block is filled without base_rev; what is left comes back in reading order.
        e = json.loads(self.p._doc_edit({"id": aid, "ops": [{"op": "replace", "block": goals, "md": "## Goals\n\n- Ship it"}]}))
        self.assertTrue(e["ok"])
        self.assertEqual([x["block"] for x in e["pending"]], [risks, staff])
        # Readers and exports never see a section still to write.
        content = json.loads(self.p._read({"id": aid}))["content"]
        self.assertIn("## Goals", content)
        self.assertNotIn("pending", content)
        # The user removed a section: Hermes is told to leave it out.
        op(aid, "doc.edit", ops=[{"op": "delete", "block": risks}])
        gone = json.loads(self.p._doc_edit({"id": aid, "ops": [{"op": "replace", "block": risks, "md": "## Risks"}]}))
        self.assertFalse(gone["ok"])
        self.assertIn("leave it out", gone["error"])
        # The user typed into one: it is an ordinary block now, and the guard applies again.
        op(aid, "doc.edit", ops=[{"op": "replace", "block": staff, "md": "Ana runs it"}])
        guarded = json.loads(self.p._doc_edit({"id": aid, "ops": [{"op": "replace", "block": staff, "md": "## Staffing"}]}))
        self.assertFalse(guarded["ok"])
        self.assertIn("base_rev", guarded["error"])
        self.assertNotIn("pending", json.loads(self.p._doc_edit(
            {"id": aid, "ops": [{"op": "insert", "after": None, "md": "x"}]})))

    def test_suggestions_wait_for_the_person(self):
        b = [x["id"] for x in docs.read(self.aid)["blocks"]]
        # Hermes proposes; the doc keeps its words until the person accepts.
        r = json.loads(self.p._doc_edit({"id": self.aid, "suggest": True, "ops": [
            {"op": "replace", "block": b[1], "md": "Para one, shorter."},
            {"op": "insert", "after": b[1], "md": "A new line."},
            {"op": "delete", "block": b[2]}]}))
        self.assertTrue(r["ok"])
        st = docs.read(self.aid)
        self.assertEqual(len(st["suggestions"]), 3)
        self.assertNotIn("shorter", docs.markdown(self.aid))
        rep, ins, dele = st["suggestions"]
        self.assertEqual(rep["was"], st["blocks"][1]["md"])
        # The person types on in Suggesting mode: one card per block, updated.
        op(self.aid, "doc.suggest", ops=[{"op": "replace", "block": b[1], "md": "Mine."}])
        op(self.aid, "doc.suggest", ops=[{"op": "replace", "block": b[1], "md": "Mine, again."}])
        self.assertEqual(sum(1 for s in docs.read(self.aid)["suggestions"] if s["by"] == "user"), 1)
        op(self.aid, "doc.decide", id=rep["id"], verdict="accept")
        op(self.aid, "doc.decide", id=ins["id"], verdict="reject")
        md_now = docs.markdown(self.aid)
        self.assertIn("Para one, shorter.", md_now)
        self.assertNotIn("A new line.", md_now)
        with self.assertRaises(api.ApiError):
            op(self.aid, "doc.decide", id=ins["id"], verdict="accept")  # gone
        with self.assertRaises(api.ApiError):
            op(self.aid, "doc.decide", id=dele["id"], verdict="maybe")

    def test_dropdowns_look_and_pictures(self):
        docs.apply(self.aid, [{"op": "set_select", "name": "Status", "options": ["Todo", "Done", "Done", "x}"]},
                              {"op": "settings", "set": {"head": "sans", "wide": True, "evil": 1}}], by="hermes")
        st = docs.read(self.aid)
        self.assertEqual(st["selects"], {"Status": ["Todo", "Done"]})
        self.assertEqual(st["settings"], {"head": "sans", "wide": True})
        png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        up = op(self.aid, "doc.upload", data=png)
        self.assertTrue(up["src"].startswith("doc:"))
        self.assertEqual(api.handle("POST", f"artifacts/{self.aid}/op", {}, {"op": "doc.file", "args": {"name": up["name"]}})["url"], png)
        with self.assertRaises(api.ApiError):
            api.handle("POST", f"artifacts/{self.aid}/op", {}, {"op": "doc.file", "args": {"name": "../meta.json"}})
        with self.assertRaises(api.ApiError):
            op(self.aid, "doc.upload", data="data:text/html;base64,PHA+")

    def test_reactions_on_comments(self):
        c = store.comment_add(self.aid, "Looks right?")
        store.comment_react(self.aid, c["id"], "👍")
        self.assertEqual(store.comments_list(self.aid)[-1]["reactions"], {"👍": ["user"]})
        store.comment_react(self.aid, c["id"], "👍")
        self.assertEqual(store.comments_list(self.aid)[-1]["reactions"], {})
        with self.assertRaises(ValueError):
            store.comment_react(self.aid, c["id"], "<b>")

    def test_render_carries_the_live_doc(self):
        b = docs.read(self.aid)["blocks"][0]["id"]
        docs.apply(self.aid, [{"op": "replace", "block": b, "md": "# Live title"}], by="user")
        m = store.get_meta(self.aid)
        html = render.render(m, store.version_dir(self.aid))
        self.assertIn("# Live title", html)


if __name__ == "__main__":
    unittest.main()


class MarkdownJsTests(unittest.TestCase):
    """The doc's own Markdown reader (types/doc/markdown.js), run in node when there is one."""

    def _html(self, sources):
        import shutil
        import subprocess
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        js = ("global.window={};require(process.argv[1]);const md=window.md;"
              "console.log(JSON.stringify(JSON.parse(process.argv[2]).map(s=>md.html(md.parse(s)))))")
        path = str(PLUGIN / "hermes_artifacts" / "types" / "doc" / "markdown.js")
        out = subprocess.run([node, "-e", js, path, json.dumps(sources)], capture_output=True, text=True, encoding="utf-8", check=True)
        return json.loads(out.stdout)

    def test_a_marker_alone_keeps_its_block_kind(self):
        # A block just started ("## ", "- ", "1. ") is saved trimmed; it must stay a heading or a list, not turn into text.
        h2, bullet, number, task = self._html(["##", "-", "1.", "- [ ]"])
        self.assertTrue(h2.startswith("<h2"))
        self.assertEqual(bullet, "<ul><li></li></ul>")
        self.assertEqual(number, "<ol><li></li></ol>")
        self.assertIn('class="task"', task)

    def test_text_that_only_looks_like_a_marker_stays_text(self):
        tag, dash, decimal, rule = self._html(["#hashtag", "-x", "1.5 m", "---"])
        self.assertEqual(tag, "<p>#hashtag</p>")
        self.assertEqual(dash, "<p>-x</p>")
        self.assertEqual(decimal, "<p>1.5 m</p>")
        self.assertEqual(rule, "<hr>")
