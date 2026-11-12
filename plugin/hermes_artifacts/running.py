"""Which hermes-artifacts code the server really runs, against the version installed on disk.

``hermes plugins update`` replaces the files; a running Hermes process keeps the plugin code it imported
until it restarts (or re-discovers its plugins). More than one process may load the plugin: the gateway
(``hermes gateway``) and the backend Hermes Desktop connects to (``hermes serve`` / ``hermes dashboard``)
each run turns with its tools and hooks, and so do the plugin host (``plugins.isolation: host``) and a
turn-isolation compute host. ``hermes gateway restart`` restarts the gateway only. The REST API is no
measure either: it reloads its own copy of these modules when the files change
(``dashboard/plugin_api.py``), while the tools a process registered stay what they were.

So every process records what it loaded when ``register()`` runs, in ``.run/loaded-<pid>.json`` under
the plugin's data dir: the version, the pid, when it was written and a role from a fixed list (gateway,
serve, compute-host, plugin-host, cli); nothing else. A process rewrites its record now and then while
it is used (:func:`touch`), and a record not rewritten for ``MAX_AGE`` is dropped, so a pid reused by
another program does not keep an old record alive for long. :func:`status` reports which live
processes run which version, against the version on disk.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# The version of THIS code, fixed when the module is imported. Tests keep it equal to plugin.yaml,
# dashboard/manifest.json and PLUGIN_VERSION in desktop/plugin.js: a bump touches all four.
VERSION = "0.16.2"

ROLES = ("gateway", "serve", "compute-host", "plugin-host", "cli")
MAX_AGE = 7 * 86400  # a record not rewritten for a week is ignored and removed
REFRESH = 300  # a process in use rewrites its record at most this often
_TMP_MAX_AGE = 3600  # a temp file older than this is a writer that died mid-write

_YAML = Path(__file__).resolve().parent.parent / "plugin.yaml"
_YAML_VERSION = re.compile(r"""^version:[ \t]*["']?([0-9A-Za-z.+-]{1,40})["']?[ \t]*\r?$""", re.M)
_VALID = re.compile(r"[0-9A-Za-z.+-]{1,40}")
_written = {"base": None, "at": 0.0}  # this process's last record: where and when


def disk_version() -> Optional[str]:
    """The version plugin.yaml says now (read on every call: an update rewrites it)."""
    try:
        m = _YAML_VERSION.search(_YAML.read_text("utf-8"))
    except (OSError, UnicodeDecodeError):
        return None
    return m.group(1) if m else None


def version_key(v: str) -> tuple:
    """Orders versions by their numbers: 0.9.2 < 0.16.1."""
    return tuple(int(n) for n in re.findall(r"\d+", v))


def _alive(pid: int) -> bool:
    """Whether a process with this pid exists (any program: a reused pid is handled by MAX_AGE)."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        # Not os.kill(pid, 0): on Windows signal 0 is CTRL_C_EVENT, sent to the pid's console group.
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        k32.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        k32.CloseHandle.argtypes = (wintypes.HANDLE,)
        h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return ctypes.get_last_error() == 5  # access denied: it exists, owned by someone else
        try:
            code = wintypes.DWORD()
            return bool(k32.GetExitCodeProcess(h, ctypes.byref(code))) and code.value == 259  # STILL_ACTIVE
        finally:
            k32.CloseHandle(h)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:  # EPERM: it exists, owned by someone else
        return True
    return True


def _role() -> str:
    """Which kind of Hermes process this is, one of ROLES (read from how it was started)."""
    if os.environ.get("HERMES_COMPUTE_HOST_CHILD"):
        return "compute-host"
    argv = [str(a) for a in sys.argv if a]
    stem = Path(argv[0]).stem.lower() if argv else ""
    if stem == "plugin_host_child":
        return "plugin-host"
    if stem == "compute_host":
        return "compute-host"
    words = {a.lower() for a in argv[1:4]}
    if "gateway" in words:
        return "gateway"
    if words & {"serve", "dashboard"}:
        return "serve"
    return "cli"


def _run_dir(base: Optional[Path]) -> Path:
    if base is None:
        from . import store
        base = store.root()
    return Path(base) / ".run"  # a dot: never an artifact id (like .trash)


def _unlink(p: Path) -> None:
    try:
        p.unlink()
    except OSError:
        pass


def _live(d: Path) -> list[dict]:
    """The records of processes still running; removes the rest (gone, too old, unreadable)."""
    out = []
    try:
        entries = list(d.iterdir())
    except OSError:
        return out
    now = time.time()
    for p in entries:
        name = p.name
        if name.startswith(".loaded-") and name.endswith(".tmp"):
            try:
                if now - p.stat().st_mtime > _TMP_MAX_AGE:
                    _unlink(p)
            except OSError:
                pass
            continue
        if not (name.startswith("loaded-") and name.endswith(".json")):
            continue
        try:
            r = json.loads(p.read_text("utf-8"))
            ok = (isinstance(r, dict) and isinstance(r.get("version"), str) and _VALID.fullmatch(r["version"])
                  and type(r.get("pid")) is int and type(r.get("at")) in (int, float) and r.get("role") in ROLES
                  and name == f"loaded-{r['pid']}.json")
        except (OSError, ValueError):
            ok = False
        if not ok or now - r["at"] > MAX_AGE or not _alive(r["pid"]):
            _unlink(p)
            continue
        out.append(r)
    return out


def record(base: Optional[Path] = None) -> None:
    """Note that this process runs VERSION (``register()``, and :func:`touch`). Never raises."""
    try:
        d = _run_dir(base)
        d.mkdir(parents=True, exist_ok=True)
        pid = os.getpid()
        now = time.time()
        data = {"version": VERSION, "pid": pid, "at": int(now), "role": _role()}
        tmp = d / f".loaded-{pid}.tmp"
        tmp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(tmp, d / f"loaded-{pid}.json")
        _written.update(base=base, at=now)
        _live(d)  # prune the gone while here
    except Exception:
        logger.debug("could not record the loaded version", exc_info=True)


def touch() -> None:
    """While the process is used (a turn, a publish): rewrite its record when it is REFRESH old. Cheap."""
    if time.time() - _written["at"] >= REFRESH:
        record(_written["base"])


def status(base: Optional[Path] = None) -> dict:
    """{loaded, disk, stale, processes}. ``processes``: [{role, version}] of every live recorder (no
    pids). ``loaded``: the oldest version a live process runs that is not the one on disk, else the
    oldest live one, else None. ``stale``: some live process runs other code than the files on disk."""
    disk = disk_version()
    try:
        live = _live(_run_dir(base))
    except Exception:
        logger.debug("could not read the loaded versions", exc_info=True)
        live = []
    procs = sorted(({"role": r["role"], "version": r["version"]} for r in live),
                   key=lambda x: (version_key(x["version"]), x["role"]))
    off = [x["version"] for x in procs if disk and x["version"] != disk]
    pick = off or [x["version"] for x in procs]
    return {"loaded": pick[0] if pick else None, "disk": disk, "stale": bool(off), "processes": procs}


_ADVICE = {
    "gateway": "restart the gateway (hermes gateway restart)",
    "serve": ("restart the Hermes backend Desktop connects to (hermes serve / hermes dashboard); "
              "hermes gateway restart alone does not"),
}


def restart_note() -> Optional[str]:
    """For ha_publish: one line when THIS process runs other code than the files on disk, else None."""
    disk = disk_version()
    if not disk or disk == VERSION:
        return None
    role = _role()
    advice = _ADVICE.get(role, "restart Hermes on the server entirely")
    return (f"Server restart pending: this Hermes process ({role}) runs hermes-artifacts {VERSION}, "
            f"{disk} installed. Tell the user to {advice}.")
