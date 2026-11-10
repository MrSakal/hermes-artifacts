"""A spreadsheet file (.xlsx, .csv, .tsv) as a sheet artifact's sheet.json, with the standard library only.

xlsx: values, formulas (shared ones expanded), sheet names, column widths, frozen rows/columns,
bold and number formats; dates become ``YYYY-MM-DD`` text. Anything else is dropped.
csv/tsv: the separator is sniffed (, ; tab), UTF-8 with or without BOM, else cp1250; numbers,
booleans and dates are typed.
"""

from __future__ import annotations

import csv
import datetime as _dt
import io
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from .sheets import _BAD_NAME, MAX_COLS, MAX_ROWS, MAX_TEXT, col_name, key, parse_key, shift_refs

MAX_XML_BYTES = 200 * 1024 * 1024  # all the parts read together, unpacked


def to_sheet_json(path) -> dict:
    p = Path(path)
    ext = p.suffix.lower()
    if ext == ".xlsx":
        return _xlsx(p)
    if ext in (".csv", ".tsv", ".txt"):
        return _csv(p, "\t" if ext == ".tsv" else None)
    raise ValueError(f"a sheet is made from .xlsx, .csv or .tsv, not {ext or 'this file'}")


def _title(p: Path) -> str:
    return (p.stem.replace("_", " ").strip() or "Sheet")[:120]


def _name(raw: str, taken: list) -> str:
    base = _BAD_NAME.sub("_", str(raw or "")).strip()[:40] or "Sheet"
    name, i = base, 2
    while name.casefold() in (t.casefold() for t in taken):
        suffix = f" ({i})"
        name, i = base[: 40 - len(suffix)] + suffix, i + 1
    return name


def _rows(cells: dict) -> list:
    nr = nc = 0
    for k in cells:
        r, c = parse_key(k)
        nr, nc = max(nr, r + 1), max(nc, c + 1)
    rows = [[None] * nc for _ in range(nr)]
    for k, v in cells.items():
        r, c = parse_key(k)
        rows[r][c] = v
    for row in rows:
        while row and row[-1] is None:
            row.pop()
    return rows


# ----------------------------------------------------------------------------- CSV

_NUM = re.compile(r"^[+-]?(\d+([.,]\d+)?|\d{1,3}([  .,]\d{3})+([.,]\d+)?)([eE][+-]?\d+)?$")


def _typed(s: str, sep: str):
    t = s.strip()
    if t == "":
        return None
    if t.upper() in ("TRUE", "FALSE", "IGAZ", "HAMIS"):
        return t.upper() in ("TRUE", "IGAZ")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?", t):
        return t[:16]
    m = re.fullmatch(r"(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})\.?", t)
    if m:
        try:
            return _dt.date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            return s[:MAX_TEXT]
    if _NUM.match(t) and not (len(t) > 1 and t[0] == "0" and t[1].isdigit()):  # 0123: a code, kept as text
        n = t.replace(" ", "").replace(" ", "")
        # The decimal mark: "," when the file separates with ";" (or "," is the last mark and "." groups).
        if "," in n and "." in n:
            n = n.replace(".", "").replace(",", ".") if n.rfind(",") > n.rfind(".") else n.replace(",", "")
        elif "," in n:
            n = n.replace(",", ".") if sep != "," and n.count(",") == 1 else n.replace(",", "")
        try:
            f = float(n)
            return int(f) if f.is_integer() and abs(f) < 1e15 and "e" not in n.lower() else f
        except ValueError:
            pass
    return s[:MAX_TEXT]


def _csv(p: Path, sep) -> dict:
    raw = p.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1250", errors="replace")
    if sep is None:
        sample = text[:20000]
        try:
            sep = csv.Sniffer().sniff(sample, delimiters=",;\t").delimiter
        except csv.Error:
            first = sample.split("\n", 1)[0]
            sep = max((",", ";", "\t"), key=first.count)
    cells = {}
    for r, row in enumerate(csv.reader(io.StringIO(text, newline=""), delimiter=sep)):
        if r >= MAX_ROWS:
            raise ValueError(f"{p.name}: more than {MAX_ROWS} rows (a sheet holds {MAX_ROWS} x {MAX_COLS})")
        if len(row) > MAX_COLS and any(x.strip() for x in row[MAX_COLS:]):
            raise ValueError(f"{p.name}: more than {MAX_COLS} columns (a sheet holds {MAX_ROWS} x {MAX_COLS})")
        for c, s in enumerate(row[:MAX_COLS]):
            v = _typed(s, sep)
            if v is not None:
                cells[key(r, c)] = v
    return {"title": _title(p), "sheets": [{"name": _name(p.stem, []), "rows": _rows(cells),
                                            **({"freeze": {"rows": 1}} if cells else {})}]}


# ----------------------------------------------------------------------------- xlsx

def _local(tag) -> str:
    return str(tag).rsplit("}", 1)[-1]


def _kids(el, name):
    return [c for c in el if _local(c.tag) == name]


def _kid(el, name):
    return next((c for c in el if _local(c.tag) == name), None)


def _attr(el, name, default=None):
    for k, v in el.attrib.items():
        if _local(k) == name:
            return v
    return default


class _Zip:
    def __init__(self, path: Path):
        self.z = zipfile.ZipFile(path)
        self.names = {n.lower(): n for n in self.z.namelist()}
        self.read_bytes = 0

    def xml(self, name: str):
        real = self.names.get(name.lstrip("/").lower())
        if real is None:
            return None
        info = self.z.getinfo(real)
        self.read_bytes += info.file_size
        if self.read_bytes > MAX_XML_BYTES:
            raise ValueError("the workbook is too large to import")
        data = self.z.read(real)
        if b"<!DOCTYPE" in data[:4096].upper():
            raise ValueError("the workbook holds a DOCTYPE: not imported")
        return ET.fromstring(data)


def _rels(zf: _Zip, part: str) -> dict:
    d, f = posixpath.split(part)
    root = zf.xml(posixpath.join(d, "_rels", f + ".rels"))
    out = {}
    for r in (root if root is not None else []):
        tgt = _attr(r, "Target") or ""
        out[_attr(r, "Id")] = tgt.lstrip("/") if tgt.startswith("/") else posixpath.normpath(posixpath.join(d, tgt))
    return out


def _text(si) -> str:
    """A shared or inline string: its <t>, or its runs' <t>s (phonetic runs left out)."""
    t = _kid(si, "t")
    if t is not None:
        return t.text or ""
    return "".join((_kid(r, "t").text or "") for r in _kids(si, "r") if _kid(r, "t") is not None)


_BUILTIN = {1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00",
            14: "yyyy-mm-dd", 15: "yyyy-mm-dd", 16: "yyyy-mm-dd", 17: "yyyy-mm-dd", 18: "hh:mm",
            19: "hh:mm", 20: "hh:mm", 21: "hh:mm", 22: "yyyy-mm-dd hh:mm", 45: "hh:mm", 46: "hh:mm",
            47: "hh:mm", 49: "@"}


def _is_date(code: str) -> bool:
    bare = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', "", code or "").lower()
    return bool(re.search(r"[yd]", bare)) or ("m" in bare and "h" not in bare and "s" not in bare and "0" not in bare)


def _styles(zf: _Zip, part: str) -> list:
    """Per cell style index: (number format code | None, bold)."""
    root = zf.xml(part) if part else None
    if root is None:
        return []
    codes = dict(_BUILTIN)
    nf = _kid(root, "numFmts")
    for f in (nf if nf is not None else []):
        try:
            codes[int(_attr(f, "numFmtId"))] = _attr(f, "formatCode") or ""
        except (TypeError, ValueError):
            pass
    bolds = []
    fonts = _kid(root, "fonts")
    for f in (fonts if fonts is not None else []):
        b = _kid(f, "b")
        bolds.append(b is not None and _attr(b, "val", "1") not in ("0", "false"))
    out = []
    xfs = _kid(root, "cellXfs")
    for x in (xfs if xfs is not None else []):
        try:
            num = codes.get(int(_attr(x, "numFmtId", "0")))
        except ValueError:
            num = None
        try:
            bold = bolds[int(_attr(x, "fontId", "0"))]
        except (ValueError, IndexError):
            bold = False
        out.append((num if num and num.lower() != "general" else None, bold))
    return out


def _serial_date(v: float, with_time: bool) -> str:
    d = _dt.datetime(1899, 12, 30) + _dt.timedelta(days=v)
    return d.strftime("%Y-%m-%dT%H:%M") if with_time and (v % 1) else d.strftime("%Y-%m-%d")


def _num(s: str):
    f = float(s)
    return int(f) if f.is_integer() and abs(f) < 1e15 else f


def _formula(f: str) -> str:
    f = re.sub(r"_xlfn\.(_xlws\.)?", "", f or "")
    return "=" + f[:MAX_TEXT - 1]


def _xlsx(p: Path) -> dict:
    try:
        zf = _Zip(p)
    except zipfile.BadZipFile:
        raise ValueError(f"{p.name} is not an .xlsx workbook")
    with zf.z:
        wb_part = "xl/workbook.xml"
        for tgt in _rels(zf, "").values():
            if tgt.lower().endswith("workbook.xml"):
                wb_part = tgt
        wb = zf.xml(wb_part)
        if wb is None:
            raise ValueError(f"{p.name}: no workbook inside")
        rels = _rels(zf, wb_part)
        shared = []
        styles_part = None
        for tgt in rels.values():
            low = tgt.lower()
            if low.endswith("sharedstrings.xml"):
                sst = zf.xml(tgt)
                shared = [_text(si) for si in (sst if sst is not None else [])]
            elif low.endswith("styles.xml"):
                styles_part = tgt
        styles = _styles(zf, styles_part)
        out, names = [], []
        sheets_el = _kid(wb, "sheets")
        for s in (sheets_el if sheets_el is not None else []):
            if _attr(s, "state") in ("hidden", "veryHidden"):
                continue
            part = rels.get(_attr(s, "id"))
            ws = zf.xml(part) if part else None
            if ws is None:
                continue
            name = _name(_attr(s, "name") or "Sheet", names)
            names.append(name)
            out.append(_sheet(ws, name, shared, styles))
            if len(out) >= 20:
                break
        if not out:
            raise ValueError(f"{p.name}: no sheet with cells inside")
        return {"title": _title(p), "sheets": out}


def _sheet(ws, name: str, shared: list, styles: list) -> dict:
    cells, fmts, masters = {}, {}, {}
    data = _kid(ws, "sheetData")
    for row in (data if data is not None else []):
        for c in _kids(row, "c"):
            ref = _attr(c, "r")
            pos = parse_key(ref) if ref else None
            if not pos:
                continue
            if pos[0] >= MAX_ROWS or pos[1] >= MAX_COLS:
                raise ValueError(f"sheet {name!r} reaches {ref}: a sheet holds {MAX_ROWS} rows x {MAX_COLS} columns")
            t = _attr(c, "t", "n")
            try:
                num, bold = styles[int(_attr(c, "s", "0"))]
            except (ValueError, IndexError):
                num, bold = None, False
            f, v = _kid(c, "f"), _kid(c, "v")
            val = None
            if f is not None:
                ftxt = f.text or ""
                if _attr(f, "t") == "shared":
                    si = _attr(f, "si")
                    if ftxt:
                        masters[si] = (pos, ftxt)
                    elif si in masters:
                        (r0, c0), base = masters[si]
                        ftxt = shift_refs("=" + base, pos[0] - r0, pos[1] - c0)[1:]
                if ftxt:
                    val = _formula(ftxt)
            if val is None:
                if t == "s" and v is not None:
                    try:
                        val = shared[int(v.text)]
                    except (ValueError, IndexError, TypeError):
                        val = None
                elif t == "inlineStr":
                    isel = _kid(c, "is")
                    val = _text(isel) if isel is not None else None
                elif t == "b" and v is not None:
                    val = (v.text or "").strip() == "1"
                elif t in ("str", "e") and v is not None:
                    val = v.text
                elif v is not None and v.text not in (None, ""):
                    try:
                        val = _num(v.text)
                    except ValueError:
                        val = v.text
                    if num and isinstance(val, (int, float)) and _is_date(num) and 0 < val < 2958466:
                        val = _serial_date(val, "h" in num.lower())
                        num = None
            if isinstance(val, str):
                val = val[:MAX_TEXT]
            k = key(*pos)
            if val is not None and val != "":
                cells[k] = val
            f_ = {}
            if bold:
                f_["bold"] = True
            if num and len(num) <= 80 and k in cells:
                f_["num"] = num
            if f_ and k in cells:
                fmts[k] = f_
    out = {"name": name, "rows": _rows(cells)}
    if fmts:
        out["formats"] = fmts
    cols = {}
    cols_el = _kid(ws, "cols")
    for col in (cols_el if cols_el is not None else []):
        try:
            lo, hi, w = int(_attr(col, "min")), int(_attr(col, "max")), float(_attr(col, "width"))
        except (TypeError, ValueError):
            continue
        if _attr(col, "hidden") in ("1", "true"):
            continue
        for i in range(lo - 1, min(hi, MAX_COLS)):
            px = int(round(w * 7 + 5))
            if px != 69:  # Excel's default width needs no entry
                cols[col_name(i)] = min(800, max(40, px))
    if cols:
        out["cols"] = cols
    views = _kid(ws, "sheetViews")
    view = _kid(views, "sheetView") if views is not None else None
    pane = _kid(view, "pane") if view is not None else None
    if pane is not None and _attr(pane, "state") in ("frozen", "frozenSplit"):
        try:
            fr = {"rows": min(MAX_ROWS, int(float(_attr(pane, "ySplit", "0")))),
                  "cols": min(MAX_COLS, int(float(_attr(pane, "xSplit", "0"))))}
            if fr["rows"] or fr["cols"]:
                out["freeze"] = fr
        except ValueError:
            pass
    return out

