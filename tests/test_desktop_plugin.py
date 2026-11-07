"""desktop/plugin.js parses and loads as a module (stub SDK), so a syntax slip can't ship again.

v0.6.0-v0.8.0 shipped with an unclosed template literal: the desktop half never loaded. Needs Node
(skipped without it).
"""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
NODE = shutil.which("node")

SDK_STUB = """
const atom = v => { let x = v; const ls = new Set(); return { get: () => x, set: n => { x = n; ls.forEach(f => f(n)) }, listen: f => (ls.add(f), () => ls.delete(f)) } }
export { atom }
export const host = { state: {}, request: async () => ({}), composer: {}, navigate() {} }
export const ROUTES_AREA = 'routes', SIDEBAR_NAV_AREA = 'nav', SIDEBAR_NAV_PREFS_AREA = 'prefs'
export const STATUSBAR_AREAS = { left: 'l', right: 'r' }
export const SandboxedFrame = () => null
export const usePluginI18n = () => k => k
export const useValue = a => a.get()
export default {}
"""
REACT_STUB = "export const useEffect = () => {}, useLayoutEffect = () => {}, useRef = () => ({}), useState = v => [v, () => {}]\nexport default {}\n"
JSX_STUB = "export const jsx = () => null, jsxs = () => null\n"


@unittest.skipIf(NODE is None, "node not installed")
class DesktopPluginTests(unittest.TestCase):
    def test_loads_and_exports_the_plugin(self):
        d = Path(tempfile.mkdtemp(prefix="ha-desktop-"))
        src = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
        src = (src.replace("from '@hermes/plugin-sdk'", "from './sdk.mjs'")
                  .replace("from 'react/jsx-runtime'", "from './jsx.mjs'").replace("from 'react'", "from './react.mjs'"))
        (d / "plugin.mjs").write_text(src, "utf-8")
        (d / "sdk.mjs").write_text(SDK_STUB, "utf-8")
        (d / "react.mjs").write_text(REACT_STUB, "utf-8")
        (d / "jsx.mjs").write_text(JSX_STUB, "utf-8")
        script = ("import('./plugin.mjs').then(m => console.log(JSON.stringify({id: m.default.id, register: typeof m.default.register})))"
                  ".catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })")
        r = subprocess.run([NODE, "-e", script], cwd=d, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout.strip().splitlines()[-1]), {"id": "hermes-artifacts", "register": "function"})


if __name__ == "__main__":
    unittest.main()
