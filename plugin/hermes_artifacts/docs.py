"""Live docs: a document of tabs and blocks that the user and Hermes edit together, block by block.

The model Claude Docs uses, kept on the Hermes server: a doc holds tabs; a tab holds blocks; a block
is one paragraph-level piece of Markdown (a heading, a paragraph, a list, a table, a quote, a code
block, a rule, an image) with a stable id. Every change bumps the tab's ``rev`` and is logged, so a
reader can ask for what changed since the rev it last saw, and an edit made against an older rev of a
block someone changed meanwhile is refused instead of overwriting it.

State lives in ``<artifact>/doc/state.json``, outside the artifact's versions (a doc changes keystroke
by keystroke). Publishing a new version of the artifact (doc.md) starts the doc again from that text.
"""

from __future__ import annotations

import json
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Optional

from . import store

_LOCK = threading.RLock()
MAX_BLOCK_CHARS = 20_000
MAX_BLOCKS = 4000
MAX_LOG = 400
_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


class DocError(Exception):
    def __init__(self, code: str, message: str, **extra):
        super().__init__(message)
        self.code, self.message, self.extra = code, message, extra


def _new_id(prefix: str = "b") -> str:
    return f"{prefix}-{secrets.token_hex(4)}"


# ----------------------------------------------------------------------------- Markdown -> blocks

def split_markdown(text: str) -> list[str]:
    """Split Markdown into block-sized pieces: fenced code, tables, lists and quotes stay whole."""
    lines = str(text or "").replace("\r\n", "\n").split("\n")
    out, cur, i = [], [], 0

    def flush():
        if cur and any(l.strip() for l in cur):
            out.append("\n".join(cur).strip("\n"))
        cur.clear()

    while i < len(lines):
        line = lines[i]
        fence = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if fence:
            flush()
            mark, block = fence.group(1), [line]
            i += 1
            while i < len(lines):
                block.append(lines[i])
                if re.match(r"^\s{0,3}" + re.escape(mark[0]) + "{" + str(len(mark)) + r",}\s*$", lines[i]):
                    i += 1
                    break
                i += 1
            out.append("\n".join(block))
            continue
        if not line.strip():
            flush()
            i += 1
            continue
        if re.match(r"^\s{0,3}#{1,6}\s", line) or re.match(r"^\s{0,3}([-*_])(\s*\1){2,}\s*$", line):
            flush()
            out.append(line.strip())
            i += 1
            continue
        kind = "list" if re.match(r"^\s*([-+*]|\d{1,9}[.)])\s+", line) else "quote" if re.match(r"^\s{0,3}>", line) \
            else "table" if "|" in line and i + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{2,}", lines[i + 1]) else None
        if kind and cur:
            flush()
        cur.append(line)
        i += 1
        if kind:  # keep reading the whole list / quote / table, blank lines inside lists included
            while i < len(lines):
                nxt = lines[i]
                if kind == "table" and ("|" in nxt and nxt.strip()):
                    cur.append(nxt); i += 1; continue
                if kind == "quote" and re.match(r"^\s{0,3}>", nxt):
                    cur.append(nxt); i += 1; continue
                if kind == "list" and (re.match(r"^\s*([-+*]|\d{1,9}[.)])\s+", nxt) or (nxt.startswith(("  ", "\t")) and nxt.strip())):
                    cur.append(nxt); i += 1; continue
                if kind == "list" and not nxt.strip() and i + 1 < len(lines) and re.match(r"^\s*([-+*]|\d{1,9}[.)])\s+|^\s{2,}\S", lines[i + 1]):
                    cur.append(nxt); i += 1; continue
                break
            flush()
    flush()
    return out


def block_kind(md: str) -> str:
    s = md.lstrip()
    if re.match(r"#{1,6}\s", s):
        return "h" + str(len(s) - len(s.lstrip("#")))
    if re.match(r"(`{3,}|~{3,})", s):
        return "code"
    if re.match(r"([-*_])(\s*\1){2,}\s*$", s):
        return "hr"
    if re.match(r"[-+*]\s+\[[ xX]\]", s):
        return "todo"
    if re.match(r"([-+*])\s+", s):
        return "ul"
    if re.match(r"\d{1,9}[.)]\s+", s):
        return "ol"
    if s.startswith(">"):
        return "quote"
    if "|" in s.split("\n", 1)[0] and len(s.split("\n")) > 1 and re.match(r"\s*\|?\s*:?-{2,}", s.split("\n")[1]):
        return "table"
    if re.match(r"!\[[^\]]*\]\([^)]+\)\s*$", s):
        return "image"
    return "p"


def blocks_from_markdown(text: str) -> list[dict]:
    return [{"id": _new_id(), "md": piece} for piece in split_markdown(text)]


def tab_markdown(tab: dict) -> str:
    return "\n\n".join(b["md"] for b in tab["blocks"]) + "\n"


# ----------------------------------------------------------------------------- state

def _state_path(aid: str) -> Path:
    return store._dir(aid) / "doc" / "state.json"


def _fresh(aid: str, meta: dict) -> dict:
    """A doc started from the latest published version: doc.md becomes the first tab, or doc.json
    (``{"tabs": [{"title", "markdown"}]}``) gives several."""
    tabs = []
    try:
        spec = json.loads(store.read_file(aid, "doc.json").decode("utf-8"))
        for t in spec.get("tabs") or []:
            tabs.append({"id": _new_id("t"), "title": str(t.get("title") or "Tab")[:120],
                         "blocks": blocks_from_markdown(t.get("markdown") or ""), "rev": 1})
    except (FileNotFoundError, ValueError, AttributeError):
        pass
    if not tabs:
        try:
            md = store.read_file(aid, "doc.md").decode("utf-8")
        except FileNotFoundError:
            md = ""
        tabs = [{"id": _new_id("t"), "title": meta.get("title", "Doc")[:120], "blocks": blocks_from_markdown(md), "rev": 1}]
    return {"version": meta["versions"][-1]["n"], "tabs": tabs, "log": [], "edits": 0, "updated": time.time()}


def load(aid: str) -> dict:
    meta = store.get_meta(aid)
    if not meta or meta.get("type") != "doc":
        raise DocError("absent", "not a doc")
    with _LOCK:
        p = _state_path(aid)
        st = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None
        if st is None or st.get("version") != meta["versions"][-1]["n"]:
            st = _fresh(aid, meta)
            _save(aid, st)
        return st


def _save(aid: str, st: dict) -> None:
    p = _state_path(aid)
    p.parent.mkdir(parents=True, exist_ok=True)
    st["updated"] = time.time()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


def _tab(st: dict, tab: Optional[str]) -> dict:
    if not tab:
        return st["tabs"][0]
    for t in st["tabs"]:
        if t["id"] == tab or t["title"] == tab:
            return t
    raise DocError("absent", f"no tab {tab!r}")


def _index(t: dict, bid: str) -> int:
    for i, b in enumerate(t["blocks"]):
        if b["id"] == bid:
            return i
    raise DocError("absent", f"no block {bid!r} in this tab")


def overview(st: dict) -> list[dict]:
    return [{"id": t["id"], "title": t["title"], "rev": t["rev"], "blocks": len(t["blocks"])} for t in st["tabs"]]


def read(aid: str, tab: Optional[str] = None, *, since_rev: Optional[int] = None, search: Optional[str] = None,
         blocks: Optional[list[str]] = None) -> dict:
    """A tab's blocks (id, kind, md), or what changed since ``since_rev``, or the blocks whose text holds
    ``search``, or just the named ``blocks``."""
    st = load(aid)
    t = _tab(st, tab)
    out = {"tab": t["id"], "title": t["title"], "rev": t["rev"], "tabs": overview(st), "edits": st.get("edits", 0)}
    view = [{"id": b["id"], "kind": block_kind(b["md"]), "md": b["md"]} for b in t["blocks"]]
    if since_rev is not None:
        changed = {}
        for e in st["log"]:
            if e["tab"] == t["id"] and e["rev"] > since_rev:
                for bid in e.get("blocks", []):
                    changed[bid] = e["by"]
        ids = {b["id"] for b in t["blocks"]}
        out["changed"] = [dict(v, by=changed[v["id"]]) for v in view if v["id"] in changed]
        out["removed"] = [bid for bid in changed if bid not in ids]
        return out
    if blocks:
        want = set(blocks)
        out["blocks"] = [v for v in view if v["id"] in want]
        return out
    if search:
        q = search.lower()
        out["blocks"] = [v for v in view if q in v["md"].lower()]
        return out
    out["blocks"] = view
    return out


# ----------------------------------------------------------------------------- edits

def apply(aid: str, ops: list[dict], *, by: str, tab: Optional[str] = None, base_rev: Optional[int] = None) -> dict:
    """Apply edits to one tab, atomically. Ops:
      {"op": "replace", "block": id, "md": "…"}           change a block (or split it: md with blank lines)
      {"op": "insert", "after": id | null, "md": "…"}      new block(s) after a block (null = at the top)
      {"op": "delete", "block": id}
      {"op": "move", "block": id, "after": id | null}
      {"op": "add_tab", "title": "…", "md": "…"} / {"op": "rename_tab", "title": "…"} / {"op": "delete_tab"}
    With ``base_rev``: a block someone else changed after that rev is not overwritten (code "conflict")."""
    if not isinstance(ops, list) or not ops:
        raise DocError("invalid", "ops must be a non-empty list")
    if by not in ("user", "hermes"):
        raise DocError("invalid", "bad author")
    with _LOCK:
        st = load(aid)
        t = _tab(st, tab)
        if base_rev is not None:
            touched = {o.get("block") for o in ops if o.get("block")}
            for e in st["log"]:
                if e["tab"] == t["id"] and e["rev"] > int(base_rev) and e["by"] != by and touched & set(e.get("blocks", [])):
                    raise DocError("conflict", "a block you changed was changed meanwhile: read it again",
                                   rev=t["rev"], blocks=sorted(touched & set(e.get("blocks", []))))
        changed: list[str] = []
        new_tab = None
        for o in ops:
            kind = o.get("op")
            if kind == "replace":
                i = _index(t, str(o.get("block")))
                pieces = split_markdown(str(o.get("md", ""))[:MAX_BLOCK_CHARS]) or [""]
                t["blocks"][i]["md"] = pieces[0]
                extra = [{"id": _new_id(), "md": p} for p in pieces[1:]]
                t["blocks"][i + 1:i + 1] = extra
                changed += [t["blocks"][i]["id"]] + [b["id"] for b in extra]
            elif kind == "insert":
                after = o.get("after")
                at = 0 if after in (None, "") else _index(t, str(after)) + 1
                new = [{"id": _new_id(), "md": p} for p in split_markdown(str(o.get("md", ""))[:MAX_BLOCK_CHARS * 10])]
                if not new:
                    new = [{"id": _new_id(), "md": ""}]
                t["blocks"][at:at] = new
                changed += [b["id"] for b in new]
            elif kind == "delete":
                i = _index(t, str(o.get("block")))
                changed.append(t["blocks"].pop(i)["id"])
            elif kind == "move":
                i = _index(t, str(o.get("block")))
                b = t["blocks"].pop(i)
                after = o.get("after")
                at = 0 if after in (None, "") else _index(t, str(after)) + 1
                t["blocks"].insert(at, b)
                changed.append(b["id"])
            elif kind == "add_tab":
                new_tab = {"id": _new_id("t"), "title": str(o.get("title") or "Tab")[:120],
                           "blocks": blocks_from_markdown(o.get("md") or ""), "rev": 1}
                st["tabs"].append(new_tab)
            elif kind == "rename_tab":
                t["title"] = str(o.get("title") or t["title"])[:120]
                changed.append("tab")
            elif kind == "delete_tab":
                if len(st["tabs"]) == 1:
                    raise DocError("invalid", "a doc keeps at least one tab")
                st["tabs"] = [x for x in st["tabs"] if x["id"] != t["id"]]
                changed.append("tab")
            else:
                raise DocError("invalid", f"unknown op {kind!r}")
        if len(t["blocks"]) > MAX_BLOCKS:
            raise DocError("too_large", "the tab is over 4000 blocks")
        t["rev"] += 1
        st["edits"] = st.get("edits", 0) + (1 if by == "user" else 0)
        st["log"].append({"tab": t["id"], "rev": t["rev"], "by": by, "blocks": changed, "at": time.time()})
        st["log"] = st["log"][-MAX_LOG:]
        _save(aid, st)
        return {"ok": True, "tab": t["id"], "rev": t["rev"], "changed": changed,
                "new_tab": new_tab["id"] if new_tab else None}


def markdown(aid: str) -> str:
    st = load(aid)
    if len(st["tabs"]) == 1:
        return tab_markdown(st["tabs"][0])
    return "\n\n".join(f"# {t['title']}\n\n" + tab_markdown(t) for t in st["tabs"])
