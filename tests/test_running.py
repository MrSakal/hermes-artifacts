"""Which code the server runs against what is installed (hermes_artifacts/running.py): the version
constants agree across the four places a bump touches, each process records what it loaded at
register() with its role, gone processes, stale records and garbage files are dropped, GET /artifacts
reports {loaded, disk, stale, processes}, and ha_publish adds a role-aware note only while this process
runs other code than the files on disk."""

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, running, store  # noqa: E402
from test_types import load_plugin  # noqa: E402


def yaml_with(version: str) -> Path:
    d = Path(tempfile.mkdtemp(prefix="ha-yaml-"))
    p = d / "plugin.yaml"
    p.write_text(f"name: hermes-artifacts\nversion: {version}\ndescription: x\n", "utf-8")
    return p


class _DiskAt:
    """plugin.yaml says ``version`` while the block runs (in the given copy of the module)."""

    def __init__(self, mod, version):
        self.mod, self.path = mod, yaml_with(version)

    def __enter__(self):
        self.old, self.mod._YAML = self.mod._YAML, self.path

    def __exit__(self, *exc):
        self.mod._YAML = self.old


class _Argv:
    def __init__(self, *argv):
        self.argv = list(argv)

    def __enter__(self):
        self.old, sys.argv = sys.argv, self.argv

    def __exit__(self, *exc):
        sys.argv = self.old


def sleeper():
    return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])


class VersionsInSyncTests(unittest.TestCase):
    def test_four_places_say_the_same_version(self):
        yaml_v = re.search(r"^version:\s*(\S+)\s*$", (PLUGIN / "plugin.yaml").read_text("utf-8"), re.M).group(1)
        manifest_v = json.loads((PLUGIN / "dashboard" / "manifest.json").read_text("utf-8"))["version"]
        js_v = re.search(r"^const PLUGIN_VERSION = '([^']+)'$", (PLUGIN / "desktop" / "plugin.js").read_text("utf-8"), re.M).group(1)
        self.assertEqual({"yaml": yaml_v, "manifest": manifest_v, "python": running.VERSION, "js": js_v},
                         dict.fromkeys(("yaml", "manifest", "python", "js"), yaml_v))

    def test_disk_version_reads_the_installed_yaml(self):
        self.assertEqual(running.disk_version(), running.VERSION)
        with _DiskAt(running, "0.99.0"):
            self.assertEqual(running.disk_version(), "0.99.0")
        with _DiskAt(running, "0.99.0"):
            running._YAML = Path(tempfile.mkdtemp()) / "missing.yaml"
            self.assertIsNone(running.disk_version())

    def test_version_order_is_numeric(self):
        self.assertLess(running.version_key("0.9.2"), running.version_key("0.16.1"))

    def test_no_process_inspection_the_scanner_flags(self):
        src = (PLUGIN / "hermes_artifacts" / "running.py").read_text("utf-8")
        self.assertIsNone(re.search(r"/proc/self|/proc/\d+/|/proc/\{", src))


class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="ha-run-"))
        self.run = self.base / ".run"

    def put(self, pid, version, role="serve", at=None, name=None):
        self.run.mkdir(exist_ok=True)
        (self.run / (name or f"loaded-{pid}.json")).write_text(json.dumps(
            {"version": version, "pid": pid, "at": int(time.time()) if at is None else at, "role": role}), "utf-8")

    def test_record_writes_this_process(self):
        with _Argv("/usr/bin/hermes", "serve", "--port", "9119"):
            running.record(self.base)
        r = json.loads((self.run / f"loaded-{os.getpid()}.json").read_text("utf-8"))
        self.assertEqual((r["version"], r["pid"], r["role"]), (running.VERSION, os.getpid(), "serve"))
        self.assertEqual(set(r), {"version", "pid", "at", "role"})
        self.assertFalse(list(self.run.glob(".loaded-*.tmp")))  # replaced, not left behind
        self.assertEqual(running.status(self.base), {"loaded": running.VERSION, "disk": running.VERSION, "stale": False,
                                                     "processes": [{"role": "serve", "version": running.VERSION}]})

    def test_stale_when_the_files_moved_on(self):
        with _Argv("/usr/bin/hermes", "gateway", "run"):
            running.record(self.base)
        with _DiskAt(running, "0.99.0"):
            self.assertEqual(running.status(self.base), {"loaded": running.VERSION, "disk": "0.99.0", "stale": True,
                                                         "processes": [{"role": "gateway", "version": running.VERSION}]})

    def test_nothing_recorded(self):
        self.assertEqual(running.status(self.base), {"loaded": None, "disk": running.VERSION, "stale": False, "processes": []})

    def test_gone_pid_is_dropped(self):
        p = subprocess.Popen([sys.executable, "-c", "pass"])
        p.wait()
        self.put(p.pid, "0.1.0")
        self.assertEqual(running.status(self.base)["loaded"], None)
        self.assertFalse((self.run / f"loaded-{p.pid}.json").exists())

    def test_a_record_not_rewritten_for_a_week_is_dropped(self):
        """A pid reused by another program would look alive: the age bound ends that."""
        self.put(os.getpid(), "0.1.0", at=int(time.time()) - running.MAX_AGE - 60)
        self.assertEqual(running.status(self.base)["processes"], [])
        self.assertFalse((self.run / f"loaded-{os.getpid()}.json").exists())

    def test_touch_rewrites_at_most_every_few_minutes(self):
        running.record(self.base)
        f = self.run / f"loaded-{os.getpid()}.json"
        first = json.loads(f.read_text("utf-8"))["at"]
        old = dict(running._written)
        try:
            running._written["at"] = time.time() - 10
            self.put(os.getpid(), running.VERSION, role="cli", at=first - 1000)
            running.touch()  # too soon: nothing written
            self.assertEqual(json.loads(f.read_text("utf-8"))["at"], first - 1000)
            running._written["at"] = time.time() - running.REFRESH - 1
            running.touch()
            self.assertGreaterEqual(json.loads(f.read_text("utf-8"))["at"], first)
        finally:
            running._written.update(old)

    def test_garbage_is_dropped_and_other_files_kept(self):
        self.run.mkdir()
        now = int(time.time())
        (self.run / "loaded-1.json").write_text("{not json", "utf-8")
        (self.run / "loaded-2.json").write_text(json.dumps(["a"]), "utf-8")
        (self.run / "loaded-3.json").write_text(json.dumps({"version": "x y", "pid": 3, "at": now, "role": "cli"}), "utf-8")
        (self.run / "loaded-4.json").write_text(json.dumps({"version": "1.0", "pid": "4", "at": now, "role": "cli"}), "utf-8")
        self.put(os.getpid(), "0.1.0", name="loaded-5.json")  # the name is not its pid
        self.put(os.getpid(), "0.1.0", role="hermes gateway run --token x")  # not a known role
        old_tmp = self.run / ".loaded-6.tmp"
        old_tmp.write_text("half", "utf-8")
        os.utime(old_tmp, (time.time() - 7200, time.time() - 7200))
        new_tmp = self.run / ".loaded-7.tmp"
        new_tmp.write_text("half", "utf-8")
        (self.run / "notes.txt").write_text("mine", "utf-8")
        self.assertEqual(running.status(self.base)["loaded"], None)
        self.assertEqual(sorted(p.name for p in self.run.iterdir()), [".loaded-7.tmp", "notes.txt"])

    def test_oldest_live_version_and_the_one_off_disk_first(self):
        child = sleeper()
        try:
            self.put(os.getpid(), running.VERSION, role="gateway")
            self.put(child.pid, "0.9.0", role="serve")
            self.assertEqual(running.status(self.base), {
                "loaded": "0.9.0", "disk": running.VERSION, "stale": True,
                "processes": [{"role": "serve", "version": "0.9.0"}, {"role": "gateway", "version": running.VERSION}]})
            self.put(child.pid, "0.99.0")  # newer than the files (a downgrade): still the one that differs
            self.assertEqual(running.status(self.base)["loaded"], "0.99.0")
            self.put(child.pid, running.VERSION)
            self.assertFalse(running.status(self.base)["stale"])
        finally:
            child.kill()
            child.wait()
        self.assertEqual(running.status(self.base)["processes"], [{"role": "gateway", "version": running.VERSION}])
        self.assertFalse((self.run / f"loaded-{child.pid}.json").exists())

    def test_record_never_raises(self):
        blocker = self.base / "file"
        blocker.write_text("x", "utf-8")
        running.record(blocker)  # .run cannot be made under a file
        self.assertEqual(running.status(blocker)["loaded"], None)

    def test_roles(self):
        cases = [(["/usr/bin/hermes", "gateway", "run", "--token", "s3cr3t"], "gateway"),
                 (["/usr/bin/hermes", "serve", "--port", "9119"], "serve"),
                 (["/usr/bin/hermes", "dashboard", "--no-open"], "serve"),
                 (["/x/hermes_cli/plugin_host_child.py"], "plugin-host"),
                 (["/x/tui_gateway/compute_host.py"], "compute-host"),
                 (["/usr/bin/hermes", "artifacts", "list"], "cli"),
                 ([], "cli")]
        for argv, role in cases:
            with _Argv(*argv):
                self.assertEqual(running._role(), role, argv)
        self.assertEqual(set(running.ROLES), {"gateway", "serve", "compute-host", "plugin-host", "cli"})


class ApiTests(unittest.TestCase):
    def test_gallery_list_carries_the_server_versions(self):
        running.record()
        r = api.handle("GET", "artifacts", {}, None)
        self.assertEqual({k: r["server"][k] for k in ("loaded", "disk", "stale")},
                         {"loaded": running.VERSION, "disk": running.VERSION, "stale": False})
        self.assertIn({"role": running._role(), "version": running.VERSION}, r["server"]["processes"])
        self.assertTrue(all(set(x) == {"role", "version"} for x in r["server"]["processes"]))  # no pids
        self.assertTrue((store.root() / ".run" / f"loaded-{os.getpid()}.json").is_file())
        self.assertNotIn(".run", [a["id"] for a in r["artifacts"]])

    def test_not_an_op_a_page_can_ask(self):
        m = store.publish(html="<p>x</p>", title="ops")
        with self.assertRaises(api.ApiError):
            api.handle("POST", f"artifacts/{m['id']}/op", {}, {"op": "server", "args": {}})


class PluginSideTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def test_register_records_the_loaded_version(self):
        f = store.root() / ".run" / f"loaded-{os.getpid()}.json"
        if f.exists():
            f.unlink()

        class Ctx:
            def register_hook(self, *a, **kw):
                pass

            def register_tool(self, **kw):
                pass

            def register_cli_command(self, *a, **kw):
                pass

            def get_config(self, key):
                return None

        self.p.register(Ctx())
        self.assertEqual(json.loads(f.read_text("utf-8"))["version"], self.p.running.VERSION)

    def test_publish_note_only_while_stale_and_fit_to_the_process(self):
        r = json.loads(self.p._publish({"html": "<p>a</p>", "title": "n", "open": False}))
        self.assertNotIn("note", r)
        notes = {}
        for argv, role in ((["hermes", "serve"], "serve"), (["hermes", "gateway", "run"], "gateway"),
                           (["/x/compute_host.py"], "compute-host")):
            with _DiskAt(self.p.running, "0.99.0"), _Argv(*argv):
                notes[role] = json.loads(self.p._publish({"html": "<p>b</p>", "title": "n", "open": False}))["note"]
        for role, note in notes.items():
            self.assertIn(f"({role})", note)
            self.assertIn(running.VERSION, note)
            self.assertIn("0.99.0", note)
            self.assertLess(len(note), 280)  # only while stale; the two commands in full are most of it
        reload = "hermes plugins disable hermes-artifacts, then hermes plugins enable hermes-artifacts"
        for role in ("serve", "gateway"):  # the reload first, a restart only if the note stays
            self.assertIn(reload, notes[role])
            self.assertLess(notes[role].index(reload), notes[role].index("if this note stays"))
        self.assertIn("restart hermes serve / dashboard (not just the gateway)", notes["serve"])
        self.assertIn("if this note stays, hermes gateway restart", notes["gateway"])
        self.assertNotIn("disable", notes["compute-host"])  # it takes no reload
        self.assertIn("restart Hermes on the server", notes["compute-host"])

    def test_register_twice_in_one_process_is_safe(self):
        """Hermes may unload and register the plugin again in a live process (disable/enable, Desktop's
        Update): each register() records its version again, registers the same things once, leaves no
        looping thread behind, and hands Hermes a cleanup that stops the browser viewer."""
        import threading

        class Ctx:
            def __init__(self):
                self.calls, self.unload = [], []

            def register_hook(self, name, *a, **kw):
                self.calls.append(("hook", name))

            def register_tool(self, **kw):
                self.calls.append(("tool", kw["name"]))

            def register_cli_command(self, name, *a, **kw):
                self.calls.append(("cli", name))

            def register_skill(self, name, *a, **kw):
                self.calls.append(("skill", name))

            def on_unload(self, cb):
                self.unload.append(cb)

            def get_config(self, key):
                return None

        f = store.root() / ".run" / f"loaded-{os.getpid()}.json"
        before = {t.name for t in threading.enumerate()}
        first, second = Ctx(), Ctx()
        self.p.register(first)
        f.unlink()
        self.p.register(second)
        self.assertEqual(json.loads(f.read_text("utf-8"))["version"], self.p.running.VERSION)  # recorded again
        self.assertEqual(first.calls, second.calls)
        self.assertEqual(len(second.calls), len(set(second.calls)))  # nothing twice in one register()
        self.assertEqual(len(second.unload), 1)
        self.assertIs(self.p._ctx, second)
        for t in threading.enumerate():  # the one-shot startup threads end
            if t.name.startswith("hermes-artifacts") and t.name not in before:
                t.join(10)
                self.assertFalse(t.is_alive(), t.name)

        class Srv:
            stopped = 0

            def stop(self):
                Srv.stopped += 1

        self.p._server = Srv()
        second.unload[0]()
        self.assertEqual((Srv.stopped, self.p._server), (1, None))
        second.unload[0]()  # a second unload: nothing to stop, no error
        self.assertEqual(Srv.stopped, 1)

    def test_an_older_hermes_without_on_unload_still_registers(self):
        class Ctx:
            def register_hook(self, *a, **kw):
                pass

            def register_tool(self, **kw):
                pass

            def register_cli_command(self, *a, **kw):
                pass

            def get_config(self, key):
                return None

        self.p.register(Ctx())


if __name__ == "__main__":
    unittest.main()
