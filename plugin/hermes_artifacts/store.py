"""Versioned artifact store: $HERMES_HOME/artifacts/<id>/v<N>/index.html + meta.json."""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import stat
import threading
import time
from pathlib import Path
from typing import Any, Iterator, Optional

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
    if not os.path.isdir(r):  # one stat when it is there (every path below starts here)
        r.mkdir(parents=True, exist_ok=True)
    return r


def slugify(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "artifact"
    return f"{s}-{secrets.token_hex(3)}"


def _dir(aid: str, base: Optional[Path] = None) -> Path:
    """The artifact's folder (``base``: root(), when the caller already has it)."""
    if not _ID_RE.match(aid):
        raise ValueError(f"invalid artifact id: {aid!r}")
    return (base or root()) / aid


def _write_json(p: Path, data) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)


def get_meta(aid: str) -> Optional[dict]:
    p = _dir(aid) / "meta.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None


def walk_files(top: Path) -> Iterator[tuple[str, os.DirEntry]]:
    """Every file under ``top`` as (relative POSIX path, its os.DirEntry), in ``top.rglob("*")``'s order
    (each folder's files, then its subfolders in turn; symlinked folders not followed). A DirEntry carries
    the size on Windows without another stat, which a Path from rglob does not."""
    def walk(d: str, prefix: str):
        with os.scandir(d) as it:
            entries = list(it)
        for e in entries:
            if e.is_file():
                yield prefix + e.name, e
        for e in entries:
            if e.is_dir() and not e.is_symlink():
                yield from walk(e.path, prefix + e.name + "/")
    return walk(str(top), "")


# A static SVG (the Design System page's uploads, a board's drawings).
_SVG_URI = re.compile(r"^data:image/svg\+xml(?:;charset=utf-8)?;base64,([A-Za-z0-9+/=]+)$", re.I)
MAX_SVG_BYTES = 2 * 1024 * 1024
_SVG_BANNED = {"script", "foreignobject", "iframe", "embed", "object"}


def safe_svg(rel: str, val: str) -> str:
    """The SVG's text when it is a static drawing (no script, handlers, javascript: or outside links), else ValueError."""
    import base64
    import binascii
    import xml.etree.ElementTree as ET
    bad = f"{rel}: an SVG of at most 2 MB"
    um = _SVG_URI.match(val)
    if um:
        if len(um.group(1)) * 3 // 4 > MAX_SVG_BYTES + 3:
            raise ValueError(bad)
        try:
            raw = base64.b64decode(um.group(1), validate=True)
        except (binascii.Error, ValueError):
            raise ValueError(bad)
    elif val.startswith("data:"):
        raise ValueError(bad)
    else:
        raw = val.encode("utf-8")
    if len(raw) > MAX_SVG_BYTES:
        raise ValueError(bad)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError(f"{rel}: an SVG must be UTF-8 text")
    low = text.lower()
    if "<!doctype" in low or "<!entity" in low or "<?xml-stylesheet" in low:
        raise ValueError(f"{rel}: an SVG may not declare a DOCTYPE, entities or stylesheets")
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        raise ValueError(f"{rel}: not a well-formed SVG")
    local = lambda n: str(n).rsplit("}", 1)[-1].lower()
    if local(root.tag) != "svg":
        raise ValueError(f"{rel}: the root element must be <svg>")
    for el in root.iter():
        if local(el.tag) in _SVG_BANNED:
            raise ValueError(f"{rel}: an SVG may not contain <{local(el.tag)}>")
        for k, v in el.attrib.items():
            # Browsers drop whitespace and control characters inside a URL's scheme ("java\tscript:").
            name, v = local(k), re.sub(r"[\s\x00-\x1f]+", "", str(v)).lower()
            if name.startswith("on"):
                raise ValueError(f"{rel}: an SVG may not have event handlers ({name})")
            if v.startswith("javascript:"):
                raise ValueError(f"{rel}: an SVG may not link to javascript:")
            if name == "href" and not (v.startswith("#") or v.startswith("data:image/")):
                raise ValueError(f"{rel}: an SVG may link only to its own #fragments or data:image/ URIs")
    return text


TYPES = ("page", "dashboard", "slides", "doc", "sheet", "board", "design", "model", "motion", "design-system")
# The file a type's content starts from (validated at publish).
TYPE_ENTRY = {"page": "index.html", "dashboard": "dashboard.json", "slides": "deck.json", "doc": "doc.md",
              "sheet": "sheet.json", "board": "board.json", "design": "canvas.json", "model": "model.json", "motion": "modules/scenes.json", "design-system": "design-system.json"}
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


def _fresh(p: Path) -> None:
    """Drop a file before writing it: it may be a hard link shared with an older version."""
    if p.is_file() or p.is_symlink():
        p.unlink()


def _link_or_copy(src: str, dst: str) -> str:
    """Copy a version's file into the next version: a hard link when the file system allows (versions
    are never changed in place, and every write drops the file first), else a real copy."""
    try:
        os.link(src, dst)
        return dst
    except OSError:
        return shutil.copy2(src, dst)


def _copy_fresh(src: str, dst: str) -> str:
    _fresh(Path(dst))
    return shutil.copy2(src, dst)


def _write_files(vdir: Path, files: dict) -> None:
    import base64
    if not isinstance(files, dict) or not files:
        raise ValueError("files must be a non-empty {path: content} map")
    if len(files) > MAX_FILES:
        raise ValueError(f"at most {MAX_FILES} files")
    for rel, content in files.items():
        p = vdir / safe_rel(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        _fresh(p)
        if isinstance(content, dict) and "base64" in content:
            p.write_bytes(base64.b64decode(content["base64"], validate=True))
        elif isinstance(content, (dict, list)):
            p.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            p.write_text(str(content), encoding="utf-8")


_DS_TEXT = {".md", ".json", ".js", ".css", ".html", ".htm", ".svg", ".ts", ".tsx", ".jsx", ".txt", ".csv", ".yml", ".yaml", ".mdx"}


def _ds_build(vdir: Path) -> None:
    """A design system's generated files (tokens.css, manifest.json, api/ cards, README's tail), as
    Claude's Design System type writes them on every save. A system brought over from Claude, kept
    under project/, comes up to the root first (the type's own files it carried stay behind)."""
    from . import dsbuild
    proj = vdir / "project"
    if proj.is_dir() and not (vdir / "design-system.json").is_file() and (proj / "design-system.json").is_file():
        for f in sorted(p for p in proj.rglob("*") if p.is_file()):
            dest = vdir / f.relative_to(proj)
            dest.parent.mkdir(parents=True, exist_ok=True)
            _fresh(dest)
            shutil.move(str(f), str(dest))
        shutil.rmtree(proj, ignore_errors=True)
        for extra in ("SKILL.md", "index.html"):
            (vdir / extra).unlink(missing_ok=True)
        shutil.rmtree(vdir / "artifact-type", ignore_errors=True)
    files = {}
    for rel, _ in walk_files(vdir):
        f = vdir / rel
        files[rel] = f.read_text("utf-8", "replace") if f.suffix.lower() in _DS_TEXT else f.read_bytes()
    try:
        index = json.loads(files.get("design-system.json") or "{}")
    except ValueError:
        index = {}
    out = dsbuild.build(files, index if isinstance(index, dict) else {})
    for rel in out.pop("_stale", []):
        (vdir / safe_rel(rel)).unlink(missing_ok=True)
    for rel, text in out.items():
        dest = vdir / safe_rel(rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        _fresh(dest)
        dest.write_text(text, encoding="utf-8")


# The types that carry a copy of the design system they were built on, and the index that records it.
DS_WEARERS = {"slides": "deck.json", "design": "canvas.json", "motion": "modules/scenes.json"}
DS_COPY_ASSETS_MAX = 4 * 1024 * 1024  # a system's pictures come along up to this much


def _ds_folder(name: str, taken: set) -> str:
    base = re.sub(r"[^a-z0-9_-]+", "-", str(name or "").lower()).strip("-")[:48] or "system"
    out, i = base, 2
    while out in taken:
        out, i = f"{base}-{i}", i + 1
    return out


def _ds_install(vdir: Path, kind: str, prev: Optional[Path] = None) -> None:
    """Copy the design systems an artifact names into it (Claude's install: the copy travels with the deck,
    canvas or film, so a later edit or the deletion of the system changes nothing here).

    The author writes only ids: ``"designSystems": ["<id>"]`` in the index. Each becomes a record
    ``{title, namespace, artifact, version, copiedAt}`` and its files land under ``ds/<namespace>/``:
    tokens.json, tokens.css, components/bundle.css, fonts/, assets/ (while small) and, on a canvas, the
    component bundle with its libraries. A system the artifact already wears keeps its copy and version,
    however the author names it again (``prev``: the version before this one); only
    ``{"artifact": "<id>", "update": true}`` installs the system's latest. Older indexes (``designSystem``)
    are brought over."""
    idx = vdir / DS_WEARERS[kind]
    try:
        doc = json.loads(idx.read_text("utf-8"))
    except (OSError, ValueError):
        return
    if not isinstance(doc, dict):
        return
    raw = doc.get("designSystems")
    raw = list(raw) if isinstance(raw, list) else []
    old = doc.get("designSystem")
    if old and not raw:
        raw = [old]
    dsroot = vdir / "ds"
    if not raw and "designSystem" not in doc and not dsroot.is_dir():
        return
    worn = {}  # what the version before wore: {system id: its record}, where the copy is still there
    try:
        was = json.loads((prev / DS_WEARERS[kind]).read_text("utf-8")).get("designSystems") if prev else None
    except (OSError, ValueError, AttributeError):
        was = None
    for w in was if isinstance(was, list) else []:
        if isinstance(w, dict) and w.get("artifact") and w.get("copiedAt") \
                and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", str(w.get("namespace") or "")) \
                and (prev / "ds" / w["namespace"] / "tokens.json").is_file():
            worn.setdefault(str(w["artifact"]), w)
    recs, taken = [], set()
    for r in raw[:4]:
        if r is True:
            r = default_design_system(kind)
        if isinstance(r, str):
            r = {"artifact": r}
        if not isinstance(r, dict):
            continue
        dsid = str(r.get("artifact") or r.get("id") or "")
        ns = str(r.get("namespace") or "")
        have = bool(r.get("copiedAt")) and bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", ns)) \
            and ns not in taken and (dsroot / ns / "tokens.json").is_file()
        if have:
            taken.add(ns)
            recs.append(r)
            continue
        w = worn.get(dsid)
        if w and not r.get("update") and r.get("version") in (None, w.get("version")) and w["namespace"] not in taken:
            # named again without asking for an update: the copy and the version it has stay
            ns = w["namespace"]
            taken.add(ns)
            if not (dsroot / ns / "tokens.json").is_file():
                shutil.copytree(prev / "ds" / ns, dsroot / ns, dirs_exist_ok=True, copy_function=_copy_fresh)
            recs.append({**w, **({"theme": r["theme"]} if isinstance(r.get("theme"), str) else {})})
            continue
        try:
            meta = get_meta(dsid) if dsid else None
        except (ValueError, OSError):
            meta = None
        if not meta or meta.get("type") != "design-system" or not meta.get("versions"):
            continue  # nothing to copy from: the artifact keeps its own look
        kept = [v["n"] for v in meta["versions"]]
        want = None if r.get("update") else r.get("version")
        n = want if isinstance(want, int) and not isinstance(want, bool) and want in kept else kept[-1]
        src = _dir(dsid) / f"v{n}"
        try:
            name = json.loads((src / "design-system.json").read_text("utf-8")).get("namespace")
        except (OSError, ValueError, AttributeError):
            name = None
        ns = _ds_folder(name or meta.get("title") or dsid, taken)
        taken.add(ns)
        dest = dsroot / ns
        shutil.rmtree(dest, ignore_errors=True)
        want_files = ["tokens.json", "tokens.css", "components/bundle.css"]
        if kind == "design":
            want_files.append("components/bundle.js")
            want_files += sorted(p.relative_to(src).as_posix() for p in (src / "components" / "lib").glob("*.js"))
        want_files += sorted(p.relative_to(src).as_posix() for p in (src / "fonts").rglob("*") if p.is_file())
        assets = sorted(p for p in (src / "assets").rglob("*") if p.is_file())
        rec = {"title": meta.get("title", dsid), "namespace": ns, "artifact": dsid, "version": n,
               "copiedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        if assets and sum(p.stat().st_size for p in assets) <= DS_COPY_ASSETS_MAX:
            want_files += [p.relative_to(src).as_posix() for p in assets]
        elif assets:
            rec["assets"] = False  # too large to carry: read them from the system when one is needed
        for rel in want_files:
            f = src / rel
            if f.is_file():
                (dest / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dest / rel)
        if isinstance(r.get("theme"), str):
            rec["theme"] = r["theme"]
        recs.append(rec)
    if dsroot.is_dir():
        for d in dsroot.iterdir():
            if d.is_dir() and d.name not in taken:
                shutil.rmtree(d, ignore_errors=True)
        if not any(dsroot.iterdir()):
            dsroot.rmdir()
    if doc.get("designSystems") == recs and "designSystem" not in doc:
        return
    doc.pop("designSystem", None)
    doc["designSystems"] = recs
    _fresh(idx)
    idx.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")


def publish(*, html: Optional[str] = None, path: Optional[str] = None, files: Optional[dict] = None,
            title: str = "", aid: Optional[str] = None, description: str = "",
            type: Optional[str] = None, base: bool = False,
            session: Optional[str] = None, by: str = "hermes", restored: Optional[int] = None) -> dict:
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
        if not title and not meta and path is not None and type == "model" and Path(path).is_file():
            title = Path(path).stem  # a mesh file brought in names the model
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
                shutil.copytree(d / f"v{meta['versions'][-1]['n']}", vdir, copy_function=_link_or_copy)
            if path is not None:
                src = Path(path)
                if src.is_dir():
                    shutil.copytree(src, vdir, dirs_exist_ok=True, copy_function=_copy_fresh)
                elif src.is_file() and kind == "sheet" and src.suffix.lower() in (".xlsx", ".csv", ".tsv"):
                    # A spreadsheet file becomes the sheet's sheet.json (the original is not kept).
                    from . import xlsx_in
                    vdir.mkdir(exist_ok=True)
                    spec = xlsx_in.to_sheet_json(src)
                    (vdir / "sheet.json").write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
                elif src.is_file() and kind == "model" and src.suffix.lower() != ".json":
                    # A mesh file becomes the model's meshes/<name>.<ext> with one file part.
                    from . import models
                    vdir.mkdir(exist_ok=True)
                    models.wrap_mesh(src, vdir, title)
                elif src.is_file():
                    vdir.mkdir(exist_ok=True)
                    _copy_fresh(str(src), str(vdir / TYPE_ENTRY[kind] if kind != "page" else vdir / "index.html"))
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
                _fresh(vdir / "index.html")
                (vdir / "index.html").write_text(html, encoding="utf-8")
            if kind == "design-system":
                _ds_build(vdir)
            elif kind == "sheet":
                from . import sheets
                sheets.check_file(vdir / "sheet.json")
            elif kind == "board":
                from . import boards
                boards.check_file(vdir / "board.json")
            elif kind == "model":
                from . import models
                models.check_file(vdir / "model.json")
            elif kind in DS_WEARERS:
                _ds_install(vdir, kind, d / f"v{meta['versions'][-1]['n']}" if meta["versions"] else None)
            if not (vdir / TYPE_ENTRY[kind]).is_file():
                raise ValueError(f"a {kind} needs {TYPE_ENTRY[kind]}")
            all_files = [e for _, e in walk_files(vdir)]
            size = sum(e.stat().st_size for e in all_files)
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
        entry = {"n": n, "published": time.time(), "bytes": size, "by": by if by in ("hermes", "user") else "hermes"}
        if restored:
            entry["restored"] = int(restored)
        meta["versions"].append(entry)
        meta["updated"] = time.time()
        _write_json(d / "meta.json", meta)
        return meta


def update_meta(aid: str, **fields) -> dict:
    """Change list-level fields (title, description, pinned, session, folder, opened) without a new version.
    `folder`: the gallery folder it sits in ("" takes it out); `opened`: true stamps now (Last opened)."""
    with _LOCK:
        meta = get_meta(aid)
        if meta is None:
            raise FileNotFoundError(aid)
        for k, v in fields.items():
            if k not in ("title", "description", "pinned", "session", "folder", "opened"):
                raise ValueError(f"can't set {k}")
            if v is None:
                continue
            if k == "folder":
                name = " ".join(str(v).split())[:60]
                if name:
                    meta["folder"] = name
                else:
                    meta.pop("folder", None)
                continue
            if k == "opened":
                if v:
                    meta["opened"] = time.time()
                continue
            if k == "session":
                # The chat the artifact belongs to now (its old chat was archived or deleted).
                if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", str(v)):
                    raise ValueError("bad session id")
                meta[k] = str(v)
            else:
                meta[k] = bool(v) if k == "pinned" else str(v)[:300]
        _write_json(_dir(aid) / "meta.json", meta)
        return meta


def delete(aid: str) -> None:
    """Delete an artifact for good (Claude's): every version, file, comment, stored value and record
    goes at once, and nothing can bring it back. A design system that was the default stops being it."""
    with _LOCK:
        d = _dir(aid)
        meta = get_meta(aid)
        if meta is None:
            raise FileNotFoundError(aid)
        shutil.rmtree(d)
        if d.exists():
            raise OSError(f"could not delete {aid}")
        if settings().get("default_design_system") == aid:
            settings_set("default_design_system", None)
        per = settings().get("design_system_for")
        if isinstance(per, dict) and aid in per.values():
            settings_set("design_system_for", {k: v for k, v in per.items() if v != aid} or None)


def empty_trash() -> list[str]:
    """Delete for good what versions before 0.13 moved to <root>/.trash/ (deleting is for good now, so
    nothing new goes there). Returns the folder names removed."""
    trash = root() / ".trash"
    if not trash.is_dir():
        return []
    gone = []
    with _LOCK:
        for item in list(trash.iterdir()):
            if item.is_dir():
                shutil.rmtree(item, ignore_errors=True)
            else:
                item.unlink(missing_ok=True)
            if not item.exists():
                gone.append(item.name)
        try:
            trash.rmdir()
        except OSError:
            pass
    return gone


def list_files(aid: str, n: Optional[int] = None) -> list[str]:
    return sorted(rel for rel, _ in walk_files(version_dir(aid, n)))


def read_file(aid: str, rel: str, n: Optional[int] = None) -> bytes:
    p = version_dir(aid, n) / safe_rel(rel)
    if not p.is_file():
        raise FileNotFoundError(rel)
    return p.read_bytes()


def json_cached(p: Path, cache: dict, keep: int = 0, *, st: Optional[os.stat_result] = None) -> Any:
    """The JSON in ``p``, parsed again only when the file changed (every write here replaces the file:
    a new inode, mtime or size). The value is shared with later calls: never change it. ``keep``: the most
    entries ``cache`` holds (0: no limit). FileNotFoundError when ``p`` is missing, ValueError when bad."""
    st = st or p.stat()
    stamp = (st.st_mtime_ns, st.st_size, st.st_ino)
    hit = cache.get(p)
    if hit and hit[0] == stamp:
        return hit[1]
    value = json.loads(p.read_text(encoding="utf-8"))
    _cache_put(cache, keep, p, stamp, value)
    return value


def json_remember(p: Path, cache: dict, value: Any, st: os.stat_result, keep: int = 0) -> None:
    """After writing ``value`` as JSON (it must read back equal) to a temporary file whose stat is ``st``
    and moving that onto ``p`` (a rename keeps inode and mtime): the next json_cached(p) skips the parse,
    while a write by another process since then still counts as a change."""
    _cache_put(cache, keep, p, (st.st_mtime_ns, st.st_size, st.st_ino), value)


def _cache_put(cache: dict, keep: int, p: Path, stamp: tuple, value: Any) -> None:
    cache.pop(p, None)
    if keep and len(cache) >= keep:
        cache.pop(next(iter(cache)), None)
    cache[p] = (stamp, value)


_METAS: dict = {}  # meta.json path -> (stamp, meta): the gallery parses only the ones that changed


def list_all() -> list[dict]:
    """Every artifact's meta, newest first (each a fresh dict; the nested lists are shared: read them only)."""
    out, seen = [], set()
    for d in root().iterdir():
        m = d / "meta.json"
        try:
            st = m.stat()
        except OSError:
            continue
        if not stat.S_ISREG(st.st_mode):
            continue
        try:
            out.append(dict(json_cached(m, _METAS, st=st)))
        except ValueError:
            continue
        seen.add(m)
    for gone in [k for k in _METAS if k not in seen]:  # deleted artifacts (or another root, in tests)
        _METAS.pop(gone, None)
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


def settings() -> dict:
    """Plugin-wide choices the user made in a page (the default design system)."""
    p = root() / "settings.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def default_design_system(kind: Optional[str] = None) -> Optional[str]:
    """The design system new artifacts of ``kind`` build on: the user's choice for that type (Claude keeps a
    default per type; "none" = this type takes none), else the default for everything."""
    s = settings()
    per = s.get("design_system_for")
    own = per.get(kind) if kind and isinstance(per, dict) else None
    if own == "none":
        return None
    return own or s.get("default_design_system") or None


def settings_set(key: str, value: Any) -> None:
    with _LOCK:
        s = settings()
        if value is None:
            s.pop(key, None)
        else:
            s[key] = value
        root().mkdir(parents=True, exist_ok=True)
        _write_json(root() / "settings.json", s)


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


_OPEN_COUNTS: dict = {}  # comments.json path -> ((mtime_ns, size, inode), count)


def open_user_comments(aid: str, base: Optional[Path] = None) -> int:
    """How many of the person's comments are open (the gallery's badge on a card), counted again only
    when comments.json changed. ``base``: root(), when the caller lists many."""
    p = _dir(aid, base) / "comments.json"
    try:
        st = p.stat()
    except FileNotFoundError:
        return 0
    stamp = (st.st_mtime_ns, st.st_size, st.st_ino)
    hit = _OPEN_COUNTS.get(p)
    if hit and hit[0] == stamp:
        return hit[1]
    n = sum(1 for c in comments_list(aid, include_resolved=False) if c["author"] == "user")
    _OPEN_COUNTS[p] = (stamp, n)
    return n


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
        anchor = {k: str(anchor[k])[:500] for k in ("selector", "text", "label", "tab") if anchor.get(k)}
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


REACTIONS = ("👍", "❤️", "🎉", "✅", "👀", "😄")


def comment_react(aid: str, cid: str, emoji: str, who: str = "user") -> dict:
    """Toggle one reaction (Claude's emoji on a comment) by the person or Hermes."""
    if emoji not in REACTIONS or who not in ("user", "hermes"):
        raise ValueError("unknown reaction")
    with _LOCK:
        items = comments_list(aid)
        for c in items:
            if c["id"] == cid:
                r = c.setdefault("reactions", {})
                people = r.setdefault(emoji, [])
                if who in people:
                    people.remove(who)
                else:
                    people.append(who)
                c["reactions"] = {k: v for k, v in r.items() if v}
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


# --- page reports: what the open dashboard found (check) and how its sources ran (runs) ----------

MAX_REPORT_BYTES = 64 * 1024


def _reports_path(aid: str) -> Path:
    return _dir(aid) / "reports.json"


def report_set(aid: str, kind: str, data: dict) -> None:
    """Store the page's own ``check`` or ``runs`` report. The page is untrusted: it is kept as data
    (bounded), for the agent to read as claims."""
    if kind not in ("check", "runs") or not isinstance(data, dict):
        raise ValueError("bad report")
    if get_meta(aid) is None:
        raise FileNotFoundError(aid)
    blob = json.dumps(data, ensure_ascii=False, default=str)
    if len(blob.encode()) > MAX_REPORT_BYTES:
        raise ValueError("report too large")
    with _LOCK:
        p = _reports_path(aid)
        allr = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
        allr[kind] = {**json.loads(blob), "received": time.time()}
        _write_json(p, allr)


def reports(aid: str) -> dict:
    p = _reports_path(aid)
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}


# --- previews: a picture of a version the page drew (a model's view), outside the versions -------------
# <artifact>/previews/v<N>.png: no version is made and it is not an edit; the gallery shows it on the card.

MAX_PREVIEW_BYTES = 400 * 1024
PREVIEWS_KEPT = 3  # pictures of the latest few versions
_PREVIEW_URI = re.compile(r"^data:image/png;base64,([A-Za-z0-9+/=\s]+)$")


def preview_set(aid: str, data_url: str, version: Optional[int] = None) -> Optional[int]:
    """Keep ``data_url`` (a PNG) as the picture of the latest version. ``version``: the one the page drew;
    when that is no longer the latest nothing is kept (None is returned), else the version it went to."""
    import base64
    import binascii
    m = _PREVIEW_URI.match(data_url) if isinstance(data_url, str) else None
    if not m or len(m.group(1)) * 3 // 4 > MAX_PREVIEW_BYTES + 3:
        raise ValueError(f"a preview is a PNG data URL of at most {MAX_PREVIEW_BYTES // 1024} KB")
    try:
        raw = base64.b64decode(re.sub(r"\s+", "", m.group(1)), validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("a preview is a PNG data URL (bad base64)")
    if len(raw) > MAX_PREVIEW_BYTES or raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"a preview is a PNG of at most {MAX_PREVIEW_BYTES // 1024} KB")
    with _LOCK:
        meta = get_meta(aid)
        if not meta or not meta.get("versions"):
            raise FileNotFoundError(aid)
        latest = meta["versions"][-1]["n"]
        if version is not None and int(version) != latest:
            return None
        d = _dir(aid) / "previews"
        d.mkdir(exist_ok=True)
        p = d / f"v{latest}.png"
        tmp = p.with_suffix(".tmp")
        tmp.write_bytes(raw)
        os.replace(tmp, p)
        keep = {f"v{v['n']}.png" for v in meta["versions"][-PREVIEWS_KEPT:]}
        for f in d.iterdir():
            if f.name not in keep:
                f.unlink(missing_ok=True)
        return latest


def preview_path(aid: str, n: int, base: Optional[Path] = None) -> Path:
    return _dir(aid, base) / "previews" / f"v{int(n)}.png"


def preview_get(aid: str, n: int) -> Optional[str]:
    """The picture of version ``n`` as a data URL, or None."""
    import base64
    try:
        raw = preview_path(aid, n).read_bytes()
    except OSError:
        return None
    return "data:image/png;base64," + base64.b64encode(raw).decode()


# --- query history: each saved version of a live query's args (90 days, 200 KB) ------------------

HISTORY_DAYS = 90
MAX_HISTORY_BYTES = 200 * 1024


def _history_path(aid: str) -> Path:
    return _dir(aid) / "history.json"


def history(aid: str, dsid: Optional[str] = None) -> Any:
    p = _history_path(aid)
    data = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
    return data.get(dsid, []) if dsid is not None else data


def history_add(aid: str, dsid: str, args: dict, via: str) -> None:
    with _LOCK:
        data = history(aid)
        entries = data.get(dsid, [])
        if entries and entries[-1].get("args") == args:
            return
        now = time.time()
        entries.append({"at": now, "args": args, "via": via})
        entries = [e for e in entries if now - e.get("at", 0) <= HISTORY_DAYS * 86400]
        data[dsid] = entries
        while len(json.dumps(data).encode()) > MAX_HISTORY_BYTES and any(len(v) > 1 for v in data.values()):
            longest = max(data, key=lambda k: len(data[k]))
            data[longest] = data[longest][1:]
        _write_json(_history_path(aid), data)


# --- view context: what the user has open in an artifact, per chat session (for the next message) --

VIEW_TTL_S = 10 * 60
MAX_VIEW_BYTES = 8 * 1024


def _views_path() -> Path:
    return root() / "views.json"


def view_set(session: str, aid: Optional[str], context: Optional[dict]) -> None:
    """Record (or with ``aid=None`` clear) the artifact a chat session's user is looking at."""
    if not isinstance(session, str) or not 0 < len(session) <= 200:
        raise ValueError("bad session")
    with _LOCK:
        p = _views_path()
        data = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
        now = time.time()
        data = {k: v for k, v in data.items() if now - v.get("at", 0) <= VIEW_TTL_S}
        if aid is None:
            data.pop(session, None)
        else:
            meta = get_meta(aid)
            if meta is None:
                raise FileNotFoundError(aid)
            blob = json.dumps(context or {}, ensure_ascii=False, default=str)
            if len(blob.encode()) > MAX_VIEW_BYTES:
                raise ValueError("view context too large")
            data[session] = {"artifact": aid, "title": meta.get("title", aid), "type": meta.get("type", "page"),
                             "version": meta["versions"][-1]["n"], "context": json.loads(blob), "at": now}
        _write_json(p, data)


def view_get(session: str) -> Optional[dict]:
    p = _views_path()
    if not p.is_file():
        return None
    v = json.loads(p.read_text(encoding="utf-8")).get(session)
    if not v or time.time() - v.get("at", 0) > VIEW_TTL_S:
        return None
    return v


# --- making: a chat's artifact being made (Hermes read a type's guide; nothing published yet) ----------
# Kept on disk like the view context: the agent's tools, its hooks and the REST API may run in different
# module copies or processes. One small file, written only when something starts, moves on or ends.

MAKING_TTL_S = 20 * 60  # a making state no step has touched for this long is over (a turn that died)


def _making_path() -> Path:
    return root() / "making.json"


def _making_read() -> dict:
    p = _making_path()
    if not p.is_file():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _making_live(data: dict, now: float) -> dict:
    return {k: v for k, v in data.items() if isinstance(v, dict) and now - v.get("at", 0) <= MAKING_TTL_S}


def making_set(session: str, kind: str, phase: str, **fields) -> dict:
    """Record that ``session`` is making a ``kind`` artifact, now at ``phase``; the start time is kept
    while the type stays the same. ``fields``: title, id (None values are left out)."""
    if not isinstance(session, str) or not 0 < len(session) <= 200:
        raise ValueError("bad session")
    if kind not in TYPES:
        raise ValueError(f"unknown type {kind!r}")
    with _LOCK:
        now = time.time()
        data = _making_live(_making_read(), now)
        prev = data.get(session)
        started = prev["started"] if prev and prev.get("type") == kind and prev.get("started") else now
        state = {"type": kind, "phase": str(phase)[:40], "started": started, "at": now,
                 **{k: str(v)[:200] for k, v in fields.items() if v not in (None, "")}}
        data[session] = state
        _write_json(_making_path(), data)
        return {"session": session, **state}


def making_get(session: str) -> Optional[dict]:
    """The session's making state, or None (none, or stale)."""
    v = _making_read().get(session) if session else None
    if not isinstance(v, dict) or time.time() - v.get("at", 0) > MAKING_TTL_S:
        return None
    return {"session": session, **v}


def making_all() -> dict:
    """Every live making state, by session."""
    return {k: {"session": k, **v} for k, v in _making_live(_making_read(), time.time()).items()}


def making_clear(session: str) -> Optional[dict]:
    """End the session's making state; returns it when there was a live one. Writes only when it changes."""
    if not session:
        return None
    with _LOCK:
        data = _making_read()
        if session not in data:
            return None
        prev = data.pop(session)
        _write_json(_making_path(), _making_live(data, time.time()))
        if not isinstance(prev, dict) or time.time() - prev.get("at", 0) > MAKING_TTL_S:
            return None
        return {"session": session, **prev}


# --- a chat that moved: Hermes continues a compressed chat under a new session id -------------------------

def repoint_session(old: str, new: str) -> list[str]:
    """Move what belongs to chat ``old`` (its artifacts, a making state) to ``new``, the session Hermes
    continues it in after compressing it. Returns the ids of the artifacts moved."""
    if not old or not new or old == new or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", str(new)):
        return []
    moved = []
    with _LOCK:
        for m in list_all():
            if m.get("session") == old:
                update_meta(m["id"], session=new)
                moved.append(m["id"])
        data = _making_read()
        if old in data:
            data[new] = data.pop(old)
            _write_json(_making_path(), data)
    return moved
