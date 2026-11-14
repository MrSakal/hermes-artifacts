"""Headless Chrome for the tests of the in-frame pages: a small host serves a type runtime as Hermes Desktop
does (the page from the api's html route, its ops through api.handle on a temporary store) and node drives it
over the DevTools protocol (Node 22's WebSocket). The host page hands the frame its port (protocol 3), keeps
every op the page sent (window.__ops) and every event (window.__events), and can send it host events
(window.__post(event, detail)). Not a test module: the tests import it. Skipped where Chrome or node is missing."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qsl

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "plugin"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

NODE = shutil.which("node")


def find_chrome():
    env = os.environ.get("CHROME")
    if env and Path(env).is_file():
        return env
    for n in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        p = shutil.which(n)
        if p:
            return p
    for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
        if Path(p).is_file():
            return p
    return None


CHROME = find_chrome()
AVAILABLE = bool(CHROME and NODE)

HOST = """<!doctype html><html><head><meta charset="utf-8"><title>host</title>
<style>html,body{margin:0;height:100%;background:#202020}iframe{border:0;width:100%;height:100%;display:block}</style></head>
<body><iframe id="f" src="/frame/AID?QS"></iframe><script>
window.__ops = []; window.__events = []; var port = null, THEME = THEMEJSON;
window.addEventListener("message", function (e) {
  var d = e.data;
  if (!d || d.__hermes_bridge !== 1 || d.kind !== "hello") return;
  var ch = new MessageChannel(); port = ch.port1;
  port.onmessage = function (ev) {
    var m = ev.data || {};
    if (m.event) { window.__events.push({ event: m.event, detail: m.detail }); return; }
    window.__ops.push({ op: m.op, args: m.args });
    if (m.op === "chrome" || m.op === "view" || m.op === "download" || m.op === "present") return port.postMessage({ id: m.id, ok: true, value: { ok: true } });
    if (m.op === "notify") return port.postMessage({ id: m.id, ok: true, value: { ok: true } });
    fetch("/op/AID", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: m.op, args: m.args || {} }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { port.postMessage(j.ok === false && j.__error ? { id: m.id, ok: false, error: j.__error } : { id: m.id, ok: true, value: j }); })
      .catch(function (err) { port.postMessage({ id: m.id, ok: false, error: String(err) }); });
  };
  document.getElementById("f").contentWindow.postMessage({ __hermes_bridge: 1, kind: "port", v: 3 }, "*", [ch.port2]);
  if (THEME) port.postMessage({ event: "theme", detail: THEME });
});
window.__post = function (event, detail) { port && port.postMessage({ event: event, detail: detail }); };
</script></body></html>"""


class Host:
    """The host on a free port, over the plugin's api on the test store."""

    def __init__(self):
        from hermes_artifacts import api
        self.api = api
        self.hooks = {}  # name -> callable answering GET /hook/<name> (JSON)
        self.files = {}  # name -> text served at GET /dom/<name> (a test's own top page, e.g. Desktop's plugin.js)
        host = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, body, ctype="application/json"):
                b = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def _api(self, method, path, q, body):
                try:
                    return self._send(200, host.api.handle(method, path, q, body))
                except Exception as e:  # noqa: BLE001 - the answer a page gets from Hermes on an error
                    return self._send(getattr(e, "status", 500), {"detail": getattr(e, "detail", None) or str(e)})

            def do_GET(self):
                u = urlparse(self.path)
                q = dict(parse_qsl(u.query))
                parts = u.path.strip("/").split("/")
                if parts[0] == "host":
                    theme = q.pop("theme", "")
                    qs = "&".join(f"{k}={v}" for k, v in q.items())
                    page = HOST.replace("AID", parts[1]).replace("QS", qs).replace("THEMEJSON", theme or "null")
                    return self._send(200, page.encode("utf-8"), "text/html; charset=utf-8")
                if parts[0] == "frame":
                    r = host.api.handle("GET", f"/artifacts/{parts[1]}/html", q, None)
                    return self._send(200, r["html"].encode("utf-8"), "text/html; charset=utf-8")
                if parts[0] == "vendor":
                    return self._send(200, host.api.handle("GET", "/vendor/" + parts[1], {}, None))
                if parts[0] == "hook" and parts[1] in host.hooks:  # a test's own step (e.g. Hermes' edit), from the driver
                    return self._send(200, host.hooks[parts[1]]())
                if parts[0] == "api":  # the plugin's own REST routes, as Desktop's ctx.rest reaches them
                    return self._api("GET", "/".join(parts[1:]), q, None)
                if parts[0] == "dom" and parts[1] in host.files:  # a test's own top page and modules (same origin as /op)
                    ctype = "text/javascript" if parts[1].endswith(".mjs") else "text/html; charset=utf-8"
                    return self._send(200, host.files[parts[1]].encode("utf-8"), ctype)
                self._send(404, {"detail": "nf"})

            def do_POST(self):
                u = urlparse(self.path)
                parts = u.path.strip("/").split("/")
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
                if parts[0] == "api":
                    return self._api("POST", "/".join(parts[1:]), dict(parse_qsl(u.query)), body)
                if parts[0] == "op":
                    if body.get("op") == "vendor":
                        try:
                            return self._send(200, host.api.handle("GET", "/vendor/" + body["args"]["name"], {}, None))
                        except Exception as e:  # noqa: BLE001
                            return self._send(200, {"ok": False, "__error": str(e)})
                    try:
                        return self._send(200, host.api.handle("POST", f"/artifacts/{parts[1]}/op", {}, body))
                    except Exception as e:  # noqa: BLE001 - the page gets the error, as from Hermes
                        return self._send(200, {"ok": False, "__error": getattr(e, "detail", None) or str(e)})
                self._send(404, {"detail": "nf"})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def url(self, aid, theme=None, **q):
        qs = "&".join(f"{k}={v}" for k, v in q.items())
        if theme is not None:
            from urllib.parse import quote
            qs += ("&" if qs else "") + "theme=" + quote(json.dumps(theme))
        return f"http://127.0.0.1:{self.port}/host/{aid}" + ("?" + qs if qs else "")

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


DRIVER = r"""
const fs = require('fs'), path = require('path'), cp = require('child_process')
const [chrome, scriptFile, prof] = process.argv.slice(2)
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function main() {
  const proc = cp.spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + prof, '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' })
  let port = null
  for (let i = 0; i < 200 && !port; i++) { try { port = fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0] } catch (_) { await sleep(100) } }
  if (!port) throw new Error('chrome did not start')
  let list = []
  for (let i = 0; i < 50; i++) { try { list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); if (list.find(t => t.type === 'page')) break } catch (_) {} await sleep(100) }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const pend = new Map(), ctxs = new Map(), logs = []
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pend.has(m.id)) { const { r, j } = pend.get(m.id); pend.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); return }
    if (m.method === 'Runtime.executionContextCreated') ctxs.set(m.params.context.id, m.params.context)
    if (m.method === 'Runtime.executionContextDestroyed') ctxs.delete(m.params.executionContextId)
    if (m.method === 'Runtime.executionContextsCleared') ctxs.clear()
    if (m.method === 'Runtime.exceptionThrown') logs.push(String(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text).slice(0, 300))
  }
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false })
  async function ev(expr, contextId) {
    const p = { expression: expr, awaitPromise: true, returnByValue: true }; if (contextId) p.contextId = contextId
    const r = await send('Runtime.evaluate', p)
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500))
    return r.result.value
  }
  async function frameCtx() {
    const tree = await send('Page.getFrameTree'); const kids = tree.frameTree.childFrames || []
    if (!kids.length) throw new Error('no frame')
    const fid = kids[kids.length - 1].frame.id
    const cx = [...ctxs.values()].filter(x => x.auxData && x.auxData.isDefault && x.auxData.frameId === fid).pop()
    if (!cx) throw new Error('no frame context')
    return cx.id
  }
  const api = {
    sleep, logs,
    top: e => ev(e),
    frame: async e => ev(e, await frameCtx()),
    go: async (url, ms) => { await send('Page.navigate', { url }); await sleep(ms || 1500) },
    size: (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }),
    /** The system's colour scheme the pages see ('light' or 'dark'). */
    scheme: s => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: s }] }),
    mouse: async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
    },
    /** A real drag with the left button from x0, y0 to x1, y1 of the window, in steps. */
    drag: async (x0, y0, x1, y1) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 })
      for (let i = 1; i <= 8; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8, button: 'left', buttons: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 })
    },
    /** A real click (mouse press and release) on the frame's element that sel finds (a JS expression). */
    clickIn: async (sel) => {
      const r = await api.frame('(() => { const el = ' + sel + '; if (!el) return null; el.scrollIntoView({block: "center"}); const b = el.getBoundingClientRect(); return [b.left + Math.min(20, b.width / 2), b.top + b.height / 2] })()')
      if (!r) throw new Error('nothing for ' + sel)
      await api.mouse(r[0], r[1]); await sleep(150)
    },
    /** A finger's tap (touch start and end) at x, y of the window. */
    tap: async (x, y) => {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    },
    type: async text => { await send('Input.insertText', { text }) },
    /** A key pressed as a keyboard does it, its character too (Enter's "\r"): what activates a focused button. */
    press: async (key, code, vk, text) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: code || key, windowsVirtualKeyCode: vk || 0, text }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code || key, windowsVirtualKeyCode: vk || 0 }) },
    key: async (key, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: code || key, windowsVirtualKeyCode: vk || 0 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code || key, windowsVirtualKeyCode: vk || 0 }) },
    shot: async file => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')) }
  }
  let out, err = null
  try { out = await (new Function('api', 'return (async () => {' + fs.readFileSync(scriptFile, 'utf8') + '})()'))(api) }
  catch (e) { err = String(e && e.stack || e) }
  try { await send('Browser.close') } catch (_) {}
  setTimeout(() => { try { proc.kill() } catch (_) {} }, 500)
  process.stdout.write(JSON.stringify({ out, err, logs }))
  setTimeout(() => process.exit(0), 700)
}
main().catch(e => { process.stdout.write(JSON.stringify({ err: String(e && e.stack || e) })); process.exit(0) })
"""


def drive(script: str, timeout: int = 180) -> dict:
    """Run `script` (the body of an async function of `api`) in headless Chrome; its return value is "out"."""
    dp = Path(tempfile.mkdtemp(prefix="ha-chrome-"))
    try:
        (dp / "drv.js").write_text(DRIVER, encoding="utf-8")
        (dp / "script.js").write_text(script, encoding="utf-8")
        prof = dp / "prof"
        prof.mkdir()
        r = subprocess.run([NODE, str(dp / "drv.js"), CHROME, str(dp / "script.js"), str(prof)],
                           capture_output=True, text=True, encoding="utf-8", timeout=timeout)
        try:
            return json.loads(r.stdout)
        except ValueError:
            raise AssertionError("driver failed:\n" + r.stdout[-2000:] + r.stderr[-2000:])
    finally:
        # Chrome's last processes let go of the profile a moment after it closed (longer on a busy machine):
        # retried for up to 15 s, so no folder is left behind.
        for _ in range(60):
            shutil.rmtree(dp, ignore_errors=True)
            if not dp.exists():
                break
            time.sleep(0.25)


def snapshot(aid: str) -> dict:
    """Every stored file of an artifact, as bytes. Aside: the page's diagnostics (the host's notes) and the
    card's picture (previews/: drawn once per version, outside the versions; never the artifact's content)."""
    from hermes_artifacts import store
    base = store._dir(aid)
    out = {}
    for p in sorted(base.rglob("*")):
        rel = p.relative_to(base).as_posix()
        if p.is_file() and p.name != "diagnostics.json" and not rel.startswith("previews/"):
            out[str(p.relative_to(base)).replace("\\", "/")] = p.read_bytes()
    return out
