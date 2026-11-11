"""What Hermes reads is English; what the user reads follows the app's language.

The UI tables have an `en` and a `hu` side. Every message that goes to Hermes (into its chat or its
inbox) is only on the `en` side, so a page in another language still sends English to Hermes."""

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))

# Keys whose text is a message to Hermes, per file.
AGENT = {
    "desktop/plugin.js": ["prompt_page", "prompt_dashboard", "prompt_slides", "prompt_doc", "prompt_design", "prompt_motion", "prompt_design-system", "commentMsg", "askMsg", "sendMsg", "docAskMsg", "docEditMsg", "prompt_sheet", "prompt_model", "sheetAskMsg", "sheetCommentMsg", "prompt_board", "boardAskMsg", "boardCommentMsg"],
    "hermes_artifacts/types/dashboard/dashboard.js": ["aboutSel", "editAskMsg", "fixMsg", "lookMsg", "whyMsg"],
    "hermes_artifacts/types/design/design.js": ["about", "fixMsg"],
    "hermes_artifacts/types/design-system/ds-page.js": ["ask"],
    "hermes_artifacts/types/model/model.js": ["about"],
    "hermes_artifacts/types/motion/motion.js": ["contMsg", "finMsg"],
    "hermes_artifacts/types/slides/slides.js": ["about"],
}


def blocks(src: str, side: str) -> list[str]:
    """The `<side>: { ... }` object literals of a file (brace matched, strings aware)."""
    out = []
    for m in re.finditer(r"(?m)^\s*" + side + r": \{", src):
        i, depth, q = m.end() - 1, 0, None
        k = i
        while k < len(src):
            c = src[k]
            if q:
                if c == "\\":
                    k += 2
                    continue
                if c == q:
                    q = None
            elif c in "'\"`":
                q = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        out.append(src[i:k + 1])
    return out


def top_keys(block: str) -> set[str]:
    keys, depth, q, k = set(), 0, None, 0
    while k < len(block):
        c = block[k]
        if q:
            if c == "\\":
                k += 2
                continue
            if c == q:
                q = None
        elif c in "'\"`":
            q = c
        elif c in "{([":
            depth += 1
            if depth == 1:
                m = re.match(r"\s*['\"]?([A-Za-z_$][\w$-]*)['\"]?\s*:", block[k + 1:])
                if m:
                    keys.add(m.group(1))
        elif c in "})]":
            depth -= 1
        elif c == "," and depth == 1:
            m = re.match(r"\s*['\"]?([A-Za-z_$][\w$-]*)['\"]?\s*:", block[k + 1:])
            if m:
                keys.add(m.group(1))
        k += 1
    return keys


class LanguageTests(unittest.TestCase):
    def test_messages_to_hermes_are_only_english(self):
        for rel, agent in AGENT.items():
            src = (PLUGIN / rel).read_text(encoding="utf-8")
            en = set().union(*[top_keys(b) for b in blocks(src, "en")])
            for key in agent:
                self.assertIn(key, en, f"{rel}: {key} missing on the en side")
            for b in blocks(src, "hu"):
                self.assertFalse(set(agent) & top_keys(b), f"{rel}: a message to Hermes on the hu side")

    def test_pages_take_the_apps_language(self):
        from hermes_artifacts import render
        src = (PLUGIN / "hermes_artifacts" / "render.py").read_text(encoding="utf-8")
        self.assertIn('"lang": lang if', src)
        for rel in AGENT:
            if rel.startswith("hermes_artifacts/"):
                self.assertIn("pickLang(", (PLUGIN / rel).read_text(encoding="utf-8"), rel)
        self.assertTrue(render)

    def test_what_hermes_reads_is_english(self):
        for p in list((PLUGIN / "hermes_artifacts" / "types").glob("*/GUIDE.md")) + list((PLUGIN / "hermes_artifacts" / "types").glob("*/guides/*.md")) + [PLUGIN / "__init__.py"]:
            text = p.read_text(encoding="utf-8")
            self.assertFalse(re.search(r"[őűŐŰ]", text), p)


if __name__ == "__main__":
    unittest.main()
