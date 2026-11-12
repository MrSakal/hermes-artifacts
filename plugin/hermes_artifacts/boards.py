"""Live boards: a whiteboard of items (blocks, notes, text, sections, arrows, pen lines, tables, images,
drawings, small embeds) that the user rearranges by hand and Hermes edits in place.

Built the way sheets.py is: the board starts from the latest published ``board.json``; every edit batch
bumps ``rev`` and is logged, so a reader can ask what changed since the rev it last saw, and an edit
made against an older rev of items someone else changed meanwhile is refused.

Items are kept back to front (list order = z-order). An item that comes without coordinates is sized
and placed here (see ``_place``): text is measured by a fixed rule the page shares, arrows between
unplaced items make a layered flow, a section is sized around what is put ``in`` it, and the rest goes
in a row under what is already there.

State lives in ``<artifact>/board/state.json``, outside the artifact's versions.
"""

from __future__ import annotations

import copy
import json
import math
import re
import threading
import time
from pathlib import Path
from typing import Optional

from . import store

_LOCK = threading.RLock()
MAX_ITEMS = 800
MAX_ITEM_BYTES = 200_000
MAX_BOARD_BYTES = 2_000_000
MAX_TEXT = 4000
MAX_TITLE = 200
MAX_POINTS = 4000
MAX_SVG = 60_000
MAX_IMG = 100 * 1024       # a data: image, decoded
MAX_HTML = 16_000
MAX_STATE = 16_000
MAX_ROWS, MAX_COLS = 200, 30
MAX_VIA = 20
MAX_OPS = 500
MAX_LOG = 400
MAX_LOG_IDS = 400          # an edit touching more items is logged as "everything changed"
AGENT_ITEMS = 300
ACTIVE_SECS = 300          # Hermes counts as at work in a board this long after its last change there

TYPES = ("box", "note", "text", "section", "arrow", "pen", "table", "image", "drawing", "embed")
KINDS = ("rect", "rounded", "ellipse", "diamond", "pill", "hexagon", "parallelogram", "database", "queue",
         "document", "cloud", "person")
FILLS = ("yellow", "peach", "pink", "green", "blue", "purple", "gray")
STROKES = ("ink", "terracotta", "blue", "green", "purple")
SIZES = {"small": 14, "body": 16, "large": 28, "title": 48, "huge": 96}
ALIGNS = ("left", "center", "right")
SIDES = ("top", "right", "bottom", "left")
HEADS = ("none", "arrow", "circle")
LAYOUTS = ("row", "column", "grid")
FLOWS = ("right", "down")

# The text measure rule (the page's geo.measure uses the same numbers).
CHAR_W, CHAR_W_BOLD, LINE_H = 0.55, 0.6, 1.4
PAD = 16                   # a box's padding each side
GAP = 24                   # between neighbours in a row, a column, a section
COL_GAP, LABEL_GAP = 64, 144   # between flow columns; where an arrow there carries a label
SEC_PAD, SEC_TITLE = 24, 28    # inside a section's edges; room for its title above the box
HEAD_GAP = 52              # under the title lines
WRAP_AT = 1400             # a row of loose items wraps about here
BAND = 6                   # flow layers in one row before it wraps
ORIGIN = (80, 80)

_ID = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_SRC_FILE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}(/[A-Za-z0-9_][A-Za-z0-9._-]{0,99}){0,7}\.(png|jpe?g|webp|gif)$", re.I)
_SRC_DATA = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$")
_CSS_URL = re.compile(r"url\(\s*['\"]?\s*([^)'\"]*)", re.I)

# What each type takes besides id, type, x, y, locked, group.
FIELDS = {
    "box": ("w", "h", "kind", "text", "color", "stroke", "hollow", "size", "align"),
    "note": ("w", "h", "text", "color", "size"),
    "text": ("w", "text", "size", "color", "align"),
    "section": ("w", "h", "text", "color"),
    "arrow": ("from", "to", "fromSide", "toSide", "label", "dash", "heads", "color", "via"),
    "pen": ("points", "color", "width"),
    "table": ("rows", "colw"),
    "image": ("w", "h", "src"),
    "drawing": ("w", "h", "svg"),
    "embed": ("w", "h", "html", "title", "state"),
}
REQUIRED = {"arrow": ("from", "to"), "pen": ("points",), "table": ("rows",), "image": ("src",),
            "drawing": ("svg",), "embed": ("html",)}
# Derived by the page, never stored: dropped without a word when sent.
DERIVED = {"text": ("h",), "table": ("w", "h"), "pen": ("w", "h"), "arrow": ("x", "y", "w", "h")}
# What a compact read leaves out.
DEFAULTS = {
    "box": {"kind": "rounded", "color": "green", "stroke": "ink", "hollow": False, "size": "body", "align": "center"},
    "note": {"color": "yellow", "size": "body"},
    "text": {"color": "ink", "size": "body", "align": "left"},
    "section": {"color": "gray"},
    "arrow": {"heads": ["none", "arrow"], "dash": False, "color": "ink"},
    "pen": {"color": "ink", "width": 3},
}
_BLOBS = ("svg", "html", "points")
EXAMPLE = ('board.json: {"title": ..., "items": [{"id": "a", "type": "box", "text": "Draft"}, '
           '{"type": "arrow", "from": "a", "to": "b"}]}')


class BoardError(Exception):
    def __init__(self, code: str, message: str, **extra):
        super().__init__(message)
        self.code, self.message, self.extra = code, message, extra


def _bad(message: str, code: str = "invalid", **extra) -> BoardError:
    return BoardError(code, message, **extra)


# ----------------------------------------------------------------------------- measuring

_MARKS = ((re.compile(r"\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))*\)"), r"\1"), (re.compile(r"`([^`\n]*)`"), r"\1"),
          (re.compile(r"\*\*([^\n]+?)\*\*"), r"\1"), (re.compile(r"\*([^*\n]+?)\*"), r"\1"))


def _plain(text) -> str:
    """Text without its inline marks (they take no room when drawn); the page's geo.measure does the same."""
    t = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    for rx, to in _MARKS:
        t = rx.sub(to, t)
    return t


def measure(text, px: float, wrap: Optional[float] = None, bold: bool = False) -> tuple:
    """(width, height, lines) of ``text`` by the measure rule: a character is 0.55 x px wide (bold 0.6),
    a line 1.4 x px tall; ``wrap``: the width lines break at, on spaces (a longer word is cut)."""
    cw = (CHAR_W_BOLD if bold else CHAR_W) * px
    most = max(1, int(wrap / cw + 1e-9)) if wrap and wrap > 0 else 0
    lines = []
    for para in _plain(text).split("\n"):
        if not most or len(para) <= most:
            lines.append(para)
            continue
        cur = None
        for word in para.split(" "):
            if cur is not None and len(cur) + 1 + len(word) <= most:
                cur += " " + word
                continue
            if cur is not None:
                lines.append(cur)
            while len(word) > most:
                lines.append(word[:most])
                word = word[most:]
            cur = word
        if cur is not None:
            lines.append(cur)
    return round(max((len(ln) for ln in lines), default=0) * cw, 2), round(len(lines) * LINE_H * px, 2), lines


def _px(it: dict) -> int:
    return SIZES[it.get("size", "body")]


def _r2(v: float) -> float:
    return math.floor(v * 100 + 0.5) / 100  # as JavaScript's Math.round(v * 100) / 100


def inset(kind: str, w: float, h: float) -> tuple:
    """(x, y, w, h) where text fits inside a shape of that kind and size: geo.shapeInset, number for number."""
    w, h = max(1.0, float(w)), max(1.0, float(h))
    px0, py0 = min(PAD, w / 4), min(PAD, h / 4)
    sx, sy = min(12, w / 4), min(12, h / 4)

    def clamp(x, y, bw, bh):
        x, y = max(0.0, min(x, w / 2 - 0.5)), max(0.0, min(y, h / 2 - 0.5))
        return (_r2(x), _r2(y), _r2(max(1.0, min(bw, w - 2 * x))), _r2(max(1.0, min(bh, h - y))))

    def db_ry():
        return max(min(4, h / 4), min(h * 0.18, w * 0.2, 16))

    if kind == "ellipse":
        return clamp(w * 0.1464 + 1, h * 0.1464 + 1, w * 0.7071 - 2, h * 0.7071 - 2)
    if kind == "diamond":
        return clamp(w / 4 + 1, h / 4 + 1, w / 2 - 2, h / 2 - 2)
    if kind == "pill":
        a = min(w, h) / 2
        x = max(sx, a * 0.5) if w >= h else max(sx, a * 0.134 + 1)
        y = max(min(sy, h / 5), a * 0.134 + 1) if w >= h else max(sy, a * 0.5)
        return clamp(x, y, w - 2 * x, h - 2 * y)
    if kind == "hexagon":
        x, y = min(w * 0.25, h * 0.5) * 0.8 + 2, h * 0.125
        return clamp(x, y, w - 2 * x, h - 2 * y)
    if kind == "parallelogram":
        x = min(w * 0.2, h * 0.5) + 4
        return clamp(x, sy, w - 2 * x, h - 2 * sy)
    if kind == "database":
        a = db_ry()
        return clamp(sx, 2 * a + 3, w - 2 * sx, h - 3 * a - 4)
    if kind == "queue":
        a = max(min(4, w / 4), min(w * 0.18, h * 0.2, 16))
        return (_r2(2 * a + 4), _r2(sy), _r2(max(1.0, w - 3 * a - 6)), _r2(max(1.0, h - 2 * sy)))
    if kind == "document":
        a = max(min(3, h / 6), min(h * 0.12, 12))
        return (_r2(px0), _r2(py0), _r2(w - 2 * px0), _r2(max(1.0, h - py0 - 2 * a - 4)))
    if kind == "cloud":
        return (_r2(w * 0.2), _r2(h * 0.27), _r2(w * 0.6), _r2(h * 0.5))
    if kind == "person":
        rh = min(w * 0.22, h * 0.2)
        yb = 2 * rh + max(min(2, h * 0.02), rh * 0.25)
        rr = max(0.0, min(w / 2, h - yb))
        b = rr * 0.293 + 1
        return (_r2(b), _r2(yb + b), _r2(max(1.0, w - 2 * b)), _r2(max(1.0, h - yb - b - min(4, h * 0.03))))
    return (_r2(px0), _r2(py0), _r2(w - 2 * px0), _r2(h - 2 * py0))


def _fit_box(it: dict, grow_only: bool = False) -> None:
    """Size a box or note to its text: default width 180 (more for big type), 30 % wider for the kinds
    whose outline eats into the text, min 120x60; then wide enough that its longest word fits the
    shape's text area (geo.shapeInset) and tall enough that every line does."""
    px, text = _px(it), it.get("text", "")
    kind = it.get("kind", "rounded") if it["type"] == "box" else "rect"
    k = 1.3 if kind not in ("rect", "rounded", "pill") else 1.0
    word = max((len(w) for w in re.split(r"\s+", _plain(text))), default=0) * CHAR_W * px
    lo = math.ceil(60 * k)

    def height(w):
        h = lo
        for _ in range(400):
            ins = inset(kind, w, h)
            tw, th, _l = measure(text, px, ins[2])
            if (ins[3] >= th and ins[2] >= tw) or h > 20_000:
                break
            h += max(2, math.ceil(th - ins[3]))
        return h

    if "w" not in it:
        w = max(120, math.ceil(min(720.0, 180.0 * max(1.0, px / 16)) * k))
        for _ in range(60):  # the longest word on one line (the inset's width depends on the height a little)
            if inset(kind, w, max(lo, w * 0.6))[2] >= word or w >= 4000:
                break
            w += max(4, math.ceil(word - inset(kind, w, max(lo, w * 0.6))[2]))
        # A shape whose text area is a small middle (diamond, ellipse, cloud, ...) grows both ways with
        # long text instead of turning into a tall sliver.
        for _ in range(12):
            if kind in ("rect", "rounded") or height(w) <= w * 0.75 or w >= 720:
                break
            w = math.ceil(w * 1.15)
        it["w"] = w
    h = height(it["w"])
    if "h" not in it or (grow_only and it["h"] < h):
        it["h"] = h


def table_layout(it: dict) -> tuple:
    """(column widths, row heights) of a table: cells at body size, the header bold, min column 80,
    10 x 8 padding."""
    rows = it["rows"]
    n = len(rows[0])
    colw = list(it.get("colw") or [])
    if len(colw) != n:
        colw = [min(360, max(80, math.ceil(max(measure(r[c], 16, None, i == 0)[0] for i, r in enumerate(rows)) + 20))) for c in range(n)]
    wrap = [max(8, w - 20) for w in colw]
    rowh = [math.ceil(max(measure(r[c], 16, wrap[c], i == 0)[1] for c in range(n)) + 16) for i, r in enumerate(rows)]
    return colw, rowh


def _viewbox(svg: str) -> Optional[tuple]:
    m = re.search(r"viewBox\s*=\s*[\"']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)", svg)
    try:
        return (float(m.group(3)), float(m.group(4))) if m else None
    except ValueError:
        return None


def _size(it: dict) -> None:
    """Give an item the width and height it came without."""
    t = it["type"]
    if t in ("box", "note"):
        _fit_box(it)
    elif t == "section":
        it.setdefault("w", 480)
        it.setdefault("h", 320)
    elif t in ("image", "drawing"):
        vb = _viewbox(it["svg"]) if t == "drawing" else None
        ratio = vb[1] / vb[0] if vb and vb[0] > 0 and vb[1] > 0 else 0.75
        if "w" not in it:
            it["w"] = round(it["h"] / ratio) if "h" in it else 240
        it.setdefault("h", max(8, round(it["w"] * ratio)))
    elif t == "embed":
        it.setdefault("w", 320)
        it.setdefault("h", 240)


def rect(it: dict) -> Optional[tuple]:
    """(x, y, w, h) of a placed item; None for an arrow (it follows what it joins)."""
    t = it["type"]
    if t == "arrow" or "x" not in it:
        return None
    if t == "pen":  # its points are relative to (x, y) and may reach left of or above it
        p = it["points"]
        return (it["x"] + min(p[0::2]), it["y"] + min(p[1::2]), *_wh(it))
    return (it["x"], it["y"], *_wh(it))


def _wh(it: dict) -> tuple:
    t = it["type"]
    if t == "text":
        w, h, _ = measure(it.get("text", ""), _px(it), it.get("w"))
        return (it.get("w") or max(8, math.ceil(w)), max(8, math.ceil(h)))
    if t == "table":
        colw, rowh = table_layout(it)
        return (sum(colw), sum(rowh))
    if t == "pen":
        p = it["points"]
        return (max(1, max(p[0::2]) - min(p[0::2])), max(1, max(p[1::2]) - min(p[1::2])))
    return (it.get("w", 0), it.get("h", 0))


def _centre_in(r: tuple, box: tuple) -> bool:
    cx, cy = r[0] + r[2] / 2, r[1] + r[3] / 2
    return box[0] <= cx <= box[0] + box[2] and box[1] <= cy <= box[1] + box[3]


def members(section: dict, items: list) -> list:
    """The items whose centre lies inside the section (not the sections that hold it)."""
    box = rect(section)
    out = []
    for it in items:
        r = rect(it)
        if r is None or it is section or it["id"] == section["id"]:
            continue
        if it["type"] == "section" and r[2] * r[3] >= box[2] * box[3]:
            continue
        if _centre_in(r, box):
            out.append(it)
    return out


# ----------------------------------------------------------------------------- validation

def _num(v, where: str, lo: float = -1_000_000, hi: float = 1_000_000):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
        raise _bad(f"{where}: a number from {lo:g} to {hi:g}")
    r = round(float(v), 2)
    return int(r) if r == int(r) else r


def _text(v, where: str, limit: int = MAX_TEXT) -> str:
    if not isinstance(v, str):
        raise _bad(f"{where}: text")
    if len(v) > limit:
        raise _bad(f"{where}: at most {limit} characters", "too_large")
    return v.replace("\r\n", "\n").replace("\r", "\n")


def _one_of(v, options: tuple, where: str) -> str:
    if v not in options:
        raise _bad(f"{where}: one of {', '.join(options)}")
    return v


def _color(v, palette: tuple, where: str) -> str:
    if isinstance(v, str) and (v in palette or _HEX.match(v)):
        return v
    raise _bad(f"{where}: one of {', '.join(palette)}, or #rrggbb")


def _flag(v, where: str) -> bool:
    if not isinstance(v, bool):
        raise _bad(f"{where}: true or false")
    return v


def _point(v, where: str) -> list:
    if not isinstance(v, (list, tuple)) or len(v) != 2:
        raise _bad(f"{where}: a point [x, y]")
    return [_num(v[0], where), _num(v[1], where)]


def _end(v, where: str):
    if isinstance(v, str):
        if not _ID.match(v):
            raise _bad(f"{where}: an item id or a point [x, y]")
        return v
    return _point(v, where)


def safe_drawing(svg, where: str) -> str:
    """A drawing's SVG, static and self-contained (store.safe_svg, and no outside url() or @import)."""
    if not isinstance(svg, str):
        raise _bad(f"{where}: one whole <svg viewBox=…>")
    if len(svg.encode("utf-8")) > MAX_SVG:
        raise _bad(f"{where}: an SVG of at most {MAX_SVG // 1000} KB", "too_large")
    if svg.lstrip().startswith("data:"):
        raise _bad(f"{where}: the SVG's text, not a data: URI")
    try:
        text = store.safe_svg(where, svg)
    except ValueError as e:
        raise _bad(str(e))
    low = text.lower()
    if "@import" in low:
        raise _bad(f"{where}: an SVG may not @import")
    for m in _CSS_URL.finditer(text):
        ref = m.group(1).strip().lower()
        if not (ref.startswith("#") or ref.startswith("data:image/")):
            raise _bad(f"{where}: an SVG may point only at its own #fragments or data:image/ URIs")
    if _viewbox(text) is None:
        raise _bad(f"{where}: the <svg> needs a viewBox")
    return text


def _rows(v, where: str) -> list:
    if not isinstance(v, list) or not v or not all(isinstance(r, list) for r in v):
        raise _bad(f'{where}: rows like [["Plan", "Price"], ["Pro", "$20"]] (row 1 is the header)')
    n = max(len(r) for r in v)
    if not n:
        raise _bad(f"{where}: a table needs a column")
    if len(v) > MAX_ROWS or n > MAX_COLS:
        raise _bad(f"{where}: at most {MAX_ROWS} rows x {MAX_COLS} columns", "too_large")
    out = []
    for i, r in enumerate(v):
        row = []
        for j in range(n):
            c = r[j] if j < len(r) else ""
            if c is None:
                c = ""
            elif isinstance(c, bool) or not isinstance(c, (str, int, float)):
                raise _bad(f"{where}[{i}][{j}]: text")
            row.append(_text(str(c), f"{where}[{i}][{j}]"))
        out.append(row)
    return out


def _field(t: str, k: str, v, where: str):
    w = f"{where}.{k}"
    if k in ("w", "h"):
        return _num(v, w, 8, 20_000)
    if k in ("text", "label"):
        return _text(v, w)
    if k == "title":
        return _text(v, w, MAX_TITLE)
    if k == "kind":
        return _one_of(v, KINDS, w)
    if k == "color":
        return _color(v, FILLS if t in ("box", "note", "section") else STROKES, w)
    if k == "stroke":
        return _color(v, STROKES, w)
    if k in ("hollow", "dash"):
        return _flag(v, w)
    if k == "size":
        return _one_of(v, tuple(SIZES), w)
    if k == "align":
        return _one_of(v, ALIGNS, w)
    if k in ("from", "to"):
        return _end(v, w)
    if k in ("fromSide", "toSide"):
        return _one_of(v, SIDES, w)
    if k == "heads":
        if not isinstance(v, list) or len(v) != 2:
            raise _bad(f"{w}: [start, end], each one of {', '.join(HEADS)}")
        return [_one_of(x, HEADS, w) for x in v]
    if k == "via":
        if not isinstance(v, list) or len(v) > MAX_VIA:
            raise _bad(f"{w}: at most {MAX_VIA} points [[x, y], …]")
        return [_point(p, w) for p in v]
    if k == "points":
        if not isinstance(v, list) or len(v) < 2 or len(v) % 2 or len(v) > MAX_POINTS:
            raise _bad(f"{w}: [x0, y0, x1, y1, …], at most {MAX_POINTS} numbers")
        return [_num(p, w) for p in v]
    if k == "width":
        return _num(v, w, 1, 40)
    if k == "rows":
        return _rows(v, w)
    if k == "colw":
        if not isinstance(v, list) or len(v) > MAX_COLS:
            raise _bad(f"{w}: one width per column")
        return [_num(x, w, 40, 2000) for x in v]
    if k == "src":
        if isinstance(v, str) and _SRC_FILE.match(v):
            return v
        m = _SRC_DATA.match(v) if isinstance(v, str) else None
        if not m or len(m.group(2)) * 3 // 4 > MAX_IMG:
            raise _bad(f"{w}: an image file in the artifact (images/x.png) or a data:image/png|jpeg|webp URI of at most 100 KB")
        return v
    if k == "svg":
        return safe_drawing(v, w)
    if k == "html":
        return _text(v, w, MAX_HTML)
    if k == "state":
        if not isinstance(v, dict):
            raise _bad(f"{w}: an object")
        if len(json.dumps(v, ensure_ascii=False)) > MAX_STATE:
            raise _bad(f"{w}: at most {MAX_STATE} characters of JSON", "too_large")
        return v
    raise _bad(f"{where}: unknown field {k!r}")


def clean_item(raw, where: str, hints_ok: bool = True) -> tuple:
    """(the item as stored, its input-only hints {in, near, layout}); BoardError with what is wrong."""
    if not isinstance(raw, dict):
        raise _bad(f"{where}: an item is an object like {{\"type\": \"box\", \"text\": \"…\"}}")
    t = raw.get("type")
    if t not in TYPES:
        raise _bad(f"{where}.type: one of {', '.join(TYPES)}")
    out, hints = {}, {}
    if raw.get("id") is not None:
        if not isinstance(raw["id"], str) or not _ID.match(raw["id"]):
            raise _bad(f"{where}.id: 1-40 of A-Z a-z 0-9 _ . -")
        out["id"] = raw["id"]
    out["type"] = t
    for k in REQUIRED.get(t, ()):
        if raw.get(k) is None:
            raise _bad(f"{where}: a {t} needs {k}")
    for k, v in raw.items():
        if k in ("id", "type") or v is None or k in DERIVED.get(t, ()):
            continue
        if k in ("x", "y"):
            out[k] = _num(v, f"{where}.{k}")
        elif k == "locked":
            if _flag(v, f"{where}.locked"):
                out[k] = True
        elif k == "group":
            if not isinstance(v, str) or not _ID.match(v):
                raise _bad(f"{where}.group: a group id")
            out[k] = v
        elif k in ("in", "near") and hints_ok and t != "arrow":
            if not isinstance(v, str) or not _ID.match(v):
                raise _bad(f"{where}.{k}: an item id")
            hints[k] = v
        elif k == "layout" and hints_ok and t == "section":
            hints[k] = _one_of(v, LAYOUTS, f"{where}.layout")
        elif k in FIELDS[t]:
            out[k] = _field(t, k, v, where)
        else:
            raise _bad(f"{where}: a {t} has no {k!r} (it takes {', '.join(FIELDS[t])})")
    if t != "arrow" and ("x" in out) != ("y" in out):
        raise _bad(f"{where}: x and y go together (leave both out and the item is placed for you)")
    if t == "table" and "colw" in out and len(out["colw"]) != len(out["rows"][0]):
        raise _bad(f"{where}.colw: one width per column ({len(out['rows'][0])})")
    if t == "arrow" and out["from"] == out["to"] and isinstance(out["from"], str):
        raise _bad(f"{where}: an arrow joins two different items")
    if len(json.dumps(out, ensure_ascii=False)) > MAX_ITEM_BYTES:
        raise _bad(f"{where}: an item is at most {MAX_ITEM_BYTES // 1000} KB", "too_large")
    return out, hints


def _check_refs(items: list) -> None:
    by = {it["id"]: it for it in items}
    for it in items:
        if it["type"] != "arrow":
            continue
        for k in ("from", "to"):
            v = it[k]
            if isinstance(v, str) and (v not in by or by[v]["type"] == "arrow"):
                raise _bad(f"arrow {it['id']}: {k} names no item {v!r} (an item's id, not an arrow, or a point [x, y])")


def _check_limits(items: list) -> None:
    if len(items) > MAX_ITEMS:
        raise _bad(f"a board holds at most {MAX_ITEMS} items", "too_large")
    if len(json.dumps(items, ensure_ascii=False, separators=(",", ":"))) > MAX_BOARD_BYTES:
        raise _bad(f"a board is at most {MAX_BOARD_BYTES // 1_000_000} MB", "too_large")


# ----------------------------------------------------------------------------- placement

def _hit(r: tuple, occ: list, skip: tuple = (), m: float = 8) -> Optional[tuple]:
    """The first occupied rect ``r`` comes closer to than ``m``."""
    for o in occ:
        if o[4] in skip:
            continue
        if r[0] < o[0] + o[2] + m and o[0] < r[0] + r[2] + m and r[1] < o[1] + o[3] + m and o[1] < r[1] + r[3] + m:
            return o
    return None


def _occ(it: dict) -> Optional[tuple]:
    """An item's footprint (a section's includes its title above), tagged with its id."""
    r = rect(it)
    if r is None:
        return None
    if it["type"] == "section":
        return (r[0], r[1] - SEC_TITLE, r[2], r[3] + SEC_TITLE, it["id"])
    return (*r, it["id"])


def _flow(units: list, edges: list, direction: str, band: int = BAND, back_out: Optional[set] = None) -> tuple:
    """A layered layout of ``units`` ([{key, w, h}]) joined by ``edges`` ([(from key, to key, labelled)]):
    longest-path layers, barycentre order within a layer, columns 64 apart (144 where an arrow there has
    a label), 24 between rows; after ``band`` layers it wraps to a new row starting at the left again.
    -> ({key: (x, y)}, width, height). ``direction`` "down" swaps the axes. ``back_out`` gets each edge
    as (from, to, direction, closes a loop)."""
    keys = [u["key"] for u in units]
    size = {u["key"]: ((u["w"], u["h"]) if direction == "right" else (u["h"], u["w"])) for u in units}
    out_e = {k: [] for k in keys}
    for a, b, _lab in edges:
        if b not in out_e[a]:
            out_e[a].append(b)
    # Arrows that close a loop are left out of the layering (found depth first, in the given order).
    # Arrows that close a loop are found depth first from the starts (no arrow in), then the rest in
    # the order the units stood along the flow (``pos``, a tidy) or were given.
    indeg = {k: 0 for k in keys}
    for a, b, _lab in edges:
        indeg[b] += 1
    at_pos = {u["key"]: (u["pos"][0 if direction == "right" else 1] if u.get("pos") else math.inf) for u in units}
    roots = sorted(keys, key=lambda k: (indeg[k] > 0, at_pos[k]))
    state, back = {}, set()
    for root in roots:
        if root in state:
            continue
        stack = [(root, iter(out_e[root]))]
        state[root] = 1
        while stack:
            node, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                state[node] = 2
                stack.pop()
            elif state.get(nxt) == 1:
                back.add((node, nxt))
            elif nxt not in state:
                state[nxt] = 1
                stack.append((nxt, iter(out_e[nxt])))
    fwd = [(a, b, lab) for a, b, lab in edges if (a, b) not in back]
    layer = {k: 0 for k in keys}
    for _ in range(len(keys)):
        moved = False
        for a, b, _lab in fwd:
            if layer[b] < layer[a] + 1:
                layer[b] = layer[a] + 1
                moved = True
        if not moved:
            break
    n_layers = max(layer.values()) + 1
    layers = [[k for k in keys if layer[k] == i] for i in range(n_layers)]
    nb = {k: [] for k in keys}
    for a, b, _lab in fwd:
        nb[a].append(b)
        nb[b].append(a)
    for sweep in range(4):
        order = range(1, n_layers) if sweep % 2 == 0 else range(n_layers - 2, -1, -1)
        for i in order:
            ref = layers[i - 1] if sweep % 2 == 0 else layers[i + 1]
            pos = {k: j for j, k in enumerate(ref)}
            cur = {k: j for j, k in enumerate(layers[i])}

            def bary(k):
                ns = [pos[n] for n in nb[k] if n in pos]
                return (sum(ns) / len(ns) if ns else cur[k], cur[k])
            layers[i] = sorted(layers[i], key=bary)
    if back_out is not None:
        back_out.update((a, b, direction, (a, b) in back) for a, b, _lab in edges)
    # A labelled arrow widens the gap it crosses (not one closing a loop: that goes round below).
    labelled = [(min(layer[a], layer[b]), max(layer[a], layer[b])) for a, b, lab in fwd if lab]
    kids = {k: [] for k in keys}
    for a, b, _lab in fwd:
        if layer[b] == layer[a] + 1 and b not in kids[a]:
            kids[a].append(b)
    at, cross0, total_main = {}, 0.0, 0.0
    for b0 in range(0, n_layers, band):
        cols = layers[b0:b0 + band]
        stacks = [sum(size[k][1] for k in col) + GAP * (len(col) - 1) for col in cols]
        tall = max(stacks)
        cr = {}
        for j, col in enumerate(cols):
            c = (tall - stacks[j]) / 2
            for k in col:
                cr[k] = c
                c += size[k][1] + GAP
        # A parent centred on its children (a tree reads down its branches), deepest layer first; the
        # layer then keeps its order, 24 apart.
        for j in range(len(cols) - 2, -1, -1):
            col, moved = cols[j], False
            want = []
            for k in col:
                ch = [n for n in kids[k] if n in cr and layer[n] == b0 + j + 1]
                if ch:
                    moved = True
                    want.append(sum(cr[n] + size[n][1] / 2 for n in ch) / len(ch) - size[k][1] / 2)
                else:
                    want.append(cr[k])
            if not moved:
                continue
            for i in range(1, len(col)):
                want[i] = max(want[i], want[i - 1] + size[col[i - 1]][1] + GAP)
            for k, v in zip(col, want):
                cr[k] = v
        lo = min(cr.values())
        tall = max(cr[k] - lo + size[k][1] for k in cr)
        main = 0.0
        for j, col in enumerate(cols):
            li = b0 + j
            wide = max(size[k][0] for k in col)
            for k in col:
                at[k] = (main + (wide - size[k][0]) / 2, cross0 + cr[k] - lo)
            main += wide
            if j < len(cols) - 1:
                main += LABEL_GAP if any(lo <= li < hi for lo, hi in labelled) else COL_GAP
        total_main = max(total_main, main)
        cross0 += tall
        if b0 + band < n_layers:
            last = b0 + band - 1
            cross0 += LABEL_GAP if any(lo <= last < hi for lo, hi in labelled) else COL_GAP
    if direction == "right":
        return {k: (round(x), round(y)) for k, (x, y) in at.items()}, math.ceil(total_main), math.ceil(cross0)
    return {k: (round(y), round(x)) for k, (x, y) in at.items()}, math.ceil(cross0), math.ceil(total_main)


def _arrange(units: list, edges: list, layout: str, flow: str, auto: bool = False, back_out: Optional[set] = None) -> tuple:
    """Units side by side as a section lays them out -> ({key: (x, y)}, width, height). Members joined
    by arrows flow (a column flows down; ``auto``, a layout the server chose: the board's way); the
    rest sit in a row, a column or a grid, 24 apart."""
    if not units:
        return {}, 0, 0
    keys = {u["key"] for u in units}
    inner = [(a, b, lab) for a, b, lab in edges if a in keys and b in keys and a != b]
    if inner:
        linked = {k for e in inner for k in e[:2]}
        direction = flow if auto else "down" if layout == "column" else "right" if layout == "row" else flow
        at, w, h = _flow([u for u in units if u["key"] in linked], inner, direction, 3 if layout == "grid" else BAND, back_out)
        rest = [u for u in units if u["key"] not in linked]
        if rest:  # the unlinked ones in a row under the flow
            at2, w2, h2 = _arrange(rest, [], "row", flow)
            for k, (x, y) in at2.items():
                at[k] = (x, y + h + GAP)
            w, h = max(w, w2), h + GAP + h2
        return at, w, h
    at = {}
    if layout == "column":
        y, wide = 0, max(u["w"] for u in units)
        for u in units:
            at[u["key"]] = ((wide - u["w"]) / 2, y)  # centred on one line
            y += u["h"] + GAP
        return at, wide, y - GAP
    if layout == "grid":
        n = math.ceil(math.sqrt(len(units)))
        cw, ch = max(u["w"] for u in units), max(u["h"] for u in units)
        for i, u in enumerate(units):
            at[u["key"]] = ((i % n) * (cw + GAP), (i // n) * (ch + GAP))
        rows = math.ceil(len(units) / n)
        return at, min(n, len(units)) * (cw + GAP) - GAP, rows * (ch + GAP) - GAP
    x = 0
    for u in units:
        at[u["key"]] = (x, 0)
        x += u["w"] + GAP
    return at, x - GAP, max(u["h"] for u in units)


def _beside(target: tuple, w: float, h: float, occ: list, gap: float, skip: tuple = (), floor: Optional[tuple] = None) -> tuple:
    """A free spot for a w x h block next to ``target`` (x, y, w, h): right of it, under it, left, above,
    then further out the same way. ``floor``: the least x and y allowed (inside a section)."""
    tx, ty, tw, th = target[:4]
    for k in range(60):
        d = gap + k * (GAP + 16)
        for x, y in ((tx + tw + d, ty), (tx, ty + th + d), (tx - w - d, ty), (tx, ty - h - d),
                     (tx + tw + d, ty + th + d)):
            if floor and (x < floor[0] or y < floor[1]):
                continue
            if not _hit((x, y, w, h), occ, skip):
                return round(x), round(y)
    return round(tx + tw + gap), round(ty)


def _place(new: list, arrows: list, hints: dict, existing: list, flow: str = "right", near: Optional[str] = None,
           origin: Optional[tuple] = None, was: Optional[dict] = None) -> set:
    """Size and place the items of ``new`` that came without coordinates (in place). ``arrows``: the
    arrows that may join them; ``existing``: what is on the board already and stays where it is.
    -> ids of existing items it had to change (a section grown around a new member)."""
    grown = set()
    by = {it["id"]: it for it in existing}
    by.update({it["id"]: it for it in new})
    tall_ok = {it["id"] for it in new if it["type"] == "note" and "h" not in it and "x" not in it}  # sized and placed here
    for it in new:
        if it["type"] != "arrow" and not (it["type"] == "section" and "x" not in it):
            _size(it)
    todo = [it for it in new if it["type"] != "arrow" and "x" not in it]
    if not todo:
        return grown
    todo_ids = {it["id"] for it in todo}

    def target(name, where, kind=None):
        t = by.get(name)
        if t is None or t["type"] == "arrow" or (kind and t["type"] != kind):
            raise _bad(f"{where}: no {kind or 'item'} {name!r}")
        return t

    inside = {}  # section id -> its unplaced members, in order
    for it in todo:
        sec = hints.get(it["id"], {}).get("in")
        if sec:
            if it["type"] == "section":
                raise _bad(f"{it['id']}: a section goes in another by its coordinates, not by `in`")
            target(sec, f"{it['id']}.in", "section")
            inside.setdefault(sec, []).append(it)
    member_of = {m["id"]: s for s, ms in inside.items() for m in ms}
    if near is not None:
        target(near, "near")

    # The title lines given first stay at the top-left.
    head = []
    if new and new[0]["id"] in todo_ids and new[0]["type"] == "text" and new[0].get("size") == "title" \
            and not hints.get(new[0]["id"]):
        head.append(new[0])
        if len(new) > 1 and new[1]["id"] in todo_ids and new[1]["type"] == "text" and new[1].get("size") == "large" \
                and "\n" not in new[1].get("text", "") and not hints.get(new[1]["id"]):
            head.append(new[1])
    head_ids = {it["id"] for it in head}

    links = []  # (from id, to id, labelled) of the arrows between items
    for a in arrows:
        if isinstance(a["from"], str) and isinstance(a["to"], str) and a["from"] in by and a["to"] in by:
            links.append((a["from"], a["to"], bool(a.get("label"))))

    def unit_of(it):
        w, h = _wh(it)
        return {"key": it["id"], "w": w, "h": h, "parts": [(it, 0, 0)], "pos": (was or {}).get(it["id"])}

    # An unplaced section is one block with the members put in it; a placed one takes them later.
    # With no layout given, a section whose members are joined to things outside it stands across the
    # flow (a column in a flow to the right, a row in one going down), so the arrows leave it cleanly.
    units, late, loops, columns = [], [], set(), []
    for it in todo:
        if it["id"] in head_ids or it["id"] in member_of:
            continue
        if it["type"] != "section":
            units.append(unit_of(it))
            continue
        ms = [unit_of(m) for m in inside.get(it["id"], [])]
        if ms:
            layout = hints.get(it["id"], {}).get("layout")
            mine = {m["key"] for m in ms} | {it["id"]}
            auto = layout is None and any((a in mine) != (b in mine) for a, b, _l in links)
            if layout is None:
                layout = ("column" if flow == "right" else "row") if auto else "row"
            if auto and not any(a in mine and b in mine for a, b, _l in links):
                columns.append((it, ms, layout))
            at, w, h = _arrange(ms, links, layout, flow, auto, loops)
            # room inside the frame for an arrow that loops round below (beside) its members, and its label
            for e in loops:
                if e[3] and e[0] in mine and e[1] in mine:
                    h, w = (h + 40, w) if e[2] == "right" else (h, w + 40)
                    break
            it["w"] = max(it.get("w", 0), w + 2 * SEC_PAD)
            it["h"] = max(it.get("h", 0), h + 2 * SEC_PAD)
            parts = [(it, 0, SEC_TITLE)] + [(m["parts"][0][0], SEC_PAD + at[m["key"]][0], SEC_TITLE + SEC_PAD + at[m["key"]][1]) for m in ms]
        else:
            _size(it)
            parts = [(it, 0, SEC_TITLE)]
        units.append({"key": it["id"], "w": it["w"], "h": it["h"] + SEC_TITLE, "parts": parts, "pos": (was or {}).get(it["id"])})
    for sec, ms in inside.items():
        if sec not in todo_ids:
            late.append((by[sec], ms))
    owner = {p[0]["id"]: u["key"] for u in units for p in u["parts"]}

    # Arrows between blocks make the flow; an arrow to something already placed says where a block belongs.
    edges, anchor = [], {}
    for a, b, lab in links:
        ua, ub = owner.get(a), owner.get(b)
        if ua and ub:
            if ua != ub:
                edges.append((ua, ub, lab))
        elif ua and b not in todo_ids:
            anchor.setdefault(ua, b)
        elif ub and a not in todo_ids:
            anchor.setdefault(ub, a)
    linked = {k for e in edges for k in e[:2]}
    comp = {k: k for k in linked}

    def find(k):
        while comp[k] != k:
            comp[k] = comp[comp[k]]
            k = comp[k]
        return k
    for a, b, _lab in edges:
        comp[find(a)] = find(b)

    occ = [o for o in (_occ(it) for it in list(existing) + [n for n in new if n["id"] not in todo_ids]) if o]
    if origin is None:
        origin = (min(o[0] for o in occ), max(o[1] + o[3] for o in occ) + COL_GAP) if occ else ORIGIN
    ox, y = origin

    def put(u, x, y):
        for it, dx, dy in u["parts"]:
            it["x"], it["y"] = round(x + dx), round(y + dy)
        occ.append((x, y, u["w"], u["h"], u["key"]))

    def near_of(u):
        for it, _dx, _dy in u["parts"]:
            n = hints.get(it["id"], {}).get("near")
            if n:
                return target(n, f"{it['id']}.near")
        return None

    def put_near(u, t, gap):
        if "x" not in t:
            raise _bad(f"near {t['id']!r}: it has no place yet (name something already on the board)")
        tr = rect(t)
        # A neighbour of something inside a section goes inside it too (the section grows to hold it).
        homes = [s for s in by.values() if s["type"] == "section" and "x" in s and s is not t and _centre_in(tr, rect(s))]
        home = min(homes, key=lambda s: s["w"] * s["h"]) if homes else None
        floor = (home["x"] + SEC_PAD, home["y"] + SEC_PAD) if home else None
        x, yy = _beside(tr, u["w"], u["h"], occ, gap, tuple(s["id"] for s in homes), floor)
        put(u, x, yy)
        if home:
            _grow(home, (x, yy, u["w"], u["h"]))

    def _grow(sec, r):
        w = max(sec["w"], math.ceil(r[0] + r[2] + SEC_PAD - sec["x"]))
        h = max(sec["h"], math.ceil(r[1] + r[3] + SEC_PAD - sec["y"]))
        if (w, h) != (sec["w"], sec["h"]):
            sec["w"], sec["h"] = w, h
            if sec["id"] not in todo_ids and not any(sec is n for n in new):
                grown.add(sec["id"])

    for i, it in enumerate(head):
        w, h = _wh(it)
        for _ in range(100):  # under what stays where it is (a locked item at the top)
            o = _hit((ox, y, w, h), occ)
            if not o:
                break
            y = o[1] + o[3] + GAP
        it["x"], it["y"] = round(ox), round(y)
        occ.append((ox, y, w, h, it["id"]))
        y += h + (12 if i < len(head) - 1 else HEAD_GAP)

    # Flow blocks, one connected group after another.
    groups = {}
    for u in units:
        if u["key"] in linked:
            groups.setdefault(find(u["key"]), []).append(u)
    for us in groups.values():
        keys = {u["key"] for u in us}
        # A section counts its title room under it too, so its frame lines up with its neighbours' centres.
        fus = [{**u, "h": u["h"] + SEC_TITLE} if u["parts"][0][0]["type"] == "section" else u for u in us]
        at, w, h = _flow(fus, [e for e in edges if e[0] in keys], flow, BAND, loops)
        block = {"key": us[0]["key"], "w": w, "h": h,
                 "parts": [(it, at[u["key"]][0] + dx, at[u["key"]][1] + dy) for u in us for it, dx, dy in u["parts"]]}
        t = next((n for n in (near_of(u) for u in us) if n), None) or (by.get(near) if near else None)
        if t is None:  # joined to something already on the board: beside it
            t = next((by[anchor[u["key"]]] for u in us if u["key"] in anchor and "x" in by[anchor[u["key"]]]), None)
        if t is not None:
            put_near(block, t, COL_GAP)
            continue
        yy = y
        while True:
            o = _hit((ox, yy, w, h), occ)
            if not o:
                break
            yy = o[1] + o[3] + GAP
        put(block, ox, yy)
        y = yy + h + COL_GAP

    # The rest: beside what they name or are joined to, else a row that wraps.
    x, row_h = ox, 0
    for u in units:
        if u["key"] in linked:
            continue
        t = near_of(u) or (by.get(near) if near else None)
        if t is None and u["key"] in anchor:
            t = by[anchor[u["key"]]]
            if "x" in t:
                put_near(u, t, COL_GAP)
                continue
            t = None
        if t is not None:
            put_near(u, t, GAP)
            continue
        for _ in range(200):
            if x > ox and x + u["w"] > ox + WRAP_AT:
                x, y, row_h = ox, y + row_h + GAP, 0
            o = _hit((x, y, u["w"], u["h"]), occ)
            if not o:
                break
            x = o[0] + o[2] + GAP
            if x + u["w"] > ox + WRAP_AT:
                x, y, row_h = ox, max(y + row_h, o[1] + o[3]) + GAP, 0
        put(u, x, y)
        x += u["w"] + GAP
        row_h = max(row_h, u["h"])

    # New members of a section that is already placed: in the free room inside it, growing it if needed.
    for sec, ms in late:
        us = [unit_of(m) for m in ms]
        at, w, h = _arrange(us, links, hints.get(sec["id"], {}).get("layout", "row"), flow, False, loops)
        block = {"key": us[0]["key"], "w": w, "h": h, "parts": [(u["parts"][0][0], *at[u["key"]]) for u in us]}
        sr = rect(sec)
        mine = [o for o in occ if o[4] != sec["id"] and _centre_in(o, sr)]
        spot = None
        yy = sec["y"] + SEC_PAD
        while spot is None and yy + h <= sec["y"] + sec["h"] - SEC_PAD + 0.5:
            xx = sec["x"] + SEC_PAD
            while xx + w <= sec["x"] + sec["w"] - SEC_PAD + 0.5:
                if not _hit((xx, yy, w, h), mine):
                    spot = (xx, yy)
                    break
                xx += GAP
            yy += GAP
        if spot is None:
            spot = (sec["x"] + SEC_PAD, max([o[1] + o[3] + GAP for o in mine] + [sec["y"] + SEC_PAD]))
        put(block, *spot)
        _grow(sec, (*spot, w, h))

    # A column (or row) a section chose itself: its members in the order of what they are joined to
    # outside it, so the arrows between sections do not cross.
    ax = 1 if flow == "right" else 0
    for _sweep in range(2):
        for _sec, ms, _lay in columns:
            mem = [m["parts"][0][0] for m in ms]
            ids = {m["id"] for m in mem}

            def bary(m):
                ns = [b if a == m["id"] else a for a, b, _l in links if (a == m["id"]) != (b == m["id"])
                      and (a == m["id"] or b == m["id"]) and (b if a == m["id"] else a) not in ids]
                cs = [rect(by[n])[ax] + rect(by[n])[ax + 2] / 2 for n in ns if n in by and rect(by[n])]
                return (sum(cs) / len(cs) if cs else rect(m)[ax] + rect(m)[ax + 2] / 2, rect(m)[ax])
            order = sorted(mem, key=bary)
            pos = min(rect(m)[ax] for m in mem)
            for m in order:
                m["xy"[ax]] = round(pos)
                pos += rect(m)[ax + 2] + GAP

    # An arrow that closes a loop goes round under the row (beside the column, in a flow going down),
    # not back through it; in a flow going down the others leave a block's bottom for the next one's
    # top (a tree reads down its branches even where a row is wide).
    for a in arrows:
        if a.get("fromSide") or a.get("toSide") or a.get("via") or not (isinstance(a["from"], str) and isinstance(a["to"], str)):
            continue
        if a["from"] not in todo_ids or a["to"] not in todo_ids:
            continue
        e = next((e for e in loops if e[:2] == (a["from"], a["to"])), None)
        if not e:
            continue
        if e[3]:
            a["fromSide"] = a["toSide"] = "bottom" if e[2] == "right" else "right"
        elif e[2] == "down":
            a["fromSide"], a["toSide"] = "bottom", "top"
        else:
            continue
        if not any(a is n for n in new):
            grown.add(a["id"])

    # Notes laid side by side in one row (of the board, or of one section) take the tallest one's
    # height, so a row whose notes wrap differently does not look ragged.
    rows = {}
    for it in new:
        if it["id"] in tall_ok and "y" in it:
            rows.setdefault((round(it["y"]), member_of.get(it["id"])), []).append(it)
    for row in rows.values():
        if len(row) > 1:
            top = max(it["h"] for it in row)
            for it in row:
                it["h"] = top
    return grown


# ----------------------------------------------------------------------------- building

def _next_id(taken: set, seq: int, prefix: str = "e") -> tuple:
    while True:
        seq += 1
        if f"{prefix}{seq}" not in taken:
            return f"{prefix}{seq}", seq


def _add(items: list, seq: int, raw, flow: str, near: Optional[str], where: str) -> tuple:
    """Validate, name, place and insert new items. -> (ids added, ids of existing items changed, seq)."""
    if not isinstance(raw, list) or not all(isinstance(r, dict) for r in raw):
        raise _bad(f"{where}: a list of items")
    if flow not in FLOWS:
        raise _bad(f"flow: one of {', '.join(FLOWS)}")
    if len(items) + len(raw) > MAX_ITEMS:
        raise _bad(f"a board holds at most {MAX_ITEMS} items", "too_large")
    taken = {it["id"] for it in items}
    new, hints, spots = [], {}, {}
    for i, r in enumerate(raw):
        if "at" in r:  # where in the z-order it goes back (the page undoing a delete); not for the agent
            r = dict(r)
            at = r.pop("at")
            if isinstance(at, bool) or not isinstance(at, int) or not 0 <= at <= MAX_ITEMS:
                raise _bad(f"{where}[{i}].at: an index in the z-order")
            spots[i] = at
        it, h = clean_item(r, f"{where}[{i}]")
        if "id" in it:
            if it["id"] in taken:
                raise _bad(f"{where}[{i}]: the id {it['id']!r} is taken")
            taken.add(it["id"])
        new.append((it, h))
    out = []
    for it, h in new:
        if "id" not in it:
            nid, seq = _next_id(taken, seq)
            taken.add(nid)
            it = {"id": nid, **it}
        if h:
            hints[it["id"]] = h
        out.append(it)
    _check_refs(items + out)
    grown = _place(out, [it for it in out if it["type"] == "arrow"], hints, items, flow, near)
    # Sections are frames: behind everything; the rest goes on top in the order given. An item with
    # `at` goes to that index (in rising order, so a set of them lands back as it was).
    at = sum(1 for it in items if it["type"] == "section")
    for i, it in enumerate(out):
        if i in spots:
            continue
        if it["type"] == "section":
            items.insert(at, it)
            at += 1
        else:
            items.append(it)
    for i in sorted(spots, key=lambda k: (spots[k], k)):
        items.insert(min(spots[i], len(items)), out[i])
    return [it["id"] for it in out], grown, seq


def from_spec(spec, title: str = "") -> dict:
    """board.json as a live board {title, items, seq}: everything named, sized and placed."""
    if not isinstance(spec, dict) or not isinstance(spec.get("items"), list):
        raise _bad(EXAMPLE)
    extra = set(spec) - {"title", "items", "flow"}
    if extra:
        raise _bad(f"board.json: unknown key {sorted(extra)[0]!r} (title, items, flow)")
    t = spec.get("title", title)
    if not isinstance(t, str):
        raise _bad("board.json: title is text")
    items: list = []
    _ids, _grown, seq = _add(items, 0, spec["items"], spec.get("flow", "right"), None, "items")
    _check_limits(items)
    return {"title": t[:MAX_TITLE], "items": items, "seq": seq}


def check_file(path: Path) -> None:
    """Publish-time check of a board's board.json (ValueError with what is wrong)."""
    try:
        spec = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return  # the store says the entry file is missing
    except (ValueError, UnicodeDecodeError) as e:
        raise ValueError(f"board.json is not valid JSON: {e}")
    try:
        from_spec(spec)
    except BoardError as e:
        raise ValueError(e.message if e.message.startswith("board.json") else "board.json: " + e.message)


# ----------------------------------------------------------------------------- state

_CACHE: dict = {}  # aid -> ((mtime_ns, size), state)


def _state_path(aid: str) -> Path:
    return store._dir(aid) / "board" / "state.json"


def _fresh(aid: str, meta: dict) -> dict:
    board = None
    try:
        board = from_spec(json.loads(store.read_file(aid, "board.json").decode("utf-8-sig")), meta.get("title", ""))
    except (FileNotFoundError, ValueError, UnicodeDecodeError, BoardError):
        pass
    board = board or {"title": meta.get("title", ""), "items": [], "seq": 0}
    return {"version": meta["versions"][-1]["n"], "updated": time.time(), "hermes_at": time.time(), "edits": 0,
            "rev": 1, "log": [], **board}


def load(aid: str) -> dict:
    meta = store.get_meta(aid)
    if not meta or meta.get("type") != "board":
        raise BoardError("absent", "not a board")
    with _LOCK:
        p = _state_path(aid)
        st = None
        if p.is_file():
            s = p.stat()
            stamp = (s.st_mtime_ns, s.st_size)
            hit = _CACHE.get(aid)
            st = hit[1] if hit and hit[0] == stamp else json.loads(p.read_text(encoding="utf-8"))
            _CACHE[aid] = (stamp, st)
        if st is None or st.get("version") != meta["versions"][-1]["n"]:
            st = _fresh(aid, meta)
            _save(aid, st)
        return st


def _save(aid: str, st: dict) -> None:
    p = _state_path(aid)
    p.parent.mkdir(parents=True, exist_ok=True)
    st["updated"] = time.time()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(p)
    s = p.stat()
    _CACHE[aid] = ((s.st_mtime_ns, s.st_size), st)


def outline(aid: str) -> dict:
    """What a just-published board hands Hermes: its rev and how many items it holds."""
    st = load(aid)
    return {"rev": st["rev"], "count": len(st["items"])}


def left(st: dict) -> int:
    """Whole seconds until Hermes no longer counts as at work here (0: not now). The page hides its
    "Hermes is working" pill on its own when they run out, with no read needed."""
    return max(0, math.ceil(ACTIVE_SECS - (time.time() - st.get("hermes_at", 0))))


def _active(st: dict) -> bool:
    return left(st) > 0


# ----------------------------------------------------------------------------- reading

def _ints(v):
    if isinstance(v, float):
        return round(v)
    if isinstance(v, list):
        return [_ints(x) for x in v]
    return v


def compact(it: dict, full: bool = False) -> dict:
    """An item for the agent: defaults left out, numbers whole, and the bulky fields (svg, html, pen
    points, a data: image, a long embed state) as their length unless ``full``."""
    dflt = DEFAULTS.get(it["type"], {})
    out = {}
    for k, v in it.items():
        if k in dflt and dflt[k] == v:
            continue
        if not full:
            if k in _BLOBS:
                v = len(v)
            elif k == "src" and v.startswith("data:"):
                v = len(v)
            elif k == "state" and len(json.dumps(v, ensure_ascii=False)) > 600:
                v = len(json.dumps(v, ensure_ascii=False))
            elif k in ("x", "y", "w", "h", "via", "from", "to", "colw", "width"):
                v = _ints(v)
        out[k] = v
    return out


def _words(it: dict) -> str:
    parts = [it["id"], it.get("text", ""), it.get("label", ""), it.get("title", "")]
    for r in it.get("rows", []):
        parts.extend(r)
    return "\n".join(parts).casefold()


def _since(st: dict, since: int) -> Optional[tuple]:
    """(ids changed, ids removed) after rev ``since``; None when the log no longer reaches back."""
    newer = [e for e in st["log"] if e["rev"] > since]
    oldest = min((e["rev"] for e in st["log"]), default=None)
    if since > st["rev"] or (since < st["rev"] and (oldest is None or oldest > since + 1)) or any(e.get("all") for e in newer):
        return None
    have = {it["id"] for it in st["items"]}
    ids, gone = set(), set()
    for e in newer:
        ids.update(e.get("ids", {}))
        gone.update(e.get("removed", []))
    return {i for i in ids if i in have}, sorted(i for i in gone if i not in have)


def read(aid: str, range: Optional[str] = None, *, since_rev: Optional[int] = None, search: Optional[str] = None,
         agent: bool = False) -> dict:
    """The board. The page's read: every item in full, or what changed since ``since_rev``
    ({changed, removed, order}; {since: "unavailable"} when that is no longer known). ``agent``: items
    compact and capped; ``range``: a comma list of ids to read in full; ``search``: the items holding
    that text; ``since_rev``: the items changed since, and ``removed``."""
    st = load(aid)
    items = st["items"]
    if not agent:
        out = {"rev": st["rev"], "title": st["title"], "hermes_active": _active(st), "hermes_left": left(st), "edits": st.get("edits", 0)}
        if since_rev is None:
            out["items"] = items
            return out
        d = _since(st, int(since_rev))
        if d is None:
            out["since"] = "unavailable"
            return out
        out["changed"] = [it for it in items if it["id"] in d[0]]
        out["removed"] = d[1]
        out["order"] = [it["id"] for it in items]
        return out
    out = {"rev": st["rev"], "title": st["title"], "count": len(items)}
    full = False
    if range:
        want = [x.strip() for x in str(range).split(",") if x.strip()]
        have = {it["id"] for it in items}
        missing = [w for w in want if w not in have]
        if missing:
            raise BoardError("absent", f"no item {missing[0]!r} on the board (range is a comma list of item ids)")
        items, full = [it for it in items if it["id"] in set(want)], True
    elif search:
        q = str(search).casefold()
        items = [it for it in items if q in _words(it)]
    elif since_rev is not None:
        d = _since(st, int(since_rev))
        if d is not None:
            items = [it for it in items if it["id"] in d[0]]
            out["removed"] = d[1]
    out["items"] = [compact(it, full) for it in items[:AGENT_ITEMS]]
    if len(items) > AGENT_ITEMS:
        out["more"] = f"{len(items)} items, the first {AGENT_ITEMS} shown: read the rest with search or range (ids)"
    return out


def dump(aid: str) -> str:
    """The live board as board.json (ha_read without a path)."""
    st = load(aid)
    return json.dumps({"title": st["title"], "items": st["items"]}, ensure_ascii=False, separators=(",", ":"))


# ----------------------------------------------------------------------------- editing

_GUARDED = ("set", "move", "delete", "tidy")


def _ids(o: dict, items: list, where: str, optional: bool = False) -> list:
    v = o.get("ids")
    if v is None and optional:
        return []
    if isinstance(v, str):
        v = [v]
    if not isinstance(v, list) or not v or not all(isinstance(x, str) for x in v):
        raise _bad(f"{where}: ids is a list of item ids")
    have = {it["id"] for it in items}
    for x in v:
        if x not in have:
            raise BoardError("absent", f"{where}: no item {x!r} on the board")
    return list(dict.fromkeys(v))


def _carried(items: list, ids: list) -> list:
    """``ids`` with what moves along: group mates, and the members of the sections among them."""
    by = {it["id"]: it for it in items}
    out = list(ids)
    seen = set(out)
    i = 0
    while i < len(out):
        it = by[out[i]]
        i += 1
        extra = []
        if it.get("group"):
            extra += [x["id"] for x in items if x.get("group") == it["group"]]
        if it["type"] == "section":
            extra += [x["id"] for x in members(it, items)]
        for x in extra:
            if x not in seen:
                seen.add(x)
                out.append(x)
    return out


def _shift(items: list, ids: list, dx, dy) -> None:
    moved = set(ids)
    for it in items:
        if it["type"] == "arrow":
            ends = [it[k] for k in ("from", "to")]
            mine = it["id"] in moved
            if mine:
                for k in ("from", "to"):
                    if not isinstance(it[k], str):
                        it[k] = [_num(it[k][0] + dx, "x"), _num(it[k][1] + dy, "y")]
            if "via" in it and (mine or all(isinstance(e, str) and e in moved for e in ends)):
                it["via"] = [[_num(p[0] + dx, "x"), _num(p[1] + dy, "y")] for p in it["via"]]
        elif it["id"] in moved:
            it["x"], it["y"] = _num(it["x"] + dx, "x"), _num(it["y"] + dy, "y")


def _head(sel: list) -> list:
    """The board's heading among items in reading order: the topmost title-size text and, when there
    is one, the one-line large text that reads as its takeaway (the first below it that starts near it
    and sits close under it), whatever else is large on the board."""
    title = next((it for it in sel if it["type"] == "text" and it.get("size") == "title"), None)
    if title is None:
        return []
    tx, ty, tw, th = rect(title)
    sub = next((it for it in sel if it is not title and it["type"] == "text" and it.get("size") == "large"
                and "\n" not in it.get("text", "") and ty < it["y"] <= ty + th + 160 and abs(it["x"] - tx) <= max(120, tw / 2)),
               None)
    return [title] + ([sub] if sub else [])


def _tidy(items: list, ids: list, flow: str) -> list:
    """Place the named items (or all) again as if they had come without coordinates; locked ones stay."""
    pick = set(ids) if ids else {it["id"] for it in items}
    # A section goes with what is in it; one that holds a locked item stays (so the item stays in it)
    # and only its free members are laid out again inside it.
    for s in [it for it in items if it["type"] == "section" and it["id"] in pick]:
        pick.update(m["id"] for m in members(s, items))
    held = {s["id"] for s in items if s["type"] == "section" and any(m.get("locked") for m in members(s, items))}
    sel = [it for it in items if it["id"] in pick and it["type"] != "arrow" and not it.get("locked") and it["id"] not in held]
    if not sel:
        return []
    all_secs = sorted((s for s in items if s["type"] == "section"), key=lambda s: s["w"] * s["h"])
    homes = {}  # each block's section as it stands now (the smallest that holds its centre)
    for it in sel:
        if it["type"] != "section":
            home = next((s for s in all_secs if _centre_in(rect(it), rect(s))), None)
            if home:
                homes[it["id"]] = home
    # In reading order, the title lines leading: they stay together at the top-left.
    sel.sort(key=lambda it: (it["y"], it["x"]))
    head = _head(sel)
    for it in head:
        homes.pop(it["id"], None)  # a heading is never laid out inside a section
    sel = head + [it for it in sel if it not in head]
    rs = [rect(it) for it in sel]
    origin = (min(r[0] for r in rs), min(r[1] - (SEC_TITLE if it["type"] == "section" else 0) for r, it in zip(rs, sel)))
    sel_ids = {it["id"] for it in sel}
    hints = {i: {"in": s["id"]} for i, s in homes.items()}
    for s in (s for s in sel if s["type"] == "section"):
        if any(h["in"] == s["id"] for h in hints.values()):
            if s["h"] > s["w"] * 1.2:  # a tall one stays a column; else the layout is chosen afresh
                hints.setdefault(s["id"], {})["layout"] = "column"
            s.pop("w", None)
            s.pop("h", None)
    was = {it["id"]: (it["x"], it["y"]) for it in sel}  # where each stood: a loop is broken as it read before
    for it in sel:
        it.pop("x", None)
        it.pop("y", None)
    arrows = [a for a in items if a["type"] == "arrow"]
    changed = list(sel_ids)
    for a in arrows:
        if isinstance(a["from"], str) and isinstance(a["to"], str) and a["from"] in sel_ids and a["to"] in sel_ids:
            if [a.pop(k) for k in ("via", "fromSide", "toSide") if k in a]:  # every one of them
                changed.append(a["id"])
    grown = _place(sel, arrows, hints, [it for it in items if it["id"] not in sel_ids], flow, None, origin, was)
    return changed + list(grown)


def apply(aid: str, ops, *, by: str, base_rev: Optional[int] = None) -> dict:
    """Apply edits to the board, all of them or none (the ops: see the board guide). With ``base_rev``:
    items someone else changed after that rev are not written over (code "conflict").
    -> {ok, rev, changed: [ids], added: [ids]?, removed: [ids]?}."""
    if isinstance(ops, dict):
        ops = [ops]
    if not isinstance(ops, list) or not ops or not all(isinstance(o, dict) for o in ops):
        raise _bad("ops must be a non-empty list of {op: ...} objects")
    if len(ops) > MAX_OPS:
        raise _bad(f"at most {MAX_OPS} ops in one edit", "too_large")
    if by not in ("user", "hermes"):
        raise _bad("bad author")
    with _LOCK:
        st = load(aid)
        work = {"items": copy.deepcopy(st["items"]), "seq": st.get("seq", 0), "title": st["title"]}
        ctx = {"touched": {}, "added": [], "removed": [], "state_only": True, "by": by, "all": False}
        guarded = {}
        if base_rev is not None:  # an item the other one deleted meanwhile is a conflict, not a missing item
            named = {}
            for o in ops:
                if o.get("op") in _GUARDED:
                    for i in ([o["id"]] if isinstance(o.get("id"), str) else []) + [x for x in (o.get("ids") or []) if isinstance(x, str)]:
                        named[i] = "*"
            have = {it["id"] for it in st["items"]}
            gone = {i: "*" for i in named if i not in have}
            if gone:
                _guard(st, by, int(base_rev), gone)
        for i, o in enumerate(ops):
            _one(work, o, ctx, f"ops[{i}]", guarded)
        if by == "hermes" and base_rev is None and guarded:
            raise BoardError("missing_guard", "changing items that are on the board needs base_rev: the rev you read "
                                              "(ha_live_read)", rev=st["rev"])
        if base_rev is not None and guarded:
            _guard(st, by, int(base_rev), guarded)
        _check_refs(work["items"])
        _check_limits(work["items"])
        before = None if ctx["state_only"] or _hist(aid, st["version"]) else _snap(st, "start")
        retitled = work["title"] != st["title"]
        st["items"], st["seq"], st["title"] = work["items"], work["seq"], work["title"]
        st["rev"] += 1
        have = {it["id"] for it in st["items"]}
        removed = [i for i in dict.fromkeys(ctx["removed"]) if i not in have]
        touched = {k: v for k, v in ctx["touched"].items() if k in have}
        entry = {"rev": st["rev"], "by": by, "at": time.time(), "ids": touched, "removed": removed}
        if ctx["state_only"]:
            entry["s"] = True  # an embed saving what people entered: never a conflict, not history
        else:
            if by == "user":
                st["edits"] = st.get("edits", 0) + 1
            else:
                st["hermes_at"] = time.time()
        if ctx["all"] or len(touched) + len(removed) > MAX_LOG_IDS:
            entry.update(ids={}, removed=[], all=True)
        st["log"].append(entry)
        st["log"] = st["log"][-MAX_LOG:]
        try:
            _save(aid, st)
        except BaseException:
            _CACHE.pop(aid, None)
            raise
        if not ctx["state_only"]:
            _record(aid, st, by, before)
        if retitled and st["title"].strip():
            try:
                store.update_meta(aid, title=st["title"])  # the gallery shows the board's title
            except (OSError, ValueError):
                pass
        out = {"ok": True, "rev": st["rev"], "changed": list(touched) + removed}
        added = [i for i in ctx["added"] if i in have]
        if added:
            out["added"] = added
        if removed:
            out["removed"] = removed
        return out


def _guard(st: dict, by: str, base: int, guarded: dict) -> None:
    hits = []
    for e in st["log"]:
        if e["rev"] <= base or e["by"] == by or e.get("s"):
            continue
        if e.get("all"):
            hits = list(guarded)
            break
        for i, fields in guarded.items():
            if i in hits:
                continue
            if i in e.get("removed", []):
                hits.append(i)
            elif i in e.get("ids", {}):
                theirs = e["ids"][i]
                # Hermes never writes over an item the person changed since; the page loses only the
                # fields Hermes set meanwhile.
                if by == "hermes" or fields == "*" or theirs == "*" or set(fields) & set(theirs):
                    hits.append(i)
    if hits:
        raise BoardError("conflict", f"changed meanwhile: {', '.join(hits[:20])}. Read the board again "
                                     f"(since_rev={base}) and redo the change on what is there",
                         rev=st["rev"], conflict=hits[:50])


def _touch(ctx: dict, i: str, fields) -> None:
    cur = ctx["touched"].get(i)
    if fields == "*" or cur == "*":
        ctx["touched"][i] = "*"
    else:
        ctx["touched"][i] = sorted(set(cur or ()) | set(fields))


def _mark(guarded: dict, i: str, fields) -> None:
    cur = guarded.get(i)
    guarded[i] = "*" if fields == "*" or cur == "*" else sorted(set(cur or ()) | set(fields))


def _one(work: dict, o: dict, ctx: dict, where: str, guarded: dict) -> None:
    items, op, by = work["items"], o.get("op"), ctx["by"]
    index = {it["id"]: n for n, it in enumerate(items)}
    if op != "state":
        ctx["state_only"] = False
    if op == "add":
        new, grown, work["seq"] = _add(items, work["seq"], o.get("items"), o.get("flow", "right"), o.get("near"), f"{where}.items")
        ctx["added"] += new
        for i in new:
            _touch(ctx, i, "*")
        for i in grown:
            _touch(ctx, i, ("w", "h"))
    elif op == "set":
        i = o.get("id")
        if i not in index:
            raise BoardError("absent", f"{where}: no item {i!r} on the board")
        old = items[index[i]]
        fields = {k: v for k, v in o.items() if k not in ("op", "id", "with")}
        if not fields:
            raise _bad(f"{where}: set names the fields that change")
        if fields.get("type", old["type"]) != old["type"]:
            raise _bad(f"{where}: an item keeps its type (delete it and add another)")
        fields.pop("type", None)
        merged = dict(old)
        for k, v in fields.items():
            if v is None:
                merged.pop(k, None)
            else:
                merged[k] = v
        new, _h = clean_item(merged, where, hints_ok=False)
        if by == "hermes" and old.get("locked") and {"x", "y"} & set(fields):
            raise _bad(f"{where}: {i} is locked by the user: leave it where it is")
        if old["type"] != "arrow" and "x" not in new:
            raise _bad(f"{where}: an item on the board keeps its x and y")
        if by == "hermes" and new["type"] in ("box", "note") and {"text", "size", "kind", "w"} & set(fields) and "h" not in fields:
            _fit_box(new, grow_only=True)  # its words still fit: taller, never smaller
        _size(new)
        mark = set(fields)
        if new.get("h") != old.get("h"):
            mark.add("h")
        if o.get("with") is True and old["type"] == "section" and ("x" in fields or "y" in fields):
            ms = [m["id"] for m in members(old, items)]
            items[index[i]] = new
            _shift(items, ms, new["x"] - old["x"], new["y"] - old["y"])
            for m in ms:
                _touch(ctx, m, ("x", "y"))
        else:
            items[index[i]] = new
        _touch(ctx, i, mark)
        _mark(guarded, i, mark)
    elif op == "move":
        ids = _ids(o, items, where)
        dx, dy = _num(o.get("dx", 0), f"{where}.dx"), _num(o.get("dy", 0), f"{where}.dy")
        if by == "hermes":
            locked = [i for i in ids if items[index[i]].get("locked")]
            if locked:
                raise _bad(f"{where}: {', '.join(locked)} locked by the user: leave it where it is")
        for i in ids:
            _mark(guarded, i, ("x", "y"))
        if by == "hermes":
            ids = _carried(items, ids)
        _shift(items, ids, dx, dy)
        for i in ids:
            _touch(ctx, i, ("x", "y"))
    elif op == "delete":
        ids = _ids(o, items, where)
        if by == "hermes":
            locked = [i for i in ids if items[index[i]].get("locked")]
            if locked:
                raise _bad(f"{where}: {', '.join(locked)} locked by the user: leave it")
        gone = set(ids)
        for it in items:  # the arrows that held on to a deleted item go with it
            if it["type"] == "arrow" and any(isinstance(it[k], str) and it[k] in gone for k in ("from", "to")):
                gone.add(it["id"])
        for i in ids:
            _mark(guarded, i, "*")
        work["items"] = [it for it in items if it["id"] not in gone]
        ctx["removed"] += ids + [i for i in gone if i not in ids]
        for i in gone:
            ctx["touched"].pop(i, None)
    elif op == "order":
        ids = _ids(o, items, where)
        to = _one_of(o.get("to"), ("front", "back"), f"{where}.to")
        pick = set(ids)
        moved = [it for it in items if it["id"] in pick]
        rest = [it for it in items if it["id"] not in pick]
        work["items"] = rest + moved if to == "front" else moved + rest
        for i in ids:
            _touch(ctx, i, ("z",))
    elif op in ("group", "ungroup"):
        ids = _ids(o, items, where)
        gid = None
        if op == "group":
            if len(ids) < 2:
                raise _bad(f"{where}: a group is two items or more")
            gid, work["seq"] = _next_id({it.get("group") for it in items}, work["seq"], "g")
        for i in ids:
            it = items[index[i]]
            if gid:
                it["group"] = gid
            else:
                it.pop("group", None)
            _touch(ctx, i, ("group",))
    elif op == "tidy":
        ids = _ids(o, items, where, optional=True)
        flow = o.get("flow", "right")
        if flow not in FLOWS:
            raise _bad(f"{where}.flow: one of {', '.join(FLOWS)}")
        for i in _tidy(items, ids, flow):
            _touch(ctx, i, ("x", "y", "w", "h"))
            _mark(guarded, i, ("x", "y", "w", "h"))
    elif op == "title":
        work["title"] = _text(o.get("title"), f"{where}.title", MAX_TITLE)
    elif op == "state":
        i = o.get("id")
        if i not in index or items[index[i]]["type"] != "embed":
            raise BoardError("absent", f"{where}: no embed {i!r} on the board")
        items[index[i]]["state"] = _field("embed", "state", o.get("state"), where)
        _touch(ctx, i, ("state",))
    else:
        raise _bad(f"{where}: unknown op {op!r} (add, set, move, delete, order, group, ungroup, tidy, title, state)")


# ----------------------------------------------------------------------------- history
MAX_SNAPS = 40
MAX_SNAP_BYTES = 8_000_000  # all snapshots together
SNAP_GAP = 120              # seconds: edits by the same author closer than this share one snapshot

_HIST_CACHE: dict = {}


def _hist_path(aid: str) -> Path:
    return store._dir(aid) / "board" / "history.json"


def _hist(aid: str, version: int) -> list:
    try:
        h = store.json_cached(_hist_path(aid), _HIST_CACHE, 8)
    except (FileNotFoundError, ValueError):
        return []
    return list(h.get("snaps", [])) if h.get("version") == version else []


def _hist_save(aid: str, version: int, snaps: list) -> None:
    snaps = snaps[-MAX_SNAPS:]
    while len(snaps) > 2 and sum(x["n"] for x in snaps) > MAX_SNAP_BYTES:
        snaps.pop(0)
    p = _hist_path(aid)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    h = {"version": version, "snaps": snaps}
    tmp.write_text(json.dumps(h, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    s = tmp.stat()
    tmp.replace(p)
    store.json_remember(p, _HIST_CACHE, h, s, 8)


def _snap(st: dict, by: str) -> dict:
    items = copy.deepcopy(st["items"])
    return {"rev": st["rev"], "by": by, "at": time.time(), "title": st["title"], "items": items,
            "n": len(json.dumps(items, ensure_ascii=False, separators=(",", ":")))}


def _record(aid: str, st: dict, by: str, before: Optional[dict]) -> None:
    snaps = _hist(aid, st["version"])
    if not snaps and before:  # the board as it started: always restorable
        snaps.append(before)
    last = snaps[-1] if snaps else None
    if last and last["by"] == by and by != "restore" and time.time() - last["at"] < SNAP_GAP:
        snaps[-1] = _snap(st, by)
    else:
        snaps.append(_snap(st, by))
    _hist_save(aid, st["version"], snaps)


def history(aid: str) -> dict:
    """The board's snapshots, newest first: {rev, by, at, items (count)}."""
    st = load(aid)
    return {"rev": st["rev"], "snaps": [{"rev": x["rev"], "by": x["by"], "at": x["at"], "items": len(x["items"])}
                                        for x in reversed(_hist(aid, st["version"]))]}


def _snap_at(aid: str, st: dict, rev: int) -> dict:
    cands = [x for x in _hist(aid, st["version"]) if x["rev"] <= int(rev)]
    if not cands:
        raise BoardError("absent", f"no snapshot at or before rev {rev}")
    return cands[-1]


def at_rev(aid: str, rev: int, *, agent: bool = False) -> dict:
    """The board as it was at ``rev`` (the newest snapshot at or before it), to look at."""
    st = load(aid)
    x = _snap_at(aid, st, rev)
    items = [compact(it) for it in x["items"][:AGENT_ITEMS]] if agent else x["items"]
    return {"rev": x["rev"], "title": x["title"], "items": items, "current_rev": st["rev"], "by": x["by"], "at": x["at"]}


def restore(aid: str, rev: int) -> dict:
    """Bring the board back to a snapshot, as a new rev by the person (itself undoable the same way)."""
    with _LOCK:
        st = load(aid)
        x = _snap_at(aid, st, rev)
        before = _snap(st, "user")
        st["items"], st["title"] = copy.deepcopy(x["items"]), x["title"]
        st["rev"] += 1
        st["edits"] = st.get("edits", 0) + 1
        st["log"].append({"rev": st["rev"], "by": "user", "at": time.time(), "ids": {}, "removed": [], "all": True,
                          "restored": x["rev"]})
        st["log"] = st["log"][-MAX_LOG:]
        try:
            _save(aid, st)
        except BaseException:
            _CACHE.pop(aid, None)
            raise
        _record(aid, st, "restore", before)
        return {"ok": True, "rev": st["rev"], "restored": x["rev"]}
