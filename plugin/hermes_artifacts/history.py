"""A dashboard's History: every version with who made it and what changed ("Edited the
page", "Added Signups", "Edited the filters", "Created the page", "Restored the 10:42 version"), the
changes of one version line by line, and Restore (a new version holding that one's files)."""

from __future__ import annotations

import difflib
import json
from pathlib import Path
from typing import Optional

from . import store

PAGE_EXT = (".html", ".css", ".js")
MAX_DIFF_LINES = 400


def _files(vdir: Path) -> dict[str, bytes]:
    if not vdir.is_dir():
        raise FileNotFoundError(f"{vdir.parent.name} {vdir.name}")
    return {rel: (vdir / rel).read_bytes() for rel, _ in store.walk_files(vdir)}


def _text(b: Optional[bytes]) -> Optional[str]:
    if b is None:
        return None
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _spec(files: dict[str, bytes]) -> dict:
    try:
        v = json.loads(files.get("dashboard.json", b"{}").decode("utf-8"))
        return v if isinstance(v, dict) else {}
    except (ValueError, UnicodeDecodeError):
        return {}


def _docs(files: dict[str, bytes], kind: str) -> dict[str, dict]:
    """The documents a version is made of, the way Claude's History names them: the page, each
    source, the filters, the title, the look; for other types each file."""
    out: dict[str, dict] = {}
    if kind == "dashboard":
        spec = _spec(files)
        for did, d in (spec.get("datasets") or {}).items():
            if isinstance(d, dict):
                out[f"source:{did}"] = {"kind": "source", "name": str(d.get("title") or did),
                                        "text": json.dumps(d, indent=2, ensure_ascii=False, sort_keys=True)}
        if "params" in spec:
            out["filters"] = {"kind": "filters", "name": "Filters", "text": json.dumps(spec.get("params"), indent=2, ensure_ascii=False, sort_keys=True)}
        if spec.get("title") is not None:
            out["title"] = {"kind": "title", "name": "Title", "text": str(spec.get("title"))}
        if spec.get("look") is not None:
            out["look"] = {"kind": "look", "name": "Look", "text": json.dumps(spec.get("look"), indent=2, ensure_ascii=False, sort_keys=True)}
        if spec.get("layout") is not None:
            out["page:layout"] = {"kind": "page", "name": "dashboard.json layout", "text": json.dumps(spec.get("layout"), indent=2, ensure_ascii=False)}
        for rel, b in files.items():
            if rel.endswith(PAGE_EXT) and not rel.startswith("drafts/"):
                out[f"page:{rel}"] = {"kind": "page", "name": rel, "text": _text(b) or ""}
            elif rel.startswith("drafts/"):
                did = rel.split("/")[1]
                out.setdefault(f"draft:{did}", {"kind": "draft", "name": f"Draft {did}", "text": ""})
                out[f"draft:{did}"]["text"] += rel + ":" + str(len(b)) + chr(10)
            elif rel.startswith("data/"):
                out[f"file:{rel}"] = {"kind": "file", "name": rel, "text": _text(b) if len(b) < 400_000 else None, "size": len(b)}
    else:
        for rel, b in files.items():
            out[f"file:{rel}"] = {"kind": "file", "name": rel, "text": _text(b) if len(b) < 400_000 else None, "size": len(b)}
    return out


def _changes(before: Optional[dict], now: dict) -> list[dict]:
    before = before or {}
    out = []
    for key in sorted(set(before) | set(now)):
        a, b = before.get(key), now.get(key)
        if a is not None and b is not None and a.get("text") == b.get("text") and a.get("size") == b.get("size"):
            continue
        kind = "added" if a is None else "removed" if b is None else "edited"
        doc = b or a
        out.append({"key": key, "kind": kind, "doc": doc["kind"], "name": doc["name"]})
    return out


def _summary(changes: list[dict], first: bool, restored: Optional[int]) -> dict:
    """{what, name?, n?, restored?} — the words are the page's (translated there)."""
    if restored:
        return {"what": "restored", "restored": restored}
    if first:
        return {"what": "created"}
    page = any(c["doc"] == "page" for c in changes)
    sources = [c for c in changes if c["doc"] == "source"]
    filters = any(c["doc"] == "filters" for c in changes)
    title = any(c["doc"] == "title" for c in changes)
    look = any(c["doc"] == "look" for c in changes)
    drafts = [c for c in changes if c["doc"] == "draft"]
    things = []
    if page:
        things.append({"t": "page"})
    if len(sources) == 1:
        things.append({"t": "source", "name": sources[0]["name"], "kind": sources[0]["kind"]})
    elif sources:
        things.append({"t": "sources", "n": len(sources)})
    if filters:
        things.append({"t": "filters"})
    if title:
        things.append({"t": "title"})
    if look:
        things.append({"t": "look"})
    if drafts and not things:
        things.append({"t": "draft", "kind": drafts[0]["kind"]})
    if not things:
        files = [c for c in changes if c["doc"] == "file"]
        if files:
            things.append({"t": "files", "n": len(files), "name": files[0]["name"] if len(files) == 1 else None})
    return {"what": "edited", "things": things}


def versions(aid: str) -> list[dict]:
    """Newest first: {n, at, by, summary, current}."""
    m = store.get_meta(aid)
    if not m:
        raise FileNotFoundError(aid)
    kind = m.get("type", "page")
    vs = m["versions"]
    base = store._dir(aid)
    out, prev = [], None
    for v in vs:
        try:
            docs = _docs(_files(base / f"v{v['n']}"), kind)
        except FileNotFoundError:
            continue
        ch = _changes(prev, docs)
        out.append({"n": v["n"], "at": v.get("published"), "by": v.get("by", "hermes"),
                    "summary": _summary(ch, prev is None, v.get("restored")), "changes": len(ch)})
        prev = docs
    latest = vs[-1]["n"] if vs else None
    for o in out:
        o["current"] = o["n"] == latest
    return list(reversed(out))[:100]


def diff(aid: str, n: int) -> dict:
    """The changes version ``n`` made over the one before it, each line by line (or "too much")."""
    m = store.get_meta(aid)
    if not m:
        raise FileNotFoundError(aid)
    kind = m.get("type", "page")
    ns = [v["n"] for v in m["versions"]]
    if n not in ns:
        raise FileNotFoundError(f"v{n}")
    i = ns.index(n)
    base = store._dir(aid)
    now = _docs(_files(base / f"v{n}"), kind)
    before = _docs(_files(base / f"v{ns[i - 1]}"), kind) if i > 0 else None
    out = []
    for c in _changes(before, now):
        a = (before or {}).get(c["key"], {}).get("text")
        b = now.get(c["key"], {}).get("text")
        lines = None
        if (a is not None or c["kind"] == "added") and (b is not None or c["kind"] == "removed"):
            d = list(difflib.unified_diff((a or "").splitlines(), (b or "").splitlines(), lineterm="", n=2))[2:]
            lines = d if len(d) <= MAX_DIFF_LINES else None
        added = sum(1 for x in (lines or []) if x.startswith("+"))
        removed = sum(1 for x in (lines or []) if x.startswith("-"))
        out.append({**c, "lines": lines, "added": added, "removed": removed})
    return {"n": n, "before": ns[i - 1] if i > 0 else None, "changes": out}


def restore(aid: str, n: int) -> dict:
    """A new version holding version ``n``'s files (Claude's Restore; Undo is restoring the one before)."""
    vdir = store.version_dir(aid, n)
    nm = store.publish(aid=aid, path=str(vdir), by="user", restored=n)
    return {"ok": True, "version": nm["versions"][-1]["n"], "restored": n}
