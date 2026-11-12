"""Live dashboard sources: a stored MCP tool call that the dashboard runs itself.

A dataset ``{"source": {"kind": "call", "tool": "<mcp tool>", "args": {...}, "rules": {...}}}`` is the
call the agent ran in its session, stored with the dashboard. When the dashboard opens, refreshes or
changes a filter, it runs that call again through ``ctx.call_mcp`` (Hermes' own MCP client, its trust
gates, and the default-deny ``plugins.entries.hermes-artifacts.mcp_allowlist``).

What keeps a page (or a prompt-injected agent) from turning this into a remote control:
- only MCP servers the user put on the allowlist are reached, never built-in tools such as the terminal;
- only calls stored in the artifact's own ``dashboard.json`` run: the page names a dataset id; a loader's
  ``call()`` may name only that dataset's stored tool or its stored poll tool, with the stored args;
- the page only supplies filter values, and each ``{{name}}`` is checked against its ``rules`` (inside SQL
  text: an enum of safe values, a number or boolean, or quote-free text inside a '…' literal); a string
  that is SQL must be one read-only SELECT/WITH statement in every way a lexer can read it (``guard``);
- every distinct call (tool + argument template) needs an approval, stored per artifact: given at publish
  only when the agent really ran that call in its session and filters can only vary quoted values and
  numbers (``post_tool_call``, see ``recorded_match``), otherwise by the user in a dialog Hermes Desktop
  draws (never a click inside the page).
"""

from __future__ import annotations

import decimal
import functools
import hashlib
import itertools
import math
import os
import json
import re
import sys
import threading
import time
import unicodedata
from collections import OrderedDict, deque
from typing import Any, Optional

from . import store

MAX_ANSWER_BYTES = 8 * 1024 * 1024
_PARAM = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}")
_WHOLE = re.compile(r"^\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}$")
# A text value with no rule that pins it: one plain line, nothing that could close a quote.
_PLAIN = re.compile(r"^[^'\"`\\\r\n‘’“”]{0,200}\Z")
_NOQUOTE = re.compile(r"^[^'\"`\\\r\n‘’“”]*\Z")
# A value a poll call takes from the last answer (a job id, a page token): one token, no spaces or quotes.
_TOKEN = re.compile(r"^[A-Za-z0-9_.:/=+@-]{0,512}\Z")
_ANSWER_RULE: dict = {}  # the rule of such a hole, told apart by identity (a dashboard.json rule never is it)
MAX_ARGS_CHARS = 36_000
MAX_SQL_CHARS = 16_000
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
    poll = src.get("poll") if isinstance(src.get("poll"), dict) and isinstance(src["poll"].get("tool"), str) else None
    return {"tool": src["tool"], "args": src.get("args") or {}, "rules": src.get("rules") or {}, "poll": poll,
            "defaults": spec.get("params") or {}}


def call_id(tool: str, args: dict, rules: dict, poll: Optional[dict] = None) -> str:
    """Identity of a call template: what the user approves. A poll call is part of it (a loader may
    call that tool too); without one the id is what it was before polls counted."""
    t = {"tool": tool, "args": args, "rules": rules}
    if poll:
        t["poll"] = poll
    blob = json.dumps(t, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()[:24]


def _cid(d: dict) -> str:
    return call_id(d["tool"], d["args"], d["rules"], d.get("poll"))


def names(args: Any) -> set[str]:
    if isinstance(args, str):
        return set(_PARAM.findall(args))
    if isinstance(args, dict):
        return set().union(*(names(v) for v in args.values())) if args else set()
    if isinstance(args, list):
        return set().union(*(names(v) for v in args)) if args else set()
    return set()


# ----------------------------------------------------------------------------- filters

def _pinned(rule: Any) -> bool:
    """A rule that pins a value to a known set: an enum, or a number or boolean type (a pattern does not)."""
    return isinstance(rule, dict) and (rule.get("type") in ("number", "boolean") or "enum" in rule)


# An enum value a filter may take, anywhere: letters and digits of any script, space and _ . - : / @ + ,
# (no quote, backslash, line break, control or invisible character, no {{ and no --), at most 100 of them.
_SAFE_TOKEN = re.compile(r"(?!.*--)[\w .:/@+,-]{0,100}")
_DECIMAL = re.compile(r"-?\d{1,30}(\.\d{1,30})?")
# A value written into SQL outside a '…' literal, when it is text: one name, up to three dotted parts.
_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,62}(\.[A-Za-z_][A-Za-z0-9_]{0,62}){0,2}")
MAX_HOLE_CHARS = 500  # any filter value, checked before anything reads it


def _safe_value(v: Any) -> bool:
    if isinstance(v, bool):
        return True
    if isinstance(v, (int, float)):
        return math.isfinite(v)
    return isinstance(v, str) and _SAFE_TOKEN.fullmatch(v) is not None


def _enum_safe(rule: Any) -> bool:
    """The rule's enum, when it has one, is a list of safe values (``_SAFE_TOKEN``, finite numbers, booleans)."""
    if not isinstance(rule, dict) or "enum" not in rule:
        return True
    return isinstance(rule["enum"], list) and all(_safe_value(v) for v in rule["enum"])


def _ident_value(v: Any) -> bool:
    """A value that may stand bare in SQL: a finite number, true/false, or one name (``_IDENT``) that is no
    SQL keyword."""
    if isinstance(v, bool):
        return True
    if isinstance(v, (int, float)):
        return math.isfinite(v)
    return (isinstance(v, str) and _IDENT.fullmatch(v) is not None
            and not any(p.lower() in _FORBIDDEN or p.lower() in _HEADS for p in v.split(".")))


def _raw_ok(rule: Any) -> bool:
    """The rule a hole outside a '…' literal of SQL needs: a number or boolean type, or an enum of names."""
    if not isinstance(rule, dict):
        return False
    if rule.get("type") in ("number", "boolean"):
        return True
    return isinstance(rule.get("enum"), list) and all(_ident_value(v) for v in rule["enum"])


def _quoted_ok(v: str) -> bool:
    """Text that may sit inside a '…' literal: no quote, backslash, line break, control or invisible
    character, no ``{{``."""
    return (_NOQUOTE.match(v) is not None and "{{" not in v and _INVISIBLE.search(v) is None
            and not any(ord(c) < 32 or 0x7F <= ord(c) <= 0x9F or c in _LINE_ENDS for c in v))


_RAW_FIX = ("put it inside '…' in a query with none of $ \\ # -- /* ` \" [ and no E'/r'-style prefix, or give it a "
            "number rule or an enum of names")


def _num_text(name: str, v: Any) -> str:
    """A number as text: a plain decimal (``-12``, ``3.5``), never ``NaN``, ``Infinity`` or ``1e2``."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not math.isfinite(v)):
        raise LiveError("error", f"filter {name!r} must be a number")
    s = str(v) if isinstance(v, int) else repr(float(v))
    if "e" in s or "E" in s:
        s = format(decimal.Decimal(s), "f")
    if not _DECIMAL.fullmatch(s):
        raise LiveError("error", f"filter {name!r}: at most 30 digits either side of the decimal point")
    return s


def _check(name: str, value: Any, rule: Optional[dict], in_text: bool, sql: Optional[str] = None) -> Any:
    """``value`` for the hole ``name`` when it passes ``rule``. A value is text, a finite number or true/false
    (a list of those only under an enum: a multi-select). ``sql``: the hole sits in SQL text, inside a '…'
    literal ("quoted"), anywhere else ("raw"), or in a comment ("comment": never filled)."""
    if value is None:
        raise LiveError("error", f"filter {name!r} has no value", needs=name)
    if isinstance(value, str) and len(value) > MAX_HOLE_CHARS:
        raise LiveError("refused", f"filter {name!r}: at most {MAX_HOLE_CHARS} characters")
    if rule is not None and rule is not _ANSWER_RULE and not isinstance(rule, dict):
        raise LiveError("error", f"the rule of filter {name!r} must be an object")
    if sql == "comment":
        raise LiveError("refused", f"filter {name!r} sits inside a SQL comment")
    if isinstance(value, list):
        if not (isinstance(rule, dict) and "enum" in rule) or any(isinstance(v, (list, dict)) for v in value):
            raise LiveError("error", f"filter {name!r}: a list of values needs an enum rule")
        if in_text and rule.get("type") in ("number", "boolean"):
            raise LiveError("error", f"filter {name!r}: a list can't be written into text under a {rule['type']} rule")
        return [_check(name, v, rule, in_text, sql) for v in value]
    if rule is _ANSWER_RULE:  # a poll call's value taken from the last answer (never an author's rule)
        if isinstance(value, (bool, int, float)) or (isinstance(value, str) and _TOKEN.match(value)):
            return value
        raise LiveError("refused", f"{name!r} must be one plain token from the answer")
    if not isinstance(value, (str, int, float, bool)) or (isinstance(value, float) and not math.isfinite(value)):
        raise LiveError("error", f"filter {name!r} must be text, a number or true/false")
    if not _enum_safe(rule):
        raise LiveError("refused", f"filter {name!r}: its enum holds a value no filter may take (allowed: letters, "
                                   "digits, space and _ . - : / @ + , up to 100 characters)")
    if sql == "raw":
        if not _raw_ok(rule):
            raise LiveError("refused", f"filter {name!r} sits in SQL outside a plain '…' literal: {_RAW_FIX}")
        if isinstance(value, str) and not (rule.get("type") in ("number", "boolean") or _ident_value(value)):
            raise LiveError("refused", f"filter {name!r}: only a name or a number may stand bare in SQL")
    if sql == "quoted" and isinstance(value, str) and not _quoted_ok(value):
        raise LiveError("refused", f"filter {name!r}: no quotes, backslashes, line breaks or control characters in SQL text")
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


# A SQL template is "simple" when nothing in it reads differently between databases: none of $ \ # ` " [
# -- /* ''' anywhere, and no letter or digit right before an opening quote (E'', N'', r'', q'', b'', x'').
_NOT_SIMPLE = re.compile(r"""[$\\#`"\[]|--|/\*|'''""")


def _simple_quoted(tpl: str) -> Optional[list]:
    """For a simple template, whether each hole sits inside a '…' literal by plain quote counting ('' stays
    inside); None for a template that is not simple (or ends inside a literal)."""
    if _NOT_SIMPLE.search(tpl):
        return None
    out, i, n, inside = [], 0, len(tpl), False
    while i < n:
        m = _PARAM.match(tpl, i)
        if m:
            out.append(inside)
            i = m.end()
            continue
        if tpl[i] == "'":
            if not inside:
                if i and (tpl[i - 1].isalnum() or tpl[i - 1] == "_"):
                    return None
                inside = True
            elif tpl.startswith("''", i):
                i += 2
                continue
            else:
                inside = False
        i += 1
    return None if inside else out


def _hole_sql(tpl: str) -> list:
    """For each ``{{name}}`` in a text template, in order: None when the text is not SQL, else "quoted" when
    the template is simple (``_NOT_SIMPLE``) and the hole sits inside a '…' literal, and "raw" for every
    other hole. No reading of the lexer decides where a hole is: a database that reads the text another way
    can't turn a quoted hole into code."""
    holes = list(_PARAM.finditer(tpl))
    if not holes or not _is_sql(_blank(tpl)):
        return [None] * len(holes)
    q = _simple_quoted(tpl)
    return ["raw"] * len(holes) if q is None else ["quoted" if x else "raw" for x in q]


def fill(args: Any, params: dict, rules: dict) -> Any:
    """Substitute ``{{name}}``: as the typed value when it is the whole string, as text inside one (a number
    as a plain decimal)."""
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
    ctx = iter(_hole_sql(args))

    def text(mm):
        n = mm.group(1)
        v = _check(n, params.get(n), rules.get(n), in_text=True, sql=next(ctx))
        show = lambda x: "true" if x is True else "false" if x is False else _num_text(n, x) if isinstance(x, (int, float)) else str(x)
        return ",".join(show(x) for x in v) if isinstance(v, list) else show(v)
    return _PARAM.sub(text, args)


# ----------------------------------------------------------------------------- SQL text
#
# Not a SQL parser: a small lexer that reads a string into code words and punctuation, with comments
# dropped and string literals and quoted names set aside. Where dialects read the same text differently
# (does a backslash escape a quote, does # start a comment, does -- need a space after it, do /* */ nest,
# is $tag$ a quote, is [...] a name, does \r end a line, are ''' and q'[...]' quotes), the text is lexed
# each way that applies to it, and a check fails when any reading fails it.

def _chars(*ranges: tuple) -> str:
    return "".join(chr(a) if a == b else f"{chr(a)}-{chr(b)}" for a, b in ranges)


# Invisible, zero-width and direction-changing characters: a call holding one is never shown nor run (what
# a dialog shows could differ from what runs). Code points, so no such character is in this file.
_INVISIBLE = re.compile("[" + _chars((0xAD, 0xAD), (0x34F, 0x34F), (0x61C, 0x61C), (0x115F, 0x1160), (0x17B4, 0x17B5),
                                     (0x180B, 0x180F), (0x200B, 0x200F), (0x202A, 0x202E), (0x2060, 0x206F),
                                     (0x3164, 0x3164), (0xFE00, 0xFE0F), (0xFEFF, 0xFEFF), (0xFFA0, 0xFFA0),
                                     (0xFFF0, 0xFFFB), (0xE0000, 0xE007F)) + "]")
_LINE_ENDS = "\n\r\x0b\x0c\x85" + chr(0x2028) + chr(0x2029)  # \n ends a -- comment everywhere, the rest in some
_DASH_END = " \t\n\r\x0b\x0c"  # MySQL: -- starts a comment only before one of these (or a control character)
_WORD = re.compile(r"\w+")
_DOLLAR_TAG = re.compile(r"\$(?:[^\W\d]\w*)?\$")
_BLOCK = re.compile(r"/\*|\*/")
_QPAIR = {"[": "]", "{": "}", "(": ")", "<": ">"}
_SEG_SPLIT = re.compile("[;:" + _LINE_ENDS + "]")
_PLAIN_MODE = ("none", False, False, False, False, False, False, False, False)
# Readings x characters lexed for one call's strings, at most (under 0.5 s here in the worst case); more
# is refused, fail closed.
_WORK_MAX = 300_000

_w = lambda s: frozenset(s.split())
# Never a code word of a dashboard query (word level: comments and line breaks can't split them).
_FORBIDDEN = _w("""insert update delete merge upsert truncate drop create alter grant revoke deny call exec execute copy
    vacuum analyze analyse attach detach pragma declare into rename begin commit rollback savepoint prepare deallocate
    handler optimize kill shutdown discard unload reindex backup restore dbcc reconfigure checkpoint waitfor purge
    flush install uninstall unlock msck setuser enable disable""")
# Functions that change something or reach outside the database (best effort; called as name(…)).
_SIDE_NAMES = _w("""setval nextval set_config txid_current pg_current_xact_id pg_terminate_backend pg_cancel_backend
    pg_reload_conf pg_rotate_logfile pg_promote pg_switch_wal pg_create_restore_point pg_read_file pg_read_binary_file
    pg_write_file pg_ls_dir pg_stat_file pg_file_write pg_file_unlink pg_file_rename pg_sleep pg_sleep_for
    pg_sleep_until pg_notify pg_logical_emit_message pg_import_system_collations pg_stat_statements_reset
    sleep benchmark get_lock release_lock load_file load_extension sys_exec sys_eval query_to_xml
    query_to_xml_and_xmlschema cursor_to_xml openrowset openquery opendatasource sp_executesql sp_oacreate
    sp_oamethod sp_configure http http_get http_post http_put http_patch http_delete http_head http_request
    ai_query java_method reflect writefile readfile external_query""")
_SIDE_PREFIXES = ("lo_", "dblink", "xp_", "dbms_", "utl_", "pg_advisory", "pg_try_advisory", "pg_stat_reset", "pg_drop_",
                  "pg_create_", "pg_logical_", "pg_replication_")
_SIDE_SCHEMAS = ("cron.", "aws_s3.", "aws_lambda.", "aws_commons.", "net.http")  # pg_cron, RDS, pg_net
# What a free-text value must not read as (see _seg_sql).
_HEADS = _w("""select with insert update delete merge replace upsert truncate drop create alter grant revoke deny call
    exec execute do copy vacuum analyze analyse explain attach detach set use begin commit rollback savepoint lock
    unlock load unload import export pragma reindex cluster refresh declare prepare deallocate handler rename comment
    listen notify unlisten discard reset kill shutdown checkpoint flush purge optimize repair install uninstall backup
    restore dbcc reconfigure waitfor msck cache uncache values table print raiserror bulk save enable disable setuser""")
_ALWAYS = _w("exec execute call dbcc reconfigure shutdown waitfor pragma msck uncache setuser handler")
_SHORT = _w("""truncate vacuum analyze analyse cluster lock unlock discard reset listen notify unlisten deallocate kill
    delete begin commit rollback savepoint flush use detach load install uninstall refresh optimize checkpoint purge
    cache reindex backup restore""")
_OBJECTS = _w("""table tables view views index schema database databases user role group function procedure proc
    trigger sequence extension type domain policy server owned rule event publication subscription tablespace column
    constraint stage warehouse share integration stream task pipe catalog connection login materialized temporary
    temp unique unlogged external global local transaction tran work partition default aggregate operator collation
    conversion language synonym package assembly certificate credential endpoint queue snapshot system session library
    model foreign security statistics resource cursor""")
_LATER = _w("""from into set values table tables where using returning output cascade restrict privileges program stdin
    stdout outfile dumpfile infile overwrite matched select insert update delete merge upsert truncate drop create
    alter grant revoke deny exec execute call copy vacuum attach detach pragma declare commit rollback savepoint kill
    shutdown backup restore dbcc reconfigure checkpoint waitfor unload prepare deallocate""")
_TSQL_NEXT = _w("""top output use print raiserror throw return goto while if begin open fetch close bulk save enable
    disable setuser revert break continue readtext writetext updatetext""")
_AFTER = {**dict.fromkeys(("grant", "revoke", "deny"), _w("to on all")),
          "truncate": _w("restrict cascade continue restart identity only immediate storage partition"),
          "vacuum": _w("full freeze verbose analyze analyse"), "analyze": _w("verbose"), "analyse": _w("verbose"),
          "lock": _w("in mode nowait share exclusive"), "cluster": _w("using verbose on"),
          "kill": _w("query connection"), "set": _w("to on off"), "delete": _TSQL_NEXT,
          **dict.fromkeys(("begin", "commit", "rollback"), _w("transaction work tran")),
          "discard": _w("all plans sequences temp temporary"), "reset": _w("all role session"),
          "do": _w("language"), "explain": _w("analyze analyse plan query verbose"), "load": _w("data extension"),
          "prepare": _w("as"), "declare": _w("cursor"), "refresh": _w("materialized"), "comment": _w("on"),
          "import": _w("foreign")}
_DML = _w("insert update delete merge upsert truncate drop create alter grant revoke deny exec execute call copy")
_STRUCT = frozenset(";(),=<>*@$[]{}|\\#")


def _key(w: str) -> str:
    """A word as compared with the lists above: NFKC (fullwidth letters read as ASCII ones), case-folded."""
    return unicodedata.normalize("NFKC", w).casefold()


def _line_end(s: str, i: int, ends: str) -> int:
    return min((k for k in (s.find(c, i) for c in ends) if k >= 0), default=len(s))


def _comment_end(s: str, i: int, nest: bool) -> int:
    """Index after the /* comment at ``i`` (the end of the text when it never closes)."""
    if not nest:
        j = s.find("*/", i + 2)
        return len(s) if j < 0 else j + 2
    depth = 1
    for m in _BLOCK.finditer(s, i + 2):
        depth += 1 if m.group() == "/*" else -1
        if depth == 0:
            return m.end()
    return len(s)


def _quote_end(s: str, i: int, q: str, prefix: str, mode: tuple) -> int:
    """Index after the literal whose quote ``q`` is at ``i``, or -1 when it never closes."""
    bs, triple, qq = mode[0], mode[7], mode[8]
    n = len(s)
    if q == "'" and qq and prefix in ("q", "nq") and i + 1 < n:  # Oracle q'[…]'
        j = s.find(_QPAIR.get(s[i + 1], s[i + 1]) + "'", i + 2)
        return -1 if j < 0 else j + 2
    esc = ((bs == "all" and q != "`") or (bs == "e" and q == "'" and prefix == "e")
           or (bs == "not_r" and "r" not in prefix))
    end = q * 3 if triple and q != "`" and s.startswith(q * 3, i) else q
    j = i + len(end)
    while j < n:
        if esc and s[j] == "\\":
            j += 2
        elif s.startswith(end, j):
            if len(end) == 1 and s.startswith(q, j + 1):
                j += 2  # a doubled quote stays inside
            else:
                return j + len(end)
        else:
            j += 1
    return -1


def _lex(s: str, mode: tuple) -> tuple:
    """(tokens, open): ``s`` read one way (``mode``, see ``_readings``). A token is (kind, text, start, end):
    "w" a word, "p" a punctuation character, "n" a line break, "s" a '…' literal (and E'', N'', r'', ''',
    q'[]'), "i" a quoted name or "…" text ("…", `…`, […]; text: what is inside), "d" a $tag$ literal, "c" a
    comment. ``open``: the text ends inside a literal (its last token)."""
    _bs, hashc, dashsp, nest, dollar, brackets, lbs, _triple, _qq = mode
    ends = _LINE_ENDS if lbs else "\n"
    out: list = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c in ends:
            out.append(("n", c, i, i + 1))
            i += 1
        elif c.isspace():
            i += 1
        elif c == "_" or c.isalnum():
            m = _WORD.match(s, i)
            j = m.end() if m else i + 1
            out.append(("w", s[i:j], i, j))
            i = j
        elif (c == "-" and s.startswith("--", i) and (not dashsp or i + 2 >= n or s[i + 2] in _DASH_END
                                                     or ord(s[i + 2]) < 32)) or (c == "#" and hashc):
            j = _line_end(s, i, ends)
            out.append(("c", "", i, j))
            i = j
        elif s.startswith("/*", i):
            j = _comment_end(s, i, nest)
            out.append(("c", "", i, j))
            i = j
        elif c in "'\"`" or (c == "[" and brackets):
            if c == "[":
                j = i + 1
                while True:
                    j = s.find("]", j)
                    if j < 0 or not s.startswith("]]", j):
                        break
                    j += 2
                j = -1 if j < 0 else j + 1
            else:
                prev = out[-1] if out else None
                prefix = _key(prev[1]) if prev and prev[0] == "w" and prev[3] == i else ""
                j = _quote_end(s, i, c, prefix, mode)
            kind = "s" if c == "'" else "i"
            if j < 0:
                out.append((kind, s[i + 1:], i, n))
                return out, True
            out.append((kind, s[i + 1:j - 1], i, j))
            i = j
        elif c == "$" and dollar and _DOLLAR_TAG.match(s, i) and not (
                dollar == "pg" and i and (s[i - 1].isalnum() or s[i - 1] in "_$")):  # PostgreSQL: a$q$ is a name
            tag = _DOLLAR_TAG.match(s, i).group()
            j = s.find(tag, i + len(tag))
            if j < 0:
                out.append(("d", "", i, n))
                return out, True
            out.append(("d", "", i, j + len(tag)))
            i = j + len(tag)
        else:
            out.append(("p", c, i, i + 1))
            i += 1
    return out, False


def _readings(s: str) -> list:
    """The ways to read ``s`` that differ for this text: (backslash escapes: none | all but `…` (MySQL) |
    in E'…' only (PostgreSQL) | all but r'…' (BigQuery), # comments, -- only before a space, nested /* */,
    $tag$ quotes (anywhere, or not right after a letter, digit, _ or $ as PostgreSQL reads a$q$ as a name),
    […] names, \r and other line ends end a -- comment, ''' quotes, q'[…]' quotes)."""
    two, one = (False, True), (False,)
    bs = ["none"]
    if "\\" in s:
        bs.append("all")
        if re.search(r"(?<!\w)[eE]'", s):
            bs.append("e")
        if "`" in s or re.search(r"(?<!\w)(?:[rR][bB]?|[bB][rR])['\"]", s):
            bs.append("not_r")
    dims = (bs, two if "#" in s else one, two if "--" in s else one, two if s.count("/*") > 1 else one,
            (False, True, "pg") if "$" in s else one, two if "[" in s else one, two if any(c in s for c in _LINE_ENDS[1:]) else one,
            two if "'''" in s or '"""' in s else one, two if re.search(r"(?<!\w)[nN]?[qQ]'", s) else one)
    return list(itertools.product(*dims))


def _work(s: str, modes: Optional[list] = None) -> int:
    return len(modes if modes is not None else _readings(s)) * max(len(s), 1)


@functools.lru_cache(maxsize=128)
def _views(s: str) -> tuple:
    """``s`` lexed every way ``_readings`` gives (fail closed: more than ``_WORK_MAX`` work is refused)."""
    modes = _readings(s)
    if _work(s, modes) > _WORK_MAX:
        raise LiveError("refused", "the text is too long for the quotes and comments it mixes to be checked")
    return tuple(_lex(s, m) for m in modes)


def _blank(tpl: str) -> str:
    """A template with each ``{{name}}`` as ``0``: the text its holes sit in."""
    return _PARAM.sub("0", tpl)


def _sql_violation(s: str) -> Optional[str]:
    """Why ``s`` is not one read-only statement, or None. In every reading: the first code word is SELECT or
    WITH, no ``;`` is followed by more code, no ``_FORBIDDEN`` word is a code word, no ``_SIDE_NAMES`` /
    ``_SIDE_PREFIXES`` function is called; and at least one reading closes all its quotes."""
    if len(s) > MAX_SQL_CHARS:
        return "the query is over 16,000 characters"
    if "/*!" in s or "/*M!" in s:
        return "a dashboard query can't hold MySQL /*! … */ code comments"
    views = _views(s)
    if all(o for _, o in views):
        return "the query has an unclosed quote"
    for toks, _open in views:
        code = [t for t in toks if t[0] in "wpsid"]
        k = 0
        while k < len(code) and code[k][:2] == ("p", "("):
            k += 1
        if k == len(code):
            continue
        first = code[k]
        # a reading where the text starts with # or - is one where it can't run at all (# and -- aren't comments)
        if not (first[0] == "w" and _key(first[1]) in ("select", "with")) and not (k == 0 and first[:2] in (("p", "#"), ("p", "-"))):
            return "a dashboard runs only read-only queries: one SELECT or WITH statement"
        semi = next((j for j, t in enumerate(code) if t[:2] == ("p", ";")), None)
        if semi is not None and any(t[:2] != ("p", ";") for t in code[semi:]):
            return "a dashboard query must be a single statement"
        for j, t in enumerate(code):
            if t[0] == "w":
                bad = next((p for p in _WORD.findall(_key(t[1])) if p in _FORBIDDEN), None)
                if bad:
                    return f"a dashboard only runs read-only queries (found {bad.upper()})"
            if t[0] == "w" and _key(t[1]) == "system" and j + 1 < len(code) and code[j + 1][2] == t[3] \
                    and s[t[3]:t[3] + 1] == "$":
                return "a dashboard query can't call SYSTEM$ functions"
            if t[0] in "wi" and j + 1 < len(code) and code[j + 1][:2] == ("p", "("):
                name, k = _key(t[1]).strip(), j
                full = name
                while k >= 2 and code[k - 1][:2] == ("p", ".") and code[k - 2][0] in "wi":
                    full, k = _key(code[k - 2][1]).strip() + "." + full, k - 2
                if name in _SIDE_NAMES or name.startswith(_SIDE_PREFIXES) or full.startswith(_SIDE_SCHEMAS):
                    return f"a dashboard query can't call {full}(): it changes something or reaches outside"
    return None


def _structured(toks: list) -> bool:
    """SQL punctuation in code: a literal, quoted name or comment, one of ``_STRUCT``, or a . joining two names."""
    for k, t in enumerate(toks):
        if t[0] in "sidc":
            return True
        if t[0] == "p":
            if t[1] in _STRUCT:
                return True
            if (t[1] == "." and 0 < k < len(toks) - 1 and toks[k - 1][0] in "wi" and toks[k + 1][0] in "wi"
                    and toks[k - 1][3] == t[2] and toks[k + 1][2] == t[3]):
                return True
    return False


def _segments(s: str) -> list:
    """(tokens, after a ;) for each part of ``s`` between ; : and line breaks, in every reading, and in the
    raw text split the same way (so a quote can't hide a later line)."""
    out = []
    for toks, _open in _views(s):
        seg, semi = [], False
        for t in toks:
            if t[0] == "n" or t[:2] in (("p", ";"), ("p", ":")):
                out.append((seg, semi))
                seg, semi = [], t[1] == ";"
            else:
                seg.append(t)
        out.append((seg, semi))
    pos, semi = 0, False
    for m in [*_SEG_SPLIT.finditer(s), None]:
        out.append((_lex(s[pos:m.start() if m else len(s)], _PLAIN_MODE)[0], semi))
        if m:
            pos, semi = m.end(), m.group() == ";"
    return out


def _seg_sql(seg: list, after_semi: bool) -> Optional[str]:
    """The statement word a part of free text starts as a statement with, or None for a phrase. A part whose
    first word is in ``_HEADS`` reads as SQL when: that word is in ``_ALWAYS`` (EXEC, CALL, …); it is the only
    word, or one of two for a statement that can be two words (``_SHORT``: TRUNCATE x, VACUUM x, DELETE x, …);
    the part follows a ``;`` or holds SQL punctuation (``_structured``); its second word is an object type
    (``_OBJECTS``: TABLE, USER, ROLE, …; CREATE OR …); or a later word is in ``_LATER`` (FROM, INTO, SET,
    VALUES, WHERE, SELECT, DELETE, …) or in the words that word takes (``_AFTER``: GRANT … TO, SET … TO,
    TRUNCATE … CASCADE, DELETE x PRINT, …). Anything else ("update on sales", "delete old drafts") is a phrase."""
    words = [_key(t[1]) for t in seg if t[0] == "w"]
    if not words or words[0] not in _HEADS:
        return None
    w0 = words[0]
    if (w0 in _ALWAYS or len(words) == 1 or (len(words) == 2 and w0 in _SHORT) or after_semi or _structured(seg)
            or words[1] in _OBJECTS or (w0 == "create" and words[1] == "or")):
        return w0
    rest = set(words[1:])
    return w0 if rest & _LATER or rest & _AFTER.get(w0, frozenset()) else None


def _sqlish(s: str) -> Optional[str]:
    """The SQL word ``s`` reads as a statement by, or None when it reads as a phrase (fail closed: when in
    doubt it is SQL). Besides ``_seg_sql`` on every part: a side-effect function name anywhere, or a write
    word (INSERT, DELETE, EXEC, …) anywhere in text that holds SQL punctuation."""
    for seg, semi in _segments(s):
        w = _seg_sql(seg, semi)
        if w:
            return w
    for toks, _open in _views(s):
        words = {p for t in toks if t[0] == "w" for p in _WORD.findall(_key(t[1]))}
        hit = (words & _SIDE_NAMES - {"sleep", "benchmark", "http", "reflect"}) | {w for w in words if w.startswith(_SIDE_PREFIXES)}
        if hit:
            return min(hit)
        if words & _DML and _structured([t for t in toks if t[0] != "n"]):
            return min(words & _DML)
    return None


def _is_sql(s: str) -> bool:
    """``s`` is SQL text: its first code word (in some reading) is SELECT or WITH, or it reads as a
    statement (``_sqlish``)."""
    if not s.strip():
        return False
    for toks, _open in _views(s):
        w = next((t for t in toks if t[0] == "w"), None)
        if w and _key(w[1]) in ("select", "with"):
            return True
    return _sqlish(s) is not None


def sql_kind(s: str) -> Optional[str]:
    """"read" for one read-only SELECT/WITH statement, "other" for any other SQL, None for text."""
    try:
        if not _is_sql(s):
            return None
        return "other" if _sql_violation(s) else "read"
    except LiveError:
        return "other"


def _guard_text(v: str, tpl: Any) -> None:
    """One string argument of a call about to run; ``tpl`` the stored template at its place (or None).
    A stored SQL template: the filled text must be one read-only statement. A whole-value hole or text with
    holes that is not SQL: the value is data, but never a SQL statement of its own (``_sqlish``). No
    template: SQL text must be one read-only statement, anything else passes."""
    if _INVISIBLE.search(v):
        raise LiveError("refused", "the call holds invisible or direction-changing characters")
    if len(v) > MAX_SQL_CHARS:
        if set(_WORD.findall(_key(v))) & _HEADS:
            raise LiveError("refused", "the query is over 16,000 characters")
        return
    holes = isinstance(tpl, str) and _PARAM.search(tpl) is not None
    sql_tpl = holes and _is_sql(_blank(tpl))
    if holes and not sql_tpl:
        w = _sqlish(v)
        if w:
            raise LiveError("refused", f"a filter value can't be a SQL statement (this one reads as {w.upper()} …)")
        return
    if sql_tpl or _is_sql(v):
        bad = _sql_violation(v)
        if bad:
            raise LiveError("refused", bad)


def guard(args: Any, template: Any = None) -> None:
    """Refuse calls that could write (fail closed), string by string (``_guard_text``), nested objects and
    lists too; ``template`` is the stored args the call was filled from, walked alongside. The arguments
    stay under 36 KB."""
    if len(json.dumps(args, ensure_ascii=False, default=str)) > MAX_ARGS_CHARS:
        raise LiveError("refused", "the query's arguments are too long")
    found: list = []

    def walk(v, t):
        if isinstance(v, dict):
            for k, x in v.items():
                walk(x, t.get(k) if isinstance(t, dict) else None)
        elif isinstance(v, list):
            for k, x in enumerate(v):
                walk(x, t[k] if isinstance(t, list) and k < len(t) else None)
        elif isinstance(v, str):
            found.append((v, t))
    walk(args, template)
    if sum(_work(v) for v, _t in found if len(v) <= MAX_SQL_CHARS) > _WORK_MAX:  # the whole call, before lexing
        raise LiveError("refused", "the call's text is too long for the quotes and comments it mixes to be checked")
    for v, t in found:
        _guard_text(v, t)


def _strings(v: Any):
    if isinstance(v, dict):
        for x in v.values():
            yield from _strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from _strings(x)
    elif isinstance(v, str):
        yield v


def problems(d: dict) -> list:
    """What makes a stored live call one that can never run, as short sentences (empty when none): an
    invisible character, an enum value no filter may take, SQL text that is not one read-only statement
    (holes read as ``0``), a hole outside a plain '…' literal of SQL without a number rule or enum of names."""
    out = []
    try:
        blob = json.dumps({k: d.get(k) for k in ("tool", "args", "rules", "poll")}, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return ["its arguments aren't JSON"]
    if _INVISIBLE.search(blob):
        out.append("it holds invisible or direction-changing characters")
    for n, rule in (d.get("rules") or {}).items() if isinstance(d.get("rules"), dict) else ():
        if not _enum_safe(rule):
            out.append(f"the enum of {n!r} holds a value no filter may take (allowed: letters, digits, space "
                       "and _ . - : / @ + , up to 100 characters)")
    rules = d.get("rules") if isinstance(d.get("rules"), dict) else {}
    for s in [*_strings(d.get("args")), *_strings((d.get("poll") or {}).get("args"))]:
        if _WHOLE.match(s):
            continue
        try:
            t0 = _blank(s)
            if _is_sql(t0):
                bad = _sql_violation(t0)
                if bad:
                    out.append(bad)
                for m, kind in zip(_PARAM.finditer(s), _hole_sql(s)):
                    if kind == "raw" and not _raw_ok(rules.get(m.group(1))):
                        out.append(f"filter {m.group(1)!r} sits in SQL outside a plain '…' literal: {_RAW_FIX}")
        except LiveError as e:
            out.append(e.message)
    return list(dict.fromkeys(out))


def check_dashboard(raw: Any) -> list:
    """``problems`` of every live call in a dashboard.json (text, bytes or parsed), as "dataset 'x': …"."""
    try:
        spec = json.loads(raw) if isinstance(raw, (str, bytes, bytearray)) else raw
    except ValueError:
        return []
    if not isinstance(spec, dict) or not isinstance(spec.get("datasets"), dict):
        return []
    return [f"dataset {dsid!r}: {p}" for dsid, d in _live_sources(spec) for p in problems(d)]


# ----------------------------------------------------------------------------- running it
#
# Every call goes through ctx.call_mcp(server, tool, args): Hermes' own MCP client with its trust gates and
# the plugin's default-deny allowlist. The plugin context is the one Hermes handed register(); the web
# server imports this module under another name (dashboard/plugin_api.py), so it is found by looking.

PLUGIN_ID = "hermes-artifacts"
ALLOWLIST_KEY = f"plugins.entries.{PLUGIN_ID}.mcp_allowlist"
CALL_TIMEOUT_S = 120
_CTX = None


def set_ctx(ctx) -> None:
    global _CTX
    _CTX = ctx


def _plugin_ctx():
    """The ctx Hermes gave this plugin's register(), in whichever module copy holds it."""
    if _CTX is not None:
        return _CTX
    me = sys.modules.get(__name__)
    for mod in list(sys.modules.values()):
        try:
            if mod is me or getattr(mod, "PLUGIN_ID", None) != PLUGIN_ID:
                continue
            c = getattr(mod, "_ctx", None) or getattr(mod, "_CTX", None)
        except Exception:  # a lazy module whose attribute lookup imports or fails
            continue
        if c is not None and callable(getattr(c, "call_mcp", None)):
            return c
    return None


def _no_ctx() -> "LiveError":
    return LiveError("error", "live data needs Hermes to load the hermes-artifacts plugin in this server "
                              "(restart Hermes; it needs ctx.call_mcp)")


def _known_servers() -> list[str]:
    """MCP server names as configured (mcp_servers) and as allowed for this plugin: the exact spelling
    call_mcp and the allowlist expect, where a tool name only has them with dashes turned to underscores."""
    try:
        from hermes_cli.config import load_config_readonly
        cfg = load_config_readonly() or {}
    except Exception:
        return []
    servers = cfg.get("mcp_servers")
    out = [str(k) for k in servers] if isinstance(servers, dict) else []
    return list(dict.fromkeys(out + allowlist()))


_san = lambda n: re.sub(r"[^A-Za-z0-9_]", "_", str(n or "")).lower()


def server_of(tool: str) -> Optional[str]:
    """The MCP server a tool belongs to, read from its name (``mcp__<server>__<tool>``, or the older
    ``mcp_<server>_<tool>``, the server's name with every other character turned to ``_``) and matched to
    the configured servers (``mcp_servers`` keys and the allowlist). Two configured servers that read the
    same in the name (``foo-bar``, ``foo_bar``): None, the call is refused rather than sent to either."""
    if not isinstance(tool, str) or not tool.lower().startswith("mcp_"):
        return None
    known = _known_servers()
    low = tool.lower()
    hits = [n for n in known if low.startswith(f"mcp__{_san(n)}__") or low.startswith(f"mcp_{_san(n)}_")]
    if hits:
        best = max(len(_san(n)) for n in hits)
        top = {n for n in hits if len(_san(n)) == best}
        return top.pop() if len(top) == 1 else None
    if low.startswith("mcp__") and "__" in tool[5:]:
        guess = tool[5:].split("__", 1)[0]
    else:
        m = re.match(r"^mcp_([^_]+)_", tool)
        guess = m.group(1) if m else None
    if not guess:
        return None
    return next((n for n in known if _san(n) == _san(guess)), guess)


def split_tool(tool: str) -> tuple[Optional[str], Optional[str]]:
    """(server, the server's own tool name) for a Hermes MCP tool name, or (None, None)."""
    server = server_of(tool)
    if not server:
        return None, None
    for prefix in (f"mcp__{_san(server)}__", f"mcp__{server.lower()}__", f"mcp_{_san(server)}_"):
        if tool.lower().startswith(prefix) and len(tool) > len(prefix):
            return server, tool[len(prefix):]
    return None, None


_AUTH_TEXT = re.compile(r"re-?authenticat|needs?[_ ]re-?auth|401|unauthori[sz]ed|token (has )?expired|invalid[_ ]token|"
                        r"sign in again|log ?in again|hermes mcp login", re.I)
_ABSENT_TEXT = re.compile(r"is not connected|unreachable|transport is down|not configured|unknown (mcp )?server", re.I)


# The grant is the user's: Hermes reads ALLOWLIST_KEY on every call and offers no prompt for it, and the
# plugin never writes it. What it can do is hand over the one command that sets it. `hermes config set`
# replaces the whole list and parses the value as YAML, so the command carries every grant the user has
# plus the missing ones, each a plain name YAML reads back as the same string. A name outside that (a
# server named in a model-written dashboard.json) gets no command: the user pastes it into a shell.
ALLOW_COMMAND_PREFIX = f"hermes config set {ALLOWLIST_KEY} '["
_PLAIN_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,100}\Z")
_YAML_WORDS = {"y", "yes", "n", "no", "true", "false", "on", "off", "null"}


def _plain_name(name: Any) -> bool:
    if not isinstance(name, str) or not _PLAIN_NAME.match(name):
        return False
    try:
        import yaml
    except ImportError:  # no YAML to ask: a letter first and no YAML word is a string for sure
        return name[0].isalpha() and name.lower() not in _YAML_WORDS
    try:
        return yaml.safe_load(f"[{name}]") == [name]  # not a number, date, bool or null to YAML
    except Exception:
        return False


def _managed() -> bool:
    """A managed install refuses ``hermes config set``: its administrator sets the allowlist."""
    try:
        from hermes_cli.config import is_managed
        return bool(is_managed())
    except Exception:
        return False


def allow_command(missing: Any) -> Optional[str]:
    """The one ``hermes config set`` that lets this plugin call ``missing`` (server names) as well as
    every server it may call now, de-duplicated in that order; None when there is nothing to add, the
    install is managed, the current list can't be read, or any name is not plain."""
    want = [s for s in (missing or []) if isinstance(s, str)]
    granted = _granted()
    if not want or granted is None or _managed():
        return None
    names = list(dict.fromkeys(granted + want))
    if not all(_plain_name(n) for n in names):
        return None
    return f"{ALLOW_COMMAND_PREFIX}{', '.join(names)}]'"


def denied_message(server: str) -> str:
    """What a denied source says. The page reads it, so it names only its own server, never the command
    or the user's other grants: those are in Hermes Desktop's own dialog (``allow_help``)."""
    if _managed():
        return (f"Hermes doesn't let hermes-artifacts call the MCP server {server!r}. This Hermes install is managed: "
                f"ask its administrator to add {server!r} to {ALLOWLIST_KEY}.")
    return (f"Hermes doesn't let hermes-artifacts call the MCP server {server!r} until it is in {ALLOWLIST_KEY}. "
            f"To allow it: Show the command, run it in a terminal, then reload.")


def run_tool(tool: str, args: dict) -> Any:
    """Call an MCP tool by its Hermes name through ctx.call_mcp and return its decoded answer."""
    server, name = split_tool(tool)
    if not server:
        raise LiveError("refused", f"{tool!r} is not an MCP tool; a dashboard can only run MCP tools")
    ctx = _plugin_ctx()
    if ctx is None or not callable(getattr(ctx, "call_mcp", None)):
        raise _no_ctx()
    try:
        env = ctx.call_mcp(server, name, dict(args or {}), timeout=CALL_TIMEOUT_S)
    except PermissionError:
        raise LiveError("denied", denied_message(server), server=server, config=ALLOWLIST_KEY)
    except Exception as e:  # the client itself raised
        text = f"{type(e).__name__}: {str(e)[:1000]}"
        if _AUTH_TEXT.search(text):
            raise LiveError("reauth", f"Sign in to {server} again: {text}", server=server)
        raise LiveError("failed", text)
    return _answer(env, server)


def _answer(env: Any, server: str) -> Any:
    """call_mcp's envelope ({ok, result | error, structuredContent?, truncated?}) as data."""
    if not isinstance(env, dict) or "ok" not in env:
        return decode(env)
    if not env.get("ok"):
        err = env.get("error")
        text = (err.get("message") or json.dumps(err, ensure_ascii=False)) if isinstance(err, dict) else str(err or "")
        text = text[:2000] or "the tool reported an error"
        if (isinstance(err, dict) and err.get("needs_reauth")) or _AUTH_TEXT.search(text):
            raise LiveError("reauth", f"Sign in to {server} again: {text}", server=server)
        if _ABSENT_TEXT.search(text):
            raise LiveError("absent", f"{server} is not connected ({text}).", server=server)
        raise LiveError("failed", text)
    if env.get("truncated"):
        raise LiveError("failed", "the answer is over 64 KB, the most Hermes hands a plugin: ask for less in the query "
                                  "(aggregate, filter, LIMIT)")
    if env.get("structuredContent") is not None:
        return env["structuredContent"]
    try:
        return decode(env.get("result"))
    except LiveError as e:
        if e.status == "failed" and _AUTH_TEXT.search(e.message):
            raise LiveError("reauth", f"Sign in to {server} again: {e.message}", server=server)
        raise


# ----------------------------------------------------------------------------- calls the agent ran
#
# post_tool_call records the MCP calls the agent really made (per session, the last 100 of the last 64
# sessions, in memory: the publish that uses them comes in the same process and turn). At publish a
# dataset is approved without asking only when it matches one of them (``recorded_match``).

_RAN: "OrderedDict[str, deque]" = OrderedDict()
_RAN_LOCK = threading.Lock()
RAN_PER_SESSION, RAN_SESSIONS = 100, 64


def record_call(session: Any, tool: Any, args: Any, status: Any = None) -> bool:
    """Remember one MCP call the agent ran (post_tool_call). Only a call Hermes reports as status "ok" is
    kept: an error, a blocked, cancelled or timed-out call, or one without a status, never ran as asked."""
    if not session or not isinstance(tool, str) or not tool.lower().startswith("mcp_") or status != "ok":
        return False
    if not isinstance(args, dict):
        return False
    try:
        blob = json.dumps(args, sort_keys=True, ensure_ascii=False)
    except (TypeError, ValueError):
        return False
    if len(blob) > MAX_ARGS_CHARS:
        return False
    with _RAN_LOCK:
        q = _RAN.pop(str(session), None) or deque(maxlen=RAN_PER_SESSION)
        q.append((tool, json.loads(blob)))
        _RAN[str(session)] = q
        while len(_RAN) > RAN_SESSIONS:
            _RAN.popitem(last=False)
    return True


def recorded(session: Any) -> list:
    with _RAN_LOCK:
        return list(_RAN.get(str(session), ())) if session else []


def _same(a: Any, b: Any) -> bool:
    """Two values bound to one name agree (a text hole holds ("text", the text found))."""
    text = lambda v: v[1] if isinstance(v, tuple) else v if isinstance(v, str) else json.dumps(v)
    if isinstance(a, tuple) or isinstance(b, tuple):
        return text(a) == text(b)
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def _bind(tpl: Any, val: Any, b: dict) -> bool:
    """Unify an args template with args the agent ran: equal everywhere except at ``{{name}}``, where
    the value ran is bound (one value per name). Text holes bind the text found there."""
    if isinstance(tpl, dict):
        return isinstance(val, dict) and set(tpl) == set(val) and all(_bind(tpl[k], val[k], b) for k in tpl)
    if isinstance(tpl, list):
        return isinstance(val, list) and len(tpl) == len(val) and all(_bind(t, v, b) for t, v in zip(tpl, val))
    if isinstance(tpl, str) and _PARAM.search(tpl):
        m = _WHOLE.match(tpl)
        if m:
            n = m.group(1)
            if n in b and not _same(b[n], val):
                return False
            b[n] = val
            return True
        if not isinstance(val, str):
            return False
        seen, rx, pos, where = set(), "", 0, {}
        for mm, sql in zip(_PARAM.finditer(tpl), _hole_sql(tpl)):
            rx += re.escape(tpl[pos:mm.start()])
            n = mm.group(1)
            rx += f"(?P={n})" if n in seen else f"(?P<{n}>.*?)"
            seen.add(n)
            # a name used in two places is held to the stricter one (raw SQL, then a SQL literal)
            where[n] = max(where.get(n), sql, key=lambda s: {None: 0, "quoted": 1, "raw": 2, "comment": 3}[s])
            pos = mm.end()
        rx += re.escape(tpl[pos:])
        hit = re.fullmatch(rx, val, re.S)
        if not hit:
            return False
        for n, v in hit.groupdict().items():
            if n in b and not _same(b[n], ("text", v)):
                return False
            if n in b and isinstance(b[n], tuple):
                b[n] = ("text", v, max(b[n][2], where[n], key=lambda s: {None: 0, "quoted": 1, "raw": 2, "comment": 3}[s]))
            b.setdefault(n, ("text", v, where[n]))
        return True
    return type(tpl) is type(val) and tpl == val


def _check_bound(b: dict, rules: dict) -> None:
    """Every value ``_bind`` found passes its hole's rule, as ``fill`` would check it (LiveError if not)."""
    for n, v in b.items():
        rule = rules.get(n)
        if isinstance(v, tuple):
            _check(n, _text_value(v[1], rule), rule, True, v[2])
        else:
            _check(n, v, rule, False)


def _answer_holes(tpl: Any, rules: dict) -> tuple:
    """A poll call's args template with each ``{{answer.…}}`` as a hole of its own (one plain token from
    the answer), and the rules to match it with."""
    rules, k, taken = dict(rules), [0], names(tpl)

    def walk(v):
        if isinstance(v, dict):
            return {key: walk(x) for key, x in v.items()}
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, str):
            def sub(_m):
                while f"__answer{k[0]}" in taken or f"__answer{k[0]}" in rules:
                    k[0] += 1
                name = f"__answer{k[0]}"
                rules[name] = _ANSWER_RULE
                return "{{" + name + "}}"
            return _ANSWER_REF.sub(sub, v)
        return v
    return walk(tpl), rules


def args_match(tpl: Any, args: Any, rules: dict) -> bool:
    """``args`` are ``tpl`` with only its ``{{holes}}`` filled, each value passing its rule."""
    b: dict = {}
    try:
        return _bind(tpl, args, b) and (_check_bound(b, rules) or True)
    except LiveError:
        return False


def _text_value(v: str, rule: Any) -> Any:
    """Text found at a hole, as the typed value its rule expects (a number only as a plain decimal)."""
    t = rule.get("type") if isinstance(rule, dict) else None
    if t == "number":
        if not _DECIMAL.fullmatch(v):
            return v
        return float(v) if "." in v else int(v)
    if t == "boolean":
        return {"true": True, "false": False}.get(v, v)
    return v


def _auto_ok(tpl: Any, rules: dict) -> bool:
    """Every hole in ``tpl`` is a data hole with a pinning rule, so filters can only vary quoted values and
    numbers: a whole-argument value (enum, number or boolean rule), a hole inside a '…' literal of SQL text in
    every reading (enum, number or boolean), or a number or boolean in SQL text; every enum value safe. A hole
    in prose or in a name/keyword place of SQL (``FROM {{t}}``) never is."""
    for s in _strings(tpl):
        if not _PARAM.search(s):
            continue
        whole = _WHOLE.match(s)
        found = [("whole", whole.group(1))] if whole else list(zip(_hole_sql(s), (m.group(1) for m in _PARAM.finditer(s))))
        for kind, n in found:
            rule = rules.get(n)
            if rule is _ANSWER_RULE:
                continue
            if not _pinned(rule) or not _enum_safe(rule):
                return False
            if kind not in ("whole", "quoted") and not (kind == "raw" and rule.get("type") in ("number", "boolean")):
                return False
    return True


def recorded_match(session: Any, d: dict) -> bool:
    """True when the agent ran this dataset's call in ``session`` and its filters can only vary data. The
    rule, strict on purpose:
    - the same tool, by the exact name the agent called it;
    - args equal to a call it ran (key for key, value for value, text character for character), except at
      ``{{name}}`` holes, each a data hole with a pinning rule (``_auto_ok``), the value the agent ran there
      passing it;
    - a poll call, when the source has one, must match a call the agent ran the same way (its
      ``{{answer.…}}`` holes take one plain token each);
    - nothing in it that ``problems`` finds."""
    calls = recorded(session)
    if not calls or problems(d):
        return False
    try:
        if not _auto_ok(d["args"], d["rules"]):
            return False
        if not any(tool == d["tool"] and args_match(d["args"], args, d["rules"]) for tool, args in calls):
            return False
        poll = d.get("poll")
        if poll:
            ptpl, prules = _answer_holes(poll.get("args") or {}, d["rules"])
            if not _auto_ok(ptpl, prules):
                return False
            if not any(tool == poll["tool"] and args_match(ptpl, args, prules) for tool, args in calls):
                return False
    except LiveError:
        return False
    return True


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
        if out.get("needs_reauth"):
            raise LiveError("reauth", str(out.get("error") or "the connector needs a new sign-in")[:2000],
                            server=out.get("server"))
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


# ----------------------------------------------------------------------------- the last answer, kept 24 h
#
# The model Claude's dashboards use: every open, refresh and filter change runs the query live. The last
# answer is kept (24 h, on disk, so a restart keeps it) only to paint something at once while the live
# call runs, and to draw gallery thumbnails without running every dashboard's queries.

KEEP_S = 24 * 3600
_MEM_MAX = 300


def _cache_dir(aid: str):
    return store._dir(aid) / "cache"


def cache_get(aid: str, key: str) -> Optional[dict]:
    with _cache_lock:
        hit = _cache.get(key)
    if hit is None:
        p = _cache_dir(aid) / f"{key}.json"
        try:
            hit = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
    if time.time() - hit.get("at", 0) > KEEP_S:
        return None
    with _cache_lock:
        _cache[key] = hit
    return hit


def cache_put(aid: str, key: str, payload: dict) -> float:
    at = time.time()
    entry = {"at": at, "payload": payload}
    with _cache_lock:
        _cache[key] = entry
        if len(_cache) > _MEM_MAX:
            for k in sorted(_cache, key=lambda k: _cache[k]["at"])[:_MEM_MAX // 3]:
                _cache.pop(k, None)
    try:
        d = _cache_dir(aid)
        d.mkdir(exist_ok=True)
        blob = json.dumps(entry, ensure_ascii=False, default=str)
        if len(blob) <= MAX_ANSWER_BYTES:
            tmp = d / f"{key}.tmp"
            tmp.write_text(blob, encoding="utf-8")
            os.replace(tmp, d / f"{key}.json")
        for old in d.glob("*.json"):  # drop answers past their 24 h
            try:
                if at - old.stat().st_mtime > KEEP_S:
                    old.unlink()
            except OSError:
                pass
    except OSError:
        pass
    return at


def run_dataset(aid: str, dsid: str, params: dict, *, version: Optional[int] = None, mode: str = "live") -> dict:
    """Run one live dataset. ``mode="live"`` (open, refresh, filter change) always runs the call;
    a call already running with the same arguments is shared, not repeated. ``mode="cached"`` returns
    the last answer when there is one (a thumbnail, or the instant first paint before the live call),
    and runs the call only when there is none."""
    d = dataset(aid, dsid, version)
    cid = _cid(d)
    info = {"tool": d["tool"], "call": cid}
    if not store.approved(aid, cid):
        return {"status": "approval", **info, "args": d["args"], "rules": d["rules"]}
    used = names(d["args"])
    merged = {k: v for k, v in {**d["defaults"], **(params or {})}.items() if k in used}
    try:
        args = fill(d["args"], merged, d["rules"])
        guard(args, d["args"])
    except LiveError as e:
        return {"status": e.status if e.status in ("refused",) else "error", "message": e.message, **info, **e.extra}
    key = hashlib.sha256(json.dumps([aid, cid, args], sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
    if mode == "cached":
        hit = cache_get(aid, key)
        if hit:
            return {**hit["payload"], "cached": True, "at": hit["at"]}
    with _cache_lock:
        wait = _inflight.get(key)
        if wait is None:
            _inflight[key] = threading.Event()
    if wait is not None:  # the same call is already running (another viewer, a thumbnail): share its answer
        wait.wait(180)
        hit = cache_get(aid, key)
        if hit:
            return {**hit["payload"], "cached": False, "at": hit["at"], "shared": True}
    started = time.time()
    try:
        answer = run_polling(d["tool"], args, d.get("poll"))
        table = rows_of(answer)
        payload = {"status": "ok", **info, "args": args, "ms": int((time.time() - started) * 1000)}
        if table is not None:
            payload.update(table)
        # The answer as the tool gave it too: a page's loader reads that (Claude's fn({answer, ...})).
        if table is None or len(json.dumps(answer, ensure_ascii=False, default=str)) <= MAX_ANSWER_BYTES // 2:
            payload["answer"] = answer
        at = cache_put(aid, key, payload)
        return {**payload, "cached": False, "at": at}
    except LiveError as e:
        return {"status": e.status, "message": e.message, **info, "args": args, **e.extra}
    except Exception as e:  # the tool itself raised
        return {"status": "failed", "message": f"{type(e).__name__}: {str(e)[:1000]}", **info, "args": args}
    finally:
        with _cache_lock:
            ev = _inflight.pop(key, None)
        if ev:
            ev.set()


def _stored_tool(tool: str, d: dict) -> str:
    """A loader names a tool the way its connector does (``get_query_results``) or by its Hermes name
    (``mcp_bigquery_get_query_results``): either way it must be the dataset's stored tool or its stored
    poll tool, the calls its approval covers. Any other tool, even of the same server, is refused."""
    allowed = [d["tool"]] + ([d["poll"]["tool"]] if d.get("poll") else [])
    want = str(tool or "")
    ws, wr = split_tool(want) if want.lower().startswith("mcp_") else (None, None)
    for t in allowed:
        if want == t:
            return t
        server, raw = split_tool(t)
        if raw and (_san(want) == _san(raw) or (ws == server and wr and _san(wr) == _san(raw))):
            return t
    raise LiveError("refused", f"{want!r} is not this dataset's stored tool: a loader may call only "
                               f"{' or '.join(allowed)} (another one goes in the source's poll.tool)")


def loader_call(aid: str, dsid: str, tool: str, args: Any, version: Optional[int] = None) -> dict:
    """``call(tool, args)`` inside a dataset's loader (Claude's): the dataset's own stored tool or its
    poll tool, for a query left running or a further page. Only for an approved dataset, only with the
    approved args (the stored args with their filters filled in, each passing its rule, or the stored
    poll args with their ``{{answer.…}}`` values), only read-only queries; the answer goes back as data."""
    d = dataset(aid, dsid, version)
    if not store.approved(aid, _cid(d)):
        return {"status": "approval", "message": "this dataset's query isn't allowed yet"}
    if not isinstance(args, dict):
        return {"status": "refused", "message": "call() takes the tool's arguments as an object"}
    try:
        name = _stored_tool(str(tool or ""), d)
        poll = d.get("poll")
        tpl = d["args"] if name == d["tool"] and args_match(d["args"], args, d["rules"]) else None
        if tpl is None and poll and name == poll["tool"]:
            ptpl, prules = _answer_holes(poll.get("args") or {}, d["rules"])
            tpl = ptpl if args_match(ptpl, args, prules) else None
        if tpl is None:
            raise LiveError("refused", "call() sends the stored args with only their {{filters}} filled in (or the "
                                       "stored poll.args with their {{answer.…}} values): these differ")
        guard(args, tpl)
        started = time.time()
        answer = run_tool(name, args)
        return {"status": "ok", "answer": answer, "tool": name, "ms": int((time.time() - started) * 1000)}
    except LiveError as e:
        return {"status": e.status, "message": e.message, **e.extra}
    except Exception as e:
        return {"status": "failed", "message": f"{type(e).__name__}: {str(e)[:1000]}"}


def edit_args(aid: str, dsid: str, args: Any, base_version: Optional[int] = None) -> dict:
    """Replace the ``args`` of one existing live dataset and publish that as a new version. The tool
    and rules stay as the agent stored them, so the edit can not point the dashboard at another tool;
    the changed call waits for the user's yes in Hermes Desktop's own dialog (the save comes from the
    page, and nothing a page does counts as consent)."""
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
    store.history_add(aid, dsid, d["source"].get("args") or {}, "before edit")
    d["source"]["args"] = args
    d["edit"] = {"via": "user", "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    nm = store.publish(aid=aid, base=True, files={"dashboard.json": spec}, by="user")
    store.history_add(aid, dsid, args, "user")
    return {"ok": True, "version": nm["versions"][-1]["n"]}


def _live_sources(spec: dict):
    for dsid, raw in (spec.get("datasets") or {}).items():
        src = ((raw or {}).get("source") or {}) if isinstance(raw, dict) else {}
        if src.get("kind") in ("call", "query") and isinstance(src.get("tool"), str) and isinstance(src.get("args", {}), dict):
            poll = src.get("poll") if isinstance(src.get("poll"), dict) and isinstance(src["poll"].get("tool"), str) else None
            yield dsid, {"tool": src["tool"], "args": src.get("args") or {}, "rules": src.get("rules") or {}, "poll": poll}


def approve_published(aid: str, session: Any, always_ask: bool = False) -> dict:
    """At the agent's publish: a live call is approved without asking only when the agent ran it in this
    session (``recorded_match``) and ``require_approval`` is off. A call that can never run (``problems``)
    is refused; the rest waits for the user's yes in Hermes Desktop. Returns {"approved": n, "waiting":
    [dataset ids], "refused": {dataset id: why}, "blocked": [servers]}."""
    try:
        spec = json.loads(store.read_file(aid, "dashboard.json").decode("utf-8"))
    except (FileNotFoundError, ValueError):
        return {"approved": 0, "waiting": [], "refused": {}, "blocked": []}
    approved, waiting, refused = 0, [], {}
    for dsid, d in _live_sources(spec if isinstance(spec, dict) else {}):
        cid = _cid(d)
        store.history_add(aid, dsid, d["args"], "agent")
        bad = problems(d)
        if bad:
            refused[dsid] = bad[0]
        elif store.approved(aid, cid):
            approved += 1
        elif not always_ask and recorded_match(session, d):
            store.set_approval(aid, cid, d["tool"], True)
            approved += 1
        else:
            waiting.append(dsid)
    blocked, servers = _blocked(spec if isinstance(spec, dict) else {})
    return {"approved": approved, "waiting": waiting, "refused": refused, "blocked": blocked,
            "command": allow_command(servers)}


def _blocked(spec: dict) -> tuple[list, list]:
    """(what the dashboard's live sources name that Hermes won't let this plugin call, the MCP servers
    among them). A tool whose server can't be read from its name is listed by its name, in no command."""
    allowed = set(allowlist())  # Hermes compares the server name exactly
    named, servers = set(), set()
    for _dsid, d in _live_sources(spec):
        server = server_of(d["tool"])
        if server not in allowed:
            named.add(server or d["tool"])
            if server:
                servers.add(server)
    return sorted(named), sorted(servers)


def allow_help(aid: str) -> dict:
    """For Hermes Desktop's own dialog (host only, never the page): the servers this dashboard needs that
    the allowlist lacks, and the command that adds them (None: no safe command, say it in words)."""
    try:
        spec = json.loads(store.read_file(aid, "dashboard.json").decode("utf-8"))
    except (FileNotFoundError, ValueError):
        spec = {}
    blocked, servers = _blocked(spec if isinstance(spec, dict) else {})
    return {"servers": blocked, "command": allow_command(servers), "managed": _managed(), "config": ALLOWLIST_KEY}


def _granted() -> Optional[list[str]]:
    """``plugins.entries.hermes-artifacts.mcp_allowlist`` read the way Hermes' gate reads it (config.yaml
    through ``hermes_cli.config``, a non-list grants nothing), or None when the config can't be read."""
    try:
        from hermes_cli.config import load_config_readonly
        cfg = load_config_readonly() or {}
    except Exception:
        return None
    entry = (((cfg.get("plugins") or {}).get("entries") or {}).get(PLUGIN_ID) or {})
    allow = entry.get("mcp_allowlist") if isinstance(entry, dict) else None
    return [str(x) for x in allow] if isinstance(allow, list) else []


def allowlist() -> list[str]:
    """The MCP servers the user lets this plugin call (plugins.entries.hermes-artifacts.mcp_allowlist)."""
    return _granted() or []


def free_holes(d: dict) -> list:
    """The filters of a call that pass any text typed into the page (no enum, number or boolean rule)."""
    found = names(d["args"]) | names((d.get("poll") or {}).get("args") or {})
    return sorted(n for n in found if not _pinned(d["rules"].get(n)))


def pending(aid: str, dsid: str, version: Optional[int] = None, args: Any = None, dialog: bool = True) -> dict:
    """The stored call (or, for Sources' Test, these args on its tool) as Hermes Desktop shows it in its
    approval dialog, with the id the approval is stored under, and ``free``: its filters that pass any text.
    For the host only, never the page. ``dialog``: a call that could never run (``problems``: invisible or
    direction-changing characters, writes, a filter that may not stand where it is) is refused, so the
    dialog never offers what ``guard`` then refuses; declining (``dialog=False``) still works."""
    d = dataset(aid, dsid, version)
    if args is not None:
        if not isinstance(args, dict):
            raise LiveError("error", "args must be an object")
        d = {**d, "args": args}
    cid = _cid(d)
    if dialog and _INVISIBLE.search(json.dumps([d["tool"], d["args"], d["rules"], d.get("poll")], ensure_ascii=False, default=str)):
        raise LiveError("refused", "this query holds invisible or direction-changing characters, so what a dialog "
                                   "shows could differ from what runs: it can't be allowed")
    bad = problems(d) if dialog else []
    if bad:
        raise LiveError("refused", f"this query can't run, so it can't be allowed: {bad[0]}")
    return {"id": dsid, "tool": d["tool"], "args": d["args"], "rules": d["rules"], "poll": d.get("poll"),
            "free": free_holes(d), "call": cid, "approved": store.approved(aid, cid)}


def decide(aid: str, dsid: str, call: Any, allowed: bool, version: Optional[int] = None, args: Any = None) -> dict:
    """The user's answer in the host's dialog. ``call`` is the id the dialog showed: a query changed since
    is refused, so what gets approved is exactly what the user saw."""
    p = pending(aid, dsid, version, args)
    if str(call or "") != p["call"]:
        raise LiveError("refused", "the query changed since it was shown: look at it again")
    store.set_approval(aid, p["call"], p["tool"], bool(allowed))
    return {"ok": True, "call": p["call"], "allowed": bool(allowed)}


def test_args(aid: str, dsid: str, args: Any, params: Optional[dict] = None) -> dict:
    """Run edited args for one live dataset without saving them (Sources' Test). Same tool, rules,
    guard and MCP-only rule as a saved query, and the same approval (these args on that tool); the
    answer is not cached."""
    if not isinstance(args, dict):
        raise LiveError("error", "args must be an object")
    d = dataset(aid, dsid)
    cid = call_id(d["tool"], args, d["rules"], d.get("poll"))
    if not store.approved(aid, cid):
        return {"status": "approval", "tool": d["tool"], "args": args, "call": cid,
                "message": "running this query needs your yes in Hermes Desktop"}
    used = names(args)
    merged = {k: v for k, v in {**d["defaults"], **(params or {})}.items() if k in used}
    try:
        filled = fill(args, merged, d["rules"])
        guard(filled, args)
    except LiveError as e:
        return {"status": e.status if e.status in ("refused",) else "error", "message": e.message, **e.extra}
    started = time.time()
    try:
        answer = run_polling(d["tool"], filled, d.get("poll"))
        table = rows_of(answer)
        out = {"status": "ok", "tool": d["tool"], "args": filled, "ms": int((time.time() - started) * 1000), "test": True}
        if table is not None:
            out.update({"columns": table["columns"], "rows": table["rows"][:200], "total": len(table["rows"])})
        else:
            out["answer"] = answer
        return out
    except LiveError as e:
        return {"status": e.status, "message": e.message, "args": filled, **e.extra}
    except Exception as e:
        return {"status": "failed", "message": f"{type(e).__name__}: {str(e)[:1000]}", "args": filled}


# ----------------------------------------------------------------------------- queries still running
#
# Warehouses answer a long query with "still running" (BigQuery: jobComplete false; Databricks: a
# PENDING/RUNNING statement). The dashboard then asks again, 2 s doubling to 20 s, for up to 3 minutes,
# the way Claude's dashboards poll: through the source's "poll" call when it names one (its args can
# take values from the answer, "{{answer.jobReference.jobId}}"), else by repeating the same call.

POLL_FIRST_S, POLL_MAX_S, POLL_DEADLINE_S = 2.0, 20.0, 180.0
_RUNNING_STATES = {"PENDING", "RUNNING", "QUEUED", "IN_PROGRESS", "STARTING", "SUBMITTED"}
_ANSWER_REF = re.compile(r"\{\{\s*answer((?:\.[A-Za-z_][\w-]*|\[\d+\])+)\s*\}\}")


def still_running(answer: Any) -> bool:
    if isinstance(answer, dict):
        if answer.get("jobComplete") is False:
            return True
        st = answer.get("status")
        state = st.get("state") if isinstance(st, dict) else answer.get("state")
        if isinstance(state, str) and state.upper() in _RUNNING_STATES:
            return True
    if isinstance(answer, str) and re.search(r"\bstill running\b|\bquery is running\b", answer, re.I):
        return True
    return False


def _answer_value(answer: Any, path: str) -> Any:
    cur = answer
    for part in re.findall(r"\.([A-Za-z_][\w-]*)|\[(\d+)\]", path):
        key, idx = part
        if isinstance(cur, str):
            try:
                cur = json.loads(cur)
            except ValueError:
                return None
        if key:
            cur = cur.get(key) if isinstance(cur, dict) else None
        else:
            cur = cur[int(idx)] if isinstance(cur, list) and int(idx) < len(cur) else None
    return cur


def _fill_from_answer(args: Any, answer: Any) -> Any:
    if isinstance(args, dict):
        return {k: _fill_from_answer(v, answer) for k, v in args.items()}
    if isinstance(args, list):
        return [_fill_from_answer(v, answer) for v in args]
    if isinstance(args, str):
        m = _ANSWER_REF.fullmatch(args.strip())
        if m:
            return _answer_value(answer, m.group(1))
        return _ANSWER_REF.sub(lambda mm: str(_answer_value(answer, mm.group(1)) or ""), args)
    return args


def run_polling(tool: str, args: dict, poll: Optional[dict] = None, *, sleep=time.sleep, clock=time.time) -> Any:
    """run_tool, asking again while the answer says the query is still running."""
    answer = run_tool(tool, args)
    if not still_running(answer):
        return answer
    deadline, wait = clock() + POLL_DEADLINE_S, POLL_FIRST_S
    while still_running(answer):
        if clock() + wait > deadline:
            raise LiveError("failed", "The query is still running after 3 minutes. Refresh again in a minute.")
        sleep(wait)
        wait = min(POLL_MAX_S, wait * 2)
        if poll:
            p_args = _fill_from_answer(poll.get("args") or {}, answer)
            guard(p_args, poll.get("args") or {})
            answer = run_tool(poll["tool"], p_args)
        else:
            answer = run_tool(tool, args)
    return answer
