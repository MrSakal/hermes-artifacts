"""The viewer's double buffer, heartbeat and reports (desktop/plugin.js makeFrames, useBridge; assets/shell.js).

A new version loads out of sight and is shown when its page says ready, also when it threw (a quiet band);
one that threw and drew nothing (blank), or said nothing in time (10 s in sight from its hello, or from 10 s
after load without one), is not swapped in (the old one stays, a band offers "Show vN"); with nothing shown
yet it shows anyway with the band; the newest pending wins and an older one is dropped with its port and its
waiting ops; ops of a frame out of sight that change something wait for the reveal; a page with an older
bridge (hello v < 3) is shown at once; the host reports with the version IT holds (a page's own save moves it)
and stops on the server's {off: true}; a shown page without a beat for 8 s in sight gets the band, is
reported stalled only after 20 s, and a later beat restores its record (not while the host is hidden, the
pane is not in sight, or the host's own tick came late). The same for the browser viewer's shell.js. Needs Node.
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

SDK = """
const atom = v => { let x = v; const ls = new Set(); return { get: () => x, set: n => { x = n; ls.forEach(f => f(n)) }, listen: f => (ls.add(f), () => ls.delete(f)) } }
export { atom }
export const host = { state: {}, request: async () => ({}), composer: {}, navigate() {} }
export const ROUTES_AREA = 'routes', SIDEBAR_NAV_AREA = 'nav', SIDEBAR_NAV_PREFS_AREA = 'prefs'
export const STATUSBAR_AREAS = { left: 'l', right: 'r' }
export const SandboxedFrame = () => null
export const usePluginI18n = () => (k, ...a) => (a.length ? `${k}:${a.join(',')}` : k)
export const useValue = a => a.get()
export default {}
"""
# Effects are collected, not run (a test runs the ones it wants).
REACT = """
export const useEffect = f => { globalThis.__fx && globalThis.__fx.push(f) }
export const useLayoutEffect = () => {}, useRef = v => ({ current: v === undefined ? null : v }), useState = v => [v, () => {}]
export default {}
"""
JSX = "export const jsx = (type, props, key) => ({ type, props, key }), jsxs = jsx, Fragment = Symbol('Fragment')\n"
EXPORTS = ("\nexport { makeFrames, inSightOf, hostReport, diagBody, PASS_OPS, STRINGS, useBridge, Frame, FrameBand, $list, $selected,"
           " $picking, $comments, $presenting, $exports, LIVE_TYPES, PROTOCOL }\n"
           "export const __reports = () => ({ off: reportsOff, queued: [...reportQ.values()].reduce((n, q) => n + q.items.length, 0) })\n")


def module() -> Path:
    d = Path(tempfile.mkdtemp(prefix="ha-swap-"))
    src = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
    src = (src.replace("from '@hermes/plugin-sdk'", "from './sdk.mjs'")
              .replace("from 'react/jsx-runtime'", "from './jsx.mjs'").replace("from 'react'", "from './react.mjs'"))
    (d / "plugin.mjs").write_text(src + EXPORTS, "utf-8")
    (d / "sdk.mjs").write_text(SDK, "utf-8")
    (d / "react.mjs").write_text(REACT, "utf-8")
    (d / "jsx.mjs").write_text(JSX, "utf-8")
    return d


def run(d: Path, body: str) -> dict:
    script = ("import('./plugin.mjs').then(async m => {" + body + "}).then(() => process.exit(0))"
              ".catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })")
    r = subprocess.run([NODE, "--input-type=module", "-e", script], cwd=d, capture_output=True, text=True, encoding="utf-8", timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout.strip().splitlines()[-1])


# A clock the test moves, frames with fake ports, and the reports they make.
SETUP = """
let T = 1000
const reports = [], reveals = []
let presenting = false
const graces = [] // a shown frame's port, kept for its page's last words: closed when the test runs these
const F = m.makeFrames({ now: () => T, report: (aid, kind, body) => reports.push([aid, kind, body]), reveal: r => reveals.push(r.v),
  presenting: () => presenting, later: fn => graces.push(fn) })
const endGraces = () => graces.splice(0).forEach(fn => fn())
const port = () => ({ closed: false, close() { this.closed = true } })
const tick = (n = 1, inSight = true, ms = 1000) => { for (let i = 0; i < n; i++) { T += ms; F.tick(inSight) } }
const st = () => ({ shown: F.shown && F.shown.v, pending: F.pending && F.pending.v, band: F.band && { ...F.band, src: undefined },
  frames: F.list().length })
const open = (v, mode) => { const r = F.want('a:' + v, v, 'a', mode); if (r) F.setSrc(r, 'data:v' + v); return r }
const connect = (r, pv = 3) => { F.hello(r, pv); r._port = port(); F.port(r, r._port); return r }
"""


@unittest.skipIf(NODE is None, "node not installed")
class SwapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = module()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.d, ignore_errors=True)

    def js(self, body: str) -> dict:
        return run(self.d, SETUP + body)

    def test_a_new_version_is_shown_when_its_page_is_ready(self):
        out = self.js("""
        const v1 = connect(open(1)); const first = st()
        F.ready(v1, false); const one = st()
        const v2 = connect(open(2)); const loading = st()
        F.ready(v2, false)
        console.log(JSON.stringify({ first, one, loading, two: st(), oldOpen: v1._port.closed, oldClosed: (endGraces(), v1._port.closed), oldDead: v1.dead, reports, reveals }))
        """)
        self.assertEqual(out["first"], {"shown": None, "pending": 1, "band": None, "frames": 1})  # a first load: the placeholder
        self.assertEqual(out["one"], {"shown": 1, "pending": None, "band": None, "frames": 1})
        self.assertEqual(out["loading"], {"shown": 1, "pending": 2, "band": None, "frames": 2})  # both mounted, v1 on screen
        self.assertEqual(out["two"], {"shown": 2, "pending": None, "band": None, "frames": 1})
        self.assertTrue(out["oldClosed"] and out["oldDead"])
        self.assertFalse(out["oldOpen"])  # until its grace ends
        self.assertEqual(out["reports"], [["a", "shown", {"version": 1, "outcome": "ready"}], ["a", "shown", {"version": 2, "outcome": "ready"}]])
        self.assertEqual(out["reveals"], [1, 2])

    def test_a_version_that_threw_but_drew_is_shown_with_a_quiet_band(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        const v2 = connect(open(2)); F.ready(v2, true) // no blank field: it drew something
        const two = st()
        const v3 = connect(open(3)); F.ready(v3, true, false)
        console.log(JSON.stringify({ two, three: st(), reports: reports.map(r => r[2].version + ':' + r[2].outcome) }))
        """)
        self.assertEqual(out["two"], {"shown": 2, "pending": None, "frames": 1,
                                      "band": {"kind": "failed", "why": "threw", "v": 2, "old": None, "key": "a:2"}})
        self.assertEqual(out["three"]["shown"], 3)
        self.assertEqual(out["three"]["band"]["v"], 3)  # the next version's own band, not the old one
        self.assertEqual(out["reports"], ["1:ready", "2:threw", "3:threw"])  # the agent still learns

    def test_a_version_that_threw_and_drew_nothing_is_kept_out_and_show_brings_it(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        const v2 = connect(open(2)); F.ready(v2, true, true)
        const kept = st(), dead = v2.dead
        F.force(); const forced = st()
        const again = F.shown; F.ready(again, true, true)
        const G = m.makeFrames({ now: () => T }); const g = G.want('b:1', 1, 'b'); G.setSrc(g, 'x'); G.hello(g, 3); G.ready(g, true, true)
        console.log(JSON.stringify({ kept, dead, forced, src: again.src, key: again.key, after: st(), alone: { shown: G.shown && G.shown.v, band: G.band }, reports }))
        """)
        self.assertEqual(out["kept"], {"shown": 1, "pending": None, "frames": 1,
                                       "band": {"kind": "failed", "why": "blank", "v": 2, "old": 1, "key": "a:2", "aid": "a"}})
        self.assertTrue(out["dead"])  # not kept around: two frames only while one loads
        self.assertEqual(out["forced"], {"shown": 2, "pending": None, "band": None, "frames": 1})
        self.assertEqual((out["src"], out["key"]), ("data:v2", "a:2"))
        self.assertEqual(out["after"]["band"]["why"], "blank")  # shown on request: the band says what it is
        self.assertEqual(out["alone"], {"shown": 1, "band": {"kind": "failed", "why": "blank", "v": 1, "old": None, "key": "b:1"}})
        self.assertIn(["a", "shown", {"version": 2, "outcome": "threw", "blank": True}], out["reports"])  # the old one stayed

    def test_no_ready_in_10_seconds_in_sight_is_a_timeout(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        const v2 = connect(open(2))
        tick(20, false) // the host out of sight: the wait does not run
        const hidden = st()
        tick(9); const nine = st()
        tick(1); const ten = st()
        console.log(JSON.stringify({ hidden, nine, ten, reports }))
        """)
        self.assertEqual(out["hidden"]["pending"], 2)
        self.assertEqual(out["nine"]["pending"], 2)
        self.assertEqual(out["ten"]["band"]["why"], "timeout")
        self.assertEqual((out["ten"]["shown"], out["ten"]["pending"], out["ten"]["band"]["old"]), (1, None, 1))
        self.assertIn(["a", "shown", {"version": 2, "outcome": "timeout"}], out["reports"])

    def test_a_late_tick_counts_one_tick_not_the_gap(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        connect(open(2))
        tick(1); tick(1, true, 60000); tick(1, true, 45000) // a host asleep twice
        console.log(JSON.stringify(st()))
        """)
        self.assertEqual(out["pending"], 2)
        self.assertIsNone(out["band"])

    def test_first_publish_shows_anyway_with_the_band(self):
        out = self.js("""
        const a = connect(open(1)); F.ready(a, true); const threw = st()
        const G = m.makeFrames({ now: () => T }); const b = G.want('b:1', 1, 'b'); G.setSrc(b, 'x')
        for (let i = 0; i < 20; i++) { T += 1000; G.tick(true) } // no hello: 10 s before the wait, then 10 s
        console.log(JSON.stringify({ threw, timeout: { shown: G.shown && G.shown.v, band: G.band } }))
        """)
        self.assertEqual(out["threw"], {"shown": 1, "pending": None, "frames": 1,
                                        "band": {"kind": "failed", "why": "threw", "v": 1, "old": None, "key": "a:1"}})
        self.assertEqual(out["timeout"], {"shown": 1, "band": {"kind": "failed", "why": "timeout", "v": 1, "old": None, "key": "b:1"}})

    def test_the_newest_pending_wins_and_nothing_leaks(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        const v2 = connect(open(2)); let ran = 0
        F.hold(v2, () => ran++)
        const v3 = connect(open(3))
        const v4 = open(4) // before its hello
        F.ready(v2, false); F.ready(v3, false) // late words of dropped frames
        const mid = st()
        connect(v4); F.ready(v4, false)
        console.log(JSON.stringify({ mid, end: st(), closed: [v2._port.closed, v3._port.closed], ran, queued: v2.queue.length,
          outcomes: reports.map(r => r[2].version + ':' + r[2].outcome) }))
        """)
        self.assertEqual(out["mid"], {"shown": 1, "pending": 4, "band": None, "frames": 2})
        self.assertEqual(out["end"], {"shown": 4, "pending": None, "band": None, "frames": 1})
        self.assertEqual(out["closed"], [True, True])
        self.assertEqual((out["ran"], out["queued"]), (0, 0))
        self.assertEqual(out["outcomes"], ["1:ready", "4:ready"])

    def test_ops_of_a_frame_out_of_sight_wait_for_the_reveal(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        const v2 = connect(open(2)); const done = []
        F.hold(v2, () => done.push('save'))
        const before = done.length
        F.ready(v2, false)
        console.log(JSON.stringify({ before, after: done, hidden1: F.hidden(v1), hidden2: F.hidden(v2) }))
        """)
        self.assertEqual((out["before"], out["after"]), (0, ["save"]))
        self.assertFalse(out["hidden2"])

    def test_which_ops_pass_out_of_sight(self):
        out = run(self.d, "console.log(JSON.stringify([...m.PASS_OPS]))")
        for op in ("storage.get", "storage.list", "doc.read", "sheet.read", "board.read", "dataset.run", "vendor", "ds.get", "report", "chrome"):
            self.assertIn(op, out)
        for op in ("save", "storage.set", "doc.edit", "sheet.edit", "sheet.vals", "board.edit", "view", "send", "ask", "download",
                   "navigate", "present", "showVersion", "history.restore", "preview.set", "dataset.approve", "ds.default"):
            self.assertNotIn(op, out)

    def test_an_older_bridge_is_shown_at_once_and_never_stalls(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        const v2 = connect(open(2), 2)
        const at = st()
        tick(30)
        console.log(JSON.stringify({ at, later: st(), reports: reports.length }))
        """)
        self.assertEqual(out["at"], {"shown": 2, "pending": None, "band": None, "frames": 1})
        self.assertIsNone(out["later"]["band"])
        self.assertEqual(out["reports"], 1)  # v1's ready only: no timeout, no stall for a legacy page

    def test_now_mode_and_another_artifact_replace_at_once(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        open(2, 'now'); const live = st()
        const other = F.want('b:1', 1, 'b'); const another = st()
        console.log(JSON.stringify({ live, another, same: F.want('b:1', 1, 'b') }))
        """)
        self.assertEqual(out["live"], {"shown": 2, "pending": None, "band": None, "frames": 1})
        self.assertEqual(out["another"]["shown"], 1)  # b's v1
        self.assertIsNone(out["same"])

    def test_a_version_ready_while_a_deck_presents_waits_until_it_ends(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        presenting = true
        const v2 = connect(open(2)); F.ready(v2, false); const during = st()
        presenting = false; F.presenting(false)
        console.log(JSON.stringify({ during, after: st() }))
        """)
        self.assertEqual((out["during"]["shown"], out["during"]["pending"]), (1, 2))
        self.assertEqual(out["after"]["shown"], 2)

    def test_stalled_after_three_missed_beats_in_sight_and_a_beat_clears_it(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        const seen = [], stalls = () => reports.filter(r => r[2].outcome === 'stalled').length
        tick(8); seen.push(st().band)
        tick(1); seen.push(st().band && st().band.kind)
        const n1 = stalls() // the band, not yet the server
        tick(5); F.beat(v1); seen.push(st().band) // 14 s busy (a big export): nothing reported
        const n2 = stalls()
        tick(20); seen.push(st().band && st().band.kind)
        const n3 = stalls()
        F.beat(v1); seen.push(st().band)
        const last = reports[reports.length - 1][2]
        tick(25); const n4 = stalls() // a second long stall is reported again
        console.log(JSON.stringify({ seen, n: [n1, n2, n3, n4], last }))
        """)
        self.assertEqual(out["seen"], [None, "stalled", None, "stalled", None])
        self.assertEqual(out["n"], [0, 0, 1, 2])
        self.assertEqual(out["last"], {"version": 1, "outcome": "ready", "recovered": True})  # the record is "ready" again

    def test_a_threw_page_that_recovers_from_a_stall_is_threw_again(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, true)
        tick(21); F.beat(v1)
        console.log(JSON.stringify(reports.map(r => r[2].outcome)))
        """)
        self.assertEqual(out, ["threw", "stalled", "threw"])

    def test_a_page_save_moves_only_its_future_reports_to_the_new_version(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        F.diag(v1, { entries: [{ k: 'error', m: 'before', n: 1 }], dropped: 0 })
        F.advance('a:1', 2); F.advance('a:1', 2); F.advance('a:9', 3)
        F.diag(v1, { entries: [{ k: 'error', m: 'after', n: 1 }], dropped: 0 })
        tick(21)
        console.log(JSON.stringify(reports.map(r => r[1] + ':' + r[2].version + ':' + (r[2].outcome || r[2].entries[0].m))))
        """)
        # v2 never had a load of its own: no "shown" for it (the agent keeps "not opened yet"); what came before
        # the save stays under v1
        self.assertEqual(out, ["shown:1:ready", "diag:1:before", "diag:2:after", "shown:2:stalled"])

    def test_a_shown_frame_that_goes_keeps_its_port_for_the_grace_only(self):
        out = run(self.d, """
        let T = 1000
        const timers = []
        const F = m.makeFrames({ now: () => T, later: (fn, ms) => timers.push([fn, ms]) })
        const port = () => ({ closed: false, close() { this.closed = true } })
        const open = v => { const r = F.want('a:' + v, v, 'a'); F.setSrc(r, 'x'); F.hello(r, 3); r._p = port(); F.port(r, r._p); return r }
        const v1 = open(1); F.ready(v1, false)
        const v2 = open(2) // pending, never shown
        const v3 = open(3) // v2 dropped: no grace
        F.ready(v3, false) // v1 dropped: grace
        const mid = { v1: [F.closing(v1), v1._p.closed], v2: [F.closing(v2), v2._p.closed], timers: timers.map(t => t[1]) }
        timers.splice(0).forEach(t => t[0]())
        const after = { v1: [F.closing(v1), v1._p.closed] }
        // five quick swaps: one frame left, every port closed once the grace ends
        const all = []
        for (let v = 4; v <= 8; v++) { const r = open(v); all.push(r); F.ready(r, false) }
        const frames = F.list().length, waiting = timers.length
        timers.splice(0).forEach(t => t[0]())
        const leaked = [v3, ...all.slice(0, 4)].filter(r => !r._p.closed || F.closing(r)).length
        console.log(JSON.stringify({ mid, after, frames, waiting, leaked, shownOpen: !all[4]._p.closed }))
        """)
        self.assertEqual(out["mid"], {"v1": [True, False], "v2": [False, True], "timers": [2000]})
        self.assertEqual(out["after"], {"v1": [False, True]})
        self.assertEqual((out["frames"], out["waiting"], out["leaked"], out["shownOpen"]), (1, 5, 0, True))

    def test_the_bridge_applies_a_going_frames_last_edits_and_nothing_after(self):
        out = run(self.d, """
        globalThis.window = new EventTarget()
        globalThis.document = { hidden: false, fullscreenElement: null, body: { appendChild() {} },
          createElement: () => ({ style: {}, remove() {} }), documentElement: {}, head: {} }
        globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', color: '', backgroundColor: 'rgb(0, 0, 0)', borderTopLeftRadius: '', fontFamily: '' })
        const rests = [], timers = []
        const ctx = { rest: async (url, o) => { rests.push((o && o.body && o.body.op || url) + ':' + JSON.stringify(o && o.body && o.body.args && o.body.args.value)); return { ok: true } } }
        m.$list.set([{ id: 'a', title: 'A', version: 3, versions: [1, 2, 3], type: 'page' }]); m.$selected.set('a')
        const F = m.makeFrames({ later: fn => timers.push(fn) })
        const mount = (r, val) => {
          const cw = { postMessage: (msg, o, ports) => { cw.port = ports[0] } }
          globalThis.__fx = []
          m.useBridge({ current: { contentWindow: cw } }, m.$list.get()[0], ctx, { current: null }, r, F)
          const fx = globalThis.__fx; globalThis.__fx = null
          fx.forEach(f => f())
          const ev = new Event('message'); ev.source = cw; ev.data = { __hermes_bridge: 1, kind: 'hello', v: 3 }
          window.dispatchEvent(ev)
          return cw.port
        }
        const r1 = F.want('a:1', 1, 'a'); F.setSrc(r1, 'x'); const p1 = mount(r1); F.ready(r1, false)
        const r2 = F.want('a:2', 2, 'a'); F.setSrc(r2, 'y'); const p2 = mount(r2)
        const r3 = F.want('a:3', 3, 'a'); F.setSrc(r3, 'z'); const p3 = mount(r3) // r2 dropped, never shown
        F.ready(r3, false) // r1 goes: its grace starts
        const replies = []
        p1.onmessage = e => { if (e.data.id != null) replies.push([e.data.id, e.data.ok]) }
        p1.postMessage({ id: 1, op: 'storage.set', args: { key: 'k', value: 'last words' } }) // its pagehide
        p1.postMessage({ id: 2, op: 'navigate', args: { page: 'x.html' } }) // would steer the viewer: refused
        p2.postMessage({ id: 3, op: 'storage.set', args: { key: 'k', value: 'never shown' } })
        p3.postMessage({ id: 4, op: 'storage.set', args: { key: 'k', value: 'new frame' } }) // not blocked meanwhile
        await new Promise(r => setTimeout(r, 250))
        const during = [...rests]
        timers.splice(0).forEach(fn => fn())
        p1.postMessage({ id: 5, op: 'storage.set', args: { key: 'k', value: 'too late' } })
        await new Promise(r => setTimeout(r, 250))
        console.log(JSON.stringify({ during, rests, replies }))
        process.exit(0)
        """)
        self.assertEqual(sorted(out["during"]), ['storage.set:"last words"', 'storage.set:"new frame"'])
        self.assertEqual(out["rests"], out["during"])  # nothing after the grace
        self.assertIn([2, False], out["replies"])

    def test_the_wait_starts_at_hello_or_10_s_after_load(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        const v2 = open(2); tick(3); F.hello(v2, 3) // a slow start: hello after 3 s
        tick(9); const at12 = st().pending
        tick(1); const at13 = st().band && st().band.why
        const v3 = open(3); tick(19); const at19 = st().pending // no hello at all
        tick(1); const at20 = st().band && st().band.why
        console.log(JSON.stringify({ at12, at13, at19, at20 }))
        """)
        self.assertEqual(out, {"at12": 2, "at13": "timeout", "at19": 3, "at20": "timeout"})

    def test_a_threw_version_ready_while_a_deck_presents_waits_with_its_band(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        presenting = true
        const v2 = connect(open(2)); F.ready(v2, true); const during = st()
        presenting = false; F.presenting(false)
        console.log(JSON.stringify({ during, after: st() }))
        """)
        self.assertEqual((out["during"]["shown"], out["during"]["pending"], out["during"]["band"]), (1, 2, None))
        self.assertEqual((out["after"]["shown"], out["after"]["band"]["why"]), (2, "threw"))

    def test_in_sight(self):
        out = run(self.d, """
        globalThis.window = { innerWidth: 1000, innerHeight: 800 }
        globalThis.document = { hidden: false, documentElement: { clientWidth: 1000, clientHeight: 800 } }
        const rect = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h })
        const el = (o = {}) => ({ isConnected: true, offsetWidth: 400, offsetHeight: 300, getBoundingClientRect: () => rect(10, 10, 400, 300), ...o })
        const r = {}
        r.plain = m.inSightOf(el()) // no checkVisibility: the size decides
        r.cv = m.inSightOf(el({ checkVisibility: o => o.checkOpacity && o.checkVisibilityCSS }))
        r.cssHidden = m.inSightOf(el({ checkVisibility: () => false })) // visibility:hidden, opacity 0 on a parent...
        r.noSize = m.inSightOf(el({ offsetWidth: 0, offsetHeight: 0 }))
        r.offScreen = m.inSightOf(el({ getBoundingClientRect: () => rect(-2000, 10, 400, 300) }))
        r.below = m.inSightOf(el({ getBoundingClientRect: () => rect(10, 900, 400, 300) }))
        r.clipped = m.inSightOf(el(), { seen: true, visible: false })
        r.observed = m.inSightOf(el(), { seen: true, visible: true })
        r.detached = m.inSightOf(el({ isConnected: false }))
        r.throws = m.inSightOf(el({ checkVisibility() { throw new Error('x') } })) // falls back to the size
        document.hidden = true; r.tabHidden = m.inSightOf(el())
        console.log(JSON.stringify(r))
        """)
        self.assertEqual(out, {"plain": True, "cv": True, "cssHidden": False, "noSize": False, "offScreen": False, "below": False,
                               "clipped": False, "observed": True, "detached": False, "throws": True, "tabHidden": False})

    # Reload of a hung page: every frame down (the hold), a pause, the page again; no hello: again, up to 3 tries.
    RESTART = """
        let held = 0
        const holds = []
        const G = m.makeFrames({ now: () => T, report: (aid, kind, body) => reports.push([aid, kind, body]),
          later: fn => graces.push(fn), hold: ms => { holds.push(ms); held = Math.max(held, T + ms) }, held: () => T < held })
        const gopen = v => { const r = G.want('b:' + v, v, 'b'); G.setSrc(r, 'data:b' + v); G.hello(r, 3); r._port = port(); G.port(r, r._port); return r }
        const gt = (n = 1) => { for (let i = 0; i < n; i++) { T += 1000; G.tick(true) } }
        const gs = () => ({ shown: G.shown && G.shown.v, band: G.band && G.band.kind, frames: G.list().length, restarting: G.restarting })
        const b1 = gopen(1); G.ready(b1, false)
        gt(21) // hung: band, reported
        G.reload()
    """

    def test_reload_takes_every_frame_down_waits_and_mounts_the_page_again(self):
        out = self.js(self.RESTART + """
        const at0 = gs(), holds0 = [...holds]
        gt(10); const at10 = gs() // the browser has not ended the hung process yet: nothing mounted
        gt(1); const at11 = gs() // the hold is over: the page again
        const again = G.shown; G.hello(again, 3); const back = gs()
        G.ready(again, false)
        console.log(JSON.stringify({ at0, holds0, at10, at11, back, src: again.src, reports: reports.map(r => r[2].outcome + (r[2].recovered ? '+r' : '')) }))
        """)
        self.assertEqual(out["at0"], {"shown": None, "band": "restarting", "frames": 0, "restarting": True})
        self.assertEqual(out["holds0"], [11000])  # one hold for every frame of the plugin
        self.assertEqual(out["at10"]["frames"], 0)
        self.assertEqual(out["at11"], {"shown": 1, "band": "restarting", "frames": 1, "restarting": True})
        self.assertEqual(out["back"], {"shown": 1, "band": None, "frames": 1, "restarting": False})
        self.assertEqual(out["src"], "data:b1")
        self.assertEqual(out["reports"], ["ready", "stalled", "ready"])  # a fresh load reports as one

    def test_reload_retries_with_backoff_then_says_what_works(self):
        out = self.js(self.RESTART + """
        const seen = []
        gt(11); seen.push(gs()) // try 1 mounted
        gt(4); seen.push(gs()) // no hello in 4 s: down again, 2 s pause
        gt(2); seen.push(gs()) // try 2
        gt(4); gt(6); seen.push(gs()) // no hello; 6 s pause; try 3
        gt(4); seen.push(gs()) // no hello: stuck
        const stuck = G.band
        G.reload(); seen.push(gs()) // Try again starts over
        console.log(JSON.stringify({ seen, holds, stuck: { kind: stuck.kind, src: stuck.src } }))
        """)
        s = out["seen"]
        self.assertEqual(s[0], {"shown": 1, "band": "restarting", "frames": 1, "restarting": True})
        self.assertEqual(s[1], {"shown": None, "band": "restarting", "frames": 0, "restarting": True})
        self.assertEqual(s[2]["frames"], 1)
        self.assertEqual(s[3]["frames"], 1)
        self.assertEqual(s[4], {"shown": None, "band": "stuck", "frames": 0, "restarting": False})
        self.assertEqual(out["stuck"], {"kind": "stuck", "src": "data:b1"})
        self.assertEqual(s[5]["band"], "restarting")
        self.assertEqual(out["holds"], [11000, 2000, 6000, 11000])

    def test_a_hung_frame_leaving_otherwise_holds_every_frame_too(self):
        out = self.js(self.RESTART.replace("G.reload()", "G.want('c:1', 1, 'c')") + """
        console.log(JSON.stringify({ holds, shown: G.shown && G.shown.aid }))
        """)
        self.assertEqual(out, {"holds": [11000], "shown": "c"})  # the other artifact mounts once the hold is over

    def test_frames_silent_together_blame_no_page(self):
        out = self.js("""
        const H = m.makeFrames({ now: () => T, report: (aid, kind, body) => reports.push([aid, kind, body]) })
        const h1 = H.want('h:1', 1, 'h'); H.setSrc(h1, 'x'); H.hello(h1, 3); H.port(h1, port()); H.ready(h1, false)
        const v1 = connect(open(1)); F.ready(v1, false)
        for (let i = 0; i < 25; i++) { T += 1000; F.tick(true); H.tick(true) } // both viewers' pages silent: the process
        const together = reports.filter(r => r[2].outcome === 'stalled').length
        const band = F.band && F.band.kind
        H.beat(h1); for (let i = 0; i < 2; i++) { T += 1000; H.beat(h1); F.tick(true); H.tick(true) } // only v1 silent now
        const alone = reports.filter(r => r[2].outcome === 'stalled').map(r => r[0] + ':' + r[2].version)
        H.dispose()
        console.log(JSON.stringify({ together, band, alone }))
        """)
        self.assertEqual((out["together"], out["band"]), (0, "stalled"))  # the band is true; no page is blamed
        self.assertEqual(out["alone"], ["a:1"])

    def test_no_stall_while_hidden_or_when_the_host_itself_was_late(self):
        out = self.js("""
        const v1 = connect(open(1)); F.ready(v1, false)
        tick(30, false); const hidden = st().band
        tick(3); const back = st().band // the count starts again when it is back in sight
        for (let i = 0; i < 10; i++) tick(1, true, 5000) // every tick late: a throttled or sleeping host
        const late = st().band
        console.log(JSON.stringify({ hidden, back, late, reports: reports.length }))
        """)
        self.assertEqual((out["hidden"], out["back"], out["late"]), (None, None, None))
        self.assertEqual(out["reports"], 1)

    def test_diag_goes_with_the_host_version_and_is_cut_to_size(self):
        out = self.js("""
        const v1 = connect(open(7)); v1.v = 7
        F.diag(v1, { entries: [{ k: 'error', m: 'x'.repeat(900), at: 'index.html:3', n: 2, stack: ['a', 'b', 'c', 'd'], version: 99, evil: 1 }], dropped: 3, version: 99 })
        F.diag(v1, { entries: [] , dropped: 0 })
        F.diag(v1, 'nonsense')
        console.log(JSON.stringify(reports))
        """)
        self.assertEqual(len(out), 1)
        aid, kind, body = out[0]
        self.assertEqual((aid, kind, body["version"], body["dropped"]), ("a", "diag", 7, 3))
        e = body["entries"][0]
        self.assertEqual((len(e["m"]), e["n"], e["at"], e["stack"]), (300, 2, "index.html:3", ["a", "b", "c"]))
        self.assertNotIn("evil", e)

    def test_reports_post_to_the_routes_and_stop_on_off(self):
        out = run(self.d, """
        const calls = []
        let off = false
        const ctx = { rest: async (url, o) => { calls.push([url, o.method, o.body]); if (url.includes('boom')) throw new Error('down'); return off ? { ok: true, stored: false, off: true } : { ok: true, stored: true } } }
        m.hostReport(ctx, 'boom', 'shown', { version: 1, outcome: 'ready' }) // a failing post harms nothing
        m.hostReport(ctx, 'a', 'shown', { version: 3, outcome: 'ready' })
        await new Promise(r => setTimeout(r, 20))
        off = true
        m.hostReport(ctx, 'a', 'diag', { version: 3, entries: [{ k: 'error', m: 'x', n: 1 }], dropped: 0 })
        await new Promise(r => setTimeout(r, 20))
        m.hostReport(ctx, 'a', 'shown', { version: 3, outcome: 'stalled' })
        await new Promise(r => setTimeout(r, 20))
        console.log(JSON.stringify({ calls, state: m.__reports() }))
        """)
        self.assertEqual(out["calls"][1], ["/artifacts/a/shown", "POST", {"version": 3, "outcome": "ready", "viewer": "desktop"}])
        self.assertEqual(out["calls"][2][0], "/artifacts/a/diag")
        self.assertEqual(out["calls"][2][2]["viewer"], "desktop")
        self.assertEqual(len(out["calls"]), 3)  # nothing after {off: true}
        self.assertTrue(out["state"]["off"])

    def test_the_five_shown_bodies_reach_the_route_as_the_server_takes_them(self):
        out = run(self.d, """
        const calls = []
        const ctx = { rest: async (url, o) => { calls.push([url, JSON.parse(JSON.stringify(o.body))]); return { ok: true, stored: true } } }
        let T = 1000
        const F = m.makeFrames({ now: () => T, report: (aid, kind, body) => m.hostReport(ctx, aid, kind, body) })
        const tick = n => { for (let i = 0; i < n; i++) { T += 1000; F.tick(true) } }
        const open = (v, pv = 3) => { const r = F.want('a:' + v, v, 'a'); F.setSrc(r, 'x'); F.hello(r, pv); F.port(r, { close() {} }); return r }
        const v7 = open(7); F.ready(v7, false, false)                 // ready
        tick(21)                                                      // stalled
        F.beat(v7)                                                    // ready, recovered
        const v8 = open(8); F.ready(v8, true, true)                   // threw, blank: v7 stays
        const v9 = open(9); F.ready(v9, true)                         // threw (no blank field): shown
        await new Promise(r => setTimeout(r, 4600))
        console.log(JSON.stringify(calls))
        """)
        self.assertEqual(out, [
            ["/artifacts/a/shown", {"version": 7, "outcome": "ready", "viewer": "desktop"}],
            ["/artifacts/a/shown", {"version": 7, "outcome": "stalled", "viewer": "desktop"}],
            ["/artifacts/a/shown", {"version": 7, "outcome": "ready", "recovered": True, "viewer": "desktop"}],
            ["/artifacts/a/shown", {"version": 8, "outcome": "threw", "blank": True, "viewer": "desktop"}],
            ["/artifacts/a/shown", {"version": 9, "outcome": "threw", "viewer": "desktop"}]])

    def test_diag_waiting_for_its_turn_is_merged_into_one_post(self):
        out = run(self.d, """
        const calls = []
        const ctx = { rest: async (url, o) => { calls.push([url, JSON.parse(JSON.stringify(o.body))]); return { ok: true } } }
        const e = i => ({ k: 'error', m: 'm' + i, n: 1 })
        m.hostReport(ctx, 'a', 'diag', { version: 2, entries: [e(0)], dropped: 0 })
        m.hostReport(ctx, 'a', 'diag', { version: 2, entries: Array.from({ length: 15 }, (_, i) => e(i + 1)), dropped: 1 })
        m.hostReport(ctx, 'a', 'diag', { version: 2, entries: Array.from({ length: 15 }, (_, i) => e(i + 16)), dropped: 0 })
        await new Promise(r => setTimeout(r, 1300))
        console.log(JSON.stringify(calls.map(c => [c[1].entries.length, c[1].dropped])))
        """)
        self.assertEqual(out, [[1, 0], [20, 11]])  # one sent at once; the next two in one post a second later

    def test_the_bridge_holds_mutating_ops_of_a_hidden_frame(self):
        out = run(self.d, """
        globalThis.window = new EventTarget()
        globalThis.document = { hidden: false, fullscreenElement: null, body: { appendChild() {} },
          createElement: () => ({ style: {}, remove() {} }), documentElement: {}, head: {} }
        globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', color: '', backgroundColor: 'rgb(0, 0, 0)', borderTopLeftRadius: '', fontFamily: '' })
        const rests = [], posted = []
        const ctx = { rest: async (url, o) => { rests.push(o && o.body && o.body.op || url); return { ok: true, value: 1 } } }
        m.$list.set([{ id: 'a', title: 'A', version: 2, versions: [1, 2], type: 'page' }]); m.$selected.set('a')
        const F = m.makeFrames({})
        const r1 = F.want('a:1', 1, 'a'); F.setSrc(r1, 'x'); F.ready(r1, false)
        const r2 = F.want('a:2', 2, 'a'); F.setSrc(r2, 'y')
        const cw = { postMessage: (msg, o, ports) => posted.push([msg, ports[0]]) }
        const ref = { current: { contentWindow: cw } }, portRef = { current: null }
        globalThis.__fx = []
        m.useBridge(ref, m.$list.get()[0], ctx, portRef, r2, F)
        const fx = globalThis.__fx; globalThis.__fx = null
        fx.forEach(f => f())
        const ev = new Event('message'); ev.source = cw; ev.data = { __hermes_bridge: 1, kind: 'hello', v: 3 }
        window.dispatchEvent(ev)
        const [hello, page] = posted[0]
        const replies = []
        page.onmessage = e => { if (e.data.id != null) replies.push(e.data.id) }
        page.postMessage({ id: 1, op: 'storage.get', args: { key: 'k' } })
        page.postMessage({ id: 2, op: 'storage.set', args: { key: 'k', value: 1 } })
        page.postMessage({ id: 3, op: 'chrome', args: { exports: [{ id: 'pdf', label: 'PDF' }] } })
        await new Promise(r => setTimeout(r, 250))
        const hidden = { rests: [...rests], replies: [...replies], exports: m.$exports.get() }
        page.postMessage({ event: 'ready', detail: { threw: false, t: 5 } })
        await new Promise(r => setTimeout(r, 250))
        page.close()
        console.log(JSON.stringify({ v: hello.v, hidden, shown: F.shown === r2, rests, replies, exports: m.$exports.get() }))
        """)
        self.assertEqual(out["v"], 3)
        self.assertEqual(out["hidden"]["rests"], ["storage.get"])  # the read went; the write waits
        self.assertEqual(sorted(out["hidden"]["replies"]), [1, 3])
        self.assertEqual(out["hidden"]["exports"], [])  # chrome answered, our toolbar not touched yet
        self.assertTrue(out["shown"])
        self.assertEqual(out["rests"], ["storage.get", "storage.set"])
        self.assertEqual(sorted(out["replies"]), [1, 2, 3])

    def test_strings_in_english_and_hungarian(self):
        out = run(self.d, """
        const S = m.STRINGS, keys = ['bandThrew', 'bandBlank', 'bandNoLoad', 'bandShow', 'bandStalled', 'reload', 'loading', 'bandRestarting', 'bandStuck', 'tryAgain']
        const call = v => (typeof v === 'function' ? [v(5, 4), v(5, null)] : v)
        console.log(JSON.stringify(Object.fromEntries(['en', 'hu'].map(l => [l, Object.fromEntries(keys.map(k => [k, S[l][k] === undefined ? null : call(S[l][k])]))]))))
        """)
        self.assertEqual(out["en"]["bandThrew"], ["v5 had an error while starting"] * 2)
        self.assertEqual(out["en"]["bandBlank"], ["v5 showed nothing (an error while starting); showing v4", "v5 showed nothing (an error while starting)"])
        self.assertEqual(out["en"]["bandNoLoad"][0], "v5 didn’t finish loading; showing v4")
        self.assertEqual(out["en"]["bandShow"][0], "Show v5")
        self.assertEqual((out["en"]["bandStalled"], out["en"]["reload"]), ("This page stopped responding", "Reload"))
        self.assertEqual((out["en"]["bandRestarting"], out["en"]["tryAgain"]), ("Restarting the page\u2026", "Try again"))
        self.assertIn("Restart Hermes", out["en"]["bandStuck"])
        for k in ("bandThrew", "bandBlank", "bandNoLoad", "bandShow", "bandStalled", "reload", "bandRestarting", "bandStuck", "tryAgain"):
            self.assertTrue(out["hu"][k], k)
            self.assertNotEqual(out["hu"][k], out["en"][k], k)
        self.assertIn("v4", out["hu"]["bandBlank"][0])

    def test_the_viewer_wires_it(self):
        src = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8").replace("\r\n", "\n")
        frame = src[src.index("function Frame("):src.index("function FrameBand(")]
        self.assertIn("{ position: 'absolute', inset: 0, display: 'flex', opacity: 0, pointerEvents: 'none' }", frame)
        self.assertIn("'aria-hidden': hidden ? 'true' : undefined", frame)
        self.assertIn("wrap.current.inert = hidden", frame)
        self.assertNotIn("display: 'none'", frame)
        viewer = src[src.index("function Viewer("):src.index("function Toast(")]
        self.assertIn("jsx(FrameBand, { F })", viewer)
        self.assertIn("LIVE_TYPES.has(art.type) ? 'now' : 'swap'", viewer)
        self.assertIn("report: (aid, kind, body) => hostReport(ctx, aid, kind, body)", viewer)
        # the stage (both frames) is what is checked, so the pending wrapper's own opacity 0 does not count
        self.assertIn("F.tick(inSightOf(stage.current, io))", viewer)
        self.assertIn("ref: stage,", viewer)
        self.assertIn("useEffect(() => { if (art && fv !== v) F.advance(key, v) }, [key, v])", viewer)
        self.assertIn("F.ready(rec, detail?.threw === true, detail?.blank === true)", src)
        self.assertIn("kind: 'port', v: PROTOCOL", src)
        # while a hung page's process is released, no frame of the plugin mounts: the viewers' nor the gallery's cards
        self.assertIn("children: rec.src && !held", frame)
        thumb = src[src.index("function Thumb("):src.index("function TypeBadge(")]
        self.assertIn("useValue($frameHold) > Date.now()", thumb)
        self.assertIn(": src && !held", thumb)
        self.assertIn("hold: ms => holdFrames(ms),", viewer)
        shell = (PLUGIN / "hermes_artifacts" / "assets" / "shell.js").read_text("utf-8")
        self.assertIn("var PAUSES = [11000, 2000, 6000], HELLO_MS = 4000", shell)
        self.assertIn('say("This page stopped responding", "Reload", restart);', shell)
        self.assertNotIn("kind: 'port', v: 2", src)


# shell.js on a small fake DOM: two iframes at a swap, events never to /api, reports to /host/.
SHELL = r"""
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
let T = 1000, tickFn = null
Date.now = () => T
const fetches = [], win = new EventTarget()
function el(tag) {
  const e = { tagName: tag.toUpperCase(), attrs: {}, children: [], className: '', style: {}, parentNode: null, inert: false,
    setAttribute(k, v) { this.attrs[k] = String(v) }, getAttribute(k) { return this.attrs[k] ?? null }, hasAttribute(k) { return k in this.attrs },
    removeAttribute(k) { delete this.attrs[k] }, addEventListener(t, f) { (this.ls = this.ls || {})[t] = f },
    appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c },
    insertBefore(c, ref) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, c); return c },
    remove() { if (this.parentNode) { const k = this.parentNode.children; k.splice(k.indexOf(this), 1); this.parentNode = null } },
    set textContent(v) { this._t = v; this.children = [] }, get textContent() { return (this._t || '') + this.children.map(c => c.textContent || '').join('') } }
  if (tag === 'iframe') e.contentWindow = { posted: [], postMessage(m, o, ports) { this.posted.push([m, ports && ports[0]]) } }
  return e
}
const body = el('body'), frame = el('iframe'), sel = el('select'), status = el('span'), reload = el('button'), title = el('span')
frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('title', 'artifact')
body.appendChild(frame)
globalThis.document = { hidden: false, body, createElement: el, createTextNode: t => ({ textContent: t }),
  getElementById: id => ({ frame, ver: sel, status, reload }[id] || null), querySelector: () => title }
globalThis.window = win
win.__HERMES_BOOT__ = { id: 'a', v: 1, latest: 1, token: 'TOK', content: 'http://c' }
globalThis.history = { replaceState() {} }
globalThis.setInterval = f => { tickFn = f; return 1 }
let sse = null
globalThis.EventSource = function () { this.addEventListener = (t, f) => { sse = f } }
globalThis.fetch = (url, o) => { fetches.push([url, JSON.parse(o.body), o.headers['X-Hermes-Token']]); return Promise.resolve({ ok: true, json: async () => ({ ok: true }) }) }
new Function(src)()
const frames = () => body.children[0].children
const hello = (f, v = 3) => { const ev = new Event('message'); ev.source = f.contentWindow; ev.data = { __hermes_bridge: 1, kind: 'hello', v }; win.dispatchEvent(ev); return f.contentWindow.posted.at(-1) }
const wait = () => new Promise(r => setTimeout(r, 20))
;(async () => {
  const out = {}
  const [m1, p1] = hello(frame)
  out.portV = m1.v
  p1.postMessage({ event: 'ready', detail: { threw: false } }); p1.postMessage({ event: 'alive', detail: null })
  await wait()
  sse({ data: JSON.stringify({ v: 2 }) })
  out.during = frames().map(f => [f.className, f.getAttribute('aria-hidden'), f.inert])
  const f2 = frames()[1], [, p2] = hello(f2)
  p2.postMessage({ id: 9, op: 'storage.set', args: { key: 'k', value: 1 } })
  p2.postMessage({ event: 'diag', detail: { entries: [{ k: 'error', m: 'boom', n: 1 }], dropped: 0 } })
  await wait()
  out.beforeReady = fetches.map(f => f[0])
  p2.postMessage({ event: 'ready', detail: { threw: false } })
  await wait()
  out.after = frames().map(f => [f.className, f.getAttribute('aria-hidden')])
  out.fetches = fetches.map(f => [f[0], f[1], f[2]])
  sse({ data: JSON.stringify({ v: 3 }) })
  const f3 = frames()[1], [, p3] = hello(f3)
  p3.postMessage({ event: 'ready', detail: { threw: true } }) // drew something: shown, with the notice
  await wait()
  out.threw = { frames: frames().length, shown: frames()[0].src.split('/').at(-2), status: status.textContent }
  sse({ data: JSON.stringify({ v: 4 }) })
  const f4 = frames()[1], [, p4] = hello(f4)
  p4.postMessage({ event: 'ready', detail: { threw: true, blank: true } }) // drew nothing: v3 stays
  await wait()
  out.blank = { frames: frames().length, shown: frames()[0].src.split('/').at(-2), status: status.textContent, ver: sel.value,
    body: fetches.filter(f => f[0] === '/host/a/shown' && f[1].version === 4)[0][1] }
  const posts = () => fetches.filter(f => f[0] === '/host/a/shown').map(f => f[1].version + ':' + f[1].outcome)
  for (let i = 0; i < 9; i++) { T += 1000; tickFn() }
  out.stalled = { status: status.textContent, posts: posts() }
  for (let i = 0; i < 12; i++) { T += 1000; tickFn() }
  out.reported = posts()
  p3.postMessage({ event: 'alive', detail: null })
  await wait()
  out.recovered = { status: status.textContent, posts: posts(), body: fetches.filter(f => f[0] === '/host/a/shown').at(-1)[1] }
  // the grace: v2 went at v3's swap (shown before: its last edit goes through); v4 was never shown
  const api = () => fetches.filter(f => f[0].startsWith('/api/')).map(f => f[1].value)
  p2.postMessage({ id: 60, op: 'storage.set', args: { key: 'k', value: 'v2 last words' } })
  p4.postMessage({ id: 61, op: 'storage.set', args: { key: 'k', value: 'v4 never shown' } })
  await wait()
  out.grace = api()
  await new Promise(r => setTimeout(r, 2100))
  p2.postMessage({ id: 62, op: 'storage.set', args: { key: 'k', value: 'v2 too late' } })
  await wait()
  out.afterGrace = api()
  console.log(JSON.stringify(out))
  process.exit(0) // the bridge's ports keep node alive
})()
"""


@unittest.skipIf(NODE is None, "node not installed")
class ShellSwapTests(unittest.TestCase):
    def test_two_frames_events_and_reports(self):
        d = Path(tempfile.mkdtemp(prefix="ha-shell-"))
        (d / "run.js").write_text(SHELL, "utf-8")
        r = subprocess.run([NODE, str(d / "run.js"), str(PLUGIN / "hermes_artifacts" / "assets" / "shell.js")],
                           capture_output=True, text=True, encoding="utf-8", timeout=60)
        shutil.rmtree(d, ignore_errors=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(out["portV"], 3)
        self.assertEqual(out["during"], [["", None, False], ["pending", "true", True]])
        # the page's events never go to /api; the held storage.set goes only once v2 is shown
        self.assertEqual(out["beforeReady"], ["/host/a/shown", "/host/a/diag"])
        self.assertEqual(out["after"], [["", None]])
        self.assertEqual(out["fetches"], [["/host/a/shown", {"outcome": "ready", "version": 1}, "TOK"],
                                          ["/host/a/diag", {"entries": [{"k": "error", "m": "boom", "n": 1}], "dropped": 0, "version": 2}, "TOK"],
                                          ["/host/a/shown", {"outcome": "ready", "version": 2}, "TOK"],
                                          ["/api/a/storage.set", {"key": "k", "value": 1}, "TOK"]])
        self.assertEqual((out["threw"]["frames"], out["threw"]["shown"]), (1, "v3"))
        self.assertEqual(out["threw"]["status"], "v3 had an error while starting")
        self.assertEqual((out["blank"]["frames"], out["blank"]["shown"], out["blank"]["ver"]), (1, "v3", "3"))
        self.assertIn("v4 showed nothing (an error while starting); showing v3", out["blank"]["status"])
        self.assertIn("Show v4", out["blank"]["status"])
        self.assertIn("This page stopped responding", out["stalled"]["status"])  # the notice at 9 s...
        self.assertNotIn("3:stalled", out["stalled"]["posts"])  # ...the server only after 20 s
        self.assertEqual(out["reported"][-1], "3:stalled")
        self.assertEqual(out["recovered"]["posts"][-1], "3:threw")  # a beat: the record is what it was
        self.assertEqual(out["recovered"]["status"], "")
        self.assertEqual(out["recovered"]["body"], {"outcome": "threw", "recovered": True, "version": 3})
        self.assertEqual(out["grace"], [1, "v2 last words"])  # v2's held storage.set earlier, then its last words
        self.assertEqual(out["afterGrace"], out["grace"])
        self.assertEqual(out["blank"]["body"], {"outcome": "threw", "blank": True, "version": 4})


if __name__ == "__main__":
    unittest.main()
