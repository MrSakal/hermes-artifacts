"""Versioned artifact store: $HERMES_HOME/artifacts/<id>/v<N>/index.html + meta.json."""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import threading
import time
from pathlib import Path
from typing import Optional

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
_LOCK = threading.RLock()
MAX_HTML_BYTES = 16 * 1024 * 1024
MAX_KV_BYTES = 256 * 1024


PLUGIN_ID = "hermes-artifacts"


def hermes_home() -> Path:
    """Hermes' own resolution (profile-aware) when available, else HERMES_HOME / platform default."""
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:  # standalone use (tests, CLI outside Hermes)
        env = os.environ.get("HERMES_HOME")
        if env:
            return Path(env)
        local = os.environ.get("LOCALAPPDATA")
        if local and (Path(local) / "hermes").is_dir():
            return Path(local) / "hermes"
        return Path.home() / ".hermes"


def root() -> Path:
    """<HERMES_HOME>/plugin-data/hermes-artifacts (Hermes' per-plugin data convention)."""
    r = Path(os.environ.get("HERMES_ARTIFACTS_DIR") or hermes_home() / "plugin-data" / PLUGIN_ID)
    r.mkdir(parents=True, exist_ok=True)
    return r


def slugify(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "artifact"
    return f"{s}-{secrets.token_hex(3)}"


def _dir(aid: str) -> Path:
    if not _ID_RE.match(aid):
        raise ValueError(f"invalid artifact id: {aid!r}")
    return root() / aid


def _write_json(p: Path, data) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)


def get_meta(aid: str) -> Optional[dict]:
    p = _dir(aid) / "meta.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None


TYPES = ("page", "dashboard", "slides", "doc")
# The file a type's content starts from (validated at publish).
TYPE_ENTRY = {"page": "index.html", "dashboard": "dashboard.json", "slides": "deck.json", "doc": "doc.md"}
_REL_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}(/[A-Za-z0-9_][A-Za-z0-9._-]{0,99}){0,7}$")
MAX_FILES = 512


def safe_rel(rel: str) -> str:
    """A relative path inside a version dir: no '..', no absolute, no backslash, no hidden names."""
    rel = str(rel).replace("\\", "/")
    if rel.startswith("./"):
        rel = rel[2:]
    if not _REL_RE.match(rel) or ".." in rel.split("/"):
        raise ValueError(f"invalid file path: {rel!r}")
    return rel


def _write_files(vdir: Path, files: dict) -> None:
    import base64
    if not isinstance(files, dict) or not files:
        raise ValueError("files must be a non-empty {path: content} map")
    if len(files) > MAX_FILES:
        raise ValueError(f"at most {MAX_FILES} files")
    for rel, content in files.items():
        p = vdir / safe_rel(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, dict) and "base64" in content:
            p.write_bytes(base64.b64decode(content["base64"], validate=True))
        elif isinstance(content, (dict, list)):
            p.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            p.write_text(str(content), encoding="utf-8")


def publish(*, html: Optional[str] = None, path: Optional[str] = None, files: Optional[dict] = None,
            title: str = "", aid: Optional[str] = None, description: str = "",
            type: Optional[str] = None, base: bool = False,
            session: Optional[str] = None) -> dict:
    """Write a new version from exactly one of ``html``, ``path`` (an .html file or a folder) or
    ``files`` ({relative path: text | JSON value | {"base64": ...}}).

    ``base=True`` starts the new version as a copy of the latest one, so ``files`` only needs the
    files that change (a ``None`` value removes one). ``type`` is fixed by the first version.
    """
    if sum(x is not None for x in (html, path, files)) != 1:
        raise ValueError("pass exactly one of html, path or files")
    with _LOCK:
        meta = get_meta(aid) if aid else None
        if aid and meta is None:
            _dir(aid)  # validates id
        aid = aid or slugify(title or "artifact")
        d = _dir(aid)
        d.mkdir(parents=True, exist_ok=True)
        kind = (meta or {}).get("type") or type or "page"
        if type and meta and type != kind:
            raise ValueError(f"{aid} is a {kind}; its type can't change")
        if kind not in TYPES:
            raise ValueError(f"unknown type {kind!r} (one of {', '.join(TYPES)})")
        meta = meta or {"id": aid, "title": title or aid, "created": time.time(), "versions": [],
                        "type": kind}
        n = len(meta["versions"]) + 1
        vdir = d / f"v{n}"
        if vdir.exists():
            shutil.rmtree(vdir)
        try:
            if base and meta["versions"]:
                shutil.copytree(d / f"v{meta['versions'][-1]['n']}", vdir)
            if path is not None:
                src = Path(path)
                if src.is_dir():
                    shutil.copytree(src, vdir, dirs_exist_ok=True)
                elif src.is_file():
                    vdir.mkdir(exist_ok=True)
                    shutil.copy2(src, vdir / TYPE_ENTRY[kind] if kind != "page" else vdir / "index.html")
                else:
                    raise FileNotFoundError(str(src))
            elif files is not None:
                vdir.mkdir(exist_ok=True)
                removed = [r for r, c in files.items() if c is None]
                for rel in removed:
                    (vdir / safe_rel(rel)).unlink(missing_ok=True)
                rest = {r: c for r, c in files.items() if c is not None}
                if rest:
                    _write_files(vdir, rest)
            else:
                if len(html.encode("utf-8")) > MAX_HTML_BYTES:
                    raise ValueError("html exceeds 16 MB")
                vdir.mkdir(exist_ok=True)
                (vdir / "index.html").write_text(html, encoding="utf-8")
            if not (vdir / TYPE_ENTRY[kind]).is_file():
                raise ValueError(f"a {kind} needs {TYPE_ENTRY[kind]}")
            all_files = [f for f in vdir.rglob("*") if f.is_file()]
            size = sum(f.stat().st_size for f in all_files)
            if size > MAX_HTML_BYTES:
                raise ValueError("artifact exceeds 16 MB")
            if len(all_files) > MAX_FILES:
                raise ValueError(f"at most {MAX_FILES} files")
        except Exception:
            shutil.rmtree(vdir, ignore_errors=True)
            raise
        if title:
            meta["title"] = title
        if description:
            meta["description"] = description
        if session and isinstance(session, str):
            meta["session"] = session[:200]  # the chat that published it (desktop sends comments there)
        meta["versions"].append({"n": n, "published": time.time(), "bytes": size})
        meta["updated"] = time.time()
        _write_json(d / "meta.json", meta)
        return meta


def update_meta(aid: str, **fields) -> dict:
    """Change list-level fields (title, description, pinned) without a new version."""
    with _LOCK:
        meta = get_meta(aid)
        if meta is None:
            raise FileNotFoundError(aid)
        for k, v in fields.items():
            if k not in ("title", "description", "pinned"):
                raise ValueError(f"can't set {k}")
            if v is not None:
                meta[k] = bool(v) if k == "pinned" else str(v)[:300]
        _write_json(_dir(aid) / "meta.json", meta)
        return meta


TRASH_MARK = ".deleted.json"


def delete(aid: str) -> Path:
    """Move an artifact to <root>/.trash/ (recoverable by moving it back until it is purged). The
    deletion time is written into it, so each item's retention counts from its own deletion."""
    with _LOCK:
        d = _dir(aid)
        meta = get_meta(aid)
        if meta is None:
            raise FileNotFoundError(aid)
        trash = root() / ".trash"
        trash.mkdir(exist_ok=True)
        now = time.time()
        dest = trash / f"{aid}-{int(now)}"
        n = 1
        while dest.exists():
            n += 1
            dest = trash / f"{aid}-{int(now)}-{n}"
        shutil.move(str(d), str(dest))
        _write_json(dest / TRASH_MARK, {"id": aid, "title": meta.get("title", aid), "deleted_at": now})
        return dest


def _deleted_at(item: Path) -> Optional[float]:
    """When a trashed item was deleted: its mark, else the time in its folder name, else its mtime."""
    try:
        return float(json.loads((item / TRASH_MARK).read_text(encoding="utf-8"))["deleted_at"])
    except Exception:
        pass
    m = re.search(r"-(\d{9,11})(?:-\d+)?$", item.name)
    if m:
        return float(m.group(1))
    try:
        return item.stat().st_mtime
    except OSError:
        return None


def trash_list() -> list[dict]:
    trash = root() / ".trash"
    if not trash.is_dir():
        return []
    out = []
    for item in sorted(trash.iterdir()):
        if item.is_dir():
            title = item.name
            try:
                title = json.loads((item / TRASH_MARK).read_text(encoding="utf-8")).get("title", title)
            except Exception:
                pass
            out.append({"name": item.name, "title": title, "deleted_at": _deleted_at(item)})
    return out


def purge_trash(days: float, now: Optional[float] = None) -> list[str]:
    """Delete for good every trashed item deleted more than ``days`` ago (each counted from its own
    deletion). ``days <= 0`` keeps everything. Returns the purged folder names."""
    if not days or days <= 0:
        return []
    now = time.time() if now is None else now
    limit = float(days) * 86400
    purged = []
    trash = root() / ".trash"
    if not trash.is_dir():
        return []
    with _LOCK:
        for item in list(trash.iterdir()):
            if not item.is_dir():
                continue
            at = _deleted_at(item)
            if at is not None and now - at >= limit:
                shutil.rmtree(item, ignore_errors=True)
                if not item.exists():
                    purged.append(item.name)
    return purged


def list_files(aid: str, n: Optional[int] = None) -> list[str]:
    vdir = version_dir(aid, n)
    return sorted(f.relative_to(vdir).as_posix() for f in vdir.rglob("*") if f.is_file())


def read_file(aid: str, rel: str, n: Optional[int] = None) -> bytes:
    p = version_dir(aid, n) / safe_rel(rel)
    if not p.is_file():
        raise FileNotFoundError(rel)
    return p.read_bytes()


def list_all() -> list[dict]:
    out = []
    for d in root().iterdir():
        m = d / "meta.json"
        if m.is_file():
            try:
                out.append(json.loads(m.read_text(encoding="utf-8")))
            except ValueError:
                continue
    return sorted(out, key=lambda m: m.get("updated", 0), reverse=True)


def version_dir(aid: str, n: Optional[int] = None) -> Path:
    meta = get_meta(aid)
    if not meta or not meta["versions"]:
        raise FileNotFoundError(aid)
    n = n or meta["versions"][-1]["n"]
    p = _dir(aid) / f"v{int(n)}"
    if not p.is_dir():
        raise FileNotFoundError(f"{aid} v{n}")
    return p


def read_html(aid: str, n: Optional[int] = None) -> str:
    return (version_dir(aid, n) / "index.html").read_text(encoding="utf-8", errors="replace")


# --- per-artifact KV (window.hermes.storage) --------------------------------

def _kv_path(aid: str) -> Path:
    return _dir(aid) / "storage.json"


def kv_all(aid: str) -> dict:
    p = _kv_path(aid)
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}


def kv_set(aid: str, key: str, value) -> None:
    if get_meta(aid) is None:
        raise FileNotFoundError(aid)
    if not isinstance(key, str) or not 0 < len(key) <= 200:
        raise ValueError("bad key")
    with _LOCK:
        data = kv_all(aid)
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value
        if len(json.dumps(data).encode()) > MAX_KV_BYTES:
            raise ValueError("storage exceeds 256 KB")
        _write_json(_kv_path(aid), data)


# --- inbox (window.hermes.send -> agent) ------------------------------------

def _inbox_path() -> Path:
    return root() / "inbox.jsonl"


def inbox_add(aid: str, text: str, data=None, *, kind: str = "send") -> dict:
    if get_meta(aid) is None:
        raise FileNotFoundError(aid)
    item = {"id": secrets.token_hex(6), "artifact": aid, "text": str(text)[:8000],
            "data": data, "kind": kind, "ts": time.time(), "acked": False}
    with _LOCK, _inbox_path().open("a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False) + "\n")
    return item


def inbox_list(aid: Optional[str] = None, include_acked: bool = False) -> list[dict]:
    p = _inbox_path()
    if not p.is_file():
        return []
    items = [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [i for i in items if (aid is None or i["artifact"] == aid) and (include_acked or not i["acked"])]


def inbox_ack(ids: list[str]) -> int:
    with _LOCK:
        items = inbox_list(include_acked=True)
        n = 0
        for i in items:
            if i["id"] in ids and not i["acked"]:
                i["acked"], n = True, n + 1
        tmp = _inbox_path().with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items), encoding="utf-8")
        os.replace(tmp, _inbox_path())
        return n


def inbox_get(item_id: str) -> Optional[dict]:
    return next((i for i in inbox_list(include_acked=True) if i["id"] == item_id), None)


# --- replies (window.hermes.ask -> the agent answers with artifact_reply) ----

def _replies_path(aid: str) -> Path:
    return _dir(aid) / "replies.json"


def reply_set(aid: str, request: str, text: str = "", data=None) -> dict:
    item = inbox_get(request)
    if not item or item["artifact"] != aid:
        raise FileNotFoundError(f"no request {request!r} from {aid}")
    with _LOCK:
        p = _replies_path(aid)
        allr = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
        allr[request] = {"text": str(text)[:20000], "data": data, "ts": time.time()}
        if len(json.dumps(allr).encode()) > MAX_KV_BYTES * 4:  # keep the newest when it grows
            for k in sorted(allr, key=lambda k: allr[k]["ts"])[: len(allr) // 2]:
                allr.pop(k)
        _write_json(p, allr)
        return allr[request]


def reply_get(aid: str, request: str) -> Optional[dict]:
    p = _replies_path(aid)
    return (json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}).get(request)


# --- comments (anchored notes on a page, sent to the agent on request) -------

def _comments_path(aid: str) -> Path:
    return _dir(aid) / "comments.json"


def comments_list(aid: str, include_resolved: bool = True) -> list[dict]:
    p = _comments_path(aid)
    items = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else []
    return [c for c in items if include_resolved or not c.get("resolved")]


def comment_add(aid: str, text: str, *, author: str = "user", anchor: Optional[dict] = None,
                parent: Optional[str] = None, version: Optional[int] = None) -> dict:
    meta = get_meta(aid)
    if meta is None:
        raise FileNotFoundError(aid)
    text = str(text).strip()
    if not text:
        raise ValueError("empty comment")
    if author not in ("user", "hermes"):
        raise ValueError("bad author")
    anchor = anchor if isinstance(anchor, dict) else None
    if anchor:  # only short, plain fields
        anchor = {k: str(anchor[k])[:500] for k in ("selector", "text", "label") if anchor.get(k)}
    with _LOCK:
        items = comments_list(aid)
        if parent and not any(c["id"] == parent for c in items):
            raise ValueError(f"unknown thread {parent!r}")
        c = {"id": secrets.token_hex(5), "text": text[:4000], "author": author, "anchor": anchor,
             "parent": parent, "version": version or meta["versions"][-1]["n"], "ts": time.time(),
             "resolved": False}
        items.append(c)
        if len(items) > 2000:
            raise ValueError("too many comments")
        _write_json(_comments_path(aid), items)
        return c


def comment_resolve(aid: str, cid: str, resolved: bool = True) -> dict:
    with _LOCK:
        items = comments_list(aid)
        for c in items:
            if c["id"] == cid:
                c["resolved"] = bool(resolved)
                _write_json(_comments_path(aid), items)
                return c
    raise FileNotFoundError(cid)


# --- approvals of live dashboard calls (per artifact, per call template) ----

def _approvals_path(aid: str) -> Path:
    return _dir(aid) / "approvals.json"


def approvals(aid: str) -> dict:
    p = _approvals_path(aid)
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}


def approved(aid: str, call_id: str) -> bool:
    return approvals(aid).get(call_id, {}).get("allowed") is True


def set_approval(aid: str, call_id: str, tool: str, allowed: bool) -> dict:
    if get_meta(aid) is None:
        raise FileNotFoundError(aid)
    with _LOCK:
        data = approvals(aid)
        data[call_id] = {"tool": str(tool)[:200], "allowed": bool(allowed), "ts": time.time()}
        _write_json(_approvals_path(aid), data)
        return data[call_id]
