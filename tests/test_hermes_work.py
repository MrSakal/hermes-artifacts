"""The live types' "Hermes is working" marks (kit.hermesWork, used by the sheet's and the board's pill and the
doc's "Hermes is here"): they last while a run that changed the artifact is in flight and end with it.

The fault: the server counts Hermes as at work for 5 minutes after its last change (hermes_active /
hermes_left), publishing included, so the pill stayed after the run had ended, through later turns and on
a fresh open. Hermes Desktop now tells every open page whether a run is in flight and for how long ("run":
{on, age}); kit.js runs here in Node on a stub page and bridge and plays the transitions: no host word (a
browser: the server's window), a fresh open with nothing running, a run that publishes and ends, one that
fails or is stopped (the same "off"), a change made before the run began, a change no run here explains
(Hermes on another platform: a moment). Skipped without node.
"""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TYPES = ROOT / "plugin" / "hermes_artifacts" / "types"
NODE = shutil.which("node")

RUN = r"""
const fs = require('fs')
// A page with no content element and a bridge whose host events the test sends.
globalThis.document = { getElementById: () => null, querySelector: () => null, documentElement: { setAttribute() {}, style: { setProperty() {} } } }
const ls = {}
globalThis.window = globalThis
window.hermes = { on: (name, fn) => { (ls[name] = ls[name] || []).push(fn) } }
const host = d => (ls.run || []).forEach(fn => fn(d))
let now = 1e9
Date.now = () => now
eval(fs.readFileSync(process.argv[2], 'utf8'))
const W = window.kit.hermesWork
const out = {}
let changes = 0
W.change(() => changes++)
const sec = s => { now += s * 1000 }

// No word from the host (a browser): the server's window alone.
W.seen(true, 290, 10); out.browser = W.on()
W.seen(false); out.browserOff = W.on()

// A fresh open, nothing running, the server still in its window from a change a minute ago: no mark.
host({ on: false, age: null }); W.seen(true, 240, 60); out.freshOpen = W.on()

// Hermes starts a run, publishes (a change now), and the run ends.
sec(5); host({ on: true, age: 0 }); out.runBeforeChange = W.on()
sec(8); W.seen(true, 300, 0); out.runChanged = W.on(); out.leftInRun = Math.round(W.left())
sec(20); host({ on: false, age: null }); out.runEnded = W.on()

// A later turn that does not touch it: no mark, though the server's window still runs.
sec(30); host({ on: true, age: 0 }); W.seen(true, 250, 50); out.laterTurn = W.on()
// That turn fails or is stopped: the same "off".
sec(3); host({ on: false, age: null }); out.stopped = W.on()

// Opened while a run that began two minutes ago is in flight; Hermes changed it a minute ago.
host({ on: true, age: 120000 }); W.seen(true, 240, 60); out.openMidRun = W.on()
// It had changed it before that run began: no mark.
W.seen(true, 60, 240); out.changedBeforeRun = W.on()
host({ on: false, age: null })

// A change no run here explains (Hermes on another platform): a moment, then it goes by itself.
sec(10); W.seen(true, 300, 0); out.elsewhere = W.on(); out.leftElsewhere = Math.round(W.left())
sec(16); out.elsewhereLater = W.on()

// A server with a shorter window (a test harness): its own end, not a fixed 5 minutes.
host({ on: true, age: 0 }); sec(1); W.seen(true, 12, 0); out.shortWindow = [W.on(), Math.round(W.left())]
sec(13); out.shortWindowLater = W.on()
host({ on: false, age: null })

out.changes = changes
console.log(JSON.stringify(out))
"""


@unittest.skipIf(NODE is None, "node not installed")
class HermesWorkTests(unittest.TestCase):
    def test_the_mark_follows_the_run(self):
        d = Path(tempfile.mkdtemp(prefix="ha-work-"))
        (d / "run.js").write_text(RUN, "utf-8")
        r = subprocess.run([NODE, "run.js", str(TYPES / "_kit" / "kit.js")], cwd=d, capture_output=True, text=True, timeout=60)
        shutil.rmtree(d, ignore_errors=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(out, {
            "browser": True, "browserOff": False,
            "freshOpen": False,
            "runBeforeChange": False, "runChanged": True, "leftInRun": 300, "runEnded": False,
            "laterTurn": False, "stopped": False,
            "openMidRun": True, "changedBeforeRun": False,
            "elsewhere": True, "leftElsewhere": 15, "elsewhereLater": False,
            "shortWindow": [True, 12], "shortWindowLater": False,
            "changes": 9,  # every word from the host reaches the page
        })

    def test_the_live_types_use_it(self):
        for name in ("sheet", "board"):
            src = (TYPES / name / f"{name}.js").read_text("utf-8")
            self.assertIn("kit.hermesWork.change(function () { setHermes(); });", src, name)
            self.assertNotIn("(left > 0 ? left : 300)", src, name)  # the old 5-minute rule
        doc = (TYPES / "doc" / "doc.js").read_text("utf-8")
        self.assertIn("kit.hermesWork.change(hermesNow);", doc)
        self.assertIn("kit.hermesWork.seen(r.hermes_active, r.hermes_left, r.hermes_ago); hermesNow();", doc)
        self.assertIn("var hermesActive = kit.hermesWork.on();", doc)

    def test_the_desktop_tells_every_open_page(self):
        src = (ROOT / "plugin" / "desktop" / "plugin.js").read_text("utf-8")
        self.assertIn("postToPage(portRef, 'run', runInfo())", src)  # on connect
        self.assertIn("themePorts.forEach(ref => postToPage(ref, 'run', info))", src)  # on every change


if __name__ == "__main__":
    unittest.main()
