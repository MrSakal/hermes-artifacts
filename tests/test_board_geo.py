"""The board geometry module (types/board/geo.js), run under node: measure, shapes, routing, pen,
hit tests, snapping, alignment and the layout checks."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEO = ROOT / "plugin" / "hermes_artifacts" / "types" / "board" / "geo.js"
NODE = shutil.which("node")

SCRIPT = r"""
const G = require(process.argv[2]);
const out = {};
let cur = null;
function group(name, fn) {
  cur = { n: 0, fails: [] };
  out[name] = cur;
  try { fn(); } catch (e) { cur.fails.push('THROW ' + (e && e.stack || e)); }
}
function ok(cond, msg) { cur.n++; if (!cond) cur.fails.push(typeof msg === 'function' ? msg() : msg); }
function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.011 : tol); }
function eq(got, want, msg) { ok(JSON.stringify(got) === JSON.stringify(want), () => msg + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }

// ---- an independent SVG path reader (M L C Q Z, absolute)
function parsePath(d) {
  if (!/^[MLCQZ0-9eE.\- ]+$/.test(d)) throw new Error('bad characters in path: ' + d);
  const toks = d.match(/[MLCQZ]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const subs = [];
  let sub = null, i = 0;
  const need = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };
  while (i < toks.length) {
    const c = toks[i++];
    if (!(c in need)) throw new Error('number without a command at ' + i + ' in ' + d);
    const a = [];
    for (let k = 0; k < need[c]; k++) {
      const v = Number(toks[i++]);
      if (!isFinite(v)) throw new Error('not a finite number in ' + d);
      a.push(v);
    }
    if (c === 'M') { sub = { cmds: [], closed: false }; subs.push(sub); }
    if (!sub) throw new Error('path does not start with M: ' + d);
    if (c === 'Z') sub.closed = true; else sub.cmds.push([c].concat(a));
  }
  return subs;
}
function sample(sub, steps) {
  const pts = [];
  let x = 0, y = 0;
  steps = steps || 16;
  sub.cmds.forEach((c) => {
    if (c[0] === 'M' || c[0] === 'L') { x = c[1]; y = c[2]; pts.push([x, y]); return; }
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      if (c[0] === 'C') pts.push([u * u * u * x + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5], u * u * u * y + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]]);
      else pts.push([u * u * x + 2 * u * t * c[1] + t * t * c[3], u * u * y + 2 * u * t * c[2] + t * t * c[4]]);
    }
    x = c[c.length - 2]; y = c[c.length - 1];
  });
  return pts;
}
function inPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  let t = l ? ((px - a[0]) * dx + (py - a[1]) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}
function onPath(pts, p, tol) {
  for (let i = 0; i + 1 < pts.length; i++) if (segDist(p[0], p[1], pts[i], pts[i + 1]) <= (tol || 0.02)) return true;
  return false;
}
const R = (x, y, w, h) => ({ x, y, w: w == null ? 120 : w, h: h == null ? 60 : h });

group('consts', () => {
  eq(G.SIZES, { small: 14, body: 16, large: 28, title: 48, huge: 96 }, 'SIZES');
  eq(G.KINDS, ['rect', 'rounded', 'ellipse', 'diamond', 'pill', 'hexagon', 'parallelogram', 'database', 'queue', 'document', 'cloud', 'person'], 'KINDS');
});

group('measure', () => {
  eq(G.measure('hello', 16), { w: 44, h: 22.4, lines: ['hello'] }, 'plain');
  eq(G.measure('hello', 16, 0, true), { w: 48, h: 22.4, lines: ['hello'] }, 'bold');
  eq(G.measure('hello', 'large').h, 39.2, 'size by name');
  eq(G.measure('hello').w, 44, 'default size is body');
  eq(G.measure('a\nbb', 16), { w: 17.6, h: 44.8, lines: ['a', 'bb'] }, 'newline');
  eq(G.measure('a\n\nb', 10).lines, ['a', '', 'b'], 'empty line kept');
  eq(G.measure('aaa bbb ccc', 10, 40), { w: 38.5, h: 28, lines: ['aaa bbb', 'ccc'] }, 'wrap on spaces');
  eq(G.measure('aaa bbb ccc', 10, 38.5).lines, ['aaa bbb', 'ccc'], 'wrap at the exact width');
  eq(G.measure('abcdefghij', 10, 22).lines, ['abcd', 'efgh', 'ij'], 'a long word is broken');
  eq(G.measure('xx abcdefghij y', 10, 22).lines, ['xx', 'abcd', 'efgh', 'ij y'], 'a long word among short ones');
  eq(G.measure('one two\nthree four five', 10, 44).lines, ['one two', 'three', 'four', 'five'], 'wrap and newline');
  eq(G.measure('**bold** *it* `code` [label](https://x.y/z?a=(1))', 10).lines, ['bold it code label'], 'marks are not measured');
  eq(G.measure('2 * 3 * 4', 10).lines, ['2 * 3 * 4'], 'lone stars stay');
  eq(G.measure('- item', 10).w, 33, 'a list prefix counts');
  eq(G.measure('1. item', 10).w, 38.5, 'a numbered prefix counts');
  eq(G.measure('', 16), { w: 0, h: 22.4, lines: [''] }, 'empty');
  eq(G.measure(null, 16).lines, [''], 'null');
  eq(G.measure('a  b', 10, 100).lines, ['a  b'], 'a line that fits is kept as it is');
  eq(G.stripMarks('see [the docs](http://a.b) and `x`'), 'see the docs and x', 'stripMarks');
});

const RATIOS = [[180, 60], [120, 120], [90, 150], [260, 80], [60, 40], [400, 300], [33.5, 71.25]];
const outlines = {};
group('shapePath', () => {
  G.KINDS.concat(['nonsense']).forEach((k) => RATIOS.forEach(([w, h]) => {
    const d = G.shapePath(k, w, h), tag = k + ' ' + w + 'x' + h;
    let subs;
    try { subs = parsePath(d); } catch (e) { ok(false, tag + ': ' + e.message); return; }
    ok(/^M/.test(d) && /Z$/.test(d), tag + ': not M…Z');
    ok(subs.length >= 1 && subs.every((s) => s.closed && s.cmds.length >= 3), tag + ': a subpath is open or empty');
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    subs.forEach((s) => sample(s, 24).forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }));
    ok(x0 >= -0.05 && y0 >= -0.05 && x1 <= w + 0.05 && y1 <= h + 0.05, () => tag + ': leaves the box ' + [x0, y0, x1, y1]);
    ok(x0 <= 0.3 && y0 <= 0.3 && x1 >= w - 0.3 && y1 >= h - 0.3, () => tag + ': does not fill the box ' + [x0, y0, x1, y1]);
    ok(subs.every((s) => s.cmds[0][0] === 'M'), tag + ': subpath without M');
    outlines[tag] = subs;
  }));
  eq(G.shapePath('rect', 100, 50), 'M0 0 L100 0 L100 50 L0 50 Z', 'rect');
  eq(G.shapePath('diamond', 100, 50), 'M50 0 L100 25 L50 50 L0 25 Z', 'diamond');
  eq(G.shapePath('nonsense', 100, 50), G.shapePath('rounded', 100, 50), 'unknown kind is rounded');
  ok(parsePath(G.shapePath('database', 120, 100)).length === 2, 'database has its rim');
  ok(parsePath(G.shapePath('queue', 120, 100)).length === 2, 'queue has its rim');
  ok(parsePath(G.shapePath('person', 120, 100)).length === 2, 'person has head and shoulders');
  // the rounded corner is 10
  const rr = parsePath(G.shapePath('rounded', 200, 100))[0].cmds;
  ok(rr[0][1] === 10 && rr[0][2] === 0, 'rounded radius 10');
  // the cloud is symmetric left to right
  const cl = sample(parsePath(G.shapePath('cloud', 200, 100))[0], 24);
  ok(cl.every((p) => inPoly(cl, 200 - p[0] + (p[0] < 100 ? -0.6 : 0.6), p[1]) || Math.min.apply(null, cl.map((q) => Math.hypot(q[0] - (200 - p[0]), q[1] - p[1]))) < 1.5), 'cloud is lopsided');
});

group('shapeInset', () => {
  G.KINDS.forEach((k) => RATIOS.forEach(([w, h]) => {
    const b = G.shapeInset(k, w, h), tag = k + ' ' + w + 'x' + h, subs = outlines[tag];
    ok(['x', 'y', 'w', 'h'].every((f) => typeof b[f] === 'number' && isFinite(b[f])), tag + ': not numbers');
    ok(b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0 && b.x + b.w <= w + 0.01 && b.y + b.h <= h + 0.01, () => tag + ': outside the box ' + JSON.stringify(b));
    if (!subs) return;
    const poly = sample(subs[0], 24);
    [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h], [b.x + b.w / 2, b.y], [b.x + b.w / 2, b.y + b.h], [b.x, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2]].forEach((p) => {
      ok(inPoly(poly, p[0], p[1]), () => tag + ': inset point ' + p + ' is outside the shape ' + JSON.stringify(b));
    });
    if (k === 'database') { const rim = sample(subs[1], 24); ok(b.y >= Math.max.apply(null, rim.map((p) => p[1])), tag + ': text over the rim'); }
    if (k === 'queue') { const rim = sample(subs[1], 24); ok(b.x >= Math.max.apply(null, rim.map((p) => p[0])), tag + ': text over the rim'); }
    if (k === 'person') { const head = sample(subs[1], 24); ok(b.y >= Math.max.apply(null, head.map((p) => p[1])), tag + ': text over the head'); }
    if (w >= 120 && h >= 60) ok(b.w >= w * 0.45 && b.h >= h * 0.3, () => tag + ': inset is too small ' + JSON.stringify(b));
  }));
  eq(G.shapeInset('rect', 180, 60), { x: 16, y: 15, w: 148, h: 30 }, 'rect pads 16, a quarter when the box is low');
  eq(G.shapeInset('rounded', 200, 100), { x: 16, y: 16, w: 168, h: 68 }, 'rounded pads 16');
  const e = G.shapeEdge('ellipse', 200, 100, 'right', 25);
  ok(near(Math.pow((e.x - 100) / 100, 2) + Math.pow((e.y - 50) / 50, 2), 1, 0.02) && e.x > 100, 'shapeEdge on an ellipse');
  eq(G.shapeEdge('diamond', 100, 60, 'top'), { x: 50, y: 0 }, 'shapeEdge at a side middle');
  ok(near(G.shapeEdge('parallelogram', 100, 50, 'left').x, 10, 0.01), 'shapeEdge on a slanted side');
});

group('bounds', () => {
  eq(G.bounds({ type: 'box', x: 10, y: 20, w: 180, h: 60 }), { x: 10, y: 20, w: 180, h: 60 }, 'box');
  eq(G.bounds({ type: 'section', x: -5, y: 0, w: 400, h: 300 }), { x: -5, y: 0, w: 400, h: 300 }, 'section');
  eq(G.bounds({ type: 'text', x: 1, y: 2, text: 'hello\nyou', size: 'body' }), { x: 1, y: 2, w: 44, h: 44.8 }, 'text, one line per newline');
  eq(G.bounds({ type: 'text', x: 0, y: 0, text: 'aaa bbb ccc', size: 10, w: 40 }), { x: 0, y: 0, w: 40, h: 28 }, 'text wraps at w');
  eq(G.bounds({ type: 'pen', x: 100, y: 100, points: [0, 0, 30, -10, 20, 40] }), { x: 100, y: 90, w: 30, h: 50 }, 'pen');
  eq(G.bounds({ type: 'table', x: 5, y: 5, rows: [['Plan', 'Price'], ['Pro', '$20']] }), { x: 5, y: 5, w: 160, h: 76.8 }, 'table');
  const items = [{ id: 'a', type: 'box', x: 0, y: 0, w: 120, h: 60 }, { id: 'b', type: 'box', x: 300, y: 200, w: 120, h: 60 }, { id: 'ar', type: 'arrow', from: 'a', to: 'b' }];
  const byId = {}; items.forEach((i) => { byId[i.id] = i; });
  eq(G.bounds(items[2], byId), { x: 120, y: 30, w: 180, h: 200 }, 'arrow: its route box');
  eq(G.bounds(items[2], items), { x: 120, y: 30, w: 180, h: 200 }, 'arrow: items as an array');
  eq(G.bounds(items[2], new Map(items.map((i) => [i.id, i]))), { x: 120, y: 30, w: 180, h: 200 }, 'arrow: items as a Map');
  eq(G.bounds({ type: 'arrow', from: [0, 0], to: [100, 0] }), { x: 0, y: 0, w: 100, h: 0 }, 'arrow between points');
  eq(G.bounds({ type: 'arrow', from: 'a', to: 'gone' }, byId), { x: 0, y: 0, w: 0, h: 0 }, 'arrow with a lost end');
  const b = G.bounds({ type: 'box', x: 0, y: 0, text: 'word '.repeat(30) });
  ok(b.w === 180 && b.h > 60, 'a box with no size grows to its text');
  const rt = G.arrowRoute(items[2], byId);
  ok(rt && rt.fromSide === 'right' && rt.toSide === 'left', 'arrowRoute');
  ok(G.arrowRoute({ type: 'arrow', from: 'a', to: 'ar' }, byId) === null, 'an arrow cannot end on an arrow');
});

group('tableLayout', () => {
  eq(G.tableLayout({ rows: [['Plan', 'Price'], ['Pro', '$20']] }), { colw: [80, 80], rowh: [38.4, 38.4], w: 160, h: 76.8 }, 'small table');
  eq(G.tableLayout({ rows: [['A long header text'], ['x']] }).colw, [192.8], 'header measured bold');
  eq(G.tableLayout({ rows: [['h'], ['a body cell of text']] }).colw, [187.2], 'body measured plain');
  eq(G.tableLayout({ rows: [['h', 'k'], ['aaaa bbbb cccc dddd', 'x']], colw: [100, 90] }), { colw: [100, 90], rowh: [38.4, 60.8], w: 190, h: 99.2 }, 'given widths wrap the cells');
  eq(G.tableLayout({ rows: [['a'], ['b', 'c', 'd']] }).colw.length, 3, 'ragged rows');
  eq(G.tableLayout({ rows: [] }), { colw: [], rowh: [], w: 0, h: 0 }, 'empty');
  eq(G.tableLayout({ rows: [['a\nb']] }).rowh, [60.8], 'a newline in a cell');
});

group('anchor', () => {
  const r = { x: 10, y: 20, w: 100, h: 60 };
  eq(G.anchor(r, 'top'), { x: 60, y: 20 }, 'top');
  eq(G.anchor(r, 'right'), { x: 110, y: 50 }, 'right');
  eq(G.anchor(r, 'bottom'), { x: 60, y: 80 }, 'bottom');
  eq(G.anchor(r, 'left'), { x: 10, y: 50 }, 'left');
});

// ---- routes
const NORMAL = { right: [1, 0], bottom: [0, 1], left: [-1, 0], top: [0, -1] };
function crossesRect(pts, r, shrink) {
  const x1 = r.x + shrink, y1 = r.y + shrink, x2 = r.x + r.w - shrink, y2 = r.y + r.h - shrink;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a[1] === b[1] && a[1] > y1 && a[1] < y2 && Math.max(a[0], b[0]) > x1 && Math.min(a[0], b[0]) < x2) return true;
    if (a[0] === b[0] && a[0] > x1 && a[0] < x2 && Math.max(a[1], b[1]) > y1 && Math.min(a[1], b[1]) < y2) return true;
  }
  return false;
}
function onSide(p, r, side) {
  if (side === 'left') return near(p[0], r.x) && p[1] >= r.y && p[1] <= r.y + r.h;
  if (side === 'right') return near(p[0], r.x + r.w) && p[1] >= r.y && p[1] <= r.y + r.h;
  if (side === 'top') return near(p[1], r.y) && p[0] >= r.x && p[0] <= r.x + r.w;
  return near(p[1], r.y + r.h) && p[0] >= r.x && p[0] <= r.x + r.w;
}
// Everything that must hold for any route. want: {sides, bends, mid (ends at side middles; default true), stub}
function checkRoute(name, a, b, o, want) {
  want = want || {};
  let r;
  try { r = G.route(a, b, o); } catch (e) { ok(false, name + ': THROW ' + e.stack); return null; }
  const p = r.pts, n = p.length, rad = o && o.r != null ? o.r : 8;
  const say = (m) => () => name + ': ' + m + ' ' + JSON.stringify(p) + ' ' + r.fromSide + '>' + r.toSide;
  ok(n >= 2 && p.every((q) => q.length === 2 && isFinite(q[0]) && isFinite(q[1])), say('bad points'));
  for (let i = 0; i + 1 < n; i++) {
    ok(p[i][0] === p[i + 1][0] || p[i][1] === p[i + 1][1], say('leg ' + i + ' is not orthogonal'));
    ok(n === 2 || Math.abs(p[i][0] - p[i + 1][0]) + Math.abs(p[i][1] - p[i + 1][1]) > 0.01, say('empty leg ' + i));
  }
  for (let i = 1; i + 1 < n; i++) {
    const col = (p[i - 1][0] === p[i][0] && p[i][0] === p[i + 1][0]) || (p[i - 1][1] === p[i][1] && p[i][1] === p[i + 1][1]);
    ok(!col, say('collinear point ' + i + ' left in'));
  }
  if (a.rect && want.cross !== false) ok(!crossesRect(p, a.rect, 0.5), say('crosses the from box'));
  if (b.rect && want.cross !== false) ok(!crossesRect(p, b.rect, 0.5), say('crosses the to box'));
  ok(r.fromSide in NORMAL && r.toSide in NORMAL, say('sides'));
  if (a.rect && !a.kind) {
    const m = G.anchor(a.rect, r.fromSide);
    if (want.mid === false) ok(onSide(p[0], a.rect, r.fromSide), say('start is not on its side'));
    else ok(near(p[0][0], m.x) && near(p[0][1], m.y), say('start is not at the middle of its side'));
  } else if (a.pt) ok(p[0][0] === a.pt[0] && p[0][1] === a.pt[1], say('start is not the point'));
  if (b.rect && !b.kind) {
    const m = G.anchor(b.rect, r.toSide);
    if (want.mid === false) ok(onSide(p[n - 1], b.rect, r.toSide), say('end is not on its side'));
    else ok(near(p[n - 1][0], m.x) && near(p[n - 1][1], m.y), say('end is not at the middle of its side'));
  } else if (b.pt) ok(p[n - 1][0] === b.pt[0] && p[n - 1][1] === b.pt[1], say('end is not the point'));
  // the first leg leaves along its side's normal, the last arrives against it
  const len0 = Math.abs(p[1][0] - p[0][0]) + Math.abs(p[1][1] - p[0][1]), len1 = Math.abs(p[n - 1][0] - p[n - 2][0]) + Math.abs(p[n - 1][1] - p[n - 2][1]);
  if (len0 > 0) {
    const nf = NORMAL[r.fromSide], nt = NORMAL[r.toSide];
    ok(near((p[1][0] - p[0][0]) / len0, nf[0]) && near((p[1][1] - p[0][1]) / len0, nf[1]), say('does not leave square to its side'));
    ok(near((p[n - 2][0] - p[n - 1][0]) / len1, nt[0]) && near((p[n - 2][1] - p[n - 1][1]) / len1, nt[1]), say('does not arrive square to its side'));
  }
  if (want.stub !== false && n > 2) {
    if (a.rect) ok(len0 >= 16 - 0.01, say('start stub ' + len0 + ' < 16'));
    if (b.rect) ok(len1 >= 16 - 0.01, say('end stub ' + len1 + ' < 16'));
  }
  if (want.sides) ok(r.fromSide + '>' + r.toSide === want.sides, say('wanted sides ' + want.sides));
  if (want.bends != null) ok(n - 2 === want.bends && r.bends === want.bends, say('wanted ' + want.bends + ' bends'));
  ((o && o.obstacles) || []).forEach((q, i) => { if (want.free !== false) ok(!crossesRect(p, q, 1), say('crosses obstacle ' + i)); });
  if (o && o.via) {
    let at = 0;
    o.via.forEach((v, i) => {
      let found = -1;
      for (let k = at; k + 1 < n && found < 0; k++) if (segDist(v[0], v[1], p[k], p[k + 1]) <= 0.02) found = k;
      ok(found >= 0, say('misses waypoint ' + i + ' (or out of order)'));
      if (found >= 0) at = found;
    });
  }
  // d against pts
  let subs;
  try { subs = parsePath(r.d); } catch (e) { ok(false, name + ': d ' + e.message); return r; }
  ok(subs.length === 1 && !subs[0].closed, say('d is not one open path'));
  const c = subs[0].cmds, last = c[c.length - 1];
  ok(c[0][0] === 'M' && near(c[0][1], p[0][0]) && near(c[0][2], p[0][1]), say('d does not start at pts[0]: ' + r.d));
  ok(last[0] === 'L' && near(last[1], p[n - 1][0]) && near(last[2], p[n - 1][1]), say('d does not end at the last point: ' + r.d));
  const qs = c.filter((x) => x[0] === 'Q'), ls = c.filter((x) => x[0] === 'L');
  if (rad > 0) {
    ok(qs.length === n - 2, say('d has ' + qs.length + ' corners: ' + r.d));
    qs.forEach((q, i) => {
      const k = p[i + 1];
      ok(near(q[1], k[0]) && near(q[2], k[1]), say('corner ' + i + ' of d is not pts[' + (i + 1) + ']'));
      const la = Math.hypot(k[0] - p[i][0], k[1] - p[i][1]), lb = Math.hypot(p[i + 2][0] - k[0], p[i + 2][1] - k[1]);
      const cut = Math.min(rad, la / 2, lb / 2), before = ls[i];
      ok(near(Math.hypot(q[3] - k[0], q[4] - k[1]), cut, 0.02) && near(Math.hypot(before[1] - k[0], before[2] - k[1]), cut, 0.02), say('corner ' + i + ' radius is not ' + cut + ': ' + r.d));
      ok(onPath(p, [q[3], q[4]], 0.02) && onPath(p, [before[1], before[2]], 0.02), say('corner ' + i + ' leaves the legs'));
    });
  } else ok(qs.length === 0 && ls.length === n - 1, say('r=0 must give plain corners'));
  // len, mid, labelAt
  let len = 0, longest = 0;
  for (let i = 0; i + 1 < n; i++) { const l = Math.abs(p[i + 1][0] - p[i][0]) + Math.abs(p[i + 1][1] - p[i][1]); len += l; longest = Math.max(longest, l); }
  ok(near(r.len, len, 0.02), say('len ' + r.len + ' is not ' + len));
  ok(onPath(p, [r.mid.x, r.mid.y], 0.02), say('mid is off the path'));
  let run = 0, half = false;
  for (let i = 0; i + 1 < n && !half; i++) {
    const l = Math.abs(p[i + 1][0] - p[i][0]) + Math.abs(p[i + 1][1] - p[i][1]);
    if (segDist(r.mid.x, r.mid.y, p[i], p[i + 1]) <= 0.02 && near(run + Math.abs(r.mid.x - p[i][0]) + Math.abs(r.mid.y - p[i][1]), len / 2, 0.03)) half = true;
    run += l;
  }
  ok(half, say('mid is not at half the length'));
  let lab = false;
  for (let i = 0; i + 1 < n; i++) {
    const l = Math.abs(p[i + 1][0] - p[i][0]) + Math.abs(p[i + 1][1] - p[i][1]);
    if (near(l, longest, 0.02) && near(r.labelAt.x, (p[i][0] + p[i + 1][0]) / 2, 0.02) && near(r.labelAt.y, (p[i][1] + p[i + 1][1]) / 2, 0.02)) lab = true;
  }
  ok(lab, say('labelAt is not the middle of the longest leg'));
  return r;
}

const CASES = [
  ['neighbours left to right', { rect: R(20, 40) }, { rect: R(240, 40) }, {}, { sides: 'right>left', bends: 0 }],
  ['neighbours right to left', { rect: R(240, 40) }, { rect: R(20, 40) }, {}, { sides: 'left>right', bends: 0 }],
  ['neighbours close, rows overlap', { rect: R(20, 40) }, { rect: R(170, 60) }, {}, { sides: 'right>left', bends: 0, mid: false }],
  ['a small step far apart', { rect: R(20, 40) }, { rect: R(250, 46) }, {}, { sides: 'right>left', bends: 0, mid: false }],
  ['stacked', { rect: R(60, 10) }, { rect: R(60, 130) }, {}, { sides: 'bottom>top', bends: 0 }],
  ['stacked upwards', { rect: R(60, 130) }, { rect: R(60, 10) }, {}, { sides: 'top>bottom', bends: 0 }],
  ['stacked, offset', { rect: R(20, 10) }, { rect: R(160, 130) }, {}, { sides: 'bottom>top', bends: 2 }],
  ['diagonal, wider gap across', { rect: R(10, 10) }, { rect: R(250, 130) }, {}, { sides: 'right>left', bends: 2 }],
  ['diagonal, wider gap down', { rect: R(10, 10, 100, 40) }, { rect: R(150, 150, 100, 40) }, {}, { sides: 'bottom>top', bends: 2 }],
  ['diagonal up left', { rect: R(300, 200) }, { rect: R(10, 10) }, {}, { sides: 'left>right', bends: 2 }],
  ['overlapping rows, far', { rect: R(20, 30) }, { rect: R(230, 70) }, {}, { sides: 'right>left', bends: 2 }],
  ['loop bottom to bottom', { rect: R(20, 40) }, { rect: R(230, 60) }, { fromSide: 'bottom', toSide: 'bottom' }, { sides: 'bottom>bottom', bends: 2 }],
  ['loop top to top', { rect: R(20, 80) }, { rect: R(230, 100) }, { fromSide: 'top', toSide: 'top' }, { sides: 'top>top', bends: 2 }],
  ['loop right to right', { rect: R(60, 10) }, { rect: R(90, 130) }, { fromSide: 'right', toSide: 'right' }, { sides: 'right>right', bends: 2 }],
  ['loop left to left', { rect: R(60, 10) }, { rect: R(90, 130) }, { fromSide: 'left', toSide: 'left' }, { sides: 'left>left', bends: 2 }],
  ['bottom to bottom, stacked', { rect: R(60, 10, 120, 50) }, { rect: R(60, 110, 120, 50) }, { fromSide: 'bottom', toSide: 'bottom' }, { sides: 'bottom>bottom', bends: 4 }],
  ['right to right, side by side', { rect: R(20, 40) }, { rect: R(240, 40) }, { fromSide: 'right', toSide: 'right' }, { sides: 'right>right', bends: 4 }],
  ['right to top, an L', { rect: R(20, 20) }, { rect: R(220, 130) }, { fromSide: 'right', toSide: 'top' }, { bends: 1 }],
  ['right to top, target behind', { rect: R(200, 20) }, { rect: R(20, 130) }, { fromSide: 'right', toSide: 'top' }, { bends: 3 }],
  ['right to left, target behind', { rect: R(220, 20) }, { rect: R(20, 130) }, { fromSide: 'right', toSide: 'left' }, { bends: 4 }],
  ['top to bottom, target below', { rect: R(20, 20) }, { rect: R(60, 200) }, { fromSide: 'top', toSide: 'bottom' }, {}],
  ['only fromSide', { rect: R(20, 20) }, { rect: R(230, 130) }, { fromSide: 'bottom' }, { sides: 'bottom>left', bends: 1 }],
  ['only toSide', { rect: R(20, 120) }, { rect: R(230, 20) }, { toSide: 'left' }, { sides: 'top>left', bends: 1 }],
  ['point to box', { pt: [20, 150] }, { rect: R(200, 40) }, {}, { sides: 'right>left', bends: 2 }],
  ['point to box, in line with its side', { pt: [20, 85] }, { rect: R(200, 40) }, {}, { sides: 'right>left', bends: 0, mid: false }],
  ['box to point', { rect: R(20, 40) }, { pt: [300, 170] }, {}, { sides: 'right>left', bends: 2 }],
  ['box to point below', { rect: R(20, 40) }, { pt: [60, 300] }, {}, { sides: 'bottom>top', bends: 0, mid: false }],
  ['box to point below and beside', { rect: R(20, 40) }, { pt: [200, 300] }, {}, { sides: 'bottom>top', bends: 2 }],
  ['box to point, sides ignored for the point', { rect: R(20, 40) }, { pt: [300, 170] }, { toSide: 'bottom' }, { sides: 'right>left' }],
  ['point to point, wide', { pt: [20, 30] }, { pt: [320, 150] }, {}, { sides: 'right>left', bends: 2 }],
  ['point to point, tall', { pt: [20, 30] }, { pt: [100, 350] }, {}, { sides: 'bottom>top', bends: 2 }],
  ['point to point, level', { pt: [20, 30] }, { pt: [320, 30] }, {}, { bends: 0 }],
  ['one waypoint', { rect: R(20, 20) }, { rect: R(240, 130) }, { via: [[120, 170]] }, {}],
  ['two waypoints', { rect: R(20, 100) }, { rect: R(260, 100) }, { via: [[170, 30], [220, 190]] }, {}],
  ['waypoint between points', { pt: [0, 0] }, { pt: [200, 100] }, { via: [[50, 80]] }, {}],
  ['waypoint with fixed sides', { rect: R(20, 20) }, { rect: R(300, 200) }, { via: [[200, 60]], fromSide: 'top', toSide: 'bottom' }, { sides: 'top>bottom' }],
  ['obstacle between neighbours', { rect: R(10, 70, 80, 50) }, { rect: R(290, 70, 80, 50) }, { obstacles: [R(150, 50, 80, 90)] }, {}],
  ['obstacle on the elbow', { rect: R(10, 10, 100, 50) }, { rect: R(280, 140, 100, 50) }, { obstacles: [R(170, 20, 50, 150)] }, {}],
  ['obstacle between stacked', { rect: R(130, 5, 100, 40) }, { rect: R(130, 165, 100, 40) }, { obstacles: [R(110, 75, 140, 50)] }, {}],
  ['two obstacles', { rect: R(10, 80, 70, 40) }, { rect: R(310, 80, 70, 40) }, { obstacles: [R(110, 40, 60, 80), R(210, 80, 60, 90)] }, {}],
  ['obstacle with fixed sides', { rect: R(10, 70, 80, 50) }, { rect: R(290, 70, 80, 50) }, { obstacles: [R(150, 50, 80, 90)], fromSide: 'right', toSide: 'left' }, { sides: 'right>left', bends: 4 }],
  ['obstacle out of the way changes nothing', { rect: R(20, 40) }, { rect: R(240, 40) }, { obstacles: [R(100, 200, 80, 50)] }, { sides: 'right>left', bends: 0 }],
  ['the ends themselves given as obstacles', { rect: R(20, 40) }, { rect: R(240, 140) }, { obstacles: [R(20, 40), R(240, 140), R(0, 0, 500, 400)] }, { sides: 'right>left', bends: 2, free: false }],
  ['no rounding', { rect: R(10, 10) }, { rect: R(250, 130) }, { r: 0 }, { bends: 2 }],
  ['big radius is clamped', { rect: R(10, 10) }, { rect: R(180, 40) }, { r: 40 }, { bends: 2 }],
];

group('route', () => {
  const got = {};
  CASES.forEach(([name, a, b, o, want]) => { got[name] = checkRoute(name, a, b, o, want); });
  const g = (n) => got[n] || { pts: [[0, 0]], len: 0 };
  eq(g('neighbours left to right').pts, [[140, 70], [240, 70]], 'the straight line');
  eq(g('neighbours left to right').d, 'M140 70 L240 70', 'its d');
  eq(g('neighbours close, rows overlap').pts, [[140, 80], [170, 80]], 'close neighbours join in the middle of what they share');
  eq(g('diagonal, wider gap across').pts, [[130, 40], [190, 40], [190, 160], [250, 160]], 'the Z turns half way');
  eq(g('diagonal, wider gap across').d, 'M130 40 L182 40 Q190 40 190 48 L190 152 Q190 160 198 160 L250 160', 'its rounded d');
  eq(g('diagonal, wider gap across').labelAt, { x: 190, y: 100 }, 'label on the longest leg');
  eq(g('diagonal, wider gap across').mid, { x: 190, y: 100 }, 'mid');
  eq(g('loop bottom to bottom').pts, [[80, 100], [80, 144], [290, 144], [290, 120]], 'the loop runs 24 under the lower box');
  eq(g('loop top to top').pts, [[80, 80], [80, 56], [290, 56], [290, 100]], 'the loop runs 24 over the higher box');
  eq(g('loop right to right').pts, [[180, 40], [234, 40], [234, 160], [210, 160]], 'the loop runs 24 right of both');
  eq(g('right to top, an L').pts, [[140, 50], [280, 50], [280, 130]], 'the L');
  eq(g('point to box, in line with its side').pts, [[20, 85], [200, 85]], 'a loose end is met where it is');
  eq(g('point to point, wide').pts, [[20, 30], [170, 30], [170, 150], [320, 150]], 'loose ends: along the longer way');
  eq(g('point to point, tall').pts, [[20, 30], [20, 190], [100, 190], [100, 350]], 'loose ends, tall');
  eq(g('no rounding').d, 'M130 40 L190 40 L190 160 L250 160', 'r=0');
  ok(g('obstacle between neighbours').bends <= 2, 'side by side with something between: over or under in one loop');
  ok(g('obstacle between stacked').bends <= 2, 'stacked with something between: round the side in one loop');
  // an obstacle is passed with room to spare
  const ob = g('obstacle with fixed sides').pts;
  ok(!crossesRect(ob, { x: 150 - 15, y: 50 - 15, w: 110, h: 120 }, 0), 'the detour keeps 16 from the obstacle: ' + JSON.stringify(ob));
  // same input, same output
  CASES.forEach(([name, a, b, o]) => {
    ok(JSON.stringify(G.route(a, b, o)) === JSON.stringify(G.route(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(o)))), name + ': not deterministic');
  });
  // the inputs are left alone
  const a = { rect: R(0, 0) }, b = { rect: R(300, 200) }, o = { via: [[200, 20]], obstacles: [R(150, 90, 40, 40)] }, before = JSON.stringify([a, b, o]);
  G.route(a, b, o);
  ok(JSON.stringify([a, b, o]) === before, 'route changes its input');
  // shapes are met at their outline
  const k = G.route({ rect: R(0, 0, 200, 100), kind: 'ellipse' }, { rect: R(230, 20, 200, 100), kind: 'ellipse' }, {});
  ok(k.pts.length === 2 && k.pts[0][1] === k.pts[1][1], 'ellipses: straight');
  ok(near(Math.pow((k.pts[0][0] - 100) / 100, 2) + Math.pow((k.pts[0][1] - 50) / 50, 2), 1, 0.03), 'starts on the ellipse: ' + JSON.stringify(k.pts));
  ok(near(Math.pow((k.pts[1][0] - 330) / 100, 2) + Math.pow((k.pts[1][1] - 70) / 50, 2), 1, 0.03), 'ends on the ellipse: ' + JSON.stringify(k.pts));
  const pg = G.route({ rect: R(0, 0, 100, 50), kind: 'parallelogram' }, { rect: R(300, 0, 100, 50) }, {});
  eq(pg.pts, [[90, 25], [300, 25]], 'a slanted side is met where it is');
  // {x, y} points and odd input
  eq(G.route({ pt: { x: 0, y: 0 } }, { pt: { x: 100, y: 0 } }).pts, [[0, 0], [100, 0]], 'points as {x, y}');
  const same = G.route({ pt: [5, 5] }, { pt: [5, 5] }, {});
  ok(same.len === 0 && same.pts.length >= 1 && /^M5 5/.test(same.d), 'a route of no length');
  ok(G.route({ rect: R(0, 0) }, { rect: R(40, 20) }, {}).pts.length >= 2, 'overlapping boxes still give a line');
});

group('route_fuzz', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const sides = ['top', 'right', 'bottom', 'left'];
  let n = 0;
  for (let i = 0; i < 600; i++) {
    const A = R(Math.round(rnd() * 600), Math.round(rnd() * 400), 60 + Math.round(rnd() * 140), 40 + Math.round(rnd() * 80));
    const B = R(Math.round(rnd() * 600), Math.round(rnd() * 400), 60 + Math.round(rnd() * 140), 40 + Math.round(rnd() * 80));
    const gx = Math.max(B.x - A.x - A.w, A.x - B.x - B.w), gy = Math.max(B.y - A.y - A.h, A.y - B.y - B.h);
    const o = {}, mode = i % 4;
    if (mode === 1 || mode === 3) o.fromSide = sides[Math.floor(rnd() * 4)];
    if (mode === 2 || mode === 3) o.toSide = sides[Math.floor(rnd() * 4)];
    if (Math.max(gx, gy) < 40) continue; // boxes on top of each other or nearly touching have no clean answer
    n++;
    checkRoute('fuzz ' + i + ' ' + JSON.stringify([A, B, o]), { rect: A }, { rect: B }, o, { mid: false, stub: mode !== 0 });
  }
  ok(n > 300, 'too few fuzz cases: ' + n);
});

group('route_speed', () => {
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const boxes = [];
  while (boxes.length < 52) { // a board of 52 blocks that do not touch
    const b = R(Math.round(rnd() * 2400), Math.round(rnd() * 1600), 100 + Math.round(rnd() * 100), 50 + Math.round(rnd() * 50));
    if (!boxes.some((q) => b.x < q.x + q.w + 40 && b.x + b.w + 40 > q.x && b.y < q.y + q.h + 40 && b.y + b.h + 40 > q.y)) boxes.push(b);
  }
  const jobs = [];
  for (let i = 0; i < 500; i++) {
    const a = Math.floor(rnd() * 52);
    let b = Math.floor(rnd() * 52);
    if (b === a) b = (a + 1) % 52;
    jobs.push([{ rect: boxes[a] }, { rect: boxes[b] }, { obstacles: boxes.filter((_, k) => k !== a && k !== b) }]);
  }
  let best = Infinity, first = 0, clean = 0, hitFree = 0;
  for (let round = 0; round < 4; round++) {
    const t = process.hrtime.bigint();
    for (let i = 0; i < jobs.length; i++) G.route(jobs[i][0], jobs[i][1], jobs[i][2]);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    if (round === 0) first = ms;
    best = Math.min(best, ms);
  }
  out.speed_first_ms = Math.round(first * 10) / 10;
  jobs.forEach((j) => {
    const r = G.route(j[0], j[1], j[2]);
    if (!j[2].obstacles.some((q) => crossesRect(r.pts, q, 1))) clean++;
    if (!j[2].obstacles.some((q) => crossesRect(G.route(j[0], j[1], {}).pts, q, 1))) hitFree++;
  });
  out.speed_ms = Math.round(best * 10) / 10;
  out.speed_clean = clean;
  out.speed_clean_without = hitFree;
  ok(jobs[0][2].obstacles.length === 50, 'fifty obstacles each');
  ok(best < 500, '500 routes with 50 obstacles took ' + best.toFixed(1) + ' ms');
  ok(clean >= hitFree && clean >= 490, 'going round obstacles helps: ' + clean + ' clean of 500 (' + hitFree + ' without)');
});

group('headPath', () => {
  const h = parsePath(G.headPath('arrow', [100, 50], [1, 0]));
  ok(h.length === 1 && h[0].closed && h[0].cmds.length === 3, 'arrow: a closed triangle');
  eq(h[0].cmds[0], ['M', 100, 50], 'arrow: starts at the tip');
  ok(h[0].cmds[1][1] === 90 && h[0].cmds[2][1] === 90 && near(h[0].cmds[1][2] + h[0].cmds[2][2], 100), 'arrow: 10 long, symmetric, behind the tip');
  eq(G.headPath('arrow', { x: 100, y: 50 }, 'left'), G.headPath('arrow', [100, 50], [1, 0]), 'a head at a left side points right');
  eq(G.headPath('arrow', [100, 50], 'top'), G.headPath('arrow', [100, 50], [0, 1]), 'a head at a top side points down');
  eq(G.headPath('arrow', [100, 50], 0), G.headPath('arrow', [100, 50], { x: 5, y: 0 }), 'radians and {x, y}');
  const big = parsePath(G.headPath('arrow', [0, 0], [0, -1], 20))[0].cmds;
  ok(big[1][2] === 20 && big[2][2] === 20, 'arrow: size');
  const c = parsePath(G.headPath('circle', [100, 50], [1, 0], 8));
  const pts = sample(c[0], 16);
  ok(c[0].closed && pts.every((p) => near(Math.hypot(p[0] - 96, p[1] - 50), 4, 0.05)), 'circle: radius 4, touching the tip from behind');
  eq(G.headPath('none', [0, 0], [1, 0]), '', 'none');
  eq(G.headPath(undefined, [0, 0], [1, 0]), '', 'no kind');
});

group('penPath', () => {
  eq(G.penPath([0, 0, 10, 10], 5, 5), 'M5 5 L15 15', 'two points: a line');
  eq(G.penPath([], 0, 0), '', 'nothing');
  eq(G.penPath([3, 4], 1, 1), 'M4 5 L4 5', 'one point: a dot');
  const pts = [0, 0, 10, 10, 20, 0, 30, 10];
  const sm = parsePath(G.penPath(pts, 0, 0))[0].cmds;
  ok(sm.length === 4 && sm.slice(1).every((c) => c[0] === 'C'), 'a curve through more points');
  ok(sm.slice(1).every((c, i) => c[5] === pts[2 * i + 2] && c[6] === pts[2 * i + 3]), 'the curve passes through every point');
  // smooth: the tangent is continuous at an inner point
  const a = sm[1], b = sm[2];
  ok(near((a[5] - a[3]) * (b[2] - a[6]) - (a[6] - a[4]) * (b[1] - a[5]), 0, 0.02), 'smooth at inner points');
  // a doubled point: two curves that meet in a corner
  const corner = G.penPath([0, 0, 10, 10, 20, 0, 20, 0, 30, 10, 40, 0], 0, 0);
  eq(corner, G.penPath([0, 0, 10, 10, 20, 0], 0, 0) + G.penPath([20, 0, 30, 10, 40, 0], 0, 0).replace(/^M\S+ \S+/, ''), 'a doubled point is a corner');
  const cc = parsePath(corner)[0].cmds;
  ok(!near((cc[2][5] - cc[2][3]) * (cc[3][2] - cc[2][6]) - (cc[2][6] - cc[2][4]) * (cc[3][1] - cc[2][5]), 0, 0.5), 'the corner is sharp');
  eq(G.penPath([0, 0, 0, 0, 10, 0, 10, 0], 0, 0), 'M0 0 L10 0', 'doubled ends');
  ok(parsePath(G.penPath(pts, 100, 200))[0].cmds[0][1] === 100, 'offset');
});

group('simplify', () => {
  eq(G.simplify([0, 0, 5, 0.2, 10, 0, 20, 0.1, 30, 0], 1), [0, 0, 30, 0], 'a nearly straight line');
  eq(G.simplify([0, 0, 10, 0, 20, 0, 20, 10, 20, 20], 1), [0, 0, 20, 0, 20, 20], 'a corner stays');
  eq(G.simplify([0, 0, 10, 3, 20, 0], 5), [0, 0, 20, 0], 'within tolerance');
  eq(G.simplify([0, 0, 10, 3, 20, 0], 2), [0, 0, 10, 3, 20, 0], 'beyond tolerance');
  eq(G.simplify([0, 0, 1, 1], 5), [0, 0, 1, 1], 'two points');
  eq(G.simplify([], 5), [], 'none');
  const big = [];
  for (let i = 0; i < 2000; i++) big.push(i, Math.sin(i / 40) * 50);
  const s = G.simplify(big, 1.5);
  ok(s.length < big.length / 4 && s.length % 2 === 0 && s[0] === 0 && s[s.length - 2] === 1999, 'a long stroke shrinks, ends kept: ' + s.length);
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    let d = Infinity;
    for (let k = 0; k + 3 < s.length; k += 2) d = Math.min(d, segDist(big[2 * i], big[2 * i + 1], [s[k], s[k + 1]], [s[k + 2], s[k + 3]]));
    worst = Math.max(worst, d);
  }
  ok(worst <= 1.5 + 1e-9, 'no point further than the tolerance: ' + worst);
});

const BOARD = [
  { id: 'a', type: 'box', x: 0, y: 0, w: 120, h: 60 },
  { id: 'b', type: 'box', x: 300, y: 200, w: 120, h: 60 },
  { id: 'e', type: 'box', kind: 'ellipse', x: 500, y: 0, w: 200, h: 100 },
  { id: 'ar', type: 'arrow', from: 'a', to: 'b' },
  { id: 'p', type: 'pen', x: 0, y: 300, points: [0, 0, 100, 0, 100, 100], width: 4 },
  { id: 't', type: 'text', x: 0, y: 500, text: 'hello' },
  { id: 's', type: 'section', x: 800, y: 0, w: 300, h: 200, text: 'Group' },
];
group('hit', () => {
  const by = {}; BOARD.forEach((i) => { by[i.id] = i; });
  const H = (id, x, y, tol) => G.hit(by[id], x, y, tol == null ? 4 : tol, by);
  ok(H('a', 60, 30) && H('a', 0, 0) && H('a', 123, 30) && !H('a', 126, 30) && !H('a', 60, 70), 'box, with tolerance');
  ok(H('a', 123, 30, 4) && !H('a', 123, 30, 0), 'tolerance is used');
  ok(H('e', 600, 50) && !H('e', 505, 5) && H('e', 500, 50) && !H('e', 695, 95), 'ellipse: not its box corners');
  ok(G.hit({ type: 'box', kind: 'diamond', x: 0, y: 0, w: 100, h: 100 }, 50, 50, 0) && !G.hit({ type: 'box', kind: 'diamond', x: 0, y: 0, w: 100, h: 100 }, 10, 10, 2), 'diamond');
  // the arrow runs 120,30 → 210,30 → 210,230 → 300,230
  ok(H('ar', 160, 32) && H('ar', 210, 100) && H('ar', 213, 100) && !H('ar', 220, 100) && !H('ar', 160, 100), 'arrow: near its route only');
  ok(H('p', 50, 303) && H('p', 100, 350) && !H('p', 50, 350), 'pen: near its line only');
  ok(H('t', 10, 510) && !H('t', 100, 510), 'text');
  ok(H('s', 900, 100) && H('s', 810, -10) && !H('s', 1090, -10), 'section: inside, and on its title');
  ok(!G.hit({ type: 'arrow', from: 'a', to: 'zz' }, 0, 0, 4, by), 'a lost arrow is never hit');
  ok(!G.hit(null, 0, 0, 4), 'no item');
});

group('inRect', () => {
  const by = {}; BOARD.forEach((i) => { by[i.id] = i; });
  const I = (id, r, whole) => G.inRect(by[id], r, whole, by);
  ok(I('a', R(-10, -10, 200, 100), true) && !I('a', R(50, -10, 200, 100), true) && I('a', R(50, -10, 200, 100), false), 'box: whole or touched');
  ok(!I('a', R(200, 200, 50, 50), false), 'box: apart');
  ok(I('a', { x: 190, y: 90, w: -200, h: -100 }, true), 'a marquee dragged backwards');
  ok(I('ar', R(100, 0, 250, 250), true) && !I('ar', R(100, 0, 150, 250), true), 'arrow: whole');
  ok(I('ar', R(200, 90, 20, 20), false) && !I('ar', R(130, 60, 60, 100), false), 'arrow: its line, not its box');
  ok(I('p', R(90, 340, 20, 20), false) && !I('p', R(20, 340, 40, 40), false) && I('p', R(-5, 295, 110, 110), true), 'pen');
});

group('members', () => {
  const sec = { id: 's', type: 'section', x: 0, y: 0, w: 400, h: 300 };
  const items = [
    sec,
    { id: 'in', type: 'box', x: 20, y: 20, w: 100, h: 60 },
    { id: 'half', type: 'box', x: 330, y: 100, w: 100, h: 60 },       // centre inside
    { id: 'mostly-out', type: 'box', x: 360, y: 100, w: 100, h: 60 }, // centre outside
    { id: 'out', type: 'box', x: 600, y: 0, w: 100, h: 60 },
    { id: 'inner', type: 'section', x: 150, y: 150, w: 100, h: 100 },
    { id: 'outer', type: 'section', x: -100, y: -100, w: 600, h: 500 },
    { id: 'tx', type: 'text', x: 30, y: 200, text: 'note' },
    { id: 'ar', type: 'arrow', from: 'in', to: [300, 250] },
    { id: 'far', type: 'arrow', from: [900, 900], to: [950, 900] },
    { id: 'lost', type: 'arrow', from: 'nope', to: 'in' },
  ];
  eq(G.members(sec, items).map((i) => i.id), ['in', 'half', 'inner', 'tx', 'ar'], 'by centre, not itself, not the frame around it');
  eq(G.members(items[6], items).map((i) => i.id), ['s', 'in', 'half', 'mostly-out', 'inner', 'tx', 'ar'], 'the outer frame has the inner ones');
  eq(G.members(sec, []), [], 'empty board');
});

group('snap', () => {
  const m = R(100, 100, 80, 40);
  let s = G.snap(m, [R(104, 300, 200, 50)], 6);
  eq([s.dx, s.dy], [4, 0], 'left edges');
  eq(s.guides, [{ x1: 104, y1: 100, x2: 104, y2: 350 }], 'the guide spans both');
  s = G.snap(m, [R(300, 97, 50, 200)], 6);
  eq([s.dx, s.dy], [0, -3], 'top edges');
  eq(s.guides, [{ x1: 100, y1: 97, x2: 350, y2: 97 }], 'a level guide');
  s = G.snap(m, [R(110, 300, 80, 40)], 6);
  eq([s.dx, s.dy, s.guides.length], [0, 0, 0], 'beyond the tolerance: nothing');
  s = G.snap(m, [R(103, 300, 80, 40), R(400, 138, 60, 60)], 6);
  eq([s.dx, s.dy], [3, -2], 'both axes on their own');
  ok(s.guides.length >= 2 && s.guides.some((g) => g.x1 === g.x2) && s.guides.some((g) => g.y1 === g.y2), 'a guide for each axis');
  s = G.snap(m, [R(300, 0, 300, 244)], 6);
  eq(s.dy, 2, 'centre to centre');
  s = G.snap(m, [R(184, 300, 50, 50)], 6);
  eq(s.dx, 4, 'right edge to a left edge');
  s = G.snap(m, [R(105, 300, 80, 40), R(98, 500, 80, 40)], 6);
  eq(s.dx, -2, 'the nearest wins');
  s = G.snap(m, [R(104, 300, 80, 40), R(104, 500, 30, 30)], 6);
  ok(s.dx === 4 && s.guides.filter((g) => g.x1 === 104).length === 1 && s.guides.filter((g) => g.x1 === 104)[0].y2 === 530, 'one guide over all that line up');
  s = G.snap(m, [], 6);
  eq(s, { dx: 0, dy: 0, guides: [] }, 'nothing to snap to');
  // after the snap the edges really meet
  s = G.snap(R(13, 7, 50, 50), [R(10, 200, 50, 50), R(300, 10, 20, 200)], 5);
  eq([13 + s.dx, 7 + s.dy], [10, 10], 'lands on the lines');
});

group('align', () => {
  const rs = [{ id: 'a', x: 0, y: 0, w: 100, h: 40 }, { id: 'b', x: 200, y: 100, w: 50, h: 60 }, { id: 'c', x: 90, y: 300, w: 30, h: 20 }];
  const X = (how) => G.align(rs, how).map((r) => [r.id, r.x, r.y]);
  eq(X('left'), [['a', 0, 0], ['b', 0, 100], ['c', 0, 300]], 'left');
  eq(X('right'), [['a', 150, 0], ['b', 200, 100], ['c', 220, 300]], 'right');
  eq(X('center'), [['a', 75, 0], ['b', 100, 100], ['c', 110, 300]], 'center');
  eq(X('top'), [['a', 0, 0], ['b', 200, 0], ['c', 90, 0]], 'top');
  eq(X('bottom'), [['a', 0, 280], ['b', 200, 260], ['c', 90, 300]], 'bottom');
  eq(X('middle'), [['a', 0, 140], ['b', 200, 130], ['c', 90, 150]], 'middle');
  eq(X('hspace'), [['a', 0, 0], ['b', 200, 100], ['c', 135, 300]], 'hspace: equal gaps, ends stay');
  eq(X('vspace'), [['a', 0, 0], ['b', 200, 140], ['c', 90, 300]], 'vspace');
  eq(G.align(rs.slice(0, 2), 'hspace').map((r) => r.x), [0, 200], 'two cannot be spaced');
  eq(G.align([], 'left'), [], 'none');
  eq(X('nonsense'), [['a', 0, 0], ['b', 200, 100], ['c', 90, 300]], 'unknown: unchanged');
});

group('fit', () => {
  eq(G.fit([R(0, 0, 1000, 500)], 600, 400, 50), { zoom: 0.5, x: -100, y: -150, tx: 50, ty: 75 }, 'zooms out to fit, centred');
  eq(G.fit([R(0, 0, 100, 50), R(900, 450, 100, 50)], 600, 400, 50).zoom, 0.5, 'over all rects');
  eq(G.fit([R(100, 100, 100, 100)], 600, 400, 50), { zoom: 1, x: -150, y: -50, tx: 150, ty: 50 }, 'never zooms in past 100 %');
  eq(G.fit([R(100, 100, 100, 100)], 600, 400, 50, 2).zoom, 2, 'unless allowed');
  eq(G.fit([], 600, 400, 50), { zoom: 1, x: -300, y: -200, tx: 300, ty: 200 }, 'an empty board: the origin in the middle');
  const f = G.fit([R(-500, 200, 3000, 100)], 800, 600, 40);
  ok(near((-500 - f.x) * f.zoom, 40, 0.01) && near((2500 - f.x) * f.zoom, 760, 0.01), 'the padding is kept: ' + JSON.stringify(f));
});

group('issues', () => {
  const sec = { id: 's', type: 'section', x: 0, y: 0, w: 400, h: 300 };
  const I = (items) => G.issues(items);
  eq(I([{ id: 'a', type: 'box', x: 0, y: 0, w: 100, h: 60 }, { id: 'b', type: 'box', x: 150, y: 0, w: 100, h: 60 }]), [], 'apart: fine');
  eq(I([{ id: 'a', type: 'box', x: 0, y: 0, w: 100, h: 60 }, { id: 'b', type: 'box', x: 97, y: 0, w: 100, h: 60 }]), [], 'a few pixels: fine');
  eq(I([{ id: 'a', type: 'box', x: 0, y: 0, w: 100, h: 60 }, { id: 'b', type: 'note', x: 50, y: 30, w: 100, h: 60 }]), [{ kind: 'overlap', ids: ['a', 'b'] }], 'overlap');
  eq(I([sec, { id: 'a', type: 'box', x: 40, y: 40, w: 100, h: 60 }]), [], 'inside a section: fine');
  eq(I([sec, { id: 'a', type: 'box', x: 290, y: 40, w: 150, h: 60 }]), [{ kind: 'outside', ids: ['a', 's'] }], 'sticking out');
  eq(I([sec, { id: 'a', type: 'box', x: 3, y: 40, w: 100, h: 60 }]), [{ kind: 'tight', ids: ['a', 's'] }], 'tight against the edge');
  eq(I([sec, { id: 'a', type: 'box', x: 8, y: 8, w: 100, h: 60 }]), [], '8 px is room enough');
  eq(I([sec, { id: 'a', type: 'box', x: 20, y: 20, w: 100, h: 60 }, { id: 'ar', type: 'arrow', from: 'a', to: [200, 200] }, { id: 'p', type: 'pen', x: 20, y: 20, points: [0, 0, 100, 60] }]), [], 'arrows and pen lines are not blocks');
  eq(I([{ id: 'a', type: 'box', x: 0, y: 0, w: 100, h: 60, group: 'g' }, { id: 'b', type: 'text', x: 10, y: 10, text: 'on top', group: 'g' }]), [], 'grouped on purpose');
  eq(I([sec, { id: 's2', type: 'section', x: 20, y: 20, w: 200, h: 200 }, { id: 'a', type: 'box', x: 30, y: 60, w: 100, h: 60 }]), [], 'nested sections: the inner one is home');
  eq(I([sec, { id: 's2', type: 'section', x: 20, y: 20, w: 200, h: 200 }, { id: 'a', type: 'box', x: 150, y: 60, w: 100, h: 60 }]), [{ kind: 'outside', ids: ['a', 's2'] }], 'out of the inner one');
  const many = [
    { id: 'a', type: 'box', x: 0, y: 0, w: 100, h: 60 }, { id: 'b', type: 'box', x: 90, y: 0, w: 100, h: 60 },      // 10 × 60
    { id: 'c', type: 'box', x: 0, y: 200, w: 100, h: 60 }, { id: 'd', type: 'box', x: 20, y: 210, w: 100, h: 60 },  // 80 × 50
    { id: 's', type: 'section', x: 1000, y: 0, w: 400, h: 300 }, { id: 'e', type: 'box', x: 1002, y: 100, w: 100, h: 60 },
    { id: 'f', type: 'box', x: 1350, y: 100, w: 90, h: 60 },                                                         // 40 × 60 out
  ];
  eq(I(many), [{ kind: 'overlap', ids: ['c', 'd'] }, { kind: 'outside', ids: ['f', 's'] }, { kind: 'overlap', ids: ['a', 'b'] }, { kind: 'tight', ids: ['e', 's'] }], 'worst first, tight last');
  const pile = [];
  for (let i = 0; i < 30; i++) pile.push({ id: 'p' + i, type: 'box', x: i * 5, y: 0, w: 100, h: 60 });
  const got = I(pile);
  ok(got.length === 20 && got[0].ids.join() === 'p0,p1', 'capped at 20: ' + got.length);
  eq(I([]), [], 'empty');
});

group('lanes', () => {
  const box = (id, x, y, kind) => ({ id, type: 'box', x, y, w: 120, h: 60, kind });
  const orth = (pts) => pts.every((p, i) => !i || near(p[0], pts[i - 1][0]) || near(p[1], pts[i - 1][1]));
  const onSide = (p, r) => (near(p[0], r.x) || near(p[0], r.x + r.w)) && p[1] >= r.y && p[1] <= r.y + r.h ||
    (near(p[1], r.y) || near(p[1], r.y + r.h)) && p[0] >= r.x && p[0] <= r.x + r.w;
  // the least distance between two parallel legs of two routes that run side by side
  function apart(p, q) {
    let best = Infinity;
    for (let i = 0; i + 1 < p.length; i++) for (let j = 0; j + 1 < q.length; j++) {
      const a = p[i], b = p[i + 1], c = q[j], d = q[j + 1];
      if (near(a[1], b[1]) && near(c[1], d[1]) && Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) > 1) best = Math.min(best, Math.abs(a[1] - c[1]));
      if (near(a[0], b[0]) && near(c[0], d[0]) && Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) > 1) best = Math.min(best, Math.abs(a[0] - c[0]));
    }
    return best;
  }
  const cases = [
    ['side by side', [box('a', 0, 0), box('b', 300, 0)]],
    ['stacked', [box('a', 0, 0), box('b', 0, 240)]],
    ['offset (a Z)', [box('a', 0, 0), box('b', 300, 140)]],
    ['diagonal (an L)', [box('a', 0, 0), box('b', 300, 200)]],
    ['to a diamond', [box('a', 0, 0), box('b', 300, 20, 'diamond')]],
  ];
  cases.forEach(([tag, bs]) => {
    const its = bs.concat([{ id: 'ab', type: 'arrow', from: 'a', to: 'b' }, { id: 'ba', type: 'arrow', from: 'b', to: 'a' }, { id: 'ab2', type: 'arrow', from: 'a', to: 'b' }]);
    const L = G.lanes(its);
    eq(Object.keys(L).sort(), ['ab', 'ab2', 'ba'], tag + ': every arrow of the pair has a lane');
    // in the frame of a → b (an arrow b → a travels the other way: its offset is negated)
    ok(L.ab < -L.ba && -L.ba < L.ab2, () => tag + ': lanes follow array order ' + JSON.stringify(L));
    const rs = ['ab', 'ba', 'ab2'].map((id) => G.arrowRoute(its.find((x) => x.id === id), its, [], 8, L[id]).pts);
    rs.forEach((p, k) => {
      ok(orth(p), () => tag + ': leg not orthogonal ' + JSON.stringify(p));
      const s = G.bounds(bs[k === 1 ? 1 : 0]), t = G.bounds(bs[k === 1 ? 0 : 1]);
      if (!bs[1].kind) ok(onSide(p[0], s) && onSide(p[p.length - 1], t), () => tag + ': an end left its side ' + JSON.stringify(p));
    });
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const d = apart(rs[i], rs[j]);
      ok(d >= 7.9 && d < Infinity, () => tag + ': routes ' + i + ',' + j + ' only ' + d + ' apart: ' + JSON.stringify([rs[i], rs[j]]));
    }
  });
  // the contract of route: no lane, the route as it was
  const A = { rect: R(0, 0) }, B = { rect: R(300, 140) };
  eq(G.route(A, B, { lane: 0 }), G.route(A, B, {}), 'lane 0 changes nothing');
  eq(G.lanes([box('a', 0, 0), box('b', 300, 0), { id: 'x', type: 'arrow', from: 'a', to: 'b' }]), {}, 'a single arrow keeps the middle');
  eq(G.lanes([box('a', 0, 0), box('b', 300, 0), { id: 'x', type: 'arrow', from: 'a', to: 'b' }, { id: 'y', type: 'arrow', from: 'a', to: 'b', via: [[200, 100]] }]), {}, 'an arrow with waypoints keeps its own way');
  const many = [box('a', 0, 0), box('b', 300, 0)];
  for (let i = 0; i < 6; i++) many.push({ id: 'm' + i, type: 'arrow', from: i % 2 ? 'b' : 'a', to: i % 2 ? 'a' : 'b' });
  const lm = G.lanes(many), vals = Object.keys(lm).map((k, i) => lm[k] * (i % 2 ? -1 : 1));
  ok(vals.length === 6 && Math.max.apply(null, vals) <= 18 && Math.min.apply(null, vals) >= -18 && new Set(vals).size === 6, 'six arrows: six lanes, closer together ' + JSON.stringify(lm));
  // a lane never pushes an end off a small box, nor turns a short leg round
  const small = G.route({ rect: R(0, 0, 40, 16) }, { rect: R(200, 0, 40, 16) }, { lane: 12 }).pts;
  ok(small[0][1] >= 0 && small[0][1] <= 16, 'clamped to a small side: ' + JSON.stringify(small));
});

// a route's legs against the inside of a rect (1 px in from its edges)
function through(pts, r) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (Math.max(a[0], b[0]) > r.x + 1 && Math.min(a[0], b[0]) < r.x + r.w - 1 && Math.max(a[1], b[1]) > r.y + 1 && Math.min(a[1], b[1]) < r.y + r.h - 1) return true;
  }
  return false;
}
// the longest stretch two routes run on top of each other (collinear legs overlapping)
function sharedRun(p, q) {
  let best = 0;
  for (let i = 0; i + 1 < p.length; i++) for (let j = 0; j + 1 < q.length; j++) {
    const A = p[i], B = p[i + 1], C = q[j], D = q[j + 1];
    if (near(A[1], B[1]) && near(C[1], D[1]) && Math.abs(A[1] - C[1]) < 0.5) best = Math.max(best, Math.min(Math.max(A[0], B[0]), Math.max(C[0], D[0])) - Math.max(Math.min(A[0], B[0]), Math.min(C[0], D[0])));
    if (near(A[0], B[0]) && near(C[0], D[0]) && Math.abs(A[0] - C[0]) < 0.5) best = Math.max(best, Math.min(Math.max(A[1], B[1]), Math.max(C[1], D[1])) - Math.max(Math.min(A[1], B[1]), Math.min(C[1], D[1])));
  }
  return best;
}
// every arrow of a board routed as the page does it: round the blocks near it, on its lane and slot,
// then moved off the others (geo.separate)
function routeAll(items) {
  const by = {}; items.forEach((i) => { by[i.id] = i; });
  const L = G.lanes(items), S = G.slots(items, by);
  const solid = items.filter((i) => i.type !== 'arrow' && i.type !== 'pen' && i.type !== 'section');
  const raw = items.filter((a) => a.type === 'arrow').map((a) => ({ id: a.id, fixed: !!a.via,
    pts: G.arrowRoute(a, by, solid.filter((o) => o.id !== a.from && o.id !== a.to).map((o) => G.bounds(o, by)), 8, L[a.id], S[a.id]).pts }));
  const sep = G.separate(raw.map((x) => Object.assign({}, x)));
  const out = {};
  raw.forEach((x) => { out[x.id] = sep[x.id] || x.pts; });
  return out;
}

group('routeAround', () => {
  // a block right above a sticky (a row 24 apart, as placement leaves them), an arrow from its bottom
  // dot to a new block or a loose point just under the sticky: it goes round the sticky
  const A = R(0, 0, 180, 60);
  let n = 0;
  [4, 8, 12, 16, 24, 32].forEach((gap) => [-40, 0, 20].forEach((sx) => [4, 10, 24, 60].forEach((g2) => [0, 90, 150].forEach((px) => {
    const S = R(sx, 60 + gap, 200, 160), y = S.y + S.h + g2;
    [[{ rect: R(px - 90, y, 180, 60) }, { fromSide: 'bottom' }], [{ pt: [px, y] }, { fromSide: 'bottom' }], [{ pt: [px, y] }, {}], [{ rect: R(px - 90, y, 180, 60) }, {}]].forEach(([to, o]) => {
      const r = G.route({ rect: A }, to, Object.assign({ obstacles: [S] }, o)); n++;
      ok(!through(r.pts, S), () => 'through the sticky: gap ' + gap + ' ' + JSON.stringify([S, to, o, r.pts]));
    });
  }))));
  ok(n > 300, 'cases ' + n);
  // a third block between two others, side by side and stacked: gone round when there is room
  [[R(0, 0), R(500, 0), R(220, -10, 100, 80)], [R(0, 0), R(0, 400), R(-10, 160, 140, 80)], [R(0, 0), R(400, 300), R(180, 120, 120, 80)]].forEach(([a, b, c]) => {
    const r = G.route({ rect: a }, { rect: b }, { obstacles: [c] });
    ok(!through(r.pts, c), () => 'through the third block ' + JSON.stringify([a, b, c, r.pts]));
  });
});

group('slots', () => {
  const box = (id, x, y, w, h) => ({ id, type: 'box', x, y, w: w || 160, h: h || 60 });
  // one block, three arrows out of its right side to three others: three points on that side, top to
  // bottom in the order of the blocks they go to, so they do not cross
  const fan = [box('o', 0, 100, 160, 80), box('p', 400, 0), box('q', 400, 100), box('r', 400, 220),
    { id: 'op', type: 'arrow', from: 'o', to: 'p' }, { id: 'oq', type: 'arrow', from: 'o', to: 'q' }, { id: 'or', type: 'arrow', from: 'o', to: 'r' }];
  const S = G.slots(fan), rs = routeAll(fan);
  ok(S.op && S.oq && S.or && S.op.from < S.oq.from && S.oq.from < S.or.from, () => 'ordered slots ' + JSON.stringify(S));
  const starts = ['op', 'oq', 'or'].map((id) => rs[id][0]);
  ok(starts.every((p) => near(p[0], 160)) && starts[0][1] < starts[1][1] && starts[1][1] < starts[2][1], () => 'distinct points on the right side ' + JSON.stringify(starts));
  // two blocks into one side of a third, and one going on from that side: distinct points there
  const into = [box('a', 0, 0), box('b', 0, 160), box('c', 400, 60), box('w', -400, 60),
    { id: 'ac', type: 'arrow', from: 'a', to: 'c' }, { id: 'bc', type: 'arrow', from: 'b', to: 'c', toSide: 'left' }, { id: 'cw', type: 'arrow', from: 'c', to: 'w', fromSide: 'left' }];
  const r2 = routeAll(into), ends = [r2.ac[r2.ac.length - 1], r2.bc[r2.bc.length - 1], r2.cw[0]];
  ok(new Set(ends.map((p) => p.join())).size === 3, () => 'three points on c\'s left side ' + JSON.stringify(ends));
  // arrows to the same place share one slot (lanes part them); one arrow alone keeps the middle
  eq(G.slots([box('a', 0, 0), box('b', 400, 0), { id: 'x', type: 'arrow', from: 'a', to: 'b' }, { id: 'y', type: 'arrow', from: 'a', to: 'b' }]), {}, 'a pair keeps the middle');
  eq(G.route({ rect: R(0, 0) }, { rect: R(300, 0) }, { fromAt: 0, toAt: 0 }), G.route({ rect: R(0, 0) }, { rect: R(300, 0) }, {}), 'no slot, the route as it was');
  // a slot on a straight line is kept
  const st = G.route({ rect: R(0, 0, 160, 80) }, { rect: R(300, 0, 160, 80) }, { fromAt: -12 }).pts;
  ok(st.length === 2 && near(st[0][1], 28) && near(st[1][1], 28), 'a straight line on its slot ' + JSON.stringify(st));
});

group('separate', () => {
  // boards as the server lays them out: no two arrows run on top of each other for more than a stub,
  // and no route goes through a block that is not one of its ends
  const box = (id, x, y, w, h, kind) => ({ id, type: 'box', x, y, w: w || 160, h: h || 60, kind });
  const boards = {
    arch: [box('web', 40, 60), box('mob', 40, 160), box('gw', 300, 110), box('auth', 520, 60), box('ord', 520, 160), box('wk', 300, 260),
      box('redis', 800, 40, 160, 60, 'database'), box('pg', 800, 140, 160, 60, 'database'), box('q', 800, 240, 160, 60, 'queue'),
      ...[['web', 'gw'], ['mob', 'gw'], ['gw', 'auth'], ['gw', 'ord'], ['auth', 'redis'], ['ord', 'pg'], ['ord', 'q'], ['q', 'wk']].map(([f, t]) => ({ id: f + '-' + t, type: 'arrow', from: f, to: t }))],
    tree: [box('ceo', 300, 0), box('a', 0, 160), box('b', 300, 160), box('c', 600, 160), box('a1', -100, 320), box('a2', 100, 320), box('c1', 500, 320), box('c2', 700, 320),
      ...[['ceo', 'a'], ['ceo', 'b'], ['ceo', 'c'], ['a', 'a1'], ['a', 'a2'], ['c', 'c1'], ['c', 'c2']].map(([f, t]) => ({ id: f + '-' + t, type: 'arrow', from: f, to: t }))],
    funnel: [box('s1', 0, 0), box('s2', 0, 40 + 60), box('s3', 0, 200), box('t', 500, 300),
      ...['s1', 's2', 's3'].map((s) => ({ id: s + '-t', type: 'arrow', from: s, to: 't', toSide: 'top' }))],
  };
  Object.keys(boards).forEach((k) => {
    const its = boards[k], rs = routeAll(its), ids = Object.keys(rs), blocks = its.filter((i) => i.type === 'box');
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const s = sharedRun(rs[ids[i]], rs[ids[j]]);
      ok(s <= 16, () => k + ': ' + ids[i] + ' and ' + ids[j] + ' share ' + s + ' px ' + JSON.stringify([rs[ids[i]], rs[ids[j]]]));
    }
    ids.forEach((id) => {
      const a = its.find((x) => x.id === id);
      ok(orthOk(rs[id]), () => k + ': ' + id + ' not orthogonal ' + JSON.stringify(rs[id]));
      blocks.forEach((b) => { if (b.id !== a.from && b.id !== a.to) ok(!through(rs[id], G.bounds(b)), () => k + ': ' + id + ' through ' + b.id + ' ' + JSON.stringify(rs[id])); });
    });
  });
  eq(G.separate([{ id: 'a', pts: [[0, 0], [100, 0]] }, { id: 'b', pts: [[0, 50], [100, 50]] }]), {}, 'nothing shared: nothing moves');
  // two routes down one channel, both turning right at the bottom: parted, the one turning off first on
  // the right (inside the turn), so neither crosses the other; their ends stay
  const fa = [[0, 0], [100, 0], [100, 194], [200, 194]], fb = [[0, 40], [100, 40], [100, 206], [200, 206]];
  const sp = G.separate([{ id: 'a', pts: fa }, { id: 'b', pts: fb }]), pa = sp.a || fa, pb = sp.b || fb;
  ok(sharedRun(pa, pb) <= 16 && pa[1][0] > pb[1][0], () => 'parted, a on the right ' + JSON.stringify([pa, pb]));
  ok(same2(pa[0], fa[0]) && same2(pa[3], fa[3]) && same2(pb[0], fb[0]) && same2(pb[3], fb[3]), 'the ends stay');
  ok(orthOk(pa) && orthOk(pb), 'still orthogonal');
  // a leg on top of another route's first leg (that one sits on its slot): only the middle one moves
  const s2 = G.separate([{ id: 'a', pts: [[0, 100], [300, 100]] }, { id: 'b', pts: [[50, 0], [50, 100], [250, 100], [250, 200]] }]);
  ok(!s2.a && s2.b && sharedRun([[0, 100], [300, 100]], s2.b) <= 16, () => 'the middle leg moved ' + JSON.stringify(s2));
  eq(G.separate([{ id: 'a', pts: [[0, 0], [50, 0], [50, 200], [100, 200]], fixed: true }, { id: 'b', pts: [[0, 20], [50, 20], [50, 180], [100, 180]], fixed: true }]), {}, 'routes set by hand stay');
});
function same2(p, q) { return near(p[0], q[0]) && near(p[1], q[1]); }
function orthOk(pts) { return pts.every((p, i) => !i || near(p[0], pts[i - 1][0]) || near(p[1], pts[i - 1][1])); }

group('linkMarks', () => {
  // a link made round bold italic words (the link button): one run, every mark kept, measured as the words
  eq(G.richLines('[***Dia***](https://x.io)', 16).lines[0].runs, [{ t: 'Dia', b: true, i: true, href: 'https://x.io' }], 'bold italic link');
  eq(G.measure('[***Dia***](https://x.io)', 16).lines, ['Dia'], 'measured as its words');
  eq(G.richLines('- [**a** `c`](https://x.io)', 16).lines[0].runs.map((r) => [r.t, !!r.b, !!r.code, r.href]), [['a', true, false, 'https://x.io'], [' ', false, false, 'https://x.io'], ['c', false, true, 'https://x.io']], 'a list item: marks inside the link');
});

group('richLines', () => {
  const L = (t, s, w, o) => G.richLines(t, s, w, o).lines;
  eq(L('**Bold** and *it* `c*x*` [l **b**](https://a.b/c) end', 16), [{ runs: [{ t: 'Bold', b: true }, { t: ' and ' }, { t: 'it', i: true }, { t: ' ' }, { t: 'c*x*', code: true }, { t: ' ' },
    { t: 'l ', href: 'https://a.b/c' }, { t: 'b', b: true, href: 'https://a.b/c' }, { t: ' end' }], indent: 0 }], 'marks as runs');
  eq(L('- one\n1. two\nthree', 10), [{ runs: [{ t: 'one' }], indent: 13, mark: '•' }, { runs: [{ t: 'two' }], indent: 13, mark: '1.' }, { runs: [{ t: 'three' }], indent: 0 }], 'list items and their markers');
  eq(L('- aaa bbb ccc', 10, 13 + 40).map((l) => [l.runs.map((r) => r.t).join(''), l.mark || '']), [['aaa bbb', '•'], ['ccc', '']], 'a list item wraps in its indent, the marker on its first line');
  eq(L('- not a list', 10, 0, { lists: false })[0], { runs: [{ t: '- not a list' }], indent: 0 }, 'no lists in a cell');
  eq(L('[x](javascript:alert(1)) **', 10)[0].runs, [{ t: '[x](javascript:alert(1)) **' }], 'only http(s) links; a lone mark stays');
  ['one two three four five six seven', 'a\n\nb c d', 'xx abcdefghij y', 'one two\nthree four five'].forEach((t) => {
    [0, 22, 44, 61].forEach((w) => eq(L(t, 10, w).map((l) => l.runs.map((r) => r.t).join('')), G.measure(t, 10, w).lines, 'wraps as measure: ' + JSON.stringify(t) + ' at ' + w));
  });
  eq(G.richLines('a\nb', 10).h, 28, 'height by the rule');
});

process.stdout.write(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "node is not installed")
class BoardGeo(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        fd, path = tempfile.mkstemp(suffix=".js")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(SCRIPT)
        try:
            run = subprocess.run([NODE, path, str(GEO)], capture_output=True, text=True, encoding="utf-8", timeout=120)
        finally:
            os.unlink(path)
        if run.returncode != 0:
            raise AssertionError("node failed:\n" + run.stderr[-4000:])
        cls.out = json.loads(run.stdout)

    def group(self, name, at_least=1):
        g = self.out[name]
        self.assertEqual(g["fails"][:12], [], f"{name}: {len(g['fails'])} of {g['n']} checks failed")
        self.assertGreaterEqual(g["n"], at_least, name)

    def test_consts(self):
        self.group("consts", 2)

    def test_measure(self):
        self.group("measure", 15)

    def test_shape_paths(self):
        self.group("shapePath", 300)

    def test_shape_insets(self):
        self.group("shapeInset", 300)

    def test_bounds(self):
        self.group("bounds", 10)

    def test_table_layout(self):
        self.group("tableLayout", 6)

    def test_anchor(self):
        self.group("anchor", 4)

    def test_route_cases(self):
        self.group("route", 600)

    def test_route_fuzz(self):
        self.group("route_fuzz", 5000)

    def test_route_speed(self):
        self.group("route_speed", 3)
        print(f"\n  500 routes x 50 obstacles: {self.out['speed_ms']} ms (first, cold pass {self.out['speed_first_ms']} ms) "
              f"({self.out['speed_clean']} of 500 clear of every obstacle; {self.out['speed_clean_without']} without avoidance)")

    def test_head_path(self):
        self.group("headPath", 8)

    def test_pen_path(self):
        self.group("penPath", 8)

    def test_simplify(self):
        self.group("simplify", 7)

    def test_hit(self):
        self.group("hit", 8)

    def test_in_rect(self):
        self.group("inRect", 5)

    def test_members(self):
        self.group("members", 3)

    def test_snap(self):
        self.group("snap", 10)

    def test_align(self):
        self.group("align", 10)

    def test_fit(self):
        self.group("fit", 5)

    def test_issues(self):
        self.group("issues", 12)

    def test_lanes(self):
        self.group("lanes", 40)

    def test_rich_lines(self):
        self.group("richLines", 20)

    def test_route_around_a_third_block(self):
        self.group("routeAround", 300)

    def test_slots(self):
        self.group("slots", 6)

    def test_separate(self):
        self.group("separate", 40)

    def test_link_marks(self):
        self.group("linkMarks", 3)


if __name__ == "__main__":
    unittest.main()
