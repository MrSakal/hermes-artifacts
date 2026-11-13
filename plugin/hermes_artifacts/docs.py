"""Live docs: a document of tabs and blocks that the user and Hermes edit together, block by block.

Kept on the Hermes server: a doc holds tabs; a tab holds blocks; a block
is one paragraph-level piece of Markdown (a heading, a paragraph, a list, a table, a quote, a code
block, a rule, an image) with a stable id. Every change bumps the tab's ``rev`` and is logged, so a
reader can ask for what changed since the rev it last saw, and an edit made against an older rev of a
block someone changed meanwhile is refused instead of overwriting it.

State lives in ``<artifact>/doc/state.json``, outside the artifact's versions (a doc changes keystroke
by keystroke). Publishing a new version of the artifact (doc.md) starts the doc again from that text.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import math
import re
import os
import secrets
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from . import store

logger = logging.getLogger(__name__)
_LOCK = threading.RLock()
MAX_BLOCK_CHARS = 20_000
MAX_BLOCKS = 4000
MAX_LOG = 400
_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
# A section still to write: `<!-- pending: what comes here -->` on its own line. The viewer shows the
# intent in place (and Hermes' cursor at the first one while it works); exports and reads of the doc's
# text leave it out, and other Markdown viewers hide it as a comment.
PENDING = re.compile(r"^<!--\s*pending:\s*(.*?)\s*-->$", re.S)
ACTIVE_SECS = 300  # Hermes counts as at work in a doc this long after its last change there


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


def pending_intent(md: str) -> Optional[str]:
    m = PENDING.match(str(md or "").strip())
    return m.group(1) if m else None


def block_kind(md: str) -> str:
    s = md.lstrip()
    if PENDING.match(s.strip()):
        return "pending"
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
    """The tab's text as a reader gets it: sections still to write are left out."""
    return "\n\n".join(b["md"] for b in tab["blocks"] if not pending_intent(b["md"])) + "\n"


# ----------------------------------------------------------------------------- state

def _state_path(aid: str) -> Path:
    return store._dir(aid) / "doc" / "state.json"


def _fresh(aid: str, meta: dict) -> dict:
    """A doc started from the latest published version: doc.md becomes the first tab, or doc.json
    (``{"tabs": [{"title", "markdown"}]}``) gives several."""
    tabs, selects, settings = [], {}, {}
    try:
        spec = json.loads(store.read_file(aid, "doc.json").decode("utf-8"))
        selects = _clean_selects(spec.get("selects"))
        settings = _clean_settings(spec.get("settings"))
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
        tabs = [{"id": _new_id("t"), "title": meta.get("title", "Doc")[:120], "blocks": _some(blocks_from_markdown(md)), "rev": 1}]
    return {"version": meta["versions"][-1]["n"], "tabs": tabs, "log": [], "edits": 0, "updated": time.time(),
            "hermes_at": time.time(),  # Hermes just published it
            "selects": selects, "settings": settings, "suggestions": [],
            "last": {}, "last_from": {t["id"]: t["rev"] for t in tabs}}


# ----------------------------------------------------------------------------- the doc's own settings
SETTINGS = {"head": ("serif", "sans"), "body": ("serif", "sans"), "wide": (True, False)}


def _clean_settings(v) -> dict:
    out = {}
    for k, ok in SETTINGS.items():
        if isinstance(v, dict) and v.get(k) in ok:
            out[k] = v[k]
    return out


def _clean_selects(v) -> dict:
    """Dropdown option lists by name: {"Status": ["Not started", "In progress", "Done"]}."""
    out = {}
    for name, opts in (v.items() if isinstance(v, dict) else []):
        name = str(name).strip()[:60]
        if name and isinstance(opts, list):
            seen = []
            for o in opts[:30]:
                o = str(o).strip()[:80]
                if o and o not in seen and "}" not in o and "{" not in o:
                    seen.append(o)
            out[name] = seen
    return dict(list(out.items())[:40])


def _some(blocks: list) -> list:
    """A tab always holds a block (an empty one to type into)."""
    return blocks or [{"id": _new_id(), "md": ""}]


_STATES: dict = {}  # state.json path -> ((mtime_ns, size, inode), state): the doc page polls every few seconds;
# at most store.STATES_KEPT, the least recently used dropped first


def _state_put(p: Path, stamp: tuple, st: dict) -> None:
    store._cache_put(_STATES, store.STATES_KEPT, p, stamp, st)


def load(aid: str) -> dict:
    """The doc's state, parsed again only when state.json changed (another process's write included: every
    write replaces the file). The same dict is handed to every caller in this process: a reader only looks
    (under _LOCK when it walks it); a writer changes it under _writing, which saves it or, on any error,
    drops it so the next load reads the file again (an edit that fails changes nothing)."""
    meta = store.peek_meta(aid)
    if not meta or meta.get("type") != "doc":
        raise DocError("absent", "not a doc")
    with _LOCK:
        p = _state_path(aid)
        try:
            s = os.stat(p)
        except FileNotFoundError:
            s = None
        st = None
        if s is not None:
            stamp = (s.st_mtime_ns, s.st_size, s.st_ino)
            hit = _STATES.get(p)
            st = hit[1] if hit and hit[0] == stamp else store.load_state(p)
            if st is not None:
                _state_put(p, stamp, st)  # (a hit too: the most recently used goes last)
        if st is None or st.get("version") != meta["versions"][-1]["n"]:
            st = _fresh(aid, meta)
            _save(aid, st)
        for k in ("parts", "parts_done"):  # left by a test build that kept batches in parts: not used, dropped
            st.pop(k, None)
        return st


@contextmanager
def _writing(aid: str):
    """The lock for a change of the doc's state: on any error the state in memory (perhaps half changed) is
    dropped, and the next load reads the file again."""
    with _LOCK:
        try:
            yield
        except BaseException:
            _STATES.pop(_state_path(aid), None)
            raise


def _save(aid: str, st: dict) -> None:
    p = _state_path(aid)
    p.parent.mkdir(parents=True, exist_ok=True)
    st["updated"] = time.time()
    s = store.write_atomic(p, json.dumps(st, ensure_ascii=False), backup=True)
    _state_put(p, (s.st_mtime_ns, s.st_size, s.st_ino), st)


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


def left(st: dict) -> int:
    """Whole seconds until Hermes' last change here leaves its window (0: not now)."""
    return max(0, math.ceil(ACTIVE_SECS - (time.time() - st.get("hermes_at", 0))))


def ago(st: dict) -> float:
    """Seconds since Hermes last changed it (publishing included): the page tells from it whether that change
    came in the run now in flight (kit.hermesWork), so its "Hermes is working" ends with the run."""
    return round(max(0.0, time.time() - st.get("hermes_at", 0)), 1)


def read(aid: str, tab: Optional[str] = None, *, since_rev: Optional[int] = None, search: Optional[str] = None,
         blocks: Optional[list[str]] = None) -> dict:
    """A tab's blocks (id, kind, md), or what changed since ``since_rev``, or the blocks whose text holds
    ``search``, or just the named ``blocks``."""
    with _LOCK:  # the state is shared (load): read it whole while no edit changes it
        return _read(aid, load(aid), tab, since_rev, search, blocks)


def _wanted(t: dict, blocks: list) -> set:
    """The ids ``blocks`` names: ids, and runs "<first id>..<last id>" (an outline's part) with every block
    between them."""
    want, at = set(), None
    for x in blocks:
        x = str(x)
        if ".." not in x:
            want.add(x)
            continue
        if at is None:
            at = {b["id"]: i for i, b in enumerate(t["blocks"])}
        a, _, z = x.partition("..")
        gone = next((y for y in (a, z) if y not in at), None)
        if gone is not None:
            raise DocError("absent", f"no block {gone!r} in this tab: the doc changed, read it again for its outline")
        i, j = sorted((at[a], at[z]))
        want.update(b["id"] for b in t["blocks"][i:j + 1])
    return want


# A read that hands the agent a long doc whole (a 600-paragraph doc: 220 KB, some 55k tokens) gives an outline
# instead: the tab cut into parts of about PART_CHARS characters, each naming its first and last block as the
# blocks= value that reads it, how many blocks it holds, how it starts and its headings.
READ_MAX = 30_000  # characters of block text (as JSON) a whole read hands over; above it, an outline
PART_CHARS = 6_000
OUTLINE_PARTS = 40  # at most this many parts (longer docs: longer parts)
OUTLINE_NOTE = "Long doc: an outline. Read a part with blocks=[its blocks] (block ids work too); search= finds text."
READ_OUTLINE_NOTE = ("Long doc: an outline per tab. ha_live_read id={id} tab=<tab> blocks=[a part's blocks] reads a part "
                     "(block ids work too); search= finds text.")


def _snippet(md: str, n: int) -> str:
    s = " ".join(str(md).split())
    return s if len(s) <= n else s[:n - 1] + "…"


def too_long(blocks: list) -> bool:
    return sum(len(b["md"]) + len(b["id"]) + 30 for b in blocks) > READ_MAX


def parts(blocks: list) -> list:
    """The outline of a tab's blocks ({id, md}[, kind]): [{blocks: "<first>..<last>", n, starts, heads?}]."""
    total = sum(len(b["md"]) for b in blocks)
    size = max(PART_CHARS, total // OUTLINE_PARTS + 1)
    runs, cur, n = [], [], 0
    for b in blocks:
        if cur and n + len(b["md"]) > size:
            runs.append(cur)
            cur, n = [], 0
        cur.append(b)
        n += len(b["md"])
    if cur:
        runs.append(cur)
    out = []
    for r in runs:
        p = {"blocks": f'{r[0]["id"]}..{r[-1]["id"]}', "n": len(r), "starts": _snippet(r[0]["md"], 80)}
        heads = [_snippet(b["md"], 60) for b in r if (b.get("kind") or _kind(b["md"])).startswith("h")]
        if heads:
            p["heads"] = heads[:5] + ([f"+{len(heads) - 5} more"] if len(heads) > 5 else [])
        out.append(p)
    return out


def outlines(aid: str) -> list:
    """Every tab's outline: [{tab, title, rev, parts}] (ha_read of a long doc)."""
    with _LOCK:
        st = load(aid)
        tabs = [(t["id"], t["title"], t["rev"], [{"id": b["id"], "md": b["md"]} for b in t["blocks"]]) for t in st["tabs"]]
    return [{"tab": i, "title": title, "rev": rev, "parts": parts(bs)} for i, title, rev, bs in tabs]


def _kind(md: str) -> str:
    """block_kind, remembered for short blocks (a poll of a long doc asks for the same few hundred)."""
    if len(md) > 400:
        return block_kind(md)
    k = _KINDS.get(md)
    if k is None:
        if len(_KINDS) >= 20000:
            _KINDS.clear()
        k = _KINDS[md] = block_kind(md)
    return k


_KINDS: dict = {}


def _read(aid: str, st: dict, tab, since_rev, search, blocks) -> dict:
    t = _tab(st, tab)
    out = {"tab": t["id"], "title": t["title"], "rev": t["rev"], "tabs": overview(st), "edits": st.get("edits", 0),
           "hermes_active": time.time() - st.get("hermes_at", 0) < ACTIVE_SECS, "hermes_left": left(st),
           "hermes_ago": ago(st)}
    if st.get("selects"):
        out["selects"] = dict(st["selects"])
    if st.get("settings"):
        out["settings"] = dict(st["settings"])
    sug = [dict(s) for s in st.get("suggestions", []) if s["tab"] == t["id"]]
    if sug:
        out["suggestions"] = sug
    done = {d["cid"]: d["result"].get("per_op", []) for d in st.get("done", []) if d["tab"] == t["id"]}
    if done:  # the latest edits applied under a client id: the doc page settles one whose answer it lost
        out["done"] = dict(list(done.items())[-DONE_IN_READ:])

    def view(bs):
        return [{"id": b["id"], "kind": _kind(b["md"]), "md": b["md"]} for b in bs]
    if since_rev is not None:
        # The log keeps the last entries only: older than that, the whole tab comes back (Claude's
        # since: "unavailable"), never a delta that silently misses changes.
        revs = sorted(e["rev"] for e in st["log"] if e["tab"] == t["id"])
        if int(since_rev) < t["rev"] and (not revs or revs[0] > int(since_rev) + 1):
            out["since"] = "unavailable"
            out["blocks"] = view(t["blocks"])
            return out
        changed = {}
        for e in st["log"]:
            if e["tab"] == t["id"] and e["rev"] > since_rev:
                for bid in e.get("blocks", []):
                    changed[bid] = e["by"]
        ids = {b["id"] for b in t["blocks"]}
        out["changed"] = [dict(v, by=changed[v["id"]]) for v in view(b for b in t["blocks"] if b["id"] in changed)]
        out["removed"] = [bid for bid in changed if bid not in ids]
        return out
    if blocks:
        want = _wanted(t, blocks)
        out["blocks"] = view(b for b in t["blocks"] if b["id"] in want)
        return out
    if search:
        q = search.lower()
        out["blocks"] = view(b for b in t["blocks"] if q in b["md"].lower())
        return out
    out["blocks"] = view(t["blocks"])
    return out


# ----------------------------------------------------------------------------- edits

CONFLICT_BLOCKS = 20  # blocks a conflict hands back
CONFLICT_BLOCK_CHARS = 2000  # of each block's text


def _conflict(aid: str, t: dict, ids: list[str], base: int) -> DocError:
    """Hermes' edit met the user's: the blocks as they are now ({id, kind, md}; a removed one {id, deleted})."""
    have = {b["id"]: b for b in t["blocks"]}
    current = None
    if len(ids) <= CONFLICT_BLOCKS:
        current = []
        for bid in ids:
            b = have.get(bid)
            if b is None:
                current.append({"id": bid, "deleted": True})
                continue
            md = b["md"]
            if len(md) > CONFLICT_BLOCK_CHARS:
                md = md[:CONFLICT_BLOCK_CHARS] + "…(cut: ha_live_read blocks=[its id])"
            current.append({"id": bid, "kind": block_kind(b["md"]), "md": md})
    return store.conflict(DocError, "blocks", ids, base, t["rev"], current,
                          f"ha_live_read id={aid} tab=<tab> blocks=<ids>", tab=t["id"])


MAX_DONE = 200  # edits remembered by their client id (cid), so one sent again is applied once
DONE_IN_READ = 30  # the latest of them a read hands back (cid -> per_op): a page learns an edit landed


def _cid(ops: list) -> Optional[str]:
    """The client's id for an edit (on any of its ops; the doc page puts it on the first)."""
    for o in ops:
        c = o.get("cid") if isinstance(o, dict) else None
        if isinstance(c, str) and c.strip():
            return c.strip()[:80]
    return None


def _done(st: dict, cid: Optional[str], by: str) -> Optional[dict]:
    """The first answer to an edit already applied under this cid (None: not applied yet). Refused
    edits are not remembered: nothing of them was applied, so they are simply tried again."""
    if not cid:
        return None
    for d in reversed(st.get("done", [])):
        if d["cid"] == cid and d["by"] == by:
            return dict(d["result"])
    return None


def _remember(st: dict, cid: Optional[str], by: str, tab: str, result: dict) -> None:
    """Kept in the doc's state (saved with the edit itself, so a restart remembers), the last MAX_DONE."""
    if cid:
        st["done"] = (st.get("done", []) + [{"cid": cid, "by": by, "tab": tab, "result": dict(result)}])[-MAX_DONE:]


SEQ_PAGES = 50  # pages whose edit order is kept (the latest used)
SEQ_BLOCKS = 2000  # blocks per page


def _seq(cid: Optional[str]) -> Optional[tuple]:
    """A doc page's cid is "<page>.<n>[.<tag>]": n counts that page's edits in the order they were made (an
    edit mended or split up after a refusal or a conflict keeps its n). -> (page, n), or None."""
    parts = (cid or "").split(".")
    if len(parts) < 2 or not parts[0]:
        return None
    try:
        return parts[0], int(parts[1])
    except ValueError:
        return None


def _superseded(st: dict, cid: Optional[str], by: str, block) -> bool:
    """A text op on a block from a page that has already applied a LATER edit (a higher n) to that block:
    it arrived late (sent twice, or overtaken), so applying it would put older words over newer ones from the
    same page. Never so across pages (another page, or this doc opened again, has its own count), nor for the
    same n again (an edit mended or split up), nor for a newer n with older words (an undo is a new edit)."""
    s = _seq(cid)
    if not s or not block:
        return False
    rec = st.get("seq", {}).get(f"{by}:{s[0]}")
    return bool(rec) and rec["b"].get(str(block), -1) > s[1]


def _seq_note(st: dict, cid: Optional[str], by: str, blocks: list) -> None:
    """The highest n each page applied per block: kept in the doc's state, SEQ_PAGES pages x SEQ_BLOCKS blocks."""
    s = _seq(cid)
    if not s or not blocks:
        return
    seqs = st.setdefault("seq", {})
    rec = seqs.setdefault(f"{by}:{s[0]}", {"at": 0, "b": {}})
    rec["at"] = time.time()
    for b in blocks:
        if b:
            rec["b"][str(b)] = max(rec["b"].get(str(b), -1), s[1])
    if len(rec["b"]) > SEQ_BLOCKS:
        rec["b"] = dict(sorted(rec["b"].items(), key=lambda kv: kv[1])[-SEQ_BLOCKS:])
    if len(seqs) > SEQ_PAGES:
        for k in sorted(seqs, key=lambda k: seqs[k]["at"])[:len(seqs) - SEQ_PAGES]:
            del seqs[k]


MAX_BATCH = 2000  # entries in one batch
MAX_BATCH_CHARS = 2_000_000  # characters of its entries as JSON (the page cuts its outbox to fit both)


def _batch_run(aid: str, entries: list, by: str, tab: Optional[str], made: dict, failed: set) -> list:
    """Entries applied in order, each as its own call would be, on its own tab (an entry's "tab", else the
    call's). made (tmp id -> block) and failed (ids of failed entries) carry over from the entries before."""
    out: list = []

    def named(ops):
        return {str(o[k]) for o in ops for k in ("block", "after") if o.get(k)}

    def own(ops):
        return {str(o[k]) for o in ops for k in ("block", "tmp") if o.get(k)}

    for e in entries:
        ops = e.get("ops") if isinstance(e, dict) else None
        if not isinstance(ops, list) or not ops or not all(isinstance(o, dict) for o in ops):
            out.append({"ok": False, "refused": "invalid", "message": "an entry needs ops"})
            continue
        ids = named(ops) | {made.get(x, x) for x in named(ops)}
        if ids & failed:
            failed |= own(ops) | {made.get(x, x) for x in own(ops)}
            out.append({"ok": False, "held": True})
            continue
        sent = []
        for i, o in enumerate(ops):
            x = {k: v for k, v in o.items() if k not in ("tmp", "cid")}
            for k in ("block", "after"):
                if x.get(k) in made:
                    x[k] = made[x[k]]
            if i == 0 and e.get("cid"):
                x["cid"] = str(e["cid"])
            sent.append(x)
        etab = e.get("tab") or tab
        try:
            if e.get("via") == "suggest":
                r = suggest(aid, sent, by=by, tab=etab)
            else:
                r = apply(aid, sent, by=by, tab=etab, base_rev=e.get("base"))
        except DocError as x:
            failed |= own(ops) | {made.get(y, y) for y in own(ops)}
            out.append({"ok": False, "conflict": True, **x.extra} if x.code == "conflict"
                       else {"ok": False, "refused": x.code, "message": x.message})
            continue
        per = r.get("per_op") or []
        for i, o in enumerate(ops):
            if o.get("op") == "insert" and o.get("tmp") and i < len(per) and per[i]:
                made[str(o["tmp"])] = per[i][0]
        out.append(r)
    return out


def apply_batch(aid: str, entries: list, *, by: str, tab: Optional[str] = None) -> dict:
    """The doc page's outbox sent as one call (the page is going away, or hidden): entries [{cid, via: "edit" |
    "suggest", ops, base, tab}] applied strictly in that order under the doc's lock, each on its own tab and
    exactly as its own call would be (the same conflict rules, a cid already applied answered from its record
    and not applied again). A tmp id an earlier entry's insert made (its op's "tmp") names that new block in
    the later ones. An entry refused or in conflict does not stop the others, except those that depend on it:
    an entry that names (as its block or its anchor) a block a failed entry changed or a tmp id it would have
    made is not applied either, answered {"ok": false, "held": true}, and its own blocks and tmp ids count as
    failed for the entries after it. The page keeps a held entry and sends it again, in its place, after it has
    dealt with the one it depends on, so no one's words are lost. -> {"ok": true, "batch": [answer per entry]}
    More than MAX_BATCH entries or MAX_BATCH_CHARS is refused whole, before anything is applied (the page
    sends its oldest stretch that fits; nothing is stored here for later)."""
    if not isinstance(entries, list) or not entries:
        raise DocError("invalid", "a batch is a non-empty list of entries")
    if len(entries) > MAX_BATCH:
        raise DocError("too_large", f"a batch is at most {MAX_BATCH} entries")
    if len(json.dumps(entries, ensure_ascii=False)) > MAX_BATCH_CHARS:
        raise DocError("too_large", f"a batch is at most {MAX_BATCH_CHARS} characters")
    with _LOCK:
        return {"ok": True, "batch": _batch_run(aid, entries, by, tab, {}, set())}


LAST_KEEP = 20000  # blocks whose last text change is kept beyond the log's reach


def _last(st: dict, t: dict) -> tuple:
    """Each block's last text change ({id: [rev, by, tab]}, kept beyond the log, so an edit against a rev the
    log no longer reaches is still checked block by block), and the tab's rev when that record began:
    before it, nothing is known."""
    since = st.setdefault("last_from", {}).setdefault(t["id"], t["rev"])
    return st.setdefault("last", {}), since


def _note(st: dict, last: dict, ids: list, rev: int, by: str, tab: str) -> None:
    for b in ids:
        last[b] = [rev, by, tab]
    if len(last) > LAST_KEEP:  # the oldest go; what they said is then unknown: their tab's record begins later
        for b, v in sorted(last.items(), key=lambda kv: kv[1][0])[:len(last) - LAST_KEEP]:
            del last[b]
            frm = st.setdefault("last_from", {})
            frm[v[2]] = max(frm.get(v[2], 0), v[0])


def apply(aid: str, ops: list[dict], *, by: str, tab: Optional[str] = None, base_rev: Optional[int] = None) -> dict:
    """Apply edits to one tab, atomically. Ops:
      {"op": "replace", "block": id, "md": "…"}           change a block (or split it: md with blank lines)
      {"op": "insert", "after": id | null, "md": "…"}      new block(s) after a block (null = at the top)
      {"op": "delete", "block": id}
      {"op": "move", "block": id, "after": id | null}
      {"op": "add_tab", "title": "…", "md": "…"} / {"op": "rename_tab", "title": "…"} / {"op": "delete_tab"}
    With ``base_rev``: a block someone else changed after that rev is not overwritten (code "conflict").
    All or nothing: an op that fails leaves the doc as it was. An op may carry ``cid`` (the client's id for
    this edit, the same when it sends the edit again): an edit already applied under that cid is not
    applied again, its first answer comes back (with ``repeat``). The answer's ``per_op`` lists, per op,
    the blocks it changed (an insert: the new ones)."""
    if not isinstance(ops, list) or not ops or not all(isinstance(o, dict) for o in ops):
        raise DocError("invalid", "ops must be a non-empty list of objects")
    if by not in ("user", "hermes"):
        raise DocError("invalid", "bad author")
    cid = _cid(ops)
    with _writing(aid):
        st = load(aid)
        seen = _done(st, cid, by)
        if seen is not None:
            return dict(seen, repeat=True)
        t = _tab(st, tab)
        before = _snap(t, "start")
        # Filling a section still to write needs no guard: nobody else writes into a pending block (typing
        # into it makes it an ordinary block, and then the guard applies).
        def guarded(o):
            if o.get("op") == "delete":
                return True
            if o.get("op") != "replace":
                return False
            try:
                return not pending_intent(t["blocks"][_index(t, str(o.get("block")))]["md"])
            except DocError:
                return False  # gone: the op itself says so
        if by == "hermes" and base_rev is None and any(guarded(o) for o in ops):
            raise DocError("missing_guard", "replace and delete need base_rev: the rev you read (ha_live_read)",
                           rev=t["rev"])
        # A text op older than one the same page already applied to that block (it arrived late) is skipped:
        # never older words over newer ones from the same page (see _seq).
        skip = {i for i, o in enumerate(ops) if o.get("op") in ("replace", "delete") and _superseded(st, cid, by, o.get("block"))}
        if skip and len(skip) == len(ops):
            out = {"ok": True, "tab": t["id"], "rev": t["rev"], "changed": [], "new_tab": None,
                   "per_op": [[] for _ in ops], "superseded": True}
            _remember(st, cid, by, t["id"], out)
            _save(aid, st)
            return dict(out)
        last, since = _last(st, t)
        if base_rev is not None:
            base = int(base_rev)
            # Only a change of a block's text (replace, delete) overwrites someone's words: a move does not,
            # and a block someone else only moved meanwhile is no conflict either.
            touched = {o.get("block") for i, o in enumerate(ops) if o.get("op") in ("replace", "delete") and o.get("block") and i not in skip}
            hits = set()
            revs = [e["rev"] for e in st["log"] if e["tab"] == t["id"]]
            if base < t["rev"] and (not revs or min(revs) > base + 1):
                # The log keeps the last entries only. Beyond it, each block's last text change (kept for
                # good) says; a block with none since that record began was not changed, and before it
                # nothing is known, so it counts as changed (never overwritten unseen).
                hits |= {b for b in touched if (b in last and last[b][0] > base and last[b][1] != by)
                         or (b not in last and base < since)}
            else:
                for e in st["log"]:
                    if e["tab"] == t["id"] and e["rev"] > base and e["by"] != by:
                        hits |= touched & (set(e.get("blocks", [])) - set(e.get("moved", [])))
            if hits:
                if by == "hermes":
                    raise _conflict(aid, t, sorted(hits), int(base_rev))
                raise DocError("conflict", "a block you changed was changed meanwhile: read it again",
                               rev=t["rev"], blocks=sorted(hits))
        changed: list[str] = []
        moved: list[str] = []  # blocks whose place changed (not their words)
        starts: list[int] = []  # where each op's blocks begin in changed
        new_tab = None
        for i_op, o in enumerate(ops):
            starts.append(len(changed))
            if i_op in skip:
                continue
            kind = o.get("op")
            if kind == "replace":
                try:
                    i = _index(t, str(o.get("block")))
                except DocError:
                    raise DocError("absent", f"no block {o.get('block')!r} in this tab: the user may have removed it "
                                             "(a removed pending section is not wanted: leave it out)")
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
                if len(t["blocks"]) == 1:
                    raise DocError("last_block", "a tab keeps at least one block: replace it instead")
                changed.append(t["blocks"].pop(i)["id"])
            elif kind == "move":
                i = _index(t, str(o.get("block")))
                b = t["blocks"].pop(i)
                after = o.get("after")
                at = 0 if after in (None, "") else _index(t, str(after)) + 1
                t["blocks"].insert(at, b)
                changed.append(b["id"])
                moved.append(b["id"])
            elif kind == "add_tab":
                new_tab = {"id": _new_id("t"), "title": str(o.get("title") or "Tab")[:120],
                           "blocks": _some(blocks_from_markdown(o.get("md") or "")), "rev": 1}
                st["tabs"].append(new_tab)
            elif kind == "settings":
                st["settings"] = {**st.get("settings", {}), **_clean_settings(o.get("set"))}
                changed.append("settings")
            elif kind == "set_select":
                sel = _clean_selects({o.get("name"): o.get("options")})
                if not sel:
                    raise DocError("invalid", "set_select needs a name and a list of options")
                st.setdefault("selects", {}).update(sel)
                changed.append("selects")
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
        if by == "hermes":
            st["hermes_at"] = time.time()
        entry = {"tab": t["id"], "rev": t["rev"], "by": by, "blocks": changed, "at": time.time()}
        text = [c for c in dict.fromkeys(changed) if c not in ("settings", "selects", "tab")
                and changed.count(c) > moved.count(c)]  # blocks whose words this edit wrote (or removed)
        only_moved = sorted(set(moved) - set(text))
        if only_moved:
            entry["moved"] = only_moved
        st["log"].append(entry)
        st["log"] = st["log"][-MAX_LOG:]
        _note(st, last, text, t["rev"], by, t["id"])
        per_op = [changed[a:b] for a, b in zip(starts, starts[1:] + [len(changed)])]
        out = {"ok": True, "tab": t["id"], "rev": t["rev"], "changed": changed,
               "new_tab": new_tab["id"] if new_tab else None, "per_op": per_op}
        _remember(st, cid, by, t["id"], out)
        _seq_note(st, cid, by, [o.get("block") for i, o in enumerate(ops) if o.get("op") in ("replace", "delete") and i not in skip])
        _save(aid, st)
        if any(x["id"] == t["id"] for x in st["tabs"]):  # a deleted tab keeps no history
            _record(aid, st, t, by, before)
        out = dict(out)
        left = pending(t)
        if left:
            out["pending"] = left  # sections still to write, in reading order
        return out


def pending(t: dict) -> list[dict]:
    """A tab's sections still to write: [{block, intent}]."""
    return [{"block": b["id"], "intent": i} for b in t["blocks"] if (i := pending_intent(b["md"]))]


def outline(aid: str) -> dict:
    """What a just-published doc hands Hermes: each tab's id, rev and pending sections."""
    tabs = []
    with _LOCK:
        for t in load(aid)["tabs"]:
            tab, left = {"id": t["id"], "title": t["title"], "rev": t["rev"]}, pending(t)
            if left:
                tab["pending"] = left
            tabs.append(tab)
    return {"tabs": tabs}


# ----------------------------------------------------------------------------- suggestions
# A change proposed, not made: {id, tab, kind: replace | insert | delete, block (insert: the block it
# follows, null = the top), md, by, at}. Accepting applies it as an edit by the person; rejecting drops it.
MAX_SUGGESTIONS = 300


def suggest(aid: str, ops: list[dict], *, by: str, tab: Optional[str] = None) -> dict:
    if not isinstance(ops, list) or not ops or not all(isinstance(o, dict) for o in ops):
        raise DocError("invalid", "ops must be a non-empty list of objects")
    cid = _cid(ops)  # as in apply: a proposal sent again is made once
    with _writing(aid):
        st = load(aid)
        seen = _done(st, cid, by)
        if seen is not None:
            return dict(seen, repeat=True)
        t = _tab(st, tab)
        sugs = st.setdefault("suggestions", [])
        made = []
        for o in ops:
            kind = o.get("op")
            if kind not in ("replace", "insert", "delete"):
                raise DocError("invalid", "a suggestion is a replace, an insert or a delete")
            block = o.get("after") if kind == "insert" else o.get("block")
            if block not in (None, ""):
                _index(t, str(block))
            elif kind != "insert":
                raise DocError("invalid", f"{kind} needs a block")
            md = str(o.get("md", ""))[:MAX_BLOCK_CHARS * 10]
            # One open proposal per block and author: typing on in Suggesting mode updates it.
            same = next((s for s in sugs if s["tab"] == t["id"] and s["by"] == by and s["kind"] == kind
                         and s["block"] == block and kind != "insert"), None)
            if same:
                same.update(md=md, at=time.time())
                made.append(same["id"])
                continue
            s = {"id": _new_id("sg"), "tab": t["id"], "kind": kind, "block": block, "md": md, "by": by, "at": time.time()}
            if kind == "replace":
                s["was"] = t["blocks"][_index(t, str(block))]["md"]
            sugs.append(s)
            made.append(s["id"])
        st["suggestions"] = sugs[-MAX_SUGGESTIONS:]
        t["rev"] += 1
        st["log"].append({"tab": t["id"], "rev": t["rev"], "by": by, "blocks": ["suggestions"], "at": time.time()})
        st["log"] = st["log"][-MAX_LOG:]
        if by == "hermes":
            st["hermes_at"] = time.time()
        out = {"ok": True, "tab": t["id"], "rev": t["rev"], "suggestions": made}
        _remember(st, cid, by, t["id"], out)
        _save(aid, st)
        return out


def decide(aid: str, sid: str, verdict: str) -> dict:
    """The person accepts or rejects a suggestion (Hermes never decides)."""
    if verdict not in ("accept", "reject"):
        raise DocError("invalid", "verdict is accept or reject")
    with _writing(aid):
        st = load(aid)
        s = next((x for x in st.get("suggestions", []) if x["id"] == sid), None)
        if not s:
            raise DocError("absent", "no such open suggestion")
        st["suggestions"] = [x for x in st["suggestions"] if x["id"] != sid]
        _save(aid, st)
    if verdict == "reject":
        t = _tab(load(aid), s["tab"])
        return {"ok": True, "tab": t["id"], "rev": t["rev"], "rejected": sid}
    op = {"op": s["kind"], "block": s["block"], "md": s["md"]} if s["kind"] != "insert" else {"op": "insert", "after": s["block"], "md": s["md"]}
    try:
        r = apply(aid, [op], by="user", tab=s["tab"])
    except DocError as e:
        raise DocError(e.code, "the suggestion no longer fits the doc: " + e.message)
    r["accepted"] = sid
    return r


# ----------------------------------------------------------------------------- pictures in the doc
MAX_UPLOAD = 8 * 1024 * 1024
_IMG = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}


def upload(aid: str, data_url: str) -> dict:
    """A picture the person put in the doc: kept beside it, referenced as `doc:<name>`."""
    load(aid)
    m = re.match(r"^data:(image/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$", str(data_url or ""))
    if not m:
        raise DocError("invalid", "a picture (png, jpeg, gif or webp) as a data URL")
    raw = base64.b64decode(m.group(2))
    if len(raw) > MAX_UPLOAD:
        raise DocError("too_large", "pictures are up to 8 MB")
    digest = hashlib.sha256(raw).hexdigest()
    name = digest[:20] + "." + _IMG[m.group(1)]
    p = store._dir(aid) / "doc" / "files" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        same = p.stat().st_size == len(raw) and hashlib.sha256(p.read_bytes()).hexdigest() == digest
    except OSError:
        same = False
    if same:
        try:
            os.utime(p)  # in use again from now: the sweep counts its age from here
        except OSError:
            same = False
    if not same:  # (missing, or a cut-off copy: written whole again)
        store.write_atomic(p, raw)
    return {"ok": True, "name": name, "src": "doc:" + name}


def file_data(aid: str, name: str) -> dict:
    if not re.match(r"^[0-9a-f]{20}\.(png|jpg|gif|webp)$", str(name or "")):
        raise DocError("invalid", "bad file name")
    p = store._dir(aid) / "doc" / "files" / name
    if not p.is_file():
        raise DocError("absent", "no such picture")
    mime = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}[name.rsplit(".", 1)[1]]
    return {"name": name, "url": f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode("ascii")}


# ----------------------------------------------------------------------------- history
# Snapshots of a tab, for the page's version history (list, look at one, restore one). Each snapshot's blocks
# are a file of their own (doc/snaps/<n>.json); doc/hist.json indexes them ({version, seq, snaps: [{tab, rev,
# by, at, title, n: blocks, f: file number, bytes}]}). An edit writes one snapshot and the small index, never
# the whole history again (a long doc's history of full copies was rewritten on every keystroke save).
# Bounded by count and by bytes: the oldest go first, the newest two always stay. The index is written after
# the snapshot it names and files are removed only after the index no longer names them, so every snapshot
# the index lists can be read. doc/history.json (every snapshot in one file, before 0.19.1) is moved over on
# first use, newest first within the bounds.
MAX_SNAPS = 120
MAX_HIST_BYTES = 12_000_000  # the snapshot files of one doc together
SNAP_GAP = 120  # seconds: edits by the same author closer than this share one snapshot


def _hist_path(aid: str) -> Path:
    return store._dir(aid) / "doc" / "hist.json"


def _old_hist_path(aid: str) -> Path:
    return store._dir(aid) / "doc" / "history.json"


def _snaps_dir(aid: str) -> Path:
    return store._dir(aid) / "doc" / "snaps"


_HIST_CACHE: dict = {}  # hist.json path -> (stamp, parsed): every edit reads it


def _hist_index(aid: str) -> dict:
    """The parsed index ({} when none). Shared: never change it in place."""
    p = _hist_path(aid)
    try:
        return store.json_cached(p, _HIST_CACHE, 8)
    except (FileNotFoundError, ValueError):
        pass
    if _old_hist_path(aid).is_file():
        with _LOCK:
            return _migrate(aid)
    return {}


def _hist(aid: str, version: int) -> list:
    """The index's entries for ``version`` (a new list; the entries are shared: never change one in place).
    A republish starts the history again."""
    h = _hist_index(aid)
    return list(h.get("snaps", [])) if h.get("version") == version else []


def _write_snap(aid: str, seq: int, blocks: list) -> tuple:
    """(file number, bytes): the snapshot written as snaps/<n>.json, ``n`` the first number from ``seq`` no
    file has yet. The name is claimed first (created only if absent), so two processes that read the same
    index never write one file each over the other's."""
    d = _snaps_dir(aid)
    d.mkdir(parents=True, exist_ok=True)
    data = json.dumps({"blocks": blocks}, ensure_ascii=False, separators=(",", ":"))
    while True:
        try:
            os.close(os.open(d / f"{seq}.json", os.O_CREAT | os.O_EXCL | os.O_WRONLY))
            break
        except FileExistsError:
            seq += 1
    try:
        store.write_atomic(d / f"{seq}.json", data)
    except BaseException:
        (d / f"{seq}.json").unlink(missing_ok=True)
        raise
    return seq, len(data.encode("utf-8"))


def _entry(snap: dict, seq: int, size: int) -> dict:
    return {"tab": snap["tab"], "rev": snap["rev"], "by": snap["by"], "at": snap["at"], "title": snap["title"],
            "n": len(snap["blocks"]), "f": seq, "bytes": size}


def _bounded(entries: list) -> tuple:
    """(kept, dropped): the newest within MAX_SNAPS and MAX_HIST_BYTES, at least the newest two."""
    kept = entries[-MAX_SNAPS:]
    total = sum(e.get("bytes", 0) for e in kept)
    while len(kept) > 2 and total > MAX_HIST_BYTES:
        total -= kept.pop(0).get("bytes", 0)
    keep = {id(e) for e in kept}
    return kept, [e for e in entries if id(e) not in keep]


def _hist_save(aid: str, version: int, entries: list, seq: int, drop: list, sweep: bool = False) -> None:
    """Write the index (durable), then remove the files no entry names any more (``sweep``: every file in
    snaps/ that the index does not name: a republish, a migration)."""
    p = _hist_path(aid)
    p.parent.mkdir(parents=True, exist_ok=True)
    entries, more = _bounded(entries)
    h = {"version": version, "seq": seq, "snaps": entries}
    st = store.write_atomic(p, json.dumps(h, ensure_ascii=False, separators=(",", ":")))
    store.json_remember(p, _HIST_CACHE, h, st, 8)
    named = {e["f"] for e in entries}
    gone = [e["f"] for e in list(drop) + more if e.get("f") not in named]
    d = _snaps_dir(aid)
    if sweep:
        try:
            gone += [int(c.name[:-5]) for c in d.iterdir() if c.name.endswith(".json") and c.name[:-5].isdigit()]
        except OSError:
            pass
    for f in set(gone) - named:
        try:
            (d / f"{int(f)}.json").unlink()
        except (OSError, ValueError, TypeError):
            pass


def _migrate(aid: str) -> dict:
    """doc/history.json (every snapshot inline) -> doc/snaps/ + doc/hist.json, within the bounds; the old file
    is removed once the new index is written. Unreadable: no history (as before)."""
    old = _old_hist_path(aid)
    try:
        h = store.read_json(old)
    except (OSError, ValueError):
        return {}
    try:
        idx = store.json_cached(_hist_path(aid), _HIST_CACHE, 8)  # another process moved it meanwhile
        old.unlink(missing_ok=True)
        return idx
    except (FileNotFoundError, ValueError):
        pass
    snaps = [x for x in (h.get("snaps") or []) if isinstance(x, dict) and isinstance(x.get("blocks"), list)]
    entries, total = [], 0
    top = len(snaps)
    for seq, x in reversed(list(enumerate(snaps, 1))):  # newest first: the bounds keep those
        if len(entries) >= MAX_SNAPS or (len(entries) >= 2 and total > MAX_HIST_BYTES):
            break
        f, size = _write_snap(aid, seq, x["blocks"])
        top = max(top, f)
        total += size
        entries.insert(0, _entry(x, f, size))
    _hist_save(aid, h.get("version"), entries, top + 1, [], sweep=True)
    old.unlink(missing_ok=True)
    logger.info("doc %s: history moved to one file per snapshot (%d kept of %d)", aid, len(entries), len(snaps))
    return store.json_cached(_hist_path(aid), _HIST_CACHE, 8)


def _snap(t: dict, by: str) -> dict:
    return {"tab": t["id"], "rev": t["rev"], "by": by, "at": time.time(), "title": t["title"],
            "blocks": [{"id": b["id"], "md": b["md"]} for b in t["blocks"]]}


def _record(aid: str, st: dict, t: dict, by: str, before: Optional[dict]) -> None:
    """Called with the lock held, after an edit of tab ``t``. ``before`` is the tab as it was."""
    h = _hist_index(aid)
    fresh = h.get("version") != st["version"]  # a republish: its snapshots start again
    entries = [] if fresh else list(h.get("snaps", []))
    seq = int(h.get("seq") or 1)  # file numbers never repeat, a republish included
    mine = [x for x in entries if x["tab"] == t["id"]]
    drop = []

    def add(snap: dict) -> dict:
        nonlocal seq
        f, size = _write_snap(aid, seq, snap["blocks"])
        seq = f + 1
        return _entry(snap, f, size)
    if not mine and before:  # the tab as it started: always restorable
        entries.append(add(before))
    last = mine[-1] if mine else None
    if last and last["by"] == by and by == "user" and time.time() - last["at"] < SNAP_GAP:
        entries[entries.index(last)] = add(_snap(t, by))  # the same burst of typing: a new file, the old one goes
        drop.append(last)
    else:
        entries.append(add(_snap(t, by)))
    _hist_save(aid, st["version"], entries, seq, drop, sweep=fresh and bool(h))


def sweep(aid: str, dd: Path, now: float, out: dict) -> None:
    """store.sweep's part for a doc folder: the old one-file history once moved over, snapshot files the index
    does not name (and index entries whose file is gone), pictures no block, snapshot or kept version uses.
    Only what is older than store.ORPHAN_AGE goes (a writer elsewhere may be mid-edit)."""
    def gone(p: Path, kind: str) -> None:
        try:
            p.unlink()
            out[kind] = out.get(kind, 0) + 1
        except OSError:
            pass
    old_age = lambda p: store._age(p, now) > store.ORPHAN_AGE  # noqa: E731
    with _LOCK:
        ip, old, snaps = dd / "hist.json", dd / "history.json", dd / "snaps"
        st0 = store._stamp(ip)
        try:
            h, fell_back = store.read_json_from(ip)
        except FileNotFoundError:
            h, fell_back = None, False
        except (OSError, ValueError):
            return  # an index that can't be read: nothing here is decided on a guess
        if fell_back or (h is not None and not isinstance(h, dict)):
            return
        texts = []
        if old.is_file():
            if h is not None and old_age(old):
                gone(old, "old_history")  # a migration that stopped before removing it
            else:
                try:  # not moved over yet: its snapshots still show pictures
                    texts.append(old.read_text(encoding="utf-8"))
                except OSError:
                    return
        if snaps.is_dir():
            entries = list(h.get("snaps", [])) if h is not None else None
            if entries is not None:
                lost = [e for e in entries if not (snaps / f"{e.get('f')}.json").is_file()]
                if lost and store._stamp(ip) == st0:  # the index lists only what can be restored
                    h = {**h, "snaps": [e for e in entries if e not in lost]}
                    st = store.write_atomic(ip, json.dumps(h, ensure_ascii=False, separators=(",", ":")))
                    store.json_remember(ip, _HIST_CACHE, h, st, 8)
                    out["snap_entries"] = out.get("snap_entries", 0) + len(lost)
                elif lost:
                    return  # written meanwhile (another process): left for the next round
                named = {str(e.get("f")) for e in h["snaps"]}
            for e in os.scandir(snaps):
                p = Path(e.path)
                if not e.name.endswith(".json"):
                    continue
                if (entries is None and not old.is_file()) or (entries is not None and e.name[:-5] not in named):
                    if old_age(p):
                        gone(p, "snaps")
                        continue
                try:
                    texts.append(p.read_text(encoding="utf-8"))
                except OSError:
                    pass
        files = dd / "files"
        if files.is_dir():
            for name in ("state.json", "state.json.bak"):
                try:
                    texts.append((dd / name).read_text(encoding="utf-8"))
                except OSError:
                    pass
            try:
                meta, fell_back = store.read_json_from(store._dir(aid) / "meta.json")
            except (OSError, ValueError):
                return
            if fell_back or not isinstance(meta, dict):
                return  # a copy may not name every version
            for v in meta.get("versions") or []:
                for rel in ("doc.md", "doc.json"):
                    try:
                        texts.append((store._dir(aid) / f"v{v['n']}" / rel).read_text(encoding="utf-8"))
                    except OSError:
                        pass
            for e in os.scandir(files):
                if e.is_file() and not any(e.name in t for t in texts) and old_age(Path(e.path)):
                    gone(Path(e.path), "pictures")


def _forget(aid: str, d: Path) -> None:
    pre = str(d) + os.sep
    for cache in (_STATES, _HIST_CACHE):
        for k in [k for k in cache if str(k).startswith(pre)]:
            cache.pop(k, None)


store.on_forget(_forget)


def _snap_blocks(aid: str, x: dict) -> list:
    """A listed snapshot's blocks (absent: its file is gone, which only a process outside these rules does)."""
    try:
        return store.read_json(_snaps_dir(aid) / f"{int(x['f'])}.json")["blocks"]
    except (OSError, ValueError, KeyError, TypeError):
        raise DocError("absent", f"the snapshot at rev {x.get('rev')} can't be read")


def history(aid: str, tab: Optional[str] = None) -> dict:
    """The tab's snapshots, newest first: {rev, by, at, blocks (count)}."""
    st = load(aid)
    t = _tab(st, tab)
    snaps = [x for x in _hist(aid, st["version"]) if x["tab"] == t["id"]]
    return {"tab": t["id"], "rev": t["rev"],
            "snaps": [{"rev": x["rev"], "by": x["by"], "at": x["at"], "blocks": x["n"]} for x in reversed(snaps)]}


def at_rev(aid: str, tab: Optional[str], rev: int) -> dict:
    """The tab as it was at ``rev`` (the newest snapshot at or before it)."""
    st = load(aid)
    t = _tab(st, tab)
    cands = [x for x in _hist(aid, st["version"]) if x["tab"] == t["id"] and x["rev"] <= int(rev)]
    if not cands:
        raise DocError("absent", f"no snapshot at or before rev {rev}")
    x = cands[-1]
    return {"tab": t["id"], "title": x["title"], "rev": x["rev"], "current_rev": t["rev"], "by": x["by"], "at": x["at"],
            "blocks": [{"id": b["id"], "kind": _kind(b["md"]), "md": b["md"]} for b in _snap_blocks(aid, x)]}


def restore(aid: str, tab: Optional[str], rev: int) -> dict:
    """Bring a tab back to a snapshot, as a new rev by the person (it can itself be undone the same way)."""
    with _writing(aid):
        st = load(aid)
        t = _tab(st, tab)
        x = at_rev(aid, t["id"], rev)
        before = _snap(t, "user")
        last, _ = _last(st, t)
        t["blocks"] = [{"id": b["id"], "md": b["md"]} for b in x["blocks"]] or _some([])
        t["title"] = x["title"]
        t["rev"] += 1
        st["log"].append({"tab": t["id"], "rev": t["rev"], "by": "user", "blocks": [b["id"] for b in t["blocks"]] + ["tab"],
                          "at": time.time(), "restored": x["rev"]})
        st["log"] = st["log"][-MAX_LOG:]
        _note(st, last, [b["id"] for b in t["blocks"]], t["rev"], "user", t["id"])
        _save(aid, st)
        _record(aid, st, t, "restore", before)
        return {"ok": True, "tab": t["id"], "rev": t["rev"], "restored": x["rev"]}


def markdown(aid: str) -> str:
    with _LOCK:
        st = load(aid)
        if len(st["tabs"]) == 1:
            return tab_markdown(st["tabs"][0])
        return "\n\n".join(f"# {t['title']}\n\n" + tab_markdown(t) for t in st["tabs"])
