"""Turn a multi-file artifact version into one self-contained HTML document.

Hermes Desktop renders an artifact as a ``data:`` URL inside a sandboxed frame (that is what works
when the desktop talks to a remote Hermes server), so relative references can't load. This inlines
them: ``<script src>`` and stylesheet ``<link>`` become inline blocks, and ``src``/``href``/``poster``
of media plus CSS ``url()`` become ``data:`` URIs. Absolute URLs (``https:``, ``data:``, ``//``) are
left alone. Links to another ``.html`` of the artifact get ``data-hermes-page`` so the bridge can ask
the host to open that page.
"""

from __future__ import annotations

import base64
import mimetypes
import posixpath
import re
from pathlib import Path

_EXTERNAL = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//|#)", re.I)
_SCRIPT_SRC = re.compile(r"<script\b([^>]*?)\bsrc\s*=\s*([\"'])([^\"']+)\2([^>]*)>\s*</script>", re.I)
_LINK_CSS = re.compile(r"<link\b[^>]*>", re.I)
_ATTR_URL = re.compile(r"(\s(?:src|poster|href|data-src))\s*=\s*([\"'])([^\"']*)\2", re.I)
_SRCSET = re.compile(r"(\ssrcset)\s*=\s*([\"'])([^\"']*)\2", re.I)
_CSS_URL = re.compile(r"url\(\s*([\"']?)([^\"')]+)\1\s*\)", re.I)
_CSS_IMPORT = re.compile(r"@import\s+([\"'])([^\"']+)\1\s*;", re.I)
MAX_INLINE = 16 * 1024 * 1024

mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")


class _Ctx:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.total = 0
        self.seen: set[Path] = set()  # every local file the document pulled in

    def resolve(self, base_rel: str, ref: str) -> Path | None:
        ref = ref.split("#", 1)[0].split("?", 1)[0].strip()
        if not ref or _EXTERNAL.match(ref):
            return None
        rel = posixpath.normpath(posixpath.join(posixpath.dirname(base_rel), ref)).lstrip("/")
        p = (self.root / rel).resolve()
        if self.root not in p.parents or not p.is_file():  # a prefix test would let v1/ reach v10/
            return None
        self.seen.add(p)
        return p

    def data_uri(self, p: Path) -> str:
        raw = p.read_bytes()
        self.total += len(raw)
        if self.total > MAX_INLINE:
            raise ValueError("inlined assets exceed 16 MB")
        mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if mime == "text/css":
            raw = self.css(raw.decode("utf-8", "replace"), self.rel(p)).encode("utf-8")
        return f"data:{mime};base64,{base64.b64encode(raw).decode()}"

    def rel(self, p: Path) -> str:
        return p.relative_to(self.root).as_posix()

    def css(self, text: str, base_rel: str, depth: int = 0) -> str:
        def imp(m):
            p = self.resolve(base_rel, m.group(2))
            if not p or depth > 4:
                return m.group(0)
            return self.css(p.read_text("utf-8", "replace"), self.rel(p), depth + 1)

        def url(m):
            p = self.resolve(base_rel, m.group(2))
            return f'url("{self.data_uri(p)}")' if p else m.group(0)

        return _CSS_URL.sub(url, _CSS_IMPORT.sub(imp, text))


def bundle(root: Path, entry: str = "index.html", seen: set | None = None) -> str:
    """Return ``entry`` with every local reference under ``root`` inlined.

    ``seen``, when given, receives the path of every file that went into the result (the entry too)."""
    ctx = _Ctx(root)
    if seen is not None:
        ctx.seen = seen
        seen.add((ctx.root / entry).resolve())
    html = (root / entry).read_text("utf-8", "replace")

    def script(m):
        p = ctx.resolve(entry, m.group(3))
        if not p:
            return m.group(0)
        js = p.read_text("utf-8", "replace").replace("</script", "<\\/script")
        ctx.total += len(js)
        return f"<script{m.group(1)}{m.group(4)}>{js}</script>"

    def link(m):
        tag = m.group(0)
        if not re.search(r"\brel\s*=\s*[\"']?stylesheet", tag, re.I):
            return tag
        h = re.search(r"\bhref\s*=\s*([\"'])([^\"']+)\1", tag, re.I)
        p = ctx.resolve(entry, h.group(2)) if h else None
        if not p:
            return tag
        css = ctx.css(p.read_text("utf-8", "replace"), ctx.rel(p)).replace("</style", "<\\/style")
        return f"<style>{css}</style>"

    def attr(m):
        name, q, ref = m.group(1), m.group(2), m.group(3)
        p = ctx.resolve(entry, ref)
        if not p:
            return m.group(0)
        if name.strip().lower() == "href" and p.suffix.lower() in (".html", ".htm"):
            return f'{name}={q}#{q} data-hermes-page={q}{ctx.rel(p)}{q}'
        return f"{name}={q}{ctx.data_uri(p)}{q}"

    def srcset(m):
        parts = []
        for item in m.group(3).split(","):
            bits = item.strip().split(None, 1)
            if not bits:
                continue
            p = ctx.resolve(entry, bits[0])
            parts.append(" ".join([ctx.data_uri(p) if p else bits[0], *bits[1:]]))
        return f"{m.group(1)}={m.group(2)}{', '.join(parts)}{m.group(2)}"

    def style_block(m):
        return m.group(1) + ctx.css(m.group(2), entry) + m.group(3)

    html = _SCRIPT_SRC.sub(script, html)
    html = _LINK_CSS.sub(link, html)
    html = re.sub(r"(<style\b[^>]*>)(.*?)(</style>)", style_block, html, flags=re.I | re.S)
    html = _SRCSET.sub(srcset, html)
    html = _ATTR_URL.sub(attr, html)
    return html
