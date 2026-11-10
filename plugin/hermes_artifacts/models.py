"""The ``model`` type (3D): publish-time checks of model.json and wrapping a mesh file into a model.

What is checked is what would leave the page with a broken model: the shape of model.json, part ids
(unique across groups), kinds and their fields, profiles, parameter names and cycles, the syntax and names
of expressions (a mirror of the page's grammar; geometry is never evaluated here), that ``file`` parts
name a mesh in the version and ``ref`` parts a part, and the limits. Numbers may be numeric strings,
optional fields may be missing, and keys this module does not know are kept as they are.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any, Optional

MAX_JSON_BYTES = 1024 * 1024
MAX_PARTS = 2000
MAX_INSTANCES = 100_000
MAX_MESH_BYTES = 12 * 1024 * 1024
MAX_EXPR = 200
MAX_MESH_FACES = 5000
MAX_ERRORS = 8

MESH_EXT = ("glb", "gltf", "stl", "obj", "ply", "3mf")
PRESETS = ("aluminium", "steel", "stainless", "glass", "concrete", "wood", "plastic", "rubber", "white", "black")
KINDS = ("box", "cyl", "cone", "sphere", "torus", "prism", "extrude", "lathe", "sweep", "loft", "hull", "mesh",
         "file", "group", "ref")
FUNCS = {"min": (1, 64), "max": (1, 64), "abs": (1, 1), "round": (1, 1), "floor": (1, 1), "ceil": (1, 1),
         "sqrt": (1, 1), "sin": (1, 1), "cos": (1, 1), "tan": (1, 1)}
SHAPES = {"rect": 2, "rrect": 3, "circle": 3, "ngon": 4, "slot": 4}

_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_PARAM = re.compile(r"^[a-z][A-Za-z0-9_]{0,31}$")
_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


class _Bad(Exception):
    """One problem at a path inside model.json."""


# ----------------------------------------------------------------------------- expressions

_TOKEN = re.compile(r"\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(.))")


def _tokens(text: str) -> list:
    out, i = [], 0
    while i < len(text):
        m = _TOKEN.match(text, i)
        if not m or m.end() == i:
            break
        i = m.end()
        num, name, ch = m.groups()
        if num is not None:
            out.append(("num", float(num)))
        elif name is not None:
            out.append(("name", name))
        elif ch is not None and ch.strip():
            if ch not in "+-*/^(),":
                raise _Bad(f"unexpected {ch!r} in {text!r}")
            out.append((ch, ch))
    out.append(("end", None))
    return out


class _Parser:
    """expr := term (('+'|'-') term)* · term := unary (('*'|'/') unary)* · unary := '-' unary | power ·
    power := primary ('^' unary)? · primary := number | name | func '(' expr (',' expr)* ')' | '(' expr ')'.
    Parsing yields a small tree; :func:`_eval` computes it (trig in degrees)."""

    def __init__(self, text: str):
        self.text, self.toks, self.i = text, _tokens(text), 0

    def peek(self):
        return self.toks[self.i][0]

    def take(self, kind=None):
        t = self.toks[self.i]
        if kind and t[0] != kind:
            raise _Bad(f"expected {kind!r} in {self.text!r}")
        self.i += 1
        return t

    def parse(self):
        if self.peek() == "end":
            raise _Bad("an empty expression")
        node = self.expr()
        if self.peek() != "end":
            raise _Bad(f"unexpected {self.toks[self.i][1]!r} in {self.text!r}")
        return node

    def expr(self):
        node = self.term()
        while self.peek() in ("+", "-"):
            op = self.take()[0]
            node = (op, node, self.term())
        return node

    def term(self):
        node = self.unary()
        while self.peek() in ("*", "/"):
            op = self.take()[0]
            node = (op, node, self.unary())
        return node

    def unary(self):
        if self.peek() == "-":
            self.take()
            return ("neg", self.unary())
        return self.power()

    def power(self):
        node = self.primary()
        if self.peek() == "^":
            self.take()
            node = ("^", node, self.unary())
        return node

    def primary(self):
        kind, val = self.take()
        if kind == "num":
            return ("num", val)
        if kind == "(":
            node = self.expr()
            self.take(")")
            return node
        if kind == "name":
            if self.peek() == "(":
                if val not in FUNCS:
                    raise _Bad(f"unknown function {val!r} in {self.text!r}")
                self.take("(")
                args = [self.expr()]
                while self.peek() == ",":
                    self.take()
                    args.append(self.expr())
                self.take(")")
                lo, hi = FUNCS[val]
                if not lo <= len(args) <= hi:
                    raise _Bad(f"{val}() takes {lo if lo == hi else f'{lo} or more'} argument{'s' if hi > 1 else ''} in {self.text!r}")
                return ("call", val, args)
            if val in FUNCS:
                raise _Bad(f"{val} is a function: {val}(…) in {self.text!r}")
            return ("name", val)
        if kind == "end":
            raise _Bad(f"{self.text!r} ends too early")
        raise _Bad(f"unexpected {val!r} in {self.text!r}")


def _names(node) -> set:
    if node[0] == "name":
        return {node[1]}
    if node[0] == "num":
        return set()
    if node[0] == "call":
        return set().union(*(_names(a) for a in node[2]))
    return set().union(*(_names(a) for a in node[1:]))


def _eval(node, values: dict) -> float:
    k = node[0]
    if k == "num":
        return node[1]
    if k == "name":
        if node[1] == "pi":
            return math.pi
        return values[node[1]]
    if k == "neg":
        return -_eval(node[1], values)
    if k == "call":
        a = [_eval(x, values) for x in node[2]]
        f = node[1]
        if f in ("min", "max"):
            return (min if f == "min" else max)(a)
        x = a[0]
        if f in ("sin", "cos", "tan"):
            return getattr(math, f)(math.radians(x))
        if f == "round":
            return float(math.floor(x + 0.5))
        return float(getattr(math, {"abs": "fabs"}.get(f, f))(x))
    a, b = _eval(node[1], values), _eval(node[2], values)
    if k == "+":
        return a + b
    if k == "-":
        return a - b
    if k == "*":
        return a * b
    if k == "/":
        return a / b
    return a ** b


def parse_expr(text: str):
    """The expression's tree (ValueError with what is wrong)."""
    if len(text) > MAX_EXPR:
        raise ValueError(f"an expression of at most {MAX_EXPR} characters")
    try:
        return _Parser(text).parse()
    except _Bad as e:
        raise ValueError(str(e))


def eval_expr(text, values: Optional[dict] = None) -> float:
    """A number or an expression's value (ValueError when it is not one or cannot be computed)."""
    if isinstance(text, bool):
        raise ValueError("not a number")
    if isinstance(text, (int, float)):
        return float(text)
    try:
        v = _eval(parse_expr(str(text)), values or {})
    except KeyError as e:
        raise ValueError(f"unknown name {e.args[0]!r}")
    except (ArithmeticError, ValueError, TypeError) as e:
        raise ValueError(str(e) or "cannot be computed")
    if not isinstance(v, (int, float)) or isinstance(v, complex) or not math.isfinite(v):
        raise ValueError("cannot be computed")
    return float(v)


# ----------------------------------------------------------------------------- the check

class _Check:
    def __init__(self, model: dict, files: Optional[set]):
        self.m, self.files = model, files
        self.errors: list = []
        self.params: list = []  # names
        self.values: dict = {}  # params whose value is known
        self.ids: dict = {}  # id -> path
        self.parts: dict = {}  # id -> part dict
        self.refs: list = []  # (path, ref id, target)
        self.mats: set = set()
        self.nparts = 0
        self.instances = 0

    def bad(self, path: str, msg: str) -> None:
        self.errors.append(f"model.json: {path}: {msg}" if path else f"model.json: {msg}")

    # --- values
    def num(self, v, path: str, *, required: bool = True) -> Optional[float]:
        """A number or an expression; returns its value when it can be computed now (else None)."""
        if v is None:
            if required:
                self.bad(path, "missing (a number or an expression)")
            return None
        if isinstance(v, bool) or not isinstance(v, (int, float, str)):
            self.bad(path, "a number or an expression")
            return None
        if isinstance(v, (int, float)):
            if not math.isfinite(v):
                self.bad(path, "a finite number")
                return None
            return float(v)
        try:
            tree = parse_expr(v)
        except ValueError as e:
            self.bad(path, str(e))
            return None
        unknown = sorted(n for n in _names(tree) if n != "pi" and n not in self.params)
        if unknown:
            self.bad(path, f"unknown name{'s' if len(unknown) > 1 else ''} {', '.join(unknown)} in {v!r} (params: "
                           f"{', '.join(self.params) or 'none'})")
            return None
        try:
            return float(_eval(tree, self.values))
        except Exception:
            return None

    def vec(self, v, n: int, path: str, *, required: bool = True) -> Optional[list]:
        if v is None:
            if required:
                self.bad(path, f"missing ([{', '.join('xyz'[:n]) if n <= 3 else n}])")
            return None
        if not isinstance(v, list) or len(v) != n:
            self.bad(path, f"a list of {n} numbers")
            return None
        return [self.num(x, f"{path}[{i}]") for i, x in enumerate(v)]

    def points(self, v, n: int, path: str, least: int) -> None:
        if not isinstance(v, list) or len(v) < least:
            self.bad(path, f"a list of at least {least} points [{', '.join('xyz'[:n])}]")
            return
        for i, p in enumerate(v):
            self.vec(p, n, f"{path}[{i}]")

    # --- params and materials
    def check_params(self) -> None:
        ps = self.m.get("params")
        if ps is None:
            return
        if not isinstance(ps, dict):
            self.bad("params", "an object {name: number | {v, min, max, step, label, unit}}")
            return
        for name in ps:
            if not isinstance(name, str) or not _PARAM.match(name):
                self.bad(f"params.{name}", "a name of a lowercase letter then letters, digits or _ (at most 32)")
            elif name == "pi" or name in FUNCS:
                self.bad(f"params.{name}", f"{name} is a built-in name")
            else:
                self.params.append(name)
        exprs, deps = {}, {}
        for name in self.params:
            p = ps[name]
            path = f"params.{name}"
            if isinstance(p, dict):
                if "v" not in p:
                    self.bad(path, "missing v (its value)")
                    continue
                for k in ("min", "max", "step"):
                    if p.get(k) is not None:
                        self.num(p[k], f"{path}.{k}")
                for k in ("label", "unit"):
                    if p.get(k) is not None and not isinstance(p[k], str):
                        self.bad(f"{path}.{k}", "text")
                v, path = p["v"], path + ".v"
            else:
                v = p
            if isinstance(v, bool) or not isinstance(v, (int, float, str)):
                self.bad(path, "a number or an expression")
                continue
            if isinstance(v, str):
                try:
                    tree = parse_expr(v)
                except ValueError as e:
                    self.bad(path, str(e))
                    continue
                unknown = sorted(n for n in _names(tree) if n != "pi" and n not in self.params)
                if unknown:
                    self.bad(path, f"unknown name{'s' if len(unknown) > 1 else ''} {', '.join(unknown)} in {v!r}")
                    continue
                exprs[name], deps[name] = tree, _names(tree) - {"pi"}
            elif math.isfinite(v):
                self.values[name] = float(v)
            else:
                self.bad(path, "a finite number")
        # Expressions of other params: no cycles; values in dependency order.
        state: dict = {}

        def visit(n, chain):
            if state.get(n) == 2:
                return
            if state.get(n) == 1:
                cyc = chain[chain.index(n):] + [n]
                raise _Bad(" -> ".join(cyc))
            state[n] = 1
            for d in sorted(deps.get(n, ())):
                visit(d, chain + [n])
            state[n] = 2
            if n in exprs and all(d in self.values for d in deps[n]):
                try:
                    self.values[n] = float(_eval(exprs[n], self.values))
                except Exception:
                    pass

        for n in exprs:
            try:
                visit(n, [])
            except _Bad as e:
                self.bad(f"params.{n}", f"its value depends on itself ({e})")
                return

    def check_materials(self) -> None:
        ms = self.m.get("materials")
        if ms is None:
            return
        if not isinstance(ms, dict):
            self.bad("materials", "an object {name: preset | {color, metal, rough, opacity}}")
            return
        for name, spec in ms.items():
            path = f"materials.{name}"
            self.mats.add(name)
            if isinstance(spec, str):
                if spec not in PRESETS and not _COLOR.match(spec):
                    self.bad(path, f"a preset ({', '.join(PRESETS)}), \"#rrggbb\" or {{color, metal, rough, opacity}}")
                continue
            if not isinstance(spec, dict):
                self.bad(path, "a preset name or {color, metal, rough, opacity}")
                continue
            if spec.get("color") is not None and (not isinstance(spec["color"], str) or not _COLOR.match(spec["color"])):
                self.bad(f"{path}.color", 'a colour "#rrggbb"')
            for k in ("metal", "rough", "opacity"):
                if spec.get(k) is None:
                    continue
                v = self.num(spec[k], f"{path}.{k}")
                if v is not None and not 0 <= v <= 1:
                    self.bad(f"{path}.{k}", "from 0 to 1")

    # --- profiles
    def profile(self, v, path: str) -> None:
        if isinstance(v, dict):
            shapes = [k for k in SHAPES if k in v]
            if len(shapes) == 1:
                k = shapes[0]
                args = v[k]
                if not isinstance(args, list) or len(args) != SHAPES[k]:
                    self.bad(f"{path}.{k}", f"a list of {SHAPES[k]} numbers")
                    return
                vals = [self.num(x, f"{path}.{k}[{i}]") for i, x in enumerate(args)]
                if k == "ngon" and vals[3] is not None and vals[3] < 3:
                    self.bad(f"{path}.{k}[3]", "at least 3 sides")
                return
            if len(shapes) > 1:
                self.bad(path, f"one shape, not {', '.join(shapes)}")
                return
            if "points" in v:
                self.outline(v["points"], f"{path}.points")
                if v.get("fillet") is not None:
                    self.num(v["fillet"], f"{path}.fillet")
                return
            self.bad(path, 'a shape ({"rect": [w, h]}, rrect, circle, ngon, slot), a list of points or {"points", "fillet"}')
            return
        if isinstance(v, list):
            self.outline(v, path)
            return
        self.bad(path, "missing (a profile)" if v is None else 'a shape ({"rect": [w, h]}, …) or a list of points')

    def outline(self, pts, path: str) -> None:
        if not isinstance(pts, list):
            self.bad(path, "a list of points [x, y] (or {to, via} arcs)")
            return
        arcs = 0
        for i, p in enumerate(pts):
            pp = f"{path}[{i}]"
            if isinstance(p, dict):
                if i == 0:
                    self.bad(pp, "an outline starts at a point [x, y], not an arc")
                    continue
                arcs += 1
                self.vec(p.get("to"), 2, f"{pp}.to")
                self.vec(p.get("via"), 2, f"{pp}.via")
            else:
                self.vec(p, 2, pp)
        if len(pts) < (2 if arcs else 3):
            self.bad(path, "an outline of at least 3 points (or 2 with an arc)")

    # --- parts
    def check_parts(self, parts, path: str, depth: int = 0, mult: int = 1) -> None:
        if not isinstance(parts, list):
            self.bad(path, "a list of parts")
            return
        if depth > 16:
            self.bad(path, "groups nested more than 16 deep")
            return
        for i, p in enumerate(parts):
            self.part(p, f"{path}[{i}]", depth, mult)

    def part(self, p, path: str, depth: int, mult: int) -> None:
        self.nparts += 1
        if not isinstance(p, dict):
            self.bad(path, "a part {id, kind, …}")
            return
        pid = p.get("id")
        if not isinstance(pid, str) or not _ID.match(pid):
            self.bad(f"{path}.id", "missing or not an id (letters, digits, _ or -, at most 40)")
        elif pid in self.ids:
            self.bad(f"{path}.id", f"{pid!r} is also {self.ids[pid]}: ids are unique")
        else:
            self.ids[pid] = path
            self.parts[pid] = p
        kind = p.get("kind")
        if kind not in KINDS:
            self.bad(f"{path}.kind", f"one of {', '.join(KINDS)}" if kind is not None else f"missing (one of {', '.join(KINDS)})")
        if p.get("name") is not None and not isinstance(p["name"], str):
            self.bad(f"{path}.name", "text")
        if p.get("tag") is not None and not isinstance(p["tag"], str):
            self.bad(f"{path}.tag", "text")
        self.vec(p.get("at"), 3, f"{path}.at", required=False)
        self.vec(p.get("rot"), 3, f"{path}.rot", required=False)
        sc = p.get("scale")
        if isinstance(sc, list):
            self.vec(sc, 3, f"{path}.scale")
        elif sc is not None:
            self.num(sc, f"{path}.scale")
        mat = p.get("mat")
        if mat is not None and (not isinstance(mat, str) or (mat not in self.mats and mat not in PRESETS and not _COLOR.match(mat))):
            self.bad(f"{path}.mat", f"a material name ({', '.join(sorted(self.mats)) or 'none defined'}), a preset "
                                    f"({', '.join(PRESETS)}) or \"#rrggbb\"")
        if p.get("mirror") is not None and p["mirror"] not in ("x", "y", "z"):
            self.bad(f"{path}.mirror", '"x", "y" or "z"')
        count = self.array(p.get("array"), f"{path}.array") * (2 if p.get("mirror") in ("x", "y", "z") else 1)
        here = mult * count
        if kind != "group":
            self.instances += here
        req = lambda k: self.num(p.get(k), f"{path}.{k}")  # noqa: E731
        opt = lambda k: self.num(p.get(k), f"{path}.{k}", required=False)  # noqa: E731
        if kind == "box":
            self.vec(p.get("size"), 3, f"{path}.size")
            opt("r")
        elif kind == "cyl":
            req("r"), req("h"), opt("r2")
        elif kind == "cone":
            req("r"), req("h")
        elif kind == "sphere":
            req("r")
        elif kind == "torus":
            req("r"), req("tube")
        elif kind == "prism":
            n = req("n")
            if n is not None and n < 3:
                self.bad(f"{path}.n", "at least 3 sides")
            req("r"), req("h")
        elif kind == "extrude":
            self.profile(p.get("profile"), f"{path}.profile")
            holes = p.get("holes")
            if holes is not None:
                if not isinstance(holes, list):
                    self.bad(f"{path}.holes", "a list of profiles")
                else:
                    for i, h in enumerate(holes):
                        self.profile(h, f"{path}.holes[{i}]")
            req("depth"), opt("bevel")
        elif kind == "lathe":
            self.profile(p.get("profile"), f"{path}.profile")
            opt("angle")
        elif kind == "sweep":
            self.profile(p.get("profile"), f"{path}.profile")
            self.points(p.get("path"), 3, f"{path}.path", 2)
        elif kind == "loft":
            secs = p.get("sections")
            if not isinstance(secs, list) or len(secs) < 2:
                self.bad(f"{path}.sections", "a list of at least 2 sections {profile, z}")
            else:
                for i, s in enumerate(secs):
                    if not isinstance(s, dict):
                        self.bad(f"{path}.sections[{i}]", "a section {profile, z}")
                        continue
                    self.profile(s.get("profile"), f"{path}.sections[{i}].profile")
                    self.num(s.get("z"), f"{path}.sections[{i}].z")
        elif kind == "hull":
            self.points(p.get("points"), 3, f"{path}.points", 4)
        elif kind == "mesh":
            self.mesh(p, path)
        elif kind == "file":
            self.file(p, path)
        elif kind == "group":
            if "parts" not in p:
                self.bad(f"{path}.parts", "missing (the group's parts)")
            else:
                self.check_parts(p["parts"], f"{path}.parts", depth + 1, here)
        elif kind == "ref":
            of = p.get("of")
            if not isinstance(of, str) or not of:
                self.bad(f"{path}.of", "missing (the id of the part to repeat)")
            else:
                self.refs.append((path, pid if isinstance(pid, str) else None, of, here))

    def array(self, a, path: str) -> int:
        """The array's instance count (1 when there is none or it cannot be computed here)."""
        if a is None:
            return 1
        if not isinstance(a, dict):
            self.bad(path, '{"n", "d"}, {"grid", "d"} or {"radial", "axis", "angle", "center"}')
            return 1
        modes = [k for k in ("n", "grid", "radial") if k in a]
        if len(modes) != 1:
            self.bad(path, 'one of "n" (linear), "grid" or "radial"')
            return 1

        def count(v, p):
            if v is None:
                return 1
            if v < 1 or abs(v - round(v)) > 1e-9:
                self.bad(p, "a whole number of at least 1")
                return 1
            return int(round(v))

        mode = modes[0]
        if mode == "n":
            c = count(self.num(a["n"], f"{path}.n"), f"{path}.n")
            self.vec(a.get("d"), 3, f"{path}.d")
            return c
        if mode == "grid":
            g = a["grid"]
            if not isinstance(g, list) or len(g) != 2:
                self.bad(f"{path}.grid", "[nx, ny]")
                return 1
            nx = count(self.num(g[0], f"{path}.grid[0]"), f"{path}.grid[0]")
            ny = count(self.num(g[1], f"{path}.grid[1]"), f"{path}.grid[1]")
            d = a.get("d")
            if isinstance(d, list) and len(d) == 3:
                self.vec(d, 3, f"{path}.d")
            else:
                self.vec(d, 2, f"{path}.d")
            return nx * ny
        c = count(self.num(a["radial"], f"{path}.radial"), f"{path}.radial")
        if a.get("axis") is not None and a["axis"] not in ("x", "y", "z"):
            self.bad(f"{path}.axis", '"x", "y" or "z"')
        self.num(a.get("angle"), f"{path}.angle", required=False)
        self.vec(a.get("center"), 3, f"{path}.center", required=False)
        return c

    def mesh(self, p: dict, path: str) -> None:
        v, f = p.get("v"), p.get("f")
        if not isinstance(v, list) or len(v) < 3:
            self.bad(f"{path}.v", "a list of at least 3 points [x, y, z]")
            nv = None
        else:
            nv = len(v)
            for i, pt in enumerate(v):
                if not isinstance(pt, list) or len(pt) != 3:
                    self.bad(f"{path}.v[{i}]", "a point [x, y, z]")
                    break
                bad = next((j for j, x in enumerate(pt) if isinstance(x, bool) or not isinstance(x, (int, float, str))), None)
                if bad is not None:
                    self.bad(f"{path}.v[{i}][{bad}]", "a number")
                    break
        if not isinstance(f, list) or not f:
            self.bad(f"{path}.f", "a list of faces [a, b, c] (indexes into v)")
            return
        if len(f) > MAX_MESH_FACES:
            self.bad(f"{path}.f", f"at most {MAX_MESH_FACES} faces (bigger shapes come from a mesh file)")
            return
        for i, face in enumerate(f):
            if not isinstance(face, list) or len(face) < 3 or any(isinstance(x, bool) or not isinstance(x, int) for x in face):
                self.bad(f"{path}.f[{i}]", "a face [a, b, c] of vertex indexes")
                return
            if nv is not None and any(not 0 <= x < nv for x in face):
                self.bad(f"{path}.f[{i}]", f"an index outside v (0 to {nv - 1})")
                return

    def file(self, p: dict, path: str) -> None:
        src = p.get("src")
        if not isinstance(src, str) or not src:
            self.bad(f"{path}.src", 'missing (the mesh file, "meshes/<name>.glb")')
        elif src.rsplit(".", 1)[-1].lower() not in MESH_EXT:
            self.bad(f"{path}.src", f"a mesh file ({', '.join(MESH_EXT)})")
        elif self.files is not None and src not in self.files:
            self.bad(f"{path}.src", f"{src!r} is not among the artifact's files")
        fit = p.get("fit")
        if fit is not None:
            self.vec(fit, 3, f"{path}.fit")
        if p.get("unit") is not None and p["unit"] not in ("mm", "cm", "m", "in"):
            self.bad(f"{path}.unit", '"mm", "cm", "m" or "in"')

    def check_refs(self) -> None:
        for path, _, of, mult in self.refs:
            if of not in self.parts:
                self.bad(f"{path}.of", f"no part {of!r}")
            else:
                self.instances += mult * max(1, self.subtree_size(of))
        # A ref may not reach a group that contains it (directly or through other refs).
        edges = {}
        for pid, p in self.parts.items():
            if p.get("kind") == "group" and isinstance(p.get("parts"), list):
                edges[pid] = [c.get("id") for c in p["parts"] if isinstance(c, dict) and isinstance(c.get("id"), str)]
            elif p.get("kind") == "ref" and isinstance(p.get("of"), str):
                edges[pid] = [p["of"]]
        state: dict = {}
        for start in edges:
            stack = [(start, iter(edges.get(start, ())))]
            if state.get(start):
                continue
            state[start] = 1
            while stack:
                node, it = stack[-1]
                nxt = next(it, None)
                if nxt is None:
                    state[node] = 2
                    stack.pop()
                    continue
                if state.get(nxt) == 1:
                    self.bad(self.ids.get(start, start), f"refers to itself (through {nxt!r})")
                    return
                if not state.get(nxt) and nxt in self.parts:
                    state[nxt] = 1
                    stack.append((nxt, iter(edges.get(nxt, ()))))

    def subtree_size(self, pid: str, seen: Optional[set] = None) -> int:
        seen = seen or set()
        if pid in seen:
            return 0
        seen.add(pid)
        p = self.parts.get(pid) or {}
        if p.get("kind") == "group" and isinstance(p.get("parts"), list):
            return sum(self.subtree_size(c.get("id"), seen) for c in p["parts"] if isinstance(c, dict))
        return 1

    def check_dims_views(self) -> None:
        dims = self.m.get("dims")
        if dims is not None:
            if not isinstance(dims, list):
                self.bad("dims", "a list")
            else:
                for i, d in enumerate(dims):
                    path = f"dims[{i}]"
                    if not isinstance(d, dict):
                        self.bad(path, '{"from", "to", "offset"} or {"part", "axis"}')
                    elif "part" in d:
                        if d["part"] not in self.parts:
                            self.bad(f"{path}.part", f"no part {d['part']!r}")
                        if d.get("axis") not in ("x", "y", "z"):
                            self.bad(f"{path}.axis", '"x", "y" or "z"')
                    else:
                        self.vec(d.get("from"), 3, f"{path}.from")
                        self.vec(d.get("to"), 3, f"{path}.to")
                        self.num(d.get("offset"), f"{path}.offset", required=False)
                        if d.get("text") is not None and not isinstance(d["text"], str):
                            self.bad(f"{path}.text", "text")
        views = self.m.get("views")
        if views is not None:
            if not isinstance(views, list):
                self.bad("views", "a list")
            else:
                for i, v in enumerate(views):
                    path = f"views[{i}]"
                    if not isinstance(v, dict):
                        self.bad(path, '{"id", "name", "cam", "target"}')
                        continue
                    self.vec(v.get("cam"), 3, f"{path}.cam")
                    self.vec(v.get("target"), 3, f"{path}.target")

    def run(self) -> list:
        m = self.m
        if not isinstance(m, dict):
            return ["model.json: a model {title, params, materials, parts, …}"]
        if m.get("title") is not None and not isinstance(m["title"], str):
            self.bad("title", "text")
        if m.get("units") not in (None, "mm"):
            self.bad("units", '"mm" (sizes are millimetres)')
        self.check_params()
        self.check_materials()
        if m.get("parts") is not None:
            self.check_parts(m["parts"], "parts")
        self.check_refs()
        self.check_dims_views()
        if self.nparts > MAX_PARTS:
            self.bad("parts", f"{self.nparts} parts: at most {MAX_PARTS} (nested included)")
        if self.instances > MAX_INSTANCES:
            self.bad("parts", f"about {self.instances} instances with arrays: at most {MAX_INSTANCES}")
        return self.errors


def check(model: Any, files: Optional[set] = None) -> list:
    """Every problem with a parsed model.json, as "model.json: <path>: <what>" lines. ``files``: the
    version's files (``file`` parts must name one); None skips that check."""
    return _Check(model, files).run()


def _draco(data: bytes, ext: str) -> bool:
    """A glTF that needs Draco (the page refuses it)."""
    try:
        if ext == "glb":
            if data[:4] != b"glTF" or len(data) < 20:
                return False
            n = int.from_bytes(data[12:16], "little")
            doc = json.loads(data[20:20 + n].decode("utf-8"))
        else:
            doc = json.loads(data.decode("utf-8-sig"))
        return "KHR_draco_mesh_compression" in (doc.get("extensionsRequired") or []) + (doc.get("extensionsUsed") or [])
    except (ValueError, UnicodeDecodeError, AttributeError, TypeError):
        return False


def check_mesh(rel: str, data: bytes) -> Optional[str]:
    """What is wrong with a mesh file (None: nothing)."""
    ext = rel.rsplit(".", 1)[-1].lower()
    if len(data) > MAX_MESH_BYTES:
        return f"{rel}: a mesh file of at most {MAX_MESH_BYTES // (1024 * 1024)} MB"
    if ext == "glb" and data[:4] != b"glTF":
        return f"{rel}: not a binary glTF (.glb)"
    if ext == "gltf":
        try:
            doc = json.loads(data.decode("utf-8-sig"))
        except (ValueError, UnicodeDecodeError):
            return f"{rel}: not a glTF (JSON) file"
        for key in ("buffers", "images"):
            for b in (doc.get(key) or []) if isinstance(doc, dict) else []:
                uri = b.get("uri") if isinstance(b, dict) else None
                if isinstance(uri, str) and not uri.startswith("data:"):
                    return f"{rel}: a .gltf must be a single file (its {key} embedded), or bring the .glb"
    if ext in ("glb", "gltf") and _draco(data, ext):
        return f"{rel}: Draco-compressed glTF can't be read here; export it without Draco compression"
    return None


def check_file(path: Path) -> None:
    """Publish-time check of a model's model.json and its meshes (ValueError naming what is wrong)."""
    path = Path(path)
    vdir = path.parent
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return  # the store says the entry file is missing
    if len(raw) > MAX_JSON_BYTES:
        raise ValueError(f"model.json: at most {MAX_JSON_BYTES // 1024} KB (describe parts; big shapes come from mesh files)")
    try:
        model = json.loads(raw.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError) as e:
        raise ValueError(f"model.json is not valid JSON: {e}")
    files = {p.relative_to(vdir).as_posix() for p in vdir.rglob("*") if p.is_file()}
    errors = check(model, files)
    meshes = sorted(f for f in files if f.startswith("meshes/"))
    wanted = {p.get("src") for p in _all_parts(model) if p.get("kind") == "file"}
    for rel in meshes:
        size = (vdir / rel).stat().st_size
        if size > MAX_MESH_BYTES:
            errors.append(f"{rel}: a mesh file of at most {MAX_MESH_BYTES // (1024 * 1024)} MB")
        elif rel in wanted:
            msg = check_mesh(rel, (vdir / rel).read_bytes())
            if msg:
                errors.append(msg)
    if errors:
        more = len(errors) - MAX_ERRORS
        raise ValueError("; ".join(errors[:MAX_ERRORS]) + (f"; and {more} more" if more > 0 else ""))


def _all_parts(model) -> list:
    out, stack = [], list(model.get("parts") or []) if isinstance(model, dict) and isinstance(model.get("parts"), list) else []
    while stack:
        p = stack.pop()
        if isinstance(p, dict):
            out.append(p)
            if isinstance(p.get("parts"), list):
                stack.extend(p["parts"])
    return out


# ----------------------------------------------------------------------------- a mesh file as a model

def mesh_name(stem: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-")[:64] or "mesh"


def wrap_mesh(src: Path, vdir: Path, title: str = "") -> None:
    """Put a mesh file into ``vdir`` as meshes/<name>.<ext> with a ``file`` part in model.json. When
    model.json is already there (a new version on top of the last), the part is added to it."""
    ext = src.suffix.lower().lstrip(".")
    if ext not in MESH_EXT:
        raise ValueError(f"a model is made from model.json or a mesh file ({', '.join(MESH_EXT)})")
    data = src.read_bytes()
    name = mesh_name(src.stem)
    entry = vdir / "model.json"
    model = None
    if entry.is_file():
        try:
            model = json.loads(entry.read_text("utf-8-sig"))
        except (ValueError, UnicodeDecodeError):
            model = None
    if not isinstance(model, dict):
        model = {"title": title or src.stem, "units": "mm", "parts": []}
    if not isinstance(model.get("parts"), list):
        model["parts"] = []
    taken = {p.get("id") for p in _all_parts(model)}
    rel, i = f"meshes/{name}.{ext}", 2
    while (vdir / rel).exists():
        rel, i = f"meshes/{name[:60]}-{i}.{ext}", i + 1
    msg = check_mesh(rel, data)
    if msg:
        raise ValueError(msg)
    pid, i = name[:40], 2
    while pid in taken:
        pid, i = f"{name[:36]}-{i}", i + 1
    (vdir / "meshes").mkdir(parents=True, exist_ok=True)
    (vdir / rel).write_bytes(data)
    model["parts"].append({"id": pid, "name": src.stem, "kind": "file", "src": rel})
    if entry.is_file() or entry.is_symlink():
        entry.unlink()  # may be a hard link shared with the version before
    entry.write_text(json.dumps(model, ensure_ascii=False, indent=2), encoding="utf-8")
