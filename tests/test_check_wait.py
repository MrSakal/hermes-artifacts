"""How long ha_check waits after a version just showed: until the host's reports that came within 0.2 s of
the shown one are on disk (a write of the record newer than that, which the 100 ms polling sees at once),
at most WRITE_EVERY_S after it; with no viewer at most NO_VIEWER_WAIT_S. The same answers as the old fixed
sleeps, sooner."""

import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import diagnostics as D, store  # noqa: E402
from test_types import load_plugin  # noqa: E402

ERR = {"k": "error", "m": "x is undefined", "at": "index.html:3", "n": 1}


def record(aid, last, entries=(), shown="ready"):
    """The record as another process (the one the host posts to) writes it: now, with ``last`` the report's time."""
    rec = {"opened": 1, "first": last, "last": last, "ready": 1, "threw": 0, "shown": shown, "viewer": "desktop",
           "entries": [dict(e, t=last) for e in entries], "dropped": 0}
    D._write_file(D._path(aid), {"v1": rec})


class WaitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load_plugin()

    def setUp(self):
        self._mods = (D, self.p.diagnostics)
        self._real = [m.enabled for m in self._mods]
        for mod in self._mods:
            mod.enabled = lambda getter=None: True
        self.aid = store.publish(html="<p>x</p>", title="w", type="page")["id"]
        store.update_meta(self.aid, opened=True)  # a viewer shows it

    def tearDown(self):
        for mod, real in zip(self._mods, self._real):
            mod.enabled = real

    def check(self, wait=30):
        t = time.time()
        r = json.loads(self.p._check({"id": self.aid, "wait": wait}, task_id="W"))
        return r, time.time() - t

    def test_just_shown_with_nothing_more_waits_the_writes_period(self):
        record(self.aid, time.time())
        r, took = self.check()
        self.assertEqual(r["page"]["shown"], "ready")
        self.assertGreater(took, D.WRITE_EVERY_S)  # a report sent right after could still be on its way
        self.assertLess(took, D.WRITE_EVERY_S + 0.5)

    def test_a_later_write_ends_the_wait_with_what_it_carries(self):
        at = time.time()
        record(self.aid, at)

        def host():  # the error the page threw right after showing, written with the next batch
            time.sleep(0.35)
            record(self.aid, at, entries=[ERR])
        threading.Thread(target=host).start()
        r, took = self.check()
        self.assertEqual([e["m"] for e in r["page"]["errors"]], ["x is undefined"])
        self.assertLess(took, 0.8)

    def test_a_record_written_after_its_report_needs_no_wait(self):
        record(self.aid, time.time() - 0.5)  # batched: written half a second after the report
        r, took = self.check()
        self.assertEqual(r["page"]["shown"], "ready")
        self.assertLess(took, 0.3)

    def test_shown_a_while_ago_needs_no_wait(self):
        record(self.aid, time.time() - 1.5)
        os.utime(D._path(self.aid), (time.time() - 1.5, time.time() - 1.5))
        r, took = self.check()
        self.assertEqual(r["page"]["shown"], "ready")
        self.assertLess(took, 0.3)

    def test_a_report_arriving_while_waiting_is_seen_within_a_poll(self):
        def host():
            time.sleep(0.5)
            record(self.aid, time.time() - 0.3)
        threading.Thread(target=host).start()
        r, took = self.check()
        self.assertEqual(r["page"]["shown"], "ready")
        self.assertLess(took, 0.5 + 0.35)  # the old loop looked once a second

    def test_no_viewer_waits_at_most_two_seconds(self):
        aid = store.publish(html="<p>y</p>", title="nobody", type="page")["id"]
        t = time.time()
        r = json.loads(self.p._check({"id": aid, "wait": 30}, task_id="W"))
        took = time.time() - t
        self.assertIsNone(r["page"])
        self.assertGreater(took, self.p.NO_VIEWER_WAIT_S - 0.2)
        self.assertLess(took, self.p.NO_VIEWER_WAIT_S + 0.3)


if __name__ == "__main__":
    unittest.main()
