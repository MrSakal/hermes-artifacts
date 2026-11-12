"""Live sheets: a workbook of sheets of cells that the user and Hermes edit together, cell by cell.

Built the way docs.py is: the workbook starts from the latest published ``sheet.json``; every edit
batch bumps the sheet's ``rev`` and is logged, so a reader can ask what changed since the rev it last
saw, and an edit made against an older rev of cells someone else changed meanwhile is refused.

A sheet keeps sparse maps keyed by A1: ``cells`` (what is typed: number, boolean or text; a formula
keeps its ``=`` text), ``fmt`` (per-cell format) and ``vals`` (what the page last computed for the
formula cells: the formula engine runs in the page only). Inserting or deleting rows and columns
moves the cells and rewrites the A1 references of every formula in the workbook that points there.

State lives in ``<artifact>/sheet/state.json``, outside the artifact's versions; publishing a new
version (sheet.json) starts the workbook again from it.
"""

from __future__ import annotations

import json
import math
import re
import secrets
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Optional

from . import calc, store

_LOCK = threading.RLock()
MAX_SHEETS = 20
MAX_ROWS = 5000
MAX_COLS = 100
MAX_TEXT = 4000
MAX_LOG = 400
MAX_LOG_CELLS = 200
MAX_CHARTS = 20
MAX_OPS = 500
FMT_PAD = 200          # range formats reach this far below the used range
MAX_OPTIONS, MAX_OPTION = 50, 60   # a dropdown: this many options, each this long
MAX_LISTS = 100        # different dropdown lists one sheet keeps
MAX_RULES, MAX_RULE = 50, 500      # conditional formats of a sheet; the length of a rule's formula
MAX_MERGES = 500       # merged cells of a sheet
PILLS = ("gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "magenta")  # a dropdown option's colour
BORDERS = ("all", "outer", "inner", "horizontal", "vertical", "top", "bottom", "left", "right", "none")  # horizontal, vertical: the inner lines one way
AGENT_ROWS, AGENT_COLS = 200, 30
ACTIVE_SECS = 300      # Hermes counts as at work in a sheet this long after its last change there
_BAD_NAME = re.compile(r"[\[\]:*?/\\'!]")


class SheetError(Exception):
    def __init__(self, code: str, message: str, **extra):
        super().__init__(message)
        self.code, self.message, self.extra = code, message, extra


# ----------------------------------------------------------------------------- A1 names

@lru_cache(maxsize=4096)
def col_name(c: int) -> str:
    s, c = "", c + 1
    while c:
        c, r = divmod(c - 1, 26)
        s = chr(65 + r) + s
    return s


@lru_cache(maxsize=4096)
def col_index(name: str) -> int:
    n = 0
    for ch in name.upper():
        n = n * 26 + ord(ch) - 64
    return n - 1


_KEY = re.compile(r"^\$?([A-Za-z]{1,3})\$?([1-9][0-9]{0,6})$")


@lru_cache(maxsize=1 << 20)
def parse_key(key: str) -> Optional[tuple]:
    """'B2' -> (1, 1): (row, col), 0-based; None when it is no cell name."""
    m = _KEY.match(key)
    return (int(m.group(2)) - 1, col_index(m.group(1))) if m else None


def key(r: int, c: int) -> str:
    return col_name(c) + str(r + 1)


def range_name(r1: int, c1: int, r2: int, c2: int) -> str:
    a, b = key(r1, c1), key(r2, c2)
    return a if a == b else f"{a}:{b}"


def used(sh: dict) -> tuple:
    """(rows, cols) the sheet's values reach, counted from A1."""
    nr = nc = 0
    for k in sh["cells"]:
        r, c = parse_key(k)
        if r >= nr:
            nr = r + 1
        if c >= nc:
            nc = c + 1
    return nr, nc


_RANGE = re.compile(r"^\$?([A-Za-z]{1,3})?\$?([0-9]{1,7})?(?::\$?([A-Za-z]{1,3})?\$?([0-9]{1,7})?)?$")


def parse_range(text, extent: tuple = (MAX_ROWS, MAX_COLS)) -> tuple:
    """'B2', 'B2:D9', 'B:B', '2:4' -> (r1, c1, r2, c2), 0-based, inclusive. A whole column or row
    reaches ``extent`` (rows, cols)."""
    s = str(text or "").strip()
    if "!" in s:
        s = s.rsplit("!", 1)[1]
    m = _RANGE.match(s)
    if not s or not m:
        raise SheetError("invalid", f"bad range {text!r} (like A1, B2:D9, B:B or 2:4)")
    a, r, b, r2 = m.groups()
    two = ":" in s
    if a and r and (not two or (b and r2)):           # cells
        r1_, c1_ = int(r) - 1, col_index(a)
        r2_, c2_ = (int(r2) - 1, col_index(b)) if two else (r1_, c1_)
    elif a and not r and two and b and not r2:          # whole columns
        r1_, r2_, c1_, c2_ = 0, max(extent[0], 1) - 1, col_index(a), col_index(b)
    elif r and not a and two and r2 and not b:          # whole rows
        r1_, r2_, c1_, c2_ = int(r) - 1, int(r2) - 1, 0, max(extent[1], 1) - 1
    else:
        raise SheetError("invalid", f"bad range {text!r} (like A1, B2:D9, B:B or 2:4)")
    r1_, r2_ = sorted((r1_, r2_))
    c1_, c2_ = sorted((c1_, c2_))
    if r1_ < 0 or c1_ < 0 or r2_ >= MAX_ROWS or c2_ >= MAX_COLS:
        raise SheetError("invalid", f"range {text!r} is outside {MAX_ROWS} rows x {MAX_COLS} columns")
    return r1_, c1_, r2_, c2_


# ----------------------------------------------------------------------------- formula references

_STR = re.compile(r'"(?:[^"]|"")*"?')
_EP = r"\$?[A-Za-z]{1,3}\$?[0-9]{1,7}"
_REF = re.compile(
    r"(?<![\w.$'!#])"
    r"(?:'((?:[^']|'')+)'!|([^\W\d][\w.]*)!)?"          # sheet: 'My sheet'! or Costs!
    r"(?:(" + _EP + r")(?::(" + _EP + r"))?"              # A1 or A1:B2
    r"|(\$?[A-Za-z]{1,3}):(\$?[A-Za-z]{1,3})"             # A:B
    r"|(\$?[0-9]{1,7}):(\$?[0-9]{1,7}))"                  # 1:3
    r"(?![\w(!])")
_EPP = re.compile(r"^(\$?)([A-Za-z]{1,3})?(\$?)([0-9]+)?$")


def _ep(text: str) -> list:
    """An endpoint as [col absolute, col | None, row absolute, row | None] (0-based)."""
    return list(_ep_parsed(text))


@lru_cache(maxsize=1 << 16)
def _ep_parsed(text: str) -> tuple:
    m = _EPP.match(text)
    ca, c, ra, r = m.groups()
    if c is None and ca:  # "$3": the $ belongs to the row
        ca, ra = "", "$"
    return (bool(ca), col_index(c) if c else None, bool(ra), int(r) - 1 if r else None)


def _ep_text(e: list) -> str:
    out = ""
    if e[1] is not None:
        out += ("$" if e[0] else "") + col_name(e[1])
    if e[3] is not None:
        out += ("$" if e[2] else "") + str(e[3] + 1)
    return out


def quote_name(name: str) -> str:
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", name) and not re.fullmatch(r"[A-Za-z]{1,3}[0-9]+|TRUE|FALSE", name, re.I):
        return name
    return "'" + name.replace("'", "''") + "'"


def map_refs(formula: str, cb) -> str:
    """Rewrite the references of a formula, outside its string literals. ``cb(sheet, kind, e1, e2)``
    (sheet: the name written before ``!`` or None; kind: cells | cols | rows) returns None to keep
    the reference, "#REF!" to replace it whole, or (new prefix | None, new ref text | None)."""
    def one(m):
        groups = m.groups()
        sheet = groups[0].replace("''", "'") if groups[0] is not None else groups[1]
        if groups[2] is not None:
            kind, a, b, at = "cells", groups[2], groups[3], m.start(3)
        elif groups[4] is not None:
            kind, a, b, at = "cols", groups[4], groups[5], m.start(5)
        else:
            kind, a, b, at = "rows", groups[6], groups[7], m.start(7)
        e1, e2 = _ep(a), (_ep(b) if b else None)
        if any(e is not None and e[3] is not None and e[3] < 0 for e in (e1, e2)):
            return m.group(0)  # row 0: no reference
        res = cb(sheet, kind, e1, e2)
        if res is None:
            return m.group(0)
        if res == "#REF!":
            return "#REF!"
        prefix, ref = res
        whole = m.group(0)
        cut = at - m.start()
        return (prefix if prefix is not None else whole[:cut]) + (ref if ref is not None else whole[cut:])

    out, pos = [], 0
    for s in _STR.finditer(formula):
        out.append(_REF.sub(one, formula[pos:s.start()]))
        out.append(s.group(0))
        pos = s.end()
    out.append(_REF.sub(one, formula[pos:]))
    return "".join(out)


def _ref_text(e1: list, e2: Optional[list]) -> str:
    return _ep_text(e1) + (":" + _ep_text(e2) if e2 is not None else "")


def shift_refs(formula: str, dr: int, dc: int) -> str:
    """Relative references moved by (dr, dc), as when a formula is copied; $-absolute parts stay.
    One pushed off the sheet becomes #REF!."""
    def cb(sheet, kind, e1, e2):
        new = []
        for e in (e1, e2):
            if e is None:
                new.append(None)
                continue
            e = list(e)
            if e[1] is not None and not e[0]:
                e[1] += dc
            if e[3] is not None and not e[2]:
                e[3] += dr
            if (e[1] is not None and e[1] < 0) or (e[3] is not None and e[3] < 0):
                return "#REF!"
            new.append(e)
        return None if new == [e1, e2] else (None, _ref_text(*new))
    return map_refs(formula, cb) if (dr or dc) else formula


def _span(a1: int, a2: int, at: int, n: int, insert: bool) -> Optional[tuple]:
    """An interval [a1, a2] after inserting n before ``at`` or deleting [at, at + n); None: gone."""
    if insert:
        return (a1 + n if a1 >= at else a1, a2 + n if a2 >= at else a2)
    end = at + n
    if a1 >= at and a2 < end:
        return None
    return (a1 if a1 < at else (at if a1 < end else a1 - n),
            a2 if a2 < at else (at - 1 if a2 < end else a2 - n))


def _struct_cb(target: str, own: str, axis: str, at: int, n: int, insert: bool):
    target, own = target.casefold(), own.casefold()
    idx = 3 if axis == "row" else 1

    def cb(sheet, kind, e1, e2):
        if (sheet.casefold() if sheet is not None else own) != target:
            return None
        if (axis == "row" and kind == "cols") or (axis == "col" and kind == "rows"):
            return None
        a1, a2 = e1[idx], (e2 or e1)[idx]
        lo, hi = min(a1, a2), max(a1, a2)
        res = _span(lo, hi, at, n, insert)
        if res is None:
            return "#REF!"
        if res == (lo, hi):
            return None
        n1, n2 = list(e1), (list(e2) if e2 else None)
        if n2 is None:
            n1[idx] = res[0]
        elif a1 <= a2:
            n1[idx], n2[idx] = res
        else:
            n2[idx], n1[idx] = res
        return None, _ref_text(n1, n2)
    return cb


def _is_formula(v) -> bool:
    return isinstance(v, str) and v.startswith("=") and len(v) > 1


# ----------------------------------------------------------------------------- values and formats

_FMT_BOOL = ("bold", "italic", "underline", "wrap")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _value(v, where: str):
    """A cell's raw value checked: number, boolean, text or None."""
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        if isinstance(v, float) and not math.isfinite(v):
            raise SheetError("invalid", f"{where}: a number must be finite")
        return int(v) if isinstance(v, float) and v.is_integer() and abs(v) < 1e15 else v
    if isinstance(v, str):
        if len(v) > MAX_TEXT:
            raise SheetError("too_large", f"{where}: a cell holds at most {MAX_TEXT} characters")
        return v
    raise SheetError("invalid", f"{where}: a cell is a number, text, true/false or null")


def clean_fmt(d, where: str, allow_null: bool = False) -> dict:
    """Format keys checked; with ``allow_null`` a null value means: remove that key."""
    if not isinstance(d, dict):
        raise SheetError("invalid", f"{where}: a format is an object")
    out = {}
    for k, v in d.items():
        if v is None and allow_null:
            out[k] = None
            if k not in _FMT_BOOL + ("align", "num", "bg", "fg", "options", "check", "colors", "border", "bd"):
                raise SheetError("invalid", f"{where}: unknown format key {k!r}")
            if k == "border":
                out[k] = "none"
            continue
        if k == "options":
            out[k] = _clean_options(v, where)
        elif k == "colors":
            if not isinstance(v, list) or len(v) > MAX_OPTIONS or any(c is not None and c not in PILLS for c in v):
                raise SheetError("invalid", f"{where}: colors is a list, one for each option, of {', '.join(PILLS)} or null")
            v = list(v)
            while v and v[-1] is None:
                v.pop()
            out[k] = v or None
        elif k == "border":
            if v not in BORDERS:
                raise SheetError("invalid", f"{where}: border is one of {', '.join(BORDERS)}")
            out[k] = v
        elif k == "bd":  # the edges a cell draws, as the page and an imported file give them
            if not isinstance(v, str) or any(ch not in "tblr" for ch in v):
                raise SheetError("invalid", f"{where}: bd is a cell's edges out of t, b, l, r")
            out[k] = "".join(ch for ch in "tblr" if ch in v) or None
        elif k == "check":
            if not isinstance(v, bool):
                raise SheetError("invalid", f"{where}: check is true or false")
            if v:
                out[k] = True
            elif allow_null:
                out[k] = None  # false takes the checkboxes away
        elif k in _FMT_BOOL:
            if not isinstance(v, bool):
                raise SheetError("invalid", f"{where}: {k} is true or false")
            out[k] = v
        elif k == "align":
            if v not in ("left", "center", "right"):
                raise SheetError("invalid", f"{where}: align is left, center or right")
            out[k] = v
        elif k == "num":
            if not isinstance(v, str) or not 0 < len(v) <= 80:
                raise SheetError("invalid", f"{where}: num is a number-format string")
            out[k] = v
        elif k in ("bg", "fg"):
            if not isinstance(v, str) or not _COLOR.match(v):
                raise SheetError("invalid", f"{where}: {k} is a colour like #1f6feb")
            out[k] = v.lower()
        else:
            raise SheetError("invalid", f"{where}: unknown format key {k!r} (bold, italic, underline, wrap, align, num, bg, fg, "
                                        "options, colors, check, border)")
    if not allow_null:
        out = {k: v for k, v in out.items() if v is not None}
    return out


def _clean_options(v, where: str) -> list:
    """A dropdown's options: 1-50 different texts."""
    if not isinstance(v, list) or not v:
        raise SheetError("invalid", f"{where}: options is a list of texts like [\"To do\", \"Done\"] (null removes the dropdown)")
    out = []
    for o in v:
        if isinstance(o, (int, float)) and not isinstance(o, bool):
            o = str(_value(o, where))
        if not isinstance(o, str) or not o.strip() or len(o.strip()) > MAX_OPTION or "\n" in o.strip():
            raise SheetError("invalid", f"{where}: an option is a text of 1-{MAX_OPTION} characters on one line")
        if o.strip() not in out:
            out.append(o.strip())
    if len(out) > MAX_OPTIONS:
        raise SheetError("too_large", f"{where}: a dropdown holds at most {MAX_OPTIONS} options")
    return out


def _bind(sh: dict, f: dict) -> dict:
    """A checked format as it is stored: ``options`` becomes ``opt``, the id of that list in the
    sheet's ``lists`` ({id: [options]}), so a column of dropdowns keeps its options once; the
    ``colors`` given with them are that list's, in ``list_colors`` ({id: [colour | None]}). Ids are
    never used again, so a snapshot's cells still find their list. ``colors`` without ``options``
    stays in the format: the caller gives them to the dropdowns already there (_recolor)."""
    if "options" not in f:
        return f
    f = dict(f)
    opts, cols = f.pop("options"), f.pop("colors", None)
    f["opt"] = None if opts is None else _list_id(sh, opts, cols)
    return f


def _list_id(sh: dict, opts: list, cols: Optional[list]) -> str:
    """The id of the dropdown list with these options and colours, made when the sheet has none."""
    cols = list(cols or [])[:len(opts)]
    while cols and cols[-1] is None:
        cols.pop()
    lists, colors = sh.setdefault("lists", {}), sh.get("list_colors") or {}
    for i, have in lists.items():
        if have == opts and colors.get(i, []) == cols:
            return i
    if len(lists) >= MAX_LISTS:  # make room: the lists no cell points at any more (the newest id stays taken)
        live = {x["opt"] for x in sh["fmt"].values() if "opt" in x}
        top = str(max(map(int, lists)))
        for i in [i for i in lists if i not in live and i != top]:
            del lists[i]
            colors.pop(i, None)
        if len(lists) >= MAX_LISTS:
            raise SheetError("too_large", f"a sheet holds at most {MAX_LISTS} different dropdown lists")
    i = str(max(map(int, lists), default=0) + 1)
    lists[i] = opts
    if cols:
        sh.setdefault("list_colors", {})[i] = cols
    return i


def _recolor(sh: dict, new: dict, memo: dict) -> None:
    """``colors`` given without ``options`` (still in ``new``): the dropdown the cell already is takes them."""
    cols, i = new.pop("colors"), new.get("opt")
    if i in (sh.get("lists") or {}):
        if i not in memo:
            memo[i] = _list_id(sh, sh["lists"][i], cols)
        new["opt"] = memo[i]


def _apply_border(fmt: dict, kind: str, r1: int, c1: int, r2: int, c2: int, log: Optional[set] = None) -> None:
    """A range's ``border`` as the edges each of its cells draws (fmt ``bd``: a subset of "tblr").
    ``none`` also takes the facing edges of the cells around the range."""
    def put(r, c, add="", drop=""):
        if r < 0 or c < 0 or r >= MAX_ROWS or c >= MAX_COLS:
            return
        k = key(r, c)
        f = fmt.get(k, {})
        have = f.get("bd", "")
        bd = "".join(ch for ch in "tblr" if (ch in have or ch in add) and ch not in drop)
        if bd == have:
            return
        f = {**f, "bd": bd}
        if not bd:
            del f["bd"]
        if f:
            fmt[k] = f
        else:
            fmt.pop(k, None)
        if log is not None:
            log.add(k)

    if kind == "none":
        for r in range(r1, r2 + 1):
            for c in range(c1, c2 + 1):
                put(r, c, drop="tblr")
            put(r, c1 - 1, drop="r")
            put(r, c2 + 1, drop="l")
        for c in range(c1, c2 + 1):
            put(r1 - 1, c, drop="b")
            put(r2 + 1, c, drop="t")
        return
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            if kind == "all":
                e = "tblr"
            elif kind in ("inner", "horizontal", "vertical"):
                e = (("t" if r > r1 else "") + ("b" if r < r2 else "") if kind != "vertical" else "") \
                    + (("l" if c > c1 else "") + ("r" if c < c2 else "") if kind != "horizontal" else "")
            else:
                e = ("t" if kind in ("outer", "top") and r == r1 else "") + ("b" if kind in ("outer", "bottom") and r == r2 else "") \
                    + ("l" if kind in ("outer", "left") and c == c1 else "") + ("r" if kind in ("outer", "right") and c == c2 else "")
            if e:
                put(r, c, add=e)


def _spread(sh: dict, f: dict, r1: int, c1: int, r2: int, c2: int, log: Optional[set] = None) -> None:
    """A checked, bound format (clean_fmt, _bind) put on every cell of a range; a null value takes that key away."""
    f = dict(f)
    border, memo, fmt = f.pop("border", None), {}, sh["fmt"]
    alone = "colors" in f
    for r in range(r1, r2 + 1) if f else ():
        for c in range(c1, c2 + 1):
            k = key(r, c)
            new = {**fmt.get(k, {}), **f}
            if alone:
                _recolor(sh, new, memo)
            new = {a: b for a, b in new.items() if b is not None}
            if new != fmt.get(k, {}):
                if new:
                    fmt[k] = new
                else:
                    fmt.pop(k, None)
                if log is not None:
                    log.add(k)
    if border:
        _apply_border(fmt, border, r1, c1, r2, c2, log)


# ----------------------------------------------------------------------------- conditional formats, merged cells

def _clean_rules(v, where: str) -> list:
    """A sheet's conditional formats: {range, if: "=formula", bg, fg, bold, strike} (the formula
    as written for the range's top-left cell) or {range, scale: [low, (mid,) high]}."""
    if not isinstance(v, list) or len(v) > MAX_RULES:
        raise SheetError("invalid", f"{where}: rules is a list of at most {MAX_RULES} rules")
    out = []
    for i, r in enumerate(v):
        w = f"{where}[{i}]"
        if not isinstance(r, dict):
            raise SheetError("invalid", f"{w}: a rule is {{range, if, bg}} or {{range, scale}}")
        one = {"range": range_name(*parse_range(r.get("range")))}
        if "scale" in r:
            sc = r["scale"]
            if not isinstance(sc, list) or len(sc) not in (2, 3) or not all(isinstance(c, str) and _COLOR.match(c) for c in sc) \
                    or set(r) - {"range", "scale"}:
                raise SheetError("invalid", f"{w}: scale is 2 or 3 colours like [\"#ffffff\", \"#57bb8a\"] (low, mid, high), "
                                            "with range and nothing else")
            one["scale"] = [c.lower() for c in sc]
        else:
            f = r.get("if")
            if not _is_formula(f) or len(f) > MAX_RULE:
                raise SheetError("invalid", f"{w}: if is a formula like \"=C3<TODAY()\" (at most {MAX_RULE} characters), "
                                            "written for the range's top-left cell")
            one["if"] = f
            for k, x in r.items():
                if k in ("range", "if") or x is None or x is False:
                    continue
                if k in ("bg", "fg") and isinstance(x, str) and _COLOR.match(x):
                    one[k] = x.lower()
                elif k in ("bold", "strike") and x is True:
                    one[k] = True
                else:
                    raise SheetError("invalid", f"{w}: a rule formats with bg, fg (#rrggbb), bold, strike (true), not {k!r}")
            if len(one) == 2:
                raise SheetError("invalid", f"{w}: a rule needs a format: bg, fg, bold or strike")
        out.append(one)
    return out


def _boxes(sh: dict) -> list:
    return [parse_range(m) for m in sh.get("merges") or ()]


def _merge(sh: dict, rng, log: Optional[set] = None) -> int:
    """Merge a range into one cell: its top-left cell keeps its content, the others are emptied
    (how many: returned). Merged cells wholly inside it become part of it."""
    r1, c1, r2, c2 = parse_range(rng, used(sh))
    if (r1, c1) == (r2, c2):
        raise SheetError("invalid", f"merge needs a range of two or more cells, not {rng!r}")
    keep = []
    for m in sh.get("merges") or ():
        a, b, c, d = parse_range(m)
        if r1 <= a and c1 <= b and c <= r2 and d <= c2:
            continue
        if not (c < r1 or a > r2 or d < c1 or b > c2):
            raise SheetError("invalid", f"{range_name(r1, c1, r2, c2)} cuts across the merged cell {m}: unmerge that first")
        keep.append(m)
    if len(keep) >= MAX_MERGES:
        raise SheetError("too_large", f"a sheet holds at most {MAX_MERGES} merged cells")
    n = 0
    for k in _keys_in(sh["cells"], r1, c1, r2, c2):
        if k != key(r1, c1):
            del sh["cells"][k]
            sh["vals"].pop(k, None)
            n += 1
            if log is not None:
                log.add(k)
    sh["merges"] = keep + [range_name(r1, c1, r2, c2)]
    return n


def _unmerge(sh: dict, rng) -> None:
    """Every merged cell that reaches into the range is cells again."""
    r1, c1, r2, c2 = parse_range(rng, used(sh))
    keep = [m for m, (a, b, c, d) in zip(sh.get("merges") or (), _boxes(sh)) if c < r1 or a > r2 or d < c1 or b > c2]
    if keep:
        sh["merges"] = keep
    else:
        sh.pop("merges", None)


def _check_name(name, where: str) -> str:
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40 or _BAD_NAME.search(name):
        raise SheetError("invalid", f"{where}: a sheet name is 1-40 characters, none of [ ] : * ? / \\ ' !")
    return name.strip()


def _clean_chart(ch, where: str, sh_charts: list) -> dict:
    if not isinstance(ch, dict):
        raise SheetError("invalid", f"{where}: a chart is an object")
    if ch.get("type") not in ("bar", "line", "pie"):
        raise SheetError("invalid", f"{where}: chart type is bar, line or pie")
    r1, c1, r2, c2 = parse_range(ch.get("range"))
    out = {"id": _chart_id(sh_charts), "type": ch["type"], "range": range_name(r1, c1, r2, c2),
           "title": str(ch.get("title") or "")[:120]}
    if ch.get("at"):
        p = parse_key(str(ch["at"]).replace("$", ""))
        if not p or p[0] >= MAX_ROWS or p[1] >= MAX_COLS:
            raise SheetError("invalid", f"{where}: at is a cell like F2")
        out["at"] = key(*p)
    else:
        out["at"] = key(r1, min(c2 + 2, MAX_COLS - 1))
    return out


def _chart_id(charts: list) -> str:
    n = 1
    have = {c.get("id") for c in charts}
    while f"c{n}" in have:
        n += 1
    return f"c{n}"


def _new_id() -> str:
    return "s" + secrets.token_hex(3)


def sheet_from_spec(spec, where: str, taken: list) -> dict:
    """One sheet of sheet.json (or an add_sheet op) as live state."""
    if not isinstance(spec, dict):
        raise SheetError("invalid", f"{where}: a sheet is an object with name and rows")
    name = _check_name(spec.get("name"), where + ".name")
    if name.casefold() in (t.casefold() for t in taken):
        raise SheetError("invalid", f"{where}: two sheets are named {name!r}")
    rows = spec.get("rows")
    rows = [] if rows is None else rows
    if not isinstance(rows, list):
        raise SheetError("invalid", f"{where}.rows: a list of rows, each a list of cells")
    if len(rows) > MAX_ROWS:
        raise SheetError("too_large", f"{where}: at most {MAX_ROWS} rows")
    cells = {}
    for r, row in enumerate(rows):
        if row is None:
            continue
        if not isinstance(row, list):
            raise SheetError("invalid", f"{where}.rows[{r}]: a row is a list of cells")
        if len(row) > MAX_COLS:
            raise SheetError("too_large", f"{where}.rows[{r}]: at most {MAX_COLS} columns")
        for c, v in enumerate(row):
            v = _value(v, f"{where}.rows[{r}][{c}]")
            if v is not None and v != "":
                cells[key(r, c)] = v
    sh = {"id": _new_id(), "name": name, "rev": 1, "cells": cells, "fmt": {}, "vals": {}, "cols": {},
          "freeze": {"rows": 0, "cols": 0}, "charts": [], "vals_at": 0}
    nr, nc = used(sh)
    formats = spec.get("formats") or {}
    if not isinstance(formats, dict):
        raise SheetError("invalid", f"{where}.formats: an object of range -> format")
    for rng, f in formats.items():
        f = _bind(sh, clean_fmt(f, f"{where}.formats[{rng!r}]"))
        r1, c1, r2, c2 = parse_range(rng, (nr, nc))
        r2 = min(r2, max(nr, r1 + 1) + FMT_PAD - 1, MAX_ROWS - 1)
        _spread(sh, f, r1, c1, r2, c2)
    for m in _list(spec, "merges", where):
        _merge(sh, m)
    if spec.get("rules"):
        sh["rules"] = _clean_rules(spec["rules"], where + ".rules")
    cols = spec.get("cols") or {}
    if not isinstance(cols, dict):
        raise SheetError("invalid", f"{where}.cols: an object like {{\"A\": 180}}")
    for k, w in cols.items():
        if not re.fullmatch(r"[A-Za-z]{1,3}", str(k)) or col_index(str(k)) >= MAX_COLS \
                or isinstance(w, bool) or not isinstance(w, (int, float)):
            raise SheetError("invalid", f"{where}.cols: column letter -> width in px, like {{\"A\": 180}}")
        sh["cols"][str(k).upper()] = int(min(800, max(40, w)))
    fr = spec.get("freeze") or {}
    if not isinstance(fr, dict):
        raise SheetError("invalid", f"{where}.freeze: like {{\"rows\": 1, \"cols\": 0}}")
    sh["freeze"] = _clean_freeze(fr.get("rows"), fr.get("cols"), where + ".freeze")
    charts = spec.get("charts") or []
    if not isinstance(charts, list) or len(charts) > MAX_CHARTS:
        raise SheetError("invalid", f"{where}.charts: a list of at most {MAX_CHARTS} charts")
    for i, ch in enumerate(charts):
        sh["charts"].append(_clean_chart(ch, f"{where}.charts[{i}]", sh["charts"]))
    return sh


def _list(spec: dict, name: str, where: str) -> list:
    v = spec.get(name) or []
    if not isinstance(v, list):
        raise SheetError("invalid", f"{where}.{name}: a list")
    return v


def _clean_freeze(rows, cols, where: str) -> dict:
    out = {}
    for k, v in (("rows", rows), ("cols", cols)):
        v = 0 if v is None else v
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= (MAX_ROWS if k == "rows" else MAX_COLS):
            raise SheetError("invalid", f"{where}: {k} is a count of {k} to keep in view")
        out[k] = v
    return out


def from_spec(spec) -> list:
    """sheet.json as live sheets; SheetError with what is wrong."""
    if not isinstance(spec, dict) or not isinstance(spec.get("sheets"), list) or not spec["sheets"]:
        raise SheetError("invalid", 'sheet.json: {"title": ..., "sheets": [{"name": ..., "rows": [[...]]}]}')
    if len(spec["sheets"]) > MAX_SHEETS:
        raise SheetError("too_large", f"sheet.json: at most {MAX_SHEETS} sheets")
    out = []
    for i, s in enumerate(spec["sheets"]):
        out.append(sheet_from_spec(s, f"sheets[{i}]", [x["name"] for x in out]))
    return out


def check_file(path: Path) -> None:
    """Publish-time check of a sheet's sheet.json (ValueError with what is wrong)."""
    try:
        spec = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return  # the store says the entry file is missing
    except (ValueError, UnicodeDecodeError) as e:
        raise ValueError(f"sheet.json is not valid JSON: {e}")
    try:
        from_spec(spec)
    except SheetError as e:
        raise ValueError(e.message if e.message.startswith("sheet.json") else "sheet.json: " + e.message)


# ----------------------------------------------------------------------------- state

_CACHE: dict = {}  # aid -> ((mtime_ns, size), state): a big workbook is parsed once, not on every read


def _state_path(aid: str) -> Path:
    return store._dir(aid) / "sheet" / "state.json"


def _fresh(aid: str, meta: dict) -> dict:
    sheets = None
    try:
        spec = json.loads(store.read_file(aid, "sheet.json").decode("utf-8-sig"))
        sheets = from_spec(spec)
    except (FileNotFoundError, ValueError, UnicodeDecodeError, SheetError):
        pass
    if not sheets:
        sheets = [sheet_from_spec({"name": "Sheet1", "rows": []}, "sheets[0]", [])]
    return {"version": meta["versions"][-1]["n"], "updated": time.time(), "hermes_at": time.time(),
            "edits": 0, "log": [], "sheets": sheets}


def load(aid: str) -> dict:
    meta = store.get_meta(aid)
    if not meta or meta.get("type") != "sheet":
        raise SheetError("absent", "not a sheet")
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


def _sheet(st: dict, sheet: Optional[str]) -> dict:
    if not sheet:
        return st["sheets"][0]
    for s in st["sheets"]:
        if s["id"] == sheet:
            return s
    for s in st["sheets"]:
        if s["name"].casefold() == str(sheet).casefold():
            return s
    raise SheetError("absent", f"no sheet {sheet!r} (sheets: {', '.join(s['name'] for s in st['sheets'])})")


def overview(st: dict) -> list:
    out = []
    for s in st["sheets"]:
        nr, nc = used(s)
        out.append({"id": s["id"], "name": s["name"], "rev": s["rev"], "rows": nr, "cols": nc})
    return out


def outline(aid: str) -> dict:
    """What a just-published sheet hands Hermes: each sheet's id, name and rev."""
    return {"sheets": [{"id": s["id"], "name": s["name"], "rev": s["rev"]} for s in load(aid)["sheets"]]}


def _stale(st: dict, sh: dict) -> bool:
    """Formula values not computed since Hermes last changed the workbook: the open page computes
    them, and a read by Hermes does when no page has (calc.refresh)."""
    return st.get("hermes_at", 0) > sh.get("vals_at", 0) and any(_is_formula(v) for v in sh["cells"].values())


def _grid(sh: dict, r1: int, c1: int, r2: int, c2: int) -> list:
    """Raw values of a block, trailing empty cells and rows trimmed."""
    if r2 < r1 or c2 < c1:
        return []
    h, w = r2 - r1 + 1, c2 - c1 + 1
    cells = sh["cells"]
    rows = [None] * h
    if h * w <= len(cells) * 4:
        for i in range(h):
            row = [cells.get(key(r1 + i, c1 + j)) for j in range(w)]
            rows[i] = row
    else:
        for k, v in cells.items():
            r, c = parse_key(k)
            if r1 <= r <= r2 and c1 <= c <= c2:
                if rows[r - r1] is None:
                    rows[r - r1] = [None] * w
                rows[r - r1][c - c1] = v
    out = []
    for row in rows:
        row = row or []
        while row and row[-1] is None:
            row.pop()
        out.append(row)
    while out and not out[-1]:
        out.pop()
    return out


def _inside(m: dict, r1: int, c1: int, r2: int, c2: int) -> dict:
    out = {}
    for k, v in m.items():
        r, c = parse_key(k)
        if r1 <= r <= r2 and c1 <= c <= c2:
            out[k] = v
    return out


def _view(st: dict, sh: dict, rng: Optional[str], agent: bool, full: bool, extent: Optional[tuple] = None) -> dict:
    if agent and _stale(st, sh):  # a caller without the artifact's id (dump): computed, saved with the next save
        with _LOCK:
            calc.refresh(st, value=_value, parse_key=parse_key, is_formula=_is_formula, limit=MAX_ROWS * MAX_COLS)
    nr, nc = extent or used(sh)
    if rng:
        r1, c1, r2, c2 = parse_range(rng, (nr, nc))
    else:
        r1, c1, r2, c2 = 0, 0, max(nr, 1) - 1, max(nc, 1) - 1
    out = {}
    if agent and (r2 - r1 + 1 > AGENT_ROWS or c2 - c1 + 1 > AGENT_COLS):
        whole = range_name(r1, c1, r2, c2)
        r2, c2 = min(r2, r1 + AGENT_ROWS - 1), min(c2, c1 + AGENT_COLS - 1)
        out["more"] = f"{whole} is larger: pass range"
    out["range"] = range_name(r1, c1, r2, c2)
    out["rows"] = _grid(sh, r1, c1, r2, c2)
    out["values"] = _inside(sh["vals"], r1, c1, r2, c2)
    out["stale"] = _stale(st, sh)
    if full:
        out["fmt"] = _inside(sh["fmt"], r1, c1, r2, c2) if rng else sh["fmt"]
        out["cols"], out["freeze"], out["charts"] = sh["cols"], sh["freeze"], sh["charts"]
        out["rules"], out["merges"] = sh.get("rules") or [], sh.get("merges") or []
    return out


def left(st: dict) -> int:
    """Whole seconds until Hermes no longer counts as at work in the workbook (0: not now)."""
    return max(0, math.ceil(ACTIVE_SECS - (time.time() - st.get("hermes_at", 0))))


def ago(st: dict) -> float:
    """Seconds since Hermes last changed it (publishing included): the page tells from it whether that change
    came in the run now in flight (kit.hermesWork), so its "Hermes is working" ends with the run."""
    return round(max(0.0, time.time() - st.get("hermes_at", 0)), 1)


def read(aid: str, sheet: Optional[str] = None, range: Optional[str] = None, *, since_rev: Optional[int] = None,
         search: Optional[str] = None, agent: bool = False) -> dict:
    """A sheet's cells (2D, from the range's top-left), or what changed since ``since_rev``, or the
    cells holding ``search``. ``agent``: capped at 200 rows x 30 columns; else the page's read, which
    also carries fmt, cols, freeze and charts, and before it the formula values nobody computed since
    Hermes' last change are computed and kept (no page needed; ``stale`` stays true if that fails)."""
    if range and "!" in str(range) and not sheet:
        sheet = str(range).rsplit("!", 1)[0].strip("'").replace("''", "'")
    with _LOCK:
        st = load(aid)
        sh = _sheet(st, sheet)
        if agent and _stale(st, sh) and calc.refresh(st, value=_value, parse_key=parse_key, is_formula=_is_formula,
                                                     limit=MAX_ROWS * MAX_COLS):
            try:
                _save(aid, st)
            except OSError:
                _CACHE.pop(aid, None)  # not kept: this read still shows them, the next computes again
    out = {"sheet": sh["id"], "name": sh["name"], "rev": sh["rev"], "edits": st.get("edits", 0),
           "hermes_active": time.time() - st.get("hermes_at", 0) < ACTIVE_SECS, "sheets": overview(st)}
    if not agent:  # the page hides its pill on its own when these run out
        out["hermes_left"], out["hermes_ago"] = left(st), ago(st)
    if since_rev is not None:
        since = int(since_rev)
        mine = [e for e in st["log"] if e["sheet"] == sh["id"]]
        newer = [e for e in mine if e["rev"] > since]
        oldest = min((e["rev"] for e in mine), default=None)
        lost = since < sh["rev"] and (oldest is None or oldest > since + 1)
        if lost or any(e.get("struct") or e.get("many") for e in newer):
            out["since"] = "unavailable"
        else:
            keys = set()
            for e in newer:
                keys.update(e.get("cells", []))
            cells = sh["cells"]
            out["changed"] = {k: cells[k] for k in sorted(keys) if k in cells}
            out["removed"] = sorted(k for k in keys if k not in cells)
            if not agent:
                out["fmt"] = {k: sh["fmt"].get(k) for k in sorted(keys)}
                out["cols"], out["freeze"], out["charts"] = sh["cols"], sh["freeze"], sh["charts"]
                out["rules"], out["merges"] = sh.get("rules") or [], sh.get("merges") or []
            out["values"] = {k: sh["vals"][k] for k in keys if k in sh["vals"]}
            out["stale"] = _stale(st, sh)
            return out
    if search:
        q = str(search).casefold()
        found = []
        for k, v in sh["cells"].items():
            shown = sh["vals"].get(k, v) if _is_formula(v) else v
            if q in str(v).casefold() or q in str(shown).casefold():
                found.append({"cell": k, "value": v})
        found.sort(key=lambda f: parse_key(f["cell"]))
        out["found"] = found[:100]
        if len(found) > 100:
            out["more"] = f"{len(found)} found: search narrower"
        return out
    mine = next(o for o in out["sheets"] if o["id"] == sh["id"])  # used(sh), counted for the overview
    out.update(_view(st, sh, range, agent, not agent, (mine["rows"], mine["cols"])))
    return out


def dump(aid: str) -> str:
    """The live workbook as compact JSON (ha_read without a path): each sheet as capped rows."""
    st = load(aid)
    meta = store.get_meta(aid) or {}
    sheets = []
    for sh in st["sheets"]:
        v = _view(st, sh, None, True, False)
        one = {"id": sh["id"], "name": sh["name"], "rev": sh["rev"], "range": v["range"], "rows": v["rows"]}
        if v["values"]:
            one["values"] = v["values"]
        if v.get("more"):
            one["more"] = v["more"]
        one.update(_extras(sh, None, True))
        sheets.append(one)
    return json.dumps({"title": meta.get("title", aid), "sheets": sheets}, ensure_ascii=False, separators=(",", ":"))


def with_lists(aid: str, out: dict) -> dict:
    """The page's read or history state, with the sheet's dropdown lists ({id: [options]}: what the
    ``opt`` of a cell's fmt names) when it has any."""
    sh = _sheet(load(aid), out.get("sheet"))
    if sh.get("lists"):
        out["lists"] = sh["lists"]
        if sh.get("list_colors"):
            out["list_colors"] = sh["list_colors"]
    return out


def _extras(sh: dict, rng: Optional[str], whole: bool = False) -> dict:
    out = {}
    if sh.get("merges"):
        r1, c1, r2, c2 = parse_range(rng, used(sh)) if rng else (0, 0, MAX_ROWS, MAX_COLS)
        m = [x for x, (a, b, c, d) in zip(sh["merges"], _boxes(sh)) if not (c < r1 or a > r2 or d < c1 or b > c2)]
        if m:
            out["merges"] = m if whole or len(m) <= 20 else m[:20] + [f"+{len(m) - 20}"]
    if sh.get("rules"):
        out["rules"] = sh["rules"] if whole or len(sh["rules"]) <= 10 else len(sh["rules"])
    return out


def extras(aid: str, sheet: Optional[str], rng: Optional[str] = None) -> dict:
    """What Hermes' read adds for a sheet with merged cells or conditional formats: ``merges`` (the
    merged ranges reaching into what was read, at most 20) and ``rules`` (the sheet's rules, all of
    them as the ``rules`` op replaces them all; just their count past 10: ha_read lists them)."""
    return _extras(_sheet(load(aid), sheet), rng)


def dropdowns(aid: str, sheet: Optional[str], rng: Optional[str] = None) -> dict:
    """{range: [options]} of the dropdown cells of a sheet (inside ``rng``), for Hermes' read: at
    most 20 ranges, none for a sheet without dropdowns."""
    sh = _sheet(load(aid), sheet)
    lists = sh.get("lists")
    if not lists:
        return {}
    r1, c1, r2, c2 = parse_range(rng, used(sh)) if rng else (0, 0, MAX_ROWS, MAX_COLS)
    cols: dict = {}
    for k, f in sh["fmt"].items():
        if f.get("opt") in lists:
            r, c = parse_key(k)
            if r1 <= r <= r2 and c1 <= c <= c2:
                cols.setdefault(c, []).append((r, f["opt"]))
    runs: dict = {}  # (first row, last row, list) -> its columns
    for c, cells in cols.items():
        cells.sort()
        a = 0
        for b in range(1, len(cells) + 1):
            if b == len(cells) or cells[b] != (cells[b - 1][0] + 1, cells[a][1]):
                runs.setdefault((cells[a][0], cells[b - 1][0], cells[a][1]), []).append(c)
                a = b
    out = {}
    for (ra, rb, i), cs in sorted(runs.items()):
        cs.sort()
        a = 0
        for b in range(1, len(cs) + 1):  # neighbouring columns with the same run: one block
            if b == len(cs) or cs[b] != cs[b - 1] + 1:
                if len(out) < 20:
                    out[range_name(ra, cs[a], rb, cs[b - 1])] = lists[i]
                a = b
    return out


# ----------------------------------------------------------------------------- edits

_GUARDED =("set", "clear", "delete_rows", "delete_cols", "sort", "delete_sheet", "merge")
_CELL_OPS = ("set", "clear", "format", "insert_rows", "delete_rows", "insert_cols", "delete_cols", "sort", "merge", "unmerge")


def _int(v, what: str, lo: int, hi: int) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v or not lo <= int(v) <= hi:
        raise SheetError("invalid", f"{what} is a whole number from {lo} to {hi}")
    return int(v)


def _col_at(v, what: str) -> int:
    """A column as a letter ("C") or a 1-based number -> 0-based index."""
    if isinstance(v, str) and re.fullmatch(r"[A-Za-z]{1,3}", v.strip()):
        c = col_index(v.strip())
    elif isinstance(v, (int, float)) and not isinstance(v, bool) and int(v) == v:
        c = int(v) - 1
    else:
        raise SheetError("invalid", f"{what} is a column letter like \"C\"")
    if not 0 <= c < MAX_COLS:
        raise SheetError("invalid", f"{what}: at most {MAX_COLS} columns (A to {col_name(MAX_COLS - 1)})")
    return c


def _block(values) -> list:
    if not isinstance(values, list):
        return [[values]]
    if values and not any(isinstance(r, list) for r in values):
        return [values]
    return [r if isinstance(r, list) else [r] for r in values]


def _keys_in(m: dict, r1: int, c1: int, r2: int, c2: int) -> list:
    if (r2 - r1 + 1) * (c2 - c1 + 1) <= len(m):
        return [k for k in (key(r, c) for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)) if k in m]
    return [k for k in m if r1 <= parse_key(k)[0] <= r2 and c1 <= parse_key(k)[1] <= c2]


def _touched(sh: dict, o: dict) -> tuple:
    """(cell keys an op writes over, whether any of them holds a value) for the guards."""
    kind = o.get("op")
    cells = sh["cells"]
    if kind == "set":
        r0, c0 = parse_range(o.get("range"))[:2]
        keys = set()
        for i, row in enumerate(_block(o.get("values"))):
            for j, v in enumerate(row):
                if v is not None and r0 + i < MAX_ROWS and c0 + j < MAX_COLS:
                    keys.add(key(r0 + i, c0 + j))
        return keys, any(k in cells for k in keys)
    if kind in ("clear", "sort"):
        r1, c1, r2, c2 = parse_range(o.get("range"), used(sh))
        keys = set(_keys_in(cells, r1, c1, r2, c2))
        return keys, bool(keys)
    if kind == "merge":  # empties every cell but the top-left one
        r1, c1, r2, c2 = parse_range(o.get("range"), used(sh))
        keys = set(_keys_in(cells, r1, c1, r2, c2)) - {key(r1, c1)}
        return keys, bool(keys)
    if kind in ("delete_rows", "delete_cols"):
        n = o.get("n", 1)
        n = n if isinstance(n, int) and not isinstance(n, bool) and n > 0 else 1
        if kind == "delete_rows":
            at = o.get("at")
            at = int(at) - 1 if isinstance(at, (int, float)) and not isinstance(at, bool) else -1
            keys = {k for k in cells if at <= parse_key(k)[0] < at + n}
        else:
            try:
                at = _col_at(o.get("at"), "at")
            except SheetError:
                at = -1
            keys = {k for k in cells if at <= parse_key(k)[1] < at + n}
        return keys, bool(keys)
    if kind == "delete_sheet":
        return set(cells), bool(cells)
    return set(), False


def apply(aid: str, ops: list, *, by: str, sheet: Optional[str] = None, base_rev: Optional[int] = None) -> dict:
    """Apply edits to one sheet, atomically (see the ops in sheet.json's guide). With ``base_rev``: cells
    someone else changed after that rev are not written over (code "conflict")."""
    if isinstance(ops, dict):
        ops = [ops]
    if not isinstance(ops, list) or not ops or not all(isinstance(o, dict) for o in ops):
        raise SheetError("invalid", "ops must be a non-empty list of {op: ...} objects")
    if len(ops) > MAX_OPS:
        raise SheetError("too_large", f"at most {MAX_OPS} ops in one edit")
    if by not in ("user", "hermes"):
        raise SheetError("invalid", "bad author")
    with _LOCK:
        st = load(aid)
        sh = _sheet(st, sheet)
        try:
            return _apply(aid, st, sh, ops, by, base_rev)
        except BaseException:
            _CACHE.pop(aid, None)  # the state in memory may be half changed: read it again from disk
            raise


def _apply(aid: str, st: dict, sh: dict, ops: list, by: str, base_rev: Optional[int]) -> dict:
    touched, nonempty = set(), False
    for o in ops:
        t, ne = _touched(sh, o)
        touched |= t
        nonempty |= ne and o.get("op") in _GUARDED
    if by == "hermes" and base_rev is None and nonempty:
        raise SheetError("missing_guard", "writing over cells that hold values needs base_rev: the rev you read "
                                          "(ha_live_read)", rev=sh["rev"])
    if base_rev is not None:
        base = int(base_rev)
        cell_ops = any(o.get("op") in _CELL_OPS for o in ops)
        for e in st["log"]:
            if e["sheet"] != sh["id"] or e["rev"] <= base or e["by"] == by:
                continue
            if e.get("struct") and cell_ops:
                raise SheetError("conflict", "rows, columns or the sheet changed meanwhile: read it again",
                                 rev=sh["rev"], cells=[])
            if not e.get("v", True):
                continue  # formats only
            hit = touched if e.get("many") else touched & set(e.get("cells", []))
            if hit:
                raise SheetError("conflict", "cells you change were changed meanwhile: read them again",
                                 rev=sh["rev"], cells=sorted(hit, key=parse_key)[:50])
    before = _snap(sh, "start")
    ctx = {"vals": set(), "fmt": set(), "struct": False, "outline": False, "new": None, "deleted": False, "skipped": []}
    for o in ops:
        _one(st, sh, o, ctx)
    sh["rev"] += 1
    st["edits"] = st.get("edits", 0) + (1 if by == "user" else 0)
    if by == "hermes":
        st["hermes_at"] = time.time()
    changed = sorted(ctx["vals"] | ctx["fmt"], key=parse_key)
    entry = {"sheet": sh["id"], "rev": sh["rev"], "by": by, "cells": changed[:MAX_LOG_CELLS], "at": time.time()}
    if not ctx["vals"]:
        entry["v"] = False
    if len(changed) > MAX_LOG_CELLS:
        entry["many"] = True
    if ctx["struct"]:
        entry["struct"] = True
    st["log"].append(entry)
    st["log"] = st["log"][-MAX_LOG:]
    _save(aid, st)
    if not ctx["deleted"]:
        _record(aid, st, sh, by, before)
    out = {"ok": True, "sheet": sh["id"], "rev": sh["rev"], "changed": changed[:MAX_LOG_CELLS]}
    if len(changed) > MAX_LOG_CELLS:
        out["changed_count"] = len(changed)
    if ctx["skipped"]:
        out["skipped"] = f"{', '.join(ctx['skipped'][:10])} not written: inside a merged cell (write its top-left cell)"
    if ctx["new"]:
        out["new_sheet"] = ctx["new"]
    if ctx["struct"] or ctx["outline"]:
        out["sheets"] = overview(st)
    return out


def _one(st: dict, sh: dict, o: dict, ctx: dict) -> None:
    kind = o.get("op")
    cells, fmt, vals = sh["cells"], sh["fmt"], sh["vals"]
    if kind == "set":
        r0, c0 = parse_range(o.get("range"))[:2]
        if "values" not in o:
            raise SheetError("invalid", "set needs values: [[...], ...] from the range's top-left cell")
        boxes = _boxes(sh)
        for i, row in enumerate(_block(o.get("values"))):
            for j, v in enumerate(row):
                if v is None:
                    continue
                r, c = r0 + i, c0 + j
                if r >= MAX_ROWS or c >= MAX_COLS:
                    raise SheetError("too_large", f"values reach past {MAX_ROWS} rows x {MAX_COLS} columns")
                v = _value(v, key(r, c))
                k = key(r, c)
                if v == "":
                    if k in cells:
                        del cells[k]
                        ctx["vals"].add(k)
                    vals.pop(k, None)
                    continue
                if boxes and any(a <= r <= b2 and b <= c <= d and (r, c) != (a, b) for a, b, b2, d in boxes):
                    ctx["skipped"].append(k)  # a merged cell holds content in its top-left cell only
                    continue
                if cells.get(k, None) != v or type(cells.get(k)) is not type(v):
                    cells[k] = v
                    ctx["vals"].add(k)
                if not _is_formula(v):
                    vals.pop(k, None)
    elif kind == "clear":
        r1, c1, r2, c2 = parse_range(o.get("range"), used(sh))
        for k in _keys_in(cells, r1, c1, r2, c2):
            del cells[k]
            vals.pop(k, None)
            ctx["vals"].add(k)
    elif kind == "format":
        f = _bind(sh, clean_fmt({k: v for k, v in o.items() if k not in ("op", "range")}, "format", allow_null=True))
        if not f:
            raise SheetError("invalid", "format needs keys to set: bold, italic, underline, wrap, align, num, bg, fg, "
                                        "options, colors, check, border")
        nr, nc = used(sh)
        r1, c1, r2, c2 = parse_range(o.get("range"), (nr + FMT_PAD, nc))
        _spread(sh, f, r1, c1, r2, c2, ctx["fmt"])
    elif kind == "rules":
        rules = _clean_rules(o.get("rules"), "rules")
        if rules:
            sh["rules"] = rules
        else:
            sh.pop("rules", None)
    elif kind == "merge":
        _merge(sh, o.get("range"), ctx["vals"])
    elif kind == "unmerge":
        _unmerge(sh, o.get("range"))
    elif kind in ("insert_rows", "delete_rows", "insert_cols", "delete_cols"):
        axis = "row" if kind.endswith("rows") else "col"
        insert = kind.startswith("insert")
        lim = MAX_ROWS if axis == "row" else MAX_COLS
        at = _int(o.get("at"), "at (1-based row)", 1, MAX_ROWS) - 1 if axis == "row" else _col_at(o.get("at"), "at")
        n = _int(o.get("n", 1), "n", 1, lim)
        _structural(st, sh, axis, at, n, insert, ctx)
    elif kind == "col_width":
        c = _col_at(o.get("col"), "col")
        w = o.get("w")
        if w is None:
            sh["cols"].pop(col_name(c), None)
        else:
            if isinstance(w, bool) or not isinstance(w, (int, float)):
                raise SheetError("invalid", "w is a width in px (40-800)")
            sh["cols"][col_name(c)] = int(min(800, max(40, w)))
    elif kind == "freeze":
        cur = sh["freeze"]
        sh["freeze"] = _clean_freeze(o.get("rows", cur.get("rows", 0)), o.get("cols", cur.get("cols", 0)), "freeze")
    elif kind == "sort":
        _sort(sh, o, ctx)
    elif kind == "add_chart":
        if len(sh["charts"]) >= MAX_CHARTS:
            raise SheetError("too_large", f"at most {MAX_CHARTS} charts in a sheet")
        sh["charts"].append(_clean_chart({k: v for k, v in o.items() if k != "op"}, "add_chart", sh["charts"]))
    elif kind == "delete_chart":
        cid = o.get("id")
        if not any(c["id"] == cid for c in sh["charts"]):
            raise SheetError("absent", f"no chart {cid!r} in this sheet")
        sh["charts"] = [c for c in sh["charts"] if c["id"] != cid]
    elif kind == "add_sheet":
        if len(st["sheets"]) >= MAX_SHEETS:
            raise SheetError("too_large", f"at most {MAX_SHEETS} sheets")
        new = sheet_from_spec({k: v for k, v in o.items() if k != "op"}, "add_sheet", [s["name"] for s in st["sheets"]])
        st["sheets"].append(new)
        ctx["new"], ctx["outline"] = new["id"], True
    elif kind == "rename_sheet":
        name = _check_name(o.get("name"), "rename_sheet")
        if any(s is not sh and s["name"].casefold() == name.casefold() for s in st["sheets"]):
            raise SheetError("invalid", f"a sheet is already named {name!r}")
        old = sh["name"].casefold()
        if name != sh["name"]:
            def cb(sheet, k, e1, e2):
                return (quote_name(name) + "!", None) if sheet is not None and sheet.casefold() == old else None
            _rewrite_all(st, lambda s: cb)
            sh["name"] = name
        ctx["outline"] = True
    elif kind == "delete_sheet":
        if len(st["sheets"]) == 1:
            raise SheetError("invalid", "a workbook keeps at least one sheet")
        st["sheets"] = [s for s in st["sheets"] if s is not sh]
        gone = sh["name"].casefold()
        _rewrite_all(st, lambda s: lambda sheet, k, e1, e2: "#REF!" if sheet is not None and sheet.casefold() == gone else None)
        ctx["outline"] = ctx["deleted"] = ctx["struct"] = True
    elif kind == "move_sheet":
        to = _int(o.get("to"), "to (0-based position)", 0, len(st["sheets"]) - 1)
        st["sheets"].remove(sh)
        st["sheets"].insert(to, sh)
        ctx["outline"] = True
    else:
        raise SheetError("invalid", f"unknown op {kind!r} (set, clear, format, insert_rows, delete_rows, insert_cols, "
                                    "delete_cols, col_width, freeze, sort, merge, unmerge, rules, add_chart, delete_chart, add_sheet, "
                                    "rename_sheet, delete_sheet, move_sheet)")


def _rewrite_all(st: dict, cb_for) -> None:
    """Run a reference rewrite over every formula of the workbook; ``cb_for(sheet)`` gives the
    map_refs callback for the formulas of that sheet (unprefixed references point into it)."""
    for s in st["sheets"]:
        cb = cb_for(s)
        for k, v in s["cells"].items():
            if _is_formula(v):
                nv = map_refs(v, cb)
                if nv != v:
                    s["cells"][k] = nv
        if s.get("rules"):  # new rule objects: a snapshot may share the old ones
            s["rules"] = [{**r, "if": map_refs(r["if"], cb)} if "if" in r else r for r in s["rules"]]


def _structural(st: dict, sh: dict, axis: str, at: int, n: int, insert: bool, ctx: dict) -> None:
    nr, nc = used(sh)
    lim = MAX_ROWS if axis == "row" else MAX_COLS
    if insert and (nr if axis == "row" else nc) + n > lim:
        raise SheetError("too_large", f"a sheet holds at most {MAX_ROWS} rows x {MAX_COLS} columns")
    i = 0 if axis == "row" else 1

    def move(m: dict, log: Optional[set]) -> dict:
        out = {}
        for k, v in m.items():
            p = parse_key(k)
            x = p[i]
            if insert:
                y = x + n if x >= at else x
            elif at <= x < at + n:
                if log is not None:
                    log.add(k)
                continue
            else:
                y = x - n if x >= at + n else x
            if y >= lim:
                continue
            out[key(y, p[1]) if axis == "row" else key(p[0], y)] = v
        return out

    sh["cells"] = move(sh["cells"], ctx["vals"])
    sh["fmt"] = move(sh["fmt"], None)
    if insert and 0 < at and at + n < lim:
        # Rows or columns put inside a run of dropdowns or checkboxes are that too.
        fmt = sh["fmt"]
        for k, f in list(fmt.items()):
            p = parse_key(k)
            if p[i] != at - 1 or ("opt" not in f and "check" not in f):
                continue
            after = fmt.get(key(at + n, p[1]) if axis == "row" else key(p[0], at + n)) or {}
            keep = {a: f[a] for a in ("opt", "check") if a in f and after.get(a) == f[a]}
            for y in range(at, at + n) if keep else ():
                fmt[key(y, p[1]) if axis == "row" else key(p[0], y)] = dict(keep)
    sh["vals"] = move(sh["vals"], None)
    if axis == "col":
        widths = {}
        for name, w in sh["cols"].items():
            y = _shift_one(col_index(name), at, n, insert)
            if y is not None and y < MAX_COLS:
                widths[col_name(y)] = w
        sh["cols"] = widths
    f = sh["freeze"]["rows" if axis == "row" else "cols"]
    if insert and at < f:
        f += n
    elif not insert:
        f -= max(0, min(f, at + n) - at)
    sh["freeze"]["rows" if axis == "row" else "cols"] = f

    def moved(rng: str) -> Optional[tuple]:
        """A range after the move: (its box, how far its first row or column was cut off) or None when all of it went."""
        b = list(parse_range(rng))
        res = _span(b[i], b[i + 2], at, n, insert)
        if res is None or res[0] >= lim:
            return None
        cut = at + n - b[i] if not insert and at <= b[i] < at + n else 0
        b[i], b[i + 2] = res[0], min(res[1], lim - 1)
        return tuple(b), cut

    merges = []
    for m in sh.get("merges") or ():
        got = moved(m)
        if got and (got[0][0], got[0][1]) != (got[0][2], got[0][3]):
            merges.append(range_name(*got[0]))
    if merges:
        sh["merges"] = merges
    else:
        sh.pop("merges", None)
    rules = []
    for r in sh.get("rules") or ():
        got = moved(r["range"])
        if not got:
            continue
        r = {**r, "range": range_name(*got[0])}
        if got[1] and "if" in r:  # its first rows or columns went: the formula is now written for the first one left
            r["if"] = shift_refs(r["if"], got[1] if axis == "row" else 0, got[1] if axis == "col" else 0)
        rules.append(r)
    if rules:
        sh["rules"] = rules
    else:
        sh.pop("rules", None)

    _rewrite_all(st, lambda s: _struct_cb(sh["name"], s["name"], axis, at, n, insert))
    charts = []
    for ch in sh["charts"]:
        rng = map_refs(ch["range"], _struct_cb(sh["name"], sh["name"], axis, at, n, insert))
        if rng == "#REF!":
            continue
        p = parse_key(ch.get("at") or "A1")
        y = _shift_one(p[i], at, n, insert)
        y = min(at if y is None else y, lim - 1)
        charts.append({**ch, "range": rng, "at": key(y, p[1]) if axis == "row" else key(p[0], y)})
    sh["charts"] = charts
    ctx["struct"] = True


def _shift_one(x: int, at: int, n: int, insert: bool) -> Optional[int]:
    res = _span(x, x, at, n, insert)
    return res[0] if res else None


def _sort_key(sh: dict, k: str):
    v = sh["cells"].get(k)
    if _is_formula(v):
        v = sh["vals"].get(k)
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return (2, int(v), "")
    if isinstance(v, (int, float)):
        return (0, v, "")
    return (1, 0, str(v.get("error") if isinstance(v, dict) else v).casefold())


def _sort(sh: dict, o: dict, ctx: dict) -> None:
    nr, nc = used(sh)
    r1, c1, r2, c2 = parse_range(o.get("range"), (nr, nc))
    kc = _col_at(o.get("col"), "col") if o.get("col") is not None else c1
    if not c1 <= kc <= c2:
        raise SheetError("invalid", f"col {col_name(kc)} is outside the range {range_name(r1, c1, r2, c2)}")
    for m, (a, b, c, d) in zip(sh.get("merges") or (), _boxes(sh)):
        if not (c < r1 or a > r2 or d < c1 or b > c2):
            raise SheetError("invalid", f"the merged cell {m} is in the way of sorting {range_name(r1, c1, r2, c2)}: unmerge it first")
    rows = list(range(r1, r2 + 1))
    keyed = [(r, _sort_key(sh, key(r, kc))) for r in rows]
    full = sorted((x for x in keyed if x[1] is not None), key=lambda x: x[1], reverse=bool(o.get("desc")))
    order = [r for r, _ in full] + [r for r, kk in keyed if kk is None]
    if order == rows:
        return
    dest = {src: new_r for new_r, src in zip(rows, order) if new_r != src}
    moved = {}
    for i, m in enumerate((sh["cells"], sh["fmt"], sh["vals"])):
        for k in _keys_in(m, r1, c1, r2, c2):
            r, c = parse_key(k)
            if r in dest:
                moved.setdefault((r, c), [None, None, None])[i] = m.pop(k)
    for (r, c), (v, f, val) in moved.items():
        to = dest[r]
        k = key(to, c)
        if v is not None:
            sh["cells"][k] = shift_refs(v, to - r, 0) if _is_formula(v) else v
            ctx["vals"].update((k, key(r, c)))
        if f is not None:
            sh["fmt"][k] = f
            ctx["fmt"].update((k, key(r, c)))
        if val is not None:
            sh["vals"][k] = val


# ----------------------------------------------------------------------------- the page's computed values

def set_vals(aid: str, sheet: Optional[str], rev, vals) -> dict:
    """What the page computed for the formula cells, merged in (null drops one). Ignored unless
    ``rev`` is the sheet's current rev. No rev bump: values are not edits."""
    if not isinstance(vals, dict):
        raise SheetError("invalid", "vals is {cell: value}")
    with _LOCK:
        st = load(aid)
        sh = _sheet(st, sheet)
        if rev is None or int(rev) != sh["rev"]:
            return {"ok": False, "ignored": True, "rev": sh["rev"]}
        try:
            cur = sh["vals"]
            calc.merge(cur, vals, _value, parse_key, MAX_ROWS * MAX_COLS)  # the check the server's own values pass too
            sh["vals"] = {k: v for k, v in cur.items() if _is_formula(sh["cells"].get(k))}
            sh["vals_at"] = time.time()
            _save(aid, st)
        except BaseException:
            _CACHE.pop(aid, None)
            raise
        return {"ok": True, "rev": sh["rev"]}


# ----------------------------------------------------------------------------- history
MAX_SNAPS = 60
MAX_SNAP_CELLS = 200_000  # all snapshots together keep at most this many cells
SNAP_GAP = 120            # seconds: edits by the same author closer than this share one snapshot


def _hist_path(aid: str) -> Path:
    return store._dir(aid) / "sheet" / "history.json"


_HIST_CACHE: dict = {}  # history.json path -> (stamp, parsed): every edit reads it, a big one parses slowly


def _hist(aid: str, version: int) -> list:
    """The snapshots (a new list; the snapshots in it are shared: never change one in place)."""
    try:
        h = store.json_cached(_hist_path(aid), _HIST_CACHE, 8)
    except (FileNotFoundError, ValueError):
        return []
    return list(h.get("snaps", [])) if h.get("version") == version else []


def _hist_save(aid: str, version: int, snaps: list) -> None:
    snaps = snaps[-MAX_SNAPS:]
    while len(snaps) > 2 and sum(len(x["cells"]) for x in snaps) > MAX_SNAP_CELLS:
        snaps.pop(0)
    p = _hist_path(aid)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    h = {"version": version, "snaps": snaps}
    tmp.write_text(json.dumps(h, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    st = tmp.stat()
    tmp.replace(p)
    store.json_remember(p, _HIST_CACHE, h, st, 8)


def _snap(sh: dict, by: str) -> dict:
    return {"sheet": sh["id"], "rev": sh["rev"], "by": by, "at": time.time(), "name": sh["name"],
            "cells": dict(sh["cells"]), "fmt": {k: dict(v) for k, v in sh["fmt"].items()}, "cols": dict(sh["cols"]),
            "freeze": dict(sh["freeze"]), "charts": [dict(c) for c in sh["charts"]],
            **{k: list(sh[k]) for k in ("rules", "merges") if sh.get(k)}}  # the rules themselves are never changed in place


def _record(aid: str, st: dict, sh: dict, by: str, before: Optional[dict]) -> None:
    snaps = _hist(aid, st["version"])
    mine = [x for x in snaps if x["sheet"] == sh["id"]]
    if not mine and before:  # the sheet as it started: always restorable
        snaps.append(before)
    last = mine[-1] if mine else None
    if last and last["by"] == by and by != "restore" and time.time() - last["at"] < SNAP_GAP:
        snaps[snaps.index(last)] = _snap(sh, by)
    else:
        snaps.append(_snap(sh, by))
    _hist_save(aid, st["version"], snaps)


def history(aid: str, sheet: Optional[str] = None) -> dict:
    """The sheet's snapshots, newest first: {rev, by, at, cells (count)}."""
    st = load(aid)
    sh = _sheet(st, sheet)
    snaps = [x for x in _hist(aid, st["version"]) if x["sheet"] == sh["id"]]
    return {"sheet": sh["id"], "rev": sh["rev"],
            "snaps": [{"rev": x["rev"], "by": x["by"], "at": x["at"], "cells": len(x["cells"])} for x in reversed(snaps)]}


def _snap_at(aid: str, st: dict, sh: dict, rev: int) -> dict:
    cands = [x for x in _hist(aid, st["version"]) if x["sheet"] == sh["id"] and x["rev"] <= int(rev)]
    if not cands:
        raise SheetError("absent", f"no snapshot at or before rev {rev}")
    return cands[-1]


def at_rev(aid: str, sheet: Optional[str], rev: int, *, agent: bool = False, range: Optional[str] = None) -> dict:
    """The sheet as it was at ``rev`` (the newest snapshot at or before it), in the shape of a read."""
    st = load(aid)
    sh = _sheet(st, sheet)
    x = _snap_at(aid, st, sh, rev)
    then = {"id": sh["id"], "name": x["name"], "cells": x["cells"], "fmt": x["fmt"], "vals": {},
            "cols": x["cols"], "freeze": x["freeze"], "charts": x["charts"], "vals_at": time.time(),
            "rules": x.get("rules"), "merges": x.get("merges")}
    out = {"sheet": sh["id"], "name": x["name"], "rev": x["rev"], "current_rev": sh["rev"], "by": x["by"], "at": x["at"]}
    v = _view(st, then, range, agent, not agent)
    v.pop("values", None)
    v.pop("stale", None)
    out.update(v)
    return out


def restore(aid: str, sheet: Optional[str], rev: int) -> dict:
    """Bring a sheet back to a snapshot, as a new rev by the person (itself undoable the same way)."""
    with _LOCK:
        st = load(aid)
        sh = _sheet(st, sheet)
        x = _snap_at(aid, st, sh, rev)
        try:
            before = _snap(sh, "user")
            sh["cells"], sh["fmt"] = dict(x["cells"]), {k: dict(v) for k, v in x["fmt"].items()}
            lists = sh.get("lists") or {}
            for k in [k for k, f in sh["fmt"].items() if "opt" in f and f["opt"] not in lists]:  # a list dropped since
                del sh["fmt"][k]["opt"]
                if not sh["fmt"][k]:
                    del sh["fmt"][k]
            sh["cols"], sh["freeze"], sh["charts"] = dict(x["cols"]), dict(x["freeze"]), [dict(c) for c in x["charts"]]
            for k in ("rules", "merges"):
                if x.get(k):
                    sh[k] = list(x[k])
                else:
                    sh.pop(k, None)
            sh["vals"] = {k: v for k, v in sh["vals"].items() if _is_formula(sh["cells"].get(k))}
            sh["rev"] += 1
            st["edits"] = st.get("edits", 0) + 1
            st["log"].append({"sheet": sh["id"], "rev": sh["rev"], "by": "user", "cells": [], "at": time.time(),
                              "struct": True, "restored": x["rev"]})
            st["log"] = st["log"][-MAX_LOG:]
            _save(aid, st)
        except BaseException:
            _CACHE.pop(aid, None)
            raise
        _record(aid, st, sh, "restore", before)
        return {"ok": True, "sheet": sh["id"], "rev": sh["rev"], "restored": x["rev"]}
