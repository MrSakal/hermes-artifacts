"""Host paths the agent names stay in the chat's working directory (ha_publish path=,
ha_design_system_export dir=): never Hermes' home, a hidden file or folder, or through a symlink out of it.
node, which computes sheets, starts with a few variables, none of Hermes' keys."""

import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import calc, store  # noqa: E402

EXAMPLE_DS = ROOT / "examples" / "design-system"


def load_plugin():
    spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", PLUGIN / "__init__.py",
                                                  submodule_search_locations=[str(PLUGIN)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules["hermes_artifacts_plugin"] = mod
    spec.loader.exec_module(mod)
    return mod


def link(target: Path, at: Path) -> bool:
    """A symlink to ``target`` at ``at`` (a junction for a folder on Windows without symlink rights)."""
    try:
        os.symlink(target, at, target_is_directory=target.is_dir())
        return True
    except (OSError, NotImplementedError):
        pass
    if os.name == "nt" and target.is_dir():
        import _winapi
        try:
            _winapi.CreateJunction(str(target), str(at))
            return True
        except OSError:
            pass
    return False


class _Work(unittest.TestCase):
    def setUp(self):
        self.p = load_plugin()
        self.work = Path(tempfile.mkdtemp(prefix="work-"))      # the chat's working directory
        self.outside = Path(tempfile.mkdtemp(prefix="outside-"))
        self.p._ctx = types.SimpleNamespace(session_cwd=lambda: str(self.work))

    def tearDown(self):
        self.p._ctx = None
        shutil.rmtree(self.work, ignore_errors=True)
        shutil.rmtree(self.outside, ignore_errors=True)

    def publish(self, path, **extra):
        return json.loads(self.p._publish({"path": str(path), "title": "t", "open": False, **extra}))

    def refused(self, r, why):
        self.assertFalse(r["ok"], r)
        self.assertEqual(r.get("code"), "path_refused")
        self.assertIn(why, r["error"])
        self.assertIn("Next: ", r["error"])


class ConfineTests(_Work):
    def test_inside_the_working_directory(self):
        (self.work / "page.html").write_text("<p>in</p>", "utf-8")
        self.assertEqual(store.confine("page.html", self.work), (self.work / "page.html").resolve())
        r = self.publish("page.html")  # relative to the working directory, not the process's
        self.assertTrue(r["ok"], r)
        self.assertEqual(store.read_file(r["id"], "index.html"), b"<p>in</p>")

    def test_outside_is_refused_and_nothing_is_copied(self):
        secret = self.outside / "secret.html"
        secret.write_text("<p>secret</p>", "utf-8")
        before = {m["id"] for m in store.list_all()}
        for path in (secret, self.work / ".." / self.outside.name / "secret.html"):
            r = self.publish(path)
            self.refused(r, "outside the working directory")
            self.assertTrue(r["error"].startswith("nothing was copied"))
        self.assertEqual({m["id"] for m in store.list_all()}, before)

    def test_hidden_files_and_folders_are_refused(self):
        (self.work / ".ssh").mkdir()
        (self.work / ".ssh" / "id.html").write_text("k", "utf-8")
        (self.work / ".env").write_text("K=1", "utf-8")
        self.refused(self.publish(self.work / ".ssh" / "id.html"), "hidden")
        self.refused(self.publish(".env"), "hidden")
        self.refused(self.publish(".ssh"), "hidden")

    def test_hermes_home_is_refused(self):
        home = self.work / "hermes-home"
        (home / "plugin-data").mkdir(parents=True)
        (home / "auth.html").write_text("token", "utf-8")
        with mock.patch.object(self.p.store, "hermes_home", lambda: home):
            self.refused(self.publish(home / "auth.html"), "Hermes' own data")
            self.refused(self.publish(home), "Hermes' own data")
        self.refused(self.publish(store.root()), "Hermes' own data")  # the plugin's data

    def test_no_working_directory_allows_nothing(self):
        (self.work / "p.html").write_text("x", "utf-8")
        self.p._ctx = types.SimpleNamespace(session_cwd=lambda: "")
        self.refused(self.publish(self.work / "p.html"), "no working directory")
        with self.assertRaises(store.PathRefused):
            store.confine(self.work, Path(self.work.anchor))  # a drive root confines nothing

    def test_a_symlink_out_is_refused(self):
        (self.outside / "secret.html").write_text("<p>secret</p>", "utf-8")
        if not link(self.outside, self.work / "out"):
            self.skipTest("no symlinks or junctions here")
        self.refused(self.publish(self.work / "out" / "secret.html"), "outside the working directory")
        self.refused(self.publish(self.work / "out"), "outside the working directory")

    def test_a_folder_copies_no_hidden_entry_and_follows_no_link(self):
        site = self.work / "site"
        (site / ".git").mkdir(parents=True)
        (site / ".git" / "config").write_text("secret", "utf-8")
        (site / ".env").write_text("K=1", "utf-8")
        (site / "index.html").write_text("<p>site</p>", "utf-8")
        (self.outside / "secret.txt").write_text("secret", "utf-8")
        linked = link(self.outside, site / "out")
        r = self.publish(site)
        self.assertTrue(r["ok"], r)
        self.assertEqual(store.list_files(r["id"]), ["index.html"])
        if linked:
            self.assertFalse(any(e.is_symlink() for e in store.version_dir(r["id"]).rglob("*")))

    def test_the_cli_publishes_the_path_its_user_typed(self):
        (self.outside / "mine.html").write_text("<p>mine</p>", "utf-8")
        r = json.loads(self.p._publish({"path": str(self.outside / "mine.html"), "open": False}, trusted=True))
        self.assertTrue(r["ok"], r)


class ExportTests(_Work):
    def setUp(self):
        super().setUp()
        self.ds = store.publish(path=str(EXAMPLE_DS), title="Kiln", type="design-system")["id"]

    def export(self, d, **extra):
        return json.loads(self.p._ds_export({"id": self.ds, "dir": str(d), **extra}))

    def test_into_the_working_directory(self):
        r = self.export("design-system")
        self.assertTrue(r["ok"], r)
        self.assertTrue((self.work / "design-system" / "tokens.css").is_file())

    def test_outside_hidden_and_hermes_home_are_refused(self):
        (self.outside / "keep.txt").write_text("keep", "utf-8")
        for d, why in ((self.outside, "outside the working directory"),
                       (Path.home() / ".ssh", "outside the working directory"),
                       (self.work / ".ssh", "hidden"), (self.work / ".config" / "app", "hidden")):
            r = self.export(d, overwrite=True)
            self.refused(r, why)
            self.assertTrue(r["error"].startswith("nothing was written"))
        self.assertEqual(sorted(x.name for x in self.outside.iterdir()), ["keep.txt"])  # overwrite changed nothing
        self.assertFalse((self.work / ".ssh").exists())
        home = self.work / "hh"
        home.mkdir()
        with mock.patch.object(self.p.store, "hermes_home", lambda: home):
            self.refused(self.export(home / "skins", overwrite=True), "Hermes' own data")
        self.assertFalse((home / "skins").exists())

    def test_overwrite_never_writes_through_a_symlink_out(self):
        dest = self.work / "ds"
        dest.mkdir()
        if not link(self.outside, dest / "components"):
            self.skipTest("no symlinks or junctions here")
        r = self.export(dest, overwrite=True)
        self.assertTrue(r["ok"], r)
        self.assertFalse(any(f.startswith("components/") for f in r["files"]))
        self.assertEqual(list(self.outside.iterdir()), [])
        self.assertTrue((dest / "tokens.css").is_file())
        self.refused(self.export(dest / "components", overwrite=True), "outside the working directory")


class ChildEnvTests(unittest.TestCase):
    def test_node_gets_only_the_few_variables_it_needs(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test", "HERMES_SECRET": "x", "NODE_OPTIONS": "--inspect",
                                          "PATH": os.environ.get("PATH", "/bin")}):
            env = calc.child_env()
        self.assertEqual(env.get("PATH"), os.environ.get("PATH", "/bin"))
        allowed = {"PATH", "HOME", "LANG", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE"}
        self.assertLessEqual(set(env), allowed)
        for k in ("OPENAI_API_KEY", "HERMES_SECRET", "NODE_OPTIONS"):
            self.assertNotIn(k, env)

    def test_run_starts_node_with_that_env(self):
        with mock.patch.object(calc, "node_path", return_value="node"), \
                mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-test"}), \
                mock.patch.object(calc.subprocess, "Popen", side_effect=OSError("stop")) as popen:
            self.assertIsNone(calc.run([{"name": "S", "cells": {}, "charts": []}]))
        env = popen.call_args.kwargs["env"]
        self.assertNotIn("ANTHROPIC_API_KEY", env)
        self.assertEqual(env, calc.child_env())

    @unittest.skipUnless(shutil.which("node"), "node is not on PATH")
    def test_node_still_computes_with_it(self):
        calc._node.update(path=None, at=None)
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
            res = calc.run([{"name": "S", "cells": {"A1": 2, "A2": "=A1*21"}, "charts": []}])
        self.assertIsNotNone(res)
        self.assertEqual(res[0].get("A2"), 42)


if __name__ == "__main__":
    unittest.main()
