"""The dashboard's History, its saves, drafts and looks (Claude's Dashboard type, the Hermes way)."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, history, store  # noqa: E402

NODE = shutil.which("node")
SPEC = {"title": "Orders", "params": {"region": ""},
        "datasets": {"monthly": {"title": "Orders per month", "source": {"kind": "file", "path": "data/m.csv"}}}}


def op(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(title="H", type="dashboard", files={"dashboard.json": SPEC, "index.html": "<h1>A</h1>\n<p>one</p>",
                                                                     "data/m.csv": "m,n\n1,2\n"})["id"]

    def test_who_and_what_changed(self):
        s2 = json.loads(json.dumps(SPEC))
        s2["datasets"]["regions"] = {"title": "By region", "source": {"kind": "rows", "rows": []}}
        s2["params"] = {"region": "South"}
        store.publish(aid=self.aid, base=True, files={"dashboard.json": s2}, by="hermes")
        store.publish(aid=self.aid, base=True, files={"index.html": "<h1>A</h1>\n<p>two</p>"}, by="user")
        vs = history.versions(self.aid)
        self.assertEqual([v["n"] for v in vs], [3, 2, 1])
        self.assertEqual(vs[0]["by"], "user")
        self.assertEqual(vs[0]["summary"], {"what": "edited", "things": [{"t": "page"}]})
        self.assertEqual(vs[1]["summary"]["things"], [{"t": "source", "name": "By region", "kind": "added"}, {"t": "filters"}])
        self.assertEqual(vs[2]["summary"], {"what": "created"})
        d = history.diff(self.aid, 3)
        self.assertEqual(d["changes"][0]["name"], "index.html")
        self.assertIn("-<p>one</p>", d["changes"][0]["lines"])
        self.assertIn("+<p>two</p>", d["changes"][0]["lines"])

    def test_restore_is_a_new_version(self):
        store.publish(aid=self.aid, base=True, files={"index.html": "<p>gone</p>"})
        r = op(self.aid, "history.restore", version=1)
        self.assertEqual((r["version"], r["restored"]), (3, 1))
        self.assertIn("one", store.read_file(self.aid, "index.html").decode())
        self.assertEqual(history.versions(self.aid)[0]["summary"], {"what": "restored", "restored": 1})

    def test_drafts_are_named(self):
        store.publish(aid=self.aid, base=True, files={"drafts/d1/request.json": {"format": "scrollyteller"}}, by="user")
        self.assertEqual(history.versions(self.aid)[0]["summary"]["things"], [{"t": "draft", "kind": "added"}])


class SaveTests(unittest.TestCase):
    def setUp(self):
        self.aid = store.publish(title="S", type="dashboard", files={"dashboard.json": SPEC, "index.html": "<p>x</p>", "data/m.csv": "m\n1\n"})["id"]

    def test_what_a_dashboard_page_may_save(self):
        for files in ({"dashboard.json": json.dumps(SPEC)}, {"index.html": "<p>y</p>"}, {"data/m.csv": "m\n2\n", "data/m2.json": "[]"},
                      {"drafts/d1/index.html": "<p>d</p>", "drafts/d1/request.json": "{}"}):
            self.assertTrue(op(self.aid, "save", files=files)["ok"], files)
        for files in ({"data/../x.csv": "a"}, {"drafts/d1/x/y.html": "a"}, {"run.py": "a"}, {"data/x.exe": "a"}):
            with self.assertRaises(api.ApiError, msg=files):
                op(self.aid, "save", files=files)


DESIGN = r"""
const fs = require('fs');
const hex = (c) => { const m = /^#([0-9a-f]{6})$/i.exec(c.trim()); if (!m) return ''; const v = parseInt(m[1], 16); return 'rgb(' + (v >> 16) + ', ' + ((v >> 8) & 255) + ', ' + (v & 255) + ')'; };
const el = () => ({ style: {}, setAttribute() {}, appendChild() {} });
global.document = { createElement: () => { const e = el(); const s = {}; Object.defineProperty(e.style, 'color', { get: () => s.c || '', set: (v) => { s.c = hex(v) ? v : ''; } }); return e; },
  documentElement: { appendChild() {}, style: { setProperty() {} }, getAttribute: () => null, setAttribute() {} }, head: { appendChild() {} } };
global.getComputedStyle = (e) => ({ color: hex(e.style.color) });
global.window = { kit: { hostTheme() {} } };
eval(fs.readFileSync(process.argv[1], 'utf8'));
const K = window.dashDesignKit;
const files = {
  'index.html': '<p>old</p>', 'extra.js': 'x', 'dashboard.json': '{}',
  'drafts/a1/request.json': JSON.stringify({ format: 'scrollyteller', at: '2026-11-06T10:00:00Z' }),
  'drafts/a1/index.html': '<p>draft</p>', 'drafts/a1/story.css': 'p{}',
  'drafts/a1/datasets.json': JSON.stringify({ extra: { title: 'Extra', source: { kind: 'rows', rows: [] } } }),
  'drafts/b2/request.json': JSON.stringify({ format: 'nonsense' })
};
const d = K.draftOf(files);
const saved = K.saveDraftFiles(files, { title: 'T', layout: [1], datasets: { m: {} } }, d);
const clay = K.check(K.LOOKS.Clay), bad = K.check({ light: { ground: '#333333', text: '#000000' } });
const fixed = K.check({ light: { ground: '#dddddd', card: '#111111', text: '#dddddd', charts: ['#dddddd', '#d97757'] } });
console.log(JSON.stringify({ d, saved, clay: clay && { light: clay.light.ground, dark: clay.dark.ground, chart: clay.light.charts[0] }, bad, fixed: fixed && fixed.light }));
"""


@unittest.skipIf(NODE is None, "node not installed")
class DesignKitTests(unittest.TestCase):
    def test_drafts_and_looks(self):
        r = subprocess.run([NODE, "-e", DESIGN, str(PLUGIN / "hermes_artifacts" / "types" / "dashboard" / "design.js")],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(out["d"], {"id": "a1", "format": "scrollyteller", "at": "2026-11-06T10:00:00Z", "page": "drafts/a1/index.html"})
        s = out["saved"]
        self.assertEqual((s["index.html"], s["story.css"], s["extra.js"]), ("<p>draft</p>", "p{}", None))
        self.assertTrue(all(s[k] is None for k in ("drafts/a1/request.json", "drafts/a1/index.html", "drafts/a1/datasets.json")))
        spec = json.loads(s["dashboard.json"])
        self.assertEqual(sorted(spec["datasets"]), ["extra", "m"])
        self.assertNotIn("layout", spec)
        self.assertEqual(out["clay"], {"light": "#f6f1e9", "dark": "#14110d", "chart": "#d97757"})
        self.assertIsNone(out["bad"])  # a light ground far too dark drops the set
        f = out["fixed"]
        self.assertGreater(int(f["ground"][1:3], 16), 0xdd)  # moved toward white until it fits
        self.assertEqual(f["card"], f["ground"])  # a card darker than #ccc is the ground
        self.assertEqual(f["text"], "#000000")  # text without 4.5:1 becomes black
        self.assertEqual(f["charts"][0], None)  # a chart color without 1.5:1 is left to the dashboard
        self.assertEqual(f["charts"][1], "#d97757")


if __name__ == "__main__":
    unittest.main()
