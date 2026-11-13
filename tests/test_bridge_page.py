"""The bridge's page side of the desktop package: the "ready" signal (once per load, at load + two frames or,
for a runtime that set window.__hermesDefer, at kit.ready(); {threw: true} after an uncaught error or
rejection), the page's errors as "diag" (dedupe, 20 distinct + dropped, 1 s debounce, flushed at ready and
on pagehide, "at" only where it is the version's own file and line), the "alive" heartbeat (only for a host
whose port message says v >= 3), early messages kept until the port arrives, and the degraded mode (no
port: calls fail fast, the runtime says so once). bridge.js and kit.js run here in Node on a stub page with
fake timers. Also: every type runtime but doc defers its ready and says when it rendered, and the server
maps a page's document lines back to its file. Skipped without node.
"""

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "plugin" / "hermes_artifacts"
TYPES = PKG / "types"
NODE = shutil.which("node")

RUN = r"""
const fs = require('fs'), vm = require('vm')
const BRIDGE = fs.readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n')
const KIT = fs.readFileSync(process.argv[3], 'utf8').replace(/\r\n/g, '\n')
const K = BRIDGE.split('\n').length - 1 // the lines the injected bridge adds to the document
const HEAD = 3 // the document line the bridge's <script> starts on (just after <head>)

function target() {
  const ls = {}
  return {
    addEventListener(n, fn) { (ls[n] = ls[n] || []).push(fn) },
    removeEventListener(n, fn) { ls[n] = (ls[n] || []).filter(f => f !== fn) },
    _fire(n, ev) { (ls[n] || []).slice().forEach(fn => fn(ev)) },
    _count(n) { return (ls[n] || []).length }
  }
}
function el(tag) {
  const attrs = {}
  return { tagName: tag.toUpperCase(), nodeType: 1, style: {}, children: [], textContent: '',
    setAttribute(k, v) { attrs[k] = String(v) }, getAttribute(k) { return k in attrs ? attrs[k] : null },
    hasAttribute(k) { return k in attrs }, removeAttribute(k) { delete attrs[k] },
    appendChild(c) { this.children.push(c); return c }, remove() { this.removed = true },
    addEventListener() {} }
}

// One page load: a fresh global world, the bridge run as the document's first <head> script.
function page(o) {
  o = o || {}
  let now = 0, timers = [], tid = 0
  const sb = {}
  sb.window = sb
  Object.assign(sb, target())
  const doc = Object.assign(target(), {
    readyState: 'loading', images: [], fonts: { ready: Promise.resolve() },
    currentScript: { text: BRIDGE }, elements: o.elements || {}, toasts: [],
    body: Object.assign(el('body'), { innerText: o.text === undefined ? 'Hello' : o.text, getElementsByTagName: () => o.bodyEls || [] }),
    documentElement: Object.assign(el('html'), { style: { setProperty() {} } }),
    getElementById(id) { return this.elements[id] || null },
    querySelector(s) { return s === '.kit-toast' ? this.toasts[this.toasts.length - 1] && !this.toasts[this.toasts.length - 1].removed ? this.toasts[this.toasts.length - 1] : null : null },
    querySelectorAll() { return [] },
    createElement(t) { const e = el(t); if (t === 'div') doc.toasts.push(e); return e }
  })
  sb.document = doc
  sb.location = { href: o.url || 'data:text/html;base64,PGh0bWw+' }
  const hello = []
  sb.parent = o.alone ? sb : { postMessage(m) { hello.push(m) } }
  const logged = []
  sb.console = { error: (...a) => logged.push(a.map(String).join(' ')), log: console.log }
  sb.setTimeout = (fn, ms) => { timers.push({ id: ++tid, at: now + (ms || 0), fn }); return tid }
  sb.clearTimeout = id => { timers = timers.filter(t => t.id !== id) }
  sb.setInterval = (fn, ms) => { const t = { id: ++tid, at: now + ms, fn, every: ms }; timers.push(t); return tid }
  sb.clearInterval = sb.clearTimeout
  sb.requestAnimationFrame = fn => sb.setTimeout(fn, 16)
  sb.performance = { now: () => now }
  sb.Promise = Promise; sb.Error = Error; sb.JSON = JSON; sb.Map = Map; sb.WeakSet = WeakSet; sb.Object = Object
  sb.Math = Math; sb.String = String; sb.Number = Number; sb.Array = Array; sb.RegExp = RegExp; sb.Date = Date
  sb.decodeURIComponent = decodeURIComponent
  vm.createContext(sb)
  const docUrl = sb.location.href.split('#')[0]
  vm.runInContext(BRIDGE, sb, { filename: docUrl, lineOffset: HEAD - 1 })
  const posted = []
  const port = { postMessage(m) { posted.push(JSON.parse(JSON.stringify(m))) }, onmessage: null }
  const P = {
    sb, doc, hello, posted, logged, port, docUrl,
    get now() { return now },
    async tick(ms) {
      const end = now + ms
      for (;;) {
        await new Promise(r => setImmediate(r))
        timers.sort((a, b) => a.at - b.at || a.id - b.id)
        const t = timers[0]
        if (!t || t.at > end) break
        now = t.at
        if (t.every) t.at += t.every; else timers.shift()
        t.fn()
      }
      now = end
      await new Promise(r => setImmediate(r))
    },
    connect(v) { sb._fire('message', { source: sb.parent, data: { __hermes_bridge: 1, kind: 'port', v }, ports: [port] }) },
    dcl() { doc.readyState = 'interactive'; doc._fire('DOMContentLoaded', {}) },
    load() { doc.readyState = 'complete'; sb._fire('load', {}) },
    // A page script error on the document's line n of the page's own file (the browser reports n + K).
    thrown(msg, fileLine, col) {
      const line = fileLine >= HEAD ? fileLine + K : fileLine
      const err = new Error(msg)
      err.stack = 'Error: ' + msg + '\n    at f (' + docUrl + ':' + line + ':' + col + ')\n    at ' + docUrl + ':' + (line + 1) + ':3'
      sb._fire('error', { target: sb, message: 'Uncaught Error: ' + msg, filename: docUrl, lineno: line, colno: col, error: err })
      return err
    },
    events(name) { return posted.filter(m => m.event === name) },
    run(code) { return vm.runInContext(code, sb) }
  }
  return P
}
const out = {}
const ready = P => P.events('ready').map(m => m.detail.threw)

;(async () => {
  // --- ready, the default: load + two frames, once ------------------------------------------------
  let P = page()
  out.helloV = P.hello[0] && P.hello[0].v
  P.connect(3); P.dcl(); await P.tick(100)
  out.defaultBeforeLoad = ready(P)
  P.load(); await P.tick(20); out.defaultOneFrame = ready(P)
  await P.tick(40); out.defaultAfter = ready(P)
  out.defaultT = P.events('ready')[0].detail.t
  P.run('hermes.ready()'); await P.tick(3000); out.defaultOnce = ready(P)

  // --- deferred: kit.ready() decides; once; ignored when not deferred --------------------------------
  P = page(); P.run('window.__hermesDefer = true'); P.connect(2); P.dcl(); P.load(); await P.tick(3000)
  out.deferredAtLoad = ready(P)
  P.run('hermes.ready()'); await P.tick(100); out.deferredAsked = ready(P)
  P.run('hermes.ready(); hermes.ready()'); await P.tick(3000); out.deferredOnce = ready(P)
  out.aliveWithV2 = P.events('alive').length

  // kit.ready() forwards it (fonts, pictures or 1.5 s, then the bridge's frames)
  P = page({ elements: {} }); P.run('window.__hermesDefer = true'); P.connect(3); P.dcl()
  vm.runInContext(KIT, P.sb); P.load(); await P.tick(2000)
  out.kitBeforeReady = ready(P)
  P.run('kit.ready(); kit.ready()'); await P.tick(3000); out.kitReady = ready(P)

  // --- threw ---------------------------------------------------------------------------------------
  P = page(); P.connect(3); P.dcl(); P.thrown('boom', 12, 5); P.load(); await P.tick(100)
  out.threwDefault = ready(P)
  P = page(); P.run('window.__hermesDefer = true'); P.connect(3); P.dcl(); P.load(); await P.tick(100)
  P.sb._fire('unhandledrejection', { reason: new Error('async boot failed') }); await P.tick(500)
  out.threwDeferredSoon = ready(P); await P.tick(800); out.threwDeferred = ready(P)
  P.run('hermes.ready()'); await P.tick(2000); out.threwDeferredOnce = ready(P)
  P = page(); P.connect(3); P.dcl(); P.load(); await P.tick(100); P.thrown('later', 20, 1); await P.tick(2000)
  out.errorAfterReady = ready(P)

  // --- early messages wait for the port: errors first, then ready -------------------------------
  P = page({ elements: { 'hermes-lines': { textContent: JSON.stringify({ f: 'index.html', m: [[1, 1, 1000]] }) } } })
  P.dcl(); P.thrown('early', 10, 2); P.load(); await P.tick(3000)
  out.beforePort = P.posted.length
  P.connect(3)
  out.order = P.posted.map(m => m.event).filter(e => e !== 'alive')
  out.earlyEntry = P.posted[0].detail.entries[0]

  // --- each kind, with its fields ----------------------------------------------------------------
  P = page(); P.connect(3); P.dcl(); P.load(); await P.tick(100); P.posted.length = 0
  P.thrown('x is not defined', 12, 5)
  const img = el('img'); img.src = 'data:image/png;base64,' + 'A'.repeat(400)
  P.sb._fire('error', { target: img })
  const scr = el('script'); scr.src = 'https://cdn.example.com/lib.js'
  P.sb._fire('error', { target: scr })
  const rej = new Error('nope'); rej.stack = 'Error: nope\n    at g (' + P.docUrl + ':' + (30 + K) + ':9)'
  P.sb._fire('unhandledrejection', { reason: rej })
  P.sb._fire('unhandledrejection', { reason: 'plain string' })
  P.run('console.error("bad thing", 42)')
  P.doc._fire('securitypolicyviolation', { effectiveDirective: 'img-src', blockedURI: 'https://evil.example/x.png', sourceFile: P.docUrl, lineNumber: 40 + K, columnNumber: 3 })
  await P.tick(1100)
  const d = P.events('diag')
  out.kinds = d.length === 1 ? d[0].detail.entries : d.map(x => x.detail)
  out.consoleStillLogged = P.logged

  // the bridge's own lines, and a thrown value logged again, are not counted twice
  P = page(); P.connect(3); P.dcl(); P.load(); await P.tick(100); P.posted.length = 0
  const twice = P.thrown('once', 15, 1)
  P.sb.console.error('caught:', twice)
  await P.tick(1100)
  out.loggedTwice = P.events('diag').map(x => x.detail.entries.map(e => e.k))

  // --- dedupe, cap and dropped; debounce; flush on pagehide -----------------------------------------
  P = page(); P.connect(3); P.dcl(); P.load(); await P.tick(100); P.posted.length = 0
  for (let i = 0; i < 5; i++) P.thrown('same', 12, 5)
  for (let i = 0; i < 25; i++) P.thrown('distinct ' + i, 50 + i, 1)
  await P.tick(900); out.debounced = P.events('diag').length
  await P.tick(200)
  const dd = P.events('diag')[0].detail
  out.cap = { entries: dd.entries.length, dropped: dd.dropped, sameN: dd.entries[0].n }
  P.thrown('same', 12, 5); P.thrown('same', 12, 5)
  P.sb._fire('pagehide', {})
  const last = P.events('diag').slice(-1)[0].detail
  out.pagehideFlush = { entries: last.entries.map(e => [e.m, e.n]), dropped: last.dropped }

  // --- alive: every 2 s for a v3 host, stops on pagehide --------------------------------------------
  P = page(); P.connect(3); await P.tick(6100)
  out.alive = P.events('alive').length
  P.sb._fire('pagehide', {}); await P.tick(10000); out.aliveAfterHide = P.events('alive').length
  P = page(); P.connect(1); await P.tick(6100); out.aliveOldHost = P.events('alive').length

  // --- degraded: no port ---------------------------------------------------------------------------
  P = page(); P.dcl(); P.load()
  vm.runInContext(KIT, P.sb); P.run('kit.degraded("No host")')
  const res = {}
  P.run('hermes.storage.get("a")').then(() => { res.first = 'resolved' }, e => { res.first = [P.now, e.message, !!e.__hermesOffline] })
  await P.tick(9000); out.pendingAt9s = res.first || null
  await P.tick(1100); out.firstCall = res.first
  P.run('hermes.storage.get("b")').then(null, e => { res.second = P.now })
  const t0 = P.now; await P.tick(0); out.secondFast = res.second === t0
  out.notice = P.doc.toasts.map(t => t.textContent)
  // a page that does not catch it: the bridge's own "unavailable" is not the page's error
  let offErr; P.run('hermes.ask("x")').catch(e => { offErr = e }); await P.tick(10)
  P.sb._fire('unhandledrejection', { reason: offErr }); P.sb.console.error(offErr)
  P.connect(3); await P.tick(1100)
  out.offlineNotCounted = P.events('diag').map(x => x.detail.entries.map(e => e.m))
  P = page({ alone: true }); const r2 = {}
  P.run('hermes.storage.get("a")').then(null, () => { r2.at = P.now }); await P.tick(0)
  out.alone = { hello: P.hello.length, rejectedAt: r2.at }

  // --- "at": where it is true, and nowhere else ---------------------------------------------------------
  // Hermes Desktop: one document; the server's map says which lines are index.html's own.
  P = page({ elements: { 'hermes-lines': { textContent: JSON.stringify({ f: 'index.html', m: [[1, 1, 10], [21, 11, 100]] }) } } })
  P.connect(3); P.dcl(); P.load(); await P.tick(100); P.posted.length = 0
  P.thrown('mapped', 25, 4)      // the document's own line 25 (pre-bridge) is index.html:15
  P.thrown('inlined', 15, 4)     // a line the bundler wrote: no file
  P.thrown('first block', 5, 7)
  await P.tick(1100)
  out.mapped = P.events('diag')[0].detail.entries.map(e => [e.m, e.at || null, e.stack ? e.stack[0] : null])
  // a type runtime's document: its lines are no file of the version
  P = page({ elements: { 'hermes-artifact-content': { textContent: '{}' } } })
  P.connect(3); P.dcl(); P.load(); await P.tick(100); P.posted.length = 0
  P.thrown('runtime', 25, 4)
  P.run('window.__hermesEval = { "modules/": { lines: 2 }, "dash-page/": { strip: true, lines: 2 } }')
  const ev1 = new Error('in a module'); ev1.stack = 'Error: in a module\n    at eval (modules/scene.js:7:12)\n    at x (' + P.docUrl + ':900:1)'
  P.sb._fire('error', { target: P.sb, message: 'Uncaught Error: in a module', filename: 'modules/scene.js', lineno: 7, colno: 12, error: ev1 })
  const ev2 = new Error('in a dash file'); ev2.stack = 'Error: in a dash file\n    at eval (dash-page/app.js:3:5)'
  P.sb._fire('error', { target: P.sb, message: 'Uncaught Error: in a dash file', filename: 'dash-page/app.js', lineno: 3, colno: 5, error: ev2 })
  const ev3 = new Error('dash inline'); ev3.stack = 'Error: dash inline\n    at eval (dash-inline/index.html:9:5)'
  P.sb._fire('error', { target: P.sb, message: 'Uncaught Error: dash inline', filename: 'dash-inline/index.html', lineno: 9, colno: 5, error: ev3 })
  await P.tick(1100)
  out.typed = P.events('diag')[0].detail.entries.map(e => [e.m, e.at || null])
  // the browser viewer: the version's files by URL
  const base = 'http://127.0.0.1:8765/c/abc/v7/'
  P = page({ url: base + 'index.html#t=1' }); P.connect(3); P.dcl(); P.load(); await P.tick(100); P.posted.length = 0
  P.thrown('inline in the page', 30, 2)
  const ex = new Error('in app.js'); ex.stack = 'Error: in app.js\n    at h (' + base + 'js/app.js:3:1)'
  P.sb._fire('error', { target: P.sb, message: 'Uncaught Error: in app.js', filename: base + 'js/app.js', lineno: 3, colno: 1, error: ex })
  const cdn = new Error('in a library'); cdn.stack = 'Error: in a library\n    at q (https://cdn.example.com/lib.js:1:999)\n    at h (' + base + 'js/app.js:8:2)'
  P.sb._fire('error', { target: P.sb, message: 'Uncaught Error: in a library', filename: 'https://cdn.example.com/lib.js', lineno: 1, colno: 999, error: cdn })
  await P.tick(1100)
  out.browser = P.events('diag')[0].detail.entries.map(e => [e.m, e.at || null])
  // no data: URL (the whole document) ever goes out in a stack
  out.noDataUrl = !JSON.stringify(out.kinds).includes('base64,AAAA') && !JSON.stringify(out.mapped).includes('PGh0bWw')

  // --- a picture that never loads does not hold ready: DOMContentLoaded + 2 s ------------------------
  P = page(); P.connect(3); P.dcl(); await P.tick(1900); out.slowBefore = ready(P)
  await P.tick(200); out.slowReady = ready(P); out.slowT = P.events('ready').map(m => m.detail.t)
  P.load(); await P.tick(3000); out.slowOnce = ready(P)

  // --- blank: nothing a user could see when ready is sent ------------------------------------------------
  const box = (tag, w, h) => ({ tagName: tag.toUpperCase(), offsetWidth: w, offsetHeight: h, hasAttribute: () => false })
  const blankOf = async (o) => { const Q = page(o); Q.connect(3); Q.dcl(); Q.load(); await Q.tick(100); return Q.events('ready').map(m => m.detail.blank) }
  out.blank = {
    text: await blankOf({}),
    nothing: await blankOf({ text: '' }),
    onlyScripts: await blankOf({ text: '  ', bodyEls: [box('script', 0, 0), box('style', 0, 0), box('div', 0, 0), box('div', 500, 0)] }),
    canvas: await blankOf({ text: '', bodyEls: [box('div', 0, 0), box('canvas', 300, 150)] }),
    svg: await blankOf({ text: '', bodyEls: [{ tagName: 'svg', hasAttribute: () => false, getBoundingClientRect: () => ({ width: 20, height: 20 }) }] }),
    scanCap: await blankOf({ text: '', bodyEls: Array.from({ length: 401 }, () => box('div', 0, 0)) }),
  }
  P = page({ text: '' }); P.run('window.__hermesDefer = true'); P.connect(3); P.dcl(); P.load(); await P.tick(100)
  P.doc.body.innerText = 'rendered later'; P.run('hermes.ready()'); await P.tick(100)
  out.blankDeferred = P.events('ready').map(m => m.detail.blank)

  // --- ResizeObserver loop notices and empty cross-origin errors ----------------------------------------
  P = page(); P.connect(3); P.dcl(); await P.tick(10)
  for (let i = 0; i < 200; i++) {
    P.sb._fire('error', { target: P.sb, message: 'ResizeObserver loop completed with undelivered notifications.', filename: '', lineno: 0, colno: 0, error: null })
    P.sb._fire('error', { target: P.sb, message: 'ResizeObserver loop limit exceeded', filename: '', lineno: 0, colno: 0, error: null })
    await P.tick(16)
  }
  P.sb.console.error('ResizeObserver loop completed with undelivered notifications.')
  P.load(); await P.tick(5000)
  out.roLoop = { ready: ready(P), diag: P.events('diag').length }
  P = page(); P.connect(3); P.dcl()
  for (let i = 0; i < 3; i++) P.sb._fire('error', { target: P.sb, message: 'Script error.', filename: '', lineno: 0, colno: 0, error: null })
  P.load(); await P.tick(3000)
  out.scriptError = { ready: ready(P), entries: P.events('diag').map(x => x.detail.entries.map(e => [e.k, e.n])) }

  // --- the damper: the same error in a loop for 2 minutes is not a post every second ---------------------
  P = page(); P.connect(3); P.dcl(); P.load(); await P.tick(100); P.posted.length = 0
  let fired = 0
  for (let s = 0; s < 1200; s++) { P.thrown('hot loop', 12, 5); fired++; await P.tick(100) }
  const during = P.events('diag').length
  P.sb._fire('pagehide', {})
  const all = P.events('diag')
  out.damper = { during, total: all.reduce((a, x) => a + x.detail.entries.reduce((b, e) => b + e.n, 0), 0), fired }
  // a loop that stops: its held-back count still goes out when its 30 s are up
  P = page(); P.connect(3); P.dcl(); P.load(); await P.tick(100); P.posted.length = 0
  for (let s = 0; s < 50; s++) { P.thrown('short loop', 12, 5); await P.tick(100) }
  await P.tick(40000)
  out.damperTail = P.events('diag').reduce((a, x) => a + x.detail.entries.reduce((b, e) => b + e.n, 0), 0)

  console.log(JSON.stringify(out))
})().catch(e => { console.error(e && e.stack || e); process.exit(1) })
"""


@unittest.skipIf(NODE is None, "node not installed")
class BridgePageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        d = Path(tempfile.mkdtemp(prefix="ha-bridge-"))
        try:
            (d / "run.js").write_text(RUN, "utf-8")
            r = subprocess.run([NODE, "run.js", str(PKG / "assets" / "bridge.js"), str(TYPES / "_kit" / "kit.js")],
                               cwd=d, capture_output=True, text=True, encoding="utf-8", timeout=120)
        finally:
            shutil.rmtree(d, ignore_errors=True)
        if r.returncode != 0:
            raise AssertionError("node failed:\n" + r.stderr[-4000:])
        cls.out = json.loads(r.stdout.strip().splitlines()[-1])

    def test_hello_names_protocol_3(self):
        self.assertEqual(self.out["helloV"], 3)

    def test_ready_by_default_at_load_plus_two_frames_once(self):
        o = self.out
        self.assertEqual(o["defaultBeforeLoad"], [])
        self.assertEqual(o["defaultOneFrame"], [])
        self.assertEqual(o["defaultAfter"], [False])
        self.assertIsInstance(o["defaultT"], int)
        self.assertEqual(o["defaultOnce"], [False])  # hermes.ready() of a page that did not defer: nothing

    def test_a_deferred_runtime_says_ready_itself_once(self):
        o = self.out
        self.assertEqual(o["deferredAtLoad"], [])
        self.assertEqual(o["deferredAsked"], [False])
        self.assertEqual(o["deferredOnce"], [False])
        self.assertEqual(o["kitBeforeReady"], [])
        self.assertEqual(o["kitReady"], [False])

    def test_threw(self):
        o = self.out
        self.assertEqual(o["threwDefault"], [True])
        self.assertEqual(o["threwDeferredSoon"], [])  # 1 s after the error, not at once
        self.assertEqual(o["threwDeferred"], [True])  # not waiting for a kit.ready() that may never come
        self.assertEqual(o["threwDeferredOnce"], [True])
        self.assertEqual(o["errorAfterReady"], [False])

    def test_early_messages_wait_for_the_port(self):
        o = self.out
        self.assertEqual(o["beforePort"], 0)
        self.assertEqual(o["order"], ["diag", "ready"])
        self.assertEqual(o["earlyEntry"]["at"], "index.html:10:2")  # the page's own line 10, past the bridge's lines

    def test_each_kind_with_its_fields(self):
        k = {e["k"] + ":" + e["m"][:22]: e for e in self.out["kinds"]}
        err = k["error:Uncaught Error: x is n"]
        self.assertEqual(err["n"], 1)
        self.assertNotIn("at", err)  # a data: document with no line map (not a page the server mapped)
        self.assertTrue(err["stack"][0].startswith("at f ((document):"), err["stack"])
        img = [e for e in self.out["kinds"] if e["k"] == "resource" and e["tag"] == "img"][0]
        self.assertEqual(img["url"], "data:image/png,…")
        self.assertTrue(img["m"].startswith("img failed to load"))
        scr = [e for e in self.out["kinds"] if e["k"] == "resource" and e["tag"] == "script"][0]
        self.assertEqual(scr["url"], "https://cdn.example.com/lib.js")
        rej = [e for e in self.out["kinds"] if e["k"] == "rejection"]
        self.assertEqual(sorted(e["m"] for e in rej), ["Unhandled rejection: Error: nope", 'Unhandled rejection: plain string'])
        con = [e for e in self.out["kinds"] if e["k"] == "console"][0]
        self.assertEqual(con["m"], "bad thing 42")
        csp = [e for e in self.out["kinds"] if e["k"] == "csp"][0]
        self.assertEqual((csp["m"], csp["url"]), ("img-src blocked https://evil.example/x.png", "https://evil.example/x.png"))
        self.assertEqual(self.out["consoleStillLogged"], ["bad thing 42"])
        self.assertTrue(self.out["noDataUrl"])
        for e in self.out["kinds"]:
            self.assertLessEqual(set(e), {"k", "m", "at", "n", "stack", "tag", "url"})

    def test_a_thrown_value_logged_again_counts_once(self):
        self.assertEqual(self.out["loggedTwice"], [["error"]])

    def test_dedupe_cap_debounce_and_pagehide(self):
        o = self.out
        self.assertEqual(o["debounced"], 0)
        self.assertEqual(o["cap"], {"entries": 20, "dropped": 6, "sameN": 5})
        self.assertEqual(o["pagehideFlush"], {"entries": [["Uncaught Error: same", 2]], "dropped": 0})

    def test_alive(self):
        self.assertEqual(self.out["alive"], 4)  # one on connect, then every 2 s
        self.assertEqual(self.out["aliveAfterHide"], 4)
        self.assertEqual(self.out["aliveOldHost"], 0)
        self.assertEqual(self.out["aliveWithV2"], 0)

    def test_degraded_mode(self):
        o = self.out
        self.assertIsNone(o["pendingAt9s"])
        self.assertEqual(o["firstCall"], [10000, "hermes bridge unavailable", True])
        self.assertTrue(o["secondFast"])
        self.assertEqual(o["notice"], ["No host"])
        self.assertEqual(o["offlineNotCounted"], [])
        self.assertEqual(o["alone"], {"hello": 0, "rejectedAt": 0})

    def test_at_only_where_it_is_true(self):
        self.assertEqual(self.out["mapped"], [
            ["Uncaught Error: mapped", "index.html:15:4", "at f (index.html:15:4)"],
            ["Uncaught Error: inlined", None, "at f ((document):%d:4)" % (15 + self._k())],
            ["Uncaught Error: first block", "index.html:5:7", "at f (index.html:5:7)"]])
        self.assertEqual(self.out["typed"], [
            ["Uncaught Error: runtime", None],
            ["Uncaught Error: in a module", "modules/scene.js:5:12"],
            ["Uncaught Error: in a dash file", "app.js:1"],
            ["Uncaught Error: dash inline", None]])
        self.assertEqual(self.out["browser"], [
            ["Uncaught Error: inline in the page", "index.html:30:2"],
            ["Uncaught Error: in app.js", "js/app.js:3:1"],
            ["Uncaught Error: in a library", "js/app.js:8:2"]])  # the first frame in the version's files

    def test_a_slow_picture_does_not_hold_ready(self):
        o = self.out
        self.assertEqual(o["slowBefore"], [])
        self.assertEqual(o["slowReady"], [False])  # DOMContentLoaded + 2 s + two frames, with no load at all
        self.assertEqual(o["slowT"], [2032])
        self.assertEqual(o["slowOnce"], [False])

    def test_blank(self):
        self.assertEqual(self.out["blank"], {"text": [False], "nothing": [True], "onlyScripts": [True], "canvas": [False],
                                             "svg": [False], "scanCap": [False]})
        self.assertEqual(self.out["blankDeferred"], [False])  # measured when the runtime says it rendered

    def test_resize_observer_loops_and_empty_script_errors_are_no_failure(self):
        self.assertEqual(self.out["roLoop"], {"ready": [False], "diag": 0})
        self.assertEqual(self.out["scriptError"], {"ready": [False], "entries": [[["console", 3]]]})

    def test_a_hot_loop_is_damped(self):
        d = self.out["damper"]
        self.assertLessEqual(d["during"], 7)  # 3 at once, then one per 30 s over 2 minutes
        self.assertEqual(d["total"], d["fired"])  # nothing lost: the pagehide flush sends the rest
        self.assertEqual(self.out["damperTail"], 50)

    @staticmethod
    def _k():
        return (PKG / "assets" / "bridge.js").read_text("utf-8").count("\n")


class RuntimeWiringTests(unittest.TestCase):
    # file -> how many kit.ready() calls it has (each path that ends a first render; the bridge sends one)
    WIRED = {"sheet/sheet.js": 1, "board/board.js": 3, "slides/slides.js": 3, "dashboard/dashboard.js": 2,
             "design/design.js": 4, "design-system/ds-page.js": 2, "model/model.js": 3, "motion/motion.js": 2,
             "doc/doc.js": 1}

    def test_every_async_runtime_defers_and_says_when_it_rendered(self):
        for rel, n in self.WIRED.items():
            src = (TYPES / rel).read_text("utf-8").replace("\r\n", "\n")
            head = src[:src.index('"use strict";') + 200]
            self.assertIn("window.__hermesDefer = true;", head, rel)  # first statement: before load, synchronously
            self.assertEqual(src.count("kit.ready();"), n, rel)
            self.assertIn("kit.degraded(T.noHost);", src, rel)
            self.assertEqual(len(re.findall(r"\bnoHost: \"", src)), 2, rel)  # en and hu

    def test_the_model_is_ready_after_its_first_build_not_before(self):
        src = (TYPES / "model" / "model.js").read_text("utf-8")
        self.assertNotIn("render: render\n  };\n  kit.ready();", src.replace("\r\n", "\n"))
        self.assertIn("building = false; firstShown();", src)

    def test_doc_is_ready_once_also_when_its_first_render_throws(self):
        src = (TYPES / "doc" / "doc.js").read_text("utf-8").replace("\r\n", "\n")
        self.assertIn("  try {\n    render();\n    titleEl.textContent = title();\n    if (live) pull(true);\n"
                      "  } finally {\n    kit.ready();\n  }\n})();", src)

    def test_kit_ready_forwards_to_the_bridge(self):
        kit = (TYPES / "_kit" / "kit.js").read_text("utf-8")
        self.assertIn("window.hermes.ready();", kit)
        bridge = (PKG / "assets" / "bridge.js").read_text("utf-8")
        self.assertIn("ready: hermesReady", bridge)
        self.assertTrue(all(ord(c) < 128 for c in bridge), "bridge.js: non-ASCII written as escapes")


class LineMapTests(unittest.TestCase):
    def test_unchanged_page(self):
        import sys
        sys.path.insert(0, str(ROOT / "plugin"))
        from hermes_artifacts.render import line_map
        self.assertEqual(line_map("index.html", "a\nb\nc", "a\nb\nc"),
                         '<script type="application/json" id="hermes-lines">{"f":"index.html","m":[[1,1,3]]}</script>')
        m = json.loads(re.search(r">(.*)<", line_map("p/x.html", "a\n<script src=s.js></script>\nb\nc",
                                                     "a\n<script>1\n2\n3</script>\nb\nc")).group(1))
        self.assertEqual(m, {"f": "p/x.html", "m": [[1, 1, 1], [5, 3, 2]]})
        self.assertNotIn("\n", line_map("index.html", "a<", "b\n<"))  # it moves no line, and never ends a script early
        self.assertNotIn("</script><", line_map("x</script>.html", "a", "a")[:-9])

    BROKEN = ("<!doctype html>\n<html><head><meta charset=utf-8><title>Broken</title>\n"
              "<style>body{font:16px system-ui;margin:40px}</style>\n</head><body>\n<h1>Deliberately broken</h1>\n"
              "<img src=\"missing.png\" alt=\"missing\">\n<script>\nconsole.log(\"start\");\nfunction boom() {\n"
              "  return undefinedThing.x;\n}\nsetTimeout(boom, 50);\nPromise.reject(new Error(\"nobody caught me\"));\n"
              "console.error(\"logged by the page\", 42);\n</script>\n<script src=\"app.js\"></script>\n"
              "<script>notDefinedAtTop();</script>\n</body></html>\n")
    APP = "// app.js\nfunction helper() {\n  throw new Error(\"thrown in app.js\");\n}\n" \
          "window.addEventListener(\"load\", function () { helper(); });\n"

    def _render(self, thumb=False):
        import sys
        sys.path.insert(0, str(ROOT / "plugin"))
        from hermes_artifacts import render
        d = Path(tempfile.mkdtemp(prefix="ha-lines-")) / "v1"
        d.mkdir()
        (d / "index.html").write_text(self.BROKEN, "utf-8")
        (d / "app.js").write_text(self.APP, "utf-8")
        try:
            return render.render({"type": "page"}, d, thumb=thumb)
        finally:
            shutil.rmtree(d.parent, ignore_errors=True)

    def test_the_broken_page_maps_each_error_line_to_its_own(self):
        html = self._render()
        m = json.loads(re.search(r'id="hermes-lines">(.*)</script>$', html).group(1))
        doc = html[:html.index('<script type="application/json" id="hermes-lines">')].split("\n")
        src = self.BROKEN.split("\n")

        def file_line(doc_line):
            for d, s, n in m["m"]:
                if d <= doc_line < d + n:
                    return s + doc_line - d
            return None
        for line in (10, 13, 14, 17):  # the timer error, the rejection, console.error, the top-level error
            at = [i + 1 for i, t in enumerate(doc) if t == src[line - 1]]
            self.assertEqual(len(at), 1, line)
            self.assertEqual(file_line(at[0]), line)
        inlined = [i + 1 for i, t in enumerate(doc) if "thrown in app.js" in t][0]
        self.assertIsNone(file_line(inlined))  # a line the bundler wrote names no file

    def test_no_map_on_a_card_and_large_pages_are_fast(self):
        self.assertNotIn("hermes-lines", self._render(thumb=True))
        import sys, time
        sys.path.insert(0, str(ROOT / "plugin"))
        from hermes_artifacts.render import line_map
        raw = ["<!doctype html>", '<script src="app.js"></script>']
        for i in range(4750):  # 19,000 lines, the largest the review measured (98 s with difflib)
            raw += ["<div>", "  <span>item %d</span>" % i, "</div>", ""]
        html = list(raw)
        html[1:2] = ["<script>x();"] + ["  x();"] * 300 + ["</script>"]
        t = time.perf_counter()
        m = json.loads(re.search(r">(.*)<", line_map("index.html", "\n".join(raw), "\n".join(html))).group(1))
        self.assertLess(time.perf_counter() - t, 1.0)  # was minutes with difflib
        self.assertEqual(sum(n for _, _, n in m["m"]), len(raw) - 1)


if __name__ == "__main__":
    unittest.main()
