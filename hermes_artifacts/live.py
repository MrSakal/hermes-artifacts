"""Live dashboard sources: a stored MCP tool call that the dashboard runs itself.

A dataset ``{"source": {"kind": "call", "tool": "<mcp tool>", "args": {...}, "rules": {...}}}`` is the
call the agent ran in its session, stored with the dashboard. When the dashboard opens, refreshes or
changes a filter, it runs that call again through Hermes' tool registry, in this process (the web
server that also hosts the Desktop's chat backend, so the MCP tools are the same ones the agent used).

What keeps a page from turning this into a remote control:
- only calls stored in the artifact's own ``dashboard.json`` run: the page names a dataset id, never
  a tool or arguments;
- only MCP tools (a toolset ``mcp-*``) run, never built-in tools such as the terminal;
- the page only supplies filter values, and each ``{{name}}`` is checked against its ``rules``;
- every distinct call (tool + argument template) needs one approval by the user, a click in the page,
  stored per artifact; a changed query needs a new one.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from typing import Any, Optional

from . import store

DEFAULT_MAX_AGE_S = 10 * 60
MAX_ANSWER_BYTES = 8 * 1024 * 1024
_PARAM = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}")
_WHOLE = re.compile(r"^\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}$")
# A text value with no rule that pins it: one plain line, nothing that could close a quote.
_PLAIN = re.compile(r"^[^'\"`\\\r\n‘’“”]{0,200}$")
MAX_ARGS_CHARS = 36_000
MAX_SQL_CHARS = 16_000
# An argument that reads as SQL must be one read-only statement (the same guard Claude's dashboards apply).
_SQL_START = re.compile(r"^\s*(?:--[^\n]*\n\s*|/\*.*?\*/\s*)*([A-Za-z]+)", re.S)
_SQL_KEYWORDS = {"select", "with", "insert", "update", "delete", "merge", "upsert", "replace", "create", "alter",
                 "drop", "truncate", "grant", "revoke", "call", "exec", "execute", "set", "begin", "commit",
                 "rollback", "copy", "unload", "vacuum", "analyze", "attach", "detach", "pragma", "use", "declare"}
_SQL_WRITE = re.compile(r"\b(insert|update|delete|merge|upsert|replace\s+into|create|alter|drop|truncate|grant|revoke|"
                        r"call|exec|execute|begin|commit|rollback|copy|unload|vacuum|attach|detach|pragma|declare|"
                        r"into\s+outfile|set\s+\w+\s*=)\b", re.I)
# SQL is told from text by its shape, so a search phrase like "update notes" is not taken for SQL.
_SQL_READ_HEAD = re.compile(r"(select\b[\s\S]*\bfrom\b|select\s+[\w*(]|with\s+\w+\s+as\s*\()", re.I)
_SQL_WRITE_HEAD = re.compile(r"(insert\s+into|update\s+\S+\s+set\b|delete\s+from|merge\s+into|(drop|create|alter|truncate)\s+(table|view|index|schema|database|or\s+replace)|grant\s+\w+\s+on|exec(ute)?\s+\w+|call\s+\w+\s*\()", re.I)
_cache: dict[str, dict] = {}
_cache_lock = threading.Lock()
_inflight: dict[str, threading.Event] = {}


class LiveError(Exception):
    def __init__(self, status: str, message: str, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


# ----------------------------------------------------------------------------- the stored call

def dataset(aid: str, dsid: str, version: Optional[int] = None) -> dict:
    try:
        spec = json.loads(store.read_file(aid, "dashboard.json", version).decode("utf-8"))
    except FileNotFoundError:
        raise LiveError("missing", "this artifact has no dashboard.json")
    except ValueError:
        raise LiveError("error", "dashboard.json is not valid JSON")
    d = (spec.get("datasets") or {}).get(dsid)
    if not isinstance(d, dict):
        raise LiveError("missing", f"no dataset {dsid!r}")
    src = d.get("source") or {}
    if src.get("kind") not in ("call", "query") or not isinstance(src.get("tool"), str):
        raise LiveError("error", f"dataset {dsid!r} is not a live call")
    if not isinstance(src.get("args", {}), dict):
        raise LiveError("error", "args must be an object")
    return {"tool": src["tool"], "args": src.get("args") or {}, "rules": src.get("rules") or {},
            "max_age": int(d.get("maxAgeMinutes", DEFAULT_MAX_AGE_S // 60)) * 60,
            "defaults": spec.get("params") or {}}


def call_id(tool: str, args: dict, rules: dict) -> str:
    """Identity of a call template: what the user approves."""
    blob = json.dumps({"tool": tool, "args": args, "rules": rules}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()[:24]


def names(args: Any) -> set[str]:
    if isinstance(args, str):
        return set(_PARAM.findall(args))
    if isinstance(args, dict):
        return set().union(*(names(v) for v in args.values())) if args else set()
    if isinstance(args, list):
        return set().union(*(names(v) for v in args)) if args else set()
    return set()


# ----------------------------------------------------------------------------- filters

def _check(name: str, value: Any, rule: Optional[dict], in_text: bool) -> Any:
    if value is None:
        raise LiveError("error", f"filter {name!r} has no value", needs=name)
    if isinstance(value, list):
        if in_text and rule and rule.get("type") in ("number", "boolean"):
            raise LiveError("error", f"filter {name!r}: a list can't be written into text under a {rule['type']} rule")
        return [_check(name, v, rule, in_text) for v in value]
    if not rule:
        if in_text:
            if isinstance(value, bool) or isinstance(value, (int, float)):
                return value
            if not isinstance(value, str) or not _PLAIN.match(value):
                raise LiveError("error", f"filter {name!r} has no rule, so only plain text is allowed", badRule=name)
        return value
    t = rule.get("type")
    if t == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise LiveError("error", f"filter {name!r} must be a number")
        if "minimum" in rule and value < rule["minimum"] or "maximum" in rule and value > rule["maximum"]:
            raise LiveError("error", f"filter {name!r} is out of range")
    elif t == "boolean":
        if not isinstance(value, bool):
            raise LiveError("error", f"filter {name!r} must be true or false")
    if "enum" in rule and value not in rule["enum"]:
        raise LiveError("error", f"filter {name!r} is not one of the allowed values")
    if "pattern" in rule:
        if not isinstance(value, str) or not re.fullmatch(rule["pattern"], value):
            raise LiveError("error", f"filter {name!r} doesn't match its pattern")
    if isinstance(value, str):
        if "minLength" in rule and len(value) < rule["minLength"] or "maxLength" in rule and len(value) > rule["maxLength"]:
            raise LiveError("error", f"filter {name!r} has the wrong length")
        if in_text and not t and "enum" not in rule and "pattern" not in rule and not _PLAIN.match(value):
            raise LiveError("error", f"filter {name!r}: only plain text is allowed")
    return value


def fill(args: Any, params: dict, rules: dict) -> Any:
    """Substitute ``{{name}}``: as the typed value when it is the whole string, as text inside one."""
    if isinstance(args, dict):
        return {k: fill(v, params, rules) for k, v in args.items()}
    if isinstance(args, list):
        return [fill(v, params, rules) for v in args]
    if not isinstance(args, str):
        return args
    m = _WHOLE.match(args)
    if m:
        n = m.group(1)
        return _check(n, params.get(n), rules.get(n), in_text=False)

    def text(mm):
        n = mm.group(1)
        v = _check(n, params.get(n), rules.get(n), in_text=True)
        if isinstance(v, list):
            return ",".join("true" if x is True else "false" if x is False else str(x) for x in v)
        return "true" if v is True else "false" if v is False else "" if v is None else str(v)
    return _PARAM.sub(text, args)


def _strip_sql_text(sql: str) -> str:
    """SQL without its string literals, quoted identifiers and comments (what keywords are read from)."""
    out, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if c in "'\"`":
            j = i + 1
            while j < n and not (sql[j] == c and (j + 1 >= n or sql[j + 1] != c)):
                j += 2 if sql[j] == c else 1
            if j >= n:
                raise LiveError("refused", "the query has an unclosed quote")
            out.append(" "); i = j + 1
        elif sql.startswith("--", i):
            j = sql.find("\n", i); i = n if j < 0 else j
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            if j < 0:
                raise LiveError("refused", "the query has an unclosed comment")
            i = j + 2
        else:
            out.append(c); i += 1
    return "".join(out)


def guard(args: Any) -> None:
    """Refuse calls that could write: any string argument that reads as SQL must be a single
    SELECT/WITH statement with no write keyword; the filled arguments stay under 36 KB."""
    if len(json.dumps(args, ensure_ascii=False, default=str)) > MAX_ARGS_CHARS:
        raise LiveError("refused", "the query's arguments are too long")

    def walk(v):
        if isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, str):
            m = _SQL_START.match(v)
            head = v[m.start(1):] if m else ""
            if _SQL_WRITE_HEAD.match(head):
                raise LiveError("refused", "a dashboard only runs read-only queries (this one writes)")
            if not _SQL_READ_HEAD.match(head):
                return  # not SQL: a search phrase, a name, a URL
            if len(v) > MAX_SQL_CHARS:
                raise LiveError("refused", "the query is over 16,000 characters")
            body = _strip_sql_text(v)
            if ";" in body.rstrip().rstrip(";"):
                raise LiveError("refused", "a dashboard query must be a single statement")
            w = _SQL_WRITE.search(body)
            if w:
                raise LiveError("refused", f"a dashboard only runs read-only queries (found {w.group(1).upper()})")
    walk(args)


# ----------------------------------------------------------------------------- running it

def _registry_entry(tool: str):
    from tools.registry import registry
    scope = None
    try:
        from hermes_cli.plugins import get_plugin_manager
        scope = get_plugin_manager().scope_key
    except Exception:
        pass
    entry = registry.get_entry(tool, scope=scope) if scope else None
    entry = entry or registry.get_entry(tool)
    if entry is None:  # MCP servers connect on first use in a fresh process
        try:
            from tools.mcp_tool_discovery import discover_mcp_tools
            discover_mcp_tools()
        except Exception:
            pass
        entry = (registry.get_entry(tool, scope=scope) if scope else None) or registry.get_entry(tool)
    return registry, entry, scope


def run_tool(tool: str, args: dict) -> Any:
    """Dispatch an MCP tool by its registry name and return its decoded answer."""
    try:
        registry, entry, scope = _registry_entry(tool)
    except ImportError:
        raise LiveError("error", "live data needs the Hermes server (no tool registry here)")
    if entry is None:
        raise LiveError("connect", f"the tool {tool!r} isn't available on this Hermes (is its MCP server connected?)")
    toolset = getattr(entry, "toolset", "") or ""
    if not toolset.startswith("mcp-"):
        raise LiveError("refused", f"{tool!r} is not an MCP tool; a dashboard can only run MCP tools")
    out = registry.dispatch(tool, args, scope=scope) if scope else registry.dispatch(tool, args)
    return decode(out)


def decode(out: Any) -> Any:
    """An MCP answer as data: JSON text, structuredContent, or content[0].text parsed when it is JSON."""
    if isinstance(out, (bytes, bytearray)):
        out = out.decode("utf-8", "replace")
    if isinstance(out, str):
        if len(out) > MAX_ANSWER_BYTES:
            raise LiveError("error", "the answer is over 8 MB: ask for less in the query")
        try:
            out = json.loads(out)
        except ValueError:
            return out
    if isinstance(out, dict):
        if out.get("error") and len(out) <= 3:
            raise LiveError("failed", str(out["error"])[:2000])
        if out.get("isError"):
            raise LiveError("failed", _text_of(out)[:2000] or "the tool reported an error")
        if "structuredContent" in out and out["structuredContent"] is not None:
            return out["structuredContent"]
        if isinstance(out.get("result"), (dict, list, str)) and set(out) <= {"result", "ok", "success"}:
            return decode(out["result"])
        content = out.get("content")
        if isinstance(content, list) and content:
            t = _text_of(out)
            try:
                return json.loads(t)
            except ValueError:
                return t
    return out


def _text_of(out: dict) -> str:
    return "\n".join(c.get("text", "") for c in out.get("content") or [] if isinstance(c, dict) and c.get("type", "text") == "text")


def rows_of(answer: Any) -> Optional[dict]:
    """Rows when the answer is a table: plain row objects (bare or under rows/data/results), or
    BigQuery's {schema: {fields}, rows: [{f: [{v}]}]}. None for any other answer."""
    if isinstance(answer, dict):
        schema = answer.get("schema")
        if isinstance(schema, dict) and isinstance(schema.get("fields"), list) and isinstance(answer.get("rows"), list):
            fields = schema["fields"]
            cols = [f.get("name") for f in fields]
            out = []
            for r in answer["rows"]:
                cells = r.get("f") if isinstance(r, dict) else r
                if not isinstance(cells, list):
                    return None
                row = {}
                for f, c in zip(fields, cells):
                    v = c.get("v") if isinstance(c, dict) else c
                    typ = str(f.get("type", "")).upper()
                    if v is not None and typ in ("INTEGER", "INT64") and str(v).lstrip("-").isdigit() and abs(int(v)) < 2 ** 53:
                        v = int(v)
                    elif v is not None and typ in ("FLOAT", "FLOAT64", "NUMERIC", "BIGNUMERIC"):
                        try:
                            v = float(v)
                        except ValueError:
                            pass
                    elif typ in ("BOOLEAN", "BOOL") and isinstance(v, str):
                        v = v.lower() == "true"
                    row[f.get("name")] = v
                out.append(row)
            return {"columns": cols, "rows": out}
        for k in ("rows", "data", "results", "items", "records"):
            if isinstance(answer.get(k), list):
                t = rows_of(answer[k])
                if t is not None:
                    if isinstance(answer.get("columns"), list) and all(isinstance(c, str) for c in answer["columns"]):
                        t["columns"] = answer["columns"]
                    return t
        return None
    if isinstance(answer, list) and answer and all(isinstance(r, dict) for r in answer):
        cols: list = []
        for r in answer:
            for k in r:
                if k not in cols:
                    cols.append(k)
        return {"columns": cols, "rows": answer}
    if isinstance(answer, list) and not answer:
        return {"columns": [], "rows": []}
    return None


def run_dataset(aid: str, dsid: str, params: dict, *, force: bool = False, version: Optional[int] = None) -> dict:
    """Run one live dataset: approval, filters, cache, the call. Returns the page's dataset payload."""
    d = dataset(aid, dsid, version)
    cid = call_id(d["tool"], d["args"], d["rules"])
    info = {"tool": d["tool"], "call": cid}
    if not store.approved(aid, cid):
        return {"status": "approval", **info, "args": d["args"], "rules": d["rules"]}
    used = names(d["args"])
    merged = {k: v for k, v in {**d["defaults"], **(params or {})}.items() if k in used}
    try:
        args = fill(d["args"], merged, d["rules"])
        guard(args)
    except LiveError as e:
        return {"status": "error", "message": e.message, **info, **e.extra}
    key = hashlib.sha256(json.dumps([aid, cid, args], sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and not force and now - hit["at"] < d["max_age"]:
            return {**hit["payload"], "cached": True, "at": hit["at"]}
        wait = _inflight.get(key)
        if wait is None:
            _inflight[key] = threading.Event()
    if wait is not None:  # the same call is already running for another viewer: share its answer
        wait.wait(120)
        with _cache_lock:
            hit = _cache.get(key)
        if hit:
            return {**hit["payload"], "cached": True, "at": hit["at"]}
    started = time.time()
    try:
        answer = run_tool(d["tool"], args)
        table = rows_of(answer)
        payload = {"status": "ok", **info, "args": args, "ms": int((time.time() - started) * 1000)}
        if table is not None:
            payload.update(table)
        else:
            payload["answer"] = answer
        with _cache_lock:
            _cache[key] = {"at": time.time(), "payload": payload}
            if len(_cache) > 500:
                for k in sorted(_cache, key=lambda k: _cache[k]["at"])[:100]:
                    _cache.pop(k, None)
        return {**payload, "cached": False, "at": time.time()}
    except LiveError as e:
        return {"status": e.status, "message": e.message, **info, "args": args, **e.extra}
    except Exception as e:  # the tool itself raised
        return {"status": "failed", "message": f"{type(e).__name__}: {str(e)[:1000]}", **info, "args": args}
    finally:
        with _cache_lock:
            ev = _inflight.pop(key, None)
        if ev:
            ev.set()


def edit_args(aid: str, dsid: str, args: Any, base_version: Optional[int] = None, auto_approve: bool = True) -> dict:
    """Replace the ``args`` of one existing live dataset and publish that as a new version. The tool
    and rules stay as the agent stored them, so the edit can not point the dashboard at another tool;
    the changed call needs a new approval before it runs."""
    if not isinstance(args, dict):
        raise LiveError("error", "args must be an object")
    meta = store.get_meta(aid)
    if not meta or meta.get("type") != "dashboard":
        raise LiveError("missing", "not a dashboard")
    latest = meta["versions"][-1]["n"]
    if base_version and int(base_version) != latest:
        return {"ok": False, "conflict": True, "version": latest}
    spec = json.loads(store.read_file(aid, "dashboard.json").decode("utf-8"))
    d = (spec.get("datasets") or {}).get(dsid)
    if not isinstance(d, dict) or (d.get("source") or {}).get("kind") not in ("call", "query"):
        raise LiveError("missing", f"no live dataset {dsid!r}")
    if len(json.dumps(args, ensure_ascii=False)) > MAX_ARGS_CHARS:
        raise LiveError("refused", "the query's arguments are too long")
    d["source"]["args"] = args
    d["edit"] = {"via": "user", "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    nm = store.publish(aid=aid, base=True, files={"dashboard.json": spec})
    if auto_approve:
        approve_all(aid, "user")  # the user's own save is the approval
    return {"ok": True, "version": nm["versions"][-1]["n"]}


def approve_all(aid: str, via: str) -> list[str]:
    """Mark every live call in the latest dashboard.json as approved. Used when the agent publishes
    the dashboard (it ran these calls in the chat, in front of the user) and when the user saves an
    edited query: the approval step adds nothing there. Returns the approved call ids."""
    try:
        spec = json.loads(store.read_file(aid, "dashboard.json").decode("utf-8"))
    except (FileNotFoundError, ValueError):
        return []
    out = []
    for dsid, d in (spec.get("datasets") or {}).items():
        src = (d or {}).get("source") or {}
        if src.get("kind") in ("call", "query") and isinstance(src.get("tool"), str):
            cid = call_id(src["tool"], src.get("args") or {}, src.get("rules") or {})
            store.set_approval(aid, cid, src["tool"], True)
            out.append(cid)
    return out
