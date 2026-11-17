"""The type pages' chrome wears Hermes Desktop's own look: its icons (the codicons it draws its UI with, 16 units,
filled), shipped once in the kit with their licence notice, never a page's own stroke icons; its radii from the
kit's tokens. The owner saw our 24-unit stroke icons and pill-round palettes next to Hermes' own buttons."""

import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TYPES = ROOT / "plugin" / "hermes_artifacts" / "types"
KIT = (TYPES / "_kit" / "kit.js").read_text(encoding="utf-8")
SPRITE = Path(os.environ.get("LOCALAPPDATA", "")) / "hermes/hermes-agent/apps/desktop/node_modules/@vscode/codicons/dist/codicon.svg"


def pages():
    for p in sorted(TYPES.rglob("*.js")):
        if "vendor" not in p.parts and p.parent.name != "_kit":
            yield p, p.read_text(encoding="utf-8")


def tables():
    """The kit's CODICON, DRAWN and ICONS tables, as node reads them."""
    a, b = KIT.index("  var CODICON = {"), KIT.index("  var TURN = ")
    js = KIT[a:b] + "\nprocess.stdout.write(JSON.stringify({ CODICON, DRAWN, ICONS }));"
    return json.loads(subprocess.run(["node", "-"], input=js, capture_output=True, text=True, check=True, encoding="utf-8").stdout)


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class HermesIcons(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.t = tables()

    def test_every_name_is_a_codicon_or_one_drawn_in_its_style(self):
        for name, v in self.t["ICONS"].items():
            glyph, *turn = v.split(" ")
            table = self.t["DRAWN"] if glyph.startswith("*") else self.t["CODICON"]
            self.assertIn(glyph.lstrip("*"), table, name)
            self.assertTrue(not turn or turn[0] == "flip" or re.fullmatch(r"r-?\d+", turn[0]), name)
        used = {v.split(" ")[0] for v in self.t["ICONS"].values()}
        for k in self.t["CODICON"]:
            self.assertIn(k, used, f"codicon {k} shipped and never named")
        for k in self.t["DRAWN"]:
            self.assertIn("*" + k, used, f"drawn {k} shipped and never named")

    @unittest.skipUnless(SPRITE.is_file(), "Hermes Desktop's codicons are not installed here")
    def test_the_codicons_are_hermes_own_unchanged(self):
        svg = SPRITE.read_text(encoding="utf-8")
        for name, d in self.t["CODICON"].items():
            part = svg.split(f'id="{name}"', 1)[1]
            inner = part[part.index(">") + 1:part.index("</symbol>")]
            paths = re.findall(r'<path d="([^"]+)"/>', inner)
            want = "".join(paths) if paths and not re.sub(r'<path d="[^"]+"/>', "", inner) else inner
            self.assertIn(want, d, name)

    def test_their_licence_notice_is_beside_them(self):
        head = KIT[:KIT.index("  var CODICON = {")]
        self.assertIn("@vscode/codicons 0.0.45, (c) Microsoft Corporation, licensed under CC BY 4.0", head)
        self.assertIn("https://creativecommons.org/licenses/by/4.0/", head)

    def test_no_page_draws_or_adds_icons_of_its_own(self):
        stroke = re.compile(r'<svg[^>]*viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width')
        for p, s in pages():
            self.assertNotIn("addIcons", s, p.name)
            self.assertIsNone(stroke.search(s), f"{p.name}: a 24-unit stroke icon")

    def test_every_icon_a_page_names_is_there(self):
        names = set(self.t["ICONS"])
        has = lambda n: n in names or re.sub(r"^[a-z]+-", "", n) in names  # a type's own name, else the kit's
        calls = re.compile(r'(?:(?:kit\.icon|\bico|\bmicon|\bicon|\bsbtn|\bbtn|\bcbtn)\(|kit\.button\([^,()]*,)\s*"([A-Za-z][\w-]*)"\s*[,)]|\bicon: "([A-Za-z][\w-]*)"')
        for p, s in pages():
            prefix = {"board.js": "bd-", "model.js": "md-", "sheet.js": "sh-", "doc.js": "doc-", "ds-page.js": "ds-"}.get(p.name, "")
            for m in calls.finditer(s):
                n = m.group(1) or m.group(2)
                self.assertTrue(has(n) or has(prefix + n), f"{p.name}: {n}")


# Each type's own chrome (its bars, palettes, groups, menus, buttons and fields): rules whose radius is Hermes', by
# the kit's tokens (--kit-r-icon 4 px, --kit-r-btn 2.5 px, --kit-r-sm/md/lg/xl its scale), never a number of its own.
CHROME = {
    "board/board.css": [".bd-tools", ".bd-tb", ".bd-zoom", ".bd-top", ".bd-ask", ".bd-ctx", ".bd-pop", ".bd-kind", ".bd-linkin"],
    "sheet/sheet.css": [".sh-ac", ".sh-chart", ".sh-pop", ".sh-b", ".sh-chip", ".sh-chip-t", ".sh-chip-x", ".sh-chip-add", ".sh-seg", ".sh-agg",
                        ".sh-ddp", ".sh-rp-x", ".sh-rc", ".sh-rc-x", ".sh-fb", ".sh-flt-add", ".sh-flt-q"],
    "dashboard/dashboard.css": [".dash-err", ".src-ib", ".src-li", ".src-more", ".src-arg", ".src-modal-card", ".dash-ask", ".src-edit",
                                ".src-hist-row", ".dash-notice", ".dash-ask-sel", ".dash-ask-sel-b", ".dash-edit-tools"],
    "design/design.css": [".dc-sbtn", ".dc-err", ".dc-crumbs", ".dc-tools", ".dc-reset", ".dc-pill", ".dc-orow", ".dc-code"],
    "slides/slides.css": [".sl-thumb", ".sl-tools", ".sl-askin", ".sl-pnext", ".sl-sec", ".sl-pill", ".sl-dialog"],
    "model/model.css": [".md-pill", ".md-orow", ".md-ocaret", ".md-oeye", ".md-prob", ".md-tip", ".md-meas"],
    "motion/motion.css": [".mo-more", ".mo-choice", ".mo-line", ".mo-pal", ".mo-seg"],
    "doc/doc.css": ["#doc-toc a", ".doc-selbar", ".doc-askin"],
    "doc/editor.css": [".doc-gutter button", ".doc-sb", ".doc-rm-item", ".doc-card-ok", ".doc-dateinp", ".doc-src-done", ".doc-dlg-in", ".doc-data-in"],
    "design-system/ds.css": [".ds-nav-i", ".ds-nav-search", ".ds-btn", ".ds-in", ".ds-ib", ".ds-cin", ".ds-pop", ".ds-fl-i", ".ds-editor", ".ds-banner"],
}


def rules(css, selector):
    """The declarations of every rule whose selector list names this class exactly."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        if any(re.fullmatch(re.escape(selector) + r"(\[[^\]]*\]|:[\w-]+(\([^)]*\))?)*", x.strip()) for x in m.group(1).split(",")):
            yield m.group(1).strip(), m.group(2)


class HermesRadii(unittest.TestCase):
    def test_no_radius_of_its_own_behind_a_token(self):
        # the kit defines every --kit-r-* on :root (Hermes' defaults), so a fallback after one is a stale number
        for p in sorted(TYPES.rglob("*.css")):
            self.assertNotRegex(p.read_text(encoding="utf-8"), r"var\(--kit-r-\w+,", p.name)

    def test_chrome_takes_hermes_radii(self):
        for f, sels in CHROME.items():
            css = (TYPES / f).read_text(encoding="utf-8")
            for sel in sels:
                found = list(rules(css, sel))
                self.assertTrue(found, f"{f}: no rule {sel}")
                for name, body in found:
                    for r in re.findall(r"border-radius:\s*([^;]+)", body):
                        self.assertRegex(r.strip(), r"^((var\(--kit-r-(icon|btn|sm|md|lg|xl)\)|0)\s*)+$|^50%$", f"{f} {name}: {r}")


if __name__ == "__main__":
    unittest.main()
