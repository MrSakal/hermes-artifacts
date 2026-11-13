"""A dashboard's CSV download (toCsv in types/dashboard/dashboard.js) is RFC 4180: a cell with a comma, a quote or
a line break is quoted (its quotes doubled), lines end with CRLF, and the dashboard's own reader
(parseDelimited) reads it back cell for cell. Both functions run under node, cut out of the page."""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DASH = ROOT / "plugin" / "hermes_artifacts" / "types" / "dashboard" / "dashboard.js"
NODE = shutil.which("node")


def cut(src: str, name: str) -> str:
    """The source of `function name(...) {...}` (braces matched; these two hold no braces in strings)."""
    i = src.index("function " + name + "(")
    k = src.index("{", i)
    depth = 0
    for j in range(k, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i:j + 1]
    raise ValueError(name)


ROWS = [
    {"name": "plain", "note": "a, b", "n": 1},
    {"name": 'say "hi"', "note": "line one\nline two", "n": 2.5},
    {"name": "crlf\r\ninside", "note": '"', "n": None},
    {"name": " spaced ", "note": ",", "n": -3},
    {"name": "trailing quote\"", "note": "\"lead", "n": 0},
    {"name": "Ünïcödé · ő", "note": "tab\there", "n": 10},
]


@unittest.skipUnless(NODE, "node is not installed")
class DashboardCsv(unittest.TestCase):
    def test_round_trip_and_quoting(self):
        src = DASH.read_text(encoding="utf-8").replace("\r\n", "\n")
        script = cut(src, "toCsv") + "\n" + cut(src, "parseDelimited") + """
const r = { columns: ["name", "note", "n"], rows: %s };
const text = toCsv(r);
const back = parseDelimited("\\ufeff" + text, ",");
process.stdout.write(JSON.stringify({ text, back }));
""" % json.dumps(ROWS)
        out = subprocess.run([NODE, "-e", script], capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        got = json.loads(out.stdout)
        text, back = got["text"], got["back"]
        lines = text.split("\r\n")
        self.assertEqual(lines[0], "name,note,n")
        self.assertEqual(lines[1], 'plain,"a, b",1')
        self.assertIn('"say ""hi"""', text)
        self.assertEqual(back["columns"], ["name", "note", "n"])
        want = [{k: ("" if v is None else str(v)) for k, v in r.items()} for r in ROWS]
        self.assertEqual(back["rows"], want)


if __name__ == "__main__":
    unittest.main()
