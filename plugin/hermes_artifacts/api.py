"""The plugin's REST API, as plain functions behind one dispatcher.

``dashboard/plugin_api.py`` mounts a single catch-all route that calls :func:`handle`. Hermes mounts a
plugin's router once, when its web server starts, and an update never replaces it; keeping the router
fixed and this module reloadable makes a plugin update take effect without restarting the server.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from . import boards, docs, history, live, render, running, sheets, store
from .server import inject_bridge


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _view(m: dict, base=None) -> dict:
    return {"id": m["id"], "title": m["title"], "type": m.get("type", "page"),
            "version": m["versions"][-1]["n"], "versions": [x["n"] for x in m["versions"]],
            "created": m.get("created"), "updated": m.get("updated"),
            "description": m.get("description", ""), "pinned": bool(m.get("pinned")),
            "session": m.get("session"), "folder": m.get("folder") or None, "opened": m.get("opened"),
            "comments": store.open_user_comments(m["id"], base),
            **({"preview": True} if store.preview_path(m["id"], m["versions"][-1]["n"], base).is_file() else {})}


def chat_status(session: Optional[str]) -> dict:
    """The artifact's chat, as Claude's Chat button decides: open it while it exists and is not
    archived, else start a new chat that refers to the artifact. ``known`` is false when Hermes'
    session store can't be read here (the desktop then asks the gateway)."""
    if not session:
        return {"session": None, "known": True, "exists": False, "archived": False}
    try:
        from hermes_state import SessionDB
        db = SessionDB(read_only=True)
        try:
            row = db.get_session_list_row(session)
        finally:
            try:
                db.close()
            except Exception:
                pass
    except Exception:
        return {"session": session, "known": False, "exists": None, "archived": None}
    return {"session": session, "known": True, "exists": bool(row), "archived": bool(row and row.get("archived"))}


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


_VENDOR = render.TYPES_DIR / "vendor"
# What a typed artifact's own viewer may write back (its editor saving a change), per type.
_SAVE_PATHS = {"slides": r"^(deck\.json|slides/[A-Za-z0-9_-]{1,64}\.html|img/[A-Za-z0-9_-]{1,64}\.(png|jpe?g|gif|webp))$",
               "doc": r"^doc\.md$",
               # Dashboard: the editor (page text, cards), Design (dashboard.json look), a replaced data file, drafts.
               "dashboard": r"^(dashboard\.json|[A-Za-z0-9_-]{1,64}\.(html|css|js)|data/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\.(csv|tsv|json)"
                            r"|drafts/[A-Za-z0-9_-]{1,40}/[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.(html|css|js|json))$",
               # Design: the index, artboard sources (the canvas edits text, styles, positions, tweaks) and uploads.
               "design": r"^(canvas\.json|[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}(/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}){0,3}\.dc\.html"
                         r"|uploads/[A-Za-z0-9_-]{1,64}\.(png|jpe?g|gif|webp))$",
               # Model: the model and the meshes brought in (a data: URL of any type, stored as the file).
               "model": r"^(model\.json|meshes/[A-Za-z0-9_-]{1,64}\.(glb|gltf|stl|obj|ply|3mf))$",
               # Motion: the page's own records of what the user retyped, recolored, refaced or recut.
               "motion": r"^modules/(retyped|recolored|refaced|recut|retouched)\.json$",
               # Design System: tokens, the brand book, component guidelines, asset uploads.
               "design-system": r"^(design-system\.json|tokens\.json|README\.md|[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.md"
                                r"|components/[A-Za-z_][A-Za-z0-9_]{0,63}/README\.md"
                                r"|assets/[A-Za-z0-9][A-Za-z0-9_-]{0,63}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.(png|jpe?g|gif|webp|svg)"
                                r"|fonts/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.(woff2?|ttf|otf))$"}
_IMG_PATH = re.compile(r"\.(png|jpe?g|gif|webp)$", re.I)
# An image the slide editor uploads: a data: URI of one of these, stored as the binary file.
_IMG_URI = re.compile(r"^data:image/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$")
# A font the Design System page uploads (Typography, Upload font).
_FONT_PATH = re.compile(r"\.(woff2?|ttf|otf)$", re.I)
_FONT_URI = re.compile(r"^data:(?:font/[a-z0-9.+-]+|application/(?:font-woff2?|x-font-[a-z]+|vnd\.ms-opentype|octet-stream));base64,([A-Za-z0-9+/=]+)$")
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
# A mesh the model page brings in: any data: URL (browsers name these types inconsistently).
_MESH_PATH = re.compile(r"^meshes/.+\.(glb|gltf|stl|obj|ply|3mf)$", re.I)
_ANY_URI = re.compile(r"^data:[^,]*;base64,([A-Za-z0-9+/=]+)$")
# An SVG the Design System page uploads (Assets): text or a base64 data: URI, kept only when static.
_SVG_PATH = re.compile(r"\.svg$", re.I)
_safe_svg = store.safe_svg  # shared with boards.py (a drawing's SVG)


_DS_PARTS = ("tokens.json", "components/bundle.css", "README.md")  # with fonts/: what another artifact wears


def design_system(dsid: Optional[str], version: Optional[int] = None) -> dict:
    """A design system for another artifact to wear: tokens.json, components/bundle.css, its fonts as
    data: URIs, README. None: the default one (or {"none": true}). `version`: the one the artifact was
    built on (an artifact keeps wearing it until it is moved on); a version no longer kept: the latest."""
    dsid = dsid or store.settings().get("default_design_system")
    m = store.get_meta(dsid) if dsid else None
    if not m or m.get("type") != "design-system":
        return {"none": True}
    kept = [v["n"] for v in m["versions"]]
    n = int(version) if isinstance(version, int) and not isinstance(version, bool) and version in kept else kept[-1]
    vdir = store.version_dir(dsid, n)
    files = render.content_json(vdir, lambda rel: rel.startswith("fonts/") or rel in _DS_PARTS)
    try:
        tokens = json.loads(files.get("tokens.json") or "{}")
    except ValueError:
        tokens = {}
    fonts = {k: v for k, v in files.items() if k.startswith("fonts/")}
    return {"id": dsid, "title": m.get("title", dsid), "version": n, "latest": kept[-1], "tokens": tokens,
            "css": files.get("components/bundle.css", ""), "fonts": fonts, "readme": files.get("README.md", "")}


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
        out = {}
        for rel, val in files.items():
            if not re.match(pat, str(rel)) or not (val is None or isinstance(val, str)):
                raise ValueError(f"can't save {rel!r} here")
            if _MESH_PATH.match(str(rel)) and val is not None:
                from .models import MAX_MESH_BYTES
                mm = _ANY_URI.match(val)
                if not mm or len(mm.group(1)) * 3 // 4 > MAX_MESH_BYTES:
                    raise ValueError(f"{rel}: a mesh file (glb, gltf, stl, obj, ply or 3mf) of at most 12 MB, as a data: URL")
                val = {"base64": mm.group(1)}
            elif _SVG_PATH.search(str(rel)) and val is not None:
                val = _safe_svg(str(rel), val)  # only design-system assets match .svg in _SAVE_PATHS
            elif _IMG_PATH.search(str(rel)) and val is not None:
                im = _IMG_URI.match(val)
                if not im or len(im.group(2)) * 3 // 4 > MAX_UPLOAD_BYTES:
                    raise ValueError(f"{rel}: an image (png, jpeg, gif or webp) of at most 8 MB")
                val = {"base64": im.group(2)}
            elif _FONT_PATH.search(str(rel)) and val is not None:
                fm = _FONT_URI.match(val)
                if not fm or len(fm.group(1)) * 3 // 4 > MAX_UPLOAD_BYTES:
                    raise ValueError(f"{rel}: a font file (woff2, woff, ttf or otf) of at most 8 MB")
                val = {"base64": fm.group(1)}
            out[str(rel)] = val
        files = out
        if a.get("base_version") and a["base_version"] != m["versions"][-1]["n"]:
            return {"ok": False, "conflict": True, "version": m["versions"][-1]["n"]}
        nm = store.publish(aid=aid, base=True, files=files, by="user")
        return {"ok": True, "version": nm["versions"][-1]["n"]}
    if op == "preview.set":
        # A picture of the version the page shows (a model's view) for the gallery: no version, not an edit.
        v = _int(a.get("version"))
        n = store.preview_set(aid, a.get("data"), v)
        return {"ok": True, "version": n} if n is not None else {"ok": False, "stale": True}
    if op == "ds.get":
        # Any page may build on a design system (that's what one is for): its tokens, stylesheet, fonts.
        v = a.get("version")
        return design_system(str(a.get("id") or "") or None, v if isinstance(v, int) else None)
    if op == "ds.default":
        m = _meta(aid)
        if m.get("type") != "design-system":
            raise ValueError("only a design system can be made the default")
        store.settings_set("default_design_system", aid if a.get("on", True) else None)
        return {"ok": True, "default": store.settings().get("default_design_system")}
    if op == "dataset.run":
        params = a.get("params") if isinstance(a.get("params"), dict) else {}
        mode = "cached" if a.get("mode") == "cached" else "live"
        return live.run_dataset(aid, str(a.get("id", "")), params, version=_int(a.get("version")), mode=mode)
    if op == "history.list":
        return {"versions": history.versions(aid)}
    if op == "history.diff":
        return history.diff(aid, _int(a.get("version")) or 0)
    if op == "history.restore":
        return history.restore(aid, _int(a.get("version")) or 0)
    if op == "dataset.call":
        return live.loader_call(aid, str(a.get("id", "")), str(a.get("tool", "")), a.get("args"), version=_int(a.get("version")))
    if op == "dataset.approve":
        # Consent is never the page's: Hermes Desktop asks in its own dialog (the approval route below).
        raise ApiError(403, "allowing live data is Hermes Desktop's: it asks the user in its own dialog")
    if op == "dataset.decline":
        # Declining only ever takes a permission away, so the page may.
        p = live.pending(aid, str(a.get("id", "")), _int(a.get("version")), dialog=False)
        store.set_approval(aid, p["call"], p["tool"], False)
        return {"ok": True, "call": p["call"], "allowed": False}
    if op == "dataset.test":
        params = a.get("params") if isinstance(a.get("params"), dict) else {}
        return live.test_args(aid, str(a.get("id", "")), a.get("args"), params)
    if op == "dataset.history":
        return {"entries": store.history(aid, str(a.get("id", "")))[-50:]}
    if op == "dataset.edit":
        # Saved, not approved: the changed query waits for the user's yes in Hermes Desktop's dialog.
        return live.edit_args(aid, str(a.get("id", "")), a.get("args"), _int(a.get("base_version")))
    if op == "view":
        # The host adds the chat session; the context itself is the page's (data, bounded).
        store.view_set(str(a.get("session", "")), aid if not a.get("closed") else None,
                       a.get("context") if isinstance(a.get("context"), dict) else {})
        return {"ok": True}
    if op == "report":
        kind = str(a.get("kind", ""))
        store.report_set(aid, kind, a.get("data") if isinstance(a.get("data"), dict) else {})
        return {"ok": True}
    if op == "doc.read":
        return docs.read(aid, a.get("tab") or None, since_rev=_int(a.get("since_rev")))
    if op == "doc.history":
        return docs.history(aid, a.get("tab") or None)
    if op == "doc.at":
        return docs.at_rev(aid, a.get("tab") or None, _int(a.get("rev")) or 0)
    if op == "doc.restore":
        try:
            return docs.restore(aid, a.get("tab") or None, _int(a.get("rev")) or 0)
        except docs.DocError as e:
            raise ValueError(e.message)
    if op == "doc.edit":
        # The doc's own editor (the user typing). Hermes edits through its ha_live_edit tool.
        try:
            return docs.apply(aid, a.get("ops") or [], by="user", tab=a.get("tab") or None, base_rev=_int(a.get("base_rev")))
        except docs.DocError as e:
            if e.code == "conflict":
                return {"ok": False, "conflict": True, **e.extra}
            raise ValueError(e.message)
    if op in ("doc.suggest", "doc.decide", "doc.upload", "doc.file"):
        try:
            if op == "doc.suggest":
                return docs.suggest(aid, a.get("ops") or [], by="user", tab=a.get("tab") or None)
            if op == "doc.decide":
                return docs.decide(aid, str(a.get("id", "")), str(a.get("verdict", "")))
            if op == "doc.upload":
                return docs.upload(aid, str(a.get("data", "")))
            return docs.file_data(aid, str(a.get("name", "")))
        except docs.DocError as e:
            raise ValueError(e.message)
    if op == "doc.ask":
        # "@Hermes …" typed in the doc, or "Edit with Hermes" on a selection: into the chat (the host
        # words the message), and kept in the inbox with where it was asked.
        _meta(aid)
        kind = a.get("kind") if a.get("kind") in ("edit", "convert") else "ask"
        data = {"kind": kind, "tab": str(a.get("tab") or "")[:40], "blocks": [str(b)[:40] for b in (a.get("blocks") or [])][:50],
                "selection": str(a.get("selection") or "")[:2000]}
        item = store.inbox_add(aid, str(a.get("text", ""))[:4000], data, kind="doc-" + kind)
        return {"ok": True, "id": item["id"]}
    if op.startswith("sheet."):
        return _sheet_op(aid, op, a)
    if op.startswith("board."):
        return _board_op(aid, op, a)
    if op == "reply.get":
        return {"reply": store.reply_get(aid, str(a.get("request", "")))}
    raise ApiError(400, f"op {op!r} not allowed here")


def _sheet_op(aid: str, op: str, a: dict) -> dict:
    """The sheet page's own ops (the user editing). Hermes edits through ha_live_edit."""
    sheet = a.get("sheet") or None
    try:
        if op == "sheet.read":
            return sheets.with_lists(aid, sheets.read(aid, sheet, a.get("range") or None, since_rev=_int(a.get("since_rev"))))
        if op == "sheet.edit":
            try:
                return sheets.apply(aid, a.get("ops") or [], by="user", sheet=sheet, base_rev=_int(a.get("base_rev")))
            except sheets.SheetError as e:
                if e.code == "conflict":
                    return {"ok": False, "conflict": True, **e.extra}
                raise
        if op == "sheet.vals":
            return sheets.set_vals(aid, sheet, _int(a.get("rev")), a.get("vals"))
        if op == "sheet.history":
            return sheets.history(aid, sheet)
        if op == "sheet.at":
            return sheets.with_lists(aid, sheets.at_rev(aid, sheet, _int(a.get("rev")) or 0))
        if op == "sheet.restore":
            return sheets.restore(aid, sheet, _int(a.get("rev")) or 0)
    except sheets.SheetError as e:
        if e.code == "absent":
            raise FileNotFoundError(e.message)
        raise ValueError(e.message)
    if op == "sheet.ask":
        # "Ask Hermes" about a selection: into the chat (the host words the message), kept in the inbox.
        _meta(aid)
        data = {"sheet": str(a.get("sheet") or "")[:40], "range": str(a.get("range") or "")[:40],
                "selection": str(a.get("selection") or "")[:4000]}
        item = store.inbox_add(aid, str(a.get("text", ""))[:4000], data, kind="sheet-ask")
        return {"ok": True, "id": item["id"]}
    raise ApiError(400, f"op {op!r} not allowed here")


def _board_op(aid: str, op: str, a: dict) -> dict:
    """The board page's own ops (the user editing). Hermes edits through ha_live_edit."""
    try:
        if op == "board.read":
            return boards.read(aid, since_rev=_int(a.get("since_rev")))
        if op == "board.edit":
            try:
                return boards.apply(aid, a.get("ops") or [], by="user", base_rev=_int(a.get("base_rev")))
            except boards.BoardError as e:
                if e.code == "conflict":
                    return {"ok": False, "error": e.message, **e.extra}
                raise
        if op == "board.history":
            return boards.history(aid)
        if op == "board.at":
            return boards.at_rev(aid, _int(a.get("rev")) or 0)
        if op == "board.restore":
            return boards.restore(aid, _int(a.get("rev")) or 0)
    except boards.BoardError as e:
        if e.code == "absent":
            raise FileNotFoundError(e.message)
        raise ValueError(e.message)
    if op == "board.ask":
        # "Ask Hermes" about the selected items: into the chat (the host words the message), kept in the inbox.
        _meta(aid)
        data = {"ids": [str(i)[:40] for i in (a.get("ids") or [])][:50]}
        item = store.inbox_add(aid, str(a.get("text", ""))[:4000], data, kind="board-ask")
        return {"ok": True, "id": item["id"]}
    raise ApiError(400, f"op {op!r} not allowed here")


def handle(method: str, path: str, query: dict, body: Any) -> Any:
    """Route one request. ``path`` is relative to /api/plugins/hermes-artifacts/."""
    parts = [p for p in path.strip("/").split("/") if p]
    body = body if isinstance(body, dict) else {}
    try:
        if parts == ["artifacts"] and method == "GET":
            # The gallery polls this while it is open: it also purges the trash, at most once a day.
            store.purge_trash_due()
            base = store.root()
            arts = [_view(m, base) for m in store.list_all()]
            settings = store.settings()
            folders = list(settings.get("folders") or [])
            folders += sorted({a["folder"] for a in arts if a.get("folder")} - set(folders))
            return {"artifacts": arts, "folders": folders,
                    "default_design_system": settings.get("default_design_system"),
                    "design_system_for": settings.get("design_system_for") or {},
                    "making": store.making_all(),
                    # Host only (a page reaches nothing but /op): the code the server's processes run
                    # against the installed files; the gallery says when a restart or an update is due.
                    "server": running.status(base)}
        if parts == ["making"] and method == "GET":
            # What a chat is making now (Hermes read a guide, has not published): after a reload or a chat switch.
            session = str(query.get("session") or "")
            return {"making": store.making_get(session) if session else store.making_all()}
        if parts == ["design-system-for"] and method == "POST":
            # The system one type builds on (the ••• of a Make something new tile): an id, "none", or null
            # for the default for everything.
            kind, dsid = str(body.get("type") or ""), body.get("id")
            if kind not in store.DS_WEARERS and kind != "dashboard":
                raise ApiError(400, "this type takes no design system")
            if dsid not in (None, "none") and _meta(str(dsid)).get("type") != "design-system":
                raise ApiError(400, "not a design system")
            per = dict(store.settings().get("design_system_for") or {})
            per.pop(kind, None)
            if dsid:
                per[kind] = str(dsid)
            store.settings_set("design_system_for", per or None)
            return {"design_system_for": per}
        if parts == ["folders"] and method == "POST":
            # A gallery folder (Claude's New › Folder, Move to › create).
            name = " ".join(str(body.get("name") or "").split())[:60]
            if not name:
                raise ApiError(400, "a folder needs a name")
            have = list(store.settings().get("folders") or [])
            if body.get("delete"):
                store.settings_set("folders", [f for f in have if f != name])
                for m in store.list_all():
                    if m.get("folder") == name:
                        store.update_meta(m["id"], folder="")
            elif name not in have:
                store.settings_set("folders", have + [name])
            return {"folders": store.settings().get("folders") or []}
        if parts == ["trash"] and method == "GET":
            # Deleted artifacts, kept store.TRASH_DAYS days (newest deletion first). What is past its time
            # goes first, here and now (purge_trash deletes nothing else), so the list never shows it.
            try:
                store.purge_trash()
            except Exception:
                pass
            store.purge_trash_due()
            return {"trash": store.trash_list(), "days": store.TRASH_DAYS}
        if parts == ["trash", "delete"] and method == "POST":
            # Host only (a page reaches nothing but /op; the agent has no tool for it): delete one trashed
            # copy for good, the user's own act in the gallery. {"name": <trash folder name>}, never an id.
            name = str(body.get("name") or "")
            try:
                store.trash_delete(name)
            except FileNotFoundError as e:
                raise ApiError(404, str(e))
            except ValueError as e:
                raise ApiError(400, str(e))
            return {"deleted": name}
        if parts == ["trash", "restore"] and method == "POST":
            # Bring one back: {"name": <trash folder name>} (the gallery: that very copy) or
            # {"id": <id or trash folder name>} (the newest deletion of that id).
            try:
                if body.get("name"):
                    return {"artifact": _view(store.restore(str(body["name"]), entry=True))}
                return {"artifact": _view(store.restore(str(body.get("id") or "")))}
            except FileNotFoundError as e:
                raise ApiError(404, str(e))
            except (FileExistsError, ValueError) as e:
                raise ApiError(409, str(e))
        if len(parts) == 2 and parts[0] == "vendor" and method == "GET":
            p = (_VENDOR / parts[1]).resolve()
            if p.parent != _VENDOR.resolve() or not p.is_file() or p.suffix != ".js":
                raise ApiError(404, "unknown asset")
            return {"name": parts[1], "text": p.read_text("utf-8")}
        if len(parts) >= 2 and parts[0] == "artifacts":
            aid, rest = parts[1], parts[2:]
            if not rest:
                if method == "GET":
                    m = _meta(aid)
                    vdir = store.version_dir(aid)
                    return dict(_view(m), size=sum(e.stat().st_size for _, e in store.walk_files(vdir)),
                                type_label=m.get("type", "page"))
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
            elif rest == ["preview"] and method == "GET":
                # The gallery card's picture (a model's view): one small request per card shown.
                m = _meta(aid)
                n = _int(query.get("v")) or m["versions"][-1]["n"]
                data = store.preview_get(aid, n)
                if not data:
                    raise ApiError(404, "no preview")
                return {"id": aid, "version": n, "data": data}
            elif rest == ["files"] and method == "GET":
                _meta(aid)
                try:
                    return {"files": store.list_files(aid, _int(query.get("v")))}
                except FileNotFoundError:
                    raise ApiError(404, "unknown version")
            elif rest == ["duplicate"] and method == "POST":
                m = _meta(aid)
                suffix = str(body.get("suffix") or " (copy)")[:40]
                new = store.publish(path=str(store.version_dir(aid)), title=(m["title"] + suffix)[:200],
                                    description=m.get("description", ""), type=m.get("type", "page"),
                                    session=m.get("session"))
                return _view(store.get_meta(new["id"]))
            elif rest == ["meta"] and method == "POST":
                _meta(aid)
                return _view(store.update_meta(aid, title=body.get("title"), pinned=body.get("pinned"),
                                               session=body.get("session"), folder=body.get("folder"),
                                               opened=body.get("opened")))
            elif rest == ["approval"] and method == "POST":
                # Host only (a page reaches nothing but /op): the live query Hermes Desktop shows in its own
                # approval dialog, then the user's answer. {id, version, args?} shows it; with `allowed` and
                # the `call` shown it decides, refused when the query changed in between.
                _meta(aid)
                dsid, v, args = str(body.get("id", "")), _int(body.get("version")), body.get("args")
                if "allowed" not in body:
                    return live.pending(aid, dsid, v, args)
                return live.decide(aid, dsid, body.get("call"), body.get("allowed") is True, v, args)
            elif rest == ["allowlist"] and method == "GET":
                # Host only (a page reaches nothing but /op): the servers this dashboard needs that the MCP
                # allowlist lacks and the command that adds them, for Hermes Desktop's own dialog to show.
                _meta(aid)
                return live.allow_help(aid)
            elif rest == ["chat"] and method == "GET":
                # Host only (a page reaches nothing but /op): is the artifact's chat still there?
                return chat_status(_meta(aid).get("session"))
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
            elif len(rest) == 3 and rest[0] == "comments" and rest[2] == "react" and method == "POST":
                _meta(aid)
                try:
                    return store.comment_react(aid, rest[1], str(body.get("emoji", "")))
                except ValueError as e:
                    raise ApiError(400, str(e))
            elif rest == ["op"] and method == "POST":
                return _op(aid, str(body.get("op", "")), body.get("args") if isinstance(body.get("args"), dict) else {})
    except ApiError:
        raise
    except docs.DocError as e:
        raise ApiError(404 if e.code == "absent" else 400, e.message)
    except live.LiveError as e:
        raise ApiError(404 if e.status == "missing" else 400, e.message)
    except FileNotFoundError as e:
        raise ApiError(404, f"not found: {e}")
    except (ValueError, TypeError) as e:
        raise ApiError(400, str(e))
    raise ApiError(404, "Not Found")
