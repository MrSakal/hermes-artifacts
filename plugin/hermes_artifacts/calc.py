"""Formula values of a sheet workbook computed on the server, for when no page is open.

The formula engine is the page's own (types/sheet/formula.js): it is not ported, it is run under
``node`` by types/sheet/calc_runner.js. One short-lived process per computation: a list argv (no
shell), the workbook in on stdin, the values out on stdout, killed after ``TIMEOUT`` seconds.
Whatever goes wrong (no node, a timeout, output that is not what the runner writes) gives None /
False and the caller keeps what it had: nothing here raises.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable, Optional

_DIR = Path(__file__).resolve().parent / "types" / "sheet"
RUNNER = _DIR / "calc_runner.js"
FORMULA = _DIR / "formula.js"
TIMEOUT = 5.0                 # seconds for the whole process: start, compute, write
MAX_OUT = 32 * 1024 * 1024    # bytes of output accepted (the runner refuses to write more)
MAX_HEAP_MB = 512
RETRY_NODE = 60.0             # seconds before a missing node is looked for again
_node: dict = {"path": None, "at": None}
_failed: dict = {}            # workbook token -> True: a state that failed is not tried again


def node_path() -> Optional[str]:
    """The node executable on PATH (cached; a missing one is looked for again after a minute)."""
    now = time.monotonic()
    if _node["path"] is None and (_node["at"] is None or now - _node["at"] > RETRY_NODE):
        p = shutil.which("node")
        if p and os.name == "nt" and not p.lower().endswith(".exe"):
            p = None  # a .cmd / .bat shim would run through the shell
        _node["path"], _node["at"] = p, now
    return _node["path"]


# The only variables node is started with: none of Hermes' (provider keys, tokens) reach the child.
_ENV_KEEP = ("PATH", "HOME", "LANG") + (("SYSTEMROOT", "TEMP", "TMP", "USERPROFILE") if os.name == "nt" else ())


def child_env() -> dict:
    """The environment node runs in: the few variables in _ENV_KEEP that are set, nothing else."""
    up = {k.upper(): v for k, v in os.environ.items()}
    return {k: up[k] for k in _ENV_KEEP if up.get(k)}


def run(book: list, locale: str = "en") -> Optional[list]:
    """``book``: [{"name", "cells": {A1: raw}, "charts": [anchor, ...]}] -> the computed values of
    the formula cells, one {A1: value} per sheet in the same order; None when it could not be done."""
    node = node_path()
    if not node:
        return None
    try:
        data = json.dumps({"locale": locale, "sheets": book}, separators=(",", ":")).encode("utf-8")
        env = child_env()
        kw ={"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
        p = subprocess.Popen([node, f"--max-old-space-size={MAX_HEAP_MB}", str(RUNNER), str(FORMULA), str(MAX_OUT)],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             cwd=str(_DIR), env=env, shell=False, **kw)
        try:
            out, _ = p.communicate(data, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            p.kill()
            p.communicate()
            return None
        except BaseException:
            p.kill()
            raise
        if p.returncode != 0 or not out or len(out) > MAX_OUT:
            return None
        res = json.loads(out.decode("utf-8")).get("sheets")
        if not isinstance(res, list) or len(res) != len(book) or not all(isinstance(x, dict) for x in res):
            return None
        return res
    except Exception:
        return None


def merge(cur: dict, vals: dict, value: Callable, parse_key: Callable, limit: int) -> None:
    """Computed values merged into ``cur`` ({A1: value}), each checked: null drops one, an error is
    {"error": "#DIV/0!"}, anything else must pass ``value`` (sheets._value). The one place both the
    page's values (sheets.set_vals) and the server's own (refresh) go through."""
    for k, v in list(vals.items())[:limit]:
        if not isinstance(k, str) or not parse_key(k):
            continue
        if v is None:
            cur.pop(k, None)
        elif isinstance(v, dict):
            if isinstance(v.get("error"), str):
                cur[k] = {"error": v["error"][:20]}
        else:
            try:
                cur[k] = value(v, k)
            except Exception:
                continue


def _token(st: dict) -> tuple:
    return (st.get("version"), st.get("hermes_at"), tuple((s["id"], s["rev"]) for s in st["sheets"]))


def refresh(st: dict, *, value: Callable, parse_key: Callable, is_formula: Callable, limit: int) -> bool:
    """Compute every formula of the workbook state ``st`` and put the values where the page's would
    be: each sheet's ``vals`` and ``vals_at``. True when done (the caller saves the state); False
    with the state untouched when not. Call it under the sheets lock."""
    try:
        token = _token(st)
        if token in _failed:
            return False
        book = [{"name": s["name"], "cells": s["cells"], "charts": [c.get("at") for c in s.get("charts", [])]}
                for s in st["sheets"]]
        had_node = bool(node_path())
        res = run(book)
        if res is None:
            if had_node:  # a timeout or bad output costs seconds: once per workbook state
                if len(_failed) >= 64:
                    _failed.clear()
                _failed[token] = True
            return False
        new = []
        for s, raw in zip(st["sheets"], res):
            vals: dict = {}
            merge(vals, raw, value, parse_key, limit)
            new.append({k: v for k, v in vals.items() if is_formula(s["cells"].get(k))})
        now = time.time()
        for s, vals in zip(st["sheets"], new):
            s["vals"], s["vals_at"] = vals, now
        return True
    except Exception:
        return False
