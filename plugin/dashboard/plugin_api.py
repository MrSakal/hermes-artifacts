"""REST backend for the desktop Artifacts page, mounted at /api/plugins/hermes-artifacts/ (ctx.rest).

Works when Hermes Desktop talks to a remote Hermes server: the page fetches the artifact HTML (with
the bridge already injected) through this API and renders it as a data: URL in a SandboxedFrame,
so no extra port has to be reachable from the desktop.

Hermes mounts this router once, when its web server starts; a plugin update does not replace it. So
the router is one fixed catch-all route, and the routes themselves live in ``hermes_artifacts/api.py``,
which is reloaded (with the modules it uses) whenever one of the package's files changes on disk.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import sys
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

_PKG = _ROOT / "hermes_artifacts"
# Reload order: dependencies first.
_MODULES = ("hermes_artifacts.store", "hermes_artifacts.docs", "hermes_artifacts.bundle", "hermes_artifacts.render",
            "hermes_artifacts.server", "hermes_artifacts.live", "hermes_artifacts.api")
_lock = threading.Lock()
_stamp = None

router = APIRouter()


def _code_stamp() -> tuple:
    return tuple(sorted((p.name, p.stat().st_mtime_ns) for p in _PKG.glob("*.py")))


def _api():
    """The api module, reloaded when the plugin's Python files changed (a plugin update)."""
    global _stamp
    with _lock:
        now = _code_stamp()
        if _stamp is None:
            mod = importlib.import_module("hermes_artifacts.api")
        elif now != _stamp:
            for name in _MODULES:
                if name in sys.modules:
                    importlib.reload(sys.modules[name])
                else:
                    importlib.import_module(name)
            mod = sys.modules["hermes_artifacts.api"]
        else:
            mod = sys.modules["hermes_artifacts.api"]
        _stamp = now
        return mod


@router.api_route("/{path:path}", methods=["GET", "POST", "DELETE"])
async def dispatch(path: str, request: Request):
    body = None
    if request.method == "POST":
        raw = await request.body()
        if raw:
            try:
                body = json.loads(raw)
            except ValueError:
                raise HTTPException(400, "body is not JSON")
    api = _api()
    try:
        # Rendering reads files and inlines assets: keep it off the event loop.
        return await asyncio.to_thread(api.handle, request.method, path, dict(request.query_params), body)
    except api.ApiError as e:
        raise HTTPException(e.status, e.detail)
