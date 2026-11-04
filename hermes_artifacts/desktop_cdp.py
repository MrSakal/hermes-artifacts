"""Attach to Hermes Desktop over CDP, or launch it with a debugging port.

Facts this relies on (verified 2026-11-04, see docs/claude-desktop-artifacts.md):
- Packaged Hermes.exe honours a raw ``--remote-debugging-port`` argv switch: the app's own
  ``dev-cdp.ts`` gate only controls the *env-driven* port, and main.ts never filters argv.
- Hermes holds a single-instance lock, so a second launch with the flag is forwarded to the
  running instance and exits; a running instance without a port cannot gain one. That case
  needs a restart, which this module never does on its own (``restart=True`` is explicit).

The port is always bound to 127.0.0.1.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

DEFAULT_PORT = 9222


@dataclass
class CdpStatus:
    state: str  # attached | launched | running-without-port | not-installed | failed
    port: int
    cdp_url: Optional[str] = None  # http endpoint for browser.cdp_url / BROWSER_CDP_URL
    ws_url: Optional[str] = None
    browser: Optional[str] = None
    exe: Optional[str] = None
    pages: Optional[list] = None
    message: str = ""

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)


def _get_json(url: str, timeout: float = 1.5):
    with urllib.request.urlopen(url, timeout=timeout) as r:  # loopback only
        return json.loads(r.read().decode("utf-8"))


def probe(port: int = DEFAULT_PORT) -> Optional[dict]:
    """Return /json/version of whatever listens on 127.0.0.1:port, or None."""
    try:
        return _get_json(f"http://127.0.0.1:{port}/json/version")
    except (urllib.error.URLError, OSError, ValueError):
        return None


def list_pages(port: int) -> list:
    try:
        return [
            {"id": t.get("id"), "title": t.get("title"), "url": t.get("url")}
            for t in _get_json(f"http://127.0.0.1:{port}/json/list")
            if t.get("type") == "page"
        ]
    except (urllib.error.URLError, OSError, ValueError):
        return []


def _is_hermes(version: dict) -> bool:
    ua = (version.get("User-Agent") or "") + " " + (version.get("Browser") or "")
    return "hermes" in ua.lower()


def _running_hermes_exes() -> list[str]:
    if sys.platform != "win32":
        try:
            out = subprocess.run(["pgrep", "-af", "[Hh]ermes"], capture_output=True, text=True).stdout
        except FileNotFoundError:
            return []
        return [line.split(" ", 1)[1].split(" ")[0] for line in out.splitlines() if " " in line]
    ps = (
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; "
        "Get-Process -Name Hermes -ErrorAction SilentlyContinue | "
        "Select-Object -ExpandProperty Path -Unique"
    )
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
        ).stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    return [p.strip() for p in out.splitlines() if p.strip()]


def _install_candidates() -> list[Path]:
    candidates = []
    local = os.environ.get("LOCALAPPDATA")
    if local:
        candidates += [
            Path(local) / "hermes/hermes-agent/apps/desktop/release/win-unpacked/Hermes.exe",
            Path(local) / "Programs/Hermes/Hermes.exe",
        ]
    candidates += [Path("/Applications/Hermes.app/Contents/MacOS/Hermes"),
                   Path.home() / "Applications/Hermes.app/Contents/MacOS/Hermes"]
    return candidates


def desktop_installed() -> bool:
    """Cheap check (no process scan) used as the tool's check_fn: is Hermes Desktop on this machine?"""
    env = os.environ.get("HERMES_DESKTOP_EXE")
    return bool((env and Path(env).is_file()) or any(c.is_file() for c in _install_candidates())
                or shutil.which("Hermes") or shutil.which("hermes-desktop"))


def find_hermes_exe() -> Optional[str]:
    """HERMES_DESKTOP_EXE, then the running process, then the usual install paths."""
    env = os.environ.get("HERMES_DESKTOP_EXE")
    if env and Path(env).is_file():
        return env
    running = _running_hermes_exes()
    if running:
        return running[0]
    for c in _install_candidates():
        if c.is_file():
            return str(c)
    return shutil.which("Hermes") or shutil.which("hermes-desktop")


def _stop_hermes(timeout: float = 15.0) -> None:
    if sys.platform == "win32":
        # Graceful first (WM_CLOSE), then force.
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-Process -Name Hermes -EA SilentlyContinue | % { $_.CloseMainWindow() | Out-Null }"],
            capture_output=True, timeout=20,
        )
        deadline = time.time() + timeout
        while time.time() < deadline and _running_hermes_exes():
            time.sleep(0.5)
        if _running_hermes_exes():
            subprocess.run(["taskkill", "/IM", "Hermes.exe", "/T", "/F"], capture_output=True)
    else:
        subprocess.run(["pkill", "-TERM", "-x", "Hermes"], capture_output=True)
        time.sleep(2)


def _attached(port: int, version: dict, exe: Optional[str], state: str, msg: str) -> CdpStatus:
    return CdpStatus(
        state=state, port=port, cdp_url=f"http://127.0.0.1:{port}",
        ws_url=version.get("webSocketDebuggerUrl"), browser=version.get("Browser"),
        exe=exe, pages=list_pages(port), message=msg,
    )


def ensure_desktop_cdp(port: int = DEFAULT_PORT, restart: bool = False,
                       wait_s: float = 30.0) -> CdpStatus:
    """Attach if Hermes Desktop already exposes CDP on ``port``; otherwise launch it with one.

    A running Hermes without the port is reported as ``running-without-port`` and left alone
    unless ``restart=True``.
    """
    version = probe(port)
    if version is not None:
        if _is_hermes(version):
            return _attached(port, version, None, "attached", "Hermes Desktop already exposes CDP.")
        return CdpStatus(state="failed", port=port, browser=version.get("Browser"),
                         message=f"Port {port} is taken by a non-Hermes browser; pick another port.")

    exe = find_hermes_exe()
    if not exe:
        return CdpStatus(state="not-installed", port=port,
                         message="Hermes Desktop not found; set HERMES_DESKTOP_EXE.")

    if _running_hermes_exes():
        if not restart:
            return CdpStatus(state="running-without-port", port=port, exe=exe,
                             message="Hermes Desktop runs without a debugging port. "
                                     "Restart it with one (restart=True / --restart).")
        _stop_hermes()

    flags = [f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1"]
    kwargs = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "close_fds": True}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([exe, *flags], **kwargs)

    deadline = time.time() + wait_s
    while time.time() < deadline:
        version = probe(port)
        if version is not None:
            return _attached(port, version, exe, "launched", "Hermes Desktop started with CDP.")
        time.sleep(0.5)
    return CdpStatus(state="failed", port=port, exe=exe,
                     message=f"Started Hermes but nothing answered on 127.0.0.1:{port} in {wait_s:.0f}s.")


if __name__ == "__main__":  # python -m hermes_artifacts.desktop_cdp [--port N] [--restart]
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--restart", action="store_true")
    a = ap.parse_args()
    print(ensure_desktop_cdp(a.port, a.restart).to_json())
