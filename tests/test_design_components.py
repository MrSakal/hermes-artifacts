"""Design canvas + design system components: a canvas that wears a system carries its component bundle,
and the runtime has what mounts <x-import component-from-global-scope> in the artboard frames."""

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

from hermes_artifacts import render, store  # noqa: E402

EXAMPLE = ROOT / "examples" / "design-system"
DESIGN = PLUGIN / "hermes_artifacts" / "types" / "design"
BOARD = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Kiln</title></head><body><x-dc>
<div style="display:flex;gap:12px;padding:24px">
  <x-import component-from-global-scope="Kiln.Button" variant="primary" label="Book a class"></x-import>
  <x-import component-from-global-scope="Tag" tone="clay" label="Stoneware"></x-import>
</div>
</x-dc></body></html>
"""


def content(html):
    start = html.index('id="hermes-artifact-content">') + len('id="hermes-artifact-content">')
    return json.loads(html[start:html.index("</script>", start)])


class XImportTests(unittest.TestCase):
    def test_canvas_carries_the_bundle_and_the_mount_code(self):
        kiln = store.publish(path=str(EXAMPLE), title="Kiln", type="design-system")["id"]
        m = store.publish(title="Kiln canvas", type="design", files={
            "canvas.json": {"v": 3, "title": "Kiln canvas", "boards": {"Main.dc.html": {"x": 0, "y": 0, "w": 640, "h": 200}},
                            "order": ["Main.dc.html"], "designSystems": [kiln]},
            "Main.dc.html": BOARD})
        html = render.render(m, store.version_dir(m["id"]))
        c = content(html)
        bundle = c["files"]["ds/kiln/components/bundle.js"]
        self.assertIn("window.Kiln", bundle)
        self.assertIn('component-from-global-scope="Kiln.Button"', c["files"]["Main.dc.html"])
        self.assertEqual(json.loads(c["files"]["canvas.json"])["designSystems"][0]["namespace"], "kiln")
        # the runtime: the canvas sends the copy's scripts, the frame runs them and mounts
        self.assertIn('components/bundle.js', html)           # design.js reads the copy's bundle
        self.assertIn("installSystems(m.scripts)", html)      # frame.js runs them once per frame
        self.assertIn("xi: XI", html)                         # and hands DC its mount hook
        self.assertIn("Instance.prototype.ximport", html)     # dc.js builds the host

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_scripts_parse(self):
        for f in ("dc.js", "frame.js", "design.js"):
            r = subprocess.run(["node", "--check", str(DESIGN / f)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, f + ": " + r.stderr)


if __name__ == "__main__":
    unittest.main()
