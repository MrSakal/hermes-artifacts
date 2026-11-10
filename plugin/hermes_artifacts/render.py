"""Compose the one HTML document the viewer shows for an artifact version.

A ``page`` artifact is its own HTML (multi-file versions are inlined by :mod:`bundle`). A typed
artifact (dashboard, slides, doc) is the type's runtime, shipped with this plugin under
``types/<type>/``, with the artifact's content files embedded as JSON for the runtime to read.
"""

from __future__ import annotations

import base64
import re
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


_runtimes: dict = {}  # kind -> (stamp of every file that went in, html)


def _stamp(paths) -> tuple:
    out = []
    for p in paths:
        st = p.stat()
        out.append((str(p), st.st_mtime_ns, st.st_size))
    return tuple(out)


def runtime(kind: str) -> str:
    """types/<kind>/runtime.html with its local scripts and styles inlined.

    Bundling a runtime costs tens of milliseconds and every view and thumbnail needs one, so the
    result is kept until one of the files it was made from changes (a plugin update, an edit)."""
    if not (TYPES_DIR / kind / "runtime.html").is_file():
        raise ValueError(f"no viewer for type {kind!r} in this plugin version")
    hit = _runtimes.get(kind)
    if hit:
        try:
            if _stamp(Path(name) for name, _, _ in hit[0]) == hit[0]:
                return hit[1]
        except OSError:
            pass
    seen: set = set()
    # Rooted at types/ so every runtime can share types/_kit/.
    html = bundle.bundle(TYPES_DIR, f"{kind}/runtime.html", seen=seen)
    try:
        _runtimes[kind] = (_stamp(sorted(seen)), html)
    except OSError:
        _runtimes.pop(kind, None)
    return html


def render(meta: dict, vdir: Path, page: Optional[str] = None, thumb: bool = False, lang: str = "") -> str:
    kind = meta.get("type", "page")
    if kind == "page":
        entry = store.safe_rel(page) if page else "index.html"
        if not (vdir / entry).is_file():
            raise FileNotFoundError(entry)
        return bundle.bundle(vdir, entry)
    data = {"id": meta["id"], "title": meta["title"], "type": kind,
            "version": int(vdir.name[1:]), "thumb": bool(thumb), "lang": lang if re.fullmatch(r"[a-z]{2}(-[A-Za-z]{2})?", lang or "") else "",  # the app's language, for the page's own words
            "files": content_json(vdir)}
    if kind == "doc" and data["version"] == meta["versions"][-1]["n"]:
        # The live doc (what the user and Hermes edited since this version), for the first paint
        # and thumbnails; an open doc then follows it through doc.read.
        try:
            from . import docs
            st = docs.load(meta["id"])
            data["doc"] = {"tabs": [{"id": t["id"], "title": t["title"], "rev": t["rev"], "blocks": t["blocks"]} for t in st["tabs"]],
                           "hermes_active": not thumb and docs.time.time() - st.get("hermes_at", 0) < docs.ACTIVE_SECS,
                           "selects": st.get("selects") or {}, "settings": st.get("settings") or {},
                           "suggestions": [x for x in st.get("suggestions", []) if x["tab"] == st["tabs"][0]["id"]]}
        except Exception:
            pass
    if kind == "sheet" and data["version"] == meta["versions"][-1]["n"]:
        # The live workbook, for the first paint and thumbnails; an open sheet then follows it
        # through sheet.read.
        try:
            from . import sheets
            st = sheets.load(meta["id"])
            data["sheet"] = {"sheets": [{k: v for k, v in s.items() if k != "vals_at"} for s in st["sheets"]],
                             "hermes_active": not thumb and sheets.time.time() - st.get("hermes_at", 0) < sheets.ACTIVE_SECS}
        except Exception:
            pass
    # </script inside JSON would end the block; < keeps it valid JSON.
    blob = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    tag = f'<script type="application/json" id="hermes-artifact-content">{blob}</script>'
    html = runtime(kind)
    i = html.lower().find("</head>")
    return html[:i] + tag + html[i:] if i != -1 else tag + html
