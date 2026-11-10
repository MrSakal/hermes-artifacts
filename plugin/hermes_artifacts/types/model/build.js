/* hermes-artifacts: the builder of the `model` (3D) artifact type.
   Turns a declarative model.json (millimetres, Z up, degrees) into a THREE.Group, validates it, exports it
   (GLB, STL, OBJ, PLY) and measures it (takeoff). Pure geometry: no renderer, no DOM. Uses the global
   THREE from types/vendor/three.bundle.js, looked up lazily (this file may load before the bundle).
   Classic script: window.modelKit; under node: module.exports. */
(function (root) {
  'use strict';

  var DEG = Math.PI / 180;
  var LIMITS = { parts: 2000, instances: 100000, exprLen: 200, meshFaces: 5000, json: 1000000, pathPoints: 2000, hullPoints: 5000 };
  var KINDS = ['box', 'cyl', 'cone', 'sphere', 'torus', 'prism', 'extrude', 'lathe', 'sweep', 'loft', 'hull', 'mesh', 'file', 'group', 'ref'];
  var PRESETS = {
    aluminium: { color: '#c4c8cc', metal: 0.85, rough: 0.35, opacity: 1 },
    steel: { color: '#8b9097', metal: 0.9, rough: 0.45, opacity: 1 },
    stainless: { color: '#c9ccd0', metal: 0.95, rough: 0.22, opacity: 1 },
    glass: { color: '#bcd7e0', metal: 0, rough: 0.05, opacity: 0.3 },
    concrete: { color: '#a5a29b', metal: 0, rough: 0.92, opacity: 1 },
    wood: { color: '#b5835a', metal: 0, rough: 0.72, opacity: 1 },
    plastic: { color: '#dcdcdc', metal: 0, rough: 0.42, opacity: 1 },
    rubber: { color: '#2a2a2a', metal: 0, rough: 0.95, opacity: 1 },
    white: { color: '#f0f0ee', metal: 0, rough: 0.6, opacity: 1 },
    black: { color: '#1d1d1f', metal: 0, rough: 0.55, opacity: 1 }
  };
  var DEFAULT_MAT = { color: '#b9bdc3', metal: 0, rough: 0.6, opacity: 1 };
  var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var PARAM_RE = /^[a-z][A-Za-z0-9_]{0,31}$/;
  var HEX_RE = /^#[0-9a-fA-F]{6}$/;
  var SRC_RE = /^meshes\/[A-Za-z0-9_-]{1,64}\.(glb|stl|obj|ply|3mf)$/i;
  var UNITS = { mm: 1, cm: 10, m: 1000, 'in': 25.4 };
  var EDGE_ANGLE = 25;          // degrees between face normals that makes a drawn edge
  var EDGE_TRI_BUDGET = 30000;  // no edges for a geometry with more triangles than this
  var EDGE_VERT_BUDGET = 400000; // no edges for an array whose merged edge lines would exceed this
  var CREASE = 30 * DEG;        // normals are smoothed across angles below this

  function T() {
    var t = (typeof THREE !== 'undefined') ? THREE : (root && root.THREE);
    if (!t) throw new Error('the 3D library is not loaded');
    return t;
  }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function fmt(x) { return (typeof x === 'number' && isFinite(x)) ? String(+x.toFixed(6)) : String(x); }
  function bool(v) { return v === true || v === 'true' || v === 1; }

  // ---------------------------------------------------------------- expressions
  function sinD(d) {
    var r = d % 360;
    if (r % 90 === 0) return [0, 1, 0, -1][((r / 90) % 4 + 4) % 4];
    return Math.sin(d * DEG);
  }
  function cosD(d) { return sinD(d + 90); }
  var FUNCS = {
    min: [1, Infinity, function (a) { return Math.min.apply(null, a); }],
    max: [1, Infinity, function (a) { return Math.max.apply(null, a); }],
    abs: [1, 1, function (a) { return Math.abs(a[0]); }],
    round: [1, 1, function (a) { return Math.round(a[0]); }],
    floor: [1, 1, function (a) { return Math.floor(a[0]); }],
    ceil: [1, 1, function (a) { return Math.ceil(a[0]); }],
    sqrt: [1, 1, function (a) { return Math.sqrt(a[0]); }],
    sin: [1, 1, function (a) { return sinD(a[0]); }],
    cos: [1, 1, function (a) { return cosD(a[0]); }],
    tan: [1, 1, function (a) { return sinD(a[0]) / cosD(a[0]); }]
  };
  var RESERVED = Object.keys(FUNCS).concat(['pi']);
  var NUM_RE = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  var NAME_RE = /[A-Za-z_][A-Za-z0-9_]*/y;

  function tokenize(s) {
    var toks = [], i = 0, n = s.length, m;
    while (i < n) {
      var ch = s.charAt(i);
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
      if ((ch >= '0' && ch <= '9') || ch === '.') {
        NUM_RE.lastIndex = i; m = NUM_RE.exec(s);
        if (!m) throw new Error('unexpected "' + ch + '" at ' + (i + 1));
        toks.push({ t: 'num', v: parseFloat(m[0]), s: m[0], p: i + 1 }); i += m[0].length; continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        NAME_RE.lastIndex = i; m = NAME_RE.exec(s);
        toks.push({ t: 'name', v: m[0], s: m[0], p: i + 1 }); i += m[0].length; continue;
      }
      if ('+-*/^(),'.indexOf(ch) >= 0) { toks.push({ t: 'op', v: ch, s: ch, p: i + 1 }); i++; continue; }
      throw new Error('unexpected "' + ch + '" at ' + (i + 1));
    }
    toks.push({ t: 'end', v: null, s: '', p: n + 1 });
    return toks;
  }

  function parse(s) {
    var toks = tokenize(s), k = 0;
    function peek() { return toks[k]; }
    function isOp(v) { var t = toks[k]; return t.t === 'op' && t.v === v; }
    function fail(t) {
      if (t.t === 'end') throw new Error('unexpected end of expression');
      throw new Error('unexpected "' + t.s + '" at ' + t.p);
    }
    function expr() {
      var a = term();
      while (isOp('+') || isOp('-')) { var op = toks[k++].v; a = ['b', op, a, term()]; }
      return a;
    }
    function term() {
      var a = unary();
      while (isOp('*') || isOp('/')) { var op = toks[k++].v; a = ['b', op, a, unary()]; }
      return a;
    }
    function unary() {
      if (isOp('-')) { k++; return ['u', unary()]; }
      if (isOp('+')) { k++; return unary(); }
      return power();
    }
    function power() {
      var a = primary();
      if (isOp('^')) { k++; return ['b', '^', a, unary()]; }
      return a;
    }
    function primary() {
      var t = peek();
      if (t.t === 'num') { k++; return ['n', t.v]; }
      if (t.t === 'name') {
        k++;
        if (isOp('(')) {
          var f = FUNCS[t.v];
          if (!f || !hasOwn(FUNCS, t.v)) throw new Error('unknown function "' + t.v + '"');
          k++;
          var args = [];
          if (!isOp(')')) {
            args.push(expr());
            while (isOp(',')) { k++; args.push(expr()); }
          }
          if (!isOp(')')) fail(peek());
          k++;
          if (args.length < f[0] || args.length > f[1]) {
            throw new Error(t.v + ' takes ' + (f[1] === Infinity ? 'at least ' : '') + f[0] + ' argument' + (f[0] === 1 ? '' : 's'));
          }
          return ['f', t.v, args];
        }
        if (t.v === 'pi') return ['n', Math.PI];
        if (hasOwn(FUNCS, t.v)) throw new Error('"' + t.v + '" needs parentheses: ' + t.v + '(...)');
        return ['v', t.v];
      }
      if (t.t === 'op' && t.v === '(') {
        k++;
        var e = expr();
        if (!isOp(')')) fail(peek());
        k++;
        return e;
      }
      fail(t);
    }
    var ast = expr();
    if (peek().t !== 'end') fail(peek());
    return ast;
  }

  var astCache = new Map();
  function compile(s) {
    var hit = astCache.get(s);
    if (hit) { if (hit.err) throw new Error(hit.err); return hit.ast; }
    if (astCache.size > 5000) astCache.clear();
    try {
      var ast = parse(s);
      astCache.set(s, { ast: ast });
      return ast;
    } catch (e) {
      astCache.set(s, { err: e.message });
      throw e;
    }
  }
  function evalAst(a, look) {
    switch (a[0]) {
      case 'n': return a[1];
      case 'v': return look(a[1]);
      case 'u': return -evalAst(a[1], look);
      case 'b': {
        var x = evalAst(a[2], look), y = evalAst(a[3], look);
        switch (a[1]) {
          case '+': return x + y;
          case '-': return x - y;
          case '*': return x * y;
          case '/': return x / y;
          default: return Math.pow(x, y);
        }
      }
      default: {
        var args = a[2].map(function (b) { return evalAst(b, look); });
        return FUNCS[a[1]][2](args);
      }
    }
  }
  function lookupFrom(values) {
    if (typeof values === 'function') return values;
    return function (name) {
      if (values && hasOwn(values, name)) {
        var v = values[name];
        if (typeof v !== 'number' || !isFinite(v)) throw new Error('parameter "' + name + '" has no valid value');
        return v;
      }
      throw new Error('unknown name "' + name + '"');
    };
  }
  function evalExpr(expr, values) {
    var x;
    if (typeof expr === 'number') {
      x = expr;
    } else if (typeof expr === 'string') {
      var s = expr.trim();
      if (!s) throw new Error('empty expression');
      if (s.length > LIMITS.exprLen) throw new Error('expression longer than ' + LIMITS.exprLen + ' characters');
      x = evalAst(compile(s), lookupFrom(values));
    } else {
      throw new Error('expected a number or an expression');
    }
    if (typeof x !== 'number' || !isFinite(x)) throw new Error('the result is not a finite number');
    return x;
  }
  function exprNames(expr) {
    var out = [];
    (function walk(a) {
      if (a[0] === 'v') { if (out.indexOf(a[1]) < 0) out.push(a[1]); } else if (a[0] === 'u') walk(a[1]);
      else if (a[0] === 'b') { walk(a[2]); walk(a[3]); } else if (a[0] === 'f') a[2].forEach(walk);
    })(compile(String(expr).trim()));
    return out;
  }

  // ---------------------------------------------------------------- params
  function params(model, overrides) {
    var values = {}, defs = [], problems = [];
    var raw = model && model.params;
    if (raw == null) return { values: values, defs: defs, problems: problems };
    if (!isObj(raw)) { problems.push({ path: 'params', msg: 'must be an object of name: value' }); return { values: values, defs: defs, problems: problems }; }
    var names = Object.keys(raw), state = {}, stack = [], valid = {};
    names.forEach(function (n) {
      if (!PARAM_RE.test(n)) problems.push({ path: 'params.' + n, msg: 'a parameter name is a letter a-z then letters, digits or _ (at most 32)' });
      else if (RESERVED.indexOf(n) >= 0) problems.push({ path: 'params.' + n, msg: '"' + n + '" is a reserved name' });
      else valid[n] = true;
    });
    function look(n) {
      if (!hasOwn(valid, n)) throw new Error('unknown name "' + n + '"');
      if (state[n] === 1) throw new Error('cycle: ' + stack.concat(n).join(' -> '));
      resolve(n);
      if (!isFinite(values[n])) throw new Error('parameter "' + n + '" has no valid value');
      return values[n];
    }
    function opt(d, key, n) {
      if (!isObj(d) || d[key] == null || d[key] === '') return null;
      try { return evalExpr(d[key], look); } catch (e) { problems.push({ path: 'params.' + n + '.' + key, msg: e.message }); return null; }
    }
    function resolve(n) {
      if (state[n]) return;
      state[n] = 1; stack.push(n);
      var d = raw[n], v = NaN;
      if (overrides && hasOwn(overrides, n) && typeof overrides[n] === 'number' && isFinite(overrides[n])) {
        v = overrides[n];
      } else {
        var src = isObj(d) ? d.v : d;
        var p = 'params.' + n + (isObj(d) ? '.v' : '');
        if (src == null) problems.push({ path: p, msg: 'is required' });
        else if (typeof src !== 'number' && typeof src !== 'string') problems.push({ path: p, msg: 'expected a number or an expression' });
        else { try { v = evalExpr(src, look); } catch (e) { problems.push({ path: p, msg: e.message }); } }
      }
      values[n] = v;
      stack.pop(); state[n] = 2;
    }
    names.forEach(function (n) { if (valid[n]) resolve(n); });
    names.forEach(function (n) {
      if (!valid[n]) return;
      var d = raw[n];
      defs.push({
        name: n, v: values[n], min: opt(d, 'min', n), max: opt(d, 'max', n), step: opt(d, 'step', n),
        label: isObj(d) && d.label != null ? String(d.label) : null, unit: isObj(d) && d.unit != null ? String(d.unit) : null
      });
    });
    return { values: values, defs: defs, problems: problems };
  }

  // ---------------------------------------------------------------- resolution context
  function Ctx(st, part) { this.st = st; this.part = part; this.errs = 0; this.failed = false; }
  Ctx.prototype.err = function (path, msg) {
    this.errs++; this.failed = true;
    if (!this.st.quiet) this.st.problems.push({ part: this.part, path: path, msg: msg });
  };
  Ctx.prototype.warn = function (path, msg) {
    if (!this.st.quiet) this.st.problems.push({ part: this.part, path: path, msg: msg });
  };
  // o: {def, gt, ge, le, lt, int, ne0}
  Ctx.prototype.num = function (v, path, o) {
    o = o || {};
    if (v == null) {
      if (o.def !== undefined) return o.def;
      this.err(path, 'is required'); return NaN;
    }
    var x;
    try { x = evalExpr(v, this.st.look); } catch (e) { this.err(path, e.message); return NaN; }
    if (o.int) {
      if (Math.abs(x - Math.round(x)) > 1e-9) { this.err(path, 'must be a whole number (got ' + fmt(x) + ')'); return NaN; }
      x = Math.round(x);
    }
    if (o.gt != null && !(x > o.gt)) { this.err(path, 'must be > ' + o.gt + ' (got ' + fmt(x) + ')'); return NaN; }
    if (o.ge != null && !(x >= o.ge)) { this.err(path, 'must be >= ' + o.ge + ' (got ' + fmt(x) + ')'); return NaN; }
    if (o.le != null && !(x <= o.le)) { this.err(path, 'must be <= ' + o.le + ' (got ' + fmt(x) + ')'); return NaN; }
    if (o.ne0 && x === 0) { this.err(path, 'must not be 0'); return NaN; }
    return x;
  };
  // n entries; o.pad fills missing trailing entries; o.def when absent
  Ctx.prototype.vec = function (v, path, n, o) {
    o = o || {};
    if (v == null) {
      if (o.def !== undefined) return o.def.slice();
      this.err(path, 'is required'); return null;
    }
    if (isObj(v) && ('x' in v || 'y' in v || 'z' in v)) v = n === 2 ? [v.x, v.y] : [v.x, v.y, v.z];
    if (!Array.isArray(v)) { this.err(path, 'must be a list of ' + n + ' numbers'); return null; }
    if (v.length > n) { this.err(path, 'must have ' + n + ' numbers (got ' + v.length + ')'); return null; }
    if (v.length < n && o.pad === undefined) { this.err(path, 'must have ' + n + ' numbers (got ' + v.length + ')'); return null; }
    var out = [], e0 = this.errs;
    for (var i = 0; i < n; i++) out.push(i < v.length && v[i] != null ? this.num(v[i], path + '[' + i + ']', o) : (o.pad !== undefined ? o.pad : this.num(null, path + '[' + i + ']', o)));
    return this.errs > e0 ? null : out;
  };
  Ctx.prototype.list = function (v, path, min, max, what) {
    if (!Array.isArray(v)) { this.err(path, v == null ? 'is required' : 'must be a list'); return null; }
    if (v.length < min) { this.err(path, 'needs at least ' + min + ' ' + (what || 'entries') + ' (got ' + v.length + ')'); return null; }
    if (max != null && v.length > max) { this.err(path, 'at most ' + max + ' ' + (what || 'entries') + ' (got ' + v.length + ')'); return null; }
    return v;
  };

  // ---------------------------------------------------------------- 2D profiles
  // segments for a full circle: a multiple of 4, so circles reach +-r on both axes
  function segsFor(r) { return 4 * Math.ceil(Math.max(48, Math.min(128, 48 + Math.sqrt(Math.abs(r)) * 1.5)) / 4); }
  function arcPts(cx, cy, r, a0, a1, withStart, withEnd) {
    var sweep = a1 - a0, n = Math.max(2, Math.ceil(Math.abs(sweep) / (2 * Math.PI / segsFor(r)))), out = [];
    for (var k = withStart ? 0 : 1; k <= (withEnd ? n : n - 1); k++) {
      var a = a0 + sweep * k / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  }
  function circlePts(cx, cy, r) {
    var n = segsFor(r), out = [];
    for (var k = 0; k < n; k++) { var a = 2 * Math.PI * k / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  }
  function polyArea(p) {
    var a = 0;
    for (var i = 0, n = p.length; i < n; i++) { var q = p[i], w = p[(i + 1) % n]; a += q[0] * w[1] - w[0] * q[1]; }
    return a / 2;
  }
  function polyScale(p) {
    var m = 1;
    p.forEach(function (q) { m = Math.max(m, Math.abs(q[0]), Math.abs(q[1])); });
    return m;
  }
  function dedupe(p) {
    var eps = 1e-7 * polyScale(p), out = [];
    p.forEach(function (q) {
      var l = out[out.length - 1];
      if (!l || Math.abs(l[0] - q[0]) > eps || Math.abs(l[1] - q[1]) > eps) out.push(q);
    });
    while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) <= eps && Math.abs(out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
    return out;
  }
  function pointInPoly(pt, poly) {
    var x = pt[0], y = pt[1], inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  // circular arc from p0 through pm to p1: interior points only; null when collinear
  function arcThrough(p0, pm, p1) {
    var ax = p0[0], ay = p0[1], bx = pm[0], by = pm[1], cx = p1[0], cy = p1[1];
    var d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    var sc = Math.max(1, Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by), Math.abs(cx), Math.abs(cy));
    if (Math.abs(d) < 1e-9 * sc * sc) return null;
    var a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    var ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    var uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    var r = Math.hypot(ax - ux, ay - uy);
    var a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a1 = Math.atan2(cy - uy, cx - ux);
    var TAU = 2 * Math.PI;
    var s = ((a1 - a0) % TAU + TAU) % TAU, sm = ((am - a0) % TAU + TAU) % TAU;
    var sweep = sm < s ? s : s - TAU, swm = sm < s ? sm : sm - TAU;
    // sampled in two halves so the arc passes exactly through the via point
    return arcPts(ux, uy, r, a0, a0 + swm, false, false).concat([pm], arcPts(ux, uy, r, a0 + swm, a0 + sweep, false, false));
  }
  function filletPts(A, P, B, r) {
    var ux = A[0] - P[0], uy = A[1] - P[1], vx = B[0] - P[0], vy = B[1] - P[1];
    var lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-12 || lv < 1e-12) return null;
    ux /= lu; uy /= lu; vx /= lv; vy /= lv;
    var th = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    if (th < 1e-3 || th > Math.PI - 1e-3) return null;
    var t = r / Math.tan(th / 2), tmax = Math.min(lu, lv) * 0.5;
    if (t > tmax) { t = tmax; r = t * Math.tan(th / 2); }
    var bx = ux + vx, by = uy + vy, bl = Math.hypot(bx, by);
    bx /= bl; by /= bl;
    var h = r / Math.sin(th / 2), cx = P[0] + bx * h, cy = P[1] + by * h;
    var t1 = [P[0] + ux * t, P[1] + uy * t], t2 = [P[0] + vx * t, P[1] + vy * t];
    var a1 = Math.atan2(t1[1] - cy, t1[0] - cx), a2 = Math.atan2(t2[1] - cy, t2[0] - cx), d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return arcPts(cx, cy, r, a1, a1 + d, true, true);
  }
  function pointList(c, list, fillet, path) {
    var e0 = c.errs;
    if (!c.list(list, path, 2, 10000, 'points')) return null;
    var nodes = [];
    list.forEach(function (e, i) {
      var ep = path + '[' + i + ']';
      if (Array.isArray(e)) {
        if (e.length < 2 || e.length > 3) { c.err(ep, 'a point is [x, y] (or [x, y, r] to round that corner)'); return; }
        nodes.push({ p: [c.num(e[0], ep + '[0]'), c.num(e[1], ep + '[1]')], fr: e.length > 2 ? c.num(e[2], ep + '[2]', { ge: 0 }) : null });
      } else if (isObj(e) && e.to != null) {
        if (i === 0) { c.err(ep, 'the first entry must be a point [x, y]'); return; }
        var to = c.vec(e.to, ep + '.to', 2), via = e.via != null ? c.vec(e.via, ep + '.via', 2) : null;
        nodes.push({ p: to || [NaN, NaN], via: via });
      } else {
        c.err(ep, 'expected [x, y] or {"to": [x, y], "via": [x, y]}');
      }
    });
    if (c.errs > e0) return null;
    var V = [{ p: nodes[0].p, fr: nodes[0].fr, arcIn: null }];
    for (var i = 1; i < nodes.length; i++) {
      var nd = nodes[i], prev = V[V.length - 1].p;
      var arc = nd.via ? arcThrough(prev, nd.via, nd.p) : null;
      V.push({ p: nd.p, fr: nd.via ? null : nd.fr, arcIn: arc && arc.length ? arc : null });
    }
    var sc = 1e-7 * polyScale(V.map(function (v) { return v.p; }));
    var last = V[V.length - 1];
    if (V.length > 1 && Math.abs(last.p[0] - V[0].p[0]) <= sc && Math.abs(last.p[1] - V[0].p[1]) <= sc) {
      V[0].arcIn = last.arcIn;
      if (last.arcIn) V[0].fr = null;
      V.pop();
    }
    var W = [];
    V.forEach(function (v) {
      var l = W[W.length - 1];
      if (l && !v.arcIn && Math.abs(l.p[0] - v.p[0]) <= sc && Math.abs(l.p[1] - v.p[1]) <= sc) return;
      W.push(v);
    });
    var n = W.length, out = [];
    for (var j = 0; j < n; j++) {
      var v = W[j], nx = W[(j + 1) % n], pv = W[(j - 1 + n) % n];
      if (v.arcIn) out.push.apply(out, v.arcIn);
      var r = v.fr != null ? v.fr : fillet;
      var f = (r > 0 && n >= 3 && !v.arcIn && !nx.arcIn) ? filletPts(pv.p, v.p, nx.p, r) : null;
      if (f) out.push.apply(out, f); else out.push(v.p);
    }
    return out;
  }
  // -> outline points (CCW) or null; problems go to c. centred: rect/rrect centred on 0,0 (sweep, loft)
  function resolveProfile(c, spec, path, centred) {
    var e0 = c.errs, pts = null, a;
    if (spec == null) { c.err(path, 'is required'); return null; }
    if (Array.isArray(spec)) {
      pts = pointList(c, spec, 0, path);
    } else if (isObj(spec)) {
      if (spec.points != null) {
        var fr = c.num(spec.fillet, path + '.fillet', { def: 0, ge: 0 });
        pts = pointList(c, spec.points, fr || 0, path + '.points');
      } else if (spec.rect != null) {
        a = c.vec(spec.rect, path + '.rect', 2, { gt: 0 });
        if (a) pts = [[0, 0], [a[0], 0], [a[0], a[1]], [0, a[1]]];
      } else if (spec.rrect != null) {
        a = c.vec(spec.rrect, path + '.rrect', 3, { gt: 0 });
        if (a) {
          var w = a[0], h = a[1], r = Math.min(a[2], w / 2, h / 2);
          pts = [].concat(arcPts(w - r, r, r, -Math.PI / 2, 0, true, true), arcPts(w - r, h - r, r, 0, Math.PI / 2, true, true),
            arcPts(r, h - r, r, Math.PI / 2, Math.PI, true, true), arcPts(r, r, r, Math.PI, 1.5 * Math.PI, true, true));
        }
      } else if (spec.circle != null) {
        if (Array.isArray(spec.circle) && spec.circle.length === 3) {
          var cx = c.num(spec.circle[0], path + '.circle[0]'), cy = c.num(spec.circle[1], path + '.circle[1]'), cr = c.num(spec.circle[2], path + '.circle[2]', { gt: 0 });
          if (c.errs === e0) pts = circlePts(cx, cy, cr);
        } else c.err(path + '.circle', 'is [cx, cy, r]');
      } else if (spec.ngon != null) {
        if (Array.isArray(spec.ngon) && spec.ngon.length === 4) {
          var gx = c.num(spec.ngon[0], path + '.ngon[0]'), gy = c.num(spec.ngon[1], path + '.ngon[1]');
          var gr = c.num(spec.ngon[2], path + '.ngon[2]', { gt: 0 }), gn = c.num(spec.ngon[3], path + '.ngon[3]', { int: true, ge: 3, le: 256 });
          if (c.errs === e0) pts = ngonPts(gx, gy, gr, gn);
        } else c.err(path + '.ngon', 'is [cx, cy, r, n]');
      } else if (spec.slot != null) {
        if (Array.isArray(spec.slot) && spec.slot.length === 4) {
          var sx = c.num(spec.slot[0], path + '.slot[0]'), sy = c.num(spec.slot[1], path + '.slot[1]');
          var sl = c.num(spec.slot[2], path + '.slot[2]', { gt: 0 }), sr = c.num(spec.slot[3], path + '.slot[3]', { gt: 0 });
          if (c.errs === e0) {
            if (sl < 2 * sr - 1e-9) c.err(path + '.slot', 'the length (end to end) must be at least 2 r');
            else {
              var hl = sl / 2 - sr;
              pts = hl <= 1e-9 ? circlePts(sx, sy, sr) : [].concat(arcPts(sx + hl, sy, sr, -Math.PI / 2, Math.PI / 2, true, true), arcPts(sx - hl, sy, sr, Math.PI / 2, 1.5 * Math.PI, true, true));
            }
          }
        } else c.err(path + '.slot', 'is [cx, cy, length, r]');
      } else {
        c.err(path, 'unknown profile: use rect, rrect, circle, ngon, slot, points or a list of points');
      }
    } else {
      c.err(path, 'a profile is a shape like {"rect": [w, h]} or a list of points');
    }
    if (c.errs > e0 || !pts) return null;
    if (centred && isObj(spec) && (spec.rect != null || spec.rrect != null) && a) {
      var hx = a[0] / 2, hy = a[1] / 2;
      pts = pts.map(function (q) { return [q[0] - hx, q[1] - hy]; });
    }
    pts = dedupe(pts);
    if (pts.length < 3) { c.err(path, 'needs at least 3 distinct points'); return null; }
    var ar = polyArea(pts), s = polyScale(pts);
    if (Math.abs(ar) < 1e-9 * s * s) { c.err(path, 'the outline has no area'); return null; }
    if (ar < 0) pts.reverse();
    return pts;
  }
  // vertex k at -90 + 180/n + k*360/n degrees: a flat edge at the bottom
  function ngonPts(cx, cy, r, n) {
    var out = [];
    for (var k = 0; k < n; k++) { var a = (-90 + 180 / n + k * 360 / n) * DEG; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  }
  function resolveHoles(c, holes, outline, path, centred) {
    if (holes == null) return [];
    if (!Array.isArray(holes)) { c.err(path, 'must be a list of profiles'); return []; }
    var out = [];
    holes.forEach(function (h, i) {
      var hp = resolveProfile(c, h, path + '[' + i + ']', centred);
      if (!hp) return;
      if (outline && !hp.every(function (q) { return pointInPoly(q, outline); })) {
        c.warn(path + '[' + i + ']', 'the hole is not inside the outline; it was left out');
        return;
      }
      out.push(hp.slice().reverse());
    });
    return out;
  }

  // ---------------------------------------------------------------- part fields
  var SHAPE_KEYS = ['size', 'r', 'r2', 'h', 'tube', 'n', 'profile', 'holes', 'depth', 'bevel', 'angle', 'path', 'closed', 'smooth', 'sections', 'points', 'v', 'f', 'src', 'fit', 'unit', 'up', 'parts', 'of'];
  // -> {gk, R} (geometry kind + resolved numbers) or null
  function resolveShape(c, p, path) {
    var e0 = c.errs, R, gk = p.kind;
    switch (p.kind) {
      case 'box':
        R = { s: c.vec(p.size, path + '.size', 3, { gt: 0 }), r: c.num(p.r, path + '.r', { def: 0, ge: 0 }) };
        break;
      case 'cyl': {
        var r = c.num(p.r, path + '.r', { gt: 0 });
        R = { r: r, h: c.num(p.h, path + '.h', { gt: 0 }), r2: p.r2 == null ? r : c.num(p.r2, path + '.r2', { ge: 0 }) };
        break;
      }
      case 'cone':
        gk = 'cyl';
        R = { r: c.num(p.r, path + '.r', { gt: 0 }), h: c.num(p.h, path + '.h', { gt: 0 }), r2: 0 };
        break;
      case 'sphere':
        R = { r: c.num(p.r, path + '.r', { gt: 0 }) };
        break;
      case 'torus':
        R = { r: c.num(p.r, path + '.r', { gt: 0 }), t: c.num(p.tube, path + '.tube', { gt: 0 }) };
        break;
      case 'prism':
        R = { n: c.num(p.n, path + '.n', { int: true, ge: 3, le: 256 }), r: c.num(p.r, path + '.r', { gt: 0 }), h: c.num(p.h, path + '.h', { gt: 0 }) };
        break;
      case 'extrude': {
        var o = resolveProfile(c, p.profile, path + '.profile');
        R = { o: o, holes: resolveHoles(c, p.holes, o, path + '.holes'), d: c.num(p.depth, path + '.depth', { gt: 0 }), b: c.num(p.bevel, path + '.bevel', { def: 0, ge: 0 }) };
        break;
      }
      case 'lathe': {
        var lo = resolveProfile(c, p.profile, path + '.profile');
        if (lo) {
          var minR = Math.min.apply(null, lo.map(function (q) { return q[0]; }));
          if (minR < -1e-9) c.err(path + '.profile', 'a lathe profile is in (radius, z): radius must be >= 0 (got ' + fmt(minR) + ')');
          else lo = lo.map(function (q) { return [Math.max(0, q[0]), q[1]]; });
        }
        R = { o: lo, a: c.num(p.angle, path + '.angle', { def: 360, gt: 0, le: 360 }) };
        break;
      }
      case 'sweep': {
        var so = resolveProfile(c, p.profile, path + '.profile', true), sp = null;
        if (c.list(p.path, path + '.path', 2, LIMITS.pathPoints, 'points')) {
          sp = p.path.map(function (q, i) { return c.vec(q, path + '.path[' + i + ']', 3, { pad: 0 }); });
        }
        R = { o: so, holes: resolveHoles(c, p.holes, so, path + '.holes', true), p: sp, c: bool(p.closed), s: bool(p.smooth) };
        break;
      }
      case 'loft': {
        var secs = [];
        if (c.list(p.sections, path + '.sections', 2, 200, 'sections')) {
          p.sections.forEach(function (s, i) {
            var spath = path + '.sections[' + i + ']';
            if (!isObj(s)) { c.err(spath, 'a section is {"profile": ..., "z": number}'); return; }
            secs.push({ o: resolveProfile(c, s.profile, spath + '.profile', true), z: c.num(s.z, spath + '.z') });
          });
          for (var i = 1; i < secs.length; i++) if (secs[i].z === secs[i - 1].z) c.err(path + '.sections[' + i + '].z', 'must differ from the previous section');
        }
        R = { secs: secs };
        break;
      }
      case 'hull': {
        var hp = null;
        if (c.list(p.points, path + '.points', 4, LIMITS.hullPoints, 'points')) hp = p.points.map(function (q, i) { return c.vec(q, path + '.points[' + i + ']', 3); });
        R = { p: hp };
        break;
      }
      case 'mesh': {
        var mv = null, mf = null;
        if (c.list(p.v, path + '.v', 3, LIMITS.meshFaces * 3, 'vertices')) mv = p.v.map(function (q, i) { return c.vec(q, path + '.v[' + i + ']', 3); });
        if (c.list(p.f, path + '.f', 1, LIMITS.meshFaces, 'faces') && mv) {
          mf = p.f.map(function (f, i) {
            var fp = path + '.f[' + i + ']';
            if (!Array.isArray(f) || f.length < 3) { c.err(fp, 'a face is a list of at least 3 vertex indices'); return null; }
            return f.map(function (x, j) {
              var k = c.num(x, fp + '[' + j + ']', { int: true, ge: 0 });
              if (k >= mv.length) c.err(fp + '[' + j + ']', 'no vertex ' + k + ' (there are ' + mv.length + ')');
              return k;
            });
          });
        }
        R = { v: mv, f: mf };
        break;
      }
      default:
        c.err(path + '.kind', 'not a geometry kind');
    }
    if (c.errs > e0) return null;
    return { gk: gk, R: R };
  }
  function resolvePlacement(c, p, path) {
    var pl = {
      at: c.vec(p.at, path + '.at', 3, { pad: 0, def: [0, 0, 0] }) || [0, 0, 0],
      rot: c.vec(p.rot, path + '.rot', 3, { pad: 0, def: [0, 0, 0] }) || [0, 0, 0],
      scale: [1, 1, 1]
    };
    if (p.scale != null) {
      if (Array.isArray(p.scale) || isObj(p.scale)) pl.scale = c.vec(p.scale, path + '.scale', 3, { pad: 1, ne0: true }) || [1, 1, 1];
      else { var s = c.num(p.scale, path + '.scale', { ne0: true }); pl.scale = [s, s, s]; }
    }
    return pl;
  }
  function resolveArray(c, a, path) {
    if (!isObj(a)) { c.err(path, 'an array is {"n", "d"}, {"grid", "d"} or {"radial", ...}'); return null; }
    var e0 = c.errs, out;
    if (a.n != null) {
      out = { k: 'lin', count: c.num(a.n, path + '.n', { int: true, ge: 1, le: LIMITS.instances }), d: c.vec(a.d, path + '.d', 3, { pad: 0 }) };
    } else if (a.grid != null) {
      var g = c.vec(a.grid, path + '.grid', 2, { int: true, ge: 1, le: LIMITS.instances });
      var d = Array.isArray(a.d) && a.d.length === 3 ? c.vec(a.d, path + '.d', 3) : c.vec(a.d, path + '.d', 2, { pad: 0 });
      out = { k: 'grid', g: g, d: d, count: g ? g[0] * g[1] : 0 };
      if (g && out.count > LIMITS.instances) c.err(path + '.grid', 'more than ' + LIMITS.instances + ' instances');
    } else if (a.radial != null) {
      var axis = a.axis == null ? 'z' : String(a.axis).toLowerCase();
      if (['x', 'y', 'z'].indexOf(axis) < 0) c.err(path + '.axis', 'must be "x", "y" or "z"');
      out = {
        k: 'rad', count: c.num(a.radial, path + '.radial', { int: true, ge: 1, le: LIMITS.instances }), axis: axis,
        angle: c.num(a.angle, path + '.angle', { def: 360 }), center: c.vec(a.center, path + '.center', 3, { pad: 0, def: [0, 0, 0] })
      };
    } else {
      c.err(path, 'an array needs "n", "grid" or "radial"');
    }
    return c.errs > e0 ? null : out;
  }
  function resolveMirror(c, m, path) {
    if (m == null || m === false) return null;
    var s = String(m).toLowerCase();
    if (['x', 'y', 'z'].indexOf(s) < 0) { c.err(path, 'must be "x", "y" or "z"'); return null; }
    return s;
  }

  // ---------------------------------------------------------------- materials
  var matCache = new Map();
  var defaultFileMat = null, edgeMat = null;
  function matDef(spec, model) {
    if (spec == null || spec === '') return { name: 'default', def: DEFAULT_MAT };
    if (typeof spec === 'string') {
      if (HEX_RE.test(spec)) return { name: spec, def: { color: spec } };
      var mats = model && model.materials;
      if (isObj(mats) && hasOwn(mats, spec)) {
        var d = mats[spec];
        if (typeof d === 'string') {
          if (hasOwn(PRESETS, d)) return { name: spec, def: PRESETS[d] };
          if (HEX_RE.test(d)) return { name: spec, def: { color: d } };
          throw new Error('material "' + spec + '" names an unknown preset "' + d + '"');
        }
        if (isObj(d)) return { name: spec, def: d };
        throw new Error('material "' + spec + '" must be a preset name or {"color": "#rrggbb", ...}');
      }
      if (hasOwn(PRESETS, spec)) return { name: spec, def: PRESETS[spec] };
      throw new Error('unknown material "' + spec + '"; use a preset (' + Object.keys(PRESETS).join(', ') + '), "#rrggbb" or a name from materials');
    }
    if (isObj(spec)) return { name: 'custom', def: spec };
    throw new Error('a material is a name or "#rrggbb"');
  }
  function unit01(v, key, dflt) {
    if (v == null) return dflt;
    var x = Number(v);
    if (!isFinite(x)) throw new Error(key + ' must be a number from 0 to 1');
    return Math.max(0, Math.min(1, x));
  }
  function normMat(def) {
    if (!HEX_RE.test(String(def.color || ''))) throw new Error(def.color == null ? 'a material needs "color": "#rrggbb"' : 'color must be "#rrggbb" (got "' + def.color + '")');
    return { color: def.color.toLowerCase(), metal: unit01(def.metal, 'metal', 0), rough: unit01(def.rough, 'rough', 0.6), opacity: unit01(def.opacity, 'opacity', 1) };
  }
  function makeMaterial(name, d) {
    var THREE = T();
    var m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(d.color), metalness: d.metal, roughness: d.rough, opacity: d.opacity,
      transparent: d.opacity < 1, depthWrite: d.opacity >= 1,
      side: d.opacity < 1 ? THREE.FrontSide : THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    m.name = name;
    return m;
  }
  function material(spec, model) {
    var md = matDef(spec, model), d = normMat(md.def);
    var key = md.name + '|' + d.color + '|' + d.metal + '|' + d.rough + '|' + d.opacity;
    var hit = matCache.get(key);
    if (hit) return hit;
    var m = makeMaterial(md.name, d);
    m.userData.mkKey = key;
    matCache.set(key, m);
    return m;
  }
  function edgeMaterial() {
    if (!edgeMat) {
      var THREE = T();
      edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
      edgeMat.name = 'edges';
    }
    return edgeMat;
  }
  function fileMaterial() {
    if (!defaultFileMat) defaultFileMat = makeMaterial('default', normMat(DEFAULT_MAT));
    return defaultFileMat;
  }

  // ---------------------------------------------------------------- geometry
  function v2(T3, p) { return new T3.Vector2(p[0], p[1]); }
  function shapeOf(THREE, outline, holes) {
    var s = new THREE.Shape(outline.map(function (p) { return v2(THREE, p); }));
    (holes || []).forEach(function (h) { s.holes.push(new THREE.Path(h.map(function (p) { return v2(THREE, p); }))); });
    return s;
  }
  function triangulate(THREE, loops) {
    var contour = loops[0].map(function (p) { return v2(THREE, p); });
    var holes = loops.slice(1).map(function (l) { return l.map(function (p) { return v2(THREE, p); }); });
    var flat = loops.reduce(function (a, l) { return a.concat(l); }, []);
    var faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    return faces.map(function (f) {
      var a = flat[f[0]], b = flat[f[1]], c = flat[f[2]];
      var cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      return cr < 0 ? [f[0], f[2], f[1]] : [f[0], f[1], f[2]];
    });
  }
  function indexed(THREE, pos, idx) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    return g;
  }
  function forTris(geo, fn) {
    var pos = geo.attributes.position, idx = geo.index, n = idx ? idx.count : pos.count;
    for (var i = 0; i + 2 < n; i += 3) {
      if (idx) fn(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)); else fn(i, i + 1, i + 2);
    }
  }
  function triCount(geo) {
    if (!geo || !geo.attributes || !geo.attributes.position) return 0;
    return Math.floor((geo.index ? geo.index.count : geo.attributes.position.count) / 3);
  }
  // volume (signed) and area of a geometry under an optional matrix
  function measure(geo, m) {
    var THREE = T(), pos = geo.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    var e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), vol = 0, area = 0;
    forTris(geo, function (i, j, k) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, j); c.fromBufferAttribute(pos, k);
      if (m) { a.applyMatrix4(m); b.applyMatrix4(m); c.applyMatrix4(m); }
      vol += a.dot(e1.copy(b).cross(c)) / 6;
      area += e1.subVectors(b, a).cross(e2.subVectors(c, a)).length() / 2;
    });
    return { vol: vol, area: area };
  }
  function isClosed(geo) {
    if (geo.userData.mkClosed !== undefined) return geo.userData.mkClosed;
    var pos = geo.attributes.position;
    if (!geo.boundingBox) geo.computeBoundingBox();
    var bb = geo.boundingBox, diag = Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    var eps = diag * 1e-6 + 1e-9, ids = new Map(), remap = new Int32Array(pos.count);
    for (var i = 0; i < pos.count; i++) {
      var key = Math.round(pos.getX(i) / eps) + ',' + Math.round(pos.getY(i) / eps) + ',' + Math.round(pos.getZ(i) / eps);
      var id = ids.get(key);
      if (id === undefined) { id = ids.size; ids.set(key, id); }
      remap[i] = id;
    }
    var M = ids.size, edges = new Map(), closed = true, any = false;
    function edge(a, b) {
      var k = a < b ? a * M + b : b * M + a, e = edges.get(k);
      if (!e) { e = [0, 0]; edges.set(k, e); }
      e[0]++; e[1] += a < b ? 1 : -1;
    }
    forTris(geo, function (i, j, k) {
      var a = remap[i], b = remap[j], c = remap[k];
      if (a === b || b === c || a === c) return;
      any = true;
      edge(a, b); edge(b, c); edge(c, a);
    });
    edges.forEach(function (e) { if (e[0] % 2 !== 0 || e[1] !== 0) closed = false; });
    geo.userData.mkClosed = any && closed;
    return geo.userData.mkClosed;
  }
  function flipWinding(geo) {
    if (geo.index) {
      var ix = geo.index.array;
      for (var i = 0; i + 2 < ix.length; i += 3) { var t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
      geo.index.needsUpdate = true;
    } else {
      Object.keys(geo.attributes).forEach(function (name) {
        var at = geo.attributes[name], s = at.itemSize, arr = at.array;
        for (var i = 0; i + 2 < at.count; i += 3) {
          for (var c = 0; c < s; c++) { var a = (i + 1) * s + c, b = (i + 2) * s + c, t = arr[a]; arr[a] = arr[b]; arr[b] = t; }
        }
        at.needsUpdate = true;
      });
    }
  }
  // closed solids face outward; normals creased; returns the finished geometry
  function finishSolid(geo, force) {
    var THREE = T();
    if ((force || isClosed(geo)) && measure(geo).vol < 0) flipWinding(geo);
    delete geo.userData.mkClosed;
    var out = THREE.BufferGeometryUtils.toCreasedNormals(geo, CREASE);
    if (out !== geo) geo.dispose();
    return out;
  }

  var BUILDERS = {
    box: function (THREE, R) {
      var s = R.s, g;
      if (R.r > 0) {
        var r = Math.min(R.r, Math.min(s[0], s[1], s[2]) / 2 * 0.999);
        g = new THREE.RoundedBoxGeometry(s[0], s[1], s[2], 4, r);
      } else g = new THREE.BoxGeometry(s[0], s[1], s[2]);
      g.translate(s[0] / 2, s[1] / 2, s[2] / 2);
      return g;
    },
    cyl: function (THREE, R) {
      var g = new THREE.CylinderGeometry(R.r2, R.r, R.h, segsFor(Math.max(R.r, R.r2)), 1, false);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, R.h / 2);
      return finishSolid(g);
    },
    sphere: function (THREE, R) {
      var n = segsFor(R.r), g = new THREE.SphereGeometry(R.r, n, Math.ceil(n / 2));
      g.rotateX(Math.PI / 2);
      return g;
    },
    torus: function (THREE, R) {
      return new THREE.TorusGeometry(R.r, R.t, 4 * Math.ceil(segsFor(R.t) / 8), segsFor(R.r));
    },
    prism: function (THREE, R) {
      var g = new THREE.ExtrudeGeometry(shapeOf(THREE, ngonPts(0, 0, R.r, R.n)), { depth: R.h, bevelEnabled: false, steps: 1, curveSegments: 1 });
      return finishSolid(g);
    },
    extrude: function (THREE, R) {
      var g, b = Math.min(R.b || 0, R.d * 0.49), shape = shapeOf(THREE, R.o, R.holes);
      if (b > 0) {
        g = new THREE.ExtrudeGeometry(shape, { depth: R.d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 3, steps: 1, curveSegments: 1 });
        g.translate(0, 0, b);
      } else g = new THREE.ExtrudeGeometry(shape, { depth: R.d, bevelEnabled: false, steps: 1, curveSegments: 1 });
      return finishSolid(g);
    },
    lathe: function (THREE, R) {
      var pts = R.o, m = pts.length, full = R.a >= 359.999;
      var maxR = Math.max.apply(null, pts.map(function (p) { return p[0]; }));
      var S = Math.max(3, Math.ceil(segsFor(maxR) * R.a / 360)), rings = full ? S : S + 1, pos = [], idx = [];
      for (var j = 0; j < rings; j++) {
        var th = j * R.a / S * DEG, co = Math.cos(th), si = Math.sin(th);
        for (var i = 0; i < m; i++) pos.push(pts[i][0] * co, pts[i][0] * si, pts[i][1]);
      }
      for (j = 0; j < S; j++) {
        var j2 = full ? (j + 1) % S : j + 1;
        for (i = 0; i < m; i++) {
          var i2 = (i + 1) % m, A = j * m + i, B = j * m + i2, C = j2 * m + i2, D = j2 * m + i;
          idx.push(A, C, B, A, D, C);
        }
      }
      if (!full) {
        triangulate(THREE, [pts]).forEach(function (f) {
          idx.push(f[0], f[1], f[2]);
          idx.push(S * m + f[0], S * m + f[2], S * m + f[1]);
        });
      }
      return finishSolid(indexed(THREE, pos, idx), true);
    },
    sweep: function (THREE, R) {
      var V3 = THREE.Vector3, loops = [R.o].concat(R.holes || []);
      var P = R.p.map(function (q) { return new V3(q[0], q[1], q[2]); });
      if (R.s && P.length >= 2) {
        var curve = new THREE.CatmullRomCurve3(P, R.c && P.length >= 3, 'centripetal');
        var N = Math.max(32, Math.min(512, P.length * 16));
        P = curve.getPoints(N);
      }
      var pts = [], eps = 1e-6;
      P.forEach(function (q) { if (!pts.length || pts[pts.length - 1].distanceTo(q) > eps) pts.push(q); });
      var closed = R.c && pts.length >= 3;
      if (closed && pts[0].distanceTo(pts[pts.length - 1]) <= eps) pts.pop();
      var n = pts.length;
      if (n < 2) throw new Error('the path needs at least 2 distinct points');
      var segs = closed ? n : n - 1, tg = [], X = [], Y = [];
      for (var i = 0; i < segs; i++) tg.push(new V3().subVectors(pts[(i + 1) % n], pts[i]).normalize());
      var ref = Math.abs(tg[0].z) > 0.999 ? new V3(0, 1, 0) : new V3(0, 0, 1);
      Y[0] = ref.clone().addScaledVector(tg[0], -ref.dot(tg[0])).normalize();
      X[0] = new V3().crossVectors(Y[0], tg[0]);
      var q = new THREE.Quaternion();
      for (i = 1; i < segs; i++) {
        q.setFromUnitVectors(tg[i - 1], tg[i]);
        var y = Y[i - 1].clone().applyQuaternion(q);
        y.addScaledVector(tg[i], -y.dot(tg[i])).normalize();
        Y[i] = y; X[i] = new V3().crossVectors(y, tg[i]);
      }
      if (closed) {
        q.setFromUnitVectors(tg[segs - 1], tg[0]);
        var xe = X[segs - 1].clone().applyQuaternion(q);
        var phi = Math.atan2(new V3().crossVectors(X[0], xe).dot(tg[0]), X[0].dot(xe));
        for (i = 1; i < segs; i++) {
          q.setFromAxisAngle(tg[i], -phi * i / segs);
          X[i].applyQuaternion(q); Y[i].applyQuaternion(q);
        }
      }
      var flat = loops.reduce(function (a, l) { return a.concat(l); }, []), Vn = flat.length, pos = [], idx = [];
      var off = new V3(), mt = new V3();
      for (var k = 0; k < n; k++) {
        var fi, tin = null, tout = null;
        if (closed) { fi = (k - 1 + n) % n; tin = tg[fi]; tout = tg[k]; } else if (k === 0) fi = 0;
        else if (k === n - 1) fi = segs - 1;
        else { fi = k - 1; tin = tg[k - 1]; tout = tg[k]; }
        var d = 0;
        if (tin) { mt.addVectors(tin, tout).normalize(); d = tin.dot(mt); }
        for (var j = 0; j < Vn; j++) {
          off.copy(X[fi]).multiplyScalar(flat[j][0]).addScaledVector(Y[fi], flat[j][1]);
          if (tin && d > 0.05) off.addScaledVector(tin, -off.dot(mt) / d);
          pos.push(pts[k].x + off.x, pts[k].y + off.y, pts[k].z + off.z);
        }
      }
      var last = closed ? n : n - 1;
      for (k = 0; k < last; k++) {
        var k2 = (k + 1) % n, o = 0;
        loops.forEach(function (l) {
          var m = l.length;
          for (var jj = 0; jj < m; jj++) {
            var jn = (jj + 1) % m, A = k * Vn + o + jj, B = k * Vn + o + jn, C = k2 * Vn + o + jn, D = k2 * Vn + o + jj;
            idx.push(A, B, C, A, C, D);
          }
          o += m;
        });
      }
      if (!closed) {
        triangulate(THREE, loops).forEach(function (f) {
          idx.push(f[0], f[2], f[1]);
          idx.push((n - 1) * Vn + f[0], (n - 1) * Vn + f[1], (n - 1) * Vn + f[2]);
        });
      }
      return finishSolid(indexed(THREE, pos, idx), true);
    },
    loft: function (THREE, R) {
      var secs = R.secs.map(function (s) { return s.o.slice(); });
      var N = Math.min(512, Math.max.apply(null, secs.map(function (s) { return s.length; })));
      secs = secs.map(function (s) { return refine(s, N); });
      for (var k = 1; k < secs.length; k++) secs[k] = align(secs[k - 1], secs[k]);
      var pos = [], idx = [];
      secs.forEach(function (s, k) { s.forEach(function (p) { pos.push(p[0], p[1], R.secs[k].z); }); });
      for (k = 0; k + 1 < secs.length; k++) {
        for (var j = 0; j < N; j++) {
          var j2 = (j + 1) % N, A = k * N + j, B = k * N + j2, C = (k + 1) * N + j2, D = (k + 1) * N + j;
          idx.push(A, B, C, A, C, D);
        }
      }
      var L = secs.length - 1;
      triangulate(THREE, [secs[0]]).forEach(function (f) { idx.push(f[0], f[2], f[1]); });
      triangulate(THREE, [secs[L]]).forEach(function (f) { idx.push(L * N + f[0], L * N + f[1], L * N + f[2]); });
      return finishSolid(indexed(THREE, pos, idx), true);
    },
    hull: function (THREE, R) {
      var flatMsg = 'the points are flat: a hull needs 4 points that are not on one plane';
      var P = R.p.map(function (q) { return new THREE.Vector3(q[0], q[1], q[2]); });
      // farthest-point tests: a line, then a plane, then something off the plane
      var far = function (f) { var bi = 0, bd = -1; P.forEach(function (p, i) { var d = f(p); if (d > bd) { bd = d; bi = i; } }); return [P[bi], bd]; };
      var a = P[0], b = far(function (p) { return p.distanceTo(a); }), ab = new THREE.Vector3().subVectors(b[0], a);
      var size = Math.max(b[1], 1e-12), line = new THREE.Line3(a, b[0]), tmp = new THREE.Vector3();
      var c = far(function (p) { return line.closestPointToPoint(p, false, tmp).distanceTo(p); });
      var nrm = new THREE.Vector3().crossVectors(ab, new THREE.Vector3().subVectors(c[0], a));
      if (b[1] < 1e-9 || c[1] < 1e-9 * size || nrm.lengthSq() === 0) throw new Error(flatMsg);
      var pl = new THREE.Plane().setFromCoplanarPoints(a, b[0], c[0]);
      if (far(function (p) { return Math.abs(pl.distanceToPoint(p)); })[1] < 1e-9 * size) throw new Error(flatMsg);
      var g = new THREE.ConvexGeometry(P);
      if (triCount(g) < 4) throw new Error(flatMsg);
      return g;
    },
    mesh: function (THREE, R) {
      var pos = [], idx = [];
      R.v.forEach(function (q) { pos.push(q[0], q[1], q[2]); });
      R.f.forEach(function (f) { for (var i = 1; i + 1 < f.length; i++) idx.push(f[0], f[i], f[i + 1]); });
      return finishSolid(indexed(THREE, pos, idx), false);
    }
  };
  // split the longest edges until the outline has n points (keeps every original corner)
  function refine(s, n) {
    s = s.slice();
    while (s.length < n) {
      var best = 0, bl = -1;
      for (var i = 0; i < s.length; i++) {
        var a = s[i], b = s[(i + 1) % s.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l > bl) { bl = l; best = i; }
      }
      var p = s[best], q = s[(best + 1) % s.length];
      s.splice(best + 1, 0, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
    }
    return s;
  }
  function centroid(s) {
    var x = 0, y = 0;
    s.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / s.length, y / s.length];
  }
  // rotate the start of s so it lines up with prev (both CCW, same count)
  function align(prev, s) {
    var n = s.length, cp = centroid(prev), cs = centroid(s), best = 0, bd = Infinity;
    for (var sh = 0; sh < n; sh++) {
      var d = 0;
      for (var j = 0; j < n && d < bd; j++) {
        var a = s[(j + sh) % n], b = prev[j];
        var dx = (a[0] - cs[0]) - (b[0] - cp[0]), dy = (a[1] - cs[1]) - (b[1] - cp[1]);
        d += dx * dx + dy * dy;
      }
      if (d < bd) { bd = d; best = sh; }
    }
    return s.slice(best).concat(s.slice(0, best));
  }

  // ---------------------------------------------------------------- caches
  var geoCache = new Map();   // key -> {geo, gen}
  var edgeCache = new WeakMap();
  var mirrorCache = new WeakMap();
  var fileCache = new Map();  // src -> {data, promise, object, error, fit: {}}
  var gen = 0, latestGeos = new Set(), latestMats = new Set(), lastBuilt = null;

  // signature of a part's shape before resolution: its raw shape fields and the values of the
  // params they use. A hit skips resolution (profile sampling, hole checks) entirely.
  var sigNames = new Map();
  function shapeSig(st, p) {
    var o = {};
    for (var i = 0; i < SHAPE_KEYS.length; i++) if (p[SHAPE_KEYS[i]] !== undefined) o[SHAPE_KEYS[i]] = p[SHAPE_KEYS[i]];
    var raw;
    try { raw = p.kind + JSON.stringify(o); } catch (e) { return null; }
    var names = sigNames.get(raw);
    if (!names) {
      names = [];
      (function walk(v) {
        if (typeof v === 'string') { try { exprNames(v).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); }); } catch (e) { /* reported by resolution */ } } else if (Array.isArray(v)) v.forEach(walk);
        else if (isObj(v)) Object.keys(v).forEach(function (k) { walk(v[k]); });
      })(o);
      if (sigNames.size > 20000) sigNames.clear();
      sigNames.set(raw, names);
    }
    var vals = '';
    for (i = 0; i < names.length; i++) vals += '|' + st.values[names[i]];
    return 'S:' + raw + vals;
  }
  function getGeo(st, gk, R) {
    var key = gk + ':' + JSON.stringify(R), e = geoCache.get(key);
    if (e) { e.gen = st.gen; st.stats.cached++; st.geos.add(e.geo); return e.geo; }
    var geo = BUILDERS[gk](T(), R);
    geo.userData.mkKey = key;
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    geoCache.set(key, { geo: geo, gen: st.gen });
    st.stats.rebuilt++;
    st.geos.add(geo);
    return geo;
  }
  function edgesFor(st, geo) {
    if (edgeCache.has(geo)) { var hit = edgeCache.get(geo); if (hit) st.geos.add(hit); return hit; }
    var eg = null;
    if (triCount(geo) <= EDGE_TRI_BUDGET) eg = new (T().EdgesGeometry)(geo, EDGE_ANGLE);
    edgeCache.set(geo, eg);
    if (eg) st.geos.add(eg);
    return eg;
  }
  function edgeObject(THREE, geo) {
    var l = new THREE.LineSegments(geo, edgeMaterial());
    l.name = 'edges';
    l.userData.edges = true;
    l.raycast = function () {};
    return l;
  }
  function mirrorGeo(st, geo, axis, isLine) {
    var m = mirrorCache.get(geo);
    if (!m) { m = {}; mirrorCache.set(geo, m); }
    if (!m[axis]) {
      var THREE = T(), g = geo.clone(), s = [1, 1, 1];
      s['xyz'.indexOf(axis)] = -1;
      g.applyMatrix4(new THREE.Matrix4().makeScale(s[0], s[1], s[2]));
      if (!isLine) flipWinding(g);
      g.userData = { mkMirrorOf: geo.userData.mkKey || null };
      g.computeBoundingBox(); g.computeBoundingSphere();
      m[axis] = g;
    }
    if (st) st.geos.add(m[axis]);
    return m[axis];
  }

  // ---------------------------------------------------------------- files
  function extOf(name) { var m = /\.([A-Za-z0-9]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  function b64ToBytes(s) {
    if (typeof atob === 'function') {
      var bin = atob(s), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }
  function toBytes(d) {
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    if (typeof d === 'string') {
      if (d.slice(0, 5) === 'data:') {
        var comma = d.indexOf(','), meta = d.slice(5, comma), body = d.slice(comma + 1);
        if (/;base64$/i.test(meta)) return b64ToBytes(body.replace(/\s+/g, ''));
        return new TextEncoder().encode(decodeURIComponent(body));
      }
      return new TextEncoder().encode(d);
    }
    throw new Error('the file content is not bytes or text');
  }
  function toAB(d) { var b = toBytes(d); return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.slice().buffer; }
  function toText(d) {
    if (typeof d === 'string' && d.slice(0, 5) !== 'data:') return d;
    return new TextDecoder().decode(toBytes(d));
  }
  function checkGltfJson(json) {
    var used = [].concat(json.extensionsUsed || [], json.extensionsRequired || []);
    if (used.indexOf('KHR_draco_mesh_compression') >= 0) throw new Error('Draco-compressed glTF is not supported: export it again without Draco compression');
    (json.buffers || []).forEach(function (b) {
      if (b.uri && b.uri.slice(0, 5) !== 'data:') throw new Error('this .gltf refers to an outside file (' + b.uri + '); use a single .glb');
    });
    (json.images || []).forEach(function (b) {
      if (b.uri && b.uri.slice(0, 5) !== 'data:') throw new Error('this .gltf refers to an outside image (' + b.uri + '); use a single .glb');
    });
  }
  function glbJson(ab) {
    var dv = new DataView(ab);
    if (ab.byteLength < 20 || dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a GLB file');
    var len = dv.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, len)));
  }
  /** Normals a file left out, or wrote as zeros (many STL exporters do): computed from the faces. */
  function needNormals(geo) {
    var n = geo.attributes.normal;
    if (n) {
      var a = n.array, step = Math.max(3, Math.floor(a.length / 300 / 3) * 3);
      for (var i = 0; i + 2 < a.length; i += step) if (a[i] || a[i + 1] || a[i + 2]) return;
    }
    geo.computeVertexNormals();
  }
  function meshFrom(THREE, geo) {
    needNormals(geo);
    var mat = fileMaterial();
    if (geo.attributes.color) {
      mat = mat.clone(); mat.vertexColors = true; mat.color.set(0xffffff);
    }
    return new THREE.Mesh(geo, mat);
  }
  function parseFileData(ext, data) {
    var THREE = T();
    return Promise.resolve().then(function () {
      var ab, obj;
      switch (ext) {
        case 'glb':
        case 'gltf': {
          var input;
          if (ext === 'glb') { ab = toAB(data); checkGltfJson(glbJson(ab)); input = ab; } else { input = toText(data); checkGltfJson(JSON.parse(input)); }
          var loader = new THREE.GLTFLoader();
          if (THREE.MeshoptDecoder) loader.setMeshoptDecoder(THREE.MeshoptDecoder);
          return loader.parseAsync(input, '').then(function (gltf) {
            var sc = gltf.scene || (gltf.scenes && gltf.scenes[0]);
            if (!sc) throw new Error('the glTF file has no scene');
            var drop = [];
            sc.traverse(function (o) { if (o.isLight || o.isCamera) drop.push(o); });
            drop.forEach(function (o) { o.parent && o.parent.remove(o); });
            return sc;
          });
        }
        case 'stl':
          obj = meshFrom(THREE, new THREE.STLLoader().parse(toAB(data)));
          break;
        case 'ply': {
          var pg = new THREE.PLYLoader().parse(toAB(data));
          if (!pg.index) {
            // PLYLoader returns an indexed geometry when the file has faces
            throw new Error('the PLY file has no faces (a point cloud cannot be shown as a solid)');
          }
          obj = meshFrom(THREE, pg);
          break;
        }
        case 'obj': {
          obj = new THREE.OBJLoader().parse(toText(data));
          var drop = [];
          obj.traverse(function (o) {
            if (o.isMesh) {
              needNormals(o.geometry);
              o.material = o.geometry.attributes.color ? meshFrom(THREE, o.geometry).material : fileMaterial();
            } else if (o.isLine || o.isPoints) drop.push(o);
          });
          drop.forEach(function (o) { o.parent && o.parent.remove(o); });
          break;
        }
        case '3mf':
          obj = new THREE.ThreeMFLoader().parse(toAB(data));
          break;
        default:
          throw new Error('unsupported file type ".' + ext + '" (use glb, stl, obj, ply or 3mf)');
      }
      var g = new THREE.Group();
      g.add(obj);
      return g;
    }).then(function (o) {
      var tris = 0;
      o.traverse(function (m) { if (m.isMesh) tris += triCount(m.geometry); });
      if (!tris) throw new Error('the file has no triangles');
      return o;
    });
  }
  function convGroup(THREE, unit, up) {
    var g = new THREE.Group();
    g.name = 'file-units';
    if (up === 'y') g.rotation.x = Math.PI / 2;
    var s = UNITS[unit] || 1;
    g.scale.set(s, s, s);
    return g;
  }
  function fileDefaults(ext) { return ext === 'glb' || ext === 'gltf' ? { unit: 'm', up: 'y' } : { unit: 'mm', up: 'z' }; }

  // ---------------------------------------------------------------- matrices
  function arrayMats(THREE, a) {
    var out = [], k;
    if (a.k === 'lin') {
      for (k = 0; k < a.count; k++) out.push(new THREE.Matrix4().makeTranslation(a.d[0] * k, a.d[1] * k, a.d[2] * k));
    } else if (a.k === 'grid') {
      for (var j = 0; j < a.g[1]; j++) for (var i = 0; i < a.g[0]; i++) out.push(new THREE.Matrix4().makeTranslation(a.d[0] * i, a.d[1] * j, 0));
    } else {
      var ax = new THREE.Vector3(a.axis === 'x' ? 1 : 0, a.axis === 'y' ? 1 : 0, a.axis === 'z' ? 1 : 0);
      var step = Math.abs(a.angle) >= 360 ? a.angle / a.count : (a.count > 1 ? a.angle / (a.count - 1) : 0);
      var c = a.center, tc = new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]), tci = new THREE.Matrix4().makeTranslation(-c[0], -c[1], -c[2]);
      for (k = 0; k < a.count; k++) out.push(tc.clone().multiply(new THREE.Matrix4().makeRotationAxis(ax, step * k * DEG)).multiply(tci));
    }
    return out;
  }
  function placeObject(obj, pl) {
    obj.position.set(pl.at[0], pl.at[1], pl.at[2]);
    obj.rotation.set(pl.rot[0] * DEG, pl.rot[1] * DEG, pl.rot[2] * DEG, 'ZYX');
    obj.scale.set(pl.scale[0], pl.scale[1], pl.scale[2]);
    obj.updateMatrix();
  }
  function mirrorObject(st, o, axis) {
    var THREE = T(), s = [1, 1, 1];
    s['xyz'.indexOf(axis)] = -1;
    var M = new THREE.Matrix4().makeScale(s[0], s[1], s[2]);
    function mm(m) { return new THREE.Matrix4().multiplyMatrices(M, m).multiply(M); }
    function walk(src) {
      var c;
      if (src.isInstancedMesh) {
        c = new THREE.InstancedMesh(mirrorGeo(st, src.geometry, axis), src.material, src.count);
        var t = new THREE.Matrix4();
        for (var i = 0; i < src.count; i++) { src.getMatrixAt(i, t); c.setMatrixAt(i, mm(t)); }
        c.instanceMatrix.needsUpdate = true;
        c.computeBoundingBox(); c.computeBoundingSphere();
      } else if (src.isMesh) {
        c = new THREE.Mesh(mirrorGeo(st, src.geometry, axis), src.material);
      } else if (src.isLineSegments) {
        c = edgeObject(THREE, mirrorGeo(st, src.geometry, axis, true));
        c.material = src.material;
      } else c = new THREE.Group();
      c.name = src.name;
      c.visible = src.visible;
      c.userData = Object.assign({}, src.userData, { mirror: axis });
      if (c.userData.part) { c.userData.part = false; c.userData.mirrorOf = src.userData.partId; }
      src.updateMatrix();
      mm(src.matrix).decompose(c.position, c.quaternion, c.scale);
      src.children.forEach(function (ch) { c.add(walk(ch)); });
      return c;
    }
    return walk(o);
  }

  // ---------------------------------------------------------------- the walk (validate and build share it)
  function collectIds(st, list, path, groups) {
    if (!Array.isArray(list)) return;
    list.forEach(function (p, i) {
      if (!isObj(p)) return;
      var pp = path + '[' + i + ']';
      st.total++;
      if (p.id != null) {
        var id = String(p.id);
        if (hasOwn(st.idx, id)) st.dups.push({ id: id, spec: p, path: pp });
        else st.idx[id] = { spec: p, path: pp, groups: groups };
      }
      if (p.kind === 'ref' && p.of != null) st.refs.push({ spec: p, path: pp, groups: groups });
      if (p.kind === 'group' && Array.isArray(p.parts)) collectIds(st, p.parts, pp + '.parts', p.id != null ? groups.concat(String(p.id)) : groups);
    });
  }
  // groups that (through refs inside them) end up containing themselves
  function refCycles(st) {
    var edges = {}, bad = [];
    st.refs.forEach(function (r) {
      var t = st.idx[String(r.spec.of)];
      if (!t) return;
      var tgt = t.spec;
      var seen = {};
      while (tgt && tgt.kind === 'ref' && !seen[tgt.of]) { seen[tgt.of] = 1; var nx = st.idx[String(tgt.of)]; tgt = nx && nx.spec; }
      if (!tgt || tgt.kind !== 'group' || tgt.id == null) return;
      r.target = String(tgt.id);
      r.groups.forEach(function (g) { (edges[g] = edges[g] || []).push(r.target); });
    });
    function reaches(from, to, seen) {
      if (from === to) return true;
      if (seen[from]) return false;
      seen[from] = 1;
      return (edges[from] || []).some(function (n) { return reaches(n, to, seen); });
    }
    st.refs.forEach(function (r) {
      if (!r.target) return;
      if (r.groups.some(function (g) { return reaches(r.target, g, {}); })) bad.push(r.spec);
    });
    return bad;
  }
  function newState(model, overrides, mode) {
    var pr = params(model, overrides);
    var st = {
      model: model, mode: mode, build: mode === 'build', values: pr.values, defs: pr.defs, look: lookupFrom(pr.values),
      problems: pr.problems.slice(), idx: {}, dups: [], refs: [], total: 0, partCount: 0, instances: 0,
      byId: {}, records: [], geos: new Set(), mats: new Set(), quiet: 0, viaRef: 0, groupStack: [],
      stats: { parts: 0, instances: 0, triangles: 0, rebuilt: 0, cached: 0 }, fileEntries: {}
    };
    if (isObj(model) && Array.isArray(model.parts)) collectIds(st, model.parts, 'parts', []);
    st.badRefs = refCycles(st);
    return st;
  }
  function followRef(c, st, p, path) {
    var cur = p, mat = p.mat, seen = {}, tag = p.tag;
    seen[String(p.id)] = 1;
    while (cur.kind === 'ref') {
      var curPath = cur === p ? path : st.idx[String(cur.id)].path;
      if (cur.of == null || cur.of === '') { c.err(curPath + '.of', 'is required'); return null; }
      var of = String(cur.of), t = st.idx[of];
      if (!t) { c.err(curPath + '.of', 'no part with id "' + of + '"'); return null; }
      if (seen[of]) { c.err(curPath + '.of', 'the references go round in a circle'); return null; }
      seen[of] = 1;
      cur = t.spec;
      if (mat == null) mat = cur.mat;
      if (tag == null) tag = cur.tag;
    }
    if (st.badRefs.indexOf(p) >= 0) { c.err(path + '.of', 'refers to a group that contains this reference'); return null; }
    return { spec: cur, path: st.idx[String(cur.id)].path, mat: mat, tag: tag };
  }
  function walkList(st, list, path, parent, inh) {
    if (list == null) return;
    if (!Array.isArray(list)) { st.problems.push({ part: null, path: path, msg: 'must be a list of parts' }); return; }
    list.forEach(function (p, i) {
      var objs = walkPart(st, p, path + '[' + i + ']', inh);
      if (objs && parent) objs.forEach(function (o) { parent.add(o); });
    });
  }
  function walkPart(st, p, path, inh) {
    var c = new Ctx(st, isObj(p) && p.id != null ? String(p.id) : null);
    if (!isObj(p)) { c.err(path, 'a part must be an object'); return null; }
    if (!st.viaRef) {
      if (p.id == null || p.id === '') { c.err(path + '.id', 'is required'); return null; }
      if (!ID_RE.test(String(p.id))) { c.err(path + '.id', 'an id is 1 to 40 letters, digits, _ or -'); return null; }
      var ent = st.idx[String(p.id)];
      if (!ent || ent.spec !== p) { c.err(path + '.id', 'duplicate id "' + p.id + '"'); return null; }
    }
    if (KINDS.indexOf(p.kind) < 0) { c.err(path + '.kind', p.kind == null ? 'is required' : 'unknown kind "' + p.kind + '"; use one of ' + KINDS.join(', ')); return null; }
    var pl = resolvePlacement(c, p, path);
    var arr = p.array != null ? resolveArray(c, p.array, path + '.array') : null;
    var mir = resolveMirror(c, p.mirror, path + '.mirror');
    if (p.name != null && typeof p.name !== 'string' && typeof p.name !== 'number') c.err(path + '.name', 'must be text');
    if (p.tag != null && typeof p.tag !== 'string') c.err(path + '.tag', 'must be text');
    if (p.mat != null && !st.build) {
      try { normMat(matDef(p.mat, st.model).def); } catch (e) { c.err(path + '.mat', e.message); }
    }
    if (c.failed) return null;
    var count = arr ? arr.count : 1;
    if (!st.viaRef) {
      st.partCount++;
      if (st.partCount > LIMITS.parts) { c.err(path, 'over the limit of ' + LIMITS.parts + ' parts'); return null; }
      if (arr) {
        var inst = count * inh.mult;
        if (st.instances + inst > LIMITS.instances) { c.err(path + '.array', 'over the limit of ' + LIMITS.instances + ' array instances in the model'); return null; }
        st.instances += inst;
      }
    }
    var eff = p, effPath = path, matSpec = p.mat, tag = p.tag;
    if (p.kind === 'ref') {
      var fr = followRef(c, st, p, path);
      if (!fr) return null;
      eff = fr.spec; effPath = fr.path; matSpec = fr.mat; tag = fr.tag;
    }
    if (matSpec == null) matSpec = inh.mat;
    if (tag == null) tag = inh.tag;
    var mult = inh.mult * count * (mir ? 2 : 1);
    var ek = eff.kind;
    if (!st.build) {
      if (ek === 'group') {
        if (eff === p) walkList(st, p.parts, path + '.parts', null, { mat: matSpec, tag: tag, mult: mult });
      } else if (ek === 'file') {
        if (eff === p) checkFile(c, st, p, path);
      } else if (eff === p) {
        resolveShape(c, p, path);
      }
      return null;
    }
    return buildObject(c, st, p, path, eff, effPath, pl, arr, mir, matSpec, tag, inh, count, mult);
  }
  function checkFile(c, st, p, path) {
    var src = p.src;
    if (typeof src !== 'string' || !src) { c.err(path + '.src', 'is required'); return null; }
    if (!SRC_RE.test(src)) c.err(path + '.src', 'must be meshes/<name>.<glb|stl|obj|ply|3mf>');
    if (st.files && !hasOwn(st.files, src)) c.err(path + '.src', 'no file "' + src + '" in the artifact');
    if (p.unit != null && !hasOwn(UNITS, String(p.unit))) c.err(path + '.unit', 'must be "mm", "cm", "m" or "in"');
    if (p.up != null && ['y', 'z'].indexOf(String(p.up).toLowerCase()) < 0) c.err(path + '.up', 'must be "y" or "z"');
    var fit = p.fit != null ? c.vec(p.fit, path + '.fit', 3, { gt: 0 }) : null;
    return { src: src, fit: fit };
  }
  function buildObject(c, st, p, path, eff, effPath, pl, arr, mir, matSpec, tag, inh, count, mult) {
    var THREE = T(), ek = eff.kind, obj, geo = null, mats = arr ? arrayMats(THREE, arr) : null;
    var Tm = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(pl.at),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(pl.rot[0] * DEG, pl.rot[1] * DEG, pl.rot[2] * DEG, 'ZYX')),
      new THREE.Vector3().fromArray(pl.scale));
    var Ti = Tm.clone().invert();
    var inst = mats ? mats.map(function (A) { return new THREE.Matrix4().multiplyMatrices(Ti, A).multiply(Tm); }) : null;
    var partId = st.viaRef ? inh.refId : p.id;
    var showEdges = p.edges != null ? bool(p.edges) : (eff.edges != null ? bool(eff.edges) : ek !== 'file');
    function copies(content) {
      var g = new THREE.Group();
      inst.forEach(function (m, k) {
        var w = k === 0 ? content : content.clone();
        m.decompose(w.position, w.quaternion, w.scale);
        w.userData.index = k;
        g.add(w);
      });
      return g;
    }
    if (ek === 'group') {
      var gid = String(eff.id);
      if (st.groupStack.indexOf(gid) >= 0 || st.groupStack.length > 32) { c.err(path, 'a group cannot contain itself'); return null; }
      var content = new THREE.Group();
      st.groupStack.push(gid);
      var via = eff !== p;
      if (via) { st.viaRef++; st.quiet++; }
      walkList(st, eff.parts, effPath + '.parts', content, { mat: matSpec, tag: tag, mult: mult, refId: st.viaRef ? partId : null });
      if (via) { st.viaRef--; st.quiet--; }
      st.groupStack.pop();
      obj = inst ? copies(content) : content;
    } else if (ek === 'file') {
      var chk = checkFile(c, st, eff, effPath);
      if (c.failed) return null;
      var ent = st.fileEntries[chk.src];
      if (!ent || ent.error) { c.err(effPath + '.src', ent ? ent.error : 'no file "' + chk.src + '" in the artifact'); return null; }
      var ext = extOf(chk.src), dd = fileDefaults(ext);
      var unit = eff.unit != null ? String(eff.unit) : dd.unit, up = eff.up != null ? String(eff.up).toLowerCase() : dd.up;
      var conv = convGroup(THREE, unit, up), body = ent.object.clone();
      conv.add(body);
      var wrap = new THREE.Group(), fitG = new THREE.Group();
      wrap.name = 'file';
      fitG.name = 'file-fit';
      fitG.add(conv);
      wrap.add(fitG);
      if (chk.fit) {
        var fk = unit + up, size = ent.fit[fk];
        if (!size) {
          conv.updateMatrixWorld(true);
          var bb = new THREE.Box3().setFromObject(conv);
          size = ent.fit[fk] = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
        }
        var s = Infinity;
        for (var i = 0; i < 3; i++) if (size[i] > 1e-12) s = Math.min(s, chk.fit[i] / size[i]);
        if (isFinite(s)) fitG.scale.setScalar(s);
      }
      var override = p.mat != null || (eff !== p && eff.mat != null) ? getMat(c, st, p.mat != null ? p.mat : eff.mat, path + '.mat') : null;
      wrap.traverse(function (o) {
        if (!o.isMesh) return;
        st.geos.add(o.geometry);
        o.geometry.userData.mkFile = chk.src;
        if (override) o.material = override;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { st.mats.add(m); });
        if (showEdges && p.edges != null) { var eg = edgesFor(st, o.geometry); if (eg) o.add(edgeObject(THREE, eg)); }
      });
      obj = inst ? copies(wrap) : wrap;
    } else {
      var sig = shapeSig(st, eff), hit = sig && geoCache.get(sig);
      if (hit) {
        hit.gen = st.gen; st.stats.cached++; st.geos.add(hit.geo);
        hit.warns.forEach(function (w) { c.warn(w.path, w.msg); });
        geo = hit.geo;
      } else {
        var p0 = st.problems.length;
        var rs = resolveShape(c, eff, effPath);
        if (!rs) return null;
        try { geo = getGeo(st, rs.gk, rs.R); } catch (e) { c.err(effPath, e.message || String(e)); return null; }
        if (sig) geoCache.set(sig, { geo: geo, gen: st.gen, warns: st.problems.slice(p0).map(function (w) { return { path: w.path, msg: w.msg }; }) });
      }
      var mat = getMat(c, st, matSpec, path + '.mat');
      if (inst) {
        obj = new THREE.InstancedMesh(geo, mat, count);
        inst.forEach(function (m, k) { obj.setMatrixAt(k, m); });
        obj.instanceMatrix.needsUpdate = true;
        obj.computeBoundingBox(); obj.computeBoundingSphere();
      } else obj = new THREE.Mesh(geo, mat);
      if (showEdges) {
        var e = edgesFor(st, geo);
        if (e && inst) {
          var ep = e.attributes.position;
          if (ep.count * count <= EDGE_VERT_BUDGET) {
            var arrv = new Float32Array(ep.count * 3 * count), v = new THREE.Vector3(), o = 0;
            inst.forEach(function (m) {
              for (var j = 0; j < ep.count; j++) { v.fromBufferAttribute(ep, j).applyMatrix4(m); arrv[o++] = v.x; arrv[o++] = v.y; arrv[o++] = v.z; }
            });
            var me = new THREE.BufferGeometry();
            me.setAttribute('position', new THREE.BufferAttribute(arrv, 3));
            st.geos.add(me);
            obj.add(edgeObject(THREE, me));
          }
        } else if (e) obj.add(edgeObject(THREE, e));
      }
    }
    obj.name = String(p.name != null ? p.name : p.id);
    placeObject(obj, pl);
    obj.userData.partId = partId;
    obj.userData.part = !st.viaRef;
    obj.userData.kind = p.kind;
    obj.userData.tag = tag != null ? String(tag) : null;
    if (inst) obj.userData.count = count;
    if (bool(p.hidden)) obj.visible = false;
    if (!st.viaRef) {
      st.byId[p.id] = obj;
      st.stats.parts++;
      if (arr) st.stats.instances += count * inh.mult;
      st.records.push({ id: String(p.id), name: obj.name, kind: p.kind, gkind: ek, mat: matSpec != null ? (typeof matSpec === 'string' ? matSpec : 'custom') : null, tag: obj.userData.tag, count: mult, obj: obj, hidden: !obj.visible || !!inh.hidden });
    }
    var out = [obj];
    if (mir) {
      var mc = mirrorObject(st, obj, mir);
      mc.name = obj.name + ' (mirror)';
      out.push(mc);
    }
    if (ek === 'group' && !obj.visible) st.records.forEach(function (r) { if (isDescendant(r.obj, obj)) r.hidden = true; });
    return out;
  }
  function isDescendant(o, anc) { for (var x = o.parent; x; x = x.parent) if (x === anc) return true; return false; }
  function getMat(c, st, spec, path) {
    var m;
    try { m = material(spec, st.model); } catch (e) { c.warn(path, e.message); m = material(null); }
    st.mats.add(m);
    return m;
  }

  // ---------------------------------------------------------------- validate
  function validate(model, files) {
    if (!isObj(model)) return [{ path: '', msg: 'model.json must be a JSON object' }];
    var st = newState(model, null, 'validate');
    if (files) st.files = Array.isArray(files) ? files.reduce(function (o, k) { o[k] = 1; return o; }, {}) : files;
    var P = st.problems;
    try { if (JSON.stringify(model).length > LIMITS.json) P.push({ path: '', msg: 'model.json is larger than 1 MB' }); } catch (e) { P.push({ path: '', msg: 'model.json cannot be serialised' }); }
    if (model.title != null && typeof model.title !== 'string') P.push({ path: 'title', msg: 'must be text' });
    if (model.units != null && model.units !== 'mm') P.push({ path: 'units', msg: 'only "mm" is supported' });
    if (model.materials != null) {
      if (!isObj(model.materials)) P.push({ path: 'materials', msg: 'must be an object of name: material' });
      else Object.keys(model.materials).forEach(function (n) {
        try { normMat(matDef(n, model).def); } catch (e) { P.push({ path: 'materials.' + n, msg: e.message }); }
      });
    }
    if (model.parts == null) P.push({ path: 'parts', msg: 'is required (a list of parts)' });
    else if (!Array.isArray(model.parts)) P.push({ path: 'parts', msg: 'must be a list of parts' });
    if (st.total > LIMITS.parts) P.push({ path: 'parts', msg: 'more than ' + LIMITS.parts + ' parts (' + st.total + ')' });
    var saved = LIMITS.parts;
    LIMITS.parts = Infinity;
    try { walkList(st, model.parts, 'parts', null, { mat: null, tag: null, mult: 1 }); } finally { LIMITS.parts = saved; }
    var c = new Ctx(st, null);
    if (model.dims != null) {
      if (c.list(model.dims, 'dims', 0)) model.dims.forEach(function (d, i) {
        var dp = 'dims[' + i + ']';
        if (!isObj(d)) { c.err(dp, 'a dimension is {"from", "to", "offset"} or {"part", "axis"}'); return; }
        if (d.part != null) {
          if (!hasOwn(st.idx, String(d.part))) c.err(dp + '.part', 'no part with id "' + d.part + '"');
          if (['x', 'y', 'z'].indexOf(String(d.axis)) < 0) c.err(dp + '.axis', 'must be "x", "y" or "z"');
        } else {
          c.vec(d.from, dp + '.from', 3, { pad: 0 });
          c.vec(d.to, dp + '.to', 3, { pad: 0 });
        }
        if (d.offset != null) c.num(d.offset, dp + '.offset');
        if (d.text != null && typeof d.text !== 'string') c.err(dp + '.text', 'must be text');
      });
    }
    if (model.views != null) {
      if (c.list(model.views, 'views', 0)) model.views.forEach(function (v, i) {
        var vp = 'views[' + i + ']';
        if (!isObj(v)) { c.err(vp, 'a view is {"id", "name", "cam", "target"}'); return; }
        c.vec(v.cam, vp + '.cam', 3);
        c.vec(v.target, vp + '.target', 3, { pad: 0, def: [0, 0, 0] });
      });
    }
    return P;
  }

  // ---------------------------------------------------------------- build
  function collectFileSrcs(list, out) {
    if (!Array.isArray(list)) return out;
    list.forEach(function (p) {
      if (!isObj(p)) return;
      if (p.kind === 'file' && typeof p.src === 'string') out[p.src] = 1;
      if (p.kind === 'group') collectFileSrcs(p.parts, out);
    });
    return out;
  }
  function loadFiles(st, files) {
    var srcs = Object.keys(collectFileSrcs(st.model && st.model.parts, {}));
    return Promise.all(srcs.map(function (src) {
      if (!files || !hasOwn(files, src)) return null;
      var data = files[src], ent = fileCache.get(src);
      if (!ent || ent.data !== data) {
        ent = { data: data, object: null, error: null, fit: {} };
        ent.promise = parseFileData(extOf(src), data).then(function (o) { ent.object = o; }, function (e) { ent.error = (e && e.message) || String(e); });
        fileCache.set(src, ent);
      }
      st.fileEntries[src] = ent;
      return ent.promise;
    }));
  }
  function build(model, opts) {
    opts = opts || {};
    var t0 = now();
    var st = newState(isObj(model) ? model : {}, opts.values, 'build');
    st.files = opts.files || {};
    if (!isObj(model)) st.problems.push({ part: null, path: '', msg: 'model.json must be a JSON object' });
    return loadFiles(st, st.files).then(function () {
      var THREE = T();
      gen++;
      st.gen = gen;
      var rootObj = new THREE.Group();
      rootObj.name = isObj(model) && typeof model.title === 'string' ? model.title : 'model';
      rootObj.userData.modelRoot = true;
      if (isObj(model) && model.parts != null && !Array.isArray(model.parts)) st.problems.push({ part: null, path: 'parts', msg: 'must be a list of parts' });
      else walkList(st, model && model.parts, 'parts', rootObj, { mat: null, tag: null, mult: 1 });
      rootObj.updateMatrixWorld(true);
      var info = sceneInfo(rootObj);
      st.stats.triangles = info.triangles;
      st.stats.bbox = info.bbox;
      st.stats.ms = now() - t0;
      // bookkeeping for dispose and cache eviction
      latestGeos = st.geos; latestMats = st.mats;
      geoCache.forEach(function (e, k) { if (e.gen < gen - 2) geoCache.delete(k); });
      var built = { root: rootObj, byId: st.byId, problems: st.problems, stats: st.stats, params: st.defs, values: st.values, _records: st.records, _geos: st.geos, _mats: st.mats };
      lastBuilt = built;
      return built;
    });
  }
  // world-relative matrices of every visible mesh under root (instances expanded)
  function meshItems(rootObj, opts) {
    var THREE = T();
    opts = opts || {};
    rootObj.updateMatrixWorld(true);
    var inv = rootObj.matrixWorld.clone().invert(), out = [], t = new THREE.Matrix4();
    (function walk(o, part) {
      if (!o.visible && !opts.hidden) return;
      if (o.userData && (o.userData.edges || o.userData.noExport)) return;
      if (o.userData && o.userData.partId != null && (o.userData.part || o.userData.mirrorOf)) part = o;
      if (o.isMesh && o.geometry && o.geometry.attributes.position) {
        var base = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        var name = part ? part.name : (o.name || 'mesh');
        if (o.isInstancedMesh) {
          for (var k = 0; k < o.count; k++) {
            o.getMatrixAt(k, t);
            out.push({ mesh: o, geometry: o.geometry, material: o.material, matrix: base.clone().multiply(t), name: name + ' #' + (k + 1), partId: part ? part.userData.partId : null, index: k });
          }
        } else {
          out.push({ mesh: o, geometry: o.geometry, material: o.material, matrix: base, name: name, partId: part ? part.userData.partId : null, index: null });
        }
      }
      o.children.forEach(function (ch) { walk(ch, part); });
    })(rootObj, null);
    return out;
  }
  // every column of the 3x3 part has one non-zero entry (a permutation with scales)
  function axisAligned(m) {
    var e = m.elements;
    for (var c = 0; c < 3; c++) {
      var nz = 0;
      for (var r = 0; r < 3; r++) if (Math.abs(e[c * 4 + r]) > 1e-12 * (Math.abs(e[c * 4]) + Math.abs(e[c * 4 + 1]) + Math.abs(e[c * 4 + 2]))) nz++;
      if (nz !== 1) return false;
    }
    return true;
  }
  function sceneInfo(rootObj) {
    var THREE = T(), items = meshItems(rootObj), box = new THREE.Box3(), v = new THREE.Vector3(), tris = 0, tb = new THREE.Box3();
    items.forEach(function (it) {
      var g = it.geometry, pos = g.attributes.position;
      tris += triCount(g);
      if (axisAligned(it.matrix) || pos.count > 20000) {
        // exact when the matrix keeps the axes aligned; a bound otherwise (very large meshes only)
        if (!g.boundingBox) g.computeBoundingBox();
        box.union(tb.copy(g.boundingBox).applyMatrix4(it.matrix));
      } else {
        for (var i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(it.matrix));
      }
    });
    return { triangles: tris, bbox: box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() } };
  }

  // ---------------------------------------------------------------- dispose
  function dispose(built) {
    if (!built || !built._geos) return;
    var all = built === lastBuilt, keepG = all ? new Set() : latestGeos, keepM = all ? new Set() : latestMats;
    var gone = new Set();
    built._geos.forEach(function (g) {
      if (keepG.has(g)) return;
      g.dispose();
      gone.add(g);
      var f = g.userData && g.userData.mkFile;
      if (f && fileCache.has(f)) fileCache.delete(f);
    });
    if (gone.size) geoCache.forEach(function (e, k) { if (gone.has(e.geo)) geoCache.delete(k); });
    built._mats.forEach(function (m) {
      if (keepM.has(m) || m === defaultFileMat) return;
      m.dispose();
      var k = m.userData && m.userData.mkKey;
      if (k && matCache.get(k) === m) matCache.delete(k);
    });
    if (all) { lastBuilt = null; latestGeos = new Set(); latestMats = new Set(); }
    built._geos = new Set(); built._mats = new Set();
  }

  // ---------------------------------------------------------------- exports
  function exportScene(rootObj, C) {
    var THREE = T(), scene = new THREE.Scene();
    scene.name = rootObj.name || 'model';
    meshItems(rootObj).forEach(function (it) {
      var m = new THREE.Mesh(it.geometry, it.material);
      m.name = it.name;
      m.matrixAutoUpdate = false;
      m.matrix.copy(C ? new THREE.Matrix4().multiplyMatrices(C, it.matrix) : it.matrix);
      if (it.partId != null) m.userData = it.index != null ? { partId: it.partId, index: it.index } : { partId: it.partId };
      scene.add(m);
    });
    scene.updateMatrixWorld(true);
    return scene;
  }
  function exportGLB(rootObj) {
    var THREE = T();
    var C = new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(new THREE.Matrix4().makeScale(0.001, 0.001, 0.001));
    var scene = exportScene(rootObj, C);
    return new THREE.GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true }).then(function (ab) { return new Uint8Array(ab); });
  }
  function exportSTL(rootObj) {
    var THREE = T(), items = meshItems(rootObj), n = 0;
    items.forEach(function (it) { n += triCount(it.geometry); });
    var buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf), hdr = 'hermes-artifacts model, mm, Z up';
    for (var i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i));
    dv.setUint32(80, n, true);
    var o = 84, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    items.forEach(function (it) {
      var pos = it.geometry.attributes.position, m = it.matrix, flip = m.determinant() < 0;
      forTris(it.geometry, function (i0, i1, i2) {
        a.fromBufferAttribute(pos, i0).applyMatrix4(m);
        b.fromBufferAttribute(pos, flip ? i2 : i1).applyMatrix4(m);
        c.fromBufferAttribute(pos, flip ? i1 : i2).applyMatrix4(m);
        e1.subVectors(b, a).cross(e2.subVectors(c, a)).normalize();
        [e1, a, b, c].forEach(function (v) { dv.setFloat32(o, v.x || 0, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; });
        dv.setUint16(o, 0, true); o += 2;
      });
    });
    return new Uint8Array(buf);
  }
  function exportOBJ(rootObj) {
    return new (T().OBJExporter)().parse(exportScene(rootObj, null));
  }
  // binary little-endian PLY (positions, normals, triangles); mm, Z up. Written here because three's
  // PLYExporter hands its result over on the next animation frame.
  function exportPLY(rootObj) {
    var THREE = T(), items = meshItems(rootObj), nv = 0, nf = 0;
    items.forEach(function (it) { nv += it.geometry.attributes.position.count; nf += triCount(it.geometry); });
    var head = 'ply\nformat binary_little_endian 1.0\ncomment hermes-artifacts model, mm, Z up\nelement vertex ' + nv +
      '\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face ' + nf +
      '\nproperty list uchar int vertex_indices\nend_header\n';
    var hb = new TextEncoder().encode(head), buf = new ArrayBuffer(hb.length + nv * 24 + nf * 13), dv = new DataView(buf);
    new Uint8Array(buf).set(hb, 0);
    var o = hb.length, base = 0, v = new THREE.Vector3(), nm = new THREE.Matrix3();
    items.forEach(function (it) {
      var pos = it.geometry.attributes.position, nor = it.geometry.attributes.normal;
      nm.getNormalMatrix(it.matrix);
      for (var i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(it.matrix);
        dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true);
        if (nor) v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); else v.set(0, 0, 0);
        dv.setFloat32(o + 12, v.x, true); dv.setFloat32(o + 16, v.y, true); dv.setFloat32(o + 20, v.z, true);
        o += 24;
      }
      it.pBase = base;
      base += pos.count;
    });
    items.forEach(function (it) {
      var flip = it.matrix.determinant() < 0, b = it.pBase;
      forTris(it.geometry, function (a, c, d) {
        dv.setUint8(o, 3);
        dv.setInt32(o + 1, b + a, true); dv.setInt32(o + 5, b + (flip ? d : c), true); dv.setInt32(o + 9, b + (flip ? c : d), true);
        o += 13;
      });
    });
    return new Uint8Array(buf);
  }
  function importMesh(name, bytes) {
    var ext = extOf(name);
    return parseFileData(ext, bytes).then(function (obj) {
      var THREE = T(), d = fileDefaults(ext), conv = convGroup(THREE, d.unit, d.up);
      conv.add(obj);
      var wrap = new THREE.Group();
      wrap.name = String(name).replace(/^.*[\\/]/, '');
      wrap.add(conv);
      wrap.updateMatrixWorld(true);
      var info = sceneInfo(wrap), out = { object: wrap, triangles: info.triangles, bbox: info.bbox, unit: d.unit, up: d.up };
      if (info.bbox && d.unit === 'mm') {
        var ext3 = Math.max(info.bbox.max[0] - info.bbox.min[0], info.bbox.max[1] - info.bbox.min[1], info.bbox.max[2] - info.bbox.min[2]);
        if (ext3 > 0 && ext3 < 5) out.suggestUnit = 'm';
      }
      return out;
    });
  }

  // ---------------------------------------------------------------- takeoff
  function takeoff(model, built) {
    var THREE = T();
    if (!built || !built._records) return [];
    built.root.updateMatrixWorld(true);
    var inv = built.root.matrixWorld.clone().invert(), t = new THREE.Matrix4();
    return built._records.filter(function (r) { return r.kind !== 'group'; }).map(function (r) {
      var o = r.obj, vol = 0, area = 0, closed = true, box = new THREE.Box3(), v = new THREE.Vector3(), any = false;
      var wm = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), ws = new THREE.Vector3(), wq = new THREE.Quaternion(), wp = new THREE.Vector3();
      wm.decompose(wp, wq, ws);
      var oi = o.matrixWorld.clone().invert(), S = new THREE.Matrix4().makeScale(ws.x, ws.y, ws.z);
      (function walk(x, top) {
        if (x.userData.edges) return;
        if (!top && (x.userData.part || (x.userData.index != null && x.userData.index > 0))) return;
        if (x.isMesh) {
          var rel = new THREE.Matrix4().multiplyMatrices(oi, x.matrixWorld);
          if (x.isInstancedMesh) { x.getMatrixAt(0, t); rel.multiply(t); }
          var full = new THREE.Matrix4().multiplyMatrices(wm, rel), local = new THREE.Matrix4().multiplyMatrices(S, rel);
          var ms = measure(x.geometry, full);
          vol += ms.vol; area += ms.area; any = true;
          if (!isClosed(x.geometry)) closed = false;
          var pos = x.geometry.attributes.position;
          for (var i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(local));
        }
        x.children.forEach(function (ch) { walk(ch, false); });
      })(o, true);
      var volume = any && closed ? Math.abs(vol) : null;
      return {
        id: r.id, name: r.name, kind: r.kind, mat: r.mat, tag: r.tag, count: r.count, hidden: r.hidden,
        volume: volume, area: any ? area : null,
        size: box.isEmpty() ? [0, 0, 0] : [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z],
        volumeTotal: volume == null ? null : volume * r.count, areaTotal: any ? area * r.count : null
      };
    });
  }

  function profile(spec, values) {
    var st = { problems: [], look: lookupFrom(values || {}), quiet: 0 };
    var c = new Ctx(st, null), pts = resolveProfile(c, spec, 'profile');
    if (!pts) throw new Error(st.problems.length ? st.problems[0].path + ': ' + st.problems[0].msg : 'invalid profile');
    return shapeOf(T(), pts);
  }

  var api = {
    version: 1,
    KINDS: KINDS.slice(), PRESETS: PRESETS, LIMITS: LIMITS, EDGE_ANGLE: EDGE_ANGLE,
    evalExpr: evalExpr, exprNames: exprNames, params: function (model, values) { return params(model, values); },
    validate: validate, build: build, material: function (spec, model) { return material(spec, model); },
    edgeMaterial: edgeMaterial, profile: profile, profilePoints: function (spec, values) {
      var st = { problems: [], look: lookupFrom(values || {}), quiet: 0 }, pts = resolveProfile(new Ctx(st, null), spec, 'profile');
      if (!pts) throw new Error(st.problems.length ? st.problems[0].path + ': ' + st.problems[0].msg : 'invalid profile');
      return pts;
    },
    exportGLB: exportGLB, exportSTL: exportSTL, exportOBJ: exportOBJ, exportPLY: exportPLY,
    importMesh: importMesh, takeoff: takeoff, dispose: dispose, meshItems: meshItems
  };
  if (root) root.modelKit = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
