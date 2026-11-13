"""The kept formula process (calc.py + calc_worker.js): started like the one-shot runner (same argv flags,
environment, folder, no shell), reused, answers the same as a one-shot process, safe under concurrent calls,
killed on a timeout, replaced when it dies or its files change, ended when idle and on unload; a computation
it cannot take runs as a one-shot process."""

import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import calc  # noqa: E402

BOOK = [{"name": "S", "cells": {"A1": 2, "A2": 3, "A3": "=A1*A2", "B1": "=SUM(A1:A3)", "B2": "=1/0"}, "charts": []},
        {"name": "T", "cells": {"A1": "=S!A3+1", "A2": "=UPPER(\"x\")"}, "charts": []}]


def script(text: str) -> Path:
    fd, path = tempfile.mkstemp(suffix=".js")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    return Path(path)


@unittest.skipUnless(shutil.which("node"), "node is not on PATH")
class WorkerTests(unittest.TestCase):
    def setUp(self):
        calc.shutdown()
        calc._state["off_until"] = 0.0
        calc._node.update(path=None, at=None)

    def tearDown(self):
        calc.shutdown()
        calc._state["off_until"] = 0.0

    def worker(self):
        return calc._state["worker"]

    def test_kept_and_reused_with_the_one_shot_answers(self):
        node = calc.node_path()
        first = calc.run(BOOK)
        w = self.worker()
        self.assertIsNotNone(w)
        self.assertEqual(calc.run(BOOK), first)
        self.assertIs(self.worker(), w)  # the same process
        data = calc.json.dumps({"locale": "en", "sheets": BOOK}, separators=(",", ":")).encode()
        self.assertEqual(calc._once(node, data, BOOK), first)  # what a one-shot runner gives
        self.assertEqual(first[0]["A3"], 6)
        self.assertEqual(first[1]["A1"], 7)
        self.assertEqual(first[0]["B2"], {"error": "#DIV/0!"})
        t = time.perf_counter()
        calc.run(BOOK)
        self.assertLess(time.perf_counter() - t, 0.1)  # no node start

    def test_started_exactly_as_the_runner(self):
        real = subprocess.Popen
        seen = []

        def spy(*a, **kw):
            seen.append((a, kw))
            return real(*a, **kw)
        with mock.patch.object(calc.subprocess, "Popen", side_effect=spy), \
                mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test", "NODE_OPTIONS": "--inspect"}):
            self.assertIsNotNone(calc.run(BOOK))
        (argv,), kw = seen[0]
        self.assertEqual(argv[:2], [calc.node_path(), f"--max-old-space-size={calc.MAX_HEAP_MB}"])
        self.assertEqual(argv[2:], [str(calc.WORKER), str(calc.RUNNER), str(calc.FORMULA), str(calc.MAX_OUT)])
        self.assertEqual(kw["env"], calc.child_env())
        self.assertNotIn("OPENAI_API_KEY", kw["env"])
        self.assertNotIn("NODE_OPTIONS", kw["env"])
        self.assertEqual((kw["cwd"], kw["shell"], kw["stderr"]), (str(calc._DIR), False, subprocess.DEVNULL))

    def test_concurrent_calls_each_get_their_own_answer(self):
        out = {}

        def one(i):
            out[i] = calc.run([{"name": "S", "cells": {"A1": i, "A2": f"=A1*{i}"}, "charts": []}])
        ts = [threading.Thread(target=one, args=(i,)) for i in range(12)]
        for t in ts:
            t.start()
        for t in ts:
            t.join(30)
        self.assertEqual({i: r[0]["A2"] for i, r in out.items()}, {i: i * i for i in range(12)})

    def test_a_computation_over_its_time_kills_it_and_the_next_starts_anew(self):
        spin = script("process.stdin.on('end', function () { for (;;) {} });\n")
        try:
            with mock.patch.object(calc, "RUNNER", spin), mock.patch.object(calc, "TIMEOUT", 0.5):
                t = time.perf_counter()
                self.assertIsNone(calc.run(BOOK))
                self.assertLess(time.perf_counter() - t, 3)
                self.assertIsNone(self.worker())
        finally:
            os.unlink(spin)
        self.assertEqual(calc.run(BOOK)[0]["A3"], 6)

    def test_one_that_died_is_replaced(self):
        calc.run(BOOK)
        w = self.worker()
        w.p.kill()
        w.p.wait(5)
        self.assertEqual(calc.run(BOOK)[0]["A3"], 6)
        self.assertIsNot(self.worker(), w)

    def test_dying_on_a_workbook_falls_back_to_one_shot_processes(self):
        boom = script("require('process').exit(7);\n")
        try:
            with mock.patch.object(calc, "RUNNER", boom):
                self.assertIsNone(calc.run(BOOK))  # and as a one-shot process it exits 7 too
                self.assertGreater(calc._state["off_until"], time.monotonic())
                with mock.patch.object(calc, "_once", return_value=["once"]) as once:
                    self.assertEqual(calc.run(BOOK), ["once"])
                    once.assert_called_once()
        finally:
            os.unlink(boom)

    def test_no_kept_process_no_problem(self):
        with mock.patch.object(calc, "_Worker", side_effect=OSError("no")):
            self.assertEqual(calc.run(BOOK)[0]["A3"], 6)

    def test_a_changed_runner_starts_a_new_one(self):
        calc.run(BOOK)
        w = self.worker()
        with mock.patch.object(calc, "MAX_OUT", 10):  # more output than accepted: the runner writes none
            self.assertIsNone(calc.run(BOOK))
            self.assertIsNot(self.worker(), w)
        self.assertEqual(calc.run(BOOK)[0]["A3"], 6)

    def test_idle_and_unload_end_it(self):
        with mock.patch.object(calc, "IDLE", 0.2):
            calc.run(BOOK)
            w = self.worker()
            deadline = time.time() + 5
            while w.p.poll() is None and time.time() < deadline:
                time.sleep(0.05)
            self.assertIsNotNone(w.p.poll())
            self.assertIsNone(self.worker())
        import importlib
        from test_types import load_plugin
        p = load_plugin()
        own = importlib.import_module(p.__name__ + ".hermes_artifacts.calc")  # the plugin's own copy
        own._state["off_until"] = 0.0
        own.run(BOOK)
        w = own._state["worker"]
        self.assertIsNotNone(w)
        p._unload()
        self.assertIsNotNone(w.p.poll())
        self.assertIsNone(own._state["worker"])


if __name__ == "__main__":
    unittest.main()
