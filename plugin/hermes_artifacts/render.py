"""Compose the one HTML document the viewer shows for an artifact version.

A ``page`` artifact is its own HTML (multi-file versions are inlined by :mod:`bundle`). A typed
artifact (dashboard, slides, doc) is the type's runtime, shipped with this plugin under
``types/<type>/``, with the artifact's content files embedded as JSON for the runtime to read.
"""

from __future__ import annotations

import base64
import bisect
import re
from collections import Counter
import json
import mimetypes
from pathlib import Path
from typing import Optional

from . import bundle, store

TYPES_DIR = Path(__file__).resolve().parent / "types"
_TEXT = {".json", ".html", ".htm", ".md", ".txt", ".csv", ".tsv", ".svg", ".css", ".js"}


def content_json(vdir: Path, want=None) -> dict:
    """Every file of the version (``want(rel)``: only those it accepts): text as str, binary as a data: URI."""
    out = {}
    for f in sorted(vdir / rel for rel, _ in store.walk_files(vdir) if want is None or want(rel)):
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


MAP_MAX_LINES = 50000  # a longer page gets no line map (its errors then name no line of the file)


def _matches(a: list, b: list) -> list:
    """Pairs (i in a, j in b) of equal lines, both increasing, in about linear time: lines that occur once in
    each are the anchors (their longest increasing run), and the runs of equal lines on either side of every
    anchor are added to them. The bundler only replaces pieces of the page in place, so this finds every line
    of the file that is still a line of the document, except inside a stretch of repeated lines that no anchor
    or run reaches (those then name no line)."""
    ca, cb = Counter(a), Counter(b)
    where = {line: j for j, line in enumerate(b) if cb[line] == 1}
    pairs = [(i, where[line]) for i, line in enumerate(a) if ca[line] == 1 and line in where]
    # The longest run of pairs whose j increases too (patience sorting).
    tails, tail_at, prev = [], [], [-1] * len(pairs)
    for k, (_, j) in enumerate(pairs):
        p = bisect.bisect_left(tails, j)
        if p == len(tails):
            tails.append(j)
            tail_at.append(k)
        else:
            tails[p], tail_at[p] = j, k
        prev[k] = tail_at[p - 1] if p else -1
    chain, k = [], tail_at[-1] if tail_at else -1
    while k != -1:
        chain.append(pairs[k])
        k = prev[k]
    anchors = [(-1, -1)] + chain[::-1] + [(len(a), len(b))]
    out = []
    for (pi, pj), (ni, nj) in zip(anchors, anchors[1:]):
        if pi >= 0:
            out.append((pi, pj))
        i, j = pi + 1, pj + 1  # forward from the anchor before
        while i < ni and j < nj and a[i] == b[j]:
            out.append((i, j))
            i, j = i + 1, j + 1
        back, i2, j2 = [], ni - 1, nj - 1  # back from the anchor after
        while i2 >= i and j2 >= j and a[i2] == b[j2]:
            back.append((i2, j2))
            i2, j2 = i2 - 1, j2 - 1
        out.extend(back[::-1])
    return out


_maps: dict = {}  # (version folder, entry, its mtime and size) -> the note: versions never change


def line_map(entry: str, raw: str, html: str) -> str:
    """A note appended to a page's document (it moves no line): which of the document's lines are the entry
    file's own, as ``[first line here, first line in the file, count]`` blocks (1-based), so the bridge can name
    ``index.html:12`` for an error on one. Lines the bundler wrote (an inlined script or stylesheet) are in no
    block, and an error there names no file."""
    a, b = raw.split("\n"), html.split("\n")  # read_text already made every line end "\n", as a browser counts them
    blocks: list = []
    if a == b:
        blocks = [[1, 1, len(a)]]
    elif len(a) <= MAP_MAX_LINES and len(b) <= MAP_MAX_LINES:
        for i, j in _matches(a, b):
            last = blocks[-1] if blocks else None
            if last and last[0] + last[2] == j + 1 and last[1] + last[2] == i + 1:
                last[2] += 1
            else:
                blocks.append([j + 1, i + 1, 1])
    data = json.dumps({"f": entry, "m": blocks}, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    return f'<script type="application/json" id="hermes-lines">{data}</script>'


def _page_map(vdir: Path, entry: str, html: str) -> str:
    try:
        st = (vdir / entry).stat()
        key = (str(vdir), entry, st.st_mtime_ns, st.st_size)
    except OSError:
        return ""
    hit = _maps.get(key)
    if hit is None:
        hit = line_map(entry, (vdir / entry).read_text("utf-8", "replace"), html)
        if len(_maps) >= 256:
            _maps.pop(next(iter(_maps)))
        _maps[key] = hit
    return hit


def render(meta: dict, vdir: Path, page: Optional[str] = None, thumb: bool = False, lang: str = "") -> str:
    kind = meta.get("type", "page")
    if kind == "page":
        entry = store.safe_rel(page) if page else "index.html"
        if not (vdir / entry).is_file():
            raise FileNotFoundError(entry)
        html = bundle.bundle(vdir, entry)
        # A card's picture reports no errors: no map for it.
        return html if thumb else html + _page_map(vdir, entry, html)
    data = {"id": meta["id"], "title": meta["title"], "type": kind,
            "version": int(vdir.name[1:]), "thumb": bool(thumb), "lang": lang if re.fullmatch(r"[a-z]{2}(-[A-Za-z]{2})?", lang or "") else "",  # the app's language, for the page's own words
            # A model's card draws no 3D: it needs model.json (its title), not the meshes.
            "files": content_json(vdir, (lambda rel: rel == "model.json") if kind == "model" and thumb else None)}
    preview = store.preview_get(meta["id"], data["version"])
    if preview:
        data["preview"] = preview  # the picture the page drew of this version (a model's view)
    if kind == "doc" and data["version"] == meta["versions"][-1]["n"]:
        # The live doc (what the user and Hermes edited since this version), for the first paint
        # and thumbnails; an open doc then follows it through doc.read.
        try:
            from . import docs
            st = docs.load(meta["id"])
            data["doc"] = {"tabs": [{"id": t["id"], "title": t["title"], "rev": t["rev"], "blocks": t["blocks"]} for t in st["tabs"]],
                           "hermes_active": not thumb and docs.time.time() - st.get("hermes_at", 0) < docs.ACTIVE_SECS,
                           "hermes_left": 0 if thumb else docs.left(st), "hermes_ago": 0 if thumb else docs.ago(st),
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
                             "hermes_active": not thumb and sheets.time.time() - st.get("hermes_at", 0) < sheets.ACTIVE_SECS,
                             "hermes_left": 0 if thumb else sheets.left(st), "hermes_ago": 0 if thumb else sheets.ago(st)}
        except Exception:
            pass
    if kind == "board":
        # The live board, for the first paint and thumbnails; an open board then follows it through
        # board.read. An older version: that version's board.json, placed (to look at).
        try:
            from . import boards
            if data["version"] == meta["versions"][-1]["n"]:
                st = boards.load(meta["id"])
                data["board"] = {"title": st["title"], "items": st["items"], "rev": st["rev"],
                                 "hermes_active": not thumb and boards._active(st), "hermes_left": 0 if thumb else boards.left(st),
                                 "hermes_ago": 0 if thumb else boards.ago(st)}
            else:
                old = boards.from_spec(json.loads(data["files"].get("board.json") or "{}"), meta["title"])
                data["board"] = {"title": old["title"], "items": old["items"], "rev": 0, "hermes_active": False, "hermes_left": 0,
                                 "hermes_ago": 0}
        except Exception:
            pass
    # </script inside JSON would end the block; < keeps it valid JSON.
    blob = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    tag = f'<script type="application/json" id="hermes-artifact-content">{blob}</script>'
    html = runtime(kind)
    i = html.lower().find("</head>")
    return html[:i] + tag + html[i:] if i != -1 else tag + html
