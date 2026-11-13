"""What a person sees and what the Hermes agent reads is Hermes' own: no Claude/Anthropic name and no
Claude accent or warm-paper ground in descriptions, guides, tool texts, UI strings, default palettes or
export styles. Code comments are not checked (no one sees them)."""

import ast
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from test_types import load_plugin  # noqa: E402

NAME = re.compile(r"claude|anthropic", re.I)
# Claude's accent family and its cream/warm-paper grounds and inks (as #rrggbb, or bare in Office XML).
HUES = re.compile(r"(?<![0-9a-f])(d97757|c96442|cc785c|da7756|e08363|f6f1e9|f4f1ea|faf9f5|faf9f7|f1efe8|f4f2ee|1f1e1d|f0efec)(?![0-9a-f])", re.I)
# Kept on purpose: interoperability with files made in Claude (a design system exported from it publishes as is).
ALLOWED = {("hermes_artifacts/types/design-system/GUIDE.md", "A system exported from Claude"),
           ("hermes_artifacts/dsbuild.py", "one brought over from Claude")}


def _files(exts):
    for p in sorted(PLUGIN.rglob("*")):
        if p.suffix in exts and p.is_file() and not p.name.endswith(".bundle.js") and "vendor" not in p.parts:
            yield p


def _code(js):
    """A JS/CSS file without its comments (strings and code are what reach a person)."""
    js = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
    return re.sub(r"(^|[\s;{}(,])//[^\n]*", r"\1", js)


def _rel(p):
    return p.relative_to(PLUGIN).as_posix()


class BrandingTests(unittest.TestCase):
    def _no_name(self, rel, text):
        for line in text.splitlines():
            if NAME.search(line) and not any(rel == f and k in line for f, k in ALLOWED):
                self.fail(f"{rel}: {line.strip()[:160]}")

    def test_descriptions_guides_and_readme(self):
        for p in [PLUGIN / "plugin.yaml", PLUGIN / "dashboard" / "manifest.json", *_files({".md"})]:
            self._no_name(_rel(p), p.read_text("utf-8"))
        self._no_name("README.md", (ROOT / "README.md").read_text("utf-8"))

    def test_ui_strings_and_page_code(self):
        for p in _files({".js", ".css", ".html"}):
            self._no_name(_rel(p), _code(p.read_text("utf-8")))

    def test_python_strings_tools_and_help(self):
        # Every string but a function's or class's docstring: tool descriptions, refusals, CLI help, logs.
        for p in _files({".py"}):
            tree = ast.parse(p.read_text("utf-8"))
            docs = {id(n.body[0].value) for n in ast.walk(tree)
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.body
                    and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)}
            for n in ast.walk(tree):
                if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docs:
                    self._no_name(_rel(p), n.value)
        tools = load_plugin().TOOLS
        self._no_name("TOOLS", json.dumps([t[1] for t in tools]))

    def test_no_claude_hues(self):
        for p in _files({".js", ".css", ".html", ".md", ".py", ".json", ".yaml"}):
            for i, line in enumerate(p.read_text("utf-8").splitlines(), 1):
                m = HUES.search(line)
                self.assertIsNone(m, f"{_rel(p)}:{i}: {m and m.group(0)}")


if __name__ == "__main__":
    unittest.main()
