"""REST backend for the desktop Artifacts page, mounted at /api/plugins/hermes-artifacts/ (ctx.rest).

Works when Hermes Desktop talks to a remote Hermes server: the page fetches the artifact HTML (with
the bridge already injected) through this API and renders it as a data: URL in a SandboxedFrame,
so no extra port has to be reachable from the desktop.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from hermes_artifacts import render, store  # noqa: E402
from hermes_artifacts.server import inject_bridge  # noqa: E402

router = APIRouter()


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
        raise HTTPException(400, str(e))
    if not m:
        raise HTTPException(404, "unknown artifact")
    return m


@router.get("/artifacts")
def list_artifacts():
    return {"artifacts": [_view(m) for m in store.list_all()]}


@router.get("/artifacts/{aid}")
def get_artifact(aid: str):
    return _view(_meta(aid))


@router.get("/artifacts/{aid}/html")
def get_html(aid: str, v: Optional[int] = None, page: Optional[str] = None, thumb: bool = False):
    m = _meta(aid)
    try:
        html = render.render(m, store.version_dir(aid, v), page=page, thumb=thumb)
    except FileNotFoundError:
        raise HTTPException(404, "unknown version or page")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": aid, "version": v, "type": m.get("type", "page"),
            "html": inject_bridge(html.encode("utf-8")).decode("utf-8")}


@router.get("/artifacts/{aid}/files")
def get_files(aid: str, v: Optional[int] = None):
    _meta(aid)
    try:
        return {"files": store.list_files(aid, v)}
    except FileNotFoundError:
        raise HTTPException(404, "unknown version")


class MetaPatch(BaseModel):
    title: Optional[str] = None
    pinned: Optional[bool] = None


@router.post("/artifacts/{aid}/meta")
def patch_meta(aid: str, body: MetaPatch):
    _meta(aid)
    return _view(store.update_meta(aid, title=body.title, pinned=body.pinned))


@router.delete("/artifacts/{aid}")
def delete_artifact(aid: str):
    _meta(aid)
    store.delete(aid)
    return {"ok": True}


@router.get("/artifacts/{aid}/comments")
def get_comments(aid: str):
    _meta(aid)
    return {"comments": store.comments_list(aid)}


class CommentIn(BaseModel):
    text: str
    anchor: Optional[dict] = None
    parent: Optional[str] = None
    version: Optional[int] = None


@router.post("/artifacts/{aid}/comments")
def add_comment(aid: str, body: CommentIn):
    _meta(aid)
    try:
        return store.comment_add(aid, body.text, author="user", anchor=body.anchor,
                                 parent=body.parent, version=body.version)
    except ValueError as e:
        raise HTTPException(400, str(e))


class Resolve(BaseModel):
    resolved: bool = True


@router.post("/artifacts/{aid}/comments/{cid}/resolve")
def resolve_comment(aid: str, cid: str, body: Resolve):
    _meta(aid)
    try:
        return store.comment_resolve(aid, cid, body.resolved)
    except FileNotFoundError:
        raise HTTPException(404, "unknown comment")


_VENDOR = Path(render.TYPES_DIR / "vendor")


@router.get("/vendor/{name}")
def vendor(name: str):
    """Big export libraries a type runtime loads on demand (only files in types/vendor/)."""
    p = (_VENDOR / name).resolve()
    if p.parent != _VENDOR.resolve() or not p.is_file() or p.suffix != ".js":
        raise HTTPException(404, "unknown asset")
    return {"name": name, "text": p.read_text("utf-8")}


# What a typed artifact's own viewer may write back (its editor saving a change), per type.
_SAVE_PATHS = {"slides": r"^(deck\.json|slides/[A-Za-z0-9_-]{1,64}\.html)$", "doc": r"^doc\.md$"}


class Op(BaseModel):
    op: str
    args: dict[str, Any] = {}


@router.post("/artifacts/{aid}/op")
def bridge_op(aid: str, body: Op):
    """Operations an artifact page asks for through the bridge. The page is untrusted: only these."""
    a = body.args
    try:
        if body.op == "storage.get":
            return {"value": store.kv_all(aid).get(a.get("key"))}
        if body.op == "storage.list":
            return {"keys": sorted(store.kv_all(aid))}
        if body.op == "storage.set":
            store.kv_set(aid, a.get("key"), a.get("value"))
            return {"ok": True}
        if body.op in ("send", "ask"):
            item = store.inbox_add(aid, a.get("text", ""), a.get("data"), kind=body.op)
            return {"ok": True, "id": item["id"]}
        if body.op == "save":
            import re
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
        if body.op == "reply.get":
            return {"reply": store.reply_get(aid, str(a.get("request", "")))}
    except FileNotFoundError:
        raise HTTPException(404, "unknown artifact")
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))
    raise HTTPException(400, f"op {body.op!r} not allowed here")
