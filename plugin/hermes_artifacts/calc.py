"""Formula values of a sheet workbook computed on the server, for when no page is open.

The formula engine is the page's own (types/sheet/formula.js): it is not ported, it is run under
``node`` by types/sheet/calc_runner.js. Starting node costs ~140 ms, so one process is kept running
(calc_worker.js: calc_runner.js's own code, one workbook per line on stdin, one answer per line on stdout)
while it is used, and ended after ``IDLE`` seconds unused, on plugin unload and at exit. It is started
exactly as a one-shot runner was (a list argv, no shell, the same few environment variables, the same heap
limit, the runner's folder), computations take turns, and one that takes over ``TIMEOUT`` seconds kills it
(the next starts a new one). When it cannot be started or dies on a workbook, that computation runs as before:
one short-lived process (the workbook in on stdin, the values out on stdout, killed after ``TIMEOUT``).
Whatever goes wrong (no node, a timeout, output that is not what the runner writes) gives None / False and
the caller keeps what it had: nothing here raises.
"""

from __future__ import annotations

import atexit
import json
import os
import queue
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable, Optional

_DIR = Path(__file__).resolve().parent / "types" / "sheet"
RUNNER = _DIR / "calc_runner.js"
FORMULA = _DIR / "formula.js"
WORKER = Path(__file__).resolve().parent / "calc_worker.js"
TIMEOUT = 5.0                 # seconds for one computation (a one-shot process: start, compute, write)
MAX_OUT = 32 * 1024 * 1024    # bytes of output accepted (the runner refuses to write more)
MAX_HEAP_MB = 512
RETRY_NODE = 60.0             # seconds before a missing node is looked for again
IDLE = 120.0                  # seconds unused before the kept process is ended
RETRY_WORKER = 300.0          # seconds of one-shot processes after the kept one could not start or died
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


def _popen(node: str, script: list) -> subprocess.Popen:
    """node started as the runner always was: list argv, no shell, child_env(), the heap limit, its folder."""
    kw = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    return subprocess.Popen([node, f"--max-old-space-size={MAX_HEAP_MB}"] + [str(x) for x in script],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            cwd=str(_DIR), env=child_env(), shell=False, **kw)


def _sheets(out: bytes, book: list) -> Optional[list]:
    if not out or len(out) > MAX_OUT:
        return None
    res = json.loads(out.decode("utf-8")).get("sheets")
    if not isinstance(res, list) or len(res) != len(book) or not all(isinstance(x, dict) for x in res):
        return None
    return res


def _once(node: str, data: bytes, book: list) -> Optional[list]:
    """One short-lived process for one computation."""
    p = _popen(node, [RUNNER, FORMULA, MAX_OUT])
    try:
        out, _ = p.communicate(data, timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        p.kill()
        p.communicate()
        return None
    except BaseException:
        p.kill()
        raise
    if p.returncode != 0:
        return None
    return _sheets(out, book)


class _Worker:
    """The kept node process (calc_worker.js) and the thread that reads its answers."""

    def __init__(self, node: str, key: tuple):
        self.key = key
        self.p = _popen(node, [WORKER, RUNNER, FORMULA, MAX_OUT])
        self.answers: queue.Queue = queue.Queue()
        self.used = time.monotonic()
        self.dead = False
        threading.Thread(target=self._read, daemon=True, name="hermes-artifacts-calc-read").start()
        threading.Thread(target=self._reap, daemon=True, name="hermes-artifacts-calc-idle").start()

    def _read(self) -> None:
        out = self.p.stdout
        try:
            while True:
                line = out.readline(MAX_OUT + 2)
                self.answers.put(line or None)
                if not line:
                    return
        except Exception:
            self.answers.put(None)

    def _reap(self) -> None:
        while not self.dead:
            time.sleep(min(IDLE / 4, 15.0))
            if not self.dead and time.monotonic() - self.used > IDLE and _LOCK.acquire(blocking=False):
                try:
                    if time.monotonic() - self.used > IDLE:
                        self.stop()
                        if _state.get("worker") is self:
                            _state["worker"] = None
                finally:
                    _LOCK.release()

    def ask(self, data: bytes) -> tuple:
        """("ok", line) | ("timeout", None) | ("dead", None): what became of one workbook."""
        self.used = time.monotonic()
        try:
            self.p.stdin.write(data + b"\n")
            self.p.stdin.flush()
        except (OSError, ValueError):
            return "dead", None
        try:
            line = self.answers.get(timeout=TIMEOUT)
        except queue.Empty:
            return "timeout", None
        finally:
            self.used = time.monotonic()
        if line is None:
            return "dead", None
        if not line.endswith(b"\n"):  # over MAX_OUT: the rest of it would be read as the next answer
            return "timeout", None
        return "ok", line

    def stop(self) -> None:
        self.dead = True
        try:
            self.p.kill()
        except OSError:
            pass
        for s in (self.p.stdin, self.p.stdout):
            try:
                s.close()
            except Exception:
                pass
        try:
            self.p.wait(timeout=5)
        except Exception:
            pass


_LOCK = threading.Lock()  # one computation at a time in the kept process
WAIT_KEPT = 0.1  # seconds a computation waits for the kept process before starting one of its own
_state: dict = {"worker": None, "off_until": 0.0}


def shutdown() -> None:
    """End the kept process (plugin unload, exit). The next computation starts a new one."""
    with _LOCK:
        w, _state["worker"] = _state["worker"], None
        if w is not None:
            w.stop()


atexit.register(shutdown)


def _key(node: str) -> tuple:
    """What the kept process was started with: another node, runner, engine (a plugin update), output or heap
    limit starts a new one."""
    def stamp(p: Path):
        try:
            s = os.stat(p)
            return s.st_mtime_ns, s.st_size
        except OSError:
            return None
    return node, str(RUNNER), stamp(RUNNER), str(FORMULA), stamp(FORMULA), stamp(WORKER), MAX_OUT, MAX_HEAP_MB


def _kept(node: str, data: bytes, book: list) -> tuple:
    """Run on the kept process: (handled, result). Not handled: it could not be started, or it died on this
    workbook (then one-shot processes are used for RETRY_WORKER seconds). Busy with another sheet for longer
    than WAIT_KEPT: not handled (a one-shot process computes this one meanwhile)."""
    if not _LOCK.acquire(timeout=WAIT_KEPT):
        return False, None
    try:
        if time.monotonic() < _state["off_until"]:
            return False, None
        key = _key(node)
        w = _state["worker"]
        if w is not None and (w.dead or w.key != key or w.p.poll() is not None):
            w.stop()
            w = _state["worker"] = None
        if w is None:
            try:
                w = _state["worker"] = _Worker(node, key)
            except Exception:
                _state["off_until"] = time.monotonic() + RETRY_WORKER
                return False, None
        how, line = w.ask(data)
        if how != "ok":
            w.stop()
            _state["worker"] = None
            if how == "dead":
                _state["off_until"] = time.monotonic() + RETRY_WORKER
                return False, None
            return True, None  # a timeout: as a one-shot process that ran out of time
    finally:
        _LOCK.release()
    ans = json.loads(line.decode("utf-8"))
    if not isinstance(ans, dict) or "err" in ans:
        return True, None  # the runner refused it (bad input, output too big): as its exit code did
    return True, _sheets(line.rstrip(b"\n"), book)


def run(book: list, locale: str = "en") -> Optional[list]:
    """``book``: [{"name", "cells": {A1: raw}, "charts": [anchor, ...]}] -> the computed values of
    the formula cells, one {A1: value} per sheet in the same order; None when it could not be done."""
    node = node_path()
    if not node:
        return None
    try:
        data = json.dumps({"locale": locale, "sheets": book}, separators=(",", ":")).encode("utf-8")
        handled, res = _kept(node, data, book)
        if handled:
            return res
        return _once(node, data, book)
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
