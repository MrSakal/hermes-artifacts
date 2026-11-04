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


def publish(*, html: Optional[str] = None, path: Optional[str] = None, title: str = "",
            aid: Optional[str] = None, description: str = "") -> dict:
    """Write a new version. ``path`` may be an .html file or a directory with index.html."""
    if (html is None) == (path is None):
        raise ValueError("pass exactly one of html or path")
    with _LOCK:
        meta = get_meta(aid) if aid else None
        if aid and meta is None:
            _dir(aid)  # validates id
        aid = aid or slugify(title or "artifact")
        d = _dir(aid)
        d.mkdir(parents=True, exist_ok=True)
        meta = meta or {"id": aid, "title": title or aid, "created": time.time(), "versions": []}
        n = len(meta["versions"]) + 1
        vdir = d / f"v{n}"
        if path is not None:
            src = Path(path)
            if src.is_dir():
                if not (src / "index.html").is_file():
                    raise ValueError(f"{src} has no index.html")
                shutil.copytree(src, vdir)
            elif src.is_file():
                vdir.mkdir()
                shutil.copy2(src, vdir / "index.html")
            else:
                raise FileNotFoundError(str(src))
        else:
            if len(html.encode("utf-8")) > MAX_HTML_BYTES:
                raise ValueError("html exceeds 16 MB")
            vdir.mkdir()
            (vdir / "index.html").write_text(html, encoding="utf-8")
        size = sum(f.stat().st_size for f in vdir.rglob("*") if f.is_file())
        if size > MAX_HTML_BYTES:
            shutil.rmtree(vdir)
            raise ValueError("artifact exceeds 16 MB")
        if title:
            meta["title"] = title
        if description:
            meta["description"] = description
        meta["versions"].append({"n": n, "published": time.time(), "bytes": size})
        meta["updated"] = time.time()
        _write_json(d / "meta.json", meta)
        return meta


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


def inbox_add(aid: str, text: str, data=None) -> dict:
    if get_meta(aid) is None:
        raise FileNotFoundError(aid)
    item = {"id": secrets.token_hex(6), "artifact": aid, "text": str(text)[:8000],
            "data": data, "ts": time.time(), "acked": False}
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
