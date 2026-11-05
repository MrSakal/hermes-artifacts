"""Compose the one HTML document the viewer shows for an artifact version.

A ``page`` artifact is its own HTML (multi-file versions are inlined by :mod:`bundle`). A typed
artifact (dashboard, slides, doc) is the type's runtime, shipped with this plugin under
``types/<type>/``, with the artifact's content files embedded as JSON for the runtime to read.
"""

from __future__ import annotations

import base64
import json
import mimetypes
from pathlib import Path
from typing import Optional

from . import bundle, store

TYPES_DIR = Path(__file__).resolve().parent / "types"
_TEXT = {".json", ".html", ".htm", ".md", ".txt", ".csv", ".tsv", ".svg", ".css", ".js"}


def content_json(vdir: Path) -> dict:
    """Every file of the version: text as str, binary as a data: URI."""
    out = {}
    for f in sorted(p for p in vdir.rglob("*") if p.is_file()):
        rel = f.relative_to(vdir).as_posix()
        if f.suffix.lower() in _TEXT:
            out[rel] = f.read_text("utf-8", "replace")
        else:
            mime = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            out[rel] = f"data:{mime};base64,{base64.b64encode(f.read_bytes()).decode()}"
    return out


def runtime(kind: str) -> str:
    """types/<kind>/runtime.html with its local scripts and styles inlined."""
    d = TYPES_DIR / kind
    if not (d / "runtime.html").is_file():
        raise ValueError(f"no viewer for type {kind!r} in this plugin version")
    return bundle.bundle(d, "runtime.html")


def render(meta: dict, vdir: Path, page: Optional[str] = None) -> str:
    kind = meta.get("type", "page")
    if kind == "page":
        entry = store.safe_rel(page) if page else "index.html"
        if not (vdir / entry).is_file():
            raise FileNotFoundError(entry)
        return bundle.bundle(vdir, entry)
    data = {"id": meta["id"], "title": meta["title"], "type": kind,
            "version": int(vdir.name[1:]), "files": content_json(vdir)}
    # </script inside JSON would end the block; < keeps it valid JSON.
    blob = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    tag = f'<script type="application/json" id="hermes-artifact-content">{blob}</script>'
    html = runtime(kind)
    i = html.lower().find("</head>")
    return html[:i] + tag + html[i:] if i != -1 else tag + html
