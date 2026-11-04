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

from hermes_artifacts import store  # noqa: E402
from hermes_artifacts.server import inject_bridge  # noqa: E402

router = APIRouter()


def _view(m: dict) -> dict:
    return {"id": m["id"], "title": m["title"], "version": m["versions"][-1]["n"],
            "versions": [x["n"] for x in m["versions"]], "updated": m.get("updated"),
            "description": m.get("description", "")}


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
def get_html(aid: str, v: Optional[int] = None):
    _meta(aid)
    try:
        html = store.read_html(aid, v)
    except FileNotFoundError:
        raise HTTPException(404, "unknown version")
    return {"id": aid, "version": v, "html": inject_bridge(html.encode("utf-8")).decode("utf-8")}


class Op(BaseModel):
    op: str
    args: dict[str, Any] = {}


@router.post("/artifacts/{aid}/op")
def bridge_op(aid: str, body: Op):
    a = body.args
    try:
        if body.op == "storage.get":
            return {"value": store.kv_all(aid).get(a.get("key"))}
        if body.op == "storage.list":
            return {"keys": sorted(store.kv_all(aid))}
        if body.op == "storage.set":
            store.kv_set(aid, a.get("key"), a.get("value"))
            return {"ok": True}
        if body.op == "send":
            item = store.inbox_add(aid, a.get("text", ""), a.get("data"))
            return {"ok": True, "id": item["id"]}
    except FileNotFoundError:
        raise HTTPException(404, "unknown artifact")
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))
    raise HTTPException(400, f"op {body.op!r} not allowed here")
