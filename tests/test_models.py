"""3D models: model.json checks, a mesh file wrapped into a model, page saves, the stored preview."""

import base64
import json
import os
import struct
import sys
import tempfile
import unittest
import uuid
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, models, render, store  # noqa: E402
from test_types import load_plugin  # noqa: E402

PANEL = {"title": "Cassette panel", "units": "mm",
         "params": {"w": {"v": 1200, "min": 300, "max": 3000, "step": 10, "label": "Width"}, "h": 2400, "t": 3,
                    "half": "w/2"},
         "materials": {"skin": {"color": "#c9b8a0", "metal": 0.2, "rough": 0.5, "opacity": 1}, "alu": "aluminium"},
         "parts": [
             {"id": "panel", "name": "Panel", "kind": "extrude", "profile": {"rrect": ["w", "h", 20]},
              "holes": [{"circle": [100, 100, 9]}, {"circle": ["w-100", 100, 9]}], "depth": "t", "mat": "skin",
              "tag": "skin", "x-note": "kept"},
             {"id": "rail", "kind": "box", "size": [40, 60, "h"], "at": [0, -60, 0], "mat": "aluminium",
              "array": {"n": 3, "d": ["(w-40)/2", 0, 0]}, "tag": "substructure"},
             {"id": "frame", "kind": "group", "at": [0, 0, "h"], "parts": [
                 {"id": "knob", "kind": "lathe", "profile": [[0, 0], [10, 0], {"to": [10, 20], "via": [14, 10]}, [0, 20]]},
                 {"id": "pipe", "kind": "sweep", "profile": {"circle": [0, 0, 5]}, "path": [[0, 0, 0], [0, 0, 100], [50, 0, 150]], "smooth": True},
                 {"id": "bolt", "kind": "cyl", "r": "sqrt(16)", "h": "max(t, 2)*2", "array": {"radial": 6, "axis": "z"}, "mirror": "x"}]},
             {"id": "again", "kind": "ref", "of": "knob", "at": [500, 0, 0]},
             {"id": "foot", "kind": "loft", "sections": [{"profile": {"rect": [40, 40]}, "z": 0}, {"profile": {"ngon": [20, 20, 10, 6]}, "z": 30}]},
             {"id": "tri", "kind": "mesh", "v": [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]], "f": [[0, 1, 2], [0, 1, 3]]},
             {"id": "blob", "kind": "hull", "points": [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]},
             {"id": "plate", "kind": "extrude", "profile": {"points": [[0, 0], [100, 0], [100, 50], [0, 50]], "fillet": 5}, "depth": 2,
              "array": {"grid": [4, 2], "d": [120, 70]}, "mat": "#336699"}],
         "dims": [{"from": [0, 0, 0], "to": ["w", 0, 0], "offset": 150}, {"part": "panel", "axis": "x"}],
         "views": [{"id": "front", "name": "Front", "cam": [600, -4000, 1200], "target": [600, 0, 1200]}]}


def stl_cube(size=10.0) -> bytes:
    """A binary STL of a cube (12 triangles)."""
    s = size
    v = [(0, 0, 0), (s, 0, 0), (s, s, 0), (0, s, 0), (0, 0, s), (s, 0, s), (s, s, s), (0, s, s)]
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4),
             (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    out = bytearray(b"cube".ljust(80, b"\0")) + struct.pack("<I", len(faces))
    for f in faces:
        out += struct.pack("<3f", 0, 0, 0)
        for i in f:
            out += struct.pack("<3f", *v[i])
        out += b"\0\0"
    return bytes(out)


def png(w=2, h=2) -> bytes:
    raw = b"".join(b"\0" + b"\x80\x80\x80" * w for _ in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def png_url(data=None) -> str:
    return "data:image/png;base64," + base64.b64encode(data or png()).decode()


def op(aid, name, **args):
    return api.handle("POST", f"artifacts/{aid}/op", {}, {"op": name, "args": args})


def pub(model=None, **files):
    return store.publish(title="Panel", type="model", files={"model.json": model or PANEL, **files})["id"]


def errors(model, files=None):
    return models.check(model, files)


class ContractTests(unittest.TestCase):
    def test_type_listed_after_design(self):
        self.assertEqual(store.TYPES.index("model"), store.TYPES.index("design") + 1)
        self.assertEqual(store.TYPE_ENTRY["model"], "model.json")

    def test_publish_good_model_and_read(self):
        aid = pub()
        self.assertEqual(store.get_meta(aid)["type"], "model")
        back = json.loads(store.read_file(aid, "model.json"))
        self.assertEqual(back["parts"][0]["x-note"], "kept")  # unknown keys stay
        p = load_plugin()
        r = json.loads(p._read({"id": aid}))
        self.assertEqual((r["type"], r["path"]), ("model", "model.json"))
        self.assertIn("Cassette panel", r["content"])


class ExpressionTests(unittest.TestCase):
    def test_values(self):
        e = models.eval_expr
        self.assertEqual(e("(w-40)/2", {"w": 1240}), 600)
        self.assertEqual(e("-2^2"), -4)
        self.assertEqual(e("2^3^2"), 512)
        self.assertAlmostEqual(e("sin(30)"), 0.5)
        self.assertAlmostEqual(e("cos(60)+tan(45)"), 1.5)
        self.assertAlmostEqual(e("pi"), 3.141592653589793)
        self.assertEqual(e("min(3, 1, 2) + max(4, 5) + abs(-1) + round(2.5) + floor(1.9) + ceil(1.1) + sqrt(9)"), 1 + 5 + 1 + 3 + 1 + 2 + 3)
        self.assertEqual(e(" 1.5e2 + .5 "), 150.5)
        self.assertEqual(e("12"), 12)
        self.assertEqual(e(7), 7)

    def test_syntax(self):
        for bad in ("", "1 +", "(1", "1)", "2 ** 3", "w w", "foo(1)", "sin", "sin(1, 2)", "1 % 2", "a.b", "x" * 201,
                    "__import__('os')", "+1"):
            with self.assertRaises(ValueError, msg=bad):
                models.parse_expr(bad)

    def test_unknown_and_known_names(self):
        self.assertEqual(errors({"params": {"w": 10}, "parts": [{"id": "a", "kind": "sphere", "r": "w/2 + pi"}]}), [])
        e = errors({"params": {"w": 10}, "parts": [{"id": "a", "kind": "sphere", "r": "d/2"}]})
        self.assertEqual(len(e), 1)
        self.assertTrue(e[0].startswith("model.json: parts[0].r: unknown name d"), e)


class ValidationTests(unittest.TestCase):
    def test_example_is_clean(self):
        self.assertEqual(errors(PANEL), [])

    def test_tolerant(self):
        # Numeric strings, missing optional fields, unknown keys, no parts at all.
        self.assertEqual(errors({"parts": [{"id": "b", "kind": "box", "size": ["10", "20", "30"], "foo": 1}]}), [])
        self.assertEqual(errors({}), [])
        self.assertEqual(errors({"title": "x", "parts": []}), [])

    def assertError(self, model, path, words, files=None):
        e = errors(model, files)
        hit = [x for x in e if x.startswith(f"model.json: {path}: ")]
        self.assertTrue(hit, f"{path}: {e}")
        self.assertIn(words, hit[0])

    def test_every_error_class(self):
        box = lambda **kw: {"id": "b", "kind": "box", "size": [1, 1, 1], **kw}  # noqa: E731
        self.assertEqual(errors([]), ["model.json: a model {title, params, materials, parts, …}"])
        self.assertError({"units": "m"}, "units", "mm")
        self.assertError({"parts": {}}, "parts", "a list of parts")
        self.assertError({"parts": [1]}, "parts[0]", "a part")
        self.assertError({"parts": [{"kind": "box", "size": [1, 1, 1]}]}, "parts[0].id", "missing")
        self.assertError({"parts": [box(id="a b")]}, "parts[0].id", "not an id")
        self.assertError({"parts": [box(), {"id": "g", "kind": "group", "parts": [box()]}]}, "parts[1].parts[0].id", "unique")
        self.assertError({"parts": [{"id": "x", "kind": "blob"}]}, "parts[0].kind", "one of box")
        self.assertError({"parts": [{"id": "x", "kind": "box"}]}, "parts[0].size", "missing")
        self.assertError({"parts": [{"id": "x", "kind": "box", "size": [1, 2]}]}, "parts[0].size", "3 numbers")
        self.assertError({"parts": [{"id": "x", "kind": "box", "size": [1, True, 2]}]}, "parts[0].size[1]", "a number")
        self.assertError({"parts": [{"id": "x", "kind": "cyl", "r": 1}]}, "parts[0].h", "missing")
        self.assertError({"parts": [{"id": "x", "kind": "prism", "n": 2, "r": 1, "h": 1}]}, "parts[0].n", "3 sides")
        self.assertError({"parts": [{"id": "x", "kind": "extrude", "depth": 1}]}, "parts[0].profile", "missing")
        self.assertError({"parts": [{"id": "x", "kind": "extrude", "depth": 1, "profile": {"rect": [1]}}]}, "parts[0].profile.rect", "2 numbers")
        self.assertError({"parts": [{"id": "x", "kind": "extrude", "depth": 1, "profile": {"star": [1]}}]}, "parts[0].profile", "a shape")
        self.assertError({"parts": [{"id": "x", "kind": "extrude", "depth": 1, "profile": [[0, 0], [1, 0]]}]}, "parts[0].profile", "at least 3 points")
        self.assertError({"parts": [{"id": "x", "kind": "extrude", "depth": 1, "profile": [{"to": [1, 1], "via": [0, 1]}, [0, 0], [1, 0]]}]},
                         "parts[0].profile[0]", "starts at a point")
        self.assertError({"parts": [{"id": "x", "kind": "extrude", "depth": 1, "profile": [[0, 0], {"to": [1, 1]}]}]}, "parts[0].profile[1].via", "missing")
        self.assertError({"parts": [{"id": "x", "kind": "extrude", "depth": 1, "profile": {"rect": [1, 1]}, "holes": [{"ngon": [0, 0, 1, 2]}]}]},
                         "parts[0].holes[0].ngon[3]", "3 sides")
        self.assertError({"parts": [{"id": "x", "kind": "extrude", "depth": "t+", "profile": {"rect": [1, 1]}}]}, "parts[0].depth", "ends too early")
        self.assertError({"parts": [{"id": "x", "kind": "sweep", "profile": {"circle": [0, 0, 1]}, "path": [[0, 0, 0]]}]}, "parts[0].path", "at least 2")
        self.assertError({"parts": [{"id": "x", "kind": "loft", "sections": [{"profile": {"rect": [1, 1]}, "z": 0}]}]}, "parts[0].sections", "at least 2")
        self.assertError({"parts": [{"id": "x", "kind": "hull", "points": [[0, 0, 0]]}]}, "parts[0].points", "at least 4")
        self.assertError({"parts": [{"id": "x", "kind": "mesh", "v": [[0, 0, 0], [1, 0, 0], [0, 1, 0]], "f": [[0, 1, 3]]}]}, "parts[0].f[0]", "outside v")
        self.assertError({"parts": [{"id": "x", "kind": "mesh", "v": [[0, 0, 0], [1, 0, 0], [0, 1, 0]], "f": [[0, 1, 2]] * 5001}]}, "parts[0].f", "5000 faces")
        self.assertError({"parts": [{"id": "x", "kind": "file"}]}, "parts[0].src", "missing")
        self.assertError({"parts": [{"id": "x", "kind": "file", "src": "meshes/a.fbx"}]}, "parts[0].src", "a mesh file")
        self.assertError({"parts": [{"id": "x", "kind": "file", "src": "meshes/a.glb"}]}, "parts[0].src", "not among", files={"model.json"})
        self.assertError({"parts": [{"id": "x", "kind": "file", "src": "meshes/a.stl", "unit": "km"}]}, "parts[0].unit", '"mm"')
        self.assertError({"parts": [{"id": "x", "kind": "group"}]}, "parts[0].parts", "missing")
        self.assertError({"parts": [{"id": "x", "kind": "ref", "of": "nope"}]}, "parts[0].of", "no part 'nope'")
        self.assertError({"parts": [{"id": "g", "kind": "group", "parts": [{"id": "r", "kind": "ref", "of": "g"}]}]}, "parts[0]", "refers to itself")
        self.assertError({"parts": [box(mat="gold")]}, "parts[0].mat", "a preset")
        self.assertError({"parts": [box(mirror="w")]}, "parts[0].mirror", '"x"')
        self.assertError({"parts": [box(at=[0, 0])]}, "parts[0].at", "3 numbers")
        self.assertError({"parts": [box(array={"n": 2, "grid": [1, 1]})]}, "parts[0].array", "one of")
        self.assertError({"parts": [box(array={"n": 0, "d": [1, 0, 0]})]}, "parts[0].array.n", "at least 1")
        self.assertError({"parts": [box(array={"n": 2.5, "d": [1, 0, 0]})]}, "parts[0].array.n", "whole number")
        self.assertError({"parts": [box(array={"n": 2})]}, "parts[0].array.d", "missing")
        self.assertError({"parts": [box(array={"radial": 4, "axis": "w"})]}, "parts[0].array.axis", '"x"')
        self.assertError({"params": {"W": 1}}, "params.W", "lowercase")
        self.assertError({"params": {"pi": 1}}, "params.pi", "built-in")
        self.assertError({"params": {"w": {"min": 1}}}, "params.w", "missing v")
        self.assertError({"params": {"w": [1]}}, "params.w", "a number or an expression")
        self.assertError({"params": {"a": "b+1", "b": "a*2"}}, "params.a", "depends on itself")
        self.assertError({"params": {"a": "zz"}}, "params.a", "unknown name zz")
        self.assertError({"materials": {"m": {"color": "red"}}}, "materials.m.color", "#rrggbb")
        self.assertError({"materials": {"m": {"metal": 2}}}, "materials.m.metal", "from 0 to 1")
        self.assertError({"materials": {"m": "gold"}}, "materials.m", "a preset")
        self.assertError({"dims": [{"part": "nope", "axis": "x"}]}, "dims[0].part", "no part")
        self.assertError({"dims": [{"from": [0, 0, 0]}]}, "dims[0].to", "missing")
        self.assertError({"views": [{"id": "v", "cam": [0, 0, 0]}]}, "views[0].target", "missing")

    def test_params_in_any_order_resolve(self):
        c = models._Check({"params": {"b": "a*2", "a": 5}, "parts": [
            {"id": "x", "kind": "box", "size": [1, 1, 1], "array": {"n": "b", "d": [1, 0, 0]}}]}, None)
        self.assertEqual(c.run(), [])
        self.assertEqual(c.values["b"], 10)
        self.assertEqual(c.instances, 10)

    def test_limits(self):
        many = {"parts": [{"id": f"p{i}", "kind": "sphere", "r": 1} for i in range(models.MAX_PARTS + 1)]}
        self.assertTrue(any("at most 2000" in x for x in errors(many)))
        self.assertEqual(errors({"parts": [{"id": f"p{i}", "kind": "sphere", "r": 1} for i in range(models.MAX_PARTS)]}), [])
        big = {"params": {"n": 400}, "parts": [{"id": "g", "kind": "group", "array": {"grid": ["n", 300], "d": [1, 1]},
                                                "parts": [{"id": "s", "kind": "sphere", "r": 1}]}]}
        self.assertTrue(any("instances" in x and "100000" in x for x in errors(big)), errors(big))
        ok = {"parts": [{"id": "s", "kind": "sphere", "r": 1, "array": {"grid": [100, 1000], "d": [1, 1]}}]}
        self.assertEqual(errors(ok), [])
        self.assertTrue(any("instances" in x for x in errors({"parts": [
            {"id": "s", "kind": "sphere", "r": 1, "array": {"grid": [100, 1000], "d": [1, 1]}, "mirror": "x"}]})))

    def test_publish_refuses_with_paths(self):
        with self.assertRaises(ValueError) as cm:
            pub({"parts": [{"id": "x", "kind": "extrude", "profile": {"rect": [1, 1]}, "depth": "t"}]})
        self.assertIn("model.json: parts[0].depth: unknown name t", str(cm.exception))
        with self.assertRaises(ValueError) as cm:
            store.publish(title="x", type="model", files={"model.json": "{nope"})
        self.assertIn("model.json is not valid JSON", str(cm.exception))
        with self.assertRaises(ValueError) as cm:
            store.publish(title="x", type="model", files={"model.json": {"title": "x" * (models.MAX_JSON_BYTES + 1)}})
        self.assertIn("at most 1024 KB", str(cm.exception))
        with self.assertRaises(ValueError) as cm:  # several problems at once
            pub({"units": "in", "parts": [{"id": "a", "kind": "box"}, {"id": "a", "kind": "sphere", "r": 1}]})
        self.assertEqual(str(cm.exception).count("model.json: "), 3)
        with self.assertRaises(ValueError) as cm:  # an artifact needs its entry file
            store.publish(title="x", type="model", files={"meshes/a.stl": {"base64": base64.b64encode(stl_cube()).decode()}})
        self.assertIn("needs model.json", str(cm.exception))

    def test_publish_files_with_a_mesh(self):
        mesh = {"base64": base64.b64encode(stl_cube()).decode()}
        aid = pub({"parts": [{"id": "c", "kind": "file", "src": "meshes/cube.stl", "fit": [100, 100, 100]}]}, **{"meshes/cube.stl": mesh})
        self.assertEqual(store.read_file(aid, "meshes/cube.stl"), stl_cube())
        with self.assertRaises(ValueError) as cm:
            pub({"parts": [{"id": "c", "kind": "file", "src": "meshes/gone.stl"}]}, **{"meshes/cube.stl": mesh})
        self.assertIn("parts[0].src: 'meshes/gone.stl' is not among", str(cm.exception))
        draco = json.dumps({"asset": {"version": "2.0"}, "extensionsRequired": ["KHR_draco_mesh_compression"]})
        with self.assertRaises(ValueError) as cm:
            pub({"parts": [{"id": "c", "kind": "file", "src": "meshes/d.gltf"}]}, **{"meshes/d.gltf": draco})
        self.assertIn("Draco", str(cm.exception))
        two = json.dumps({"asset": {"version": "2.0"}, "buffers": [{"uri": "d.bin", "byteLength": 4}]})
        with self.assertRaises(ValueError) as cm:
            pub({"parts": [{"id": "c", "kind": "file", "src": "meshes/t.gltf"}]}, **{"meshes/t.gltf": two})
        self.assertIn("single file", str(cm.exception))
        old = models.MAX_MESH_BYTES
        models.MAX_MESH_BYTES = 100
        try:
            with self.assertRaises(ValueError) as cm:
                pub({"parts": [{"id": "c", "kind": "file", "src": "meshes/cube.stl"}]}, **{"meshes/cube.stl": mesh})
            self.assertIn("meshes/cube.stl: a mesh file of at most", str(cm.exception))
        finally:
            models.MAX_MESH_BYTES = old


class MeshPathTests(unittest.TestCase):
    def test_stl_path_becomes_a_model(self):
        d = Path(tempfile.mkdtemp())
        (d / "Wall bracket.stl").write_bytes(stl_cube())
        meta = store.publish(path=str(d / "Wall bracket.stl"), type="model")
        aid = meta["id"]
        self.assertEqual(meta["title"], "Wall bracket")
        self.assertEqual(store.list_files(aid), ["meshes/Wall-bracket.stl", "model.json"])
        self.assertEqual(store.read_file(aid, "meshes/Wall-bracket.stl"), stl_cube())
        model = json.loads(store.read_file(aid, "model.json"))
        self.assertEqual(model["title"], "Wall bracket")
        self.assertEqual(model["parts"], [{"id": "Wall-bracket", "name": "Wall bracket", "kind": "file", "src": "meshes/Wall-bracket.stl"}])
        # Another mesh on top of the last version: a second file part, the first one stays.
        store.publish(path=str(d / "Wall bracket.stl"), aid=aid, base=True)
        model = json.loads(store.read_file(aid, "model.json"))
        self.assertEqual([p["src"] for p in model["parts"]], ["meshes/Wall-bracket.stl", "meshes/Wall-bracket-2.stl"])
        self.assertEqual(len({p["id"] for p in model["parts"]}), 2)
        self.assertEqual(json.loads(store.read_file(aid, "model.json", 1))["parts"][0]["src"], "meshes/Wall-bracket.stl")

    def test_other_files_refused(self):
        d = Path(tempfile.mkdtemp())
        (d / "x.fbx").write_bytes(b"\0" * 10)
        with self.assertRaises(ValueError) as cm:
            store.publish(path=str(d / "x.fbx"), type="model")
        self.assertIn("mesh file", str(cm.exception))
        (d / "bad.glb").write_bytes(b"nope")
        with self.assertRaises(ValueError) as cm:
            store.publish(path=str(d / "bad.glb"), type="model")
        self.assertIn("not a binary glTF", str(cm.exception))
        (d / "model.json").write_text(json.dumps(PANEL), encoding="utf-8")
        aid = store.publish(path=str(d / "model.json"), type="model", title="J")["id"]  # a model.json file as is
        self.assertEqual(json.loads(store.read_file(aid, "model.json"))["title"], "Cassette panel")


class SaveTests(unittest.TestCase):
    def test_page_saves(self):
        aid = pub()
        m2 = dict(PANEL, title="Moved")
        r = op(aid, "save", files={"model.json": json.dumps(m2)}, base_version=1)
        self.assertEqual(r, {"ok": True, "version": 2})
        self.assertEqual(store.get_meta(aid)["versions"][-1]["by"], "user")
        url = "data:application/octet-stream;base64," + base64.b64encode(stl_cube()).decode()
        m3 = dict(PANEL, parts=PANEL["parts"] + [{"id": "cube", "kind": "file", "src": "meshes/cube.stl"}])
        r = op(aid, "save", files={"meshes/cube.stl": url, "model.json": json.dumps(m3)}, base_version=2)
        self.assertTrue(r["ok"], r)
        self.assertEqual(store.read_file(aid, "meshes/cube.stl"), stl_cube())
        odd = "data:model/stl;foo=bar;base64," + base64.b64encode(stl_cube(3)).decode()  # any type
        self.assertTrue(op(aid, "save", files={"meshes/c2.stl": odd})["ok"])
        # conflict: an older base
        self.assertEqual(op(aid, "save", files={"model.json": json.dumps(PANEL)}, base_version=1),
                         {"ok": False, "conflict": True, "version": 4})

    def test_page_saves_refused(self):
        aid = pub()
        n = len(store.get_meta(aid)["versions"])
        for files, words in (
                ({"model.json": json.dumps({"parts": [{"id": "a", "kind": "box"}]})}, "model.json: parts[0].size: missing"),
                ({"model.json": json.dumps(dict(PANEL, parts=[{"id": "f", "kind": "file", "src": "meshes/x.glb"}]))}, "not among"),
                ({"meshes/x.stl": "not a data url"}, "a mesh file"),
                ({"meshes/../x.stl": "data:a;base64,AAAA"}, "can't save"),
                ({"meshes/x.exe": "data:a;base64,AAAA"}, "can't save"),
                ({"other.json": "{}"}, "can't save")):
            with self.assertRaises(api.ApiError, msg=files) as cm:
                op(aid, "save", files=files)
            self.assertEqual(cm.exception.status, 400)
            self.assertIn(words, cm.exception.detail)
        old = models.MAX_MESH_BYTES
        models.MAX_MESH_BYTES = 100
        try:
            with self.assertRaises(api.ApiError) as cm:
                op(aid, "save", files={"meshes/c.stl": "data:x;base64," + base64.b64encode(stl_cube()).decode()})
            self.assertIn("at most 12 MB", cm.exception.detail)
        finally:
            models.MAX_MESH_BYTES = old
        self.assertEqual(len(store.get_meta(aid)["versions"]), n)  # nothing stored


class PreviewTests(unittest.TestCase):
    def test_set_get_list(self):
        aid = pub()
        view = lambda: next(a for a in api.handle("GET", "artifacts", {}, None)["artifacts"] if a["id"] == aid)  # noqa: E731
        self.assertNotIn("preview", view())
        with self.assertRaises(api.ApiError):
            api.handle("GET", f"artifacts/{aid}/preview", {}, None)
        updated = store.get_meta(aid)["updated"]
        self.assertEqual(op(aid, "preview.set", data=png_url()), {"ok": True, "version": 1})
        meta = store.get_meta(aid)
        self.assertEqual(len(meta["versions"]), 1)  # no version, not an edit
        self.assertEqual(meta["updated"], updated)
        self.assertEqual(store.list_files(aid), ["model.json"])  # not an artifact file
        self.assertTrue(view()["preview"])
        self.assertTrue(api.handle("GET", f"artifacts/{aid}", {}, None)["preview"])
        got = api.handle("GET", f"artifacts/{aid}/preview", {}, None)
        self.assertEqual((got["version"], got["data"]), (1, png_url()))
        # A newer version has no picture yet; one the page drew of an older version is not kept.
        op(aid, "save", files={"model.json": json.dumps(dict(PANEL, title="B"))})
        self.assertNotIn("preview", view())
        self.assertEqual(op(aid, "preview.set", data=png_url(), version=1), {"ok": False, "stale": True})
        self.assertNotIn("preview", view())
        self.assertEqual(op(aid, "preview.set", data=png_url(png(3, 3)), version=2)["version"], 2)
        self.assertEqual(api.handle("GET", f"artifacts/{aid}/preview", {"v": "1"}, None)["data"], png_url())

    def test_pruned_and_refused(self):
        aid = pub()
        for i in range(5):
            op(aid, "preview.set", data=png_url())
            op(aid, "save", files={"model.json": json.dumps(dict(PANEL, title=f"t{i}"))})
        op(aid, "preview.set", data=png_url())
        kept = sorted(p.name for p in (store.root() / aid / "previews").iterdir())
        self.assertEqual(kept, ["v4.png", "v5.png", "v6.png"])
        for bad in ("data:image/jpeg;base64,AAAA", "nope", "data:image/png;base64," + base64.b64encode(b"GIF89a").decode(),
                    png_url(png() + b"\0" * (store.MAX_PREVIEW_BYTES + 10))):
            with self.assertRaises(api.ApiError) as cm:
                op(aid, "preview.set", data=bad)
            self.assertIn("PNG", cm.exception.detail)

    def test_any_type_may_store_one(self):
        aid = store.publish(title="P", html="<p>x</p>")["id"]
        self.assertTrue(op(aid, "preview.set", data=png_url())["ok"])
        self.assertTrue(api._view(store.get_meta(aid))["preview"])

    @unittest.skipUnless((render.TYPES_DIR / "model" / "runtime.html").is_file(), "the model page is not there yet")
    def test_render_carries_the_preview(self):
        mesh = {"base64": base64.b64encode(stl_cube()).decode()}
        aid = pub({"title": "Cube", "parts": [{"id": "c", "kind": "file", "src": "meshes/cube.stl"}]}, **{"meshes/cube.stl": mesh})

        def content(thumb):
            html = render.render(store.get_meta(aid), store.version_dir(aid), thumb=thumb)
            start = html.index('id="hermes-artifact-content">') + len('id="hermes-artifact-content">')
            return json.loads(html[start:html.index("</script>", start)])
        self.assertNotIn("preview", content(False))
        op(aid, "preview.set", data=png_url())
        full, thumb = content(False), content(True)
        self.assertEqual(full["preview"], png_url())
        self.assertEqual(thumb["preview"], png_url())
        self.assertIn("meshes/cube.stl", full["files"])
        self.assertEqual(sorted(thumb["files"]), ["model.json"])  # a card draws no 3D


class AgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def test_tool_description(self):
        pub_tool = next(t[1] for t in self.p.TOOLS if t[0] == "ha_publish")
        first = pub_tool["description"].split(". ")[0] + "."
        self.assertEqual(first, "Make artifacts, not files: docs, sheets, decks, boards, dashboards, designs, 3D.")
        self.assertLessEqual(len(first), 80)
        self.assertIn("a 3D model, part, assembly -> model", pub_tool["description"])
        self.assertIn("model", pub_tool["parameters"]["properties"]["type"]["enum"])
        self.assertNotIn("model", self.p.DS_TYPES)

    def test_guide_and_making(self):
        s = "s-" + uuid.uuid4().hex[:12]
        out = json.loads(self.p._guide({"type": "model"}, session_id=s))
        self.assertTrue(out["ok"])
        self.assertIn("model.json", out["guide"])
        self.assertNotIn("design_system", out)
        st = self.p.store.making_get(s)
        self.assertEqual((st["type"], st["phase"]), ("model", "guide"))
        r = json.loads(self.p._publish({"type": "model", "title": "Box", "open": False,
                                        "files": {"model.json": {"parts": [{"id": "b", "kind": "box", "size": [1, 2, 3]}]}}},
                                       session_id=s))
        self.assertTrue(r["ok"], r)
        self.assertIsNone(self.p.store.making_get(s))
        bad = json.loads(self.p._publish({"type": "model", "title": "Bad", "open": False,
                                          "files": {"model.json": {"parts": [{"id": "b", "kind": "box"}]}}}))
        self.assertFalse(bad["ok"])
        self.assertIn("model.json: parts[0].size: missing", bad["error"])


if __name__ == "__main__":
    unittest.main()
