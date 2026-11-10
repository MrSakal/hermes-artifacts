"""The model builder (types/model/build.js), run under node with the vendored three bundle."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TYPES = ROOT / "plugin" / "hermes_artifacts" / "types"
BUILD = TYPES / "model" / "build.js"
BUNDLE = TYPES / "vendor" / "three.bundle.js"
NODE = shutil.which("node")

# argv: <three.bundle.js> <build.js>; prints one JSON object {group: {n, fails}, perf, ...}
SCRIPT = r"""
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.FileReader = class {
  readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend && this.onloadend(); }); }
  readAsDataURL(b) { b.arrayBuffer().then((r) => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(r).toString('base64'); this.onloadend && this.onloadend(); }); }
};
require(process.argv[2]);
const K = require(process.argv[3]);
const out = {};
const t00 = Date.now();
function rec(group, label, ok, got, want) {
  const g = out[group] || (out[group] = { n: 0, fails: [] });
  g.n++;
  if (!ok) g.fails.push([label, JSON.stringify(got), JSON.stringify(want)]);
}
function near(a, b, tol) { return typeof a === 'number' && Math.abs(a - b) <= (tol == null ? 1e-6 : tol) * Math.max(1, Math.abs(b)); }
function nearArr(a, b, tol) { return Array.isArray(a) && a.length === b.length && a.every((x, i) => near(x, b[i], tol)); }
function eq(group, label, got, want, tol) {
  let ok;
  if (typeof want === 'number') ok = near(got, want, tol);
  else if (Array.isArray(want) && want.every((x) => typeof x === 'number')) ok = nearArr(got, want, tol);
  else ok = JSON.stringify(got) === JSON.stringify(want);
  rec(group, label, ok, got, want);
}
function bboxOf(o) {
  let top = o;
  while (top.parent) top = top.parent;
  const b = new THREE.Box3();
  K.meshItems(top).filter((it) => isUnder(it.mesh, o)).forEach((it) => {
    const p = it.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) b.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(it.matrix));
  });
  return [b.min.toArray(), b.max.toArray()];
}
function partBox(built, id) {
  // bbox of one part object (in root frame), including its instances
  const o = built.byId[id];
  const tmp = new THREE.Group();
  tmp.matrixWorld.identity();
  const b = new THREE.Box3(), v = new THREE.Vector3();
  K.meshItems(built.root).filter((it) => it.partId === id && !it.mesh.userData.mirror && isUnder(it.mesh, o)).forEach((it) => {
    const p = it.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) b.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(it.matrix));
  });
  return [b.min.toArray(), b.max.toArray()];
}
function isUnder(x, o) { for (let y = x; y; y = y.parent) if (y === o) return true; return false; }
function flat(b) { return b[0].concat(b[1]); }

(async () => {
  // ---------------------------------------------------------------- expressions
  const V = { w: 1200, t: 3, r: 10, h: 2400 };
  const E = [
    ['1+2*3', 7], ['(1+2)*3', 9], ['2^3^2', 512], ['-2^2', -4], ['2^-1', 0.5], ['--2', 2], ['3 - -2', 5], ['+4', 4],
    ['(w-40)/2', 580], ['w/2-t', 597], ['sin(30)', 0.5], ['cos(60)', 0.5], ['tan(45)', 1], ['sin(180)', 0], ['cos(90)', 0],
    ['min(3,1,2)', 1], ['max(1,2)', 2], ['round(2.5)', 3], ['floor(-1.5)', -2], ['ceil(1.2)', 2], ['sqrt(16)', 4], ['abs(-3)', 3],
    ['pi', Math.PI], ['2*pi*r', 20 * Math.PI], ['1e3', 1000], ['.5', 0.5], ['1.5e-1', 0.15], [12, 12], ['  3 ', 3], ['h / 3 * 2', 1600],
    ['max(w, h) - min(w, t)', 2397],
    ['wd', 'ERR unknown name "wd"'], ['(w-40))', 'ERR unexpected ")" at 7'], ['1/0', 'ERR the result is not a finite number'],
    ['sqrt(-1)', 'ERR the result is not a finite number'], ['foo(1)', 'ERR unknown function "foo"'], ['1+', 'ERR unexpected end of expression'],
    ['', 'ERR empty expression'], ['2 3', 'ERR unexpected "3" at 3'], ['x'.repeat(201), 'ERR expression longer than 200 characters'],
    ['sqrt(1,2)', 'ERR sqrt takes 1 argument'], ['min()', 'ERR min takes at least 1 argument'], ['w#2', 'ERR unexpected "#" at 2'],
    ['2w', 'ERR unexpected "w" at 2'], ['(1', 'ERR unexpected end of expression'], ['sqrt', 'ERR "sqrt" needs parentheses: sqrt(...)'],
    [null, 'ERR expected a number or an expression'], [NaN, 'ERR the result is not a finite number'], ['tan(90)', 'ERR the result is not a finite number'],
    ['constructor', 'ERR unknown name "constructor"'],
  ];
  E.forEach(([e, want]) => {
    let got;
    try { got = K.evalExpr(e, V); } catch (err) { got = 'ERR ' + err.message; }
    eq('expr', String(e).slice(0, 30), got, want, 1e-12);
  });
  eq('expr', 'names', K.exprNames('(w-40)/2+max(t,h)*pi'), ['w', 't', 'h']);
  eq('expr', 'nan param', (() => { try { return K.evalExpr('w+1', { w: NaN }); } catch (e) { return e.message; } })(), 'parameter "w" has no valid value');

  // ---------------------------------------------------------------- params
  let P = K.params({ params: { w: { v: 1200, min: 300, max: 3000, step: 10, label: 'Width' }, h: 'w*2', t: 3, d: 'h+t', e: { v: 'f+1' }, f: 2 } });
  eq('params', 'values', Object.fromEntries(Object.entries(P.values).sort()), { d: 2403, e: 3, f: 2, h: 2400, t: 3, w: 1200 });
  eq('params', 'defs', P.defs[0], { name: 'w', v: 1200, min: 300, max: 3000, step: 10, label: 'Width', unit: null });
  eq('params', 'no problems', P.problems, []);
  P = K.params({ params: { w: 1000, h: 'w*2' } }, { w: 500 });
  eq('params', 'override flows', P.values, { w: 500, h: 1000 });
  P = K.params({ params: { a: 'b+1', b: 'a+1', c: 5, d: 'zz', 'Bad': 1, pi: 2 } });
  eq('params', 'cycle a', P.problems.some((p) => p.path === 'params.b' && /^cycle: a -> b -> a$/.test(p.msg)), true);
  eq('params', 'cycle flags a', P.problems.some((p) => p.path === 'params.a'), true);
  eq('params', 'c ok', P.values.c, 5);
  eq('params', 'unknown', P.problems.find((p) => p.path === 'params.d').msg, 'unknown name "zz"');
  eq('params', 'bad name', P.problems.some((p) => p.path === 'params.Bad'), true);
  eq('params', 'reserved', P.problems.find((p) => p.path === 'params.pi').msg, '"pi" is a reserved name');
  eq('params', 'self cycle', K.params({ params: { a: 'a' } }).problems[0].msg, 'cycle: a -> a');

  // ---------------------------------------------------------------- kinds
  const kindsModel = {
    params: { w: 100 },
    parts: [
      { id: 'box', kind: 'box', size: ['w', 50, 20] },
      { id: 'rbox', kind: 'box', size: [100, 50, 20], r: 5, at: [0, 0, 100] },
      { id: 'cyl', kind: 'cyl', r: 10, h: 100 },
      { id: 'frus', kind: 'cyl', r: 10, r2: 5, h: 30 },
      { id: 'cone', kind: 'cone', r: 10, h: 30 },
      { id: 'sph', kind: 'sphere', r: 10 },
      { id: 'tor', kind: 'torus', r: 20, tube: 5 },
      { id: 'pri', kind: 'prism', n: 6, r: 10, h: 5 },
      { id: 'ext', kind: 'extrude', profile: { rect: [200, 100] }, holes: [{ circle: [50, 50, 10] }], depth: 5 },
      { id: 'bev', kind: 'extrude', profile: { rect: [100, 100] }, depth: 10, bevel: 2 },
      { id: 'lat', kind: 'lathe', profile: { rect: [10, 100] } },
      { id: 'lat90', kind: 'lathe', profile: [[5, 0], [10, 0], [10, 20], [5, 20]], angle: 90 },
      { id: 'swp', kind: 'sweep', profile: { rect: [10, 10] }, path: [[0, 0, 0], [100, 0, 0], [100, 0, 50]] },
      { id: 'swp2', kind: 'sweep', profile: { circle: [0, 0, 5] }, path: [[0, 0, 0], [0, 0, 100]] },
      { id: 'ring', kind: 'sweep', profile: { circle: [0, 0, 2] }, path: [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]], closed: true },
      { id: 'smo', kind: 'sweep', profile: { circle: [0, 0, 2] }, path: [[0, 0, 0], [50, 0, 0], [50, 50, 20]], smooth: true },
      { id: 'lof', kind: 'loft', sections: [{ profile: { rect: [10, 10] }, z: 0 }, { profile: { rect: [10, 10] }, z: 20 }] },
      { id: 'lof2', kind: 'loft', sections: [{ profile: { rect: [20, 20] }, z: 0 }, { profile: { circle: [0, 0, 5] }, z: 30 }] },
      { id: 'hul', kind: 'hull', points: [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]] },
      { id: 'msh', kind: 'mesh', v: [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]], f: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] },
      { id: 'mshi', kind: 'mesh', v: [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]], f: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]] },
      { id: 'open', kind: 'mesh', v: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], f: [[0, 1, 2, 3]] },
    ]
  };
  let B = await K.build(kindsModel, {});
  eq('kinds', 'no problems', B.problems, []);
  const TO = {};
  K.takeoff(kindsModel, B).forEach((r) => { TO[r.id] = r; });
  const PI = Math.PI;
  eq('kinds', 'box bbox', flat(partBox(B, 'box')), [0, 0, 0, 100, 50, 20]);
  eq('kinds', 'box vol', TO.box.volume, 100000);
  eq('kinds', 'box area', TO.box.area, 2 * (100 * 50 + 100 * 20 + 50 * 20));
  eq('kinds', 'box size', TO.box.size, [100, 50, 20]);
  eq('kinds', 'rbox bbox', flat(partBox(B, 'rbox')), [0, 0, 100, 100, 50, 120], 1e-6);
  eq('kinds', 'rbox vol < box', TO.rbox.volume < 100000 && TO.rbox.volume > 95000, true);
  eq('kinds', 'cyl bbox', flat(partBox(B, 'cyl')), [-10, -10, 0, 10, 10, 100], 1e-6);
  eq('kinds', 'cyl vol', TO.cyl.volume, PI * 100 * 100, 0.005);
  eq('kinds', 'frustum vol', TO.frus.volume, PI * 30 / 3 * (100 + 50 + 25), 0.005);
  eq('kinds', 'cone vol', TO.cone.volume, PI * 100 * 30 / 3, 0.005);
  eq('kinds', 'sphere vol', TO.sph.volume, 4 / 3 * PI * 1000, 0.01);
  eq('kinds', 'sphere bbox', flat(partBox(B, 'sph')), [-10, -10, -10, 10, 10, 10], 1e-3);
  eq('kinds', 'torus vol', TO.tor.volume, 2 * PI * PI * 20 * 25, 0.02);
  eq('kinds', 'torus z', [partBox(B, 'tor')[0][2], partBox(B, 'tor')[1][2]], [-5, 5], 1e-6);
  eq('kinds', 'prism vol', TO.pri.volume, 3 * Math.sqrt(3) / 2 * 100 * 5, 1e-6);
  eq('kinds', 'prism flat bottom', partBox(B, 'pri')[0][1], -10 * Math.sqrt(3) / 2, 1e-6);
  eq('kinds', 'extrude hole vol', TO.ext.volume, (20000 - PI * 100) * 5, 0.002);
  eq('kinds', 'extrude bbox', flat(partBox(B, 'ext')), [0, 0, 0, 200, 100, 5]);
  eq('kinds', 'bevel bbox', flat(partBox(B, 'bev')), [0, 0, 0, 100, 100, 10], 1e-6);
  eq('kinds', 'bevel vol', TO.bev.volume < 100000 && TO.bev.volume > 97000, true);
  eq('kinds', 'lathe vol', TO.lat.volume, PI * 100 * 100, 0.005);
  eq('kinds', 'lathe bbox', flat(partBox(B, 'lat')), [-10, -10, 0, 10, 10, 100], 1e-6);
  eq('kinds', 'lathe90 vol', TO.lat90.volume, PI * (100 - 25) * 20 / 4, 0.005);
  eq('kinds', 'lathe90 quadrant', partBox(B, 'lat90')[0].slice(0, 2).every((x) => x > -1e-9), true);
  eq('kinds', 'L sweep bbox', flat(partBox(B, 'swp')), [0, -5, -5, 105, 5, 50], 1e-6);
  eq('kinds', 'L sweep vol', TO.swp.volume, 100 * (100 + 50), 1e-6);
  eq('kinds', 'vertical sweep vol', TO.swp2.volume, PI * 25 * 100, 0.005);
  eq('kinds', 'vertical sweep bbox z', [partBox(B, 'swp2')[0][2], partBox(B, 'swp2')[1][2]], [0, 100], 1e-9);
  eq('kinds', 'closed ring vol', TO.ring.volume, PI * 4 * 400, 0.01);
  eq('kinds', 'closed ring bbox', flat(partBox(B, 'ring')), [-2, -2, -2, 102, 102, 2], 1e-3);
  eq('kinds', 'smooth sweep closed', TO.smo.volume > 0, true);
  eq('kinds', 'loft box vol', TO.lof.volume, 2000, 1e-6);
  eq('kinds', 'loft2 vol between', TO.lof2.volume > PI * 25 * 30 && TO.lof2.volume < 400 * 30, true);
  eq('kinds', 'loft2 bbox', flat(partBox(B, 'lof2')), [-10, -10, 0, 10, 10, 30], 1e-6);
  eq('kinds', 'hull vol', TO.hul.volume, 1000 / 6, 1e-6);
  eq('kinds', 'mesh vol', TO.msh.volume, 1000 / 6, 1e-6);
  eq('kinds', 'mesh inside-out fixed', TO.mshi.volume, 1000 / 6, 1e-6);
  eq('kinds', 'open mesh vol null', TO.open.volume, null);
  eq('kinds', 'open mesh area', TO.open.area, 100);
  eq('kinds', 'mesh outward', (() => { const it = K.meshItems(B.root).find((i) => i.partId === 'mshi'); let v = 0; const p = it.geometry.attributes.position; for (let i = 0; i < p.count; i += 3) { const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c = new THREE.Vector3().fromBufferAttribute(p, i + 2); v += a.dot(b.clone().cross(c)) / 6; } return v > 0; })(), true);
  eq('kinds', 'every part has partId', B.root.children.every((o) => o.userData.partId), true);
  eq('kinds', 'stats parts', B.stats.parts, kindsModel.parts.length);
  eq('kinds', 'stats triangles', B.stats.triangles > 1000, true);
  eq('kinds', 'edges child', B.byId.box.children.filter((c) => c.userData.edges).length, 1);
  eq('kinds', 'box edges = 12', B.byId.box.children[0].geometry.attributes.position.count, 24);
  eq('kinds', 'cyl edges = 2 rims', B.byId.cyl.children[0].geometry.attributes.position.count / 2, 2 * 56);

  // ---------------------------------------------------------------- profiles, fillet, arcs
  const pp = (spec, vals) => K.profilePoints(spec, vals);
  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], w = p[(i + 1) % p.length]; a += q[0] * w[1] - w[0] * q[1]; } return a / 2; };
  const ext = (p) => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
  eq('profile', 'rect', pp({ rect: [20, 10] }), [[0, 0], [20, 0], [20, 10], [0, 10]]);
  eq('profile', 'clockwise reversed', area(pp([[0, 0], [0, 10], [20, 10], [20, 0]])) > 0, true);
  eq('profile', 'repeated close point', pp([[0, 0], [10, 0], [10, 10], [0, 0]]).length, 3);
  eq('profile', 'rrect area', area(pp({ rrect: [100, 50, 10] })), 5000 - (4 - PI) * 100, 0.002);
  eq('profile', 'rrect ext', ext(pp({ rrect: [100, 50, 10] })), [0, 0, 100, 50], 1e-9);
  eq('profile', 'circle area', area(pp({ circle: [5, 5, 10] })), PI * 100, 0.003);
  eq('profile', 'ngon area', area(pp({ ngon: [0, 0, 10, 4] })), 200, 1e-9);
  eq('profile', 'ngon square axis-aligned', ext(pp({ ngon: [0, 0, 10, 4] })), [-Math.SQRT1_2 * 10, -Math.SQRT1_2 * 10, Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], 1e-9);
  eq('profile', 'slot ext', ext(pp({ slot: [0, 0, 40, 5] })), [-20, -5, 20, 5], 1e-9);
  eq('profile', 'slot area', area(pp({ slot: [0, 0, 40, 5] })), 30 * 10 + PI * 25, 0.003);
  const f = pp({ points: [[0, 0], [100, 0], [100, 50], [0, 50]], fillet: 10 });
  eq('profile', 'fillet area', area(f), 5000 - (4 - PI) * 100, 0.002);
  eq('profile', 'fillet ext', ext(f), [0, 0, 100, 50], 1e-9);
  const fArc = f.filter((q) => q[0] > 89.999 && q[1] < 10.001);
  eq('profile', 'fillet on circle', fArc.every((q) => Math.abs(Math.hypot(q[0] - 90, q[1] - 10) - 10) < 1e-9), true);
  const fc = pp({ points: [[0, 0], [20, 0], [20, 20], [0, 20]], fillet: 50 });
  eq('profile', 'fillet clamped = circle', area(fc), PI * 100, 0.003);
  const pc = pp([[0, 0], [10, 0, 5], [10, 10], [0, 10]]);
  eq('profile', 'per-corner fillet', area(pc), 100 - (1 - PI / 4) * 25, 0.003);
  const arc = pp([[-10, 0], { to: [10, 0], via: [0, 10] }]);
  eq('profile', 'arc half disk area', area(arc), PI * 50, 0.003);
  eq('profile', 'arc top', ext(arc)[3], 10, 1e-3);
  const arc2 = pp([[-10, 0], { to: [10, 0], via: [0, -10] }, [10, 20], [-10, 20]]);
  eq('profile', 'arc downward', ext(arc2)[1], -10, 1e-3);
  eq('profile', 'shape type', K.profile({ rect: [1, 2] }).type === 'Shape', true);
  const perr = (s) => { try { K.profilePoints(s, { w: 5 }); return 'ok'; } catch (e) { return e.message; } };
  eq('profile', 'too few', perr([[0, 0], [1, 1]]), 'profile: needs at least 3 distinct points');
  eq('profile', 'zero r', perr({ circle: [0, 0, 0] }), 'profile.circle[2]: must be > 0 (got 0)');
  eq('profile', 'flat', perr([[0, 0], [1, 1], [2, 2]]), 'profile: the outline has no area');
  eq('profile', 'unknown', perr({ star: [1] }), 'profile: unknown profile: use rect, rrect, circle, ngon, slot, points or a list of points');
  eq('profile', 'slot short', perr({ slot: [0, 0, 5, 5] }), 'profile.slot: the length (end to end) must be at least 2 r');
  eq('profile', 'expr in profile', pp({ rect: ['w', 'w/5'] }, { w: 5 }), [[0, 0], [5, 0], [5, 1], [0, 1]]);

  // ---------------------------------------------------------------- arrays, mirror, groups, refs, transforms
  const am = {
    params: { s: 100 },
    parts: [
      { id: 'lin', kind: 'box', size: [10, 10, 10], array: { n: 4, d: ['s', 0, 0] } },
      { id: 'grd', kind: 'box', size: [10, 10, 10], at: [0, 1000, 0], array: { grid: [3, 2], d: [20, 30] } },
      { id: 'rad', kind: 'box', size: [10, 10, 10], at: [100, -5, 0], array: { radial: 4 } },
      { id: 'rad2', kind: 'cyl', r: 1, h: 1, at: [50, 0, 500], array: { radial: 3, angle: 90, center: [0, 0, 500] } },
      { id: 'mir', kind: 'box', size: [10, 20, 30], at: [100, 0, 0], mirror: 'x' },
      { id: 'g', kind: 'group', at: [0, 0, 2000], rot: [0, 0, 90], mat: 'steel', parts: [
        { id: 'g1', kind: 'box', size: [100, 10, 10] },
        { id: 'g2', kind: 'box', size: [10, 10, 10], at: [0, 0, 100], mat: 'wood' }] },
      { id: 'r1', kind: 'ref', of: 'g1', at: [0, 0, 3000] },
      { id: 'rg', kind: 'ref', of: 'g', at: [5000, 0, 0] },
      { id: 'garr', kind: 'group', at: [0, 0, 4000], array: { n: 3, d: [0, 0, 100] }, parts: [{ id: 'ga', kind: 'box', size: [1, 1, 1] }] },
      { id: 'rotx', kind: 'box', size: [100, 50, 20], at: [0, 0, 6000], rot: [90, 0, 90] },
      { id: 'rot2', kind: 'box', size: [100, 50, 20], at: [0, 0, 7000], rot: [0, 90] },
      { id: 'scl', kind: 'box', size: [10, 10, 10], at: [0, 0, 8000], scale: [2, 1, 3] },
      { id: 'hid', kind: 'box', size: [10, 10, 10], hidden: true },
      { id: 'noe', kind: 'box', size: [10, 10, 10], at: [0, 0, 9000], edges: false },
    ]
  };
  B = await K.build(am, {});
  eq('compose', 'no problems', B.problems, []);
  const lin = B.byId.lin;
  eq('compose', 'linear instanced', lin.isInstancedMesh === true && lin.count === 4, true);
  eq('compose', 'linear bbox', flat(partBox(B, 'lin')), [0, 0, 0, 310, 10, 10]);
  const mt = new THREE.Matrix4(), vp = new THREE.Vector3();
  lin.getMatrixAt(2, mt); vp.setFromMatrixPosition(mt);
  eq('compose', 'instance 2 offset', vp.toArray(), [200, 0, 0]);
  eq('compose', 'grid count', B.byId.grd.count, 6);
  eq('compose', 'grid bbox', flat(partBox(B, 'grd')), [0, 1000, 0, 50, 1040, 10]);
  eq('compose', 'radial bbox', flat(partBox(B, 'rad')), [-110, -110, 0, 110, 110, 10], 1e-9);
  eq('compose', 'radial 90 spread', flat(partBox(B, 'rad2')), [-1, -1, 500, 51, 51, 501], 1e-6);
  eq('compose', 'mirror bbox', flat(bboxOf(B.root.children.find((o) => o.userData.mirror === 'x'))), [-110, 0, 0, -100, 20, 30], 1e-9);
  const mirM = K.meshItems(B.root).find((i) => i.mesh.userData.mirror === 'x');
  eq('compose', 'mirror det positive', mirM.matrix.determinant() > 0, true);
  eq('compose', 'mirror geometry outward', (() => { let v = 0; const g = mirM.geometry, p = g.attributes.position, ix = g.index; const n = ix ? ix.count : p.count; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(p, ix ? ix.getX(i) : i); b.fromBufferAttribute(p, ix ? ix.getX(i + 1) : i + 1); c.fromBufferAttribute(p, ix ? ix.getX(i + 2) : i + 2); v += a.dot(b.clone().cross(c)) / 6; } return v; })(), 6000, 1e-9);
  eq('compose', 'mirror partId', B.root.children.find((o) => o.userData.mirror === 'x').userData.partId, 'mir');
  eq('compose', 'group child bbox', flat(partBox(B, 'g1')), [-10, 0, 2000, 0, 100, 2010], 1e-9);
  eq('compose', 'group mat inherited', B.byId.g1.material.name, 'steel');
  eq('compose', 'child mat wins', B.byId.g2.material.name, 'wood');
  eq('compose', 'nested in byId', !!B.byId.g2 && B.byId.g2.parent === B.byId.g, true);
  eq('compose', 'ref shares geometry', B.byId.r1.geometry === B.byId.g1.geometry, true);
  eq('compose', 'ref placed', flat(partBox(B, 'r1')), [0, 0, 3000, 100, 10, 3010]);
  eq('compose', 'ref group children tagged', (() => { const ids = new Set(); B.byId.rg.traverse((o) => { if (o.isMesh) ids.add(o.userData.partId); }); return [...ids]; })(), ['rg']);
  eq('compose', 'ref group bbox', flat(bboxOf(B.byId.rg)), [5000, 0, 0, 5100, 10, 110]);
  eq('compose', 'group array copies', B.byId.garr.children.length, 3);
  eq('compose', 'group array index', B.byId.garr.children.map((c) => c.userData.index), [0, 1, 2]);
  eq('compose', 'group array bbox', flat(bboxOf(B.byId.garr)), [0, 0, 4000, 1, 1, 4201]);
  eq('compose', 'rot X then Y then Z', flat(partBox(B, 'rotx')), [0, 0, 6000, 20, 100, 6050], 1e-9);
  eq('compose', 'rot short list', flat(partBox(B, 'rot2')), [0, 0, 6900, 20, 50, 7000], 1e-9);
  eq('compose', 'scale', flat(partBox(B, 'scl')), [0, 0, 8000, 20, 10, 8030]);
  eq('compose', 'hidden', B.byId.hid.visible, false);
  eq('compose', 'no edges', B.byId.noe.children.length, 0);
  eq('compose', 'instanced edges merged', B.byId.lin.children[0].geometry.attributes.position.count, 24 * 4);
  const TA = {};
  K.takeoff(am, B).forEach((r) => { TA[r.id] = r; });
  eq('compose', 'takeoff array count', TA.lin.count, 4);
  eq('compose', 'takeoff array volume per piece', TA.lin.volume, 1000);
  eq('compose', 'takeoff total', TA.lin.volumeTotal, 4000);
  eq('compose', 'takeoff mirror count', TA.mir.count, 2);
  eq('compose', 'takeoff group child count', TA.ga.count, 3);
  eq('compose', 'takeoff scaled vol', TA.scl.volume, 6000);
  eq('compose', 'takeoff scaled size', TA.scl.size, [20, 10, 30]);
  eq('compose', 'takeoff mat/tag', [TA.g1.mat, TA.g2.mat, TA.lin.mat], ['steel', 'wood', null]);
  eq('compose', 'takeoff ref-group volume', TA.rg.volume, 11000);
  eq('compose', 'takeoff no group rows', !TA.g && !TA.garr, true);
  eq('compose', 'stats instances', B.stats.instances, 4 + 6 + 4 + 3 + 3);

  // ---------------------------------------------------------------- materials
  const mm = { materials: { skin: { color: '#c9b8a0', metal: 0.2, rough: 0.5, opacity: 1 }, al: 'aluminium' }, parts: [] };
  const m1 = K.material('skin', mm), m2 = K.material('skin', mm);
  eq('materials', 'cached', m1 === m2, true);
  eq('materials', 'named color', '#' + m1.color.getHexString(), '#c9b8a0');
  eq('materials', 'named metal', [m1.metalness, m1.roughness], [0.2, 0.5]);
  eq('materials', 'standard', m1.isMeshStandardMaterial === true, true);
  eq('materials', 'preset alias', K.material('al', mm).metalness, 0.85);
  eq('materials', 'glass transparent', [K.material('glass').transparent, K.material('glass').opacity < 1], [true, true]);
  eq('materials', 'inline hex', '#' + K.material('#ff0000').color.getHexString(), '#ff0000');
  eq('materials', 'all presets', Object.keys(K.PRESETS).sort(), ['aluminium', 'black', 'concrete', 'glass', 'plastic', 'rubber', 'stainless', 'steel', 'white', 'wood']);
  eq('materials', 'unknown throws', (() => { try { K.material('gold', mm); return 'no'; } catch (e) { return /unknown material "gold"/.test(e.message); } })(), true);
  B = await K.build({ parts: [{ id: 'a', kind: 'box', size: [1, 1, 1], mat: 'gold' }] }, {});
  eq('materials', 'unknown mat = problem, part kept', [B.problems.length, B.problems[0].path, !!B.byId.a], [1, 'parts[0].mat', true]);

  // ---------------------------------------------------------------- validation
  const bad = {
    units: 'm',
    params: { w: 100, q: 'w+zz' },
    materials: { x: { color: 'red' } },
    parts: [
      { id: 'a', kind: 'box', size: [1, 2] },
      { id: 'a', kind: 'box', size: [1, 1, 1] },
      { id: 'b', kind: 'blob' },
      { id: 'c', kind: 'cyl', r: 'wd', h: 10 },
      { id: 'd', kind: 'extrude', profile: { circle: [0, 0, 0] }, depth: -1 },
      { id: 'e', kind: 'ref', of: 'nope' },
      { id: 'f', kind: 'file', src: 'meshes/missing.stl' },
      { id: 'g', kind: 'box', size: [1, 1, 1], array: { n: 200000, d: [1, 0, 0] } },
      { id: 'h h', kind: 'box', size: [1, 1, 1] },
      { id: 'i', kind: 'group', parts: [{ id: 'i1', kind: 'sphere', r: -1 }, { id: 'i2', kind: 'ref', of: 'i' }] },
      { id: 'j', kind: 'box', size: [1, 1, 1], mirror: 'w', mat: 'gold' },
      { id: 'k', kind: 'extrude', profile: { rect: [10, 10] }, holes: [{ circle: [50, 50, 2] }], depth: 1 },
      { id: 'l', kind: 'mesh', v: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], f: [[0, 1, 5]] },
      { id: 'm', kind: 'box', size: ['1/0', 1, 1] },
    ],
    dims: [{ part: 'zz', axis: 'q' }],
  };
  const VP = K.validate(bad, { 'meshes/other.stl': 'x' });
  const has = (path, re) => VP.some((p) => p.path === path && (!re || re.test(p.msg)));
  [
    ['units', /mm/], ['params.q', /unknown name "zz"/], ['materials.x', /color/], ['parts[0].size', /3 numbers/], ['parts[1].id', /duplicate id "a"/],
    ['parts[2].kind', /unknown kind "blob"/], ['parts[3].r', /unknown name "wd"/], ['parts[4].profile.circle[2]', /> 0/], ['parts[4].depth', /> 0/],
    ['parts[5].of', /no part with id "nope"/], ['parts[6].src', /no file/], ['parts[7].array.n', /<= 100000/], ['parts[8].id', /letters/],
    ['parts[9].parts[0].r', /> 0/], ['parts[9].parts[1].of', /contains/], ['parts[10].mirror', /"x"/], ['parts[10].mat', /unknown material "gold"/],
    ['parts[11].holes[0]', /not inside/], ['parts[12].f[0][2]', /no vertex 5/], ['parts[13].size[0]', /not a finite number/], ['dims[0].part', /no part/], ['dims[0].axis', /"x"/],
  ].forEach(([p, re]) => eq('validate', p, has(p, re), true));
  eq('validate', 'part field', VP.find((p) => p.path === 'parts[3].r').part, 'c');
  eq('validate', 'good model clean', K.validate(kindsModel), []);
  eq('validate', 'example model clean', K.validate({
    title: 'Cassette panel', units: 'mm',
    params: { w: { v: 1200, min: 300, max: 3000, step: 10, label: 'Width' }, h: 2400, t: 3 },
    materials: { skin: { color: '#c9b8a0', metal: 0.2, rough: 0.5, opacity: 1 } },
    parts: [
      { id: 'panel', name: 'Panel', kind: 'extrude', profile: { rrect: ['w', 'h', 20] }, holes: [{ circle: [100, 100, 9] }, { circle: ['w-100', 100, 9] }], depth: 't', mat: 'skin', tag: 'skin' },
      { id: 'rail', kind: 'box', size: [40, 60, 'h'], at: [0, -60, 0], mat: 'aluminium', array: { n: 3, d: ['(w-40)/2', 0, 0] }, tag: 'substructure' }],
    dims: [{ from: [0, 0, 0], to: ['w', 0, 0], offset: 150 }],
    views: [{ id: 'front', name: 'Front', cam: [600, -4000, 1200], target: [600, 0, 1200] }]
  }), []);
  const many = { parts: [] };
  for (let i = 0; i < 2001; i++) many.parts.push({ id: 'p' + i, kind: 'box', size: [1, 1, 1] });
  eq('validate', 'part limit', K.validate(many).some((p) => p.path === 'parts' && /2000/.test(p.msg)), true);
  const inst = { parts: [{ id: 'a', kind: 'box', size: [1, 1, 1], array: { n: 60000, d: [1, 0, 0] } }, { id: 'b', kind: 'box', size: [1, 1, 1], array: { grid: [300, 200], d: [1, 1] } }] };
  eq('validate', 'instance limit', K.validate(inst).some((p) => p.path === 'parts[1].array' && /100000/.test(p.msg)), true);
  eq('validate', 'ref cycle', K.validate({ parts: [{ id: 'A', kind: 'group', parts: [{ id: 'ra', kind: 'ref', of: 'B' }] }, { id: 'B', kind: 'group', parts: [{ id: 'rb', kind: 'ref', of: 'A' }] }] }).some((p) => /contains/.test(p.msg)), true);
  eq('validate', 'not object', K.validate([])[0].path, '');

  // ---------------------------------------------------------------- tolerance
  const tol = {
    params: { w: '100' },
    parts: [
      { id: 'ok1', kind: 'box', size: ['10', '20', '30'], at: ['5'], rot: ['0'] },
      { id: 'bad1', kind: 'cyl', r: 'w/0', h: 1 },
      { id: 'bad2', kind: 'nope' },
      'garbage',
      { id: 'ok2', kind: 'extrude', profile: [[0, 0], [0, 10], [10, 10], [10, 0]], holes: [{ circle: [100, 100, 1] }, { circle: [5, 5, 2] }], depth: 2 },
      { id: 'bad3', kind: 'hull', points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]] },
      { id: 'ok3', kind: 'sphere', r: 'sqrt(w)' },
      { id: 'big', kind: 'box', size: [1, 1, 1], array: { n: 1e6, d: [1, 0, 0] } },
      { id: 'bad4', kind: 'box', size: [1, 1, 1], scale: 0 },
    ]
  };
  B = await K.build(tol, {});
  eq('tolerance', 'built ok parts', Object.keys(B.byId).sort(), ['ok1', 'ok2', 'ok3']);
  eq('tolerance', 'string numbers', flat(partBox(B, 'ok1')), [5, 0, 0, 15, 20, 30]);
  eq('tolerance', 'clockwise + bad hole', K.takeoff(tol, B).find((r) => r.id === 'ok2').volume, (100 - PI * 4) * 2, 0.003);
  eq('tolerance', 'problems by part', ['bad1', 'bad2', null, 'ok2', 'bad3', 'big', 'bad4'].every((id) => B.problems.some((p) => p.part === id)), true);
  eq('tolerance', 'hull flat msg', /flat/.test(B.problems.find((p) => p.part === 'bad3').msg), true);
  eq('tolerance', 'nan msg', B.problems.find((p) => p.part === 'bad1').msg, 'the result is not a finite number');
  B = await K.build(null, {});
  eq('tolerance', 'null model', [B.root.children.length, B.problems.length > 0], [0, true]);
  B = await K.build({ parts: [] }, {});
  eq('tolerance', 'empty model bbox', B.stats.bbox, null);

  // ---------------------------------------------------------------- cache and dispose
  const cm = { params: { a: 10, b: 20 }, parts: [{ id: 'x', kind: 'box', size: ['a', 10, 10] }, { id: 'y', kind: 'box', size: ['b', 10, 10] }, { id: 'z', kind: 'cyl', r: 5, h: 'a' }] };
  const c1 = await K.build(cm, {});
  const c2 = await K.build(cm, { values: { b: 30 } });
  eq('cache', 'one rebuilt', c2.stats.rebuilt, 1);
  eq('cache', 'shared geometry', c2.byId.x.geometry === c1.byId.x.geometry, true);
  eq('cache', 'override applied', flat(partBox(c2, 'y')), [0, 0, 0, 30, 10, 10]);
  eq('cache', 'model unchanged', cm.params.b, 20);
  let disposed = 0;
  c1.byId.y.geometry.addEventListener('dispose', () => disposed++);
  c2.byId.x.geometry.addEventListener('dispose', () => disposed += 100);
  K.dispose(c1);
  eq('cache', 'dispose frees only unshared', disposed, 1);
  const c3 = await K.build(cm, {});
  eq('cache', 'rebuilt after dispose', c3.stats.rebuilt, 1);

  // ---------------------------------------------------------------- exports
  const ex = { parts: [
    { id: 'b', name: 'Base', kind: 'box', size: [100, 50, 20] },
    { id: 'r', name: 'Rods', kind: 'cyl', r: 5, h: 200, at: [10, 10, 20], array: { n: 3, d: [30, 0, 0] } },
    { id: 'm', kind: 'box', size: [10, 10, 10], at: [200, 0, 0], mirror: 'x' },
    { id: 'h', kind: 'box', size: [1000, 1000, 1000], hidden: true }] };
  B = await K.build(ex, {});
  const bb = B.stats.bbox;
  eq('export', 'stats bbox', bb.min.concat(bb.max), [-210, 0, 0, 210, 50, 220], 1e-9);
  const glb = await K.exportGLB(B.root);
  eq('export', 'glb magic', Buffer.from(glb.slice(0, 4)).toString('latin1'), 'glTF');
  const gl = await new THREE.GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  gl.scene.updateMatrixWorld(true);
  const gb = new THREE.Box3().setFromObject(gl.scene, true);
  eq('export', 'glb bbox metres Y-up', gb.min.toArray().concat(gb.max.toArray()), [-0.21, 0, -0.05, 0.21, 0.22, 0], 1e-5);
  const gj = JSON.parse(Buffer.from(glb.slice(20, 20 + new DataView(glb.buffer, glb.byteOffset).getUint32(12, true))).toString('utf8')); const names = gj.nodes.map((n) => n.name);
  eq('export', 'glb names', ['Base', 'Rods #1', 'Rods #3', 'm', 'm (mirror)'].every((n) => names.indexOf(n) >= 0), true);
  eq('export', 'glb no instancing ext', /EXT_mesh_gpu_instancing/.test(Buffer.from(glb).toString('latin1')), false);
  eq('export', 'glb no lines', (() => { let l = 0; gl.scene.traverse((o) => { if (o.isLine) l++; }); return l; })(), 0);
  eq('export', 'scene not mutated', B.byId.r.isInstancedMesh && B.root.children.length === 5, true);
  const stl = K.exportSTL(B.root);
  const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  const expectTris = tris(B.byId.b.geometry) * 3 + tris(B.byId.r.geometry) * 3;
  eq('export', 'stl size', stl.byteLength, 84 + 50 * expectTris);
  const sg = new THREE.STLLoader().parse(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength));
  sg.computeBoundingBox();
  eq('export', 'stl tris', sg.attributes.position.count / 3, expectTris);
  eq('export', 'stl bbox mm Z-up', sg.boundingBox.min.toArray().concat(sg.boundingBox.max.toArray()), [-210, 0, 0, 210, 50, 220], 1e-5);
  const sgv = (() => { let v = 0; const p = sg.attributes.position, a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3(); for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i); b2.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2); v += a.dot(b2.clone().cross(c)) / 6; } return v; })();
  eq('export', 'stl volume (orientation)', sgv, 100000 + 3 * K.takeoff(ex, B).find((r) => r.id === 'r').volume + 2000, 1e-4);
  const obj = K.exportOBJ(B.root);
  const og = new THREE.OBJLoader().parse(obj);
  const ob = new THREE.Box3().setFromObject(og, true);
  eq('export', 'obj reparse bbox', ob.min.toArray().concat(ob.max.toArray()), [-210, 0, 0, 210, 50, 220], 1e-5);
  const ply = K.exportPLY(B.root);
  const pg = new THREE.PLYLoader().parse(ply.buffer.slice(ply.byteOffset, ply.byteOffset + ply.byteLength));
  pg.computeBoundingBox();
  eq('export', 'ply reparse', [pg.index.count / 3, pg.boundingBox.max.z], [expectTris, 220], 1e-6);

  // ---------------------------------------------------------------- import and file parts
  const stlFile = K.exportSTL((await K.build({ parts: [{ id: 'q', kind: 'box', size: [40, 20, 10] }] }, {})).root);
  const im = await K.importMesh('part.stl', stlFile);
  eq('import', 'stl', [im.triangles, im.unit, im.bbox.max], [12, 'mm', [40, 20, 10]]);
  const glbFile = await K.exportGLB((await K.build({ parts: [{ id: 'q', kind: 'box', size: [400, 200, 100], mat: 'wood' }] }, {})).root);
  const ig = await K.importMesh('chair.glb', glbFile);
  eq('import', 'glb back to mm Z-up', ig.bbox.min.concat(ig.bbox.max).concat([ig.unit]), [0, 0, 0, 400, 200, 100, 'm'], 1e-4);
  const dataUrl = (b) => 'data:application/octet-stream;base64,' + Buffer.from(b).toString('base64');
  const fm = { parts: [
    { id: 'f1', kind: 'file', src: 'meshes/chair.glb' },
    { id: 'f2', kind: 'file', src: 'meshes/part.stl', at: [1000, 0, 0], fit: [80, 80, 80] },
    { id: 'f3', kind: 'file', src: 'meshes/part.stl', unit: 'cm', mat: 'steel', at: [2000, 0, 0] },
    { id: 'f4', kind: 'file', src: 'meshes/part.obj', at: [0, 1000, 0] },
    { id: 'f5', kind: 'file', src: 'meshes/bad.glb' }] };
  const files = { 'meshes/chair.glb': dataUrl(glbFile), 'meshes/part.stl': dataUrl(stlFile), 'meshes/part.obj': K.exportOBJ((await K.build({ parts: [{ id: 'q', kind: 'box', size: [1, 2, 3] }] }, {})).root), 'meshes/bad.glb': dataUrl(new Uint8Array([1, 2, 3, 4])) };
  B = await K.build(fm, { files });
  eq('import', 'file glb bbox', flat(bboxOf(B.byId.f1)), [0, 0, 0, 400, 200, 100], 1e-4);
  eq('import', 'file keeps own material', (() => { let n = null; B.byId.f1.traverse((o) => { if (o.isMesh) n = o.material.name; }); return n; })(), 'wood');
  eq('import', 'fit', flat(bboxOf(B.byId.f2)), [1000, 0, 0, 1080, 40, 20], 1e-4);
  eq('import', 'unit cm + mat', flat(bboxOf(B.byId.f3)).concat([(() => { let n; B.byId.f3.traverse((o) => { if (o.isMesh) n = o.material.name; }); return n; })()]), [2000, 0, 0, 2400, 200, 100, 'steel'], 1e-4);
  eq('import', 'obj text', flat(bboxOf(B.byId.f4)), [0, 1000, 0, 1, 1002, 3], 1e-4);
  eq('import', 'bad file problem', B.problems.length === 1 && B.problems[0].part === 'f5', true);
  eq('import', 'file takeoff closed', K.takeoff(fm, B).find((r) => r.id === 'f2').volume, 80 * 40 * 20, 1e-4);
  const draco = (() => {
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] }) + '  ');
    const pad = (4 - (json.length % 4)) % 4, jl = json.length + pad, b = Buffer.alloc(20 + jl, 0x20);
    b.writeUInt32LE(0x46546C67, 0); b.writeUInt32LE(2, 4); b.writeUInt32LE(20 + jl, 8); b.writeUInt32LE(jl, 12); b.writeUInt32LE(0x4E4F534A, 16); json.copy(b, 20);
    return new Uint8Array(b);
  })();
  eq('import', 'draco refused', await K.importMesh('x.glb', draco).then(() => 'loaded', (e) => /Draco/.test(e.message)), true);
  eq('import', 'unknown ext', await K.importMesh('x.fbx', new Uint8Array(4)).then(() => 'loaded', (e) => /unsupported/.test(e.message)), true);

  // ---------------------------------------------------------------- performance
  const big = { params: { w: 100, s: 50 }, parts: [] };
  for (let i = 0; i < 200; i++) {
    const k = i % 4;
    big.parts.push(k === 0 ? { id: 'p' + i, kind: 'box', size: [10 + i, 'w', 10], at: [i * 20, 0, 0], mat: 'steel' }
      : k === 1 ? { id: 'p' + i, kind: 'cyl', r: 5 + (i % 7), h: 100 + i, at: [i * 20, 200, 0] }
        : k === 2 ? { id: 'p' + i, kind: 'extrude', profile: { rrect: [100 + i, 50, 5] }, holes: [{ circle: [20, 25, 5] }], depth: 3, at: [i * 20, 400, 0] }
          : { id: 'p' + i, kind: 'box', size: [10, 10, 10], at: [i * 20, 600, 0], array: { n: 5, d: [0, 0, 's'] } });
  }
  big.parts[3].size = [10, 10, 's'];
  let t0 = Date.now();
  const p1 = await K.build(big, {});
  const cold = Date.now() - t0;
  await K.build(big, { values: { s: 51 } });
  const runs = [];
  let prev = p1;
  for (let i = 0; i < 25; i++) { t0 = process.hrtime.bigint(); const pb = await K.build(big, { values: { s: 52 + i } }); runs.push(Number(process.hrtime.bigint() - t0) / 1e6); if (i === 24) out.perfRebuilt = pb.stats.rebuilt; K.dispose(prev); prev = pb; }
  runs.sort((a, b) => a - b);
  out.perf = { cold, warmMedian: runs[12], parts: p1.stats.parts, problems: p1.problems.length };
  out.total = Date.now() - t00;
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
"""


@unittest.skipUnless(NODE, "node is not on PATH")
class ModelBuildTests(unittest.TestCase):
    out = None

    @classmethod
    def setUpClass(cls):
        fd, path = tempfile.mkstemp(suffix=".js")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(SCRIPT)
            r = subprocess.run([NODE, path, str(BUNDLE), str(BUILD)], capture_output=True, text=True, encoding="utf-8", timeout=300)
        finally:
            os.unlink(path)
        if r.returncode != 0:
            raise AssertionError(r.stderr or r.stdout)
        cls.out = json.loads(r.stdout.strip().splitlines()[-1])

    def check(self, name):
        g = self.out[name]
        self.assertGreater(g["n"], 0)
        self.assertEqual(g["fails"], [], "\n" + "\n".join("%s -> %s, want %s" % tuple(f) for f in g["fails"]))

    def test_node_check(self):
        r = subprocess.run([NODE, "--check", str(BUILD)], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_source_is_ascii(self):
        BUILD.read_bytes().decode("ascii")

    def test_expressions(self):
        self.check("expr")

    def test_params(self):
        self.check("params")

    def test_kinds(self):
        self.check("kinds")

    def test_profiles(self):
        self.check("profile")

    def test_arrays_mirror_groups_refs(self):
        self.check("compose")

    def test_materials(self):
        self.check("materials")

    def test_validate(self):
        self.check("validate")

    def test_tolerance(self):
        self.check("tolerance")

    def test_cache(self):
        self.check("cache")

    def test_exports(self):
        self.check("export")

    def test_import_and_files(self):
        self.check("import")

    def test_performance(self):
        p = self.out["perf"]
        self.assertEqual((p["parts"], p["problems"]), (200, 0))
        self.assertEqual(self.out["perfRebuilt"], 1)
        self.assertLess(p["cold"], 3000, p)
        self.assertLess(p["warmMedian"], 40, p)


if __name__ == "__main__":
    unittest.main()
