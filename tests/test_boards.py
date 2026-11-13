"""Live boards: a whiteboard of items the user rearranges and Hermes edits in place; placement without coordinates."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, boards, render, store  # noqa: E402
from test_types import load_plugin  # noqa: E402

SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><circle cx="10" cy="10" r="8" fill="currentColor"/></svg>'
PNG = "data:image/png;base64,iVBORw0KGgo="
BOARD = {"title": "Release flow", "items": [
    {"type": "text", "size": "title", "text": "Release flow"},
    {"type": "text", "size": "large", "text": "Nothing ships without review."},
    {"id": "dev", "type": "section", "text": "Development"},
    {"id": "a", "type": "box", "text": "Draft", "in": "dev"},
    {"id": "b", "type": "box", "kind": "diamond", "text": "Review ok?", "color": "yellow", "in": "dev"},
    {"id": "c", "type": "box", "kind": "pill", "text": "Ship", "color": "blue"},
    {"id": "ab", "type": "arrow", "from": "a", "to": "b"},
    {"id": "bc", "type": "arrow", "from": "b", "to": "c", "label": "yes"},
    {"type": "note", "text": "Owner: Anna", "near": "c"}]}


def op(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


def pub(board=None, title="Board"):
    return store.publish(title=title, type="board", files={"board.json": board or BOARD})["id"]


def place(items, **top):
    """board.json's items, placed: {id: item}."""
    return {it["id"]: it for it in boards.from_spec({"items": items, **top})["items"]}


def overlaps(items):
    """Pairs of placed items (no arrows; a section and its members aside) whose boxes overlap."""
    its = [it for it in items if it["type"] != "arrow"]
    out = []
    for i, a in enumerate(its):
        for b in its[i + 1:]:
            if "section" in (a["type"], b["type"]):
                sec, other = (a, b) if a["type"] == "section" else (b, a)
                if other["type"] != "section" and other in boards.members(sec, its):
                    continue
            ra, rb = boards.rect(a), boards.rect(b)
            if ra[0] < rb[0] + rb[2] and rb[0] < ra[0] + ra[2] and ra[1] < rb[1] + rb[3] and rb[1] < ra[1] + ra[3]:
                out.append((a["id"], b["id"]))
    return out


class ValidationTests(unittest.TestCase):
    def ok(self, item):
        return boards.clean_item(item, "it")[0]

    def bad(self, item, word=None):
        with self.assertRaises(boards.BoardError) as cm:
            boards.clean_item(item, "it")
        if word:
            self.assertIn(word, cm.exception.message)

    def test_box(self):
        it = self.ok({"type": "box", "text": "Hi", "kind": "cloud", "color": "#12abEF", "stroke": "terracotta",
                      "hollow": True, "size": "large", "align": "left", "x": 1.234, "y": 2, "w": 200, "h": 80,
                      "locked": True, "group": "g1", "id": "A.b-1_"})
        self.assertEqual((it["x"], it["y"], it["kind"], it["locked"]), (1.23, 2, "cloud", True))
        for k in boards.KINDS:
            self.ok({"type": "box", "kind": k})
        self.assertEqual(len(boards.KINDS), 12)
        self.bad({"type": "box", "kind": "star"}, "one of rect")
        self.bad({"type": "box", "color": "red"}, "yellow")
        self.bad({"type": "box", "stroke": "yellow"})
        self.bad({"type": "box", "size": "big"})
        self.bad({"type": "box", "text": "x" * 4001}, "4000")
        self.bad({"type": "box", "x": 5}, "x and y go together")
        self.bad({"type": "box", "id": "no spaces"})
        self.bad({"type": "box", "id": "x" * 41})
        self.bad({"type": "box", "rows": [["a"]]}, "has no 'rows'")
        self.bad({"type": "blob"}, "one of box")
        self.bad({"type": "box", "x": float("inf"), "y": 0})
        self.assertNotIn("locked", self.ok({"type": "box", "locked": False}))

    def test_note_text_section(self):
        self.ok({"type": "note", "text": "a\nb", "color": "pink", "size": "small"})
        self.bad({"type": "note", "kind": "rect"})
        t = self.ok({"type": "text", "text": "Words", "color": "terracotta", "align": "right", "w": 300, "h": 90})
        self.assertNotIn("h", t)  # derived, never stored
        self.bad({"type": "text", "color": "yellow"}, "ink")
        s = self.ok({"type": "section", "text": "Group", "color": "blue", "w": 400, "h": 300})
        self.assertEqual(s["w"], 400)
        _, hints = boards.clean_item({"type": "section", "layout": "grid"}, "it")
        self.assertEqual(hints, {"layout": "grid"})
        self.bad({"type": "section", "layout": "spiral"})
        self.bad({"type": "box", "layout": "row"})

    def test_arrow(self):
        a = self.ok({"type": "arrow", "from": "a", "to": [10, 20.5], "fromSide": "right", "toSide": "top", "label": "yes",
                     "dash": True, "heads": ["circle", "arrow"], "color": "purple", "via": [[1, 2], [3, 4]], "x": 5, "y": 5})
        self.assertEqual(a["to"], [10, 20.5])
        self.assertNotIn("x", a)
        self.bad({"type": "arrow", "from": "a"}, "needs to")
        self.bad({"type": "arrow", "from": "a", "to": "a"}, "two different")
        self.bad({"type": "arrow", "from": "a", "to": "b", "fromSide": "middle"})
        self.bad({"type": "arrow", "from": "a", "to": "b", "heads": ["arrow"]})
        self.bad({"type": "arrow", "from": "a", "to": "b", "heads": ["arrow", "star"]})
        self.bad({"type": "arrow", "from": "a", "to": [1, 2, 3]})
        self.bad({"type": "arrow", "from": "a", "to": "b", "via": [[0, 0]] * 21})
        with self.assertRaises(boards.BoardError) as cm:
            boards.from_spec({"items": [{"type": "box", "id": "a"}, {"type": "arrow", "from": "a", "to": "zz"}]})
        self.assertIn("names no item 'zz'", cm.exception.message)
        with self.assertRaises(boards.BoardError):  # an arrow can't hold on to an arrow
            boards.from_spec({"items": [{"type": "box", "id": "a"}, {"type": "box", "id": "b"},
                                        {"type": "arrow", "id": "r", "from": "a", "to": "b"}, {"type": "arrow", "from": "a", "to": "r"}]})

    def test_pen_table(self):
        self.ok({"type": "pen", "points": [0, 0, 10, 5, 20, 0], "color": "blue", "width": 6, "x": 0, "y": 0})
        self.bad({"type": "pen", "points": [0, 0, 1]})
        self.bad({"type": "pen", "points": [0] * 4002}, "4000")
        self.bad({"type": "pen", "points": [0, 0], "width": 0})
        self.bad({"type": "pen"}, "needs points")
        t = self.ok({"type": "table", "rows": [["Plan", "Price"], ["Pro", 20], ["Free"]], "w": 9, "h": 9})
        self.assertEqual(t["rows"], [["Plan", "Price"], ["Pro", "20"], ["Free", ""]])
        self.assertNotIn("w", t)
        self.ok({"type": "table", "rows": [["a", "b"]], "colw": [100, 200]})
        self.bad({"type": "table", "rows": [["a", "b"]], "colw": [100]}, "one width per column")
        self.bad({"type": "table", "rows": []})
        self.bad({"type": "table", "rows": [[{"a": 1}]]})
        self.bad({"type": "table", "rows": [["a"] * 31]}, "at most")

    def test_image_drawing_embed(self):
        self.ok({"type": "image", "src": "images/x.png", "w": 100, "h": 50})
        self.ok({"type": "image", "src": PNG})
        self.bad({"type": "image", "src": "https://example.com/x.png"})
        self.bad({"type": "image", "src": "../x.png"})
        self.bad({"type": "image", "src": "data:image/svg+xml;base64,AAAA"})
        self.bad({"type": "image", "src": "data:image/png;base64," + "A" * 140_000}, "100 KB")
        self.ok({"type": "drawing", "svg": SVG})
        e = self.ok({"type": "embed", "html": "<button>Vote</button>", "title": "Poll", "state": {"votes": [1, 2]}})
        self.assertEqual(e["state"], {"votes": [1, 2]})
        self.bad({"type": "embed", "html": "x" * 16_001}, "16000")
        self.bad({"type": "embed", "html": "x", "state": {"a": "y" * 16_000}}, "16000")
        self.bad({"type": "embed", "html": "x", "state": [1]})
        self.bad({"type": "embed"}, "needs html")

    def test_svg_is_sanitised(self):
        wrap = lambda inner, attrs="": f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"{attrs}>{inner}</svg>'  # noqa: E731
        for bad in (wrap("<script>alert(1)</script>"),
                    wrap('<foreignObject><p xmlns="http://www.w3.org/1999/xhtml">x</p></foreignObject>'),
                    wrap('<rect onclick="x()" width="1" height="1"/>'),
                    wrap("", ' onload="x()"'),
                    wrap('<image href="https://evil.example/a.png"/>'),
                    wrap('<a href="javascript:alert(1)"><rect width="1" height="1"/></a>'),
                    wrap('<a href="java\tscript:alert(1)"><rect width="1" height="1"/></a>'),
                    wrap('<rect style="fill:url(https://evil.example/x.svg#a)" width="1" height="1"/>'),
                    wrap('<style>@import "https://evil.example/a.css";</style>'),
                    '<!DOCTYPE svg [<!ENTITY x "y">]>' + wrap(""),
                    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',  # no viewBox
                    "<div>not svg</div>", "<svg viewBox='0 0 1 1'><rect></svg>",
                    "data:image/svg+xml;base64,PHN2Zy8+",
                    wrap("<!--" + "x" * 60_000 + "-->")):
            with self.assertRaises(boards.BoardError, msg=bad[:80]):
                boards.clean_item({"type": "drawing", "svg": bad}, "it")
        ok = wrap('<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="1" height="1"/><use href="#g"/>')
        self.assertEqual(boards.clean_item({"type": "drawing", "svg": ok}, "it")[0]["svg"], ok)
        self.assertIs(api._safe_svg, store.safe_svg)  # the one checker, shared with the design system's uploads

    def test_limits(self):
        with self.assertRaises(boards.BoardError) as cm:
            boards.from_spec({"items": [{"type": "text", "text": "x", "x": 0, "y": i} for i in range(801)]})
        self.assertIn("800", cm.exception.message)
        big = {"type": "table", "rows": [["x" * 4000] * 30] * 2, "x": 0, "y": 0}
        with self.assertRaises(boards.BoardError) as cm:
            boards.clean_item(big, "it")
        self.assertIn("200 KB", cm.exception.message)
        mid = {"type": "table", "rows": [["x" * 3000] * 30] * 2, "x": 0, "y": 0}
        with self.assertRaises(boards.BoardError) as cm:
            boards.from_spec({"items": [mid] * 12})
        self.assertIn("2 MB", cm.exception.message)
        with self.assertRaises(boards.BoardError):
            boards.from_spec({"items": [], "zoom": 2})
        with self.assertRaises(boards.BoardError):
            boards.from_spec({"title": "t"})
        with self.assertRaises(boards.BoardError) as cm:
            boards.from_spec({"items": [{"type": "box", "id": "a"}, {"type": "note", "id": "a"}]})
        self.assertIn("taken", cm.exception.message)
        self.assertEqual(boards.from_spec({"items": []})["items"], [])


class MeasureTests(unittest.TestCase):
    def test_the_measure_rule(self):
        w, h, lines = boards.measure("Hello", 16)
        self.assertEqual((w, h, lines), (44.0, 22.4, ["Hello"]))
        self.assertEqual(boards.measure("Hello", 16, None, True)[0], 48.0)
        w, h, lines = boards.measure("one two three four", 16, 88)  # 10 characters a line
        self.assertEqual(lines, ["one two", "three four"])
        self.assertEqual(boards.measure("a\n\nb", 20)[1], 84.0)
        self.assertEqual(boards.measure("**bold** and [a link](https://x.y/z)", 16)[2], ["bold and a link"])  # marks take no room
        self.assertEqual(boards.measure("abcdefghij", 16, 44)[2], ["abcde", "fghij"])

    def test_sizes(self):
        b = place([{"id": "a", "type": "box", "text": "Hi"}, {"id": "d", "type": "box", "kind": "diamond", "text": "Hi"},
                   {"id": "long", "type": "box", "text": "word " * 40}, {"id": "n", "type": "note", "text": ""},
                   {"id": "w", "type": "box", "text": "Supercalifragilisticexpialidocious!!"},
                   {"id": "k", "type": "box", "text": "Hi", "w": 300}, {"id": "t", "type": "box", "size": "title", "text": "Big words here"}])
        self.assertEqual((b["a"]["w"], b["a"]["h"]), (180, 60))
        self.assertEqual((b["d"]["w"], b["d"]["h"]), (234, 78))  # 30 % more room
        self.assertEqual(b["long"]["w"], 180)
        self.assertGreater(b["long"]["h"], 200)
        self.assertEqual((b["n"]["w"], b["n"]["h"]), (180, 60))
        self.assertGreater(b["w"]["w"], 36 * 8.8 + 31)  # a long word widens it
        self.assertEqual((b["k"]["w"], b["k"]["h"]), (300, 60))
        self.assertGreater(b["t"]["w"], 500)
        for it in b.values():
            self.assertGreaterEqual(it["w"], 120)
            self.assertGreaterEqual(it["h"], 60)
        t = {"type": "table", "rows": [["Plan", "Price"], ["Pro", "$20"]], "x": 0, "y": 0}
        self.assertEqual(boards.table_layout(t), ([80, 80], [39, 39]))
        self.assertEqual(boards.rect(t), (0, 0, 160, 78))
        self.assertEqual(boards.rect({"type": "pen", "points": [0, 0, 30, -10, 60, 20], "x": 100, "y": 100}), (100, 90, 60, 30))
        self.assertEqual(boards.rect({"type": "text", "text": "Hello", "x": 5, "y": 6}), (5, 6, 44, 23))
        d = place([{"id": "d", "type": "drawing", "svg": SVG}, {"id": "e", "type": "embed", "html": "x"},
                   {"id": "i", "type": "image", "src": "images/a.png"}])
        self.assertEqual((d["d"]["w"], d["d"]["h"]), (240, 120))  # the viewBox's shape
        self.assertEqual((d["e"]["w"], d["e"]["h"], d["i"]["w"], d["i"]["h"]), (320, 240, 240, 180))


class HermesAtWorkTests(unittest.TestCase):
    def test_the_window_left_counts_down_and_the_page_is_told(self):
        # The page hides its "Hermes is working" pill on its own when hermes_left runs out (it no longer
        # depends on a later read to take it away).
        aid = pub()
        st = boards.load(aid)
        now = boards.time.time()
        for ago, left in ((0, boards.ACTIVE_SECS), (100.5, boards.ACTIVE_SECS - 100), (boards.ACTIVE_SECS - 0.2, 1), (boards.ACTIVE_SECS, 0), (5000, 0)):
            st["hermes_at"] = now - ago
            with mock.patch.object(boards.time, "time", return_value=now):
                self.assertEqual((boards.left(st), boards._active(st)), (left, left > 0), ago)
        r = op(aid, "board.read")
        self.assertIsInstance(r["hermes_left"], int)
        self.assertEqual(r["hermes_active"], r["hermes_left"] > 0)
        self.assertNotIn("hermes_left", boards.read(aid, agent=True))  # not the agent's business
        sid = store.publish(title="S", type="sheet", files={"sheet.json": {"sheets": [{"name": "A", "cells": {"A1": 1}}]}})["id"]
        from hermes_artifacts import sheets
        self.assertIn("hermes_left", sheets.read(sid))
        self.assertNotIn("hermes_left", sheets.read(sid, agent=True))
        # And how long ago Hermes changed it: the page tells from it whether the change came in the run in
        # flight (Hermes Desktop says which runs are), so the pill ends with the run, not minutes later.
        st["hermes_at"] = now - 42.04
        with mock.patch.object(boards.time, "time", return_value=now):
            self.assertEqual(boards.ago(st), 42.0)
        self.assertIsInstance(r["hermes_ago"], float)
        self.assertIn("hermes_ago", sheets.read(sid))
        self.assertNotIn("hermes_ago", sheets.read(sid, agent=True))
        self.assertNotIn("hermes_ago", boards.read(aid, agent=True))


class PlacementTests(unittest.TestCase):
    def test_notes_in_one_row_share_the_tallest_height(self):
        words = ["Referral bonus", "Partner webinars", "SEO landing pages and a long tail of more", "Runbooks"]
        loose = place([{"id": f"n{i}", "type": "note", "text": t} for i, t in enumerate(words)])
        self.assertEqual(len({it["y"] for it in loose.values()}), 1)
        self.assertEqual({it["h"] for it in loose.values()}, {max(it["h"] for it in loose.values())})
        self.assertGreater(loose["n2"]["h"], boards.from_spec({"items": [{"id": "x", "type": "note", "text": "Runbooks"}]})["items"][0]["h"])
        # per section and per row: the rows of two sections (and a note given its own height) keep theirs
        its = place([{"id": "g", "type": "section", "text": "G"}, {"id": "o", "type": "section", "text": "O"}]
                    + [{"id": f"g{i}", "type": "note", "text": t, "in": "g"} for i, t in enumerate(words)]
                    + [{"id": f"o{i}", "type": "note", "text": t, "in": "o"} for i, t in enumerate(["A", "B"])]
                    + [{"id": "fixed", "type": "note", "text": "Mine", "h": 300, "in": "o"}])
        self.assertEqual({its[f"g{i}"]["h"] for i in range(4)}, {its["g2"]["h"]})
        self.assertEqual((its["o0"]["h"], its["o1"]["h"], its["fixed"]["h"]), (60, 60, 300))
        self.assertEqual(overlaps(list(its.values())), [])
        for sid in ("g", "o"):
            sec = boards.rect(its[sid])
            for m in boards.members(its[sid], list(its.values())):
                r = boards.rect(m)
                self.assertLessEqual(r[1] + r[3], sec[1] + sec[3], m["id"])  # still inside its section

    def test_everything_gets_a_place_and_nothing_overlaps(self):
        b = boards.from_spec(BOARD)
        for it in b["items"]:
            self.assertTrue(it["type"] == "arrow" or ("x" in it and "y" in it), it)
            self.assertTrue(it["id"])
        self.assertEqual(overlaps(b["items"]), [])
        self.assertEqual(json.dumps(boards.from_spec(BOARD)), json.dumps(b))  # deterministic
        ids = [it["id"] for it in b["items"]]
        self.assertEqual(ids[0], "dev")  # a section sits behind everything
        self.assertEqual([i for i in ids if i.startswith("e")], ["e1", "e2", "e3"])

    def test_title_lines_stay_at_the_top_left(self):
        by = {it["id"]: it for it in boards.from_spec(BOARD)["items"]}
        title, sub = by["e1"], by["e2"]
        self.assertEqual((title["x"], title["y"]), boards.ORIGIN)
        self.assertEqual(sub["x"], title["x"])
        self.assertGreater(sub["y"], title["y"])
        rest_top = min(boards.rect(it)[1] - (28 if it["type"] == "section" else 0) for it in by.values()
                       if it["type"] != "arrow" and it["id"] not in ("e1", "e2"))
        r = boards.rect(sub)
        self.assertEqual(rest_top, r[1] + r[3] + 52)

    def test_flow_goes_left_to_right(self):
        b = place([{"id": i, "type": "box", "text": i} for i in "abcd"] +
                  [{"type": "arrow", "from": "a", "to": "b"}, {"type": "arrow", "from": "b", "to": "c", "label": "ok"},
                   {"type": "arrow", "from": "c", "to": "d"}])
        self.assertLess(b["a"]["x"], b["b"]["x"])
        self.assertLess(b["b"]["x"], b["c"]["x"])
        self.assertLess(b["c"]["x"], b["d"]["x"])
        self.assertEqual({b[i]["y"] for i in "abcd"}, {b["a"]["y"]})  # one line
        self.assertEqual(b["b"]["x"] - (b["a"]["x"] + b["a"]["w"]), 64)
        self.assertEqual(b["c"]["x"] - (b["b"]["x"] + b["b"]["w"]), 144)  # room for the label
        self.assertEqual(b["d"]["x"] - (b["c"]["x"] + b["c"]["w"]), 64)

    def test_flow_layers_and_rows(self):
        b = place([{"id": i, "type": "box", "text": i} for i in ("root", "x", "y", "z", "end")] +
                  [{"type": "arrow", "from": "root", "to": i} for i in "xyz"] +
                  [{"type": "arrow", "from": i, "to": "end"} for i in "xyz"])
        self.assertEqual({b[i]["x"] for i in "xyz"}, {b["x"]["x"]})  # one layer
        self.assertEqual(b["y"]["y"] - (b["x"]["y"] + b["x"]["h"]), 24)
        self.assertEqual(b["z"]["y"] - (b["y"]["y"] + b["y"]["h"]), 24)
        self.assertEqual(b["root"]["y"], b["y"]["y"])  # centred on its layer
        self.assertLess(b["x"]["x"], b["end"]["x"])
        self.assertEqual(overlaps(b.values()), [])

    def test_a_loop_still_lays_out(self):
        b = place([{"id": i, "type": "box", "text": i} for i in "abc"] +
                  [{"type": "arrow", "from": "a", "to": "b"}, {"type": "arrow", "from": "b", "to": "c"},
                   {"type": "arrow", "from": "c", "to": "a"}])
        self.assertLess(b["a"]["x"], b["b"]["x"])
        self.assertLess(b["b"]["x"], b["c"]["x"])

    def test_flow_down(self):
        b = place([{"id": i, "type": "box", "text": i} for i in "abc"] +
                  [{"type": "arrow", "from": "a", "to": "b"}, {"type": "arrow", "from": "b", "to": "c"}], flow="down")
        self.assertLess(b["a"]["y"], b["b"]["y"])
        self.assertLess(b["b"]["y"], b["c"]["y"])
        self.assertEqual(b["a"]["x"], b["c"]["x"])
        self.assertEqual(b["b"]["y"] - (b["a"]["y"] + b["a"]["h"]), 64)
        with self.assertRaises(boards.BoardError):
            boards.from_spec({"items": [], "flow": "up"})

    def test_more_than_six_layers_wrap(self):
        n = 9
        b = place([{"id": f"s{i}", "type": "box", "text": str(i)} for i in range(n)] +
                  [{"type": "arrow", "from": f"s{i}", "to": f"s{i + 1}"} for i in range(n - 1)])
        first = [b[f"s{i}"] for i in range(6)]
        self.assertEqual({it["y"] for it in first}, {first[0]["y"]})
        self.assertEqual(b["s6"]["x"], b["s0"]["x"])  # starts again at the left
        self.assertEqual(b["s6"]["y"], first[0]["y"] + first[0]["h"] + 64)
        self.assertLess(b["s6"]["x"], b["s7"]["x"])
        self.assertEqual(overlaps(b.values()), [])

    def test_a_section_is_sized_around_its_members(self):
        b = place([{"id": "s", "type": "section", "text": "Team"},
                   {"id": "a", "type": "box", "text": "A", "in": "s"}, {"id": "b", "type": "box", "text": "B", "in": "s"},
                   {"id": "c", "type": "box", "text": "C", "in": "s"}])
        s = b["s"]
        self.assertEqual((s["w"], s["h"]), (3 * 180 + 2 * 24 + 48, 60 + 48))
        self.assertEqual((b["a"]["x"], b["a"]["y"]), (s["x"] + 24, s["y"] + 24))
        self.assertEqual(b["b"]["x"] - (b["a"]["x"] + 180), 24)
        self.assertEqual({m["id"] for m in boards.members(s, list(b.values()))}, {"a", "b", "c"})
        col = place([{"id": "s", "type": "section", "layout": "column"},
                     {"id": "a", "type": "box", "text": "A", "in": "s"}, {"id": "b", "type": "box", "text": "B", "in": "s"}])
        self.assertEqual((col["s"]["w"], col["s"]["h"]), (180 + 48, 2 * 60 + 24 + 48))
        self.assertEqual(col["b"]["y"] - (col["a"]["y"] + 60), 24)
        grid = place([{"id": "s", "type": "section", "layout": "grid"}] +
                     [{"id": f"m{i}", "type": "box", "text": str(i), "in": "s"} for i in range(4)])
        self.assertEqual((grid["s"]["w"], grid["s"]["h"]), (2 * 180 + 24 + 48, 2 * 60 + 24 + 48))
        empty = place([{"id": "s", "type": "section"}])
        self.assertEqual((empty["s"]["w"], empty["s"]["h"]), (480, 320))
        with self.assertRaises(boards.BoardError):
            place([{"id": "a", "type": "box", "in": "nope"}])
        with self.assertRaises(boards.BoardError):
            place([{"id": "x", "type": "box"}, {"id": "a", "type": "box", "in": "x"}])  # not a section

    def test_members_joined_by_arrows_flow_inside_the_section(self):
        by = {it["id"]: it for it in boards.from_spec(BOARD)["items"]}
        s, a, b, c = by["dev"], by["a"], by["b"], by["c"]
        self.assertEqual(b["x"] - (a["x"] + a["w"]), 64)
        self.assertEqual({m["id"] for m in boards.members(s, list(by.values()))}, {"a", "b"})
        self.assertEqual(c["x"] - (s["x"] + s["w"]), 144)  # the labelled arrow leaves the section
        self.assertAlmostEqual(c["y"] + c["h"] / 2, s["y"] + s["h"] / 2, delta=1)  # in line with the frame, not its title

    def test_loose_items_go_in_a_row_that_wraps(self):
        b = place([{"id": f"n{i}", "type": "note", "text": str(i)} for i in range(9)])
        self.assertEqual(b["n1"]["x"] - b["n0"]["x"], 204)
        self.assertEqual({b[f"n{i}"]["y"] for i in range(6)}, {b["n0"]["y"]})
        self.assertEqual((b["n6"]["x"], b["n6"]["y"]), (b["n0"]["x"], b["n0"]["y"] + 60 + 24))
        self.assertLessEqual(max(it["x"] + it["w"] for it in b.values()) - b["n0"]["x"], 1400)

    def test_coordinates_given_are_kept(self):
        b = place([{"id": "a", "type": "box", "text": "A", "x": 500, "y": 300, "w": 222, "h": 77},
                   {"id": "s", "type": "section", "x": -100.5, "y": 40, "w": 300, "h": 200},
                   {"id": "b", "type": "box", "text": "B"},
                   {"type": "arrow", "id": "r", "from": [1, 2], "to": "a", "via": [[3, 4]]}])
        self.assertEqual((b["a"]["x"], b["a"]["y"], b["a"]["w"], b["a"]["h"]), (500, 300, 222, 77))
        self.assertEqual((b["s"]["x"], b["s"]["y"], b["s"]["w"], b["s"]["h"]), (-100.5, 40, 300, 200))
        self.assertEqual((b["r"]["from"], b["r"]["via"]), ([1, 2], [[3, 4]]))
        self.assertGreaterEqual(b["b"]["y"], 300 + 77 + 24)  # under what is there
        self.assertEqual(overlaps(b.values()), [])

    def test_near_and_arrows_to_what_is_there(self):
        b = place([{"id": "a", "type": "box", "text": "A", "x": 0, "y": 0}, {"id": "blk", "type": "box", "text": "B", "x": 204, "y": 0},
                   {"id": "n", "type": "note", "text": "beside", "near": "a"}])
        n = b["n"]
        self.assertEqual((n["x"], n["y"]), (0, 60 + 24))  # right is taken: under it
        self.assertEqual(overlaps(b.values()), [])
        b = place([{"id": "a", "type": "box", "text": "A", "x": 0, "y": 0}, {"id": "far", "type": "box", "text": "F", "x": 0, "y": 2000},
                   {"id": "new", "type": "box", "text": "N"}, {"type": "arrow", "from": "a", "to": "new"}])
        self.assertEqual((b["new"]["x"], b["new"]["y"]), (180 + 64, 0))  # joined to a: beside it
        with self.assertRaises(boards.BoardError):
            place([{"id": "n", "type": "note", "near": "ghost"}])

    def test_new_members_of_a_placed_section(self):
        aid = pub({"items": [{"id": "s", "type": "section", "text": "S", "x": 0, "y": 0, "w": 260, "h": 120},
                             {"id": "a", "type": "box", "text": "A", "x": 24, "y": 24}]})
        r = boards.apply(aid, {"op": "add", "items": [{"id": "b", "type": "box", "text": "B", "in": "s"}]}, by="hermes")
        self.assertEqual(sorted(r["changed"]), ["b", "s"])  # the section grew to hold it
        by = {it["id"]: it for it in boards.load(aid)["items"]}
        self.assertEqual({m["id"] for m in boards.members(by["s"], list(by.values()))}, {"a", "b"})
        self.assertEqual(overlaps(by.values()), [])
        self.assertGreaterEqual(by["s"]["y"] + by["s"]["h"], by["b"]["y"] + by["b"]["h"] + 24)
        r = boards.apply(aid, {"op": "add", "items": [{"id": "c", "type": "note", "text": "C", "near": "a"}]}, by="hermes")
        by = {it["id"]: it for it in boards.load(aid)["items"]}
        self.assertIn("c", {m["id"] for m in boards.members(by["s"], list(by.values()))})  # a neighbour of a member joins it
        self.assertEqual(overlaps(by.values()), [])


class OpTests(unittest.TestCase):
    def setUp(self):
        self.aid = pub({"title": "Ops", "items": [
            {"id": "s", "type": "section", "text": "S", "x": 0, "y": 0, "w": 500, "h": 200},
            {"id": "a", "type": "box", "text": "A", "x": 24, "y": 24},
            {"id": "b", "type": "box", "text": "B", "x": 260, "y": 24},
            {"id": "out", "type": "box", "text": "Out", "x": 800, "y": 0},
            {"id": "ab", "type": "arrow", "from": "a", "to": "b", "via": [[230, 10]]},
            {"id": "bo", "type": "arrow", "from": "b", "to": "out"},
            {"id": "free", "type": "arrow", "from": [0, 300], "to": [100, 300]},
            {"id": "emb", "type": "embed", "html": "<b>poll</b>", "x": 800, "y": 300}]})

    def items(self):
        return {it["id"]: it for it in boards.load(self.aid)["items"]}

    def rev(self):
        return boards.load(self.aid)["rev"]

    def edit(self, ops, by="user", base=None):
        return boards.apply(self.aid, ops, by=by, base_rev=base)

    def test_add(self):
        r = self.edit({"op": "add", "items": [{"type": "box", "text": "New"}, {"id": "mine", "type": "note", "text": "N", "x": 5, "y": 900}]})
        self.assertEqual((r["rev"], r["added"], r["changed"]), (2, ["e1", "mine"], ["e1", "mine"]))
        it = self.items()
        self.assertEqual((it["mine"]["x"], it["mine"]["y"]), (5, 900))
        self.assertGreater(it["e1"]["y"], 300)  # under what is there
        self.assertEqual(overlaps(it.values()), [])
        r = self.edit({"op": "add", "items": [{"type": "box", "text": "Again"}]})
        self.assertEqual(r["added"], ["e2"])
        with self.assertRaises(boards.BoardError):
            self.edit({"op": "add", "items": [{"id": "a", "type": "box"}]})  # taken
        with self.assertRaises(boards.BoardError):
            self.edit({"op": "add", "items": {"type": "box"}})
        r = self.edit({"op": "add", "near": "out", "items": [{"id": "nb", "type": "note", "text": "by out"}]})
        nb, out = self.items()["nb"], self.items()["out"]
        self.assertEqual((nb["x"], nb["y"]), (out["x"] + out["w"] + 24, out["y"]))
        r = self.edit({"op": "add", "flow": "down", "items": [{"id": "p", "type": "box", "text": "P"}, {"id": "q", "type": "box", "text": "Q"},
                                                               {"type": "arrow", "from": "p", "to": "q"}]})
        it = self.items()
        self.assertEqual((it["q"]["x"], it["q"]["y"]), (it["p"]["x"], it["p"]["y"] + 60 + 64))
        ids = [x["id"] for x in boards.load(self.aid)["items"]]
        self.edit({"op": "add", "items": [{"id": "s2", "type": "section", "text": "Back"}]})
        ids = [x["id"] for x in boards.load(self.aid)["items"]]
        self.assertEqual(ids[:2], ["s", "s2"])  # sections go behind

    def test_set(self):
        r = self.edit({"op": "set", "id": "a", "text": "Changed", "color": "pink", "x": 30})
        self.assertEqual(r["changed"], ["a"])
        a = self.items()["a"]
        self.assertEqual((a["text"], a["color"], a["x"], a["y"]), ("Changed", "pink", 30, 24))
        self.edit({"op": "set", "id": "a", "color": None})
        self.assertNotIn("color", self.items()["a"])
        self.edit({"op": "set", "id": "ab", "label": "go", "to": "out", "via": None})
        ab = self.items()["ab"]
        self.assertEqual((ab["label"], ab["to"]), ("go", "out"))
        self.assertNotIn("via", ab)
        for bad in ({"op": "set", "id": "a", "type": "note"}, {"op": "set", "id": "a"}, {"op": "set", "id": "zz", "text": "x"},
                    {"op": "set", "id": "a", "x": None}, {"op": "set", "id": "a", "rows": [["x"]]}, {"op": "set", "id": "a", "in": "s"},
                    {"op": "set", "id": "ab", "to": "nope"}, {"op": "set", "id": "a", "color": "red"}):
            with self.assertRaises(boards.BoardError, msg=bad):
                self.edit(bad)
        self.assertEqual(self.items()["a"]["text"], "Changed")

    def test_hermes_text_grows_the_box_and_a_section_moves_with_its_members(self):
        self.edit({"op": "set", "id": "a", "text": "many words " * 20}, by="hermes", base=1)
        a = self.items()["a"]
        self.assertEqual(a["w"], 180)
        self.assertGreater(a["h"], 150)
        self.edit({"op": "set", "id": "a", "text": "short"}, by="hermes", base=2)
        self.assertEqual(self.items()["a"]["h"], a["h"])  # never smaller
        before = self.items()
        self.edit({"op": "set", "id": "s", "x": 100, "y": 50})  # the page sends its own moves
        self.assertEqual(self.items()["b"]["x"], before["b"]["x"])
        self.edit({"op": "set", "id": "s", "x": 0, "y": 0})
        self.edit({"op": "set", "id": "s", "x": 100, "y": 50, "with": True})
        it = self.items()
        self.assertEqual((it["b"]["x"], it["b"]["y"]), (before["b"]["x"] + 100, before["b"]["y"] + 50))
        self.assertEqual(it["out"]["x"], before["out"]["x"])

    def test_move(self):
        r = self.edit({"op": "move", "ids": ["a", "free"], "dx": 10, "dy": -5.5})
        self.assertEqual(sorted(r["changed"]), ["a", "free"])
        it = self.items()
        self.assertEqual((it["a"]["x"], it["a"]["y"]), (34, 18.5))
        self.assertEqual((it["free"]["from"], it["free"]["to"]), ([10, 294.5], [110, 294.5]))
        self.assertEqual(it["b"]["x"], 260)  # the page names every id itself
        with self.assertRaises(boards.BoardError):
            self.edit({"op": "move", "ids": ["zz"], "dx": 1, "dy": 1})
        with self.assertRaises(boards.BoardError):
            self.edit({"op": "move", "ids": [], "dx": 1, "dy": 1})

    def test_hermes_moves_carry_section_members_and_group_mates(self):
        r = self.edit({"op": "move", "ids": ["s"], "dx": 100, "dy": 40}, by="hermes", base=1)
        self.assertEqual(sorted(r["changed"]), ["a", "b", "s"])
        it = self.items()
        self.assertEqual([(it[i]["x"], it[i]["y"]) for i in ("s", "a", "b")], [(100, 40), (124, 64), (360, 64)])
        self.assertEqual(it["ab"]["via"], [[330, 50]])  # the route between two moved items follows
        self.assertEqual(it["out"]["x"], 800)
        g = self.edit({"op": "group", "ids": ["out", "emb"]}, by="hermes")
        r = self.edit({"op": "move", "ids": ["out"], "dx": 0, "dy": 7}, by="hermes", base=g["rev"])
        self.assertEqual(sorted(r["changed"]), ["emb", "out"])
        self.assertEqual(self.items()["emb"]["y"], 307)

    def test_delete_takes_attached_arrows(self):
        r = self.edit({"op": "delete", "ids": ["b"]})
        self.assertEqual(sorted(r["changed"]), ["ab", "b", "bo"])
        self.assertEqual(sorted(r["removed"]), ["ab", "b", "bo"])
        self.assertEqual(sorted(self.items()), ["a", "emb", "free", "out", "s"])
        d = boards.read(self.aid, since_rev=1)
        self.assertEqual((d["changed"], sorted(d["removed"])), ([], ["ab", "b", "bo"]))

    def test_order_group_title_tidy(self):
        self.edit({"op": "order", "ids": ["a"], "to": "front"})
        self.assertEqual([x["id"] for x in boards.load(self.aid)["items"]][-1], "a")
        self.edit({"op": "order", "ids": ["emb", "a"], "to": "back"})
        self.assertEqual([x["id"] for x in boards.load(self.aid)["items"]][:2], ["emb", "a"])  # in the order they had
        with self.assertRaises(boards.BoardError):
            self.edit({"op": "order", "ids": ["a"], "to": "middle"})
        r = self.edit({"op": "group", "ids": ["a", "b"]})
        it = self.items()
        self.assertEqual(it["a"]["group"], it["b"]["group"])
        self.assertEqual(sorted(r["changed"]), ["a", "b"])
        r2 = self.edit({"op": "group", "ids": ["out", "emb"]})
        self.assertNotEqual(self.items()["out"]["group"], it["a"]["group"])
        self.edit({"op": "ungroup", "ids": ["a", "b"]})
        self.assertNotIn("group", self.items()["a"])
        with self.assertRaises(boards.BoardError):
            self.edit({"op": "group", "ids": ["a"]})
        self.edit({"op": "title", "title": "Renamed"})
        self.assertEqual(boards.read(self.aid)["title"], "Renamed")
        self.assertEqual(store.get_meta(self.aid)["title"], "Renamed")
        with self.assertRaises(boards.BoardError):
            self.edit({"op": "bogus"})
        self.assertEqual(r2["rev"], self.rev() - 2)

    def test_tidy(self):
        aid = pub({"items": [{"id": "x", "type": "box", "text": "X", "x": 900, "y": 700},
                             {"id": "y", "type": "box", "text": "Y", "x": 100, "y": 100},
                             {"id": "z", "type": "box", "text": "Z", "x": 110, "y": 110, "locked": True},
                             {"id": "sec", "type": "section", "x": 2000, "y": 0, "w": 900, "h": 700},
                             {"id": "m", "type": "note", "text": "M", "x": 2500, "y": 400},
                             {"id": "r", "type": "arrow", "from": "y", "to": "x", "via": [[5, 5]]}]})
        r = boards.apply(aid, {"op": "tidy"}, by="user")
        it = {i["id"]: i for i in boards.load(aid)["items"]}
        self.assertEqual((it["z"]["x"], it["z"]["y"]), (110, 110))  # locked: stays
        self.assertEqual(it["x"]["x"] - (it["y"]["x"] + 180), 64)  # the arrow's flow, left to right
        self.assertEqual(it["x"]["y"], it["y"]["y"])
        self.assertNotIn("via", it["r"])
        self.assertEqual({m["id"] for m in boards.members(it["sec"], list(it.values()))}, {"m"})
        self.assertEqual((it["sec"]["w"], it["sec"]["h"]), (180 + 48, 60 + 48))  # sized around its member again
        self.assertEqual(overlaps(it.values()), [])
        self.assertNotIn("z", r["changed"])
        boards.apply(aid, {"op": "move", "ids": ["m"], "dx": 3000, "dy": 0}, by="user")
        boards.apply(aid, {"op": "tidy", "ids": ["m"]}, by="user")
        after = {i["id"]: i for i in boards.load(aid)["items"]}
        self.assertEqual((after["x"]["x"], after["y"]["x"]), (it["x"]["x"], it["y"]["x"]))  # only what was named

    def test_state_is_not_an_edit(self):
        r = self.edit({"op": "state", "id": "emb", "state": {"votes": {"a": 2}}})
        self.assertEqual((r["rev"], r["changed"]), (2, ["emb"]))
        self.assertEqual(self.items()["emb"]["state"], {"votes": {"a": 2}})
        self.assertEqual(boards.history(self.aid)["snaps"], [])  # not in history
        self.assertEqual(boards.load(self.aid)["edits"], 0)
        d = boards.read(self.aid, since_rev=1)
        self.assertEqual([x["id"] for x in d["changed"]], ["emb"])  # other open copies still hear of it
        self.edit({"op": "set", "id": "emb", "title": "Poll"}, by="hermes", base=1)  # never a conflict
        with self.assertRaises(boards.BoardError):
            self.edit({"op": "state", "id": "a", "state": {}})
        with self.assertRaises(boards.BoardError):
            self.edit({"op": "state", "id": "emb", "state": {"x": "y" * 16_001}})

    def test_all_or_nothing(self):
        with self.assertRaises(boards.BoardError):
            self.edit([{"op": "set", "id": "a", "text": "kept?"}, {"op": "delete", "ids": ["nope"]}])
        self.assertEqual((self.items()["a"]["text"], self.rev()), ("A", 1))
        with self.assertRaises(boards.BoardError):
            self.edit([{"op": "add", "items": [{"type": "arrow", "from": "a", "to": "gone"}]}])
        with self.assertRaises(boards.BoardError):
            self.edit([])
        with self.assertRaises(boards.BoardError):
            self.edit([{"op": "title", "title": "x"}] * 501)
        with self.assertRaises(boards.BoardError):
            boards.apply(self.aid, {"op": "title", "title": "x"}, by="page")
        self.assertEqual(boards.read(self.aid)["title"], "Ops")


class ConflictTests(unittest.TestCase):
    def setUp(self):
        self.aid = pub({"items": [{"id": "a", "type": "box", "text": "A", "x": 0, "y": 0},
                                  {"id": "b", "type": "box", "text": "B", "x": 300, "y": 0},
                                  {"id": "c", "type": "box", "text": "C", "x": 600, "y": 0, "locked": True}]})

    def edit(self, ops, by, base=None):
        return boards.apply(self.aid, ops, by=by, base_rev=base)

    def test_hermes_needs_the_rev_it_read(self):
        with self.assertRaises(boards.BoardError) as cm:
            self.edit({"op": "set", "id": "a", "text": "x"}, "hermes")
        self.assertEqual(cm.exception.code, "missing_guard")
        self.edit({"op": "add", "items": [{"type": "note", "text": "n"}]}, "hermes")  # add never needs one
        self.edit({"op": "title", "title": "T"}, "hermes")

    def test_hermes_does_not_write_over_what_the_user_changed(self):
        self.edit({"op": "move", "ids": ["a"], "dx": 50, "dy": 0}, "user")  # rev 2
        with self.assertRaises(boards.BoardError) as cm:
            self.edit({"op": "set", "id": "a", "text": "mine"}, "hermes", 1)  # another field: still theirs
        self.assertEqual((cm.exception.code, cm.exception.extra["ids"], cm.exception.extra["rev"]), ("conflict", ["a"], 2))
        self.assertIn("a", cm.exception.message)
        self.edit({"op": "set", "id": "b", "text": "fine"}, "hermes", 1)  # an item the user left alone
        self.edit({"op": "add", "items": [{"type": "note", "text": "n"}]}, "hermes", 1)  # add never conflicts
        self.edit({"op": "set", "id": "a", "text": "mine"}, "hermes", 2)  # read again: goes through
        self.edit({"op": "delete", "ids": ["b"]}, "user")
        for o in ({"op": "set", "id": "b", "text": "x"}, {"op": "move", "ids": ["b"], "dx": 1, "dy": 1}, {"op": "delete", "ids": ["b"]}):
            with self.assertRaises(boards.BoardError) as cm:
                self.edit(o, "hermes", 4)
            self.assertEqual((cm.exception.code, cm.exception.extra["ids"]), ("conflict", ["b"]))
        self.edit({"op": "set", "id": "a", "text": "again"}, "hermes", 4)  # its own changes are no conflict

    def test_the_page_loses_only_the_fields_hermes_set(self):
        self.edit({"op": "set", "id": "a", "text": "by hermes"}, "hermes", 1)  # rev 2
        self.edit({"op": "move", "ids": ["a"], "dx": 5, "dy": 5}, "user", 1)  # other fields: last writer wins per field
        self.edit({"op": "set", "id": "a", "color": "blue"}, "user", 1)
        with self.assertRaises(boards.BoardError) as cm:
            self.edit({"op": "set", "id": "a", "text": "by user"}, "user", 1)
        self.assertEqual(cm.exception.code, "conflict")
        with self.assertRaises(boards.BoardError):
            self.edit({"op": "delete", "ids": ["a"]}, "user", 1)
        r = op(self.aid, "board.edit", ops=[{"op": "set", "id": "a", "text": "by user"}], base_rev=1)
        self.assertEqual((r["ok"], r["conflict"]), (False, ["a"]))
        self.assertIn("error", r)
        self.assertTrue(op(self.aid, "board.edit", ops=[{"op": "set", "id": "a", "text": "by user"}], base_rev=r["rev"])["ok"])

    def test_locked_items_stay_for_hermes(self):
        for o in ({"op": "move", "ids": ["c"], "dx": 1, "dy": 1}, {"op": "delete", "ids": ["c"]}, {"op": "set", "id": "c", "x": 1}):
            with self.assertRaises(boards.BoardError) as cm:
                self.edit(o, "hermes", 1)
            self.assertIn("locked", cm.exception.message)
        self.edit({"op": "set", "id": "c", "text": "words are fine"}, "hermes", 1)
        self.edit({"op": "move", "ids": ["c"], "dx": 1, "dy": 1}, "user")  # the page asks the person itself


class ReadTests(unittest.TestCase):
    def setUp(self):
        self.aid = pub({"title": "Read", "items": [
            {"id": "a", "type": "box", "text": "Alpha", "x": 0.4, "y": 10.6, "kind": "rounded", "color": "green", "size": "body", "align": "center"},
            {"id": "b", "type": "note", "text": "Beta budget", "x": 300, "y": 0, "color": "yellow"},
            {"id": "r", "type": "arrow", "from": "a", "to": "b", "heads": ["none", "arrow"], "dash": False, "label": "feeds"},
            {"id": "d", "type": "drawing", "svg": SVG, "x": 0, "y": 300},
            {"id": "e", "type": "embed", "html": "<b>hello</b>", "title": "Poll", "x": 300, "y": 300, "state": {"n": 1}},
            {"id": "p", "type": "pen", "points": [0, 0, 5, 5, 9, 2], "x": 600, "y": 0, "width": 3},
            {"id": "i", "type": "image", "src": PNG, "x": 600, "y": 300},
            {"id": "t", "type": "table", "rows": [["Plan", "Price"], ["Pro", "$20"]], "x": 0, "y": 600}]})

    def test_the_agents_read_is_compact(self):
        r = boards.read(self.aid, agent=True)
        self.assertEqual((r["rev"], r["title"], r["count"]), (1, "Read", 8))
        by = {it["id"]: it for it in r["items"]}
        self.assertEqual(by["a"], {"id": "a", "type": "box", "text": "Alpha", "x": 0, "y": 11, "w": 180, "h": 60})  # defaults out, whole numbers
        self.assertEqual(by["b"], {"id": "b", "type": "note", "text": "Beta budget", "x": 300, "y": 0, "w": 180, "h": 60})
        self.assertEqual(by["r"], {"id": "r", "type": "arrow", "from": "a", "to": "b", "label": "feeds"})
        self.assertEqual((by["d"]["svg"], by["e"]["html"], by["p"]["points"], by["i"]["src"]), (len(SVG), 12, 6, len(PNG)))
        self.assertEqual(by["e"]["state"], {"n": 1})
        self.assertNotIn("width", by["p"])
        self.assertEqual(by["t"]["rows"], [["Plan", "Price"], ["Pro", "$20"]])
        self.assertLess(len(json.dumps(r)), 1100)
        self.assertEqual(boards.load(self.aid)["items"][0]["x"], 0.4)  # the board itself keeps what was given

    def test_range_search_since(self):
        r = boards.read(self.aid, "d, e", agent=True)
        self.assertEqual([it["id"] for it in r["items"]], ["d", "e"])
        self.assertEqual((r["items"][0]["svg"], r["items"][1]["html"]), (SVG, "<b>hello</b>"))
        with self.assertRaises(boards.BoardError):
            boards.read(self.aid, "nope", agent=True)
        self.assertEqual([it["id"] for it in boards.read(self.aid, search="BUDGET", agent=True)["items"]], ["b"])
        self.assertEqual([it["id"] for it in boards.read(self.aid, search="pro", agent=True)["items"]], ["t"])
        self.assertEqual([it["id"] for it in boards.read(self.aid, search="feeds", agent=True)["items"]], ["r"])
        boards.apply(self.aid, [{"op": "set", "id": "b", "text": "Beta 2"}, {"op": "delete", "ids": ["a"]}], by="user")
        boards.apply(self.aid, {"op": "add", "items": [{"id": "n", "type": "note", "text": "new"}]}, by="user")
        r = boards.read(self.aid, since_rev=1, agent=True)
        self.assertEqual((sorted(it["id"] for it in r["items"]), r["removed"], r["rev"]), (["b", "n"], ["a", "r"], 3))
        r = boards.read(self.aid, since_rev=2, agent=True)
        self.assertEqual(([it["id"] for it in r["items"]], r["removed"]), (["n"], []))
        self.assertEqual(boards.read(self.aid, since_rev=3, agent=True)["items"], [])

    def test_the_pages_read(self):
        r = op(self.aid, "board.read")
        self.assertEqual(sorted(r), ["edits", "hermes_active", "hermes_ago", "hermes_left", "items", "rev", "title"])
        self.assertEqual(len(r["items"]), 8)
        self.assertEqual(r["items"][3]["svg"], SVG)  # everything in full
        e = op(self.aid, "board.edit", ops=[{"op": "order", "ids": ["a"], "to": "front"}, {"op": "set", "id": "b", "text": "B"}], base_rev=1)
        self.assertEqual((e["ok"], e["rev"], sorted(e["changed"])), (True, 2, ["a", "b"]))
        d = op(self.aid, "board.read", since_rev=1)
        self.assertEqual(sorted(x["id"] for x in d["changed"]), ["a", "b"])
        self.assertEqual((d["removed"], d["order"][-1], d["rev"]), ([], "a", 2))
        self.assertEqual(op(self.aid, "board.read", since_rev=2)["changed"], [])
        self.assertEqual(op(self.aid, "board.read", since_rev=0)["since"], "unavailable")
        with self.assertRaises(api.ApiError):
            op(self.aid, "board.edit", ops=[{"op": "set", "id": "zz", "text": "x"}])
        with self.assertRaises(api.ApiError):
            op(self.aid, "board.nope")
        with self.assertRaises(api.ApiError):
            op(pub_doc(), "board.read")

    def test_the_cap(self):
        aid = pub({"items": [{"type": "text", "text": f"t{i}", "x": 0, "y": i * 30} for i in range(320)]})
        r = boards.read(aid, agent=True)
        self.assertEqual((len(r["items"]), r["count"]), (300, 320))
        self.assertIn("320", r["more"])

    def test_dump(self):
        d = json.loads(boards.dump(self.aid))
        self.assertEqual((d["title"], len(d["items"]), d["items"][3]["svg"]), ("Read", 8, SVG))
        self.assertEqual(boards.from_spec(d)["items"], d["items"])  # a dump is a board.json again


def pub_doc():
    return store.publish(title="A doc", type="doc", files={"doc.md": "# Doc"})["id"]


class HistoryTests(unittest.TestCase):
    def test_history_and_restore(self):
        aid = pub({"title": "H", "items": [{"id": "a", "type": "box", "text": "one", "x": 0, "y": 0}]})
        self.assertEqual(boards.history(aid), {"rev": 1, "snaps": []})
        boards.apply(aid, {"op": "set", "id": "a", "text": "two"}, by="user")
        boards.apply(aid, {"op": "set", "id": "a", "text": "three"}, by="user")  # close together: one snapshot
        boards.apply(aid, [{"op": "add", "items": [{"id": "n", "type": "note", "text": "h"}]}, {"op": "title", "title": "H2"}], by="hermes")
        h = op(aid, "board.history")
        self.assertEqual(h["rev"], 4)
        self.assertEqual([(s["rev"], s["by"], s["items"]) for s in h["snaps"]], [(4, "hermes", 2), (3, "user", 1), (1, "start", 1)])
        self.assertTrue(all(isinstance(s["at"], float) for s in h["snaps"]))
        then = op(aid, "board.at", rev=1)
        self.assertEqual((then["rev"], then["title"], then["items"][0]["text"], then["current_rev"]), (1, "H", "one", 4))
        self.assertEqual(op(aid, "board.at", rev=2)["rev"], 1)  # the newest at or before
        r = op(aid, "board.restore", rev=1)
        self.assertEqual((r["ok"], r["rev"], r["restored"]), (True, 5, 1))
        now = boards.read(aid)
        self.assertEqual((now["title"], [i["text"] for i in now["items"]]), ("H", ["one"]))
        self.assertEqual(boards.history(aid)["snaps"][0]["by"], "restore")
        self.assertEqual(op(aid, "board.read", since_rev=4)["since"], "unavailable")  # everything may have changed
        with self.assertRaises(boards.BoardError) as cm:  # and what Hermes read before it is stale
            boards.apply(aid, {"op": "set", "id": "a", "text": "x"}, by="hermes", base_rev=4)
        self.assertEqual(cm.exception.code, "conflict")
        op(aid, "board.restore", rev=4)  # a restore can be taken back the same way
        self.assertEqual(len(boards.read(aid)["items"]), 2)
        with self.assertRaises(api.ApiError):
            op(aid, "board.at", rev=0)

    def test_state_survives_a_reload_from_disk(self):
        aid = pub({"items": [{"id": "a", "type": "box", "text": "one"}]})
        boards.apply(aid, {"op": "set", "id": "a", "text": "two"}, by="user")
        boards._CACHE.clear()
        boards._HIST_CACHE.clear()
        self.assertEqual(boards.read(aid)["items"][0]["text"], "two")
        self.assertEqual(len(boards.history(aid)["snaps"]), 2)


class PublishTests(unittest.TestCase):
    def test_publish_and_render(self):
        m = store.publish(title="Flow", type="board", files={"board.json": BOARD})
        self.assertEqual(m["type"], "board")
        self.assertEqual(store.TYPES[store.TYPES.index("sheet") + 1], "board")
        self.assertEqual(store.TYPE_ENTRY["board"], "board.json")
        html = render.render(m, store.version_dir(m["id"]))
        start = html.index('id="hermes-artifact-content">') + len('id="hermes-artifact-content">')
        c = json.loads(html[start:html.index("</script>", start)])
        self.assertEqual(sorted(c["board"]), ["hermes_active", "hermes_ago", "hermes_left", "items", "rev", "title"])
        self.assertEqual((c["board"]["title"], c["board"]["rev"], len(c["board"]["items"])), ("Release flow", 1, 9))
        self.assertTrue(all("x" in it for it in c["board"]["items"] if it["type"] != "arrow"))
        thumb = render.render(m, store.version_dir(m["id"]), thumb=True)
        self.assertIn('"hermes_active": false', thumb)
        rt = (PLUGIN / "hermes_artifacts" / "types" / "board" / "runtime.html").read_text("utf-8")
        order = [rt.index(s) for s in ("../_kit/kit.css", "../_kit/kit.js", "geo.js", "board.js")]
        self.assertEqual(order, sorted(order))
        self.assertIn("board.css", rt)
        self.assertIn('id="board"', rt)

    def test_a_bad_board_is_refused_at_publish(self):
        for bad, word in (({"items": [{"type": "box", "kind": "star"}]}, "one of rect"),
                          ({"items": [{"type": "arrow", "from": "a", "to": "b"}]}, "names no item"),
                          ({"sheets": []}, "board.json"), ("not json {", "not valid JSON")):
            with self.assertRaises(ValueError) as cm:
                store.publish(title="Bad", type="board", files={"board.json": bad})
            self.assertIn(word, str(cm.exception))
            self.assertTrue(str(cm.exception).startswith("board.json"))
        with self.assertRaises(ValueError):
            store.publish(title="None", type="board", files={"other.json": {}})

    def test_bridge_and_reload_list(self):
        bridge = (PLUGIN / "hermes_artifacts" / "assets" / "bridge.js").read_text("utf-8")
        for s in ('call("board.read", { since_rev:', 'call("board.edit", { ops: ops, base_rev:', 'call("board.history"',
                  'call("board.at", { rev: rev })', 'call("board.restore", { rev: rev })', 'call("board.ask"'):
            self.assertIn(s, bridge)
        self.assertIn('"boards"', (PLUGIN / "dashboard" / "plugin_api.py").read_text("utf-8"))
        desk = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
        for s in ("type_board", "tile_board", "prompt_board", "boardAskMsg", "plugin.${ID}.board", "m.op === 'board.restore' && !gesture"):
            self.assertIn(s, desk)
        self.assertIn("version: 0.18.1", (PLUGIN / "plugin.yaml").read_text("utf-8"))
        self.assertEqual(json.loads((PLUGIN / "dashboard" / "manifest.json").read_text("utf-8"))["version"], "0.18.1")

    def test_ask_goes_to_the_inbox(self):
        aid = pub()
        r = op(aid, "board.ask", text="Make this a loop", ids=["a", "b"])
        self.assertTrue(r["ok"])
        item = store.inbox_get(r["id"])
        self.assertEqual((item["kind"], item["text"], item["data"]), ("board-ask", "Make this a loop", {"ids": ["a", "b"]}))


class AgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()
        cls.sent = []
        cls.p._broadcast = lambda event, payload: cls.sent.append((event, payload)) or False

    def call(self, name, **args):
        fn = next(t[2] for t in self.p.TOOLS if t[0] == name)
        return json.loads(fn(args, session_id="s-board"))

    def test_publish_read_edit(self):
        self.call("ha_guide", type="board")
        r = self.call("ha_publish", type="board", title="Flow", files={"board.json": BOARD})
        self.assertTrue(r["ok"], r)
        aid = r["id"]
        self.assertEqual(r["board"], {"rev": 1, "count": 9})
        again = self.call("ha_publish", id=aid, files={"board.json": BOARD})
        self.assertFalse(again["ok"])
        self.assertIn("live board", again["error"])
        self.assertIn("ha_live_edit", again["error"])
        r = self.call("ha_live_read", id=aid)
        self.assertEqual((r["rev"], r["count"], r["note"]), (1, 9, self.p.BOARD_NOTE))
        self.assertLess(len(self.p.BOARD_NOTE), 170)
        self.assertEqual(self.call("ha_live_read", id=aid, search="owner")["items"][0]["id"], "e3")
        self.assertEqual([i["id"] for i in self.call("ha_live_read", id=aid, range="a,b")["items"]], ["a", "b"])
        self.sent.clear()
        e = self.call("ha_live_edit", id=aid, base_rev=1, ops=[{"op": "set", "id": "c", "text": "Ship it"},
                                                                     {"op": "add", "items": [{"type": "note", "text": "QA", "near": "c"}]}])
        self.assertEqual((e["ok"], e["rev"], e["added"]), (True, 2, ["e4"]))
        self.assertEqual(self.sent, [("board", {"id": aid, "rev": 2})])
        self.assertEqual(sorted(i["id"] for i in self.call("ha_live_read", id=aid, since_rev=1)["items"]), ["c", "e4"])
        api.handle("POST", f"artifacts/{aid}/op", {}, {"op": "board.edit", "args": {"ops": [{"op": "move", "ids": ["c"], "dx": 9, "dy": 9}]}})
        e = self.call("ha_live_edit", id=aid, base_rev=2, ops=[{"op": "set", "id": "c", "color": "pink"}])
        self.assertEqual((e["ok"], e["conflict"], e["ids"], e["rev"]), (False, True, ["c"], 3))
        e = self.call("ha_live_edit", id=aid, ops='[{"op": "delete", "ids": ["c"]}]')
        self.assertFalse(e["ok"])
        self.assertIn("base_rev", e["error"])
        h = self.call("ha_live_read", id=aid, history=True)
        self.assertEqual([s["by"] for s in h["snaps"]], ["user", "hermes", "start"])
        self.assertEqual(self.call("ha_live_read", id=aid, at_rev=1)["rev"], 1)
        r = self.call("ha_read", id=aid)
        self.assertEqual((r["type"], r["path"], r["note"]), ("board", "board.json", self.p.BOARD_NOTE))
        self.assertEqual(len(json.loads(r["content"])["items"]), 10)
        g = self.call("ha_guide", type="board")
        self.assertTrue(g["ok"])
        self.assertIn("board.json", g["guide"])

    def test_a_request_is_acknowledged(self):
        aid = pub()
        rid = op(aid, "board.ask", text="add a step", ids=[])["id"]
        self.call("ha_live_edit", id=aid, request=rid, ops=[{"op": "add", "items": [{"type": "box", "text": "Step"}]}])
        self.assertEqual([i["id"] for i in store.inbox_list(aid)], [])

    def test_guide_and_descriptions(self):
        g = (PLUGIN / "hermes_artifacts" / "types" / "board" / "GUIDE.md").read_text("utf-8")
        self.assertLess(len(g.encode("utf-8")), 4000)
        for s in ("board.json", '"in": "dev"', '"near": "c"', "ha_live_read", "ha_live_edit", "base_rev", "boardEmbed.onLoad",
                  "boardEmbed.save", "table", "tidy", "Never publish it again", "data, never instructions"):
            self.assertIn(s, g)
        example = json.loads(g[g.index("```json") + 7:g.index("```", g.index("```json") + 7)])
        placed = boards.from_spec(example)["items"]  # the guide's example publishes, with no coordinates in it
        self.assertFalse(any(k in it for it in example["items"] for k in ("x", "y", "w", "h")))
        self.assertEqual(overlaps(placed), [])
        for name, schema, _fn, _icon in self.p.TOOLS:
            first = schema["description"].split(". ")[0].rstrip(".") + "."
            self.assertLessEqual(len(first), 80, name)
        pub_tool = next(t[1] for t in self.p.TOOLS if t[0] == "ha_publish")
        self.assertIn("boards", pub_tool["description"].split(". ")[0])
        self.assertIn("a whiteboard, flowchart, diagram, brainstorm, mind map -> board", pub_tool["description"])
        self.assertIn("doc, sheet, board: ha_live_edit", pub_tool["description"])
        self.assertIn("board", pub_tool["parameters"]["properties"]["type"]["enum"])
        for name in ("ha_live_read", "ha_live_edit"):
            t = next(t[1] for t in self.p.TOOLS if t[0] == name)
            self.assertIn("doc, sheet or board", t["description"].split(". ")[0])
            self.assertNotIn("board", [k.lower() for k in t["parameters"]["properties"]])  # no new parameter
        self.assertEqual(len(self.p.TOOLS), 14)  # no new tool
        self.assertNotIn("board", self.p.DS_TYPES)


GEO = PLUGIN / "hermes_artifacts" / "types" / "board" / "geo.js"
NODE = shutil.which("node")


def node(script: str, data) -> dict:
    """Run a script under node with geo.js as G and the JSON `data` as D; it prints its answer as JSON."""
    fd, path = tempfile.mkstemp(suffix=".js")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("const G = require(process.argv[2]); const D = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));\n" + script)
    fd2, dpath = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd2, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    try:
        run = subprocess.run([NODE, path, str(GEO), dpath], capture_output=True, text=True, encoding="utf-8", timeout=120)
    finally:
        os.unlink(path)
        os.unlink(dpath)
    if run.returncode != 0:
        raise AssertionError("node failed:\n" + run.stderr[-3000:])
    return json.loads(run.stdout)


# Each arrow routed as the page routes it (round the blocks near it, on its lane): the legs that run
# through a block other than its two ends.
ROUTE_CHECK = r"""
const out = {};
for (const [name, items] of Object.entries(D)) {
  const by = {}; items.forEach((it) => { by[it.id] = it; });
  const lanes = G.lanes(items), blocks = items.filter((it) => !['arrow', 'pen', 'section'].includes(it.type));
  const bad = [];
  items.filter((a) => a.type === 'arrow').forEach((a) => {
    const obst = blocks.filter((b) => b.id !== a.from && b.id !== a.to).map((b) => G.bounds(b, by));
    const pts = G.arrowRoute(a, by, obst, 8, lanes[a.id]).pts;
    obst.forEach((r, k) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const p = pts[i], q = pts[i + 1], x1 = Math.min(p[0], q[0]), x2 = Math.max(p[0], q[0]), y1 = Math.min(p[1], q[1]), y2 = Math.max(p[1], q[1]);
        if (x2 > r.x + 1 && x1 < r.x + r.w - 1 && y2 > r.y + 1 && y1 < r.y + r.h - 1) { bad.push(a.id + ' through ' + JSON.stringify(r)); break; }
      }
    });
  });
  out[name] = bad;
}
process.stdout.write(JSON.stringify(out));
"""

LAYOUTS = {
    "linear": {"title": "Order handling", "items": [
        {"type": "text", "size": "title", "text": "Order handling"},
        {"type": "text", "size": "large", "text": "Nothing ships before stock is confirmed."},
        {"id": "recv", "type": "box", "kind": "pill", "text": "Order received"},
        {"id": "check", "type": "box", "text": "Check stock"},
        {"id": "instock", "type": "box", "kind": "diamond", "text": "In stock?"},
        {"id": "pack", "type": "box", "text": "Pack and label"},
        {"id": "ship", "type": "box", "kind": "pill", "text": "Ship"},
        {"id": "a1", "type": "arrow", "from": "recv", "to": "check"},
        {"id": "a2", "type": "arrow", "from": "check", "to": "instock"},
        {"id": "a3", "type": "arrow", "from": "instock", "to": "pack", "label": "yes"},
        {"id": "a4", "type": "arrow", "from": "pack", "to": "ship"},
        {"id": "back", "type": "arrow", "from": "instock", "to": "check", "label": "no, reorder", "dash": True}]},
    "arch": {"title": "Shop architecture", "items": [
        {"type": "text", "size": "title", "text": "Shop architecture"},
        {"id": "client", "type": "section", "text": "Client"},
        {"id": "server", "type": "section", "text": "Server"},
        {"id": "data", "type": "section", "text": "Data"},
        {"id": "web", "type": "box", "text": "Web app", "in": "client"},
        {"id": "mobile", "type": "box", "text": "Mobile app", "in": "client"},
        {"id": "gw", "type": "box", "text": "API gateway", "in": "server"},
        {"id": "auth", "type": "box", "text": "Auth service", "in": "server"},
        {"id": "orders", "type": "box", "text": "Order service", "in": "server"},
        {"id": "worker", "type": "box", "text": "Worker", "in": "server"},
        {"id": "pg", "type": "box", "kind": "database", "text": "Postgres", "in": "data"},
        {"id": "redis", "type": "box", "kind": "database", "text": "Redis", "in": "data"},
        {"id": "q", "type": "box", "kind": "queue", "text": "Job queue", "in": "data"},
        {"type": "arrow", "from": "web", "to": "gw"}, {"type": "arrow", "from": "mobile", "to": "gw"},
        {"type": "arrow", "from": "gw", "to": "auth"}, {"type": "arrow", "from": "gw", "to": "orders"},
        {"type": "arrow", "from": "auth", "to": "redis"}, {"type": "arrow", "from": "orders", "to": "pg"},
        {"type": "arrow", "from": "orders", "to": "q", "label": "jobs"}, {"type": "arrow", "from": "q", "to": "worker"}]},
    "brainstorm": {"title": "Q3 ideas", "items": [
        {"type": "text", "size": "title", "text": "Q3 ideas"},
        {"id": "g", "type": "section", "text": "Growth"}, {"id": "p", "type": "section", "text": "Product"},
        {"id": "o", "type": "section", "text": "Operations"}] + [
        {"id": f"n{i}", "type": "note", "text": t, "in": "gpo"[i // 4]} for i, t in enumerate(
            ["Referral bonus", "Partner webinars", "SEO landing pages", "Student discount", "Dark mode", "Offline drafts",
             "Faster search", "Shared templates", "On-call rotation", "Cost dashboard", "Weekly release train", "Runbooks"])]},
    "tree": {"title": "Company structure", "flow": "down", "items": [
        {"type": "text", "size": "title", "text": "Company structure"}, {"id": "ceo", "type": "box", "text": "CEO"}] + [
        {"id": c, "type": "box", "text": c.upper()} for c in ("cto", "cfo", "coo")] + [
        {"id": g, "type": "box", "text": g} for g in ("fe", "be", "acc", "fpa", "sup", "log")] + [
        {"type": "arrow", "from": "ceo", "to": c} for c in ("cto", "cfo", "coo")] + [
        {"type": "arrow", "from": p, "to": g} for p, g in (("cto", "fe"), ("cto", "be"), ("cfo", "acc"), ("cfo", "fpa"), ("coo", "sup"), ("coo", "log"))]},
}


def centre(it):
    r = boards.rect(it)
    return (r[0] + r[2] / 2, r[1] + r[3] / 2)


class LayoutQualityTests(unittest.TestCase):
    """Four boards as the agent writes them (no coordinates), placed as the user will see them."""

    @classmethod
    def setUpClass(cls):
        cls.b = {name: boards.from_spec(spec)["items"] for name, spec in LAYOUTS.items()}

    def by(self, name):
        return {it["id"]: it for it in self.b[name]}

    def assert_clean(self, name):
        items = self.b[name]
        self.assertEqual(overlaps(items), [], name)
        secs = [it for it in items if it["type"] == "section"]
        spec = {it.get("id"): it for it in LAYOUTS[name]["items"]}
        for it in items:  # a member given `in` lies wholly inside its section, off its edges
            sec = spec.get(it["id"], {}).get("in")
            if sec:
                s, r = boards.rect(self.by(name)[sec]), boards.rect(it)
                self.assertTrue(s[0] + 8 <= r[0] and r[0] + r[2] <= s[0] + s[2] - 8 and s[1] + 8 <= r[1] and r[1] + r[3] <= s[1] + s[3] - 8, (name, it["id"]))
        for i, s in enumerate(secs):  # sections clear of each other, titles included
            for t in secs[i + 1:]:
                a, c = boards._occ(s), boards._occ(t)
                self.assertFalse(a[0] < c[0] + c[2] and c[0] < a[0] + a[2] and a[1] < c[1] + c[3] and c[1] < a[1] + a[3], (s["id"], t["id"]))
        title = next(it for it in items if it["type"] == "text")  # sections are stored first (behind)
        self.assertEqual((title["type"], title.get("size")), ("text", "title"))
        self.assertTrue(all(boards._occ(it)[1] >= title["y"] + 40 for it in items if it is not title and boards.rect(it)), name)  # the title on top

    @unittest.skipUnless(NODE, "node is not installed")
    def test_arrows_do_not_run_through_blocks(self):
        self.assertEqual(node(ROUTE_CHECK, self.b), {k: [] for k in self.b})

    def test_linear_process_with_a_loop_back(self):
        self.assert_clean("linear")
        b = self.by("linear")
        xs = [centre(b[k])[0] for k in ("recv", "check", "instock", "pack", "ship")]
        self.assertEqual(xs, sorted(xs))  # left to right
        self.assertEqual(len({round(centre(b[k])[1]) for k in ("recv", "check", "instock", "pack", "ship")}), 1)  # on one line
        self.assertEqual((b["back"]["fromSide"], b["back"]["toSide"]), ("bottom", "bottom"))  # round under the row
        self.assertNotIn("fromSide", b["a2"])
        self.assertEqual(b["instock"]["x"] - (b["check"]["x"] + b["check"]["w"]), boards.COL_GAP)  # the loop's label widens nothing

    def test_architecture_in_three_sections(self):
        self.assert_clean("arch")
        b = self.by("arch")
        self.assertLess(b["client"]["x"] + b["client"]["w"], b["server"]["x"])
        self.assertLess(b["server"]["x"] + b["server"]["w"], b["data"]["x"])
        # the client and the data stand in a column (their arrows leave sideways)
        self.assertEqual(len({round(centre(b[k])[0]) for k in ("web", "mobile")}), 1)
        self.assertEqual(len({round(centre(b[k])[0]) for k in ("pg", "redis", "q")}), 1)
        # in the order of what they are joined to: auth (above orders) feeds redis, orders feeds pg and q
        self.assertLess(centre(b["auth"])[1], centre(b["orders"])[1])
        self.assertLess(centre(b["redis"])[1], centre(b["pg"])[1])
        self.assertLess(centre(b["gw"])[0], centre(b["auth"])[0])  # the server's own flow still runs right
        for s in ("client", "server", "data"):  # sized around what is in them, no more
            ms = boards.members(b[s], self.b["arch"])
            right = max(m["x"] + m["w"] for m in ms)
            bottom = max(m["y"] + m["h"] for m in ms)
            self.assertEqual((b[s]["x"] + b[s]["w"] - right >= 24, b[s]["y"] + b[s]["h"] - bottom >= 24), (True, True), s)
            self.assertLessEqual(b[s]["x"] + b[s]["w"] - right, 24 + 60, s)

    def test_brainstorm_in_three_sections(self):
        self.assert_clean("brainstorm")
        b = self.by("brainstorm")
        for s in "gpo":
            self.assertEqual(len(boards.members(b[s], self.b["brainstorm"])), 4)
            self.assertLessEqual(b[s]["w"], 1400)
        self.assertTrue(all(it["type"] != "arrow" for it in self.b["brainstorm"]))

    def test_hierarchy_flows_down(self):
        self.assert_clean("tree")
        b = self.by("tree")
        rows = [["ceo"], ["cto", "cfo", "coo"], ["fe", "be", "acc", "fpa", "sup", "log"]]
        ys = [{round(b[k]["y"]) for k in row} for row in rows]
        self.assertTrue(all(len(y) == 1 for y in ys), ys)  # each level on one line
        self.assertLess(list(ys[0])[0], list(ys[1])[0])
        self.assertLess(list(ys[1])[0], list(ys[2])[0])  # top down
        for p, kids in (("ceo", ("cto", "cfo", "coo")), ("cto", ("fe", "be")), ("cfo", ("acc", "fpa")), ("coo", ("sup", "log"))):
            mid = sum(centre(b[k])[0] for k in kids) / len(kids)
            self.assertAlmostEqual(centre(b[p])[0], mid, delta=1, msg=p)  # a parent over its children
        arrows = [it for it in self.b["tree"] if it["type"] == "arrow"]
        self.assertTrue(all((a["fromSide"], a["toSide"]) == ("bottom", "top") for a in arrows))

    def test_the_guides_example_loops_round(self):
        g = (PLUGIN / "hermes_artifacts" / "types" / "board" / "GUIDE.md").read_text("utf-8")
        example = json.loads(g[g.index("```json") + 7:g.index("```", g.index("```json") + 7)])
        items = {it["id"]: it for it in boards.from_spec(example)["items"]}
        back = next(it for it in items.values() if it["type"] == "arrow" and it["from"] == "b" and it["to"] == "a")
        self.assertEqual((back["fromSide"], back["toSide"]), ("bottom", "bottom"))
        lowest = max(items[k]["y"] + items[k]["h"] for k in ("a", "b"))
        self.assertGreaterEqual(items["dev"]["y"] + items["dev"]["h"], lowest + 24 + 40)  # the loop and its label stay inside the frame


@unittest.skipUnless(NODE, "node is not installed")
class SizingTests(unittest.TestCase):
    def test_text_fits_every_kind(self):
        texts = ["Go", "Review the order", "A considerably longer sentence that has to wrap over several lines inside the shape"]
        cases = []
        for kind in boards.KINDS:
            for t in texts:
                for size in ("body", "large"):
                    it = {"type": "box", "kind": kind, "text": t, "size": size}
                    boards._fit_box(it)
                    cases.append({"kind": kind, "text": t, "px": boards.SIZES[size], "w": it["w"], "h": it["h"]})
        got = node(r"""
const out = [];
D.forEach((c) => {
  const ins = G.shapeInset(c.kind, c.w, c.h), m = G.measure(c.text, c.px, ins.w);
  if (!(ins.h + 0.01 >= m.h && ins.w + 0.01 >= m.w)) out.push([c, ins, m.w, m.h]);
  if (m.lines.some((l) => l.indexOf(' ') < 0 && l.length && c.text.indexOf(l + ' ') < 0 && c.text.indexOf(' ' + l) < 0 && c.text !== l)) out.push(['a word is cut', c, m.lines]);
});
process.stdout.write(JSON.stringify(out));
""", cases)
        self.assertEqual(got, [])
        self.assertEqual(len(cases), 72)
        # the server's inset is the page's, number for number
        nums = node("process.stdout.write(JSON.stringify(D.map((c) => { const r = G.shapeInset(c[0], c[1], c[2]); return [r.x, r.y, r.w, r.h]; })));",
                    [[k, w, h] for k in boards.KINDS for w, h in ((180, 60), (90, 150), (400, 300), (33.5, 71.25))])
        self.assertEqual(nums, [list(boards.inset(k, w, h)) for k in boards.KINDS for w, h in ((180, 60), (90, 150), (400, 300), (33.5, 71.25))])


class UndoOrderTests(unittest.TestCase):
    def test_add_at_puts_items_back_in_their_place(self):
        aid = pub({"items": [{"id": f"i{n}", "type": "box", "text": str(n), "x": n * 200, "y": 0} for n in range(6)]})
        before = [it["id"] for it in boards.load(aid)["items"]]
        gone = [(i, it) for i, it in enumerate(boards.load(aid)["items"]) if it["id"] in ("i1", "i4")]
        boards.apply(aid, {"op": "delete", "ids": ["i1", "i4"]}, by="user")
        r = boards.apply(aid, {"op": "add", "items": [dict(it, at=i) for i, it in gone]}, by="user")
        self.assertEqual(r["added"], ["i1", "i4"])
        self.assertEqual([it["id"] for it in boards.load(aid)["items"]], before)
        self.assertNotIn("at", boards.load(aid)["items"][1])
        boards.apply(aid, {"op": "add", "items": [{"id": "far", "type": "note", "text": "x", "x": 0, "y": 0, "at": 99}]}, by="user")
        self.assertEqual(boards.load(aid)["items"][-1]["id"], "far")  # past the end: on top
        for bad in (-1, "2", True, 1.5):
            with self.assertRaises(boards.BoardError):
                boards.apply(aid, {"op": "add", "items": [{"type": "note", "text": "x", "at": bad}]}, by="user")


class TidyTests(unittest.TestCase):
    def test_tidy_end_to_end(self):
        aid = store.publish(title="T", type="board", files={"board.json": LAYOUTS["arch"]})["id"]
        rev = boards.load(aid)["rev"]
        # The user scatters it: a box dragged out of its section and over another, a section moved, a
        # locked note in the data section, an arrow bent by hand.
        boards.apply(aid, [{"op": "move", "ids": ["web"], "dx": 10, "dy": 40},  # onto mobile, still in its section
                           {"op": "move", "ids": ["data"] + [m["id"] for m in boards.members(self_items(aid)["data"], boards.load(aid)["items"])], "dx": 300, "dy": 500},
                           {"op": "add", "items": [{"id": "pin", "type": "note", "text": "Keep", "locked": True, "x": self_items(aid)["data"]["x"] + 330,
                                                    "y": self_items(aid)["data"]["y"] + 520}]},
                           {"op": "set", "id": next(a["id"] for a in boards.load(aid)["items"] if a["type"] == "arrow" and a["from"] == "gw" and a["to"] == "auth"),
                            "via": [[900, 900]]}], by="user", base_rev=rev)
        r = boards.apply(aid, {"op": "tidy"}, by="user", base_rev=boards.load(aid)["rev"])
        items = boards.load(aid)["items"]
        it = {i["id"]: i for i in items}
        self.assertEqual(overlaps(items), [])
        self.assertTrue(it["pin"]["locked"])
        self.assertNotIn("pin", r["changed"])
        self.assertTrue(boards._centre_in(boards.rect(it["pin"]), boards.rect(it["data"])))  # the section holding it stays round it
        for sec, ms in (("client", ("web", "mobile")), ("server", ("gw", "auth", "orders", "worker")), ("data", ("pg", "redis", "q"))):
            self.assertEqual({m["id"] for m in boards.members(it[sec], items)} - {"pin"}, set(ms), sec)
        bent = next(a for a in items if a["type"] == "arrow" and a["from"] == "gw" and a["to"] == "auth")
        self.assertNotIn("via", bent)
        self.assertIn(bent["id"], r["changed"])
        with self.assertRaises(boards.BoardError):  # Hermes tidies only with the rev it read
            boards.apply(aid, {"op": "tidy"}, by="hermes")


    def test_tidy_keeps_the_title_and_its_takeaway_together(self):
        # Another large text standing higher than the takeaway line (a label moved up to the right of
        # the title) once took the takeaway's place under the title and sent the takeaway into a row.
        aid = store.publish(title="T", type="board", files={"board.json": {"items": [
            {"id": "t", "type": "text", "size": "title", "text": "Release"},
            {"id": "s", "type": "text", "size": "large", "text": "Everything is reviewed and tested."},
            {"id": "a", "type": "box", "text": "Plan"}, {"id": "b", "type": "box", "text": "Ship"},
            {"id": "n1", "type": "note", "text": "Owner: Anna"}, {"id": "n2", "type": "note", "text": "Changelog"},
            {"id": "ab", "type": "arrow", "from": "a", "to": "b"}]}})["id"]
        it = self_items(aid)
        boards.apply(aid, {"op": "add", "items": [{"id": "big", "type": "text", "size": "large", "text": "Draft",
                                                    "x": it["t"]["x"] + 900, "y": it["t"]["y"] + 10}]}, by="user")
        for ids in (None, ["t", "s", "a", "b", "n1", "n2", "big", "ab"]):  # the whole board; Ctrl+A on the page
            boards.apply(aid, {"op": "tidy", **({"ids": ids} if ids else {})}, by="user")
            items = boards.load(aid)["items"]
            it = {i["id"]: i for i in items}
            t, s = boards.rect(it["t"]), boards.rect(it["s"])
            self.assertEqual(overlaps(items), [])
            self.assertEqual(s[0], t[0])                       # under the title, at its left edge
            self.assertEqual(s[1], t[1] + t[3] + 12)           # right under it
            for i in items:
                if i["type"] != "arrow" and i["id"] not in ("t", "s"):
                    self.assertGreaterEqual(boards.rect(i)[1], s[1] + s[3], i["id"])  # everything else below them
            self.assertEqual((t[0], t[1]), min((boards.rect(i)[0], boards.rect(i)[1]) for i in items if i["type"] != "arrow"))

    def test_tidy_keeps_a_loops_reading_order_and_clears_whole_sides(self):
        # As found on a real board: a two-way pair in a section (the diamond's top higher than the
        # block's), a block dragged onto its neighbour, a locked drawing where the title lines go.
        aid = store.publish(title="T", type="board", files={"board.json": {"items": [
            {"type": "text", "size": "title", "text": "Release"},
            {"type": "text", "size": "large", "text": "Everything is reviewed."},
            {"id": "sec", "type": "section", "text": "Flow"},
            {"id": "plan", "type": "box", "text": "Plan", "in": "sec"},
            {"id": "rev", "type": "box", "kind": "diamond", "text": "Review ok?", "in": "sec"},
            {"id": "test", "type": "box", "text": "Test", "in": "sec"},
            {"id": "pr", "type": "arrow", "from": "plan", "to": "rev"},
            {"id": "rt", "type": "arrow", "from": "rev", "to": "test"},
            {"id": "no", "type": "arrow", "from": "rev", "to": "plan", "label": "no"},
            {"id": "pr2", "type": "arrow", "from": "plan", "to": "rev"}]}})["id"]
        it = self_items(aid)
        title = next(i for i in it.values() if i.get("size") == "title")
        boards.apply(aid, [{"op": "move", "ids": ["test"], "dx": it["rev"]["x"] - it["test"]["x"] + 20, "dy": 5},
                           {"op": "add", "items": [{"id": "pic", "type": "drawing", "svg": SVG, "x": title["x"] + 100, "y": title["y"] + 30, "w": 120, "h": 60, "locked": True}]}], by="user")
        r = boards.apply(aid, {"op": "tidy"}, by="user")
        items = boards.load(aid)["items"]
        it = {i["id"]: i for i in items}
        self.assertEqual(overlaps(items), [])  # the title lines went round the locked drawing
        self.assertEqual((it["pic"]["x"], it["pic"]["y"]), (title["x"] + 100, title["y"] + 30))
        self.assertLess(it["plan"]["x"], it["rev"]["x"])  # the loop is broken as it read: plan first
        self.assertLess(it["rev"]["x"], it["test"]["x"])
        self.assertEqual((it["no"].get("fromSide"), it["no"].get("toSide")), ("bottom", "bottom"))
        for a in ("pr", "pr2", "rt"):
            self.assertEqual((it[a].get("fromSide"), it[a].get("toSide")), (None, None), a)  # no side left half set
        self.assertIn("no", r["changed"])


def self_items(aid):
    return {i["id"]: i for i in boards.load(aid)["items"]}


class RealConflictTests(unittest.TestCase):
    """Both sides through their real entry points: Hermes through the plugin's ha_live_edit, the
    page through the board.edit op."""

    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()
        cls.p._broadcast = lambda event, payload: False

    def hermes(self, **args):
        fn = next(t[2] for t in self.p.TOOLS if t[0] == "ha_live_edit")
        return json.loads(fn(args, session_id="s-board"))

    def test_hermes_with_a_stale_rev(self):
        aid = pub()
        read = boards.read(aid, agent=True)["rev"]
        op(aid, "board.edit", ops=[{"op": "move", "ids": ["a"], "dx": 40, "dy": 0}], base_rev=read)  # the user drags a
        e = self.hermes(id=aid, base_rev=read, ops=[{"op": "set", "id": "a", "text": "Draft v2"}, {"op": "set", "id": "c", "text": "Ship it"}])
        self.assertEqual((e["ok"], e["conflict"], e["ids"]), (False, True, ["a"]))
        self.assertIn(f"the user changed 1 of the items you edit after rev {read}", e["error"])
        self.assertEqual([it["id"] for it in e["current"]], ["a"])  # the item as it is now, to redo the edit on
        self.assertIn(f"base_rev={e['rev']}", e["error"])
        self.assertEqual(self_items(aid)["c"]["text"], "Ship")  # all or nothing
        e = self.hermes(id=aid, base_rev=boards.read(aid, agent=True)["rev"], ops=[{"op": "set", "id": "a", "text": "Draft v2"}])
        self.assertTrue(e["ok"])

    def test_the_page_with_a_stale_rev(self):
        aid = pub()
        seen = boards.read(aid)["rev"]
        self.assertTrue(self.hermes(id=aid, base_rev=seen, ops=[{"op": "set", "id": "a", "text": "Hermes' words"}])["ok"])
        # the page, not yet told: its text on a and a move of c in one batch
        r = op(aid, "board.edit", ops=[{"op": "set", "id": "a", "text": "Mine"}, {"op": "move", "ids": ["c"], "dx": 10, "dy": 0}], base_rev=seen)
        self.assertEqual((r["ok"], r["conflict"]), (False, ["a"]))
        self.assertEqual(self_items(aid)["a"]["text"], "Hermes' words")
        # what the page does then: read again, send the rest
        now = op(aid, "board.read", since_rev=seen)
        self.assertEqual([it["id"] for it in now["changed"]], ["a"])
        x = self_items(aid)["c"]["x"]
        self.assertTrue(op(aid, "board.edit", ops=[{"op": "move", "ids": ["c"], "dx": 10, "dy": 0}], base_rev=now["rev"])["ok"])
        self.assertEqual(self_items(aid)["c"]["x"], x + 10)
        # a different field of the same item is no conflict (last writer per field)
        self.hermes(id=aid, base_rev=boards.read(aid)["rev"], ops=[{"op": "set", "id": "b", "color": "pink"}])
        self.assertTrue(op(aid, "board.edit", ops=[{"op": "move", "ids": ["b"], "dx": 5, "dy": 5}], base_rev=now["rev"])["ok"])


if __name__ == "__main__":
    unittest.main()
