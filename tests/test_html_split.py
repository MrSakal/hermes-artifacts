"""GET artifacts/<id>/html?split=1: a typed artifact's document as its type's shell (by hash, fetched once
from GET shells/<hash>) plus its own content; head + content + tail is byte for byte the document the plain
route answers. Without split (an older Desktop), nothing changes."""

import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
EX = ROOT / "examples"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, store  # noqa: E402


def get(path, **q):
    return api.handle("GET", path, {k: str(v) for k, v in q.items()}, None)


class SplitTests(unittest.TestCase):
    def kinds(self):
        out = {
            "doc": store.publish(type="doc", title="d", files={"doc.md": "# D\n\nx"})["id"],
            "sheet": store.publish(type="sheet", title="s", files={"sheet.json": {"sheets": [{"name": "A", "rows": [[1, "=A1*2"]]}]}})["id"],
            "board": store.publish(type="board", title="b", files={"board.json": {"items": [{"id": "a", "type": "box", "text": "x"}]}})["id"],
            "model": store.publish(type="model", title="m", files={"model.json": {"title": "P", "units": "mm", "parts": [
                {"id": "p", "name": "P", "kind": "box", "size": [10, 10, 10]}]}})["id"],
        }
        for kind in ("dashboard", "slides", "design", "motion", "design-system"):
            out[kind] = store.publish(type=kind, title=kind, path=str(EX / kind))["id"]
        return out

    def test_shell_and_content_make_the_same_document(self):
        hashes = {}
        for kind, aid in self.kinds().items():
            for q in ({}, {"thumb": 1}, {"lang": "hu"}, {"v": 1}):
                with self.subTest(kind=kind, q=q):
                    whole = get(f"artifacts/{aid}/html", **q)["html"]
                    part = get(f"artifacts/{aid}/html", split=1, **q)
                    self.assertNotIn("html", part)
                    shell = get(f"shells/{part['shell']}")
                    same = lambda s: re.sub(r'"hermes_(ago|left)": [0-9.]+', "", s)  # seconds since Hermes' last change: time moves on
                    self.assertEqual(same(shell["head"] + part["content"] + shell["tail"]), same(whole))
                    self.assertLess(len(part["content"]), len(whole) // 3)
                    hashes.setdefault(kind, set()).add(part["shell"])
        for kind, hs in hashes.items():
            self.assertEqual(len(hs), 1, kind)  # one shell per type, whatever the artifact
        self.assertEqual(len(set().union(*hashes.values())), len(hashes))

    def test_a_page_and_an_unknown_shell(self):
        aid = store.publish(html="<!doctype html><html><head></head><body>p</body></html>", title="p")["id"]
        self.assertEqual(get(f"artifacts/{aid}/html", split=1)["html"], get(f"artifacts/{aid}/html")["html"])
        with self.assertRaises(api.ApiError) as cm:
            get("shells/0123456789abcdef0123456789abcdef")
        self.assertEqual(cm.exception.status, 404)

    def test_without_split_the_answer_is_as_before(self):
        aid = store.publish(type="doc", title="d", files={"doc.md": "# D\n\nx"})["id"]
        r = get(f"artifacts/{aid}/html")
        self.assertEqual(set(r), {"id", "version", "type", "html"})
        self.assertIn('id="hermes-artifact-content"', r["html"])
        json.dumps(r)


if __name__ == "__main__":
    unittest.main()
