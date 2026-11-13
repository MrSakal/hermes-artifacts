"""What an open artifact page went through, as its host saw it: errors and whether a version showed.

The host (Hermes Desktop's plugin page, the browser viewer's shell) attaches the version IT holds for
the frame and posts to host-only routes (``api.py`` ``artifacts/<id>/diag`` and ``/shown``;
``server.py`` ``/host/<id>/diag`` and ``/shown``). A page reaches neither: its ops go through
``artifacts/<id>/op`` (Desktop) or ``/api/<id>/<op>`` (browser), and neither knows these names.

Stored in ``<artifact>/diagnostics.json``, beside the versions, never in one (so it is no artifact file:
not listed, published, handed back or exported) and moved to the trash with the artifact's folder::

    {"v7": {"opened": 2, "first": t, "last": t, "ready": 1, "threw": 1, "shown": "ready", "blank": false,
            "recovered": 0, "viewer": "desktop", "entries": [{k, m, at, n, stack?, tag?, url?, t}], "dropped": 0}}

``shown`` is the latest outcome: a stall a frame recovers from (``recovered: true`` on the next shown
report) is replaced by ready/threw and counts no new open. ``blank`` (with threw): nothing rendered, the
previous version stayed on screen; without it a page that threw while starting still showed.

Bounded: MAX_ENTRIES per version (the rest counted in ``dropped``), MAX_VERSION_BYTES per version,
the last KEEP_VERSIONS versions, entries unseen for MAX_AGE_S dropped. Written at most once per
WRITE_EVERY_S per artifact: reports in between wait in memory and are applied to what is on disk when
written (another process may have written meanwhile). Never raises into the request that reports.

Page-authored text (messages, urls, stacks, file names) is kept as data: the agent sees it only as JSON
values under ``page.errors`` in ha_check, never in a sentence of a result.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Optional

from . import store

logger = logging.getLogger(__name__)

FILE = "diagnostics.json"
MAX_BODY_BYTES = 64 * 1024  # one report from the host, as JSON
MAX_POST_ENTRIES = 20  # entries one report carries (the bridge sends at most 20 per load)
MAX_ENTRIES = 30  # distinct entries kept per version
MAX_VERSION_BYTES = 32 * 1024
KEEP_VERSIONS = 3
MAX_AGE_S = 7 * 86400
WRITE_EVERY_S = 1.0
MAX_PENDING = 64  # reports waiting for one artifact's next write; more are dropped
MAX_COUNT = 1_000_000
# Field limits (characters): a longer value is cut, an unknown key dropped.
LIMITS = {"m": 300, "at": 200, "stack": 500, "tag": 20, "url": 500}
# What each kind is called in a sentence (the only entry field that ever is: the server's own words).
KINDS = {"error": "script error", "resource": "failed load", "rejection": "unhandled rejection",
         "console": "console error", "csp": "CSP violation", "other": "error"}
OUTCOMES = ("ready", "threw", "timeout", "stalled")
VIEWERS = ("desktop", "browser")
_LOADS = ("ready", "threw", "timeout")  # an outcome that ends a load (stalled comes later, for the same load)

_MLOCK = threading.Lock()
_PENDING: dict = {}  # aid -> {"created": meta created, "ops": [op, ...]}
_LAST: dict = {}  # aid -> when this process last wrote its file
_TIMERS: dict = {}  # aid -> the threading.Timer that writes it next
_ENABLED: tuple = (0.0, True)  # (read at, value): the setting, read again after 5 s


# ----------------------------------------------------------------------------- the setting

def _truthy_off(v) -> bool:
    return str(v).strip().lower() in ("false", "0", "no", "off")


def enabled(getter=None) -> bool:
    """The ``page_diagnostics`` setting (default on). ``getter``: the plugin context's get_config, in the
    agent's process; else Hermes' config.yaml as Hermes reads it (the web server runs no plugin context).
    Read again at most every 5 s."""
    global _ENABLED
    if getter is not None:
        try:
            v = getter("page_diagnostics")
        except Exception:
            v = None
        return True if v in (None, "") else not _truthy_off(v)
    at, value = _ENABLED
    now = time.monotonic()
    if at and now - at < 5:
        return value
    value = True
    try:
        from hermes_cli.config import load_config_readonly
        cfg = load_config_readonly() or {}
        entry = (((cfg.get("plugins") or {}).get("entries") or {}).get(store.PLUGIN_ID) or {})
        for sub in ("settings", "config"):
            got = (entry.get(sub) or {}).get("page_diagnostics") if isinstance(entry.get(sub), dict) else None
            if got not in (None, ""):
                value = not _truthy_off(got)
                break
    except Exception:
        value = True
    _ENABLED = (now, value)
    return value


# ----------------------------------------------------------------------------- what the host sends

def _cut(v, n: int) -> str:
    return "".join(ch for ch in str(v) if ch >= " " or ch in "\n\t")[:n]


def _count(v, default: int = 0) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return default
    return max(0, min(MAX_COUNT, int(v)))


def _time(v) -> float:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def _version(meta: dict, body: dict) -> int:
    v = body.get("version")
    if isinstance(v, bool) or not isinstance(v, int) or v not in {x["n"] for x in meta.get("versions") or []}:
        raise ValueError("version must be one of the artifact's version numbers")
    return v


def _viewer(body: dict, viewer: Optional[str]) -> str:
    v = viewer or body.get("viewer")
    if v not in VIEWERS:
        raise ValueError("viewer must be desktop or browser")
    return v


def _entry(e) -> Optional[dict]:
    if not isinstance(e, dict):
        return None
    k = e.get("k") if isinstance(e.get("k"), str) and e.get("k") in KINDS else "other"
    out = {"k": k}
    for key, n in LIMITS.items():
        v = e.get(key)
        if key == "stack" and isinstance(v, list):  # frames: at most 3
            v = "\n".join(str(x) for x in v[:3])
        if isinstance(v, (str, int, float)) and not isinstance(v, bool) and str(v) != "":
            out[key] = _cut(v, n)
    out["n"] = max(1, _count(e.get("n"), 1))
    return out


def parse_diag(meta: dict, body: Any, viewer: Optional[str] = None) -> dict:
    """A diag report as an op: {kind: "diag", version, viewer, entries, dropped}. ValueError when it is no
    report this route takes. Entries past MAX_POST_ENTRIES and ones that are no object count as dropped."""
    if not isinstance(body, dict):
        raise ValueError("a diag report is a JSON object")
    if len(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")) > MAX_BODY_BYTES:
        raise OverflowError(f"a diag report is at most {MAX_BODY_BYTES // 1024} KB")
    raw = body.get("entries")
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        raise ValueError("entries must be a list")
    entries = [x for x in (_entry(e) for e in raw[:MAX_POST_ENTRIES]) if x]
    dropped = _count(body.get("dropped")) + (len(raw) - len(entries))
    return {"kind": "diag", "version": _version(meta, body), "viewer": _viewer(body, viewer),
            "entries": entries, "dropped": min(MAX_COUNT, dropped)}


def _flag(body: dict, key: str) -> bool:
    v = body.get(key, False)
    if not isinstance(v, bool):
        raise ValueError(f"{key} must be true or false")
    return v


def parse_shown(meta: dict, body: Any, viewer: Optional[str] = None) -> dict:
    """A swap outcome as an op: {kind: "shown", version, viewer, outcome, recovered, blank}.

    Optional booleans (default false): ``recovered`` — a frame that had stalled answers again (outcome
    ready or threw): the same load, not a new open; ``blank`` — with outcome threw: the page rendered
    nothing and the previous version stayed on screen (false: it showed, with an error while starting)."""
    if not isinstance(body, dict):
        raise ValueError("a shown report is a JSON object")
    if len(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")) > 4096:
        raise OverflowError("a shown report is at most 4 KB")
    outcome = body.get("outcome")
    if outcome not in OUTCOMES:
        raise ValueError("outcome must be ready, threw, timeout or stalled")
    recovered, blank = _flag(body, "recovered"), _flag(body, "blank")
    if recovered and outcome not in ("ready", "threw"):
        raise ValueError("recovered goes with outcome ready or threw")
    return {"kind": "shown", "version": _version(meta, body), "viewer": _viewer(body, viewer), "outcome": outcome,
            "recovered": recovered, "blank": blank and outcome == "threw"}


# ----------------------------------------------------------------------------- the record

def _path(aid: str) -> Path:
    return store._dir(aid) / FILE


def _usefulness(e: dict) -> tuple:
    """Smaller is more useful: uncaught errors and rejections first, then the more frequent."""
    return _RANK.get(e.get("k"), 1), -_count(e.get("n"), 1)


def _least_useful(entries: list) -> int:
    """The index of the entry to give up first (least useful; of equals, the newest)."""
    return max(range(len(entries)), key=lambda i: (_usefulness(entries[i]), i))


def _apply(data: dict, op: dict, now: float) -> None:
    key = f"v{op['version']}"
    rec = data.get(key)
    if not isinstance(rec, dict):
        rec = data[key] = {"opened": 0, "first": now, "last": now, "ready": 0, "threw": 0, "shown": None,
                           "viewer": op["viewer"], "entries": [], "dropped": 0}
    rec["last"], rec["viewer"] = now, op["viewer"]
    if op["kind"] == "shown":
        out = op["outcome"]
        if op.get("recovered"):  # a stalled frame answering again: the same load, counted when it opened
            rec["recovered"] = min(MAX_COUNT, _count(rec.get("recovered")) + 1)
        else:
            if out in _LOADS:
                rec["opened"] = min(MAX_COUNT, _count(rec.get("opened")) + 1)
            if out in ("ready", "threw"):
                rec[out] = min(MAX_COUNT, _count(rec.get(out)) + 1)
        rec["shown"], rec["blank"] = out, bool(op.get("blank")) and out == "threw"
        return
    entries = rec["entries"] if isinstance(rec.get("entries"), list) else []
    index = {(e.get("k"), e.get("m"), e.get("at")): e for e in entries if isinstance(e, dict)}
    dropped = _count(rec.get("dropped")) + op["dropped"]
    for e in op["entries"]:
        have = index.get((e["k"], e.get("m"), e.get("at")))
        if have is not None:
            have["n"] = min(MAX_COUNT, _count(have.get("n"), 1) + e["n"])
            have["t"] = now
        elif len(entries) >= MAX_ENTRIES:
            dropped += 1
            worst = _least_useful(entries)
            if _usefulness(e) < _usefulness(entries[worst]):  # an uncaught error displaces a console line
                index.pop((entries[worst].get("k"), entries[worst].get("m"), entries[worst].get("at")), None)
                entries[worst] = new = {**e, "t": now}
                index[(e["k"], e.get("m"), e.get("at"))] = new
        else:
            new = {**e, "t": now}
            entries.append(new)
            index[(e["k"], e.get("m"), e.get("at"))] = new
    rec["entries"], rec["dropped"] = entries, min(MAX_COUNT, dropped)


def _prune(data: dict, now: float) -> dict:
    """The last KEEP_VERSIONS versions, entries seen within MAX_AGE_S, each version within its bytes."""
    recs = {}
    for k, rec in data.items():
        m = re.fullmatch(r"v(\d{1,9})", str(k))
        if m and isinstance(rec, dict):
            recs[int(m.group(1))] = rec
    out = {}
    for n in sorted(recs)[-KEEP_VERSIONS:]:
        rec = recs[n]
        entries = [e for e in rec.get("entries") or [] if isinstance(e, dict) and now - _time(e.get("t")) <= MAX_AGE_S]
        rec["entries"] = entries
        while entries and len(json.dumps(rec, ensure_ascii=False).encode("utf-8")) > MAX_VERSION_BYTES:
            entries.pop(_least_useful(entries))
            rec["dropped"] = min(MAX_COUNT, _count(rec.get("dropped")) + 1)
        out[f"v{n}"] = rec
    return out


def _load(aid: str) -> dict:
    try:
        data = json.loads(_path(aid).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_file(p: Path, data: dict) -> None:
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, p)


def flush(aid: str, now: Optional[float] = None) -> bool:
    """Write what waits for ``aid`` onto what is on disk. Nothing when the artifact is gone (deleted, or made
    again under its id): its folder is never made again. Never raises. True when it wrote."""
    with _MLOCK:
        t = _TIMERS.pop(aid, None)
        pend = _PENDING.pop(aid, None)
        _LAST[aid] = time.time() if now is None else now
    if t is not None:
        t.cancel()
    if not pend or not pend["ops"]:
        return False
    try:
        with store._LOCK:  # store.delete moves the folder under this lock
            meta = store.get_meta(aid)
            if not meta or meta.get("created") != pend["created"]:
                return False
            data = _load(aid)
            for op, at in pend["ops"]:
                _apply(data, op, at)
            _write_file(_path(aid), _prune(data, time.time() if now is None else now))
        return True
    except Exception:
        logger.debug("writing %s's page diagnostics failed", aid, exc_info=True)
        return False


def flush_all() -> None:
    for aid in list(_PENDING):
        flush(aid)


def record(aid: str, op: dict, meta: Optional[dict] = None, now: Optional[float] = None) -> bool:
    """Keep one parsed report (``parse_diag``/``parse_shown``). Written now when this artifact's file was
    not written within WRITE_EVERY_S, else with the next write (at most WRITE_EVERY_S from now). Nothing is
    kept when page diagnostics are off. Never raises. True when it was kept."""
    try:
        if not enabled():
            return False
        meta = meta or store.get_meta(aid)
        if not meta:
            return False
        at = time.time() if now is None else now
        with _MLOCK:
            pend = _PENDING.get(aid)
            if pend is None or pend["created"] != meta.get("created"):
                pend = _PENDING[aid] = {"created": meta.get("created"), "ops": []}
            if len(pend["ops"]) >= MAX_PENDING:
                return False
            pend["ops"].append((op, at))
            wait = WRITE_EVERY_S - (at - _LAST.get(aid, float("-inf")))
            if wait > 0 and aid not in _TIMERS:
                timer = threading.Timer(min(wait, WRITE_EVERY_S), flush, (aid,))
                timer.daemon = True
                _TIMERS[aid] = timer
                timer.start()
        if wait <= 0:
            flush(aid, now)
        return True
    except Exception:
        logger.debug("keeping %s's page diagnostics failed", aid, exc_info=True)
        return False


def read(aid: str, now: Optional[float] = None) -> dict:
    """Every kept version's record: what is on disk with what waits in this process applied, pruned."""
    at = time.time() if now is None else now
    data = _load(aid)
    with _MLOCK:
        pend = _PENDING.get(aid)
        ops = list(pend["ops"]) if pend else []
    for op, t in ops:
        _apply(data, op, t)
    return _prune(data, at)


def version_record(aid: str, n: int, now: Optional[float] = None) -> Optional[dict]:
    return read(aid, now).get(f"v{int(n)}")


# ----------------------------------------------------------------------------- for the agent

# What ha_check hands the agent of a version's errors (the full set stays on disk): the most useful few,
# each trimmed, within SHOW_CHARS as JSON. Uncaught errors and rejections first, then the most frequent.
SHOW_ERRORS = 5
SHOW_CHARS = 2048
SHOW_LIMITS = {"m": 200, "at": 120, "stack": 160, "tag": 20, "url": 120}
_RANK = {"error": 0, "rejection": 0, "other": 1, "resource": 2, "console": 2, "csp": 2}


def _shown_error(e: dict) -> dict:
    out = {"k": e.get("k") if e.get("k") in KINDS else "other"}
    for key, n in SHOW_LIMITS.items():
        v = e.get(key)
        if v in (None, ""):
            continue
        v = str(v)
        if key == "stack":  # one frame
            v = v.strip().splitlines()[0] if v.strip() else ""
        if v:
            out[key] = v[:n]
    out["n"] = max(1, _count(e.get("n"), 1))
    return out


def page_view(rec: dict) -> dict:
    """ha_check's ``page``: {opened, shown, blank (with shown "threw"), errors, more, dropped}. ``errors``:
    at most SHOW_ERRORS of the kept entries, most useful first, trimmed, within SHOW_CHARS (the page's own
    text: data); ``more``: kept entries not shown; ``dropped``: ones never kept."""
    entries = [e for e in rec.get("entries") or [] if isinstance(e, dict)]
    order = sorted(range(len(entries)), key=lambda i: (_usefulness(entries[i]), i))
    errors = [_shown_error(entries[i]) for i in order[:SHOW_ERRORS]]
    while len(errors) > 1 and len(json.dumps(errors, ensure_ascii=False, separators=(",", ":"))) > SHOW_CHARS:
        errors.pop()
    state = rec.get("shown") if rec.get("shown") in OUTCOMES else None
    out = {"opened": _count(rec.get("opened")), "shown": state}
    if state == "threw":
        out["blank"] = bool(rec.get("blank"))
    out.update(errors=errors, more=len(entries) - len(errors), dropped=_count(rec.get("dropped")))
    return out


def shown_state(rec: Optional[dict]) -> Optional[str]:
    """How the version showed, when it is worth telling: "blank" (an error while starting, nothing shown),
    "threw" (shown, with an error while starting), "timeout", "stalled"; else None (ready, or no report)."""
    s = (rec or {}).get("shown")
    if s == "threw":
        return "blank" if rec.get("blank") else "threw"
    return s if s in ("timeout", "stalled") else None


def news(rec: Optional[dict]):
    """What there is to tell about a version (a value that changes when there is more), or None (nothing:
    no record, no errors, and it showed, recovered from a stall or has not reported yet)."""
    if not rec:
        return None
    bad = shown_state(rec)
    k, dropped = len(rec.get("entries") or []), _count(rec.get("dropped"))
    return [k, dropped, bad] if (k or dropped or bad) else None


LINE_MAX = 160
SHOWN_WORDS = {"blank": "showed nothing (an error while starting); the previous version stayed on screen",
               "threw": "showed with an error while starting", "timeout": "didn't show (timed out)",
               "stalled": "stopped responding"}
_SHORT_WORDS = {**SHOWN_WORDS, "blank": "showed nothing (an error while starting)"}
_AT = re.compile(r"^(.{1,200}?):(\d{1,7})(?::\d{1,7})?$")


def _where(e: dict, files: set) -> str:
    """``path:line`` when ``at`` names a file of that version (the agent's own name for it), else nothing:
    the page's own text never goes into a sentence."""
    m = _AT.match(str(e.get("at") or ""))
    return f"{m.group(1)}:{m.group(2)}" if m and m.group(1) in files else ""


def summary_line(n: int, rec: dict, files) -> Optional[str]:
    """The one line a later ha_publish/ha_read carries, at most LINE_MAX characters, in the server's words:
    the count, the first entry's kind and (when it is a file of the version) its location, how it showed."""
    if news(rec) is None:
        return None
    entries = [e for e in rec.get("entries") or [] if isinstance(e, dict)]
    count = len(entries) + _count(rec.get("dropped"))
    tail = " ha_check for all."
    state = shown_state(rec)
    for with_where, words in ((True, SHOWN_WORDS), (False, SHOWN_WORDS), (False, _SHORT_WORDS)):
        parts = []
        if count:
            first = entries[0] if entries else {}
            where = _where(first, set(files or ())) if with_where and first else ""
            head = f" (first: {KINDS.get(first.get('k'), 'error')}{', ' + where if where else ''})" if first else ""
            parts.append(f"{count} {'error' if count == 1 else 'errors'}{head}")
        if state:
            parts.append(words[state])
        line = f"v{int(n)}: " + "; ".join(parts) + "." + tail
        if len(line) <= LINE_MAX:
            return line
    return line[:LINE_MAX - 1] + "…"
