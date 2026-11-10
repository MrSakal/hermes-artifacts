"""Loopback artifact host: a *shell* origin (UI + API) and a separate *content* origin.

Mirrors Claude Desktop's split (cowork-artifact://shell vs. the artifact frame): artifact
HTML runs in a sandboxed iframe (no allow-same-origin) served from the content port, so it
cannot read the shell's token or call /api directly. All bridge calls go artifact ->
postMessage/MessagePort -> shell -> /api (token + Origin checked).
"""

from __future__ import annotations

import html as htmlmod
import json
import mimetypes
import os
import secrets
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit, parse_qs

from . import store

ASSETS = Path(__file__).with_name("assets")
HOST = "127.0.0.1"


class Config:
    def __init__(self, shell_port: int = 8797, content_port: int = 8798,
                 bridge_tools: tuple[str, ...] = (), frame_ancestors: str = ""):
        self.shell_port = shell_port
        self.content_port = content_port
        self.token = secrets.token_urlsafe(24)
        self.bridge_tools = set(bridge_tools)
        # Who may frame the shell (the Hermes Desktop preview pane). Space-separated CSP sources.
        self.frame_ancestors = frame_ancestors or os.environ.get("HERMES_ARTIFACTS_FRAME_ANCESTORS", "*")
        self.on_send = None  # optional callback(item) -> wake agent

    @property
    def shell_origin(self) -> str:
        return f"http://{HOST}:{self.shell_port}"

    @property
    def content_origin(self) -> str:
        return f"http://{HOST}:{self.content_port}"


def _allowed_hosts(port: int) -> set[str]:
    return {f"127.0.0.1:{port}", f"localhost:{port}"}


class _Base(BaseHTTPRequestHandler):
    cfg: Config
    port: int
    server_version = "hermes-artifacts/0.1"

    def log_message(self, fmt, *args):  # quiet
        if os.environ.get("HERMES_ARTIFACTS_DEBUG"):
            super().log_message(fmt, *args)

    def _host_ok(self) -> bool:
        # DNS-rebinding guard: only loopback Host headers.
        if self.headers.get("Host", "") not in _allowed_hosts(self.port):
            self.send_error(HTTPStatus.MISDIRECTED_REQUEST)
            return False
        return True

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, data):
        self._send(code, json.dumps(data, ensure_ascii=False).encode(), "application/json; charset=utf-8")


# --------------------------------------------------------------------------- shell

class ShellHandler(_Base):
    def _csp(self) -> dict:
        return {"Content-Security-Policy":
                f"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                f"frame-src {self.cfg.content_origin}; connect-src 'self'; img-src 'self' data:; "
                f"frame-ancestors {self.cfg.frame_ancestors}",
                "Referrer-Policy": "no-referrer"}

    def do_GET(self):
        if not self._host_ok():
            return
        u = urlsplit(self.path)
        parts = [unquote(p) for p in u.path.split("/") if p]
        try:
            if not parts:
                return self._page(self._gallery())
            if parts[0] == "a" and len(parts) == 2:
                q = parse_qs(u.query)
                return self._page(self._viewer(parts[1], int(q["v"][0]) if "v" in q else None))
            if parts[0] == "events" and len(parts) == 2:
                return self._sse(parts[1])
            if parts[0] == "assets" and len(parts) == 2 and parts[1] in {"shell.js", "shell.css"}:
                f = ASSETS / parts[1]
                return self._send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] + "; charset=utf-8")
            if parts == ["api", "list"]:
                return self._json(200, store.list_all())
        except FileNotFoundError:
            return self._send(404, b"not found", "text/plain")
        except ValueError as e:
            return self._send(400, str(e).encode(), "text/plain")
        self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if not self._host_ok():
            return
        if self.headers.get("Origin") != self.cfg.shell_origin or \
                not secrets.compare_digest(self.headers.get("X-Hermes-Token", ""), self.cfg.token):
            return self._json(403, {"error": "forbidden"})
        parts = [unquote(p) for p in urlsplit(self.path).path.split("/") if p]
        if len(parts) != 3 or parts[0] != "api":
            return self._json(404, {"error": "not found"})
        aid, op = parts[1], parts[2]
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 512 * 1024:
                return self._json(413, {"error": "too large"})
            body = json.loads(self.rfile.read(n) or b"{}")
            if op == "storage.get":
                return self._json(200, {"value": store.kv_all(aid).get(body.get("key"))})
            if op == "storage.list":
                return self._json(200, {"keys": sorted(store.kv_all(aid))})
            if op == "storage.set":
                store.kv_set(aid, body.get("key"), body.get("value"))
                return self._json(200, {"ok": True})
            if op == "send":
                item = store.inbox_add(aid, body.get("text", ""), body.get("data"))
                woke = False
                if self.cfg.on_send:
                    try:
                        woke = bool(self.cfg.on_send(item))
                    except Exception:  # wake is best-effort; inbox already has it
                        woke = False
                return self._json(200, {"ok": True, "id": item["id"], "delivered": woke})
            if op == "callTool":
                return self._json(403, {"error": f"tool {body.get('name')!r} is not on the bridge allowlist"}) \
                    if body.get("name") not in self.cfg.bridge_tools else \
                    self._json(501, {"error": "callTool dispatch is provided by the Hermes plugin runtime"})
        except FileNotFoundError:
            return self._json(404, {"error": "unknown artifact"})
        except (ValueError, TypeError) as e:
            return self._json(400, {"error": str(e)})
        self._json(404, {"error": f"unknown op {op}"})

    def _page(self, body: str):
        self._send(200, body.encode("utf-8"), "text/html; charset=utf-8", self._csp())

    def _sse(self, aid: str):
        store.get_meta(aid)  # validates id
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        last = None
        try:
            for _ in range(60 * 60 * 4):  # max ~4h per connection, client reconnects
                m = store.get_meta(aid)
                cur = m["versions"][-1]["n"] if m and m["versions"] else 0
                if cur != last:
                    self.wfile.write(f"event: version\ndata: {json.dumps({'v': cur, 'title': m and m['title']})}\n\n".encode())
                    last = cur
                else:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
                time.sleep(1)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def _gallery(self) -> str:
        rows = "".join(
            f'<a class="card" href="/a/{htmlmod.escape(m["id"])}"><b>{htmlmod.escape(m["title"])}</b>'
            f'<span>{htmlmod.escape(m["id"])} · v{len(m["versions"])} · '
            f'{time.strftime("%Y-%m-%d %H:%M", time.localtime(m.get("updated", 0)))}</span></a>'
            for m in store.list_all()) or '<p class="empty">No artifacts yet.</p>'
        return _shell_html("Hermes artifacts", f'<main class="gallery"><h1>Artifacts</h1>{rows}</main>', {})

    def _viewer(self, aid: str, v: int | None) -> str:
        meta = store.get_meta(aid)
        if not meta:
            raise FileNotFoundError(aid)
        latest = meta["versions"][-1]["n"]
        cur = v or latest
        store.version_dir(aid, cur)
        opts = "".join(f'<option value="{x["n"]}"{" selected" if x["n"] == cur else ""}>v{x["n"]}</option>'
                       for x in reversed(meta["versions"]))
        boot = {"id": aid, "v": cur, "latest": latest, "pinned": v is not None, "token": self.cfg.token,
                "content": self.cfg.content_origin, "shell": self.cfg.shell_origin}
        body = (
            '<header class="bar">'
            '<a class="home" href="/" title="Gallery">◆</a>'
            f'<span class="title">{htmlmod.escape(meta["title"])}</span>'
            f'<select id="ver" aria-label="Version">{opts}</select>'
            '<button id="reload" title="Reload">↻</button>'
            '<span id="status" class="status"></span>'
            '</header>'
            '<iframe id="frame" title="artifact" '
            'sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads" '
            'allow="clipboard-write; fullscreen"></iframe>'
        )
        return _shell_html(meta["title"], body, boot)


def _shell_html(title: str, body: str, boot: dict) -> str:
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        f"<title>{htmlmod.escape(title)}</title><link rel=\"stylesheet\" href=\"/assets/shell.css\"></head><body>"
        f"{body}<script>window.__HERMES_BOOT__={json.dumps(boot)};</script>"
        "<script src=\"/assets/shell.js\"></script></body></html>"
    )


# --------------------------------------------------------------------------- content

class ContentHandler(_Base):
    def do_GET(self):
        if not self._host_ok():
            return
        parts = [unquote(p) for p in urlsplit(self.path).path.split("/") if p]
        # /c/<id>/v<N>/<path...>
        if len(parts) < 3 or parts[0] != "c" or not parts[2].startswith("v"):
            return self._send(404, b"not found", "text/plain")
        try:
            base = store.version_dir(parts[1], int(parts[2][1:])).resolve()
            rel = "/".join(parts[3:]) or "index.html"
            f = (base / rel).resolve()
            if base not in f.parents and f != base or not f.is_file():
                return self._send(404, b"not found", "text/plain")
        except (FileNotFoundError, ValueError):
            return self._send(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        data = f.read_bytes()
        # frame-ancestors checks *every* ancestor, so whoever frames the shell must be listed too.
        headers = {"Referrer-Policy": "no-referrer"}
        if self.cfg.frame_ancestors != "*":
            headers["Content-Security-Policy"] = \
                f"frame-ancestors {self.cfg.shell_origin} {self.cfg.frame_ancestors}"
        if ctype == "text/html":
            data = inject_bridge(data)
            ctype += "; charset=utf-8"
        self._send(200, data, ctype, headers)

    do_HEAD = do_GET


_bridge: tuple = (None, b"")  # (mtime_ns, size) of bridge.js and the tag made from it


def _bridge_tag() -> bytes:
    global _bridge
    p = ASSETS / "bridge.js"
    st = p.stat()
    key = (st.st_mtime_ns, st.st_size)
    if _bridge[0] != key:
        _bridge = (key, f"<script>{p.read_text(encoding='utf-8')}</script>".encode())
    return _bridge[1]


def inject_bridge(data: bytes) -> bytes:
    """Insert the window.hermes bridge as the first script of the page."""
    tag = _bridge_tag()
    low = data[:4096].lower()
    i = low.find(b"<head")
    if i != -1:
        j = data.find(b">", i)
        return data[: j + 1] + tag + data[j + 1:]
    return tag + data


# --------------------------------------------------------------------------- lifecycle

class ArtifactServer:
    def __init__(self, cfg: Config | None = None):
        self.cfg = cfg or Config()
        self._servers: list[ThreadingHTTPServer] = []

    def _make(self, handler, port):
        cls = type(handler.__name__, (handler,), {"cfg": self.cfg, "port": port})
        srv = ThreadingHTTPServer((HOST, port), cls)
        srv.daemon_threads = True
        return srv

    def start(self) -> "ArtifactServer":
        self._servers = [self._make(ShellHandler, self.cfg.shell_port),
                         self._make(ContentHandler, self.cfg.content_port)]
        for s in self._servers:
            threading.Thread(target=s.serve_forever, daemon=True, name=f"artifacts:{s.server_port}").start()
        return self

    def stop(self):
        for s in self._servers:
            s.shutdown()
            s.server_close()

    def url(self, aid: str | None = None) -> str:
        return f"{self.cfg.shell_origin}/a/{aid}" if aid else f"{self.cfg.shell_origin}/"


def is_running(shell_port: int = 8797) -> bool:
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{shell_port}/api/list", timeout=1) as r:
            return r.headers.get("Server", "").startswith("hermes-artifacts")
    except OSError:
        return False
