"""The Desktop half's components in a real browser: plugin.js loaded as a module in headless Chrome on a small
React of the tests' own (function components with useState, useRef, useEffect and useLayoutEffect, rendered into
the real DOM; a node is kept by its place in the tree, so refs, focus and observers hold across renders; events
wired), the SDK stubbed (atoms, useValue, the English strings). Layout is inline styles on theme variables, so
what the tests measure is the plugin's own layout. Not a test module: the tests import it."""

import json
import shutil
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import _browser as B

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"

REACT = r"""
export const Fragment = Symbol('Fragment')
export const jsx = (type, props, key) => ({ type, props: props || {}, key })
export const jsxs = jsx
let cur = null, rootEl = null, rootFn = null, queued = false, seen = null, nodesSeen = null, effects = [], focusNew = []
const insts = new Map(), nodes = new Map()
const hook = () => [cur.hooks, cur.i++]
export function useState(v) {
  const [h, i] = hook()
  if (!(i in h)) h[i] = { v: typeof v === 'function' ? v() : v }
  const s = h[i]
  s.set = s.set || (n => { const nv = typeof n === 'function' ? n(s.v) : n; if (!Object.is(nv, s.v)) { s.v = nv; schedule() } })
  return [s.v, s.set]
}
export function useRef(v) { const [h, i] = hook(); if (!(i in h)) h[i] = { current: v === undefined ? null : v }; return h[i] }
const effectHook = layout => (fn, deps) => {
  const [h, i] = hook(), old = h[i]
  if (old && deps && old.deps && deps.length === old.deps.length && deps.every((d, k) => Object.is(d, old.deps[k]))) return
  h[i] = { deps, cleanup: old ? old.cleanup : null }
  effects.push({ s: h[i], fn, layout })
}
export const useEffect = effectHook(false), useLayoutEffect = effectHook(true)
export const memo = c => c
function schedule() { if (!queued) { queued = true; queueMicrotask(flush) } }
export function flush() { for (let n = 0; queued && n < 30; n++) { queued = false; renderAll() } }
export function mount(fn, el) { rootFn = fn; rootEl = el; queued = true; flush() }
export function unmount() { rootFn = () => null; queued = true; flush(); rootEl = null }
const UNITLESS = new Set(['flex', 'flexGrow', 'flexShrink', 'zIndex', 'opacity', 'fontWeight', 'lineHeight', 'order'])
const EV = { onFocus: 'focusin', onBlur: 'focusout', onDoubleClick: 'dblclick' }
// Only what changed is written: an attribute taken off and put back (tabindex) would drop the focus.
function setProps(n, props, svg) {
  const had = n.__attrs || [], now = []
  for (const [t, f] of n.__ev || []) n.removeEventListener(t, f)
  n.__ev = []
  n.removeAttribute('style')
  for (const [k, v] of Object.entries(props)) {
    if (k === 'children' || k === 'key' || k === 'ref' || k === 'autoFocus') continue
    if (k === 'style') { for (const [p, x] of Object.entries(v || {})) if (x != null && x !== false) n.style[p] = typeof x === 'number' && !UNITLESS.has(p) ? x + 'px' : String(x); continue }
    if (/^on[A-Z]/.test(k)) {
      if (typeof v !== 'function') continue
      const t = k === 'onChange' ? (n.type === 'checkbox' ? 'change' : 'input') : EV[k] || k.slice(2).toLowerCase()
      const f = e => { e.nativeEvent = e; v(e) }
      n.addEventListener(t, f); n.__ev.push([t, f]); continue
    }
    if (k === 'value' && 'value' in n && !svg) { if (n.value !== String(v ?? '')) n.value = v ?? ''; continue }
    if ((k === 'checked' || k === 'disabled') && !svg) { n[k] = Boolean(v); continue }
    if (v == null || v === false) continue
    const name = k === 'className' ? 'class' : k === 'tabIndex' ? 'tabindex' : k === 'htmlFor' ? 'for' : svg && k !== 'viewBox' ? k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) : k
    const val = v === true ? '' : String(v)
    if (n.getAttribute(name) !== val) n.setAttribute(name, val)
    now.push(name)
  }
  for (const a of had) if (!now.includes(a)) n.removeAttribute(a)
  n.__attrs = now
}
function place(parent, kids) {
  const want = new Set(kids)
  for (const c of [...parent.childNodes]) if (!want.has(c)) parent.removeChild(c)
  kids.forEach((k, i) => { if (parent.childNodes[i] !== k) parent.insertBefore(k, parent.childNodes[i] || null) })
}
function build(el, path, svg) {
  if (el == null || el === false || el === true) return []
  if (Array.isArray(el)) return el.flatMap((c, i) => build(c, path + '/' + (c && c.key != null ? 'k' + c.key : i), svg))
  if (typeof el !== 'object') {
    const p = path + '#t'; nodesSeen.add(p)
    let n = nodes.get(p)
    if (!n || n.nodeType !== 3) { n = document.createTextNode(''); nodes.set(p, n) }
    if (n.nodeValue !== String(el)) n.nodeValue = String(el)
    return [n]
  }
  const { type, props } = el
  if (type === Fragment) return build(props.children, path + '/f', svg)
  if (typeof type === 'function') {
    const p = path + ':' + (type.name || 'C')
    seen.add(p)
    let inst = insts.get(p)
    if (!inst) { inst = { hooks: [] }; insts.set(p, inst) }
    const prev = cur; cur = inst; inst.i = 0
    let out
    try { out = type(props) } finally { cur = prev }
    return build(out, p, svg)
  }
  const isSvg = svg || type === 'svg', p = path + '<' + type
  nodesSeen.add(p)
  let n = nodes.get(p), fresh = false
  if (!n || n.nodeType !== 1 || n.localName !== type) { n = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', type) : document.createElement(type); nodes.set(p, n); fresh = true }
  setProps(n, props, isSvg)
  place(n, build(props.children, p, isSvg))
  if (props.ref && typeof props.ref === 'object') props.ref.current = n
  else if (typeof props.ref === 'function') props.ref(n)
  if (fresh && props.autoFocus) focusNew.push(n)
  return [n]
}
function renderAll() {
  if (!rootEl) return
  seen = new Set(); nodesSeen = new Set(); focusNew = []
  place(rootEl, build(rootFn(), '', false))
  for (const [p, inst] of insts) if (!seen.has(p)) {
    insts.delete(p)
    for (const h of inst.hooks) if (h && h.cleanup) { try { h.cleanup() } catch (e) { console.error(e) } }
  }
  for (const p of [...nodes.keys()]) if (!nodesSeen.has(p)) nodes.delete(p)
  for (const n of focusNew) n.focus()
  const run = effects; effects = []
  for (const e of run.filter(e => e.layout).concat(run.filter(e => !e.layout))) {
    if (e.s.cleanup) { try { e.s.cleanup() } catch (x) { console.error(x) } }
    const c = e.fn()
    e.s.cleanup = typeof c === 'function' ? c : null
  }
}
export default { memo }
"""

SDK = r"""
import { useState, useEffect } from './react.mjs'
export const atom = v => { let x = v; const ls = new Set(); return { get: () => x, set: n => { x = n; [...ls].forEach(f => f(n)) }, listen: f => (ls.add(f), () => ls.delete(f)) } }
export const host = { state: { busy: atom(false), busyBySession: atom({}), focusedStoredSessionId: atom(null) }, request: async () => ({}), composer: { setDraft: async () => true }, navigate() {}, newChat() {} }
export const ROUTES_AREA = 'routes', SIDEBAR_NAV_AREA = 'nav', SIDEBAR_NAV_PREFS_AREA = 'prefs'
export const STATUSBAR_AREAS = { left: 'l', right: 'r' }
export const SandboxedFrame = () => null
export function useValue(a) {
  const [, tick] = useState(0)
  useEffect(() => a.listen(() => tick(n => n + 1)), [a])
  return a.get()
}
export const usePluginI18n = () => (k, ...a) => { const v = window.__STRINGS && window.__STRINGS[k]; return typeof v === 'function' ? v(...a) : v ?? k }
export default {}
"""

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
:root { --background:#1f1f1e; --foreground:#ecebe6; --ui-text-secondary:#c3c2bb; --ui-text-tertiary:#9a9993;
 --ui-stroke-secondary:#3a3936; --chrome-action-hover:rgba(255,255,255,.07); --font-sans: system-ui, "Segoe UI", sans-serif; }
html, body { margin: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
</style></head><body><div id="root"></div><script type="module">
import * as M from './plugin.mjs'
import * as R from './react.mjs'
window.__STRINGS = M.STRINGS.en
window.H = { M, R, jsx: R.jsx }
window.__ready = true
</script></body></html>"""


class Page:
    """plugin.js (with `exports` appended) served on a free port with the tests' React and SDK."""

    def __init__(self, exports: str):
        self.dir = Path(tempfile.mkdtemp(prefix="ha-dom-"))
        src = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
        src = (src.replace("from '@hermes/plugin-sdk'", "from './sdk.mjs'")
                  .replace("from 'react/jsx-runtime'", "from './react.mjs'").replace("from 'react'", "from './react.mjs'"))
        (self.dir / "plugin.mjs").write_text(src + exports, "utf-8")
        (self.dir / "react.mjs").write_text(REACT, "utf-8")
        (self.dir / "sdk.mjs").write_text(SDK, "utf-8")
        (self.dir / "index.html").write_text(PAGE, "utf-8")

        class Handler(SimpleHTTPRequestHandler):
            extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

            def log_message(self, *a):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(self.dir)))
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/index.html"

    def drive(self, body: str, timeout: int = 240) -> dict:
        """Runs `body` (as _browser.drive) once the page has loaded the plugin; `api.top` evaluates in the page."""
        head = (f"await api.go({json.dumps(self.url)}, 300);"
                "for (let i = 0; i < 100 && !(await api.top('Boolean(window.__ready)')); i++) await api.sleep(50);\n")
        return B.drive(head + body, timeout)

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        shutil.rmtree(self.dir, ignore_errors=True)


# The whole viewer as Hermes Desktop runs it, on a test host (_browser.Host) that serves the plugin's REST routes:
# plugin.js on the React above, SandboxedFrame a plain iframe (unsandboxed: the driver reaches only frames in the
# page's own process), ctx.rest a fetch to /api (api.handle), Hermes' toasts kept in window.__notes.
VIEWER_TOP = """<!doctype html><html><head><meta charset="utf-8"><style>
:root { --background:#1f1f1e; --foreground:#ecebe6; --ui-text-secondary:#c3c2bb; --ui-text-tertiary:#9a9993;
 --ui-stroke-secondary:#3a3936; --chrome-action-hover:rgba(255,255,255,.07); --font-sans: system-ui, "Segoe UI", sans-serif; }
html, body { margin: 0; height: 100%; background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
#root { position: relative; height: 100%; }</style></head><body><div id="root"></div><script type="module">
import * as M from './plugin.mjs'
import * as R from './react.mjs'
window.__STRINGS = M.STRINGS.en
const store = new Map()
const ctx = { storage: { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, register: () => () => {},
  rest: async (url, o = {}) => {
    const init = { method: o.method || (o.body ? 'POST' : 'GET') }
    if (o.body) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(o.body) }
    const r = await fetch('/api' + url, init), j = await r.json()
    if (!r.ok) throw new Error(j.detail || String(r.status))
    return j
  } }
window.H = { M, R, jsx: R.jsx, ctx }
window.__ready = true
</script></body></html>"""


def viewer_files(exports: str) -> dict:
    """The files a _browser.Host serves under /dom/ for VIEWER_TOP (``exports`` appended to plugin.js)."""
    src = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
    src = (src.replace("from '@hermes/plugin-sdk'", "from './sdk.mjs'")
              .replace("from 'react/jsx-runtime'", "from './react.mjs'").replace("from 'react'", "from './react.mjs'"))
    sdk = (SDK.replace("import { useState, useEffect } from './react.mjs'", "import { useState, useEffect, jsx } from './react.mjs'")
              .replace("export const SandboxedFrame = () => null",
                       "export const SandboxedFrame = p => jsx('iframe', { ref: p.ref, src: p.src, title: p.title, style: p.style })")
              .replace("composer: {", "notify: n => (window.__notes = window.__notes || []).push(n.message), composer: {"))
    return {"plugin.mjs": src + exports, "react.mjs": REACT, "sdk.mjs": sdk, "index.html": VIEWER_TOP}
