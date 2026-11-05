"""The plugin's REST API, as plain functions behind one dispatcher.

``dashboard/plugin_api.py`` mounts a single catch-all route that calls :func:`handle`. Hermes mounts a
plugin's router once, when its web server starts, and an update never replaces it; keeping the router
fixed and this module reloadable makes a plugin update take effect without restarting the server.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

from . import live, render, store
from .server import inject_bridge


def require_approval() -> bool:
    """The plugin setting: true makes every live query wait for the user's click, even ones the
    agent published or the user saved. Read from Hermes' config; off when it can't be read."""
    try:
        from hermes_cli.config import load_config_readonly
        cfg = load_config_readonly() or {}
        v = (((cfg.get("plugins") or {}).get("entries") or {}).get("hermes-artifacts") or {}).get("settings", {}).get("require_approval")
        return v is True or str(v).lower() in ("true", "1", "yes")
    except Exception:
        return False


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _view(m: dict) -> dict:
    return {"id": m["id"], "title": m["title"], "type": m.get("type", "page"),
            "version": m["versions"][-1]["n"], "versions": [x["n"] for x in m["versions"]],
            "created": m.get("created"), "updated": m.get("updated"),
            "description": m.get("description", ""), "pinned": bool(m.get("pinned")),
            "session": m.get("session"),
            "comments": sum(1 for c in store.comments_list(m["id"], include_resolved=False)
                            if c["author"] == "user")}


def _meta(aid: str) -> dict:
    try:
        m = store.get_meta(aid)
    except ValueError as e:
        raise ApiError(400, str(e))
    if not m:
        raise ApiError(404, "unknown artifact")
    return m


def _int(v) -> Optional[int]:
    if v in (None, ""):
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        raise ApiError(400, f"not a number: {v!r}")


_VENDOR = Path(render.TYPES_DIR / "vendor")
# What a typed artifact's own viewer may write back (its editor saving a change), per type.
_SAVE_PATHS = {"slides": r"^(deck\.json|slides/[A-Za-z0-9_-]{1,64}\.html)$", "doc": r"^doc\.md$"}


def _op(aid: str, op: str, a: dict) -> dict:
    """Operations an artifact page asks for through the bridge. The page is untrusted: only these."""
    if op == "storage.get":
        return {"value": store.kv_all(aid).get(a.get("key"))}
    if op == "storage.list":
        return {"keys": sorted(store.kv_all(aid))}
    if op == "storage.set":
        store.kv_set(aid, a.get("key"), a.get("value"))
        return {"ok": True}
    if op in ("send", "ask"):
        item = store.inbox_add(aid, a.get("text", ""), a.get("data"), kind=op)
        return {"ok": True, "id": item["id"]}
    if op == "save":
        m = _meta(aid)
        pat = _SAVE_PATHS.get(m.get("type", "page"))
        files = a.get("files")
        if not pat or not isinstance(files, dict) or not files:
            raise ValueError("this artifact can't save from its page")
        for rel, val in files.items():
            if not re.match(pat, str(rel)) or not (val is None or isinstance(val, str)):
                raise ValueError(f"can't save {rel!r} here")
        if a.get("base_version") and a["base_version"] != m["versions"][-1]["n"]:
            return {"ok": False, "conflict": True, "version": m["versions"][-1]["n"]}
        nm = store.publish(aid=aid, base=True, files=files)
        return {"ok": True, "version": nm["versions"][-1]["n"]}
    if op == "dataset.run":
        params = a.get("params") if isinstance(a.get("params"), dict) else {}
        return live.run_dataset(aid, str(a.get("id", "")), params, force=bool(a.get("force")),
                                version=_int(a.get("version")))
    if op in ("dataset.approve", "dataset.decline"):
        # The page names a dataset; what gets approved is the call stored in the artifact, never one
        # the page describes. The host only forwards this on a user gesture.
        d = live.dataset(aid, str(a.get("id", "")), _int(a.get("version")))
        cid = live.call_id(d["tool"], d["args"], d["rules"])
        store.set_approval(aid, cid, d["tool"], op == "dataset.approve")
        return {"ok": True, "call": cid, "allowed": op == "dataset.approve"}
    if op == "dataset.edit":
        return live.edit_args(aid, str(a.get("id", "")), a.get("args"), _int(a.get("base_version")),
                              auto_approve=not require_approval())
    if op == "reply.get":
        return {"reply": store.reply_get(aid, str(a.get("request", "")))}
    raise ApiError(400, f"op {op!r} not allowed here")


def handle(method: str, path: str, query: dict, body: Any) -> Any:
    """Route one request. ``path`` is relative to /api/plugins/hermes-artifacts/."""
    parts = [p for p in path.strip("/").split("/") if p]
    body = body if isinstance(body, dict) else {}
    try:
        if parts == ["artifacts"] and method == "GET":
            return {"artifacts": [_view(m) for m in store.list_all()]}
        if len(parts) == 2 and parts[0] == "vendor" and method == "GET":
            p = (_VENDOR / parts[1]).resolve()
            if p.parent != _VENDOR.resolve() or not p.is_file() or p.suffix != ".js":
                raise ApiError(404, "unknown asset")
            return {"name": parts[1], "text": p.read_text("utf-8")}
        if len(parts) >= 2 and parts[0] == "artifacts":
            aid, rest = parts[1], parts[2:]
            if not rest:
                if method == "GET":
                    return _view(_meta(aid))
                if method == "DELETE":
                    _meta(aid)
                    store.delete(aid)
                    return {"ok": True}
            elif rest == ["html"] and method == "GET":
                m = _meta(aid)
                try:
                    html = render.render(m, store.version_dir(aid, _int(query.get("v"))), page=query.get("page") or None,
                                         thumb=str(query.get("thumb", "")).lower() in ("1", "true", "yes"),
                                         lang=str(query.get("lang") or "")[:8])
                except FileNotFoundError:
                    raise ApiError(404, "unknown version or page")
                return {"id": aid, "version": _int(query.get("v")), "type": m.get("type", "page"),
                        "html": inject_bridge(html.encode("utf-8")).decode("utf-8")}
            elif rest == ["files"] and method == "GET":
                _meta(aid)
                try:
                    return {"files": store.list_files(aid, _int(query.get("v")))}
                except FileNotFoundError:
                    raise ApiError(404, "unknown version")
            elif rest == ["meta"] and method == "POST":
                _meta(aid)
                return _view(store.update_meta(aid, title=body.get("title"), pinned=body.get("pinned")))
            elif rest == ["comments"] and method == "GET":
                _meta(aid)
                return {"comments": store.comments_list(aid)}
            elif rest == ["comments"] and method == "POST":
                _meta(aid)
                return store.comment_add(aid, str(body.get("text", "")), author="user", anchor=body.get("anchor"),
                                         parent=body.get("parent"), version=_int(body.get("version")))
            elif len(rest) == 3 and rest[0] == "comments" and rest[2] == "resolve" and method == "POST":
                _meta(aid)
                return store.comment_resolve(aid, rest[1], bool(body.get("resolved", True)))
            elif rest == ["op"] and method == "POST":
                return _op(aid, str(body.get("op", "")), body.get("args") if isinstance(body.get("args"), dict) else {})
    except ApiError:
        raise
    except live.LiveError as e:
        raise ApiError(404 if e.status == "missing" else 400, e.message)
    except FileNotFoundError as e:
        raise ApiError(404, f"not found: {e}")
    except (ValueError, TypeError) as e:
        raise ApiError(400, str(e))
    raise ApiError(404, "Not Found")
